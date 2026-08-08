-- 059: Build-plan results are derived from a specific orchestrator run.
-- Legacy rows cannot prove that lineage, so they remain unreadable by the
-- canonical run-scoped endpoint rather than being guessed onto a new run.
ALTER TABLE build_plan_snapshots ADD COLUMN IF NOT EXISTS job_id varchar;
CREATE INDEX IF NOT EXISTS build_plan_snapshots_run_idx
  ON build_plan_snapshots (account_id, campaign_id, job_id, created_at DESC);