import type { Express, Request, Response } from "express";
import { registerStatisticalValidationRoutes } from "./statistical-validation/routes";
import { registerBudgetGovernorRoutes } from "./budget-governor/routes";
import { registerChannelSelectionRoutes } from "./channel-selection/routes";
import { registerIterationEngineRoutes } from "./iteration-engine/routes";
import { registerRetentionEngineRoutes } from "./retention-engine/routes";
import { getSystemHealth, validateAllEngines, enforceEngineIsolation } from "./dependency-validation";

export function registerStrategyEngineRoutes(app: Express): void {
  registerStatisticalValidationRoutes(app);
  registerBudgetGovernorRoutes(app);
  registerChannelSelectionRoutes(app);
  registerIterationEngineRoutes(app);
  registerRetentionEngineRoutes(app);

  app.get("/api/system/health", (_req: Request, res: Response) => {
    try {
      const health = getSystemHealth();
      const validation = validateAllEngines();

      res.json({
        success: true,
        healthy: health.healthy && validation.valid,
        engines: health.engines,
        isolationRules: health.isolationRules,
        validationResults: validation.results,
        timestamp: health.timestamp,
      });
    } catch (error: any) {
      console.error("[SystemHealth] Health check failed:", error);
      res.status(500).json({ error: "System health check failed" });
    }
  });

  app.post("/api/system/validate-isolation", (req: Request, res: Response) => {
    try {
      const { sourceEngine, targetField, action } = req.body;
      if (!sourceEngine || !targetField || !action) {
        return res.status(400).json({ error: "sourceEngine, targetField, and action are required" });
      }
      const result = enforceEngineIsolation(sourceEngine, targetField, action);
      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error("[SystemHealth] Isolation validation failed:", error);
      res.status(500).json({ error: "Isolation validation failed" });
    }
  });

  const startupValidation = validateAllEngines();
  if (!startupValidation.valid) {
    console.error("[Strategy-V3] STARTUP WARNING: Engine dependency validation failed");
    for (const r of startupValidation.results) {
      if (!r.valid) {
        console.error(`  → ${r.engine} v${r.currentVersion}: ${r.mismatches.join("; ")}`);
      }
    }
  }

  const health = getSystemHealth();
  console.log(`[Strategy-V3] All 5 Fortress engines registered: StatisticalValidation, BudgetGovernor, ChannelSelection, Iteration, Retention`);
  console.log(`[Strategy-V3] Engine versions: ${Object.entries(health.engines).map(([name, info]) => `${name}=v${info.version}`).join(", ")}`);
  console.log(`[Strategy-V3] Cross-engine isolation: ${health.isolationRules} rules active | System healthy: ${health.healthy}`);
}
