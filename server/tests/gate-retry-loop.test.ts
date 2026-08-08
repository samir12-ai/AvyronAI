import { describe, expect, it, vi } from "vitest";
import { runGateRetryLoop } from "../orchestrator/gate-retry-loop";
import { getEngineTimeoutMs } from "../orchestrator/engine-timeout-policy";

const baseInput = (overrides: Record<string, unknown> = {}) => ({
  engineId: "offer",
  engineName: "Offer Engine",
  engineIndex: 5,
  executeEngine: () => Promise.resolve({
    engineId: "offer" as const,
    status: "SUCCESS" as const,
    output: { ok: true },
    durationMs: 10,
  }),
  checkMidPipelineGate: () => null,
  gateResult: {
    shouldRetry: true,
    reason: "missing_field",
    severity: "medium" as const,
    missingFieldId: "offer.painAlignment",
  },
  ...overrides,
});

describe("gate retry timeout policy", () => {
  it("runs a bounded retry and returns a clean retry result", async () => {
    const executeEngine = vi.fn().mockResolvedValue({
      engineId: "offer",
      status: "SUCCESS",
      output: {},
      durationMs: 5,
    });
    const out = await runGateRetryLoop(baseInput({ executeEngine }));
    expect(executeEngine).toHaveBeenCalledTimes(1);
    expect(out.kind).toBe("retry_passed");
  });

  it("uses the same canonical budget as an initial Offer attempt, not caller input", async () => {
    const out = await runGateRetryLoop(baseInput({
      engineTimeoutMs: 20,
      checkMidPipelineGate: () => ({
        shouldRetry: false,
        reason: "still_missing",
        severity: "medium" as const,
      }),
    }));
    expect(out.kind).toBe("retry_failed_continue");
    expect(getEngineTimeoutMs("offer")).toBe(600_000);
  });

  it("preserves retry failure semantics for a critical gate", async () => {
    const out = await runGateRetryLoop(baseInput({
      gateResult: { shouldRetry: true, reason: "x", severity: "critical" as const },
      checkMidPipelineGate: () => ({
        shouldRetry: false,
        reason: "still_missing",
        severity: "critical" as const,
      }),
    }));
    expect(out.kind).toBe("retry_failed_block");
  });
});