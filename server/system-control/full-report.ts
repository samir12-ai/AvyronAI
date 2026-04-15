import type { Express, Response } from "express";
import { db } from "../db";
import {
  orchestratorJobs,
  strategicPlans,
  strategyMemory,
  systemControlVerdicts,
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

interface EngineSummary {
  id: string;
  name: string;
  status: string;
  summary: string | null;
}

function buildEngineOutputs(sectionStatuses: string | null): any[] {
  const engines: EngineSummary[] = parseJson(sectionStatuses, []);
  return engines.map(e => ({
    engine: e.name || e.id,
    engineId: e.id,
    status: e.status,
    summary: e.summary || null,
  }));
}

function buildSystemSummary(
  job: any,
  controlVerdict: any | null,
  engines: any[],
) {
  const completedCount = engines.filter(e => e.status === "SUCCESS").length;
  const failedCount = engines.filter(e => ["ERROR", "BLOCKED", "SIGNAL_BLOCKED"].includes(e.status)).length;
  const skippedCount = engines.filter(e => e.status === "SKIPPED").length;

  const risks: string[] = [];
  const blockers: string[] = [];

  if (controlVerdict) {
    for (const b of controlVerdict.blockReasons || []) {
      blockers.push(`${b.code}: ${b.description}`);
    }
    for (const d of controlVerdict.downgrades || []) {
      risks.push(`DOWNGRADE ${d.from} -> ${d.to}: ${d.reason}`);
    }
    for (const c of controlVerdict.contradictions || []) {
      risks.push(`CONTRADICTION (${c.engineA} vs ${c.engineB}): ${c.description}`);
    }
  }

  if (job.error) {
    blockers.push(job.error);
  }

  return {
    overallStatus: job.status,
    finalVerdict: controlVerdict?.verdict || "N/A",
    executionMode: controlVerdict?.executionMode || "N/A",
    engineCounts: {
      total: engines.length,
      completed: completedCount,
      failed: failedCount,
      skipped: skippedCount,
    },
    durationMs: job.durationMs || 0,
    risksDetected: risks,
    criticalBlockers: blockers,
    jobId: job.id,
    completedAt: job.completedAt,
  };
}

function buildControlLayerSection(controlVerdict: any | null) {
  if (!controlVerdict) {
    return { available: false, message: "No control verdict found for this run" };
  }

  const repairs = (controlVerdict.repairActions || []).filter((a: any) => a.executed);
  const successfulRepairs = repairs.filter((a: any) => a.succeeded);
  const failedRepairs = repairs.filter((a: any) => !a.succeeded);

  return {
    available: true,
    verdict: controlVerdict.verdict,
    executionMode: controlVerdict.executionMode,
    controlVersion: controlVerdict.controlVersion,
    shadowMode: controlVerdict.shadowMode,
    blockReasons: (controlVerdict.blockReasons || []).map((b: any) => ({
      code: b.code,
      severity: b.severity,
      description: b.description,
    })),
    downgradesApplied: (controlVerdict.downgrades || []).map((d: any) => ({
      code: d.code,
      from: d.from,
      to: d.to,
      reason: d.reason,
      engine: d.affectedEngine,
    })),
    repairActions: {
      attempted: controlVerdict.repairAttempted || false,
      total: (controlVerdict.repairActions || []).length,
      succeeded: successfulRepairs.length,
      failed: failedRepairs.length,
      details: (controlVerdict.repairActions || []).map((a: any) => ({
        code: a.code,
        targetBlock: a.targetBlock,
        executed: a.executed,
        succeeded: a.succeeded,
        detail: a.detail,
      })),
    },
    contradictions: (controlVerdict.contradictions || []).map((c: any) => ({
      engines: `${c.engineA} vs ${c.engineB}`,
      description: c.description,
      resolution: c.resolution,
    })),
    structuralChecks: {
      total: (controlVerdict.structuralChecks || []).length,
      passed: (controlVerdict.structuralChecks || []).filter((c: any) => c.passed).length,
      details: (controlVerdict.structuralChecks || []).map((c: any) => ({
        check: c.check,
        passed: c.passed,
        details: c.details,
      })),
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

function buildStrategicOutputs(sectionStatuses: string | null) {
  const engines: EngineSummary[] = parseJson(sectionStatuses, []);

  const find = (id: string) => engines.find(e => e.id === id)?.summary || null;

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

function generateReadableSummary(report: any): string {
  const lines: string[] = [];
  lines.push("AVYRON AI — SYSTEM FULL REPORT");
  lines.push("=".repeat(50));
  lines.push("");

  const sys = report.systemSummary;
  lines.push(`STATUS: ${sys.overallStatus}`);
  lines.push(`VERDICT: ${sys.finalVerdict} | MODE: ${sys.executionMode}`);
  lines.push(`ENGINES: ${sys.engineCounts.completed}/${sys.engineCounts.total} completed, ${sys.engineCounts.failed} failed, ${sys.engineCounts.skipped} skipped`);
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
        return res.status(404).json({
          error: "No orchestrator run found for this campaign",
          campaignId,
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

      const controlVerdict = controlVerdictRow ? {
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

      const engineOutputs = buildEngineOutputs(job.sectionStatuses);
      const systemSummary = buildSystemSummary(job, controlVerdict, engineOutputs);
      const controlLayer = buildControlLayerSection(controlVerdict);
      const confidenceAndIntegrity = buildConfidenceSection(integrityReport, job.sectionStatuses);
      const strategicOutputs = buildStrategicOutputs(job.sectionStatuses);
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
