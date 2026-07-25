-- Seal #11 / Task #29 / F6.1
-- ai_token_budget: cross-process persistence of MI v3 token-budget decisions
-- keyed by (job_id, provider). Engine + fetch-orchestrator persist their
-- budget projection at job start so a worker that crashes mid-run can
-- restart and read the same projection back (instead of recomputing under
-- different competitor/comment counts and silently downgrading the run).
-- Rows expire after 7d; snapshot-cleanup sweeps them so the table can't
-- grow unbounded.

CREATE TABLE IF NOT EXISTS ai_token_budget (
  job_id           varchar NOT NULL,
  provider         varchar NOT NULL,
  projected_tokens integer NOT NULL,
  ceiling          integer NOT NULL,
  selected_mode    varchar NOT NULL,
  downgrade_reason text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  PRIMARY KEY (job_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_ai_token_budget_expires_at
  ON ai_token_budget (expires_at);
