---
name: Confidence Architecture Redesign
description: Why cross-engine confidence inheritance and spread checks were removed; what replaced them; and how to reason about future confidence-related changes.
---

## The Decision

Cross-engine confidence inheritance (rolling floor cap, upstream ceiling, zero-floor cascade) and the `CONFIDENCE_SPREAD_EXCESSIVE` / `CONFIDENCE_CHAIN_VIOLATION` System Control checks were removed entirely.

## What Was Removed

1. **Mechanism inheritance ceiling** (`mechanism-engine/engine.ts`): `min(pos.confidenceScore, diff.confidenceScore) + 0.05` capped mechanism's own structural quality score at positioning's territory-maturity score (~0.15 on first run). These are semantically incomparable quantities.

2. **Rolling floor cap** (`orchestrator/shared-strategic-context.ts` `updateConfidenceChain`): `Math.min(localCombined, floor + 0.20)` cascaded a low floor from early engines onto all downstream engines.

3. **Zero-floor cascade** (`orchestrator/index.ts` `updateSSCAfterEngine`): if `ssc.confidenceFloor === 0`, all downstream `combined/engine/data` scores were set to 0.

4. **`checkConfidenceChainIntegrity`** and **`checkConfidenceSpread`** from `structural-checks.ts`: these validated the rolling-floor invariant and compared heterogeneous scores across engines — both semantically unsound.

5. `CONFIDENCE_CHAIN_VIOLATION`, `CONFIDENCE_SPREAD_EXCESSIVE`, `CAP_CONFIDENCE_AT_FLOOR_PLUS_DELTA`, `CLAMP_TO_LOWER_CONFIDENCE` from `BlockCode`, `RepairActionCode`, `REPAIRABLE_BLOCKS`, `BLOCK_METADATA`, and all repair functions.

## Why

The three cascades created a first-run bootstrap deadlock: positioning territory maturity (a structural/historical indicator) was being used as a ceiling for mechanism's output quality (an LLM evaluation of the current output). On a first run, territory maturity is always low, which cascaded through all downstream engines and produced a false `CONFIDENCE_SPREAD_EXCESSIVE` block comparing mechanism's artificially-suppressed score (0.20) against MI's real evidence-quality score (0.92). No real data improvement could fix this — the deadlock was structural.

**Why:** Confidence scores across engines are semantically incomparable. MI confidence = evidence coverage quality. Positioning confidence = territory maturity (historical). Mechanism confidence = structural output quality (LLM grading). Audience confidence = data evidence quality. Comparing or cascading these across engines produces nonsense signals.

## What Replaced Them

Quality is now enforced via:
- **CEL** (10 structural rules on content — positioning, differentiation, funnel, channel)
- **Positioning hard gate** (`engineConfidence ≥ 0.40` — engine's own SSC score)
- **Integrity engine** (8 cross-engine checks)
- **Signal grounding** (trustedRatio check)
- **Signal lineage** (unknownRatio ≤ 0.30)
- **Confidence_integrity structural check** (data provenance: fires `CONFIDENCE_INTEGRITY_DEGRADED` downgrade when ≥N engines carry `inferred_synthesis`)
- **`checkBudgetOverrideZeroConfidence`** (fires only if floor is genuinely 0 — real engine failure)

## What Was Preserved

- `ssc.confidenceFloor = Math.min(floor, combinedConfidence)` — floor still tracks minimum for budget check.
- `inheritedFloor` in SSC chain entries — diagnostic field, not a cap.
- `inheritedConfidence`, `rawLLMConfidence`, `confidencePenalty` in mechanism output — audit trail fields (all set to raw score, no penalty).

## Verified Result (2026-08-08 real MarketMindAI run)

- 15/15 engines completed
- 0 block codes
- 20/21 structural checks PASS (1 DOWNGRADE from confidence_integrity — correct, truthful)
- CEL 10/10 PASS
- positioning_hard_gate: PASS at engineConfidence=1.00 (was falsely suppressed to 0.20 before fix)
- Plan built: SUCCESS

## How to Apply

- If a future change proposes "compare engine A confidence to engine B confidence across the SSC chain" — stop. These are semantically incomparable. Fix via lineage, CEL, or integrity.
- If a future change proposes "cap downstream engine score to upstream score + delta" — stop. Each engine evaluates its own output.
- The only cross-engine confidence signal that is semantically valid is `confidence_integrity` (which reads `dataProv` — a provenance field about how the data was sourced, not about LLM output quality).
- `checkBudgetOverrideZeroConfidence` is correct but its semantics changed: it now fires only for genuine zero-confidence engines, not cascade artifacts. Do not loosen its threshold.
