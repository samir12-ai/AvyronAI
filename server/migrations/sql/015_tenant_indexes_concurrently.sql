-- noTransaction
-- Seal #7 (Task #25 / F10.1) — Idempotent rebuild of legacy 012's tenant
-- indexes using CREATE INDEX CONCURRENTLY so they can be replaced on a live
-- production table without an ACCESS EXCLUSIVE writer block.
--
-- Strategy (concurrent-swap, idempotent):
--   1. CREATE INDEX CONCURRENTLY IF NOT EXISTS <name>_v2  (no writer block)
--   2. DROP INDEX CONCURRENTLY IF EXISTS <name>           (drops 012's
--      non-concurrent index if present; no-op on fresh DBs)
--   3. ALTER INDEX IF EXISTS <name>_v2 RENAME TO <name>   (atomic, fast)
--
-- After this migration the canonical index name (e.g. idx_video_projects_account_id)
-- always exists and was built CONCURRENTLY. Re-running is a no-op once the
-- canonical name is in place.
--
-- CREATE/DROP INDEX CONCURRENTLY cannot run inside a transaction → noTransaction.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_video_projects_account_id_v2
  ON video_projects (account_id, created_at DESC);
DROP INDEX CONCURRENTLY IF EXISTS idx_video_projects_account_id;
ALTER INDEX IF EXISTS idx_video_projects_account_id_v2 RENAME TO idx_video_projects_account_id;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_photographer_profiles_account_id_v2
  ON photographer_profiles (account_id);
DROP INDEX CONCURRENTLY IF EXISTS idx_photographer_profiles_account_id;
ALTER INDEX IF EXISTS idx_photographer_profiles_account_id_v2 RENAME TO idx_photographer_profiles_account_id;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_portfolio_posts_account_id_v2
  ON portfolio_posts (account_id, photographer_id);
DROP INDEX CONCURRENTLY IF EXISTS idx_portfolio_posts_account_id;
ALTER INDEX IF EXISTS idx_portfolio_posts_account_id_v2 RENAME TO idx_portfolio_posts_account_id;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reservations_account_id_v2
  ON reservations (account_id, photographer_id);
DROP INDEX CONCURRENTLY IF EXISTS idx_reservations_account_id;
ALTER INDEX IF EXISTS idx_reservations_account_id_v2 RENAME TO idx_reservations_account_id;
