---
name: Scrape freshness gates come in pairs
description: User-channel scrape freshness is gated at two levels; any status filter (e.g. exclude FAILED) must be applied to both or failures silently suppress retries.
---

# Rule

Freshness for owned-channel scraping is decided in **two places**: an outer campaign-level "do we need a scrape at all" gate and an inner per-profile "is this snapshot fresh" gate. Any semantic filter added to one (e.g. `scrapeStatus IS DISTINCT FROM 'FAILED'` so failures never count as fresh) MUST be mirrored in the other.

**Why:** During P-2 the FAILED-exclusion filter was added only to the inner gate; the outer gate still treated a FAILED snapshot as fresh, so a failure suppressed campaign-level retry for the full pacing interval — quietly contradicting the "failures never suppress retries" doctrine. Caught only in final review.

**How to apply:** When touching snapshot freshness/status semantics, grep for every query that orders `user_channel_snapshots` by `scraped_at` (or any snapshot table by recency) and apply the same status predicate to all of them. Note `scrapeStatus` lives inside the `snapshot_data` JSON, not a column: `(snapshot_data::json->>'scrapeStatus')`.
