-- 063: Canonical Monthly Reports
-- Persisted immutable monthly business history for campaigns

CREATE TABLE IF NOT EXISTS monthly_reports (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id VARCHAR NOT NULL,
  campaign_id VARCHAR NOT NULL,
  report_period_year INTEGER NOT NULL,
  report_period_month INTEGER NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
  status VARCHAR(32) NOT NULL DEFAULT 'IN_PROGRESS',
  generated_at TIMESTAMPTZ,
  finalized_at TIMESTAMPTZ,
  strategy_root_ids JSONB DEFAULT '[]'::jsonb,
  root_bundle_versions JSONB DEFAULT '[]'::jsonb,
  strategic_plan_ids JSONB DEFAULT '[]'::jsonb,
  watchtower_event_ids JSONB DEFAULT '[]'::jsonb,
  reasoning_case_ids JSONB DEFAULT '[]'::jsonb,
  adaptive_decision_ids JSONB DEFAULT '[]'::jsonb,
  strategy_change_proposal_ids JSONB DEFAULT '[]'::jsonb,
  strategy_adaptation_lineage_ids JSONB DEFAULT '[]'::jsonb,
  execution_day_ids JSONB DEFAULT '[]'::jsonb,
  execution_task_ids JSONB DEFAULT '[]'::jsonb,
  source_metric_ids JSONB DEFAULT '[]'::jsonb,
  report_payload JSONB DEFAULT '{}'::jsonb,
  generation_version INTEGER NOT NULL DEFAULT 1,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS monthly_reports_tenant_idx ON monthly_reports (account_id, campaign_id);
CREATE UNIQUE INDEX IF NOT EXISTS monthly_reports_period_unique_idx ON monthly_reports (campaign_id, report_period_year, report_period_month);
CREATE INDEX IF NOT EXISTS monthly_reports_status_idx ON monthly_reports (status);
