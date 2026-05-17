/**
 * Task #90 / Phase 4-B — Extraction dispatch HOF.
 *
 * Single seam through which every extracted orchestrator module is invoked.
 * The orchestrator passes BOTH the legacy inline implementation (`current`)
 * AND the extracted module (`candidate`); the per-module flag
 * `ORCH_USE_<MODULE_FLAG>` decides which path actually runs:
 *
 *   current   (default) — only the legacy implementation runs. Zero-risk
 *                         default; orchestrator behavior is bit-for-bit
 *                         identical to pre-Task-#90.
 *   candidate           — only the extracted module runs. Promotion target
 *                         after the 48h shadow burn-in proves parity.
 *   shadow              — BOTH run. Result of `current` is returned to the
 *                         caller; `candidate` is compared and any divergence
 *                         is recorded on the CV-14 metric family +
 *                         `orchestrator_extraction_divergences` table.
 *
 * D1 — no semantic fallback. Mode is a strict `DispatchMode` enum read
 * from env once; missing env → `current` (the SAFE default; this is the
 * explicit canonical resolution, not a `?? "current"` fallback over a
 * verdict-shape field).
 *
 * D5 — divergence severity is itself a strict enum. The classifier returns
 * `null` when results match; the caller MUST NOT silently coerce `null`
 * into "match" via a fallback expression.
 */

import { randomUUID } from "node:crypto";
import {
  recordDispatch,
  recordDivergence,
  recordCandidateError,
  type DispatchMode,
  type DispatchOutcome,
  type DivergenceSeverity,
} from "./cv14-metrics";

export type { DispatchMode, DispatchOutcome, DivergenceSeverity };

export interface DispatchOptions<I, O> {
  /** Stable module id for metrics + env-flag lookup. lowercase-with-dashes. */
  moduleId: string;
  /** Env-var flag suffix. E.g. moduleFlag="SYS_CONTROL" → ORCH_USE_SYS_CONTROL. */
  moduleFlag: string;
  /** Input snapshot for the candidate (PII-redacted at call site). */
  input: I;
  /** Legacy inline implementation. Called with `input`. */
  current: (input: I) => Promise<O> | O;
  /**
   * Extracted module implementation. Called with `input`. MUST be a pure
   * function of `input` modulo declared side-effects (DB / metrics).
   */
  candidate: (input: I) => Promise<O> | O;
  /**
   * Optional comparator. When omitted the dispatcher falls back to
   * `defaultJsonDiff`. Comparators MUST return `null` on match.
   */
  compare?: (current: O, candidate: O) => DivergenceReport | null;
  /**
   * Optional divergence persistence hook. The dispatcher writes the
   * CV-14 counter unconditionally; persistence to
   * `orchestrator_extraction_divergences` is an opt-in side-effect.
   */
  persistDivergence?: (entry: PersistedDivergence) => Promise<void> | void;
  /** Job id for divergence row attribution. */
  jobId?: string;
  campaignId?: string;
  accountId?: string;
}

export interface DivergenceReport {
  severity: DivergenceSeverity;
  diffSummary: Record<string, unknown>;
  currentHash?: string;
  candidateHash?: string;
}

export interface PersistedDivergence extends DivergenceReport {
  id: string;
  capturedAt: Date;
  jobId: string;
  campaignId?: string;
  accountId?: string;
  moduleId: string;
  dispatchMode: DispatchMode;
  candidateError?: string;
}

/**
 * Resolve the dispatch mode for a module. Strict enum; unknown values
 * collapse to `current` (SAFE). NOT a `?? "current"` fallback over a
 * generic field — this IS the canonical resolution and the only place
 * the env string is interpreted.
 */
export function resolveDispatchMode(moduleFlag: string): DispatchMode {
  const raw = process.env[`ORCH_USE_${moduleFlag}`];
  if (raw === "candidate") return "candidate";
  if (raw === "shadow") return "shadow";
  return "current";
}

/**
 * Dispatch entry point. Returns the `current` result in `current` and
 * `shadow` modes, and the `candidate` result in `candidate` mode.
 */
export async function dispatchExtraction<I, O>(
  opts: DispatchOptions<I, O>,
): Promise<O> {
  const mode = resolveDispatchMode(opts.moduleFlag);

  if (mode === "current") {
    const out = await opts.current(opts.input);
    recordDispatch(opts.moduleId, mode, "current_only");
    return out;
  }

  if (mode === "candidate") {
    try {
      const out = await opts.candidate(opts.input);
      recordDispatch(opts.moduleId, mode, "candidate_only");
      return out;
    } catch (err: any) {
      recordCandidateError(opts.moduleId);
      recordDispatch(opts.moduleId, mode, "shadow_diverge_fatal");
      // Re-throw — in `candidate` mode the operator has explicitly opted
      // in. We do NOT silently fall back to `current` because that would
      // hide a structurally broken extraction.
      throw err;
    }
  }

  // shadow mode — BOTH run; `current` is returned. Candidate failures
  // never propagate to the caller.
  const currentResult = await opts.current(opts.input);
  let candidateResult: O | undefined;
  let candidateError: string | undefined;
  try {
    candidateResult = await opts.candidate(opts.input);
  } catch (err: any) {
    candidateError = err?.message ?? String(err);
    recordCandidateError(opts.moduleId);
  }

  let outcome: DispatchOutcome = "shadow_match";
  if (candidateError !== undefined) {
    outcome = "shadow_diverge_fatal";
    recordDivergence(opts.moduleId, "fatal");
    await persistIfWired(opts, "shadow", {
      severity: "fatal",
      diffSummary: { reason: "candidate_threw", error: candidateError },
      candidateError,
    });
  } else {
    const compareFn = opts.compare ?? defaultJsonDiff;
    const report = compareFn(currentResult, candidateResult as O);
    if (report) {
      outcome =
        report.severity === "major"
          ? "shadow_diverge_major"
          : report.severity === "fatal"
            ? "shadow_diverge_fatal"
            : "shadow_diverge_minor";
      recordDivergence(opts.moduleId, report.severity);
      await persistIfWired(opts, "shadow", report);
    }
  }
  recordDispatch(opts.moduleId, mode, outcome);
  return currentResult;
}

async function persistIfWired<I, O>(
  opts: DispatchOptions<I, O>,
  dispatchMode: DispatchMode,
  report: DivergenceReport & { candidateError?: string },
): Promise<void> {
  if (!opts.persistDivergence) return;
  try {
    await opts.persistDivergence({
      id: `oed_${Date.now()}_${randomUUID().slice(0, 8)}`,
      capturedAt: new Date(),
      jobId: opts.jobId ?? "unknown",
      campaignId: opts.campaignId,
      accountId: opts.accountId,
      moduleId: opts.moduleId,
      dispatchMode,
      severity: report.severity,
      diffSummary: report.diffSummary,
      currentHash: report.currentHash,
      candidateHash: report.candidateHash,
      candidateError: report.candidateError,
    });
  } catch (err: any) {
    // Doctrine: never silently catch. Log so operator knows persistence
    // failed; counter is already recorded so the operator panel still
    // surfaces the divergence count.
    console.warn(
      `[ExtractionDispatch] DIVERGENCE_PERSIST_FAILED | module=${opts.moduleId} | severity=${report.severity} | error=${err?.message ?? String(err)}`,
    );
  }
}

/**
 * Default structural comparator. Compares JSON-serialised projections.
 * Any value mismatch is a `major` divergence; key-set mismatches are
 * `major`; equal payloads return `null`.
 *
 * Module authors SHOULD supply a custom comparator that whitelists
 * timing fields and other expected non-determinism.
 */
export function defaultJsonDiff<O>(current: O, candidate: O): DivergenceReport | null {
  const currentJson = stableStringify(current);
  const candidateJson = stableStringify(candidate);
  if (currentJson === candidateJson) return null;
  return {
    severity: "major",
    diffSummary: {
      reason: "json_mismatch",
      currentLength: currentJson.length,
      candidateLength: candidateJson.length,
    },
  };
}

function stableStringify(v: unknown): string {
  return JSON.stringify(v, (_k, val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(val as Record<string, unknown>).sort()) {
        sorted[k] = (val as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return val;
  });
}
