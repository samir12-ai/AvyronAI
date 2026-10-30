import type { ValidatedCapability } from "./capability-registry";

/**
 * ============================================================================
 * AUTHORITY VALIDATOR — deterministic enforcement of the namespace boundaries
 * ============================================================================
 *
 * Enforces (in CODE, not prompt text) the global authority model:
 *   PROBLEM_NAMESPACE    — central customer problems must resolve to the
 *                          engine's selected authoritative pains.
 *   CAPABILITY_NAMESPACE — product capability claims must resolve to
 *                          validated capabilityIds.
 *   SYNTHESIS_NAMESPACE  — engines may connect the two but may not change,
 *                          invent, or merge either authority.
 *
 * Checks are generic — NO hardcoded product names, pain topics, or keywords.
 * Violations produce precise retry feedback; callers reject + rerun inside
 * the existing bounded retry policy (never silent rewrite).
 */

export interface SelectedPainLike {
  painId: string;
  canonical: string;
}

export type AuthorityViolationKind =
  | "UNAUTHORIZED_PROBLEM" // central problem doesn't resolve to any selected pain
  | "UNSUPPORTED_CAPABILITY" // capabilityRefs cite ids outside the validated set
  | "PAIN_CAPABILITY_MERGE"; // problem text is capability language, not the selected pain

export interface AuthorityViolation {
  kind: AuthorityViolationKind;
  detail: string;
  /** Precise retry feedback for the regeneration prompt. */
  retryFeedback: string;
}

export interface OperationalClaimInput {
  claim?: string;
  role?:
    | "EXISTING_FACTUAL_CLAIM"
    | "SUPPORTED_FACTUAL_STATEMENT"
    | "REASONABLE_DESCRIPTIVE_SYNTHESIS"
    | "BOUNDED_INTERPRETATION"
    | "STRATEGIC_SYNTHESIS"
    | "STRATEGIC_COMBINATION"
    | "PROPOSED_EXECUTION"
    | "UNSUPPORTED_MATERIAL_ASSERTION"
    | "UNSUPPORTED_EXISTING_PROCESS"
    | string;
  capabilityRef?: string | null;
  supportedByCapability?: string | null;
}

export interface CanonicalFactualClaim {
  role: "EXISTING_FACTUAL_CLAIM";
  capabilityRef: string;
  canonicalStatement: string;
  factType?: string;
  sourceFactId?: string;
  /** Non-authoritative debug telemetry only — never treated as Product Truth */
  _debugClaimText?: string;
}

export interface AuthorityCheckResult {
  passed: boolean;
  violations: AuthorityViolation[];
  canonicalFactualClaims?: CanonicalFactualClaim[];
  proposedExecutions?: string[];
  strategicSyntheses?: string[];
}

const STOPWORDS = new Set(
  "a an and are as at be by for from has have in into is it its of on or that the their this to was were will with our your you we they them us not no most more they're don't can't lack lacks".split(
    " ",
  ),
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

function overlapRatio(text: string, reference: string): number {
  const t = contentTokens(text);
  if (t.size === 0) return 0;
  const ref = contentTokens(reference);
  const refArr = [...ref];
  let hit = 0;
  for (const tok of t) {
    if (
      ref.has(tok) ||
      (tok.length >= 6 && refArr.some((rTok) => rTok.length >= 6 && tok.slice(0, 6) === rTok.slice(0, 6)))
    ) {
      hit++;
    }
  }
  return hit / t.size;
}

function resolveSingleCapabilityReference(
  rawRef: string,
  capMap: Map<string, ValidatedCapability>,
  capabilities: ValidatedCapability[],
): ValidatedCapability | undefined {
  const ref = rawRef.trim();
  if (!ref || /^(null|none|n\/a|unsupported|false)$/i.test(ref)) return undefined;

  // 1. Exact capabilityId match
  if (capMap.has(ref)) return capMap.get(ref);

  // 2. Embedded cap_xxx token in the reference string
  const capIdMatch = ref.match(/\b(cap_[a-z0-9_]+)\b/i);
  if (capIdMatch && capMap.has(capIdMatch[1])) return capMap.get(capIdMatch[1]);

  // 3. Exact sourceFactId match (including when LLM prefixes sourceFactId with "cap_")
  const strippedCapPrefix = ref.replace(/^cap_/i, "");
  const byFactId = capabilities.find(
    (c) => c.sourceFactId && (c.sourceFactId === ref || c.sourceFactId === strippedCapPrefix),
  );
  if (byFactId) return byFactId;

  // 4. 1-based index match (e.g. "1", "[1]", "Capability 1")
  const idxMatch = ref.match(/^(?:\[?\s*(?:capability|fact)?\s*(\d+)\s*\]?)$/i);
  if (idxMatch) {
    const idx = parseInt(idxMatch[1], 10) - 1;
    if (idx >= 0 && idx < capabilities.length) return capabilities[idx];
  }

  // 5. Statement match when semantic judge returns the capability statement text
  //    (Never match synthetic cap_* IDs that failed lookup in step 1/2)
  if (!/^cap_[a-z0-9_]+$/i.test(ref)) {
    const normRef = ref.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    if (normRef.length >= 6) {
      for (const c of capabilities) {
        const normStmt = String(c.statement || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
        if (!normStmt) continue;
        if (normStmt === normRef || normStmt.includes(normRef) || normRef.includes(normStmt)) {
          return c;
        }
      }
      let bestCap: ValidatedCapability | undefined;
      let bestScore = 0;
      for (const c of capabilities) {
        const score = Math.max(overlapRatio(ref, c.statement), overlapRatio(c.statement, ref));
        if (score > bestScore) {
          bestScore = score;
          bestCap = c;
        }
      }
      if (bestCap && bestScore >= 0.5) return bestCap;
    }
  }

  return undefined;
}

function resolveCapabilityReference(
  rawRef: string,
  capMap: Map<string, ValidatedCapability>,
  capabilities: ValidatedCapability[],
): ValidatedCapability | undefined {
  const single = resolveSingleCapabilityReference(rawRef, capMap, capabilities);
  if (single) return single;

  // Support compound references (e.g. "cap_a, cap_b" or "fact_1 + fact_2") only when EVERY part resolves
  if (/[,+;]/.test(rawRef)) {
    const parts = rawRef
      .split(/[,+;]/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length > 1) {
      const resolvedParts = parts.map((p) => resolveSingleCapabilityReference(p, capMap, capabilities));
      if (resolvedParts.every((r) => r !== undefined)) {
        return resolvedParts[0];
      }
    }
  }

  return undefined;
}

/** Distinctive capability tokens = capability tokens absent from every selected pain. */
function distinctiveCapabilityTokens(
  capabilities: ValidatedCapability[],
  pains: SelectedPainLike[],
): Set<string> {
  const painTokens = new Set<string>();
  for (const p of pains) for (const t of contentTokens(p.canonical)) painTokens.add(t);
  const out = new Set<string>();
  for (const c of capabilities) {
    for (const t of contentTokens(c.statement)) {
      if (!painTokens.has(t)) out.add(t);
    }
  }
  return out;
}

/**
 * Validate one engine output against the authority boundaries.
 *
 * @param centralProblemTexts The output fields that CLAIM a central customer
 *   problem (e.g. problemStatement, coreProblem, territory problem framing).
 *   The CALLER decides which fields are "central" — this validator never
 *   guesses. Empty array → problem checks are skipped (truthful N/A).
 * @param capabilityRefs The structured capabilityRefs the LLM emitted
 *   (undefined → capability-ref check skipped; prompt+judge still apply).
 * @param operationalClaims Role-classified claims from the candidate / judge.
 *   EXISTING_FACTUAL_CLAIM assertions must provide a valid capabilityRef
 *   resolving to the canonical Capability Registry.
 */
export function validateAuthorityBoundaries(params: {
  engineId: string;
  centralProblemTexts: string[];
  capabilityRefs?: unknown;
  operationalClaims?: OperationalClaimInput[];
  unsupportedPredicates?: string[];
  selectedPains: SelectedPainLike[];
  capabilities: ValidatedCapability[];
}): AuthorityCheckResult {
  const { engineId, centralProblemTexts, selectedPains, capabilities, operationalClaims, unsupportedPredicates } = params;
  const violations: AuthorityViolation[] = [];
  const canonicalFactualClaims: CanonicalFactualClaim[] = [];
  const proposedExecutions: string[] = [];
  const strategicSyntheses: string[] = [];

  const capMap = new Map(capabilities.map((c) => [c.capabilityId, c]));

  // ---- UNSUPPORTED FACTUAL PREDICATE CHECK (Anti-Factual-Bypass) ----
  if (Array.isArray(unsupportedPredicates) && unsupportedPredicates.length > 0) {
    for (const pred of unsupportedPredicates) {
      if (typeof pred === "string" && pred.trim()) {
        violations.push({
          kind: "UNSUPPORTED_CAPABILITY",
          detail: `engine=${engineId} asserted unsupported factual predicate: "${pred.trim()}"`,
          retryFeedback: `Factual claim/predicate "${pred.trim()}" is not established by Product Truth. Every factual attribute, material specification, physical performance claim, or operational process claim must be explicitly supported by verified Product Truth capabilities.`,
        });
      }
    }
  }

  // ---- CAPABILITY CHECK: emitted top-level refs must be a subset of validated ids ----
  if (Array.isArray(params.capabilityRefs) && params.capabilityRefs.length > 0) {
    const cited = params.capabilityRefs.filter((r): r is string => typeof r === "string" && r.trim().length > 0);
    const invalid = cited.filter((r) => !resolveCapabilityReference(r, capMap, capabilities));
    if (invalid.length > 0) {
      violations.push({
        kind: "UNSUPPORTED_CAPABILITY",
        detail: `engine=${engineId} cited capabilityRefs outside the validated registry: ${invalid.join(", ")}`,
        retryFeedback: `Your output cited capability IDs that are NOT in the validated capability registry: ${invalid.join(", ")}. Cite ONLY these validated IDs: ${[...capMap.keys()].join(", ")}. Do not invent capabilities.`,
      });
    }
  }

  // ---- STRUCTURAL CLAIM-TO-CAPABILITY BINDING ----
  if (Array.isArray(operationalClaims) && operationalClaims.length > 0) {
    for (const item of operationalClaims) {
      const role = String(item.role || "").trim().toUpperCase();
      const rawText = String(item.claim || "").trim();

      if (
        role === "EXISTING_FACTUAL_CLAIM" ||
        role === "VERIFIED_EXISTING_CAPABILITY" ||
        role === "SUPPORTED_FACTUAL_STATEMENT"
      ) {
        const rawCandidateRef =
          typeof item.capabilityRef === "string" && item.capabilityRef.trim()
            ? item.capabilityRef.trim()
            : typeof item.supportedByCapability === "string" && item.supportedByCapability.trim()
              ? item.supportedByCapability.trim()
              : "";
        const ref = /^(null|none|n\/a|unsupported|false)$/i.test(rawCandidateRef) ? "" : rawCandidateRef;
        if (!ref) {
          violations.push({
            kind: "UNSUPPORTED_CAPABILITY",
            detail: `engine=${engineId} asserted ${role} without capabilityRef: "${rawText}"`,
            retryFeedback: `Factual claim "${rawText}" asserts an existing product/business fact without a valid capabilityRef/fact ID. Existing factual claims MUST cite a validated capability ID from the canonical Product Truth inventory. If this is a future recommendation, classify it as PROPOSED_EXECUTION. If it is a reasonable descriptive synthesis or bounded interpretation of verified facts, classify it as REASONABLE_DESCRIPTIVE_SYNTHESIS or BOUNDED_INTERPRETATION.`,
          });
          continue;
        }

        const resolved = resolveCapabilityReference(ref, capMap, capabilities);
        if (!resolved) {
          violations.push({
            kind: "UNSUPPORTED_CAPABILITY",
            detail: `engine=${engineId} cited capabilityRef "${ref}" outside the validated registry for claim: "${rawText}"`,
            retryFeedback: `CapabilityRef "${ref}" cited for factual claim is NOT in the validated Product Truth inventory: ${[...capMap.keys()].join(", ")}. Do not invent capabilities.`,
          });
          continue;
        }

        // Canonical resolution: the authoritative factual statement is the REGISTRY statement,
        // NEVER the LLM prose. Original factType is preserved.
        canonicalFactualClaims.push({
          role: "EXISTING_FACTUAL_CLAIM",
          capabilityRef: resolved.capabilityId,
          canonicalStatement: resolved.statement,
          factType: resolved.factType,
          sourceFactId: resolved.sourceFactId,
          _debugClaimText: rawText,
        });
      } else if (role === "PROPOSED_EXECUTION") {
        if (rawText) proposedExecutions.push(rawText);
      } else if (
        role === "STRATEGIC_SYNTHESIS" ||
        role === "STRATEGIC_COMBINATION" ||
        role === "REASONABLE_DESCRIPTIVE_SYNTHESIS" ||
        role === "BOUNDED_INTERPRETATION"
      ) {
        if (rawText) strategicSyntheses.push(rawText);
        const rawCandidateRef =
          typeof item.capabilityRef === "string" && item.capabilityRef.trim()
            ? item.capabilityRef.trim()
            : typeof item.supportedByCapability === "string" && item.supportedByCapability.trim()
              ? item.supportedByCapability.trim()
              : "";
        const ref = /^(null|none|n\/a|unsupported|false)$/i.test(rawCandidateRef) ? "" : rawCandidateRef;
        if (ref) {
          const resolved = resolveCapabilityReference(ref, capMap, capabilities);
          if (resolved) {
            canonicalFactualClaims.push({
              role: "EXISTING_FACTUAL_CLAIM",
              capabilityRef: resolved.capabilityId,
              canonicalStatement: resolved.statement,
              factType: resolved.factType,
              sourceFactId: resolved.sourceFactId,
              _debugClaimText: rawText,
            });
          }
        }
      } else if (role === "UNSUPPORTED_MATERIAL_ASSERTION" || role === "UNSUPPORTED_EXISTING_PROCESS") {
        violations.push({
          kind: "UNSUPPORTED_CAPABILITY",
          detail: `engine=${engineId} asserted ${role}: "${rawText}"`,
          retryFeedback: `Unsupported material assertion "${rawText}" is not established by verified Product Truth and must be removed or replaced with verified facts.`,
        });
      }
    }
  }

  // ---- PROBLEM + MERGE CHECKS on each central problem claim ----
  if (centralProblemTexts.length > 0 && selectedPains.length > 0) {
    const capDistinct = distinctiveCapabilityTokens(capabilities, selectedPains);
    for (const text of centralProblemTexts) {
      const trimmed = String(text || "").trim();
      if (trimmed.length === 0) continue;
      const bestPainOverlap = Math.max(
        ...selectedPains.map((p) => Math.max(overlapRatio(trimmed, p.canonical), overlapRatio(p.canonical, trimmed))),
      );
      const toks = contentTokens(trimmed);
      let capHits = 0;
      for (const t of toks) if (capDistinct.has(t)) capHits++;
      const capShare = toks.size > 0 ? capHits / toks.size : 0;

      // MERGE: the "problem" is predominantly capability language with no
      // resolution to any selected pain → capability was transformed into
      // the customer's problem (the poisoning signature).
      if (bestPainOverlap < 0.15 && capShare >= 0.35) {
        violations.push({
          kind: "PAIN_CAPABILITY_MERGE",
          detail: `engine=${engineId} central problem is capability language (capShare=${capShare.toFixed(2)}, painOverlap=${bestPainOverlap.toFixed(2)}): "${trimmed.slice(0, 120)}"`,
          retryFeedback: `Your central problem statement is built from PRODUCT CAPABILITY language, not the authorized customer pain. The customer's problem MUST be one of the selected authoritative pains: ${selectedPains.map((p) => `${p.painId} ("${p.canonical}")`).join("; ")}. Product capabilities describe the SOLUTION, never the problem. Rewrite the problem statement to state the selected pain, then connect a validated capability to it.`,
        });
        continue;
      }
      // UNAUTHORIZED_PROBLEM: central problem resolves to no selected pain.
      if (bestPainOverlap < 0.15) {
        violations.push({
          kind: "UNAUTHORIZED_PROBLEM",
          detail: `engine=${engineId} central problem resolves to no selected pain (best overlap ${bestPainOverlap.toFixed(2)}): "${trimmed.slice(0, 120)}"`,
          retryFeedback: `Your central problem claim does not resolve to any authorized selected pain. Use one of: ${selectedPains.map((p) => `${p.painId} ("${p.canonical}")`).join("; ")}. Do not reselect the problem from business context or invent a new one.`,
        });
      }
    }
  }

  if (violations.length > 0) {
    for (const v of violations) {
      console.error(`[AuthorityValidator] AUTHORITY_VIOLATION | ${v.kind} | ${v.detail}`);
    }
  }
  return {
    passed: violations.length === 0,
    violations,
    canonicalFactualClaims,
    proposedExecutions,
    strategicSyntheses,
  };
}
