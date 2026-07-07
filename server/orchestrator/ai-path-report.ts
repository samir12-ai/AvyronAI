/**
 * Phase 4 — AI Proposes / Code Validates — per-run AI-path report aggregator.
 *
 * Orchestrator SIBLING (< 200 lines, NO LLM import — replay ESLint). Rolls the
 * four proposal engines' per-engine telemetry (emitted onto their result
 * objects) into the report persisted to orchestrator_jobs.ai_path_report, and
 * records the two run-completion gauges.
 *
 * Reuse detection: runOrchestrator stamps `aiPathReused` on an engine output
 * when it is served from a snapshot (the AI layer is skipped that run). Counting
 * a reused output as "ai"/"fallback" would inflate coverage — B4 forbids it —
 * so reused + never-executed engines are excluded from the rollup denominators.
 */
import {
  AiPathReportSchema,
  EngineAiPathEmissionSchema,
  type AiPathReport,
  type AiPathEngineId,
  type AiPathGate,
  type EngineAiPathTelemetry,
} from "../shared/ai-path-telemetry";
import { metrics } from "../observability/otel";

const LOG = "[AiPathReport]";

/** The four engines, in report order. */
const AI_PATH_ENGINES: AiPathEngineId[] = [
  "audience",
  "positioning",
  "offer",
  "channel_selection",
];

const VALID_GATES: readonly AiPathGate[] = ["breadth", "interchangeability", "contradiction"];

/** Minimal shape read from the orchestrator `results` map (avoids a circular import). */
interface StepResultLike {
  output?: unknown;
  durationMs?: number;
}
type ResultsLike = Map<string, StepResultLike>;

/**
 * Stamp an engine output as snapshot-reused. Called at each reuse hit site in
 * runOrchestrator. Mutates in place (the same object reference becomes
 * stepResult.output), so the aggregator observes the marker at run completion.
 */
export function markEngineReused(output: unknown): void {
  if (output && typeof output === "object") {
    (output as Record<string, unknown>).aiPathReused = true;
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function intOrZero(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : 0;
}

interface ChannelEmission {
  mode: "ai" | "fallback";
  attempts: number;
  failedGates: AiPathGate[];
  fallbackReason: string | null;
}

/** Map channel_selection's existing aiChannelProposal → an emission (zero engine change). */
function emissionFromChannelProposal(output: Record<string, unknown>): ChannelEmission | null {
  const proposal = asRecord(output.aiChannelProposal);
  if (!proposal) return null;
  const mode = proposal.mode === "ai" ? "ai" : "fallback";
  const gateTrace = Array.isArray(proposal.gateTrace) ? proposal.gateTrace : [];
  const failedGates: AiPathGate[] = [];
  for (const entry of gateTrace) {
    const rec = asRecord(entry);
    const g = rec?.failedGate;
    if (typeof g === "string" && (VALID_GATES as readonly string[]).includes(g) && !failedGates.includes(g as AiPathGate)) {
      failedGates.push(g as AiPathGate);
    }
  }
  // B4/D5 parity with emissionFromBattery: a fallback ALWAYS carries an explicit
  // reason (never null), and an "ai" mode never carries one. If the proposal
  // omits a usable string reason, derive one from the failed gates rather than
  // silently substituting null.
  const fr = proposal.fallbackReason;
  let fallbackReason: string | null = null;
  if (mode === "fallback") {
    if (typeof fr === "string" && fr.length > 0) {
      fallbackReason = fr;
    } else if (failedGates.length > 0) {
      fallbackReason = `battery_failed:${failedGates.join("+")}`;
    } else {
      fallbackReason = "channel_proposal_fallback";
    }
  }
  return {
    mode,
    attempts: intOrZero(proposal.attempts),
    failedGates,
    fallbackReason,
  };
}

/** Classify a single engine's telemetry for this run. */
function telemetryFor(engine: AiPathEngineId, step: StepResultLike | undefined): EngineAiPathTelemetry {
  const durationMs = intOrZero(step?.durationMs);
  const output = asRecord(step?.output);

  // No output at all → the engine never executed this run.
  if (!output) {
    return { engine, mode: "not_run", attempts: 0, failedGates: [], fallbackReason: null, durationMs };
  }

  // Snapshot reuse: AI layer skipped this run (explicit, never silent).
  if (output.aiPathReused === true) {
    return { engine, mode: "reused", attempts: 0, failedGates: [], fallbackReason: null, durationMs };
  }

  // channel_selection carries its own formal proposal structure.
  if (engine === "channel_selection") {
    const mapped = emissionFromChannelProposal(output);
    if (mapped) {
      return { engine, mode: mapped.mode, attempts: mapped.attempts, failedGates: mapped.failedGates, fallbackReason: mapped.fallbackReason, durationMs };
    }
    return { engine, mode: "not_run", attempts: 0, failedGates: [], fallbackReason: null, durationMs };
  }

  // audience / positioning / offer emit EngineAiPathEmission onto output.aiPathTelemetry.
  const parsed = EngineAiPathEmissionSchema.safeParse(output.aiPathTelemetry);
  if (parsed.success) {
    return {
      engine,
      mode: parsed.data.mode,
      attempts: parsed.data.attempts,
      failedGates: parsed.data.failedGates,
      fallbackReason: parsed.data.fallbackReason,
      durationMs,
    };
  }

  // Output present but no AI telemetry: engine was blocked/skipped with a status
  // payload, or is a pre-Phase-4 output. Classify explicitly as not_run.
  return { engine, mode: "not_run", attempts: 0, failedGates: [], fallbackReason: null, durationMs };
}

/**
 * Build the per-run AI-path report, record the completion gauges, and return the
 * JSON string for orchestrator_jobs.ai_path_report. `doctrineResolutionRaw` is
 * ctx.ssc?.doctrine?.resolution (or undefined).
 */
export function buildAndRecordAiPathReport(results: ResultsLike, doctrineResolutionRaw: unknown): string {
  const perEngine: EngineAiPathTelemetry[] = AI_PATH_ENGINES.map(engine =>
    telemetryFor(engine, results.get(engine)),
  );

  // Denominators exclude reused + not_run — only engines that actually ran the
  // AI path this run count toward coverage / success rate.
  const executed = perEngine.filter(e => e.mode === "ai" || e.mode === "fallback");
  const aiCount = executed.filter(e => e.mode === "ai").length;
  const totalAttempts = executed.reduce((sum, e) => sum + e.attempts, 0);

  const engineCoverage = executed.length > 0 ? +(aiCount / executed.length).toFixed(4) : null;
  const coverageReason = executed.length > 0 ? null : "no_engines_executed";
  const attemptSuccessRate = totalAttempts > 0 ? +(aiCount / totalAttempts).toFixed(4) : null;
  const successRateReason = totalAttempts > 0 ? null : "no_attempts_recorded";

  const doctrineResolution =
    doctrineResolutionRaw === "anchored"
      ? "anchored"
      : doctrineResolutionRaw === "business_level_degraded"
        ? "business_level_degraded"
        : "unknown";

  const report: AiPathReport = {
    doctrineResolution,
    engineCoverage,
    coverageReason,
    attemptSuccessRate,
    successRateReason,
    perEngine,
    generatedAt: new Date().toISOString(),
  };

  // Label-less run-completion gauges (NO tenant/campaign labels — NO-TENANT-LEAK
  // + cardinality). Authoritative per-run values live in the persisted JSON.
  if (engineCoverage !== null) metrics.aiPathEngineCoverage.set({}, engineCoverage);
  if (attemptSuccessRate !== null) metrics.aiPathAttemptSuccessRate.set({}, attemptSuccessRate);

  const validated = AiPathReportSchema.safeParse(report);
  if (!validated.success) {
    console.error(`${LOG} REPORT_SCHEMA_INVALID`, validated.error.flatten());
    return JSON.stringify(report);
  }
  return JSON.stringify(validated.data);
}
