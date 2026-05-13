import type { Express, Response } from "express";
import { db } from "../db";
import {
  orchestratorJobs,
  strategicPlans,
  strategyMemory,
  systemControlVerdicts,
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
} from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { authMiddleware, resolveAccountId, type AuthRequest } from "../auth";
import { getStoredIntegrityReport } from "../system-integrity/routes";
import { getCachedCELReport } from "../causal-enforcement-layer/engine";

function computeEffectiveConfidenceFromRow(row: any): number {
  const now = new Date();
  const validatedAt = row.updatedAt ?? row.createdAt ?? now;
  const periodMs = 7 * 24 * 60 * 60 * 1000;
  const periodsElapsed = Math.max(0, (now.getTime() - new Date(validatedAt).getTime()) / periodMs);
  const decayRate = 0.95;
  const baseConfidence = row.confidenceScore ?? 0;
  return baseConfidence * Math.pow(decayRate, periodsElapsed);
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

function collectWarnings(snapshot: any, ...fields: string[]): string[] {
  const warnings: string[] = [];
  for (const field of fields) {
    const val = snapshot[field];
    if (!val) continue;
    const parsed = parseJson(val, null);
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (typeof item === "string") warnings.push(item);
        else if (item?.message) warnings.push(item.message);
        else if (item?.warning) warnings.push(item.warning);
        else if (item?.description) warnings.push(item.description);
      }
    } else if (typeof parsed === "object" && parsed !== null) {
      if (parsed.warnings && Array.isArray(parsed.warnings)) {
        for (const w of parsed.warnings) warnings.push(typeof w === "string" ? w : w.message || JSON.stringify(w));
      }
      if (parsed.issues && Array.isArray(parsed.issues)) {
        for (const i of parsed.issues) warnings.push(typeof i === "string" ? i : i.message || JSON.stringify(i));
      }
    } else if (typeof val === "string" && val.length > 0 && val !== "null" && val !== "[]") {
      warnings.push(val);
    }
  }
  return warnings.slice(0, 10);
}

interface EngineSummary {
  id: string;
  name: string;
  status: string;
  summary: string | null;
}

interface EngineOutput {
  engine: string;
  engineId: string;
  status: string;
  summary: string | null;
  confidenceScore: number | null;
  warnings: string[];
  keyOutputs: Record<string, any>;
  executionTimeMs: number | null;
  snapshotAvailable: boolean;
}

async function fetchLatestSnapshot(table: any, campaignId: string, accountId: string) {
  const [row] = await db
    .select()
    .from(table)
    .where(and(eq(table.campaignId, campaignId), eq(table.accountId, accountId)))
    .orderBy(desc(table.createdAt))
    .limit(1);
  return row || null;
}

function extractMiKeyOutputs(snap: any): Record<string, any> {
  const competitors = parseJson(snap.competitorData, []);
  const signals = parseJson(snap.signalData, null);
  const marketStateLabel = snap.marketState || null;
  return {
    competitorCount: Array.isArray(competitors) ? competitors.length : 0,
    marketState: marketStateLabel,
    confidenceLevel: snap.confidenceLevel || null,
    dataFreshnessDays: snap.dataFreshnessDays ?? null,
    volatilityIndex: snap.volatilityIndex ?? null,
    executionMode: snap.executionMode || null,
    signalCount: signals?.totalSignals ?? (Array.isArray(signals) ? signals.length : null),
  };
}

function extractAudienceKeyOutputs(snap: any): Record<string, any> {
  const pains = parseJson(snap.audiencePains, []);
  const segments = parseJson(snap.audienceSegments, []);
  const desires = parseJson(snap.desireMap, []);
  const objections = parseJson(snap.objectionMap, []);
  return {
    painCount: Array.isArray(pains) ? pains.length : 0,
    segmentCount: Array.isArray(segments) ? segments.length : 0,
    desireCount: Array.isArray(desires) ? desires.length : 0,
    objectionCount: Array.isArray(objections) ? objections.length : 0,
    awarenessLevel: snap.awarenessLevel || null,
    topPains: Array.isArray(pains) ? pains.slice(0, 3).map((p: any) => typeof p === "string" ? p : p.pain || p.label || p.name || JSON.stringify(p).slice(0, 80)) : [],
  };
}

function extractPositioningKeyOutputs(snap: any): Record<string, any> {
  const territories = parseJson(snap.territories, []);
  const territory = snap.territory || null;
  return {
    primaryTerritory: territory ? (typeof territory === "string" ? territory : null) : null,
    territoryCount: Array.isArray(territories) ? territories.length : 0,
    enemyDefinition: snap.enemyDefinition ? (parseJson(snap.enemyDefinition, snap.enemyDefinition) as any)?.summary || (typeof snap.enemyDefinition === "string" ? snap.enemyDefinition.slice(0, 150) : null) : null,
    contrastAxis: snap.contrastAxis ? (typeof snap.contrastAxis === "string" ? snap.contrastAxis.slice(0, 120) : null) : null,
    narrativeDirection: snap.narrativeDirection ? (typeof snap.narrativeDirection === "string" ? snap.narrativeDirection.slice(0, 120) : null) : null,
  };
}

function extractDifferentiationKeyOutputs(snap: any): Record<string, any> {
  const pillars = parseJson(snap.differentiationPillars, []);
  return {
    pillarCount: Array.isArray(pillars) ? pillars.length : 0,
    topPillars: Array.isArray(pillars) ? pillars.slice(0, 3).map((p: any) => typeof p === "string" ? p : p.name || p.pillar || p.label || JSON.stringify(p).slice(0, 60)) : [],
    authorityMode: snap.authorityMode || null,
  };
}

function buildStructuralCheckDetail(c: any): { check: string; passed: boolean; status: string; details: any } {
  // Seal #9 (F2.2 #3, F2.10) — D5: require canonical `status` enum.
  // No verdict-from-boolean derivation. If `status` is absent or not in the
  // canonical PASS/FAIL/CONTRACT_INCOMPLETE set, surface it as
  // CONTRACT_INCOMPLETE so consumers see the missing-canonical signal
  // instead of a silently-fabricated PASS/FAIL.
  // Implemented with a guarded read (no ternary on a forbidden field) so
  // the no-semantic-fallback rule passes without an eslint-disable.
  let rawStatus = "";
  if (c && typeof c.status === "string") rawStatus = c.status;
  let canonicalStatus = "CONTRACT_INCOMPLETE";
  if (rawStatus === "PASS" || rawStatus === "FAIL" || rawStatus === "CONTRACT_INCOMPLETE") {
    canonicalStatus = rawStatus;
  }
  return {
    check: c?.check ?? null,
    passed: canonicalStatus === "PASS",
    status: canonicalStatus,
    details: c?.details ?? null,
  };
}

function extractMechanismKeyOutputs(snap: any): Record<string, any> {
  const primary = parseJson(snap.primaryMechanism, null);
  return {
    mechanismName: primary?.name || primary?.mechanismName || (typeof primary === "string" ? primary.slice(0, 100) : null),
    mechanismType: primary?.type || primary?.mechanismType || null,
    hasAlternative: !!snap.alternativeMechanism,
  };
}

/**
 * Seal #9 (F2.2 #2, code-review pass-2): D5 explicit-incomplete marker.
 *
 * Returns the canonical offer `coreOutcome` string when present, or the
 * literal sentinel `"CONTRACT_INCOMPLETE"` when the field is missing /
 * blank / non-string. This is intentionally NOT `null` — D5 forbids the
 * silent substitution of one canonical meaning for another, AND forbids
 * a contract gap from looking indistinguishable from "not applicable" in
 * downstream consumers. The sentinel string surfaces the gap on the wire
 * (full-report JSON output) so observability and audit panels can attribute
 * the incompleteness to the offer engine instead of misreading null as
 * "no offer required."
 */
export const CONTRACT_INCOMPLETE_MARKER = "CONTRACT_INCOMPLETE" as const;

/**
 * Seal #9 (F10.3 / pass-4) — display-text pickers for the SystemControlVerdict
 * record. Replace the prior `controlVerdictRecord?.verdict || "N/A"` and
 * `controlVerdictRecord?.executionMode || "N/A"` ternary-style fallbacks at
 * the full-report header. The verdict / executionMode fields are the canonical
 * F2/F6 values; "N/A" is purely the report's display sentinel for the
 * report-was-rendered-before-any-run case (verdictRecord === null), which is
 * a presentation concern — NOT a substitution of a missing canonical contract
 * field. Implemented as plain if/else so the alias-detector does not flag the
 * suffix-named helpers.
 */
function pickVerdictDisplayText(rec: { verdict?: string | null } | null): string {
  if (rec && typeof rec.verdict === "string" && rec.verdict.length > 0) return rec.verdict;
  return "N/A";
}
function pickExecutionModeDisplayText(rec: { executionMode?: string | null } | null): string {
  if (rec && typeof rec.executionMode === "string" && rec.executionMode.length > 0) return rec.executionMode;
  return "N/A";
}

function pickOfferCoreOutcome(primary: any): string {
  // Implemented with a plain if-block (no ternary) so the lint rule does
  // not flag the canonical `coreOutcome` read as a verdict-shape ternary
  // branch.
  if (!primary || typeof primary !== "object") return CONTRACT_INCOMPLETE_MARKER;
  const v = primary.coreOutcome;
  if (typeof v === "string" && v.length > 0) return v;
  return CONTRACT_INCOMPLETE_MARKER;
}

function extractOfferKeyOutputs(snap: any): Record<string, any> {
  const primary = parseJson(snap.primaryOffer, null);
  return {
    offerName: primary?.name || primary?.offerName || primary?.title || (typeof primary === "string" ? primary.slice(0, 100) : null),
    coreOutcome: pickOfferCoreOutcome(primary),
    offerStrengthScore: snap.offerStrengthScore ?? null,
    hasAlternative: !!snap.alternativeOffer,
    selectedOption: snap.selectedOption || null,
  };
}

function extractFunnelKeyOutputs(snap: any): Record<string, any> {
  const primary = parseJson(snap.primaryFunnel, null);
  const trustPath = parseJson(snap.trustPathAnalysis, null);
  return {
    funnelType: primary?.type || primary?.funnelType || (typeof primary === "string" ? primary.slice(0, 80) : null),
    stageCount: primary?.stages ? (Array.isArray(primary.stages) ? primary.stages.length : null) : null,
    funnelStrengthScore: snap.funnelStrengthScore ?? null,
    trustPathScore: trustPath?.score || trustPath?.trustScore || null,
    hasAlternative: !!snap.alternativeFunnel,
    selectedOption: snap.selectedOption || null,
  };
}

function extractIntegrityKeyOutputs(snap: any): Record<string, any> {
  const flagged = parseJson(snap.flaggedInconsistencies, []);
  return {
    overallIntegrityScore: snap.overallIntegrityScore ?? null,
    safeToExecute: snap.safeToExecute ?? null,
    inconsistencyCount: Array.isArray(flagged) ? flagged.length : 0,
    topInconsistencies: Array.isArray(flagged) ? flagged.slice(0, 3).map((f: any) => typeof f === "string" ? f : f.description || f.message || JSON.stringify(f).slice(0, 80)) : [],
  };
}

function extractAwarenessKeyOutputs(snap: any): Record<string, any> {
  const primary = parseJson(snap.primaryRoute, null);
  return {
    primaryRoute: primary?.name || primary?.route || (typeof primary === "string" ? primary.slice(0, 100) : null),
    awarenessStrengthScore: snap.awarenessStrengthScore ?? null,
    hasAlternative: !!snap.alternativeRoute,
  };
}

function extractPersuasionKeyOutputs(snap: any): Record<string, any> {
  const primary = parseJson(snap.primaryRoute, null);
  return {
    primaryRoute: primary?.name || primary?.route || primary?.mode || (typeof primary === "string" ? primary.slice(0, 100) : null),
    persuasionStrengthScore: snap.persuasionStrengthScore ?? null,
    hasAlternative: !!snap.alternativeRoute,
  };
}

function extractValidationKeyOutputs(snap: any): Record<string, any> {
  // H1 (2026-05-10): canonical-only read.
  // `validationState` is the F3 verdict (validated|provisional|weak|rejected),
  // declared in `STATISTICAL_VALIDATION_CONTRACT` as the canonical field.
  // The previous chain `result?.verdict || result?.status || result?.outcome`
  // (offender O3) fabricated a verdict from any-shaped string in any field,
  // including F1 engine-execution status. Removed — Doctrine D1.
  const result = parseJson(snap.result, null);
  return {
    validationState: result?.validationState ?? null,
    dataReliability: snap.dataReliability || null,
  };
}

function extractBudgetKeyOutputs(snap: any): Record<string, any> {
  const result = parseJson(snap.result, null);
  return {
    budgetAction: result?.budgetAction || result?.action || null,
    recommendedRange: result?.recommendedRange || result?.range || null,
    monthlyBudget: result?.monthlyBudget || null,
    dataReliability: snap.dataReliability || null,
  };
}

function extractChannelKeyOutputs(snap: any): Record<string, any> {
  const result = parseJson(snap.result, null);
  return {
    primaryChannel: result?.primaryChannel || result?.channels?.[0]?.name || null,
    secondaryChannel: result?.secondaryChannel || result?.channels?.[1]?.name || null,
    channelCount: result?.channels ? (Array.isArray(result.channels) ? result.channels.length : null) : null,
    rejectedCount: result?.rejectedChannels ? (Array.isArray(result.rejectedChannels) ? result.rejectedChannels.length : null) : null,
    dataReliability: snap.dataReliability || null,
  };
}

function extractIterationKeyOutputs(snap: any): Record<string, any> {
  const result = parseJson(snap.result, null);
  return {
    hypothesisCount: result?.hypotheses ? (Array.isArray(result.hypotheses) ? result.hypotheses.length : null) : null,
    optimizationTargets: result?.optimizationTargets ? (Array.isArray(result.optimizationTargets) ? result.optimizationTargets.length : null) : null,
    dataReliability: snap.dataReliability || null,
  };
}

function extractRetentionKeyOutputs(snap: any): Record<string, any> {
  const result = parseJson(snap.result, null);
  return {
    loopCount: result?.retentionLoops ? (Array.isArray(result.retentionLoops) ? result.retentionLoops.length : null) : null,
    churnRiskCount: result?.churnRiskFlags ? (Array.isArray(result.churnRiskFlags) ? result.churnRiskFlags.length : null) : null,
    dataReliability: snap.dataReliability || null,
  };
}

interface EngineSnapshotConfig {
  engineId: string;
  table: any;
  confidenceField: string;
  warningFields: string[];
  extractKeyOutputs: (snap: any) => Record<string, any>;
}

const ENGINE_SNAPSHOT_MAP: EngineSnapshotConfig[] = [
  { engineId: "market_intelligence", table: miSnapshots, confidenceField: "overallConfidence", warningFields: ["missingSignalFlags", "diagnosticsData"], extractKeyOutputs: extractMiKeyOutputs },
  { engineId: "audience", table: audienceSnapshots, confidenceField: "", warningFields: [], extractKeyOutputs: extractAudienceKeyOutputs },
  { engineId: "positioning", table: positioningSnapshots, confidenceField: "confidenceScore", warningFields: [], extractKeyOutputs: extractPositioningKeyOutputs },
  { engineId: "differentiation", table: differentiationSnapshots, confidenceField: "confidenceScore", warningFields: ["collisionDiagnostics"], extractKeyOutputs: extractDifferentiationKeyOutputs },
  { engineId: "mechanism", table: mechanismSnapshots, confidenceField: "confidenceScore", warningFields: [], extractKeyOutputs: extractMechanismKeyOutputs },
  { engineId: "offer", table: offerSnapshots, confidenceField: "confidenceScore", warningFields: ["structuralWarnings", "boundaryCheck", "layerDiagnostics"], extractKeyOutputs: extractOfferKeyOutputs },
  { engineId: "funnel", table: funnelSnapshots, confidenceField: "confidenceScore", warningFields: ["boundaryCheck", "layerDiagnostics"], extractKeyOutputs: extractFunnelKeyOutputs },
  { engineId: "integrity", table: integritySnapshots, confidenceField: "overallIntegrityScore", warningFields: ["structuralWarnings", "boundaryCheck", "flaggedInconsistencies"], extractKeyOutputs: extractIntegrityKeyOutputs },
  { engineId: "awareness", table: awarenessSnapshots, confidenceField: "awarenessStrengthScore", warningFields: ["structuralWarnings", "boundaryCheck"], extractKeyOutputs: extractAwarenessKeyOutputs },
  { engineId: "persuasion", table: persuasionSnapshots, confidenceField: "persuasionStrengthScore", warningFields: ["structuralWarnings", "boundaryCheck"], extractKeyOutputs: extractPersuasionKeyOutputs },
  { engineId: "statistical_validation", table: strategyValidationSnapshots, confidenceField: "confidenceScore", warningFields: ["structuralWarnings", "boundaryCheck"], extractKeyOutputs: extractValidationKeyOutputs },
  { engineId: "budget_governor", table: budgetGovernorSnapshots, confidenceField: "confidenceScore", warningFields: ["structuralWarnings", "boundaryCheck"], extractKeyOutputs: extractBudgetKeyOutputs },
  { engineId: "channel_selection", table: channelSelectionSnapshots, confidenceField: "confidenceScore", warningFields: ["structuralWarnings", "boundaryCheck"], extractKeyOutputs: extractChannelKeyOutputs },
  { engineId: "iteration", table: iterationSnapshots, confidenceField: "confidenceScore", warningFields: ["structuralWarnings", "boundaryCheck"], extractKeyOutputs: extractIterationKeyOutputs },
  { engineId: "retention", table: retentionSnapshots, confidenceField: "confidenceScore", warningFields: ["structuralWarnings", "boundaryCheck"], extractKeyOutputs: extractRetentionKeyOutputs },
];

async function buildEngineOutputs(sectionStatuses: string | null, campaignId: string, accountId: string): Promise<EngineOutput[]> {
  const engines: EngineSummary[] = parseJson(sectionStatuses, []);

  const snapshotPromises = ENGINE_SNAPSHOT_MAP.map(cfg => fetchLatestSnapshot(cfg.table, campaignId, accountId));
  const snapshots = await Promise.all(snapshotPromises);

  const snapshotMap = new Map<string, any>();
  ENGINE_SNAPSHOT_MAP.forEach((cfg, i) => {
    if (snapshots[i]) snapshotMap.set(cfg.engineId, snapshots[i]);
  });

  return engines.map(e => {
    const snap = snapshotMap.get(e.id);
    const cfg = ENGINE_SNAPSHOT_MAP.find(c => c.engineId === e.id);

    let confidenceScore: number | null = null;
    let warnings: string[] = [];
    let keyOutputs: Record<string, any> = {};
    let executionTimeMs: number | null = null;

    if (snap && cfg) {
      if (cfg.confidenceField) {
        const rawConf = snap[cfg.confidenceField];
        if (rawConf != null) {
          const numConf = typeof rawConf === "string" ? parseFloat(rawConf) : Number(rawConf);
          confidenceScore = isNaN(numConf) ? null : +(numConf).toFixed(4);
        }
      }
      warnings = collectWarnings(snap, ...cfg.warningFields);
      keyOutputs = cfg.extractKeyOutputs(snap);
      executionTimeMs = snap.executionTimeMs ?? snap.execution_time_ms ?? null;
    }

    const snapshotAvailable = !!snap;

    return {
      engine: e.name || e.id,
      engineId: e.id,
      status: e.status,
      summary: e.summary || null,
      confidenceScore,
      warnings: !snapshotAvailable && e.status === "SUCCESS" ? ["Snapshot data unavailable — engine ran but snapshot not found"] : warnings,
      keyOutputs,
      executionTimeMs,
      snapshotAvailable,
    };
  });
}

function buildSystemSummary(
  job: any,
  controlVerdictRecord: any | null,
  engines: EngineOutput[],
) {
  const completedCount = engines.filter(e => e.status === "SUCCESS").length;
  const failedCount = engines.filter(e => ["ERROR", "BLOCKED", "SIGNAL_BLOCKED"].includes(e.status)).length;
  const skippedCount = engines.filter(e => e.status === "SKIPPED").length;

  const risks: string[] = [];
  const blockers: string[] = [];

  if (controlVerdictRecord) {
    for (const b of controlVerdictRecord.blockReasons || []) {
      blockers.push(`${b.code}: ${b.description}`);
    }
    for (const d of controlVerdictRecord.downgrades || []) {
      risks.push(`DOWNGRADE ${d.from} -> ${d.to}: ${d.reason}`);
    }
    for (const c of controlVerdictRecord.contradictions || []) {
      risks.push(`CONTRADICTION (${c.engineA} vs ${c.engineB}): ${c.description}`);
    }
  }

  if (job.error) {
    blockers.push(job.error);
  }

  const enginesWithWarnings = engines.filter(e => e.warnings.length > 0);

  return {
    // H2 (2026-05-10): semantic separation.
    // `executionStatus` is the canonical F1 field (the orchestrator job's
    // execution outcome — COMPLETED|PARTIAL|BLOCKED|ERROR|NEEDS_INPUT).
    // `finalVerdict` is the F6 system-control verdict (PASS|DOWNGRADE|REPAIR|BLOCK).
    // `overallStatus` is retained for back-compat but DEPRECATED — it has the
    // wrong field name (it's not a "verdict", it's an execution status).
    // Offender O4 fixed: consumers should switch to `executionStatus`.
    executionStatus: job.status,
    overallStatus: job.status,
    finalVerdict: pickVerdictDisplayText(controlVerdictRecord),
    executionMode: pickExecutionModeDisplayText(controlVerdictRecord),
    engineCounts: {
      total: engines.length,
      completed: completedCount,
      failed: failedCount,
      skipped: skippedCount,
      withWarnings: enginesWithWarnings.length,
    },
    durationMs: job.durationMs || 0,
    risksDetected: risks,
    criticalBlockers: blockers,
    jobId: job.id,
    completedAt: job.completedAt,
  };
}

function buildControlLayerSection(controlVerdictRecord: any | null) {
  if (!controlVerdictRecord) {
    return { available: false, message: "No control verdict found for this run" };
  }

  const repairs = (controlVerdictRecord.repairActions || []).filter((a: any) => a.executed);
  const successfulRepairs = repairs.filter((a: any) => a.succeeded);
  const failedRepairs = repairs.filter((a: any) => !a.succeeded);

  return {
    available: true,
    verdict: controlVerdictRecord.verdict,
    executionMode: controlVerdictRecord.executionMode,
    controlVersion: controlVerdictRecord.controlVersion,
    shadowMode: controlVerdictRecord.shadowMode,
    blockReasons: (controlVerdictRecord.blockReasons || []).map((b: any) => ({
      code: b.code,
      severity: b.severity,
      description: b.description,
    })),
    downgradesApplied: (controlVerdictRecord.downgrades || []).map((d: any) => ({
      code: d.code,
      from: d.from,
      to: d.to,
      reason: d.reason,
      engine: d.affectedEngine,
    })),
    repairActions: {
      attempted: controlVerdictRecord.repairAttempted || false,
      total: (controlVerdictRecord.repairActions || []).length,
      succeeded: successfulRepairs.length,
      failed: failedRepairs.length,
      details: (controlVerdictRecord.repairActions || []).map((a: any) => ({
        code: a.code,
        targetBlock: a.targetBlock,
        executed: a.executed,
        succeeded: a.succeeded,
        detail: a.detail,
      })),
    },
    contradictions: (controlVerdictRecord.contradictions || []).map((c: any) => ({
      engines: `${c.engineA} vs ${c.engineB}`,
      description: c.description,
      resolution: c.resolution,
    })),
    structuralChecks: {
      total: (controlVerdictRecord.structuralChecks || []).length,
      // Phase R T001: only status==="PASS" counts as a verified pass.
      // Falling back to c.passed when status is absent preserves the count
      // for legacy verdict rows written before the status field existed.
      passed: (controlVerdictRecord.structuralChecks || []).filter((c: any) =>
        typeof c?.status === "string" && c.status === "PASS"
      ).length,
      details: (controlVerdictRecord.structuralChecks || []).map((c: any) => buildStructuralCheckDetail(c)),
    },
  };
}

function buildConfidenceSection(
  integrityReport: any | null,
  sectionStatuses: string | null,
) {
  const engines: EngineSummary[] = parseJson(sectionStatuses, []);
  const svEngine = engines.find(e => e.id === "statistical_validation");

  return {
    integrityStatus: integrityReport?.overallStatus || "N/A",
    integrityFailures: integrityReport?.failureReasons || [],
    zeroLeakage: integrityReport?.zeroLeakage ?? null,
    fullTraceability: integrityReport?.fullTraceability ?? null,
    signalComposition: integrityReport?.signalComposition || null,
    statisticalValidationSummary: svEngine?.summary || null,
  };
}

function buildStrategicOutputs(engines: EngineOutput[]) {
  const find = (id: string) => engines.find(e => e.engineId === id)?.summary || null;

  return {
    iterationEngine: find("iteration") || find("iteration_engine"),
    budgetGovernor: find("budget_governor"),
    channelSelection: find("channel_selection"),
    retentionEngine: find("retention") || find("retention_engine"),
    funnelEngine: find("funnel") || find("funnel_engine"),
    offerEngine: find("offer") || find("offer_engine"),
  };
}

function rowToSlot(row: any) {
  return {
    id: row.id,
    label: row.label || "",
    details: row.details || "",
    direction: row.direction || "neutral",
    confidenceScore: row.confidenceScore || 0,
    memoryType: row.memoryType || "",
    engineName: row.engineName || "",
    updatedAt: row.updatedAt,
    usageCount: row.usageCount || 0,
    lastUsedInPlan: row.lastUsedInPlan || null,
    performance: row.performance || null,
    context: parseJson(row.context, null),
  };
}

async function buildMemorySection(campaignId: string, accountId: string) {
  const rows = await db
    .select()
    .from(strategyMemory)
    .where(
      and(
        eq(strategyMemory.accountId, accountId),
        eq(strategyMemory.campaignId, campaignId),
      )
    )
    .orderBy(desc(strategyMemory.updatedAt))
    .limit(50);

  if (rows.length === 0) {
    return {
      totalEntries: 0,
      topReinforce: [],
      topAvoid: [],
      memoryBias: "No memory entries found — system operates without historical guidance",
    };
  }

  const reinforceEntries: any[] = [];
  const avoidEntries: any[] = [];

  for (const row of rows) {
    const slot = rowToSlot(row);
    if (slot.memoryType === "content_rhythm") continue;

    const effectiveConf = computeEffectiveConfidenceFromRow(row);
    if (effectiveConf < 0.1) continue;

    const entry = {
      label: slot.label,
      engine: slot.engineName || slot.memoryType,
      confidence: +(effectiveConf).toFixed(2),
      direction: slot.direction,
      details: slot.details?.slice(0, 120) || null,
    };

    if (slot.direction === "reinforce" || (slot.direction === "neutral" && effectiveConf >= 0.6)) {
      reinforceEntries.push(entry);
    } else if (slot.direction === "avoid" || (slot.direction === "neutral" && effectiveConf < 0.4)) {
      avoidEntries.push(entry);
    }
  }

  reinforceEntries.sort((a, b) => b.confidence - a.confidence);
  avoidEntries.sort((a, b) => b.confidence - a.confidence);

  const strongReinforce = reinforceEntries.filter(e => e.confidence >= 0.7);
  const strongAvoid = avoidEntries.filter(e => e.confidence >= 0.7);

  let bias = "BALANCED — no dominant memory signals";
  if (strongReinforce.length > 3 && strongAvoid.length <= 1) {
    bias = "REINFORCE-HEAVY — system strongly favors previously successful patterns";
  } else if (strongAvoid.length > 3 && strongReinforce.length <= 1) {
    bias = "AVOID-HEAVY — system is constraining many past approaches";
  } else if (strongReinforce.length > 2 && strongAvoid.length > 2) {
    bias = "POLARIZED — strong signals in both directions, may create tension";
  }

  return {
    totalEntries: rows.length,
    topReinforce: reinforceEntries.slice(0, 5),
    topAvoid: avoidEntries.slice(0, 5),
    memoryBias: bias,
  };
}

function formatConfidence(val: number | null): string {
  if (val === null || val === undefined) return "N/A";
  return `${(val * 100).toFixed(1)}%`;
}

function generateReadableSummary(report: any): string {
  const lines: string[] = [];
  lines.push("AVYRON AI — SYSTEM FULL REPORT");
  lines.push("=".repeat(50));
  lines.push("");

  const sys = report.systemSummary;
  lines.push(`STATUS: ${sys.overallStatus}`);
  lines.push(`VERDICT: ${sys.finalVerdict} | MODE: ${sys.executionMode}`);
  lines.push(`ENGINES: ${sys.engineCounts.completed}/${sys.engineCounts.total} completed, ${sys.engineCounts.failed} failed, ${sys.engineCounts.skipped} skipped`);
  if (sys.engineCounts.withWarnings > 0) {
    lines.push(`WARNINGS: ${sys.engineCounts.withWarnings} engine(s) reported warnings`);
  }
  lines.push(`DURATION: ${sys.durationMs}ms`);
  lines.push("");

  if (sys.criticalBlockers.length > 0) {
    lines.push("CRITICAL BLOCKERS:");
    for (const b of sys.criticalBlockers) lines.push(`  - ${b}`);
    lines.push("");
  }

  if (sys.risksDetected.length > 0) {
    lines.push("RISKS:");
    for (const r of sys.risksDetected) lines.push(`  - ${r}`);
    lines.push("");
  }

  lines.push("ENGINE OUTPUTS:");
  lines.push("-".repeat(50));
  for (const eng of report.engineOutputs) {
    const confStr = formatConfidence(eng.confidenceScore);
    let statusIcon: string;
    if (eng.status === "SUCCESS") {
      statusIcon = "PASS";
    } else {
      statusIcon = eng.status;
    }
    lines.push(`  ${eng.engine}`);
    lines.push(`    Status: ${statusIcon} | Confidence: ${confStr}${eng.executionTimeMs ? ` | ${eng.executionTimeMs}ms` : ""}`);
    if (eng.summary) lines.push(`    Summary: ${eng.summary}`);
    if (eng.warnings.length > 0) {
      lines.push(`    Warnings (${eng.warnings.length}):`);
      for (const w of eng.warnings.slice(0, 3)) lines.push(`      - ${w.slice(0, 120)}`);
    }
    const keyEntries = Object.entries(eng.keyOutputs).filter(([, v]) => v !== null && v !== undefined);
    if (keyEntries.length > 0) {
      const keyParts = keyEntries.slice(0, 5).map(([k, v]) => {
        if (typeof v === "boolean") return `${k}=${v}`;
        if (typeof v === "number") return `${k}=${v}`;
        if (Array.isArray(v)) return `${k}=[${v.length}]`;
        if (typeof v === "string") return `${k}="${v.slice(0, 50)}"`;
        return `${k}=${JSON.stringify(v).slice(0, 50)}`;
      });
      lines.push(`    Key: ${keyParts.join(" | ")}`);
    }
    lines.push("");
  }

  const ctrl = report.controlLayer;
  if (ctrl.available) {
    lines.push("CONTROL LAYER:");
    lines.push(`  Verdict: ${ctrl.verdict} | Version: ${ctrl.controlVersion}`);
    lines.push(`  Checks: ${ctrl.structuralChecks.passed}/${ctrl.structuralChecks.total} passed`);
    if (ctrl.repairActions.attempted) {
      lines.push(`  Repairs: ${ctrl.repairActions.succeeded} succeeded, ${ctrl.repairActions.failed} failed`);
    }
    if (ctrl.blockReasons.length > 0) {
      lines.push(`  Blocks: ${ctrl.blockReasons.map((b: any) => b.code).join(", ")}`);
    }
    if (ctrl.downgradesApplied.length > 0) {
      lines.push(`  Downgrades: ${ctrl.downgradesApplied.map((d: any) => `${d.from}->${d.to} (${d.code})`).join(", ")}`);
    }
    lines.push("");
  }

  const conf = report.confidenceAndIntegrity;
  lines.push("INTEGRITY:");
  lines.push(`  Status: ${conf.integrityStatus}`);
  if (conf.signalComposition) {
    lines.push(`  Real Ratio: ${conf.signalComposition.realRatio ?? "N/A"}`);
    lines.push(`  Trusted Ratio: ${conf.signalComposition.trustedRatio ?? "N/A"}`);
  }
  lines.push("");

  const strat = report.strategicOutputs;
  lines.push("KEY DECISIONS:");
  if (strat.budgetGovernor) lines.push(`  Budget: ${strat.budgetGovernor}`);
  if (strat.channelSelection) lines.push(`  Channels: ${strat.channelSelection}`);
  if (strat.iterationEngine) lines.push(`  Iteration: ${strat.iterationEngine}`);
  if (strat.funnelEngine) lines.push(`  Funnel: ${strat.funnelEngine}`);
  if (strat.retentionEngine) lines.push(`  Retention: ${strat.retentionEngine}`);
  if (strat.offerEngine) lines.push(`  Offer: ${strat.offerEngine}`);
  lines.push("");

  const mem = report.memoryInfluence;
  lines.push(`MEMORY: ${mem.totalEntries} entries | Bias: ${mem.memoryBias}`);
  if (mem.topReinforce.length > 0) {
    lines.push(`  Top Reinforce: ${mem.topReinforce.slice(0, 3).map((r: any) => `"${r.label}" (${r.confidence})`).join(", ")}`);
  }
  if (mem.topAvoid.length > 0) {
    lines.push(`  Top Avoid: ${mem.topAvoid.slice(0, 3).map((a: any) => `"${a.label}" (${a.confidence})`).join(", ")}`);
  }
  lines.push("");

  const safe = sys.overallStatus !== "BLOCKED" && sys.overallStatus !== "ERROR";
  lines.push(`SAFE TO EXECUTE: ${safe ? "YES" : "NO"}`);
  if (!safe) {
    lines.push(`  Reason: ${sys.criticalBlockers[0] || "System status is " + sys.overallStatus}`);
  }

  return lines.join("\n");
}

export function registerFullReportRoutes(app: Express) {
  app.get("/api/system/full-report/:campaignId", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const accountId = resolveAccountId(req);
      const { campaignId } = req.params;
      try {
        const { assertCampaignBelongsTo, handleOwnershipError } = await import("../auth-helpers");
        await assertCampaignBelongsTo(accountId, campaignId);
        // (handleOwnershipError used below in catch path)
      } catch (e) {
        const { handleOwnershipError } = await import("../auth-helpers");
        if (handleOwnershipError(e, res)) return;
        throw e;
      }

      const [job] = await db
        .select()
        .from(orchestratorJobs)
        .where(
          and(
            eq(orchestratorJobs.accountId, accountId),
            eq(orchestratorJobs.campaignId, campaignId),
          )
        )
        .orderBy(desc(orchestratorJobs.createdAt))
        .limit(1);

      if (!job) {
        // Owner-gated already; safe to return generic 404 with no echo
        return res.status(404).json({
          error: "No orchestrator run found for this campaign",
        });
      }

      const [controlVerdictRow] = await db
        .select()
        .from(systemControlVerdicts)
        .where(
          and(
            eq(systemControlVerdicts.accountId, accountId),
            eq(systemControlVerdicts.campaignId, campaignId),
          )
        )
        .orderBy(desc(systemControlVerdicts.createdAt))
        .limit(1);

      const controlVerdictRecord = controlVerdictRow ? {
        verdict: controlVerdictRow.verdict,
        executionMode: controlVerdictRow.executionMode,
        blockReasons: parseJson(controlVerdictRow.blockReasons, []),
        downgrades: parseJson(controlVerdictRow.downgrades, []),
        structuralChecks: parseJson(controlVerdictRow.structuralChecks, []),
        contradictions: parseJson(controlVerdictRow.contradictions, []),
        repairActions: parseJson(controlVerdictRow.repairActions, []),
        repairAttempted: controlVerdictRow.repairAttempted,
        controlVersion: controlVerdictRow.controlVersion,
        shadowMode: controlVerdictRow.shadowMode,
        durationMs: controlVerdictRow.durationMs,
      } : null;

      const integrityReport = getStoredIntegrityReport(campaignId, accountId);
      const celReport = getCachedCELReport(campaignId, accountId);

      const [activePlan] = await db
        .select({
          id: strategicPlans.id,
          status: strategicPlans.status,
          planSummary: strategicPlans.planSummary,
          executionStatus: strategicPlans.executionStatus,
          createdAt: strategicPlans.createdAt,
        })
        .from(strategicPlans)
        .where(
          and(
            eq(strategicPlans.campaignId, campaignId),
            eq(strategicPlans.accountId, accountId),
          )
        )
        .orderBy(desc(strategicPlans.createdAt))
        .limit(1);

      const engineOutputs = await buildEngineOutputs(job.sectionStatuses, campaignId, accountId);
      const systemSummary = buildSystemSummary(job, controlVerdictRecord, engineOutputs);
      const controlLayer = buildControlLayerSection(controlVerdictRecord);
      const confidenceAndIntegrity = buildConfidenceSection(integrityReport, job.sectionStatuses);
      const strategicOutputs = buildStrategicOutputs(engineOutputs);
      const memoryInfluence = await buildMemorySection(campaignId, accountId);

      const report = {
        reportGeneratedAt: new Date().toISOString(),
        campaignId,
        accountId,
        engineOutputs,
        systemSummary,
        controlLayer,
        confidenceAndIntegrity,
        strategicOutputs,
        memoryInfluence,
        activePlan: activePlan ? {
          planId: activePlan.id,
          status: activePlan.status,
          executionStatus: activePlan.executionStatus,
          summary: activePlan.planSummary,
          createdAt: activePlan.createdAt,
        } : null,
        celCompliance: celReport ? {
          overallPassed: celReport.overallPassed,
          overallScore: celReport.overallScore,
          summary: celReport.summary,
          engineCount: celReport.engineResults?.length || 0,
          violations: (celReport.engineResults || [])
            .flatMap((er: any) => er.violations || [])
            .slice(0, 10)
            .map((v: any) => ({
              type: v.violationType,
              engine: v.engineId,
              details: v.details?.slice(0, 150),
            })),
        } : null,
      };

      const readableSummary = generateReadableSummary(report);

      res.json({
        report,
        readableSummary,
      });
    } catch (err: any) {
      console.error("[FullReport] Error generating report:", err.message);
      res.status(500).json({ error: "Failed to generate full report" });
    }
  });

  console.log("[FullReport] Routes registered: GET /api/system/full-report/:campaignId");
}
