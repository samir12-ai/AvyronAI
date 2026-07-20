-- W-1 follow-up (architect review): make candidate creation idempotent.
-- Replaces the non-unique 042 index with a UNIQUE partial index so at most
-- one open candidate exists per (competitor, campaign, kind). Multi-replica
-- or duplicate boss executions then dedupe at the DB level via
-- onConflictDoNothing (same pattern as P-1 performance_snapshots idempotency).
-- Legacy rows (competitor_id IS NULL) are excluded by the predicate.

DROP INDEX IF EXISTS idx_pce_competitor_kind_unconfirmed;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pce_open_candidate
  ON pipeline_change_events (competitor_id, campaign_id, kind)
  WHERE validated_at IS NULL AND competitor_id IS NOT NULL;
