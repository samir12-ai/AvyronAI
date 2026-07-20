-- P-2 Phase 3 + 4: Deterministic content scoring + weekly business outcome scoring.
--
-- WHY: The scoring truth is produced by code (Phase 3) and the weekly manual
-- inputs are a separate truth layer (Phase 4). Both must persist append-only
-- history (Check 10) with full evidence references, scorer versions, and
-- honest NULL semantics.
--
-- Design constraints (carried from Phase 1 architect gate):
--   * All metric/derived columns NULLABLE with NO defaults. NULL = not
--     computable (missing denominator / missing input), 0 = a real zero.
--   * Rows are append-only score runs — a re-score inserts new rows keyed by
--     score_run_id; previous runs stay queryable.
--   * paying_customers is a COUNT entered by the user. It is NEVER derived
--     from the legacy paid_active boolean (D4: legacy fields may not satisfy
--     contracts).

-- ---------------------------------------------------------------------------
-- Phase 3 — per-dimension-value content score rows.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS owned_content_scores (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id varchar NOT NULL,
  campaign_id varchar NOT NULL,
  platform text NOT NULL,
  score_run_id varchar NOT NULL,
  dimension text NOT NULL,
  dimension_value text NOT NULL,
  sample_size integer NOT NULL,
  included_post_ids text NOT NULL,      -- JSON array of owned_posts.id
  snapshot_ids text NOT NULL,           -- JSON array of owned_post_snapshots.id
  maturity text NOT NULL,
  primary_metric text,                  -- NULL when no usable metric (verdict UNKNOWN)
  baseline_value double precision,      -- NULL when baseline unavailable
  baseline_sample_size integer,
  baseline_window_days integer,
  baseline_version text,
  measured_value double precision,
  absolute_delta double precision,
  relative_delta double precision,
  consistency double precision,         -- fraction of cohort on the same side as the mean
  outlier_concentration double precision, -- top post's share of the summed metric
  confounders text NOT NULL DEFAULT '[]', -- JSON array of strings
  confidence double precision,
  verdict text NOT NULL,
  scorer_version text NOT NULL,
  scored_at timestamp NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE owned_content_scores DROP CONSTRAINT IF EXISTS owned_content_scores_dimension_check;
ALTER TABLE owned_content_scores ADD CONSTRAINT owned_content_scores_dimension_check
  CHECK (dimension IN ('hook_style', 'content_angle', 'content_type'));

ALTER TABLE owned_content_scores DROP CONSTRAINT IF EXISTS owned_content_scores_verdict_check;
ALTER TABLE owned_content_scores ADD CONSTRAINT owned_content_scores_verdict_check
  CHECK (verdict IN ('WINNING', 'NEUTRAL', 'UNDERPERFORMING', 'TESTING', 'UNKNOWN'));

ALTER TABLE owned_content_scores DROP CONSTRAINT IF EXISTS owned_content_scores_maturity_check;
ALTER TABLE owned_content_scores ADD CONSTRAINT owned_content_scores_maturity_check
  CHECK (maturity IN ('MATURE_7D', 'PROVISIONAL_72H', 'EARLY_24H', 'OBSERVED_LATE', 'IMMATURE', 'UNKNOWN'));

CREATE INDEX IF NOT EXISTS owned_content_scores_campaign_idx
  ON owned_content_scores (account_id, campaign_id, platform, dimension, scored_at);
CREATE INDEX IF NOT EXISTS owned_content_scores_run_idx
  ON owned_content_scores (score_run_id);

-- ---------------------------------------------------------------------------
-- Phase 4 — weekly business outcome score rows.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS weekly_business_scores (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id varchar NOT NULL,
  campaign_id varchar NOT NULL,
  score_run_id varchar NOT NULL,
  window_id varchar NOT NULL,           -- FK-shaped to pipeline_eval_windows.id
  truth_id varchar,                     -- FK-shaped to pipeline_user_truth.id (evidence)
  window_index integer NOT NULL,
  plan_id varchar,
  window_start timestamp NOT NULL,
  window_end timestamp NOT NULL,
  -- Raw weekly outcomes as entered. NULL = not provided (never coerced to 0).
  leads integer,
  qualified integer,
  booked integer,
  paying_customers integer,             -- count from user input; NEVER from paid_active
  paid_active boolean,                  -- legacy display-only echo (D4)
  -- Honest conversion rates: NULL whenever the denominator is missing or 0.
  lead_to_qualified_rate double precision,
  qualified_to_booked_rate double precision,
  booked_to_paying_rate double precision,
  lead_to_paying_rate double precision,
  -- Week-over-week relative deltas vs previous scored week. NULL = no prior week.
  wow_delta_leads double precision,
  wow_delta_qualified double precision,
  wow_delta_booked double precision,
  wow_delta_paying double precision,
  -- Trailing self-baseline (JSON: per-stage trailing means + weeks used).
  baseline text,
  baseline_weeks integer,
  business_verdict text NOT NULL,
  verdict_reason text,
  attribution_confidence text NOT NULL,
  attribution_basis text,
  missing_fields text NOT NULL DEFAULT '[]',  -- JSON array of field names
  scorer_version text NOT NULL,
  scored_at timestamp NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE weekly_business_scores DROP CONSTRAINT IF EXISTS weekly_business_scores_verdict_check;
ALTER TABLE weekly_business_scores ADD CONSTRAINT weekly_business_scores_verdict_check
  CHECK (business_verdict IN ('WORKING', 'DRIFTING', 'UNKNOWN'));

ALTER TABLE weekly_business_scores DROP CONSTRAINT IF EXISTS weekly_business_scores_attribution_check;
ALTER TABLE weekly_business_scores ADD CONSTRAINT weekly_business_scores_attribution_check
  CHECK (attribution_confidence IN ('DIRECT', 'SUPPORTED', 'CORRELATED', 'UNKNOWN'));

CREATE INDEX IF NOT EXISTS weekly_business_scores_campaign_idx
  ON weekly_business_scores (account_id, campaign_id, window_index, scored_at);
CREATE INDEX IF NOT EXISTS weekly_business_scores_window_idx
  ON weekly_business_scores (window_id);

-- ---------------------------------------------------------------------------
-- Phase 4D — optional minimal source input on the weekly truth form.
-- All columns NULLABLE, never required for submission. attribution_known is
-- tri-state: NULL = user did not answer, true/false = explicit answer.
-- ---------------------------------------------------------------------------
ALTER TABLE pipeline_user_truth ADD COLUMN IF NOT EXISTS paying_customers integer;
ALTER TABLE pipeline_user_truth ADD COLUMN IF NOT EXISTS lead_source text;
ALTER TABLE pipeline_user_truth ADD COLUMN IF NOT EXISTS related_campaign text;
ALTER TABLE pipeline_user_truth ADD COLUMN IF NOT EXISTS related_post_url text;
ALTER TABLE pipeline_user_truth ADD COLUMN IF NOT EXISTS lead_channel text;
ALTER TABLE pipeline_user_truth ADD COLUMN IF NOT EXISTS attribution_known boolean;

COMMENT ON COLUMN pipeline_user_truth.paying_customers IS
  'Optional COUNT of paying customers for the week. Distinct from paid_active (boolean); scorers MUST NOT derive this count from paid_active.';
COMMENT ON COLUMN owned_content_scores.confounders IS
  'JSON array of confounder tags (e.g. format_mix, maturity_mix, outlier_post, follower_shift, low_sample).';
COMMENT ON COLUMN weekly_business_scores.baseline IS
  'JSON: trailing self-baseline per funnel stage ({leads, qualified, booked, paying, weeksUsed}); values NULL when history insufficient.';
