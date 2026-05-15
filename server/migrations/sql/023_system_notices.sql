-- Task #52 follow-up — Operations Guardian (extension layer above the
-- Continuity Supervisor). Adds one table that becomes the single source
-- of truth for "what should the operator/user see right now?"
--
-- Written by the Guardian Interpreter (server/operations-guardian/
-- interpreter.ts), which runs as a step inside the existing Continuity
-- Supervisor tick (every ~5min). NOT a per-event log — one row per
-- (correlation_key, audience) until resolved. The unique partial index
-- collapses repeat observations into last_seen_at bumps; resolution
-- sets resolved_at and frees the slot for the next occurrence.
--
-- audience is set ONCE AT WRITE TIME and never recomputed. It is the
-- firewall that prevents internal vocabulary (stuck claims, watchdog
-- zombies, retry loops) from leaking into customer-visible surfaces.
-- During the observe-only rollout, only audience='operator' is written.

CREATE TABLE IF NOT EXISTS system_notices (
  id                  varchar      PRIMARY KEY DEFAULT gen_random_uuid(),
  category            varchar      NOT NULL,
  severity            varchar      NOT NULL,
  audience            varchar      NOT NULL,
  correlation_key     varchar      NOT NULL,
  account_id          varchar,
  campaign_id         varchar,
  copy_key            varchar      NOT NULL,
  copy_vars           jsonb,
  detail              jsonb,
  first_seen_at       timestamp    NOT NULL DEFAULT NOW(),
  last_seen_at        timestamp    NOT NULL DEFAULT NOW(),
  resolved_at         timestamp,
  suppressed_until    timestamp,
  recovery_attempted  boolean      NOT NULL DEFAULT FALSE,
  recovery_outcome    varchar,
  observation_count   integer      NOT NULL DEFAULT 1
);

-- Partial unique index — at most ONE open notice per (correlation_key,
-- audience). Re-emitting in the next tick bumps last_seen_at +
-- observation_count via ON CONFLICT DO UPDATE; never inserts a dup.
CREATE UNIQUE INDEX IF NOT EXISTS system_notices_open_correlation_unique
  ON system_notices (correlation_key, audience)
  WHERE resolved_at IS NULL;

-- Read-path index for the operator panel ("show me open notices, severity-
-- sorted, newest first").
CREATE INDEX IF NOT EXISTS system_notices_audience_open_idx
  ON system_notices (audience, severity, last_seen_at DESC)
  WHERE resolved_at IS NULL;

-- Read-path index for per-campaign user-facing surfaces (deferred to a
-- later step but indexed now so the column shape is stable).
CREATE INDEX IF NOT EXISTS system_notices_campaign_audience_idx
  ON system_notices (campaign_id, audience)
  WHERE campaign_id IS NOT NULL AND resolved_at IS NULL;
