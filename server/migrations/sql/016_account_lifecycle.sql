-- Seal #7 (Task #25 / F9.9) — GDPR account-lifecycle tables.
-- account_tombstones: soft-delete record + 30-day reaper-after stamp.
-- audit_log_archive: write-only trail (lives outside cascade walk).

CREATE TABLE IF NOT EXISTS account_tombstones (
  account_id      VARCHAR PRIMARY KEY,
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  requested_by    VARCHAR,                       -- user id from JWT
  reaper_after    TIMESTAMPTZ NOT NULL,          -- requested_at + 30 days
  state           TEXT NOT NULL DEFAULT 'pending', -- pending | reaped | cancelled
  reaped_at       TIMESTAMPTZ,
  cascade_summary TEXT                           -- JSON: rows deleted per table
);

CREATE INDEX IF NOT EXISTS idx_account_tombstones_reaper_after
  ON account_tombstones (state, reaper_after);

CREATE TABLE IF NOT EXISTS audit_log_archive (
  id           VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   VARCHAR NOT NULL,
  user_id      VARCHAR,
  event_type   TEXT NOT NULL,
  event_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_hash      TEXT,
  user_agent   TEXT,
  details      TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_log_archive_account_event
  ON audit_log_archive (account_id, event_at DESC);

DROP TABLE IF EXISTS account_delete_confirmations;
