import { Express, Request, Response } from "express";
import {
  enforcePositioningCompliance,
  enforceGenericEngineCompliance,
  buildCELReport,
  extractDominantCausalThemes,
  getCachedCELReport,
  CAUSAL_CONSTRAINT_RULES,
} from "./engine";
import { getCachedAEL } from "../analytical-enrichment-layer/routes";
import { getLatestPositioningSnapshot } from "../positioning-engine/engine";

const LOG_PREFIX = "[CEL-Routes]";

export function registerCELRoutes(app: Express) {
  app.get("/api/cel/report/:campaignId", async (req: Request, res: Response) => {
    try {
      const { campaignId } = req.params;
      const accountId = (req.query.accountId as string) || "default";

      const ael = getCachedAEL(campaignId);
      if (!ael) {
        return res.json({
          success: false,
          message: "No cached AEL data available. Run the analysis pipeline first.",
          report: null,
        });
      }

      const { themes, primaryTheme, rootCauseTexts } = extractDominantCausalThemes(ael);

      const cachedReport = getCachedCELReport(campaignId);
      if (cachedReport && cachedReport.engineResults.length > 0) {
        return res.json({
          success: true,
          report: cachedReport,
          source: "orchestrator",
          causalThemes: {
            themes,
            primaryTheme,
            rootCauseCount: rootCauseTexts.length,
            activeRules: themes.map(t => {
              const rule = CAUSAL_CONSTRAINT_RULES.find(r => r.id === t);
              return rule ? { id: rule.id, description: rule.description } : null;
            }).filter(Boolean),
          },
        });
      }

      const results = [];
      const posSnapshot = await getLatestPositioningSnapshot(accountId, campaignId);
      if (posSnapshot && posSnapshot.territories) {
        const territories = Array.isArray(posSnapshot.territories) ? posSnapshot.territories : [];
        const posCompliance = enforcePositioningCompliance(territories, ael);
        results.push(posCompliance);
      }

      const report = buildCELReport(campaignId, ael.version || 2, results);

      return res.json({
        success: true,
        report,
        source: results.length > 0 ? "on-demand" : "no-engines",
        causalThemes: {
          themes,
          primaryTheme,
          rootCauseCount: rootCauseTexts.length,
          activeRules: themes.map(t => {
            const rule = CAUSAL_CONSTRAINT_RULES.find(r => r.id === t);
            return rule ? { id: rule.id, description: rule.description } : null;
          }).filter(Boolean),
        },
      });
    } catch (err: any) {
      console.error(`${LOG_PREFIX} REPORT_ERROR | ${err.message}`);
      return res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/cel/rules", (_req: Request, res: Response) => {
    res.json({
      rules: CAUSAL_CONSTRAINT_RULES.map(r => ({
        id: r.id,
        description: r.description,
        rootCausePattern: r.rootCausePattern.source,
        requiredCount: r.requiredAxisPatterns.length,
        blockedCount: r.blockedAxisPatterns.length,
      })),
      totalRules: CAUSAL_CONSTRAINT_RULES.length,
    });
  });

  console.log(`${LOG_PREFIX} Routes registered: GET /api/cel/report/:campaignId, GET /api/cel/rules | constraintRules=${CAUSAL_CONSTRAINT_RULES.length}`);
}
