import type { Express, Request, Response } from "express";
import { db } from "../../db";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  miSnapshots,
  retentionSnapshots,
  strategicPlans,
} from "@shared/schema";
import { requireCampaign } from "../../campaign-routes";
import { resolveAccountId } from "../../auth";
import { getDashboardMetrics } from "../../campaign-data-layer";
import { getAudienceFatigueSignal } from "./audience-fatigue-accessor";
import { classifyTrajectoryShift, classifyTrajectoryDelta } from "./trajectory-severity";
import {
  EarlyWarningResponseSchema,
  type EarlyWarningResponse,
  type RoasSignal,
  type CreativeFatigueSignal,
  type CompetitorTrajectoryShift,
  type RetentionRiskSignal,
  type Degradation,
  type EarlyWarningVerdict,
  type PlanSource,
  type SignalOriginDistribution,
  type SignalOriginType,
  type ValidationState,
} from "./shape";
import type { TrajectoryDelta } from "../../market-intelligence-v3/types";

const LOG = "[Monitor/EarlyWarning]";
const WINDOW_HOURS = 24;

function safeJsonParse<T = any>(raw: any): T | null {
  if (!raw) return null;
  if (typeof raw !== "string") return raw as T;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

function pickRoasMode(dashMode: string, dataSource: string): RoasSignal["mode"] {
  if (dataSource === "META") return "REAL";
  if (dataSource === "MANUAL") return "MANUAL";
  if (dataSource === "PLAN") return "PLAN";
  return "UNAVAILABLE";
}

async function composeRoasSignal(campaignId: string, accountId: string): Promise<{
  signal: RoasSignal;
  contractIncomplete: string[];
}> {
  const contractIncomplete: string[] = [];
  try {
    const metrics = await getDashboardMetrics(campaignId, accountId);
    const mode = pickRoasMode(metrics.mode, metrics.dataSource);
    const hasData = !!metrics.hasData;
    const value = hasData ? Number(metrics.metrics.roas ?? 0) : null;

    if (mode === "UNAVAILABLE" || value === null) {
      contractIncomplete.push("signals.roas.value");
      return {
        signal: {
          value: null,
          delta: null,
          mode: "UNAVAILABLE",
          signalOrigin: "unknown",
          degraded: {
            flag: true,
            reason: "No ROAS source data available (no META, manual, or plan signal)",
            source: "data_quality",
            signalOrigin: "unknown",
          },
          sourceEndpoint: "/api/dashboard/metrics",
        },
        contractIncomplete,
      };
    }

    const origin: SignalOriginType = mode === "REAL" || mode === "MANUAL" ? "real" : "inferred";
    return {
      signal: {
        value,
        delta: null,
        mode,
        signalOrigin: origin,
        degraded: mode === "PLAN"
          ? { flag: true, reason: "ROAS derived from plan progress, not real performance", source: "data_quality", signalOrigin: "inferred" }
          : null,
        sourceEndpoint: "/api/dashboard/metrics",
      },
      contractIncomplete,
    };
  } catch (err: any) {
    contractIncomplete.push("signals.roas.value");
    return {
      signal: {
        value: null,
        delta: null,
        mode: "UNAVAILABLE",
        signalOrigin: "unknown",
        degraded: {
          flag: true,
          reason: `ROAS fetch failed: ${err?.message ?? "unknown"}`,
          source: "fetch",
          signalOrigin: "unknown",
        },
        sourceEndpoint: "/api/dashboard/metrics",
      },
      contractIncomplete,
    };
  }
}

async function composeFatigueSignal(accountId: string): Promise<{
  signal: CreativeFatigueSignal;
  contractIncomplete: string[];
}> {
  const contractIncomplete: string[] = [];
  const fatigue = await getAudienceFatigueSignal(accountId);

  if (fatigue.severity === "unavailable") {
    contractIncomplete.push("signals.creativeFatigue.severity");
  }

  return {
    signal: {
      severity: fatigue.severity,
      affectedSurface: fatigue.affectedSurface,
      reasonCodes: fatigue.reasonCodes,
      signalOrigin: fatigue.signalOrigin,
      degraded: fatigue.degraded,
      sourceEndpoint: "/api/guardrails/fatigue",
    },
    contractIncomplete,
  };
}

async function composeTrajectorySignal(campaignId: string, accountId: string): Promise<{
  signal: CompetitorTrajectoryShift;
  contractIncomplete: string[];
}> {
  const contractIncomplete: string[] = [];
  try {
    const snapshots = await db.select().from(miSnapshots)
      .where(and(
        eq(miSnapshots.campaignId, campaignId),
        eq(miSnapshots.accountId, accountId),
        inArray(miSnapshots.status, ["COMPLETE", "PARTIAL"]),
      ))
      .orderBy(desc(miSnapshots.createdAt))
      .limit(2);

    // Phase 9 hardening: trajectory severity is a DELTA classifier. A single
    // snapshot has no prior baseline → defaulting `previous` to 0 fabricates
    // a delta that can falsely escalate severity. Require ≥2 snapshots; otherwise
    // emit `unknown` with `degraded.flag=true` (CONTRACT_INCOMPLETE per D5).
    if (snapshots.length < 2) {
      contractIncomplete.push("signals.competitorTrajectoryShift.severity");
      const reason = snapshots.length === 0
        ? "No MIv3 snapshots for this campaign"
        : "Only 1 MIv3 snapshot — trajectory delta requires a prior baseline";
      return {
        signal: {
          severity: "unknown",
          deltas: [],
          heating: null,
          angleSaturation: null,
          narrativeConvergence: null,
          signalOrigin: "unknown",
          degraded: {
            flag: true,
            reason,
            source: "missing_dependency",
            signalOrigin: "unknown",
          },
          sourceEndpoint: "/api/ci/mi-v3/trajectory",
        },
        contractIncomplete,
      };
    }

    const curr = snapshots[0];
    const prev = snapshots[1];
    const currTraj = safeJsonParse<any>((curr as any).trajectoryData) ?? {};
    const prevTraj = safeJsonParse<any>((prev as any).trajectoryData) ?? {};

    const fields = ["marketHeatingIndex", "narrativeConvergenceScore", "offerCompressionIndex", "angleSaturationLevel", "revivalPotential"];
    const deltas: Array<TrajectoryDelta & { severity: ReturnType<typeof classifyTrajectoryDelta> }> = [];
    for (const f of fields) {
      const prevVal = Number(prevTraj[f] ?? 0);
      const currVal = Number(currTraj[f] ?? 0);
      const d = currVal - prevVal;
      const td: TrajectoryDelta = { field: f, previous: prevVal, current: currVal, delta: d };
      deltas.push({ ...td, severity: classifyTrajectoryDelta(td) });
    }

    const severity = classifyTrajectoryShift(deltas);
    const isDegradedSnapshot = (curr as any).status === "PARTIAL";

    return {
      signal: {
        severity,
        deltas,
        heating: typeof currTraj.marketHeatingIndex === "number" ? currTraj.marketHeatingIndex : null,
        angleSaturation: typeof currTraj.angleSaturationLevel === "number" ? currTraj.angleSaturationLevel : null,
        narrativeConvergence: typeof currTraj.narrativeConvergenceScore === "number" ? currTraj.narrativeConvergenceScore : null,
        signalOrigin: "competitor",
        degraded: isDegradedSnapshot ? {
          flag: true,
          reason: "Latest MIv3 snapshot is PARTIAL (degraded inputs)",
          source: "data_quality",
          signalOrigin: "competitor",
        } : null,
        sourceEndpoint: "/api/ci/mi-v3/trajectory",
      },
      contractIncomplete,
    };
  } catch (err: any) {
    contractIncomplete.push("signals.competitorTrajectoryShift.severity");
    return {
      signal: {
        severity: "unknown",
        deltas: [],
        heating: null,
        angleSaturation: null,
        narrativeConvergence: null,
        signalOrigin: "unknown",
        degraded: {
          flag: true,
          reason: `Trajectory fetch failed: ${err?.message ?? "unknown"}`,
          source: "fetch",
          signalOrigin: "unknown",
        },
        sourceEndpoint: "/api/ci/mi-v3/trajectory",
      },
      contractIncomplete,
    };
  }
}

async function composeRetentionSignal(campaignId: string, accountId: string): Promise<{
  signal: RetentionRiskSignal;
  contractIncomplete: string[];
}> {
  const contractIncomplete: string[] = [];
  try {
    const [latest] = await db.select().from(retentionSnapshots)
      .where(and(
        eq(retentionSnapshots.campaignId, campaignId),
        eq(retentionSnapshots.accountId, accountId),
      ))
      .orderBy(desc(retentionSnapshots.createdAt))
      .limit(1);

    if (!latest) {
      contractIncomplete.push("signals.retentionRisk.severity");
      return {
        signal: {
          severity: "unavailable",
          churnIndicators: [],
          signalOrigin: "unknown",
          degraded: {
            flag: true,
            reason: "No retention engine snapshot for this campaign",
            source: "missing_dependency",
            signalOrigin: "unknown",
          },
          sourceEndpoint: "/api/strategy/retention-engine/latest",
        },
        contractIncomplete,
      };
    }

    const result = safeJsonParse<any>((latest as any).result) ?? {};
    const indicators: RetentionRiskSignal["churnIndicators"] = [];
    if (!Array.isArray(result.retentionLoops) || result.retentionLoops.length === 0) indicators.push("RETENTION_LOOPS_MISSING");
    if (Array.isArray(result.churnRiskFlags) && result.churnRiskFlags.length > 0) indicators.push("CHURN_RISK_FLAG");
    if (Array.isArray(result.ltvExpansionPaths) && result.ltvExpansionPaths.length === 0) indicators.push("LTV_COMPRESSION");
    if (Array.isArray(result.upsellTriggers) && result.upsellTriggers.length === 0) indicators.push("UPSELL_GAP");
    if (result.boundaryCheck && result.boundaryCheck.passed === false) indicators.push("BOUNDARY_VIOLATION");
    if (result.dataReliability && result.dataReliability.isWeak === true) indicators.push("WEAK_DATA_RELIABILITY");

    let severity: RetentionRiskSignal["severity"] = "none";
    const criticalCount = indicators.filter(i => i === "CHURN_RISK_FLAG" || i === "BOUNDARY_VIOLATION").length;
    if (criticalCount >= 1 && indicators.length >= 3) severity = "urgent";
    else if (criticalCount >= 1) severity = "risk";
    else if (indicators.length >= 2) severity = "watch";

    const weak = result.dataReliability && result.dataReliability.isWeak === true;

    return {
      signal: {
        severity,
        churnIndicators: indicators,
        signalOrigin: weak ? "inferred" : "real",
        degraded: weak ? {
          flag: true,
          reason: "Retention engine flagged weak data reliability",
          source: "data_quality",
          signalOrigin: "inferred",
        } : null,
        sourceEndpoint: "/api/strategy/retention-engine/latest",
      },
      contractIncomplete,
    };
  } catch (err: any) {
    contractIncomplete.push("signals.retentionRisk.severity");
    return {
      signal: {
        severity: "unavailable",
        churnIndicators: [],
        signalOrigin: "unknown",
        degraded: {
          flag: true,
          reason: `Retention fetch failed: ${err?.message ?? "unknown"}`,
          source: "fetch",
          signalOrigin: "unknown",
        },
        sourceEndpoint: "/api/strategy/retention-engine/latest",
      },
      contractIncomplete,
    };
  }
}

async function composePlanContext(campaignId: string, accountId: string): Promise<{
  planSource: PlanSource;
  fallbackPlanIsolated: boolean;
  planDegraded: Degradation | null;
}> {
  try {
    const [plan] = await db.select().from(strategicPlans)
      .where(and(
        eq(strategicPlans.campaignId, campaignId),
        eq(strategicPlans.accountId, accountId),
      ))
      .orderBy(desc(strategicPlans.createdAt))
      .limit(1);

    if (!plan) {
      return { planSource: "unknown", fallbackPlanIsolated: false, planDegraded: null };
    }

    const rawSource = (plan as any).planSource as string | null | undefined;
    const allowed: PlanSource[] = ["decision_driven", "degraded_no_decisions", "degraded_ai_failed", "deterministic_fallback"];
    const planSource: PlanSource = (rawSource && (allowed as string[]).includes(rawSource))
      ? (rawSource as PlanSource)
      : "unknown";
    const fallbackPlanIsolated = planSource === "deterministic_fallback" || planSource === "degraded_ai_failed";
    const degraded = (planSource === "degraded_ai_failed" || planSource === "degraded_no_decisions" || planSource === "deterministic_fallback")
      ? { flag: true as const, reason: `Plan source = ${planSource}`, source: "fallback_plan" as const, signalOrigin: "fallback" as const }
      : null;

    return { planSource, fallbackPlanIsolated, planDegraded: degraded };
  } catch {
    return { planSource: "unknown", fallbackPlanIsolated: false, planDegraded: null };
  }
}

function composeOriginDistribution(origins: SignalOriginType[]): SignalOriginDistribution {
  const dist: SignalOriginDistribution = { real: 0, competitor: 0, inferred: 0, fallback: 0, unknown: 0 };
  if (origins.length === 0) return dist;
  for (const o of origins) dist[o] += 1;
  const total = origins.length;
  (Object.keys(dist) as Array<keyof SignalOriginDistribution>).forEach(k => {
    dist[k] = +(dist[k] / total).toFixed(4);
  });
  return dist;
}

function composeValidationState(planSource: PlanSource, anyDegraded: boolean, contractIncompleteCount: number): ValidationState {
  if (planSource === "unknown" && contractIncompleteCount >= 3) return "unknown";
  if (planSource === "deterministic_fallback" || planSource === "degraded_ai_failed") return "weak";
  if (anyDegraded || contractIncompleteCount > 0) return "provisional";
  if (planSource === "decision_driven") return "validated";
  return "provisional";
}

function composeVerdict(args: {
  roas: RoasSignal;
  fatigue: CreativeFatigueSignal;
  trajectory: CompetitorTrajectoryShift;
  retention: RetentionRiskSignal;
  contractIncompleteFields: string[];
  trustedRatio: number;
}): { verdict: EarlyWarningVerdict; rationale: string } {
  const { roas, fatigue, trajectory, retention, contractIncompleteFields, trustedRatio } = args;

  // BLOCK: any system-control sourced degradation at critical/urgent severity.
  const allSignals = [roas, fatigue, trajectory, retention];
  const blockHit = allSignals.find(s =>
    s.degraded && s.degraded.source === "system-control"
  );
  if (blockHit) return { verdict: "BLOCK", rationale: `system-control degradation: ${blockHit.degraded!.reason}` };

  const fatigueCritical = fatigue.severity === "critical";
  const trajectoryCritical = trajectory.severity === "critical";
  const retentionUrgent = retention.severity === "urgent";
  if (fatigueCritical || trajectoryCritical || retentionUrgent) {
    const which = [
      fatigueCritical ? "creative fatigue" : null,
      trajectoryCritical ? "competitor trajectory" : null,
      retentionUrgent ? "retention risk" : null,
    ].filter(Boolean).join(", ");
    return { verdict: "ACT", rationale: `Critical signal(s): ${which}` };
  }

  const watchHit =
    fatigue.severity === "warn" ||
    trajectory.severity === "warn" ||
    trajectory.severity === "watch" ||
    retention.severity === "risk" ||
    retention.severity === "watch";
  if (watchHit) return { verdict: "WATCH", rationale: "One or more signals at warn/watch/risk" };

  const allNone =
    (roas.value !== null) &&
    fatigue.severity === "none" &&
    (trajectory.severity === "none") &&
    retention.severity === "none";
  if (allNone && contractIncompleteFields.length === 0 && trustedRatio >= 0.5) {
    return { verdict: "CALM", rationale: "All signals nominal; evidence-trusted" };
  }

  return { verdict: "WATCH", rationale: "INSUFFICIENT_EVIDENCE" };
}

export function registerMonitorEarlyWarningRoutes(app: Express) {
  app.get(
    "/api/monitor/early-warning/:campaignId",
    requireCampaign,
    async (req: Request, res: Response) => {
      const t0 = Date.now();
      try {
        const ctx = (req as any).campaignContext;
        const campaignId = String(req.params.campaignId);
        const accountId = String(ctx?.accountId || resolveAccountId(req));

        if (ctx && ctx.campaignId && ctx.campaignId !== campaignId) {
          return res.status(403).json({ error: "Campaign mismatch" });
        }

        const windowEnd = new Date();
        const windowStart = new Date(windowEnd.getTime() - WINDOW_HOURS * 60 * 60 * 1000);

        const [roasRes, fatigueRes, trajectoryRes, retentionRes, planCtx] = await Promise.all([
          composeRoasSignal(campaignId, accountId),
          composeFatigueSignal(accountId),
          composeTrajectorySignal(campaignId, accountId),
          composeRetentionSignal(campaignId, accountId),
          composePlanContext(campaignId, accountId),
        ]);

        const contractIncompleteFields = [
          ...roasRes.contractIncomplete,
          ...fatigueRes.contractIncomplete,
          ...trajectoryRes.contractIncomplete,
          ...retentionRes.contractIncomplete,
        ];

        const signalsList = [roasRes.signal, fatigueRes.signal, trajectoryRes.signal, retentionRes.signal];
        const origins: SignalOriginType[] = signalsList.map(s => s.signalOrigin);
        const distribution = composeOriginDistribution(origins);
        const trustedRatio = distribution.real + distribution.competitor;
        const anyDegraded = signalsList.some(s => s.degraded !== null) || planCtx.planDegraded !== null;

        const validationState = composeValidationState(planCtx.planSource, anyDegraded, contractIncompleteFields.length);

        const { verdict, rationale } = composeVerdict({
          roas: roasRes.signal,
          fatigue: fatigueRes.signal,
          trajectory: trajectoryRes.signal,
          retention: retentionRes.signal,
          contractIncompleteFields,
          trustedRatio,
        });

        const aggregateDegraded: Degradation | null = planCtx.planDegraded
          ?? (anyDegraded
            ? { flag: true, reason: "One or more source signals degraded", source: "data_quality", signalOrigin: "inferred" }
            : null);

        const response: EarlyWarningResponse = {
          campaignId,
          accountId,
          generatedAt: new Date().toISOString(),
          windowStart: windowStart.toISOString(),
          windowEnd: windowEnd.toISOString(),
          signalOrigin: distribution,
          degraded: aggregateDegraded,
          validationState,
          planSource: planCtx.planSource,
          fallbackPlanIsolated: planCtx.fallbackPlanIsolated,
          signals: {
            roas: roasRes.signal,
            creativeFatigue: fatigueRes.signal,
            competitorTrajectoryShift: trajectoryRes.signal,
            retentionRisk: retentionRes.signal,
          },
          earlyWarningVerdict: verdict,
          earlyWarningRationale: rationale,
          contractIncompleteFields,
        };

        const parsed = EarlyWarningResponseSchema.safeParse(response);
        if (!parsed.success) {
          console.error(`${LOG} SCHEMA_VALIDATION_FAILED`, parsed.error.flatten());
          return res.status(500).json({
            error: "EARLY_WARNING_SCHEMA_FAILED",
            details: parsed.error.flatten(),
          });
        }

        const ms = Date.now() - t0;
        console.log(`${LOG} verdict=${verdict} validationState=${validationState} planSource=${planCtx.planSource} incomplete=${contractIncompleteFields.length} ms=${ms}`);
        return res.json(parsed.data);
      } catch (err: any) {
        console.error(`${LOG} aggregator_failed`, err);
        return res.status(500).json({ error: "EARLY_WARNING_FAILED", details: err?.message ?? String(err) });
      }
    },
  );
}
