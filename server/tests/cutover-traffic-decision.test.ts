/**
 * Task #92 / Phase 4-D — traffic-decision unit tests.
 *
 * Pure-function tests (no DB). Cover:
 *   - All 6 allowed traffic_percents resolve deterministically.
 *   - Invalid percent throws InvalidTrafficPercentError (OD-4 strict enum).
 *   - 0 always → current; 100 always → candidate.
 *   - Same jobId across calls always lands the same path.
 *   - Across many jobIds, the candidate-share roughly matches the percent.
 */

import { describe, it, expect } from "vitest";
import {
  decideOrchestratorPath,
  hashJobId,
  isAllowedTrafficPercent,
  ALLOWED_TRAFFIC_PERCENTS,
  InvalidTrafficPercentError,
} from "../orchestrator/cutover/traffic-decision";

describe("cutover/traffic-decision", () => {
  it("rejects percents outside the doctrine ladder", () => {
    for (const bad of [-1, 2, 10, 75, 101, NaN]) {
      expect(() => decideOrchestratorPath("job-x", bad)).toThrow(InvalidTrafficPercentError);
    }
  });

  it("accepts every doctrine-ladder value", () => {
    for (const ok of ALLOWED_TRAFFIC_PERCENTS) {
      expect(isAllowedTrafficPercent(ok)).toBe(true);
      const path = decideOrchestratorPath("job-x", ok);
      expect(["current", "candidate"]).toContain(path);
    }
  });

  it("0 → current always, 100 → candidate always", () => {
    for (let i = 0; i < 50; i++) {
      expect(decideOrchestratorPath(`job-${i}`, 0)).toBe("current");
      expect(decideOrchestratorPath(`job-${i}`, 100)).toBe("candidate");
    }
  });

  it("is deterministic: same jobId → same path", () => {
    for (const pct of [1, 5, 25, 50] as const) {
      for (let i = 0; i < 25; i++) {
        const id = `repeat-${i}`;
        const first = decideOrchestratorPath(id, pct);
        for (let j = 0; j < 5; j++) {
          expect(decideOrchestratorPath(id, pct)).toBe(first);
        }
      }
    }
  });

  it("candidate share roughly matches percent over a population", () => {
    const N = 2000;
    for (const pct of [1, 5, 25, 50] as const) {
      let candidates = 0;
      for (let i = 0; i < N; i++) {
        if (decideOrchestratorPath(`pop-${i}`, pct) === "candidate") candidates++;
      }
      const share = (candidates / N) * 100;
      // 25% absolute slack: 1% step is the most sensitive (~20 samples).
      const slack = pct === 1 ? 1.5 : 8;
      expect(Math.abs(share - pct)).toBeLessThanOrEqual(slack);
    }
  });

  it("missing jobId fails closed to current (canonical, NOT a D1 fallback)", () => {
    expect(decideOrchestratorPath("", 50)).toBe("current");
  });

  it("hash is deterministic and stable across runs", () => {
    expect(hashJobId("hello")).toBe(hashJobId("hello"));
    expect(hashJobId("hello")).not.toBe(hashJobId("hellp"));
  });
});
