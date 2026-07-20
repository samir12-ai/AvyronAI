-- P-2 Phase 2: Owned-page post tracking (scraping-first Performance Loop).
--
-- WHY: user_channel_snapshots stores ONLY channel aggregates (postCount,
-- followers, recentPostTypes) — the per-post fields the Instagram scraper
-- already fetches (postId, permalink, caption, likes, comments, views,
-- timestamp) were discarded for owned channels. The Performance Loop needs
-- per-post records + append-only checkpoint observations.
--
-- Architect-mandated design constraints (Phase 1 gate, 2026-07-20):
--   * NEW tables. Do NOT reuse ci_competitor_posts (competitor_id-scoped;
--     reuse would force a synthetic "self competitor" row and pollute every
--     competitor-scoped reader) and do NOT reuse performance_snapshots
--     (authenticated-Meta vocabulary + `.default(0)` columns that would
--     silently coerce unmeasured public metrics to zero — NULL-never-zero
--     violation).
--   * All metric columns NULLABLE with NO defaults. NULL = not observed,
--     0 = platform showed 0. (B1: truthfulness over confidence.)
--   * Ownership scoping: account_id + campaign_id + owned_profile_id
--     (FK-shaped to user_public_profiles). No cross-tenant reuse.
--
-- Checkpoint semantics: rows are append-only observations. checkpoint is a
-- BAND label; observation_age_hours always records the ACTUAL age at
-- observation (never faked to the nominal checkpoint):
--   'discovery'   — observed at age < 12h (too early for the 24h band)
--   '24h'         — observed at age [12h, 48h)
--   '72h'         — observed at age [48h, 132h)
--   '7d'          — observed at age [132h, 240h)
--   'late'        — first/subsequent observation at age >= 240h
--   'unknown_age' — platform publish timestamp unavailable
-- UNIQUE (owned_post_id, checkpoint) over the scheduled bands makes capture
-- idempotent via INSERT ... ON CONFLICT DO NOTHING (MULTI-REPLICA-SAFE).

CREATE TABLE IF NOT EXISTS owned_posts (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id varchar NOT NULL,
  campaign_id varchar NOT NULL,
  owned_profile_id varchar NOT NULL,
  platform text NOT NULL,
  post_id text NOT NULL,
  shortcode text,
  permalink text,
  media_type text,
  caption text,
  hashtags text,
  hook_text text,
  posted_at timestamp,
  first_seen_at timestamp NOT NULL DEFAULT now(),
  last_seen_at timestamp,
  -- Lineage (D2: canonical field, D3-style CHECK; resolver is sole writer).
  lineage_state text NOT NULL DEFAULT 'unmatched',
  match_method text,
  match_confidence double precision,
  matched_published_post_id varchar,
  matched_plan_id varchar,
  matched_calendar_entry_id varchar,
  matched_studio_item_id varchar,
  lineage_resolved_at timestamp,
  -- Plan-derived dimensions — populated ONLY from a supported lineage match
  -- (planned_direct / planned_matched). Never inferred from the caption.
  hook_style text,
  content_angle text,
  content_type text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE owned_posts DROP CONSTRAINT IF EXISTS owned_posts_lineage_state_check;
ALTER TABLE owned_posts ADD CONSTRAINT owned_posts_lineage_state_check
  CHECK (lineage_state IN ('planned_direct', 'planned_matched', 'manual_matched', 'unplanned', 'ambiguous', 'unmatched'));

CREATE UNIQUE INDEX IF NOT EXISTS owned_posts_profile_postid_uidx
  ON owned_posts (owned_profile_id, post_id);
CREATE INDEX IF NOT EXISTS owned_posts_campaign_idx
  ON owned_posts (account_id, campaign_id, platform);

CREATE TABLE IF NOT EXISTS owned_post_snapshots (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id varchar NOT NULL,
  campaign_id varchar NOT NULL,
  owned_post_id varchar NOT NULL,
  checkpoint text NOT NULL,
  observed_at timestamp NOT NULL,
  -- ACTUAL age of the post at observation (hours). NULL only when the
  -- platform publish timestamp is unknown (checkpoint = 'unknown_age').
  observation_age_hours double precision,
  -- Public metrics: NULLABLE, NO DEFAULTS. NULL = not visible on the public
  -- surface at observation time; 0 = the platform displayed 0.
  likes integer,
  comments integer,
  views integer,
  followers_at_observation integer,
  -- Metric provenance registry (Phase 2D). Authenticated sources may ADD
  -- rows; they must never overwrite public_scrape history.
  metric_source text NOT NULL DEFAULT 'public_scrape',
  -- Provenance link to the user_channel_snapshots row of the scrape run.
  scrape_snapshot_id varchar,
  created_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE owned_post_snapshots DROP CONSTRAINT IF EXISTS owned_post_snapshots_checkpoint_check;
ALTER TABLE owned_post_snapshots ADD CONSTRAINT owned_post_snapshots_checkpoint_check
  CHECK (checkpoint IN ('discovery', '24h', '72h', '7d', 'late', 'unknown_age'));

ALTER TABLE owned_post_snapshots DROP CONSTRAINT IF EXISTS owned_post_snapshots_metric_source_check;
ALTER TABLE owned_post_snapshots ADD CONSTRAINT owned_post_snapshots_metric_source_check
  CHECK (metric_source IN ('public_scrape', 'manual_input', 'authenticated_api'));

-- One row per (post, scheduled checkpoint band, source). discovery/late/
-- unknown_age observations are unlimited append-only history.
CREATE UNIQUE INDEX IF NOT EXISTS owned_post_snapshots_post_checkpoint_uidx
  ON owned_post_snapshots (owned_post_id, checkpoint, metric_source)
  WHERE checkpoint IN ('24h', '72h', '7d');

CREATE INDEX IF NOT EXISTS owned_post_snapshots_post_idx
  ON owned_post_snapshots (owned_post_id, observed_at);

COMMENT ON COLUMN owned_posts.lineage_state IS
  'Canonical lineage verdict: planned_direct (platform ID/direct publish lineage to a plan), planned_matched (high-confidence fingerprint to plan content), manual_matched (fingerprint to non-plan Avyron content), unplanned (confirmed manual publish), ambiguous (competing candidates — stays ambiguous), unmatched (no candidate).';
COMMENT ON COLUMN owned_post_snapshots.observation_age_hours IS
  'ACTUAL post age at observation. checkpoint is a band label; this value is the truth — a post discovered after a checkpoint passed is never relabeled to the nominal checkpoint.';
