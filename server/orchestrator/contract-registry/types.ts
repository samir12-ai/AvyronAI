/**
 * Engine Contract Registry — Type definitions (Phase C0 foundation)
 *
 * STATUS: Foundation only — nothing in this module is called yet by the
 * runtime. Lives behind the rollout gate documented in
 * `.local/plans/engine-contract-global-enforcement.md` (sections §0–§9).
 *
 * This file owns the *language* that every cross-engine read will eventually
 * speak. It does NOT yet enforce anything; the helpers in `helpers.ts` are
 * pure functions that compute values from a snapshot, but no consumer is
 * wired to them in C0. Wiring happens in C1 (channel-selection cutover) and
 * C2 (shadow validation across all 15 engines).
 *
 * Doctrine (from plan §0):
 *   No stale, legacy, reused-from-another-run, contract-incomplete, or
 *   field-mismatched snapshot can ever be treated as live evidence for any
 *   live decision. Such snapshots are demoted to historical context with a
 *   label and excluded from every live-decision path.
 */

import type { ZodSchema } from "zod";
import type { EngineId } from "../priority-matrix";
import type { FreshnessClass } from "../../shared/snapshot-trust";

// ────────────────────────────────────────────────────────────────────────────
// 1. Snapshot trust model (plan §2)
// ────────────────────────────────────────────────────────────────────────────

/**
 * The 10-state trust classification produced by `classifyTrust(...)`. Each
 * snapshot read in any verdict-critical path is mapped to exactly one of
 * these states; only the first three are eligible to feed live decisions.
 */
export type SnapshotTrustState =
  /** Produced this run (no `_provenance` row), contract complete. */
  | "FRESH_VERIFIED"
  /** Reused this run, sourceJobId === currentJobId, contract complete. */
  | "CURRENT_RUN_VERIFIED"
  /** Reused from a prior run, freshnessClass FRESH/AGING, contract complete. */
  | "REUSED_ALLOWED"
  /** Reused, contract metadata present but unverified at write time. */
  | "REUSED_UNVERIFIED"
  /** freshnessClass=NEEDS_REFRESH OR ageInDays beyond livenessRule limit. */
  | "STALE"
  /** No `_provenance` AND no contractStatus — pre-contract snapshot. */
  | "LEGACY_UNVERIFIED"
  /** contractStatus present, requiredOutputs not satisfied. */
  | "CONTRACT_INCOMPLETE"
  /** sourceJobId !== currentJobId in a context that requires same-run. */
  | "WRONG_RUN"
  /** schemaVersion !== engineVersion. */
  | "INCOMPATIBLE_VERSION"
  /** snapshot-trust class NEEDS_REFRESH (kept distinct from generic STALE). */
  | "NEEDS_REFRESH"
  /**
   * P5 isolation seal — sourceAccountId on the provenance row does not match
   * the current orchestrator's accountId. This is a HARD failure: it means a
   * snapshot belonging to another tenant somehow reached a live-decision
   * read. Never live-eligible. Logged at ERROR severity by the consumer.
   */
  | "WRONG_ACCOUNT"
  /**
   * P5 isolation seal — sourceCampaignId on the provenance row does not
   * match the current orchestrator's campaignId (within the same account).
   * Never live-eligible. Same severity as WRONG_ACCOUNT.
   */
  | "WRONG_CAMPAIGN";

/** Contract-completeness verdict for a single snapshot row. */
export type ContractStatus = "COMPLETE" | "INCOMPLETE" | "INVALID" | "LEGACY_NONE";

/**
 * Live-decision eligibility table (plan §2). Mirrored in `isLiveEligible()`.
 * Encoded as a constant so tests can assert it never silently changes.
 */
export const LIVE_ELIGIBLE_STATES: ReadonlyArray<SnapshotTrustState> = [
  "FRESH_VERIFIED",
  "CURRENT_RUN_VERIFIED",
  "REUSED_ALLOWED",
];

/** True iff the trust state is allowed to feed any live (non-scaling) decision. */
export function isLiveEligible(state: SnapshotTrustState): boolean {
  return LIVE_ELIGIBLE_STATES.includes(state);
}

/**
 * `REUSED_ALLOWED` is allowed for non-scaling decisions but NOT for
 * `budget=scale` (plan §2 row 2). This helper is the single point of truth.
 */
export function isLiveEligibleForScaling(state: SnapshotTrustState): boolean {
  return state === "FRESH_VERIFIED" || state === "CURRENT_RUN_VERIFIED";
}

// ────────────────────────────────────────────────────────────────────────────
// 2. Contract registry schema (plan §4)
// ────────────────────────────────────────────────────────────────────────────

/**
 * The liveness rule controls whether a downstream consumer is allowed to use
 * a snapshot from a prior run.
 *
 *   - `current_run_only` — verdict-critical engines. The default for the 14
 *     strategy/messaging engines. Recovery, system-control, build-plan,
 *     budget-governor, channel-selection, and similar consumers will only
 *     accept a value whose snapshot belongs to the current orchestrator job.
 *
 *   - `reuse_allowed` — explicit opt-in for non-strategic reads (e.g. the
 *     market_intelligence engine, where the underlying market is stable
 *     within the freshness window).
 */
export type LivenessRule = "current_run_only" | "reuse_allowed";

/**
 * One declared output of an engine. The `path` and `legacyPaths` are arrays
 * (not dotted strings) so we can resolve them by reduce instead of `eval`.
 */
export interface ContractField {
  /** Canonical field id used by every consumer (e.g. `"funnelStages"`). */
  id: string;
  /**
   * Path into `EngineStepResult.output`. Empty array means the entire output
   * object is the value — used for engines whose output IS the field.
   */
  path: ReadonlyArray<string | number>;
  /**
   * Tolerated alternate paths during migration. The resolver tries `path`
   * first; on miss, walks `legacyPaths` in order. C5 cleanup removes these
   * once shadow logs prove no consumer reads the legacy location.
   */
  legacyPaths?: ReadonlyArray<ReadonlyArray<string | number>>;
  /** Runtime validation. `requireContractField` runs this on the resolved value. */
  shape: ZodSchema;
  /**
   * If true, an empty array, empty object, or empty string at the resolved
   * path is treated as missing (returns `INCOMPLETE`, not `OK`). If false,
   * those values are valid and pass through to the consumer.
   */
  emptyIsMissing: boolean;
  /**
   * Consumer ids (`"file.surface"` strings) that read this field. Used by
   * the C2 ts-morph CI verifier to ensure every declared consumer actually
   * exists in the codebase, and that every direct `result.output?.X` access
   * is declared here.
   */
  consumers: ReadonlyArray<string>;
}

/**
 * The full contract for one engine. One entry lives in the registry per
 * engine id in `EngineId`. C0 ships entries for `channel_selection` and
 * `funnel` only (per plan §9 C0+C1); the remaining 13 are filled in during
 * C2 shadow validation.
 */
export interface EngineContract {
  engineId: EngineId;
  /** Imported from the engine's own `ENGINE_VERSION` constant. */
  engineVersion: number;
  /** Default liveness rule for downstream reads (plan §4 default). */
  livenessRule: LivenessRule;
  /**
   * Outputs every consumer is allowed to assume are present when the engine
   * reports SUCCESS. Missing/empty required outputs degrade the engine to
   * `CONTRACT_INCOMPLETE` (plan §3 status extension).
   */
  requiredOutputs: ReadonlyArray<ContractField>;
  /**
   * Outputs that may be present but no live-decision consumer is allowed to
   * require. Missing optional outputs do NOT degrade the engine status.
   */
  optionalOutputs: ReadonlyArray<ContractField>;
  /**
   * Names of every consumer surface that depends on this engine's outputs.
   * Used by `getDownstreamConsumers()` and the dependency graph emitter.
   */
  requiredBy: ReadonlyArray<string>;
}

// ────────────────────────────────────────────────────────────────────────────
// 3. Boundary-helper return type (plan §1.2)
// ────────────────────────────────────────────────────────────────────────────

/**
 * The discriminated-union return type of `requireContractField(...)`. Every
 * cross-engine read in C1+ goes through this. `OK` is the only branch that
 * carries a value; every other branch carries a `reason` string the
 * consumer is expected to surface (typically as a `NOT_REACHED`/`STALE`/
 * `UNKNOWN` structural check status — see Phase R T001).
 */
export type ContractFieldResult<T> =
  | { status: "OK"; value: T; trustState: SnapshotTrustState }
  | { status: "NOT_REACHED"; reason: string }
  | { status: "STALE"; reason: string; trustState: SnapshotTrustState }
  | { status: "INCOMPLETE"; reason: string }
  | { status: "INVALID"; reason: string };

// ────────────────────────────────────────────────────────────────────────────
// 4. Live-snapshot envelope (plan §7)
// ────────────────────────────────────────────────────────────────────────────

/**
 * The shape every API route returns when it surfaces an engine output. The
 * frontend reads exactly two boolean flags (`isLiveEvidence`,
 * `isHistoricalOnly`) and never re-derives trust on its own.
 *
 * C0 ships the type. C2 wires `wrapAsEnvelope(...)` into the engine routes
 * and emits envelopes behind a feature flag. C3 makes the FE consume them.
 */
export interface LiveSnapshotEnvelope<T = unknown> {
  // Identity
  runId: string | null;
  snapshotId: string;
  sourceJobId: string | null;
  campaignId: string;
  engineId: EngineId;
  engineVersion: number;

  // Trust
  trustState: SnapshotTrustState;
  freshnessClass: FreshnessClass | null;
  contractStatus: ContractStatus;
  missingRequiredOutputs: string[];
  invalidFields: { fieldId: string; reason: string }[];
  wasReused: boolean;
  ageInDays: number | null;

  // Decision flags (the only ones consumers should check)
  isLiveEvidence: boolean;
  isHistoricalOnly: boolean;

  // Payload
  data: T;
}

// ────────────────────────────────────────────────────────────────────────────
// 5. Engine status model — additive extension (plan §3)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Three engine-status values added by the contract layer. They sit alongside
 * the existing `EngineStepResult["status"]` union (`SUCCESS | SKIPPED | …`)
 * and join `ENGINE_NOT_REACHED_STATUSES` in `structural-checks.ts` so every
 * downstream `notReached(...)` path treats them uniformly.
 *
 * NOTE (C0): we declare the type here but do NOT yet widen
 * `EngineStepResult["status"]` in `priority-matrix.ts`. That widening
 * happens in C2 when the orchestrator wrapper begins emitting these
 * statuses behind the `ENFORCE_ENGINE_CONTRACTS` feature flag.
 */
export type ContractEngineStatus =
  | "PARTIAL"               // all required present, ≥1 optional missing — SUCCESS for live decisions
  | "CONTRACT_INCOMPLETE"   // engine SUCCESS but ≥1 required missing — treated as NOT_REACHED downstream
  | "INVALID_OUTPUT";       // required output present but failed Zod — distinct error code

/**
 * Statuses that downstream checks must treat as "engine did not produce
 * usable input." Consumed by `requireContractField` and the structural-check
 * `notReached` helper once C2 enables enforcement.
 */
export const CONTRACT_NOT_REACHED_STATUSES: ReadonlyArray<ContractEngineStatus | "TIMEOUT" | "ERROR" | "BLOCKED" | "SIGNAL_BLOCKED" | "DEPTH_BLOCKED" | "BLOCKED_BY_INTEGRITY" | "NEEDS_INPUT" | "SKIPPED"> = [
  "CONTRACT_INCOMPLETE",
  "INVALID_OUTPUT",
  "TIMEOUT",
  "ERROR",
  "BLOCKED",
  "SIGNAL_BLOCKED",
  "DEPTH_BLOCKED",
  "BLOCKED_BY_INTEGRITY",
  "NEEDS_INPUT",
  "SKIPPED",
];

// ────────────────────────────────────────────────────────────────────────────
// 6. Snapshot provenance shape consumed by `classifyTrust`
// ────────────────────────────────────────────────────────────────────────────

/**
 * The minimal shape `classifyTrust` and `requireContractField` read from a
 * snapshot row to decide trust state. Mirrors `SnapshotProvenance` in
 * `system-control/types.ts` plus the freshness fields produced by
 * `snapshot-trust.ts`. Kept here as its own interface so the contract
 * registry has zero outbound dependencies on system-control internals.
 */
export interface ProvenanceForTrust {
  sourceJobId: string | null;
  createdAt: string | null;
  wasReused: boolean;
  freshnessClass?: FreshnessClass | null;
  ageInDays?: number | null;
  /**
   * Persisted schema version of this snapshot. When present and not equal
   * to the engine's current `engineVersion`, the trust state becomes
   * `INCOMPATIBLE_VERSION` regardless of freshness.
   */
  schemaVersion?: number | null;
  /**
   * P5 isolation seal — the accountId / campaignId the snapshot was
   * originally produced for. When set on the provenance row AND a current
   * accountId/campaignId is supplied to `classifyTrust`, a mismatch produces
   * `WRONG_ACCOUNT` / `WRONG_CAMPAIGN` (both non-live-eligible).
   *
   * Optional for backward compatibility: pre-P5 snapshots and in-process
   * callers that don't yet pass the current account/campaign behave exactly
   * as before. The cross-tenant kill-switch fires only when both sides are
   * present and disagree.
   */
  sourceAccountId?: string | null;
  sourceCampaignId?: string | null;
}

/** Mode for classifyTrust: strict (current_run_only) vs lenient (reuse_allowed). */
export type ClassifyTrustMode = "current_run_only" | "reuse_allowed";
