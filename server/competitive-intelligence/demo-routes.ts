import type { Express } from "express";
import { db } from "../db";
import { ciCompetitors, ciMarketAnalyses, ciRecommendations } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { featureFlagService } from "../feature-flags";

const DEMO_COMPETITORS = [
  {
    name: "Socialeyez",
    platform: "instagram",
    profileLink: "https://instagram.com/socialeyez",
    businessType: "Agency",
    primaryObjective: "Brand authority and premium client acquisition",
    postingFrequency: 6,
    contentTypeRatio: JSON.stringify({ reels: 55, static: 45 }),
    engagementRatio: 3.8,
    ctaPatterns: "Get a Free Audit, Book a Discovery Call, See Our Work, Partner With Us",
    discountFrequency: "No discounts — retainer model only, focuses on value and case studies",
    hookStyles: "Campaign results reveals, Before/after brand transformations, Client spotlight reels, Industry trend breakdowns",
    messagingTone: "Professional, data-backed, premium positioning, confident authority",
    socialProofPresence: "Award badges, client portfolio carousel, case study highlights, Dubai Lynx recognition, published articles",
  },
  {
    name: "Amplify Media",
    platform: "instagram",
    profileLink: "https://instagram.com/amplifymediame",
    businessType: "Agency",
    primaryObjective: "Performance marketing and ROI-driven results",
    postingFrequency: 5,
    contentTypeRatio: JSON.stringify({ reels: 65, static: 35 }),
    engagementRatio: 4.2,
    ctaPatterns: "See the Results, Scale Your Brand, Book a Strategy Call, Watch the Case Study",
    discountFrequency: "Quarterly packages with early-bird pricing, occasional bundle deals",
    hookStyles: "Revenue screenshots, ROAS breakdowns, Client testimonial cuts, Behind-the-scenes of shoots",
    messagingTone: "Results-obsessed, direct, no-fluff, performance-first language",
    socialProofPresence: "ROAS numbers in reels, client revenue milestones, Google reviews showcase, client DM screenshots",
  },
  {
    name: "The Concept Agency",
    platform: "instagram",
    profileLink: "https://instagram.com/theconceptagency",
    businessType: "Agency",
    primaryObjective: "Creative differentiation and viral content",
    postingFrequency: 4,
    contentTypeRatio: JSON.stringify({ reels: 70, static: 30 }),
    engagementRatio: 5.1,
    ctaPatterns: "Let's Create, Start Your Project, Get a Creative Brief, Transform Your Brand",
    discountFrequency: "No discounts — project-based pricing, occasional pro-bono for high-profile brands",
    hookStyles: "Cinematic brand films, Viral content breakdowns, Creative process reveals, Trend-setting concepts",
    messagingTone: "Bold, creative, visually driven, artistic but strategic",
    socialProofPresence: "Viral post metrics, industry awards, brand collaboration reveals, behind-the-scenes team content",
  },
];

const DEMO_ANALYSIS = {
  marketOverview: JSON.stringify({
    summary: "Dubai's social media agency landscape is fiercely competitive, with agencies differentiating across three axes: premium authority (Socialeyez), performance/ROI (Amplify Media), and creative virality (The Concept Agency). Reels dominate the content mix (avg 63%), engagement rates range from 3.8% to 5.1%, and the market is shifting toward results-based proof and away from discount-driven client acquisition. Agencies that combine consistent authority content with measurable client outcomes hold the strongest positioning.",
    competitiveIntensity: "high",
    dominantTrends: ["Reels-first content strategy across all agencies", "Case study and results-driven social proof", "Retainer and project-based pricing over discounts", "Creative differentiation through cinematic content"],
    marketShifts: ["Shift from generic social content to niche authority positioning", "Growing demand for ROAS and revenue proof in agency marketing", "Movement toward creative virality as a differentiator", "Decline of discount-based client acquisition in premium segment"],
  }),
  competitorBreakdown: JSON.stringify([
    { name: "Socialeyez", strengths: ["Highest posting frequency (6x/week)", "Strong industry recognition (Dubai Lynx)", "Premium retainer model with no discount dependency", "Established brand authority with published articles"], weaknesses: ["Lower engagement ratio (3.8%) despite high frequency", "Conservative content mix — lower Reels adoption (55%) vs market", "Heavy reliance on traditional authority signals over viral content"], threatLevel: "high", keyInsight: "Dominates the premium authority lane but leaves engagement and creative differentiation gaps — vulnerable to agencies that combine authority with higher-engagement formats" },
    { name: "Amplify Media", strengths: ["Strong engagement ratio (4.2%)", "Results-obsessed messaging resonates with e-commerce brands", "ROAS and revenue proof creates compelling social proof", "Balanced content cadence (5x/week)"], weaknesses: ["Discount-adjacent positioning with quarterly packages and bundle deals", "Narrow niche focus on e-commerce limits total addressable market", "Lower storytelling depth — content is metric-heavy but lacks narrative"], threatLevel: "high", keyInsight: "Leading in performance proof but the quarterly package deals and narrow e-commerce focus create openings for a full-service agency with broader positioning" },
    { name: "The Concept Agency", strengths: ["Highest engagement ratio in market (5.1%)", "Strongest Reels adoption (70%)", "Creative-first approach generates organic virality", "Cinematic content quality sets visual benchmark"], weaknesses: ["Lowest posting frequency (4x/week) limits reach", "Project-based pricing creates revenue unpredictability", "Creative focus sometimes overshadows strategic messaging", "Limited performance/ROI proof in content"], threatLevel: "medium", keyInsight: "Wins on creativity and engagement but the low frequency and lack of performance proof leave significant gaps in authority and consistency" },
  ]),
  strategicGaps: JSON.stringify([
    { area: "Content Authority", description: "Socialeyez leads in authority with case studies and Dubai Lynx recognition, but their lower engagement (3.8%) shows authority alone doesn't drive interaction. No agency combines authority content with high-engagement creative formats.", opportunity: "Build authority content (case studies, expert insights) using high-engagement formats like Reels and carousel storytelling to capture both trust and interaction", evidenceSource: "Socialeyez engagement ratio (3.8%) vs The Concept Agency (5.1%) — authority without engagement vs engagement without authority" },
    { area: "Pricing Transparency", description: "All three agencies avoid transparent pricing — Socialeyez uses retainer-only, Amplify uses quarterly packages, The Concept Agency uses project-based pricing. No agency openly communicates value-to-price ratios.", opportunity: "Introduce transparent pricing tiers or ROI calculators to reduce friction in the sales funnel and differentiate from competitors who keep pricing opaque", evidenceSource: "Socialeyez retainer model, Amplify Media quarterly packages, The Concept Agency project-based pricing — all opaque" },
    { area: "Client Results Sharing", description: "Amplify Media leads in sharing ROAS numbers and revenue milestones, but Socialeyez and The Concept Agency underutilize measurable results in their content. The market rewards proof but most agencies share it inconsistently.", opportunity: "Systematize client results sharing with weekly metrics posts, monthly case study deep-dives, and real-time campaign result reveals to build compounding social proof", evidenceSource: "Amplify Media ROAS numbers in reels vs Socialeyez case study highlights (less frequent) vs The Concept Agency viral metrics (creative-focused, not ROI-focused)" },
  ]),
  saturationPatterns: "The Dubai agency market is saturated with lifestyle and aesthetic agency branding. Performance-proof content (ROAS, revenue milestones) is growing but inconsistent. The gap lies in combining creative excellence with measurable business outcomes — no agency owns both lanes.",
  differentiationGaps: "No competitor combines high posting frequency with both authority content and creative engagement. Socialeyez has authority but lower engagement. The Concept Agency has engagement but lower frequency. Amplify Media balances frequency and engagement but lacks creative depth. A full-spectrum approach is unoccupied.",
  offerPositioningGaps: "Retainer-only (Socialeyez) and project-based (The Concept Agency) models dominate the premium segment. Performance-based pricing or hybrid retainer-plus-performance models are absent. An agency offering guaranteed-results positioning would disrupt the current landscape.",
  pricingNarrativePatterns: "Socialeyez frames pricing as premium access to proven expertise. Amplify Media frames as ROI investment with quarterly package incentives. The Concept Agency frames as creative partnership with project-based commitment. None use value-ladder or tiered pricing publicly.",
  funnelWeaknesses: "All three agencies rely on single-step CTAs (Book a Call, Start Your Project). No multi-touch nurture sequences, lead magnets, or educational funnels detected. The discovery call is the universal conversion point with no warming mechanism before it.",
  ctaTrends: "Consultation-style CTAs dominate (Free Audit, Discovery Call, Strategy Call). Creative CTAs (Let's Create, Transform Your Brand) from The Concept Agency show higher emotional pull. No agency combines data-driven CTAs with emotional triggers in a systematic way.",
  authorityGaps: "Socialeyez leads with Dubai Lynx recognition and published articles but doesn't leverage them consistently in content. Amplify Media relies on client metrics as authority signals. The Concept Agency uses viral metrics and industry awards. No agency has a systematic thought leadership program (podcast, newsletter, speaking engagements) as a content pillar.",
  dataCompleteness: 1.0,
  status: "completed",
};

const DEMO_RECOMMENDATIONS = [
  {
    category: "content_strategy",
    title: "Deploy Authority-Plus-Engagement Content Framework",
    description: "The Dubai agency market splits between authority (Socialeyez with case studies and Dubai Lynx recognition) and engagement (The Concept Agency with 5.1% engagement through cinematic Reels). No agency combines both. SWA Media should build a content framework that pairs authority signals (client results, expert insights, industry analysis) with high-engagement formats (Reels, carousel storytelling, behind-the-scenes) to own both lanes simultaneously.",
    actionType: "content_clusters",
    actionTarget: "Content Calendar - Content Clusters",
    actionDetails: JSON.stringify({ currentState: "Generic agency content without systematic authority or engagement optimization", proposedChange: "40% authority content (case studies, ROI breakdowns, expert insights in Reels format), 30% creative engagement (cinematic content, trend breakdowns, behind-the-scenes), 20% client spotlight (testimonials, transformation stories), 10% promotional (service highlights, CTAs). Every authority post must use a high-engagement format.", implementation: "1. Create Reels-first authority templates (case study reveals, metric breakdowns)\n2. Schedule 2 authority Reels and 1 creative engagement Reel per week minimum\n3. Build a client results database for consistent proof content\n4. Track engagement-per-authority-post vs competitors monthly" }),
    evidenceCitations: JSON.stringify([
      { competitorName: "Socialeyez", field: "engagementRatio", value: "3.8%", insight: "Strong authority positioning but lower engagement suggests their case study content format isn't optimized for interaction — opportunity to outperform with better format choices" },
      { competitorName: "The Concept Agency", field: "engagementRatio", value: "5.1%", insight: "Highest engagement proves cinematic Reels format drives interaction — adopt this format for authority content to get best of both worlds" },
      { competitorName: "Amplify Media", field: "hookStyles", value: "Revenue screenshots, ROAS breakdowns", insight: "Performance proof hooks generate trust — integrate similar data-driven hooks into creative content formats" },
    ]),
    whyChanged: null,
    confidenceScore: 0.85,
    riskLevel: "low",
    impactRangeLow: 20,
    impactRangeHigh: 40,
    timeframe: "60_days",
  },
  {
    category: "calendar_cadence",
    title: "Establish 5x/Week Strategic Posting Cadence",
    description: "Competitor frequency ranges from 4x/week (The Concept Agency) to 6x/week (Socialeyez). Socialeyez's higher frequency doesn't translate to proportionally higher engagement (3.8% vs The Concept Agency's 5.1% at 4x/week), indicating quality and format matter more than volume. SWA Media should target 5x/week — matching Amplify Media's balanced cadence while ensuring each post serves a strategic purpose in the authority-engagement framework.",
    actionType: "calendar_cadence",
    actionTarget: "Content Calendar - Schedule Settings",
    actionDetails: JSON.stringify({ currentState: "Inconsistent posting schedule without strategic day assignments", proposedChange: "5 posts per week with strategic day mapping: Sunday = Authority Reel (case study/results), Monday = Industry Insight (trend analysis/expert take), Tuesday = Client Spotlight (testimonial/transformation), Thursday = Creative Engagement (behind-the-scenes/process reveal), Saturday = Social Proof (metrics showcase/portfolio highlight).", implementation: "1. Set 5x/week cadence aligned to Dubai work week (Sun-Thu primary)\n2. Assign content types to specific days for audience expectation\n3. Batch-create content in weekly sprints\n4. Review day-specific engagement data monthly to optimize slot assignments" }),
    evidenceCitations: JSON.stringify([
      { competitorName: "Socialeyez", field: "postingFrequency", value: "6x/week", insight: "Highest frequency but only 3.8% engagement — proves more posts without strategic purpose don't guarantee results" },
      { competitorName: "Amplify Media", field: "postingFrequency", value: "5x/week", insight: "Balanced frequency with 4.2% engagement — optimal cadence point between volume and quality" },
      { competitorName: "The Concept Agency", field: "postingFrequency", value: "4x/week", insight: "Lowest frequency yet highest engagement (5.1%) — each post is high-impact, but limited reach due to volume" },
    ]),
    confidenceScore: 0.88,
    riskLevel: "low",
    impactRangeLow: 15,
    impactRangeHigh: 35,
    timeframe: "30_days",
  },
  {
    category: "cta_optimization",
    title: "Build Dual-Track CTA System: Data + Emotion",
    description: "Dubai agency CTAs split into two camps: consultation-driven (Socialeyez's 'Free Audit', Amplify Media's 'Book a Strategy Call') and emotion-driven (The Concept Agency's 'Let's Create', 'Transform Your Brand'). No agency systematically combines both approaches. SWA Media should deploy a dual-track CTA system that uses data-driven CTAs for performance-minded prospects and emotional CTAs for brand-focused prospects, matched to content type.",
    actionType: "cta_library",
    actionTarget: "CTA Engine - CTA Library",
    actionDetails: JSON.stringify({ currentState: "Single CTA approach across all content types", proposedChange: "Track A (Data/Performance): 'See Your Growth Potential', 'Get Your Free Performance Audit', 'Watch How We Scaled [Brand]', 'Book a Strategy Session'. Track B (Creative/Emotional): 'Let's Build Something Bold', 'Transform Your Brand Story', 'See What's Possible', 'Start Your Growth Journey'. Match Track A to authority/results content and Track B to creative/engagement content.", implementation: "1. Create CTA variant library in CTA Engine with both tracks\n2. Assign Track A to authority Reels and case study content\n3. Assign Track B to creative and behind-the-scenes content\n4. A/B test cross-track CTAs monthly to find hybrid winners" }),
    evidenceCitations: JSON.stringify([
      { competitorName: "Socialeyez", field: "ctaPatterns", value: "Get a Free Audit, Book a Discovery Call, See Our Work, Partner With Us", insight: "Consultation CTAs target high-intent buyers but miss emotional connection with creative-first prospects" },
      { competitorName: "Amplify Media", field: "ctaPatterns", value: "See the Results, Scale Your Brand, Book a Strategy Call, Watch the Case Study", insight: "Performance-focused CTAs resonate with ROI-minded clients but feel transactional for brand-building prospects" },
      { competitorName: "The Concept Agency", field: "ctaPatterns", value: "Let's Create, Start Your Project, Get a Creative Brief, Transform Your Brand", insight: "Emotional CTAs drive higher engagement (5.1%) but lack urgency and data-driven trust signals" },
    ]),
    confidenceScore: 0.78,
    riskLevel: "medium",
    impactRangeLow: 10,
    impactRangeHigh: 30,
    timeframe: "60_days",
  },
  {
    category: "offer_positioning",
    title: "Launch Results-Guaranteed Hybrid Pricing Model",
    description: "The Dubai agency market is locked into three pricing models: retainer-only (Socialeyez), quarterly packages with early-bird incentives (Amplify Media), and project-based (The Concept Agency). None offer performance-linked pricing or transparent value ladders. SWA Media can disrupt by introducing a hybrid model that combines retainer stability with performance bonuses tied to measurable outcomes — a model absent from the competitive landscape.",
    actionType: "offer_positioning",
    actionTarget: "Offer Strategy - Positioning",
    actionDetails: JSON.stringify({ currentState: "Standard agency pricing without performance linkage or transparent tiers", proposedChange: "Introduce 3-tier positioning: Tier 1 'Growth Starter' (project-based with defined deliverables), Tier 2 'Scale Partner' (retainer with monthly performance reviews), Tier 3 'Revenue Partner' (retainer plus performance bonus tied to agreed KPIs). Frame all tiers around measurable outcomes, not hours or deliverables.", implementation: "1. Define KPI frameworks for each tier (engagement growth, lead generation, revenue attribution)\n2. Create case study content showing ROI for each tier level\n3. Build a public-facing pricing philosophy page highlighting results-linked approach\n4. Test tier messaging in content for 60 days before full rollout" }),
    evidenceCitations: JSON.stringify([
      { competitorName: "Socialeyez", field: "discountFrequency", value: "No discounts — retainer model only, focuses on value and case studies", insight: "Pure retainer model builds stability but lacks performance accountability — clients increasingly want skin-in-the-game pricing" },
      { competitorName: "Amplify Media", field: "discountFrequency", value: "Quarterly packages with early-bird pricing, occasional bundle deals", insight: "Early-bird and bundle deals introduce discount psychology that erodes premium positioning — opportunity to position above this" },
      { competitorName: "The Concept Agency", field: "discountFrequency", value: "No discounts — project-based pricing, occasional pro-bono for high-profile brands", insight: "Project-based pricing creates feast-or-famine revenue — hybrid retainer solves this while maintaining creative flexibility" },
    ]),
    confidenceScore: 0.76,
    riskLevel: "medium",
    impactRangeLow: 10,
    impactRangeHigh: 30,
    timeframe: "90_days",
  },
  {
    category: "authority_building",
    title: "Build Systematic Thought Leadership Engine",
    description: "Authority signals in the Dubai agency market are fragmented: Socialeyez leverages Dubai Lynx recognition and published articles, Amplify Media uses ROAS numbers and client milestones, The Concept Agency relies on viral metrics and industry awards. No agency runs a systematic thought leadership program. SWA Media should build a compounding authority engine that combines all three proof types with original thought leadership content to establish market-defining expertise.",
    actionType: "content_clusters",
    actionTarget: "Content Calendar - Authority Content Cluster",
    actionDetails: JSON.stringify({ currentState: "Ad-hoc social proof sharing without systematic authority building", proposedChange: "Weekly authority rotation: Week 1 = Client Results Spotlight (ROAS/revenue proof like Amplify Media but in cinematic format), Week 2 = Industry Analysis (original market insights and trend predictions), Week 3 = Case Study Deep-Dive (transformation story with before/after data), Week 4 = Thought Leadership (expert perspective on industry shifts, Dubai market analysis). Monthly: publish one long-form article or industry report to build off-platform authority like Socialeyez.", implementation: "1. Set up monthly authority content calendar with 4-week rotation\n2. Create templates for each authority content type optimized for Reels\n3. Build a client results archive for consistent proof content\n4. Pitch one industry publication per month for byline articles\n5. Track authority score: follower quality, inbound inquiry source, brand mention volume" }),
    evidenceCitations: JSON.stringify([
      { competitorName: "Socialeyez", field: "socialProofPresence", value: "Award badges, client portfolio carousel, case study highlights, Dubai Lynx recognition, published articles", insight: "Strongest traditional authority signals but not systematically leveraged in content — opportunity to outpace with consistent authority content cadence" },
      { competitorName: "Amplify Media", field: "socialProofPresence", value: "ROAS numbers in reels, client revenue milestones, Google reviews showcase, client DM screenshots", insight: "Performance proof is compelling but narrow — combining with creative storytelling and thought leadership creates fuller authority picture" },
      { competitorName: "The Concept Agency", field: "socialProofPresence", value: "Viral post metrics, industry awards, brand collaboration reveals, behind-the-scenes team content", insight: "Creative authority is strong but lacks business-outcome proof — shows the gap between creative recognition and results-based trust" },
    ]),
    confidenceScore: 0.83,
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
