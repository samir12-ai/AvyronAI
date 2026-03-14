import { db } from "../db";
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

export interface OrchestratorConfig {
  accountId: string;
  campaignId: string;
  forceRefresh?: boolean;
  resumeFromEngine?: EngineId;
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
  return {
    territories: positioningResult.territories || [],
    narrative: positioningResult.narrative || "",
    specificity: positioningResult.specificityScore || 0,
    saturation: positioningResult.saturationScore || 0,
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
        const result = await runPositioningEngine(
          config.accountId,
          config.campaignId,
          ctx.miSnapshotId,
          ctx.audienceSnapshotId
        );
        output = result;
        snapshotId = result.snapshotId;
        ctx.positioning = result;
        ctx.positioningSnapshotId = result.snapshotId;
        break;
      }

      case "differentiation": {
        const miInput = extractMiInput(ctx.mi);
        const audInput = extractAudienceInput(ctx.audience);
        const posInput = extractPositioningInput(ctx.positioning);
        const result = await runDifferentiationEngine(
          miInput,
          audInput,
          posInput,
          config.accountId
        );
        output = result;
        snapshotId = result.snapshotId;
        ctx.differentiation = result;
        ctx.differentiationSnapshotId = result.snapshotId;
        break;
      }

      case "offer": {
        const miInput = extractMiInput(ctx.mi);
        const audInput = extractAudienceInput(ctx.audience);
        const posInput = extractPositioningInput(ctx.positioning);
        const diffInput = extractDifferentiationInput(ctx.differentiation);
        const result = await runOfferEngine(
          miInput, audInput, posInput, diffInput,
          config.accountId, []
        );
        output = result;
        snapshotId = result.snapshotId;
        ctx.offer = result;
        break;
      }

      case "funnel": {
        const miInput = extractMiInput(ctx.mi);
        const audInput = extractAudienceInput(ctx.audience);
        const offerInput = ctx.offer || {};
        const posInput = extractPositioningInput(ctx.positioning);
        const diffInput = extractDifferentiationInput(ctx.differentiation);
        const result = await runFunnelEngine(
          miInput, audInput, offerInput, posInput, diffInput,
          config.accountId
        );
        output = result;
        snapshotId = result.snapshotId;
        ctx.funnel = result;
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

      case "awareness": {
        const miInput = extractMiInput(ctx.mi);
        const audInput = extractAudienceInput(ctx.audience);
        const posInput = extractPositioningInput(ctx.positioning);
        const diffInput = extractDifferentiationInput(ctx.differentiation);
        const offerInput = ctx.offer || {};
        const funnelInput = ctx.funnel || {};
        const integrityInput = ctx.integrity || {};
        const result = await runAwarenessEngine(
          miInput, audInput, posInput, diffInput, offerInput, funnelInput, integrityInput,
          config.accountId, []
        );
        output = result;
        snapshotId = result.snapshotId;
        ctx.awareness = result;
        break;
      }

      case "persuasion": {
        const miInput = extractMiInput(ctx.mi);
        const audInput = extractAudienceInput(ctx.audience);
        const posInput = extractPositioningInput(ctx.positioning);
        const diffInput = extractDifferentiationInput(ctx.differentiation);
        const offerInput = ctx.offer || {};
        const funnelInput = ctx.funnel || {};
        const integrityInput = ctx.integrity || {};
        const awarenessInput = ctx.awareness || {};
        const result = await runPersuasionEngine(
          miInput, audInput, posInput, diffInput, offerInput, funnelInput, integrityInput, awarenessInput,
          config.accountId, []
        );
        output = result;
        snapshotId = result.snapshotId;
        ctx.persuasion = result;
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
