import "dotenv/config";
import { describe, it, expect } from "vitest";
import { matchResumeDecision } from "../orchestrator/resume-hydration";
import { computePainContentHash } from "../shared/audience-pain-registry";
import {
  ClaimEpistemicStatus,
  CLAIM_EPISTEMIC_LABELS,
  ObjectionResolutionStatus,
  type StructuredClaim,
} from "../../shared/contracts/claim-status";
import {
  evaluateClaimSemanticEntailment,
  detectAssertionModality,
} from "../shared/claim-entailment";
import { evaluatePublishPreflight } from "../publish-worker";
import { evaluateTaskEligibility, determineTaskPurpose } from "../shared/task-eligibility";

describe("Claim Integrity Verification Suite", () => {
  // 1. Resume Pain-Registry Decision Match Hardening (Fail-Closed Lineage)
  describe("matchResumeDecision Hardening (Fail-Closed Lineage)", () => {
    it("Lineage Rule 1: missing target statement/hash cannot establish compatibility", () => {
      const emptyTarget = { statement: "", contentHash: "" };
      const row = {
        painContentHash: computePainContentHash("Some valid pain statement"),
        productTruthRevision: 1,
      };
      const match = matchResumeDecision(emptyTarget, [row]);
      expect(match).toBeUndefined();
    });

    it("Lineage Rule 2: missing candidate content lineage cannot establish compatibility, not implicitly accepted", () => {
      const targetPain = {
        statement: "Catalog prices are too high",
        contentHash: computePainContentHash("Catalog prices are too high"),
        productTruthRevision: 1,
      };
      const candidateRowWithoutHash = {
        jobId: "orch_source_123",
        painId: "legacy_p1",
        // No painContentHash and no payload hash
        payload: { finalClassification: "CORE_PURCHASE" },
      };
      const match = matchResumeDecision(targetPain, [candidateRowWithoutHash]);
      expect(match).toBeUndefined();
    });

    it("Lineage Rule 3: conflicting content lineage (different statement) is strictly rejected", () => {
      const targetPain = {
        painId: "seg_2651bfb3_seg_1_pain_1",
        statement: "Customers report severe sizing confusion with smaller than expected fit",
        contentHash: computePainContentHash("Customers report severe sizing confusion with smaller than expected fit"),
      };

      const conflictingRow = {
        jobId: "orch_source_123",
        painId: "seg_2651bfb3_seg_1_pain_1",
        painContentHash: computePainContentHash("Completely different statement about return policy delays"),
        payload: {
          painId: "seg_2651bfb3_seg_1_pain_1",
          painContentHash: computePainContentHash("Completely different statement about return policy delays"),
          finalClassification: "CORE_PURCHASE",
        },
      };

      const match = matchResumeDecision(targetPain, [conflictingRow]);
      expect(match).toBeUndefined();
    });

    it("Lineage Rule 4: missing candidate revision when target requires revision is rejected", () => {
      const targetPain = {
        statement: "Catalog prices are too high",
        contentHash: computePainContentHash("Catalog prices are too high"),
        productTruthRevision: 2,
      };

      const candidateRowMissingRevision = {
        painContentHash: computePainContentHash("Catalog prices are too high"),
        // No productTruthRevision!
      };

      const match = matchResumeDecision(targetPain, [candidateRowMissingRevision]);
      expect(match).toBeUndefined();
    });

    it("Lineage Rule 5: mismatched Product Truth revision is strictly rejected", () => {
      const targetPain = {
        painId: "pain_pricing_1",
        statement: "Catalog prices are too high",
        contentHash: computePainContentHash("Catalog prices are too high"),
        productTruthRevision: 2,
      };

      const staleRevisionRow = {
        painId: "pain_pricing_1",
        painContentHash: computePainContentHash("Catalog prices are too high"),
        productTruthRevision: 1, // Stale!
      };

      const match = matchResumeDecision(targetPain, [staleRevisionRow]);
      expect(match).toBeUndefined();
    });

    it("Lineage Rule 6: cross-tenant reference is strictly rejected", () => {
      const targetPain = {
        statement: "Catalog prices are too high",
        contentHash: computePainContentHash("Catalog prices are too high"),
        productTruthRevision: 1,
        accountId: "tenant_alpha_123",
      };

      const crossTenantRow = {
        painContentHash: computePainContentHash("Catalog prices are too high"),
        productTruthRevision: 1,
        accountId: "tenant_beta_456", // Foreign tenant!
      };

      const match = matchResumeDecision(targetPain, [crossTenantRow]);
      expect(match).toBeUndefined();
    });

    it("succeeds when content hash, revision, and tenant match identically", () => {
      const statement = "Consistent sizing failure across youth dress catalog";
      const hash = computePainContentHash(statement);
      const targetPain = {
        statement,
        contentHash: hash,
        productTruthRevision: 1,
        accountId: "tenant_alpha_123",
      };

      const matchingRow = {
        painContentHash: hash,
        productTruthRevision: 1,
        accountId: "tenant_alpha_123",
        finalClassification: "CORE_PURCHASE",
      };

      const match = matchResumeDecision(targetPain, [matchingRow]);
      expect(match).toBeDefined();
      expect(match?.finalClassification).toBe("CORE_PURCHASE");
    });
  });

  // 2. Claim Contract & Evidence Grounding (No Phrase Blacklists)
  describe("Claim Evidence Validation (Replacing Blacklists)", () => {
    it("Case 1: clearly documented 30-day free-return policy in verified evidence permits appropriately scoped claim", () => {
      const verifiedEvidenceWithPolicy = [
        "We offer a guaranteed 30-day free exchange policy with prepaid return labels for all customers.",
      ];
      const claim = "Customers enjoy a 30-day free exchange policy with prepaid return labels.";
      const result = evaluateClaimSemanticEntailment(claim, verifiedEvidenceWithPolicy);

      expect(result.status).toBe("ENTAILED");
      expect(result.isGrounded).toBe(true);
      expect(result.epistemicStatus).toBe(ClaimEpistemicStatus.SUPPORTED_CAPABILITY);
    });

    it("Case 2: ambiguous exchange statement does not permit a 30-day prepaid return guarantee", () => {
      const ambiguousEvidence = [
        "24-hour product exchange capability.",
      ];
      const claim = "Guaranteed 30-day free exchange policy including prepaid return labels for every SKU.";
      const result = evaluateClaimSemanticEntailment(claim, ambiguousEvidence);

      expect(result.status).toBe("UNSUPPORTED_EXPANSION");
      expect(result.isGrounded).toBe(false);
      expect(result.unsupportedProperties).toContain("extended_free_returns_guarantee");
      expect(result.epistemicStatus).toBe(ClaimEpistemicStatus.UNPROVEN_CLAIM);
    });

    it("Case 3: different wording of the same unsupported promise is rejected (paraphrase testing)", () => {
      const verifiedEvidence = [
        "The dresses are crafted with premium fabrics to ensure long-lasting wear and comfort.",
      ];
      // Paraphrased fabric opacity guarantee:
      const paraphraseClaim = "Garments feature a zero see-through weave and completely eliminate opacity concerns.";
      const result = evaluateClaimSemanticEntailment(paraphraseClaim, verifiedEvidence);

      expect(result.status).toBe("UNSUPPORTED_EXPANSION");
      expect(result.isGrounded).toBe(false);
      expect(result.unsupportedProperties).toContain("fabric_opacity");
      expect(result.epistemicStatus).toBe(ClaimEpistemicStatus.UNPROVEN_CLAIM);
    });

    it("Case 4: supported non-fashion capability remains usable (SaaS fixture)", () => {
      const saasEvidence = [
        "Multi-region cloud deployment architecture.",
        "100% SLA credit reimbursement provided in the event of service interruptions.",
        "Automated anomaly detection and ML-powered telemetry alerts.",
      ];
      const claim = "Automated anomaly detection monitors all inbound telemetry streams.";
      const result = evaluateClaimSemanticEntailment(claim, saasEvidence);

      expect(result.status).toBe("ENTAILED");
      expect(result.isGrounded).toBe(true);
      expect(result.epistemicStatus).toBe(ClaimEpistemicStatus.SUPPORTED_CAPABILITY);
    });

    it("Case 5: intentional proposal survives with prerequisites", () => {
      const proposalText = "[Proposed — requires validation/implementation] Fit Profile System: 12 named fit profiles. Prerequisites: Lab sizing calibration; Merchant review.";
      const modality = detectAssertionModality(proposalText);

      expect(modality.modality).toBe("PROPOSAL");
      expect(modality.prerequisites).toContain("Lab sizing calibration");

      const result = evaluateClaimSemanticEntailment(proposalText, ["Catalog dresses priced $35-$62"]);
      expect(result.epistemicStatus).toBe(ClaimEpistemicStatus.PROPOSED_CAPABILITY);
      expect(result.suggestedResolutionStatus).toBe("PROPOSED");
      expect(result.prerequisites?.length).toBe(2);
    });

    it("Case 6: completing a prerequisite alone does not promote proposal to supported capability without evidence", () => {
      // Sizing calibration was completed internally, but empirical proof is not in Product Truth
      const proposalCompletedPrereq = "[Proposed — requires implementation] Fit Profile System: 12 named fit profiles. Prerequisites: Merchant review completed.";
      const result = evaluateClaimSemanticEntailment(proposalCompletedPrereq, ["Catalog dresses priced $35-$62"]);

      // It must remain a proposal, NOT upgrade to a factual supported capability!
      expect(result.epistemicStatus).toBe(ClaimEpistemicStatus.PROPOSED_CAPABILITY);
      expect(result.epistemicStatus).not.toBe(ClaimEpistemicStatus.SUPPORTED_CAPABILITY);
    });
  });

  // 3. Structured Task Eligibility (No String Blocking)
  describe("Structured Task Eligibility", () => {
    const verifiedEvidence = [
      "Catalog dresses priced $35-$62.",
      "The dresses are crafted with premium fabrics.",
      "24-hour product exchange capability.",
    ];

    it("Case 7: weekly review task is eligible when plan and lifecycle permit it (does NOT block on 'review')", () => {
      const weeklyReviewTask = {
        id: "task_w1_review",
        taskType: "review",
        category: "planning",
        title: "Weekly review & planning",
        description: "Analyze Week 1 performance and plan adjustments",
      };

      const purpose = determineTaskPurpose(weeklyReviewTask);
      expect(purpose).toBe("REVIEW_RESULTS");

      const eligibility = evaluateTaskEligibility(weeklyReviewTask, {
        planStatus: "APPROVED",
        isPlanDesignatedActive: true,
        verifiedEvidenceTexts: verifiedEvidence,
      });

      // Must be ELIGIBLE, not blocked by the word 'review'!
      expect(eligibility.isEligible).toBe(true);
      expect(eligibility.purpose).toBe("REVIEW_RESULTS");
    });

    it("Case 8: implementation task can reference proposed capability without claiming it exists", () => {
      const implementationTask = {
        id: "task_imp_sizing",
        taskType: "proof_asset",
        category: "proposal_implementation",
        title: "Build and validate a sizing guide",
        description: "Create size chart specifications and test fit tolerances across 12 silhouettes",
      };

      const purpose = determineTaskPurpose(implementationTask);
      expect(purpose).toBe("IMPLEMENT_PROPOSAL");

      const eligibility = evaluateTaskEligibility(implementationTask, {
        planStatus: "APPROVED",
        isPlanDesignatedActive: true,
        verifiedEvidenceTexts: verifiedEvidence,
      });

      // Internal proposal implementation is ELIGIBLE!
      expect(eligibility.isEligible).toBe(true);
      expect(eligibility.purpose).toBe("IMPLEMENT_PROPOSAL");
    });

    it("Case 9: advertising unverified capability is restricted", () => {
      const ungroundedAdTask = {
        id: "task_ad_opacity",
        taskType: "launch",
        category: "ads",
        title: "Launch Instagram ad set: Guaranteed 100% opacity and zero see-through dresses",
        description: "Advertise sheer-proof fabric guarantee to buyers",
      };

      const purpose = determineTaskPurpose(ungroundedAdTask);
      expect(purpose).toBe("ADVERTISE_CAPABILITY");

      const eligibility = evaluateTaskEligibility(ungroundedAdTask, {
        planStatus: "APPROVED",
        isPlanDesignatedActive: true,
        verifiedEvidenceTexts: verifiedEvidence, // Only has "premium fabrics", NOT opacity proof!
      });

      // Public advertising of ungrounded claim must be BLOCKED!
      expect(eligibility.isEligible).toBe(false);
      expect(eligibility.blockCode).toBe("UNGROUNDED_ADVERTISING_CLAIM");
      expect(eligibility.reason).toContain("fabric_opacity");
    });

    it("task eligibility rejects tasks under unapproved or inactive plan", () => {
      const task = {
        id: "task_generic_1",
        taskType: "review",
        title: "Weekly review",
      };

      const unapprovedCheck = evaluateTaskEligibility(task, {
        planStatus: "DRAFT",
        isPlanDesignatedActive: false,
        verifiedEvidenceTexts: verifiedEvidence,
      });
      expect(unapprovedCheck.isEligible).toBe(false);
      expect(unapprovedCheck.blockCode).toBe("PLAN_UNAPPROVED");

      const inactiveCheck = evaluateTaskEligibility(task, {
        planStatus: "APPROVED",
        isPlanDesignatedActive: false,
        verifiedEvidenceTexts: verifiedEvidence,
      });
      expect(inactiveCheck.isEligible).toBe(false);
      expect(inactiveCheck.blockCode).toBe("PLAN_NOT_ACTIVE");
    });
  });

  // 4. Dispatch & Publishing Preflight Gates
  describe("Dispatch & Publishing Preflight Gates", () => {
    it("Case 11a: preflight blocks post when verified evidence does not support claim", async () => {
      const preflight = await evaluatePublishPreflight(
        {
          id: "post_test_1",
          planId: null,
          caption: "Our summer dresses offer a guaranteed 30-day free exchange policy with prepaid return labels!",
          verifiedEvidence: ["24-hour product exchange capability."], // Evidence lacks 30-day prepaid returns
        },
        { autopilotOn: true, state: "ACTIVE" }
      );

      expect(preflight.canPublish).toBe(false);
      expect(preflight.blockCode).toBe("UNPROVEN_CLAIM_RESTRICTION");
    });

    it("Case 11b: preflight PERMITS the exact same claim when verified evidence supports it (no blacklist)", async () => {
      const preflight = await evaluatePublishPreflight(
        {
          id: "post_test_2",
          planId: null,
          caption: "Our summer dresses offer a guaranteed 30-day free exchange policy with prepaid return labels!",
          verifiedEvidence: ["We provide a guaranteed 30-day free exchange policy with prepaid return labels for all items."],
        },
        { autopilotOn: true, state: "ACTIVE" }
      );

      // Must be ALLOWED because evidence explicitly verifies it!
      expect(preflight.canPublish).toBe(true);
    });

    it("preflight blocks publishing when autopilot is OFF or SAFE_MODE", async () => {
      const preflightAutopilotOff = await evaluatePublishPreflight(
        { id: "post_3", caption: "Standard post" },
        { autopilotOn: false, state: "ACTIVE" }
      );
      expect(preflightAutopilotOff.canPublish).toBe(false);
      expect(preflightAutopilotOff.blockCode).toBe("AUTOPILOT_OFF");

      const preflightSafeMode = await evaluatePublishPreflight(
        { id: "post_4", caption: "Standard post" },
        { autopilotOn: true, state: "SAFE_MODE" }
      );
      expect(preflightSafeMode.canPublish).toBe(false);
      expect(preflightSafeMode.blockCode).toBe("SAFE_MODE");
    });
  });
});
