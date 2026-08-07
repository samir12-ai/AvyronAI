-- 055_snapshot_included_competitors.sql

ALTER TABLE "mi_snapshots" ADD COLUMN IF NOT EXISTS "included_competitor_ids" text;
