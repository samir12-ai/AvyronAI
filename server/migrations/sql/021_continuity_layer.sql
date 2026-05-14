-- Seal #13 / Track #1 — Operational Continuity Layer.
--
-- Adds the persistence backbone for the autonomous evaluation scheduler:
--
--   1. plan_anchor_resets — explicit re-anchor records consulted by
--      evaluateWindowState() when computing a plan's anchor. Lets the
--      continuity scheduler restart the weekly cycle at window_index=0
--      after a long gap (>1 window) without violating the no-backfill
--      doctrine in pipeline/eval-windows.ts (we don't backfill missed
--      windows; we just declare a fresh anchor going forward).
--
--   2. continuity_ticks — every scheduler tick writes one row capturing
--      what it observed (campaigns scanned, runs invoked, skips, missed
--      windows, dead cycles). Drives the /healthz/continuity endpoint
--      and the missed-window/dead-cycle detection on subsequent ticks.
--      Also gives ops a paper trail when no boss_run was produced for
--      a window: they can see WHY the scheduler chose to skip.
--
-- Both tables are append-mostly. plan_anchor_resets is queried hot
-- (every evaluateWindowState call) so we index on plan_id; continuity_ticks
-- is queried by recency so we index on tick_at desc.

CREATE TABLE IF NOT EXISTS plan_anchor_resets (
  id              varchar      PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      varchar      NOT NULL,
  campaign_id     varchar      NOT NULL,
  plan_id         varchar      NOT NULL,
  reanchored_at   timestamp    NOT NULL,
  reason          text         NOT NULL,
  source          text         NOT NULL DEFAULT 'continuity_scheduler',
  created_at      timestamp    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plan_anchor_resets_plan_recent
  ON plan_anchor_resets (plan_id, reanchored_at DESC);

CREATE INDEX IF NOT EXISTS idx_plan_anchor_resets_campaign
  ON plan_anchor_resets (account_id, campaign_id, reanchored_at DESC);

CREATE TABLE IF NOT EXISTS continuity_ticks (
  id                       varchar      PRIMARY KEY DEFAULT gen_random_uuid(),
  tick_at                  timestamp    NOT NULL DEFAULT now(),
  duration_ms              integer      NOT NULL DEFAULT 0,
  campaigns_scanned        integer      NOT NULL DEFAULT 0,
  runs_invoked             integer      NOT NULL DEFAULT 0,
  runs_skipped_idempotent  integer      NOT NULL DEFAULT 0,
  runs_failed              integer      NOT NULL DEFAULT 0,
  reanchors_written        integer      NOT NULL DEFAULT 0,
  missed_windows_detected  integer      NOT NULL DEFAULT 0,
  dead_cycles_detected     integer      NOT NULL DEFAULT 0,
  notes                    jsonb        NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_continuity_ticks_recent
  ON continuity_ticks (tick_at DESC);
