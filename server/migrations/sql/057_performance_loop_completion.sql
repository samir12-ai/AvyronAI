-- Migration 057: performance_loop_completion
--
-- Completes the Performance Loop persistence layer:
--   1. owned_post_classifications — strategic-language classification of the
--      user's own scraped posts (adapter over the competitor classifier).
--      Separate from competitor_post_classifications on purpose: that table
--      is keyed to ci_competitor_posts and consumed by Content DNA / MI.
--   2. execution_comparisons — deterministic strategy-vs-actual execution
--      verdicts (code decides status, never the LLM). Append-only per run.
--   3. performance_decision_outcomes — per-decision outcome rows written in
--      the same transaction as cycle verdicts. NOT the legacy ads
--      decision_outcomes table (different lifecycle, two active readers).
--   4. Trust columns on performance_cycle_reports: evidence registry,
--      guard results, judge claims, version stamps, completion time.

CREATE TABLE owned_post_classifications (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id VARCHAR NOT NULL,
  campaign_id VARCHAR NOT NULL,
  owned_post_id VARCHAR NOT NULL,
  platform TEXT NOT NULL,
  status TEXT NOT NULL, -- 'classified' | 'failed'
  failure_reason TEXT,
  primary_hook TEXT,
  hook_archetype TEXT,
  primary_angle TEXT,
  narrative TEXT,
  cta_type TEXT,
  offer_type TEXT,
  emotional_trigger TEXT,
  awareness_stage TEXT,
  positioning_style TEXT,
  content_format_intent TEXT,
  primary_goal TEXT,
  core_marketing_promise TEXT,
  confidence_score DOUBLE PRECISION,
  classifier_version TEXT NOT NULL,
  model_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  source_caption_hash TEXT,
  classified_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX owned_post_classifications_post_version_uniq
  ON owned_post_classifications (owned_post_id, classifier_version);
CREATE INDEX owned_post_classifications_tenant_idx
  ON owned_post_classifications (account_id, campaign_id);

CREATE TABLE execution_comparisons (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id VARCHAR NOT NULL,
  campaign_id VARCHAR NOT NULL,
  comparison_run_id VARCHAR NOT NULL,
  plan_id VARCHAR NOT NULL,
  plan_version TEXT,
  strategy_root_id VARCHAR,
  build_plan_snapshot_id VARCHAR,
  window_id VARCHAR, -- NULL for live (pre-window-close) comparisons
  decision_dimension TEXT NOT NULL,
  decision_value TEXT NOT NULL,
  decision_source TEXT NOT NULL,
  expected_summary TEXT,
  observed_summary TEXT,
  execution_status TEXT NOT NULL, -- EXECUTED | PARTIALLY_EXECUTED | NOT_EXECUTED | UNVERIFIED | BLOCKED | NOT_YET_DUE
  deterministic_reason TEXT NOT NULL,
  evidence_post_ids TEXT NOT NULL DEFAULT '[]',
  lineage_evidence TEXT NOT NULL DEFAULT '[]',
  classification_evidence TEXT NOT NULL DEFAULT '[]',
  matched_post_count INTEGER NOT NULL DEFAULT 0,
  window_post_count INTEGER NOT NULL DEFAULT 0,
  freshness TEXT,
  comparator_version TEXT NOT NULL,
  evaluated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX execution_comparisons_tenant_idx
  ON execution_comparisons (account_id, campaign_id, evaluated_at);
CREATE INDEX execution_comparisons_run_idx
  ON execution_comparisons (comparison_run_id);

CREATE TABLE performance_decision_outcomes (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id VARCHAR NOT NULL,
  campaign_id VARCHAR NOT NULL,
  cycle_report_id VARCHAR NOT NULL,
  cycle_run_id VARCHAR NOT NULL,
  verdict_id VARCHAR NOT NULL,
  window_id VARCHAR NOT NULL,
  window_index INTEGER NOT NULL,
  plan_id VARCHAR NOT NULL,
  plan_version TEXT,
  decision_dimension TEXT NOT NULL,
  decision_value TEXT NOT NULL,
  decision_source TEXT NOT NULL,
  expected_action TEXT NOT NULL,
  execution_status TEXT NOT NULL,
  pre_metrics TEXT,
  post_metrics TEXT,
  content_evidence_ids TEXT NOT NULL DEFAULT '[]',
  business_evidence_ids TEXT NOT NULL DEFAULT '[]',
  attribution_level TEXT,
  outcome TEXT NOT NULL, -- POSITIVE | NEGATIVE | MIXED | INCONCLUSIVE | NOT_EXECUTED
  confidence DOUBLE PRECISION,
  outcome_version TEXT NOT NULL,
  evaluated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX perf_decision_outcomes_window_uniq
  ON performance_decision_outcomes (campaign_id, window_id, decision_dimension, decision_value);
CREATE INDEX perf_decision_outcomes_tenant_idx
  ON performance_decision_outcomes (account_id, campaign_id);

ALTER TABLE performance_cycle_reports
  ADD COLUMN evidence_registry TEXT,
  ADD COLUMN guard_results TEXT,
  ADD COLUMN judge_claims TEXT,
  ADD COLUMN versions TEXT,
  ADD COLUMN completed_at TIMESTAMP;
