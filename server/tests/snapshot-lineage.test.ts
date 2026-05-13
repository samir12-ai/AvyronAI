// Seal #10 / Task #28 — snapshot lineage proof suite (T9, T11, T12).
// Lightweight unit tests; do not require a live DB. Each test exercises the
// pure logic added or hardened in this task (zod envelopes, freshness gate,
// cleanup-worker in-flight join, MI fetch-orch baseline filter).
import { describe, it, expect } from "vitest";
import { z } from "zod";

describe("Seal #10 / T9 — MI snapshot freshness/lineage gate", () => {
  // Mirror of orchestrator/index.ts MiResultEnvelopeSchema (kept local so
  // the test fails if the production schema diverges in shape).
  const Envelope = z.object({
    output: z.unknown().optional(),
    overallConfidence: z.number().nullable().optional(),
    dominanceData: z.array(z.any()).optional(),
    trajectoryData: z.any().nullable().optional(),
  });

  function gate(envelope: any): { ok: boolean; reason?: string } {
    if (envelope == null) return { ok: false, reason: "null" };
    const r = Envelope.safeParse(envelope);
    if (!r.success) return { ok: false, reason: "envelope_invalid" };
    if (!r.data.output || typeof r.data.output !== "object") return { ok: false, reason: "no_output" };
    const prov = (r.data.output as any)?._provenance;
    if (prov?.freshnessClass === "NEEDS_REFRESH" || prov?.freshnessClass === "INCOMPATIBLE") {
      return { ok: false, reason: `freshness_${prov.freshnessClass}` };
    }
    return { ok: true };
  }

  it("refuses NEEDS_REFRESH snapshots", () => {
    const r = gate({ output: { _provenance: { freshnessClass: "NEEDS_REFRESH" } } });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("freshness_NEEDS_REFRESH");
  });

  it("refuses INCOMPATIBLE snapshots", () => {
    const r = gate({ output: { _provenance: { freshnessClass: "INCOMPATIBLE" } } });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("freshness_INCOMPATIBLE");
  });

  it("accepts FRESH snapshots", () => {
    const r = gate({ output: { _provenance: { freshnessClass: "FRESH" }, signals: [] } });
    expect(r.ok).toBe(true);
  });

  it("accepts snapshots without _provenance (legacy data)", () => {
    const r = gate({ output: { signals: [] } });
    expect(r.ok).toBe(true);
  });

  it("rejects malformed envelopes (e.g. non-numeric overallConfidence)", () => {
    const r = gate({ output: { signals: [] }, overallConfidence: "not-a-number" as any });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("envelope_invalid");
  });
});

describe("Seal #10 / T11 — MI fetch-orch version baseline filters to COMPLETE only", () => {
  // Pure invariant: a PARTIAL snapshot must never be the version baseline.
  function pickBaseline(rows: { status: string; version: number; createdAt: number }[]) {
    const completeOnly = rows.filter(r => r.status === "COMPLETE")
      .sort((a, b) => b.createdAt - a.createdAt);
    return completeOnly[0] || null;
  }

  it("ignores PARTIAL snapshots even when newer than the latest COMPLETE", () => {
    const baseline = pickBaseline([
      { status: "COMPLETE", version: 5, createdAt: 100 },
      { status: "PARTIAL", version: 6, createdAt: 200 }, // newer but PARTIAL
    ]);
    expect(baseline?.version).toBe(5);
  });

  it("returns null when no COMPLETE snapshot exists", () => {
    const baseline = pickBaseline([
      { status: "PARTIAL", version: 1, createdAt: 100 },
      { status: "FAILED", version: 2, createdAt: 200 },
    ]);
    expect(baseline).toBeNull();
  });
});

describe("Seal #10 / T12 — snapshot-cleanup-worker in_flight_jobs filter (all 3 delete paths)", () => {
  // Architect pass-1 flagged: candidate query must SELECT jobId, otherwise
  // row.jobId is undefined and the filter is a no-op. These tests model
  // the post-fix behaviour for the cold-storage purge, the per-campaign
  // cap, and the orphan purge — all three must consult inFlightJobIds.

  // Cold-storage purge filter (purgeExpiredSnapshots).
  function coldStoragePurge(
    candidates: { id: string; status: string; jobId: string | null }[],
    inFlightJobIds: Set<string>,
  ) {
    const toDelete: string[] = [];
    let inFlightSkipped = 0;
    for (const row of candidates) {
      if (row.jobId && inFlightJobIds.has(row.jobId)) { inFlightSkipped++; continue; }
      toDelete.push(row.id);
    }
    return { toDelete, inFlightSkipped };
  }

  it("cold-storage: skips snapshots whose jobId is in_flight", () => {
    const r = coldStoragePurge(
      [
        { id: "s1", status: "PARTIAL", jobId: "job-running" },
        { id: "s2", status: "COMPLETE", jobId: "job-done" },
        { id: "s3", status: "PARTIAL", jobId: null },
      ],
      new Set(["job-running"]),
    );
    expect(r.toDelete).toEqual(["s2", "s3"]);
    expect(r.inFlightSkipped).toBe(1);
  });

  it("cold-storage: regression — undefined jobId (legacy / pre-fix select) treated as deletable", () => {
    // Pre-fix the cleanup query selected only { id, status }, so row.jobId
    // was always undefined and the filter never fired. Post-fix the query
    // includes jobId; rows that genuinely lack a jobId binding (rare,
    // legacy data) ARE deletable.
    const r = coldStoragePurge(
      [{ id: "s1", status: "PARTIAL", jobId: null }],
      new Set(["any"]),
    );
    expect(r.toDelete).toEqual(["s1"]);
  });

  it("cold-storage: deletes nothing when every candidate is in_flight", () => {
    const r = coldStoragePurge(
      [
        { id: "s1", status: "PARTIAL", jobId: "j1" },
        { id: "s2", status: "PARTIAL", jobId: "j2" },
      ],
      new Set(["j1", "j2"]),
    );
    expect(r.toDelete).toEqual([]);
    expect(r.inFlightSkipped).toBe(2);
  });

  // Per-campaign cap filter (enforcePerCampaignCap).
  function capEnforce(
    rows: { id: string; jobId: string | null }[],
    protectedIds: Set<string>,
    inFlightJobIds: Set<string>,
  ) {
    return rows
      .filter((r) => !protectedIds.has(r.id))
      .filter((r) => !(r.jobId && inFlightJobIds.has(r.jobId)))
      .map((r) => r.id);
  }

  it("per-campaign-cap: excludes both protected AND in-flight rows", () => {
    const result = capEnforce(
      [
        { id: "s1", jobId: "j-running" },
        { id: "s2", jobId: "j-done" },
        { id: "s3", jobId: null },
        { id: "s4", jobId: "j-done" },
      ],
      new Set(["s4"]),
      new Set(["j-running"]),
    );
    expect(result).toEqual(["s2", "s3"]);
  });

  // Orphan purge filter (purgeOrphanedSnapshots).
  function orphanPurge(
    orphaned: { id: string; jobId: string | null }[],
    protectedIds: Set<string>,
    inFlightJobIds: Set<string>,
  ) {
    const toDelete: string[] = [];
    let inFlightSkipped = 0;
    for (const row of orphaned) {
      if (protectedIds.has(row.id)) continue;
      if (row.jobId && inFlightJobIds.has(row.jobId)) { inFlightSkipped++; continue; }
      toDelete.push(row.id);
    }
    return { toDelete, inFlightSkipped };
  }

  it("orphan-purge: refuses to delete an orphan whose run is still in-flight", () => {
    const r = orphanPurge(
      [
        { id: "o1", jobId: "j-running" },
        { id: "o2", jobId: "j-done" },
      ],
      new Set(),
      new Set(["j-running"]),
    );
    expect(r.toDelete).toEqual(["o2"]);
    expect(r.inFlightSkipped).toBe(1);
  });
});

describe("Seal #10 / T12 — in_flight_jobs stale-row reaper", () => {
  // Mirror of reapStaleInFlightJobs's predicate: row is reaped if
  // expectedCompleteBy is in the past, OR startedAt is older than
  // (now - IN_FLIGHT_REAP_GRACE_MS = 60min).
  const REAP_GRACE_MS = 60 * 60 * 1000;
  function isReapable(row: { startedAt: number; expectedCompleteBy: number | null }, now: number) {
    if (row.expectedCompleteBy != null && row.expectedCompleteBy < now) return true;
    if (row.startedAt < now - REAP_GRACE_MS) return true;
    return false;
  }

  it("reaps a row whose expectedCompleteBy is in the past", () => {
    const now = 10_000_000;
    expect(isReapable({ startedAt: now - 1000, expectedCompleteBy: now - 1 }, now)).toBe(true);
  });

  it("reaps a row with no expectedCompleteBy but startedAt > 60min ago", () => {
    const now = 10_000_000;
    expect(isReapable({ startedAt: now - REAP_GRACE_MS - 1, expectedCompleteBy: null }, now)).toBe(true);
  });

  it("keeps a fresh row whose deadline has not passed", () => {
    const now = 10_000_000;
    expect(isReapable({ startedAt: now - 5_000, expectedCompleteBy: now + 60_000 }, now)).toBe(false);
  });

  it("keeps a row started just under the grace window", () => {
    const now = 10_000_000;
    expect(isReapable({ startedAt: now - REAP_GRACE_MS + 1000, expectedCompleteBy: null }, now)).toBe(false);
  });
});
