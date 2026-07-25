/**
 * W0-T1 (launch-closure) — requireCampaign Tenant Isolation Regression
 * ─────────────────────────────────────────────────────────────────────────────
 * Source-pattern proofs for the cross-tenant ownership gate at
 * server/campaign-routes.ts :: requireCampaign().
 *
 * Why source-pattern (not HTTP) tests:
 * The existing test suite (memory-scoping, cache-isolation) standardizes on
 * grep-the-source proofs because the project does not have an HTTP test
 * harness with seeded multi-tenant fixtures. Source patterns are the
 * authoritative regression surface here — they fail at CI time the moment
 * someone re-introduces the silent-fallback bug or removes the ownership
 * filter.
 *
 * Coverage:
 *   1. Ownership filter present on the requested-campaign branch.
 *   2. Silent-substitution path is gone (no fallback when caller supplied
 *      a foreign campaignId).
 *   3. Foreign campaignId → 404 CAMPAIGN_NOT_FOUND + structured log
 *      (W5 normalization to anti-enumeration policy).
 *   4. Convenience fallback ONLY runs when no campaignId was requested.
 *   5. Body/params campaignId consumers (out of scope for this middleware)
 *      are enumerated so W1-T4 can prove each one.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// ─── Behavioral test setup ────────────────────────────────────────────────────
// Mock the DB and auth modules BEFORE importing the middleware so the
// middleware closes over our stubs. The Drizzle chain is the
// `select().from().where().orderBy().limit()` shape.

const dbState: { rows: any[] } = { rows: [] };
const authState: { accountId: string | null; throwError: Error | null } = {
  accountId: "tenant-A",
  throwError: null,
};

function makeChain() {
  const chain: any = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: async () => dbState.rows,
  };
  // limit() needs to be the awaited terminal — but other methods return chain
  // synchronously. The middleware does `await db.select().from().where().limit(1)`
  // and `await db.select().from().where().orderBy().limit(1)`. Both terminate
  // at limit(), which we make a thenable.
  return chain;
}

vi.mock("../db", () => ({ db: makeChain() }));

vi.mock("../auth", async () => {
  // Re-export the real AuthConfigurationError so `instanceof` and `.status` work.
  const actual = await vi.importActual<any>("../auth");
  return {
    ...actual,
    resolveAccountId: (_req: any) => {
      if (authState.throwError) throw authState.throwError;
      if (!authState.accountId) {
        throw new actual.AuthConfigurationError(
          "Authentication required: no account context found on request."
        );
      }
      return authState.accountId;
    },
  };
});

// Import AFTER the mocks above so the middleware closes over the stubs.
const { requireCampaign } = await import("../campaign-routes");

function makeReqRes(query: Record<string, string> = {}, accountId: string | null = "tenant-A") {
  authState.accountId = accountId;
  authState.throwError = null;
  const req: any = { query, accountId, path: "/api/test" };
  const json = vi.fn();
  const setHeader = vi.fn();
  const status = vi.fn(() => res);
  const res: any = { status, json, setHeader };
  const next = vi.fn();
  return { req, res, next, status, json };
}

const ROOT = path.resolve(__dirname, "..", "..");
const CAMPAIGN_ROUTES = readFileSync(path.join(ROOT, "server/campaign-routes.ts"), "utf-8");

function sliceRequireCampaign(): string {
  const start = CAMPAIGN_ROUTES.indexOf("export async function requireCampaign(");
  expect(start).toBeGreaterThan(-1);
  // grab the next ~100 lines — middleware is ~75 lines
  return CAMPAIGN_ROUTES.slice(start, start + 6000);
}

describe("W0-T1 — requireCampaign tenant-isolation gate", () => {
  const body = sliceRequireCampaign();

  it("F1: ownership query filters BOTH accountId AND requested campaignId", () => {
    // The eq(...accountId, accountId) AND eq(...selectedCampaignId, requestedCampaignId)
    // pair must appear inside the requested-campaign branch.
    expect(body).toMatch(/eq\(\s*campaignSelections\.accountId\s*,\s*accountId\s*\)/);
    expect(body).toMatch(/eq\(\s*campaignSelections\.selectedCampaignId\s*,\s*requestedCampaignId\s*\)/);
  });

  it("F2: silent-fallback gap is closed — foreign campaignId returns 404, not most-recent (W5 anti-enumeration)", () => {
    // W5 normalization: response code is now CAMPAIGN_NOT_FOUND (404) so a
    // non-owner can never distinguish "this id exists but isn't yours" from
    // "this id does not exist at all" — matches assertCampaignBelongsTo.
    expect(body).toContain('code: "CAMPAIGN_NOT_FOUND"');
    expect(body).toMatch(/return\s+res\.status\(404\)\.json\(\{\s*code:\s*"CAMPAIGN_NOT_FOUND"/);
    // Structured log must still accompany the rejection so cross-tenant
    // probing remains observable in production logs (internal observability
    // is decoupled from the public response).
    expect(body).toContain("CAMPAIGN_OWNERSHIP_REJECTED");
    // The legacy 403 CAMPAIGN_NOT_OWNED response code MUST NOT reappear.
    expect(body).not.toContain('code: "CAMPAIGN_NOT_OWNED"');
    expect(body).not.toMatch(/res\.status\(403\)\.json\(\{\s*code:\s*"CAMPAIGN_NOT_OWNED"/);
  });

  it("F2 (anti-regression): the fallback DB query for 'most-recent for this account' must NOT execute when a campaignId was requested", () => {
    // Structural proof: the most-recent fallback must be inside an `else`
    // branch of `if (requestedCampaignId)`, never a top-level fallthrough
    // that runs after the ownership-filtered SELECT.
    //
    // The post-patch shape is:
    //   if (requestedCampaignId) {
    //     selections = await db.select()...where(and(...accountId, ...selectedCampaignId))...
    //     if (selections.length === 0) { return 404 CAMPAIGN_NOT_FOUND; }
    //   } else {
    //     selections = await db.select()...where(eq(...accountId)).orderBy(desc(...selectedAt))...
    //   }
    //
    // We assert: the orderBy(desc(...selectedAt)) — the signature of the
    // "most-recent" fallback — must appear AFTER an `} else {` token, and
    // must NOT appear before the CAMPAIGN_NOT_FOUND return.
    const fallbackIdx = body.indexOf("orderBy(desc(campaignSelections.selectedAt))");
    const elseIdx = body.lastIndexOf("} else {", fallbackIdx);
    // W5: branch denial uses CAMPAIGN_NOT_FOUND code (anti-enumeration).
    const notFoundReturnIdx = body.search(/res\.status\(404\)\.json\(\{\s*code:\s*"CAMPAIGN_NOT_FOUND"/);
    expect(fallbackIdx).toBeGreaterThan(-1);
    expect(elseIdx).toBeGreaterThan(-1);
    expect(notFoundReturnIdx).toBeGreaterThan(-1);
    // else branch must wrap the fallback
    expect(elseIdx).toBeLessThan(fallbackIdx);
    // and the not-found return must come BEFORE the fallback (i.e. is in the
    // requestedCampaignId branch, not after it)
    expect(notFoundReturnIdx).toBeLessThan(fallbackIdx);
  });

  it("F4: error codes are distinct — CAMPAIGN_NOT_FOUND (foreign id, W5) vs CAMPAIGN_REQUIRED (no selection) vs CAMPAIGN_INVALID (paused/removed)", () => {
    expect(body).toContain('code: "CAMPAIGN_NOT_FOUND"');
    expect(body).toContain('code: "CAMPAIGN_REQUIRED"');
    expect(body).toContain('code: "CAMPAIGN_INVALID"');
  });

  it("auth gate: middleware calls resolveAccountId (401 propagation)", () => {
    expect(body).toMatch(/resolveAccountId\(req\)/);
  });
});

describe("W0-T1 — body/params campaignId consumers (out of scope for requireCampaign; W1-T4 must prove each)", () => {
  // This block is an executable manifest. If a new consumer is added that
  // reads campaignId from body/params, this enumeration MUST be updated AND
  // W1-T4 MUST add an ownership proof for it.
  const KNOWN_BODY_PARAMS_CONSUMERS = [
    "server/audience-engine/routes.ts",
    "server/market-intelligence-v3/routes.ts",
    "server/competitive-intelligence/competitor-routes.ts",
    "server/orchestrator/routes.ts",
    "server/task-composer.ts",
    "server/root-bundle.ts",
    "server/plan-gate.ts",
    "server/system-integrity/routes.ts",
    "server/exploration-budget/routes.ts",
    "server/content-dna-routes.ts",
    "server/goal-math.ts",
  ];

  it("known consumers list is non-empty and W1-T4 owns proving each", () => {
    expect(KNOWN_BODY_PARAMS_CONSUMERS.length).toBeGreaterThan(0);
    // Each file referenced must still exist; if a file was removed or
    // restructured, this list (and W1-T4) must be updated.
    for (const rel of KNOWN_BODY_PARAMS_CONSUMERS) {
      const full = path.join(ROOT, rel);
      expect(() => readFileSync(full, "utf-8")).not.toThrow();
    }
  });
});

// ─── Behavioral proofs (mocked req/res/db) ────────────────────────────────────
describe("W0-T1 — requireCampaign behavioral proofs", () => {
  beforeEach(() => {
    dbState.rows = [];
    authState.accountId = "tenant-A";
    authState.throwError = null;
  });

  it("foreign ?campaignId → 404 CAMPAIGN_NOT_FOUND, next() not called (W5 anti-enumeration)", async () => {
    // Ownership-filtered query returns 0 rows for a foreign campaignId.
    dbState.rows = [];
    const { req, res, next, status, json } = makeReqRes({ campaignId: "tenant-B-camp-999" });
    await requireCampaign(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(404);
    const body = json.mock.calls[0][0];
    expect(body.code).toBe("CAMPAIGN_NOT_FOUND");
    // Denial body MUST NOT echo back the attacker-supplied campaignId
    // (otherwise it becomes a reflected-id leak surface).
    expect(JSON.stringify(body)).not.toContain("tenant-B-camp-999");
  });

  it("no ?campaignId, latest selection exists → next() called with campaignContext populated", async () => {
    dbState.rows = [{
      selectedCampaignId: "camp-A-1",
      selectedCampaignName: "My Campaign",
      selectedPlatform: "meta",
      campaignGoalType: "LEADS",
      campaignStatus: "active",
      campaignLocation: null,
    }];
    const { req, res, next } = makeReqRes({});
    await requireCampaign(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.campaignContext).toBeDefined();
    expect(req.campaignContext.campaignId).toBe("camp-A-1");
    expect(req.campaignContext.accountId).toBe("tenant-A");
  });

  it("no ?campaignId, no selections → 400 CAMPAIGN_REQUIRED", async () => {
    dbState.rows = [];
    const { req, res, next, status, json } = makeReqRes({});
    await requireCampaign(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(400);
    expect(json.mock.calls[0][0].code).toBe("CAMPAIGN_REQUIRED");
  });

  it("paused selection → 400 CAMPAIGN_INVALID", async () => {
    dbState.rows = [{
      selectedCampaignId: "camp-A-1",
      selectedCampaignName: "Paused One",
      selectedPlatform: "meta",
      campaignStatus: "paused",
    }];
    const { req, res, next, status, json } = makeReqRes({});
    await requireCampaign(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(400);
    expect(json.mock.calls[0][0].code).toBe("CAMPAIGN_INVALID");
  });

  it("unscoped_legacy selectedCampaignId → 400 CAMPAIGN_INVALID", async () => {
    dbState.rows = [{
      selectedCampaignId: "unscoped_legacy",
      selectedCampaignName: "Legacy",
      campaignStatus: "active",
    }];
    const { req, res, next, status, json } = makeReqRes({});
    await requireCampaign(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(400);
    expect(json.mock.calls[0][0].code).toBe("CAMPAIGN_INVALID");
  });

  it("missing accountId on request → 401 AUTH_REQUIRED (auth-error propagation, not 500)", async () => {
    const { req, res, next, status, json } = makeReqRes({}, null);
    await requireCampaign(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
    expect(json.mock.calls[0][0].code).toBe("AUTH_REQUIRED");
  });

  it("supplied ?campaignId that IS owned → next() called with that exact campaignId (no silent substitution to a different campaign)", async () => {
    dbState.rows = [{
      selectedCampaignId: "camp-A-7",
      selectedCampaignName: "Requested",
      selectedPlatform: "meta",
      campaignStatus: "active",
    }];
    const { req, res, next } = makeReqRes({ campaignId: "camp-A-7" });
    await requireCampaign(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.campaignContext.campaignId).toBe("camp-A-7");
  });
});
