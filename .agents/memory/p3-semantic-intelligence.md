---
name: P-3 semantic intelligence upgrade
description: How Watchtower semantic diffing and Pipeline Boss semantic token injection work, and their constraints
---

# P-3 Step 1 — Semantic Intelligence Upgrade

## Watchtower: classifySemanticChanges()

New async function in `server/watchtower/orchestrator.ts`. Compares `competitor_post_classifications` distributions across two 30-day rolling windows anchored at consecutive snapshot timestamps.

**How it fires:**
- Top value for a CORE dimension changes completely → severity=major
- Top value stable but share shifts ≥ 20pp → severity=medium/mild

**6 new event kinds:**
`hook_archetype_shift`, `promise_shift`, `emotional_trigger_shift`, `positioning_shift`, `primary_goal_shift`, `cta_strategy_shift`

**Guards:**
- `isCacheHit=true` skips entirely (same as payload detectors)
- < 3 posts in either window → returns [] (no false positives), logs `SEMANTIC_DIFF_THIN_DATA`
- DB failure → returns [] (logs `SEMANTIC_DIFF_FAILED`), payload detectors still run

**Two-fetch gate:** `maintainOpenCandidates()` routes semantic candidate re-checks through `classifySemanticChanges()` instead of `classifyWatchtowerChanges()`. Baseline snapshot `createdAt` is now fetched alongside payload for this routing.

**Data requirement:** Needs ≥2 consecutive `pipeline_snapshots` per competitor to fire. New installs accumulate this naturally.

## Pipeline Boss: extractSemanticThemeTokens()

Exported from `server/pipeline/lanes/competitor/corpus.ts`.

**Token format:** `<prefix>:<value_lowercase>`
- `hook:bold_claim`, `angle:authenticity`, `promise:better_taste`, `trigger:aspiration`, `positioning:relatability`, `goal:awareness`

**Integration in loadPostsFromDb():**
- Bulk-loads classifications for all posts in one query (no N+1)
- Classified posts: semantic tokens primary + `tag:<hashtag>` secondary
- Unclassified posts: pure hashtag tokens (backward-compatible)
- Confidence gate: ≥ 0.50, classifier_version = "competitor-post-v2"

**Coverage improvement:** 50% → 96% of posts have theme tokens (hashtag gap was 50%; semantic classifier covers 96%).

**Why:** primaryAngle is free-text (not enum), so some tokens like `angle:ramadan greetings and blessings` are too unique to aggregate into patterns — harmless (won't reach 2-competitor threshold).

## Known constraints
- `cta_strategy_shift` fires rarely for food/lifestyle (ctaType 16% non-NONE) — valid for service/b2b verticals
- Cross-competitor semantic aggregation (market-wide promise convergence) not yet built — Watchtower is per-competitor only
- TikTok classification not yet in corpus (Instagram only)
