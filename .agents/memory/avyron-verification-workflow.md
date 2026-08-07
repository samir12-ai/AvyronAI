---
name: Avyron verification & tsc workflow
description: How to typecheck and how to verify orchestrator/engine behaviour in this repo without a full DB+proxy run.
---

# tsc verification

- Run `npx tsc --noEmit` **alone in the foreground**, redirected to a temp file, then grep that file in a *separate* command. Chaining `tsc && grep …` in one bash call blows past the 120s tool timeout and the kill truncates tsc mid-run, leaving an empty output file (a false "clean").
- The project carries a **large pre-existing tsc error baseline** (hundreds of errors, e.g. in `server/audience-engine`). Judge your change by **net-new errors in the files you touched**, never by the absolute count. Snapshot the baseline before editing, compare after.
- `npm run lint` is currently broken here — enforce doctrine (D1 no `??`/`||` on decision values, D3 `z.enum`) by targeted `rg` on the lines you changed instead.

- **Line-shift false positives when diffing tsc baselines:** `comm`/`diff` on raw `file:line: error` lines flags pre-existing errors as net-new whenever an edit shifts line numbers (or union ordering changes nondeterministically). Compare **message-text sets** (strip `file(line,col)` prefixes, sort -u) before declaring a regression.
- `checkEnv` (used by tests) truncates each warning to its **first whitespace token** (`w.split(" ")[0]`); only `validateEnv` carries full messages. Tests asserting on warning text must use `startsWith(<first-token>)`, not full-message matching.
- **Negative tripwire regexes must use call/implementation form**, not bare identifiers: type signatures, doc comments, and retirement markers legitimately retain retired names. Grep for `identifier\(` / `function identifier` / import statements — a bare-name grep makes "prove X is gone" tests permanently red.

# Behavioural verification without a full orchestrator run

**Why:** a real orchestrator/boss run needs Postgres, Bright Data proxies, live scrapers, and multi-minute per-engine timeouts — not reproducible in a dev shell.

**How to apply:** drive the *real* units directly in a `.local/scripts/*.ts` tsx harness — e.g. `runCandidateGateBattery` → `emissionFromBattery` → `buildAndRecordAiPathReport` — with live LLM judges, and assert on the assembled output. This exercises the same code the engines/aggregator use. Disclose in the harness header that it is a faithful proxy, not a full pipeline run. The interchangeability/contradiction judges make real OpenAI calls (need `OPENAI_API_KEY`); keep attempts bounded (~2 per engine).

- **Any tsx harness that imports the server graph MUST end with an explicit `process.exit(0)`** (and `exit(1)` on failure). Importing `server/**` transitively opens background handles (pg pool, schedulers, timers) that keep the event loop alive, so the harness never exits on its own; the 120s tool timeout then SIGKILLs it and the fully-buffered stdout is lost — the symptom is a run with **"no output" and exit code -1 even though every check actually passed**. If you see that, add the explicit exit, do not assume the harness hung. For pure-function-only harnesses this is unnecessary, but it is harmless and worth defaulting to.

- **Stale-log trap:** `/tmp/logs/<Workflow>_*.log` snapshots are written only by `refresh_all_logs` — after restarting a workflow, `ls -t /tmp/logs` returns the *previous* run's snapshot, which can look complete (markers present, plausible counts) and silently report old results. Either call `refresh_all_logs` first, or poll the file the workflow command itself tees to (e.g. `/tmp/tsc-baseline.txt`) and gate on its completion marker.

# Clean-boot verification

- In dev, `/healthz/continuity` reports several chains DEAD (autonomous_worker, publish_worker, snapshot_cleanup_worker, ci_shared_pool_refresh, meta_token_health_check, orchestrator_parity_replay). These heartbeats are derived from `audit_log` event queries that a quiet dev instance never writes (publish_worker lag was ~140 days) — pre-existing noise, not a boot regression. Judge boot health by the worker START log lines plus continuity_scheduler/continuity_supervisor/revisit_scheduler chain states and absence of zombie/STUCK/AUDIT_WRITE_FAILED tags.

# Guard-test gotchas

- Several suites pin **source shapes** (literal call-signature strings read via `readFileSync` on scraper files). Any intentional signature change must update those pin assertions in lockstep — a red pin test after a refactor is usually the pin, not the code.
- The boot-hardening **cascade-drift sentinel** (account_id tables vs CASCADE_TABLES∪CASCADE_EXEMPT) can be red from drift that predates your change. Prove pre-existence by replaying its regex against `git show HEAD:shared/schema.ts` before touching anything. Deletion-by-default (CASCADE_TABLES) is the GDPR-safe classification; CASCADE_EXEMPT is legal-hold only. Nullable account_id rows survive the `WHERE account_id=$1` delete automatically.

# UI verification (Expo web)

- Frontend serves on port 8081 (Expo web), backend on 5000; the backend dev-proxies non-API routes to Expo.
- For Playwright/testing-subagent UI runs, log in with the dev preview backdoor: `dev@avyron.test` / `preview` (maps to the MarketMindAI dev account) — no real credentials needed.
- For API-level verification, mint a JWT with `.local/scripts/mint-jwt.ts` (signed with SESSION_SECRET, aud `avyron-ai`, iss `avyron-auth`).

# Synthetic-audit harness gotchas (Audit Runner)

- Background bash processes do NOT survive between tool calls (even `setsid`/`nohup` — killed, 0-byte logs). Long runs MUST go through the `Audit Runner` workflow; full logs land at `/tmp/logs/Audit_Runner_*.log` after `refresh_all_logs`.
- The synthetic seeder does NOT create `campaign_selections` rows for the intel_audit accounts, so any tenant-scoped-by-selection read (e.g. doctrine product-anchor resolution) silently returns null. Insert selections rows manually before testing selection-scoped paths.
- Synthetic audit accounts have a 500k tokens/week AI quota that exhausts after ~2–3 full pipeline runs. For focused LLM harnesses, register a fresh account and use its accountId — quota is per-account.
- Differentiation's depth gate frequently returns DEPTH_FAILED on synthetic seeds, cascading to skip offer/funnel/channel engines (pre-existing, not a regression signal). To verify downstream-engine behavior, drive `designValueArchitecture` / `designChannelOrchestration` directly with a tsx harness instead of chasing a full-pipeline pass.
