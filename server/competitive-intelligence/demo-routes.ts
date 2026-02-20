import type { Express } from "express";
import { db } from "../db";
import { ciCompetitors, ciMarketAnalyses, ciRecommendations } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { featureFlagService } from "../feature-flags";

const DEMO_COMPETITORS = [
  {
    name: "FreshBites Restaurant",
    platform: "instagram",
    profileLink: "https://instagram.com/freshbites_dubai",
    businessType: "Local",
    primaryObjective: "Leads",
    postingFrequency: 5,
    contentTypeRatio: JSON.stringify({ reels: 60, static: 30, stories: 10 }),
    engagementRatio: 3.2,
    ctaPatterns: "Book Now, Order Online, Visit Us Today, Limited Seats",
    discountFrequency: "Weekly deals every Thursday, 15% off specials",
    hookStyles: "Behind-the-kitchen, Chef spotlight, Customer reactions",
    messagingTone: "Casual, friendly, food-forward with emojis",
    socialProofPresence: "Customer reviews in stories, UGC reposts, 4.8 Google rating badge",
  },
  {
    name: "LuxeStyle Boutique",
    platform: "instagram",
    profileLink: "https://instagram.com/luxestyle_ae",
    businessType: "E-commerce",
    primaryObjective: "Sales",
    postingFrequency: 7,
    contentTypeRatio: JSON.stringify({ reels: 45, static: 40, stories: 15 }),
    engagementRatio: 4.1,
    ctaPatterns: "Shop Now, Swipe Up, Link in Bio, DM to Order",
    discountFrequency: "Flash sales monthly, seasonal clearance, loyalty discounts",
    hookStyles: "Outfit-of-the-day, Before/after styling, Trend alerts",
    messagingTone: "Aspirational, premium, fashion-forward",
    socialProofPresence: "Influencer collabs, customer photo wall, press features",
  },
  {
    name: "DigitalPro Agency",
    platform: "instagram",
    profileLink: "https://instagram.com/digitalpro_agency",
    businessType: "Service",
    primaryObjective: "Premium positioning",
    postingFrequency: 3,
    contentTypeRatio: JSON.stringify({ reels: 70, static: 20, stories: 10 }),
    engagementRatio: 2.8,
    ctaPatterns: "Book a Call, Free Audit, Get Results, See Case Study",
    discountFrequency: "Rare - only annual offers, focuses on value over price",
    hookStyles: "Case study reveals, ROI breakdowns, Myth busting, Client wins",
    messagingTone: "Professional, authoritative, data-driven, educational",
    socialProofPresence: "Detailed case studies, ROI numbers, client video testimonials, certifications",
  },
];

const DEMO_ANALYSIS = {
  marketOverview: JSON.stringify({
    summary: "The local Dubai market shows high competitive intensity with businesses investing heavily in Reels content (avg 58% of content mix). Engagement rates range from 2.8% to 4.1%, with e-commerce leading. CTA patterns are predominantly direct-action focused, with service businesses emphasizing consultation funnels.",
    competitiveIntensity: "high",
    dominantTrends: ["Reels-first content strategy", "UGC and social proof emphasis", "Direct CTA with booking integration", "Behind-the-scenes authenticity"],
    marketShifts: ["Shift from static to video content", "Increased focus on social proof", "Move toward premium positioning over discount battles"],
  }),
  competitorBreakdown: JSON.stringify([
    { name: "FreshBites Restaurant", strengths: ["Strong posting frequency (5x/week)", "High social proof (Google rating + UGC)", "Community engagement through behind-the-scenes"], weaknesses: ["Heavy discount reliance", "Low Reels ratio vs market", "Weak authority positioning"], threatLevel: "medium", keyInsight: "Relies on deals to drive traffic - vulnerable to value-based differentiation" },
    { name: "LuxeStyle Boutique", strengths: ["Highest engagement (4.1%)", "Strong influencer strategy", "Consistent posting (7x/week)"], weaknesses: ["Over-reliance on fashion trends", "Multiple CTA dilution", "No long-form authority content"], threatLevel: "high", keyInsight: "Leading in engagement but spreading thin - concentrated strategy could overtake" },
    { name: "DigitalPro Agency", strengths: ["Strong authority (case studies + data)", "Premium positioning without discounts", "High Reels adoption (70%)"], weaknesses: ["Low posting frequency (3x/week)", "Lower engagement than market average", "Limited social proof variety"], threatLevel: "medium", keyInsight: "Quality over quantity approach leaving visibility gaps" },
  ]),
  strategicGaps: JSON.stringify([
    { area: "Content Cadence", description: "Gap between LuxeStyle's 7x/week and DigitalPro's 3x/week shows the market rewards consistency", opportunity: "Position at 4-5x/week with focused quality content to capture visibility without content fatigue", evidenceSource: "FreshBites (5x) and LuxeStyle (7x) posting frequency data" },
    { area: "Authority Content", description: "Only DigitalPro invests in authority building (case studies, ROI data) while others focus on surface-level content", opportunity: "Build authority through data-driven content while maintaining engagement through storytelling", evidenceSource: "DigitalPro's case study approach vs FreshBites/LuxeStyle social-only strategy" },
    { area: "Discount Dependency", description: "FreshBites and LuxeStyle both rely heavily on discounts to drive action", opportunity: "Position on value/results rather than price to capture premium segment", evidenceSource: "FreshBites weekly deals, LuxeStyle monthly flash sales vs DigitalPro's no-discount model" },
  ]),
  saturationPatterns: "Market is saturated with lifestyle/aesthetic content. Authority and educational content remains underserved. Opportunity in data-driven storytelling.",
  differentiationGaps: "No competitor combines high posting frequency with authority content. Gap exists for consistent, data-backed content strategy.",
  offerPositioningGaps: "Price-based positioning dominates (FreshBites deals, LuxeStyle sales). Value-based positioning is underserved.",
  pricingNarrativePatterns: "FreshBites frames value as deals/savings. LuxeStyle frames as aspirational access. DigitalPro frames as ROI/investment.",
  funnelWeaknesses: "All competitors use simple CTA funnels. No multi-step nurture sequences detected. Opportunity for lead nurture differentiation.",
  ctaTrends: "Direct action CTAs dominate (Book Now, Shop Now). Consultation-style CTAs (Free Audit, Book a Call) show higher intent. Hybrid approach recommended.",
  authorityGaps: "Only DigitalPro shows authority signals. FreshBites and LuxeStyle lack educational/expertise content.",
  dataCompleteness: 1.0,
  status: "completed",
};

const DEMO_RECOMMENDATIONS = [
  {
    category: "content_strategy",
    title: "Shift to Authority-First Content Mix",
    description: "Based on competitor analysis, authority content (case studies, data insights, educational posts) is severely underserved. Only DigitalPro Agency invests in this area, yet they maintain 2.8% engagement with just 3 posts/week. Combining their authority approach with higher frequency could capture the premium positioning gap.",
    actionType: "content_clusters",
    actionTarget: "Content Calendar - Content Clusters",
    actionDetails: JSON.stringify({ currentState: "Generic promotional content mix", proposedChange: "40% authority/educational, 35% engagement/social proof, 25% promotional/CTA. Include weekly case studies, ROI breakdowns, and expert insights.", implementation: "1. Create authority content templates in Content Calendar\n2. Schedule 2 authority posts per week\n3. Track engagement vs promotional content\n4. Adjust ratio monthly based on performance" }),
    evidenceCitations: JSON.stringify([
      { competitorName: "DigitalPro Agency", field: "hookStyles", value: "Case study reveals, ROI breakdowns", insight: "Authority content drives premium positioning even with lower frequency" },
      { competitorName: "LuxeStyle Boutique", field: "engagementRatio", value: "4.1%", insight: "High engagement possible with consistent posting - combine with authority for premium growth" },
      { competitorName: "FreshBites Restaurant", field: "hookStyles", value: "Behind-the-kitchen, Customer reactions", insight: "Authenticity hooks work but lack authority depth" },
    ]),
    whyChanged: null,
    confidenceScore: 0.82,
    riskLevel: "low",
    impactRangeLow: 15,
    impactRangeHigh: 35,
    timeframe: "60_days",
  },
  {
    category: "calendar_cadence",
    title: "Increase Posting Frequency to 5x/Week",
    description: "Competitor data shows a clear correlation between posting frequency and engagement. LuxeStyle at 7x/week leads engagement (4.1%), while DigitalPro at 3x/week trails (2.8%). The optimal balance is 5x/week - matching FreshBites' cadence while avoiding content fatigue.",
    actionType: "calendar_cadence",
    actionTarget: "Content Calendar - Schedule Settings",
    actionDetails: JSON.stringify({ currentState: "Inconsistent posting schedule", proposedChange: "5 posts per week: Mon/Tue/Thu/Fri/Sat. Monday = Authority, Tuesday = Engagement, Thursday = Value/Offer, Friday = Social Proof, Saturday = Behind-the-Scenes.", implementation: "1. Set weekly cadence in Calendar settings\n2. Assign content types to each day\n3. Batch-create content weekly\n4. Review engagement metrics per day slot" }),
    evidenceCitations: JSON.stringify([
      { competitorName: "LuxeStyle Boutique", field: "postingFrequency", value: "7x/week", insight: "Highest frequency correlates with highest engagement (4.1%)" },
      { competitorName: "DigitalPro Agency", field: "postingFrequency", value: "3x/week", insight: "Lowest frequency correlates with lowest engagement (2.8%)" },
      { competitorName: "FreshBites Restaurant", field: "postingFrequency", value: "5x/week", insight: "Mid-range frequency with solid 3.2% engagement - optimal balance point" },
    ]),
    confidenceScore: 0.88,
    riskLevel: "low",
    impactRangeLow: 20,
    impactRangeHigh: 40,
    timeframe: "30_days",
  },
  {
    category: "cta_optimization",
    title: "Adopt Hybrid CTA Strategy (Consultation + Direct)",
    description: "Analysis reveals two distinct CTA approaches: direct action (FreshBites/LuxeStyle) and consultation-based (DigitalPro). No competitor combines both. A hybrid approach using consultation CTAs for cold traffic and direct CTAs for warm audiences could capture both segments.",
    actionType: "cta_library",
    actionTarget: "CTA Engine - CTA Library",
    actionDetails: JSON.stringify({ currentState: "Single CTA style across all content", proposedChange: "Create two CTA tracks: Track A (Cold) = 'Free Strategy Session', 'See How We Did It', 'Get Your Audit'. Track B (Warm) = 'Book Now', 'Start Today', 'Get Started'.", implementation: "1. Create CTA variants in CTA Engine\n2. Assign Track A to authority content\n3. Assign Track B to promotional content\n4. A/B test within tracks monthly" }),
    evidenceCitations: JSON.stringify([
      { competitorName: "DigitalPro Agency", field: "ctaPatterns", value: "Book a Call, Free Audit, See Case Study", insight: "Consultation CTAs target high-intent buyers willing to invest" },
      { competitorName: "FreshBites Restaurant", field: "ctaPatterns", value: "Book Now, Order Online, Visit Us Today", insight: "Direct CTAs drive immediate action but miss nurture opportunities" },
      { competitorName: "LuxeStyle Boutique", field: "ctaPatterns", value: "Shop Now, Swipe Up, Link in Bio, DM to Order", insight: "Multiple direct CTAs dilute focus - consolidation needed" },
    ]),
    confidenceScore: 0.75,
    riskLevel: "medium",
    impactRangeLow: 10,
    impactRangeHigh: 30,
    timeframe: "60_days",
  },
  {
    category: "offer_positioning",
    title: "Eliminate Discount Dependency - Shift to Value Positioning",
    description: "FreshBites runs weekly deals and LuxeStyle runs monthly flash sales, creating a discount-saturated market. DigitalPro's no-discount model with premium positioning and case studies shows this segment is underserved. Shifting to value-based positioning differentiates from discount competitors.",
    actionType: "offer_positioning",
    actionTarget: "Offer Strategy - Positioning",
    actionDetails: JSON.stringify({ currentState: "Price-competitive positioning", proposedChange: "Replace discounts with value framing: '10x ROI guarantee', 'Results-backed approach', 'Premium outcomes, not premium prices'. Use case studies and data as proof points.", implementation: "1. Audit current discount-based offers\n2. Replace with value-frame alternatives\n3. Create 3 case study templates\n4. Test value vs discount CTAs for 30 days" }),
    evidenceCitations: JSON.stringify([
      { competitorName: "FreshBites Restaurant", field: "discountFrequency", value: "Weekly deals every Thursday, 15% off specials", insight: "High discount frequency erodes perceived value over time" },
      { competitorName: "LuxeStyle Boutique", field: "discountFrequency", value: "Flash sales monthly, seasonal clearance", insight: "Regular sales condition customers to wait for deals" },
      { competitorName: "DigitalPro Agency", field: "discountFrequency", value: "Rare - only annual offers", insight: "No-discount model supports premium pricing and higher margins" },
    ]),
    confidenceScore: 0.79,
    riskLevel: "medium",
    impactRangeLow: 5,
    impactRangeHigh: 25,
    timeframe: "90_days",
  },
  {
    category: "authority_building",
    title: "Launch Social Proof Amplification System",
    description: "Social proof is used by all competitors but none systematically amplify it. FreshBites uses Google ratings, LuxeStyle uses influencer collabs, DigitalPro uses case studies. A unified social proof system combining all three approaches creates compounding authority.",
    actionType: "content_clusters",
    actionTarget: "Content Calendar - Authority Content Cluster",
    actionDetails: JSON.stringify({ currentState: "Occasional social proof in stories", proposedChange: "Weekly social proof system: Week 1 = Client result spotlight, Week 2 = Data/metric showcase, Week 3 = UGC/review compilation, Week 4 = Case study deep dive.", implementation: "1. Set up monthly social proof calendar\n2. Create templates for each proof type\n3. Collect and organize proof assets weekly\n4. Track authority score metrics monthly" }),
    evidenceCitations: JSON.stringify([
      { competitorName: "FreshBites Restaurant", field: "socialProofPresence", value: "Customer reviews in stories, UGC reposts, 4.8 Google rating", insight: "Rating-based proof builds trust but is passive - needs amplification" },
      { competitorName: "LuxeStyle Boutique", field: "socialProofPresence", value: "Influencer collabs, customer photo wall", insight: "Visual proof drives engagement but lacks data depth" },
      { competitorName: "DigitalPro Agency", field: "socialProofPresence", value: "Case studies, ROI numbers, video testimonials", insight: "Data-backed proof commands premium positioning - strongest approach" },
    ]),
    confidenceScore: 0.85,
    riskLevel: "low",
    impactRangeLow: 15,
    impactRangeHigh: 40,
    timeframe: "60_days",
  },
];

export function registerCiDemoRoutes(app: Express) {
  app.post("/api/ci/demo/load", async (req, res) => {
    try {
      const accountId = (req.body.accountId as string) || "default";

      await featureFlagService.setFlag("competitive_intelligence_enabled", true, accountId, "system", "Demo mode activated");

      const existingDemo = await db.select().from(ciCompetitors)
        .where(and(eq(ciCompetitors.accountId, accountId), eq(ciCompetitors.isDemo, true)));
      if (existingDemo.length > 0) {
        return res.json({ message: "Demo data already loaded", alreadyLoaded: true });
      }

      const savedCompetitors = [];
      for (const comp of DEMO_COMPETITORS) {
        const [saved] = await db.insert(ciCompetitors).values({
          ...comp,
          accountId,
          isDemo: true,
        }).returning();
        savedCompetitors.push(saved);
      }

      const currentMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;

      const [savedAnalysis] = await db.insert(ciMarketAnalyses).values({
        accountId,
        analysisMonth: currentMonth,
        ...DEMO_ANALYSIS,
        isDemo: true,
      }).returning();

      const savedRecs = [];
      for (const rec of DEMO_RECOMMENDATIONS) {
        const [saved] = await db.insert(ciRecommendations).values({
          ...rec,
          accountId,
          analysisId: savedAnalysis.id,
          status: "pending",
          isDemo: true,
        }).returning();
        savedRecs.push(saved);
      }

      res.json({
        success: true,
        competitors: savedCompetitors,
        analysis: savedAnalysis,
        recommendations: savedRecs,
        message: "Demo data loaded with 3 sample competitors and AI analysis",
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/ci/demo/clear", async (req, res) => {
    try {
      const accountId = (req.body.accountId as string) || "default";

      const demoAnalyses = await db.select().from(ciMarketAnalyses)
        .where(and(eq(ciMarketAnalyses.accountId, accountId), eq(ciMarketAnalyses.isDemo, true)));

      for (const a of demoAnalyses) {
        await db.delete(ciRecommendations).where(eq(ciRecommendations.analysisId, a.id));
      }

      await db.delete(ciMarketAnalyses)
        .where(and(eq(ciMarketAnalyses.accountId, accountId), eq(ciMarketAnalyses.isDemo, true)));

      await db.delete(ciCompetitors)
        .where(and(eq(ciCompetitors.accountId, accountId), eq(ciCompetitors.isDemo, true)));

      res.json({ success: true, message: "Demo data cleared" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
