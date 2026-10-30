-- Migration 067: Create campaign_budget_settings canonical table
CREATE TABLE IF NOT EXISTS campaign_budget_settings (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id VARCHAR NOT NULL DEFAULT 'default',
  campaign_id VARCHAR NOT NULL,
  monthly_budget NUMERIC(14, 4),
  currency VARCHAR(10),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT campaign_budget_settings_account_campaign_unique UNIQUE (account_id, campaign_id)
);

CREATE INDEX IF NOT EXISTS campaign_budget_settings_lookup_idx
  ON campaign_budget_settings (account_id, campaign_id);
