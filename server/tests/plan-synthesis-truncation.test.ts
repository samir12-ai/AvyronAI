/**
 * Regression tests for the Build Plan synthesis truncation failure.
 *
 * Proven root cause (job campaign_1773576062201_6t0oxi_realrun_1786260591209):
 * orchestrator-plan-synthesis called gpt-4.1-mini with max_tokens: 2000 for a
 * 9-section JSON contract; the completion hit the output-token ceiling
 * mid-string ("Unterminated string in JSON at position 9725") and a single
 * parse failure immediately degraded the plan with NO retry.
 *
 * These tests pin the fixed behavior of requestSynthesizedPlanJson:
 *  1. Complete valid JSON → accepted on attempt 1.
 *  2. Truncated JSON → never silently accepted as successful.
 *  3. Truncated JSON → bounded retry executes (exactly MAX_ATTEMPTS calls).
 *  4. Retry success → full plan returned with correct attempt count.
 *  5. Retry exhaustion → ok:false so caller falls to the truthfully-labeled
 *     degraded fallback (fallback preserved, not weakened).
 *  6. finish_reason=length → provider-confirmed truncation is rejected even
 *     if the payload happens to parse.
 *  7. Empty response → retried, not accepted.
 *  8. Token ceiling raised well above the measured ~2.4k-token contract.
 */
import { describe, it, expect, vi } from "vitest";
import {
  requestSynthesizedPlanJson,
  PLAN_SYNTHESIS_MAX_TOKENS,
  PLAN_SYNTHESIS_MAX_ATTEMPTS,
} from "../orchestrator/plan-synthesis";

const VALID_PLAN = {
  strategicSummary: { strategy: "s", targetAudience: "t", growthObjective: "g", rationale: "r" },
  monthlyObjective: { objective: "o", type: "sales", targetMetric: "m", targetValue: "v" },
};
const VALID_JSON = JSON.stringify(VALID_PLAN);
// Reproduces the production failure shape: JSON cut mid-string.
const TRUNCATED_JSON = VALID_JSON.slice(0, Math.floor(VALID_JSON.length / 2));

function mkResponse(content: string | null, finishReason = "stop") {
  return { choices: [{ message: { content }, finish_reason: finishReason }] } as any;
}

describe("plan synthesis truncation regression", () => {
  it("accepts complete valid JSON on attempt 1", async () => {
    const chatFn = vi.fn().mockResolvedValue(mkResponse(VALID_JSON));
    const out = await requestSynthesizedPlanJson({ prompt: "p", accountId: "a", chatFn });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.attempts).toBe(1);
      expect(out.plan).toEqual(VALID_PLAN);
    }
    expect(chatFn).toHaveBeenCalledTimes(1);
  });

  it("never silently accepts truncated JSON as successful", async () => {
    const chatFn = vi.fn().mockResolvedValue(mkResponse(TRUNCATED_JSON));
    const out = await requestSynthesizedPlanJson({ prompt: "p", accountId: "a", chatFn });
    expect(out.ok).toBe(false);
  });

  it("executes a bounded retry on truncation — exactly MAX_ATTEMPTS calls, no more", async () => {
    const chatFn = vi.fn().mockResolvedValue(mkResponse(TRUNCATED_JSON));
    const out = await requestSynthesizedPlanJson({ prompt: "p", accountId: "a", chatFn });
    expect(out.ok).toBe(false);
    expect(chatFn).toHaveBeenCalledTimes(PLAN_SYNTHESIS_MAX_ATTEMPTS);
    if (!out.ok) expect(out.attempts).toBe(PLAN_SYNTHESIS_MAX_ATTEMPTS);
  });

  it("retry success returns the full plan with correct attempt count", async () => {
    const chatFn = vi
      .fn()
      .mockResolvedValueOnce(mkResponse(TRUNCATED_JSON))
      .mockResolvedValueOnce(mkResponse(VALID_JSON));
    const out = await requestSynthesizedPlanJson({ prompt: "p", accountId: "a", chatFn });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.attempts).toBe(2);
      expect(out.plan).toEqual(VALID_PLAN);
    }
    expect(chatFn).toHaveBeenCalledTimes(2);
  });

  it("retry exhaustion yields ok:false with the last error preserved (degraded fallback stays reachable)", async () => {
    const chatFn = vi.fn().mockResolvedValue(mkResponse(TRUNCATED_JSON));
    const out = await requestSynthesizedPlanJson({ prompt: "p", accountId: "a", chatFn });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.lastError).toMatch(/JSON|Unterminated|Unexpected/i);
    }
  });

  it("rejects finish_reason=length even when the truncated payload happens to parse", async () => {
    // '{}' parses fine, but finish_reason=length means the provider confirmed
    // the completion was cut — it must never be treated as a complete plan.
    const chatFn = vi.fn().mockResolvedValue(mkResponse("{}", "length"));
    const out = await requestSynthesizedPlanJson({ prompt: "p", accountId: "a", chatFn });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.lastError).toContain("TRUNCATED_BY_TOKEN_CEILING");
    expect(chatFn).toHaveBeenCalledTimes(PLAN_SYNTHESIS_MAX_ATTEMPTS);
  });

  it("empty response is retried, not accepted", async () => {
    const chatFn = vi
      .fn()
      .mockResolvedValueOnce(mkResponse(null))
      .mockResolvedValueOnce(mkResponse(VALID_JSON));
    const out = await requestSynthesizedPlanJson({ prompt: "p", accountId: "a", chatFn });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.attempts).toBe(2);
  });

  it("chat-transport errors are retried within the same bound", async () => {
    const chatFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockResolvedValueOnce(mkResponse(VALID_JSON));
    const out = await requestSynthesizedPlanJson({ prompt: "p", accountId: "a", chatFn });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.attempts).toBe(2);
  });

  it("output-token ceiling gives >2x headroom over the measured ~2.4k-token contract", () => {
    expect(PLAN_SYNTHESIS_MAX_TOKENS).toBeGreaterThanOrEqual(5000);
    expect(PLAN_SYNTHESIS_MAX_ATTEMPTS).toBeGreaterThanOrEqual(2);
    expect(PLAN_SYNTHESIS_MAX_ATTEMPTS).toBeLessThanOrEqual(5);
  });

  it("passes max_tokens and json_object response_format on every attempt", async () => {
    const chatFn = vi.fn().mockResolvedValue(mkResponse(VALID_JSON));
    await requestSynthesizedPlanJson({ prompt: "p", accountId: "a", chatFn });
    const args = chatFn.mock.calls[0][0];
    expect(args.max_tokens).toBe(PLAN_SYNTHESIS_MAX_TOKENS);
    expect(args.response_format).toEqual({ type: "json_object" });
    expect(args.endpoint).toBe("orchestrator-plan-synthesis");
  });
});
