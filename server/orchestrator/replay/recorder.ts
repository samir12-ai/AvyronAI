// @ts-nocheck
/**
 * Task #89 / Phase 4-A — Replay recorder + `withReplayRecorder` HOF.
 *
 * Founding rule (Doctrine ORCH_REPLAY_HOF): the orchestrator MUST NOT call
 * `recorder.record(...)` directly. Every recorder boundary in
 * server/orchestrator/index.ts (and the priority-matrix / plan-synthesis /
 * in-flight-lifecycle / budget-decision-ledger modules) goes through
 * `withReplayRecorder(...)` so that:
 *   1. The recorder is a single-point flag-gate — flipping ORCH_REPLAY_RECORD
 *      to 0 makes the HOF return `null` and every boundary is a no-op.
 *   2. The recorder is sampled — at `sample:N`, only 1-in-N invocations get
 *      a live recorder; the rest return `null`. This bounds the wall-clock
 *      overhead budget (target: <2% at sample:50).
 *   3. ESLint can statically verify no direct `recorder.record(...)` call
 *      escapes the HOF (see .local/eslint-rules/no-bare-llm-call-in-replay
 *      for the related lint family).
 *
 * The 8 declared recorder boundaries (each gets one HOF callback):
 *   1. input              — orchestrator entry, frozen config
 *   2. ctx-resolved       — engine context resolved (snapshot loads done)
 *   3. per-engine-output  — for each engine in execution order
 *   4. synthesis-input    — immediately before plan synthesis
 *   5. plan-persist       — what was about to be written
 *   6. system-control-verdict — final SystemControlVerdict
 *   7. budget-ledger      — each budget-decision-ledger entry
 *   8. in-flight-lifecycle — register / heartbeat / settle events
 *
 * Recorder cost model: each `record(...)` does a structured-clone +
 * shallow-redact, no IO. The single DB write happens at `finalize()` and is
 * timed; finalize cost contributes to the overhead ratio.
 *
 * Hermeticity: NOTHING in this module reads the wall clock except via the
 * injected `now()` so Seal #18 lifecycle tests can drive deterministic
 * timestamps.
 */
import { AsyncLocalStorage } from "async_hooks";
import { pool } from "../../db";
import { logger } from "../../logger";
import { RedactionMap, redactValue } from "./redaction";
import {
  recordCassetteCaptured,
  recordRecorderOverheadRatio,
} from "./cv13-metrics";
import { hashValue } from "./hash";
import {
  REPLAY_CASSETTE_SCHEMA_VERSION,
  type CassetteBudgetLedgerEntry,
  type CassetteContextResolved,
  type CassetteEngineOutput,
  type CassetteFinalResult,
  type CassetteInFlightEvent,
  type CassetteInput,
  type CassetteLlmCall,
  type CassettePlanPersist,
  type CassetteSynthesisInput,
  type CassetteSystemControlVerdict,
  type ReplayCassette,
  type ReplayCassetteBody,
  type ReplayCassetteSource,
  type ReplayPathShape,
} from "./types";

export interface RecorderOptions {
  now?: () => number;
  source?: ReplayCassetteSource;
  /** Override gate decision (testing only). */
  forceEnabled?: boolean;
  /** Override sample decision (testing only). */
  sampleRollOverride?: number;
}

/**
 * Parse ORCH_REPLAY_RECORD into a decision:
 *   - unset / "0" / "false"  → disabled
 *   - "1" / "true"           → every invocation
 *   - "sample:N"             → 1-in-N (N > 0)
 */
export interface RecorderGateDecision {
  enabled: boolean;
  sampleEvery: number;
}

export function parseRecorderGate(raw: string | undefined): RecorderGateDecision {
  if (!raw) return { enabled: false, sampleEvery: 0 };
  const v = raw.trim().toLowerCase();
  if (v === "" || v === "0" || v === "false") return { enabled: false, sampleEvery: 0 };
  if (v === "1" || v === "true") return { enabled: true, sampleEvery: 1 };
  const m = /^sample:(\d+)$/.exec(v);
  if (m) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > 0) return { enabled: true, sampleEvery: n };
  }
  return { enabled: false, sampleEvery: 0 };
}

/**
 * The recorder handle returned by withReplayRecorder. All boundary hooks
 * MUST funnel through these methods.
 */
export interface ReplayRecorder {
  readonly jobId: string;
  recordInput(input: CassetteInput): void;
  recordContextResolved(ctx: CassetteContextResolved): void;
  recordEngineOutput(output: CassetteEngineOutput): void;
  recordSynthesisInput(s: CassetteSynthesisInput): void;
  recordPlanPersist(p: CassettePlanPersist): void;
  recordSystemControlVerdict(v: CassetteSystemControlVerdict): void;
  recordBudgetLedgerEntry(e: CassetteBudgetLedgerEntry): void;
  recordInFlightEvent(e: CassetteInFlightEvent): void;
  recordLlmCall(c: CassetteLlmCall): void;
  recordFinalResult(r: CassetteFinalResult): void;
  setPathShape(shape: ReplayPathShape): void;
  /** Persist the cassette + emit CV-13 metrics. */
  finalize(): Promise<ReplayCassette | null>;
  /** Abandon — wipe redaction map. */
  abandon(): void;
}

class LiveRecorder implements ReplayRecorder {
  private readonly source: ReplayCassetteSource;
  private readonly map = new RedactionMap();
  private pathShape: ReplayPathShape = "clean";
  private input?: CassetteInput;
  private contextResolved?: CassetteContextResolved;
  private readonly engineOutputs: CassetteEngineOutput[] = [];
  private synthesisInput?: CassetteSynthesisInput;
  private planPersist?: CassettePlanPersist;
  private systemControlVerdict?: CassetteSystemControlVerdict;
  private readonly budgetLedger: CassetteBudgetLedgerEntry[] = [];
  private readonly inFlightEvents: CassetteInFlightEvent[] = [];
  private readonly llmCalls: CassetteLlmCall[] = [];
  private finalResult?: CassetteFinalResult;
  private overheadStartMs = 0;
  private overheadAccumMs = 0;
  private readonly runStartedAt: number;
  constructor(
    public readonly jobId: string,
    source: ReplayCassetteSource,
    private readonly now: () => number,
  ) {
    this.source = source;
    this.runStartedAt = now();
  }

  private timed<T>(fn: () => T): T {
    const t0 = this.now();
    try {
      return fn();
    } finally {
      this.overheadAccumMs += this.now() - t0;
    }
  }

  recordInput(input: CassetteInput): void {
    this.timed(() => {
      this.input = redactValue(input, this.map);
    });
  }
  recordContextResolved(ctx: CassetteContextResolved): void {
    this.timed(() => {
      this.contextResolved = redactValue(ctx, this.map);
    });
  }
  recordEngineOutput(output: CassetteEngineOutput): void {
    this.timed(() => {
      this.engineOutputs.push(redactValue(output, this.map));
    });
  }
  recordSynthesisInput(s: CassetteSynthesisInput): void {
    this.timed(() => {
      this.synthesisInput = redactValue(s, this.map);
    });
  }
  recordPlanPersist(p: CassettePlanPersist): void {
    this.timed(() => {
      this.planPersist = redactValue(p, this.map);
    });
  }
  recordSystemControlVerdict(v: CassetteSystemControlVerdict): void {
    this.timed(() => {
      this.systemControlVerdict = redactValue(v, this.map);
    });
  }
  recordBudgetLedgerEntry(e: CassetteBudgetLedgerEntry): void {
    this.timed(() => {
      this.budgetLedger.push(redactValue(e, this.map));
    });
  }
  recordInFlightEvent(e: CassetteInFlightEvent): void {
    this.timed(() => {
      this.inFlightEvents.push(redactValue(e, this.map));
    });
  }
  recordLlmCall(c: CassetteLlmCall): void {
    this.timed(() => {
      this.llmCalls.push(redactValue(c, this.map));
    });
  }
  recordFinalResult(r: CassetteFinalResult): void {
    this.timed(() => {
      this.finalResult = redactValue(r, this.map);
    });
  }
  setPathShape(shape: ReplayPathShape): void {
    this.pathShape = shape;
  }

  async finalize(): Promise<ReplayCassette | null> {
    const t0 = this.now();
    if (!this.input || !this.contextResolved || !this.finalResult) {
      // Doctrine: missing canonical → don't silently emit a partial cassette.
      logger.warn({
        msg: "[ReplayRecorder] FINALIZE_SKIPPED_INCOMPLETE",
        jobId: this.jobId,
        hasInput: !!this.input,
        hasContext: !!this.contextResolved,
        hasFinalResult: !!this.finalResult,
      });
      this.map.clear();
      return null;
    }
    const body: ReplayCassetteBody = {
      schemaVersion: REPLAY_CASSETTE_SCHEMA_VERSION,
      source: this.source,
      pathShape: this.pathShape,
      capturedAt: new Date(this.now()).toISOString(),
      input: this.input,
      contextResolved: this.contextResolved,
      engineOutputs: this.engineOutputs,
      synthesisInput: this.synthesisInput,
      planPersist: this.planPersist,
      systemControlVerdict: this.systemControlVerdict,
      budgetLedger: this.budgetLedger,
      inFlightEvents: this.inFlightEvents,
      llmCalls: this.llmCalls,
      finalResult: this.finalResult,
    };
    // Doctrine REPLAY-HASH: cassette content-address is SHA-256 of the
    // INPUT envelope only — NOT the entire body. Two captures of the same
    // (campaignId, accountId, forceRefresh, scopedEngines, …) must produce
    // the same cassetteHash so the corpus dedupes (`ON CONFLICT DO NOTHING`
    // on the unique index) and the player can resolve a cassette by its
    // input-fingerprint. The body's per-engine outputs / verdict / ledger
    // are NOT part of the hash — those are the EXPECTATIONS the player
    // diffs against, not part of the cassette's identity.
    const cassetteHash = hashValue(this.input);
    const cassette: ReplayCassette = { cassetteHash, body };

    try {
      // RETURNING cassette_hash so we can distinguish a real insert from a
      // dedupe-conflict — CV-13 cassette count must only increment on
      // ACTUAL new corpus rows, not on duplicate input captures (otherwise
      // the metric drifts upward unboundedly during steady-state recording
      // of a hot campaign).
      const res = await pool.query<{ cassette_hash: string }>(
        `INSERT INTO orchestrator_replay_cassettes
          (cassette_hash, schema_version, source, captured_at, redaction_applied,
           path_shape, campaign_id, account_id, body)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
         ON CONFLICT (cassette_hash) DO NOTHING
         RETURNING cassette_hash`,
        [
          cassetteHash,
          REPLAY_CASSETTE_SCHEMA_VERSION,
          this.source,
          new Date(this.now()).toISOString(),
          true,
          this.pathShape,
          this.input.campaignId,
          this.input.accountId,
          JSON.stringify(body),
        ],
      );
      if (res.rows.length > 0) {
        recordCassetteCaptured(this.source);
      } else {
        logger.debug({
          msg: "[ReplayRecorder] DEDUPED",
          jobId: this.jobId,
          cassetteHash,
        });
      }
    } catch (err) {
      // No silent catches — surface to operator (Seal #15 doctrine).
      logger.error({
        msg: "[ReplayRecorder] PERSIST_FAILED",
        jobId: this.jobId,
        cassetteHash,
        err: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.overheadAccumMs += this.now() - t0;
      const totalMs = Math.max(1, this.now() - this.runStartedAt);
      recordRecorderOverheadRatio(this.overheadAccumMs / totalMs);
      this.map.clear();
    }
    return cassette;
  }

  abandon(): void {
    this.map.clear();
  }
}

const NoOpRecorder: ReplayRecorder = {
  jobId: "",
  recordInput() {},
  recordContextResolved() {},
  recordEngineOutput() {},
  recordSynthesisInput() {},
  recordPlanPersist() {},
  recordSystemControlVerdict() {},
  recordBudgetLedgerEntry() {},
  recordInFlightEvent() {},
  recordLlmCall() {},
  recordFinalResult() {},
  setPathShape() {},
  async finalize() {
    return null;
  },
  abandon() {},
};

let invocationCounter = 0;

export function _resetRecorderCounterForTests(): void {
  invocationCounter = 0;
}

/**
 * The single allowed entry-point for recorder construction. Orchestrator
 * code calls this with a jobId; if the recorder is gated off (default in
 * production), returns the no-op recorder so every boundary hook compiles
 * to a function-call no-op.
 *
 * Doctrine: direct construction of `LiveRecorder` outside this file is
 * forbidden — see `no-bare-llm-call-in-replay` for the related lint.
 */
export function withReplayRecorder(
  jobId: string,
  opts: RecorderOptions = {},
): ReplayRecorder {
  const gate = opts.forceEnabled === true
    ? { enabled: true, sampleEvery: 1 }
    : opts.forceEnabled === false
      ? { enabled: false, sampleEvery: 0 }
      : parseRecorderGate(process.env.ORCH_REPLAY_RECORD);
  if (!gate.enabled) return NoOpRecorder;
  invocationCounter += 1;
  const roll = opts.sampleRollOverride ?? invocationCounter;
  if (gate.sampleEvery > 1 && roll % gate.sampleEvery !== 0) return NoOpRecorder;
  const source = opts.source ?? "production";
  const now = opts.now ?? (() => Date.now());
  return new LiveRecorder(jobId, source, now);
}

/**
 * AsyncLocalStorage scope for the active recorder during a runOrchestrator
 * invocation. `withRecorderScope(recorder, fn)` runs `fn` (the orchestrator
 * body) with the recorder bound; `getCurrentRecorder()` returns the bound
 * recorder from any awaited callee — including `ai-client.aiChat` /
 * `aiGemini` — so LLM calls flow into `recordLlmCall` without the
 * orchestrator having to thread the recorder through 15+ engine adapter
 * signatures.
 *
 * Doctrine REPLAY-LLM-INTERCEPT: every LLM call originating inside a
 * runOrchestrator scope MUST flow through ai-client.ts. ai-client.ts
 * MUST call `getCurrentRecorder()?.recordLlmCall(...)` after each call.
 * Failure to do so leaves `cassette.llmCalls` empty for real runs,
 * making the corpus useless for strict replay (player can't mock what
 * was never captured).
 *
 * Production safety: when the gate is off (default), `getCurrentRecorder()`
 * returns `undefined` (we never bind the ALS scope). Zero overhead.
 */
const recorderScope = new AsyncLocalStorage<ReplayRecorder>();

export function getCurrentRecorder(): ReplayRecorder | undefined {
  const r = recorderScope.getStore();
  // The no-op recorder is functionally `undefined` for LLM callers — skip
  // the redundant push so we don't pay for a redact pass when gated off.
  if (!r || r === NoOpRecorder) return undefined;
  return r;
}

export async function withRecorderScope<T>(
  recorder: ReplayRecorder,
  fn: () => Promise<T>,
): Promise<T> {
  // Skip the ALS push entirely for the no-op recorder so the production
  // hot path (gate OFF) pays nothing for the scope.
  if (recorder === NoOpRecorder) return fn();
  return recorderScope.run(recorder, fn);
}

/**
 * Bind the recorder to the current async context WITHOUT wrapping. Lets
 * runOrchestrator install the recorder near the function top without
 * restructuring 1200 lines of imperative body into a callback. The bind
 * is inherited by every awaited callee until the async chain unwinds.
 *
 * No-op when the recorder is the gated-off NoOpRecorder so we don't pay
 * for the ALS push on the production hot path.
 */
export function enterRecorderScope(recorder: ReplayRecorder): void {
  if (recorder === NoOpRecorder) return;
  recorderScope.enterWith(recorder);
}

let llmCallCounter = 0;
export function _nextLlmCallOrder(): number {
  llmCallCounter += 1;
  return llmCallCounter;
}
export function _resetLlmCallCounterForTests(): void {
  llmCallCounter = 0;
}

/** Test-only: build a live recorder regardless of env gate. */
export function _liveRecorderForTests(
  jobId: string,
  opts: { now?: () => number; source?: ReplayCassetteSource } = {},
): ReplayRecorder {
  return new LiveRecorder(jobId, opts.source ?? "synthetic", opts.now ?? (() => Date.now()));
}
