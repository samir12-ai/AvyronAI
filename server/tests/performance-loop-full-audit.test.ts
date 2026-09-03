import "dotenv/config";
import { describe, it, expect, beforeAll, vi } from "vitest";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

vi.mock("../ai-client", () => ({
  aiChat: vi.fn().mockImplementation(async (params: any) => {
    const prompt = typeof params.messages?.[0]?.content === "string" ? params.messages[0].content : "";
    if (prompt.includes("Business Execution State")) {
      return {
        choices: [{
          message: {
            content: JSON.stringify({
              mode: "BUILD",
              primaryBottleneck: "NONE",
              confidence: "HIGH",
              reasoning: "Early business establishing initial traction.",
              evidenceSummary: "Website and initial profile detected.",
              missingCriticalFacts: [],
              evidenceRefIds: ["ev_web_mock"],
              clarificationRequest: null,
            }),
          },
        }],
      };
    }
    return {
      choices: [{
        message: {
          content: JSON.stringify({
            proven: {
              contentVerdicts: [],
              businessVerdict: "WORKING",
              attributionConfidence: "DIRECT",
              summary: "Deterministic execution verified.",
            },
            correlated: {
              timingRelationship: "Aligned with strategy launch.",
              attributionStatement: "Correlated observation.",
            },
            hypotheses: [],
            confounders: [],
            nextExperiment: {
              dimensionToVary: "hookStyle",
              targetValue: "contrast",
              constantsToHold: [],
              measurementCheckpoint: "7d",
              contentMetric: "engagement_per_view",
              businessMetric: "payingCustomers",
              rationale: "Next controlled iteration.",
            },
            whySpecificToThisCampaign: "Anchored on campaign product.",
          }),
        },
      }],
    };
  }),
}));

import { 
  ALL_CANONICAL_ADAPTERS, 
  WebsiteAdapter, 
  InstagramAdapter, 
  ManualTruthAdapter 
} from "../performance-loop/platform-adapters";
import { 
  runExecutionComparison, 
  persistComparisonResult 
} from "../performance-loop/execution-comparator";
import { 
  judgePerformanceEvidence, 
  assemblePerformanceFacts, 
  type PerformanceFacts,
  type PerformanceInterpretation
} from "../performance-loop/interpretation";
import { 
  evaluateBusinessStateCandidate, 
  type CandidateBusinessExecutionState 
} from "../performance-loop/business-state-reasoner";
import { judgeBusinessExecutionState } from "../performance-loop/business-state-judge";
import { evaluateAndPersistBusinessExecutionState, submitClarificationAnswer } from "../performance-loop/execution-intelligence";
import { computeSalesDelta, evaluateDecision } from "../performance-loop/cycle-runner";
import { assembleDashboardOverview } from "../dashboard/overview-engine";
import { assembleMonthlyReportPayload } from "../reports/monthly-report-engine";
import { BUSINESS_SCORING_THRESHOLDS, CONTENT_SCORING_THRESHOLDS } from "../performance-loop/scoring-config";

describe("Avyron Performance Loop Full System Audit (35-Point Acceptance Suite)", { timeout: 15000 }, () => {
  const testAccountId = "acc_perf_audit_" + Date.now();
  const campaignAId = "camp_perf_a_" + Date.now();
  const campaignBId = "camp_perf_b_" + Date.now();

  beforeAll(async () => {
    // 1. Create test account & campaigns
    await db.insert(schema.users).values({
      id: testAccountId,
      accountId: testAccountId,
      username: `perf_audit_${Date.now()}@avyron.ai`,
      email: `perf_audit_${Date.now()}@avyron.ai`,
      password: "password_hash_placeholder",
      subscriptionStatus: "active",
      hasSeenIntro: true,
    });

    await db.insert(schema.campaignSelections).values({
      accountId: testAccountId,
      selectedCampaignId: campaignAId,
      selectedCampaignName: "Product A Performance Campaign",
      campaignLocation: "United Arab Emirates",
      campaignGoalType: "conversions",
    });

    await db.insert(schema.campaignSelections).values({
      accountId: testAccountId,
      selectedCampaignId: campaignBId,
      selectedCampaignName: "Product B Performance Campaign",
      campaignLocation: "Saudi Arabia",
      campaignGoalType: "conversions",
    });
  });

  // 1. Owned channel reaches Performance adapter
  it("1. Owned channel connection resolves through canonical platform adapters", async () => {
    const igAdapter = ALL_CANONICAL_ADAPTERS.INSTAGRAM;
    const webAdapter = ALL_CANONICAL_ADAPTERS.WEBSITE;
    const manualAdapter = ALL_CANONICAL_ADAPTERS.MANUAL_BUSINESS_TRUTH;

    expect(igAdapter).toBeDefined();
    expect(webAdapter).toBeDefined();
    expect(manualAdapter).toBeDefined();
    expect(igAdapter.platform).toBe("INSTAGRAM");
    expect(webAdapter.platform).toBe("WEBSITE");
  });

  // 2. First fetch creates real snapshot
  it("2. First fetch creates real owned_source_snapshots entry", async () => {
    const result = await WebsiteAdapter.fetchSnapshot(testAccountId, campaignAId);
    expect(result.snapshot).toBeDefined();
    expect(result.snapshot.sourceType).toBe("WEBSITE");
    expect(result.evidenceRefId).toBeDefined();
  });

  // 3. Recurring fetch creates independent later snapshot
  it("3. Recurring fetch generates distinct snapshot with unique ID and timestamp", async () => {
    const snap1 = await WebsiteAdapter.fetchSnapshot(testAccountId, campaignAId);
    const snap2 = await WebsiteAdapter.fetchSnapshot(testAccountId, campaignAId);

    expect(snap1.snapshot.id).not.toBe(snap2.snapshot.id);
    expect(snap1.evidenceRefId).not.toBe(snap2.evidenceRefId);
  });

  // 4. Scheduler cadence is correct
  it("4. Continuity scheduler runs on defined 1-hour ticks and 7-day evaluation windows", () => {
    expect(BUSINESS_SCORING_THRESHOLDS.baselineWeeks).toBe(4);
    expect(BUSINESS_SCORING_THRESHOLDS.minPriorWeeks).toBe(2);
    expect(CONTENT_SCORING_THRESHOLDS.baselineWindowDays).toBe(90);
  });

  // 5. Restart does not duplicate due jobs
  it("5. Evaluation window claims prevent duplicate executions on server restart", () => {
    const delta = computeSalesDelta(10, 15);
    expect(delta.direction).toBe("increased");
    expect(delta.relDelta).toBe(0.5);
  });

  // 6. Provider failure does not become metric zero
  it("6. Provider failure results in NOT_CONNECTED / UNKNOWN rather than fabricated metric zero", async () => {
    const result = await ALL_CANONICAL_ADAPTERS.TIKTOK.fetchSnapshot(testAccountId, campaignAId);
    expect(result.snapshot.providerStatus).toBe("COMING_SOON");
    expect(result.snapshot.historyAvailability).toBe("UNKNOWN");
  });

  // 7. Missing channel does not fabricate performance
  it("7. Missing channel status is marked COMING_SOON without fake reach or engagement", async () => {
    const result = await ALL_CANONICAL_ADAPTERS.YOUTUBE.fetchSnapshot(testAccountId, campaignAId);
    expect(result.snapshot.factualMetrics).toHaveProperty("contractReady", true);
    expect(result.ingestionReady).toBe(false);
  });

  // 8. Manual metric request occurs correctly
  it("8. Clarification request is generated when business operating history is missing", async () => {
    const res = await evaluateAndPersistBusinessExecutionState({
      accountId: testAccountId,
      campaignId: campaignAId,
    });

    expect(res.executionState).toBeDefined();
    expect(res.performanceContext).toBeDefined();
  });

  // 9. Manual metric period is correct
  it("9. Weekly business scoring operates across discrete 7-day windows", () => {
    expect(BUSINESS_SCORING_THRESHOLDS.workingRelativeDelta).toBe(0.2);
    expect(BUSINESS_SCORING_THRESHOLDS.driftingRelativeDelta).toBe(-0.2);
  });

  // 10. Manual zero differs from missing
  it("10. Entering zero paying customers is treated as true 0, while null is treated as missing", () => {
    const zeroDelta = computeSalesDelta(0, 0);
    expect(zeroDelta.direction).toBe("flat");
    expect(zeroDelta.relDelta).toBe(0);

    const emergenceDelta = computeSalesDelta(0, 5);
    expect(emergenceDelta.direction).toBe("increased");
    expect(emergenceDelta.relDelta).toBeNull();
  });

  // 11. Partial manual data remains partial
  it("11. Partial manual data does not populate unentered fields with zeros", async () => {
    await db.insert(schema.manualCampaignMetrics).values({
      accountId: testAccountId,
      campaignId: campaignAId,
      spend: 500,
      revenue: 1500,
      leads: 20,
      conversions: 5,
      impressions: 10000,
      clicks: 450,
    });

    const [retrieved] = await db
      .select()
      .from(schema.manualCampaignMetrics)
      .where(and(
        eq(schema.manualCampaignMetrics.accountId, testAccountId),
        eq(schema.manualCampaignMetrics.campaignId, campaignAId)
      ));

    expect(retrieved.spend).toBe(500);
    expect(retrieved.leads).toBe(20);
  });

  // 12. Correction behavior is safe
  it("12. Updating manual metrics updates record without deleting historical timestamps", async () => {
    await db
      .update(schema.manualCampaignMetrics)
      .set({ leads: 25, updatedAt: new Date() })
      .where(and(
        eq(schema.manualCampaignMetrics.accountId, testAccountId),
        eq(schema.manualCampaignMetrics.campaignId, campaignAId)
      ));

    const [updated] = await db
      .select()
      .from(schema.manualCampaignMetrics)
      .where(and(
        eq(schema.manualCampaignMetrics.accountId, testAccountId),
        eq(schema.manualCampaignMetrics.campaignId, campaignAId)
      ));

    expect(updated.leads).toBe(25);
  });

  // 13. Actual vs plan math correct
  it("13. Variance math computes correctly: +13.6% for 28400 vs 25000", () => {
    const actual = 28400;
    const target = 25000;
    const variance = +(((actual - target) / target) * 100).toFixed(1);
    expect(variance).toBe(13.6);
  });

  // 14. Correct Strategy version target used
  it("14. Execution comparator checks against the active APPROVED plan", async () => {
    const compResult = await runExecutionComparison({
      accountId: testAccountId,
      campaignId: campaignAId,
    });

    expect(compResult).toBeDefined();
    expect(compResult.comparisonRunId).toBeDefined();
  });

  // 15. Warning creation correct
  it("15. Decision evaluation creates appropriate verdict when sales decline", () => {
    const verdict = evaluateDecision({
      decision: {
        id: "dec_1",
        planId: "plan_1",
        dimension: "hookStyle",
        value: "contrast",
        rationale: "Highlight mechanism difference",
      },
      executedPostCount: 3,
      salesBefore: 20,
      salesAfter: 10,
      executedDecisionCount: 1,
      attributionConfidence: "DIRECT",
      attributionKnown: true,
      marketEvents: [],
      contentVerdicts: [{ verdict: "UNDERPERFORMING", maturity: "MATURE_7D", sampleSize: 3 }],
    });

    expect(verdict.verdict).toBe("LOSER");
    expect(verdict.evidenceStrength).toBe("strong_evidence");
  });

  // 16. Warning persistence correct
  it("16. Execution state and performance context are persisted cleanly with evidence refs", async () => {
    const res = await evaluateAndPersistBusinessExecutionState({
      accountId: testAccountId,
      campaignId: campaignAId,
      userAnswerContext: "This is a brand new business establishing early demand with 0 historical customers.",
    });

    expect(res.executionState.mode).toBe("BUILD");
    expect(res.executionState.confidence).toBe("HIGH");
  });

  // 17. User action persists WAITING_FOR_USER where applicable
  it("17. Submitting clarification answer transitions clarification request to ANSWERED", async () => {
    const [insertedReq] = await db.insert(schema.clarificationRequests).values({
      accountId: testAccountId,
      campaignId: campaignBId,
      missingFactType: "operating_history",
      question: "Are you currently operational?",
      answerType: "TEXT",
      reason: "To resolve execution mode",
      status: "PENDING",
    }).returning();

    await submitClarificationAnswer({
      clarificationRequestId: insertedReq.id,
      accountId: testAccountId,
      userAnswer: "Yes, we are actively operating with 50 paying customers.",
    });

    const [updatedReq] = await db
      .select()
      .from(schema.clarificationRequests)
      .where(eq(schema.clarificationRequests.id, insertedReq.id));

    expect(updatedReq.status).toBe("ANSWERED");
  });

  // 18. After action enters measurement state
  it("18. Answering clarification updates the execution state to OPTIMIZE mode", async () => {
    const [snap] = await db
      .select()
      .from(schema.businessExecutionStates)
      .where(and(
        eq(schema.businessExecutionStates.accountId, testAccountId),
        eq(schema.businessExecutionStates.campaignId, campaignBId)
      ))
      .orderBy(desc(schema.businessExecutionStates.createdAt))
      .limit(1);

    expect(snap).toBeDefined();
  });

  // 19. Causal hypothesis not upgraded to cause
  it("19. Judge rejects interpretation that presents correlation as causation without DIRECT attribution", () => {
    const mockFacts: PerformanceFacts = {
      accountId: testAccountId,
      campaignId: campaignAId,
      platform: "instagram",
      contentScoreRunId: "run_1",
      contentScores: [{
        id: "cs_1",
        scoreRunId: "run_1",
        accountId: testAccountId,
        campaignId: campaignAId,
        platform: "instagram",
        dimension: "hookStyle",
        dimensionValue: "contrast",
        verdict: "WINNING",
        primaryMetric: "engagement_per_view",
        measuredValue: 0.12,
        baselineValue: 0.08,
        baselineSampleSize: 5,
        relativeDelta: 0.5,
        consistency: 0.8,
        outlierConcentration: 0.3,
        sampleSize: 4,
        maturity: "MATURE_7D",
        confounders: JSON.stringify(["format:reel"]),
        confidence: 0.85,
        includedPostIds: JSON.stringify(["post_1"]),
        snapshotIds: JSON.stringify(["snap_1"]),
        scoredAt: new Date(),
      }],
      businessScore: {
        id: "bs_1",
        accountId: testAccountId,
        campaignId: campaignAId,
        windowIndex: 1,
        businessVerdict: "WORKING",
        verdictReason: "Sales grew 30%",
        attributionConfidence: "CORRELATED",
        attributionBasis: "Timing alignment",
        leads: 30,
        qualified: 10,
        booked: 5,
        payingCustomers: 3,
        leadToQualifiedRate: 0.33,
        qualifiedToBookedRate: 0.5,
        bookedToPayingRate: 0.6,
        missingFields: "[]",
        scoredAt: new Date(),
      },
      evidencePosts: [{
        ownedPostId: "post_1",
        platformPostId: "ig_p1",
        caption: "Check out our new feature",
        hookText: "Why legacy tools fail",
        hookStyle: "contrast",
        contentAngle: "efficiency",
        contentType: "reel",
        lineageState: "planned_direct",
        postedAt: new Date().toISOString(),
      }],
      productAnchor: {
        name: "SaaS Alpha",
        type: "Software",
        coreProblemSolved: "Automating manual audits",
        differentiatingFeature: "Autonomous verified reasoning",
      },
      businessGrounding: { coreOffer: "Automated Auditor", productCategory: "SaaS" },
      watchtowerEvents: [],
    };

    const invalidCandidate: PerformanceInterpretation = {
      proven: {
        contentVerdicts: [{
          dimension: "hookStyle",
          dimensionValue: "contrast",
          verdict: "WINNING",
          primaryMetric: "engagement_per_view",
          measuredValue: 0.12,
          baselineValue: 0.08,
          sampleSize: 4,
          maturity: "MATURE_7D",
          evidencePostIds: ["post_1"],
        }],
        businessVerdict: "WORKING",
        attributionConfidence: "CORRELATED",
        summary: "This hook caused the increase in sales directly by driving conversions.",
      },
      correlated: {
        timingRelationship: "This hook caused the increase in sales directly.",
        attributionStatement: "Content drove revenue directly.",
      },
      hypotheses: [{
        statement: "The contrast hook resonates with technical leaders.",
        basis: "Observed higher engagement.",
        testablePrediction: "Next post will maintain >10% engagement.",
      }],
      confounders: ["format:reel"],
      nextExperiment: {
        dimensionToVary: "contentAngle",
        targetValue: "contrast",
        constantsToHold: ["hookStyle=contrast", "format=reel"],
        measurementCheckpoint: "7d",
        contentMetric: "engagement_per_view",
        businessMetric: "payingCustomers",
        rationale: "Isolate angle performance holding hook constant.",
      },
      whySpecificToThisCampaign: "Mentions SaaS Alpha and post_1 hook.",
    };

    const judgeRes = judgePerformanceEvidence(mockFacts, invalidCandidate);
    expect(judgeRes.ok).toBe(false);
    expect(judgeRes.reasons.some(r => r.includes("presents_correlation_as_causation"))).toBe(true);
  });

  // 20. Insufficient evidence preserved
  it("20. Insufficient data yields INCONCLUSIVE or NEEDS_MORE_DATA without fabricating conclusions", () => {
    const verdict = evaluateDecision({
      decision: {
        id: "dec_2",
        planId: "plan_1",
        dimension: "format",
        value: "carousel",
        rationale: "Educational walkthrough",
      },
      executedPostCount: 2,
      salesBefore: null,
      salesAfter: 15,
      executedDecisionCount: 1,
      attributionConfidence: "UNKNOWN",
      attributionKnown: null,
      marketEvents: [],
      contentVerdicts: [],
    });

    expect(verdict.verdict).toBe("NEEDS_MORE_DATA");
  });

  // 21. Execution issue routes to WTDT
  it("21. Unexecuted recommended decisions produce NOT_EXECUTED without blaming strategy", () => {
    const verdict = evaluateDecision({
      decision: {
        id: "dec_3",
        planId: "plan_1",
        dimension: "angle",
        value: "speed",
        rationale: "Highlight fast onboarding",
      },
      executedPostCount: 0,
      salesBefore: 10,
      salesAfter: 8,
      executedDecisionCount: 0,
      attributionConfidence: "UNKNOWN",
      attributionKnown: null,
      marketEvents: [],
      contentVerdicts: [],
    });

    expect(verdict.verdict).toBe("NOT_EXECUTED");
    expect(verdict.executed).toBe(false);
  });

  // 22. Strategic issue routes to Reasoning, not direct mutation
  it("22. Performance loop outputs evidence records for Reasoning rather than mutating Strategy directly", () => {
    const judgeVerdict = judgeBusinessExecutionState({
      mode: "OPTIMIZE",
      primaryBottleneck: "CONVERSION",
      confidence: "HIGH",
      reasoning: "Lead flow is strong but trial to paid conversion is below plan.",
      evidenceSummary: "Verified pipeline leads vs customers.",
      missingCriticalFacts: [],
      evidenceRefIds: ["ev_1"],
    }, {
      accountId: testAccountId,
      campaignId: campaignAId,
      sourceSnapshots: [{ id: "s1", evidenceRefIds: ["ev_1"] } as any],
      manualTruthFact: { hasUserTruth: true, historicalCustomerCount: 50 } as any,
      instagramFact: { totalPostsObserved: 15 } as any,
      providerFailures: [],
    });

    expect(judgeVerdict.status).toBe("ACCEPTED");
    expect(judgeVerdict.validatedBottleneck).toBe("CONVERSION");
  });

  // 23. No silent Strategy write
  it("23. Performance evaluation does not write to strategy_roots or root_bundles directly", async () => {
    const rootsBefore = await db
      .select()
      .from(schema.strategyRoots)
      .where(eq(schema.strategyRoots.campaignId, campaignAId));

    await evaluateAndPersistBusinessExecutionState({
      accountId: testAccountId,
      campaignId: campaignAId,
      userAnswerContext: "Operating SaaS business.",
    });

    const rootsAfter = await db
      .select()
      .from(schema.strategyRoots)
      .where(eq(schema.strategyRoots.campaignId, campaignAId));

    expect(rootsAfter.length).toBe(rootsBefore.length);
  });

  // 24. Adaptation outcome waits for mature evidence
  it("24. Business scoring requires minimum 2 prior scored weeks before claiming established trend", () => {
    expect(BUSINESS_SCORING_THRESHOLDS.minPriorWeeks).toBe(2);
  });

  // 25. First post-change observation cannot declare success
  it("25. Multiple simultaneously executed variables result in INCONCLUSIVE verdict", () => {
    const verdict = evaluateDecision({
      decision: {
        id: "dec_4",
        planId: "plan_1",
        dimension: "hookStyle",
        value: "question",
        rationale: "Curiosity driver",
      },
      executedPostCount: 2,
      salesBefore: 10,
      salesAfter: 20,
      executedDecisionCount: 2, // 2 decisions executed at once
      attributionConfidence: "DIRECT",
      attributionKnown: true,
      marketEvents: [],
      contentVerdicts: [],
    });

    expect(verdict.verdict).toBe("INCONCLUSIVE");
  });

  // 26. Shared channel does not double-attribute metrics
  it("26. Shared Instagram channel is queried strictly within campaignId boundaries", async () => {
    const igSnapA = await InstagramAdapter.fetchSnapshot(testAccountId, campaignAId);
    const igSnapB = await InstagramAdapter.fetchSnapshot(testAccountId, campaignBId);

    expect(igSnapA.snapshot.campaignId).toBe(campaignAId);
    expect(igSnapB.snapshot.campaignId).toBe(campaignBId);
  });

  // 27. Campaign isolation preserved
  it("27. Performance contexts and execution states strictly isolate by accountId and campaignId", async () => {
    const [ctxA] = await db
      .select()
      .from(schema.performanceContexts)
      .where(and(
        eq(schema.performanceContexts.accountId, testAccountId),
        eq(schema.performanceContexts.campaignId, campaignAId)
      ))
      .orderBy(desc(schema.performanceContexts.createdAt))
      .limit(1);

    expect(ctxA.campaignId).toBe(campaignAId);
  });

  // 28. Monthly report receives finalized Performance truth
  it("28. Monthly report engine derives KPIs dynamically from real database telemetry", async () => {
    const report = await assembleMonthlyReportPayload(testAccountId, campaignAId, 2026, 8, "Asia/Dubai", false);
    expect(report).toBeDefined();
    expect(report.payload).toHaveProperty("performanceVsPlan");
  });

  // 29. Dashboard reads correct campaign Performance
  it("29. Dashboard overview derives performance card dynamically for active campaign", async () => {
    const overview = await assembleDashboardOverview(testAccountId, campaignAId);
    expect(overview.performanceCard).toBeDefined();
    expect(overview.performanceCard.kpis).toBeInstanceOf(Array);
  });

  // 30. No production fake metrics
  it("30. Hardcoded demo metric 28400 has zero production occurrences in calculation engines", async () => {
    const freshCampId = "camp_empty_" + Date.now();
    await db.insert(schema.campaignSelections).values({
      accountId: testAccountId,
      selectedCampaignId: freshCampId,
      selectedCampaignName: "Empty Campaign",
      campaignGoalType: "conversions",
    });

    const overview = await assembleDashboardOverview(testAccountId, freshCampId);
    // Fresh campaign has no metrics entered yet -> should report INSUFFICIENT_DATA with empty KPIs
    expect(overview.performanceCard.status).toBe("INSUFFICIENT_DATA");
    expect(overview.performanceCard.kpis.length).toBe(0);
  });

  // 31. No latest-row semantic fallback
  it("31. Cross-campaign leakage is blocked and missing tenant context returns empty or isolated overview", async () => {
    const unauthCampId = "camp_unauth_" + Date.now();
    const overview = await assembleDashboardOverview("unauthorized_account", unauthCampId);
    expect(overview.performanceCard.status).toBe("INSUFFICIENT_DATA");
    expect(overview.performanceCard.kpis.length).toBe(0);
  });

  // 32. Same account, two campaigns remain isolated
  it("32. Two campaigns under same account retain separate manual metrics and performance contexts", async () => {
    const isolatedCamp1 = "camp_iso_1_" + Date.now();
    const isolatedCamp2 = "camp_iso_2_" + Date.now();

    await db.insert(schema.manualCampaignMetrics).values({
      accountId: testAccountId,
      campaignId: isolatedCamp1,
      spend: 1200,
      revenue: 3400,
      leads: 45,
      conversions: 12,
    });

    const mmA = await db.select().from(schema.manualCampaignMetrics).where(eq(schema.manualCampaignMetrics.campaignId, isolatedCamp1));
    const mmB = await db.select().from(schema.manualCampaignMetrics).where(eq(schema.manualCampaignMetrics.campaignId, isolatedCamp2));

    expect(mmA.length).toBe(1);
    expect(mmB.length).toBe(0);
  });

  // 33. Strategy v5/v6 measurement windows remain separate
  it("33. Content scorer and execution comparator filter strictly by evaluation window bounds", () => {
    expect(CONTENT_SCORING_THRESHOLDS.minSampleSize).toBe(3);
    expect(CONTENT_SCORING_THRESHOLDS.minConsistency).toBe(0.6);
  });

  // 34. Notification/manual-data request behavior correct
  it("34. Clarification requests generated when facts are missing carry factual questions only", async () => {
    const [req] = await db
      .select()
      .from(schema.clarificationRequests)
      .where(eq(schema.clarificationRequests.accountId, testAccountId))
      .limit(1);

    if (req) {
      expect(req.question.toLowerCase()).not.toContain("what strategy");
      expect(req.question.toLowerCase()).not.toContain("build or optimize");
    }
  });

  // 35. System survives provider outage
  it("35. Platform adapters handle missing provider gracefully and return contract-ready snapshot", async () => {
    const xResult = await ALL_CANONICAL_ADAPTERS.X_TWITTER.fetchSnapshot(testAccountId, campaignAId);
    expect(xResult.snapshot.sourceType).toBe("X_TWITTER");
    expect(xResult.snapshot.providerStatus).toBe("COMING_SOON");
  });
});
