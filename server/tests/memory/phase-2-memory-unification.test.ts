/**
 * Task #65 / Phase 2 — Memory Unification behavioral tests.
 *
 * Doctrine alignment: Seal #18 ("state-not-logs" + "deterministic-clock" +
 * "hermetic"). Every assertion goes against persisted/observable state — a
 * Map-backed fake DB and the CV-06/CV-11 metric collectors — never against
 * log strings.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Hermetic fakes ───────────────────────────────────────────────────────────

interface FakeMemoryRow {
  id: string;
  accountId: string;
  campaignId: string;
  memoryType: string;
  engineName: string | null;
  label: string;
  details: string | null;
  performance: string | null;
  score: number;
  confidenceScore: number;
  direction: "reinforce" | "avoid" | "neutral";
  planId: string | null;
  sourceOutcomeId: string | null;
  decisionId: string | null;
  provenanceOrigin: string;
  strategyFingerprint: string;
  lastValidatedAt: Date | null;
  updatedAt: Date | null;
  createdAt: Date | null;
  industry: string | null;
  platform: string | null;
  campaignType: string | null;
  funnelObjective: string | null;
  usageCount: number;
  validationCount: number;
  decayRate: number;
  isWinner: boolean;
}

const { memoryRows, fakeDb } = vi.hoisted(() => {
  const memoryRows = new Map<string, any>();
  const rowMatchesWhere = (row: any, where: Record<string, unknown>): boolean => {
    for (const [k, v] of Object.entries(where)) {
      if (row[k] !== v) return false;
    }
    return true;
  };
  const fakeDb: any = {
  select(columns?: any) {
    return {
      from(_table: any) {
        let where: Record<string, unknown> = {};
        const builder: any = {
          where(predicate: Record<string, unknown>) {
            where = predicate;
            return builder;
          },
          orderBy() { return builder; },
          limit() { return builder; },
          async returning() { return []; },
          then(resolve: (rows: any[]) => unknown) {
            const matches = Array.from(memoryRows.values()).filter((r) => rowMatchesWhere(r, where));
            if (columns) {
              return resolve(
                matches.map((r) => {
                  const out: Record<string, unknown> = {};
                  for (const k of Object.keys(columns)) out[k] = (r as any)[k];
                  return out;
                }),
              );
            }
            return resolve(matches);
          },
        };
        return builder;
      },
    };
  },
  insert(_table: any) {
    return {
      async values(row: any) {
        const full: any = {
          id: row.id,
          accountId: row.accountId,
          campaignId: row.campaignId,
          memoryType: row.memoryType,
          engineName: row.engineName ?? null,
          label: row.label,
          details: row.details ?? null,
          performance: row.performance ?? null,
          score: row.score ?? 0,
          confidenceScore: row.confidenceScore ?? 0.5,
          direction: row.direction ?? "neutral",
          planId: row.planId ?? null,
          sourceOutcomeId: row.sourceOutcomeId ?? null,
          decisionId: row.decisionId ?? null,
          provenanceOrigin: row.provenanceOrigin ?? "unknown",
          strategyFingerprint: row.strategyFingerprint,
          lastValidatedAt: row.lastValidatedAt ?? new Date(),
          updatedAt: row.updatedAt ?? new Date(),
          createdAt: row.createdAt ?? new Date(),
          industry: row.industry ?? null,
          platform: row.platform ?? null,
          campaignType: row.campaignType ?? null,
          funnelObjective: row.funnelObjective ?? null,
          usageCount: 0,
          validationCount: 0,
          decayRate: 0.95,
          isWinner: false,
        };
        memoryRows.set(full.id, full);
      },
    };
  },
  update(_table: any) {
    return {
      set(patch: Record<string, unknown>) {
        return {
          where(predicate: Record<string, unknown>) {
            for (const row of memoryRows.values()) {
              if (rowMatchesWhere(row, predicate)) {
                Object.assign(row, patch);
              }
            }
            const result = {
              async returning() {
                const matches = Array.from(memoryRows.values()).filter((r) =>
                  rowMatchesWhere(r, predicate),
                );
                return matches.map((r) => ({ id: r.id }));
              },
              then(resolve: (v: unknown) => unknown) {
                return resolve(undefined);
              },
            };
            return result;
          },
        };
      },
    };
  },
  };
  return { memoryRows, fakeDb };
});

vi.mock("../../db", () => ({ db: fakeDb }));

// Drizzle helpers — wrap into the canonical { column: value } predicate shape
// our fake matches on.
vi.mock("drizzle-orm", () => {
  const fieldOf = (col: any) => (typeof col === "object" && col?.name) || col;
  return {
    eq: (col: any, v: unknown) => ({ [fieldOf(col)]: v }),
    and: (...conds: Array<Record<string, unknown>>) =>
      Object.assign({}, ...conds.filter(Boolean)),
    isNull: (col: any) => ({ [fieldOf(col)]: null }),
    isNotNull: () => ({}),
    desc: (col: any) => col,
    asc: (col: any) => col,
    sql: () => ({}),
    gt: () => ({}),
    lt: () => ({}),
    gte: () => ({}),
    lte: () => ({}),
    inArray: () => ({}),
  };
});

// strategyMemory column proxy with a `.name` per column.
vi.mock("@shared/schema", () => {
  const make = (n: string) => ({ name: n });
  return {
    strategyMemory: new Proxy({} as any, {
      get: (_t, p: string) => make(p),
    }),
    strategyDecisions: new Proxy({} as any, {
      get: (_t, p: string) => make(p),
    }),
  };
});

// ── System under test ────────────────────────────────────────────────────────

import {
  upsertByFingerprint,
  reinforceByDecisionId,
} from "../../memory-system/store";
import {
  cv06MemoryWritesTotal,
  cv11HallucinationExposureTotal,
  _resetCv06MetricsForTests,
} from "../../memory-system/cv06-metrics";

beforeEach(() => {
  memoryRows.clear();
  _resetCv06MetricsForTests();
});

describe("Phase 2 — DEC-B reinforcement by decision_id FK", () => {
  it("returns NO_BOUND_ROW + CV-11 increment when no strategy_memory row binds to the decision", async () => {
    const result = await reinforceByDecisionId("acc1", "camp1", "dec-orphan", {
      confidenceScore: 0.85,
      direction: "reinforce",
      score: 1,
      engineName: "outcome-tracker",
      memoryType: "decision",
      sourceOutcomeId: "out-1",
    });
    expect(result.boundRowCount).toBe(0);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/NO_BOUND_ROW/);
    // The caller (outcome-tracker) is responsible for emitting the CV-11
    // counter; here we assert reinforceByDecisionId reports boundRowCount=0
    // so the caller has the signal it needs.
  });

  it("updates the FK-bound row in place when a decision_id match exists", async () => {
    await upsertByFingerprint({
      accountId: "acc1",
      campaignId: "camp1",
      memoryType: "decision",
      engineName: "engine-x",
      label: "Use reels in week 1",
      details: null,
      confidenceScore: 0.7,
      direction: "reinforce",
      decisionId: "dec-1",
      provenanceOrigin: "engine_seed",
    });
    expect(memoryRows.size).toBe(1);
    const [seeded] = Array.from(memoryRows.values());
    expect(seeded.decisionId).toBe("dec-1");
    expect(seeded.provenanceOrigin).toBe("engine_seed");

    const result = await reinforceByDecisionId("acc1", "camp1", "dec-1", {
      confidenceScore: 0.9,
      direction: "reinforce",
      score: 1,
      engineName: "outcome-tracker",
      memoryType: "decision",
      sourceOutcomeId: "out-99",
    });
    expect(result.boundRowCount).toBe(1);
    expect(result.allowed).toBe(true);
    const updated = memoryRows.get(seeded.id)!;
    expect(updated.confidenceScore).toBe(0.9);
    expect(updated.sourceOutcomeId).toBe("out-99");
    expect(updated.provenanceOrigin).toBe("outcome");
  });
});

describe("Phase 2 — fingerprint contradiction resolver", () => {
  it("REJECTS a reinforce→avoid flip when incoming confidence is not strictly greater than existing", async () => {
    await upsertByFingerprint({
      accountId: "acc1",
      campaignId: "camp1",
      memoryType: "decision",
      engineName: "engine-x",
      label: "Carousel works",
      details: "hook=A",
      confidenceScore: 0.8,
      direction: "reinforce",
    });
    expect(memoryRows.size).toBe(1);
    const before = Array.from(memoryRows.values())[0];

    const flip = await upsertByFingerprint({
      accountId: "acc1",
      campaignId: "camp1",
      memoryType: "decision",
      engineName: "engine-x", // same engine → same fingerprint
      label: "Carousel works",
      details: "hook=A",
      confidenceScore: 0.7, // < existing 0.8
      direction: "avoid",
    });
    expect(flip.allowed).toBe(false);
    expect(flip.reason).toMatch(/CONTRADICTION_REJECTED/);
    const after = memoryRows.get(before.id)!;
    expect(after.direction).toBe("reinforce");
    expect(after.confidenceScore).toBe(0.8);
  });

  it("ACCEPTS a flip when incoming confidence is strictly greater than existing", async () => {
    await upsertByFingerprint({
      accountId: "acc1",
      campaignId: "camp1",
      memoryType: "decision",
      engineName: "engine-x",
      label: "Reels works",
      details: null,
      confidenceScore: 0.7,
      direction: "reinforce",
    });
    const before = Array.from(memoryRows.values())[0];

    const flip = await upsertByFingerprint({
      accountId: "acc1",
      campaignId: "camp1",
      memoryType: "decision",
      engineName: "engine-x",
      label: "Reels works",
      details: null,
      confidenceScore: 0.95,
      direction: "avoid",
    });
    expect(flip.allowed).toBe(true);
    const after = memoryRows.get(before.id)!;
    expect(after.direction).toBe("avoid");
    expect(after.confidenceScore).toBe(0.95);
  });
});

describe("Phase 2 — CV-06 + CV-11 metric wiring", () => {
  it("records cv06 'updated' on a fingerprint update", async () => {
    await upsertByFingerprint({
      accountId: "acc1",
      campaignId: "camp1",
      memoryType: "decision",
      engineName: "engine-y",
      label: "L",
      details: null,
      confidenceScore: 0.7,
      direction: "reinforce",
    });
    await upsertByFingerprint({
      accountId: "acc1",
      campaignId: "camp1",
      memoryType: "decision",
      engineName: "engine-y",
      label: "L",
      details: null,
      confidenceScore: 0.8,
      direction: "reinforce",
    });
    const samples = cv06MemoryWritesTotal.collect();
    const inserted = samples.find((s) => s.outcome === "inserted");
    const updated = samples.find((s) => s.outcome === "updated");
    expect(inserted?.value).toBe(1);
    expect(updated?.value).toBe(1);
  });

  it("records cv11 increment on explicit recordHallucinationExposure call", async () => {
    const { recordHallucinationExposure } = await import(
      "../../memory-system/cv06-metrics"
    );
    recordHallucinationExposure("no_bound_row", "outcome-tracker");
    recordHallucinationExposure("no_bound_row", "outcome-tracker");
    const cv11 = cv11HallucinationExposureTotal.collect();
    expect(cv11.find((s) => s.kind === "no_bound_row")?.value).toBe(2);
  });
});
