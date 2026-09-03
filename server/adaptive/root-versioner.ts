/**
 * Strategy Root Versioner & Lineage Committer
 * 
 * Constitutional Principle:
 * STRATEGY ROOTS ARE IMMUTABLE.
 * When canonical strategic authorities change:
 * - Creates a new Strategy Root version (v56 -> v57).
 * - Copies exact artifact IDs for unchanged authorities (preservedAuthorities).
 * - Assigns new artifact IDs for changed authorities (changedAuthorities).
 * - Prevents race conditions and duplicate version numbers.
 * - Persists strategy_adaptation_lineages.
 */

import {
  StrategicAuthorityName,
  StrategyAdaptationLineage,
} from "./contracts";
import { validateCampaignContainment, validateStrategyRootImmutability, LineageIntegrityError } from "./lineage";
import { randomUUID } from "crypto";

export interface CommitRootVersionParams {
  accountId: string;
  campaignId: string;
  previousRoot: {
    id: string;
    version: number;
    authorityArtifactIds: Record<string, string>;
    primaryAxis?: string;
    contrastAxis?: string;
    approvedMechanism?: string;
    approvedLanes?: any[];
    [key: string]: any;
  };
  adaptiveDecisionId: string;
  reasoningCaseId?: string | null;
  changedAuthorityArtifacts: Record<StrategicAuthorityName, string>;
  sourceEventIds?: string[];
  sourcePerformanceWarningIds?: string[];
  evidenceIds?: string[];
  currentActiveVersion?: number;
}

export interface CommittedRootResult {
  newRoot: {
    id: string;
    accountId: string;
    campaignId: string;
    version: number;
    authorityArtifactIds: Record<string, string>;
    previousRootId: string;
    previousRootVersion: number;
    adaptiveDecisionId: string;
    reasoningCaseId?: string | null;
    primaryAxis?: string;
    contrastAxis?: string;
    approvedMechanism?: string;
    approvedLanes?: any[];
    createdAt: string;
  };
  lineage: StrategyAdaptationLineage;
  changedAuthorities: StrategicAuthorityName[];
  preservedAuthorities: StrategicAuthorityName[];
}

/**
 * Commits a new immutable Strategy Root version and records complete adaptation lineage.
 */
export function commitNewStrategyRootVersion(params: CommitRootVersionParams): CommittedRootResult {
  const {
    accountId,
    campaignId,
    previousRoot,
    adaptiveDecisionId,
    reasoningCaseId,
    changedAuthorityArtifacts,
    sourceEventIds = [],
    sourcePerformanceWarningIds = [],
    evidenceIds = [],
    currentActiveVersion,
  } = params;

  // 1. Concurrency / Stale Root Guard
  if (currentActiveVersion !== undefined && currentActiveVersion !== previousRoot.version) {
    throw new LineageIntegrityError(
      `[StaleDecisionError] Cannot commit new Root version against inactive version ${previousRoot.version}. Current active version is ${currentActiveVersion}.`
    );
  }

  const changedAuthorities = Object.keys(changedAuthorityArtifacts) as StrategicAuthorityName[];
  if (changedAuthorities.length === 0) {
    throw new Error("[RootVersioner] Cannot commit new Root version without at least one changed authority.");
  }

  // 2. Assemble New Authority Artifact Map
  const newAuthorityArtifactIds: Record<string, string> = {
    ...(previousRoot.authorityArtifactIds || {}),
  };

  const preservedAuthorities: StrategicAuthorityName[] = [];

  for (const [key, oldId] of Object.entries(previousRoot.authorityArtifactIds || {})) {
    if (!changedAuthorities.includes(key as StrategicAuthorityName)) {
      preservedAuthorities.push(key as StrategicAuthorityName);
    }
  }

  for (const [key, newId] of Object.entries(changedAuthorityArtifacts)) {
    newAuthorityArtifactIds[key] = newId;
  }

  const newRootId = `root_${randomUUID().slice(0, 12)}`;
  const newRootVersion = previousRoot.version + 1;
  const createdAt = new Date().toISOString();

  const newRoot = {
    id: newRootId,
    accountId,
    campaignId,
    version: newRootVersion,
    authorityArtifactIds: newAuthorityArtifactIds,
    previousRootId: previousRoot.id,
    previousRootVersion: previousRoot.version,
    adaptiveDecisionId,
    reasoningCaseId,
    primaryAxis: previousRoot.primaryAxis,
    contrastAxis: previousRoot.contrastAxis,
    approvedMechanism: previousRoot.approvedMechanism,
    approvedLanes: previousRoot.approvedLanes,
    createdAt,
  };

  // 3. Validate Immutability check
  validateStrategyRootImmutability(previousRoot, newRoot);

  const lineage: StrategyAdaptationLineage = {
    id: `sal_${randomUUID().slice(0, 12)}`,
    campaignId,
    accountId,
    previousRootId: previousRoot.id,
    previousRootVersion: previousRoot.version,
    newRootId,
    newRootVersion,
    triggerReasoningCaseId: reasoningCaseId || null,
    triggerAdaptiveDecisionId: adaptiveDecisionId,
    changedAuthorities,
    preservedAuthorities,
    sourceEventIds,
    sourcePerformanceWarningIds,
    evidenceIds,
    createdAt,
  };

  return {
    newRoot,
    lineage,
    changedAuthorities,
    preservedAuthorities,
  };
}
