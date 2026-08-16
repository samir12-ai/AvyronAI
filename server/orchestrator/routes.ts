// @ts-nocheck
import type { Express, Request, Response } from "express";
import { runOrchestrator, getOrchestratorStatus, getLatestOrchestratorRun } from "./index";
import { ENGINE_PRIORITY_ORDER } from "./priority-matrix";
import { loadSystemContext, buildSystemPrompt } from "./agent-context";
import { db } from "../db";
import {
  strategicPlans,
  requiredWork,
  calendarEntries,
  studioItems,
  planApprovals,
  contentDna,
  goalDecompositions,
  growthSimulations,
  executionTasks,
  planAssumptions,
  orchestratorJobs,
} from "@shared/schema";
import { eq, and, or, desc, sql } from "drizzle-orm";
import { validateRootIntegrity, detectStaleness, computeCalendarDeviation } from "../root-bundle";
import { casUpdateStrategicPlan, casUpdateStrategicPlanByVersion } from "../strategic-core/cas-helper";
import { computeFulfillment } from "../fulfillment-engine";
import { buildCausalNarrative } from "../narrative-layer";
import { computeAdaptiveRhythm } from "../adaptive-rhythm/engine";

import { resolveAccountId } from "../auth";
import { resolveRunId } from "./run-resolver";
import { assertCampaignBelongsTo, handleOwnershipError } from "../auth-helpers";
export function registerOrchestratorV2Routes(app: Express) {
  app.post("/api/orchestrator/run", async (req: Request, res: Response) => {
    try {
      const { campaignId, forceRefresh, resumeFromEngine, pausedJobId, scopedEngines } = req.body;
      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      // Validate scopedEngines against known engine IDs — reject unknown IDs with 400
      if (Array.isArray(scopedEngines) && scopedEngines.length > 0) {
        const validEngineIds = new Set(ENGINE_PRIORITY_ORDER.map(e => e.id));
        const invalidIds = scopedEngines.filter((id: string) => !validEngineIds.has(id as any));
        if (invalidIds.length > 0) {
          return res.status(400).json({
            error: "Invalid engine IDs in scopedEngines",
            invalidIds,
            validIds: Array.from(validEngineIds),
          });
        }
      }

      const accountId = resolveAccountId(req);

      // W5 (P0-4 cleanup): use centralized assertCampaignBelongsTo helper
      // instead of inline raw SQL. Same semantics (WHERE accountId AND
      // selectedCampaignId LIMIT 1 against campaign_selections) — produces
      // 404 CAMPAIGN_NOT_FOUND on mismatch (anti-enumeration, never confirms
      // existence to a non-owner). Replaces the prior inline check that
      // returned a generic 404 "Campaign not found" payload.
      try {
        await assertCampaignBelongsTo(accountId, String(campaignId));
      } catch (e) {
        if (handleOwnershipError(e, res)) return;
        throw e;
      }

      if (!pausedJobId) {
        const existing = await db.execute(
          sql`SELECT id FROM orchestrator_jobs
              WHERE campaign_id = ${String(campaignId)} AND account_id = ${accountId}
                AND status = 'RUNNING' AND created_at > NOW() - INTERVAL '30 minutes'
              LIMIT 1`
        );
        if (existing.rows?.length) {
          const runningId = existing.rows[0]?.id as string;
          return res.status(409).json({
            error: "An orchestrator run is already in progress for this campaign",
            jobId: runningId,
            status: "ALREADY_RUNNING",
          });
        }
      }

      const pendingJobId = pausedJobId || `orch_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

      if (!pausedJobId) {
        await db.insert(orchestratorJobs).values({
          id: pendingJobId,
          blueprintId: "orchestrator-v2",
          accountId,
          campaignId: String(campaignId),
          status: "RUNNING",
          // Task #67 / T-S5-C3: seed from the canonical 15-engine priority
          // matrix. The prior literal 11-id seed contained fictional engine
          // ids ("sgl","pricing","creative","messaging") that did not match
          // any actual engine — so the initial sectionStatuses row diverged
          // from the orchestrator's own `ENGINE_PRIORITY_ORDER`-driven
          // updates seconds later, leaving the UI flickering between two
          // disjoint shapes.
          sectionStatuses: JSON.stringify(
            ENGINE_PRIORITY_ORDER.map(e => ({ id: e.id, name: e.name, status: "PENDING" }))
          ),
        });
      }

      res.json({
        message: "Orchestrator started",
        status: "RUNNING",
        campaignId,
        jobId: pendingJobId,
      });

      runOrchestrator({
        accountId,
        campaignId: String(campaignId),
        forceRefresh: forceRefresh || false,
        resumeFromEngine,
        pausedJobId: pausedJobId || undefined,
        preassignedJobId: pausedJobId ? undefined : pendingJobId,
        scopedEngines: Array.isArray(scopedEngines) ? scopedEngines : undefined,
      }).then(result => {
        console.log(`[OrchestratorV2] Run complete: ${result.status} | ${result.completedEngines.length} engines | Plan: ${result.planId || "none"} | NeedsInput: ${result.needsInput?.engine || "none"}`);
      }).catch(err => {
        console.error(`[OrchestratorV2] Run failed:`, err.message);
      });
    } catch (error: any) {
      console.error("[OrchestratorV2] Start error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/orchestrator/status/:jobId", async (req: Request, res: Response) => {
    try {
      // P3 isolation seal: scope status lookup by accountId so jobIds belonging
      // to other tenants return 404 instead of leaking section statuses.
      const accountId = resolveAccountId(req);
      const status = await getOrchestratorStatus(req.params.jobId, accountId);
      if (!status) {
        return res.status(404).json({ error: "Job not found" });
      }
      res.json(status);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/orchestrator/latest/:campaignId", async (req: Request, res: Response) => {
    try {
      const accountId = resolveAccountId(req);
      // explicit ownership assert at the boundary.
      // getLatestOrchestratorRun is account-scoped, but doctrine requires
      // explicit ownership truth before any cross-module call.
      try {
        await assertCampaignBelongsTo(accountId, req.params.campaignId);
      } catch (e) {
        if (handleOwnershipError(e, res)) return;
        throw e;
      }
      const requestedRunId = typeof req.query.runId === "string" ? req.query.runId : null;
      let resolved;
      try {
        resolved = await resolveRunId(req.params.campaignId, accountId, requestedRunId);
      } catch (e: any) {
        return res.status(404).json({ error: e.message });
      }
      if (!resolved.runId) {
        return res.json({ hasRun: false });
      }
      const status = await getOrchestratorStatus(resolved.runId, accountId);
      const job = status ? await db.select().from(orchestratorJobs).where(and(
        eq(orchestratorJobs.id, resolved.runId),
        eq(orchestratorJobs.accountId, accountId),
        eq(orchestratorJobs.campaignId, req.params.campaignId),
      )).limit(1).then(rows => rows[0] ?? null) : null;
      if (!job) {
        return res.json({ hasRun: false });
      }
      let needsInput: any = null;
      if (job.status === "NEEDS_INPUT" && job.needsInputFields) {
        try { needsInput = JSON.parse(job.needsInputFields); } catch {}
      }
      res.json({
        hasRun: true,
        id: job.id,
        status: job.status,
        planId: job.planId,
        durationMs: job.durationMs,
        sections: job.sectionStatuses ? JSON.parse(job.sectionStatuses) : [],
        createdAt: job.createdAt,
        completedAt: job.completedAt,
        error: job.error,
        pausedEngine: job.pausedEngine || null,
        needsInput,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/plans/active/:campaignId", async (req: Request, res: Response) => {
    try {
      const accountId = resolveAccountId(req);
      // explicit ownership assert at the boundary.
      // The downstream resolveRunId + DB queries below scope by accountId in
      // their WHERE clauses, but strict doctrine requires explicit ownership
      // truth before any cross-module call.
      try {
        await assertCampaignBelongsTo(accountId, req.params.campaignId);
      } catch (e) {
        if (handleOwnershipError(e, res)) return;
        throw e;
      }

      let resolved;
      try {
        resolved = await resolveRunId(req.params.campaignId, accountId, (req.query.runId as string) || null);
      } catch (e: any) {
        return res.status(404).json({ error: e.message, runId: null, isLatest: false, isStale: false });
      }

      const [selectedJob] = await db
        .select({
          id: orchestratorJobs.id,
          status: orchestratorJobs.status,
          error: orchestratorJobs.error,
          planId: orchestratorJobs.planId,
          sectionStatuses: orchestratorJobs.sectionStatuses,
          createdAt: orchestratorJobs.createdAt,
        })
        .from(orchestratorJobs)
        .where(and(
          eq(orchestratorJobs.id, resolved.runId!),
          eq(orchestratorJobs.campaignId, req.params.campaignId),
          eq(orchestratorJobs.accountId, accountId),
        ))
        .limit(1);

      let plan: any = null;
      if (resolved.runId && resolved.planId) {
        const [p] = await db
          .select()
          .from(strategicPlans)
          .where(
            and(
              eq(strategicPlans.accountId, accountId),
              eq(strategicPlans.campaignId, req.params.campaignId),
              eq(strategicPlans.id, resolved.planId),
            )
          )
          .limit(1);
        plan = p || null;
      }

      // eslint-disable-next-line semantic/no-semantic-fallback -- G (H8): defensive null coalesce on optional jobId field — no semantic substitution
      const pipelineStatus = selectedJob?.status || null;
      const pipelineBlocked = pipelineStatus === "BLOCKED";
      const pipelineFailed = pipelineStatus === "FAILED" || pipelineStatus === "ERROR";
      const pipelineBlockReason = pipelineBlocked ? (selectedJob?.error || null) : null;
      const isPlanFromSelectedRun = plan && selectedJob?.planId ? (plan.id === selectedJob.planId) : false;
      const isPlanStale = plan && !isPlanFromSelectedRun;

      let completedEngines: string[] = [];
      let blockedEngines: string[] = [];
      try {
        const sections = selectedJob?.sectionStatuses ? JSON.parse(selectedJob.sectionStatuses) : [];
        completedEngines = sections.filter((s: any) => s.status === "SUCCESS").map((s: any) => s.id);
        blockedEngines = sections.filter((s: any) => s.status === "BLOCKED" || s.status === "DEPTH_CASCADE_BLOCKED").map((s: any) => s.id);
      } catch {}

      if (!plan) {
        return res.json({
          runId: resolved.runId,
          isLatest: resolved.isLatest,
          isStale: resolved.isStale,
          completedAt: resolved.completedAt,
          hasPlan: false,
          pipelineState: selectedJob ? {
            status: pipelineStatus,
            isBlocked: pipelineBlocked,
            isFailed: pipelineFailed,
            blockReason: pipelineBlockReason,
            completedEngines,
            blockedEngines,
            lastRunAt: selectedJob.createdAt,
          } : null,
        });
      }

      const planData = plan.planJson ? JSON.parse(plan.planJson) : null;

      const [work] = await db
        .select()
        .from(requiredWork)
        .where(eq(requiredWork.planId, plan.id))
        .limit(1);

      const calendarStats = await db
        .select({
          total: sql<number>`count(*)`,
          pending: sql<number>`count(case when status IN ('PENDING','DRAFT') then 1 end)`,
          completed: sql<number>`count(case when status IN ('COMPLETED','PUBLISHED') then 1 end)`,
        })
        .from(calendarEntries)
        .where(eq(calendarEntries.planId, plan.id));

      const studioStats = await db
        .select({
          total: sql<number>`count(*)`,
          draft: sql<number>`count(case when status = 'DRAFT' then 1 end)`,
          ready: sql<number>`count(case when status = 'READY' then 1 end)`,
          approved: sql<number>`count(case when status = 'APPROVED' then 1 end)`,
          published: sql<number>`count(case when status = 'PUBLISHED' then 1 end)`,
        })
        .from(studioItems)
        .where(eq(studioItems.planId, plan.id));

      const safeJson = (v: any) => { try { return typeof v === "string" ? JSON.parse(v) : v; } catch { return null; } };

      const [goalDecomp] = await db.select().from(goalDecompositions)
        .where(and(eq(goalDecompositions.campaignId, req.params.campaignId), eq(goalDecompositions.accountId, accountId), eq(goalDecompositions.jobId, resolved.runId!)))
        .limit(1);

      const [simulation] = await db.select().from(growthSimulations)
        .where(and(eq(growthSimulations.campaignId, req.params.campaignId), eq(growthSimulations.accountId, accountId), eq(growthSimulations.jobId, resolved.runId!)))
        .limit(1);

      const tasks = await db.select().from(executionTasks)
        .where(eq(executionTasks.planId, plan.id));

      const assumptions = await db.select().from(planAssumptions)
        .where(eq(planAssumptions.planId, plan.id));

      let liveRhythm: { reelsPerWeek: number; carouselsPerWeek: number; storiesPerDay: number; postsPerWeek: number } | null = null;
      try {
        const rhythm = await computeAdaptiveRhythm(req.params.campaignId, accountId);
        liveRhythm = {
          reelsPerWeek: rhythm.reelsPerWeek,
          carouselsPerWeek: rhythm.carouselsPerWeek,
          storiesPerDay: rhythm.storiesPerDay,
          postsPerWeek: rhythm.postsPerWeek,
        };
      } catch {}

      const approvedRhythm: { reelsPerWeek: number; carouselsPerWeek: number; storiesPerDay: number; postsPerWeek?: number; approvedAt?: string } | null =
        plan.approvedRhythmJson ? safeJson(plan.approvedRhythmJson) : null;

      const rhythmDelta = (liveRhythm && approvedRhythm) ? {
        reels: liveRhythm.reelsPerWeek - (approvedRhythm.reelsPerWeek || 0),
        carousels: liveRhythm.carouselsPerWeek - (approvedRhythm.carouselsPerWeek || 0),
        stories: liveRhythm.storiesPerDay - (approvedRhythm.storiesPerDay || 0),
      } : null;

      res.json({
        runId: resolved.runId,
        isLatest: resolved.isLatest,
        isStale: resolved.isStale,
        completedAt: resolved.completedAt,
        hasPlan: true,
        liveRhythm,
        approvedRhythm,
        rhythmDelta,
        plan: {
          id: plan.id,
          status: plan.status,
          executionStatus: plan.executionStatus,
          summary: plan.planSummary,
          emergencyStopped: plan.emergencyStopped,
          createdAt: plan.createdAt,
          updatedAt: plan.updatedAt,
          sections: planData,
        },
        requiredWork: work ? {
          id: work.id,
          periodDays: work.periodDays,
          totalPieces: work.totalContentPieces,
          reels: { required: work.totalReels, perWeek: work.reelsPerWeek },
          posts: { required: work.totalPosts, perWeek: work.postsPerWeek },
          stories: { required: work.totalStories, perDay: work.storiesPerDay },
          carousels: { required: work.totalCarousels, perWeek: work.carouselsPerWeek },
          videos: { required: work.totalVideos, perWeek: work.videosPerWeek },
          generated: work.generatedCount || 0,
          ready: work.readyCount || 0,
          scheduled: work.scheduledCount || 0,
          published: work.publishedCount || 0,
          failed: work.failedCount || 0,
          remaining: (work.totalContentPieces || 0) - (work.generatedCount || 0) - (work.readyCount || 0) - (work.publishedCount || 0),
        } : null,
        calendar: {
          total: Number(calendarStats[0]?.total) || 0,
          pending: Number(calendarStats[0]?.pending) || 0,
          completed: Number(calendarStats[0]?.completed) || 0,
        },
        studio: {
          total: Number(studioStats[0]?.total) || 0,
          draft: Number(studioStats[0]?.draft) || 0,
          ready: Number(studioStats[0]?.ready) || 0,
          approved: Number(studioStats[0]?.approved) || 0,
          published: Number(studioStats[0]?.published) || 0,
        },
        goalDecomposition: goalDecomp ? {
          id: goalDecomp.id,
          goalType: goalDecomp.goalType,
          goalTarget: goalDecomp.goalTarget,
          goalLabel: goalDecomp.goalLabel,
          timeHorizonDays: goalDecomp.timeHorizonDays,
          feasibility: goalDecomp.feasibility,
          feasibilityScore: goalDecomp.feasibilityScore,
          feasibilityExplanation: goalDecomp.feasibilityExplanation,
          funnelMath: safeJson(goalDecomp.funnelMath),
          confidenceScore: goalDecomp.confidenceScore,
          assumptions: safeJson(goalDecomp.assumptions),
        } : null,
        simulation: simulation ? {
          id: simulation.id,
          conservativeCase: safeJson(simulation.conservativeCase),
          baseCase: safeJson(simulation.baseCase),
          upsideCase: safeJson(simulation.upsideCase),
          confidenceScore: simulation.confidenceScore,
          keyAssumptions: safeJson(simulation.keyAssumptions),
          bottleneckAlerts: safeJson(simulation.bottleneckAlerts),
          constraintSimulation: safeJson(simulation.constraintSimulation),
        } : null,
        executionTasks: {
          total: tasks.length,
          byStatus: {
            pending: tasks.filter(t => t.status === "pending").length,
            inProgress: tasks.filter(t => t.status === "in_progress").length,
            completed: tasks.filter(t => t.status === "completed").length,
            blocked: tasks.filter(t => t.status === "blocked").length,
          },
          today: tasks.filter(t => t.priority === "high" || t.weekNumber === 1).slice(0, 5).map(t => ({
            id: t.id, title: t.title, type: t.taskType, priority: t.priority, status: t.status,
          })),
        },
        assumptions: assumptions.map(a => ({
          assumption: a.assumption,
          confidence: a.confidence,
          impactSeverity: a.impactSeverity,
          source: a.source,
        })),
        pipelineState: {
          status: pipelineStatus,
          isBlocked: pipelineBlocked,
          isFailed: pipelineFailed,
          blockReason: pipelineBlockReason,
          isPlanFromLatestRun: isPlanFromSelectedRun,
          isPlanStale,
          completedEngines,
          blockedEngines,
          lastRunAt: selectedJob?.createdAt || null,
        },
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/plans/:planId/approve", async (req: Request, res: Response) => {
    try {
      const { planId } = req.params;
      const forceApprove = req.body.force === true;

      const [plan] = await db
        .select()
        .from(strategicPlans)
        .where(eq(strategicPlans.id, planId))
        .limit(1);

      if (!plan) return res.status(404).json({ error: "Plan not found" });
      if (plan.status !== "DRAFT" && plan.status !== "READY_FOR_REVIEW") {
        return res.status(400).json({ error: `Plan is ${plan.status}, not approvable` });
      }

      const warnings: string[] = [];
      const blockReasons: Array<{ code: string; message: string; detail?: any }> = [];

      // ===== PLAN-RUN BINDING CHECK =====
      // A plan is run-bound iff it carries a jobId AND that jobId matches the
      // most recent COMPLETED orchestrator run for the campaign. If a newer
      // run has completed since the plan was generated, the plan is OUTDATED
      // — its requiredWork/calendar reflect old engine outputs and approving
      // it would lock in a strategy that disagrees with the latest analysis.
      // Hard-block (even with forceApprove=false) is the correct behavior here
      // because the system already supports re-running the orchestrator to
      // produce a fresh plan; force-approving a stale plan defeats the purpose.
      const [latestCompletedJob] = await db
        .select({ id: orchestratorJobs.id, planId: orchestratorJobs.planId, completedAt: orchestratorJobs.completedAt })
        .from(orchestratorJobs)
        .where(and(
          eq(orchestratorJobs.campaignId, plan.campaignId),
          eq(orchestratorJobs.accountId, plan.accountId),
          eq(orchestratorJobs.status, "COMPLETED"),
        ))
        .orderBy(desc(orchestratorJobs.completedAt))
        .limit(1);

      if (plan.jobId && latestCompletedJob && latestCompletedJob.id !== plan.jobId) {
        blockReasons.push({
          code: "PLAN_OUTDATED",
          message: `Plan is from a previous pipeline run (${plan.jobId}). A newer run has completed (${latestCompletedJob.id}). Regenerate the plan from the latest run before approving.`,
          detail: {
            planJobId: plan.jobId,
            latestJobId: latestCompletedJob.id,
            latestCompletedAt: latestCompletedJob.completedAt,
          },
        });
      }

      if (plan.rootBundleId) {
        const integrity = await validateRootIntegrity(planId);
        if (!integrity.valid) {
          warnings.push(...integrity.issues);
          blockReasons.push({
            code: "ROOT_INTEGRITY_FAILED",
            message: `Root bundle integrity check failed: ${integrity.issues.join("; ")}`,
            detail: { issues: integrity.issues },
          });
        }

        const staleness = await detectStaleness(plan.campaignId, plan.accountId);
        if (staleness.isStale) {
          warnings.push(`Root staleness detected: ${staleness.reason}`);
          blockReasons.push({
            code: "ROOT_STALE",
            message: `Root bundle is stale: ${staleness.reason}`,
            detail: { reason: staleness.reason },
          });
        }
      }

      const [work] = await db.select().from(requiredWork)
        .where(eq(requiredWork.planId, planId)).limit(1);

      let deviationDetail: any = null;
      if (work) {
        const calCounts = await db.select({
          reels: sql<number>`count(case when content_type = 'REEL' then 1 end)`,
          posts: sql<number>`count(case when content_type = 'POST' then 1 end)`,
          stories: sql<number>`count(case when content_type = 'STORY' then 1 end)`,
          carousels: sql<number>`count(case when content_type = 'CAROUSEL' then 1 end)`,
          videos: sql<number>`count(case when content_type = 'VIDEO' then 1 end)`,
        }).from(calendarEntries).where(eq(calendarEntries.planId, planId));

        const deviation = computeCalendarDeviation(
          {
            reels: work.totalReels || 0,
            posts: work.totalPosts || 0,
            stories: work.totalStories || 0,
            carousels: work.totalCarousels || 0,
            videos: work.totalVideos || 0,
          },
          {
            reels: Number(calCounts[0]?.reels) || 0,
            posts: Number(calCounts[0]?.posts) || 0,
            stories: Number(calCounts[0]?.stories) || 0,
            carousels: Number(calCounts[0]?.carousels) || 0,
            videos: Number(calCounts[0]?.videos) || 0,
          }
        );

        if (!deviation.passesThreshold) {
          deviationDetail = deviation;
          warnings.push(`Calendar deviation exceeds threshold: max ${deviation.maxDeviation}% (limit 5%)`);
          blockReasons.push({
            code: "EXECUTION_DEVIATION",
            message: `Calendar contents drifted from required work plan (max ${deviation.maxDeviation}% deviation, limit 5%). This indicates real execution drift — content was added/removed outside the plan.`,
            detail: deviation,
          });
        }
      }

      // PLAN_OUTDATED is a structural lifecycle problem and must NOT be
      // bypassed by forceApprove. Other blockers (root integrity, calendar
      // deviation) can still be force-approved by an explicit operator.
      const hasPlanOutdated = blockReasons.some(b => b.code === "PLAN_OUTDATED");
      const shouldBlock = (hasPlanOutdated || blockReasons.length > 0) && (!forceApprove || hasPlanOutdated);

      if (shouldBlock) {
        return res.status(409).json({
          success: false,
          blocked: true,
          warnings,
          blockReasons,
          message: hasPlanOutdated
            ? "Plan approval blocked: plan is outdated relative to the latest pipeline run. Regenerate the plan and try again. Force-approve is not permitted for outdated plans."
            : "Plan approval blocked due to integrity issues. Set force=true to override (not recommended for execution drift without investigating root cause).",
        });
      }

      // atomic CAS: bind to plan.version AND status predicate in
      // a single UPDATE so a concurrent writer that flipped the row to
      // APPROVED/REJECTED between the SELECT above and this write is
      // detected (no rows updated → 409).
      try {
        await casUpdateStrategicPlanByVersion(
          planId,
          plan.version,
          { status: "APPROVED", updatedAt: new Date() },
          or(eq(strategicPlans.status, "DRAFT"), eq(strategicPlans.status, "READY_FOR_REVIEW")),
        );
      } catch (casErr: any) {
        if (casErr?.code === "CONCURRENT_MODIFICATION") {
          return res.status(409).json({ error: "Plan was modified concurrently or already approved/rejected" });
        }
        throw casErr;
      }

      let rhythmSnapshot: { reelsPerWeek: number; carouselsPerWeek: number; storiesPerDay: number; postsPerWeek: number; approvedAt: string } | null = null;
      try {
        const rhythm = await computeAdaptiveRhythm(plan.campaignId, plan.accountId);
        rhythmSnapshot = {
          reelsPerWeek: rhythm.reelsPerWeek,
          carouselsPerWeek: rhythm.carouselsPerWeek,
          storiesPerDay: rhythm.storiesPerDay,
          postsPerWeek: rhythm.postsPerWeek,
          approvedAt: new Date().toISOString(),
        };
        await casUpdateStrategicPlan(planId, { approvedRhythmJson: JSON.stringify(rhythmSnapshot) });
      } catch (snapshotErr: any) {
        console.warn("[ApproveRoute] Failed to capture rhythm snapshot (non-blocking):", snapshotErr.message);
      }

      await db.insert(planApprovals).values({
        planId,
        accountId: plan.accountId,
        decision: "APPROVED",
        reason: req.body.reason || (warnings.length > 0 ? `Force-approved with warnings: ${warnings.join("; ")}` : "Approved by user"),
        decidedBy: "client",
        rhythmSnapshotJson: rhythmSnapshot ? JSON.stringify(rhythmSnapshot) : null,
      });

      res.json({ success: true, status: "APPROVED", warnings, approvedRhythm: rhythmSnapshot });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/plans/:planId/reject", async (req: Request, res: Response) => {
    try {
      const { planId } = req.params;
      const { reason } = req.body;

      const [plan] = await db.select({ id: strategicPlans.id }).from(strategicPlans).where(eq(strategicPlans.id, planId)).limit(1);
      if (!plan) return res.status(404).json({ error: "Plan not found" });

      try {
        await casUpdateStrategicPlan(planId, { status: "REJECTED", updatedAt: new Date() });
      } catch (casErr: any) {
        if (casErr?.code === "CONCURRENT_MODIFICATION") {
          return res.status(409).json({ error: "Plan was modified concurrently by another request" });
        }
        throw casErr;
      }

      await db.insert(planApprovals).values({
        planId,
        accountId: resolveAccountId(req),
        decision: "REJECTED",
        reason: reason || "Rejected by user",
        decidedBy: "client",
      });

      res.json({ success: true, status: "REJECTED" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/system-context/:campaignId", async (req: Request, res: Response) => {
    try {
      const accountId = resolveAccountId(req);
      const requestedRunId = (req.query.runId as string) || null;
      // explicit ownership assert at the boundary.
      // Downstream loadSystemContext does scope reads by accountId, but the
      // strict doctrine requires explicit ownership truth before any cross-
      // module call.
      try {
        await assertCampaignBelongsTo(accountId, req.params.campaignId);
      } catch (e) {
        if (handleOwnershipError(e, res)) return;
        throw e;
      }
      const context = await loadSystemContext(accountId, req.params.campaignId, requestedRunId);
      res.json(context);
    } catch (error: any) {
      if (typeof error?.message === "string" && error.message.startsWith("RUN_NOT_FOUND")) {
        return res.status(404).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/required-work/:campaignId", async (req: Request, res: Response) => {
    try {
      const accountId = resolveAccountId(req);
      const campaignId = req.params.campaignId;
      // explicit ownership assert at the boundary.
      try {
        await assertCampaignBelongsTo(accountId, campaignId);
      } catch (e) {
        if (handleOwnershipError(e, res)) return;
        throw e;
      }

      const fulfillment = await computeFulfillment(campaignId, accountId);

      if (!fulfillment.planId && fulfillment.total.required === 0) return res.json({ hasWork: false });

      const [work] = await db
        .select()
        .from(requiredWork)
        .where(eq(requiredWork.campaignId, campaignId))
        .orderBy(desc(requiredWork.createdAt))
        .limit(1);

      if (!work) return res.json({ hasWork: false });

      const planId = fulfillment.planId || work.planId;

      const todayStr = new Date().toISOString().split("T")[0];
      const weekEnd = new Date();
      weekEnd.setDate(weekEnd.getDate() + 7);
      const weekEndStr = weekEnd.toISOString().split("T")[0];

      const todayEntries = await db
        .select()
        .from(calendarEntries)
        .where(
          and(
            eq(calendarEntries.planId, planId),
            eq(calendarEntries.scheduledDate, todayStr)
          )
        );

      const weekEntries = await db
        .select()
        .from(calendarEntries)
        .where(
          and(
            eq(calendarEntries.planId, planId),
            sql`${calendarEntries.scheduledDate} >= ${todayStr}`,
            sql`${calendarEntries.scheduledDate} <= ${weekEndStr}`
          )
        );

      const pendingToday = todayEntries.filter(e => e.status === "PENDING" || e.status === "DRAFT");
      const pendingWeek = weekEntries.filter(e => e.status === "PENDING" || e.status === "DRAFT");

      res.json({
        hasWork: fulfillment.total.remaining > 0,
        planId,
        totalPieces: fulfillment.total.required,
        fulfilled: fulfillment.total.fulfilled,
        remaining: fulfillment.total.remaining,
        progressPercent: fulfillment.progressPercent,
        branches: {
          REELS: fulfillment.byBranch.REELS,
          POSTS: fulfillment.byBranch.POSTS,
          STORIES: fulfillment.byBranch.STORIES,
          CAROUSELS: fulfillment.byBranch.CAROUSELS,
        },
        byStatus: fulfillment.byStatus,
        todayWork: pendingToday.map(e => ({
          id: e.id,
          contentType: e.contentType,
          scheduledTime: e.scheduledTime,
          title: e.title,
          status: e.status,
        })),
        weekWork: pendingWeek.map(e => ({
          id: e.id,
          contentType: e.contentType,
          scheduledDate: e.scheduledDate,
          scheduledTime: e.scheduledTime,
          title: e.title,
          status: e.status,
        })),
        breakdown: {
          reels: { required: fulfillment.byBranch.REELS.required, fulfilled: fulfillment.byBranch.REELS.fulfilled, remaining: fulfillment.byBranch.REELS.remaining, perWeek: work.reelsPerWeek },
          posts: { required: fulfillment.byBranch.POSTS.required, fulfilled: fulfillment.byBranch.POSTS.fulfilled, remaining: fulfillment.byBranch.POSTS.remaining, perWeek: work.postsPerWeek },
          stories: { required: fulfillment.byBranch.STORIES.required, fulfilled: fulfillment.byBranch.STORIES.fulfilled, remaining: fulfillment.byBranch.STORIES.remaining, perDay: work.storiesPerDay },
          carousels: { required: fulfillment.byBranch.CAROUSELS.required, fulfilled: fulfillment.byBranch.CAROUSELS.fulfilled, remaining: fulfillment.byBranch.CAROUSELS.remaining, perWeek: work.carouselsPerWeek },
          videos: { required: work.totalVideos, perWeek: work.videosPerWeek },
        },
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/studio/items/:itemId/status", async (req: Request, res: Response) => {
    try {
      const { itemId } = req.params;
      const { status } = req.body;

      const validStatuses = ["DRAFT", "GENERATED", "READY", "APPROVED", "PUBLISHED"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
      }

      const [item] = await db
        .select()
        .from(studioItems)
        .where(eq(studioItems.id, itemId))
        .limit(1);

      if (!item) return res.status(404).json({ error: "Studio item not found" });

      const updates: any = { status, updatedAt: new Date() };
      if (status === "PUBLISHED") {
        updates.publishedAt = new Date();
      }

      await db.update(studioItems)
        .set(updates)
        .where(eq(studioItems.id, itemId));

      if (item.planId && item.status !== status) {
        const statusToField: Record<string, string> = {
          GENERATED: "generatedCount",
          READY: "readyCount",
          APPROVED: "readyCount",
          PUBLISHED: "publishedCount",
        };

        // F2.2/D1: presence ternary, not coalesce. Preserves prior
        // semantics — missing status → no decrement, increment still runs.
        const oldField = item.status ? statusToField[item.status] : undefined;
        const newField = statusToField[status];

        const updates: Record<string, any> = {};
        if (oldField) {
          updates[oldField] = sql`GREATEST(${requiredWork[oldField as keyof typeof requiredWork]} - 1, 0)`;
        }
        if (newField) {
          updates[newField] = sql`${requiredWork[newField as keyof typeof requiredWork]} + 1`;
        }

        if (Object.keys(updates).length > 0) {
          await db.update(requiredWork)
            .set(updates)
            .where(eq(requiredWork.planId, item.planId));
        }

        if (status === "PUBLISHED" && item.status !== "PUBLISHED") {
          await casUpdateStrategicPlan(item.planId, {
            totalPublished: sql`${strategicPlans.totalPublished} + 1`,
          });
        }
      }

      res.json({ success: true, status });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });


  app.get("/api/orchestrator/summaries/:campaignId", async (req: Request, res: Response) => {
    try {
      const accountId = resolveAccountId(req);
      const campaignId = req.params.campaignId;
      // explicit ownership assert at the boundary.
      try {
        await assertCampaignBelongsTo(accountId, campaignId);
      } catch (e) {
        if (handleOwnershipError(e, res)) return;
        throw e;
      }
      const requestedRunId = typeof req.query.runId === "string" ? req.query.runId : null;
      let resolved;
      try {
        resolved = await resolveRunId(campaignId, accountId, requestedRunId);
      } catch (e: any) {
        return res.status(404).json({ error: e.message });
      }
      if (!resolved.runId) {
        return res.json({ hasSummaries: false, engines: [] });
      }
      const [job] = await db.select().from(orchestratorJobs).where(and(
        eq(orchestratorJobs.id, resolved.runId),
        eq(orchestratorJobs.accountId, accountId),
        eq(orchestratorJobs.campaignId, campaignId),
      )).limit(1);
      if (!job) {
        return res.json({ hasSummaries: false, engines: [] });
      }

      const sections: Array<{ id: string; name: string; status: string; summary?: string | null }> =
        job.sectionStatuses ? JSON.parse(job.sectionStatuses) : [];

      let hasSummaries = sections.some(s => s.summary && s.summary !== "Pending");

      // Section summaries are persisted with the job. Do not query per-engine
      // "/latest" endpoints here: those endpoints can point to a later run and
      // would blend its snapshots into this selected job's preview.

      const engines = sections.map(sec => ({
        id: sec.id,
        name: sec.name,
        status: sec.status,
        summary: sec.summary || null,
      }));

      res.json({
        hasSummaries,
        jobId: resolved.runId,
        jobStatus: job.status,
        durationMs: job.durationMs,
        createdAt: job.createdAt,
        completedAt: job.completedAt,
        engines,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Engine Table Summary — aggregates all 15 engines in parallel
  app.get("/api/engines/table-summary", async (req: Request, res: Response) => {
    try {
      const campaignId = req.query.campaignId as string;
      if (!campaignId) return res.status(400).json({ error: "campaignId required" });

      // query.campaignId requires explicit
      // ownership truth at the boundary. Downstream calls fan out to other
      // local routes; without this assert, an attacker could enumerate
      // foreign campaigns via this aggregator.
      const accountId = resolveAccountId(req);
      try {
        await assertCampaignBelongsTo(accountId, campaignId);
      } catch (e) {
        if (handleOwnershipError(e, res)) return;
        throw e;
      }

      const base = `http://localhost:${process.env.PORT || 5000}`;
      const q = `?campaignId=${encodeURIComponent(campaignId)}`;

      async function safe(url: string) {
        try {
          const r = await fetch(url);
          if (!r.ok) return null;
          return r.json();
        } catch { return null; }
      }

      const [
        audience, positioning, differentiation, mechanism,
        offer, awareness, funnel, persuasion,
        integrity, statVal, budget, channel,
        iteration, retention,
      ] = await Promise.all([
        safe(`${base}/api/audience-engine/latest${q}`),
        safe(`${base}/api/positioning-engine/latest${q}`),
        safe(`${base}/api/differentiation-engine/latest${q}`),
        safe(`${base}/api/mechanism-engine/latest${q}`),
        safe(`${base}/api/offer-engine/latest${q}`),
        safe(`${base}/api/awareness-engine/latest${q}`),
        safe(`${base}/api/funnel-engine/latest${q}`),
        safe(`${base}/api/persuasion-engine/latest${q}`),
        safe(`${base}/api/integrity-engine/latest${q}`),
        safe(`${base}/api/strategy/statistical-validation/latest${q}`),
        safe(`${base}/api/strategy/budget-governor/latest${q}`),
        safe(`${base}/api/strategy/channel-selection/latest${q}`),
        safe(`${base}/api/strategy/iteration-engine/latest${q}`),
        safe(`${base}/api/strategy/retention-engine/latest${q}`),
      ]);

      // F2.1: tenant filter (defense-in-depth on top of boundary assert).
      let miRow: any = null;
      try {
        const miRes = await db.execute(
          sql`SELECT id, status, overall_confidence, narrative_synthesis, market_diagnosis, market_state, created_at
              FROM mi_snapshots
              WHERE campaign_id = ${campaignId} AND account_id = ${accountId}
              ORDER BY created_at DESC LIMIT 1`
        );
        miRow = miRes.rows?.[0] ?? null;
      } catch { /* ignore */ }

      function score(val: number | undefined | null): string {
        if (val == null) return "—";
        return (Math.round(val * 1000) / 10).toFixed(1) + "%";
      }

      // F2.6: canonical status only; no fabrication from id/exists presence.
      type CanonStatus = "COMPLETE" | "PARTIAL" | "UNKNOWN" | "MISSING";
      function summarizeStatus(snap: any): { status: CanonStatus; degraded: boolean } {
        if (snap == null) return { status: "MISSING", degraded: false };
        const raw = snap?.status;
        if (raw === "COMPLETE" || raw === "PARTIAL" || raw === "UNKNOWN" || raw === "MISSING") {
          return { status: raw as CanonStatus, degraded: false };
        }
        return { status: "UNKNOWN", degraded: true };
      }
      function summarizeMiStatus(row: any): { status: CanonStatus; degraded: boolean } {
        if (row == null) return { status: "MISSING", degraded: false };
        const raw = row?.status;
        if (raw === "COMPLETE" || raw === "PARTIAL" || raw === "UNKNOWN" || raw === "MISSING") {
          return { status: raw as CanonStatus, degraded: false };
        }
        return { status: "UNKNOWN", degraded: true };
      }
      const miSt = summarizeMiStatus(miRow);
      const audSt = summarizeStatus(audience);
      const posSt = summarizeStatus(positioning);
      const difSt = summarizeStatus(differentiation);
      const mecSt = summarizeStatus(mechanism);
      const offSt = summarizeStatus(offer);
      const awaSt = summarizeStatus(awareness);
      const funSt = summarizeStatus(funnel);
      const perSt = summarizeStatus(persuasion);
      const intSt = summarizeStatus(integrity);
      const stvSt = summarizeStatus(statVal);
      const budSt = summarizeStatus(budget?.snapshot);
      const chnSt = summarizeStatus(channel);
      const itrSt = summarizeStatus(iteration);
      const retSt = summarizeStatus(retention?.snapshot);

      const rows = [
        {
          num: "01",
          engine: "Market Intelligence",
          status: miSt.status,
          _provenance: { degraded: miSt.degraded },
          keyOutput: miRow?.market_diagnosis
            ? String(miRow.market_diagnosis).slice(0, 300)
            : miRow?.narrative_synthesis
              ? String(miRow.narrative_synthesis).slice(0, 300)
              : "No data",
          score: miRow?.overall_confidence != null ? score(miRow.overall_confidence) : "—",
          notes: miRow?.market_state ?? "",
        },
        {
          num: "02",
          engine: "Audience",
          status: audSt.status,
          _provenance: { degraded: audSt.degraded },
          keyOutput: (() => {
            const awarenessLvl = audience?.awarenessLevel?.level ?? audience?.awarenessLevel;
            const maturityLvl = audience?.maturityIndex?.level ?? audience?.maturityIndex;
            let topPain: string | null = null;
            try {
              const pains = typeof audience?.audiencePains === "string"
                ? JSON.parse(audience.audiencePains)
                : audience?.audiencePains;
              topPain = Array.isArray(pains) && pains[0]?.canonical
                ? `Top pain: ${pains[0].canonical}`
                : null;
            } catch { /* ignore */ }
            const segs = audience?.audienceSegments?.length
              ? `${audience.audienceSegments.length} segments`
              : null;
            return [
              awarenessLvl ? `Awareness level: ${awarenessLvl}` : null,
              maturityLvl ? `Maturity: ${maturityLvl}` : null,
              topPain,
              segs,
            ].filter(Boolean).join(" | ") || "No data";
          })(),
          score: audience?.maturityIndex?.confidenceScore != null
            ? score(audience.maturityIndex.confidenceScore)
            : audience?.awarenessLevel?.confidenceScore != null
              ? score(audience.awarenessLevel.confidenceScore)
              : "—",
          notes: "",
        },
        {
          num: "03",
          engine: "Positioning",
          status: posSt.status,
          _provenance: { degraded: posSt.degraded },
          keyOutput: [
            positioning?.territory?.name ? `Territory: ${positioning.territory.name}` : null,
            positioning?.narrativeDirection ? `Direction: ${positioning.narrativeDirection}` : null,
            positioning?.differentiationVector ? `Vector: ${positioning.differentiationVector}` : null,
          ].filter(Boolean).join(" | ") || "No data",
          score: positioning?.confidenceScore != null ? score(positioning.confidenceScore) : "—",
          notes: positioning?.statusMessage ?? "",
        },
        {
          num: "04",
          engine: "Differentiation",
          status: difSt.status,
          _provenance: { degraded: difSt.degraded },
          keyOutput: [
            differentiation?.differentiationPillars?.length
              ? `${differentiation.differentiationPillars.length} pillars: ${differentiation.differentiationPillars.slice(0, 2).map((p: any) => p.name).join(", ")}`
              : null,
            differentiation?.mechanismCore?.mechanismName
              ? `Mechanism: ${differentiation.mechanismCore.mechanismName}`
              : null,
            differentiation?.authorityMode?.mode
              ? `Authority: ${differentiation.authorityMode.mode}`
              : null,
            differentiation?.claimScores?.totalClaims != null
              ? `${differentiation.claimScores.totalClaims} claims | avg score: ${score(differentiation.claimScores.averageScore)}`
              : null,
            differentiation?.stabilityResult?.stable != null
              ? `Stability: ${differentiation.stabilityResult.stable ? "Stable" : "Unstable"}`
              : null,
          ].filter(Boolean).join(" | ") || "No data",
          score: differentiation?.confidenceScore != null ? score(differentiation.confidenceScore) : "—",
          notes: differentiation?.statusMessage ?? "",
        },
        {
          num: "05",
          engine: "Mechanism",
          status: mecSt.status,
          _provenance: { degraded: mecSt.degraded },
          keyOutput: mechanism?.primaryMechanism
            ? [
                `Name: ${mechanism.primaryMechanism.mechanismName}`,
                mechanism.primaryMechanism.mechanismDescription
                  ? mechanism.primaryMechanism.mechanismDescription.slice(0, 200)
                  : null,
                mechanism.primaryMechanism.mechanismSteps?.length
                  ? `${mechanism.primaryMechanism.mechanismSteps.length} steps`
                  : null,
              ].filter(Boolean).join(" | ")
            : "No data",
          score: mechanism?.confidenceScore != null ? score(mechanism.confidenceScore) : "—",
          notes: mechanism?.statusMessage ?? "",
        },
        {
          num: "06",
          engine: "Offer",
          status: offSt.status,
          _provenance: { degraded: offSt.degraded },
          keyOutput: offer?.primaryOffer
            ? [
                offer.primaryOffer.offerName ? `Offer: ${offer.primaryOffer.offerName}` : null,
                offer.primaryOffer.pricePoint ? `Price: ${offer.primaryOffer.pricePoint}` : null,
                offer.primaryOffer.valueStack?.length
                  ? `${offer.primaryOffer.valueStack.length}-item value stack`
                  : null,
                offer.primaryOffer.guarantee ? `Guarantee: ${offer.primaryOffer.guarantee}` : null,
              ].filter(Boolean).join(" | ")
            : "No data",
          score: offer?.offerStrengthScore != null
            ? score(offer.offerStrengthScore)
            : offer?.confidenceScore != null
              ? score(offer.confidenceScore)
              : "—",
          notes: offer?.statusMessage ?? "",
        },
        {
          num: "07",
          engine: "Awareness",
          status: awaSt.status,
          _provenance: { degraded: awaSt.degraded },
          keyOutput: awareness?.primaryRoute
            ? [
                `Route: ${awareness.primaryRoute.routeName}`,
                `Type: ${awareness.primaryRoute.entryMechanismType}`,
                awareness.primaryRoute.targetReadinessStage
                  ? `Stage: ${awareness.primaryRoute.targetReadinessStage}`
                  : null,
                awareness.primaryRoute.trustRequirement
                  ? `Trust: ${awareness.primaryRoute.trustRequirement}`
                  : null,
              ].filter(Boolean).join(" | ")
            : "No data",
          score: awareness?.awarenessStrengthScore != null
            ? score(awareness.awarenessStrengthScore)
            : awareness?.primaryRoute?.awarenessStrengthScore != null
              ? score(awareness.primaryRoute.awarenessStrengthScore)
              : "—",
          notes: awareness?.statusMessage ?? "",
        },
        {
          num: "08",
          engine: "Funnel",
          status: funSt.status,
          _provenance: { degraded: funSt.degraded },
          keyOutput: funnel?.primaryFunnel
            ? [
                `Funnel: ${funnel.primaryFunnel.funnelName}`,
                `Type: ${funnel.primaryFunnel.funnelType}`,
                funnel.primaryFunnel.stageMap?.length
                  ? `${funnel.primaryFunnel.stageMap.length} stages`
                  : null,
              ].filter(Boolean).join(" | ")
            : "No data",
          score: funnel?.confidenceScore != null ? score(funnel.confidenceScore) : "—",
          notes: funnel?.statusMessage ?? "",
        },
        {
          num: "09",
          engine: "Persuasion",
          status: perSt.status,
          _provenance: { degraded: perSt.degraded },
          keyOutput: persuasion?.primaryRoute
            ? [
                `Mode: ${persuasion.primaryRoute.persuasionMode}`,
                persuasion.primaryRoute.primaryInfluenceDrivers?.length
                  ? `Drivers: ${persuasion.primaryRoute.primaryInfluenceDrivers.slice(0, 3).join(", ")}`
                  : null,
              ].filter(Boolean).join(" | ")
            : "No data",
          score: persuasion?.persuasionStrengthScore != null
            ? score(persuasion.persuasionStrengthScore)
            : persuasion?.primaryRoute?.persuasionStrengthScore != null
              ? score(persuasion.primaryRoute.persuasionStrengthScore)
              : "—",
          notes: persuasion?.statusMessage ?? "",
        },
        {
          num: "10",
          engine: "Integrity",
          status: intSt.status,
          _provenance: { degraded: intSt.degraded },
          keyOutput: [
            integrity?.overallIntegrityScore != null
              ? `Integrity score: ${score(integrity.overallIntegrityScore)}`
              : null,
            integrity?.safeToExecute != null
              ? `Safe to execute: ${integrity.safeToExecute ? "YES" : "NO"}`
              : null,
            // CLP-15: compound check — passed===false on an EVALUATED layer is
            // a real failure. INSUFFICIENT_EVIDENCE is reported separately.
            (() => {
              const rows: any[] = integrity?.layerResults ?? [];
              if (!rows.length) return null;
              const failed = rows.filter((l: any) => l?.evaluationState === "EVALUATED" && l?.passed === false).length;
              const insufficient = rows.filter((l: any) => l?.evaluationState && l.evaluationState !== "EVALUATED").length;
              const evaluated = rows.length - insufficient;
              if (failed > 0 || insufficient > 0) {
                return `${failed} failed, ${insufficient} insufficient (of ${rows.length} layers)`;
              }
              return `All ${evaluated} layers passed`;
            })(),
          ].filter(Boolean).join(" | ") || "No data",
          score: integrity?.overallIntegrityScore != null ? score(integrity.overallIntegrityScore) : "—",
          notes: integrity?.statusMessage ?? "",
        },
        {
          num: "11",
          engine: "Statistical Validation",
          status: stvSt.status,
          _provenance: { degraded: stvSt.degraded },
          keyOutput: statVal?.result
            ? [
                `State: ${statVal.result.validationState}`,
                statVal.result.claimConfidenceScore != null
                  ? `Claim confidence: ${score(statVal.result.claimConfidenceScore)}`
                  : null,
                statVal.result.evidenceStrength != null
                  ? `Evidence: ${score(statVal.result.evidenceStrength)}`
                  : null,
              ].filter(Boolean).join(" | ")
            : "No data",
          score: statVal?.result?.claimConfidenceScore != null
            ? score(statVal.result.claimConfidenceScore)
            : "—",
          notes: statVal?.statusMessage ?? "",
        },
        {
          num: "12",
          engine: "Budget Governor",
          status: budSt.status,
          _provenance: { degraded: budSt.degraded },
          keyOutput: budget?.snapshot?.result?.decision
            ? [
                `Action: ${budget.snapshot.result.decision.action}`,
                budget.snapshot.result.decision.reasoning
                  ? budget.snapshot.result.decision.reasoning.slice(0, 200)
                  : budget.snapshot.statusMessage
                    ? budget.snapshot.statusMessage.slice(0, 200)
                    : null,
              ].filter(Boolean).join(" | ")
            : "No data",
          score: "—",
          notes: budget?.snapshot?.statusMessage ?? "",
        },
        {
          num: "13",
          engine: "Channel Selection",
          status: chnSt.status,
          _provenance: { degraded: chnSt.degraded },
          keyOutput: channel?.result?.primaryChannel
            ? [
                `Primary: ${channel.result.primaryChannel.channelName}`,
                `Fit: ${score(channel.result.primaryChannel.fitScore)}`,
                channel.result.primaryChannel.audienceDensityScore != null
                  ? `Audience density: ${score(channel.result.primaryChannel.audienceDensityScore)}`
                  : null,
                channel.result.channelMix?.length
                  ? `${channel.result.channelMix.length} channels in mix`
                  : null,
              ].filter(Boolean).join(" | ")
            : "No data",
          score: channel?.result?.primaryChannel?.fitScore != null
            ? score(channel.result.primaryChannel.fitScore)
            : "—",
          notes: channel?.statusMessage ?? "",
        },
        {
          num: "14",
          engine: "Iteration",
          status: itrSt.status,
          _provenance: { degraded: itrSt.degraded },
          keyOutput: [
            iteration?.nextTestHypotheses?.length
              ? `${iteration.nextTestHypotheses.length} test hypothesis: ${iteration.nextTestHypotheses[0]?.hypothesis ?? ""}`
              : null,
            iteration?.optimizationTargets?.length
              ? `${iteration.optimizationTargets.length} optimization target(s)`
              : null,
          ].filter(Boolean).join(" | ") || "No data",
          score: "—",
          notes: iteration?.statusMessage ?? "",
        },
        {
          num: "15",
          engine: "Retention",
          status: retSt.status,
          _provenance: { degraded: retSt.degraded },
          keyOutput: retention?.snapshot?.result?.retentionLoops?.length
            ? [
                `${retention.snapshot.result.retentionLoops.length} retention loop(s)`,
                `Loop 1: ${retention.snapshot.result.retentionLoops[0]?.name}`,
                retention.snapshot.result.retentionLoops[0]?.type
                  ? `Type: ${retention.snapshot.result.retentionLoops[0].type}`
                  : null,
              ].filter(Boolean).join(" | ")
            : "No data",
          score: "—",
          notes: retention?.snapshot?.statusMessage ?? "",
        },
      ];

      res.json({ rows });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/narrative/:campaignId", async (req: Request, res: Response) => {
    try {
      const accountId = resolveAccountId(req);
      // explicit ownership assert at the boundary.
      try {
        await assertCampaignBelongsTo(accountId, req.params.campaignId);
      } catch (e) {
        if (handleOwnershipError(e, res)) return;
        throw e;
      }
      const narrative = await buildCausalNarrative(req.params.campaignId, accountId, (req.query.runId as string) || null);
      res.json(narrative);
    } catch (error: any) {
      if (typeof error?.message === "string" && error.message.startsWith("RUN_NOT_FOUND")) {
        return res.status(404).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });
}
