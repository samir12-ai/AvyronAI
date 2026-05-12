-- noTransaction
-- Seal #7 (Task #25 / F10.1) — Replaces migration 012's blocking indexes
-- with CREATE INDEX CONCURRENTLY IF NOT EXISTS so they can be applied to a
-- live production table without an ACCESS EXCLUSIVE lock blocking writes.
--
-- Migration 012 used CREATE INDEX (without CONCURRENTLY). On a busy
-- video_projects / portfolio_posts table that's a multi-second writer block.
-- These statements are idempotent — if 012 already created the index they
-- are no-ops; if 012 hasn't run yet the index is built without blocking.
--
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction → noTransaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_video_projects_account_id
  ON video_projects (account_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_photographer_profiles_account_id
  ON photographer_profiles (account_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_portfolio_posts_account_id
  ON portfolio_posts (account_id, photographer_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reservations_account_id
  ON reservations (account_id, photographer_id);
