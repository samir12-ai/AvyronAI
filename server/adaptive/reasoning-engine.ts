/**
 * Deep Causal Reasoning Engine
 * 
 * Constitutional Principle:
 * REASONING OWNS DIAGNOSIS.
 * Reasoning investigates:
 * - What changed?
 * - What performance changed?
 * - Are they related?
 * - What else could explain it? (Alternative explanations)
 * - What current strategic authority is potentially affected?
 * - What evidence is missing?
 * 
 * Rejects naive correlation: Competitor feature launch + performance drop != immediate causal certainty.
 * Preserves multiple competing hypotheses without forcing premature conclusions.
 */

import {
  AdaptiveSignal,
  EvidenceItem,
  ReasoningCase,
  ReasoningHypothesis,
  StrategicAuthorityName,
} from "./contracts";
import { randomUUID } from "crypto";

export interface ReasoningAnalysisInput {
  reasoningCase: ReasoningCase;
  marketSignals: AdaptiveSignal[];
  performanceSignals: AdaptiveSignal[];
  evidenceItems?: EvidenceItem[];
  strategyRootContext?: {
    primaryAxis?: string;
    contrastAxis?: string;
    approvedMechanism?: string;
    approvedLanes?: any[];
  };
}

export interface ReasoningAnalysisResult {
  updatedCase: ReasoningCase;
  hypotheses: ReasoningHypothesis[];
  candidateAffectedAuthorities: StrategicAuthorityName[];
  candidateAffectedLaneIds: string[];
  diagnosisSummary: string;
  evidenceSufficiency: "SUFFICIENT" | "PARTIAL" | "INSUFFICIENT";
  alternativeCausesIdentified: boolean;
  temporalMatchScore: number;
}

/**
 * Performs structured multi-dimensional causal analysis on a Reasoning Case.
 */
export function runCausalReasoningAnalysis(input: ReasoningAnalysisInput): ReasoningAnalysisResult {
  const { reasoningCase, marketSignals = [], performanceSignals = [], evidenceItems = [], strategyRootContext } = input;

  const hypotheses: ReasoningHypothesis[] = [];
  const candidateAffectedAuthorities: StrategicAuthorityName[] = [];
  const candidateAffectedLaneIds: string[] = [];

  // Grounded Lane Identification from Signal Telemetry
  const allSignals = [...marketSignals, ...performanceSignals];
  const approvedLanes = strategyRootContext?.approvedLanes || [];
  const approvedLaneIds = new Set(approvedLanes.map((l: any) => l.laneId || l.id));

  for (const sig of allSignals) {
    const directLane = sig.metadata?.laneId || (sig as any).laneId;
    if (directLane && (approvedLaneIds.size === 0 || approvedLaneIds.has(directLane))) {
      candidateAffectedLaneIds.push(directLane);
    }
    for (const eid of sig.entityIds || []) {
      if (eid.startsWith("lane_") && (approvedLaneIds.size === 0 || approvedLaneIds.has(eid))) {
        candidateAffectedLaneIds.push(eid);
      }
    }
  }

  // Preserve any previously explicitly pinned lane IDs on the case
  if (reasoningCase.candidateAffectedLaneIds) {
    candidateAffectedLaneIds.push(...reasoningCase.candidateAffectedLaneIds);
  }

  const marketEvidenceIds = marketSignals.flatMap(s => s.evidenceIds);
  const perfEvidenceIds = performanceSignals.flatMap(s => s.evidenceIds);
  const allEvidenceIds = Array.from(new Set([...marketEvidenceIds, ...perfEvidenceIds, ...reasoningCase.evidenceIds]));

  // 1. Evaluate Confirmation States
  const hasConfirmedMarketEvent = marketSignals.some(s => s.confirmationState === "CONFIRMED");
  const hasPreliminaryMarketEvent = marketSignals.some(s => s.confirmationState === "PRELIMINARY");
  const hasPerformanceWarning = performanceSignals.length > 0;

  // 2. Multi-dimensional Analysis
  // Dimension 1: Temporal Match
  let temporalMatchScore = 0.5;
  if (marketSignals.length > 0 && performanceSignals.length > 0) {
    const marketTime = new Date(marketSignals[0].observedAt).getTime();
    const perfTime = new Date(performanceSignals[0].observedAt).getTime();
    // If market event occurred before or coincident with performance warning
    if (perfTime >= marketTime) {
      temporalMatchScore = 0.8;
    } else {
      temporalMatchScore = 0.3; // Performance drop happened BEFORE market event
    }
  }

  // Dimension 2 & 3: Strategic Territory & Competitor Pressure
  if (marketSignals.length > 0) {
    const primaryMarketSignal = marketSignals[0];
    const compConfidence = primaryMarketSignal.confirmationState === "CONFIRMED" ? 0.85 : 0.45;

    hypotheses.push({
      hypothesisId: `hyp_comp_${randomUUID().slice(0, 8)}`,
      reasoningCaseId: reasoningCase.reasoningCaseId,
      hypothesisType: "COMPETITIVE_PRESSURE",
      explanation: `Competitor change (${primaryMarketSignal.signalType}) may be exerting pressure on market positioning or differentiation.`,
      supportingEvidenceIds: primaryMarketSignal.evidenceIds,
      contradictingEvidenceIds: [],
      alternativeCauseIds: [],
      confidence: compConfidence,
      status: primaryMarketSignal.confirmationState === "CONFIRMED" ? "VALIDATED" : "PROPOSED",
      metadata: {
        confirmationState: primaryMarketSignal.confirmationState,
        signalType: primaryMarketSignal.signalType,
      },
    });

    if (primaryMarketSignal.candidateAffectedAuthorities && primaryMarketSignal.candidateAffectedAuthorities.length > 0) {
      candidateAffectedAuthorities.push(...primaryMarketSignal.candidateAffectedAuthorities);
    }
    if (primaryMarketSignal.signalType.includes("FUNNEL") || primaryMarketSignal.signalType.includes("CONVERSION")) {
      candidateAffectedAuthorities.push("FUNNEL");
    }
    if (primaryMarketSignal.confirmationState === "CONFIRMED") {
      candidateAffectedAuthorities.push("DIFFERENTIATION");
    }
  }

  // Preserve any previously explicitly pinned authorities on the case
  if (reasoningCase.candidateAffectedAuthorities && reasoningCase.candidateAffectedAuthorities.length > 0) {
    candidateAffectedAuthorities.push(...reasoningCase.candidateAffectedAuthorities);
  }

  // Dimension 4 & 5: Execution / Distribution Alternative Explanations
  if (hasPerformanceWarning) {
    const primaryPerfSignal = performanceSignals[0];

    // Hypothesis B: Distribution / Execution Fluctuation
    hypotheses.push({
      hypothesisId: `hyp_exec_${randomUUID().slice(0, 8)}`,
      reasoningCaseId: reasoningCase.reasoningCaseId,
      hypothesisType: "EXECUTION_OR_DISTRIBUTION_FLUCTUATION",
      explanation: `Performance variance (${primaryPerfSignal.signalType}) may stem from distribution cadence, channel delivery, or normal ad fatigue rather than strategic flaw.`,
      supportingEvidenceIds: primaryPerfSignal.evidenceIds,
      contradictingEvidenceIds: [],
      alternativeCauseIds: [],
      confidence: 0.70,
      status: "PROPOSED",
    });

    // Hypothesis C: Funnel or Offer Stage Friction
    hypotheses.push({
      hypothesisId: `hyp_funnel_${randomUUID().slice(0, 8)}`,
      reasoningCaseId: reasoningCase.reasoningCaseId,
      hypothesisType: "FUNNEL_OR_OFFER_FRICTION",
      explanation: `Observed metric movement may indicate intermediate friction in qualification or trust transfer rather than positioning failure.`,
      supportingEvidenceIds: primaryPerfSignal.evidenceIds,
      contradictingEvidenceIds: [],
      alternativeCauseIds: [],
      confidence: 0.65,
      status: "PROPOSED",
    });

    // If performance warning alone with no confirmed market event -> Suggest execution review
    if (!hasConfirmedMarketEvent) {
      candidateAffectedAuthorities.push("PLAN_SYNTHESIS");
    }
  }

  // Hypothesis D: Statistical Noise / Insufficient Observation Baseline
  hypotheses.push({
    hypothesisId: `hyp_noise_${randomUUID().slice(0, 8)}`,
    reasoningCaseId: reasoningCase.reasoningCaseId,
    hypothesisType: "STATISTICAL_NOISE",
    explanation: "Observed variations fall within expected empirical variance across standard sampling windows.",
    supportingEvidenceIds: [],
    contradictingEvidenceIds: [],
    alternativeCauseIds: [],
    confidence: 0.50,
    status: "PROPOSED",
  });

  // 3. Evidence Sufficiency Evaluation
  let evidenceSufficiency: "SUFFICIENT" | "PARTIAL" | "INSUFFICIENT" = "PARTIAL";
  if (allEvidenceIds.length === 0 && !hasConfirmedMarketEvent) {
    evidenceSufficiency = "INSUFFICIENT";
  } else if (hasConfirmedMarketEvent && hasPerformanceWarning) {
    evidenceSufficiency = "SUFFICIENT";
  }

  const diagnosisSummary = `Analyzed ${marketSignals.length} market signal(s) and ${performanceSignals.length} performance signal(s). Formulated ${hypotheses.length} competing hypotheses. Temporal match score: ${temporalMatchScore}. Evidence sufficiency: ${evidenceSufficiency}.`;

  const distinctLaneIds = Array.from(new Set(candidateAffectedLaneIds));

  const updatedCase: ReasoningCase = {
    ...reasoningCase,
    evidenceIds: allEvidenceIds,
    status: evidenceSufficiency === "INSUFFICIENT" ? "INSUFFICIENT_EVIDENCE" : "EVALUATED",
    hypotheses,
    candidateAffectedAuthorities: Array.from(new Set(candidateAffectedAuthorities)),
    candidateAffectedLaneIds: distinctLaneIds,
    metadata: {
      ...(reasoningCase.metadata || {}),
      temporalMatchScore,
      evidenceSufficiency,
      hasConfirmedMarketEvent,
      hasPreliminaryMarketEvent,
      candidateAffectedLaneIds: distinctLaneIds,
    },
  };

  return {
    updatedCase,
    hypotheses,
    candidateAffectedAuthorities: Array.from(new Set(candidateAffectedAuthorities)),
    candidateAffectedLaneIds: distinctLaneIds,
    diagnosisSummary,
    evidenceSufficiency,
    alternativeCausesIdentified: true,
    temporalMatchScore,
  };
}
