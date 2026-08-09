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
