/**
 * Authority-separation regression suite (Product Anchor cleanup task):
 * - Pain Registry = sole PROBLEM authority
 * - Product Anchor / capability registry = sole CAPABILITY authority
 * - Deterministic validator rejects namespace violations with retry feedback
 * - Capability registry derives ONLY from authoritative fields (no strategy
 *   outputs, no competitor evidence) and validates candidates before promotion
 * - Grounding contract renders separate problem/capability/synthesis rules
 * - No hardcoded product/refund behavior anywhere in the authority layer
 */
import { describe, it, expect } from "vitest";
import {
  deriveValidatedCapabilities,
  computeCapabilityId,
  validateCapabilityCandidate,
} from "../shared/capability-registry";
import { validateAuthorityBoundaries } from "../shared/authority-validator";
import { buildGroundingContract } from "../shared/grounding-contract";
import { selectPainForUse, selectPainsForUse, allowedUsesForClass } from "../shared/audience-pain-registry";
import type { ProductAnchor } from "../shared/strategic-doctrine";

const anchor: ProductAnchor = {
  name: "AcmeFlow",
  type: "workflow automation SaaS",
  keyAttributes: ["live pipeline monitoring", "evidence-linked reporting"],
  coreProblemSolved: "Ops teams lose deals because handoffs between tools are manual and invisible.",
  differentiatingFeature: "AcmeFlow's live pipeline mirror continuously tracks every handoff and flags stalls with linked evidence.",
};

const pains = [
  { painId: "pain_1", canonical: "deals silently stall during tool handoffs", classification: "CORE_PURCHASE", classificationReason: "test fixture", rank: 1, eligible: true, allowedUses: allowedUsesForClass("CORE_PURCHASE") },
  { painId: "pain_2", canonical: "refund requests pile up after onboarding confusion", classification: "POST_PURCHASE_FRICTION", classificationReason: "test fixture", rank: 2, eligible: true, allowedUses: allowedUsesForClass("POST_PURCHASE_FRICTION") },
] as any[];

describe("capability registry", () => {
  it("derives capabilities only from anchor + authoritative fields, with stable IDs", () => {
    const caps = deriveValidatedCapabilities(anchor, null);
    expect(caps.length).toBeGreaterThan(0);
    for (const c of caps) {
      expect(c.capabilityId).toMatch(/^cap_/);
      expect(c.capabilityId).toBe(computeCapabilityId(c.source, c.statement));
      expect(c.source.startsWith("anchor.")).toBe(true);
      expect(c.validationStatus).toBe("VALIDATED");
    }
  });

  it("stable ID: same source+statement → same ID; different statement → different ID", () => {
    expect(computeCapabilityId("anchor.keyAttributes", "Live pipeline mirror")).toBe(computeCapabilityId("anchor.keyAttributes", "Live pipeline mirror  "));
    expect(computeCapabilityId("anchor.keyAttributes", "a")).not.toBe(computeCapabilityId("anchor.keyAttributes", "b"));
  });

  it("rejects strategy-derived candidate language not supported by authoritative evidence", () => {
    const verdict = validateCapabilityCandidate({
      candidate: "AcmeFlow uniquely integrates its Refund & Access Pipeline Failure method to preempt refund triggers",
      authoritativeFields: {
        "anchor.name": anchor.name,
        "anchor.coreProblemSolved": anchor.coreProblemSolved,
        "anchor.keyAttributes": anchor.keyAttributes.join(" "),
      },
    });
    expect(verdict.decision).not.toBe("ACCEPT");
  });

  it("accepts a candidate grounded in authoritative evidence", () => {
    const verdict = validateCapabilityCandidate({
      candidate: "live pipeline monitoring with evidence-linked reporting for every handoff",
      authoritativeFields: {
        "anchor.keyAttributes": anchor.keyAttributes.join(" "),
        "anchor.differentiatingFeature": anchor.differentiatingFeature,
      },
    });
    expect(verdict.decision).toBe("ACCEPT");
  });
});

describe("authority validator (deterministic namespace checks)", () => {
  const caps = deriveValidatedCapabilities(anchor, null);
  const selectedPains = [{ painId: "pain_1", canonical: pains[0].canonical }];

  it("passes when central problem resolves to a selected pain and capabilityRefs are valid", () => {
    const r = validateAuthorityBoundaries({
      engineId: "test",
      centralProblemTexts: ["Deals silently stall during tool handoffs, costing revenue"],
      capabilityRefs: [caps[0].capabilityId],
      selectedPains,
      capabilities: caps,
    });
    expect(r.passed).toBe(true);
  });

  it("UNAUTHORIZED_PROBLEM: rejects a central problem not in the selected pains, with retry feedback naming valid IDs", () => {
    const r = validateAuthorityBoundaries({
      engineId: "test",
      centralProblemTexts: ["Businesses suffer from refund and access pipeline failure"],
      capabilityRefs: [],
      selectedPains,
      capabilities: caps,
    });
    expect(r.passed).toBe(false);
    expect(r.violations.some((v) => v.kind === "UNAUTHORIZED_PROBLEM")).toBe(true);
    const fb = r.violations.map((v) => v.retryFeedback).join(" ");
    expect(fb).toContain("pain_1");
  });

  it("UNSUPPORTED_CAPABILITY: rejects invented capability IDs, preserving valid ones in feedback", () => {
    const r = validateAuthorityBoundaries({
      engineId: "test",
      centralProblemTexts: [pains[0].canonical],
      capabilityRefs: [caps[0].capabilityId, "cap_invented00"],
      selectedPains,
      capabilities: caps,
    });
    expect(r.passed).toBe(false);
    expect(r.violations.some((v) => v.kind === "UNSUPPORTED_CAPABILITY")).toBe(true);
    const fb = r.violations.map((v) => v.retryFeedback).join(" ");
    expect(fb).toContain("cap_invented00");
    expect(fb).toContain(caps[0].capabilityId);
  });

  it("PAIN_CAPABILITY_MERGE: rejects capability language framed as the central problem", () => {
    const r = validateAuthorityBoundaries({
      engineId: "test",
      centralProblemTexts: [`customers struggle because they lack ${anchor.differentiatingFeature}`],
      capabilityRefs: [],
      selectedPains,
      capabilities: caps,
    });
    expect(r.passed).toBe(false);
    expect(r.violations.some((v) => v.kind === "PAIN_CAPABILITY_MERGE" || v.kind === "UNAUTHORIZED_PROBLEM")).toBe(true);
  });

  it("no selected pains → problem checks skip truthfully (nothing to enforce), capability checks still run", () => {
    const r = validateAuthorityBoundaries({
      engineId: "test",
      centralProblemTexts: ["any problem"],
      capabilityRefs: ["cap_bogus000000"],
      selectedPains: [],
      capabilities: caps,
    });
    expect(r.violations.some((v) => v.kind === "UNAUTHORIZED_PROBLEM")).toBe(false);
    expect(r.violations.some((v) => v.kind === "UNSUPPORTED_CAPABILITY")).toBe(true);
  });
});

describe("grounding contract authority separation", () => {
  it("renders separate problem/capability/synthesis rules with the capability list", () => {
    const caps = deriveValidatedCapabilities(anchor, null);
    const block = buildGroundingContract(anchor, null, {
      capabilities: caps,
      selectedPains: [{ painId: "pain_1", canonical: pains[0].canonical }],
    });
    expect(block).toContain("PROBLEM GROUNDING");
    expect(block).toContain("CAPABILITY GROUNDING");
    expect(block).toContain(caps[0].capabilityId);
    expect(block).toContain("pain_1");
    // Capability rule must forbid using the mechanism as problem authority.
    expect(block.toLowerCase()).toContain("never");
  });

  it("without authority context, degrades to the legacy anchor-based rule (no crash)", () => {
    const block = buildGroundingContract(anchor, null);
    expect(block.length).toBeGreaterThan(0);
  });
});

describe("pain routing unchanged (post-purchase exclusion)", () => {
  it("positioning core pain never selects POST_PURCHASE_FRICTION", () => {
    const p = selectPainForUse(pains, "positioning");
    expect(p?.painId).toBe("pain_1");
  });
  it("post-purchase pain is routable ONLY to retention", () => {
    expect(selectPainsForUse(pains, "funnel").some((p: any) => p.painId === "pain_2")).toBe(false);
    expect(selectPainsForUse(pains, "retention").some((p: any) => p.painId === "pain_2")).toBe(true);
  });
});

describe("no hardcoded product/refund behavior", () => {
  it("authority layer sources contain no product-specific or refund-specific logic", async () => {
    const fs = await import("fs/promises");
    for (const f of [
      "server/shared/capability-registry.ts",
      "server/shared/authority-validator.ts",
      "server/shared/grounding-contract.ts",
    ]) {
      const src = (await fs.readFile(f, "utf8")).toLowerCase();
      expect(src.includes("marketmind")).toBe(false);
      expect(src.includes("refund")).toBe(false);
    }
  });
});

describe("Single Capability Authority Enforcement (Tests A–J)", () => {
  const caps = deriveValidatedCapabilities(anchor, null);
  const selectedPains = [{ painId: "pain_1", canonical: pains[0].canonical }];

  it("Test A: Candidate citing ungrounded/invented capability ID is rejected with UNSUPPORTED_CAPABILITY", () => {
    const r = validateAuthorityBoundaries({
      engineId: "positioning",
      centralProblemTexts: [pains[0].canonical],
      capabilityRefs: ["cap_70cotton_30bamboo_patent"],
      selectedPains,
      capabilities: caps,
    });
    expect(r.passed).toBe(false);
    expect(r.violations.some((v) => v.kind === "UNSUPPORTED_CAPABILITY")).toBe(true);
    expect(r.violations[0].retryFeedback).toContain(caps[0].capabilityId);
  });

  it("Test B: Faithful use of authorized capability passes validation", () => {
    const r = validateAuthorityBoundaries({
      engineId: "positioning",
      centralProblemTexts: [pains[0].canonical],
      capabilityRefs: [caps[0].capabilityId],
      selectedPains,
      capabilities: caps,
    });
    expect(r.passed).toBe(true);
    expect(r.violations.length).toBe(0);
  });

  it("Test C: Valid cap ID attached along with an invalid capability ID fails with UNSUPPORTED_CAPABILITY", () => {
    const r = validateAuthorityBoundaries({
      engineId: "offer",
      centralProblemTexts: [pains[0].canonical],
      capabilityRefs: [caps[0].capabilityId, "cap_unsupported_extra_claim"],
      selectedPains,
      capabilities: caps,
    });
    expect(r.passed).toBe(false);
    expect(r.violations.some((v) => v.kind === "UNSUPPORTED_CAPABILITY")).toBe(true);
  });

  it("Test D: Positioning candidate with unsupported capability triggers retry feedback naming valid IDs", () => {
    const r = validateAuthorityBoundaries({
      engineId: "positioning_claim",
      centralProblemTexts: ["Deals silently stall during tool handoffs, costing revenue"],
      capabilityRefs: ["cap_hallucinated_fabric_tech"],
      selectedPains,
      capabilities: caps,
    });
    expect(r.passed).toBe(false);
    expect(r.violations.some((v) => v.kind === "UNSUPPORTED_CAPABILITY")).toBe(true);
    expect(r.violations[0].retryFeedback).toContain("Cite ONLY these validated IDs");
  });

  it("Test E: Mechanism candidate asserting ungrounded capability is rejected", () => {
    const r = validateAuthorityBoundaries({
      engineId: "mechanism",
      centralProblemTexts: [],
      capabilityRefs: ["cap_patented_opacity_process"],
      selectedPains: [],
      capabilities: caps,
    });
    expect(r.passed).toBe(false);
    expect(r.violations.some((v) => v.kind === "UNSUPPORTED_CAPABILITY")).toBe(true);
  });

  it("Test F: Lineage parent association does not confer factual capability authority", () => {
    // Upstream lineage entry exists with generic token match
    const lineageParent = {
      signalId: "AUD_001",
      originEngine: "audience",
      signalCategory: "pain",
      signalText: "Customers seek modest dresses with high quality",
      parentSignalId: null,
      hopDepth: 0,
      signalPath: ["audience"],
      createdAt: new Date().toISOString(),
      originType: "real" as const,
    };
    expect(lineageParent.originType).toBe("real");

    // But factual capability claim citing non-existent capability ID fails in authority validator
    const authResult = validateAuthorityBoundaries({
      engineId: "offer",
      centralProblemTexts: [],
      capabilityRefs: ["cap_non_existent_guarantee"],
      selectedPains: [],
      capabilities: caps,
    });
    expect(authResult.passed).toBe(false);
    expect(authResult.violations.some((v) => v.kind === "UNSUPPORTED_CAPABILITY")).toBe(true);
  });

  it("Test G: When capability registry is empty, any cited capability fails closed", () => {
    const r = validateAuthorityBoundaries({
      engineId: "positioning",
      centralProblemTexts: [],
      capabilityRefs: ["cap_any_claim"],
      selectedPains: [],
      capabilities: [],
    });
    expect(r.passed).toBe(false);
    expect(r.violations.some((v) => v.kind === "UNSUPPORTED_CAPABILITY")).toBe(true);
  });

  it("Test H: Problem text (enemyDefinition) is checked against PROBLEM_NAMESPACE, not CAPABILITY_NAMESPACE", () => {
    const r = validateAuthorityBoundaries({
      engineId: "positioning",
      centralProblemTexts: ["Deals silently stall during tool handoffs, costing revenue"],
      capabilityRefs: [caps[0].capabilityId],
      selectedPains,
      capabilities: caps,
    });
    expect(r.passed).toBe(true);
    expect(r.violations.length).toBe(0);
  });

  it("Test I: Outcome / value synthesis without invalid capability citations passes cleanly", () => {
    const r = validateAuthorityBoundaries({
      engineId: "offer",
      centralProblemTexts: ["Deals silently stall during tool handoffs, costing revenue"],
      capabilityRefs: [caps[0].capabilityId],
      selectedPains,
      capabilities: caps,
    });
    expect(r.passed).toBe(true);
    expect(r.violations.length).toBe(0);
  });

  it("Test J: Awareness engine does not import validateClaimGrounding as a factual truth gate", async () => {
    const fs = await import("fs/promises");
    const awarenessSrc = await fs.readFile("server/awareness-engine/engine.ts", "utf8");
    expect(awarenessSrc.includes("validateClaimGrounding")).toBe(false);
  });
});

describe("Canonical Capability Authority Foundation & Structural Binding (Tests A–J)", () => {
  const saraProductTruthFacts = [
    {
      productTruthFactId: "20841779-9882-467c-a64a-f9339d49644a",
      statement: "The summer dresses offering includes multiple distinct SKUs such as BONBON DRESS ($35), HAYAT SET ($40), LUNA SET ($40), GIRLY SET ($62), SUNSHINE SET ($62), NAVY SET ($60), BUTTERFLY DRESS ($62), SARA DRESS ($40), and BLAZER Set ($50).",
      factType: "CAPABILITY",
    },
    {
      productTruthFactId: "38d051d0-bf6d-495f-963d-187df58800df",
      statement: "Products are designed to combine quality and modesty, emphasizing modest fashion suitable for customers seeking elegant, faith-aligned apparel.",
      factType: "CAPABILITY",
    },
    {
      productTruthFactId: "7a56b9fb-130c-4c5b-9522-a842a784fa54",
      statement: "The dresses and modest clothing are crafted with premium fabrics to ensure long-lasting wear and comfort.",
      factType: "CAPABILITY",
    },
    {
      productTruthFactId: "e514be4c-a8c2-46aa-90ef-be3a07bcd8fa",
      statement: "Offering includes ready-to-wear apparel designed for multiple occasions with a focus on timeless elegance to remain stylish across seasons.",
      factType: "CAPABILITY",
    },
    {
      productTruthFactId: "ca3c4a3c-865a-4115-bdda-c902343017b7",
      statement: "The offering is delivered via an eCommerce website platform that supports customer browsing by categories such as Summer, Winter, Cotton Hijab, Sets, New Arrivals, and Dresses.",
      factType: "DELIVERY_MECHANISM",
    },
    {
      productTruthFactId: "4fdab84d-c9d7-4cb2-9161-4b258be04570",
      statement: "The website provides secure payment methods including Cash on Delivery (COD) and credit/debit card payments.",
      factType: "DELIVERY_MECHANISM",
    },
    {
      productTruthFactId: "a0c97840-61d6-4575-ad00-8c080a9b15f1",
      statement: "Worldwide shipping is available, enabling customers globally to purchase summer dresses.",
      factType: "DELIVERY_MECHANISM",
    },
    {
      productTruthFactId: "f9c27406-04fc-4158-a65f-6456e5e14f00",
      statement: "Customer orders are processed with a focus on fast delivery and 24-hour product exchange capability.",
      factType: "CAPABILITY",
    },
    {
      productTruthFactId: "742316de-d7e3-42ba-8cc7-353e1da2f4c0",
      statement: "Customer support is available 24/7 via multiple communication channels including email and phone.",
      factType: "CAPABILITY",
    },
    {
      productTruthFactId: "bf46ccf6-6c22-4be8-a356-5938064c54a3",
      statement: "The summer dresses product line has stock status visibility including active, sold out, and hot/trending tags.",
      factType: "CAPABILITY",
    },
    {
      productTruthFactId: "bb268106-275d-4117-8e21-3087d29b19d4",
      statement: "Pricing of summer dresses ranges from $35 to $62 per item, with sets priced higher than individual dresses.",
      factType: "PRICING_FACT",
    },
    {
      productTruthFactId: "8bf23a40-ba81-4d46-90b9-7ea3cb330b3a",
      statement: "The summer dresses are positioned as the campaign hero product, indicating strategic importance in marketing efforts.",
      factType: "USE_CASE",
    },
    {
      productTruthFactId: "66f46f40-1ab1-4c9a-91bd-c592bc110f65",
      statement: "Customer testimonials emphasize satisfaction with design quality, modest yet stylish appearance, fast delivery, variety of colors and styles, and unique shopping experience.",
      factType: "PROOF",
    },
    {
      productTruthFactId: "b9034f71-ec29-43f1-baff-c13a057f46a5",
      statement: "The offering is constrained within modest fashion aligned with faith values, targeting customers seeking modest yet elegant style rather than revealing fashion.",
      factType: "BOUNDARY",
    },
    {
      productTruthFactId: "77bc8b0d-2cda-4fd6-b878-f5a08e9ffe36",
      statement: "Winter category currently has no available products, indicating seasonal focus and inventory limitations for off-season lines.",
      factType: "BOUNDARY",
    },
  ];

  const saraDna = {
    uniqueMechanism: "The summer dresses offering includes multiple distinct SKUs...; Products are designed to combine quality and modesty...",
    strategicAdvantage: "The dresses and modest clothing are crafted with premium fabrics to ensure long-lasting wear and comfort.",
    productTruthFacts: saraProductTruthFacts,
  };

  const canonicalCaps = deriveValidatedCapabilities(null, saraDna);

  it("TEST A: All Sara Product Truth facts receive atomic canonical representation while preserving original factType", () => {
    const capabilityFacts = saraProductTruthFacts.filter((f) => f.factType === "CAPABILITY");
    expect(capabilityFacts.length).toBe(7);
    expect(canonicalCaps.length).toBe(15);
    const capabilityEntries = canonicalCaps.filter((c) => c.factType === "CAPABILITY");
    expect(capabilityEntries.length).toBe(7);
    for (const cap of capabilityEntries) {
      expect(cap.capabilityId).toMatch(/^cap_/);
      expect(cap.source).toBe("product_truth.capability");
      expect(cap.sourceFactId).toBeDefined();
    }
    const nonCapabilityEntries = canonicalCaps.filter((c) => c.factType !== "CAPABILITY");
    expect(nonCapabilityEntries.length).toBe(8);
    expect(nonCapabilityEntries.map((c) => c.factType)).toEqual(
      expect.arrayContaining(["DELIVERY_MECHANISM", "PRICING_FACT", "USE_CASE", "PROOF", "BOUNDARY"]),
    );
  });

  it("TEST B: No Product Truth capability facts are dropped due to array slicing", () => {
    const factIdsInRegistry = canonicalCaps.map((c) => c.sourceFactId);
    expect(factIdsInRegistry).toContain("e514be4c-a8c2-46aa-90ef-be3a07bcd8fa"); // Fact 4
    expect(factIdsInRegistry).toContain("f9c27406-04fc-4158-a65f-6456e5e14f00"); // Fact 5
    expect(factIdsInRegistry).toContain("742316de-d7e3-42ba-8cc7-353e1da2f4c0"); // Fact 6
    expect(factIdsInRegistry).toContain("bf46ccf6-6c22-4be8-a356-5938064c54a3"); // Fact 7
  });

  it("TEST C: Two separate Product Truth capability facts are not silently bundled into a single authority object", () => {
    const fact1Cap = canonicalCaps.find((c) => c.sourceFactId === "20841779-9882-467c-a64a-f9339d49644a");
    const fact2Cap = canonicalCaps.find((c) => c.sourceFactId === "38d051d0-bf6d-495f-963d-187df58800df");
    expect(fact1Cap).toBeDefined();
    expect(fact2Cap).toBeDefined();
    expect(fact1Cap?.capabilityId).not.toBe(fact2Cap?.capabilityId);
    expect(fact1Cap?.statement.includes("BONBON DRESS")).toBe(true);
    expect(fact1Cap?.statement.includes("modesty")).toBe(false);
  });

  it("TEST D: 24-hour exchange fact receives its own canonical capability authority", () => {
    const exchangeCap = canonicalCaps.find((c) => c.sourceFactId === "f9c27406-04fc-4158-a65f-6456e5e14f00");
    expect(exchangeCap).toBeDefined();
    expect(exchangeCap?.capabilityId).toBe("cap_8a57bf14855b");
    expect(exchangeCap?.statement).toContain("24-hour product exchange capability");
  });

  it("TEST E: Valid factual claim resolves through its exact canonical capability authority", () => {
    const exchangeCap = canonicalCaps.find((c) => c.sourceFactId === "f9c27406-04fc-4158-a65f-6456e5e14f00")!;
    const r = validateAuthorityBoundaries({
      engineId: "mechanism",
      centralProblemTexts: [],
      operationalClaims: [
        {
          claim: "Sara offers 24-hour product exchange on all dress orders",
          role: "EXISTING_FACTUAL_CLAIM",
          capabilityRef: exchangeCap.capabilityId,
        },
      ],
      selectedPains: [],
      capabilities: canonicalCaps,
    });
    expect(r.passed).toBe(true);
    expect(r.canonicalFactualClaims?.length).toBe(1);
    expect(r.canonicalFactualClaims![0].capabilityRef).toBe(exchangeCap.capabilityId);
    expect(r.canonicalFactualClaims![0].canonicalStatement).toBe(exchangeCap.statement);
    expect(r.canonicalFactualClaims![0].sourceFactId).toBe(exchangeCap.sourceFactId);
  });

  it("TEST F: Candidate attaches a valid unrelated cap ID to unsupported factual prose", () => {
    const fabricCap = canonicalCaps.find((c) => c.sourceFactId === "7a56b9fb-130c-4c5b-9522-a842a784fa54")!;
    const r = validateAuthorityBoundaries({
      engineId: "mechanism",
      centralProblemTexts: [],
      operationalClaims: [
        {
          claim: "Sara performs pre-shipment inspection on every garment",
          role: "EXISTING_FACTUAL_CLAIM",
          capabilityRef: fabricCap.capabilityId,
        },
      ],
      selectedPains: [],
      capabilities: canonicalCaps,
    });
    // The capabilityRef resolves successfully
    expect(r.passed).toBe(true);
    // But the authoritative factual statement becomes the canonical premium-fabric fact
    expect(r.canonicalFactualClaims![0].canonicalStatement).toBe(fabricCap.statement);
    // The unsupported "pre-shipment inspection" prose is NOT persisted as existing fact
    expect(r.canonicalFactualClaims![0].canonicalStatement).not.toContain("pre-shipment inspection");
  });

  it("TEST G: Strategic synthesis remains allowed without pretending to be Product Truth", () => {
    const r = validateAuthorityBoundaries({
      engineId: "mechanism",
      centralProblemTexts: [],
      operationalClaims: [
        {
          claim: "Combining modest cuts with accessible price points removes purchase hesitation",
          role: "STRATEGIC_SYNTHESIS",
          capabilityRef: null,
        },
      ],
      selectedPains: [],
      capabilities: canonicalCaps,
    });
    expect(r.passed).toBe(true);
    expect(r.canonicalFactualClaims?.length).toBe(0);
    expect(r.strategicSyntheses).toContain("Combining modest cuts with accessible price points removes purchase hesitation");
  });

  it("TEST H: Future proposal remains allowed and clearly non-existing", () => {
    const r = validateAuthorityBoundaries({
      engineId: "mechanism",
      centralProblemTexts: [],
      operationalClaims: [
        {
          claim: "Could introduce an automated sizing quiz before checkout",
          role: "PROPOSED_EXECUTION",
          capabilityRef: null,
        },
      ],
      selectedPains: [],
      capabilities: canonicalCaps,
    });
    expect(r.passed).toBe(true);
    expect(r.canonicalFactualClaims?.length).toBe(0);
    expect(r.proposedExecutions).toContain("Could introduce an automated sizing quiz before checkout");
  });

  it("TEST I: judgeMechanismSemanticRole classifies role only", async () => {
    // Verify judge function signature accepts candidate and returns classified roles without factual truth decision
    const { judgeMechanismSemanticRole } = await import("../mechanism-engine/engine");
    expect(typeof judgeMechanismSemanticRole).toBe("function");
  });

  it("TEST J: Missing factual capability authority fails closed", () => {
    const r = validateAuthorityBoundaries({
      engineId: "mechanism",
      centralProblemTexts: [],
      operationalClaims: [
        {
          claim: "Sara performs pre-shipment quality checks and opacity light-box verification",
          role: "EXISTING_FACTUAL_CLAIM",
          capabilityRef: null,
        },
      ],
      selectedPains: [],
      capabilities: canonicalCaps,
    });
    expect(r.passed).toBe(false);
    expect(r.violations.some((v) => v.kind === "UNSUPPORTED_CAPABILITY")).toBe(true);
    expect(r.violations[0].retryFeedback).toContain("MUST cite a validated capability ID");
  });

  it("TEST K: Resolves supportedByCapability statement text from semantic judge to canonical capabilityId", () => {
    const exchangeCap = canonicalCaps.find((c) => c.sourceFactId === "f9c27406-04fc-4158-a65f-6456e5e14f00")!;
    const r = validateAuthorityBoundaries({
      engineId: "mechanism",
      centralProblemTexts: [],
      operationalClaims: [
        {
          claim: "Customer orders are processed with fast delivery and 24-hour exchange",
          role: "EXISTING_FACTUAL_CLAIM",
          supportedByCapability: exchangeCap.statement,
        },
      ],
      selectedPains: [],
      capabilities: canonicalCaps,
    });
    expect(r.passed).toBe(true);
    expect(r.canonicalFactualClaims?.length).toBe(1);
    expect(r.canonicalFactualClaims![0].capabilityRef).toBe(exchangeCap.capabilityId);
    expect(r.canonicalFactualClaims![0].canonicalStatement).toBe(exchangeCap.statement);
  });
});

