/**
 * Seal #16 — Track #3 follow-ups behavioral regression suite.
 *
 *   F1 — fetch-orchestrator `activeJobs` Map zombie watchdog mirrors the
 *        boss/concurrency `{promise, startedAt, token}` pattern. Tests
 *        drive `trackActiveJob` directly to prove (a) stale eviction on
 *        entry past `MI_ACTIVE_JOBS_MAX_AGE_MS` and (b) token-checked
 *        cleanup so a late-settling stale promise cannot delete a fresh
 *        successor entry under the same lockKey.
 *
 *   F2 — `aiGemini()` wall-clock timeout MUST also abort the underlying
 *        @google/genai SDK call via `AbortController.signal` (passed in
 *        `GenerateContentConfig.abortSignal`). Pre-Seal #16 the SDK call
 *        kept running in the background, leaking sockets + budget.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

describe("Seal #16 / F1 — fetch-orchestrator activeJobs zombie watchdog", () => {
  let mod: typeof import("../market-intelligence-v3/fetch-orchestrator");

  beforeEach(async () => {
    process.env.MI_ACTIVE_JOBS_MAX_AGE_MS = "200";
    vi.resetModules();
    vi.doMock("../db", () => ({
      db: {
        execute: vi.fn().mockResolvedValue({ rows: [] }),
        select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: () => [] }) }) }) }),
        insert: () => ({ values: vi.fn().mockResolvedValue([]) }),
        update: () => ({ set: () => ({ where: vi.fn().mockResolvedValue([]) }) }),
      },
    }));
    mod = await import("../market-intelligence-v3/fetch-orchestrator");
    mod._resetActiveJobsCountersForTest();
  });

  it("evicts a stale activeJob entry on the next trackActiveJob call (production path)", async () => {
    const staleKey = "acc-stale:camp-stale";
    const freshKey = "acc-fresh:camp-fresh";

    // Inject a synthetic stale entry whose age (500ms) exceeds the watchdog
    // ceiling (200ms). Eviction MUST fire on the very next trackActiveJob
    // call — without it the entry would linger indefinitely.
    mod._injectStaleActiveJobForTest(staleKey, 500);
    expect(mod._activeJobsStats().size).toBe(1);
    expect(mod._activeJobsStats().zombieEvictions).toBe(0);

    // Drive the production helper directly under a DIFFERENT key. The first
    // line of trackActiveJob calls evictZombieActiveJobs(now), which must
    // sweep the stale entry above before installing the fresh one.
    await mod.trackActiveJob(freshKey, async () => {
      // no-op work — we just want the entry/finally cycle
    });

    const stats = mod._activeJobsStats();
    expect(stats.zombieEvictions).toBe(1);
    expect(stats.size).toBe(0); // stale evicted + fresh's finally already fired
  });

  it("token cleanup: late-settling stale promise must NOT delete a fresh successor (race fix)", async () => {
    const lockKey = "acc-race:camp-race";

    // Install a real in-flight job via the production path; we hold its
    // work() open so it stays in the Map. We then backdate the entry past
    // the watchdog ceiling by sleeping past 200ms so the next trackActiveJob
    // call evicts and replaces it. After eviction we settle the original
    // stale promise — its `.finally(delete-by-token)` MUST detect the token
    // mismatch and leave the successor entry intact.
    let releaseStale: () => void = () => {};
    const stalePromise = new Promise<void>((resolve) => {
      releaseStale = () => resolve();
    });
    const staleHandle = mod.trackActiveJob(lockKey, () => stalePromise);
    expect(mod._activeJobsStats().size).toBe(1);

    // Sleep past the watchdog ceiling so the stale entry's startedAt ages.
    await new Promise((r) => setTimeout(r, 250));

    // Install a SECOND in-flight job under the SAME key. trackActiveJob
    // evicts the stale entry on entry and installs a fresh one with a new
    // token. We hold this second job open so we can observe its survival.
    let releaseFresh: () => void = () => {};
    const freshPromise = new Promise<void>((resolve) => {
      releaseFresh = () => resolve();
    });
    const freshHandle = mod.trackActiveJob(lockKey, () => freshPromise);
    expect(mod._activeJobsStats().zombieEvictions).toBe(1);
    expect(mod._activeJobsStats().size).toBe(1); // fresh entry installed

    // CRITICAL: settle the original stale promise. Its `.finally` fires
    // now, AFTER a fresh entry exists under the same lockKey. With the
    // token check, the fresh entry survives. Without it, size→0 and a
    // third concurrent caller would silently bypass the lock.
    releaseStale();
    await staleHandle.catch(() => undefined);
    await new Promise((r) => setImmediate(r)); // microtask flush

    expect(mod._activeJobsStats().size).toBe(1); // fresh entry preserved

    // Cleanup
    releaseFresh();
    await freshHandle;
    expect(mod._activeJobsStats().size).toBe(0);
  });

  it("does NOT evict a fresh in-flight entry — eviction counter stays 0", async () => {
    const lockKey = "acc-fresh-only:camp-fresh-only";

    let release: () => void = () => {};
    const heldWork = new Promise<void>((resolve) => {
      release = () => resolve();
    });
    const handle = mod.trackActiveJob(lockKey, () => heldWork);
    expect(mod._activeJobsStats().size).toBe(1);

    // Trigger another trackActiveJob entry under a different key. The
    // watchdog runs but must NOT evict the fresh entry (age = ~0ms).
    await mod.trackActiveJob("acc-other:camp-other", async () => {});

    expect(mod._activeJobsStats().zombieEvictions).toBe(0);
    expect(mod._activeJobsStats().size).toBe(1); // original still in flight

    release();
    await handle;
    expect(mod._activeJobsStats().size).toBe(0);
  });
});

describe("Seal #16 / F2 — aiGemini AbortController wires SDK abort on timeout", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.AI_GEMINI_HARD_TIMEOUT_MS = "50";
    process.env.AI_INTEGRATIONS_GEMINI_API_KEY = "test-key";
  });

  it("aborts the underlying SDK call when the wall-clock timeout fires", async () => {
    let capturedSignal: AbortSignal | undefined;

    // Stub @google/genai before ai-client loads. generateContent returns a
    // promise that NEVER settles — only the abort signal can interrupt.
    vi.doMock("@google/genai", () => ({
      GoogleGenAI: class {
        models = {
          generateContent: (params: any) => {
            capturedSignal = params?.config?.abortSignal as AbortSignal;
            return new Promise(() => {
              /* never resolves */
            });
          },
        };
      },
      Modality: {},
    }));

    // db.execute throws → ai-client's budget reservation falls open (matches
    // production fail-open on infra errors). Keeps the test hermetic.
    vi.doMock("../db", () => ({
      db: {
        execute: vi.fn().mockRejectedValue(new Error("test-isolation: no db")),
      },
    }));

    const { aiGemini, AICallError } = await import("../ai-client");

    const startedAt = Date.now();
    await expect(
      aiGemini({
        model: "gemini-2.5-flash",
        contents: "test",
        accountId: "test-account",
        endpoint: "test-endpoint",
      }),
    ).rejects.toMatchObject({
      name: "AICallError",
      code: "AI_TIMEOUT",
    });

    const elapsed = Date.now() - startedAt;
    expect(elapsed).toBeLessThan(2000); // 50ms timeout + jitter

    // Critical: the SDK call received our AbortSignal AND it was aborted
    // by the time AICallError surfaced. This proves the wiring.
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal!.aborted).toBe(true);
    expect(AICallError).toBeDefined();
  });
});
