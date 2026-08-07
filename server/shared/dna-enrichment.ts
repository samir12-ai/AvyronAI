/**
 * ============================================================================
 * DNA ENRICHMENT — "grounded differentiator proposer" (Path A)
 * ============================================================================
 *
 * When the interchangeability judge rejects a positioning claim or an offer as
 * "generic / interchangeable", the root cause is almost always that Product DNA
 * lacks a proprietary mechanism/differentiator for the judge to test against.
 *
 * This module runs ONE additional LLM call that reads the current Product DNA,
 * the AEL causal interpretation (root causes / causal chains / buying barriers),
 * and the top competitor complaint signals, then proposes 1-2 candidate
 * differentiators grounded in gaps competitors demonstrably have — each citing
 * the AEL evidence IDs it is built on (e.g. RC2, CC2, BB1).
 *
 * DOCTRINE / SCOPE:
 *   - CANDIDATE ONLY, NO BYPASS. The output is injected into the retry context
 *     as additional feedback. The regenerated candidate still passes through the
 *     UNCHANGED interchangeability judge / gate battery. This module never edits,
 *     relaxes, or short-circuits any gate, threshold, or verdict.
 *   - FAIL-CLOSED (B3 safe degradation). Empty inputs, LLM failure, or an
 *     unparseable response all resolve to `status: "NOT_RUN"` with a loud
 *     `DNA_ENRICHMENT_*` log tag. The caller then proceeds to the normal retry /
 *     degrade path — enrichment NEVER blocks the pipeline.
 *   - REPLAY: this file lives in server/shared (whitelisted to call aiChat, like
 *     the judges). aiChat enforces its own HARD_TIMEOUT_MS wall-clock timeout, so
 *     a plain aiChat call already satisfies the NO-BARE-LLM continuity doctrine.
 */
import { z } from "zod";
import { aiChat } from "../ai-client";
import { safeJsonParse } from "./strategic-doctrine";
import type { JudgeKind } from "./interchangeability-judge";
import type { AnalyticalPackage } from "../analytical-enrichment-layer/types";

/** Minimal Product DNA projection the enrichment call needs (engines fill this). */
export interface EnrichmentDnaInput {
  name?: string;
  businessType?: string;
  productCategory?: string;
  coreProblemSolved?: string;
  uniqueMechanism?: string;
  strategicAdvantage?: string;
}

export interface DnaEnrichmentCandidate {
  /** A proprietary differentiator/mechanism a competitor could not truthfully repeat. */
  differentiator: string;
  /** AEL evidence IDs this candidate is grounded in, e.g. ["RC2","CC2"]. */
  groundingRefs: string[];
  /** One line on why competitors demonstrably lack this (cites the gap). */
  rationale: string;
}

export interface DnaEnrichmentResult {
  /** ENRICHED when at least one grounded candidate was produced; NOT_RUN otherwise. */
  status: "ENRICHED" | "NOT_RUN";
  candidates: DnaEnrichmentCandidate[];
  /** On NOT_RUN, the explicit reason (empty inputs / LLM error / unparseable). */
  reason: string;
}

/**
 * The enrichment outcome an engine SURFACES on its result object (no DB write in
 * the engine — purity). The orchestrator reads this and upserts / auto-resolves
 * the campaign-scoped dna_enrichment_requests flag.
 */
export interface DnaEnrichmentSignal {
  /** true when the interchangeability gate was STILL failing at retry exhaustion. */
  required: boolean;
  /** Which judge kind this engine reports for (positioning claim or offer). */
  engineKind: "positioning_claim" | "offer";
  /** The judge's last interchangeability rejection reason. */
  lastRejectionReason: string;
  /** Grounded candidates from Path A (empty when enrichment was NOT_RUN). */
  candidates: DnaEnrichmentCandidate[];
  /** Non-technical confirm/edit prompt for the dashboard ("" when NOT_RUN). */
  suggestionText: string;
}

const EnrichmentOutputSchema = z.object({
  candidates: z
    .array(
      z.object({
        differentiator: z.string().min(1),
        groundingRefs: z.array(z.string()).default([]),
        rationale: z.string().default(""),
      }),
    )
    .min(1),
});

/** Marshal AEL fields into stable, index-based evidence lines (RC/CC/BB IDs). */
function marshalAelEvidence(ael: AnalyticalPackage | null): {
  lines: string[];
  validIds: Set<string>;
} {
  const lines: string[] = [];
  const validIds = new Set<string>();
  if (!ael) return { lines, validIds };

  ael.root_causes?.forEach((rc, i) => {
    const id = `RC${i + 1}`;
    validIds.add(id);
    lines.push(`[${id}] surface "${rc.surfaceSignal}" → deep cause: ${rc.deepCause} (${rc.confidenceLevel})`);
  });
  ael.causal_chains?.forEach((cc, i) => {
    const id = `CC${i + 1}`;
    validIds.add(id);
    lines.push(`[${id}] ${cc.pain} → ${cc.cause} → ${cc.impact} → ${cc.behavior} (conversion: ${cc.conversionEffect})`);
  });
  ael.buying_barriers?.forEach((bb, i) => {
    const id = `BB${i + 1}`;
    validIds.add(id);
    lines.push(`[${id}] [${bb.severity}] ${bb.barrier} — root cause: ${bb.rootCause}`);
  });
  return { lines, validIds };
}

function describeDna(dna: EnrichmentDnaInput | null): string {
  if (!dna) return "(no product context available)";
  const parts = [
    dna.name ? `Name: ${dna.name}` : "",
    dna.businessType ? `Type: ${dna.businessType}` : "",
    dna.productCategory ? `Category: ${dna.productCategory}` : "",
    dna.coreProblemSolved ? `Core problem solved: ${dna.coreProblemSolved}` : "",
    dna.uniqueMechanism ? `Current unique mechanism: ${dna.uniqueMechanism}` : "",
    dna.strategicAdvantage ? `Current strategic advantage: ${dna.strategicAdvantage}` : "",
  ].filter((p) => p.length > 0);
  return parts.length > 0 ? parts.join("\n") : "(product context present but empty of differentiators)";
}

function buildEnrichmentPrompt(input: {
  kind: JudgeKind;
  rejectionReason: string;
  dna: EnrichmentDnaInput | null;
  aelLines: string[];
  competitorComplaints: string[];
}): string {
  const kindLabel = input.kind === "offer" ? "OFFER" : "POSITIONING CLAIM";
  const aelBlock = input.aelLines.length > 0 ? input.aelLines.join("\n") : "(no AEL evidence available)";
  const complaintBlock =
    input.competitorComplaints.length > 0
      ? input.competitorComplaints.slice(0, 8).map((c) => `- ${c}`).join("\n")
      : "(no competitor complaint signals available)";

  return `You are a strategy analyst extracting a PROPRIETARY DIFFERENTIATOR for a product.

WHY: an interchangeability judge just REJECTED this product's ${kindLabel} as generic — it could be pasted unchanged onto a competitor. Judge reason:
"""
${input.rejectionReason}
"""

CURRENT PRODUCT IDENTITY / CONTEXT:
${describeDna(input.dna)}

AEL CAUSAL EVIDENCE (each line has a stable ID you MUST cite when you use it):
${aelBlock}

TOP COMPETITOR COMPLAINT SIGNALS (gaps competitors demonstrably have):
${complaintBlock}

YOUR TASK:
Propose 1-2 candidate differentiators/mechanisms this product could truthfully own, each grounded in a gap competitors demonstrably have. Rules:
- Each candidate MUST cite at least one existing AEL evidence ID from the list above (e.g. RC2, CC2, BB1) in "groundingRefs". Do NOT invent IDs that are not listed.
- Each differentiator must be SPECIFIC enough that a competitor could NOT truthfully repeat it — tie it to the cited gap.
- Do NOT restate generic benefits ("save money", "easy to use", "proven system"). Name the concrete mechanism or capability.
- Keep each differentiator to one sentence.

Return ONLY valid JSON, no commentary:
{"candidates":[{"differentiator":"one specific sentence","groundingRefs":["RC2","CC2"],"rationale":"one line on the competitor gap this exploits"}]}`;
}

/**
 * Run ONE enrichment LLM call. Fail-closed to NOT_RUN on any failure.
 * @returns candidates whose groundingRefs are filtered to real AEL IDs only.
 */
export async function enrichDnaFromRejection(input: {
  kind: JudgeKind;
  rejectionReason: string;
  dna: EnrichmentDnaInput | null;
  ael: AnalyticalPackage | null;
  competitorComplaints: string[];
  accountId: string;
}): Promise<DnaEnrichmentResult> {
  const { kind, rejectionReason, dna, ael, competitorComplaints, accountId } = input;

  const { lines: aelLines, validIds } = marshalAelEvidence(ael);
  // Enrichment is only meaningful when there is causal evidence to ground it in.
  // No AEL evidence → NOT_RUN (never fabricate an ungrounded differentiator).
  if (aelLines.length === 0) {
    console.error(`[DnaEnrichment] DNA_ENRICHMENT_SKIPPED kind=${kind} — no AEL evidence to ground candidates — status=NOT_RUN`);
    return { status: "NOT_RUN", candidates: [], reason: "NO_AEL_EVIDENCE: nothing to ground a differentiator in" };
  }

  let raw: string | null = null;
  try {
    const resp = await aiChat({
      messages: [
        {
          role: "user",
          content: buildEnrichmentPrompt({ kind, rejectionReason, dna, aelLines, competitorComplaints }),
        },
      ],
      model: "gpt-4.1-mini",
      temperature: 0.2,
      max_tokens: 500,
      accountId,
    });
    raw = resp.choices?.[0]?.message?.content?.trim() ?? null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[DnaEnrichment] DNA_ENRICHMENT_FAILED kind=${kind} — CALL_FAILED — status=NOT_RUN — ${msg}`);
    return { status: "NOT_RUN", candidates: [], reason: `ENRICHMENT_ERROR: ${msg}` };
  }

  const parsed = safeJsonParse(raw, EnrichmentOutputSchema);
  if (!parsed) {
    console.error(`[DnaEnrichment] DNA_ENRICHMENT_FAILED kind=${kind} — UNPARSEABLE — status=NOT_RUN — raw="${(raw ?? "").slice(0, 80)}"`);
    return { status: "NOT_RUN", candidates: [], reason: "ENRICHMENT_ERROR: unparseable enrichment output" };
  }

  // Keep only candidates that cite at least one REAL AEL id (drop hallucinated grounding).
  const grounded: DnaEnrichmentCandidate[] = [];
  for (const c of parsed.candidates) {
    const refs = c.groundingRefs.map((r) => r.toUpperCase().trim()).filter((r) => validIds.has(r));
    if (refs.length === 0) {
      console.error(`[DnaEnrichment] DNA_ENRICHMENT_UNGROUNDED kind=${kind} — dropped candidate citing no real AEL id — "${c.differentiator.slice(0, 60)}"`);
      continue;
    }
    grounded.push({ differentiator: c.differentiator.trim(), groundingRefs: refs, rationale: c.rationale.trim() });
  }

  if (grounded.length === 0) {
    console.error(`[DnaEnrichment] DNA_ENRICHMENT_FAILED kind=${kind} — all candidates ungrounded — status=NOT_RUN`);
    return { status: "NOT_RUN", candidates: [], reason: "ENRICHMENT_ERROR: no candidate cited real AEL evidence" };
  }

  console.log(
    `[DnaEnrichment] DNA_ENRICHMENT_OK kind=${kind} candidates=${grounded.length} refs=${grounded.map((g) => g.groundingRefs.join("+")).join(",")}`,
  );
  return { status: "ENRICHED", candidates: grounded, reason: "" };
}

/**
 * Render enrichment candidates as an additional retry-context block. Returns "" when
 * there is nothing grounded to add (so the caller appends nothing, never noise).
 */
export function formatEnrichmentForRetry(result: DnaEnrichmentResult, kind: JudgeKind): string {
  if (result.status !== "ENRICHED" || result.candidates.length === 0) return "";
  const target = kind === "offer" ? "offer's outcome + mechanism" : "positioning claim's contrast axis and narrative";
  const lines = result.candidates.map(
    (c) => `- "${c.differentiator}" [grounded in ${c.groundingRefs.join(", ")}] — ${c.rationale}`,
  );
  return `
GROUNDED DIFFERENTIATOR CANDIDATES (derived from gaps competitors demonstrably have — use ONE to make the output non-interchangeable):
${lines.join("\n")}
Anchor the ${target} to one of these so no competitor could truthfully repeat it. Keep it truthful to the product.`;
}

/**
 * Normalise a phrase for coarse semantic comparison: lowercase, strip
 * punctuation, collapse whitespace. Used only to detect a circular confirm — it
 * is intentionally lossy and never used for grounding or gate decisions.
 */
function normalizeForCompare(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * True when the enrichment candidate essentially restates the anchor's existing
 * differentiating feature (exact-normalised match, substring containment, or a
 * high content-word overlap). Deliberately conservative so we only trip the
 * circular-confirm guard when the two are substantially the same claim.
 */
function isSubstantiallyIdentical(candidate: string, existing: string): boolean {
  const nc = normalizeForCompare(candidate);
  const ne = normalizeForCompare(existing);
  if (!nc || !ne) return false;
  if (nc === ne) return true;
  if (nc.includes(ne) || ne.includes(nc)) return true;
  const tc = new Set(nc.split(" ").filter((w) => w.length > 3));
  const te = new Set(ne.split(" ").filter((w) => w.length > 3));
  if (tc.size === 0 || te.size === 0) return false;
  let overlap = 0;
  for (const w of tc) if (te.has(w)) overlap++;
  const smaller = Math.min(tc.size, te.size);
  return overlap / smaller >= 0.7;
}

/**
 * Build the non-technical, user-facing confirm/edit suggestion for the dashboard
 * card (Path B). Returns "" when there is no grounded candidate to suggest.
 *
 * When the top grounded candidate substantially restates the product's CURRENT
 * differentiating feature (`anchor`), a "does your product do this? confirm it"
 * prompt would be a circular no-op. In that case we instead ask the operator for
 * a NEW proof point (number / named capability / uncontestable result). Purely a
 * card-copy change — no gate, judge, threshold, or decision field is affected.
 */
export function buildEnrichmentSuggestion(
  result: DnaEnrichmentResult,
  anchor?: { differentiatingFeature?: string | null } | null,
): string {
  if (result.status !== "ENRICHED" || result.candidates.length === 0) return "";
  const top = result.candidates[0];
  const existingFeature = (anchor?.differentiatingFeature ?? "").trim();
  if (existingFeature && isSubstantiallyIdentical(top.differentiator, existingFeature)) {
    console.log(`[DnaEnrichment] SUGGESTION_CIRCULAR_GUARD — top candidate restates existing anchor differentiator; asking for a new proof point instead`);
    return `Your current edge is "${existingFeature}", but competitors are closing this gap. Add ONE new proof point that makes it undeniable — a specific number, a named capability, or a result no competitor can truthfully claim.`;
  }
  return `Based on what competitors keep getting wrong, your edge may be: "${top.differentiator}". Does your product do this? Confirm it, or write one line describing what you do that no competitor does.`;
}
