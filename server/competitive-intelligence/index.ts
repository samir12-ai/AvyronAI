import type { Express } from "express";
import { registerCiCompetitorRoutes } from "./competitor-routes";
import { registerCiAnalysisRoutes } from "./analysis-routes";
import { registerCiDemoRoutes } from "./demo-routes";

export function registerCompetitiveIntelligenceRoutes(app: Express) {
  registerCiCompetitorRoutes(app);
  registerCiAnalysisRoutes(app);
  registerCiDemoRoutes(app);
}
