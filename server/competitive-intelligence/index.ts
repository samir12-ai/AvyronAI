import type { Express } from "express";
import { registerCiCompetitorRoutes } from "./competitor-routes";
import { registerDataAcquisitionRoutes } from "./data-acquisition-routes";
import { registerReviewsTiktokRoutes } from "./reviews-tiktok-routes";

export function registerCompetitiveIntelligenceRoutes(app: Express) {
  registerCiCompetitorRoutes(app);
  registerDataAcquisitionRoutes(app);
  registerReviewsTiktokRoutes(app);
}
