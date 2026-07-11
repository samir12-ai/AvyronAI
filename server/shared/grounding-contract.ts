/**
 * ============================================================================
 * GROUNDING CONTRACT — one shared prompt-side grounding block for judged engines
 * ============================================================================
 *
 * PURPOSE
 * A single, additive prompt block injected into every LLM generation whose
 * output is later checked by the interchangeability judge, Integrity, or CEL.
 * It compels three OUTPUT-CONTRACT behaviours WITHOUT touching any gate, judge,
 * threshold, retry count, or System-Control logic:
 *
 *   RULE 1 (mechanism naming) — the output MUST reference the product's
 *     differentiating mechanism (ProductAnchor.differentiatingFeature) concretely
 *     as a NAMED capability, not an abstract paraphrase. If differentiatingFeature
 *     is empty the model states that in its grounding metadata instead of
 *     inventing one.
 *   RULE 2 (AEL citation) — the output MUST ground 2-3 claims in real AEL items
 *     using the audience's actual pain language, and list every evidence ID it
 *     used in a structured `groundingRefs: string[]` field of its JSON output
 *     (e.g. ["RC2","CC1"]).
 *   RULE 3 (self-check) — before returning, the model verifies "could any
 *     sentence be pasted unchanged into a generic competitor's marketing?" and
 *     rewrites if so. This MIRRORS the downstream judge criterion; it NEVER
 *     replaces the judge — the unchanged interchangeability judge remains the
 *     sole enforcement authority.
 *
 * DOCTRINE
 *   - PROMPT-SIDE + SCHEMA FIELD + LOUD LOGGING ONLY. Missing/empty
 *     `groundingRefs` on a judged engine logs `GROUNDING_CONTRACT_UNMET` loudly
 *     (B2 visibility) but NEVER hard-fails generation and NEVER bypasses a gate
 *     (B3). The existing gates remain the enforcement authority.
 *   - The reference namespace ([RC#]/[CC#]/[BB#], 1-based) is IDENTICAL to
 *     `buildStructuredAELBlock` (differentiation/mechanism) and
 *     `marshalAelEvidence` (dna-enrichment) so refs are stable across every
 *     engine and audit surface.
 */
import { z } from "zod";
import type { AnalyticalPackage } from "../analytical-enrichment-layer/types";
import type { ProductAnchor } from "./strategic-doctrine";

/**
 * Zod fragment for the structured output field. `.optional()` (never required) so
 * a missing field NEVER hard-fails validation — the loud log below is the only
 * consequence, keeping the existing gates as the sole enforcement authority.
 */
export const groundingRefsSchema = z.array(z.string()).optional();

/**
 * The canonical, 1-based evidence IDs available in this AEL package
 * (RC1..RCn, CC1..CCn, BB1..BBn). Same numbering as buildStructuredAELBlock /
 * marshalAelEvidence.
 */
export function extractAvailableAelRefs(ael: AnalyticalPackage | null | undefined): string[] {
  const ids: string[] = [];
  if (!ael) return ids;
  const rc: unknown[] = Array.isArray((ael as any).root_causes) ? (ael as any).root_causes : [];
  const cc: unknown[] = Array.isArray((ael as any).causal_chains) ? (ael as any).causal_chains : [];
  const bb: unknown[] = Array.isArray((ael as any).buying_barriers) ? (ael as any).buying_barriers : [];
  rc.slice(0, 5).forEach((_, i) => ids.push(`RC${i + 1}`));
  cc.slice(0, 5).forEach((_, i) => ids.push(`CC${i + 1}`));
  bb.slice(0, 5).forEach((_, i) => ids.push(`BB${i + 1}`));
  return ids;
}

/**
 * A citable AEL evidence index using the canonical [RC#]/[CC#]/[BB#] tags.
 * Injected into engines whose existing AEL block does NOT already carry these
 * tags (positioning, funnel, offer, awareness, persuasion, audience) so the
 * model can cite stable IDs. Returns "" when there is no AEL to cite.
 * Differentiation/mechanism already render this namespace via
 * buildStructuredAELBlock and do NOT need this block.
 */
export function buildAelReferenceIndex(ael: AnalyticalPackage | null | undefined): string {
  if (!ael) return "";
  const rc: any[] = Array.isArray((ael as any).root_causes) ? (ael as any).root_causes : [];
  const cc: any[] = Array.isArray((ael as any).causal_chains) ? (ael as any).causal_chains : [];
  const bb: any[] = Array.isArray((ael as any).buying_barriers) ? (ael as any).buying_barriers : [];
  if (rc.length === 0 && cc.length === 0 && bb.length === 0) return "";

  const lines: string[] = [];
  lines.push("\n═══ AEL EVIDENCE INDEX (cite these exact IDs in groundingRefs) ═══");
  rc.slice(0, 5).forEach((r: any, i: number) => {
    lines.push(`[RC${i + 1}] surface: "${r.surfaceSignal}" → deep cause: ${r.deepCause} [${r.confidenceLevel}]`);
  });
  cc.slice(0, 5).forEach((c: any, i: number) => {
    lines.push(`[CC${i + 1}] ${c.pain} → ${c.cause} → ${c.impact} → ${c.behavior} (conversion: ${c.conversionEffect})`);
  });
  bb.slice(0, 5).forEach((b: any, i: number) => {
    lines.push(`[BB${i + 1}] [${b.severity}] ${b.barrier} — root: ${b.rootCause}`);
  });
  lines.push("═══ END AEL EVIDENCE INDEX ═══\n");
  return lines.join("\n");
}

/**
 * The shared grounding-contract block (RULES 1-3). Additive — appended to an
 * engine's existing prompt intent, never a per-engine fork. `anchor` and `ael`
 * are rendered honestly: an absent differentiatingFeature or empty AEL produces
 * the truthful "state it / cite nothing" branch rather than a fabricated demand.
 */
export function buildGroundingContract(
  anchor: ProductAnchor | null | undefined,
  ael: AnalyticalPackage | null | undefined,
): string {
  const availableRefs = extractAvailableAelRefs(ael);
  const hasRefs = availableRefs.length > 0;
  const rawFeature = anchor && typeof anchor.differentiatingFeature === "string" ? anchor.differentiatingFeature.trim() : "";
  const hasFeature = rawFeature.length > 0;

  const lines: string[] = [];
  lines.push("\n═══ GROUNDING CONTRACT (output-contract rules — additive; the unchanged gates remain the sole enforcement authority) ═══");

  if (hasFeature) {
    lines.push(
      `RULE 1 — MECHANISM NAMING: Your output MUST reference this product's differentiating mechanism concretely by name: "${rawFeature}". Name the specific capability — do NOT paraphrase it into an abstract category (e.g. "a validation gap", "a transformation capability"). Every core claim must trace to this named mechanism.`,
    );
  } else {
    lines.push(
      'RULE 1 — MECHANISM NAMING: No differentiating feature is set for this product. Do NOT invent one. State "no differentiating feature set" in your grounding metadata and ground your claims in the AEL evidence and audience pain language instead.',
    );
  }

  if (hasRefs) {
    lines.push(
      `RULE 2 — AEL CITATION: Ground 2-3 of your claims in the [RC#]/[CC#]/[BB#] evidence shown above, using the audience's ACTUAL pain language — not generic category words. List every evidence ID you used in a structured "groundingRefs" array in your JSON output, e.g. "groundingRefs": ["RC2","CC1"]. Cite ONLY IDs from this available set: ${availableRefs.join(", ")}. Do NOT invent IDs.`,
    );
  } else {
    lines.push(
      'RULE 2 — AEL CITATION: No AEL evidence is available for this run. Set "groundingRefs": [] and ground your claims in the audience pain language provided elsewhere in this prompt. Do NOT fabricate evidence IDs.',
    );
  }

  lines.push(
    'RULE 3 — SELF-CHECK: Before returning, verify: "Could any sentence I wrote be pasted unchanged into a generic competitor\'s marketing?" If yes, rewrite it to be specific to this product\'s named mechanism and the cited audience evidence. (This mirrors the downstream judge\'s criterion; it does NOT replace it.)',
  );

  lines.push("═══ END GROUNDING CONTRACT ═══\n");
  return lines.join("\n");
}

export interface GroundingContractCheck {
  met: boolean;
  reason: "OK" | "NO_REFS_EMITTED" | "REFS_NOT_IN_AEL" | "NO_AEL_AVAILABLE";
  citedRefs: string[];
  invalidRefs: string[];
}

/**
 * Validate the groundingRefs an engine emitted against the AEL that was
 * available, and LOG LOUDLY when the contract is unmet. NEVER throws and NEVER
 * mutates a verdict — the caller proceeds exactly as before; the existing gates
 * remain the sole enforcement authority.
 *
 * - No AEL available  → met=true (an empty groundingRefs is truthful, not a miss).
 * - AEL available but no refs emitted → GROUNDING_CONTRACT_UNMET (loud).
 * - Refs emitted that are not in the AEL → GROUNDING_CONTRACT_UNMET (loud).
 */
export function checkGroundingContract(params: {
  engine: string;
  site?: string;
  groundingRefs: unknown;
  ael: AnalyticalPackage | null | undefined;
  accountId?: string;
  attemptNumber?: number;
}): GroundingContractCheck {
  const { engine, site, ael, accountId, attemptNumber } = params;
  const available = new Set(extractAvailableAelRefs(ael));
  const cited = Array.isArray(params.groundingRefs)
    ? params.groundingRefs
        .filter((r): r is string => typeof r === "string" && r.trim().length > 0)
        .map((r) => r.trim().toUpperCase())
    : [];
  const invalidRefs = cited.filter((r) => !available.has(r));
  const siteTag = site ? ` | site=${site}` : "";
  const attempt = attemptNumber ?? 1;
  const account = accountId ?? "unknown";

  if (available.size === 0) {
    return { met: true, reason: "NO_AEL_AVAILABLE", citedRefs: cited, invalidRefs: [] };
  }
  if (cited.length === 0) {
    console.error(
      `[GroundingContract] GROUNDING_CONTRACT_UNMET | engine=${engine}${siteTag} | attempt=${attempt} | reason=NO_REFS_EMITTED | availableRefs=${available.size} | account=${account}`,
    );
    return { met: false, reason: "NO_REFS_EMITTED", citedRefs: [], invalidRefs: [] };
  }
  if (invalidRefs.length > 0) {
    console.error(
      `[GroundingContract] GROUNDING_CONTRACT_UNMET | engine=${engine}${siteTag} | attempt=${attempt} | reason=REFS_NOT_IN_AEL | invalid=${invalidRefs.join(",")} | cited=${cited.join("+")} | account=${account}`,
    );
    return { met: false, reason: "REFS_NOT_IN_AEL", citedRefs: cited, invalidRefs };
  }
  console.log(
    `[GroundingContract] GROUNDING_CONTRACT_MET | engine=${engine}${siteTag} | attempt=${attempt} | cited=${cited.join("+")} | account=${account}`,
  );
  return { met: true, reason: "OK", citedRefs: cited, invalidRefs: [] };
}
