/**
 * Task #89 / Phase 4-A — Replay / Shadow Harness — cassette types.
 *
 * A ReplayCassette is a content-addressed, deterministic recording of one
 * `runOrchestrator(...)` invocation. The player consumes a cassette and
 * runs a candidate orchestrator with all LLM calls STRICTLY mocked from the
 * recorded outputs.
 *
 * Schema versioning is enforced — the player rejects cassettes with an
 * unknown `schemaVersion`. Bump REPLAY_CASSETTE_SCHEMA_VERSION when the
 * cassette shape changes in a non-back-compat way, and add a migration
 * path in the player.
 */

export const REPLAY_CASSETTE_SCHEMA_VERSION = 1 as const;

/** Path-shape tag — used by the operator panel coverage matrix. */
export type ReplayPathShape =
  | "clean"
  | "gate_retry"
  | "budget_downgrade"
  | "scoped_rerun"
  | "blocked_by_integrity"
  | "needs_input"
  | "error";

export type ReplayCassetteSource = "production" | "synthetic";

/** The frozen orchestrator input — feeds the run-id hash. */
export interface CassetteInput {
  campaignId: string;
  accountId: string;
  forceRefresh: boolean;
  resumeFromEngine?: string;
  pausedJobId?: string;
  preassignedJobId?: string;
  scopedEngines?: string[];
}

/** Snapshot of resolved engine context at orchestrator entry. */
export interface CassetteContextResolved {
  sscPresent: boolean;
  contextKeys: string[];
  inputHashes: Record<string, string>;
}

/** One recorded engine output, in execution order. */
export interface CassetteEngineOutput {
  /** Monotonic 0-based index — preserves the deterministic engine order. */
  order: number;
  engineId: string;
  engineName: string;
  tier: string;
  status: string;
  durationMs: number;
  /** Engine output payload — already PII-redacted before persistence. */
  output: unknown;
  blockReason?: string;
}

/** Plan-synthesis input shape — captured immediately before synthesis. */
export interface CassetteSynthesisInput {
  engineCount: number;
  controlVerdictPresent: boolean;
  ledgerEntryCount: number;
  fingerprint: string;
}

/** A plan-persist call — what was about to hit the DB. */
export interface CassettePlanPersist {
  planId: string;
  source: string;
  degraded: boolean;
  synthesisVerification?: unknown;
}

/** A system-control verdict snapshot. */
export interface CassetteSystemControlVerdict {
  integrityVerdict?: string;
  executionMode?: string;
  blockReasons: string[];
}

/** One budget-decision-ledger entry (canonical D2 fields only). */
export interface CassetteBudgetLedgerEntry {
  engineId: string;
  decisionAction?: string;
  downgradeReason?: string;
  appliedAt: number;
}

/** One in-flight-lifecycle event (register / heartbeat / settle). */
export interface CassetteInFlightEvent {
  jobId: string;
  event: "register" | "heartbeat" | "settle";
  status?: string;
  at: number;
}

/** One recorded LLM call — keyed by (callOrder, provider, model, promptHash). */
export interface CassetteLlmCall {
  callOrder: number;
  provider: "openai" | "gemini";
  model: string;
  /** SHA-256 hex of the canonicalised prompt — keys strict-mock lookup. */
  promptHash: string;
  /** The recorded full response payload (already redacted). */
  response: unknown;
}

/** Final OrchestratorRunResult shape (subset that diff compares on). */
export interface CassetteFinalResult {
  jobId: string;
  status: string;
  completedEngines: string[];
  failedEngine?: string;
  blockReason?: string;
  planId?: string;
  durationMs: number;
  controlVerdict?: CassetteSystemControlVerdict;
  ledgerEntryCount: number;
}

/** The full cassette body persisted to `orchestrator_replay_cassettes.body`. */
export interface ReplayCassetteBody {
  schemaVersion: typeof REPLAY_CASSETTE_SCHEMA_VERSION;
  source: ReplayCassetteSource;
  pathShape: ReplayPathShape;
  capturedAt: string;
  input: CassetteInput;
  contextResolved: CassetteContextResolved;
  engineOutputs: CassetteEngineOutput[];
  synthesisInput?: CassetteSynthesisInput;
  planPersist?: CassettePlanPersist;
  systemControlVerdict?: CassetteSystemControlVerdict;
  budgetLedger: CassetteBudgetLedgerEntry[];
  inFlightEvents: CassetteInFlightEvent[];
  llmCalls: CassetteLlmCall[];
  finalResult: CassetteFinalResult;
}

/** The full cassette including its content-address hash. */
export interface ReplayCassette {
  cassetteHash: string;
  body: ReplayCassetteBody;
}

/** Divergence taxonomy — declared classes for the diff classifier. */
export type DivergenceClass =
  | "STRUCTURAL"
  | "CANONICAL_FIELD"
  | "DEGRADATION_SURFACE"
  | "BUDGET_LEDGER"
  | "PROVENANCE"
  | "ORDER"
  | "TIMING_ONLY";

export interface Divergence {
  class: DivergenceClass;
  path: string;
  expected: unknown;
  actual: unknown;
  note?: string;
}

export interface ReplayResult {
  cassetteHash: string;
  divergences: Divergence[];
  engineWallClockMs: number;
  finalPlanHash: string;
  finalVerdictHash: string;
  /** True iff every divergence is TIMING_ONLY. */
  passed: boolean;
}
