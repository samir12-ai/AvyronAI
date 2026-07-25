---
name: Apify fallback rung design
description: Lessons from adding an Apify actor as a last-rung scraper fallback (IG owned path, 2026-07)
---

# Fallback rungs must fit the caller's time budget

**Rule:** A fallback transport that takes longer than a caller's watchdog budget must be opt-in per call path, not unconditional in the shared ladder.

**Why:** The competitor fetch path races scrapes against a 45s wall-clock watchdog; an Apify actor run takes ~80–120s. An unconditional rung there means: watchdog abandons the raced promise mid-run, the actor keeps billing server-side, and the evict/restart cycle starts a second billed run — spend doubling across the whole competitor fleet on every scheduled fetch while the primary provider is down.

**How to apply:** Gate the slow rung behind an explicit `opts.allowApifyFallback`-style flag; only un-watchdogged callers (owned-channel scraper) opt in. Competitor path keeps pre-fallback semantics and self-heals via the primary provider.

# Provider-side errors must not feed target block-detectors

Two separate leak channels, both must be handled:
1. `lastFailureMessage` → `classifyScrapeFailure` (stamps 24h GENUINE_BLOCK cooldowns) — keep provider errors out of it entirely.
2. `result.warnings` → `isBlockWarning` substring match on bare "403"/"429"/"RATE_LIMIT" — sanitize provider error text (403/429 → "4xx", rate-limit → "throttled") before pushing, or a bad Apify token triggers IG session rotation + a second billed actor run.

# Actor run variance

`apify~instagram-profile-scraper` occasionally completes in ~8s returning profile fields (followers, name) but 0 post items; the next run returns full posts. Treat a completed 0-post run as healthy-empty (transportSucceeded=true, failureClass NONE) — never as a block — and let the next scheduled cycle retry.

# Verification note

A completed-run gate on `posts.length === 0` (not catch-only) is required when upstream rungs can transport-succeed with 0 posts (Unlocker intercepting IG internal APIs returns synthesized 200/400s).
