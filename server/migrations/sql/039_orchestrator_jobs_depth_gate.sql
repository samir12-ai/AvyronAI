-- BuildPlanLayer reload gap — persist the per-engine depth-gate map per run.
--
-- WHY: the per-engine depth-gate verdict map (Record<engineId, DEPTH_PASSED |
-- SIGNAL_PASSED | DEPTH_FAILED | ...>) is BUILT in-memory as ctx.depthGateStatus
-- inside runOrchestrator, but it was never returned in the orchestrator result
-- nor persisted anywhere. BuildPlanLayer.collectValidatedEngineOutputs admits an
-- engine snapshot ONLY when depthGateStatus[engine] is a gated-pass state, so
-- with the map absent every gated engine was excluded as CONTRACT_INCOMPLETE
-- (missing_depth_gate_status) → snapshots < 3 → permanent INSUFFICIENT_DATA.
--
-- This column gives the map a durable, run-bound home so BuildPlanLayer can
-- reload it server-side by sourceJobId (== orchestrator_jobs.id), for both the
-- driver and the production route — closing the previous client-controlled
-- req.body.depthGateStatus gate-admission hole.
--
-- D2 forbids overloading section_statuses / stage_times with a new meaning, so
-- this gets its own dedicated field. Nullable — legacy runs and any run that
-- crashed before finalization have no map → NULL → depthGateStatus stays
-- undefined → the existing D5 CONTRACT_INCOMPLETE degradation fires (no crash,
-- never silently substituted as a pass). Stored as text (JSON-encoded) to match
-- the existing orchestrator_jobs text columns.

ALTER TABLE orchestrator_jobs
  ADD COLUMN IF NOT EXISTS depth_gate_status text;

COMMENT ON COLUMN orchestrator_jobs.depth_gate_status IS
  'BuildPlanLayer reload source: nullable JSON-encoded Record<engineId, depthGateVerdict> captured from ctx.depthGateStatus at run finalization. Values include DEPTH_PASSED | SIGNAL_PASSED | DEPTH_FAILED | SIGNAL_BLOCKED | DEPTH_BLOCKED | SIGNAL_GROUNDING_FAILED. Loaded server-side (scoped by account_id) so build-plan synthesis admits gate-passed engines. NULL → CONTRACT_INCOMPLETE degradation.';
