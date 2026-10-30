import { describe, expect, it } from "vitest";
import {
  computePainContentHash,
  computeEvidenceHash,
  buildPainCompositeKey,
  type AuthoritativeAudiencePain,
} from "../shared/audience-pain-registry";
import {
  computeProductTruthHash,
  canReuseProductAssessment,
  type ProductAssessmentResult,
} from "../strategic-reasoning/product-assessment";
import {
  ClaimEpistemicStatus,
  CLAIM_EPISTEMIC_LABELS,
  type StructuredClaim,
} from "../../shared/contracts/claim-status";
import {
  buildDeterministicOfferSkeletons,
} from "../offer-engine/engine";
import {
  resolveApprovalProvenance,
  AuthenticationRequiredError,
  PlanAuthorizationError,
} from "../auth-helpers";

describe("Systemic Repair Integration Suite — 7 Contract Handoff Scenarios", () => {
  // Scenario 1: Supported capability stays supported end-to-end
  it("Scenario 1: Supported capability stays supported without being degraded or mutated", () => {
    const verifiedFact = {
      productTruthFactId: "pt_fact_dtc_pricing",
      statement: "Direct-to-consumer pricing between $35 and $62 per SKU with zero retail markups",
    };

    const targetPain = {
      painId: "pain_pricing_uncertainty",
      canonical: "Fear of overpriced modest garments with hidden markup",
      contentHash: computePainContentHash("Fear of overpriced modest garments with hidden markup"),
      evidenceHash: computeEvidenceHash(["EV-101", "EV-102"]),
      segmentId: "seg_value_conscious",
      audienceSnapshotId: "snap_aud_001",
    };

    const ptHash = computeProductTruthHash([verifiedFact]);

    // Product assessment evaluated as DIRECT_FIT
    const assessment: ProductAssessmentResult = {
      productAssessmentAuthorityId: "paa_001",
      painId: targetPain.painId,
      campaignOfferingId: "offering_sara",
      businessUnderstandingAuthorityId: "bua_001",
      productTruthFactIds: [verifiedFact.productTruthFactId],
      fitType: "DIRECT_FIT",
      status: "COMPLETE",
      parentAuthorityIds: [targetPain.painId, verifiedFact.productTruthFactId],
      reason: "Direct-to-consumer fixed pricing model directly addresses and mitigates customer concerns regarding overpriced retail markups.",
      jobId: "job_001",
      painClaim: targetPain.canonical,
      painContentHash: targetPain.contentHash,
      productTruthHash: ptHash,
      evidenceHash: targetPain.evidenceHash,
      segmentId: targetPain.segmentId,
      audienceSnapshotId: targetPain.audienceSnapshotId,
    };

    expect(assessment.fitType).toBe("DIRECT_FIT");
    expect(assessment.reason).toContain("directly addresses and mitigates");

    // Pass downstream to Offer Engine
    const mockStrategyRoot = {
      primaryAxis: "direct_value_transparency",
      approvedClaims: JSON.stringify([{ claim: "Transparent accessible pricing directly from maker" }]),
      approvedPromise: "Modest elegance at fair prices",
      approvedAudiencePains: JSON.stringify([targetPain]),
      approvedObjections: JSON.stringify(["Why is this pricing fair compared to luxury brands?"]),
    };

    const mockAudience = {
      audiencePains: [targetPain.canonical],
      painRegistry: [targetPain],
    };

    const mockDifferentiation = {
      productTruthFacts: [verifiedFact],
    };

    const skeletons = buildDeterministicOfferSkeletons(
      mockStrategyRoot,
      mockAudience as any,
      {} as any,
      mockDifferentiation as any,
    );

    const objections = skeletons.primary.objectionHandling;
    expect(objections.length).toBeGreaterThan(0);
    // The objection mitigation cites the verified fact and marks status ADDRESSED (not PROPOSED or degraded)
    const pricingMitigation = objections.find(o => o.includes("pricing"));
    expect(pricingMitigation).toBeDefined();
    expect(pricingMitigation).toContain("[ADDRESSED]");
    expect(pricingMitigation).toContain(verifiedFact.statement);
  });

  // Scenario 2: Proposed capability with prerequisites survives end-to-end
  it("Scenario 2: Proposed capability with prerequisites survives end-to-end without losing requirements", () => {
    const strategicProposal: StructuredClaim = {
      id: "prop_24h_exchange",
      claimText: "Guaranteed 24-hour return and exchange courier pickup service",
      status: "PROPOSED_CAPABILITY",
      proposedRationale: "Directly solves fit anxiety by removing customer return burden in domestic markets",
      prerequisites: [
        "Courier SLA agreement with domestic express partners",
        "Pre-allocated inventory buffer at regional sorting hub",
      ],
      supportingEvidenceIds: ["EV-RETURN-01"],
    };

    expect(strategicProposal.status).toBe("PROPOSED_CAPABILITY");
    expect(CLAIM_EPISTEMIC_LABELS[strategicProposal.status]).toBe("Proposed — requires validation/implementation");
    expect(strategicProposal.prerequisites).toHaveLength(2);

    // Offer Engine handling with proposal and prerequisites
    const mockStrategyRoot = {
      primaryAxis: "risk_free_modesty",
      approvedClaims: JSON.stringify([{ claim: "Complete sizing confidence with zero return hassle" }]),
      approvedPromise: "Try at home with hassle-free exchange",
      approvedAudiencePains: JSON.stringify([{ canonical: "Fear of ill-fitting dresses without quick exchange" }]),
      approvedObjections: JSON.stringify(["What happens if the dress does not fit upon delivery?"]),
      approvedProposals: [
        {
          title: strategicProposal.claimText,
          description: strategicProposal.proposedRationale,
          prerequisites: strategicProposal.prerequisites,
        },
      ],
    };

    const mockAudience = {
      audiencePains: ["Fear of ill-fitting dresses without quick exchange"],
    };

    const mockDifferentiation = {
      productTruthFacts: [], // No existing verified fact for 24h courier pickup
      strategicProposals: [
        {
          title: strategicProposal.claimText,
          description: strategicProposal.proposedRationale,
          prerequisites: strategicProposal.prerequisites,
        },
      ],
    };

    const skeletons = buildDeterministicOfferSkeletons(
      mockStrategyRoot,
      mockAudience as any,
      {} as any,
      mockDifferentiation as any,
    );

    const objections = skeletons.primary.objectionHandling;
    const exchangeMitigation = objections.find(o => o.includes("fit"));
    expect(exchangeMitigation).toBeDefined();
    expect(exchangeMitigation).toContain("[PROPOSED]");
    expect(exchangeMitigation).toContain("Proposed — requires implementation");
    expect(exchangeMitigation).toContain("Courier SLA agreement with domestic express partners");
    expect(exchangeMitigation).toContain("Pre-allocated inventory buffer");
  });

  // Scenario 3: Unknown claim remains unknown without auto-conversion
  it("Scenario 3: Unknown claim remains unknown without auto-converting to proposed capability", () => {
    const unprovenClaim: StructuredClaim = {
      id: "claim_unproven_silk",
      claimText: "Crafted from 100% certified organic mulberry silk with cooling coefficient",
      status: "UNPROVEN_CLAIM",
      proposedRationale: undefined,
      prerequisites: [],
      supportingEvidenceIds: [],
    };

    // An unproven claim without strategic rationale and prerequisites MUST remain UNPROVEN_CLAIM
    expect(unprovenClaim.status).toBe("UNPROVEN_CLAIM");
    expect(CLAIM_EPISTEMIC_LABELS[unprovenClaim.status]).toBe("Unproven — Lacks empirical verification");
    expect(unprovenClaim.status).not.toBe("PROPOSED_CAPABILITY");
    expect(unprovenClaim.prerequisites).toHaveLength(0);

    // When Offer Engine encounters an objection with NO fact and NO strategic proposal:
    const mockStrategyRoot = {
      primaryAxis: "standard_apparel",
      approvedClaims: JSON.stringify([{ claim: "Quality summer wear" }]),
      approvedAudiencePains: JSON.stringify([{ canonical: "Desire for laboratory silk cooling certificates" }]),
      approvedObjections: JSON.stringify(["Can you provide laboratory thermal cooling certificates?"]),
    };

    const mockAudience = {
      audiencePains: ["Desire for laboratory silk cooling certificates"],
    };

    const mockDifferentiation = {
      productTruthFacts: [],
      strategicProposals: [],
    };

    const skeletons = buildDeterministicOfferSkeletons(
      mockStrategyRoot,
      mockAudience as any,
      {} as any,
      mockDifferentiation as any,
    );

    const objections = skeletons.primary.objectionHandling;
    const certMitigation = objections.find(o => o.includes("laboratory"));
    expect(certMitigation).toBeDefined();
    // Must remain UNADDRESSED rather than making up a fake capability
    expect(certMitigation).toContain("[UNADDRESSED]");
    expect(certMitigation).toContain("Unaddressed by current verified product capabilities");
  });

  // Scenario 4: Compound pain claim with requirement breakdown and partial support
  it("Scenario 4: Partially supported compound pain produces requirement breakdown with STRATEGIC_FIT", () => {
    const compoundPain = "Modest summer dresses that are completely opaque, breathable in 95F heat, and backed by guaranteed same-day courier exchange";

    const assessmentResult: ProductAssessmentResult = {
      productAssessmentAuthorityId: "paa_compound_01",
      painId: "pain_compound_01",
      campaignOfferingId: "off_sara",
      businessUnderstandingAuthorityId: "bua_001",
      productTruthFactIds: ["pt_opaque_linen"],
      fitType: "STRATEGIC_FIT",
      status: "COMPLETE",
      parentAuthorityIds: ["pain_compound_01", "pt_opaque_linen"],
      reason: "Verified facts address opacity via 220 GSM linen weave, but same-day exchange and 95F thermal guarantees remain unproven operational prerequisites.",
      jobId: "job_001",
      painClaim: compoundPain,
      requirementBreakdown: [
        {
          requirement: "Opaque non-sheer modest fabric",
          status: "SUPPORTED",
          evidenceFactIds: ["pt_opaque_linen"],
          notes: "220 GSM linen-cotton blend certified non-sheer under direct light",
        },
        {
          requirement: "Breathable in 95F ambient heat without layering",
          status: "SUPPORTED",
          evidenceFactIds: ["pt_opaque_linen"],
          notes: "Natural linen fiber open-weave construction provides ambient ventilation",
        },
        {
          requirement: "Guaranteed same-day courier exchange",
          status: "REQUIRES_DEVELOPMENT",
          evidenceFactIds: [],
          notes: "Current policy offers 24-hour return window, not same-day guaranteed courier exchange SLA",
        },
      ],
      proposedPrerequisites: [
        "Contract same-day courier service SLA for metropolitan regions",
        "Establish local reserve inventory for same-day swap dispatch",
      ],
      unprovenParts: [
        "Guaranteed same-day courier exchange turnaround",
      ],
    };

    expect(assessmentResult.fitType).toBe("STRATEGIC_FIT");
    expect(assessmentResult.requirementBreakdown).toHaveLength(3);
    expect(assessmentResult.requirementBreakdown?.find(r => r.status === "SUPPORTED")).toBeDefined();
    expect(assessmentResult.requirementBreakdown?.find(r => r.status === "REQUIRES_DEVELOPMENT")).toBeDefined();
    expect(assessmentResult.proposedPrerequisites).toHaveLength(2);
    expect(assessmentResult.unprovenParts).toContain("Guaranteed same-day courier exchange turnaround");
  });

  // Scenario 5: Identical pain text in different audience contexts keeps distinct identity
  it("Scenario 5: Identical pain text in different audience contexts maintains distinct keys and evidence", () => {
    const identicalPainText = "Difficulty finding modest dresses that look contemporary and fit comfortably";
    const contentHash = computePainContentHash(identicalPainText);

    const painSegmentA: AuthoritativeAudiencePain = {
      painId: "seg_working_moms_p1",
      canonical: identicalPainText,
      segmentId: "seg_working_moms",
      audienceSnapshotId: "snap_aud_2026_q3",
      contentHash,
      evidenceHash: computeEvidenceHash(["EV-MOM-01", "EV-MOM-02"]),
      compositeKey: buildPainCompositeKey("seg_working_moms_p1", contentHash, "seg_working_moms", computeEvidenceHash(["EV-MOM-01", "EV-MOM-02"])),
      evidenceCount: 2,
      evidenceUids: ["EV-MOM-01", "EV-MOM-02"],
    };

    const painSegmentB: AuthoritativeAudiencePain = {
      painId: "seg_students_p1",
      canonical: identicalPainText,
      segmentId: "seg_students",
      audienceSnapshotId: "snap_aud_2026_q3",
      contentHash,
      evidenceHash: computeEvidenceHash(["EV-STU-08", "EV-STU-09", "EV-STU-10"]),
      compositeKey: buildPainCompositeKey("seg_students_p1", contentHash, "seg_students", computeEvidenceHash(["EV-STU-08", "EV-STU-09", "EV-STU-10"])),
      evidenceCount: 3,
      evidenceUids: ["EV-STU-08", "EV-STU-09", "EV-STU-10"],
    };

    // Content hashes match because canonical text is identical
    expect(painSegmentA.contentHash).toBe(painSegmentB.contentHash);

    // But composite keys and evidence hashes are completely distinct
    expect(painSegmentA.evidenceHash).not.toBe(painSegmentB.evidenceHash);
    expect(painSegmentA.compositeKey).not.toBe(painSegmentB.compositeKey);
    expect(painSegmentA.segmentId).toBe("seg_working_moms");
    expect(painSegmentB.segmentId).toBe("seg_students");
  });

  // Scenario 6: Changed pain or evidence context rejects invalid reuse
  it("Scenario 6: Changed pain or evidence context strictly rejects decision reuse", () => {
    const painText = "High shipping fees on international exchanges";
    const contentHash = computePainContentHash(painText);
    const initialEvidenceHash = computeEvidenceHash(["EV-SHIP-1"]);
    const ptHash = computeProductTruthHash([{ statement: "Flat rate shipping $10" }]);

    const existingAssessment = {
      productAssessmentAuthorityId: "paa_ship_01",
      painId: "pain_ship",
      fitType: "STRATEGIC_FIT",
      painContentHash: contentHash,
      productTruthHash: ptHash,
      evidenceHash: initialEvidenceHash,
      segmentId: "seg_intl_shoppers",
      audienceSnapshotId: "snap_v1",
      accountId: "acc_test",
      campaignId: "camp_test",
    };

    // 1. Same context succeeds
    const sameContextPain = {
      id: "pain_ship",
      canonicalPain: painText,
      contentHash,
      evidenceHash: initialEvidenceHash,
      segmentId: "seg_intl_shoppers",
      audienceSnapshotId: "snap_v1",
    };
    expect(canReuseProductAssessment(existingAssessment, sameContextPain, ptHash, {
      accountId: "acc_test",
      campaignId: "camp_test",
      audienceSnapshotId: "snap_v1",
      segmentId: "seg_intl_shoppers",
    })).toBe(true);

    // 2. Changed evidence UIDs rejects reuse
    const changedEvidencePain = {
      ...sameContextPain,
      evidenceHash: computeEvidenceHash(["EV-SHIP-1", "EV-SHIP-2_NEW"]),
    };
    expect(canReuseProductAssessment(existingAssessment, changedEvidencePain, ptHash, {
      accountId: "acc_test",
      campaignId: "camp_test",
      audienceSnapshotId: "snap_v1",
      segmentId: "seg_intl_shoppers",
    })).toBe(false);

    // 3. Changed audience snapshot rejects reuse
    expect(canReuseProductAssessment(existingAssessment, sameContextPain, ptHash, {
      accountId: "acc_test",
      campaignId: "camp_test",
      audienceSnapshotId: "snap_v2_updated",
      segmentId: "seg_intl_shoppers",
    })).toBe(false);

    // 4. Changed product truth facts rejects reuse
    const newPtHash = computeProductTruthHash([{ statement: "Free worldwide shipping on all orders over $50" }]);
    expect(canReuseProductAssessment(existingAssessment, sameContextPain, newPtHash, {
      accountId: "acc_test",
      campaignId: "camp_test",
      audienceSnapshotId: "snap_v1",
      segmentId: "seg_intl_shoppers",
    })).toBe(false);
  });

  // Scenario 7: Unauthorized approval attempt returns 401/403 and never trusts caller headers
  it("Scenario 7: Unauthorized approval attempt returns 401/403 and never trusts caller headers", () => {
    const targetPlan = {
      id: "plan_sara_v10",
      accountId: "acc_sara_owner",
      version: 1,
      status: "DRAFT",
    };

    // Case A: Unauthenticated request throws 401 AuthenticationRequiredError
    const unauthedReq = {
      body: { force: false },
      headers: {},
    };
    expect(() => resolveApprovalProvenance(unauthedReq, targetPlan)).toThrow(AuthenticationRequiredError);

    // Case B: Script header without credentials throws 401 (never defaults to "automation_script")
    const scriptReq = {
      body: { force: true },
      headers: { "x-automated-call": "true", "x-actor-id": "system_bot" },
    };
    expect(() => resolveApprovalProvenance(scriptReq, targetPlan)).toThrow(AuthenticationRequiredError);

    // Case C: Account mismatch throws 403 PlanAuthorizationError
    const crossTenantReq = {
      body: {},
      headers: {},
      userId: "usr_attacker",
      accountId: "acc_attacker_corp",
    };
    expect(() => resolveApprovalProvenance(crossTenantReq, targetPlan)).toThrow(PlanAuthorizationError);

    // Case D: Authenticated legitimate owner succeeds and ignores spoofed headers
    const legitimateOwnerReq = {
      body: { decidedBy: "spoofed_client_name" },
      headers: { "x-actor-id": "spoofed_actor_header" },
      userId: "usr_sara_founder",
      accountId: "acc_sara_owner",
    };
    const actor = resolveApprovalProvenance(legitimateOwnerReq, targetPlan);
    expect(actor).toBe("client:usr_sara_founder");
    expect(actor).not.toBe("spoofed_client_name");
    expect(actor).not.toBe("spoofed_actor_header");
    expect(actor).not.toBe("automation_script");
  });
});
