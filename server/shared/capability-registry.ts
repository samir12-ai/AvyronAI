import crypto from "crypto";
import { z } from "zod";
import type { ProductAnchor, ProductDnaLike } from "./strategic-doctrine";

/**
 * ============================================================================
 * VALIDATED PRODUCT CAPABILITY REGISTRY — CAPABILITY_NAMESPACE authority
 * ============================================================================
 *
 * GLOBAL AUTHORITY MODEL (permanent system rule):
 *   PAIN REGISTRY    = authority for WHAT PROBLEM EXISTS (PROBLEM_NAMESPACE)
 *   PRODUCT ANCHOR   = authority for WHAT THE PRODUCT CAN DO (CAPABILITY_NAMESPACE)
 *   ENGINE           = authority only for HOW a validated capability addresses
 *                      an eligible problem (SYNTHESIS_NAMESPACE)
 *   JUDGE            = verifies the engine preserved both authorities.
 *
 * No namespace may silently create authoritative truth inside another
 * namespace. This module derives the CAPABILITY_NAMESPACE deterministically
 * from authoritative product/business inputs ONLY:
 *   - the validated Product Anchor (per-campaign product identity)
 *   - the Business Data Layer / Product DNA fields the user supplied
 *
 * These are NOT automatically authoritative capability sources and are NEVER
 * consumed here: audience inference, competitor complaints, positioning /
 * differentiation / mechanism / offer outputs, build-plan text, previous
 * strategy, LLM enrichment proposals. A derived strategic idea can only enter
 * the anchor through the audited write path after explicit validation
 * (see validateCapabilityCandidate + the dna-enrichment resolve route).
 */

export interface ValidatedCapability {
  /** Stable content-hash id: cap_<12 hex chars of sha256(source+statement)>. */
  capabilityId: string;
  /** The capability statement, verbatim from the authoritative source field. */
  statement: string;
  /** Which authoritative namespace field supplied this capability. */
  source:
    | "anchor.differentiatingFeature"
    | "anchor.keyAttributes"
    | "anchor.coreProblemSolved"
    | "dna.uniqueMechanism"
    | "dna.strategicAdvantage"
    | "dna.coreOffer";
  /** Human-readable source reference (field path). */
  sourceRef: string;
  /** All registry entries are validated by construction (authoritative inputs only). */
  validationStatus: "VALIDATED";
  /** What kinds of claims this capability may support. */
  allowedClaimScope: "product_capability_claims";
}

export function computeCapabilityId(source: string, statement: string): string {
  return (
    "cap_" +
    crypto.createHash("sha256").update(`${source}\u0000${statement.trim()}`).digest("hex").slice(0, 12)
  );
}

/**
 * Deterministically derive the validated capability registry for one campaign
 * from its Product Anchor and (optionally) Product DNA. Pure function — same
 * inputs always produce the same registry (and the same capabilityIds).
 * Duplicate statements (case-insensitive) are emitted once, anchor first.
 */
export function deriveValidatedCapabilities(
  anchor: ProductAnchor | null | undefined,
  dna?: ProductDnaLike | null,
): ValidatedCapability[] {
  const out: ValidatedCapability[] = [];
  const seen = new Set<string>();
  const push = (source: ValidatedCapability["source"], sourceRef: string, statement: unknown) => {
    const s = typeof statement === "string" ? statement.trim() : "";
    if (s.length === 0) return;
    const key = s.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      capabilityId: computeCapabilityId(source, s),
      statement: s,
      source,
      sourceRef,
      validationStatus: "VALIDATED",
      allowedClaimScope: "product_capability_claims",
    });
  };
  if (anchor) {
    push("anchor.differentiatingFeature", "product_anchor.differentiatingFeature", anchor.differentiatingFeature);
    (anchor.keyAttributes ?? []).forEach((a, i) =>
      push("anchor.keyAttributes", `product_anchor.keyAttributes[${i}]`, a),
    );
    push("anchor.coreProblemSolved", "product_anchor.coreProblemSolved", anchor.coreProblemSolved);
  }
  if (dna) {
    push("dna.uniqueMechanism", "business_data_layer.unique_mechanism", dna.uniqueMechanism ?? "");
    push("dna.strategicAdvantage", "business_data_layer.strategic_advantage", dna.strategicAdvantage ?? "");
  }
  return out;
}

/** Stable 16-char hash of the whole registry (for run lineage capture). */
export function computeCapabilityRegistryHash(caps: ValidatedCapability[]): string {
  const canonical = JSON.stringify(caps.map((c) => c.capabilityId).sort());
  return crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

/** Optional structured output field engines may emit alongside groundingRefs. */
export const capabilityRefsSchema = z.array(z.string()).optional();

/**
 * Render the CAPABILITY_NAMESPACE prompt block: the validated capabilities with
 * their stable IDs. Returns "" when the registry is empty (truthful absence —
 * never fabricate a capability list).
 */
export function buildCapabilityBlock(caps: ValidatedCapability[]): string {
  if (caps.length === 0) return "";
  const lines: string[] = [];
  lines.push("\n═══ VALIDATED PRODUCT CAPABILITIES (the ONLY capabilities you may claim) ═══");
  for (const c of caps) {
    lines.push(`[${c.capabilityId}] ${c.statement}  (source: ${c.sourceRef})`);
  }
  lines.push(
    "Product-capability claims in your output MUST resolve to one of these IDs. Do NOT invent, extend, or merge capabilities. List the IDs you used in a structured \"capabilityRefs\": string[] field of your JSON output when the schema allows it.",
  );
  lines.push("═══ END VALIDATED PRODUCT CAPABILITIES ═══\n");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Candidate-capability validation — the ONLY lifecycle by which derived
// strategic inference may reach Product Identity:
//   DERIVED INFERENCE → candidate → compare with authoritative evidence
//   → ACCEPT / REJECT / NEEDS_USER_CONFIRMATION → audited anchor write.
// ---------------------------------------------------------------------------

export type CandidateDecision = "ACCEPT" | "REJECT" | "NEEDS_USER_CONFIRMATION";

export interface CandidateValidation {
  decision: CandidateDecision;
  /** 0..1 token-overlap support score against authoritative evidence. */
  supportScore: number;
  /** Which authoritative fields supported the candidate. */
  supportedBy: string[];
  reason: string;
}

const STOPWORDS = new Set(
  "a an and are as at be by for from has have in into is it its of on or that the their this to was were will with our your you we they them us".split(" "),
);

function contentTokens(s: string): Set<string> {
  return new Set(
    String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOPWORDS.has(t)),
  );
}

/**
 * Compare a candidate capability statement against the authoritative
 * product/business evidence. Deterministic, generic (no product- or
 * domain-specific keywords):
 *   - supportScore = share of the candidate's content tokens found in ANY
 *     authoritative field (anchor fields count only when they are themselves
 *     not the candidate under replacement).
 *   - ≥ 0.6 → ACCEPT (candidate restates what authoritative sources say)
 *   - 0.3–0.6 → NEEDS_USER_CONFIRMATION (partially supported — a human must
 *     confirm the unsupported part is real product truth)
 *   - < 0.3 → REJECT (predominantly novel claim — derived strategy language
 *     may NOT become Product Identity without independent authority)
 */
export function validateCapabilityCandidate(params: {
  candidate: string;
  authoritativeFields: Record<string, string | null | undefined>;
}): CandidateValidation {
  const cand = contentTokens(params.candidate);
  if (cand.size === 0) {
    return { decision: "REJECT", supportScore: 0, supportedBy: [], reason: "EMPTY_CANDIDATE" };
  }
  const supportedBy: string[] = [];
  const covered = new Set<string>();
  for (const [field, value] of Object.entries(params.authoritativeFields)) {
    const toks = contentTokens(String(value ?? ""));
    if (toks.size === 0) continue;
    let hit = false;
    for (const t of cand) {
      if (toks.has(t)) {
        covered.add(t);
        hit = true;
      }
    }
    if (hit) supportedBy.push(field);
  }
  const supportScore = covered.size / cand.size;
  let decision: CandidateDecision;
  if (supportScore >= 0.6) decision = "ACCEPT";
  else if (supportScore >= 0.3) decision = "NEEDS_USER_CONFIRMATION";
  else decision = "REJECT";
  return {
    decision,
    supportScore: Number(supportScore.toFixed(3)),
    supportedBy,
    reason:
      decision === "ACCEPT"
        ? `supported by authoritative fields (${supportedBy.join(", ")})`
        : decision === "NEEDS_USER_CONFIRMATION"
          ? `only ${(supportScore * 100).toFixed(0)}% of candidate content is supported by authoritative product evidence — explicit user confirmation required`
          : `candidate is predominantly novel (${(supportScore * 100).toFixed(0)}% support) — derived strategy language cannot become Product Identity`,
  };
}
