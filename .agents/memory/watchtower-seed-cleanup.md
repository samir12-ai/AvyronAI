---
name: Watchtower synthetic seed cleanup (done 2026-08-07)
description: What was deleted/kept in the pipeline_change_events seed cleanup and where the rollback manifest lives
---

**Done:** 28 synthetic `run_migrated_*` candidate rows deleted from `pipeline_change_events`; 22 orphan `snap_base_*`/`snap_conf_*` rows deleted from `pipeline_snapshots`. Rollback manifest (full rows): `.local/validation/watchtower-cleanup-rollback-manifest-2026-08-07.json`.

**Deliberately kept:**
- Confirmed event `wt_1785679945839_9fl9eow` (metricool, real-lifecycle-confirmed) + its two `snap_base_/snap_conf_5950cc98…` snapshots — still referenced.
- `pipeline_change_events` row `9d0e5e3a-…` (`run_id='dummy-run'`, `isolated-test-acc`) — a separate test artifact the user chose to leave for a later decision. Its `dummy-snap-1/2` refs never existed.

**Pre-existing anomaly (not caused by cleanup):** confirmed event `c4f1cb57-…` (promise_shift, 2026-08-06) references snapshot UUIDs that exist in NO snapshot table; no matching insert site found among the 3 writers. Its brief works because brief context tolerates missing snapshots.

**How to apply:** any future "synthetic Watchtower data" question — the seeds are gone; only the kept confirmed event still carries `run_migrated_`/`snap_base_` identifiers, and that is intentional.
