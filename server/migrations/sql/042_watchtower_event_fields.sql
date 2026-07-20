-- W-1 Watchtower event fields for pipeline_change_events.
-- Adds competitor linkage, W-1 kind enum, and two-fetch validation timestamp.
-- Nullable columns — existing rows remain valid (no backfill needed).
-- Idempotent: IF NOT EXISTS on each statement.

ALTER TABLE pipeline_change_events
  ADD COLUMN IF NOT EXISTS competitor_id VARCHAR,
  ADD COLUMN IF NOT EXISTS kind TEXT,
  ADD COLUMN IF NOT EXISTS validated_at TIMESTAMP;

-- Index: fast candidate lookup for the two-fetch confirmation query.
CREATE INDEX IF NOT EXISTS idx_pce_competitor_kind_unconfirmed
  ON pipeline_change_events (competitor_id, campaign_id, kind)
  WHERE validated_at IS NULL AND competitor_id IS NOT NULL;
