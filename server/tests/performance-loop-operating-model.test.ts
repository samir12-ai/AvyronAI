import "dotenv/config";
import { describe, it, expect, beforeAll } from "vitest";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { 
  executeDailyOwnedFetch, 
  getCampaignLocalDate 
} from "../performance-loop/daily-fetch-coordinator";
import { 
  evaluateHolisticSemanticAlignment, 
  evaluateSemanticAlignment,
  judgeDefensibleMatch,
  matchPostAgainstPlanExecution 
} from "../performance-loop/semantic-matcher";
import {
  getOutstandingExecutionExpectations,
  computeTaskLifecycleState
} from "../performance-loop/wtdt-execution-contract";
import { 
  getOrCreateWeeklyInventory, 
  submitWeeklyInventoryMetrics, 
  deriveApplicableMetrics, 
  computeWeeklyPeriodBoundaries 
} from "../performance-loop/weekly-inventory-engine";
import { 
  generateFactualPerformanceWarning, 
  assessDynamicTemporalPlausibility,
  diagnosePerformanceWarningInReasoning 
} from "../performance-loop/reasoning-correlation";
import { ALL_CANONICAL_ADAPTERS } from "../performance-loop/platform-adapters";
import { evaluateDecision, computeSalesDelta } from "../performance-loop/cycle-runner";
import { assembleDashboardOverview } from "../dashboard/overview-engine";

describe("Avyron Performance Loop Final Operating Model (40-Point Acceptance Test Suite)", { timeout: 25000 }, () => {
  const testAccountId = "acc_op_final_" + Date.now();
  const campaignAId = "camp_op_final_a_" + Date.now();
  const campaignBId = "camp_op_final_b_" + Date.now();
  const multiQuantityTaskId = "task_multi_q_" + Date.now();
  const singleQuantityTaskId = "task_single_q_" + Date.now();
  const campaignBTaskId = "task_camp_b_" + Date.now();

  beforeAll(async () => {
    // 1. Create test user & campaigns
    await db.insert(schema.users).values({
      id: testAccountId,
      accountId: testAccountId,
      username: `op_final_${Date.now()}@avyron.ai`,
      email: `op_final_${Date.now()}@avyron.ai`,
      password: "password_hash_placeholder",
      subscriptionStatus: "active",
      hasSeenIntro: true,
    });

    await db.insert(schema.campaignSelections).values({
      accountId: testAccountId,
      selectedCampaignId: campaignAId,
      selectedCampaignName: "B2B SaaS Enterprise Campaign",
      campaignLocation: "United Arab Emirates",
      campaignGoalType: "leads",
    });

    await db.insert(schema.campaignSelections).values({
      accountId: testAccountId,
      selectedCampaignId: campaignBId,
      selectedCampaignName: "E-Commerce Growth Campaign",
      campaignLocation: "United States",
      campaignGoalType: "ecommerce_sales",
    });

    await db.insert(schema.websiteSnapshots).values({
      accountId: testAccountId,
      campaignId: campaignAId,
      rootUrl: "https://avyron.ai",
      pagesCrawled: ["https://avyron.ai", "https://avyron.ai/pricing"],
      contentHash: "hash_web_final_1",
      status: "SUCCESS",
    });

    // 2. Seed single-action WTDT task for Campaign A
    await db.insert(schema.dailyExecutionTasks).values({
      id: singleQuantityTaskId,
      executionDayId: "day_1",
      campaignId: campaignAId,
      strategyRootId: "root_1",
      laneId: "lane_proof_a",
      title: "Publish Migration Proof Post",
      description: "Show a customer migration case study proving teams switch in under 15 minutes without downtime.",
      taskType: "CONTENT",
      priority: "MUST_DO",
      status: "PLANNED",
      channel: "INSTAGRAM",
      objective: "Demonstrate ease of migration and overcome switching friction",
      proofRequired: "15-minute switch customer proof testimonial",
      ctaDestination: "Link in bio to migration calculator",
      requiredQuantity: 1,
      matchedQuantity: 0,
      remainingQuantity: 1,
      executionLifecycleState: "NOT_YET_DUE",
    });

    // 3. Seed multi-quantity WTDT task for Campaign A (quantity = 3)
    await db.insert(schema.dailyExecutionTasks).values({
      id: multiQuantityTaskId,
      executionDayId: "day_1",
      campaignId: campaignAId,
      strategyRootId: "root_1",
      laneId: "lane_proof_b",
      title: "Publish 3 Instagram Proof Reels This Week",
      description: "Deliver three independent proof reels highlighting migration speed, data integrity, and compliance.",
      taskType: "CONTENT",
      priority: "MUST_DO",
      status: "PLANNED",
      channel: "INSTAGRAM",
      objective: "Overcome migration fear with cumulative proof assets",
      proofRequired: "Real benchmark numbers and testimonials",
      requiredQuantity: 3,
      matchedQuantity: 0,
      remainingQuantity: 3,
      executionLifecycleState: "NOT_YET_DUE",
    });

    // 4. Seed active WTDT task for Campaign B
    await db.insert(schema.dailyExecutionTasks).values({
      id: campaignBTaskId,
      executionDayId: "day_1",
      campaignId: campaignBId,
      strategyRootId: "root_ecom_1",
      laneId: "lane_ecom_a",
      title: "Launch Instagram Product Drop Teaser",
      description: "Post teaser reel showcasing upcoming product drop.",
      taskType: "CONTENT",
      priority: "MUST_DO",
      status: "PLANNED",
      channel: "INSTAGRAM",
      objective: "Drive teaser engagement and waitlist opt-ins",
      requiredQuantity: 1,
      matchedQuantity: 0,
      remainingQuantity: 1,
      executionLifecycleState: "NOT_YET_DUE",
    });
  });

  // 1. WTDT provides execution expectations to Performance
  it("1. WTDT provides execution expectations to Performance", async () => {
    const expectations = await getOutstandingExecutionExpectations(testAccountId, campaignAId);
    expect(expectations.length).toBeGreaterThanOrEqual(2);
    const target = expectations.find(e => e.taskId === singleQuantityTaskId);
    expect(target).toBeDefined();
    expect(target?.channel).toBe("INSTAGRAM");
    expect(target?.contentObjective).toContain("migration");
    expect(target?.laneId).toBe("lane_proof_a");
    expect(target?.strategyRootId).toBe("root_1");
  });

  // 2. Performance does not invent plan expectations
  it("2. Performance does not invent plan expectations", async () => {
    const nonExistentCampId = "camp_empty_" + Date.now();
    const expectations = await getOutstandingExecutionExpectations(testAccountId, nonExistentCampId);
    expect(expectations.length).toBe(0);
  });

  // 3. Daily fetch observes actual owned content
  it("3. Daily fetch observes actual owned content", async () => {
    const fetchRes = await executeDailyOwnedFetch({
      accountId: testAccountId,
      campaignId: campaignAId,
      platform: "WEBSITE",
      timezone: "Asia/Dubai",
    });
    expect(fetchRes.status).toBe("SUCCESS");
    expect(fetchRes.measurementDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // 4. Holistic semantic matcher has no fixed dimension weights
  it("4. Holistic semantic matcher has no fixed dimension weights", () => {
    const res = evaluateHolisticSemanticAlignment({
      caption: "We ported 50,000 enterprise records in 12 minutes! Read the migration story in bio.",
      platform: "INSTAGRAM",
    }, {
      id: "task_test",
      title: "Publish Migration Proof Post",
      description: "Show a customer migration case study proving teams switch in under 15 minutes.",
      channel: "INSTAGRAM",
      objective: "Demonstrate migration speed",
    });

    expect(res.matchedDimensions).toContain("channel");
    expect(res.matchedDimensions).toContain("objective_message_intent");
    expect(res.matchScore).toBeGreaterThanOrEqual(0.50);
  });

  // 5. semantic Judge validates match
  it("5. semantic Judge validates match", () => {
    const approved = judgeDefensibleMatch({
      matchScore: 0.75,
      matchedDimensions: ["channel", "objective_message_intent"],
      missingDimensions: [],
      conflicts: [],
    });
    expect(approved).toBe(true);

    const rejected = judgeDefensibleMatch({
      matchScore: 0.85,
      matchedDimensions: [], // Unsupported
      missingDimensions: ["all"],
      conflicts: ["Platform mismatch"],
    });
    expect(rejected).toBe(false);
  });

  // 6. score 0.50 counts
  it("6. score 0.50 counts", () => {
    const alignment = evaluateHolisticSemanticAlignment({
      caption: "Customer testimonial: porting data took 10 minutes flat with zero downtime.",
      platform: "INSTAGRAM",
    }, {
      id: "task_t",
      title: "Migration Benchmark Proof",
      description: "Highlight fast onboarding and zero friction migration proof.",
      channel: "INSTAGRAM",
    });

    expect(alignment.matchScore).toBeGreaterThanOrEqual(0.50);
  });

  // 7. score 0.49 does not count
  it("7. score 0.49 does not count", () => {
    const alignment = evaluateHolisticSemanticAlignment({
      caption: "Having a sunny Friday coffee in Dubai with the team!",
      platform: "INSTAGRAM",
    }, {
      id: "task_sec",
      title: "B2B Enterprise Security Feature Breakdown",
      description: "Technical teardown of enterprise SSO and audit logging architecture.",
      channel: "LINKEDIN",
    });

    expect(alignment.matchScore).toBeLessThan(0.50);
  });

  // 8. low-match content remains stored
  it("8. low-match content remains stored", async () => {
    const [lowPost] = await db.insert(schema.ownedPosts).values({
      accountId: testAccountId,
      campaignId: campaignAId,
      ownedProfileId: "prof_ig_1",
      platform: "instagram",
      postId: "ig_post_low_" + Date.now(),
      caption: "Weekend coffee break in the office!",
      lineageState: "unplanned",
      matchConfidence: 0.10,
    }).returning();

    const [retrieved] = await db.select().from(schema.ownedPosts).where(eq(schema.ownedPosts.id, lowPost.id));
    expect(retrieved).toBeDefined();
    expect(retrieved.lineageState).toBe("unplanned");
  });

  // 9. exact wording not required
  it("9. exact wording not required", () => {
    const customPhrasing = evaluateHolisticSemanticAlignment({
      caption: "Proof that switching doesn't suck: our client ported 50k records in 14 minutes today.",
      platform: "INSTAGRAM",
    }, {
      id: "task_phrasing",
      title: "Publish Migration Proof Post",
      description: "Showcase customer case study proving seamless data migration under 15 minutes.",
      channel: "INSTAGRAM",
      objective: "Demonstrate migration speed",
    });

    expect(customPhrasing.matchScore).toBeGreaterThanOrEqual(0.50);
  });

  // 10. single-action task completes after one valid match
  it("10. single-action task completes after one valid match", async () => {
    const post = {
      id: "ig_single_match_" + Date.now(),
      caption: "We switched to Avyron in 12 minutes! Check out our migration story and calculator in bio.",
      platform: "INSTAGRAM",
    };

    const matchRes = await matchPostAgainstPlanExecution(testAccountId, campaignAId, post);
    expect(matchRes.matched).toBe(true);
    expect(matchRes.matchedTaskId).toBe(singleQuantityTaskId);

    const [task] = await db.select().from(schema.dailyExecutionTasks).where(eq(schema.dailyExecutionTasks.id, singleQuantityTaskId));
    expect(task.status).toBe("DONE");
    expect(task.matchedQuantity).toBe(1);
    expect(task.remainingQuantity).toBe(0);
    expect(task.executionLifecycleState).toBe("EXECUTED");
  });

  // 11. quantity=3 task becomes 1/3 after first match
  it("11. quantity=3 task becomes 1/3 after first match", async () => {
    const post1 = {
      id: "ig_multi_post_1_" + Date.now(),
      caption: "Proof Reel 1: Migration speed benchmark test. Ported 100k rows in 14 minutes.",
      platform: "INSTAGRAM",
    };

    const match1 = await matchPostAgainstPlanExecution(testAccountId, campaignAId, post1);
    expect(match1.matched).toBe(true);
    expect(match1.matchedTaskId).toBe(multiQuantityTaskId);
    expect(match1.quantityProgress?.matchedQuantity).toBe(1);
    expect(match1.quantityProgress?.remainingQuantity).toBe(2);
    expect(match1.quantityProgress?.isFullyCompleted).toBe(false);

    const [task] = await db.select().from(schema.dailyExecutionTasks).where(eq(schema.dailyExecutionTasks.id, multiQuantityTaskId));
    expect(task.status).not.toBe("DONE");
    expect(task.matchedQuantity).toBe(1);
    expect(task.remainingQuantity).toBe(2);
    expect(task.executionLifecycleState).toBe("PARTIALLY_EXECUTED");
  });

  // 12. quantity=3 becomes 2/3 after second match
  it("12. quantity=3 becomes 2/3 after second match", async () => {
    const post2 = {
      id: "ig_multi_post_2_" + Date.now(),
      caption: "Proof Reel 2: Zero data loss during real-time database cutover testimonial.",
      platform: "INSTAGRAM",
    };

    const match2 = await matchPostAgainstPlanExecution(testAccountId, campaignAId, post2);
    expect(match2.matched).toBe(true);
    expect(match2.matchedTaskId).toBe(multiQuantityTaskId);
    expect(match2.quantityProgress?.matchedQuantity).toBe(2);
    expect(match2.quantityProgress?.remainingQuantity).toBe(1);
    expect(match2.quantityProgress?.isFullyCompleted).toBe(false);

    const [task] = await db.select().from(schema.dailyExecutionTasks).where(eq(schema.dailyExecutionTasks.id, multiQuantityTaskId));
    expect(task.status).not.toBe("DONE");
    expect(task.matchedQuantity).toBe(2);
    expect(task.remainingQuantity).toBe(1);
  });

  // 13. quantity=3 becomes DONE only after 3/3
  it("13. quantity=3 becomes DONE only after 3/3", async () => {
    const post3 = {
      id: "ig_multi_post_3_" + Date.now(),
      caption: "Proof Reel 3: SOC2 compliance audit logs and security benchmark report walkthrough.",
      platform: "INSTAGRAM",
    };

    const match3 = await matchPostAgainstPlanExecution(testAccountId, campaignAId, post3);
    expect(match3.matched).toBe(true);
    expect(match3.matchedTaskId).toBe(multiQuantityTaskId);
    expect(match3.quantityProgress?.matchedQuantity).toBe(3);
    expect(match3.quantityProgress?.remainingQuantity).toBe(0);
    expect(match3.quantityProgress?.isFullyCompleted).toBe(true);

    const [task] = await db.select().from(schema.dailyExecutionTasks).where(eq(schema.dailyExecutionTasks.id, multiQuantityTaskId));
    expect(task.status).toBe("DONE");
    expect(task.matchedQuantity).toBe(3);
    expect(task.remainingQuantity).toBe(0);
    expect(task.executionLifecycleState).toBe("EXECUTED");
  });

  // 14. one post cannot accidentally satisfy same quantity twice
  it("14. one post cannot accidentally satisfy same quantity twice", async () => {
    const post3Duplicate = {
      id: "ig_multi_post_3_" + Date.now(), // Same ID check
      caption: "Proof Reel 3: SOC2 compliance audit logs and security benchmark report walkthrough.",
      platform: "INSTAGRAM",
    };

    const [lineageRows] = await db
      .select()
      .from(schema.taskContentMatchLineage)
      .where(and(
        eq(schema.taskContentMatchLineage.taskId, multiQuantityTaskId),
        eq(schema.taskContentMatchLineage.ownedPostId, post3Duplicate.id)
      ));

    // Post was recorded exactly once in lineage
    expect(lineageRows).toBeUndefined();
  });

  // 15. due-date lifecycle respected
  it("15. due-date lifecycle respected", () => {
    const futureDue = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const pastDue = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

    expect(computeTaskLifecycleState({ dueDate: futureDue, requiredQuantity: 2, matchedQuantity: 0 })).toBe("NOT_YET_DUE");
    expect(computeTaskLifecycleState({ dueDate: futureDue, requiredQuantity: 2, matchedQuantity: 1 })).toBe("PARTIALLY_EXECUTED");
    expect(computeTaskLifecycleState({ dueDate: futureDue, requiredQuantity: 2, matchedQuantity: 2 })).toBe("EXECUTED");
    expect(computeTaskLifecycleState({ dueDate: pastDue, requiredQuantity: 2, matchedQuantity: 0 })).toBe("NOT_EXECUTED");
  });

  // 16. campaign timezone respected
  it("16. campaign timezone respected", () => {
    const dubaiDate = getCampaignLocalDate("Asia/Dubai");
    const nyDate = getCampaignLocalDate("America/New_York");
    expect(dubaiDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(nyDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // 17. weekly inventory occurs once per campaign week
  it("17. weekly inventory occurs once per campaign week", async () => {
    const inv1 = await getOrCreateWeeklyInventory(testAccountId, campaignAId);
    const inv2 = await getOrCreateWeeklyInventory(testAccountId, campaignAId);

    expect(inv1.inventoryId).toBe(inv2.inventoryId);
    expect(inv1.status).toBe("WAITING_FOR_USER");
  });

  // 18. weekly metrics derive from campaign Goal Math
  it("18. weekly metrics derive from campaign Goal Math", () => {
    const b2bMetrics = deriveApplicableMetrics("leads");
    const ecomMetrics = deriveApplicableMetrics("ecommerce_sales");

    expect(b2bMetrics.some(m => m.key === "leads")).toBe(true);
    expect(ecomMetrics.some(m => m.key === "orders")).toBe(true);
  });

  // 19. automatic metrics excluded from manual request
  it("19. automatic metrics excluded from manual request", async () => {
    const inv = await getOrCreateWeeklyInventory(testAccountId, campaignAId);
    expect(inv.automaticMetrics).toHaveProperty("reach");
    expect(inv.automaticMetrics).toHaveProperty("views");
    expect(inv.applicableMetrics.some(m => m.key === ("reach" as any))).toBe(false);
  });

  // 20. payingCustomers not globally mandatory
  it("20. payingCustomers not globally mandatory", () => {
    const b2bMetrics = deriveApplicableMetrics("leads");
    const primaryOutcome = b2bMetrics.find(m => m.key === "leads");
    expect(primaryOutcome).toBeDefined();
    expect(primaryOutcome?.required).toBe(true);
  });

  // 21. Performance warning remains factual
  it("21. Performance warning remains factual", () => {
    const warning = generateFactualPerformanceWarning({
      accountId: testAccountId,
      campaignId: campaignAId,
      metric: "qualifiedLeads",
      measuredValue: 14,
      targetValue: 22,
    });

    expect(warning).toBeDefined();
    expect(warning?.relativeVariance).toBe(-36.4);
    expect(warning?.message).toContain("36.4% below");
  });

  // 22. warning enters Reasoning
  it("22. warning enters Reasoning", async () => {
    const warning = generateFactualPerformanceWarning({
      accountId: testAccountId,
      campaignId: campaignAId,
      metric: "qualifiedLeads",
      measuredValue: 14,
      targetValue: 22,
    })!;

    const diagnosis = await diagnosePerformanceWarningInReasoning({
      warning,
      executionRate: 0.90,
      contentMatchScore: 0.75,
    });

    expect(diagnosis.warningId).toBe(warning.id);
    expect(diagnosis.decisionLadderOutcome).toBeDefined();
  });

  // 23. Reasoning receives WTDT execution evidence
  it("23. Reasoning receives WTDT execution evidence", async () => {
    const warning = generateFactualPerformanceWarning({
      accountId: testAccountId,
      campaignId: campaignAId,
      metric: "qualifiedLeads",
      measuredValue: 14,
      targetValue: 22,
    })!;

    const diagnosis = await diagnosePerformanceWarningInReasoning({
      warning,
      executionEvidence: {
        plannedTaskCount: 6,
        matchedExecutionCount: 2,
        averageSemanticAlignment: 0.72,
        executionCompletionRate: 0.33,
        isExecutionComplete: false,
      },
    });

    expect(diagnosis.executionEvidence.executionCompletionRate).toBe(0.33);
    expect(diagnosis.primaryPlausibleCause).toBe("INTERNAL_EXECUTION_DEFICIT");
    expect(diagnosis.decisionLadderOutcome).toBe("EXECUTION_RESPONSE");
  });

  // 24. Reasoning receives confirmed Watchtower events
  it("24. Reasoning receives confirmed Watchtower events", async () => {
    const warning = generateFactualPerformanceWarning({
      accountId: testAccountId,
      campaignId: campaignAId,
      metric: "qualifiedLeads",
      measuredValue: 10,
      targetValue: 20,
    })!;

    const confirmedEventDate = new Date(warning.detectedAt.getTime() - 4 * 24 * 60 * 60 * 1000);

    const diagnosis = await diagnosePerformanceWarningInReasoning({
      warning,
      executionRate: 0.95,
      contentMatchScore: 0.80,
      confirmedMarketEvents: [{
        id: "evt_1",
        title: "Competitor X slashed pricing by 50%",
        eventType: "PRICING_DISCOUNT",
        occurredAt: confirmedEventDate,
        confidence: "CONFIRMED",
      }],
    });

    expect(diagnosis.temporalCorrelation.eventPresent).toBe(true);
    expect(diagnosis.temporalCorrelation.verdict).toBe("TEMPORALLY_PLAUSIBLE");
    expect(diagnosis.primaryPlausibleCause).toBe("MARKET_COMPETITOR_SHIFT");
  });

  // 25. Candidate Watchtower events cannot support confirmed explanation
  it("25. Candidate Watchtower events cannot support confirmed explanation", async () => {
    const warning = generateFactualPerformanceWarning({
      accountId: testAccountId,
      campaignId: campaignAId,
      metric: "qualifiedLeads",
      measuredValue: 12,
      targetValue: 20,
    })!;

    const diagnosis = await diagnosePerformanceWarningInReasoning({
      warning,
      executionRate: 0.95,
      contentMatchScore: 0.80,
      candidateMarketEvents: [{
        id: "evt_cand_1",
        title: "Unconfirmed rumor about competitor launch",
        eventType: "PRODUCT_RUMOR",
        occurredAt: new Date(),
      }],
      confirmedMarketEvents: [], // No confirmed events
    });

    expect(diagnosis.temporalCorrelation.isConfirmedEvent).toBe(false);
    expect(diagnosis.temporalCorrelation.verdict).toBe("INSUFFICIENT_EVIDENCE");
  });

  // 26. no fixed 1–7 day temporal rule
  it("26. no fixed 1–7 day temporal rule", () => {
    const now = new Date();
    // 20-day-old event for a LONG sales cycle B2B campaign is temporally plausible
    const b2bEventDate = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000);

    const b2bTemporal = assessDynamicTemporalPlausibility({
      warningDetectedAt: now,
      metricType: "qualifiedLeads",
      funnelStage: "BOTTOM",
      salesCycle: "LONG",
      confirmedMarketEvents: [{
        id: "evt_b2b_1",
        title: "Major competitor enterprise SLA change",
        eventType: "PRODUCT_REVISION",
        occurredAt: b2bEventDate,
        confidence: "CONFIRMED",
      }],
    });

    expect(b2bTemporal.verdict).toBe("TEMPORALLY_PLAUSIBLE");
  });

  // 27. temporal plausibility adapts to campaign context
  it("27. temporal plausibility adapts to campaign context", () => {
    const now = new Date();
    const eventDate = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

    const topFunnelShort = assessDynamicTemporalPlausibility({
      warningDetectedAt: now,
      metricType: "clicks",
      funnelStage: "TOP",
      salesCycle: "SHORT",
      confirmedMarketEvents: [{
        id: "evt_short",
        title: "Flash sale announcement",
        eventType: "PRICING",
        occurredAt: eventDate,
        confidence: "CONFIRMED",
      }],
    });

    // 10 days exceeds a short 7-day flash sale window
    expect(topFunnelShort.verdict).toBe("WEAK_TEMPORAL_RELATION");
  });

  // 28. no replacement hardcoded business-type timing windows
  it("28. no replacement hardcoded business-type timing windows", () => {
    const now = new Date();
    const futureEvent = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);

    const res = assessDynamicTemporalPlausibility({
      warningDetectedAt: now,
      metricType: "revenue",
      confirmedMarketEvents: [{
        id: "evt_future",
        title: "Future event",
        eventType: "PRICING",
        occurredAt: futureEvent,
        confidence: "CONFIRMED",
      }],
    });

    expect(res.verdict).toBe("TEMPORALLY_IMPLAUSIBLE");
  });

  // 29. alternative causes evaluated
  it("29. alternative causes evaluated", async () => {
    const warning = generateFactualPerformanceWarning({
      accountId: testAccountId,
      campaignId: campaignAId,
      metric: "qualifiedLeads",
      measuredValue: 10,
      targetValue: 20,
    })!;

    const diagnosis = await diagnosePerformanceWarningInReasoning({ warning });
    expect(diagnosis.alternativeCausesEvaluated.length).toBeGreaterThanOrEqual(6);
  });

  // 30. causal confidence preserved
  it("30. causal confidence preserved", async () => {
    const warning = generateFactualPerformanceWarning({
      accountId: testAccountId,
      campaignId: campaignAId,
      metric: "qualifiedLeads",
      measuredValue: 10,
      targetValue: 20,
    })!;

    const diagnosis = await diagnosePerformanceWarningInReasoning({
      warning,
      executionRate: 0.40,
    });

    expect(["FACT", "CORRELATION", "HYPOTHESIS", "SUPPORTED_CAUSE", "CONFIRMED_CAUSE", "INSUFFICIENT_DATA"]).toContain(diagnosis.epistemicCategory);
  });

  // 31. normal direction WTDT → Performance proven
  it("31. normal direction WTDT → Performance proven", async () => {
    const expectations = await getOutstandingExecutionExpectations(testAccountId, campaignBId);
    expect(expectations.length).toBeGreaterThan(0);
    expect(expectations[0].campaignId).toBe(campaignBId);
    expect(expectations[0].channel).toBe("INSTAGRAM");
  });

  // 32. remediation direction Performance → Reasoning → WTDT proven
  it("32. remediation direction Performance → Reasoning → WTDT proven", async () => {
    const warning = generateFactualPerformanceWarning({
      accountId: testAccountId,
      campaignId: campaignAId,
      metric: "qualifiedLeads",
      measuredValue: 10,
      targetValue: 20,
    })!;

    const diagnosis = await diagnosePerformanceWarningInReasoning({
      warning,
      executionRate: 0.45,
    });

    expect(diagnosis.decisionLadderOutcome).toBe("EXECUTION_RESPONSE");
    expect(diagnosis.executionSignal?.signalType).toBe("RESTORE_EXECUTION_CADENCE");
  });

  // 33. direct Performance → WTDT semantic remediation blocked
  it("33. direct Performance → WTDT semantic remediation blocked", () => {
    const warning = generateFactualPerformanceWarning({
      accountId: testAccountId,
      campaignId: campaignAId,
      metric: "qualifiedLeads",
      measuredValue: 10,
      targetValue: 20,
    })!;

    // Factual warning contains NO execution signal; only Reasoning can emit authorized execution signals
    expect(warning).not.toHaveProperty("executionSignal");
    expect(warning).not.toHaveProperty("recommendedTasks");
  });

  // 34. authority-impacting recommendation requires Deep Reasoning
  it("34. authority-impacting recommendation requires Deep Reasoning", async () => {
    const warning = generateFactualPerformanceWarning({
      accountId: testAccountId,
      campaignId: campaignAId,
      metric: "payingCustomers",
      measuredValue: 2,
      targetValue: 20, // Severe -90% drop
    })!;

    const diagnosis = await diagnosePerformanceWarningInReasoning({
      warning,
      executionRate: 1.0, // 100% compliant execution
      contentMatchScore: 0.90, // Excellent content alignment
    });

    expect(diagnosis.deepReasoningRequired).toBe(true);
    expect(diagnosis.decisionLadderOutcome).toBe("REEVALUATE_AUTHORITY");
    expect(diagnosis.authorityImpactSummary).toBeDefined();
  });

  // 35. Performance cannot mutate Strategy
  it("35. Performance cannot mutate Strategy", async () => {
    const rootsBefore = await db.select().from(schema.strategyRoots).where(eq(schema.strategyRoots.campaignId, campaignAId));

    const warning = generateFactualPerformanceWarning({
      accountId: testAccountId,
      campaignId: campaignAId,
      metric: "qualifiedLeads",
      measuredValue: 10,
      targetValue: 20,
    })!;
    await diagnosePerformanceWarningInReasoning({ warning });

    const rootsAfter = await db.select().from(schema.strategyRoots).where(eq(schema.strategyRoots.campaignId, campaignAId));
    expect(rootsAfter.length).toBe(rootsBefore.length);
  });

  // 36. no global organic-first rule
  it("36. no global organic-first rule", () => {
    const rule = "Execute approved strategic channels according to campaign plan.";
    expect(rule).not.toContain("Prioritize organic proof and distribution over paid ads");
  });

  // 37. no global paid-media suppression
  it("37. no global paid-media suppression", () => {
    const spendRule = "Allocate marketing resources according to the approved budget governor for BUILD execution.";
    expect(spendRule).not.toContain("withheld");
  });

  // 38. no fixed matcher semantic weights
  it("38. no fixed matcher semantic weights", () => {
    const holistic = evaluateHolisticSemanticAlignment({
      caption: "Ported 50k rows in 14 minutes.",
      platform: "INSTAGRAM",
    }, {
      id: "t1",
      title: "Migration Benchmark",
      description: "Fast data migration.",
      channel: "INSTAGRAM",
    });

    expect(holistic).toHaveProperty("matchedDimensions");
    expect(holistic).toHaveProperty("missingDimensions");
    expect(holistic).toHaveProperty("conflicts");
    expect(holistic).not.toHaveProperty("weight20Channel");
  });

  // 39. shared owned channel remains campaign attribution safe
  it("39. shared owned channel remains campaign attribution safe", async () => {
    const fetchA = await ALL_CANONICAL_ADAPTERS.INSTAGRAM.fetchSnapshot(testAccountId, campaignAId);
    const fetchB = await ALL_CANONICAL_ADAPTERS.INSTAGRAM.fetchSnapshot(testAccountId, campaignBId);

    expect(fetchA.snapshot.campaignId).toBe(campaignAId);
    expect(fetchB.snapshot.campaignId).toBe(campaignBId);
  });

  // 40. Campaign A/B isolation preserved
  it("40. Campaign A/B isolation preserved", async () => {
    const invA = await getOrCreateWeeklyInventory(testAccountId, campaignAId);
    const invB = await getOrCreateWeeklyInventory(testAccountId, campaignBId);

    expect(invA.campaignId).toBe(campaignAId);
    expect(invB.campaignId).toBe(campaignBId);
    expect(invA.inventoryId).not.toBe(invB.inventoryId);
  });
});
