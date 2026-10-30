-- 071_performance_loop_and_scheduler_completion.sql
-- Completes the Performance Loop persistence, reporting-window alignment, and reminder schema:
-- 1. Creates daily_owned_fetch_records (if not exists) for daily 24h owned-channel refresh tracking.
-- 2. Creates weekly_business_inventories (if not exists) for 7-day period business-result collection.
-- 3. Creates task_content_match_lineage (if not exists) for semantic task-to-post matching.
-- 4. Extends clarification_requests with structured baseline fields and reminder tracking.
-- 5. Closes open pipeline_eval_windows belonging to SUPERSEDED strategic_plans so obsolete plans never generate active requests.
-- 6. Restores non-erased retained URL/handle on Songai's LinkedIn user_public_profiles record (chan_1f1dd1d4-a) while preserving UNRESOLVED status.

-- 1. daily_owned_fetch_records
CREATE TABLE IF NOT EXISTS daily_owned_fetch_records (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id VARCHAR NOT NULL,
  campaign_id VARCHAR NOT NULL,
  owned_source_id VARCHAR NOT NULL,
  platform TEXT NOT NULL,
  measurement_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'SUCCESS',
  fetched_post_count INTEGER NOT NULL DEFAULT 0,
  evidence_ref_id TEXT,
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS daily_owned_fetch_dedup_uidx
  ON daily_owned_fetch_records (account_id, campaign_id, owned_source_id, platform, measurement_date);

CREATE INDEX IF NOT EXISTS daily_owned_fetch_campaign_date_idx
  ON daily_owned_fetch_records (campaign_id, measurement_date);

-- 2. weekly_business_inventories
CREATE TABLE IF NOT EXISTS weekly_business_inventories (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id VARCHAR NOT NULL,
  campaign_id VARCHAR NOT NULL,
  plan_id VARCHAR,
  window_id VARCHAR,
  window_index INTEGER,
  currency VARCHAR(16) NOT NULL DEFAULT 'USD',
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  period_label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'WAITING_FOR_USER',
  applicable_metrics_schema JSONB DEFAULT '[]'::jsonb,
  automatic_metrics JSONB DEFAULT '{}'::jsonb,
  submitted_metrics JSONB DEFAULT '{}'::jsonb,
  coverage_status TEXT DEFAULT 'NONE',
  submitted_at TIMESTAMPTZ,
  reminder_count INTEGER NOT NULL DEFAULT 0,
  last_reminded_at TIMESTAMPTZ,
  next_reminder_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE weekly_business_inventories
  ADD COLUMN IF NOT EXISTS plan_id VARCHAR,
  ADD COLUMN IF NOT EXISTS window_id VARCHAR,
  ADD COLUMN IF NOT EXISTS window_index INTEGER,
  ADD COLUMN IF NOT EXISTS currency VARCHAR(16) NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS reminder_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_reminded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_reminder_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS weekly_business_inventories_period_uidx
  ON weekly_business_inventories (account_id, campaign_id, period_start, period_end);

CREATE INDEX IF NOT EXISTS weekly_business_inventories_status_idx
  ON weekly_business_inventories (campaign_id, status);

-- 3. task_content_match_lineage
CREATE TABLE IF NOT EXISTS task_content_match_lineage (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id VARCHAR NOT NULL,
  campaign_id VARCHAR NOT NULL,
  task_id VARCHAR NOT NULL,
  owned_post_id VARCHAR NOT NULL,
  match_score DOUBLE PRECISION NOT NULL,
  matched_dimensions JSONB NOT NULL DEFAULT '[]'::jsonb,
  missing_dimensions JSONB NOT NULL DEFAULT '[]'::jsonb,
  conflicts JSONB NOT NULL DEFAULT '[]'::jsonb,
  match_reason TEXT NOT NULL,
  counted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS task_content_match_lineage_task_post_uidx
  ON task_content_match_lineage (task_id, owned_post_id);

CREATE INDEX IF NOT EXISTS task_content_match_lineage_task_idx
  ON task_content_match_lineage (task_id);

CREATE INDEX IF NOT EXISTS task_content_match_lineage_post_idx
  ON task_content_match_lineage (owned_post_id);

CREATE INDEX IF NOT EXISTS task_content_match_lineage_campaign_idx
  ON task_content_match_lineage (campaign_id);

-- 4. Extend clarification_requests with structured fields and reminder tracking
ALTER TABLE clarification_requests
  ADD COLUMN IF NOT EXISTS request_category VARCHAR(32) NOT NULL DEFAULT 'BASELINE',
  ADD COLUMN IF NOT EXISTS structured_fields JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS structured_answer JSONB,
  ADD COLUMN IF NOT EXISTS reminder_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_reminded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_reminder_at TIMESTAMPTZ;

-- 5. Close open pipeline_eval_windows belonging to SUPERSEDED strategic_plans
UPDATE pipeline_eval_windows pew
SET
  state = CASE WHEN pew.truth_id IS NOT NULL THEN 'closed_with_truth' ELSE 'closed_missing_truth' END,
  closed_at = COALESCE(pew.closed_at, NOW())
FROM strategic_plans sp
WHERE pew.plan_id = sp.id
  AND pew.state = 'open'
  AND sp.status <> 'APPROVED';

-- 6. Restore retained truncated URL on Songai's LinkedIn channel (chan_1f1dd1d4-a) rather than leaving it erased (NULL),
--    while keeping identityStatus = 'UNRESOLVED' in user_channel_snapshots until the user supplies the full slug.
UPDATE user_public_profiles
SET
  handle = 'company',
  url = 'https://linkedin.com/company',
  updated_at = NOW()
WHERE id = 'chan_1f1dd1d4-a'
  AND campaign_id = 'camp_ac86e8b8-55b'
  AND platform = 'linkedin'
  AND handle IS NULL
  AND url IS NULL;
