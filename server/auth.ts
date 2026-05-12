import { Router, Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db } from "./db";
import { users } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
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

function generateToken(userId: string, email: string, accountId: string): string {
  return jwt.sign({ userId, email, accountId } as JwtPayload, JWT_SECRET, { expiresIn: "14d" });
}

function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
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

export function registerAuthRoutes(app: Router) {
  app.post("/api/auth/register", authRateLimit, async (req: Request, res: Response) => {
    try {
      const { email, password, name } = req.body;

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

      const passwordHash = await bcrypt.hash(password, 12);
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

      const token = generateToken(newUser.id, emailLower, userAccountId);

      res.status(201).json({
        token,
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
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
      }

      const emailLower = email.toLowerCase().trim();

      const [user] = await db.select().from(users).where(eq(users.email, emailLower)).limit(1);
      if (!user) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      const validPassword = await bcrypt.compare(password, user.password);
      if (!validPassword) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      const userAccountId = user.accountId || user.id;
      if (!user.accountId) {
        await db.update(users).set({ accountId: userAccountId }).where(eq(users.id, user.id));
      }

      await featureFlagService.seedDefaultFlags(userAccountId).catch(err =>
        console.error("[Auth] Failed to seed default flags on login:", err)
      );

      const token = generateToken(user.id, emailLower, userAccountId);

      const now = new Date();
      const isTrialActive = user.trialEnd ? now < user.trialEnd : false;
      const status = user.subscriptionStatus === "active" ? "active" :
                     isTrialActive ? "trial" : "expired";

      res.json({
        token,
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
