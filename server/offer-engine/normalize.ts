/**
 * Offer normalization layer — the API boundary contract guard.
 *
 * Responsibilities:
 *  1. Strip internal grounding tokens ([RC#]/[BB#]/[CC#]) and synthetic keys
 *     (objection_N/desire_N) from every user-facing string field.
 *  2. Preserve the stripped tokens in `lineage.groundingRefs` so audit data
 *     survives the boundary instead of being silently dropped.
 *  3. Coerce non-string values via `coerceToLabel`; emit `null` if uncoercible
 *     (NEVER `[object Object]`) and record a contract violation.
 *  4. Filter arrays per-item, dropping uncoercible entries.
 *
 * This runs AFTER the engine has produced its OfferResult, AFTER persistence,
 * and BEFORE the JSON response is sent to the frontend. The frontend
 * `safeText()` is defense-in-depth only — the contract is enforced here.
 */

import {
  stripInternalTokens,
  extractGroundingRefs,
  coerceToLabel,
  coerceLabelArray,
} from "../shared/text-policy";

export interface NormalizedLineage {
  groundingRefs: string[];   // collected from all stripped fields
  syntheticKeys: string[];   // objection_N/desire_N tokens encountered
  contractViolations: { field: string; reason: string }[];
}

interface NormalizeContext {
  groundingRefs: Set<string>;
  syntheticKeys: Set<string>;
  violations: { field: string; reason: string }[];
}

function newCtx(): NormalizeContext {
  return { groundingRefs: new Set(), syntheticKeys: new Set(), violations: [] };
}

function normString(value: unknown, ctx: NormalizeContext, field: string): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const refs = extractGroundingRefs(value);
    refs.groundingRefs.forEach((r) => ctx.groundingRefs.add(r));
    refs.syntheticKeys.forEach((k) => ctx.syntheticKeys.add(k));
    const stripped = stripInternalTokens(value);
    if (stripped && stripped.length > 0) return stripped;
    if (value.trim().length > 0) {
      ctx.violations.push({ field, reason: "string_emptied_after_strip" });
    }
    return null;
  }
  // Non-string: coerce or fail loud (no String(obj) leak).
  const coerced = coerceToLabel(value);
  if (coerced) {
    const refs = extractGroundingRefs(coerced);
    refs.groundingRefs.forEach((r) => ctx.groundingRefs.add(r));
    refs.syntheticKeys.forEach((k) => ctx.syntheticKeys.add(k));
    return stripInternalTokens(coerced) || null;
  }
  ctx.violations.push({ field, reason: "uncoercible_non_string" });
  return null;
}

function normStringArray(value: unknown, ctx: NormalizeContext, field: string): string[] {
  if (!Array.isArray(value)) {
    if (value != null) ctx.violations.push({ field, reason: "expected_array" });
    return [];
  }
  const out: string[] = [];
  for (let i = 0; i < value.length; i++) {
    const v = normString(value[i], ctx, `${field}[${i}]`);
    if (v) out.push(v);
  }
  return out;
}

/**
 * Deep-walk an arbitrary value, normalizing every string in place. Visits
 * nested arrays and plain objects but never crosses into the lineage block
 * (the audit channel intentionally retains internal tokens). Used to scrub
 * the nested layer subtrees (`outcomeLayer`, `mechanismLayer`,
 * `deliveryLayer`, `riskReductionLayer`, …) which the explicit field map
 * would otherwise miss.
 *
 * `MAX_DEPTH` is a safety guard against pathological cyclic structures —
 * the offer payloads have a known max depth of ~6 in practice.
 */
const MAX_DEPTH = 12;

/** True only for plain objects. Class instances (Date, Map, Set, RegExp, etc.)
 *  are returned as-is by the walker so they aren't corrupted into `{}`. Offer
 *  payloads are JSON-derived in practice but this guard makes the helper safe
 *  to call anywhere. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v == null || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function deepNormalize(value: any, ctx: NormalizeContext, path: string, depth: number, seen: WeakSet<object>): any {
  if (depth > MAX_DEPTH) return value;
  if (value == null) return value;
  if (typeof value === "string") {
    const refs = extractGroundingRefs(value);
    refs.groundingRefs.forEach((r) => ctx.groundingRefs.add(r));
    refs.syntheticKeys.forEach((k) => ctx.syntheticKeys.add(k));
    const stripped = stripInternalTokens(value);
    if (stripped === null) return null;
    if (stripped.length === 0 && value.trim().length > 0) {
      ctx.violations.push({ field: path, reason: "string_emptied_after_strip" });
      return "";
    }
    return stripped;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return value;
    seen.add(value);
    return value.map((v, i) => deepNormalize(v, ctx, `${path}[${i}]`, depth + 1, seen));
  }
  if (isPlainObject(value)) {
    // Stop at lineage / contractViolations subtrees (audit channels).
    const leaf = path.split(".").pop() || path;
    if (leaf === "lineage" || leaf === "contractViolations") return value;
    if (seen.has(value)) return value;
    seen.add(value);
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = deepNormalize(v, ctx, path ? `${path}.${k}` : k, depth + 1, seen);
    }
    return out;
  }
  // Non-plain object (Date/Map/Set/class instance), number, boolean, function — pass through unchanged.
  return value;
}

function normalizeCandidate(candidate: any, ctx: NormalizeContext, prefix: string): any {
  if (!candidate || typeof candidate !== "object") return candidate;
  // Deep-walk first so nested layer subtrees (outcomeLayer, mechanismLayer,
  // deliveryLayer, riskReductionLayer, …) get scrubbed too. Then re-apply
  // the explicit field contract to drop uncoercible non-strings (which the
  // deep walker preserves as-is at non-string positions).
  const deep = deepNormalize(candidate, ctx, prefix, 0, new WeakSet<object>());
  return {
    ...deep,
    offerName: normString(deep.offerName, ctx, `${prefix}.offerName`) || deep.offerName || null,
    coreOutcome: normString(deep.coreOutcome, ctx, `${prefix}.coreOutcome`) || "",
    mechanismDescription: normString(deep.mechanismDescription, ctx, `${prefix}.mechanismDescription`) || "",
    deliverables: normStringArray(deep.deliverables, ctx, `${prefix}.deliverables`),
    proofAlignment: normStringArray(deep.proofAlignment, ctx, `${prefix}.proofAlignment`),
    audienceFitExplanation: normString(deep.audienceFitExplanation, ctx, `${prefix}.audienceFitExplanation`) || "",
    riskNotes: normStringArray(deep.riskNotes, ctx, `${prefix}.riskNotes`),
    problemStatement: deep.problemStatement != null
      ? (normString(deep.problemStatement, ctx, `${prefix}.problemStatement`) || "")
      : undefined,
    proofPath: Array.isArray(deep.proofPath)
      ? normStringArray(deep.proofPath, ctx, `${prefix}.proofPath`)
      : undefined,
    objectionHandling: Array.isArray(deep.objectionHandling)
      ? normStringArray(deep.objectionHandling, ctx, `${prefix}.objectionHandling`)
      : undefined,
  };
}

/**
 * Normalize an offer engine result for transport to the frontend.
 * Mutates nothing; returns a new object with cleaned strings + lineage block.
 */
export function normalizeOfferResult<T extends Record<string, any>>(result: T): T & { lineage: NormalizedLineage } {
  const ctx = newCtx();

  const cleaned: any = { ...result };
  if (result.primaryOffer) cleaned.primaryOffer = normalizeCandidate(result.primaryOffer, ctx, "primaryOffer");
  if (result.alternativeOffer) cleaned.alternativeOffer = normalizeCandidate(result.alternativeOffer, ctx, "alternativeOffer");
  if (result.rejectedOffer && result.rejectedOffer.offer) {
    cleaned.rejectedOffer = {
      ...result.rejectedOffer,
      offer: normalizeCandidate(result.rejectedOffer.offer, ctx, "rejectedOffer.offer"),
      rejectionReason: normString(result.rejectedOffer.rejectionReason, ctx, "rejectedOffer.rejectionReason") || "",
    };
  }
  if (typeof result.statusMessage === "string") {
    cleaned.statusMessage = normString(result.statusMessage, ctx, "statusMessage") || result.statusMessage;
  }

  // Merge any engine-level contract violations forwarded via layerDiagnostics.
  const engineViolations = (result.layerDiagnostics && Array.isArray(result.layerDiagnostics.contractViolations))
    ? result.layerDiagnostics.contractViolations.map((v: any) => ({ field: String(v.field || "unknown"), reason: String(v.reason || "unknown") }))
    : [];

  const lineage: NormalizedLineage = {
    groundingRefs: Array.from(ctx.groundingRefs).sort(),
    syntheticKeys: Array.from(ctx.syntheticKeys).sort(),
    contractViolations: [...engineViolations, ...ctx.violations],
  };

  return { ...cleaned, lineage };
}
