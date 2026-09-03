-- Phase 4: Lane-Scoped Downstream Snapshots
-- Adds nullable lane_id to funnel_snapshots, persuasion_snapshots, and awareness_snapshots

ALTER TABLE funnel_snapshots ADD COLUMN IF NOT EXISTS lane_id VARCHAR;
ALTER TABLE persuasion_snapshots ADD COLUMN IF NOT EXISTS lane_id VARCHAR;
ALTER TABLE awareness_snapshots ADD COLUMN IF NOT EXISTS lane_id VARCHAR;

CREATE INDEX IF NOT EXISTS funnel_snapshots_job_lane_idx ON funnel_snapshots (job_id, lane_id);
CREATE INDEX IF NOT EXISTS persuasion_snapshots_job_lane_idx ON persuasion_snapshots (job_id, lane_id);
CREATE INDEX IF NOT EXISTS awareness_snapshots_job_lane_idx ON awareness_snapshots (job_id, lane_id);
