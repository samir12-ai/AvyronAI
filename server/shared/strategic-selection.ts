export interface StrategicCandidate {
  candidateId: string;
  engineId: string;
  candidateType: string;
  statement: string;
  
  sourcePainIds?: string[];
  sourceSegmentIds?: string[];
  sourceDesireIds?: string[];
  sourceObjectionIds?: string[];
  sourceRootCauseIds?: string[];
  sourceEvidenceIds?: string[];
  
  requiredCapabilityIds?: string[];
  supportedCapabilityIds?: string[];
  
  evidenceStrength?: number;
  purchaseRelevance?: number;
  engineResponsibilityFit?: number;
  productFit?: number;
  semanticEntailment?: "ENTAILED" | "PARTIALLY_ENTAILED" | "UNSUPPORTED_EXPANSION" | "CONTRADICTED";
  differentiationPotential?: number;
  causalDepth?: number;
  unsupportedAssumptions?: string[];
  semanticExpansionSteps?: string[];
  confidence?: number;
  
  eligibilityStatus?: "ELIGIBLE" | "INELIGIBLE";
  rejectionReasons?: string[];
}

export interface SelectionResult {
  winner: StrategicCandidate | null;
  selectionStatus: "WINNER" | "CLOSE_ALTERNATIVES" | "NO_ELIGIBLE";
  alternatives: StrategicCandidate[];
  winnerReason: string;
  whyAlternativesLost: { candidateId: string; reason: string }[];
  decisionMargin: number;
}

export function runStrategicSelection(
  candidates: StrategicCandidate[],
  engineId: string,
  engineResponsibility: string,
  validatedCapabilities: string[],
  allowedPains: string[],
  options?: {
    marginThreshold?: number;
  }
): SelectionResult {
  const marginThreshold = options?.marginThreshold ?? 0.05;
  const eligibleCandidates: StrategicCandidate[] = [];
  const rejectedCandidates: { candidate: StrategicCandidate; reason: string }[] = [];

  for (const c of candidates) {
    const reasons: string[] = [];
    
    // 1. Authoritative source validation (check allowedPains)
    if (c.sourcePainIds && c.sourcePainIds.length > 0) {
      const allAllowed = c.sourcePainIds.every(id => allowedPains.includes(id));
      if (!allAllowed) {
        reasons.push("Uses pain not allowed for this engine context");
      }
    }

    // 2. Product capability fit (check validatedCapabilities)
    if (c.requiredCapabilityIds && c.requiredCapabilityIds.length > 0) {
      const unsupported = c.requiredCapabilityIds.filter(id => !validatedCapabilities.includes(id));
      if (unsupported.length > 0) {
        reasons.push(`Requires unsupported product capability: ${unsupported.join(", ")}`);
      }
    }

    // 3. Semantic entailment check
    if (c.semanticEntailment === "UNSUPPORTED_EXPANSION" || c.semanticEntailment === "CONTRADICTED") {
      reasons.push(`Fails semantic entailment: ${c.semanticEntailment}`);
    }

    if (reasons.length > 0) {
      c.eligibilityStatus = "INELIGIBLE";
      c.rejectionReasons = reasons;
      rejectedCandidates.push({ candidate: c, reason: reasons.join("; ") });
    } else {
      c.eligibilityStatus = "ELIGIBLE";
      c.rejectionReasons = [];
      eligibleCandidates.push(c);
    }
  }

  if (eligibleCandidates.length === 0) {
    return {
      winner: null,
      selectionStatus: "NO_ELIGIBLE",
      alternatives: [],
      winnerReason: "No candidates passed eligibility checks",
      whyAlternativesLost: rejectedCandidates.map(r => ({ candidateId: r.candidate.candidateId, reason: r.reason })),
      decisionMargin: 0,
    };
  }

  const scoredCandidates = eligibleCandidates.map(c => {
    const ev = c.evidenceStrength ?? 0.5;
    const pr = c.purchaseRelevance ?? 0.5;
    const ef = c.engineResponsibilityFit ?? 0.5;
    const pf = c.productFit ?? 0.5;
    const cd = c.causalDepth ?? 0.5;
    const dp = c.differentiationPotential ?? 0.5;
    const conf = c.confidence ?? 0.5;

    // Saturation limit: cap the raw frequency contribution at 0.8 to prevent frequency dominance.
    // Normalized score calculation.
    const score = ev * 0.2 + pr * 0.2 + ef * 0.2 + pf * 0.15 + cd * 0.1 + dp * 0.1 + conf * 0.05;
    return { candidate: c, score };
  });

  // Stable sort by score desc, fallback to candidateId comparison for order invariance.
  scoredCandidates.sort((a, b) => {
    if (Math.abs(a.score - b.score) > 1e-5) {
      return b.score - a.score;
    }
    return a.candidate.candidateId.localeCompare(b.candidate.candidateId);
  });

  const best = scoredCandidates[0];
  const second = scoredCandidates[1];

  const winner = best.candidate;
  const alternatives = scoredCandidates.slice(1).map(sc => sc.candidate);
  const margin = second ? (best.score - second.score) : 1.0;

  const whyAlternativesLost = scoredCandidates.slice(1).map(sc => {
    return {
      candidateId: sc.candidate.candidateId,
      reason: `Comparatively inferior score (${sc.score.toFixed(3)} vs winner ${best.score.toFixed(3)})`
    };
  }).concat(rejectedCandidates.map(r => ({
    candidateId: r.candidate.candidateId,
    reason: `Ineligible: ${r.reason}`
  })));

  const status = margin >= marginThreshold ? "WINNER" : "CLOSE_ALTERNATIVES";
  const winnerReason = `Highest calculated strategic relevance (${best.score.toFixed(3)}) with margin ${margin.toFixed(3)} for engine ${engineId}.`;

  return {
    winner,
    selectionStatus: status,
    alternatives,
    winnerReason,
    whyAlternativesLost,
    decisionMargin: margin,
  };
}
