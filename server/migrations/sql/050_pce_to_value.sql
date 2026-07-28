-- Migration 050: add to_value column to pipeline_change_events
-- Stores the semantic destination (e.g. "Trust", "Urgency") for each confirmed
-- Watchtower event so that market-level scope can require BOTH same kind AND
-- same semantic direction — not just the same change kind.
ALTER TABLE pipeline_change_events ADD COLUMN IF NOT EXISTS to_value text;
