/**
 * Seal #4 (Task #22) — Orchestrator routes tenant-isolation + summary honesty
 * ─────────────────────────────────────────────────────────────────────────────
 * Closes 3 audit findings concentrated in `server/orchestrator/routes.ts`:
 *
 *   F2.1 (P0): Two raw-SQL reads against `mi_snapshots` filtered ONLY by
 *              `campaign_id`. The handler-boundary `assertCampaignBelongsTo`
 *              is the live ownership gate, but the SQL itself was tenant-
 *              blind, so any future refactor that moved/dropped the boundary
 *              assert would silently re-open cross-tenant disclosure.
 *              Fix: add `AND account_id = ${accountId}` to BOTH SELECTs.
 *
 *   F2.6     : `/api/engines/table-summary` fabricated `status: "COMPLETE"`
 *              from id-presence (`audience?.id ? "COMPLETE" : "—"`) and
 *              from an unspecified `exists` flag. A snapshot row with an id
 *              but no work → "COMPLETE" displayed in the dashboard.
 *              Fix: `summarizeStatus(snap)` helper. Status is ONLY COMPLETE
 *              when the engine itself emits the canonical string. Otherwise
 *              UNKNOWN + `_provenance.degraded: true`.
 *
 *   F2.2 D1  : `statusToField[item.status || ""]` semantic-fallback at L796.
 *              Fix: explicit `if (!item.status)` guard, `|| ""` removed,
 *              eslint-disable comment removed (D1 rule satisfied without
 *              an exception).
 *
 * Test strategy (matches the project standard set by
 * `require-campaign-tenant-isolation.test.ts` and the Seal #3 suites):
 *
 *   - Source-pattern proofs are authoritative for SQL shape + D1 doctrine
 *     (a regression at any future refactor will fail here at CI time).
 *   - Behavioral proofs cover the `summarizeStatus` helper directly via a
 *     module-level extraction so we can exercise every branch
 *     (canonical/UNKNOWN/MISSING/degraded) without an HTTP harness.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "..", "..");
const ROUTES_PATH = path.join(ROOT, "server/orchestrator/routes.ts");
const ROUTES_SRC = readFileSync(ROUTES_PATH, "utf-8");

// ─── F2.1 — Raw SQL must filter by account_id ────────────────────────────────
describe("Seal #4 F2.1 — mi_snapshots raw SQL is tenant-scoped", () => {
  // Both raw SELECTs against mi_snapshots MUST include `AND account_id =`.
  // We grep for every `FROM mi_snapshots` occurrence and assert each one
  // is followed (within ~400 chars) by an account_id filter. This is a
  // tripwire: a future hand-edit that drops the AND clause fails CI here.
  const occurrences: Array<{ start: number; ctx: string }> = [];
  let cursor = 0;
  while (true) {
    const idx = ROUTES_SRC.indexOf("FROM mi_snapshots", cursor);
    if (idx === -1) break;
    occurrences.push({ start: idx, ctx: ROUTES_SRC.slice(idx, idx + 400) });
    cursor = idx + 1;
  }

  it("locates the two known mi_snapshots reads (alarm if a third is added without proof)", () => {
    // If this number changes, the new reader MUST also be tenant-scoped
    // and a new assertion below MUST cover it. Failing here is the point.
    expect(occurrences.length).toBe(2);
  });

  it("EVERY mi_snapshots SELECT filters by account_id", () => {
    for (const occ of occurrences) {
      expect(
        occ.ctx,
        `mi_snapshots read at offset ${occ.start} is missing AND account_id filter`
      ).toMatch(/account_id\s*=\s*\$\{accountId\}/);
      expect(
        occ.ctx,
        `mi_snapshots read at offset ${occ.start} must AND the account_id with campaign_id, not OR`
      ).toMatch(/campaign_id\s*=\s*\$\{campaignId\}\s+AND\s+account_id\s*=\s*\$\{accountId\}/);
    }
  });

  it("both handlers resolve accountId AND assert ownership at the boundary BEFORE the raw SQL runs", () => {
    // Defense in depth: SQL filter + boundary assert. The boundary assert
    // guarantees a wrong tenant gets a 404 (no information disclosure even
    // if the SQL returns 0 rows for some other reason).
    const summariesHandler = ROUTES_SRC.slice(
      ROUTES_SRC.indexOf('app.get("/api/orchestrator/summaries/:campaignId"'),
      ROUTES_SRC.indexOf('app.get("/api/engines/table-summary"')
    );
    expect(summariesHandler).toMatch(/const accountId = resolveAccountId\(req\)/);
    expect(summariesHandler).toMatch(/assertCampaignBelongsTo\(accountId, campaignId\)/);

    const tableSummaryStart = ROUTES_SRC.indexOf('app.get("/api/engines/table-summary"');
    const tableSummaryHandler = ROUTES_SRC.slice(tableSummaryStart, tableSummaryStart + 4000);
    expect(tableSummaryHandler).toMatch(/const accountId = resolveAccountId\(req\)/);
    expect(tableSummaryHandler).toMatch(/assertCampaignBelongsTo\(accountId, campaignId\)/);
  });

  it("a future edit that re-introduces a tenant-blind mi_snapshots SELECT fails this suite", () => {
    // Negative tripwire: assert no `WHERE campaign_id = ${campaignId}` line
    // exists WITHOUT the account_id filter on the same statement.
    // Walk every `WHERE campaign_id = ${campaignId}` and confirm the next
    // ~120 chars contain `account_id`.
    let p = 0;
    let blindCount = 0;
    while (true) {
      const i = ROUTES_SRC.indexOf("WHERE campaign_id = ${campaignId}", p);
      if (i === -1) break;
      const window = ROUTES_SRC.slice(i, i + 200);
      if (!/account_id/.test(window)) blindCount += 1;
      p = i + 1;
    }
    expect(blindCount, "tenant-blind WHERE campaign_id detected (re-introduces F2.1)").toBe(0);
  });
});

// ─── F2.6 — Snapshot summary no longer fabricates COMPLETE ───────────────────
describe("Seal #4 F2.6 — table-summary status honesty (no fabrication)", () => {
  it("the prior fabrication patterns are gone from the file", () => {
    // The exact substrings that fabricated COMPLETE from id/exists presence.
    expect(ROUTES_SRC).not.toContain('audience?.id ? "COMPLETE"');
    expect(ROUTES_SRC).not.toContain('positioning?.id ? "COMPLETE"');
    expect(ROUTES_SRC).not.toContain('mechanism?.exists ? "COMPLETE"');
    expect(ROUTES_SRC).not.toContain('awareness?.exists ? "COMPLETE"');
    expect(ROUTES_SRC).not.toContain('persuasion?.exists ? "COMPLETE"');
    expect(ROUTES_SRC).not.toContain('integrity?.exists ? "COMPLETE"');
    expect(ROUTES_SRC).not.toContain('statVal?.exists ? "COMPLETE"');
    expect(ROUTES_SRC).not.toContain('iteration?.exists ? "COMPLETE"');
  });

  it("the summarizeStatus helper exists and is the single source of truth for row.status", () => {
    expect(ROUTES_SRC).toMatch(/function summarizeStatus\(snap: any\)/);
    expect(ROUTES_SRC).toMatch(/function summarizeMiStatus\(row: any\)/);
    // Helper enforces the canonical 4-value enum; nothing else gets through.
    expect(ROUTES_SRC).toMatch(
      /raw === "COMPLETE" \|\| raw === "PARTIAL" \|\| raw === "UNKNOWN" \|\| raw === "MISSING"/
    );
  });

  it("every row in the table-summary `rows` array carries _provenance.degraded", () => {
    // Slice from `const rows = [` to `];` of the table-summary array. The
    // 15 engines × `_provenance: { degraded: ... }` lines must all be present.
    const rowsStart = ROUTES_SRC.indexOf("const rows = [", ROUTES_SRC.indexOf("summarizeStatus"));
    expect(rowsStart).toBeGreaterThan(-1);
    const rowsEnd = ROUTES_SRC.indexOf("];\n\n      res.json({ rows });", rowsStart);
    expect(rowsEnd).toBeGreaterThan(-1);
    const rowsBlock = ROUTES_SRC.slice(rowsStart, rowsEnd);
    const provenanceCount = (rowsBlock.match(/_provenance:\s*\{\s*degraded:/g) || []).length;
    // 15 engines (MI + 14 strategy/intelligence engines).
    expect(provenanceCount).toBe(15);
  });

  // Behavioral proof of the helper itself — extract its body via Function
  // constructor so we can exercise every branch without an HTTP harness.
  it("summarizeStatus returns MISSING for null/undefined", () => {
    const h = extractSummarizeStatus();
    expect(h(null)).toEqual({ status: "MISSING", degraded: false });
    expect(h(undefined)).toEqual({ status: "MISSING", degraded: false });
  });

  it("summarizeStatus returns the canonical status when the engine emits one", () => {
    const h = extractSummarizeStatus();
    expect(h({ status: "COMPLETE" })).toEqual({ status: "COMPLETE", degraded: false });
    expect(h({ status: "PARTIAL" })).toEqual({ status: "PARTIAL", degraded: false });
    expect(h({ status: "UNKNOWN" })).toEqual({ status: "UNKNOWN", degraded: false });
    expect(h({ status: "MISSING" })).toEqual({ status: "MISSING", degraded: false });
  });

  it("summarizeStatus returns UNKNOWN+degraded for a present-but-statusless snapshot (the fabrication-trigger case)", () => {
    const h = extractSummarizeStatus();
    // The OLD behaviour for these inputs was to LIE (display COMPLETE
    // because `id` was truthy). The NEW behaviour is to be honest.
    expect(h({ id: "abc-123" })).toEqual({ status: "UNKNOWN", degraded: true });
    expect(h({ exists: true })).toEqual({ status: "UNKNOWN", degraded: true });
    expect(h({ id: "x", exists: true, primaryRoute: { foo: 1 } })).toEqual({
      status: "UNKNOWN",
      degraded: true,
    });
  });

  it("summarizeStatus rejects non-canonical status strings (e.g. lowercase, garbled, legacy)", () => {
    const h = extractSummarizeStatus();
    expect(h({ status: "complete" })).toEqual({ status: "UNKNOWN", degraded: true });
    expect(h({ status: "DONE" })).toEqual({ status: "UNKNOWN", degraded: true });
    expect(h({ status: "" })).toEqual({ status: "UNKNOWN", degraded: true });
    expect(h({ status: 123 })).toEqual({ status: "UNKNOWN", degraded: true });
  });

  // Mirror coverage for summarizeMiStatus — separate helper because the MI
  // snapshot is a DB row, not an engine wrapper. If these two helpers ever
  // diverge accidentally (e.g. someone "optimizes" by sharing logic and
  // breaks one branch), this mirror suite fails.
  it("summarizeMiStatus mirrors summarizeStatus on every branch", () => {
    const mi = extractSummarizeMiStatus();
    expect(mi(null)).toEqual({ status: "MISSING", degraded: false });
    expect(mi(undefined)).toEqual({ status: "MISSING", degraded: false });
    expect(mi({ status: "COMPLETE" })).toEqual({ status: "COMPLETE", degraded: false });
    expect(mi({ status: "PARTIAL" })).toEqual({ status: "PARTIAL", degraded: false });
    expect(mi({ status: "UNKNOWN" })).toEqual({ status: "UNKNOWN", degraded: false });
    expect(mi({ status: "MISSING" })).toEqual({ status: "MISSING", degraded: false });
    // Row exists with no canonical status (e.g. legacy mi_snapshots row
    // pre-canonicalization) → UNKNOWN+degraded, NOT fabricated COMPLETE.
    expect(mi({ id: "x", overall_confidence: 0.7 })).toEqual({ status: "UNKNOWN", degraded: true });
    expect(mi({ status: "running" })).toEqual({ status: "UNKNOWN", degraded: true });
    expect(mi({ status: "" })).toEqual({ status: "UNKNOWN", degraded: true });
  });
});

// ─── F2.2 D1 — `statusToField[item.status || ""]` is gone ────────────────────
describe("Seal #4 F2.2 / D1 — studio status update has no semantic fallback", () => {
  it("the `|| \"\"` fallback on item.status is gone", () => {
    expect(ROUTES_SRC).not.toContain('statusToField[item.status || ""]');
  });

  it("an explicit presence ternary replaces the `|| \"\"` semantic fallback", () => {
    // D1 fix preserves original semantics EXACTLY: if item.status is missing,
    // the prior code computed `statusToField[""]` (undefined) and the
    // `if (oldField)` guard skipped only the OLD-status decrement; new-status
    // increment + PUBLISHED bookkeeping still ran. The ternary on a presence
    // boolean is D1-clean (it's a presence check, not `||`/`??` on a decision
    // input). An early-return that short-circuits the whole branch would be
    // a regression — assert it's NOT there.
    const studioHandlerStart = ROUTES_SRC.indexOf(
      'app.post("/api/studio/items/:itemId/status"'
    );
    expect(studioHandlerStart).toBeGreaterThan(-1);
    const studioHandler = ROUTES_SRC.slice(studioHandlerStart, studioHandlerStart + 4000);
    // The new oldField line uses a ternary on item.status presence.
    expect(studioHandler).toMatch(
      /const\s+oldField\s*=\s*item\.status\s*\?\s*statusToField\[item\.status\]\s*:\s*undefined/
    );
    // The bookkeeping branch must NOT short-circuit early — newField, the
    // increment, and the PUBLISHED total update must remain reachable.
    expect(studioHandler).toMatch(/const\s+newField\s*=\s*statusToField\[status\]/);
    expect(studioHandler).toMatch(/totalPublished/);
    // No early-return inside the `if (item.planId && ...)` bookkeeping
    // block — that would skip the new-status increment for statusless items.
    expect(studioHandler).not.toMatch(
      /if\s*\(\s*!item\.status\s*\)\s*\{\s*return\s+res\.json/
    );
    // The forbidden coalescing is gone.
    expect(studioHandler).not.toContain('item.status || ""');
  });

  it("the eslint-disable comment for this site has been removed (D1 rule passes naturally)", () => {
    // The previous code carried:
    //   // eslint-disable-next-line semantic/no-semantic-fallback -- G (H8): empty-string normalization for object-key lookup, not a decision input
    // After the fix, that exception is gone; D1 must pass without an
    // exemption on the studio bookkeeping site.
    const studioHandlerStart = ROUTES_SRC.indexOf(
      'app.post("/api/studio/items/:itemId/status"'
    );
    const studioHandler = ROUTES_SRC.slice(studioHandlerStart, studioHandlerStart + 4000);
    expect(studioHandler).not.toMatch(/eslint-disable-next-line\s+semantic\/no-semantic-fallback/);
  });
});

// ─── helpers ─────────────────────────────────────────────────────────────────
/**
 * Extracts the `summarizeStatus` helper body from the routes source and
 * compiles it into a callable function. This lets us behaviorally exercise
 * EVERY branch without bringing up the Express stack — the helper is pure,
 * dependency-free TypeScript that survives a `Function` round-trip after a
 * one-line type-cast strip.
 */
function extractHelper(
  signature: string,
  paramName: string
): (arg: any) => { status: string; degraded: boolean } {
  const sigStart = ROUTES_SRC.indexOf(signature);
  expect(sigStart, `helper signature must match exactly: ${signature}`).toBeGreaterThan(-1);
  const bodyStart = sigStart + signature.length - 1; // body's opening `{`
  let depth = 0;
  let i = bodyStart;
  for (; i < ROUTES_SRC.length; i += 1) {
    const ch = ROUTES_SRC[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  const body = ROUTES_SRC.slice(bodyStart + 1, i);
  const jsBody = body.replace(/as\s+CanonStatus/g, "");
  // eslint-disable-next-line no-new-func
  return new Function(paramName, jsBody) as any;
}

function extractSummarizeStatus(): (snap: any) => { status: string; degraded: boolean } {
  return extractHelper(
    "function summarizeStatus(snap: any): { status: CanonStatus; degraded: boolean } {",
    "snap"
  );
}

function extractSummarizeMiStatus(): (row: any) => { status: string; degraded: boolean } {
  return extractHelper(
    "function summarizeMiStatus(row: any): { status: CanonStatus; degraded: boolean } {",
    "row"
  );
}
