---
name: Fetch completeness ⇄ depth-gate outcomes
description: Why a stale/incomplete competitor fetch silently produces awareness DEPTH_FAILED, and the zombie fetch-job dedup gotcha that causes it.
---

# Fetch completeness drives boundary depth-gate outcomes

The awareness engine's CEL depth score can sit right at the 0.20 floor for this
class of campaign. With a **complete** competitor corpus it clears the floor
(`DEPTH_PASSED`); with a **stale/partial** corpus (missing a competitor's posts)
it slips just under (`DEPTH_FAILED`) and cascade-blocks funnel + downstream
engines. The margin is small — corpus completeness alone can flip the verdict.

**Why:** the score reflects genuine semantic density of the generated content
against the corpus. Less corpus ⇒ thinner content ⇒ lower score. It is a
*data-completeness symptom*, not an engine bug.

**How to apply:** when awareness (or any engine) lands DEPTH_FAILED near the
floor, FIRST verify the fetch was complete (all competitors present, job status
`COMPLETE*` not `FAILED`/stuck) before touching the engine. NEVER lower the gate
to make it pass — that violates doctrine. Fix via complete data / richer DNA.

# Zombie fetch-job dedup gotcha

`startFetchJob` deduplicates by `competitor_hash`: it reuses ANY currently
active (`QUEUED`/`RUNNING`) `mi_fetch_jobs` row for the same competitor set.
A stale QUEUED job left over from a prior day therefore **poisons** a fresh run —
the new run dedups onto the zombie instead of scraping, and inherits its
partial/empty coverage until the watchdog auto-expires it (the "stuck in QUEUED
>15min" rule deletes it, marking the run partial/failed).

**Why:** dedup is by competitor set only, with no freshness/age check on the
reused row.

**How to apply:** before kicking off a fresh real campaign run, confirm
`mi_fetch_jobs` has NO active (`QUEUED`/`RUNNING`) row for the campaign — all
prior rows should be `COMPLETE*`/`FAILED`. If a zombie exists, let it expire (or
clear it) first, otherwise the "fresh" run silently reuses stale coverage.

# Depth gate vs CEL causal compliance are independent layers

An engine can pass the depth gate yet still be flagged by CEL causal
compliance. Awareness here passed depth at 0.25 but CEL still reported
`missing_root_cause`/`missing_causal_chain` (its content cited zero AEL
rootCause/chain/barrier refs — `rootCauseRefs=0`). Both are truthful: the depth
gate is a floor on semantic density; CEL checks explicit causal grounding.
Don't conflate them when diagnosing a BLOCK.
