-- Phase 4 — AI Proposes / Code Validates — Orchestrator-run AI-Path Report
--
-- Adds a nullable `ai_path_report` text/JSON column to `orchestrator_jobs`.
--
-- WHY here and not only on boss_runs: the per-engine AI-proposal telemetry is
-- GENERATED inside runOrchestrator (audience/positioning/offer/channel run
-- there). runBoss is a SEPARATE execution (it invokes lane runs, never
-- runOrchestrator), so it cannot observe that telemetry in-process. The
-- authoritative per-run report is therefore written on the orchestrator job that
-- produced it; boss_runs.ai_path_report (migration 036) carries a COPY of the
-- most recent completed job's report with explicit provenance.
--
-- D2 forbids overloading the existing section_statuses / stage_times columns
-- with a new meaning, so this gets its own dedicated field.
--
-- Nullable — legacy runs and runs predating Phase 4 have no report. Stored as
-- text (JSON-encoded) to match the existing orchestrator_jobs text columns.

ALTER TABLE orchestrator_jobs
  ADD COLUMN IF NOT EXISTS ai_path_report text;

COMMENT ON COLUMN orchestrator_jobs.ai_path_report IS
  'Phase 4 (AI Proposes / Code Validates): nullable JSON-encoded per-run AI-path telemetry. Carries doctrineResolution, engineCoverage, attemptSuccessRate, and per-engine { engine, mode, attempts, failedGates[], durationMs }. Surfaced operator-only via GET /api/diagnose/ai-path-report.';
