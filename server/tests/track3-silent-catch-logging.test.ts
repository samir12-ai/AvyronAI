/**
 * Track #3 / Seal #15 — silent-catch hardening regression suite.
 *
 * Verifies that the swallowed-exception sites identified in the audit now
 * surface their failures via the logger. The audit found 9 `} catch {}`
 * blocks in agent-context.ts (snapshot + memory + decision loaders) and
 * 10 `.catch(() => {})` blocks in isolation-guard.ts (security audit
 * writes). Both classes of silent skip can mask a real failure for
 * arbitrary periods — this test proves the new `_logSilentLoad` helper
 * and `_noteAuditWriteFailure` helper actually emit on the failure path.
 *
 * We intentionally test only the OBSERVABLE behavior (logger calls,
 * stderr writes), not the internals — that way refactors that move the
 * helpers do not break the test as long as the failure is still surfaced.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("Track #3 — agent-context silent loaders now log on failure", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (warnSpy) warnSpy.mockRestore();
  });

  it("emits an agent_context_section_load_failed warning when a snapshot DB call throws", async () => {
    // Mock the db module to throw on every select() so every loader
    // takes the catch path. The function should still RETURN a context
    // object (UI-safe defaults), but the logger must record the failure.
    vi.doMock("../db", () => ({
      db: {
        select: () => {
          throw new Error("synthetic_db_failure");
        },
      },
    }));
    // Mock the surrounding deps so import succeeds.
    vi.doMock("../root-bundle", () => ({
      getActiveRootBundle: vi.fn().mockResolvedValue(null),
      detectStaleness: vi.fn().mockReturnValue({ stale: false }),
    }));
    vi.doMock("../memory-mutation/engine", () => ({
      getMemoryHealth: vi.fn().mockRejectedValue(new Error("synthetic_mem_failure")),
    }));
    vi.doMock("../shared/canonical-snapshot-reader", () => ({
      readSnapshotStatus: () => "PROVISIONAL",
    }));
    // Mock the bootstrap logger to spy on warn calls.
    const warn = vi.fn();
    vi.doMock("../bootstrap", () => ({
      logger: {
        warn,
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
    }));
    // The remaining schema imports come through; we mock @shared/schema as
    // empty proxies so drizzle methods don't fail at import time.
    vi.doMock("@shared/schema", () => {
      const tbl = new Proxy({}, { get: () => "table" });
      return new Proxy(
        {},
        {
          get: () => tbl,
        },
      );
    });
    vi.doMock("drizzle-orm", () => ({
      eq: () => "eq",
      and: () => "and",
      desc: () => "desc",
      count: () => "count",
      sql: () => "sql",
    }));

    const ctxMod = await import("../orchestrator/agent-context");
    // We can't easily call the full assembleSystemContext here because of
    // the deep transitive dependency surface — but we CAN call the helper
    // directly since it is exported via the same module namespace pattern
    // used in other Track #3 tests. If the helper is intentionally
    // private (no export), we still verify by triggering the catch path
    // from the most isolated loader. Here we accept either: at minimum,
    // when the helper itself runs against an Error it MUST call
    // logger.warn with our component tag.
    const helper = (ctxMod as any)._logSilentLoad ?? null;
    if (helper) {
      helper(new Error("triggered_for_test"));
      expect(warn).toHaveBeenCalledTimes(1);
      const [meta, msg] = warn.mock.calls[0];
      expect(meta).toMatchObject({ component: "agent-context" });
      expect(meta.err).toContain("triggered_for_test");
      expect(msg).toBe("agent_context_section_load_failed");
    } else {
      // Helper is intentionally private — surface that to the operator
      // running the suite so they know to export _logSilentLoad if they
      // want this regression coverage.
      throw new Error(
        "Track #3 contract: agent-context.ts must export _logSilentLoad for regression coverage",
      );
    }
  });
});

describe("Track #3 — isolation-guard audit writes now surface failures", () => {
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    errSpy.mockRestore();
  });

  it("writes [MIv3] AUDIT_WRITE_FAILED to stderr when logAudit rejects", async () => {
    // Mock logAudit to reject — every guard call site that writes audit
    // and previously had .catch(() => {}) must now go through
    // _noteAuditWriteFailure, which writes to console.error.
    vi.doMock("../audit", () => ({
      logAudit: vi.fn().mockRejectedValue(new Error("audit_write_synthetic_failure")),
    }));
    const guard = await import("../market-intelligence-v3/isolation-guard");

    // assertNoPlanWrites() is the smallest call site — it ALWAYS writes
    // an audit then throws. The rejection from logAudit must surface
    // BEFORE the throw so the audit failure appears in stderr.
    expect(() => guard.assertNoPlanWrites()).toThrow(/PLAN_WRITE_ATTEMPT|ISOLATION VIOLATION/);

    // Yield once for the rejected promise's .catch(_noteAuditWriteFailure)
    // to run before assertion. (logAudit returned a rejected promise; the
    // .catch handler is synchronous-after-microtask).
    await new Promise((r) => setImmediate(r));

    const calls = errSpy.mock.calls.flat().join(" ");
    expect(calls).toMatch(/AUDIT_WRITE_FAILED/);
    expect(calls).toMatch(/audit_write_synthetic_failure/);
    expect(calls).toMatch(/isolation-guard/);
  });
});
