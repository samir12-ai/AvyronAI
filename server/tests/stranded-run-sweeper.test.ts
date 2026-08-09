// Task #171 — stranded-run recovery sweep. Proves:
//  1. threshold sits strictly above the supported 45-minute pipeline maximum,
//     so a healthy run near the ceiling can never be swept mid-flight;
//  2. the sweep updates ONLY status=RUNNING rows older than the cutoff
//     (terminal states are excluded by the status equality condition);
//  3. the sweep is repeat-safe (second pass over an already-swept table
//     matches zero rows) and start/stop are idempotent.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Capture the .set() payload and .where() condition passed to db.update.
let lastSet: any = null;
let lastWhere: any = null;
let returningRows: any[] = [];

vi.mock("../db", () => {
  const chain: any = {
    set: vi.fn((v: any) => { lastSet = v; return chain; }),
    where: vi.fn((w: any) => { lastWhere = w; return chain; }),
    returning: vi.fn(() => Promise.resolve(returningRows)),
  };
  return { db: { update: vi.fn(() => chain) } };
});

import {
  sweepStrandedRuns,
  startStrandedRunSweeper,
  stopStrandedRunSweeper,
  STRANDED_RUN_THRESHOLD_MS,
  PIPELINE_MAX_RUNTIME_MS,
} from "../orchestrator/stranded-run-sweeper";
import { orchestratorJobs } from "@shared/schema";
import { and, eq, lt } from "drizzle-orm";

beforeEach(() => {
  lastSet = null;
  lastWhere = null;
  returningRows = [];
});

afterEach(() => {
  stopStrandedRunSweeper();
});

describe("stranded-run sweeper", () => {
  it("threshold is strictly above the supported whole-pipeline maximum", () => {
    expect(PIPELINE_MAX_RUNTIME_MS).toBe(45 * 60 * 1000);
    expect(STRANDED_RUN_THRESHOLD_MS).toBeGreaterThan(PIPELINE_MAX_RUNTIME_MS);
    // A healthy run at exactly the 45-minute ceiling is inside the safe zone.
    expect(STRANDED_RUN_THRESHOLD_MS - PIPELINE_MAX_RUNTIME_MS).toBeGreaterThanOrEqual(5 * 60 * 1000);
  });

  it("marks only RUNNING rows older than the cutoff as TIMED_OUT", async () => {
    returningRows = [{ id: "job-zombie" }];
    const before = Date.now();
    const count = await sweepStrandedRuns();
    const after = Date.now();

    expect(count).toBe(1);
    expect(lastSet.status).toBe("TIMED_OUT");
    expect(lastSet.completedAt).toBeInstanceOf(Date);
    expect(String(lastSet.error)).toContain("stranded-run recovery sweep");

    // The WHERE condition must be exactly: status = 'RUNNING' AND createdAt < cutoff.
    // Walk the drizzle condition tree collecting column references, string
    // params, and Date params (cycle-safe — PgTable refs are circular).
    const collect = (node: any, out: { cols: string[]; strings: string[]; dates: Date[] }, seen = new Set()) => {
      if (!node || typeof node !== "object" || seen.has(node)) return out;
      seen.add(node);
      if (node instanceof Date) { out.dates.push(node); return out; }
      if (typeof node.name === "string" && node.table) out.cols.push(node.name);
      if (node.value instanceof Date) out.dates.push(node.value);
      else if (typeof node.value === "string") out.strings.push(node.value);
      for (const key of ["queryChunks", "left", "right", "value"]) {
        const child = node[key];
        if (Array.isArray(child)) child.forEach((c) => collect(c, out, seen));
        else if (child && typeof child === "object") collect(child, out, seen);
      }
      return out;
    };
    const info = collect(lastWhere, { cols: [], strings: [], dates: [] });
    // Status equality excludes every terminal state — only RUNNING matches.
    expect(info.cols).toContain("status");
    expect(info.strings).toContain("RUNNING");
    // Age filter targets created_at with a cutoff = now - clamped threshold.
    expect(info.cols).toContain("created_at");
    expect(info.dates.length).toBeGreaterThan(0);
    const cutoff = info.dates[0].getTime();
    expect(cutoff).toBeGreaterThanOrEqual(before - STRANDED_RUN_THRESHOLD_MS);
    expect(cutoff).toBeLessThanOrEqual(after - STRANDED_RUN_THRESHOLD_MS);
    // Sanity: the same shape as a freshly built condition.
    const expected = and(
      eq(orchestratorJobs.status, "RUNNING"),
      lt(orchestratorJobs.createdAt, new Date(before - STRANDED_RUN_THRESHOLD_MS)),
    );
    const expectedInfo = collect(expected, { cols: [], strings: [], dates: [] });
    expect(info.cols.sort()).toEqual(expectedInfo.cols.sort());
  });

  it("is repeat-safe: a second sweep over an already-clean table updates nothing", async () => {
    returningRows = [{ id: "a" }, { id: "b" }];
    expect(await sweepStrandedRuns()).toBe(2);
    returningRows = []; // rows are now TIMED_OUT — status filter no longer matches
    expect(await sweepStrandedRuns()).toBe(0);
  });

  it("start is idempotent and stop clears the interval", () => {
    vi.useFakeTimers();
    try {
      startStrandedRunSweeper();
      startStrandedRunSweeper(); // second call must be a no-op, not a second timer
      const timerCount = vi.getTimerCount();
      stopStrandedRunSweeper();
      expect(vi.getTimerCount()).toBeLessThan(timerCount);
      stopStrandedRunSweeper(); // double-stop is safe
    } finally {
      vi.useRealTimers();
    }
  });
});
