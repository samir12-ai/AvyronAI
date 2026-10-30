import { describe, it, expect } from "vitest";
import {
  evaluateClaimSemanticEntailment,
  extractAssertionSemanticProperties,
  detectAssertionModality,
} from "../shared/claim-entailment";
import {
  ClaimEpistemicStatus,
  CLAIM_EPISTEMIC_LABELS,
  ObjectionResolutionStatus,
} from "../../shared/contracts/claim-status";
import { sanitizeStrategicSummaryEpistemics } from "../orchestrator/plan-synthesis";

describe("Systemic Claim-Status & Semantic Entailment Repair Test Suite", () => {
  const verifiedFashionEvidence = [
    "The dresses are crafted with premium fabrics to ensure long-lasting wear and comfort.",
    "Summer dresses catalog pricing ranges from $35 to $62 across transparent SKU listings.",
    "24-hour product exchange capability.",
    "Detailed silhouette and garment measurement guides provided across all SKU listings.",
  ];

  const verifiedSaaSEvidence = [
    "Platform architecture provides automated anomaly detection and ML-powered telemetry alerts.",
    "100% SLA credit reimbursement provided in the event of unscheduled service interruptions.",
    "RESTful API integration documentation and webhooks available for standard data export.",
  ];

  // Test 1: Vocabulary overlap vs unsupported expansion (fabric/linen vs opacity)
  it("Test 1: Rejects unsupported property expansion despite high vocabulary overlap (fabric/craftsmanship vs opacity)", () => {
    const ungroundedAssertion =
      "Fabric quality & opacity addressed via verified premium craftsmanship.";

    const result = evaluateClaimSemanticEntailment(
      ungroundedAssertion,
      verifiedFashionEvidence,
      { isObjectionResolution: true, objectionText: "Fabric sheer and opacity concerns" }
    );

    expect(result.status).toBe("UNSUPPORTED_EXPANSION");
    expect(result.isGrounded).toBe(false);
    expect(result.unsupportedProperties).toContain("fabric_opacity");
    expect(result.suggestedResolutionStatus).toBe("PARTIALLY_MITIGATED");
  });

  // Test 2: SaaS SLA expansion (uptime vs automated anomaly detection / 100% SLA credit)
  it("Test 2: Rejects SaaS SLA inflation (reimbursement credit vs 99.99% zero-downtime uptime guarantee)", () => {
    const inflatedSaaSAssertion =
      "Guaranteed 99.99% uptime with fault-tolerant zero downtime infrastructure.";

    const result = evaluateClaimSemanticEntailment(
      inflatedSaaSAssertion,
      verifiedSaaSEvidence
    );

    expect(result.status).toBe("UNSUPPORTED_EXPANSION");
    expect(result.isGrounded).toBe(false);
    expect(result.unsupportedProperties).toContain("high_availability_uptime");
    expect(result.epistemicStatus).toBe(ClaimEpistemicStatus.UNPROVEN_CLAIM);
  });

  // Test 3: Supported paraphrases (natural linen / fine cotton)
  it("Test 3: Accepts genuine supported paraphrases even with low lexical overlap", () => {
    const supportedParaphrase =
      "Curated dresses made from durable, high-quality textiles ensuring lasting wear.";

    const result = evaluateClaimSemanticEntailment(
      supportedParaphrase,
      verifiedFashionEvidence
    );

    expect(result.status).toBe("ENTAILED");
    expect(result.isGrounded).toBe(true);
    expect(result.unsupportedProperties).toHaveLength(0);
    expect(result.epistemicStatus).toBe(ClaimEpistemicStatus.SUPPORTED_CAPABILITY);
  });

  // Test 4: prohibitedUses: ['offer_objection'] enforcement
  it("Test 4: Enforces assessment restrictions (prohibitedUses: ['offer_objection']) and blocks ADDRESSED status", () => {
    const candidateResolution =
      "[ADDRESSED] Fabric sheer concerns resolved through premium textile selection.";

    const result = evaluateClaimSemanticEntailment(
      candidateResolution,
      verifiedFashionEvidence,
      {
        isObjectionResolution: true,
        prohibitedUses: ["offer_objection"],
        proofGap: "Physical lab opacity certification absent",
      }
    );

    expect(result.status).toBe("UNSUPPORTED_EXPANSION");
    expect(result.isGrounded).toBe(false);
    expect(result.suggestedResolutionStatus).toBe("PARTIALLY_MITIGATED");
    expect(result.explanation).toContain("prohibitedUses: ['offer_objection']");
  });

  // Test 5: Turnaround SLA inflation on ambiguous 24-hr exchange
  it("Test 5: Prevents inflating ambiguous '24-hour exchange capability' into turnaround dispatch guarantee", () => {
    const inflatedTurnaroundClaim =
      "Guaranteed 24-hour exchange turnaround with replacement dispatched within 24 hours.";

    const result = evaluateClaimSemanticEntailment(
      inflatedTurnaroundClaim,
      verifiedFashionEvidence
    );

    expect(result.status).toBe("UNSUPPORTED_EXPANSION");
    expect(result.isGrounded).toBe(false);
    expect(result.unsupportedProperties).toContain("turnaround_exchange_guarantee");
    expect(result.explanation).toContain("24-hour exchange capability");
  });

  // Test 6: Separation of capability status from objection resolution
  it("Test 6: Correctly separates capability epistemic status (SUPPORTED_CAPABILITY) from objection resolution status (PARTIALLY_MITIGATED)", () => {
    const operationalMitigation =
      "24-hour product exchange policy lowers purchase risk if fabric or fit does not meet expectations.";

    const result = evaluateClaimSemanticEntailment(
      operationalMitigation,
      verifiedFashionEvidence,
      {
        isObjectionResolution: true,
        objectionText: "Concerns regarding fabric sheer and opacity",
      }
    );

    expect(result.status).toBe("PARTIALLY_ENTAILED");
    expect(result.isGrounded).toBe(true);
    // Epistemic status of the operational exchange policy itself is verified and supported:
    expect(result.epistemicStatus).toBe(ClaimEpistemicStatus.SUPPORTED_CAPABILITY);
    // But the objection resolution status for the unverified physical property is strictly PARTIALLY_MITIGATED:
    expect(result.suggestedResolutionStatus).toBe("PARTIALLY_MITIGATED");
  });

  // Test 7: Compound objections with physical concerns
  it("Test 7: Handles compound objections where only one dimension is supported", () => {
    const compoundObjection = "Dresses are sheer and sizing measurements are inconsistent.";
    const sizingOnlyResolution =
      "[ADDRESSED] Sizing precision assured through detailed garment measurement guides.";

    // Candidate falsely claims the compound objection is ADDRESSED while opacity is unevidenced
    const result = evaluateClaimSemanticEntailment(
      sizingOnlyResolution,
      verifiedFashionEvidence,
      {
        isObjectionResolution: true,
        objectionText: compoundObjection,
      }
    );

    expect(result.status).toBe("UNSUPPORTED_EXPANSION");
    expect(result.suggestedResolutionStatus).toBe("PARTIALLY_MITIGATED");
  });

  // Test 8: Label-prose contradiction detection
  it("Test 8: Detects label-prose contradiction when marked [PROPOSED] but prose claims already certified/proven", () => {
    const contradictoryStatement =
      "[PROPOSED] Opacity Standard: Dresses are already certified and proven 100% opaque by test.";

    const result = evaluateClaimSemanticEntailment(
      contradictoryStatement,
      verifiedFashionEvidence
    );

    expect(result.status).toBe("CONTRADICTED");
    expect(result.isGrounded).toBe(false);
    expect(result.explanation).toContain("Label-prose contradiction");
    expect(result.epistemicStatus).toBe(ClaimEpistemicStatus.UNPROVEN_CLAIM);
  });

  // Test 9: Legitimate proposed capability with prerequisites survives
  it("Test 9: Validates legitimate proposed capability with documented prerequisites", () => {
    const proposedCapability =
      "[PROPOSED] Independent Lab Opacity Verification (Prerequisites: Partner with certified testing lab, define 100-wash threshold).";

    const result = evaluateClaimSemanticEntailment(
      proposedCapability,
      verifiedFashionEvidence
    );

    expect(result.status).toBe("ENTAILED");
    expect(result.isGrounded).toBe(true);
    expect(result.epistemicStatus).toBe(ClaimEpistemicStatus.PROPOSED_CAPABILITY);
    expect(result.suggestedResolutionStatus).toBe("PROPOSED");
    expect(result.prerequisites?.length).toBeGreaterThan(0);
  });

  // Test 10: Plan synthesis executive summary qualification preservation
  it("Test 10: Reconciles and sanitizes executive summary so qualified or unverified claims are not upgraded", () => {
    const ungroundedStrategyProse =
      "The strategy positions the brand as offering curated dresses crafted with premium fabrics designed for opacity, going beyond proven comfort and opacity with a guaranteed 24-hour exchange turnaround.";

    const sanitizedProse = sanitizeStrategicSummaryEpistemics(
      ungroundedStrategyProse,
      verifiedFashionEvidence
    );

    expect(sanitizedProse).not.toContain("designed for opacity");
    expect(sanitizedProse).not.toContain("proven comfort and opacity");
    expect(sanitizedProse).not.toContain("guaranteed 24-hour exchange turnaround");
    expect(sanitizedProse).toContain("24-hour product exchange capability");
    expect(sanitizedProse).toContain("craftsmanship");
  });
});
