/**
 * Task #89 / Phase 4-A — Strict LLM mock adapter used inside the player.
 *
 * Doctrine: the player NEVER makes a real LLM call. Engine code that reaches
 * for `aiChat` / `aiGemini` inside a player run is routed through this
 * adapter, which:
 *   - Looks up the recorded LLM response keyed by (callOrder, provider,
 *     model, promptHash).
 *   - Returns the recorded response payload.
 *   - On miss, throws `LlmMockMissError` so the player flags the call as a
 *     STRUCTURAL divergence — never re-rolls.
 *
 * Phase 4-A wires this end-to-end: `withStrictLlmMock(mock, fn)` binds
 * the mock to AsyncLocalStorage and `ai-client.aiChat` / `aiGemini`
 * detect it via `getActiveStrictLlmMock()` BEFORE any provider call —
 * so a real `runOrchestrator(...)` invocation inside the player /
 * replay-cli is fully hermetic (zero network, zero token spend).
 */
import { AsyncLocalStorage } from "async_hooks";
import type { CassetteLlmCall } from "./types";
import { hashValue } from "./hash";

export class LlmMockMissError extends Error {
  constructor(
    message: string,
    public readonly attempt: {
      callOrder: number;
      provider: string;
      model: string;
      promptHash: string;
    },
  ) {
    super(message);
    this.name = "LlmMockMissError";
  }
}

export class StrictLlmMock {
  private nextCallOrder = 0;
  /**
   * key = `${provider}|${model}|${promptHash}` → FIFO queue of recorded
   * calls sharing that content-address. Doctrine REPLAY-LLM-STRICT: if the
   * candidate orchestrator issues the same prompt twice with two different
   * recorded responses, the player MUST return them in original callOrder
   * — never overwrite, never re-roll. The queue per key preserves that.
   */
  private readonly byKey = new Map<string, CassetteLlmCall[]>();
  /** Ordered list — also lookup by index when present. */
  private readonly byOrder = new Map<number, CassetteLlmCall>();
  /** Total recorded entries (for diagnostics, not lookup). */
  private readonly recordedTotal: number;

  constructor(calls: CassetteLlmCall[]) {
    // Insert into per-key queue in original callOrder so .shift() returns
    // the earliest recorded match first.
    const sorted = [...calls].sort((a, b) => a.callOrder - b.callOrder);
    for (const c of sorted) {
      this.byOrder.set(c.callOrder, c);
      const k = StrictLlmMock.keyFor(c.provider, c.model, c.promptHash);
      const q = this.byKey.get(k);
      if (q) q.push(c);
      else this.byKey.set(k, [c]);
    }
    this.recordedTotal = sorted.length;
  }

  static keyFor(provider: string, model: string, promptHash: string): string {
    return `${provider}|${model}|${promptHash}`;
  }

  static promptHashFor(prompt: unknown): string {
    return hashValue(prompt);
  }

  /**
   * Look up a recorded response for the call. The strict policy is:
   *   1. Match by (provider, model, promptHash) — content-address match.
   *   2. If multiple recorded calls share that key, return them in
   *      original `callOrder` so re-runs are deterministic.
   *   3. If no match, throw — never re-roll.
   */
  resolve(provider: "openai" | "gemini", model: string, prompt: unknown): unknown {
    const promptHash = StrictLlmMock.promptHashFor(prompt);
    const k = StrictLlmMock.keyFor(provider, model, promptHash);
    const q = this.byKey.get(k);
    this.nextCallOrder += 1;
    if (!q || q.length === 0) {
      throw new LlmMockMissError(
        `Strict LLM mock miss: no recorded ${provider}/${model} call with promptHash ${promptHash.slice(0, 12)} (exhausted=${!!q})`,
        { callOrder: this.nextCallOrder, provider, model, promptHash },
      );
    }
    // FIFO — return earliest recorded callOrder for this content-address
    // first; subsequent identical prompts get the next recorded response.
    const rec = q.shift()!;
    return rec.response;
  }

  recordedCallCount(): number {
    return this.recordedTotal;
  }
}

/**
 * Task #89 / Phase 4-A — StrictLlmMock injection via AsyncLocalStorage.
 *
 * Doctrine REPLAY-LLM-STRICT-INJECT: the replay player and the
 * `replay:run --against current` CLI bind an active `StrictLlmMock` to
 * the async context BEFORE calling `runOrchestrator`. `ai-client.aiChat`
 * and `ai-client.aiGemini` check `getActiveStrictLlmMock()` BEFORE
 * making a real provider call; when a mock is bound they route through
 * `mock.resolve(...)` and return its recorded response. This makes
 * `--against current` truly hermetic — zero network, zero token spend.
 *
 * Lookup-key contract: the canonicalised `payload` passed to
 * `mock.resolve(provider, model, payload)` MUST be the SAME object
 * shape that the recorder fed into `recordLlmCall.promptHash` via
 * `hashValue(payload)`. ai-client.ts builds the payload once and uses
 * the same value for both sides — see `recordReplayLlmCall` and the
 * mock short-circuit in aiChat/aiGemini. Drift between recorder-side
 * and mock-side payload shape = mock miss on every replay.
 *
 * Production safety: outside a player/CLI scope the ALS returns
 * `undefined` and `ai-client` falls through to the real provider.
 */
const strictMockScope = new AsyncLocalStorage<StrictLlmMock>();

export function getActiveStrictLlmMock(): StrictLlmMock | undefined {
  return strictMockScope.getStore();
}

export async function withStrictLlmMock<T>(
  mock: StrictLlmMock,
  fn: () => Promise<T>,
): Promise<T> {
  return strictMockScope.run(mock, fn);
}

/**
 * Bind the strict mock to the current async context WITHOUT wrapping.
 * Mirrors `enterRecorderScope`. Used by player paths that drive the
 * candidate orchestrator from inside a `Promise.resolve().then(...)`
 * chain instead of a single callback.
 */
export function enterStrictLlmMockScope(mock: StrictLlmMock): void {
  strictMockScope.enterWith(mock);
}
