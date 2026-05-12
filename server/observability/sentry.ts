/**
 * Seal #7 (Task #25 / F10.8) — Optional Sentry wrapper.
 *
 * If SENTRY_DSN is unset, every method is a no-op — no boot cost, no
 * background workers, no transitive dependencies pulled. This is the
 * default in development.
 *
 * If SENTRY_DSN is set AND `@sentry/node` is installed, we dynamic-import
 * it. We do NOT add @sentry/node to package.json by default because most
 * dev environments don't need it — operators add it before they set the
 * DSN. If the import fails we log once and continue — Sentry must NEVER
 * be the reason the server crashes.
 */
import { logger } from "../logger";

interface SentryLike {
  init(opts: Record<string, unknown>): void;
  captureException(err: unknown, ctx?: Record<string, unknown>): void;
  captureMessage(msg: string, level?: "fatal" | "error" | "warning" | "info" | "debug"): void;
  setTag(key: string, value: string): void;
  setUser(user: { id?: string; email?: string } | null): void;
  flush(timeoutMs?: number): Promise<boolean>;
}

let sentry: SentryLike | null = null;
let initAttempted = false;

export async function initSentry(): Promise<void> {
  if (initAttempted) return;
  initAttempted = true;

  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) {
    logger.info({ component: "sentry" }, "SENTRY_DSN not set — error reporting disabled (no-op)");
    return;
  }

  try {
    // @ts-ignore — optional runtime dependency. If missing we no-op gracefully.
    const mod = await import("@sentry/node").catch(() => null);
    if (!mod) {
      logger.warn(
        { component: "sentry" },
        "SENTRY_DSN is set but @sentry/node is not installed — install it to enable error reporting",
      );
      return;
    }
    sentry = mod as unknown as SentryLike;
    sentry.init({
      dsn,
      environment: process.env.NODE_ENV || "development",
      tracesSampleRate: 0,
      release: process.env.RELEASE_VERSION,
    });
    logger.info({ component: "sentry" }, "Sentry initialized");
  } catch (err) {
    logger.error({ component: "sentry", err: String(err) }, "Sentry initialization failed — continuing");
    sentry = null;
  }
}

export function captureException(err: unknown, ctx?: Record<string, unknown>): void {
  if (!sentry) return;
  try { sentry.captureException(err, ctx); } catch { /* never throw from telemetry */ }
}

export function captureMessage(msg: string, level: "fatal" | "error" | "warning" | "info" | "debug" = "info"): void {
  if (!sentry) return;
  try { sentry.captureMessage(msg, level); } catch { /* never throw from telemetry */ }
}

export function setTag(key: string, value: string): void {
  if (!sentry) return;
  try { sentry.setTag(key, value); } catch { /* swallow */ }
}

export function isSentryEnabled(): boolean {
  return sentry !== null;
}

export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!sentry) return;
  try { await sentry.flush(timeoutMs); } catch { /* swallow */ }
}
