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
import type { SystemControlVerdict } from "../system-control/types";
import { storeControlVerdict } from "../system-control/routes";
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
import { runAudienceEngine } from "../audience-engine/engine";
import { runPositioningEngine } from "../positioning-engine/engine";
import { runDifferentiationEngine } from "../differentiation-engine/engine";
import { runMechanismEngine } from "../mechanism-engine/engine";
import { runOfferEngine } from "../offer-engine/engine";
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
  status: "COMPLETED" | "PARTIAL" | "BLOCKED" | "ERROR" | "NEEDS_INPUT";
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
  mi?: any;
  audience?: any;
  positioning?: any;
  differentiation?: any;
  mechanism?: any;
  mechanismSnapshotId?: string;
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

  const rawSignals: any[] = out.signals || [];
  const taggedSignals = rawSignals.map((s: any) => {
    if (typeof s === "string") return { text: s, originType: "competitor" as const };
    return { text: s.text || s.signal || s.name || JSON.stringify(s), originType: s.originType || "competitor" as const };
  });

  return {
    competitors: out.competitors || [],
    signals: rawSignals,
    taggedSignals,
    dominance: miResult.dominanceData || [],
    trajectory: miResult.trajectoryData || null,
    marketState: out.marketState || null,
    confidence: out.overallConfidence || null,
  };
}

function extractAudienceInput(audienceResult: any): any {
  if (!audienceResult) return {};
  return {
    painProfiles: audienceResult.painProfiles || [],
    desireMap: audienceResult.desireMap || [],
    objectionMap: audienceResult.objectionMap || [],
    transformationMap: audienceResult.transformationMap || [],
    emotionalDrivers: audienceResult.emotionalDrivers || [],
    segments: audienceResult.audienceSegments || [],
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
    coreOutcome: primary.coreOutcome || primary.outcome || offerResult.coreOutcome || null,
    mechanismDescription: primary.mechanismDescription || offerResult.mechanismDescription || null,
    headline: primary.headline || offerResult.headline || null,
    deliverables: Array.isArray(primary.deliverables) ? primary.deliverables : (Array.isArray(offerResult.deliverables) ? offerResult.deliverables : []),
    riskReducers: Array.isArray(primary.riskReducers) ? primary.riskReducers : (Array.isArray(offerResult.riskReducers) ? offerResult.riskReducers : []),
    riskNotes: Array.isArray(primary.riskNotes) ? primary.riskNotes : (Array.isArray(offerResult.riskNotes) ? offerResult.riskNotes : []),
    proofAlignment: Array.isArray(primary.proofAlignment) ? primary.proofAlignment : (Array.isArray(offerResult.proofAlignment) ? offerResult.proofAlignment : []),
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
    proofPlacements: (() => { const pp = funnelResult.proofPlacementLogic?.placements || primary.proofPlacements || []; if (Array.isArray(pp)) return pp; if (typeof pp === 'string') { try { return JSON.parse(pp); } catch { return []; } } return []; })(),
    frictionMap: primary.frictionMap || funnelResult.frictionMap || [],
    commitmentLevel: primary.commitmentLevel || funnelResult.commitmentLevel || "medium",
    entryTrigger: primary.entryTrigger || funnelResult.entryTrigger || { mechanismType: "unknown", purpose: "unknown" },
    funnelStrengthScore: funnelResult.funnelStrengthScore ?? primary.funnelStrengthScore ?? 0,
    boundaryCheck: funnelResult.boundaryCheck || null,
    snapshotId: funnelResult.snapshotId || null,
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
    const pains = audienceResult.painProfiles || [];
    for (const p of pains.slice(0, 5)) {
      const text = typeof p === "string" ? p : p.pain || p.name || p.label || JSON.stringify(p);
      entries.push(createSourceLineageEntry("audience", "pain", text, idx++, audOrigin));
    }
    const desires = audienceResult.desireMap || [];
    for (const d of desires.slice(0, 5)) {
      const text = typeof d === "string" ? d : d.desire || d.name || d.label || JSON.stringify(d);
      entries.push(createSourceLineageEntry("audience", "desire", text, idx++, audOrigin));
    }
    const objections = audienceResult.objectionMap || [];
    for (const o of objections.slice(0, 3)) {
      const text = typeof o === "string" ? o : o.objection || o.name || o.label || JSON.stringify(o);
      entries.push(createSourceLineageEntry("audience", "objection", text, idx++, audOrigin));
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

async function executeEngine(
  engineId: EngineId,
  ctx: EngineContext,
  config: OrchestratorConfig,
  results: Map<EngineId, EngineStepResult>
): Promise<EngineStepResult> {
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
          "STRATEGY_MODE"
        );
        output = result;
        snapshotId = result.snapshotId;
        ctx.mi = result;
        ctx.miSnapshotId = result.snapshotId;
        break;
      }

      case "audience": {
        const result = await runAudienceEngine(config.accountId, config.campaignId);
        output = result;
        snapshotId = result.snapshotId;
        ctx.audience = result;
        ctx.audienceSnapshotId = result.snapshotId;

        if (ctx.mi && ctx.audience) {
          try {
            const aelStart = Date.now();
            const aelPkg = await buildAnalyticalPackage({
              mi: ctx.mi,
              audience: ctx.audience,
              productDNA: null,
              competitiveData: null,
              accountId: config.accountId,
              campaignId: config.campaignId,
            });
            ctx.analyticalEnrichment = aelPkg;
            console.log(`[Orchestrator] AEL_BUILT | duration=${Date.now() - aelStart}ms | dimensions=${aelPkg ? Object.keys(aelPkg).length : 0} | campaignId=${config.campaignId}`);
          } catch (aelErr: any) {
            console.warn(`[Orchestrator] AEL_BUILD_FAILED | error=${aelErr.message} — proceeding without enrichment`);
            ctx.analyticalEnrichment = null;
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
        const result = await runPositioningEngine(
          config.accountId,
          config.campaignId,
          ctx.miSnapshotId,
          ctx.audienceSnapshotId,
          ctx.analyticalEnrichment
        );
        output = result;
        snapshotId = result.snapshotId;
        ctx.positioning = result;
        ctx.positioningSnapshotId = result.snapshotId;

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
        const miInput = extractMiInput(ctx.mi);
        const audInput = extractAudienceInput(ctx.audience);
        const posInput = extractPositioningInput(ctx.positioning);
        const result = await runDifferentiationEngine(
          miInput,
          audInput,
          posInput,
          config.accountId,
          undefined,
          ctx.analyticalEnrichment
        );
        output = result;
        snapshotId = result.snapshotId;
        ctx.differentiation = result;
        ctx.differentiationSnapshotId = result.snapshotId;

        if (ctx.analyticalEnrichment) {
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
        };
        const diffForMech = {
          pillars: diffInput.claims || [],
          mechanismFraming: ctx.differentiation?.mechanismFraming || null,
          mechanismCore: ctx.differentiation?.mechanismCore || null,
          authorityMode: ctx.differentiation?.authorityMode || null,
          claimStructures: ctx.differentiation?.claimStructures || [],
          proofArchitecture: ctx.differentiation?.proofArchitecture || [],
        };
        const result = await runMechanismEngine(positioningForMech, diffForMech, config.accountId, ctx.analyticalEnrichment);
        output = result;
        ctx.mechanism = result;

        try {
          const [mechSnapshot] = await db.insert(mechanismSnapshots).values({
            accountId: config.accountId,
            campaignId: config.campaignId,
            positioningSnapshotId: ctx.positioningSnapshotId || "N/A",
            differentiationSnapshotId: ctx.differentiationSnapshotId || "N/A",
            engineVersion: result.engineVersion || 1,
            status: result.status || "COMPLETE",
            statusMessage: result.statusMessage || null,
            primaryMechanism: result.primaryMechanism ? JSON.stringify(result.primaryMechanism) : null,
            alternativeMechanism: result.alternativeMechanism ? JSON.stringify(result.alternativeMechanism) : null,
            axisConsistency: result.axisConsistency ? JSON.stringify(result.axisConsistency) : null,
            confidenceScore: result.confidenceScore || null,
            executionTimeMs: result.executionTimeMs || null,
          }).returning();
          snapshotId = mechSnapshot.id;
          ctx.mechanismSnapshotId = mechSnapshot.id;
          console.log(`[Orchestrator] MECH_SNAPSHOT_SAVED | id=${mechSnapshot.id}`);
        } catch (mechDbErr: any) {
          console.warn(`[Orchestrator] MECH_SNAPSHOT_SAVE_FAILED | error=${mechDbErr.message}`);
        }

        if (result.celDepthCompliance) {
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
        break;
      }

      case "offer": {
        { const sglBlock = resolveSglOrBlock("offer", ctx, startTime); if (sglBlock) return sglBlock; }
        const miInput = extractMiInput(ctx.mi);
        const audInput = extractAudienceInput(ctx.audience);
        const posInput = extractPositioningInput(ctx.positioning);
        const diffInput = extractDifferentiationInput(ctx.differentiation);
        const upstreamLineage = buildUpstreamLineage(ctx);
        const result = await runOfferEngine(
          miInput, audInput, posInput, diffInput,
          config.accountId, upstreamLineage,
          ctx.mechanism || undefined,
          undefined,
          ctx.analyticalEnrichment
        );
        output = result;
        snapshotId = result.snapshotId;
        ctx.offer = result;

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
          ctx.analyticalEnrichment
        );
        output = result;
        snapshotId = result.snapshotId;
        ctx.awareness = result;

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
        const miInput = extractMiInput(ctx.mi);
        const audInput = extractAudienceInput(ctx.audience);
        const offerInput = extractOfferInput(ctx.offer);
        const posInput = extractPositioningInput(ctx.positioning);
        const diffInput = extractDifferentiationInput(ctx.differentiation);
        const awarenessInput = ctx.awareness ? {
          awarenessStage: ctx.awareness.primaryRoute?.targetReadinessStage || "problem_aware",
          entryMechanism: ctx.awareness.primaryRoute?.entryMechanismType || "unknown",
          triggerClass: ctx.awareness.primaryRoute?.triggerClass || "unknown",
          trustState: ctx.awareness.primaryRoute?.trustRequirement || "moderate",
          awarenessRoute: ctx.awareness.primaryRoute?.routeName || "default",
          awarenessStrengthScore: ctx.awareness.primaryRoute?.awarenessStrengthScore || 0,
        } : null;
        const result = await runFunnelEngine(
          miInput, audInput, offerInput, posInput, diffInput,
          config.accountId, awarenessInput,
          ctx.analyticalEnrichment
        );
        output = result;
        snapshotId = result.snapshotId;
        ctx.funnel = result;

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
            funnelSnapshotId: ctx.funnel?.snapshotId || "N/A",
            offerSnapshotId: ctx.offer?.snapshotId || "N/A",
            miSnapshotId: ctx.miSnapshotId || "N/A",
            audienceSnapshotId: ctx.audienceSnapshotId || "N/A",
            positioningSnapshotId: ctx.positioningSnapshotId || "N/A",
            differentiationSnapshotId: ctx.differentiationSnapshotId || "N/A",
            engineVersion: result.engineVersion || 1,
            status: result.status || "COMPLETE",
            statusMessage: result.statusMessage || null,
            overallIntegrityScore: result.overallIntegrityScore || null,
            safeToExecute: result.safeToExecute || false,
            layerResults: result.layerResults ? JSON.stringify(result.layerResults) : null,
            structuralWarnings: result.structuralWarnings ? JSON.stringify(result.structuralWarnings) : null,
            flaggedInconsistencies: result.flaggedInconsistencies ? JSON.stringify(result.flaggedInconsistencies) : null,
            boundaryCheck: result.boundaryCheck ? JSON.stringify(result.boundaryCheck) : null,
            executionTimeMs: result.executionTimeMs || null,
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
        const miInput = extractMiInput(ctx.mi);
        const audInput = extractAudienceInput(ctx.audience);
        const posInput = extractPositioningInput(ctx.positioning);
        const diffInput = extractDifferentiationInput(ctx.differentiation);
        const offerInput = extractOfferInput(ctx.offer);
        const funnelInput = extractFunnelInput(ctx.funnel);
        const integrityInput = ctx.integrity || {};
        const awarenessInput = ctx.awareness || {};
        const persuasionLineage = buildUpstreamLineage(ctx);
        const result = await runPersuasionEngine(
          miInput, audInput, posInput, diffInput, offerInput, funnelInput, integrityInput, awarenessInput,
          config.accountId, persuasionLineage,
          ctx.analyticalEnrichment
        );
        output = result;
        snapshotId = result.snapshotId;
        ctx.persuasion = result;

        if (ctx.analyticalEnrichment) {
          const persTexts = (result.sequences || result.persuasionSequence || []).map((s: any) => typeof s === "string" ? s : s.technique || s.name || JSON.stringify(s));
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
        const miInput = extractMiInput(ctx.mi);
        const audInput = extractAudienceInput(ctx.audience);
        const offerInput = extractOfferInput(ctx.offer);
        const funnelInput = extractFunnelInput(ctx.funnel);
        const awarenessInput = ctx.awareness || {};
        const persuasionInput = ctx.persuasion || {};
        const statLineage = buildUpstreamLineage(ctx);
        const result = await runStatisticalValidationEngine(
          miInput, audInput, offerInput, funnelInput, awarenessInput, persuasionInput,
          config.accountId, statLineage
        );
        output = result;
        ctx.statisticalValidation = result;

        try {
          const [svSnap] = await db.insert(strategyValidationSnapshots).values({
            accountId: config.accountId,
            campaignId: config.campaignId,
            persuasionSnapshotId: ctx.persuasion?.snapshotId || null,
            engineVersion: result.engineVersion || 1,
            status: result.status || "COMPLETE",
            statusMessage: result.statusMessage || null,
            result: JSON.stringify(result),
            layerResults: JSON.stringify(result.layerResults || []),
            structuralWarnings: JSON.stringify(result.structuralWarnings || []),
            boundaryCheck: JSON.stringify(result.boundaryCheck || {}),
            dataReliability: JSON.stringify(result.dataReliability || {}),
            confidenceScore: result.claimConfidenceScore || null,
            executionTimeMs: result.executionTimeMs || null,
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

        try {
          const [bgSnap] = await db.insert(budgetGovernorSnapshots).values({
            accountId: config.accountId,
            campaignId: config.campaignId,
            validationSnapshotId: ctx.statisticalValidation?.snapshotId || null,
            engineVersion: 1,
            status: "COMPLETE",
            result: JSON.stringify(result),
            confidenceScore: result.confidenceScore || null,
            executionTimeMs: result.executionTimeMs || null,
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
        const audInput = extractAudienceInput(ctx.audience);
        const awarenessInput = ctx.awareness || {};
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
        console.log(`[Orchestrator] CHANNEL_BUDGET_MAPPED | testMax=${budgetInput.testBudgetMax} scaleMax=${budgetInput.scaleBudgetMax} killFlag=${budgetInput.killFlag} expansion=${budgetInput.expansionPermission}`);
        const result = runChannelSelectionEngine(
          audInput, awarenessInput, persuasionInput, offerInput,
          budgetInput, validationInput, "INTELLIGENT",
          ctx.memoryContext || undefined
        );
        output = result;
        ctx.channelSelection = result;

        try {
          const [csSnap] = await db.insert(channelSelectionSnapshots).values({
            accountId: config.accountId,
            campaignId: config.campaignId,
            validationSnapshotId: ctx.statisticalValidation?.snapshotId || null,
            budgetSnapshotId: ctx.budgetGovernorSnapshotId || null,
            engineVersion: 1,
            status: "COMPLETE",
            result: JSON.stringify(result),
            confidenceScore: result.confidenceScore || null,
            executionTimeMs: result.executionTimeMs || null,
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

        try {
          const [iterSnap] = await db.insert(iterationSnapshots).values({
            accountId: config.accountId,
            campaignId: config.campaignId,
            engineVersion: result.engineVersion || 1,
            status: result.status || "COMPLETE",
            statusMessage: result.statusMessage || null,
            result: JSON.stringify(result),
            layerResults: result.layerResults ? JSON.stringify(result.layerResults) : null,
            structuralWarnings: result.structuralWarnings ? JSON.stringify(result.structuralWarnings) : null,
            boundaryCheck: result.boundaryCheck ? JSON.stringify(result.boundaryCheck) : null,
            dataReliability: result.dataReliability ? JSON.stringify(result.dataReliability) : null,
            confidenceScore: result.confidenceScore || null,
            executionTimeMs: result.executionTimeMs || null,
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

        const audiencePains = safeParseArr(audInput.painProfiles);
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

        try {
          const [retSnap] = await db.insert(retentionSnapshots).values({
            accountId: config.accountId,
            campaignId: config.campaignId,
            engineVersion: result.engineVersion || 1,
            status: result.status || "COMPLETE",
            statusMessage: result.statusMessage || null,
            result: JSON.stringify(result),
            layerResults: result.layerResults ? JSON.stringify(result.layerResults) : null,
            structuralWarnings: result.structuralWarnings ? JSON.stringify(result.structuralWarnings) : null,
            boundaryCheck: result.boundaryCheck ? JSON.stringify(result.boundaryCheck) : null,
            dataReliability: result.dataReliability ? JSON.stringify(result.dataReliability) : null,
            confidenceScore: result.confidenceScore || null,
            executionTimeMs: result.executionTimeMs || null,
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
  let ctx: EngineContext = {};
  let previousSectionStatuses: any[] = [];

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

  for (let i = effectiveStartIndex; i < ENGINE_PRIORITY_ORDER.length; i++) {
    const engineDef = ENGINE_PRIORITY_ORDER[i];

    // When scopedEngines is provided, skip any engine NOT in the requested scope
    if (scopedEngineSet && !scopedEngineSet.has(engineDef.id)) {
      console.log(`[Orchestrator] SCOPED_SKIP | Skipping ${engineDef.name} (not in scopedEngines)`);
      results.set(engineDef.id as EngineId, { engineId: engineDef.id as EngineId, status: "SKIPPED", output: null, durationMs: 0 });
      continue;
    }

    console.log(`[Orchestrator] Running engine ${i + 1}/${ENGINE_PRIORITY_ORDER.length}: ${engineDef.name}`);

    const stepResult = await Promise.race([
      executeEngine(engineDef.id, ctx, config, results),
      new Promise<EngineStepResult>((resolve) =>
        setTimeout(() => {
          console.warn(`[Orchestrator] ENGINE_TIMEOUT | ${engineDef.name} exceeded ${ENGINE_TIMEOUT_MS / 1000}s — forcing ERROR`);
          resolve({
            engineId: engineDef.id,
            status: "ERROR",
            output: null,
            durationMs: ENGINE_TIMEOUT_MS,
            error: `Engine timed out after ${ENGINE_TIMEOUT_MS / 1000}s`,
          });
        }, ENGINE_TIMEOUT_MS)
      ),
    ]);
    results.set(engineDef.id, stepResult);

    const sectionStatuses = ENGINE_PRIORITY_ORDER.map(e => {
      const r = results.get(e.id);
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
    } else if (stepResult.status === "BLOCKED" || stepResult.status === "ERROR") {
      if (shouldBlockDownstream(stepResult)) {
        failedEngine = engineDef.name;
        blockReason = stepResult.blockReason || stepResult.error || "Engine produced blocking result";
        overallStatus = "BLOCKED";
        console.warn(`[Orchestrator] BLOCKED at ${engineDef.name}: ${blockReason}`);
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
      config: { campaignId: config.campaignId, accountId: config.accountId },
    });
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
