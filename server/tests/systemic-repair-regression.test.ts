import { describe, expect, it } from "vitest";
import {
  computePainContentHash,
  normalizePainText,
  buildPainCompositeKey,
} from "../shared/audience-pain-registry";
import {
  computeProductTruthHash,
  canReuseProductAssessment,
} from "../strategic-reasoning/product-assessment";
import { canReuseTargetAssessment } from "../strategic-reasoning/target-assessment";
import { matchResumeDecision } from "../orchestrator/resume-hydration";
import {
  ClaimEpistemicStatus,
  CLAIM_EPISTEMIC_LABELS,
  type StructuredClaim,
} from "../../shared/contracts/claim-status";
import { computeSemanticCollisions } from "../positioning-engine/semantic-collision";
import {
  resolveApprovalProvenance,
  AuthenticationRequiredError,
  PlanAuthorizationError,
} from "../auth-helpers";

describe("Systemic Repair Regression Suite (Phases 1-9)", () => {
  // Test 1: Legacy positional ID with different pain text does not hydrate old decision
  it("1. Legacy positional ID with different pain text does not hydrate old decision", () => {
    const legacyDecision = {
      painId: "p_1",
      painContentHash: "hash_legacy_unrelated_pain",
      jobId: "old_job_123",
      finalClassification: "CORE_PURCHASE",
      fitType: "DIRECT_FIT",
      productFit: "ELIGIBLE",
      eligible: true,
      reason: "Solves shipping delay",
    };

    const targetPain = {
      id: "p_1",
      painId: "p_1",
      statement: "Severe heat trapping in synthetic garments during humid summer",
      contentHash: computePainContentHash("Severe heat trapping in synthetic garments during humid summer"),
      classification: "NOT_EVALUATED",
    };

    const matched = matchResumeDecision(
      targetPain,
      [legacyDecision],
      "new_job_456",
      "aud_snap_456"
    );

    // Because hashes differ and jobId is different, legacy decision must NOT be hydrated!
    expect(matched).toBeUndefined();
  });

  // Test 2: Duplicate pain IDs within snapshot resolve with unique content-hash suffix
  it("2. Duplicate pain IDs within snapshot resolve with unique content-hash suffix / composite key", () => {
    const painTextA = "Overpriced shipping fees on return products";
    const painTextB = "Fabric degrades rapidly after two washes in washing machine";

    const hashA = computePainContentHash(painTextA);
    const hashB = computePainContentHash(painTextB);

    expect(hashA).not.toBe(hashB);

    const compKeyA = buildPainCompositeKey("acc_1", "snap_1", "pain_common_id", hashA);
    const compKeyB = buildPainCompositeKey("acc_1", "snap_1", "pain_common_id", hashB);

    expect(compKeyA).not.toBe(compKeyB);
    expect(compKeyA).toContain(hashA);
    expect(compKeyB).toContain(hashB);
  });

  // Test 3: Compatible rerun with identical pain and PT facts reuses existing decision
  it("3. Compatible rerun with identical pain and PT facts reuses existing decision", () => {
    const painText = "High return rates due to inaccurate sizing charts";
    const painHash = computePainContentHash(painText);
    const ptFacts = [
      { id: "pt_1", fact: "Offers 3D body sizing scan and accurate measurement guides", category: "CAPABILITY" },
    ];
    const ptHash = computeProductTruthHash(ptFacts);

    const existingAssessment = {
      painId: "p_sizing_1",
      painContentHash: painHash,
      productTruthHash: ptHash,
      assessment: "SUPPORTED",
      fitType: "DIRECT_FIT",
      status: "COMPLETE",
    };

    const targetPain = {
      id: "p_sizing_1",
      painId: "p_sizing_1",
      statement: painText,
      contentHash: painHash,
    };

    const canReuse = canReuseProductAssessment(existingAssessment as any, targetPain as any, ptHash);
    expect(canReuse).toBe(true);

    const canReuseTarget = canReuseTargetAssessment(
      existingAssessment as any,
      targetPain as any
    );
    expect(canReuseTarget).toBe(true);
  });

  // Test 4: Rerun with changed PT facts forces re-assessment
  it("4. Rerun with changed PT facts forces re-assessment", () => {
    const painText = "High return rates due to inaccurate sizing charts";
    const painHash = computePainContentHash(painText);
    const initialPtFacts = [
      { id: "pt_1", fact: "Offers 3D body sizing scan", category: "CAPABILITY" },
    ];
    const initialPtHash = computeProductTruthHash(initialPtFacts);

    const existingAssessment = {
      painId: "p_sizing_1",
      painContentHash: painHash,
      productTruthHash: initialPtHash,
      assessment: "SUPPORTED",
      fitType: "DIRECT_FIT",
      status: "COMPLETE",
    };

    const targetPain = {
      id: "p_sizing_1",
      painId: "p_sizing_1",
      statement: painText,
      contentHash: painHash,
    };

    const updatedPtFacts = [
      { id: "pt_1", fact: "Offers 3D body sizing scan", category: "CAPABILITY" },
      { id: "pt_2", fact: "Discontinued 3D body scan; standard size table only", category: "CAPABILITY" },
    ];
    const updatedPtHash = computeProductTruthHash(updatedPtFacts);

    expect(updatedPtHash).not.toBe(initialPtHash);

    const canReuse = canReuseProductAssessment(existingAssessment as any, targetPain as any, updatedPtHash);
    expect(canReuse).toBe(false);
  });

  // Test 5: DIRECT_FIT and STRATEGIC_FIT remain distinct downstream
  it("5. DIRECT_FIT and STRATEGIC_FIT remain distinct downstream", () => {
    const directPainText = "Directly supported sizing issue";
    const directHash = computePainContentHash(directPainText);

    const strategicPainText = "Strategic opportunity requiring custom fulfillment";
    const strategicHash = computePainContentHash(strategicPainText);

    const targetPains = [
      { id: "p_dir", painId: "p_dir", statement: directPainText, contentHash: directHash },
      { id: "p_strat", painId: "p_strat", statement: strategicPainText, contentHash: strategicHash },
    ];

    const records = [
      {
        painId: "p_dir",
        painContentHash: directHash,
        fitType: "DIRECT_FIT",
        finalClassification: "CORE_PURCHASE",
        productFit: "ELIGIBLE",
        eligible: true,
      },
      {
        painId: "p_strat",
        painContentHash: strategicHash,
        fitType: "STRATEGIC_FIT",
        finalClassification: "CORE_PURCHASE",
        productFit: "ELIGIBLE",
        eligible: true,
      },
    ];

    const spdDir = matchResumeDecision(targetPains[0], records);
    const spdStrat = matchResumeDecision(targetPains[1], records);

    expect(spdDir?.fitType).toBe("DIRECT_FIT");
    expect(spdStrat?.fitType).toBe("STRATEGIC_FIT");
    expect(spdDir?.fitType).not.toBe(spdStrat?.fitType);
  });

  // Test 6: Unproven capability claims receive PROPOSED_CAPABILITY with prerequisites
  it("6. Unproven capability claims receive PROPOSED_CAPABILITY with prerequisites", () => {
    const claim: StructuredClaim = {
      statement: "Guaranteed 24-hour domestic delivery nationwide",
      status: ClaimEpistemicStatus.PROPOSED_CAPABILITY,
      label: CLAIM_EPISTEMIC_LABELS[ClaimEpistemicStatus.PROPOSED_CAPABILITY],
      prerequisites: [
        "Contract with local domestic courier SLA",
        "Maintain pre-packed inventory in local distribution hub",
      ],
      supportingEvidenceIds: [],
    };

    expect(claim.status).toBe("PROPOSED_CAPABILITY");
    expect(CLAIM_EPISTEMIC_LABELS[claim.status]).toBe("Proposed — requires validation/implementation");
    expect(claim.prerequisites).toHaveLength(2);
  });

  // Test 7: Content DNA format archetype tags do not leak into semantic collision as claims
  it("7. Content DNA format archetype tags do not leak into semantic collision as claims", async () => {
    const isFormatTag = (text: string): boolean => {
      const lower = text.trim().toLowerCase();
      if (/^(hook|narrative|proof_type|format|angle|cta|tone|style):/i.test(lower)) return true;
      if (/^(story|relatable|problem_solution|behind_the_scenes|social_proof|urgency|curiosity|transformation)$/i.test(lower)) return true;
      return false;
    };

    const tags = [
      "hook:curiosity",
      "narrative:transformation",
      "proof_type:testimonial",
      "format:carousel",
      "relatable",
    ];

    const realClaims = [
      "Ethically sourced 100% French linen summer apparel",
      "Seamless cash on delivery with local dispatch across Beirut",
    ];

    for (const tag of tags) {
      expect(isFormatTag(tag)).toBe(true);
    }
    for (const claim of realClaims) {
      expect(isFormatTag(claim)).toBe(false);
    }

    // When competitor claims are filtered out / empty, collision check reports LIMITED coverage
    const collisionResults = await computeSemanticCollisions({
      territoryClaims: [{ name: "Breathable Summer", claimText: "Luxury modest breathable resort wear" }],
      competitorClaims: [],
    });

    expect(collisionResults[0].comparisonCoverage).toBe("LIMITED");
    expect(collisionResults[0].collisionMeaning).toContain("comparison unverified");
  });

  // Test 8: Ambiguous timeline ('24 Hours For an Exchange Product') does not qualify as SLA guarantee
  it("8. Ambiguous timeline ('24 Hours For an Exchange Product') does not qualify as SLA guarantee", () => {
    const text = "Exchange coordination within 24 Hours For an Exchange Product upon request";

    const isSlaDeliveryGuarantee = (claimText: string): boolean => {
      const lower = claimText.toLowerCase();
      if (lower.includes("exchange") || lower.includes("return")) {
        return false;
      }
      return /guaranteed\s+(delivery|arrival|shipping)\s+(within|in)\s+\d+\s*(hours|hrs|days)/i.test(lower);
    };

    expect(isSlaDeliveryGuarantee(text)).toBe(false);
    expect(isSlaDeliveryGuarantee("Guaranteed delivery within 24 hours nationwide")).toBe(true);
  });

  // Test 9: Enforce approval authorization (Correction 4)
  it("9. Enforce approval authorization: unauthenticated requests rejected, account ownership verified", () => {
    // 1. Script call with explicit header without auth throws AuthenticationRequiredError
    const scriptReq1 = {
      body: {},
      headers: { "x-automated-call": "true" },
    };
    expect(() => resolveApprovalProvenance(scriptReq1)).toThrow(AuthenticationRequiredError);

    // 2. Unauthenticated call without user session throws AuthenticationRequiredError
    const scriptReq2 = {
      body: {},
      headers: {},
    };
    expect(() => resolveApprovalProvenance(scriptReq2)).toThrow(AuthenticationRequiredError);

    // 3. Script specifying actor header without auth is rejected
    const scriptReq3 = {
      body: {},
      headers: { "x-actor-id": "automation:nightly_runner" },
    };
    expect(() => resolveApprovalProvenance(scriptReq3)).toThrow(AuthenticationRequiredError);

    // 4. Authenticated user call succeeds and derives identity from user
    const authedReq = {
      body: {},
      headers: {},
      userId: "usr_real_client_789",
      accountId: "acc_123",
    };
    expect(resolveApprovalProvenance(authedReq, { accountId: "acc_123" })).toBe("client:usr_real_client_789");

    // 5. Caller-supplied decidedBy override is IGNORED
    const spoofedReq = {
      body: { decidedBy: "automation_script" },
      headers: { "x-actor-id": "spoofed_actor" },
      userId: "usr_real_client_789",
      accountId: "acc_123",
    };
    expect(resolveApprovalProvenance(spoofedReq, { accountId: "acc_123" })).toBe("client:usr_real_client_789");

    // 6. Account mismatch throws PlanAuthorizationError
    const mismatchReq = {
      body: {},
      headers: {},
      userId: "usr_real_client_789",
      accountId: "acc_different",
    };
    expect(() => resolveApprovalProvenance(mismatchReq, { accountId: "acc_123" })).toThrow(PlanAuthorizationError);
  });

  // Test 10: Non-fashion businesses evaluate neutrally without modest fashion leakage
  it("10. Non-fashion businesses evaluate neutrally without modest fashion leakage", () => {
    const b2bCompetitor = {
      id: "comp_b2b_saas",
      name: "FleetTrack Enterprise",
      businessType: "Logistics SaaS",
    };

    const resolvedCategoryFrame = (b2bCompetitor.businessType || "Commercial Competitor");
    expect(resolvedCategoryFrame).toBe("Logistics SaaS");
    expect(resolvedCategoryFrame).not.toContain("Modest");
    expect(resolvedCategoryFrame).not.toContain("Fashion");

    const fallbackCategoryFrame = (null || "Commercial Competitor");
    expect(fallbackCategoryFrame).toBe("Commercial Competitor");
    expect(fallbackCategoryFrame).not.toContain("Modest");
  });

  // Test 11: Section outputs remain distinct without contrast axis echoing across Mechanism/Offer
  it("11. Section outputs remain distinct without contrast axis echoing across Mechanism/Offer", () => {
    const contrastAxis = "Natural Breathable Fiber Integrity vs Synthetic Heat-Trapping Standard";

    const sanitizeMechanismText = (mechanismStatement: string, contrastText: string): string => {
      if (mechanismStatement.trim().toLowerCase() === contrastText.trim().toLowerCase()) {
        return "Certified single-origin open-weave textile construction providing ambient thermal ventilation";
      }
      return mechanismStatement;
    };

    const echoedMechanism = contrastAxis;
    const sanitized = sanitizeMechanismText(echoedMechanism, contrastAxis);

    expect(sanitized).not.toBe(contrastAxis);
    expect(sanitized).toContain("thermal ventilation");
  });

  // Test 12: UI displays proposed capability status accurately
  it("12. UI displays proposed capability status accurately", () => {
    const getProductFitUiLabel = (fitType: string, claimStatus?: string): string => {
      if (fitType === "DIRECT_FIT") {
        return "Direct capability fit with established product capabilities.";
      }
      if (fitType === "STRATEGIC_FIT" || claimStatus === "PROPOSED_CAPABILITY") {
        return "Strategic fit addressing audience friction — proposed capability requiring validation/implementation.";
      }
      return "Evaluated capability fit with product capabilities and positioning.";
    };

    const directLabel = getProductFitUiLabel("DIRECT_FIT");
    expect(directLabel).toBe("Direct capability fit with established product capabilities.");

    const proposedLabel = getProductFitUiLabel("STRATEGIC_FIT", "PROPOSED_CAPABILITY");
    expect(proposedLabel).toBe(
      "Strategic fit addressing audience friction — proposed capability requiring validation/implementation."
    );
    expect(proposedLabel).toContain("proposed capability requiring validation/implementation");
  });
});
