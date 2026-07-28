-- Migration 054: Apify comment acquisition metadata (P-6.12)
--
-- The comment pipeline now runs on the Apify instagram-comment-scraper actor
-- (Bright Data transport retired). New metadata columns:
--   author_type   — 'owner' | 'audience' | 'unknown'. Owner replies are kept
--                   (classified) but excluded from audience evidence reads.
--   likes_count / replies_count — engagement signals the actor provides.
--   actor_run_id  — Apify run id for provenance/cost forensics.
--   filter_status — ACCEPTED | ACCEPTED_OWNER_REPLY | ACCEPTED_LOW_SIGNAL
--                   (rejected comments are never persisted; the run log keeps
--                   rejection counts by reason).
--   filter_reason — machine-readable detail for LOW_SIGNAL acceptances.
-- Historical rows are NOT relabelled: columns stay NULL for pre-migration
-- data (P-6.12 constraint — no retroactive reclassification).

ALTER TABLE ci_competitor_comments
  ADD COLUMN IF NOT EXISTS author_type varchar(16),
  ADD COLUMN IF NOT EXISTS likes_count integer,
  ADD COLUMN IF NOT EXISTS replies_count integer,
  ADD COLUMN IF NOT EXISTS actor_run_id varchar(80),
  ADD COLUMN IF NOT EXISTS filter_status varchar(24),
  ADD COLUMN IF NOT EXISTS filter_reason varchar(40);

-- Dedup guarantee: platform comment IDs are the identity. Historical data has
-- 3 known duplicate (competitor_id, comment_id) pairs — keep the earliest row
-- (created_at, then id as tiebreaker), then enforce uniqueness going forward.
-- Partial index: legacy/synthetic rows with NULL comment_id are exempt.
DELETE FROM ci_competitor_comments a
USING ci_competitor_comments b
WHERE a.comment_id IS NOT NULL
  AND a.competitor_id = b.competitor_id
  AND a.comment_id = b.comment_id
  AND (a.created_at > b.created_at
       OR (a.created_at = b.created_at AND a.id > b.id));

CREATE UNIQUE INDEX IF NOT EXISTS uq_ci_comments_competitor_comment_id
  ON ci_competitor_comments (competitor_id, comment_id)
  WHERE comment_id IS NOT NULL;
