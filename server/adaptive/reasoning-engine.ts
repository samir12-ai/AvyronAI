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
  const isProofGapOnlySignal = (s: AdaptiveSignal) =>
    s.signalType === "PROOF_GAP_UNMEASURED_TRUTH" || s.metadata?.isProofGapOnly === true;
  const measuredPerformanceSignals = performanceSignals.filter(s => !isProofGapOnlySignal(s));
  const proofGapSignals = performanceSignals.filter(isProofGapOnlySignal);
  const hasPerformanceWarning = measuredPerformanceSignals.length > 0;
  const hasOnlyProofGaps = !hasPerformanceWarning && proofGapSignals.length > 0 && !hasConfirmedMarketEvent;

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
    const mMeta = (primaryMarketSignal.metadata || {}) as Record<string, any>;
    const baselineSnapId = typeof mMeta.baselineSnapshotId === "string" ? mMeta.baselineSnapshotId : null;
    const currentSnapId = typeof mMeta.currentSnapshotId === "string" ? mMeta.currentSnapshotId : null;
    const eventArtifactId = primaryMarketSignal.sourceArtifactId;
    const counterevidenceViolations: string[] = Array.isArray(mMeta.counterevidenceViolations)
      ? mMeta.counterevidenceViolations
      : [];
    const isContradicted =
      mMeta.isContradicted === true ||
      counterevidenceViolations.length > 0 ||
      primaryMarketSignal.confirmationState === "CONTRADICTED";
    const isObserveOnly = mMeta.observeOnly === true && !hasPerformanceWarning;
    const isPromoOnly = mMeta.isPromotionalDiscountOnly === true;
    const isUnwindowedPostCount =
      primaryMarketSignal.signalType === "posting_frequency_shift" &&
      mMeta.hasComparableTimestampWindow === false;
    const sharedOriginSiblings: string[] = Array.isArray(mMeta.sharedOriginSiblingIds)
      ? mMeta.sharedOriginSiblingIds
      : [];
    const sharedOriginNote =
      sharedOriginSiblings.length > 0
        ? ` Derived from the same single snapshot update as [${sharedOriginSiblings.join(", ")}] — linked as one source update and not counted as independent corroboration.`
        : "";

    if (isContradicted) {
      const supportingIds = Array.from(
        new Set([baselineSnapId || primaryMarketSignal.evidenceIds[0]].filter(Boolean) as string[]),
      );
      const contradictingIds = Array.from(
        new Set([currentSnapId, eventArtifactId].filter(Boolean) as string[]),
      );
      hypotheses.push({
        hypothesisId: `hyp_comp_${randomUUID().slice(0, 8)}`,
        reasoningCaseId: reasoningCase.reasoningCaseId,
        hypothesisType: "COMPETITIVE_PRESSURE",
        explanation: `Alleged competitor removal or shift (${primaryMarketSignal.signalType}) is contradicted by current snapshot evidence: ${
          counterevidenceViolations.join("; ") ||
          "the claimed removed feature remains present in current website snapshots"
        }. No competitive pressure on campaign positioning is established.`,
        supportingEvidenceIds: supportingIds,
        contradictingEvidenceIds: contradictingIds,
        alternativeCauseIds: [],
        confidence: 0.15,
        status: "REJECTED",
        metadata: {
          confirmationState: primaryMarketSignal.confirmationState,
          signalType: primaryMarketSignal.signalType,
          contradictedByCounterevidence: true,
          counterevidenceViolations,
        },
      });

      hypotheses.push({
        hypothesisId: `hyp_contra_${randomUUID().slice(0, 8)}`,
        reasoningCaseId: reasoningCase.reasoningCaseId,
        hypothesisType: "EXTRACTION_OR_SCOPE_CONTRADICTION",
        explanation:
          "Partial pattern array diff suggested a removal, but full current website corpus and offer snapshots confirm the offering feature is still present across the competitor's active pages.",
        supportingEvidenceIds: contradictingIds.length > 0 ? contradictingIds : primaryMarketSignal.evidenceIds,
        contradictingEvidenceIds: [],
        alternativeCauseIds: [],
        confidence: 0.88,
        status: "VALIDATED",
        metadata: {
          signalType: primaryMarketSignal.signalType,
          counterevidenceViolations,
        },
      });
    } else if (isObserveOnly) {
      if (isPromoOnly) {
        const suppIds = Array.from(new Set([currentSnapId, eventArtifactId].filter(Boolean) as string[]));
        const contraIds = Array.from(new Set([baselineSnapId].filter(Boolean) as string[]));
        hypotheses.push({
          hypothesisId: `hyp_comp_${randomUUID().slice(0, 8)}`,
          reasoningCaseId: reasoningCase.reasoningCaseId,
          hypothesisType: "COMPETITIVE_PRESSURE",
          explanation: `Competitor added a promotional discount banner (${
            mMeta.promoSummary || "seasonal % off banner"
          }) while keeping its base tier price unchanged (${
            mMeta.unchangedBasePrice || "base price preserved"
          }). A promotional discount banner is not a change in actual base price or pricing model and does not validate competitive pressure on campaign results.${sharedOriginNote}`,
          supportingEvidenceIds: suppIds.length > 0 ? suppIds : primaryMarketSignal.evidenceIds,
          contradictingEvidenceIds: contraIds,
          alternativeCauseIds: [],
          confidence: 0.32,
          status: "INCONCLUSIVE",
          metadata: {
            confirmationState: primaryMarketSignal.confirmationState,
            signalType: primaryMarketSignal.signalType,
            isPromotionalDiscountOnly: true,
            sharedOriginKey: mMeta.sharedOriginKey || null,
          },
        });

        hypotheses.push({
          hypothesisId: `hyp_promo_${randomUUID().slice(0, 8)}`,
          reasoningCaseId: reasoningCase.reasoningCaseId,
          hypothesisType: "PROMOTIONAL_DISCOUNT_FRAMING_ONLY",
          explanation: `Observed pricing diff reflects a temporary promotional discount banner layered onto an unchanged base tier price (${
            mMeta.unchangedBasePrice || "base price preserved"
          }); no structural pricing model shift occurred.${sharedOriginNote}`,
          supportingEvidenceIds: Array.from(
            new Set([eventArtifactId, baselineSnapId, currentSnapId].filter(Boolean) as string[]),
          ),
          contradictingEvidenceIds: [],
          alternativeCauseIds: [],
          confidence: 0.82,
          status: "VALIDATED",
          metadata: {
            isPromotionalDiscountOnly: true,
            sharedOriginKey: mMeta.sharedOriginKey || null,
          },
        });
      } else if (isUnwindowedPostCount) {
        const suppIds = [eventArtifactId].filter(Boolean);
        const contraIds = Array.from(new Set([baselineSnapId, currentSnapId].filter(Boolean) as string[]));
        hypotheses.push({
          hypothesisId: `hyp_comp_${randomUUID().slice(0, 8)}`,
          reasoningCaseId: reasoningCase.reasoningCaseId,
          hypothesisType: "COMPETITIVE_PRESSURE",
          explanation: `Stored post count changed from ${mMeta.fromCount ?? "prior"} to ${
            mMeta.toCount ?? "current"
          } across snapshots, but snapshots lack comparable publication-timestamp time windows and deduplicated window coverage. An increased stored-post count alone does not establish an acceleration in competitor publishing cadence or competitive pressure.`,
          supportingEvidenceIds: suppIds,
          contradictingEvidenceIds: contraIds,
          alternativeCauseIds: [],
          confidence: 0.28,
          status: "INCONCLUSIVE",
          metadata: {
            confirmationState: primaryMarketSignal.confirmationState,
            signalType: primaryMarketSignal.signalType,
            hasComparableTimestampWindow: false,
          },
        });

        hypotheses.push({
          hypothesisId: `hyp_cov_${randomUUID().slice(0, 8)}`,
          reasoningCaseId: reasoningCase.reasoningCaseId,
          hypothesisType: "COLLECTION_COVERAGE_CUMULATIVE_COUNT",
          explanation: `The ${mMeta.fromCount ?? "prior"} → ${
            mMeta.toCount ?? "current"
          } count difference reflects cumulative stored-post collection across crawls without a normalized 30-day publication timestamp window.`,
          supportingEvidenceIds: contraIds.length > 0 ? contraIds : primaryMarketSignal.evidenceIds,
          contradictingEvidenceIds: [],
          alternativeCauseIds: [],
          confidence: 0.78,
          status: "VALIDATED",
          metadata: {
            hasComparableTimestampWindow: false,
          },
        });
      } else {
        const rawBriefConf =
          typeof mMeta.briefValidatedConfidence === "number" ? mMeta.briefValidatedConfidence : null;
        const pressureConf =
          primaryMarketSignal.signalType === "offer_language_change"
            ? 0.42
            : primaryMarketSignal.signalType === "competitor_profile_change"
              ? 0.38
              : rawBriefConf !== null
                ? Number(Math.max(0.25, Math.min(0.48, rawBriefConf * 0.5)).toFixed(2))
                : 0.40;
        const localIterConf =
          rawBriefConf !== null
            ? Number(Math.max(0.68, Math.min(0.84, rawBriefConf)).toFixed(2))
            : primaryMarketSignal.signalType === "offer_language_change"
              ? 0.74
              : 0.76;

        const pressureSuppIds = Array.from(
          new Set([currentSnapId, eventArtifactId].filter(Boolean) as string[]),
        );
        const iterSuppIds = Array.from(
          new Set([baselineSnapId, currentSnapId].filter(Boolean) as string[]),
        );

        hypotheses.push({
          hypothesisId: `hyp_comp_${randomUUID().slice(0, 8)}`,
          reasoningCaseId: reasoningCase.reasoningCaseId,
          hypothesisType: "COMPETITIVE_PRESSURE",
          explanation: `Confirmed competitor website change (${primaryMarketSignal.signalType}) was observed, but a website copy or policy wording update alone does not validate competitive pressure on our campaign results without corroborated conversion impact.${sharedOriginNote}`,
          supportingEvidenceIds:
            pressureSuppIds.length > 0 ? pressureSuppIds : primaryMarketSignal.evidenceIds,
          contradictingEvidenceIds: [],
          alternativeCauseIds: [],
          confidence: pressureConf,
          status: "INCONCLUSIVE",
          metadata: {
            confirmationState: primaryMarketSignal.confirmationState,
            signalType: primaryMarketSignal.signalType,
            observeOnly: true,
            sharedOriginKey: mMeta.sharedOriginKey || null,
          },
        });

        hypotheses.push({
          hypothesisId: `hyp_iter_${randomUUID().slice(0, 8)}`,
          reasoningCaseId: reasoningCase.reasoningCaseId,
          hypothesisType: "LOCAL_COMPETITOR_COPY_OR_OFFER_ITERATION",
          explanation: `Observed ${primaryMarketSignal.signalType.replace(
            /_/g,
            " ",
          )} reflects a localized competitor messaging or guarantee wording iteration within existing category positioning and does not invalidate our differentiation.${sharedOriginNote}`,
          supportingEvidenceIds: iterSuppIds.length > 0 ? iterSuppIds : primaryMarketSignal.evidenceIds,
          contradictingEvidenceIds: [],
          alternativeCauseIds: [],
          confidence: localIterConf,
          status: "PROPOSED",
          metadata: {
            observeOnly: true,
            sharedOriginKey: mMeta.sharedOriginKey || null,
          },
        });
      }
    } else {
      const compConfidence =
        typeof mMeta.briefValidatedConfidence === "number"
          ? mMeta.briefValidatedConfidence
          : primaryMarketSignal.confirmationState === "CONFIRMED"
            ? 0.85
            : 0.45;

      hypotheses.push({
        hypothesisId: `hyp_comp_${randomUUID().slice(0, 8)}`,
        reasoningCaseId: reasoningCase.reasoningCaseId,
        hypothesisType: "COMPETITIVE_PRESSURE",
        explanation: `Competitor change (${primaryMarketSignal.signalType}) may be exerting pressure on market positioning or differentiation.${sharedOriginNote}`,
        supportingEvidenceIds: primaryMarketSignal.evidenceIds,
        contradictingEvidenceIds: [],
        alternativeCauseIds: [],
        confidence: compConfidence,
        status: primaryMarketSignal.confirmationState === "CONFIRMED" ? "VALIDATED" : "PROPOSED",
        metadata: {
          confirmationState: primaryMarketSignal.confirmationState,
          signalType: primaryMarketSignal.signalType,
          sharedOriginKey: mMeta.sharedOriginKey || null,
        },
      });
    }

    if (
      !isContradicted &&
      !isObserveOnly &&
      (primaryMarketSignal as any).candidateAffectedAuthorities &&
      (primaryMarketSignal as any).candidateAffectedAuthorities.length > 0
    ) {
      candidateAffectedAuthorities.push(...(primaryMarketSignal as any).candidateAffectedAuthorities);
    } else if (!isContradicted && !primaryMarketSignal.metadata?.observeOnly) {
      if (
        primaryMarketSignal.signalType.includes("FUNNEL") ||
        primaryMarketSignal.signalType.includes("CONVERSION")
      ) {
        candidateAffectedAuthorities.push("FUNNEL");
      }
      if (primaryMarketSignal.confirmationState === "CONFIRMED") {
        candidateAffectedAuthorities.push("DIFFERENTIATION");
      }
    }
  }

  // Preserve any previously explicitly pinned authorities on the case
  if (reasoningCase.candidateAffectedAuthorities && reasoningCase.candidateAffectedAuthorities.length > 0) {
    candidateAffectedAuthorities.push(...reasoningCase.candidateAffectedAuthorities);
  }

  // Dimension 4 & 5: Execution / Distribution Alternative Explanations
  if (hasPerformanceWarning) {
    const primaryPerfSignal = measuredPerformanceSignals[0];
    const pMeta = (primaryPerfSignal.metadata || {}) as Record<string, any>;
    const distEvIds: string[] =
      Array.isArray(pMeta.distributionEvidenceIds) && pMeta.distributionEvidenceIds.length > 0
        ? pMeta.distributionEvidenceIds
        : primaryPerfSignal.evidenceIds;
    const funnelEvIds: string[] =
      Array.isArray(pMeta.funnelEvidenceIds) && pMeta.funnelEvidenceIds.length > 0
        ? pMeta.funnelEvidenceIds
        : primaryPerfSignal.evidenceIds;
    const zeroActivityChannelEvIds: string[] = Array.isArray(pMeta.zeroActivityChannelEvidenceIds)
      ? pMeta.zeroActivityChannelEvidenceIds
      : [];
    const baselineEvIds: string[] =
      Array.isArray(pMeta.baselineEvidenceIds) && pMeta.baselineEvidenceIds.length > 0
        ? pMeta.baselineEvidenceIds
        : primaryPerfSignal.evidenceIds;

    const isZeroActivityWindow =
      pMeta.isZeroActivityWindow === true || pMeta.isZeroExecutionWindow === true;

    if (isZeroActivityWindow) {
      const windowLabel = pMeta.windowLabel || "active 7-day reporting window";
      const opMonths = pMeta.operatingDurationMonths ?? 6;
      const histLeads = pMeta.historicalLeadsCount ?? 10;
      const histCust = pMeta.historicalPayingCustomersCount ?? 5;

      // Hypothesis B: Unexecuted Publishing Window / Distribution Gap (NOT paid ad fatigue when adSpend = 0)
      hypotheses.push({
        hypothesisId: `hyp_exec_${randomUUID().slice(0, 8)}`,
        reasoningCaseId: reasoningCase.reasoningCaseId,
        hypothesisType: "EXECUTION_OR_DISTRIBUTION_FLUCTUATION",
        explanation: `Explicitly submitted weekly check-in (${windowLabel}) recorded 0 leads, 0 paying customers, and $0 ad spend against a ${opMonths}-month historical baseline of ${histLeads} leads and ${histCust} paying customers. Owned-channel snapshots show 0 posts published during the active plan window across connected social channels. Zero conversions alongside $0 ad spend and 0 active-window posts indicates an unexecuted publishing window rather than paid ad fatigue or strategy invalidation.`,
        supportingEvidenceIds: distEvIds,
        contradictingEvidenceIds: [],
        alternativeCauseIds: [],
        confidence: 0.74,
        status: "PROPOSED",
        metadata: {
          isZeroActivityWindow: true,
          adSpend: 0,
          activeWindowPosts: 0,
        },
      });

      // Hypothesis C: Funnel or Offer Friction (inconclusive when top-of-funnel activity in window was zero)
      hypotheses.push({
        hypothesisId: `hyp_funnel_${randomUUID().slice(0, 8)}`,
        reasoningCaseId: reasoningCase.reasoningCaseId,
        hypothesisType: "FUNNEL_OR_OFFER_FRICTION",
        explanation: `Website offer has prior willingness-to-pay validation (${histCust} paying customers from ${histLeads} leads over ${opMonths} months), and the 0-conversion window occurred with $0 ad spend and 0 active-window social posts. Landing-page or offer conversion decline cannot be established while top-of-funnel publishing in the active window is zero.`,
        supportingEvidenceIds: funnelEvIds,
        contradictingEvidenceIds: zeroActivityChannelEvIds,
        alternativeCauseIds: [],
        confidence: 0.34,
        status: "INCONCLUSIVE",
        metadata: {
          isZeroActivityWindow: true,
        },
      });
    } else {
      // Standard measured performance warning
      hypotheses.push({
        hypothesisId: `hyp_exec_${randomUUID().slice(0, 8)}`,
        reasoningCaseId: reasoningCase.reasoningCaseId,
        hypothesisType: "EXECUTION_OR_DISTRIBUTION_FLUCTUATION",
        explanation: `Performance variance (${primaryPerfSignal.signalType}) may stem from distribution cadence or channel delivery rather than a foundational strategic flaw.`,
        supportingEvidenceIds: distEvIds,
        contradictingEvidenceIds: [],
        alternativeCauseIds: [],
        confidence: 0.70,
        status: "PROPOSED",
      });

      hypotheses.push({
        hypothesisId: `hyp_funnel_${randomUUID().slice(0, 8)}`,
        reasoningCaseId: reasoningCase.reasoningCaseId,
        hypothesisType: "FUNNEL_OR_OFFER_FRICTION",
        explanation: `Observed metric movement may indicate intermediate friction in qualification or trust transfer rather than positioning failure.`,
        supportingEvidenceIds: funnelEvIds,
        contradictingEvidenceIds: [],
        alternativeCauseIds: [],
        confidence: 0.65,
        status: "PROPOSED",
      });
    }

    if (pMeta.isSingleWindowSample === true && marketSignals.length === 0) {
      const windowLabel = pMeta.windowLabel || "single 7-day reporting window";
      const opMonths = pMeta.operatingDurationMonths ?? 6;
      hypotheses.push({
        hypothesisId: `hyp_sample_${randomUUID().slice(0, 8)}`,
        reasoningCaseId: reasoningCase.reasoningCaseId,
        hypothesisType: "SINGLE_WINDOW_SAMPLE_LIMITATION",
        explanation: `Only 1 completed weekly reporting window (${windowLabel}) has been recorded against a single ${opMonths}-month historical aggregate. Statistical noise cannot be claimed without a multi-window time-series baseline.`,
        supportingEvidenceIds: baselineEvIds,
        contradictingEvidenceIds: [],
        alternativeCauseIds: [],
        confidence: 0.28,
        status: "INCONCLUSIVE",
        metadata: {
          completedWindowsCount: 1,
          isSingleWindowSample: true,
        },
      });
    }

    // If performance warning alone with no confirmed market event -> Suggest execution review
    if (!hasConfirmedMarketEvent) {
      candidateAffectedAuthorities.push("PLAN_SYNTHESIS");
    }
  } else if (hasOnlyProofGaps) {
    const gapSummaries = Array.from(new Set(proofGapSignals.map(s => s.summary))).join("; ");
    const gapEvidenceIds = Array.from(new Set(proofGapSignals.flatMap(s => s.evidenceIds)));
    hypotheses.push({
      hypothesisId: `hyp_gap_${randomUUID().slice(0, 8)}`,
      reasoningCaseId: reasoningCase.reasoningCaseId,
      hypothesisType: "MEASUREMENT_OR_TRUTH_GAP",
      explanation: `Campaign-window business and conversion metrics are unmeasured (${gapSummaries}). Missing manual conversion truth cannot substantiate ad fatigue, distribution cadence issues, or funnel friction.`,
      supportingEvidenceIds: gapEvidenceIds,
      contradictingEvidenceIds: [],
      alternativeCauseIds: [],
      confidence: 0.35,
      status: "INCONCLUSIVE",
      metadata: { isProofGapOnly: true },
    });
  }

  // Hypothesis D: Statistical Noise — only include when multi-window performance sampling applies
  // or when no other alternative hypothesis was generated (never claim statistical noise on single-window
  // performance check-ins or on deterministic website copy/pricing diffs).
  const primaryPerfMeta = (measuredPerformanceSignals[0]?.metadata || {}) as Record<string, any>;
  const shouldIncludeStatisticalNoise =
    (hasPerformanceWarning && primaryPerfMeta.isSingleWindowSample !== true) ||
    hasOnlyProofGaps ||
    hypotheses.length < 2;

  if (shouldIncludeStatisticalNoise) {
    hypotheses.push({
      hypothesisId: `hyp_noise_${randomUUID().slice(0, 8)}`,
      reasoningCaseId: reasoningCase.reasoningCaseId,
      hypothesisType: "STATISTICAL_NOISE",
      explanation: "Observed variations fall within expected empirical variance across standard sampling windows.",
      supportingEvidenceIds: hasPerformanceWarning ? measuredPerformanceSignals[0].evidenceIds.slice(0, 1) : [],
      contradictingEvidenceIds: [],
      alternativeCauseIds: [],
      confidence: hasOnlyProofGaps ? 0.35 : 0.50,
      status: hasOnlyProofGaps ? "INCONCLUSIVE" : "PROPOSED",
    });
  }

  // 3. Evidence Sufficiency Evaluation
  const hasContradictedMarketSignal = marketSignals.some(
    s =>
      s.metadata?.isContradicted === true ||
      (Array.isArray(s.metadata?.counterevidenceViolations) &&
        s.metadata!.counterevidenceViolations.length > 0) ||
      s.confirmationState === "CONTRADICTED",
  );
  let evidenceSufficiency: "SUFFICIENT" | "PARTIAL" | "INSUFFICIENT" = "PARTIAL";
  if (
    (allEvidenceIds.length === 0 && !hasConfirmedMarketEvent) ||
    hasOnlyProofGaps ||
    hasContradictedMarketSignal
  ) {
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
