-- Seal #10 / Task #28 / F8.3, F8.4
-- Optimistic locking for strategic_plans + plan_approvals. Every UPDATE
-- must include WHERE version=? and SET version=version+1; if the affected
-- row count is zero the writer must throw CONCURRENT_MODIFICATION instead
-- of silently overwriting a concurrent edit.

ALTER TABLE strategic_plans
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

ALTER TABLE plan_approvals
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
