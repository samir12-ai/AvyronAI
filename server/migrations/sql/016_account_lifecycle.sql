-- Seal #7 (Task #25 / F9.9) — GDPR account-lifecycle tables.
--
-- Three tables:
--
-- 1. account_tombstones — soft-delete record. cascadeDeleteAccount() inserts
--    a row here, masks PII on `users` immediately, and the daily reaper job
--    permanently deletes ~30 days later. Gives users a 30-day undo window
--    that satisfies GDPR Article 17 right-to-erasure (immediate masking) AND
--    operational sanity (we can recover from accidental deletion).
--
-- 2. audit_log_archive — write-only audit trail for cascade-delete events.
--    Lives OUTSIDE the cascade walk so the historical record survives the
--    deletion of the row it describes. Required for Article 30 records of
--    processing activities.
--
-- 3. account_delete_confirmations — one-shot confirmation tokens minted by
--    POST /api/account/delete-confirm. The token must be presented in the
--    X-Account-Delete-Confirm header alongside DELETE /api/account, with a
--    fresh password. Tokens expire after 10 minutes — defends against CSRF
--    even though the route is JWT-gated.

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

CREATE TABLE IF NOT EXISTS account_delete_confirmations (
  id            VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    VARCHAR NOT NULL,
  user_id       VARCHAR NOT NULL,
  token_hash    TEXT NOT NULL,                   -- bcrypt of confirmation token
  issued_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  consumed_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_account_delete_confirmations_lookup
  ON account_delete_confirmations (account_id, expires_at);
