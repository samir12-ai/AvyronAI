/**
 * CLI Seed & Reset Utility for the Isolated Avyron Demo Environment
 *
 * Usage:
 *   npm run demo:seed [STATE]
 *
 * Supported States:
 *   READY_TO_GENERATE          (State A)
 *   GENERATION                 (State B)
 *   STRATEGY_READY             (State C - default)
 *   MARKET_CHANGE_DETECTED     (State D)
 *   INVESTIGATION_AND_RESPONSE (State E)
 *   SIMULATED_FOLLOW_UP        (State F)
 */

import "../server/demo/enable-demo-env";
import "../server/bootstrap";
import {
  assertDemoEnvironmentSafe,
  DEMO_ACCOUNT_ID,
  DEMO_CAMPAIGN_ID,
  DEMO_SCENARIO_META,
  DemoScenarioState,
} from "../server/demo/config";
import { applyDemoScenarioState, getDemoStatus } from "../server/demo/scenario-service";

async function main() {
  assertDemoEnvironmentSafe();

  const arg = (process.argv[2] || "STRATEGY_READY").toUpperCase().trim() as DemoScenarioState;
  const validStates = Object.keys(DEMO_SCENARIO_META) as DemoScenarioState[];

  const targetState: DemoScenarioState = validStates.includes(arg) ? arg : "STRATEGY_READY";

  const dbUrl = process.env.DATABASE_URL || "";
  const hostMatch = dbUrl.match(/@([^:/?#]+)/);
  const dbHost = hostMatch ? hostMatch[1] : "unknown";

  console.log("===============================================================");
  console.log(" AVYRON ISOLATED DEMO SEEDER");
  console.log("===============================================================");
  console.log(` Database Host : ${dbHost}`);
  console.log(` Demo Account  : ${DEMO_ACCOUNT_ID}`);
  console.log(` Demo Campaign : ${DEMO_CAMPAIGN_ID}`);
  console.log(` Target State  : ${DEMO_SCENARIO_META[targetState].label}`);
  console.log("---------------------------------------------------------------");

  await applyDemoScenarioState(targetState);
  const status = await getDemoStatus();

  console.log(" Seed Complete!");
  console.log(` Current State : ${status.currentState} (${status.scenarioMeta.label})`);
  console.log(` Plan Status   : ${status.planStatus || "NONE"} (v${status.planVersion || 0})`);
  console.log(` Root Version  : ${status.activeRootVersion ? `v${status.activeRootVersion}` : "NONE"}`);
  console.log("===============================================================");
  process.exit(0);
}

main().catch((err) => {
  console.error("[DEMO-SEED] Fatal error:", err);
  process.exit(1);
});
