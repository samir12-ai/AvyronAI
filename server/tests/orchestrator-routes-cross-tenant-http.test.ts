// Seal #4 F2.1 — cross-tenant HTTP integration proof. Mounts the real
// orchestrator routes; asserts wrong-tenant requests to both affected
// endpoints get 404 CAMPAIGN_NOT_FOUND and the mi_snapshots SELECT never
// executes. Owning-tenant control proves rejection is not vacuous.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import http from "http";
import { AddressInfo } from "net";

const OWNER_ACCOUNT = "acc-owner";
const OTHER_ACCOUNT = "acc-other";
const OWNED_CAMPAIGN = "camp-owned";

vi.mock("../auth", () => ({
  resolveAccountId: (req: any) => req.headers["x-account-id"] ?? "anon",
  authMiddleware: (_req: any, _res: any, next: any) => next(),
  optionalAuth: (_req: any, _res: any, next: any) => next(),
}));

// Real CampaignOwnershipError + handleOwnershipError preserved; only the
// owner-pair check is stubbed so the test doesn't need a live DB.
vi.mock("../auth-helpers", async () => {
  const actual = await vi.importActual<any>("../auth-helpers");
  return {
    ...actual,
    assertCampaignBelongsTo: vi.fn(async (accountId: string, campaignId: string) => {
      if (accountId === OWNER_ACCOUNT && campaignId === OWNED_CAMPAIGN) return;
      throw new actual.CampaignOwnershipError(accountId, campaignId);
    }),
  };
});

// Spy on db.execute to assert mi_snapshots SELECT never fires cross-tenant.
const dbExecuteSpy = vi.fn(async (_sqlObj: any) => ({ rows: [] }));
const dbSelectSpy = vi.fn();
vi.mock("../db", () => {
  const chain: any = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve([])),
    set: vi.fn(() => chain),
    values: vi.fn(() => chain),
    returning: vi.fn(() => Promise.resolve([])),
    then: (resolve: any) => resolve([]),
  };
  return {
    db: {
      execute: vi.fn((sqlObj: any) => dbExecuteSpy(sqlObj)),
      select: vi.fn((...args: any[]) => { dbSelectSpy(...args); return chain; }),
      update: vi.fn(() => chain),
      insert: vi.fn(() => chain),
      delete: vi.fn(() => chain),
    },
  };
});

// Stub heavy deps so the module graph loads; only the boundary path matters here.
vi.mock("../orchestrator/index", () => ({
  runOrchestrator: vi.fn(),
  getOrchestratorStatus: vi.fn(),
  getLatestOrchestratorRun: vi.fn(async () => null), // → hasSummaries:false response
}));
vi.mock("../orchestrator/priority-matrix", () => ({ ENGINE_PRIORITY_ORDER: [] }));
vi.mock("../orchestrator/agent-context", () => ({
  loadSystemContext: vi.fn(),
  buildSystemPrompt: vi.fn(),
}));
vi.mock("../orchestrator/run-resolver", () => ({
  resolveRunId: vi.fn(async () => ({
    runId: null,
    isLatest: true,
    isStale: false,
    completedAt: null,
    status: null,
    planId: null,
  })),
}));
vi.mock("../root-bundle", () => ({
  validateRootIntegrity: vi.fn(),
  detectStaleness: vi.fn(),
  computeCalendarDeviation: vi.fn(),
}));
vi.mock("../fulfillment-engine", () => ({ computeFulfillment: vi.fn() }));
vi.mock("../narrative-layer", () => ({ buildCausalNarrative: vi.fn() }));
vi.mock("../adaptive-rhythm/engine", () => ({ computeAdaptiveRhythm: vi.fn() }));

let server: http.Server;
let port: number;

beforeAll(async () => {
  const { registerOrchestratorV2Routes } = await import("../orchestrator/routes");
  const app = express();
  app.use(express.json());
  registerOrchestratorV2Routes(app);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      port = (server.address() as AddressInfo).port;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function request(opts: { method: string; path: string; accountId?: string }) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method: opts.method,
        path: opts.path,
        headers: opts.accountId ? { "x-account-id": opts.accountId } : {},
      },
      (res) => {
        let buf = "";
        res.on("data", (d) => (buf += d));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode!, body: buf ? JSON.parse(buf) : null });
          } catch {
            resolve({ status: res.statusCode!, body: buf });
          }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function miSnapshotsQueryAttempted(): boolean {
  return dbExecuteSpy.mock.calls.some((call) => {
    const arg = call[0];
    if (!arg) return false;
    try {
      const text = JSON.stringify(arg) + " " + String(arg);
      return /mi_snapshots/.test(text);
    } catch {
      return false;
    }
  });
}

describe("Seal #4 F2.1 — orchestrator routes reject cross-tenant access at HTTP boundary", () => {
  describe("GET /api/orchestrator/summaries/:campaignId", () => {
    it("WRONG tenant → 404 CAMPAIGN_NOT_FOUND, mi_snapshots NEVER queried", async () => {
      dbExecuteSpy.mockClear();
      const r = await request({
        method: "GET",
        path: `/api/orchestrator/summaries/${OWNED_CAMPAIGN}`,
        accountId: OTHER_ACCOUNT,
      });
      expect(r.status).toBe(404);
      expect(r.body.error).toBe("CAMPAIGN_NOT_FOUND");
      // P3 isolation seal in handleOwnershipError: response body must NOT
      // echo back the campaignId/accountId.
      expect(JSON.stringify(r.body)).not.toContain(OWNED_CAMPAIGN);
      expect(JSON.stringify(r.body)).not.toContain(OTHER_ACCOUNT);
      // CRITICAL: the boundary assert short-circuited BEFORE any SQL ran.
      expect(miSnapshotsQueryAttempted()).toBe(false);
    });

    it("OWNING tenant → 200 (control: rejection above is not vacuous)", async () => {
      dbExecuteSpy.mockClear();
      const r = await request({
        method: "GET",
        path: `/api/orchestrator/summaries/${OWNED_CAMPAIGN}`,
        accountId: OWNER_ACCOUNT,
      });
      expect(r.status).toBe(200);
        // No resolved run → response is hasSummaries:false.
      expect(r.body).toEqual({ hasSummaries: false, engines: [] });
    });

    it("ANONYMOUS (no x-account-id) → 404 CAMPAIGN_NOT_FOUND", async () => {
      const r = await request({
        method: "GET",
        path: `/api/orchestrator/summaries/${OWNED_CAMPAIGN}`,
      });
      expect(r.status).toBe(404);
      expect(r.body.error).toBe("CAMPAIGN_NOT_FOUND");
    });
  });

  describe("GET /api/engines/table-summary", () => {
    it("WRONG tenant → 404 CAMPAIGN_NOT_FOUND, mi_snapshots NEVER queried", async () => {
      dbExecuteSpy.mockClear();
      const r = await request({
        method: "GET",
        path: `/api/engines/table-summary?campaignId=${OWNED_CAMPAIGN}`,
        accountId: OTHER_ACCOUNT,
      });
      expect(r.status).toBe(404);
      expect(r.body.error).toBe("CAMPAIGN_NOT_FOUND");
      expect(JSON.stringify(r.body)).not.toContain(OWNED_CAMPAIGN);
      expect(JSON.stringify(r.body)).not.toContain(OTHER_ACCOUNT);
      // CRITICAL: the raw `FROM mi_snapshots` SELECT never fired.
      expect(miSnapshotsQueryAttempted()).toBe(false);
    });

    it("missing campaignId → 400 (input validation, not isolation)", async () => {
      const r = await request({
        method: "GET",
        path: `/api/engines/table-summary`,
        accountId: OWNER_ACCOUNT,
      });
      // The handler resolves campaignId from req.query; without it the
      // boundary assert receives undefined and CampaignOwnershipError fires
      // (status 404). Either 400-style validation or 404 is acceptable —
      // the only thing that MUST NOT happen is a 200 with someone's data.
      expect([400, 404]).toContain(r.status);
      expect(r.status).not.toBe(200);
    });
  });
});
