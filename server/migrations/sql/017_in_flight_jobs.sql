-- Seal #10 / Task #28 / F8.2
-- in_flight_jobs: tracks orchestrator runs whose snapshots must be preserved
-- by the snapshot-cleanup-worker. Cleanup must JOIN against this table and
-- skip any snapshot whose jobId is currently in-flight, even if its
-- (accountId, campaignId, status, age) would otherwise mark it for purge.

CREATE TABLE IF NOT EXISTS in_flight_jobs (
  job_id              varchar PRIMARY KEY,
  account_id          varchar NOT NULL,
  campaign_id         varchar NOT NULL,
  started_at          timestamp NOT NULL DEFAULT now(),
  expected_complete_by timestamp
);

CREATE INDEX IF NOT EXISTS idx_in_flight_jobs_account_campaign
  ON in_flight_jobs (account_id, campaign_id);

CREATE INDEX IF NOT EXISTS idx_in_flight_jobs_started_at
  ON in_flight_jobs (started_at);
