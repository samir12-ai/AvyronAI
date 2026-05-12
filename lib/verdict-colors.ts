/**
 * Canonical-truth verdict color helpers (Seal #6 / Task #24).
 *
 * Per Semantic Contract Hardening doctrine (D1-D5):
 *   D1 — No semantic fallback (`?? status`, `|| status`, etc.) on live decision paths.
 *   D2 — Every meaning has its own canonical field.
 *   D3 — Strict enums only.
 *   D4 — Legacy fields are historical only; MAY NOT satisfy contracts.
 *   D5 — Missing canonical → CONTRACT_INCOMPLETE (never silently treat as PASS/green).
 *
 * Frontend rendering rule:
 *   When the canonical field is present → color from canonical enum.
 *   When the canonical field is absent → fall back to legacy IF supplied,
 *   but coerce any legacy "PASS" / "SUCCESS" / safeToExecute=true into PARTIAL
 *   (amber). A pre-canonical snapshot must NEVER paint the UI green: green is
 *   reserved for canonical truth.
 */

export type IntegrityVerdict = 'PASS' | 'PARTIAL' | 'FAIL';
export type ExecutionStatus =
  | 'COMPLETED'
  | 'PARTIAL'
  | 'BLOCKED'
  | 'BLOCKED_BY_INTEGRITY'
  | 'NEEDS_INPUT'
  | 'ERROR'
  | 'PENDING';
export type ValidationState = 'validated' | 'provisional' | 'weak' | 'rejected' | 'unknown';

export const VERDICT_COLORS = {
  green: '#10B981',
  amber: '#F59E0B',
  red: '#EF4444',
  slate: '#64748B',
  cyan: '#06B6D4',
  /**
   * Blue is the canonical color for the "user must act" semantic — used by
   * NEEDS_INPUT (the engine pipeline is healthy but waiting on the operator).
   * Distinct from amber (degraded) and slate (unknown / pending).
   */
  blue: '#3B82F6',
} as const;

const INTEGRITY_VERDICT_SET: ReadonlySet<string> = new Set(['PASS', 'PARTIAL', 'FAIL']);
const EXECUTION_STATUS_SET: ReadonlySet<string> = new Set([
  'COMPLETED',
  'PARTIAL',
  'BLOCKED',
  'BLOCKED_BY_INTEGRITY',
  'NEEDS_INPUT',
  'ERROR',
  'PENDING',
]);
const VALIDATION_STATE_SET: ReadonlySet<string> = new Set([
  'validated',
  'provisional',
  'weak',
  'rejected',
  'unknown',
]);

/**
 * Color for an integrity verdict. Canonical-first; legacy `overallStatus` only
 * used when canonical missing AND coerced to PARTIAL even when legacy says PASS.
 */
export function colorForIntegrityVerdict(
  canonical: string | null | undefined,
  legacy?: string | null | undefined,
): string {
  if (canonical && INTEGRITY_VERDICT_SET.has(canonical)) {
    if (canonical === 'PASS') return VERDICT_COLORS.green;
    if (canonical === 'PARTIAL') return VERDICT_COLORS.amber;
    return VERDICT_COLORS.red;
  }
  // Canonical missing → never paint green from legacy.
  if (legacy && INTEGRITY_VERDICT_SET.has(legacy)) {
    if (legacy === 'FAIL') return VERDICT_COLORS.red;
    return VERDICT_COLORS.amber; // PASS or PARTIAL → amber (legacy can't earn green)
  }
  return VERDICT_COLORS.slate;
}

/**
 * Color for an execution status enum. Canonical-only; legacy SUCCESS/FAILURE
 * is coerced to amber/red respectively (never green).
 */
export function colorForExecutionStatus(
  canonical: string | null | undefined,
  legacy?: string | null | undefined,
): string {
  if (canonical && EXECUTION_STATUS_SET.has(canonical)) {
    switch (canonical) {
      case 'COMPLETED':
        return VERDICT_COLORS.green;
      case 'PARTIAL':
        return VERDICT_COLORS.amber;
      // Spec: NEEDS_INPUT = blue (operator action required, not failure).
      case 'NEEDS_INPUT':
        return VERDICT_COLORS.blue;
      // Spec: PENDING = slate (queued / not yet started — distinct from amber).
      case 'PENDING':
        return VERDICT_COLORS.slate;
      // BLOCKED_BY_INTEGRITY shares the red base color with BLOCKED — the
      // *lock* iconography (rendered by the consumer via iconForExecutionStatus)
      // is what disambiguates the two semantics.
      case 'BLOCKED':
      case 'BLOCKED_BY_INTEGRITY':
      case 'ERROR':
        return VERDICT_COLORS.red;
    }
  }
  if (legacy) {
    const upper = legacy.toUpperCase();
    if (upper === 'SUCCESS') return VERDICT_COLORS.amber; // legacy binary → never green
    if (upper === 'FAILURE' || upper === 'FAILED' || upper === 'ERROR') return VERDICT_COLORS.red;
  }
  return VERDICT_COLORS.slate;
}

/**
 * Color for a statistical-validation state. Returning slate for unknown/missing
 * is intentional — caller MUST NOT default to 'weak' (loses the distinction
 * between "no data" and "weak evidence").
 */
export function colorForValidationState(state: string | null | undefined): string {
  if (!state || !VALIDATION_STATE_SET.has(state)) return VERDICT_COLORS.slate;
  switch (state) {
    case 'validated':
      return VERDICT_COLORS.green;
    case 'provisional':
      return VERDICT_COLORS.cyan;
    case 'weak':
      return VERDICT_COLORS.amber;
    case 'rejected':
      return VERDICT_COLORS.red;
    case 'unknown':
    default:
      return VERDICT_COLORS.slate;
  }
}

/**
 * Human-readable label for execution status. Returns the canonical value if
 * present, otherwise an honest "Unknown" rather than echoing legacy SUCCESS.
 */
export function labelForExecutionStatus(
  canonical: string | null | undefined,
  legacy?: string | null | undefined,
): string {
  if (canonical && EXECUTION_STATUS_SET.has(canonical)) return canonical;
  if (legacy) {
    const upper = legacy.toUpperCase();
    if (upper === 'SUCCESS') return 'PARTIAL'; // coerce legacy success → partial label
    return upper;
  }
  return 'UNKNOWN';
}

/**
 * Human-readable label for integrity verdict. Coerces legacy PASS to PARTIAL
 * when canonical is missing (matches the color rule above).
 */
export function labelForIntegrityVerdict(
  canonical: string | null | undefined,
  legacy?: string | null | undefined,
): string {
  if (canonical && INTEGRITY_VERDICT_SET.has(canonical)) return canonical;
  if (legacy && INTEGRITY_VERDICT_SET.has(legacy)) {
    return legacy === 'PASS' ? 'PARTIAL' : legacy;
  }
  return 'UNKNOWN';
}

/**
 * Indicates whether the displayed verdict is sourced from canonical truth.
 * Components can use this to render a small "legacy snapshot" caveat.
 */
export function isCanonicalIntegrityVerdict(canonical: string | null | undefined): boolean {
  return !!(canonical && INTEGRITY_VERDICT_SET.has(canonical));
}
export function isCanonicalExecutionStatus(canonical: string | null | undefined): boolean {
  return !!(canonical && EXECUTION_STATUS_SET.has(canonical));
}
export function isCanonicalValidationState(state: string | null | undefined): boolean {
  return !!(state && state !== 'unknown' && VALIDATION_STATE_SET.has(state));
}
/**
 * Human-readable label for validation state. Returns the canonical enum value
 * capitalized, or "Unknown" when the field is missing/non-canonical (D5).
 */
export function labelForValidationState(state: string | null | undefined): string {
  if (!state || !VALIDATION_STATE_SET.has(state)) return 'Unknown';
  switch (state) {
    case 'validated': return 'Validated';
    case 'provisional': return 'Provisional';
    case 'weak': return 'Weak';
    case 'rejected': return 'Rejected';
    case 'unknown': return 'Unknown';
    default: return 'Unknown';
  }
}

/**
 * Canonical Ionicons name for an executionStatus enum. BLOCKED_BY_INTEGRITY
 * gets a *lock* icon — distinct from generic BLOCKED's "ban" — so the
 * "the integrity layer is holding execution" semantic is visible at a glance.
 * Returns 'help-circle-outline' for missing/unknown so the UI never renders
 * a misleading checkmark.
 */
export type ExecutionStatusIconName =
  | 'checkmark-circle'
  | 'alert-circle-outline'
  | 'time-outline'
  | 'pause-circle'
  | 'lock-closed'
  | 'ban'
  | 'close-circle'
  | 'help-circle-outline';

export function iconForExecutionStatus(
  canonical: string | null | undefined,
): ExecutionStatusIconName {
  if (!canonical || !EXECUTION_STATUS_SET.has(canonical)) return 'help-circle-outline';
  switch (canonical) {
    case 'COMPLETED': return 'checkmark-circle';
    case 'PARTIAL': return 'alert-circle-outline';
    case 'PENDING': return 'time-outline';
    case 'NEEDS_INPUT': return 'pause-circle';
    case 'BLOCKED_BY_INTEGRITY': return 'lock-closed';
    case 'BLOCKED': return 'ban';
    case 'ERROR': return 'close-circle';
    default: return 'help-circle-outline';
  }
}
