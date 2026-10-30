import type { Express } from "express";
import { registerMIv3Routes } from "./routes";
import { registerAdminMarketRoutes } from "./admin-routes";
import { startQueueProcessor } from "./fetch-orchestrator";

export function registerMarketIntelligenceV3(app: Express) {
  registerMIv3Routes(app);
  registerAdminMarketRoutes(app);
  if (
    process.env.AVYRON_DEMO_MODE === "1" ||
    process.env.DISABLE_BACKGROUND_WORKERS === "1" ||
    process.env.INSPECTION_MODE === "1"
  ) {
    console.log("[MIv3] Market Intelligence V3 routes registered (Queue Processor skipped in Demo/Inspection Mode)");
  } else {
    startQueueProcessor();
    console.log("[MIv3] Market Intelligence V3 routes registered + Admin routes + Queue Processor started");
  }
}

export { MarketIntelligenceV3 } from "./engine";
export { validateEngineIsolation, assertNoPlanWrites, assertNoOrchestrator, assertNoAutopilot } from "./engine";
export { invalidateStaleSnapshots } from "./engine-state";
export * from "./types";
export * from "./constants";
