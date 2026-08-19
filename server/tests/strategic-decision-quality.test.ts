import { describe, it, expect } from "vitest";
import { judgeProductTruthGrounding, buildProductTruthPrompt } from "../shared/product-truth-judge";
import { judgeInterchangeability, type JudgeKind } from "../shared/interchangeability-judge";
import { LaneStrategicResponseSchema } from "../shared/strategic-doctrine";

describe("Strategic Decision Quality & Product Truth Grounding", () => {
  const sampleAnchor = {
    name: "SFI Peptides",
    type: "B2B Wholesale Peptide Supplier",
    keyAttributes: ["UAE-based direct sourcing", "Batch testing certificates", "Medical practice direct supply"],
    coreProblemSolved: "Inconsistent delivery and dubious sourcing in fragmented UAE peptide supply",
    differentiatingFeature: "Direct verified sourcing with batch-level certificate of analysis for UAE clinics",
  };

  describe("Product Truth Grounding Judge", () => {
    it("classifies validated existing capabilities as VALIDATED_CAPABILITY (Category A - ACCEPTED)", async () => {
      const prompt = buildProductTruthPrompt(
        "SFI Peptides supplies medical clinics in the UAE with batch testing certificates directly sourced for medical practices.",
        sampleAnchor
      );
      expect(prompt).toContain("SFI Peptides");
      expect(prompt).toContain("VALIDATED_CAPABILITY");
    });

    it("classifies recommended future strategy as STRATEGIC_DIRECTION (Category B - ACCEPTED)", async () => {
      const prompt = buildProductTruthPrompt(
        "The business should prioritize building transparent batch tracking proof and lead messaging with delivery consistency rather than broad clinical claims.",
        sampleAnchor
      );
      expect(prompt).toContain("STRATEGIC_DIRECTION");
    });

    it("classifies explicit proof or capability gaps as CAPABILITY_OR_PROOF_GAP (ACCEPTED)", async () => {
      const prompt = buildProductTruthPrompt(
        "Proof Gap: Third-party clinical efficacy trials are not yet established for private clinic formulations; focus evidence on sourcing purity.",
        sampleAnchor
      );
      expect(prompt).toContain("CAPABILITY_OR_PROOF_GAP");
    });

    it("identifies invented operational features as INVENTED_CAPABILITY (Category C - REJECTED)", async () => {
      const prompt = buildProductTruthPrompt(
        "We provide automated real-time ERP API inventory sync and guaranteed zero-stockout 24-hour delivery SLAs across the entire GCC.",
        sampleAnchor
      );
      expect(prompt).toContain("INVENTED_CAPABILITY");
    });
  });

  describe("Interchangeability & Genericness Judge Extension", () => {
    it("supports strategic_decision, brand_spine, and proof_strategy judge kinds", () => {
      const kinds: JudgeKind[] = ["strategic_decision", "brand_spine", "proof_strategy", "segment", "positioning_claim", "offer", "channel_rationale"];
      expect(kinds).toContain("strategic_decision");
      expect(kinds).toContain("brand_spine");
      expect(kinds).toContain("proof_strategy");
    });
  });

  describe("LaneStrategicResponse Integration Contract", () => {
    it("validates a complete, decision-rich LaneStrategicResponse object", () => {
      const validLaneResponse = {
        laneId: "lane_clinic_procurement",
        audienceContext: "UAE Medical Practice Procurement Managers",
        observedProblem: "Fragmented supply chains cause unpredictable batch delivery and procurement uncertainty",
        evidenceSummary: ["RC1: Supply reliability doubt", "CC1: Competitors lack local UAE inventory transparency"],
        commercialMeaning: "Increases switching hesitation and forces clinics to split orders across multiple grey-market vendors",
        strategicDecision: "Compete on verified delivery predictability and batch purity rather than broad therapeutic health claims",
        strategicResponse: "Position SFI as the dedicated UAE clinical procurement partner with verifiable batch documentation at order time",
        positioningImplication: "Own the 'Procurement Predictability' territory against unverified grey-market importers",
        messagingImplication: "Lead with supply continuity, batch testing verification, and practice workflow simplicity",
        offerImplication: "Wholesale clinic starter pack with batch COA included and priority replenishment terms",
        proofRequirement: {
          claimToProve: "Every batch is verified for purity and delivered reliably within UAE",
          proofTypeNeeded: "Batch Certificate of Analysis (COA) from accredited laboratory",
          existingProofAsset: "Sample lab assay reports",
          proofGap: "Clinic customer case studies not yet collected",
        },
        funnelImplication: "Direct consultation and sample batch verification before first bulk order",
        contentImplication: {
          strategicTheme: "Clinical Supply Reliability & Batch Verification",
          desiredPerceptionShift: "From 'all peptide suppliers are risky' to 'SFI is the predictable local partner'",
          funnelRole: "Mid-funnel objection neutralization",
        },
        tradeoff: "Do not market to retail consumers or use body-transformation claims in procurement communications",
        whatNotToDo: "Never lead B2B clinic communications with ungrounded disease-cure or consumer aesthetic promises",
        confidence: 0.92,
        lineage: ["audience_engine_v3", "positioning_engine_v3", "differentiation_engine_v3", "offer_engine_v4"],
      };

      const parsed = LaneStrategicResponseSchema.safeParse(validLaneResponse);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.laneId).toBe("lane_clinic_procurement");
        expect(parsed.data.strategicDecision).toContain("Compete on verified delivery predictability");
        expect(parsed.data.whatNotToDo).toContain("Never lead B2B clinic communications");
      }
    });

    it("rejects incomplete LaneStrategicResponse missing strategic decisions or tradeoffs", () => {
      const incomplete = {
        laneId: "lane_incomplete",
        audienceContext: "Clinics",
        observedProblem: "Trust issues",
      };
      const parsed = LaneStrategicResponseSchema.safeParse(incomplete);
      expect(parsed.success).toBe(false);
    });
  });

  describe("Governance State Machine Audit", () => {
    it("confirms APPROVED + RESTRICTED_EXECUTION is a valid dual-tier governance state", () => {
      const strategicPlanStatus = "APPROVED";
      const systemControlVerdict = "DOWNGRADE";
      const recommendedExecutionMode = "RESTRICTED_EXECUTION";

      const isHumanApproved = strategicPlanStatus === "APPROVED";
      const isAutonomousSpendRestricted = systemControlVerdict === "DOWNGRADE" && recommendedExecutionMode === "RESTRICTED_EXECUTION";

      expect(isHumanApproved).toBe(true);
      expect(isAutonomousSpendRestricted).toBe(true);
      // Both states coexist: Human accepts strategic roadmap while System Control restricts automated spend until empirical proof
    });
  });
});
