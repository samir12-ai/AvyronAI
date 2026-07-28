---
name: Persistent market beliefs (P-6.2 verdict)
description: Approved architectural direction for carrying validated audience signals across quiet market windows — consult before touching AEL zero-confidence, SGL coverage, or quiet-market blocks
---

Full review: `.local/validation/p6.2-architecture-review.md` (design-only; implementation gated on user approval).

## Verdict
Adopt persistent validated market beliefs: when the Audience Engine extracts zero
objection/root_cause signals in a window, distinguish **Unknown** (no validated baseline
ever → block, unchanged) from **No Change** (validated baseline + healthy observation
window + no confirmed contradiction → carry forward at decayed confidence).

**Why:** the audience layer is the ONLY stateless intelligence layer — L4
`strategy_memory` already persists beliefs with decay (`decay_rate` 0.95,
`computeEffectiveConfidence`, `last_validated_at`) and L2 `pipeline_change_events`
already detects contradictions. Stateless interpretation erases months of validated
knowledge and reports the false claim "confidence = 0.00".

## Non-negotiable guardrails
1. **Observation health gates STABLE** — fetch failures/platform cooldowns/zombie jobs
   are absence of observation, never market stability. Unhealthy window → MISSING.
2. **Reuse never bumps `last_validated_at`** — only new confirming evidence does, or
   beliefs become immortal.
3. **Provenance class `validated_carryforward` end-to-end** — own metadata key (NOT
   `_provenance`, owned by reuse-trust layer); grounding contract + judge anchors +
   SystemControl must learn it in the same change set (positioning-gate lockstep rule).
4. **Expiry:** contradiction via an explicit kind→belief-type map over
   `pipeline_change_events` (market-shift kinds ≠ objection contradictions), decay floor,
   hard max age (~90d), market reset on business-data/competitor-set revisions.

## Key factual corrections (architect-verified)
- Approved audience signals live on **`strategy_roots`**.approved_audience_pains /
  approved_objections — NOT `strategic_plans` (no such columns there).
- Grounding contract accepts only AEL-namespace refs ([RC#]/[CC#]/[BB#]) validated
  against the current run's AEL; any belief-UID citation namespace requires extending
  the allowlist + judges — "refs ⊆ registry works unmodified" is false.
- SystemControl doesn't punish reuse generically; STALE fires only on job-mismatch or
  NEEDS_REFRESH/INCOMPATIBLE reuse — fresh compatible reuse can pass.
- `pruneOldSnapshots` 20-per-campaign cap can evict the belief-source snapshot; needs a
  pin or registry pointers that survive pruning.

## Scope honesty
This fixes quiet-period regression only. Cold-start thin markets (the Dubai burger test
campaign — both runs confidence 0.00, nothing ever validated) still block, correctly.
Validate any implementation on a campaign with real belief history, not the cold-start one.
