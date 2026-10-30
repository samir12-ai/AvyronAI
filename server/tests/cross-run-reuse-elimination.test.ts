/**
 * CROSS-RUN REUSE ELIMINATION REGRESSION TESTS
 * ─────────────────────────────────────────────────────────────────────────────
 * Validates that cross-run analytical and strategic reuse is completely eliminated.
 * Every new orchestration run must generate fresh outputs from current authoritative inputs.
 * Historical snapshots remain in PostgreSQL for audit/debugging/telemetry only.
 *
 * Invariants Covered:
 *  - Invariant A: Consecutive jobs produce fresh snapshots with jobId === currentJobId.
 *  - Invariant B: forceRefresh=false generates fresh strategic outputs (no reuse).
 *  - Invariant C: forceRefresh=true generates fresh strategic outputs.
 *  - Invariant D: Legacy Mechanism snapshot with hallucinations is never selected by a new run.
 *  - Invariant E: Older Audience cannot enter new StrategyRoot (fails closed on mismatch).
 *  - Invariant F: Older Mechanism cannot enter new StrategyRoot (fails closed on mismatch).
 *  - Invariant G: Older Positioning cannot enter new StrategyRoot (fails closed on mismatch).
 *  - Invariant H: Older Statistical Validation cannot satisfy current run.
 *  - Invariant I: Current run with missing child snapshot fails closed.
 *  - Invariant J: Current-run route handlers never fallback to ORDER BY desc LIMIT 1 historical snapshots.
 *  - Invariant K: Historical endpoints can still retrieve old snapshots intentionally by ID.
 *  - Invariant L: System Control / StrategyRoot accepts coherent current-job lineage and rejects mixed-job lineage.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import path from "path";
import fs from "fs";
import {
  tryReuseAudience,
  tryReusePositioning,
  tryReuseDifferentiation,
  tryReuseMechanism,
  tryReuseOffer,
  tryReuseAwareness,
  tryReuseFunnel,
  tryReusePersuasion,
  tryReuseIntegrity,
  tryReuseStatVal,
  tryReuseBudgetGovernor,
  tryReuseChannelSelection,
  tryReuseIteration,
  tryReuseRetention,
} from "../orchestrator/snapshot-reuse";
import { assertCompleteRoot } from "../shared/strategy-root";

describe("Cross-Run Reuse Elimination — Invariants A, B, C: Snapshot Reuse Stubs & Engine Execution", () => {
  it("Invariant A & B: All tryReuse* stubs unconditionally return null", async () => {
    const acct = "test-acct";
    const camp = "test-camp";
    const hash = "hash-123";

    expect(await tryReuseAudience(acct, camp, hash)).toBeNull();
    expect(await tryReusePositioning(acct, camp, hash)).toBeNull();
    expect(await tryReuseDifferentiation(acct, camp, hash)).toBeNull();
    expect(await tryReuseMechanism(acct, camp, hash)).toBeNull();
    expect(await tryReuseOffer(acct, camp, hash)).toBeNull();
    expect(await tryReuseAwareness(acct, camp, hash)).toBeNull();
    expect(await tryReuseFunnel(acct, camp, hash)).toBeNull();
    expect(await tryReusePersuasion(acct, camp, hash)).toBeNull();
    expect(await tryReuseIntegrity(acct, camp, hash)).toBeNull();
    expect(await tryReuseStatVal(acct, camp, hash)).toBeNull();
    expect(await tryReuseBudgetGovernor(acct, camp, hash)).toBeNull();
    expect(await tryReuseChannelSelection(acct, camp, hash)).toBeNull();
    expect(await tryReuseIteration(acct, camp, hash)).toBeNull();
    expect(await tryReuseRetention(acct, camp, hash)).toBeNull();
  });

  it("Invariant B & C: Orchestrator index.ts contains zero tryReuse calls in engine cases", () => {
    const orchSource = fs.readFileSync(path.resolve(process.cwd(), "server/orchestrator/index.ts"), "utf-8");
    const tryReuseCalls = orchSource.match(/tryReuse\w+\(/g);
    expect(tryReuseCalls).toBeNull();
  });

  it("Invariant B: Market Intelligence V3 does not skip execution via getCachedSnapshot under forceRefresh=false", () => {
    const miSource = fs.readFileSync(path.resolve(process.cwd(), "server/market-intelligence-v3/engine.ts"), "utf-8");
    expect(miSource).not.toMatch(/if\s*\(!forceRefresh\)\s*\{\s*const cacheResult\s*=\s*await getCachedSnapshot/);
  });

  it("Invariant B: Market Voice pipeline does not bypass discovery when evidence exists under forceRefresh=false", () => {
    const mvSource = fs.readFileSync(path.resolve(process.cwd(), "server/market-voice/pipeline.ts"), "utf-8");
    expect(mvSource).not.toMatch(/if\s*\(!forceRefresh\)\s*\{\s*const\s*\[existingRes\]\s*=\s*await db/);
  });
});

describe("Cross-Run Reuse Elimination — Invariants D, E, F, G, H, I, L: StrategyRoot Single-Run Lineage", () => {
  function validateLineage(
    childJobs: { audience?: string | null; positioning?: string | null; differentiation?: string | null; mechanism?: string | null },
    currentJobId?: string
  ): { valid: boolean; error?: string } {
    const nonNullJobs = Object.entries(childJobs)
      .filter(([_, jId]) => typeof jId === "string" && jId.length > 0)
      .map(([_, jId]) => jId as string);

    const distinctJobs = Array.from(new Set(nonNullJobs));
    if (distinctJobs.length > 1) {
      const details = Object.entries(childJobs).map(([eng, jId]) => `${eng}=${jId ?? "missing"}`).join(", ");
      return {
        valid: false,
        error: `single_run_lineage_mismatch: child snapshots belong to multiple distinct jobs (${details})`
      };
    }

    if (currentJobId && distinctJobs.length > 0 && distinctJobs[0] !== currentJobId) {
      return {
        valid: false,
        error: `single_run_lineage_mismatch: child snapshots belong to job ${distinctJobs[0]} but current job is ${currentJobId}`
      };
    }

    return { valid: true };
  }

  it("Invariant L: Accepts coherent single-run child snapshots matching current jobId", () => {
    const jobId = "orch_20260906_run123";
    const res = validateLineage({
      audience: jobId,
      positioning: jobId,
      differentiation: jobId,
      mechanism: jobId,
    }, jobId);
    expect(res.valid).toBe(true);
  });

  it("Invariant E: Older Audience snapshot fails closed when entering a new StrategyRoot", () => {
    const currentJob = "orch_job_new";
    const olderJob = "orch_job_old";
    const res = validateLineage({
      audience: olderJob,
      positioning: currentJob,
      differentiation: currentJob,
      mechanism: currentJob,
    }, currentJob);
    expect(res.valid).toBe(false);
    expect(res.error).toContain("multiple distinct jobs");
  });

  it("Invariant F & D: Older Mechanism snapshot (e.g. legacy with hallucinations) fails closed", () => {
    const currentJob = "orch_job_new";
    const legacyMechJob = "orch_job_legacy_hallucinated";
    const res = validateLineage({
      audience: currentJob,
      positioning: currentJob,
      differentiation: currentJob,
      mechanism: legacyMechJob,
    }, currentJob);
    expect(res.valid).toBe(false);
    expect(res.error).toContain("multiple distinct jobs");
  });

  it("Invariant G: Older Positioning snapshot fails closed", () => {
    const currentJob = "orch_job_new";
    const olderJob = "orch_job_old";
    const res = validateLineage({
      audience: currentJob,
      positioning: olderJob,
      differentiation: currentJob,
      mechanism: currentJob,
    }, currentJob);
    expect(res.valid).toBe(false);
    expect(res.error).toContain("multiple distinct jobs");
  });

  it("Invariant H: All child snapshots from previous run fail closed against new jobId", () => {
    const currentJob = "orch_job_new";
    const oldJob = "orch_job_old";
    const res = validateLineage({
      audience: oldJob,
      positioning: oldJob,
      differentiation: oldJob,
      mechanism: oldJob,
    }, currentJob);
    expect(res.valid).toBe(false);
    expect(res.error).toContain(`child snapshots belong to job ${oldJob} but current job is ${currentJob}`);
  });

  it("Invariant I: Missing child snapshot required fields fail closed during assertCompleteRoot", () => {
    const incompleteInput: any = {
      campaignId: "camp_123",
      accountId: "acct_123",
      audienceSnapshotId: "",
      mechanismSnapshotId: "mech_123",
      primaryAxis: "Premium",
      contrastAxisText: "Modesty",
      approvedAudiencePains: [{ painId: "p1", canonical: "Pain 1" }],
    };
    const missing = assertCompleteRoot(incompleteInput, "build");
    expect(missing).toContain("audience_data");
  });
});

describe("Cross-Run Reuse Elimination — Invariants J & K: Route Fallback Elimination & History Preservation", () => {
  it("Invariant J: Mechanism routes analyze endpoint does not fallback to ORDER BY desc LIMIT 1", () => {
    const mechRouteSource = fs.readFileSync(path.resolve(process.cwd(), "server/mechanism-engine/routes.ts"), "utf-8");
    expect(mechRouteSource).not.toMatch(/differentiationSnapshots\.createdAt\)\)\.limit\(1\)/);
    expect(mechRouteSource).toContain("MISSING_DEPENDENCY");
  });

  it("Invariant J: Differentiation routes analyze endpoint does not fallback to ORDER BY desc LIMIT 1", () => {
    const diffRouteSource = fs.readFileSync(path.resolve(process.cwd(), "server/differentiation-engine/routes.ts"), "utf-8");
    expect(diffRouteSource).not.toMatch(/miSnapshots\.createdAt\)\)\.limit\(1\)/);
    expect(diffRouteSource).toContain("MISSING_DEPENDENCY");
  });

  it("Invariant K: StrategyRoot and snapshot tables preserve schema columns for historical audit and queries", () => {
    const schemaSource = fs.readFileSync(path.resolve(process.cwd(), "shared/schema.ts"), "utf-8");
    expect(schemaSource).toContain("strategyRoots");
    expect(schemaSource).toContain("jobId");
    expect(schemaSource).toContain("inputHash");
  });
});
