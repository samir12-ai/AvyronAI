/**
 * Phase 4 — AI Proposes / Code Validates — per-run AI-path telemetry contract.
 *
 * Shared, DEPENDENCY-LIGHT type home (no aiChat import, no orchestrator import)
 * so both the engine files (which EMIT per-engine telemetry onto their result
 * objects) and the orchestrator aggregator (which ROLLS it up) can import it.
 *
 * Doctrine:
 *  - D3: every mode/verdict-shaped field is a strict z.enum (never z.string()).
 *  - B4 (explicit classification): the run-level `mode` distinguishes ALL four
 *    real outcomes of an engine this run — the AI path won ("ai"), the AI path
 *    ran but every attempt failed so the deterministic floor fired ("fallback"),
 *    a prior snapshot was reused so the AI layer was skipped this run ("reused"),
 *    and the engine never executed ("not_run"). Collapsing reused/not_run into
 *    ai/fallback would silently inflate coverage — forbidden.
 *  - Engines themselves only ever emit "ai" | "fallback" (they always run when
 *    they run); "reused"/"not_run" are assigned by the orchestrator aggregator.
 */
import { z } from "zod";

/** The four engines that participate in the AI-proposal path. */
export const AiPathEngineIdSchema = z.enum([
  "audience",
  "positioning",
  "offer",
  "channel_selection",
]);
export type AiPathEngineId = z.infer<typeof AiPathEngineIdSchema>;

/** Deterministic gates that can reject a candidate (the sole judges). */
export const AiPathGateSchema = z.enum([
  "breadth",
  "interchangeability",
  "contradiction",
]);
export type AiPathGate = z.infer<typeof AiPathGateSchema>;

/** Run-level classification of the path an engine took THIS run. */
export const AiPathModeSchema = z.enum(["ai", "fallback", "reused", "not_run"]);
export type AiPathMode = z.infer<typeof AiPathModeSchema>;

/**
 * What an ENGINE writes onto its own result object. Engines only ever ran, so
 * their emitted mode is strictly "ai" | "fallback". `attempts` = attempts made
 * this run; `failedGates` = distinct gates that rejected a candidate across
 * attempts; `fallbackReason` = recorded reason when mode==="fallback".
 */
export const EngineAiPathEmissionSchema = z.object({
  mode: z.enum(["ai", "fallback"]),
  attempts: z.number().int().nonnegative(),
  failedGates: z.array(AiPathGateSchema),
  fallbackReason: z.string().nullable(),
});
export type EngineAiPathEmission = z.infer<typeof EngineAiPathEmissionSchema>;

/**
 * Minimal battery-attempt shape an engine collects (structurally a
 * GateBatteryResult). `failedGate` is a raw string here — the empty string and
 * any non-canonical value are ignored; only the three enum members are kept —
 * so engines can pass their existing string gate variable directly.
 */
export interface BatteryAttemptLike {
  passed: boolean;
  failedGate: string | null;
  rejectionFeedback: string;
}

const CANONICAL_GATES: readonly AiPathGate[] = ["breadth", "interchangeability", "contradiction"];

function toGate(raw: string | null): AiPathGate | null {
  if (raw && (CANONICAL_GATES as readonly string[]).includes(raw)) return raw as AiPathGate;
  return null;
}

/**
 * Derive an engine's emission from the battery attempts it ran this run.
 *
 * `finalPassed` is the pass-state of the candidate the engine ACTUALLY adopted
 * (not merely the last attempt) — the engine owns that decision. `attempts` is
 * the count of battery evaluations; `failedGates` the distinct gates that
 * rejected any attempt; `fallbackReason` is recorded (never null) when the
 * adopted candidate did not pass. No `??`/`||` on any decision value (D1).
 */
export function emissionFromBattery(
  finalPassed: boolean,
  attempts: readonly BatteryAttemptLike[],
): EngineAiPathEmission {
  const failedGates: AiPathGate[] = [];
  let lastRejection = "";
  for (const a of attempts) {
    const gate = toGate(a.failedGate);
    if (!a.passed && gate && !failedGates.includes(gate)) {
      failedGates.push(gate);
    }
    if (!a.passed && a.rejectionFeedback.length > 0) lastRejection = a.rejectionFeedback;
  }

  let fallbackReason: string | null = null;
  if (!finalPassed) {
    if (lastRejection.length > 0) {
      fallbackReason = lastRejection;
    } else if (failedGates.length > 0) {
      fallbackReason = `battery_failed:${failedGates.join("+")}`;
    } else {
      fallbackReason = "battery_not_satisfied";
    }
  }

  return {
    mode: finalPassed ? "ai" : "fallback",
    attempts: attempts.length,
    failedGates,
    fallbackReason,
  };
}

/** One per-engine row in the aggregated report (adds engine id + durationMs). */
export const EngineAiPathTelemetrySchema = z.object({
  engine: AiPathEngineIdSchema,
  mode: AiPathModeSchema,
  attempts: z.number().int().nonnegative(),
  failedGates: z.array(AiPathGateSchema),
  fallbackReason: z.string().nullable(),
  durationMs: z.number().int().nonnegative(),
});
export type EngineAiPathTelemetry = z.infer<typeof EngineAiPathTelemetrySchema>;

/** Doctrine resolution for the run (anchored vs degraded to business level). */
export const AiPathDoctrineResolutionSchema = z.enum([
  "anchored",
  "business_level_degraded",
  "unknown",
]);
export type AiPathDoctrineResolution = z.infer<
  typeof AiPathDoctrineResolutionSchema
>;

/** Explicit reason a rollup ratio is null (D5: never silently substitute 0). */
export const AiPathCoverageReasonSchema = z.enum([
  "no_engines_executed",
  "no_attempts_recorded",
]);
export type AiPathCoverageReason = z.infer<typeof AiPathCoverageReasonSchema>;

/**
 * The aggregated per-run report persisted to orchestrator_jobs.ai_path_report.
 *
 * engineCoverage / attemptSuccessRate are null (NOT 0) when their denominator
 * is empty; `coverageReason`/`successRateReason` carry the explicit cause.
 */
export const AiPathReportSchema = z.object({
  doctrineResolution: AiPathDoctrineResolutionSchema,
  engineCoverage: z.number().nullable(),
  coverageReason: AiPathCoverageReasonSchema.nullable(),
  attemptSuccessRate: z.number().nullable(),
  successRateReason: AiPathCoverageReasonSchema.nullable(),
  perEngine: z.array(EngineAiPathTelemetrySchema),
  generatedAt: z.string(),
});
export type AiPathReport = z.infer<typeof AiPathReportSchema>;

/**
 * The envelope boss_runs.ai_path_report carries. runBoss does not itself run the
 * proposal engines (they run in runOrchestrator), so a boss run COPIES the most
 * recent completed orchestrator job's report and records its provenance. When no
 * orchestrator report exists, `available:false` + an explicit reason is written
 * (B2/B4: never null-silent).
 */
export const BossAiPathEnvelopeSchema = z.discriminatedUnion("available", [
  z.object({
    available: z.literal(true),
    sourceOrchestratorJobId: z.string(),
    generatedAt: z.string(),
    copiedAt: z.string(),
    report: AiPathReportSchema,
  }),
  z.object({
    available: z.literal(false),
    reason: z.enum(["no_orchestrator_run", "copy_failed"]),
    copiedAt: z.string(),
  }),
]);
export type BossAiPathEnvelope = z.infer<typeof BossAiPathEnvelopeSchema>;
