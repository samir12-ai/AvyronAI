import "dotenv/config";
import { describe, it, expect, vi } from "vitest";
import { runProductAssessmentForPain } from "../strategic-reasoning/product-assessment";
import {
  classifyTerritoryLevel,
  filterAudienceTerritories,
  evaluateCompressionQuality,
  type Territory,
} from "../positioning-engine/engine";
import * as aiClient from "../ai-client";

describe("Phase 4: Claim Integrity & Category-Neutral Positioning", () => {
  const synthAccountId = `tenant_synth_p4_${Date.now()}`;
  const synthCampaignId = `camp_synth_p4_${Date.now()}`;
  const synthJobId = `job_synth_p4_${Date.now()}`;

  describe("Product Assessment Epistemic Boundaries & Compound Needs", () => {
    it("demotes packaging alone to STRATEGIC_FIT for courier transit crushing with unresolved requirements", async () => {
      // Mock LLM returning naive DIRECT_FIT for packaging
      vi.spyOn(aiClient, "aiChat").mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                fitType: "DIRECT_FIT",
                reason: "Protective food-grade metal box packaging addresses transit crushing.",
                requirementBreakdown: [
                  {
                    requirement: "Protective food-grade packaging",
                    status: "SUPPORTED",
                    evidenceFactIds: ["FACT-1"],
                  },
                ],
                proposedPrerequisites: [],
                unprovenParts: [],
              }),
            },
          },
        ],
      } as any);

      const result = await runProductAssessmentForPain({
        painId: "pain_synth_transit_crush",
        canonicalPain: "Pastries arrive crushed and broken during courier transit",
        campaignOfferingId: "off_synth_sweets_400g",
        businessUnderstandingAuthorityId: "bu_auth_synth_1",
        productTruthFacts: [
          {
            productTruthFactId: "FACT-1",
            statement: "Packaged in protective decorative food-grade tin box",
            verifiedCapability: "Food-grade interior lining in rigid decorative tin",
          },
        ],
        accountId: synthAccountId,
        campaignId: synthCampaignId,
        jobId: synthJobId,
      });

      // Deterministic epistemic rule must override naive DIRECT_FIT to STRATEGIC_FIT
      expect(result.fitType).toBe("STRATEGIC_FIT");
      expect(result.reason).toContain("does not guarantee crush-proof courier transit");
      expect(result.unprovenParts).toBeDefined();
      expect(result.unprovenParts?.some(u => u.includes("crush") || u.includes("transit"))).toBe(true);
      expect(result.requirementBreakdown?.some(r => r.status === "REQUIRES_DEVELOPMENT")).toBe(true);
    });

    it("requires all clauses of compound pain to be proven for DIRECT_FIT", async () => {
      vi.spyOn(aiClient, "aiChat").mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                fitType: "DIRECT_FIT", // Naive claim of direct fit despite unproven clause
                reason: "Natural ingredients and quick delivery.",
                requirementBreakdown: [
                  {
                    requirement: "100% pure butter and natural honey",
                    status: "SUPPORTED",
                    evidenceFactIds: ["FACT-INGRED"],
                  },
                  {
                    requirement: "Guaranteed same-day courier dispatch SLA",
                    status: "REQUIRES_DEVELOPMENT",
                    notes: "Dispatch SLA is unverified",
                  },
                ],
                unprovenParts: ["Guaranteed same-day courier dispatch SLA"],
              }),
            },
          },
        ],
      } as any);

      const result = await runProductAssessmentForPain({
        painId: "pain_synth_compound",
        canonicalPain: "Artificial additives and delayed courier dispatch",
        campaignOfferingId: "off_synth_sweets_400g",
        businessUnderstandingAuthorityId: "bu_auth_synth_1",
        productTruthFacts: [
          {
            productTruthFactId: "FACT-INGRED",
            statement: "Made with 100% clarified butter and orange blossom water",
          },
        ],
        accountId: synthAccountId,
        campaignId: synthCampaignId,
        jobId: synthJobId,
      });

      expect(result.fitType).toBe("STRATEGIC_FIT");
      expect(result.reason).toContain("Compound pain has unresolved requirements");
      expect(result.unprovenParts).toContain("Guaranteed same-day courier dispatch SLA");
    });
  });

  describe("Category-Neutral Positioning Structure", () => {
    it("accepts a valid territory with operational mechanism even if it lacks predefined nouns", () => {
      const validTerritoryWithoutPredefinedNouns: Territory = {
        name: "Ambient thermal degradation during cross-border courier handoffs",
        enemyDefinition: "Delicate pastry fillings degrade because prolonged uninsulated transit exposes items to extreme ambient temperature fluctuations.",
        narrativeDirection: "Direct temperature-monitored refrigerated dispatch preserving delicate crispness from baker to door.",
        domainFailure: "Unmonitored freight handoffs lead to filling melting and pastry texture collapse.",
        operationalProblem: "Prolonged courier transit handoffs without thermal buffering.",
        confidenceScore: 0.85,
        targetPains: ["pain_thermal_collapse"],
        mappedSignalIds: ["sig_1", "sig_2"],
      } as any;

      const classification = classifyTerritoryLevel(validTerritoryWithoutPredefinedNouns);
      expect(classification.level).toBe("system");
      expect(classification.reasons.length).toBe(0);

      const { systemLevel, rejected } = filterAudienceTerritories([validTerritoryWithoutPredefinedNouns]);
      expect(systemLevel.length).toBe(1);
      expect(rejected.length).toBe(0);

      const compressionScore = evaluateCompressionQuality(validTerritoryWithoutPredefinedNouns);
      expect(compressionScore).toBeGreaterThanOrEqual(0.70);
    });

    it("rejects an unsupported territory that contains an approved noun but lacks operational mechanism", () => {
      const unsupportedWithNoun: Territory = {
        name: "Customer Box Happiness and Delight",
        enemyDefinition: "People want happiness and nice feeling when opening boxes.",
        narrativeDirection: "Bring joy and wonderful celebration to every customer.",
        confidenceScore: 0.80,
        targetPains: [],
        mappedSignalIds: [],
      } as any;

      const classification = classifyTerritoryLevel(unsupportedWithNoun);
      expect(classification.level).not.toBe("system");

      const { systemLevel, rejected } = filterAudienceTerritories([unsupportedWithNoun]);
      expect(systemLevel.length).toBe(0);
      expect(rejected.length).toBe(1);
    });
  });
});
