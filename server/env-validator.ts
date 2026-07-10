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
 *  - silent missing PUBLIC_BASE_URL → host-header reflection (F9.1).
 *  - silent missing STRIPE_WEBHOOK_SECRET → forged subscription events.
 *
 * Better to crash visibly at startup than to serve a half-broken app.
 *
 * Bright Data (2026-07 Unlocker rebuild) is deliberately NOT in REQUIRED:
 * scraping is designed to run SAFE-OFF (SCRAPING_UNCONFIGURED fail-fast)
 * when BRIGHT_DATA_API_KEY + BRIGHT_DATA_ZONE are absent. The contract is
 * all-or-nothing: setting exactly one of the pair IS boot-fatal (a
 * half-configured transport would look configured to operators while every
 * request fails), and a malformed BRIGHT_DATA_COUNTRY is boot-fatal
 * (geo-targeting must never silently no-op — B1/B2).
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
 *     operator-set secret. SESSION_SECRET (a Replit-provisioned random
 *     secret) is accepted as an alias signing key — it satisfies the same
 *     unforgeability requirement (random, operator-scoped, never derived
 *     from public identifiers like REPL_ID).
 *   - STRIPE_WEBHOOK_SECRET: webhook handler refuses signed events when the
 *     secret is unset, so the only route that depends on it is closed-by-
 *     default (fail-closed). Downgraded from production-fatal to RECOMMENDED
 *     (2026-07-08, per user direction — Stripe is not yet activated for this
 *     account; subscriptions stay disabled until the secret is set).
 */
const REQUIRED: Array<{ key: string; description: string; accepts?: string[]; productionOnly?: boolean }> = [
  { key: "DATABASE_URL", description: "PostgreSQL connection URL" },
  {
    key: "JWT_SECRET",
    description: "JWT signing secret (≥32 chars in prod)",
    accepts: ["SESSION_SECRET"],
    productionOnly: true,
  },
  {
    key: "OPENAI_API_KEY",
    description: "OpenAI API key — content/strategy engines hard-depend on it",
    accepts: ["AI_INTEGRATIONS_OPENAI_API_KEY"],
  },
  {
    key: "PUBLIC_BASE_URL",
    description:
      "Canonical public base URL (https://app.example.com) — substituted into landing/pricing HTML; replaces trust in Host/X-Forwarded-Host (F9.1)",
  },
];

// Optional but RECOMMENDED — surfaced as warnings, never fatal.
const RECOMMENDED: Array<{ key: string; description: string }> = [
  {
    key: "STRIPE_WEBHOOK_SECRET",
    description:
      "Stripe webhook signing secret — until set, incoming Stripe webhook events are rejected (fail-closed) and subscription sync stays disabled",
  },
  { key: "AI_INTEGRATIONS_GEMINI_API_KEY", description: "Gemini API key (dual-AI engine fallback)" },
  { key: "SENTRY_DSN", description: "Sentry DSN — when absent, error reporting is no-op" },
  { key: "OTEL_EXPORTER_OTLP_ENDPOINT", description: "OpenTelemetry OTLP collector endpoint" },
  {
    key: "METRICS_ADMIN_TOKEN",
    description: "Static admin secret gating GET /metrics and /healthz/* infrastructure endpoints. Infrastructure-only; does NOT grant access to product-admin /api/admin/* routes.",
  },
  {
    key: "OPERATOR_ADMIN_TOKEN",
    description: "Static admin secret gating /api/admin/* product-operator endpoints (continuity panel, replay cassettes, operator notices, operations panel). Separate from METRICS_ADMIN_TOKEN — infrastructure callers must NOT hold this token.",
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

/** Legacy proxy-tunnel vars superseded by the 2026-07 Unlocker API rebuild. */
const LEGACY_BRIGHT_DATA_KEYS = [
  "BRIGHT_DATA_PROXY_USERNAME",
  "BRIGHT_DATA_PROXY_PASSWORD",
  "BRIGHT_DATA_PROXY_HOST",
  "BRIGHT_DATA_PROXY_PORT",
  "BRIGHT_DATA_PROXY_COUNTRY",
];

/**
 * 2026-07 Unlocker rebuild — Bright Data env contract.
 *
 *   both BRIGHT_DATA_API_KEY + BRIGHT_DATA_ZONE set  → configured (ok)
 *   both missing                                     → SAFE-OFF (warn only;
 *       every scrape fails fast as SCRAPING_UNCONFIGURED — never boot-fatal)
 *   exactly one set                                  → BOOT-FATAL (half-
 *       configured transport looks "configured" while every request fails)
 *   BRIGHT_DATA_COUNTRY set but not 2-letter ISO     → BOOT-FATAL (geo
 *       targeting must never silently no-op)
 *   any legacy BRIGHT_DATA_PROXY_* still set         → warn (ignored)
 */
export function validateBrightDataContract(env: NodeJS.ProcessEnv): { fatal: string[]; warns: string[] } {
  const fatal: string[] = [];
  const warns: string[] = [];
  const apiKey = env.BRIGHT_DATA_API_KEY?.trim();
  const zone = env.BRIGHT_DATA_ZONE?.trim();
  const country = env.BRIGHT_DATA_COUNTRY?.trim();

  if (apiKey && !zone) {
    fatal.push(
      "BRIGHT_DATA_ZONE — BRIGHT_DATA_API_KEY is set but BRIGHT_DATA_ZONE is missing. The pair is all-or-nothing: set both to enable scraping, or unset both to run scraping safe-off (SCRAPING_UNCONFIGURED).",
    );
  } else if (!apiKey && zone) {
    fatal.push(
      "BRIGHT_DATA_API_KEY — BRIGHT_DATA_ZONE is set but BRIGHT_DATA_API_KEY is missing. The pair is all-or-nothing: set both to enable scraping, or unset both to run scraping safe-off (SCRAPING_UNCONFIGURED).",
    );
  } else if (!apiKey && !zone) {
    warns.push(
      "BRIGHT_DATA_API_KEY / BRIGHT_DATA_ZONE — not set. Scraping is SAFE-OFF: every scrape request fails fast as SCRAPING_UNCONFIGURED until both are set (Bright Data Unlocker API).",
    );
  }

  if (country && !/^[a-zA-Z]{2}$/.test(country)) {
    fatal.push(
      `BRIGHT_DATA_COUNTRY — "${country}" is not a 2-letter ISO-3166 code (e.g. "us", "ae"). Fix or unset it (optional; when unset the zone's server-side geo policy applies).`,
    );
  }

  // Optional SERP API zone — restores Google review TEXTS (unavailable on the
  // Unlocker zone). Shares BRIGHT_DATA_API_KEY. Never boot-fatal: unset → the
  // reviews scraper stays truthfully degraded (GOOGLE_RAW_HTML_UNSUPPORTED).
  const serpZone = env.BRIGHT_DATA_SERP_ZONE?.trim();
  if (serpZone && !apiKey) {
    warns.push(
      "BRIGHT_DATA_SERP_ZONE — set, but BRIGHT_DATA_API_KEY is missing. The SERP zone shares the account Bearer key; without it, Google review-text scraping cannot run. Set BRIGHT_DATA_API_KEY.",
    );
  }

  const legacySet = LEGACY_BRIGHT_DATA_KEYS.filter((k) => env[k]?.trim());
  if (legacySet.length) {
    warns.push(
      `${legacySet.join(", ")} — legacy Bright Data proxy-tunnel variable(s) are IGNORED since the 2026-07 Unlocker API rebuild. Remove them; the live contract is BRIGHT_DATA_API_KEY + BRIGHT_DATA_ZONE (+ optional BRIGHT_DATA_COUNTRY).`,
    );
  }

  return { fatal, warns };
}

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

  // Captured BEFORE the alias-mirror loop below overwrites JWT_SECRET.
  const jwtSecretWasAliased = !process.env.JWT_SECRET?.trim() && !!process.env.SESSION_SECRET?.trim();

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

  // 2026-07 Unlocker rebuild — Bright Data env contract (all-or-nothing
  // pair, safe-off when absent, malformed country fatal, legacy vars warned).
  {
    const bd = validateBrightDataContract(process.env);
    missing.push(...bd.fatal);
    warnings.push(...bd.warns);
  }

  // JWT signing secret length sanity — soft floor in dev, hard floor in prod.
  // Checks whichever source will actually sign tokens (JWT_SECRET, falling
  // back to the SESSION_SECRET alias — same order as server/auth.ts).
  // NOTE: by this point the alias-mirror loop above may have copied
  // SESSION_SECRET into JWT_SECRET, so `jwtSecretWasAliased` (captured before
  // the loop) is the source of truth for operator visibility — the auth.ts
  // warning never fires in a real boot because the mirror runs first (B2:
  // visibility over silence).
  if (jwtSecretWasAliased) {
    console.warn(
      "[EnvValidator] JWT_SECRET not set — SESSION_SECRET is being used as the JWT signing key (accepted alias). Set a dedicated JWT_SECRET when possible; changing either value invalidates existing sessions.",
    );
  }
  const jwtSigningSource = process.env.JWT_SECRET ? "JWT_SECRET" : process.env.SESSION_SECRET ? "SESSION_SECRET" : null;
  const jwtSigningValue = process.env.JWT_SECRET || process.env.SESSION_SECRET;
  if (jwtSigningSource && jwtSigningValue) {
    const minLen = isProd ? 32 : 16;
    if (jwtSigningValue.length < minLen) {
      missing.push(
        `${jwtSigningSource} (JWT signing secret) — must be ≥${minLen} characters (got ${jwtSigningValue.length})`,
      );
    }
  }

  for (const r of RECOMMENDED) {
    if (!process.env[r.key]) warnings.push(`${r.key} — ${r.description}`);
  }

  const result: EnvValidationResult = { ok: missing.length === 0, missing, warnings };

  if (warnings.length) {
    for (const w of warnings) console.warn(`[EnvValidator] WARN missing recommended: ${w}`);
  }

  // Task #54 — log active values of the GR19–GR23 beta operator knobs so the
  // operator can confirm the cap layer is wired correctly at boot.
  // Unset values are reported as "disabled" rather than warnings — these
  // caps are intentionally off in dev.
  const betaKnobs: Array<{ key: string; description: string }> = [
    { key: "BETA_ADMISSIONS_FROZEN", description: "GR19 — freeze new account signups (503)" },
    { key: "BETA_ACCOUNT_CAP", description: "GR20 — max active beta accounts" },
    { key: "AI_DAILY_SPEND_CAP_USD_PER_ACCOUNT", description: "GR21 — per-account daily AI spend cap (USD)" },
    { key: "SCRAPE_DAILY_VOLUME_CAP_PER_ACCOUNT", description: "GR22 — per-account daily scrape volume cap" },
    { key: "MI_QUEUE_DEPTH_DEFER_THRESHOLD", description: "GR23 — global MI queue depth defer threshold" },
  ];
  for (const k of betaKnobs) {
    const v = process.env[k.key];
    if (v && v.trim()) {
      console.log(`[EnvValidator] beta-knob ${k.key}=${v} (${k.description})`);
    } else {
      console.log(`[EnvValidator] beta-knob ${k.key}=<unset> — disabled (${k.description})`);
    }
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
  // Mirror of validateEnv's Bright Data contract — key names only.
  {
    const bd = validateBrightDataContract(env);
    for (const f of bd.fatal) missing.push(f.split(" ")[0]);
    for (const w of bd.warns) warnings.push(w.split(" ")[0]);
  }
  for (const r of RECOMMENDED) if (!env[r.key]) warnings.push(r.key);
  return { ok: missing.length === 0, missing, warnings };
}
