import type { Express, Request, Response } from "express";
import { aiChat } from "../ai-client";
import { db } from "../db";
import { strategicBlueprints, businessDataLayer, miSnapshots } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { logAuditEvent } from "./audit-logger";
import { getEngineReadinessState } from "../market-intelligence-v3/engine-state";
import { ENGINE_VERSION } from "../market-intelligence-v3/constants";

const CREATIVE_BLUEPRINT_PROMPT = `You are a marketing creative strategist. Given campaign context, business data, competitor intelligence, and market signals, generate a structured Creative Blueprint that will guide content creation.

Your task is to generate strategic creative direction — NOT analyze existing content.

CRITICAL RULES:
- Respond with ONLY a valid JSON object. No markdown, no explanation, no free text.
- Each field MUST have a confidence score (0-100) based on how much input data supports the recommendation.
- If insufficient data exists for a field, provide a reasonable direction based on available context and set confidence to 40-60.
- All recommendations must be grounded in the provided market data and campaign objectives.

Response format (strict JSON only):
{
  "detectedLanguage": "string (primary language for content)",
  "transcribedText": null,
  "ocrText": null,
  "detectedOffer": { "value": "string (recommended offer positioning based on market gaps and pricing)", "confidence": 0-100 },
  "detectedPositioning": { "value": "premium|discount|authority|convenience|value", "confidence": 0-100 },
  "detectedCTA": { "value": "string (recommended call-to-action based on funnel stage and objective)", "confidence": 0-100 },
  "detectedAudienceGuess": { "value": "string (target audience based on business data and market analysis)", "confidence": 0-100 },
  "detectedFunnelStage": { "value": "awareness|consideration|conversion|retention", "confidence": 0-100 },
  "detectedPriceIfVisible": { "value": null, "confidence": 0 },
  "hookDirection": { "value": "string (recommended hook style and opening approach)", "confidence": 0-100 },
  "narrativeStructure": { "value": "string (recommended story arc: problem-solution, testimonial, educational, etc.)", "confidence": 0-100 },
  "contentAngle": { "value": "string (unique angle to differentiate from competitors)", "confidence": 0-100 },
  "visualDirection": { "value": "string (visual style, mood, color direction)", "confidence": 0-100 },
  "formatSuggestion": { "value": "reel|post|story|carousel", "confidence": 0-100 }
}`;

export function cleanJsonString(raw: string): string {
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, '');
  s = s.replace(/\s*```\s*$/i, '');
  s = s.trim();
  const jsonMatch = s.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("No JSON object found in response");
  }
  s = jsonMatch[0];
  s = s.replace(/\/\/[^\n]*/g, '');
  s = s.replace(/,\s*([\]}])/g, '$1');
  s = s.replace(/[\x00-\x1F\x7F]/g, (ch: string) => {
    if (ch === '\n' || ch === '\r' || ch === '\t') return ch;
    return '';
  });
  return s;
}

function buildFallbackBlueprint(): any {
  return {
    detectedLanguage: "unknown",
    transcribedText: null,
    ocrText: null,
    detectedOffer: { value: "INSUFFICIENT_DATA", confidence: 0 },
    detectedPositioning: { value: "INSUFFICIENT_DATA", confidence: 0 },
    detectedCTA: { value: "INSUFFICIENT_DATA", confidence: 0 },
    detectedAudienceGuess: { value: "INSUFFICIENT_DATA", confidence: 0 },
    detectedFunnelStage: { value: "INSUFFICIENT_DATA", confidence: 0 },
    detectedPriceIfVisible: { value: null, confidence: 0 },
    hookDirection: { value: "INSUFFICIENT_DATA", confidence: 0 },
    narrativeStructure: { value: "INSUFFICIENT_DATA", confidence: 0 },
    contentAngle: { value: "INSUFFICIENT_DATA", confidence: 0 },
    visualDirection: { value: "INSUFFICIENT_DATA", confidence: 0 },
    formatSuggestion: { value: "INSUFFICIENT_DATA", confidence: 0 },
  };
}

function normalizeExtraction(raw: any): any {
  const fields = [
    "detectedOffer", "detectedPositioning", "detectedCTA", "detectedAudienceGuess",
    "detectedFunnelStage", "detectedPriceIfVisible",
    "hookDirection", "narrativeStructure", "contentAngle", "visualDirection", "formatSuggestion",
  ];
  const result: any = {
    detectedLanguage: raw.detectedLanguage || "unknown",
    transcribedText: null,
    ocrText: null,
  };

  for (const field of fields) {
    const val = raw[field];
    if (val && typeof val === "object" && "value" in val && "confidence" in val) {
      result[field] = {
        value: val.value === null || val.value === undefined || val.value === "" ? "INSUFFICIENT_DATA" : val.value,
        confidence: typeof val.confidence === "number" ? Math.max(0, Math.min(100, val.confidence)) : 0,
      };
    } else if (val !== null && val !== undefined && val !== "" && val !== "null") {
      result[field] = { value: val, confidence: 50 };
    } else {
      result[field] = { value: "INSUFFICIENT_DATA", confidence: 0 };
    }

    if (result[field].value === "INSUFFICIENT_DATA") {
      result[field].confidence = 0;
    }
  }

  return result;
}

export function registerExtractionRoutes(app: Express) {
  app.post("/api/strategic/generate-creative-blueprint", async (req: Request, res: Response) => {
    try {
      const { blueprintId } = req.body;

      if (!blueprintId) {
        return res.status(400).json({ error: "blueprintId is required" });
      }

      const [blueprint] = await db.select().from(strategicBlueprints).where(eq(strategicBlueprints.id, blueprintId)).limit(1);
      if (!blueprint) {
        return res.status(404).json({ error: "Blueprint not found" });
      }

      if (!["GATE_PASSED", "EXTRACTION_COMPLETE", "EXTRACTION_FALLBACK", "ANALYSIS_COMPLETE"].includes(blueprint.status)) {
        return res.status(400).json({ error: "Blueprint must pass Phase 0 gate before creative blueprint generation" });
      }

      const campaignContext = blueprint.campaignContext ? JSON.parse(blueprint.campaignContext) : null;
      const competitorUrls = blueprint.competitorUrls ? JSON.parse(blueprint.competitorUrls) : [];
      const asp = blueprint.averageSellingPrice;

      const resolvedCampaignId = campaignContext?.campaignId || blueprint.campaignId;

      const [latestMiForCheck] = await db.select().from(miSnapshots)
        .where(and(
          eq(miSnapshots.accountId, blueprint.accountId),
          eq(miSnapshots.campaignId, resolvedCampaignId),
        ))
        .orderBy(desc(miSnapshots.createdAt))
        .limit(1);

      const miReadiness = getEngineReadinessState(
        latestMiForCheck || null,
        resolvedCampaignId,
        ENGINE_VERSION,
        14,
      );

      console.log(`[StrategicCore] Phase 1 MI readiness check: state=${miReadiness.state} | campaign=${resolvedCampaignId} | blueprint=${blueprintId}`);

      if (miReadiness.state !== "READY") {
        console.log(`[StrategicCore] Phase 1 blocked — MI not ready: ${JSON.stringify(miReadiness.diagnostics)}`);
        return res.status(400).json({
          error: "MI_NOT_READY",
          message: "Market Intelligence data is no longer valid. Please refresh MI before generating a blueprint.",
          engineState: miReadiness.state,
          diagnostics: miReadiness.diagnostics,
        });
      }

      let businessData: any = null;
      if (resolvedCampaignId) {
        const [bd] = await db.select().from(businessDataLayer)
          .where(eq(businessDataLayer.campaignId, resolvedCampaignId))
          .limit(1);
        if (bd) businessData = bd;
      }

      let marketSignals: any = null;
      if (resolvedCampaignId) {
        const [latestSnapshot] = await db.select({
          marketDiagnosis: miSnapshots.marketDiagnosis,
          threatSignals: miSnapshots.threatSignals,
          opportunitySignals: miSnapshots.opportunitySignals,
          trajectoryData: miSnapshots.trajectoryData,
        }).from(miSnapshots)
          .where(and(
            eq(miSnapshots.accountId, blueprint.accountId),
            eq(miSnapshots.campaignId, resolvedCampaignId),
            eq(miSnapshots.status, "COMPLETE"),
          ))
          .orderBy(desc(miSnapshots.createdAt))
          .limit(1);

        if (latestSnapshot) {
          marketSignals = {
            diagnosis: latestSnapshot.marketDiagnosis,
            threats: latestSnapshot.threatSignals ? JSON.parse(latestSnapshot.threatSignals) : [],
            opportunities: latestSnapshot.opportunitySignals ? JSON.parse(latestSnapshot.opportunitySignals) : [],
            trajectory: latestSnapshot.trajectoryData ? JSON.parse(latestSnapshot.trajectoryData) : null,
          };
        }
      }

      let contextBlock = `CAMPAIGN CONTEXT:\n`;
      if (campaignContext) {
        contextBlock += `- Campaign: ${campaignContext.campaignName}\n`;
        contextBlock += `- Objective: ${campaignContext.objective}\n`;
        contextBlock += `- Location: ${campaignContext.location || "Not specified"}\n`;
        contextBlock += `- Platform: ${campaignContext.platform || "meta"}\n`;
      }
      contextBlock += `- Average Selling Price: $${asp || "Not specified"}\n`;
      contextBlock += `- Competitors Tracked: ${competitorUrls.length}\n`;

      if (businessData) {
        contextBlock += `\nBUSINESS PROFILE:\n`;
        contextBlock += `- Business Type: ${businessData.businessType || "Unknown"}\n`;
        contextBlock += `- Core Offer: ${businessData.coreOffer || "Unknown"}\n`;
        contextBlock += `- Price Range: ${businessData.priceRange || "Unknown"}\n`;
        contextBlock += `- Target Audience Age: ${businessData.targetAudienceAge || "Unknown"}\n`;
        contextBlock += `- Target Segment: ${businessData.targetAudienceSegment || "Unknown"}\n`;
        contextBlock += `- Monthly Budget: ${businessData.monthlyBudget || "Unknown"}\n`;
        contextBlock += `- Funnel Objective: ${businessData.funnelObjective || "Unknown"}\n`;
        contextBlock += `- Conversion Channel: ${businessData.primaryConversionChannel || "Unknown"}\n`;
        if (businessData.businessLocation) contextBlock += `- Location: ${businessData.businessLocation}\n`;
      }

      if (marketSignals) {
        contextBlock += `\nMARKET INTELLIGENCE:\n`;
        if (marketSignals.diagnosis) {
          contextBlock += `- Market Diagnosis: ${marketSignals.diagnosis}\n`;
        }
        if (marketSignals.threats?.length > 0) {
          contextBlock += `- Threat Signals:\n`;
          for (const t of marketSignals.threats.slice(0, 5)) {
            contextBlock += `  • ${t}\n`;
          }
        }
        if (marketSignals.opportunities?.length > 0) {
          contextBlock += `- Market Openings:\n`;
          for (const o of marketSignals.opportunities.slice(0, 5)) {
            contextBlock += `  • ${o}\n`;
          }
        }
        if (marketSignals.trajectory) {
          const traj = marketSignals.trajectory;
          contextBlock += `- Market Heating Index: ${traj.marketHeatingIndex ?? "N/A"}\n`;
          contextBlock += `- Narrative Convergence: ${traj.narrativeConvergenceScore ?? "N/A"}\n`;
        }
      }

      if (competitorUrls.length > 0) {
        contextBlock += `\nCOMPETITOR URLS:\n`;
        for (const url of competitorUrls.slice(0, 10)) {
          contextBlock += `- ${url}\n`;
        }
      }

      let rawBlueprint: any = null;
      let extractionFallbackUsed = false;
      let parseFailedReason: string | null = null;

      try {
        const response = await aiChat({
          model: "gpt-4.1-mini",
          messages: [
            { role: "system", content: CREATIVE_BLUEPRINT_PROMPT },
            { role: "user", content: `Generate a Creative Blueprint based on this strategic data:\n\n${contextBlock}` },
          ],
          accountId: blueprint.accountId || "default",
          endpoint: "strategic-creative-blueprint",
        });

        const rawText = typeof response === "string" ? response : response?.choices?.[0]?.message?.content || "";
        const cleaned = cleanJsonString(rawText);
        rawBlueprint = JSON.parse(cleaned);
      } catch (err: any) {
        console.error("[StrategicCore] Creative blueprint generation attempt 1 failed:", err.message);

        try {
          const retryResponse = await aiChat({
            model: "gpt-4.1-mini",
            messages: [
              { role: "system", content: CREATIVE_BLUEPRINT_PROMPT + "\n\nPREVIOUS ATTEMPT FAILED. Return ONLY a valid JSON object. No markdown. No comments." },
              { role: "user", content: `Generate a Creative Blueprint:\n\n${contextBlock}` },
            ],
            accountId: blueprint.accountId || "default",
            endpoint: "strategic-creative-blueprint-retry",
          });

          const retryText = typeof retryResponse === "string" ? retryResponse : retryResponse?.choices?.[0]?.message?.content || "";
          const cleaned = cleanJsonString(retryText);
          rawBlueprint = JSON.parse(cleaned);
        } catch (retryErr: any) {
          console.error("[StrategicCore] Creative blueprint generation attempt 2 failed:", retryErr.message);
        }
      }

      if (!rawBlueprint) {
        extractionFallbackUsed = true;
        parseFailedReason = "AI_GENERATION_FAILED";
        console.warn(`[StrategicCore] Creative blueprint fallback triggered: ${parseFailedReason}`);
        rawBlueprint = {};
      }

      const draftBlueprint = normalizeExtraction(rawBlueprint);

      const allInsufficient = ["detectedOffer", "detectedPositioning", "detectedCTA", "detectedAudienceGuess", "detectedFunnelStage"].every(
        f => draftBlueprint[f]?.value === "INSUFFICIENT_DATA"
      );
      if (allInsufficient && !extractionFallbackUsed) {
        extractionFallbackUsed = true;
        parseFailedReason = "EMPTY_FIELDS";
      }

      draftBlueprint.extractionFallbackUsed = extractionFallbackUsed;
      draftBlueprint.parseFailedReason = parseFailedReason;
      draftBlueprint.generationSource = "AI_STRATEGY";

      const finalStatus = extractionFallbackUsed ? "EXTRACTION_FALLBACK" : "EXTRACTION_COMPLETE";

      await db.update(strategicBlueprints)
        .set({
          status: finalStatus,
          creativeMediaType: "ai_generated",
          draftBlueprint: JSON.stringify(draftBlueprint),
          creativeAnalysis: JSON.stringify(draftBlueprint),
          confirmedBlueprint: null,
          marketMap: null,
          validationResult: null,
          orchestratorPlan: null,
          analysisCompletedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(strategicBlueprints.id, blueprintId));

      await logAuditEvent({
        accountId: blueprint.accountId,
        campaignId: blueprint.campaignId || undefined,
        blueprintId,
        blueprintVersion: blueprint.blueprintVersion,
        event: extractionFallbackUsed ? "CREATIVE_BLUEPRINT_FALLBACK" : "CREATIVE_BLUEPRINT_GENERATED",
        details: {
          source: "AI_STRATEGY",
          allInsufficient,
          extractionFallbackUsed,
          parseFailedReason,
          hasMarketSignals: !!marketSignals,
          hasBusinessData: !!businessData,
        },
      });

      res.json({
        success: true,
        blueprintId,
        blueprintVersion: blueprint.blueprintVersion,
        status: finalStatus,
        draftBlueprint,
        extractionFallbackUsed,
        parseFailedReason,
        _meta: {
          source: "AI_STRATEGY",
          allFieldsInsufficient: allInsufficient,
          hasMarketSignals: !!marketSignals,
          hasBusinessData: !!businessData,
        },
      });
    } catch (error: any) {
      console.error("[StrategicCore] Creative blueprint generation error:", error.message);
      res.status(500).json({ error: "Failed to generate creative blueprint. Please try again." });
    }
  });
}
