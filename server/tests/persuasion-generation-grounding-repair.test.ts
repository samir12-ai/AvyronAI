import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  validateCanonicalPersuasionInput,
  CanonicalPersuasionInputError,
  type CanonicalPersuasionInput,
} from "../persuasion-engine/canonical-input";
import {
  judgePersuasionCandidate,
  type PersuasionJudgeVerdict,
} from "../persuasion-engine/semantic-judge";
import {
  repairPersuasionCandidate,
} from "../persuasion-engine/repair";
import {
  mapPersuasionLaneStatus,
  deriveAggregatePersuasionStatus,
} from "../persuasion-engine/status";
import {
  checkOfferInputSufficient,
} from "../system-control/structural-checks";
import type { EngineStepResult } from "../system-control/types";

describe("Persuasion Generation Grounding, Semantic Judge, and Repair Test Suite", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // Canonical Sara Product Truth Fixture (from real BU snapshot 90497a6c-91af-4061-b11b-5477367f8712)
  const saraCanonicalInput: CanonicalPersuasionInput = {
    productTruth: [
      {
        factId: "f9c27406-8d62-4aa8-9f37-1422736113db",
        statement: "Delivery across the UAE takes 1 to 2 business days, and exchanges can be requested within 24 hours of receiving the order.",
        factType: "DELIVERY_MECHANISM",
        status: "WEBSITE_ESTABLISHED",
        rationale: "Delivery and exchange timeline verified on store policy page.",
      },
      {
        factId: "4fdab84d-e967-4581-9b16-da50f7572d47",
        statement: "Payment options include cash on delivery alongside credit card payments.",
        factType: "PAYMENT_METHOD",
        status: "WEBSITE_ESTABLISHED",
        rationale: "Payment methods verified during checkout review.",
      },
      {
        factId: "7a56b9fb-1090-4a84-b049-cfdb22f98663",
        statement: "The dresses and modest clothing are crafted with premium fabrics to ensure long-lasting wear and comfort.",
        factType: "CAPABILITY",
        status: "WEBSITE_ESTABLISHED",
      },
      {
        factId: "38d051d0-1090-4a84-b049-cfdb22f98663",
        statement: "Products are designed to combine quality and modesty, emphasizing modest fashion suitable for customers seeking elegant, faith-aligned apparel.",
        factType: "CAPABILITY",
        status: "WEBSITE_ESTABLISHED",
      },
    ],
    strategicAuthority: {
      strategyRootId: "91f889ef-1f49-4ab9-969b-8812186ed2d5",
      primaryAxis: "Premium Modest Elegance with Guaranteed Fit & Rapid Local Delivery",
      contrastAxisText: "Fast-fashion synthetic dresses with unpredictable sizing and delayed overseas shipping",
      approvedMechanism: {
        name: "Curated Modest Fit Protocol",
        description: "Pre-shipment dimensional inspection and premium modest fabric validation",
      },
      approvedClaims: ["Premium breathable modest fabrics", "1-2 day UAE delivery"],
      approvedPromise: "Uncompromising modest style and verified fit",
    },
    laneContext: {
      laneId: "lane_1",
      title: "Active Modest Professional Lane",
      description: "Working women seeking stylish modest apparel for work and social events",
      targetRole: "Professional Buyer",
      objections: [
        "Uncertain if sizing fits properly without trying in person",
        "Fear of delayed delivery before upcoming events",
      ],
      funnelStage: "conversion",
      awarenessStage: "solution_aware",
    },
    proposalsAndUnknowns: {
      unverifiedCapabilities: [],
      proposedMarketingAssets: ["Customer unboxing video", "Fabric texture close-up"],
      missingProofGaps: [],
    },
    accountId: "f020f6c7-15d8-4129-90a6-83a40558c642",
    campaignId: "camp_mtewrp8kkom3",
  };

  // Non-Apparel B2B SaaS Fixture (Demonstrating domain-agnostic architecture)
  const b2bSaasCanonicalInput: CanonicalPersuasionInput = {
    productTruth: [
      {
        factId: "saas_fact_ebpf_01",
        statement: "Agentless eBPF observability kernel probe operates with less than 0.8% CPU overhead on production Linux kernels.",
        factType: "CAPABILITY",
        status: "ENGINEERING_VERIFIED",
        rationale: "Automated benchmark report v4.2 under 100k req/sec load.",
      },
      {
        factId: "saas_fact_soc2_02",
        statement: "SOC 2 Type II certified with encrypted telemetry pipelines and 99.99% uptime SLA.",
        factType: "SECURITY_COMPLIANCE",
        status: "AUDIT_VERIFIED",
      },
      {
        factId: "saas_fact_deploy_03",
        statement: "Single-command Helm chart installation with Kubernetes operator running in customer cluster.",
        factType: "DEPLOYMENT_MECHANISM",
        status: "DOCUMENTED",
      },
    ],
    strategicAuthority: {
      strategyRootId: "root_saas_7788",
      primaryAxis: "Zero-Overhead Kernel-Level Telemetry vs Legacy Heavy APM Agents",
      contrastAxisText: "Heavy Java/Python bytecode instrumentation injecting 8-15% CPU latency",
      approvedMechanism: {
        name: "Zero-Overhead eBPF Probe Pipeline",
        description: "In-kernel non-blocking packet analysis with zero runtime bytecode modification",
      },
      approvedClaims: ["< 0.8% CPU overhead", "No app restart required"],
      approvedPromise: "Instant full-stack observability with zero cluster slowdown",
    },
    laneContext: {
      laneId: "lane_platform_eng",
      title: "Platform & DevOps Leadership",
      description: "Platform engineers guarding cluster latency and budget",
      targetRole: "VP of Platform Engineering",
      objections: [
        "Concerned an in-kernel probe could panic the kernel or exhaust CPU under sudden traffic spikes",
      ],
      funnelStage: "technical_evaluation",
      awarenessStage: "solution_aware",
    },
    proposalsAndUnknowns: {
      unverifiedCapabilities: [],
      proposedMarketingAssets: ["Benchmark whitepaper"],
      missingProofGaps: [],
    },
    accountId: "acct_b2b_cloud_01",
    campaignId: "camp_b2b_obs_02",
  };

  // =========================================================================
  // Scenario 1: Canonical Input Validation & Typed Boundary
  // =========================================================================
  describe("Scenario 1: Canonical Persuasion Input Validation", () => {
    it("accepts complete canonical input with verified product truth facts", () => {
      const validated = validateCanonicalPersuasionInput(saraCanonicalInput);
      expect(validated).toBeDefined();
      expect(validated.productTruth.length).toBe(4);
      expect(validated.strategicAuthority.approvedMechanism.name).toBe("Curated Modest Fit Protocol");
    });

    it("fails closed when product truth is missing or lacks statement/factId", () => {
      const invalidInput: any = {
        ...saraCanonicalInput,
        productTruth: [],
      };
      expect(() => validateCanonicalPersuasionInput(invalidInput)).toThrow(CanonicalPersuasionInputError);
    });

    it("fails closed when strategic authority lacks approved mechanism name", () => {
      const invalidInput: any = {
        ...saraCanonicalInput,
        strategicAuthority: {
          ...saraCanonicalInput.strategicAuthority,
          approvedMechanism: { name: "" },
        },
      };
      expect(() => validateCanonicalPersuasionInput(invalidInput)).toThrow(CanonicalPersuasionInputError);
    });
  });

  // =========================================================================
  // Scenario 2: Anti-Hallucination & Delivery Boundary Guard
  // =========================================================================
  describe("Scenario 2 & 3: Anti-Hallucination & Delivery Capability Boundary", () => {
    it("rejects candidate when it invents an operational live tracking portal or fulfillment dashboard", async () => {
      const hallucinatedCandidate = {
        routeName: "Active Modest Professional Route",
        persuasionMode: "proof_led",
        trustTransferDesign: {
          transferMechanism: {
            name: "Transparent Live Order Fulfillment Dashboard",
            description: "Live real-time GPS tracking dashboard monitoring delivery couriers across the UAE",
          },
        },
        structuredObjections: [
          {
            objectionStatement: "Fear of delayed delivery before upcoming events",
            persuasionResponse: "We provide an automated live tracking dashboard and real-time order portal.",
            proofStatus: "PROOF_TO_BUILD",
          },
        ],
      };

      const verdict = await judgePersuasionCandidate({
        candidate: hallucinatedCandidate,
        canonicalInput: saraCanonicalInput,
      });

      expect(verdict.verdict).toBe("REJECTED");
      expect(verdict.factualSupportVerdict).toBe("UNSUPPORTED");
      expect(verdict.unsupportedClaims.some(c => c.toLowerCase().includes("dashboard") || c.toLowerCase().includes("tracking"))).toBe(true);
      expect(verdict.defects.length).toBeGreaterThan(0);
      expect(verdict.defects[0].defectCategory).toBe("FACTUAL_UNSUPPORTED");
    });

    it("enforces delivery boundary: delivery in 1-2 days cannot become a guaranteed dispatch portal", async () => {
      const dispatchHallucination = {
        routeName: "Delivery Route",
        trustTransferDesign: {
          transferMechanism: {
            name: "Automated 1-Hour Dispatch Guarantee Portal",
            description: "Guaranteed 60-minute dispatch with live warehouse API alerts",
          },
        },
        structuredObjections: [
          {
            objectionStatement: "Delivery speed",
            persuasionResponse: "Guaranteed 1-hour dispatch portal with automated notifications",
          },
        ],
      };

      const verdict = await judgePersuasionCandidate({
        candidate: dispatchHallucination,
        canonicalInput: saraCanonicalInput,
      });

      expect(verdict.verdict).toBe("REJECTED");
      expect(verdict.factualSupportVerdict).toBe("UNSUPPORTED");
    });
  });

  // =========================================================================
  // Scenario 4: Unsupported Capability Exclusion (e.g. COD when unsupported)
  // =========================================================================
  describe("Scenario 4: Unsupported Capability Exclusion", () => {
    it("rejects candidate claiming cash on delivery when COD is omitted from Product Truth", async () => {
      // Input WITHOUT COD
      const inputWithoutCOD: CanonicalPersuasionInput = {
        ...saraCanonicalInput,
        productTruth: saraCanonicalInput.productTruth.filter(f => f.factType !== "PAYMENT_METHOD"),
      };

      const codCandidate = {
        routeName: "Payment Trust Route",
        trustTransferDesign: {
          transferMechanism: {
            name: "Risk-Free Cash On Delivery Doorstep Inspection",
            description: "Pay with Cash on Delivery at your doorstep after inspecting the dress",
          },
        },
        structuredObjections: [],
      };

      const mockRejectedVerdict: PersuasionJudgeVerdict = {
        verdict: "REJECTED",
        factualSupportVerdict: "UNSUPPORTED",
        strategicAlignmentVerdict: "ALIGNED",
        laneRelevanceVerdict: "ALIGNED",
        proofIntegrityVerdict: "INVALID",
        persuasiveQualityVerdict: "STRONG",
        unsupportedClaims: ["Cash On Delivery Doorstep Inspection"],
        defects: [
          {
            fieldPath: "trustTransferDesign.transferMechanism.name",
            problematicStatement: "Cash On Delivery Doorstep Inspection",
            defectCategory: "FACTUAL_UNSUPPORTED",
            relevantAuthority: "Product Truth",
            evidenceEstablishes: "Product Truth does not verify Cash on Delivery for this campaign",
            validComponentsToPreserve: ["Doorstep delivery reassurance"],
            repairInstruction: "Retire Cash on Delivery. Frame payment reassurance around verified payment methods.",
          },
        ],
        reason: "REJECTED: Cash on delivery is not in Product Truth",
      };

      const verdict = await judgePersuasionCandidate({
        candidate: codCandidate,
        canonicalInput: inputWithoutCOD,
        mockJudgeVerdict: mockRejectedVerdict,
      });

      expect(verdict.verdict).toBe("REJECTED");
      expect(verdict.factualSupportVerdict).toBe("UNSUPPORTED");
      expect(verdict.defects[0].repairInstruction).toContain("Retire Cash on Delivery");
    });
  });

  // =========================================================================
  // Scenario 5: Non-Apparel B2B SaaS Fixture Verification
  // =========================================================================
  describe("Scenario 5: Non-Apparel B2B SaaS Fixture Grounding", () => {
    it("accurately validates B2B SaaS candidate grounded in eBPF kernel capabilities", async () => {
      const validSaasCandidate = {
        routeName: "Platform Overhead Elimination Route",
        persuasionMode: "logic_led",
        trustTransferDesign: {
          transferMechanism: {
            name: "In-Kernel eBPF Overhead Sandbox",
            description: "Kernel-level passive packet tap verified at < 0.8% CPU load with zero bytecode mutation",
          },
        },
        structuredObjections: [
          {
            objectionStatement: "Concerned an in-kernel probe could panic the kernel or exhaust CPU under sudden traffic spikes",
            persuasionResponse: "The probe runs strictly within the Linux eBPF verifier sandbox, guaranteeing zero kernel panics and enforcing an execution boundary verified under 100k req/sec load to maintain CPU overhead below 0.8% (Fact ID: saas_fact_ebpf_01).",
            requiredProof: "Engineering benchmark report v4.2",
            proofStatus: "PROOF_ESTABLISHED",
            supportingFactId: "saas_fact_ebpf_01",
          },
        ],
      };

      const verdict = await judgePersuasionCandidate({
        candidate: validSaasCandidate,
        canonicalInput: b2bSaasCanonicalInput,
      });

      expect(verdict.verdict).toBe("ACCEPTED");
      expect(verdict.factualSupportVerdict).toBe("GROUNDED");
      expect(verdict.strategicAlignmentVerdict).toBe("ALIGNED");
    });

    it("rejects B2B SaaS candidate when it hallucinates automated incident auto-remediation robots", async () => {
      const badSaasCandidate = {
        routeName: "Autonomous Remediation Route",
        trustTransferDesign: {
          transferMechanism: {
            name: "Autonomous AI Pod Restart Robot",
            description: "Automated live code hotpatching and auto-restarting crashed pods in production",
          },
        },
        structuredObjections: [
          {
            objectionStatement: "Traffic spike handling",
            persuasionResponse: "Our autonomous AI robot rewrites your microservice code on the fly.",
          },
        ],
      };

      const mockReject: PersuasionJudgeVerdict = {
        verdict: "REJECTED",
        factualSupportVerdict: "UNSUPPORTED",
        strategicAlignmentVerdict: "MISALIGNED",
        laneRelevanceVerdict: "ALIGNED",
        proofIntegrityVerdict: "INVALID",
        persuasiveQualityVerdict: "WEAK",
        unsupportedClaims: ["Autonomous AI Pod Restart Robot", "rewrites your microservice code on the fly"],
        defects: [
          {
            fieldPath: "trustTransferDesign.transferMechanism.name",
            problematicStatement: "Autonomous AI Pod Restart Robot",
            defectCategory: "FACTUAL_UNSUPPORTED",
            relevantAuthority: "saas_fact_ebpf_01",
            evidenceEstablishes: "Product is an observational telemetry probe, not an auto-remediation or code-mutating tool",
            validComponentsToPreserve: ["Observability monitoring"],
            repairInstruction: "Retire automated pod restart and code rewriting claims completely.",
          },
        ],
        reason: "REJECTED: Product Truth verifies passive telemetry only, not autonomous code hotpatching.",
      };

      const verdict = await judgePersuasionCandidate({
        candidate: badSaasCandidate,
        canonicalInput: b2bSaasCanonicalInput,
        mockJudgeVerdict: mockReject,
      });

      expect(verdict.verdict).toBe("REJECTED");
      expect(verdict.factualSupportVerdict).toBe("UNSUPPORTED");
      expect(verdict.defects[0].defectCategory).toBe("FACTUAL_UNSUPPORTED");
    });
  });

  // =========================================================================
  // Scenario 6: Five-Dimensional Semantic Judge Independence
  // =========================================================================
  describe("Scenario 6: 5-Dimensional Semantic Judge Independence", () => {
    it("reports independent verdicts across all 5 dimensions without collapsing them", async () => {
      const mockVerdict: PersuasionJudgeVerdict = {
        verdict: "REJECTED",
        factualSupportVerdict: "UNSUPPORTED",
        strategicAlignmentVerdict: "ALIGNED",
        laneRelevanceVerdict: "ALIGNED",
        proofIntegrityVerdict: "INVALID",
        persuasiveQualityVerdict: "STRONG",
        unsupportedClaims: ["live order fulfillment dashboard"],
        defects: [
          {
            fieldPath: "trustTransferDesign.transferMechanism",
            problematicStatement: "live order fulfillment dashboard",
            defectCategory: "FACTUAL_UNSUPPORTED",
            relevantAuthority: "Product Truth",
            evidenceEstablishes: "Delivery is 1-2 business days with 24h exchange; no live GPS tracking portal exists",
            validComponentsToPreserve: ["24h exchange window", "1-2 business day UAE delivery"],
            repairInstruction: "Retire live tracking dashboard claim and ground in verified delivery timeline and 24h exchange policy.",
          },
        ],
        reason: "REJECTED: Output asserts unsupported operational capability: live order fulfillment dashboard",
      };

      const verdict = await judgePersuasionCandidate({
        candidate: { routeName: "Test Route" },
        canonicalInput: saraCanonicalInput,
        mockJudgeVerdict: mockVerdict,
      });

      // Assert independent dimensions
      expect(verdict.verdict).toBe("REJECTED");
      expect(verdict.factualSupportVerdict).toBe("UNSUPPORTED");
      expect(verdict.strategicAlignmentVerdict).toBe("ALIGNED"); // Aligned strategically, though factually unsupported!
      expect(verdict.laneRelevanceVerdict).toBe("ALIGNED");      // Relevant to lane
      expect(verdict.proofIntegrityVerdict).toBe("INVALID");     // Proof integrity failed
      expect(verdict.persuasiveQualityVerdict).toBe("STRONG");   // Eloquent prose, yet factual boundary violated
    });
  });

  // =========================================================================
  // Scenario 7, 8, 9: Targeted Repair, Unified Budget, & Propagation
  // =========================================================================
  describe("Scenario 7, 8, 9: Targeted Repair, Unified Budget, & Propagation", () => {
    it("retires unsupported dashboard premise and rebuilds candidate strictly using verified facts", async () => {
      const failedCandidate = {
        primaryRoute: {
          routeName: "Active Modest Professional Route",
          persuasionMode: "proof_led",
          trustTransferDesign: {
            transferMechanism: {
              name: "Transparent Live Order Fulfillment Dashboard",
              description: "Live courier tracking portal across UAE",
            },
          },
          cialdiniReasoning: {
            groundedInTrustMechanism: "Transparent Live Order Fulfillment Dashboard",
            primaryCialdiniPrinciple: "authority",
          },
          structuredObjections: [
            {
              objectionStatement: "Fear of delayed delivery before upcoming events",
              persuasionResponse: "Track your courier in real-time with our Live Order Fulfillment Dashboard.",
              proofStatus: "PROOF_TO_BUILD",
            },
          ],
        },
      };

      const initialVerdict: PersuasionJudgeVerdict = {
        verdict: "REJECTED",
        factualSupportVerdict: "UNSUPPORTED",
        strategicAlignmentVerdict: "ALIGNED",
        laneRelevanceVerdict: "ALIGNED",
        proofIntegrityVerdict: "INVALID",
        persuasiveQualityVerdict: "STRONG",
        unsupportedClaims: ["Transparent Live Order Fulfillment Dashboard"],
        defects: [
          {
            fieldPath: "primaryRoute.trustTransferDesign.transferMechanism",
            problematicStatement: "Transparent Live Order Fulfillment Dashboard",
            defectCategory: "FACTUAL_UNSUPPORTED",
            relevantAuthority: "f9c27406-8d62-4aa8-9f37-1422736113db",
            evidenceEstablishes: "Delivery is 1-2 business days with 24h exchange window (Fact f9c27406)",
            validComponentsToPreserve: ["Active Modest Professional lane context", "Delivery reassurance"],
            repairInstruction: "Retire dashboard claim completely. Rebuild around verified 1-2 business day UAE delivery and 24h exchange window.",
          },
        ],
        reason: "REJECTED: Output claims unverified live tracking dashboard",
      };

      // Mock the repair generator to return clean, fact-grounded content
      const repairResult = await repairPersuasionCandidate({
        candidate: failedCandidate,
        judgeVerdict: initialVerdict,
        canonicalInput: saraCanonicalInput,
        maxRepairs: 2,
        mockRepairGenerator: async () => ({
          primaryRoute: {
            routeName: "Active Modest Professional Route",
            persuasionMode: "proof_led",
            trustTransferDesign: {
              transferMechanism: {
                name: "Verified Fast Dispatch & 24h Exchange Guarantee",
                description: "Direct UAE courier delivery within 1 to 2 business days with a hassle-free 24-hour exchange window upon receipt.",
              },
            },
            cialdiniReasoning: {
              groundedInTrustMechanism: "Verified Fast Dispatch & 24h Exchange Guarantee",
              primaryCialdiniPrinciple: "commitment",
            },
            structuredObjections: [
              {
                objectionStatement: "Fear of delayed delivery before upcoming events",
                persuasionResponse: "Every order is dispatched via expedited UAE couriers arriving within 1 to 2 business days, backed by a 24-hour exchange window to ensure your event look is perfect (Fact ID: f9c27406-8d62-4aa8-9f37-1422736113db).",
                requiredProof: "Pre-shipment verification and delivery receipt",
                proofStatus: "PROOF_ESTABLISHED",
                supportingFactId: "f9c27406-8d62-4aa8-9f37-1422736113db",
              },
            ],
          },
        }),
      });

      expect(repairResult.success).toBe(true);
      expect(repairResult.attemptsUsed).toBe(1);
      expect(repairResult.finalVerdict.verdict).toBe("ACCEPTED");

      // Verify propagation into derived fields:
      const repaired = repairResult.repairedCandidate.primaryRoute;
      expect(repaired.trustTransferDesign.transferMechanism.name).not.toContain("Dashboard");
      expect(repaired.cialdiniReasoning.groundedInTrustMechanism).toBe("Verified Fast Dispatch & 24h Exchange Guarantee");
      expect(repaired.structuredObjections[0].persuasionResponse).toContain("1 to 2 business days");
      expect(repaired.structuredObjections[0].persuasionResponse).not.toContain("Dashboard");
    });

    it("respects maxRepairs = 2 limit and terminates without infinite loop when unrepairable", async () => {
      const permanentlyBadCandidate = {
        primaryRoute: {
          trustTransferDesign: {
            transferMechanism: { name: "Live Order Fulfillment Dashboard" },
          },
        },
      };

      const stubbornVerdict: PersuasionJudgeVerdict = {
        verdict: "REJECTED",
        factualSupportVerdict: "UNSUPPORTED",
        strategicAlignmentVerdict: "MISALIGNED",
        laneRelevanceVerdict: "ALIGNED",
        proofIntegrityVerdict: "INVALID",
        persuasiveQualityVerdict: "WEAK",
        unsupportedClaims: ["Live Order Fulfillment Dashboard"],
        defects: [
          {
            fieldPath: "trustTransferDesign.transferMechanism",
            problematicStatement: "Live Order Fulfillment Dashboard",
            defectCategory: "FACTUAL_UNSUPPORTED",
            relevantAuthority: "Product Truth",
            evidenceEstablishes: "None",
            validComponentsToPreserve: [],
            repairInstruction: "Remove portal",
          },
        ],
        reason: "REJECTED: Stubborn hallucination",
      };

      let attemptCount = 0;
      const repairResult = await repairPersuasionCandidate({
        candidate: permanentlyBadCandidate,
        judgeVerdict: stubbornVerdict,
        canonicalInput: saraCanonicalInput,
        maxRepairs: 2,
        mockRepairGenerator: async () => {
          attemptCount++;
          return permanentlyBadCandidate; // Keeps returning defective candidate
        },
      });

      expect(repairResult.success).toBe(false);
      expect(repairResult.attemptsUsed).toBe(2);
      expect(attemptCount).toBe(2);
      expect(repairResult.finalVerdict.verdict).toBe("REJECTED");
    });
  });

  // =========================================================================
  // Scenario 10: Unified Status Mapping Parity
  // =========================================================================
  describe("Scenario 10: Unified Status Mapping Parity", () => {
    it("maps per-lane COMPLETE and SUCCESS outcomes to SUCCESS", () => {
      expect(mapPersuasionLaneStatus({ status: "COMPLETE" })).toBe("SUCCESS");
      expect(mapPersuasionLaneStatus({ status: "SUCCESS" })).toBe("SUCCESS");
    });

    it("maps POSITIONING_DRIFT and FACTUAL_UNSUPPORTED outcomes to ERROR", () => {
      expect(mapPersuasionLaneStatus({ status: "POSITIONING_DRIFT" })).toBe("ERROR");
      expect(mapPersuasionLaneStatus({ status: "FACTUAL_POSTURE_FAILED" })).toBe("ERROR");
      expect(mapPersuasionLaneStatus({ status: "ERROR" })).toBe("ERROR");
    });

    it("maps PARTIAL and ACCEPTABLE to PARTIAL", () => {
      expect(mapPersuasionLaneStatus({ status: "PARTIAL" })).toBe("PARTIAL");
      expect(mapPersuasionLaneStatus({ status: "ACCEPTABLE" })).toBe("PARTIAL");
    });

    it("derives aggregate status: all SUCCESS -> SUCCESS", () => {
      const lanes = [{ status: "COMPLETE" }, { status: "SUCCESS" }];
      expect(deriveAggregatePersuasionStatus(lanes)).toBe("SUCCESS");
    });

    it("derives aggregate status: ANY required failed lane strictly blocks aggregate SUCCESS", () => {
      const lanesWithFailure = [{ status: "COMPLETE" }, { status: "POSITIONING_DRIFT" }];
      expect(deriveAggregatePersuasionStatus(lanesWithFailure)).toBe("ERROR");
    });

    it("derives aggregate status: SUCCESS + PARTIAL -> PARTIAL", () => {
      const lanesWithPartial = [{ status: "COMPLETE" }, { status: "PARTIAL" }];
      expect(deriveAggregatePersuasionStatus(lanesWithPartial)).toBe("PARTIAL");
    });
  });

  // =========================================================================
  // Scenario 11: Ancestry-Aware Offer Resume Validation in System Control
  // =========================================================================
  describe("Scenario 11: Ancestry-Aware Offer Resume Validation", () => {
    const activeAccountId = "f020f6c7-15d8-4129-90a6-83a40558c642";
    const activeCampaignId = "camp_mtewrp8kkom3";
    const currentJobId = "orch_resume_job_999";
    const sourceJobId = "orch_1790257489028_cywp34";
    const validOfferSnapshotId = "d2ef9ef5-ba64-4fb8-b292-f9375394116e";
    const activePositioningSnapshotId = "2e9518b6-3aaa-48d0-bb52-9508fdb6eb65";

    it("accepts official resume offer snapshot when ancestry and lineage are verified", () => {
      const results = new Map<any, EngineStepResult>();
      results.set("positioning", {
        engineId: "positioning",
        status: "SUCCESS",
        output: {},
        snapshotId: activePositioningSnapshotId,
        durationMs: 100,
      });

      results.set("offer", {
        engineId: "offer",
        status: "SUCCESS",
        output: {
          status: "SUCCESS",
          primaryOffer: { coreOutcome: "Modest dresses" },
          _provenance: {
            sourceJobId,
            consumingJobId: currentJobId,
            snapshotId: validOfferSnapshotId,
            campaignId: activeCampaignId,
            accountId: activeAccountId,
            positioningSnapshotId: activePositioningSnapshotId,
            wasReused: true,
            isOfficialResume: true,
            status: "SUCCESS",
          },
        },
        snapshotId: validOfferSnapshotId,
        durationMs: 0,
      });

      const check = checkOfferInputSufficient(results, currentJobId, {
        accountId: activeAccountId,
        campaignId: activeCampaignId,
      });

      expect(check.status).toBe("PASS");
    });

    it("rejects official resume offer when accountId or campaignId does not match active lineage", () => {
      const results = new Map<any, EngineStepResult>();
      results.set("offer", {
        engineId: "offer",
        status: "SUCCESS",
        output: {
          status: "SUCCESS",
          _provenance: {
            sourceJobId,
            consumingJobId: currentJobId,
            snapshotId: validOfferSnapshotId,
            campaignId: "foreign_campaign_123", // Mismatched campaign
            accountId: activeAccountId,
            wasReused: true,
            isOfficialResume: true,
            status: "SUCCESS",
          },
        },
        snapshotId: validOfferSnapshotId,
        durationMs: 0,
      });

      const check = checkOfferInputSufficient(results, currentJobId, {
        accountId: activeAccountId,
        campaignId: activeCampaignId,
      });

      expect(check.status).toBe("FAIL");
      expect(check.details).toContain("CROSS_JOB_ISOLATION");
      expect(check.details).toContain("foreign_campaign_123");
    });

    it("rejects official resume offer when parent positioningSnapshotId does not match active run", () => {
      const results = new Map<any, EngineStepResult>();
      results.set("positioning", {
        engineId: "positioning",
        status: "SUCCESS",
        output: {},
        snapshotId: activePositioningSnapshotId,
        durationMs: 100,
      });

      results.set("offer", {
        engineId: "offer",
        status: "SUCCESS",
        output: {
          status: "SUCCESS",
          _provenance: {
            sourceJobId,
            consumingJobId: currentJobId,
            snapshotId: validOfferSnapshotId,
            campaignId: activeCampaignId,
            accountId: activeAccountId,
            positioningSnapshotId: "foreign_pos_snap_999", // Mismatched positioning
            wasReused: true,
            isOfficialResume: true,
            status: "SUCCESS",
          },
        },
        snapshotId: validOfferSnapshotId,
        durationMs: 0,
      });

      const check = checkOfferInputSufficient(results, currentJobId, {
        accountId: activeAccountId,
        campaignId: activeCampaignId,
      });

      expect(check.status).toBe("FAIL");
      expect(check.details).toContain("CROSS_JOB_ISOLATION");
      expect(check.details).toContain("foreign_pos_snap_999");
    });

    it("rejects foreign job snapshot when isOfficialResume is false (standard cross-job isolation)", () => {
      const results = new Map<any, EngineStepResult>();
      results.set("offer", {
        engineId: "offer",
        status: "SUCCESS",
        output: {
          status: "SUCCESS",
          _provenance: {
            sourceJobId, // Foreign job
            snapshotId: validOfferSnapshotId,
            isOfficialResume: false, // Not an official resume
          },
        },
        snapshotId: validOfferSnapshotId,
        durationMs: 0,
      });

      const check = checkOfferInputSufficient(results, currentJobId, {
        accountId: activeAccountId,
        campaignId: activeCampaignId,
      });

      expect(check.status).toBe("FAIL");
      expect(check.details).toContain("CROSS_JOB_ISOLATION");
      expect(check.details).toContain(sourceJobId);
    });
  });
});
