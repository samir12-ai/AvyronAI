/**
 * ─────────────────────────────────────────────────────────────────────────────
 * W1-T4 (P0-4) — body/params campaignId tenant-isolation regression suite.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Two layers:
 *   1. Source-pattern tripwire — for every enumerated body/params consumer
 *      route, assert it either calls `assertCampaignBelongsTo`, the
 *      `requireCampaign` middleware, or implements an equivalent inline
 *      ownership check. Catches accidental deletion of the guard.
 *   2. Behavioral-helper proof — exercise `assertCampaignBelongsTo` directly
 *      with a mocked `db` to prove cross-tenant rejection semantics.
 *
 * Background: W0-T1 verified `requireCampaign` enforces ownership on the
 * `?campaignId` query-string surface. The body/params surface is a separate
 * authorization surface that this task seals via per-handler explicit
 * `assertCampaignBelongsTo()` calls (or layered defenses where present).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "..", "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8");

/**
 * Manifest of every body/params/query campaignId-bearing handler that is
 * reachable from the public API surface. Each entry asserts the file
 * contains either `assertCampaignBelongsTo` or `requireCampaign` (middleware
 * mount) or, for the orchestrator/run path, an inline raw-SQL ownership
 * check.
 */
const OWNERSHIP_GUARDED_FILES: Array<{ file: string; mustContain: string[] }> = [
  // P0-4 enumerated:
  { file: "server/routes.ts",                              mustContain: ["assertCampaignBelongsTo"] },
  { file: "server/agent/routes.ts",                        mustContain: ["assertCampaignBelongsTo"] },
  { file: "server/audience-engine/routes.ts",              mustContain: ["assertCampaignBelongsTo"] },
  { file: "server/market-intelligence-v3/routes.ts",       mustContain: ["assertCampaignBelongsTo"] },
  { file: "server/competitive-intelligence/competitor-routes.ts", mustContain: ["assertCampaignBelongsTo"] },
  // F3 manifest (W0-T1):
  { file: "server/orchestrator/routes.ts",                 mustContain: ["assertCampaignBelongsTo"] }, // W5: migrated from raw-SQL to centralized helper
  { file: "server/goal-math.ts",                           mustContain: ["assertCampaignBelongsTo"] },
  { file: "server/exploration-budget/routes.ts",           mustContain: ["assertCampaignBelongsTo"] },
  { file: "server/system-integrity/routes.ts",             mustContain: ["assertCampaignBelongsTo"] },
  { file: "server/content-dna-routes.ts",                  mustContain: ["requireCampaign"] }, // mounted middleware
  { file: "server/task-composer.ts",                       mustContain: ["accountId", "campaignId"] }, // self-enforced via WHERE clauses
];

describe("W1-T4 — body/params campaignId ownership: source-pattern tripwire", () => {
  for (const { file, mustContain } of OWNERSHIP_GUARDED_FILES) {
    it(`${file} contains required ownership token(s): ${mustContain.join(", ")}`, () => {
      const src = read(file);
      for (const token of mustContain) {
        expect(src).toContain(token);
      }
    });
  }

  it("auth-helpers.ts still defines assertCampaignBelongsTo with WHERE accountId AND selectedCampaignId", () => {
    const src = read("server/auth-helpers.ts");
    expect(src).toContain("export async function assertCampaignBelongsTo");
    expect(src).toMatch(/eq\(campaignSelections\.accountId,\s*accountId\)/);
    expect(src).toMatch(/eq\(campaignSelections\.selectedCampaignId,\s*campaignId\)/);
  });

  it("CampaignOwnershipError uses 404 (never 403) so existence is not confirmed", () => {
    const src = read("server/auth-helpers.ts");
    expect(src).toMatch(/status\s*=\s*404/);
    expect(src).toContain('code = "CAMPAIGN_NOT_FOUND"');
  });
});

// ─── Behavioral proofs (mocked db) ────────────────────────────────────────────
const dbState: { rows: any[] } = { rows: [] };

vi.mock("../db", () => {
  const chain: any = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: async () => dbState.rows,
  };
  return { db: chain };
});

const { assertCampaignBelongsTo, CampaignOwnershipError, handleOwnershipError } = await import("../auth-helpers");

describe("W1-T4 — assertCampaignBelongsTo behavioral proofs", () => {
  beforeEach(() => { dbState.rows = []; });

  it("throws CampaignOwnershipError when campaign does not belong to account", async () => {
    dbState.rows = []; // no row matches (accountId, campaignId)
    await expect(assertCampaignBelongsTo("tenant-A", "tenant-B-camp-999"))
      .rejects.toBeInstanceOf(CampaignOwnershipError);
  });

  it("error has status=404 and code=CAMPAIGN_NOT_FOUND", async () => {
    dbState.rows = [];
    try {
      await assertCampaignBelongsTo("tenant-A", "tenant-B-camp-999");
      throw new Error("should have thrown");
    } catch (err: any) {
      expect(err).toBeInstanceOf(CampaignOwnershipError);
      expect(err.status).toBe(404);
      expect(err.code).toBe("CAMPAIGN_NOT_FOUND");
    }
  });

  it("does NOT throw when campaign belongs to account (row found)", async () => {
    dbState.rows = [{ id: "sel-1" }];
    await expect(assertCampaignBelongsTo("tenant-A", "camp-A-1")).resolves.toBeUndefined();
  });

  it("rejects empty accountId", async () => {
    await expect(assertCampaignBelongsTo("", "any")).rejects.toBeInstanceOf(CampaignOwnershipError);
  });

  it("rejects empty campaignId", async () => {
    await expect(assertCampaignBelongsTo("tenant-A", "")).rejects.toBeInstanceOf(CampaignOwnershipError);
  });

  it("handleOwnershipError writes 404 JSON and returns true on CampaignOwnershipError", () => {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const res: any = { status };
    const err = new CampaignOwnershipError("tenant-A", "foreign");
    expect(handleOwnershipError(err, res)).toBe(true);
    expect(status).toHaveBeenCalledWith(404);
    const body = json.mock.calls[0][0];
    expect(body.error).toBe("CAMPAIGN_NOT_FOUND");
    // P3 isolation seal: response intentionally omits the campaignId/accountId
    expect(JSON.stringify(body)).not.toContain("foreign");
    expect(JSON.stringify(body)).not.toContain("tenant-A");
  });

  it("handleOwnershipError returns false (passthrough) on unrelated error", () => {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const res: any = { status };
    expect(handleOwnershipError(new Error("something else"), res)).toBe(false);
    expect(status).not.toHaveBeenCalled();
  });
});
