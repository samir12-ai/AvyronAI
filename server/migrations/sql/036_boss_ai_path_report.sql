-- Phase 0 — AI Proposes / Code Validates — Boss AI-Path Report
--
-- Adds a nullable `ai_path_report` text/JSON column to `boss_runs`. Phase 4
-- telemetry writes the per-engine AI-path status here:
--   {
--     doctrineResolution: 'anchored' | 'business_level_degraded',
--     engineCoverage: number,        // engines via AI path / engines run
--     attemptSuccessRate: number,    // validated outputs / total attempts
--     engines: [{ engine, mode: 'ai'|'fallback', attempts, failedGates[], durationMs }]
--   }
--
-- Nullable — legacy runs and runs predating Phase 4 have no report. Stored as
-- text (JSON-encoded) to match the existing boss_runs JSON-in-text columns
-- (scope/plan/execution) so the read path is uniform.

ALTER TABLE boss_runs
  ADD COLUMN IF NOT EXISTS ai_path_report text;

COMMENT ON COLUMN boss_runs.ai_path_report IS
  'Phase 4 (AI Proposes / Code Validates): nullable JSON-encoded per-run AI-path telemetry. Carries doctrineResolution, engineCoverage, attemptSuccessRate, and per-engine { engine, mode, attempts, failedGates[], durationMs }. Surfaced operator-only via GET /api/diagnose/ai-path-report.';
