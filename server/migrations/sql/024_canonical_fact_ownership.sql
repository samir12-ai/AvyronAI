-- Task #64 / Phase 1 — Canonical Fact Ownership.
--
-- (a) Split mutation_log out of strategy_memory into its own table.
-- (b) Demote operational state (content_rhythm / exploration_budget /
--     agent_rhythm) out of strategy_memory into engine_operational_state.
--
-- Backfill is intentionally NOT included here. The old rows remain on
-- strategy_memory for historical inspection but are no longer read by
-- getMemoryHealth / loadMemoryBlock once code lands (the NON_STRATEGIC
-- filter already excludes them). A follow-up sweep can DELETE them
-- after observation confirms no fallback readers remain.

CREATE TABLE IF NOT EXISTS mutation_log (
  id                varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        varchar NOT NULL,
  campaign_id       varchar NOT NULL,
  label             text    NOT NULL,
  confirmed_count   integer DEFAULT 0,
  challenged_count  integer DEFAULT 0,
  flipped_count     integer DEFAULT 0,
  decayed_count     integer DEFAULT 0,
  total_processed   integer DEFAULT 0,
  challenged_ids    jsonb   DEFAULT '[]'::jsonb,
  flipped           jsonb   DEFAULT '[]'::jsonb,
  run_at            timestamp DEFAULT now(),
  created_at        timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mutation_log_account_campaign_idx
  ON mutation_log (account_id, campaign_id, created_at DESC);

CREATE TABLE IF NOT EXISTS engine_operational_state (
  id                varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        varchar NOT NULL,
  campaign_id       varchar NOT NULL,
  state_type        text    NOT NULL,
  engine_name       text    NOT NULL,
  label             text    NOT NULL,
  payload           jsonb   DEFAULT '{}'::jsonb,
  rationale         text,
  confidence_score  double precision DEFAULT 0.5,
  updated_at        timestamp DEFAULT now(),
  created_at        timestamp DEFAULT now()
);

-- Singleton-per-(account, campaign, state_type): the writer upserts on this
-- tuple. The previous design wrote a new strategy_memory row OR updated the
-- newest one; the new contract is "one row, last-write-wins".
CREATE UNIQUE INDEX IF NOT EXISTS engine_operational_state_singleton_idx
  ON engine_operational_state (account_id, campaign_id, state_type);
