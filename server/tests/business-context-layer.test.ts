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

import { describe, it, expect } from "vitest";
import {
  buildBusinessProfile,
  renderBusinessProfileForPrompt,
  type BusinessProfile,
} from "../commercial-reasoning/business-context-layer";
import type { BusinessDataLayer } from "../../shared/schema";

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
    ]) {
      expect(parsed).toHaveProperty(key);
    }
  });
});
