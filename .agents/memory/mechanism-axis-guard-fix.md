---
name: Mechanism Axis Guard fix — engine failure ≠ axis mismatch
description: Bug A pattern: axis guard must distinguish technical engine failure from a genuine axis mismatch; identical axes after normalization → DEGRADED_CONTINUE not hard-reject.
---

## Rule
`MECHANISM_AXIS_GUARD` must classify three distinct cases before deciding:

1. **Technical failure** (engine timeout / DEPTH_FAILED / AI error) — 10% penalty + `MECHANISM_AXIS_DEGRADED` log; do NOT hard-reject, offer engine continues.
2. **Identical axes after normalization** — same as (1): 10% penalty + `MECHANISM_AXIS_DEGRADED | skipReason=axes_identical_after_normalization`.
3. **Real axis mismatch** (both axes present, non-empty, different after normalization) — HARD REJECT (offerStrengthScore → 0), unchanged.
4. **Empty axes** — `DEGRADED_CONTINUE`, no penalty.

**Why:** Before the fix the guard used a single `consistent=false` branch that hard-rejected both technical failures and real mismatches. A hard-reject sets `offerStrengthScore=0`, which cascades: budget governor sees 0 → `killFlag=true` → channel selection aborts with `CHANNEL_CONFIDENCE_BELOW_MINIMUM` before it runs.

**How to apply:** Any new guard that gates on a upstream-engine output must check whether the upstream engine itself failed before treating its output as evidence of a content problem. Absent/error output ≠ content failure.

## Normalisation before comparison
Normalise both axes (lowercase, strip punctuation, collapse whitespace) before comparing. `proof_and_transparency == proof_and_transparency` is identical; without normalisation a trivial formatting difference triggers a hard reject.

## Cascade confirmed in live run (2026-08-08)
- Mechanism Engine: `consistent=false`, axes identical after normalisation → `MECHANISM_AXIS_DEGRADED`, penalty applied, `offerStrengthScore=0.824`
- Budget Governor received `offerStrength=0.82` → `killFlag=false`
- Channel Selection ran to completion: `overallReliability=0.934`
- All 15 engines ran; BLOCKED only for truthful `COMPLIANCE_FAILURE`
