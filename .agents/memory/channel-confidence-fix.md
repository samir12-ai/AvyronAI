---
name: Channel confidence fix — evidenceStrength as competitorValidity
description: Part 2 fix: assessDataReliability must use evidenceStrength (not claimConfidenceScore) for competitorValidity; runGuardLayer must not hard-fail when budget.killFlag=true.
---

## Rule 1 — competitorValidity source
In `assessDataReliability` (channel-selection engine), the `competitorValidity` weight must be
computed from `evidenceStrength`, NOT `claimConfidenceScore`.

- `claimConfidenceScore` ≈ 0.35 for typical first-run B2B campaigns (low claim confidence = data limitation)
- `evidenceStrength` ≈ 0.73–0.94 (signal-level evidence quality, reflects actual competitor data present)
- Using `claimConfidenceScore` as competitorValidity collapses `overallReliability` to ~0.35 → `isWeak=true` → channel engine cannot produce usable recommendations
- Log key to look for: `competitorValidity(evidenceStrength)=<value>×0.18`

**Why:** `claimConfidenceScore` reflects whether the generated claims are defensible, not whether the underlying competitor signals exist. The guard is asking "do we have competitor data?" — `evidenceStrength` answers that question.

## Rule 2 — killFlag guard
`runGuardLayer` must NOT hard-fail when `budget.killFlag=true`. The kill flag is an upstream
signal to the budget governor; the channel engine should receive it and factor it in (e.g. reduce
recommended spend), but must not abort its own run.

**Why:** The kill flag cascade was: `offerStrength=0` → `killFlag=true` → channel guard hard-fails
before any channel can be recommended → `CHANNEL_CONFIDENCE_BELOW_MINIMUM` block. With Bug A fixed,
`offerStrength>0` so `killFlag` stays false anyway — but the guard must remain robust.

## Rule 3 — offerStrengthFactor weight
`offerStrengthFactor` contributes at 10% weight in the reliability calculation (added alongside
Part 2 fix). This lets a healthy offer score boost channel confidence modestly.

## Live verification (2026-08-08)
```
[ChannelSelectionEngine] DATA_RELIABILITY_FACTORS
  | competitorValidity(evidenceStrength)=0.737×0.18
  | offerStrength=0.816×0.10
  | overallReliability=0.934
```
Channel Selection ran to completion (36.9 s); primary channel = YouTube Organic.
