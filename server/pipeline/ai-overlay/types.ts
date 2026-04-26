/**
 * Phase 8 — AI Overlay shared types.
 *
 * Locked by Samir 2026-04-23:
 *   "AI improves understanding. The system still owns the decision."
 *
 * Every AI overlay returns an `AIOverlay<T>` envelope with a status field.
 * Consumers (the explanation layer, the admin dashboard) MUST switch on
 * `status` and treat anything other than "ok" as "no AI interpretation
 * available — fall back to the rule-based output unchanged".
 *
 * The boss verdict path (`boss/policy/*`, `boss/run.ts`) MUST NEVER import
 * from this module. Verifiable by grep on every change.
 */

export type AIOverlayStatus =
  /** AI returned a valid, schema-validated interpretation. */
  | "ok"
  /** Overlay is disabled (env flag off). Rule-based output is the truth. */
  | "disabled"
  /** AI call failed (timeout, budget, network, parse, schema). Rule-based
   *  output is the truth. The `error` field carries the reason code. */
  | "error";

export interface AIOverlayTrace {
  /** Concrete model id used (e.g., "gpt-4.1"). */
  model_id: string;
  /** Stable version tag for the prompt template, bumped per locked change. */
  prompt_version: string;
  /** SHA-256 of the prompt actually sent. Lets the operator verify. */
  prompt_fingerprint: string;
  /** SHA-256 of the AI response actually received. */
  response_fingerprint: string | null;
  /** Wall-clock latency of the call (ms). */
  latency_ms: number;
  /** ISO-8601 timestamp the call completed. */
  finished_at: string;
}

export interface AIOverlay<T> {
  status: AIOverlayStatus;
  /** Present iff `status === "ok"`. */
  data: T | null;
  /** Present iff `status === "error"`. Stable error code. */
  error: string | null;
  /** Always present. Allows the operator to audit which model / prompt
   *  produced which interpretation (or, when status !== "ok", what was
   *  attempted). */
  trace: AIOverlayTrace;
}

export const OVERLAY_DISABLED_ENV = "PIPELINE_AI_OVERLAY_ENABLED";
