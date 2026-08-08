---
name: Task-agent real-run evidence lives in the shared DB
description: Where to find verification evidence for real runs executed inside an isolated task agent
---

# Task-agent real-run evidence lives in the shared DB

Task agents run in isolated file environments but write to the SAME database. Their
`.local/validation/real-run/<ts>` artifact directories are usually NOT part of the merged commit
(merges contain code only), so the newest local artifact dir can be an older, pre-fix run.

**Why:** after a task merge, looking for the verification run's SUMMARY.json under
`.local/validation/` finds only stale runs and looks like missing evidence. The durable record is
in `orchestrator_jobs` (status, duration_ms, section_statuses, plan_id, depth_gate_status), the 16
per-engine `*_snapshots` tables keyed by `job_id`, `system_control_verdicts.job_id`, and
`strategic_plans.job_id`.

**How to apply:** to verify or report on a task-agent real run, query the DB by the run's job ID
(pattern `campaign_<id>_realrun_<ts>`), not the local filesystem. Treat a missing artifact dir as
expected, not as a failed or fabricated run.
