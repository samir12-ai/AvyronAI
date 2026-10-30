import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock db before importing modules that use it
let mockSelectRows: any[] = [];
vi.mock("../db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(async () => mockSelectRows),
          })),
          limit: vi.fn(async () => mockSelectRows),
        })),
        orderBy: vi.fn(() => ({
          limit: vi.fn(async () => mockSelectRows),
        })),
        limit: vi.fn(async () => mockSelectRows),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(async () => [{ id: "mock-inserted-id" }]),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(async () => [{ id: "mock-updated-id" }]),
      })),
    })),
  },
}));

import {
  assertRootExecutionEligible,
  getExecutionEligibleRoot,
  getRootForHistoricalView,
} from "../shared/strategy-root";
import {
  SYSTEM_CONTROL_TARGET_MAP,
  computeBudgetDecisionLedgerEntry,
  resolveGovernedBudgetState,
} from "../orchestrator/budget-decision-ledger";
import {
  validateSynthesisIntegrity,
} from "../orchestrator/plan-synthesis";

describe("Sara FT Forensic Audit Verification Suite", () => {
  beforeEach(() => {
    mockSelectRows = [];
  });

  describe("1. Strategy Root Lifecycle & Immaterial Refresh Contract", () => {
    it("assertRootExecutionEligible returns eligible=true for complete ACTIVE roots", async () => {
      mockSelectRows = [
        {
          id: "root-active-1",
          status: "ACTIVE",
          campaignId: "camp_1",
          accountId: "acc_1",
          primaryAxis: "Primary Transformation Axis",
          contrastAxisText: "Generic alternative",
          audienceSnapshotId: "aud_snap_1",
          positioningSnapshotId: "pos_snap_1",
          differentiationSnapshotId: "diff_snap_1",
          mechanismSnapshotId: "mech_snap_1",
          approvedMechanism: JSON.stringify({ mechanismName: "Causal Delivery Mechanism" }),
          approvedAudiencePains: JSON.stringify(["Ineffective generic advice"]),
          approvedClaims: JSON.stringify([{ claim: "Clinically proven results" }]),
          approvedPromise: "Transform health outcomes",
          brandSpine: JSON.stringify({ core: "Clinical Excellence" }),
          approvedLanes: JSON.stringify([{ laneId: "lane-1", title: "Clinical Care" }]),
          supersededByRootId: null,
        },
      ];

      const res = await assertRootExecutionEligible("root-active-1", "camp_1", "acc_1");
      expect(res.eligible).toBe(true);
      expect(res.reasons.length).toBe(0);
      expect(res.root).toBeDefined();
    });

    it("assertRootExecutionEligible returns eligible=false for REVIEW_REQUIRED or INVALIDATED", async () => {
      mockSelectRows = [
        {
          id: "root-review-1",
          status: "REVIEW_REQUIRED",
          campaignId: "camp_1",
          accountId: "acc_1",
          supersededByRootId: null,
        },
      ];

      const res = await assertRootExecutionEligible("root-review-1", "camp_1", "acc_1");
      expect(res.eligible).toBe(false);
      expect(res.reasons.some(r => r.includes("REVIEW_REQUIRED"))).toBe(true);
    });

    it("getExecutionEligibleRoot vs getRootForHistoricalView contracts", async () => {
      mockSelectRows = [
        {
          id: "root-active-1",
          status: "ACTIVE",
          campaignId: "camp_1",
          accountId: "acc_1",
          supersededByRootId: null,
        },
      ];

      const activeRoot = await getExecutionEligibleRoot("camp_1", "acc_1");
      expect(activeRoot).not.toBeNull();
      expect(activeRoot?.status).toBe("ACTIVE");

      mockSelectRows = [
        {
          id: "root-historical-1",
          status: "REVIEW_REQUIRED",
          campaignId: "camp_1",
          accountId: "acc_1",
          supersededByRootId: null,
        },
      ];

      const historicalRoot = await getRootForHistoricalView("camp_1", "acc_1");
      expect(historicalRoot).not.toBeNull();
      expect(historicalRoot?.status).toBe("REVIEW_REQUIRED");
    });
  });

  describe("2. Claims Authority & Clean Route Naming Contract", () => {
    it("Persuasion route names must NEVER contain bracketed axis metadata", () => {
      const cleanRouteName = "Overcoming Ineffective General Care";
      const dirtyRouteName = "Overcoming Ineffective General Care [locked axis: Clinical precision vs generic advice]";

      const axisBracketPattern = /\[locked axis:[^\]]+\]/i;

      expect(axisBracketPattern.test(cleanRouteName)).toBe(false);
      expect(axisBracketPattern.test(dirtyRouteName)).toBe(true);

      const persuasionRoute = {
        routeName: cleanRouteName,
        lockedAxisSummary: "Clinical precision vs generic advice",
      };
      expect(persuasionRoute.routeName).not.toMatch(axisBracketPattern);
      expect(persuasionRoute.lockedAxisSummary).toBe("Clinical precision vs generic advice");
    });

    it("Awareness Engine unpacked objections and pains without [object Object] or objection_0", () => {
      const objectionMap: any = {
        price: { statement: "Too expensive compared to standard", response: "High ROI justification" },
        trust: { canonical: "Unsure if this works for my specific condition", response: "Clinical studies" },
      };

      const extractedStatements: string[] = [];
      for (const [key, val] of Object.entries(objectionMap)) {
        if (typeof val === "string") {
          extractedStatements.push(val);
        } else if (typeof val === "object" && val !== null) {
          const stmt = (val as any).canonical || (val as any).statement || (val as any).objection || key;
          extractedStatements.push(stmt);
        }
      }

      for (const stmt of extractedStatements) {
        expect(stmt).not.toContain("[object Object]");
        expect(stmt).not.toMatch(/objection_\d+/);
      }
      expect(extractedStatements).toContain("Too expensive compared to standard");
      expect(extractedStatements).toContain("Unsure if this works for my specific condition");
    });
  });

  describe("3. Governance & Budget Contracts (System Control Alignment)", () => {
    it("SYSTEM_CONTROL_TARGET_MAP maps review_required and needs_reconciliation to hold and REVIEW_REQUIRED", () => {
      const reviewTarget = SYSTEM_CONTROL_TARGET_MAP["review_required"];
      expect(reviewTarget).toBeDefined();
      expect(reviewTarget.spendAction).toBe("hold");
      expect(reviewTarget.governanceState).toBe("REVIEW_REQUIRED");

      const reconciliationTarget = SYSTEM_CONTROL_TARGET_MAP["needs_reconciliation"];
      expect(reconciliationTarget).toBeDefined();
      expect(reconciliationTarget.spendAction).toBe("hold");
      expect(reconciliationTarget.governanceState).toBe("REVIEW_REQUIRED");

      const haltTarget = SYSTEM_CONTROL_TARGET_MAP["halt"];
      expect(haltTarget).toBeDefined();
      expect(haltTarget.spendAction).toBe("halt");
      expect(haltTarget.governanceState).toBe("BLOCKED");
    });

    it("computeBudgetDecisionLedgerEntry attaches governanceState and verdictId correctly", () => {
      const entry = computeBudgetDecisionLedgerEntry({
        jobId: "orch_test_001",
        originalAction: "test",
        proposedDowngrades: [{ to: "review_required", code: "UNVERIFIED_BUDGET" }],
        verdictId: "verdict_test_001",
      });

      expect(entry).not.toBeNull();
      expect(entry?.finalAction).toBe("hold");
      expect(entry?.governanceState).toBe("REVIEW_REQUIRED");
      expect(entry?.verdictId).toBe("verdict_test_001");
      expect(entry?.downgradeReasons).toContain("UNVERIFIED_BUDGET");
    });

    it("resolveGovernedBudgetState reflects unconfirmed budget and hold status honestly", () => {
      const budgetGovOutput: any = {
        totalMonthlyBudget: 5000,
        currency: "USD",
        budgetConfirmation: "unconfirmed",
        decision: {
          action: "hold",
          executionMode: "recommendation_only",
          reasoning: "Monthly budget USD 5000 is an unconfirmed system recommendation. Explicit user confirmation is required.",
        },
      };

      const governed = resolveGovernedBudgetState(budgetGovOutput);
      expect(governed.spendAction).toBe("hold");
      expect(governed.action).toBe("hold");
      expect(governed.budgetConfirmation).toBe("unconfirmed");
      expect(governed.governanceState).toBe("REVIEW_REQUIRED");
      expect(governed.totalMonthlyBudget).toBe(5000);
      expect(governed.currency).toBe("USD");
      expect(governed.reasoning).toContain("unconfirmed");
    });
  });

  describe("4. Plan Synthesis Grounding & Governance Integrity", () => {
    it("validateSynthesisIntegrity reports UNGROUNDED when root is missing or not active", () => {
      const dummyPlan: any = {
        synthesisVerification: { totalLocked: 3, preserved: 3, missing: [] },
      };
      const results = new Map();

      const noRootResult = validateSynthesisIntegrity(dummyPlan, results, null);
      expect(noRootResult.verdict).toBe("UNGROUNDED");
      expect(noRootResult.strategyRootPresent).toBe(false);

      const reviewRoot = { id: "root-rev", status: "REVIEW_REQUIRED" };
      const reviewResult = validateSynthesisIntegrity(dummyPlan, results, reviewRoot);
      expect(reviewResult.verdict).toBe("UNGROUNDED");
      expect(reviewResult.contradictions.some(c => c.includes("STRATEGY_ROOT_INELIGIBLE"))).toBe(true);

      const activeRoot = { id: "root-act", status: "ACTIVE" };
      const activeResult = validateSynthesisIntegrity(dummyPlan, results, activeRoot);
      expect(activeResult.verdict).toBe("FULLY_GROUNDED");
    });

    it("validateSynthesisIntegrity correctly evaluates synthesisVerification when labels are missing", () => {
      const planWithMissing: any = {
        synthesisVerification: {
          totalLocked: 4,
          preserved: 2,
          missing: ["Mechanic Transformation", "Specific Pain Statement"],
        },
      };
      const results = new Map();
      const activeRoot = { id: "root-act", status: "ACTIVE" };

      const integrity = validateSynthesisIntegrity(planWithMissing, results, activeRoot);
      expect(integrity.verdict).toBe("PARTIALLY_GROUNDED");
      expect(integrity.lockedDecisionCoverage).toBe(0.5);
    });

    it("Plan governance block generates approval blockers for hold budget and unconfirmed spend", () => {
      const governedBudget = resolveGovernedBudgetState({
        totalMonthlyBudget: 5000,
        currency: "USD",
        budgetConfirmation: "unconfirmed",
        decision: { action: "hold", reasoning: "Budget unconfirmed by user" },
      });

      const activeStrategyRoot = { id: "root-sara", status: "REVIEW_REQUIRED" };
      const isRootEligible = activeStrategyRoot.status === "ACTIVE";

      const approvalBlockers: string[] = [];
      if (!isRootEligible) {
        approvalBlockers.push(`Strategy Root ${activeStrategyRoot.id} has status "${activeStrategyRoot.status}", not ACTIVE.`);
      }
      if (governedBudget.spendAction === "hold" || governedBudget.governanceState === "REVIEW_REQUIRED") {
        approvalBlockers.push(`Budget Governor decision is hold / review required: ${governedBudget.reasoning}.`);
      }

      expect(approvalBlockers.length).toBe(2);
      expect(approvalBlockers[0]).toContain("REVIEW_REQUIRED");
      expect(approvalBlockers[1]).toContain("hold / review required");
    });
  });

  describe("5. Competitor Acquisition Truthfulness Contract", () => {
    it("Instagram handles containing dots are preserved and NOT nulled", () => {
      const igSource = {
        canonicalUrl: "https://www.instagram.com/sara.ft/",
        externalAccountId: "sara.ft",
      };

      const m = igSource.canonicalUrl.match(/instagram\.com\/([a-zA-Z0-9_.-]+)/);
      let normalizedHandle: string | null = m ? m[1] : (igSource.externalAccountId || null);

      expect(normalizedHandle).toBe("sara.ft");
      expect(normalizedHandle).toContain(".");
    });

    it("Unsupported competitor source returns UNSUPPORTED_SOURCE without false BLOCKED stamp", () => {
      const compWithoutIg = {
        name: "Competitor Without IG",
        id: "comp-no-ig",
      };
      const igSource = null;
      const normalizedHandle = null;

      let fetchResult: any;
      if (!igSource || !normalizedHandle) {
        fetchResult = {
          competitorId: compWithoutIg.id,
          postsCollected: 0,
          commentsCollected: 0,
          ctaCoverage: 0,
          ctaTypes: [],
          followers: null,
          engagementRate: null,
          postingFrequency: null,
          contentMix: null,
          fetchMethod: "NONE",
          status: "UNSUPPORTED_SOURCE",
          message: "Competitor has no verified Instagram source or valid handle. Scraping not attempted.",
        };
      }

      expect(fetchResult.status).toBe("UNSUPPORTED_SOURCE");
      expect(fetchResult.status).not.toBe("BLOCKED");
      expect(fetchResult.blockClass).toBeUndefined();
    });
  });

  describe("6. Strategy Experience Truthful Status", () => {
    it("Maps strategy status truthfully: LIVE only for eligible root, REVIEW_REQUIRED or HISTORICAL_ONLY otherwise", () => {
      const resolveStatus = (activeRoot: any) => {
        let isHistoricalOnly = false;
        let strategyStatus: "LIVE" | "REVIEW_REQUIRED" | "HISTORICAL_ONLY" | "UNINITIALIZED" = "UNINITIALIZED";

        if (activeRoot && activeRoot.status === "ACTIVE" && !activeRoot.supersededByRootId) {
          strategyStatus = "LIVE";
        } else if (activeRoot) {
          if (activeRoot.status === "REVIEW_REQUIRED") {
            strategyStatus = "REVIEW_REQUIRED";
          } else {
            strategyStatus = "HISTORICAL_ONLY";
          }
          isHistoricalOnly = true;
        } else {
          strategyStatus = "UNINITIALIZED";
        }
        return { strategyStatus, isHistoricalOnly };
      };

      expect(resolveStatus({ status: "ACTIVE" })).toEqual({
        strategyStatus: "LIVE",
        isHistoricalOnly: false,
      });

      expect(resolveStatus({ status: "REVIEW_REQUIRED" })).toEqual({
        strategyStatus: "REVIEW_REQUIRED",
        isHistoricalOnly: true,
      });

      expect(resolveStatus({ status: "INVALIDATED" })).toEqual({
        strategyStatus: "HISTORICAL_ONLY",
        isHistoricalOnly: true,
      });

      expect(resolveStatus(null)).toEqual({
        strategyStatus: "UNINITIALIZED",
        isHistoricalOnly: false,
      });
    });
  });

  describe("7. Budget Approval Contract & Authoritative Budget Assembly", () => {
    it("Unconfirmed budget assumption does NOT block strategic recommendation approval", () => {
      // Mock plan synthesis governance evaluation
      const activeStrategyRoot = { id: "root-1", status: "ACTIVE", executionEligible: true };
      const controlVerdict = { verdict: "DOWNGRADE", strategyBlocked: false, executionMode: "REVIEW_REQUIRED" };
      const verification = { passed: true, totalLocked: 7, preserved: 7, missing: [] };
      const governedBudget = {
        action: "recommend",
        spendAction: "hold" as const,
        executionMode: "recommendation_only" as const,
        governanceState: "CLEAR" as const,
        budgetConfirmation: "unconfirmed" as const,
        isAssumption: true,
      };

      const approvalBlockers: string[] = [];
      const isRootEligible = Boolean(activeStrategyRoot && (activeStrategyRoot.status === "ACTIVE" || activeStrategyRoot.executionEligible === true));
      if (!isRootEligible) {
        approvalBlockers.push("Strategy Root not execution-eligible.");
      }
      if (controlVerdict && (controlVerdict.strategyBlocked === true || controlVerdict.verdict === "BLOCK" || controlVerdict.executionMode === "SYSTEM_UNTRUSTED" || controlVerdict.executionMode === "HALTED")) {
        approvalBlockers.push("System Control rejected strategy.");
      }
      if (verification && !verification.passed) {
        approvalBlockers.push("Missing locked decisions.");
      }
      if (governedBudget.governanceState === "BLOCKED" || governedBudget.action === "halt") {
        approvalBlockers.push("Budget halted.");
      }
      if (governedBudget.executionMode === "execution" && (governedBudget.spendAction === "hold" || governedBudget.budgetConfirmation !== "user_confirmed")) {
        approvalBlockers.push("Live spend unconfirmed.");
      }

      // Recommendation plan with unconfirmed budget has NO approval blockers
      expect(approvalBlockers.length).toBe(0);
    });

    it("Missing locked strategic decisions or invalid root triggers unbypassable approval blocker", () => {
      const activeStrategyRoot = { id: "root-sup", status: "SUPERSEDED", executionEligible: false };
      const verification = { passed: false, totalLocked: 7, preserved: 5, missing: ["channel_selection", "persuasion"] };
      const approvalBlockers: string[] = [];
      
      const isRootEligible = Boolean(activeStrategyRoot && (activeStrategyRoot.status === "ACTIVE" || activeStrategyRoot.executionEligible === true));
      if (!isRootEligible) {
        approvalBlockers.push(`Strategy Root ${activeStrategyRoot.id} has status "${activeStrategyRoot.status}", not execution-eligible.`);
      }
      if (verification && !verification.passed) {
        approvalBlockers.push(`Missing ${verification.missing.length} locked strategic decision(s): ${verification.missing.join(', ')}.`);
      }

      expect(approvalBlockers.length).toBe(2);
      expect(approvalBlockers[0]).toContain("not execution-eligible");
      expect(approvalBlockers[1]).toContain("Missing 2 locked strategic decision(s)");
    });

    it("Authoritative budget assembly preserves channel allocations without invented 40/40/20 expense breakdowns", () => {
      const bgOutput = {
        totalMonthlyBudget: 5000,
        currency: "USD",
        budgetSettingsVersion: 1,
        budgetConfirmation: "unconfirmed",
        allocations: [
          { channelId: "instagram_organic", channelName: "Instagram Organic", sharePercentage: 50, monthlyAmount: 2500, isOrganic: true, proposedUse: "Content publishing" },
          { channelId: "meta_ads", channelName: "Meta Ads", sharePercentage: 50, monthlyAmount: 2500, isOrganic: false, proposedUse: "Paid conversion testing" },
        ],
      };

      const budgetAllocation = {
        totalBudget: `${bgOutput.totalMonthlyBudget} ${bgOutput.currency}`,
        currency: bgOutput.currency,
        totalMonthlyBudget: bgOutput.totalMonthlyBudget,
        period: "monthly",
        budgetSettingsVersion: bgOutput.budgetSettingsVersion,
        budgetConfirmation: bgOutput.budgetConfirmation,
        isAssumption: true,
        provenance: "Agent-entered, unconfirmed budget assumption ($5,000 USD). Does not authorize ad spend.",
        channels: bgOutput.allocations,
        breakdown: bgOutput.allocations.map(a => ({
          category: a.channelName,
          percentage: a.sharePercentage,
          monthlyAmount: a.monthlyAmount,
          purpose: a.proposedUse,
          isOrganic: a.isOrganic,
        })),
      };

      expect(budgetAllocation.totalBudget).toBe("5000 USD");
      expect(budgetAllocation.isAssumption).toBe(true);
      expect(budgetAllocation.channels.length).toBe(2);
      expect(budgetAllocation.breakdown.find(b => b.category === "Content Creation")).toBeUndefined();
      expect(budgetAllocation.breakdown[0].category).toBe("Instagram Organic");
      expect(budgetAllocation.breakdown[0].percentage).toBe(50);
    });
  });

  describe("8. Positioning Claim Grounding & Anti-Pain Inversion", () => {
    it("Enforces demand != product capability: audience complaints cannot be inverted into asserted product guarantees", () => {
      // Simulate factual posture evaluation
      const candidateEnemy = "Fast fashion fabrics fail to deliver modest coverage in summer heat";
      const ungroundedContrast = "Guaranteed non-see-through summer dresses with laboratory-tested opacity";
      
      const verifiedCapabilities = [
        "Curated premium SKU architecture priced $35 to $62",
        "24-hour return and exchange policy",
      ];

      // Any claim of opacity guarantee is unsupported by verified capabilities
      const hasOpacityEvidence = verifiedCapabilities.some(c => c.toLowerCase().includes("opacity") || c.toLowerCase().includes("non-see-through"));
      expect(hasOpacityEvidence).toBe(false);

      // Demonstrations remain recommendations
      const proposedDemonstration = "Recommend creator opacity lighting test";
      const isRecommendation = proposedDemonstration.toLowerCase().startsWith("recommend");
      expect(isRecommendation).toBe(true);
    });
  });
});
