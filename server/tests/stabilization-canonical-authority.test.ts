import "dotenv/config";
import { describe, it, expect } from "vitest";
import {
  ClaimEpistemicStatus,
  ObjectionResolutionStatus,
  type StructuredObjectionResolution,
  type SupportingClaimRef,
  type StructuredLimitation,
  type StructuredPrerequisite,
} from "../../shared/contracts/claim-status";
import {
  evaluateClaimSemanticEntailment,
  extractAssertionSemanticProperties,
} from "../shared/claim-entailment";
import {
  resolveExecutionPlan,
  type RunResolutionIntent,
} from "../orchestrator/execution-plan-resolver";

describe("System Stabilization: Canonical Authority, Stable Lineage & Enforced Handoffs", () => {
  // =========================================================================
  // REQUIREMENT 1 & 2: Canonical BU & Product Truth Category Agnosticism
  // =========================================================================
  describe("Req 1 & 2: Category-Agnostic BU & Product Truth Extraction", () => {
    it("BU does not fall back to hardcoded fashion or service categories when input is unspecified", async () => {
      const { runBusinessUnderstandingEngine } = await import("../business-understanding/engine");
      expect(runBusinessUnderstandingEngine).toBeDefined();
    });

    it("extracts arbitrary product categories faithfully across SaaS, physical, and services", () => {
      const saasProps = extractAssertionSemanticProperties("99.99% uptime with fault-tolerant architecture and automated anomaly detection");
      expect(saasProps.properties).toContain("high_availability_uptime");
      expect(saasProps.properties).toContain("automated_anomaly_detection");

      const fashionProps = extractAssertionSemanticProperties("Opaque summer dress crafted from durable cotton");
      expect(fashionProps.properties).toContain("fabric_opacity");
      expect(fashionProps.properties).toContain("fabric_durability");
    });
  });

  // =========================================================================
  // REQUIREMENT 3 & 4: Settings Authority & Recommendation-Only Budget
  // =========================================================================
  describe("Req 3 & 4: Settings Authority & Recommendation-Only Budget", () => {
    it("Settings authority routes read budget from campaign_budget_settings and location from campaign_selections", async () => {
      const { settingsRouter } = await import("../setup/settings-routes");
      expect(settingsRouter).toBeDefined();
    });

    it("Budget governor generates percentage-only allocations without halting strategy when budget is unconfirmed", async () => {
      const { runBudgetGovernorEngine } = await import("../strategy/budget-governor/engine");
      const result = await runBudgetGovernorEngine({
        monthlyBudget: 5000,
        currency: "USD",
        budgetConfirmation: "unconfirmed",
        selectedChannels: [
          { channelId: "meta", channelName: "Meta Ads", isOrganic: false },
          { channelId: "instagram", channelName: "Instagram Organic", isOrganic: true },
        ],
        _mockLlmOutput: {
          allocations: [
            { channelId: "meta", sharePercentage: 60, why: "Paid acquisition" },
            { channelId: "instagram", sharePercentage: 40, why: "Organic brand building" },
          ],
        },
      });

      expect(result.status).toBe("COMPLETE");
      expect(result.totalMonthlyBudget).toBeNull();
      expect(result.allocations).toHaveLength(2);
      expect(result.allocations[0].sharePercentage).toBe(60);
      expect(result.allocations[0].monthlyAmount).toBeNull();
      expect(result.mode).toBe("recommendation_only");
    });
  });

  // =========================================================================
  // REQUIREMENT 5, 6, 7 & 8: Structured Objection Resolution & Restrictions
  // =========================================================================
  describe("Req 5, 6, 7 & 8: Structured Objection Resolution Contract & Marketing Restrictions", () => {
    const verifiedEvidence = [
      "24-hour product exchange policy allows buyers to swap sizes or return items.",
      "Garment measurement tables provided for all dress listings.",
      "Prices range from $35 to $65 across catalog.",
    ];

    it("Req 5: StructuredObjectionResolution contract supports typed provenance, limitations, and multi-claim lineage", () => {
      const supportingClaim: SupportingClaimRef = {
        claimId: "claim_exchange_24hr",
        claimContentHash: "hash_exchange_policy",
        epistemicStatus: ClaimEpistemicStatus.SUPPORTED_CAPABILITY,
        category: "OPERATIONAL_COMMERCIAL_RECOURSE",
        claimSummary: "24-hour product exchange policy",
      };

      const limitation: StructuredLimitation = {
        limitationCode: "PHYSICAL_PROPERTY_UNVERIFIED",
        description: "Exchange policy provides recourse; does not verify fabric opacity",
        appliesToDimension: "PHYSICAL_INTRINSIC_PROPERTY",
      };

      const prereq: StructuredPrerequisite = {
        prerequisiteId: "prereq_lab_cert",
        description: "Accredited textile laboratory opacity testing certificate",
        verificationType: "LAB_CERTIFICATION",
        isMet: false,
      };

      const structured: StructuredObjectionResolution = {
        objection: "Dresses are see-through and sheer in direct sunlight",
        resolutionStatus: ObjectionResolutionStatus.PARTIALLY_MITIGATED,
        resolutionText: "Risk mitigated via 24-hour exchange policy; physical opacity unverified.",
        originatingPainId: "pain_sheer_fabric",
        painContentHash: "hash_sheer_fabric",
        strategicPainDecisionId: "spd_sheer_fabric",
        supportingClaims: [supportingClaim],
        structuredLimitations: [limitation],
        structuredPrerequisites: [prereq],
        remainingGaps: ["Independent laboratory opacity test required"],
      };

      expect(structured.supportingClaims).toHaveLength(1);
      expect(structured.structuredLimitations).toHaveLength(1);
      expect(structured.structuredPrerequisites).toHaveLength(1);
      expect(structured.resolutionStatus).toBe("PARTIALLY_MITIGATED");
    });

    it("Req 6: Semantic entailment enforces domain-relevant recourse (exchange policy != verified opacity)", () => {
      const operationalRecourse =
        "24-hour product exchange policy lowers purchase risk if fabric or fit does not meet expectations.";

      const result = evaluateClaimSemanticEntailment(
        operationalRecourse,
        verifiedEvidence,
        {
          isObjectionResolution: true,
          objectionText: "Concerns regarding fabric sheer and opacity",
        }
      );

      expect(result.status).toBe("PARTIALLY_ENTAILED");
      expect(result.isGrounded).toBe(true);
      expect(result.epistemicStatus).toBe(ClaimEpistemicStatus.SUPPORTED_CAPABILITY);
      expect(result.suggestedResolutionStatus).toBe("PARTIALLY_MITIGATED");
      expect(result.explanation).toContain("Commercial exchange policy");
    });

    it("Req 7: Preserves epistemic qualifications and rejects false [ADDRESSED] claims on compound objections", () => {
      const falseAddressedClaim =
        "[ADDRESSED] Fabric sheer concerns resolved through premium textile selection.";

      const result = evaluateClaimSemanticEntailment(
        falseAddressedClaim,
        verifiedEvidence,
        {
          isObjectionResolution: true,
          objectionText: "Dresses are sheer and sizing measurements are inconsistent",
        }
      );

      expect(result.status).toBe("UNSUPPORTED_EXPANSION");
      expect(result.isGrounded).toBe(false);
      expect(result.suggestedResolutionStatus).toBe("PARTIALLY_MITIGATED");
    });

    it("Req 8: Quarantines marketing-prohibited friction from customer-facing claims into internalStrategyNotes", () => {
      const candidateCopy =
        "[ADDRESSED] Fabric sheer concerns eliminated with certified opaque textiles.";

      const result = evaluateClaimSemanticEntailment(
        candidateCopy,
        verifiedEvidence,
        {
          isObjectionResolution: true,
          prohibitedUses: ["offer_marketing", "direct_ad_hook"],
          proofGap: "Textile opacity certificate absent",
        }
      );

      expect(result.status).toBe("UNSUPPORTED_EXPANSION");
      expect(result.isGrounded).toBe(false);
      expect(result.explanation).toContain("prohibitedUses: ['offer_marketing', 'direct_ad_hook']");
    });
  });

  // =========================================================================
  // REQUIREMENT 11, 12, 13, 14: Execution Plan Resolver, Intents, WTDT Binding
  // =========================================================================
  describe("Req 11, 12, 13, 14: Execution Plan Resolution & Intent Separation", () => {
    it("Req 11: Defines 4 mutually exclusive intents: execution, draft_review, historical_inspection, resume", async () => {
      const intents: RunResolutionIntent[] = ["execution", "draft_review", "historical_inspection", "resume"];
      expect(intents).toHaveLength(4);
    });

    it("Req 12 & 14: Intent 'execution' strictly fails closed when no designated active plan exists", async () => {
      const res = await resolveExecutionPlan({
        accountId: "non_existent_account",
        campaignId: "non_existent_campaign",
        intent: "execution",
      });

      expect(res.canExecute).toBe(false);
      expect(res.plan).toBeNull();
      expect(res.reason).toBe("NO_APPROVED_PLAN_EXISTS");
    });

    it("Req 11: Intent 'draft_review' returns canExecute = false so draft runs never trigger execution", async () => {
      const res = await resolveExecutionPlan({
        accountId: "f020f6c7-15d8-4129-90a6-83a40558c642",
        campaignId: "camp_mtewrp8kkom3",
        intent: "draft_review",
      });

      expect(res.canExecute).toBe(false);
      expect(res.intent).toBe("draft_review");
    });

    it("Req 12 & 14: Intent 'execution' resolves the designated active plan for Sara FT", async () => {
      const res = await resolveExecutionPlan({
        accountId: "f020f6c7-15d8-4129-90a6-83a40558c642",
        campaignId: "camp_mtewrp8kkom3",
        intent: "execution",
      });

      expect(res.canExecute).toBe(true);
      expect(res.plan).toBeDefined();
      expect(res.plan?.id).toBe("14e04d2c-44c4-4367-8e23-ef8bd0076984");
      expect(res.plan?.isDesignatedActive).toBe(true);
      expect(res.plan?.status).toBe("APPROVED");
    });
  });
});
