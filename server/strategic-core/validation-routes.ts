import type { Express, Request, Response } from "express";
import OpenAI from "openai";
import { db } from "../db";
import { strategicBlueprints } from "@shared/schema";
import { eq } from "drizzle-orm";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const VALIDATION_PROMPT = `You are a strategic validation engine. Your job is to detect contradictions, evaluate strategic coherence, and flag risks in a campaign blueprint.

You must check for:
1. CONTRADICTIONS: e.g., "premium" positioning + heavy discount, "awareness" funnel + hard-sell CTA, luxury tone + bargain pricing
2. OFFER CLARITY: Is the offer specific, measurable, and compelling?
3. PRICE POSITIONING: Does the price align with the positioning strategy?
4. AUDIENCE-OFFER FIT: Does the offer match the target audience?
5. CTA-FUNNEL ALIGNMENT: Does the CTA match the funnel stage?
6. COMPETITIVE VIABILITY: Based on market map, is the strategy defensible?

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
          error: "STATUS_GATE",
          message: "Blueprint must be CONFIRMED before validation.",
          currentStatus: blueprint.status,
        });
      }

      const confirmedBlueprint = blueprint.confirmedBlueprint ? JSON.parse(blueprint.confirmedBlueprint) : null;
      if (!confirmedBlueprint) {
        return res.status(400).json({ error: "No confirmed blueprint data" });
      }

      const marketMap = blueprint.marketMap ? JSON.parse(blueprint.marketMap) : null;

      const userPrompt = `Validate this campaign strategy:

CONFIRMED BLUEPRINT:
${JSON.stringify(confirmedBlueprint, null, 2)}

AVERAGE SELLING PRICE: $${blueprint.averageSellingPrice || "unknown"}

${marketMap ? `MARKET MAP:\n${JSON.stringify(marketMap, null, 2)}` : "MARKET MAP: Not yet generated"}

Perform full validation now.`;

      const response = await openai.chat.completions.create({
        model: "gpt-5.2",
        messages: [
          { role: "system", content: VALIDATION_PROMPT },
          { role: "user", content: userPrompt },
        ],
        max_completion_tokens: 2500,
      });

      const rawText = response.choices[0]?.message?.content || "";
      let validationResult: any;

      try {
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          validationResult = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("No JSON");
        }
      } catch {
        return res.status(500).json({ error: "Validation engine returned invalid format. Please retry." });
      }

      await db.update(strategicBlueprints)
        .set({
          status: "VALIDATED",
          validationResult: JSON.stringify(validationResult),
          validatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(strategicBlueprints.id, id));

      res.json({
        success: true,
        blueprintId: id,
        status: "VALIDATED",
        validationResult,
      });
    } catch (error: any) {
      console.error("[StrategicCore] Validation error:", error.message);
      res.status(500).json({ error: "Failed to validate blueprint" });
    }
  });
}
