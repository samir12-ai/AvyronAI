/**
 * Regression: grounded positioning territory naming must NOT silently
 * degrade every cluster to the generic static template phrase (e.g.
 * "<domain> capability transformation validation gap") just because a
 * batched LLM call exceeded a too-small timeout / token budget.
 *
 * These tests pin the fix at its source (generateGroundedTerritoryNames):
 *   - the call budget scales with batch size (so 16 clusters don't
 *     deterministically time out on the 45s default);
 *   - a length-truncated response is retried, never parsed partially;
 *   - a genuine unavailability still fails closed (returns null) so the
 *     caller's template fallback + DNA_ENRICHMENT_REQUIRED path is intact;
 *   - a healthy response yields product-specific names.
 *
 * The interchangeability judge and every downstream gate are untouched.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const aiChatMock = vi.fn();
vi.mock("../ai-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ai-client")>();
  return { ...actual, aiChat: (...args: any[]) => aiChatMock(...args) };
});

let generateGroundedTerritoryNames: typeof import("../positioning-engine/engine").generateGroundedTerritoryNames;

const clusters = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `c${i}`,
    label: `signal ${i}`,
    signalType: (i % 2 === 0 ? "root_cause" : "psych_driver") as "root_cause" | "psych_driver",
    evidence: [`evidence ${i}`],
  }));

const productDna: any = {
  businessType: "SaaS",
  coreOffer: "AI marketing strategist",
  uniqueMechanism: "Live Market Mirror",
  productCategory: "martech",
};

function jsonResponse(items: any[], finishReason = "stop") {
  return {
    choices: [{ finish_reason: finishReason, message: { content: JSON.stringify(items) } }],
  };
}

beforeEach(async () => {
  aiChatMock.mockReset();
  if (!generateGroundedTerritoryNames) {
    ({ generateGroundedTerritoryNames } = await import("../positioning-engine/engine"));
  }
});

describe("generateGroundedTerritoryNames budget + fail-closed", () => {
  it("scales timeout and token budget with batch size (no fixed 45s / 800 tokens)", async () => {
    const cs = clusters(16);
    aiChatMock.mockResolvedValueOnce(jsonResponse(cs.map(c => ({ id: c.id, territory: `Named ${c.id}` }))));

    const names = await generateGroundedTerritoryNames(cs, productDna, null, null, "acct");
    expect(names).not.toBeNull();
    expect(names!.size).toBe(16);

    expect(aiChatMock).toHaveBeenCalledTimes(1);
    const opts = aiChatMock.mock.calls[0][0];
    // Default client hard timeout is 45s; a 16-cluster batch must ask for more.
    expect(opts.timeoutMs).toBeGreaterThan(45_000);
    // Token ceiling must grow past the old flat 800 for a large batch.
    expect(opts.max_tokens).toBeGreaterThan(800);
  });

  it("retries once on a length-truncated response, never parsing partial JSON", async () => {
    const cs = clusters(4);
    aiChatMock
      .mockResolvedValueOnce(jsonResponse([{ id: "c0", territory: "Partial" }], "length"))
      .mockResolvedValueOnce(jsonResponse(cs.map(c => ({ id: c.id, territory: `Named ${c.id}` }))));

    const names = await generateGroundedTerritoryNames(cs, productDna, null, null, "acct");
    expect(aiChatMock).toHaveBeenCalledTimes(2);
    expect(names).not.toBeNull();
    expect(names!.size).toBe(4);
    // The truncated attempt's partial name must never leak through.
    expect(names!.get("c0")).toBe("Named c0");
  });

  it("fails closed (null) when the call keeps timing out — preserving template fallback path", async () => {
    const cs = clusters(3);
    aiChatMock.mockRejectedValue(new Error("Request timed out."));

    const names = await generateGroundedTerritoryNames(cs, productDna, null, null, "acct");
    expect(names).toBeNull();
    // One retry ⇒ exactly two attempts, then fail closed.
    expect(aiChatMock).toHaveBeenCalledTimes(2);
  });

  it("returns product-specific names on a healthy response", async () => {
    const cs = clusters(2);
    aiChatMock.mockResolvedValueOnce(
      jsonResponse([
        { id: "c0", territory: "Pricing Transparency Failure in AI marketing strategist" },
        { id: "c1", territory: "Trust Breakdown in AI marketing strategist" },
      ]),
    );
    const names = await generateGroundedTerritoryNames(cs, productDna, null, null, "acct");
    expect(names!.get("c0")).toContain("AI marketing strategist");
    expect(names!.get("c1")).toContain("AI marketing strategist");
    // Not the generic static template phrase.
    expect([...names!.values()].join(" ")).not.toMatch(/capability transformation validation gap/i);
  });
});
