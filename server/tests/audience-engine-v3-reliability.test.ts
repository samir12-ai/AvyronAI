import { describe, it, expect, vi } from "vitest";
import { generateWithRepair, LLMReliabilityError } from "../shared/llm-reliability/reliability-runner";

describe("Audience Engine V3 — Technical Reliability (generateWithRepair)", () => {
  const baseArgs = {
    engineName: "audience",
    touchpointName: "segment_generation",
    authoritativeInput: "context",
    config: { maxRepairs: 3, maxTechnicalRetries: 3 }
  };

  it("1. timeout retry succeeds (semantic attempt counter unchanged during timeout)", async () => {
    let genCalls = 0;
    const generate = vi.fn(async () => {
      genCalls++;
      if (genCalls === 1) throw new Error("Request timed out."); // technical fail
      return "SUCCESS";
    });
    const judge = vi.fn(async () => ({ valid: true as const }));
    const repair = vi.fn();

    const { result, telemetry } = await generateWithRepair({ ...baseArgs, generate, judge, repair });
    
    expect(result).toBe("SUCCESS");
    expect(telemetry.attempts).toBe(1); // Semantic attempt unchanged
    expect(telemetry.technicalRetries).toBe(1);
    expect(genCalls).toBe(2);
    expect(repair).not.toHaveBeenCalled();
  });

  it("2. timeout does not consume semantic attempt (on repair loop)", async () => {
    const generate = vi.fn(async () => "FAIL_1");
    const judge = vi.fn(async (input, candidate) => {
      if (candidate === "SUCCESS") return { valid: true as const };
      return { valid: false as const, failureClass: "GENERATION_QUALITY_FAILURE" as const, rejections: [{ rule: "TEST", reason: "TEST" }] };
    });
    let repairCalls = 0;
    const repair = vi.fn(async () => {
      repairCalls++;
      if (repairCalls === 1) throw new Error("econnreset"); // technical fail during repair
      return "SUCCESS";
    });

    const { result, telemetry } = await generateWithRepair({ ...baseArgs, generate, judge, repair });
    
    expect(result).toBe("SUCCESS");
    expect(telemetry.attempts).toBe(2); // 1 initial + 1 repair (the timeout didn't consume an extra semantic attempt)
    expect(telemetry.technicalRetries).toBe(1);
    expect(repairCalls).toBe(2);
  });

  it("3. accepted claims survive timeout (repair state reused)", async () => {
    let repairCalls = 0;
    const repair = vi.fn(async (input, candidate, rejections) => {
      repairCalls++;
      // Rejections should be identical for both the failed technical call and the retried technical call
      expect(rejections[0].rule).toBe("UNSUPPORTED_DESIRE");
      if (repairCalls === 1) throw new Error("timeout");
      return "SUCCESS";
    });
    
    const generate = vi.fn(async () => "FAIL_1");
    const judge = vi.fn(async (input, candidate) => {
      if (candidate === "SUCCESS") return { valid: true as const };
      return { valid: false as const, failureClass: "GENERATION_QUALITY_FAILURE" as const, rejections: [{ rule: "UNSUPPORTED_DESIRE", reason: "no desires" }] };
    });

    const { result } = await generateWithRepair({ ...baseArgs, generate, judge, repair });
    expect(result).toBe("SUCCESS");
  });

  it("4. semantic rejection still consumes semantic attempt", async () => {
    const generate = vi.fn(async () => "FAIL_1");
    const judge = vi.fn(async (input, candidate) => {
      if (candidate === "FAIL_1" || candidate === "FAIL_2") {
        return { valid: false as const, failureClass: "GENERATION_QUALITY_FAILURE" as const, rejections: [{ rule: "TEST", reason: "TEST" }] };
      }
      return { valid: true as const };
    });
    const repair = vi.fn(async (input, candidate) => {
      if (candidate === "FAIL_1") return "FAIL_2";
      return "SUCCESS";
    });

    const { telemetry } = await generateWithRepair({ ...baseArgs, generate, judge, repair });
    expect(telemetry.attempts).toBe(3); // 1 initial + 2 repairs
    expect(telemetry.technicalRetries).toBe(0);
  });

  it("5. semantic exhaustion still fails closed", async () => {
    const generate = vi.fn(async () => "FAIL");
    const judge = vi.fn(async () => ({ valid: false as const, failureClass: "GENERATION_QUALITY_FAILURE" as const, rejections: [{ rule: "TEST", reason: "TEST" }] }));
    const repair = vi.fn(async () => "FAIL");

    await expect(generateWithRepair({ ...baseArgs, generate, judge, repair, config: { maxRepairs: 2, failClosed: true } }))
      .rejects.toThrowError(/Exhausted 3 attempts/);
  });

  it("6. technical exhaustion reports technical failure", async () => {
    const generate = vi.fn(async () => { throw new Error("timeout"); });
    const judge = vi.fn();
    const repair = vi.fn();

    await expect(generateWithRepair({ ...baseArgs, generate, judge, repair, config: { maxTechnicalRetries: 2 } }))
      .rejects.toThrowError(LLMReliabilityError);
      
    try {
      await generateWithRepair({ ...baseArgs, generate, judge, repair, config: { maxTechnicalRetries: 2 } });
    } catch (err: any) {
      expect(err.failureClass).toBe("TECHNICAL_FAILURE");
      expect(err.telemetry.technicalRetries).toBe(2);
      expect(err.telemetry.attempts).toBe(1); // It stuck on attempt 1
    }
  });

  it("7. non-retryable technical failure fails immediately", async () => {
    let genCalls = 0;
    const generate = vi.fn(async () => {
      genCalls++;
      throw new Error("invalid credentials"); // Non-retryable
    });
    const judge = vi.fn();
    const repair = vi.fn();

    await expect(generateWithRepair({ ...baseArgs, generate, judge, repair }))
      .rejects.toThrowError(/invalid credentials/);
      
    expect(genCalls).toBe(1); // No technical retries performed
  });

  it("8. no generic fallback (system returns unmodified candidate with _system_validation flag if not failClosed)", async () => {
    const generate = vi.fn(async () => JSON.stringify({ generic: "fallback" }));
    const judge = vi.fn(async () => ({ valid: false as const, failureClass: "GENERATION_QUALITY_FAILURE" as const, rejections: [{ rule: "TEST", reason: "TEST" }] }));
    const repair = vi.fn(async (input, candidate) => candidate);

    const { result, telemetry } = await generateWithRepair({ ...baseArgs, generate, judge, repair, config: { maxRepairs: 1, failClosed: false } });
    const parsed = JSON.parse(result as string);
    expect(parsed._system_validation.passed).toBe(false);
    expect(telemetry.finalVerdict).toBe("HONEST_FAIL");
  });

  it("9. no unsupported desire accepted", async () => {
    const generate = vi.fn(async () => "HAS_DESIRE");
    const judge = vi.fn(async (input, candidate) => {
      if (candidate === "HAS_DESIRE") return { valid: false as const, failureClass: "GENERATION_QUALITY_FAILURE" as const, rejections: [{ rule: "UNSUPPORTED_DESIRE", reason: "no desire" }] };
      return { valid: true as const };
    });
    const repair = vi.fn(async () => "NO_DESIRE");

    const { result } = await generateWithRepair({ ...baseArgs, generate, judge, repair });
    expect(result).toBe("NO_DESIRE");
  });

  it("10. no Product Truth enters Audience", async () => {
    const generate = vi.fn(async () => "PRODUCT_FEATURE");
    const judge = vi.fn(async (input, candidate) => {
      if (candidate === "PRODUCT_FEATURE") return { valid: false as const, failureClass: "AUTHORITY_FAILURE" as const, rejections: [{ rule: "NO_PRODUCT_TRUTH", reason: "do not cite product" }] };
      return { valid: true as const };
    });
    const repair = vi.fn(async () => "AUDIENCE_PAIN");

    const { result } = await generateWithRepair({ ...baseArgs, generate, judge, repair });
    expect(result).toBe("AUDIENCE_PAIN");
  });
});
