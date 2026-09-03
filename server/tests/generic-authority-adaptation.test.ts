import { describe, it, expect } from "vitest";
import {
  STRATEGY_AUTHORITY_REGISTRY,
  getAuthorityDefinition,
  isLaneScopedAuthority,
  isValidAuthorityName,
} from "../adaptive/authority-registry";
import { executeAdaptiveDecision } from "../adaptive/decision-executor";
import { planRecomputeCascade } from "../adaptive/cascade-planner";
import { dispatchAuthorityRecompute, AUTHORITY_ENGINE_HANDLERS } from "../adaptive/authority-dispatcher";
import { StrategicAuthorityName, AdaptiveDecision } from "../adaptive/contracts";

describe("Generic Strategy Authority Adaptation Framework", () => {
  it("verifies all registered authorities have valid owners and canonical tables", () => {
    const allAuthorities = Object.keys(STRATEGY_AUTHORITY_REGISTRY) as StrategicAuthorityName[];
    expect(allAuthorities.length).toBeGreaterThanOrEqual(18);

    for (const auth of allAuthorities) {
      const def = getAuthorityDefinition(auth);
      expect(def.authorityName).toBe(auth);
      expect(def.ownerEngine).toBeDefined();
      expect(def.canonicalTable).toBeDefined();
      expect(Array.isArray(def.upstreamDependencies)).toBe(true);
      expect(Array.isArray(def.downstreamDependents)).toBe(true);
    }
  });

  it("verifies classification of lane-scoped vs global authorities", () => {
    // Lane-scoped authorities
    expect(isLaneScopedAuthority("FUNNEL")).toBe(true);
    expect(isLaneScopedAuthority("PERSUASION")).toBe(true);
    expect(isLaneScopedAuthority("AWARENESS")).toBe(true);
    expect(isLaneScopedAuthority("STRATEGIC_LANES")).toBe(true);

    // Global authorities
    expect(isLaneScopedAuthority("OFFER")).toBe(false);
    expect(isLaneScopedAuthority("DIFFERENTIATION")).toBe(false);
    expect(isLaneScopedAuthority("POSITIONING")).toBe(false);
    expect(isLaneScopedAuthority("AUDIENCE")).toBe(false);
    expect(isLaneScopedAuthority("BUSINESS_UNDERSTANDING")).toBe(false);
    expect(isLaneScopedAuthority("PRODUCT_ASSESSMENT")).toBe(false);
    expect(isLaneScopedAuthority("TARGET_ASSESSMENT")).toBe(false);
    expect(isLaneScopedAuthority("STRATEGIC_PAIN_DECISION")).toBe(false);
    expect(isLaneScopedAuthority("CHANNEL_SELECTION")).toBe(false);
    expect(isLaneScopedAuthority("BUDGET_GOVERNOR")).toBe(false);
    expect(isLaneScopedAuthority("INTEGRITY")).toBe(false);
    expect(isLaneScopedAuthority("PLAN_SYNTHESIS")).toBe(false);
  });

  it("proves parameterized routing: FUNNEL -> FunnelEngine with lane scoping", async () => {
    const executedEngines: string[] = [];

    const mockDecision: AdaptiveDecision = {
      adaptiveDecisionId: "adec_test_funnel",
      reasoningCaseId: "rcase_test_funnel",
      campaignId: "camp_test_001",
      accountId: "acc_test_001",
      strategyRootId: "root_v1",
      strategyRootVersion: 1,
      decisionType: "REEVALUATE_AUTHORITY",
      affectedAuthority: "FUNNEL",
      affectedLaneIds: ["lane_custom_alpha"],
      evidenceIds: ["ev_01"],
      confidence: 0.9,
      rationale: "Friction in funnel onboarding",
      createdAt: new Date().toISOString(),
    };

    const mockRoot = {
      id: "root_v1",
      version: 1,
      campaignId: "camp_test_001",
      accountId: "acc_test_001",
      authorityArtifactIds: { FUNNEL: "art_fn_1", PERSUASION: "art_pers_1" },
      primaryAxis: "simplicity",
      approvedLanes: [{ laneId: "lane_custom_alpha", title: "Alpha Lane" }, { laneId: "lane_beta", title: "Beta Lane" }],
    };

    const result = await executeAdaptiveDecision(
      mockDecision,
      mockRoot,
      { activeRootVersion: 1 },
      {
        mockEngineHandler: async (authority, sourceId, evIds) => {
          const def = getAuthorityDefinition(authority);
          executedEngines.push(def.ownerEngine);
          return {
            result: "CHANGED",
            newArtifactId: `art_${authority.toLowerCase()}_new`,
            payload: { authority, lane: mockDecision.affectedLaneIds[0] },
          };
        },
      }
    );

    expect(result.executionStatus).toBe("STRATEGY_UPDATED");
    expect(result.materiallyChangedAuthorities).toEqual(["FUNNEL"]);
    expect(result.revalidatedAuthorities).toContain("PERSUASION");
    expect(result.reassembledAuthorities).toEqual(["PLAN_SYNTHESIS"]);
    expect(result.preservedAuthorities).toContain("AUDIENCE");
    expect(result.preservedAuthorities).toContain("POSITIONING");
    expect(executedEngines[0]).toBe("FunnelEngine");
  });

  it("proves parameterized routing: OFFER -> OfferEngine with lane-scoping", async () => {
    const executedEngines: string[] = [];

    const mockDecision: AdaptiveDecision = {
      adaptiveDecisionId: "adec_test_offer",
      reasoningCaseId: "rcase_test_offer",
      campaignId: "camp_test_002",
      accountId: "acc_test_002",
      strategyRootId: "root_v2",
      strategyRootVersion: 2,
      decisionType: "REEVALUATE_AUTHORITY",
      affectedAuthority: "OFFER",
      affectedLaneIds: ["lane_custom_gamma"],
      evidenceIds: ["ev_02"],
      confidence: 0.88,
      rationale: "Competitor pricing model shift",
      createdAt: new Date().toISOString(),
    };

    const mockRoot = {
      id: "root_v2",
      version: 2,
      campaignId: "camp_test_002",
      accountId: "acc_test_002",
      authorityArtifactIds: { OFFER: "art_offer_1", FUNNEL: "art_fn_1" },
      primaryAxis: "value",
      approvedLanes: [{ laneId: "lane_custom_gamma", title: "Gamma Lane" }],
    };

    const result = await executeAdaptiveDecision(
      mockDecision,
      mockRoot,
      { activeRootVersion: 2 },
      {
        mockEngineHandler: async (authority, sourceId, evIds) => {
          const def = getAuthorityDefinition(authority);
          executedEngines.push(def.ownerEngine);
          return {
            result: "CHANGED",
            newArtifactId: `art_${authority.toLowerCase()}_new`,
            payload: { authority },
          };
        },
      }
    );

    expect(result.executionStatus).toBe("STRATEGY_UPDATED");
    expect(result.materiallyChangedAuthorities).toEqual(["OFFER"]);
    expect(result.revalidatedAuthorities).toContain("FUNNEL");
    expect(result.reassembledAuthorities).toEqual(["PLAN_SYNTHESIS"]);
    expect(executedEngines[0]).toBe("OfferEngine");
  });

  it("proves parameterized routing: POSITIONING -> PositioningEngine (Global Authority, empty lane IDs)", async () => {
    const executedEngines: string[] = [];

    const mockDecision: AdaptiveDecision = {
      adaptiveDecisionId: "adec_test_pos",
      reasoningCaseId: "rcase_test_pos",
      campaignId: "camp_test_003",
      accountId: "acc_test_003",
      strategyRootId: "root_v3",
      strategyRootVersion: 3,
      decisionType: "REEVALUATE_AUTHORITY",
      affectedAuthority: "POSITIONING",
      affectedLaneIds: [], // Global authority — legitimately empty lane IDs
      evidenceIds: ["ev_03"],
      confidence: 0.92,
      rationale: "Category territory narrative shift",
      createdAt: new Date().toISOString(),
    };

    const mockRoot = {
      id: "root_v3",
      version: 3,
      campaignId: "camp_test_003",
      accountId: "acc_test_003",
      authorityArtifactIds: { POSITIONING: "art_pos_1", DIFFERENTIATION: "art_diff_1" },
      primaryAxis: "speed",
      approvedLanes: [{ laneId: "lane_1", title: "Lane 1" }],
    };

    const result = await executeAdaptiveDecision(
      mockDecision,
      mockRoot,
      { activeRootVersion: 3 },
      {
        mockEngineHandler: async (authority, sourceId, evIds) => {
          const def = getAuthorityDefinition(authority);
          executedEngines.push(def.ownerEngine);
          return {
            result: "CHANGED",
            newArtifactId: `art_${authority.toLowerCase()}_new`,
            payload: { authority },
          };
        },
      }
    );

    expect(result.executionStatus).toBe("STRATEGY_UPDATED");
    expect(result.materiallyChangedAuthorities).toEqual(["POSITIONING"]);
    expect(result.revalidatedAuthorities).toContain("DIFFERENTIATION");
    expect(result.reassembledAuthorities).toEqual(["PLAN_SYNTHESIS"]);
    expect(executedEngines[0]).toBe("PositioningEngine");
  });

  it("verifies clean separation: NO false UPDATED badges on revalidated or preserved authorities", async () => {
    const mockDecision: AdaptiveDecision = {
      adaptiveDecisionId: "adec_test_diff",
      reasoningCaseId: "rcase_test_diff",
      campaignId: "camp_test_004",
      accountId: "acc_test_004",
      strategyRootId: "root_v4",
      strategyRootVersion: 4,
      decisionType: "REEVALUATE_AUTHORITY",
      affectedAuthority: "DIFFERENTIATION",
      affectedLaneIds: ["lane_diff_scoped"],
      evidenceIds: ["ev_04"],
      confidence: 0.85,
      rationale: "Differentiation pillar update",
      createdAt: new Date().toISOString(),
    };

    const mockRoot = {
      id: "root_v4",
      version: 4,
      campaignId: "camp_test_004",
      accountId: "acc_test_004",
      authorityArtifactIds: { DIFFERENTIATION: "art_diff_1", OFFER: "art_off_1" },
      primaryAxis: "clarity",
      approvedLanes: [{ laneId: "lane_diff_scoped", title: "Diff Lane" }],
    };

    const result = await executeAdaptiveDecision(
      mockDecision,
      mockRoot,
      { activeRootVersion: 4 },
      {
        mockEngineHandler: async (authority, sourceId, evIds) => {
          // Only initial authority DIFFERENTIATION changes materially; downstream OFFER is checked and remains valid
          if (authority === "DIFFERENTIATION") {
            return { result: "CHANGED", newArtifactId: "art_diff_v5", payload: { authority } };
          }
          return { result: "NO_CHANGE_REQUIRED", payload: { authority } };
        },
      }
    );

    // Hard rule validation
    expect(result.materiallyChangedAuthorities).toEqual(["DIFFERENTIATION"]);
    expect(result.materiallyChangedAuthorities).not.toContain("OFFER");
    expect(result.materiallyChangedAuthorities).not.toContain("AUDIENCE");
    expect(result.materiallyChangedAuthorities).not.toContain("PLAN_SYNTHESIS");
    expect(result.revalidatedAuthorities).toContain("OFFER");
    expect(result.preservedAuthorities).toContain("AUDIENCE");
    expect(result.reassembledAuthorities).toEqual(["PLAN_SYNTHESIS"]);
  });
});
