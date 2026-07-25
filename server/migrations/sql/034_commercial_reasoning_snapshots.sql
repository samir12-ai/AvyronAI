-- Phase 4-A — Commercial Reasoning Core (awareness depth interpreter)
--
-- See `.local/plans/phase-4-commercial-reasoning-core.md` §8b.
--
-- Persists the structured output of the LLM commercial-reasoning layer
-- alongside the existing AEL/CEL evidence substrate. Per-engine per-run
-- UPSERT-by-(run_id, engine_id) is enforced at the DB layer so the
-- application code cannot accidentally insert duplicate rows.
--
-- D3 doctrine (strict enums on verdict-shaped fields) pushed to the storage
-- layer via CHECK constraints so any future code path attempting to write a
-- non-canonical token is rejected by Postgres, not just by application code.

CREATE TABLE IF NOT EXISTS commercial_reasoning_snapshots (
  id                varchar      PRIMARY KEY,
  account_id        varchar      NOT NULL,
  campaign_id       varchar      NOT NULL,
  run_id            varchar      NOT NULL,
  engine_id         varchar      NOT NULL,
  reasoning         jsonb        NOT NULL,
  gate_decision     jsonb        NOT NULL,
  integrity_verdict varchar      NOT NULL
    CHECK (integrity_verdict IN ('PASS','PARTIAL','FAIL')),
  fell_back_to      varchar      NOT NULL
    CHECK (fell_back_to IN ('none','deterministic_floor')),
  created_at        timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT commercial_reasoning_snapshots_run_engine_uniq
    UNIQUE (run_id, engine_id)
);

CREATE INDEX IF NOT EXISTS commercial_reasoning_snapshots_run_engine_idx
  ON commercial_reasoning_snapshots (run_id, engine_id);
CREATE INDEX IF NOT EXISTS commercial_reasoning_snapshots_account_campaign_idx
  ON commercial_reasoning_snapshots (account_id, campaign_id, created_at DESC);

COMMENT ON TABLE commercial_reasoning_snapshots IS
  'Phase 4-A: Commercial Reasoning Core per-engine per-run snapshots. Written by server/commercial-reasoning/persist.ts after each interpretAwarenessDepth invocation. Reasoning field carries CommercialReasoningOutput (see server/commercial-reasoning/contract.ts). UNIQUE(run_id, engine_id) makes the application-level UPSERT enforceable.';
