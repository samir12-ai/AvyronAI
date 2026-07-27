---
name: P-2 competitor classification SSOT
description: Where competitor_post_classifications is wired in, remaining gaps, and the narrative dimension quirk
---

# P-2 Competitor Classification SSOT

## The rule
`competitor_post_classifications` (classifier v2) is the canonical structured source for competitor content intelligence. Do NOT add new regex-based competitor analysis — extend the classifier instead.

**Why:** The 183-post v2 corpus gives structured, per-post AI intelligence across 10 dimensions. The old regex paths in `content-dna.ts` and `signal-normalizer.ts` remain as fallback-only for posts without v2 classifications.

## Where it IS wired in (as of 2026-07-27)
1. **`content-dna-routes.ts` `gatherEngineContext()`** — BL-2 fix: a 12th parallel query aggregates classifications per competitor and injects a "COMPETITOR CONTENT INTELLIGENCE" section into the GPT Content DNA synthesis prompt. Confidence gate: ≥ 0.50.
2. **`fetch-orchestrator.ts` multi-source signal pipeline** — `buildClassificationSignals()` (new function in `signal-normalizer.ts`) is called per competitor after `classifyInstagramSignals()` and its output is merged into the `classified[]` array fed to `reconcileMultiSourceSignals()`. The bulk load happens once before the per-competitor loop (query by `competitorId IN (...)` + `classifier_version = 'competitor-post-v2'`).
3. **Strategy engines** — indirect: they read MI snapshots, which now carry AI-sourced signals.

## Where it is NOT wired (known gaps, post-P-2 tasks)
- **Watchtower orchestrator**: diffs `pipeline_snapshots` for change detection using pattern strings from snapshot payloads. Could use classification distributions for richer semantic diffing.
- **Pipeline Boss competitor corpus**: reads hashtag-derived theme tokens only. Could supplement with hook archetypes and core promise dimensions.

## `buildClassificationSignals()` mapping
Maps AI dimensions → `ClassifiedSignal[]` (sourceType="instagram"):
- `hookArchetype` → signalClass="content", text="Hook: {val}"
- `positioningStyle` → signalClass="positioning", text="Positioning: {val}"
- `coreMarketingPromise` → signalClass="offer", text="Promise: {val}"
- `ctaType` (not NONE/UNKNOWN) → signalClass="cta", text="CTA: {val}"
- `emotionalTrigger` → signalClass="content", text="Trigger: {val}"
- `narrative` (not UNKNOWN) → signalClass="content", text="Narrative: {val}"

## Dimension tiers (from Phase 3 evaluation, 142 high-conf rows)
- **CORE (> 66% fill):** hookArchetype(94%), emotionalTrigger(99%), primaryAngle(99%), primaryGoal(97%), coreMarketingPromise(77%), positioningStyle(68%)
- **SECONDARY (30-66%):** contentFormatIntent(63%), awarenessStage(54%)
- **SECONDARY LOW (food-specific reason):** ctaType(16%) — food/lifestyle brands rarely use explicit CTAs; valid for service/b2b
- **EXPERIMENTAL:** narrative(13%) — enum too narrow for short-caption Instagram posts; 87% UNKNOWN is correct behavior, not a bug. Expand enum in v3.

**How to apply:** When evaluating classifier output quality, treat ctaType LOW as expected for food/hospitality verticals. Flag it as a gap only for b2b/ecomm/service campaigns.
