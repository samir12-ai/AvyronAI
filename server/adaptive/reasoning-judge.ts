/**
 * Reasoning Judge
 * 
 * Constitutional Principle:
 * Validates causal reasoning output against strict Avyron doctrine:
 * 1. Claims trace to provided evidence.
 * 2. Causal overclaims rejected (temporal sequence alone does not prove causality).
 * 3. Watchtower candidate is not treated as confirmed market truth.
 * 4. Alternative explanations must be considered.
 * 5. Current Strategy Root lineage must be pinned.
 * 6. Candidate affected authorities must be plausible and within valid registry.
 * 7. Strictly rejects any attempt to output replacement strategy payloads.
 */

import { ReasoningCase, ReasoningHypothesis, AdaptiveSignal } from "./contracts";
import { isValidAuthorityName, isLaneScopedAuthority } from "./authority-registry";
import { validateStrategyRootReference, validateEvidenceReferences } from "./lineage";

export interface ReasoningJudgeVerdict {
  status: "VALIDATED" | "REJECTED" | "INSUFFICIENT_EVIDENCE";
  confidence: number;
  violations: string[];
  rationale: string;
  overclaimDetected: boolean;
  alternativeCausesSatisfied: boolean;
}

export function judgeReasoningAnalysis(
  reasoningCase: ReasoningCase,
  marketSignals: AdaptiveSignal[] = [],
  performanceSignals: AdaptiveSignal[] = [],
  knownEvidenceSet?: Set<string>
): ReasoningJudgeVerdict {
  const violations: string[] = [];

  // 1. Root Lineage Check
  try {
    validateStrategyRootReference(reasoningCase, "ReasoningJudge");
  } catch (err: any) {
    violations.push(`Root lineage check failed: ${err.message}`);
  }

  // 2. Evidence Tracing Check
  try {
    validateEvidenceReferences(reasoningCase.evidenceIds, knownEvidenceSet);
  } catch (err: any) {
    violations.push(`Evidence reference check failed: ${err.message}`);
  }

  // 3. Watchtower Candidate Gate Check
  const hasPreliminaryMarketEvent = marketSignals.some(s => s.confirmationState === "PRELIMINARY");
  const hasConfirmedMarketEvent = marketSignals.some(s => s.confirmationState === "CONFIRMED");

  for (const h of reasoningCase.hypotheses || []) {
    if (h.hypothesisType === "COMPETITIVE_PRESSURE") {
      if (hasPreliminaryMarketEvent && !hasConfirmedMarketEvent) {
        if (h.status === "VALIDATED" && h.confidence > 0.65) {
          violations.push(
            `Causal overclaim: Hypothesis marked VALIDATED with high confidence (${h.confidence}) based on an unconfirmed PRELIMINARY Watchtower candidate.`
          );
        }
      }
    }
  }

  // 4. Causal Overclaim & Naive Correlation Check
  let overclaimDetected = false;
  for (const h of reasoningCase.hypotheses || []) {
    if (h.confidence >= 0.95 && h.supportingEvidenceIds.length <= 1 && (h.contradictingEvidenceIds.length === 0 && (reasoningCase.hypotheses || []).length <= 1)) {
      overclaimDetected = true;
      violations.push(
        `Causal overclaim: Absolute certainty (${h.confidence}) assigned to hypothesis without corroborating evidence or competing alternatives.`
      );
    }
  }

  // 5. Alternative Explanations Check
  const hypotheses = reasoningCase.hypotheses || [];
  const hasAlternativeCauses = hypotheses.some(
    h => h.hypothesisType === "EXECUTION_OR_DISTRIBUTION_FLUCTUATION" ||
         h.hypothesisType === "FUNNEL_OR_OFFER_FRICTION" ||
         h.hypothesisType === "STATISTICAL_NOISE"
  );

  if (performanceSignals.length > 0 && !hasAlternativeCauses) {
    violations.push("Alternative causes check failed: Performance warning analyzed without considering distribution, execution, or statistical variance alternatives.");
  }

  // 6. Authority Validity & Multi-Lane Grounding Check
  const approvedLanes: any[] = (reasoningCase.metadata?.approvedLanes as any[]) || [];
  const candidateLanes = reasoningCase.candidateAffectedLaneIds || (reasoningCase.metadata?.candidateAffectedLaneIds as string[]) || [];

  for (const auth of reasoningCase.candidateAffectedAuthorities || []) {
    if (!isValidAuthorityName(auth)) {
      violations.push(`Invalid candidate affected authority: "${auth}".`);
    } else if (isLaneScopedAuthority(auth) && approvedLanes.length > 1) {
      // For lane-scoped authorities in a multi-lane campaign, verify explicit lane grounding
      if (candidateLanes.length === 0) {
        // Must not guess or fabricate lane by array index or first-lane default
        violations.push(`Lane scope unresolved: Authority "${auth}" is lane-scoped across ${approvedLanes.length} strategic lanes, but candidate lane scope is unresolved.`);
      } else {
        // Verify candidate lane is in the approved lanes registry
        const approvedLaneIds = new Set(approvedLanes.map(l => l.laneId || l.id));
        for (const cLane of candidateLanes) {
          if (!approvedLaneIds.has(cLane)) {
            violations.push(`Invalid candidate lane: "${cLane}" is not among approved strategic lanes [${Array.from(approvedLaneIds).join(", ")}].`);
          }
        }
      }
    }
  }

  // 7. Strategy Mutation Breach Check
  const forbiddenPayloadKeys = [
    "positioningStatement",
    "differentiationPillars",
    "approvedMechanism",
    "primaryOffer",
    "funnelStructure",
  ];

  for (const forbidden of forbiddenPayloadKeys) {
    if (forbidden in (reasoningCase as any) || (reasoningCase.metadata && forbidden in reasoningCase.metadata)) {
      violations.push(`Strategy mutation breach: Reasoning contains forbidden strategic payload "${forbidden}".`);
    }
  }

  if (violations.length > 0) {
    const isUnresolvedLane = violations.some(v => v.includes("Lane scope unresolved"));
    return {
      status: isUnresolvedLane ? "INSUFFICIENT_EVIDENCE" : "REJECTED",
      confidence: isUnresolvedLane ? 0.4 : 0.2,
      violations,
      rationale: isUnresolvedLane
        ? "Lane scope is unresolved for the recommended lane-scoped authority. Failing closed."
        : `Reasoning Judge rejected analysis due to ${violations.length} doctrinal violation(s): ${violations.join("; ")}`,
      overclaimDetected,
      alternativeCausesSatisfied: hasAlternativeCauses,
    };
  }

  if (reasoningCase.evidenceIds.length === 0 && !hasConfirmedMarketEvent && performanceSignals.length === 0) {
    return {
      status: "INSUFFICIENT_EVIDENCE",
      confidence: 0.3,
      violations: [],
      rationale: "Evidence insufficient to substantiate causal diagnosis. Failing closed.",
      overclaimDetected: false,
      alternativeCausesSatisfied: hasAlternativeCauses,
    };
  }

  // Calculate overall confidence based on evidence corroboration and confirmation state
  let calculatedConfidence = 0.8;
  if (hasConfirmedMarketEvent && performanceSignals.length > 0) {
    calculatedConfidence = 0.88;
  } else if (hasPreliminaryMarketEvent) {
    calculatedConfidence = 0.55;
  } else if (performanceSignals.length > 0) {
    calculatedConfidence = 0.75;
  }

  return {
    status: "VALIDATED",
    confidence: calculatedConfidence,
    violations: [],
    rationale: "Reasoning analysis meets Avyron doctrinal standards with evidence tracing and competing hypotheses.",
    overclaimDetected: false,
    alternativeCausesSatisfied: true,
  };
}
