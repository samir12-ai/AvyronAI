import { db } from "../db";
import { buildAnalyticalPackage } from "../analytical-enrichment-layer/engine";
import {
  enforceGenericEngineCompliance,
  buildCELReport,
  storeCELReport,
  type ComplianceResult,
} from "../causal-enforcement-layer/engine";
import {
  initializeSignalGovernance,
  resolveSignalsForEngine,
  getGovernanceSummary,
} from "../signal-governance/engine";
import type { SignalGovernanceState } from "../signal-governance/types";
import { runSystemIntegrityValidation } from "../system-integrity/engine";
import { summarizeEngine } from "../agent/summarizers";
import type { IntegrityReport } from "../system-integrity/types";
import { storeIntegrityReport } from "../system-integrity/routes";
import { evaluateSystemControl } from "../system-control/engine";
import { auditEngineContract } from "./contract-registry";
import type { SystemControlVerdict } from "../system-control/types";
import { storeControlVerdict } from "../system-control/routes";
import { ENGINE_VERSION as DIFFERENTIATION_ENGINE_VERSION } from "../differentiation-engine/constants";
import { ENGINE_VERSION as OFFER_ENGINE_VERSION } from "../offer-engine/constants";
import { ENGINE_VERSION as AWARENESS_ENGINE_VERSION } from "../awareness-engine/constants";
import { ENGINE_VERSION as FUNNEL_ENGINE_VERSION } from "../funnel-engine/constants";
import { ENGINE_VERSION as PERSUASION_ENGINE_VERSION } from "../persuasion-engine/constants";
import { ENGINE_VERSION as BUDGET_GOVERNOR_ENGINE_VERSION } from "../strategy/budget-governor/constants";
import { ENGINE_VERSION as CHANNEL_SELECTION_ENGINE_VERSION } from "../strategy/channel-selection/constants";
import {
  createEmptySSC,
  registerProblem,
  resolveProblem,
  deferProblem,
  markCannotResolve,
  getRelevantProblems,
  updateConfidenceChain,
  addReasonTrace,
  addContradiction,
  getUnresolvedCriticalProblems,
  emitCommercialSignal,
  type SharedStrategicContext,
  type ProblemEntry,
} from "./shared-strategic-context";
import { resolveAwarenessMeaning } from "./canonical-meanings";
import {
  orchestratorJobs,
  strategicPlans,
  growthCampaigns,
  businessDataLayer,
  miSnapshots,
  audienceSnapshots,
  positioningSnapshots,
  differentiationSnapshots,
  mechanismSnapshots,
  offerSnapshots,
  funnelSnapshots,
  integritySnapshots,
  awarenessSnapshots,
  persuasionSnapshots,
  strategyValidationSnapshots,
  budgetGovernorSnapshots,
  channelSelectionSnapshots,
  iterationSnapshots,
  retentionSnapshots,
  iterationGateInputs,
  manualCampaignMetrics,
  retentionGateInputs,
  manualRetentionMetrics,
} from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import {
  ENGINE_PRIORITY_ORDER,
  checkPriorityViolation,
  shouldBlockDownstream,
  type EngineId,
  type EngineStepResult,
  type NeedsInputPayload,
} from "./priority-matrix";
// U5c (May 2026) — Unified Weighted Reliability Doctrine: gate-retry
// policy lives in decision-policy/retry-policy.ts. Cutover proven by
// .local/validation/retry-policy-shadow.ts (180/180 parity, 0 drift).
// Gate-only by user constraint — per-engine REJECTED-loop retries are
// out of scope (boundary enforced by server/tests/retry-policy-boundary.test.ts).
import { planRetry, computeShadowRetryRecommendation } from "../decision-policy/retry-policy";
import { synthesizePlan } from "./plan-synthesis";
import {
  buildMemoryContext,
  serializeMemoryContextForPrompt,
  makeStrategyFingerprint,
} from "./memory-context";
import { strategyMemory } from "@shared/schema";
import { snapshotPreMetrics } from "../outcome-tracker";
import { applyMemoryMutation } from "../memory-mutation/engine";
import type { MemoryClass } from "../memory-system/types";

import { MarketIntelligenceV3 } from "../market-intelligence-v3/engine";
import { runAudienceEngine, getLatestAudienceSnapshot } from "../audience-engine/engine";
import {
  computeInputHash,
  logReuseHit,
  logReuseMiss,
  tryReuseAudience,
  tryReusePositioning,
  tryReuseDifferentiation,
  tryReuseMechanism,
  tryReuseOffer,
  tryReuseAwareness,
  tryReuseFunnel,
  tryReuseIntegrity,
  tryReusePersuasion,
  tryReuseStatVal,
  tryReuseBudgetGovernor,
  tryReuseChannelSelection,
  tryReuseIteration,
  tryReuseRetention,
} from "./snapshot-reuse";
import {
  audienceSnapshots as audienceSnapshotsTbl,
  positioningSnapshots as positioningSnapshotsTbl,
} from "@shared/schema";
import { runPositioningEngine } from "../positioning-engine/engine";
import { runDifferentiationEngine } from "../differentiation-engine/engine";
import { runMechanismEngine } from "../mechanism-engine/engine";
import { runOfferEngine } from "../offer-engine/engine";
import { getActiveRoot, buildStrategyRoot, StrategyRootIncompleteError } from "../shared/strategy-root";
import { assembleStrategyRootInput, canonicalizeAudienceShape } from "../shared/strategy-root-assembler";
import { runFunnelEngine } from "../funnel-engine/engine";
import { runIntegrityEngine } from "../integrity-engine/engine";
import { runAwarenessEngine } from "../awareness-engine/engine";
import { runPersuasionEngine } from "../persuasion-engine/engine";
import {
  createSourceLineageEntry,
  computeSignalComposition,
  formatCompositionLog,
  type SignalLineageEntry,
  type SignalOriginType,
  type SignalComposition,
  parseLineageFromSnapshot,
  bridgePerformanceToLineage,
} from "../shared/signal-lineage";
import { runStatisticalValidationEngine } from "../strategy/statistical-validation/engine";
import { runBudgetGovernorEngine } from "../strategy/budget-governor/engine";
import { runChannelSelectionEngine } from "../strategy/channel-selection/engine";
import { runIterationEngine } from "../strategy/iteration-engine/engine";
import { runRetentionEngine } from "../strategy/retention-engine/engine";
// ── Phase 2 (May 2026) downstream commercial-reasoning modules ──
import { designValidationJudgement } from "../strategy/statistical-validation/validation-judgement";
import { designBudgetStrategy } from "../strategy/budget-governor/budget-strategy";
import { designChannelOrchestration } from "../strategy/channel-selection/channel-orchestration";
import { designIterationStrategy } from "../strategy/iteration-engine/iteration-strategy";
import { designRetentionEconomics } from "../strategy/retention-engine/retention-economics";
import { designSystemJudgement } from "../system-control/system-judgement";
import { resolveSnapshotWriteStatus } from "../shared/canonical-snapshot-reader";

export interface AgentProgressEvent {
  engineId: EngineId;
  engineName: string;
  tier: string;
  status: string;
  engineIndex: number;
  totalEngines: number;
  durationMs: number;
  output?: any;
  blockReason?: string;
}

export interface OrchestratorConfig {
  accountId: string;
  campaignId: string;
  forceRefresh?: boolean;
  resumeFromEngine?: EngineId;
  pausedJobId?: string;
  preassignedJobId?: string;
  onProgress?: (event: AgentProgressEvent) => void;
  /** When set, only run the specified engine IDs (dual-analysis scoped run). All dependency-gathering engines still run. */
  scopedEngines?: string[];
}

export interface OrchestratorRunResult {
  jobId: string;
  status: "COMPLETED" | "PARTIAL" | "BLOCKED" | "ERROR" | "NEEDS_INPUT" | "BLOCKED_BY_INTEGRITY";
  completedEngines: string[];
  failedEngine?: string;
  blockReason?: string;
  planId?: string;
  results: Map<EngineId, EngineStepResult>;
  durationMs: number;
  needsInput?: NeedsInputPayload;
  controlVerdict?: SystemControlVerdict;
}

interface EngineContext {
  ssc?: SharedStrategicContext;
  mi?: any;
  audience?: any;
  positioning?: any;
  differentiation?: any;
  mechanism?: any;
  mechanismSnapshotId?: string;
  strategyRootId?: string;
  offer?: any;
  funnel?: any;
  integrity?: any;
  awareness?: any;
  persuasion?: any;
  statisticalValidation?: any;
  budgetGovernor?: any;
  budgetGovernorSnapshotId?: string;
  channelSelection?: any;
  channelSelectionSnapshotId?: string;
  iteration?: any;
  iterationSnapshotId?: string;
  retention?: any;
  retentionSnapshotId?: string;
  integritySnapshotId?: string;
  miSnapshotId?: string;
  audienceSnapshotId?: string;
  positioningSnapshotId?: string;
  differentiationSnapshotId?: string;
  analyticalEnrichment?: any;
  celResults?: ComplianceResult[];
  depthGateStatus?: Record<string, string>;
  sglState?: SignalGovernanceState;
  integrityReport?: IntegrityReport;
  memoryContext?: string;
  signalComposition?: SignalComposition;
  performanceLineage?: SignalLineageEntry[];
  inputHashes?: Record<string, string>;
}

async function getBusinessData(accountId: string, campaignId: string): Promise<any> {
  const [biz] = await db
    .select()
    .from(businessDataLayer)
    .where(
      and(
        eq(businessDataLayer.accountId, accountId),
        eq(businessDataLayer.campaignId, campaignId)
      )
    )
    .limit(1);
  return biz || null;
}

async function getCampaignData(campaignId: string): Promise<any> {
  const [campaign] = await db
    .select()
    .from(growthCampaigns)
    .where(eq(growthCampaigns.id, campaignId))
    .limit(1);
  return campaign || null;
}

async function getIterationGateData(accountId: string, campaignId: string): Promise<{
  gateInputs: any;
  campaignMetrics: any;
  missingFields: string[];
  prefillableFields: Record<string, any>;
  isReady: boolean;
}> {
  const [gateRow] = await db
    .select()
    .from(iterationGateInputs)
    .where(and(eq(iterationGateInputs.accountId, accountId), eq(iterationGateInputs.campaignId, campaignId)))
    .limit(1);

  const [metricsRow] = await db
    .select()
    .from(manualCampaignMetrics)
    .where(and(eq(manualCampaignMetrics.accountId, accountId), eq(manualCampaignMetrics.campaignId, campaignId)))
    .limit(1);

  const missing: string[] = [];
  const prefillable: Record<string, any> = {};

  if (!gateRow?.primaryKpi) missing.push("primaryKpi");
  else prefillable["primaryKpi"] = gateRow.primaryKpi;

  if (!gateRow?.dataWindowDays) missing.push("dataWindowDays");
  else prefillable["dataWindowDays"] = String(gateRow.dataWindowDays);

  const hasAnyMetric = metricsRow && (
    (metricsRow.spend || 0) > 0 ||
    (metricsRow.impressions || 0) > 0 ||
    (metricsRow.clicks || 0) > 0 ||
    (metricsRow.leads || 0) > 0 ||
    (metricsRow.revenue || 0) > 0 ||
    (metricsRow.conversions || 0) > 0
  );

  if (!hasAnyMetric) {
    missing.push("spend");
    missing.push("impressions");
    missing.push("conversions");
    missing.push("revenue");
  } else {
    if (metricsRow?.spend) prefillable["spend"] = String(metricsRow.spend);
    if (metricsRow?.impressions) prefillable["impressions"] = String(metricsRow.impressions);
    if (metricsRow?.clicks) prefillable["clicks"] = String(metricsRow.clicks);
    if (metricsRow?.conversions) prefillable["conversions"] = String(metricsRow.conversions);
    if (metricsRow?.revenue) prefillable["revenue"] = String(metricsRow.revenue);
  }

  return {
    gateInputs: gateRow || null,
    campaignMetrics: metricsRow || null,
    missingFields: missing,
    prefillableFields: prefillable,
    isReady: missing.length === 0,
  };
}

async function getRetentionGateData(accountId: string, campaignId: string): Promise<{
  gateInputs: any;
  retentionMetrics: any;
  missingFields: string[];
  prefillableFields: Record<string, any>;
  isReady: boolean;
}> {
  const [gateRow] = await db
    .select()
    .from(retentionGateInputs)
    .where(and(eq(retentionGateInputs.accountId, accountId), eq(retentionGateInputs.campaignId, campaignId)))
    .limit(1);

  const [metricsRow] = await db
    .select()
    .from(manualRetentionMetrics)
    .where(and(eq(manualRetentionMetrics.accountId, accountId), eq(manualRetentionMetrics.campaignId, campaignId)))
    .limit(1);

  const missing: string[] = [];
  const prefillable: Record<string, any> = {};

  if (!gateRow?.retentionGoal) missing.push("retentionGoal");
  else prefillable["retentionGoal"] = gateRow.retentionGoal;

  if (!gateRow?.businessModel) missing.push("businessModel");
  else prefillable["businessModel"] = gateRow.businessModel;

  if (!gateRow?.reachableAudience) missing.push("reachableAudience");
  else prefillable["reachableAudience"] = gateRow.reachableAudience;

  if (!metricsRow || (metricsRow.totalCustomers || 0) <= 0) missing.push("totalCustomers");
  else prefillable["totalCustomers"] = String(metricsRow.totalCustomers);

  if (!metricsRow || metricsRow.returningCustomers == null) missing.push("returningCustomers");
  else prefillable["returningCustomers"] = String(metricsRow.returningCustomers);

  if (!metricsRow || (metricsRow.totalPurchases || 0) <= 0) missing.push("totalPurchases");
  else prefillable["totalPurchases"] = String(metricsRow.totalPurchases);

  if (!metricsRow || ![30, 60, 90].includes(metricsRow.dataWindowDays || 0)) missing.push("dataWindowDays");
  else prefillable["dataWindowDays"] = String(metricsRow.dataWindowDays);

  return {
    gateInputs: gateRow || null,
    retentionMetrics: metricsRow || null,
    missingFields: missing,
    prefillableFields: prefillable,
    isReady: missing.length === 0,
  };
}

function extractMiInput(miResult: any): any {
  if (!miResult?.output) return {};
  const out = miResult.output;

  const intentMap: any[] = Array.isArray(out.competitorIntentMap) ? out.competitorIntentMap : [];
  const competitors = (out.competitors && Array.isArray(out.competitors) && out.competitors.length > 0)
    ? out.competitors
    : intentMap.map((c: any) => ({
        id: c.competitorId || c.id || null,
        name: c.competitorName || c.name || null,
        intentType: c.intentType || c.dominantIntentType || null,
        intentConfidence: c.confidence ?? c.intentConfidence ?? null,
        evidenceCount: c.evidenceCount ?? c.postsAnalyzed ?? null,
      }));

  const opportunitySignals = out.opportunitySignals || [];
  const threatSignals = out.threatSignals || [];
  const taggedOpp = Array.isArray(out.taggedOpportunitySignals) ? out.taggedOpportunitySignals : [];
  const taggedThreat = Array.isArray(out.taggedThreatSignals) ? out.taggedThreatSignals : [];

  const rawSignals: any[] = (out.signals && Array.isArray(out.signals) && out.signals.length > 0)
    ? out.signals
    : [...opportunitySignals, ...threatSignals];

  const taggedSignals = (taggedOpp.length + taggedThreat.length > 0)
    ? [...taggedOpp, ...taggedThreat]
    : rawSignals.map((s: any) => {
        if (typeof s === "string") return { text: s, originType: "competitor" as const };
        return { text: s.text || s.signal || s.name || JSON.stringify(s), originType: s.originType || "competitor" as const };
      });

  const confidenceObj = out.confidence;
  const confidenceNumber = (typeof confidenceObj === "number")
    ? confidenceObj
    : (confidenceObj && typeof confidenceObj === "object" ? (confidenceObj.overall ?? confidenceObj.score ?? null) : null);
  const overallConfidence = out.overallConfidence
    ?? miResult.overallConfidence
    ?? confidenceNumber
    ?? null;

  return {
    competitors,
    competitorIntentMap: intentMap,
    signals: rawSignals,
    taggedSignals,
    opportunitySignals,
    threatSignals,
    dominance: miResult.dominanceData || [],
    trajectory: miResult.trajectoryData || null,
    marketState: out.marketState || null,
    marketDiagnosis: out.marketDiagnosis || null,
    dominantIntentType: out.dominantIntentType || null,
    evidenceCoverage: out.evidenceCoverage || null,
    audienceIntentSignals: out.audienceIntentSignals || [],
    missingSignalFlags: out.missingSignalFlags || [],
    dataFreshnessDays: out.dataFreshnessDays ?? null,
    volatilityIndex: out.volatilityIndex ?? null,
    signalNoiseRatio: out.signalNoiseRatio ?? null,
    confidence: overallConfidence,
    overallConfidence,
  };
}

function extractAudienceInput(audienceResult: any): any {
  if (!audienceResult) return {};
  const rawAwareness = audienceResult.awarenessLevel;
  let awarenessLevel: string | null = null;
  if (typeof rawAwareness === "string") {
    awarenessLevel = rawAwareness;
  } else if (rawAwareness != null && typeof rawAwareness === "object" && typeof rawAwareness.level === "string") {
    awarenessLevel = rawAwareness.level;
  }
  // Tolerate legacy aliases at INPUT only (test fixtures still use painProfiles).
  // The emitted canonical key below is `audiencePains` exclusively.
  const audiencePainsCanonical = audienceResult.audiencePains || audienceResult.painMap || audienceResult.painProfiles || [];

  // CONTRACT NOTE (text-policy):
  // Synthetic indexed keys (objection_N / desire_N) are RESERVED for internal
  // map indexing and audit lineage only. They MUST NOT leak into display
  // fields. Each value object now carries an explicit `label` (human text)
  // and `id` (synthetic key). Downstream display code must read `.label`,
  // never the map key.
  const rawObjections = audienceResult.objectionMap ?? {};
  const objectionMapObject: Record<string, any> = Array.isArray(rawObjections)
    ? rawObjections.reduce((acc: Record<string, any>, item: any, idx: number) => {
        const labelCandidate = typeof item === "string"
          ? item
          : (item?.label || item?.objection || item?.text || item?.name || null);
        const id = typeof item === "string"
          ? item
          : (item?.key || `objection_${idx}`);
        const value = typeof item === "object" && item !== null
          ? { ...item, id, label: labelCandidate }
          : { id, label: labelCandidate, raw: item };
        acc[id] = value;
        return acc;
      }, {})
    : (rawObjections && typeof rawObjections === "object" ? rawObjections : {});
  const rawDesire = audienceResult.desireMap ?? {};
  const desireMapObject: Record<string, any> = Array.isArray(rawDesire)
    ? rawDesire.reduce((acc: Record<string, any>, item: any, idx: number) => {
        const labelCandidate = typeof item === "string"
          ? item
          : (item?.label || item?.desire || item?.text || item?.name || null);
        const id = typeof item === "string"
          ? item
          : (item?.key || `desire_${idx}`);
        const value = typeof item === "object" && item !== null
          ? { ...item, id, label: labelCandidate }
          : { id, label: labelCandidate, raw: item };
        acc[id] = value;
        return acc;
      }, {})
    : (rawDesire && typeof rawDesire === "object" ? rawDesire : {});
  const segments = audienceResult.audienceSegments || audienceResult.segments || [];
  return {
    // CANONICAL: only `audiencePains` is emitted. Legacy `painProfiles` /
    // `painMap` aliases are intentionally NOT propagated.
    audiencePains: audiencePainsCanonical,
    desireMap: desireMapObject,
    objectionMap: objectionMapObject,
    transformationMap: audienceResult.transformationMap || [],
    emotionalDrivers: audienceResult.emotionalDrivers || [],
    segments,
    audienceSegments: segments,
    awarenessLevel,
    maturityIndex: audienceResult.maturityIndex || null,
  };
}

function extractPositioningInput(positioningResult: any): any {
  if (!positioningResult) return {};
  const out = positioningResult.output || positioningResult;
  const territories: any[] = out.territories || positioningResult.territories || [];
  return {
    territories,
    narrative: out.narrative || positioningResult.narrative || "",
    narrativeDirection: out.narrativeDirection || positioningResult.narrativeDirection || "",
    specificity: out.specificityScore || positioningResult.specificityScore || 0,
    saturation: out.saturationScore || positioningResult.saturationScore || 0,
    stabilityResult: out.stabilityResult || positioningResult.stabilityResult || { isStable: true, checks: [], advisories: [], fallbackApplied: false },
    strategyCards: out.strategyCards || positioningResult.strategyCards || [],
    differentiationVector: out.differentiationVector || positioningResult.differentiationVector || [],
    domainFailures: territories.map((t: any) => t.domainFailure).filter(Boolean),
    operationalProblems: territories.map((t: any) => t.operationalProblem).filter(Boolean),
    proofRequirements: territories.map((t: any) => t.proofRequirement).filter(Boolean),
  };
}

function extractDifferentiationInput(diffResult: any): any {
  if (!diffResult) return {};
  return {
    claims: diffResult.validatedClaims || [],
    pillars: diffResult.pillars || diffResult.validatedClaims || [],
    collisions: diffResult.collisions || [],
    trustGaps: diffResult.trustGaps || [],
    proofMap: diffResult.proofDemandMap || [],
    mechanismFraming: diffResult.mechanismFraming || diffResult.mechanismCore || null,
    mechanismCore: diffResult.mechanismCore || null,
    authorityMode: diffResult.authorityMode || null,
    claimStructures: diffResult.claimStructures || diffResult.validatedClaims || [],
    proofArchitecture: diffResult.proofArchitecture || diffResult.proofDemandMap || [],
    confidenceScore: diffResult.confidenceScore || diffResult.confidence || null,
  };
}

function extractOfferInput(offerResult: any): any {
  if (!offerResult) return {};
  const primary = offerResult.primaryOffer || offerResult.selectedOffer || offerResult;
  return {
    offerName: primary.offerName || primary.name || offerResult.offerName || null,
    // eslint-disable-next-line semantic/no-semantic-fallback -- C (H8): offer content field cascade (coreOutcome→outcome) — domain content, not verdict-shape
    coreOutcome: primary.coreOutcome || primary.outcome || offerResult.coreOutcome || null,
    mechanismDescription: primary.mechanismDescription || offerResult.mechanismDescription || null,
    headline: primary.headline || offerResult.headline || null,
    deliverables: Array.isArray(primary.deliverables) ? primary.deliverables : (Array.isArray(offerResult.deliverables) ? offerResult.deliverables : []),
    riskReducers: Array.isArray(primary.riskReducers) ? primary.riskReducers : (Array.isArray(offerResult.riskReducers) ? offerResult.riskReducers : []),
    riskNotes: Array.isArray(primary.riskNotes) ? primary.riskNotes : (Array.isArray(offerResult.riskNotes) ? offerResult.riskNotes : []),
    proofAlignment: Array.isArray(primary.proofAlignment) ? primary.proofAlignment : (Array.isArray(offerResult.proofAlignment) ? offerResult.proofAlignment : []),
    proofGrounding: Array.isArray(primary.proofGrounding) ? primary.proofGrounding : (Array.isArray(primary.proofLayer?.proofGrounding) ? primary.proofLayer.proofGrounding : (Array.isArray(offerResult.proofGrounding) ? offerResult.proofGrounding : [])),
    frictionLevel: primary.frictionLevel || offerResult.frictionLevel || null,
    proofStrength: primary.proofLayer?.proofStrength ?? offerResult.proofLayer?.proofStrength ?? null,
    offerStrengthScore: offerResult.offerStrengthScore ?? null,
    positioningConsistency: offerResult.positioningConsistency || null,
    hookMechanismAlignment: offerResult.hookMechanismAlignment || null,
    boundaryCheck: offerResult.boundaryCheck || null,
    signalGrounding: offerResult.signalGrounding || null,
    lockedDecisions: offerResult.layerDiagnostics?.positioningLock?.lockedDecisions || [],
    nonGenericAnchors: offerResult.layerDiagnostics?.positioningLock?.nonGenericAnchors || [],
    snapshotId: offerResult.snapshotId || null,
  };
}

function extractFunnelInput(funnelResult: any): any {
  if (!funnelResult) return {};
  const primary = funnelResult.primaryFunnel || funnelResult;
  const rawStages = Array.isArray(primary.stageMap) ? primary.stageMap
    : Array.isArray(primary.stages) ? primary.stages
    : Array.isArray(funnelResult.stageMap) ? funnelResult.stageMap
    : Array.isArray(funnelResult.stages) ? funnelResult.stages : [];
  const trustPathRaw = primary.trustPath || funnelResult.trustPathAnalysis || funnelResult.trustPath || [];
  return {
    funnelType: primary.funnelType || primary.type || funnelResult.funnelType || null,
    funnelName: primary.funnelName || primary.name || funnelResult.funnelName || null,
    stages: rawStages,
    stageMap: rawStages,
    trustPath: Array.isArray(trustPathRaw) ? trustPathRaw : (trustPathRaw?.path || trustPathRaw?.stages || []),
    trustPathScore: funnelResult.trustPathAnalysis?.score ?? null,
    proofPlacements: (() => {
      // The real per-placement array lives at primary.proofPlacements
      // (objects of { stage, proofType, placement, purpose }).
      // funnelResult.proofPlacementLogic.placements is a COUNT (number),
      // not an array — reading it first caused integrity to see 0 placements
      // and fire the false-positive "no proof placements" warning.
      // Order: primary.proofPlacements (real) -> stage-level proofs (real) ->
      // proofPlacementLogic.placements only when it happens to be an array.
      const fromPrimary = primary.proofPlacements;
      if (Array.isArray(fromPrimary) && fromPrimary.length > 0) return fromPrimary;
      if (typeof fromPrimary === 'string') {
        try { const a = JSON.parse(fromPrimary); if (Array.isArray(a) && a.length > 0) return a; } catch {}
      }
      const stagePlacements: any[] = [];
      for (const s of (rawStages || [])) {
        const sp = s?.proofPlacements || s?.proofs || [];
        if (Array.isArray(sp)) {
          for (const item of sp) {
            stagePlacements.push(typeof item === 'string'
              ? { proofType: item, stage: s.name || s.stageName }
              : { ...item, stage: item.stage || s.name || s.stageName });
          }
        }
      }
      if (stagePlacements.length > 0) return stagePlacements;
      const fallback = funnelResult.proofPlacementLogic?.placements;
      if (Array.isArray(fallback)) return fallback;
      if (typeof fallback === 'string') {
        try { const a = JSON.parse(fallback); if (Array.isArray(a)) return a; } catch {}
      }
      return [];
    })(),
    frictionMap: primary.frictionMap || funnelResult.frictionMap || [],
    commitmentLevel: primary.commitmentLevel || funnelResult.commitmentLevel || "medium",
    entryTrigger: primary.entryTrigger || funnelResult.entryTrigger || { mechanismType: "unknown", purpose: "unknown" },
    funnelStrengthScore: funnelResult.funnelStrengthScore ?? primary.funnelStrengthScore ?? 0,
    boundaryCheck: funnelResult.boundaryCheck || null,
    snapshotId: funnelResult.snapshotId || null,
  };
}

function extractAwarenessValidationInput(awarenessResult: any): any {
  if (!awarenessResult) {
    return {
      entryMechanismType: "unknown",
      targetReadinessStage: "unknown",
      triggerClass: "unknown",
      trustRequirement: "unknown",
      funnelCompatibility: "unknown",
      awarenessStrengthScore: 0,
      frictionNotes: [],
    };
  }
  const pr = awarenessResult.primaryRoute || awarenessResult;
  return {
    entryMechanismType: pr.entryMechanismType || "unknown",
    targetReadinessStage: pr.targetReadinessStage || "unknown",
    triggerClass: pr.triggerClass || "unknown",
    trustRequirement: pr.trustRequirement || "unknown",
    funnelCompatibility: pr.funnelCompatibility || "unknown",
    awarenessStrengthScore: typeof pr.awarenessStrengthScore === "number" ? pr.awarenessStrengthScore : 0,
    frictionNotes: Array.isArray(pr.frictionNotes) ? pr.frictionNotes : [],
  };
}

function extractPersuasionValidationInput(persuasionResult: any): any {
  if (!persuasionResult) {
    return {
      persuasionMode: "none",
      primaryInfluenceDrivers: [],
      objectionPriorities: [],
      trustSequence: [],
      persuasionStrengthScore: 0,
      frictionNotes: [],
      trustBarriers: [],
      objectionProofLinks: [],
      structuredObjections: [],
    };
  }
  const pr = persuasionResult.primaryRoute || persuasionResult;
  return {
    persuasionMode: pr.persuasionMode || "none",
    primaryInfluenceDrivers: Array.isArray(pr.primaryInfluenceDrivers) ? pr.primaryInfluenceDrivers : [],
    objectionPriorities: Array.isArray(pr.objectionPriorities) ? pr.objectionPriorities : [],
    trustSequence: Array.isArray(pr.trustSequence) ? pr.trustSequence : [],
    persuasionStrengthScore: typeof pr.persuasionStrengthScore === "number" ? pr.persuasionStrengthScore : 0,
    frictionNotes: Array.isArray(pr.frictionNotes) ? pr.frictionNotes : [],
    trustBarriers: Array.isArray(persuasionResult.trustBarriers) ? persuasionResult.trustBarriers : [],
    objectionProofLinks: Array.isArray(persuasionResult.objectionProofLinks) ? persuasionResult.objectionProofLinks : [],
    structuredObjections: Array.isArray(persuasionResult.structuredObjections) ? persuasionResult.structuredObjections : [],
  };
}

function resolveUpstreamOriginType(ctx: EngineContext, engine: string): SignalOriginType {
  if (engine === "audience") return "competitor";
  if (engine === "positioning" || engine === "differentiation" || engine === "mechanism") return "inferred";
  return "unknown";
}

function buildUpstreamLineage(ctx: EngineContext): SignalLineageEntry[] {
  const entries: SignalLineageEntry[] = [];
  let idx = 0;

  const audienceResult = ctx.audience;
  if (audienceResult) {
    const audOrigin = resolveUpstreamOriginType(ctx, "audience");
    const extractSignalText = (item: any): string => {
      if (!item) return "";
      if (typeof item === "string") return item;
      return item.canonical || item.text || item.pain || item.desire || item.objection
        || item.name || item.label || item.description || "";
    };
    const pains = audienceResult.audiencePains || audienceResult.painMap || audienceResult.painProfiles || [];
    for (const p of pains.slice(0, 8)) {
      const text = extractSignalText(p);
      if (text) entries.push(createSourceLineageEntry("audience", "pain", text, idx++, audOrigin));
    }
    const desires = audienceResult.desireMap || [];
    for (const d of desires.slice(0, 8)) {
      const text = extractSignalText(d);
      if (text) entries.push(createSourceLineageEntry("audience", "desire", text, idx++, audOrigin));
    }
    const objections = audienceResult.objectionMap || [];
    for (const o of objections.slice(0, 5)) {
      const text = extractSignalText(o);
      if (text) entries.push(createSourceLineageEntry("audience", "objection", text, idx++, audOrigin));
    }
    const drivers = audienceResult.emotionalDrivers || [];
    for (const d of drivers.slice(0, 5)) {
      const text = typeof d === "string" ? d : (d?.driver || d?.canonical || d?.description || "");
      if (text) entries.push(createSourceLineageEntry("audience", "emotional_driver", text, idx++, audOrigin));
    }
  }

  const positioningResult = ctx.positioning;
  if (positioningResult) {
    const posOrigin = resolveUpstreamOriginType(ctx, "positioning");
    const out = positioningResult.output || positioningResult;
    const territories: any[] = out.territories || positioningResult.territories || [];
    for (const t of territories.slice(0, 3)) {
      const text = typeof t === "string" ? t : t.name || t.territory || JSON.stringify(t);
      entries.push(createSourceLineageEntry("positioning", "territory", text, idx++, posOrigin));
    }
    const cards = out.strategyCards || positioningResult.strategyCards || [];
    for (const c of cards.slice(0, 3)) {
      const text = typeof c === "string" ? c : c.claim || c.description || c.name || JSON.stringify(c);
      entries.push(createSourceLineageEntry("positioning", "strategy_card", text, idx++, posOrigin));
    }
  }

  const diffResult = ctx.differentiation;
  if (diffResult) {
    const diffOrigin = resolveUpstreamOriginType(ctx, "differentiation");
    const claims = diffResult.validatedClaims || [];
    for (const c of claims.slice(0, 5)) {
      const text = typeof c === "string" ? c : c.claim || c.description || c.name || JSON.stringify(c);
      entries.push(createSourceLineageEntry("differentiation", "claim", text, idx++, diffOrigin));
    }
    const pillars = diffResult.pillars || [];
    for (const p of pillars.slice(0, 3)) {
      const text = typeof p === "string" ? p : p.description || p.name || p.territory || JSON.stringify(p);
      entries.push(createSourceLineageEntry("differentiation", "pillar", text, idx++, diffOrigin));
    }
  }

  const mechResult = ctx.mechanism;
  if (mechResult?.primaryMechanism) {
    const mechOrigin = resolveUpstreamOriginType(ctx, "mechanism");
    const m = mechResult.primaryMechanism;
    if (m.mechanismDescription) {
      entries.push(createSourceLineageEntry("mechanism", "mechanism_description", m.mechanismDescription, idx++, mechOrigin));
    }
    if (m.mechanismLogic) {
      entries.push(createSourceLineageEntry("mechanism", "mechanism_logic", m.mechanismLogic, idx++, mechOrigin));
    }
    const steps = m.mechanismSteps || [];
    for (const s of steps.slice(0, 5)) {
      entries.push(createSourceLineageEntry("mechanism", "mechanism_step", s, idx++, mechOrigin));
    }
  }

  if (ctx.performanceLineage && ctx.performanceLineage.length > 0) {
    entries.push(...ctx.performanceLineage);
  }

  const comp = computeSignalComposition(entries);
  ctx.signalComposition = comp;
  console.log(`[Orchestrator] LINEAGE_BUILT | entries=${entries.length} | sources=[${[...new Set(entries.map(e => e.originEngine))].join(",")}] | composition: ${formatCompositionLog(comp)}`);

  if (comp.unknownRatio > 0.3 && comp.total > 0) {
    console.warn(`[Orchestrator] HIGH_UNKNOWN_RATIO | unknownRatio=${(comp.unknownRatio * 100).toFixed(0)}% (${comp.unknown}/${comp.total}) — legacy/untagged signals dominate. These are NOT trusted.`);
  }
  if (comp.trustedRatio < 0.5 && comp.total > 5) {
    console.warn(`[Orchestrator] LOW_TRUSTED_RATIO | trustedRatio=${(comp.trustedRatio * 100).toFixed(0)}% — strategy lacks grounded (real + competitor) signals.`);
  }

  return entries;
}

function resolveSglOrBlock(
  engineId: EngineId,
  ctx: EngineContext,
  startTime: number,
): EngineStepResult | null {
  if (!ctx.sglState) return null;
  const sglRes = resolveSignalsForEngine(ctx.sglState, engineId);
  if (sglRes.blocked) {
    return {
      engineId,
      status: "SKIPPED",
      output: null,
      durationMs: Date.now() - startTime,
      blockReason: `SGL_COVERAGE_INSUFFICIENT | missing=[${sglRes.insufficientCategories.join(",")}]`,
    };
  }
  return null;
}

type EngineIdType = "market_intelligence" | "audience" | "positioning" | "differentiation" | "mechanism" | "offer" | "awareness" | "funnel" | "integrity" | "persuasion" | "statistical_validation" | "budget_governor" | "channel_selection" | "iteration" | "retention";

function extractEngineConfidence(engineId: string, output: any): { dataConfidence: number; engineConfidence: number; combined: number } {
  if (!output) return { dataConfidence: 0, engineConfidence: 0, combined: 0 };

  let dataConf = 0.5;
  let engineConf = 0.5;

  switch (engineId) {
    case "market_intelligence": {
      const miOutput = output.output ?? output;
      engineConf = miOutput.confidence?.overall ?? output.overallConfidence ?? output.confidenceScore ?? 0.5;
      dataConf = miOutput.dataReliability?.overallScore ?? miOutput.confidence?.factors?.dataCompleteness ?? engineConf;
      break;
    }
    case "audience":
      engineConf = output.confidenceScore ?? output.dataReliability?.overallReliability ?? 0.5;
      dataConf = output.dataReliability?.overallReliability ?? output.dataReliability?.score ?? engineConf;
      break;
    case "positioning":
      engineConf = output.engineConfidence ?? output.confidenceScore ?? 0.5;
      dataConf = output.dataConfidence ?? output.specificityScore ?? engineConf;
      break;
    case "differentiation":
      engineConf = output.confidenceScore ?? output.confidence ?? 0.5;
      dataConf = output.celDepthCompliance?.causalDepthScore ?? engineConf;
      break;
    case "mechanism":
      engineConf = output.confidenceScore ?? 0.5;
      dataConf = output.celDepthCompliance?.causalDepthScore ?? engineConf;
      break;
    case "offer":
      engineConf = output.offerStrengthScore ?? output.confidenceScore ?? 0.5;
      dataConf = output.proofLayer?.proofStrength ?? output.proofStrength ?? engineConf;
      break;
    case "awareness":
      engineConf = output.primaryRoute?.awarenessStrengthScore ?? output.confidenceScore ?? 0.5;
      dataConf = engineConf;
      break;
    case "funnel":
      engineConf = output.funnelStrengthScore ?? output.confidenceScore ?? 0.5;
      dataConf = output.trustPathAnalysis?.score ?? output.trustPathScore ?? engineConf;
      break;
    case "integrity":
      engineConf = output.overallIntegrityScore ?? 0.5;
      dataConf = engineConf;
      break;
    case "persuasion":
      engineConf = output.confidenceScore ?? 0.5;
      dataConf = output.celDepthCompliance?.causalDepthScore ?? engineConf;
      break;
    case "statistical_validation":
      engineConf = output.claimConfidenceScore ?? output.confidenceScore ?? 0.5;
      dataConf = output.dataReliability?.overallScore ?? engineConf;
      break;
    case "budget_governor":
      engineConf = output.confidenceScore ?? 0.5;
      dataConf = engineConf;
      break;
    case "channel_selection":
      engineConf = output.confidenceScore ?? 0.5;
      dataConf = engineConf;
      break;
    case "iteration":
      engineConf = output.confidenceScore ?? 0.5;
      dataConf = engineConf;
      break;
    case "retention":
      engineConf = output.confidenceScore ?? 0.5;
      dataConf = engineConf;
      break;
    default:
      engineConf = output.confidenceScore ?? 0.5;
      dataConf = engineConf;
  }

  dataConf = Math.max(0, Math.min(1, dataConf));
  engineConf = Math.max(0, Math.min(1, engineConf));
  const combined = (dataConf + engineConf) / 2;
  return { dataConfidence: dataConf, engineConfidence: engineConf, combined };
}

interface MidPipelineGateResult {
  gateFailed: boolean;
  reason: string;
  severity: "critical" | "high" | "medium";
  shouldRetry: boolean;
  setConfidenceFloor?: number;
  /**
   * R2a (May 2026, observation-only) — opaque id of the field whose absence
   * or invalid value caused this gate to fire. Forwarded to `planRetry` so
   * the importance-aware branch (`getFieldImportanceForRetry`) can be
   * consulted. Today the production registry is empty, so passing this
   * field cannot change `planRetry`'s output. The id is also consumed by
   * `computeShadowRetryRecommendation` to log a shadow comparison without
   * mutating the registry.
   */
  missingFieldId?: string;
}

function checkMidPipelineGate(engineId: string, stepResult: EngineStepResult, ctx: EngineContext): MidPipelineGateResult | null {
  if (stepResult.status !== "SUCCESS" && stepResult.status !== "PARTIAL") return null;
  const output = stepResult.output;
  if (!output) return null;

  switch (engineId) {
    case "positioning": {
      const engineConf = output.engineConfidence ?? output.confidenceScore ?? 1.0;
      if (engineConf < 0.40) {
        return {
          gateFailed: true,
          reason: `Positioning engineConfidence ${engineConf.toFixed(2)} below 0.40 minimum (gates on engine logic quality, not data reliability)`,
          severity: "critical",
          shouldRetry: true,
          missingFieldId: "positioning.engineConfidence",
        };
      }
      break;
    }
    // R3 housekeeping (May 10, 2026, user-authorized) — `case "offer"` deleted.
    // The painAlignment mid-pipeline gate was DEAD: it read
    // `output.signalGrounding?.painAlignment ?? output.painAlignment`, but the
    // offer engine never emits either field at any depth (R2b-a verification,
    // sealed in `.local/plans/r2b-a-pain-coverage-verification.md`). The gate
    // therefore short-circuited to `painScore === null → hasPainCoverage = true`
    // on every run and fired exactly zero times in production. Same commercial
    // failure mode (offer→pain misalignment) is covered by 5 parallel layers:
    //   1. Audience engine pain inference + confidence floor
    //   2. CEL alignment enforcement
    //   3. Integrity engine cross-engine alignment checks
    //   4. System-control structural checks
    //   5. Contradiction detector
    // Per R3 verdict (`.local/plans/r3-field-reality-audit.md` §3.1, §6 item 1)
    // and user authorization 2026-05-10, removing the dead branch eliminates
    // future audit/retry confusion and prevents anyone from re-wiring a retry
    // pilot onto a non-emitted signal. No retry pilot is being activated here.
    case "statistical_validation": {
      // D1/D2/D5 (H8): validationState (F3 — strategy/sample validation verdict) is
      // a DIFFERENT semantic class than status (F1 — engine execution status).
      // The previous `|| output.status` substituted across F-class boundaries
      // when validationState was missing — silently treating engine SUCCESS as
      // a validation verdict. Read the canonical F3 field only; absence MUST
      // produce a CONTRACT_INCOMPLETE-style critical gate fail (D5: missing
      // canonical → reject, never silent pass-through).
      const validationState = output.validationState;
      if (validationState === undefined || validationState === null) {
        return {
          gateFailed: true,
          reason: "CONTRACT_INCOMPLETE — statistical_validation engine output missing canonical F3 field 'validationState'; cannot evaluate gate without canonical verdict (D5)",
          severity: "critical",
          shouldRetry: false,
          setConfidenceFloor: 0,
          missingFieldId: "statistical_validation.validationState",
        };
      }
      if (validationState === "rejected") {
        return {
          gateFailed: true,
          reason: "Statistical validation rejected — strategy failed validation",
          severity: "critical",
          shouldRetry: false,
          setConfidenceFloor: 0,
          missingFieldId: "statistical_validation.validationState",
        };
      }
      break;
    }
    case "channel_selection": {
      // R3 housekeeping (May 10, 2026, user-authorized) — field-name drift fix.
      // PREVIOUS (dead): read `output.selectedChannels || output.channels`,
      // both of which the channel-selection engine never emits at the top level
      // (engine.ts:1429-1451 returns `primaryChannel`, `secondaryChannel`,
      // `conversionChannelAssigned`, `funnelReconstruction.funnelStages`).
      // The `||` chain therefore evaluated to `[]` on every run, the
      // `channels.length > 0 && !hasConversion` predicate was always false,
      // and the gate fired exactly zero times. Commercial behaviour was
      // preserved by `system-control/structural-checks.ts:checkConversionPath`
      // (which already reads the canonical fields via `requireContractField`),
      // but the orchestrator gate itself was dead.
      // FIX: mirror system-control's read shape — consult the engine's
      // canonical `conversionChannelAssigned` boolean (engine.ts:1388, 1445).
      // When the engine succeeded but did NOT assign a conversion channel,
      // fire the gate. When the field is absent (legacy/in-flight snapshots),
      // skip the gate rather than forcing a retry — the downstream
      // `checkConversionPath` will catch it via the contract boundary helper
      // and produce the canonical CONTRACT_INCOMPLETE/UNKNOWN signal.
      // Per R3 verdict (§3.5, §6 item 2) and user authorization 2026-05-10.
      // No retry pilot is being activated here — `shouldRetry: false` retained.
      if (output.conversionChannelAssigned === false) {
        return {
          gateFailed: true,
          reason: "Channel Selection produced zero conversion-capable channels (conversionChannelAssigned=false)",
          severity: "high",
          shouldRetry: false,
          missingFieldId: "channel_selection.conversionChannelAssigned",
        };
      }
      break;
    }
  }
  return null;
}

function updateSSCAfterEngine(ssc: SharedStrategicContext, engineId: string, stepResult: EngineStepResult, pipelineStep: number): void {
  if (stepResult.status !== "SUCCESS" && stepResult.status !== "PARTIAL") return;
  const output = stepResult.output;
  if (!output) return;

  const conf = extractEngineConfidence(engineId, output);
  const cappedCombined = Math.min(conf.combined, ssc.confidenceFloor === 0 ? 0 : conf.combined);
  const cappedEngine = ssc.confidenceFloor === 0 ? 0 : conf.engineConfidence;
  const cappedData = ssc.confidenceFloor === 0 ? 0 : conf.dataConfidence;

  updateConfidenceChain(ssc, engineId as EngineIdType, cappedData, cappedEngine, cappedCombined);

  if (ssc.confidenceFloor === 0 && conf.combined > 0) {
    console.warn(`[Orchestrator] SSC_CONFIDENCE_CAPPED | engine=${engineId} | raw=${conf.combined.toFixed(2)} | capped=0.00 | reason=floor_is_zero_after_rejection`);
  }
  console.log(`[Orchestrator] SSC_CONFIDENCE | engine=${engineId} | data=${cappedData.toFixed(2)} | engine=${cappedEngine.toFixed(2)} | combined=${cappedCombined.toFixed(2)} | floor=${ssc.confidenceFloor.toFixed(2)}`);
}

function detectProblemResolutionInOutput(engineId: string, output: any, problem: ProblemEntry): "resolved" | "deferred" | "cannot_resolve" | "unaddressed" {
  if (!output) return "unaddressed";

  // R-final housekeeping (May 10, 2026, user-authorized) — alignment branch
  // for offer/funnel deleted. The prior branch read
  // `output.signalGrounding?.painAlignment ?? output.painAlignment`, but
  // neither the offer engine nor the funnel engine ever emits either field
  // at any depth (R2b-a + R3 verification, sealed in
  // `.local/plans/r3-field-reality-audit.md`). painScore therefore evaluated
  // to `null` on every run, neither the "resolved" nor "cannot_resolve"
  // return fired, and execution fell through to the generic
  // `severity in {critical,high} && engineConf >= 0.70 → deferred` branch
  // below — identical to current behaviour with the dead read removed.
  // Same commercial failure mode (offer→audience pain misalignment) is
  // covered by 6 parallel runtime layers (Audience pain inference, CEL
  // alignment enforcement, Integrity ALIGNMENT_CHAIN, system-control
  // checkOfferAudienceMisalignment → OFFER_AUDIENCE_MISALIGNMENT block,
  // contradiction detector, checkZeroObjectionCoverage). Per the final
  // verification report (`.local/plans/r-phase-7claim-verification.md`,
  // "Remaining over-blocking cases" item 1) and user authorization
  // 2026-05-10. No retry pilot is being activated here.

  if (problem.type === "structural" && engineId === "positioning") {
    const conf = output.confidenceScore ?? output.specificityScore ?? 0;
    if (conf >= 0.40) return "resolved";
    return "cannot_resolve";
  }

  if (problem.type === "trust" && (engineId === "differentiation" || engineId === "mechanism" || engineId === "offer")) {
    const proofStrength = output.proofLayer?.proofStrength ?? output.proofStrength ?? null;
    const trustPath = output.trustPathAnalysis?.score ?? output.trustPathScore ?? null;
    if (proofStrength !== null && proofStrength >= 0.5) return "resolved";
    if (trustPath !== null && trustPath >= 0.5) return "resolved";
    const conf = output.confidenceScore ?? 0;
    if (conf >= 0.6) return "deferred";
  }

  if (problem.type === "conversion" && engineId === "channel_selection") {
    // R3 housekeeping (May 10, 2026, user-authorized) — same field-name drift
    // fix as `checkMidPipelineGate.case "channel_selection"` above. The prior
    // `output.selectedChannels || output.channels` reads always evaluated to
    // `[]`, so problem-resolution detection here was identically dead. Mirror
    // system-control's canonical read: trust `conversionChannelAssigned`.
    if (output.conversionChannelAssigned === true) return "resolved";
    if (output.conversionChannelAssigned === false) return "cannot_resolve";
    // Field absent (legacy snapshot): defer to system-control's
    // contract-boundary check rather than fabricating a verdict here.
    return "unaddressed";
  }

  if (problem.type === "market" && engineId === "positioning") {
    const diff = output.differentiationAngle || output.positioningAngle;
    if (diff && output.confidenceScore >= 0.50) return "resolved";
  }

  if (problem.severity === "critical" || problem.severity === "high") {
    const engineConf = output.confidenceScore ?? output.overallIntegrityScore ?? 0;
    if (engineConf >= 0.70) return "deferred";
  }

  return "unaddressed";
}

function enforceProblemsPostEngine(ssc: SharedStrategicContext, engineId: string, stepResult: EngineStepResult, preEngineProblems: ProblemEntry[], pipelineStep: number): void {
  if (preEngineProblems.length === 0) return;
  if (stepResult.status !== "SUCCESS" && stepResult.status !== "PARTIAL") return;
  const output = stepResult.output;

  for (const problem of preEngineProblems) {
    if (problem.status !== "open") continue;

    const resolution = detectProblemResolutionInOutput(engineId, output, problem);

    switch (resolution) {
      case "resolved": {
        const action = `Engine ${engineId} produced output addressing ${problem.type} problem (step ${pipelineStep})`;
        resolveProblem(ssc, problem.id, engineId as EngineIdType, action);
        console.log(`[Orchestrator] SSC_PROBLEM_RESOLVED | id=${problem.id} | by=${engineId} | action=${action}`);
        break;
      }
      case "deferred": {
        const reason = `Engine ${engineId} acknowledged problem but could not fully resolve at step ${pipelineStep}`;
        deferProblem(ssc, problem.id, engineId as EngineIdType, reason);
        console.log(`[Orchestrator] SSC_PROBLEM_DEFERRED | id=${problem.id} | by=${engineId} | reason=${reason}`);
        break;
      }
      case "cannot_resolve": {
        const reason = `Engine ${engineId} output does not structurally address ${problem.type} problem — no change in relevant metrics`;
        markCannotResolve(ssc, problem.id, engineId as EngineIdType, reason);
        console.warn(`[Orchestrator] SSC_PROBLEM_CANNOT_RESOLVE | id=${problem.id} | by=${engineId} | reason=${reason}`);
        break;
      }
      case "unaddressed": {
        const isLastRelevant = problem.relevantEngines[problem.relevantEngines.length - 1] === engineId;
        if (isLastRelevant) {
          markCannotResolve(ssc, problem.id, engineId as EngineIdType,
            `Problem passed through all relevant engines without resolution — last engine was ${engineId}`);
          console.warn(`[Orchestrator] SSC_PROBLEM_EXHAUSTED | id=${problem.id} | lastEngine=${engineId} | severity=${problem.severity} | desc=${problem.description}`);
        } else {
          console.log(`[Orchestrator] SSC_PROBLEM_PASSED_THROUGH | id=${problem.id} | engine=${engineId} | status=unaddressed | remaining=${problem.relevantEngines.filter(e => e !== engineId).join(",")}`);
        }
        break;
      }
    }
  }
}

function logRelevantProblems(ssc: SharedStrategicContext, engineId: string): ProblemEntry[] {
  const relevant = getRelevantProblems(ssc, engineId as EngineIdType);
  if (relevant.length > 0) {
    console.log(`[Orchestrator] SSC_PROBLEMS_FOR_ENGINE | engine=${engineId} | openProblems=${relevant.length} | problems=${relevant.map(p => `${p.id}(${p.severity}:${p.type})`).join(",")}`);
  }
  return relevant;
}

async function executeEngine(
  engineId: EngineId,
  ctx: EngineContext,
  config: OrchestratorConfig,
  results: Map<EngineId, EngineStepResult>,
  jobId: string,
): Promise<EngineStepResult> {
  if (!jobId) {
    throw new Error(`executeEngine called without jobId for ${engineId} — pipeline misconfiguration`);
  }
  const startTime = Date.now();

  const violation = checkPriorityViolation(engineId, results);
  if (violation) {
    return {
      engineId,
      status: "SKIPPED",
      output: null,
      durationMs: Date.now() - startTime,
      blockReason: violation.violation,
    };
  }

  for (const [, result] of results) {
    if (shouldBlockDownstream(result)) {
      return {
        engineId,
        status: "SKIPPED",
        output: null,
        durationMs: Date.now() - startTime,
        blockReason: `Blocked by upstream failure in ${result.engineId}`,
      };
    }
  }

  if (!ctx.depthGateStatus) ctx.depthGateStatus = {};

  const DEPTH_CASCADE_MAP: Record<string, string[]> = {
    mechanism: ["differentiation"],
    offer: ["differentiation", "mechanism"],
    funnel: ["awareness"],
    persuasion: ["awareness"],
  };

  const SIGNAL_CASCADE_MAP: Record<string, string[]> = {
    differentiation: ["positioning"],
    mechanism: ["positioning", "differentiation"],
    offer: ["positioning", "differentiation"],
  };

  const upstreamDeps = DEPTH_CASCADE_MAP[engineId] || [];
  for (const upstream of upstreamDeps) {
    if (ctx.depthGateStatus[upstream] === "DEPTH_FAILED") {
      console.log(`[Orchestrator] DEPTH_CASCADE_BLOCKED | ${engineId} BLOCKED — upstream ${upstream} has DEPTH_FAILED`);
      ctx.depthGateStatus[engineId] = "DEPTH_BLOCKED";
      return {
        engineId,
        status: "DEPTH_BLOCKED",
        output: {
          status: "DEPTH_BLOCKED",
          statusMessage: `Cascade blocked: upstream engine '${upstream}' failed depth gate — ${engineId} cannot execute on invalid foundation`,
          confidenceScore: 0,
          depthGateResult: {
            passed: false,
            blocked: true,
            attempt: 0,
            maxAttempts: 0,
            status: "DEPTH_BLOCKED",
            failureReason: `Upstream '${upstream}' depth gate failed`,
            regenerationLog: [`CASCADE_BLOCKED: ${upstream} → ${engineId}`],
          },
        },
        durationMs: Date.now() - startTime,
        blockReason: `Cascade blocked: upstream '${upstream}' depth gate failed`,
      };
    }
  }

  const signalUpstreamDeps = SIGNAL_CASCADE_MAP[engineId] || [];
  for (const upstream of signalUpstreamDeps) {
    const upstreamStatus = ctx.depthGateStatus[upstream];
    if (upstreamStatus === "SIGNAL_REQUIRED" || upstreamStatus === "SIGNAL_DRIFT" || upstreamStatus === "SIGNAL_GROUNDING_FAILED") {
      console.log(`[Orchestrator] SIGNAL_CASCADE_BLOCKED | ${engineId} BLOCKED — upstream ${upstream} has ${upstreamStatus}`);
      ctx.depthGateStatus[engineId] = "SIGNAL_BLOCKED";
      return {
        engineId,
        status: "SIGNAL_BLOCKED",
        output: {
          status: "SIGNAL_BLOCKED",
          statusMessage: `Signal cascade blocked: positioning engine has ${upstreamStatus} — ${engineId} cannot execute without valid positioning`,
          confidenceScore: 0,
        },
        durationMs: Date.now() - startTime,
        blockReason: `Signal cascade blocked: positioning has ${upstreamStatus}`,
      };
    }
  }

  try {
    let output: any = null;
    let snapshotId: string | undefined;

    switch (engineId) {
      case "market_intelligence": {
        const result = await MarketIntelligenceV3.run(
          "FULL",
          config.accountId,
          config.campaignId,
          config.forceRefresh || false,
          "STRATEGY_MODE",
          jobId,
        );
        output = result;
        snapshotId = result.snapshotId;
        ctx.mi = result;
        ctx.miSnapshotId = result.snapshotId;
        try {
          const [miRow] = await db
            .select({ competitorHash: miSnapshots.competitorHash })
            .from(miSnapshots)
            .where(eq(miSnapshots.id, result.snapshotId))
            .limit(1);
          if (miRow?.competitorHash) {
            ctx.inputHashes!.mi = miRow.competitorHash;
          }
        } catch (miHashErr: any) {
          console.warn(`[Orchestrator] MI_COMPETITOR_HASH_LOAD_FAILED | error=${miHashErr.message}`);
        }
        break;
      }

      case "audience": {
        const audInputHash = computeInputHash("audience-v1", ctx.inputHashes!.mi || "");
        ctx.inputHashes!.audience = audInputHash;
        let result: any = null;
        if (!config.forceRefresh) {
          const reused = await tryReuseAudience(config.accountId, config.campaignId, audInputHash);
          if (reused) {
            logReuseHit("audience", reused.snap.id, audInputHash);
            result = reused.hydrated;
          } else {
            logReuseMiss("audience", audInputHash);
          }
        }
        if (!result) {
          result = await runAudienceEngine(config.accountId, config.campaignId, ctx.miSnapshotId, jobId);
          if (result?.snapshotId) {
            try {
              await db.update(audienceSnapshotsTbl).set({ inputHash: audInputHash }).where(eq(audienceSnapshotsTbl.id, result.snapshotId));
            } catch (e: any) {
              console.warn(`[Orchestrator] AUDIENCE_INPUT_HASH_PERSIST_FAILED | ${e.message}`);
            }
          }
        }
        output = result;
        snapshotId = result.snapshotId;
        // Route through canonicalizeAudienceShape so every consumer sees
        // `audiencePains` as the single source of truth, regardless of which
        // shape the audience engine happened to emit on this run.
        ctx.audience = canonicalizeAudienceShape(result);
        ctx.audienceSnapshotId = result.snapshotId;

        // ── COMMERCIAL SIGNAL EMISSION: buyerPsychology (Phase 4 marketing-logic upgrade) ──
        // Audience runs first in pipeline, so this signal is available to ALL downstream
        // engines (positioning, offer, awareness, persuasion).
        try {
          const bp = (result as any)?.buyerPsychologyProfile;
          if (bp && ctx.ssc) {
            emitCommercialSignal(ctx.ssc, "buyerPsychology", {
              beliefModel: bp.beliefModel,
              topRejectionPatterns: (bp.rejectionHistory || []).slice(0, 3).map((r: any) => r.pattern).filter(Boolean),
              decisionTrigger: bp.decisionTrigger,
              identityAspiration: bp.identityAspiration,
              sophisticationTier: bp.sophisticationByproduct?.tier ?? 3,
              cialdiniLeverages: bp.cialdiniLeverages || [],
              segmentName: (result as any)?.audienceSegments?.[0]?.name || "Primary Segment",
              judgeVerdict: bp.judgeVerdict,
              emittedAt: Date.now(),
            });
          }
        } catch (sscErr: any) {
          console.warn(`[Orchestrator] buyerPsychology SSC emit failed: ${sscErr.message}`);
        }

        if (ctx.mi && ctx.audience) {
          try {
            const aelStart = Date.now();
            // Derive competitive data from MI's runtime shape so AEL sees what's actually present.
            const miAny: any = ctx.mi;
            const competitorIntent = miAny?.output?.competitorIntentMap || [];
            const dominance = Array.isArray(miAny?.dominanceData) ? miAny.dominanceData : [];
            const competitorList = dominance.length > 0
              ? dominance.map((d: any) => ({ id: d.competitorId, name: d.competitorName, weight: d.authorityWeight, lifecycle: d.lifecycle }))
              : competitorIntent.map((c: any) => ({ id: c.competitorId, name: c.competitorName, intent: c.intentCategory }));
            const competitiveData = competitorList.length > 0
              ? { competitors: competitorList, posts: miAny?.competitorPosts || miAny?.posts || [] }
              : null;
            // ProductDNA is loaded by the audience engine and exposed on its result.
            const productDnaFromAudience = (ctx.audience as any)?.productDna || null;
            console.log(`[Orchestrator] AEL_INPUT_PROBE | hasMI=${!!ctx.mi} | hasAudience=${!!ctx.audience} | hasProductDNA=${!!productDnaFromAudience} | competitorListSize=${competitorList.length} | miMarketState=${miAny?.output?.marketState ?? miAny?.marketState ?? "n/a"}`);
            const aelPkg = await buildAnalyticalPackage({
              mi: ctx.mi,
              audience: ctx.audience,
              productDNA: productDnaFromAudience,
              competitiveData,
              accountId: config.accountId,
              campaignId: config.campaignId,
            });
            ctx.analyticalEnrichment = aelPkg;
            if (aelPkg?.isPartial) {
              console.warn(`[Orchestrator] AEL_PARTIAL | reason=${aelPkg.partialReason} — downstream engines will receive degraded enrichment`);
            }
            console.log(`[Orchestrator] AEL_BUILT | duration=${Date.now() - aelStart}ms | dimensions=${aelPkg ? Object.keys(aelPkg).length : 0} | partial=${aelPkg?.isPartial || false} | campaignId=${config.campaignId}`);
          } catch (aelErr: any) {
            // PRE-LAUNCH HARDENING (G.1): AEL is a hard dependency for every
            // downstream engine (Positioning, Mechanism, Differentiation,
            // Offer, Funnel). Previously we logged + nulled, letting downstream
            // generate without enrichment context. We now fail the audience
            // step with a BLOCKED result so the orchestrator halts. The
            // messaging-tier-blocking change in priority-matrix ensures no
            // downstream engine runs.
            console.error(`[Orchestrator] AEL_BUILD_FAILED | error=${aelErr.message} — halting pipeline (no silent degradation)`);
            return {
              step: "audience",
              status: "BLOCKED",
              error: {
                code: "AEL_BUILD_FAILED",
                message: `Analytical Enrichment Layer failed to build — pipeline halted to prevent ungrounded downstream generation. Underlying error: ${aelErr.message}`,
              },
              snapshotId,
              durationMs: Date.now() - startTime,
            } as any;
          }
        }

        if (ctx.audience) {
          try {
            const sglStart = Date.now();
            const rawObjections = ctx.audience.objectionMap || [];
            const mappedObjections = rawObjections.map((o: any) => ({
              label: o.label ?? o.canonical ?? o.pain ?? o.signal ?? "",
              confidence: o.confidence ?? o.confidenceScore ?? 0.5,
              evidence: Array.isArray(o.evidence) ? o.evidence : [],
            }));
            ctx.sglState = initializeSignalGovernance(
              ctx.audience.structuredSignals || { pain_clusters: [], desire_clusters: [], pattern_clusters: [], root_causes: [], psychological_drivers: [] },
              mappedObjections,
            );
            console.log(`[Orchestrator] SGL_INITIALIZED | duration=${Date.now() - sglStart}ms | signals=${ctx.sglState.governedSignals.length} | trace=${ctx.sglState.traceToken}`);
          } catch (sglErr: any) {
            console.warn(`[Orchestrator] SGL_INIT_FAILED | error=${sglErr.message} — proceeding without signal governance`);
            ctx.sglState = undefined;
          }
        }

        if (ctx.ssc && ctx.audience) {
          const pains = ctx.audience.audiencePains || [];
          ctx.ssc.painMap = pains.slice(0, 10).map((p: any) => ({
            canonical: typeof p === "string" ? p : p.pain || p.name || p.label || "",
            sourceSignal: typeof p === "string" ? p : p.evidence || p.signal || "",
            frequency: typeof p === "object" ? (p.frequency ?? p.count ?? 1) : 1,
            severity: typeof p === "object" ? (p.severity ?? p.intensity ?? 0.5) : 0.5,
          }));

          const desires = ctx.audience.desireMap || [];
          ctx.ssc.desireMap = desires.slice(0, 10).map((d: any) => ({
            canonical: typeof d === "string" ? d : d.desire || d.name || d.label || "",
            sourceSignal: typeof d === "string" ? d : d.evidence || d.signal || "",
            intensity: typeof d === "object" ? (d.intensity ?? d.strength ?? 0.5) : 0.5,
          }));

          const objections = ctx.audience.objectionMap || [];
          ctx.ssc.objectionMap = objections.slice(0, 10).map((o: any) => ({
            canonical: typeof o === "string" ? o : o.objection || o.name || o.label || "",
            sourceSignal: typeof o === "string" ? o : o.evidence || o.signal || "",
            severity: typeof o === "object" ? (o.severity ?? o.weight ?? 0.5) : 0.5,
            addressed: false,
          }));

          const awarenessLevel =
            ctx.audience.awarenessLevel ||
            ctx.audience.audienceAwarenessLevel ||
            ctx.audience.awareness?.level ||
            ctx.audience.awarenessStage ||
            null;
          if (awarenessLevel) {
            ctx.ssc.awarenessMeaning = resolveAwarenessMeaning(awarenessLevel);
            console.log(`[Orchestrator] SSC_AWARENESS_SET | stage=${awarenessLevel} | resolved=${ctx.ssc.awarenessMeaning ? "yes" : "no"}`);
          } else {
            console.warn(`[Orchestrator] SSC_AWARENESS_MISSING | audience output did not contain awarenessLevel`);
          }

          console.log(`[Orchestrator] SSC_POPULATED | pains=${ctx.ssc.painMap.length} | desires=${ctx.ssc.desireMap.length} | objections=${ctx.ssc.objectionMap.length}`);
        }
        break;
      }

      case "positioning": {
        if (!ctx.miSnapshotId || !ctx.audienceSnapshotId) {
          return {
            engineId,
            status: "SKIPPED",
            output: null,
            durationMs: Date.now() - startTime,
            blockReason: "Missing MI or Audience snapshot",
          };
        }
        { const sglBlock = resolveSglOrBlock("positioning", ctx, startTime); if (sglBlock) return sglBlock; }
        const posInputHash = computeInputHash(
          "positioning-v1",
          ctx.inputHashes!.mi || "",
          ctx.inputHashes!.audience || "",
          ctx.analyticalEnrichment?.isPartial ? "ael-partial" : "ael-full",
        );
        ctx.inputHashes!.positioning = posInputHash;
        let result: any = null;
        if (!config.forceRefresh) {
          const reused = await tryReusePositioning(config.accountId, config.campaignId, posInputHash);
          if (reused) {
            logReuseHit("positioning", reused.snap.id, posInputHash);
            result = reused.hydrated;
          } else {
            logReuseMiss("positioning", posInputHash);
          }
        }
        if (!result) {
          result = await runPositioningEngine(
            config.accountId,
            config.campaignId,
            ctx.miSnapshotId,
            ctx.audienceSnapshotId,
            ctx.analyticalEnrichment,
            jobId,
          );
          if (result?.snapshotId) {
            try {
              await db.update(positioningSnapshotsTbl).set({ inputHash: posInputHash }).where(eq(positioningSnapshotsTbl.id, result.snapshotId));
            } catch (e: any) {
              console.warn(`[Orchestrator] POSITIONING_INPUT_HASH_PERSIST_FAILED | ${e.message}`);
            }
          }
        }
        output = result;
        snapshotId = result.snapshotId;
        ctx.positioning = result;
        ctx.positioningSnapshotId = result.snapshotId;

        // ── COMMERCIAL SIGNAL EMISSION: gameDimension (Phase 2 marketing-logic upgrade) ──
        // Emit the positioning engine's category-game design so downstream Offer / Awareness / Persuasion
        // engines can ground their decisions in the named strategic dimension.
        try {
          const cgd = (result as any)?.categoryGameDesign;
          if (cgd && ctx.ssc) {
            emitCommercialSignal(ctx.ssc, "gameDimension", {
              buyerActualGame: cgd.buyerActualGame,
              competitorGames: cgd.competitorGames,
              ourDimension: cgd.ourDimension,
              ourGame: cgd.ourGame,
              defensibility: cgd.defensibility,
              defensibilityProof: cgd.defensibilityProof,
              judgeVerdict: cgd.judgeVerdict,
              emittedAt: Date.now(),
            });
          }
        } catch (sigErr: any) {
          console.warn(`[Orchestrator] POSITIONING_SIGNAL_EMIT_FAILED | ${sigErr.message}`);
        }

        if (result.status === "SIGNAL_REQUIRED" || result.status === "SIGNAL_DRIFT") {
          ctx.depthGateStatus!.positioning = result.status;
          console.log(`[Orchestrator] SIGNAL_GATE_STATUS | positioning=${result.status} — downstream engines will be cascade-blocked`);
        } else {
          ctx.depthGateStatus!.positioning = "SIGNAL_PASSED";
        }

        if (ctx.analyticalEnrichment && result.territories) {
          const posTexts = result.territories.map((t: any) => `${t.name} ${t.contrastAxis} ${t.narrativeDirection}`);
          const celResult = enforceGenericEngineCompliance("positioning", posTexts, ctx.analyticalEnrichment);
          if (!ctx.celResults) ctx.celResults = [];
          ctx.celResults.push(celResult);
          if (celResult.violations.length > 0) {
            console.log(`[Orchestrator] CEL_POSITIONING | violations=${celResult.violations.length} | score=${celResult.score.toFixed(2)} | passed=${celResult.passed}`);
          }
        }
        break;
      }

      case "differentiation": {
        { const sglBlock = resolveSglOrBlock("differentiation", ctx, startTime); if (sglBlock) return sglBlock; }
        const diffInputHash = computeInputHash(
          "differentiation-v1",
          ctx.inputHashes!.mi || "",
          ctx.inputHashes!.audience || "",
          ctx.inputHashes!.positioning || "",
          ctx.analyticalEnrichment?.isPartial ? "ael-partial" : "ael-full",
        );
        ctx.inputHashes!.differentiation = diffInputHash;
        let result: any = null;
        let diffReused = false;
        if (!config.forceRefresh) {
          const reused = await tryReuseDifferentiation(config.accountId, config.campaignId, diffInputHash);
          if (reused) {
            logReuseHit("differentiation", reused.snap.id, diffInputHash);
            result = reused.hydrated;
            diffReused = true;
            ctx.differentiation = result;
            ctx.differentiationSnapshotId = reused.snap.id;
            snapshotId = reused.snap.id;
            output = result;
          } else {
            logReuseMiss("differentiation", diffInputHash);
          }
        }
        if (!diffReused) {
        const miInput = extractMiInput(ctx.mi);
        const audInput = extractAudienceInput(ctx.audience);
        const posInput = extractPositioningInput(ctx.positioning);
        result = await runDifferentiationEngine(
          miInput,
          audInput,
          posInput,
          config.accountId,
          undefined,
          ctx.analyticalEnrichment
        );
        output = result;
        ctx.differentiation = result;

        try {
          const [diffSnap] = await db.insert(differentiationSnapshots).values({
            accountId: config.accountId,
            campaignId: config.campaignId,
            jobId,
            miSnapshotId: ctx.miSnapshotId || "N/A",
            audienceSnapshotId: ctx.audienceSnapshotId || "N/A",
            positioningSnapshotId: ctx.positioningSnapshotId || "N/A",
            engineVersion: DIFFERENTIATION_ENGINE_VERSION,
            status: resolveSnapshotWriteStatus(result),
            statusMessage: result.statusMessage || null,
            differentiationPillars: JSON.stringify((result as any).pillars || (result as any).differentiationPillars || []),
            proofArchitecture: JSON.stringify((result as any).proofArchitecture || null),
            claimStructures: JSON.stringify((result as any).claimStructures || (result as any).claims || []),
            authorityMode: JSON.stringify({ mode: (result as any).authorityMode, rationale: (result as any).authorityRationale }),
            mechanismFraming: JSON.stringify((result as any).mechanismFraming || null),
            mechanismCore: JSON.stringify((result as any).mechanismCore || null),
            trustPriorityMap: JSON.stringify((result as any).trustPriorityMap || null),
            claimScores: JSON.stringify((result as any).claimScores || null),
            collisionDiagnostics: JSON.stringify((result as any).collisionDiagnostics || null),
            stabilityResult: JSON.stringify((result as any).stabilityResult || null),
            confidenceScore: (result as any).confidenceScore ?? null,
            executionTimeMs: (result as any).executionTimeMs ?? null,
            inputHash: diffInputHash,
          }).returning({ id: differentiationSnapshots.id });
          (result as any).snapshotId = diffSnap.id;
          ctx.differentiationSnapshotId = diffSnap.id;
          snapshotId = diffSnap.id;
        } catch (e: any) {
          console.error(`[Orchestrator] DIFF_PERSIST_FAILED | job=${jobId} | ${e.message}`);
          ctx.differentiationSnapshotId = result.snapshotId;
          snapshotId = result.snapshotId;
        }
        }  // end if(!diffReused)

        if (!diffReused && ctx.analyticalEnrichment) {
          const diffTexts = (result.claims || result.claimStructures || []).map((c: any) => typeof c === "string" ? c : c.claim || c.title || JSON.stringify(c));
          const celResult = enforceGenericEngineCompliance("differentiation", diffTexts, ctx.analyticalEnrichment);
          if (!ctx.celResults) ctx.celResults = [];
          ctx.celResults.push(celResult);
          if (celResult.violations.length > 0) {
            console.log(`[Orchestrator] CEL_DIFFERENTIATION | violations=${celResult.violations.length} | score=${celResult.score.toFixed(2)}`);
          }
        }
        if (result.celDepthCompliance) {
          if (!ctx.celResults) ctx.celResults = [];
          ctx.celResults.push(result.celDepthCompliance);
          console.log(`[Orchestrator] CEL_DIFFERENTIATION_DEPTH | depthScore=${result.celDepthCompliance.causalDepthScore} | violations=${result.celDepthCompliance.violations.length}`);
        }
        if (result.status === "DEPTH_FAILED") {
          ctx.depthGateStatus!.differentiation = "DEPTH_FAILED";
          console.log(`[Orchestrator] DEPTH_GATE_STATUS | differentiation=DEPTH_FAILED`);
        } else if (result.status === "SIGNAL_GROUNDING_FAILED") {
          ctx.depthGateStatus!.differentiation = "SIGNAL_GROUNDING_FAILED";
          console.log(`[Orchestrator] SIGNAL_GROUNDING_STATUS | differentiation=SIGNAL_GROUNDING_FAILED — downstream engines will be cascade-blocked`);
        } else {
          ctx.depthGateStatus!.differentiation = "DEPTH_PASSED";
        }
        if (result.depthGateResult) {
          console.log(`[Orchestrator] DEPTH_GATE_DIFF | status=${result.depthGateResult.status} | attempts=${result.depthGateResult.attempt}/${result.depthGateResult.maxAttempts}`);
        }
        break;
      }

      case "mechanism": {
        { const sglBlock = resolveSglOrBlock("mechanism", ctx, startTime); if (sglBlock) return sglBlock; }
        const mechInputHash = computeInputHash(
          "mechanism-v1",
          ctx.inputHashes!.positioning || "",
          ctx.inputHashes!.differentiation || "",
          ctx.analyticalEnrichment?.isPartial ? "ael-partial" : "ael-full",
        );
        ctx.inputHashes!.mechanism = mechInputHash;
        let mechReused = false;
        if (!config.forceRefresh) {
          const reused = await tryReuseMechanism(config.accountId, config.campaignId, mechInputHash);
          if (reused) {
            logReuseHit("mechanism", reused.snap.id, mechInputHash);
            output = reused.hydrated;
            ctx.mechanism = reused.hydrated;
            ctx.mechanismSnapshotId = reused.snap.id;
            snapshotId = reused.snap.id;
            ctx.depthGateStatus!.mechanism = "DEPTH_PASSED";
            mechReused = true;
          } else {
            logReuseMiss("mechanism", mechInputHash);
          }
        }
        if (!mechReused) {
        const posInput = extractPositioningInput(ctx.positioning);
        const diffInput = extractDifferentiationInput(ctx.differentiation);
        const domainVocabParts = [
          ...(posInput.domainFailures || []),
          ...(posInput.operationalProblems || []),
        ].join(" ");
        const positioningForMech = {
          contrastAxis: ctx.positioning?.contrastAxis || posInput.narrative || null,
          enemyDefinition: ctx.positioning?.enemyDefinition || null,
          narrativeDirection: ctx.positioning?.narrativeDirection || posInput.narrativeDirection || null,
          differentiationVector: posInput.differentiationVector || [],
          territories: posInput.territories || [],
          domainVocab: domainVocabParts || undefined,
          // T002 v2: confidence flows downstream — mechanism inherits ceiling
          confidenceScore: typeof ctx.positioning?.confidenceScore === "number" ? ctx.positioning.confidenceScore : null,
        };
        const diffForMech = {
          pillars: diffInput.claims || [],
          mechanismFraming: ctx.differentiation?.mechanismFraming || null,
          mechanismCore: ctx.differentiation?.mechanismCore || null,
          authorityMode: ctx.differentiation?.authorityMode || null,
          claimStructures: ctx.differentiation?.claimStructures || [],
          proofArchitecture: ctx.differentiation?.proofArchitecture || [],
          // T002 v2: confidence flows downstream
          confidenceScore: typeof ctx.differentiation?.confidenceScore === "number" ? ctx.differentiation.confidenceScore : null,
        };
        const result = await runMechanismEngine(positioningForMech, diffForMech, config.accountId, ctx.analyticalEnrichment);
        output = result;
        ctx.mechanism = result;

        try {
          const [mechSnapshot] = await db.insert(mechanismSnapshots).values({
            accountId: config.accountId,
            campaignId: config.campaignId,
            jobId,
            positioningSnapshotId: ctx.positioningSnapshotId || "N/A",
            differentiationSnapshotId: ctx.differentiationSnapshotId || "N/A",
            engineVersion: result.engineVersion || 1,
            status: resolveSnapshotWriteStatus(result),
            statusMessage: result.statusMessage || null,
            primaryMechanism: result.primaryMechanism ? JSON.stringify(result.primaryMechanism) : null,
            alternativeMechanism: result.alternativeMechanism ? JSON.stringify(result.alternativeMechanism) : null,
            axisConsistency: result.axisConsistency ? JSON.stringify(result.axisConsistency) : null,
            confidenceScore: result.confidenceScore || null,
            executionTimeMs: result.executionTimeMs || null,
            inputHash: mechInputHash,
          }).returning();
          snapshotId = mechSnapshot.id;
          ctx.mechanismSnapshotId = mechSnapshot.id;
          console.log(`[Orchestrator] MECH_SNAPSHOT_SAVED | id=${mechSnapshot.id}`);
        } catch (mechDbErr: any) {
          console.warn(`[Orchestrator] MECH_SNAPSHOT_SAVE_FAILED | error=${mechDbErr.message}`);
        }
        }  // end if(!mechReused)

        const result: any = ctx.mechanism;
        if (!mechReused && result?.celDepthCompliance) {
          if (!ctx.celResults) ctx.celResults = [];
          ctx.celResults.push(result.celDepthCompliance);
          if (result.celDepthCompliance.violations.length > 0) {
            console.log(`[Orchestrator] CEL_MECHANISM_DEPTH | violations=${result.celDepthCompliance.violations.length} | score=${result.celDepthCompliance.score.toFixed(2)} | depthScore=${result.celDepthCompliance.causalDepthScore}`);
          }
        }
        if (result.status === "DEPTH_FAILED") {
          ctx.depthGateStatus!.mechanism = "DEPTH_FAILED";
          console.log(`[Orchestrator] DEPTH_GATE_STATUS | mechanism=DEPTH_FAILED`);
        } else {
          ctx.depthGateStatus!.mechanism = "DEPTH_PASSED";
        }
        if (result.depthGateResult) {
          console.log(`[Orchestrator] DEPTH_GATE_MECH | status=${result.depthGateResult.status} | attempts=${result.depthGateResult.attempt}/${result.depthGateResult.maxAttempts}`);
        }

        // CONTRACT CONSISTENCY: orchestrator MUST build the Strategy Root after
        // mechanism completes — same contract as /api/mechanism-engine/analyze.
        // Without this, getActiveRoot() returns null at the offer step and the
        // pipeline blocks with NO_ACTIVE_STRATEGY_ROOT.
        if (result.status !== "DEPTH_FAILED" && ctx.mechanismSnapshotId) {
          try {
            // Use the same shared assembler the standalone mechanism-engine
            // route uses, so both writers produce structurally identical
            // StrategyRootInput objects. The assembler hydrates pains from
            // the audience snapshot when ctx.audience is missing/empty.
            const positioningSnapshotForAssembler = {
              territories: ctx.positioning?.territories || [],
              enemyDefinition: ctx.positioning?.enemyDefinition || null,
              contrastAxis: ctx.positioning?.contrastAxis || null,
              narrativeDirection: ctx.positioning?.narrativeDirection || null,
            };
            const differentiationContext = {
              claimStructures: ctx.differentiation?.claimStructures || [],
              proofArchitecture: ctx.differentiation?.proofArchitecture || [],
            };

            const rootInput = await assembleStrategyRootInput({
              campaignId: config.campaignId,
              accountId: config.accountId,
              miSnapshotId: ctx.miSnapshotId || "",
              audienceSnapshotId: ctx.audienceSnapshotId || "",
              positioningSnapshotId: ctx.positioningSnapshotId || "",
              differentiationSnapshotId: ctx.differentiationSnapshotId || "",
              mechanismSnapshotId: ctx.mechanismSnapshotId,
              mechanismResult: result,
              positioningSnapshot: positioningSnapshotForAssembler,
              differentiationContext,
              audienceOverride: ctx.audience,
            });

            console.log(`[Orchestrator] STRATEGY_ROOT_CLAIMS | claimsCount=${(rootInput.approvedClaims as any[])?.length || 0} | topClaim="${String(rootInput.approvedClaim || "").substring(0, 80)}" | painsCount=${(rootInput.approvedAudiencePains as any[])?.length || 0}`);

            const rootResult = await buildStrategyRoot(rootInput);
            ctx.strategyRootId = rootResult.id;
            console.log(`[Orchestrator] STRATEGY_ROOT_BUILT | id=${rootResult.id} | hash=${rootResult.rootHash} | runId=${rootResult.runId} | isNew=${rootResult.isNew}`);
          } catch (rootErr: any) {
            if (rootErr instanceof StrategyRootIncompleteError) {
              console.error(`[Orchestrator] STRATEGY_ROOT_REJECTED | missing=${rootErr.missingFields.join(",")} | mech=${ctx.mechanismSnapshotId} | aud=${ctx.audienceSnapshotId}`);
              return {
                step: "mechanism",
                status: "BLOCKED",
                error: {
                  code: "STRATEGY_ROOT_INCOMPLETE",
                  message: `Strategy root build rejected — missing fields: ${rootErr.missingFields.join(", ")}`,
                  missingFields: rootErr.missingFields,
                },
                snapshotId,
                durationMs: Date.now() - startTime,
              } as any;
            }
            console.error(`[Orchestrator] STRATEGY_ROOT_BUILD_FAILED | ${rootErr.message}`);
            return {
              step: "mechanism",
              status: "BLOCKED",
              error: {
                code: "STRATEGY_ROOT_BUILD_FAILED",
                message: rootErr.message,
              },
              snapshotId,
              durationMs: Date.now() - startTime,
            } as any;
          }
        }
        break;
      }

      case "offer": {
        { const sglBlock = resolveSglOrBlock("offer", ctx, startTime); if (sglBlock) return sglBlock; }
        const offerInputHash = computeInputHash(
          "offer-v1",
          ctx.inputHashes!.mi || "",
          ctx.inputHashes!.audience || "",
          ctx.inputHashes!.positioning || "",
          ctx.inputHashes!.differentiation || "",
          ctx.inputHashes!.mechanism || "",
        );
        ctx.inputHashes!.offer = offerInputHash;
        if (!config.forceRefresh) {
          const reused = await tryReuseOffer(config.accountId, config.campaignId, offerInputHash);
          if (reused) {
            logReuseHit("offer", reused.snap.id, offerInputHash);
            output = reused.hydrated;
            ctx.offer = reused.hydrated;
            snapshotId = reused.snap.id;
            ctx.depthGateStatus!.offer = "DEPTH_PASSED";
            break;
          }
          logReuseMiss("offer", offerInputHash);
        }
        const miInput = extractMiInput(ctx.mi);
        const audInput = extractAudienceInput(ctx.audience);
        const posInput = extractPositioningInput(ctx.positioning);
        const diffInput = extractDifferentiationInput(ctx.differentiation);
        const upstreamLineage = buildUpstreamLineage(ctx);

        // CONTRACT CONSISTENCY: orchestrator MUST pass strategyRoot so the
        // engine takes the deterministic-skeleton path with advisory validators
        // (same contract as /api/offer-engine/analyze). Passing undefined
        // forces free_generation + strict lexical validators which produces
        // false POSITIONING_MISMATCH on otherwise-strong upstream layers.
        const activeRoot = await getActiveRoot(config.campaignId, config.accountId);
        if (!activeRoot) {
          console.log(`[Orchestrator] OFFER_ROOT_MISSING | campaign=${config.campaignId} | no active strategy root — offer cannot run`);
          return {
            engineId,
            status: "BLOCKED",
            output: null,
            durationMs: Date.now() - startTime,
            blockReason: "NO_ACTIVE_STRATEGY_ROOT — pipeline must produce a complete Strategy Root (Mechanism Engine output) before Offer can run.",
          };
        }
        console.log(`[Orchestrator] OFFER_ROOT_BOUND | rootId=${activeRoot.id} | hash=${activeRoot.rootHash} | runId=${activeRoot.runId}`);

        const result = await runOfferEngine(
          miInput, audInput, posInput, diffInput,
          config.accountId, upstreamLineage,
          ctx.mechanism || undefined,
          activeRoot,
          ctx.analyticalEnrichment,
          ctx.ssc?.commercialSignals || null,
        );
        output = result;
        ctx.offer = result;

        // ── COMMERCIAL SIGNAL EMISSION: valueArchitecture (Phase 3 marketing-logic upgrade) ──
        // Emit so downstream (awareness, persuasion) can extend the wedge / leverage point.
        try {
          const va = (result as any)?.primaryOffer?.valueArchitecture;
          if (va && ctx.ssc) {
            emitCommercialSignal(ctx.ssc, "valueArchitecture", {
              primaryValueWedge: va.primaryValueWedge,
              identityShift: va.identityShift,
              commercialLeverage: va.commercialLeverage,
              topObjectionEconomics: (va.objectionEconomics || []).slice(0, 3),
              groundedInTrustMechanism: va.groundedInTrustMechanism,
              groundedInGameDimension: va.groundedInGameDimension,
              judgeVerdict: va.judgeVerdict,
              emittedAt: Date.now(),
            });
          }
        } catch (sscErr: any) {
          console.warn(`[Orchestrator] valueArchitecture SSC emit failed: ${sscErr.message}`);
        }

        try {
          const [offerSnap] = await db.insert(offerSnapshots).values({
            accountId: config.accountId,
            campaignId: config.campaignId,
            jobId,
            miSnapshotId: ctx.miSnapshotId || "N/A",
            audienceSnapshotId: ctx.audienceSnapshotId || "N/A",
            positioningSnapshotId: ctx.positioningSnapshotId || "N/A",
            differentiationSnapshotId: ctx.differentiationSnapshotId || "N/A",
            mechanismSnapshotId: (ctx.mechanism as any)?.snapshotId || null,
            strategyRootId: activeRoot.id,
            engineVersion: OFFER_ENGINE_VERSION,
            status: resolveSnapshotWriteStatus(result),
            statusMessage: result.statusMessage || null,
            primaryOffer: JSON.stringify((result as any).primaryOffer || result),
            alternativeOffer: JSON.stringify((result as any).alternativeOffer || null),
            rejectedOffer: JSON.stringify((result as any).rejectedOffer || null),
            offerStrengthScore: (result as any).offerStrengthScore ?? null,
            positioningConsistency: JSON.stringify((result as any).positioningConsistency || null),
            hookMechanismAlignment: JSON.stringify((result as any).hookMechanismAlignment || null),
            boundaryCheck: JSON.stringify((result as any).boundaryCheck || null),
            confidenceScore: (result as any).confidenceScore ?? null,
            structuralWarnings: JSON.stringify((result as any).structuralWarnings || []),
            executionTimeMs: (result as any).executionTimeMs ?? null,
            inputHash: offerInputHash,
          }).returning({ id: offerSnapshots.id });
          (result as any).snapshotId = offerSnap.id;
          snapshotId = offerSnap.id;
        } catch (e: any) {
          console.error(`[Orchestrator] OFFER_PERSIST_FAILED | job=${jobId} | ${e.message}`);
          snapshotId = result.snapshotId;
        }

        if (ctx.analyticalEnrichment) {
          const offerTexts = [result.offerName, result.coreOutcome, result.mechanismDescription, result.headline].filter(Boolean);
          const celResult = enforceGenericEngineCompliance("offer", offerTexts, ctx.analyticalEnrichment);
          if (!ctx.celResults) ctx.celResults = [];
          ctx.celResults.push(celResult);
          if (celResult.violations.length > 0) {
            console.log(`[Orchestrator] CEL_OFFER | violations=${celResult.violations.length} | score=${celResult.score.toFixed(2)}`);
          }
        }
        if (result.celDepthCompliance) {
          if (!ctx.celResults) ctx.celResults = [];
          ctx.celResults.push(result.celDepthCompliance);
          console.log(`[Orchestrator] CEL_OFFER_DEPTH | depthScore=${result.celDepthCompliance.causalDepthScore} | violations=${result.celDepthCompliance.violations.length}`);
        }
        if (result.status === "DEPTH_FAILED") {
          ctx.depthGateStatus!.offer = "DEPTH_FAILED";
          console.log(`[Orchestrator] DEPTH_GATE_STATUS | offer=DEPTH_FAILED`);
        } else {
          ctx.depthGateStatus!.offer = "DEPTH_PASSED";
        }
        if (result.depthGateResult) {
          console.log(`[Orchestrator] DEPTH_GATE_OFFER | status=${result.depthGateResult.status} | attempts=${result.depthGateResult.attempt}/${result.depthGateResult.maxAttempts}`);
        }
        break;
      }

      case "awareness": {
        { const sglBlock = resolveSglOrBlock("awareness", ctx, startTime); if (sglBlock) return sglBlock; }
        const awarenessInputHash = computeInputHash(
          "awareness-v1",
          ctx.inputHashes!.audience || "",
          ctx.inputHashes!.positioning || "",
          ctx.inputHashes!.differentiation || "",
          ctx.inputHashes!.mechanism || "",
          ctx.inputHashes!.offer || "",
        );
        ctx.inputHashes!.awareness = awarenessInputHash;
        if (!config.forceRefresh) {
          const reused = await tryReuseAwareness(config.accountId, config.campaignId, awarenessInputHash);
          if (reused) {
            logReuseHit("awareness", reused.snap.id, awarenessInputHash);
            output = reused.hydrated;
            ctx.awareness = reused.hydrated;
            snapshotId = reused.snap.id;
            ctx.depthGateStatus!.awareness = "DEPTH_PASSED";
            break;
          }
          logReuseMiss("awareness", awarenessInputHash);
        }
        const miInput = extractMiInput(ctx.mi);
        const audInput = extractAudienceInput(ctx.audience);
        const posInput = extractPositioningInput(ctx.positioning);
        const diffInput = extractDifferentiationInput(ctx.differentiation);
        const offerInput = extractOfferInput(ctx.offer);
        const upstreamLineage = buildUpstreamLineage(ctx);
        const result = await runAwarenessEngine(
          miInput, audInput, posInput, diffInput, offerInput,
          config.accountId, upstreamLineage,
          undefined,
          ctx.analyticalEnrichment,
          ctx.ssc?.commercialSignals || null,
        );
        output = result;
        ctx.awareness = result;

        // ── COMMERCIAL SIGNAL EMISSION: narrativeReframe (Phase 5 marketing-logic upgrade) ──
        try {
          const nr = (result as any)?.primaryRoute?.narrativeReframe;
          if (nr && ctx.ssc) {
            const sigs = ctx.ssc.commercialSignals;
            emitCommercialSignal(ctx.ssc, "narrativeReframe", {
              currentModelStatement: nr.currentModel?.statement || "",
              newModelReclassification: nr.newModel?.reclassification || "",
              namedPrinciple: nr.newModel?.namedPrinciple || "",
              bridgeMovement: nr.bridgeMechanism?.movement || "first_principle",
              specificMove: nr.bridgeMechanism?.specificMove || "",
              discomfortCost: {
                privateAdmission: nr.discomfortCost?.privateAdmission || "",
                statusGivenUp: nr.discomfortCost?.statusGivenUp || "",
              },
              groundedInBuyerBeliefModel: !!sigs?.buyerPsychology,
              groundedInTrustMechanism: !!sigs?.trustMechanism,
              groundedInGameDimension: !!sigs?.gameDimension,
              judgeVerdict: nr.judgeVerdict,
              emittedAt: Date.now(),
            });
          }
        } catch (sscErr: any) {
          console.warn(`[Orchestrator] narrativeReframe SSC emit failed: ${sscErr.message}`);
        }

        try {
          const [awSnap] = await db.insert(awarenessSnapshots).values({
            accountId: config.accountId,
            campaignId: config.campaignId,
            jobId,
            offerSnapshotId: (ctx.offer as any)?.snapshotId || "N/A",
            miSnapshotId: ctx.miSnapshotId || "N/A",
            audienceSnapshotId: ctx.audienceSnapshotId || "N/A",
            positioningSnapshotId: ctx.positioningSnapshotId || "N/A",
            differentiationSnapshotId: ctx.differentiationSnapshotId || "N/A",
            engineVersion: AWARENESS_ENGINE_VERSION,
            status: resolveSnapshotWriteStatus(result),
            statusMessage: result.statusMessage || null,
            primaryRoute: JSON.stringify((result as any).primaryRoute || null),
            alternativeRoute: JSON.stringify((result as any).alternativeRoute || null),
            rejectedRoute: JSON.stringify((result as any).rejectedRoute || null),
            layerResults: JSON.stringify((result as any).layerResults || null),
            structuralWarnings: JSON.stringify((result as any).structuralWarnings || []),
            boundaryCheck: JSON.stringify((result as any).boundaryCheck || null),
            dataReliability: JSON.stringify((result as any).dataReliability || null),
            confidenceNormalized: !!(result as any).confidenceNormalized,
            awarenessStrengthScore: (result as any).primaryRoute?.awarenessStrengthScore ?? null,
            executionTimeMs: (result as any).executionTimeMs ?? null,
            inputHash: awarenessInputHash,
          }).returning({ id: awarenessSnapshots.id });
          (result as any).snapshotId = awSnap.id;
          snapshotId = awSnap.id;
        } catch (e: any) {
          console.error(`[Orchestrator] AWARENESS_PERSIST_FAILED | job=${jobId} | ${e.message}`);
          snapshotId = result.snapshotId;
        }

        if (result.celDepthCompliance) {
          if (!ctx.celResults) ctx.celResults = [];
          ctx.celResults.push(result.celDepthCompliance);
          console.log(`[Orchestrator] CEL_AWARENESS_DEPTH | depthScore=${result.celDepthCompliance.causalDepthScore} | violations=${result.celDepthCompliance.violations.length}`);
        }
        if (result.status === "DEPTH_FAILED") {
          ctx.depthGateStatus!.awareness = "DEPTH_FAILED";
          console.log(`[Orchestrator] DEPTH_GATE_STATUS | awareness=DEPTH_FAILED`);
        } else {
          ctx.depthGateStatus!.awareness = "DEPTH_PASSED";
        }
        if (result.depthGateResult) {
          console.log(`[Orchestrator] DEPTH_GATE_AWARENESS | status=${result.depthGateResult.status} | attempts=${result.depthGateResult.attempt}/${result.depthGateResult.maxAttempts}`);
        }
        break;
      }

      case "funnel": {
        { const sglBlock = resolveSglOrBlock("funnel", ctx, startTime); if (sglBlock) return sglBlock; }
        if (!ctx.awareness || !ctx.awareness.primaryRoute) {
          console.log(`[Orchestrator] AWARENESS_GATE_BLOCKED | Funnel cannot execute without completed Awareness — awareness output missing or incomplete`);
          output = { status: "MISSING_DEPENDENCY", statusMessage: "Funnel requires completed Awareness output — awareness gate active" };
          break;
        }
        const funnelInputHash = computeInputHash(
          "funnel-v1",
          ctx.inputHashes!.offer || "",
          ctx.inputHashes!.awareness || "",
          ctx.inputHashes!.mi || "",
          ctx.inputHashes!.audience || "",
          ctx.inputHashes!.positioning || "",
          ctx.inputHashes!.differentiation || "",
        );
        ctx.inputHashes!.funnel = funnelInputHash;
        if (!config.forceRefresh) {
          const reused = await tryReuseFunnel(config.accountId, config.campaignId, funnelInputHash);
          if (reused) {
            logReuseHit("funnel", reused.snap.id, funnelInputHash);
            output = reused.hydrated;
            ctx.funnel = reused.hydrated;
            snapshotId = reused.snap.id;
            ctx.depthGateStatus!.funnel = "DEPTH_PASSED";
            break;
          }
          logReuseMiss("funnel", funnelInputHash);
        }
        const miInput = extractMiInput(ctx.mi);
        const audInput = extractAudienceInput(ctx.audience);
        const offerInput = extractOfferInput(ctx.offer);
        const posInput = extractPositioningInput(ctx.positioning);
        const diffInput = extractDifferentiationInput(ctx.differentiation);
        let funnelAwarenessStage = ctx.awareness.primaryRoute?.targetReadinessStage || "problem_aware";
        if (ctx.ssc?.awarenessMeaning) {
          const canonicalStage = ctx.ssc.awarenessMeaning.stage;
          if (funnelAwarenessStage !== canonicalStage) {
            console.log(`[Orchestrator] SSC_AWARENESS_OVERRIDE | funnel | was=${funnelAwarenessStage} | canonical=${canonicalStage}`);
            funnelAwarenessStage = canonicalStage;
          }
        }
        const awarenessInput = ctx.awareness ? {
          awarenessStage: funnelAwarenessStage,
          entryMechanism: ctx.awareness.primaryRoute?.entryMechanismType || "unknown",
          triggerClass: ctx.awareness.primaryRoute?.triggerClass || "unknown",
          trustState: ctx.awareness.primaryRoute?.trustRequirement || "moderate",
          awarenessRoute: ctx.awareness.primaryRoute?.routeName || "default",
          awarenessStrengthScore: ctx.awareness.primaryRoute?.awarenessStrengthScore || 0,
          _canonicalAwareness: ctx.ssc?.awarenessMeaning || undefined,
        } : null;
        const __funnelStart = Date.now();
        const result = await runFunnelEngine(
          miInput, audInput, offerInput, posInput, diffInput,
          config.accountId, awarenessInput,
          ctx.analyticalEnrichment
        );
        output = result;
        ctx.funnel = result;

        try {
          const [fnSnap] = await db.insert(funnelSnapshots).values({
            accountId: config.accountId,
            campaignId: config.campaignId,
            jobId,
            offerSnapshotId: (ctx.offer as any)?.snapshotId || "N/A",
            awarenessSnapshotId: (ctx.awareness as any)?.snapshotId || null,
            miSnapshotId: ctx.miSnapshotId || "N/A",
            audienceSnapshotId: ctx.audienceSnapshotId || "N/A",
            positioningSnapshotId: ctx.positioningSnapshotId || "N/A",
            differentiationSnapshotId: ctx.differentiationSnapshotId || "N/A",
            engineVersion: FUNNEL_ENGINE_VERSION,
            status: resolveSnapshotWriteStatus(result),
            statusMessage: result.statusMessage || null,
            primaryFunnel: JSON.stringify((result as any).primaryFunnel || result),
            alternativeFunnel: JSON.stringify((result as any).alternativeFunnel || null),
            rejectedFunnel: JSON.stringify((result as any).rejectedFunnel || null),
            funnelStrengthScore: (result as any).funnelStrengthScore ?? null,
            trustPathAnalysis: JSON.stringify((result as any).trustPathAnalysis || null),
            proofPlacementLogic: JSON.stringify((result as any).proofPlacementLogic || null),
            frictionMap: JSON.stringify((result as any).frictionMap || null),
            boundaryCheck: JSON.stringify((result as any).boundaryCheck || null),
            confidenceScore: (result as any).confidenceScore ?? null,
            executionTimeMs: (result as any).executionTimeMs ?? (Date.now() - __funnelStart),
            inputHash: funnelInputHash,
          }).returning({ id: funnelSnapshots.id });
          (result as any).snapshotId = fnSnap.id;
          snapshotId = fnSnap.id;
        } catch (e: any) {
          console.error(`[Orchestrator] FUNNEL_PERSIST_FAILED | job=${jobId} | ${e.message}`);
          snapshotId = result.snapshotId;
        }

        if (ctx.analyticalEnrichment) {
          const funnelTexts = (result.stages || []).map((s: any) => `${s.name || ""} ${s.objective || ""} ${s.contentStrategy || ""}`);
          const celResult = enforceGenericEngineCompliance("funnel", funnelTexts, ctx.analyticalEnrichment);
          if (!ctx.celResults) ctx.celResults = [];
          ctx.celResults.push(celResult);
          if (celResult.violations.length > 0) {
            console.log(`[Orchestrator] CEL_FUNNEL | violations=${celResult.violations.length} | score=${celResult.score.toFixed(2)}`);
          }
        }
        if (result.celDepthCompliance) {
          if (!ctx.celResults) ctx.celResults = [];
          ctx.celResults.push(result.celDepthCompliance);
          console.log(`[Orchestrator] CEL_FUNNEL_DEPTH | depthScore=${result.celDepthCompliance.causalDepthScore} | violations=${result.celDepthCompliance.violations.length}`);
        }
        if (result.status === "DEPTH_FAILED") {
          ctx.depthGateStatus!.funnel = "DEPTH_FAILED";
          console.log(`[Orchestrator] DEPTH_GATE_STATUS | funnel=DEPTH_FAILED`);
        } else {
          ctx.depthGateStatus!.funnel = "DEPTH_PASSED";
        }
        if (result.depthGateResult) {
          console.log(`[Orchestrator] DEPTH_GATE_FUNNEL | status=${result.depthGateResult.status} | attempts=${result.depthGateResult.attempt}/${result.depthGateResult.maxAttempts}`);
        }
        break;
      }

      case "integrity": {
        const integrityInputHash = computeInputHash(
          "integrity-v1",
          ctx.inputHashes!.mi || "",
          ctx.inputHashes!.audience || "",
          ctx.inputHashes!.positioning || "",
          ctx.inputHashes!.differentiation || "",
          ctx.inputHashes!.offer || "",
          ctx.inputHashes!.funnel || "",
        );
        ctx.inputHashes!.integrity = integrityInputHash;
        if (!config.forceRefresh) {
          const reused = await tryReuseIntegrity(config.accountId, config.campaignId, integrityInputHash);
          if (reused) {
            logReuseHit("integrity", reused.snap.id, integrityInputHash);
            output = reused.hydrated;
            ctx.integrity = reused.hydrated;
            ctx.integritySnapshotId = reused.snap.id;
            snapshotId = reused.snap.id;
            break;
          }
          logReuseMiss("integrity", integrityInputHash);
        }
        const miInput = extractMiInput(ctx.mi);
        const audInput = extractAudienceInput(ctx.audience);
        const posInput = extractPositioningInput(ctx.positioning);
        const diffInput = extractDifferentiationInput(ctx.differentiation);
        const offerInput = extractOfferInput(ctx.offer);
        const funnelInput = extractFunnelInput(ctx.funnel);
        const result = runIntegrityEngine(
          miInput, audInput, posInput, diffInput, offerInput, funnelInput
        );
        output = result;
        ctx.integrity = result;

        try {
          const [intSnap] = await db.insert(integritySnapshots).values({
            accountId: config.accountId,
            campaignId: config.campaignId,
            jobId,
            funnelSnapshotId: ctx.funnel?.snapshotId || "N/A",
            offerSnapshotId: ctx.offer?.snapshotId || "N/A",
            miSnapshotId: ctx.miSnapshotId || "N/A",
            audienceSnapshotId: ctx.audienceSnapshotId || "N/A",
            positioningSnapshotId: ctx.positioningSnapshotId || "N/A",
            differentiationSnapshotId: ctx.differentiationSnapshotId || "N/A",
            engineVersion: result.engineVersion || 1,
            status: resolveSnapshotWriteStatus(result),
            statusMessage: result.statusMessage || null,
            overallIntegrityScore: result.overallIntegrityScore || null,
            safeToExecute: result.safeToExecute || false,
            layerResults: result.layerResults ? JSON.stringify(result.layerResults) : null,
            structuralWarnings: result.structuralWarnings ? JSON.stringify(result.structuralWarnings) : null,
            flaggedInconsistencies: result.flaggedInconsistencies ? JSON.stringify(result.flaggedInconsistencies) : null,
            boundaryCheck: result.boundaryCheck ? JSON.stringify(result.boundaryCheck) : null,
            executionTimeMs: result.executionTimeMs || null,
            inputHash: integrityInputHash,
          }).returning();
          snapshotId = intSnap.id;
          ctx.integritySnapshotId = intSnap.id;
          console.log(`[Orchestrator] INTEGRITY_SNAPSHOT_SAVED | id=${intSnap.id}`);
        } catch (intDbErr: any) {
          console.warn(`[Orchestrator] INTEGRITY_SNAPSHOT_SAVE_FAILED | error=${intDbErr.message}`);
        }
        break;
      }

      case "persuasion": {
        { const sglBlock = resolveSglOrBlock("persuasion", ctx, startTime); if (sglBlock) return sglBlock; }
        const persuasionInputHash = computeInputHash(
          "persuasion-v1",
          ctx.inputHashes!.awareness || "",
          ctx.inputHashes!.integrity || "",
          ctx.inputHashes!.funnel || "",
          ctx.inputHashes!.offer || "",
          ctx.inputHashes!.mi || "",
          ctx.inputHashes!.audience || "",
          ctx.inputHashes!.positioning || "",
          ctx.inputHashes!.differentiation || "",
        );
        ctx.inputHashes!.persuasion = persuasionInputHash;
        if (!config.forceRefresh) {
          const reused = await tryReusePersuasion(config.accountId, config.campaignId, persuasionInputHash);
          if (reused) {
            logReuseHit("persuasion", reused.snap.id, persuasionInputHash);
            output = reused.hydrated;
            ctx.persuasion = reused.hydrated;
            snapshotId = reused.snap.id;
            break;
          }
          logReuseMiss("persuasion", persuasionInputHash);
        }
        const miInput = extractMiInput(ctx.mi);
        const audInput = extractAudienceInput(ctx.audience);
        const posInput = extractPositioningInput(ctx.positioning);
        const diffInput = extractDifferentiationInput(ctx.differentiation);
        const offerInput = extractOfferInput(ctx.offer);
        const funnelInput = extractFunnelInput(ctx.funnel);
        const integrityInput = ctx.integrity || {};
        const awarenessInput = ctx.awareness || {};
        if (ctx.ssc?.awarenessMeaning && awarenessInput.primaryRoute) {
          const canonicalStage = ctx.ssc.awarenessMeaning.stage;
          const currentStage = awarenessInput.primaryRoute.targetReadinessStage;
          if (currentStage !== canonicalStage) {
            console.log(`[Orchestrator] SSC_AWARENESS_OVERRIDE | persuasion | was=${currentStage} | canonical=${canonicalStage}`);
            awarenessInput.primaryRoute.targetReadinessStage = canonicalStage;
          }
          awarenessInput._canonicalAwareness = ctx.ssc.awarenessMeaning;
        }
        const persuasionLineage = buildUpstreamLineage(ctx);
        const __persStart = Date.now();
        const result = await runPersuasionEngine(
          miInput, audInput, posInput, diffInput, offerInput, funnelInput, integrityInput, awarenessInput,
          config.accountId, persuasionLineage,
          ctx.analyticalEnrichment
        );
        output = result;
        ctx.persuasion = result;

        // ── COMMERCIAL SIGNAL EMISSION: trustMechanism (Phase 1 marketing-logic upgrade) ──
        // Emit the persuasion engine's trust-transfer design as a commercial signal
        // for downstream consumers (content/funnel/channel engines + validation harness).
        try {
          const ttd = (result as any)?.primaryRoute?.trustTransferDesign;
          if (ttd && ctx.ssc) {
            emitCommercialSignal(ctx.ssc, "trustMechanism", {
              buyerRiskState: ttd.buyerRiskState,
              riskSeverity: ttd.riskSeverity,
              trustDeficit: ttd.trustDeficit,
              transferMechanism: ttd.transferMechanism?.name || "",
              proofArtifact: ttd.transferMechanism?.proofArtifact || "",
              commercialFunction: ttd.commercialFunction,
              judgeVerdict: ttd.judgeVerdict,
              emittedAt: Date.now(),
            });
          }
        } catch (sigErr: any) {
          console.warn(`[Orchestrator] PERSUASION_SIGNAL_EMIT_FAILED | ${sigErr.message}`);
        }

        try {
          const [persSnap] = await db.insert(persuasionSnapshots).values({
            accountId: config.accountId,
            campaignId: config.campaignId,
            jobId,
            awarenessSnapshotId: (ctx.awareness as any)?.snapshotId || "N/A",
            integritySnapshotId: ctx.integritySnapshotId || "N/A",
            funnelSnapshotId: (ctx.funnel as any)?.snapshotId || "N/A",
            offerSnapshotId: (ctx.offer as any)?.snapshotId || "N/A",
            miSnapshotId: ctx.miSnapshotId || "N/A",
            audienceSnapshotId: ctx.audienceSnapshotId || "N/A",
            positioningSnapshotId: ctx.positioningSnapshotId || "N/A",
            differentiationSnapshotId: ctx.differentiationSnapshotId || "N/A",
            engineVersion: PERSUASION_ENGINE_VERSION,
            status: resolveSnapshotWriteStatus(result),
            statusMessage: result.statusMessage || null,
            primaryRoute: JSON.stringify((result as any).primaryRoute || null),
            alternativeRoute: JSON.stringify((result as any).alternativeRoute || null),
            rejectedRoute: JSON.stringify((result as any).rejectedRoute || null),
            layerResults: JSON.stringify((result as any).layerResults || null),
            structuralWarnings: JSON.stringify((result as any).structuralWarnings || []),
            boundaryCheck: JSON.stringify((result as any).boundaryCheck || null),
            dataReliability: JSON.stringify((result as any).dataReliability || null),
            confidenceNormalized: !!(result as any).confidenceNormalized,
            persuasionStrengthScore: (result as any).primaryRoute?.persuasionStrengthScore ?? null,
            executionTimeMs: (result as any).executionTimeMs ?? (Date.now() - __persStart),
            inputHash: persuasionInputHash,
          }).returning({ id: persuasionSnapshots.id });
          (result as any).snapshotId = persSnap.id;
          snapshotId = persSnap.id;
        } catch (e: any) {
          console.error(`[Orchestrator] PERSUASION_PERSIST_FAILED | job=${jobId} | ${e.message}`);
          snapshotId = result.snapshotId;
        }

        if (ctx.analyticalEnrichment) {
          const pr: any = result.primaryRoute || {};
          const persTexts: string[] = [
            pr.routeName || "",
            pr.persuasionMode || "",
            ...(pr.primaryInfluenceDrivers || []).map((d: any) => typeof d === "string" ? d : `${d.driver || ""} ${d.rationale || ""}`),
            ...(pr.objectionPriorities || []).map((o: any) => typeof o === "string" ? o : `${o.objection || ""} ${o.proofType || ""}`),
            ...(pr.messageOrderLogic || []).map((m: any) => typeof m === "string" ? m : `${m.step || ""} ${m.rationale || ""}`),
            ...(pr.trustSequence || []).map((t: any) => typeof t === "string" ? t : `${t.step || ""} ${t.rationale || ""} ${t.purpose || ""}`),
            ...(pr.trustBarriers || []).map((b: any) => `${b.barrierType || ""} ${b.source || ""} ${b.persuasionImplication || ""}`),
            ...(pr.objectionProofLinks || []).map((o: any) => typeof o === "string" ? o : `${o.objection || ""} ${o.proofType || ""} ${o.rationale || ""} ${o.rootCause || ""}`),
            ...(pr.structuredObjections || []).map((o: any) => typeof o === "string" ? o : `${o.objectionStatement || o.objection || ""} ${o.rootCause || ""} ${o.userThinking || ""} ${o.resolution || ""} ${o.causalChainAlignment || ""}`),
          ].filter(t => t && t.trim().length > 0);
          const celResult = enforceGenericEngineCompliance("persuasion", persTexts, ctx.analyticalEnrichment);
          if (!ctx.celResults) ctx.celResults = [];
          ctx.celResults.push(celResult);
          if (celResult.violations.length > 0) {
            console.log(`[Orchestrator] CEL_PERSUASION | violations=${celResult.violations.length} | score=${celResult.score.toFixed(2)}`);
          }
        }
        if (result.celDepthCompliance) {
          if (!ctx.celResults) ctx.celResults = [];
          ctx.celResults.push(result.celDepthCompliance);
          console.log(`[Orchestrator] CEL_PERSUASION_DEPTH | depthScore=${result.celDepthCompliance.causalDepthScore} | violations=${result.celDepthCompliance.violations.length}`);
        }
        if (result.status === "DEPTH_FAILED") {
          ctx.depthGateStatus!.persuasion = "DEPTH_FAILED";
          console.log(`[Orchestrator] DEPTH_GATE_STATUS | persuasion=DEPTH_FAILED`);
        } else {
          ctx.depthGateStatus!.persuasion = "DEPTH_PASSED";
        }
        if (result.depthGateResult) {
          console.log(`[Orchestrator] DEPTH_GATE_PERSUASION | status=${result.depthGateResult.status} | attempts=${result.depthGateResult.attempt}/${result.depthGateResult.maxAttempts}`);
        }
        break;
      }

      case "statistical_validation": {
        const svInputHash = computeInputHash(
          "statval-v1",
          ctx.inputHashes!.persuasion || "",
          ctx.inputHashes!.awareness || "",
          ctx.inputHashes!.funnel || "",
          ctx.inputHashes!.offer || "",
          ctx.inputHashes!.mi || "",
          ctx.inputHashes!.audience || "",
        );
        ctx.inputHashes!.statistical_validation = svInputHash;
        if (!config.forceRefresh) {
          const reused = await tryReuseStatVal(config.accountId, config.campaignId, svInputHash);
          if (reused) {
            logReuseHit("statistical_validation", reused.snap.id, svInputHash);
            output = reused.hydrated;
            ctx.statisticalValidation = reused.hydrated;
            snapshotId = reused.snap.id;
            break;
          }
          logReuseMiss("statistical_validation", svInputHash);
        }
        const miInput = extractMiInput(ctx.mi);
        const audInput = extractAudienceInput(ctx.audience);
        const offerInput = extractOfferInput(ctx.offer);
        const funnelInput = extractFunnelInput(ctx.funnel);
        const awarenessInput = extractAwarenessValidationInput(ctx.awareness);
        const persuasionInput = extractPersuasionValidationInput(ctx.persuasion);
        const statLineage = buildUpstreamLineage(ctx);
        const result = await runStatisticalValidationEngine(
          miInput, audInput, offerInput, funnelInput, awarenessInput, persuasionInput,
          config.accountId, statLineage
        );
        output = result;
        ctx.statisticalValidation = result;

        // ── COMMERCIAL REASONING: validationJudgement (Phase 2 May 2026) ──
        try {
          if (ctx.ssc) {
            const r: any = result;
            const layerScores: Record<string, number> = {};
            for (const lr of r.layerResults || []) {
              const name = lr?.layerName ?? lr?.layer;
              if (name && typeof lr.score === "number") layerScores[String(name)] = lr.score;
            }
            const vState = (r.validationState || "provisional") as "validated" | "provisional" | "weak" | "rejected";
            const claimVals: any[] = Array.isArray(r.claimValidations) ? r.claimValidations : [];
            const totalClaims = claimVals.length;
            const sbcCount = claimVals.filter((c: any) => c?.signalBacked === true || c?.isSignalBacked === true || (typeof c?.signalEvidence === "number" && c.signalEvidence > 0) || (Array.isArray(c?.supportingSignals) && c.supportingSignals.length > 0)).length;
            const sbcRatio = totalClaims > 0 ? sbcCount / totalClaims : (typeof r.signalBackedClaimRatio === "number" ? r.signalBackedClaimRatio : 0.5);
            const eStrength = typeof r.evidenceStrength === "number" ? r.evidenceStrength : (typeof r.claimConfidenceScore === "number" ? r.claimConfidenceScore : (typeof r.confidenceScore === "number" ? r.confidenceScore : 0.5));
            const unmapped = Array.isArray(r.unmappedSignals) ? r.unmappedSignals : [];
            const lowConf = Array.isArray(r.lowConfidenceSignals) ? r.lowConfidenceSignals : [];
            const hypoCount = claimVals.filter((c: any) => c?.classification === "hypothesis" || c?.isHypothesis === true).length;
            const cj = await designValidationJudgement({
              validationState: vState,
              evidenceStrength: eStrength,
              signalBackedClaimRatio: sbcRatio,
              signalBackedClaimCount: sbcCount,
              totalClaims,
              hypothesisCount: hypoCount,
              unmappedSignalCount: unmapped.length,
              lowConfidenceSignalCount: lowConf.length,
              reliabilityOverall: r.dataReliability?.overallReliability ?? r.dataReliability?.overall ?? 0.5,
              topAssumptionFlags: (r.assumptionFlags || []).slice(0, 6).map((x: any) => typeof x === "string" ? x : (x?.message || JSON.stringify(x))),
              topStructuralWarnings: (r.structuralWarnings || []).slice(0, 6).map((w: any) => typeof w === "string" ? w : (w?.message || JSON.stringify(w))),
              layerScores,
              accountId: config.accountId,
            });
            if (cj) {
              cj.validationState = vState;
              cj.evidenceStrength = eStrength;
              cj.signalBackedClaimRatio = sbcRatio;
              r.commercialJudgement = cj;
              emitCommercialSignal(ctx.ssc, "validationQuality", {
                validationState: cj.validationState,
                evidenceStrength: cj.evidenceStrength,
                signalBackedClaimRatio: cj.signalBackedClaimRatio,
                commercialUsability: cj.commercialUsability,
                topTrustGaps: cj.topTrustGaps,
                whatWouldUnlockNextTier: cj.whatWouldUnlockNextTier,
                judgeVerdict: cj.judgeVerdict,
                emittedAt: Date.now(),
              });
            }
          }
        } catch (cjErr: any) {
          console.warn(`[Orchestrator] STATVAL_COMMERCIAL_FAILED | ${cjErr.message}`);
        }

        try {
          const [svSnap] = await db.insert(strategyValidationSnapshots).values({
            accountId: config.accountId,
            campaignId: config.campaignId,
            jobId,
            persuasionSnapshotId: ctx.persuasion?.snapshotId || null,
            engineVersion: result.engineVersion || 1,
            status: resolveSnapshotWriteStatus(result),
            statusMessage: result.statusMessage || null,
            result: JSON.stringify(result),
            layerResults: JSON.stringify(result.layerResults || []),
            structuralWarnings: JSON.stringify(result.structuralWarnings || []),
            boundaryCheck: JSON.stringify(result.boundaryCheck || {}),
            dataReliability: JSON.stringify(result.dataReliability || {}),
            confidenceScore: result.claimConfidenceScore || null,
            executionTimeMs: result.executionTimeMs || null,
            inputHash: svInputHash,
          }).returning();
          snapshotId = svSnap.id;
          ctx.statisticalValidation.snapshotId = svSnap.id;
          console.log(`[Orchestrator] SV_SNAPSHOT_PERSISTED | id=${svSnap.id} confidence=${result.claimConfidenceScore?.toFixed(2) || "N/A"} state=${result.validationState}`);
        } catch (snapErr: any) {
          console.warn(`[Orchestrator] SV snapshot persist failed: ${snapErr.message}`);
          snapshotId = undefined;
        }
        break;
      }

      case "budget_governor": {
        const bizData = await getBusinessData(config.accountId, config.campaignId);
        const campaignData = await getCampaignData(config.campaignId);
        const bgInputHash = computeInputHash(
          "budget-governor-v1",
          ctx.inputHashes!.offer || "",
          ctx.inputHashes!.funnel || "",
          ctx.inputHashes!.statistical_validation || "",
          ctx.inputHashes!.mi || "",
          ctx.inputHashes!.audience || "",
          { monthlyBudget: bizData?.monthlyBudget || null, manualMetrics: ctx.manualCampaignMetrics || null },
        );
        ctx.inputHashes!.budget_governor = bgInputHash;
        if (!config.forceRefresh) {
          const reused = await tryReuseBudgetGovernor(config.accountId, config.campaignId, bgInputHash);
          if (reused) {
            logReuseHit("budget_governor", reused.snap.id, bgInputHash);
            output = reused.hydrated;
            ctx.budgetGovernor = reused.hydrated;
            ctx.budgetGovernorSnapshotId = reused.snap.id;
            snapshotId = reused.snap.id;
            break;
          }
          logReuseMiss("budget_governor", bgInputHash);
        }

        const offerCtxBG = extractOfferInput(ctx.offer);
        const offerStrength = typeof offerCtxBG.offerStrengthScore === "number" ? offerCtxBG.offerStrengthScore : 0.5;
        const offerProofScore = typeof offerCtxBG.proofStrength === "number" ? offerCtxBG.proofStrength : 0.5;
        const offerCompleteness = offerCtxBG.offerName != null && offerCtxBG.coreOutcome != null;

        const funnelCtxBG = extractFunnelInput(ctx.funnel);
        const funnelStrengthScore = typeof funnelCtxBG.funnelStrengthScore === "number" ? funnelCtxBG.funnelStrengthScore : 0.5;
        const funnelFrictionScore = typeof funnelCtxBG.frictionMap?.totalFriction === "number" ? funnelCtxBG.frictionMap.totalFriction : 0.5;
        const funnelProjections = {
          expectedConversionRate: typeof funnelCtxBG.trustPathScore === "number" ? funnelCtxBG.trustPathScore : 0.02,
          expectedCPA: 50,
          expectedROAS: 2.0,
        };

        const miCtxBG = ctx.mi?.output || ctx.mi || {};
        const competitors = miCtxBG.competitors || [];
        const marketIntensity = competitors.length > 0 ? Math.min(competitors.length / 10, 1.0) : 0.5;
        const competitorSpendEstimate = competitors.length * 500;

        const audCtxBG = ctx.audience || {};
        const segments = audCtxBG.audienceSegments || audCtxBG.segments || [];
        const audienceSize = segments.length >= 5 ? "large" : segments.length >= 2 ? "medium" : "small";

        const svCtx = ctx.statisticalValidation || {};
        const validationConfidence = typeof svCtx.claimConfidenceScore === "number" ? svCtx.claimConfidenceScore
          : typeof svCtx.confidenceScore === "number" ? svCtx.confidenceScore : 0.5;
        const validationState = svCtx.validationState || "unknown";

        const monthlyBudget = parseFloat(bizData?.monthlyBudget?.replace(/[^0-9.]/g, "") || "0");

        const manualMetrics = ctx.manualCampaignMetrics || null;
        const campaignPerformance = manualMetrics ? {
          conversions: manualMetrics.conversions || 0,
          spend: manualMetrics.spend || 0,
          revenue: manualMetrics.revenue || 0,
          isStatisticallyValid: (manualMetrics.conversions || 0) >= 30,
          statisticalConfidence: Math.min((manualMetrics.conversions || 0) / 100, 1),
        } : undefined;

        const budgetGovernorInput: import("../strategy/budget-governor/types").BudgetGovernorInput = {
          offerStrength,
          offerProofScore,
          offerCompleteness,
          funnelStrengthScore,
          funnelFrictionScore,
          funnelProjections,
          channelRisk: 0.5,
          validationConfidence,
          validationState,
          marketIntensity,
          competitorSpendEstimate,
          audienceSize,
          currentBudget: monthlyBudget,
          historicalCPA: manualMetrics?.cpa || null,
          historicalROAS: manualMetrics?.roas || null,
          campaignPerformance,
          signalComposition: ctx.signalComposition || undefined,
        };

        console.log(`[Orchestrator] BUDGET_GOVERNOR_INPUT | offerStrength=${offerStrength.toFixed(2)} funnelStrength=${funnelStrengthScore.toFixed(2)} validationConf=${validationConfidence.toFixed(2)} marketIntensity=${marketIntensity.toFixed(2)} audienceSize=${audienceSize} budget=${monthlyBudget}`);

        const result = runBudgetGovernorEngine(budgetGovernorInput);
        output = result;
        ctx.budgetGovernor = result;

        // ── COMMERCIAL REASONING: budgetStrategy (Phase 2 May 2026) ──
        try {
          if (ctx.ssc) {
            const r: any = result;
            const action = (r.decision?.action || "hold") as "test" | "scale" | "hold" | "halt";
            const decisionConfidence = typeof r.budgetDecisionConfidence === "number" ? r.budgetDecisionConfidence : (typeof r.confidenceScore === "number" ? r.confidenceScore : 0.5);
            const cacAssess = r.cacAssumptionCheck || r.cacReality || r.cacAssessment || {};
            const reconciledConf = typeof r.baseValidationConfidence === "number" ? r.baseValidationConfidence : (typeof r.reconciledValidationConfidence === "number" ? r.reconciledValidationConfidence : validationConfidence);
            const cj = await designBudgetStrategy({
              action,
              decisionConfidence,
              validationState: validationState || "unknown",
              reconciledValidationConfidence: reconciledConf,
              offerStrength,
              funnelStrength: funnelStrengthScore,
              channelRisk: 0.5,
              testBudgetMin: r.testBudgetRange?.min ?? 0,
              testBudgetMax: r.testBudgetRange?.max ?? 0,
              scaleBudgetMin: r.scaleBudgetRange?.min ?? 0,
              scaleBudgetMax: r.scaleBudgetRange?.max ?? 0,
              estimatedCAC: cacAssess.estimatedCAC ?? cacAssess.estimated ?? funnelProjections.expectedCPA ?? 0,
              benchmarkCAC: cacAssess.industryBenchmarkCAC ?? cacAssess.benchmarkCAC ?? cacAssess.benchmark ?? 0,
              cacRealistic: cacAssess.realistic !== false,
              killFlag: !!r.killFlag,
              killReasons: Array.isArray(r.killReasons) ? r.killReasons.map(String) : [],
              riskFactors: Array.isArray(r.riskAssessment?.riskFactors) ? r.riskAssessment.riskFactors.map(String) : (Array.isArray(r.riskFactors) ? r.riskFactors.map(String) : []),
              performanceConversions: campaignPerformance?.conversions ?? 0,
              performanceSpend: campaignPerformance?.spend ?? 0,
              marketIntensity,
              accountId: config.accountId,
            });
            if (cj) {
              cj.action = action;
              r.commercialStrategy = cj;
              emitCommercialSignal(ctx.ssc, "budgetStrategy", {
                action: cj.action,
                spendPace: cj.spendPace,
                learningBudgetCarveOutPct: cj.learningBudgetCarveOutPct,
                capitalEfficiencyAssessment: cj.capitalEfficiencyAssessment,
                killTriggerThreshold: cj.killTriggerThreshold,
                expansionPrecondition: cj.expansionPrecondition,
                judgeVerdict: cj.judgeVerdict,
                emittedAt: Date.now(),
              });
            }
          }
        } catch (cjErr: any) {
          console.warn(`[Orchestrator] BUDGET_COMMERCIAL_FAILED | ${cjErr.message}`);
        }

        try {
          const [bgSnap] = await db.insert(budgetGovernorSnapshots).values({
            accountId: config.accountId,
            campaignId: config.campaignId,
            jobId,
            validationSnapshotId: ctx.statisticalValidation?.snapshotId || null,
            engineVersion: BUDGET_GOVERNOR_ENGINE_VERSION,
            status: "COMPLETE",
            result: JSON.stringify(result),
            confidenceScore: result.confidenceScore || null,
            executionTimeMs: result.executionTimeMs || null,
            inputHash: bgInputHash,
          }).returning();
          snapshotId = bgSnap.id;
          ctx.budgetGovernorSnapshotId = bgSnap.id;
          console.log(`[Orchestrator] BUDGET_GOVERNOR_SNAPSHOT_SAVED | id=${bgSnap.id}`);
        } catch (bgDbErr: any) {
          console.warn(`[Orchestrator] BUDGET_SNAPSHOT_SAVE_FAILED | error=${bgDbErr.message}`);
        }
        break;
      }

      case "channel_selection": {
        const csInputHash = computeInputHash(
          "channel-selection-v1",
          ctx.inputHashes!.audience || "",
          ctx.inputHashes!.awareness || "",
          ctx.inputHashes!.persuasion || "",
          ctx.inputHashes!.offer || "",
          ctx.inputHashes!.budget_governor || "",
          ctx.inputHashes!.statistical_validation || "",
        );
        ctx.inputHashes!.channel_selection = csInputHash;
        if (!config.forceRefresh) {
          const reused = await tryReuseChannelSelection(config.accountId, config.campaignId, csInputHash);
          if (reused) {
            logReuseHit("channel_selection", reused.snap.id, csInputHash);
            output = reused.hydrated;
            ctx.channelSelection = reused.hydrated;
            ctx.channelSelectionSnapshotId = reused.snap.id;
            snapshotId = reused.snap.id;
            break;
          }
          logReuseMiss("channel_selection", csInputHash);
        }
        const audInput = extractAudienceInput(ctx.audience);
        const awarenessInput = ctx.awareness || {};
        if (ctx.ssc?.awarenessMeaning && awarenessInput.primaryRoute) {
          const canonicalStage = ctx.ssc.awarenessMeaning.stage;
          const currentStage = awarenessInput.primaryRoute.targetReadinessStage;
          if (currentStage !== canonicalStage) {
            console.log(`[Orchestrator] SSC_AWARENESS_OVERRIDE | channel_selection | was=${currentStage} | canonical=${canonicalStage}`);
            awarenessInput.primaryRoute.targetReadinessStage = canonicalStage;
          }
          awarenessInput._canonicalAwareness = ctx.ssc.awarenessMeaning;
        } else if (ctx.ssc?.awarenessMeaning && !awarenessInput.primaryRoute) {
          awarenessInput.primaryRoute = {
            targetReadinessStage: ctx.ssc.awarenessMeaning.stage,
          };
          awarenessInput._canonicalAwareness = ctx.ssc.awarenessMeaning;
          console.log(`[Orchestrator] SSC_AWARENESS_INJECTED | channel_selection | stage=${ctx.ssc.awarenessMeaning.stage} | reason=no_awareness_engine_output`);
        }
        const persuasionInput = ctx.persuasion || {};
        const offerInput = extractOfferInput(ctx.offer);
        const bgResult = ctx.budgetGovernor || {};
        const budgetInput = {
          testBudgetMin: bgResult.testBudgetRange?.min ?? 0,
          testBudgetMax: bgResult.testBudgetRange?.max ?? 0,
          scaleBudgetMin: bgResult.scaleBudgetRange?.min ?? 0,
          scaleBudgetMax: bgResult.scaleBudgetRange?.max ?? 0,
          expansionPermission: bgResult.expansionPermission?.allowed ?? false,
          killFlag: bgResult.killFlag ?? false,
        };
        const validationInput = ctx.statisticalValidation || {};
        console.log(`[Orchestrator] CHANNEL_BUDGET_MAPPED | testMax=${budgetInput.testBudgetMax} scaleMax=${budgetInput.scaleBudgetMax} killFlag=${budgetInput.killFlag} expansion=${budgetInput.expansionPermission} | awarenessStage=${awarenessInput.primaryRoute?.targetReadinessStage || "unknown"}`);
        const result = runChannelSelectionEngine(
          audInput, awarenessInput, persuasionInput, offerInput,
          budgetInput, validationInput, "INTELLIGENT",
          ctx.memoryContext || undefined
        );
        output = result;
        ctx.channelSelection = result;

        // ── COMMERCIAL REASONING: channelOrchestration (Phase 2 May 2026) ──
        try {
          if (ctx.ssc) {
            const r: any = result;
            const primary = r.primaryChannel || r.recommendedChannels?.[0] || {};
            const secondary = r.secondaryChannel || r.recommendedChannels?.[1] || {};
            const rejArr = Array.isArray(r.rejectedChannels) ? r.rejectedChannels : [];
            const funnelStages = (() => {
              const fs = ctx.funnel?.stages;
              if (Array.isArray(fs)) return fs;
              if (typeof fs === "string") { try { const p = JSON.parse(fs); return Array.isArray(p) ? p : []; } catch { return []; } }
              return [];
            })();
            const stageType = (s: any): string => String(s?.stageType || s?.type || s?.stage || "").toLowerCase();
            const cj = await designChannelOrchestration({
              primaryChannelName: primary.channelName || primary.label || primary.channelKey || primary.name || "(none)",
              secondaryChannelName: secondary.channelName || secondary.label || secondary.channelKey || secondary.name || "(none)",
              primaryChannelType: primary.channelType || primary.type || "(unknown)",
              secondaryChannelType: secondary.channelType || secondary.type || "(unknown)",
              primaryFitScore: typeof primary.fitScore === "number" ? primary.fitScore : 0,
              secondaryFitScore: typeof secondary.fitScore === "number" ? secondary.fitScore : 0,
              channelMode: r.channelMode || "INTELLIGENT",
              awarenessStage: awarenessInput.primaryRoute?.targetReadinessStage || ctx.ssc.awarenessMeaning?.stage || "unknown",
              audienceMaturityIndex: typeof audInput.maturityIndex === "number" ? audInput.maturityIndex : null,
              testBudgetMin: budgetInput.testBudgetMin,
              testBudgetMax: budgetInput.testBudgetMax,
              killFlag: !!budgetInput.killFlag,
              expansionAllowed: !!budgetInput.expansionPermission,
              rejectedChannels: rejArr.slice(0, 6).map((c: any) => `${c.channelName || c.label || c.channelKey || c.name || "?"} — ${c.rejectionReason || c.reason || "(no reason)"}`),
              funnelAwarenessCount: funnelStages.filter((s: any) => /aware/.test(stageType(s))).length,
              funnelNurtureCount: funnelStages.filter((s: any) => /(nurture|consider|interest|eval)/.test(stageType(s))).length,
              funnelConversionCount: funnelStages.filter((s: any) => /(convers|purchase|decision|action|close)/.test(stageType(s))).length,
              accountId: config.accountId,
            });
            if (cj) {
              r.commercialOrchestration = cj;
              emitCommercialSignal(ctx.ssc, "channelOrchestration", {
                primaryChannel: cj.primaryChannel,
                secondaryChannel: cj.secondaryChannel,
                marketEntryPattern: cj.marketEntryPattern,
                channelInterlock: cj.channelInterlock,
                withdrawalTrigger: cj.withdrawalTrigger,
                validationMilestone: cj.validationMilestone,
                riskBudgetBalance: cj.riskBudgetBalance,
                judgeVerdict: cj.judgeVerdict,
                emittedAt: Date.now(),
              });
            }
          }
        } catch (cjErr: any) {
          console.warn(`[Orchestrator] CHANNEL_COMMERCIAL_FAILED | ${cjErr.message}`);
        }

        try {
          const [csSnap] = await db.insert(channelSelectionSnapshots).values({
            accountId: config.accountId,
            campaignId: config.campaignId,
            jobId,
            validationSnapshotId: ctx.statisticalValidation?.snapshotId || null,
            budgetSnapshotId: ctx.budgetGovernorSnapshotId || null,
            engineVersion: CHANNEL_SELECTION_ENGINE_VERSION,
            status: "COMPLETE",
            result: JSON.stringify(result),
            confidenceScore: result.confidenceScore || null,
            executionTimeMs: result.executionTimeMs || null,
            inputHash: csInputHash,
          }).returning();
          snapshotId = csSnap.id;
          ctx.channelSelectionSnapshotId = csSnap.id;
          console.log(`[Orchestrator] CHANNEL_SELECTION_SNAPSHOT_SAVED | id=${csSnap.id}`);
        } catch (csDbErr: any) {
          console.warn(`[Orchestrator] CHANNEL_SNAPSHOT_SAVE_FAILED | error=${csDbErr.message}`);
        }
        break;
      }

      case "iteration": {
        const iterGate = await getIterationGateData(config.accountId, config.campaignId);
        const iterInputHash = computeInputHash(
          "iteration-v1",
          ctx.inputHashes!.funnel || "",
          ctx.inputHashes!.persuasion || "",
          { metrics: iterGate.campaignMetrics || null, gateInputs: iterGate.gateInputs || null },
        );
        ctx.inputHashes!.iteration = iterInputHash;
        if (!config.forceRefresh && iterGate.isReady) {
          const reused = await tryReuseIteration(config.accountId, config.campaignId, iterInputHash);
          if (reused) {
            logReuseHit("iteration", reused.snap.id, iterInputHash);
            output = reused.hydrated;
            ctx.iteration = reused.hydrated;
            ctx.iterationSnapshotId = reused.snap.id;
            snapshotId = reused.snap.id;
            break;
          }
          logReuseMiss("iteration", iterInputHash);
        }
        if (!iterGate.isReady) {
          console.log(`[Orchestrator] ITERATION_NEEDS_INPUT | missing=${iterGate.missingFields.join(",")}`);
          return {
            engineId,
            status: "NEEDS_INPUT",
            output: null,
            durationMs: Date.now() - startTime,
            needsInput: {
              engine: "iteration",
              missingFields: iterGate.missingFields,
              prefillableFields: iterGate.prefillableFields,
            },
          };
        }

        const campaignData = await getCampaignData(config.campaignId);
        const mcm = iterGate.campaignMetrics;
        const gi = iterGate.gateInputs;

        const performance = {
          impressions: (mcm?.impressions || 0) + (campaignData?.impressions || 0),
          clicks: (mcm?.clicks || 0) + (campaignData?.clicks || 0),
          conversions: (mcm?.conversions || 0) + (campaignData?.conversions || 0),
          spend: (mcm?.spend || 0) + parseFloat(campaignData?.spend || "0"),
          revenue: (mcm?.revenue || 0) + parseFloat(campaignData?.revenue || "0"),
        };

        const hasAnyPerf = performance.impressions > 0 || performance.clicks > 0 ||
          performance.conversions > 0 || performance.spend > 0 || performance.revenue > 0;

        const result = await runIterationEngine(
          hasAnyPerf ? performance : null,
          ctx.funnel || null,
          null,
          ctx.persuasion || null,
          ctx.memoryContext || undefined
        );
        output = result;
        ctx.iteration = result;

        // ── COMMERCIAL REASONING: iterationStrategy (Phase 2 May 2026) ──
        try {
          if (ctx.ssc) {
            const r: any = result;
            const hyps = Array.isArray(r.nextTestHypotheses) ? r.nextTestHypotheses : (Array.isArray(r.hypotheses) ? r.hypotheses : []);
            const optTargets = Array.isArray(r.optimizationTargets) ? r.optimizationTargets : [];
            const failed = Array.isArray(r.failedStrategyFlags) ? r.failedStrategyFlags : (Array.isArray(r.failedStrategies) ? r.failedStrategies : []);
            const fatigue = Array.isArray(r.fatigueSignals) ? r.fatigueSignals : (Array.isArray(r.creativeFatigue?.signals) ? r.creativeFatigue.signals : []);
            const layerScores: Record<string, number> = {};
            for (const lr of r.layerResults || []) {
              const name = lr?.layerName ?? lr?.layer;
              if (name && typeof lr.score === "number") layerScores[String(name)] = lr.score;
            }
            const cr = (performance.clicks > 0 && performance.conversions > 0) ? performance.conversions / performance.clicks : 0;
            const roas = performance.spend > 0 ? performance.revenue / performance.spend : 0;
            const cpa = performance.conversions > 0 ? performance.spend / performance.conversions : 0;
            const cj = await designIterationStrategy({
              campaignId: config.campaignId,
              performanceROAS: roas,
              performanceCPA: cpa,
              performanceConversions: performance.conversions,
              funnelConversionRate: cr,
              hypothesisCount: hyps.length,
              topHypotheses: hyps.slice(0, 5).map((h: any) => typeof h === "string" ? h : (h.hypothesis || h.name || h.description || JSON.stringify(h).slice(0, 120))),
              optimizationTargets: optTargets.slice(0, 5).map((t: any) => typeof t === "string" ? t : (t.targetArea || t.target || t.name || t.description || JSON.stringify(t).slice(0, 120))),
              failedStrategies: failed.slice(0, 4).map((f: any) => typeof f === "string" ? f : (f.strategyName || f.strategy || f.name || f.failureReason || JSON.stringify(f).slice(0, 120))),
              fatigueSignals: fatigue.slice(0, 4).map((f: any) => typeof f === "string" ? f : (f.signal || f.description || JSON.stringify(f).slice(0, 120))),
              layerScores,
              accountId: config.accountId,
            });
            if (cj) {
              r.commercialIterationStrategy = cj;
              emitCommercialSignal(ctx.ssc, "iterationStrategy", {
                learningPriority: cj.learningPriority,
                killVsRetainHeuristic: cj.killVsRetainHeuristic,
                hypothesisDependencyChain: cj.hypothesisDependencyChain,
                acceptableLossPerTest: cj.acceptableLossPerTest,
                decisionVelocity: cj.decisionVelocity,
                judgeVerdict: cj.judgeVerdict,
                emittedAt: Date.now(),
              });
            }
          }
        } catch (cjErr: any) {
          console.warn(`[Orchestrator] ITERATION_COMMERCIAL_FAILED | ${cjErr.message}`);
        }

        try {
          const [iterSnap] = await db.insert(iterationSnapshots).values({
            accountId: config.accountId,
            campaignId: config.campaignId,
            jobId,
            engineVersion: result.engineVersion || 1,
            status: resolveSnapshotWriteStatus(result),
            statusMessage: result.statusMessage || null,
            result: JSON.stringify(result),
            layerResults: result.layerResults ? JSON.stringify(result.layerResults) : null,
            structuralWarnings: result.structuralWarnings ? JSON.stringify(result.structuralWarnings) : null,
            boundaryCheck: result.boundaryCheck ? JSON.stringify(result.boundaryCheck) : null,
            dataReliability: result.dataReliability ? JSON.stringify(result.dataReliability) : null,
            confidenceScore: result.confidenceScore || null,
            executionTimeMs: result.executionTimeMs || null,
            inputHash: iterInputHash,
          }).returning();
          snapshotId = iterSnap.id;
          ctx.iterationSnapshotId = iterSnap.id;
          console.log(`[Orchestrator] ITERATION_SNAPSHOT_SAVED | id=${iterSnap.id}`);
        } catch (iterDbErr: any) {
          console.warn(`[Orchestrator] ITERATION_SNAPSHOT_SAVE_FAILED | error=${iterDbErr.message}`);
        }
        break;
      }

      case "retention": {
        const retGate = await getRetentionGateData(config.accountId, config.campaignId);
        const retInputHash = computeInputHash(
          "retention-v1",
          ctx.inputHashes!.funnel || "",
          ctx.inputHashes!.offer || "",
          ctx.inputHashes!.audience || "",
          ctx.inputHashes!.mechanism || "",
          { metrics: retGate.retentionMetrics || null, gateInputs: retGate.gateInputs || null },
        );
        ctx.inputHashes!.retention = retInputHash;
        if (!config.forceRefresh && retGate.isReady) {
          const reused = await tryReuseRetention(config.accountId, config.campaignId, retInputHash);
          if (reused) {
            logReuseHit("retention", reused.snap.id, retInputHash);
            output = reused.hydrated;
            ctx.retention = reused.hydrated;
            ctx.retentionSnapshotId = reused.snap.id;
            snapshotId = reused.snap.id;
            break;
          }
          logReuseMiss("retention", retInputHash);
        }
        if (!retGate.isReady) {
          console.log(`[Orchestrator] RETENTION_NEEDS_INPUT | missing=${retGate.missingFields.join(",")}`);
          return {
            engineId,
            status: "NEEDS_INPUT",
            output: null,
            durationMs: Date.now() - startTime,
            needsInput: {
              engine: "retention",
              missingFields: retGate.missingFields,
              prefillableFields: retGate.prefillableFields,
            },
          };
        }

        const offerCtx = extractOfferInput(ctx.offer);
        const audInput = extractAudienceInput(ctx.audience);
        const funnelCtx = extractFunnelInput(ctx.funnel);
        const mechCtx = ctx.mechanism || {};
        const rm = retGate.retentionMetrics;
        const rg = retGate.gateInputs;

        const safeParseArr = (v: any): any[] => {
          if (Array.isArray(v)) return v;
          if (typeof v === "string") { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } }
          return [];
        };

        const audiencePains = safeParseArr(audInput.audiencePains);
        const purchaseMotivations = audiencePains.slice(0, 4).map((p: any) => ({
          motivation: p.canonical || p.pain || p.description || "Unknown motivation",
          strength: typeof p.intensity === "number" ? p.intensity : (typeof p.severity === "number" ? p.severity : 0.5),
          category: "pain_alleviation" as const,
        })).filter((m: any) => m.motivation !== "Unknown motivation");

        const audienceObjections = safeParseArr(audInput.objectionMap);
        const postPurchaseObjections = audienceObjections.slice(0, 5).map((obj: any) => ({
          objection: obj.objection || obj.text || obj.description || "Unknown objection",
          category: obj.category || obj.type || "general",
          severity: typeof obj.severity === "number" ? obj.severity : (typeof obj.intensity === "number" ? obj.intensity : 0.5),
        })).filter((o: any) => o.objection !== "Unknown objection");

        const funnelStages = safeParseArr(funnelCtx.stages);
        const touchpoints = funnelStages.map((stage: any, idx: number) => ({
          type: stage.type || stage.stageName || stage.name || `stage_${idx + 1}`,
          channel: stage.channel || stage.medium || "funnel",
          sequencePosition: idx + 1,
          purpose: stage.purpose || stage.objective || stage.description || null,
        }));

        const mechanismDesc = mechCtx.primaryMechanism?.name || mechCtx.name || null;

        const repeatPurchaseRate = rm?.repeatPurchaseRate ||
          (rm?.totalCustomers && rm?.returningCustomers
            ? rm.returningCustomers / rm.totalCustomers
            : null);
        const churnRate = repeatPurchaseRate != null ? 1 - repeatPurchaseRate : null;
        const avgOrderValue = rm?.averageOrderValue || null;
        const clv = (avgOrderValue && rm?.purchaseFrequency)
          ? avgOrderValue * rm.purchaseFrequency * (rm.customerLifespan || 1)
          : null;

        console.log(`[Orchestrator] RETENTION_INPUT_SYNTHESIS | touchpoints=${touchpoints.length} from funnel stages | postPurchaseObjections=${postPurchaseObjections.length} from audience | motivations=${purchaseMotivations.length}`);

        const result = await runRetentionEngine({
          customerJourneyData: {
            touchpoints,
            avgTimeToConversion: null,
            repeatPurchaseRate,
            churnRate,
            customerLifetimeValue: clv,
            retentionWindowDays: rm?.dataWindowDays || null,
            engagementDecayRate: rm?.refundRate || null,
          },
          offerStructure: {
            offerName: offerCtx.offerName,
            coreOutcome: offerCtx.coreOutcome,
            deliverables: safeParseArr(offerCtx.deliverables),
            proofStrength: offerCtx.proofStrength,
            mechanismDescription: mechanismDesc,
            riskReducers: safeParseArr(offerCtx.riskReducers),
          },
          purchaseMotivations,
          postPurchaseObjections,
          campaignId: config.campaignId,
          accountId: config.accountId,
          memoryContext: ctx.memoryContext || undefined,
        });
        output = result;
        ctx.retention = result;

        // ── COMMERCIAL REASONING: retentionEconomics (Phase 2 May 2026) ──
        try {
          if (ctx.ssc) {
            const r: any = result;
            const loops = Array.isArray(r.retentionLoops) ? r.retentionLoops : [];
            const churnFlags = Array.isArray(r.churnRiskFlags) ? r.churnRiskFlags : (Array.isArray(r.churnRisks) ? r.churnRisks : []);
            const ltvPaths = Array.isArray(r.ltvExpansionPaths) ? r.ltvExpansionPaths : (Array.isArray(r.expansionPaths) ? r.expansionPaths : []);
            const upsellTriggers = Array.isArray(r.upsellTriggers) ? r.upsellTriggers : [];
            const cj = await designRetentionEconomics({
              customerLTV: clv,
              churnRate,
              repeatPurchaseRate,
              retentionWindowDays: rm?.dataWindowDays || null,
              topMotivations: purchaseMotivations.slice(0, 5).map((m: any) => `${m.motivation} (strength ${m.strength.toFixed(2)})`),
              topPostPurchaseObjections: postPurchaseObjections.slice(0, 5).map((o: any) => `${o.objection} (severity ${o.severity.toFixed(2)})`),
              retentionLoops: loops.slice(0, 5).map((l: any) => typeof l === "string" ? l : (l.loopName || l.name || l.description || JSON.stringify(l).slice(0, 140))),
              topChurnRiskFlags: churnFlags.slice(0, 5).map((c: any) => typeof c === "string" ? c : (c.risk || c.flag || c.description || JSON.stringify(c).slice(0, 140))),
              topLTVPaths: ltvPaths.slice(0, 5).map((p: any) => typeof p === "string" ? p : (p.path || p.name || p.description || JSON.stringify(p).slice(0, 140))),
              topUpsellTriggers: upsellTriggers.slice(0, 5).map((t: any) => typeof t === "string" ? t : (t.trigger || t.name || t.description || JSON.stringify(t).slice(0, 140))),
              offerCoreOutcome: offerCtx.coreOutcome || null,
              offerProofStrength: typeof offerCtx.proofStrength === "number" ? offerCtx.proofStrength : null,
              accountId: config.accountId,
            });
            if (cj) {
              r.commercialRetentionEconomics = cj;
              emitCommercialSignal(ctx.ssc, "retentionEconomics", {
                ltvUnlockSequence: cj.ltvUnlockSequence,
                churnDefensePriority: cj.churnDefensePriority,
                expansionRevenuePath: cj.expansionRevenuePath,
                paybackPeriodAssessment: cj.paybackPeriodAssessment,
                retentionROIThesis: cj.retentionROIThesis,
                judgeVerdict: cj.judgeVerdict,
                emittedAt: Date.now(),
              });
            }
          }
        } catch (cjErr: any) {
          console.warn(`[Orchestrator] RETENTION_COMMERCIAL_FAILED | ${cjErr.message}`);
        }

        try {
          const [retSnap] = await db.insert(retentionSnapshots).values({
            accountId: config.accountId,
            campaignId: config.campaignId,
            jobId,
            engineVersion: result.engineVersion || 1,
            status: resolveSnapshotWriteStatus(result),
            statusMessage: result.statusMessage || null,
            result: JSON.stringify(result),
            layerResults: result.layerResults ? JSON.stringify(result.layerResults) : null,
            structuralWarnings: result.structuralWarnings ? JSON.stringify(result.structuralWarnings) : null,
            boundaryCheck: result.boundaryCheck ? JSON.stringify(result.boundaryCheck) : null,
            dataReliability: result.dataReliability ? JSON.stringify(result.dataReliability) : null,
            confidenceScore: result.confidenceScore || null,
            executionTimeMs: result.executionTimeMs || null,
            inputHash: retInputHash,
          }).returning();
          snapshotId = retSnap.id;
          ctx.retentionSnapshotId = retSnap.id;
          console.log(`[Orchestrator] RETENTION_SNAPSHOT_SAVED | id=${retSnap.id}`);
        } catch (retDbErr: any) {
          console.warn(`[Orchestrator] RETENTION_SNAPSHOT_SAVE_FAILED | error=${retDbErr.message}`);
        }
        break;
      }

      default:
        return {
          engineId,
          status: "SKIPPED",
          output: null,
          durationMs: Date.now() - startTime,
          blockReason: `Unknown engine: ${engineId}`,
        };
    }

    const engineOutputStatus = output?.status;
    if (engineOutputStatus === "MISSING_DEPENDENCY") {
      console.log(`[Orchestrator] Engine ${engineId} returned MISSING_DEPENDENCY: ${output?.statusMessage || "dependency check failed"}`);
      return {
        engineId,
        status: "BLOCKED",
        output,
        snapshotId,
        durationMs: Date.now() - startTime,
        blockReason: output?.statusMessage || "Engine dependency not met",
      };
    }

    // T003: Integrity enforcement gate — when integrity says safeToExecute=false,
    // block all downstream engines (Budget, Channel, Iteration, Retention) unless
    // an explicit override is set on the account or environment.
    if (engineId === "integrity" && output && output.safeToExecute === false) {
      const envOverride = process.env.INTEGRITY_OVERRIDE === "1" || process.env.INTEGRITY_OVERRIDE === "true";
      const acctOverride = !!(config as any)?.accountMetadata?.INTEGRITY_OVERRIDE;
      if (envOverride || acctOverride) {
        console.warn(`[Orchestrator] INTEGRITY_OVERRIDE_ACTIVE | acctOverride=${acctOverride} envOverride=${envOverride} — downstream engines will run despite safeToExecute=false. Warnings: ${(output.structuralWarnings || []).slice(0, 3).join(" | ")}`);
        // Record override on output so the snapshot reflects the bypass
        output.overrideApplied = true;
        output.overrideReason = envOverride ? "ENV_INTEGRITY_OVERRIDE" : "ACCOUNT_INTEGRITY_OVERRIDE";
      } else {
        const reasons = (output.structuralWarnings || []).slice(0, 5).join(" | ") || "Integrity engine flagged unsafe-to-execute";
        console.warn(`[Orchestrator] BLOCKED_BY_INTEGRITY | safeToExecute=false | reasons=${reasons}`);
        return {
          engineId,
          status: "BLOCKED_BY_INTEGRITY",
          output,
          snapshotId,
          durationMs: Date.now() - startTime,
          blockReason: `Integrity gate: ${reasons}`,
        };
      }
    }

    return {
      engineId,
      status: "SUCCESS",
      output,
      snapshotId,
      durationMs: Date.now() - startTime,
    };
  } catch (error: any) {
    console.error(`[Orchestrator] Engine ${engineId} failed:`, error.message);
    return {
      engineId,
      status: "ERROR",
      output: null,
      durationMs: Date.now() - startTime,
      error: error.message,
    };
  }
}

async function writeStrategyMemoryEntries(
  config: OrchestratorConfig,
  results: Map<EngineId, EngineStepResult>,
  planId: string,
  planOutput?: any,
): Promise<void> {
  try {
    const entries: Array<{
      engineName: string;
      memoryType: MemoryClass;
      label: string;
      details: string;
    }> = [];

    const channel = results.get("channel_selection");
    if (channel?.status === "SUCCESS" && channel.output) {
      const out = channel.output.output || channel.output;
      const primaryName =
        out.primaryChannel?.channelName || out.primaryChannel?.name || null;
      if (primaryName) {
        const confidence = out.primaryChannel?.confidence ?? out.primaryChannel?.allocationPercentage ?? null;
        const secondary = out.secondaryChannel?.channelName || out.secondaryChannel?.name || "none";
        entries.push({
          engineName: "channel_selection",
          memoryType: "channel_decision",
          label: `Primary channel: ${primaryName}`,
          details: `confidence=${confidence !== null ? `${confidence}` : "N/A"}, role=${out.primaryChannel?.channelRole || out.primaryChannel?.role || "primary"}, secondary=${secondary}`,
        });
      }
    }

    const budget = results.get("budget_governor");
    if (budget?.status === "SUCCESS" && budget.output) {
      const decision = budget.output.decision || "APPROVED";
      entries.push({
        engineName: "budget_governor",
        memoryType: "budget_decision",
        label: `Budget decision: ${decision}`,
        details: budget.output.reasoning
          ? String(budget.output.reasoning).slice(0, 200)
          : `Governor decision: ${decision}`,
      });
    }

    const iteration = results.get("iteration");
    if (iteration?.status === "SUCCESS" && iteration.output) {
      const out = iteration.output.output || iteration.output;
      const targets = (out.optimizationTargets || []) as any[];
      const topTarget =
        targets[0]?.targetName || targets[0]?.target || null;
      if (topTarget) {
        entries.push({
          engineName: "iteration",
          memoryType: "iteration_direction",
          label: `Optimization target: ${topTarget}`,
          details: `hypotheses=${out.nextTestHypotheses?.length || 0}, targets=${targets.length}, planSteps=${out.iterationPlan?.length || 0}`,
        });
      }
    }

    const retention = results.get("retention");
    if (retention?.status === "SUCCESS" && retention.output) {
      const out = retention.output.output || retention.output;
      const loops = (out.retentionLoops || []) as any[];
      const topLoop = loops[0]?.loopName || loops[0]?.name || null;
      if (topLoop) {
        entries.push({
          engineName: "retention",
          memoryType: "retention_approach",
          label: `Retention loop: ${topLoop}`,
          details: `churnRisks=${out.churnRiskFlags?.length || 0}, ltvPaths=${out.ltvExpansionPaths?.length || 0}, confidence=${out.confidenceScore ?? "N/A"}`,
        });
      }
    }

    if (planOutput) {
      const dist = planOutput.contentDistribution;
      const method = dist?.primaryMethod || dist?.distributionMethod || dist?.strategy || null;
      if (method) {
        entries.push({
          engineName: "plan_synthesis",
          memoryType: "content_distribution",
          label: `Content distribution: ${method}`,
          details: `channelMix=${JSON.stringify(dist?.channelMix || dist?.allocation || {}).slice(0, 150)}`,
        });
      }
    }

    const mi = results.get("market_intelligence");
    if (mi?.status === "SUCCESS" && mi.output?.crossSignalDecisions) {
      const decisions = mi.output.crossSignalDecisions.decisions || [];
      const highConfDecisions = decisions.filter((d: any) => d.confidenceLevel === "HIGH");
      for (const d of highConfDecisions.slice(0, 5)) {
        entries.push({
          engineName: "market_intelligence",
          memoryType: "market_signal" as MemoryClass,
          label: `[${d.type}] ${d.signalText}`,
          details: `confidence=${d.confidenceScore}, agreement=${d.agreementType}, sources=${d.sources?.join(",")}, evidence=${d.supportingEvidenceCount}`,
        });
      }
    }

    const mutationResult = await applyMemoryMutation(config.campaignId, config.accountId, entries, planId);

    console.log(
      `[Orchestrator] MEMORY_WRITTEN | planId=${planId} | entries=${entries.length} | written=${mutationResult.written} | updated=${mutationResult.updated} | decayed=${mutationResult.decayed}`,
    );
  } catch (memErr: any) {
    console.warn(
      `[Orchestrator] MEMORY_WRITE_FAILED | error=${memErr.message}`,
    );
  }
}

export async function runOrchestrator(config: OrchestratorConfig): Promise<OrchestratorRunResult> {
  const startTime = Date.now();

  let jobId: string;
  let ctx: EngineContext = { inputHashes: {} };
  let previousSectionStatuses: any[] = [];

  ctx.ssc = createEmptySSC(config.campaignId, config.accountId);
  console.log(`[Orchestrator] SSC_INITIALIZED | campaignId=${config.campaignId} | accountId=${config.accountId}`);

  if (config.pausedJobId) {
    jobId = config.pausedJobId;
    const [pausedJob] = await db
      .select()
      .from(orchestratorJobs)
      .where(eq(orchestratorJobs.id, config.pausedJobId))
      .limit(1);

    if (pausedJob?.pausedContext) {
      try {
        ctx = JSON.parse(pausedJob.pausedContext);
        if (!ctx.inputHashes) {
          ctx.inputHashes = {};
          console.log(`[Orchestrator] INPUT_HASHES_RESTORED_EMPTY | job=${jobId} | reason=paused_context_missing_inputHashes`);
        }
        if (!ctx.ssc) {
          ctx.ssc = createEmptySSC(config.campaignId, config.accountId);
          console.log(`[Orchestrator] SSC_RESTORED_EMPTY | job=${jobId} | reason=paused_context_missing_ssc`);
        } else {
          console.log(`[Orchestrator] SSC_RESTORED | job=${jobId} | problems=${ctx.ssc.problemRegistry?.length || 0} | traceEntries=${ctx.ssc.reasonTrace?.length || 0}`);
        }
        console.log(`[Orchestrator] CONTEXT_RESTORED | job=${jobId} | keys=${Object.keys(ctx).join(",")}`);
      } catch {
        console.warn(`[Orchestrator] CONTEXT_RESTORE_FAILED | job=${jobId}`);
      }
    }
    if (pausedJob?.sectionStatuses) {
      try { previousSectionStatuses = JSON.parse(pausedJob.sectionStatuses); } catch {}
    }
    await db.update(orchestratorJobs)
      .set({ status: "RUNNING", completedAt: null, pausedEngine: null, needsInputFields: null })
      .where(eq(orchestratorJobs.id, jobId));
  } else {
    jobId = config.preassignedJobId || `orch_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    if (!config.preassignedJobId) {
      await db.insert(orchestratorJobs).values({
        id: jobId,
        blueprintId: "orchestrator-v2",
        accountId: config.accountId,
        campaignId: config.campaignId,
        status: "RUNNING",
        sectionStatuses: JSON.stringify(
          ENGINE_PRIORITY_ORDER.map(e => ({ id: e.id, name: e.name, status: "PENDING" }))
        ),
      });
    }
  }

  // Mirror the local jobId onto config so downstream callers (synthesizePlan,
  // engine adapters that read config.jobId) see the same run identifier as
  // the local executeEngine path. Without this assignment, plan persistence
  // inserts NULL into strategic_plans.job_id even though engine snapshots
  // get the right jobId via the local variable — leaving plans non-run-bound.
  config.jobId = jobId;

  const results = new Map<EngineId, EngineStepResult>();
  const completedEngines: string[] = [];
  let failedEngine: string | undefined;
  let blockReason: string | undefined;
  let overallStatus: "COMPLETED" | "PARTIAL" | "BLOCKED" | "ERROR" | "NEEDS_INPUT" = "COMPLETED";
  let needsInputPayload: NeedsInputPayload | undefined;

  let memoryContextBlock = "";
  let loadedMemoryBlock: import("../memory-system/types").MemoryBlock | null = null;
  try {
    const bizDataForMemory = await getBusinessData(config.accountId, config.campaignId).catch(() => null);
    const memBlock = await buildMemoryContext(config.campaignId, config.accountId, bizDataForMemory ? {
      funnelObjective: bizDataForMemory.funnelObjective,
      businessType: bizDataForMemory.businessType,
      monthlyBudget: bizDataForMemory.monthlyBudget,
    } : null);
    loadedMemoryBlock = memBlock;
    memoryContextBlock = serializeMemoryContextForPrompt(memBlock);
    if (memoryContextBlock) {
      ctx.memoryContext = memoryContextBlock;
      console.log(`[Orchestrator] MEMORY_CONTEXT_LOADED | reinforce=${memBlock.reinforceSlots.length} | avoid=${memBlock.avoidSlots.length} | pending=${memBlock.pendingSlots.length}`);
    }
  } catch (memLoadErr: any) {
    console.warn(`[Orchestrator] MEMORY_CONTEXT_LOAD_FAILED | error=${memLoadErr.message}`);
  }

  try {
    const [metricsRow] = await db
      .select()
      .from(manualCampaignMetrics)
      .where(and(eq(manualCampaignMetrics.accountId, config.accountId), eq(manualCampaignMetrics.campaignId, config.campaignId)))
      .limit(1);
    if (metricsRow) {
      const perfLineage = bridgePerformanceToLineage({
        impressions: metricsRow.impressions || 0,
        clicks: metricsRow.clicks || 0,
        conversions: metricsRow.conversions || 0,
        spend: metricsRow.spend || 0,
        revenue: metricsRow.revenue || 0,
      }, config.campaignId);
      if (perfLineage.length > 0) {
        ctx.performanceLineage = perfLineage;
        console.log(`[Orchestrator] PERFORMANCE_BRIDGE_LOADED | campaign=${config.campaignId} | realSignals=${perfLineage.length}`);
      }
    }
  } catch (perfErr: any) {
    console.warn(`[Orchestrator] PERFORMANCE_BRIDGE_FAILED | error=${perfErr.message}`);
  }

  const startIndex = config.resumeFromEngine
    ? ENGINE_PRIORITY_ORDER.findIndex(e => e.id === config.resumeFromEngine)
    : 0;

  const ENGINE_TIMEOUT_MS = 120_000; // 2-minute hard ceiling per engine

  // When scopedEngines is provided, execute ONLY those engines (selective rerun).
  // Loop starts at the earliest requested engine; per-loop check skips any engine NOT in the set.
  // Scoped reruns rely on DB-stored snapshots from the previous full run for non-scoped context.
  const scopedStartIndex = config.scopedEngines?.length
    ? Math.min(
        ...config.scopedEngines
          .map(id => ENGINE_PRIORITY_ORDER.findIndex(e => e.id === id))
          .filter(i => i >= 0),
      )
    : -1;

  const effectiveStartIndex = scopedStartIndex >= 0
    ? scopedStartIndex
    : startIndex >= 0 ? startIndex : 0;

  const scopedEngineSet = config.scopedEngines?.length
    ? new Set(config.scopedEngines)
    : null;

  if (scopedEngineSet && !ctx.audience) {
    try {
      const audRows = await db.select().from(audienceSnapshots)
        .where(and(
          eq(audienceSnapshots.accountId, config.accountId),
          eq(audienceSnapshots.campaignId, config.campaignId),
        ))
        .orderBy(desc(audienceSnapshots.createdAt))
        .limit(10);
      for (const row of audRows) {
        const ss = JSON.parse(row.structuredSignals || '{"pain_clusters":[],"desire_clusters":[],"pattern_clusters":[],"root_causes":[],"psychological_drivers":[]}');
        const signalCount = (ss.pain_clusters?.length || 0) + (ss.desire_clusters?.length || 0) +
          (ss.pattern_clusters?.length || 0) + (ss.root_causes?.length || 0) + (ss.psychological_drivers?.length || 0);
        if (signalCount > 0) {
          const cachedAudience = {
            ...row,
            // CANONICAL: emit `audiencePains` (not `painMap`). The
            // canonicalizeAudienceShape() call below also strips legacy aliases.
            audiencePains: JSON.parse(row.audiencePains || "[]"),
            desireMap: JSON.parse(row.desireMap || "[]"),
            objectionMap: JSON.parse(row.objectionMap || "[]"),
            transformationMap: JSON.parse(row.transformationMap || "[]"),
            emotionalDrivers: JSON.parse(row.emotionalDrivers || "[]"),
            audienceSegments: JSON.parse(row.audienceSegments || "[]"),
            segmentDensity: JSON.parse(row.segmentDensity || "[]"),
            awarenessLevel: JSON.parse(row.awarenessLevel || "{}"),
            maturityIndex: JSON.parse(row.maturityIndex || "{}"),
            intentDistribution: JSON.parse(row.audienceIntentDistribution || "{}"),
            structuredSignals: ss,
            inputSummary: JSON.parse(row.inputSummary || "{}"),
            snapshotId: row.id,
          };
          ctx.audience = canonicalizeAudienceShape(cachedAudience);
          ctx.audienceSnapshotId = row.id;
          console.log(`[Orchestrator] SCOPED_HYDRATE | Loaded cached audience snapshot=${row.id} | structuredSignals=${signalCount}`);

          const rawObjections = cachedAudience.objectionMap || [];
          const mappedObjections = rawObjections.map((o: any) => ({
            label: o.label ?? o.canonical ?? o.pain ?? o.signal ?? "",
            confidence: o.confidence ?? o.confidenceScore ?? 0.5,
            evidence: Array.isArray(o.evidence) ? o.evidence : [],
          }));
          ctx.sglState = initializeSignalGovernance(ss, mappedObjections);
          console.log(`[Orchestrator] SCOPED_SGL | signals=${ctx.sglState.governedSignals.length} | trace=${ctx.sglState.traceToken}`);
          break;
        }
      }
    } catch (hydErr: any) {
      console.warn(`[Orchestrator] SCOPED_HYDRATE_FAILED | ${hydErr.message}`);
    }
  }

  if (scopedEngineSet && !ctx.mi) {
    try {
      const [latestMi] = await db.select().from(miSnapshots)
        .where(and(
          eq(miSnapshots.accountId, config.accountId),
          eq(miSnapshots.campaignId, config.campaignId),
          eq(miSnapshots.status, "COMPLETE"),
        ))
        .orderBy(desc(miSnapshots.createdAt))
        .limit(1);
      if (latestMi) {
        ctx.mi = {
          ...latestMi,
          signals: JSON.parse(latestMi.signalData?.toString() || "[]"),
          multiSourceSignals: latestMi.multiSourceSignals || "{}",
          snapshotId: latestMi.id,
        };
        ctx.miSnapshotId = latestMi.id;
        console.log(`[Orchestrator] SCOPED_HYDRATE | Loaded cached MI snapshot=${latestMi.id} | confidence=${latestMi.overallConfidence}`);
      }
    } catch (miHydErr: any) {
      console.warn(`[Orchestrator] SCOPED_MI_HYDRATE_FAILED | ${miHydErr.message}`);
    }
  }

  for (let i = effectiveStartIndex; i < ENGINE_PRIORITY_ORDER.length; i++) {
    const engineDef = ENGINE_PRIORITY_ORDER[i];

    // When scopedEngines is provided, skip any engine NOT in the requested scope
    if (scopedEngineSet && !scopedEngineSet.has(engineDef.id)) {
      console.log(`[Orchestrator] SCOPED_SKIP | Skipping ${engineDef.name} (not in scopedEngines)`);
      results.set(engineDef.id as EngineId, { engineId: engineDef.id as EngineId, status: "SKIPPED", output: null, durationMs: 0 });
      continue;
    }

    console.log(`[Orchestrator] Running engine ${i + 1}/${ENGINE_PRIORITY_ORDER.length}: ${engineDef.name}`);

    let preEngineProblems: ProblemEntry[] = [];
    if (ctx.ssc) {
      preEngineProblems = logRelevantProblems(ctx.ssc, engineDef.id);
    }

    let stepResult = await Promise.race([
      executeEngine(engineDef.id, ctx, config, results, jobId),
      new Promise<EngineStepResult>((resolve) =>
        setTimeout(() => {
          console.warn(`[Orchestrator] ENGINE_TIMEOUT | ${engineDef.name} exceeded ${ENGINE_TIMEOUT_MS / 1000}s — marking TIMEOUT`);
          resolve({
            engineId: engineDef.id,
            status: "TIMEOUT",
            output: null,
            durationMs: ENGINE_TIMEOUT_MS,
            error: `Engine timed out after ${ENGINE_TIMEOUT_MS / 1000}s`,
          });
        }, ENGINE_TIMEOUT_MS)
      ),
    ]);

    if (ctx.ssc && (stepResult.status === "SUCCESS" || stepResult.status === "PARTIAL")) {
      updateSSCAfterEngine(ctx.ssc, engineDef.id, stepResult, i);
      enforceProblemsPostEngine(ctx.ssc, engineDef.id, stepResult, preEngineProblems, i);

      const gateResult = checkMidPipelineGate(engineDef.id, stepResult, ctx);
      if (gateResult?.gateFailed) {
        if (gateResult.setConfidenceFloor !== undefined) {
          ctx.ssc.confidenceFloor = gateResult.setConfidenceFloor;
          console.log(`[Orchestrator] SSC_FLOOR_OVERRIDE | engine=${engineDef.id} | newFloor=${gateResult.setConfidenceFloor} | reason=${gateResult.reason}`);
        }

        // U5c cutover — single source of truth for gate-retry policy.
        // Bit-for-bit equivalent to the prior inline policy (proven by
        // .local/validation/retry-policy-shadow.ts, 180/180 parity).
        const retryDecision = planRetry({
          engineId: engineDef.id,
          gateShouldRetry: gateResult.shouldRetry,
          gateSeverity: gateResult.severity,
          missingFieldId: gateResult.missingFieldId,
        });

        // R2a (May 2026, OBSERVATION ONLY) — log a shadow recommendation
        // showing what `planRetry` WOULD return if the pilot field were
        // registered as critical in `FIELD_IMPORTANCE_REGISTRY`. The
        // production decision (`retryDecision` above) is unchanged because
        // the registry stays empty. The shadow helper does not mutate the
        // registry. Pilot field selected per the R1 audit
        // (`.local/plans/field-importance-audit.md` §6) — `offer.painAlignment`
        // is the highest-confidence critical field that actively triggers
        // a retry-bearing gate today, making the comparison meaningful.
        try {
          const shadow = computeShadowRetryRecommendation({
            engineId: engineDef.id,
            gateShouldRetry: gateResult.shouldRetry,
            gateSeverity: gateResult.severity,
            missingFieldId: gateResult.missingFieldId,
            pilotField: "offer.painAlignment",
            pilotOwningEngine: "offer",
          });
          console.log(
            `[ShadowRetry] engine=${engineDef.id} ` +
            `field=${shadow.field} owningEngine=${shadow.owningEngine} ` +
            `importance=${shadow.importance} matchedPilot=${shadow.matchedPilot} ` +
            `wouldRetry=${shadow.wouldRetry} wouldWiden=${shadow.wouldWiden} ` +
            `budgetAxisWidened=${shadow.budgetAxisWidened} ` +
            `current={retry=${shadow.current.retry},maxAttempts=${shadow.current.maxAttempts},onFinalFailure=${shadow.current.onFinalFailure}} ` +
            `weighted={retry=${shadow.weighted.retry},maxAttempts=${shadow.weighted.maxAttempts},onFinalFailure=${shadow.weighted.onFinalFailure}} ` +
            `reason="${shadow.reason}"`
          );
        } catch (err) {
          // Shadow path must never affect production. Swallow defensively.
          console.warn(`[ShadowRetry] error (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
        }

        if (retryDecision.retry) {
          console.log(`[Orchestrator] MID_PIPELINE_GATE_RETRY | engine=${engineDef.id} | reason=${gateResult.reason} | policy=${retryDecision.rationale}`);
          const retryResult = await Promise.race([
            executeEngine(engineDef.id, ctx, config, results, jobId),
            new Promise<EngineStepResult>((resolve) =>
              setTimeout(() => resolve({
                engineId: engineDef.id, status: "TIMEOUT", output: null, durationMs: ENGINE_TIMEOUT_MS,
                error: `Retry timed out after ${ENGINE_TIMEOUT_MS / 1000}s`,
              }), ENGINE_TIMEOUT_MS)
            ),
          ]);

          const retryGate = checkMidPipelineGate(engineDef.id, retryResult, ctx);
          if (retryGate?.gateFailed) {
            registerProblem(ctx.ssc, engineDef.id as EngineIdType, "structural", gateResult.reason, gateResult.severity, 1.0,
              ENGINE_PRIORITY_ORDER.slice(i + 1).map(e => e.id) as EngineIdType[], i);
            console.warn(`[Orchestrator] MID_PIPELINE_GATE_HALT | engine=${engineDef.id} | reason=${gateResult.reason} | retryAlsoFailed=true | action=HALTING_PIPELINE`);
            if (retryGate.setConfidenceFloor !== undefined) {
              ctx.ssc.confidenceFloor = retryGate.setConfidenceFloor;
            }
            if (retryDecision.onFinalFailure === "BLOCK") {
              failedEngine = engineDef.name;
              blockReason = `Critical gate failure after retry: ${gateResult.reason}`;
              overallStatus = "BLOCKED";
              results.set(engineDef.id, retryResult);
              break;
            }
          } else {
            console.log(`[Orchestrator] MID_PIPELINE_GATE_RETRY_PASSED | engine=${engineDef.id} | retry succeeded`);
          }

          stepResult = retryResult;
          if (retryResult.status === "SUCCESS" || retryResult.status === "PARTIAL") {
            updateSSCAfterEngine(ctx.ssc, engineDef.id, retryResult, i);
          }
        } else {
          registerProblem(ctx.ssc, engineDef.id as EngineIdType, "structural", gateResult.reason, gateResult.severity, 1.0,
            ENGINE_PRIORITY_ORDER.slice(i + 1).map(e => e.id) as EngineIdType[], i);
          console.warn(`[Orchestrator] MID_PIPELINE_GATE_FAILED | engine=${engineDef.id} | reason=${gateResult.reason} | noRetry=true | policy=${retryDecision.rationale}`);
          if (retryDecision.onFinalFailure === "BLOCK") {
            failedEngine = engineDef.name;
            blockReason = `Critical gate failure (no retry): ${gateResult.reason}`;
            overallStatus = "BLOCKED";
            results.set(engineDef.id, stepResult);
            break;
          }
        }
      }
    }

    results.set(engineDef.id, stepResult);

    // Phase C2 (May 2026) — shadow contract audit. Logs `[ContractAudit]`
    // violations behind the ENFORCE_ENGINE_CONTRACTS env flag. Today the
    // flag defaults to false, so this is OBSERVATION ONLY; engine status
    // is never mutated. Audit is wrapped in a defensive try/catch inside
    // the helper itself — it cannot throw out of here.
    auditEngineContract(engineDef.id as EngineId, stepResult, {
      jobId,
      campaignId: config.campaignId ?? null,
    });

    const sectionStatuses = ENGINE_PRIORITY_ORDER.map(e => {
      const r = results.get(e.id);
      // eslint-disable-next-line semantic/no-semantic-fallback -- D (H8): dashboard UI default — section status PENDING when engine has not produced result yet
      const status = r?.status || "PENDING";
      return {
        id: e.id,
        name: e.name,
        status,
        summary: r ? summarizeEngine(e.id, r.output, status, r.blockReason) : null,
      };
    });
    await db.update(orchestratorJobs)
      .set({ sectionStatuses: JSON.stringify(sectionStatuses) })
      .where(eq(orchestratorJobs.id, jobId));

    config.onProgress?.({
      engineId: engineDef.id,
      engineName: engineDef.name,
      tier: engineDef.tier,
      status: stepResult.status,
      engineIndex: i + 1,
      totalEngines: ENGINE_PRIORITY_ORDER.length,
      durationMs: stepResult.durationMs,
      output: stepResult.output,
      blockReason: stepResult.blockReason,
    });

    if (stepResult.status === "SUCCESS" || stepResult.status === "PARTIAL") {
      completedEngines.push(engineDef.name);
      console.log(`[Orchestrator] ${engineDef.name} completed in ${stepResult.durationMs}ms`);
    } else if (stepResult.status === "NEEDS_INPUT") {
      needsInputPayload = stepResult.needsInput;
      overallStatus = "NEEDS_INPUT";
      console.log(`[Orchestrator] NEEDS_INPUT at ${engineDef.name} | missing=${needsInputPayload?.missingFields.join(",")}`);

      const ctxToSave: any = { ...ctx };
      delete ctxToSave.integrityReport;
      delete ctxToSave.sglState;

      const sectionStatuses = ENGINE_PRIORITY_ORDER.map(e => {
        const r = results.get(e.id);
        // eslint-disable-next-line semantic/no-semantic-fallback -- D (H8): dashboard UI default — section status PENDING when engine has not produced result yet
        const st = r?.status || "PENDING";
        return { id: e.id, name: e.name, status: st, summary: r ? summarizeEngine(e.id, r.output, st, r.blockReason) : null };
      });

      await db.update(orchestratorJobs)
        .set({
          status: "NEEDS_INPUT",
          pausedEngine: engineDef.id,
          pausedContext: JSON.stringify(ctxToSave),
          needsInputFields: JSON.stringify(needsInputPayload),
          sectionStatuses: JSON.stringify(sectionStatuses),
          completedAt: new Date(),
        })
        .where(eq(orchestratorJobs.id, jobId));

      break;
    } else if (stepResult.status === "BLOCKED" || stepResult.status === "ERROR" || stepResult.status === "BLOCKED_BY_INTEGRITY") {
      if (shouldBlockDownstream(stepResult)) {
        failedEngine = engineDef.name;
        blockReason = stepResult.blockReason || stepResult.error || "Engine produced blocking result";
        overallStatus = stepResult.status === "BLOCKED_BY_INTEGRITY" ? "BLOCKED_BY_INTEGRITY" : "BLOCKED";
        console.warn(`[Orchestrator] ${overallStatus} at ${engineDef.name}: ${blockReason}`);
        break;
      } else {
        completedEngines.push(`${engineDef.name} (${stepResult.status})`);
        if (overallStatus === "COMPLETED") overallStatus = "PARTIAL";
      }
    } else if (stepResult.status === "SKIPPED") {
      console.log(`[Orchestrator] ${engineDef.name} skipped: ${stepResult.blockReason}`);
      if (overallStatus === "COMPLETED") overallStatus = "PARTIAL";
    }
  }

  if (overallStatus === "NEEDS_INPUT") {
    const durationMs = Date.now() - startTime;
    return { jobId, status: "NEEDS_INPUT", completedEngines, durationMs, results, needsInput: needsInputPayload };
  }

  if (ctx.ssc) {
    const unresolvedCritical = getUnresolvedCriticalProblems(ctx.ssc);
    const totalProblems = ctx.ssc.problemRegistry.length;
    const openProblems = ctx.ssc.problemRegistry.filter(p => p.status === "open").length;
    const resolvedProblems = ctx.ssc.problemRegistry.filter(p => p.status === "resolved").length;
    const deferredProblems = ctx.ssc.problemRegistry.filter(p => p.status === "deferred").length;
    const cannotResolveProblems = ctx.ssc.problemRegistry.filter(p => p.status === "cannot_resolve").length;
    console.log(`[Orchestrator] SSC_PIPELINE_SUMMARY | floor=${ctx.ssc.confidenceFloor.toFixed(2)} | chainLength=${ctx.ssc.confidenceChain.length} | problems=${totalProblems} (open=${openProblems} resolved=${resolvedProblems} deferred=${deferredProblems} cannot_resolve=${cannotResolveProblems}) | criticalUnresolved=${unresolvedCritical.length} | contradictions=${ctx.ssc.contradictions.length} | traceEntries=${ctx.ssc.reasonTrace.length} | awareness=${ctx.ssc.awarenessMeaning?.stage || "none"}`);

    if (unresolvedCritical.length > 0) {
      for (const p of unresolvedCritical) {
        console.error(`[Orchestrator] SSC_UNRESOLVED_CRITICAL | id=${p.id} | source=${p.sourceEngine} | severity=${p.severity} | desc=${p.description} | status=${p.status}`);
      }
      if (overallStatus === "COMPLETED") {
        overallStatus = "PARTIAL";
        console.warn(`[Orchestrator] SSC_STATUS_DOWNGRADE | COMPLETED→PARTIAL | reason=${unresolvedCritical.length} critical problems remain open`);
      }
    }

    for (const p of ctx.ssc.problemRegistry.filter(pr => pr.status === "open" && pr.severity !== "low")) {
      markCannotResolve(ctx.ssc, p.id, "pipeline_end" as any,
        `Problem remained open through entire pipeline — no engine resolved or explicitly deferred`);
      console.warn(`[Orchestrator] SSC_PROBLEM_FORCE_CLOSED | id=${p.id} | severity=${p.severity} | desc=${p.description} | status=cannot_resolve | reason=pipeline_exhausted`);
    }

    const criticalCannotResolve = ctx.ssc.problemRegistry.filter(
      p => p.status === "cannot_resolve" && p.severity === "critical"
    );
    if (criticalCannotResolve.length > 0) {
      for (const p of criticalCannotResolve) {
        console.error(`[Orchestrator] SSC_CRITICAL_CANNOT_RESOLVE | id=${p.id} | source=${p.sourceEngine} | by=${p.cannotResolveBy} | desc=${p.description} | reason=${p.cannotResolveReason}`);
      }
      if (overallStatus !== "BLOCKED") {
        failedEngine = failedEngine || criticalCannotResolve[0].sourceEngine;
        blockReason = `${criticalCannotResolve.length} critical problem(s) structurally unresolvable: ${criticalCannotResolve.map(p => p.description).join("; ")}`;
        overallStatus = "BLOCKED";
        console.error(`[Orchestrator] SSC_STATUS_ESCALATION | →BLOCKED | reason=${blockReason}`);
      }
    }

    for (const p of ctx.ssc.problemRegistry) {
      if (p.status === "cannot_resolve") {
        console.warn(`[Orchestrator] SSC_PROBLEM_FINAL | id=${p.id} | severity=${p.severity} | status=cannot_resolve | by=${p.cannotResolveBy} | reason=${p.cannotResolveReason}`);
      } else if (p.status === "deferred") {
        console.log(`[Orchestrator] SSC_PROBLEM_FINAL | id=${p.id} | severity=${p.severity} | status=deferred | by=${p.deferredBy} | reason=${p.deferredReason}`);
      } else if (p.status === "resolved") {
        console.log(`[Orchestrator] SSC_PROBLEM_FINAL | id=${p.id} | severity=${p.severity} | status=resolved | by=${p.resolvedBy} | action=${p.resolvedAction}`);
      }
    }
  }

  try {
    const engineOutputs: Record<string, any> = {};
    for (const [eid, result] of results) {
      engineOutputs[eid] = result.output;
    }
    ctx.integrityReport = runSystemIntegrityValidation(engineOutputs, ctx.sglState || null);
    storeIntegrityReport(config.campaignId, config.accountId, ctx.integrityReport);
    console.log(`[Orchestrator] INTEGRITY_REPORT | status=${ctx.integrityReport.overallStatus} | failures=${ctx.integrityReport.failureReasons.length}`);
  } catch (sivErr: any) {
    console.warn(`[Orchestrator] SIV_FAILED | error=${sivErr.message}`);
  }

  if (ctx.sglState) {
    const sglSummary = getGovernanceSummary(ctx.sglState);
    console.log(`[Orchestrator] SGL_SUMMARY | signals=${sglSummary.totalSignals} | enginesServed=${sglSummary.enginesServed.length} | coverage=${sglSummary.coverage.coverageSufficient}`);
  }

  let controlVerdict: SystemControlVerdict | null = null;
  try {
    const sglSummaryData = ctx.sglState ? getGovernanceSummary(ctx.sglState) : null;
    controlVerdict = evaluateSystemControl({
      results,
      integrityReport: ctx.integrityReport || null,
      celResults: ctx.celResults || [],
      signalComposition: ctx.signalComposition || null,
      sglCoverageSufficient: sglSummaryData?.coverage?.coverageSufficient ?? null,
      ssc: ctx.ssc || null,
      config: { campaignId: config.campaignId, accountId: config.accountId, currentJobId: jobId },
    });
    // ── COMMERCIAL REASONING: systemJudgement (Phase 2 May 2026) ──
    // Runs AFTER deterministic evaluateSystemControl so the principal's commercial
    // call is computed against the full structural verdict + all upstream signals.
    try {
      if (controlVerdict && ctx.ssc) {
        const sv = ctx.statisticalValidation || {};
        const bg = ctx.budgetGovernor || {};
        const cs = ctx.channelSelection || {};
        const fn = ctx.funnel || {};
        const dnaPresent = Object.values(ctx.ssc.commercialSignals || {}).filter(Boolean).length;
        const cj = await designSystemJudgement({
          verdict: controlVerdict.verdict,
          proposedExecutionMode: controlVerdict.executionMode,
          blockReasons: controlVerdict.blockReasons,
          downgrades: controlVerdict.downgrades,
          contradictions: controlVerdict.contradictions,
          repairActions: controlVerdict.repairActions,
          // Phase R T001: anything not status==="PASS" is non-passing for
          // attribution purposes (FAIL, BLOCK, NOT_REACHED, TIMEOUT, STALE,
          // UNKNOWN, SKIPPED). Legacy boolean `passed` is only consulted
          // when status is absent.
          structuralChecksFailed: (controlVerdict.structuralChecks || [])
            .filter((c: any) => c && (c.status ? c.status !== "PASS" : c.passed === false))
            .map((c: any) => c.check || c.details || "(unnamed)"),
          validationState: (sv as any).validationState || null,
          budgetAction: (bg as any).decision?.action || null,
          channelConfidence: typeof (cs as any).confidenceScore === "number" ? (cs as any).confidenceScore : null,
          signalBackedRatio: typeof (sv as any).signalBackedClaimRatio === "number" ? (sv as any).signalBackedClaimRatio : null,
          funnelStrength: typeof (fn as any).funnelStrengthScore === "number" ? (fn as any).funnelStrengthScore : null,
          commercialDnaPresent: Math.min(dnaPresent, 5),
          accountId: config.accountId,
        });
        if (cj) {
          controlVerdict.commercialJudgement = cj;
          emitCommercialSignal(ctx.ssc, "systemJudgement", {
            verdict: cj.verdict,
            recommendedExecutionMode: cj.recommendedExecutionMode,
            commercialReadinessAssessment: cj.commercialReadinessAssessment,
            biggestRisk: cj.biggestRisk,
            conditionsToUpgrade: cj.conditionsToUpgrade,
            principalCall: cj.principalCall,
            judgeVerdict: cj.judgeVerdict,
            emittedAt: Date.now(),
          });
        }
      }
    } catch (cjErr: any) {
      console.warn(`[Orchestrator] SYSTEM_CONTROL_COMMERCIAL_FAILED | ${cjErr.message}`);
    }

    // ── UNIVERSAL RECOVERY PLAN (Phase 3 May 2026) ──
    // Runs AFTER deterministic verdict + commercial judgement. Generates a
    // structured, ownership-assigned, priority-ordered repair plan for any
    // BLOCKED verdict. Pure deterministic v1 (registry-driven), null-safe,
    // never weakens enforcement.
    try {
      if (controlVerdict && controlVerdict.verdict === "BLOCK") {
        const { buildRecoveryPlan } = await import("../system-control/recovery-planner");
        let plan = buildRecoveryPlan(controlVerdict, {
          campaignId: config.campaignId,
          accountId: config.accountId,
          results,
          ssc: ctx.ssc,
        });
        if (plan) {
          // ── RECOVERY INTELLIGENCE ENRICHMENT (Phase 3 May 2026) ──
          // Strategist overlay: designer + judge + 1 retry + null fallback to
          // deterministic plan. Never weakens enforcement. See
          // server/system-control/recovery-intelligence.ts.
          try {
            const { enrichRecoveryPlan } = await import("../system-control/recovery-intelligence");
            plan = await enrichRecoveryPlan(plan, {
              campaignId: config.campaignId,
              accountId: config.accountId,
              results,
            });
          } catch (enrErr: any) {
            console.warn(`[Orchestrator] RECOVERY_INTELLIGENCE_FAILED | ${enrErr.message} | shipping deterministic plan`);
          }
          controlVerdict.recoveryPlan = plan;
          console.log(`[Orchestrator] RECOVERY_PLAN_BUILT | issues=${plan.issues.length} | humanReview=${plan.humanReviewNeeded} | source=${plan.source} | intelligence=${plan.intelligence ? plan.intelligence.commercialDisease : "none"}`);
        }
      }
    } catch (rpErr: any) {
      console.warn(`[Orchestrator] RECOVERY_PLAN_FAILED | ${rpErr.message}`);
    }

    storeControlVerdict(config.accountId, config.campaignId, jobId, controlVerdict)
      .then(id => console.log(`[Orchestrator] CONTROL_VERDICT_STORED | id=${id} | verdict=${controlVerdict!.verdict}`))
      .catch(err => console.warn(`[Orchestrator] CONTROL_VERDICT_STORE_FAILED | error=${err.message}`));
  } catch (ctrlErr: any) {
    console.warn(`[Orchestrator] SYSTEM_CONTROL_FAILED | error=${ctrlErr.message}`);
  }

  if (controlVerdict && controlVerdict.verdict === "BLOCK" && overallStatus !== "BLOCKED") {
    overallStatus = "BLOCKED";
    const blockCodes = controlVerdict.blockReasons.map(b => b.code).join(", ");
    failedEngine = "system_control";
    blockReason = `System Control Layer blocked execution: ${blockCodes}`;
    console.warn(`[Orchestrator] SYSTEM_CONTROL_BLOCK | overallStatus overridden to BLOCKED | reasons=${blockCodes}`);
  }

  if (controlVerdict && controlVerdict.verdict === "REPAIR") {
    const successfulRepairs = controlVerdict.repairActions.filter(a => a.succeeded);
    const failedRepairs = controlVerdict.repairActions.filter(a => a.executed && !a.succeeded);
    console.log(`[Orchestrator] SYSTEM_CONTROL_REPAIR | succeeded=${successfulRepairs.length} failed=${failedRepairs.length} | actions=${successfulRepairs.map(a => a.code).join(", ")}`);
    if (overallStatus === "COMPLETED") overallStatus = "PARTIAL";
  }

  if (controlVerdict && (controlVerdict.verdict === "DOWNGRADE" || controlVerdict.verdict === "REPAIR") && controlVerdict.downgrades.length > 0) {
    const budgetResult = results.get("budget_governor");
    if (budgetResult?.output?.decision) {
      const originalAction = budgetResult.output.decision.originalAction || budgetResult.output.decision.action;
      const DOWNGRADE_SEVERITY: Record<string, number> = { hold: 0, test: 1, scale: 2 };
      const targetAction = controlVerdict.downgrades.reduce((most, d) =>
        (DOWNGRADE_SEVERITY[d.to] ?? 99) < (DOWNGRADE_SEVERITY[most] ?? 99) ? d.to : most,
        controlVerdict.downgrades[0].to
      );
      if (budgetResult.output.decision.downgradedBy !== "system_control_repair") {
        budgetResult.output.decision.action = targetAction;
        budgetResult.output.decision.originalAction = originalAction;
        budgetResult.output.decision.downgradedBy = "system_control";
        budgetResult.output.decision.downgradeReasons = controlVerdict.downgrades.map(d => d.code);
        console.log(`[Orchestrator] SYSTEM_CONTROL_DOWNGRADE | budget action ${originalAction}→${targetAction} | reasons=${controlVerdict.downgrades.map(d => d.code).join(", ")}`);
      }
    }
  }

  let planId: string | undefined;

  if (overallStatus !== "BLOCKED") {
    try {
      const planResult = await synthesizePlan(config, ctx, results, memoryContextBlock || undefined, loadedMemoryBlock);
      planId = planResult.planId;
      if (planId) {
        await writeStrategyMemoryEntries(config, results, planId, planResult.plan);
      }
    } catch (err: any) {
      console.error(`[Orchestrator] Plan synthesis failed:`, err.message);
      if (overallStatus === "COMPLETED") overallStatus = "PARTIAL";
    }
  }

  const durationMs = Date.now() - startTime;
  await db.update(orchestratorJobs)
    .set({
      status: overallStatus,
      planId: planId || null,
      durationMs,
      completedAt: new Date(),
      error: failedEngine ? `Blocked at ${failedEngine}: ${blockReason}` : null,
      pausedContext: null,
      pausedEngine: null,
      needsInputFields: null,
      sectionStatuses: JSON.stringify(
        ENGINE_PRIORITY_ORDER.map(e => {
          const r = results.get(e.id);
          // eslint-disable-next-line semantic/no-semantic-fallback -- D (H8): dashboard UI default — section status PENDING when engine has not produced result yet
          const status = r?.status || "PENDING";
          return {
            id: e.id,
            name: e.name,
            status,
            summary: r ? summarizeEngine(e.id, r.output, status, r.blockReason) : null,
          };
        })
      ),
    })
    .where(eq(orchestratorJobs.id, jobId));

  if (ctx.celResults && ctx.celResults.length > 0) {
    const celReport = buildCELReport(config.campaignId, 2, ctx.celResults);
    storeCELReport(config.campaignId, config.accountId, celReport);
    console.log(`[Orchestrator] CEL_REPORT | overall=${celReport.overallPassed ? "PASS" : "FAIL"} | score=${celReport.overallScore} | engines=${celReport.engineResults.length} | summary=${celReport.summary}`);
    for (const er of celReport.engineResults) {
      if (er.violations.length > 0) {
        console.log(`[Orchestrator] CEL_ENGINE | ${er.engineId} | score=${er.score.toFixed(2)} | violations=${er.violations.length} | types=${er.violations.map(v => v.violationType).join(",")}`);
      }
    }
  }

  console.log(`[Orchestrator] Complete in ${durationMs}ms | Status: ${overallStatus} | Engines: ${completedEngines.length}/${ENGINE_PRIORITY_ORDER.length}`);

  // ── PHASE 6: Compose Commercial DNA from all engine signals ──
  // Pure projection — no AI, no I/O. Available on the orchestrator return
  // shape so downstream consumers (content engines, funnel architect, channel
  // selector) get the unified strategic backbone in one read.
  let commercialDna: any = null;
  try {
    const { composeCommercialDNA } = await import("../../shared/commercial-dna");
    commercialDna = composeCommercialDNA(config.campaignId, ctx.ssc?.commercialSignals || null);
    console.log(`[Orchestrator] COMMERCIAL_DNA_COMPOSED | engines=${commercialDna.consistency.contributingEngineCount}/5 | full=${commercialDna.consistency.hasFullDna} | contradictions=${commercialDna.consistency.contradictions.length}`);
    if (commercialDna.consistency.contradictions.length > 0) {
      for (const c of commercialDna.consistency.contradictions) {
        console.warn(`[Orchestrator] DNA_CONTRADICTION | ${c}`);
      }
    }
  } catch (dnaErr: any) {
    console.warn(`[Orchestrator] COMMERCIAL_DNA_COMPOSE_FAILED | ${dnaErr.message}`);
  }

  return {
    jobId,
    status: overallStatus,
    completedEngines,
    failedEngine,
    blockReason,
    planId,
    results,
    durationMs,
    controlVerdict: controlVerdict || undefined,
    ssc: ctx.ssc || null,
    commercialDna,
  };
}

export async function getOrchestratorStatus(jobId: string) {
  const [job] = await db
    .select()
    .from(orchestratorJobs)
    .where(eq(orchestratorJobs.id, jobId))
    .limit(1);

  if (!job) return null;

  let needsInput: any = null;
  if (job.status === "NEEDS_INPUT" && job.needsInputFields) {
    try { needsInput = JSON.parse(job.needsInputFields); } catch {}
  }

  return {
    id: job.id,
    status: job.status,
    campaignId: job.campaignId,
    planId: job.planId,
    durationMs: job.durationMs,
    error: job.error,
    sections: job.sectionStatuses ? JSON.parse(job.sectionStatuses) : [],
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    pausedEngine: job.pausedEngine || null,
    needsInput,
  };
}

export async function getLatestOrchestratorRun(accountId: string, campaignId: string) {
  const [job] = await db
    .select()
    .from(orchestratorJobs)
    .where(
      and(
        eq(orchestratorJobs.accountId, accountId),
        eq(orchestratorJobs.campaignId, campaignId)
      )
    )
    .orderBy(desc(orchestratorJobs.createdAt))
    .limit(1);

  return job || null;
}
