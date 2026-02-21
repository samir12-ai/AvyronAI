import type { Express, Request, Response } from "express";
import { db } from "../db";
import { strategicBlueprints, blueprintCompetitors } from "@shared/schema";
import { logAuditEvent } from "./audit-logger";

interface DemoScenario {
  name: string;
  description: string;
  campaignContext: {
    campaignId: string;
    campaignName: string;
    objective: string;
    location: string;
    platform: string;
    isDemo: boolean;
  };
  competitorUrls: string[];
  averageSellingPrice: number;
  draftBlueprint: Record<string, any>;
}

const DEMO_SCENARIOS: Record<string, DemoScenario> = {
  luxury_skincare: {
    name: "Luxury Skincare Launch",
    description: "Premium skincare brand launching a new anti-aging serum in Dubai. High price point, authority positioning.",
    campaignContext: {
      campaignId: "DEMO_LUXURY_SKINCARE",
      campaignName: "Luxury Skincare Serum Launch",
      objective: "product_launch",
      location: "Dubai, UAE",
      platform: "instagram",
      isDemo: true,
    },
    competitorUrls: [
      "https://www.lamer.com",
      "https://www.skinceuticals.com",
      "https://www.drunkElephant.com",
    ],
    averageSellingPrice: 450,
    draftBlueprint: {
      detectedOffer: { value: "New Retinol+Peptide Complex Serum — Launch Price AED 1,650 (reg. AED 1,950)", confidence: 92 },
      detectedCTA: { value: "Shop the Launch Collection — Free Consultation with Purchase", confidence: 88 },
      detectedPositioning: { value: "premium", confidence: 95 },
      detectedAudienceGuess: { value: "Women 28-55, high income, beauty-conscious, Dubai/Abu Dhabi residents", confidence: 85 },
      detectedFunnelStage: { value: "awareness", confidence: 80 },
      detectedPriceIfVisible: { value: "AED 1,650", confidence: 90 },
      detectedLanguage: { value: "English", confidence: 98 },
      transcribedText: { value: "Unlock ageless beauty with our scientifically proven Retinol+Peptide Complex. Now available exclusively at select locations in Dubai.", confidence: 88 },
    },
  },
  restaurant_promo: {
    name: "Restaurant Grand Opening",
    description: "Mid-range restaurant opening in Dubai Marina. Focus on foot traffic and reservations.",
    campaignContext: {
      campaignId: "DEMO_RESTAURANT",
      campaignName: "Marina Bites Grand Opening",
      objective: "local_awareness",
      location: "Dubai Marina, Dubai, UAE",
      platform: "facebook",
      isDemo: true,
    },
    competitorUrls: [
      "https://www.pierchic.com",
      "https://www.zenmarina.ae",
    ],
    averageSellingPrice: 120,
    draftBlueprint: {
      detectedOffer: { value: "Grand Opening — 30% off all mains for the first 2 weeks + complimentary welcome drink", confidence: 90 },
      detectedCTA: { value: "Reserve Your Table Now — Link in Bio", confidence: 92 },
      detectedPositioning: { value: "value", confidence: 78 },
      detectedAudienceGuess: { value: "Residents and tourists in Dubai Marina, 25-45, food enthusiasts, couples and groups", confidence: 82 },
      detectedFunnelStage: { value: "consideration", confidence: 75 },
      detectedPriceIfVisible: { value: "AED 85-150 per person", confidence: 70 },
      detectedLanguage: { value: "English/Arabic", confidence: 95 },
      transcribedText: { value: "Experience Mediterranean fusion at Marina Bites. Grand opening special — 30% off all mains!", confidence: 85 },
    },
  },
  fitness_app: {
    name: "Fitness App Subscription",
    description: "Digital fitness app targeting Dubai professionals. Subscription model with free trial.",
    campaignContext: {
      campaignId: "DEMO_FITNESS_APP",
      campaignName: "FitPro App Launch Campaign",
      objective: "app_installs",
      location: "Dubai, UAE",
      platform: "instagram",
      isDemo: true,
    },
    competitorUrls: [
      "https://www.myfitnesspal.com",
      "https://www.fitbit.com",
      "https://www.nike.com/ntc-app",
    ],
    averageSellingPrice: 35,
    draftBlueprint: {
      detectedOffer: { value: "7-Day Free Trial + 50% off first 3 months (AED 17.50/mo instead of AED 35/mo)", confidence: 88 },
      detectedCTA: { value: "Download Free — Start Your Transformation Today", confidence: 91 },
      detectedPositioning: { value: "convenience", confidence: 80 },
      detectedAudienceGuess: { value: "Dubai professionals 22-40, health-conscious, busy schedules, gym-goers and home workout enthusiasts", confidence: 84 },
      detectedFunnelStage: { value: "conversion", confidence: 85 },
      detectedPriceIfVisible: { value: "AED 17.50/month (promo)", confidence: 92 },
      detectedLanguage: { value: "English", confidence: 97 },
      transcribedText: { value: "Your personal trainer, nutritionist, and accountability partner — all in one app. Start free for 7 days.", confidence: 86 },
    },
  },
  ecommerce_fashion: {
    name: "E-commerce Fashion Sale",
    description: "Online fashion retailer running a seasonal clearance in Dubai. Discount positioning with urgency.",
    campaignContext: {
      campaignId: "DEMO_FASHION_SALE",
      campaignName: "Summer Clearance Sale",
      objective: "sales",
      location: "Dubai, UAE",
      platform: "instagram",
      isDemo: true,
    },
    competitorUrls: [
      "https://www.namshi.com",
      "https://www.ounass.ae",
    ],
    averageSellingPrice: 250,
    draftBlueprint: {
      detectedOffer: { value: "Summer Clearance — Up to 70% off designer brands. Extra 15% with code SUMMER15", confidence: 93 },
      detectedCTA: { value: "Shop Now — Sale Ends Sunday", confidence: 94 },
      detectedPositioning: { value: "discount", confidence: 90 },
      detectedAudienceGuess: { value: "Fashion-forward women 20-38, Dubai residents, online shoppers, brand-conscious but deal-seeking", confidence: 86 },
      detectedFunnelStage: { value: "conversion", confidence: 88 },
      detectedPriceIfVisible: { value: "AED 75-750 (discounted)", confidence: 82 },
      detectedLanguage: { value: "English", confidence: 96 },
      transcribedText: { value: "Don't miss our biggest sale of the year. Up to 70% off your favorite designers. Use code SUMMER15 for an extra 15% off.", confidence: 90 },
    },
  },
};

export function registerDemoRoutes(app: Express) {
  app.get("/api/strategic/demo-scenarios", async (_req: Request, res: Response) => {
    const scenarios = Object.entries(DEMO_SCENARIOS).map(([key, s]) => ({
      id: key,
      name: s.name,
      description: s.description,
      location: s.campaignContext.location,
      platform: s.campaignContext.platform,
      objective: s.campaignContext.objective,
      pricePoint: s.averageSellingPrice,
    }));
    res.json({ success: true, scenarios });
  });

  app.post("/api/strategic/demo-load", async (req: Request, res: Response) => {
    try {
      const { scenarioId, accountId = "default" } = req.body;

      if (!scenarioId || !DEMO_SCENARIOS[scenarioId]) {
        return res.status(400).json({
          error: "INVALID_SCENARIO",
          message: `Scenario '${scenarioId}' not found. Available: ${Object.keys(DEMO_SCENARIOS).join(", ")}`,
          availableScenarios: Object.keys(DEMO_SCENARIOS),
        });
      }

      const scenario = DEMO_SCENARIOS[scenarioId];

      const [blueprint] = await db.insert(strategicBlueprints).values({
        accountId,
        campaignId: scenario.campaignContext.campaignId,
        campaignContext: JSON.stringify(scenario.campaignContext),
        blueprintVersion: 1,
        status: "EXTRACTION_COMPLETE",
        competitorUrls: JSON.stringify(scenario.competitorUrls),
        averageSellingPrice: scenario.averageSellingPrice,
        draftBlueprint: JSON.stringify(scenario.draftBlueprint),
        creativeAnalysis: JSON.stringify(scenario.draftBlueprint),
        gatePassedAt: new Date(),
        analysisCompletedAt: new Date(),
      }).returning();

      const competitorInserts = scenario.competitorUrls.map((url) => ({
        blueprintId: blueprint.id,
        url,
      }));
      await db.insert(blueprintCompetitors).values(competitorInserts);

      await logAuditEvent({
        accountId,
        campaignId: scenario.campaignContext.campaignId,
        blueprintId: blueprint.id,
        blueprintVersion: 1,
        event: "DEMO_LOADED",
        details: { scenarioId, scenarioName: scenario.name },
      });

      await logAuditEvent({
        accountId,
        campaignId: scenario.campaignContext.campaignId,
        blueprintId: blueprint.id,
        blueprintVersion: 1,
        event: "GATE_PASSED",
        details: { source: "demo_loader", competitorCount: scenario.competitorUrls.length },
      });

      await logAuditEvent({
        accountId,
        campaignId: scenario.campaignContext.campaignId,
        blueprintId: blueprint.id,
        blueprintVersion: 1,
        event: "EXTRACTION_COMPLETED",
        details: { source: "demo_loader", mediaType: "simulated" },
      });

      res.json({
        success: true,
        blueprintId: blueprint.id,
        blueprintVersion: 1,
        status: "EXTRACTION_COMPLETE",
        scenarioName: scenario.name,
        scenarioDescription: scenario.description,
        campaignContext: scenario.campaignContext,
        draftBlueprint: scenario.draftBlueprint,
        competitorCount: scenario.competitorUrls.length,
        averageSellingPrice: scenario.averageSellingPrice,
        nextStep: "Review the draft blueprint, edit fields if needed, then confirm.",
      });
    } catch (error: any) {
      console.error("[StrategicCore] Demo load error:", error.message);
      res.status(500).json({ error: "Failed to load demo scenario" });
    }
  });
}
