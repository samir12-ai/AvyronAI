-- 061: Strategy Root Reuse Lineage
-- Add reused_from_root_id and source_root_id to strategy_roots table to support 
-- identical Strategy Root reuse without mutating historical runIds.
ALTER TABLE strategy_roots ADD COLUMN IF NOT EXISTS reused_from_root_id varchar(255);
ALTER TABLE strategy_roots ADD COLUMN IF NOT EXISTS source_root_id varchar(255);
