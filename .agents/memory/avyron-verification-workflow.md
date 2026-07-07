---
name: Avyron verification & tsc workflow
description: How to typecheck and how to verify orchestrator/engine behaviour in this repo without a full DB+proxy run.
---

# tsc verification

- Run `npx tsc --noEmit` **alone in the foreground**, redirected to a temp file, then grep that file in a *separate* command. Chaining `tsc && grep …` in one bash call blows past the 120s tool timeout and the kill truncates tsc mid-run, leaving an empty output file (a false "clean").
- The project carries a **large pre-existing tsc error baseline** (hundreds of errors, e.g. in `server/audience-engine`). Judge your change by **net-new errors in the files you touched**, never by the absolute count. Snapshot the baseline before editing, compare after.
- `npm run lint` is currently broken here — enforce doctrine (D1 no `??`/`||` on decision values, D3 `z.enum`) by targeted `rg` on the lines you changed instead.

# Behavioural verification without a full orchestrator run

**Why:** a real orchestrator/boss run needs Postgres, Bright Data proxies, live scrapers, and multi-minute per-engine timeouts — not reproducible in a dev shell.

**How to apply:** drive the *real* units directly in a `.local/scripts/*.ts` tsx harness — e.g. `runCandidateGateBattery` → `emissionFromBattery` → `buildAndRecordAiPathReport` — with live LLM judges, and assert on the assembled output. This exercises the same code the engines/aggregator use. Disclose in the harness header that it is a faithful proxy, not a full pipeline run. The interchangeability/contradiction judges make real OpenAI calls (need `OPENAI_API_KEY`); keep attempts bounded (~2 per engine).
