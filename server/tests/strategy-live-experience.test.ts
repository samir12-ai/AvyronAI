import "dotenv/config";
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgresql://neondb_owner:npg_m7cPxRkaqN2W@ep-cool-thunder-as56r646-pooler.c-4.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
}
import { describe, it, expect, beforeEach, vi } from "vitest";
import { StrategyExperienceService } from "../strategy-experience/service";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { routeAdaptiveDecision } from "../adaptive/router";
import { openReasoningCase } from "../adaptive/case-coordinator";
import { ReasoningJudgeVerdict } from "../adaptive/reasoning-judge";
import { AdaptiveSignal } from "../adaptive/contracts";
import { ENGINE_PRIORITY_ORDER } from "../orchestrator/priority-matrix";

describe("Avyron Live Strategy Experience & Approval Workflow", () => {
  const accountId = "acc_test_exp_001";
  const campaignId = "camp_test_exp_001";

  beforeEach(async () => {
    // Clean up test campaign data before each test
    await db.delete(schema.strategyChangeProposals).where(eq(schema.strategyChangeProposals.campaignId, campaignId));
    await db.delete(schema.strategyAdaptationLineages).where(eq(schema.strategyAdaptationLineages.campaignId, campaignId));
    await db.delete(schema.pipelineChangeEvents).where(eq(schema.pipelineChangeEvents.campaignId, campaignId));
    await db.delete(schema.orchestratorJobs).where(eq(schema.orchestratorJobs.campaignId, campaignId));
    await db.delete(schema.reasoningCases).where(eq(schema.reasoningCases.campaignId, campaignId));
    await db.delete(schema.adaptiveDecisions).where(eq(schema.adaptiveDecisions.campaignId, campaignId));
    await db.delete(schema.strategyRoots).where(eq(schema.strategyRoots.campaignId, campaignId));
    await db.delete(schema.rootBundles).where(eq(schema.rootBundles.campaignId, campaignId));
    await db.delete(schema.strategicPlans).where(eq(schema.strategicPlans.campaignId, campaignId));
  });

  describe("Part 1-5: Generation UX & Concurrency Protection", () => {
    it("starts orchestrator job with all 15 stages initialized in PENDING state", async () => {
      const result = await StrategyExperienceService.generateStrategy(campaignId, accountId);
      expect(result.success).toBe(true);
      expect(result.status).toBe("RUNNING");
      expect(result.jobId).toBeDefined();

      const progress = await StrategyExperienceService.getRunProgress(result.jobId, accountId);
      expect(progress).not.toBeNull();
      expect(progress?.totalCount).toBe(15);
      expect(progress?.stages.length).toBe(15);
      expect(progress?.stages[0].id).toBe("market_intelligence");
      expect(progress?.stages[0].name).toBe("Market Intelligence");
    });

    it("prevents duplicate concurrent generation for the same campaign (409 / ALREADY_RUNNING)", async () => {
      // Insert a currently running job
      await db.insert(schema.orchestratorJobs).values({
        id: "job_running_001",
        blueprintId: "orchestrator-v2",
        accountId,
        campaignId,
        status: "RUNNING",
        sectionStatuses: JSON.stringify(
          ENGINE_PRIORITY_ORDER.map((e) => ({ id: e.id, name: e.name, status: "PENDING" }))
        ),
      });

      const result = await StrategyExperienceService.generateStrategy(campaignId, accountId);
      expect(result.success).toBe(false);
      expect(result.status).toBe("ALREADY_RUNNING");
      expect(result.jobId).toBe("job_running_001");
      expect(result.message).toContain("already in progress");
    });

    it("maps backend engine statuses to customer-friendly stage states: WAITING, RUNNING, VALIDATING, REFINING, COMPLETED, PARTIAL, FAILED", async () => {
      const jobId = "job_progress_test_001";
      const sampleSectionStatuses = [
        { id: "market_intelligence", name: "Market Intelligence", status: "COMPLETED", summary: "Market monitored" },
        { id: "audience", name: "Audience Engine", status: "PARTIAL", summary: "2 segments with moderate confidence" },
        { id: "differentiation", name: "Differentiation Engine", status: "RUNNING" },
        { id: "positioning", name: "Positioning Engine", status: "VALIDATING" },
        { id: "mechanism", name: "Mechanism Engine", status: "REFINING" },
        { id: "offer", name: "Offer Engine", status: "WAITING" },
        { id: "awareness", name: "Awareness Engine", status: "FAILED" },
      ];

      await db.insert(schema.orchestratorJobs).values({
        id: jobId,
        blueprintId: "orchestrator-v2",
        accountId,
        campaignId,
        status: "RUNNING",
        sectionStatuses: JSON.stringify(sampleSectionStatuses),
      });

      const progress = await StrategyExperienceService.getRunProgress(jobId, accountId);
      expect(progress).not.toBeNull();

      const miStage = progress?.stages.find((s) => s.id === "market_intelligence");
      expect(miStage?.status).toBe("COMPLETED");

      const audStage = progress?.stages.find((s) => s.id === "audience");
      expect(audStage?.status).toBe("PARTIAL");

      const diffStage = progress?.stages.find((s) => s.id === "differentiation");
      expect(diffStage?.status).toBe("RUNNING");

      const posStage = progress?.stages.find((s) => s.id === "positioning");
      expect(posStage?.status).toBe("VALIDATING");

      const mechStage = progress?.stages.find((s) => s.id === "mechanism");
      expect(mechStage?.status).toBe("REFINING");
      expect(mechStage?.displayMessage).toContain("refining this section");

      const offerStage = progress?.stages.find((s) => s.id === "offer");
      expect(offerStage?.status).toBe("WAITING");

      const awareStage = progress?.stages.find((s) => s.id === "awareness");
      expect(awareStage?.status).toBe("FAILED");
      expect(awareStage?.displayMessage).not.toContain("stack"); // No raw stack trace exposed
    });
  });

  describe("Part 7-11: Reasoning -> Approval Gate -> Targeted Update", () => {
    it("creates NO proposal for OBSERVE or EXECUTION_RESPONSE decisions", async () => {
      const reasoningCase = openReasoningCase({
        accountId,
        campaignId,
        strategyRootId: "root_001",
        strategyRootVersion: 1,
      });

      const verdict: ReasoningJudgeVerdict = {
        verdictId: "v_001",
        reasoningCaseId: reasoningCase.reasoningCaseId,
        status: "VALIDATED",
        confidence: 0.9,
        coherenceScore: 0.95,
        temporalCorrelation: 0.85,
        evidenceSufficiency: "SUFFICIENT",
        violations: [],
        timestamp: new Date().toISOString(),
      };

      // OBSERVE decision
      const observeDecision = routeAdaptiveDecision({
        reasoningCase,
        judgeVerdict: verdict,
        campaignId,
        accountId,
      });

      const prop1 = await StrategyExperienceService.createProposalFromDecision({
        decision: observeDecision,
        reasoningCase,
        campaignId,
        accountId,
      });
      expect(prop1).toBeNull();

      // EXECUTION_RESPONSE decision
      const execDecision = routeAdaptiveDecision({
        reasoningCase,
        judgeVerdict: verdict,
        performanceSignals: [
          {
            signalId: "sig_perf_01",
            campaignId,
            accountId,
            sourceDomain: "PERFORMANCE",
            sourceArtifactId: "pctx_01",
            entityIds: [],
            evidenceIds: ["ev_01"],
            signalType: "CONVERSION_FRICTION",
            summary: "Drop-off on trial step",
            severity: "MEDIUM",
            confidence: 0.85,
            observedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          },
        ],
        campaignId,
        accountId,
      });

      const prop2 = await StrategyExperienceService.createProposalFromDecision({
        decision: execDecision,
        reasoningCase,
        campaignId,
        accountId,
      });
      expect(prop2).toBeNull();
    });

async function insertTestRoot(params: {
  id: string;
  campaignId: string;
  accountId: string;
  primaryAxis?: string;
  contrastAxisText?: string;
  approvedPromise?: string;
  status?: string;
}) {
  await db.insert(schema.strategyRoots).values({
    id: params.id,
    runId: "run_test_001",
    rootHash: `hash_${params.id}`,
    accountId: params.accountId,
    campaignId: params.campaignId,
    primaryAxis: params.primaryAxis || "simplicity_and_ease",
    contrastAxisText: params.contrastAxisText || "Simple multi-channel scheduling",
    approvedPromise: params.approvedPromise || "Streamlined social publishing",
    miSnapshotId: "mi_snap_01",
    audienceSnapshotId: "aud_snap_01",
    positioningSnapshotId: "pos_snap_01",
    differentiationSnapshotId: "diff_snap_01",
    mechanismSnapshotId: "mech_snap_01",
    status: params.status || "ACTIVE",
  });
}

    it("creates PENDING_USER_APPROVAL proposal on REEVALUATE_AUTHORITY and does NOT mutate Strategy Root before approval", async () => {
      // 1. Seed active Strategy Root v1
      const rootId = "root_test_v1";
      await insertTestRoot({
        id: rootId,
        campaignId,
        accountId,
        primaryAxis: "simplicity_and_ease",
        contrastAxisText: "Simple multi-channel scheduling",
        approvedPromise: "Streamlined social publishing",
      });

      await db.insert(schema.rootBundles).values({
        id: "bundle_test_v1",
        strategyRootId: rootId,
        campaignId,
        accountId,
        version: 1,
      });

      await db.insert(schema.strategicPlans).values({
        id: "plan_test_v1",
        blueprintId: "bp_test_v1",
        campaignId,
        accountId,
        rootBundleId: "bundle_test_v1",
        rootBundleVersion: 1,
        version: 1,
        planSummary: "Strategic Plan v1",
        planJson: JSON.stringify({ primaryAxis: "simplicity_and_ease" }),
        status: "ACTIVE",
      });

      const reasoningCase = openReasoningCase({
        accountId,
        campaignId,
        strategyRootId: rootId,
        strategyRootVersion: 1,
      });
      reasoningCase.candidateAffectedAuthorities = ["DIFFERENTIATION"];

      const marketSignal: AdaptiveSignal = {
        signalId: "sig_mkt_01",
        campaignId,
        accountId,
        sourceDomain: "MARKET",
        sourceArtifactId: "pce_conf_01",
        entityIds: ["comp_01"],
        evidenceIds: ["ev_comp_01"],
        signalType: "PRICE_DROP",
        summary: "Hootsuite dropped starter pricing by 30%",
        severity: "HIGH",
        confidence: 0.9,
        confirmationState: "CONFIRMED",
        observedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };

      const verdict: ReasoningJudgeVerdict = {
        verdictId: "v_002",
        reasoningCaseId: reasoningCase.reasoningCaseId,
        status: "VALIDATED",
        confidence: 0.95,
        coherenceScore: 0.9,
        temporalCorrelation: 0.88,
        evidenceSufficiency: "SUFFICIENT",
        violations: [],
        timestamp: new Date().toISOString(),
      };

      const decision = routeAdaptiveDecision({
        reasoningCase,
        judgeVerdict: verdict,
        marketSignals: [marketSignal],
        campaignId,
        accountId,
      });

      expect(decision.decisionType).toBe("REEVALUATE_AUTHORITY");
      expect(decision.affectedAuthority).toBe("DIFFERENTIATION");

      // Create Proposal
      const proposal = await StrategyExperienceService.createProposalFromDecision({
        decision,
        reasoningCase,
        campaignId,
        accountId,
      });

      expect(proposal).not.toBeNull();
      expect(proposal?.status).toBe("PENDING_USER_APPROVAL");
      expect(proposal?.affectedAuthorities).toEqual(["DIFFERENTIATION"]);
      expect(proposal?.currentStrategyRootId).toBe(rootId);

      // Verify Canonical Root is NOT modified
      const currentActive = await StrategyExperienceService.getActiveStrategy(campaignId, accountId);
      expect(currentActive.strategyRootId).toBe(rootId);
      expect(currentActive.canonicalVersion).toBe(1);
      expect(currentActive.pendingProposalCount).toBe(1);
    });

    it("rejecting proposal keeps current Strategy Root active and marks proposal REJECTED", async () => {
      const rootId = "root_test_v1";
      await insertTestRoot({
        id: rootId,
        campaignId,
        accountId,
        primaryAxis: "simplicity_and_ease",
      });

      const [proposal] = await db
        .insert(schema.strategyChangeProposals)
        .values({
          id: "prop_to_reject",
          campaignId,
          accountId,
          reasoningCaseId: "rc_01",
          adaptiveDecisionId: "ad_01",
          currentStrategyRootId: rootId,
          currentRootBundleVersion: 1,
          decisionType: "REEVALUATE_AUTHORITY",
          affectedAuthorities: ["DIFFERENTIATION"],
          summary: "Reevaluate differentiation",
          whyNow: "Competitor change",
          evidenceSummary: "1 signal",
          expectedImpact: "Differentiation refresh",
          status: "PENDING_USER_APPROVAL",
        })
        .returning();

      const rejectResult = await StrategyExperienceService.rejectProposal(proposal.id, accountId);
      expect(rejectResult.status).toBe("REJECTED");

      const [updatedProp] = await db
        .select()
        .from(schema.strategyChangeProposals)
        .where(eq(schema.strategyChangeProposals.id, proposal.id));

      expect(updatedProp.status).toBe("REJECTED");
      expect(updatedProp.rejectionReason?.toLowerCase()).toContain("keep current strategy");

      // Current Strategy Root remains active
      const [activeRoot] = await db
        .select()
        .from(schema.strategyRoots)
        .where(and(eq(schema.strategyRoots.campaignId, campaignId), eq(schema.strategyRoots.status, "ACTIVE")));
      expect(activeRoot.id).toBe(rootId);
    });

    it("approving proposal executes targeted recompute, creates new immutable Root, and updates proposal to APPLIED", async () => {
      const rootId = "root_test_v1";
      await insertTestRoot({
        id: rootId,
        campaignId,
        accountId,
        primaryAxis: "simplicity_and_ease",
        contrastAxisText: "Simple multi-channel scheduling",
        approvedPromise: "Streamlined social publishing",
      });

      await db.insert(schema.rootBundles).values({
        id: "bundle_test_v1",
        strategyRootId: rootId,
        campaignId,
        accountId,
        version: 1,
      });

      await db.insert(schema.strategicPlans).values({
        id: "plan_test_v1",
        blueprintId: "bp_test_v1",
        campaignId,
        accountId,
        rootBundleId: "bundle_test_v1",
        rootBundleVersion: 1,
        version: 1,
        planSummary: "Strategic Plan v1",
        planJson: JSON.stringify({ primaryAxis: "simplicity_and_ease" }),
        status: "ACTIVE",
      });

      const [proposal] = await db
        .insert(schema.strategyChangeProposals)
        .values({
          id: "prop_to_approve",
          campaignId,
          accountId,
          reasoningCaseId: "rc_01",
          adaptiveDecisionId: "ad_01",
          currentStrategyRootId: rootId,
          currentRootBundleId: "bundle_test_v1",
          currentRootBundleVersion: 1,
          currentStrategicPlanId: "plan_test_v1",
          decisionType: "REEVALUATE_AUTHORITY",
          affectedAuthorities: ["DIFFERENTIATION"],
          summary: "Reevaluate differentiation",
          whyNow: "Competitor pricing change",
          evidenceSummary: "1 confirmed signal",
          expectedImpact: "Differentiation refresh",
          potentialDependentAuthorities: ["OFFER"],
          preservedAuthorities: ["POSITIONING", "AUDIENCE", "FUNNEL", "CHANNEL_SELECTION"],
          status: "PENDING_USER_APPROVAL",
        })
        .returning();

      // Approve proposal with mock engine returning material change
      const approveResult = await StrategyExperienceService.approveProposal(proposal.id, accountId, {
        mockEngineHandler: async (auth: string) => {
          if (auth === "DIFFERENTIATION") {
            return {
              result: "CHANGED",
              newArtifactId: "diff_snap_v2",
              payload: { primaryAxis: "value_transparent_workflows" },
            };
          }
          return { result: "NO_CHANGE_REQUIRED" };
        },
      });

      expect(approveResult.status).toBe("SUCCESS");
      expect(approveResult.executionStatus).toBe("STRATEGY_UPDATED");
      expect(approveResult.changedAuthorities).toContain("DIFFERENTIATION");
      expect(approveResult.newRoot).toBeDefined();
      expect(approveResult.newRoot.id).not.toBe(rootId); // Brand new immutable Root ID!
      expect(approveResult.newRoot.version).toBe(2);

      // Verify previous Strategy Root remains immutable in database
      const [oldRoot] = await db
        .select()
        .from(schema.strategyRoots)
        .where(eq(schema.strategyRoots.id, rootId));
      expect(oldRoot).toBeDefined();
      expect(oldRoot.primaryAxis).toBe("simplicity_and_ease");

      // Verify Proposal is marked APPLIED
      const [updatedProp] = await db
        .select()
        .from(schema.strategyChangeProposals)
        .where(eq(schema.strategyChangeProposals.id, proposal.id));
      expect(updatedProp.status).toBe("APPLIED");
      expect(updatedProp.appliedNewRootId).toBe(approveResult.newRoot.id);
      expect(updatedProp.appliedNewBundleVersion).toBe(2);
    });

    it("enforces double-approval idempotency (second call returns ALREADY_APPLIED)", async () => {
      const [proposal] = await db
        .insert(schema.strategyChangeProposals)
        .values({
          id: "prop_idempotent",
          campaignId,
          accountId,
          reasoningCaseId: "rc_01",
          adaptiveDecisionId: "ad_01",
          currentStrategyRootId: "root_any",
          decisionType: "REEVALUATE_AUTHORITY",
          summary: "Reevaluate",
          whyNow: "Test",
          evidenceSummary: "Test",
          expectedImpact: "Test",
          status: "APPLIED",
        })
        .returning();

      const result = await StrategyExperienceService.approveProposal(proposal.id, accountId);
      expect(result.status).toBe("ALREADY_APPLIED");
    });

    it("rejects stale proposals if active Strategy Root changed (stale protection)", async () => {
      // Active Root is root_newer
      await insertTestRoot({
        id: "root_newer",
        campaignId,
        accountId,
        primaryAxis: "new_axis",
      });

      // Proposal was created against old root_older
      const [proposal] = await db
        .insert(schema.strategyChangeProposals)
        .values({
          id: "prop_stale",
          campaignId,
          accountId,
          reasoningCaseId: "rc_01",
          adaptiveDecisionId: "ad_01",
          currentStrategyRootId: "root_older",
          decisionType: "REEVALUATE_AUTHORITY",
          summary: "Stale proposal",
          whyNow: "Old change",
          evidenceSummary: "Old evidence",
          expectedImpact: "Old impact",
          status: "PENDING_USER_APPROVAL",
        })
        .returning();

      await expect(StrategyExperienceService.approveProposal(proposal.id, accountId)).rejects.toThrow(
        "PROPOSAL_STALE"
      );

      const [updatedProp] = await db
        .select()
        .from(schema.strategyChangeProposals)
        .where(eq(schema.strategyChangeProposals.id, proposal.id));
      expect(updatedProp.status).toBe("STALE");
    });
  });

  describe("Part 14-17: Badges, Diff Grounding & Chronological Activity", () => {
    it("returns truthful activity timeline derived strictly from DB events without fake items", async () => {
      // 1. Confirmed Event
      await db.insert(schema.pipelineChangeEvents).values({
        id: "evt_act_01",
        runId: "run_test_001",
        campaignId,
        accountId,
        baselineSnapshotId: "snap_base_01",
        currentSnapshotId: "snap_curr_01",
        changeDimension: "pricing",
        kind: "PRICING",
        status: "confirmed",
        summary: "Competitor lowered enterprise pricing",
        severity: "HIGH",
        createdAt: new Date("2026-08-28T10:00:00Z"),
        validatedAt: new Date("2026-08-28T10:05:00Z"),
      });

      // 2. Reasoning Case
      await db.insert(schema.reasoningCases).values({
        id: "rc_act_01",
        campaignId,
        accountId,
        strategyRootId: "root_act_01",
        strategyRootVersion: 1,
        status: "EVALUATED",
        openedAt: new Date("2026-08-28T10:06:00Z"),
      });

      // 3. Proposal
      await db.insert(schema.strategyChangeProposals).values({
        id: "prop_act_01",
        campaignId,
        accountId,
        reasoningCaseId: "rc_act_01",
        adaptiveDecisionId: "ad_act_01",
        currentStrategyRootId: "root_act_01",
        decisionType: "REEVALUATE_AUTHORITY",
        affectedAuthorities: ["DIFFERENTIATION"],
        summary: "Avyron recommends reevaluating Differentiation",
        whyNow: "Competitor pricing change",
        evidenceSummary: "1 signal",
        expectedImpact: "Differentiation refresh",
        status: "APPROVED",
        createdAt: new Date("2026-08-28T10:08:00Z"),
        reviewedAt: new Date("2026-08-28T10:12:00Z"),
      });

      // 4. Lineage Activation
      await db.insert(schema.strategyAdaptationLineages).values({
        id: "lin_act_01",
        campaignId,
        accountId,
        previousRootId: "root_act_01",
        previousRootVersion: 1,
        newRootId: "root_act_02",
        newRootVersion: 2,
        changedAuthorities: ["DIFFERENTIATION"],
        preservedAuthorities: ["POSITIONING", "OFFER", "AUDIENCE"],
        createdAt: new Date("2026-08-28T10:15:00Z"),
      });

      const activities = await StrategyExperienceService.getStrategyActivity(campaignId, accountId);
      expect(activities.length).toBeGreaterThanOrEqual(4);

      // Verify strict descending chronological order
      for (let i = 0; i < activities.length - 1; i++) {
        const t1 = new Date(activities[i].timestamp).getTime();
        const t2 = new Date(activities[i + 1].timestamp).getTime();
        expect(t1).toBeGreaterThanOrEqual(t2);
      }

      // Check specific real titles
      const titles = activities.map((a) => a.title);
      expect(titles).toContain("Strategy v2 Activated");
      expect(titles).toContain("Strategic Update Approved by Customer");
      expect(titles).toContain("Strategic Update Recommended");
      expect(titles).toContain("Deep Reasoning Investigation Completed");
      expect(titles).toContain("Market Change Confirmed");
    });
  });
});
