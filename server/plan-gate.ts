import { Express, Request, Response } from "express";
import { db } from "./db";
import { eq, and, desc } from "drizzle-orm";
import { businessDataLayer, growthCampaigns } from "../shared/schema";

export interface BusinessArchetype {
  id: string;
  name: string;
  funnelArchetype: string;
  channelPriority: string[];
  trustRequirement: number;
  proofRequirement: number;
  contentToConversionWeight: number;
  salesCycleProfile: string;
  typicalFormats: string[];
  ctaStyle: string;
}

const ARCHETYPES: Record<string, BusinessArchetype> = {
  agency: {
    id: "agency",
    name: "Agency / Services",
    funnelArchetype: "authority_nurture",
    channelPriority: ["instagram", "linkedin", "whatsapp"],
    trustRequirement: 9,
    proofRequirement: 9,
    contentToConversionWeight: 0.6,
    salesCycleProfile: "medium",
    typicalFormats: ["reels", "carousels", "case_studies"],
    ctaStyle: "consultation_booking",
  },
  ecommerce: {
    id: "ecommerce",
    name: "E-Commerce",
    funnelArchetype: "direct_conversion",
    channelPriority: ["instagram", "tiktok", "facebook"],
    trustRequirement: 5,
    proofRequirement: 7,
    contentToConversionWeight: 0.3,
    salesCycleProfile: "short",
    typicalFormats: ["reels", "stories", "ugc", "ads"],
    ctaStyle: "shop_now",
  },
  restaurant: {
    id: "restaurant",
    name: "Restaurant / Local",
    funnelArchetype: "local_loop",
    channelPriority: ["instagram", "google", "whatsapp"],
    trustRequirement: 4,
    proofRequirement: 6,
    contentToConversionWeight: 0.4,
    salesCycleProfile: "instant",
    typicalFormats: ["stories", "reels", "local_offers"],
    ctaStyle: "visit_order",
  },
  high_ticket: {
    id: "high_ticket",
    name: "High-Ticket Consulting",
    funnelArchetype: "authority_appointment",
    channelPriority: ["linkedin", "instagram", "email"],
    trustRequirement: 10,
    proofRequirement: 10,
    contentToConversionWeight: 0.8,
    salesCycleProfile: "long",
    typicalFormats: ["long_form", "carousels", "webinars", "case_studies"],
    ctaStyle: "book_call",
  },
  saas: {
    id: "saas",
    name: "SaaS / Software",
    funnelArchetype: "trial_conversion",
    channelPriority: ["linkedin", "twitter", "google"],
    trustRequirement: 7,
    proofRequirement: 8,
    contentToConversionWeight: 0.5,
    salesCycleProfile: "medium",
    typicalFormats: ["reels", "tutorials", "carousels", "demos"],
    ctaStyle: "start_trial",
  },
  local_service: {
    id: "local_service",
    name: "Local Service Business",
    funnelArchetype: "local_trust",
    channelPriority: ["instagram", "google", "facebook"],
    trustRequirement: 7,
    proofRequirement: 8,
    contentToConversionWeight: 0.5,
    salesCycleProfile: "short",
    typicalFormats: ["reels", "stories", "before_after", "testimonials"],
    ctaStyle: "contact_whatsapp",
  },
};

export function resolveArchetype(businessType: string): BusinessArchetype {
  const lower = (businessType || "").toLowerCase();
  if (lower.includes("agency") || lower.includes("service") || lower.includes("consulting")) {
    if (lower.includes("high") || lower.includes("premium") || lower.includes("luxury")) return ARCHETYPES.high_ticket;
    if (lower.includes("local")) return ARCHETYPES.local_service;
    return ARCHETYPES.agency;
  }
  if (lower.includes("ecommerce") || lower.includes("shop") || lower.includes("store") || lower.includes("retail")) return ARCHETYPES.ecommerce;
  if (lower.includes("restaurant") || lower.includes("food") || lower.includes("cafe") || lower.includes("bar")) return ARCHETYPES.restaurant;
  if (lower.includes("saas") || lower.includes("software") || lower.includes("tech") || lower.includes("app")) return ARCHETYPES.saas;
  if (lower.includes("local")) return ARCHETYPES.local_service;
  return ARCHETYPES.agency;
}

export interface ReadinessResult {
  gate: "PASS" | "PASS_WITH_ASSUMPTIONS" | "BLOCKED";
  overallScore: number;
  dimensions: {
    businessClarity: number;
    goalSpecificity: number;
    funnelViability: number;
    budgetFeasibility: number;
    executionReadiness: number;
    dataConfidence: number;
  };
  missingItems: string[];
  assumptions: Array<{ item: string; confidence: string; impact: string }>;
  archetype: BusinessArchetype;
}

export async function checkPlanReadiness(campaignId: string, accountId: string): Promise<ReadinessResult> {
  const [bizData] = await db.select().from(businessDataLayer)
    .where(and(eq(businessDataLayer.campaignId, campaignId), eq(businessDataLayer.accountId, accountId)))
    .orderBy(desc(businessDataLayer.createdAt)).limit(1);

  const [campaign] = await db.select().from(growthCampaigns)
    .where(eq(growthCampaigns.id, campaignId)).limit(1);

  const missingItems: string[] = [];
  const assumptions: Array<{ item: string; confidence: string; impact: string }> = [];

  let businessClarity = 100;
  if (!bizData?.businessType) { businessClarity -= 30; missingItems.push("Business type"); }
  if (!bizData?.coreOffer) { businessClarity -= 20; missingItems.push("Core offer/service"); }
  if (!bizData?.targetAudienceSegment && !bizData?.targetAudienceAge) { businessClarity -= 20; missingItems.push("Target audience"); }
  if (!bizData?.primaryConversionChannel) {
    businessClarity -= 15;
    assumptions.push({ item: "Primary channel assumed as Instagram", confidence: "medium", impact: "medium" });
  }

  let goalSpecificity = 100;
  if (!campaign?.objective && !bizData?.funnelObjective) { goalSpecificity -= 40; missingItems.push("Primary goal/objective"); }
  const hasGoalTarget = bizData?.goalTarget && bizData.goalTarget.trim().length > 0;
  const hasGoalTimeline = bizData?.goalTimeline && bizData.goalTimeline.trim().length > 0;
  const hasGoalDescription = bizData?.goalDescription && bizData.goalDescription.trim().length > 0;
  if (!hasGoalTarget) {
    goalSpecificity -= 15;
    assumptions.push({ item: "Goal target will be estimated from business data", confidence: "medium", impact: "medium" });
  }
  if (!hasGoalTimeline && !campaign?.totalDays) {
    goalSpecificity -= 20;
    assumptions.push({ item: "Time horizon assumed as 90 days", confidence: "medium", impact: "low" });
  }
  if (!hasGoalDescription && hasGoalTarget) {
    goalSpecificity -= 5;
  }

  let funnelViability = 100;
  if (!bizData?.primaryConversionChannel) { funnelViability -= 25; }
  if (!bizData?.funnelObjective && !campaign?.objective) { funnelViability -= 25; }

  let budgetFeasibility = 100;
  if (!bizData?.monthlyBudget) {
    budgetFeasibility -= 30;
    assumptions.push({ item: "Budget assumed as modest ($300-500/mo)", confidence: "low", impact: "high" });
  } else {
    const budget = parseFloat(bizData.monthlyBudget.replace(/[^0-9.]/g, "") || "0");
    if (budget < 100) { budgetFeasibility -= 20; missingItems.push("Budget too low for meaningful paid activity"); }
  }

  let executionReadiness = 80;
  let dataConfidence = 70;
  if (bizData) dataConfidence += 15;
  if (campaign) dataConfidence += 15;

  businessClarity = Math.max(0, Math.min(100, businessClarity));
  goalSpecificity = Math.max(0, Math.min(100, goalSpecificity));
  funnelViability = Math.max(0, Math.min(100, funnelViability));
  budgetFeasibility = Math.max(0, Math.min(100, budgetFeasibility));
  executionReadiness = Math.max(0, Math.min(100, executionReadiness));
  dataConfidence = Math.max(0, Math.min(100, dataConfidence));

  const overallScore = Math.round(
    (businessClarity * 0.25 + goalSpecificity * 0.25 + funnelViability * 0.15 + budgetFeasibility * 0.15 + executionReadiness * 0.1 + dataConfidence * 0.1)
  );

  let gate: "PASS" | "PASS_WITH_ASSUMPTIONS" | "BLOCKED" = "PASS";
  if (overallScore < 40 || !bizData?.businessType) gate = "BLOCKED";
  else if (overallScore < 70 || assumptions.length > 0) gate = "PASS_WITH_ASSUMPTIONS";

  const archetype = resolveArchetype(bizData?.businessType || "");

  return {
    gate,
    overallScore,
    dimensions: { businessClarity, goalSpecificity, funnelViability, budgetFeasibility, executionReadiness, dataConfidence },
    missingItems,
    assumptions,
    archetype,
  };
}

export function registerPlanGateRoutes(app: Express) {
  app.post("/api/plan-gate/check", async (req: Request, res: Response) => {
    try {
      const { campaignId } = req.body;
      if (!campaignId) return res.status(400).json({ success: false, error: "campaignId required" });
      const accountId = (req as any).accountId || "default";

      const readiness = await checkPlanReadiness(campaignId, accountId);
      res.json({
        success: true,
        ...readiness,
        verdict: readiness.gate,
        readinessScore: readiness.overallScore,
        gaps: readiness.missingItems,
        archetype: readiness.archetype.id,
        archetypeDetail: readiness.archetype,
        assumptions: readiness.assumptions.map(a => a.item),
      });
    } catch (err: any) {
      console.error("[PlanGate] Check error:", err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get("/api/plan-gate/:campaignId", async (req: Request, res: Response) => {
    try {
      const accountId = (req as any).accountId || "default";
      const readiness = await checkPlanReadiness(req.params.campaignId, accountId);
      res.json({
        success: true,
        ...readiness,
        verdict: readiness.gate,
        readinessScore: readiness.overallScore,
        gaps: readiness.missingItems,
        archetype: readiness.archetype.id,
        archetypeDetail: readiness.archetype,
        assumptions: readiness.assumptions.map(a => a.item),
      });
    } catch (err: any) {
      console.error("[PlanGate] Fetch error:", err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  console.log("[PlanGate] Routes registered: POST /api/plan-gate/check, GET /api/plan-gate/:campaignId");
}
