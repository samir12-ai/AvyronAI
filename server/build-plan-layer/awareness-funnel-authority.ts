/**
 * Task #70 / Phase 7 / Step 4 — Awareness → Funnel authority hierarchy.
 *
 * Declarative authority precedence used by the build-plan-layer when
 * Awareness and Funnel both speak to overlap-region fields. The rule
 * (doctrine, not negotiable):
 *
 *   - Awareness sets STAGE (which awareness stage the audience is in,
 *     readiness, trust threshold).
 *   - Funnel sets PATH (which sequence of actions/stages the audience
 *     moves through and the trust-building structure).
 *   - On overlap (e.g., both engines emit a "stage" claim) Awareness
 *     wins for STAGE-shaped fields, Funnel wins for PATH-shaped fields.
 *   - Source of every resolved overlap value is tagged on the result so
 *     downstream consumers can attribute the precedence decision (D2).
 *
 * The overlap-region fields are DECLARED here once and reused by both
 * engine consumers; this is the contract surface the task spec asks for.
 *
 * Doctrine: D1 (no `??`/`||` semantic fallback on resolved values),
 * D2 (every resolved overlap field has a canonical name + source tag),
 * D3 (strict enums for the precedence outcome), D5 (missing canonical
 * input → INCOMPLETE, never silently substituted).
 */

export type OverlapAuthority = "awareness" | "funnel";

/** Strict enum for the resolution outcome (D3). */
export type OverlapResolutionState =
  | "awareness_wins"      // overlap was a STAGE field; Awareness authoritative
  | "funnel_wins"         // overlap was a PATH field; Funnel authoritative
  | "single_source"       // only one engine emitted; no contention
  | "incomplete";         // neither engine emitted a usable value

/** Declared overlap-region fields. The exhaustive list of fields BOTH
 *  contracts may legitimately speak to. */
export const OVERLAP_FIELDS = {
  stage: { authority: "awareness" as OverlapAuthority },
  awarenessStage: { authority: "awareness" as OverlapAuthority },
  readinessStage: { authority: "awareness" as OverlapAuthority },
  trustRequirement: { authority: "awareness" as OverlapAuthority },
  primaryRoute: { authority: "awareness" as OverlapAuthority },
  funnelCompatibility: { authority: "funnel" as OverlapAuthority },
  stages: { authority: "funnel" as OverlapAuthority },
  funnelStages: { authority: "funnel" as OverlapAuthority },
  trustPath: { authority: "funnel" as OverlapAuthority },
  stageMap: { authority: "funnel" as OverlapAuthority },
} as const;

export type OverlapFieldName = keyof typeof OVERLAP_FIELDS;

export interface OverlapInputs {
  awareness?: Record<string, unknown> | null;
  funnel?: Record<string, unknown> | null;
}

export interface OverlapResolution<T = unknown> {
  field: OverlapFieldName;
  value: T | null;
  resolvedBy: OverlapAuthority | "none";
  state: OverlapResolutionState;
  declaredAuthority: OverlapAuthority;
  reason: string;
}

function hasValue(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}

/**
 * Resolve a single overlap field. Returns a strict, attributable
 * `OverlapResolution` — never a bare value. Callers consume `.value`
 * AFTER inspecting `.state` (D5: do not silently coerce `incomplete`).
 */
export function resolveOverlapField<T = unknown>(
  field: OverlapFieldName,
  inputs: OverlapInputs,
): OverlapResolution<T> {
  const decl = OVERLAP_FIELDS[field];
  const awarenessVal = inputs.awareness?.[field];
  const funnelVal = inputs.funnel?.[field];
  const awarenessHas = hasValue(awarenessVal);
  const funnelHas = hasValue(funnelVal);

  if (!awarenessHas && !funnelHas) {
    return {
      field,
      value: null,
      resolvedBy: "none",
      state: "incomplete",
      declaredAuthority: decl.authority,
      reason: `neither awareness nor funnel emitted ${field}`,
    };
  }

  if (awarenessHas && !funnelHas) {
    return {
      field,
      value: awarenessVal as T,
      resolvedBy: "awareness",
      state: "single_source",
      declaredAuthority: decl.authority,
      reason: `only awareness emitted ${field}`,
    };
  }

  if (!awarenessHas && funnelHas) {
    return {
      field,
      value: funnelVal as T,
      resolvedBy: "funnel",
      state: "single_source",
      declaredAuthority: decl.authority,
      reason: `only funnel emitted ${field}`,
    };
  }

  // Both engines emitted a value: declared authority wins.
  if (decl.authority === "awareness") {
    return {
      field,
      value: awarenessVal as T,
      resolvedBy: "awareness",
      state: "awareness_wins",
      declaredAuthority: "awareness",
      reason: `${field} is STAGE-shaped; awareness has declared authority over funnel`,
    };
  }
  return {
    field,
    value: funnelVal as T,
    resolvedBy: "funnel",
    state: "funnel_wins",
    declaredAuthority: "funnel",
    reason: `${field} is PATH-shaped; funnel has declared authority over awareness`,
  };
}

/** Resolve every declared overlap field at once. Used by build-plan-layer
 *  to assemble a single authoritative view before prompt construction. */
export function resolveAllOverlapFields(inputs: OverlapInputs): Record<OverlapFieldName, OverlapResolution> {
  const out = {} as Record<OverlapFieldName, OverlapResolution>;
  for (const field of Object.keys(OVERLAP_FIELDS) as OverlapFieldName[]) {
    out[field] = resolveOverlapField(field, inputs);
  }
  return out;
}

/**
 * Build a deterministic, prompt-injectable summary of the authority
 * precedence + resolution outcomes. Single source of truth surfaced to
 * the LLM so it cannot re-decide which engine wins.
 */
export function summarizeAuthorityPrecedence(
  inputs: OverlapInputs,
): { text: string; resolutions: Record<OverlapFieldName, OverlapResolution> } {
  const resolutions = resolveAllOverlapFields(inputs);
  const lines: string[] = [
    "AUTHORITY PRECEDENCE (Awareness → Funnel):",
    "- Awareness sets STAGE (readiness, trust threshold, awareness stage).",
    "- Funnel sets PATH (sequence of stages, trust-building structure).",
    "- On overlap, declared authority wins. Source is attributed per field.",
  ];
  const contended: string[] = [];
  for (const field of Object.keys(resolutions) as OverlapFieldName[]) {
    const r = resolutions[field];
    if (r.state === "awareness_wins" || r.state === "funnel_wins") {
      contended.push(`  - ${field} → resolved by ${r.resolvedBy} (${r.state}): ${r.reason}`);
    }
  }
  if (contended.length > 0) {
    lines.push("RESOLVED OVERLAPS:");
    lines.push(...contended);
  }
  return { text: lines.join("\n"), resolutions };
}
