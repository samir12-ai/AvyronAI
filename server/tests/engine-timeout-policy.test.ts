import { describe, expect, it, vi } from "vitest";
import {
  BUILD_PLAN_TIMEOUT_MS,
  ENGINE_TIMEOUT_BUDGET_MS,
  getEngineTimeoutMs,
  runWithEngineTimeout,
} from "../orchestrator/engine-timeout-policy";

describe("engine timeout policy", () => {
  it("defines the requested explicit budget for every priority engine", () => {
    expect(ENGINE_TIMEOUT_BUDGET_MS).toEqual({
      market_intelligence: 300_000,
      audience: 900_000,
      positioning: 900_000,
      differentiation: 600_000,
      mechanism: 600_000,
      offer: 600_000,
      awareness: 600_000,
      funnel: 300_000,
      persuasion: 600_000,
      integrity: 180_000,
      statistical_validation: 300_000,
      budget_governor: 180_000,
      channel_selection: 600_000,
      iteration: 300_000,
      retention: 300_000,
    });
    expect(BUILD_PLAN_TIMEOUT_MS).toBe(180_000);
  });

  it("only permits a valid environment override to raise a configured budget", () => {
    expect(getEngineTimeoutMs("offer", { ENGINE_TIMEOUT_MS_OVERRIDE: "300000" })).toBe(600_000);
    expect(getEngineTimeoutMs("offer", { ENGINE_TIMEOUT_MS_OVERRIDE: "900000" })).toBe(900_000);
    expect(getEngineTimeoutMs("offer", { ENGINE_TIMEOUT_MS_OVERRIDE: "not-a-number" })).toBe(600_000);
    expect(getEngineTimeoutMs("build_plan_layer", { ENGINE_TIMEOUT_MS_OVERRIDE: "900000" })).toBe(900_000);
  });

  it("clears warning and watchdog handles when work settles before its budget", async () => {
    const setTimer = vi.fn((handler: () => void) => ({ handler }) as any);
    const clearTimer = vi.fn();
    const out = await runWithEngineTimeout({
      engineId: "offer",
      engineName: "Offer Engine",
      attempt: 1,
      configuredBudgetMs: 600_000,
      run: async () => "done",
      onTimeout: () => "timeout",
      setTimer,
      clearTimer,
    });
    expect(out).toBe("done");
    expect(setTimer).toHaveBeenCalledTimes(2);
    expect(clearTimer).toHaveBeenCalledTimes(2);
  });

  it("returns a real timeout and clears handles when the watchdog wins", async () => {
    vi.useFakeTimers();
    try {
      const warning = vi.fn();
      const resultPromise = runWithEngineTimeout({
        engineId: "integrity",
        engineName: "Integrity Engine",
        attempt: 2,
        configuredBudgetMs: 100,
        run: () => new Promise<string>(() => {}),
        onTimeout: () => "TIMEOUT",
        currentStage: () => "mid_pipeline_gate_retry",
        onWarning: warning,
      });
      await vi.advanceTimersByTimeAsync(80);
      expect(warning).toHaveBeenCalledWith(expect.objectContaining({
        engineId: "integrity",
        attempt: 2,
        configuredBudgetMs: 100,
        currentStage: "mid_pipeline_gate_retry",
      }));
      await vi.advanceTimersByTimeAsync(20);
      await expect(resultPromise).resolves.toBe("TIMEOUT");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never emits a retroactive timeout after a completed attempt", async () => {
    vi.useFakeTimers();
    try {
      const timeout = vi.fn(() => "TIMEOUT");
      const result = await runWithEngineTimeout({
        engineId: "offer",
        engineName: "Offer Engine",
        attempt: 1,
        configuredBudgetMs: 100,
        run: async () => "SUCCESS",
        onTimeout: timeout,
      });
      expect(result).toBe("SUCCESS");
      await vi.advanceTimersByTimeAsync(10_000);
      expect(timeout).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});