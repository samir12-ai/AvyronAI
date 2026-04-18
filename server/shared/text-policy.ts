/**
 * Text policy: separate internal audit/grounding tokens from user-facing text.
 *
 * Tokens that must never appear in display fields:
 *   [RC#]  - root-cause references emitted by AEL/Differentiation/Mechanism prompts
 *   [BB#]  - buying-barrier references
 *   [CC#]  - causal-chain references
 *   any [AA#] / [AB#] style two-or-three-letter prefix + digits markers
 *   objection_N / desire_N / pain_N - synthetic indexed keys from orchestrator
 *
 * These tokens MUST stay alive for grounding/audit/lineage. They are extracted
 * to a sibling `lineage.groundingRefs` field instead of being silently dropped.
 */

const TOKEN_PATTERN = /\[([A-Z]{2,3})(\d+)\]/g;
const SYNTHETIC_KEY_PATTERN = /\b(objection|desire|pain|claim|barrier)_(\d+)\b/g;
// Literal text produced by `String({})` or template-string coercion of an
// object. Not an internal token, but the most common contract leak symptom.
const OBJECT_OBJECT_PATTERN = /\[object Object\]/g;

export interface ExtractedRefs {
  groundingRefs: string[];   // e.g. ["RC1","BB2","CC3"]
  syntheticKeys: string[];   // e.g. ["objection_0","desire_2"]
}

/**
 * Extract grounding references and synthetic keys from a string without
 * mutating it. Used to populate `lineage.groundingRefs` on responses.
 */
export function extractGroundingRefs(text: string): ExtractedRefs {
  const groundingRefs: string[] = [];
  const syntheticKeys: string[] = [];
  if (typeof text !== "string" || text.length === 0) {
    return { groundingRefs, syntheticKeys };
  }
  let m: RegExpExecArray | null;
  TOKEN_PATTERN.lastIndex = 0;
  while ((m = TOKEN_PATTERN.exec(text)) !== null) {
    groundingRefs.push(`${m[1]}${m[2]}`);
  }
  SYNTHETIC_KEY_PATTERN.lastIndex = 0;
  while ((m = SYNTHETIC_KEY_PATTERN.exec(text)) !== null) {
    syntheticKeys.push(`${m[1]}_${m[2]}`);
  }
  return { groundingRefs, syntheticKeys };
}

/**
 * Strip internal tokens from a string to make it user-facing.
 * - removes [RC#]/[BB#]/[CC#]/[XX#] markers and any "RC1: " / "BB1: " prefixes
 * - removes "objection_N"/"desire_N" tokens entirely
 * - collapses whitespace and tidy punctuation left behind
 *
 * Returns null if the input is not a string. Returns "" if stripping leaves
 * nothing meaningful (caller decides what to do — DO NOT silently substitute).
 */
export function stripInternalTokens(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let out = input;
  // Remove "RC1:" / "BB2 - " style prefixes that LLMs sometimes emit
  out = out.replace(/\b([A-Z]{2,3})(\d+)\s*[:\-—]\s*/g, "");
  // Remove bracketed [RC1] / [BB2] markers
  out = out.replace(TOKEN_PATTERN, "");
  // Remove synthetic indexed keys
  out = out.replace(SYNTHETIC_KEY_PATTERN, "");
  // Remove the "[object Object]" literal that template-string coercion of
  // a non-string upstream payload leaves behind.
  out = out.replace(OBJECT_OBJECT_PATTERN, "");
  // Tidy stray whitespace and orphan punctuation
  out = out
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/^[\s,;:.\-—]+/, "")
    .replace(/[\s,;:\-—]+$/, "")
    .trim();
  return out;
}

/** True if the string looks like a synthetic indexed key (objection_0, etc). */
export function looksLikeSyntheticKey(s: unknown): boolean {
  if (typeof s !== "string") return false;
  return /^(objection|desire|pain|claim|barrier)_\d+$/i.test(s.trim());
}

/** True if the string is a usable user-facing label (non-empty, no internal markers, non-synthetic). */
export function isHumanReadable(s: unknown): boolean {
  if (typeof s !== "string") return false;
  const t = s.trim();
  if (t.length < 2) return false;
  if (looksLikeSyntheticKey(t)) return false;
  if (TOKEN_PATTERN.test(t)) return false;
  // Reset regex state because /g is stateful
  TOKEN_PATTERN.lastIndex = 0;
  return true;
}

/**
 * Extract a human label from a value. STRICT — never falls back to
 * `String(obj)` (which would emit "[object Object]"). Returns null on miss.
 *
 * Order of preference: string itself → .label → .text → .pain/.desire/.objection
 *  → .name → .canonical → .title → .value → null.
 */
export function coerceToLabel(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const stripped = stripInternalTokens(value);
    return stripped && isHumanReadable(stripped) ? stripped : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const candidates = [
    "label",
    "text",
    "pain",
    "desire",
    "objection",
    "claim",
    "barrier",
    "type",
    "name",
    "canonical",
    "title",
    "value",
    "description",
  ];
  for (const k of candidates) {
    const v = obj[k];
    if (typeof v === "string") {
      const stripped = stripInternalTokens(v);
      if (stripped && isHumanReadable(stripped)) return stripped;
    }
  }
  return null;
}

/**
 * Coerce a heterogeneous array to a clean string[] of human labels.
 * Drops items that cannot be coerced. Records a contract violation per drop
 * via the optional `onViolation` callback (used by the normalizer/engine).
 */
export function coerceLabelArray(
  arr: unknown,
  onViolation?: (reason: string, raw: unknown) => void,
): string[] {
  if (!Array.isArray(arr)) return [];
  const out: string[] = [];
  for (let i = 0; i < arr.length; i++) {
    const label = coerceToLabel(arr[i]);
    if (label) {
      out.push(label);
    } else if (onViolation) {
      onViolation(`array_item_${i}_uncoercible`, arr[i]);
    }
  }
  return out;
}
