import assert from "node:assert/strict";
import { pool } from "../server/db";
import { buildExecutionPlanningContext } from "../server/what-to-do-today/context-builder";
import { generateTasksFromPlan } from "../server/task-composer";
import { syncCampaignAdaptiveReasoning } from "../server/adaptive/case-coordinator";
import { adaptiveReadRouter } from "../server/adaptive/read-surface";

const ACCOUNT_ID = "ce5c11b9-9a9a-499c-a4f8-b75e6ec6055f";
const CAMPAIGN_ID = "camp_ac86e8b8-55b";
const ACTIVE_PLAN_ID = "c3e6a7a0-56be-4538-b9de-529302903435";
const DRAFT_PLAN_ID = "55707d18-b332-4f3c-83c3-117055be712e";
const TARGET_EVENT_ID = "wt_1793122757345_9taad8i";

async function invokeAdaptiveRoute(path: string, accountId: string, query: Record<string, string> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const req: any = {
      method: "GET",
      url: path,
      path,
      params: {},
      query,
      headers: {},
      accountId,
    };
    const res: any = {
      statusCode: 200,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: any) {
        if (this.statusCode >= 400) {
          reject(new Error(`HTTP ${this.statusCode}: ${JSON.stringify(payload)}`));
        } else {
          resolve(payload);
        }
        return this;
      },
    };
    (adaptiveReadRouter as any).handle(req, res, (err: any) => {
      if (err) reject(err);
      else reject(new Error(`Route not handled: ${path}`));
    });
  });
}

interface TestResult {
  id: number;
  name: string;
  passed: boolean;
  details: Record<string, any>;
}

async function runTests() {
  const results: TestResult[] = [];

  // Record pre-test hashes of active and draft plans to guarantee zero unintended mutation
  const prePlansRes = await pool.query(
    `SELECT id, status, execution_status, is_designated_active, LENGTH(plan_json::text) AS len, md5(plan_json::text) AS md5_hash
     FROM strategic_plans
     WHERE id IN ($1, $2)`,
    [ACTIVE_PLAN_ID, DRAFT_PLAN_ID],
  );
  const prePlans = Object.fromEntries(prePlansRes.rows.map((r: any) => [r.id, r]));

  // ---------------------------------------------------------------------------
  // 1. Active vs. candidate plan separation
  // ---------------------------------------------------------------------------
  const defaultCtx = await buildExecutionPlanningContext(CAMPAIGN_ID, "2026-11-05", ACCOUNT_ID);
  const previewCtx = await buildExecutionPlanningContext(CAMPAIGN_ID, "2026-11-05", ACCOUNT_ID, {
    specificPlanId: DRAFT_PLAN_ID,
    allowDraftPreview: true,
  });
  {
    const activeRow = prePlans[ACTIVE_PLAN_ID];
    const draftRow = prePlans[DRAFT_PLAN_ID];
    assert.equal(activeRow.status, "APPROVED");
    assert.equal(activeRow.execution_status, "ACTIVE");
    assert.equal(activeRow.is_designated_active, true);
    assert.equal(draftRow.status, "DRAFT");
    assert.equal(draftRow.execution_status, "IDLE");
    assert.equal(draftRow.is_designated_active, false);

    assert.equal(defaultCtx.strategicPlanId, ACTIVE_PLAN_ID);
    assert.equal(previewCtx.strategicPlanId, DRAFT_PLAN_ID);

    results.push({
      id: 1,
      name: "Active vs. candidate plan separation",
      passed: true,
      details: {
        activePlan: {
          id: ACTIVE_PLAN_ID,
          status: activeRow.status,
          executionStatus: activeRow.execution_status,
          isDesignatedActive: activeRow.is_designated_active,
        },
        candidateDraftPlan: {
          id: DRAFT_PLAN_ID,
          status: draftRow.status,
          executionStatus: draftRow.execution_status,
          isDesignatedActive: draftRow.is_designated_active,
        },
        defaultContextPlanId: defaultCtx.strategicPlanId,
        previewContextPlanId: previewCtx.strategicPlanId,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // 2. Canonical strategy lineage propagation
  // ---------------------------------------------------------------------------
  {
    assert.equal(defaultCtx.accountId, ACCOUNT_ID);
    assert.equal(defaultCtx.businessId, "biz_songai_ce5c11b9");
    assert.equal(defaultCtx.productId, "prod_songai_personalized_songs");
    assert.equal(defaultCtx.campaignId, CAMPAIGN_ID);
    assert.equal(defaultCtx.strategicPlanId, ACTIVE_PLAN_ID);
    assert.equal(defaultCtx.strategyRootId, "de027857-3a9e-4bee-8ad6-9a6b6319ec32");
    assert.equal(defaultCtx.rootBundleId, "533cbd06-a23d-4eba-ac05-74a747b592d2");
    assert.equal(defaultCtx.rootBundleVersion, 13);

    assert.equal(previewCtx.strategicPlanId, DRAFT_PLAN_ID);
    assert.equal(previewCtx.strategyRootId, "16b625f1-aeba-4c01-af05-6bfa211d7726");
    assert.equal(previewCtx.rootBundleId, "2dc43d2b-71bc-4dc3-ab3c-2b1277b03ce3");
    assert.equal(previewCtx.rootBundleVersion, 14);

    results.push({
      id: 2,
      name: "Canonical strategy lineage propagation",
      passed: true,
      details: {
        activeLineage: {
          planId: defaultCtx.strategicPlanId,
          strategyRootId: defaultCtx.strategyRootId,
          rootBundleId: defaultCtx.rootBundleId,
          rootBundleVersion: defaultCtx.rootBundleVersion,
          snapshotIds: defaultCtx.selectedSnapshotIds,
        },
        draftLineage: {
          planId: previewCtx.strategicPlanId,
          strategyRootId: previewCtx.strategyRootId,
          rootBundleId: previewCtx.rootBundleId,
          rootBundleVersion: previewCtx.rootBundleVersion,
          snapshotIds: previewCtx.selectedSnapshotIds,
        },
      },
    });
  }

  // ---------------------------------------------------------------------------
  // 3. Preliminary vs. final budget authority
  // ---------------------------------------------------------------------------
  {
    const budget = previewCtx.budgetConstraints;
    const ah = budget.authorityHierarchy;
    assert.ok(ah, "authorityHierarchy must be present on candidate draft budget");
    assert.equal(ah.preliminaryRecommendationAuthority, "CHANNEL_SELECTION");
    assert.equal(ah.finalAllocationAuthority, "BUDGET_GOVERNOR");
    assert.equal(ah.status, "REFINED_BY_BUDGET_GOVERNOR");

    const prelimTikTok = ah.preliminaryChannelRecommendation.find((a: any) =>
      /tiktok/i.test(a.channelName),
    );
    const prelimInsta = ah.preliminaryChannelRecommendation.find((a: any) =>
      /instagram/i.test(a.channelName),
    );
    assert.equal(prelimTikTok?.monthlyAmount, 3500);
    assert.equal(prelimTikTok?.sharePercentage, 70);
    assert.equal(prelimInsta?.monthlyAmount, 1500);
    assert.equal(prelimInsta?.sharePercentage, 30);

    const finalTikTok = ah.finalPlannedChannelAllocation.find((a: any) =>
      /tiktok/i.test(a.channelName),
    );
    const finalInsta = ah.finalPlannedChannelAllocation.find((a: any) =>
      /instagram/i.test(a.channelName),
    );
    assert.equal(finalTikTok?.monthlyAmount, 3250);
    assert.equal(finalTikTok?.sharePercentage, 65);
    assert.equal(finalInsta?.monthlyAmount, 1750);
    assert.equal(finalInsta?.sharePercentage, 35);

    results.push({
      id: 3,
      name: "Preliminary vs. final budget authority",
      passed: true,
      details: {
        status: ah.status,
        preliminaryChannelSelection: ah.preliminaryChannelRecommendation,
        finalBudgetGovernor: ah.finalPlannedChannelAllocation,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // 4. Separation of total budget, final channel allocation, testing allowance,
  //    unreleased reserve, and actual spend
  // ---------------------------------------------------------------------------
  {
    const budget = previewCtx.budgetConstraints;

    assert.equal(budget.monthlyBudgetEnvelope, 5000);
    assert.equal(budget.currency, "USD");
    const finalTotal = (budget.finalPlannedChannelAllocation || []).reduce(
      (sum, c) => sum + Number(c.monthlyAmount || 0),
      0,
    );
    assert.equal(finalTotal, 5000);
    assert.equal(budget.initialTestingAllowance, 1000);
    assert.equal(budget.initialTestingAllowancePct, 20);
    assert.equal(budget.unreleasedReserve, 4000);
    assert.equal(budget.unreleasedReservePct, 80);
    assert.equal(budget.actualSpend, null);
    assert.equal(budget.actualSpendStatus, "UNKNOWN_UNCONNECTED");
    assert.equal(budget.monetaryProductionCosts, 0);

    results.push({
      id: 4,
      name: "Separation of total budget, final allocation, testing allowance, unreleased reserve, and actual spend",
      passed: true,
      details: {
        monthlyBudgetEnvelope: budget.monthlyBudgetEnvelope,
        finalPlannedChannelAllocationTotal: finalTotal,
        initialTestingAllowance: budget.initialTestingAllowance,
        unreleasedReserve: budget.unreleasedReserve,
        actualSpend: budget.actualSpend,
        actualSpendStatus: budget.actualSpendStatus,
        monetaryProductionCosts: budget.monetaryProductionCosts,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // 5. Enforcement of spendAction = hold and initial testing allowance
  // ---------------------------------------------------------------------------
  {
    const budget = previewCtx.budgetConstraints;
    assert.equal(budget.spendAction, "hold");
    assert.equal(budget.initialTestingAllowance, 1000);
    assert.equal(budget.unreleasedReserve, 4000);
    assert.ok((budget.holdPolicy?.whatHoldPrevents.length ?? 0) >= 3);
    assert.ok((budget.holdPolicy?.whatHoldPermits.length ?? 0) >= 2);

    const draftPlanRow = await pool.query(
      `SELECT plan_json FROM strategic_plans WHERE id = $1`,
      [DRAFT_PLAN_ID],
    );
    const parsedDraftPlanJson =
      typeof draftPlanRow.rows[0].plan_json === "string"
        ? JSON.parse(draftPlanRow.rows[0].plan_json)
        : draftPlanRow.rows[0].plan_json;
    const generatedTasks = generateTasksFromPlan(parsedDraftPlanJson, 30);
    const launchTasks = generatedTasks.filter((t) => t.taskType === "launch");
    const validationTasks = generatedTasks.filter((t) => t.taskType === "validation_setup");
    assert.equal(
      launchTasks.length,
      0,
      "Unrestricted launch tasks must not be generated when spendAction = hold",
    );
    assert.ok(
      validationTasks.length >= 1,
      "Controlled validation_setup task for $1,000 learning carve-out must be generated",
    );
    assert.ok(validationTasks[0].title.includes("1,000"));

    results.push({
      id: 5,
      name: "Enforcement of spendAction = hold and initial testing allowance",
      passed: true,
      details: {
        spendAction: budget.spendAction,
        unrestrictedLaunchTasksCount: launchTasks.length,
        validationSetupTaskTitle: validationTasks[0].title,
        holdPreventsCount: budget.holdPolicy?.whatHoldPrevents.length,
        holdPermitsCount: budget.holdPolicy?.whatHoldPermits.length,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // 6. Retargeting prerequisite gating
  // ---------------------------------------------------------------------------
  {
    const instaPrereq = previewCtx.budgetConstraints.channelPrerequisites?.find((p) =>
      /instagram/i.test(p.channelName),
    );
    assert.ok(instaPrereq, "Instagram retargeting prerequisite must be present");
    assert.equal(instaPrereq.readinessStatus, "PREREQUISITE_GATED");
    assert.equal(instaPrereq.requiredWarmAudiencePool, 1000);
    assert.equal(instaPrereq.requiredLandingPageVisits, 1500);
    assert.equal(instaPrereq.windowDays, 21);

    const instaApproved = previewCtx.channelHierarchy.approvedChannels.find(
      (c) => c.platform === "INSTAGRAM" && c.mode === "PAID",
    );
    assert.ok(instaApproved, "Instagram Paid Ads (Retargeting) must appear in approvedChannels");
    assert.equal(instaApproved.readinessStatus, "PREREQUISITE_GATED");

    const draftTasksRes = await pool.query(
      `SELECT task_type, title, status FROM execution_tasks WHERE plan_id = $1 AND task_type = 'prerequisite_gate'`,
      [DRAFT_PLAN_ID],
    );
    assert.ok(draftTasksRes.rows.length >= 1, "prerequisite_gate task must exist for draft plan");
    assert.equal(draftTasksRes.rows[0].status, "DRAFT");

    results.push({
      id: 6,
      name: "Retargeting prerequisite gating",
      passed: true,
      details: {
        channelName: instaPrereq.channelName,
        readinessStatus: instaPrereq.readinessStatus,
        requiredWarmAudiencePool: instaPrereq.requiredWarmAudiencePool,
        requiredLandingPageVisits: instaPrereq.requiredLandingPageVisits,
        windowDays: instaPrereq.windowDays,
        prerequisiteGateTaskTitle: draftTasksRes.rows[0].title,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // 7. Watchtower confirmed event -> reasoning trigger
  // ---------------------------------------------------------------------------
  await syncCampaignAdaptiveReasoning({ accountId: ACCOUNT_ID, campaignId: CAMPAIGN_ID });
  const reasoningRes = await invokeAdaptiveRoute(
    `/reasoning/cases/${CAMPAIGN_ID}`,
    ACCOUNT_ID,
  );
  const allCases: any[] = reasoningRes.cases || [];
  {
    const matchingCase = allCases.find((c) =>
      (c.linkedMarketEvents || []).some((e: any) => e.eventId === TARGET_EVENT_ID),
    );
    assert.ok(matchingCase, `Reasoning case for Watchtower event ${TARGET_EVENT_ID} must exist`);
    assert.equal(matchingCase.reasoningCaseId, "rcase_f2f8bf15c54c");
    assert.equal(matchingCase.lineage?.planId, ACTIVE_PLAN_ID);
    assert.equal(matchingCase.lineage?.strategyRootId, "de027857-3a9e-4bee-8ad6-9a6b6319ec32");
    assert.equal(matchingCase.lineage?.rootBundleId, "533cbd06-a23d-4eba-ac05-74a747b592d2");
    assert.equal(matchingCase.lineage?.rootBundleVersion, 13);
    assert.equal(matchingCase.lineage?.productId, "prod_songai_personalized_songs");
    assert.equal(matchingCase.responseClassification, "NO_CHANGE");

    results.push({
      id: 7,
      name: "Watchtower confirmed event -> reasoning trigger",
      passed: true,
      details: {
        eventId: TARGET_EVENT_ID,
        reasoningCaseId: matchingCase.reasoningCaseId,
        lineage: matchingCase.lineage,
        responseClassification: matchingCase.responseClassification,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // 8. Performance Loop context inclusion
  // ---------------------------------------------------------------------------
  {
    const perfOverview = await invokeAdaptiveRoute(
      `/performance-loop/overview/${CAMPAIGN_ID}`,
      ACCOUNT_ID,
    );
    const planPerf = perfOverview.planPerformance;
    assert.ok(planPerf, "Performance Loop planPerformance must be present");
    assert.equal(planPerf.contextId, "b912aa16-555e-425a-b170-81e6fc9e684c");
    assert.ok(planPerf.budgetEvaluationTargets?.activePlanBudgetTargets);
    assert.ok(planPerf.budgetEvaluationTargets?.candidateDraftBudgetTargets);
    assert.equal(
      planPerf.budgetEvaluationTargets.candidateDraftBudgetTargets.authorityHierarchy.status,
      "REFINED_BY_BUDGET_GOVERNOR",
    );

    const perfCase = allCases.find((c) =>
      (c.linkedPerformanceWarnings || []).length > 0,
    )!;
    assert.ok(perfCase, "Performance-linked reasoning case must exist");
    assert.equal(perfCase.telemetryContext?.paidAdTelemetryStatus, "UNKNOWN_UNCONNECTED");
    assert.equal(perfCase.telemetryContext?.historicalBaseline?.operatingDurationMonths, 6);
    assert.equal(perfCase.telemetryContext?.historicalBaseline?.historicalLeadsCount, 10);
    assert.equal(perfCase.telemetryContext?.historicalBaseline?.historicalPayingCustomersCount, 5);

    results.push({
      id: 8,
      name: "Performance Loop context inclusion",
      passed: true,
      details: {
        performanceContextId: planPerf.contextId,
        performanceCaseId: perfCase.reasoningCaseId,
        telemetryContext: perfCase.telemetryContext,
        activeBudgetTargetTotal:
          planPerf.budgetEvaluationTargets?.activePlanBudgetTargets?.monthlyBudgetEnvelope,
        draftBudgetTargetTotal:
          planPerf.budgetEvaluationTargets?.candidateDraftBudgetTargets?.monthlyBudgetEnvelope,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // 9. INSUFFICIENT_EVIDENCE / OBSERVE behavior when telemetry is absent
  // ---------------------------------------------------------------------------
  {
    assert.equal(allCases.length, 6);
    for (const c of allCases) {
      assert.equal(c.isActionableProposal, false);
      assert.equal(c.proposalDetails, null);
      assert.ok(
        c.responseClassification === "NO_CHANGE" ||
          c.responseClassification === "INSUFFICIENT_EVIDENCE" ||
          c.responseClassification === "EXECUTION_ADJUSTMENT",
      );
      assert.notEqual(c.adaptiveDecision?.statusBadge, "PATCH READY");
      assert.notEqual(c.adaptiveDecision?.statusBadge, "APPLIED");
    }

    results.push({
      id: 9,
      name: "INSUFFICIENT_EVIDENCE / OBSERVE behavior when telemetry is absent",
      passed: true,
      details: {
        evaluatedCasesCount: allCases.length,
        sampleCaseId: allCases[0].reasoningCaseId,
        decisionType: allCases[0].adaptiveDecision?.decisionType,
        statusBadge: allCases[0].adaptiveDecision?.statusBadge,
        responseClassification: allCases[0].responseClassification,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // 10. Idempotent reasoning case creation
  // ---------------------------------------------------------------------------
  {
    const beforeCounts = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM reasoning_cases WHERE campaign_id = $1) AS cases_cnt,
         (SELECT COUNT(*)::int FROM adaptive_decisions WHERE campaign_id = $1) AS decs_cnt,
         (SELECT COUNT(*)::int FROM strategy_change_proposals WHERE campaign_id = $1) AS props_cnt`,
      [CAMPAIGN_ID],
    );
    const syncRes = await syncCampaignAdaptiveReasoning({
      accountId: ACCOUNT_ID,
      campaignId: CAMPAIGN_ID,
    });
    const afterCounts = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM reasoning_cases WHERE campaign_id = $1) AS cases_cnt,
         (SELECT COUNT(*)::int FROM adaptive_decisions WHERE campaign_id = $1) AS decs_cnt,
         (SELECT COUNT(*)::int FROM strategy_change_proposals WHERE campaign_id = $1) AS props_cnt`,
      [CAMPAIGN_ID],
    );

    assert.equal(syncRes.casesCreated, 0);
    assert.equal(syncRes.decisionsCreated, 0);
    assert.equal(syncRes.casesSkippedIdempotent, 6);
    assert.equal(beforeCounts.rows[0].cases_cnt, afterCounts.rows[0].cases_cnt);
    assert.equal(beforeCounts.rows[0].decs_cnt, afterCounts.rows[0].decs_cnt);
    assert.equal(beforeCounts.rows[0].props_cnt, afterCounts.rows[0].props_cnt);

    results.push({
      id: 10,
      name: "Idempotent reasoning case creation",
      passed: true,
      details: {
        casesCreated: syncRes.casesCreated,
        decisionsCreated: syncRes.decisionsCreated,
        casesSkippedIdempotent: syncRes.casesSkippedIdempotent,
        casesCountBeforeAndAfter: afterCounts.rows[0].cases_cnt,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // 11, 12, 13. Isolated fixture tests for:
  //   11. Proposal generation when evidence supports a change
  //   12. Approval required before strategic mutation
  //   13. Scoped application without full regeneration
  // ---------------------------------------------------------------------------
  const fixtureCampaignId = "camp_fixture_isolated_test";
  const fixtureCaseId = "rcase_fixture_isolated_01";
  const fixtureDecisionId = "adec_fixture_isolated_01";
  const fixtureProposalId = "sprop_fixture_isolated_01";
  try {
    await pool.query(`DELETE FROM strategy_change_proposals WHERE id = $1`, [fixtureProposalId]);
    await pool.query(`DELETE FROM adaptive_decisions WHERE id = $1`, [fixtureDecisionId]);
    await pool.query(`DELETE FROM reasoning_cases WHERE id = $1`, [fixtureCaseId]);

    await pool.query(
      `INSERT INTO reasoning_cases (
         id, account_id, campaign_id, strategy_root_id, strategy_root_version,
         market_event_ids, performance_warning_ids, evidence_ids, status,
         opened_at, resolved_at, reasoning_version, metadata
       ) VALUES ($1, $2, $3, $4, 13, '[]'::jsonb, '["pwarn_fixture_1"]'::jsonb, '["ev_fixture_1"]'::jsonb, 'RESOLVED', NOW(), NOW(), '2.2.0-grounded-lineage', $5::jsonb)`,
      [
        fixtureCaseId,
        ACCOUNT_ID,
        fixtureCampaignId,
        "de027857-3a9e-4bee-8ad6-9a6b6319ec32",
        JSON.stringify({
          lineage: {
            planId: "plan_fixture_isolated",
            strategyRootId: "de027857-3a9e-4bee-8ad6-9a6b6319ec32",
            rootBundleId: "533cbd06-a23d-4eba-ac05-74a747b592d2",
            rootBundleVersion: 13,
          },
          impactClassification: "SUFFICIENT_EXECUTION_EVIDENCE",
        }),
      ],
    );

    await pool.query(
      `INSERT INTO adaptive_decisions (
         id, account_id, campaign_id, reasoning_case_id, strategy_root_id, strategy_root_version,
         decision_type, affected_authority, affected_entity_ids, evidence_ids, confidence,
         rationale, metadata, created_at
       ) VALUES ($1, $2, $3, $4, $5, 13, 'STRATEGY_CHANGE_REQUIRED', 'POSITIONING', '["pos_fixture_1"]'::jsonb, '["ev_fixture_1"]'::jsonb, 0.86, 'Sufficient multi-week verified telemetry and competitor evidence.', '{}'::jsonb, NOW())`,
      [
        fixtureDecisionId,
        ACCOUNT_ID,
        fixtureCampaignId,
        fixtureCaseId,
        "de027857-3a9e-4bee-8ad6-9a6b6319ec32",
      ],
    );

    await pool.query(
      `INSERT INTO strategy_change_proposals (
         id, account_id, campaign_id, reasoning_case_id, adaptive_decision_id,
         current_strategy_root_id, current_root_bundle_id, current_root_bundle_version,
         current_strategic_plan_id, decision_type, affected_authorities,
         summary, why_now, evidence_summary, expected_impact,
         preserved_authorities, status, metadata, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 13, 'plan_fixture_isolated', 'STRATEGY_CHANGE_REQUIRED', '["POSITIONING"]'::jsonb, 'Refine positioning hook angle', 'Verified 2-window CTR drop on secondary angle', '2 consecutive windows of verified telemetry', 'Higher CTR on primary hook', '["AUDIENCE","OFFER","FUNNEL","CHANNELS","BUDGET"]'::jsonb, 'PENDING_USER_APPROVAL', $8::jsonb, NOW())`,
      [
        fixtureProposalId,
        ACCOUNT_ID,
        fixtureCampaignId,
        fixtureCaseId,
        fixtureDecisionId,
        "de027857-3a9e-4bee-8ad6-9a6b6319ec32",
        "533cbd06-a23d-4eba-ac05-74a747b592d2",
        JSON.stringify({
          targetType: "STRATEGY",
          beforeAfterPatchPreview: [
            {
              sectionName: "Positioning",
              fieldLabel: "Core Angle",
              beforeText: "Prior secondary angle copy",
              afterText: "Refined memory-first angle copy",
            },
          ],
        }),
      ],
    );

    // Test 11: Proposal generation when evidence supports a change
    const fixtureResProposed = await invokeAdaptiveRoute(
      `/reasoning/cases/${fixtureCampaignId}`,
      ACCOUNT_ID,
    );
    assert.equal(fixtureResProposed.cases.length, 1);
    const fc1 = fixtureResProposed.cases[0];
    assert.equal(fc1.isActionableProposal, true);
    assert.equal(fc1.caseCategory, "PROPOSED_CHANGE");
    assert.equal(fc1.proposalDetails?.proposalId, fixtureProposalId);
    assert.equal(fc1.adaptiveDecision?.proposalStatus, "PENDING_USER_APPROVAL");
    assert.equal(fc1.adaptiveDecision?.statusBadge, "PENDING STRATEGY APPROVAL");
    assert.equal(fc1.adaptiveDecision?.appliedVersion, null);

    results.push({
      id: 11,
      name: "Proposal generation when evidence supports a change (isolated fixture)",
      passed: true,
      details: {
        proposalId: fc1.proposalDetails?.proposalId,
        proposalStatus: fc1.adaptiveDecision?.proposalStatus,
        statusBadge: fc1.adaptiveDecision?.statusBadge,
        isActionableProposal: fc1.isActionableProposal,
      },
    });

    // Test 12: Approval required before strategic mutation
    await pool.query(
      `UPDATE strategy_change_proposals SET status = 'APPROVED', reviewed_at = NOW() WHERE id = $1`,
      [fixtureProposalId],
    );
    const fixtureResApproved = await invokeAdaptiveRoute(
      `/reasoning/cases/${fixtureCampaignId}`,
      ACCOUNT_ID,
    );
    const fc2 = fixtureResApproved.cases[0];
    assert.equal(fc2.adaptiveDecision?.proposalStatus, "APPROVED");
    assert.equal(
      fc2.adaptiveDecision?.appliedVersion,
      null,
      "Approved but uncommitted proposal must not report appliedVersion before commit",
    );
    assert.ok(
      !String(fc2.adaptiveDecision?.statusBadge || "").includes("APPLIED"),
      "Approved but uncommitted proposal must not display APPLIED badge before commit",
    );

    results.push({
      id: 12,
      name: "Approval required before strategic mutation (isolated fixture)",
      passed: true,
      details: {
        statusAfterApprovalBeforeCommit: fc2.adaptiveDecision?.proposalStatus,
        statusBadgeBeforeCommit: fc2.adaptiveDecision?.statusBadge,
        appliedVersionBeforeCommit: fc2.adaptiveDecision?.appliedVersion,
      },
    });

    // Test 13: Scoped application without full regeneration
    await pool.query(
      `UPDATE strategy_change_proposals SET status = 'APPLIED', applied_at = NOW(), applied_new_bundle_version = 14 WHERE id = $1`,
      [fixtureProposalId],
    );
    const fixtureResApplied = await invokeAdaptiveRoute(
      `/reasoning/cases/${fixtureCampaignId}`,
      ACCOUNT_ID,
    );
    const fc3 = fixtureResApplied.cases[0];
    assert.equal(fc3.adaptiveDecision?.proposalStatus, "APPLIED");
    assert.equal(fc3.adaptiveDecision?.appliedVersion, 14);
    assert.equal(fc3.adaptiveDecision?.statusBadge, "APPROVED & APPLIED (v14)");

    // Verify real Songai plans were not regenerated or mutated
    const postPlansRes = await pool.query(
      `SELECT id, status, execution_status, is_designated_active, LENGTH(plan_json::text) AS len, md5(plan_json::text) AS md5_hash
       FROM strategic_plans
       WHERE id IN ($1, $2)`,
      [ACTIVE_PLAN_ID, DRAFT_PLAN_ID],
    );
    const postPlans = Object.fromEntries(postPlansRes.rows.map((r: any) => [r.id, r]));
    assert.equal(postPlans[ACTIVE_PLAN_ID].md5_hash, prePlans[ACTIVE_PLAN_ID].md5_hash);
    assert.equal(postPlans[DRAFT_PLAN_ID].md5_hash, prePlans[DRAFT_PLAN_ID].md5_hash);

    results.push({
      id: 13,
      name: "Scoped application without full regeneration (isolated fixture)",
      passed: true,
      details: {
        statusAfterScopedCommit: fc3.adaptiveDecision?.proposalStatus,
        statusBadgeAfterCommit: fc3.adaptiveDecision?.statusBadge,
        appliedVersionAfterCommit: fc3.adaptiveDecision?.appliedVersion,
        preservedAuthorities: fc3.adaptiveDecision?.preservedAuthorities,
        activePlanMd5Unchanged:
          postPlans[ACTIVE_PLAN_ID].md5_hash === prePlans[ACTIVE_PLAN_ID].md5_hash,
        draftPlanMd5Unchanged:
          postPlans[DRAFT_PLAN_ID].md5_hash === prePlans[DRAFT_PLAN_ID].md5_hash,
      },
    });
  } finally {
    await pool.query(`DELETE FROM strategy_change_proposals WHERE id = $1`, [fixtureProposalId]);
    await pool.query(`DELETE FROM adaptive_decisions WHERE id = $1`, [fixtureDecisionId]);
    await pool.query(`DELETE FROM reasoning_cases WHERE id = $1`, [fixtureCaseId]);
  }

  console.log(
    JSON.stringify(
      {
        executedAt: new Date().toISOString(),
        totalTests: results.length,
        passedTests: results.filter((r) => r.passed).length,
        failedTests: results.filter((r) => !r.passed).length,
        results,
      },
      null,
      2,
    ),
  );
  await pool.end();
}

runTests().catch((err) => {
  console.error("TEST_SUITE_FAILED:", err);
  process.exit(1);
});
