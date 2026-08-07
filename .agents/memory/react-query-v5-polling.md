---
name: React Query v5 refetchInterval signature
description: v4-style (data) => callbacks silently disable conditional polling under v5; UI freezes on in-progress states while backend completes.
---

# React Query v5 `refetchInterval` callback signature

**Rule:** Under `@tanstack/react-query` v5, a `refetchInterval` callback receives the **Query object**, not the data. Data lives at `query.state.data`. A v4-style callback `(data) => data?.data?.status ...` reads `undefined`, always returns `false`, and polling never starts — no error, no warning.

**Why:** This exact bug made the Reasoning & Evidence page freeze on "Queued for Analysis..." forever: the backend brief pipeline (context → LLM → guards → judge → persist) completed in ~15s and the row was `ready` in the DB, but the frontend never refetched after the initial "queued" snapshot. The failure is invisible server-side — every backend health check passes.

**How to apply:**
- When a UI is "stuck" on an in-progress status, check the DB/API final state FIRST. If the backend row is terminal, the bug is client refresh logic, not the pipeline.
- Audit all conditional `refetchInterval`/`refetchOnWindowFocus` callbacks after any React Query major bump; the v5 form is `(query) => query.state.data?...`.
- Related weak points found in the same audit (not yet fixed): `recoverStaleBriefJobs()` is exported but never called at boot (briefs stuck `generating` across a restart never recover — matches the known "restarts strand in-flight jobs" pattern); `/api/perception/market-signals` filters by campaignId only, so rows from other accounts (e.g. a stray `account_id='default'` event) can appear in the list while the account-scoped detail GET 404s on them.
