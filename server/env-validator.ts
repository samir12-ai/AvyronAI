/**
 * Seal #7 (Task #25 / F10.5) — Environment validator.
 *
 * Called as the FIRST line of server/index.ts (after artifact guard, before
 * OTel/Sentry/anything else). Refuses to boot the server if any required
 * runtime variable is missing or shaped wrong.
 *
 * Why hard-fail at boot rather than soft-fail per request:
 *  - silent missing JWT_SECRET → tokens forgeable.
 *  - silent missing BRIGHT_DATA_PROXY_USERNAME → scrapers fall back to direct
 *    connections that immediately get IP-blocked.
 *  - silent missing PUBLIC_BASE_URL → host-header reflection (F9.1).
 *  - silent missing STRIPE_WEBHOOK_SECRET → forged subscription events.
 *
 * Better to crash visibly at startup than to serve a half-broken app.
 */
const REQUIRED: Array<{ key: string; description: string; productionOnly?: boolean }> = [
  { key: "DATABASE_URL", description: "PostgreSQL connection URL" },
  { key: "JWT_SECRET", description: "JWT signing secret (≥32 chars)", productionOnly: true },
  { key: "BRIGHT_DATA_PROXY_USERNAME", description: "Bright Data customer ID (e.g. brd-customer-…)" },
  { key: "BRIGHT_DATA_PROXY_PASSWORD", description: "Bright Data zone password" },
  { key: "BRIGHT_DATA_PROXY_COUNTRY", description: "Bright Data residential pool country" },
  { key: "PUBLIC_BASE_URL", description: "Canonical public base URL (https://app.example.com) — substituted into landing/pricing HTML; replaces trust in Host/X-Forwarded-Host (F9.1)" },
  { key: "STRIPE_WEBHOOK_SECRET", description: "Stripe webhook signing secret", productionOnly: true },
];

// Optional but RECOMMENDED — surfaced as warnings, never fatal.
const RECOMMENDED: Array<{ key: string; description: string }> = [
  { key: "AI_INTEGRATIONS_OPENAI_API_KEY", description: "OpenAI API key (otherwise content engines run in stub mode)" },
  { key: "AI_INTEGRATIONS_GEMINI_API_KEY", description: "Gemini API key (dual-AI engine fallback)" },
  { key: "SENTRY_DSN", description: "Sentry DSN — when absent, error reporting is no-op" },
  { key: "OTEL_EXPORTER_OTLP_ENDPOINT", description: "OpenTelemetry OTLP collector endpoint" },
];

export interface EnvValidationResult {
  ok: boolean;
  missing: string[];
  warnings: string[];
}

export function validateEnv(opts: { exitOnFailure?: boolean } = {}): EnvValidationResult {
  const exitOnFailure = opts.exitOnFailure ?? true;
  const missing: string[] = [];
  const warnings: string[] = [];

  const isProd = process.env.NODE_ENV === "production";

  // Dev-only convenience: derive PUBLIC_BASE_URL from REPLIT_DEV_DOMAIN if
  // unset. Production MUST set it explicitly — the derivation is gated on
  // NODE_ENV !== production so this never silently activates in prod.
  if (!isProd && !process.env.PUBLIC_BASE_URL && process.env.REPLIT_DEV_DOMAIN) {
    process.env.PUBLIC_BASE_URL = `https://${process.env.REPLIT_DEV_DOMAIN}`;
    console.log(`[EnvValidator] dev: derived PUBLIC_BASE_URL=${process.env.PUBLIC_BASE_URL} from REPLIT_DEV_DOMAIN`);
  }

  for (const r of REQUIRED) {
    if (r.productionOnly && !isProd) continue;
    const v = process.env[r.key];
    if (!v || !v.trim()) {
      missing.push(`${r.key} — ${r.description}`);
    }
  }

  // PUBLIC_BASE_URL must be a syntactically-valid absolute URL.
  if (process.env.PUBLIC_BASE_URL) {
    try {
      const u = new URL(process.env.PUBLIC_BASE_URL);
      if (!/^https?:$/.test(u.protocol)) {
        missing.push(`PUBLIC_BASE_URL — must use http/https scheme (got ${u.protocol})`);
      }
    } catch {
      missing.push(`PUBLIC_BASE_URL — not a valid absolute URL (${process.env.PUBLIC_BASE_URL})`);
    }
  }

  // JWT_SECRET length sanity in production.
  if (isProd && process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
    missing.push("JWT_SECRET — must be ≥32 characters in production");
  }

  for (const r of RECOMMENDED) {
    if (!process.env[r.key]) warnings.push(`${r.key} — ${r.description}`);
  }

  const result: EnvValidationResult = { ok: missing.length === 0, missing, warnings };

  if (warnings.length) {
    for (const w of warnings) console.warn(`[EnvValidator] WARN missing recommended: ${w}`);
  }

  if (!result.ok) {
    console.error("[EnvValidator] FATAL — required environment variables missing:");
    for (const m of missing) console.error(`  • ${m}`);
    console.error("[EnvValidator] Refusing to boot. Set the variables above (Replit Secrets) and restart.");
    if (exitOnFailure) process.exit(1);
  } else {
    console.log(`[EnvValidator] ok — all required env vars present (${REQUIRED.filter(r => !r.productionOnly || isProd).length} checked, ${warnings.length} recommended missing)`);
  }

  return result;
}

/** For tests — pure check, no console, no exit. */
export function checkEnv(env: NodeJS.ProcessEnv = process.env): EnvValidationResult {
  const prevEnv = process.env;
  try {
    process.env = env;
    const missing: string[] = [];
    const warnings: string[] = [];
    const isProd = env.NODE_ENV === "production";
    for (const r of REQUIRED) {
      if (r.productionOnly && !isProd) continue;
      const v = env[r.key];
      if (!v || !v.trim()) missing.push(r.key);
    }
    if (env.PUBLIC_BASE_URL) {
      try {
        const u = new URL(env.PUBLIC_BASE_URL);
        if (!/^https?:$/.test(u.protocol)) missing.push("PUBLIC_BASE_URL");
      } catch { missing.push("PUBLIC_BASE_URL"); }
    }
    if (isProd && env.JWT_SECRET && env.JWT_SECRET.length < 32) missing.push("JWT_SECRET");
    for (const r of RECOMMENDED) if (!env[r.key]) warnings.push(r.key);
    return { ok: missing.length === 0, missing, warnings };
  } finally {
    process.env = prevEnv;
  }
}
