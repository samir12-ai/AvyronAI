
CREATE TABLE IF NOT EXISTS brand_assets (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  account_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  asset_url TEXT NOT NULL,
  asset_name TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS brand_assets_tenant_type_idx ON brand_assets(account_id, campaign_id, asset_type);
CREATE INDEX IF NOT EXISTS brand_assets_campaign_created_idx ON brand_assets(campaign_id, created_at DESC);

CREATE TABLE IF NOT EXISTS generated_creatives (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  account_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  generation_type TEXT NOT NULL,
  source_task_id TEXT,
  source_lane_id TEXT,
  source_strategy_root_id TEXT,
  platform TEXT NOT NULL DEFAULT 'Instagram',
  format TEXT NOT NULL DEFAULT 'Post',
  prompt TEXT NOT NULL,
  content TEXT,
  media_url TEXT,
  brand_asset_ids JSONB DEFAULT '[]'::jsonb,
  reference_asset_ids JSONB DEFAULT '[]'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS generated_creatives_tenant_type_idx ON generated_creatives(account_id, campaign_id, generation_type);
CREATE INDEX IF NOT EXISTS generated_creatives_campaign_created_idx ON generated_creatives(campaign_id, created_at DESC);
