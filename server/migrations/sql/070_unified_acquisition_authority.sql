-- 070_unified_acquisition_authority.sql
-- Consolidates Avyron's external-data acquisition architecture under one durable authority:
-- 1. Expands acquisition_tasks with provider, run, cost, error, cursor, and heartbeat lineage.
-- 2. Creates acquisition_requests (records every consumer request, cache hit, and joined in-flight task).
-- 3. Creates acquisition_attempts (persists provider_run_id immediately before polling).
-- 4. Creates raw_acquisition_observations (retains raw provider payloads for replay/re-normalization).
-- 5. Adds lineage columns to normalized evidence tables.
-- 6. Deduplicates historical YouTube post_youtube_* vs post_yt_* records while preserving evidence_manifests references.
-- 7. Backfills source_id on ci_competitor_posts and ci_competitor_reviews and adds review uniqueness index.

-- 1. Extend acquisition_tasks
ALTER TABLE acquisition_tasks
  ADD COLUMN IF NOT EXISTS source_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS canonical_url TEXT,
  ADD COLUMN IF NOT EXISTS external_account_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS capability VARCHAR(64),
  ADD COLUMN IF NOT EXISTS provider VARCHAR(32) DEFAULT 'apify',
  ADD COLUMN IF NOT EXISTS actor_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS provider_run_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS dataset_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS usage_usd DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS terminal_outcome VARCHAR(64),
  ADD COLUMN IF NOT EXISTS error_code VARCHAR(64),
  ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pagination_cursor JSONB,
  ADD COLUMN IF NOT EXISTS time_window_days INTEGER,
  ADD COLUMN IF NOT EXISTS item_limit INTEGER,
  ADD COLUMN IF NOT EXISTS freshness_ttl_sec INTEGER,
  ADD COLUMN IF NOT EXISTS content_fingerprint VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_acq_tasks_retry
  ON acquisition_tasks (status, next_retry_at, priority);

CREATE INDEX IF NOT EXISTS idx_acq_tasks_run_id
  ON acquisition_tasks (provider_run_id)
  WHERE provider_run_id IS NOT NULL;

-- 2. Create acquisition_requests
CREATE TABLE IF NOT EXISTS acquisition_requests (
  id VARCHAR(128) PRIMARY KEY,
  account_id VARCHAR(128) NOT NULL,
  campaign_id VARCHAR(128) NOT NULL,
  requester_engine VARCHAR(64) NOT NULL,
  trigger VARCHAR(64) NOT NULL,
  parent_job_id VARCHAR(128),
  strategy_version INTEGER,
  monitoring_cycle_id VARCHAR(128),
  performance_cycle_id VARCHAR(128),
  entity_type VARCHAR(32) NOT NULL,
  entity_id VARCHAR(128) NOT NULL,
  source_id VARCHAR(128),
  platform VARCHAR(32) NOT NULL,
  canonical_url TEXT,
  external_account_id VARCHAR(128),
  capability VARCHAR(64) NOT NULL,
  time_window_days INTEGER,
  item_limit INTEGER,
  freshness_ttl_sec INTEGER,
  task_id VARCHAR(128),
  attempt_id VARCHAR(128),
  resolution_type VARCHAR(32) NOT NULL DEFAULT 'FRESH_FETCH',
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  terminal_outcome VARCHAR(64),
  provider VARCHAR(32),
  actor_id VARCHAR(128),
  provider_run_id VARCHAR(128),
  dataset_id VARCHAR(128),
  observation_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  normalized_evidence_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  items_stored INTEGER NOT NULL DEFAULT 0,
  consumer_delivery_status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  consumer_delivery_detail JSONB,
  error_code VARCHAR(64),
  error_message TEXT,
  retry_decision VARCHAR(64),
  usage_usd DOUBLE PRECISION,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_acq_req_campaign
  ON acquisition_requests (account_id, campaign_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_acq_req_task
  ON acquisition_requests (task_id);

CREATE INDEX IF NOT EXISTS idx_acq_req_entity
  ON acquisition_requests (account_id, entity_type, entity_id, platform);

-- 3. Create acquisition_attempts
CREATE TABLE IF NOT EXISTS acquisition_attempts (
  id VARCHAR(128) PRIMARY KEY,
  task_id VARCHAR(128) NOT NULL,
  account_id VARCHAR(128) NOT NULL,
  campaign_id VARCHAR(128) NOT NULL,
  attempt_number INTEGER NOT NULL DEFAULT 1,
  provider VARCHAR(32) NOT NULL,
  actor_id VARCHAR(128),
  provider_run_id VARCHAR(128),
  dataset_id VARCHAR(128),
  input_hash VARCHAR(64),
  sanitized_input JSONB,
  status VARCHAR(32) NOT NULL DEFAULT 'STARTING',
  error_code VARCHAR(64),
  error_message TEXT,
  retry_decision VARCHAR(64),
  raw_item_count INTEGER NOT NULL DEFAULT 0,
  accepted_item_count INTEGER NOT NULL DEFAULT 0,
  usage_usd DOUBLE PRECISION,
  duration_ms INTEGER,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_acq_attempts_task
  ON acquisition_attempts (task_id, attempt_number);

CREATE INDEX IF NOT EXISTS idx_acq_attempts_run
  ON acquisition_attempts (provider_run_id)
  WHERE provider_run_id IS NOT NULL;

-- 4. Create raw_acquisition_observations
CREATE TABLE IF NOT EXISTS raw_acquisition_observations (
  id VARCHAR(128) PRIMARY KEY,
  account_id VARCHAR(128) NOT NULL,
  campaign_id VARCHAR(128) NOT NULL,
  task_id VARCHAR(128) NOT NULL,
  attempt_id VARCHAR(128) NOT NULL,
  provider_run_id VARCHAR(128),
  entity_type VARCHAR(32) NOT NULL,
  entity_id VARCHAR(128) NOT NULL,
  source_id VARCHAR(128),
  platform VARCHAR(32) NOT NULL,
  capability VARCHAR(64) NOT NULL,
  canonical_url TEXT,
  content_hash VARCHAR(64) NOT NULL,
  item_count INTEGER NOT NULL DEFAULT 0,
  raw_payload JSONB NOT NULL,
  coverage_status VARCHAR(32) NOT NULL DEFAULT 'COMPLETE',
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_raw_obs_task
  ON raw_acquisition_observations (task_id);

CREATE INDEX IF NOT EXISTS idx_raw_obs_entity
  ON raw_acquisition_observations (account_id, campaign_id, entity_type, entity_id, platform);

-- 5. Add lineage columns to normalized tables
ALTER TABLE ci_competitor_posts
  ADD COLUMN IF NOT EXISTS acquisition_task_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS provider_run_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS observation_id VARCHAR(128);

ALTER TABLE ci_competitor_comments
  ADD COLUMN IF NOT EXISTS acquisition_task_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS provider_run_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS observation_id VARCHAR(128);

ALTER TABLE ci_competitor_reviews
  ADD COLUMN IF NOT EXISTS acquisition_task_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS provider_run_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS observation_id VARCHAR(128);

ALTER TABLE owned_posts
  ADD COLUMN IF NOT EXISTS acquisition_task_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS provider_run_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS observation_id VARCHAR(128);

-- 6. Deduplicate historical YouTube posts (post_youtube_* vs post_yt_*)
-- Step 6a: Enrich surviving bare video ID rows (post_youtube_*) with non-null fields from duplicate post_yt_* rows
UPDATE ci_competitor_posts canon
SET
  source_id = COALESCE(canon.source_id, dup.source_id),
  likes = COALESCE(canon.likes, dup.likes),
  comments = COALESCE(canon.comments, dup.comments),
  views = COALESCE(canon.views, dup.views),
  permalink = COALESCE(canon.permalink, dup.permalink),
  hook_text = COALESCE(canon.hook_text, dup.hook_text)
FROM ci_competitor_posts dup
WHERE canon.competitor_id = dup.competitor_id
  AND LOWER(canon.platform) = 'youtube'
  AND LOWER(dup.platform) = 'youtube'
  AND dup.post_id = 'yt_' || canon.post_id
  AND canon.id <> dup.id;

-- Step 6b: Rewrite evidence_manifests.included_post_ids so any reference to a duplicate post_yt_* row ID
-- points to the canonical post_youtube_* row ID (and deduplicates the JSON array).
UPDATE evidence_manifests em
SET included_post_ids = COALESCE(
  (
    SELECT jsonb_agg(DISTINCT COALESCE(canon.id, elem_val))
    FROM jsonb_array_elements_text(em.included_post_ids) AS elem(elem_val)
    LEFT JOIN ci_competitor_posts dup
      ON dup.id = elem.elem_val
      AND LOWER(dup.platform) = 'youtube'
      AND dup.post_id LIKE 'yt_%'
    LEFT JOIN ci_competitor_posts canon
      ON canon.competitor_id = dup.competitor_id
      AND LOWER(canon.platform) = 'youtube'
      AND canon.post_id = SUBSTRING(dup.post_id FROM 4)
      AND canon.id <> dup.id
  ),
  '[]'::jsonb
)
WHERE jsonb_typeof(em.included_post_ids) = 'array'
  AND jsonb_array_length(em.included_post_ids) > 0;

-- Step 6c: Also migrate any competitor_post_classifications referencing duplicate post_yt_* rows
DELETE FROM competitor_post_classifications cpc
USING ci_competitor_posts dup, ci_competitor_posts canon
WHERE cpc.post_id = dup.id
  AND canon.competitor_id = dup.competitor_id
  AND LOWER(canon.platform) = 'youtube'
  AND LOWER(dup.platform) = 'youtube'
  AND dup.post_id = 'yt_' || canon.post_id
  AND canon.id <> dup.id
  AND EXISTS (
    SELECT 1 FROM competitor_post_classifications cpc2
    WHERE cpc2.post_id = canon.id AND cpc2.classifier_version = cpc.classifier_version
  );

UPDATE competitor_post_classifications cpc
SET post_id = canon.id
FROM ci_competitor_posts dup, ci_competitor_posts canon
WHERE cpc.post_id = dup.id
  AND canon.competitor_id = dup.competitor_id
  AND LOWER(canon.platform) = 'youtube'
  AND LOWER(dup.platform) = 'youtube'
  AND dup.post_id = 'yt_' || canon.post_id
  AND canon.id <> dup.id;

-- Step 6d: Delete duplicate post_yt_* rows where canonical bare post_id row exists
DELETE FROM ci_competitor_posts dup
USING ci_competitor_posts canon
WHERE canon.competitor_id = dup.competitor_id
  AND LOWER(canon.platform) = 'youtube'
  AND LOWER(dup.platform) = 'youtube'
  AND dup.post_id = 'yt_' || canon.post_id
  AND canon.id <> dup.id;

-- Step 6e: For any remaining post_yt_* rows that had no bare counterpart, strip 'yt_' prefix from post_id
UPDATE ci_competitor_posts p
SET post_id = SUBSTRING(p.post_id FROM 4)
WHERE LOWER(p.platform) = 'youtube'
  AND p.post_id LIKE 'yt_%'
  AND NOT EXISTS (
    SELECT 1 FROM ci_competitor_posts other
    WHERE other.competitor_id = p.competitor_id
      AND other.post_id = SUBSTRING(p.post_id FROM 4)
      AND other.id <> p.id
  );

-- 7. Backfill source_id on ci_competitor_posts and ci_competitor_reviews where null
UPDATE ci_competitor_posts p
SET source_id = cs.id
FROM competitor_sources cs
WHERE p.source_id IS NULL
  AND p.competitor_id = cs.competitor_id
  AND UPPER(p.platform) = UPPER(cs.platform);

UPDATE ci_competitor_reviews r
SET source_id = cs.id
FROM competitor_sources cs
WHERE r.source_id IS NULL
  AND r.competitor_id = cs.competitor_id
  AND (
    UPPER(r.platform) = UPPER(cs.platform)
    OR (UPPER(r.platform) IN ('TRUSTPILOT', 'GOOGLE', 'GOOGLE_REVIEWS') AND UPPER(cs.platform) = 'REVIEWS')
  );

-- 8. Deduplicate ci_competitor_reviews by (competitor_id, platform, review_id) and add unique index
DELETE FROM ci_competitor_reviews r1
USING ci_competitor_reviews r2
WHERE r1.competitor_id = r2.competitor_id
  AND r1.platform = r2.platform
  AND r1.review_id IS NOT NULL
  AND r1.review_id = r2.review_id
  AND r1.id > r2.id;

CREATE UNIQUE INDEX IF NOT EXISTS uidx_ci_reviews_comp_plat_revid
  ON ci_competitor_reviews (competitor_id, platform, review_id)
  WHERE review_id IS NOT NULL;
