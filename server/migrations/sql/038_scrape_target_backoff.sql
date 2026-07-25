-- T006 — Persistent adaptive per-target scrape backoff (2026-07 pool upgrade)
--
-- Cooldown/streak state for scrape targets survives process restarts so a
-- freshly-booted replica does not immediately re-hammer a target that was
-- cooling when the previous process died.
--
-- Scope: ONLY cross-restart-meaningful state is persisted (failure streaks +
-- cooldowns per target). Logical proxy sessions are NOT persisted — they are
-- random 15-min-TTL handles whose resurrection is meaningless.
--
-- Reserved target_key '__platform__' carries platform-level (pool-wide)
-- backoff state for a tenant, distinct from any real competitor/host key.
--
-- Lifecycle: rows are upserted on cooldown transitions (write-through,
-- fire-and-forget), deleted when a success clears the streak, and covered by
-- GDPR cascade delete (CASCADE_TABLES in server/account-lifecycle.ts).

CREATE TABLE IF NOT EXISTS scrape_target_backoff (
  account_id       varchar NOT NULL,
  platform         text    NOT NULL CHECK (platform IN ('instagram', 'tiktok', 'reviews', 'website')),
  target_key       text    NOT NULL,
  failure_streak   integer NOT NULL DEFAULT 0,
  cooldown_until   timestamptz,
  last_block_class text,
  last_failure_at  timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, platform, target_key)
);

-- Hydration reads are per (account_id, platform) — covered by the PK prefix.
-- Reaper/operator queries scan by cooldown expiry:
CREATE INDEX IF NOT EXISTS scrape_target_backoff_cooldown_until_idx
  ON scrape_target_backoff (cooldown_until)
  WHERE cooldown_until IS NOT NULL;

COMMENT ON TABLE scrape_target_backoff IS
  'T006: per-(account, platform, target) adaptive scrape backoff state. Write-through from target-backoff.ts via pool-persistence.ts; hydrated lazily on first pool touch. target_key ''__platform__'' is reserved for platform-level state.';
