import type { StrategicCandidate } from "./strategic-selection";

export type ComparativeVerdict = "ACCEPT_WINNER" | "RESELECT" | "NO_CLEAR_WINNER";

export interface ComparativeJudgeResult {
  verdict: ComparativeVerdict;
  reason: string;
  reselectCandidates?: string[];
}

export function runComparativeSelection(
  engineId: string,
  engineResponsibility: string,
  eligibleCandidates: StrategicCandidate[],
  proposedWinner: StrategicCandidate | null,
  proposedAlternatives: StrategicCandidate[],
  selectionStatus: string,
  decisionMargin: number,
  winnerReason: string
): ComparativeJudgeResult {
  if (!proposedWinner) {
    if (selectionStatus === "NO_ELIGIBLE") {
      return { verdict: "NO_CLEAR_WINNER", reason: "No eligible candidates were proposed." };
    }
    return { verdict: "NO_CLEAR_WINNER", reason: "No winner proposed." };
  }

  // 1. Eligibility Check
  if (proposedWinner.eligibilityStatus === "INELIGIBLE") {
    return {
      verdict: "RESELECT",
      reason: `Proposed winner ${proposedWinner.candidateId} is ineligible: ${proposedWinner.rejectionReasons?.join("; ")}`,
      reselectCandidates: proposedAlternatives.filter(a => a.eligibilityStatus === "ELIGIBLE").map(a => a.candidateId)
    };
  }

  // 2. Semantic Entailment validation
  if (proposedWinner.semanticEntailment === "UNSUPPORTED_EXPANSION" || proposedWinner.semanticEntailment === "CONTRADICTED") {
    return {
      verdict: "RESELECT",
      reason: `Proposed winner ${proposedWinner.candidateId} violates semantic entailment: ${proposedWinner.semanticEntailment}`,
      reselectCandidates: proposedAlternatives.filter(a => a.eligibilityStatus === "ELIGIBLE" && a.semanticEntailment !== "UNSUPPORTED_EXPANSION").map(a => a.candidateId)
    };
  }

  // 3. Engine responsibility fit check
  const proposedWinnerFit = proposedWinner.engineResponsibilityFit ?? 0.5;
  if (proposedWinnerFit < 0.2) {
    return {
      verdict: "RESELECT",
      reason: `Proposed winner ${proposedWinner.candidateId} has poor fit for engine responsibility (${proposedWinnerFit})`,
      reselectCandidates: proposedAlternatives.filter(a => (a.engineResponsibilityFit ?? 0.5) > proposedWinnerFit).map(a => a.candidateId)
    };
  }

  // 4. Check if a materially stronger alternative was ignored
  for (const alt of proposedAlternatives) {
    if (alt.eligibilityStatus === "ELIGIBLE" && (alt.engineResponsibilityFit ?? 0.5) > 0.8 && (proposedWinner.engineResponsibilityFit ?? 0.5) < 0.5) {
      return {
        verdict: "RESELECT",
        reason: `Materially stronger alternative ${alt.candidateId} was ignored (fit ${alt.engineResponsibilityFit} vs winner ${proposedWinner.engineResponsibilityFit})`,
        reselectCandidates: [alt.candidateId]
      };
    }
  }

  // 5. Check CLOSE_ALTERNATIVES status alignment
  if (selectionStatus === "CLOSE_ALTERNATIVES") {
    return {
      verdict: "NO_CLEAR_WINNER",
      reason: `Materially close candidates exist (decision margin ${decisionMargin.toFixed(3)} < threshold). Preserving uncertainty.`
    };
  }

  return {
    verdict: "ACCEPT_WINNER",
    reason: `Comparative judge accepted proposed winner ${proposedWinner.candidateId} for engine ${engineId}.`
  };
}
