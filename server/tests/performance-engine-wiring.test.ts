import "dotenv/config";
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../db";
import {
  performanceContexts,
  businessExecutionStates,
  enginePerformanceConsumptions,
  type PerformanceContextRow,
} from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import {
  buildEnginePerformanceView,
  recordEnginePerformanceConsumptionDB,
  verifyAuthorityPrecedenceBoundary,
  validateEngineOutputPerformanceAlignment,
  getLatestPerformanceContext,
  getConsumptionLineageLog,
} from "../performance-loop/strategy-router";
import { buildDoctrineBlock, buildPerformanceBlock, type RunStrategicContext } from "../shared/strategic-doctrine";

describe("Performance Context -> Strategy Engine Wiring (Phase 2)", () => {
  const testCampaignId = `camp_test_wiring_${Date.now()}`;
  const testAccountId = `acc_test_wiring_${Date.now()}`;

  const mockBuildContext: PerformanceContextRow = {
    id: `perf_ctx_build_${Date.now()}`,
    businessExecutionStateId: `state_build_${Date.now()}`,
    accountId: testAccountId,
    campaignId: testCampaignId,
    mode: "BUILD",
    primaryBottleneck: "NONE",
    currentReality: "Brand new business with zero sales history and initial product offering.",
    strongestSignals: ["Website active"],
    weakestSignals: ["Zero historical sales", "No connected Instagram history"],
    recentTrend: "ESTABLISHING_DEMAND",
    activeChannels: ["WEBSITE"],
    provenAssets: [],
    proofGaps: ["No historical customer reviews", "No case studies"],
    relevantBuyerResponses: [],
    relevantObjections: ["Is this product proven?"],
    confidence: "HIGH",
    freshness: "FRESH",
    evidenceRefIds: ["ev_truth_001"],
    createdAt: new Date(),
  };

  const mockOptimizeContext: PerformanceContextRow = {
    id: `perf_ctx_opt_${Date.now()}`,
    businessExecutionStateId: `state_opt_${Date.now()}`,
    accountId: testAccountId,
    campaignId: testCampaignId,
    mode: "OPTIMIZE",
    primaryBottleneck: "CONVERSION",
    currentReality: "Established business with 60 client contracts facing conversion bottleneck.",
    strongestSignals: ["High organic website traffic", "60 active clients"],
    weakestSignals: ["Checkout dropoff at pricing page"],
    recentTrend: "STABLE",
    activeChannels: ["WEBSITE", "INSTAGRAM"],
    provenAssets: ["Existing case studies"],
    proofGaps: ["Pricing transparency"],
    relevantBuyerResponses: ["Love the product but high initial price"],
    relevantObjections: ["Price seems high compared to basic tools"],
    confidence: "HIGH",
    freshness: "FRESH",
    evidenceRefIds: ["ev_truth_002"],
    createdAt: new Date(),
  };

  const mockUnknownContext: PerformanceContextRow = {
    id: `perf_ctx_unk_${Date.now()}`,
    businessExecutionStateId: `state_unk_${Date.now()}`,
    accountId: testAccountId,
    campaignId: testCampaignId,
    mode: "UNKNOWN",
    primaryBottleneck: "UNKNOWN",
    currentReality: "Provider data missing, uningested.",
    strongestSignals: [],
    weakestSignals: [],
    recentTrend: "INSUFFICIENT_DATA",
    activeChannels: [],
    provenAssets: [],
    proofGaps: [],
    relevantBuyerResponses: [],
    relevantObjections: [],
    confidence: "LOW",
    freshness: "STALE",
    evidenceRefIds: [],
    createdAt: new Date(),
  };

  it("TEST 1: Projection Layer restricts signals per engine category (Slow vs Medium vs Fast)", () => {
    // SLOW Engine (Positioning)
    const posView = buildEnginePerformanceView("Positioning", mockBuildContext);
    expect(posView).not.toBeNull();
    expect(posView?.permissionDirective).toContain("Validation and learning evidence ONLY");
    expect(posView?.allowedSignals.proofGaps).toBeUndefined(); // SLOW engines do not receive proof gaps

    // MEDIUM Engine (Offer)
    const offerView = buildEnginePerformanceView("Offer", mockBuildContext);
    expect(offerView?.permissionDirective).toContain("BUILD MODE: Favor lower-friction validation/diagnostic entry framing");
    expect(offerView?.allowedSignals.proofGaps).toBeDefined();

    // FAST Engine (Content)
    const contentView = buildEnginePerformanceView("Content", mockBuildContext);
    expect(contentView?.permissionDirective).toContain("BUILD MODE: Emphasize discovery, problem education");
    expect(contentView?.allowedSignals.strongestSignals).toBeDefined();
  });

  it("TEST 2: Prompt Builder injects Performance Block when context is present", () => {
    const projectedView = buildEnginePerformanceView("Funnel", mockBuildContext);
    const mockStrategic: RunStrategicContext = {
      doctrine: {
        version: 1,
        resolution: "anchored",
        productAnchor: {
          name: "Acme Cloud",
          type: "SaaS",
          offeringType: "Subscription",
          productSpecs: ["API Access"],
          customerUseCases: ["Automation"],
          problemSolved: "Manual work",
          uniqueMechanism: "Smart Workflow",
          strategicAdvantage: "10x speed",
          alternativeReplaced: "Spreadsheets",
          keyAttributes: ["Cloud"],
          coreProblemSolved: "Slow manual tasks",
          differentiatingFeature: "Zero-code builder",
        },
        businessLevelOffer: "Free trial",
        productCategory: "Automation",
        anchorHash: "hash123",
      },
      priorDecisions: [],
      performanceContext: projectedView,
    };

    const block = buildDoctrineBlock(mockStrategic);
    expect(block).toContain("═══ BUSINESS EXECUTION PERFORMANCE CONTEXT ═══");
    expect(block).toContain("BUSINESS MODE: BUILD");
    expect(block).toContain("PRIMARY BOTTLENECK: NONE");
    expect(block).toContain("BUILD MODE: Establish attention -> prospect interaction");
  });

  it("TEST 3: Same Strategy / Different Mode Behavioral Isolation (Diagnostic)", () => {
    const buildView = buildEnginePerformanceView("Offer", mockBuildContext);
    const optView = buildEnginePerformanceView("Offer", mockOptimizeContext);

    const baseDoctrine = {
      version: 1,
      resolution: "anchored" as const,
      productAnchor: {
        name: "OmniTool",
        type: "Software",
        offeringType: "B2B SaaS",
        productSpecs: ["Sync"],
        customerUseCases: ["Analytics"],
        problemSolved: "Data silos",
        uniqueMechanism: "Direct Bridge",
        strategicAdvantage: "Realtime",
        alternativeReplaced: "Manual CSVs",
        keyAttributes: ["Fast"],
        coreProblemSolved: "Data fragmentation",
        differentiatingFeature: "Instant sync",
      },
      businessLevelOffer: "Pro Plan",
      productCategory: "Data Integration",
      anchorHash: "hash456",
    };

    const runA: RunStrategicContext = { doctrine: baseDoctrine, priorDecisions: [], performanceContext: buildView };
    const runB: RunStrategicContext = { doctrine: baseDoctrine, priorDecisions: [], performanceContext: optView };

    // Core Doctrine Equality
    expect(runA.doctrine.productAnchor?.name).toBe(runB.doctrine.productAnchor?.name);
    expect(runA.doctrine.productAnchor?.coreProblemSolved).toBe(runB.doctrine.productAnchor?.coreProblemSolved);

    // Execution Context Difference
    const blockA = buildDoctrineBlock(runA);
    const blockB = buildDoctrineBlock(runB);

    expect(blockA).toContain("BUSINESS MODE: BUILD");
    expect(blockB).toContain("BUSINESS MODE: OPTIMIZE");
    expect(blockB).toContain("PRIMARY BOTTLENECK: CONVERSION");
    expect(blockA).not.toEqual(blockB);
  });

  it("TEST 4: Judge Alignment rejects ungrounded mature claims in BUILD mode", () => {
    const buildView = buildEnginePerformanceView("Offer", mockBuildContext);
    
    // Invalid output claiming 42% uplift & 60 paying clients in BUILD mode
    const badOutput = "Our primary offer features a guaranteed 14-day deployment SLA with 60+ active paying client contracts and proven 42% uplift.";
    const checkBad = validateEngineOutputPerformanceAlignment("Offer", badOutput, buildView);
    expect(checkBad.aligned).toBe(false);
    expect(checkBad.violations.length).toBeGreaterThan(0);

    // Valid BUILD output
    const goodOutput = "Our primary offer features a zero-friction diagnostic pilot to validate core workflow automation for early adopters.";
    const checkGood = validateEngineOutputPerformanceAlignment("Offer", goodOutput, buildView);
    expect(checkGood.aligned).toBe(true);
  });

  it("TEST 5: Judge Alignment handles UNKNOWN mode safely", () => {
    const unkView = buildEnginePerformanceView("Funnel", mockUnknownContext, { isStale: true });

    const badOutput = "As a proven market leader with an established enterprise customer base, our bottom funnel drives high-volume renewals.";
    const checkBad = validateEngineOutputPerformanceAlignment("Funnel", badOutput, unkView);
    expect(checkBad.aligned).toBe(false);
    expect(checkBad.violations[0]).toContain("UNKNOWN_MODE_ASSUMPTION");
  });

  it("TEST 6: DB & In-Memory Consumption Lineage Persistence", async () => {
    const engineRunId = `run_test_${Date.now()}`;
    const outputSnapId = `snap_out_${Date.now()}`;

    await recordEnginePerformanceConsumptionDB({
      engineName: "FunnelEngine",
      engineRunId,
      campaignId: testCampaignId,
      accountId: testAccountId,
      performanceContextId: mockBuildContext.id,
      businessExecutionStateId: mockBuildContext.businessExecutionStateId,
      mode: mockBuildContext.mode,
      primaryBottleneck: mockBuildContext.primaryBottleneck || "NONE",
      outputSnapshotId: outputSnapId,
    });

    const lineageLog = getConsumptionLineageLog();
    const recorded = lineageLog.find(r => r.engineRunId === engineRunId);

    expect(recorded).toBeDefined();
    expect(recorded?.engineId).toBe("FunnelEngine");
    expect(recorded?.mode).toBe("BUILD");
    expect(recorded?.performanceContextId).toBe(mockBuildContext.id);
  });

  it("TEST 7: Precedence Boundary Verification prevents Strategy Root mutation", () => {
    const safeRoot = { id: "root_1", primaryTargetAudience: { id: "aud_1" } };
    const checkPass = verifyAuthorityPrecedenceBoundary(safeRoot, mockBuildContext);
    expect(checkPass.boundaryPassed).toBe(true);

    const mutatedRoot = { id: "root_1", _mutatedByPerformance: true };
    const checkFail = verifyAuthorityPrecedenceBoundary(mutatedRoot, mockBuildContext);
    expect(checkFail.boundaryPassed).toBe(false);
    expect(checkFail.violations[0]).toContain("AUTHORITY_VIOLATION");
  });
});
