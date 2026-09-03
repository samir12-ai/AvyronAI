
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS campaign_id TEXT;
CREATE INDEX IF NOT EXISTS conversations_tenant_campaign_idx ON conversations(account_id, campaign_id, updated_at DESC);
