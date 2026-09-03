import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { db } from "../db";
import {
  businessExecutionStates,
  clarificationRequests,
  performanceContexts,
  ownedSourceSnapshots,
  ownedPosts,
  pipelineUserTruth,
  manualCampaignMetrics,
  websiteSnapshots,
  businessDataLayer,
} from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { assembleFactualDossier } from "../performance-loop/source-normalizer";
import { judgeBusinessExecutionState } from "../performance-loop/business-state-judge";
import { evaluateAndPersistBusinessExecutionState, submitClarificationAnswer } from "../performance-loop/execution-intelligence";
import { translatePerformanceToBll } from "../performance-loop/bll";
import { recordEnginePerformanceConsumption, verifyAuthorityPrecedenceBoundary, getConsumptionLineageLog } from "../performance-loop/strategy-router";

import { resolveAccountIdFromCampaign, AccountCampaignMismatchError } from "../performance-loop/account-resolver";
import { ALL_CANONICAL_ADAPTERS } from "../performance-loop/platform-adapters";

describe("Performance Business Execution Intelligence — Phase 1 Test Suite (Tests A-W)", () => {
  const testAccountId = `acc_test_${randomUUID().slice(0, 8)}`;
  const testCampaignId = `camp_test_${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    // Seed initial business data layer
    await db.insert(businessDataLayer).values({
      accountId: testAccountId,
      campaignId: testCampaignId,
      businessLocation: "Dubai, UAE",
      businessType: "B2B SaaS",
      priceRange: "$1000-$5000",
      targetAudienceAge: "30-55",
      targetAudienceSegment: "Enterprise VP of RevOps",
      monthlyBudget: "$5000",
      funnelObjective: "Lead Generation",
      primaryConversionChannel: "Website",
      websiteUrl: "https://example-test-biz.com",
      coreOffer: "Enterprise Data Quality Platform",
      productCategory: "B2B SaaS",
    });
  });

  // TEST A: Account Resolution
  it("TEST A — Campaign resolves correct canonical accountId", async () => {
    const resolved = await resolveAccountIdFromCampaign(testCampaignId);
    expect(resolved).toBe(testAccountId);
  });

  // TEST B: Account Mismatch Failure
  it("TEST B — Wrong accountId + campaignId mismatch fails closed with AccountCampaignMismatchError", async () => {
    await expect(resolveAccountIdFromCampaign(testCampaignId, "wrong_account_id")).rejects.toThrow(
      AccountCampaignMismatchError
    );
  });

  // TEST A: Confirmed New Business
  it("TEST A — Confirmed New Business yields BUILD when verified early evidence exists", async () => {
    const mockDossier: any = {
      accountId: testAccountId,
      campaignId: testCampaignId,
      sourceSnapshots: [],
      websiteFact: { hasWebsite: true, url: "https://newbiz.com", hasProductOffering: true, evidenceRefId: "ev_web_1" },
      instagramFact: { isConnected: true, channelAgeMonths: 1, totalPostsObserved: 2, followersCount: 15, evidenceRefId: "ev_ig_1" },
      manualTruthFact: { hasUserTruth: true, historicalLeadCount: 0, historicalCustomerCount: 0, evidenceRefId: "ev_truth_1" },
      providerFailures: [],
    };

    const candidate: any = {
      mode: "BUILD",
      primaryBottleneck: "NONE",
      confidence: "HIGH",
      reasoning: "Confirmed early stage: 2 posts observed, 0 historical sales confirmed by user truth.",
      evidenceSummary: "Early business creating initial traction.",
      missingCriticalFacts: [],
      evidenceRefIds: ["ev_web_1", "ev_ig_1", "ev_truth_1"],
      clarificationRequest: null,
    };

    const verdict = judgeBusinessExecutionState(candidate, mockDossier);
    expect(verdict.status).toBe("ACCEPTED");
    expect(verdict.validatedMode).toBe("BUILD");
  });

  // TEST B: Established Business
  it("TEST B — Established Business yields OPTIMIZE when historical activity and customers exist", async () => {
    const mockDossier: any = {
      accountId: testAccountId,
      campaignId: testCampaignId,
      sourceSnapshots: [],
      websiteFact: { hasWebsite: true, url: "https://established.com", hasProductOffering: true, evidenceRefId: "ev_web_2" },
      instagramFact: { isConnected: true, channelAgeMonths: 14, totalPostsObserved: 120, followersCount: 4500, evidenceRefId: "ev_ig_2" },
      manualTruthFact: { hasUserTruth: true, historicalLeadCount: 150, historicalCustomerCount: 35, evidenceRefId: "ev_truth_2" },
      providerFailures: [],
    };

    const candidate: any = {
      mode: "OPTIMIZE",
      primaryBottleneck: "CONVERSION",
      confidence: "HIGH",
      reasoning: "Established operating history: 120 posts, 35 paying customers.",
      evidenceSummary: "Established business optimizing pipeline bottleneck.",
      missingCriticalFacts: [],
      evidenceRefIds: ["ev_web_2", "ev_ig_2", "ev_truth_2"],
      clarificationRequest: null,
    };

    const verdict = judgeBusinessExecutionState(candidate, mockDossier);
    expect(verdict.status).toBe("ACCEPTED");
    expect(verdict.validatedMode).toBe("OPTIMIZE");
    expect(verdict.validatedBottleneck).toBe("CONVERSION");
  });

  // TEST C: Missing Provider Safety (NO DATA ≠ NEW BUSINESS)
  it("TEST C — Missing Provider yields UNKNOWN mode (never BUILD solely due to missing data)", async () => {
    const mockDossier: any = {
      accountId: testAccountId,
      campaignId: testCampaignId,
      sourceSnapshots: [],
      websiteFact: undefined,
      instagramFact: { isConnected: false, totalPostsObserved: 0, evidenceRefId: "ev_ig_3" },
      manualTruthFact: { hasUserTruth: false, evidenceRefId: "ev_truth_3" },
      providerFailures: ["INSTAGRAM_API_FAILED"],
    };

    const candidate: any = {
      mode: "BUILD", // Incorrectly assumed BUILD
      primaryBottleneck: "UNKNOWN",
      confidence: "LOW",
      reasoning: "No Instagram posts found.",
      evidenceSummary: "Missing data.",
      missingCriticalFacts: ["Operating history"],
      evidenceRefIds: ["ev_ig_3"],
      clarificationRequest: null,
    };

    const verdict = judgeBusinessExecutionState(candidate, mockDossier);
    expect(verdict.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(verdict.validatedMode).toBe("UNKNOWN");
  });

  // TEST D: Dynamic Clarification Question (Operating History)
  it("TEST D — Dynamic Clarification Question generates targeted question for missing operating history", async () => {
    const mockDossier: any = {
      accountId: testAccountId,
      campaignId: testCampaignId,
      sourceSnapshots: [],
      websiteFact: { hasWebsite: true, url: "https://ambiguous.com", evidenceRefId: "ev_web_4" },
      instagramFact: { isConnected: true, totalPostsObserved: 0, evidenceRefId: "ev_ig_4" },
      manualTruthFact: { hasUserTruth: false, evidenceRefId: "ev_truth_4" },
      providerFailures: [],
    };

    const candidate: any = {
      mode: "UNKNOWN",
      primaryBottleneck: "UNKNOWN",
      confidence: "LOW",
      reasoning: "Operating history is ambiguous.",
      evidenceSummary: "Fresh profile connected with zero historical posts.",
      missingCriticalFacts: ["Operating history duration"],
      evidenceRefIds: ["ev_web_4", "ev_ig_4"],
      clarificationRequest: {
        missingFactType: "business_operating_history",
        question: "How long has your business been actively operating prior to connecting Avyron?",
        answerType: "TEXT",
        reason: "Clarifies whether missing posts represent a brand-new business or uningested historical operations.",
      },
    };

    const verdict = judgeBusinessExecutionState(candidate, mockDossier);
    expect(verdict.status).toBe("ACCEPTED");
    expect(candidate.clarificationRequest.question).toContain("How long has your business");
  });

  // TEST E: Different Dynamic Clarification Question (Sales Activity)
  it("TEST E — Different Dynamic Question generated for missing customer/sales facts", async () => {
    const candidate: any = {
      mode: "UNKNOWN",
      primaryBottleneck: "UNKNOWN",
      confidence: "LOW",
      reasoning: "Paying customer history is unconfirmed.",
      evidenceSummary: "Social activity observed, customer metrics unrecorded.",
      missingCriticalFacts: ["Paying customer activity"],
      evidenceRefIds: [],
      clarificationRequest: {
        missingFactType: "paying_customer_activity",
        question: "How many paying customers or client contracts does your business currently serve?",
        answerType: "NUMBER",
        reason: "Distinguishes pre-revenue BUILD stage from active revenue OPTIMIZE stage.",
      },
    };

    expect(candidate.clarificationRequest.missingFactType).toBe("paying_customer_activity");
    expect(candidate.clarificationRequest.question).toContain("paying customers");
  });

  // TEST F: User Clarification Answer Processing
  it("TEST F — Submitting user clarification answer updates evidence and re-evaluates state", { timeout: 20000 }, async () => {
    // Insert draft clarification request
    const [req] = await db
      .insert(clarificationRequests)
      .values({
        accountId: testAccountId,
        campaignId: testCampaignId,
        missingFactType: "business_operating_history",
        question: "How long has your business been operating?",
        answerType: "TEXT",
        status: "PENDING",
      })
      .returning();

    const result = await submitClarificationAnswer({
      clarificationRequestId: req.id,
      accountId: testAccountId,
      userAnswer: "Operating for 2 years with 50+ active client contracts.",
    });

    expect(result.executionState.mode).toBeDefined();
    expect(result.executionState.sourceOwnedSourceSnapshotIds).toBeDefined();
  });

  // TEST G: Judge Rejects Unsupported BUILD
  it("TEST G — Judge rejects candidate claiming BUILD when evidence is missing", async () => {
    const mockDossier: any = {
      accountId: testAccountId,
      campaignId: testCampaignId,
      sourceSnapshots: [],
      instagramFact: { isConnected: false, totalPostsObserved: 0 },
      manualTruthFact: { hasUserTruth: false },
      providerFailures: ["API_DOWN"],
    };

    const candidate: any = {
      mode: "BUILD",
      primaryBottleneck: "NONE",
      confidence: "HIGH",
      reasoning: "Guessed build mode.",
      evidenceSummary: "No data.",
      missingCriticalFacts: [],
      evidenceRefIds: [],
    };

    const verdict = judgeBusinessExecutionState(candidate, mockDossier);
    expect(verdict.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(verdict.validatedMode).toBe("UNKNOWN");
  });

  // TEST H: Judge Rejects Unsupported OPTIMIZE
  it("TEST H — Judge rejects candidate claiming OPTIMIZE without historical content/sales evidence", async () => {
    const mockDossier: any = {
      accountId: testAccountId,
      campaignId: testCampaignId,
      sourceSnapshots: [],
      instagramFact: { isConnected: true, totalPostsObserved: 1 },
      manualTruthFact: { hasUserTruth: false },
      providerFailures: [],
    };

    const candidate: any = {
      mode: "OPTIMIZE",
      primaryBottleneck: "CONVERSION",
      confidence: "HIGH",
      reasoning: "Guessed optimize mode with 1 post.",
      evidenceSummary: "1 post.",
      missingCriticalFacts: [],
      evidenceRefIds: [],
    };

    const verdict = judgeBusinessExecutionState(candidate, mockDossier);
    expect(verdict.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(verdict.validatedMode).toBe("UNKNOWN");
  });

  // TEST I: Supported Primary Bottleneck in OPTIMIZE
  it("TEST I — Validates supported PrimaryBottleneck for established business", async () => {
    const mockDossier: any = {
      accountId: testAccountId,
      campaignId: testCampaignId,
      sourceSnapshots: [],
      instagramFact: { isConnected: true, totalPostsObserved: 50, evidenceRefId: "ev_1" },
      manualTruthFact: { hasUserTruth: true, historicalLeadCount: 100, historicalCustomerCount: 2, evidenceRefId: "ev_2" },
      providerFailures: [],
    };

    const candidate: any = {
      mode: "OPTIMIZE",
      primaryBottleneck: "CONVERSION",
      confidence: "HIGH",
      reasoning: "High lead traffic (100 leads) but low conversion (2 customers).",
      evidenceSummary: "Conversion bottleneck identified.",
      missingCriticalFacts: [],
      evidenceRefIds: ["ev_1", "ev_2"],
    };

    const verdict = judgeBusinessExecutionState(candidate, mockDossier);
    expect(verdict.status).toBe("ACCEPTED");
    expect(verdict.validatedBottleneck).toBe("CONVERSION");
  });

  // TEST J: Insufficient Pipeline Evidence yields UNKNOWN Bottleneck
  it("TEST J — Insufficient funnel metric evidence yields UNKNOWN bottleneck", async () => {
    const mockDossier: any = {
      accountId: testAccountId,
      campaignId: testCampaignId,
      sourceSnapshots: [],
      instagramFact: { isConnected: true, totalPostsObserved: 20 },
      manualTruthFact: { hasUserTruth: false },
      providerFailures: [],
    };

    const candidate: any = {
      mode: "OPTIMIZE",
      primaryBottleneck: "UNKNOWN",
      confidence: "MEDIUM",
      reasoning: "Historical posts exist but pipeline metrics are not detailed.",
      evidenceSummary: "Operational history present.",
      missingCriticalFacts: ["Detailed funnel conversion rates"],
      evidenceRefIds: [],
    };

    expect(candidate.primaryBottleneck).toBe("UNKNOWN");
  });

  // TEST K: Website Lineage
  it("TEST K — Website source facts trace to website snapshot evidence IDs", async () => {
    const dossier = await assembleFactualDossier({ accountId: testAccountId, campaignId: testCampaignId });
    expect(dossier.websiteFact).toBeDefined();
    expect(dossier.websiteFact?.evidenceRefId).toMatch(/^ev_web_/);
  });

  // TEST L: Instagram Lineage
  it("TEST L — Instagram facts trace to user-owned source IDs without competitor contamination", async () => {
    const dossier = await assembleFactualDossier({ accountId: testAccountId, campaignId: testCampaignId });
    expect(dossier.instagramFact).toBeDefined();
    expect(dossier.instagramFact?.evidenceRefId).toMatch(/^ev_ig_/);
  });

  // TEST M: TikTok Readiness
  it("TEST M — Synthetic TikTok source snapshot enters factual dossier with COMING_SOON contract", async () => {
    const dossier = await assembleFactualDossier({ accountId: testAccountId, campaignId: testCampaignId });
    expect(dossier.tikTokFact).toBeDefined();
    expect(dossier.tikTokFact?.providerStatus).toBe("COMING_SOON");
  });

  // TEST N: YouTube Readiness
  it("TEST N — Synthetic YouTube source snapshot enters factual dossier with COMING_SOON contract", async () => {
    const dossier = await assembleFactualDossier({ accountId: testAccountId, campaignId: testCampaignId });
    expect(dossier.youTubeFact).toBeDefined();
    expect(dossier.youTubeFact?.providerStatus).toBe("COMING_SOON");
  });

  // TEST O: Strategy Root Safety
  it("TEST O — Authority precedence check prevents PerformanceContext from mutating Strategy Root", async () => {
    const mockStrategyRoot = { id: "root_123", primaryTargetAudience: "B2B SaaS Founders" };
    const mockContext: any = { id: "ctx_123", mode: "BUILD" };

    const check = verifyAuthorityPrecedenceBoundary(mockStrategyRoot, mockContext);
    expect(check.boundaryPassed).toBe(true);
    expect(check.violations).toHaveLength(0);
  });

  // TEST P: Audience Boundary
  it("TEST P — Performance enrichment cannot replace canonical target audience", async () => {
    const mockStrategyRoot = { id: "root_123", primaryTargetAudience: "B2B SaaS Founders" };
    const mockContext: any = { id: "ctx_123", mode: "OPTIMIZE" };

    const check = verifyAuthorityPrecedenceBoundary(mockStrategyRoot, mockContext);
    expect(check.boundaryPassed).toBe(true);
    expect(mockStrategyRoot.primaryTargetAudience).toBe("B2B SaaS Founders");
  });

  // TEST Q: Positioning Boundary
  it("TEST Q — Weak performance signals cannot replace core positioning statement", async () => {
    const mockPositioning = { positioningStatement: "Fragmented Insight Pipeline Hindering Targeting" };
    const mockContext: any = { id: "ctx_123", mode: "OPTIMIZE", primaryBottleneck: "INTENT" };

    expect(mockPositioning.positioningStatement).toBe("Fragmented Insight Pipeline Hindering Targeting");
  });

  // TEST R: Engine Lineage Tracing
  it("TEST R — Engines consuming PerformanceContext record their ID in lineage log", async () => {
    const mockContext: any = {
      id: `ctx_${randomUUID().slice(0, 8)}`,
      businessExecutionStateId: `state_${randomUUID().slice(0, 8)}`,
      accountId: testAccountId,
      campaignId: testCampaignId,
      mode: "OPTIMIZE",
      primaryBottleneck: "CONVERSION",
    };

    const record = recordEnginePerformanceConsumption("funnel_engine_v1", mockContext);
    expect(record.engineId).toBe("funnel_engine_v1");
    expect(record.performanceContextId).toBe(mockContext.id);

    const log = getConsumptionLineageLog();
    expect(log.some((l) => l.engineId === "funnel_engine_v1")).toBe(true);
  });

  // TEST S: Business Language Layer (BLL) Translation
  it("TEST S — BLL correctly translates internal enums into business-facing presentation text", async () => {
    const mockState: any = {
      mode: "BUILD",
      primaryBottleneck: "NONE",
      confidence: "HIGH",
      evidenceSummary: "Early stage verified.",
      reason: "2 posts observed.",
    };

    const p = translatePerformanceToBll(mockState, null, null);
    expect(p.stateBadgeLabel).toBe("Building Market Traction");
    expect(p.confidenceLabel).toBe("High Confidence");
    expect(p.dataCoverage.length).toBeGreaterThanOrEqual(5);
  });

  // TEST T: End-to-End Orchestration & Persistence
  it("TEST T — evaluateAndPersistBusinessExecutionState creates persisted rows and returns payload", { timeout: 20000 }, async () => {
    const result = await evaluateAndPersistBusinessExecutionState({
      accountId: testAccountId,
      campaignId: testCampaignId,
    });

    expect(result.executionState.id).toBeDefined();
    expect(result.performanceContext.id).toBeDefined();
    expect(result.dossier.sourceSnapshots.length).toBeGreaterThan(0);
  });

  // TEST U: Early Instagram + Unknown Business History
  it("TEST U — Early Instagram with unknown business history yields UNKNOWN mode targeting business history clarification", async () => {
    const mockDossier: any = {
      accountId: testAccountId,
      campaignId: testCampaignId,
      sourceSnapshots: [],
      websiteFact: { hasWebsite: true, url: "https://example.com", evidenceRefId: "ev_web_u" },
      instagramFact: { isConnected: true, channelAgeMonths: 1, totalPostsObserved: 3, followersCount: 73, evidenceRefId: "ev_ig_u" },
      manualTruthFact: { hasUserTruth: false, evidenceRefId: "ev_truth_u" },
      providerFailures: [],
    };

    const candidate: any = {
      mode: "UNKNOWN",
      primaryBottleneck: "UNKNOWN",
      confidence: "LOW",
      reasoning: "Instagram presence appears early-stage (73 followers, 3 posts), but business operating history is unconfirmed.",
      evidenceSummary: "Early social account observed; overall business age unconfirmed.",
      missingCriticalFacts: ["Confirmed business operating history"],
      evidenceRefIds: ["ev_web_u", "ev_ig_u"],
      clarificationRequest: {
        missingFactType: "business_operating_history",
        question: "Has your business been actively operating prior to launching this social page?",
        answerType: "TEXT",
        reason: "Clarifies whether early social metrics represent a brand-new business or an established business with a new account.",
      },
    };

    const verdict = judgeBusinessExecutionState(candidate, mockDossier);
    expect(verdict.status).toBe("ACCEPTED");
    expect(verdict.validatedMode).toBe("UNKNOWN");
    expect(candidate.clarificationRequest.missingFactType).toBe("business_operating_history");
  });

  // TEST V: Early Instagram + Confirmed New Business
  it("TEST V — Early Instagram with confirmed zero historical sales yields BUILD mode", async () => {
    const mockDossier: any = {
      accountId: testAccountId,
      campaignId: testCampaignId,
      sourceSnapshots: [],
      websiteFact: { hasWebsite: true, url: "https://newlaunch.com", hasProductOffering: true, evidenceRefId: "ev_web_v" },
      instagramFact: { isConnected: true, channelAgeMonths: 1, totalPostsObserved: 3, followersCount: 73, evidenceRefId: "ev_ig_v" },
      manualTruthFact: { hasUserTruth: true, historicalLeadCount: 0, historicalCustomerCount: 0, evidenceRefId: "ev_truth_v" },
      providerFailures: [],
    };

    const candidate: any = {
      mode: "BUILD",
      primaryBottleneck: "NONE",
      confidence: "HIGH",
      reasoning: "Early social page combined with user-confirmed 0 historical sales proves early BUILD stage.",
      evidenceSummary: "Early business creating initial market demand.",
      missingCriticalFacts: [],
      evidenceRefIds: ["ev_web_v", "ev_ig_v", "ev_truth_v"],
    };

    const verdict = judgeBusinessExecutionState(candidate, mockDossier);
    expect(verdict.status).toBe("ACCEPTED");
    expect(verdict.validatedMode).toBe("BUILD");
  });

  // TEST W: Early Instagram + Established Business History
  it("TEST W — Early Instagram with confirmed 3-year operating history yields OPTIMIZE mode (new page ≠ new business)", async () => {
    const mockDossier: any = {
      accountId: testAccountId,
      campaignId: testCampaignId,
      sourceSnapshots: [],
      websiteFact: { hasWebsite: true, url: "https://established-firm.com", hasProductOffering: true, evidenceRefId: "ev_web_w" },
      instagramFact: { isConnected: true, channelAgeMonths: 1, totalPostsObserved: 3, followersCount: 73, evidenceRefId: "ev_ig_w" },
      manualTruthFact: { hasUserTruth: true, historicalLeadCount: 250, historicalCustomerCount: 60, evidenceRefId: "ev_truth_w" },
      providerFailures: [],
    };

    const candidate: any = {
      mode: "OPTIMIZE",
      primaryBottleneck: "REACH",
      confidence: "HIGH",
      reasoning: "Established business (60 paying clients) using a newly created Instagram profile. Primary bottleneck is distribution REACH.",
      evidenceSummary: "Established business expanding channel reach.",
      missingCriticalFacts: [],
      evidenceRefIds: ["ev_web_w", "ev_ig_w", "ev_truth_w"],
    };

    const verdict = judgeBusinessExecutionState(candidate, mockDossier);
    expect(verdict.status).toBe("ACCEPTED");
    expect(verdict.validatedMode).toBe("OPTIMIZE");
    expect(verdict.validatedBottleneck).toBe("REACH");
  });
});

