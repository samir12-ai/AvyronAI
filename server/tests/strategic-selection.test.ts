import { describe, it, expect } from "vitest";
import { runStrategicSelection, type StrategicCandidate } from "../shared/strategic-selection";
import { runComparativeSelection } from "../shared/selection-judges";

describe("Task 178 - Strategic Selection & Comparative Judge", () => {
  const allowedPains = ["pain_clarity", "pain_belonging", "pain_complexity", "pain_speed"];
  const validatedCapabilities = ["cap_clarity_accelerator", "cap_community_hub", "cap_speed_engine"];

  // CASE 1 — Community frequent but strategically weak (no peer validation evidence, no capability)
  it("CASE 1: Community frequent but strategically weak should not win", () => {
    const candidates: StrategicCandidate[] = [
      {
        candidateId: "cand_community",
        engineId: "positioning",
        candidateType: "territory",
        statement: "Peer Validation Zone",
        sourcePainIds: ["pain_belonging"],
        requiredCapabilityIds: ["cap_peer_validation"], // absent from validatedCapabilities
        evidenceStrength: 0.9, // high frequency
        purchaseRelevance: 0.2,
        engineResponsibilityFit: 0.3,
        productFit: 0.1,
        confidence: 0.8,
      },
      {
        candidateId: "cand_clarity",
        engineId: "positioning",
        candidateType: "territory",
        statement: "Evidence-Grounded Clarity",
        sourcePainIds: ["pain_clarity"],
        requiredCapabilityIds: ["cap_clarity_accelerator"],
        evidenceStrength: 0.6,
        purchaseRelevance: 0.9,
        engineResponsibilityFit: 0.9,
        productFit: 0.9,
        confidence: 0.7,
      }
    ];

    const result = runStrategicSelection(candidates, "positioning", "Positioning Responsibility", validatedCapabilities, allowedPains);
    expect(result.winner).not.toBeNull();
    expect(result.winner?.candidateId).toBe("cand_clarity");
  });

  // CASE 2 — Community genuinely strong
  it("CASE 2: Community can win if genuinely supported by evidence and capability", () => {
    const candidates: StrategicCandidate[] = [
      {
        candidateId: "cand_community",
        engineId: "positioning",
        candidateType: "territory",
        statement: "Community Hub",
        sourcePainIds: ["pain_belonging"],
        requiredCapabilityIds: ["cap_community_hub"],
        evidenceStrength: 0.9,
        purchaseRelevance: 0.8,
        engineResponsibilityFit: 0.8,
        productFit: 0.9,
        confidence: 0.8,
      },
      {
        candidateId: "cand_clarity",
        engineId: "positioning",
        candidateType: "territory",
        statement: "Evidence-Grounded Clarity",
        sourcePainIds: ["pain_clarity"],
        requiredCapabilityIds: ["cap_clarity_accelerator"],
        evidenceStrength: 0.5,
        purchaseRelevance: 0.6,
        engineResponsibilityFit: 0.6,
        productFit: 0.6,
        confidence: 0.7,
      }
    ];

    const result = runStrategicSelection(candidates, "positioning", "Positioning Responsibility", validatedCapabilities, allowedPains);
    expect(result.winner?.candidateId).toBe("cand_community");
  });

  // CASE 3 — Lower-frequency but purchase-relevant
  it("CASE 3: Lower-frequency candidate may win if it has strong buying relevance/product fit", () => {
    const candidates: StrategicCandidate[] = [
      {
        candidateId: "cand_low_freq_high_fit",
        engineId: "differentiation",
        candidateType: "pillar",
        statement: "Speed Engine",
        sourcePainIds: ["pain_speed"],
        requiredCapabilityIds: ["cap_speed_engine"],
        evidenceStrength: 0.3, // low frequency
        purchaseRelevance: 0.95,
        engineResponsibilityFit: 0.9,
        productFit: 0.95,
        confidence: 0.7,
      },
      {
        candidateId: "cand_high_freq_low_fit",
        engineId: "differentiation",
        candidateType: "pillar",
        statement: "Social Belonging",
        sourcePainIds: ["pain_belonging"],
        requiredCapabilityIds: ["cap_community_hub"],
        evidenceStrength: 0.85,
        purchaseRelevance: 0.3,
        engineResponsibilityFit: 0.4,
        productFit: 0.4,
        confidence: 0.8,
      }
    ];

    const result = runStrategicSelection(candidates, "differentiation", "Differentiation", validatedCapabilities, allowedPains);
    expect(result.winner?.candidateId).toBe("cand_low_freq_high_fit");
  });

  // CASE 4 — Highest-ranked eligible is not best
  it("CASE 4: Highest-ranked eligible candidate does not auto-win if responsibility fit is poor", () => {
    const candidates: StrategicCandidate[] = [
      {
        candidateId: "cand_top_rank_poor_fit",
        engineId: "differentiation",
        candidateType: "pillar",
        statement: "Generic Concept",
        sourcePainIds: ["pain_speed"],
        requiredCapabilityIds: ["cap_speed_engine"],
        evidenceStrength: 0.9, // highest rank
        purchaseRelevance: 0.3,
        engineResponsibilityFit: 0.2, // poor fit
        productFit: 0.4,
        confidence: 0.8,
      },
      {
        candidateId: "cand_med_rank_great_fit",
        engineId: "differentiation",
        candidateType: "pillar",
        statement: "Tailored Speed Pillar",
        sourcePainIds: ["pain_speed"],
        requiredCapabilityIds: ["cap_speed_engine"],
        evidenceStrength: 0.6,
        purchaseRelevance: 0.9,
        engineResponsibilityFit: 0.9,
        productFit: 0.9,
        confidence: 0.7,
      }
    ];

    const result = runStrategicSelection(candidates, "differentiation", "Differentiation", validatedCapabilities, allowedPains);
    expect(result.winner?.candidateId).toBe("cand_med_rank_great_fit");
  });

  // CASE 5 — Unsupported semantic expansion
  it("CASE 5: Rejects candidate with unsupported semantic expansion", () => {
    const candidates: StrategicCandidate[] = [
      {
        candidateId: "cand_unsupported_exp",
        engineId: "positioning",
        candidateType: "territory",
        statement: "Peer Review Network",
        sourcePainIds: ["pain_belonging"],
        requiredCapabilityIds: ["cap_community_hub"],
        semanticEntailment: "UNSUPPORTED_EXPANSION", // fails entailment
        evidenceStrength: 0.8,
        purchaseRelevance: 0.8,
        engineResponsibilityFit: 0.8,
        productFit: 0.8,
      }
    ];

    const result = runStrategicSelection(candidates, "positioning", "Positioning", validatedCapabilities, allowedPains);
    expect(result.selectionStatus).toBe("NO_ELIGIBLE");
  });

  // CASE 6 — Supported semantic interpretation
  it("CASE 6: Allows candidate with supported semantic interpretation", () => {
    const candidates: StrategicCandidate[] = [
      {
        candidateId: "cand_supported_exp",
        engineId: "positioning",
        candidateType: "territory",
        statement: "Verified Community Feedback",
        sourcePainIds: ["pain_belonging"],
        requiredCapabilityIds: ["cap_community_hub"],
        semanticEntailment: "ENTAILED",
        evidenceStrength: 0.8,
        purchaseRelevance: 0.8,
        engineResponsibilityFit: 0.8,
        productFit: 0.8,
      }
    ];

    const result = runStrategicSelection(candidates, "positioning", "Positioning", validatedCapabilities, allowedPains);
    expect(result.winner?.candidateId).toBe("cand_supported_exp");
  });

  // CASE 7 — Unsupported capability
  it("CASE 7: Rejects candidate requiring unsupported capability", () => {
    const candidates: StrategicCandidate[] = [
      {
        candidateId: "cand_unsupported_cap",
        engineId: "positioning",
        candidateType: "territory",
        statement: "Community Validate",
        sourcePainIds: ["pain_belonging"],
        requiredCapabilityIds: ["cap_non_existent"], // unsupported
        evidenceStrength: 0.8,
      }
    ];

    const result = runStrategicSelection(candidates, "positioning", "Positioning", validatedCapabilities, allowedPains);
    expect(result.selectionStatus).toBe("NO_ELIGIBLE");
  });

  // CASE 8 — Product-supported capability
  it("CASE 8: Allows candidate when capability is supported", () => {
    const candidates: StrategicCandidate[] = [
      {
        candidateId: "cand_supported_cap",
        engineId: "positioning",
        candidateType: "territory",
        statement: "Community Hub",
        sourcePainIds: ["pain_belonging"],
        requiredCapabilityIds: ["cap_community_hub"], // supported
        evidenceStrength: 0.8,
      }
    ];

    const result = runStrategicSelection(candidates, "positioning", "Positioning", validatedCapabilities, allowedPains);
    expect(result.winner?.candidateId).toBe("cand_supported_cap");
  });

  // CASE 9 — Array-order invariance
  it("CASE 9: Selection remains same regardless of candidate array order", () => {
    const c1: StrategicCandidate = {
      candidateId: "cand_a",
      engineId: "mechanism",
      candidateType: "axis",
      statement: "Statement A",
      evidenceStrength: 0.5,
      purchaseRelevance: 0.5,
      engineResponsibilityFit: 0.5,
      productFit: 0.5,
    };
    const c2: StrategicCandidate = {
      candidateId: "cand_b",
      engineId: "mechanism",
      candidateType: "axis",
      statement: "Statement B",
      evidenceStrength: 0.55,
      purchaseRelevance: 0.55,
      engineResponsibilityFit: 0.55,
      productFit: 0.55,
    };

    const resultNormal = runStrategicSelection([c1, c2], "mechanism", "Mechanism", validatedCapabilities, allowedPains);
    const resultReversed = runStrategicSelection([c2, c1], "mechanism", "Mechanism", validatedCapabilities, allowedPains);

    expect(resultNormal.winner?.candidateId).toBe(resultReversed.winner?.candidateId);
    expect(resultNormal.winner?.candidateId).toBe("cand_b");
  });

  // CASE 11 — Different engine responsibilities
  it("CASE 11: Different engines may select different winners based on their responsibility fits", () => {
    const candidates: StrategicCandidate[] = [
      {
        candidateId: "cand_speed",
        engineId: "multiple",
        candidateType: "axis",
        statement: "Speed",
        evidenceStrength: 0.8,
        purchaseRelevance: 0.8,
        engineResponsibilityFit: 0.9, // strong fit for positioning
        productFit: 0.8,
      },
      {
        candidateId: "cand_clarity",
        engineId: "multiple",
        candidateType: "axis",
        statement: "Clarity",
        evidenceStrength: 0.8,
        purchaseRelevance: 0.8,
        engineResponsibilityFit: 0.3, // poor fit for positioning, but maybe strong for retention
        productFit: 0.8,
      }
    ];

    const resultPos = runStrategicSelection(candidates, "positioning", "Positioning", validatedCapabilities, allowedPains);
    
    // adjust fits for retention
    candidates[0].engineResponsibilityFit = 0.3;
    candidates[1].engineResponsibilityFit = 0.95;
    
    const resultRet = runStrategicSelection(candidates, "retention", "Retention", validatedCapabilities, allowedPains);

    expect(resultPos.winner?.candidateId).toBe("cand_speed");
    expect(resultRet.winner?.candidateId).toBe("cand_clarity");
  });

  // CASE 12 — No clear winner (CLOSE_ALTERNATIVES)
  it("CASE 12: Detects CLOSE_ALTERNATIVES when margins are too narrow", () => {
    const candidates: StrategicCandidate[] = [
      {
        candidateId: "cand_a",
        engineId: "funnel",
        candidateType: "barrier",
        statement: "Barrier A",
        evidenceStrength: 0.8,
        purchaseRelevance: 0.8,
        engineResponsibilityFit: 0.8,
        productFit: 0.8,
      },
      {
        candidateId: "cand_b",
        engineId: "funnel",
        candidateType: "barrier",
        statement: "Barrier B",
        evidenceStrength: 0.79, // very close score
        purchaseRelevance: 0.8,
        engineResponsibilityFit: 0.8,
        productFit: 0.8,
      }
    ];

    const result = runStrategicSelection(candidates, "funnel", "Funnel", validatedCapabilities, allowedPains, { marginThreshold: 0.05 });
    expect(result.selectionStatus).toBe("CLOSE_ALTERNATIVES");
  });

  // CASE 13 — Absolute-valid but comparatively inferior
  it("CASE 13: Comparative judge rejects proposed winner if a materially stronger alternative exists", () => {
    const eligible: StrategicCandidate[] = [
      {
        candidateId: "cand_weak",
        engineId: "positioning",
        candidateType: "territory",
        statement: "Weak Territory",
        eligibilityStatus: "ELIGIBLE",
        engineResponsibilityFit: 0.4,
      },
      {
        candidateId: "cand_strong",
        engineId: "positioning",
        candidateType: "territory",
        statement: "Strong Territory",
        eligibilityStatus: "ELIGIBLE",
        engineResponsibilityFit: 0.9,
      }
    ];

    const verdict = runComparativeSelection(
      "positioning",
      "Positioning",
      eligible,
      eligible[0], // proposed weak candidate as winner
      [eligible[1]],
      "WINNER",
      0.1,
      "reasons"
    );

    expect(verdict.verdict).toBe("RESELECT");
    expect(verdict.reselectCandidates).toContain("cand_strong");
  });
});
