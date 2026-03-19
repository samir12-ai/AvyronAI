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
import type { IntegrityReport } from "../system-integrity/types";
import { storeIntegrityReport } from "../system-integrity/routes";
import {
  orchestratorJobs,
  strategicPlans,
  growthCampaigns,
  businessDataLayer,
  miSnapshots,
  audienceSnapshots,
  positioningSnapshots,
  differentiationSnapshots,
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
} from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import {
  ENGINE_PRIORITY_ORDER,
  checkPriorityViolation,
  shouldBlockDownstream,
  type EngineId,
  type EngineStepResult,
} from "./priority-matrix";
import { synthesizePlan } from "./plan-synthesis";

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
  onProgress?: (event: AgentProgressEvent) => void;
}

export interface OrchestratorRunResult {
  jobId: string;
  status: "COMPLETED" | "PARTIAL" | "BLOCKED" | "ERROR";
  completedEngines: string[];
  failedEngine?: string;
  blockReason?: string;
  planId?: string;
  results: Map<EngineId, EngineStepResult>;
  durationMs: number;
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
  channelSelection?: any;
  iteration?: any;
  retention?: any;
  miSnapshotId?: string;
  audienceSnapshotId?: string;
  positioningSnapshotId?: string;
  differentiationSnapshotId?: string;
  analyticalEnrichment?: any;
  celResults?: ComplianceResult[];
  depthGateStatus?: Record<string, string>;
  sglState?: SignalGovernanceState;
  integrityReport?: IntegrityReport;
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

function extractMiInput(miResult: any): any {
  if (!miResult?.output) return {};
  const out = miResult.output;
  return {
    competitors: out.competitors || [],
    signals: out.signals || [],
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
    collisions: diffResult.collisions || [],
    trustGaps: diffResult.trustGaps || [],
    proofMap: diffResult.proofDemandMap || [],
  };
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
        const result = await runOfferEngine(
          miInput, audInput, posInput, diffInput,
          config.accountId, [],
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
        const offerInput = ctx.offer || {};
        const result = await runAwarenessEngine(
          miInput, audInput, posInput, diffInput, offerInput,
          config.accountId, [],
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
        const offerInput = ctx.offer || {};
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
        const offerInput = ctx.offer || {};
        const funnelInput = ctx.funnel || {};
        const result = runIntegrityEngine(
          miInput, audInput, posInput, diffInput, offerInput, funnelInput
        );
        output = result;
        ctx.integrity = result;
        break;
      }

      case "persuasion": {
        { const sglBlock = resolveSglOrBlock("persuasion", ctx, startTime); if (sglBlock) return sglBlock; }
        const miInput = extractMiInput(ctx.mi);
        const audInput = extractAudienceInput(ctx.audience);
        const posInput = extractPositioningInput(ctx.positioning);
        const diffInput = extractDifferentiationInput(ctx.differentiation);
        const offerRaw = ctx.offer || {};
        const posLockForPersuasion = offerRaw?.layerDiagnostics?.positioningLock || null;
        const offerInput = posLockForPersuasion
          ? {
              ...offerRaw,
              lockedDecisions: posLockForPersuasion.lockedDecisions || [],
              nonGenericAnchors: posLockForPersuasion.nonGenericAnchors || [],
            }
          : offerRaw;
        const funnelInput = ctx.funnel || {};
        const integrityInput = ctx.integrity || {};
        const awarenessInput = ctx.awareness || {};
        const result = await runPersuasionEngine(
          miInput, audInput, posInput, diffInput, offerInput, funnelInput, integrityInput, awarenessInput,
          config.accountId, [],
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
        const offerInput = ctx.offer || {};
        const funnelInput = ctx.funnel || {};
        const awarenessInput = ctx.awareness || {};
        const persuasionInput = ctx.persuasion || {};
        const result = await runStatisticalValidationEngine(
          miInput, audInput, offerInput, funnelInput, awarenessInput, persuasionInput,
          config.accountId, []
        );
        output = result;
        snapshotId = result.snapshotId;
        ctx.statisticalValidation = result;
        break;
      }

      case "budget_governor": {
        const bizData = await getBusinessData(config.accountId, config.campaignId);
        const campaignData = await getCampaignData(config.campaignId);
        const result = runBudgetGovernorEngine({
          budget: {
            monthlyBudget: parseFloat(bizData?.monthlyBudget?.replace(/[^0-9.]/g, "") || "0"),
            currency: "USD",
            currentSpend: 0,
          },
          campaign: {
            objective: campaignData?.objective || "AWARENESS",
            durationDays: 30,
            channels: [],
          },
          performance: null,
          validation: ctx.statisticalValidation || null,
        });
        output = result;
        ctx.budgetGovernor = result;
        break;
      }

      case "channel_selection": {
        const audInput = extractAudienceInput(ctx.audience);
        const awarenessInput = ctx.awareness || {};
        const persuasionInput = ctx.persuasion || {};
        const offerInput = ctx.offer || {};
        const budgetInput = ctx.budgetGovernor || {};
        const validationInput = ctx.statisticalValidation || {};
        const result = runChannelSelectionEngine(
          audInput, awarenessInput, persuasionInput, offerInput,
          budgetInput, validationInput, "INTELLIGENT"
        );
        output = result;
        ctx.channelSelection = result;
        break;
      }

      case "iteration": {
        const campaignData = await getCampaignData(config.campaignId);
        const performance = campaignData ? {
          impressions: campaignData.impressions || 0,
          clicks: campaignData.clicks || 0,
          conversions: campaignData.conversions || 0,
          spend: parseFloat(campaignData.spend || "0"),
          revenue: parseFloat(campaignData.revenue || "0"),
        } : null;
        const result = await runIterationEngine(
          performance,
          ctx.funnel || null,
          null,
          ctx.persuasion || null
        );
        output = result;
        ctx.iteration = result;
        break;
      }

      case "retention": {
        const result = await runRetentionEngine({
          customerJourneyData: {
            touchpoints: [],
            avgTimeToConversion: null,
            repeatPurchaseRate: null,
            churnRate: null,
            customerLifetimeValue: null,
            retentionWindowDays: null,
            engagementDecayRate: null,
          },
          offerStructure: {
            offerName: null,
            coreOutcome: null,
            deliverables: [],
            pricingModel: null,
          },
          purchaseMotivations: [],
          postPurchaseObjections: [],
          campaignId: config.campaignId,
          accountId: config.accountId,
        });
        output = result;
        ctx.retention = result;
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

export async function runOrchestrator(config: OrchestratorConfig): Promise<OrchestratorRunResult> {
  const startTime = Date.now();
  const jobId = `orch_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

  const [job] = await db.insert(orchestratorJobs).values({
    id: jobId,
    blueprintId: "orchestrator-v2",
    accountId: config.accountId,
    campaignId: config.campaignId,
    status: "RUNNING",
    sectionStatuses: JSON.stringify(
      ENGINE_PRIORITY_ORDER.map(e => ({ id: e.id, name: e.name, status: "PENDING" }))
    ),
  }).returning();

  const results = new Map<EngineId, EngineStepResult>();
  const ctx: EngineContext = {};
  const completedEngines: string[] = [];
  let failedEngine: string | undefined;
  let blockReason: string | undefined;
  let overallStatus: "COMPLETED" | "PARTIAL" | "BLOCKED" | "ERROR" = "COMPLETED";

  const startIndex = config.resumeFromEngine
    ? ENGINE_PRIORITY_ORDER.findIndex(e => e.id === config.resumeFromEngine)
    : 0;

  for (let i = startIndex >= 0 ? startIndex : 0; i < ENGINE_PRIORITY_ORDER.length; i++) {
    const engineDef = ENGINE_PRIORITY_ORDER[i];
    console.log(`[Orchestrator] Running engine ${i + 1}/${ENGINE_PRIORITY_ORDER.length}: ${engineDef.name}`);

    const stepResult = await executeEngine(engineDef.id, ctx, config, results);
    results.set(engineDef.id, stepResult);

    const sectionStatuses = ENGINE_PRIORITY_ORDER.map(e => {
      const r = results.get(e.id);
      return { id: e.id, name: e.name, status: r?.status || "PENDING" };
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

  try {
    const engineOutputs: Record<string, any> = {};
    for (const [eid, result] of results) {
      engineOutputs[eid] = result.output;
    }
    ctx.integrityReport = runSystemIntegrityValidation(engineOutputs, ctx.sglState || null);
    storeIntegrityReport(config.campaignId, ctx.integrityReport);
    console.log(`[Orchestrator] INTEGRITY_REPORT | status=${ctx.integrityReport.overallStatus} | failures=${ctx.integrityReport.failureReasons.length}`);
  } catch (sivErr: any) {
    console.warn(`[Orchestrator] SIV_FAILED | error=${sivErr.message}`);
  }

  if (ctx.sglState) {
    const sglSummary = getGovernanceSummary(ctx.sglState);
    console.log(`[Orchestrator] SGL_SUMMARY | signals=${sglSummary.totalSignals} | enginesServed=${sglSummary.enginesServed.length} | coverage=${sglSummary.coverage.coverageSufficient}`);
  }

  let planId: string | undefined;

  if (overallStatus !== "BLOCKED") {
    try {
      const planResult = await synthesizePlan(config, ctx, results);
      planId = planResult.planId;
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
      sectionStatuses: JSON.stringify(
        ENGINE_PRIORITY_ORDER.map(e => {
          const r = results.get(e.id);
          return { id: e.id, name: e.name, status: r?.status || "PENDING" };
        })
      ),
    })
    .where(eq(orchestratorJobs.id, jobId));

  if (ctx.celResults && ctx.celResults.length > 0) {
    const celReport = buildCELReport(config.campaignId, 2, ctx.celResults);
    storeCELReport(config.campaignId, celReport);
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
  };
}

export async function getOrchestratorStatus(jobId: string) {
  const [job] = await db
    .select()
    .from(orchestratorJobs)
    .where(eq(orchestratorJobs.id, jobId))
    .limit(1);

  if (!job) return null;

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
