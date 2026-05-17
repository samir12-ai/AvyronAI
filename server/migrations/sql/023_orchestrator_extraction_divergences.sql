-- Task #90 / Phase 4-B — Orchestrator extraction divergence ledger.
--
-- Records every (candidate vs current) divergence observed in shadow mode
-- so the CV-14 ExtractionDriftDetection subsystem and the auto-revert
-- supervisor have an authoritative audit trail. PII-safe by construction:
-- only PII-redacted diff summaries and content-addressed result hashes are
-- written; raw module I/O snapshots are NEVER stored here (recorder owns
-- those, gated separately on ORCH_REPLAY_RECORD).
--
-- One row per divergence event. Steady-state expectation: ZERO rows once
-- a module is promoted to `candidate`. Any non-zero rate triggers the
-- auto-revert supervisor (see server/orchestrator/extraction-dispatch/
-- auto-revert-supervisor.ts) which flips the per-module flag back to
-- `current` and surfaces the divergence on the operator panel.

CREATE TABLE IF NOT EXISTS orchestrator_extraction_divergences (
  id                  TEXT PRIMARY KEY,
  captured_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  job_id              TEXT NOT NULL,
  campaign_id         TEXT,
  account_id          TEXT,
  module_id           TEXT NOT NULL,
  dispatch_mode       TEXT NOT NULL CHECK (dispatch_mode IN ('shadow','candidate','current')),
  -- 'minor' = divergence in non-load-bearing field (timing, ordering of
  --           idempotent log lines).
  -- 'major' = divergence in canonical contract field (status / verdict /
  --           decisionAction / validationState / blockReasons).
  -- 'fatal' = candidate threw OR returned structurally incompatible shape.
  severity            TEXT NOT NULL CHECK (severity IN ('minor','major','fatal')),
  current_hash        TEXT,
  candidate_hash      TEXT,
  diff_summary        JSONB NOT NULL,
  candidate_error     TEXT
);

CREATE INDEX IF NOT EXISTS idx_oed_module_captured
  ON orchestrator_extraction_divergences (module_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_oed_severity_captured
  ON orchestrator_extraction_divergences (severity, captured_at DESC)
  WHERE severity IN ('major','fatal');

CREATE INDEX IF NOT EXISTS idx_oed_job
  ON orchestrator_extraction_divergences (job_id);
