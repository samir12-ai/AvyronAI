/**
 * Task #92 / Phase 4-D — auto-revert unit tests.
 *
 * Mocks `state-store` so the test runs without a DB. Verifies:
 *   - BLOCK-class (STRUCTURAL / CANONICAL_FIELD) divergence at
 *     traffic_percent > 0 flips to 0.
 *   - Non-BLOCK class (TIMING_ONLY) does NOT flip.
 *   - traffic_percent=0 already means no-op (revert idempotent).
 *   - candidate-threw flips to 0 unconditionally when percent > 0.
 *   - locked_until is set to NOW()+1h after auto-revert (OD-5 cool-off).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const writeMock = vi.fn();
const readMock = vi.fn();
const stampMock = vi.fn();

vi.mock("../orchestrator/cutover/state-store", () => ({
  readCutoverState: (...args: unknown[]) => readMock(...args),
  writeCutoverPercent: (...args: unknown[]) => writeMock(...args),
  stampDivergenceObserved: (...args: unknown[]) => stampMock(...args),
}));

import {
  recordCandidateDivergence,
  recordCandidateThrow,
} from "../orchestrator/cutover/auto-revert";
import { _resetCutoverMetricsForTest, snapshotCutoverMetrics } from "../orchestrator/cutover/metrics";

beforeEach(() => {
  writeMock.mockReset();
  readMock.mockReset();
  stampMock.mockReset();
  writeMock.mockResolvedValue({ trafficPercent: 0 });
  stampMock.mockResolvedValue(undefined);
  _resetCutoverMetricsForTest();
});

describe("cutover/auto-revert", () => {
  it("flips to 0 on STRUCTURAL divergence when percent > 0", async () => {
    readMock.mockResolvedValue({ trafficPercent: 5, lockedUntil: null });
    const res = await recordCandidateDivergence({ divergenceClass: "STRUCTURAL", jobId: "job-1" });
    expect(res.reverted).toBe(true);
    expect(res.reason).toBe("structural_divergence");
    expect(writeMock).toHaveBeenCalledTimes(1);
    const [next, actor, reason, lockedUntil] = writeMock.mock.calls[0];
    expect(next).toBe(0);
    expect(actor).toBe("auto_revert");
    expect(reason).toMatch(/structural_divergence/);
    expect(lockedUntil).toBeInstanceOf(Date);
    expect(lockedUntil.getTime()).toBeGreaterThan(Date.now());
    expect(snapshotCutoverMetrics().autoRevertTotal.structural_divergence).toBe(1);
  });

  it("flips to 0 on CANONICAL_FIELD divergence", async () => {
    readMock.mockResolvedValue({ trafficPercent: 25, lockedUntil: null });
    const res = await recordCandidateDivergence({ divergenceClass: "CANONICAL_FIELD", jobId: "job-2" });
    expect(res.reverted).toBe(true);
    expect(res.reason).toBe("canonical_field_divergence");
    expect(writeMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT flip on TIMING_ONLY divergence", async () => {
    readMock.mockResolvedValue({ trafficPercent: 50, lockedUntil: null });
    const res = await recordCandidateDivergence({ divergenceClass: "TIMING_ONLY", jobId: "job-3" });
    expect(res.reverted).toBe(false);
    expect(writeMock).not.toHaveBeenCalled();
  });

  it("does NOT flip when traffic_percent is already 0", async () => {
    readMock.mockResolvedValue({ trafficPercent: 0, lockedUntil: null });
    const res = await recordCandidateDivergence({ divergenceClass: "STRUCTURAL", jobId: "job-4" });
    expect(res.reverted).toBe(false);
    expect(writeMock).not.toHaveBeenCalled();
  });

  it("records divergence histogram at the observation-time percent", async () => {
    readMock.mockResolvedValue({ trafficPercent: 25, lockedUntil: null });
    await recordCandidateDivergence({ divergenceClass: "PROVENANCE", jobId: "j" });
    const snap = snapshotCutoverMetrics();
    expect(snap.divergenceAtTraffic["25|PROVENANCE"]).toBe(1);
  });

  it("recordCandidateThrow flips on any non-zero percent", async () => {
    readMock.mockResolvedValue({ trafficPercent: 1, lockedUntil: null });
    await recordCandidateThrow("job-throw", "TypeError: boom");
    expect(writeMock).toHaveBeenCalledTimes(1);
    const [next, actor] = writeMock.mock.calls[0];
    expect(next).toBe(0);
    expect(actor).toBe("auto_revert");
    expect(snapshotCutoverMetrics().autoRevertTotal.candidate_threw).toBe(1);
  });

  it("recordCandidateThrow is a no-op at traffic_percent=0", async () => {
    readMock.mockResolvedValue({ trafficPercent: 0, lockedUntil: null });
    await recordCandidateThrow("job-throw", "TypeError: boom");
    expect(writeMock).not.toHaveBeenCalled();
  });
});
