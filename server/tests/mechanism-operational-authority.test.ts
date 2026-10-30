import { describe, it, expect, vi, beforeEach } from "vitest";
import * as aiModule from "../ai-client";
import {
  judgeMechanismSemanticRole,
  MechanismSemanticRoleJudgeResult,
} from "../mechanism-engine/engine";

describe("Mechanism Operational Authority Regression Suite", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // Canonical Sara Product Truth facts from business_understanding_snapshots
  const saraRealProductTruthFacts = [
    "The summer dresses offering includes multiple distinct SKUs such as BONBON DRESS ($35), HAYAT SET ($40), LUNA SET ($40), GIRLY SET ($62), SUNSHINE SET ($62), NAVY SET ($60), BUTTERFLY DRESS ($62), SARA DRESS ($40), and BLAZER Set ($50).",
    "Products are designed to combine quality and modesty, emphasizing modest fashion suitable for customers seeking elegant, faith-aligned apparel.",
    "The dresses and modest clothing are crafted with premium fabrics to ensure long-lasting wear and comfort.",
    "Offering includes ready-to-wear apparel designed for multiple occasions with a focus on timeless elegance to remain stylish across seasons.",
    "Customer orders are processed with a focus on fast delivery and 24-hour product exchange capability.",
  ];

  // =========================================================================
  // Case 1: Existing claim "Sara performs pre-shipment quality checks" unsupported
  // =========================================================================
  it("Case 1: rejects existing claim 'Sara performs pre-shipment quality checks' when unsupported by Product Truth", async () => {
    vi.spyOn(aiModule, "aiChat").mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              verdict: "REPAIR",
              reasons: ["Asserts unsupported operational process: Sara performs pre-shipment quality checks"],
              failureType: "OPERATIONAL_CAPABILITY_UPGRADE",
              operationalClaims: [
                {
                  claim: "Sara performs pre-shipment quality checks on every garment",
                  role: "UNSUPPORTED_EXISTING_PROCESS",
                  supportedByCapability: null,
                },
              ],
              feedback: "Remove the claim that Sara performs pre-shipment quality checks as it is not in Product Truth.",
            }),
          },
        },
      ],
    } as any);

    const result = await judgeMechanismSemanticRole({
      candidate: {
        name: "Garment Quality Assurance Protocol",
        description: "Sara performs pre-shipment quality checks on every garment to verify seam integrity.",
        steps: ["Inspect stitching on dress", "Verify seam integrity before pack", "Ship verified item"],
        logic: "Pre-shipment inspection guarantees product reliability.",
      },
      positioning: { primaryAxis: "modest_quality" },
      productTruthCapabilities: saraRealProductTruthFacts,
    });

    expect(result.verdict).toBe("REPAIR");
    expect(result.failureType).toBe("OPERATIONAL_CAPABILITY_UPGRADE");
    expect(result.reasons.some((r) => r.includes("pre-shipment quality checks"))).toBe(true);
    expect(result.operationalClaims?.[0].role).toBe("UNSUPPORTED_EXISTING_PROCESS");
  });

  // =========================================================================
  // Case 2: Existing claim "Sara standardizes silhouette measurements across SKUs" unsupported
  // =========================================================================
  it("Case 2: rejects existing claim 'Sara standardizes silhouette measurements across SKUs' when unsupported", async () => {
    vi.spyOn(aiModule, "aiChat").mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              verdict: "REPAIR",
              reasons: ["Asserts unsupported operational process: Sara standardizes silhouette measurements across SKUs"],
              failureType: "OPERATIONAL_CAPABILITY_UPGRADE",
              operationalClaims: [
                {
                  claim: "Sara standardizes silhouette measurements across SKUs",
                  role: "UNSUPPORTED_EXISTING_PROCESS",
                  supportedByCapability: null,
                },
              ],
              feedback: "Product Truth does not establish standardized silhouette measurement protocols.",
            }),
          },
        },
      ],
    } as any);

    const result = await judgeMechanismSemanticRole({
      candidate: {
        name: "Silhouette Standardization Protocol",
        description: "Sara standardizes silhouette measurements across SKUs to guarantee modest fit.",
        steps: ["Measure dress dimensions", "Calibrate pattern sizes", "Verify modesty proportions"],
        logic: "Standardized fit eliminates sizing hesitation.",
      },
      positioning: { primaryAxis: "modest_fit" },
      productTruthCapabilities: saraRealProductTruthFacts,
    });

    expect(result.verdict).toBe("REPAIR");
    expect(result.failureType).toBe("OPERATIONAL_CAPABILITY_UPGRADE");
    expect(result.reasons.some((r) => r.includes("silhouette measurements"))).toBe(true);
  });

  // =========================================================================
  // Case 3: Existing proprietary operational process unsupported
  // =========================================================================
  it("Case 3: rejects unsupported existing proprietary operational process / QA workflow", async () => {
    vi.spyOn(aiModule, "aiChat").mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              verdict: "REPAIR",
              reasons: ["Asserts unsupported internal QA process: 5-tier fit verification workflow"],
              failureType: "OPERATIONAL_CAPABILITY_UPGRADE",
              operationalClaims: [
                {
                  claim: "Sara executes an internal 5-tier fit verification workflow and proprietary curation protocol",
                  role: "UNSUPPORTED_EXISTING_PROCESS",
                  supportedByCapability: null,
                },
              ],
              feedback: "Do not invent internal QA workflows or proprietary curation protocols.",
            }),
          },
        },
      ],
    } as any);

    const result = await judgeMechanismSemanticRole({
      candidate: {
        name: "Proprietary Curation & Fit Protocol",
        description: "Sara executes an internal 5-tier fit verification workflow and proprietary curation protocol.",
        steps: ["Tier 1 fabric test", "Tier 2 pattern audit", "Tier 3 curation sign-off"],
        logic: "Proprietary curation ensures premium product standards.",
      },
      positioning: { primaryAxis: "curated_quality" },
      productTruthCapabilities: saraRealProductTruthFacts,
    });

    expect(result.verdict).toBe("REPAIR");
    expect(result.failureType).toBe("OPERATIONAL_CAPABILITY_UPGRADE");
  });

  // =========================================================================
  // Case 4: Strategic combination of verified capabilities
  // =========================================================================
  it("Case 4: approves strategic combination of verified capabilities into causal explanation", async () => {
    vi.spyOn(aiModule, "aiChat").mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              verdict: "APPROVE",
              reasons: ["Valid strategic combination of verified capabilities resolving sizing hesitation"],
              failureType: "NONE",
              operationalClaims: [
                {
                  claim: "Dresses crafted with premium fabrics for comfort",
                  role: "VERIFIED_EXISTING_CAPABILITY",
                  supportedByCapability: "The dresses and modest clothing are crafted with premium fabrics to ensure long-lasting wear and comfort.",
                },
                {
                  claim: "Multiple distinct SKUs ranging from $35 to $62",
                  role: "VERIFIED_EXISTING_CAPABILITY",
                  supportedByCapability: "The summer dresses offering includes multiple distinct SKUs such as BONBON DRESS ($35), HAYAT SET ($40), LUNA SET ($40), GIRLY SET ($62)...",
                },
                {
                  claim: "24-hour product exchange capability",
                  role: "VERIFIED_EXISTING_CAPABILITY",
                  supportedByCapability: "Customer orders are processed with a focus on fast delivery and 24-hour product exchange capability.",
                },
                {
                  claim: "Connecting versatile SKU selection with 24-hour exchanges reduces online purchase risk",
                  role: "STRATEGIC_COMBINATION",
                  supportedByCapability: null,
                },
              ],
              feedback: "",
            }),
          },
        },
      ],
    } as any);

    const result = await judgeMechanismSemanticRole({
      candidate: {
        name: "Curated Modest Dress Assortment & Exchange Assurance System",
        description: "Pairs a diverse SKU assortment ($35-$62) in premium comfortable fabrics with a responsive 24-hour exchange capability to de-risk online modest dressing.",
        steps: [
          "Present accessible price-tiered modest dress SKUs ($35-$62) crafted for long-lasting wear and comfort",
          "Back purchases with 24-hour exchange processing to remove sizing risk",
          "Deliver timeless versatile styling suitable across occasions",
        ],
        logic: "Transparent pricing combined with guaranteed fast exchanges overcomes online hesitation for faith-aligned fashion.",
      },
      positioning: { primaryAxis: "accessible_modesty" },
      productTruthCapabilities: saraRealProductTruthFacts,
    });

    expect(result.verdict).toBe("APPROVE");
    expect(result.failureType).toBe("NONE");
    expect(result.operationalClaims?.length).toBe(4);
    expect(result.operationalClaims?.some((c) => c.role === "STRATEGIC_COMBINATION")).toBe(true);
    expect(result.operationalClaims?.some((c) => c.role === "VERIFIED_EXISTING_CAPABILITY")).toBe(true);
  });

  // =========================================================================
  // Case 5: Clearly future proposal "Could introduce a pre-shipment quality check"
  // =========================================================================
  it("Case 5: allows clearly future proposal as PROPOSED_EXECUTION without treating as existing fact", async () => {
    vi.spyOn(aiModule, "aiChat").mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              verdict: "APPROVE",
              reasons: ["Valid mechanism with clearly framed proposed future execution recommendation"],
              failureType: "NONE",
              operationalClaims: [
                {
                  claim: "Could introduce a pre-shipment quality check to further reduce return rates",
                  role: "PROPOSED_EXECUTION",
                  supportedByCapability: null,
                },
                {
                  claim: "Customer orders backed by 24-hour exchange capability",
                  role: "VERIFIED_EXISTING_CAPABILITY",
                  supportedByCapability: "Customer orders are processed with a focus on fast delivery and 24-hour product exchange capability.",
                },
              ],
              feedback: "",
            }),
          },
        },
      ],
    } as any);

    const result = await judgeMechanismSemanticRole({
      candidate: {
        name: "Modest Fit Exchange Assurance Protocol",
        description: "Relies on verified 24-hour exchange capability; could introduce a pre-shipment quality check to further streamline operations.",
        steps: [
          "Fulfill orders with existing verified 24-hour exchange policy",
          "Proposed: Could introduce a pre-shipment quality check to further reduce returns",
        ],
        logic: "Addresses buyer risk with current exchange capability while outlining future quality improvements.",
      },
      positioning: { primaryAxis: "risk_reduction" },
      productTruthCapabilities: saraRealProductTruthFacts,
    });

    expect(result.verdict).toBe("APPROVE");
    expect(result.failureType).toBe("NONE");
    const proposed = result.operationalClaims?.find((c) => c.role === "PROPOSED_EXECUTION");
    expect(proposed).toBeDefined();
    expect(proposed?.claim).toContain("Could introduce a pre-shipment quality check");
  });

  // =========================================================================
  // Case 6: Physical attribute authority protections hold through canonical Gate 0 authority
  // =========================================================================
  it("Case 6: physical attribute authority protections remain active (comfort ≠ breathable, modesty ≠ opacity)", async () => {
    const { validateAuthorityBoundaries } = await import("../shared/authority-validator");
    const { deriveValidatedCapabilities } = await import("../shared/capability-registry");

    const saraCaps = deriveValidatedCapabilities(null, {
      productTruthFacts: saraRealProductTruthFacts.map((statement, i) => ({
        productTruthFactId: `fact_${i}`,
        statement,
        factType: "CAPABILITY",
      })),
    });

    // 6a: Breathability (unsupported physical attribute without capabilityRef fails Gate 0)
    const resultBreathable = validateAuthorityBoundaries({
      engineId: "mechanism",
      centralProblemTexts: [],
      operationalClaims: [
        {
          claim: "Airflow weave calibration and convection cooling ensures heat dissipation",
          role: "EXISTING_FACTUAL_CLAIM",
          capabilityRef: null,
        },
      ],
      selectedPains: [],
      capabilities: saraCaps,
    });
    expect(resultBreathable.passed).toBe(false);
    expect(resultBreathable.violations.some((v) => v.kind === "UNSUPPORTED_CAPABILITY")).toBe(true);

    // 6b: Opacity / Light-box testing (unsupported lab testing fails Gate 0)
    const resultOpacity = validateAuthorityBoundaries({
      engineId: "mechanism",
      centralProblemTexts: [],
      operationalClaims: [
        {
          claim: "Lab-grade opacity testing with double lining verification ensures complete modesty",
          role: "EXISTING_FACTUAL_CLAIM",
          capabilityRef: null,
        },
      ],
      selectedPains: [],
      capabilities: saraCaps,
    });
    expect(resultOpacity.passed).toBe(false);
    expect(resultOpacity.violations.some((v) => v.kind === "UNSUPPORTED_CAPABILITY")).toBe(true);

    // 6c: Specific fabrics (unsupported linen / viscose compositions fail Gate 0)
    const resultFabric = validateAuthorityBoundaries({
      engineId: "mechanism",
      centralProblemTexts: [],
      operationalClaims: [
        {
          claim: "Crafted with 100% natural linen and viscose fibers",
          role: "EXISTING_FACTUAL_CLAIM",
          capabilityRef: null,
        },
      ],
      selectedPains: [],
      capabilities: saraCaps,
    });
    expect(resultFabric.passed).toBe(false);
    expect(resultFabric.violations.some((v) => v.kind === "UNSUPPORTED_CAPABILITY")).toBe(true);
  });

  // =========================================================================
  // Case 7: Judge unavailable -> BLOCK / fail closed
  // =========================================================================
  it("Case 7: judge network or service error fails closed with BLOCK and JUDGE_UNAVAILABLE", async () => {
    vi.spyOn(aiModule, "aiChat").mockRejectedValueOnce(new Error("ETIMEDOUT: Connection refused to judge model"));

    const result = await judgeMechanismSemanticRole({
      candidate: {
        name: "Standard Garment Protocol",
        description: "Operational protocol for dress distribution.",
        steps: ["Receive order", "Ship dress"],
        logic: "Simple distribution.",
      },
      positioning: { primaryAxis: "standard_delivery" },
      productTruthCapabilities: saraRealProductTruthFacts,
    });

    expect(result.verdict).toBe("BLOCK");
    expect(result.failureType).toBe("JUDGE_UNAVAILABLE");
    expect(result.reasons[0]).toContain("Judge infrastructure failure");
  });

  // =========================================================================
  // Case 8: Positioning contains unsupported operational detail -> rejected
  // =========================================================================
  it("Case 8: does not trust positioning text as Product Truth when positioning claims ungrounded operational detail", async () => {
    vi.spyOn(aiModule, "aiChat").mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              verdict: "REPAIR",
              reasons: [
                "Unsupported existing operational process: 'Sara conducts certified pre-shipment inspections' (not established in canonical Product Truth; positioning territory name cannot authorize capabilities)",
              ],
              failureType: "OPERATIONAL_CAPABILITY_UPGRADE",
              operationalClaims: [
                {
                  claim: "Sara conducts certified pre-shipment inspections",
                  role: "UNSUPPORTED_EXISTING_PROCESS",
                  supportedByCapability: null,
                },
              ],
              feedback: "Positioning territory framing cannot be promoted to an existing business capability.",
            }),
          },
        },
      ],
    } as any);

    const result = await judgeMechanismSemanticRole({
      candidate: {
        name: "Certified Pre-Shipment Inspection System",
        description: "Sara conducts certified pre-shipment inspections as defined in our positioning strategy.",
        steps: ["Inspect every unit before dispatch", "Issue inspection certificate"],
        logic: "Inspection protocol fulfills our positioning territory promise.",
      },
      positioning: {
        primaryAxis: "inspection_assurance",
        territoryName: "Certified Pre-Shipment Inspection Protocol", // Positioning free text contains unverified claim
      },
      productTruthCapabilities: saraRealProductTruthFacts, // Canonical authority does NOT contain inspection
    });

    expect(result.verdict).toBe("REPAIR");
    expect(result.failureType).toBe("OPERATIONAL_CAPABILITY_UPGRADE");
    expect(result.operationalClaims?.[0].role).toBe("UNSUPPORTED_EXISTING_PROCESS");
  });

  // =========================================================================
  // Case 9: Valid existing operational capability explicitly in Product Truth -> PASS
  // =========================================================================
  it("Case 9: passes existing operational capability that is explicitly present in Product Truth (24h exchange)", async () => {
    vi.spyOn(aiModule, "aiChat").mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              verdict: "APPROVE",
              reasons: ["Operational capability is explicitly supported by Product Truth Fact f9c27406 (24-hour exchange)"],
              failureType: "NONE",
              operationalClaims: [
                {
                  claim: "Sara provides 24-hour product exchange processing",
                  role: "VERIFIED_EXISTING_CAPABILITY",
                  supportedByCapability: "Customer orders are processed with a focus on fast delivery and 24-hour product exchange capability.",
                },
              ],
              feedback: "",
            }),
          },
        },
      ],
    } as any);

    const result = await judgeMechanismSemanticRole({
      candidate: {
        name: "Rapid Exchange Assurance Protocol",
        description: "Customer orders are backed by Sara's 24-hour product exchange capability to guarantee sizing confidence.",
        steps: ["Customer places order", "Customer initiates exchange if needed", "24-hour exchange processed"],
        logic: "Guaranteed 24-hour exchange minimizes customer purchase risk.",
      },
      positioning: { primaryAxis: "exchange_speed" },
      productTruthCapabilities: saraRealProductTruthFacts,
    });

    expect(result.verdict).toBe("APPROVE");
    expect(result.failureType).toBe("NONE");
    expect(result.operationalClaims?.[0].role).toBe("VERIFIED_EXISTING_CAPABILITY");
  });
});

describe("Unified Product Truth & Practical Mechanism Standard Regression Suite (Incident orch_1792005873120_bsyeuo)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // Canonical multi-type Product Truth inventory modeling an ordinary food/confectionery offering
  // (7-variety assortment, daily production, verified ingredients, hygienic packaging, same-day shipping)
  const offeringId = "off_sweets_box_7var";
  const snapshotId = "bu_snap_v4_sweets";
  const canonicalSweetsFacts = [
    {
      productTruthFactId: "fact_cap_7var",
      statement: "Mixed confectionery box includes 7 distinct varieties of traditional sweets in a single assortment.",
      factType: "CAPABILITY",
      status: "VERIFIED",
      campaignOfferingId: offeringId,
      scope: "mixed_box_sku",
      qualifications: ["Assortment composition fixed to the 7 listed varieties"],
    },
    {
      productTruthFactId: "fact_qual_ghee",
      statement: "Prepared using 100% pure animal ghee and premium first-grade pistachios.",
      factType: "QUALITY",
      status: "VERIFIED",
      campaignOfferingId: offeringId,
      scope: "ingredients",
      qualifications: ["Contains dairy and tree nuts"],
    },
    {
      productTruthFactId: "fact_qual_clean",
      statement: "Free of artificial preservatives and synthetic food colorings.",
      factType: "QUALITY",
      status: "VERIFIED",
      campaignOfferingId: offeringId,
      scope: "formulation",
    },
    {
      productTruthFactId: "fact_op_daily",
      statement: "Produced fresh daily in small kitchen batches prior to packing.",
      factType: "OPERATIONAL",
      status: "VERIFIED",
      campaignOfferingId: offeringId,
      scope: "production",
    },
    {
      productTruthFactId: "fact_op_pack",
      statement: "Packed in sealed hygienic food-grade boxes to protect items during handling.",
      factType: "OPERATIONAL",
      status: "VERIFIED",
      campaignOfferingId: offeringId,
      scope: "packaging",
    },
    {
      productTruthFactId: "fact_deliv_ship",
      statement: "Orders placed before the cutoff time qualify for same-day shipping dispatch.",
      factType: "DELIVERY_MECHANISM",
      status: "VERIFIED",
      campaignOfferingId: offeringId,
      scope: "fulfillment",
      qualifications: ["Same-day shipping refers to carrier handoff/dispatch, not guaranteed same-day arrival"],
    },
    {
      productTruthFactId: "fact_offer_price",
      statement: "Available in 500g and 1kg gift box configurations.",
      factType: "OFFER",
      status: "VERIFIED",
      campaignOfferingId: offeringId,
    },
    {
      productTruthFactId: "fact_proof_reviews",
      statement: "Verified customer reviews highlight rich pistachio flavor and clean packaging presentation.",
      factType: "PROOF",
      status: "VERIFIED",
      campaignOfferingId: offeringId,
    },
  ];

  // =========================================================================
  // Regression 1: OPERATIONAL and QUALITY facts reach both Proposer and Judge with original factTypes
  // =========================================================================
  it("Regression 1: OPERATIONAL, QUALITY, PROOF, OFFER, and DELIVERY_MECHANISM facts reach both Proposer and Judge with preserved original factTypes", async () => {
    const { deriveValidatedCapabilities } = await import("../shared/capability-registry");
    const { computeProductTruthFingerprint } = await import("../shared/product-dna");
    const { runMechanismEngine } = await import("../mechanism-engine/engine");

    const fingerprint = computeProductTruthFingerprint({
      campaignOfferingId: offeringId,
      snapshotId,
      facts: canonicalSweetsFacts,
    });

    const productDna = {
      productName: "Al-Sham 7-Variety Sweets Box",
      productCategory: "Artisanal Confectionery",
      coreProblemSolved: "Gift buyers struggle to find authentic, freshly prepared traditional sweets with variety for family gatherings",
      uniqueMechanism: "Daily batch preparation with 100% pure animal ghee, premium pistachios, and 7-variety hygienic gift assortment",
      campaignOfferingId: offeringId,
      snapshotId,
      snapshotFingerprint: fingerprint,
      productTruthFacts: canonicalSweetsFacts,
    };

    const caps = deriveValidatedCapabilities(null, productDna);
    expect(caps.length).toBe(canonicalSweetsFacts.length);

    // Original factTypes are preserved — non-CAPABILITY facts are NOT relabeled as CAPABILITY
    expect(caps.find((c) => c.sourceFactId === "fact_qual_ghee")?.factType).toBe("QUALITY");
    expect(caps.find((c) => c.sourceFactId === "fact_op_daily")?.factType).toBe("OPERATIONAL");
    expect(caps.find((c) => c.sourceFactId === "fact_deliv_ship")?.factType).toBe("DELIVERY_MECHANISM");
    expect(caps.find((c) => c.sourceFactId === "fact_offer_price")?.factType).toBe("OFFER");
    expect(caps.find((c) => c.sourceFactId === "fact_proof_reviews")?.factType).toBe("PROOF");

    const capturedPrompts: string[] = [];
    // Synthetic model responses (offline test mock)
    vi.spyOn(aiModule, "aiChat").mockImplementation(async (req: any) => {
      const promptText = req.messages.map((m: any) => m.content).join("\n");
      capturedPrompts.push(promptText);

      if (capturedPrompts.length === 1) {
        // Proposer call (synthetic response)
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  primary: {
                    name: "Daily Fresh Ghee & Seven-Variety Assortment Approach",
                    type: "process",
                    mechanismAuthorityRole: "STRATEGIC_SYNTHESIS",
                    description:
                      "Combines daily small-batch production using 100% pure animal ghee and premium pistachios with a varied seven-variety assortment packed in sealed hygienic boxes and dispatched via same-day shipping.",
                    steps: [
                      "Prepare dough and fillings using 100% pure animal ghee and first-grade pistachios free of artificial preservatives [RC1]",
                      "Bake fresh daily in small kitchen batches and assemble a varied assortment of 7 traditional varieties [CC1]",
                      "Seal in hygienic food-grade boxes and dispatch eligible orders via same-day shipping [BB1]",
                    ],
                    promise: "Freshly prepared 7-variety traditional sweets crafted with pure animal ghee and premium pistachios, packed hygienically.",
                    problem: "Buyers worry that boxed sweets use synthetic substitutes or sit in storage before gifting.",
                    logic: "Combining verified pure ingredients, daily batch production, and a 7-variety assortment addresses ingredient and variety concerns.",
                    whyItWorks:
                      "When buyers purchase traditional sweets for family hospitality [RC1], they hesitate over artificial ingredients and monotonous boxes [BB1]. Seeing concrete ingredient choices (100% pure animal ghee, premium pistachios) paired with daily batch preparation and a seven-variety assortment gives practical confidence without needing exaggerated guarantees.",
                    failureModes: [
                      "Buyers seeking sugar-free or vegan alternatives rather than traditional animal-ghee recipes",
                      "Customers needing guaranteed same-day courier arrival in distant regions where only same-day shipping dispatch applies",
                    ],
                    causalChain: [
                      {
                        cause: "Skepticism toward mass-produced sweets with artificial additives [RC1]",
                        impact: "Pure animal ghee, premium pistachios, and preservative-free formulation establish ingredient integrity",
                        behavior: "Buyer selects the 7-variety box for hosting and gifting [BB1]",
                        upstreamSignalRefs: ["[RC1]", "[BB1]"],
                      },
                    ],
                    commercialFunction: {
                      type: "risk_reduction",
                      description: "Reduces gifting and hosting hesitation through ingredient transparency and assortment variety.",
                    },
                    upstreamDependency: {
                      positioningHook: "craftsmanship",
                      differentiationHook: "Pure Ghee & 7-Variety Assortment",
                    },
                    capabilityRefs: caps.map((c) => c.capabilityId),
                  },
                  groundingRefs: ["RC1"],
                }),
              },
            },
          ],
        } as any;
      }

      // Judge call (synthetic response)
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                verdict: "APPROVE",
                mechanismAuthorityRole: "STRATEGIC_SYNTHESIS",
                reasons: ["All ingredient, daily production, hygienic packaging, and 7-variety assortment statements are grounded in canonical Product Truth."],
                failureType: "NONE",
                embeddedFactualPredicates: [
                  {
                    predicate: "Prepared with 100% pure animal ghee and premium pistachios free of artificial preservatives",
                    classification: "SUPPORTED_FACTUAL_STATEMENT",
                    isSupported: true,
                    matchedCapability: `${caps[1].capabilityId}, ${caps[2].capabilityId}`,
                  },
                  {
                    predicate: "Varied seven-variety assortment produced fresh daily and packed in hygienic boxes",
                    classification: "REASONABLE_DESCRIPTIVE_SYNTHESIS",
                    isSupported: true,
                    matchedCapability: `${caps[0].capabilityId}, ${caps[3].capabilityId}, ${caps[4].capabilityId}`,
                  },
                ],
                unsupportedPredicates: [],
                operationalClaims: [
                  {
                    claim: "Prepared using 100% pure animal ghee and premium pistachios",
                    role: "SUPPORTED_FACTUAL_STATEMENT",
                    supportedByCapability: caps[1].capabilityId,
                  },
                  {
                    claim: "Daily small-batch production combined with sealed hygienic boxes and a varied seven-variety assortment",
                    role: "REASONABLE_DESCRIPTIVE_SYNTHESIS",
                    supportedByCapability: `${caps[0].capabilityId}, ${caps[3].capabilityId}, ${caps[4].capabilityId}`,
                  },
                ],
                axisVerdict: "ALIGNED",
                axisReason: "Directly supports craftsmanship and ingredient quality.",
                feedback: "",
              }),
            },
          },
        ],
      } as any;
    });

    const result = await runMechanismEngine(
      {
        differentiationVector: ["craftsmanship"],
        contrastAxis: "Authentic pure-ghee daily batch craft vs mass-produced synthetic sweets",
      },
      {
        pillars: [{ name: "Pure Ghee & 7-Variety Assortment", description: "Traditional ingredients and varied box" }],
        campaignOfferingId: offeringId,
        productTruthSnapshotId: snapshotId,
        productTruthFingerprint: fingerprint,
      },
      "acc_test_sweets",
      null,
      undefined,
      productDna,
    );

    expect(result.status).toBe("COMPLETE");
    expect(capturedPrompts.length).toBe(2);

    // Verify Proposer prompt received QUALITY, OPERATIONAL, DELIVERY_MECHANISM, OFFER, PROOF facts with their original types
    const proposerPrompt = capturedPrompts[0];
    expect(proposerPrompt).toContain("[QUALITY]");
    expect(proposerPrompt).toContain("[OPERATIONAL]");
    expect(proposerPrompt).toContain("[DELIVERY_MECHANISM]");
    expect(proposerPrompt).toContain("100% pure animal ghee");
    expect(proposerPrompt).toContain("Produced fresh daily in small kitchen batches");

    // Verify Judge prompt ALSO received the exact same canonical inventory with original types and snapshot fingerprint
    const judgePrompt = capturedPrompts[1];
    expect(judgePrompt).toContain("type=QUALITY");
    expect(judgePrompt).toContain("type=OPERATIONAL");
    expect(judgePrompt).toContain("type=DELIVERY_MECHANISM");
    expect(judgePrompt).toContain("100% pure animal ghee");
    expect(judgePrompt).toContain("Produced fresh daily in small kitchen batches");
    expect(judgePrompt).toContain(snapshotId);
    expect(judgePrompt).toContain(fingerprint);
  });

  // =========================================================================
  // Regression 2 & 9: Canonical snapshot/fingerprint recorded across handoffs; offering/version/fingerprint mismatches fail explicitly
  // =========================================================================
  it("Regression 2 & 9: preserves identical snapshot/fingerprint across handoffs and fails explicitly on offering, version, or fingerprint mismatch", async () => {
    const { computeProductTruthFingerprint, verifyProductTruthSnapshotLineage } = await import("../shared/product-dna");
    const { runMechanismEngine } = await import("../mechanism-engine/engine");

    const fingerprint = computeProductTruthFingerprint({
      campaignOfferingId: offeringId,
      snapshotId,
      facts: canonicalSweetsFacts,
    });

    // Valid lineage handoff succeeds
    expect(() =>
      verifyProductTruthSnapshotLineage(
        {
          snapshotId,
          snapshotFingerprint: fingerprint,
          campaignOfferingId: offeringId,
        },
        {
          expectedOfferingId: offeringId,
          expectedSnapshotId: snapshotId,
          expectedFingerprint: fingerprint,
        },
        "TestHandoff",
      ),
    ).not.toThrow();

    // Offering mismatch fails explicitly
    expect(() =>
      verifyProductTruthSnapshotLineage(
        {
          snapshotId,
          snapshotFingerprint: fingerprint,
          campaignOfferingId: "off_wrong_offering",
        },
        {
          expectedOfferingId: offeringId,
          expectedSnapshotId: snapshotId,
          expectedFingerprint: fingerprint,
        },
        "MechanismEngine",
      ),
    ).toThrow(/PRODUCT_TRUTH_OFFERING_MISMATCH/);

    // Snapshot version mismatch fails explicitly
    expect(() =>
      verifyProductTruthSnapshotLineage(
        {
          snapshotId: "bu_snap_v5_reloaded_midrun",
          snapshotFingerprint: fingerprint,
          campaignOfferingId: offeringId,
        },
        {
          expectedOfferingId: offeringId,
          expectedSnapshotId: snapshotId,
          expectedFingerprint: fingerprint,
        },
        "MechanismEngine",
      ),
    ).toThrow(/PRODUCT_TRUTH_VERSION_MISMATCH/);

    // Fingerprint mismatch fails explicitly through runMechanismEngine
    await expect(
      runMechanismEngine(
        { differentiationVector: ["craftsmanship"], contrastAxis: "Quality vs mass" },
        {
          pillars: [{ name: "Quality", description: "Pure ghee" }],
          campaignOfferingId: offeringId,
          productTruthSnapshotId: snapshotId,
          productTruthFingerprint: "pt_fp_tampered_999999",
        },
        "acc_test_sweets",
        null,
        undefined,
        {
          campaignOfferingId: offeringId,
          snapshotId,
          snapshotFingerprint: fingerprint,
          productTruthFacts: canonicalSweetsFacts,
        },
      ),
    ).rejects.toThrow(/PRODUCT_TRUTH_FINGERPRINT_MISMATCH/);
  });

  // =========================================================================
  // Regression 3, 4, 5: Seven-variety assortment natural synthesis + daily production/ingredients/packaging ordinary mechanism passes without proprietary tech or guarantees
  // =========================================================================
  it("Regression 3, 4 & 5: accepts 'varied/curated assortment' for 7-variety box and ordinary daily production + ingredients + hygienic packaging without proprietary tech or total guarantees", async () => {
    const { deriveValidatedCapabilities } = await import("../shared/capability-registry");
    const { validateAuthorityBoundaries } = await import("../shared/authority-validator");

    const caps = deriveValidatedCapabilities(null, {
      campaignOfferingId: offeringId,
      snapshotId,
      productTruthFacts: canonicalSweetsFacts,
    });

    // Synthetic Judge response evaluating natural synthesis ("varied assortment" / "curated assortment")
    // and coherent combination of daily production + ingredients + hygienic packaging
    vi.spyOn(aiModule, "aiChat").mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              verdict: "APPROVE",
              mechanismAuthorityRole: "STRATEGIC_SYNTHESIS",
              reasons: [
                "Natural descriptive synthesis of the verified 7-variety box as a 'curated assortment' and coherent combination of daily batch production, 100% pure animal ghee, premium pistachios, and hygienic packaging.",
              ],
              failureType: "NONE",
              embeddedFactualPredicates: [
                {
                  predicate: "Curated seven-variety assortment offering varied traditional options for family gatherings",
                  classification: "REASONABLE_DESCRIPTIVE_SYNTHESIS",
                  isSupported: true,
                  matchedCapability: caps[0].capabilityId,
                },
                {
                  predicate: "Daily batch production with 100% pure animal ghee, premium pistachios, and sealed hygienic packaging",
                  classification: "REASONABLE_DESCRIPTIVE_SYNTHESIS",
                  isSupported: true,
                  matchedCapability: `${caps[1].capabilityId}, ${caps[3].capabilityId}, ${caps[4].capabilityId}`,
                },
                {
                  predicate: "Helps reduce buyer hesitation when selecting a mixed gift box for guests",
                  classification: "BOUNDED_INTERPRETATION",
                  isSupported: true,
                  matchedCapability: null,
                },
              ],
              unsupportedPredicates: [],
              operationalClaims: [
                {
                  claim: "Curated seven-variety assortment of traditional sweets",
                  role: "REASONABLE_DESCRIPTIVE_SYNTHESIS",
                  supportedByCapability: caps[0].capabilityId,
                },
                {
                  claim: "Daily small-batch production with 100% pure animal ghee, premium pistachios, and hygienic food-grade packaging",
                  role: "REASONABLE_DESCRIPTIVE_SYNTHESIS",
                  supportedByCapability: `${caps[1].capabilityId}, ${caps[3].capabilityId}, ${caps[4].capabilityId}`,
                },
                {
                  claim: "Addresses host concern about guest variety preferences",
                  role: "BOUNDED_INTERPRETATION",
                  supportedByCapability: null,
                },
              ],
              axisVerdict: "ALIGNED",
              axisReason: "Aligned with craftsmanship and product quality.",
              feedback: "",
            }),
          },
        },
      ],
    } as any);

    const judgeRes = await judgeMechanismSemanticRole({
      candidate: {
        name: "Daily Fresh Production & Seven-Variety Assortment",
        description:
          "Combines a curated assortment of seven traditional sweet varieties with daily batch preparation using 100% pure animal ghee, premium pistachios, and hygienic food-grade packaging.",
        steps: [
          "Select 100% pure animal ghee and first-grade pistachios with no artificial preservatives",
          "Prepare fresh daily in small batches and assemble a varied seven-variety assortment",
          "Pack in sealed hygienic boxes and dispatch eligible orders with same-day shipping",
        ],
        logic: "Ordinary ingredient quality, daily preparation, and assortment variety work together to address host concerns without claiming a proprietary invention or total guarantee.",
        mechanismAuthorityRole: "STRATEGIC_SYNTHESIS",
      },
      positioning: { primaryAxis: "craftsmanship" },
      productTruthCapabilities: caps.map((c) => c.statement),
      capabilities: caps,
      productTruthFacts: canonicalSweetsFacts,
      productTruthSnapshotId: snapshotId,
    });

    expect(judgeRes.verdict).toBe("APPROVE");
    expect(judgeRes.failureType).toBe("NONE");
    expect(judgeRes.unsupportedPredicates).toEqual([]);

    // Verify Gate 0 authority validation passes compound capability references and synthesis roles
    const authRes = validateAuthorityBoundaries({
      engineId: "mechanism",
      centralProblemTexts: ["Buyers want authentic ingredients and variety when gifting sweets"],
      capabilityRefs: [caps[0].capabilityId, caps[1].capabilityId, caps[3].capabilityId, caps[4].capabilityId],
      operationalClaims: judgeRes.operationalClaims,
      unsupportedPredicates: judgeRes.unsupportedPredicates,
      selectedPains: [],
      capabilities: caps,
    });

    expect(authRes.passed).toBe(true);
    expect(authRes.violations).toEqual([]);
    expect(authRes.canonicalFactualClaims?.length).toBeGreaterThanOrEqual(2);
  });

  // =========================================================================
  // Regression 6, 7, 10: Targeted lightweight repair fixes one overstated phrase & same-day delivery->shipping while preserving supported content and passing authority validation
  // =========================================================================
  it("Regression 6, 7 & 10: repairs one overstated phrase and normalizes 'same-day delivery' to verified 'same-day shipping' in Round 2 while preserving supported Round 1 content and passing authority validation", async () => {
    const { deriveValidatedCapabilities } = await import("../shared/capability-registry");
    const { computeProductTruthFingerprint } = await import("../shared/product-dna");
    const { runMechanismEngine } = await import("../mechanism-engine/engine");
    const { isMechanismAuthoritative } = await import("../orchestrator/index");

    const fingerprint = computeProductTruthFingerprint({
      campaignOfferingId: offeringId,
      snapshotId,
      facts: canonicalSweetsFacts,
    });

    const productDna = {
      productName: "Al-Sham 7-Variety Sweets Box",
      productCategory: "Artisanal Confectionery",
      coreProblemSolved: "Buyers worry about artificial ingredients and lack of variety in boxed sweets",
      uniqueMechanism: "Daily batch preparation with 100% pure animal ghee, premium pistachios, and 7-variety hygienic gift assortment",
      campaignOfferingId: offeringId,
      snapshotId,
      snapshotFingerprint: fingerprint,
      productTruthFacts: canonicalSweetsFacts,
    };

    const caps = deriveValidatedCapabilities(null, productDna);
    const capturedPrompts: string[] = [];

    // Synthetic model responses for Round 1 Proposer -> Round 1 Judge (REPAIR) -> Round 2 Proposer (Repaired) -> Round 2 Judge (APPROVE)
    vi.spyOn(aiModule, "aiChat").mockImplementation(async (req: any) => {
      const promptText = req.messages.map((m: any) => m.content).join("\n");
      capturedPrompts.push(promptText);
      const callIdx = capturedPrompts.length;

      if (callIdx === 1) {
        // Round 1 Proposer: valid ingredients/assortment/daily production, PLUS one unsupported 30-day freshness lock guarantee & "same-day delivery"
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  primary: {
                    name: "Daily Fresh Ghee & Seven-Variety Assortment",
                    type: "process",
                    mechanismAuthorityRole: "STRATEGIC_SYNTHESIS",
                    description:
                      "Combines 100% pure animal ghee, premium pistachios, and a varied 7-variety assortment with an airtight 30-day freshness-preservation guarantee and same-day delivery.",
                    steps: [
                      "Craft dough and fillings with 100% pure animal ghee and premium pistachios with zero artificial preservatives [RC1]",
                      "Prepare fresh daily in small batches and assemble a varied 7-variety assortment [CC1]",
                      "Lock in a 30-day freshness-preservation guarantee and fulfill via same-day delivery [BB1]",
                      "Prepare fresh daily in small batches and assemble a varied 7-variety assortment [CC1]", // duplicate step to verify deterministic cleanup
                    ],
                    promise: "Guaranteed 30-day freshness preservation with same-day delivery to your door.",
                    problem: "Buyers worry about artificial ingredients and lack of variety when gifting boxed sweets.",
                    logic: "Pure ingredients, daily batches, and seven varieties solve gifting hesitation.",
                    whyItWorks:
                      "Buyers evaluating boxed sweets worry about artificial substitutes [RC1] and monotonous assortments [BB1]. Combining 100% pure animal ghee, premium pistachios, daily production, and a seven-variety box gives clear factual reassurance.",
                    failureModes: [
                      "Customers seeking dietary-restricted or vegan confections",
                      "Orders placed after the daily shipping cutoff window",
                    ],
                    causalChain: [
                      {
                        cause: "Concern over synthetic ingredients in boxed sweets [RC1]",
                        impact: "100% pure animal ghee and premium pistachios establish ingredient quality",
                        behavior: "Customer confidently orders the 7-variety assortment [BB1]",
                        upstreamSignalRefs: ["[RC1]", "[BB1]"],
                      },
                    ],
                    commercialFunction: {
                      type: "risk_reduction",
                      description: "Reduces gifting hesitation through verified ingredients and assortment variety.",
                    },
                    upstreamDependency: {
                      positioningHook: "craftsmanship",
                      differentiationHook: "Pure Ghee & 7-Variety Assortment",
                    },
                    capabilityRefs: [caps[0].capabilityId, caps[0].capabilityId, caps[1].capabilityId, caps[3].capabilityId, caps[4].capabilityId, caps[5].capabilityId],
                  },
                  groundingRefs: ["RC1", "RC1"],
                }),
              },
            },
          ],
        } as any;
      }

      if (callIdx === 2) {
        // Round 1 Judge: flags ONLY the unsupported 30-day freshness-preservation guarantee and same-day delivery (since only same-day shipping is verified), while marking the 7-variety assortment, pure ghee/pistachios, and daily production as supported!
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  verdict: "REPAIR",
                  mechanismAuthorityRole: "STRATEGIC_SYNTHESIS",
                  reasons: [
                    "Overstates packaging as a '30-day freshness-preservation guarantee' (Product Truth only verifies daily production and sealed hygienic food-grade boxes).",
                    "Claims 'same-day delivery' arrival whereas Product Truth only verifies 'same-day shipping' dispatch.",
                  ],
                  failureType: "OPERATIONAL_CAPABILITY_UPGRADE",
                  embeddedFactualPredicates: [
                    {
                      predicate: "Crafted with 100% pure animal ghee, premium pistachios, and zero artificial preservatives",
                      classification: "SUPPORTED_FACTUAL_STATEMENT",
                      isSupported: true,
                      matchedCapability: `${caps[1].capabilityId}, ${caps[2].capabilityId}`,
                    },
                    {
                      predicate: "Prepared fresh daily in small batches with a varied 7-variety assortment",
                      classification: "REASONABLE_DESCRIPTIVE_SYNTHESIS",
                      isSupported: true,
                      matchedCapability: `${caps[0].capabilityId}, ${caps[3].capabilityId}`,
                    },
                    {
                      predicate: "30-day freshness-preservation guarantee",
                      classification: "UNSUPPORTED_MATERIAL_ASSERTION",
                      isSupported: false,
                      matchedCapability: null,
                    },
                    {
                      predicate: "same-day delivery",
                      classification: "UNSUPPORTED_MATERIAL_ASSERTION",
                      isSupported: false,
                      matchedCapability: null,
                    },
                  ],
                  unsupportedPredicates: ["30-day freshness-preservation guarantee", "same-day delivery"],
                  operationalClaims: [
                    {
                      claim: "Crafted with 100% pure animal ghee and premium pistachios",
                      role: "SUPPORTED_FACTUAL_STATEMENT",
                      supportedByCapability: caps[1].capabilityId,
                    },
                    {
                      claim: "Prepared fresh daily in small batches with a varied 7-variety assortment",
                      role: "REASONABLE_DESCRIPTIVE_SYNTHESIS",
                      supportedByCapability: `${caps[0].capabilityId}, ${caps[3].capabilityId}`,
                    },
                    {
                      claim: "30-day freshness-preservation guarantee and same-day delivery",
                      role: "UNSUPPORTED_MATERIAL_ASSERTION",
                      supportedByCapability: null,
                    },
                  ],
                  axisVerdict: "ALIGNED",
                  axisReason: "Aligned with craftsmanship.",
                  feedback:
                    "Replace '30-day freshness-preservation guarantee' with verified daily production and sealed hygienic food-grade boxes, and use 'same-day shipping' instead of 'same-day delivery'.",
                }),
              },
            },
          ],
        } as any;
      }

      if (callIdx === 3) {
        // Round 2 Proposer (Targeted Repair): replaces ONLY step 3 / description / promise while leaving supported fields intact (and even if description accidentally leaves "same-day delivery", deterministic normalization converts it to "same-day shipping")
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  primary: {
                    name: "Daily Fresh Ghee & Seven-Variety Assortment",
                    type: "process",
                    mechanismAuthorityRole: "STRATEGIC_SYNTHESIS",
                    description:
                      "Combines 100% pure animal ghee, premium pistachios, and a varied 7-variety assortment with daily small-batch production, sealed hygienic food-grade packaging, and same-day delivery.",
                    steps: [
                      "Craft dough and fillings with 100% pure animal ghee and premium pistachios with zero artificial preservatives [RC1]",
                      "Prepare fresh daily in small batches and assemble a varied 7-variety assortment [CC1]",
                      "Pack in sealed hygienic food-grade boxes and dispatch eligible orders via same-day shipping [BB1]",
                    ],
                    promise: "Freshly prepared 7-variety traditional sweets in sealed hygienic boxes with same-day shipping dispatch.",
                    problem: "Buyers worry about artificial ingredients and lack of variety when gifting boxed sweets.",
                    logic: "Pure ingredients, daily batches, hygienic packaging, and seven varieties solve gifting hesitation.",
                    capabilityRefs: [caps[0].capabilityId, caps[1].capabilityId, caps[3].capabilityId, caps[4].capabilityId, caps[5].capabilityId],
                  },
                  groundingRefs: ["RC1"],
                }),
              },
            },
          ],
        } as any;
      }

      // Round 2 Judge: APPROVE
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                verdict: "APPROVE",
                mechanismAuthorityRole: "STRATEGIC_SYNTHESIS",
                reasons: ["Unsupported freshness guarantee removed and delivery normalized to verified same-day shipping."],
                failureType: "NONE",
                embeddedFactualPredicates: [
                  {
                    predicate: "Crafted with 100% pure animal ghee, premium pistachios, and zero artificial preservatives",
                    classification: "SUPPORTED_FACTUAL_STATEMENT",
                    isSupported: true,
                    matchedCapability: `${caps[1].capabilityId}, ${caps[2].capabilityId}`,
                  },
                  {
                    predicate: "Prepared fresh daily in small batches with a varied 7-variety assortment, packed in sealed hygienic boxes with same-day shipping",
                    classification: "REASONABLE_DESCRIPTIVE_SYNTHESIS",
                    isSupported: true,
                    matchedCapability: `${caps[0].capabilityId}, ${caps[3].capabilityId}, ${caps[4].capabilityId}, ${caps[5].capabilityId}`,
                  },
                ],
                unsupportedPredicates: [],
                operationalClaims: [
                  {
                    claim: "Crafted with 100% pure animal ghee and premium pistachios",
                    role: "SUPPORTED_FACTUAL_STATEMENT",
                    supportedByCapability: caps[1].capabilityId,
                  },
                  {
                    claim: "Daily batch production, varied 7-variety assortment, sealed hygienic boxes, and same-day shipping",
                    role: "REASONABLE_DESCRIPTIVE_SYNTHESIS",
                    supportedByCapability: `${caps[0].capabilityId}, ${caps[3].capabilityId}, ${caps[4].capabilityId}, ${caps[5].capabilityId}`,
                  },
                ],
                axisVerdict: "ALIGNED",
                axisReason: "Aligned with craftsmanship.",
                feedback: "",
              }),
            },
          },
        ],
      } as any;
    });

    const result = await runMechanismEngine(
      {
        differentiationVector: ["craftsmanship"],
        contrastAxis: "Authentic pure-ghee daily batch craft vs mass-produced synthetic sweets",
      },
      {
        pillars: [{ name: "Pure Ghee & 7-Variety Assortment", description: "Traditional ingredients and varied box" }],
        campaignOfferingId: offeringId,
        productTruthSnapshotId: snapshotId,
        productTruthFingerprint: fingerprint,
      },
      "acc_test_sweets",
      null,
      undefined,
      productDna,
    );

    // Verify repair prompt contained all 5 required targeted-repair elements:
    // 1. Exact unsupported predicates
    // 2. Reasons for rejection
    // 3. Relevant supporting fact IDs and their limitations
    // 4. Parts of the candidate that already passed
    // 5. Same canonical evidence snapshot & fingerprint
    const repairPrompt = capturedPrompts[2];
    expect(repairPrompt).toContain("TARGETED MECHANISM REPAIR");
    expect(repairPrompt).toContain("30-day freshness-preservation guarantee");
    expect(repairPrompt).toContain("same-day delivery");
    expect(repairPrompt).toContain("fact_deliv_ship");
    expect(repairPrompt).toContain("Same-day shipping refers to carrier handoff/dispatch, not guaranteed same-day arrival");
    expect(repairPrompt).toContain("[PASSED]");
    expect(repairPrompt).toContain(snapshotId);
    expect(repairPrompt).toContain(fingerprint);

    // Verify Round 2 Judge prompt received previouslyAcceptedClaims so unchanged accepted claims aren't re-rejected
    const round2JudgePrompt = capturedPrompts[3];
    expect(round2JudgePrompt).toContain("PREVIOUSLY ACCEPTED CLAIMS (DO NOT RE-REJECT UNCHANGED SUPPORTED CONTENT)");

    // Verify deterministic cleanup & shipping-vs-delivery normalization & Round 1 field preservation
    expect(result.status).toBe("COMPLETE");
    expect(result.primaryMechanism.mechanismDescription).toContain("same-day shipping");
    expect(result.primaryMechanism.mechanismDescription).not.toContain("same-day delivery");
    expect(result.primaryMechanism.mechanismDescription).not.toContain("30-day freshness-preservation guarantee");
    // Preserved whyItWorks, causalChain, failureModes, commercialFunction from Round 1 without regenerating unrelated sections
    expect(result.primaryMechanism.whyItWorks).toContain("100% pure animal ghee");
    expect(result.primaryMechanism.causalChain?.length).toBe(1);
    expect(result.primaryMechanism.commercialFunction?.type).toBe("risk_reduction");
    expect(result.productTruthSnapshotId).toBe(snapshotId);
    expect(result.productTruthFingerprint).toBe(fingerprint);

    // Regression 10: Verify repaired Mechanism output passes production authority validation and isMechanismAuthoritative for orchestration handoff
    expect(isMechanismAuthoritative(result)).toBe(true);
    expect(result.primaryMechanism.factualCapabilities?.length).toBeGreaterThanOrEqual(2);
  });

  // =========================================================================
  // Regression 8: Unsupported mold-prevention, preservation performance, invented labs, and certifications remain rejected
  // =========================================================================
  it("Regression 8: rejects unsupported mold-prevention, preservation performance guarantees, invented QA labs, and certifications", async () => {
    const { deriveValidatedCapabilities } = await import("../shared/capability-registry");
    const { validateAuthorityBoundaries } = await import("../shared/authority-validator");

    const caps = deriveValidatedCapabilities(null, {
      campaignOfferingId: offeringId,
      snapshotId,
      productTruthFacts: canonicalSweetsFacts,
    });

    vi.spyOn(aiModule, "aiChat").mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              verdict: "REPAIR",
              mechanismAuthorityRole: "STRATEGIC_SYNTHESIS",
              reasons: [
                "Invented antimicrobial mold-prevention barrier and 60-day preservation performance guarantee not in Product Truth",
                "Invented ISO-certified food laboratory testing protocol not in Product Truth",
              ],
              failureType: "OPERATIONAL_CAPABILITY_UPGRADE",
              embeddedFactualPredicates: [
                {
                  predicate: "ISO-certified food laboratory testing and antimicrobial mold-prevention barrier guaranteeing 60-day shelf life",
                  classification: "UNSUPPORTED_MATERIAL_ASSERTION",
                  isSupported: false,
                  matchedCapability: null,
                },
              ],
              unsupportedPredicates: [
                "ISO-certified food laboratory testing",
                "antimicrobial mold-prevention barrier guaranteeing 60-day shelf life",
              ],
              operationalClaims: [
                {
                  claim: "ISO-certified food laboratory testing and antimicrobial mold-prevention barrier guaranteeing 60-day shelf life",
                  role: "UNSUPPORTED_MATERIAL_ASSERTION",
                  supportedByCapability: null,
                },
              ],
              axisVerdict: "ALIGNED",
              axisReason: "Aligned on quality axis, but factual claims are invented.",
              feedback: "Remove invented ISO lab testing, antimicrobial mold-prevention, and 60-day shelf-life guarantees.",
            }),
          },
        },
      ],
    } as any);

    const judgeRes = await judgeMechanismSemanticRole({
      candidate: {
        name: "ISO-Lab Antimicrobial Preservation System",
        description:
          "Every batch undergoes ISO-certified food laboratory testing and is sealed with an antimicrobial mold-prevention barrier guaranteeing 60-day shelf life.",
        steps: [
          "Run ISO-certified laboratory moisture and purity assays on every batch",
          "Apply antimicrobial mold-prevention packaging barrier",
          "Guarantee 60-day zero-spoilage preservation performance",
        ],
        logic: "Lab certification and mold-prevention engineering eliminate spoilage.",
      },
      positioning: { primaryAxis: "craftsmanship" },
      productTruthCapabilities: caps.map((c) => c.statement),
      capabilities: caps,
      productTruthFacts: canonicalSweetsFacts,
      productTruthSnapshotId: snapshotId,
    });

    expect(judgeRes.verdict).toBe("REPAIR");
    expect(judgeRes.failureType).toBe("OPERATIONAL_CAPABILITY_UPGRADE");
    expect(judgeRes.unsupportedPredicates).toContain("ISO-certified food laboratory testing");

    // Gate 0 Authority Validator also rejects UNSUPPORTED_MATERIAL_ASSERTION and unsupportedPredicates even if several valid capabilityRefs were cited alongside it
    const authRes = validateAuthorityBoundaries({
      engineId: "mechanism",
      centralProblemTexts: [],
      capabilityRefs: [caps[0].capabilityId, caps[1].capabilityId, caps[3].capabilityId],
      operationalClaims: judgeRes.operationalClaims,
      unsupportedPredicates: judgeRes.unsupportedPredicates,
      selectedPains: [],
      capabilities: caps,
    });

    expect(authRes.passed).toBe(false);
    expect(authRes.violations.some((v) => v.kind === "UNSUPPORTED_CAPABILITY")).toBe(true);
    expect(authRes.violations.some((v) => v.detail.includes("ISO-certified food laboratory testing"))).toBe(true);
  });
});

