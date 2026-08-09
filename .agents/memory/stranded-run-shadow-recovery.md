---
name: Stranded-run recovery & shadow semantics
description: How stranded RUNNING orchestrator jobs are recovered and how shadow detection classifies in-progress vs failed runs.
---

- Rule: orchestrator_jobs has NO heartbeat/updatedAt column — staleness for RUNNING rows can only be judged from createdAt. A boot + periodic sweep marks RUNNING rows older than 60 min as TIMED_OUT (clamped strictly above the supported 45-min whole-pipeline maximum) so they stop shadowing resolvable runs forever without ever killing a healthy long run.
- **Why:** server restarts mid-run leave rows permanently RUNNING (no terminal update ever comes); one such zombie locked the Build Plan screen for a full day.
- **How to apply:** any new long-running job table should either get a heartbeat column or be registered with a recovery sweep; never rely on the process that started the job to always finish it.

- Shadow semantics: a newer non-resolvable run shadows only when its createdAt is AFTER the resolved run's completedAt. Overlapping runs (started before the previous run finished) do NOT shadow — the completed run stays authoritative. Shadow responses carry shadowKind (IN_PROGRESS = RUNNING, FAILED = terminal) plus the previous run's persisted plan as `previousPlan`, so the UI shows a labeled banner instead of a hard block. The previous plan is never returned in the `plan` field — fail-closed labeling is the contract several static tests enforce (canonical-plan-persistence.test.ts).
