// Seal #10 / Task #28 — agent pipeline proof suite (T6, T8, T10, T13).
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { isNonStrategicMemoryType, NON_STRATEGIC_MEMORY_TYPES_ARR } from "../decision-policy";

describe("Seal #10 / F2.7 — awareness-engine zod-backed safe coercers", () => {
  // Mirror of awareness-engine NumberSchema + NonEmptyStringSchema. Each
  // production change to those schemas must be reflected here.
  const NumberSchema = z.preprocess(
    (v) => (typeof v === "number" && !Number.isNaN(v) ? v : (v == null || v === "" ? undefined : Number(v))),
    z.number().refine((n) => Number.isFinite(n)),
  );
  const StringSchema = z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z.string().min(1),
  );

  it("number schema accepts numeric strings", () => {
    expect(NumberSchema.safeParse("3.14").success).toBe(true);
    expect((NumberSchema.parse("3.14") as number)).toBeCloseTo(3.14);
  });
  it("number schema rejects NaN, Infinity, undefined", () => {
    expect(NumberSchema.safeParse(NaN).success).toBe(false);
    expect(NumberSchema.safeParse(Infinity).success).toBe(false);
    expect(NumberSchema.safeParse(undefined).success).toBe(false);
  });
  it("string schema rejects empty / whitespace-only", () => {
    expect(StringSchema.safeParse("").success).toBe(false);
    expect(StringSchema.safeParse("   ").success).toBe(false);
  });
  it("string schema trims and accepts content", () => {
    expect(StringSchema.parse("  hello  ")).toBe("hello");
  });
});

describe("Seal #10 / F4.5 — extractMiInput envelope zod validation", () => {
  const Envelope = z.object({
    output: z.unknown().optional(),
    overallConfidence: z.number().nullable().optional(),
    dominanceData: z.array(z.any()).optional(),
    trajectoryData: z.any().nullable().optional(),
  });

  it("rejects an envelope where overallConfidence is a string", () => {
    expect(Envelope.safeParse({ overallConfidence: "0.5" } as any).success).toBe(false);
  });
  it("rejects an envelope where dominanceData is not an array", () => {
    expect(Envelope.safeParse({ dominanceData: { x: 1 } } as any).success).toBe(false);
  });
  it("accepts a minimal envelope with no fields", () => {
    expect(Envelope.safeParse({}).success).toBe(true);
  });
  it("accepts a fully-formed envelope", () => {
    expect(Envelope.safeParse({
      output: { signals: [] },
      overallConfidence: 0.5,
      dominanceData: [],
      trajectoryData: null,
    }).success).toBe(true);
  });
});

describe("Seal #10 / F4.9 — operational vs strategic memory READ filter", () => {
  it("identifies all non-strategic types", () => {
    expect(isNonStrategicMemoryType("content_rhythm")).toBe(true);
    expect(isNonStrategicMemoryType("exploration_budget")).toBe(true);
    expect(isNonStrategicMemoryType("mutation_log")).toBe(true);
    expect(isNonStrategicMemoryType("agent_action")).toBe(true);
    expect(isNonStrategicMemoryType("self_improvement")).toBe(true);
  });

  it("strategic types pass through (treated as strategy signal)", () => {
    expect(isNonStrategicMemoryType("positioning_decision")).toBe(false);
    expect(isNonStrategicMemoryType("offer_decision")).toBe(false);
    expect(isNonStrategicMemoryType("audience_signal")).toBe(false);
    expect(isNonStrategicMemoryType(null)).toBe(false);
    expect(isNonStrategicMemoryType(undefined)).toBe(false);
  });

  it("exclusion array contains all 5 documented operational types", () => {
    expect(NON_STRATEGIC_MEMORY_TYPES_ARR).toContain("content_rhythm");
    expect(NON_STRATEGIC_MEMORY_TYPES_ARR).toContain("exploration_budget");
    expect(NON_STRATEGIC_MEMORY_TYPES_ARR).toContain("mutation_log");
    expect(NON_STRATEGIC_MEMORY_TYPES_ARR).toContain("agent_action");
    expect(NON_STRATEGIC_MEMORY_TYPES_ARR).toContain("self_improvement");
    expect(NON_STRATEGIC_MEMORY_TYPES_ARR.length).toBe(5);
  });
});

describe("Seal #10 / F8.3 — optimistic locking CAS semantics", () => {
  // Pure-function model of the production CAS: simulate two concurrent
  // writers racing on the same plan row. The second writer must observe
  // affected_rows=0 and surface CONCURRENT_MODIFICATION instead of
  // overwriting.
  type Row = { id: string; version: number; data: string };
  function casUpdate(rows: Row[], id: string, expectedVersion: number, newData: string): { affected: number } {
    const idx = rows.findIndex(r => r.id === id && r.version === expectedVersion);
    if (idx === -1) return { affected: 0 };
    rows[idx] = { ...rows[idx], version: rows[idx].version + 1, data: newData };
    return { affected: 1 };
  }

  it("first writer succeeds, second writer (stale version) is rejected", () => {
    const rows: Row[] = [{ id: "p1", version: 1, data: "initial" }];
    const writerA = casUpdate(rows, "p1", 1, "from-A");
    expect(writerA.affected).toBe(1);
    expect(rows[0].version).toBe(2);
    expect(rows[0].data).toBe("from-A");

    // Writer B was holding version=1 when it issued the UPDATE
    const writerB = casUpdate(rows, "p1", 1, "from-B");
    expect(writerB.affected).toBe(0); // CONCURRENT_MODIFICATION
    expect(rows[0].data).toBe("from-A"); // not overwritten
  });

  it("sequential writers each succeed when reading current version", () => {
    const rows: Row[] = [{ id: "p1", version: 1, data: "v1" }];
    expect(casUpdate(rows, "p1", 1, "v2").affected).toBe(1);
    expect(casUpdate(rows, "p1", 2, "v3").affected).toBe(1);
    expect(rows[0].version).toBe(3);
    expect(rows[0].data).toBe("v3");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Pass-5 architect-required binding tests — import + assert against the
// REAL production functions, not local mirror models. Closes the
// "tests mirror local logic" finding.
// ───────────────────────────────────────────────────────────────────────────
import { checkMiGateRejections, checkAnalyticalEnrichmentIntegrity, collectBlockReasons } from "../system-control/structural-checks";
import { countAelDownstreamConsumers } from "../orchestrator/index";

describe("Seal #10 / pass-5 — checkMiGateRejections (production binding)", () => {
  it("PASSes when no MI rejections recorded", () => {
    const r = checkMiGateRejections(undefined, new Map());
    expect(r.status).toBe("PASS");
    expect(r.check).toBe("mi_gate_integrity");
  });

  it("PASSes when rejections exist but no engine ran (recovery resume)", () => {
    const r = checkMiGateRejections(
      [{ engineId: "positioning", reason: "MI_FRESHNESS_STALE", detail: "x" }],
      new Map([["positioning", { status: "SKIPPED" }]]),
    );
    expect(r.status).toBe("PASS");
  });

  it("FAILs with BLOCK: prefix when rejections exist AND engines ran", () => {
    const r = checkMiGateRejections(
      [
        { engineId: "positioning", reason: "MI_FRESHNESS_STALE", detail: "stale snapshot" },
        { engineId: "offer", reason: "MI_LINEAGE_MISMATCH", detail: "cross-run" },
      ],
      new Map([["positioning", { status: "COMPLETED" }]]),
    );
    expect(r.status).toBe("FAIL");
    expect(r.details.startsWith("BLOCK:")).toBe(true);
    expect(r.details).toContain("MI_FRESHNESS_STALE");
  });

  it("collectBlockReasons promotes mi_gate_integrity BLOCK: to MI_GATE_REJECTED", () => {
    const fail = checkMiGateRejections(
      [{ engineId: "positioning", reason: "MI_FRESHNESS_STALE", detail: "x" }],
      new Map([["positioning", { status: "COMPLETED" }]]),
    );
    const blocks = collectBlockReasons([fail], new Map() as any);
    const mi = blocks.find((b) => b.code === "MI_GATE_REJECTED");
    expect(mi).toBeDefined();
    expect(mi?.severity).toBe("critical");
  });
});

describe("Seal #10 / pass-5 — countAelDownstreamConsumers (production binding)", () => {
  it("returns 0 when isPartial=false even with strategy engines in results", () => {
    const results = new Map<string, { status: string }>([
      ["positioning", { status: "COMPLETED" }],
      ["offer", { status: "COMPLETED" }],
    ]);
    expect(countAelDownstreamConsumers(results, false)).toBe(0);
  });

  it("counts non-SKIPPED AEL consumers when isPartial=true", () => {
    const results = new Map<string, { status: string }>([
      ["market_intelligence", { status: "COMPLETED" }],
      ["audience_engine", { status: "COMPLETED" }],
      ["positioning", { status: "COMPLETED" }],
      ["offer", { status: "COMPLETED" }],
      ["funnel", { status: "SKIPPED" }],
      ["build_plan_layer", { status: "COMPLETED" }],
    ]);
    expect(countAelDownstreamConsumers(results, true)).toBe(3);
  });

  it("AEL partial+consumers wires through checkAnalyticalEnrichmentIntegrity to BLOCK:", () => {
    const consumers = countAelDownstreamConsumers(
      new Map([["positioning", { status: "COMPLETED" }]]),
      true,
    );
    expect(consumers).toBe(1);
    const r = checkAnalyticalEnrichmentIntegrity(true, "EMPTY_ANALYTICAL_PACKAGE", consumers);
    expect(r.status).toBe("FAIL");
    expect(r.details.startsWith("BLOCK:")).toBe(true);
    const blocks = collectBlockReasons([r], new Map() as any);
    expect(blocks.find((b) => b.code === "ANALYTICAL_ENRICHMENT_BLOCKED")).toBeDefined();
  });
});
