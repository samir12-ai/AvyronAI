import type { Express } from "express";
import { registerMIv3Routes } from "./routes";

export function registerMarketIntelligenceV3(app: Express) {
  registerMIv3Routes(app);
  console.log("[MIv3] Market Intelligence V3 routes registered");
}

export { MarketIntelligenceV3 } from "./engine";
export { validateEngineIsolation, assertNoPlanWrites, assertNoOrchestrator, assertNoAutopilot } from "./engine";
export * from "./types";
export * from "./constants";
