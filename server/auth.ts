import { Router, Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import * as crypto from "crypto";
import { db } from "./db";
import { users, authLockouts, authSessions } from "@shared/schema";
import { eq, and, isNull, sql } from "drizzle-orm";
import { featureFlagService } from "./feature-flags";

// P0-3 (runtime-truth-isolation-seal): production must hard-fail if JWT_SECRET
// missing. The previous fallback ("avyron_jwt_secret_" + REPL_ID) silently
// produced predictable secrets in production environments where REPL_ID is
// stable, allowing token forgery. Dev fallback retained for local DX only.
if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
  // Fatal — refuse to boot. Better to crash visibly than to serve forgeable tokens.
  // eslint-disable-next-line no-console
  console.error("[Auth] FATAL: JWT_SECRET is required in production. Refusing to start.");
  throw new Error("JWT_SECRET environment variable is required in production");
}
const JWT_SECRET = process.env.JWT_SECRET || "avyron_jwt_secret_" + (process.env.REPL_ID || "dev");
if (!process.env.JWT_SECRET) {
  console.warn("[Auth] WARNING: JWT_SECRET not set — using DEV fallback. This will hard-fail in production.");
}
const TRIAL_DAYS = 7;

// ─── Seal #2 (Task #20) — F9.2 JWT aud/iss + 7d grace window ────────────────
// New tokens are signed with audience+issuer. Legacy tokens (no aud/iss) are
// accepted for `JWT_LEGACY_GRACE_DAYS` after deploy so existing 14d sessions
// don't all instantly invalidate. Operators monitor `JWT_LEGACY_HITS` to
// know when migration is complete (every legacy verify increments it).
// Grace cutoff persists in env `JWT_LEGACY_CUTOFF_ISO`; if absent, we set it
// to deploy-time + grace days at first boot.
export const JWT_AUDIENCE = "avyron-ai";
export const JWT_ISSUER = "avyron-auth";
const JWT_LEGACY_GRACE_DAYS = Number(process.env.JWT_LEGACY_GRACE_DAYS) || 7;

// Seal #2 (Task #20) F9.2 — multi-pass architect hardening:
//
// PROBLEM (pass 1): naive `Date.now() + grace` at module load slid forward on
//   every restart → grace became PERMANENT. Malformed env produced NaN → silent
//   permanent bypass.
// PROBLEM (pass 5): pass-1's "production unset → cutoff=0" was too strict —
//   it would IMMEDIATELY invalidate every legacy 14d session if an operator
//   forgot the env var on first deploy, breaking the migration guarantee.
//
// FINAL FIX (stable persisted default + strict env parsing):
//   - If `JWT_LEGACY_CUTOFF_ISO` is set AND parseable → use it (operator wins).
//   - If `JWT_LEGACY_CUTOFF_ISO` is set but malformed → cutoff = 0
//     (fail-closed; obvious operator typo, refuse to guess).
//   - If `JWT_LEGACY_CUTOFF_ISO` is unset → derive `now + JWT_LEGACY_GRACE_DAYS`
//     ONCE and persist to `.local/state/jwt-legacy-cutoff` (or `JWT_LEGACY_STATE_FILE`).
//     Subsequent boots READ the persisted timestamp → STABLE across restarts,
//     no sliding, no permanent backdoor. Honors the 7d migration guarantee
//     even if the operator forgets the env var on first deploy.
import * as fs from "node:fs";
import * as path from "node:path";

function legacyCutoffStateFile(): string {
  if (process.env.JWT_LEGACY_STATE_FILE) return process.env.JWT_LEGACY_STATE_FILE;
  return path.resolve(process.cwd(), ".local/state/jwt-legacy-cutoff");
}

function readPersistedCutoffMs(): number | null {
  try {
    const f = legacyCutoffStateFile();
    if (!fs.existsSync(f)) return null;
    const raw = fs.readFileSync(f, "utf-8").trim();
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch { return null; }
}

function writePersistedCutoffMs(ms: number): void {
  try {
    const f = legacyCutoffStateFile();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, String(ms), "utf-8");
  } catch (err) {
    console.error("[Auth] failed to persist JWT_LEGACY_CUTOFF stamp:", err);
  }
}

function resolveLegacyCutoffMs(): number {
  const raw = process.env.JWT_LEGACY_CUTOFF_ISO;
  if (raw && raw.trim()) {
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) {
      console.log(`[Auth] JWT_LEGACY_CUTOFF resolved from env → ${new Date(parsed).toISOString()}`);
      return parsed;
    }
    console.error(`[Auth] FATAL: JWT_LEGACY_CUTOFF_ISO is malformed (${raw}). Disabling legacy grace (cutoff=0).`);
    return 0;
  }
  // Env unset → use a STABLE persisted stamp so restarts don't slide and a
  // forgotten env var doesn't break the 7d migration guarantee.
  const persisted = readPersistedCutoffMs();
  if (persisted) {
    console.log(`[Auth] JWT_LEGACY_CUTOFF resolved from persisted stamp → ${new Date(persisted).toISOString()}`);
    return persisted;
  }
  const fresh = Date.now() + JWT_LEGACY_GRACE_DAYS * 24 * 60 * 60 * 1000;
  writePersistedCutoffMs(fresh);
  const envBanner = process.env.NODE_ENV === "production" ? "PROD" : "DEV";
  console.warn(`[Auth] ${envBanner}: JWT_LEGACY_CUTOFF_ISO unset — derived stable cutoff = boot+${JWT_LEGACY_GRACE_DAYS}d = ${new Date(fresh).toISOString()} (persisted to ${legacyCutoffStateFile()}). To override, set JWT_LEGACY_CUTOFF_ISO.`);
  return fresh;
}
let JWT_LEGACY_CUTOFF_MS = resolveLegacyCutoffMs();
export const JWT_LEGACY_METRICS = { hits: 0, lastHitAt: 0 };

/** Test-only: override the cutoff so the grace boundary is behaviorally testable. */
export function __setJwtLegacyCutoffMsForTest(ms: number) { JWT_LEGACY_CUTOFF_MS = ms; }
export function __getJwtLegacyCutoffMsForTest(): number { return JWT_LEGACY_CUTOFF_MS; }
export function __resetJwtLegacyCutoffForTest() { JWT_LEGACY_CUTOFF_MS = resolveLegacyCutoffMs(); }

// Access-token TTL: kept at 14d during the JWT_LEGACY_GRACE window so
// existing mobile clients (which do not yet implement /api/auth/refresh)
// don't get force-logged-out every 60 minutes. Refresh-token rotation is
// shipped additively in this seal; tightening the access TTL to 60m is a
// follow-up that lands AFTER the client gains refresh wiring (tracked in
// .local/plans/forensic-v2-seal.md "Sunset items").
const ACCESS_TOKEN_TTL = "14d";
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// ─── Seal #2 (Task #20) — F9.4 account lockout policy ───────────────────────
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_MAX_FAILURES = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

// Seal #2 (Task #20) F9.4 timing-oracle equalization (architect feedback):
//
// Without this, a non-existent email returns BEFORE bcrypt.compare runs while
// an existing email pays the bcrypt cost (~80ms). That delta is a reliable
// user-enumeration oracle. We pre-compute a fixed dummy bcrypt hash and run
// bcrypt.compare against it when the user is missing so both code paths spend
// roughly equivalent CPU before returning the same generic 401.
//
// The dummy hash is intentionally a hash of a value that no real password
// will ever match (random 32-byte token at module load). Comparing against it
// always fails, so any accidental code-path crossover still rejects.
//
// COST FACTOR MUST MATCH register-time cost (see /api/auth/register:
// `bcrypt.hash(password, BCRYPT_COST)`). Otherwise compare-time CPU differs
// between miss and hit paths and the oracle reopens. Architect re-review
// caught a 10-vs-12 mismatch that produced ~4× skew (77ms vs 315ms locally).
const BCRYPT_COST = 12;
const DUMMY_BCRYPT_HASH = bcrypt.hashSync(
  crypto.randomBytes(32).toString("hex") + "-dummy-equalizer",
  BCRYPT_COST,
);

export class AuthConfigurationError extends Error {
  status: number;
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigurationError";
    this.status = 401;
  }
}
// P1-3 (launch-closure W4): in production, refuse to boot if
// STRIPE_WEBHOOK_SECRET is missing. The previous fallback to the
// "x-internal-key === JWT_SECRET" branch let any holder of the JWT secret
// forge a Stripe webhook and arbitrarily mutate `subscriptionStatus`,
// `planType`, `videoCredits` for any user. JWT_SECRET is a session-signing
// secret, not a payments secret — they must NOT share trust scope.
if (process.env.NODE_ENV === "production" && !process.env.STRIPE_WEBHOOK_SECRET) {
  console.error("[Auth] FATAL: STRIPE_WEBHOOK_SECRET is required in production. Refusing to start.");
  throw new Error("STRIPE_WEBHOOK_SECRET environment variable is required in production");
}
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";

// P1-3 (launch-closure W4): in-memory sliding-window rate limiter for
// /api/auth/login and /api/auth/register — 5 attempts / minute / IP. Avoids
// adding express-rate-limit (no new dependency) and is sufficient for a
// single-replica Express deployment. If we scale horizontally, replace with
// a Redis-backed limiter — flagged in the seal report as a follow-up.
const AUTH_RATE_WINDOW_MS = 60_000;
const AUTH_RATE_MAX = 5;
const authRateState = new Map<string, number[]>();

function authRateLimit(req: Request, res: Response, next: NextFunction) {
  const ip = (req.ip || req.socket.remoteAddress || "unknown").toString();
  const now = Date.now();
  const cutoff = now - AUTH_RATE_WINDOW_MS;
  const hits = (authRateState.get(ip) || []).filter(t => t > cutoff);
  if (hits.length >= AUTH_RATE_MAX) {
    const retryAfterSec = Math.max(1, Math.ceil((hits[0] + AUTH_RATE_WINDOW_MS - now) / 1000));
    res.setHeader("Retry-After", String(retryAfterSec));
    console.warn(`[Auth] RATE_LIMIT_HIT | ip=${ip} | path=${req.path} | hits=${hits.length}`);
    return res.status(429).json({ error: "Too many attempts. Try again shortly.", retryAfterSec });
  }
  hits.push(now);
  authRateState.set(ip, hits);
  // periodic cheap GC: every ~1000 calls walk the map
  if (authRateState.size > 1000 && Math.random() < 0.01) {
    for (const [k, v] of authRateState.entries()) {
      const live = v.filter(t => t > cutoff);
      if (live.length === 0) authRateState.delete(k);
      else authRateState.set(k, live);
    }
  }
  next();
}

interface JwtPayload {
  userId: string;
  email: string;
  accountId?: string;
  iat?: number;
}

export interface AuthRequest extends Request {
  userId?: string;
  accountId?: string;
}

const ADMIN_ACCOUNT_IDS = new Set([
  "a2d87878-a1e9-41ea-a8a5-90beff569673",
]);

export function resolveAccountId(req: AuthRequest): string {
  if (!req.accountId) {
    throw new AuthConfigurationError("Authentication required: no account context found on request. Ensure this route is protected by authMiddleware.");
  }
  return req.accountId;
}

export function adminMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.accountId || !ADMIN_ACCOUNT_IDS.has(req.accountId)) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

export function isAdminAccount(accountId: string | undefined | null): boolean {
  return !!accountId && ADMIN_ACCOUNT_IDS.has(accountId);
}

/**
 * Phase 8.0 (Main migration) — verifies an admin JWT token outside the Express
 * middleware chain. Used by the cookie-gated pipeline-overlay dashboard
 * (server/index.ts §2.7.1 block) which validates tokens at form-submit time
 * before setting an HttpOnly cookie. Mirrors the (verifyToken + ADMIN_ACCOUNT_IDS)
 * check that adminMiddleware performs at request-handler time.
 *
 * @returns the validated admin accountId, or null if the token is invalid /
 *          expired / non-admin.
 */
export function verifyAdminToken(token: string): string | null {
  const payload = verifyToken(token);
  if (!payload) return null;
  const accountId = payload.accountId || payload.userId;
  if (!ADMIN_ACCOUNT_IDS.has(accountId)) return null;
  return accountId;
}

// Seal #2 (Task #20): F9.2 — sign access tokens with aud/iss. Note legacy
// 14d-no-aud/iss tokens already issued before deploy will continue to verify
// during the grace window via verifyToken().
function generateAccessToken(userId: string, email: string, accountId: string): string {
  return jwt.sign(
    { userId, email, accountId } as JwtPayload,
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL, audience: JWT_AUDIENCE, issuer: JWT_ISSUER },
  );
}

// Backward-compat name used elsewhere in the codebase.
function generateToken(userId: string, email: string, accountId: string): string {
  return generateAccessToken(userId, email, accountId);
}

/** Test-only re-export of verifyToken for behavioral assertions. */
export function __verifyTokenForTest(token: string): JwtPayload | null { return verifyToken(token); }

function verifyToken(token: string): JwtPayload | null {
  // Strict path: aud + iss enforced.
  try {
    return jwt.verify(token, JWT_SECRET, { audience: JWT_AUDIENCE, issuer: JWT_ISSUER }) as JwtPayload;
  } catch {
    // Legacy path (Seal #2 F9.2 grace window). Code-review hardening:
    // accepting ANY non-strict token during the grace window was too broad —
    // a token with the WRONG aud/iss would also fall through. We now require
    // BOTH:
    //   1. The decoded payload has NO aud and NO iss (truly pre-deploy shape).
    //      A token with wrong-aud is NOT legacy, it's tampered/foreign.
    //   2. iat is set AND iat * 1000 < JWT_LEGACY_CUTOFF_MS — the token must
    //      have been issued BEFORE the grace deadline. Tokens issued after
    //      cutoff cannot ride the grace path.
    // Past the cutoff timestamp every token MUST carry aud/iss.
    if (Date.now() >= JWT_LEGACY_CUTOFF_MS) {
      return null;
    }
    // Inspect claims WITHOUT verifying signature (jwt.decode is unsigned).
    const inspected = jwt.decode(token, { complete: true });
    if (!inspected || typeof inspected === "string") return null;
    const claims: any = inspected.payload || {};
    if (claims.aud != null || claims.iss != null) return null;
    if (typeof claims.iat !== "number") return null;
    if (claims.iat * 1000 >= JWT_LEGACY_CUTOFF_MS) return null;
    // Now run signature + exp verification (no aud/iss enforcement).
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
      JWT_LEGACY_METRICS.hits++;
      JWT_LEGACY_METRICS.lastHitAt = Date.now();
      if (JWT_LEGACY_METRICS.hits === 1 || JWT_LEGACY_METRICS.hits % 100 === 0) {
        console.warn(`[Auth] JWT_LEGACY_GRACE | hits=${JWT_LEGACY_METRICS.hits} | cutoff=${new Date(JWT_LEGACY_CUTOFF_MS).toISOString()}`);
      }
      return decoded;
    } catch {
      return null;
    }
  }
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const token = authHeader.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  req.userId = payload.userId;
  req.accountId = payload.accountId || payload.userId;
  next();
}

export function optionalAuth(req: AuthRequest, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const payload = verifyToken(token);
    if (payload) {
      req.userId = payload.userId;
      req.accountId = payload.accountId || payload.userId;
    }
  }
  next();
}

// ─── Seal #2 (Task #20) — F9.4 lockout helpers ──────────────────────────────
export async function __checkLockoutForTest(email: string) { return checkLockout(email); }
export async function __recordLoginFailureForTest(email: string) { return recordLoginFailure(email); }
export async function __clearLockoutForTest(email: string) { return clearLockout(email); }
export async function __issueSessionForTest(opts: { userId: string; accountId: string; deviceFingerprint: string }) { return issueSessionForDevice(opts); }
export function __parseRefreshTokenForTest(tok: string) { return parseRefreshToken(tok); }

async function checkLockout(email: string): Promise<{ locked: boolean; retryAfterSec: number }> {
  const [row] = await db.select().from(authLockouts).where(eq(authLockouts.email, email)).limit(1);
  if (!row) return { locked: false, retryAfterSec: 0 };
  const now = Date.now();
  if (row.lockedUntil && row.lockedUntil.getTime() > now) {
    return { locked: true, retryAfterSec: Math.ceil((row.lockedUntil.getTime() - now) / 1000) };
  }
  return { locked: false, retryAfterSec: 0 };
}

async function recordLoginFailure(email: string): Promise<void> {
  const now = new Date();
  const [row] = await db.select().from(authLockouts).where(eq(authLockouts.email, email)).limit(1);
  if (!row) {
    await db.insert(authLockouts).values({
      email, failedAttempts: 1, windowStart: now, lastAttemptAt: now,
    }).onConflictDoUpdate({
      target: authLockouts.email,
      set: { failedAttempts: 1, windowStart: now, lastAttemptAt: now, lockedUntil: null },
    });
    return;
  }
  // Reset window if expired.
  const windowExpired = now.getTime() - row.windowStart.getTime() > LOCKOUT_WINDOW_MS;
  const nextAttempts = windowExpired ? 1 : (row.failedAttempts || 0) + 1;
  const nextWindowStart = windowExpired ? now : row.windowStart;
  const nextLockedUntil = nextAttempts >= LOCKOUT_MAX_FAILURES
    ? new Date(now.getTime() + LOCKOUT_DURATION_MS)
    : row.lockedUntil;
  await db.update(authLockouts).set({
    failedAttempts: nextAttempts,
    windowStart: nextWindowStart,
    lastAttemptAt: now,
    lockedUntil: nextLockedUntil,
  }).where(eq(authLockouts.email, email));
  if (nextAttempts >= LOCKOUT_MAX_FAILURES) {
    console.warn(`[Auth] ACCOUNT_LOCKED | email=${email} | failures=${nextAttempts} | lockedUntil=${nextLockedUntil?.toISOString()}`);
  }
}

async function clearLockout(email: string): Promise<void> {
  await db.delete(authLockouts).where(eq(authLockouts.email, email));
}

// ─── Seal #2 (Task #20) — F9.8 refresh-token rotation helpers ───────────────
// Refresh tokens have shape `{sessionId}.{secret}`. We look up by sessionId
// then bcrypt-compare the secret. Old (revoked) rows are kept so reuse can
// be detected → revoke all account sessions on reuse.
function generateRefreshSecret(): string {
  return crypto.randomBytes(32).toString("base64url");
}
function parseRefreshToken(token: string): { sessionId: string; secret: string } | null {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  return { sessionId: token.slice(0, dot), secret: token.slice(dot + 1) };
}

async function issueSessionForDevice(opts: {
  userId: string;
  accountId: string;
  deviceFingerprint: string;
}): Promise<{ refreshToken: string; sessionId: string; expiresAt: Date }> {
  const { userId, accountId, deviceFingerprint } = opts;
  const secret = generateRefreshSecret();
  const hash = await bcrypt.hash(secret, BCRYPT_COST);
  // Revoke any existing ACTIVE row for this device first (partial unique
  // index forbids two active rows on the same device).
  await db.update(authSessions).set({ revokedAt: new Date(), revokeReason: "rotated_login" })
    .where(and(
      eq(authSessions.accountId, accountId),
      eq(authSessions.deviceFingerprint, deviceFingerprint),
      isNull(authSessions.revokedAt),
    ));
  const [row] = await db.insert(authSessions).values({
    accountId, userId, deviceFingerprint, refreshTokenHash: hash,
  }).returning({ id: authSessions.id });
  return {
    sessionId: row.id,
    refreshToken: `${row.id}.${secret}`,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
  };
}

// ─── Seal #7 (Task #25 / F9.9) — GDPR account-deletion routes ────────────────
// Two-step flow:
//   1. POST /api/account/delete-confirm  { password }
//      → verifies password, returns one-shot token (TTL 10min).
//   2. DELETE /api/account
//      Headers: X-Account-Delete-Confirm: <token>
//      Body:    { password }   ← re-verified
//      → masks PII immediately, schedules cascade reaper for +30 days.
// All audit events go to audit_log_archive (survives the cascade).
async function registerAccountDeletionRoutes(app: Router) {
  const { issueDeleteConfirmation, consumeDeleteConfirmation, requestAccountDeletion, cancelAccountDeletion } =
    await import("./account-lifecycle");

  app.post("/api/account/delete-confirm", async (req: AuthRequest, res: Response) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) return res.status(401).json({ error: "Not authenticated" });
    const payload = verifyToken(authHeader.slice(7));
    if (!payload) return res.status(401).json({ error: "Invalid token" });
    const { password } = req.body ?? {};
    if (typeof password !== "string" || !password) return res.status(400).json({ error: "Password required" });

    try {
      const [user] = await db.select().from(users).where(eq(users.id, payload.userId)).limit(1);
      if (!user) return res.status(404).json({ error: "User not found" });
      const ok = await bcrypt.compare(password, user.password);
      if (!ok) return res.status(403).json({ error: "Password incorrect" });
      const accountId = user.accountId || user.id;
      const token = await issueDeleteConfirmation(accountId, user.id);
      return res.json({ confirmationToken: token, expiresInSeconds: 600 });
    } catch (err) {
      console.error("[Auth] delete-confirm error:", err);
      return res.status(500).json({ error: "Failed to issue confirmation" });
    }
  });

  app.delete("/api/account", async (req: AuthRequest, res: Response) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) return res.status(401).json({ error: "Not authenticated" });
    const payload = verifyToken(authHeader.slice(7));
    if (!payload) return res.status(401).json({ error: "Invalid token" });

    const confirmToken = req.headers["x-account-delete-confirm"];
    const { password } = req.body ?? {};
    if (typeof confirmToken !== "string" || !confirmToken) {
      return res.status(400).json({ error: "X-Account-Delete-Confirm header required (POST /api/account/delete-confirm first)" });
    }
    if (typeof password !== "string" || !password) {
      return res.status(400).json({ error: "Password required for re-authentication" });
    }

    try {
      const [user] = await db.select().from(users).where(eq(users.id, payload.userId)).limit(1);
      if (!user) return res.status(404).json({ error: "User not found" });
      const ok = await bcrypt.compare(password, user.password);
      if (!ok) return res.status(403).json({ error: "Password incorrect" });
      const accountId = user.accountId || user.id;
      const consumed = await consumeDeleteConfirmation(accountId, user.id, confirmToken);
      if (!consumed) {
        return res.status(403).json({ error: "Invalid or expired confirmation token" });
      }
      const r = await requestAccountDeletion({
        accountId,
        userId: user.id,
        ip: req.ip,
        userAgent: req.headers["user-agent"] as string | undefined,
      });
      return res.json({
        ok: true,
        deletionScheduledFor: r.reaperAfter.toISOString(),
        message: "Account deletion requested. PII has been masked immediately. Full data removal will complete in 30 days. Cancel via POST /api/account/delete-cancel before then.",
      });
    } catch (err) {
      console.error("[Auth] DELETE /api/account error:", err);
      return res.status(500).json({ error: "Failed to schedule deletion" });
    }
  });

  app.post("/api/account/delete-cancel", async (req: AuthRequest, res: Response) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) return res.status(401).json({ error: "Not authenticated" });
    const payload = verifyToken(authHeader.slice(7));
    if (!payload) return res.status(401).json({ error: "Invalid token" });
    try {
      const [user] = await db.select().from(users).where(eq(users.id, payload.userId)).limit(1);
      if (!user) return res.status(404).json({ error: "User not found" });
      const accountId = user.accountId || user.id;
      const cancelled = await cancelAccountDeletion(accountId);
      return res.json({ cancelled, note: cancelled ? "Reaper cancelled. Note: PII that was masked at request time cannot be restored." : "No pending deletion to cancel." });
    } catch (err) {
      console.error("[Auth] delete-cancel error:", err);
      return res.status(500).json({ error: "Failed to cancel deletion" });
    }
  });
}

export function registerAuthRoutes(app: Router) {
  // Seal #7 — GDPR cascade routes (loaded async; non-blocking).
  registerAccountDeletionRoutes(app).catch(err =>
    console.error("[Auth] Failed to register account-deletion routes:", err)
  );

  app.post("/api/auth/register", authRateLimit, async (req: Request, res: Response) => {
    try {
      const { email, password, name, deviceFingerprint } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
      }

      if (password.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters" });
      }

      const emailLower = email.toLowerCase().trim();

      const existing = await db.select().from(users).where(eq(users.email, emailLower)).limit(1);
      if (existing.length > 0) {
        return res.status(409).json({ error: "An account with this email already exists" });
      }

      const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
      const now = new Date();
      const trialEnd = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

      const [newUser] = await db.insert(users).values({
        username: emailLower,
        password: passwordHash,
        email: emailLower,
        trialStart: now,
        trialEnd,
        subscriptionStatus: "trial",
        hasSeenIntro: false,
      }).returning();

      const userAccountId = newUser.id;
      await db.update(users).set({ accountId: userAccountId }).where(eq(users.id, newUser.id));

      await featureFlagService.seedDefaultFlags(userAccountId).catch(err =>
        console.error("[Auth] Failed to seed default flags for new account:", err)
      );

      const token = generateAccessToken(newUser.id, emailLower, userAccountId);
      const session = await issueSessionForDevice({
        userId: newUser.id, accountId: userAccountId,
        deviceFingerprint: String(deviceFingerprint || req.headers["x-device-fingerprint"] || "default"),
      });

      res.status(201).json({
        token,
        refreshToken: session.refreshToken,
        refreshTokenExpiresAt: session.expiresAt.toISOString(),
        user: {
          id: newUser.id,
          email: emailLower,
          name: name || emailLower.split("@")[0],
          subscriptionStatus: "trial",
          planType: "trial",
          videoCredits: 0,
          trialEnd: trialEnd.toISOString(),
          hasSeenIntro: false,
          accountId: userAccountId,
          isAdmin: ADMIN_ACCOUNT_IDS.has(userAccountId),
        },
      });
    } catch (error: any) {
      console.error("[Auth] Register error:", error);
      if (error?.code === "23505") {
        return res.status(409).json({ error: "An account with this email already exists" });
      }
      res.status(500).json({ error: "Registration failed" });
    }
  });

  app.post("/api/auth/login", authRateLimit, async (req: Request, res: Response) => {
    try {
      const { email, password, deviceFingerprint } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
      }

      const emailLower = email.toLowerCase().trim();

      // Seal #2 F9.4: lockout check BEFORE bcrypt.compare. Avoids both
      // wasted CPU on locked accounts and timing-attack signal.
      const lockout = await checkLockout(emailLower);
      if (lockout.locked) {
        res.setHeader("Retry-After", String(lockout.retryAfterSec));
        return res.status(423).json({
          error: "ACCOUNT_LOCKED",
          message: "Too many failed login attempts. Try again later.",
          retryAfterSec: lockout.retryAfterSec,
        });
      }

      const [user] = await db.select().from(users).where(eq(users.email, emailLower)).limit(1);
      if (!user) {
        // Seal #2 F9.4 timing-equalizer: spend bcrypt CPU even when the user
        // does not exist so the response time does NOT leak account existence.
        await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
        await recordLoginFailure(emailLower);
        return res.status(401).json({ error: "Invalid email or password" });
      }

      const validPassword = await bcrypt.compare(password, user.password);
      if (!validPassword) {
        await recordLoginFailure(emailLower);
        return res.status(401).json({ error: "Invalid email or password" });
      }

      // Success — clear failures so the same email can log in cleanly again.
      await clearLockout(emailLower);

      const userAccountId = user.accountId || user.id;
      if (!user.accountId) {
        await db.update(users).set({ accountId: userAccountId }).where(eq(users.id, user.id));
      }

      await featureFlagService.seedDefaultFlags(userAccountId).catch(err =>
        console.error("[Auth] Failed to seed default flags on login:", err)
      );

      const token = generateAccessToken(user.id, emailLower, userAccountId);
      const session = await issueSessionForDevice({
        userId: user.id, accountId: userAccountId,
        deviceFingerprint: String(deviceFingerprint || req.headers["x-device-fingerprint"] || "default"),
      });

      const now = new Date();
      const isTrialActive = user.trialEnd ? now < user.trialEnd : false;
      const status = user.subscriptionStatus === "active" ? "active" :
                     isTrialActive ? "trial" : "expired";

      res.json({
        token,
        refreshToken: session.refreshToken,
        refreshTokenExpiresAt: session.expiresAt.toISOString(),
        user: {
          id: user.id,
          email: user.email,
          name: user.email?.split("@")[0] || "User",
          subscriptionStatus: status,
          planType: user.planType || "trial",
          videoCredits: user.videoCredits ?? 0,
          trialEnd: user.trialEnd?.toISOString() || null,
          hasSeenIntro: user.hasSeenIntro ?? false,
          accountId: userAccountId,
          isAdmin: ADMIN_ACCOUNT_IDS.has(userAccountId),
        },
      });
    } catch (error) {
      console.error("[Auth] Login error:", error);
      res.status(500).json({ error: "Login failed" });
    }
  });

  // ─── Seal #2 (Task #20) F9.8 — refresh-token rotation ─────────────────────
  app.post("/api/auth/refresh", authRateLimit, async (req: Request, res: Response) => {
    try {
      const { refreshToken, deviceFingerprint } = req.body || {};
      if (!refreshToken || typeof refreshToken !== "string") {
        return res.status(400).json({ error: "refreshToken required" });
      }
      const parsed = parseRefreshToken(refreshToken);
      if (!parsed) {
        return res.status(401).json({ error: "Invalid refresh token" });
      }

      const [row] = await db.select().from(authSessions).where(eq(authSessions.id, parsed.sessionId)).limit(1);
      if (!row) {
        return res.status(401).json({ error: "Invalid refresh token" });
      }

      // Architect re-review pass-3 hardening: bcrypt-verify the secret
      // BEFORE any reuse/cascade logic. Otherwise possession of a known
      // sessionId alone (e.g., from logs) could force an account-wide
      // logout (DoS) and trigger false-positive compromise events.
      // Cascade only fires when the presented secret PROVES possession.
      const secretMatches = await bcrypt.compare(parsed.secret, row.refreshTokenHash);
      if (!secretMatches) {
        return res.status(401).json({ error: "Invalid refresh token" });
      }

      // Reuse detection: a secret that matches a REVOKED row's hash is
      // proof of theft (or the legit client failed to update; either way
      // we treat the account as compromised). Revoke every active session.
      if (row.revokedAt) {
        await db.update(authSessions).set({ revokedAt: new Date(), revokeReason: "reuse_detected_cascade" })
          .where(and(eq(authSessions.accountId, row.accountId), isNull(authSessions.revokedAt)));
        console.warn(`[Auth] SECURITY_REFRESH_REUSE | account=${row.accountId} | sessionId=${row.id} | device=${row.deviceFingerprint}`);
        return res.status(401).json({ error: "SECURITY_REFRESH_REUSE", message: "Refresh token reuse detected. All sessions revoked." });
      }

      // Age check.
      if (Date.now() - row.issuedAt.getTime() > REFRESH_TOKEN_TTL_MS) {
        await db.update(authSessions).set({ revokedAt: new Date(), revokeReason: "expired" }).where(eq(authSessions.id, row.id));
        return res.status(401).json({ error: "Refresh token expired" });
      }

      // Look up the user (for email payload).
      const [user] = await db.select().from(users).where(eq(users.id, row.userId)).limit(1);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }

      // Mark the old session revoked (keep row for reuse detection) and
      // issue a new one for the same device.
      await db.update(authSessions).set({ revokedAt: new Date(), revokeReason: "rotated_refresh" }).where(eq(authSessions.id, row.id));
      const session = await issueSessionForDevice({
        userId: user.id,
        accountId: row.accountId,
        deviceFingerprint: String(deviceFingerprint || row.deviceFingerprint || "default"),
      });
      const accessToken = generateAccessToken(user.id, user.email || "", row.accountId);

      res.json({
        token: accessToken,
        refreshToken: session.refreshToken,
        refreshTokenExpiresAt: session.expiresAt.toISOString(),
      });
    } catch (error) {
      console.error("[Auth] Refresh error:", error);
      res.status(500).json({ error: "Refresh failed" });
    }
  });

  // ─── Seal #2 (Task #20) F9.8 — explicit logout revokes the device session ─
  app.post("/api/auth/logout", async (req: AuthRequest, res: Response) => {
    try {
      const { refreshToken } = req.body || {};
      if (refreshToken && typeof refreshToken === "string") {
        const parsed = parseRefreshToken(refreshToken);
        if (parsed) {
          // Architect APPROVED_WITH_COMMENTS hardening: verify the refresh
          // secret BEFORE revoking. Otherwise possession of a sessionId
          // alone (e.g., from logs) would be enough to revoke a user's
          // session — a session-revocation oracle and minor DoS vector.
          // We silently no-op on mismatch; logout still returns 200 so
          // the client UX is unchanged.
          const [row] = await db.select().from(authSessions)
            .where(eq(authSessions.id, parsed.sessionId)).limit(1);
          if (row && !row.revokedAt) {
            const ok = await bcrypt.compare(parsed.secret, row.refreshTokenHash);
            if (ok) {
              await db.update(authSessions).set({ revokedAt: new Date(), revokeReason: "logout" })
                .where(and(eq(authSessions.id, parsed.sessionId), isNull(authSessions.revokedAt)));
            }
          }
        }
      }
      res.json({ success: true });
    } catch (error) {
      console.error("[Auth] Logout error:", error);
      res.status(500).json({ error: "Logout failed" });
    }
  });

  app.get("/api/auth/me", async (req: AuthRequest, res: Response) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const payload = verifyToken(authHeader.slice(7));
    if (!payload) {
      return res.status(401).json({ error: "Invalid token" });
    }

    try {
      const [user] = await db.select().from(users).where(eq(users.id, payload.userId)).limit(1);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const now = new Date();
      const isTrialActive = user.trialEnd ? now < user.trialEnd : false;
      const status = user.subscriptionStatus === "active" ? "active" :
                     isTrialActive ? "trial" : "expired";

      res.json({
        user: {
          id: user.id,
          email: user.email,
          name: user.email?.split("@")[0] || "User",
          subscriptionStatus: status,
          planType: user.planType || "trial",
          videoCredits: user.videoCredits ?? 0,
          trialEnd: user.trialEnd?.toISOString() || null,
          hasSeenIntro: user.hasSeenIntro ?? false,
          accountId: user.accountId || user.id,
          isAdmin: ADMIN_ACCOUNT_IDS.has(user.accountId || user.id),
        },
      });
    } catch (error) {
      console.error("[Auth] Me error:", error);
      res.status(500).json({ error: "Failed to fetch user" });
    }
  });

  app.post("/api/auth/seen-intro", async (req: AuthRequest, res: Response) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const payload = verifyToken(authHeader.slice(7));
    if (!payload) {
      return res.status(401).json({ error: "Invalid token" });
    }

    try {
      await db.update(users).set({ hasSeenIntro: true }).where(eq(users.id, payload.userId));
      res.json({ success: true });
    } catch (error) {
      console.error("[Auth] Seen intro error:", error);
      res.status(500).json({ error: "Failed to update" });
    }
  });

  app.post("/api/onboarding/track", async (req: AuthRequest, res: Response) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const payload = verifyToken(authHeader.slice(7));
    if (!payload) {
      return res.status(401).json({ error: "Invalid token" });
    }

    const { event, ...data } = req.body;
    console.log(`[Onboarding] ${event} | user=${payload.userId}`, JSON.stringify(data));
    res.json({ success: true });
  });

  app.post("/api/stripe/webhook", async (req: Request, res: Response) => {
    try {
      // P1-3 (launch-closure W4): no JWT_SECRET fallback. Production refuses
      // to boot without STRIPE_WEBHOOK_SECRET (see top-of-file guard); dev
      // requires the dedicated secret too. JWT_SECRET is for session signing
      // and must not double as a payments-mutation key.
      if (!STRIPE_WEBHOOK_SECRET) {
        console.warn("[Stripe] Webhook rejected: STRIPE_WEBHOOK_SECRET not configured");
        return res.status(503).json({ error: "Webhook secret not configured" });
      }
      const sig = req.headers["x-webhook-secret"] || req.headers["stripe-signature"];
      if (sig !== STRIPE_WEBHOOK_SECRET) {
        console.warn("[Stripe] Webhook rejected: invalid signature");
        return res.status(403).json({ error: "Forbidden" });
      }

      const { userId, status, plan, addCredits } = req.body;
      if (!userId) {
        return res.status(400).json({ error: "Missing userId" });
      }

      const validStatuses = ["active", "expired"];
      const safeStatus = validStatuses.includes(status) ? status : "active";

      const PLAN_VIDEO_CREDITS: Record<string, number> = {
        growth: 2,
        ultra: 5,
      };

      const updateData: Record<string, any> = {
        subscriptionStatus: safeStatus,
      };

      if (safeStatus === "active") {
        updateData.planType = "paid";

        if (plan && PLAN_VIDEO_CREDITS[plan]) {
          updateData.videoCredits = PLAN_VIDEO_CREDITS[plan];
        }
      }

      if (typeof addCredits === "number" && addCredits > 0) {
        await db.update(users).set({
          ...updateData,
          videoCredits: sql`COALESCE(${users.videoCredits}, 0) + ${addCredits}`,
        }).where(eq(users.id, userId));
      } else {
        await db.update(users).set(updateData).where(eq(users.id, userId));
      }

      console.log(`[Conversion] Payment confirmed for user ${userId} — status: ${safeStatus}, plan: ${plan || "none"}, addCredits: ${addCredits || 0}`);
      res.json({ success: true });
    } catch (error) {
      console.error("[Stripe] Webhook error:", error);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  });

  app.get("/api/auth/subscription-status", async (req: AuthRequest, res: Response) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const payload = verifyToken(authHeader.slice(7));
    if (!payload) {
      return res.status(401).json({ error: "Invalid token" });
    }

    try {
      const [user] = await db.select().from(users).where(eq(users.id, payload.userId)).limit(1);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const now = new Date();
      const isTrialActive = user.trialEnd ? now < user.trialEnd : false;
      const trialDaysRemaining = user.trialEnd
        ? Math.max(0, Math.ceil((user.trialEnd.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)))
        : 0;

      const status = user.subscriptionStatus === "active" ? "active" :
                     isTrialActive ? "trial" : "expired";

      if (status === "expired") {
        console.log(`[Conversion] User ${payload.userId} (${user.email}) reached upgrade screen — trial expired`);
      }

      res.json({
        status,
        trialEnd: user.trialEnd?.toISOString() || null,
        trialDaysRemaining,
        isActive: status === "active" || status === "trial",
        videoCredits: user.videoCredits ?? 0,
      });
    } catch (error) {
      console.error("[Auth] Subscription status error:", error);
      res.status(500).json({ error: "Failed to check status" });
    }
  });
}
