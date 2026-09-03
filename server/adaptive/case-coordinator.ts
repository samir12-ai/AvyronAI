/**
 * Adaptive Case Coordinator
 * 
 * Constitutional Principle:
 * Connects Watchtower Market Signals and Performance Signals into unified,
 * root-pinned Reasoning Cases without creating duplicate data authorities.
 * Handles Watchtower state transitions (Candidate -> Confirmed -> Contradicted/Closed).
 */

import {
  AdaptiveSignal,
  ReasoningCase,
  ReasoningCaseStatus,
  WatchtowerConfirmationState,
} from "./contracts";
import { validateCampaignContainment, validateStrategyRootReference, LineageIntegrityError } from "./lineage";
import { randomUUID } from "crypto";

export interface CreateCaseParams {
  accountId: string;
  campaignId: string;
  strategyRootId: string;
  strategyRootVersion: number;
  marketSignals?: AdaptiveSignal[];
  performanceSignals?: AdaptiveSignal[];
  reasoningVersion?: string;
  metadata?: Record<string, any>;
}

/**
 * Creates a new canonical ReasoningCase correlating market and performance signals.
 */
export function openReasoningCase(params: CreateCaseParams): ReasoningCase {
  const {
    accountId,
    campaignId,
    strategyRootId,
    strategyRootVersion,
    marketSignals = [],
    performanceSignals = [],
    reasoningVersion = "1.0.0",
    metadata = {},
  } = params;

  // 1. Cross-campaign isolation check on all incoming signals
  for (const sig of [...marketSignals, ...performanceSignals]) {
    validateCampaignContainment(sig, campaignId, accountId);
  }

  // 2. Validate Root Pinning
  validateStrategyRootReference({ strategyRootId, strategyRootVersion }, "ReasoningCase");

  const marketSignalIds = Array.from(new Set(marketSignals.map(s => s.signalId)));
  const performanceSignalIds = Array.from(new Set(performanceSignals.map(s => s.signalId)));

  const marketEventIds = Array.from(new Set(marketSignals.map(s => s.sourceArtifactId)));
  const performanceContextIds = Array.from(new Set(performanceSignals.map(s => s.sourceArtifactId)));

  const evidenceIds = Array.from(
    new Set([
      ...marketSignals.flatMap(s => s.evidenceIds),
      ...performanceSignals.flatMap(s => s.evidenceIds),
    ])
  );

  const reasoningCase: ReasoningCase = {
    reasoningCaseId: `rcase_${randomUUID().slice(0, 12)}`,
    accountId,
    campaignId,
    strategyRootId,
    strategyRootVersion,
    marketSignalIds,
    performanceSignalIds,
    marketEventIds,
    performanceWarningIds: performanceSignalIds, // Discrete performance warning signal IDs
    evidenceIds,
    status: "OPEN",
    openedAt: new Date().toISOString(),
    resolvedAt: null,
    reasoningVersion,
    hypotheses: [],
    candidateAffectedAuthorities: [],
    metadata: {
      ...metadata,
      performanceContextIds,
      marketSignalCount: marketSignals.length,
      performanceSignalCount: performanceSignals.length,
    },
  };

  return reasoningCase;
}

/**
 * Handles Watchtower Confirmation Lifecycle Transitions on an existing Reasoning Case.
 * 
 * If a candidate market event is:
 * - CONFIRMED: Lineage is updated to CONFIRMED.
 * - CONTRADICTED / CLOSED / REVERTED: Case relying on that candidate is downgraded or closed.
 */
export function handleWatchtowerEventTransition(
  existingCase: ReasoningCase,
  updatedMarketSignal: AdaptiveSignal
): { updatedCase: ReasoningCase; transitionAction: "MAINTAIN" | "DOWNGRADE" | "CLOSE" } {
  validateCampaignContainment(updatedMarketSignal, existingCase.campaignId, existingCase.accountId);

  const confirmationState = updatedMarketSignal.confirmationState;
  const isTargetSignal = existingCase.marketEventIds.includes(updatedMarketSignal.sourceArtifactId) ||
    (existingCase.marketSignalIds || []).includes(updatedMarketSignal.signalId);

  if (!isTargetSignal) {
    return { updatedCase: existingCase, transitionAction: "MAINTAIN" };
  }

  const updatedCase: ReasoningCase = {
    ...existingCase,
    metadata: {
      ...(existingCase.metadata || {}),
      lastEventTransition: {
        signalId: updatedMarketSignal.signalId,
        confirmationState,
        transitionedAt: new Date().toISOString(),
      },
    },
  };

  if (confirmationState === "CONTRADICTED" || confirmationState === "CLOSED" || confirmationState === "REVERTED" || confirmationState === "EXPIRED") {
    // If there are no performance signals remaining, close the case as INSUFFICIENT_EVIDENCE
    const remainingSignals = (existingCase.performanceSignalIds || []).length;
    if (remainingSignals === 0) {
      updatedCase.status = "CLOSED";
      updatedCase.resolvedAt = new Date().toISOString();
      updatedCase.metadata.closedReason = `Watchtower candidate ${updatedMarketSignal.sourceArtifactId} was ${confirmationState}. No remaining empirical evidence.`;
      return { updatedCase, transitionAction: "CLOSE" };
    } else {
      // Downgrade hypotheses relying exclusively on this market candidate
      updatedCase.hypotheses = (updatedCase.hypotheses || []).map(h => {
        if (h.supportingEvidenceIds.some(ev => updatedMarketSignal.evidenceIds.includes(ev))) {
          return { ...h, status: "REJECTED" as const, confidence: 0.1 };
        }
        return h;
      });
      return { updatedCase, transitionAction: "DOWNGRADE" };
    }
  }

  if (confirmationState === "CONFIRMED") {
    // Elevate confidence on hypotheses matching confirmed event
    updatedCase.metadata.eventConfirmedAt = new Date().toISOString();
    return { updatedCase, transitionAction: "MAINTAIN" };
  }

  return { updatedCase, transitionAction: "MAINTAIN" };
}
