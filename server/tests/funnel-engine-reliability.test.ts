import { describe, it, expect } from "vitest";
import { runFunnelEngine } from "../funnel-engine/engine";
import { LLMReliabilityError } from "../shared/llm-reliability/reliability-runner";

describe("Funnel Engine Reliability Test Suite", () => {
  it("triggers EVIDENCE_FAILURE when upstream Offer data is empty", async () => {
    // Missing offer
    const mi = {} as any;
    const audience = {} as any;
    const offer = null as any;
    const positioning = {} as any;
    const differentiation = {} as any;
    const accountId = "test-account";

    try {
      await runFunnelEngine(mi, audience, offer, positioning, differentiation, accountId);
      expect.fail("Expected runFunnelEngine to throw LLMReliabilityError");
    } catch (error: any) {
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe("LLMReliabilityError");
      expect(error.failureClass).toBe("EVIDENCE_FAILURE");
      expect(error.message).toContain("entirely empty");
    }
  });

  it("triggers EVIDENCE_FAILURE when strategic doctrine is empty", async () => {
    // Missing strategic doctrine
    const mi = {} as any;
    const audience = {} as any;
    const offer = { offerName: "Test Offer" } as any;
    const positioning = {} as any;
    const differentiation = {} as any;
    const accountId = "test-account";
    const strategic = null as any;

    try {
      await runFunnelEngine(mi, audience, offer, positioning, differentiation, accountId, null, null, strategic);
      expect.fail("Expected runFunnelEngine to throw LLMReliabilityError");
    } catch (error: any) {
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe("LLMReliabilityError");
      expect(error.failureClass).toBe("EVIDENCE_FAILURE");
      expect(error.message).toContain("entirely empty");
    }
  });
});
