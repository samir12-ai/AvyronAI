---
name: Watchtower/boss trigger gating
description: Why Watchtower, change events, and the performance loop can be silently dark on a live campaign
---

**Rule:** Several intelligence layers only execute inside boss pipeline runs, and boss runs only fire for campaigns with a *latest APPROVED strategic plan* (continuity scheduler `listActiveCampaigns`) or via manual `POST /pipeline/boss/run`. A campaign with no approved plan gets classification (CI worker post-scrape hook is independent) but **zero** Watchtower events, zero change events, and an always-empty market-signals surface — with no error anywhere.

**Why:** P-6 live validation (July 2026) found `pipeline_change_events` and `boss_runs` at 0 rows globally; root cause was the live campaign having no strategic plan at all, so scheduler ticks scanned 0 campaigns. Everything looked "healthy but quiet."

**How to apply:**
- When a signal/event surface is empty, check the trigger chain's gating condition (approved plan? anchored window?) before suspecting detection logic.
- `pipeline_change_events` has 3 writers (Watchtower, competitor-lane acceptChangeEvent, integrity harness) — all but the harness are boss-run-gated, so 0 boss runs ⇒ 0 events regardless of writer.
- `strategy_memory` emptiness is weak evidence about any single writer (perf loop, memory-mutation, strategy routes all write it); prove loop inactivity via cycle reports/verdicts instead.
- Performance loop runs only from the user-truth submit path — no truth window submitted ⇒ loop never runs.
