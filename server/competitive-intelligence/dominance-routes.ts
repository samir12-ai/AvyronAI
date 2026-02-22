import type { Express } from "express";
import { db } from "../db";
import { dominanceAnalyses, ciCompetitors } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { featureFlagService } from "../feature-flags";
import { logAudit } from "../audit";
import { requireCampaign } from "../campaign-routes";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export function registerDominanceRoutes(app: Express) {

  app.post("/api/dominance/analyze", requireCampaign, async (req, res) => {
    try {
      const accountId = (req.body.accountId as string) || "default";
      const { competitorId, topContentData, blueprintId } = req.body;

      if (!competitorId) {
        return res.status(400).json({ success: false, error: "competitorId is required" });
      }

      const [competitor] = await db.select().from(ciCompetitors)
        .where(and(eq(ciCompetitors.id, competitorId), eq(ciCompetitors.accountId, accountId)));

      if (!competitor) {
        return res.status(404).json({ success: false, error: "Competitor not found" });
      }

      const contentItems = topContentData || generateSimulatedTopContent(competitor);

      const [analysis] = await db.insert(dominanceAnalyses).values({
        accountId,
        blueprintId: blueprintId || null,
        competitorName: competitor.name,
        competitorUrl: competitor.profileLink,
        topContent: JSON.stringify(contentItems),
        status: "processing",
      }).returning();

      let dissectionResult, weaknessResult, strategyResult;
      let aiError = null;

      try {
        dissectionResult = await runContentDissection(competitor, contentItems);
      } catch (err: any) {
        aiError = `Content dissection failed: ${err.message}`;
        dissectionResult = getFallbackDissection(contentItems);
      }

      try {
        weaknessResult = await runWeaknessDetection(competitor, contentItems, dissectionResult);
      } catch (err: any) {
        aiError = (aiError ? aiError + "; " : "") + `Weakness detection failed: ${err.message}`;
        weaknessResult = getFallbackWeakness(contentItems);
      }

      try {
        strategyResult = await runDominanceStrategy(competitor, dissectionResult, weaknessResult);
      } catch (err: any) {
        aiError = (aiError ? aiError + "; " : "") + `Dominance strategy failed: ${err.message}`;
        strategyResult = getFallbackStrategy();
      }

      const [updated] = await db.update(dominanceAnalyses)
        .set({
          contentDissection: JSON.stringify(dissectionResult),
          weaknessDetection: JSON.stringify(weaknessResult),
          dominanceStrategy: JSON.stringify(strategyResult),
          status: aiError ? "partial" : "completed",
          modelUsed: "gpt-5.2",
          updatedAt: new Date(),
        })
        .where(eq(dominanceAnalyses.id, analysis.id))
        .returning();

      await logAudit(accountId, "DOMINANCE_ANALYSIS_COMPLETED", {
        details: {
          analysisId: analysis.id,
          competitorName: competitor.name,
          contentItemsAnalyzed: contentItems.length,
          status: aiError ? "partial" : "completed",
          aiError: aiError || null,
        },
      });

      res.json({
        success: true,
        analysis: {
          ...updated,
          contentDissection: dissectionResult,
          weaknessDetection: weaknessResult,
          dominanceStrategy: strategyResult,
          topContent: contentItems,
        },
        aiError,
      });
    } catch (error: any) {
      console.error("[Dominance] Analysis error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get("/api/dominance/analyses", requireCampaign, async (req, res) => {
    try {
      const accountId = (req.query.accountId as string) || "default";
      const analyses = await db.select().from(dominanceAnalyses)
        .where(eq(dominanceAnalyses.accountId, accountId))
        .orderBy(desc(dominanceAnalyses.createdAt));

      const parsed = analyses.map(a => ({
        ...a,
        topContent: safeParse(a.topContent),
        contentDissection: safeParse(a.contentDissection),
        weaknessDetection: safeParse(a.weaknessDetection),
        dominanceStrategy: safeParse(a.dominanceStrategy),
        planModifications: safeParse(a.planModifications),
      }));

      res.json({ success: true, analyses: parsed });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get("/api/dominance/analyses/:id", requireCampaign, async (req, res) => {
    try {
      const { id } = req.params;
      const accountId = (req.query.accountId as string) || "default";
      const [analysis] = await db.select().from(dominanceAnalyses)
        .where(and(eq(dominanceAnalyses.id, id), eq(dominanceAnalyses.accountId, accountId)));

      if (!analysis) return res.status(404).json({ success: false, error: "Analysis not found" });

      res.json({
        success: true,
        analysis: {
          ...analysis,
          topContent: safeParse(analysis.topContent),
          contentDissection: safeParse(analysis.contentDissection),
          weaknessDetection: safeParse(analysis.weaknessDetection),
          dominanceStrategy: safeParse(analysis.dominanceStrategy),
          planModifications: safeParse(analysis.planModifications),
        },
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post("/api/dominance/:id/generate-modifications", requireCampaign, async (req, res) => {
    try {
      const { id } = req.params;
      const accountId = (req.body.accountId as string) || "default";
      const { basePlan } = req.body;

      if (!basePlan) {
        return res.status(400).json({ success: false, error: "basePlan is required (the current orchestrator plan)" });
      }

      const [analysis] = await db.select().from(dominanceAnalyses)
        .where(and(eq(dominanceAnalyses.id, id), eq(dominanceAnalyses.accountId, accountId)));

      if (!analysis) return res.status(404).json({ success: false, error: "Analysis not found" });
      if (analysis.status !== "completed" && analysis.status !== "partial") {
        return res.status(400).json({ success: false, error: "Analysis must be completed before generating modifications" });
      }

      const dominanceStrategy = safeParse(analysis.dominanceStrategy);
      const weaknessDetection = safeParse(analysis.weaknessDetection);

      let modifications;
      try {
        modifications = await runPlanModificationGeneration(
          basePlan,
          dominanceStrategy,
          weaknessDetection,
          analysis.competitorName
        );
      } catch (err: any) {
        modifications = getFallbackModifications(basePlan);
      }

      const [updated] = await db.update(dominanceAnalyses)
        .set({
          planModifications: JSON.stringify(modifications),
          modificationStatus: "pending_approval",
          updatedAt: new Date(),
        })
        .where(eq(dominanceAnalyses.id, id))
        .returning();

      await logAudit(accountId, "DOMINANCE_MODIFICATIONS_GENERATED", {
        details: {
          analysisId: id,
          competitorName: analysis.competitorName,
          modificationsCount: modifications.adjustments?.length || 0,
        },
      });

      res.json({
        success: true,
        modifications: {
          ...modifications,
          basePlan,
        },
        modificationStatus: "pending_approval",
      });
    } catch (error: any) {
      console.error("[Dominance] Modification generation error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post("/api/dominance/:id/approve-modifications", requireCampaign, async (req, res) => {
    try {
      const { id } = req.params;
      const accountId = (req.body.accountId as string) || "default";

      const [analysis] = await db.select().from(dominanceAnalyses)
        .where(and(eq(dominanceAnalyses.id, id), eq(dominanceAnalyses.accountId, accountId)));

      if (!analysis) return res.status(404).json({ success: false, error: "Analysis not found" });
      if (analysis.modificationStatus !== "pending_approval") {
        return res.status(400).json({ success: false, error: "No pending modifications to approve" });
      }

      const [updated] = await db.update(dominanceAnalyses)
        .set({ modificationStatus: "approved", updatedAt: new Date() })
        .where(eq(dominanceAnalyses.id, id))
        .returning();

      await logAudit(accountId, "DOMINANCE_MODIFICATIONS_APPROVED", {
        details: { analysisId: id, competitorName: analysis.competitorName },
      });

      res.json({
        success: true,
        modificationStatus: "approved",
        planModifications: safeParse(updated.planModifications),
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post("/api/dominance/:id/reject-modifications", requireCampaign, async (req, res) => {
    try {
      const { id } = req.params;
      const accountId = (req.body.accountId as string) || "default";
      const { reason } = req.body;

      const [analysis] = await db.select().from(dominanceAnalyses)
        .where(and(eq(dominanceAnalyses.id, id), eq(dominanceAnalyses.accountId, accountId)));

      if (!analysis) return res.status(404).json({ success: false, error: "Analysis not found" });
      if (analysis.modificationStatus !== "pending_approval") {
        return res.status(400).json({ success: false, error: "No pending modifications to reject" });
      }

      const [updated] = await db.update(dominanceAnalyses)
        .set({ modificationStatus: "rejected", updatedAt: new Date() })
        .where(eq(dominanceAnalyses.id, id))
        .returning();

      await logAudit(accountId, "DOMINANCE_MODIFICATIONS_REJECTED", {
        details: { analysisId: id, competitorName: analysis.competitorName, reason },
      });

      res.json({ success: true, modificationStatus: "rejected" });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });
}

function safeParse(val: string | null | undefined): any {
  if (!val) return null;
  try { return JSON.parse(val); } catch { return val; }
}

function generateSimulatedTopContent(competitor: any): any[] {
  const platform = competitor.platform || "instagram";
  return [
    {
      rank: 1,
      type: "reel",
      description: `Top performing ${platform} reel by ${competitor.name}`,
      estimatedViews: 45000,
      estimatedEngagement: 3200,
      estimatedShares: 850,
      contentTheme: "transformation/results",
      postingTime: "evening",
    },
    {
      rank: 2,
      type: "carousel",
      description: `High-engagement carousel post by ${competitor.name}`,
      estimatedViews: 32000,
      estimatedEngagement: 2800,
      estimatedShares: 420,
      contentTheme: "educational/tips",
      postingTime: "morning",
    },
    {
      rank: 3,
      type: "single_image",
      description: `Viral single image post by ${competitor.name}`,
      estimatedViews: 28000,
      estimatedEngagement: 1950,
      estimatedShares: 310,
      contentTheme: "social_proof/testimonial",
      postingTime: "afternoon",
    },
  ];
}

async function runContentDissection(competitor: any, contentItems: any[]): Promise<any> {
  const response = await openai.chat.completions.create({
    model: "gpt-5.2",
    messages: [
      {
        role: "system",
        content: `You are a competitive content intelligence engine specializing in deep content structure analysis.
Your job is to dissect high-performing competitor content and extract the exact mechanics that drive performance.
Every output must follow strict schema. No loose summaries. No generic advice.
Respond with valid JSON only.`,
      },
      {
        role: "user",
        content: `Perform deep content dissection on the top-performing content from competitor "${competitor.name}" (${competitor.platform}).

COMPETITOR PROFILE:
- Business type: ${competitor.businessType}
- Objective: ${competitor.primaryObjective}
- Hook styles: ${competitor.hookStyles || "unknown"}
- CTA patterns: ${competitor.ctaPatterns || "unknown"}
- Messaging tone: ${competitor.messagingTone || "unknown"}
- Social proof presence: ${competitor.socialProofPresence || "unknown"}
- Engagement ratio: ${competitor.engagementRatio || "unknown"}

TOP CONTENT ITEMS:
${JSON.stringify(contentItems, null, 2)}

For EACH content item, produce a dissection with this exact structure:
{
  "dissections": [
    {
      "contentRank": 1,
      "contentType": "reel|carousel|single_image|story|video",
      "hookType": {
        "primary": "question|promise|shock|number|authority",
        "description": "exact hook mechanism used",
        "strengthScore": 0.0-1.0
      },
      "offerMechanics": {
        "priceVisibility": "visible|hidden|teased|anchor_comparison",
        "urgencyLevel": "none|soft|medium|hard",
        "scarcitySignals": ["signal1", "signal2"],
        "socialProofType": "testimonial|numbers|authority|celebrity|peer|none"
      },
      "psychologicalTrigger": {
        "primary": "fear|authority|aspiration|result_driven|discount_driven|exclusivity|social_validation",
        "secondary": "string or null",
        "emotionalIntensity": 0.0-1.0
      },
      "ctaMechanics": {
        "type": "whatsapp|dm|form|soft_cta|hard_cta|link_in_bio|swipe_up",
        "placement": "beginning|middle|end|throughout",
        "frictionLevel": "low|medium|high",
        "conversionPath": "description of the conversion flow"
      },
      "creativeStructure": {
        "format": "vertical_video|horizontal_video|square|carousel_slides|static",
        "pacing": "fast|medium|slow|variable",
        "framingStyle": "talking_head|b_roll|text_overlay|mixed|product_focus",
        "visualQuality": "professional|semi_pro|casual|raw",
        "textOverlayDensity": "none|minimal|moderate|heavy"
      },
      "performanceDrivers": ["key reason 1", "key reason 2", "key reason 3"]
    }
  ],
  "overallPattern": {
    "dominantHookType": "string",
    "dominantPsychTrigger": "string",
    "dominantCTA": "string",
    "contentFormula": "one-line summary of their winning formula"
  }
}`,
      },
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: 4096,
  });

  const raw = response.choices[0]?.message?.content || "{}";
  return JSON.parse(raw);
}

async function runWeaknessDetection(competitor: any, contentItems: any[], dissection: any): Promise<any> {
  const response = await openai.chat.completions.create({
    model: "gpt-5.2",
    messages: [
      {
        role: "system",
        content: `You are a competitive weakness detection engine. You analyze high-performing content NOT to praise it, but to find exactly what it fails to exploit.
For every strength, find the unexploited gap. For every success, find the missed opportunity.
Respond with valid JSON only.`,
      },
      {
        role: "user",
        content: `Analyze weaknesses in ${competitor.name}'s top-performing content.

CONTENT DISSECTION:
${JSON.stringify(dissection, null, 2)}

CONTENT ITEMS:
${JSON.stringify(contentItems, null, 2)}

For EACH content item, produce a weakness analysis:
{
  "weaknesses": [
    {
      "contentRank": 1,
      "strengthExploited": {
        "description": "what this content does well",
        "category": "hook|offer|psychology|cta|creative"
      },
      "weaknessNotAddressed": {
        "description": "what this content fails to do or exploit",
        "category": "conversion_weakness|differentiation_gap|pricing_opacity|weak_cta|positioning_gap|trust_deficit|funnel_leak",
        "severity": "low|medium|high|critical"
      },
      "opportunityVector": {
        "description": "specific action to exploit this weakness",
        "expectedImpact": "low|medium|high",
        "implementationDifficulty": "easy|medium|hard"
      }
    }
  ],
  "globalWeaknesses": [
    {
      "pattern": "weakness pattern across all content",
      "description": "detailed description",
      "exploitStrategy": "how to systematically exploit this"
    }
  ],
  "vulnerabilityScore": 0.0-1.0,
  "biggestOpportunity": "one-line description of the single biggest opportunity"
}`,
      },
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: 4096,
  });

  const raw = response.choices[0]?.message?.content || "{}";
  return JSON.parse(raw);
}

async function runDominanceStrategy(competitor: any, dissection: any, weaknesses: any): Promise<any> {
  const response = await openai.chat.completions.create({
    model: "gpt-5.2",
    messages: [
      {
        role: "system",
        content: `You are a dominance strategy engine. Your goal is NOT imitation — it is controlled strategic superiority.
For every competitor strength, generate an upgraded variant. For every weakness, generate an exploitation plan.
The output must be actionable blueprints, not advice. Respond with valid JSON only.`,
      },
      {
        role: "user",
        content: `Generate dominance strategy against ${competitor.name}.

CONTENT DISSECTION:
${JSON.stringify(dissection, null, 2)}

WEAKNESS DETECTION:
${JSON.stringify(weaknesses, null, 2)}

Generate upgraded variant blueprints:
{
  "upgradedVariants": [
    {
      "targetContentRank": 1,
      "originalStrength": "what competitor did well",
      "upgradedHookLogic": {
        "original": "their hook approach",
        "upgraded": "superior hook approach",
        "whyBetter": "reasoning"
      },
      "strongerConversionMechanics": {
        "original": "their conversion path",
        "upgraded": "superior conversion path",
        "expectedLift": "estimated improvement percentage"
      },
      "refinedPositioning": {
        "original": "their positioning",
        "upgraded": "differentiated positioning",
        "differentiator": "what sets this apart"
      },
      "ctaOptimization": {
        "original": "their CTA",
        "upgraded": "optimized CTA",
        "frictionReduction": "how friction is reduced"
      },
      "structuralUpgrades": [
        {
          "timing": "e.g. second 3, slide 2",
          "action": "what to add/change",
          "reason": "why this improves performance"
        }
      ]
    }
  ],
  "overallDominancePlaybook": {
    "primaryStrategy": "one-line dominance strategy",
    "keyDifferentiators": ["diff1", "diff2", "diff3"],
    "expectedOutcomeRange": {
      "conservative": "X% improvement",
      "optimistic": "Y% improvement"
    },
    "implementationPriority": [
      {
        "action": "specific action",
        "impact": "high|medium|low",
        "effort": "easy|medium|hard",
        "timeline": "immediate|1_week|2_weeks|1_month"
      }
    ]
  }
}`,
      },
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: 4096,
  });

  const raw = response.choices[0]?.message?.content || "{}";
  return JSON.parse(raw);
}

async function runPlanModificationGeneration(
  basePlan: any,
  dominanceStrategy: any,
  weaknessDetection: any,
  competitorName: string
): Promise<any> {
  const response = await openai.chat.completions.create({
    model: "gpt-5.2",
    messages: [
      {
        role: "system",
        content: `You are a strategic plan modification engine. You take a base orchestrator plan and propose controlled modifications based on competitive dominance intelligence.
Every modification must be clearly marked, justified, and presented as a side-by-side comparison.
No silent overrides. Every change is explicit and requires approval. Respond with valid JSON only.`,
      },
      {
        role: "user",
        content: `Given the competitive dominance analysis against "${competitorName}", propose modifications to the base orchestrator plan.

BASE PLAN:
${JSON.stringify(basePlan, null, 2)}

DOMINANCE STRATEGY:
${JSON.stringify(dominanceStrategy, null, 2)}

WEAKNESS DETECTION:
${JSON.stringify(weaknessDetection, null, 2)}

Generate a modification proposal:
{
  "adjustments": [
    {
      "section": "which plan section is affected (e.g. content_distribution, creative_testing, kpi_monitoring)",
      "originalValue": "what the base plan says",
      "adjustedValue": "what the dominance-adjusted plan says",
      "reason": "why this change improves competitive positioning",
      "impactLevel": "low|medium|high|critical",
      "competitiveAdvantage": "specific advantage gained"
    }
  ],
  "basePlanSummary": "one-line summary of original plan",
  "adjustedPlanSummary": "one-line summary of adjusted plan",
  "overallImpactAssessment": {
    "riskLevel": "low|medium|high",
    "confidenceScore": 0.0-1.0,
    "expectedLift": "estimated improvement description"
  },
  "competitorTargeted": "${competitorName}"
}`,
      },
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: 4096,
  });

  const raw = response.choices[0]?.message?.content || "{}";
  return JSON.parse(raw);
}

function getFallbackDissection(contentItems: any[]): any {
  return {
    dissections: contentItems.map((item, i) => ({
      contentRank: item.rank || i + 1,
      contentType: item.type || "unknown",
      hookType: { primary: "unknown", description: "AI analysis unavailable — manual review required", strengthScore: 0 },
      offerMechanics: { priceVisibility: "unknown", urgencyLevel: "none", scarcitySignals: [], socialProofType: "none" },
      psychologicalTrigger: { primary: "unknown", secondary: null, emotionalIntensity: 0 },
      ctaMechanics: { type: "unknown", placement: "unknown", frictionLevel: "unknown", conversionPath: "AI analysis unavailable" },
      creativeStructure: { format: "unknown", pacing: "unknown", framingStyle: "unknown", visualQuality: "unknown", textOverlayDensity: "unknown" },
      performanceDrivers: ["AI analysis unavailable — manual dissection required"],
    })),
    overallPattern: {
      dominantHookType: "unknown",
      dominantPsychTrigger: "unknown",
      dominantCTA: "unknown",
      contentFormula: "AI analysis unavailable — manual review required",
    },
    _fallback: true,
    _reason: "AI model call failed",
  };
}

function getFallbackWeakness(contentItems: any[]): any {
  return {
    weaknesses: contentItems.map((item, i) => ({
      contentRank: item.rank || i + 1,
      strengthExploited: { description: "AI analysis unavailable", category: "unknown" },
      weaknessNotAddressed: { description: "AI analysis unavailable", category: "unknown", severity: "unknown" },
      opportunityVector: { description: "Manual analysis required", expectedImpact: "unknown", implementationDifficulty: "unknown" },
    })),
    globalWeaknesses: [],
    vulnerabilityScore: 0,
    biggestOpportunity: "AI analysis unavailable — manual weakness detection required",
    _fallback: true,
    _reason: "AI model call failed",
  };
}

function getFallbackStrategy(): any {
  return {
    upgradedVariants: [],
    overallDominancePlaybook: {
      primaryStrategy: "AI analysis unavailable — manual strategy required",
      keyDifferentiators: [],
      expectedOutcomeRange: { conservative: "unknown", optimistic: "unknown" },
      implementationPriority: [],
    },
    _fallback: true,
    _reason: "AI model call failed",
  };
}

function getFallbackModifications(basePlan: any): any {
  return {
    adjustments: [],
    basePlanSummary: "Original plan unchanged — AI modification generation unavailable",
    adjustedPlanSummary: "No modifications generated",
    overallImpactAssessment: { riskLevel: "low", confidenceScore: 0, expectedLift: "unknown" },
    competitorTargeted: "unknown",
    _fallback: true,
    _reason: "AI model call failed",
  };
}
