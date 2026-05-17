/**
 * Validation Verdict — Task #70 / Phase 7 — Domain Composition Cleanup.
 *
 * Pre-Task-#70 there were TWO independent "is this strategy validated?"
 * surfaces: the Integrity Engine's `integrityVerdict` ∈ {PASS|PARTIAL|FAIL}
 * and the Statistical Validation Engine's `validationState` ∈
 * {validated|provisional|weak|rejected}. Downstream consumers
 * (`budget_governor`, `channel_selection`, plan-synthesis gates) had to
 * read both fields and apply ad-hoc precedence rules — a classic D2
 * violation (two meanings, two fields, no canonical merged projection).
 *
 * `composeValidationVerdict()` is the single projection that merges them
 * into one strict-enum verdict. Both engines now live in the VALIDATION
 * tier (see priority-matrix.ts), so the merged verdict is the canonical
 * tier output.
 *
 * Doctrine alignment:
 *   - D2 — every meaning has its own canonical field. `ValidationVerdict.state`
 *     is the strict-enum merged state, separate from `integrityVerdict`
 *     (which remains as the Integrity Engine's own emission for D4 legacy
 *     readers) and from `validationState` (Stat-V engine's own emission).
 *   - D3 — strict enum: `validated | provisional | weak | rejected | unknown`.
 *     "unknown" is reserved for the D5 missing-input branch (neither
 *     verdict source produced a usable value).
 *   - D5 — when neither verdict is readable, the merged verdict is
 *     `{ state: "unknown", verdictSource: "incomplete" }` — never a
 *     silent default.
 */

export type ValidationVerdictState =
  | "validated"
  | "provisional"
  | "weak"
  | "rejected"
  | "unknown";

export type ValidationVerdictSource =
  | "merged"
  | "integrity_only"
  | "statistical_only"
  | "incomplete";

export interface ValidationVerdict {
  /** Canonical merged validation state (D3 strict enum). */
  state: ValidationVerdictState;
  /** Which inputs contributed to the merged verdict (D5 visibility). */
  verdictSource: ValidationVerdictSource;
  /** Underlying Integrity Engine verdict (read-through for auditors). */
  integrityVerdict: "PASS" | "PARTIAL" | "FAIL" | null;
  /** Underlying Statistical Validation state (read-through). */
  statisticalValidationState: "validated" | "provisional" | "weak" | "rejected" | null;
  /** Free-text rationale ≤200 chars; populated for non-validated states. */
  rationale: string;
}

export interface ValidationVerdictInput {
  integrityVerdict?: "PASS" | "PARTIAL" | "FAIL" | null | undefined;
  statisticalValidationState?: "validated" | "provisional" | "weak" | "rejected" | null | undefined;
}

const STATE_RANK: Record<ValidationVerdictState, number> = {
  validated: 4,
  provisional: 3,
  weak: 2,
  rejected: 1,
  unknown: 0,
};

function integrityToState(v: "PASS" | "PARTIAL" | "FAIL"): ValidationVerdictState {
  // PASS → validated, PARTIAL → provisional, FAIL → rejected.
  // Mapping is intentional and audited — do not "improve" without
  // updating the cross-reference in `replit.md` doctrine section.
  if (v === "PASS") return "validated";
  if (v === "PARTIAL") return "provisional";
  return "rejected";
}

/**
 * Merge integrity + statistical_validation into the canonical
 * `ValidationVerdict`. The merged state is the WORSE (lower-ranked) of
 * the two inputs — a strategy is only validated when BOTH the integrity
 * verdict AND the statistical sample agree.
 */
export function composeValidationVerdict(
  input: ValidationVerdictInput,
): ValidationVerdict {
  const integrity = input.integrityVerdict ?? null;
  const stat = input.statisticalValidationState ?? null;

  if (integrity === null && stat === null) {
    return {
      state: "unknown",
      verdictSource: "incomplete",
      integrityVerdict: null,
      statisticalValidationState: null,
      rationale: "Neither integrity verdict nor statistical validation state was emitted",
    };
  }

  if (integrity !== null && stat === null) {
    const st = integrityToState(integrity);
    return {
      state: st,
      verdictSource: "integrity_only",
      integrityVerdict: integrity,
      statisticalValidationState: null,
      rationale: `Statistical validation absent — verdict derived from integrity=${integrity}`,
    };
  }

  if (integrity === null && stat !== null) {
    return {
      state: stat,
      verdictSource: "statistical_only",
      integrityVerdict: null,
      statisticalValidationState: stat,
      rationale: `Integrity verdict absent — verdict derived from statistical_validation=${stat}`,
    };
  }

  // Both present — take the worse (lower-ranked).
  const integrityState = integrityToState(integrity!);
  const statState = stat as ValidationVerdictState;
  const mergedState = STATE_RANK[integrityState] <= STATE_RANK[statState]
    ? integrityState
    : statState;

  const rationale = mergedState === "validated"
    ? "Both integrity and statistical validation passed"
    : `Merged worse-of: integrity=${integrity}(${integrityState}) ∧ statistical=${stat}`;

  return {
    state: mergedState,
    verdictSource: "merged",
    integrityVerdict: integrity!,
    statisticalValidationState: stat!,
    rationale,
  };
}
