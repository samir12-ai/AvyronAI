---
name: Verify run code vintage before auditing outputs
description: A "fresh" pipeline run may predate the fixes it was meant to validate — check commit timestamps vs run window first.
---
**Rule:** Before auditing a recorded run's outputs for defects, confirm the code the run actually executed: compare the run's start/end timestamps against `git log` for the files under audit. If the fix commits postdate the run window, the run's failures are pre-fix artifacts, not evidence — rerun on current code.

**Why:** A full-run audit nearly misdiagnosed already-fixed defects (offer depth 0.1, template territory names) because the recorded "fresh run" executed the commit *before* the Positioning/Offer fixes; a true fresh run on fixed code went COMPLETED 15/15 with those failures gone.

**How to apply:** Any time a run log/snapshot set is used as audit evidence, first run `git log --format='%h %ci' -3 -- <fixed files>` and compare against the run's OUTPUT DIR timestamp. Also: `/api/plans/active/:campaignId` needs a JWT signed with aud=`avyron-ai`, iss=`avyron-auth` (see server/auth.ts) — payload `{userId,email,accountId}`.
