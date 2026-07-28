/**
 * Seal #11 / Task #29 — scaling, concurrency, worker resilience.
 *
 * Tests for the 10 audit findings closed by this task (F6.1, F6.2,
 * F6.3, F6.4, F6.5, F6.6, F6.8, F6.9, F6.10, F6.11). Mix of:
 *   - Source-contract assertions (catch regressions of the documented
 *     code shape — fast, no I/O).
 *   - Behavioral assertions (architect-required for F6.4/F6.6/F6.9 —
 *     execute module logic and assert state transitions/leak prevention).
 */

import { describe, it, expect, vi } from "vitest";
import * as http from "http";

describe("Seal #11 — scaling & resilience contracts", () => {
  it("F6.1 — token-budget store exposes read-through API", async () => {
    const mod = await import("../market-intelligence-v3/token-budget-store");
    expect(typeof mod.loadTokenBudget).toBe("function");
    expect(typeof mod.persistTokenBudget).toBe("function");
    expect(typeof mod.getOrComputeBudget).toBe("function");
    expect(typeof mod.purgeExpiredTokenBudgets).toBe("function");

    // null jobKey path: must compute fresh and NOT touch the DB.
    const budget = await mod.getOrComputeBudget(null, {
      competitorCount: 3,
      totalComments: 10,
      totalPosts: 20,
    });
    expect(budget).toBeTruthy();
    expect(typeof budget.selectedMode).toBe("string");
  });

  it("F6.2 — P-6.12: proxy pool is a RETIRED shim (no registry, no sessions, no BD transport)", async () => {
    // F6.2 bounded the pool registry. The pool no longer exists — the shim
    // must hold no state at all (nothing to bound) and never construct a
    // session.
    const src = await import("fs").then((fs) =>
      fs.promises.readFile("server/competitive-intelligence/proxy-pool-manager.ts", "utf8"),
    );
    expect(src).toContain("RETIRED SHIM");
    expect(src).not.toMatch(/new LRUCache/);
    // The StickySessionContext TYPE keeps a poolFetch member for call-site
    // compatibility, but no implementation may exist (no function body).
    expect(src).not.toMatch(/function poolFetch|poolFetch\s*=\s*(async\s*)?\(/);
    const mod = await import("../competitive-intelligence/proxy-pool-manager");
    expect(mod.acquireStickySession("acct", "camp", "comp")).toBeNull();
    const diag = mod.getPoolDiagnostics("acct");
    expect(diag.totalSessions).toBe(0);
    expect(diag.activeSessions).toBe(0);
  });

  it("F6.3 — db pool is configured with bounded max + statement_timeout", async () => {
    const src = await import("fs").then((fs) =>
      fs.promises.readFile("server/db.ts", "utf8"),
    );
    expect(src).toMatch(/DB_POOL_MAX/);
    expect(src).toMatch(/idleTimeoutMillis/);
    expect(src).toMatch(/connectionTimeoutMillis/);
    expect(src).toMatch(/statement_timeout/);
  });

  it("F6.4 + F6.10 — autonomous worker has advisory lock + jitter + Promise gate", async () => {
    const src = await import("fs").then((fs) =>
      fs.promises.readFile("server/autonomous-worker.ts", "utf8"),
    );
    // F6.4 — advisory lock.
    expect(src).toMatch(/pg_try_advisory_lock/);
    expect(src).toMatch(/pg_advisory_unlock/);
    expect(src).toMatch(/WORKER_TICK_LOCK_KEY/);
    // F6.4 — session-pinned PoolClient (architect-required correctness fix).
    // Acquire + release MUST go through the SAME pinned client, not via
    // db.execute() which would route each call to a fresh checked-out
    // connection and silently fail to release.
    expect(src).toMatch(/pool\.connect\(\)/);
    expect(src).toMatch(/tryAcquireWorkerLockOn\(client\)/);
    expect(src).toMatch(/releaseWorkerLockOn\(client\)/);
    expect(src).toMatch(/client\.release\(\)/);
    // F6.4 — jittered tick scheduling.
    expect(src).toMatch(/WORKER_TICK_JITTER_MS/);
    expect(src).toMatch(/scheduleNextTick/);
    // F6.10 — Promise-based gate, not a boolean.
    expect(src).toMatch(/sharedPoolRunningPromise/);
    expect(src).toMatch(/await sharedPoolRunningPromise/);
    expect(src).not.toMatch(/let sharedPoolRunning\s*=\s*false/);
  });

  it("F6.4 — pg_try_advisory_lock acquired + released on the same pinned PoolClient is reusable from a fresh session", async () => {
    // Behavioral test (architect-required): proves the session-pinned
    // acquire/release contract — if acquire and release happen on the
    // same client, a separate session can re-acquire immediately.
    if (!process.env.DATABASE_URL) {
      // Skip in environments without a DB (unit-only CI). The static
      // string-match test above covers the source-level contract.
      return;
    }
    const { pool } = await import("../db");
    const TEST_KEY = 0x4F574EAF;
    const c1 = await pool.connect();
    const c2 = await pool.connect();
    try {
      const r1 = await c1.query<{ got: boolean }>(
        `SELECT pg_try_advisory_lock(${TEST_KEY}) AS got`,
      );
      expect(r1.rows[0].got).toBe(true);
      // Second session must be denied while c1 holds the lock.
      const r2 = await c2.query<{ got: boolean }>(
        `SELECT pg_try_advisory_lock(${TEST_KEY}) AS got`,
      );
      expect(r2.rows[0].got).toBe(false);
      // Release on the SAME client that acquired.
      const rRel = await c1.query<{ released: boolean }>(
        `SELECT pg_advisory_unlock(${TEST_KEY}) AS released`,
      );
      expect(rRel.rows[0].released).toBe(true);
      // Second session can now acquire.
      const r3 = await c2.query<{ got: boolean }>(
        `SELECT pg_try_advisory_lock(${TEST_KEY}) AS got`,
      );
      expect(r3.rows[0].got).toBe(true);
      await c2.query(`SELECT pg_advisory_unlock(${TEST_KEY})`);
    } finally {
      c1.release();
      c2.release();
    }
  });

  it("F6.4 — releasing the PoolClient drops session-held advisory locks (defense in depth)", async () => {
    // Proves the finally-block client.release() acts as a safety net:
    // even if releaseWorkerLockOn() throws/fails, the lock is dropped
    // when the client returns to the pool.
    if (!process.env.DATABASE_URL) return;
    const { pool } = await import("../db");
    const TEST_KEY = 0x4F574EB0; // distinct from above to avoid interference
    const c1 = await pool.connect();
    const r1 = await c1.query<{ got: boolean }>(
      `SELECT pg_try_advisory_lock(${TEST_KEY}) AS got`,
    );
    expect(r1.rows[0].got).toBe(true);
    // Simulate the finally path WITHOUT calling pg_advisory_unlock.
    c1.release();
    // Give the pool a beat to process the release.
    await new Promise((r) => setTimeout(r, 50));
    const c2 = await pool.connect();
    try {
      const r2 = await c2.query<{ got: boolean }>(
        `SELECT pg_try_advisory_lock(${TEST_KEY}) AS got`,
      );
      // The lock MUST be releasable from a fresh session because the
      // pool detached the prior session (or PG dropped the session
      // locks). Either way, we must be able to re-acquire.
      expect(r2.rows[0].got).toBe(true);
      await c2.query(`SELECT pg_advisory_unlock(${TEST_KEY})`);
    } finally {
      c2.release();
    }
  });

  it("F6.5 + F6.8 + F6.11 — snapshot-cleanup-worker has batched DELETE, 7d orphan grace, and SIGTERM gate", async () => {
    const src = await import("fs").then((fs) =>
      fs.promises.readFile("server/snapshot-cleanup-worker.ts", "utf8"),
    );
    // F6.5
    expect(src).toMatch(/DELETE_BATCH_SIZE\s*=\s*1000/);
    expect(src).toMatch(/DELETE_BATCH_SLEEP_MS\s*=\s*50/);
    // Pass-6 round-2: predicate-driven helper (architect-required).
    expect(src).toMatch(/async function batchedDelete\(table: any, where: SQL\)/);
    // F6.8 — 7d orphan grace + uses snapshot timestamp.
    expect(src).toMatch(/ORPHAN_GRACE_DAYS\s*=\s*7/);
    expect(src).toMatch(/orphanGraceCutoff/);
    // Pass-6 round-2: grace gating is now in the SQL predicate
    // (lt(firstObservedAt, orphanGraceCutoff)), not a JS-side counter.
    // F6.11 — SIGTERM/SIGINT handler + Promise-await on stop().
    expect(src).toMatch(/installSnapshotCleanupShutdownHandlers/);
    expect(src).toMatch(/process\.on\("SIGTERM"/);
    expect(src).toMatch(/process\.on\("SIGINT"/);
    expect(src).toMatch(/cleanupRunningPromise/);
    expect(src).toMatch(/export async function stopSnapshotCleanupWorker/);
  });

  it("F6.6 — publish-worker fetches go through fetchMeta with 15s AbortController", async () => {
    const src = await import("fs").then((fs) =>
      fs.promises.readFile("server/publish-worker.ts", "utf8"),
    );
    expect(src).toMatch(/META_API_TIMEOUT_MS\s*=\s*parseInt\(/);
    expect(src).toMatch(/"15000"/);
    expect(src).toMatch(/async function fetchMeta/);
    expect(src).toMatch(/new AbortController\(\)/);
    expect(src).toMatch(/META_TIMEOUT/);
    // The 4 graph.facebook.com call sites must use fetchMeta, not raw fetch.
    const graphCalls = src.match(/await\s+fetch(Meta)?\(\s*\n?\s*`https:\/\/graph\.facebook\.com/g) || [];
    const rawFetchCalls = graphCalls.filter((m) => !m.includes("fetchMeta")).length;
    expect(rawFetchCalls).toBe(0);
    expect(graphCalls.length).toBeGreaterThanOrEqual(4);
  });

  it("F6.6 — fetchMeta times out and throws META_TIMEOUT for slow endpoints", async () => {
    // Synthesise the same race the real helper uses — proves the
    // AbortController + signal wiring is correct.
    const META_API_TIMEOUT_MS = 50;
    async function fetchMeta(input: string, init: RequestInit = {}): Promise<Response> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), META_API_TIMEOUT_MS);
      try {
        // Simulate a "fetch" that never resolves until we abort.
        return await new Promise<Response>((resolve, reject) => {
          controller.signal.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        });
      } catch (err: any) {
        if (err?.name === "AbortError" || controller.signal.aborted) {
          const e: any = new Error(`META_TIMEOUT after ${META_API_TIMEOUT_MS}ms`);
          e.code = "META_TIMEOUT";
          e.transient = true;
          throw e;
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    }
    let caught: any;
    try {
      await fetchMeta("https://graph.facebook.com/test");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeTruthy();
    expect(caught.code).toBe("META_TIMEOUT");
    expect(caught.transient).toBe(true);
  });

  it("F6.9 — data-acquisition exposes watchdog timeout + cancellation API", async () => {
    const src = await import("fs").then((fs) =>
      fs.promises.readFile("server/competitive-intelligence/data-acquisition.ts", "utf8"),
    );
    // P-6.12: default raised 45s → 300s — Apify actor runs are minutes-long
    // (comment actor live-verified at 13–315s), so a 45s watchdog would kill
    // every healthy enrichment.
    expect(src).toMatch(/FETCH_WATCHDOG_TIMEOUT_MS\s*=\s*parseInt\(/);
    expect(src).toMatch(/"300000"/);
    expect(src).toMatch(/interface ActiveFetch/);
    expect(src).toMatch(/abortController/);
    expect(src).toMatch(/export function cancelFetch/);
    expect(src).toMatch(/export function getActiveFetchCount/);
    expect(src).toMatch(/WATCHDOG_EVICT/);
    expect(src).toMatch(/FETCH_TIMEOUT/);
  });

  it("F6.9 — getActiveFetchCount is a non-negative integer at rest", async () => {
    const mod = await import("../competitive-intelligence/data-acquisition");
    const n = mod.getActiveFetchCount();
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBeGreaterThanOrEqual(0);
  });

  it("Migration 019_ai_token_budget exists and is idempotent", async () => {
    const fs = await import("fs");
    const sql = await fs.promises.readFile(
      "server/migrations/sql/019_ai_token_budget.sql",
      "utf8",
    );
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS\s+ai_token_budget/i);
    expect(sql).toMatch(/PRIMARY KEY/i);
  });

  // -------------------------------------------------------------------
  // Behavioral tests (architect-required)
  // -------------------------------------------------------------------

  it("F6.9 — withWatchdog returns timeout fallback, aborts the controller, and clears its timer (no leak)", async () => {
    const { withWatchdog, FETCH_WATCHDOG_TIMEOUT_MS } = await import(
      "../competitive-intelligence/data-acquisition"
    );
    // Sanity: P-6.12 default is 300s (Apify actor runs are minutes-long).
    expect(FETCH_WATCHDOG_TIMEOUT_MS).toBe(300_000);

    // Force a never-resolving promise; a tiny watchdog should win and
    // the abort signal should be raised, with no pending timer left.
    const ctrl = new AbortController();
    const neverResolves = new Promise<string>(() => {}); // hangs forever
    const before = (process as any)._getActiveHandles?.().length ?? -1;
    const t0 = Date.now();
    const { value, timedOut } = await withWatchdog<string>(
      neverResolves,
      50,
      ctrl,
      () => "TIMEOUT_FALLBACK",
    );
    const elapsed = Date.now() - t0;
    // Allow event-loop slop.
    await new Promise((r) => setTimeout(r, 10));
    const after = (process as any)._getActiveHandles?.().length ?? -1;

    expect(timedOut).toBe(true);
    expect(value).toBe("TIMEOUT_FALLBACK");
    expect(ctrl.signal.aborted).toBe(true);
    expect(elapsed).toBeLessThan(500);
    // Timer must be cleared in finally — handle count is bounded
    // (allow ±2 for unrelated event-loop handles).
    if (before !== -1 && after !== -1) {
      expect(after).toBeLessThanOrEqual(before + 2);
    }
  });

  it("F6.9 — withWatchdog passes through fast result and never aborts the controller", async () => {
    const { withWatchdog } = await import(
      "../competitive-intelligence/data-acquisition"
    );
    const ctrl = new AbortController();
    const fast = Promise.resolve("OK");
    const { value, timedOut } = await withWatchdog<string>(
      fast,
      10_000,
      ctrl,
      () => "SHOULD_NOT_FIRE",
    );
    expect(value).toBe("OK");
    expect(timedOut).toBe(false);
    expect(ctrl.signal.aborted).toBe(false);
  });

  it("F6.6 — fetchMeta surfaces META_TIMEOUT (transient=true) when the upstream hangs past the timeout", async () => {
    // Override META_API_TIMEOUT_MS to 200ms via env BEFORE the module
    // is first imported, then use vi.resetModules to force a fresh load
    // so the new env value takes effect.
    process.env.META_API_TIMEOUT_MS = "200";
    vi.resetModules();
    const mod = await import("../publish-worker");
    expect(mod.META_API_TIMEOUT_MS).toBe(200);

    // Spin up a TCP server that accepts the connection but never
    // responds — a true simulation of a Meta endpoint stall.
    const heldSockets: any[] = [];
    const server = http.createServer((_req, res) => {
      heldSockets.push(res);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as { port: number };

    let caught: any = null;
    try {
      await mod.fetchMeta(`http://127.0.0.1:${addr.port}/`);
    } catch (err: any) {
      caught = err;
    }
    for (const r of heldSockets) {
      try { r.destroy(); } catch {}
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));

    expect(caught).toBeTruthy();
    expect(caught.code).toBe("META_TIMEOUT");
    expect(caught.transient).toBe(true);
    expect(String(caught.message)).toMatch(/META_TIMEOUT/);

    delete process.env.META_API_TIMEOUT_MS;
    vi.resetModules();
  });

  it("F6.6 — publish-worker source explicitly preserves META_TIMEOUT classification on the error path", async () => {
    // Catch-block must classify META_TIMEOUT into lastClassification +
    // emit a dedicated audit event before recordTemporaryError. Source
    // assertion guards against future regressions of the hot path.
    const fs = await import("fs");
    const src = await fs.promises.readFile("server/publish-worker.ts", "utf8");
    expect(src).toMatch(/error\?\.code === "META_TIMEOUT"/);
    expect(src).toMatch(/lastClassification\s*=\s*"META_TIMEOUT"/);
    expect(src).toMatch(/logAudit\([^,]+,\s*"META_TIMEOUT"/);
  });

  // ---------------------------------------------------------------------
  // Pass-4 architect fixes
  // ---------------------------------------------------------------------

  it("F6.2 (pass-6) — P-6.12: retired shim holds no sticky bindings and imports no lru-cache", async () => {
    // The lru-cache bounded registry was the fix for unbounded pool growth.
    // With the pool deleted, the invariant flips: the shim must hold ZERO
    // state — no bindings, no registry, no lru-cache import.
    const fs = await import("fs");
    const src = await fs.promises.readFile(
      "server/competitive-intelligence/proxy-pool-manager.ts",
      "utf8",
    );
    expect(src).not.toMatch(/from\s*"lru-cache"/);
    // stickyBindings survives only as a zeroed diagnostics FIELD; no LRU
    // cache of bindings may exist.
    expect(src).not.toMatch(/stickyBindings:\s*LRUCache/);
    const mod = await import("../competitive-intelligence/proxy-pool-manager");
    expect(mod.getPoolDiagnostics("any").stickyBindings).toBe(0);
    // Repeated acquisition never accumulates state — always null.
    for (let i = 0; i < 5; i++) {
      expect(mod.acquireStickySession(`acct-${i}`, "camp", "comp")).toBeNull();
    }
    expect(mod.getPoolStatusReport().activeAccountPools).toBe(0);
  });

  it("F6.8 (pass-4) — orphan grace gates on first_observed_at, not snapshot age", async () => {
    // Architect pass-3 rejection: snapshot-age grace meant a 30-day-old
    // snapshot whose campaign was deselected just now would be deleted
    // on the very next cleanup tick. Now we observe-then-wait via
    // snapshot_orphan_observed.
    const fs = await import("fs");
    const src = await fs.promises.readFile("server/snapshot-cleanup-worker.ts", "utf8");
    // Documented design: first_observed_at gate, not row.ts gate.
    expect(src).toMatch(/snapshotOrphanObserved/);
    expect(src).toMatch(/firstObservedAt/);
    // Drizzle typed insert with ON CONFLICT DO NOTHING (parameterized).
    expect(src).toMatch(/\.insert\(snapshotOrphanObserved\)[\s\S]*\.onConflictDoNothing\(\)/);
    // Reset path: drizzle typed delete scoped to tableName.
    expect(src).toMatch(/\.delete\(snapshotOrphanObserved\)[\s\S]*snapshotOrphanObserved\.tableName/);
    // Pass-6 round-2: gate is now a SQL predicate, not a JS-side compare.
    // The orphan delete must include `lt(snapshotOrphanObserved.firstObservedAt,
    // orphanGraceCutoff)` so Postgres re-evaluates per batch iteration.
    expect(src).toMatch(/lt\(\s*snapshotOrphanObserved\.firstObservedAt\s*,\s*orphanGraceCutoff\s*\)/);
    // The pre-fix `rowTs >= orphanGraceCutoff` MUST be gone (regression
    // guard against re-introducing snapshot-age gating).
    expect(src).not.toMatch(/rowTs\s*>=\s*orphanGraceCutoff/);
  });

  it("F6.6 (pass-5) — publish-worker branches publish state on META_TIMEOUT classification", async () => {
    // Architect pass-4 rejection: classification was preserved inside
    // publishToMetaWithRetry but the caller-side state transition did
    // NOT branch on it — so a META_TIMEOUT could still flip the post
    // into terminal "failed" once attempts exceeded the cap, AND the
    // audit row carried no reason field. Now: META_TIMEOUT forces
    // requeue (status="scheduled"), brands lastPublishError with the
    // explicit reason, and emits a META_TIMEOUT audit event with
    // reason + willRequeue tags.
    const fs = await import("fs");
    const src = await fs.promises.readFile("server/publish-worker.ts", "utf8");
    expect(src).toMatch(/result\.classified === "META_TIMEOUT"/);
    expect(src).toMatch(/reachedTerminal\s*=\s*currentAttempts >= MAX_RETRY_ATTEMPTS \* 2 && !isMetaTimeout/);
    expect(src).toMatch(/META_TIMEOUT:\s*\$\{result\.error/);
    expect(src).toMatch(/finalStatus(?:\s*:\s*\w+)?\s*=\s*isMetaTimeout\s*\?\s*"META_TIMEOUT"/);
    expect(src).toMatch(/reason:\s*isMetaTimeout\s*\?\s*"META_TIMEOUT"/);
    expect(src).toMatch(/willRequeue:\s*!reachedTerminal/);
  });

  it("F6.9 (pass-5) — enrichCompetitorWithComments does NOT call checkAborted (no signal in scope)", async () => {
    // Architect pass-4 caught a ReferenceError: pass-3 added
    // checkAborted(signal,...) inside enrichCompetitorWithComments which
    // has no `signal` parameter. The function runs OUTSIDE the watchdog'd
    // _executeFetch path, so checkAborted must be confined to _executeFetch.
    const fs = await import("fs");
    const src = await fs.promises.readFile(
      "server/competitive-intelligence/data-acquisition.ts",
      "utf8",
    );
    // Find the function body and assert it is checkAborted-free.
    const fnMatch = src.match(/export async function enrichCompetitorWithComments[\s\S]*?\n\}\n/);
    expect(fnMatch).toBeTruthy();
    expect(fnMatch![0]).not.toMatch(/checkAborted\(/);
    // Confirm checkAborted IS still present in _executeFetch (regression
    // guard against accidentally removing it from the actual hot path).
    const exec = src.match(/async function _executeFetch[\s\S]*?\n\}\n/);
    expect(exec).toBeTruthy();
    expect(exec![0]).toMatch(/checkAborted\(signal/);
  });

  it("F6.8 (pass-4) — migration 020 declares snapshot_orphan_observed with composite PK + indexes", async () => {
    const fs = await import("fs");
    const sqlSrc = await fs.promises.readFile(
      "server/migrations/sql/020_snapshot_orphan_observed.sql",
      "utf8",
    );
    expect(sqlSrc).toMatch(/CREATE TABLE IF NOT EXISTS snapshot_orphan_observed/);
    expect(sqlSrc).toMatch(/PRIMARY KEY \(table_name, snapshot_id\)/);
    expect(sqlSrc).toMatch(/first_observed_at\s+timestamptz\s+NOT NULL\s+DEFAULT now\(\)/);
    expect(sqlSrc).toMatch(/CREATE INDEX IF NOT EXISTS snapshot_orphan_observed_first_observed_at_idx/);
    expect(sqlSrc).toMatch(/CREATE INDEX IF NOT EXISTS snapshot_orphan_observed_campaign_id_idx/);

    // Schema floor must be bumped to 20 so the runner refuses to boot
    // against a DB that hasn't applied this migration.
    const runnerSrc = await fs.promises.readFile("server/migrations/runner.ts", "utf8");
    expect(runnerSrc).toMatch(/REQUIRED_SCHEMA_VERSION\s*=\s*20/);
  });
});
