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
  offerSnapshots,
  strategyRoots,
  mechanismSnapshots,
  awarenessSnapshots,
  differentiationSnapshots,
  positioningSnapshots,
  budgetAllocationSnapshots,
  budgetGovernorSnapshots,
  channelSelectionSnapshots,
} from "@shared/schema";
import { eq, and, or, desc, sql, inArray } from "drizzle-orm";
import { validateRootIntegrity, detectStaleness, computeCalendarDeviation } from "../root-bundle";
import { casUpdateStrategicPlan, casUpdateStrategicPlanByVersion } from "../strategic-core/cas-helper";
import { computeFulfillment } from "../fulfillment-engine";
import { buildCausalNarrative } from "../narrative-layer";
import { computeAdaptiveRhythm } from "../adaptive-rhythm/engine";
import { buildCanonicalBudgetAuthorityModel } from "./plan-synthesis";

import { resolveAccountId } from "../auth";
import { resolveRunId } from "./run-resolver";
import { assertCampaignBelongsTo, handleOwnershipError, resolveApprovalProvenance } from "../auth-helpers";
import { designateActiveExecutionPlan, resolvePlanContext } from "./execution-plan-resolver";
import { evaluateTaskEligibility } from "../shared/task-eligibility";
import { runWithAiCampaignContext } from "../ai-client";
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

      runWithAiCampaignContext(
        {
          accountId,
          campaignId: String(campaignId),
          operationType: "strategy_orchestration",
          runId: pendingJobId,
        },
        () =>
          runOrchestrator({
            accountId,
            campaignId: String(campaignId),
            forceRefresh: forceRefresh || false,
            resumeFromEngine,
            pausedJobId: pausedJobId || undefined,
            preassignedJobId: pausedJobId ? undefined : pendingJobId,
            scopedEngines: Array.isArray(scopedEngines) ? scopedEngines : undefined,
          })
      ).then(result => {
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

      const requestedPlanId = (req.query.planId as string) || null;
      const requestedRunId = (req.query.runId as string) || null;

      let resolved;
      try {
        resolved = await resolveRunId(req.params.campaignId, accountId, requestedRunId);
      } catch (e: any) {
        return res.status(404).json({ error: e.message, runId: null, isLatest: false, isStale: false });
      }

      const planCtx = await resolvePlanContext({
        campaignId: req.params.campaignId,
        accountId,
        specificPlanId: requestedPlanId || null,
        specificRunId: requestedRunId || null,
        mode: "LATEST_VIEWABLE",
      });

      if (!requestedRunId && planCtx.jobId) {
        resolved = { ...resolved, runId: planCtx.jobId, planId: planCtx.planId };
      }
      const effectiveRunId = planCtx.jobId || resolved.runId;

      const [selectedJob] = resolved.runId
        ? await db
            .select({
              id: orchestratorJobs.id,
              status: orchestratorJobs.status,
              error: orchestratorJobs.error,
              planId: orchestratorJobs.planId,
              sectionStatuses: orchestratorJobs.sectionStatuses,
              createdAt: orchestratorJobs.createdAt,
            })
            .from(orchestratorJobs)
            .where(
              and(
                eq(orchestratorJobs.id, resolved.runId!),
                eq(orchestratorJobs.campaignId, req.params.campaignId),
                eq(orchestratorJobs.accountId, accountId)
              )
            )
            .limit(1)
        : [undefined];

      let plan: any = planCtx.selectedPlan;
      if (!plan && resolved.runId && resolved.planId) {
        const [p] = await db
          .select()
          .from(strategicPlans)
          .where(
            and(
              eq(strategicPlans.accountId, accountId),
              eq(strategicPlans.campaignId, req.params.campaignId),
              eq(strategicPlans.id, resolved.planId)
            )
          )
          .limit(1);
        plan = p || null;
      }

      const designatedActivePlan = planCtx.designatedActivePlan;

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
          runId: effectiveRunId,
          isLatest: resolved.isLatest,
          isStale: resolved.isStale,
          completedAt: resolved.completedAt,
          hasPlan: false,
          designatedActivePlan: designatedActivePlan ? {
            id: designatedActivePlan.id,
            status: designatedActivePlan.status,
            executionStatus: designatedActivePlan.executionStatus,
            isDesignatedActive: true,
            summary: designatedActivePlan.planSummary,
            rootBundleId: designatedActivePlan.rootBundleId,
            version: designatedActivePlan.version,
            createdAt: designatedActivePlan.createdAt,
            updatedAt: designatedActivePlan.updatedAt,
          } : null,
          approvedPlan: designatedActivePlan ? {
            id: designatedActivePlan.id,
            status: designatedActivePlan.status,
            executionStatus: designatedActivePlan.executionStatus,
            isDesignatedActive: true,
            summary: designatedActivePlan.planSummary,
            rootBundleId: designatedActivePlan.rootBundleId,
            version: designatedActivePlan.version,
            createdAt: designatedActivePlan.createdAt,
            updatedAt: designatedActivePlan.updatedAt,
          } : null,
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

      const safeParse = (val: any) => {
        if (!val) return null;
        if (typeof val === "object") return val;
        try { return JSON.parse(val); } catch { return val; }
      };

      const planData = plan.planJson ? JSON.parse(plan.planJson) : {};
      const targetJobId = plan.jobId || planCtx.jobId || resolved.runId;

      // 1. Hydrate Strategy Root & approvedMechanism from pinned root
      if (planData && !planData.strategyRoot && planCtx.strategyRoot) {
        const sr = planCtx.strategyRoot;
        planData.strategyRoot = {
          id: sr.id,
          runId: sr.runId,
          status: sr.status,
          primaryAxis: sr.primaryAxis,
          contrastAxis: sr.contrastAxisText,
          approvedPromise: sr.approvedPromise,
          approvedTransformation: sr.approvedTransformation,
          approvedMechanism: safeParse(sr.approvedMechanism),
          approvedPositioningContext: safeParse(sr.approvedPositioningContext),
        };
      }

      // 1b. Hydrate canonical Positioning Snapshot with epistemic status, comparison status, and rationale
      if (planData && (planCtx.snapshotIds.positioningSnapshotId || targetJobId)) {
        const [posSnap] = planCtx.snapshotIds.positioningSnapshotId
          ? await db.select().from(positioningSnapshots).where(eq(positioningSnapshots.id, planCtx.snapshotIds.positioningSnapshotId)).limit(1)
          : await db.select().from(positioningSnapshots).where(
              and(
                eq(positioningSnapshots.accountId, accountId),
                eq(positioningSnapshots.campaignId, req.params.campaignId),
                eq(positioningSnapshots.jobId, targetJobId!)
              )
            ).orderBy(desc(positioningSnapshots.createdAt)).limit(1);

        if (posSnap) {
          const posTerritories = safeParse(posSnap.territories) || [];
          const primaryTerr = Array.isArray(posTerritories) && posTerritories.length > 0 ? posTerritories[0] : (safeParse(posSnap.territory) || {});
          const semCol = primaryTerr?.semanticCollision || {};
          const comparedCompetitorCount = Number(semCol?.comparedCompetitorCount ?? 0);
          const comparisonStatus =
            primaryTerr?.comparisonStatus ||
            semCol?.comparisonStatus ||
            (comparedCompetitorCount > 0 ? "COMPARISON_COMPLETED" : "COMPETITIVE_COMPARISON_UNAVAILABLE");
          const epistemicStatus =
            primaryTerr?.epistemicStatus ||
            (comparisonStatus !== "COMPARISON_COMPLETED" || comparedCompetitorCount === 0
              ? "STRATEGIC_HYPOTHESIS"
              : "VERIFIED_FACT");
          const epistemicLabel =
            primaryTerr?.epistemicLabel ||
            (comparisonStatus !== "COMPARISON_COMPLETED" || comparedCompetitorCount === 0
              ? "Proposed Strategic Hypothesis — Requires Market Validation (No Competitor Positioning Compared)"
              : "Supported by Product Facts");
          const proposalStatus = primaryTerr?.proposalStatus || (epistemicStatus === "STRATEGIC_HYPOTHESIS" ? "PROPOSED" : "VERIFIED");
          const positioningOutcomeType =
            primaryTerr?.positioningOutcomeType ||
            (comparisonStatus !== "COMPARISON_COMPLETED" || comparedCompetitorCount === 0
              ? "SHARED_CAPABILITY_STRATEGIC_EMPHASIS"
              : "SUPPORTED_DIFFERENTIATED");

          planData.positioning = {
            ...(planData.positioning || {}),
            snapshotId: posSnap.id,
            jobId: posSnap.jobId,
            status: posSnap.status,
            territory: primaryTerr?.name || (typeof posSnap.territory === "string" && !posSnap.territory.startsWith("{") ? posSnap.territory : planCtx.strategyRoot?.primaryAxis || ""),
            enemyDefinition: posSnap.enemyDefinition || primaryTerr?.enemyDefinition || "",
            contrastAxis: posSnap.contrastAxis || primaryTerr?.contrastAxis || planCtx.strategyRoot?.contrastAxisText || "",
            narrativeDirection: posSnap.narrativeDirection || primaryTerr?.narrativeDirection || "",
            rationale: primaryTerr?.rationale || planData.positioning?.rationale || "",
            epistemicStatus,
            epistemicLabel,
            proposalStatus,
            verificationStatus: proposalStatus,
            positioningOutcomeType,
            comparisonStatus,
            comparedCompetitorCount,
          };

          if (planData.strategyRoot && !planData.strategyRoot.rationale && primaryTerr?.rationale) {
            planData.strategyRoot.rationale = primaryTerr.rationale;
          }
          if (planData.strategicSummary) {
            planData.strategicSummary.epistemicStatus = planData.strategicSummary.epistemicStatus || epistemicStatus;
            planData.strategicSummary.epistemicLabel = planData.strategicSummary.epistemicLabel || epistemicLabel;
            planData.strategicSummary.proposalStatus = planData.strategicSummary.proposalStatus || proposalStatus;
            planData.strategicSummary.comparisonStatus = planData.strategicSummary.comparisonStatus || comparisonStatus;
            planData.strategicSummary.positioningOutcomeType = planData.strategicSummary.positioningOutcomeType || positioningOutcomeType;
          }
          if (planData.businessRepresentation?.strategicSummary) {
            planData.businessRepresentation.strategicSummary.epistemicStatus = planData.businessRepresentation.strategicSummary.epistemicStatus || epistemicStatus;
            planData.businessRepresentation.strategicSummary.epistemicLabel = planData.businessRepresentation.strategicSummary.epistemicLabel || epistemicLabel;
            planData.businessRepresentation.strategicSummary.proposalStatus = planData.businessRepresentation.strategicSummary.proposalStatus || proposalStatus;
            planData.businessRepresentation.strategicSummary.comparisonStatus = planData.businessRepresentation.strategicSummary.comparisonStatus || comparisonStatus;
            planData.businessRepresentation.strategicSummary.positioningOutcomeType = planData.businessRepresentation.strategicSummary.positioningOutcomeType || positioningOutcomeType;
          }
        }
      }

      // 2. Hydrate canonical same-run / root-pinned Offer Snapshot if missing from planJson
      if (planData && !planData.offer && (planCtx.snapshotIds.offerSnapshotId || targetJobId)) {
        const [offerSnap] = planCtx.snapshotIds.offerSnapshotId
          ? await db.select().from(offerSnapshots).where(eq(offerSnapshots.id, planCtx.snapshotIds.offerSnapshotId)).limit(1)
          : await db.select().from(offerSnapshots).where(
              and(
                eq(offerSnapshots.accountId, accountId),
                eq(offerSnapshots.campaignId, req.params.campaignId),
                eq(offerSnapshots.jobId, targetJobId!)
              )
            ).limit(1);

        if (offerSnap?.primaryOffer) {
          planData.offer = safeParse(offerSnap.primaryOffer);
        }
      }

      // 3. Hydrate canonical Mechanism Snapshot if missing from planJson
      if (planData && (!planData.mechanism || !planData.mechanism.mechanismName) && (planCtx.snapshotIds.mechanismSnapshotId || targetJobId)) {
        const [mechSnap] = planCtx.snapshotIds.mechanismSnapshotId
          ? await db.select().from(mechanismSnapshots).where(eq(mechanismSnapshots.id, planCtx.snapshotIds.mechanismSnapshotId)).limit(1)
          : await db.select().from(mechanismSnapshots).where(
              and(
                eq(mechanismSnapshots.accountId, accountId),
                eq(mechanismSnapshots.campaignId, req.params.campaignId),
                eq(mechanismSnapshots.jobId, targetJobId!)
              )
            ).orderBy(desc(mechanismSnapshots.createdAt)).limit(1);

        if (mechSnap) {
          const primaryMech = safeParse(mechSnap.primaryMechanism) || {};
          const steps = safeParse(mechSnap.mechanismSteps) || primaryMech.mechanismSteps || [];
          const proof = safeParse(mechSnap.proofArtifact) || primaryMech.proofArtifact || null;
          planData.mechanism = {
            snapshotId: mechSnap.id,
            jobId: mechSnap.jobId,
            status: mechSnap.status,
            confidenceScore: mechSnap.confidenceScore,
            mechanismName: primaryMech.mechanismName || primaryMech.name || "",
            name: primaryMech.mechanismName || primaryMech.name || "",
            mechanismType: primaryMech.mechanismType || mechSnap.mechanismType || "",
            mechanismLogic: primaryMech.mechanismLogic || primaryMech.logic || "",
            mechanismPromise: primaryMech.mechanismPromise || primaryMech.promise || "",
            whyItWorks: primaryMech.whyItWorks || primaryMech.rationale || "",
            mechanismSteps: Array.isArray(steps) ? steps : [],
            proofArtifact: proof,
            primaryMechanism: primaryMech,
          };
          if (planData.brandSpine && !planData.brandSpine.mechanismName && planData.mechanism.mechanismName) {
            planData.brandSpine.mechanismName = planData.mechanism.mechanismName;
            planData.brandSpine.mechanismSummary = planData.mechanism.mechanismSteps
              .map((s: any) => typeof s === "string" ? s : `${s.title || s.name || `Step ${s.step}`}: ${s.description || ""}`)
              .join(" → ");
          }
        }
      }

      // 4. Hydrate canonical Awareness Snapshot if missing from planJson
      if (planData && (!planData.awareness || !planData.awareness.oldBelief || !planData.awareness.entryStage) && (planCtx.snapshotIds.awarenessSnapshotId || targetJobId)) {
        const [awSnap] = planCtx.snapshotIds.awarenessSnapshotId
          ? await db.select().from(awarenessSnapshots).where(eq(awarenessSnapshots.id, planCtx.snapshotIds.awarenessSnapshotId)).limit(1)
          : await db.select().from(awarenessSnapshots).where(
              and(
                eq(awarenessSnapshots.accountId, accountId),
                eq(awarenessSnapshots.campaignId, req.params.campaignId),
                eq(awarenessSnapshots.jobId, targetJobId!)
              )
            ).orderBy(desc(awarenessSnapshots.createdAt)).limit(1);

        const existingPrimary = safeParse(planData.awareness?.primaryRoute) || {};
        const snapPrimary = awSnap ? (safeParse(awSnap.primaryRoute) || {}) : {};
        const primaryRoute = Object.keys(snapPrimary).length > 0 ? snapPrimary : existingPrimary;

        if (awSnap || Object.keys(primaryRoute).length > 0) {
          const reframeObj = safeParse(primaryRoute.narrativeReframe) || safeParse(planData.awareness?.narrativeReframe) || null;
          const mythBreakerObj = safeParse(primaryRoute.mythBreaker) || safeParse(planData.awareness?.mythBreaker) || null;
          const layerMechs = awSnap ? (safeParse(awSnap.layerResults) || null) : (planData.awareness?.layerMechanisms || null);

          const oldBelief =
            reframeObj?.currentModel?.statement ||
            reframeObj?.oldBelief ||
            mythBreakerObj?.beliefToContradict ||
            mythBreakerObj?.commonMyth ||
            planData.awareness?.oldBelief ||
            "";
          const newBelief =
            reframeObj?.newModel?.reclassification ||
            reframeObj?.newBelief ||
            mythBreakerObj?.mythBreakerStatement ||
            mythBreakerObj?.reframeStatement ||
            planData.awareness?.newBelief ||
            "";
          const narrativeReframeText =
            typeof reframeObj === "string"
              ? reframeObj
              : (reframeObj?.newModel?.namedPrinciple
                  ? `${reframeObj.newModel.namedPrinciple}: ${reframeObj.newModel.reclassification || newBelief}`
                  : (reframeObj?.bridgeMechanism?.specificMove || mythBreakerObj?.mythBreakerStatement || ""));
          const entryLogicText =
            reframeObj?.bridgeMechanism?.specificMove ||
            mythBreakerObj?.contradictionLogic ||
            primaryRoute.trustRequirement ||
            planData.awareness?.entryLogic ||
            "";
          const audienceFramingText =
            primaryRoute.funnelCompatibility ||
            reframeObj?.discomfortCost?.privateAdmission ||
            planData.awareness?.audienceFraming ||
            "";
          const mythBreakersList = mythBreakerObj
            ? [{
                myth: mythBreakerObj.beliefToContradict || mythBreakerObj.commonMyth || oldBelief,
                reality: mythBreakerObj.mythBreakerStatement || mythBreakerObj.realityTruth || newBelief,
                contradictionLogic: mythBreakerObj.contradictionLogic || "",
              }]
            : [];

          planData.awareness = {
            ...(planData.awareness || {}),
            snapshotId: awSnap?.id || planData.awareness?.snapshotId,
            jobId: awSnap?.jobId || planData.awareness?.jobId || targetJobId,
            status: awSnap?.status || planData.awareness?.status || "COMPLETE",
            confidenceScore: awSnap?.awarenessStrengthScore ?? primaryRoute.awarenessStrengthScore ?? null,
            routeName: primaryRoute.routeName || planData.awareness?.routeName || planData.awarenessRoute || "",
            entryStage: primaryRoute.entryStage || primaryRoute.entryMechanismType || "proof_led_entry",
            targetReadinessStage: primaryRoute.targetReadinessStage || "problem_aware",
            oldBelief,
            currentBelief: oldBelief,
            newBelief,
            desiredBelief: newBelief,
            narrativeReframe: narrativeReframeText,
            narrativeReframeDetails: reframeObj,
            mythBreaker: mythBreakerObj?.mythBreakerStatement || null,
            mythBreakerDetails: mythBreakerObj,
            mythBreakers: mythBreakersList,
            entryLogic: entryLogicText,
            audienceFraming: audienceFramingText,
            primaryRoute,
            layerMechanisms: layerMechs,
          };
        }
      }

      // 5. Hydrate Differentiation Pillars with epistemic classifications from pinned Differentiation Snapshot
      if (planData && (!Array.isArray(planData.differentiationPillars) || planData.differentiationPillars.length === 0) && (planCtx.snapshotIds.differentiationSnapshotId || targetJobId)) {
        const [diffSnap] = planCtx.snapshotIds.differentiationSnapshotId
          ? await db.select().from(differentiationSnapshots).where(eq(differentiationSnapshots.id, planCtx.snapshotIds.differentiationSnapshotId)).limit(1)
          : await db.select().from(differentiationSnapshots).where(
              and(
                eq(differentiationSnapshots.accountId, accountId),
                eq(differentiationSnapshots.campaignId, req.params.campaignId),
                eq(differentiationSnapshots.jobId, targetJobId!)
              )
            ).orderBy(desc(differentiationSnapshots.createdAt)).limit(1);

        if (diffSnap) {
          const rawPillars = safeParse(diffSnap.differentiationPillars) || [];
          const claimAssessments = safeParse(diffSnap.claimAssessments) || [];
          const snapClassification = diffSnap.differentiationClassification || "SHARED_CAPABILITY_STRATEGIC_EMPHASIS";
          planData.differentiationPillars = (Array.isArray(rawPillars) ? rawPillars : []).map((p: any, idx: number) => {
            const pObj = typeof p === "string" ? { pillarName: p, description: p } : p;
            const matchedAssessment = Array.isArray(claimAssessments)
              ? claimAssessments.find((ca: any) => ca.claimId === pObj.id || ca.pillarName === pObj.pillarName || ca.title === pObj.title) || claimAssessments[idx]
              : null;
            const classification = pObj.differentiationClassification || matchedAssessment?.differentiationClassification || snapClassification;
            const isStrategicEmphasis = classification === "SHARED_CAPABILITY_STRATEGIC_EMPHASIS" || diffSnap.status === "COMPETITIVE_COMPARISON_UNAVAILABLE";
            return {
              ...pObj,
              snapshotId: diffSnap.id,
              pillarName: pObj.pillarName || pObj.pillar || pObj.title || pObj.name || `Differentiation Pillar ${idx + 1}`,
              title: pObj.title || pObj.pillarName || pObj.pillar || pObj.name || `Differentiation Pillar ${idx + 1}`,
              description: pObj.description || pObj.rationale || pObj.whyItMatters || "",
              differentiationClassification: classification,
              competitiveSupport: pObj.competitiveSupport || matchedAssessment?.competitiveSupport || (diffSnap.status === "COMPETITIVE_COMPARISON_UNAVAILABLE" ? "COMPETITIVE_COMPARISON_UNAVAILABLE" : "SHARED_CAPABILITY"),
              epistemicStatus: pObj.epistemicStatus || (isStrategicEmphasis ? "STRATEGIC_HYPOTHESIS" : "SUPPORTED"),
              strategicStatus: pObj.strategicStatus || (isStrategicEmphasis ? "STRATEGIC_MARKET_EMPHASIS" : "SUPPORTED"),
              truthStatus: pObj.truthStatus || (isStrategicEmphasis ? "PROPOSED" : "SUPPORTED"),
              honestLabel: pObj.honestLabel || (isStrategicEmphasis
                ? "Supported Product Capability · Strategic Market Emphasis (Competitor Uniqueness Unverified)"
                : "Supported by Product Truth"),
              truthLabel: pObj.truthLabel || (isStrategicEmphasis
                ? "Supported Capability · Strategic Market Emphasis (Competitor Uniqueness Unverified)"
                : "Supported by Product Truth"),
              supportingProof: pObj.supportingProof || pObj.evidence || matchedAssessment?.supportingFacts || [],
              limitations: pObj.limitations || matchedAssessment?.limitations || (diffSnap.status === "COMPETITIVE_COMPARISON_UNAVAILABLE"
                ? ["Direct competitor feature comparison unavailable; positioned as strategic market emphasis."]
                : []),
            };
          });
        }
      }

      // 6. Hydrate & enrich Budget Allocation with canonical Budget Governor authority + Channel Selection preliminary recommendation
      if (planData) {
        let bgGovResult: any = null;
        if (planCtx.snapshotIds.budgetSnapshotId) {
          const [bgSnap] = await db
            .select()
            .from(budgetGovernorSnapshots)
            .where(eq(budgetGovernorSnapshots.id, planCtx.snapshotIds.budgetSnapshotId))
            .limit(1);
          if (bgSnap) {
            bgGovResult = safeParse(bgSnap.result) || null;
          }
        }
        let chanSelResult: any = null;
        if (planCtx.snapshotIds.channelSelectionSnapshotId) {
          const [csSnap] = await db
            .select()
            .from(channelSelectionSnapshots)
            .where(eq(channelSelectionSnapshots.id, planCtx.snapshotIds.channelSelectionSnapshotId))
            .limit(1);
          if (csSnap) {
            chanSelResult = safeParse(csSnap.result) || null;
          }
        }

        if (!planData.budgetAllocation && (planCtx.snapshotIds.budgetSnapshotId || targetJobId)) {
          const [budgetSnap] = planCtx.snapshotIds.budgetSnapshotId
            ? await db.select().from(budgetAllocationSnapshots).where(eq(budgetAllocationSnapshots.id, planCtx.snapshotIds.budgetSnapshotId)).limit(1)
            : await db.select().from(budgetAllocationSnapshots).where(
                and(
                  eq(budgetAllocationSnapshots.accountId, accountId),
                  eq(budgetAllocationSnapshots.campaignId, req.params.campaignId),
                  eq(budgetAllocationSnapshots.jobId, targetJobId!)
                )
              ).orderBy(desc(budgetAllocationSnapshots.createdAt)).limit(1);

          if (budgetSnap) {
            const channelAllocs = (safeParse(budgetSnap.channelAllocations) || []).map((alloc: any) => ({
              ...alloc,
              channelId: alloc.channelId || alloc.id || String(alloc.channel || alloc.channelName || "").toLowerCase().replace(/\s+/g, "_"),
              channelName: alloc.channelName || alloc.channel || alloc.category || "Channel",
              channel: alloc.channel || alloc.channelName || alloc.category || "Channel",
              platform: alloc.platform || (String(alloc.channel || "").toLowerCase().includes("instagram") ? "Instagram" : String(alloc.channel || "").toLowerCase().includes("tiktok") ? "TikTok" : alloc.channel),
              mode: alloc.mode || (String(alloc.channel || "").toLowerCase().includes("organic") ? "ORGANIC" : "PAID"),
              costCategory: alloc.costCategory || (String(alloc.channel || "").toLowerCase().includes("organic") ? "ORGANIC_PRODUCTION_EFFORT" : "PAID_MEDIA_AD_SPEND"),
              percentage: Number(alloc.percentage ?? alloc.sharePercent ?? 0),
              monthlyAmount: Number(alloc.monthlyAmount ?? alloc.monthlyBudget ?? alloc.allocatedAmount ?? 0),
              monthlyBudget: Number(alloc.monthlyBudget ?? alloc.monthlyAmount ?? alloc.allocatedAmount ?? 0),
              allocatedAmount: Number(alloc.allocatedAmount ?? alloc.monthlyAmount ?? alloc.monthlyBudget ?? 0),
            }));
            planData.budgetAllocation = {
              snapshotId: budgetSnap.id,
              jobId: budgetSnap.jobId,
              status: budgetSnap.status,
              totalMonthlyBudget: budgetSnap.totalMonthlyBudget,
              currency: budgetSnap.currency || "USD",
              channelAllocations: channelAllocs,
              paidVsOrganicSplit: safeParse(budgetSnap.paidVsOrganicSplit),
              creativeProductionReserve: safeParse(budgetSnap.creativeProductionReserve),
              experimentBudget: safeParse(budgetSnap.experimentBudget),
              scalingRules: safeParse(budgetSnap.scalingRules),
            };
          }
        }

        const existingBa = planData.budgetAllocation || {};
        if (bgGovResult || Array.isArray(existingBa.channels)) {
          const canonicalBa = buildCanonicalBudgetAuthorityModel({
            totalMonthlyBudget: Number(
              existingBa.totalMonthlyBudget ?? bgGovResult?.totalMonthlyBudget ?? 5000,
            ),
            currency: existingBa.currency || bgGovResult?.currency || "USD",
            budgetSettingsVersion: Number(
              existingBa.budgetSettingsVersion ?? bgGovResult?.budgetSettingsVersion ?? 1,
            ),
            budgetConfirmation:
              existingBa.budgetConfirmation === "unconfirmed" ? "unconfirmed" : "user_confirmed",
            budgetGovernorOutput:
              bgGovResult || {
                totalMonthlyBudget: existingBa.totalMonthlyBudget ?? 5000,
                currency: existingBa.currency || "USD",
                spendAction: existingBa.testingAndScalingGuidance?.spendAction || "hold",
                commercialStrategy: {
                  spendPace: existingBa.testingAndScalingGuidance?.spendPace || "cautious",
                  learningBudgetCarveOutPct:
                    existingBa.testingAndScalingGuidance?.learningBudgetCarveOutPct ?? 20,
                },
                allocations: existingBa.channels || existingBa.channelAllocations || [],
              },
            channelSelectionOutput: chanSelResult || planData.channelSelection || null,
            weeklyCadence: planData.contentDistribution
              ? {
                  reelsPerWeek: Number(planData.contentDistribution.reelsPerWeek || 2),
                  postsPerWeek: Number(planData.contentDistribution.postsPerWeek || 2),
                  storiesPerDay: Number(planData.contentDistribution.storiesPerDay || 1),
                  carouselsPerWeek: Number(planData.contentDistribution.carouselsPerWeek || 1),
                  videosPerWeek: Number(planData.contentDistribution.videosPerWeek || 1),
                }
              : undefined,
          });
          planData.budgetAllocation = {
            ...existingBa,
            ...canonicalBa,
          };
        }

        // Normalize fallback "Primary Strategic Channel, Secondary Strategic Channel" placeholder in contentDistribution at read time
        if (planData.contentDistribution) {
          const cs = chanSelResult || planData.channelSelection || {};
          const actualPrimary =
            cs?.primaryChannel?.channelName ||
            cs?.aiChannelProposal?.proposedPrimary ||
            cs?.primaryChannel ||
            planData.contentDistribution?.channels?.[0]?.channel ||
            null;
          const actualSecondary =
            cs?.secondaryChannel?.channelName ||
            cs?.aiChannelProposal?.secondary ||
            cs?.secondaryChannel ||
            planData.contentDistribution?.channels?.[1]?.channel ||
            null;
          const actualSupporting = (Array.isArray(cs?.aiChannelProposal?.dynamicRecommendations)
            ? cs.aiChannelProposal.dynamicRecommendations
            : []
          )
            .filter(
              (dr: any) =>
                dr?.channelName &&
                dr.channelName !== actualPrimary &&
                dr.channelName !== actualSecondary &&
                String(dr?.tier || "").toUpperCase() === "SUPPORTING",
            )
            .map((dr: any) => String(dr.channelName));
          const resolvedChannelsLabel = [actualPrimary, actualSecondary, ...actualSupporting]
            .filter((x) => typeof x === "string" && x.trim().length > 0)
            .join(", ");
          if (resolvedChannelsLabel) {
            if (
              typeof planData.contentDistribution.rationale === "string" &&
              planData.contentDistribution.rationale.includes("Primary Strategic Channel")
            ) {
              planData.contentDistribution.rationale = planData.contentDistribution.rationale.replace(
                /Primary Strategic Channel,\s*Secondary Strategic Channel/g,
                resolvedChannelsLabel,
              );
            }
            if (
              typeof planData.executionBlueprintDnaLink?.weeklyDnaApplication === "string" &&
              planData.executionBlueprintDnaLink.weeklyDnaApplication.includes("Primary Strategic Channel")
            ) {
              planData.executionBlueprintDnaLink.weeklyDnaApplication =
                planData.executionBlueprintDnaLink.weeklyDnaApplication.replace(
                  /Primary Strategic Channel,\s*Secondary Strategic Channel/g,
                  resolvedChannelsLabel,
                );
            }
            if (
              typeof planData.businessRepresentation?.executionBlueprintDnaLink?.weeklyDnaApplication === "string" &&
              planData.businessRepresentation.executionBlueprintDnaLink.weeklyDnaApplication.includes("Primary Strategic Channel")
            ) {
              planData.businessRepresentation.executionBlueprintDnaLink.weeklyDnaApplication =
                planData.businessRepresentation.executionBlueprintDnaLink.weeklyDnaApplication.replace(
                  /Primary Strategic Channel,\s*Secondary Strategic Channel/g,
                  resolvedChannelsLabel,
                );
            }
          }
        }
      }

      // 7. Hydrate canonical campaignOffering from Business Understanding if missing from planJson
      if (planData && !planData.campaignOffering) {
        try {
          const buRes = await db.execute(sql`
            SELECT business_understanding 
            FROM business_understanding_snapshots 
            WHERE campaign_id = ${req.params.campaignId} 
            ORDER BY created_at DESC 
            LIMIT 1
          `);
          if (buRes.rows.length > 0) {
            const raw = (buRes.rows[0] as any).business_understanding;
            const parsedBu = typeof raw === "string" ? JSON.parse(raw) : raw;
            if (parsedBu?.campaignOffering) {
              planData.campaignOffering = parsedBu.campaignOffering;
            }
          }
        } catch (err: any) {
          console.warn("[PlanRoute] Could not hydrate campaignOffering:", err.message);
        }
      }

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

      const allCampaignPlans = await db
        .select({ id: strategicPlans.id })
        .from(strategicPlans)
        .where(
          and(
            eq(strategicPlans.accountId, accountId),
            eq(strategicPlans.campaignId, req.params.campaignId)
          )
        );
      const totalPlanRevisions = allCampaignPlans.length;
      const activePlanVersion = designatedActivePlan?.version ?? plan.version ?? null;
      const rootBundleVersion =
        plan.rootBundleVersion ??
        designatedActivePlan?.rootBundleVersion ??
        planData?.rootBundle?.bundleVersion ??
        planData?.rootBundle?.version ??
        null;
      const candidateDraftRow = planCtx.candidateDraftPlan || (plan && plan.status === "DRAFT" ? plan : null);

      res.json({
        runId: resolved.runId,
        isLatest: resolved.isLatest,
        isStale: resolved.isStale,
        completedAt: resolved.completedAt,
        hasPlan: true,
        activePlanVersion,
        rootBundleVersion,
        totalPlanRevisions,
        liveRhythm,
        approvedRhythm,
        rhythmDelta,
        designatedActivePlan: designatedActivePlan ? {
          id: designatedActivePlan.id,
          status: designatedActivePlan.status,
          executionStatus: designatedActivePlan.executionStatus,
          isDesignatedActive: true,
          summary: designatedActivePlan.planSummary,
          rootBundleId: designatedActivePlan.rootBundleId,
          rootBundleVersion: designatedActivePlan.rootBundleVersion ?? rootBundleVersion,
          version: designatedActivePlan.version,
          activePlanVersion: designatedActivePlan.version,
          totalPlanRevisions,
          createdAt: designatedActivePlan.createdAt,
          updatedAt: designatedActivePlan.updatedAt,
        } : null,
        approvedPlan: designatedActivePlan ? {
          id: designatedActivePlan.id,
          status: designatedActivePlan.status,
          executionStatus: designatedActivePlan.executionStatus,
          isDesignatedActive: true,
          summary: designatedActivePlan.planSummary,
          rootBundleId: designatedActivePlan.rootBundleId,
          rootBundleVersion: designatedActivePlan.rootBundleVersion ?? rootBundleVersion,
          version: designatedActivePlan.version,
          activePlanVersion: designatedActivePlan.version,
          totalPlanRevisions,
          createdAt: designatedActivePlan.createdAt,
          updatedAt: designatedActivePlan.updatedAt,
        } : null,
        candidateDraftPlan: candidateDraftRow ? {
          id: candidateDraftRow.id,
          status: candidateDraftRow.status,
          executionStatus: candidateDraftRow.executionStatus,
          isDesignatedActive: false,
          summary: candidateDraftRow.planSummary,
          rootBundleId: candidateDraftRow.rootBundleId,
          rootBundleVersion: candidateDraftRow.rootBundleVersion,
          version: candidateDraftRow.version,
          createdAt: candidateDraftRow.createdAt,
          updatedAt: candidateDraftRow.updatedAt,
        } : null,
        plan: {
          id: plan.id,
          version: plan.version,
          activePlanVersion,
          jobId: plan.jobId,
          rootBundleId: plan.rootBundleId,
          rootBundleVersion: plan.rootBundleVersion ?? rootBundleVersion,
          totalPlanRevisions,
          strategyRootId: planCtx.strategyRoot?.id || planData?.governance?.strategyRoot?.rootId || planData?._provenance?.strategyRootId || null,
          isDesignatedActive: Boolean(plan.isDesignatedActive),
          status: plan.status,
          executionStatus: plan.executionStatus,
          summary: plan.planSummary,
          emergencyStopped: plan.emergencyStopped,
          createdAt: plan.createdAt,
          updatedAt: plan.updatedAt,
          snapshotIds: planCtx.snapshotIds,
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

      let decidedBy: string;
      try {
        decidedBy = resolveApprovalProvenance(req, plan);
      } catch (authErr: any) {
        if (handleOwnershipError(authErr, res)) return;
        throw authErr;
      }

      if (
        plan.status !== "DRAFT" &&
        plan.status !== "READY_FOR_REVIEW" &&
        !(plan.status === "APPROVED" && !plan.isDesignatedActive)
      ) {
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

      if (
        plan.jobId &&
        latestCompletedJob &&
        latestCompletedJob.id !== plan.jobId &&
        latestCompletedJob.completedAt &&
        plan.createdAt &&
        latestCompletedJob.completedAt.getTime() > plan.createdAt.getTime()
      ) {
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

      let parsedPlan: any = null;
      try {
        parsedPlan = typeof plan.planJson === "string" ? JSON.parse(plan.planJson) : plan.planJson;
      } catch (pErr: any) {
        // ignore parse error
      }

      const governanceBlockers: string[] = parsedPlan?.governance?.approvalBlockers || [];
      if (Array.isArray(governanceBlockers) && governanceBlockers.length > 0) {
        for (const blocker of governanceBlockers) {
          blockReasons.push({
            code: "GOVERNANCE_BLOCKED",
            message: blocker,
            detail: { blocker },
          });
        }
      }

      if (parsedPlan?.consistencyValidation && (parsedPlan.consistencyValidation.checkFailed === true || parsedPlan.consistencyValidation.valid === false || parsedPlan.consistencyValidation.blocking === true)) {
        blockReasons.push({
          code: "CONSISTENCY_VALIDATION_FAILED",
          message: parsedPlan.consistencyValidation.conflict || "Final cross-engine consistency, factual grounding, or input coverage validation did not pass.",
          detail: parsedPlan.consistencyValidation,
        });
      }

      // PLAN_OUTDATED, GOVERNANCE_BLOCKED, and CONSISTENCY_VALIDATION_FAILED (whether deterministic, semantic, or incomplete inputs)
      // are structural lifecycle and governance problems and must NOT be bypassed by forceApprove.
      const hasUnbypassableBlocker = blockReasons.some(
        b =>
          b.code === "PLAN_OUTDATED" ||
          b.code === "GOVERNANCE_BLOCKED" ||
          b.code === "CONSISTENCY_VALIDATION_FAILED"
      );
      const shouldBlock = (hasUnbypassableBlocker || blockReasons.length > 0) && (!forceApprove || hasUnbypassableBlocker);

      if (shouldBlock) {
        return res.status(409).json({
          success: false,
          blocked: true,
          warnings,
          blockReasons,
          message: hasUnbypassableBlocker
            ? "Plan approval blocked by governance or lifecycle invariants. Force-approve is not permitted."
            : "Plan approval blocked due to integrity issues. Set force=true to override (not recommended for execution drift without investigating root cause).",
        });
      }

      // atomic CAS: bind to plan.version AND status predicate in
      // a single UPDATE so a concurrent writer that flipped the row to
      // APPROVED/REJECTED between the SELECT above and this write is
      // detected (no rows updated → 409).
      try {
        if (plan.status !== "APPROVED") {
          await casUpdateStrategicPlanByVersion(
            planId,
            plan.version,
            { status: "APPROVED", updatedAt: new Date() },
            or(eq(strategicPlans.status, "DRAFT"), eq(strategicPlans.status, "READY_FOR_REVIEW")),
          );
        }
      } catch (casErr: any) {
        if (casErr?.code === "CONCURRENT_MODIFICATION") {
          return res.status(409).json({ error: "Plan was modified concurrently or already approved/rejected" });
        }
        throw casErr;
      }

      let rhythmSnapshot: Record<string, unknown> | null = null;
      try {
        const rhythm = await computeAdaptiveRhythm(plan.campaignId, plan.accountId);
        const approvedAtIso = new Date().toISOString();
        rhythmSnapshot = {
          posts_per_week: rhythm.postsPerWeek,
          reels_per_week: rhythm.reelsPerWeek,
          carousels_per_week: rhythm.carouselsPerWeek,
          videos_per_week: (rhythm as any).videosPerWeek ?? 0,
          stories_per_day: rhythm.storiesPerDay,
          approved_at: approvedAtIso,
          schema_version: "v1",
          // Preserve camelCase compatibility keys for legacy UI readers
          reelsPerWeek: rhythm.reelsPerWeek,
          carouselsPerWeek: rhythm.carouselsPerWeek,
          storiesPerDay: rhythm.storiesPerDay,
          postsPerWeek: rhythm.postsPerWeek,
          approvedAt: approvedAtIso,
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
        decidedBy,
        rhythmSnapshotJson: rhythmSnapshot ? JSON.stringify(rhythmSnapshot) : null,
      });

      // Atomically designate approved plan as active execution plan
      await designateActiveExecutionPlan({
        accountId: plan.accountId,
        campaignId: plan.campaignId,
        planId,
        reason: req.body.reason || "plan_approved",
      });

      // Plan approval promotes ELIGIBLE draft tasks based on structured operational purpose,
      // parent plan authority, and verified claim entailment.
      // Tasks advertising ungrounded claims or with unfulfilled dependencies remain in DRAFT.
      const draftTasks = await db
        .select()
        .from(executionTasks)
        .where(
          and(
            eq(executionTasks.planId, planId),
            eq(executionTasks.accountId, plan.accountId),
            eq(executionTasks.status, "DRAFT")
          )
        );

      let verifiedEvidenceTexts: string[] = [];
      try {
        const buRes = await db.execute(sql`
          SELECT business_understanding 
          FROM business_understanding_snapshots 
          WHERE campaign_id = ${plan.campaignId} 
          ORDER BY created_at DESC 
          LIMIT 1
        `);
        if (buRes.rows.length > 0) {
          const raw = (buRes.rows[0] as any).business_understanding;
          const parsedBu = typeof raw === "string" ? JSON.parse(raw) : raw;
          const facts = parsedBu?.campaignOffering?.productTruthFacts || [];
          verifiedEvidenceTexts = facts.map((f: any) => typeof f === "string" ? f : f.statement || f.fact).filter(Boolean);
        }
      } catch (err: any) {
        console.warn("[ApproveRoute] Could not load verified facts for eligibility:", err.message);
      }

      const taskEligibilityContext = {
        planStatus: "APPROVED" as const,
        isPlanDesignatedActive: true,
        verifiedEvidenceTexts,
      };

      const eligibleTaskIds: string[] = [];
      const restrictedTaskIds: string[] = [];

      for (const t of draftTasks) {
        const eligibility = evaluateTaskEligibility(t, taskEligibilityContext);
        if (eligibility.isEligible) {
          eligibleTaskIds.push(t.id);
        } else {
          restrictedTaskIds.push(t.id);
        }
      }

      if (eligibleTaskIds.length > 0) {
        await db
          .update(executionTasks)
          .set({ status: "pending", updatedAt: new Date() })
          .where(
            and(
              inArray(executionTasks.id, eligibleTaskIds),
              eq(executionTasks.accountId, plan.accountId),
              eq(executionTasks.status, "DRAFT")
            )
          );
      }
      console.log(`[ApproveRoute] Promoted ${eligibleTaskIds.length} eligible tasks to pending. Retained ${restrictedTaskIds.length} restricted tasks in DRAFT.`);

      try {
        const { WhatToDoTodayService } = await import("../what-to-do-today/service");
        await WhatToDoTodayService.getOrCreateTodayPlan(plan.campaignId, undefined, true, plan.accountId);
        console.log(`[ApproveRoute] Regenerated WhatToDoToday daily tasks for newly approved plan ${plan.id}`);
      } catch (wtdErr: any) {
        console.warn(`[ApproveRoute] Could not regenerate WhatToDoToday plan on approval:`, wtdErr?.message || wtdErr);
      }

      res.json({ success: true, status: "APPROVED", warnings, approvedRhythm: rhythmSnapshot, designatedActive: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/plans/:planId/reject", async (req: Request, res: Response) => {
    try {
      const { planId } = req.params;
      const { reason } = req.body;

      const [plan] = await db.select().from(strategicPlans).where(eq(strategicPlans.id, planId)).limit(1);
      if (!plan) return res.status(404).json({ error: "Plan not found" });

      let decidedBy: string;
      try {
        decidedBy = resolveApprovalProvenance(req, plan);
      } catch (authErr: any) {
        if (handleOwnershipError(authErr, res)) return;
        throw authErr;
      }

      try {
        await casUpdateStrategicPlanByVersion(
          planId,
          plan.version,
          { status: "REJECTED", updatedAt: new Date() },
          or(eq(strategicPlans.status, "DRAFT"), eq(strategicPlans.status, "READY_FOR_REVIEW")),
        );
      } catch (casErr: any) {
        if (casErr?.code === "CONCURRENT_MODIFICATION") {
          return res.status(409).json({ error: "Plan was modified concurrently by another request" });
        }
        throw casErr;
      }

      await db.insert(planApprovals).values({
        planId,
        accountId: plan.accountId,
        decision: "REJECTED",
        reason: reason || "Rejected by user",
        decidedBy,
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
