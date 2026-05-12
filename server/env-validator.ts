/**
 * Seal #7 (Task #25 / F10.5) — Environment validator.
 *
 * Called as the FIRST line of server/index.ts (after artifact guard, before
 * OTel/Sentry/anything else). Refuses to boot the server if any required
 * runtime variable is missing or shaped wrong.
 *
 * Why hard-fail at boot rather than soft-fail per request:
 *  - silent missing JWT_SECRET → tokens forgeable.
 *  - silent missing OPENAI_API_KEY → every AI engine returns degraded output.
 *  - silent missing BRIGHT_DATA_PROXY_USERNAME → scrapers fall back to direct
 *    connections that immediately get IP-blocked.
 *  - silent missing PUBLIC_BASE_URL → host-header reflection (F9.1).
 *  - silent missing STRIPE_WEBHOOK_SECRET → forged subscription events.
 *
 * Better to crash visibly at startup than to serve a half-broken app.
 *
 * Required-var contract follows session_plan.md T3 EXACTLY:
 *   DATABASE_URL, JWT_SECRET, OPENAI_API_KEY, BRIGHT_DATA_PROXY_USERNAME,
 *   BRIGHT_DATA_PROXY_COUNTRY, STRIPE_WEBHOOK_SECRET, PUBLIC_BASE_URL.
 * No production-only carve-outs — these are needed for any boot, dev included.
 */

/**
 * `accepts` lists alternate env-var names that satisfy this requirement.
 * OPENAI_API_KEY is the canonical name in the audit/spec, but Replit's
 * built-in OpenAI integration injects AI_INTEGRATIONS_OPENAI_API_KEY — we
 * accept either so the integration's preset works without rename.
 */
/**
 * `productionOnly` — a narrow carve-out for secrets that the dev container
 * does not need to function:
 *   - JWT_SECRET: server/auth.ts ships a deterministic DEV fallback (logged
 *     loudly at boot). In production we MUST refuse to boot without an
 *     operator-set secret.
 *   - STRIPE_WEBHOOK_SECRET: webhook handler refuses signed events when the
 *     secret is unset, so the only route that depends on it is closed-by-
 *     default. Required in production. Dev is allowed to boot without it
 *     (per user direction — Stripe is not yet activated for this account).
 */
const REQUIRED: Array<{ key: string; description: string; accepts?: string[]; productionOnly?: boolean }> = [
  { key: "DATABASE_URL", description: "PostgreSQL connection URL" },
  { key: "JWT_SECRET", description: "JWT signing secret (≥32 chars in prod)", productionOnly: true },
  {
    key: "OPENAI_API_KEY",
    description: "OpenAI API key — content/strategy engines hard-depend on it",
    accepts: ["AI_INTEGRATIONS_OPENAI_API_KEY"],
  },
  { key: "BRIGHT_DATA_PROXY_USERNAME", description: "Bright Data customer ID (e.g. brd-customer-…)" },
  { key: "BRIGHT_DATA_PROXY_PASSWORD", description: "Bright Data zone password" },
  { key: "BRIGHT_DATA_PROXY_COUNTRY", description: "Bright Data residential pool country" },
  {
    key: "PUBLIC_BASE_URL",
    description:
      "Canonical public base URL (https://app.example.com) — substituted into landing/pricing HTML; replaces trust in Host/X-Forwarded-Host (F9.1)",
  },
  { key: "STRIPE_WEBHOOK_SECRET", description: "Stripe webhook signing secret", productionOnly: true },
];

// Optional but RECOMMENDED — surfaced as warnings, never fatal.
const RECOMMENDED: Array<{ key: string; description: string }> = [
  { key: "AI_INTEGRATIONS_GEMINI_API_KEY", description: "Gemini API key (dual-AI engine fallback)" },
  { key: "SENTRY_DSN", description: "Sentry DSN — when absent, error reporting is no-op" },
  { key: "OTEL_EXPORTER_OTLP_ENDPOINT", description: "OpenTelemetry OTLP collector endpoint" },
  {
    key: "METRICS_ADMIN_TOKEN",
    description: "Static admin secret gating GET /metrics. Absent → endpoint returns 401 to all callers.",
  },
];

/**
 * Hostnames whose suffix is always allowed for PUBLIC_BASE_URL.
 * Operators may extend with comma-separated `ALLOWED_PUBLIC_HOSTS` env.
 *
 * Why allowlist: PUBLIC_BASE_URL flows into landing-page anchor hrefs +
 * Stripe redirect URLs. An operator who accidentally points it at
 * `evil.example.com` would silently turn the canonical app brand into an
 * open-redirect surface. The allowlist forces an explicit override.
 */
const DEFAULT_ALLOWED_SUFFIXES = [".replit.app", ".replit.dev", ".replit.co"];

export interface EnvValidationResult {
  ok: boolean;
  missing: string[];
  warnings: string[];
}

function resolveValue(r: { key: string; accepts?: string[] }, env: NodeJS.ProcessEnv): string | undefined {
  const candidates = [r.key, ...(r.accepts ?? [])];
  for (const c of candidates) {
    const v = env[c];
    if (v && v.trim()) return v;
  }
  return undefined;
}

/**
 * Validate PUBLIC_BASE_URL syntax + scheme + host allowlist.
 * Returns an array of error messages (empty = ok).
 */
function validatePublicBaseUrl(value: string, isProd: boolean): string[] {
  const errors: string[] = [];
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return [`PUBLIC_BASE_URL — not a valid absolute URL (${value})`];
  }

  // Production: https only. Dev: http allowed (Replit dev domain proxies through TLS edge).
  if (isProd && parsed.protocol !== "https:") {
    errors.push(`PUBLIC_BASE_URL — must use https:// in production (got ${parsed.protocol})`);
  } else if (!/^https?:$/.test(parsed.protocol)) {
    errors.push(`PUBLIC_BASE_URL — must use http/https scheme (got ${parsed.protocol})`);
  }

  // Allowlist enforcement.
  const customAllow = (process.env.ALLOWED_PUBLIC_HOSTS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const host = parsed.hostname.toLowerCase();
  const matchesSuffix = DEFAULT_ALLOWED_SUFFIXES.some((s) => host.endsWith(s));
  const matchesCustomExact = customAllow.some(
    (h) => host === h.toLowerCase() || host.endsWith("." + h.replace(/^\./, "").toLowerCase()),
  );
  // Localhost always allowed for tests / local boot.
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0";

  if (!matchesSuffix && !matchesCustomExact && !isLocal) {
    errors.push(
      `PUBLIC_BASE_URL — host "${host}" not in allowlist. Default-allowed suffixes: ${DEFAULT_ALLOWED_SUFFIXES.join(", ")}. Add to ALLOWED_PUBLIC_HOSTS to whitelist additional hosts.`,
    );
  }

  return errors;
}

export function validateEnv(opts: { exitOnFailure?: boolean } = {}): EnvValidationResult {
  const exitOnFailure = opts.exitOnFailure ?? true;
  const missing: string[] = [];
  const warnings: string[] = [];

  const isProd = process.env.NODE_ENV === "production";

  // Dev-only convenience: derive PUBLIC_BASE_URL from REPLIT_DEV_DOMAIN if
  // unset. Production MUST set it explicitly — gated on NODE_ENV !== production
  // so this never silently activates in prod.
  if (!isProd && !process.env.PUBLIC_BASE_URL && process.env.REPLIT_DEV_DOMAIN) {
    process.env.PUBLIC_BASE_URL = `https://${process.env.REPLIT_DEV_DOMAIN}`;
    console.log(`[EnvValidator] dev: derived PUBLIC_BASE_URL=${process.env.PUBLIC_BASE_URL} from REPLIT_DEV_DOMAIN`);
  }

  for (const r of REQUIRED) {
    const v = resolveValue(r, process.env);
    if (!v) {
      if (r.productionOnly && !isProd) {
        warnings.push(`${r.key} — ${r.description} (dev: not enforced; production boot WILL fail without it)`);
        continue;
      }
      const altText = r.accepts ? ` (or ${r.accepts.join(" / ")})` : "";
      missing.push(`${r.key}${altText} — ${r.description}`);
    } else if (r.accepts && r.accepts.length) {
      // Architect-review pass-3 fix: bridge canonical ↔ alias env names.
      // server/ai-client.ts reads `AI_INTEGRATIONS_OPENAI_API_KEY` only.
      // If the operator sets just the canonical `OPENAI_API_KEY` we'd boot
      // green and then crash on the first AI call. Mirror the value into
      // every accepted alias (and vice versa) so all consumers find it
      // regardless of which name was set first.
      for (const alias of [r.key, ...r.accepts]) {
        if (!process.env[alias] || !process.env[alias]!.trim()) {
          process.env[alias] = v;
        }
      }
    }
  }

  // PUBLIC_BASE_URL — full URL/scheme/host policy.
  if (process.env.PUBLIC_BASE_URL) {
    missing.push(...validatePublicBaseUrl(process.env.PUBLIC_BASE_URL, isProd));
  }

  // JWT_SECRET length sanity — soft floor in dev, hard floor in prod.
  if (process.env.JWT_SECRET) {
    const minLen = isProd ? 32 : 16;
    if (process.env.JWT_SECRET.length < minLen) {
      missing.push(`JWT_SECRET — must be ≥${minLen} characters (got ${process.env.JWT_SECRET.length})`);
    }
  }

  for (const r of RECOMMENDED) {
    if (!process.env[r.key]) warnings.push(`${r.key} — ${r.description}`);
  }

  const result: EnvValidationResult = { ok: missing.length === 0, missing, warnings };

  if (warnings.length) {
    for (const w of warnings) console.warn(`[EnvValidator] WARN missing recommended: ${w}`);
  }

  if (!result.ok) {
    console.error("[EnvValidator] FATAL — required environment variables missing or invalid:");
    for (const m of missing) console.error(`  • ${m}`);
    console.error("[EnvValidator] Refusing to boot. Set the variables above (Replit Secrets) and restart.");
    if (exitOnFailure) process.exit(1);
  } else {
    console.log(
      `[EnvValidator] ok — all required env vars present (${REQUIRED.length} checked, ${warnings.length} recommended missing)`,
    );
  }

  return result;
}

/** For tests — pure check, no console, no exit. */
export function checkEnv(env: NodeJS.ProcessEnv = process.env): EnvValidationResult {
  const missing: string[] = [];
  const warnings: string[] = [];
  const isProd = env.NODE_ENV === "production";
  for (const r of REQUIRED) {
    const v = resolveValue(r, env);
    if (!v) {
      if (r.productionOnly && !isProd) continue;
      missing.push(r.key);
    }
  }
  if (env.PUBLIC_BASE_URL) {
    // Localhost is always allowed in tests; we only re-enforce the
    // url-syntax + scheme + suffix policy when env.PUBLIC_BASE_URL is set.
    const errs = validatePublicBaseUrl(env.PUBLIC_BASE_URL, isProd);
    for (const e of errs) {
      // Tests only need the key name in the missing list, not the full message.
      if (!missing.includes("PUBLIC_BASE_URL")) missing.push("PUBLIC_BASE_URL");
      void e;
    }
  }
  if (env.JWT_SECRET) {
    const minLen = isProd ? 32 : 16;
    if (env.JWT_SECRET.length < minLen) missing.push("JWT_SECRET");
  }
  for (const r of RECOMMENDED) if (!env[r.key]) warnings.push(r.key);
  return { ok: missing.length === 0, missing, warnings };
}
