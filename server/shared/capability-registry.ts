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
  /** The capability or Product Truth fact statement, verbatim from the authoritative source field. */
  statement: string;
  /** Original Product Truth fact type (e.g. CAPABILITY, QUALITY, OPERATIONAL, PROOF, OFFER). */
  factType?: string;
  /** Which authoritative namespace field supplied this entry. */
  source:
    | "product_truth.capability"
    | "product_truth.quality"
    | "product_truth.operational"
    | "product_truth.proof"
    | "product_truth.offer"
    | "product_truth.delivery_mechanism"
    | "product_truth.pricing_fact"
    | "product_truth.differentiator"
    | "product_truth.use_case"
    | "product_truth.boundary"
    | "product_truth.fact"
    | "anchor.differentiatingFeature"
    | "anchor.keyAttributes"
    | "anchor.coreProblemSolved"
    | "dna.uniqueMechanism"
    | "dna.strategicAdvantage"
    | "dna.coreOffer";
  /** Human-readable source reference (field path). */
  sourceRef: string;
  /** Source Product Truth fact ID when projected from canonical Product Truth */
  sourceFactId?: string;
  /** Verification status from canonical Product Truth (e.g. VERIFIED, USER_CONFIRMED) */
  verificationStatus?: string;
  /** Optional scope of the fact */
  scope?: string;
  /** Optional qualifications / rationale / limitations */
  qualifications?: string;
  /** Evidence reference IDs backing this fact */
  evidenceRefIds?: string[];
  /** Campaign offering ID this fact is scoped to */
  campaignOfferingId?: string;
  /** Canonical Product Truth snapshot ID / version */
  snapshotId?: string;
  /** Canonical Product Truth snapshot fingerprint */
  snapshotFingerprint?: string;
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

function mapFactTypeToSource(factType: string): ValidatedCapability["source"] {
  const norm = String(factType || "CAPABILITY").trim().toUpperCase();
  switch (norm) {
    case "CAPABILITY":
      return "product_truth.capability";
    case "QUALITY":
      return "product_truth.quality";
    case "OPERATIONAL":
      return "product_truth.operational";
    case "PROOF":
      return "product_truth.proof";
    case "OFFER":
      return "product_truth.offer";
    case "DELIVERY_MECHANISM":
      return "product_truth.delivery_mechanism";
    case "PRICING_FACT":
      return "product_truth.pricing_fact";
    case "DIFFERENTIATOR":
      return "product_truth.differentiator";
    case "USE_CASE":
      return "product_truth.use_case";
    case "BOUNDARY":
      return "product_truth.boundary";
    default:
      return "product_truth.fact";
  }
}

/**
 * Deterministically derive the validated capability & Product Truth registry for one campaign
 * from its Product Anchor, canonical Product Truth facts, and (optionally) Product DNA.
 * Pure function — same inputs always produce the same registry (and the same capabilityIds).
 * Preserves each Product Truth fact's original factType, ID, status, scope, and qualifications
 * without restricting visibility to CAPABILITY-only facts.
 */
export function deriveValidatedCapabilities(
  anchor: ProductAnchor | null | undefined,
  dna?: ProductDnaLike | null,
): ValidatedCapability[] {
  const out: ValidatedCapability[] = [];
  const seen = new Set<string>();
  const dnaAny = (dna || {}) as any;
  const resolvedSnapshotId =
    dnaAny.snapshotId ||
    dnaAny.businessUnderstandingAuthorityId ||
    dnaAny.canonicalProductTruthSnapshot?.snapshotId ||
    undefined;
  const resolvedFingerprint =
    dnaAny.snapshotFingerprint ||
    dnaAny.canonicalProductTruthSnapshot?.fingerprint ||
    undefined;
  const resolvedOfferingId =
    dnaAny.campaignOfferingId ||
    dnaAny.canonicalProductTruthSnapshot?.campaignOfferingId ||
    undefined;

  const push = (
    source: ValidatedCapability["source"],
    sourceRef: string,
    statement: unknown,
    meta?: {
      factType?: string;
      sourceFactId?: string;
      verificationStatus?: string;
      scope?: string;
      qualifications?: string;
      evidenceRefIds?: string[];
      campaignOfferingId?: string;
    },
  ) => {
    const s = typeof statement === "string" ? statement.trim() : "";
    if (s.length === 0) return;
    const key = s.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      capabilityId: computeCapabilityId(source, s),
      statement: s,
      factType: meta?.factType,
      source,
      sourceRef,
      sourceFactId: meta?.sourceFactId,
      verificationStatus: meta?.verificationStatus,
      scope: meta?.scope,
      qualifications: meta?.qualifications,
      evidenceRefIds: meta?.evidenceRefIds,
      campaignOfferingId: meta?.campaignOfferingId || resolvedOfferingId,
      snapshotId: resolvedSnapshotId,
      snapshotFingerprint: resolvedFingerprint,
      validationStatus: "VALIDATED",
      allowedClaimScope: "product_capability_claims",
    });
  };

  // 1. Canonical Product Truth facts (all verified fact types: CAPABILITY, QUALITY, OPERATIONAL, PROOF, OFFER, etc.)
  const ptFacts = Array.isArray(dna?.productTruthFacts) ? dna!.productTruthFacts : [];
  const verifiedFacts = ptFacts.filter((f: any) => {
    if (!f) return false;
    const st = String(f.status || "VERIFIED").trim().toUpperCase();
    return st !== "REJECTED" && st !== "EXCLUDED" && st !== "UNVERIFIED" && st !== "INVALID";
  });

  if (verifiedFacts.length > 0) {
    for (const fact of verifiedFacts) {
      const stmt = fact.statement || fact.fact;
      if (stmt && typeof stmt === "string") {
        const factId = fact.productTruthFactId || fact.factId || fact.id;
        const origFactType = String(fact.factType || "CAPABILITY").trim().toUpperCase();
        const source = mapFactTypeToSource(origFactType);
        push(
          source,
          fact.sourceRef || (factId ? `product_truth.facts[${factId}]` : "product_truth.facts"),
          stmt,
          {
            factType: origFactType,
            sourceFactId: factId,
            verificationStatus: fact.status ? String(fact.status).trim() : "VERIFIED",
            scope: fact.scope ? String(fact.scope).trim() : undefined,
            qualifications: Array.isArray(fact.qualifications)
              ? fact.qualifications.map((q: any) => String(q || "").trim()).filter(Boolean).join("; ")
              : fact.qualifications
                ? String(fact.qualifications).trim()
                : fact.rationale
                  ? String(fact.rationale).trim()
                  : undefined,
            evidenceRefIds: Array.isArray(fact.evidenceRefIds) ? [...fact.evidenceRefIds] : undefined,
            campaignOfferingId: fact.campaignOfferingId || resolvedOfferingId,
          },
        );
      }
    }
  }

  // 2. Product Anchor fields (if anchor provided, project anchor fields that aren't already represented)
  if (anchor) {
    push("anchor.differentiatingFeature", "product_anchor.differentiatingFeature", anchor.differentiatingFeature);
    (anchor.keyAttributes ?? []).forEach((a, i) =>
      push("anchor.keyAttributes", `product_anchor.keyAttributes[${i}]`, a),
    );
    push("anchor.coreProblemSolved", "product_anchor.coreProblemSolved", anchor.coreProblemSolved);
  }

  // 3. Fallback to DNA summary fields ONLY if no canonical product truth facts exist
  if (dna && verifiedFacts.length === 0) {
    push("dna.uniqueMechanism", "business_data_layer.unique_mechanism", dna.uniqueMechanism ?? "");
    push("dna.strategicAdvantage", "business_data_layer.strategic_advantage", dna.strategicAdvantage ?? "");
  }

  return out;
}

/** Stable 16-char hash of the whole registry (for run lineage capture). */
export function computeCapabilityRegistryHash(caps: ValidatedCapability[]): string {
  const canonical = JSON.stringify(
    caps
      .map((c) => `${c.capabilityId}:${c.factType || "CAPABILITY"}:${c.sourceFactId || ""}`)
      .sort(),
  );
  return crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

/** Optional structured output field engines may emit alongside groundingRefs. */
export const capabilityRefsSchema = z.array(z.string()).optional();

/**
 * Render the CAPABILITY_NAMESPACE prompt block: the validated capabilities and Product Truth facts
 * with their stable IDs and original fact types. Returns "" when the registry is empty.
 */
export function buildCapabilityBlock(caps: ValidatedCapability[]): string {
  if (caps.length === 0) return "";
  const lines: string[] = [];
  const snapId = caps.find((c) => c.snapshotId)?.snapshotId;
  const snapFp = caps.find((c) => c.snapshotFingerprint)?.snapshotFingerprint;
  lines.push(
    `\n═══ VALIDATED PRODUCT TRUTH & CAPABILITIES${snapId || snapFp ? ` (snapshot=${snapId || "n/a"}, fingerprint=${snapFp || "n/a"})` : ""} ═══`,
  );
  for (const c of caps) {
    const typeTag = c.factType ? ` [${c.factType}]` : "";
    const factIdTag = c.sourceFactId ? ` (factId: ${c.sourceFactId})` : "";
    const scopeTag = c.scope ? ` [scope: ${c.scope}]` : "";
    const qualTag = c.qualifications ? ` [note: ${c.qualifications}]` : "";
    lines.push(`[${c.capabilityId}]${typeTag}${factIdTag} ${c.statement}${scopeTag}${qualTag}  (source: ${c.sourceRef})`);
  }
  lines.push(
    "Factual product claims in your output MUST be supported by these verified Product Truth facts. List the IDs you used in a structured \"capabilityRefs\": string[] field of your JSON output when the schema allows it.",
  );
  lines.push("═══ END VALIDATED PRODUCT TRUTH & CAPABILITIES ═══\n");
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
