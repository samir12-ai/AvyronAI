-- Seal #14 / Track #2 — Continuity Supervision Layer.
--
-- Adds three tables that close the four Track #1 audit findings promoted to
-- BLOCKER status (T1-A3 cross-replica idempotency, T1-A5 per-chain lag
-- blindness, plus heartbeat supervision and degraded-state classification):
--
--   1. continuity_window_claims — DB-level idempotency lock per
--      (campaign_id, plan_id, window_index). Replaces the in-process
--      `inFlightTick` Map with a multi-replica-safe claim handshake:
--
--        - Replica tries INSERT ... ON CONFLICT DO NOTHING RETURNING id.
--        - Row returned → that replica owns this window; invoke runBoss.
--        - Conflict (no row) → another replica claimed it; skip with
--          decision=skipped_claimed_by_other_replica.
--        - On boss_run success/partial → UPDATE status='completed',
--          outcome={ok|partial}.
--        - On boss_run failure → DELETE the claim row so the next tick can
--          retry. This preserves INVARIANT-RETRY (Track #1 doctrine):
--          failed/partial runs must NEVER be suppressed.
--
--      Closes audit finding T1-A3.
--
--   2. chain_registry_state — observability state for the 10-chain
--      operational registry. One row per chainId tracking the most-recent
--      observed successful run, the lag, and the classified state
--      (HEALTHY | DEGRADED | DEAD | UNKNOWN). Updated by the continuity
--      supervisor every 5min. Closes audit finding T1-A5.
--
--   3. continuity_supervisor_ticks — paper trail for the supervisor
--      itself. Mirrors continuity_ticks but for the supervisor; a missing
--      row in this table for >2× supervisor interval is the operator-
--      visible signal that the supervisor has stalled (the watcher of
--      the watchers). Drives /healthz/continuity supervisor section.
--
-- All three tables are append-mostly (claims table has UPDATE/DELETE under
-- the documented invariant flow above, but row count grows with completed
-- windows; pruned by a future cold-storage cleanup task).

CREATE TABLE IF NOT EXISTS continuity_window_claims (
  campaign_id   varchar      NOT NULL,
  plan_id       varchar      NOT NULL,
  window_index  integer      NOT NULL,
  account_id    varchar      NOT NULL,
  claimed_by    varchar      NOT NULL,
  claimed_at    timestamp    NOT NULL DEFAULT now(),
  status        varchar      NOT NULL DEFAULT 'in_progress',
  outcome       varchar,
  outcome_at    timestamp,
  boss_run_id   varchar,
  PRIMARY KEY (campaign_id, plan_id, window_index)
);

CREATE INDEX IF NOT EXISTS idx_continuity_window_claims_recent
  ON continuity_window_claims (claimed_at DESC);

CREATE INDEX IF NOT EXISTS idx_continuity_window_claims_status
  ON continuity_window_claims (status, claimed_at DESC);

CREATE TABLE IF NOT EXISTS chain_registry_state (
  chain_id                  varchar      PRIMARY KEY,
  expected_interval_ms      bigint       NOT NULL,
  last_observed_run_at      timestamp,
  last_observed_lag_ms      bigint,
  last_state                varchar      NOT NULL DEFAULT 'UNKNOWN',
  last_state_changed_at     timestamp    NOT NULL DEFAULT now(),
  introspection_available   boolean      NOT NULL DEFAULT true,
  notes                     jsonb        NOT NULL DEFAULT '{}'::jsonb,
  updated_at                timestamp    NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS continuity_supervisor_ticks (
  id                        varchar      PRIMARY KEY DEFAULT gen_random_uuid(),
  tick_at                   timestamp    NOT NULL DEFAULT now(),
  duration_ms               integer      NOT NULL DEFAULT 0,
  scheduler_heartbeat_age_ms bigint,
  scheduler_state           varchar      NOT NULL DEFAULT 'UNKNOWN',
  chains_checked            integer      NOT NULL DEFAULT 0,
  chains_healthy            integer      NOT NULL DEFAULT 0,
  chains_degraded           integer      NOT NULL DEFAULT 0,
  chains_dead               integer      NOT NULL DEFAULT 0,
  chains_unknown            integer      NOT NULL DEFAULT 0,
  details                   jsonb        NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_continuity_supervisor_ticks_recent
  ON continuity_supervisor_ticks (tick_at DESC);
