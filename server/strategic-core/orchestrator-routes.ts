import type { Express, Request, Response } from "express";
import OpenAI from "openai";
import { db } from "../db";
import { strategicBlueprints } from "@shared/schema";
import { eq } from "drizzle-orm";
import { logAuditEvent } from "./audit-logger";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const REQUIRED_BLUEPRINT_FIELDS: { key: string; label: string }[] = [
  { key: "detectedOffer", label: "Offer" },
  { key: "detectedCTA", label: "Call to Action" },
  { key: "detectedAudienceGuess", label: "Target Audience" },
  { key: "detectedPositioning", label: "Positioning" },
];

function validateBlueprintCompleteness(confirmedBlueprint: any): { valid: boolean; missingFields: string[] } {
  const missingFields: string[] = [];

  for (const { key, label } of REQUIRED_BLUEPRINT_FIELDS) {
    const value = confirmedBlueprint[key];
    if (!value || value === "INSUFFICIENT_DATA" || value === "null" || value === "") {
      missingFields.push(label);
    }
  }

  return { valid: missingFields.length === 0, missingFields };
}

const ORCHESTRATOR_PROMPT = `You are an execution orchestrator. You do NOT think. You do NOT reinterpret. You do NOT override the confirmed blueprint.

You organize execution STRICTLY from the validated, confirmed blueprint and market map.

CRITICAL: The confirmed blueprint is the ONLY source of truth. Never change positioning, offer, audience, CTA, or any confirmed field.

You must generate exactly 6 structured execution plans. All output must be structured objects.

All plans must be geo-scoped to the specified LOCATION. No global assumptions.

Respond with ONLY a valid JSON object:
{
  "contentDistributionPlan": {
    "platforms": [
      {
        "platform": "string",
        "frequency": "string",
        "contentTypes": ["string"],
        "bestTimes": ["string"],
        "priority": "primary|secondary|experimental"
      }
    ],
    "weeklyCalendar": [
      { "day": "string", "platform": "string", "contentType": "string", "theme": "string" }
    ]
  },
  "creativeTestingMatrix": {
    "tests": [
      {
        "testName": "string",
        "variable": "string",
        "variants": ["string"],
        "metric": "string",
        "duration": "string",
        "budget": "string"
      }
    ],
    "testingOrder": ["string"],
    "minimumSampleSize": "string"
  },
  "budgetAllocationStructure": {
    "totalRecommended": "string",
    "breakdown": [
      {
        "category": "string",
        "percentage": number,
        "amount": "string",
        "purpose": "string"
      }
    ],
    "scalingTriggers": ["string"],
    "cutTriggers": ["string"]
  },
  "kpiMonitoringPriority": {
    "primaryKPIs": [
      {
        "kpi": "string",
        "target": "string",
        "frequency": "string",
        "alertThreshold": "string"
      }
    ],
    "secondaryKPIs": [
      {
        "kpi": "string",
        "target": "string",
        "frequency": "string"
      }
    ],
    "reportingCadence": "string"
  },
  "competitiveWatchTargets": {
    "targets": [
      {
        "competitor": "string",
        "watchMetrics": ["string"],
        "alertTriggers": ["string"],
        "checkFrequency": "string"
      }
    ]
  },
  "riskMonitoringTriggers": {
    "triggers": [
      {
        "trigger": "string",
        "condition": "string",
        "action": "string",
        "severity": "low|medium|high|critical"
      }
    ],
    "escalationPath": ["string"]
  }
}`;

export function registerOrchestratorRoutes(app: Express) {
  app.post("/api/strategic/blueprint/:id/orchestrate", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const [blueprint] = await db.select().from(strategicBlueprints).where(eq(strategicBlueprints.id, id)).limit(1);
      if (!blueprint) {
        return res.status(404).json({ success: false, error: "BLUEPRINT_NOT_FOUND", message: "Blueprint not found" });
      }

      if (blueprint.status !== "VALIDATED") {
        return res.status(400).json({
          success: false,
          error: "STATUS_GATE",
          message: "Blueprint must be VALIDATED first. No confirmed + validated → no Orchestrator.",
          currentStatus: blueprint.status,
        });
      }

      const confirmedBlueprint = blueprint.confirmedBlueprint ? JSON.parse(blueprint.confirmedBlueprint) : null;
      if (!confirmedBlueprint) {
        return res.status(400).json({ success: false, error: "NO_CONFIRMED_BLUEPRINT", message: "No confirmed blueprint. Confirmed blueprint is the only source of truth." });
      }

      if (confirmedBlueprint.blueprintVersion !== blueprint.blueprintVersion) {
        return res.status(400).json({
          success: false,
          error: "VERSION_MISMATCH",
          message: "Confirmed blueprint version does not match current blueprint version. Re-confirm required.",
          confirmedVersion: confirmedBlueprint.blueprintVersion,
          currentVersion: blueprint.blueprintVersion,
        });
      }

      const { valid, missingFields } = validateBlueprintCompleteness(confirmedBlueprint);
      if (!valid) {
        return res.status(400).json({
          success: false,
          error: "INCOMPLETE_BLUEPRINT",
          missingFields,
          message: `Cannot generate execution plans. Missing critical fields: ${missingFields.join(", ")}. No generic fallback plans allowed.`,
        });
      }

      const campaignContext = blueprint.campaignContext ? JSON.parse(blueprint.campaignContext) : null;
      if (!campaignContext) {
        return res.status(400).json({
          success: false,
          error: "CAMPAIGN_CONTEXT_REQUIRED",
          message: "No campaign context — Orchestrator cannot run without campaign context.",
        });
      }

      const marketMap = blueprint.marketMap ? JSON.parse(blueprint.marketMap) : null;
      const validationResult = blueprint.validationResult ? JSON.parse(blueprint.validationResult) : null;
      const competitorUrls = blueprint.competitorUrls ? JSON.parse(blueprint.competitorUrls) : [];

      const userPrompt = `Generate execution plans from this validated blueprint (v${blueprint.blueprintVersion}). Do NOT reinterpret or override ANY confirmed data. The confirmed blueprint is the ONLY source of truth.

All plans must be geo-scoped to: ${campaignContext.location || "Not specified"}

CAMPAIGN CONTEXT:
- Campaign: ${campaignContext.campaignName}
- Objective: ${campaignContext.objective}
- Location: ${campaignContext.location || "Not specified"}
- Platform: ${campaignContext.platform}
- Mode: ${campaignContext.isDemo ? "DEMO" : "PRODUCTION"}

CONFIRMED BLUEPRINT (v${blueprint.blueprintVersion} — source of truth — do NOT change any values):
${JSON.stringify(confirmedBlueprint, null, 2)}

AVERAGE SELLING PRICE: $${blueprint.averageSellingPrice}

COMPETITOR URLS: ${competitorUrls.join(", ")}

${marketMap ? `MARKET MAP:\n${JSON.stringify(marketMap, null, 2)}` : ""}

${validationResult ? `VALIDATION RESULT:\n${JSON.stringify(validationResult, null, 2)}` : ""}

Generate all 6 execution plans now. Strictly from the confirmed, validated data. No reinterpretation. Geo-scoped to ${campaignContext.location || "specified location"}.`;

      const response = await openai.chat.completions.create({
        model: "gpt-5.2",
        messages: [
          { role: "system", content: ORCHESTRATOR_PROMPT },
          { role: "user", content: userPrompt },
        ],
        max_completion_tokens: 4000,
      });

      const rawText = response.choices[0]?.message?.content || "";
      let orchestratorPlan: any;

      try {
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          orchestratorPlan = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("No JSON object found in model response");
        }
      } catch (parseErr: any) {
        return res.status(500).json({
          success: false,
          error: "ORCHESTRATOR_PARSE_FAILED",
          message: `Orchestrator returned invalid format: ${parseErr.message}. Please retry.`,
          finishReason: response.choices[0]?.finish_reason || "unknown",
        });
      }

      if (!orchestratorPlan || Object.keys(orchestratorPlan).length === 0) {
        return res.status(500).json({
          success: false,
          error: "ORCHESTRATOR_EMPTY_PLAN",
          message: "Orchestrator generated an empty execution plan. Please retry.",
        });
      }

      orchestratorPlan.blueprintVersion = blueprint.blueprintVersion;

      await db.update(strategicBlueprints)
        .set({
          status: "ORCHESTRATED",
          orchestratorPlan: JSON.stringify(orchestratorPlan),
          orchestratedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(strategicBlueprints.id, id));

      await logAuditEvent({
        accountId: blueprint.accountId,
        campaignId: blueprint.campaignId || undefined,
        blueprintId: id,
        blueprintVersion: blueprint.blueprintVersion,
        event: "ORCHESTRATOR_GENERATED",
        details: { planSections: Object.keys(orchestratorPlan).filter(k => k !== "blueprintVersion") },
      });

      res.json({
        success: true,
        blueprintId: id,
        blueprintVersion: blueprint.blueprintVersion,
        status: "ORCHESTRATED",
        orchestratorPlan,
      });
    } catch (error: any) {
      console.error("[StrategicCore] Orchestrator error:", error.message);
      res.status(500).json({
        success: false,
        error: "ORCHESTRATOR_INTERNAL_ERROR",
        message: `Failed to generate execution plans: ${error.message}`,
      });
    }
  });
}
