import type { Express, Request, Response } from "express";
import OpenAI from "openai";
import { db } from "../db";
import { strategicBlueprints } from "@shared/schema";
import { eq } from "drizzle-orm";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const MARKET_MAP_PROMPT = `You are a strategic market analyst. Given a confirmed campaign blueprint, competitor data, and pricing information, generate a comprehensive Strategic Market Map.

Your analysis must be 100% structured. No narrative. No free text. Only structured JSON output.

You must analyze:
1. Competitor positioning (where each competitor sits in the market)
2. Price band estimation (low/mid/high for the market segment)
3. Price vs market comparison (where the client's price sits)
4. Market saturation level (low/medium/high/oversaturated)
5. Gap angles (untapped opportunities)
6. Risk exposure areas
7. Strategic recommendations

Respond with ONLY a valid JSON object:
{
  "competitorPositioning": [
    {
      "url": "string",
      "inferredName": "string",
      "positioning": "premium|discount|authority|convenience|value",
      "estimatedPriceRange": { "low": number, "high": number },
      "strengths": ["string"],
      "weaknesses": ["string"]
    }
  ],
  "priceBands": {
    "low": { "min": number, "max": number },
    "mid": { "min": number, "max": number },
    "high": { "min": number, "max": number }
  },
  "clientPricePosition": "below_market|competitive|above_market|premium",
  "saturationLevel": "low|medium|high|oversaturated",
  "saturationDetails": "string",
  "gapAngles": [
    {
      "angle": "string",
      "opportunity": "string",
      "difficulty": "low|medium|high",
      "potentialImpact": "low|medium|high"
    }
  ],
  "riskExposure": [
    {
      "risk": "string",
      "severity": "low|medium|high|critical",
      "mitigation": "string"
    }
  ],
  "marketMapSummary": {
    "totalCompetitors": number,
    "dominantPositioning": "string",
    "biggestOpportunity": "string",
    "biggestThreat": "string",
    "recommendedStrategy": "string"
  }
}`;

export function registerThinkingRoutes(app: Express) {
  app.post("/api/strategic/blueprint/:id/analyze", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const [blueprint] = await db.select().from(strategicBlueprints).where(eq(strategicBlueprints.id, id)).limit(1);
      if (!blueprint) {
        return res.status(404).json({ error: "Blueprint not found" });
      }

      if (blueprint.status !== "CONFIRMED") {
        return res.status(400).json({
          error: "STATUS_GATE",
          message: "Blueprint must be CONFIRMED before market analysis.",
          currentStatus: blueprint.status,
        });
      }

      const confirmedBlueprint = blueprint.confirmedBlueprint ? JSON.parse(blueprint.confirmedBlueprint) : null;
      if (!confirmedBlueprint) {
        return res.status(400).json({ error: "No confirmed blueprint data found. Confirmed blueprint is the only source of truth for analysis." });
      }

      const campaignContext = blueprint.campaignContext ? JSON.parse(blueprint.campaignContext) : null;
      if (!campaignContext) {
        return res.status(400).json({
          error: "CAMPAIGN_CONTEXT_REQUIRED",
          message: "No campaign context — Market Analysis cannot run without campaign context (objective + location).",
        });
      }

      const competitorUrls = blueprint.competitorUrls ? JSON.parse(blueprint.competitorUrls) : [];
      if (competitorUrls.length < 2) {
        return res.status(400).json({ error: "GATE_FAILED", message: "No competitor data — no Market Analysis." });
      }

      if (!blueprint.averageSellingPrice) {
        return res.status(400).json({ error: "GATE_FAILED", message: "No price data — no price comparison." });
      }

      const userPrompt = `Analyze this strategic data and generate a Market Map:

CAMPAIGN CONTEXT:
- Campaign: ${campaignContext.campaignName}
- Objective: ${campaignContext.objective}
- Location: ${campaignContext.location || "Not specified"}
- Platform: ${campaignContext.platform}
- Mode: ${campaignContext.isDemo ? "DEMO (no live data)" : "PRODUCTION"}

CONFIRMED BLUEPRINT (source of truth — do not override):
${JSON.stringify(confirmedBlueprint, null, 2)}

COMPETITOR URLS:
${competitorUrls.map((u: string, i: number) => `${i + 1}. ${u}`).join("\n")}

CLIENT AVERAGE SELLING PRICE: $${blueprint.averageSellingPrice}

Generate the Strategic Market Map now.`;

      const response = await openai.chat.completions.create({
        model: "gpt-5.2",
        messages: [
          { role: "system", content: MARKET_MAP_PROMPT },
          { role: "user", content: userPrompt },
        ],
        max_completion_tokens: 3000,
      });

      const rawText = response.choices[0]?.message?.content || "";
      let marketMap: any;

      try {
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          marketMap = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("No JSON in response");
        }
      } catch {
        return res.status(500).json({ error: "Market analysis returned invalid format. Please retry." });
      }

      await db.update(strategicBlueprints)
        .set({
          status: "ANALYSIS_COMPLETE",
          marketMap: JSON.stringify(marketMap),
          updatedAt: new Date(),
        })
        .where(eq(strategicBlueprints.id, id));

      res.json({
        success: true,
        blueprintId: id,
        status: "ANALYSIS_COMPLETE",
        marketMap,
      });
    } catch (error: any) {
      console.error("[StrategicCore] Thinking engine error:", error.message);
      res.status(500).json({ error: "Failed to generate market analysis" });
    }
  });
}
