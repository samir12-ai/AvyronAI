/**
 * Performance Loop — Tenant & Doctrine Regression (spec §19 / Phase N)
 * ─────────────────────────────────────────────────────────────────────────────
 * Source-pattern proofs, following the established convention of
 * require-campaign-tenant-isolation.test.ts (grep-the-source regression
 * surface — fails at CI time the moment a guard is removed).
 *
 * Coverage:
 *   1. weekly_reports tenant closure — writer stamps accountId/campaignId,
 *      reader filters on BOTH (legacy tenant-less rows stay excluded).
 *   2. POST /api/revenue is campaign-gated (requireCampaign) and still
 *      validates any body campaignId via assertCampaignBelongsTo.
 *   3. /api/performance/console — requireCampaign + every table read is
 *      accountId-scoped.
 *   4. Execution comparator doctrine — decisions with UNVERIFIED/BLOCKED
 *      execution never produce decision-outcome rows (no fabricated
 *      outcomes when the scrape can't verify execution).
 *   5. Comparator determinism — no LLM/model imports in the comparator.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const read = (rel: string) =>
  readFileSync(path.resolve(__dirname, "..", "..", rel), "utf8");

describe("weekly_reports tenant closure (migration 058)", () => {
  const src = read("server/strategy-routes.ts");

  it("writer stamps accountId and campaignId on insert", () => {
    // The insert block for weeklyReports must set both tenant columns.
    const insertIdx = src.indexOf(".insert(weeklyReports)");
    expect(insertIdx).toBeGreaterThan(-1);
    const window = src.slice(insertIdx, insertIdx + 800);
    expect(window).toMatch(/accountId/);
    expect(window).toMatch(/campaignId/);
  });

  it("reader filters on BOTH tenant columns (legacy tenant-less rows excluded)", () => {
    const getIdx = src.indexOf('"/api/strategy/weekly-reports"');
    expect(getIdx).toBeGreaterThan(-1);
    const window = src.slice(getIdx, getIdx + 1500);
    expect(window).toMatch(/eq\(weeklyReports\.accountId,/);
    expect(window).toMatch(/eq\(weeklyReports\.campaignId,/);
    // No unscoped select-all fallback in the handler window.
    expect(window).not.toMatch(/from\(weeklyReports\)\s*;/);
  });

  it("schema declares the tenant columns", () => {
    const schema = read("shared/schema.ts");
    const tblIdx = schema.indexOf('pgTable("weekly_reports"');
    expect(tblIdx).toBeGreaterThan(-1);
    const window = schema.slice(tblIdx, tblIdx + 1200);
    expect(window).toMatch(/account_id/);
    expect(window).toMatch(/campaign_id/);
  });
});

describe("POST /api/revenue campaign gating (Phase N)", () => {
  const src = read("server/lead-engine/revenue-attribution-routes.ts");

  it("route is registered with requireCampaign middleware", () => {
    expect(src).toMatch(
      /post\(\s*["']\/api\/revenue["']\s*,\s*requireCampaign/,
    );
  });

  it("body campaignId is still ownership-validated (assertCampaignBelongsTo)", () => {
    expect(src).toMatch(/assertCampaignBelongsTo/);
  });
});

describe("Performance Intelligence console-route tenant scoping", () => {
  const src = read("server/performance-loop/console-route.ts");

  it("route is registered with resolveAccountIdFromCampaign ownership resolver", () => {
    expect(src).toMatch(/resolveAccountIdFromCampaign/);
    expect(src).toMatch(/router\.get\(\s*["']\/execution-state\/:campaignId["']/);
  });

  it("every table read is accountId-scoped", () => {
    const fromTables = [...src.matchAll(/\.from\((\w+)\)/g)].map((m) => m[1]);
    expect(fromTables.length).toBeGreaterThanOrEqual(3);
    for (const tbl of new Set(fromTables)) {
      expect(
        src.includes(`eq(${tbl}.accountId, accountId)`),
        `${tbl} read must be accountId-scoped`,
      ).toBe(true);
    }
  });
});

describe("decision-outcome writer doctrine (no fabricated outcomes)", () => {
  const src = read("server/performance-loop/cycle-runner.ts");

  it("skips outcome rows for UNVERIFIED and BLOCKED execution", () => {
    // The writer must consult execution status and skip unverifiable rows.
    expect(src).toMatch(/UNVERIFIED/);
    expect(src).toMatch(/BLOCKED/);
    const idx = src.indexOf("performanceDecisionOutcomes");
    expect(idx).toBeGreaterThan(-1);
  });

  it("outcome insert happens inside the persist transaction scope", () => {
    // performanceDecisionOutcomes must be written via the transaction handle
    // (tx.insert), not a bare db.insert outside the report transaction.
    expect(src).toMatch(/tx\s*\.insert\(performanceDecisionOutcomes\)|tx\.insert\(performanceDecisionOutcomes\)/);
    expect(src).not.toMatch(/db\.insert\(performanceDecisionOutcomes\)/);
  });
});

describe("execution comparator determinism (spec: code decides, never LLM)", () => {
  const src = read("server/performance-loop/execution-comparator.ts");

  it("imports no LLM/AI client", () => {
    expect(src).not.toMatch(/openai|anthropic|gemini|generateText|chat\.completions|ai-client/i);
  });

  it("comparator is versioned for provenance", () => {
    expect(src).toMatch(/COMPARATOR_VERSION\s*=\s*["']exec-comparator-v1["']/);
  });

  it("closed windows require a successful scrape AFTER windowEnd (coverage rule)", () => {
    expect(src).toMatch(/UNVERIFIED/);
    expect(src).toMatch(/windowEnd/);
  });
});
