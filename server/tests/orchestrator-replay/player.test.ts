import { describe, it, expect, beforeEach } from "vitest";
import { play, ReplayCassetteVersionError } from "../../orchestrator/replay/player";
import { StrictLlmMock, LlmMockMissError } from "../../orchestrator/replay/llm-strict-mock";
import { hashValue } from "../../orchestrator/replay/hash";
import { _resetCv13MetricsForTests } from "../../orchestrator/replay/cv13-metrics";
import type { ReplayCassette, ReplayCassetteBody } from "../../orchestrator/replay/types";

function minimalBody(overrides: Partial<ReplayCassetteBody> = {}): ReplayCassetteBody {
  return {
    schemaVersion: 1,
    source: "synthetic",
    pathShape: "clean",
    capturedAt: "2026-05-17T00:00:00.000Z",
    input: { campaignId: "c", accountId: "a", forceRefresh: false },
    contextResolved: { sscPresent: true, contextKeys: [], inputHashes: {} },
    engineOutputs: [
      { order: 0, engineId: "mi", engineName: "MI", tier: "T0", status: "COMPLETED", durationMs: 1, output: {} },
    ],
    budgetLedger: [],
    inFlightEvents: [],
    llmCalls: [],
    finalResult: {
      jobId: "j", status: "COMPLETED", completedEngines: ["mi"], durationMs: 1, ledgerEntryCount: 0,
    },
    ...overrides,
  };
}

describe("Task #89 / player", () => {
  beforeEach(() => _resetCv13MetricsForTests());

  it("rejects cassettes with an unknown schemaVersion", async () => {
    const body = minimalBody({ schemaVersion: 99 as any });
    const cassette: ReplayCassette = { cassetteHash: hashValue(body.input), body };
    await expect(
      play(cassette, { async run() { return { finalResult: body.finalResult, budgetLedger: [], engineOrder: ["mi"] }; } }),
    ).rejects.toBeInstanceOf(ReplayCassetteVersionError);
  });

  it("returns passed=true when the candidate observation matches the cassette", async () => {
    const body = minimalBody();
    const cassette: ReplayCassette = { cassetteHash: hashValue(body.input), body };
    const result = await play(cassette, {
      async run() {
        return {
          finalResult: body.finalResult,
          budgetLedger: [],
          engineOrder: ["mi"],
          contextKeys: [],
          inputHashes: {},
        };
      },
    });
    expect(result.passed).toBe(true);
    expect(result.divergences.length).toBe(0);
    expect(result.finalPlanHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.finalVerdictHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("records PASS / FAIL outcomes via CV-13 metric", async () => {
    const { _resetCv13MetricsForTests } = await import("../../orchestrator/replay/cv13-metrics");
    _resetCv13MetricsForTests();
    const body = minimalBody();
    const cassette: ReplayCassette = { cassetteHash: hashValue(body.input), body };
    const result = await play(cassette, {
      async run() {
        return {
          finalResult: { ...body.finalResult, status: "PARTIAL" },
          budgetLedger: [],
          engineOrder: ["mi"],
          contextKeys: [],
          inputHashes: {},
        };
      },
    });
    expect(result.passed).toBe(false);
    expect(result.divergences.find((d) => d.path === "finalResult.status")?.class).toBe("CANONICAL_FIELD");
  });
});

describe("Task #89 / StrictLlmMock", () => {
  it("returns the recorded response on a content-address match", () => {
    const promptHash = StrictLlmMock.promptHashFor("hello");
    const mock = new StrictLlmMock([
      { callOrder: 1, provider: "openai", model: "gpt-x", promptHash, response: { ok: 1 } },
    ]);
    expect(mock.resolve("openai", "gpt-x", "hello")).toEqual({ ok: 1 });
  });

  it("throws LlmMockMissError on an unrecorded call (no re-roll)", () => {
    const mock = new StrictLlmMock([]);
    expect(() => mock.resolve("openai", "gpt-x", "anything")).toThrow(LlmMockMissError);
  });

  it("REPLAY-LLM-STRICT: two recorded calls with the same prompt-hash replay in original callOrder (FIFO)", () => {
    // Same provider/model/prompt — but two different recorded responses,
    // captured at different callOrder positions. The strict mock MUST
    // hand them back in callOrder so the candidate sees identical
    // history; overwriting (Map[k]=v) would silently drop the first.
    const promptHash = StrictLlmMock.promptHashFor("identical-prompt");
    const mock = new StrictLlmMock([
      { callOrder: 5, provider: "openai", model: "gpt-x", promptHash, response: { answer: "first" } },
      { callOrder: 2, provider: "openai", model: "gpt-x", promptHash, response: { answer: "second" } },
    ]);
    expect(mock.recordedCallCount()).toBe(2);
    // FIFO by ORIGINAL callOrder (sorted) — earliest recorded first.
    expect(mock.resolve("openai", "gpt-x", "identical-prompt")).toEqual({ answer: "second" });
    expect(mock.resolve("openai", "gpt-x", "identical-prompt")).toEqual({ answer: "first" });
    // Queue exhausted — third identical call must miss.
    expect(() => mock.resolve("openai", "gpt-x", "identical-prompt")).toThrow(LlmMockMissError);
  });
});
