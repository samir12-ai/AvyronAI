import { describe, it, expect, vi } from "vitest";
import { runGateRetryLoop } from "./index";

const baseInput = (overrides: any = {}) => ({
  engineId: "offer",
  engineName: "Offer Engine",
  engineIndex: 5,
  engineTimeoutMs: 1000,
  executeEngine: () =>
    Promise.resolve({
      engineId: "offer",
      status: "SUCCESS" as const,
      output: { ok: true },
      durationMs: 10,
    }),
  checkMidPipelineGate: () => null,
  gateResult: {
    shouldRetry: true,
    reason: "missing_field",
    severity: "warning" as const,
    missingFieldId: "offer.painAlignment",
  },
  ...overrides,
});

describe("runGateRetryLoop", () => {
  it("returns no_retry_continue when planRetry says don't retry & severity non-critical", async () => {
    const out = await runGateRetryLoop(
      baseInput({
        gateResult: {
          shouldRetry: false,
          reason: "x",
          severity: "warning",
        },
      }),
    );
    expect(out.kind).toBe("no_retry_continue");
  });

  it("returns no_retry_block when planRetry says don't retry & severity critical", async () => {
    const out = await runGateRetryLoop(
      baseInput({
        gateResult: {
          shouldRetry: false,
          reason: "missing_pains",
          severity: "critical",
        },
      }),
    );
    expect(out.kind).toBe("no_retry_block");
    if (out.kind === "no_retry_block") {
      expect(out.blockReason).toContain("missing_pains");
    }
  });

  it("returns retry_passed when retry succeeds and post-retry gate is clean", async () => {
    const exec = vi.fn().mockResolvedValue({
      engineId: "offer",
      status: "SUCCESS",
      output: {},
      durationMs: 5,
    });
    const out = await runGateRetryLoop(baseInput({ executeEngine: exec, checkMidPipelineGate: () => null }));
    expect(exec).toHaveBeenCalledTimes(1);
    expect(out.kind).toBe("retry_passed");
  });

  it("returns retry_failed_continue when retry fails gate but severity non-critical", async () => {
    const out = await runGateRetryLoop(
      baseInput({
        checkMidPipelineGate: () => ({
          shouldRetry: false,
          reason: "still_missing",
          severity: "warning",
        }),
      }),
    );
    expect(out.kind).toBe("retry_failed_continue");
  });

  it("returns retry_failed_block when retry fails gate AND severity critical", async () => {
    const out = await runGateRetryLoop(
      baseInput({
        gateResult: { shouldRetry: true, reason: "x", severity: "critical" },
        checkMidPipelineGate: () => ({
          shouldRetry: false,
          reason: "still_missing",
          severity: "critical",
        }),
      }),
    );
    expect(out.kind).toBe("retry_failed_block");
    if (out.kind === "retry_failed_block") {
      expect(out.blockReason).toContain("x");
    }
  });

  it("races against the per-engine timeout", async () => {
    const out = await runGateRetryLoop(
      baseInput({
        engineTimeoutMs: 20,
        executeEngine: () => new Promise(() => {}),
      }),
    );
    expect(out.kind === "retry_passed" || out.kind === "retry_failed_continue" || out.kind === "retry_failed_block").toBe(true);
    if ("retryResult" in out) {
      expect(out.retryResult.status).toBe("TIMEOUT");
    }
  });
});
