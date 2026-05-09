/**
 * Engine Contract Registry — Boundary helpers (Phase C0 foundation)
 *
 * STATUS: Pure functions. None of these are called by the runtime in C0.
 *   - C1 wires `requireContractField(...)` into the 5 broken
 *     `channel_selection.funnelStages` consumers.
 *   - C2 wires `classifyTrust(...)` and `wrapAsEnvelope(...)` into the
 *     orchestrator engine wrapper and the engine `routes.ts` "latest" endpoints
 *     behind the `ENFORCE_ENGINE_CONTRACTS` feature flag.
 *   - C3 makes the FE read `LiveSnapshotEnvelope.isLiveEvidence`.
 *
 * Doctrine: every cross-engine read in C1+ MUST go through one of these
 * helpers. Direct `result.output?.foo` access is forbidden by the C2 ESLint
 * rule and the ts-morph CI verifier (plan §6).
 */

import type { ZodSchema } from "zod";
import type { EngineId, EngineStepResult } from "../priority-matrix";
import { ENGINE_CONTRACT_REGISTRY } from "./registry";
import {
  type ContractField,
  type ContractFieldResult,
  type ContractStatus,
  type EngineContract,
  type LiveSnapshotEnvelope,
  type ProvenanceForTrust,
  type SnapshotTrustState,
  type ClassifyTrustMode,
  isLiveEligible,
} from "./types";

// ────────────────────────────────────────────────────────────────────────────
// 1. Registry lookups (plan §5 — graph IS the registry)
// ────────────────────────────────────────────────────────────────────────────

/** Returns the contract for an engine, or `null` if none is registered yet. */
export function getContract(engineId: EngineId): EngineContract | null {
  return ENGINE_CONTRACT_REGISTRY[engineId] ?? null;
}

/** Returns the required-output ContractField list for an engine. */
export function getRequiredFields(engineId: EngineId): ReadonlyArray<ContractField> {
  return getContract(engineId)?.requiredOutputs ?? [];
}

/**
 * Returns every (engineId, fieldId, consumer) triple where this engine's
 * outputs are read by some downstream surface. Used by the dependency-graph
 * emitter and (in C2) by the pre-launch dependency check that refuses to
 * start engine Y if any upstream is `CONTRACT_INCOMPLETE`/`INVALID_OUTPUT`.
 */
export function getDownstreamConsumers(
  engineId: EngineId,
): ReadonlyArray<{ engineId: EngineId; fieldId: string; consumer: string }> {
  const contract = getContract(engineId);
  if (!contract) return [];
  const out: { engineId: EngineId; fieldId: string; consumer: string }[] = [];
  for (const f of contract.requiredOutputs) {
    for (const c of f.consumers) out.push({ engineId, fieldId: f.id, consumer: c });
  }
  for (const f of contract.optionalOutputs) {
    for (const c of f.consumers) out.push({ engineId, fieldId: f.id, consumer: c });
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// 2. Path resolution
// ────────────────────────────────────────────────────────────────────────────

/**
 * Walks a path array against a value. Returns `undefined` if any segment
 * misses. Pure — no exceptions thrown for null/undefined chain breaks.
 */
function resolvePath(value: unknown, path: ReadonlyArray<string | number>): unknown {
  let cur: any = value;
  for (const seg of path) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[seg as any];
  }
  return cur;
}

/** True iff value should be treated as missing under `emptyIsMissing` semantics. */
function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "string") return value.trim().length === 0;
  if (typeof value === "object") return Object.keys(value as object).length === 0;
  return false;
}

// ────────────────────────────────────────────────────────────────────────────
// 3. Trust classification (plan §2)
// ────────────────────────────────────────────────────────────────────────────

/**
 * The single function that maps a snapshot's provenance + freshness +
 * version + contract status into one of the 10 `SnapshotTrustState` values.
 * No consumer derives trust on its own; everyone calls this.
 *
 * @param prov Provenance metadata stamped onto the snapshot. Pass `null`
 *             to indicate "fresh in-run result with no provenance row" —
 *             which maps to `FRESH_VERIFIED` when the contract is complete.
 * @param contractStatus Verdict from `validateContractCompleteness(...)`.
 * @param currentJobId The orchestrator job currently being evaluated.
 * @param mode The downstream consumer's liveness rule.
 * @param engineVersion Current engine version (for INCOMPATIBLE_VERSION).
 */
export function classifyTrust(
  prov: ProvenanceForTrust | null,
  contractStatus: ContractStatus,
  currentJobId: string | null,
  mode: ClassifyTrustMode,
  engineVersion: number,
): SnapshotTrustState {
  // 1. No provenance + no contract → pre-contract legacy snapshot.
  if (prov === null && contractStatus === "LEGACY_NONE") return "LEGACY_UNVERIFIED";

  // 2. Schema/version mismatch dominates everything.
  if (prov?.schemaVersion != null && prov.schemaVersion !== engineVersion) {
    return "INCOMPATIBLE_VERSION";
  }

  // 3. Contract failures dominate freshness.
  if (contractStatus === "INCOMPLETE" || contractStatus === "INVALID") {
    return "CONTRACT_INCOMPLETE";
  }

  // 4. Freshness-class mapping (plan §2).
  const fc = prov?.freshnessClass ?? null;
  if (fc === "INCOMPATIBLE") return "INCOMPATIBLE_VERSION";
  if (fc === "NEEDS_REFRESH") return "NEEDS_REFRESH";
  if (fc === "RESTORED" || fc === "PARTIAL") return "REUSED_UNVERIFIED";

  // 5. Run-id mapping.
  const sourceJobId = prov?.sourceJobId ?? null;
  const sameJob = sourceJobId !== null && currentJobId !== null && sourceJobId === currentJobId;
  const diffJob = sourceJobId !== null && currentJobId !== null && sourceJobId !== currentJobId;

  // 5a. No provenance row → produced this run (no _provenance is the
  // orchestrator's "fresh" indicator). Contract is COMPLETE here.
  if (prov === null) return "FRESH_VERIFIED";

  // 5b. Reused this run.
  if (sameJob) return "CURRENT_RUN_VERIFIED";

  // 5c. Reused from a prior run.
  if (diffJob) {
    if (mode === "current_run_only") return "WRONG_RUN";
    // mode === "reuse_allowed" — defer to freshness class.
    if (fc === "FRESH" || fc === "AGING") return "REUSED_ALLOWED";
    return "STALE";
  }

  // 5d. Provenance present but no sourceJobId — treat as legacy.
  return "REUSED_UNVERIFIED";
}

// ────────────────────────────────────────────────────────────────────────────
// 4. Contract completeness (used by classifyTrust + envelope wrapper)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Validates that every required field is present (+ non-empty per the
 * field's `emptyIsMissing` setting) and passes its Zod shape. Returns the
 * contract verdict plus the list of missing/invalid fields for the envelope.
 */
export function validateContractCompleteness(
  engineId: EngineId,
  output: unknown,
): {
  status: ContractStatus;
  missingRequiredOutputs: string[];
  invalidFields: { fieldId: string; reason: string }[];
} {
  const contract = getContract(engineId);
  if (!contract) {
    // No contract registered yet → pre-contract LEGACY semantics.
    return { status: "LEGACY_NONE", missingRequiredOutputs: [], invalidFields: [] };
  }

  const missing: string[] = [];
  const invalid: { fieldId: string; reason: string }[] = [];

  for (const field of contract.requiredOutputs) {
    const resolved = resolveFromAllPaths(output, field);
    if (resolved === undefined || (field.emptyIsMissing && isEmpty(resolved))) {
      missing.push(field.id);
      continue;
    }
    const parse = field.shape.safeParse(resolved);
    if (!parse.success) {
      invalid.push({
        fieldId: field.id,
        reason: parse.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; "),
      });
    }
  }

  if (invalid.length > 0) return { status: "INVALID", missingRequiredOutputs: missing, invalidFields: invalid };
  if (missing.length > 0) return { status: "INCOMPLETE", missingRequiredOutputs: missing, invalidFields: [] };
  return { status: "COMPLETE", missingRequiredOutputs: [], invalidFields: [] };
}

/** Resolve via `path` first, then walk `legacyPaths` in order. */
function resolveFromAllPaths(output: unknown, field: ContractField): unknown {
  const primary = resolvePath(output, field.path);
  if (primary !== undefined) return primary;
  for (const lp of field.legacyPaths ?? []) {
    const v = resolvePath(output, lp);
    if (v !== undefined) return v;
  }
  return undefined;
}

/**
 * Returns a LIVE REFERENCE to the resolved value (no Zod copy, no trust
 * gating, no engine-status check). Use ONLY when you need to mutate the
 * underlying object — e.g. system-control's `executeConversionInjection`
 * pushes onto `funnelStages.conversion` and the mutation must be visible
 * downstream. Read-only consumers must use `requireContractField` so they
 * pick up validation, freshness gating, and contract enforcement.
 *
 * Returns `undefined` if the field is unregistered or absent at every path.
 */
export function getContractFieldRaw<T = unknown>(
  engineId: EngineId,
  fieldId: string,
  output: unknown,
): T | undefined {
  const contract = getContract(engineId);
  if (!contract) return undefined;
  const field =
    contract.requiredOutputs.find((f) => f.id === fieldId) ??
    contract.optionalOutputs.find((f) => f.id === fieldId);
  if (!field) return undefined;
  const v = resolveFromAllPaths(output, field);
  return v as T | undefined;
}

// ────────────────────────────────────────────────────────────────────────────
// 5. The boundary helper — the ONLY way to read another engine's output (C1+)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Reads `fieldId` from `engineId`'s result in the orchestrator results map,
 * applying contract resolution, Zod validation, freshness checks, and run-id
 * gating in one call. Returns a `ContractFieldResult<T>` discriminated union
 * — callers MUST handle every branch. This replaces every direct
 * `results.get(engineId)?.output?.foo` access in `server/system-control/`,
 * `server/strategy/`, `server/build-plan-layer/`, and `server/recovery/`.
 *
 * @param engineId      Upstream engine to read from.
 * @param fieldId       Canonical field id declared in the registry.
 * @param results       Map produced by the orchestrator engine loop.
 * @param currentJobId  Current orchestrator job id (for freshness gating).
 *
 * NOTE (C0): callers do not yet exist. The function is shipped so that the
 * C1 PR can be a pure search-and-replace. Until then, calling this with
 * an unregistered field returns `INCOMPLETE` so any accidental early use
 * fails closed.
 */
export function requireContractField<T = unknown>(
  engineId: EngineId,
  fieldId: string,
  results: Map<EngineId, EngineStepResult>,
  currentJobId: string | null,
): ContractFieldResult<T> {
  const contract = getContract(engineId);
  if (!contract) {
    return {
      status: "INCOMPLETE",
      reason: `no_contract_registered_for_${engineId}`,
    };
  }

  const field =
    contract.requiredOutputs.find((f) => f.id === fieldId) ??
    contract.optionalOutputs.find((f) => f.id === fieldId);
  if (!field) {
    return {
      status: "INCOMPLETE",
      reason: `field_not_in_contract:${engineId}.${fieldId}`,
    };
  }

  const result = results.get(engineId);
  if (!result) {
    return { status: "NOT_REACHED", reason: `engine_missing_from_results:${engineId}` };
  }

  // Engine-status gating: anything other than SUCCESS or PARTIAL counts as
  // "did not produce usable input." See `CONTRACT_NOT_REACHED_STATUSES`.
  if (result.status !== "SUCCESS" && (result.status as string) !== "PARTIAL") {
    return {
      status: "NOT_REACHED",
      reason: `engine_status:${engineId}=${result.status}`,
    };
  }

  // Resolve the value (canonical path, then legacy paths).
  const value = resolveFromAllPaths(result.output, field);
  if (value === undefined || (field.emptyIsMissing && isEmpty(value))) {
    return {
      status: "INCOMPLETE",
      reason: `field_missing_or_empty:${engineId}.${fieldId}`,
    };
  }

  // Validate against Zod shape.
  const parse = field.shape.safeParse(value);
  if (!parse.success) {
    return {
      status: "INVALID",
      reason: `schema_invalid:${engineId}.${fieldId}: ${parse.error.issues
        .slice(0, 2)
        .map((i) => i.message)
        .join("; ")}`,
    };
  }

  // Freshness/trust gating using snapshot provenance, when present.
  const prov = extractProvenance(result);
  const completeness = validateContractCompleteness(engineId, result.output);
  const trustState = classifyTrust(
    prov,
    completeness.status,
    currentJobId,
    contract.livenessRule,
    contract.engineVersion,
  );

  if (!isLiveEligible(trustState)) {
    return {
      status: "STALE",
      reason: `trust_state:${trustState}`,
      trustState,
    };
  }

  return { status: "OK", value: parse.data as T, trustState };
}

/**
 * Pulls provenance off an `EngineStepResult` if the orchestrator stamped one.
 * Today (pre-C2) the orchestrator only attaches `_provenance` on snapshot
 * reuse hits via `safeReuse(...)`. Returns `null` when absent — which the
 * trust classifier treats as "fresh in-run result, no provenance row."
 */
function extractProvenance(result: EngineStepResult): ProvenanceForTrust | null {
  const prov = (result.output as any)?._provenance;
  if (!prov || typeof prov !== "object") return null;
  return {
    sourceJobId: prov.sourceJobId ?? null,
    createdAt: prov.createdAt ?? null,
    wasReused: prov.wasReused === true,
    freshnessClass: prov.freshnessClass ?? null,
    ageInDays: typeof prov.ageInDays === "number" ? prov.ageInDays : null,
    schemaVersion: typeof prov.schemaVersion === "number" ? prov.schemaVersion : null,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 6. API envelope wrapper (plan §7)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Wraps an engine snapshot row + its current trust context into a uniform
 * `LiveSnapshotEnvelope` for API responses. The frontend reads
 * `isLiveEvidence` / `isHistoricalOnly` and never re-derives trust.
 *
 * NOTE (C0): no route calls this yet. C2 wires it into the 15 engine `routes.ts`
 * `/latest/:campaignId` endpoints behind the `ENFORCE_ENGINE_CONTRACTS`
 * feature flag (envelopes are returned but FE ignores them until C3).
 */
export function wrapAsEnvelope<T>(
  engineId: EngineId,
  data: T,
  ctx: {
    snapshotId: string;
    campaignId: string;
    runId: string | null;
    currentJobId: string | null;
    provenance: ProvenanceForTrust | null;
  },
): LiveSnapshotEnvelope<T> {
  const contract = getContract(engineId);
  const completeness = validateContractCompleteness(engineId, data);
  const engineVersion = contract?.engineVersion ?? 0;
  const livenessRule = contract?.livenessRule ?? "current_run_only";

  const trustState = classifyTrust(
    ctx.provenance,
    completeness.status,
    ctx.currentJobId,
    livenessRule,
    engineVersion,
  );

  const isLiveEvidence = isLiveEligible(trustState);

  return {
    runId: ctx.runId,
    snapshotId: ctx.snapshotId,
    sourceJobId: ctx.provenance?.sourceJobId ?? null,
    campaignId: ctx.campaignId,
    engineId,
    engineVersion,
    trustState,
    freshnessClass: ctx.provenance?.freshnessClass ?? null,
    contractStatus: completeness.status,
    missingRequiredOutputs: completeness.missingRequiredOutputs,
    invalidFields: completeness.invalidFields,
    wasReused: ctx.provenance?.wasReused === true,
    ageInDays: ctx.provenance?.ageInDays ?? null,
    isLiveEvidence,
    isHistoricalOnly: !isLiveEvidence,
    data,
  };
}
