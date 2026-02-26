import type { Express } from "express";
import { registerCiCompetitorRoutes } from "./competitor-routes";
import { registerCiAnalysisRoutes } from "./analysis-routes";
import { registerDominanceRoutes } from "./dominance-routes";

export function registerCompetitiveIntelligenceRoutes(app: Express) {
  registerCiCompetitorRoutes(app);
  registerCiAnalysisRoutes(app);
  registerDominanceRoutes(app);
}
