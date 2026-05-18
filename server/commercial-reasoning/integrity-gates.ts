/**
 * Phase 4-A — Integrity gates for Commercial Reasoning Core.
 *
 * Implements §4 (gates 1-8) and §3a (AT1-AT3 anti-template).
 *
 * The Zod parse itself is gate #1 and is performed by the caller via
 * `CommercialReasoningOutputSchema.safeParse`; this module covers
 * the post-parse semantic gates 2-8 + the three anti-template gates.
 *
 * Every gate returns a `GateResult` rather than throwing — the caller
 * (awareness-depth-interpreter) folds results into a single decision so
 * fallback-to-floor can carry a single canonical reason enum.
 */

import type { AnalyticalPackage } from "../analytical-enrichment-layer/types";
import type {
  CommercialReasoningOutput,
  GateDecisionReason,
} from "./contract";
import { scanForTemplatePhrases } from "./template-phrases";

export interface GateResult {
  passed: boolean;
  reason?: GateDecisionReason;
  detail?: string;
}

const PASS: GateResult = { passed: true };

/**
 * AEL types (root_causes / causal_chains) carry no stable id field, so
 * Phase 4-A assigns refIds positionally and feeds those refIds into the
 * LLM prompt. Convention:
 *   - root_cause → "rc:<index>"
 *   - causal_chain → "chain:<index>"
 *   - signal / competitor_observation → caller-provided id from signal store
 *
 * `buildAelEvidenceIndex` produces a lookup the gates use to verify
 * existence + quoted fragments.
 */
export interface AelEvidenceIndex {
  rcText: Map<string, string>;
  chainText: Map<string, string>;
}

/**
 * Build the gate-substrate index from a specific subset of AEL rows
 * (typically the truncated slice shown in the LLM prompt). The caller
 * MUST pass the same arrays it embedded in the prompt — otherwise Gate
 * 2/3 will pass on phantom rows the model never saw.
 */
export function buildAelEvidenceIndexFromSubset(
  rootCauses: AnalyticalPackage["root_causes"],
  causalChains: AnalyticalPackage["causal_chains"],
): AelEvidenceIndex {
  const rcText = new Map<string, string>();
  const chainText = new Map<string, string>();
  for (let i = 0; i < rootCauses.length; i++) {
    const rc = rootCauses[i];
    rcText.set(
      `rc:${i}`,
      [rc.surfaceSignal, rc.deepCause, rc.causalReasoning, rc.sourceData]
        .filter(Boolean)
        .join(" ")
        .toLowerCase(),
    );
  }
  for (let i = 0; i < causalChains.length; i++) {
    const c = causalChains[i];
    chainText.set(
      `chain:${i}`,
      [c.pain, c.cause, c.impact, c.behavior, c.conversionEffect]
        .filter(Boolean)
        .join(" ")
        .toLowerCase(),
    );
  }
  return { rcText, chainText };
}

/**
 * Whole-AEL convenience wrapper for tests and tooling that want to mirror
 * the full substrate. **DO NOT** use from the interpreter — see the
 * docstring on `buildAelEvidenceIndexFromSubset`.
 */
export function buildAelEvidenceIndex(ael: AnalyticalPackage | null): AelEvidenceIndex {
  if (!ael) return { rcText: new Map(), chainText: new Map() };
  return buildAelEvidenceIndexFromSubset(ael.root_causes ?? [], ael.causal_chains ?? []);
}

/** Gate 2 — every evidence_refs[].refId resolves against the AEL substrate. */
export function checkEvidenceRefExistence(
  output: CommercialReasoningOutput,
  aelIndex: AelEvidenceIndex,
  signalIds: Set<string>,
): GateResult {
  for (const ref of output.evidence_refs) {
    let found = false;
    if (ref.refType === "ael_root_cause") found = aelIndex.rcText.has(ref.refId);
    else if (ref.refType === "ael_causal_chain") found = aelIndex.chainText.has(ref.refId);
    else if (ref.refType === "signal") found = signalIds.has(ref.refId);
    else if (ref.refType === "competitor_observation") found = signalIds.has(ref.refId);
    if (!found) {
      return {
        passed: false,
        reason: "commercial_reasoner_phantom_evidence_ref",
        detail: `unknown ${ref.refType} refId=${ref.refId}`,
      };
    }
  }
  return PASS;
}

/** Gate 3 — every quotedFragment is a substring of its referenced AEL/signal text. */
export function checkQuotedFragments(
  output: CommercialReasoningOutput,
  aelIndex: AelEvidenceIndex,
  signalTextById: Map<string, string>,
): GateResult {
  for (const ref of output.evidence_refs) {
    const haystack =
      ref.refType === "ael_root_cause"
        ? aelIndex.rcText.get(ref.refId)
        : ref.refType === "ael_causal_chain"
          ? aelIndex.chainText.get(ref.refId)
          : signalTextById.get(ref.refId);
    if (!haystack) {
      return {
        passed: false,
        reason: "commercial_reasoner_phantom_evidence_ref",
        detail: `quote check: missing source for refId=${ref.refId}`,
      };
    }
    if (!haystack.includes(ref.quotedFragment.toLowerCase())) {
      return {
        passed: false,
        reason: "commercial_reasoner_fabricated_quote",
        detail: `refId=${ref.refId} quote not found in source`,
      };
    }
  }
  return PASS;
}

/** Gate 6 — signalOrigin overreach. */
export function checkSignalOriginOverreach(
  output: CommercialReasoningOutput,
): GateResult {
  if (
    (output.signalOrigin === "fallback" || output.signalOrigin === "unknown") &&
    (output.depthAssessment === "substantive" || output.depthAssessment === "deep")
  ) {
    return {
      passed: false,
      reason: "commercial_reasoner_signal_origin_overreach",
      detail: `signalOrigin=${output.signalOrigin} + depthAssessment=${output.depthAssessment}`,
    };
  }
  return PASS;
}

/** AT1 — every enumerated state + commercial_pressure has at least one evidence_ref appliesTo entry. */
export function checkPerFieldEvidenceLinkage(
  output: CommercialReasoningOutput,
): GateResult {
  const linkedFields = new Set<string>();
  for (const ref of output.evidence_refs) {
    for (const f of ref.appliesTo) linkedFields.add(f);
  }
  const required = [
    "depthAssessment",
    "buyer_state",
    "saturation_state",
    "trust_state",
    ...output.commercial_pressures.map((p) => `commercial_pressures.${p.pressure}`),
  ];
  const missing = required.filter((f) => !linkedFields.has(f));
  if (missing.length > 0) {
    return {
      passed: false,
      reason: "commercial_reasoner_anti_template_at1",
      detail: `fields without evidence linkage: ${missing.join(", ")}`,
    };
  }
  return PASS;
}

/** AT2 — evidence diversity floor (≥2 distinct refIds always; ≥2 distinct refTypes when refs ≥3). */
export function checkEvidenceDiversity(
  output: CommercialReasoningOutput,
): GateResult {
  const refIds = new Set(output.evidence_refs.map((r) => r.refId));
  const refTypes = new Set(output.evidence_refs.map((r) => r.refType));
  if (refIds.size < 2) {
    return {
      passed: false,
      reason: "commercial_reasoner_anti_template_at2",
      detail: `evidence_refs share refIds (distinct=${refIds.size})`,
    };
  }
  if (output.evidence_refs.length >= 3 && refTypes.size < 2) {
    return {
      passed: false,
      reason: "commercial_reasoner_anti_template_at2",
      detail: `≥3 refs but only 1 distinct refType (${[...refTypes].join(",")})`,
    };
  }
  return PASS;
}

/** AT3 — template-phrase leak (≥2 occurrences across reasoning/pressures/uncertainty). */
export function checkTemplatePhraseLeak(
  output: CommercialReasoningOutput,
): { result: GateResult; matches: ReturnType<typeof scanForTemplatePhrases> } {
  const matches = scanForTemplatePhrases({
    reasoning: output.reasoning,
    commercial_pressures: output.commercial_pressures.map((p) => p.pressure),
    knownUnknowns: output.uncertainty.knownUnknowns,
  });
  const totalOccurrences = matches.reduce((sum, m) => sum + m.occurrences, 0);
  if (totalOccurrences >= 2) {
    return {
      result: {
        passed: false,
        reason: "commercial_reasoner_template_phrase_leak",
        detail: `${totalOccurrences} template-phrase hits across ${matches.length} phrases`,
      },
      matches,
    };
  }
  return { result: PASS, matches };
}

/**
 * AT4 — language-style grounding (Phase 4-A post-audit, 2026-05-18).
 *
 * The 3-industry treatment audit revealed that an LLM can pass every
 * existing gate (refIds exist, quotes verbatim, fields linked, no
 * filler phrases, no anti-template hits) and STILL produce reasoning
 * whose *vocabulary* is wrong for the vertical — e.g. importing
 * SaaS-shaped operator jargon into a dental practice context. This
 * gate measures vocabulary anchoring: how much of the distinctive
 * content vocabulary in `output.reasoning` actually traces back to
 * the prompt corpus the model was given.
 *
 * Heuristic — kept deliberately simple so behaviour is predictable
 * and tunable, and so it has zero LLM dependency:
 *
 *   1. Extract distinctive tokens (≥5 chars, alpha, not in stopword
 *      set) from the prompt corpus → `corpusVocab`.
 *   2. Extract distinctive tokens from `output.reasoning` → `outputVocab`.
 *   3. For each output token, mark "anchored" if it shares a ≥4-char
 *      prefix with any corpus token (catches singular/plural and
 *      common morphological variants without a real stemmer).
 *   4. Compute `overlap = anchored / |outputVocab|`.
 *   5. Reject if `overlap < threshold` (env-tunable, default 0.30) AND
 *      `|outputVocab| >= 8` (don't penalise terse outputs where the
 *      ratio is statistically meaningless).
 *
 * Threshold envelope rationale: 0.30 is loose enough that legitimate
 * abstractive reasoning passes (a grounded summary will share roughly
 * half its content vocabulary with the source on inspection of the
 * 3-industry dataset), but tight enough that wholesale jargon import
 * fails. Operators can override via
 * `COMMERCIAL_REASONER_VOCAB_OVERLAP_THRESHOLD` if real-world rollout
 * shows the heuristic is too strict or too loose.
 */

const VOCAB_STOPWORDS = new Set<string>([
  "about", "above", "after", "again", "against", "their", "there", "these",
  "those", "where", "which", "while", "would", "could", "should", "shall",
  "being", "because", "before", "below", "between", "during", "further",
  "having", "since", "through", "under", "until", "other", "another",
  "thing", "things", "something", "anything", "everything", "nothing",
  "really", "actually", "always", "never", "often", "sometimes", "usually",
  "needs", "needed", "needing", "makes", "making", "doing", "going",
  // Commercial-noise tokens that show up in nearly every corpus and
  // therefore cannot discriminate genuine grounding from jargon import:
  "customer", "customers", "market", "markets", "product", "products",
  "business", "brand", "brands", "value", "growth", "strategy", "strategic",
  "company", "companies", "audience", "buyer", "buyers", "people", "users",
]);

function extractDistinctiveTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  const lower = (text || "").toLowerCase();
  // Alpha sequences only; ignores numbers, hyphens, slashes, punctuation.
  const re = /[a-z]{5,}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(lower)) !== null) {
    const t = m[0];
    if (!VOCAB_STOPWORDS.has(t)) tokens.add(t);
  }
  return tokens;
}

function buildCorpusVocab(
  rootCauses: AnalyticalPackage["root_causes"],
  causalChains: AnalyticalPackage["causal_chains"],
  routeSourceTexts: string[],
  productDnaSummary: string | null | undefined,
): Set<string> {
  const buf: string[] = [];
  for (const rc of rootCauses) {
    buf.push(rc.surfaceSignal || "", rc.deepCause || "", rc.causalReasoning || "", rc.sourceData || "");
  }
  for (const c of causalChains) {
    buf.push(c.pain || "", c.cause || "", c.impact || "", c.behavior || "", c.conversionEffect || "");
  }
  for (const r of routeSourceTexts) buf.push(r || "");
  if (productDnaSummary) buf.push(productDnaSummary);
  return extractDistinctiveTokens(buf.join(" "));
}

function isAnchored(outputToken: string, corpusVocab: Set<string>): boolean {
  if (corpusVocab.has(outputToken)) return true;
  // Prefix-stem match (≥4 chars). Catches "patient" vs "patients",
  // "anxiety" vs "anxious", "intake" vs "intakes" without a real stemmer.
  const stem = outputToken.slice(0, 4);
  for (const c of corpusVocab) {
    if (c.startsWith(stem)) return true;
  }
  return false;
}

function getVocabOverlapThreshold(): number {
  const raw = process.env.COMMERCIAL_REASONER_VOCAB_OVERLAP_THRESHOLD;
  if (!raw) return 0.3;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return 0.3;
  return parsed;
}

const MIN_OUTPUT_TOKENS_FOR_GATE = 8;

export interface LanguageGroundingDetail {
  outputTokens: number;
  anchoredTokens: number;
  overlapRatio: number;
  threshold: number;
  unanchoredSample: string[];
}

export function checkLanguageStyleGrounding(
  output: CommercialReasoningOutput,
  corpus: {
    rootCauses: AnalyticalPackage["root_causes"];
    causalChains: AnalyticalPackage["causal_chains"];
    routeSourceTexts: string[];
    productDnaSummary?: string | null;
  },
): { result: GateResult; detail: LanguageGroundingDetail } {
  const corpusVocab = buildCorpusVocab(
    corpus.rootCauses,
    corpus.causalChains,
    corpus.routeSourceTexts,
    corpus.productDnaSummary ?? null,
  );
  const outputVocab = extractDistinctiveTokens(output.reasoning);
  const threshold = getVocabOverlapThreshold();

  if (outputVocab.size < MIN_OUTPUT_TOKENS_FOR_GATE) {
    // Too few distinctive tokens to measure overlap meaningfully.
    return {
      result: PASS,
      detail: {
        outputTokens: outputVocab.size,
        anchoredTokens: outputVocab.size,
        overlapRatio: 1,
        threshold,
        unanchoredSample: [],
      },
    };
  }

  // Empty corpus (no AEL + no routes + no DNA) → can't measure anchoring.
  // Don't penalise the reasoner for the upstream lack of evidence; this is
  // already covered by `reasoner_self_assessment=insufficient_evidence`.
  if (corpusVocab.size === 0) {
    return {
      result: PASS,
      detail: {
        outputTokens: outputVocab.size,
        anchoredTokens: 0,
        overlapRatio: 1,
        threshold,
        unanchoredSample: [],
      },
    };
  }

  let anchored = 0;
  const unanchored: string[] = [];
  for (const t of outputVocab) {
    if (isAnchored(t, corpusVocab)) anchored++;
    else if (unanchored.length < 10) unanchored.push(t);
  }
  const overlap = anchored / outputVocab.size;
  const detail: LanguageGroundingDetail = {
    outputTokens: outputVocab.size,
    anchoredTokens: anchored,
    overlapRatio: Number(overlap.toFixed(3)),
    threshold,
    unanchoredSample: unanchored,
  };

  if (overlap < threshold) {
    return {
      result: {
        passed: false,
        reason: "commercial_reasoner_language_ungrounded",
        detail: `overlap=${detail.overlapRatio} < threshold=${threshold} | outputTokens=${outputVocab.size} anchored=${anchored} | sample=${unanchored.slice(0, 5).join(",")}`,
      },
      detail,
    };
  }
  return { result: PASS, detail };
}

/** Gate 5 — contradiction-triggered confidence downgrade (mutating helper). */
export function applyContradictionDowngrade(
  output: CommercialReasoningOutput,
): { downgraded: boolean; output: CommercialReasoningOutput } {
  const unresolved = output.uncertainty.contradictionsSurfaced.some(
    (c) => c.resolutionStance === "unresolved",
  );
  if (unresolved && output.confidence > 0.7) {
    return {
      downgraded: true,
      output: {
        ...output,
        confidence: 0.5,
        reasoner_self_assessment: "grounded_partial",
      },
    };
  }
  return { downgraded: false, output };
}
