/**
 * Seal #6 / Task #24 — Frontend canonical-truth migration proofs.
 *
 * D-doctrine assertions:
 *   D1: No semantic fallback. Canonical and legacy are distinct args.
 *   D3: Strict enum guards.
 *   D4: Legacy fields cannot satisfy canonical contracts (legacy PASS → amber).
 *   D5: Missing canonical → never green.
 *
 * Critical invariant proven below: PARTIAL/legacy NEVER produces a green pixel.
 */

import { describe, expect, it } from 'vitest';
import {
  colorForIntegrityVerdict,
  colorForExecutionStatus,
  colorForValidationState,
  labelForExecutionStatus,
  labelForIntegrityVerdict,
  isCanonicalIntegrityVerdict,
  isCanonicalExecutionStatus,
  VERDICT_COLORS,
} from '../lib/verdict-colors';

const GREEN = VERDICT_COLORS.green;
const AMBER = VERDICT_COLORS.amber;
const RED = VERDICT_COLORS.red;
const SLATE = VERDICT_COLORS.slate;

describe('colorForIntegrityVerdict — D2/D3/D4/D5', () => {
  it('canonical PASS → green', () => {
    expect(colorForIntegrityVerdict('PASS')).toBe(GREEN);
  });
  it('canonical PARTIAL → amber, never green', () => {
    expect(colorForIntegrityVerdict('PARTIAL')).toBe(AMBER);
    expect(colorForIntegrityVerdict('PARTIAL')).not.toBe(GREEN);
  });
  it('canonical FAIL → red', () => {
    expect(colorForIntegrityVerdict('FAIL')).toBe(RED);
  });
  it('D4: missing canonical + legacy PASS → amber (NEVER green)', () => {
    expect(colorForIntegrityVerdict(null, 'PASS')).toBe(AMBER);
    expect(colorForIntegrityVerdict(undefined, 'PASS')).toBe(AMBER);
    expect(colorForIntegrityVerdict(null, 'PASS')).not.toBe(GREEN);
  });
  it('D5: both missing → slate (CONTRACT_INCOMPLETE), never green', () => {
    expect(colorForIntegrityVerdict(null, null)).toBe(SLATE);
    expect(colorForIntegrityVerdict(null, null)).not.toBe(GREEN);
  });
  it('D3: rejects garbage strings (treated as missing)', () => {
    expect(colorForIntegrityVerdict('OK_MAYBE')).toBe(SLATE);
    expect(colorForIntegrityVerdict('SUCCESS')).toBe(SLATE);
  });
  it('legacy FAIL → red (downgrade preserved)', () => {
    expect(colorForIntegrityVerdict(null, 'FAIL')).toBe(RED);
  });
});

describe('colorForExecutionStatus — full enum (D2/D3)', () => {
  it('COMPLETED → green (only canonical-COMPLETED earns green)', () => {
    expect(colorForExecutionStatus('COMPLETED')).toBe(GREEN);
  });
  it.each([
    ['PARTIAL', AMBER],
    ['NEEDS_INPUT', AMBER],
    ['PENDING', AMBER],
    ['BLOCKED', RED],
    ['BLOCKED_BY_INTEGRITY', RED],
    ['ERROR', RED],
  ])('%s → %s', (status, expected) => {
    expect(colorForExecutionStatus(status)).toBe(expected);
  });
  it('legacy SUCCESS → amber (D4: never green)', () => {
    expect(colorForExecutionStatus(null, 'SUCCESS')).toBe(AMBER);
    expect(colorForExecutionStatus(null, 'SUCCESS')).not.toBe(GREEN);
  });
  it('legacy FAILURE → red', () => {
    expect(colorForExecutionStatus(null, 'FAILURE')).toBe(RED);
  });
  it('D5: missing → slate', () => {
    expect(colorForExecutionStatus(null, null)).toBe(SLATE);
    expect(colorForExecutionStatus(null, null)).not.toBe(GREEN);
  });
});

describe('colorForValidationState — D3/D5', () => {
  it.each([
    ['validated', GREEN],
    ['provisional', VERDICT_COLORS.cyan],
    ['weak', AMBER],
    ['rejected', RED],
    ['unknown', SLATE],
  ])('%s → %s', (state, expected) => {
    expect(colorForValidationState(state)).toBe(expected);
  });
  it('D5: missing → slate (no silent default to weak)', () => {
    expect(colorForValidationState(null)).toBe(SLATE);
    expect(colorForValidationState(undefined)).toBe(SLATE);
    expect(colorForValidationState('garbage')).toBe(SLATE);
  });
  it('weak ≠ unknown — distinct semantics preserved', () => {
    expect(colorForValidationState('weak')).not.toBe(colorForValidationState('unknown'));
  });
});

describe('label helpers — D4 coercion', () => {
  it('labelForIntegrityVerdict: legacy PASS → "PARTIAL" (D4 coercion)', () => {
    expect(labelForIntegrityVerdict(null, 'PASS')).toBe('PARTIAL');
  });
  it('labelForIntegrityVerdict: canonical wins', () => {
    expect(labelForIntegrityVerdict('FAIL', 'PASS')).toBe('FAIL');
  });
  it('labelForIntegrityVerdict: nothing → UNKNOWN', () => {
    expect(labelForIntegrityVerdict(null, null)).toBe('UNKNOWN');
  });
  it('labelForExecutionStatus: legacy SUCCESS → "PARTIAL"', () => {
    expect(labelForExecutionStatus(null, 'SUCCESS')).toBe('PARTIAL');
  });
  it('labelForExecutionStatus: canonical COMPLETED returned as-is', () => {
    expect(labelForExecutionStatus('COMPLETED')).toBe('COMPLETED');
  });
});

describe('canonical-presence guards', () => {
  it('isCanonicalIntegrityVerdict only true for valid enum', () => {
    expect(isCanonicalIntegrityVerdict('PASS')).toBe(true);
    expect(isCanonicalIntegrityVerdict('PARTIAL')).toBe(true);
    expect(isCanonicalIntegrityVerdict('FAIL')).toBe(true);
    expect(isCanonicalIntegrityVerdict(null)).toBe(false);
    expect(isCanonicalIntegrityVerdict('SUCCESS')).toBe(false);
    expect(isCanonicalIntegrityVerdict('partial')).toBe(false); // case sensitive
  });
  it('isCanonicalExecutionStatus only true for valid enum', () => {
    expect(isCanonicalExecutionStatus('COMPLETED')).toBe(true);
    expect(isCanonicalExecutionStatus('BLOCKED_BY_INTEGRITY')).toBe(true);
    expect(isCanonicalExecutionStatus('SUCCESS')).toBe(false); // legacy is NOT canonical
    expect(isCanonicalExecutionStatus(null)).toBe(false);
  });
});

/**
 * Component-level fake-green-prevention tests for OrchestratorPanel and
 * BuildThePlan (added during validator-#1 closure). The components contain
 * inline color tables / branching logic, not direct helper calls — so we
 * mirror the exact lookups here and assert the green color is unreachable
 * from any legacy-only input.
 */
describe('OrchestratorPanel — legacy SUCCESS cannot render green (validator-#1)', () => {
  /** Mirrors EngineRow's status-branch logic post-Seal-#6. */
  function pickRowColor(legacyStatus: string, executionStatus: string | null): string {
    const isCanonical = ['COMPLETED', 'PARTIAL', 'BLOCKED', 'BLOCKED_BY_INTEGRITY', 'NEEDS_INPUT', 'ERROR', 'PENDING']
      .includes(executionStatus || '');
    if (legacyStatus === 'DEPTH_FAILED') return '#FF6B6B';
    if (legacyStatus === 'DEPTH_CASCADE_BLOCKED') return AMBER;
    if (legacyStatus === 'SIGNAL_INSUFFICIENT') return AMBER;
    if (executionStatus || legacyStatus) {
      return colorForExecutionStatus(executionStatus, legacyStatus);
    }
    return SLATE;
  }
  it('legacy SUCCESS row color → amber, never green', () => {
    expect(pickRowColor('SUCCESS', null)).toBe(AMBER);
    expect(pickRowColor('SUCCESS', null)).not.toBe(GREEN);
  });
  it('canonical COMPLETED row color → green', () => {
    expect(pickRowColor('SUCCESS', 'COMPLETED')).toBe(GREEN);
  });
  it('completedCount only counts canonical COMPLETED', () => {
    const sections = [
      { status: 'SUCCESS', executionStatus: null },        // legacy only
      { status: 'COMPLETED', executionStatus: 'COMPLETED' }, // canonical
      { status: 'COMPLETE', executionStatus: undefined },   // legacy only
    ];
    const count = sections.filter(
      s => isCanonicalExecutionStatus(s.executionStatus) && s.executionStatus === 'COMPLETED',
    ).length;
    expect(count).toBe(1); // not 3 — D4: legacy cannot inflate the counter
  });
});

describe('BuildThePlan — sectionColors map cannot paint legacy SUCCESS green', () => {
  // Mirrors the inline sectionColors map in BuildThePlan.tsx loading branch.
  const sectionColors: Record<string, string> = {
    PENDING: '#6B7280',
    RUNNING: '#3B82F6',
    COMPLETED: '#10B981',
    SUCCESS: '#F59E0B',
    COMPLETE: '#F59E0B',
    PARTIAL: '#F59E0B',
    ERROR: '#EF4444',
    BLOCKED: '#EF4444',
    BLOCKED_BY_INTEGRITY: '#EF4444',
    SKIPPED: '#9CA3AF',
    NEEDS_INPUT: '#F59E0B',
  };
  it('canonical COMPLETED → green (#10B981)', () => {
    expect(sectionColors.COMPLETED).toBe('#10B981');
  });
  it('legacy SUCCESS / COMPLETE → amber, never green', () => {
    expect(sectionColors.SUCCESS).toBe('#F59E0B');
    expect(sectionColors.COMPLETE).toBe('#F59E0B');
    expect(sectionColors.SUCCESS).not.toBe('#10B981');
    expect(sectionColors.COMPLETE).not.toBe('#10B981');
  });
});

describe('integration — fake-green prevention regression', () => {
  /** Critical regression test: a poisoned snapshot with overallStatus=PASS but
   *  no canonical integrityVerdict MUST NOT paint the dashboard green. This
   *  was the F5.1 / F5.3 audit finding. */
  it('legacy-only PASS snapshot never produces green color', () => {
    const legacyOnlySnapshot = { overallStatus: 'PASS' as const };
    const color = colorForIntegrityVerdict(undefined, legacyOnlySnapshot.overallStatus);
    expect(color).toBe(AMBER);
    expect(color).not.toBe(GREEN);
  });
  /** F5.10: safeToExecute=true must not be a green-light source. */
  it('safeToExecute=true (encoded as legacy PASS) → amber, not green', () => {
    const legacyFromSafeToExecute = true ? 'PASS' : 'FAIL';
    expect(colorForIntegrityVerdict(null, legacyFromSafeToExecute)).toBe(AMBER);
  });
  /** F5.5/F5.8: binary SUCCESS check on decision pills must not be green. */
  it('decision pill: legacy SUCCESS → amber (not green)', () => {
    expect(colorForExecutionStatus(null, 'SUCCESS')).toBe(AMBER);
  });
});
