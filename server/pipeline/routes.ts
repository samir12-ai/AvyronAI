import { Router, type Request, type Response } from "express";
import { db } from "../db";
import { pipelineSnapshots, pipelineSignals, pipelineChangeEvents, pipelineAcquisitions } from "@shared/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { evaluateWindowState } from "./eval-windows";
import {
  readSnapshotsForRun,
  readSignalsForRun,
  readChangeEventsForRun,
  readAcquisitionByIdOrReject,
} from "./readers";
import { listRejections, rejectionStats } from "./rejection-log";
import { acceptUserTruth } from "./lanes/user/user-truth";
import { runUserLane } from "./lanes/user";
import { runCompetitorLane } from "./lanes/competitor";
import { bridgeLanes } from "./bridge";
import { getRun, listRuns } from "./runs";
import { PipelineValidationError } from "./errors";
import type { Lane } from "@shared/contracts";
import type { RunStatus } from "./runs";
import { authMiddleware, adminMiddleware } from "../auth";
import { acquire, getAcquisition, getAdapterRegistry, type AcquireInput, type CollectorEntityType, type CollectorLane } from "../collector";
import { runBoss, planBoss, listBossRuns, getBossRun, BossRunInFlightError, type BossScope, type BossTrigger } from "../boss";
import { withPipelineLaneLock, PipelineRunInFlightError } from "./run-lock";
import { createDna, activateDna, pauseDna, retireDna, editDnaHypothesis, listDnaForCampaign, listDnaVersions, getActiveDna, DnaLifecycleError } from "./dna";
import { assembleInterpretation } from "./ai-overlay/assemble";
import { isOverlayEnabled } from "./ai-overlay/client";

const router = Router();

// Phase 1 lockdown: pipeline routes require a valid Bearer token AND admin gating.
// Behavior testing must be performed through an authenticated admin context.
router.use(authMiddleware);
router.use(adminMiddleware);

function handleError(res: Response, err: unknown) {
  if (err instanceof PipelineValidationError) {
    return res.status(400).json(err.toJSON());
  }
  if (err instanceof PipelineRunInFlightError) {
    return res
      .status(409)
      .json({ error: "Conflict", code: err.code, message: err.message });
  }
  const message = err instanceof Error ? err.message : "unknown error";
  return res.status(500).json({ error: "InternalError", message });
}

router.post("/runs/user", async (req: Request, res: Response) => {
  try {
    const { accountId, campaignId, acquisitionId, entityId, source, payload, collectedAt } = req.body ?? {};
    // Phase 6.5 — first-class lineage. Every collected-lane run requires
    // accountId + campaignId + acquisitionId. Operators must mint an
    // acquisition through /collector/acquire before invoking a lane run.
    if (!accountId || !campaignId || !acquisitionId || !entityId || !source || !payload) {
      return res.status(400).json({
        error: "BadRequest",
        message: "accountId, campaignId, acquisitionId, entityId, source, payload required (Phase 6.5 lineage)",
      });
    }
    const result = await withPipelineLaneLock(accountId, campaignId, "user", () =>
      runUserLane({ accountId, campaignId, acquisitionId, entityId, source, payload, collectedAt }),
    );
    res.status(201).json(result);
  } catch (err) {
    handleError(res, err);
  }
});

router.post("/runs/competitor", async (req: Request, res: Response) => {
  try {
    const { accountId, campaignId, acquisitionId, entityId, source, payload, collectedAt, baselineSnapshotId } = req.body ?? {};
    if (!accountId || !campaignId || !acquisitionId || !entityId || !source || !payload) {
      return res.status(400).json({
        error: "BadRequest",
        message: "accountId, campaignId, acquisitionId, entityId, source, payload required (Phase 6.5 lineage)",
      });
    }
    const result = await withPipelineLaneLock(accountId, campaignId, "competitor", () =>
      runCompetitorLane({ accountId, campaignId, acquisitionId, entityId, source, payload, collectedAt, baselineSnapshotId }),
    );
    res.status(201).json(result);
  } catch (err) {
    handleError(res, err);
  }
});

router.post("/bridge", async (req: Request, res: Response) => {
  try {
    const { accountId, campaignId, competitorRunId, userRunId } = req.body ?? {};
    if (!accountId || !campaignId || !competitorRunId || !userRunId) {
      return res.status(400).json({
        error: "BadRequest",
        message: "accountId, campaignId, competitorRunId, userRunId required (Phase 6.5 lineage)",
      });
    }
    const result = await bridgeLanes({ accountId, campaignId, competitorRunId, userRunId });
    res.status(201).json(result);
  } catch (err) {
    handleError(res, err);
  }
});

router.get("/runs", async (req: Request, res: Response) => {
  try {
    const lane = req.query.lane as Lane | undefined;
    const status = req.query.status as RunStatus | undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const rows = await listRuns({ lane, status, limit });
    res.json({ count: rows.length, runs: rows });
  } catch (err) {
    handleError(res, err);
  }
});

// ── Collector smoke routes (T-2.12) ────────────────────────────────────────────
// Admin-only acquisition surface for controlled testing. The Collector is the
// single acquisition path for all new pipeline code — this route exposes that
// path over HTTP for the behavior harness and for debugging.
router.get("/collector/adapters", (_req: Request, res: Response) => {
  res.json({ adapters: getAdapterRegistry() });
});

router.post("/collector/acquire", async (req: Request, res: Response) => {
  try {
    const { accountId, campaignId, lane, entityType, entityId, scope, freshness } = req.body ?? {};
    if (!accountId || !campaignId || !lane || !entityType || !entityId) {
      return res.status(400).json({ error: "BadRequest", message: "accountId, campaignId, lane, entityType, entityId required" });
    }
    const input: AcquireInput = {
      accountId,
      campaignId,
      lane: lane as CollectorLane,
      entityType: entityType as CollectorEntityType,
      entityId,
      scope,
      freshness,
    };
    const envelope = await acquire(input);
    res.status(201).json(envelope);
  } catch (err) {
    handleError(res, err);
  }
});

router.get("/collector/acquisitions/:id", async (req: Request, res: Response) => {
  try {
    // Phase 6.5 — guarded read. Hard-rejects + logs if the acquisition row is
    // missing or has malformed payload/provenance JSON. No silent fallback.
    const view = await readAcquisitionByIdOrReject((req.params.id as string));
    res.json({
      ...view.row,
      payload: view.payload,
      provenance: view.provenance,
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ─── Phase 3 — Boss Agent admin smoke routes ──────────────────────
router.post("/boss/plan", async (req: Request, res: Response) => {
  try {
    const { accountId, campaignId, scope } = req.body ?? {};
    if (!accountId || !campaignId) {
      return res.status(400).json({ error: "BadRequest", message: "accountId and campaignId required" });
    }
    const plan = await planBoss(accountId, campaignId, scope as BossScope | undefined);
    res.json(plan);
  } catch (err) {
    handleError(res, err);
  }
});

router.post("/boss/run", async (req: Request, res: Response) => {
  try {
    const { accountId, campaignId, trigger, scope } = req.body ?? {};
    if (!accountId || !campaignId) {
      return res.status(400).json({ error: "BadRequest", message: "accountId and campaignId required" });
    }
    const t: BossTrigger = trigger === "approval" ? "approval" : "manual";
    const result = await runBoss({ accountId, campaignId, trigger: t, scope: scope as BossScope | undefined });
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof BossRunInFlightError) {
      return res.status(409).json({ error: "Conflict", code: err.code, message: err.message });
    }
    handleError(res, err);
  }
});

// ─── Phase 4 (Q2 SHIFTED) — operator-controlled rerun-on-fresh-data ──
// Strict pre-conditions, locked by Samir 2026-04-30:
//   1. Only triggered by an explicit operator click on the dashboard CTA
//      (no scheduler / autopilot path calls this route).
//   2. Only allowed when the parent boss run's q2Verdict === "SHIFTED".
//   3. Spawns a fresh boss run with forceFreshAcquisition=true; lineage to
//      the parent is recorded in scope.rerunOfBossRunId for the dashboard
//      breadcrumb. The pipeline does NOT branch on rerunOfBossRunId.
//   4. The parent run is preserved untouched. DNA is NOT auto-mutated by
//      this route — DNA changes still flow through the existing manual
//      DNA lifecycle (createDna / activateDna).
router.post("/boss/runs/:id/rerun-on-fresh-data", async (req: Request, res: Response) => {
  try {
    const parent = await getBossRun(req.params.id as string);
    if (!parent) {
      return res.status(404).json({ error: "NotFound", message: "boss run not found" });
    }
    if (parent.q2Verdict !== "SHIFTED") {
      return res.status(409).json({
        error: "Conflict",
        code: "Q2_NOT_SHIFTED",
        message: `rerun-on-fresh-data is only allowed on SHIFTED parents; this run has q2Verdict=${parent.q2Verdict ?? "null"}`,
      });
    }
    const parentScope = parent.scope ? JSON.parse(parent.scope) : {};
    const scope: BossScope = {
      forceFreshAcquisition: true,
      rerunOfBossRunId: parent.id,
      ...(Array.isArray(parentScope.onlyLanes) ? { onlyLanes: parentScope.onlyLanes } : {}),
      ...(Array.isArray(parentScope.onlyEntityIds) ? { onlyEntityIds: parentScope.onlyEntityIds } : {}),
    };
    const result = await runBoss({
      accountId: parent.accountId,
      campaignId: parent.campaignId,
      trigger: "manual",
      scope,
    });
    res.status(201).json({
      bossRunId: result.bossRunId,
      parentBossRunId: parent.id,
      status: result.status,
      questions: result.questions,
      forceFreshAcquisition: true,
    });
  } catch (err) {
    if (err instanceof BossRunInFlightError) {
      return res.status(409).json({ error: "Conflict", code: err.code, message: err.message });
    }
    handleError(res, err);
  }
});

router.get("/boss/runs", async (req: Request, res: Response) => {
  try {
    const { accountId, campaignId, status, limit } = req.query;
    const rows = await listBossRuns({
      accountId: typeof accountId === "string" ? accountId : undefined,
      campaignId: typeof campaignId === "string" ? campaignId : undefined,
      status: typeof status === "string" ? status : undefined,
      limit: typeof limit === "string" ? Math.max(1, Math.min(200, parseInt(limit, 10) || 50)) : undefined,
    });
    // Phase 8.1 — extract Q1 maturity interpretation from persisted reasons
    // and surface as a top-level `q1Interpretation` field. Single source of
    // truth lives in the boss DB; the overlay reads this field as-is, no
    // client-side parsing of the reasons array.
    const { extractInterpretation } = await import("../boss/policy/q1-maturity");
    const enriched = rows.map((r: any) => {
      const reasonsArr = r.q1Reasons ? (Array.isArray(r.q1Reasons) ? r.q1Reasons : (() => { try { return JSON.parse(r.q1Reasons); } catch { return []; } })()) : [];
      return { ...r, q1Interpretation: extractInterpretation(reasonsArr) };
    });
    res.json(enriched);
  } catch (err) {
    handleError(res, err);
  }
});

router.get("/boss/runs/:id", async (req: Request, res: Response) => {
  try {
    const row = await getBossRun((req.params.id as string));
    if (!row) return res.status(404).json({ error: "NotFound", message: "boss run not found" });
    const { extractInterpretation } = await import("../boss/policy/q1-maturity");
    const q1Reasons = row.q1Reasons ? JSON.parse(row.q1Reasons) : [];
    res.json({
      ...row,
      scope: row.scope ? JSON.parse(row.scope) : null,
      plan: row.plan ? JSON.parse(row.plan) : null,
      execution: row.execution ? JSON.parse(row.execution) : null,
      q1Reasons,
      q1Interpretation: extractInterpretation(q1Reasons),
      q2Reasons: row.q2Reasons ? JSON.parse(row.q2Reasons) : [],
      warnings: row.warnings ? JSON.parse(row.warnings) : [],
    });
  } catch (err) {
    handleError(res, err);
  }
});

// Phase 3.5 — single aggregate read for the read-only dashboard.
// Returns the boss row + each lane run with counts (NOT full rows) + acquisitions
// referenced in execution + the bridge run if present. No mutations, no caching.
router.get("/boss/runs/:id/lineage", async (req: Request, res: Response) => {
  try {
    const boss = await getBossRun((req.params.id as string));
    if (!boss) return res.status(404).json({ error: "NotFound", message: "boss run not found" });

    // Phase 8.1 — lineage is the endpoint the dashboard detail view actually
    // hits (overlay JS line 435: api("/boss/runs/" + id + "/lineage")). It
    // must surface q1Interpretation alongside the other top-level fields so
    // the overlay can render the maturity badge without parsing reasons
    // client-side. Single-source contract: extractInterpretation runs here
    // (route layer), overlay reads the field as-is.
    const { extractInterpretation } = await import("../boss/policy/q1-maturity");
    const lineageQ1Reasons = boss.q1Reasons ? JSON.parse(boss.q1Reasons) : [];
    const parsedBoss = {
      ...boss,
      scope: boss.scope ? JSON.parse(boss.scope) : null,
      plan: boss.plan ? JSON.parse(boss.plan) : null,
      execution: boss.execution ? JSON.parse(boss.execution) : null,
      q1Reasons: lineageQ1Reasons,
      q1Interpretation: extractInterpretation(lineageQ1Reasons),
      q2Reasons: boss.q2Reasons ? JSON.parse(boss.q2Reasons) : [],
      warnings: boss.warnings ? JSON.parse(boss.warnings) : [],
    };

    const exec = parsedBoss.execution as {
      acquisitions?: Array<{ acquisitionId: string }>;
      laneRuns?: Array<{ runId: string | null; lane: string; status: string; acquisitionId?: string | null; warnings?: string[]; reason?: string }>;
      bridgeRunId?: string | null;
    } | null;

    const laneRunSummaries: Array<{
      lane: string;
      status: string;
      runId: string | null;
      acquisitionId: string | null;
      reason: string | null;
      warnings: string[];
      snapshotCount: number;
      signalCount: number;
      changeEventCount: number;
      // Phase 4 — T-4.A.3: descriptive breakdown of change_events by canonical
      // severity (mild/medium/major). Sum equals changeEventCount. Read-only,
      // not used by any decision logic — exists purely so the dashboard can
      // surface the distribution that already drives Q2.
      severityCounts: { mild: number; medium: number; major: number };
    }> = [];

    for (const lr of exec?.laneRuns ?? []) {
      let snapshotCount = 0, signalCount = 0, changeEventCount = 0;
      const severityCounts = { mild: 0, medium: 0, major: 0 };
      if (lr.runId) {
        const [snaps, sigs, changes] = await Promise.all([
          db.select({ id: pipelineSnapshots.id }).from(pipelineSnapshots).where(eq(pipelineSnapshots.runId, lr.runId)),
          db.select({ id: pipelineSignals.id }).from(pipelineSignals).where(eq(pipelineSignals.runId, lr.runId)),
          // W-1 fence: kind IS NULL keeps this dashboard distribution aligned
          // with what actually drives Q2 (legacy rows only) — unconfirmed
          // Watchtower candidates must not inflate severity counts.
          db.select({ id: pipelineChangeEvents.id, severity: pipelineChangeEvents.severity }).from(pipelineChangeEvents).where(and(eq(pipelineChangeEvents.runId, lr.runId), isNull(pipelineChangeEvents.kind))),
        ]);
        snapshotCount = snaps.length;
        signalCount = sigs.length;
        changeEventCount = changes.length;
        for (const c of changes) {
          if (c.severity === "major") severityCounts.major++;
          else if (c.severity === "medium") severityCounts.medium++;
          else if (c.severity === "mild") severityCounts.mild++;
        }
      }
      laneRunSummaries.push({
        lane: lr.lane,
        status: lr.status,
        runId: lr.runId ?? null,
        acquisitionId: lr.acquisitionId ?? null,
        reason: lr.reason ?? null,
        warnings: lr.warnings ?? [],
        snapshotCount, signalCount, changeEventCount,
        severityCounts,
      });
    }

    let bridgeRunRow: any = null;
    if (exec?.bridgeRunId) {
      try { bridgeRunRow = await getRun(exec.bridgeRunId); } catch { bridgeRunRow = null; }
    }

    const acquisitionIds = (exec?.acquisitions ?? []).map(a => a.acquisitionId).filter(Boolean);
    const acquisitions = acquisitionIds.length
      ? await db.select().from(pipelineAcquisitions).where(inArray(pipelineAcquisitions.id, acquisitionIds))
      : [];

    // Phase 6.5 — strict provenance parse. No try/catch fallback, no silent {}.
    // Each acquisition is reloaded through the canonical reader so a malformed
    // provenance/payload row hard-rejects and surfaces in pipeline_rejections.
    const acquisitionsView: Array<{
      id: string; lane: string; entityType: string; entityId: string;
      sourceAdapter: string; collectedAt: any; ttlMs: number; ageMs: number;
      isFresh: boolean; cacheHit: boolean; warnings: any[];
    }> = [];
    for (const a of acquisitions) {
      try {
        const view = await readAcquisitionByIdOrReject(a.id, {
          accountId: parsedBoss.accountId, campaignId: parsedBoss.campaignId,
        });
        const collectedMs = view.row.collectedAt instanceof Date ? view.row.collectedAt.getTime() : new Date(view.row.collectedAt as any).getTime();
        const ageMs = Date.now() - collectedMs;
        const prov = view.provenance as { cache_hit?: boolean; warnings?: unknown[] };
        acquisitionsView.push({
          id: view.row.id,
          lane: view.row.lane,
          entityType: view.row.entityType,
          entityId: view.row.entityId,
          sourceAdapter: view.row.sourceAdapter,
          collectedAt: view.row.collectedAt,
          ttlMs: view.row.ttlMs,
          ageMs,
          isFresh: ageMs <= view.row.ttlMs,
          cacheHit: !!prov.cache_hit,
          warnings: Array.isArray(prov.warnings) ? prov.warnings : [],
        });
      } catch (err) {
        // Surface rejection; do not silently drop the row from the dashboard view.
        acquisitionsView.push({
          id: a.id, lane: a.lane, entityType: a.entityType, entityId: a.entityId,
          sourceAdapter: a.sourceAdapter, collectedAt: a.collectedAt, ttlMs: a.ttlMs,
          ageMs: -1, isFresh: false, cacheHit: false,
          warnings: [`integrity_rejection:${err instanceof Error ? err.message : String(err)}`],
        });
      }
    }

    // This is descriptive only — it's the same data already in execution.phase5,
    // pulled to the top level for the dashboard's banner/notice/pill consumers.
    const exec5 = (parsedBoss.execution ?? {}) as {
      rhythm_status?: string;
      truth_status?: string;
      evaluation_status?: string;
      evaluation_confidence?: string;
      truthAction?: string;
      phase5?: unknown;
    };
    const phase5 = {
      rhythm_status: exec5.rhythm_status ?? null,
      truth_status: exec5.truth_status ?? null,
      evaluation_status: exec5.evaluation_status ?? null,
      evaluation_confidence: exec5.evaluation_confidence ?? null,
      truthAction: exec5.truthAction ?? null,
      context: exec5.phase5 ?? null,
    };

    // Phase 6 — surface the DNA + cluster snapshot from execution.phase6.
    // Pure read-through; no recomputation. Q1 verdict is already in parsedBoss.
    const phase6 = (parsedBoss.execution as any)?.phase6 ?? null;

    res.json({
      boss: parsedBoss,
      laneRuns: laneRunSummaries,
      bridgeRun: bridgeRunRow,
      acquisitions: acquisitionsView,
      phase5,
      phase6,
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ─── Phase 8 — Controlled AI interpretation consumption ────────────
// Operator-initiated only. Dashboard fetches this endpoint when the
// operator clicks "Load AI interpretation" — never auto-fetched. Returns
// descriptive envelopes that the UI displays in a visually distinct
// panel labeled "AI INTERPRETATION (descriptive only)".
//
// The endpoint NEVER mutates the boss run. It does not change the verdict.
// Each overlay envelope carries its own status / error / trace so the UI
// can show exactly what happened (ok / disabled / error / unavailable).
router.get("/boss/runs/:id/explanation", async (req: Request, res: Response) => {
  try {
    const boss = await getBossRun((req.params.id as string));
    if (!boss) return res.status(404).json({ error: "NotFound", message: "boss run not found" });

    const q1Reasons: string[] = boss.q1Reasons ? JSON.parse(boss.q1Reasons) : [];
    const q2Reasons: string[] = boss.q2Reasons ? JSON.parse(boss.q2Reasons) : [];
    const execution = boss.execution ? JSON.parse(boss.execution) : null;
    const phase6 = (execution as any)?.phase6 ?? null;
    const clusterSignature = phase6?.cluster_production?.signature ?? null;
    const windowId = phase6?.cluster_production?.windowId ?? null;

    // Phase 7.4 — rebuild Q2EvaluationResult from persisted phase6.q2_inputs.
    // Persisted snapshot is the source of truth for the q2-reasoning overlay
    // — re-querying competitor tables would risk verdict / explanation drift
    // if data changed between the run and the explanation request.
    const q2Inputs = phase6?.q2_inputs ?? null;
    const q2EvalResult = q2Inputs && boss.q2Verdict
      ? {
          verdict: boss.q2Verdict as any,
          reasons: q2Reasons,
          ruleCode: q2Inputs.ruleCode,
          inputs: {
            competitor: q2Inputs.competitor,
            user: q2Inputs.user,
            dna: q2Inputs.dna,
            lookbackDays: q2Inputs.lookbackDays,
            // Phase 7.5 — surface the persisted Phase 7.3 interpretation so
            // the q2-reasoning overlay frames its commercial explanation off
            // the same structured signals the decision tree branched on.
            interpretation: q2Inputs.interpretation ?? undefined,
          },
        }
      : null;

    // Q1 interpretation is always available — verdict + reasons exist on
    // every boss run. Q2 is also available but we expose a single primary
    // narrative (Q1) plus a Q2 narrative; the UI surfaces them side-by-side.
    const [q1, q2] = await Promise.all([
      assembleInterpretation({
        accountId: boss.accountId,
        bossRunId: boss.id,
        question: "Q1",
        verdict: boss.q1Verdict as any,
        reasons: q1Reasons,
        context: { rhythm: (execution as any)?.rhythm_status ?? null, truth: (execution as any)?.truth_status ?? null },
        clusterSignature,
        windowId,
      }),
      assembleInterpretation({
        accountId: boss.accountId,
        bossRunId: boss.id,
        question: "Q2",
        verdict: boss.q2Verdict as any,
        reasons: q2Reasons,
        context: {},
        // DNA / competitor / user-interpretation overlays are scoped to Q1
        // (they describe DNA + interpretation). Q2 gets the explanation
        // translation plus the Phase 7.4 q2-reasoning overlay.
        clusterSignature: null,
        windowId: null,
        q2: q2EvalResult,
      }),
    ]);

    res.json({
      bossRunId: boss.id,
      enabled: isOverlayEnabled(),
      principle: "AI explains. The system decides.",
      consumptionContract: {
        rule_based_is_truth: true,
        ai_is_descriptive_only: true,
        ai_never_changes_verdict: true,
        ai_never_changes_numbers: true,
      },
      q1: {
        verdict: boss.q1Verdict,
        reasons: q1Reasons,
        ai: {
          explanation: q1.explanation,
          dna: q1.dna,
          competitor: q1.competitor,
          userInterpretation: q1.userInterpretation,
        },
      },
      q2: {
        verdict: boss.q2Verdict,
        reasons: q2Reasons,
        ai: {
          explanation: q2.explanation,
        },
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ─── Phase 5 — User truth intake (agent-driven, embedded in dashboard) ───
// Server is the single authority on windowId — derived from
// evaluateWindowState() at submit time. Client cannot pick the window.
router.post("/user-truth", async (req: Request, res: Response) => {
  try {
    const { campaignId, totalLeads, qualifiedLeads, bookedCalls, paidActive, accountId: bodyAccountId } = req.body ?? {};
    if (!campaignId) {
      return res.status(400).json({ error: "BadRequest", message: "campaignId required" });
    }
    const accountId = (req as any).user?.accountId ?? bodyAccountId;
    const submittedBy = (req as any).user?.id ?? null;

    // Server derives the window — client never picks.
    const ws = await evaluateWindowState(accountId, campaignId, new Date());
    if (!ws.window) {
      return res.status(409).json({
        error: "NoActiveWindow",
        code: "NO_ACTIVE_APPROVED_PLAN",
        message: "no active approved plan, cannot accept user truth",
        reasons: ws.reasons,
      });
    }

    const result = await acceptUserTruth({
      accountId,
      campaignId,
      windowId: ws.window.id,
      totalLeads,
      qualifiedLeads,
      bookedCalls,
      paidActive,
      submittedBy,
    });

    res.status(201).json({
      truth: result.truth,
      window: result.window,
      superseded: result.superseded,
    });
  } catch (err) {
    handleError(res, err);
  }
});

// Read endpoint for dashboard — current window state for a campaign.
router.get("/user-truth/window", async (req: Request, res: Response) => {
  try {
    const { accountId: q_account, campaignId } = req.query;
    if (!campaignId || typeof campaignId !== "string") {
      return res.status(400).json({ error: "BadRequest", message: "campaignId query param required" });
    }
    const accountId = (req as any).user?.accountId ?? (typeof q_account === "string" ? q_account : null);
    const ws = await evaluateWindowState(accountId, campaignId, new Date());
    res.json({
      window: ws.window,
      isDue: ws.isDue,
      isMissingTruth: ws.isMissingTruth,
      reasons: ws.reasons,
      activePlan: ws.activePlan
        ? {
          id: ws.activePlan.id,
          anchorAt: ws.activePlan.anchorAt.toISOString(),
          anchorFallbackUsed: ws.activePlan.anchorFallbackUsed,
        }
        : null,
    });
  } catch (err) {
    handleError(res, err);
  }
});

router.get("/runs/:id", async (req: Request, res: Response) => {
  try {
    const run = await getRun((req.params.id as string));
    // Phase 6.5 — guarded reads. Each row passes the canonical contract +
    // lineage assertion; integrity violations hard-reject and are logged.
    const expected = { accountId: run.accountId, campaignId: run.campaignId };
    const [snapshotViews, signalViews, changeEventViews] = await Promise.all([
      readSnapshotsForRun(run.id, expected),
      readSignalsForRun(run.id, expected),
      readChangeEventsForRun(run.id, expected),
    ]);
    res.json({
      run,
      snapshots: snapshotViews.map((v) => v.row),
      signals: signalViews.map((v) => v.row),
      changeEvents: changeEventViews.map((v) => v.row),
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ─── Phase 6.5 — Integrity Engineering rejection visibility ─────────
router.get("/rejections", async (req: Request, res: Response) => {
  try {
    const { reasonCode, boundary, campaignId, accountId, sinceHours, limit } = req.query;
    const sinceMs = typeof sinceHours === "string"
      ? Date.now() - Math.max(1, parseInt(sinceHours, 10) || 24) * 3600_000
      : undefined;
    const rows = await listRejections({
      reasonCode: typeof reasonCode === "string" ? reasonCode : undefined,
      boundary: typeof boundary === "string" ? (boundary as any) : undefined,
      campaignId: typeof campaignId === "string" ? campaignId : undefined,
      accountId: typeof accountId === "string" ? accountId : undefined,
      sinceMs,
      limit: typeof limit === "string" ? parseInt(limit, 10) : undefined,
    });
    res.json({
      count: rows.length,
      rejections: rows.map((r) => ({
        ...r,
        context: r.context ? JSON.parse(r.context) : null,
      })),
    });
  } catch (err) {
    handleError(res, err);
  }
});

router.get("/rejections/stats", async (req: Request, res: Response) => {
  try {
    const { sinceHours, campaignId } = req.query;
    const sinceMs = typeof sinceHours === "string"
      ? Date.now() - Math.max(1, parseInt(sinceHours, 10) || 24) * 3600_000
      : undefined;
    const rows = await rejectionStats({
      sinceMs,
      campaignId: typeof campaignId === "string" ? campaignId : undefined,
    });
    res.json({ stats: rows });
  } catch (err) {
    handleError(res, err);
  }
});

// ─── Phase 6 — DNA admin routes (admin-only writes; admin-only reads) ───
function handleDnaError(res: Response, err: unknown) {
  if (err instanceof DnaLifecycleError) {
    const code = err.code === "UNKNOWN_DNA" ? 404 : err.code === "INVALID_TRANSITION" ? 409 : 400;
    return res.status(code).json({ error: err.code, message: err.message });
  }
  return handleError(res, err);
}

router.get("/dna", async (req: Request, res: Response) => {
  try {
    const { campaignId, accountId: q_account } = req.query;
    if (!campaignId || typeof campaignId !== "string") {
      return res.status(400).json({ error: "BadRequest", message: "campaignId query param required" });
    }
    const accountId = (req as any).user?.accountId ?? (typeof q_account === "string" ? q_account : null);
    const rows = await listDnaForCampaign(accountId, campaignId);
    const active = rows.find((r) => r.status === "active") ?? null;
    res.json({ active, all: rows });
  } catch (err) { handleDnaError(res, err); }
});

router.post("/dna", async (req: Request, res: Response) => {
  try {
    const { campaignId, hypothesis, notes, accountId: bodyAccount } = req.body ?? {};
    if (!campaignId || !hypothesis) {
      return res.status(400).json({ error: "BadRequest", message: "campaignId and hypothesis required" });
    }
    const accountId = (req as any).user?.accountId ?? bodyAccount;
    const createdBy = (req as any).user?.id ?? null;
    const row = await createDna({ accountId, campaignId, hypothesis, createdBy, notes });
    res.status(201).json(row);
  } catch (err) { handleDnaError(res, err); }
});

router.post("/dna/:id/activate", async (req: Request, res: Response) => {
  try {
    const changedBy = (req as any).user?.id ?? null;
    const row = await activateDna({ dnaId: (req.params.id as string), changedBy, reason: req.body?.reason ?? null });
    res.json(row);
  } catch (err) { handleDnaError(res, err); }
});

router.post("/dna/:id/pause", async (req: Request, res: Response) => {
  try {
    const changedBy = (req as any).user?.id ?? null;
    const row = await pauseDna({ dnaId: (req.params.id as string), changedBy, reason: req.body?.reason ?? null });
    res.json(row);
  } catch (err) { handleDnaError(res, err); }
});

router.post("/dna/:id/retire", async (req: Request, res: Response) => {
  try {
    const changedBy = (req as any).user?.id ?? null;
    const row = await retireDna({ dnaId: (req.params.id as string), changedBy, reason: req.body?.reason ?? null });
    res.json(row);
  } catch (err) { handleDnaError(res, err); }
});

router.patch("/dna/:id", async (req: Request, res: Response) => {
  try {
    const { hypothesis, reason } = req.body ?? {};
    if (!hypothesis) return res.status(400).json({ error: "BadRequest", message: "hypothesis required" });
    const changedBy = (req as any).user?.id ?? null;
    const row = await editDnaHypothesis({ dnaId: (req.params.id as string), hypothesis, changedBy, reason: reason ?? null });
    res.json(row);
  } catch (err) { handleDnaError(res, err); }
});

router.get("/dna/:id/versions", async (req: Request, res: Response) => {
  try {
    const versions = await listDnaVersions((req.params.id as string));
    res.json({ count: versions.length, versions });
  } catch (err) { handleDnaError(res, err); }
});

router.get("/dna/active", async (req: Request, res: Response) => {
  try {
    const { campaignId, accountId: q_account } = req.query;
    if (!campaignId || typeof campaignId !== "string") {
      return res.status(400).json({ error: "BadRequest", message: "campaignId query param required" });
    }
    const accountId = (req as any).user?.accountId ?? (typeof q_account === "string" ? q_account : null);
    const row = await getActiveDna(accountId, campaignId);
    res.json({ active: row });
  } catch (err) { handleDnaError(res, err); }
});

export default router;
