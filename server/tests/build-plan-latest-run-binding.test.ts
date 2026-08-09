// Task 154 — run-bound build-plan reads over HTTP. Mounts the real
// build-plan-layer routes and proves /latest:
//  1. serves ONLY the resolved run's snapshot (job-scoped query),
//  2. fails closed with CURRENT_RUN_PLAN_NOT_PERSISTED when the snapshot
//     is absent (never generates or substitutes an older plan),
//  3. fails closed when a newer failed/running run shadows the last
//     resolvable run and the caller did not pin an explicit jobId,
//  4. still allows an explicitly pinned jobId to inspect that exact run.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import http from "http";
import { AddressInfo } from "net";

const ACCOUNT = "acc-1";
const CAMPAIGN = "camp-1";
const OLD_JOB = "job-old";
const NEW_JOB = "job-new";

vi.mock("../auth", () => ({
  resolveAccountId: (req: any) => req.headers["x-account-id"] ?? "anon",
  authMiddleware: (_req: any, _res: any, next: any) => next(),
  optionalAuth: (_req: any, _res: any, next: any) => next(),
}));

const resolveRunIdMock = vi.fn();
const runBuildPlanLayerMock = vi.fn();
const buildCausalNarrativeMock = vi.fn(async () => null);
vi.mock("../orchestrator/run-resolver", () => ({
  resolveRunId: (...args: any[]) => resolveRunIdMock(...args),
}));

// db.select chain: resolves to whatever snapshotRows currently holds.
let snapshotRows: any[] = [];
const dbSelectSpy = vi.fn();
vi.mock("../db", () => {
  const chain: any = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve(snapshotRows)),
    values: vi.fn(() => Promise.resolve()),
  };
  return {
    db: {
      select: vi.fn((...args: any[]) => { dbSelectSpy(...args); return chain; }),
      insert: vi.fn(() => chain),
    },
  };
});

// Heavy deps stubbed — only the /latest read boundary is under test.
vi.mock("../build-plan-layer/engine", () => ({ runBuildPlanLayer: (...args: any[]) => (runBuildPlanLayerMock as any)(...args) }));
vi.mock("../narrative-layer", () => ({ buildCausalNarrative: (...args: any[]) => (buildCausalNarrativeMock as any)(...args) }));

let server: http.Server;
let port: number;

beforeAll(async () => {
  const { registerBuildPlanLayerRoutes } = await import("../build-plan-layer/routes");
  const app = express();
  app.use(express.json());
  registerBuildPlanLayerRoutes(app);
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

beforeEach(() => {
  resolveRunIdMock.mockReset();
  runBuildPlanLayerMock.mockReset();
  buildCausalNarrativeMock.mockClear();
  dbSelectSpy.mockClear();
  snapshotRows = [];
});

function get(path: string) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, path, method: "GET", headers: { "x-account-id": ACCOUNT } },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : null });
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function post(path: string, body: any) {
  const raw = JSON.stringify(body);
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, path, method: "POST", headers: { "x-account-id": ACCOUNT, "content-type": "application/json", "content-length": Buffer.byteLength(raw) } },
      (res) => {
        let response = "";
        res.on("data", (c) => (response += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: response ? JSON.parse(response) : null }));
      },
    );
    req.on("error", reject);
    req.end(raw);
  });
}

const LATEST = `/api/build-plan-layer/latest?campaignId=${CAMPAIGN}`;

describe("GET /api/build-plan-layer/latest run binding", () => {
  it("serves the resolved run's stored snapshot with its job lineage", async () => {
    resolveRunIdMock.mockResolvedValue({ runId: NEW_JOB, isLatest: true, isStale: false });
    snapshotRows = [{
      id: "snap-1",
      jobId: NEW_JOB,
      status: "SUCCESS",
      plan: JSON.stringify({ positioning: "p" }),
      actionabilityScore: 88,
      failedBlocks: "[]",
      attempts: 1,
      createdAt: new Date("2026-08-08T00:00:00Z"),
    }];

    const res = await get(LATEST);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("SUCCESS");
    expect(res.body.jobId).toBe(NEW_JOB);
    expect(res.body.plan.positioning).toBe("p");
    expect(res.body.fromCache).toBe(true);
  });

  it("fails closed with CURRENT_RUN_PLAN_NOT_PERSISTED when the run has no snapshot", async () => {
    resolveRunIdMock.mockResolvedValue({ runId: NEW_JOB, isLatest: true, isStale: false });
    snapshotRows = []; // nothing persisted for this exact job

    const res = await get(LATEST);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("CURRENT_RUN_PLAN_NOT_PERSISTED");
    expect(res.body.jobId).toBe(NEW_JOB);
    expect(res.body.plan).toBeNull();
  });

  it("surfaces the previous plan (labeled) when a newer failed run shadows the last resolvable run (unpinned)", async () => {
    // Task #171 — completed run OLD_JOB exists with a snapshot, but a newer
    // FAILED run shadows it. An unpinned request must NOT present the older
    // plan as CURRENT, but it MUST expose it as previousPlan with shadowKind
    // so the UI can render "showing previous plan" instead of a hard block.
    resolveRunIdMock.mockResolvedValue({
      runId: OLD_JOB,
      isLatest: true,
      isStale: true,
      newerNonResolvableRun: { runId: NEW_JOB, status: "FAILED", shadowKind: "FAILED" },
    });
    snapshotRows = [{ id: "snap-old", jobId: OLD_JOB, status: "SUCCESS", plan: JSON.stringify({ positioning: "prev" }), failedBlocks: "[]" }];

    const res = await get(LATEST);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("CURRENT_RUN_PLAN_NOT_PERSISTED");
    expect(res.body.plan).toBeNull(); // never presented as the current plan
    expect(res.body.jobId).toBeNull();
    expect(res.body.shadowedByRun).toBe(NEW_JOB);
    expect(res.body.shadowKind).toBe("FAILED");
    expect(res.body.previousPlan.positioning).toBe("prev");
    expect(res.body.previousPlanJobId).toBe(OLD_JOB);
  });

  it("marks an in-flight RUNNING shadow as IN_PROGRESS with the previous plan attached", async () => {
    resolveRunIdMock.mockResolvedValue({
      runId: OLD_JOB,
      isLatest: true,
      isStale: true,
      newerNonResolvableRun: { runId: NEW_JOB, status: "RUNNING", shadowKind: "IN_PROGRESS" },
    });
    snapshotRows = [{ id: "snap-old", jobId: OLD_JOB, status: "SUCCESS", plan: JSON.stringify({ positioning: "prev" }), failedBlocks: "[]" }];

    const res = await get(LATEST);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("CURRENT_RUN_PLAN_NOT_PERSISTED");
    expect(res.body.shadowKind).toBe("IN_PROGRESS");
    expect(res.body.previousPlan.positioning).toBe("prev");
    expect(res.body.previousPlanJobId).toBe(OLD_JOB);
  });

  it("still serves an explicitly pinned jobId even when a newer run exists", async () => {
    resolveRunIdMock.mockResolvedValue({
      runId: OLD_JOB,
      isLatest: false,
      isStale: true,
      newerNonResolvableRun: { runId: NEW_JOB, status: "RUNNING", shadowKind: "IN_PROGRESS" },
    });
    snapshotRows = [{
      id: "snap-old",
      jobId: OLD_JOB,
      status: "SUCCESS",
      plan: JSON.stringify({ positioning: "pinned" }),
      actionabilityScore: 70,
      failedBlocks: "[]",
      attempts: 1,
      createdAt: new Date("2026-08-07T00:00:00Z"),
    }];

    const res = await get(`${LATEST}&jobId=${OLD_JOB}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("SUCCESS");
    expect(res.body.jobId).toBe(OLD_JOB);
    expect(res.body.plan.positioning).toBe("pinned");
    // Explicit pin flows through to the resolver.
    expect(resolveRunIdMock).toHaveBeenCalledWith(CAMPAIGN, ACCOUNT, OLD_JOB);
  });

  it("returns RUN_NOT_FOUND when the requested run does not resolve", async () => {
    resolveRunIdMock.mockRejectedValue(new Error("RUN_NOT_FOUND"));
    const res = await get(`${LATEST}&jobId=nope`);
    expect(res.status).toBe(404);
    expect(res.body.status).toBe("RUN_NOT_FOUND");
    expect(res.body.plan).toBeNull();
  });
});

describe("POST /api/build-plan-layer/generate run binding", () => {
  it("fails closed instead of regenerating an older run under a stale shadow", async () => {
    resolveRunIdMock.mockResolvedValue({
      runId: OLD_JOB, isLatest: true, isStale: true,
      newerNonResolvableRun: { runId: NEW_JOB, status: "FAILED", shadowKind: "FAILED" },
    });
    snapshotRows = [{ id: "snap-old", jobId: OLD_JOB, status: "SUCCESS", plan: JSON.stringify({ positioning: "prev" }), failedBlocks: "[]" }];
    const res = await post("/api/build-plan-layer/generate", { campaignId: CAMPAIGN });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("CURRENT_RUN_PLAN_NOT_PERSISTED");
    expect(res.body.shadowedByRun).toBe(NEW_JOB);
    expect(res.body.shadowKind).toBe("FAILED");
    expect(res.body.previousPlan.positioning).toBe("prev");
    expect(runBuildPlanLayerMock).not.toHaveBeenCalled();
  });

  it("binds narrative generation to the same resolved run as persistence", async () => {
    resolveRunIdMock.mockResolvedValue({ runId: NEW_JOB, isLatest: true, isStale: false });
    runBuildPlanLayerMock.mockResolvedValue({
      status: "SUCCESS", plan: { positioning: "p" }, actionabilityScore: 1, failedBlocks: [], attempts: 1,
    });
    const res = await post("/api/build-plan-layer/generate", { campaignId: CAMPAIGN });
    expect(res.status).toBe(200);
    expect(res.body.jobId).toBe(NEW_JOB);
    expect(buildCausalNarrativeMock).toHaveBeenCalledWith(CAMPAIGN, ACCOUNT, NEW_JOB);
  });
});
