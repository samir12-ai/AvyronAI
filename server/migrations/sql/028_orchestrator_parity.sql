-- Task #91 / Phase 4-C — Parity Validation + Divergence Tracking.
--
-- Three tables form the continuous parity surface that replays production
-- cassettes (from Task #89 / Phase 4-A) hourly against the candidate
-- orchestrator and routes divergences through a data-driven policy table.
--
--   orchestrator_replay_runs        — one row per cassette replay.
--   orchestrator_replay_divergences — one row per Divergence inside a run.
--   divergence_class_routes         — routing policy keyed by divergence
--                                     class. Editable WITHOUT redeploy
--                                     (operator-tunable per task spec).
--
-- Doctrine notes:
--   * D2/D3 — `outcome` is a strict CHECK enum (no `?? "UNKNOWN"` fallback
--     anywhere in the live decision path).
--   * Seal #13 INVARIANT-RETRY — parity job releases its window claim on
--     `PARTIAL`/`HARNESS_ERROR` so the next hourly tick re-attempts.
--   * NO-TENANT-LEAK — campaign_id/account_id are stored for forensics
--     but are NEVER exposed on /healthz/orchestrator-parity.

CREATE TABLE IF NOT EXISTS orchestrator_replay_runs (
  id                   VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cassette_hash        TEXT NOT NULL,
  path_shape           TEXT,
  outcome              TEXT NOT NULL,
  divergence_count     INTEGER NOT NULL DEFAULT 0,
  highest_class        TEXT,
  routed_action        TEXT NOT NULL,
  engine_wallclock_ms  INTEGER NOT NULL DEFAULT 0,
  final_plan_hash      TEXT,
  final_verdict_hash   TEXT,
  candidate_error      TEXT,
  shadow_mode          BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT orchestrator_replay_runs_outcome_chk
    CHECK (outcome IN ('PASS','NOISE','INFO','WARN','BLOCK','HARNESS_ERROR')),
  CONSTRAINT orchestrator_replay_runs_action_chk
    CHECK (routed_action IN ('NOISE','INFO','WARN','BLOCK','NONE'))
);

CREATE INDEX IF NOT EXISTS idx_orp_runs_ran_at
  ON orchestrator_replay_runs (ran_at DESC);
CREATE INDEX IF NOT EXISTS idx_orp_runs_outcome_ran_at
  ON orchestrator_replay_runs (outcome, ran_at DESC);
CREATE INDEX IF NOT EXISTS idx_orp_runs_cassette
  ON orchestrator_replay_runs (cassette_hash, ran_at DESC);

CREATE TABLE IF NOT EXISTS orchestrator_replay_divergences (
  id              VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          VARCHAR NOT NULL REFERENCES orchestrator_replay_runs(id) ON DELETE CASCADE,
  observed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  divergence_class TEXT NOT NULL,
  path            TEXT NOT NULL,
  module_id       TEXT,
  expected        JSONB,
  actual          JSONB,
  CONSTRAINT orp_divergences_class_chk
    CHECK (divergence_class IN ('STRUCTURAL','CANONICAL_FIELD','DEGRADATION_SURFACE','BUDGET_LEDGER','PROVENANCE','ORDER','TIMING_ONLY'))
);

CREATE INDEX IF NOT EXISTS idx_orp_div_run ON orchestrator_replay_divergences (run_id);
CREATE INDEX IF NOT EXISTS idx_orp_div_class_observed
  ON orchestrator_replay_divergences (divergence_class, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_orp_div_module_observed
  ON orchestrator_replay_divergences (module_id, observed_at DESC)
  WHERE module_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS divergence_class_routes (
  divergence_class TEXT PRIMARY KEY,
  action           TEXT NOT NULL,
  description      TEXT NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT dcr_class_chk
    CHECK (divergence_class IN ('STRUCTURAL','CANONICAL_FIELD','DEGRADATION_SURFACE','BUDGET_LEDGER','PROVENANCE','ORDER','TIMING_ONLY')),
  CONSTRAINT dcr_action_chk
    CHECK (action IN ('NOISE','INFO','WARN','BLOCK'))
);

-- Seed default routing. Operator may UPDATE rows without redeploy.
INSERT INTO divergence_class_routes (divergence_class, action, description) VALUES
  ('TIMING_ONLY',         'NOISE', 'Wall-clock drift; whitelisted by diff.ts'),
  ('ORDER',               'INFO',  'Engine sequence change without value change'),
  ('PROVENANCE',          'INFO',  'inputHashes / context-keys drift'),
  ('BUDGET_LEDGER',       'WARN',  'Ledger length or per-entry canonical action mismatch'),
  ('DEGRADATION_SURFACE', 'WARN',  'planPersist.degraded or planPersist.source flipped'),
  ('STRUCTURAL',          'BLOCK', 'Type/shape mismatch on observation tree'),
  ('CANONICAL_FIELD',     'BLOCK', 'D2-tracked canonical field value drift (status/integrityVerdict/executionMode)')
ON CONFLICT (divergence_class) DO NOTHING;
