/**
 * Task #89 / Phase 4-A — End-to-end record→replay equivalence test.
 *
 * Proves the prompt-hash + ALS-injection contract end-to-end through
 * the REAL `ai-client.aiChat` / `aiGemini` functions:
 *
 *   1. Record path: stub the OpenAI/Gemini client so `aiChat`/`aiGemini`
 *      return canned responses without network. Bind a LiveRecorder via
 *      `enterRecorderScope`. Call aiChat/aiGemini → recorder captures
 *      promptHash + response into cassette.llmCalls.
 *
 *   2. Replay path: build a StrictLlmMock from the captured llmCalls.
 *      Bind it via `withStrictLlmMock`. Call aiChat/aiGemini again with
 *      the SAME inputs → mock.resolve returns the recorded response;
 *      zero mock misses.
 *
 * If the recorder's promptHash and the strict mock's lookup key disagree
 * (the bug the round-5 review caught), this test fails with
 * `LlmMockMissError`.
 *
 * Hermeticity: stubs replace the SDK clients via the test-only resetters
 * (`__resetOpenAIClientForTests`/`__resetGeminiClientForTests`) so no
 * real network call ever happens. Budget reservation and ai_usage_log
 * writes still hit pg — that's fine in dev; the spirit of the test is
 * "zero LLM provider call" not "zero DB call".
 */
import { describe, it, expect, beforeEach } from "vitest";
import OpenAI from "openai";
import {
  aiChat,
  aiGemini,
  __resetOpenAIClientForTests,
  __resetGeminiClientForTests,
  __setOpenAIClientForTests,
  __setGeminiClientForTests,
} from "../../ai-client";
import {
  StrictLlmMock,
  withStrictLlmMock,
} from "../../orchestrator/replay/llm-strict-mock";
import {
  enterRecorderScope,
  _liveRecorderForTests,
  _resetLlmCallCounterForTests,
} from "../../orchestrator/replay/recorder";

const FAKE_OPENAI_RESPONSE = {
  id: "chatcmpl-test",
  object: "chat.completion",
  created: 1747000000,
  model: "gpt-4.1",
  choices: [
    { index: 0, message: { role: "assistant", content: "hi from openai stub" }, finish_reason: "stop" },
  ],
  usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
} as unknown as OpenAI.Chat.Completions.ChatCompletion;

const FAKE_GEMINI_RESPONSE = {
  text: "hi from gemini stub",
  usageMetadata: { totalTokenCount: 7 },
};

function stubOpenAI(): void {
  __setOpenAIClientForTests({
    chat: {
      completions: {
        create: async () => FAKE_OPENAI_RESPONSE,
      },
    },
  } as unknown as OpenAI);
}

function stubGemini(): void {
  __setGeminiClientForTests({
    models: {
      generateContent: async () => FAKE_GEMINI_RESPONSE,
    },
  } as unknown as Parameters<typeof __setGeminiClientForTests>[0]);
}

describe("Task #89 / E2E record→replay through ai-client", () => {
  beforeEach(() => {
    _resetLlmCallCounterForTests();
    __resetOpenAIClientForTests();
    __resetGeminiClientForTests();
  });

  it("captures aiChat → replays with zero mock misses (OpenAI)", async () => {
    stubOpenAI();
    const recorder = _liveRecorderForTests("e2e-openai");
    // STEP 1: record.
    await (async () => {
      enterRecorderScope(recorder);
      await aiChat({
        accountId: "test-account",
        model: "gpt-4.1",
        messages: [{ role: "user", content: "Say hi." }],
        max_tokens: 50,
        endpoint: "test-endpoint",
      });
    })();
    // Recorder must have captured exactly one call.
    const captured = (recorder as unknown as { llmCalls?: unknown[] });
    // The LiveRecorder doesn't expose llmCalls — assert via finalize.
    // Instead, mirror the recorder's promptHash by computing what aiChat
    // would have built and comparing to a StrictLlmMock built from the
    // captured call.

    // STEP 2: build a mock from the cassette's captured llmCalls and
    // replay. Reach into the recorder's internals via finalize() — but
    // finalize() requires a `recordInput` + `recordContextResolved` +
    // `recordFinalResult` to emit. Provide the minimums.
    recorder.recordInput({ campaignId: "c", accountId: "a", forceRefresh: false });
    recorder.recordContextResolved({ sscPresent: true, contextKeys: [], inputHashes: {} });
    recorder.recordFinalResult({
      jobId: "e2e-openai",
      status: "COMPLETED",
      completedEngines: [],
      durationMs: 1,
      ledgerEntryCount: 0,
    });
    const cassette = await recorder.finalize();
    expect(cassette).not.toBeNull();
    expect(cassette!.body.llmCalls.length).toBe(1);

    // Build StrictLlmMock and replay the same aiChat call — must HIT.
    const mock = new StrictLlmMock(cassette!.body.llmCalls);
    // The replayed result is the recorded response AFTER the recorder's
    // RedactionMap was applied — so opaque-looking strings like
    // "chat.completion" may surface as `redact:<token>`. The contract this
    // test pins is "zero mock miss" + "the exact bytes the recorder
    // captured come back out of the player", NOT "the raw provider
    // response is round-tripped". A round-trip equivalence would defeat
    // the redaction layer.
    const replayed = (await withStrictLlmMock(mock, () =>
      aiChat({
        accountId: "test-account",
        model: "gpt-4.1",
        messages: [{ role: "user", content: "Say hi." }],
        max_tokens: 50,
        endpoint: "test-endpoint",
      }),
    )) as OpenAI.Chat.Completions.ChatCompletion;
    expect(replayed).toEqual(cassette!.body.llmCalls[0].response);
    expect(replayed.id).toBe(FAKE_OPENAI_RESPONSE.id);
    expect(replayed.choices[0].message.content).toBe("hi from openai stub");
  });

  it("captures aiGemini → replays with zero mock misses", async () => {
    stubGemini();
    const recorder = _liveRecorderForTests("e2e-gemini");
    await (async () => {
      enterRecorderScope(recorder);
      await aiGemini({
        accountId: "test-account",
        model: "gemini-2.5-flash",
        contents: "Say hi.",
        config: { maxOutputTokens: 50 },
        endpoint: "test-endpoint",
      });
    })();
    recorder.recordInput({ campaignId: "c", accountId: "a", forceRefresh: false });
    recorder.recordContextResolved({ sscPresent: true, contextKeys: [], inputHashes: {} });
    recorder.recordFinalResult({
      jobId: "e2e-gemini",
      status: "COMPLETED",
      completedEngines: [],
      durationMs: 1,
      ledgerEntryCount: 0,
    });
    const cassette = await recorder.finalize();
    expect(cassette).not.toBeNull();
    expect(cassette!.body.llmCalls.length).toBe(1);

    const mock = new StrictLlmMock(cassette!.body.llmCalls);
    const replayed = await withStrictLlmMock(mock, () =>
      aiGemini({
        accountId: "test-account",
        model: "gemini-2.5-flash",
        contents: "Say hi.",
        config: { maxOutputTokens: 50 },
        endpoint: "test-endpoint",
      }),
    );
    // Same contract as the OpenAI test — assert "what came out of the
    // mock equals what went into the cassette" rather than "the raw
    // provider response is round-tripped" (the recorder's redaction
    // layer transforms opaque strings).
    expect(replayed).toEqual(cassette!.body.llmCalls[0].response);
  });
});
