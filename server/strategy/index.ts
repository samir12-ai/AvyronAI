import type { Express } from "express";
import { registerStatisticalValidationRoutes } from "./statistical-validation/routes";
import { registerBudgetGovernorRoutes } from "./budget-governor/routes";
import { registerChannelSelectionRoutes } from "./channel-selection/routes";
import { registerIterationEngineRoutes } from "./iteration-engine/routes";
import { registerRetentionEngineRoutes } from "./retention-engine/routes";

export function registerStrategyEngineRoutes(app: Express): void {
  registerStatisticalValidationRoutes(app);
  registerBudgetGovernorRoutes(app);
  registerChannelSelectionRoutes(app);
  registerIterationEngineRoutes(app);
  registerRetentionEngineRoutes(app);

  console.log("[Strategy-V3] All 5 Fortress engines registered: StatisticalValidation, BudgetGovernor, ChannelSelection, Iteration, Retention");
}
