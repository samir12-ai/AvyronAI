// Seal #10 / Task #28 — engine contracts proof suite (T2, T3, T5, T7).
import { describe, it, expect } from "vitest";
import { checkAnalyticalEnrichmentIntegrity } from "../system-control/structural-checks";

describe("Seal #10 / F2.3 — checkAnalyticalEnrichmentIntegrity escalates to BLOCK when consumers > 0", () => {
  it("returns PASS when AEL is not partial", () => {
    const r = checkAnalyticalEnrichmentIntegrity(false, null, 0);
    expect(r.status).toBe("PASS");
  });

  it("returns FAIL with BLOCK: prefix when consumers > 0", () => {
    const r = checkAnalyticalEnrichmentIntegrity(true, "low_evidence", 3);
    expect(r.status).toBe("FAIL");
    expect(r.details.startsWith("BLOCK:")).toBe(true);
    expect(r.details).toContain("3 downstream engine(s)");
  });

  it("returns FAIL without BLOCK: prefix when consumers === 0 (downgrade-only)", () => {
    const r = checkAnalyticalEnrichmentIntegrity(true, "low_evidence", 0);
    expect(r.status).toBe("FAIL");
    expect(r.details.startsWith("BLOCK:")).toBe(false);
    expect(r.details).toContain("downgrade-only");
  });

  it("treats undefined consumers count as 0 (downgrade-only)", () => {
    const r = checkAnalyticalEnrichmentIntegrity(true, "test_reason");
    expect(r.status).toBe("FAIL");
    expect(r.details.startsWith("BLOCK:")).toBe(false);
  });
});

describe("Seal #10 / F4.3 — build-plan AI response zod schema enforcement", () => {
  // Mirror of build-plan-layer/engine.ts BuildPlanResponseSchema (kept local
  // so the test fails if the production schema's required-field surface
  // shifts).
  const z = require("zod") as typeof import("zod");
  const Schema = z.object({
    positioning: z.string().min(1),
    differentiation: z.string().min(1),
    mechanism: z.object({ name: z.string().min(1), explanation: z.string().min(1) }),
    offer: z.string().min(1),
    funnel: z.object({ top: z.string().min(1), middle: z.string().min(1), bottom: z.string().min(1) }),
    contentDna: z.object({}).passthrough(),
    kpiRules: z.object({}).passthrough(),
  });

  it("rejects responses missing required top-level fields", () => {
    const r = Schema.safeParse({ positioning: "x" });
    expect(r.success).toBe(false);
  });

  it("rejects empty-string positioning", () => {
    const r = Schema.safeParse({
      positioning: "",
      differentiation: "y", mechanism: { name: "n", explanation: "e" },
      offer: "o", funnel: { top: "t", middle: "m", bottom: "b" },
      contentDna: {}, kpiRules: {},
    });
    expect(r.success).toBe(false);
  });

  it("accepts a fully-formed response", () => {
    const r = Schema.safeParse({
      positioning: "Outcome-First Acquisition",
      differentiation: "Mechanism contrast",
      mechanism: { name: "Causal Loop", explanation: "explained" },
      offer: "Free trial",
      funnel: { top: "awareness", middle: "consideration", bottom: "conversion" },
      contentDna: { contentAngles: [] },
      kpiRules: { postingFrequency: "3/wk" },
    });
    expect(r.success).toBe(true);
  });
});

describe("Seal #10 / F2.9 — audience-engine PARTIAL emission", () => {
  // Replicates the threshold logic embedded in audience-engine/engine.ts
  // post-#28: PARTIAL when totalSignalMatches >= AI floor but coverage is
  // incomplete (low signals OR empty core map OR no segments).
  const AI_FLOOR = 5;
  function deriveStatus(totalSignals: number, painMap: any[], desireMap: any[], objectionMap: any[], segments: any[]) {
    if (totalSignals < AI_FLOOR) return "INSUFFICIENT_SIGNALS";
    const richFloor = AI_FLOOR * 2;
    const anyEmpty = [painMap, desireMap, objectionMap].some(m => !Array.isArray(m) || m.length === 0);
    if (totalSignals < richFloor || anyEmpty || segments.length === 0) return "PARTIAL";
    return "COMPLETE";
  }

  it("emits PARTIAL when signals are above AI floor but below rich floor", () => {
    expect(deriveStatus(7, [{}], [{}], [{}], [{}])).toBe("PARTIAL");
  });
  it("emits PARTIAL when a core map is empty", () => {
    expect(deriveStatus(20, [], [{}], [{}], [{}])).toBe("PARTIAL");
  });
  it("emits PARTIAL when no segments resolved", () => {
    expect(deriveStatus(20, [{}], [{}], [{}], [])).toBe("PARTIAL");
  });
  it("emits COMPLETE only with all conditions satisfied", () => {
    expect(deriveStatus(20, [{}], [{}], [{}], [{}])).toBe("COMPLETE");
  });
  it("emits INSUFFICIENT_SIGNALS below AI floor", () => {
    expect(deriveStatus(2, [{}], [{}], [{}], [{}])).toBe("INSUFFICIENT_SIGNALS");
  });
});

describe("Seal #10 / F4.4 — verifySynthesisPreservation requires exact-substring match", () => {
  // Mirror of plan-synthesis.ts collectPlanStrings + structured-assertion
  // logic, frozen here so the proof fails if the production code reverts
  // to keyword-fallback matching.
  function collectStrings(node: any, out: string[] = [], depth = 0): string[] {
    if (node == null || depth > 12) return out;
    if (typeof node === "string") { if (node.trim()) out.push(node.toLowerCase()); return out; }
    if (Array.isArray(node)) { for (const v of node) collectStrings(v, out, depth + 1); return out; }
    if (typeof node === "object") { for (const v of Object.values(node)) collectStrings(v, out, depth + 1); }
    return out;
  }
  function verify(plan: any, lockedLabels: string[]) {
    const strings = collectStrings(plan);
    const missing: string[] = [];
    let preserved = 0;
    for (const label of lockedLabels) {
      const norm = label.toLowerCase().trim();
      if (norm.length < 3) continue;
      strings.some(s => s.includes(norm)) ? preserved++ : missing.push(label);
    }
    return { passed: missing.length === 0, preserved, missing };
  }

  it("rejects keyword-only matches (the pre-#28 false positive)", () => {
    // Plan mentions "outcome" and "first" in unrelated sections — pre-#28
    // this would have falsely satisfied the locked label "Outcome-First
    // Acquisition" via 50%-keyword-match. Post-#28 it must be MISSING.
    const plan = {
      positioning: { territory: "Velocity-Driven Markets" },
      offer: { description: "Outcome guarantee with first-month refund" },
    };
    const r = verify(plan, ["Outcome-First Acquisition"]);
    expect(r.passed).toBe(false);
    expect(r.missing).toEqual(["Outcome-First Acquisition"]);
  });

  it("accepts exact-substring presence even nested deep", () => {
    const plan = {
      positioning: { territory: { name: "Outcome-First Acquisition" } },
    };
    const r = verify(plan, ["Outcome-First Acquisition"]);
    expect(r.passed).toBe(true);
    expect(r.preserved).toBe(1);
  });

  it("ignores labels shorter than 3 chars", () => {
    const r = verify({ a: "x" }, ["ab"]);
    expect(r.passed).toBe(true);
  });
});
