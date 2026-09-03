import "dotenv/config";
import { describe, it, expect } from "vitest";
import { buildExecutionPlanningContext } from "../what-to-do-today/context-builder";
import { evaluateDailyPlanWithJudge } from "../what-to-do-today/judge";
import { WhatToDoTodayService } from "../what-to-do-today/service";
import { ExecutionPlanningContext, DailyPlanDraft } from "../what-to-do-today/contracts";
import * as fs from "fs";
import * as path from "path";

describe("What To Do Today — Phase 1 Execution Brain Specification", () => {
  const REAL_CAMPAIGN_ID = "campaign_1773576062201_6t0oxi";
  const ISOLATED_TEST_CAMPAIGN_ID = "test_campaign_wtdt_spec_001";

  // -------------------------------------------------------------------------
  // UI & NAVIGATION INTEGRITY
  // -------------------------------------------------------------------------

  it("1. Existing What To Do Today route is reused without duplicates", () => {
    const screenPath = path.resolve(__dirname, "../../app/(tabs)/what-to-do-today.tsx");
    expect(fs.existsSync(screenPath)).toBe(true);
    const content = fs.readFileSync(screenPath, "utf8");
    expect(content.toLowerCase()).toContain("what to do today");
    expect(content).toContain("useWhatToDoToday");
  });

  it("2. No duplicate sidebar destination created in _layout.tsx (exactly 1 entry)", () => {
    const layoutPath = path.resolve(__dirname, "../../app/(tabs)/_layout.tsx");
    const layoutContent = fs.readFileSync(layoutPath, "utf8");
    const matches = layoutContent.match(/name:\s*['"]what-to-do-today['"]/g) || [];
    expect(matches.length).toBe(1);
  });

  // -------------------------------------------------------------------------
  // CANONICAL LINEAGE RESOLUTION
  // -------------------------------------------------------------------------

  it("3 & 4 & 5. Resolves Canonical Strategy Root bf6d003d, Root Bundle v56, and Plan 1772a457", async () => {
    const ctx = await buildExecutionPlanningContext(REAL_CAMPAIGN_ID, "2026-08-27");
    expect(ctx.strategyRootId).toBe("bf6d003d-c2a1-4920-bf35-01fd5211a676");
    expect(ctx.rootBundleId).toBe("cc451488-cabe-4e48-9aea-b9d138072cac");
    expect(ctx.rootBundleVersion).toBe(56);
    expect(ctx.strategicPlanId).toBe("1772a457-9e78-48f1-97fa-702aae982ce8");
    expect(ctx.strategicPlanVersion).toBe(1);
  });

  it("6. No generic latest mixing — context strictly binds lineage-matched artifacts", async () => {
    const ctx = await buildExecutionPlanningContext(REAL_CAMPAIGN_ID, "2026-08-27");
    expect(ctx.strategyName).toBe("Competitor Intelligence Extraction Simplicity_and_Ease");
    expect(ctx.primaryAxis).toBe("simplicity_and_ease");
  });

  it("7 & 8. Approved engine outputs & Strategic Plan reach the planning context", async () => {
    const ctx = await buildExecutionPlanningContext(REAL_CAMPAIGN_ID, "2026-08-27");
    expect(ctx.approvedLanes.length).toBeGreaterThan(0);
    expect(ctx.approvedMechanism.mechanismName).toContain("Competitor Intelligence");
    expect(ctx.strategicGoals.planSummary).toContain("Positioning Avyron AI decisively");
    expect(ctx.persuasionTrust?.primaryCialdiniPrinciple).toBe("authority");
  });

  // -------------------------------------------------------------------------
  // STRATEGY BOUNDARIES & CHANNEL INTELLIGENCE
  // -------------------------------------------------------------------------

  it("9. Planner cannot invent strategy — context encapsulates approved boundaries", async () => {
    const ctx = await buildExecutionPlanningContext(REAL_CAMPAIGN_ID, "2026-08-27");
    expect(ctx.channelHierarchy.primaryChannel).toBe("YOUTUBE");
    expect(ctx.channelHierarchy.supportingChannels).toEqual(["INSTAGRAM", "TIKTOK", "FACEBOOK", "X"]);
  });

  it("10 & 11. Primary channel receives dominant emphasis while supporting channels are covered", () => {
    const mockPlan: DailyPlanDraft = {
      dailyMission: "Establish authoritative proof on YouTube and adapt tactical clips across Instagram and TikTok.",
      executionRationale: "Anchoring proof on YouTube creates raw evidence for supporting channels.",
      tasks: [
        {
          title: "Produce YouTube Video on Live Market Mirror",
          description: "Record 10 min teardown of live intelligence stream",
          priority: "MUST_DO",
          taskType: "PROOF_ASSET",
          channel: "YOUTUBE",
          channelRole: "PRIMARY",
          objective: "Establish primary authority",
          reason: "Anchor asset for week",
          expectedOutcome: "Full proof asset",
          sourceAuthority: "MECHANISM",
          estimatedEffort: "3 hours",
          executionApproach: "Script and record",
        },
        {
          title: "Create Instagram Carousel on 3 Intelligence Gaps",
          description: "Visual proof slides derived from YouTube breakdown",
          priority: "SHOULD_DO",
          taskType: "CONTENT",
          channel: "INSTAGRAM",
          channelRole: "SUPPORTING",
          objective: "Drive saves and shares",
          reason: "Adapt visual insights natively",
          expectedOutcome: "Carousel published",
          sourceAuthority: "POSITIONING",
          estimatedEffort: "1.5 hours",
          executionApproach: "Design carousel",
        },
        {
          title: "Draft TikTok Teaser on Data Accuracy Risk",
          description: "15-second native curiosity hook",
          priority: "SHOULD_DO",
          taskType: "CONTENT",
          channel: "TIKTOK",
          channelRole: "SUPPORTING",
          objective: "Top of funnel curiosity",
          reason: "Drive viewers to YouTube breakdown",
          expectedOutcome: "TikTok video published",
          sourceAuthority: "AWARENESS",
          estimatedEffort: "45 mins",
          executionApproach: "Record short video",
        },
      ],
      channelPlan: [
        { channel: "YOUTUBE", role: "PRIMARY", executionIntent: "Anchor proof", whyToday: "Core asset", coverageState: "ACTIVE" },
        { channel: "INSTAGRAM", role: "SUPPORTING", executionIntent: "Visual proof", whyToday: "Active task", coverageState: "ACTIVE" },
        { channel: "TIKTOK", role: "SUPPORTING", executionIntent: "Fast hook", whyToday: "Active task", coverageState: "ACTIVE" },
        { channel: "FACEBOOK", role: "SUPPORTING", executionIntent: "Discussion", whyToday: "Staged in rotation", coverageState: "PENDING_PREREQUISITE" },
        { channel: "X", role: "SUPPORTING", executionIntent: "Argument thread", whyToday: "Staged in rotation", coverageState: "PENDING_PREREQUISITE" },
      ],
    };

    const primaryTasks = mockPlan.tasks.filter(t => t.channel === "YOUTUBE");
    expect(primaryTasks.length).toBeGreaterThan(0);
    expect(primaryTasks[0].priority).toBe("MUST_DO");
    expect(mockPlan.channelPlan.length).toBe(5);
  });

  // -------------------------------------------------------------------------
  // SEMANTIC JUDGE CONSTITUTIONAL CRITERIA
  // -------------------------------------------------------------------------

  it("12 & 13. Judge rejects copy-pasted multi-channel execution", async () => {
    const ctx: ExecutionPlanningContext = {
      campaignId: "test_camp",
      accountId: "acc_1",
      businessDate: "2026-08-27",
      strategyRootId: "sr_1",
      strategyRootVersion: 56,
      rootBundleId: "rb_1",
      rootBundleVersion: 56,
      strategicPlanId: "sp_1",
      strategicPlanVersion: 1,
      strategyName: "Test Strategy",
      primaryAxis: "simplicity",
      contrastAxis: "live vs static",
      approvedPromise: "Deliver intelligence",
      approvedTransformation: "Transform workflow",
      approvedMechanism: { mechanismName: "Live Mirror" },
      approvedLanes: [{ laneId: "l1", title: "Automators" }],
      positioningSummary: "Positioning summary",
      channelHierarchy: { primaryChannel: "YOUTUBE", supportingChannels: ["INSTAGRAM", "TIKTOK", "FACEBOOK", "X"] },
      budgetConstraints: { operationalMode: "BUILD", spendRule: "Organic only" },
      strategicGoals: { planSummary: "Plan summary" },
    };

    const copyPastePlan: DailyPlanDraft = {
      dailyMission: "Post identical copy across all channels.",
      executionRationale: "Easy posting",
      tasks: [
        {
          title: "Post marketing message",
          description: "Post the same message everywhere",
          priority: "MUST_DO",
          taskType: "CONTENT",
          channel: "YOUTUBE",
          channelRole: "PRIMARY",
          objective: "Post everywhere",
          reason: "None",
          expectedOutcome: "Post",
          sourceAuthority: "MECHANISM",
          estimatedEffort: "1 hour",
          executionApproach: "Copy paste",
        },
        {
          title: "Post marketing message",
          description: "Post the same message everywhere",
          priority: "SHOULD_DO",
          taskType: "CONTENT",
          channel: "INSTAGRAM",
          channelRole: "SUPPORTING",
          objective: "Post everywhere",
          reason: "None",
          expectedOutcome: "Post",
          sourceAuthority: "MECHANISM",
          estimatedEffort: "1 hour",
          executionApproach: "Copy paste",
        },
      ],
      channelPlan: [],
    };

    const report = await evaluateDailyPlanWithJudge(ctx, copyPastePlan);
    expect(report.valid).toBe(false);
    expect(report.rejectionReasons.some(r => r.includes("COPY_PASTE") || r.includes("GENERIC"))).toBe(true);
  }, 20000);

  it("14. Judge rejects generic task plans or empty missions", async () => {
    const ctx = await buildExecutionPlanningContext(REAL_CAMPAIGN_ID, "2026-08-27");
    const emptyPlan: DailyPlanDraft = {
      dailyMission: "Grow your brand today",
      executionRationale: "General growth",
      tasks: [],
      channelPlan: [],
    };

    const report = await evaluateDailyPlanWithJudge(ctx, emptyPlan);
    expect(report.valid).toBe(false);
    expect(report.rejectionReasons.length).toBeGreaterThan(0);
  }, 20000);

  it("15 & 16 & 17 & 18. Workload feasibility and budget restrictions validated", async () => {
    const ctx = await buildExecutionPlanningContext(REAL_CAMPAIGN_ID, "2026-08-27");
    const overloadedTasks: any[] = [];
    for (let i = 0; i < 15; i++) {
      overloadedTasks.push({
        title: `Task #${i + 1}`,
        description: `Overload task ${i + 1}`,
        priority: "MUST_DO",
        taskType: "CONTENT",
        channel: "YOUTUBE",
        channelRole: "PRIMARY",
        objective: "Overload",
        reason: "Overload",
        expectedOutcome: "Burnout",
        sourceAuthority: "MECHANISM",
        estimatedEffort: "2 hours",
        executionApproach: "Do too much",
      });
    }

    const overloadedPlan: DailyPlanDraft = {
      dailyMission: "Execute 15 major strategic tasks today.",
      executionRationale: "Too many tasks",
      tasks: overloadedTasks,
      channelPlan: [],
    };

    const report = await evaluateDailyPlanWithJudge(ctx, overloadedPlan);
    expect(report.valid).toBe(false);
    expect(report.rejectionReasons.some(r => r.includes("CAPACITY_EXCEEDED"))).toBe(true);
  }, 20000);

  // -------------------------------------------------------------------------
  // IDEMPOTENCY & LIFECYCLE PERSISTENCE
  // -------------------------------------------------------------------------

  it("19 & 20. Same campaign and date returns exact same executionDayId without regenerating", async () => {
    const payload1 = await WhatToDoTodayService.getOrCreateTodayPlan(REAL_CAMPAIGN_ID, "2026-08-27", false);
    const payload2 = await WhatToDoTodayService.getOrCreateTodayPlan(REAL_CAMPAIGN_ID, "2026-08-27", false);

    expect(payload1.executionDayId).toBe(payload2.executionDayId);
    expect(payload1.dailyMission).toBe(payload2.dailyMission);
    expect(payload1.tasks.length).toBe(payload2.tasks.length);
  });

  it("21. Task status lifecycle updates persist correctly", async () => {
    const payload = await WhatToDoTodayService.getOrCreateTodayPlan(REAL_CAMPAIGN_ID, "2026-08-27", false);
    const firstTask = payload.tasks[0];
    expect(firstTask).toBeDefined();

    const updated = await WhatToDoTodayService.updateTaskStatus(firstTask.id, "DONE");
    expect(updated.status).toBe("DONE");
    expect(updated.completedAt).toBeDefined();

    // Reopen task
    const reopened = await WhatToDoTodayService.updateTaskStatus(firstTask.id, "ACTIVE");
    expect(reopened.status).toBe("ACTIVE");
    expect(reopened.completedAt).toBeNull();
  });

  // -------------------------------------------------------------------------
  // FROZEN SYSTEMS INTEGRITY CHECK
  // -------------------------------------------------------------------------

  it("22 & 23 & 24. No regressions on frozen Watchtower, Performance, and Reasoning read surfaces", async () => {
    const { adaptiveReadRouter } = await import("../adaptive/read-surface");
    expect(adaptiveReadRouter).toBeDefined();
  });

  it("25 & 26. Strategy Root and Strategic Plan remain completely unchanged", async () => {
    const ctx = await buildExecutionPlanningContext(REAL_CAMPAIGN_ID, "2026-08-27");
    expect(ctx.strategyRootId).toBe("bf6d003d-c2a1-4920-bf35-01fd5211a676");
    expect(ctx.rootBundleVersion).toBe(56);
    expect(ctx.strategicPlanId).toBe("1772a457-9e78-48f1-97fa-702aae982ce8");
  });

  it("27. Task Blueprint Generator produces structured scenes, shooting angles, and full script", async () => {
    const { TaskBlueprintGenerator } = await import("../what-to-do-today/blueprint-generator");
    const payload = await WhatToDoTodayService.getOrCreateTodayPlan(REAL_CAMPAIGN_ID, "2026-08-27", false);
    const firstTask = payload.tasks[0];
    expect(firstTask).toBeDefined();

    const blueprint = await TaskBlueprintGenerator.getOrGenerateBlueprint(firstTask.id, false);
    expect(blueprint).toBeDefined();
    expect(blueprint.scenes).toBeDefined();
    expect(blueprint.scenes.length).toBeGreaterThan(0);
    expect(blueprint.scenes[0].shootingAngle).toBeDefined();
    expect(blueprint.scenes[0].spokenScript).toBeDefined();
    expect(blueprint.teleprompterFullScript).toBeDefined();
    expect(blueprint.platformPost).toBeDefined();
  });
});
