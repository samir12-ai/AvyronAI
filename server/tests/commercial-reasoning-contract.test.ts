/**
 * Phase 4-A — commercial reasoning contract + integrity-gate tests.
 *
 * Covers:
 *   - Zod boundary rejects malformed output (missing evidence_refs, free-string enums).
 *   - Phantom evidence ref → REJECT + maps to phantom_evidence_ref reason.
 *   - Fabricated quote → REJECT + maps to fabricated_quote reason.
 *   - AT1 per-field linkage missing → REJECT.
 *   - AT2 evidence diversity insufficient → REJECT.
 *   - AT3 template-phrase leak (≥2 occurrences) → REJECT.
 *   - Contradiction-triggered confidence downgrade.
 *   - signalOrigin overreach (fallback + substantive) → REJECT.
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  CommercialReasoningOutputSchema,
  type CommercialReasoningOutput,
} from "../commercial-reasoning/contract";
import {
  applyContradictionDowngrade,
  buildAelEvidenceIndex,
  buildAelEvidenceIndexFromSubset,
  checkEvidenceDiversity,
  checkEvidenceRefExistence,
  checkLanguageStyleGrounding,
  checkPerFieldEvidenceLinkage,
  checkQuotedFragments,
  checkSignalOriginOverreach,
  checkTemplatePhraseLeak,
} from "../commercial-reasoning/integrity-gates";
import { isAllowedForIndustry } from "../commercial-reasoning/awareness-depth-interpreter";
import {
  EMPTY_ANALYTICAL_PACKAGE,
  type AnalyticalPackage,
} from "../analytical-enrichment-layer/types";

function makeAel(): AnalyticalPackage {
  return {
    ...EMPTY_ANALYTICAL_PACKAGE,
    root_causes: [
      {
        surfaceSignal: "users abandon at pricing page",
        deepCause: "pricing tiers do not match user's mental model of value delivered",
        causalReasoning: "the three-tier ladder forces a binary commit/skip decision when the user is still in evaluation",
        sourceData: "instagram comments + landing page bounce analytics",
        confidenceLevel: "high",
      },
      {
        surfaceSignal: "low repeat-purchase rate among second-time buyers",
        deepCause: "post-purchase email cadence positions upsell before trust is consolidated",
        causalReasoning: "buyers receive an upsell within 48h before the first delivery is even received",
        sourceData: "klaviyo flow + customer review threads",
        confidenceLevel: "medium",
      },
    ],
    causal_chains: [
      {
        pain: "pricing confusion",
        cause: "tier names do not map to use cases",
        impact: "drop-off at the pricing comparison step",
        behavior: "users open and close the pricing tab without selecting",
        conversionEffect: "checkout-initiate rate < 8%",
      },
    ],
  };
}

function makeValidOutput(): CommercialReasoningOutput {
  return {
    depthAssessment: "substantive",
    buyer_state: "solution_aware",
    saturation_state: "competitive",
    trust_state: "skeptical",
    reasoning:
      "Buyers reach the pricing page already comparing alternatives, but the tier-name ambiguity surfaced in the AEL forces a binary commit/skip decision before they finish evaluating; this combined with the premature upsell cadence creates a trust gap that compounds at the second purchase.",
    evidence_refs: [
      {
        refType: "ael_root_cause",
        refId: "rc:0",
        quotedFragment: "pricing tiers do not match user's mental model",
        appliesTo: ["depthAssessment", "buyer_state", "commercial_pressures.decision_complexity"],
      },
      {
        refType: "ael_root_cause",
        refId: "rc:1",
        quotedFragment: "upsell before trust is consolidated",
        appliesTo: ["saturation_state", "trust_state", "commercial_pressures.trust"],
      },
    ],
    commercial_pressures: [
      { pressure: "decision_complexity", intensity: "high", evidence_ref_ids: ["rc:0"] },
      { pressure: "trust", intensity: "medium", evidence_ref_ids: ["rc:1"] },
    ],
    confidence: 0.78,
    uncertainty: {
      knownUnknowns: ["repeat-purchase cohort size"],
      lowEvidenceFields: [],
      contradictionsSurfaced: [],
    },
    signalOrigin: "real",
    provenance_origin: "engine_seed",
    reasoner_self_assessment: "grounded_complete",
  };
}

describe("CommercialReasoningOutputSchema (Zod boundary)", () => {
  it("accepts a valid output", () => {
    const r = CommercialReasoningOutputSchema.safeParse(makeValidOutput());
    expect(r.success).toBe(true);
  });

  it("rejects when evidence_refs has fewer than 2 entries", () => {
    const out = makeValidOutput();
    out.evidence_refs = [out.evidence_refs[0]];
    const r = CommercialReasoningOutputSchema.safeParse(out);
    expect(r.success).toBe(false);
  });

  it("rejects a free-string depthAssessment", () => {
    const out: any = makeValidOutput();
    out.depthAssessment = "very deep, actually";
    const r = CommercialReasoningOutputSchema.safeParse(out);
    expect(r.success).toBe(false);
  });

  it("rejects when reasoning is below 80 chars", () => {
    const out = makeValidOutput();
    out.reasoning = "too short";
    const r = CommercialReasoningOutputSchema.safeParse(out);
    expect(r.success).toBe(false);
  });
});

describe("integrity gates", () => {
  const ael = makeAel();
  const aelIndex = buildAelEvidenceIndex(ael);
  const signalIds = new Set<string>();
  const signalText = new Map<string, string>();

  it("phantom evidence ref → REJECT with phantom_evidence_ref reason", () => {
    const out = makeValidOutput();
    out.evidence_refs[1].refId = "rc:99";
    const r = checkEvidenceRefExistence(out, aelIndex, signalIds);
    expect(r.passed).toBe(false);
    expect(r.reason).toBe("commercial_reasoner_phantom_evidence_ref");
  });

  it("fabricated quote → REJECT with fabricated_quote reason", () => {
    const out = makeValidOutput();
    out.evidence_refs[0].quotedFragment = "wholly fabricated phrase not present anywhere";
    const r = checkQuotedFragments(out, aelIndex, signalText);
    expect(r.passed).toBe(false);
    expect(r.reason).toBe("commercial_reasoner_fabricated_quote");
  });

  it("AT1: per-field evidence linkage missing → REJECT", () => {
    const out = makeValidOutput();
    out.evidence_refs.forEach((r) => (r.appliesTo = ["depthAssessment"]));
    const r = checkPerFieldEvidenceLinkage(out);
    expect(r.passed).toBe(false);
    expect(r.reason).toBe("commercial_reasoner_anti_template_at1");
  });

  it("AT2: evidence diversity insufficient (single refId) → REJECT", () => {
    const out = makeValidOutput();
    out.evidence_refs[1].refId = out.evidence_refs[0].refId;
    const r = checkEvidenceDiversity(out);
    expect(r.passed).toBe(false);
    expect(r.reason).toBe("commercial_reasoner_anti_template_at2");
  });

  it("AT3: template-phrase leak ≥2 occurrences → REJECT", () => {
    const out = makeValidOutput();
    out.reasoning =
      "We need transparency proof and outcome proof to build trust with the buyer before they consider switching to a competitor.";
    const r = checkTemplatePhraseLeak(out);
    expect(r.result.passed).toBe(false);
    expect(r.result.reason).toBe("commercial_reasoner_template_phrase_leak");
  });

  it("AT3: single template-phrase occurrence is allowed (warning, not REJECT)", () => {
    const out = makeValidOutput();
    out.reasoning =
      "The buyer needs transparency proof in the comparison stage; without it, the comparison engine never produces a decision.";
    const r = checkTemplatePhraseLeak(out);
    expect(r.result.passed).toBe(true);
    expect(r.matches.length).toBe(1);
  });

  it("signalOrigin=fallback + depthAssessment=substantive → REJECT", () => {
    const out = makeValidOutput();
    out.signalOrigin = "fallback";
    const r = checkSignalOriginOverreach(out);
    expect(r.passed).toBe(false);
    expect(r.reason).toBe("commercial_reasoner_signal_origin_overreach");
  });

  it("unresolved contradiction with confidence>0.7 → downgrade to 0.5 + grounded_partial", () => {
    const out = makeValidOutput();
    out.confidence = 0.85;
    out.uncertainty.contradictionsSurfaced = [
      {
        claimA: "pricing is the primary friction",
        claimB: "post-purchase email cadence is the primary friction",
        resolutionStance: "unresolved",
        resolutionReason: "evidence supports both interpretations",
      },
    ];
    const r = applyContradictionDowngrade(out);
    expect(r.downgraded).toBe(true);
    expect(r.output.confidence).toBe(0.5);
    expect(r.output.reasoner_self_assessment).toBe("grounded_partial");
  });

  it("phantom-from-truncated-AEL: refId outside the prompt subset is REJECTED even though it exists in the full AEL (architect P4-A fix)", () => {
    // Simulate a 10-row AEL where the interpreter only ships the first 8 in
    // the prompt. The model then cites `rc:9` — a row that EXISTS in the
    // full AEL but was never shown to the LLM. The gate index, built from
    // the truncated subset only, must REJECT this as phantom evidence.
    const richAel: AnalyticalPackage = {
      ...EMPTY_ANALYTICAL_PACKAGE,
      root_causes: Array.from({ length: 10 }, (_, i) => ({
        surfaceSignal: `signal-${i}`,
        deepCause: `deep cause ${i} with distinctive language`,
        causalReasoning: `reasoning ${i}`,
        sourceData: `source ${i}`,
        confidenceLevel: "medium" as const,
      })),
    };
    const truncatedSubset = richAel.root_causes.slice(0, 8);
    const subsetIndex = buildAelEvidenceIndexFromSubset(truncatedSubset, []);
    const out = makeValidOutput();
    out.evidence_refs[0].refId = "rc:9";
    out.evidence_refs[0].quotedFragment = "deep cause 9 with distinctive language";

    // Sanity: the FULL-AEL index would (incorrectly) accept this — proving
    // the bug exists when the substrate is misaligned.
    const fullIndex = buildAelEvidenceIndex(richAel);
    expect(checkEvidenceRefExistence(out, fullIndex, new Set()).passed).toBe(true);

    // Subset index — the only legitimate gate substrate — REJECTS it.
    const r = checkEvidenceRefExistence(out, subsetIndex, new Set());
    expect(r.passed).toBe(false);
    expect(r.reason).toBe("commercial_reasoner_phantom_evidence_ref");
  });

  it("valid output passes all gates", () => {
    const out = makeValidOutput();
    expect(checkEvidenceRefExistence(out, aelIndex, signalIds).passed).toBe(true);
    expect(checkQuotedFragments(out, aelIndex, signalText).passed).toBe(true);
    expect(checkSignalOriginOverreach(out).passed).toBe(true);
    expect(checkPerFieldEvidenceLinkage(out).passed).toBe(true);
    expect(checkEvidenceDiversity(out).passed).toBe(true);
    expect(checkTemplatePhraseLeak(out).result.passed).toBe(true);
  });
});

// ── Phase 4-A post-audit (2026-05-18): industry allowlist + language gate ─

describe("isAllowedForIndustry (industry allowlist)", () => {
  const original = process.env.COMMERCIAL_REASONER_ALLOWED_INDUSTRIES;
  afterEach(() => {
    if (original === undefined) delete process.env.COMMERCIAL_REASONER_ALLOWED_INDUSTRIES;
    else process.env.COMMERCIAL_REASONER_ALLOWED_INDUSTRIES = original;
  });

  it("unset env → all industries allowed (back-compat default)", () => {
    delete process.env.COMMERCIAL_REASONER_ALLOWED_INDUSTRIES;
    expect(isAllowedForIndustry("dtc_ecom")).toBe(true);
    expect(isAllowedForIndustry("local_services")).toBe(true);
    expect(isAllowedForIndustry(null)).toBe(true);
  });

  it("empty env → all industries allowed", () => {
    process.env.COMMERCIAL_REASONER_ALLOWED_INDUSTRIES = "";
    expect(isAllowedForIndustry("dtc_ecom")).toBe(true);
    expect(isAllowedForIndustry(null)).toBe(true);
  });

  it("set to dtc_ecom only → only dtc_ecom passes", () => {
    process.env.COMMERCIAL_REASONER_ALLOWED_INDUSTRIES = "dtc_ecom";
    expect(isAllowedForIndustry("dtc_ecom")).toBe(true);
    expect(isAllowedForIndustry("local_services")).toBe(false);
    expect(isAllowedForIndustry("b2b_saas")).toBe(false);
  });

  it("comma-separated list works + case-insensitive + trims", () => {
    process.env.COMMERCIAL_REASONER_ALLOWED_INDUSTRIES = " DTC_ECOM, B2B_SaaS ";
    expect(isAllowedForIndustry("dtc_ecom")).toBe(true);
    expect(isAllowedForIndustry("b2b_saas")).toBe(true);
    expect(isAllowedForIndustry("local_services")).toBe(false);
  });

  it("allowlist set + industry missing → fail-closed", () => {
    process.env.COMMERCIAL_REASONER_ALLOWED_INDUSTRIES = "dtc_ecom";
    expect(isAllowedForIndustry(null)).toBe(false);
  });
});

describe("AT4 — language-style grounding", () => {
  const dentistryCorpus = {
    rootCauses: [
      {
        surfaceSignal: "patients postpone routine cleanings",
        deepCause: "anxiety about discomfort and unknown costs at the visit",
        causalReasoning: "fear of pain and surprise bills outweighs perceived benefit",
        sourceData: "google reviews + intake form free-text",
        confidenceLevel: "high" as const,
      },
    ],
    causalChains: [
      {
        pain: "dental anxiety",
        cause: "fear of pain during procedures and surprise charges at checkout",
        impact: "deferred appointments and missed prevention windows",
        behavior: "patients book and cancel within 48 hours of the appointment",
        conversionEffect: "appointment-completion rate below industry average",
      },
    ],
    routeSourceTexts: [
      "anxiety-reassurance entry route",
      "transparent-pricing trigger",
      "first-visit walkthrough video",
    ],
    productDnaSummary: "family dental practice focused on anxiety-free cleanings",
  };

  function makeOutputWithReasoning(reasoning: string): CommercialReasoningOutput {
    return { ...makeValidOutput(), reasoning };
  }

  it("passes when reasoning vocabulary is anchored in the corpus", () => {
    const grounded = makeOutputWithReasoning(
      "Patients postpone cleanings because anxiety about discomfort during procedures and surprise charges at checkout outweighs the perceived benefit; the intake free-text confirms appointments are booked and cancelled within 48 hours, so transparent pricing combined with a first-visit walkthrough video addresses both fears at the entry point.",
    );
    const r = checkLanguageStyleGrounding(grounded, dentistryCorpus);
    expect(r.result.passed).toBe(true);
    expect(r.detail.overlapRatio).toBeGreaterThanOrEqual(0.3);
  });

  it("rejects SaaS-flavoured jargon imported into a dentistry context (local_services regression case)", () => {
    const ungrounded = makeOutputWithReasoning(
      "The platform purchase-ready framework deficit creates mechanism-comprehension friction that blocks transformation validation; differentiated purchase-ready framework transparency would activate flywheel effect across the operational scalability layer, unlocking category leadership through go-to-market motion refinement.",
    );
    const r = checkLanguageStyleGrounding(ungrounded, dentistryCorpus);
    expect(r.result.passed).toBe(false);
    expect(r.result.reason).toBe("commercial_reasoner_language_ungrounded");
    expect(r.detail.overlapRatio).toBeLessThan(0.3);
  });

  it("does not penalise terse output (below minimum-tokens floor)", () => {
    const terse = makeOutputWithReasoning(
      "Anxiety blocks bookings; transparent pricing helps; first-visit video reduces fear; mechanism is reassurance plus clarity for nervous patients overall here.",
    );
    const r = checkLanguageStyleGrounding(terse, {
      rootCauses: [],
      causalChains: [],
      routeSourceTexts: [],
      productDnaSummary: null,
    });
    expect(r.result.passed).toBe(true);
  });

  it("passes when corpus is empty (don't penalise upstream evidence gap)", () => {
    const out = makeValidOutput();
    const r = checkLanguageStyleGrounding(out, {
      rootCauses: [],
      causalChains: [],
      routeSourceTexts: [],
      productDnaSummary: null,
    });
    expect(r.result.passed).toBe(true);
  });

  it("does not over-flag legitimate dtc_ecom reasoning (corpus regression)", () => {
    const dtcCorpus = {
      rootCauses: [
        {
          surfaceSignal: "first-time visitors abandon the product detail page after the size guide",
          deepCause: "size guide forces conversion of waist-hip-bust measurements without showing real bodies",
          causalReasoning: "buyers cannot visually map abstract measurements to a garment on a body that looks like theirs",
          sourceData: "instagram dm replies + return reason codes",
          confidenceLevel: "high" as const,
        },
      ],
      causalChains: [
        {
          pain: "size uncertainty",
          cause: "size guide shows numbers, not bodies",
          impact: "first-purchase return rate above category average",
          behavior: "visitors open the size guide twice then leave without adding to cart",
          conversionEffect: "add-to-cart rate below benchmark on detail pages",
        },
      ],
      routeSourceTexts: [
        "size-confidence entry route",
        "real-customer try-on visuals trigger",
        "community-driven try-before-you-decide loop",
      ],
      productDnaSummary: "DTC heirloom sleepwear with size-inclusive fit guarantee",
    };
    const grounded = makeOutputWithReasoning(
      "First-time visitors abandon the detail page after consulting the size guide because the guide shows abstract measurements rather than real bodies, so buyers cannot visually map waist-hip-bust numbers onto a garment on someone who looks like them; real-customer try-on visuals at the size-confidence entry route would close that gap and reduce the first-purchase return rate the data shows.",
    );
    const r = checkLanguageStyleGrounding(grounded, dtcCorpus);
    expect(r.result.passed).toBe(true);
  });

  it("does not over-flag legitimate b2b_saas reasoning (corpus regression)", () => {
    const saasCorpus = {
      rootCauses: [
        {
          surfaceSignal: "trial accounts hit activation milestones but never invite teammates",
          deepCause: "the workspace setup flow buries multiplayer invitations behind a billing wall",
          causalReasoning: "a single-seat trial never demonstrates the collaboration loop that drives expansion",
          sourceData: "product analytics funnel + customer success call notes",
          confidenceLevel: "high" as const,
        },
      ],
      causalChains: [
        {
          pain: "trial isolation",
          cause: "invitation step is gated behind plan selection",
          impact: "single-seat trials convert at half the rate of multi-seat trials",
          behavior: "admins complete onboarding alone and lapse before the multiplayer moment",
          conversionEffect: "trial-to-paid conversion well below cohort benchmark",
        },
      ],
      routeSourceTexts: [
        "multiplayer-activation entry route",
        "teammate-invitation unblock trigger",
        "first-collaboration aha moment",
      ],
      productDnaSummary: "B2B revenue-ops automation requiring multi-seat workflows",
    };
    const grounded = makeOutputWithReasoning(
      "Trial admins complete activation milestones in isolation because the teammate-invitation step sits behind plan selection, which prevents the multiplayer moment the workflow depends on; unblocking invitations at the multiplayer-activation entry route would let the first-collaboration aha moment land before the trial lapses, addressing the conversion gap the funnel data shows.",
    );
    const r = checkLanguageStyleGrounding(grounded, saasCorpus);
    expect(r.result.passed).toBe(true);
  });

  it("respects env-tunable threshold override", () => {
    const original = process.env.COMMERCIAL_REASONER_VOCAB_OVERLAP_THRESHOLD;
    try {
      // Force an unreachable threshold; even the grounded case should now fail.
      process.env.COMMERCIAL_REASONER_VOCAB_OVERLAP_THRESHOLD = "0.99";
      const grounded = makeOutputWithReasoning(
        "Patients postpone cleanings because anxiety about discomfort during procedures and surprise charges at checkout outweighs the perceived benefit; the intake free-text confirms appointments are booked and cancelled within 48 hours.",
      );
      const r = checkLanguageStyleGrounding(grounded, dentistryCorpus);
      expect(r.result.passed).toBe(false);
      expect(r.result.reason).toBe("commercial_reasoner_language_ungrounded");
    } finally {
      if (original === undefined) delete process.env.COMMERCIAL_REASONER_VOCAB_OVERLAP_THRESHOLD;
      else process.env.COMMERCIAL_REASONER_VOCAB_OVERLAP_THRESHOLD = original;
    }
  });
});
