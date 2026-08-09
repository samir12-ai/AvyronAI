// Task #171 — shadow-detection refinement. Pure unit tests over
// detectNewerNonResolvableRun proving:
//  1. a newer RUNNING run is classified shadowKind=IN_PROGRESS,
//  2. newer terminal failures (FAILED / TIMED_OUT / CANCELLED) are FAILED,
//  3. resolvable statuses never shadow,
//  4. a RUNNING run started BEFORE the resolved run completed does not shadow
//     (the resolved run is still the latest attempt outcome).

import { describe, it, expect } from "vitest";
import { detectNewerNonResolvableRun } from "../orchestrator/run-resolver";

const resolved = {
  id: "job-old",
  createdAt: new Date("2026-08-09T12:00:00Z"),
  completedAt: new Date("2026-08-09T12:30:00Z"),
};

describe("detectNewerNonResolvableRun shadowKind", () => {
  it("classifies a newer RUNNING run as IN_PROGRESS", () => {
    const out = detectNewerNonResolvableRun(resolved, {
      id: "job-new",
      status: "RUNNING",
      createdAt: new Date("2026-08-09T13:00:00Z"),
      completedAt: null,
    });
    expect(out?.runId).toBe("job-new");
    expect(out?.shadowKind).toBe("IN_PROGRESS");
  });

  it.each(["FAILED", "TIMED_OUT", "CANCELLED"])(
    "classifies a newer %s run as FAILED",
    (status) => {
      const out = detectNewerNonResolvableRun(resolved, {
        id: "job-new",
        status,
        createdAt: new Date("2026-08-09T13:00:00Z"),
        completedAt: new Date("2026-08-09T13:05:00Z"),
      });
      expect(out?.shadowKind).toBe("FAILED");
    },
  );

  it("never shadows for resolvable statuses", () => {
    for (const status of ["COMPLETED", "BLOCKED_BY_INTEGRITY", "BLOCKED", "PARTIAL"]) {
      expect(
        detectNewerNonResolvableRun(resolved, {
          id: "job-new",
          status,
          createdAt: new Date("2026-08-09T13:00:00Z"),
          completedAt: new Date("2026-08-09T13:05:00Z"),
        }),
      ).toBeNull();
    }
  });

  it("a RUNNING run started before the resolved run completed does not shadow", () => {
    // TIMED_OUT recovery makes stranded rows terminal; this covers the live
    // overlap case observed in production: run B starts at 12:25 while run A
    // is still executing, run A completes at 12:30 — A stays authoritative.
    const out = detectNewerNonResolvableRun(resolved, {
      id: "job-overlap",
      status: "RUNNING",
      createdAt: new Date("2026-08-09T12:25:00Z"),
      completedAt: null,
    });
    expect(out).toBeNull();
  });

  it("with no resolved run, any non-resolvable latest run shadows with its kind", () => {
    const out = detectNewerNonResolvableRun(null, {
      id: "job-only",
      status: "TIMED_OUT",
      createdAt: new Date("2026-08-09T12:00:00Z"),
      completedAt: new Date("2026-08-09T12:40:00Z"),
    });
    expect(out?.runId).toBe("job-only");
    expect(out?.shadowKind).toBe("FAILED");
  });
});
