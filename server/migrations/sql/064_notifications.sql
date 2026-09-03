
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  account_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  user_id TEXT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'INFO',
  source_entity_type TEXT,
  source_entity_id TEXT,
  target_route TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  read_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notifications_account_campaign_unread_idx ON notifications(account_id, campaign_id, is_read);
CREATE INDEX IF NOT EXISTS notifications_campaign_created_idx ON notifications(campaign_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedup_idx ON notifications(campaign_id, type, source_entity_type, source_entity_id);
