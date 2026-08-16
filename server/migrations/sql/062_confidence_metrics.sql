-- 062: Confidence Metrics
-- Add missing confidence and data reliability columns to snapshot tables to satisfy the 
-- T3.A confidence integrity contract requirements for System Control validation.

ALTER TABLE audience_snapshots ADD COLUMN IF NOT EXISTS confidence_score double precision;
ALTER TABLE audience_snapshots ADD COLUMN IF NOT EXISTS data_reliability text;

ALTER TABLE awareness_snapshots ADD COLUMN IF NOT EXISTS confidence_score double precision;

ALTER TABLE persuasion_snapshots ADD COLUMN IF NOT EXISTS confidence_score double precision;
