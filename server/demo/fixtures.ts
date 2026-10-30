/**
 * AVYRON DEMO ENVIRONMENT — Coherent Synthetic Business Fixtures
 *
 * Fictional Brand: Zeytun Atelier
 * Hero Offering:   Antep Pistachio Baklava & Kadayif Assortment Box (400g)
 * Market & Price:  United States · $32 USD (400g / 18 pieces) · $4,500 USD/mo budget
 *
 * All competitors, reviews, social posts, and telemetry in this file are
 * 100% synthetic and clearly attributed to internal demo evidence endpoints.
 */

import {
  DEMO_ACCOUNT_ID,
  DEMO_BRAND_NAME,
  DEMO_CAMPAIGN_ID,
  DEMO_OFFERING_NAME,
  DEMO_WEBSITE_URL,
} from "./config";

export const DEMO_IDS = {
  websiteSnapshotId: "wsnap_demo_zeytun_001",
  offeringId: "off_demo_zeytun_400g",
  buSnapshotId: "busnap_demo_zeytun_001",
  userProfileId: "uprof_demo_zeytun_001",
  miSnapshotId: "misnap_demo_zeytun_001",
  miFetchJobId: "mifetch_demo_zeytun_001",
  audienceSnapshotId: "audsnap_demo_zeytun_001",
  positioningSnapshotId: "possnap_demo_zeytun_001",
  differentiationSnapshotIdV1: "diffsnap_demo_zeytun_v1",
  differentiationSnapshotIdV2: "diffsnap_demo_zeytun_v2",
  mechanismSnapshotId: "mechsnap_demo_zeytun_001",
  orchJobIdV1: "orch_demo_zeytun_v1",
  orchJobIdV2: "orch_demo_zeytun_v2",
  strategyRootIdV1: "sroot_demo_zeytun_v1",
  strategyRootIdV2: "sroot_demo_zeytun_v2",
  rootBundleIdV1: "rbundle_demo_zeytun_v1",
  rootBundleIdV2: "rbundle_demo_zeytun_v2",
  strategicPlanIdV1: "splan_demo_zeytun_v1",
  strategicPlanIdV2: "splan_demo_zeytun_v2",
  watchtowerEventId: "pce_demo_kervansaray_pricing_001",
  watchtowerBriefId: "wsb_demo_kervansaray_001",
  reasoningCaseId: "rcase_demo_kervansaray_001",
  adaptiveDecisionId: "adec_demo_kervansaray_001",
  proposalId: "prop_demo_kervansaray_v2",
  lineageId: "lin_demo_zeytun_v1_v2",
  outcomeId: "out_demo_zeytun_v1_v2",
  perfContextIdV1: "pctx_demo_zeytun_v1",
  perfContextIdV2: "pctx_demo_zeytun_v2",
  execDayIdV1: "eday_demo_zeytun_v1",
  execDayIdV2: "eday_demo_zeytun_v2",
  monthlyReportId: "mrep_demo_zeytun_2026_10",
  competitors: {
    kervansaray: "comp_demo_kervansaray",
    altinfistik: "comp_demo_altinfistik",
    serbetcihan: "comp_demo_serbetcihan",
  },
  lanes: {
    gifting: "lane_demo_gifting",
    hosting: "lane_demo_hosting",
  },
};

export interface DemoEvidenceRecord {
  id: string;
  domainSlug: string;
  competitorId?: string;
  competitorName: string;
  sourceType: "CUSTOMER_REVIEW" | "COMPETITOR_CATALOG" | "SOCIAL_POST" | "WATCHTOWER_DIFF";
  platform: string;
  sentiment: "POSITIVE" | "NEGATIVE" | "MIXED" | "OBSERVATION";
  publishedAt: string;
  title: string;
  verbatimText: string;
  productReferenced: string;
  packSizeAndPrice: string;
  strategicTakeaway: string;
  linkedPains: string[];
}

export const DEMO_EVIDENCE_RECORDS: DemoEvidenceRecord[] = [
  {
    id: "ev_mv_kervan_01",
    domainSlug: "kervansaray-baklava.demo.invalid",
    competitorId: DEMO_IDS.competitors.kervansaray,
    competitorName: "KervanSaray Baklava",
    sourceType: "CUSTOMER_REVIEW",
    platform: "trustpilot",
    sentiment: "NEGATIVE",
    publishedAt: "2026-10-02",
    title: "400g tin felt heavy because of pooled sugar syrup at the bottom",
    verbatimText:
      "Ordered the 400g Assortment Tin from KervanSaray Baklava for a dinner host gift. The tin weighed 400g on the scale, but almost half the weight was thick glucose syrup pooling at the bottom. The pistachio layer was a thin dusting and the bottom pastry sheets were soggy.",
    productReferenced: "KervanSaray 400g Classic Baklava Tin",
    packSizeAndPrice: "400g · $32 USD (later discounted to $25 USD in Bazaar promo)",
    strategicTakeaway:
      "Validates core buyer pain: customers resent paying premium 400g gift prices when weight is inflated by heavy syrup rather than whole Antep pistachios.",
    linkedPains: ["pain_demo_syrup_soggy"],
  },
  {
    id: "ev_mv_kervan_02",
    domainSlug: "kervansaray-baklava.demo.invalid",
    competitorId: DEMO_IDS.competitors.kervansaray,
    competitorName: "KervanSaray Baklava",
    sourceType: "CUSTOMER_REVIEW",
    platform: "reddit",
    sentiment: "MIXED",
    publishedAt: "2026-10-04",
    title: "Fast New York delivery from KervanSaray Baklava, but too sweet after two pieces",
    verbatimText:
      "KervanSaray Baklava delivered in 2 days to Manhattan and the metal box looked respectable, so logistics were fine. However, their new $25 400g Bazaar Value box swaps half the pistachio pieces for walnut/peanut rolls and uses a very heavy corn-syrup glaze that masks the butter flavor.",
    productReferenced: "KervanSaray 400g Bazaar Value Gift Box",
    packSizeAndPrice: "400g · $25 USD promotional tier",
    strategicTakeaway:
      "Exposes the exact trade-off behind KervanSaray's $25 promo box: lower nut purity and heavier syrup ratio.",
    linkedPains: ["pain_demo_syrup_soggy", "pain_demo_gift_presentation"],
  },
  {
    id: "ev_mv_kervan_03",
    domainSlug: "kervansaray-baklava.demo.invalid",
    competitorId: DEMO_IDS.competitors.kervansaray,
    competitorName: "KervanSaray Baklava",
    sourceType: "CUSTOMER_REVIEW",
    platform: "google_reviews",
    sentiment: "POSITIVE",
    publishedAt: "2026-09-28",
    title: "Convenient 400g gift size for office thank-you gifts",
    verbatimText:
      "We buy 400g tins from KervanSaray Baklava for client thank-you gifts because the 16-to-18 piece format is the right size for a small team or family table without spending $70 on a 1kg catering tray.",
    productReferenced: "KervanSaray 400g Gift Tin",
    packSizeAndPrice: "400g · $32 USD",
    strategicTakeaway:
      "Confirms high demand for the 400g (~18 piece) gift format as the sweet spot for executive and dinner-host gifting under $35.",
    linkedPains: ["pain_demo_gift_presentation"],
  },
  {
    id: "ev_mv_altin_01",
    domainSlug: "altinfistik-confections.demo.invalid",
    competitorId: DEMO_IDS.competitors.altinfistik,
    competitorName: "AltınFıstık Confections",
    sourceType: "CUSTOMER_REVIEW",
    platform: "trustpilot",
    sentiment: "NEGATIVE",
    publishedAt: "2026-10-01",
    title: "5-day ground shipping turned AltınFıstık Confections kadayif soft and sticky",
    verbatimText:
      "Paid $36 for the 400g Royal Assortment from AltınFıstık Confections. It shipped via 5-day economy ground without an internal divider tray. By the time it arrived, the shredded kadayif pieces had absorbed moisture, lost all crunch, and syrup had leaked onto the gold ribbon.",
    productReferenced: "AltınFıstık 400g Royal Pistachio Assortment",
    packSizeAndPrice: "400g · $36 USD",
    strategicTakeaway:
      "Supports our nitrogen-flushed tin + internal honeycomb divider + 2-day air transit requirement for crisp kadayif and phyllo.",
    linkedPains: ["pain_demo_transit_crushing", "pain_demo_syrup_soggy"],
  },
  {
    id: "ev_mv_altin_02",
    domainSlug: "altinfistik-confections.demo.invalid",
    competitorId: DEMO_IDS.competitors.altinfistik,
    competitorName: "AltınFıstık Confections",
    sourceType: "CUSTOMER_REVIEW",
    platform: "instagram_comments",
    sentiment: "POSITIVE",
    publishedAt: "2026-09-29",
    title: "Beautiful gold foil box from AltınFıstık Confections for Eid and holiday gifting",
    verbatimText:
      "The embossed gold box from AltınFıstık Confections looks luxurious on a coffee table when hosting guests. People definitely judge a $35+ sweet box by the unboxing presentation.",
    productReferenced: "AltınFıstık 400g Royal Gift Box",
    packSizeAndPrice: "400g · $36 USD",
    strategicTakeaway:
      "Reinforces that presentation and unboxing ritual are decisive purchase drivers for the $30–$38 gifting segment.",
    linkedPains: ["pain_demo_gift_presentation"],
  },
  {
    id: "ev_mv_altin_03",
    domainSlug: "altinfistik-confections.demo.invalid",
    competitorId: DEMO_IDS.competitors.altinfistik,
    competitorName: "AltınFıstık Confections",
    sourceType: "CUSTOMER_REVIEW",
    platform: "reddit",
    sentiment: "MIXED",
    publishedAt: "2026-10-03",
    title: "No ingredient ratio or bake date listed on AltınFıstık Confections box",
    verbatimText:
      "AltınFıstık Confections claims 'premium artisan baklava' at $36 for 400g, but the label doesn't state the pistachio percentage or when the batch was baked, and it lists 'butter flavor oil' alongside ghee.",
    productReferenced: "AltınFıstık 400g Royal Pistachio Assortment",
    packSizeAndPrice: "400g · $36 USD",
    strategicTakeaway:
      "Validates our printed batch roast card disclosing 38% Boz pistachio weight and 100% sheep-milk clarified butter.",
    linkedPains: ["pain_demo_gift_presentation"],
  },
  {
    id: "ev_mv_serbet_01",
    domainSlug: "serbetcihan-gifting.demo.invalid",
    competitorId: DEMO_IDS.competitors.serbetcihan,
    competitorName: "Şerbetçi Han Gifting",
    sourceType: "CUSTOMER_REVIEW",
    platform: "trustpilot",
    sentiment: "MIXED",
    publishedAt: "2026-09-26",
    title: "Authentic Istanbul flavor from Şerbetçi Han Gifting, but $18 shipping + customs delay",
    verbatimText:
      "Şerbetçi Han Gifting makes authentic pistachio sarma and kadayif in their 420g tin ($29), but adding $18 international express shipping brings it to $47 and ours sat in customs for 4 days, causing slight sugar crystallization.",
    productReferenced: "Şerbetçi Han 420g Heritage Bazaar Tin",
    packSizeAndPrice: "420g · $29 USD + $18 int'l shipping",
    strategicTakeaway:
      "Shows why domestic US atelier dispatch ($32 USD with 2-day air fulfillment) beats cross-border imports on landed cost and freshness.",
    linkedPains: ["pain_demo_transit_crushing"],
  },
  {
    id: "ev_mv_serbet_02",
    domainSlug: "serbetcihan-gifting.demo.invalid",
    competitorId: DEMO_IDS.competitors.serbetcihan,
    competitorName: "Şerbetçi Han Gifting",
    sourceType: "CUSTOMER_REVIEW",
    platform: "tiktok_comments",
    sentiment: "POSITIVE",
    publishedAt: "2026-09-30",
    title: "Cross-section ASMR cut-open videos make pistachio density immediately obvious",
    verbatimText:
      "Watching Şerbetçi Han Gifting slice a piece in half on camera so you can see the bright green Boz pistachio core and hear the dry phyllo crunch is what convinced me to buy.",
    productReferenced: "Şerbetçi Han 420g Heritage Bazaar Tin",
    packSizeAndPrice: "420g · $29 USD",
    strategicTakeaway:
      "Proves that macro cross-section cut-open video + audible crunch is the highest-converting creative proof format in this category.",
    linkedPains: ["pain_demo_syrup_soggy", "pain_demo_gift_presentation"],
  },
  {
    id: "ev_wt_kervan_diff_01",
    domainSlug: "kervansaray-baklava.demo.invalid",
    competitorId: DEMO_IDS.competitors.kervansaray,
    competitorName: "KervanSaray Baklava",
    sourceType: "WATCHTOWER_DIFF",
    platform: "website_diff",
    sentiment: "OBSERVATION",
    publishedAt: "2026-10-14",
    title: "Watchtower Snapshot Diff: KervanSaray launches $25 400g 'Bazaar Value Gift Box' (-22%)",
    verbatimText:
      "BEFORE (Snapshot 2026-10-01): '400g Classic Antep Pistachio & Walnut Gift Tin — $32.00 USD. 18 pieces, 30% pistachio content, free US shipping over $75.'\nAFTER (Snapshot 2026-10-14): 'NEW: 400g Bazaar Value Assortment Gift Box — $25.00 USD (Save 22% vs $32 Boutique Tins). 18 pieces in paperboard box, traditional rich syrup infusion (52% syrup weight), blended pistachio, walnut & roasted peanut filling.'",
    productReferenced: "KervanSaray 400g Bazaar Value Gift Box",
    packSizeAndPrice: "400g · $25 USD (down from $32 USD)",
    strategicTakeaway:
      "Direct price-anchoring threat on the 400g keyword/format, achieved by cutting pistachio weight in half (to ~19% nut weight / 52% syrup weight).",
    linkedPains: ["pain_demo_syrup_soggy", "pain_demo_gift_presentation"],
  },
];

export function buildDemoEvidenceUrl(domainSlug: string, evidenceId: string): string {
  return `/api/demo/evidence/${domainSlug}/${evidenceId}`;
}

export const DEMO_PRODUCT_FACTS = [
  {
    factId: "pf_cap_01",
    factType: "CAPABILITY",
    statement:
      "400g net weight (18 hand-layered pieces: 10 Boz pistachio baklava, 4 burma kadayif rolls, 4 midye pistachio mussels) with 38% early-harvest Boz Antep pistachio content by weight (152g pure pistachio per tin).",
    status: "USER_CONFIRMED",
    confidence: 0.98,
    evidenceRefIds: ["ev_web_zeytun_01"],
  },
  {
    factId: "pf_cap_02",
    factType: "CAPABILITY",
    statement:
      "Micro-Brix low-syrup infusion (24% natural beet-sugar syrup ratio vs 45–55% mass-market glucose syrup) baked with 100% clarified sheep-milk butter (sade yağ) for an audible 40-layer phyllo crunch.",
    status: "USER_CONFIRMED",
    confidence: 0.97,
    evidenceRefIds: ["ev_web_zeytun_01"],
  },
  {
    factId: "pf_cap_03",
    factType: "CAPABILITY",
    statement:
      "Nitrogen-flushed reusable lacquered steel gift tin with custom honeycomb piece dividers and a printed batch roast card listing oven date, harvest lot, and exact nut-to-syrup gram breakdown.",
    status: "WEBSITE_ESTABLISHED",
    confidence: 0.95,
    evidenceRefIds: ["ev_web_zeytun_02"],
  },
  {
    factId: "pf_use_01",
    factType: "USE_CASE",
    statement:
      "Dinner-host gifting, client appreciation gifts, cultural holiday tables, and executive tea/coffee pairing where recipients share 18 portioned artisan pieces ($32 USD per 400g tin).",
    status: "USER_CONFIRMED",
    confidence: 0.95,
    evidenceRefIds: ["ev_web_zeytun_01"],
  },
  {
    factId: "pf_bnd_01",
    factType: "BOUNDARY",
    statement:
      "Zero preservatives or artificial humectants: ambient shelf life is strictly 10 days after opening the seal (18 days unopened in nitrogen-flushed tin); never claim multi-month shelf stability.",
    status: "USER_CONFIRMED",
    confidence: 0.99,
    evidenceRefIds: ["ev_web_zeytun_02"],
  },
  {
    factId: "pf_bnd_02",
    factType: "BOUNDARY",
    statement:
      "Contains tree nuts (pistachio), wheat gluten, and clarified sheep-milk dairy butter; not suitable for nut-free, gluten-free, vegan, or keto/sugar-free dietary requirements.",
    status: "USER_CONFIRMED",
    confidence: 0.99,
    evidenceRefIds: ["ev_web_zeytun_02"],
  },
  {
    factId: "pf_bnd_03",
    factType: "BOUNDARY",
    statement:
      "Requires 2-day air dispatch to humid regions (>75% relative humidity) to prevent phyllo moisture absorption; no custom corporate tin embossing on orders under 25 units.",
    status: "WEBSITE_ESTABLISHED",
    confidence: 0.94,
    evidenceRefIds: ["ev_web_zeytun_02"],
  },
];

export const DEMO_BUSINESS_UNDERSTANDING_JSON = {
  businessName: DEMO_BRAND_NAME,
  companyName: DEMO_BRAND_NAME,
  websiteUrl: DEMO_WEBSITE_URL,
  generalIndustry: "Artisanal Confectionery & Specialty Food Gifting",
  businessIdentity: {
    statement:
      "Zeytun Atelier is a small-batch Levantine & Anatolian pastry atelier based in New York crafting nitrogen-sealed 400g Boz Antep pistachio baklava and crispy kadayif gift tins ($32 USD) with 38% pure pistachio weight and 100% clarified sheep-milk butter.",
    status: "USER_CONFIRMED",
  },
  primaryOffering: {
    statement: DEMO_OFFERING_NAME,
    status: "USER_CONFIRMED",
  },
  category: {
    statement: "Artisanal Middle Eastern & Mediterranean Pastry Gifting (DTC & Boutique Hospitality)",
    status: "USER_CONFIRMED",
  },
  businessModel: {
    statement:
      "Direct-to-Consumer (DTC) e-commerce and boutique corporate gifting ($32 USD single 400g tin / $60 USD 2-tin bundle with complimentary 2-day US air shipping; $4,500/mo marketing budget).",
    status: "USER_CONFIRMED",
  },
  targetMarket: "United States",
  currency: "USD",
  pricePoint: "$32 USD per 400g Assortment Tin (18 pieces)",
  monthlyBudget: 4500,
  confidenceScore: 0.94,
  confidence: "USER_CONFIRMED",
  campaignOffering: {
    offeringName: DEMO_OFFERING_NAME,
    offeringType: "PHYSICAL_PRODUCT",
    price: "32.00",
    currency: "USD",
    packSize: "400g (18 pieces)",
    productTruthFacts: DEMO_PRODUCT_FACTS,
    productTruth: {
      facts: DEMO_PRODUCT_FACTS,
    },
  },
  productTruth: {
    facts: DEMO_PRODUCT_FACTS,
  },
  productTruthFacts: DEMO_PRODUCT_FACTS,
  targetUnderstanding: {
    targetRoles: [
      {
        roleTitle: "Thoughtful Dinner Hosts & Cultural Gift Buyers ($30–$65 Spend)",
        roleType: "PRIMARY_BUYER",
        status: "USER_CONFIRMED",
        statement:
          "Urban professionals and families purchasing a prestigious, non-cloying 400g artisan pastry tin for dinner hosts, holidays, and family gatherings.",
      },
      {
        roleTitle: "Boutique Executive & Client Appreciation Gift Buyers",
        roleType: "SECONDARY_BUYER",
        status: "WEBSITE_ESTABLISHED",
        statement:
          "Founders, legal/medical practices, and account directors sending memorable $32–$60 culinary thank-you gifts with transparent ingredient provenance.",
      },
    ],
  },
};

export const DEMO_COMPETITORS_DATA = [
  {
    id: DEMO_IDS.competitors.kervansaray,
    name: "KervanSaray Baklava",
    handle: "@kervansaraybaklava_us",
    platform: "instagram",
    websiteUrl: "https://kervansaray-baklava.demo.invalid",
    businessType: "Direct 400g Baklava & Pastry Gifting Competitor",
    tier: "A",
    strategicRole: "DIRECT",
    followersCount: 48200,
    engagementRate: 2.4,
    postingFrequency: 4.5,
    postsCollected: 12,
    dataFreshnessDays: 1,
    pagesCrawled: [
      {
        competitorBusinessEvidenceId: "ev_web_kervan_01",
        pageType: "HOME",
        sourceUrl: buildDemoEvidenceUrl("kervansaray-baklava.demo.invalid", "ev_mv_kervan_01"),
        snippet:
          "KervanSaray Baklava — Atelier in New York offering US domestic delivery on 400g Pistachio & Walnut Baklava Gift Tins ($32 USD standard tin / $25 USD Bazaar Value 400g Box). Free US shipping on orders over $75 USD.",
        extractedAt: "2026-10-14T09:00:00.000Z",
        structuredData: {
          jsonLd: [
            {
              "@type": "Product",
              name: "KervanSaray 400g Classic Pistachio & Walnut Tin",
              offers: { price: "32.00", priceCurrency: "USD" },
            },
            {
              "@type": "Product",
              name: "KervanSaray 400g Bazaar Value Assortment Box",
              offers: { price: "25.00", priceCurrency: "USD" },
            },
          ],
        },
      },
      {
        competitorBusinessEvidenceId: "ev_web_kervan_02",
        pageType: "POLICIES",
        sourceUrl: buildDemoEvidenceUrl("kervansaray-baklava.demo.invalid", "ev_mv_kervan_02"),
        snippet:
          "Free Shipping across United States on orders over $75 USD via 3–5 business day ground courier. All sales final on perishable confectionery.",
        extractedAt: "2026-10-14T09:05:00.000Z",
      },
    ],
    understanding: {
      positioning: [
        {
          statement:
            "Accessible Turkish-style 400g baklava gift boxes with fast US East Coast dispatch and promotional $25–$32 pricing.",
          primaryPromise: "Same 400g gift box size for 22% less than boutique ateliers.",
          categoryFrame: "Value-Anchored Turkish Confectionery Retailer",
          status: "BRAND_CLAIM",
          claimSource: "First-party catalog hero banner & promotional ad copy",
        },
      ],
      capabilities: [
        {
          competitorCapabilityFactId: "cap_kervan_01",
          statement:
            "Offers 400g Classic Tin ($32 USD) and newly launched 400g Bazaar Value Box ($25 USD, 18 pieces) using blended pistachio/walnut filling and 52% glucose syrup weight.",
          factType: "Product & Pricing Architecture",
          status: "WEBSITE_ESTABLISHED",
          rationale: "Verified on product catalog and Watchtower pricing diff.",
          evidenceRefIds: ["ev_web_kervan_01", "ev_wt_kervan_diff_01"],
        },
        {
          competitorCapabilityFactId: "cap_kervan_02",
          statement:
            "Free US domestic ground shipping on orders over $75 USD (3–5 day transit from New York warehouse).",
          factType: "Shipping & Fulfillment",
          status: "WEBSITE_ESTABLISHED",
          rationale: "Published on KervanSaray shipping policy page.",
          evidenceRefIds: ["ev_web_kervan_02"],
        },
      ],
      mechanisms: [
        {
          statement:
            "High-volume central bakery production with heavy glucose-syrup glaze (50%+ weight) to extend ambient shelf life and lower per-box ingredient cost.",
        },
      ],
      offers: [
        {
          offerStatement:
            "400g Bazaar Value Gift Box at $25 USD (down from $32 USD Classic Tin); Free US Ground Shipping over $75 USD.",
          pricing: "$25 USD (Promo 400g Box) / $32 USD (Classic 400g Tin)",
          cta: "Shop Now",
        },
      ],
      targetRoles: [
        {
          roleTitle: "Price-Conscious Holiday & Office Gift Shoppers",
          roleType: "BUYER",
          status: "WEBSITE_ESTABLISHED",
        },
      ],
      proof: [
        {
          proofType: "QUANTIFIED_CLAIM",
          statement: "Over 15,000 400g gift boxes shipped across the US East Coast.",
        },
      ],
    },
    posts: [
      {
        id: "post_demo_kervan_01",
        externalPostId: "ig_kervan_001",
        caption:
          "Why pay $32+ for a 400g pistachio baklava gift box when our new 400g Bazaar Value Assortment is just $25? Freshly glazed trays shipping daily from our New York kitchen. Tap Link in Bio to order.",
        hookText: "Why pay $32+ for a 400g pistachio baklava box when ours is $25?",
        postType: "reel",
        likes: 840,
        comments: 64,
        shares: 95,
        views: 19400,
        permalink: buildDemoEvidenceUrl("kervansaray-baklava.demo.invalid", "ev_wt_kervan_diff_01"),
        classification: {
          hookArchetype: "CURIOSITY_GAP",
          primaryHook: "Why pay $32+ for a 400g pistachio baklava box when ours is $25?",
          narrativeFramework: "before_after",
          awarenessStage: "PRODUCT_AWARE",
          ctaType: "SHOP_NOW",
          primaryGoal: "PRIMARY_GOAL_CONVERSION",
          emotionalTrigger: "VALUE_VALIDATION",
        },
      },
      {
        id: "post_demo_kervan_02",
        externalPostId: "ig_kervan_002",
        caption:
          "Hosting dinner this weekend? One 400g tin serves 6–8 guests with zero prep. Order two tins + a box of Turkish delight to unlock free $75 US shipping.",
        hookText: "Hosting dinner this weekend? One 400g tin serves 6–8 guests.",
        postType: "carousel",
        likes: 510,
        comments: 31,
        shares: 42,
        views: 11200,
        permalink: buildDemoEvidenceUrl("kervansaray-baklava.demo.invalid", "ev_mv_kervan_03"),
        classification: {
          hookArchetype: "DIRECT_BENEFIT",
          primaryHook: "Hosting dinner this weekend? One 400g tin serves 6–8 guests.",
          narrativeFramework: "problem_solution",
          awarenessStage: "SOLUTION_AWARE",
          ctaType: "LINK_IN_BIO",
          primaryGoal: "PRIMARY_GOAL_CONVERSION",
          emotionalTrigger: "SOCIAL_CONFIDENCE",
        },
      },
    ],
  },
  {
    id: DEMO_IDS.competitors.altinfistik,
    name: "AltınFıstık Confections",
    handle: "@altinfistik_us",
    platform: "instagram",
    websiteUrl: "https://altinfistik-confections.demo.invalid",
    businessType: "Luxury Gold-Foil Confectionery & Corporate Gifting",
    tier: "A",
    strategicRole: "DIRECT",
    followersCount: 62500,
    engagementRate: 3.1,
    postingFrequency: 3.5,
    postsCollected: 10,
    dataFreshnessDays: 2,
    pagesCrawled: [
      {
        competitorBusinessEvidenceId: "ev_web_altin_01",
        pageType: "HOME",
        sourceUrl: buildDemoEvidenceUrl("altinfistik-confections.demo.invalid", "ev_mv_altin_02"),
        snippet:
          "AltınFıstık Confections — Boutique in Chicago crafting luxury gold-foil 400g Royal Pistachio Assortment boxes ($36 USD). Free US shipping on orders over $85 USD.",
        extractedAt: "2026-10-13T11:00:00.000Z",
        structuredData: {
          jsonLd: [
            {
              "@type": "Product",
              name: "AltınFıstık 400g Royal Pistachio Gold Gift Box",
              offers: { price: "36.00", priceCurrency: "USD" },
            },
          ],
        },
      },
      {
        competitorBusinessEvidenceId: "ev_web_altin_02",
        pageType: "POLICIES",
        sourceUrl: buildDemoEvidenceUrl("altinfistik-confections.demo.invalid", "ev_mv_altin_01"),
        snippet:
          "Free Shipping across the US on orders over $85 USD via standard 5-day ground shipping. Custom corporate ribbon printing available on orders of 10+ boxes.",
        extractedAt: "2026-10-13T11:05:00.000Z",
      },
    ],
    understanding: {
      positioning: [
        {
          statement:
            "Opulent gold-foil 400g baklava gift boxes positioned for formal hospitality, weddings, and executive gifting at $36 USD.",
          primaryPromise: "The gold standard of luxury Middle Eastern dessert gifting.",
          categoryFrame: "Luxury Occasion & Corporate Confectionery House",
          status: "BRAND_CLAIM",
          claimSource: "First-party homepage luxury gifting manifesto",
        },
      ],
      capabilities: [
        {
          competitorCapabilityFactId: "cap_altin_01",
          statement:
            "400g Royal Pistachio Gold Gift Box priced at $36 USD with embossed rigid presentation sleeve and satin ribbon.",
          factType: "Product & Packaging Specification",
          status: "WEBSITE_ESTABLISHED",
          rationale: "Extracted from product page structured data.",
          evidenceRefIds: ["ev_web_altin_01"],
        },
        {
          competitorCapabilityFactId: "cap_altin_02",
          statement:
            "Free US shipping threshold at $85 USD via 5-day ground transit; does not disclose exact pistachio percentage or oven date on packaging.",
          factType: "Shipping & Transparency Policy",
          status: "WEBSITE_ESTABLISHED",
          rationale: "Verified across policy page and customer review evidence.",
          evidenceRefIds: ["ev_web_altin_02", "ev_mv_altin_03"],
        },
      ],
      mechanisms: [
        {
          statement:
            "Rigid gold-foil gift box aesthetic paired with multi-box corporate ribbon customization.",
        },
      ],
      offers: [
        {
          offerStatement:
            "400g Royal Pistachio Assortment at $36 USD; Free US Ground Shipping on orders $85+.",
          pricing: "$36 USD per 400g Box",
          cta: "View Collection",
        },
      ],
      targetRoles: [
        {
          roleTitle: "Corporate Event Planners & Formal Gift Givers",
          roleType: "BUYER",
          status: "WEBSITE_ESTABLISHED",
        },
      ],
      proof: [
        {
          proofType: "QUANTIFIED_CLAIM",
          statement: "Featured in 400+ corporate holiday gifting programs nationwide.",
        },
      ],
    },
    posts: [
      {
        id: "post_demo_altin_01",
        externalPostId: "ig_altin_001",
        caption:
          "Never arrive empty-handed. Our 400g Royal Gold Assortment ($36) turns any dinner invitation into a five-star celebration. Explore the collection via Link in Bio.",
        hookText: "Never arrive empty-handed to a formal dinner.",
        postType: "reel",
        likes: 1290,
        comments: 88,
        shares: 140,
        views: 31500,
        permalink: buildDemoEvidenceUrl("altinfistik-confections.demo.invalid", "ev_mv_altin_02"),
        classification: {
          hookArchetype: "ASPIRATION",
          primaryHook: "Never arrive empty-handed to a formal dinner.",
          narrativeFramework: "before_after",
          awarenessStage: "SOLUTION_AWARE",
          ctaType: "VIEW_COLLECTION",
          primaryGoal: "PRIMARY_GOAL_AWARENESS",
          emotionalTrigger: "PRESTIGE_AND_HOSPITALITY",
        },
      },
      {
        id: "post_demo_altin_02",
        externalPostId: "ig_altin_002",
        caption:
          "Most gift baskets get forgotten in a pantry. A gold-embossed 400g artisan baklava box gets opened at the center of the table within 5 minutes.",
        hookText: "Most gift baskets get forgotten in a pantry.",
        postType: "carousel",
        likes: 940,
        comments: 52,
        shares: 76,
        views: 22100,
        permalink: buildDemoEvidenceUrl("altinfistik-confections.demo.invalid", "ev_mv_altin_03"),
        classification: {
          hookArchetype: "CURIOSITY_GAP",
          primaryHook: "Most gift baskets get forgotten in a pantry.",
          narrativeFramework: "problem_solution",
          awarenessStage: "PROBLEM_AWARE",
          ctaType: "SHOP_NOW",
          primaryGoal: "PRIMARY_GOAL_CONVERSION",
          emotionalTrigger: "GIFTING_PRIDE",
        },
      },
    ],
  },
  {
    id: DEMO_IDS.competitors.serbetcihan,
    name: "Şerbetçi Han Gifting",
    handle: "@serbetcihan_istanbul",
    platform: "instagram",
    websiteUrl: "https://serbetcihan-gifting.demo.invalid",
    businessType: "International Heritage Turkish Baklava Exporter (Istanbul Reference)",
    tier: "B",
    strategicRole: "ASPIRATIONAL",
    followersCount: 145000,
    engagementRate: 3.8,
    postingFrequency: 5.0,
    postsCollected: 14,
    dataFreshnessDays: 1,
    pagesCrawled: [
      {
        competitorBusinessEvidenceId: "ev_web_serbet_01",
        pageType: "HOME",
        sourceUrl: buildDemoEvidenceUrl("serbetcihan-gifting.demo.invalid", "ev_mv_serbet_02"),
        snippet:
          "Şerbetçi Han Gifting — Historic Karaköy & Gaziantep Copper-Tray Baklava Atelier shipping 420g Heritage Tins ($29 USD + $18 DHL Express Worldwide Shipping).",
        extractedAt: "2026-10-13T14:00:00.000Z",
        structuredData: {
          jsonLd: [
            {
              "@type": "Product",
              name: "Şerbetçi Han 420g Heritage Bazaar Tin",
              offers: { price: "29.00", priceCurrency: "USD" },
            },
          ],
        },
      },
    ],
    understanding: {
      positioning: [
        {
          statement:
            "Heritage Istanbul & Gaziantep copper-tray baklava shipped worldwide in 420g souvenir tins ($29 USD + $18 international express freight).",
          primaryPromise: "Direct-from-Istanbul wood-fired copper tray craftsmanship.",
          categoryFrame: "International Heritage Origin Confectioner",
          status: "WEBSITE_ESTABLISHED",
          claimSource: "First-party heritage story & international shipping page",
        },
      ],
      capabilities: [
        {
          competitorCapabilityFactId: "cap_serbet_01",
          statement:
            "420g Heritage Bazaar Tin priced at $29 USD before $18 USD cross-border express courier fee ($47 USD landed cost in US).",
          factType: "International Catalog & Landed Pricing",
          status: "WEBSITE_ESTABLISHED",
          rationale: "Verified on international checkout terms.",
          evidenceRefIds: ["ev_web_serbet_01", "ev_mv_serbet_01"],
        },
      ],
      mechanisms: [
        {
          statement:
            "High-impact macro ASMR knife-cut videos showcasing audible 40-layer phyllo crunch and emerald Boz pistachio cross-sections.",
        },
      ],
      offers: [
        {
          offerStatement:
            "420g Heritage Tin at $29 USD + $18 USD International Express Shipping (3–6 day cross-border transit).",
          pricing: "$29 USD + $18 Shipping ($47 Landed)",
          cta: "Shop Now",
        },
      ],
      targetRoles: [
        {
          roleTitle: "Nostalgic Diaspora & Culinary Connoisseurs",
          roleType: "BUYER",
          status: "WEBSITE_ESTABLISHED",
        },
      ],
      proof: [
        {
          proofType: "QUANTIFIED_CLAIM",
          statement: "Third-generation master baklava artisans using early-harvest Gaziantep Boz pistachios.",
        },
      ],
    },
    posts: [
      {
        id: "post_demo_serbet_01",
        externalPostId: "ig_serbet_001",
        caption:
          "Listen to the 40-layer crunch before a single drop of light syrup touches the tray. Slice open our 420g Boz pistachio sarma and see why green gold needs no food coloring.",
        hookText: "Listen to the 40-layer crunch before the syrup touches the tray.",
        postType: "reel",
        likes: 4120,
        comments: 215,
        shares: 610,
        views: 98000,
        permalink: buildDemoEvidenceUrl("serbetcihan-gifting.demo.invalid", "ev_mv_serbet_02"),
        classification: {
          hookArchetype: "AUTHORITY",
          primaryHook: "Listen to the 40-layer crunch before the syrup touches the tray.",
          narrativeFramework: "before_after",
          awarenessStage: "PRODUCT_AWARE",
          ctaType: "SHOP_NOW",
          primaryGoal: "PRIMARY_GOAL_ENGAGEMENT",
          emotionalTrigger: "SENSORY_CRAVING",
        },
      },
    ],
  },
];

export const DEMO_CONTENT_DNA_LIST = [
  {
    competitorId: DEMO_IDS.competitors.kervansaray,
    competitorName: "KervanSaray Baklava",
    narrativeFrameworks: ["before_after", "problem_solution"],
    hookArchetypes: ["curiosity", "authority"],
    dominantFormats: ["reel", "carousel"],
  },
  {
    competitorId: DEMO_IDS.competitors.altinfistik,
    competitorName: "AltınFıstık Confections",
    narrativeFrameworks: ["before_after", "problem_solution"],
    hookArchetypes: ["curiosity", "authority"],
    dominantFormats: ["reel", "carousel"],
  },
  {
    competitorId: DEMO_IDS.competitors.serbetcihan,
    competitorName: "Şerbetçi Han Gifting",
    narrativeFrameworks: ["before_after"],
    hookArchetypes: ["authority"],
    dominantFormats: ["reel"],
  },
];

export const DEMO_APPROVED_PAINS = [
  {
    painId: "pain_demo_syrup_soggy",
    canonical:
      "400g baklava gift boxes arrive syrup-logged and cloyingly sweet because mass producers use 50%+ heavy glucose syrup to inflate box weight at the expense of real pistachio content.",
    originalStatement:
      "The tin weighed 400g on the scale, but almost half the weight was thick glucose syrup pooling at the bottom and the pastry sheets were soggy.",
    experience:
      "Hosts open a $32–$36 400g gift box at a dinner table only to find pooled corn/glucose syrup at the bottom, soggy bottom pastry layers, and sparse green pistachio filling.",
    commercialImpact:
      "Destroys repeat gifting confidence and makes buyers reluctant to spend $32+ online without proof of real nut-to-syrup weight ratios.",
    whyWeCanSolveIt:
      "Every 400g Zeytun Atelier tin contains a verified 152g (38%) early-harvest Boz Antep pistachio core, 100% sheep-milk clarified butter, and a 24% micro-brix beet-sugar infusion that preserves a dry 40-layer crunch.",
    classification: "CORE_PURCHASE",
    severity: "CRITICAL",
    productFit: "STRONG_DIRECT_FIT",
    evidence: [
      buildDemoEvidenceUrl("kervansaray-baklava.demo.invalid", "ev_mv_kervan_01"),
      buildDemoEvidenceUrl("kervansaray-baklava.demo.invalid", "ev_mv_kervan_02"),
    ],
  },
  {
    painId: "pain_demo_gift_presentation",
    canonical:
      "Gift buyers spending $30–$38 on a 400g assortment box worry the recipient cannot distinguish artisan clarified-butter baklava from cheap palm-oil trays when packaging lacks ingredient percentage and roast-date proof.",
    originalStatement:
      "Claims 'premium artisan baklava' at $36 for 400g, but the label doesn't state the pistachio percentage or when the batch was baked.",
    experience:
      "Gifting a generic paperboard box without a batch roast date or ingredient percentage card feels indistinguishable from a $19 grocery-store import tin.",
    commercialImpact:
      "Suppresses conversion among high-AOV ($60–$118) cultural and corporate gift buyers who need unmistakable provenance signaling.",
    whyWeCanSolveIt:
      "Packed in a reusable gold-embossed lacquered steel gift tin with a printed Batch Roast Card certifying oven date, Gaziantep Boz harvest lot, and exact 38% pistachio weight.",
    classification: "SUPPORTING",
    severity: "HIGH",
    productFit: "STRONG_DIRECT_FIT",
    evidence: [
      buildDemoEvidenceUrl("altinfistik-confections.demo.invalid", "ev_mv_altin_03"),
      buildDemoEvidenceUrl("altinfistik-confections.demo.invalid", "ev_mv_altin_02"),
    ],
  },
  {
    painId: "pain_demo_transit_crushing",
    canonical:
      "Delicate 40-layer phyllo and shredded kadayif lose their crunch or leak syrup onto gift ribbons during 5-day economy ground shipping or customs holds.",
    originalStatement:
      "Shipped via 5-day economy ground without an internal divider tray; shredded kadayif absorbed moisture, lost all crunch, and syrup leaked onto the ribbon.",
    experience:
      "Boxes shipped via slow ground transit or held in cross-border customs arrive with crushed kadayif threads, displaced pieces, and sticky syrup on the outer gift wrap.",
    commercialImpact:
      "Creates high pre-purchase shipping anxiety for nationwide US gift orders.",
    whyWeCanSolveIt:
      "Hermetically nitrogen-flushed steel tin with an individual 18-cell rigid honeycomb divider tray and domestic 2-day US air dispatch.",
    classification: "SUPPORTING",
    severity: "HIGH",
    productFit: "STRONG_DIRECT_FIT",
    evidence: [
      buildDemoEvidenceUrl("altinfistik-confections.demo.invalid", "ev_mv_altin_01"),
      buildDemoEvidenceUrl("serbetcihan-gifting.demo.invalid", "ev_mv_serbet_01"),
    ],
  },
];

export const DEMO_AUDIENCE_SEGMENTS = [
  {
    segmentId: "seg_demo_hosts_gifters",
    name: "Discerning Dinner Hosts & Cultural Gift Buyers ($30–$65 Order Value)",
    role: "PRIMARY_BUYER",
    buyerRole: "Household Host & Cultural Gift Buyer",
    marketType: "Premium DTC Specialty Confectionery & Gifting (United States)",
    commercialRelevance: "70% of monthly revenue target ($32 Single Tin / $60 2-Tin Host Bundle)",
    description:
      "Urban professionals and families buying a prestigious 400g (18-piece) centerpiece dessert gift who value authentic Boz pistachio density, low-sweetness balance, and table-ready lacquered tin presentation.",
    pains: DEMO_APPROVED_PAINS.map((p) => ({
      painId: p.painId,
      pain: p.canonical,
      originalStatement: p.originalStatement,
      experience: p.experience,
      commercialImpact: p.commercialImpact,
      whyWeCanSolveIt: p.whyWeCanSolveIt,
      severity: p.severity,
      evidence: p.evidence,
    })),
    triggers: [
      "Invited to a dinner party, holiday gathering, or family celebration within the next 3–5 days",
      "Disappointed by a previous soggy or overly sugary store-bought baklava tray",
    ],
  },
  {
    segmentId: "seg_demo_exec_gifting",
    name: "Boutique Executive & Client Appreciation Buyers (2–10 Box Orders)",
    role: "SECONDARY_BUYER",
    description:
      "Founders, agency partners, and professional practices sending memorable $32–$60 culinary gifts who require guaranteed 2-day air arrival and leak-free nitrogen-sealed tins.",
    pains: [
      {
        painId: "pain_demo_gift_presentation",
        pain: DEMO_APPROVED_PAINS[1].canonical,
        originalStatement: DEMO_APPROVED_PAINS[1].originalStatement,
        severity: "HIGH",
        evidence: DEMO_APPROVED_PAINS[1].evidence,
      },
      {
        painId: "pain_demo_transit_crushing",
        pain: DEMO_APPROVED_PAINS[2].canonical,
        originalStatement: DEMO_APPROVED_PAINS[2].originalStatement,
        severity: "HIGH",
        evidence: DEMO_APPROVED_PAINS[2].evidence,
      },
    ],
    triggers: [
      "Closing a client milestone or sending quarterly appreciation gifts under a $35–$65 per-recipient budget",
    ],
  },
];

export const DEMO_DESIRES = [
  {
    desireId: "des_demo_01",
    canonical:
      "Serve or gift a 400g assortment where every piece reveals a vibrant emerald 38% Boz pistachio core and an audible, non-soggy 40-layer phyllo crunch.",
  },
  {
    desireId: "des_demo_02",
    canonical:
      "Present a Reusable Lacquered Gift Tin with a batch roast card that immediately signals culinary authenticity and thoughtfulness at the table.",
  },
  {
    desireId: "des_demo_03",
    canonical:
      "Receive guaranteed crunch and intact piece geometry via nitrogen-flushed sealing and 2-day domestic air delivery without paying $18 cross-border freight.",
  },
];

export const DEMO_OBJECTIONS = [
  {
    objectionId: "obj_demo_01",
    canonical:
      "Why is Zeytun Atelier $32 for 400g when KervanSaray's promotional 400g Bazaar Box is $25?",
    rebuttal:
      "Zeytun's 400g tin contains 152g (38%) of whole early-harvest Boz Antep pistachios and only 24% light beet syrup. A $25 glucose-heavy box (~52% syrup weight) delivers half the pistachio weight and charges $25 primarily for sugar water.",
  },
  {
    objectionId: "obj_demo_02",
    canonical:
      "Will delicate baklava and shredded kadayif stay crisp during US parcel shipping without preservatives?",
    rebuttal:
      "Every 400g tin is flushed with food-grade nitrogen immediately after cooling, fitted with a rigid honeycomb divider tray, and dispatched via 2-day air so the seal is broken fresh at your table (10-day ambient crunch window once opened).",
  },
];

export function buildDemoDifferentiationPillars(version: 1 | 2) {
  const basePillars = [
    {
      pillarId: "diff_pillar_pistachio_ratio",
      title:
        version === 2
          ? "Verified 38% Boz Pistachio Weight (152g Pure Nut Core vs 75g in $25 Syrup-Heavy 400g Boxes)"
          : "38% Early-Harvest Boz Antep Pistachio Content & 24% Micro-Brix Syrup Balance",
      claim:
        version === 2
          ? "Every 400g Zeytun tin delivers 152g of emerald Boz Antep pistachios and only 24% light beet-sugar syrup—giving buyers 2x the real pistachio weight per dollar compared to $25 glucose-weighted 400g promo boxes."
          : "Crafted with 38% Boz Antep pistachio by weight, 100% clarified sheep-milk butter, and a 24% low-brix beet-sugar infusion instead of the 50%+ glucose syrup used by mass-market competitors.",
      truthStatus: "VERIFIED_CAPABILITY",
      competitorContrast:
        version === 2
          ? "Directly counters KervanSaray Baklava's $25 400g 'Bazaar Value Box' (which relies on 52% glucose syrup weight and walnut/peanut blends) by exposing true cost-per-gram of real pistachio."
          : "Contrasts against KervanSaray Baklava and AltınFıstık Confections, where customer reviews cite pooled bottom syrup and undisclosed nut-to-syrup ratios.",
      evidenceRefs: ["pf_cap_01", "pf_cap_02", "ev_mv_kervan_01", "ev_wt_kervan_diff_01"],
    },
    {
      pillarId: "diff_pillar_nitrogen_tin",
      title: "Nitrogen-Flushed Lacquered Tin + Honeycomb Divider + Printed Batch Roast Card",
      claim:
        "Hermetically nitrogen-sealed 400g steel gift tin with individual honeycomb cells and a printed roast card disclosing oven date, harvest lot, and exact gram breakdown.",
      truthStatus: "VERIFIED_CAPABILITY",
      competitorContrast:
        "Eliminates the crushed kadayif and syrup-stained ribbons reported in AltınFıstık's 5-day ground shipments and the $18 cross-border customs delays seen with Şerbetçi Han.",
      evidenceRefs: ["pf_cap_03", "ev_mv_altin_01", "ev_mv_serbet_01"],
    },
    {
      pillarId: "diff_pillar_honest_boundaries",
      title: "Uncompromised Ingredient Integrity with Transparent 10-Day Opened Freshness Window",
      claim:
        "100% clarified sheep-milk butter (sade yağ) and zero artificial humectants or palm oil—backed by an explicit 10-day post-opening crunch window rather than exaggerated shelf-life claims.",
      truthStatus: "VERIFIED_CAPABILITY",
      competitorContrast:
        "Builds credibility with discerning ingredient-conscious hosts who distrust vague 'artisan' claims without batch dates.",
      evidenceRefs: ["pf_cap_02", "pf_bnd_01", "ev_mv_altin_03"],
    },
  ];
  return basePillars;
}

export function buildDemoStrategicPlanJson(version: 1 | 2) {
  const isV2 = version === 2;
  const rawPillars = buildDemoDifferentiationPillars(version);
  const differentiationPillars = rawPillars.map((p) => ({
    ...p,
    name: p.title,
    description: p.claim,
    truthStatus: "VERIFIED",
    truthLabel: "Verified First-Party Product Truth",
    supportingProof: [
      "38% Boz Antep Pistachio Weight (152g per 400g tin) · Printed Batch Roast Card",
      p.competitorContrast,
    ],
  }));

  const approvedLanes = [
    {
      laneId: DEMO_IDS.lanes.gifting,
      id: DEMO_IDS.lanes.gifting,
      title: "Dinner-Host & Cultural Occasion Gifting (400g Signature Tin — $32 USD)",
      name: "Dinner-Host & Cultural Occasion Gifting (400g Signature Tin — $32 USD)",
      description:
        "Urban professionals and families buying a prestigious 400g (18-piece) centerpiece dessert gift who value authentic 38% Boz pistachio density, low-sweetness balance, and table-ready lacquered tin presentation.",
      commercialRelevance: "70% of monthly revenue target ($32 Single Tin / $60 2-Tin Host Bundle)",
      whyWeCanSolveIt:
        "Our 400g tin contains 152g (38%) of early-harvest Boz Antep pistachio, 100% sheep-milk clarified butter, and only 24% light beet-sugar syrup—nitrogen-flushed with a honeycomb divider and shipped via 2-day US air.",
      targetSegment: "Discerning Dinner Hosts & Cultural Gift Buyers ($30–$65 Spend)",
      segmentId: "seg_demo_hosts_gifters",
      segmentIds: ["seg_demo_hosts_gifters"],
      primaryPainId: "pain_demo_syrup_soggy",
      supportingPainIds: ["pain_demo_gift_presentation", "pain_demo_transit_crushing"],
      desires: DEMO_DESIRES.map((d) => d.canonical),
      objections: DEMO_OBJECTIONS.map((o) => o.canonical),
      positioningAngle: isV2
        ? "152g of Real Boz Pistachio vs $25 Sugar-Syrup Weight: The 400g Gift Tin You Can Slice Open on Camera"
        : "The 38% Boz Pistachio Atelier Assortment: Crisp, Low-Syrup 400g Gift Tins Crafted with Clarified Butter",
      offerHook: isV2
        ? "$32 Signature 400g Tin (18 Pieces + Printed Gram-Ratio Roast Card) or $60 2-Tin Host Bundle + Bonus 40g Boz Pistachio Tasting Sleeve & Free 2-Day Air"
        : "$32 Signature 400g Tin (18 Pieces + Gift Message Card) or $60 2-Tin Host Bundle with Free 2-Day US Air Shipping",
      primaryChannels: ["Instagram Reels & Carousels", "TikTok Cut-Open Proof Video", "Google High-Intent Search"],
      budgetSharePercent: 70,
    },
    {
      laneId: DEMO_IDS.lanes.hosting,
      id: DEMO_IDS.lanes.hosting,
      title: "Boutique Executive & Client Appreciation Gifting (Multi-Tin Bundles)",
      name: "Boutique Executive & Client Appreciation Gifting (Multi-Tin Bundles)",
      description:
        "Founders, agency partners, and professional practices sending memorable $32–$60 culinary gifts who require guaranteed 2-day air arrival and leak-free nitrogen-sealed tins.",
      commercialRelevance: "30% of monthly revenue target ($60 2-Tin & $118 4-Tin Bundles)",
      whyWeCanSolveIt:
        "Hermetically nitrogen-flushed lacquered steel tins with rigid honeycomb dividers, custom gift cards, and 2-day air dispatch prevent crushed pastry or syrup-stained gift ribbons.",
      targetSegment: "Boutique Executive & Client Appreciation Buyers (2–10 Box Orders)",
      segmentId: "seg_demo_exec_gifting",
      segmentIds: ["seg_demo_exec_gifting"],
      primaryPainId: "pain_demo_gift_presentation",
      supportingPainIds: ["pain_demo_transit_crushing"],
      desires: [DEMO_DESIRES[1].canonical, DEMO_DESIRES[2].canonical],
      objections: [DEMO_OBJECTIONS[1].canonical],
      positioningAngle:
        "Table-Ready Lacquered Gift Tins with Batch Provenance Cards & Leak-Free 2-Day Air Delivery",
      offerHook:
        "Executive 4-Tin Appreciation Pack ($118 USD, $29.50/tin) with Personalized Gift Cards & Guaranteed 2-Day Air Dispatch",
      primaryChannels: ["Instagram Carousel", "Google Search", "Direct Retargeting"],
      budgetSharePercent: 30,
    },
  ];

  const brandSpine = {
    umbrellaPositionName: isV2
      ? "Verified Nut-Weight Artisanal Confectionery (38% Boz Pistachio Standard)"
      : "Micro-Brix Artisanal Levantine & Anatolian Pastry Atelier",
    corePositioningStatement: isV2
      ? "For discerning dinner hosts and gift buyers who refuse syrup-logged mass-market baklava, Zeytun Atelier crafts the 400g Antep Pistachio & Kadayif Assortment Tin ($32 USD) with 152g (38%) verified Boz pistachio weight, 24% light beet-sugar infusion, and nitrogen-sealed 2-day air delivery—proving 2x the real nut density of $25 glucose-weighted promo boxes."
      : "For discerning dinner hosts and gift buyers who refuse syrup-logged mass-market baklava, Zeytun Atelier crafts the 400g Antep Pistachio & Kadayif Assortment Tin ($32 USD) with 38% early-harvest Boz pistachio, 100% clarified sheep-milk butter, and a 24% low-brix syrup ratio sealed in nitrogen-flushed gift tins.",
    narrativeDirection: isV2
      ? "For discerning dinner hosts and gift buyers who refuse syrup-logged mass-market baklava, Zeytun Atelier crafts the 400g Antep Pistachio & Kadayif Assortment Tin ($32 USD) with 152g (38%) verified Boz pistachio weight, 24% light beet-sugar infusion, and nitrogen-sealed 2-day air delivery—proving 2x the real nut density of $25 glucose-weighted promo boxes."
      : "For discerning dinner hosts and gift buyers who refuse syrup-logged mass-market baklava, Zeytun Atelier crafts the 400g Antep Pistachio & Kadayif Assortment Tin ($32 USD) with 38% early-harvest Boz pistachio, 100% clarified sheep-milk butter, and a 24% low-brix syrup ratio sealed in nitrogen-flushed gift tins.",
    contrastAxis: isV2
      ? "38% Verified Boz Pistachio Weight (152g Nut Core) & 24% Micro-Brix Crunch vs. $25 Promo Boxes Inflated with 52% Glucose Syrup"
      : "38% Early-Harvest Boz Pistachio & 24% Micro-Brix Crunch vs. 50%+ Glucose-Syrup Mass-Market Gift Trays",
    primaryPromise: isV2
      ? "152g of emerald Boz pistachio and an audible 40-layer crunch in every 400g tin—never weighted down with cheap glucose syrup."
      : "Audible 40-layer phyllo crunch and 38% Boz Antep pistachio density in a nitrogen-sealed 400g gift tin.",
    truthStatus: "VERIFIED",
    truthLabel: "Verified First-Party Product Truth",
    contrastAxisGrounded: {
      status: "VERIFIED",
      label: "Grounded in Product Capabilities & Competitor Mirror",
    },
    productTruth:
      "38% Boz Antep pistachio weight (152g/400g), 100% clarified sheep-milk butter, 24% light beet-sugar syrup, nitrogen-flushed 18-piece tin; 10-day post-opening ambient shelf life.",
    productTruthFactIds: [
      "38% Boz Antep pistachio weight (152g per 400g tin) + 24% low-brix beet syrup + 100% sheep-milk clarified butter",
    ],
    coreDifferentiationPillars: differentiationPillars.map((p) => p.title),
    mechanism: "Dry-Roast & Micro-Brix Infusion Protocol (38% Boz Pistachio / 24% Syrup Ratio)",
  };

  const strategyHeadline = isV2
    ? "Strategy v2 (Adapted): Disarm Competitor $25 Promo Box via '152g Real Pistachio Weight vs Syrup Weight' Proof & 2-Tin Tasting Bonus"
    : "Strategy v1 (Baseline): Capture Premium $32 400g Gift Box Demand Through 38% Boz Pistachio Density & Nitrogen-Sealed Crunch Proof";

  const strategyRationale = isV2
    ? "Following Watchtower confirmation of KervanSaray Baklava's $25 400g Bazaar Value Box (-22% price cut achieved via 52% glucose syrup weight), Strategy v2 preserves our $32 USD unit price and upgrades Differentiation and Offer framing. Creative and landing pages now show side-by-side gram breakdowns (152g Boz pistachio vs ~75g in $25 syrup-heavy boxes) and include a complimentary 40g Boz Pistachio Tasting Sleeve on 2-Tin ($60) orders to protect AOV and conversion rate."
    : "Zeytun Atelier competes in the US DTC & gifting market with a hero 400g Antep Pistachio Baklava & Kadayif Assortment Tin ($32 USD). Market intelligence across KervanSaray Baklava, AltınFıstık Confections, and Şerbetçi Han shows widespread customer frustration with soggy, glucose-heavy 400g boxes and slow ground shipping. Our strategy anchors on verifiable ingredient math (38% Boz pistachio, 24% light beet syrup, 100% sheep-milk clarified butter) and nitrogen-sealed 2-day air delivery.";

  const buyerConversionJourneys = [
    {
      laneId: DEMO_IDS.lanes.gifting,
      laneLabel: "Lane 1 · Dinner-Host & Cultural Gifting ($32 Tin / $60 2-Tin Bundle)",
      primaryPainId: "pain_demo_syrup_soggy",
      primaryPainText: DEMO_APPROVED_PAINS[0].canonical,
      segmentIds: ["seg_demo_hosts_gifters"],
      targetSegmentName: "Discerning Dinner Hosts & Cultural Gift Buyers ($30–$65 Order Value)",
      journeyName: isV2
        ? "Nut-to-Syrup Gram Proof → 400g Tin Breakdown → $60 2-Tin Host Tasting Bundle"
        : "Sensory Crunch Proof → Batch Provenance Verification → 400g Gift Tin Checkout",
      journeyType: "Direct-to-Consumer Premium Gifting",
      whyThisJourney: isV2
        ? "When a competitor advertises a $25 400g box, buyers need immediate visual proof of why two 400g boxes are not equal before they reach the product page."
        : "Gift buyers and dinner hosts need sensory reassurance that the pastry will arrive crisp and presentation-ready before committing $32–$60.",
      entryTrigger: {
        mechanismType: isV2 ? "Ingredient Gram-Math Contrast" : "Sensory Cross-Section Demonstration",
        purpose: isV2
          ? "Expose the 52% glucose-syrup weight trick in $25 promo boxes vs our 152g (38%) Boz pistachio core."
          : "Demonstrate audible 40-layer phyllo crunch and zero pooled bottom syrup in a 15-second macro cut.",
      },
      stages: [
        {
          stageId: "stage_1_sensory_hook",
          stageName: isV2
            ? "Stage 1: 400g Scale & Cross-Section Proof (Instagram Reels & TikTok)"
            : "Stage 1: Macro Knife-Cut & Crunch Proof (Instagram Reels & TikTok)",
          buyerState: "Skeptical of soggy, overly sweet boxed baklava",
          goal: "Stop scroll with verifiable cross-section density and audible crunch",
          coreMessage: isV2
            ? "Don't pay $25 for 208g of sugar water. See what 152g (38%) of real Boz Antep pistachio looks like inside a 400g tin."
            : "40 hand-rolled layers, 38% emerald Boz pistachio, and zero pooled glucose syrup at the bottom of the tin.",
          contentAction: isV2
            ? "15-second split-screen Reel slicing open Zeytun's 400g tin (38% pistachio, 24% light beet syrup) next to a syrup-logged promo piece."
            : "15-second ASMR knife-cut Reel showing crisp phyllo layers, emerald pistachio center, and nitrogen tin seal peel.",
          proof: [
            "Live macro cross-section showing dry, un-soggy bottom pastry layers",
            "Printed Batch Roast Card showing 152g Boz pistachio / 96g syrup / 152g clarified-butter pastry",
          ],
          cta: "Inspect the 18-Piece 400g Assortment Tin ($32)",
        },
        {
          stageId: "stage_2_pdp_verification",
          stageName: "Stage 2: 18-Piece Assortment & Freshness Boundary Verification (Carousel & PDP)",
          buyerState: "Evaluating gift presentation, transit safety, and ingredient authenticity",
          goal: "Eliminate transit-crushing and ingredient skepticism",
          coreMessage:
            "Every 400g lacquered steel tin is nitrogen-flushed with a honeycomb cell divider and shipped via 2-day US air—with an honest 10-day post-opening crunch window.",
          contentAction:
            "Interactive 400g Tin Anatomy module on PDP + 5-slide Instagram Carousel showing all 18 pieces (Pistachio Classic, Burma Kadayif, Midye).",
          proof: [
            "Nitrogen-flushed seal & honeycomb tray unboxing clip",
            "Explicit disclosure: 100% sheep-milk clarified butter, zero preservatives, enjoy within 10 days of opening",
          ],
          cta: isV2
            ? "Select Single 400g Tin ($32) or 2-Tin Host Bundle ($60 + Free 40g Tasting Sleeve)"
            : "Select Single 400g Tin ($32) or 2-Tin Host Bundle ($60 + Free 2-Day Air)",
        },
        {
          stageId: "stage_3_checkout_bundle",
          stageName: "Stage 3: Gift Dispatch & Multi-Tin Bundle Conversion (Search & Retargeting)",
          buyerState: "Ready to order for an upcoming dinner or holiday gathering",
          goal: "Maximize checkout conversion and upgrade 38%+ of buyers to the $60 2-Tin Bundle",
          coreMessage: isV2
            ? "Order the $60 2-Tin Host Bundle for Free 2-Day Air Shipping plus a complimentary 40g Host Preview Sleeve so you can taste the crunch without opening the gift tin."
            : "Order by 2 PM EST for 2-day air dispatch in a reusable lacquered gift tin with complimentary custom host message card.",
          contentAction:
            "High-intent Google Search capture + Meta retargeting card highlighting guaranteed 2-day air arrival and intact-piece replacement assurance.",
          proof: [
            "Intact-Arrival & Crunch Replacement Guarantee",
            "2-Day Air Dispatch tracking from NJ/CA micro-hubs",
          ],
          cta: "Complete Order — $32 Single Tin / $60 2-Tin Host Bundle",
        },
      ],
      persuasionStrategy: {
        mode: "EVIDENCE_FIRST_CONTRAST",
        modeLabel: "Verifiable Ingredient Math & Sensory Proof",
        coreBeliefTransformation: {
          currentBelief: isV2
            ? "All 400g baklava boxes are roughly similar, so a $25 promotional box is a better deal than a $32 tin."
            : "Shipped baklava is always overly sweet, soggy at the bottom, and crushed in transit.",
          desiredBelief: isV2
            ? "A $25 box weighted with 52% glucose syrup charges mostly for sugar water; Zeytun's $32 tin delivers 2x the real Boz pistachio weight (152g) and crisp 40-layer pastry."
            : "Micro-brix 24% syrup infusion + nitrogen-flushed honeycomb tins deliver Istanbul-atelier crunch anywhere in the US within 48 hours.",
          contradictionLogic:
            "Demonstrate the exact gram breakdown (152g Boz pistachio + 152g clarified-butter phyllo/kadayif + 96g beet syrup = 400g) alongside a live cross-section cut.",
        },
        messageSequence: [
          {
            step: 1,
            stepLabel: "Expose the Syrup-Weight Illusion",
            rationale:
              "Show why mass-market 400g boxes feel heavy: 50%+ thick glucose syrup pooling at the bottom instead of expensive Boz pistachios.",
          },
          {
            step: 2,
            stepLabel: "Verify the 38% Boz Pistachio / 24% Micro-Brix Standard",
            rationale:
              "Prove how stone-baking 40 layers with sheep-milk clarified butter and light 24% beet syrup preserves audible crunch and nut aroma.",
          },
          {
            step: 3,
            stepLabel: "De-Risk Gifting via Nitrogen Tin & Honest Boundaries",
            rationale:
              "Show the reusable lacquered tin, honeycomb divider, 2-day air dispatch, and transparent 10-day post-opening freshness boundary.",
          },
        ],
        objections: [
          {
            objectionId: "obj_demo_01",
            objection: DEMO_OBJECTIONS[0].canonical,
            response: DEMO_OBJECTIONS[0].rebuttal,
            requiredProof: "400g Gram-Ratio Comparison Graphic (152g Boz Pistachio vs ~75g in $25 Syrup Box)",
            funnelStageId: "stage_1_sensory_hook",
          },
          {
            objectionId: "obj_demo_02",
            objection: DEMO_OBJECTIONS[1].canonical,
            response: DEMO_OBJECTIONS[1].rebuttal,
            requiredProof: "Nitrogen-Flushed Seal & Honeycomb Divider Unboxing Video",
            funnelStageId: "stage_2_pdp_verification",
          },
        ],
        trustStrategy: {
          buyerRiskState: "Fear of presenting a soggy, overly sweet, or transit-damaged gift box to guests",
          trustDeficit: "Competitors use 'artisan' labels while hiding glucose syrup percentages and roast dates",
          transferMechanismName: "Printed Batch Roast Card + Cut-Open Gram Verification",
          proofArtifact: "Physical Batch Roast Card inside every 400g tin certifying oven date, harvest lot, and 38% pistachio weight",
          primaryCialdiniPrinciple: "Authority & Radical Specification Transparency",
        },
      },
    },
    {
      laneId: DEMO_IDS.lanes.hosting,
      laneLabel: "Lane 2 · Boutique Executive & Client Appreciation (Multi-Tin Packs)",
      primaryPainId: "pain_demo_gift_presentation",
      primaryPainText: DEMO_APPROVED_PAINS[1].canonical,
      segmentIds: ["seg_demo_exec_gifting"],
      targetSegmentName: "Boutique Executive & Client Appreciation Buyers (2–10 Box Orders)",
      journeyName: "Packaging & Provenance Proof → Multi-Recipient Gift Setup → 2-Day Air Dispatch",
      journeyType: "High-AOV Corporate & Client Gifting",
      whyThisJourney:
        "Executive gift buyers care most about recipient impression, zero leaked syrup on packaging, and reliable 2-day delivery.",
      entryTrigger: {
        mechanismType: "Table-Ready Luxury Tin & Provenance Showcase",
        purpose: "Position the $32–$118 lacquered tin sets as a memorable culinary alternative to generic gift baskets.",
      },
      stages: [
        {
          stageId: "stage_exec_1",
          stageName: "Stage 1: Lacquered Tin & Batch Card Presentation (Instagram Carousel)",
          buyerState: "Looking for a distinctive $30–$60 client or team appreciation gift",
          goal: "Showcase unboxing elegance and leak-free nitrogen seal",
          coreMessage: "A culinary gift tin that looks like fine jewelry and tastes like an Istanbul pastry atelier.",
          contentAction: "Carousel highlighting the reusable embossed tin, honeycomb tray, and custom gift note card.",
          proof: [" Leak-free nitrogen seal test", "Printed Batch Roast Card"],
          cta: "Explore 2-Tin ($60) & 4-Tin ($118) Gift Packs",
        },
        {
          stageId: "stage_exec_2",
          stageName: "Stage 2: Multi-Address & 2-Day Air Checkout (PDP & Search)",
          buyerState: "Confirming dietary disclosures and delivery speed",
          goal: "Convert 2-tin and 4-tin bundle orders with clear allergen & freshness transparency",
          coreMessage: "Guaranteed 2-day air delivery with explicit allergen & 10-day post-opening freshness cards in every box.",
          contentAction: "Direct PDP bundle selector with instant gift-message entry and 2-day air SLA badge.",
          proof: ["Intact-Arrival Replacement Assurance", "Clear allergen & storage card included"],
          cta: "Order Executive Gift Pack ($60 / $118)",
        },
      ],
    },
  ];

  return {
    version,
    planVersion: version,
    offeringName: DEMO_OFFERING_NAME,
    brandName: DEMO_BRAND_NAME,
    targetMarket: "United States",
    currency: "USD",
    monthlyBudget: 4500,
    primaryLaneId: DEMO_IDS.lanes.gifting,
    approvedLanes,
    brandSpine,
    differentiationPillars,
    pillars: differentiationPillars,
    pains: DEMO_APPROVED_PAINS.map((p) => ({
      painId: p.painId,
      id: p.painId,
      text: p.canonical,
      canonical: p.canonical,
    })),
    businessRepresentation: {
      strategicSummary: {
        strategy: strategyHeadline,
        rationale: strategyRationale,
      },
      contentDistribution: {
        rationale:
          "Concentrate 85% of the $4,500/month budget on visual cross-section proof (Instagram Reels/Carousels + TikTok) where buyers can see and hear the 40-layer crunch and 38% emerald pistachio density, supported by 15% high-intent search & retargeting.",
      },
      buyerConversionJourneys,
    },
    strategicSummary: {
      strategy: brandSpine.corePositioningStatement,
      rationale: strategyRationale,
      headline: strategyHeadline,
      executiveSummary: strategyRationale,
      coreConstraintHonored:
        "All messaging strictly honors product boundaries: 10-day post-opening ambient freshness window (no preservative claims), explicit nut/gluten/dairy allergen disclosures, and 2-day air transit requirement for humid zones.",
    },
    positioning: {
      statement: brandSpine.corePositioningStatement,
      contrastAxis: brandSpine.contrastAxis,
      umbrellaCategory: brandSpine.umbrellaPositionName,
      primaryPromise: brandSpine.primaryPromise,
    },
    differentiation: {
      pillars: differentiationPillars,
    },
    mechanism: {
      name: "Dry-Roast & Micro-Brix Infusion Protocol (38% Boz Pistachio / 24% Syrup Ratio)",
      mechanismName: "Dry-Roast & Micro-Brix Infusion Protocol (38% Boz Pistachio / 24% Syrup Ratio)",
      type: "Artisanal Formulation & Nitrogen Preservation System",
      description:
        "We stone-bake 40 micro-thin phyllo layers with 100% clarified sheep-milk butter, pack 38% early-harvest Boz Antep pistachios by weight, infuse a light 24% beet-sugar syrup at controlled temperature so pastry layers stay crisp, and nitrogen-flush each 400g tin before 2-day air dispatch.",
      promise:
        "Delivers 152g of vibrant emerald Boz pistachio and an audible 40-layer crunch with zero pooled bottom syrup—preserved fresh until the tin seal is broken.",
      whyItWorks:
        "Mass-market producers drench low-nut pastry in 50%+ cheap glucose syrup to inflate box weight to 400g, which turns phyllo soggy. By inverting the ratio to 38% Boz pistachio and 24% micro-brix beet syrup—and removing oxygen via nitrogen flushing—we preserve both crisp texture and roasted nut aroma across US air transit.",
      steps: [
        "1. 40-Layer Clarified-Butter Stone Bake: Hand-rolled 0.08mm phyllo and shredded kadayif baked with 100% pure sheep-milk clarified butter (zero palm oil).",
        "2. 38% Early-Harvest Boz Pistachio Core: Each 400g tin is packed with 152g of high-oil emerald Boz Antep pistachios for intense natural flavor.",
        "3. 24% Micro-Brix Beet-Sugar Infusion: Light, temperature-calibrated syrup locks into pastry layers without pooling or sogginess (zero glucose syrup).",
        "4. Nitrogen-Flushed Honeycomb Tin & 2-Day Air Dispatch: Hermetically sealed in a reusable lacquered steel tin with a Batch Roast Card and shipped via 2-day air.",
      ],
      statement:
        "We stone-bake 40 micro-thin phyllo layers with 100% clarified sheep-milk butter, pack 38% early-harvest Boz Antep pistachios by weight, infuse a light 24% beet-sugar syrup at controlled temperature so pastry layers stay crisp, and nitrogen-flush each 400g tin before 2-day air dispatch.",
      proofPoints: [
        "152g pure Boz pistachio + 96g syrup + 152g clarified-butter phyllo & kadayif = 400g honest net weight",
        "Printed Batch Roast Card inside every tin with oven date and harvest lot",
        "Zero pooled bottom syrup on cut-open cross-section inspection",
      ],
    },
    offer: {
      offerName: isV2
        ? "400g Antep Pistachio Baklava & Kadayif Assortment Tin ($32 USD) + $60 2-Tin Host Tasting Bundle"
        : "400g Antep Pistachio Baklava & Kadayif Assortment Tin ($32 USD) & $60 2-Tin Host Bundle",
      title: isV2
        ? "400g Antep Pistachio Baklava & Kadayif Assortment Tin ($32 USD) + $60 2-Tin Host Tasting Bundle"
        : "400g Antep Pistachio Baklava & Kadayif Assortment Tin ($32 USD) & $60 2-Tin Host Bundle",
      outcome: isV2
        ? "Serve or gift a verifiable 152g Boz pistachio assortment with guaranteed 40-layer crunch—plus a free 40g Host Preview Tasting Sleeve on 2-tin orders so you never have to unseal the gift tin."
        : "Present a table-ready, nitrogen-sealed 400g (18-piece) artisanal baklava & kadayif assortment with guaranteed crunch and 2-day US air delivery.",
      primaryPromise: isV2
        ? "152g (38%) verified Boz pistachio core in every $32 400g tin, or $60 2-Tin Bundle with Free 2-Day Air + Bonus 40g Host Tasting Sleeve."
        : "$32 Signature 400g Tin (18 Pieces + Batch Roast Card), or $60 2-Tin Host Bundle with Free 2-Day US Air Shipping.",
      truthStatus: "VERIFIED",
      truthLabel: "Verified First-Party Offer & Pricing",
      audienceFitExplanation:
        "Discerning dinner hosts, cultural gift buyers, and boutique executive gifters spending $32–$60 who value verified ingredient purity over cheap sugar-syrup bulk.",
      problemStatement:
        "Eliminates the embarrassment of gifting soggy, glucose-logged baklava or receiving crushed pastry from slow 5-day ground shipping.",
      deliverables: [
        "18 hand-layered pieces (10 Boz Pistachio Classic Baklava, 4 Crispy Burma Kadayif, 4 Midye Pistachio Mussels — 400g net weight)",
        "Reusable nitrogen-flushed lacquered steel gift tin with internal honeycomb piece divider tray",
        "Printed Batch Roast Card certifying oven roast date, Gaziantep harvest lot, and exact gram breakdown (152g pistachio / 96g syrup / 152g pastry)",
        "Complimentary embossed gift sleeve and custom printed host message card",
        ...(isV2
          ? [
              "NEW IN STRATEGY v2: Complimentary 40g 'Host Preview' 2-Piece Tasting Sleeve included with every $60 2-Tin Host Bundle + Free 2-Day Air Shipping",
            ]
          : ["2-Tin Host Bundle ($60 USD, save $4) includes Free 2-Day US Air Shipping"]),
      ],
      valueArchitecture: {
        primaryValueWedge: isV2
          ? "At $32 for 152g of real Boz pistachio ($0.21/g of pistachio), Zeytun delivers better real-nut value than KervanSaray's $25 promo box (~75g pistachio = $0.33/g) while adding a free 40g Host Tasting Sleeve on 2-tin orders."
          : "Combines 38% early-harvest Boz pistachio density, 100% sheep-milk clarified butter, and reusable luxury tin presentation at an accessible $32 gift price point ($60 for 2 tins with free 2-day air).",
      },
      proofRequirements: [
        "Macro cross-section cut-open video proving emerald pistachio density and zero pooled syrup",
        "Close-up of the Printed Batch Roast Card showing 38% Boz pistachio (152g) and oven date",
        "Explicit boundary disclosure: 10-day post-opening ambient crunch window; contains pistachio, wheat, and sheep-milk dairy",
      ],
      structuredObjections: [
        {
          status: "ADDRESSED",
          label: "Addressed via Verified Gram Math",
          underlyingConcern: "Price comparison against $25 400g promotional boxes",
          resolutionText: DEMO_OBJECTIONS[0].rebuttal,
        },
        {
          status: "ADDRESSED",
          label: "Addressed via Nitrogen Packaging & 2-Day Air",
          underlyingConcern: "Freshness and piece integrity during parcel transit",
          resolutionText: DEMO_OBJECTIONS[1].rebuttal,
        },
      ],
      heroOffer: isV2
        ? "400g Antep Pistachio Baklava & Kadayif Assortment Tin — $32 USD (18 Pieces + Batch Roast Card), or 2-Tin Host Bundle at $60 USD + Free 2-Day Air Shipping + Bonus 40g Unboxed Host Tasting Sleeve"
        : "400g Antep Pistachio Baklava & Kadayif Assortment Tin — $32 USD (18 Pieces + Complimentary Gift Message Card), or 2-Tin Host Bundle at $60 USD with Free 2-Day Air Shipping",
      price: "$32.00 USD (Single 400g Tin) / $60.00 USD (2-Tin Host Bundle)",
      valueStack: [
        "18 hand-layered pieces (10 Boz Pistachio Baklava, 4 Crispy Burma Kadayif, 4 Midye Pistachio Mussels — 400g net)",
        "Reusable nitrogen-flushed lacquered gift tin with honeycomb piece dividers",
        "Printed Batch Roast Card certifying 38% Boz pistachio weight & oven date",
        ...(isV2
          ? [
              "NEW IN v2: Complimentary 40g 'Host Preview' 2-Piece Tasting Sleeve on every $60 2-Tin Bundle so gift buyers can taste the crunch without breaking the gift tin seal",
            ]
          : ["Complimentary embossed gift sleeve and custom printed host message card"]),
      ],
      riskReversalAndBoundaries:
        "Intact-Arrival & Crunch Assurance: If honeycomb dividers shift or seal integrity is compromised in 2-day air transit, we dispatch a replacement tin immediately. Honest boundary: Enjoy within 10 days of opening seal; contains pistachio, wheat, and sheep-milk butter.",
    },
    awareness: {
      dominantStage: "PRODUCT_AWARE_AND_SOLUTION_AWARE",
      narrativeReframe: isV2
        ? "Stop judging 400g baklava boxes by total box weight—judge them by grams of real Boz Antep pistachio vs cheap glucose syrup."
        : "True artisanal baklava is defined by audible 40-layer crunch and emerald Boz pistachio aroma—not heavy, throat-burning sugar syrup.",
      currentBelief: isV2
        ? "A 400g baklava gift box for $25 is the same product as a $32 400g tin, just $7 cheaper."
        : "All shipped baklava arrives somewhat soggy and overly sweet because syrup is needed to keep it moist.",
      desiredBelief: isV2
        ? "A $25 400g box filled with 52% glucose syrup is mostly sugar water; Zeytun's $32 400g tin delivers 152g (38%) of real Boz pistachio and crisp clarified-butter layers."
        : "Heavy syrup is a mass-market cost-cutting trick to inflate weight; a 24% micro-brix infusion sealed in nitrogen keeps 40 phyllo layers crisp for 45 days sealed (10 days after opening).",
      mythBreakers: [
        {
          myth: "Heavier syrup at the bottom of the box means fresher, richer baklava.",
          reality:
            "Pooled bottom syrup is a sign of 50%+ glucose syrup used to cheaply pad a box to 400g while reducing expensive pistachio content.",
        },
        {
          myth: "Artisanal preservative-free baklava can sit open on a counter for a month without losing crunch.",
          reality:
            "Real sheep-milk clarified butter and crisp 40-layer phyllo stay fresh for 45 days while nitrogen-sealed, and should be enjoyed within 10 days once opened.",
        },
      ],
      entryFraming: isV2
        ? "Expose the '400g Syrup Weight Illusion' — show why two 400g boxes have completely different edible pistachio weights (152g vs 75g)."
        : "Sensory contrast between dry, crisp 38% Boz pistachio layers and soggy, glucose-soaked supermarket/mass-market trays.",
    },
    buyerConversionJourneys,
    funnel: {
      stages: [
        {
          stage: "1. Sensory & Math Hook (Top of Funnel — Instagram Reels & TikTok)",
          objective: isV2
            ? "Run 15-second scale & cross-section cut-open video comparing 152g Boz pistachio core in our $32 400g tin against syrup-heavy $25 promo boxes."
            : "Run 15-second macro ASMR knife-cut videos showing audible 40-layer crunch, zero pooled syrup, and emerald Boz pistachio cross-section.",
          kpiTarget: "CTR >= 2.1% · Thumbstop Rate >= 34%",
        },
        {
          stage: "2. Provenance & Nut-Ratio Education (Mid Funnel — Carousel & PDP)",
          objective: isV2
            ? "Interactive 400g Gram-Breakdown module on PDP (152g Pistachio / 152g Clarified-Butter Pastry / 96g Light Beet Syrup) + Batch Roast Card preview."
            : "5-slide Instagram Carousel & PDP breakdown of the 18 pieces inside the 400g tin, clarified butter vs palm oil, and 10-day post-opening freshness boundary.",
          kpiTarget: "PDP-to-Cart Rate >= 9.5%",
        },
        {
          stage: "3. Gift Bundle Conversion (Bottom of Funnel — Search & Retargeting)",
          objective: isV2
            ? "Convert single-tin shoppers into the $60 2-Tin Host Bundle using Free 2-Day Air Shipping + the new 40g Host Preview Tasting Sleeve."
            : "Convert high-intent gift buyers via $32 single tin or $60 2-Tin Host Bundle with Free 2-Day Air Shipping.",
          kpiTarget: "Checkout Conversion >= 3.6% · Blended CPA <= $24 USD",
        },
      ],
    },
    persuasion: {
      primaryAngle: isV2
        ? "Transparent Ingredient Math (Pay for 38% Boz Pistachio, Not 52% Sugar Syrup)"
        : "Sensory Proof & Batch Transparency (Audible Crunch + Printed Roast Card)",
      proofAssets: [
        "Macro cross-section cut-open video with live audio of 40-layer phyllo crunch",
        "Close-up of Printed Batch Roast Card showing 38% Boz pistachio (152g) and oven date",
        "Nitrogen-flushed tin seal peel + honeycomb divider unboxing clip",
      ],
    },
    contentDistribution: {
      rationale:
        "Allocate 85% of monthly budget to high-visual-proof video and carousel channels (Instagram & TikTok) where buyers can inspect the 38% emerald pistachio cross-section and hear the 40-layer crunch, paired with 15% high-intent Google Search & retargeting.",
      channels: [
        {
          channel: "Instagram Reels & 4:5 Carousels",
          role: "Primary Discovery, Gift Tin Unboxing & Gram-Ratio Carousel Proof (60% Budget — $2,700/mo)",
          tier: "PRIMARY",
        },
        {
          channel: "TikTok Short-Form Video",
          role: "Sensory ASMR Knife-Cut Crunch & 400g Scale Comparison (25% Budget — $1,125/mo)",
          tier: "PRIMARY",
        },
        {
          channel: "Google High-Intent Search & Meta Retargeting",
          role: "Bottom-of-Funnel Gift Box Demand Capture & 2-Tin Bundle Conversion (15% Budget — $675/mo)",
          tier: "SECONDARY",
        },
      ],
    },
    channelSelection: {
      primaryChannels: [
        {
          channel: "Instagram Reels & 4:5 Carousels",
          role: "Primary Discovery & Visual Gifting Proof (60% Budget — $2,700/mo)",
          rationale:
            "Highest visual resonance for unboxing ritual, emerald pistachio cross-sections, and dinner-host gifting carousels.",
        },
        {
          channel: "TikTok Short-Form Video",
          role: "Sensory ASMR Crunch & Nut-to-Syrup Comparison (25% Budget — $1,125/mo)",
          rationale:
            "Outperforms static ads on sensory food proof and transparent ingredient-math storytelling.",
        },
        {
          channel: "Google High-Intent Search & Meta Retargeting",
          role: "Bottom-of-Funnel Gift Box Capture (15% Budget — $675/mo)",
          rationale:
            "Captures active buyers searching 'pistachio baklava gift box', 'turkish baklava tin US delivery', and cart visitors.",
        },
      ],
    },
    budgetGovernor: {
      status: "GOVERNED_ALLOCATION",
      monthlyBudget: 4500,
      totalMonthlyBudget: 4500,
      currency: "USD",
      overallRationale:
        "Disciplined $4,500/month allocation anchored to a $46.50 blended AOV ($32 single 400g tin / $60 2-tin bundle) with a target blended CPA of $21–$24 USD.",
      allocations: [
        {
          channel: "Instagram Reels & Carousels",
          monthlyUsd: 2700,
          sharePercent: 60,
          sharePercentage: 60,
          allocatedAmount: 2700,
          rationale:
            "Drives core discovery and mid-funnel proof via 400g tin unboxing Reels and 5-slide ingredient math carousels.",
        },
        {
          channel: "TikTok Short-Form Proof",
          monthlyUsd: 1125,
          sharePercent: 25,
          sharePercentage: 25,
          allocatedAmount: 1125,
          rationale:
            "Captures sensory food buyers via ASMR knife-cut crunch tests and 152g pistachio vs syrup-weight comparisons.",
        },
        {
          channel: "Google Search & BOFU Retargeting",
          monthlyUsd: 675,
          sharePercent: 15,
          sharePercentage: 15,
          allocatedAmount: 675,
          rationale:
            "Converts high-intent gift searchers and PDP visitors into $32 single tins and $60 2-Tin Host Bundles.",
        },
      ],
      guardrails: [
        "Max target CPA: $24.00 USD on $32 single-tin / $60 2-tin bundle blended AOV ($46.50 USD)",
        "Pause any ad set exceeding $34.00 CPA after $120 spend without checkout initiation",
        "Reserve 20% of Meta budget ($540/mo) for 2-Tin Bundle retargeting with Host Tasting Sleeve hook",
      ],
    },
    rootBundle: {
      bundleVersion: version,
      spine: {
        positioning: brandSpine.corePositioningStatement,
      },
      lanes: approvedLanes,
    },
  };
}

export const DEMO_MI_SNAPSHOT_DATA = {
  marketState: "VALUE_PRESSURE_AND_SPECIFICATION_GAP",
  opportunitySignals: [
    "38% Boz Pistachio Weight Transparency: None of the 3 monitored competitors disclose exact pistachio gram weight vs syrup weight on their 400g product pages.",
    "Domestic 2-Day Air Nitrogen Tin Fulfillment: Eliminates both the 5-day ground sogginess seen in domestic competitors and the $18 international freight + customs delays of Istanbul exporters.",
    "Macro Cross-Section Cut-Open Video: Customer voice confirms audible 40-layer crunch + emerald cross-section video is the #1 conversion trigger for $30–$60 gift buyers.",
  ],
  threatSignals: [
    "KervanSaray Baklava 400g 'Bazaar Value Box' ($25 USD promo vs $32 USD standard tin) anchors price-sensitive shoppers on '400g for $25' unless countered with nut-to-syrup gram math.",
    "AltınFıstık Confections ($36 USD gold-foil box) competes aggressively on formal corporate gifting keywords despite slower 5-day ground shipping.",
  ],
  marketDiagnosis:
    "The US artisanal baklava & Levantine pastry gifting category ($25–$36 per 400g box) is polarized between heavy-syrup domestic volume sellers (KervanSaray Baklava) and high-shipping-cost international heritage brands (Şerbetçi Han Gifting). Zeytun Atelier owns the high-trust middle ground at $32 USD by proving 38% Boz pistachio weight (152g), 100% sheep-milk clarified butter, and 2-day US air delivery in nitrogen-flushed tins.",
};

export const DEMO_POSITIONING_SNAPSHOT_DATA = {
  territory: "Verified Nut-Weight & Micro-Brix Artisanal Confectionery Atelier",
  contrastAxis:
    "38% Early-Harvest Boz Pistachio & 24% Micro-Brix Crunch vs. 50%+ Glucose-Syrup Mass-Market Gift Trays",
  narrativeDirection:
    "For discerning dinner hosts and gift buyers who refuse syrup-logged mass-market baklava, Zeytun Atelier crafts the 400g Antep Pistachio & Kadayif Assortment Tin ($32 USD) with 38% early-harvest Boz pistachio, 100% clarified sheep-milk butter, and a 24% low-brix syrup ratio sealed in nitrogen-flushed gift tins.",
  strategyCards: [
    {
      id: "pos_card_01",
      title: "The 38% Boz Pistachio / 24% Micro-Brix Standard",
      subtitle: "Ingredient Math That Disarms Cheap Syrup Boxes",
      rationale:
        "Turns a hidden formulation advantage (152g of Boz pistachio per 400g tin) into an immediate visual and numerical buying criterion.",
    },
    {
      id: "pos_card_02",
      title: "Table-Ready Nitrogen Gift Tin with Batch Roast Card",
      subtitle: "Provenance & Crunch Delivered in 48 Hours",
      rationale:
        "Addresses gift-giver anxiety with a reusable lacquered steel tin, internal honeycomb divider, and printed batch roast card.",
    },
  ],
  territories: [
    {
      id: "terr_demo_01",
      name: "Micro-Brix & Verified Nut-Weight Atelier",
      status: "SELECTED",
      score: 0.92,
    },
  ],
};

export const DEMO_MECHANISM_SNAPSHOT_DATA = {
  name: "Dry-Roast & Micro-Brix Infusion Protocol (38% Boz Pistachio / 24% Syrup Ratio)",
  mechanismName: "Dry-Roast & Micro-Brix Infusion Protocol (38% Boz Pistachio / 24% Syrup Ratio)",
  description:
    "Stone-baking 40 micro-thin phyllo layers with 100% clarified sheep-milk butter, packing 38% early-harvest Boz Antep pistachios by weight (152g per 400g tin), infusing a 24% light beet-sugar syrup at calibrated temperature, and nitrogen-flushing each lacquered steel tin prior to 2-day air dispatch.",
  steps: [
    "40-Layer Clarified-Butter Stone Bake (0.08mm phyllo & crispy burma kadayif)",
    "38% Early-Harvest Boz Pistachio Core (152g whole & coarse-chopped nut meat per 400g tin)",
    "24% Micro-Brix Beet-Sugar Infusion (zero glucose syrup, zero bottom pooling)",
    "Nitrogen-Flushed Honeycomb Tin & 2-Day Air Dispatch with Printed Batch Roast Card",
  ],
};

export const DEMO_WATCHTOWER_EVENT_EVIDENCE = {
  notes: [
    "KervanSaray Baklava introduced a new 400g 'Bazaar Value Assortment Gift Box' at $25.00 USD (22% below their $32.00 USD Classic 400g Tin and Zeytun Atelier's $32.00 USD 400g Tin), promoted via Instagram Reels with the hook: 'Why pay $32+ for a 400g pistachio baklava box when ours is $25?'",
    "Catalog specification diff reveals the $25.00 USD 400g box reduces pistachio content to ~19% (~75g), blends walnut and roasted peanut pieces, and increases glucose-syrup glaze to 52% of total box weight (208g sugar syrup per 400g box).",
    "Customer review telemetry (ev_mv_kervan_01, ev_mv_kervan_02) corroborates pooled bottom syrup and soggy lower phyllo layers in KervanSaray's value-tier boxes.",
  ],
  prev: "$32.00 USD — KervanSaray 400g Classic Pistachio & Walnut Tin (30% nut weight, metal tin)",
  curr: "$25.00 USD — KervanSaray 400g Bazaar Value Assortment Box (-22% price undercut; 52% glucose syrup weight, blended walnut/peanut filling in paperboard box)",
  beforeState:
    "KervanSaray Baklava priced its hero 400g Classic Assortment Tin at $32.00 USD (matching Zeytun Atelier's $32.00 USD 400g tin) with standard holiday gift messaging.",
  afterState:
    "KervanSaray Baklava launched a $25.00 USD 400g 'Bazaar Value Gift Box' (-22% price cut) backed by paid Instagram Reels explicitly challenging $32+ 400g boxes, achieved by using 52% glucose-syrup weight (~208g syrup) and only ~75g actual pistachio.",
  sampleSize: 12,
};

export const DEMO_WATCHTOWER_STRATEGIC_BRIEF = {
  executiveSummary:
    "Direct competitor KervanSaray Baklava launched a $25.00 USD 400g 'Bazaar Value Assortment Box' (a 22% price undercut against our $32.00 USD 400g tin) and is running comparative Instagram Reels asking 'Why pay $32+ for a 400g baklava box?' Catalog and review evidence shows the $25 price is achieved by inflating box weight with 52% glucose syrup (208g sugar syrup) and cutting actual pistachio content to ~75g.",
  strategicInterpretation:
    "KervanSaray is attempting a classic 'nominal pack-weight anchor'—making all 400g boxes appear interchangeable on weight so our $32 USD tin looks $7 overpriced to first-time gift shoppers who haven't seen inside the tin.",
  marketSignificance:
    "High impact on Top-of-Funnel discovery and PDP price comparison in Lane 1 (Dinner-Host & Cultural Occasion Gifting). If unaddressed, first-time shoppers comparing '400g vs 400g' may defect to the $25 promo box without realizing they are buying 52% sugar syrup.",
  directionOfMovement:
    "Down-market promotional discounting (-22% unit price) paired with ingredient dilution (52% glucose syrup weight + peanut/walnut substitution).",
  likelyStrategicObjective:
    "Capture price-sensitive Q4/holiday 400g gift box searchers and compress customer acquisition cost on Instagram Reels using a $25 price hook.",
  impactOnOurStrategy:
    "Affects our DIFFERENTIATION and OFFER assumptions in Lane 1 (Dinner-Host & Cultural Occasion Gifting — $32 Tin). Does NOT require cutting our $32 price—cutting price would destroy margin and violate our 38% Boz pistachio / 100% sheep-milk butter product truth. Instead, we must make the gram-for-gram pistachio math explicit in our creative and offer framing.",
  recommendation:
    "Update Differentiation and Offer framing for Lane 1 (Strategy v1 → v2): (1) Lead Reels and PDP gallery with '152g Real Boz Pistachio vs 208g Glucose Syrup' cut-open scale proof; (2) Keep single 400g tin at $32 USD; (3) Add a complimentary 40g 'Host Preview' 2-Piece Tasting Sleeve to the $60 2-Tin Host Bundle so gift buyers get tangible added value without discounting core tin price.",
  assumptions: [
    "Assumption Affected (Differentiation): Stating '38% Boz pistachio & low syrup' in body copy is sufficient without a direct visual gram-comparison against $25 400g promo boxes.",
    "Assumption Affected (Offer): The $60 2-Tin Bundle with Free 2-Day Air alone is enough to neutralize a $25 single-box competitor hook.",
    "Assumption Preserved (Pricing & Product Truth): Discerning hosts will happily pay $32 ($7 more) once shown that Zeytun delivers 2x the real Boz pistachio weight (152g vs ~75g) and zero pooled glucose syrup.",
  ],
  missingEvidence: [
    "Exact repeat-purchase retention rate of buyers who tried KervanSaray's $25 Bazaar Value Box (early Reddit/Trustpilot reviews already show negative sentiment on syrup heaviness).",
  ],
  claims: [
    {
      claim: "KervanSaray cut 400g entry pricing from $32 USD to $25 USD (-22%) via the Bazaar Value Box.",
      evidenceIds: ["ev_wt_kervan_diff_01", "ev_web_kervan_01"],
      confidence: 0.96,
    },
    {
      claim: "Customer reviews confirm KervanSaray's value boxes rely on heavy pooled glucose syrup and diluted nut ratios.",
      evidenceIds: ["ev_mv_kervan_01", "ev_mv_kervan_02"],
      confidence: 0.91,
    },
  ],
};

export const DEMO_REASONING_HYPOTHESES = [
  {
    id: "rhyp_demo_kervan_01",
    hypothesisType: "COMPETITOR_PRICE_ANCHOR_SHIFT",
    explanation:
      "PRIMARY VALIDATED HYPOTHESIS: KervanSaray Baklava's $25 400g 'Bazaar Value Box' creates superficial price resistance on our $32 400g tin among first-time shoppers who assume all 400g boxes contain the same amount of pistachio. Exposing the exact gram math (152g Boz pistachio in Zeytun vs ~75g nut / 208g glucose syrup in the $25 box) plus adding a 40g Host Preview Tasting Sleeve on $60 2-tin bundles will neutralize the $25 hook without cutting our $32 price.",
    status: "VALIDATED",
    confidence: 0.92,
    supportingEvidenceIds: [
      "ev_wt_kervan_diff_01",
      "ev_mv_kervan_01",
      "ev_mv_kervan_02",
      "pf_cap_01",
    ],
    contradictingEvidenceIds: [],
  },
  {
    id: "rhyp_demo_kervan_02",
    hypothesisType: "BROAD_CATEGORY_DEMAND_CONTRACTION",
    explanation:
      "ALTERNATIVE HYPOTHESIS (REJECTED): Premium buyers are trading down across the entire confectionery category and refuse to pay $32+ for 400g gift tins. Contradicted by strong repeat conversion on our $60 2-Tin Host Bundle and high engagement on Şerbetçi Han's $47 landed-cost cross-section videos.",
    status: "REJECTED",
    confidence: 0.24,
    supportingEvidenceIds: [],
    contradictingEvidenceIds: ["ev_mv_serbet_02", "ev_mv_altin_02"],
  },
];

export const DEMO_PROPOSAL_SUMMARY = {
  summary:
    "Counter KervanSaray's $25 400g 'Bazaar Value Box' by updating Differentiation & Offer framing in Lane 1: spotlight '152g Real Boz Pistachio vs $25 Syrup Weight' proof and add a complimentary 40g Host Tasting Sleeve to the $60 2-Tin Bundle while holding our $32 unit price.",
  whyNow:
    "Watchtower confirmed KervanSaray Baklava launched a $25.00 USD 400g promo box (-22% vs our $32.00 USD 400g tin) and is running Instagram Reels directly challenging $32+ 400g boxes. At the same time, Performance Loop detected mild PDP-to-cart hesitation among first-time cold traffic comparing 400g prices.",
  evidenceSummary:
    "Grounded in Watchtower event pce_demo_kervansaray_pricing_001 (KervanSaray $32 → $25 400g Bazaar Box diff), customer voice records ev_mv_kervan_01 & ev_mv_kervan_02 (complaints of 50%+ pooled glucose syrup in KervanSaray tins), and Zeytun verified capability pf_cap_01 (152g / 38% Boz pistachio weight).",
  expectedImpact:
    "Reevaluates DIFFERENTIATION and OFFER for Lane 1 (Dinner-Host & Cultural Occasion Gifting) and refreshes What To Do Today execution tasks. Preserves Lane 2 (Boutique Executive Gifting), core $32/$60 pricing, and $4,500/mo budget guardrails.",
};

export function buildDemoPerformanceContext(version: 1 | 2) {
  const isV2 = version === 2;
  return {
    id: isV2 ? DEMO_IDS.perfContextIdV2 : DEMO_IDS.perfContextIdV1,
    mode: "OPTIMIZE",
    currentReality: isV2
      ? "SIMULATED FOLLOW-UP OBSERVATION (Days 1–14 Post-Adaptation, Strategy v2 Active): After deploying the '152g Boz Pistachio vs $25 Syrup Box' cut-open Reel and adding the 40g Host Preview Tasting Sleeve to the $60 2-Tin Bundle on Oct 15, simulated PDP-to-cart progression recovered from 6.8% to 10.4% (+3.6 pp observed) and 2-Tin Bundle share rose from 31% to 44% of orders ($48.20 blended AOV, $21.40 simulated CPA). Note: Simulated telemetry for product demonstration; observed lift reflects post-action window correlation, not isolated causal proof."
      : "SIMULATED BASELINE OBSERVATION (Strategy v1 Window, Oct 1–Oct 14): Top-of-funnel ASMR crunch Reels achieved a strong 2.4% CTR, but cold-traffic PDP-to-cart rate dipped from 9.6% to 6.8% following KervanSaray's $25 400g Bazaar Box ad launch on Oct 12.",
    primaryBottleneck: isV2 ? "NONE" : "OFFER_FRICTION",
    weakestSignals: isV2
      ? []
      : [
          "First-time cold visitors comparing nominal '400g for $32' against KervanSaray's '$25 for 400g' promo ads without seeing the 152g vs 75g pistachio gram breakdown above the fold.",
        ],
    proofGaps: isV2
      ? [
          "Continue collecting 30-day repeat-order telemetry on recipients of the new 40g Host Preview Tasting Sleeve.",
        ]
      : [
          "PDP hero gallery lacks a side-by-side 400g gram breakdown graphic (152g Boz pistachio vs 52% glucose syrup in $25 promo boxes).",
        ],
    strongestSignals: isV2
      ? [
          "SIMULATED: Cut-Open Gram-Math Reel ('152g Real Pistachio vs 208g Sugar Water') — 2.85% CTR, 39% 3-second thumbstop rate",
          "SIMULATED: $60 2-Tin Host Bundle + 40g Tasting Sleeve — 44% bundle take-rate (up from 31% pre-adaptation)",
          "SIMULATED: Blended CPA improved from $26.80 (Oct 12–14 dip) to $21.40 across $4,500/mo governed budget pace",
        ]
      : [
          "SIMULATED: 40-Layer ASMR Knife-Cut Reel — 2.40% CTR on Instagram Reels & TikTok",
          "SIMULATED: 2-Day Air Intact-Tin Delivery SLA — 99.1% intact arrival rate across domestic US shipments",
        ],
    activeChannels: [
      { channel: "INSTAGRAM", status: "WINNING" },
      { channel: "TIKTOK", status: "WINNING" },
      { channel: "GOOGLE_SEARCH", status: "WINNING" },
    ],
    recentTrend: isV2 ? "IMPROVING" : "STABLE_WITH_COMPETITOR_PRICE_PRESSURE",
    confidence: "HIGH",
    freshness: "FRESH",
    evidenceRefIds: [
      "ev_wt_kervan_diff_01",
      "ev_mv_kervan_01",
      "ev_mv_kervan_02",
      "pf_cap_01",
    ],
  };
}

export function buildDemoExecutionTasks(version: 1 | 2) {
  const isV2 = version === 2;
  return [
    {
      id: isV2 ? "task_demo_v2_01" : "task_demo_v1_01",
      taskId: isV2 ? "task_demo_v2_01" : "task_demo_v1_01",
      title: isV2
        ? "[Strategy v2 Response] Publish 15s '152g Boz Pistachio vs $25 Syrup Box' Scale & Cut-Open Reel"
        : "Film & Publish 15s Macro Knife-Cut ASMR Reel (38% Boz Pistachio & 40-Layer Crunch)",
      description: isV2
        ? "Place two 400g portions on a digital kitchen scale: show how KervanSaray's $25 promo box relies on 208g (52%) pooled glucose syrup, then slice open Zeytun Atelier's $32 400g tin to reveal 152g (38%) whole emerald Boz pistachios and dry, crisp bottom phyllo layers."
        : "Capture a tight 4:5 macro video slicing through the 18-piece 400g Assortment Tin with live audio of the 40-layer clarified-butter crunch and a close-up of the Printed Batch Roast Card.",
      channel: "instagram",
      platform: "Instagram Reels & TikTok",
      taskType: "CREATIVE_PRODUCTION",
      priority: "P0",
      status: isV2 ? "COMPLETED" : "READY",
      estimatedMinutes: 45,
      laneId: DEMO_IDS.lanes.gifting,
      laneTitle: "Lane 1 · Dinner-Host & Cultural Occasion Gifting (400g Signature Tin — $32 USD)",
      whyItMatters: isV2
        ? "Directly neutralizes KervanSaray Baklava's '$25 for 400g' price anchor by proving Zeytun delivers 2x the real pistachio weight per dollar."
        : "Directly addresses #1 customer pain (soggy, syrup-logged 400g gift boxes) with undeniable visual and auditory proof.",
      productionBlueprint: {
        hook: isV2
          ? "Before you buy a '$25 400g baklava gift box,' put the syrup on a scale."
          : "Listen to 40 layers of sheep-milk clarified butter and 38% emerald Boz pistachio—zero pooled sugar syrup.",
        scriptOutline: [
          "0–3s (Hook): Digital scale close-up + knife slicing through a crisp Zeytun pistachio baklava piece with loud crunch audio.",
          isV2
            ? "3–9s (Contrast): Show 152g of whole emerald Boz Antep pistachios next to a beaker of 96g light beet syrup vs 208g thick glucose syrup in $25 value boxes."
            : "3–9s (Mechanism): Peel back the nitrogen-flushed tin seal, lift the honeycomb divider tray, and show the dry bottom of the tin.",
          "9–15s (Offer CTA): Show the Printed Batch Roast Card + $32 Single 400g Tin / $60 2-Tin Host Bundle with Free 2-Day US Air.",
        ],
        guardrails: [
          "Strictly state 10-day post-opening ambient crunch window (never claim preservative-free baklava lasts months once opened).",
          "Include tree-nut (pistachio), wheat gluten, and sheep-milk dairy disclosure in caption/PDP specs.",
        ],
      },
    },
    {
      id: isV2 ? "task_demo_v2_02" : "task_demo_v1_02",
      taskId: isV2 ? "task_demo_v2_02" : "task_demo_v1_02",
      title: isV2
        ? "[Strategy v2 Offer Update] Activate '40g Host Preview Tasting Sleeve' on $60 2-Tin Bundle PDP"
        : "Deploy 5-Slide 'Inside the 400g Nitrogen Gift Tin' Carousel for Dinner Hosts",
      description: isV2
        ? "Update the 400g Assortment PDP above-the-fold selector to highlight the complimentary 40g (2-piece) Host Preview Tasting Sleeve on every $60 2-Tin Host Bundle + the 152g Pistachio Gram-Breakdown graphic."
        : "Publish a 5-slide Instagram Carousel showing: (1) Lacquered steel gift tin, (2) 18-piece assortment map, (3) 38% Boz pistachio vs 24% syrup ratio, (4) Honeycomb transit protection, (5) 2-day air delivery.",
      channel: "website_and_instagram",
      platform: "PDP & Instagram Carousel",
      taskType: "CONVERSION_OPTIMIZATION",
      priority: "P1",
      status: isV2 ? "COMPLETED" : "READY",
      estimatedMinutes: 30,
      laneId: DEMO_IDS.lanes.gifting,
      laneTitle: "Lane 1 · Dinner-Host & Cultural Occasion Gifting (400g Signature Tin — $32 USD)",
      whyItMatters: isV2
        ? "Increases 2-Tin Bundle take-rate from 31% to 44% (simulated) and solves the gift buyer's desire to taste the pastry without breaking the gift tin's nitrogen seal."
        : "Converts mid-funnel gift shoppers who need reassurance on packaging presentation and transit safety.",
      productionBlueprint: {
        hook: isV2
          ? "Gift two sealed 400g tins ($60)—and unbox your own complimentary 40g Boz Pistachio Tasting Sleeve immediately."
          : "What makes a $32 400g baklava tin worthy of the center of the dinner table?",
        scriptOutline: [
          "Slide 1 / Hero Module: Side-by-side 400g Gram Breakdown (152g Boz Pistachio · 152g Clarified-Butter Phyllo & Kadayif · 96g Light Beet Syrup).",
          "Slide 2 / Bundle Module: $32 Single 400g Tin vs $60 2-Tin Host Bundle (+ Free 2-Day Air + Bonus 40g Host Preview Sleeve).",
          "Slide 3 / Trust Card: Printed Batch Roast Card + Intact-Arrival Replacement Assurance.",
        ],
        guardrails: [
          "Maintain $32.00 USD single-tin price; do not discount single tins to match $25 glucose-syrup boxes.",
        ],
      },
    },
    {
      id: isV2 ? "task_demo_v2_03" : "task_demo_v1_03",
      taskId: isV2 ? "task_demo_v2_03" : "task_demo_v1_03",
      title: "Run Executive 4-Tin Appreciation Pack ($118 USD) Retargeting & Search Capture",
      description:
        "Maintain $675/mo (15% budget) on high-intent search ('pistachio baklava gift tin US delivery') and executive gifting retargeting highlighting 2-day air dispatch and custom gift note cards.",
      channel: "google_search",
      platform: "Google Search & Meta Retargeting",
      taskType: "PAID_ACQUISITION",
      priority: "P1",
      status: isV2 ? "COMPLETED" : "READY",
      estimatedMinutes: 25,
      laneId: DEMO_IDS.lanes.hosting,
      laneTitle: "Lane 2 · Boutique Executive & Client Appreciation Gifting (Multi-Tin Bundles)",
      whyItMatters:
        "Captures bottom-of-funnel gift buyers with high AOV ($60–$118) while respecting the $24.00 max target CPA guardrail.",
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
    },
  ];
}

export function buildDemoMonthlyReportPayload(version: 1 | 2) {
  const isV2 = version === 2;
  return {
    periodLabel: "October 2026 (Simulated Demo Observation Window)",
    isFinalized: false,
    simulatedDisclosure:
      "SIMULATED DEMO TELEMETRY: All performance figures in this report are synthetic observations generated for the Zeytun Atelier 400g Assortment demonstration. Observed post-adaptation shifts reflect timeline correlation (Oct 15–Oct 28 vs Oct 1–Oct 14) and are explicitly distinguished from isolated causal proof.",
    executiveSummary: {
      headline: isV2
        ? "Simulated Follow-Up (Oct 1–Oct 28, 2026): Strategy v2 Counter-Positioning Reversed Competitor $25 Promo Pressure and Lifted 2-Tin Bundle Share to 44%"
        : "Baseline Execution Window (Oct 1–Oct 14, 2026): Strategy v1 Established Strong 2.4% Sensory Reel CTR Across $4,500/mo Budget",
      narrative: isV2
        ? "TIMELINE & CAUSAL NOTE (Simulated Demo Data): From Oct 1 to Oct 11 under Strategy v1, Zeytun Atelier's 400g Assortment Tin ($32 USD) paced on target at $22.10 CPA. On Oct 12–14, Watchtower detected and confirmed competitor KervanSaray Baklava launching a $25 400g 'Bazaar Value Box' (-22%), coinciding with a dip in our cold-traffic PDP-to-cart rate (from 9.6% to 6.8%). On Oct 15, the user approved Strategy v2—preserving our $32 price while deploying '152g Real Boz Pistachio vs 208g Glucose Syrup' creative proof and adding a complimentary 40g Host Preview Tasting Sleeve to the $60 2-Tin Bundle. Over the subsequent 14-day simulated observation window (Oct 15–Oct 28), PDP-to-cart progression recovered to 10.4% and blended CPA improved to $21.40. Note: While correlated with the Oct 15 Strategy v2 rollout, observed metrics represent simulated correlation rather than isolated causal proof."
        : "SIMULATED DEMO DATA: Strategy v1 is active for the Antep Pistachio Baklava & Kadayif Assortment Box (400g, $32 USD). Initial execution across Instagram Reels (60% budget), TikTok (25% budget), and Google Search/Retargeting (15% budget) validates strong sensory hook engagement.",
      keyHighlights: isV2
        ? [
            "[SIMULATED OBSERVATION · Oct 15–28] PDP-to-Cart progression rose from 6.8% (during Oct 12–14 competitor promo dip) to 10.4% (+3.6 pp observed) after publishing the 400g Nut-to-Syrup Gram Breakdown.",
            "[SIMULATED OBSERVATION · Oct 15–28] $60 2-Tin Host Bundle take-rate increased from 31% to 44% of total orders following addition of the 40g Host Preview Tasting Sleeve, lifting blended AOV to $48.20 USD.",
            "[SIMULATED OBSERVATION · Oct 1–28] Blended CPA averaged $21.40 USD post-adaptation (7% better than the $23.00 plan target) while holding single-tin price steady at $32.00 USD.",
          ]
        : [
            "[SIMULATED OBSERVATION · Oct 1–14] 40-Layer ASMR Knife-Cut Reels achieved 2.40% CTR (vs 2.10% target) and 34% 3-second thumbstop rate.",
            "[SIMULATED OBSERVATION · Oct 1–14] 99.1% intact-piece arrival across 2-day air nitrogen-flushed tin shipments.",
          ],
      keyChallenges: isV2
        ? [
            "Competitor KervanSaray Baklava continues running '$25 400g Bazaar Box' ads on broad keywords, requiring ongoing gram-ratio education for first-time cold traffic.",
            "Humid-zone shipments (Florida / Gulf Coast) require strict adherence to the 2-day air shipping guardrail.",
          ]
        : [
            "Cold-traffic PDP-to-cart rate softened from 9.6% to 6.8% between Oct 12 and Oct 14 as KervanSaray Baklava launched its $25 400g promotional box.",
          ],
      strategicStateSummary: isV2
        ? "Strategy v2 (Active since Oct 15, 2026) — Lane 1 Differentiation & Offer updated; Lane 2 preserved."
        : "Strategy v1 (Baseline Active since Oct 1, 2026).",
    },
    performanceVsPlan: {
      dataCoverage: "COMPLETE",
      dataCoverageReason:
        "Simulated Demo Telemetry (Labeled Synthetic Observation Window — Oct 1 to Oct 28, 2026)",
      kpis: [
        {
          name: "Short-Form Proof CTR (Reels & TikTok) [Simulated]",
          metricKey: "ctr_short_form",
          planTarget: 2.1,
          actual: isV2 ? 2.85 : 2.4,
          unit: "%",
          variancePercent: isV2 ? 35.7 : 14.3,
          status: "ABOVE_PLAN",
          interpretation: isV2
            ? "Simulated observation (Oct 15–28): '152g Boz Pistachio vs $25 Syrup Weight' cut-open Reel outperformed the 2.1% plan benchmark by +35.7%."
            : "Simulated observation (Oct 1–14): Macro ASMR crunch Reel exceeded initial 2.1% CTR benchmark.",
        },
        {
          name: "PDP-to-Cart Progression Rate [Simulated]",
          metricKey: "pdp_to_cart",
          planTarget: 9.5,
          actual: isV2 ? 10.4 : 6.8,
          unit: "%",
          variancePercent: isV2 ? 9.5 : -28.4,
          status: isV2 ? "ABOVE_PLAN" : "BELOW_PLAN",
          interpretation: isV2
            ? "Simulated observation: Recovered from 6.8% (Oct 12–14 dip) to 10.4% after adding the 400g Gram-Breakdown module and 40g Host Preview Sleeve on Oct 15 (observed correlation, not causal proof)."
            : "Simulated observation: Dipped below the 9.5% plan target during Oct 12–14 following competitor $25 400g promo launch.",
        },
        {
          name: "Blended Customer Acquisition Cost (CPA) [Simulated]",
          metricKey: "blended_cpa",
          planTarget: 23.0,
          actual: isV2 ? 21.4 : 25.2,
          unit: "USD",
          variancePercent: isV2 ? -7.0 : 9.6,
          status: isV2 ? "ABOVE_PLAN" : "BELOW_PLAN",
          interpretation: isV2
            ? "Simulated observation: Post-adaptation CPA of $21.40 USD beat the $23.00 USD target while preserving our $32 single-tin / $60 2-tin pricing."
            : "Simulated observation: Temporary CPA elevation to $25.20 USD due to mid-funnel price comparison friction.",
        },
        {
          name: "Blended Average Order Value (AOV) [Simulated]",
          metricKey: "blended_aov",
          planTarget: 46.5,
          actual: isV2 ? 48.2 : 43.1,
          unit: "USD",
          variancePercent: isV2 ? 3.7 : -7.3,
          status: isV2 ? "ABOVE_PLAN" : "BELOW_PLAN",
          interpretation: isV2
            ? "Simulated observation: 44% of buyers selected the $60 2-Tin Host Bundle once the 40g Host Preview Tasting Sleeve was included."
            : "Simulated observation: 31% 2-tin bundle share prior to Strategy v2 offer enhancement.",
        },
      ],
      channelPerformance: [
        {
          channel: "Instagram Reels & 4:5 Carousels (60% Budget — $2,700/mo)",
          impressions: isV2 ? 148200 : 74000,
          clicks: isV2 ? 4290 : 1780,
          spend: isV2 ? 2480 : 1260,
          conversions: isV2 ? 116 : 49,
          notes: "Simulated telemetry: Primary driver of 400g tin discovery and 2-Tin Host Bundle orders.",
        },
        {
          channel: "TikTok Short-Form Proof (25% Budget — $1,125/mo)",
          impressions: isV2 ? 89500 : 44200,
          clicks: isV2 ? 2510 : 1060,
          spend: isV2 ? 1030 : 520,
          conversions: isV2 ? 46 : 19,
          notes: "Simulated telemetry: High thumbstop rate on ASMR crunch and scale comparison clips.",
        },
        {
          channel: "Google Search & Meta Retargeting (15% Budget — $675/mo)",
          impressions: isV2 ? 21400 : 10800,
          clicks: isV2 ? 980 : 490,
          spend: isV2 ? 620 : 310,
          conversions: isV2 ? 31 : 15,
          notes: "Simulated telemetry: Captures high-intent gift box searchers and cart visitors.",
        },
      ],
      warningsSummary: [
        {
          warningClass: "OFFER_FRICTION",
          severity: "HIGH",
          status: isV2 ? "RESOLVED_POST_ADAPTATION" : "ACTIVE",
          description:
            "Cold-traffic PDP-to-cart friction observed Oct 12–14 when KervanSaray Baklava launched its $25 400g Bazaar Value Box.",
          occurredAt: "2026-10-14",
        },
      ],
    },
    marketAndWatchtower: {
      confirmedEventsCount: 1,
      underReviewCandidatesCount: 0,
      confirmedEvents: [
        {
          id: DEMO_IDS.watchtowerEventId,
          competitorId: DEMO_IDS.competitors.kervansaray,
          competitorName: "KervanSaray Baklava",
          kind: "pricing_change",
          label: "Pricing strategy shift — 400g Bazaar Value Assortment Box ($25 USD vs $32 USD)",
          severity: "major",
          firstObservedAt: "2026-10-12",
          confirmedAt: "2026-10-14",
          oldValue: "$32.00 USD (400g Classic Pistachio & Walnut Tin)",
          newValue: "$25.00 USD (400g Bazaar Value Box — 52% glucose syrup weight, ~75g pistachio)",
          evidenceNotes: DEMO_WATCHTOWER_EVENT_EVIDENCE.notes,
          whyItMattered:
            "Created a nominal '$25 vs $32 for 400g' price comparison in Lane 1 until Zeytun Atelier exposed the 152g vs 75g pistachio weight difference.",
        },
      ],
      underReviewCandidates: [],
      marketShiftAnalysis:
        "On Oct 12 (confirmed Oct 14), KervanSaray Baklava introduced a $25 400g promotional box by cutting pistachio density in half and increasing glucose syrup to 52% of box weight. Rather than entering a margin-destroying price war, Zeytun Atelier used Watchtower & Deep Reasoning to pivot creative and offer proof toward verified gram-per-dollar pistachio math.",
    },
    strategyEvolution: {
      versionAtPeriodStart: 1,
      versionAtPeriodEnd: isV2 ? 2 : 1,
      totalMaterialUpdates: isV2 ? 1 : 0,
      materialUpdates: isV2
        ? [
            {
              proposalId: DEMO_IDS.proposalId,
              date: "2026-10-15",
              reasoningTrigger:
                "Watchtower Confirmed Event (pce_demo_kervansaray_pricing_001: KervanSaray $25 400g Bazaar Box) + Correlating PDP Offer Friction",
              affectedAuthority: "DIFFERENTIATION & OFFER",
              affectedLaneId: DEMO_IDS.lanes.gifting,
              affectedLaneTitle:
                "Lane 1 · Dinner-Host & Cultural Occasion Gifting (400g Signature Tin — $32 USD)",
              previousSummary:
                "Strategy v1: General 38% Boz pistachio and 40-layer clarified-butter crunch positioning; $32 single tin / $60 2-tin bundle with free 2-day air.",
              newSummary:
                "Strategy v2: Explicit '152g Real Boz Pistachio vs 208g Sugar Syrup in $25 Boxes' visual proof + complimentary 40g Host Preview Tasting Sleeve added to the $60 2-Tin Bundle while holding $32 unit price.",
              why:
                "Neutralize competitor $25 400g nominal weight anchor without discounting core $32 tin price.",
              versionBefore: 1,
              versionAfter: 2,
              classification: "UPDATED",
            },
          ]
        : [],
      revalidatedAuthorities: [
        "BUSINESS_UNDERSTANDING",
        "AUDIENCE",
        "POSITIONING",
        "MECHANISM",
        "PERSUASION",
        "CHANNEL_SELECTION",
        "BUDGET_GOVERNOR",
      ],
      narrative: isV2
        ? "Chronological Timeline: Strategy v1 operated Oct 1–Oct 14 -> Watchtower confirmed KervanSaray's $25 400g promo box on Oct 14 -> User approved Proposal prop_demo_kervansaray_v2 on Oct 15 -> Strategy v2 operated Oct 15–Oct 28 across a 14-day post-action observation window."
        : "Strategy v1 remains active at baseline.",
    },
    strategicLanes: {
      lanes: [
        {
          laneId: DEMO_IDS.lanes.gifting,
          laneTitle: "Lane 1 · Dinner-Host & Cultural Occasion Gifting (400g Signature Tin — $32 USD)",
          targetRole: "Discerning Dinner Hosts & Cultural Gift Buyers ($30–$65 Spend)",
          strategicRole: "PRIMARY_REVENUE_DRIVER (70% Budget)",
          tasksCount: 2,
          completedTasksCount: isV2 ? 2 : 0,
          primaryChannels: ["Instagram Reels & Carousels", "TikTok Short-Form Video"],
          performanceSummary: isV2
            ? "SIMULATED (Oct 15–28 Post-v2): 2.85% Reel CTR, 10.4% PDP-to-cart rate, and 44% 2-Tin Bundle share ($48.20 blended AOV)."
            : "SIMULATED (Oct 1–14 v1 Baseline): 2.40% Reel CTR; PDP-to-cart rate experiencing competitor $25 promo friction (6.8%).",
          strategyChangesCount: isV2 ? 1 : 0,
          marketRelevance: "Directly exposed to 400g gift box price comparisons; protected by 152g Boz pistachio gram-math proof.",
          status: isV2 ? "ON_TRACK" : "NEEDS_ATTENTION",
        },
        {
          laneId: DEMO_IDS.lanes.hosting,
          laneTitle: "Lane 2 · Boutique Executive & Client Appreciation Gifting (Multi-Tin Bundles)",
          targetRole: "Boutique Executive & Client Appreciation Buyers (2–10 Box Orders)",
          strategicRole: "HIGH_AOV_EXPANSION (30% Budget)",
          tasksCount: 1,
          completedTasksCount: isV2 ? 1 : 0,
          primaryChannels: ["Instagram Carousel", "Google High-Intent Search"],
          performanceSummary:
            "SIMULATED: Consistent $92.40 average order value across 2-tin ($60) and 4-tin ($118) executive orders; insulated from $25 paperboard promo boxes.",
          strategyChangesCount: 0,
          marketRelevance: "Preserved without modification during v1 → v2 adaptation.",
          status: "ON_TRACK",
        },
      ],
      laneDistributionAnalysis:
        "Multi-lane isolation prevented unnecessary churn: only Lane 1 required creative and offer adaptation on Oct 15, while Lane 2 continued compounding executive multi-tin orders uninterrupted.",
    },
    executionSummary: {
      tasksPlanned: 3,
      tasksCompleted: isV2 ? 3 : 0,
      tasksMissed: 0,
      tasksBlocked: 0,
      tasksDeferred: 0,
      completionRatePercent: isV2 ? 100 : 0,
      byLane: {
        [DEMO_IDS.lanes.gifting]: { planned: 2, completed: isV2 ? 2 : 0 },
        [DEMO_IDS.lanes.hosting]: { planned: 1, completed: isV2 ? 1 : 0 },
      },
      byChannel: {
        instagram: { planned: 2, completed: isV2 ? 2 : 0 },
        google_search: { planned: 1, completed: isV2 ? 1 : 0 },
      },
      byPriority: {
        P0: { planned: 1, completed: isV2 ? 1 : 0 },
        P1: { planned: 2, completed: isV2 ? 2 : 0 },
        P2: { planned: 0, completed: 0 },
      },
      byTaskType: {
        CREATIVE_PRODUCTION: 1,
        CONVERSION_OPTIMIZATION: 1,
        PAID_ACQUISITION: 1,
      },
    },
    adaptationResults: {
      evaluations: isV2
        ? [
            {
              updateDate: "2026-10-15 (Observed through 2026-10-28)",
              authority: "DIFFERENTIATION & OFFER (Lane 1 — 400g Signature Tin)",
              laneTitle: "Lane 1 · Dinner-Host & Cultural Occasion Gifting",
              beforeObservation:
                "SIMULATED PRE-ACTION WINDOW (Oct 12–14 under Strategy v1): Following KervanSaray's $25 400g Bazaar Box launch, PDP-to-cart rate dipped to 6.8%, 2-Tin Bundle share was 31%, and blended CPA rose to $26.80 USD.",
              afterObservation:
                "SIMULATED POST-ACTION WINDOW (Oct 15–28 under Strategy v2): After deploying the '152g Boz Pistachio vs 208g Glucose Syrup' Reel/PDP module and the 40g Host Preview Tasting Sleeve on $60 2-tin bundles, PDP-to-cart rate reached 10.4% (+3.6 pp), 2-Tin Bundle share rose to 44%, and blended CPA improved to $21.40 USD. (Observed correlation across synthetic demo window; not claimed as isolated causal proof.)",
              outcome: "IMPROVED",
              evidenceLineage: `Proposal ${DEMO_IDS.proposalId} → Lineage ${DEMO_IDS.lineageId} → Outcome ${DEMO_IDS.outcomeId} → Performance Context ${DEMO_IDS.perfContextIdV2}`,
            },
          ]
        : [],
      synthesis: isV2
        ? "Simulated follow-up telemetry indicates positive alignment after the Oct 15 v2 adaptation. Explicitly contrasting edible Boz pistachio weight (152g) against glucose syrup weight (208g) disarmed the competitor's $25 anchor while protecting our $32 unit price."
        : "No adaptation applied yet in this scenario state.",
    },
    monthlyLearnings: {
      supportedAssumptions: [
        "Buyers willingly pay $32 USD (vs a $25 promo box) when shown transparent gram math proving 2x the real Boz pistachio content (152g vs ~75g).",
        "Including an unboxed 40g Host Preview Tasting Sleeve on $60 2-Tin Bundles removes the gift-giver's hesitation about gifting an unopened sealed tin.",
        "Explicitly stating our 10-day post-opening ambient freshness boundary increases buyer trust in our '100% sheep-milk clarified butter, zero preservatives' claim.",
      ],
      weakenedAssumptions: [
        "Assuming shoppers automatically understand that a $25 400g baklava box is weighted with heavy glucose syrup without seeing a side-by-side gram breakdown.",
      ],
      keyCompetitorTakeaways: [
        "KervanSaray Baklava relies on 52% glucose syrup weight to hit a $25 promotional price point on 400g boxes, generating negative customer reviews for sogginess.",
        "AltınFıstık Confections commands $36 for gold-foil packaging but suffers from 5-day ground shipping crunch degradation.",
      ],
      executionConstraints: [
        "Maintain $4,500/month budget ceiling (60% Instagram, 25% TikTok, 15% Google Search/Retargeting) and 2-day air shipping requirement.",
      ],
      stableStrategyPillars: [
        "38% Boz Antep Pistachio Weight (152g per 400g tin) & 24% Micro-Brix Syrup Ratio",
        "Nitrogen-Flushed Lacquered Steel Gift Tin with Honeycomb Divider & Batch Roast Card",
      ],
    },
    endOfMonthState: {
      strategyVersion: isV2 ? 2 : 1,
      brandSpine: {
        positioning: isV2
          ? "For discerning dinner hosts and gift buyers who refuse syrup-logged mass-market baklava, Zeytun Atelier crafts the 400g Antep Pistachio & Kadayif Assortment Tin ($32 USD) with 152g (38%) verified Boz pistachio weight, 24% light beet-sugar infusion, and nitrogen-sealed 2-day air delivery—proving 2x the real nut density of $25 glucose-weighted promo boxes."
          : "For discerning dinner hosts and gift buyers who refuse syrup-logged mass-market baklava, Zeytun Atelier crafts the 400g Antep Pistachio & Kadayif Assortment Tin ($32 USD) with 38% early-harvest Boz pistachio, 100% clarified sheep-milk butter, and a 24% low-brix syrup ratio sealed in nitrogen-flushed gift tins.",
      },
      activeLaneTitles: [
        "Lane 1 · Dinner-Host & Cultural Occasion Gifting (400g Signature Tin — $32 USD)",
        "Lane 2 · Boutique Executive & Client Appreciation Gifting (Multi-Tin Bundles)",
      ],
    },
    nextMonthAttention: {
      focusAreas: [
        {
          actionType: "SCALE_CREATIVE_PROOF",
          area: "Holiday Dinner-Host 2-Tin Bundle ($60 USD + 40g Tasting Sleeve)",
          rationale:
            "With 2-Tin Bundle take-rate reaching 44% in simulated follow-up telemetry, rotate 2 new cross-section cut-open variations into Instagram Reels ahead of November/December hosting season.",
        },
        {
          actionType: "MONITOR_COMPETITOR",
          area: "Watchtower Tracking on KervanSaray & AltınFıstık Holiday Shipping Thresholds",
          rationale:
            "Monitor whether KervanSaray lowers its $75 free-shipping threshold or reverts the $25 Bazaar Value Box price after negative syrup reviews accumulate.",
        },
      ],
    },
  };
}


