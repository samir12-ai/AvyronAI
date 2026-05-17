-- Task #89 / Phase 4-A — Replay / Shadow Harness.
--
-- orchestrator_replay_cassettes captures a full deterministic recording of a
-- single `runOrchestrator(...)` invocation: inputs, engine-context resolution,
-- per-engine outputs (in deterministic order), synthesis input, plan-persist
-- payload, system-control verdict, budget-decision-ledger entries, in-flight
-- lifecycle calls, and the recorded LLM call outputs (so the player can
-- mock them STRICTLY without re-rolling).
--
-- Source enum: 'production' = sampled live capture, 'synthetic' = hand-built
-- fixture committed to repo under server/tests/orchestrator-replay/cassettes/
-- and loaded into DB only by `npm run replay:capture-synthetic`.
--
-- Cassette body is JSONB (small enough — engine outputs are typically <500KB).
-- Hash is the content-address (SHA-256 hex of canonicalised inputs).
--
-- Production cassettes live ONLY in DB (NOT committed) and download is gated
-- by METRICS_ADMIN_TOKEN on the operator panel.
--
-- Down-block reversal (safe — cassettes are non-load-bearing for production
-- decisions):
--   DROP TABLE IF EXISTS orchestrator_replay_cassettes;

CREATE TABLE IF NOT EXISTS orchestrator_replay_cassettes (
  id              VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  cassette_hash   TEXT NOT NULL UNIQUE,
  schema_version  INTEGER NOT NULL DEFAULT 1,
  source          TEXT NOT NULL,
  captured_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  redaction_applied BOOLEAN NOT NULL DEFAULT TRUE,
  -- Coverage path-shape tag (clean | gate_retry | budget_downgrade |
  -- scoped_rerun | blocked_by_integrity | needs_input | error). Used by
  -- the operator panel coverage matrix. Nullable for legacy/unclassified.
  path_shape      TEXT,
  campaign_id     VARCHAR,
  account_id      VARCHAR,
  body            JSONB NOT NULL,
  CONSTRAINT orchestrator_replay_cassettes_schema_version_chk
    CHECK (schema_version > 0),
  CONSTRAINT orchestrator_replay_cassettes_source_chk
    CHECK (source IN ('production', 'synthetic'))
);

CREATE INDEX IF NOT EXISTS idx_orch_replay_cassettes_captured_at
  ON orchestrator_replay_cassettes (captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_orch_replay_cassettes_source
  ON orchestrator_replay_cassettes (source);

CREATE INDEX IF NOT EXISTS idx_orch_replay_cassettes_path_shape
  ON orchestrator_replay_cassettes (path_shape);
