import type { Express } from "express";
import { featureFlagService, type LeadEngineModule } from "../feature-flags";

const VALID_FLAGS: LeadEngineModule[] = [
  "lead_capture_enabled", "cta_engine_enabled", "conversion_tracking_enabled",
  "funnel_logic_enabled", "lead_magnet_enabled", "landing_pages_enabled",
  "revenue_attribution_enabled", "ai_lead_optimization_enabled", "lead_engine_global_off",
  "competitive_intelligence_enabled",
];

export function registerFeatureFlagRoutes(app: Express) {
  app.get("/api/feature-flags", async (req, res) => {
    try {
      const accountId = (req.query.accountId as string) || "default";
      const flags = await featureFlagService.getAllFlags(accountId);
      res.json({ flags });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/feature-flags/:flagName", async (req, res) => {
    try {
      const flagName = req.params.flagName as LeadEngineModule;
      if (!VALID_FLAGS.includes(flagName)) {
        return res.status(400).json({ error: `Invalid flag name: ${flagName}` });
      }
      const { enabled, accountId, userId, reason } = req.body;
      if (typeof enabled !== "boolean") {
        return res.status(400).json({ error: "enabled must be a boolean" });
      }
      await featureFlagService.setFlag(flagName, enabled, accountId || "default", userId, reason);
      const flags = await featureFlagService.getAllFlags(accountId || "default");
      res.json({ success: true, flags });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/feature-flags/audit", async (req, res) => {
    try {
      const accountId = (req.query.accountId as string) || "default";
      const limit = parseInt(req.query.limit as string) || 50;
      const history = await featureFlagService.getFlagAuditHistory(accountId, limit);
      res.json({ history });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/feature-flags/global-kill", async (req, res) => {
    try {
      const { accountId, userId, reason } = req.body;
      await featureFlagService.setFlag("lead_engine_global_off", true, accountId || "default", userId, reason || "Emergency global kill switch activated");
      res.json({ success: true, message: "Lead engine globally disabled" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/feature-flags/global-resume", async (req, res) => {
    try {
      const { accountId, userId, reason } = req.body;
      await featureFlagService.setFlag("lead_engine_global_off", false, accountId || "default", userId, reason || "Global kill switch deactivated");
      res.json({ success: true, message: "Lead engine globally re-enabled" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
