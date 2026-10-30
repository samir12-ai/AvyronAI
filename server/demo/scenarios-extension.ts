/**
 * AVYRON DEMO ENVIRONMENT — Extended Watchtower (10 Events), Performance Loop (5 Cases),
 * and Composable Deep Reasoning Scenarios (3 Actionable Scenarios: A, B, C)
 *
 * Brand:            Zeytun Atelier (https://zeytun-atelier.demo.invalid)
 * Selected Product: Antep Pistachio Baklava & Kadayif Assortment Box (400g / 18 pieces)
 * Market & Budget:  United States · $32 USD Single Tin / $60 USD 2-Tin Bundle / $118 USD 4-Tin Pack · $4,500/mo
 */

import {
  DEMO_ACCOUNT_ID,
  DEMO_BRAND_NAME,
  DEMO_CAMPAIGN_ID,
  DEMO_OFFERING_NAME,
} from "./config";
import {
  buildDemoEvidenceUrl,
  buildDemoStrategicPlanJson,
  buildDemoExecutionTasks,
  DEMO_APPROVED_PAINS,
  DEMO_DESIRES,
  DEMO_EVIDENCE_RECORDS,
  DEMO_IDS,
  DEMO_OBJECTIONS,
  DemoEvidenceRecord,
} from "./fixtures";

export type DemoScenarioId =
  | "SCENARIO_A_PRICE"
  | "SCENARIO_B_GIFTING"
  | "SCENARIO_C_PACKSIZE";

export const DEMO_SCENARIO_IDS: DemoScenarioId[] = [
  "SCENARIO_A_PRICE",
  "SCENARIO_B_GIFTING",
  "SCENARIO_C_PACKSIZE",
];

// ============================================================================
// 1. ADDITIONAL SYNTHETIC EVIDENCE RECORDS FOR THE 10 WATCHTOWER EVENTS
// ============================================================================
export const DEMO_ADDITIONAL_EVIDENCE_RECORDS: DemoEvidenceRecord[] = [
  {
    id: "ev_wt_altin_gifting_02",
    domainSlug: "altinfistik-confections.demo.invalid",
    competitorId: DEMO_IDS.competitors.altinfistik,
    competitorName: "AltınFıstık Confections",
    sourceType: "WATCHTOWER_DIFF",
    platform: "website_diff",
    sentiment: "OBSERVATION",
    publishedAt: "2026-10-14",
    title:
      "Watchtower Snapshot Diff: AltınFıstık Launches Self-Serve 'Executive & Holiday Multi-Box Gift Concierge'",
    verbatimText:
      "BEFORE (Snapshot 2026-10-01): '400g Royal Pistachio Gold Gift Box — $36.00 USD. For corporate orders of 10+ boxes, email corporate@altinfistik-confections.demo.invalid.'\nAFTER (Snapshot 2026-10-14): 'NEW FOR Q4 HOSTING & CLIENT GIFTING: Self-Serve Multi-Box Gift Desk on PDP — 2-Box Client Duo ($70 USD) & 4-Box Executive Appreciation Set ($136 USD) with instant printed gift-note entry and multi-recipient address upload. Ships via 5-day ground (free over $95).'",
    productReferenced: "AltınFıstık 2-Box & 4-Box Executive Gift Sets",
    packSizeAndPrice: "2x400g ($70 USD) / 4x400g ($136 USD)",
    strategicTakeaway:
      "Signals a strong seasonal & corporate multi-box gifting surge, but exposes AltınFıstık's higher bundle pricing ($70/$136 vs our $60/$118) and slow 5-day ground shipping.",
    linkedPains: ["pain_demo_gift_presentation", "pain_demo_transit_crushing"],
  },
  {
    id: "ev_wt_packsize_qa_03",
    domainSlug: "kervansaray-baklava.demo.invalid",
    competitorId: DEMO_IDS.competitors.kervansaray,
    competitorName: "KervanSaray Baklava",
    sourceType: "SOCIAL_POST",
    platform: "instagram_comments",
    sentiment: "MIXED",
    publishedAt: "2026-10-13",
    title:
      "Repeated Buyer Comment & PDP Q&A Cluster: 'Is one 400g tin (18 pieces) enough for 10–12 dinner guests?'",
    verbatimText:
      "Aggregated across 34 recent buyer comments on KervanSaray Baklava and AltınFıstık Confections 400g carousel posts:\n• @elena_hosts_nyc: 'We are hosting 12 people for Friday dinner—does one 400g box have enough pieces or will the tray look half-empty?'\n• @tarik.k: 'I bought one 400g tin for a 10-person family gathering and wished I had ordered two tins (36 pieces) so everyone could try both pistachio baklava and kadayif.'\n• Competitor PDP Update: KervanSaray added a static badge '1 Tin = 6–8 servings' without explaining piece count by pastry type.",
    productReferenced: "400g (18-Piece) vs 800g 2-Tin (36-Piece) Assortment Format",
    packSizeAndPrice: "400g (18 pcs · $32) vs 800g 2-Tin Bundle (36 pcs · $60)",
    strategicTakeaway:
      "Ambiguous guest-serving guidance causes hosts of 10–16 person gatherings to either hesitate at checkout or under-order a single 400g tin instead of the $60 2-Tin Host Bundle.",
    linkedPains: ["pain_demo_gift_presentation"],
  },
  {
    id: "ev_wt_altin_ship_04",
    domainSlug: "altinfistik-confections.demo.invalid",
    competitorId: DEMO_IDS.competitors.altinfistik,
    competitorName: "AltınFıstık Confections",
    sourceType: "WATCHTOWER_DIFF",
    platform: "website_diff",
    sentiment: "OBSERVATION",
    publishedAt: "2026-10-12",
    title:
      "Watchtower Policy Diff: AltınFıstık Raises Free US Shipping Threshold from $75 to $95 USD",
    verbatimText:
      "BEFORE (Snapshot 2026-09-29): 'Complimentary standard US ground shipping (5 business days) on all orders over $75.00 USD.'\nAFTER (Snapshot 2026-10-12): 'Complimentary standard US ground shipping (5 business days) on all orders over $95.00 USD (requires 3 boxes at $36 USD). Expedited 2-day air available for +$24.00 USD surcharge.'",
    productReferenced: "AltınFıstık 400g Royal Pistachio Gold Gift Box",
    packSizeAndPrice: "400g · $36 USD ($95 free ground threshold)",
    strategicTakeaway:
      "Validates our existing $60 2-Tin Host Bundle offer (which includes Free 2-Day US Air Shipping at a $35 lower threshold than AltınFıstık's $95 ground threshold).",
    linkedPains: ["pain_demo_transit_crushing"],
  },
  {
    id: "ev_wt_serbet_size_05",
    domainSlug: "serbetcihan-gifting.demo.invalid",
    competitorId: DEMO_IDS.competitors.serbetcihan,
    competitorName: "Şerbetçi Han Gifting",
    sourceType: "COMPETITOR_CATALOG",
    platform: "website_diff",
    sentiment: "OBSERVATION",
    publishedAt: "2026-10-11",
    title:
      "Watchtower Catalog Addition: Şerbetçi Han Adds 1.0kg Family Banquet Tray ($68 USD + $24 DHL Express)",
    verbatimText:
      "NEW SKU DETECTED: 'Şerbetçi Han 1,000g (42-Piece) Karaköy Family Banquet Tray — $68.00 USD + $24.00 USD International DHL Express to United States ($92.00 USD landed cost). Unsealed paper-wrapped presentation tray; 4–6 day cross-border transit.'",
    productReferenced: "Şerbetçi Han 1.0kg Family Banquet Tray",
    packSizeAndPrice: "1,000g · $68 USD + $24 Int'l Shipping ($92 USD Landed)",
    strategicTakeaway:
      "At $92 USD landed with customs exposure, this 1kg import tray is non-competitive against Zeytun Atelier's domestic $60 2-Tin Bundle (800g / 36 pieces in two nitrogen-sealed tins with free 2-day US air).",
    linkedPains: ["pain_demo_transit_crushing"],
  },
  {
    id: "ev_wt_altin_complaints_06",
    domainSlug: "altinfistik-confections.demo.invalid",
    competitorId: DEMO_IDS.competitors.altinfistik,
    competitorName: "AltınFıstık Confections",
    sourceType: "CUSTOMER_REVIEW",
    platform: "trustpilot",
    sentiment: "NEGATIVE",
    publishedAt: "2026-10-11",
    title:
      "Repeated Customer Complaint Pattern: 14 Reviews Cite Soft Kadayif & Leaked Syrup After 5-Day Ground Transit",
    verbatimText:
      "Cluster of 14 verified US buyer reviews (Oct 1–Oct 11, 2026) on AltınFıstık 400g Royal Assortment ($36):\n• 'The gold box is pretty, but after 5 days on a UPS ground truck to Texas, the shredded kadayif was completely limp and syrup stained the satin ribbon.'\n• 'Pieces slid into each other because there is no individual cell tray inside the box.'",
    productReferenced: "AltınFıstık 400g Royal Pistachio Assortment",
    packSizeAndPrice: "400g · $36 USD",
    strategicTakeaway:
      "Directly reinforces our existing Pillar 2 (hermetic nitrogen-flushed steel tin + 18-cell rigid honeycomb divider + 2-day air dispatch). Operational proof asset already live.",
    linkedPains: ["pain_demo_transit_crushing", "pain_demo_syrup_soggy"],
  },
  {
    id: "ev_wt_serbet_asmr_07",
    domainSlug: "serbetcihan-gifting.demo.invalid",
    competitorId: DEMO_IDS.competitors.serbetcihan,
    competitorName: "Şerbetçi Han Gifting",
    sourceType: "SOCIAL_POST",
    platform: "instagram_and_tiktok",
    sentiment: "POSITIVE",
    publishedAt: "2026-10-10",
    title:
      "Positive Feedback Cluster: Unedited Knife-Cut Crunch & Emerald Cross-Section Drives 3.8x Save Rate",
    verbatimText:
      "Analysis of 8 short-form Reels published by Şerbetçi Han Gifting (Sep 28–Oct 10): Posts featuring raw directional microphone audio of a knife slicing through 40 dry phyllo layers to reveal the emerald Boz pistachio center generated a 3.8% engagement rate and 3.8x higher bookmark/save rate than polished music-backed table videos.",
    productReferenced: "Şerbetçi Han 420g Heritage Bazaar Tin",
    packSizeAndPrice: "420g · $29 USD + $18 Shipping",
    strategicTakeaway:
      "Validates our core creative playbook (Stage 1 Macro Knife-Cut ASMR Reel). No strategy modification required.",
    linkedPains: ["pain_demo_syrup_soggy"],
  },
  {
    id: "ev_wt_altin_msg_08",
    domainSlug: "altinfistik-confections.demo.invalid",
    competitorId: DEMO_IDS.competitors.altinfistik,
    competitorName: "AltınFıstık Confections",
    sourceType: "WATCHTOWER_DIFF",
    platform: "website_diff",
    sentiment: "OBSERVATION",
    publishedAt: "2026-10-09",
    title:
      "Watchtower Messaging Diff: AltınFıstık Pivots Hero Copy to 'Ottoman Palace Heritage' Without Ingredient % Disclosure",
    verbatimText:
      "BEFORE (Snapshot 2026-09-25): 'Luxury Gold-Foil Middle Eastern Baklava Gift Boxes ($36 USD).'\nAFTER (Snapshot 2026-10-09): 'Handcrafted From Secret Ottoman Palace Recipes — The Crown Jewel of Dessert Tables.' Note: Product specification tab still omits pistachio percentage by weight and lists blended butter oil.",
    productReferenced: "AltınFıstık 400g Royal Pistachio Gold Box",
    packSizeAndPrice: "400g · $36 USD",
    strategicTakeaway:
      "Competitor relies on unverifiable 'palace recipe' adjectives while hiding nut weight %. Our Printed Batch Roast Card (152g / 38% Boz pistachio + 100% sheep-milk clarified butter) remains the clear authority contrast.",
    linkedPains: ["pain_demo_gift_presentation"],
  },
  {
    id: "ev_wt_kervan_channel_09",
    domainSlug: "kervansaray-baklava.demo.invalid",
    competitorId: DEMO_IDS.competitors.kervansaray,
    competitorName: "KervanSaray Baklava",
    sourceType: "SOCIAL_POST",
    platform: "tiktok_shop",
    sentiment: "OBSERVATION",
    publishedAt: "2026-10-14",
    title:
      "First Observation: KervanSaray Testing TikTok Shop Creator Live Streams with Flash Coupons",
    verbatimText:
      "PRELIMINARY SIGNAL (Awaiting 2nd Confirmation Scan): Watchtower detected 2 micro-creator live streams tagging KervanSaray Baklava's 400g boxes on TikTok Shop with a limited-time 15% platform coupon. Stream viewership averaged 180 concurrent viewers.",
    productReferenced: "KervanSaray 400g Assortment Box",
    packSizeAndPrice: "400g · $25–$32 USD",
    strategicTakeaway:
      "Low-confidence first observation; impulse marketplace discounting does not match our $32–$118 dinner-host and executive gifting positioning. Keep under Watchtower monitoring.",
    linkedPains: ["pain_demo_gift_presentation"],
  },
  {
    id: "ev_wt_serbet_stock_10",
    domainSlug: "serbetcihan-gifting.demo.invalid",
    competitorId: DEMO_IDS.competitors.serbetcihan,
    competitorName: "Şerbetçi Han Gifting",
    sourceType: "WATCHTOWER_DIFF",
    platform: "website_diff",
    sentiment: "OBSERVATION",
    publishedAt: "2026-10-14",
    title:
      "First Observation: Şerbetçi Han Posts 6–8 Business Day US Customs Clearance Delay Notice on Kadayif Tins",
    verbatimText:
      "PRELIMINARY SIGNAL (Awaiting 2nd Confirmation Scan): Checkout banner on serbetcihan-gifting.demo.invalid updated on 2026-10-14: 'NOTICE FOR US CUSTOMERS: Due to seasonal agricultural inspection queues at JFK port of entry, 420g Kadayif & Pistachio Tins currently require 6–8 business days for delivery.'",
    productReferenced: "Şerbetçi Han 420g Heritage Bazaar Tin",
    packSizeAndPrice: "420g · $29 USD + $18 DHL Express",
    strategicTakeaway:
      "Cross-border customs friction further strengthens Zeytun Atelier's New York domestic 2-day air dispatch advantage for time-sensitive dinner hosts.",
    linkedPains: ["pain_demo_transit_crushing"],
  },
];

// ============================================================================
// 2. THE 10 MEANINGFUL WATCHTOWER EVENTS
// ============================================================================
export interface DemoWatchtowerEventSpec {
  id: string;
  runId: string;
  competitorId: string;
  competitorName: string;
  kind: string;
  changeDimension: string;
  severity: "major" | "medium" | "low";
  confidence: number;
  status: "confirmed" | "candidate";
  createdAtOffsetHours: number;
  validatedAtOffsetHours: number | null;
  title: string;
  categoryLabel: string;
  productReferenced: string;
  segmentName: string;
  laneId: string;
  laneTitle: string;
  beforeState: string;
  afterState: string;
  evidenceNotes: string[];
  evidenceIds: string[];
  evidenceUrls: string[];
  businessRelevance: string;
  actionabilityType:
    | "DEEP_REASONING_REQUIRED"
    | "VALIDATES_STRATEGY"
    | "OPERATIONAL_RESPONSE"
    | "MONITOR_ONLY"
    | "FIRST_OBSERVATION";
  nextActionLabel: string;
  linkedScenarioId: DemoScenarioId | null;
  strategicBrief: {
    executiveSummary: string;
    strategicInterpretation: string;
    marketSignificance: string;
    directionOfMovement: string;
    likelyStrategicObjective: string;
    impactOnOurStrategy: string;
    recommendation: string;
    assumptions: string[];
    missingEvidence: string[];
    claims: Array<{ claim: string; evidenceIds: string[]; confidence: number }>;
  };
}

export const DEMO_WATCHTOWER_EVENTS_LIST: DemoWatchtowerEventSpec[] = [
  // EVENT 1 — Scenario A: Competitor Price Reduction (KervanSaray $32 -> $25 400g Box)
  {
    id: "pce_demo_wt_01",
    runId: "wtrun_demo_2026_10_01",
    competitorId: DEMO_IDS.competitors.kervansaray,
    competitorName: "KervanSaray Baklava",
    kind: "pricing_change",
    changeDimension: "pricing",
    severity: "major",
    confidence: 0.96,
    status: "confirmed",
    createdAtOffsetHours: 36,
    validatedAtOffsetHours: 4,
    title:
      "KervanSaray Cuts 400g Gift Box Price 22% ($32 → $25) via 52% Glucose-Syrup 'Bazaar Value Box'",
    categoryLabel: "Pricing strategy shift",
    productReferenced: "KervanSaray 400g Bazaar Value Assortment Box vs Zeytun 400g Tin ($32)",
    segmentName: "Discerning Dinner Hosts & Cultural Gift Buyers ($30–$65 Spend)",
    laneId: DEMO_IDS.lanes.gifting,
    laneTitle: "Lane 1 · Dinner-Host & Cultural Occasion Gifting (400g Signature Tin — $32 USD)",
    beforeState:
      "$32.00 USD — KervanSaray 400g Classic Pistachio & Walnut Tin (18 pieces, ~30% nut weight in metal tin; matched Zeytun Atelier's $32.00 USD 400g price).",
    afterState:
      "$25.00 USD — KervanSaray 400g 'Bazaar Value Assortment Box' (-22% price undercut; 18 pieces in paperboard box using 52% glucose syrup weight = 208g sugar syrup and ~19% blended pistachio/walnut/peanut filling = ~75g).",
    evidenceNotes: [
      "KervanSaray Baklava launched a $25.00 USD 400g 'Bazaar Value Assortment Gift Box' (22% below their $32.00 Classic Tin and Zeytun Atelier's $32.00 400g Tin), promoted with Instagram Reels asking: 'Why pay $32+ for a 400g pistachio baklava box when ours is $25?'",
      "Catalog specification diff reveals the $25.00 400g box reduces pistachio weight to ~75g (~19%), substitutes walnut/peanut rolls, and inflates total weight with 52% heavy glucose syrup (208g sugar syrup per 400g box).",
      "Customer reviews (ev_mv_kervan_01, ev_mv_kervan_02) corroborate thick pooled syrup at the bottom of the box and soggy lower pastry sheets.",
    ],
    evidenceIds: ["ev_wt_kervan_diff_01", "ev_mv_kervan_01", "ev_mv_kervan_02", "pf_cap_01"],
    evidenceUrls: [
      buildDemoEvidenceUrl("kervansaray-baklava.demo.invalid", "ev_wt_kervan_diff_01"),
      buildDemoEvidenceUrl("kervansaray-baklava.demo.invalid", "ev_mv_kervan_01"),
      buildDemoEvidenceUrl("kervansaray-baklava.demo.invalid", "ev_mv_kervan_02"),
    ],
    businessRelevance:
      "Creates direct nominal '400g for $25 vs $32' price pressure in Lane 1. First-time cold shoppers comparing 400g weight labels without seeing inside the tin risk assuming both boxes deliver equal pistachio content.",
    actionabilityType: "DEEP_REASONING_REQUIRED",
    nextActionLabel: "Run Deep Reasoning (Scenario A: Value & Gram-Ratio Response)",
    linkedScenarioId: "SCENARIO_A_PRICE",
    strategicBrief: {
      executiveSummary:
        "Direct competitor KervanSaray Baklava introduced a $25.00 USD 400g 'Bazaar Value Assortment Box' (-22% vs our $32.00 USD 400g tin) backed by comparative Reels hooks. Specification and review evidence confirms the $25 price is achieved by padding box weight with 52% glucose syrup (208g sugar water) and cutting actual pistachio content to ~75g.",
      strategicInterpretation:
        "KervanSaray is executing a nominal pack-weight anchor: making all 400g boxes appear interchangeable on total gram weight so our $32 USD tin looks $7 more expensive to first-time gift shoppers.",
      marketSignificance:
        "High impact on Top-of-Funnel discovery and PDP price comparison in Lane 1 (Dinner-Host & Cultural Occasion Gifting).",
      directionOfMovement:
        "Down-market promotional price cut (-22%) funded by ingredient dilution (52% glucose syrup weight + walnut/peanut substitution).",
      likelyStrategicObjective:
        "Capture price-sensitive 400g gift box traffic on Instagram Reels and compress acquisition cost using a $25 headline price.",
      impactOnOurStrategy:
        "Challenges our DIFFERENTIATION and OFFER framing in Lane 1. Does NOT justify cutting our $32 price—which would erode margin and contradict our 38% Boz pistachio / 100% sheep-milk clarified butter standard. Requires explicit gram-per-dollar pistachio contrast and a non-discount value bonus on 2-tin bundles.",
      recommendation:
        "Run Deep Reasoning Scenario A to update Differentiation & Offer in Lane 1: (1) Lead Reels & PDP with '152g Real Boz Pistachio vs 208g Glucose Syrup in $25 Boxes' visual scale proof; (2) Hold single 400g tin at $32 USD; (3) Add a complimentary 40g 'Host Preview' 2-Piece Tasting Sleeve to the $60 2-Tin Host Bundle.",
      assumptions: [
        "Affected Assumption (Differentiation): Stating '38% Boz pistachio & low syrup' in copy is sufficient without a direct visual gram-weight comparison against $25 400g promo boxes.",
        "Preserved Assumption (Pricing): Discerning hosts will pay $32 ($7 more) once shown that Zeytun delivers 2x the real Boz pistachio weight (152g vs ~75g) and zero pooled syrup.",
      ],
      missingEvidence: [
        "30-day repeat purchase rate of buyers who tried KervanSaray's $25 Bazaar Value Box.",
      ],
      claims: [
        {
          claim: "KervanSaray reduced entry 400g box pricing from $32 USD to $25 USD (-22%) using 52% glucose syrup weight.",
          evidenceIds: ["ev_wt_kervan_diff_01"],
          confidence: 0.96,
        },
        {
          claim: "Customer reviews report pooled glucose syrup and soggy bottom pastry in KervanSaray's value boxes.",
          evidenceIds: ["ev_mv_kervan_01", "ev_mv_kervan_02"],
          confidence: 0.92,
        },
      ],
    },
  },

  // EVENT 2 — Scenario B: Gifting-Demand Signal & Competitor Multi-Box Concierge
  {
    id: "pce_demo_wt_02",
    runId: "wtrun_demo_2026_10_02",
    competitorId: DEMO_IDS.competitors.altinfistik,
    competitorName: "AltınFıstık Confections",
    kind: "offer_type_shift",
    changeDimension: "offer",
    severity: "major",
    confidence: 0.93,
    status: "confirmed",
    createdAtOffsetHours: 30,
    validatedAtOffsetHours: 5,
    title:
      "AltınFıstık Launches Self-Serve 'Executive & Holiday Multi-Box Gift Concierge' Amid +42% Gifting Search Surge",
    categoryLabel: "Offer type shift",
    productReferenced: "AltınFıstık 2-Box ($70) & 4-Box ($136) Gift Sets vs Zeytun $60 / $118 Bundles",
    segmentName: "Boutique Executive & Client Appreciation Buyers + Holiday Gift Hosts",
    laneId: DEMO_IDS.lanes.hosting,
    laneTitle: "Lane 2 · Boutique Executive & Client Appreciation Gifting (Multi-Tin Bundles)",
    beforeState:
      "AltınFıstık offered single-box ($36 USD) checkout only; corporate gifting required manual email inquiry with a 10-box ($360) minimum.",
    afterState:
      "AltınFıstık deployed a self-serve 'Executive & Holiday Multi-Box Gift Desk' on PDP (2-Box Client Duo at $70 USD / 4-Box Executive Set at $136 USD) with instant printed gift-note entry and multi-recipient upload, while still shipping via 5-day ground.",
    evidenceNotes: [
      "AltınFıstık Confections launched a self-serve 'Executive & Holiday Multi-Box Gift Desk' on its product page targeting 2-to-4 box client and family holiday orders ($70 for 2 boxes / $136 for 4 boxes) with instant gift-note entry.",
      "High-intent search queries for 'executive pistachio baklava gift box' and 'luxury holiday baklava gift tin US delivery' rose +42% over the past 14 days entering peak hosting & Q4 client appreciation season.",
      "Despite the slick concierge UI, AltınFıstık still ships via 5-day ground unless buyers pay a +$24 expedited air fee, and charges $10–$18 more per bundle than Zeytun Atelier ($60 2-Tin / $118 4-Tin with Free 2-Day Air).",
    ],
    evidenceIds: ["ev_wt_altin_gifting_02", "ev_mv_altin_02", "ev_mv_altin_01", "pf_cap_03"],
    evidenceUrls: [
      buildDemoEvidenceUrl("altinfistik-confections.demo.invalid", "ev_wt_altin_gifting_02"),
      buildDemoEvidenceUrl("altinfistik-confections.demo.invalid", "ev_mv_altin_02"),
      buildDemoEvidenceUrl("altinfistik-confections.demo.invalid", "ev_mv_altin_01"),
    ],
    businessRelevance:
      "Signals an immediate seasonal surge in multi-tin corporate and holiday gifting demand. Buyers want frictionless gift-note personalization on 2-tin and 4-tin orders—and we beat AltınFıstık on both bundle price ($60/$118 vs $70/$136) and included 2-day air delivery.",
    actionabilityType: "DEEP_REASONING_REQUIRED",
    nextActionLabel: "Run Deep Reasoning (Scenario B: Gifting Funnel & Budget Shift)",
    linkedScenarioId: "SCENARIO_B_GIFTING",
    strategicBrief: {
      executiveSummary:
        "AltınFıstık Confections launched a self-serve 'Executive & Holiday Multi-Box Gift Desk' ($70 2-Box / $136 4-Box) with instant gift-note entry to capture rising Q4 client and holiday gifting demand. However, their bundles remain $10–$18 pricier than Zeytun Atelier's $60 2-Tin and $118 4-Tin packs and still rely on 5-day ground shipping unless buyers pay +$24 for air.",
      strategicInterpretation:
        "Multi-box gift buyers (2–4 tins) are actively converting right now and value zero-friction gift-note entry at checkout. If our PDP and mid/bottom-funnel ads do not prominently surface self-serve gift-note personalization and our included 2-day air advantage, AltınFıstık will capture high-AOV ($60–$118) orders despite inferior transit speed.",
      marketSignificance:
        "High commercial leverage in Lane 2 (Boutique Executive & Client Appreciation Gifting) and holiday gifting crossovers in Lane 1.",
      directionOfMovement:
        "Shift from high-minimum B2B email inquiries (10+ boxes) to self-serve 2-box and 4-box executive/holiday gifting bundles on DTC product pages.",
      likelyStrategicObjective:
        "Lock in high-AOV ($70–$136) Q4 client appreciation and holiday gifting budgets early.",
      impactOnOurStrategy:
        "Warrants a targeted update to Lane 2 Positioning/Offer Messaging, Funnel Stage 2/3 (Self-Serve Gift Note & Multi-Tin Concierge callout), and Channel/Budget allocation—shifting $450/mo within our existing $4,500/mo budget into High-Intent Executive & Holiday Gifting Search & Carousel.",
      recommendation:
        "Run Deep Reasoning Scenario B: (1) Upgrade Lane 2 & Funnel Stage 3 with 'Instant Custom Gift Note Card + Guaranteed Free 2-Day Air ($60 2-Tin / $118 4-Tin vs Competitor $70/$136 5-Day Ground)'; (2) Reallocate $450/mo within the $4,500/mo budget from broad top-of-funnel video into Google High-Intent Gifting Search & Executive Carousel Retargeting ($675/mo → $1,125/mo).",
      assumptions: [
        "Affected Assumption (Funnel & Channel Allocation): Allocating only 15% ($675/mo) to high-intent gifting search/retargeting and burying gift-note customization in checkout is sufficient during peak gifting demand.",
        "Preserved Assumption (Capability Boundary): We support personalized printed paper gift note cards on all orders, while maintaining our verified boundary of no custom steel tin embossing under 25 units.",
      ],
      missingEvidence: [
        "Exact split between 2-box ($70) and 4-box ($136) orders inside AltınFıstık's new gift desk.",
      ],
      claims: [
        {
          claim: "AltınFıstık launched self-serve 2-Box ($70) and 4-Box ($136) gift sets with instant gift-note entry.",
          evidenceIds: ["ev_wt_altin_gifting_02"],
          confidence: 0.95,
        },
        {
          claim: "AltınFıstık's 5-day ground shipping causes kadayif moisture absorption and ribbon staining unless buyers pay +$24 for air.",
          evidenceIds: ["ev_mv_altin_01", "ev_wt_altin_ship_04"],
          confidence: 0.93,
        },
      ],
    },
  },

  // EVENT 3 — Scenario C: Repeated Pack-Size & Serving-Count Questions
  {
    id: "pce_demo_wt_03",
    runId: "wtrun_demo_2026_10_03",
    competitorId: DEMO_IDS.competitors.kervansaray,
    competitorName: "KervanSaray Baklava",
    kind: "offer_language_change",
    changeDimension: "offer_messaging",
    severity: "major",
    confidence: 0.91,
    status: "confirmed",
    createdAtOffsetHours: 24,
    validatedAtOffsetHours: 3,
    title:
      "Repeated Buyer Questions on 400g Serving Count: 'Is One 18-Piece Tin Enough for 10–14 Dinner Guests?'",
    categoryLabel: "Offer language change",
    productReferenced: "400g Single Tin (18 Pieces) vs 800g 2-Tin Host Bundle (36 Pieces)",
    segmentName: "Discerning Dinner Hosts & Cultural Gift Buyers ($30–$65 Spend)",
    laneId: DEMO_IDS.lanes.gifting,
    laneTitle: "Lane 1 · Dinner-Host & Cultural Occasion Gifting (400g Signature Tin — $32 USD)",
    beforeState:
      "Category PDPs and ad carousels stated metric net weight ('400g Assortment Box — 18 Pieces') without translating weight into guest serving counts or piece-per-guest portion guidance.",
    afterState:
      "34+ buyer comment threads across KervanSaray and AltınFıstık ask whether 400g serves 6–8 guests or 12+ guests; KervanSaray added a partial 'Serves 6–8' badge on carousel ads, exposing a major conversion & bundle-sizing clarity gap.",
    evidenceNotes: [
      "Across 34 recent social comment threads and review Q&As on KervanSaray Baklava and AltınFıstık Confections, US dinner hosts repeatedly ask: 'How many guests does a 400g (18-piece) tin actually serve at a dinner party?'",
      "US shoppers unfamiliar with metric confectionery weights struggle to visualize 400g on a serving platter—causing hosts of 10–16 person gatherings to either hesitate at checkout or under-order 1 tin when they need 2 tins (36 pieces).",
      "Earlier Performance Loop test (Case 4) showed that forcing the $60 2-Tin Bundle as the default radio button hurt single-tin conversion (-0.60 pp), proving buyers need transparent guest-count guidance rather than a forced default.",
    ],
    evidenceIds: ["ev_wt_packsize_qa_03", "ev_mv_kervan_03", "pf_cap_01"],
    evidenceUrls: [
      buildDemoEvidenceUrl("kervansaray-baklava.demo.invalid", "ev_wt_packsize_qa_03"),
      buildDemoEvidenceUrl("kervansaray-baklava.demo.invalid", "ev_mv_kervan_03"),
    ],
    businessRelevance:
      "Directly impacts PDP conversion and natural upgrade rate from the $32 Single Tin (18 pieces) to the $60 2-Tin Host Bundle (36 pieces). Giving hosts explicit guest-count math removes checkout hesitation without forcing a $60 default.",
    actionabilityType: "DEEP_REASONING_REQUIRED",
    nextActionLabel: "Run Deep Reasoning (Scenario C: Pack-Size & Serving Guide Update)",
    linkedScenarioId: "SCENARIO_C_PACKSIZE",
    strategicBrief: {
      executiveSummary:
        "Watchtower detected a recurring buyer question pattern across competitor comment threads and PDP updates: US dinner hosts do not intuitively know how many guests a '400g (18-piece)' baklava tin serves. Hosts welcoming 10–16 guests hesitate at checkout or under-order a single 400g tin.",
      strategicInterpretation:
        "In the US market, listing '400g net weight' creates cognitive friction at the exact moment a dinner host is deciding between buying 1 tin ($32) or 2 tins ($60). Combined with Performance Loop Case 4 (where forcing the $60 bundle as the default lowered overall conversion by -0.60 pp), the winning move is explicit Guest Serving-Count Guidance above the fold.",
      marketSignificance:
        "High impact on Mid-Funnel PDP-to-Cart progression and natural 2-Tin Host Bundle ($60) selection in Lane 1.",
      directionOfMovement:
        "Category shift from metric gram-only labels ('400g Box') toward explicit guest-count and occasion-sizing guidance.",
      likelyStrategicObjective:
        "Reduce pre-purchase portion anxiety for weekend dinner hosts and increase multi-tin bundle orders.",
      impactOnOurStrategy:
        "Affects OFFER presentation, AWARENESS, and FUNNEL Stage 2 (PDP & Carousel education) in Lane 1. Requires adding a clear Guest Serving-Count Guide (1 Tin · 18 pcs = 6–9 Guests vs 2-Tin Bundle · 36 pcs = 12–16 Guests) while keeping the $32 Single Tin as the friction-free default entry option.",
      recommendation:
        "Run Deep Reasoning Scenario C: (1) Add explicit Serving-Count & Portion Architecture to Offer & PDP ('Single 400g Tin · 18 Pieces = Serves 6–9 Guests at $32' vs '2-Tin Host Bundle · 800g / 36 Pieces = Serves 12–16 Guests at $60 + Free 2-Day Air'); (2) Add a dedicated 5-Slide 'Host Portion & Platter Guide' Carousel task in What To Do Today.",
      assumptions: [
        "Affected Assumption (Offer & Funnel PDP): Stating '400g (18 pieces)' is self-explanatory for US dinner hosts deciding how many tins to buy.",
        "Preserved Assumption (Default Entry Price): Keep the $32 Single Tin as the default PDP selection (honoring Performance Loop Case 4 learnings) and let clear guest-count guidance drive voluntary $60 2-Tin upgrades.",
      ],
      missingEvidence: [
        "Post-implementation split of 2-Tin upgrades driven specifically by the 12–16 guest label.",
      ],
      claims: [
        {
          claim: "34+ recent buyer comments across competitor posts ask whether a 400g (18-piece) tin is enough for 10–14 dinner guests.",
          evidenceIds: ["ev_wt_packsize_qa_03", "ev_mv_kervan_03"],
          confidence: 0.91,
        },
      ],
    },
  },

  // EVENT 4 — Shipping Threshold Increase by AltınFıstık (Validates Strategy)
  {
    id: "pce_demo_wt_04",
    runId: "wtrun_demo_2026_10_04",
    competitorId: DEMO_IDS.competitors.altinfistik,
    competitorName: "AltınFıstık Confections",
    kind: "competitor_profile_change",
    changeDimension: "shipping_policy",
    severity: "medium",
    confidence: 0.95,
    status: "confirmed",
    createdAtOffsetHours: 52,
    validatedAtOffsetHours: 18,
    title:
      "AltınFıstık Raises Free US Shipping Threshold from $75 to $95 USD (Still 5-Day Ground)",
    categoryLabel: "Competitor profile change",
    productReferenced: "AltınFıstık 400g Royal Gold Box ($36 USD)",
    segmentName: "Nationwide Dinner Hosts & Executive Gift Buyers",
    laneId: DEMO_IDS.lanes.gifting,
    laneTitle: "Lane 1 · Dinner-Host & Cultural Occasion Gifting (400g Signature Tin — $32 USD)",
    beforeState:
      "Free US domestic shipping on orders over $75.00 USD via 5-day economy ground courier.",
    afterState:
      "Free US shipping threshold increased to $95.00 USD (requires purchasing 3 boxes at $36 = $108 USD) via 5-day ground; 2-day air costs +$24.00 extra.",
    evidenceNotes: [
      "AltınFıstık Confections raised its free US domestic shipping threshold from $75 USD to $95 USD on its policies page.",
      "Shoppers buying two 400g boxes from AltınFıstık ($72 subtotal) no longer qualify for free shipping and must pay $12 ground shipping or $24 for 2-day air.",
    ],
    evidenceIds: ["ev_wt_altin_ship_04", "ev_mv_altin_01"],
    evidenceUrls: [
      buildDemoEvidenceUrl("altinfistik-confections.demo.invalid", "ev_wt_altin_ship_04"),
      buildDemoEvidenceUrl("altinfistik-confections.demo.invalid", "ev_mv_altin_01"),
    ],
    businessRelevance:
      "Strengthens Zeytun Atelier's competitive advantage: our $60 2-Tin Host Bundle includes Free 2-Day US Air Shipping ($35 lower threshold and 3 days faster transit than AltınFıstık).",
    actionabilityType: "VALIDATES_STRATEGY",
    nextActionLabel: "No Strategy Change Needed (Validates $60 Free 2-Day Air Bundle)",
    linkedScenarioId: null,
    strategicBrief: {
      executiveSummary:
        "AltınFıstık Confections increased its free US shipping minimum from $75 to $95 USD while keeping standard fulfillment on 5-day economy ground. A 2-box order ($72) at AltınFıstık now incurs shipping fees on top of slow ground transit.",
      strategicInterpretation:
        "Rising parcel costs forced AltınFıstık to push free shipping above the 2-box price point. This directly validates our $60 2-Tin Host Bundle, which includes complimentary 2-day air dispatch.",
      marketSignificance:
        "Positive competitive tailwind for Zeytun Atelier's 2-Tin Bundle conversion.",
      directionOfMovement: "Upward shipping threshold friction on competitor 2-box orders.",
      likelyStrategicObjective: "Protect shipping margin on 1-box and 2-box ground shipments.",
      impactOnOurStrategy:
        "Validates our existing Offer & Fulfillment architecture. No strategy change required.",
      recommendation:
        "Maintain current Strategy v1 shipping terms ($60 2-Tin Bundle with Free 2-Day US Air).",
      assumptions: ["Preserved: Free 2-day air at $60 (2 tins) is a decisive conversion lever."],
      missingEvidence: [],
      claims: [
        {
          claim: "AltınFıstık raised free US ground shipping threshold from $75 to $95 USD.",
          evidenceIds: ["ev_wt_altin_ship_04"],
          confidence: 0.95,
        },
      ],
    },
  },

  // EVENT 5 — New Competitor Product Size (Şerbetçi Han 1.0kg Tray)
  {
    id: "pce_demo_wt_05",
    runId: "wtrun_demo_2026_10_05",
    competitorId: DEMO_IDS.competitors.serbetcihan,
    competitorName: "Şerbetçi Han Gifting",
    kind: "promise_shift",
    changeDimension: "product_catalog",
    severity: "medium",
    confidence: 0.9,
    status: "confirmed",
    createdAtOffsetHours: 68,
    validatedAtOffsetHours: 24,
    title:
      "Şerbetçi Han Introduces 1.0kg Family Banquet Tray ($68 USD + $24 Int'l Freight = $92 Landed)",
    categoryLabel: "Value proposition shift",
    productReferenced: "Şerbetçi Han 1,000g Family Banquet Tray",
    segmentName: "Large Cultural Celebration Hosts",
    laneId: DEMO_IDS.lanes.gifting,
    laneTitle: "Lane 1 · Dinner-Host & Cultural Occasion Gifting (400g Signature Tin — $32 USD)",
    beforeState:
      "Şerbetçi Han offered only its single 420g Heritage Bazaar Tin ($29 USD + $18 DHL Express = $47 USD landed).",
    afterState:
      "Added a 1,000g (42-piece) Family Banquet Tray at $68.00 USD + $24.00 USD cross-border freight ($92.00 USD landed cost in the US; unsealed paper-wrapped tray).",
    evidenceNotes: [
      "Şerbetçi Han Gifting added a 1.0kg (42-piece) Family Banquet Tray priced at $68 USD plus $24 international express shipping ($92 USD total landed cost for US buyers).",
      "Unlike nitrogen-flushed 400g tins, the 1.0kg tray is wrapped in butcher paper without hermetic sealing and must clear US customs over 4–6 days.",
    ],
    evidenceIds: ["ev_wt_serbet_size_05", "ev_mv_serbet_01"],
    evidenceUrls: [
      buildDemoEvidenceUrl("serbetcihan-gifting.demo.invalid", "ev_wt_serbet_size_05"),
      buildDemoEvidenceUrl("serbetcihan-gifting.demo.invalid", "ev_mv_serbet_01"),
    ],
    businessRelevance:
      "Low threat: at $92 USD landed with customs delay risk, buyers seeking ~800g–1kg for large gatherings are far better served by our domestic $60 2-Tin Host Bundle (800g / 36 pieces in two nitrogen-sealed tins).",
    actionabilityType: "MONITOR_ONLY",
    nextActionLabel: "Monitor Only (No New 1kg SKU Needed; $60 2-Tin Bundle Covers Segment)",
    linkedScenarioId: null,
    strategicBrief: {
      executiveSummary:
        "Istanbul exporter Şerbetçi Han Gifting added a 1.0kg Family Banquet Tray at $68 USD + $24 international shipping ($92 USD landed in the US).",
      strategicInterpretation:
        "While aimed at large family gatherings, a $92 landed price and unsealed 4–6 day cross-border transit make it uncompetitive against buying two of Zeytun Atelier's 400g nitrogen-sealed tins ($60 total with free 2-day domestic air).",
      marketSignificance: "Low competitive pressure; confirms demand for multi-tin hosting quantities.",
      directionOfMovement: "Up-size catalog expansion for large family gatherings.",
      likelyStrategicObjective: "Raise international order values to offset cross-border DHL freight.",
      impactOnOurStrategy:
        "No need to introduce a separate 1kg tray SKU; our 2-Tin ($60 / 800g) and 4-Tin ($118 / 1.6kg) packs already serve large tables with superior freshness.",
      recommendation: "Continue monitoring; no strategy change warranted.",
      assumptions: ["Preserved: Modular 400g nitrogen-sealed tins outperform single large unsealed trays on freshness."],
      missingEvidence: [],
      claims: [
        {
          claim: "Şerbetçi Han launched a 1.0kg tray at $92 USD landed cost to US buyers.",
          evidenceIds: ["ev_wt_serbet_size_05"],
          confidence: 0.9,
        },
      ],
    },
  },

  // EVENT 6 — Repeated Customer Complaint Pattern (AltınFıstık 5-Day Ground Soggy Kadayif)
  {
    id: "pce_demo_wt_06",
    runId: "wtrun_demo_2026_10_06",
    competitorId: DEMO_IDS.competitors.altinfistik,
    competitorName: "AltınFıstık Confections",
    kind: "narrative_shift",
    changeDimension: "customer_sentiment",
    severity: "medium",
    confidence: 0.92,
    status: "confirmed",
    createdAtOffsetHours: 76,
    validatedAtOffsetHours: 30,
    title:
      "Repeated Customer Complaint Pattern: 14 Reviews Cite Limp Kadayif & Syrup Leaks After 5-Day Ground Transit",
    categoryLabel: "Narrative framework shift",
    productReferenced: "AltınFıstık 400g Royal Pistachio Assortment ($36 USD)",
    segmentName: "Discerning Dinner Hosts & Cultural Gift Buyers",
    laneId: DEMO_IDS.lanes.gifting,
    laneTitle: "Lane 1 · Dinner-Host & Cultural Occasion Gifting (400g Signature Tin — $32 USD)",
    beforeState: "Occasional shipping complaints during peak summer heat.",
    afterState:
      "14 verified customer reviews in 10 days reporting soft shredded kadayif, displaced pieces, and syrup-stained ribbons from 5-day ground shipping without internal cell dividers.",
    evidenceNotes: [
      "14 Trustpilot and Reddit reviews between Oct 1 and Oct 11 cite soft kadayif threads and sticky ribbons on AltınFıstık's $36 400g boxes shipped via 5-day ground.",
      "Reviewers specifically note the absence of a hermetic seal or individual piece divider tray.",
    ],
    evidenceIds: ["ev_wt_altin_complaints_06", "ev_mv_altin_01", "pf_cap_03"],
    evidenceUrls: [
      buildDemoEvidenceUrl("altinfistik-confections.demo.invalid", "ev_wt_altin_complaints_06"),
      buildDemoEvidenceUrl("altinfistik-confections.demo.invalid", "ev_mv_altin_01"),
    ],
    businessRelevance:
      "Directly validates our Differentiation Pillar 2 (Nitrogen-Flushed Steel Tin + 18-Cell Honeycomb Divider + 2-Day Air). Operational creative already highlights this contrast.",
    actionabilityType: "OPERATIONAL_RESPONSE",
    nextActionLabel: "Operational Execution (Keep Nitrogen-Seal & Honeycomb Clip in Reel Rotation)",
    linkedScenarioId: null,
    strategicBrief: {
      executiveSummary:
        "Customer review telemetry shows a 14-review complaint cluster against AltınFıstık Confections for limp kadayif and syrup leaks caused by unsealed boxes on 5-day ground trucks.",
      strategicInterpretation:
        "Shredded kadayif is highly hygroscopic and loses its crunch within 72 hours unless hermetically sealed in nitrogen and shipped via 2-day air.",
      marketSignificance: "Confirms Pain #3 (transit crushing & moisture absorption) as a strong competitive wedge.",
      directionOfMovement: "Growing buyer dissatisfaction with slow ground shipping on $35+ gift boxes.",
      likelyStrategicObjective: "N/A (Competitor operational vulnerability).",
      impactOnOurStrategy:
        "Already addressed in Strategy v1 Pillar 2 and Funnel Stage 2. No strategic plan rewrite required.",
      recommendation:
        "Maintain honeycomb tray and nitrogen-seal peel demonstration in Stage 2 PDP & Carousel assets.",
      assumptions: ["Preserved: Nitrogen-flushed steel tin + 2-day air is essential for crisp kadayif."],
      missingEvidence: [],
      claims: [
        {
          claim: "14 recent reviews cite soft kadayif and syrup leakage in AltınFıstık's 5-day ground shipments.",
          evidenceIds: ["ev_wt_altin_complaints_06", "ev_mv_altin_01"],
          confidence: 0.92,
        },
      ],
    },
  },

  // EVENT 7 — Repeated Positive Feedback Revealing Purchase Driver (ASMR Cross-Section Cut)
  {
    id: "pce_demo_wt_07",
    runId: "wtrun_demo_2026_10_07",
    competitorId: DEMO_IDS.competitors.serbetcihan,
    competitorName: "Şerbetçi Han Gifting",
    kind: "hook_archetype_shift",
    changeDimension: "creative_hook",
    severity: "medium",
    confidence: 0.94,
    status: "confirmed",
    createdAtOffsetHours: 90,
    validatedAtOffsetHours: 42,
    title:
      "Positive Feedback Signal: Macro Knife-Cut Crunch + Visible Green Boz Pistachio Core Drives 3.8x Save Rate",
    categoryLabel: "Hook style shift",
    productReferenced: "400g–420g Artisanal Pistachio Baklava & Kadayif Category",
    segmentName: "Sensory-Driven Gift & Hosting Buyers",
    laneId: DEMO_IDS.lanes.gifting,
    laneTitle: "Lane 1 · Dinner-Host & Cultural Occasion Gifting (400g Signature Tin — $32 USD)",
    beforeState:
      "Polished studio table-setting videos with background music averaged 1.4% engagement rate.",
    afterState:
      "Unedited macro knife-cut Reels with live directional audio of the 40-layer crunch and bright green Boz pistachio cross-section achieved 3.8% engagement and 3.8x higher bookmark saves.",
    evidenceNotes: [
      "Comment analysis across Şerbetçi Han Gifting's top 8 Reels shows buyers explicitly citing 'hearing the dry crunch' and 'seeing the thick green pistachio center' as the moment they decided to purchase.",
      "Matches Zeytun Atelier's own Historical Performance Loop Case 1 (+0.80 pp CTR lift from Macro Knife-Cut ASMR Reels).",
    ],
    evidenceIds: ["ev_wt_serbet_asmr_07", "ev_mv_serbet_02"],
    evidenceUrls: [
      buildDemoEvidenceUrl("serbetcihan-gifting.demo.invalid", "ev_wt_serbet_asmr_07"),
      buildDemoEvidenceUrl("serbetcihan-gifting.demo.invalid", "ev_mv_serbet_02"),
    ],
    businessRelevance:
      "Confirms that raw acoustic crunch + cross-section nut density is the #1 visual purchase driver in this category.",
    actionabilityType: "VALIDATES_STRATEGY",
    nextActionLabel: "Validates Creative Playbook (Retain Macro Knife-Cut Hook in Stage 1)",
    linkedScenarioId: null,
    strategicBrief: {
      executiveSummary:
        "Watchtower creative classification and comment mining confirm that macro knife-cut ASMR videos showing the emerald Boz pistachio core outperform studio lifestyle ads by 3.8x on save rate.",
      strategicInterpretation:
        "Because online buyers cannot taste pastry before ordering, audible dry crunch and cross-section nut thickness act as the primary visual proxy for quality.",
      marketSignificance: "Validates our Stage 1 Sensory Hook in Strategy v1.",
      directionOfMovement: "Category-wide shift toward raw sensory proof over studio lifestyle commercials.",
      likelyStrategicObjective: "Lower top-of-funnel thumbstop cost through sensory proof.",
      impactOnOurStrategy:
        "Validates Strategy v1 Stage 1 creative direction and Historical Performance Loop Case 1. No strategy change required.",
      recommendation: "Keep macro knife-cut audio and cross-section proof in all top-of-funnel Reels.",
      assumptions: ["Preserved: Sensory cross-section proof outperforms generic lifestyle photography."],
      missingEvidence: [],
      claims: [
        {
          claim: "Macro knife-cut ASMR videos drive 3.8% engagement and 3.8x save rate.",
          evidenceIds: ["ev_wt_serbet_asmr_07", "ev_mv_serbet_02"],
          confidence: 0.94,
        },
      ],
    },
  },

  // EVENT 8 — Shift in Competitor Messaging (AltınFıstık 'Ottoman Palace Recipe' Copy)
  {
    id: "pce_demo_wt_08",
    runId: "wtrun_demo_2026_10_08",
    competitorId: DEMO_IDS.competitors.altinfistik,
    competitorName: "AltınFıstık Confections",
    kind: "positioning_shift",
    changeDimension: "positioning",
    severity: "low",
    confidence: 0.89,
    status: "confirmed",
    createdAtOffsetHours: 110,
    validatedAtOffsetHours: 60,
    title:
      "AltınFıstık Shifts Homepage Messaging to 'Secret Ottoman Palace Recipes' While Omitting Nut % & Bake Date",
    categoryLabel: "Brand positioning shift",
    productReferenced: "AltınFıstık 400g Royal Pistachio Gold Box ($36 USD)",
    segmentName: "Ingredient-Conscious Dinner Hosts",
    laneId: DEMO_IDS.lanes.gifting,
    laneTitle: "Lane 1 · Dinner-Host & Cultural Occasion Gifting (400g Signature Tin — $32 USD)",
    beforeState: "Homepage headline: 'Luxury Gold-Foil Middle Eastern Baklava Gift Boxes ($36 USD).'",
    afterState:
      "Homepage headline changed to: 'Handcrafted From Secret Ottoman Palace Recipes — The Crown Jewel of Dessert Tables' with zero disclosure of pistachio weight % or oven date.",
    evidenceNotes: [
      "AltınFıstık Confections updated its hero positioning copy to emphasize 'Secret Ottoman Palace Recipes'.",
      "Inspection of their product specification tab confirms they still do not disclose pistachio percentage by weight or batch roast date.",
    ],
    evidenceIds: ["ev_wt_altin_msg_08", "ev_mv_altin_03"],
    evidenceUrls: [
      buildDemoEvidenceUrl("altinfistik-confections.demo.invalid", "ev_wt_altin_msg_08"),
      buildDemoEvidenceUrl("altinfistik-confections.demo.invalid", "ev_mv_altin_03"),
    ],
    businessRelevance:
      "Low impact: generic 'palace recipe' adjectives without verifiable ingredient percentages further sharpen our contrast axis (Printed Batch Roast Card certifying 38% / 152g Boz pistachio weight).",
    actionabilityType: "MONITOR_ONLY",
    nextActionLabel: "Monitor Only (Our Printed Batch Roast Card Already Counters Vague Claims)",
    linkedScenarioId: null,
    strategicBrief: {
      executiveSummary:
        "AltınFıstık Confections pivoted its homepage headline to 'Secret Ottoman Palace Recipes' while continuing to omit pistachio weight percentage and bake date.",
      strategicInterpretation:
        "Competitor is doubling down on ornate heritage storytelling to justify $36 pricing rather than disclosing ingredient ratios.",
      marketSignificance: "Low impact; reinforces our specification-transparency positioning.",
      directionOfMovement: "Aesthetic/heritage storytelling without specification transparency.",
      likelyStrategicObjective: "Defend $36 price point through luxury heritage framing.",
      impactOnOurStrategy: "No change required; Strategy v1 already contrasts verified gram math against vague artisan claims.",
      recommendation: "Continue featuring the Printed Batch Roast Card in PDP and carousel assets.",
      assumptions: ["Preserved: Radical ingredient transparency beats vague heritage claims."],
      missingEvidence: [],
      claims: [
        {
          claim: "AltınFıstık updated hero copy to 'Secret Ottoman Palace Recipes' without adding nut % specs.",
          evidenceIds: ["ev_wt_altin_msg_08"],
          confidence: 0.89,
        },
      ],
    },
  },

  // EVENT 9 — Competitor Moving into New Channel (First Observation / Candidate)
  {
    id: "pce_demo_wt_09",
    runId: "wtrun_demo_2026_10_09",
    competitorId: DEMO_IDS.competitors.kervansaray,
    competitorName: "KervanSaray Baklava",
    kind: "content_format_shift",
    changeDimension: "channel_experiment",
    severity: "low",
    confidence: 0.64,
    status: "candidate",
    createdAtOffsetHours: 14,
    validatedAtOffsetHours: null,
    title:
      "First Observation: KervanSaray Testing TikTok Shop Creator Live Streams with 15% Flash Coupons",
    categoryLabel: "Content format shift",
    productReferenced: "KervanSaray 400g Assortment Box",
    segmentName: "Impulse Marketplace Shoppers",
    laneId: DEMO_IDS.lanes.gifting,
    laneTitle: "Lane 1 · Dinner-Host & Cultural Occasion Gifting (400g Signature Tin — $32 USD)",
    beforeState: "Direct website and standard Instagram/TikTok link-in-bio checkout only.",
    afterState:
      "Preliminary detection of 2 micro-creator TikTok Shop live streams tagging KervanSaray 400g boxes with a 15% flash coupon (awaiting 2nd confirmation fetch).",
    evidenceNotes: [
      "First observation of 2 creator live streams promoting KervanSaray 400g boxes via TikTok Shop affiliate links (~180 concurrent viewers).",
      "Awaiting scheduled second Watchtower fetch to determine whether this is a one-off creator test or a sustained channel shift.",
    ],
    evidenceIds: ["ev_wt_kervan_channel_09"],
    evidenceUrls: [
      buildDemoEvidenceUrl("kervansaray-baklava.demo.invalid", "ev_wt_kervan_channel_09"),
    ],
    businessRelevance:
      "Provisional first observation. Impulse flash-coupon live streams do not align with our $32–$118 dinner-host and executive gifting positioning.",
    actionabilityType: "FIRST_OBSERVATION",
    nextActionLabel: "Under Review (Awaiting 2nd Independent Watchtower Confirmation Fetch)",
    linkedScenarioId: null,
    strategicBrief: {
      executiveSummary:
        "Preliminary observation: KervanSaray Baklava tested 2 micro-creator live streams on TikTok Shop with 15% flash coupons. Awaiting second confirmation scan.",
      strategicInterpretation:
        "Early-stage channel test aimed at impulse snack buyers rather than planned dinner hosts or corporate gifters.",
      marketSignificance: "Low until confirmed across multiple weeks.",
      directionOfMovement: "Experimental affiliate live-stream discounting.",
      likelyStrategicObjective: "Clear inventory via impulse marketplace volume.",
      impactOnOurStrategy: "None at this stage; hold until confirmed.",
      recommendation: "Wait for second independent Watchtower confirmation scan.",
      assumptions: [],
      missingEvidence: ["Second confirmation scan verifying repeat live-stream cadence."],
      claims: [
        {
          claim: "Preliminary detection of 2 TikTok Shop creator streams for KervanSaray.",
          evidenceIds: ["ev_wt_kervan_channel_09"],
          confidence: 0.64,
        },
      ],
    },
  },

  // EVENT 10 — Product Availability / Customs Delay Change (First Observation / Candidate)
  {
    id: "pce_demo_wt_10",
    runId: "wtrun_demo_2026_10_10",
    competitorId: DEMO_IDS.competitors.serbetcihan,
    competitorName: "Şerbetçi Han Gifting",
    kind: "cta_strategy_shift",
    changeDimension: "availability_and_fulfillment",
    severity: "medium",
    confidence: 0.72,
    status: "candidate",
    createdAtOffsetHours: 9,
    validatedAtOffsetHours: null,
    title:
      "First Observation: Şerbetçi Han Posts 6–8 Business Day US Customs Delay Notice on 420g Kadayif Tins",
    categoryLabel: "Call-to-action shift",
    productReferenced: "Şerbetçi Han 420g Heritage Bazaar Tin",
    segmentName: "US Diaspora & Last-Minute Dinner Hosts",
    laneId: DEMO_IDS.lanes.gifting,
    laneTitle: "Lane 1 · Dinner-Host & Cultural Occasion Gifting (400g Signature Tin — $32 USD)",
    beforeState: "Checkout promise: 'Ships Worldwide in 3–5 Days via DHL Express ($18 USD).'",
    afterState:
      "Preliminary checkout notice detected: 'US Orders: Please allow 6–8 business days for 420g Kadayif & Pistachio Tins due to seasonal agricultural customs inspection queues at JFK.'",
    evidenceNotes: [
      "First observation on serbetcihan-gifting.demo.invalid checkout page warning US customers of 6–8 business day delivery times due to JFK customs inspection queues.",
      "Awaiting second scheduled fetch to confirm whether the delay persists across all US zip codes.",
    ],
    evidenceIds: ["ev_wt_serbet_stock_10", "ev_mv_serbet_01"],
    evidenceUrls: [
      buildDemoEvidenceUrl("serbetcihan-gifting.demo.invalid", "ev_wt_serbet_stock_10"),
      buildDemoEvidenceUrl("serbetcihan-gifting.demo.invalid", "ev_mv_serbet_01"),
    ],
    businessRelevance:
      "Further reinforces Zeytun Atelier's domestic US atelier dispatch (guaranteed 2-day air with zero customs holds). No strategy change needed.",
    actionabilityType: "FIRST_OBSERVATION",
    nextActionLabel: "Operational Watch (Awaiting 2nd Confirmation Fetch; Reinforces 2-Day US Air)",
    linkedScenarioId: null,
    strategicBrief: {
      executiveSummary:
        "Preliminary observation: Şerbetçi Han Gifting added a checkout notice warning US buyers of 6–8 business day transit times due to JFK customs queues.",
      strategicInterpretation:
        "Cross-border confectionery imports face seasonal customs bottlenecks in Q4, making international express unreliable for weekend dinner hosts.",
      marketSignificance: "Reinforces our domestic 2-day US air fulfillment advantage.",
      directionOfMovement: "Lengthening cross-border delivery lead times.",
      likelyStrategicObjective: "Set customer expectations to reduce delivery refund requests.",
      impactOnOurStrategy: "Supports existing domestic 2-day air messaging; no strategy change needed.",
      recommendation: "Monitor for confirmation on next scan.",
      assumptions: [],
      missingEvidence: ["Second confirmation scan of checkout shipping notice."],
      claims: [
        {
          claim: "Şerbetçi Han posted a 6–8 business day US customs delay notice on 420g tins.",
          evidenceIds: ["ev_wt_serbet_stock_10"],
          confidence: 0.72,
        },
      ],
    },
  },
];

// ============================================================================
// 3. THE 5 HISTORICAL PERFORMANCE LOOP EVALUATION CASES (COMPLETED EARLIER PERIOD)
// ============================================================================
export interface DemoPerformanceLoopMetric {
  metricName: string;
  definition: string;
  baselineValue: string;
  baselineRawCounts: string;
  followUpValue: string;
  followUpRawCounts: string;
  calculatedDelta: string;
  direction: "POSITIVE" | "NEUTRAL" | "NEGATIVE";
}

export interface DemoPerformanceLoopCase {
  id: string;
  caseNumber: number;
  title: string;
  outcomeType:
    | "ENCOURAGING_IMPROVEMENT"
    | "NEUTRAL_RESULT"
    | "UNDERPERFORMING"
    | "MIXED_TRADEOFF"
    | "INSUFFICIENT_EVIDENCE";
  outcomeBadgeLabel: string;
  outcomeColor: string;
  historicalAction: string;
  hypothesis: string;
  strategyVersion: string;
  laneId: string;
  laneTitle: string;
  channel: string;
  originatingEventId: string | null;
  originatingEventLabel: string;
  baselinePeriod: string;
  followUpPeriod: string;
  metrics: DemoPerformanceLoopMetric[];
  interpretation: string;
  limitations: string;
  recommendedNextStep: string;
  simulatedDisclosure: string;
}

export const DEMO_PERFORMANCE_LOOP_CASES: DemoPerformanceLoopCase[] = [
  {
    id: "perf_case_demo_01",
    caseNumber: 1,
    title: "Macro Knife-Cut ASMR Reel vs. Studio Tabletop Photo Ad (Top-of-Funnel Discovery)",
    outcomeType: "ENCOURAGING_IMPROVEMENT",
    outcomeBadgeLabel: "Encouraging Improvement",
    outcomeColor: "#10B981",
    historicalAction:
      "Replaced static studio tabletop photography with an unedited 15-second macro knife-cut Reel featuring live directional audio of the 40-layer phyllo crunch and a close-up of the 38% (152g) emerald Boz pistachio cross-section.",
    hypothesis:
      "Demonstrating audible dry phyllo crunch and visible emerald pistachio density in the first 3 seconds will increase thumbstop rate and outbound CTR by overcoming buyer skepticism of soggy boxed baklava.",
    strategyVersion: "Strategy v1 (Initial Launch Calibration)",
    laneId: DEMO_IDS.lanes.gifting,
    laneTitle: "Lane 1 · Dinner-Host & Cultural Occasion Gifting (400g Signature Tin — $32 USD)",
    channel: "Instagram Reels & TikTok Short-Form Video",
    originatingEventId: "pce_demo_wt_07",
    originatingEventLabel: "Customer Voice & Watchtower Sensory Crunch Signal (ev_mv_serbet_02 / pce_demo_wt_07)",
    baselinePeriod: "Sep 2 – Sep 15, 2026 (14-Day Baseline Window)",
    followUpPeriod: "Sep 16 – Sep 29, 2026 (14-Day Follow-Up Window)",
    metrics: [
      {
        metricName: "Outbound Click-Through Rate (CTR) [Simulated]",
        definition: "Outbound Link Clicks ÷ Total Ad Impressions",
        baselineValue: "1.60%",
        baselineRawCounts: "588 outbound clicks ÷ 36,750 impressions",
        followUpValue: "2.40%",
        followUpRawCounts: "996 outbound clicks ÷ 41,500 impressions",
        calculatedDelta: "+0.80 pp (+50.0% relative lift)",
        direction: "POSITIVE",
      },
      {
        metricName: "3-Second Video Thumbstop Rate [Simulated]",
        definition: "3-Second Video Plays ÷ Total Impressions",
        baselineValue: "23.0%",
        baselineRawCounts: "8,453 plays ÷ 36,750 impressions",
        followUpValue: "34.0%",
        followUpRawCounts: "14,110 plays ÷ 41,500 impressions",
        calculatedDelta: "+11.0 pp (+47.8% relative lift)",
        direction: "POSITIVE",
      },
    ],
    interpretation:
      "Simulated telemetry shows a meaningful improvement in both thumbstop rate (+11.0 pp) and outbound CTR (+0.80 pp) during the Sep 16–29 follow-up window. Hearing the dry 40-layer crunch and seeing zero pooled syrup on camera addressed the #1 buyer pain early in the scroll.",
    limitations:
      "Sequential 14-day before/after observation window coincided with late-September autumn dinner-hosting seasonality. Represents observed timeline correlation, not isolated randomized causal proof.",
    recommendedNextStep:
      "Retain the 15-second macro knife-cut ASMR format as the baseline Lane 1 creative pillar and adapt it if competitor price-comparison hooks emerge.",
    simulatedDisclosure: "SIMULATED HISTORICAL DEMO TELEMETRY (Completed Period: Sep 2 – Sep 29, 2026)",
  },
  {
    id: "perf_case_demo_02",
    caseNumber: 2,
    title: "'Small-Batch New York Atelier' vs. 'Gaziantep Boz Harvest' in Google Search Headlines",
    outcomeType: "NEUTRAL_RESULT",
    outcomeBadgeLabel: "Neutral Result",
    outcomeColor: "#3B82F6",
    historicalAction:
      "Updated Pinned Headline 2 on high-intent Google Search ads ('pistachio baklava gift tin') from 'Small-Batch New York Atelier' to 'Early-Harvest Gaziantep Boz Pistachio'.",
    hypothesis:
      "Highlighting Gaziantep agricultural origin directly in the search ad headline would materially increase search CTR and checkout conversion rate.",
    strategyVersion: "Strategy v1 (Initial Launch Calibration)",
    laneId: DEMO_IDS.lanes.gifting,
    laneTitle: "Lane 1 & Lane 2 · High-Intent Search Capture",
    channel: "Google High-Intent Search",
    originatingEventId: null,
    originatingEventLabel: "Baseline Search Copy Calibration",
    baselinePeriod: "Sep 5 – Sep 18, 2026 (14-Day Baseline Window)",
    followUpPeriod: "Sep 19 – Oct 2, 2026 (14-Day Follow-Up Window)",
    metrics: [
      {
        metricName: "Search Ad Click-Through Rate (CTR) [Simulated]",
        definition: "Search Ad Clicks ÷ Search Impressions",
        baselineValue: "4.60%",
        baselineRawCounts: "414 clicks ÷ 9,000 impressions",
        followUpValue: "4.70%",
        followUpRawCounts: "437 clicks ÷ 9,300 impressions",
        calculatedDelta: "+0.10 pp (+2.2% relative change — noise floor)",
        direction: "NEUTRAL",
      },
      {
        metricName: "Search Checkout Conversion Rate (CVR) [Simulated]",
        definition: "Completed Orders ÷ Search Ad Clicks",
        baselineValue: "3.62%",
        baselineRawCounts: "15 orders ÷ 414 clicks ($22.80 CPA on $342 spend)",
        followUpValue: "3.66%",
        followUpRawCounts: "16 orders ÷ 437 clicks ($22.50 CPA on $360 spend)",
        calculatedDelta: "+0.04 pp (+1.1% relative change — neutral)",
        direction: "NEUTRAL",
      },
    ],
    interpretation:
      "Both headline variants performed virtually identically (~4.65% CTR and ~3.64% CVR). Shoppers typing high-intent queries like 'antep pistachio baklava gift tin' already expect Turkish pistachio provenance and care primarily about 2-day air delivery speed and price clarity on the landing page.",
    limitations:
      "With ~425 clicks and 15–16 orders per 14-day window on a $675/mo search budget, the test is only powered to detect large shifts (>1.2 pp), not minor copy differences.",
    recommendedNextStep:
      "Stop iterating on search headline origin adjectives; keep both headlines in standard rotation and focus search improvements on landing-page bundle & gifting clarity.",
    simulatedDisclosure: "SIMULATED HISTORICAL DEMO TELEMETRY (Completed Period: Sep 5 – Oct 2, 2026)",
  },
  {
    id: "perf_case_demo_03",
    caseNumber: 3,
    title: "Broad 'Mediterranean Diet & Culinary Travel' Interest Expansion on Meta Prospecting",
    outcomeType: "UNDERPERFORMING",
    outcomeBadgeLabel: "Underperforming Action",
    outcomeColor: "#EF4444",
    historicalAction:
      "Allocated $280 in prospecting spend to a broad 'Mediterranean Diet, Olive Oil & Culinary Travel' interest cohort using general heritage pastry storytelling instead of dinner-host and gifting occasion hooks.",
    hypothesis:
      "Targeting a wider Mediterranean food-lover audience with lower CPMs would scale $32 single-tin acquisition efficiently.",
    strategyVersion: "Strategy v1 (Initial Launch Calibration)",
    laneId: DEMO_IDS.lanes.gifting,
    laneTitle: "Lane 1 · Dinner-Host & Cultural Occasion Gifting (400g Signature Tin — $32 USD)",
    channel: "Instagram / Meta Prospecting",
    originatingEventId: null,
    originatingEventLabel: "Top-of-Funnel Audience Expansion Test",
    baselinePeriod: "Sep 8 – Sep 17, 2026 (10-Day Core Host & Gifting Audience Baseline)",
    followUpPeriod: "Sep 18 – Sep 27, 2026 (10-Day Broad Culinary/Travel Cohort Test)",
    metrics: [
      {
        metricName: "PDP-to-Cart Progression Rate [Simulated]",
        definition: "Add-to-Cart Sessions ÷ Product Page Sessions",
        baselineValue: "9.60%",
        baselineRawCounts: "82 add-to-carts ÷ 854 PDP sessions",
        followUpValue: "4.20%",
        followUpRawCounts: "29 add-to-carts ÷ 690 PDP sessions",
        calculatedDelta: "-5.40 pp (-56.3% relative drop)",
        direction: "NEGATIVE",
      },
      {
        metricName: "Customer Acquisition Cost (CPA) [Simulated]",
        definition: "Total Ad Spend ÷ Completed Orders",
        baselineValue: "$22.00 USD",
        baselineRawCounts: "$528.00 spend ÷ 24 completed orders",
        followUpValue: "$40.00 USD",
        followUpRawCounts: "$280.00 spend ÷ 7 completed orders",
        calculatedDelta: "+$18.00 USD per order (+81.8% higher CPA — breached $34 guardrail)",
        direction: "NEGATIVE",
      },
    ],
    interpretation:
      "Although CPMs were 18% lower in the broad culinary/travel cohort, visitors clicked out of casual recipe curiosity rather than an active hosting or gifting need. PDP-to-cart rate fell by more than half (9.60% → 4.20%) and CPA rose to $40.00 USD, tripping our $34.00 pause guardrail.",
    limitations:
      "Capped $280 spend window (7 conversions in test cohort); however, the -5.40 pp drop in add-to-cart progression across 690 PDP sessions provided clear early evidence of low purchase intent.",
    recommendedNextStep:
      "Keep broad culinary/travel interest targeting paused; concentrate 100% of Meta prospecting on explicit dinner-hosting, cultural holiday, and executive gifting occasions.",
    simulatedDisclosure: "SIMULATED HISTORICAL DEMO TELEMETRY (Completed Period: Sep 8 – Sep 27, 2026)",
  },
  {
    id: "perf_case_demo_04",
    caseNumber: 4,
    title: "Pre-Selecting the $60 2-Tin Host Bundle as the Default PDP Option (vs. $32 Single Tin Default)",
    outcomeType: "MIXED_TRADEOFF",
    outcomeBadgeLabel: "Mixed Result · Conversion vs. AOV Trade-Off",
    outcomeColor: "#F59E0B",
    historicalAction:
      "Changed the product page radio selector to pre-select the '$60 2-Tin Host Bundle (800g · Free 2-Day Air)' by default on page load instead of the '$32 Single 400g Tin'.",
    hypothesis:
      "Defaulting shoppers into the $60 2-Tin Bundle would increase bundle take-rate and Average Order Value (AOV) without hurting total checkout conversion.",
    strategyVersion: "Strategy v1 (Initial Launch Calibration)",
    laneId: DEMO_IDS.lanes.gifting,
    laneTitle: "Lane 1 · Dinner-Host & Cultural Occasion Gifting (400g Signature Tin — $32 USD)",
    channel: "DTC Website Product Detail Page (PDP)",
    originatingEventId: null,
    originatingEventLabel: "AOV & Bundle Take-Rate Experiment (ev_mv_kervan_03)",
    baselinePeriod: "Sep 10 – Sep 21, 2026 (12-Day Window · $32 Single Tin Default)",
    followUpPeriod: "Sep 22 – Oct 3, 2026 (12-Day Window · $60 2-Tin Bundle Default)",
    metrics: [
      {
        metricName: "Blended Average Order Value (AOV) [Simulated]",
        definition: "Gross Order Revenue ÷ Completed Orders",
        baselineValue: "$43.00 USD",
        baselineRawCounts: "$2,107 revenue ÷ 49 orders (19 bundles / 49 orders = 38.8% bundle share)",
        followUpValue: "$51.00 USD",
        followUpRawCounts: "$2,193 revenue ÷ 43 orders (29 bundles / 43 orders = 67.4% bundle share)",
        calculatedDelta: "+$8.00 USD (+18.6% AOV lift; +28.6 pp bundle share)",
        direction: "POSITIVE",
      },
      {
        metricName: "Overall PDP Checkout Conversion Rate [Simulated]",
        definition: "Completed Orders ÷ Unique PDP Visitors",
        baselineValue: "3.50%",
        baselineRawCounts: "49 completed orders ÷ 1,400 unique PDP visitors ($1,505 rev / 1k visitors)",
        followUpValue: "2.90%",
        followUpRawCounts: "43 completed orders ÷ 1,483 unique PDP visitors ($1,479 rev / 1k visitors)",
        calculatedDelta: "-0.60 pp (-17.1% relative drop in unit conversion rate)",
        direction: "NEGATIVE",
      },
    ],
    interpretation:
      "Clear commercial trade-off: pre-selecting the $60 bundle lifted AOV by +$8.00 (+18.6%), but caused a -0.60 pp drop in overall conversion rate because first-time cold visitors clicked ads expecting a $32 gift tin and experienced sticker shock seeing '$60.00' pre-selected.",
    limitations:
      "Applied across all traffic sources simultaneously rather than segmenting first-time cold visitors from returning gift buyers.",
    recommendedNextStep:
      "Revert the PDP default radio selection back to the $32 Single 400g Tin to protect first-time unit conversion, and test driving voluntary $60 2-Tin upgrades through clear guest serving-count guidance or a tangible bonus item.",
    simulatedDisclosure: "SIMULATED HISTORICAL DEMO TELEMETRY (Completed Period: Sep 10 – Oct 3, 2026)",
  },
  {
    id: "perf_case_demo_05",
    caseNumber: 5,
    title: "Printed QR 'Gaziantep Harvest & Stone-Bake Video' Insert Inside Delivered 400g Tins",
    outcomeType: "INSUFFICIENT_EVIDENCE",
    outcomeBadgeLabel: "Insufficient Evidence to Conclude",
    outcomeColor: "#94A3B8",
    historicalAction:
      "Added a QR code on the physical Batch Roast Card inside shipped 400g tins linking gift recipients to a 45-second Gaziantep Boz pistachio harvest & copper-tray stone-baking video with a host reorder link.",
    hypothesis:
      "Dinner guests and gift recipients who scan the Batch Roast Card at the table will convert into new first-party gift buyers within 21 days.",
    strategyVersion: "Strategy v1 (Initial Launch Calibration)",
    laneId: DEMO_IDS.lanes.hosting,
    laneTitle: "Lane 2 & Lane 1 · Post-Purchase Recipient Viral Loop",
    channel: "Physical Tin Batch Card Insert → Direct Web",
    originatingEventId: "pce_demo_wt_08",
    originatingEventLabel: "Batch Provenance Card Enhancement (ev_mv_altin_03)",
    baselinePeriod: "Sep 15 – Sep 26, 2026 (12-Day Window · Batch Card Without QR)",
    followUpPeriod: "Sep 27 – Oct 8, 2026 (12-Day Window · Batch Card With QR Video Link)",
    metrics: [
      {
        metricName: "Recipient QR Scan Engagement Rate [Simulated]",
        definition: "Unique QR Scans ÷ Delivered 400g Tins",
        baselineValue: "0.0%",
        baselineRawCounts: "0 scans ÷ 52 delivered tins (no QR code printed)",
        followUpValue: "19.0%",
        followUpRawCounts: "11 unique scans ÷ 58 delivered tins",
        calculatedDelta: "+19.0 pp (11 unique table scans recorded)",
        direction: "POSITIVE",
      },
      {
        metricName: "Attributed Recipient-to-Buyer Reorder Rate [Simulated]",
        definition: "Attributed Recipient Orders ÷ Delivered 400g Tins",
        baselineValue: "3.85%",
        baselineRawCounts: "2 direct referral orders ÷ 52 delivered tins",
        followUpValue: "5.17%",
        followUpRawCounts: "3 attributed orders ÷ 58 delivered tins",
        calculatedDelta: "+1.32 pp (+1 order difference; n=58 tins is statistically underpowered)",
        direction: "NEUTRAL",
      },
    ],
    interpretation:
      "While 11 unique scans across 58 delivered tins (19.0%) shows encouraging curiosity at the dinner table, a difference of 3 vs. 2 orders (n=58 delivered tins) over a partial 12-day post-delivery window is far below the sample size required to evaluate a retention/referral loop.",
    limitations:
      "Small physical shipment denominator (58 tins) and incomplete 21-to-30 day gifting reorder cycle.",
    recommendedNextStep:
      "Do not reallocate budget or claim a validated referral multiplier yet; keep the zero-cost QR code on the printed Batch Roast Card until at least 250+ delivered tins complete a full 30-day maturity window.",
    simulatedDisclosure: "SIMULATED HISTORICAL DEMO TELEMETRY (Completed Period: Sep 15 – Oct 8, 2026)",
  },
];

// ============================================================================
// 4. THE 3 ACTIONABLE DEEP REASONING SCENARIOS (A, B, C)
// ============================================================================
export interface DemoBeforeAfterPatchItem {
  sectionName: string;
  authority: string;
  fieldLabel: string;
  beforeText: string;
  afterText: string;
}

export interface DemoDeepReasoningScenarioSpec {
  scenarioId: DemoScenarioId;
  code: "A" | "B" | "C";
  eventId: string;
  watchtowerBriefId: string;
  reasoningCaseId: string;
  adaptiveDecisionId: string;
  proposalId: string;
  title: string;
  shortTitle: string;
  competitorId: string;
  competitorName: string;
  whatChanged: string;
  supportingEvidenceIds: string[];
  supportingEvidenceSummary: string;
  affectedStrategicAssumption: string;
  relevantAudience: string;
  relevantOffering: string;
  relevantLaneId: string;
  relevantLaneTitle: string;
  whyResponseWarranted: string;
  proposedResponse: string;
  tradeOffs: string[];
  affectedAuthorities: string[];
  potentialDependentAuthorities: string[];
  preservedAuthorities: string[];
  beforeAfterPatchPreview: DemoBeforeAfterPatchItem[];
  changedPlanSectionsSummary: string[];
  changedTasksSummary: string[];
  unchangedExplanation: string;
  hypotheses: Array<{
    id: string;
    hypothesisType: string;
    explanation: string;
    status: "VALIDATED" | "REJECTED";
    confidence: number;
    supportingEvidenceIds: string[];
    contradictingEvidenceIds: string[];
  }>;
}

export const DEMO_DEEP_REASONING_SCENARIO_MAP: Record<
  DemoScenarioId,
  DemoDeepReasoningScenarioSpec
> = {
  // --------------------------------------------------------------------------
  // SCENARIO A — Competitor Price Reduction ($32 -> $25 400g Box)
  // --------------------------------------------------------------------------
  SCENARIO_A_PRICE: {
    scenarioId: "SCENARIO_A_PRICE",
    code: "A",
    eventId: "pce_demo_wt_01",
    watchtowerBriefId: "wsb_demo_wt_01",
    reasoningCaseId: "rcase_demo_scenario_a",
    adaptiveDecisionId: "adec_demo_scenario_a",
    proposalId: "prop_demo_scenario_a",
    title:
      "Scenario A · Counter KervanSaray's $25 400g 'Bazaar Value Box' via 152g Pistachio Gram-Math Proof & 40g Host Tasting Sleeve",
    shortTitle: "Scenario A: Competitor Price Cut ($32 → $25)",
    competitorId: DEMO_IDS.competitors.kervansaray,
    competitorName: "KervanSaray Baklava",
    whatChanged:
      "Direct competitor KervanSaray Baklava cut entry pricing on its 400g assortment from $32.00 USD to $25.00 USD (-22%) via a new '400g Bazaar Value Box' and launched Instagram Reels asking 'Why pay $32+ for a 400g baklava box when ours is $25?' Catalog and review evidence shows the $25 box inflates weight with 52% glucose syrup (208g sugar water) and cuts pistachio weight to ~75g (~19%).",
    supportingEvidenceIds: [
      "ev_wt_kervan_diff_01",
      "ev_mv_kervan_01",
      "ev_mv_kervan_02",
      "pf_cap_01",
    ],
    supportingEvidenceSummary:
      "Watchtower catalog diff (ev_wt_kervan_diff_01: $32 → $25 400g box with 52% syrup weight), Trustpilot & Reddit reviews (ev_mv_kervan_01, ev_mv_kervan_02: pooled bottom glucose syrup and peanut/walnut substitution), and Zeytun verified capability pf_cap_01 (152g / 38% pure Boz Antep pistachio per 400g tin).",
    affectedStrategicAssumption:
      "Lane 1 Differentiation & Offer Assumption: Assumed that stating '38% Boz pistachio and low syrup' in standard copy was enough to justify $32 USD without a direct gram-for-gram comparison against $25 400g promo boxes.",
    relevantAudience:
      "Discerning Dinner Hosts & Cultural Gift Buyers ($30–$65 Spend)",
    relevantOffering:
      "Antep Pistachio Baklava & Kadayif Assortment Box (400g / 18 pieces — $32 USD Single Tin / $60 USD 2-Tin Host Bundle)",
    relevantLaneId: DEMO_IDS.lanes.gifting,
    relevantLaneTitle:
      "Lane 1 · Dinner-Host & Cultural Occasion Gifting (400g Signature Tin — $32 USD)",
    whyResponseWarranted:
      "First-time shoppers comparing '400g vs 400g' see a $7 headline gap ($25 vs $32) before realizing KervanSaray's box is over half sugar water (208g syrup). Cutting our $32 price would destroy gross margin and violate our 38% Boz pistachio product truth, whereas exposing the exact gram math (152g real pistachio vs ~75g) and adding a 40g Host Preview Tasting Sleeve on 2-tin orders disarms the price anchor immediately.",
    proposedResponse:
      "Update Differentiation Pillar 1 and Offer Value Architecture in Lane 1: (1) Reframe creative & PDP around '152g Real Boz Pistachio ($0.21/g nut) vs 208g Glucose Syrup in $25 Promo Boxes ($0.33/g nut)'; (2) Keep Single 400g Tin at $32.00 USD; (3) Add a complimentary 40g 'Host Preview' 2-Piece Boz Pistachio Tasting Sleeve to the $60 2-Tin Host Bundle so gift buyers can taste the crunch without breaking the gift tin's nitrogen seal.",
    tradeOffs: [
      "Unit COGS Trade-Off: Adding the 40g (2-piece) Host Preview Tasting Sleeve to $60 2-Tin Bundles adds $1.85 in ingredient/packaging cost per 2-tin order, which is far more margin-efficient than a $7.00 (-22%) price discount on single tins.",
      "Creative Focus Trade-Off: Dedicates Stage 1 hook seconds to scale/gram comparison rather than purely aesthetic table imagery.",
    ],
    affectedAuthorities: ["DIFFERENTIATION", "OFFER"],
    potentialDependentAuthorities: ["FUNNEL", "PERSUASION", "PLAN_SYNTHESIS"],
    preservedAuthorities: [
      "BUSINESS_UNDERSTANDING",
      "AUDIENCE",
      "POSITIONING",
      "MECHANISM",
      "CHANNEL_SELECTION",
      "BUDGET_GOVERNOR",
    ],
    beforeAfterPatchPreview: [
      {
        sectionName: "Differentiation Strategy (Pillar 1)",
        authority: "DIFFERENTIATION",
        fieldLabel: "Pillar 1 Claim & Competitor Contrast",
        beforeText:
          "38% Early-Harvest Boz Antep Pistachio Content & 24% Micro-Brix Syrup Balance — Contrasts against competitors where customer reviews cite pooled bottom syrup.",
        afterText:
          "Verified 38% Boz Pistachio Weight (152g Pure Nut Core vs ~75g in $25 Syrup-Heavy 400g Boxes) — Exposes KervanSaray's 52% glucose-syrup weight trick (208g sugar water) and proves 2x real pistachio per dollar.",
      },
      {
        sectionName: "Offer & Value Architecture (Lane 1)",
        authority: "OFFER",
        fieldLabel: "Hero Offer & $60 2-Tin Bundle Value Stack",
        beforeText:
          "$32 Signature 400g Tin (18 Pieces + Batch Roast Card), or $60 2-Tin Host Bundle with Free 2-Day US Air Shipping.",
        afterText:
          "$32 Signature 400g Tin (18 Pieces + Gram-Ratio Roast Card, price held firm), or $60 2-Tin Host Bundle + Free 2-Day Air + Complimentary 40g 'Host Preview' 2-Piece Tasting Sleeve (taste without unsealing the gift tin).",
      },
      {
        sectionName: "What To Do Today & Weekly Action Plan",
        authority: "EXECUTION",
        fieldLabel: "Priority P0 Execution Task",
        beforeText:
          "Film & Publish 15s Macro Knife-Cut ASMR Reel (38% Boz Pistachio & 40-Layer Crunch).",
        afterText:
          "[Scenario A · Price Counter] Publish 15s '152g Boz Pistachio vs $25 Syrup Box' Scale & Cut-Open Reel + Activate 40g Host Tasting Sleeve on $60 2-Tin PDP.",
      },
    ],
    changedPlanSectionsSummary: [
      "Differentiation Pillar 1: Updated to 'Verified 38% Boz Pistachio Weight (152g Pure Nut Core vs ~75g in $25 Syrup-Heavy 400g Boxes)'.",
      "Offer & Value Stack: Added Complimentary 40g 'Host Preview' 2-Piece Tasting Sleeve on $60 2-Tin Host Bundles while holding $32 Single Tin price.",
      "Funnel Stage 1 (Top-of-Funnel Hook): Updated to 15-second digital scale & cross-section gram comparison.",
      "What To Do Today: Added P0 task for 15s Scale Comparison Reel & 40g Tasting Sleeve PDP activation.",
    ],
    changedTasksSummary: [
      "[Scenario A · P0] Film & Publish 15s '152g Boz Pistachio vs $25 Syrup Box' Scale & Cut-Open Reel (Instagram Reels & TikTok)",
      "[Scenario A · P1] Activate '40g Host Preview 2-Piece Tasting Sleeve' Bonus Badge on $60 2-Tin Host Bundle PDP",
    ],
    unchangedExplanation:
      "Single-tin price ($32.00 USD), Audience segments, Core Mechanism (40-layer sheep-milk butter stone bake), Lane 2 (Executive Gifting), and the $4,500/mo Budget Governor remain unchanged because the threat is a superficial 400g price-anchor illusion rather than a flaw in our product or audience fit.",
    hypotheses: [
      {
        id: "rhyp_demo_scen_a_01",
        hypothesisType: "NOMINAL_PACK_WEIGHT_PRICE_ANCHOR",
        explanation:
          "VALIDATED HYPOTHESIS: KervanSaray's $25 400g 'Bazaar Value Box' creates price hesitation only when shoppers assume all 400g boxes contain equal pistachio weight. Showing that our $32 tin contains 152g (38%) Boz pistachio vs ~75g nut / 208g glucose syrup in the $25 box—and adding a 40g Host Preview Tasting Sleeve on $60 2-tin orders—neutralizes the $25 anchor without discounting our $32 unit price.",
        status: "VALIDATED",
        confidence: 0.94,
        supportingEvidenceIds: [
          "ev_wt_kervan_diff_01",
          "ev_mv_kervan_01",
          "ev_mv_kervan_02",
          "pf_cap_01",
        ],
        contradictingEvidenceIds: [],
      },
      {
        id: "rhyp_demo_scen_a_02",
        hypothesisType: "CATEGORY_WIDE_PRICE_ELASTICITY_COLLAPSE",
        explanation:
          "REJECTED HYPOTHESIS: US gift buyers are unwilling to pay $32 for 400g baklava tins and require an across-the-board price cut to $25. Contradicted by strong demand for $36–$47 competitor gift tins when presentation and nut density are clear.",
        status: "REJECTED",
        confidence: 0.21,
        supportingEvidenceIds: [],
        contradictingEvidenceIds: ["ev_mv_altin_02", "ev_mv_serbet_02"],
      },
    ],
  },

  // --------------------------------------------------------------------------
  // SCENARIO B — Seasonal & Corporate Gifting Demand Signal (AltınFıstık Concierge)
  // --------------------------------------------------------------------------
  SCENARIO_B_GIFTING: {
    scenarioId: "SCENARIO_B_GIFTING",
    code: "B",
    eventId: "pce_demo_wt_02",
    watchtowerBriefId: "wsb_demo_wt_02",
    reasoningCaseId: "rcase_demo_scenario_b",
    adaptiveDecisionId: "adec_demo_scenario_b",
    proposalId: "prop_demo_scenario_b",
    title:
      "Scenario B · Capture Q4 Executive & Holiday Multi-Tin Gifting Surge via Self-Serve Gift-Note Funnel & $450/mo Search/Carousel Reallocation",
    shortTitle: "Scenario B: Gifting-Demand Signal & Concierge",
    competitorId: DEMO_IDS.competitors.altinfistik,
    competitorName: "AltınFıstık Confections",
    whatChanged:
      "Watchtower confirmed AltınFıstık Confections launched a self-serve 'Executive & Holiday Multi-Box Gift Desk' on its PDP (2-Box Client Duo at $70 USD / 4-Box Executive Set at $136 USD) with instant printed gift-note entry amid a +42% surge in corporate and holiday gifting search demand. However, AltınFıstık still ships via 5-day economy ground unless buyers pay a +$24 air fee.",
    supportingEvidenceIds: [
      "ev_wt_altin_gifting_02",
      "ev_wt_altin_ship_04",
      "ev_mv_altin_01",
      "pf_cap_03",
      "pf_bnd_03",
    ],
    supportingEvidenceSummary:
      "Watchtower PDP diff (ev_wt_altin_gifting_02: AltınFıstık $70 2-Box / $136 4-Box self-serve gift desk), shipping policy diff (ev_wt_altin_ship_04: $95 ground threshold, +$24 for 2-day air), customer complaints (ev_mv_altin_01: 5-day ground soggy kadayif), and Zeytun verified capability pf_cap_03 & boundary pf_bnd_03 (printed gift note cards supported on all orders; free 2-day air on $60 2-Tin and $118 4-Tin packs; no custom tin embossing under 25 units).",
    affectedStrategicAssumption:
      "Lane 2 Funnel & Channel Allocation Assumption: Assumed that keeping gift-note entry buried at the final checkout step and allocating only 15% ($675/mo) to high-intent search & retargeting was sufficient during peak client/holiday gifting season.",
    relevantAudience:
      "Boutique Executive & Client Appreciation Buyers (2–10 Box Orders) & Holiday Gift Hosts",
    relevantOffering:
      "2-Tin Host Bundle ($60 USD · 800g) & Executive 4-Tin Appreciation Pack ($118 USD · 1.6kg) with Free 2-Day US Air",
    relevantLaneId: DEMO_IDS.lanes.hosting,
    relevantLaneTitle:
      "Lane 2 · Boutique Executive & Client Appreciation Gifting (Multi-Tin Bundles)",
    whyResponseWarranted:
      "High-AOV multi-tin buyers ($60–$118) are actively shopping right now. We beat AltınFıstık on both multi-tin price ($60/$118 vs $70/$136) and included 2-day air transit (vs 5-day ground), but we need to surface instant gift-note personalization on the PDP/Funnel and shift budget into high-intent gifting search & carousel retargeting to capture those ready-to-buy orders.",
    proposedResponse:
      "Update Lane 2 Positioning/Offer Hook, Funnel Stage 2/3, and Channel/Budget Allocation: (1) Surface 'Self-Serve Personalized Gift Note Card + Guaranteed Free 2-Day Air ($60 2-Tin / $118 4-Tin vs Competitor $70/$136 5-Day Ground)' in Lane 2 and Funnel Stage 3; (2) Reallocate $450/mo within the existing $4,500/mo budget from broad top-of-funnel video (IG Reels $2,700 → $2,475; TikTok $1,125 → $900) into High-Intent Executive & Holiday Gifting Search & Carousel Retargeting ($675 → $1,125/mo, total budget reconciled strictly to $4,500/mo).",
    tradeOffs: [
      "Channel Mix Trade-Off: Shifting $450/mo (-10% of total budget) from top-of-funnel TikTok/Reels discovery into High-Intent Gifting Search & Carousel slightly trims cold reach (-14,000 impressions/mo) in exchange for capturing high-AOV ($60–$118) bottom-of-funnel multi-tin orders.",
      "Operational Boundary Honored: Explicitly offers printed personalized gift note cards on 2-tin and 4-tin orders while honoring pf_bnd_03 (no custom steel tin lid embossing under 25 units).",
    ],
    affectedAuthorities: ["FUNNEL", "CHANNEL_SELECTION", "BUDGET_GOVERNOR"],
    potentialDependentAuthorities: ["OFFER", "PLAN_SYNTHESIS"],
    preservedAuthorities: [
      "BUSINESS_UNDERSTANDING",
      "AUDIENCE",
      "DIFFERENTIATION",
      "MECHANISM",
    ],
    beforeAfterPatchPreview: [
      {
        sectionName: "Strategic Lanes & Occasion Messaging (Lane 2)",
        authority: "FUNNEL",
        fieldLabel: "Lane 2 Positioning Hook & Funnel Stage 2/3 Callout",
        beforeText:
          "Executive 4-Tin Appreciation Pack ($118 USD, $29.50/tin) with Personalized Gift Cards & Guaranteed 2-Day Air Dispatch (30% Budget Share).",
        afterText:
          "Self-Serve Multi-Tin Gift Concierge ($60 2-Tin Duo & $118 4-Tin Executive Pack): Instant Custom Printed Gift Note Cards + Free 2-Day Air (Saves $10–$18 + 3 Days Transit vs AltınFıstık's $70/$136 5-Day Ground Sets) (40% Budget Share).",
      },
      {
        sectionName: "Channels & Budget Governor ($4,500/mo Reconciled)",
        authority: "BUDGET_GOVERNOR",
        fieldLabel: "Monthly Channel Allocation ($4,500/mo Total Preserved)",
        beforeText:
          "• Instagram Reels & Carousels: $2,700/mo (60%)\n• TikTok Short-Form Proof: $1,125/mo (25%)\n• Google Search & BOFU Retargeting: $675/mo (15%)\nTotal: $4,500/mo",
        afterText:
          "• Instagram Reels & Executive Gift Carousels: $2,475/mo (55%)\n• TikTok Short-Form Proof: $900/mo (20%)\n• Google High-Intent Gifting Search & Multi-Tin Retargeting: $1,125/mo (25%, +$450/mo shift)\nTotal: $4,500/mo (Strictly Reconciled)",
      },
      {
        sectionName: "What To Do Today & Weekly Action Plan",
        authority: "EXECUTION",
        fieldLabel: "High-Intent Gifting Execution Task",
        beforeText:
          "Run Executive 4-Tin Appreciation Pack ($118 USD) Retargeting & Search Capture ($675/mo allocation).",
        afterText:
          "[Scenario B · Gifting Surge] Enable Above-the-Fold 'Custom Gift Note + Multi-Tin Concierge' PDP Module & Scale Executive/Holiday Search + Carousel to $1,125/mo.",
      },
    ],
    changedPlanSectionsSummary: [
      "Lane 2 (Boutique Executive & Client Appreciation): Upgraded offer hook to contrast $60 2-Tin / $118 4-Tin + Free 2-Day Air + Instant Gift Note Card against AltınFıstık's $70/$136 5-day ground sets.",
      "Buyer Conversion Journey (Funnel Stage 3 & Lane 2 Journey): Added Self-Serve Gift-Note Entry & Multi-Recipient Checkout callout above the fold.",
      "Channels & Budget Governor: Reallocated $450/mo within the existing $4,500/mo ceiling (IG $2,475 [55%] · TikTok $900 [20%] · Google Search & Gifting Retargeting $1,125 [25%] = $4,500/mo).",
      "What To Do Today: Updated paid acquisition & PDP gifting concierge tasks.",
    ],
    changedTasksSummary: [
      "[Scenario B · P0] Deploy Self-Serve 'Instant Printed Gift Note + 2-Tin ($60) / 4-Tin ($118) Concierge' Callout on PDP & Checkout",
      "[Scenario B · P1] Reallocate $450/mo to High-Intent Executive & Holiday Gifting Google Search & Carousel ($1,125/mo Governed Cap)",
    ],
    unchangedExplanation:
      "Total monthly budget remains strictly locked at $4,500/mo, unit prices ($32 / $60 / $118) are unchanged, and operational boundaries (pf_bnd_03: printed paper gift cards included, no custom tin lid embossing under 25 units) are strictly honored.",
    hypotheses: [
      {
        id: "rhyp_demo_scen_b_01",
        hypothesisType: "HIGH_INTENT_MULTI_TIN_GIFTING_CAPTURE",
        explanation:
          "VALIDATED HYPOTHESIS: Rising Q4 executive and holiday gifting demand favors brands that make 2-box and 4-box gift-note personalization effortless on the PDP. Surfacing our included printed gift note card + Free 2-Day Air on $60/$118 bundles and shifting $450/mo into high-intent gifting search/retargeting will capture multi-tin buyers who would otherwise pay $70/$136 for AltınFıstık's slower 5-day ground sets.",
        status: "VALIDATED",
        confidence: 0.92,
        supportingEvidenceIds: [
          "ev_wt_altin_gifting_02",
          "ev_wt_altin_ship_04",
          "ev_mv_altin_01",
          "pf_cap_03",
        ],
        contradictingEvidenceIds: [],
      },
      {
        id: "rhyp_demo_scen_b_02",
        hypothesisType: "CUSTOM_EMBOSSED_TIN_LID_REQUIREMENT",
        explanation:
          "REJECTED HYPOTHESIS: Small corporate buyers (2–4 boxes) require custom logo-embossed steel tin lids. Contradicted by AltınFıstık's own PDP diff (which uses printed paper gift notes) and our verified operational boundary pf_bnd_03 (tin embossing requires 25+ units).",
        status: "REJECTED",
        confidence: 0.18,
        supportingEvidenceIds: [],
        contradictingEvidenceIds: ["ev_wt_altin_gifting_02", "pf_bnd_03"],
      },
    ],
  },

  // --------------------------------------------------------------------------
  // SCENARIO C — Repeated Pack-Size & Guest Serving-Count Questions
  // --------------------------------------------------------------------------
  SCENARIO_C_PACKSIZE: {
    scenarioId: "SCENARIO_C_PACKSIZE",
    code: "C",
    eventId: "pce_demo_wt_03",
    watchtowerBriefId: "wsb_demo_wt_03",
    reasoningCaseId: "rcase_demo_scenario_c",
    adaptiveDecisionId: "adec_demo_scenario_c",
    proposalId: "prop_demo_scenario_c",
    title:
      "Scenario C · Resolve 400g Pack-Size & Guest-Count Hesitation via Explicit '6–9 Guests vs 12–16 Guests' Serving Guide & Host Carousel",
    shortTitle: "Scenario C: Pack-Size & Serving-Count Guide",
    competitorId: DEMO_IDS.competitors.kervansaray,
    competitorName: "KervanSaray Baklava",
    whatChanged:
      "Watchtower identified a repeated buyer question pattern across 34+ competitor comment threads and PDP updates: US dinner hosts do not know whether a '400g (18-piece)' tin is enough for 10–14 dinner guests or if they should order two tins (800g / 36 pieces). Competitor KervanSaray added a basic 'Serves 6–8' badge on carousel ads.",
    supportingEvidenceIds: [
      "ev_wt_packsize_qa_03",
      "ev_mv_kervan_03",
      "pf_cap_01",
    ],
    supportingEvidenceSummary:
      "Watchtower social Q&A cluster (ev_wt_packsize_qa_03: 34 buyer comments asking whether 400g / 18 pieces serves 6–8 or 10–14 guests), Google review evidence (ev_mv_kervan_03: 18-piece format as small-group sweet spot), first-party capability pf_cap_01 (10 classic baklava + 4 burma kadayif + 4 midye mussels = 18 pieces per 400g tin), and Historical Performance Loop Case 4 (which proved that forcing the $60 2-Tin Bundle as the default radio option hurt overall conversion by -0.60 pp).",
    affectedStrategicAssumption:
      "Offer & Mid-Funnel PDP Assumption: Assumed that listing '400g (18 pieces)' was self-explanatory for US dinner hosts deciding between buying 1 tin ($32) or 2 tins ($60).",
    relevantAudience:
      "Discerning Dinner Hosts & Cultural Gift Buyers ($30–$65 Spend)",
    relevantOffering:
      "Single 400g Signature Tin (18 Pieces — $32 USD) & 2-Tin Host Bundle (800g / 36 Pieces — $60 USD)",
    relevantLaneId: DEMO_IDS.lanes.gifting,
    relevantLaneTitle:
      "Lane 1 · Dinner-Host & Cultural Occasion Gifting (400g Signature Tin — $32 USD)",
    whyResponseWarranted:
      "When US hosts welcoming 10–16 guests cannot translate '400g' into table servings, they either abandon checkout out of portion anxiety or under-order a single tin. Because Performance Loop Case 4 showed that pre-selecting the $60 2-Tin Bundle by default caused sticker shock (-0.60 pp CVR), the right solution is explicit Guest Serving-Count Guidance above the fold while keeping the $32 Single Tin as the default entry option.",
    proposedResponse:
      "Update Offer Deliverables/Objections, Awareness Myth-Breakers, and Funnel Stage 2 (PDP & Carousel): (1) Add an explicit Guest Serving-Count & Platter Guide to the Offer & PDP selector ('1 Tin · 400g / 18 Pieces = Serves 6–9 Dinner Guests at $32' vs '2-Tin Host Bundle · 800g / 36 Pieces = Serves 12–16 Guests at $60 + Free 2-Day Air'); (2) Keep $32 Single Tin as the default radio selection; (3) Add a priority '18-Piece vs 36-Piece Dinner-Host Serving Guide' Carousel task in What To Do Today.",
    tradeOffs: [
      "Conversion vs. AOV Balance: Keeping the $32 Single Tin as default avoids the -0.60 pp cold-traffic sticker shock seen in Historical Case 4, while clear '12–16 Guests' guidance naturally upgrades hosts of larger gatherings into the $60 2-Tin Bundle.",
      "No New SKU Complexity: Uses existing 400g tins (1x vs 2x bundle) rather than introducing a new manufacturing tray size.",
    ],
    affectedAuthorities: ["OFFER", "AWARENESS", "FUNNEL"],
    potentialDependentAuthorities: ["PERSUASION", "PLAN_SYNTHESIS"],
    preservedAuthorities: [
      "BUSINESS_UNDERSTANDING",
      "AUDIENCE",
      "POSITIONING",
      "DIFFERENTIATION",
      "MECHANISM",
      "CHANNEL_SELECTION",
      "BUDGET_GOVERNOR",
    ],
    beforeAfterPatchPreview: [
      {
        sectionName: "Offer & Pack-Size Architecture (Lane 1)",
        authority: "OFFER",
        fieldLabel: "Guest Serving-Count & Portion Guidance",
        beforeText:
          "18 hand-layered pieces (10 Boz Pistachio Classic Baklava, 4 Crispy Burma Kadayif, 4 Midye Pistachio Mussels — 400g net weight). Single Tin $32 / 2-Tin Bundle $60.",
        afterText:
          "Explicit Guest Serving-Count Guide: • Single 400g Tin (18 Pieces: 10 Baklava, 4 Kadayif, 4 Midye — $32 USD, Default Selection) = Ideal for 6–9 Dinner Guests (2 pieces/guest).\n• 2-Tin Host Bundle (800g / 36 Pieces — $60 USD + Free 2-Day Air) = Ideal for 12–16 Dinner Guests or Holiday Tables.",
      },
      {
        sectionName: "Buyer Conversion Journey (Funnel Stage 2 — PDP & Carousel)",
        authority: "FUNNEL",
        fieldLabel: "Stage 2 Mid-Funnel Education & Objection Resolution",
        beforeText:
          "Stage 2: 18-Piece Assortment & Freshness Boundary Verification (Carousel & PDP) — Interactive 400g Tin Anatomy module on PDP.",
        afterText:
          "Stage 2: 18-Piece vs 36-Piece Guest Serving-Count Guide & Freshness Verification (Carousel & PDP) — Visual Platter Calculator ('Hosting 6–9 Guests? Pick 1 Tin [$32]. Hosting 12–16 Guests? Pick 2-Tin Bundle [$60 + Free 2-Day Air]').",
      },
      {
        sectionName: "What To Do Today & Weekly Action Plan",
        authority: "EXECUTION",
        fieldLabel: "Mid-Funnel Carousel & PDP Task",
        beforeText:
          "Deploy 5-Slide 'Inside the 400g Nitrogen Gift Tin' Carousel for Dinner Hosts.",
        afterText:
          "[Scenario C · Serving Guide] Publish 5-Slide 'How Many Guests Does 400g (18 Pcs) vs 800g (36 Pcs) Serve?' Host Platter Carousel & PDP Sizing Badge.",
      },
    ],
    changedPlanSectionsSummary: [
      "Offer & Value Architecture: Added explicit Guest Serving-Count Guide (1 Tin / 18 pcs = 6–9 Guests [$32 default] vs 2-Tin Bundle / 36 pcs = 12–16 Guests [$60 + Free 2-Day Air]).",
      "Awareness & Objections: Added Objection #3 ('Is one 400g tin enough for 10–14 dinner guests?') and serving-size myth breaker.",
      "Funnel Stage 2 (Mid-Funnel PDP & Carousel): Integrated visual 18-piece vs 36-piece Guest Platter Guide.",
      "What To Do Today: Updated P1 Carousel & PDP task to launch the Host Serving-Count Guide.",
    ],
    changedTasksSummary: [
      "[Scenario C · P1] Publish 5-Slide '18 Pieces (6–9 Guests) vs 36 Pieces (12–16 Guests)' Host Platter Guide Carousel & PDP Badge",
    ],
    unchangedExplanation:
      "Core positioning, 38% Boz pistachio formulation, $32/$60/$118 prices, default $32 PDP radio selection (respecting Historical Case 4), and the $4,500/mo budget allocation remain untouched.",
    hypotheses: [
      {
        id: "rhyp_demo_scen_c_01",
        hypothesisType: "METRIC_WEIGHT_TO_SERVING_COUNT_AMBIGUITY",
        explanation:
          "VALIDATED HYPOTHESIS: US dinner hosts struggle to convert '400g net weight' into guest servings. Adding explicit piece-per-guest guidance ('1 Tin · 18 pcs = 6–9 Guests [$32]' vs '2 Tins · 36 pcs = 12–16 Guests [$60 + Free 2-Day Air]') while keeping the $32 Single Tin as the default selection resolves checkout hesitation and lifts voluntary 2-Tin Bundle upgrades without the -0.60 pp conversion penalty seen when forcing a $60 default.",
        status: "VALIDATED",
        confidence: 0.91,
        supportingEvidenceIds: [
          "ev_wt_packsize_qa_03",
          "ev_mv_kervan_03",
          "pf_cap_01",
        ],
        contradictingEvidenceIds: [],
      },
      {
        id: "rhyp_demo_scen_c_02",
        hypothesisType: "FORCE_60_DOLLAR_BUNDLE_DEFAULT",
        explanation:
          "REJECTED HYPOTHESIS: Force all PDP visitors into the $60 2-Tin Bundle by default so nobody under-orders. Directly contradicted by Historical Performance Loop Case 4 (perf_case_demo_04), where pre-selecting the $60 bundle reduced unit checkout conversion from 3.50% to 2.90% (-0.60 pp).",
        status: "REJECTED",
        confidence: 0.15,
        supportingEvidenceIds: [],
        contradictingEvidenceIds: ["ev_wt_packsize_qa_03"],
      },
    ],
  },
};

export type DemoDeepReasoningScenario = DemoDeepReasoningScenarioSpec & {
  evidenceIds: string[];
  affectedAuthority: string;
  affectedLaneIds: string[];
  proposalSummary: string;
  expectedImpact: string;
  lineageId: string;
  outcomeId: string;
};

function withDerivedFields(
  spec: DemoDeepReasoningScenarioSpec,
): DemoDeepReasoningScenario {
  return {
    ...spec,
    evidenceIds: spec.supportingEvidenceIds,
    affectedAuthority: spec.affectedAuthorities[0] || "DIFFERENTIATION",
    affectedLaneIds: [spec.relevantLaneId],
    proposalSummary: spec.shortTitle,
    expectedImpact: spec.changedPlanSectionsSummary.join(" · "),
    lineageId: `lineage_demo_${spec.code.toLowerCase()}`,
    outcomeId: `outcome_demo_${spec.code.toLowerCase()}`,
  };
}

/** Ordered list (A, B, C) used by services, routes and read surfaces. */
export const DEMO_DEEP_REASONING_SCENARIOS: DemoDeepReasoningScenario[] = [
  withDerivedFields(DEMO_DEEP_REASONING_SCENARIO_MAP.SCENARIO_A_PRICE),
  withDerivedFields(DEMO_DEEP_REASONING_SCENARIO_MAP.SCENARIO_B_GIFTING),
  withDerivedFields(DEMO_DEEP_REASONING_SCENARIO_MAP.SCENARIO_C_PACKSIZE),
];

// ============================================================================
// 5. COMPOSABLE MULTI-SCENARIO STRATEGY PLAN & EXECUTION TASK BUILDERS
// ============================================================================
/**
 * Builds the complete Strategic Plan JSON by starting from the Baseline Strategy v1
 * and deterministically applying any subset of approved scenarios (`SCENARIO_A_PRICE`,
 * `SCENARIO_B_GIFTING`, `SCENARIO_C_PACKSIZE`) in order without overwriting earlier patches!
 */
export function buildComposedDemoStrategicPlanJson(
  appliedScenarios: DemoScenarioId[],
) {
  const hasA = appliedScenarios.includes("SCENARIO_A_PRICE");
  const hasB = appliedScenarios.includes("SCENARIO_B_GIFTING");
  const hasC = appliedScenarios.includes("SCENARIO_C_PACKSIZE");
  const version = 1 + appliedScenarios.length;

  // Start from a deep clone of baseline v1 (or v2 if only A, then layered with B and C)
  const plan: any = JSON.parse(
    JSON.stringify(buildDemoStrategicPlanJson(hasA ? 2 : 1)),
  );

  plan.version = version;
  plan.planVersion = version;
  plan.appliedScenarios = appliedScenarios;
  if (plan.rootBundle) {
    plan.rootBundle.bundleVersion = version;
  }

  // Compose dynamic headline & rationale reflecting exact applied scenarios
  if (appliedScenarios.length === 0) {
    plan.strategicSummary.headline =
      "Strategy v1 (Baseline): Capture Premium $32 400g Gift Box Demand Through 38% Boz Pistachio Density & Nitrogen-Sealed Crunch Proof";
  } else {
    const labels: string[] = [];
    if (hasA) labels.push("152g Pistachio vs $25 Syrup-Box Proof + 40g Tasting Sleeve (Scenario A)");
    if (hasB) labels.push("Self-Serve Multi-Tin Gift Concierge + $450/mo Gifting Search Shift (Scenario B)");
    if (hasC) labels.push("Explicit 6–9 vs 12–16 Guest Serving-Count Architecture (Scenario C)");
    plan.strategicSummary.headline = `Strategy v${version} (Adapted): ${labels.join(" · ")}`;

    const rationaleParts: string[] = [
      `Active Strategy v${version} composes ${appliedScenarios.length} approved Watchtower & Deep Reasoning adaptation(s) on top of the validated $32 USD 400g Assortment baseline:`,
    ];
    if (hasA) {
      rationaleParts.push(
        "• [Scenario A — Price Counter Applied]: Counters KervanSaray's $25 400g 'Bazaar Value Box' (52% glucose syrup) by leading with '152g Real Boz Pistachio vs 208g Sugar Syrup' scale proof and adding a complimentary 40g Host Preview Tasting Sleeve to the $60 2-Tin Bundle while holding our $32 single-tin price.",
      );
    }
    if (hasB) {
      rationaleParts.push(
        "• [Scenario B — Gifting Demand Applied]: Captures Q4 executive & holiday multi-tin demand by surfacing instant printed gift-note personalization + Free 2-Day Air ($60 2-Tin / $118 4-Tin vs AltınFıstık's $70/$136 5-day ground sets) and reallocating $450/mo within the $4,500/mo budget into High-Intent Gifting Search & Carousel ($1,125/mo).",
      );
    }
    if (hasC) {
      rationaleParts.push(
        "• [Scenario C — Pack-Size Guide Applied]: Resolves 400g guest-count hesitation by adding explicit Serving-Count Guidance above the fold ('1 Tin · 18 pcs = 6–9 Guests [$32 Default]' vs '2-Tin Bundle · 36 pcs = 12–16 Guests [$60 + Free 2-Day Air]').",
      );
    }
    const composedRationale = rationaleParts.join("\n");
    plan.strategicSummary.rationale = composedRationale;
    plan.strategicSummary.executiveSummary = composedRationale;
    if (plan.businessRepresentation?.strategicSummary) {
      plan.businessRepresentation.strategicSummary.strategy = plan.strategicSummary.headline;
      plan.businessRepresentation.strategicSummary.rationale = composedRationale;
    }
  }

  // --------------------------------------------------------------------------
  // LAYER SCENARIO C PATCHES (Offer Serving Guide, Objections, Awareness, Funnel Stage 2)
  // (Works cleanly whether Scenario A is applied or not!)
  // --------------------------------------------------------------------------
  if (hasC) {
    // 1. Add Serving-Count guidance to Offer deliverables & valueStack without removing Scenario A's 40g Tasting Sleeve!
    const servingDeliverable =
      "NEW (Scenario C · Serving-Count Guide): Explicit Portion Architecture on PDP — Single 400g Tin (18 Pieces = Serves 6–9 Guests at $32 Default) vs 2-Tin Host Bundle (800g / 36 Pieces = Serves 12–16 Guests at $60 + Free 2-Day Air)";
    if (!plan.offer.deliverables.includes(servingDeliverable)) {
      plan.offer.deliverables.push(servingDeliverable);
    }
    if (!plan.offer.valueStack.includes(servingDeliverable)) {
      plan.offer.valueStack.push(servingDeliverable);
    }
    plan.offer.servingSizeGuidance = {
      singleTin400g: "18 Pieces (10 Pistachio Baklava, 4 Burma Kadayif, 4 Midye Mussels) — Ideal for 6–9 Dinner Guests (2 pieces/guest) · $32.00 USD (Default PDP Selection)",
      twoTinBundle800g: "36 Pieces (2 × 400g Nitrogen-Sealed Tins) — Ideal for 12–16 Dinner Guests or Holiday Tables · $60.00 USD + Free 2-Day US Air",
      fourTinExecutive1600g: "72 Pieces (4 × 400g Nitrogen-Sealed Tins) — Ideal for 25–35 Office/Event Guests or 4 Client Gifts · $118.00 USD + Free 2-Day US Air",
    };

    // Compose primaryPromise & heroOffer to preserve Scenario A if present
    if (hasA) {
      plan.offer.primaryPromise =
        "152g (38%) verified Boz pistachio core in every $32 400g tin (Serves 6–9 Guests), or $60 2-Tin Host Bundle (36 Pieces · Serves 12–16 Guests) with Free 2-Day Air + Bonus 40g Host Preview Tasting Sleeve.";
      plan.offer.heroOffer =
        "Single 400g Tin (18 Pcs · Serves 6–9 Guests) — $32 USD [Default], or 2-Tin Host Bundle (800g / 36 Pcs · Serves 12–16 Guests) — $60 USD + Free 2-Day Air + Bonus 40g Host Tasting Sleeve";
    } else {
      plan.offer.primaryPromise =
        "$32 Signature 400g Tin (18 Pieces · Serves 6–9 Dinner Guests), or $60 2-Tin Host Bundle (800g / 36 Pieces · Serves 12–16 Guests) with Free 2-Day US Air Shipping.";
      plan.offer.heroOffer =
        "Single 400g Tin (18 Pcs · Serves 6–9 Guests) — $32 USD [Default], or 2-Tin Host Bundle (800g / 36 Pcs · Serves 12–16 Guests) — $60 USD with Free 2-Day Air Shipping";
    }

    // 2. Add Objection #3 (Guest Serving Count)
    plan.offer.structuredObjections.push({
      status: "ADDRESSED",
      label: "Addressed via Guest Serving-Count Guide (Scenario C)",
      underlyingConcern:
        "Is one 400g tin (18 pieces) enough for a 10–14 person dinner gathering, or should I order two tins?",
      resolutionText:
        "One 400g tin contains 18 rich pieces (ideal for 6–9 guests at 2 pieces per person). For 10–16 guests, select the $60 2-Tin Host Bundle (36 pieces + Free 2-Day Air) so every guest enjoys both pistachio baklava and crispy kadayif.",
    });

    // 3. Awareness myth breaker
    plan.awareness.mythBreakers.push({
      myth: "400g sounds small—I can't tell if one tin will look sparse on a 12-person dinner table.",
      reality:
        "Because our pastry is low-syrup and dense with 38% Boz pistachio, 18 pieces (1 tin, $32) generously serves 6–9 guests; for 12–16 guests, our 2-Tin Host Bundle ($60) provides 36 pieces across two sealed tins.",
    });

    // 4. Update Funnel Stage 2 (Mid-Funnel PDP & Carousel) without overwriting Stage 1 or Stage 3
    if (plan.buyerConversionJourneys?.[0]?.stages?.[1]) {
      const stage2 = plan.buyerConversionJourneys[0].stages[1];
      stage2.stageName =
        "Stage 2: 18-Piece (6–9 Guests) vs 36-Piece (12–16 Guests) Serving Guide & Freshness Verification (Carousel & PDP)";
      stage2.coreMessage =
        "Hosting 6–9 guests? One 400g nitrogen-sealed tin (18 pieces, $32) is the ideal centerpiece. Hosting 12–16 guests? Upgrade to the 2-Tin Host Bundle (36 pieces, $60 + Free 2-Day Air).";
      stage2.contentAction =
        "Interactive Guest Serving-Count Platter Guide on PDP (keeping $32 Single Tin as default selection) + 5-slide Instagram Carousel showing 18-piece vs 36-piece table spreads.";
    }
    if (plan.funnel?.stages?.[1]) {
      plan.funnel.stages[1].stage =
        "2. Guest Serving-Count Guide & Nut-Ratio Education (Mid Funnel — Carousel & PDP)";
      plan.funnel.stages[1].objective = hasA
        ? "Interactive 400g Gram-Breakdown (152g Pistachio) + Explicit Guest Serving-Count Guide (1 Tin = 6–9 Guests [$32 Default] vs 2 Tins = 12–16 Guests [$60 + 40g Tasting Sleeve])."
        : "Explicit Guest Serving-Count Guide on PDP & 5-slide Carousel (1 Tin · 18 pcs = 6–9 Guests [$32 Default] vs 2 Tins · 36 pcs = 12–16 Guests [$60 + Free 2-Day Air]).";
    }
  }

  // --------------------------------------------------------------------------
  // LAYER SCENARIO B PATCHES (Lane 2 Gifting Concierge, Funnel Stage 3, Channels & $4,500/mo Budget Reallocation)
  // (Works cleanly alongside Scenario A and/or Scenario C!)
  // --------------------------------------------------------------------------
  if (hasB) {
    // 1. Update Approved Lanes (60% Lane 1 / 40% Lane 2 budget share)
    if (plan.approvedLanes?.[0]) {
      plan.approvedLanes[0].budgetSharePercent = 60;
      plan.approvedLanes[0].commercialRelevance =
        "60% of monthly budget ($32 Single Tin / $60 2-Tin Host Bundle)";
    }
    if (plan.approvedLanes?.[1]) {
      plan.approvedLanes[1].budgetSharePercent = 40;
      plan.approvedLanes[1].commercialRelevance =
        "40% of monthly budget (Expanded +10% in Scenario B for Q4 Executive & Holiday Multi-Tin Surge)";
      plan.approvedLanes[1].positioningAngle =
        "Self-Serve Multi-Tin Gift Concierge: Instant Printed Gift Note Cards & Guaranteed Free 2-Day Air (Saves $10–$18 + 3 Days Transit vs AltınFıstık's $70/$136 5-Day Ground Sets)";
      plan.approvedLanes[1].offerHook =
        "2-Tin Client Duo ($60 USD) & 4-Tin Executive Appreciation Pack ($118 USD) with Instant Self-Serve Gift-Note Entry & Free 2-Day Air Dispatch";
    }

    // 2. Update Lane 2 Buyer Conversion Journey & Funnel Stage 3
    if (plan.buyerConversionJourneys?.[1]) {
      plan.buyerConversionJourneys[1].journeyName =
        "Self-Serve Multi-Tin Concierge → Instant Printed Gift Note Entry → Guaranteed 2-Day Air Dispatch";
      if (plan.buyerConversionJourneys[1].stages?.[0]) {
        plan.buyerConversionJourneys[1].stages[0].stageName =
          "Stage 1: 2-Day Air Nitrogen Tin vs 5-Day Ground Soggy Boxes (Executive Carousel)";
        plan.buyerConversionJourneys[1].stages[0].coreMessage =
          "Don't pay $70–$136 for competitor gift boxes that sit on a 5-day ground truck. Send nitrogen-sealed 400g tins ($60 for 2 / $118 for 4) with Free 2-Day Air and custom gift note cards.";
      }
      if (plan.buyerConversionJourneys[1].stages?.[1]) {
        plan.buyerConversionJourneys[1].stages[1].stageName =
          "Stage 2: Self-Serve Multi-Recipient Gift Note & 2-Tin/4-Tin Concierge Checkout (PDP & Search)";
        plan.buyerConversionJourneys[1].stages[1].coreMessage =
          "Enter personalized recipient gift messages directly on the PDP—dispatched via 2-day air with Batch Roast Cards and allergen disclosures in every tin.";
      }
    }

    if (plan.buyerConversionJourneys?.[0]?.stages?.[2]) {
      const stage3 = plan.buyerConversionJourneys[0].stages[2];
      stage3.stageName =
        "Stage 3: Self-Serve Gift Note Entry & Multi-Tin Bundle Conversion (High-Intent Search & Retargeting — $1,125/mo)";
      stage3.coreMessage = hasA
        ? "Order the $60 2-Tin Host Bundle or $118 4-Tin Executive Pack with instant custom gift-note printing, Free 2-Day Air, and a complimentary 40g Host Preview Tasting Sleeve."
        : "Order the $60 2-Tin Host Bundle or $118 4-Tin Executive Pack with instant self-serve printed gift note cards and guaranteed Free 2-Day US Air delivery.";
    }

    if (plan.funnel?.stages?.[2]) {
      plan.funnel.stages[2].stage =
        "3. Self-Serve Gift Concierge & Multi-Tin Conversion (Bottom of Funnel — Search & Retargeting · 25% Budget / $1,125/mo)";
      plan.funnel.stages[2].objective =
        "Capture surging Q4 corporate & holiday gifting queries via self-serve PDP gift-note entry on $60 2-Tin and $118 4-Tin packs (contrasted against AltınFıstık's $70/$136 5-day ground sets).";
    }

    // 3. Reallocate $450/mo within the exact $4,500/mo Budget Governor
    const budgetRationale =
      "Governed $4,500/month budget rebalanced in Scenario B: shifted $450/mo (+10% share) from broad top-of-funnel video into High-Intent Executive & Holiday Gifting Google Search & Carousel Retargeting ($675/mo → $1,125/mo) to capture high-AOV ($60–$118) multi-tin orders.";

    plan.contentDistribution = {
      rationale: budgetRationale,
      channels: [
        {
          channel: "Instagram Reels & Executive Gift Carousels",
          role: "Primary Discovery, Unboxing & Multi-Tin Gift Concierge Carousels (55% Budget — $2,475/mo)",
          tier: "PRIMARY",
        },
        {
          channel: "TikTok Short-Form Video",
          role: "Sensory ASMR Knife-Cut Crunch & Gram-Ratio Proof (20% Budget — $900/mo)",
          tier: "PRIMARY",
        },
        {
          channel: "Google High-Intent Gifting Search & Multi-Tin Retargeting",
          role: "Expanded Executive & Holiday Multi-Tin Demand Capture (25% Budget — $1,125/mo · +$450/mo Shift)",
          tier: "PRIMARY",
        },
      ],
    };

    plan.channelSelection = {
      primaryChannels: [
        {
          channel: "Instagram Reels & Executive Gift Carousels",
          role: "Primary Discovery & Multi-Tin Gifting Proof (55% Budget — $2,475/mo)",
          rationale:
            "Combines top-of-funnel cross-section Reels with dedicated 2-Tin ($60) and 4-Tin ($118) Executive & Holiday Gift Concierge carousels.",
        },
        {
          channel: "Google High-Intent Gifting Search & Multi-Tin Retargeting",
          role: "Expanded Bottom-of-Funnel Gifting Capture (25% Budget — $1,125/mo · +$450/mo Shift)",
          rationale:
            "Directly captures the +42% surge in corporate & holiday baklava gift box searches and converts PDP visitors comparing our Free 2-Day Air bundles against AltınFıstık's $95 ground threshold.",
        },
        {
          channel: "TikTok Short-Form Video",
          role: "Sensory ASMR Crunch & Nut-to-Syrup Proof (20% Budget — $900/mo)",
          rationale:
            "Maintains efficient top-of-funnel sensory video discovery while funding the +$450/mo high-intent gifting expansion.",
        },
      ],
    };

    plan.budgetGovernor = {
      status: "GOVERNED_ALLOCATION",
      monthlyBudget: 4500,
      totalMonthlyBudget: 4500,
      currency: "USD",
      overallRationale: budgetRationale,
      allocations: [
        {
          channel: "Instagram Reels & Executive Gift Carousels",
          monthlyUsd: 2475,
          sharePercent: 55,
          sharePercentage: 55,
          allocatedAmount: 2475,
          rationale:
            "55% allocation ($2,475/mo; adjusted from $2,700/mo) funding Lane 1 sensory Reels and Lane 2 multi-tin gift carousels.",
        },
        {
          channel: "Google High-Intent Gifting Search & Multi-Tin Retargeting",
          monthlyUsd: 1125,
          sharePercent: 25,
          sharePercentage: 25,
          allocatedAmount: 1125,
          rationale:
            "25% allocation ($1,125/mo; increased +$450/mo from $675/mo) to capture surging Q4 corporate and holiday multi-tin gift demand.",
        },
        {
          channel: "TikTok Short-Form Proof",
          monthlyUsd: 900,
          sharePercent: 20,
          sharePercentage: 20,
          allocatedAmount: 900,
          rationale:
            "20% allocation ($900/mo; adjusted from $1,125/mo) focused strictly on highest-converting macro knife-cut ASMR hooks.",
        },
      ],
      guardrails: [
        "Total monthly spend strictly governed at $4,500.00 USD ($2,475 IG + $1,125 Google/Retargeting + $900 TikTok = $4,500)",
        "Max target CPA: $24.00 USD on single-tin / $32.00 USD on $60–$118 multi-tin executive gift bundles",
        "Honor operational boundary pf_bnd_03: Offer printed custom gift note cards on all orders; never promise custom tin lid embossing under 25 units",
      ],
    };

    if (plan.businessRepresentation?.contentDistribution) {
      plan.businessRepresentation.contentDistribution.rationale = budgetRationale;
    }
  }

  // Add Weekly Action Plan summary to plan JSON for full inspection
  plan.weeklyActionPlan = buildComposedDemoExecutionTasks(appliedScenarios).map(
    (t, idx) => ({
      dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"][idx % 5],
      taskId: t.id,
      title: t.title,
      channel: t.platform,
      priority: t.priority,
      laneTitle: t.laneTitle,
      objective: t.description,
    }),
  );

  return plan;
}

/**
 * Builds the composed What To Do Today & Weekly Action Plan tasks for the active
 * set of applied scenarios (`SCENARIO_A_PRICE`, `SCENARIO_B_GIFTING`, `SCENARIO_C_PACKSIZE`).
 */
export function buildComposedDemoExecutionTasks(
  appliedScenarios: DemoScenarioId[],
) {
  const hasA = appliedScenarios.includes("SCENARIO_A_PRICE");
  const hasB = appliedScenarios.includes("SCENARIO_B_GIFTING");
  const hasC = appliedScenarios.includes("SCENARIO_C_PACKSIZE");

  const tasks: Array<{
    id: string;
    taskId: string;
    title: string;
    description: string;
    channel: string;
    channelRole: string;
    platform: string;
    taskType: string;
    priority: string;
    status: string;
    estimatedMinutes: number;
    laneId: string;
    laneTitle: string;
    whyItMatters: string;
    sourceAuthority: string;
    expectedOutcome?: string;
    productionBlueprint: {
      hook: string;
      scriptOutline: string[];
      guardrails: string[];
    };
  }> = [];

  // TASK SLOT 1: Top-of-Funnel Reel (Baseline v1 or Scenario A Price-Counter Upgrade)
  if (hasA) {
    tasks.push({
      id: "task_demo_scen_a_reel",
      taskId: "task_demo_scen_a_reel",
      title:
        "[Scenario A · Price Counter] Publish 15s '152g Boz Pistachio vs $25 Syrup Box' Scale & Cut-Open Reel + 40g Tasting Sleeve PDP Badge",
      description:
        "Place two 400g portions on a digital kitchen scale to expose the 208g (52%) glucose-syrup weight in $25 promo boxes vs. 152g (38%) whole emerald Boz pistachios in Zeytun's $32 tin, and activate the complimentary 40g 'Host Preview' 2-Piece Tasting Sleeve badge on the $60 2-Tin Bundle PDP.",
      channel: "instagram",
      channelRole: "PRIMARY",
      platform: "Instagram Reels, TikTok & PDP",
      taskType: "CREATIVE_AND_OFFER_UPDATE",
      priority: "P0",
      status: "READY",
      estimatedMinutes: 45,
      laneId: DEMO_IDS.lanes.gifting,
      laneTitle:
        "Lane 1 · Dinner-Host & Cultural Occasion Gifting (400g Signature Tin — $32 USD)",
      whyItMatters:
        "Directly neutralizes KervanSaray Baklava's '$25 for 400g' price anchor by proving 2x real pistachio weight per dollar while adding tangible 2-tin tasting value without cutting our $32 unit price.",
      sourceAuthority: "DIFFERENTIATION",
      productionBlueprint: {
        hook: "Before you buy a '$25 400g baklava box,' put the sugar syrup on a kitchen scale.",
        scriptOutline: [
          "0–3s (Hook): Digital scale close-up + knife slicing through a crisp Zeytun pistachio baklava piece with loud 40-layer crunch audio.",
          "3–9s (Contrast): Show 152g of whole emerald Boz Antep pistachios next to 96g light beet syrup vs 208g thick glucose syrup in $25 promo boxes.",
          "9–15s (Offer CTA): Show Printed Batch Roast Card + $32 Single Tin / $60 2-Tin Host Bundle with Free 2-Day Air + Bonus 40g Host Preview Tasting Sleeve.",
        ],
        guardrails: [
          "Keep Single 400g Tin price at $32.00 USD; never discount single tins.",
          "Strictly state 10-day post-opening ambient crunch window and allergen disclosures (pistachio, wheat, sheep-milk butter).",
        ],
      },
    });
  } else {
    tasks.push({
      id: "task_demo_v1_01",
      taskId: "task_demo_v1_01",
      title:
        "Film & Publish 15s Macro Knife-Cut ASMR Reel (38% Boz Pistachio & 40-Layer Crunch)",
      description:
        "Capture a tight 4:5 macro video slicing through the 18-piece 400g Assortment Tin with live audio of the 40-layer clarified-butter crunch and a close-up of the Printed Batch Roast Card.",
      channel: "instagram",
      channelRole: "PRIMARY",
      platform: "Instagram Reels & TikTok",
      taskType: "CREATIVE_PRODUCTION",
      priority: "P0",
      status: "READY",
      estimatedMinutes: 45,
      laneId: DEMO_IDS.lanes.gifting,
      laneTitle:
        "Lane 1 · Dinner-Host & Cultural Occasion Gifting (400g Signature Tin — $32 USD)",
      whyItMatters:
        "Directly addresses #1 customer pain (soggy, syrup-logged 400g gift boxes) with undeniable visual and auditory proof.",
      sourceAuthority: "DIFFERENTIATION",
      productionBlueprint: {
        hook: "Listen to 40 layers of sheep-milk clarified butter and 38% emerald Boz pistachio—zero pooled sugar syrup.",
        scriptOutline: [
          "0–3s (Hook): Macro knife cut through pistachio baklava & crispy burma kadayif with live directional crunch audio.",
          "3–9s (Mechanism): Peel back the nitrogen-flushed tin seal, lift the honeycomb divider tray, and show the dry bottom of the tin.",
          "9–15s (Offer CTA): Show the Printed Batch Roast Card + $32 Single 400g Tin / $60 2-Tin Host Bundle with Free 2-Day US Air.",
        ],
        guardrails: [
          "Strictly state 10-day post-opening ambient crunch window.",
          "Include tree-nut (pistachio), wheat gluten, and sheep-milk dairy disclosure.",
        ],
      },
    });
  }

  // TASK SLOT 2: Mid-Funnel PDP & Carousel (Baseline v1 or Scenario C Pack-Size & Serving Guide Upgrade)
  if (hasC) {
    tasks.push({
      id: "task_demo_scen_c_packsize",
      taskId: "task_demo_scen_c_packsize",
      title:
        "[Scenario C · Pack-Size Guide] Deploy '18 Pieces (6–9 Guests) vs 36 Pieces (12–16 Guests)' PDP Serving Guide & 5-Slide Host Carousel",
      description:
        "Add the Guest Serving-Count Platter Guide above the fold on the 400g Assortment PDP ('1 Tin · 18 Pcs = Serves 6–9 Guests [$32 Default]' vs '2-Tin Host Bundle · 36 Pcs = Serves 12–16 Guests [$60 + Free 2-Day Air]') and publish a matching 5-slide Instagram Carousel.",
      channel: "website_and_instagram",
      channelRole: "PRIMARY",
      platform: "PDP & Instagram Carousel",
      taskType: "CONVERSION_OPTIMIZATION",
      priority: "P0",
      status: "READY",
      estimatedMinutes: 35,
      laneId: DEMO_IDS.lanes.gifting,
      laneTitle:
        "Lane 1 · Dinner-Host & Cultural Occasion Gifting (400g Signature Tin — $32 USD)",
      whyItMatters:
        "Eliminates pre-purchase portion anxiety for dinner hosts welcoming 10–16 guests and drives natural upgrades to the $60 2-Tin Bundle without forcing a $60 default radio selection.",
      sourceAuthority: "OFFER",
      productionBlueprint: {
        hook: "Hosting dinner this weekend? Here is exactly how many guests 1 Tin (400g) vs 2 Tins (800g) serves.",
        scriptOutline: [
          "Slide 1 / PDP Badge: Visual platter comparison — 1 Tin (400g / 18 Pieces) = 6–9 Dinner Guests ($32 USD Default) vs 2-Tin Host Bundle (800g / 36 Pieces) = 12–16 Guests ($60 USD + Free 2-Day Air).",
          "Slide 2 / Piece Map: Breakdown per tin — 10 Boz Pistachio Baklava + 4 Crispy Burma Kadayif + 4 Midye Mussels.",
          "Slide 3 / Freshness Advantage: Two separately nitrogen-sealed 400g tins let you open one tin tonight and keep the second sealed fresh for 45 days.",
        ],
        guardrails: [
          "Keep $32 Single 400g Tin as the default PDP radio button (honoring Historical Performance Loop Case 4).",
        ],
      },
    });
  } else {
    tasks.push({
      id: "task_demo_v1_02",
      taskId: "task_demo_v1_02",
      title:
        "Deploy 5-Slide 'Inside the 400g Nitrogen Gift Tin' Carousel for Dinner Hosts",
      description:
        "Publish a 5-slide Instagram Carousel showing: (1) Lacquered steel gift tin, (2) 18-piece assortment map, (3) 38% Boz pistachio vs 24% syrup ratio, (4) Honeycomb transit protection, (5) 2-day air delivery.",
      channel: "website_and_instagram",
      channelRole: "PRIMARY",
      platform: "PDP & Instagram Carousel",
      taskType: "CONVERSION_OPTIMIZATION",
      priority: "P1",
      status: "READY",
      estimatedMinutes: 30,
      laneId: DEMO_IDS.lanes.gifting,
      laneTitle:
        "Lane 1 · Dinner-Host & Cultural Occasion Gifting (400g Signature Tin — $32 USD)",
      whyItMatters:
        "Converts mid-funnel gift shoppers who need reassurance on packaging presentation and transit safety.",
      sourceAuthority: "FUNNEL",
      productionBlueprint: {
        hook: "What makes a $32 400g baklava tin worthy of the center of the dinner table?",
        scriptOutline: [
          "Slide 1 / Hero Module: Side-by-side 400g Gram Breakdown (152g Boz Pistachio · 152g Clarified-Butter Phyllo & Kadayif · 96g Light Beet Syrup).",
          "Slide 2 / Bundle Module: $32 Single 400g Tin vs $60 2-Tin Host Bundle (+ Free 2-Day Air).",
          "Slide 3 / Trust Card: Printed Batch Roast Card + Intact-Arrival Replacement Assurance.",
        ],
        guardrails: [
          "Maintain $32.00 USD single-tin price and clear 10-day post-opening freshness disclosure.",
        ],
      },
    });
  }

  // TASK SLOT 3: Executive & Holiday Multi-Tin Gifting (Baseline v1 or Scenario B Gifting Concierge & $450/mo Budget Reallocation)
  if (hasB) {
    tasks.push({
      id: "task_demo_scen_b_gifting",
      taskId: "task_demo_scen_b_gifting",
      title:
        "[Scenario B · Gifting Demand] Launch Self-Serve Multi-Tin Gift-Note PDP Module & Shift $450/mo to Executive/Holiday Gifting Search ($1,125/mo)",
      description:
        "Surface instant self-serve printed gift-note entry on the PDP for $60 2-Tin Duos and $118 4-Tin Executive Packs (contrasting Free 2-Day Air vs. AltınFıstık's $70/$136 5-day ground sets) and reallocate $450/mo from top-of-funnel video into Google High-Intent Gifting Search & Carousel ($675/mo → $1,125/mo within the $4,500/mo budget).",
      channel: "google_search",
      channelRole: "PRIMARY",
      platform: "Google Search, Meta Carousel & PDP",
      taskType: "PAID_ACQUISITION_AND_FUNNEL",
      priority: "P0",
      status: "READY",
      estimatedMinutes: 35,
      laneId: DEMO_IDS.lanes.hosting,
      laneTitle:
        "Lane 2 · Boutique Executive & Client Appreciation Gifting (Multi-Tin Bundles)",
      whyItMatters:
        "Captures the +42% surge in Q4 corporate and holiday gifting demand with a $10–$18 price advantage and 3-day faster air delivery than AltınFıstık Confections.",
      sourceAuthority: "BUDGET_GOVERNOR",
      productionBlueprint: {
        hook: "Send 2-Tin ($60) or 4-Tin ($118) Nitrogen-Sealed Pistachio Baklava Gift Sets with Custom Printed Gift Notes & Free 2-Day Air.",
        scriptOutline: [
          "PDP Module: Enable instant self-serve gift-note message box on 2-Tin ($60) and 4-Tin ($118) bundles above the fold.",
          "Search & Carousel Copy: 'Zeytun Atelier Multi-Tin Gift Concierge — $60 (2 Tins) / $118 (4 Tins) + Free 2-Day US Air & Printed Batch Roast Card (Compare vs $70–$136 5-Day Ground Boxes).'",
          "Budget Rebalance: Adjust monthly caps to IG $2,475/mo (55%) · Google Search & Gifting Retargeting $1,125/mo (25%) · TikTok $900/mo (20%) = $4,500/mo total.",
        ],
        guardrails: [
          "Reconcile total monthly budget strictly to $4,500.00 USD.",
          "Offer printed paper gift note cards on all orders; never promise custom embossed tin lids under 25 units (pf_bnd_03).",
        ],
      },
    });
  } else {
    tasks.push({
      id: "task_demo_v1_03",
      taskId: "task_demo_v1_03",
      title:
        "Run Executive 4-Tin Appreciation Pack ($118 USD) Retargeting & Search Capture",
      description:
        "Maintain $675/mo (15% budget) on high-intent search ('pistachio baklava gift tin US delivery') and executive gifting retargeting highlighting 2-day air dispatch and custom gift note cards.",
      channel: "google_search",
      channelRole: "SECONDARY",
      platform: "Google Search & Meta Retargeting",
      taskType: "PAID_ACQUISITION",
      priority: "P1",
      status: "READY",
      estimatedMinutes: 25,
      laneId: DEMO_IDS.lanes.hosting,
      laneTitle:
        "Lane 2 · Boutique Executive & Client Appreciation Gifting (Multi-Tin Bundles)",
      whyItMatters:
        "Captures bottom-of-funnel gift buyers with high AOV ($60–$118) while respecting the $24.00 max target CPA guardrail.",
      sourceAuthority: "CHANNEL_SELECTION",
      productionBlueprint: {
        hook: "Nitrogen-Sealed 400g Antep Pistachio Baklava Gift Tins — Dispatched via 2-Day US Air.",
        scriptOutline: [
          "Headline 1: Zeytun Atelier 400g Gift Tin ($32) — 38% Boz Antep Pistachio",
          "Headline 2: 2-Tin Host Bundle ($60) + Free 2-Day US Air Delivery",
          "Description: 18 hand-layered baklava & kadayif pieces in a reusable lacquered tin with Batch Roast Card. Zero glucose syrup.",
        ],
        guardrails: [
          "Cap daily search + retargeting spend at $22.50/day ($675/month governed allocation).",
        ],
      },
    });
  }

  // --------------------------------------------------------------------------
  // ALWAYS-ON DAILY TASKS (identical in every strategy version: scenario patches
  // never touch these, so unrelated plan sections remain unchanged).
  // --------------------------------------------------------------------------
  const gifting = {
    laneId: DEMO_IDS.lanes.gifting,
    laneTitle:
      "Lane 1 · Dinner-Host & Cultural Occasion Gifting (400g Signature Tin — $32 USD)",
  };
  const hosting = {
    laneId: DEMO_IDS.lanes.hosting,
    laneTitle:
      "Lane 2 · Boutique Executive & Client Appreciation Gifting (Multi-Tin Bundles)",
  };

  tasks.push(
    {
      id: "task_demo_always_replies",
      taskId: "task_demo_always_replies",
      title: "Reply to 10 open Instagram comments & DMs about serving size and delivery dates",
      description:
        "Answer every open comment and DM from the last 48 hours. For delivery questions, quote the 2-Day US Air promise and cutoff; for serving questions, answer from the piece count (18 pieces per 400g tin).",
      channel: "INSTAGRAM",
      channelRole: "SUPPORTING",
      platform: "Instagram Comments & DMs",
      taskType: "FOLLOW_UP",
      priority: "MUST_DO",
      status: "ACTIVE",
      estimatedMinutes: 20,
      ...gifting,
      whyItMatters:
        "Open purchase questions are the cheapest conversions available today, and the same questions are what Watchtower is flagging as repeated buyer hesitation.",
      sourceAuthority: "FUNNEL",
      expectedOutcome: "Zero unanswered purchase questions older than 24 hours.",
      productionBlueprint: {
        hook: "Fast, specific answers from the atelier — no scripts.",
        scriptOutline: [
          "Sort comments and DMs by oldest first and tag every serving-size or delivery question.",
          "Answer with exact numbers: 18 pieces per tin, $32 / $60 / $118 pricing, Free 2-Day US Air on 2-tin and 4-tin packs.",
          "Log any new repeated question in the notes for the next Watchtower review.",
        ],
        guardrails: [
          "Never promise custom embossed tin lids under 25 units (pf_bnd_03).",
          "State the 10-day post-opening crunch window when asked about freshness.",
        ],
      },
    },
    {
      id: "task_demo_always_tiktok",
      taskId: "task_demo_always_tiktok",
      title: "Cross-post the knife-cut crunch clip to TikTok with a 'listen to the crunch' caption",
      description:
        "Re-export the 15-second macro knife-cut clip without the Instagram watermark and publish it natively on TikTok with the crunch audio intact and the $32 / $60 pricing in the pinned comment.",
      channel: "TIKTOK",
      channelRole: "SUPPORTING",
      platform: "TikTok Short-Form Video",
      taskType: "DISTRIBUTION",
      priority: "SHOULD_DO",
      status: "PLANNED",
      estimatedMinutes: 15,
      ...gifting,
      whyItMatters:
        "The sensory knife-cut format was the strongest historical result (thumbstop 23% → 34%, simulated) and TikTok carries 20–25% of the governed budget.",
      sourceAuthority: "CHANNEL_SELECTION",
      expectedOutcome: "Reuse a proven asset on a second channel for about 15 minutes of effort.",
      productionBlueprint: {
        hook: "Turn the sound on. This is what 40 layers of clarified butter sound like.",
        scriptOutline: [
          "Export the 4:5 macro clip at 9:16 with the crunch audio unmuted.",
          "Caption: 'Listen to the crunch — 38% Boz pistachio, zero pooled syrup.'",
          "Pin a comment with the $32 single tin and $60 2-tin bundle (Free 2-Day Air).",
        ],
        guardrails: [
          "Keep allergen disclosure (pistachio, wheat, sheep-milk dairy) in the caption.",
        ],
      },
    },
    {
      id: "task_demo_always_stories",
      taskId: "task_demo_always_stories",
      title: "Publish 3 Instagram Stories: batch-roast morning, 152g pistachio weigh-in, gift-note card close-up",
      description:
        "Film three short Stories in the atelier: the stone-bake pull for today's batch, the 152g pistachio weigh-in on a digital scale, and a printed gift-note card tucked into a tin.",
      channel: "INSTAGRAM",
      channelRole: "SUPPORTING",
      platform: "Instagram Stories",
      taskType: "CONTENT",
      priority: "SHOULD_DO",
      status: "PLANNED",
      estimatedMinutes: 20,
      ...gifting,
      whyItMatters:
        "Behind-the-scenes proof keeps the 38% pistachio claim visible between larger posts and supports the gifting story without a new capability.",
      sourceAuthority: "DIFFERENTIATION",
      expectedOutcome: "Three proof-led Stories live before noon.",
      productionBlueprint: {
        hook: "Today's batch, straight out of the stone oven.",
        scriptOutline: [
          "Story 1: stone-bake pull with the batch number on the Printed Batch Roast Card.",
          "Story 2: weigh 152g of whole Boz pistachios on the scale.",
          "Story 3: close-up of a printed gift-note card being placed in a tin.",
        ],
        guardrails: [
          "Use only the verified 152g / 38% pistachio figure.",
        ],
      },
    },
    {
      id: "task_demo_always_paid_review",
      taskId: "task_demo_always_paid_review",
      title: "Review yesterday's paid results against the $34 CPA guardrail and keep broad-interest audiences paused",
      description:
        "Check yesterday's Meta prospecting and Google Search spend. Confirm CPA is under the $34 guardrail and that no broad 'Mediterranean diet & culinary travel' interest audience has been re-enabled.",
      channel: "WEBSITE",
      channelRole: "SUPPORTING",
      platform: "Meta Ads Manager & Google Ads",
      taskType: "MEASUREMENT",
      priority: "SHOULD_DO",
      status: "PLANNED",
      estimatedMinutes: 15,
      ...hosting,
      whyItMatters:
        "A past broad-interest test raised CPA from $22 to $40 (simulated Performance Loop case 3). A 15-minute daily check prevents repeating it.",
      sourceAuthority: "BUDGET_GOVERNOR",
      expectedOutcome: "CPA confirmed at or below $34 and the monthly budget still on pace for $4,500.",
      productionBlueprint: {
        hook: "Protect the budget before spending it.",
        scriptOutline: [
          "Open Meta prospecting: confirm only dinner-hosting, cultural-holiday and executive-gifting audiences are active.",
          "Compare yesterday's CPA with the $34 guardrail; pause any ad set above it for two days.",
          "Check month-to-date spend against the $4,500 governed budget.",
        ],
        guardrails: [
          "Never exceed the governed $4,500 monthly total.",
        ],
      },
    },
    {
      id: "task_demo_always_ugc",
      taskId: "task_demo_always_ugc",
      title: "Repost 2 customer unboxing clips and ask recent recipients for a review photo",
      description:
        "Pick two customer unboxing clips from the tagged posts, request permission to repost, and message last week's recipients asking for a photo of the open tin.",
      channel: "INSTAGRAM",
      channelRole: "TESTING",
      platform: "Instagram Reposts & DMs",
      taskType: "CONTENT",
      priority: "OPTIONAL",
      status: "PLANNED",
      estimatedMinutes: 15,
      ...gifting,
      whyItMatters:
        "Customers keep praising the visible green pistachio core and the crunch, which is social proof the atelier did not have to produce.",
      sourceAuthority: "DIFFERENTIATION",
      expectedOutcome: "Two reposts and at least one new review photo requested.",
      productionBlueprint: {
        hook: "Let the customers show the crunch.",
        scriptOutline: [
          "Shortlist two tagged unboxing clips that show the cross-section.",
          "Ask for repost permission in a direct message before posting.",
          "Ask last week's recipients for a photo of the open tin.",
        ],
        guardrails: [
          "Only repost with the customer's written permission.",
        ],
      },
    },
    {
      id: "task_demo_always_packstation",
      taskId: "task_demo_always_packstation",
      title: "Pack-station check: honeycomb divider, dry-pack sachet and batch card in every tin before 2-Day Air dispatch",
      description:
        "Before the afternoon courier pickup, open one tin from the day's pack run and confirm the honeycomb divider, dry-pack sachet and Printed Batch Roast Card are present and the nitrogen seal is intact.",
      channel: "OTHER",
      channelRole: "SUPPORTING",
      platform: "Atelier Pack Station",
      taskType: "PROOF_ASSET",
      priority: "MUST_DO",
      status: "DONE",
      estimatedMinutes: 10,
      ...gifting,
      whyItMatters:
        "A competitor is collecting repeated complaints about limp kadayif after five days on a ground truck. Intact arrival is the proof that separates a 2-Day Air tin from that.",
      sourceAuthority: "PROOF",
      expectedOutcome: "Every tin leaves with the transit-protection proof in place.",
      productionBlueprint: {
        hook: "Intact arrival is the product.",
        scriptOutline: [
          "Open one tin from the day's run and check the divider, sachet and batch card.",
          "Confirm the nitrogen seal is unbroken.",
          "Record the batch number against the courier pickup.",
        ],
        guardrails: [
          "Do not claim preservative-free freshness beyond the 10-day post-opening window.",
        ],
      },
    },
  );

  // Normalize to the real What-To-Do-Today contract so every section of the page fills:
  //  - priority: MUST_DO / SHOULD_DO / OPTIONAL
  //  - status: PLANNED / ACTIVE / DONE
  //  - channel: uppercase channel names (matches the channel ecosystem panel)
  //  - exactly one PRIMARY channel task (the anchor Reel)
  const PRIORITY_MAP: Record<string, string> = {
    P0: "MUST_DO",
    P1: "SHOULD_DO",
    P2: "OPTIONAL",
  };
  const CHANNEL_MAP: Record<string, string> = {
    instagram: "INSTAGRAM",
    website_and_instagram: "WEBSITE",
    google_search: "GOOGLE_SEARCH",
  };
  return tasks.map((t, idx) => ({
    ...t,
    priority: PRIORITY_MAP[t.priority] || t.priority,
    status: t.status === "READY" ? "PLANNED" : t.status,
    channel: CHANNEL_MAP[t.channel] || t.channel,
    channelRole: idx === 0 ? "PRIMARY" : t.channelRole === "PRIMARY" || t.channelRole === "SECONDARY" ? "SUPPORTING" : t.channelRole,
  }));
}
