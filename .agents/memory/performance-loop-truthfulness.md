---
name: Performance loop truthfulness doctrine
description: Execution comparator status ladder, outcome-writing rules, frozen-result persistence, and trust DTO contract for the Avyron performance loop
---

# Performance loop truthfulness doctrine

## Comparator status ladder (deterministic, code-decides)
BLOCKED (no non-website channel) → UNVERIFIED (scrape doesn't cover window) → EXECUTED / PARTIALLY_EXECUTED / NOT_EXECUTED (observed) / NOT_YET_DUE (window open).
**Coverage requires scrapeStatus = 'SUCCESS' exactly.** PARTIAL and SKIPPED snapshots must never satisfy observation coverage — a partial scan can miss posts and turn real execution into a false NOT_EXECUTED. A closed window is only observed by a SUCCESS scrape at/after windowEnd.
**Why:** absence of observation ≠ absence of execution; a false NOT_EXECUTED poisons decision outcomes and strategy memory downstream.

## Outcome writing is strictly comparator-driven
- No comparator row for a decision (comparator failed, vocabulary drift) → write NO outcome row. Never fall back to legacy lineage/executed flags — comparator failure is absence of knowledge, not a license to guess.
- UNVERIFIED/BLOCKED decisions → skip outcome (already doctrine).

## Freeze the exact result you consumed
The cycle runner computes the comparison once pre-transaction (persist:false) and later freezes **the same result object** via `persistComparisonResult` — never recomputes at persist time. A scrape/post landing between computation and persist would otherwise make frozen history disagree with the outcome rows.
**How to apply:** any "compute → decide → freeze" pipeline must persist the decided-upon snapshot, not a fresh recomputation.

## Trust DTO contract
Persisted JSON field names (evidenceId/category/summary; claimId/claimText/claimType/criticality/evidenceRefs/verdict/violations/judgeReason) are the contract — the client hook must mirror them exactly and render defensively (`?? []`). Renaming on the client "for nicer names" crashes on real persisted rows.

## Claim grounding rule
A judge claim may only carry verdict "supported" when it cites ≥1 resolvable registry evidence id. Hypotheses (no refs by definition) render as "unsupported" with an explanatory reason — truthful, still visible. Next-experiment claims resolve their target dimension/value to a real content-score row or go unsupported.

## Campaign-isolation write pattern
Routes under requireCampaign: reads filter accountId AND campaignId; writes bind campaignId to the authenticated context and 400 on a mismatched body campaignId (no silent same-account cross-campaign escape). Applied to /api/revenue; /api/ad-spend still pending (follow-up task).
