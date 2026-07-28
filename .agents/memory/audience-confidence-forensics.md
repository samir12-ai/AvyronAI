---
name: Audience confidence forensics
description: How to correctly attribute audience-engine confidence caps; decompose production values before naming a culprit input.
---

# Audience confidence forensics

**Rule:** Production confidence values from `computeCalibratedConfidence` decompose exactly
into their weighted components (frequency 0.5 / source-diversity 0.3 / competitor-overlap 0.2).
Before attributing a confidence cap to any input (competitor count, corpus size), decompose the
observed values arithmetically — the decomposition uniquely identifies the actual inputs used.

**Why:** P-6.6 wrongly attributed the 0.3933 pain-confidence cap to `competitorCount = 1`,
inferred from the blueprint's `competitorUrls` (1 entry). P-6.7 disproved this: all observed
values decompose exactly with competitorScore = 10/12, proving all 10 `ci_competitors` rows
entered the formula. The real caps were (a) `MAX_EXPECTED_SOURCE_TYPES = 5` while the campaign
corpus only has 2 source types (captions+comments; reviews/tiktok empty → 60% of diversity
weight unreachable), and (b) freq normalization requiring a signal to match 10% of the weighted
corpus for full score.

**How to apply:**
- `blueprint.competitorUrls` (section-composer route gate) and `ci_competitors` (audience
  engine input) are unrelated structures — never infer one from the other.
- The audience engine loads competitors with only `isActive = true` as a filter; competitorCount
  is the raw row count, no downstream filtering.
- Chain that blocks V2: pains < 0.40 → `buildStructuredSignals` highConfPains empty →
  root_causes = [] → SGL missing `root_cause` category → BLOCKED_BY_INTEGRITY →
  strategy_roots never written. (Era-1 runs blocked differently: NULL structured_signals column.)
- Reports: `.local/validation/p6.5-*.md`, `p6.6-*.md`, `p6.7-*.md`.
