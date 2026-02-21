import type { Express } from "express";
import { registerGateRoutes } from "./gate-routes";
import { registerExtractionRoutes } from "./extraction-routes";
import { registerConfirmRoutes } from "./confirm-routes";
import { registerThinkingRoutes } from "./thinking-routes";
import { registerValidationRoutes } from "./validation-routes";
import { registerOrchestratorRoutes } from "./orchestrator-routes";
import { registerDemoRoutes } from "./demo-routes";

export function registerStrategicCoreRoutes(app: Express) {
  registerGateRoutes(app);
  registerExtractionRoutes(app);
  registerConfirmRoutes(app);
  registerThinkingRoutes(app);
  registerValidationRoutes(app);
  registerOrchestratorRoutes(app);
  registerDemoRoutes(app);
}
