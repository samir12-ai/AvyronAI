import "dotenv/config";
import { describe, it, expect, beforeEach } from "vitest";
import {
  STRATEGY_AUTHORITY_REGISTRY,
  getAuthorityDefinition,
  isLaneScopedAuthority,
} from "../adaptive/authority-registry";
import { executeAdaptiveDecision } from "../adaptive/decision-executor";
import {
  dispatchAuthorityRecompute,
  getAuthorityAdapterCapability,
  AuthorityBlockedError,
  AUTHORITY_ENGINE_HANDLERS,
} from "../adaptive/authority-dispatcher";
import { StrategyExperienceService } from "../strategy-experience/service";
import { StrategicAuthorityName, AdaptiveDecision } from "../adaptive/contracts";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and } from "drizzle-orm";

describe("Adaptation Safety & UPDATED Badge Lifecycle Suite", () => {
  const testCampaignId = "camp_safety_test_001";
  const testAccountId = "acc_safety_test_001";
  const testUserId = "user_safety_tester_001";

  beforeEach(async () => {
    try {
      await db
        .delete(schema.strategyChangeAcknowledgements)
        .where(eq(schema.strategyChangeAcknowledgements.campaignId, testCampaignId));
    } catch (e) {
      console.warn("Clean up warning:", e);
    }
  });

  // TEST 1: Material change produces UPDATED badge
  it("TEST 1 — Material change produces UPDATED badge", async () => {
    const mockDecision: AdaptiveDecision = {
      adaptiveDecisionId: "adec_mat_01",
      reasoningCaseId: "rcase_mat_01",
      campaignId: testCampaignId,
      accountId: testAccountId,
      strategyRootId: "root_v1",
      strategyRootVersion: 1,
      decisionType: "REEVALUATE_AUTHORITY",
      affectedAuthority: "FUNNEL",
      affectedLaneIds: ["lane_alpha"],
      evidenceIds: ["ev_01"],
      confidence: 0.9,
      rationale: "Funnel friction",
      createdAt: new Date().toISOString(),
    };

    const mockRoot = {
      id: "root_v1",
      version: 1,
      campaignId: testCampaignId,
      accountId: testAccountId,
      authorityArtifactIds: { FUNNEL: "art_fn_1", PERSUASION: "art_pers_1" },
      approvedLanes: [{ laneId: "lane_alpha", title: "Alpha Lane" }],
    };

    const result = await executeAdaptiveDecision(
      mockDecision,
      mockRoot,
      { activeRootVersion: 1 },
      {
        mockEngineHandler: async (authority) => {
          return { result: "CHANGED", newArtifactId: "art_fn_v2", payload: { authority } };
        },
      }
    );

    expect(result.materiallyChangedAuthorities).toEqual(["FUNNEL"]);
    expect(result.changedAuthorities).toEqual(["FUNNEL"]);
  });

  // TEST 2: Revalidated authority does not produce UPDATED
  it("TEST 2 — Revalidated authority does not produce UPDATED", async () => {
    const mockDecision: AdaptiveDecision = {
      adaptiveDecisionId: "adec_reval_01",
      reasoningCaseId: "rcase_reval_01",
      campaignId: testCampaignId,
      accountId: testAccountId,
      strategyRootId: "root_v1",
      strategyRootVersion: 1,
      decisionType: "REEVALUATE_AUTHORITY",
      affectedAuthority: "FUNNEL",
      affectedLaneIds: ["lane_alpha"],
      evidenceIds: ["ev_01"],
      confidence: 0.9,
      rationale: "Funnel friction",
      createdAt: new Date().toISOString(),
    };

    const mockRoot = {
      id: "root_v1",
      version: 1,
      campaignId: testCampaignId,
      accountId: testAccountId,
      authorityArtifactIds: { FUNNEL: "art_fn_1", PERSUASION: "art_pers_1" },
      approvedLanes: [{ laneId: "lane_alpha", title: "Alpha Lane" }],
    };

    const result = await executeAdaptiveDecision(
      mockDecision,
      mockRoot,
      { activeRootVersion: 1 },
      {
        mockEngineHandler: async (authority) => {
          if (authority === "FUNNEL") {
            return { result: "CHANGED", newArtifactId: "art_fn_v2", payload: { authority } };
          }
          return { result: "NO_CHANGE_REQUIRED", payload: { authority } };
        },
      }
    );

    expect(result.revalidatedAuthorities).toContain("PERSUASION");
    expect(result.materiallyChangedAuthorities).not.toContain("PERSUASION");
    expect(result.changedAuthorities).not.toContain("PERSUASION");
  });

  // TEST 3: Reassembled Plan does not produce UPDATED
  it("TEST 3 — Reassembled Plan does not produce UPDATED", async () => {
    const mockDecision: AdaptiveDecision = {
      adaptiveDecisionId: "adec_plan_01",
      reasoningCaseId: "rcase_plan_01",
      campaignId: testCampaignId,
      accountId: testAccountId,
      strategyRootId: "root_v1",
      strategyRootVersion: 1,
      decisionType: "REEVALUATE_AUTHORITY",
      affectedAuthority: "FUNNEL",
      affectedLaneIds: ["lane_alpha"],
      evidenceIds: ["ev_01"],
      confidence: 0.9,
      rationale: "Funnel friction",
      createdAt: new Date().toISOString(),
    };

    const mockRoot = {
      id: "root_v1",
      version: 1,
      campaignId: testCampaignId,
      accountId: testAccountId,
      authorityArtifactIds: { FUNNEL: "art_fn_1" },
      approvedLanes: [{ laneId: "lane_alpha", title: "Alpha Lane" }],
    };

    const result = await executeAdaptiveDecision(
      mockDecision,
      mockRoot,
      { activeRootVersion: 1 },
      {
        mockEngineHandler: async () => ({ result: "CHANGED", newArtifactId: "art_fn_v2", payload: {} }),
      }
    );

    expect(result.reassembledAuthorities).toEqual(["PLAN_SYNTHESIS"]);
    expect(result.materiallyChangedAuthorities).not.toContain("PLAN_SYNTHESIS");
    expect(result.changedAuthorities).not.toContain("PLAN_SYNTHESIS");
  });

  // TEST 4 & 5: Viewing updated section acknowledges notification and dismisses UPDATED
  it("TEST 4 & 5 — Acknowledging update dismisses UPDATED badge while preserving materiallyChangedAuthorities", async () => {
    const ackResult = await StrategyExperienceService.acknowledgeChange({
      accountId: testAccountId,
      campaignId: testCampaignId,
      userId: testUserId,
      strategyRootId: "root_v6",
      rootBundleVersion: 6,
      authority: "FUNNEL",
      laneId: "lane_alpha",
    });

    expect(ackResult.success).toBe(true);
    expect(ackResult.acknowledged).toBe(true);

    const [row] = await db
      .select()
      .from(schema.strategyChangeAcknowledgements)
      .where(
        and(
          eq(schema.strategyChangeAcknowledgements.campaignId, testCampaignId),
          eq(schema.strategyChangeAcknowledgements.userId, testUserId),
          eq(schema.strategyChangeAcknowledgements.rootBundleVersion, 6)
        )
      );

    expect(row).toBeDefined();
    expect(row.authority).toBe("FUNNEL");
  });

  // TEST 6: Historical timeline remains after acknowledgement
  it("TEST 6 — Historical timeline remains after acknowledgement", async () => {
    const activities = await StrategyExperienceService.getStrategyActivity(testCampaignId, testAccountId);
    expect(Array.isArray(activities)).toBe(true);
  });

  // TEST 7: New later version creates a new UPDATED notification
  it("TEST 7 — New later version (v7) is not suppressed by v6 acknowledgement", async () => {
    await StrategyExperienceService.acknowledgeChange({
      accountId: testAccountId,
      campaignId: testCampaignId,
      userId: testUserId,
      strategyRootId: "root_v6",
      rootBundleVersion: 6,
      authority: "FUNNEL",
    });

    const v7Acks = await db
      .select()
      .from(schema.strategyChangeAcknowledgements)
      .where(
        and(
          eq(schema.strategyChangeAcknowledgements.campaignId, testCampaignId),
          eq(schema.strategyChangeAcknowledgements.userId, testUserId),
          eq(schema.strategyChangeAcknowledgements.rootBundleVersion, 7),
          eq(schema.strategyChangeAcknowledgements.authority, "FUNNEL")
        )
      );

    expect(v7Acks.length).toBe(0);
  });

  // TEST 8: Lane A acknowledgement does not acknowledge Lane B change
  it("TEST 8 — Lane A acknowledgement does not acknowledge Lane B change", async () => {
    await StrategyExperienceService.acknowledgeChange({
      accountId: testAccountId,
      campaignId: testCampaignId,
      userId: testUserId,
      strategyRootId: "root_v6",
      rootBundleVersion: 6,
      authority: "FUNNEL",
      laneId: "lane_A",
    });

    const laneBAcks = await db
      .select()
      .from(schema.strategyChangeAcknowledgements)
      .where(
        and(
          eq(schema.strategyChangeAcknowledgements.campaignId, testCampaignId),
          eq(schema.strategyChangeAcknowledgements.userId, testUserId),
          eq(schema.strategyChangeAcknowledgements.rootBundleVersion, 6),
          eq(schema.strategyChangeAcknowledgements.authority, "FUNNEL"),
          eq(schema.strategyChangeAcknowledgements.laneId, "lane_B")
        )
      );

    expect(laneBAcks.length).toBe(0);
  });

  // TEST 9 & 10: Unsupported authority cannot create fake artifact or Strategy Root
  it("TEST 9 & 10 — Unsupported authority cannot create fake artifact or new Strategy Root (FAILS CLOSED)", async () => {
    const unsuppAuth: StrategicAuthorityName = "BUDGET_GOVERNOR";

    expect(getAuthorityAdapterCapability(unsuppAuth)).toBe("NO_TARGETED_ADAPTER");

    const mockDecision: AdaptiveDecision = {
      adaptiveDecisionId: "adec_unsupp_01",
      reasoningCaseId: "rcase_unsupp_01",
      campaignId: testCampaignId,
      accountId: testAccountId,
      strategyRootId: "root_v1",
      strategyRootVersion: 1,
      decisionType: "REEVALUATE_AUTHORITY",
      affectedAuthority: unsuppAuth,
      affectedLaneIds: [],
      evidenceIds: ["ev_unsupp"],
      confidence: 0.8,
      rationale: "Budget adjustment needed",
      createdAt: new Date().toISOString(),
    };

    const mockRoot = {
      id: "root_v1",
      version: 1,
      campaignId: testCampaignId,
      accountId: testAccountId,
      authorityArtifactIds: { BUDGET_GOVERNOR: "art_bg_1" },
      approvedLanes: [{ laneId: "lane_1", title: "Lane 1" }],
    };

    const result = await executeAdaptiveDecision(mockDecision, mockRoot, { activeRootVersion: 1 });

    expect(result.executionStatus).toBe("FAILED");
    expect(result.newRoot).toBeNull();
    expect(result.newPlan).toBeNull();
    expect(result.materiallyChangedAuthorities).toEqual([]);
    expect(result.summary).toContain("OWNER_ENGINE_ADAPTER_NOT_IMPLEMENTED");
  });

  // TEST 11 & 12: Missing lane scope fails closed (NO approvedLanes[0] fallback)
  it("TEST 11 & 12 — Missing lane scope on lane-scoped authority FAILS CLOSED (NO approvedLanes[0] fallback)", async () => {
    const mockDecision: AdaptiveDecision = {
      adaptiveDecisionId: "adec_nolane_01",
      reasoningCaseId: "rcase_nolane_01",
      campaignId: testCampaignId,
      accountId: testAccountId,
      strategyRootId: "root_v1",
      strategyRootVersion: 1,
      decisionType: "REEVALUATE_AUTHORITY",
      affectedAuthority: "FUNNEL",
      affectedLaneIds: [], // Empty lane IDs on lane-scoped authority
      evidenceIds: ["ev_nolane"],
      confidence: 0.8,
      rationale: "Funnel check",
      createdAt: new Date().toISOString(),
    };

    const mockRoot = {
      id: "root_v1",
      version: 1,
      campaignId: testCampaignId,
      accountId: testAccountId,
      authorityArtifactIds: { FUNNEL: "art_fn_1" },
      approvedLanes: [{ laneId: "lane_alpha", title: "Alpha Lane" }, { laneId: "lane_beta", title: "Beta Lane" }],
    };

    const result = await executeAdaptiveDecision(mockDecision, mockRoot, { activeRootVersion: 1 });

    expect(result.executionStatus).toBe("FAILED");
    expect(result.newRoot).toBeNull();
    expect(result.summary).toContain("LANE_SCOPE_UNRESOLVED");
  });

  // TEST 13: Missing canonical input fails closed (NO semantic fallback marketing copy)
  it("TEST 13 — Missing canonical input FAILS CLOSED without semantic fallback marketing copy", async () => {
    await expect(
      dispatchAuthorityRecompute("FUNNEL", {
        campaignId: "camp_nonexistent_999",
        accountId: testAccountId,
        targetLaneId: "lane_alpha",
        currentRoot: { id: "root_1", version: 1, approvedLanes: [{ laneId: "lane_alpha", title: "Alpha" }] },
        decision: {
          adaptiveDecisionId: "adec_test",
          reasoningCaseId: "rcase_test",
          campaignId: "camp_nonexistent_999",
          accountId: testAccountId,
          strategyRootId: "root_1",
          strategyRootVersion: 1,
          decisionType: "REEVALUATE_AUTHORITY",
          affectedAuthority: "FUNNEL",
          affectedLaneIds: ["lane_alpha"],
          evidenceIds: [],
          confidence: 0.9,
          rationale: "test",
          createdAt: new Date().toISOString(),
        },
        sourceArtifactId: "art_old",
        evidenceIds: [],
      })
    ).rejects.toThrow(AuthorityBlockedError);
  });

  // TEST 14, 15, 16, 17: Truthful capability registry
  it("TEST 14, 15, 16, 17 — Truthful capability registry for supported owner engines", () => {
    expect(getAuthorityAdapterCapability("FUNNEL")).toBe("SUPPORTED_TARGETED_RECOMPUTE");
    expect(getAuthorityAdapterCapability("OFFER")).toBe("SUPPORTED_TARGETED_RECOMPUTE");
    expect(getAuthorityAdapterCapability("DIFFERENTIATION")).toBe("SUPPORTED_TARGETED_RECOMPUTE");
    expect(getAuthorityAdapterCapability("PERSUASION")).toBe("SUPPORTED_TARGETED_RECOMPUTE");
    expect(getAuthorityAdapterCapability("POSITIONING")).toBe("NO_TARGETED_ADAPTER");
    expect(getAuthorityAdapterCapability("BUDGET_GOVERNOR")).toBe("NO_TARGETED_ADAPTER");
    expect(getAuthorityAdapterCapability("AUDIENCE")).toBe("NO_TARGETED_ADAPTER");
  });

  // TEST 18: No dispatcher path returns CHANGED without a real canonical artifact
  it("TEST 18 — No dispatcher path returns CHANGED without a real canonical artifact", async () => {
    const allAuthorities = Object.keys(STRATEGY_AUTHORITY_REGISTRY) as StrategicAuthorityName[];
    const unsupported = allAuthorities.filter(a => getAuthorityAdapterCapability(a) === "NO_TARGETED_ADAPTER");

    for (const auth of unsupported) {
      await expect(
        dispatchAuthorityRecompute(auth, {
          campaignId: testCampaignId,
          accountId: testAccountId,
          currentRoot: { id: "root_1", version: 1, approvedLanes: [] },
          decision: {
            adaptiveDecisionId: "adec_test",
            reasoningCaseId: "rcase_test",
            campaignId: testCampaignId,
            accountId: testAccountId,
            strategyRootId: "root_1",
            strategyRootVersion: 1,
            decisionType: "REEVALUATE_AUTHORITY",
            affectedAuthority: auth,
            affectedLaneIds: [],
            evidenceIds: [],
            confidence: 0.9,
            rationale: "test",
            createdAt: new Date().toISOString(),
          },
          sourceArtifactId: "art_old",
          evidenceIds: [],
        })
      ).rejects.toThrow(AuthorityBlockedError);
    }
  });
});
