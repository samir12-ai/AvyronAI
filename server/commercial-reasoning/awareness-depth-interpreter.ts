/**
 * Phase 4-A — Awareness Commercial Depth Interpreter.
 *
 * The first prototype of the LLM cognition layer. Replaces the
 * deterministic cosine-similarity depth gate
 * (`enforceEngineDepthCompliance` in
 * `server/causal-enforcement-layer/engine.ts:769`) with a grounded LLM
 * reasoner that emits structured `CommercialReasoningOutput` and is
 * verified by the system truth layer.
 *
 * See `.local/plans/phase-4-commercial-reasoning-core.md` §8a.
 *
 * Worst-case behaviour: identical to today. Any §3a anti-template gate
 * fail, §4 integrity gate fail, exception, timeout, or
 * `reasoner_self_assessment` of insufficient_evidence /
 * contradiction_unresolved routes to the deterministic floor with a
 * structured `GateDecisionReason` enum value.
 *
 * Env kill-switch: `COMMERCIAL_REASONER_ENABLED=0` → skip the LLM call
 * entirely and use the deterministic floor.
 */

import type { AnalyticalPackage } from "../analytical-enrichment-layer/types";
import {
  enforceEngineDepthCompliance,
  type DepthComplianceResult,
} from "../causal-enforcement-layer/engine";
import {
  callCommercialReasoner,
  CommercialReasonerJsonParseError,
  CommercialReasonerTimeoutError,
} from "./llm-call";
import { AICallError } from "../ai-client";
import {
  CommercialReasoningOutputSchema,
  type CommercialReasoningOutput,
  type GateDecisionReason,
  type IntegrityVerdict,
  type FellBackTo,
} from "./contract";
import {
  applyContradictionDowngrade,
  buildAelEvidenceIndexFromSubset,
  checkEvidenceDiversity,
  checkEvidenceRefExistence,
  checkLanguageStyleGrounding,
  checkPerFieldEvidenceLinkage,
  checkQuotedFragments,
  checkSignalOriginOverreach,
  checkTemplatePhraseLeak,
  type GateResult,
} from "./integrity-gates";
import { persistCommercialReasoningSnapshot } from "./persist";
import { recordCv11HallucinationExposure } from "./metrics";

const ENGINE_ID = "awareness_reasoner";
/**
 * The interpreter truncates the AEL it ships in the prompt so token cost
 * stays bounded. Gate 2 (phantom evidence ref) and Gate 3 (fabricated
 * quote) MUST validate against the EXACT subset that was prompted — if
 * we validate against the full AEL the model can cite rc:9 / chain:7
 * (rows it never saw) and the existence/quote checks would pass on
 * coincidental similarity. The subset is built once in `buildPromptCorpus`
 * and reused by both the prompt builder and the gate index builder.
 */
const MAX_AEL_RC = 8;
const MAX_AEL_CHAIN = 6;

export interface InterpretAwarenessDepthInput {
  accountId: string;
  campaignId: string;
  runId: string;
  ael: AnalyticalPackage | null;
  awarenessRouteSourceTexts: string[];
  productDnaSummary?: string | null;
  /** Caller-provided id→text map for any non-AEL evidence references. */
  signalEvidence?: Map<string, string>;
  /**
   * Optional industry slug (e.g. "b2b_saas", "dtc_ecom", "local_services").
   * Used by the industry-allowlist check; when missing AND the operator
   * has set `COMMERCIAL_REASONER_ALLOWED_INDUSTRIES`, the interpreter
   * falls back to the deterministic floor (fail-closed). When the env is
   * unset OR empty, industry is ignored (default-permissive, back-compat).
   * Falls back to `COMMERCIAL_REASONER_CURRENT_INDUSTRY` env if call-site
   * doesn't supply it — used by the audit pipeline per-industry runs.
   */
  industry?: string | null;
}

export interface InterpretAwarenessDepthResult {
  reasoning: CommercialReasoningOutput | null;
  gateDecision: { allow: boolean; reason: GateDecisionReason; detail?: string };
  integrityVerdict: IntegrityVerdict;
  fellBackTo: FellBackTo;
  deterministicFloor: DepthComplianceResult;
}

function isEnabled(): boolean {
  const raw = (process.env.COMMERCIAL_REASONER_ENABLED ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on" || raw === "yes";
}

/**
 * Industry allowlist (Phase 4-A post-audit, 2026-05-18).
 *
 * Semantics:
 *   - `COMMERCIAL_REASONER_ALLOWED_INDUSTRIES` unset or empty → return
 *     true (no restriction, default-permissive back-compat).
 *   - Set to a comma-separated list of slugs → only those industries are
 *     allowed. Industry not in the list (including missing/unknown) →
 *     return false.
 *
 * Industry resolution order: explicit input.industry → process env
 * `COMMERCIAL_REASONER_CURRENT_INDUSTRY` (set by audit pipeline). If
 * neither is present AND the allowlist IS set, the call is rejected
 * (fail-closed — operator's allowlist means "ONLY these industries").
 */
function resolveIndustry(explicit: string | null | undefined): string | null {
  if (explicit && explicit.trim()) return explicit.trim().toLowerCase();
  const fromEnv = (process.env.COMMERCIAL_REASONER_CURRENT_INDUSTRY ?? "").trim().toLowerCase();
  return fromEnv.length > 0 ? fromEnv : null;
}

export function isAllowedForIndustry(industry: string | null): boolean {
  const raw = (process.env.COMMERCIAL_REASONER_ALLOWED_INDUSTRIES ?? "").trim();
  if (raw.length === 0) return true; // no restriction
  const allowed = new Set(
    raw.split(",").map((s) => s.trim().toLowerCase()).filter((s) => s.length > 0),
  );
  if (allowed.size === 0) return true;
  if (!industry) return false; // allowlist set but caller didn't say which industry → fail-closed
  return allowed.has(industry);
}

function buildSystemPrompt(): string {
  return [
    "You are the awareness commercial-depth interpreter for a marketing AI system.",
    "You produce a STRUCTURED JSON commercial assessment grounded strictly in the supplied analytical-enrichment-layer (AEL) evidence.",
    "Every claim you make MUST be backed by at least one evidence_refs entry that quotes a real fragment from the AEL.",
    "NEVER invent evidence. NEVER use template phrases like 'transparency proof', 'best-in-class', 'industry-leading', 'strategic alignment'.",
    "If evidence is insufficient, set reasoner_self_assessment='insufficient_evidence' and the system will fall back to the deterministic floor.",
    "Respond with a single JSON object — no markdown, no commentary.",
  ].join(" ");
}

interface PromptCorpus {
  rootCauses: AnalyticalPackage["root_causes"];
  causalChains: AnalyticalPackage["causal_chains"];
}

/**
 * Single source of truth for the AEL slice that goes into the prompt.
 * Returned subset is also used by `buildAelEvidenceIndexFromSubset` so
 * Gate 2/3 anti-hallucination validation is aligned to the corpus the
 * model actually saw (architect P4-A review fix).
 */
function buildPromptCorpus(ael: AnalyticalPackage | null): PromptCorpus {
  return {
    rootCauses: (ael?.root_causes ?? []).slice(0, MAX_AEL_RC),
    causalChains: (ael?.causal_chains ?? []).slice(0, MAX_AEL_CHAIN),
  };
}

function buildUserPrompt(input: InterpretAwarenessDepthInput, corpus: PromptCorpus): string {
  const rcs = corpus.rootCauses.map((rc, i) => ({
    refId: `rc:${i}`,
    surfaceSignal: rc.surfaceSignal,
    deepCause: rc.deepCause,
    causalReasoning: rc.causalReasoning,
    sourceData: rc.sourceData,
    confidenceLevel: rc.confidenceLevel,
  }));
  const chains = corpus.causalChains.map((c, i) => ({
    refId: `chain:${i}`,
    pain: c.pain,
    cause: c.cause,
    impact: c.impact,
    behavior: c.behavior,
    conversionEffect: c.conversionEffect,
  }));

  const evidenceCorpus = {
    ael_root_causes: rcs,
    ael_causal_chains: chains,
    awareness_route_outputs: input.awarenessRouteSourceTexts.filter((t) => t && t.trim().length > 3),
    product_dna_summary: input.productDnaSummary ?? null,
  };

  const contractShape = {
    depthAssessment: "shallow|developing|substantive|deep",
    buyer_state: "unaware|problem_aware|solution_aware|product_aware|most_aware",
    saturation_state: "greenfield|emerging|competitive|saturated|commoditized",
    trust_state: "cold|skeptical|neutral|warming|trusting",
    reasoning: "80-1200 chars commercial-reasoning prose",
    evidence_refs: [
      {
        refType: "ael_root_cause|ael_causal_chain|signal|competitor_observation",
        refId: "EXACT id from the evidence corpus above (e.g. rc:0, chain:1)",
        quotedFragment: "10-300 chars VERBATIM substring of the referenced row",
        appliesTo: [
          "field names this evidence supports — must include at least one of: depthAssessment, buyer_state, saturation_state, trust_state, or commercial_pressures.<pressure>",
        ],
      },
    ],
    commercial_pressures: [
      {
        pressure: "differentiation|urgency|trust|proof|category_saturation|price_anchoring|switching_cost|perceived_risk|decision_complexity",
        intensity: "low|medium|high|blocking",
        evidence_ref_ids: ["refId from evidence_refs above"],
      },
    ],
    confidence: 0.0,
    uncertainty: {
      knownUnknowns: ["fields you couldn't determine from the evidence"],
      lowEvidenceFields: ["fields where you used the minimum 2 evidence_refs and they were thin"],
      contradictionsSurfaced: [
        {
          claimA: "first conflicting interpretation",
          claimB: "second conflicting interpretation",
          resolutionStance: "claimA_preferred|claimB_preferred|unresolved",
          resolutionReason: "why",
        },
      ],
    },
    signalOrigin: "real|competitor|inferred|fallback|unknown",
    provenance_origin: "engine_seed|exploration|outcome|mutation",
    reasoner_self_assessment: "grounded_complete|grounded_partial|insufficient_evidence|contradiction_unresolved",
  };

  return [
    "EVIDENCE CORPUS:",
    JSON.stringify(evidenceCorpus, null, 2),
    "",
    "REQUIRED OUTPUT SHAPE:",
    JSON.stringify(contractShape, null, 2),
    "",
    "Constraints:",
    "- evidence_refs MUST have at least 2 entries with distinct refIds.",
    "- Every enumerated state (depthAssessment/buyer_state/saturation_state/trust_state) and every commercial_pressures.<pressure> MUST appear in at least one evidence_refs[].appliesTo.",
    "- quotedFragment MUST be a real verbatim substring of the matching evidence row above.",
    "- If you cannot meet these constraints honestly, set reasoner_self_assessment='insufficient_evidence' and the system will use the deterministic floor.",
  ].join("\n");
}

export async function interpretAwarenessDepth(
  input: InterpretAwarenessDepthInput,
): Promise<InterpretAwarenessDepthResult> {
  const deterministicFloor = enforceEngineDepthCompliance(
    "awareness",
    input.awarenessRouteSourceTexts,
    input.ael,
  );

  if (!isEnabled()) {
    return finalizeFallback({
      input,
      deterministicFloor,
      reasoning: null,
      reason: "commercial_reasoner_disabled",
    });
  }

  const resolvedIndustry = resolveIndustry(input.industry);
  if (!isAllowedForIndustry(resolvedIndustry)) {
    console.log(
      `[CommercialReasoning] INDUSTRY_NOT_ALLOWED industry=${resolvedIndustry ?? "<unset>"} allowlist=${process.env.COMMERCIAL_REASONER_ALLOWED_INDUSTRIES ?? "<unset>"} runId=${input.runId}`,
    );
    return finalizeFallback({
      input,
      deterministicFloor,
      reasoning: null,
      reason: "commercial_reasoner_industry_not_allowed",
      detail: `industry=${resolvedIndustry ?? "<unset>"} not in allowlist`,
    });
  }

  const promptCorpus = buildPromptCorpus(input.ael);
  let llmResult;
  try {
    llmResult = await callCommercialReasoner({
      accountId: input.accountId,
      endpoint: "commercial_reasoning.awareness",
      systemPrompt: buildSystemPrompt(),
      userPrompt: buildUserPrompt(input, promptCorpus),
    });
  } catch (err) {
    const reason: GateDecisionReason =
      err instanceof CommercialReasonerTimeoutError
        ? "commercial_reasoner_wall_clock_timeout"
        : err instanceof CommercialReasonerJsonParseError
          ? "commercial_reasoner_json_parse_failed"
          : err instanceof AICallError
            ? "commercial_reasoner_threw_AICallError"
            : "commercial_reasoner_threw_AICallError";
    console.error("[CommercialReasoning] FALLBACK_FLOOR_TAKEN", {
      reason,
      runId: input.runId,
      error: err instanceof Error ? err.message : String(err),
    });
    return finalizeFallback({ input, deterministicFloor, reasoning: null, reason });
  }

  const parsed = CommercialReasoningOutputSchema.safeParse(llmResult.parsed);
  if (!parsed.success) {
    console.error("[CommercialReasoning] ZOD_REJECTED", {
      runId: input.runId,
      issues: parsed.error.issues.slice(0, 5),
    });
    return finalizeFallback({
      input,
      deterministicFloor,
      reasoning: null,
      reason: "commercial_reasoner_zod_rejected",
    });
  }

  let output = parsed.data;
  const downgrade = applyContradictionDowngrade(output);
  output = downgrade.output;

  // CRITICAL: gate substrate MUST be the exact prompt subset, not the
  // full AEL. Validating against full AEL would let the model cite rows
  // (rc:9, chain:7) it never actually saw — phantom-evidence Gate 2/3
  // would coincidentally pass on rows that share text with the prompt.
  const aelIndex = buildAelEvidenceIndexFromSubset(promptCorpus.rootCauses, promptCorpus.causalChains);
  const signalIds = new Set(input.signalEvidence?.keys() ?? []);
  const signalText = input.signalEvidence ?? new Map<string, string>();

  const gateChain: Array<() => GateResult> = [
    () => checkEvidenceRefExistence(output, aelIndex, signalIds),
    () => checkQuotedFragments(output, aelIndex, signalText),
    () => checkSignalOriginOverreach(output),
    () => checkPerFieldEvidenceLinkage(output),
    () => checkEvidenceDiversity(output),
  ];

  for (const gate of gateChain) {
    const r = gate();
    if (!r.passed) {
      recordCv11HallucinationExposure(r.reason!, ENGINE_ID);
      console.error("[CommercialReasoning] GATE_FAILED", {
        runId: input.runId,
        reason: r.reason,
        detail: r.detail,
      });
      return finalizeFallback({
        input,
        deterministicFloor,
        reasoning: output,
        reason: r.reason!,
        detail: r.detail,
      });
    }
  }

  const tpl = checkTemplatePhraseLeak(output);
  if (!tpl.result.passed) {
    recordCv11HallucinationExposure(tpl.result.reason!, ENGINE_ID);
    console.error("[CommercialReasoning] GATE_FAILED", {
      runId: input.runId,
      reason: tpl.result.reason,
      detail: tpl.result.detail,
      matches: tpl.matches,
    });
    return finalizeFallback({
      input,
      deterministicFloor,
      reasoning: output,
      reason: tpl.result.reason!,
      detail: tpl.result.detail,
    });
  }

  // AT4 — language-style grounding (post-audit gate, see integrity-gates.ts).
  // Runs LAST among integrity gates because it's the broadest and most
  // heuristic — every other gate is a structural contract check; this one
  // is a vocabulary-anchoring check. Substrate is the SAME prompt corpus
  // shown to the model (architect P4-A alignment rule).
  const langGate = checkLanguageStyleGrounding(output, {
    rootCauses: promptCorpus.rootCauses,
    causalChains: promptCorpus.causalChains,
    routeSourceTexts: input.awarenessRouteSourceTexts,
    productDnaSummary: input.productDnaSummary,
  });
  if (!langGate.result.passed) {
    recordCv11HallucinationExposure(langGate.result.reason!, ENGINE_ID);
    console.error("[CommercialReasoning] GATE_FAILED", {
      runId: input.runId,
      reason: langGate.result.reason,
      detail: langGate.result.detail,
      grounding: langGate.detail,
    });
    return finalizeFallback({
      input,
      deterministicFloor,
      reasoning: output,
      reason: langGate.result.reason!,
      detail: langGate.result.detail,
    });
  }

  if (
    output.reasoner_self_assessment === "insufficient_evidence" ||
    output.reasoner_self_assessment === "contradiction_unresolved"
  ) {
    const reason: GateDecisionReason =
      output.reasoner_self_assessment === "insufficient_evidence"
        ? "commercial_reasoner_insufficient_evidence"
        : "commercial_reasoner_contradiction_unresolved";
    return finalizeFallback({
      input,
      deterministicFloor,
      reasoning: output,
      reason,
    });
  }

  const integrityVerdict: IntegrityVerdict =
    output.reasoner_self_assessment === "grounded_complete" && !downgrade.downgraded
      ? "PASS"
      : "PARTIAL";

  const result: InterpretAwarenessDepthResult = {
    reasoning: output,
    gateDecision: {
      allow: output.depthAssessment !== "shallow",
      reason:
        output.reasoner_self_assessment === "grounded_complete"
          ? "reasoner_grounded_complete"
          : "reasoner_grounded_partial",
    },
    integrityVerdict,
    fellBackTo: "none",
    deterministicFloor,
  };

  await safePersist({
    input,
    reasoning: output,
    gateDecision: result.gateDecision,
    integrityVerdict,
    fellBackTo: "none",
  });

  return result;
}

interface FinalizeFallbackArgs {
  input: InterpretAwarenessDepthInput;
  deterministicFloor: DepthComplianceResult;
  reasoning: CommercialReasoningOutput | null;
  reason: GateDecisionReason;
  detail?: string;
}

async function finalizeFallback(args: FinalizeFallbackArgs): Promise<InterpretAwarenessDepthResult> {
  const allow = args.deterministicFloor.passed;
  const floorReason: GateDecisionReason = allow
    ? "deterministic_floor_passed"
    : "deterministic_floor_failed";
  const gateDecision = {
    allow,
    reason: args.reason,
    detail: args.detail ?? `floor=${floorReason} score=${args.deterministicFloor.causalDepthScore}`,
  };
  const result: InterpretAwarenessDepthResult = {
    reasoning: args.reasoning,
    gateDecision,
    integrityVerdict: "PARTIAL",
    fellBackTo: "deterministic_floor",
    deterministicFloor: args.deterministicFloor,
  };
  await safePersist({
    input: args.input,
    reasoning: args.reasoning,
    gateDecision,
    integrityVerdict: "PARTIAL",
    fellBackTo: "deterministic_floor",
  });
  return result;
}

interface SafePersistArgs {
  input: InterpretAwarenessDepthInput;
  reasoning: CommercialReasoningOutput | null;
  gateDecision: { allow: boolean; reason: GateDecisionReason; detail?: string };
  integrityVerdict: IntegrityVerdict;
  fellBackTo: FellBackTo;
}

async function safePersist(args: SafePersistArgs): Promise<void> {
  try {
    await persistCommercialReasoningSnapshot({
      accountId: args.input.accountId,
      campaignId: args.input.campaignId,
      runId: args.input.runId,
      engineId: ENGINE_ID,
      reasoning: args.reasoning,
      gateDecision: args.gateDecision,
      integrityVerdict: args.integrityVerdict,
      fellBackTo: args.fellBackTo,
    });
  } catch (err) {
    // Already logged in persist.ts. Persistence failure does NOT block the
    // gate decision — the deterministic floor result is already the source
    // of truth for awareness gate behavior.
    console.error("[CommercialReasoning] PERSIST_FAILED_NONFATAL", {
      runId: args.input.runId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
