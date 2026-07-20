/**
 * Phase 3 — Boss Agent execution.
 *
 * Single entry point. Does:
 *   1. Acquire per-campaign in-flight lock.
 *   2. Build a plan.
 *   3. For each plan item: call acquire() → translate envelope → run lane.
 *   4. If user + competitor both validated and bridge in scope, run bridge.
 *      Skip bridge when the user lane finished with `no_signals_extracted`
 *      (Samir-locked decision #5).
 *   5. Evaluate Q1 (stub) and Q2 (market shift policy) — record only.
 *   6. Persist boss_runs row with full plan + execution + verdicts.
 *
 * Hard rules:
 *   - Calls only `acquire()` from server/collector — never a scraper directly.
 *   - When `scope.forceFreshAcquisition` is true, all lane runs forward
 *     `requireFreshAcquisition: true` to acceptSnapshot (Control Layer enforces).
 *   - Lane runs are linked to this boss run via pipeline_runs.parentRunId
 *     (no new join table — Samir-locked decision #8).
 *   - Bridge run keeps its existing parent (competitor run); the boss→bridge
 *     link is recorded in execution.bridgeRunId for traceability.
 *   - Records every decision so the verdict is fully explainable from lineage.
 */
import { acquire } from "../collector";
import { runWatchtowerOrchestrator } from "../watchtower/orchestrator";
import type { CollectorEnvelope } from "../collector/envelope";
import { runUserLane, type UserLaneInput } from "../pipeline/lanes/user";
import { runCompetitorLane, type CompetitorLaneInput } from "../pipeline/lanes/competitor";
import { bridgeLanes } from "../pipeline/bridge";
import { planBoss } from "./plan";
import { translateEnvelopeToLanePayload } from "./envelope-to-lane";
import { evaluateQ1 } from "./policy/dna-working";
import { evaluateQ2 } from "./policy/market-shift";
import { interpretQ1Maturity } from "./policy/q1-maturity";
import { withCampaignLock } from "./concurrency";
import { insertBossRun, newBossRunId, updateBossRun } from "./store";
import { evaluateWindowState, autoCloseExpiredWindow } from "../pipeline/eval-windows";
import { evaluateRhythmCompliance } from "../pipeline/lanes/user/rhythm-compliance";
import { applyEvaluationHierarchy } from "./eval-hierarchy";
import { getActiveDna } from "../pipeline/dna";
import { produceClustersForWindow, getBaselineCluster, type ClusterSignature } from "../pipeline/cluster-producer";
import { compareClusters } from "../pipeline/cluster-comparator";
import { checkOutcomeRegression } from "../pipeline/lanes/user/outcome-regression";
import { db } from "../db";
import { pipelineUserTruth, pipelineEvalWindows, orchestratorJobs } from "@shared/schema";
import { and, eq, isNull, isNotNull, desc, lt } from "drizzle-orm";
import { AiPathReportSchema, type BossAiPathEnvelope } from "../shared/ai-path-telemetry";
import type {
  BossExecution,
  BossExecutionAcquisition,
  BossExecutionLaneRun,
  BossExecutionPhase5Context,
  BossExecutionPhase6Context,
  BossPlanItem,
  BossRunInput,
  BossRunResult,
} from "./types";

export async function runBoss(input: BossRunInput): Promise<BossRunResult> {
  if (!input.accountId) throw new Error("accountId required");
  if (!input.campaignId) throw new Error("campaignId required");

  return withCampaignLock(input.accountId, input.campaignId, async () => {
    const bossRunId = newBossRunId();
    const startedAt = new Date();

    const plan = await planBoss(input.accountId, input.campaignId, input.scope);

    await insertBossRun({
      id: bossRunId,
      accountId: input.accountId,
      campaignId: input.campaignId,
      trigger: input.trigger,
      status: "running",
      scope: JSON.stringify(input.scope ?? {}),
      plan: JSON.stringify(plan),
      execution: JSON.stringify({ acquisitions: [], laneRuns: [], bridgeRunId: null }),
      startedAt,
    });

    const execution: BossExecution = {
      acquisitions: [],
      laneRuns: [],
      bridgeRunId: null,
    };
    const warnings: string[] = [];
    const force = !!input.scope?.forceFreshAcquisition;

    // ── Step 1: acquire + run lanes for each plan item ──────────────
    // We collect the most recent validated user/competitor run ids so we
    // can decide whether to bridge after.
    let lastUserRunId: string | null = null;
    let lastCompetitorRunId: string | null = null;
    let userLaneEmptyOnLast = false;

    for (let i = 0; i < plan.items.length; i++) {
      const item = plan.items[i];
      let envelope: CollectorEnvelope;
      try {
        envelope = await acquire({
          accountId: input.accountId,
          campaignId: input.campaignId,
          lane: item.lane,
          entityType: item.entityType,
          entityId: item.entityId,
          freshness: force ? { force: true } : undefined,
        });
      } catch (err) {
        const reason = (err as Error).message;
        warnings.push(`acquire_failed:${item.entityType}:${item.entityId}:${reason}`);
        execution.laneRuns.push({
          lane: item.lane,
          entityId: item.entityId,
          runId: null,
          parentBossRunId: bossRunId,
          acquisitionId: null,
          status: "failed",
          warnings: [`acquire_failed:${reason}`],
          rejectionReason: reason,
        });
        continue;
      }

      const acqRecord: BossExecutionAcquisition = {
        planItemIndex: i,
        entityType: item.entityType,
        entityId: item.entityId,
        acquisitionId: envelope.acquisition_id,
        cacheHit: envelope.provenance.cache_hit,
        warnings: envelope.provenance.warnings,
      };
      execution.acquisitions.push(acqRecord);

      const lanePayload = translateEnvelopeToLanePayload(envelope);
      if (!lanePayload) {
        // Phase 3: reviews adapter envelopes are intentionally not run through a lane.
        execution.laneRuns.push({
          lane: item.lane,
          entityId: item.entityId,
          runId: null,
          parentBossRunId: bossRunId,
          acquisitionId: envelope.acquisition_id,
          status: "skipped",
          warnings: ["lane_translation_skipped:reviews_phase3_known_gap"],
        });
        continue;
      }

      try {
        if (item.lane === "user") {
          const result = await runLaneForItem("user", item, lanePayload, envelope, bossRunId, force);
          execution.laneRuns.push(result);
          if (result.status === "validated" && result.runId) {
            lastUserRunId = result.runId;
            userLaneEmptyOnLast = (result.warnings ?? []).includes("no_signals_extracted");
          }
        } else {
          const result = await runLaneForItem("competitor", item, lanePayload, envelope, bossRunId, force);
          execution.laneRuns.push(result);
          if (result.status === "validated" && result.runId) {
            lastCompetitorRunId = result.runId;
            // W-1 Watchtower orchestration — runs inline after each successful
            // competitor lane. Failures are isolated: never propagate to boss run.
            try {
              await runWatchtowerOrchestrator({
                accountId: input.accountId,
                campaignId: input.campaignId,
                competitorId: item.entityId,
                acquisitionId: envelope.acquisition_id,
                runId: result.runId,
                isCacheHit: !!envelope.provenance.cache_hit,
              });
            } catch (err) {
              console.error(
                `[Boss] WATCHTOWER_ORCHESTRATOR_FAILED competitorId=${item.entityId} reason=${(err as Error).message}`,
              );
            }
          }
        }
      } catch (err) {
        const reason = (err as Error).message;
        warnings.push(`lane_run_failed:${item.lane}:${item.entityId}:${reason}`);
        execution.laneRuns.push({
          lane: item.lane,
          entityId: item.entityId,
          runId: null,
          parentBossRunId: bossRunId,
          acquisitionId: envelope.acquisition_id,
          status: "failed",
          warnings: [reason],
          rejectionReason: reason,
        });
      }
    }

    // ── Step 2: bridge (if applicable) ────────────────────────────
    if (plan.bridgeRequested) {
      if (!lastUserRunId || !lastCompetitorRunId) {
        warnings.push("bridge_skipped:missing_validated_user_or_competitor_run");
      } else if (userLaneEmptyOnLast) {
        // Locked decision #5 — skip bridge when user lane finished empty.
        warnings.push("bridge_skipped:user_lane_no_signals_extracted");
      } else {
        try {
          const bridge = await bridgeLanes({
            accountId: input.accountId,
            campaignId: input.campaignId,
            competitorRunId: lastCompetitorRunId,
            userRunId: lastUserRunId,
          });
          execution.bridgeRunId = bridge.runId;
          execution.laneRuns.push({
            lane: "bridge",
            entityId: null,
            runId: bridge.runId,
            parentBossRunId: bossRunId,
            acquisitionId: null,
            status: "validated",
            signalCount: bridge.bridgedSignalIds.length,
            warnings: [],
          });
        } catch (err) {
          const reason = (err as Error).message;
          warnings.push(`bridge_failed:${reason}`);
          execution.laneRuns.push({
            lane: "bridge",
            entityId: null,
            runId: null,
            parentBossRunId: bossRunId,
            acquisitionId: null,
            status: "failed",
            warnings: [reason],
            rejectionReason: reason,
          });
        }
      }
    }

    // ── Phase 5 — User truth + rhythm + evaluation hierarchy ───────
    // Locked by Samir 2026-04-20:
    //   - Plan-anchored windows (each approved plan creates its own anchor).
    //   - Descriptive only: rhythm/truth never produce a DNA verdict.
    //   - Q1 gates on evaluation_status; Q2 is independent (market-side dim).
    //   - Cluster comparison gating is deferred to Phase 6 (it reads these flags).
    const phase5Now = new Date();
    const ws = await evaluateWindowState(input.accountId, input.campaignId, phase5Now);
    let phase5Ctx: BossExecutionPhase5Context = {
      window: null,
      truth: null,
      rhythm: null,
    };

    if (!ws.window || !ws.activePlan) {
      execution.evaluation_status = "no_active_plan";
      execution.evaluation_confidence = "low";
      execution.rhythm_status = "no_active_plan";
      warnings.push("no_active_approved_plan");
      for (const r of ws.reasons) warnings.push(r);
    } else {
      // Auto-close the window if its end has passed and it's still open with no truth.
      let liveWindow = ws.window;
      if (liveWindow.state === "open" && liveWindow.windowEnd.getTime() <= phase5Now.getTime() && !liveWindow.truthId) {
        const closed = await autoCloseExpiredWindow(liveWindow.id, phase5Now);
        if (closed) liveWindow = closed;
      }

      if (ws.reasons.includes("anchor_fallback_used")) warnings.push("anchor_fallback_used");

      // Truth lookup: latest non-superseded truth for the live window (if any).
      const truthRows = await db
        .select()
        .from(pipelineUserTruth)
        .where(and(eq(pipelineUserTruth.windowId, liveWindow.id), isNull(pipelineUserTruth.supersededAt)))
        .orderBy(desc(pipelineUserTruth.submittedAt))
        .limit(1);
      const truth = truthRows[0] ?? null;

      let truthStatus: "submitted" | "missing" | "late";
      if (!truth) truthStatus = "missing";
      else if (truth.wasLate || liveWindow.state === "late_filled") truthStatus = "late";
      else truthStatus = "submitted";

      // Rhythm compliance over the window.
      const rhythm = await evaluateRhythmCompliance({
        campaignId: input.campaignId,
        windowStart: liveWindow.windowStart,
        windowEnd: liveWindow.windowEnd,
        approvedRhythmJson: ws.activePlan.approvedRhythmJson,
      });

      // Set descriptive flags on execution.
      execution.truth_status = truthStatus;
      execution.rhythm_status = rhythm.status;
      if (truthStatus === "missing") execution.truthAction = "user_truth_required";

      // Hard-block: malformed/legacy rhythm config blob is a doctrine-level
      // failure — never silently coerce it into a compliance bucket. Skip the
      // normal hierarchy mapping and surface the explicit invalid state.
      if (rhythm.status === "rhythm_invalid") {
        execution.evaluation_status = "blocked";
        execution.evaluation_confidence = "low";
        warnings.push("rhythm_invalid");
        warnings.push("evaluation_blocked");
        if (truthStatus === "missing") warnings.push("user_truth_missing");
        if (truthStatus === "late") warnings.push("user_truth_late");
      } else {
        // Apply hierarchy on the well-formed rhythm states only.
        const hierarchy = applyEvaluationHierarchy(truthStatus, rhythm.status);
        execution.evaluation_status = hierarchy.evaluation_status;
        execution.evaluation_confidence = hierarchy.evaluation_confidence;

        // Warnings — surface the layered state on the existing dashboard banner.
        if (truthStatus === "missing") warnings.push("user_truth_missing");
        if (truthStatus === "late") warnings.push("user_truth_late");
        if (rhythm.status === "non_compliant") warnings.push("rhythm_non_compliant");
        else if (rhythm.status === "partial") warnings.push("rhythm_partial");
        if (hierarchy.evaluation_status === "blocked") warnings.push("evaluation_blocked");
        else if (hierarchy.evaluation_status === "degraded") warnings.push("evaluation_degraded");
      }

      phase5Ctx = {
        window: {
          id: liveWindow.id,
          planId: liveWindow.planId,
          windowIndex: liveWindow.windowIndex,
          windowStart: liveWindow.windowStart.toISOString(),
          windowEnd: liveWindow.windowEnd.toISOString(),
          anchorAt: liveWindow.anchorAt.toISOString(),
          anchorFallbackUsed: liveWindow.anchorFallbackUsed,
          state: liveWindow.state,
        },
        truth: truth
          ? { isPresent: true, wasLate: truth.wasLate, submittedAt: truth.submittedAt.toISOString() }
          : { isPresent: false, wasLate: false, submittedAt: null },
        rhythm: {
          status: rhythm.status,
          plannedTotal: rhythm.plannedTotal,
          actualTotal: rhythm.actualTotal,
          perChannel: rhythm.perChannel,
          reason: rhythm.reason,
        },
      };
    }
    execution.phase5 = phase5Ctx;

    // ── Phase 6 — DNA + cluster production + comparison + outcome regression ──
    // Locked by Samir 2026-04-20 (rev 2). Sits BETWEEN Phase 5 and Q1, so the
    // Q1 policy receives all three layers and applies the joined rule.
    const phase6Now = phase5Now;
    const phase6Ctx: BossExecutionPhase6Context = {
      active_dna: null,
      cluster_production: null,
      cluster_comparison: null,
      outcome_regression: null,
      q1_inputs: {
        evaluationStatus: execution.evaluation_status ?? null,
        truthStatus: execution.truth_status ?? null,
        rhythmStatus: execution.rhythm_status ?? null,
        hasActiveDna: false,
        clusterProductionSkippedReason: null,
        clusterComparison: null,
        outcomeRegressed: null,
      },
    };

    const activeDna = await getActiveDna(input.accountId, input.campaignId);
    if (activeDna) {
      phase6Ctx.active_dna = {
        id: activeDna.id,
        status: activeDna.status,
        activatedAt: activeDna.activatedAt ? activeDna.activatedAt.toISOString() : null,
      };
      phase6Ctx.q1_inputs.hasActiveDna = true;
    }

    // Cluster production runs only when (a) a window exists and (b) we have an active DNA
    // AND the evaluation is in {complete, degraded}. produceClustersForWindow enforces
    // its own preconditions (window terminal, etc.) and returns explicit skip reasons.
    let currentClusterSig: ClusterSignature | null = null;
    let currentWindowIdForCompare: string | null = null;
    let clusterSkipReason: string | null = null;

    // Re-read the live window after Phase 5's possible auto-close.
    const liveWindowRows = ws.window
      ? await db.select().from(pipelineEvalWindows).where(eq(pipelineEvalWindows.id, ws.window.id)).limit(1)
      : [];
    const liveWindow = liveWindowRows[0] ?? null;

    if (!liveWindow) {
      clusterSkipReason = "no_eval_window";
      phase6Ctx.cluster_production = { produced: false, reason: clusterSkipReason };
    } else {
      const cp = await produceClustersForWindow({
        window: liveWindow,
        activeDna,
        evaluationStatus: execution.evaluation_status ?? "no_active_plan",
        bossRunId,
      });
      if ("produced" in cp && cp.produced) {
        currentClusterSig = cp.signature;
        currentWindowIdForCompare = liveWindow.id;
        phase6Ctx.cluster_production = {
          produced: true,
          clusterId: cp.cluster.id,
          windowId: liveWindow.id,
          postCount: cp.signature.post_count,
          themeCount: cp.signature.themes.length,
        };
      } else if ("skipped" in cp) {
        clusterSkipReason = cp.reason;
        phase6Ctx.cluster_production = { produced: false, reason: cp.reason };
      }
    }
    phase6Ctx.q1_inputs.clusterProductionSkippedReason = clusterSkipReason;

    // Cluster comparison — only when we produced a current signature AND have an active DNA.
    if (currentClusterSig && currentWindowIdForCompare && activeDna && liveWindow) {
      const baseline = await getBaselineCluster({
        accountId: input.accountId,
        campaignId: input.campaignId,
        dnaId: activeDna.id,
        currentWindowEnd: liveWindow.windowEnd,
      });
      const cmp = compareClusters({
        current: { windowId: currentWindowIdForCompare, signature: currentClusterSig },
        baseline: baseline ? { windowId: baseline.windowId, signature: baseline.clusterSignature as unknown as ClusterSignature } : null,
      });
      phase6Ctx.cluster_comparison = {
        verdict: cmp.verdict,
        baselineWindowId: cmp.baselineWindowId,
        currentWindowId: cmp.currentWindowId,
        themesAdded: cmp.themesAdded,
        themesRemoved: cmp.themesRemoved,
        themesShifted: cmp.themesShifted,
        reasons: cmp.reasons,
      };
      phase6Ctx.q1_inputs.clusterComparison = cmp.verdict;

      // Outcome regression — needs current truth + baseline truth (the truth
      // submitted against the baseline cluster's window). Skipped reasons are
      // recorded so lineage can explain why no regression check happened.
      if (baseline) {
        const curTruthRows = await db.select().from(pipelineUserTruth)
          .where(and(eq(pipelineUserTruth.windowId, liveWindow.id), isNull(pipelineUserTruth.supersededAt)))
          .orderBy(desc(pipelineUserTruth.submittedAt)).limit(1);
        const baseTruthRows = await db.select().from(pipelineUserTruth)
          .where(and(eq(pipelineUserTruth.windowId, baseline.windowId), isNull(pipelineUserTruth.supersededAt)))
          .orderBy(desc(pipelineUserTruth.submittedAt)).limit(1);
        const orRes = checkOutcomeRegression({
          currentTruth: curTruthRows[0] ?? null,
          baselineTruth: baseTruthRows[0] ?? null,
        });
        if ("skipped" in orRes && orRes.skipped) {
          phase6Ctx.outcome_regression = { regressed: false, skippedReason: orRes.reason };
          phase6Ctx.q1_inputs.outcomeRegressed = false;
        } else if ("regressed" in orRes) {
          phase6Ctx.outcome_regression = { regressed: orRes.regressed, reason: orRes.reason };
          phase6Ctx.q1_inputs.outcomeRegressed = orRes.regressed;
        }
      } else {
        phase6Ctx.outcome_regression = { regressed: false, skippedReason: "no_baseline_window" };
        phase6Ctx.q1_inputs.outcomeRegressed = false;
      }
    }
    execution.phase6 = phase6Ctx;

    // ── Step 3: evaluate Q1/Q2 ────────────────────────────────────
    // Q1 receives the joined three-layer inputs. Promotion to WORKING requires
    // ALL gates (execution + truth + structure) to align — see dna-working.ts.
    //
    // Phase 8.1 (Samir 2026-05-03) — maturity dimensions:
    //   dnaAgeDays from activeDna.activatedAt (null = no active DNA).
    //   exposurePostCount from current cluster signature post_count (null = no
    //     cluster produced — caller already handled the skip reason).
    //   strategyType: kept "unknown" until a campaign-keyed strategy-type
    //     source exists. Maturity policy treats unknown conservatively
    //     (10-day threshold) — see q1-maturity.ts.
    const dnaAgeDays = activeDna?.activatedAt
      ? Math.max(0, Math.floor((Date.now() - activeDna.activatedAt.getTime()) / (24 * 60 * 60 * 1000)))
      : null;
    const exposurePostCount = currentClusterSig?.post_count ?? null;
    const strategyType = "unknown" as const;

    const q1 = evaluateQ1({
      evaluationStatus: execution.evaluation_status,
      truthStatus: execution.truth_status,
      rhythmStatus: execution.rhythm_status,
      hasActiveDna: phase6Ctx.q1_inputs.hasActiveDna,
      clusterProductionSkippedReason: phase6Ctx.q1_inputs.clusterProductionSkippedReason,
      clusterComparison: phase6Ctx.q1_inputs.clusterComparison as any,
      outcomeRegression: phase6Ctx.outcome_regression && "regressed" in phase6Ctx.outcome_regression
        ? { regressed: phase6Ctx.outcome_regression.regressed, reason: phase6Ctx.outcome_regression.reason }
        : null,
      dnaAgeDays,
      strategyType,
    });

    // Phase 8.1 — maturity interpretation. Pure function, never mutates verdict.
    // Persisted as a `q1_interpretation:<state>` chip in q1.reasons so the
    // route layer (single source of truth) can extract it without a schema
    // change. Positive traction = clusters_shifted/new_clusters with no
    // outcome regression. The boss verdict still owns the final decision;
    // this is descriptive only, per Samir's "AI/interpretation never
    // changes verdict" lock.
    const positiveTraction =
      (phase6Ctx.q1_inputs.clusterComparison === "clusters_shifted" ||
        phase6Ctx.q1_inputs.clusterComparison === "new_clusters") &&
      phase6Ctx.q1_inputs.outcomeRegressed === false;
    const maturity = interpretQ1Maturity({
      q1Verdict: q1.verdict,
      hasActiveDna: phase6Ctx.q1_inputs.hasActiveDna,
      dnaAgeDays,
      exposurePostCount,
      strategyType,
      rhythmStatus: execution.rhythm_status as any,
      positiveTraction,
    });
    q1.reasons.push(maturity.reason);
    // Phase 7.4 — Q2 receives full descriptive context (user + DNA) so its
    // reasons array carries the surrounding state for the AI explanation
    // overlay. The decision tree itself does NOT branch on this context;
    // see server/boss/policy/market-shift.ts.
    const q2 = await evaluateQ2({
      accountId: input.accountId,
      campaignId: input.campaignId,
      user: {
        truthStatus: execution.truth_status ?? null,
        rhythmStatus: execution.rhythm_status ?? null,
        evaluationStatus: execution.evaluation_status ?? null,
      },
      dna: {
        hasActiveDna: phase6Ctx.q1_inputs.hasActiveDna,
        clusterComparisonVerdict: phase6Ctx.q1_inputs.clusterComparison ?? null,
        outcomeRegressed: phase6Ctx.q1_inputs.outcomeRegressed ?? null,
      },
    });

    // Phase 7.4 — persist Q2 decision inputs alongside phase6 so the
    // explanation route can rebuild a Q2EvaluationResult for the q2-reasoning
    // overlay without re-querying live tables.
    phase6Ctx.q2_inputs = {
      competitor: q2.inputs.competitor,
      user: {
        truthStatus: q2.inputs.user.truthStatus,
        rhythmStatus: q2.inputs.user.rhythmStatus,
        evaluationStatus: q2.inputs.user.evaluationStatus,
      },
      dna: q2.inputs.dna,
      lookbackDays: q2.inputs.lookbackDays,
      ruleCode: q2.ruleCode,
      // Phase 7.5 — persist real Phase 7.3 interpretation so the explanation
      // route + q2-reasoning overlay see the same structured market signal
      // the decision tree branched on. Null when corpus reader unavailable.
      interpretation: q2.inputs.interpretation ?? null,
    };
    execution.phase6 = phase6Ctx;

    // ── Phase 4 — T-4.B + T-4.C: descriptive Q2=SHIFTED surface ────
    // Locked by Samir: warnings-only alert + recommend-only rerun marker.
    // No automatic execution, no new alert table, no external channel.
    // Severity remains descriptive: this code path does NOT branch on
    // severity counts — it only mirrors Q2's existing rule-based verdict.
    if (q2.verdict === "SHIFTED") {
      warnings.push("q2_shifted_detected");
      execution.nextAction = "rerun_recommended";
    }

    // ── Step 4: roll up status ────────────────────────────────────
    const anyFailed = execution.laneRuns.some((r) => r.status === "failed");
    const anyValidated = execution.laneRuns.some((r) => r.status === "validated");
    const allFailed = execution.laneRuns.length > 0 && execution.laneRuns.every((r) => r.status === "failed");
    const status: BossRunResult["status"] = allFailed
      ? "failed"
      : anyFailed && anyValidated
        ? "partial"
        : anyValidated || execution.laneRuns.length === 0
          ? "completed"
          : "partial";

    const finishedAt = new Date();

    // ── Phase 4 — AI Proposes / Code Validates: copy AI-path envelope ──
    // runBoss does NOT run the proposal engines (they run in runOrchestrator),
    // so the boss run COPIES the most recent COMPLETED orchestrator job's
    // report and records its provenance. Absence is written explicitly
    // (B2/B4: never null-silent) so operators can distinguish "no run yet"
    // from "copy failed".
    const copiedAt = new Date().toISOString();
    let aiPathEnvelope: BossAiPathEnvelope;
    const [latestOrchJob] = await db
      .select({ id: orchestratorJobs.id, aiPathReport: orchestratorJobs.aiPathReport })
      .from(orchestratorJobs)
      .where(
        and(
          eq(orchestratorJobs.accountId, input.accountId),
          eq(orchestratorJobs.campaignId, input.campaignId),
          eq(orchestratorJobs.status, "COMPLETED"),
          isNotNull(orchestratorJobs.aiPathReport),
        ),
      )
      .orderBy(desc(orchestratorJobs.completedAt))
      .limit(1);

    if (latestOrchJob?.aiPathReport) {
      let reportObj: unknown = null;
      let parseThrew = false;
      try {
        reportObj = JSON.parse(latestOrchJob.aiPathReport);
      } catch (err) {
        parseThrew = true;
        console.error("[Boss] AI_PATH_REPORT_UNAVAILABLE copy_failed json_parse", err);
      }
      const parsed = parseThrew ? null : AiPathReportSchema.safeParse(reportObj);
      if (parsed && parsed.success) {
        aiPathEnvelope = {
          available: true,
          sourceOrchestratorJobId: latestOrchJob.id,
          generatedAt: parsed.data.generatedAt,
          copiedAt,
          report: parsed.data,
        };
      } else {
        if (parsed && !parsed.success) {
          console.error("[Boss] AI_PATH_REPORT_UNAVAILABLE copy_failed schema", parsed.error.flatten());
        }
        aiPathEnvelope = { available: false, reason: "copy_failed", copiedAt };
      }
    } else {
      console.error("[Boss] AI_PATH_REPORT_UNAVAILABLE no_orchestrator_run");
      aiPathEnvelope = { available: false, reason: "no_orchestrator_run", copiedAt };
    }

    await updateBossRun(bossRunId, {
      status,
      execution: JSON.stringify(execution),
      q1Verdict: q1.verdict,
      q1Reasons: JSON.stringify(q1.reasons),
      q2Verdict: q2.verdict,
      q2Reasons: JSON.stringify(q2.reasons),
      warnings: JSON.stringify(warnings),
      aiPathReport: JSON.stringify(aiPathEnvelope),
      finishedAt,
    });

    return {
      bossRunId,
      status,
      trigger: input.trigger,
      plan,
      execution,
      questions: { q1_dna_working: q1, q2_market_shifted: q2 },
      warnings,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
    };
  });
}

/**
 * Runs the underlying lane for one plan item.
 * Returns a BossExecutionLaneRun summary regardless of outcome.
 */
async function runLaneForItem(
  lane: "user" | "competitor",
  item: BossPlanItem,
  lanePayload: Record<string, unknown>,
  envelope: CollectorEnvelope,
  bossRunId: string,
  force: boolean,
): Promise<BossExecutionLaneRun> {
  if (lane === "user") {
    const inp: UserLaneInput = {
      accountId: envelope.account_id,
      campaignId: envelope.campaign_id,
      acquisitionId: envelope.acquisition_id,
      entityId: item.entityId,
      source: envelope.source_adapter,
      payload: lanePayload,
      collectedAt: envelope.collected_at,
      parentRunId: bossRunId,
      requireFreshAcquisition: force,
    };
    const r = await runUserLane(inp);
    const warnings = parseLaneWarnings(r.runSummaryWarnings);
    return {
      lane: "user",
      entityId: item.entityId,
      runId: r.runId,
      parentBossRunId: bossRunId,
      acquisitionId: envelope.acquisition_id,
      status: "validated",
      signalCount: r.signalIds.length,
      warnings,
    };
  } else {
    const inp: CompetitorLaneInput = {
      accountId: envelope.account_id,
      campaignId: envelope.campaign_id,
      acquisitionId: envelope.acquisition_id,
      entityId: item.entityId,
      source: envelope.source_adapter,
      payload: lanePayload,
      collectedAt: envelope.collected_at,
      parentRunId: bossRunId,
      requireFreshAcquisition: force,
    };
    const r = await runCompetitorLane(inp);
    const warnings = parseLaneWarnings(r.runSummaryWarnings);
    return {
      lane: "competitor",
      entityId: item.entityId,
      runId: r.runId,
      parentBossRunId: bossRunId,
      acquisitionId: envelope.acquisition_id,
      status: "validated",
      signalCount: r.signalIds.length,
      changeEventCount: r.changeEventIds.length,
      warnings,
    };
  }
}

function parseLaneWarnings(w: unknown): string[] {
  if (Array.isArray(w)) return w.filter((x): x is string => typeof x === "string");
  return [];
}
