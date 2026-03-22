import type { Express, Request, Response } from "express";
import { aiChat } from "../ai-client";
import { db } from "../db";
import { strategicBlueprints } from "@shared/schema";
import { eq } from "drizzle-orm";
import { logAuditEvent } from "./audit-logger";
import { cleanJsonString } from "./extraction-routes";

function buildFallbackValidation(): any {
  return {
    contradictions: [],
    offerClarity: { score: 0, issues: ["Validation could not be completed"], suggestions: ["Please retry validation"] },
    pricePositioning: { alignment: "partially_aligned", details: "Could not determine", suggestion: "Retry validation" },
    audienceOfferFit: { score: 0, issues: ["Validation incomplete"] },
    ctaFunnelAlignment: { aligned: false, details: "Validation could not determine alignment" },
    campaignAlignment: { aligned: false, objective: "unknown", details: "Validation incomplete" },
    strategicWeaknesses: [],
    riskScore: 50,
    confidenceScore: 0,
    overallAssessment: "weak",
    canProceed: false,
    warnings: ["Validation engine returned unparseable output. Results shown are defaults — please retry."],
  };
}

const VALIDATION_PROMPT = `You are a strategic validation engine. Your job is to detect contradictions, evaluate strategic coherence, and flag risks in a campaign blueprint.

CRITICAL: You are validating the CONFIRMED BLUEPRINT only. This is the user-approved source of truth. Do not reference or consider any draft data.

You must check for:
1. CONTRADICTIONS: e.g., "premium" positioning + heavy discount, "awareness" funnel + hard-sell CTA, luxury tone + bargain pricing
2. OFFER CLARITY: Is the offer specific, measurable, and compelling?
3. PRICE POSITIONING: Does the price align with the positioning strategy?
4. AUDIENCE-OFFER FIT: Does the offer match the target audience?
5. CTA-FUNNEL ALIGNMENT: Does the CTA match the funnel stage?
6. COMPETITIVE VIABILITY: Based on market map, is the strategy defensible?
7. CAMPAIGN-STRATEGY ALIGNMENT: Does the strategy align with the campaign objective?

Respond with ONLY a valid JSON object:
{
  "contradictions": [
    {
      "type": "string",
      "description": "string",
      "severity": "low|medium|high|critical",
      "fields": ["string"]
    }
  ],
  "offerClarity": {
    "score": 0-100,
    "issues": ["string"],
    "suggestions": ["string"]
  },
  "pricePositioning": {
    "alignment": "aligned|misaligned|partially_aligned",
    "details": "string",
    "suggestion": "string"
  },
  "audienceOfferFit": {
    "score": 0-100,
    "issues": ["string"]
  },
  "ctaFunnelAlignment": {
    "aligned": true|false,
    "details": "string"
  },
  "campaignAlignment": {
    "aligned": true|false,
    "objective": "string",
    "details": "string"
  },
  "strategicWeaknesses": [
    {
      "weakness": "string",
      "impact": "low|medium|high",
      "recommendation": "string"
    }
  ],
  "riskScore": 0-100,
  "confidenceScore": 0-100,
  "overallAssessment": "strong|moderate|weak|critical",
  "canProceed": true|false,
  "warnings": ["string"]
}`;

export function registerValidationRoutes(app: Express) {
  app.post("/api/strategic/blueprint/:id/validate", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const [blueprint] = await db.select().from(strategicBlueprints).where(eq(strategicBlueprints.id, id)).limit(1);
      if (!blueprint) {
        return res.status(404).json({ error: "Blueprint not found" });
      }

      if (!["CONFIRMED", "ANALYSIS_COMPLETE", "VALIDATED"].includes(blueprint.status)) {
        return res.status(400).json({
          success: false,
          error: "STATUS_GATE",
          message: "Blueprint must complete analysis (Phase 3) before validation can run.",
          currentStatus: blueprint.status,
        });
      }

      if (!blueprint.marketMap) {
        return res.status(400).json({
          success: false,
          error: "ANALYSIS_REQUIRED",
          message: "Market analysis (Phase 3) must be completed before validation. Please run analysis first.",
          currentStatus: blueprint.status,
        });
      }

      const confirmedBlueprint = blueprint.confirmedBlueprint ? JSON.parse(blueprint.confirmedBlueprint) : null;
      if (!confirmedBlueprint) {
        return res.status(400).json({ error: "No confirmed blueprint data. Confirmed blueprint is the only source of truth." });
      }

      if (confirmedBlueprint.blueprintVersion !== blueprint.blueprintVersion) {
        return res.status(400).json({
          error: "VERSION_MISMATCH",
          message: "Confirmed blueprint version does not match current blueprint version. Re-confirm required.",
          confirmedVersion: confirmedBlueprint.blueprintVersion,
          currentVersion: blueprint.blueprintVersion,
        });
      }

      const campaignContext = blueprint.campaignContext ? JSON.parse(blueprint.campaignContext) : null;
      if (!campaignContext) {
        return res.status(400).json({
          error: "CAMPAIGN_CONTEXT_REQUIRED",
          message: "No campaign context — Validation cannot run without campaign context.",
        });
      }

      const marketMap = blueprint.marketMap ? JSON.parse(blueprint.marketMap) : null;

      const userPrompt = `Validate this campaign strategy. Use ONLY the confirmed blueprint (v${blueprint.blueprintVersion}) as source of truth.

CAMPAIGN CONTEXT:
- Campaign: ${campaignContext.campaignName}
- Objective: ${campaignContext.objective}
- Location: ${campaignContext.location || "Not specified"}
- Platform: ${campaignContext.platform}
- Mode: PRODUCTION

CONFIRMED BLUEPRINT (v${blueprint.blueprintVersion} — source of truth):
${JSON.stringify(confirmedBlueprint, null, 2)}

AVERAGE SELLING PRICE: $${blueprint.averageSellingPrice || "unknown"}

${marketMap ? `MARKET MAP:\n${JSON.stringify(marketMap, null, 2)}` : "MARKET MAP: Not yet generated"}

Perform full validation now.`;

      const response = await aiChat({
        model: "gpt-5.2",
        messages: [
          { role: "system", content: VALIDATION_PROMPT },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 2500,
        accountId: (req as any).accountId || "default",
        endpoint: "strategic-validation",
      });

      const rawText = response.choices[0]?.message?.content || "";
      const finishReason = response.choices[0]?.finish_reason || "";
      const usage = response.usage;
      console.log(`[StrategicCore] Validation | Model: gpt-5.2 | Tokens: in=${usage?.prompt_tokens ?? "?"}, out=${usage?.completion_tokens ?? "?"}, total=${usage?.total_tokens ?? "?"} | Finish: ${finishReason}`);

      if (finishReason === "length") {
        console.warn("[StrategicCore] WARNING: Validation response was truncated (finish_reason=length)");
      }

      let validationResult: any;
      let usedFallback = false;

      try {
        const cleaned = cleanJsonString(rawText);
        validationResult = JSON.parse(cleaned);
      } catch (parseErr: any) {
        console.error("[StrategicCore] Validation parse failed:", parseErr.message);
        console.error("[StrategicCore] Raw validation text (first 500):", rawText.substring(0, 500));
        validationResult = buildFallbackValidation();
        validationResult.warnings.push(`Parse error: ${parseErr.message}`);
        usedFallback = true;
      }

      validationResult.blueprintVersion = blueprint.blueprintVersion;

      const eventType = validationResult.canProceed ? "VALIDATION_COMPLETED" : "VALIDATION_FAILED";

      await db.update(strategicBlueprints)
        .set({
          status: "VALIDATED",
          validationResult: JSON.stringify(validationResult),
          validatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(strategicBlueprints.id, id));

      await logAuditEvent({
        accountId: blueprint.accountId,
        campaignId: blueprint.campaignId || undefined,
        blueprintId: id,
        blueprintVersion: blueprint.blueprintVersion,
        event: eventType as any,
        details: {
          overallAssessment: validationResult.overallAssessment,
          riskScore: validationResult.riskScore,
          canProceed: validationResult.canProceed,
          contradictionCount: validationResult.contradictions?.length || 0,
        },
      });

      res.json({
        success: true,
        blueprintId: id,
        blueprintVersion: blueprint.blueprintVersion,
        status: "VALIDATED",
        validationResult,
        _meta: { usedFallback },
      });
    } catch (error: any) {
      console.error("[StrategicCore] Validation error:", error.message);
      res.status(500).json({
        success: false,
        error: "VALIDATION_ERROR",
        message: `Validation failed: ${error.message}`,
      });
    }
  });
}
