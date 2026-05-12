/**
 * Seal #7 (Task #25 / F10.6, F9.5) — Structured logger.
 *
 * In-house pino-compatible facade. JSON lines on stdout. Every record carries
 * a traceId (taken from the request, propagated to AI client + worker tick
 * via the AsyncLocalStorage in ./trace-context.ts).
 *
 * F9.5 — token-shaped fields are STRIPPED before serialization. The
 * truncation step in setupRequestLogging used to capture the full response
 * JSON (including new tokens, refresh tokens, password reset secrets) into
 * an 80-character console line — secrets routinely landed in proxy logs +
 * crash reports.
 *
 * Why in-house instead of pulling pino:
 *  - patch-package + react-native-reanimated patches make adding any
 *    runtime npm dep risky (postinstall must succeed).
 *  - 80 LOC + a stable JSON contract is enough for our needs and ships
 *    today. We can swap to real pino later — the API surface
 *    (info/warn/error/debug/child) is intentionally pino-shaped.
 */
import { traceContext } from "./trace-context";

const TOKEN_KEY_RE = /^(token|refreshToken|refresh_token|accessToken|access_token|secret|apiKey|api_key|authorization|cookie|password|passwordHash|password_hash|jwt|sessionToken|session_token|refreshTokenHash|refresh_token_hash)$/i;
const REDACTED = "[REDACTED]";
const MAX_DEPTH = 6;

/**
 * Inline secret patterns scanned in every string value (architect-review
 * follow-up for F9.5). Catches tokens that arrive in error messages, stack
 * frames, query strings, or arbitrary log payloads where the surrounding key
 * isn't itself secret-shaped.
 *
 *  - `Bearer <opaque>` — Authorization-header echoes
 *  - `sk-...` / `sk_live_...` / `pk_live_...` — OpenAI + Stripe key shapes
 *  - `eyJ...eyJ...` — JWT triple-segment
 *  - `xoxb-...` / `xoxp-...` — Slack bot/user tokens
 *  - `ghp_...` / `gho_...` / `ghu_...` / `ghs_...` / `ghr_...` — GitHub PATs
 *  - `AIza[0-9A-Za-z_-]{35}` — Google API keys
 */
const INLINE_SECRET_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._\-+/=]{8,}/gi,
  /\b(?:sk|pk|rk)_(?:test|live)_[A-Za-z0-9]{16,}/g,
  /\bsk-[A-Za-z0-9_\-]{20,}/g,
  /\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{8,}/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bAIza[0-9A-Za-z_\-]{30,}/g,
];

/**
 * Scrub inline secret patterns from a string. Replaces matches with
 * `[REDACTED-INLINE]` so existing line structure (offsets, surrounding text)
 * remains debuggable.
 */
export function scrubInlineSecrets(s: string): string {
  if (!s || typeof s !== "string") return s;
  let out = s;
  for (const pat of INLINE_SECRET_PATTERNS) {
    out = out.replace(pat, "[REDACTED-INLINE]");
  }
  return out;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel: LogLevel =
  (process.env.LOG_LEVEL as LogLevel) ||
  (process.env.NODE_ENV === "production" ? "info" : "debug");

/**
 * Recursively walk an object and replace any value whose key matches a
 * token-shaped name with [REDACTED]. Bounded by MAX_DEPTH to avoid
 * pathological cycles. Arrays are walked element-wise. Strings/numbers/
 * booleans are returned as-is.
 */
export function stripSecrets(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth >= MAX_DEPTH) return "[MAX_DEPTH]";
  if (typeof value === "string") return scrubInlineSecrets(value);
  if (Array.isArray(value)) return value.map((v) => stripSecrets(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (TOKEN_KEY_RE.test(k)) {
        out[k] = REDACTED;
      } else {
        out[k] = stripSecrets(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

export interface Logger {
  debug(obj: object | string, msg?: string): void;
  info(obj: object | string, msg?: string): void;
  warn(obj: object | string, msg?: string): void;
  error(obj: object | string, msg?: string): void;
  child(bindings: Record<string, unknown>): Logger;
}

function emit(level: LogLevel, bindings: Record<string, unknown>, objOrMsg: object | string, msg?: string): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[minLevel]) return;
  const traceId = traceContext.getStore()?.traceId;
  let obj: Record<string, unknown> = {};
  let message: string | undefined;
  if (typeof objOrMsg === "string") {
    message = objOrMsg;
  } else if (objOrMsg) {
    obj = objOrMsg as Record<string, unknown>;
    message = msg;
  } else {
    message = msg;
  }
  const record: Record<string, unknown> = {
    level,
    time: new Date().toISOString(),
    ...(traceId ? { traceId } : {}),
    ...bindings,
    ...(stripSecrets(obj) as Record<string, unknown>),
    ...(message ? { msg: message } : {}),
  };
  // Use stderr for error/warn so structured logs don't pollute response capture
  // and so log-shippers can split on stream.
  const line = JSON.stringify(record);
  if (level === "error" || level === "warn") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}

function makeLogger(bindings: Record<string, unknown>): Logger {
  return {
    debug: (o, m) => emit("debug", bindings, o, m),
    info: (o, m) => emit("info", bindings, o, m),
    warn: (o, m) => emit("warn", bindings, o, m),
    error: (o, m) => emit("error", bindings, o, m),
    child: (extra) => makeLogger({ ...bindings, ...extra }),
  };
}

export const logger: Logger = makeLogger({});

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      traceId?: string;
      requestId?: string;
      logger?: Logger;
    }
  }
}

/**
 * Express middleware: mints a traceId per request, stores it in
 * AsyncLocalStorage, and attaches a request-scoped child logger to req.
 */
export function loggerMiddleware() {
  return (req: any, _res: any, next: any) => {
    const traceId = `tr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    req.traceId = traceId;
    req.logger = logger.child({ traceId, route: req.path });
    traceContext.run({ traceId }, () => next());
  };
}
