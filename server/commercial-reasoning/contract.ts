/**
 * Phase 4-A — Commercial Reasoning Core (Zod contract).
 *
 * See `.local/plans/phase-4-commercial-reasoning-core.md` §3.
 *
 * Every LLM commercial-reasoning call MUST emit JSON matching
 * CommercialReasoningOutputSchema. The schema is the boundary between
 * the LLM cognition layer and the system truth layer:
 *
 *   - Strict enums on verdict-shaped fields satisfy D3.
 *   - `evidence_refs` with min 2 entries forces multi-source grounding.
 *   - `reasoner_self_assessment` gives the system layer an explicit
 *     signal to invoke the §5 fallback floor without prose parsing.
 *   - `uncertainty` is REQUIRED, not optional — silent confidence is a
 *     B1 (Truthfulness over confidence) violation.
 */

import { z } from "zod";

export const EvidenceRefSchema = z.object({
  refType: z.enum([
    "ael_root_cause",
    "ael_causal_chain",
    "signal",
    "competitor_observation",
  ]),
  refId: z.string().min(1),
  quotedFragment: z.string().min(10).max(300),
  appliesTo: z.array(z.string().min(1)).min(1),
});

export const CommercialPressureSchema = z.object({
  pressure: z.enum([
    "differentiation",
    "urgency",
    "trust",
    "proof",
    "category_saturation",
    "price_anchoring",
    "switching_cost",
    "perceived_risk",
    "decision_complexity",
  ]),
  intensity: z.enum(["low", "medium", "high", "blocking"]),
  evidence_ref_ids: z.array(z.string().min(1)).min(1),
});

export const ContradictionSchema = z.object({
  claimA: z.string().min(1),
  claimB: z.string().min(1),
  resolutionStance: z.enum([
    "claimA_preferred",
    "claimB_preferred",
    "unresolved",
  ]),
  resolutionReason: z.string().min(1),
});

export const UncertaintySchema = z.object({
  knownUnknowns: z.array(z.string()),
  lowEvidenceFields: z.array(z.string()),
  contradictionsSurfaced: z.array(ContradictionSchema),
});

export const CommercialReasoningOutputSchema = z.object({
  depthAssessment: z.enum(["shallow", "developing", "substantive", "deep"]),
  buyer_state: z.enum([
    "unaware",
    "problem_aware",
    "solution_aware",
    "product_aware",
    "most_aware",
  ]),
  saturation_state: z.enum([
    "greenfield",
    "emerging",
    "competitive",
    "saturated",
    "commoditized",
  ]),
  trust_state: z.enum([
    "cold",
    "skeptical",
    "neutral",
    "warming",
    "trusting",
  ]),
  reasoning: z.string().min(80).max(1200),
  evidence_refs: z.array(EvidenceRefSchema).min(2),
  commercial_pressures: z.array(CommercialPressureSchema).min(1),
  confidence: z.number().min(0).max(1),
  uncertainty: UncertaintySchema,
  signalOrigin: z.enum([
    "real",
    "competitor",
    "inferred",
    "fallback",
    "unknown",
  ]),
  provenance_origin: z.enum([
    "engine_seed",
    "exploration",
    "outcome",
    "mutation",
  ]),
  reasoner_self_assessment: z.enum([
    "grounded_complete",
    "grounded_partial",
    "insufficient_evidence",
    "contradiction_unresolved",
  ]),
});

export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;
export type CommercialPressure = z.infer<typeof CommercialPressureSchema>;
export type Contradiction = z.infer<typeof ContradictionSchema>;
export type Uncertainty = z.infer<typeof UncertaintySchema>;
export type CommercialReasoningOutput = z.infer<
  typeof CommercialReasoningOutputSchema
>;

/**
 * Canonical enum values for downstream gate-decision reasons. NEVER use
 * free-string statusMessages — every fallback-to-floor reason MUST be one
 * of these tokens (Doctrine D3 + B4).
 */
export const GATE_DECISION_REASONS = [
  "reasoner_grounded_complete",
  "reasoner_grounded_partial",
  "commercial_reasoner_insufficient_evidence",
  "commercial_reasoner_contradiction_unresolved",
  "commercial_reasoner_threw_AICallError",
  "commercial_reasoner_zod_rejected",
  "commercial_reasoner_json_parse_failed",
  "commercial_reasoner_wall_clock_timeout",
  "commercial_reasoner_phantom_evidence_ref",
  "commercial_reasoner_fabricated_quote",
  "commercial_reasoner_template_phrase_leak",
  "commercial_reasoner_anti_template_at1",
  "commercial_reasoner_anti_template_at2",
  "commercial_reasoner_signal_origin_overreach",
  // Phase 4-A post-audit additions (2026-05-18).
  // industry_not_allowed: operator allowlisted only a subset of industries
  // for reasoner enablement; the current industry is not in that subset.
  "commercial_reasoner_industry_not_allowed",
  // language_ungrounded: reasoning vocabulary did not anchor to the prompt
  // corpus (distinctive-token overlap below threshold). Catches the
  // local_services regression where SaaS-flavoured jargon was introduced
  // into a dentistry context despite passing every other integrity gate.
  "commercial_reasoner_language_ungrounded",
  "commercial_reasoner_disabled",
  "deterministic_floor_passed",
  "deterministic_floor_failed",
] as const;

export type GateDecisionReason = (typeof GATE_DECISION_REASONS)[number];

export const IntegrityVerdictSchema = z.enum(["PASS", "PARTIAL", "FAIL"]);
export type IntegrityVerdict = z.infer<typeof IntegrityVerdictSchema>;

export const FellBackToSchema = z.enum(["none", "deterministic_floor"]);
export type FellBackTo = z.infer<typeof FellBackToSchema>;
