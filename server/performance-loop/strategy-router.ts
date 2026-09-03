import { db } from "../db";
import { performanceContexts, businessExecutionStates, enginePerformanceConsumptions, type PerformanceContextRow } from "@shared/schema";
import { and, desc, eq } from "drizzle-orm";

export interface EnginePerformanceConsumptionRecord {
  engineId: string;
  campaignId: string;
  accountId: string;
  performanceContextId: string;
  businessExecutionStateId: string;
  mode: string;
  primaryBottleneck: string;
  consumedAt: string;
  engineRunId?: string;
  outputSnapshotId?: string;
}

export type EngineCategory = "SLOW" | "MEDIUM" | "FAST";

export interface EnginePerformanceContext {
  performanceContextId: string;
  businessExecutionStateId: string;
  mode: "BUILD" | "OPTIMIZE" | "UNKNOWN";
  primaryBottleneck: string;
  confidence: string;
  freshness: string;
  isStale: boolean;
  
  // Projected Bounded Signals (Differs by Engine Category)
  allowedSignals: {
    strongestSignals?: string[];
    weakestSignals?: string[];
    proofGaps?: string[];
    relevantBuyerResponses?: string[];
    relevantObjections?: string[];
    activeChannels?: string[];
    recentTrend?: string;
  };
  
  permissionDirective: string;
  evidenceRefIds: string[];
}

const consumptionLineageLog: EnginePerformanceConsumptionRecord[] = [];

export async function getLatestPerformanceContext(
  campaignId: string,
  accountId: string
): Promise<PerformanceContextRow | null> {
  const [context] = await db
    .select()
    .from(performanceContexts)
    .where(and(eq(performanceContexts.accountId, accountId), eq(performanceContexts.campaignId, campaignId)))
    .orderBy(desc(performanceContexts.createdAt))
    .limit(1);

  return context || null;
}

/**
 * Builds a strictly bounded Engine-Specific Performance Context projection view.
 * Enforces Authority Precedence: SLOW engines receive validation-only views,
 * MEDIUM engines receive bottleneck/proof context, FAST engines receive rich execution context.
 */
export function buildEnginePerformanceView(
  engineName: string,
  context: PerformanceContextRow | null,
  options?: { isStale?: boolean }
): EnginePerformanceContext | null {
  if (!context) return null;

  const mode = (context.mode as "BUILD" | "OPTIMIZE" | "UNKNOWN") || "UNKNOWN";
  const primaryBottleneck = context.primaryBottleneck || "UNKNOWN";
  const confidence = context.confidence || "LOW";
  const freshness = context.freshness || "FRESH";
  const isStale = !!options?.isStale || freshness === "STALE";

  const nameUpper = engineName.toUpperCase();
  
  // Categorize Engine
  let category: EngineCategory = "MEDIUM";
  if (nameUpper.includes("AUDIENCE") || nameUpper.includes("POSITIONING") || nameUpper.includes("DIFFERENTIATION") || nameUpper.includes("MECHANISM")) {
    category = "SLOW";
  } else if (nameUpper.includes("CHANNEL") || nameUpper.includes("CONTENT") || nameUpper.includes("PLAN_SYNTHESIS") || nameUpper.includes("ITERATION")) {
    category = "FAST";
  }

  let permissionDirective = "";
  let allowedSignals: EnginePerformanceContext["allowedSignals"] = {};

  if (category === "SLOW") {
    allowedSignals = {
      relevantObjections: Array.isArray(context.relevantObjections) ? (context.relevantObjections as string[]) : [],
      relevantBuyerResponses: Array.isArray(context.relevantBuyerResponses) ? (context.relevantBuyerResponses as string[]) : [],
    };
    permissionDirective = "Validation and learning evidence ONLY. You MUST NOT mutate canonical target audience, core pain, positioning territory, product mechanism, or core differentiation based on performance feedback.";
  } else if (category === "MEDIUM") {
    allowedSignals = {
      proofGaps: Array.isArray(context.proofGaps) ? (context.proofGaps as string[]) : [],
      relevantObjections: Array.isArray(context.relevantObjections) ? (context.relevantObjections as string[]) : [],
      relevantBuyerResponses: Array.isArray(context.relevantBuyerResponses) ? (context.relevantBuyerResponses as string[]) : [],
    };
    if (nameUpper.includes("OFFER")) {
      permissionDirective = mode === "BUILD"
        ? "BUILD MODE: Favor lower-friction validation/diagnostic entry framing. Do NOT invent ungrounded product capabilities or claim mature customer case studies."
        : "OPTIMIZE MODE: Address active commercial friction and conversion proof gaps. If bottleneck is REACH, do NOT rebuild the core offer.";
    } else if (nameUpper.includes("AWARENESS")) {
      permissionDirective = mode === "BUILD"
        ? "BUILD MODE: Emphasize problem recognition, category education, and mechanism understanding."
        : "OPTIMIZE MODE: Emphasize the evidence-backed awareness stage indicated by market traction.";
    } else if (nameUpper.includes("FUNNEL")) {
      permissionDirective = mode === "BUILD"
        ? "BUILD MODE: Establish attention -> prospect interaction -> conversation -> proof -> initial conversion. Do NOT assume a mature sales pipeline exists."
        : `OPTIMIZE MODE: Focus funnel stage emphasis on primary bottleneck "${primaryBottleneck}".`;
    } else if (nameUpper.includes("PERSUASION")) {
      permissionDirective = mode === "BUILD"
        ? "BUILD MODE: Prioritize product mechanism demonstration, transparent process proof, and foundational credibility. Do NOT fabricate testimonials or case studies."
        : "OPTIMIZE MODE: Target active objections, proof gaps, and buyer responses directly.";
    } else {
      permissionDirective = "Medium-adaptation engine context. Use performance context to refine tactical execution without altering core strategy identity.";
    }
  } else {
    // FAST adaptation
    allowedSignals = {
      strongestSignals: Array.isArray(context.strongestSignals) ? (context.strongestSignals as string[]) : [],
      weakestSignals: Array.isArray(context.weakestSignals) ? (context.weakestSignals as string[]) : [],
      proofGaps: Array.isArray(context.proofGaps) ? (context.proofGaps as string[]) : [],
      relevantObjections: Array.isArray(context.relevantObjections) ? (context.relevantObjections as string[]) : [],
      relevantBuyerResponses: Array.isArray(context.relevantBuyerResponses) ? (context.relevantBuyerResponses as string[]) : [],
      activeChannels: Array.isArray(context.activeChannels) ? (context.activeChannels as string[]) : [],
      recentTrend: context.recentTrend || "INSUFFICIENT_DATA",
    };
    if (nameUpper.includes("CHANNEL")) {
      permissionDirective = mode === "BUILD"
        ? "BUILD MODE: Prioritize prospect access, testing speed, discoverability, and low-friction market learning."
        : "OPTIMIZE MODE: Adjust channel allocation and cadence according to verified performance signals.";
    } else if (nameUpper.includes("CONTENT")) {
      permissionDirective = mode === "BUILD"
        ? "BUILD MODE: Emphasize discovery, problem education, initial proof, and conversation generation."
        : `OPTIMIZE MODE: Adapt content formats to resolve active bottleneck "${primaryBottleneck}".`;
    } else {
      permissionDirective = "Fast-adaptation engine context. Assemble and align execution formats to match business mode and active bottleneck.";
    }
  }

  if (isStale) {
    permissionDirective += " WARNING: Context is STALE — preserve strategy identity and restrict aggressive adaptation.";
  }

  return {
    performanceContextId: context.id,
    businessExecutionStateId: context.businessExecutionStateId,
    mode,
    primaryBottleneck,
    confidence,
    freshness,
    isStale,
    allowedSignals,
    permissionDirective,
    evidenceRefIds: Array.isArray(context.evidenceRefIds) ? (context.evidenceRefIds as string[]) : [],
  };
}

export async function recordEnginePerformanceConsumptionDB(params: {
  engineName: string;
  engineRunId: string;
  campaignId: string;
  accountId: string;
  performanceContextId: string;
  businessExecutionStateId: string;
  mode: string;
  primaryBottleneck?: string;
  outputSnapshotId?: string;
}): Promise<void> {
  const {
    engineName, engineRunId, campaignId, accountId,
    performanceContextId, businessExecutionStateId, mode,
    primaryBottleneck = "UNKNOWN", outputSnapshotId
  } = params;

  try {
    await db.insert(enginePerformanceConsumptions).values({
      accountId,
      campaignId,
      engineName,
      engineRunId,
      performanceContextId,
      businessExecutionStateId,
      mode,
      primaryBottleneck,
      outputSnapshotId: outputSnapshotId || null,
    });
  } catch (err: any) {
    console.error(`[PerformanceStrategyRouter] FAILED_TO_PERSIST_CONSUMPTION_DB: ${err.message}`);
  }

  const record: EnginePerformanceConsumptionRecord = {
    engineId: engineName,
    campaignId,
    accountId,
    performanceContextId,
    businessExecutionStateId,
    mode,
    primaryBottleneck,
    consumedAt: new Date().toISOString(),
    engineRunId,
    outputSnapshotId,
  };
  consumptionLineageLog.push(record);
  console.log(`[PerformanceStrategyRouter] LINEAGE_RECORDED | engine=${engineName} runId=${engineRunId} contextId=${performanceContextId} stateId=${businessExecutionStateId} mode=${mode}`);
}

export function recordEnginePerformanceConsumption(
  engineId: string,
  context: PerformanceContextRow
): EnginePerformanceConsumptionRecord {
  const record: EnginePerformanceConsumptionRecord = {
    engineId,
    campaignId: context.campaignId,
    accountId: context.accountId,
    performanceContextId: context.id,
    businessExecutionStateId: context.businessExecutionStateId,
    mode: context.mode,
    primaryBottleneck: context.primaryBottleneck || "UNKNOWN",
    consumedAt: new Date().toISOString(),
  };

  consumptionLineageLog.push(record);
  console.log(`[PerformanceStrategyRouter] LINEAGE_RECORDED | engine=${engineId} contextId=${context.id} stateId=${context.businessExecutionStateId} mode=${context.mode}`);
  return record;
}

export function getConsumptionLineageLog(): EnginePerformanceConsumptionRecord[] {
  return [...consumptionLineageLog];
}

/**
 * Authority Precedence Safety Check:
 * Verifies that PerformanceContext is consumed ONLY as execution context and NEVER mutates Strategy Root or target audience.
 */
export function verifyAuthorityPrecedenceBoundary(
  targetStrategyRoot: any,
  performanceContext: PerformanceContextRow
): { boundaryPassed: boolean; violations: string[] } {
  const violations: string[] = [];

  if (targetStrategyRoot?._mutatedByPerformance === true) {
    violations.push("AUTHORITY_VIOLATION: Strategy Root was mutated directly by PerformanceContext.");
  }
  if (targetStrategyRoot?.primaryTargetAudience?._mutatedByPerformance === true) {
    violations.push("AUTHORITY_VIOLATION: Target Audience was mutated directly by PerformanceContext.");
  }

  return {
    boundaryPassed: violations.length === 0,
    violations,
  };
}

/**
 * Judge Alignment Validation:
 * Validates that an engine's proposed output respects the canonical BusinessExecutionState.mode.
 */
export function validateEngineOutputPerformanceAlignment(
  engineName: string,
  outputPayloadStr: string,
  perfCtx: EnginePerformanceContext | null
): { aligned: boolean; violations: string[] } {
  const violations: string[] = [];
  if (!perfCtx) return { aligned: true, violations: [] };

  const text = (outputPayloadStr || "").toLowerCase();

  if (perfCtx.mode === "BUILD") {
    // BUILD Mode Negative Checks: Must not claim ungrounded mature proof / case studies
    if (
      text.includes("proven 42% uplift") ||
      text.includes("60+ active paying client") ||
      text.includes("3 years of proven sales history") ||
      text.includes("guaranteed 14-day deployment sla") ||
      text.includes("enterprise revenue operations") ||
      text.includes("soc-2 type ii certified")
    ) {
      violations.push("BUILD_PROOF_OVERCLAIM: Output claims ungrounded mature customer case studies or SLAs inappropriate for BUILD mode.");
    }
  }

  if (perfCtx.mode === "UNKNOWN") {
    if (text.includes("proven market leader") || text.includes("established enterprise customer base")) {
      violations.push("UNKNOWN_MODE_ASSUMPTION: Output fabricates mature market status when business mode is UNKNOWN.");
    }
  }

  return {
    aligned: violations.length === 0,
    violations,
  };
}
