/**
 * Structural Lineage & Integrity Validation Guards
 * 
 * Constitutional Principle:
 * Deterministic validation of identity, campaign containment, foreign keys,
 * root version immutability, and evidence lineage.
 */

import {
  AdaptiveSignal,
  ReasoningCase,
  AdaptiveDecision,
  CompetitorSource,
  EvidenceItem,
  ExecutionSignal,
  StrategyAdaptationLineage,
} from "./contracts";
import { isValidAuthorityName } from "./authority-registry";

export class LineageIntegrityError extends Error {
  constructor(message: string, public readonly code: string, public readonly details?: any) {
    super(`[LineageIntegrityError:${code}] ${message}`);
    this.name = "LineageIntegrityError";
  }
}

/**
 * 1. Cross-Campaign Guard:
 * Ensures an artifact belongs to the specified campaign and prevents silent cross-campaign pollution.
 */
export function validateCampaignContainment(
  artifact: { campaignId?: string | null; accountId?: string | null },
  expectedCampaignId: string,
  expectedAccountId?: string
): void {
  if (!artifact.campaignId || artifact.campaignId !== expectedCampaignId) {
    throw new LineageIntegrityError(
      `Cross-campaign contamination detected. Expected campaign "${expectedCampaignId}", received "${artifact.campaignId}".`,
      "CROSS_CAMPAIGN_VIOLATION",
      { expectedCampaignId, receivedCampaignId: artifact.campaignId }
    );
  }

  if (expectedAccountId && artifact.accountId && artifact.accountId !== expectedAccountId) {
    throw new LineageIntegrityError(
      `Cross-account contamination detected. Expected account "${expectedAccountId}", received "${artifact.accountId}".`,
      "CROSS_ACCOUNT_VIOLATION",
      { expectedAccountId, receivedAccountId: artifact.accountId }
    );
  }
}

/**
 * 2. Strategy Root Lineage Guard:
 * Ensures reasoning cases, decisions, and adaptation lineages reference valid root ID and version.
 */
export function validateStrategyRootReference(
  ref: { strategyRootId?: string | null; strategyRootVersion?: number | null },
  contextName = "Artifact"
): void {
  if (!ref.strategyRootId || typeof ref.strategyRootId !== "string" || ref.strategyRootId.trim() === "") {
    throw new LineageIntegrityError(
      `${contextName} requires a valid strategyRootId. Received: "${ref.strategyRootId}"`,
      "MISSING_ROOT_ID"
    );
  }

  if (typeof ref.strategyRootVersion !== "number" || isNaN(ref.strategyRootVersion) || ref.strategyRootVersion < 1) {
    throw new LineageIntegrityError(
      `${contextName} requires a positive numeric strategyRootVersion. Received: ${ref.strategyRootVersion}`,
      "INVALID_ROOT_VERSION"
    );
  }
}

/**
 * 3. Reasoning Case Lineage Guard:
 * Validates that a Reasoning Case has complete identity, valid status, and required root references.
 */
export function validateReasoningCase(caseObj: ReasoningCase): void {
  if (!caseObj.reasoningCaseId) {
    throw new LineageIntegrityError("ReasoningCase must have a reasoningCaseId.", "MISSING_ID");
  }

  validateStrategyRootReference(caseObj, "ReasoningCase");

  const validStatuses = ["OPEN", "ANALYZING", "EVALUATED", "RESOLVED", "CLOSED", "INSUFFICIENT_EVIDENCE"];
  if (!validStatuses.includes(caseObj.status)) {
    throw new LineageIntegrityError(
      `Invalid ReasoningCase status: "${caseObj.status}".`,
      "INVALID_STATUS",
      { validStatuses }
    );
  }
}

/**
 * 4. Adaptive Decision Ownership & Boundary Guard:
 * Ensures an Adaptive Decision identifies WHAT needs attention without containing replacement strategy payloads.
 */
export function validateAdaptiveDecision(decision: AdaptiveDecision): void {
  if (!decision.adaptiveDecisionId) {
    throw new LineageIntegrityError("AdaptiveDecision must have an adaptiveDecisionId.", "MISSING_ID");
  }

  if (!decision.reasoningCaseId) {
    throw new LineageIntegrityError("AdaptiveDecision must reference a parent reasoningCaseId.", "MISSING_CASE_ID");
  }

  validateStrategyRootReference(decision, "AdaptiveDecision");

  const validTypes = [
    "OBSERVE",
    "EXECUTION_RESPONSE",
    "REEVALUATE_AUTHORITY",
    "STRATEGY_CHANGE_REQUIRED",
    "STRATEGIC_REBUILD_REQUIRED",
    "INSUFFICIENT_EVIDENCE",
  ];

  if (!validTypes.includes(decision.decisionType)) {
    throw new LineageIntegrityError(
      `Invalid AdaptiveDecision decisionType: "${decision.decisionType}".`,
      "INVALID_DECISION_TYPE"
    );
  }

  if (decision.affectedAuthority && !isValidAuthorityName(decision.affectedAuthority)) {
    throw new LineageIntegrityError(
      `Unknown affectedAuthority in AdaptiveDecision: "${decision.affectedAuthority}".`,
      "INVALID_AFFECTED_AUTHORITY"
    );
  }

  // CRITICAL BOUNDARY CHECK: AdaptiveDecision must NEVER contain replacement strategic payloads.
  const payloadKeys = Object.keys(decision.metadata || {});
  const forbiddenPayloadKeys = [
    "positioningStatement",
    "differentiationPillars",
    "approvedMechanism",
    "primaryOffer",
    "funnelStructure",
    "targetSegments",
  ];

  for (const forbidden of forbiddenPayloadKeys) {
    if (forbidden in (decision as any) || payloadKeys.includes(forbidden)) {
      throw new LineageIntegrityError(
        `AdaptiveDecision contains forbidden replacement strategy payload key "${forbidden}". Decision owns diagnosis/routing, not replacement strategy generation.`,
        "STRATEGY_MUTATION_BREACH"
      );
    }
  }
}

/**
 * 5. Competitor Source Ownership Guard:
 * Verifies that a platform source belongs to the specified competitor.
 */
export function validateCompetitorSourceOwnership(
  source: CompetitorSource,
  expectedCompetitorId: string
): void {
  if (!source.sourceId) {
    throw new LineageIntegrityError("CompetitorSource must have a sourceId.", "MISSING_SOURCE_ID");
  }

  if (!source.competitorId || source.competitorId !== expectedCompetitorId) {
    throw new LineageIntegrityError(
      `CompetitorSource "${source.sourceId}" does not belong to competitor "${expectedCompetitorId}". Associated with "${source.competitorId}".`,
      "COMPETITOR_SOURCE_MISMATCH"
    );
  }

  if (!source.canonicalUrl || !source.canonicalUrl.startsWith("http")) {
    throw new LineageIntegrityError(
      `CompetitorSource "${source.sourceId}" has invalid canonicalUrl: "${source.canonicalUrl}".`,
      "INVALID_SOURCE_URL"
    );
  }
}

/**
 * 6. Evidence Lineage Reference Guard:
 * Ensures all referenced evidence IDs exist in the known evidence set (if provided).
 */
export function validateEvidenceReferences(
  evidenceIds: string[],
  knownEvidenceSet?: Set<string>
): void {
  if (!Array.isArray(evidenceIds)) {
    throw new LineageIntegrityError("evidenceIds must be an array.", "INVALID_EVIDENCE_LIST");
  }

  for (const id of evidenceIds) {
    if (!id || typeof id !== "string" || id.trim() === "") {
      throw new LineageIntegrityError(`Invalid empty or non-string evidence ID encountered.`, "EMPTY_EVIDENCE_ID");
    }

    if (knownEvidenceSet && !knownEvidenceSet.has(id)) {
      throw new LineageIntegrityError(
        `Dangling evidence reference: evidenceId "${id}" does not exist in known evidence registry.`,
        "DANGLING_EVIDENCE_REF",
        { missingId: id }
      );
    }
  }
}

/**
 * 7. Strategy Root Immutability Guard:
 * Ensures that adaptation creates a new version without mutating historical root records.
 */
export function validateStrategyRootImmutability(
  previousRoot: { id: string; version?: number },
  newRoot: { id: string; version?: number }
): void {
  if (previousRoot.id === newRoot.id) {
    throw new LineageIntegrityError(
      `Strategy Root mutation detected! New root must have a unique ID. Reused ID: "${previousRoot.id}".`,
      "ROOT_MUTATION_BREACH"
    );
  }

  if (previousRoot.version !== undefined && newRoot.version !== undefined) {
    if (newRoot.version <= previousRoot.version) {
      throw new LineageIntegrityError(
        `Strategy Root version must increment. Previous version: ${previousRoot.version}, new version: ${newRoot.version}.`,
        "NON_INCREMENTING_ROOT_VERSION"
      );
    }
  }
}

/**
 * 8. Text/ID Separation Guard:
 * Verifies that identity is preserved via explicit ID fields rather than derived text hashing.
 */
export function validateEntityIdentityPreservation(
  sourceEntity: { id?: string; segmentId?: string; laneId?: string; competitorId?: string },
  downstreamEntity: { id?: string; segmentId?: string; laneId?: string; competitorId?: string },
  entityType = "Entity"
): void {
  const sourceId = sourceEntity.id || sourceEntity.segmentId || sourceEntity.laneId || sourceEntity.competitorId;
  const downstreamId = downstreamEntity.id || downstreamEntity.segmentId || downstreamEntity.laneId || downstreamEntity.competitorId;

  if (!sourceId) {
    throw new LineageIntegrityError(`${entityType} source is missing a canonical ID.`, "MISSING_SOURCE_ID");
  }

  if (!downstreamId) {
    throw new LineageIntegrityError(`${entityType} downstream is missing a canonical ID.`, "MISSING_DOWNSTREAM_ID");
  }

  if (sourceId !== downstreamId) {
    throw new LineageIntegrityError(
      `${entityType} ID was mutated downstream! Expected "${sourceId}", received "${downstreamId}".`,
      "ID_MUTATION_BREACH"
    );
  }
}
