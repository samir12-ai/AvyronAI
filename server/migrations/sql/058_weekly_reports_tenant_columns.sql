-- 058: weekly_reports was a legacy single-tenant table — the GET route
-- returned every tenant's rows. Add tenant columns so reads can be scoped.
-- Table is empty in all environments (verified 2026-08-07), so no backfill
-- is required; columns are added NOT NULL-safe (nullable) and the reader
-- filters on them, which naturally excludes any hypothetical legacy row.
ALTER TABLE weekly_reports ADD COLUMN IF NOT EXISTS account_id varchar;
ALTER TABLE weekly_reports ADD COLUMN IF NOT EXISTS campaign_id varchar;
CREATE INDEX IF NOT EXISTS weekly_reports_tenant_idx ON weekly_reports (account_id, campaign_id, created_at);
