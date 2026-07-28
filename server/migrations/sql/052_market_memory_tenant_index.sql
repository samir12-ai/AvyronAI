-- Migration 052: make market_memory dedup index tenant-safe (code review P-4).
-- The fingerprint uniqueness now includes account_id so a hypothetical
-- campaign-id collision across accounts can never suppress another tenant's
-- memory write. All reads are account-scoped in code as well.

DROP INDEX IF EXISTS market_memory_fingerprint_uniq;
CREATE UNIQUE INDEX market_memory_fingerprint_uniq
  ON market_memory (account_id, campaign_id, window_days, fingerprint);
