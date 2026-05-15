/**
 * Track #3 / Seal #15 — silent-degradation hardening regression suite.
 *
 * Covers the zombie-in-flight watchdogs added in Track #3:
 *
 *   1. server/boss/concurrency.ts — withCampaignLock previously stored a
 *      bare Promise. If `work()` never settled, the entry permanently
 *      blocked all future Boss runs for that campaign. The watchdog now
 *      evicts entries older than BOSS_INFLIGHT_MAX_AGE_MS on every entry
 *      and reports the eviction via _bossInFlightStats().
 *
 *   2. server/continuity/scheduler.ts — runContinuityTick previously
 *      returned the in-flight promise even if it had been pending for
 *      hours. The watchdog now force-clears the in-flight reference if
 *      the prior tick has been pending past CONTINUITY_TICK_MAX_AGE_MS,
 *      restoring the heartbeat.
 *
 * Both tests assert the BEHAVIOR (eviction occurs + counter increments)
 * not just that the helpers exist.
 */
import { describe, it, expect, beforeEach } from "vitest";

describe("Track #3 — boss/concurrency zombie watchdog", () => {
  let mod: typeof import("../boss/concurrency");

  beforeEach(async () => {
    process.env.BOSS_INFLIGHT_MAX_AGE_MS = "200";
    // Re-import after env override so the module-level constant binds to
    // our short ceiling. vitest caches by absolute path; resetModules wipes.
    await import("vitest").then((v) => v.vi.resetModules());
    mod = await import("../boss/concurrency");
    mod._resetBossInFlightCounters();
  });

  it("evicts a stale in-flight entry on the next withCampaignLock call", async () => {
    const accountId = "acc-1";
    const campaignId = "camp-1";

    // Inject a synthetic stale entry whose age (500ms) exceeds the
    // watchdog ceiling (200ms). The eviction must happen on the very
    // next withCampaignLock entry — without it, the lock would throw
    // BossRunInFlightError forever.
    mod._injectStaleInFlightForTest(accountId, campaignId, 500);
    expect(mod._bossInFlightStats().size).toBe(1);
    expect(mod._bossInFlightStats().zombieEvictions).toBe(0);

    const result = await mod.withCampaignLock(accountId, campaignId, async () => {
      return { runId: "ok", outcome: "completed" } as any;
    });

    expect(result).toBeDefined();
    const stats = mod._bossInFlightStats();
    expect(stats.zombieEvictions).toBe(1);
    expect(stats.size).toBe(0);
  });

  it("token cleanup: late-settling stale promise must NOT delete a fresh successor entry (architect HIGH race)", async () => {
    const accountId = "acc-race";
    const campaignId = "camp-race";

    // Build a controllable "stale" promise so we can settle it AFTER a
    // fresh entry has been installed under the same key. Without the
    // ownership-token check, the stale promise's `.finally(delete)`
    // would erase the fresh entry → second concurrent caller would no
    // longer throw BOSS_RUN_IN_FLIGHT → silent duplicate Boss runs.
    let releaseStale: () => void = () => {};
    const stalePromise = new Promise<any>((resolve) => {
      releaseStale = () => resolve({ runId: "stale", outcome: "completed" });
    });

    // Install the stale promise via the production code path (so its
    // own `.finally(delete-by-token)` is wired correctly) then backdate
    // its startedAt past the watchdog ceiling.
    const stalePromiseHandle = mod.withCampaignLock(accountId, campaignId, () => stalePromise);
    // Backdate by mutating the entry directly. We use the test helper
    // by re-injecting at the same key with a much older startedAt — but
    // we must FIRST capture the live promise so it isn't lost. The
    // simplest deterministic approach: set BOSS_INFLIGHT_MAX_AGE_MS=0
    // for this case (already 200ms — close enough; sleep past it).
    await new Promise((r) => setTimeout(r, 250));
    expect(mod._bossInFlightStats().size).toBe(1);

    // Now a SECOND withCampaignLock call evicts the stale entry and
    // installs a fresh promise under the same key. The fresh promise
    // resolves immediately.
    const freshResult = await mod.withCampaignLock(accountId, campaignId, async () => ({
      runId: "fresh",
      outcome: "completed",
    }) as any);
    expect(freshResult).toBeDefined();
    expect(mod._bossInFlightStats().zombieEvictions).toBe(1);
    expect(mod._bossInFlightStats().size).toBe(0);

    // Critical assertion: install ANOTHER fresh entry that we hold
    // open, then settle the original stale promise. The stale
    // `.finally` MUST NOT delete this third entry (token mismatch).
    let release3: () => void = () => {};
    const held = new Promise<any>((resolve) => { release3 = () => resolve({ runId: "third", outcome: "completed" }); });
    const thirdHandle = mod.withCampaignLock(accountId, campaignId, () => held);
    expect(mod._bossInFlightStats().size).toBe(1);

    // Settle the original stale promise. Its finally fires now, AFTER
    // a fresh entry exists under the same key. With the token fix the
    // fresh entry survives. Without the fix, size becomes 0.
    releaseStale();
    await stalePromiseHandle.catch(() => undefined);
    // Microtask flush so the late-settling finally has a chance to
    // race against our assertion.
    await new Promise((r) => setImmediate(r));
    expect(mod._bossInFlightStats().size).toBe(1); // fresh entry preserved

    // Cleanup
    release3();
    await thirdHandle;
  });

  it("does NOT evict a fresh in-flight entry — concurrent attempt still throws", async () => {
    const accountId = "acc-2";
    const campaignId = "camp-2";

    // Hold a real promise open. Its age is 0ms so the watchdog must NOT
    // evict it. The second concurrent attempt must throw the in-flight
    // error (proving the lock is still doing its primary job).
    let release: () => void = () => {};
    const heldWork = new Promise<any>((resolve) => {
      release = () => resolve({ runId: "x", outcome: "completed" });
    });
    const first = mod.withCampaignLock(accountId, campaignId, () => heldWork);

    await expect(
      mod.withCampaignLock(accountId, campaignId, async () => {
        return { runId: "y", outcome: "completed" } as any;
      }),
    ).rejects.toMatchObject({ code: "BOSS_RUN_IN_FLIGHT" });

    expect(mod._bossInFlightStats().zombieEvictions).toBe(0);
    release();
    await first;
    expect(mod._bossInFlightStats().size).toBe(0);
  });
});

describe("Track #3 — continuity scheduler inFlightTick zombie watchdog", () => {
  it("force-clears a stale inFlightTick on next runContinuityTick entry", async () => {
    process.env.CONTINUITY_TICK_MAX_AGE_MS = "150";
    process.env.CONTINUITY_SCHEDULER_DISABLED = "true";
    const { vi: vitestVi } = await import("vitest");
    vitestVi.resetModules();

    // Mock the db module so listActiveCampaigns returns zero rows — keeps
    // the test hermetic. The behavior we care about is the watchdog,
    // which runs BEFORE listActiveCampaigns is called.
    vitestVi.doMock("../db", () => ({
      db: {
        execute: vitestVi.fn().mockResolvedValue({ rows: [] }),
        select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: () => [] }) }) }) }),
        insert: () => ({ values: vitestVi.fn().mockResolvedValue([]) }),
      },
    }));
    vitestVi.doMock("../audit", () => ({ logAudit: vitestVi.fn().mockResolvedValue(undefined) }));

    const sched = await import("../continuity/scheduler");
    sched._resetContinuityState();

    // Internal handle for the synthetic stuck tick — we hold it open so
    // the watchdog has a real "stale promise" to evict, then release it
    // at the end of the test to avoid an unhandled-promise warning.
    let releaseStuck: () => void = () => {};
    const stuckPromise = new Promise<any>((resolve) => {
      releaseStuck = () => resolve({});
    });

    // Mutate the module state through the test-only reset + a controlled
    // injection. We mimic a hung previous tick by setting inFlightTick +
    // backdating its startedAt past the watchdog ceiling. The cleanest
    // way is to invoke runContinuityTick once with persist:false and
    // immediately call again after sleeping past the ceiling. To stay
    // deterministic we instead use a small monkey-patch via the exported
    // stats helper to verify the eviction path actually fires.

    // First: run a normal tick. With zero campaigns, it completes near-
    // instantly. inFlightTick should clear back to null afterwards.
    const r1 = await sched.runContinuityTick({ persist: false });
    expect(r1.campaignsScanned).toBe(0);
    expect(sched._continuityTickInflightStats().inFlight).toBe(false);

    // Now simulate a zombie: we cannot directly write to the module's
    // private inFlightTick, but we CAN use the same trick as the boss
    // test by triggering a real tick that we hold open via the mocked
    // db.execute. Wait > ceiling, then issue a second tick call. The
    // watchdog must evict and proceed (campaignsScanned = 0 again).
    let unblock: (v: any) => void = () => {};
    const blockingDbCall = new Promise((resolve) => { unblock = resolve; });
    (sched as any); // silence "unused" if any
    // Re-mock execute to hang the next call (the listActiveCampaigns query).
    const dbMod = await import("../db");
    (dbMod.db as any).execute = vitestVi.fn().mockImplementationOnce(() => blockingDbCall);
    (dbMod.db as any).execute.mockImplementation(() => Promise.resolve({ rows: [] }));

    const stuckTick = sched.runContinuityTick({ persist: false });
    // Give the microtask queue a chance to set inFlightTickStartedAt.
    await new Promise((r) => setTimeout(r, 10));
    expect(sched._continuityTickInflightStats().inFlight).toBe(true);

    // Wait past the 150ms ceiling and call again — the watchdog must
    // evict the stuck tick and run a fresh one against the (now resolving)
    // db.execute mock.
    await new Promise((r) => setTimeout(r, 250));
    const freshTick = await sched.runContinuityTick({ persist: false });
    expect(freshTick.campaignsScanned).toBe(0);
    expect(sched._continuityTickInflightStats().zombieEvictions).toBeGreaterThanOrEqual(1);

    // Cleanup: unblock the original stuck tick so it doesn't leak.
    unblock({ rows: [] });
    releaseStuck();
    await stuckTick.catch(() => undefined); // may resolve or reject — both fine
    await stuckPromise;
  });
});
