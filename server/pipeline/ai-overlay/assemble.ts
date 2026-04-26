/**
 * Phase 8 — Controlled consumption assembler.
 *
 * Locked by Samir 2026-04-23 ("controlled consumption of AI outputs").
 *
 * This module is the SINGLE entry point that the explanation layer uses
 * to invoke the AI overlays for a specific Boss run. It is:
 *
 *   - Pure: takes already-computed Boss + Phase 6 context, returns
 *     descriptive envelopes. No mutation of the inputs.
 *   - Default-disabled: each overlay short-circuits to `{status:"disabled"}`
 *     unless `PIPELINE_AI_OVERLAY_ENABLED=true` is set. The harness path
 *     stays AI-free.
 *   - Independent overlays: a failure in one overlay does not block the
 *     others; each returns its own envelope with status / error / trace.
 *   - Off the verdict path: this module is NEVER imported from
 *     `boss/policy/*` or `boss/run.ts`. It is consumed only by the
 *     explanation route, after the verdict is final.
 *
 * Phase 7.4 will extend this with the competitor + user-interpretation
 * overlays once the corresponding rule-based interpreters are wired into
 * the lane runners. The shape below is forward-compatible — the missing
 * overlays surface as `{status:"unavailable"}` envelopes so the dashboard
 * can render the placeholder explicitly.
 */
import type { AIOverlay, AIOverlayTrace } from "./types";
import type { ExplanationAIOutput, Verdict } from "./explanation";
import type { DnaAIOutput } from "./dna";
import type { CompetitorAIOutput } from "./competitor";
import type { UserInterpretationAIOutput } from "./user-interpretation";
import type { Q2ReasoningAIOutput } from "./q2-reasoning";
import { applyExplanationOverlay } from "./explanation";
import { applyDnaOverlay } from "./dna";
import { applyQ2ReasoningOverlay } from "./q2-reasoning";
import type { Q2EvaluationResult } from "../../boss/policy/market-shift";

/** Adds an "unavailable" status for overlays that have no rule-based input
 *  yet (Phase 7.4 will wire these in). Distinct from "disabled" (env flag
 *  off) and "error" (call attempted, failed). */
type ExtendedStatus = "ok" | "disabled" | "error" | "unavailable";

export interface ExtendedAIOverlay<T> {
  status: ExtendedStatus;
  data: T | null;
  error: string | null;
  trace: AIOverlayTrace;
  /** Stable label the dashboard uses to explain WHY data is missing when
   *  status is "unavailable". */
  unavailableReason?: string;
}

export interface AssembleInput {
  accountId: string;
  bossRunId: string;
  question: "Q1" | "Q2";
  verdict: Verdict;
  reasons: string[];
  /** Optional snapshot of the rule context that produced the verdict. */
  context?: Record<string, unknown>;
  /** Optional Phase 6 cluster signature for the DNA overlay. */
  clusterSignature?: {
    version: 1;
    post_count: number;
    by_media_type: Record<string, number>;
    by_platform: Record<string, number>;
    themes: Array<{ theme_token: string; post_count: number }>;
    post_ids: string[];
  } | null;
  windowId?: string | null;
  /** Phase 7.4 — full Q2 evaluation result for the q2-reasoning overlay.
   *  Provided ONLY when question === "Q2". The verdict + reasons here MUST
   *  match the AssembleInput.verdict + reasons; the overlay validates this. */
  q2?: Q2EvaluationResult | null;
}

export interface AssembledInterpretation {
  /** Always populated (verdict + reasons are always available). */
  explanation: AIOverlay<ExplanationAIOutput>;
  /** Populated when a cluster signature is available; otherwise unavailable. */
  dna: ExtendedAIOverlay<DnaAIOutput>;
  /** Phase 7.4 — pending wiring of `lanes/competitor/interpret.ts` into
   *  the lane runner. Currently always "unavailable". */
  competitor: ExtendedAIOverlay<CompetitorAIOutput>;
  /** Phase 7.4 — pending wiring of `lanes/user/{composition,
   *  cluster-interpretation}.ts` into the lane runner. Currently always
   *  "unavailable". */
  userInterpretation: ExtendedAIOverlay<UserInterpretationAIOutput>;
  /** Phase 7.4 — Q2 reasoning overlay. Populated only on Q2 explanations
   *  when a Q2EvaluationResult is supplied. Unavailable on Q1. */
  q2Reasoning: ExtendedAIOverlay<Q2ReasoningAIOutput>;
}

function emptyTrace(): AIOverlayTrace {
  return {
    model_id: "",
    prompt_version: "",
    prompt_fingerprint: "",
    response_fingerprint: null,
    latency_ms: 0,
    finished_at: new Date().toISOString(),
  };
}

function unavailable<T>(reason: string): ExtendedAIOverlay<T> {
  return {
    status: "unavailable",
    data: null,
    error: null,
    trace: emptyTrace(),
    unavailableReason: reason,
  };
}

function liftDna(env: AIOverlay<DnaAIOutput>): ExtendedAIOverlay<DnaAIOutput> {
  return { status: env.status, data: env.data, error: env.error, trace: env.trace };
}

function liftQ2Reasoning(
  env: AIOverlay<Q2ReasoningAIOutput>,
): ExtendedAIOverlay<Q2ReasoningAIOutput> {
  return { status: env.status, data: env.data, error: env.error, trace: env.trace };
}

export async function assembleInterpretation(
  input: AssembleInput,
): Promise<AssembledInterpretation> {
  // All overlays run independently. A failure in one does NOT block the others.
  const wantsQ2 = input.question === "Q2" && input.q2 != null;
  const [explanationEnv, dnaEnv, q2Env] = await Promise.all([
    applyExplanationOverlay({
      accountId: input.accountId,
      question: input.question,
      verdict: input.verdict,
      reasons: input.reasons,
      context: input.context,
    }),
    input.clusterSignature
      ? applyDnaOverlay({
          accountId: input.accountId,
          windowId: input.windowId ?? null,
          signature: input.clusterSignature,
        })
      : Promise.resolve<AIOverlay<DnaAIOutput>>({
          status: "error",
          data: null,
          error: "no_cluster_signature",
          trace: emptyTrace(),
        }),
    wantsQ2
      ? applyQ2ReasoningOverlay({
          accountId: input.accountId,
          bossRunId: input.bossRunId,
          q2: input.q2!,
        })
      : Promise.resolve<AIOverlay<Q2ReasoningAIOutput>>({
          status: "error",
          data: null,
          error: "not_q2_question",
          trace: emptyTrace(),
        }),
  ]);

  return {
    explanation: explanationEnv,
    dna: input.clusterSignature
      ? liftDna(dnaEnv)
      : unavailable<DnaAIOutput>("no_cluster_signature_in_phase6"),
    competitor: unavailable<CompetitorAIOutput>("competitor_interpreter_not_wired_phase7.4"),
    userInterpretation: unavailable<UserInterpretationAIOutput>(
      "user_interpreter_not_wired_phase7.4",
    ),
    q2Reasoning: wantsQ2
      ? liftQ2Reasoning(q2Env)
      : input.question === "Q2"
        ? unavailable<Q2ReasoningAIOutput>("q2_evaluation_result_not_provided")
        : unavailable<Q2ReasoningAIOutput>("not_q2_question"),
  };
}
