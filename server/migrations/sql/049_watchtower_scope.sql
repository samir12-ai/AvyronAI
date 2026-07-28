-- Migration 049: Watchtower market-level scope columns
-- Adds scope classification and competitor count to confirmed pipeline_change_events.
-- scope: single_competitor | several_competitors | market_wide | null (unscoped / legacy rows)
-- scope_competitor_count: how many distinct competitors for this campaign confirmed the same
--   change kind within the 60-day look-back window at the time of promotion.

ALTER TABLE pipeline_change_events
  ADD COLUMN IF NOT EXISTS scope text,
  ADD COLUMN IF NOT EXISTS scope_competitor_count integer;
