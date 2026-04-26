/**
 * Phase 8 — AI Overlay client wrapper.
 *
 * Locked by Samir 2026-04-23. This module is the ONLY place that calls into
 * `server/ai-client.ts` from the adaptive pipeline. Every overlay module
 * goes through `runOverlay`, which enforces:
 *
 *   1. Default-disabled — returns a `disabled` envelope unless the env flag
 *      `PIPELINE_AI_OVERLAY_ENABLED=true` is set. Opt-in only.
 *   2. Deterministic params — temperature=0, fixed seed, json_object format,
 *      hard max_tokens cap.
 *   3. Traceability — every envelope carries model_id, prompt_version,
 *      prompt_fingerprint, response_fingerprint, latency_ms, finished_at.
 *   4. Hard fallback — any failure (timeout, parse, schema violation, budget
 *      exceeded) returns an `error` envelope; never throws into the caller.
 *      Rule-based output continues unchanged.
 *   5. Strict schema validation — caller supplies a `validate(parsed)` guard.
 *      Returning `null` from the validator triggers an `error` envelope with
 *      reason "schema_invalid".
 *
 * This wrapper does NOT make decisions. It surfaces structured AI output for
 * downstream display layers; it never feeds into Boss policy.
 */
import { createHash } from "crypto";
import { aiChat, AICallError, PRIMARY_CHAT_MODEL } from "../../ai-client";
import type { AIOverlay, AIOverlayTrace, AIOverlayStatus } from "./types";
import { OVERLAY_DISABLED_ENV } from "./types";

const DEFAULT_MAX_TOKENS = 600;
const DEFAULT_SEED = 7;
const DEFAULT_TIMEOUT_MS = 20_000;

export interface OverlayCallSpec<T> {
  /** Account id for budget enforcement (reuses ai-client per-account budget). */
  accountId: string;
  /** Stable name of the overlay (e.g., "competitor.v1"). Used in trace. */
  promptVersion: string;
  /** Endpoint label for budget reconciliation. */
  endpoint: string;
  /** System message — locked, deterministic. */
  system: string;
  /** User message — built per-call from the rule-based inputs. */
  user: string;
  /** Hard token cap. Defaults to DEFAULT_MAX_TOKENS. */
  maxTokens?: number;
  /** Strict validator. Receives the JSON.parse'd response. Return the
   *  validated typed object on success, or null to trigger schema_invalid. */
  validate: (parsed: unknown) => T | null;
}

function fingerprint(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function nowIso(): string {
  return new Date().toISOString();
}

function envelope<T>(opts: {
  status: AIOverlayStatus;
  data: T | null;
  error: string | null;
  trace: AIOverlayTrace;
}): AIOverlay<T> {
  return opts;
}

function traceFor(spec: OverlayCallSpec<unknown>, opts: {
  promptFingerprint: string;
  responseFingerprint: string | null;
  latencyMs: number;
  modelId: string;
}): AIOverlayTrace {
  return {
    model_id: opts.modelId,
    prompt_version: spec.promptVersion,
    prompt_fingerprint: opts.promptFingerprint,
    response_fingerprint: opts.responseFingerprint,
    latency_ms: opts.latencyMs,
    finished_at: nowIso(),
  };
}

export function isOverlayEnabled(): boolean {
  return process.env[OVERLAY_DISABLED_ENV] === "true";
}

export async function runOverlay<T>(spec: OverlayCallSpec<T>): Promise<AIOverlay<T>> {
  const promptText = JSON.stringify({ system: spec.system, user: spec.user });
  const promptFingerprint = fingerprint(promptText);
  const baseTrace = (): AIOverlayTrace => ({
    model_id: PRIMARY_CHAT_MODEL,
    prompt_version: spec.promptVersion,
    prompt_fingerprint: promptFingerprint,
    response_fingerprint: null,
    latency_ms: 0,
    finished_at: nowIso(),
  });

  if (!isOverlayEnabled()) {
    return envelope<T>({
      status: "disabled",
      data: null,
      error: null,
      trace: baseTrace(),
    });
  }

  const start = Date.now();
  try {
    const result = await aiChat({
      model: PRIMARY_CHAT_MODEL,
      messages: [
        { role: "system", content: spec.system },
        { role: "user", content: spec.user },
      ],
      max_tokens: spec.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: 0,
      seed: DEFAULT_SEED,
      response_format: { type: "json_object" },
      accountId: spec.accountId,
      endpoint: spec.endpoint,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });

    const raw = result?.choices?.[0]?.message?.content;
    if (typeof raw !== "string" || raw.length === 0) {
      return envelope<T>({
        status: "error",
        data: null,
        error: "empty_response",
        trace: traceFor(spec, {
          promptFingerprint,
          responseFingerprint: null,
          latencyMs: Date.now() - start,
          modelId: PRIMARY_CHAT_MODEL,
        }),
      });
    }

    const responseFingerprint = fingerprint(raw);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return envelope<T>({
        status: "error",
        data: null,
        error: "parse_failed",
        trace: traceFor(spec, {
          promptFingerprint,
          responseFingerprint,
          latencyMs: Date.now() - start,
          modelId: PRIMARY_CHAT_MODEL,
        }),
      });
    }

    const validated = spec.validate(parsed);
    if (validated === null) {
      return envelope<T>({
        status: "error",
        data: null,
        error: "schema_invalid",
        trace: traceFor(spec, {
          promptFingerprint,
          responseFingerprint,
          latencyMs: Date.now() - start,
          modelId: PRIMARY_CHAT_MODEL,
        }),
      });
    }

    return envelope<T>({
      status: "ok",
      data: validated,
      error: null,
      trace: traceFor(spec, {
        promptFingerprint,
        responseFingerprint,
        latencyMs: Date.now() - start,
        modelId: PRIMARY_CHAT_MODEL,
      }),
    });
  } catch (err) {
    const code = err instanceof AICallError ? err.code : "AI_CALL_FAILED";
    return envelope<T>({
      status: "error",
      data: null,
      error: code,
      trace: traceFor(spec, {
        promptFingerprint,
        responseFingerprint: null,
        latencyMs: Date.now() - start,
        modelId: PRIMARY_CHAT_MODEL,
      }),
    });
  }
}
