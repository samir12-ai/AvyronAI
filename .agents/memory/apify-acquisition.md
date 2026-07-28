---
name: Apify acquisition layer
description: Actor split, provider-error classification guard, and healthy-empty semantics for the post-Bright-Data Apify acquisition paths.
---

# Profile vs comment actor split (all platforms)

Profile/post actors return **no comment threads** (confirmed live for both Instagram and TikTok). Comments always require a dedicated comment actor per platform, batched one run per competitor. Never assume a profile scrape can backfill comments.

# Provider errors must never classify as platform blocks

**Rule:** every call path that catches an Apify client error and feeds it to a block classifier (`classifyScrapeFailure`, `isBlockWarning`-style substring detectors) MUST force provider-origin errors (`Apify API …`, `Apify run …`, `BREAKER_OPEN`, missing-key) to TRANSIENT and sanitize `403/429/rate limit` tokens out of any persisted warning strings.

**Why:** an `Apify API 403` (bad/expired token) says nothing about the target platform; misclassifying it stamps a false 24h BLOCKED_BY_PLATFORM cooldown that suppresses healthy retries. This guard existed in one scraper but was missed in a newer provider wrapper — caught only by post-build architect review. Regression suite: `server/tests/instagram-provider-block-classification.test.ts`.

**How to apply:** when adding any new provider/actor call path, grep for existing sanitization (`4xx`, `throttled`) and replicate it in the new catch block; add the new path to the regression test.

# Healthy-empty semantics in comment acquisition

The pre-dispatch budget filter drops posts with `commentCount === 0` (and no shortcode). If **all** candidate posts are filtered, the scrape returns `runId: null`, 0 evaluated, ≈$0 — with a log line that still says "scraping N posts". This is truthful cost-avoidance, not a failure; check the posts' stored comment counts before suspecting the actor or the API key.

# Env note for harnesses

Standalone tsx harnesses don't inherit the backend's env loading; `APIFY_API_KEY` present in the workspace env ≠ present in every shell. If a run shows `runId: n/a` with zero evaluated, distinguish "budget filter dropped everything" (healthy) from "key missing" (the client throws loudly — absence of an error means the filter, not the key).
