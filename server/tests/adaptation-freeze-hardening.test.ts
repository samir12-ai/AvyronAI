import "dotenv/config";
import { describe, it, expect, beforeEach } from "vitest";
import {
  STRATEGY_AUTHORITY_REGISTRY,
  isLaneScopedAuthority,
  getAuthorityDefinition,
} from "../adaptive/authority-registry";
import { executeAdaptiveDecision } from "../adaptive/decision-executor";
import {
  dispatchAuthorityRecompute,
  getAuthorityAdapterCapability,
  AuthorityBlockedError,
  areFunnelsSemanticallyEquivalent,
  areOffersSemanticallyEquivalent,
  areDifferentiationsSemanticallyEquivalent,
  arePersuasionsSemanticallyEquivalent,
} from "../adaptive/authority-dispatcher";
import { StrategyExperienceService } from "../strategy-experience/service";
import { StrategicAuthorityName, AdaptiveDecision } from "../adaptive/contracts";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and } from "drizzle-orm";

describe("Adaptation Freeze Hardening & 4-Issue Verification Suite", () => {
  const testCampaignId = "camp_freeze_test_001";
  const testAccountId = "acc_freeze_test_001";
  const testUserId = "user_freeze_tester_001";

  beforeEach(async () => {
    try {
      await db
        .delete(schema.strategyChangeAcknowledgements)
        .where(eq(schema.strategyChangeAcknowledgements.campaignId, testCampaignId));
    } catch {}
  });

  // GAP 1 & 2: FUNNEL CANONICAL SEMANTIC COMPARISON
  describe("Gap 2: Funnel Material Change Detection", () => {
    const baseFunnel = {
      primaryFunnel: {
        steps: [
          {
            name: "Top of Funnel",
            order: 0,
            objective: "Build pain awareness",
            awarenessState: "unaware_to_problem_aware",
            primaryFriction: "Attention deficit",
            trustRequirement: "Practitioner credibility",
            proofPlacement: "Case study snippet",
            microCommitment: "Read 2-min breakdown",
            cta: "Explore Analysis",
            offerTransition: "None",
            objectionResolution: "Status quo is costly",
            conversionMechanism: "Diagnostic hook",
          },
          {
            name: "Conversion Stage",
            order: 1,
            objective: "Trigger trial sign-up",
            awarenessState: "solution_aware",
            primaryFriction: "Switching risk",
            trustRequirement: "Guaranteed migration",
            proofPlacement: "Enterprise testimonial",
            microCommitment: "14-day free trial",
            cta: "Start Free Trial",
            offerTransition: "Core Offer Suite",
            objectionResolution: "No credit card required",
            conversionMechanism: "Frictionless SSO",
          },
        ],
      },
    };

    it("1. Funnel with same stage names but different CTA is detected as CHANGED", () => {
      const modifiedFunnel = JSON.parse(JSON.stringify(baseFunnel));
      modifiedFunnel.primaryFunnel.steps[1].cta = "Book Live Demo"; // Changed CTA

      const isEquiv = areFunnelsSemanticallyEquivalent(baseFunnel, modifiedFunnel);
      expect(isEquiv).toBe(false);
    });

    it("2. Funnel with same stages but different proof placement is detected as CHANGED", () => {
      const modifiedFunnel = JSON.parse(JSON.stringify(baseFunnel));
      modifiedFunnel.primaryFunnel.steps[0].proofPlacement = "Peer benchmark data"; // Changed proof

      const isEquiv = areFunnelsSemanticallyEquivalent(baseFunnel, modifiedFunnel);
      expect(isEquiv).toBe(false);
    });

    it("3. Funnel with different micro-commitment is detected as CHANGED", () => {
      const modifiedFunnel = JSON.parse(JSON.stringify(baseFunnel));
      modifiedFunnel.primaryFunnel.steps[0].microCommitment = "Watch 10-min webinar"; // Changed commitment

      const isEquiv = areFunnelsSemanticallyEquivalent(baseFunnel, modifiedFunnel);
      expect(isEquiv).toBe(false);
    });

    it("4. Funnel with identical semantic meaning (whitespace/casing variations) returns NO_CHANGE_REQUIRED", () => {
      const normalizedSameFunnel = {
        primaryFunnel: {
          steps: [
            {
              name: " TOP OF FUNNEL  ",
              order: 0,
              objective: "Build pain awareness",
              awarenessState: "unaware_to_problem_aware",
              primaryFriction: "Attention deficit",
              trustRequirement: "Practitioner credibility",
              proofPlacement: "Case study snippet",
              microCommitment: "Read 2-min breakdown",
              cta: "Explore Analysis ",
              offerTransition: "None",
              objectionResolution: "Status quo is costly",
              conversionMechanism: "Diagnostic hook",
            },
            {
              name: "Conversion Stage",
              order: 1,
              objective: "Trigger trial sign-up",
              awarenessState: "solution_aware",
              primaryFriction: "Switching risk",
              trustRequirement: "Guaranteed migration",
              proofPlacement: "Enterprise testimonial",
              microCommitment: "14-day free trial",
              cta: "Start Free Trial",
              offerTransition: "Core Offer Suite",
              objectionResolution: "No credit card required",
              conversionMechanism: "Frictionless SSO",
            },
          ],
        },
      };

      const isEquiv = areFunnelsSemanticallyEquivalent(baseFunnel, normalizedSameFunnel);
      expect(isEquiv).toBe(true);
    });
  });

  // GAP 3: PERSUASION STRICT LANE ISOLATION
  describe("Gap 3: Persuasion Lane Isolation", () => {
    it("5 & 6. Persuasion is strictly lane-scoped and fails closed if lane is missing", async () => {
      expect(isLaneScopedAuthority("PERSUASION")).toBe(true);

      const mockDecision: AdaptiveDecision = {
        adaptiveDecisionId: "adec_pers_nolane",
        reasoningCaseId: "rcase_pers_nolane",
        campaignId: testCampaignId,
        accountId: testAccountId,
        strategyRootId: "root_v1",
        strategyRootVersion: 1,
        decisionType: "REEVALUATE_AUTHORITY",
        affectedAuthority: "PERSUASION",
        affectedLaneIds: [], // Missing lane!
        evidenceIds: ["ev_1"],
        confidence: 0.9,
        rationale: "Objection friction",
        createdAt: new Date().toISOString(),
      };

      const mockRoot = {
        id: "root_v1",
        version: 1,
        campaignId: testCampaignId,
        accountId: testAccountId,
        authorityArtifactIds: { PERSUASION: "art_pers_1" },
        approvedLanes: [{ laneId: "lane_A", title: "Lane A" }, { laneId: "lane_B", title: "Lane B" }],
      };

      const result = await executeAdaptiveDecision(mockDecision, mockRoot, { activeRootVersion: 1 });
      expect(result.executionStatus).toBe("FAILED");
      expect(result.newRoot).toBeNull();
      expect(result.summary).toContain("LANE_SCOPE_UNRESOLVED");
    });

    it("7 & 8. Persuasion fails closed if specific lane Funnel is not found (no cross-lane fallback)", async () => {
      await expect(
        dispatchAuthorityRecompute("PERSUASION", {
          campaignId: "camp_nonexistent_pers",
          accountId: testAccountId,
          targetLaneId: "lane_A",
          currentRoot: {
            id: "root_1",
            version: 1,
            approvedLanes: [{ laneId: "lane_A", title: "Lane A" }, { laneId: "lane_B", title: "Lane B" }],
          },
          decision: {
            adaptiveDecisionId: "adec_test",
            reasoningCaseId: "rcase_test",
            campaignId: "camp_nonexistent_pers",
            accountId: testAccountId,
            strategyRootId: "root_1",
            strategyRootVersion: 1,
            decisionType: "REEVALUATE_AUTHORITY",
            affectedAuthority: "PERSUASION",
            affectedLaneIds: ["lane_A"],
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
  });

  // GAP 4: OFFER & DIFFERENTIATION CANONICAL SCOPE INTEGRITY
  describe("Gap 4: Offer & Differentiation Canonical Scope Integrity", () => {
    it("9. OFFER is truthfully classified as GLOBAL in the Registry matching offer_snapshots canonical table", () => {
      expect(isLaneScopedAuthority("OFFER")).toBe(false);
      const def = getAuthorityDefinition("OFFER");
      expect(def.canonicalTable).toBe("offer_snapshots");
      expect(getAuthorityAdapterCapability("OFFER")).toBe("SUPPORTED_TARGETED_RECOMPUTE");
    });

    it("10. DIFFERENTIATION is truthfully classified as GLOBAL in the Registry matching differentiation_snapshots", () => {
      expect(isLaneScopedAuthority("DIFFERENTIATION")).toBe(false);
      const def = getAuthorityDefinition("DIFFERENTIATION");
      expect(def.canonicalTable).toBe("differentiation_snapshots");
      expect(getAuthorityAdapterCapability("DIFFERENTIATION")).toBe("SUPPORTED_TARGETED_RECOMPUTE");
    });

    it("11. FUNNEL, PERSUASION, AWARENESS, and STRATEGIC_LANES are strictly lane-scoped", () => {
      expect(isLaneScopedAuthority("FUNNEL")).toBe(true);
      expect(isLaneScopedAuthority("PERSUASION")).toBe(true);
      expect(isLaneScopedAuthority("AWARENESS")).toBe(true);
      expect(isLaneScopedAuthority("STRATEGIC_LANES")).toBe(true);
    });
  });

  // GAP 1: REMOVAL OF SEMANTIC FALLBACKS & FAIL-CLOSED INTEGRITY
  describe("Gap 1: Removal of Semantic Fallbacks & Fail-Closed Integrity", () => {
    it("12. Missing required canonical inputs fails closed without fabricating marketing copy", async () => {
      await expect(
        dispatchAuthorityRecompute("FUNNEL", {
          campaignId: "camp_empty_test_999",
          accountId: testAccountId,
          targetLaneId: "lane_A",
          currentRoot: {
            id: "root_1",
            version: 1,
            approvedLanes: [{ laneId: "lane_A", title: "Lane A" }],
          },
          decision: {
            adaptiveDecisionId: "adec_test",
            reasoningCaseId: "rcase_test",
            campaignId: "camp_empty_test_999",
            accountId: testAccountId,
            strategyRootId: "root_1",
            strategyRootVersion: 1,
            decisionType: "REEVALUATE_AUTHORITY",
            affectedAuthority: "FUNNEL",
            affectedLaneIds: ["lane_A"],
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

    it("13. Semantic Equivalence checkers for OFFER, DIFFERENTIATION, and PERSUASION", () => {
      // Offer equivalence
      const off1 = {
        primaryOffer: {
          offerName: "Enterprise Cloud Suite",
          coreOutcome: "Automate social publishing across all channels",
          mechanismDescription: "Multi-network queue engine",
          deliverables: ["Analytics Dashboard", "Publishing Calendar"],
          pricingModel: { monthly: 99 },
          guaranteeStructure: { trialDays: 14 },
        },
      };
      const off2 = JSON.parse(JSON.stringify(off1));
      expect(areOffersSemanticallyEquivalent(off1, off2)).toBe(true);

      off2.primaryOffer.offerName = "Pro Social Suite";
      expect(areOffersSemanticallyEquivalent(off1, off2)).toBe(false);

      // Differentiation equivalence
      const diff1 = {
        pillars: [{ name: "Automated Simplicity", contrast: "Complex enterprise suites" }],
        mechanismFraming: { type: "Speed" },
        authorityMode: { mode: "PRACTITIONER_AUTHORITY" },
      };
      const diff2 = JSON.parse(JSON.stringify(diff1));
      expect(areDifferentiationsSemanticallyEquivalent(diff1, diff2)).toBe(true);

      diff2.pillars[0].name = "Unified Analytics";
      expect(areDifferentiationsSemanticallyEquivalent(diff1, diff2)).toBe(false);

      // Persuasion equivalence
      const pers1 = {
        objectionPlaybook: { "Too expensive": "Saves 10h/week" },
        proofMappings: [{ objection: "Too expensive", proofId: "roi_calculator" }],
      };
      const pers2 = JSON.parse(JSON.stringify(pers1));
      expect(arePersuasionsSemanticallyEquivalent(pers1, pers2)).toBe(true);

      pers2.objectionPlaybook["Too expensive"] = "Free trial included";
      expect(arePersuasionsSemanticallyEquivalent(pers1, pers2)).toBe(false);
    });
  });

  // MATERIAL CHANGE & BADGE LIFECYCLE REAFFIRMATION
  describe("Material Change & Badge Lifecycle Reaffirmation", () => {
    it("14. Material change produces UPDATED badge", async () => {
      const mockDecision: AdaptiveDecision = {
        adaptiveDecisionId: "adec_mat_test",
        reasoningCaseId: "rcase_mat_test",
        campaignId: testCampaignId,
        accountId: testAccountId,
        strategyRootId: "root_v1",
        strategyRootVersion: 1,
        decisionType: "REEVALUATE_AUTHORITY",
        affectedAuthority: "FUNNEL",
        affectedLaneIds: ["lane_A"],
        evidenceIds: ["ev_01"],
        confidence: 0.9,
        rationale: "Friction reduction",
        createdAt: new Date().toISOString(),
      };

      const mockRoot = {
        id: "root_v1",
        version: 1,
        campaignId: testCampaignId,
        accountId: testAccountId,
        authorityArtifactIds: { FUNNEL: "art_fn_1", PERSUASION: "art_pers_1" },
        approvedLanes: [{ laneId: "lane_A", title: "Lane A" }],
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
      expect(result.revalidatedAuthorities).toContain("PERSUASION");
    });

    it("15. NO_CHANGE_REQUIRED does not create a new Strategy Root or UPDATED badge", async () => {
      const mockDecision: AdaptiveDecision = {
        adaptiveDecisionId: "adec_nochange_test",
        reasoningCaseId: "rcase_nochange_test",
        campaignId: testCampaignId,
        accountId: testAccountId,
        strategyRootId: "root_v1",
        strategyRootVersion: 1,
        decisionType: "REEVALUATE_AUTHORITY",
        affectedAuthority: "FUNNEL",
        affectedLaneIds: ["lane_A"],
        evidenceIds: ["ev_01"],
        confidence: 0.9,
        rationale: "Friction reduction check",
        createdAt: new Date().toISOString(),
      };

      const mockRoot = {
        id: "root_v1",
        version: 1,
        campaignId: testCampaignId,
        accountId: testAccountId,
        authorityArtifactIds: { FUNNEL: "art_fn_1" },
        approvedLanes: [{ laneId: "lane_A", title: "Lane A" }],
      };

      const result = await executeAdaptiveDecision(
        mockDecision,
        mockRoot,
        { activeRootVersion: 1 },
        {
          mockEngineHandler: async () => {
            return { result: "NO_CHANGE_REQUIRED", payload: {} };
          },
        }
      );

      expect(result.executionStatus).toBe("NO_CHANGE_CONFIRMED");
      expect(result.materiallyChangedAuthorities).toEqual([]);
      expect(result.changedAuthorities).toEqual([]);
      expect(result.newRoot).toBeNull();
    });

    it("16. User acknowledgement dismisses UPDATED badge for current root version", async () => {
      const ack = await StrategyExperienceService.acknowledgeChange({
        accountId: testAccountId,
        campaignId: testCampaignId,
        userId: testUserId,
        strategyRootId: "root_v6",
        rootBundleVersion: 6,
        authority: "FUNNEL",
        laneId: "lane_A",
      });

      expect(ack.success).toBe(true);
      expect(ack.acknowledged).toBe(true);
    });
  });
});
