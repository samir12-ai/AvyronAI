import type { Express } from "express";
import { registerMIv3Routes } from "./routes";
import { registerAdminMarketRoutes } from "./admin-routes";
import { startQueueProcessor } from "./fetch-orchestrator";

export function registerMarketIntelligenceV3(app: Express) {
  registerMIv3Routes(app);
  registerAdminMarketRoutes(app);
  startQueueProcessor();
  console.log("[MIv3] Market Intelligence V3 routes registered + Admin routes + Queue Processor started");
}

export { MarketIntelligenceV3 } from "./engine";
export { validateEngineIsolation, assertNoPlanWrites, assertNoOrchestrator, assertNoAutopilot } from "./engine";
export * from "./types";
export * from "./constants";
