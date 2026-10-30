/**
 * AVYRON DEMO ENVIRONMENT — Server-Side Isolation & Safety Configuration
 *
 * Enforces strict server-side verification before any demo seed, reset, or
 * simulated scenario transition can execute:
 *   1. `AVYRON_DEMO_MODE=1` must be set on the server.
 *   2. `DATABASE_URL` must point exclusively to the designated isolated Neon
 *      demo branch (`ep-autumn-pine-askk1p5v-pooler.c-4.eu-central-1.aws.neon.tech`)
 *      and NEVER to the shared/production branch.
 *   3. All demo operations are strictly scoped to the synthetic demo account
 *      (`acc_demo_zeytun_400g`) and campaign (`camp_demo_zeytun_400g`).
 */

export const DEMO_DB_HOST =
  "ep-autumn-pine-askk1p5v-pooler.c-4.eu-central-1.aws.neon.tech";
export const FORBIDDEN_PROD_DB_HOST =
  "ep-twilight-night-asou49te-pooler.c-4.eu-central-1.aws.neon.tech";

export const DEMO_USER_ID = "user_demo_zeytun_400g";
export const DEMO_ACCOUNT_ID = "acc_demo_zeytun_400g";
export const DEMO_CAMPAIGN_ID = "camp_demo_zeytun_400g";
export const DEMO_USER_EMAIL = "demo@zeytunatelier.example";
export const DEMO_USER_NAME = "Zeytun Atelier (Demo)";

export const DEMO_BRAND_NAME = "Zeytun Atelier";
export const DEMO_OFFERING_NAME =
  "Antep Pistachio Baklava & Kadayif Assortment Box (400g)";
export const DEMO_WEBSITE_URL = "https://zeytun-atelier.demo.invalid";

export type DemoScenarioState =
  | "READY_TO_GENERATE"
  | "GENERATION"
  | "STRATEGY_READY"
  | "MARKET_CHANGE_DETECTED"
  | "INVESTIGATION_AND_RESPONSE"
  | "SIMULATED_FOLLOW_UP";

export const DEMO_SCENARIO_ORDER: DemoScenarioState[] = [
  "READY_TO_GENERATE",
  "GENERATION",
  "STRATEGY_READY",
  "MARKET_CHANGE_DETECTED",
  "INVESTIGATION_AND_RESPONSE",
  "SIMULATED_FOLLOW_UP",
];

export const DEMO_SCENARIO_META: Record<
  DemoScenarioState,
  {
    code: string;
    label: string;
    shortLabel: string;
    description: string;
    recommendedRoute: string;
  }
> = {
  READY_TO_GENERATE: {
    code: "A",
    label: "A. Ready to Generate",
    shortLabel: "A · Ready",
    description:
      "Business setup complete for Zeytun Atelier 400g Assortment Box ($32 USD, $4,500/mo budget). Ready to trigger strategy generation.",
    recommendedRoute: "/(tabs)/strategy-plan",
  },
  GENERATION: {
    code: "B",
    label: "B. Simulated Generation",
    shortLabel: "B · Generating",
    description:
      "Deterministic 15-stage orchestrator run in progress with believable stage transitions and zero external LLM/scraper calls.",
    recommendedRoute: "/(tabs)/strategy-plan",
  },
  STRATEGY_READY: {
    code: "C",
    label: "C. Strategy Ready",
    shortLabel: "C · Strategy v1",
    description:
      "Complete v1 strategy generated across Market Intelligence, Customer Voice, Audience, Differentiation, Positioning, Offer, Funnel, and Budget. Ready for interactive approval.",
    recommendedRoute: "/(tabs)/strategy-plan",
  },
  MARKET_CHANGE_DETECTED: {
    code: "D",
    label: "D. Recording Baseline (10 Events · 5 Perf Cases · 3 Pending Scenarios)",
    shortLabel: "D · Recording Ready",
    description:
      "Recording-ready baseline: Strategy v1 Approved, 10 Watchtower events populated, 5 historical Performance Loop cases populated, and 3 strategic scenarios ready for user-clicked Deep Reasoning & approval.",
    recommendedRoute: "/(tabs)/watchtower",
  },
  INVESTIGATION_AND_RESPONSE: {
    code: "E",
    label: "E. Investigation & Response (3 Scenarios Investigated)",
    shortLabel: "E · Reasoning",
    description:
      "Opens Deep Reasoning investigations for the 3 strategic Watchtower scenarios with prepared BEFORE/AFTER strategy patch previews awaiting user approval.",
    recommendedRoute: "/(tabs)/reasoning-evidence",
  },
  SIMULATED_FOLLOW_UP: {
    code: "F",
    label: "F. Simulated Follow-Up",
    shortLabel: "F · Follow-Up",
    description:
      "Post-adaptation observation window after applying strategy changes. Performance Loop and Monthly Report reflect applied patches with clearly labeled simulated telemetry.",
    recommendedRoute: "/(tabs)/performance",
  },
};

export function isDemoMode(): boolean {
  return process.env.AVYRON_DEMO_MODE === "1";
}

export interface DemoEnvVerification {
  demoMode: boolean;
  dbHost: string;
  dbName: string;
  accountId: string;
  campaignId: string;
  isolated: boolean;
}

/**
 * Fail-closed verification that the process is running in `AVYRON_DEMO_MODE=1`
 * AND connected exclusively to the isolated Neon demo database branch.
 * Never logs or returns credentials.
 */
export function assertDemoEnvironmentSafe(): DemoEnvVerification {
  if (!isDemoMode()) {
    throw new Error(
      "DEMO_GUARD_REJECTED: AVYRON_DEMO_MODE=1 is required on the server for demo operations.",
    );
  }

  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) {
    throw new Error("DEMO_GUARD_REJECTED: DATABASE_URL is not set.");
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("DEMO_GUARD_REJECTED: DATABASE_URL is not a valid URL.");
  }

  const host = parsed.hostname.toLowerCase();
  const expectedHost = (
    process.env.AVYRON_DEMO_DB_HOST || DEMO_DB_HOST
  ).toLowerCase();

  if (host === FORBIDDEN_PROD_DB_HOST.toLowerCase()) {
    throw new Error(
      `DEMO_GUARD_FATAL: Refusing to run demo against shared/production DB host (${host}).`,
    );
  }

  if (host !== expectedHost) {
    throw new Error(
      `DEMO_GUARD_FATAL: Database host "${host}" does not match expected isolated demo branch "${expectedHost}".`,
    );
  }

  const dbName = parsed.pathname.replace(/^\//, "") || "neondb";

  return {
    demoMode: true,
    dbHost: host,
    dbName,
    accountId: DEMO_ACCOUNT_ID,
    campaignId: DEMO_CAMPAIGN_ID,
    isolated: true,
  };
}
