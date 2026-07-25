---
name: BLOCKED_BY_PLATFORM self-suppression cooldown
description: Why competitor fetches can report ALL_FAILED / 0 posts for 24h while the platform transport is actually healthy.
---

# Persisted BLOCKED_BY_PLATFORM 24h cooldown is self-suppressing

When a competitor fetch is classified as a platform block, `ci_competitors.fetch_method`
is persisted as `BLOCKED_BY_PLATFORM` with `last_checked_at` stamped. For the next 24h,
`fetchCompetitorData` short-circuits **before touching the network** (returns
`status=BLOCKED`, ~7ms) for any call that is NOT `forceRefresh` and NOT `DEEP_PASS`.
The MI fetch-orchestrator maps `status=BLOCKED` → `POSTS_FETCH=FAILED`; if every
competitor is cooling, the job stop-reason becomes `ALL_FAILED` with 0 posts.

**Why this is a trap:** the block is often spurious. The production orchestrator calls
`fetchCompetitorData(..., forceRefresh = attempt > 1, ...)`, but `status=BLOCKED` is a
*returned* result (not a thrown error), so the retry loop `break`s immediately — attempt
never reaches 2, so `forceRefresh=true` never kicks in to bypass the cooldown. Result:
once stamped, the whole fleet stays suppressed for 24h with zero real fetch attempts.

**Diagnosis signal:** if ALL competitors flip to `BLOCKED_BY_PLATFORM` within the *same
minute*, that is a shared contention / rate-limit / global-timeout event (e.g. a heavy
concurrent workload saturating CPU / Bright Data quota), NOT 10 independent genuine
platform blocks. Confirm transport is actually fine by calling `fetchCompetitorData`
with `forceRefresh=true` (bypasses the cooldown gate) — a clean 200 + posts proves the
block was spurious.

**How to apply:** to check freshness health, query
`ci_competitors.fetch_method` + `last_checked_at` for the campaign first. A wall of
`BLOCKED_BY_PLATFORM` all stamped together = self-inflicted cooldown, not a real block.
Distinct from the DB-persisted per-target `scrape_target_backoff` table (streak/cooldown)
and from the in-memory `target-backoff.ts` LRU — this one lives on the competitor row.
