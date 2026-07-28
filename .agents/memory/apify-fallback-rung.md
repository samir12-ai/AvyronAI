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

## No comment fallback exists (P-6.10, 2026-07-28)
`apify~instagram-profile-scraper` returns `commentsCount`/`isCommentsDisabled` only; `latestComments` is always `[]` and `firstComment` always `""` (verified against live raw output). The comment-scrape 3-rung ladder rides Bright Data ONLY — since ~Jul 19 (client_10020 empty-200s) comment collection is fleet-wide dead with no fallback rung. Restoring comments needs a comments-capable actor (e.g. instagram-comment-scraper), not the profile actor.

## Comment replacement verified (P-6.11, 2026-07-28)
`apify/instagram-comment-scraper` (SbK00X0JYCPblD2wp) live-verified as a full replacement for the dead Bright Data comment ladder: input `{directUrls:[post URLs], resultsLimit}` (token-only auth, no cookies), returns `id/text/ownerUsername/timestamp/likesCount/repliesCount/postUrl` per comment — 100% IG-native ids + ISO timestamps, real pagination (120/120 from a 1011-comment post), deleted posts yield structured per-URL error items (`error:"no_items"`) not run failures. 5/6 stored P-6.10 comments recovered byte-identical. Runtime variance is real (13s–315s per run) — budget minutes; nested `replies` arrays are paid-plan-gated (counts still returned). Pay-per-event ~$0.0026/comment. Maps onto `ScrapedComment` with 5 direct field renames; caller already supplies postId/shortcode. Evidence: `.local/validation/p6.11-apify-comment-recovery.md`.
