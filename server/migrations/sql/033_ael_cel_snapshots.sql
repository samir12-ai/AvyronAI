-- Phase 3 fix — create the missing AEL/CEL persistence tables.
--
-- Discovered May 2026: `server/narrative-layer.ts:204` issues
--   SELECT root_causes, causal_chains, buying_barriers FROM ael_snapshots ...
-- but no migration ever created `ael_snapshots`, and the AEL engine
-- (`server/analytical-enrichment-layer/engine.ts`) only writes to an
-- in-memory cache (`setCachedAEL`). Result: every narrative invocation
-- silently caught a "relation does not exist" error and proceeded with
-- aelData=null, blanking the WHY and HOW steps of the causal chain.
--
-- The CEL engine (`server/causal-enforcement-layer/engine.ts`) has the
-- same defect — `enforceGenericEngineCompliance` returns a ComplianceResult
-- in memory but never persists. Downstream forensics and `cel_reports`
-- queries fail identically.
--
-- This migration closes both gaps. The orchestrator is patched in the
-- same Phase 3 fix-set to actually write to these tables after building
-- the analytical package and after each CEL compliance check.

CREATE TABLE IF NOT EXISTS ael_snapshots (
  id              varchar      PRIMARY KEY,
  account_id      varchar      NOT NULL,
  campaign_id     varchar      NOT NULL,
  job_id          varchar      NOT NULL,
  -- Denormalized columns directly queried by narrative-layer.ts:204.
  root_causes     jsonb        NOT NULL DEFAULT '[]'::jsonb,
  causal_chains   jsonb        NOT NULL DEFAULT '[]'::jsonb,
  buying_barriers jsonb        NOT NULL DEFAULT '[]'::jsonb,
  -- Full package retained for forensic + future readers.
  package         jsonb        NOT NULL,
  is_partial      boolean      NOT NULL DEFAULT false,
  partial_reason  text,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT ael_snapshots_account_campaign_job_uniq
    UNIQUE (account_id, campaign_id, job_id)
);

CREATE INDEX IF NOT EXISTS ael_snapshots_campaign_id_idx
  ON ael_snapshots (campaign_id);
CREATE INDEX IF NOT EXISTS ael_snapshots_account_id_idx
  ON ael_snapshots (account_id);
CREATE INDEX IF NOT EXISTS ael_snapshots_job_id_idx
  ON ael_snapshots (job_id);
CREATE INDEX IF NOT EXISTS ael_snapshots_created_at_idx
  ON ael_snapshots (created_at DESC);

COMMENT ON TABLE ael_snapshots IS
  'Phase 3 fix: Analytical Enrichment Layer per-run snapshots. Written by orchestrator after buildAnalyticalPackage; read by narrative-layer.ts to ground WHY/HOW causal-chain steps. Unique on (account, campaign, job) — orchestrator re-runs with the same jobId UPSERT.';

CREATE TABLE IF NOT EXISTS cel_reports (
  id                      varchar      PRIMARY KEY,
  account_id              varchar      NOT NULL,
  campaign_id             varchar      NOT NULL,
  job_id                  varchar      NOT NULL,
  engine_id               varchar      NOT NULL,
  -- ComplianceResult flat columns for cheap forensic queries.
  passed                  boolean      NOT NULL,
  verdict                 varchar      NOT NULL,  -- PASS | FAIL | INCOMPLETE
  reason                  text,
  score                   double precision NOT NULL DEFAULT 0,
  root_causes_evaluated   integer      NOT NULL DEFAULT 0,
  -- Full report retained for replay / audit-runner snapshotting.
  report                  jsonb        NOT NULL,
  created_at              timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT cel_reports_account_campaign_job_engine_uniq
    UNIQUE (account_id, campaign_id, job_id, engine_id)
);

CREATE INDEX IF NOT EXISTS cel_reports_campaign_id_idx
  ON cel_reports (campaign_id);
CREATE INDEX IF NOT EXISTS cel_reports_account_id_idx
  ON cel_reports (account_id);
CREATE INDEX IF NOT EXISTS cel_reports_job_id_idx
  ON cel_reports (job_id);
CREATE INDEX IF NOT EXISTS cel_reports_created_at_idx
  ON cel_reports (created_at DESC);

COMMENT ON TABLE cel_reports IS
  'Phase 3 fix: Causal Enforcement Layer per-engine compliance reports. One row per (account, campaign, job, engineId). Written inline after each enforceGenericEngineCompliance call in runOrchestrator.';
