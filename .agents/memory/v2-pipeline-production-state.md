---
name: V2 pipeline production state
description: Production campaign inventory, V2 orchestrator completion state, and known blockers as of 2026-08-07
---

## Campaign inventory (as of 2026-08-07)
Only 1 active real production campaign confirmed in the DB at audit time:
1. `campaign_1773576062201_6t0oxi` — account `a2d87878-a1e9-41ea-a8a5-90beff569673` — **MarketMindAI** (B2B SaaS / AI content marketing tool, Dubai-adjacent, SALES funnel)

Previous entries for "burger/Dubai" and "forma/Istanbul" campaigns were from an earlier session (2026-07-28) and are no longer the active campaign under audit.

## MarketMindAI V2 orchestrator state (2026-08-07)

### What runs:
- 9/15 engines complete (MI, Audience, Positioning, Differentiation, Mechanism, Offer, Awareness, Funnel, Persuasion)
- AEL: 5 rootCauses, 4 causalChains, 4 buyingBarriers, quality=PASS

### What blocks:
1. **OFFER_AUDIENCE_MISALIGNMENT** — Offer Engine output doesn't address audience pains; System Control BLOCKS
2. **PIPELINE_INCOMPLETE** — downstream engines (channel_selection, statistical_validation, budget_governor, iteration, retention) never reached because system control blocked
3. **buildPlan LLM timeout** — synthesis call times out 3/3 attempts; plan is always `degraded_ai_failed`
4. **IDENTITY_DRIFT** — Offer identity ("B2B agency leader...") shares no terms with Audience identity aspiration ("CMO who broke vendor-fatigue...")

### Current plan state:
- 1 plan: DRAFT v2, `degraded_ai_failed`, execution_status=IDLE (created 2026-07-31)
- 0 approved plans
- 5 strategy roots, all SUPERSEDED (consumed by buildPlanLayer on each run)
- 17 calendar entries from DRAFT plan, all PENDING, no studio items

### Performance loop state:
- All tables empty (cycle_reports, verdicts, outcomes, memory, truths)
- 4 organic Instagram posts, all lineage_state=unmatched
- Correctly empty — no approved plan = no activated execution

**Why:** Two independent blocker paths:
- Path A — Gate failures: run-to-run the specific BLOCK codes vary (16:30 run: OFFER_AUDIENCE_MISALIGNMENT + PIPELINE_INCOMPLETE; 17:01 run: STALE_SNAPSHOT_EVIDENCE + POSITIONING_HARD_GATE + CONFIDENCE_SPREAD_EXCESSIVE + CONFIDENCE_INTEGRITY_INCOMPLETE). Positioning confidence flips between PASS and hard-gate FAIL across runs depending on which snapshot version is fed in and SGL grounding.
- Path B — buildPlan LLM timeout: when engines run far enough, the synthesis call times out 3/3 attempts. When gates fire early (17:01 run), buildPlan is never reached.
Both paths are independent — fixing one surfaces the other.

## Watchtower / market signal state
- 1 confirmed major signal: metricool ai emotional_trigger_shift CURIOSITY→ASPIRATION (detected 2026-08-06)
- 11 competitors watched, MI v92 confidence=0.879

## Content DNA write path gap
- Commercial DNA composition runs (5/5 engines, full=true) but `content_dna` table has 0 rows
- The composition result is not being persisted — investigate write path in DNA composition layer
