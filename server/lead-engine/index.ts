import type { Express } from "express";
import { registerFeatureFlagRoutes } from "./feature-flag-routes";
import { registerLeadCaptureRoutes } from "./lead-capture-routes";
import { registerConversionTrackingRoutes } from "./conversion-tracking-routes";
import { registerCtaEngineRoutes } from "./cta-engine-routes";
import { registerFunnelLogicRoutes } from "./funnel-logic-routes";
import { registerLeadMagnetRoutes } from "./lead-magnet-routes";
import { registerLandingPageRoutes } from "./landing-page-routes";
import { registerRevenueAttributionRoutes } from "./revenue-attribution-routes";
import { registerAiLeadOptimizationRoutes } from "./ai-lead-optimization-routes";

export function registerLeadEngineRoutes(app: Express) {
  registerFeatureFlagRoutes(app);
  registerLeadCaptureRoutes(app);
  registerConversionTrackingRoutes(app);
  registerCtaEngineRoutes(app);
  registerFunnelLogicRoutes(app);
  registerLeadMagnetRoutes(app);
  registerLandingPageRoutes(app);
  registerRevenueAttributionRoutes(app);
  registerAiLeadOptimizationRoutes(app);
}
