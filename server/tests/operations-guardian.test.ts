/**
 * Operations Guardian regression tests (Task #56).
 *
 * Locks in the two P1 fixes flagged by code review on the Steps 1–6
 * implementation, before any user-facing rollout (Step 7+) is allowed
 * to proceed:
 *
 *   P1 #1 — Centralized audience firewall enforcement
 *   ───────────────────────────────────────────────────
 *   audienceFirewallOk() must reject audience='user' for any category
 *   not present in USER_COPY (which is intentionally empty during the
 *   observe-only phase) AND reject INTERNAL_ONLY_CATEGORIES for any
 *   audience that isn't 'internal' or 'operator'. Both rejection paths
 *   must emit a [OperationsGuardian] AUDIENCE_FIREWALL_REJECT log line
 *   per Seal #15 (no silent catches).
 *
 *   P1 #2 — High-cardinality collector cap / false-resolve protection
 *   ──────────────────────────────────────────────────────────────────
 *   resolveStaleNotices() must only sweep notices whose category is in
 *   the fullyObservedCategories set. A category whose collector hit the
 *   hard cap (>= COLLECTOR_HARD_LIMIT) MUST NOT have its open notices
 *   resolved that tick — otherwise notices flap when load spikes above
 *   the cap.
 *
 * Style: Group A is pure-logic (no DB). Group B uses the real test DB
 * via the same convention as integrity.test.ts (test prefix + explicit
 * cleanup in afterAll). Multi-replica safe because every fixture key is
 * namespaced with `TEST_PREFIX` + a per-suite epoch.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { db } from "../db";
import { systemNotices } from "@shared/schema";
import { and, eq, like, sql } from "drizzle-orm";
import {
  _audienceFirewallOk,
  _resolveStaleNoticesForTest,
  _COLLECTOR_HARD_LIMIT,
  type _ClassifiedNoticeForTest as ClassifiedNotice,
} from "../operations-guardian/interpreter";
import {
  NOTICE_CATEGORIES,
  USER_COPY,
  INTERNAL_ONLY_CATEGORIES,
  type NoticeCategory,
} from "../operations-guardian/types";

// ─────────────────────────────────────────────────────────────────────
// Group A — Pure-logic firewall tests (no DB). Run fast.
// ─────────────────────────────────────────────────────────────────────

function makeNotice(over: Partial<ClassifiedNotice>): ClassifiedNotice {
  return {
    category: "WORKER_STUCK",
    severity: "warning",
    audience: "operator",
    correlationKey: "TEST:" + Math.random().toString(36).slice(2, 9),
    accountId: null,
    campaignId: null,
    copyKey: "operator.test",
    copyVars: {},
    detail: {},
    ...over,
  };
}

describe("Operations Guardian — P1 #1 audience firewall (pure logic)", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("admits operator audience for ordinary internal categories", () => {
    expect(
      _audienceFirewallOk(makeNotice({ category: "WORKER_STUCK", audience: "operator" })),
    ).toBe(true);
    expect(
      _audienceFirewallOk(makeNotice({ category: "RETRY_LOOP", audience: "operator" })),
    ).toBe(true);
    expect(
      _audienceFirewallOk(makeNotice({ category: "CHAIN_DEAD", audience: "operator" })),
    ).toBe(true);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("admits operator audience for INTERNAL_ONLY categories (operator is allowed)", () => {
    // LEAKED_LOCK is INTERNAL_ONLY but the firewall explicitly allows
    // 'internal' OR 'operator' for those categories — the rejection
    // only fires when the audience is neither.
    for (const category of INTERNAL_ONLY_CATEGORIES) {
      expect(
        _audienceFirewallOk(makeNotice({ category, audience: "operator" })),
      ).toBe(true);
      expect(
        _audienceFirewallOk(makeNotice({ category, audience: "internal" })),
      ).toBe(true);
    }
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("REJECTS audience='user' for every category — USER_COPY is empty during observe-only", () => {
    // This is the load-bearing assertion of the observe-only rollout:
    // until USER_COPY gains an entry (which requires copy review), no
    // category can ever produce a customer-visible notice. If this test
    // breaks because USER_COPY was modified, ensure the modification
    // went through the documented copy-review process.
    expect(Object.keys(USER_COPY)).toHaveLength(0);

    for (const category of NOTICE_CATEGORIES) {
      const result = _audienceFirewallOk(
        makeNotice({ category, audience: "user", correlationKey: `USER_TEST:${category}` }),
      );
      expect(result, `category=${category} must be rejected for user audience`).toBe(false);
    }

    // Every rejection must log via console.error with the canonical
    // [OperationsGuardian] tag (Seal #15 — no silent catches).
    expect(errorSpy).toHaveBeenCalled();
    const calls = errorSpy.mock.calls;
    expect(calls.length).toBe(NOTICE_CATEGORIES.length);
    for (const call of calls) {
      expect(String(call[0])).toContain("[OperationsGuardian] AUDIENCE_FIREWALL_REJECT");
      const ctx = call[1] as { reason: string; category: string; correlationKey: string };
      expect(ctx.reason).toBe("USER_AUDIENCE_WITHOUT_COPY");
      expect(NOTICE_CATEGORIES).toContain(ctx.category as NoticeCategory);
    }
  });

  it("admits user audience for a category once it enters USER_COPY (forward-compat proof)", () => {
    // Demonstrates the firewall actually USES canPromoteToUser instead
    // of blanket-rejecting. We monkey-patch USER_COPY for this single
    // assertion — if a future refactor inverts the firewall logic this
    // test fails immediately.
    const target: NoticeCategory = "AI_QUOTA_PRESSURE"; // currently never emitted
    const userCopyMap = USER_COPY as Record<string, unknown>;
    userCopyMap[target] = {
      titleKey: "test.title",
      bodyKey: "test.body",
      defaultTitle: "t",
      defaultBody: "b",
      defaultSeverity: "warning",
      vars: [],
    };
    try {
      expect(
        _audienceFirewallOk(
          makeNotice({ category: target, audience: "user", correlationKey: "USER_OK:1" }),
        ),
      ).toBe(true);
    } finally {
      delete userCopyMap[target];
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// Group B — DB-backed resolveStaleNotices behavior (P1 #2)
// ─────────────────────────────────────────────────────────────────────

const TEST_PREFIX = `og_test_${Date.now()}_`;
function k(suffix: string): string {
  return `${TEST_PREFIX}${suffix}`;
}

async function insertOpenNotice(
  category: NoticeCategory,
  correlationKey: string,
): Promise<string> {
  const rows = await db
    .insert(systemNotices)
    .values({
      category,
      severity: "warning",
      audience: "operator",
      correlationKey,
      accountId: null,
      campaignId: null,
      copyKey: "operator.test",
      copyVars: {},
      detail: {},
    })
    .returning({ id: systemNotices.id });
  return rows[0]!.id;
}

async function isResolved(id: string): Promise<boolean> {
  const r = await db
    .select({ resolvedAt: systemNotices.resolvedAt })
    .from(systemNotices)
    .where(eq(systemNotices.id, id))
    .limit(1);
  return r[0]?.resolvedAt != null;
}

describe("Operations Guardian — P1 #2 resolveStaleNotices (DB)", () => {
  beforeAll(async () => {
    // Defensive — wipe any prior test rows that may have leaked from a
    // crashed run with the same TEST_PREFIX (impossible given Date.now()
    // suffix, but cheap).
    await db
      .delete(systemNotices)
      .where(like(systemNotices.correlationKey, `${TEST_PREFIX}%`));
  });

  afterAll(async () => {
    await db
      .delete(systemNotices)
      .where(like(systemNotices.correlationKey, `${TEST_PREFIX}%`));
  });

  it("noop when fullyObservedCategories is empty", async () => {
    const id = await insertOpenNotice("WORKER_STUCK", k("noop_1"));
    const resolved = await _resolveStaleNoticesForTest(
      new Set<string>(),
      new Set<NoticeCategory>(),
      new Date(),
    );
    expect(resolved).toBe(0);
    expect(await isResolved(id)).toBe(false);
  });

  it("resolves a notice in a fully-observed category whose key was NOT observed", async () => {
    const id = await insertOpenNotice("WORKER_STUCK", k("stale_1"));
    const resolved = await _resolveStaleNoticesForTest(
      new Set<string>(["WORKER_STUCK:other-key-still-active"]),
      new Set<NoticeCategory>(["WORKER_STUCK"]),
      new Date(),
    );
    expect(resolved).toBeGreaterThanOrEqual(1);
    expect(await isResolved(id)).toBe(true);
  });

  it("does NOT resolve a notice whose key IS in observedKeys (still active)", async () => {
    const key = k("active_1");
    const id = await insertOpenNotice("RETRY_LOOP", key);
    const resolved = await _resolveStaleNoticesForTest(
      new Set<string>([key]),
      new Set<NoticeCategory>(["RETRY_LOOP"]),
      new Date(),
    );
    expect(resolved).toBe(0);
    expect(await isResolved(id)).toBe(false);
  });

  it("does NOT resolve notices in a partially-observed (capped) category — closes P1 #2", async () => {
    // The exact scenario the architect flagged: collector hit its cap,
    // so we don't know if this open notice is still active or stale.
    // Pre-fix: the notice would be resolved (false-resolve / flap).
    // Post-fix: the resolver skips the entire category for this tick.
    const id = await insertOpenNotice("WORKER_STUCK", k("capped_1"));
    const resolved = await _resolveStaleNoticesForTest(
      new Set<string>(["WORKER_STUCK:something-else"]),
      // Empty fully-observed set models "WORKER_STUCK collector was
      // capped this tick" — even though the notice's key is not in
      // observedKeys, it MUST survive.
      new Set<NoticeCategory>(),
      new Date(),
    );
    expect(resolved).toBe(0);
    expect(await isResolved(id)).toBe(false);
  });

  it("only resolves within fully-observed categories — leaves other categories untouched", async () => {
    const stuckId = await insertOpenNotice("WORKER_STUCK", k("mixed_stuck"));
    const retryId = await insertOpenNotice("RETRY_LOOP", k("mixed_retry"));
    const resolved = await _resolveStaleNoticesForTest(
      new Set<string>(),
      // Only WORKER_STUCK was fully observed this tick. RETRY_LOOP must
      // not be touched even though its key is also not in observedKeys.
      new Set<NoticeCategory>(["WORKER_STUCK"]),
      new Date(),
    );
    expect(resolved).toBeGreaterThanOrEqual(1);
    expect(await isResolved(stuckId)).toBe(true);
    expect(await isResolved(retryId)).toBe(false);
  });

  it("once resolved, a recurrence inserts a fresh row (partial unique index recurrence)", async () => {
    const key = k("recur_1");
    const firstId = await insertOpenNotice("CHAIN_DEGRADED", key);
    // Resolve it.
    await _resolveStaleNoticesForTest(
      new Set<string>(),
      new Set<NoticeCategory>(["CHAIN_DEGRADED"]),
      new Date(),
    );
    expect(await isResolved(firstId)).toBe(true);
    // Now reinsert the same correlation_key — the partial unique index
    // (WHERE resolved_at IS NULL) should permit it because the prior
    // row is no longer in the unique slot.
    const secondId = await insertOpenNotice("CHAIN_DEGRADED", key);
    expect(secondId).not.toBe(firstId);
    expect(await isResolved(secondId)).toBe(false);
  });

  it("COLLECTOR_HARD_LIMIT is set well above realistic steady-state", () => {
    // Sanity check on the constant the resolver relies on. If a future
    // refactor lowers this back to 50 the false-resolve protection
    // weakens — make that decision deliberately, not by accident.
    expect(_COLLECTOR_HARD_LIMIT).toBeGreaterThanOrEqual(500);
  });
});
