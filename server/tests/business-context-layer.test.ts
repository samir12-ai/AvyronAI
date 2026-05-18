/**
 * Phase 4-B-prep — Business Context Layer unit tests.
 *
 * Verifies the deterministic profile builder + lens/framework selector.
 * Covers user's 6 stated requirements:
 *   1. uses manual user data when available
 *   2. infers a more specific commercial lens than the broad industry slug
 *   4. fallback behavior works when manual data is missing
 *   5. hallucinated business assumptions are not allowed (deterministic only)
 * Requirements 3 (profile before evidence in prompt) and 6 (floor still
 * wins) live in `business-context-prompt-injection.test.ts`.
 */

import { describe, it, expect, vi } from "vitest";
import {
  buildBusinessProfile,
  buildStage1Profile,
  enrichStage2Profile,
  enrichStage3Profile,
  renderBusinessProfileForPrompt,
  type BusinessProfile,
} from "../commercial-reasoning/business-context-layer";
import type {
  BusinessDataLayer,
  AudienceSnapshot,
  OfferSnapshot,
  FunnelSnapshot,
  PersuasionSnapshot,
  IntegritySnapshot,
  MiSnapshot,
  PositioningSnapshot,
  DifferentiationSnapshot,
  MechanismSnapshot,
} from "../../shared/schema";

function makeBusinessData(overrides: Partial<BusinessDataLayer> = {}): BusinessDataLayer {
  return {
    id: "bd-test",
    campaignId: "camp-test",
    accountId: "acct-test",
    businessLocation: "Remote / US",
    businessType: "Software (SaaS)",
    coreOffer: "Automated revenue-ops platform for B2B SaaS",
    priceRange: "$1,500 / month",
    targetAudienceAge: "32-48",
    targetAudienceSegment: "VP RevOps at $5M-$50M ARR B2B SaaS companies",
    monthlyBudget: "8000",
    funnelObjective: "lead_generation",
    primaryConversionChannel: "demo_booking",
    productCategory: "Revenue operations automation platform",
    coreProblemSolved: "pipeline leak detection",
    uniqueMechanism: "7-day forensic install",
    strategicAdvantage: "pre-built leak taxonomy",
    targetDecisionMaker: "VP RevOps or CRO (committee 3-4 people)",
    goalTarget: "",
    goalTimeline: "",
    goalDescription: "",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("Business Context Layer — buildBusinessProfile (deterministic)", () => {
  it("REQ-1: uses manual user data when available (SaaS path)", () => {
    const profile = buildBusinessProfile({
      industry: "b2b_saas",
      businessData: makeBusinessData(),
    });
    expect(profile.businessModel).toBe("saas");
    expect(profile.subIndustry).toBe("Revenue operations automation platform");
    expect(profile.targetCustomer).toContain("RevOps");
    expect(profile.offerType).toContain("revenue-ops platform");
    // $1,500/mo lands the BCL in the "enterprise_contract" tier (high-ticket
    // subscription). Either of these two upper tiers is acceptable; what
    // matters is that the layer recognises the price is NOT transactional.
    expect(["subscription_high", "enterprise_contract"]).toContain(profile.pricingComplexity);
    expect(profile.buyerType).toBe("committee"); // matches "VP RevOps or CRO" regex
    expect(profile.inputSources.manualUserData).toBe(true);
    expect(profile.inputSources.industrySlug).toBe(true);
    expect(profile.confidence).toBeGreaterThan(0.85);
    expect(profile.unknownFields).toHaveLength(0);
  });

  it("REQ-2: lens is more specific than the bare industry slug", () => {
    const profile = buildBusinessProfile({
      industry: "b2b_saas",
      businessData: makeBusinessData(),
    });
    // The bare slug is "b2b_saas". The lens enumerates SaaS-specific levers
    // that go far beyond that label.
    expect(profile.commercialLens.primaryLevers).toEqual(
      expect.arrayContaining(["activation", "onboarding", "time_to_value", "roi_proof", "switching_cost"]),
    );
    expect(profile.commercialLens.buyerPsychology).toEqual(
      expect.arrayContaining(["roi_required_for_renewal", "implementation_anxiety"]),
    );
    expect(profile.reasoningFramework.name).toMatch(/SaaS.*ROI/i);
    expect(profile.reasoningFramework.emphasizeFields).toContain("commercial_pressures.switching_cost");
    // Ecom and Local signals should be deprioritized for SaaS.
    expect(profile.reasoningFramework.deprioritizeSignals).toContain("walk_in_intent");
  });

  it("REQ-2b: distinct lens per business model (DTC ecom)", () => {
    const profile = buildBusinessProfile({
      industry: "dtc_ecom",
      businessData: makeBusinessData({
        businessType: "DTC apparel brand",
        coreOffer: "premium athleisure direct to consumer",
        productCategory: "Performance apparel",
        priceRange: "$80-$140 per item",
        targetDecisionMaker: "individual consumer",
        targetAudienceSegment: "millennials interested in sustainable activewear",
      }),
    });
    expect(profile.businessModel).toBe("dtc_ecommerce");
    expect(profile.commercialLens.primaryLevers).toEqual(
      expect.arrayContaining(["offer_clarity", "conversion_rate", "trust_signals"]),
    );
    expect(profile.buyerType).toBe("consumer");
    expect(profile.pricingComplexity).toBe("transactional");
    expect(profile.reasoningFramework.deprioritizeSignals).toContain("enterprise_committee");
  });

  it("REQ-2c: local services lens emphasises reputation + anxiety reduction", () => {
    const profile = buildBusinessProfile({
      industry: "local_services",
      businessData: makeBusinessData({
        businessType: "Dental clinic",
        coreOffer: "anxiety-focused cosmetic dentistry",
        productCategory: "Cosmetic dental services",
        priceRange: "$300-$5,000 per procedure",
        targetDecisionMaker: "individual patient",
        targetAudienceSegment: "dental anxiety patients aged 30-55",
        funnelObjective: "consultation_booking",
      }),
    });
    expect(profile.businessModel).toBe("local_service");
    expect(profile.commercialLens.primaryLevers).toEqual(
      expect.arrayContaining(["reputation", "trust_proof", "anxiety_reduction"]),
    );
    expect(profile.reasoningFramework.deprioritizeSignals).toContain("trial_to_paid");
    expect(profile.growthBottlenecks).toContain("review_dependence_risk");
  });

  it("REQ-4: fallback when manual data is missing — slug-only profile + unknownFields populated", () => {
    const profile = buildBusinessProfile({
      industry: "some_unrecognised_industry",
      businessData: null,
    });
    expect(profile.businessModel).toBe("unknown");
    expect(profile.inputSources.manualUserData).toBe(false);
    expect(profile.unknownFields).toEqual(
      expect.arrayContaining([
        "subIndustry",
        "businessModel",
        "targetCustomer",
        "buyerType",
        "offerType",
        "pricingComplexity",
        "funnelType",
      ]),
    );
    expect(profile.confidence).toBeLessThan(0.2);
    // Still emits A lens/framework (UNKNOWN_LENS / UNKNOWN_FRAMEWORK) so
    // the downstream prompt has SOMETHING to render — does not throw.
    expect(profile.commercialLens).toBeDefined();
    expect(profile.reasoningFramework.name).toMatch(/Generic/);
  });

  it("REQ-4b: fallback when BOTH industry slug AND data are missing", () => {
    const profile = buildBusinessProfile({});
    expect(profile.industry).toBe("unknown");
    expect(profile.businessModel).toBe("unknown");
    expect(profile.unknownFields).toContain("industry");
    expect(profile.confidence).toBe(0);
    expect(profile.inputSources.manualUserData).toBe(false);
    expect(profile.inputSources.industrySlug).toBe(false);
  });

  it("REQ-5: builder is pure deterministic — same input → identical output", () => {
    const bd = makeBusinessData();
    const a = buildBusinessProfile({ industry: "b2b_saas", businessData: bd });
    const b = buildBusinessProfile({ industry: "b2b_saas", businessData: bd });
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it("REQ-5b: builder NEVER invents fields not present in input", () => {
    // Pass minimal data — verify nothing magic appears.
    const profile = buildBusinessProfile({
      industry: "b2b_saas",
      businessData: null,
    });
    expect(profile.targetCustomer).toBeNull();
    expect(profile.offerType).toBeNull();
    expect(profile.subIndustry).toBeNull();
    expect(profile.funnelType).toBeNull();
    expect(profile.targetCustomer).toBeNull();
    // Even with slug present, the BCL refuses to invent a buyerType from
    // nothing — it returns "unknown" rather than guessing from the model
    // alone. This is the core anti-hallucination property.
    expect(profile.buyerType).toBe("unknown");
    expect(profile.unknownFields).toContain("buyerType");
  });

  it("treats placeholder strings as missing (unknown/n/a/tbd → null)", () => {
    const profile = buildBusinessProfile({
      industry: "b2b_saas",
      businessData: makeBusinessData({
        productCategory: "TBD",
        targetAudienceSegment: "unknown",
        coreOffer: "n/a",
      }),
    });
    expect(profile.subIndustry).toBeNull();
    expect(profile.targetCustomer).toBeNull();
    expect(profile.offerType).toBeNull();
    expect(profile.unknownFields).toEqual(
      expect.arrayContaining(["subIndustry", "targetCustomer", "offerType"]),
    );
  });

  it("REQ-2d: canonical industry slugs are recognized even when manual data is null (slug normalization)", () => {
    // Architect-flagged HIGH #1 regression. `_` is a word char, so naive
    // `\b...\b` regex would not match `saas` inside `b2b_saas`. Slugs MUST
    // detect their model.
    for (const [slug, expectedModel] of [
      ["b2b_saas", "saas"],
      ["dtc_ecom", "dtc_ecommerce"],
      ["local_services", "local_service"],
      // Hyphen variants — separator normalization must cover both `_` and `-`.
      ["b2b-saas", "saas"],
      ["dtc-ecom", "dtc_ecommerce"],
      ["local-services", "local_service"],
    ] as const) {
      const profile = buildBusinessProfile({ industry: slug, businessData: null });
      expect(profile.businessModel, `slug=${slug}`).toBe(expectedModel);
      expect(profile.commercialLens.primaryLevers.length).toBeGreaterThan(0);
      expect(profile.reasoningFramework.name).not.toMatch(/Generic/);
    }
  });

  it("Stage 1 default — buildStage1Profile === buildBusinessProfile alias, emits stage=1", () => {
    const p = buildStage1Profile({ industry: "b2b_saas", businessData: makeBusinessData() });
    expect(p.stage).toBe(1);
    expect(p.engineDerivedFields).toEqual([]);
    expect(p.contradictions).toEqual([]);
    expect(p.inputSources.miSnapshot).toBe(false);
    expect(p.inputSources.audienceSnapshot).toBe(false);
    expect(p.inputSources.offerSnapshot).toBe(false);
  });

  it("renderBusinessProfileForPrompt produces JSON with all canonical keys", () => {
    const profile = buildBusinessProfile({
      industry: "b2b_saas",
      businessData: makeBusinessData(),
    });
    const rendered = renderBusinessProfileForPrompt(profile);
    const parsed = JSON.parse(rendered) as Record<string, unknown>;
    for (const key of [
      "industry",
      "sub_industry",
      "business_model",
      "target_customer",
      "buyer_type",
      "offer_type",
      "pricing_complexity",
      "funnel_type",
      "growth_bottlenecks",
      "commercial_lens",
      "reasoning_framework",
      "profile_confidence",
      "unknown_fields",
      "engine_derived_fields",
      "contradictions",
      "stage",
    ]) {
      expect(parsed).toHaveProperty(key);
    }
  });
});

// ============================================================================
// Phase 4-B Progressive BCL — Stage 2 + Stage 3 enrichment tests.
// ============================================================================

function asAudienceSnapshot(o: Partial<AudienceSnapshot>): AudienceSnapshot {
  return {
    id: "aud-test",
    accountId: "acct-test",
    campaignId: "camp-test",
    jobId: "job-test",
    miSnapshotId: null,
    engineVersion: 3,
    languageSignals: null,
    audiencePains: null,
    desireMap: null,
    objectionMap: null,
    transformationMap: null,
    emotionalDrivers: null,
    audienceSegments: null,
    segmentDensity: null,
    awarenessLevel: null,
    maturityIndex: null,
    audienceIntentDistribution: null,
    adsTargetingHints: null,
    inputSummary: null,
    signalLineage: null,
    structuredSignals: null,
    executionTimeMs: null,
    inputHash: null,
    createdAt: new Date(),
    ...o,
  } as AudienceSnapshot;
}

function asOfferSnapshot(o: Partial<OfferSnapshot>): OfferSnapshot {
  return {
    id: "off-test",
    accountId: "acct-test",
    campaignId: "camp-test",
    jobId: "job-test",
    miSnapshotId: "mi",
    audienceSnapshotId: "aud",
    positioningSnapshotId: "pos",
    differentiationSnapshotId: "diff",
    mechanismSnapshotId: null,
    engineVersion: 1,
    status: "COMPLETE",
    statusMessage: null,
    primaryOffer: null,
    alternativeOffer: null,
    rejectedOffer: null,
    offerStrengthScore: null,
    positioningConsistency: null,
    hookMechanismAlignment: null,
    boundaryCheck: null,
    confidenceScore: null,
    selectedOption: null,
    signalLineage: null,
    structuralWarnings: null,
    layerDiagnostics: null,
    strategyRootId: null,
    executionTimeMs: null,
    inputHash: null,
    createdAt: new Date(),
    ...o,
  } as OfferSnapshot;
}

function asFunnelSnapshot(o: Partial<FunnelSnapshot>): FunnelSnapshot {
  return {
    id: "fn-test",
    accountId: "acct-test",
    campaignId: "camp-test",
    jobId: "job-test",
    offerSnapshotId: "off",
    awarenessSnapshotId: null,
    miSnapshotId: "mi",
    audienceSnapshotId: "aud",
    positioningSnapshotId: "pos",
    differentiationSnapshotId: "diff",
    engineVersion: 1,
    status: "COMPLETE",
    statusMessage: null,
    primaryFunnel: null,
    alternativeFunnel: null,
    rejectedFunnel: null,
    funnelStrengthScore: null,
    trustPathAnalysis: null,
    proofPlacementLogic: null,
    frictionMap: null,
    boundaryCheck: null,
    confidenceScore: null,
    selectedOption: null,
    strategyRootId: null,
    executionTimeMs: null,
    layerDiagnostics: null,
    inputHash: null,
    createdAt: new Date(),
    ...o,
  } as FunnelSnapshot;
}

function asPersuasionSnapshot(o: Partial<PersuasionSnapshot>): PersuasionSnapshot {
  return {
    id: "per-test",
    accountId: "acct-test",
    campaignId: "camp-test",
    jobId: "job-test",
    awarenessSnapshotId: "awa",
    integritySnapshotId: "int",
    funnelSnapshotId: "fn",
    offerSnapshotId: "off",
    miSnapshotId: "mi",
    audienceSnapshotId: "aud",
    positioningSnapshotId: "pos",
    differentiationSnapshotId: "diff",
    engineVersion: 1,
    status: "COMPLETE",
    statusMessage: null,
    primaryRoute: null,
    alternativeRoute: null,
    rejectedRoute: null,
    layerResults: null,
    structuralWarnings: null,
    boundaryCheck: null,
    ...o,
  } as PersuasionSnapshot;
}

function asIntegritySnapshot(o: Partial<IntegritySnapshot>): IntegritySnapshot {
  return {
    id: "int-test",
    accountId: "acct-test",
    campaignId: "camp-test",
    jobId: "job-test",
    funnelSnapshotId: "fn",
    offerSnapshotId: "off",
    miSnapshotId: "mi",
    audienceSnapshotId: "aud",
    positioningSnapshotId: "pos",
    differentiationSnapshotId: "diff",
    engineVersion: 1,
    status: "COMPLETE",
    statusMessage: null,
    overallIntegrityScore: 0.8,
    safeToExecute: true,
    layerResults: null,
    structuralWarnings: null,
    flaggedInconsistencies: null,
    boundaryCheck: null,
    strategyRootId: null,
    executionTimeMs: null,
    inputHash: null,
    createdAt: new Date(),
    ...o,
  } as IntegritySnapshot;
}

describe("Progressive BCL — Stage 2 enrichment (PBCL-3)", () => {
  it("fills UNKNOWN fields from engine snapshots and tags engineDerivedFields", () => {
    const stage1 = buildStage1Profile({
      industry: "b2b_saas",
      businessData: null, // forces UNKNOWN for everything but industry slug
    });
    expect(stage1.targetCustomer).toBeNull();
    expect(stage1.offerType).toBeNull();
    expect(stage1.buyerType).toBe("unknown");

    const stage2 = enrichStage2Profile(stage1, {
      audience: asAudienceSnapshot({
        audienceSegments: JSON.stringify([
          { title: "VP RevOps at mid-market SaaS" },
          { title: "Director of Sales Ops" },
        ]),
      }),
      offer: asOfferSnapshot({
        primaryOffer: JSON.stringify({
          name: "30-day forensic install",
          price: "$1,800 / month",
        }),
        offerStrengthScore: 0.7,
      }),
    });
    expect(stage2.stage).toBe(2);
    expect(stage2.targetCustomer).toContain("RevOps");
    expect(stage2.buyerType).toBe("committee");
    expect(stage2.offerType).toContain("forensic install");
    expect(["subscription_high", "enterprise_contract"]).toContain(stage2.pricingComplexity);
    expect(stage2.engineDerivedFields).toEqual(
      expect.arrayContaining(["targetCustomer", "buyerType", "offerType", "pricingComplexity"]),
    );
    expect(stage2.inputSources.audienceSnapshot).toBe(true);
    expect(stage2.inputSources.offerSnapshot).toBe(true);
  });

  it("user-input WINS on contradiction; engine-value logged in contradictions[]", () => {
    const stage1 = buildStage1Profile({
      industry: "dtc_ecom",
      businessData: makeBusinessData({
        businessType: "DTC apparel brand",
        coreOffer: "premium athleisure direct to consumer",
        productCategory: "Performance apparel",
        priceRange: "$80-$140 per item",
        targetDecisionMaker: "individual consumer",
        targetAudienceSegment: "millennials interested in sustainable activewear",
      }),
    });
    expect(stage1.buyerType).toBe("consumer");
    expect(stage1.targetCustomer).toMatch(/millennials/);
    // Engine says committee — should NOT overwrite, must contradiction-log.
    const stage2 = enrichStage2Profile(stage1, {
      audience: asAudienceSnapshot({
        audienceSegments: JSON.stringify([{ title: "VP Procurement at Fortune 500 retailers" }]),
      }),
    });
    expect(stage2.buyerType).toBe("consumer"); // unchanged
    expect(stage2.targetCustomer).toMatch(/millennials/); // unchanged
    expect(stage2.contradictions.length).toBeGreaterThanOrEqual(1);
    const fields = stage2.contradictions.map(c => c.field);
    expect(fields).toEqual(expect.arrayContaining(["targetCustomer"]));
    for (const c of stage2.contradictions) {
      expect(c.engineSource).toMatch(/^audience_snapshot/);
    }
    // engineDerivedFields does NOT include fields that were contradicted
    // away — only fields where the engine WON because stage1 was UNKNOWN.
    expect(stage2.engineDerivedFields).not.toContain("targetCustomer");
    expect(stage2.engineDerivedFields).not.toContain("buyerType");
  });

  it("tolerates missing snapshots (undefined inputs) without throwing", () => {
    const stage1 = buildStage1Profile({ industry: "b2b_saas", businessData: makeBusinessData() });
    expect(() => enrichStage2Profile(stage1, {})).not.toThrow();
    expect(() =>
      enrichStage2Profile(stage1, { audience: undefined, mi: null, offer: undefined } as any),
    ).not.toThrow();
    const result = enrichStage2Profile(stage1, {});
    // No proposals, no contradictions, no new engineDerivedFields.
    expect(result.contradictions).toEqual([]);
    expect(result.engineDerivedFields).toEqual([]);
    expect(result.stage).toBe(2);
  });

  it("re-detects businessModel when Stage 1 was UNKNOWN and Stage 2 supplies offer+subIndustry text", () => {
    const stage1 = buildStage1Profile({
      industry: null,
      businessData: null,
    });
    expect(stage1.businessModel).toBe("unknown");

    const stage2 = enrichStage2Profile(stage1, {
      mi: {
        id: "mi", accountId: "a", campaignId: "c", jobId: "j",
        marketState: JSON.stringify({ category: "SaaS revenue operations" }),
      } as unknown as MiSnapshot,
      offer: asOfferSnapshot({
        primaryOffer: JSON.stringify({ name: "annual subscription platform", price: "$500/mo" }),
      }),
    });
    expect(stage2.businessModel).toBe("saas");
    expect(stage2.commercialLens.primaryLevers).toContain("activation");
    expect(stage2.engineDerivedFields).toContain("businessModel");
  });

  it("does NOT invent engine-derived fields when snapshots carry no usable evidence (no hallucinated enrichment)", () => {
    const stage1 = buildStage1Profile({ industry: "b2b_saas", businessData: null });
    const stage2 = enrichStage2Profile(stage1, {
      audience: asAudienceSnapshot({ audienceSegments: "not json garbage" }),
      offer: asOfferSnapshot({ primaryOffer: "[" }),
      mi: { marketState: "{not_json" } as any,
    });
    expect(stage2.engineDerivedFields).toEqual([]);
    expect(stage2.targetCustomer).toBeNull();
    expect(stage2.offerType).toBeNull();
    expect(stage2.unknownFields).toEqual(expect.arrayContaining(["targetCustomer", "offerType"]));
  });
});

describe("Progressive BCL — Stage 3 enrichment (PBCL-4)", () => {
  it("fills funnelType from funnel snapshot, adds friction-derived bottlenecks", () => {
    const stage1 = buildStage1Profile({ industry: "b2b_saas", businessData: null });
    const stage2 = enrichStage2Profile(stage1, {});
    expect(stage2.funnelType).toBeNull();
    const stage3 = enrichStage3Profile(stage2, {
      funnel: asFunnelSnapshot({
        primaryFunnel: JSON.stringify({ funnelType: "demo_request_funnel" }),
        frictionMap: JSON.stringify([
          { label: "Long form fields" },
          { label: "Pricing opacity" },
        ]),
      }),
    });
    expect(stage3.stage).toBe(3);
    expect(stage3.funnelType).toBe("demo_request_funnel");
    expect(stage3.engineDerivedFields).toContain("funnelType");
    expect(stage3.growthBottlenecks).toEqual(
      expect.arrayContaining(["funnel_friction:long_form_fields", "funnel_friction:pricing_opacity"]),
    );
    expect(stage3.inputSources.funnelSnapshot).toBe(true);
  });

  it("integrity flags propagate as trust_repair_required + persuasion unresolved → bottleneck", () => {
    const stage1 = buildStage1Profile({ industry: "b2b_saas", businessData: makeBusinessData() });
    const stage2 = enrichStage2Profile(stage1, {});
    const stage3 = enrichStage3Profile(stage2, {
      integrity: asIntegritySnapshot({
        safeToExecute: false,
        overallIntegrityScore: 0.3,
        flaggedInconsistencies: JSON.stringify([{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }]),
      }),
      persuasion: asPersuasionSnapshot({
        layerResults: JSON.stringify([
          { status: "unresolved" },
          { status: "unresolved" },
          { status: "resolved" },
        ]),
      }),
    });
    expect(stage3.growthBottlenecks).toEqual(expect.arrayContaining([
      "trust_repair_required",
      "low_overall_integrity_score",
      "integrity_flagged_inconsistencies:4",
      "persuasion_unresolved_objections:2",
    ]));
  });

  it("tolerates undefined Stage-3 inputs", () => {
    const stage1 = buildStage1Profile({ industry: "b2b_saas", businessData: makeBusinessData() });
    const stage2 = enrichStage2Profile(stage1, {});
    expect(() => enrichStage3Profile(stage2, {})).not.toThrow();
    const stage3 = enrichStage3Profile(stage2, {});
    expect(stage3.stage).toBe(3);
    expect(stage3.contradictions).toEqual([]);
  });
});

describe("Progressive BCL — cross-stage invariants (PBCL-9)", () => {
  it("monotonicity: confidence is non-decreasing across stages when starting from UNKNOWN", () => {
    const stage1 = buildStage1Profile({ industry: "b2b_saas", businessData: null });
    const stage2 = enrichStage2Profile(stage1, {
      audience: asAudienceSnapshot({
        audienceSegments: JSON.stringify([{ title: "VP Engineering" }]),
      }),
      offer: asOfferSnapshot({
        primaryOffer: JSON.stringify({ name: "platform license", price: "$2,500/mo" }),
      }),
    });
    const stage3 = enrichStage3Profile(stage2, {
      funnel: asFunnelSnapshot({
        primaryFunnel: JSON.stringify({ funnelType: "demo_request" }),
      }),
    });
    expect(stage2.confidence).toBeGreaterThanOrEqual(stage1.confidence);
    expect(stage3.confidence).toBeGreaterThanOrEqual(stage2.confidence);
  });

  it("Stage 3 carries forward Stage 1 user-input provenance untouched (multi-engine propagation)", () => {
    const bd = makeBusinessData();
    const stage1 = buildStage1Profile({ industry: "b2b_saas", businessData: bd });
    const stage2 = enrichStage2Profile(stage1, {
      audience: asAudienceSnapshot({
        audienceSegments: JSON.stringify([{ title: "DIFFERENT individual consumer" }]),
      }),
    });
    const stage3 = enrichStage3Profile(stage2, {
      integrity: asIntegritySnapshot({ safeToExecute: true, overallIntegrityScore: 0.9 }),
    });
    // User-input fields unchanged from Stage 1.
    expect(stage3.targetCustomer).toBe(stage1.targetCustomer);
    expect(stage3.buyerType).toBe(stage1.buyerType);
    expect(stage3.offerType).toBe(stage1.offerType);
    // engineDerivedFields stays empty for user-grounded fields.
    expect(stage3.engineDerivedFields).not.toContain("targetCustomer");
    expect(stage3.engineDerivedFields).not.toContain("buyerType");
    expect(stage3.inputSources.manualUserData).toBe(true);
    expect(stage3.inputSources.audienceSnapshot).toBe(true);
    expect(stage3.inputSources.integritySnapshot).toBe(true);
  });

  it("deterministic across all 3 stages — identical inputs → identical profiles", () => {
    const bd = makeBusinessData();
    const audSnap = asAudienceSnapshot({
      audienceSegments: JSON.stringify([{ title: "VP RevOps" }]),
    });
    const intSnap = asIntegritySnapshot({ safeToExecute: true, overallIntegrityScore: 0.9 });
    const runA = enrichStage3Profile(
      enrichStage2Profile(
        buildStage1Profile({ industry: "b2b_saas", businessData: bd }),
        { audience: audSnap },
      ),
      { integrity: intSnap },
    );
    const runB = enrichStage3Profile(
      enrichStage2Profile(
        buildStage1Profile({ industry: "b2b_saas", businessData: bd }),
        { audience: audSnap },
      ),
      { integrity: intSnap },
    );
    expect(JSON.stringify(runA)).toBe(JSON.stringify(runB));
  });

  it("contradiction logging shape — each entry has {field, userValue, engineValue, engineSource}", () => {
    const stage1 = buildStage1Profile({
      industry: "dtc_ecom",
      businessData: makeBusinessData({
        targetDecisionMaker: "individual consumer",
        targetAudienceSegment: "millennials in sustainable activewear",
        coreOffer: "premium athleisure",
        priceRange: "$120 per item",
      }),
    });
    const stage2 = enrichStage2Profile(stage1, {
      audience: asAudienceSnapshot({
        audienceSegments: JSON.stringify([{ title: "Buying committee at retail chains" }]),
      }),
      offer: asOfferSnapshot({
        primaryOffer: JSON.stringify({ name: "enterprise wholesale subscription", price: "$5,000/mo" }),
      }),
    });
    expect(stage2.contradictions.length).toBeGreaterThan(0);
    for (const c of stage2.contradictions) {
      expect(c).toHaveProperty("field");
      expect(c).toHaveProperty("userValue");
      expect(c).toHaveProperty("engineValue");
      expect(c).toHaveProperty("engineSource");
      expect(typeof c.engineSource).toBe("string");
      expect(c.engineSource.length).toBeGreaterThan(0);
    }
  });
});
