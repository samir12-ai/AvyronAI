# "AI Proposes, Code Validates" — Full Implementation Report

**Project:** Avyron AI
**Architecture inversion:** Phases 0–4
**Date:** 2026-07-07

---

## Core principle

The AI generates **candidate** strategy outputs. Deterministic code gates are the **sole judge** of every candidate. There is **no silent acceptance** and **no hidden substitution** — every rejection, retry, and fallback is explicitly classified and recorded.

**Governing doctrine enforced throughout:**

- **D1** — No `??` / `||` producing a decision/verdict/outcome *value* (ternary and boolean-`||` in conditions are fine; `??` for a genuinely-missing input is fine).
- **D3** — Strict `z.enum([...])` for every verdict/mode-shaped field (never `z.string()`).
- **D5** — Missing canonical value → an explicit *reason*, never a silent substitute.
- **B2 / B4** — Visibility over silence; explicit classification over hidden ambiguity.
- **NO-TENANT-LEAK** — No per-tenant fields on public surfaces; admin surfaces are timing-safe and fail-closed.
- **Replay invariant** — No bare LLM calls in orchestrator sibling modules; all LLM calls live inside engine directories or the shared judge module.
- **Line ceilings** — `runOrchestrator` / `index.ts` ≤ 5000 lines; each new sibling module < 200 lines.

---

## Phase 0 — Schema & Doctrine Foundation ✅

**Status: COMPLETE — architect review PASS. Backend boots clean, schema floor = 36.**

| Task | Delivered |
|------|-----------|
| **T1** | Two migrations: `035_product_anchor.sql` (adds nullable `product_anchor jsonb` to `growth_campaigns`) and `036_boss_ai_path_report.sql` (adds nullable `ai_path_report` to `boss_runs`). `REQUIRED_SCHEMA_VERSION` bumped 34 → 36. `shared/schema.ts` updated for both columns. |
| **T2** | `server/shared/strategic-doctrine.ts`: the six principles (P1–P6), `RESOLUTION_RULE`, `PRICING_EXCLUSION`, `DOCTRINE_VERSION` token, and types (`StrategicDoctrine`, `EngineDecisionSummary`, `ProductAnchor`, `RunStrategicContext`, `DoctrineResolution` enum). `buildDoctrineBlock(ctx)` renders a prompt-ready block (doctrine + product anchor + prior decisions). Partial-doctrine policy: anchor absent → business-level degrade, **never** injects `[not set]` placeholders. |
| **T3** | Extended `SharedStrategicContext` with `doctrine` + `priorDecisions`. New sibling `server/orchestrator/doctrine-seed.ts` (`seedDoctrine`, `appendPriorDecision`) with one-line call sites in `index.ts`. Threaded `DOCTRINE_VERSION + sha256(product_anchor)` into `computeInputHash` — editing a campaign's anchor invalidates cached snapshots. |
| **T4** | Product-anchor input added to the campaign-setup UI (name, type, keyAttributes[], coreProblemSolved, differentiatingFeature), wired to campaign create/update. |

**Post-review hardening:**
- Anchor read is tenant-scoped via inner join to `campaignSelections(accountId, selectedCampaignId)` — NO-TENANT-LEAK.
- `parseProductAnchor` logs `PRODUCT_ANCHOR_INVALID` when a stored anchor is corrupt (B2/B4) — distinguishes "no anchor" from "anchor present but broken".
- **Anchor edit path** (built at user request): backend `GET`/`PUT /api/campaigns/:campaignId/product-anchor` (tenant-scoped ownership; `PUT null` clears via UPDATE-only, object validated by `ProductAnchorSchema` then upsert). Inline `EditProductIdentityForm` inside the campaign list modal. `POST /api/campaigns/select` now rejects claiming a campaignId owned by another account (409 `CAMPAIGN_ID_CLAIMED`).

---

## Phase 1 — Gates, Retry & Judge ✅

**Status: COMPLETE — architect evaluate_task PASS. All validators green.**

| Task | Delivered |
|------|-----------|
| **T5** | `server/shared/interchangeability-judge.ts` — LLM judge (temp ≤ 0.1, `verdict: z.enum(["ACCEPTED","REJECTED","NOT_RUN"])`, fail-closed to NOT_RUN). Four prompts: segment / positioning-claim / offer / channel-rationale, each receiving the product anchor. **Validation: 8/8 hard assertions** (generic → REJECT, specific → ACCEPT, borderline → informational). |
| **T6** | Breadth regex gate — deterministic, free, always runs first; rejects catch-all patterns ("anyone who…", "people who want [category]", "all [demographic]"). **Validation: 11/11.** |
| **T7** | Cross-engine contradiction check — rejects a candidate that conflicts with a validated prior decision, naming the conflicting decision in the feedback. **Validation: 4/4 + 1/1 abstention.** |
| **T8** | Audience 3-attempt retry loop around the segment + ads-targeting calls, temperature ladder 0.3 → 0.4 → 0.5, structured rejection feedback injected on retry. |
| **T9** | Positioning retry bump (`SPECIFICITY_MAX_RETRIES` 1 → 2, env-overridable), temperature escalation, rejection-feedback injection. |
| **T10** | Offer alignment retry extended to 3 attempts, temperature escalation, rejection feedback. |

**Verdict space (D3):** breadth → `interchangeability` → `contradiction`, each verdict a strict enum; NOT_RUN is an explicit classification, never a silent pass.

---

## Phase 2 — AI Generation Mode ✅

**Status: COMPLETE (sequential: audience → positioning → offer).**

| Task | Delivered |
|------|-----------|
| **T11** | Injected the doctrine block into the audience / positioning / offer prompt builders (new `doctrine?` param → `buildDoctrineBlock`). |
| **T12** | Flipped the three engines to **candidate generation + full gate battery**: generate 2–3 candidates from market data + doctrine + anchor + prior decisions, then run every candidate through breadth + interchangeability + contradiction. `server/shared/candidate-gate-battery.ts` (`runCandidateGateBattery` → `GateBatteryResult`) is the single wiring point; breadth short-circuits (judges recorded NOT_RUN, never silently accepted). |
| **T13** | Deterministic last-resort fallback after retries are exhausted, recorded as `mode:"fallback"` with an explicit reason — never silent. |
| **T14** | Boss enrichment: optional `enrichedStrategicContext` on `BossRunInput` (Q1/Q2 lane-run inputs untouched); narrative grounding allowlist expanded with validated `RunStrategicContext` outputs; interpretation-only preserved on Q2/user overlays. |

---

## Phase 3 — Channel Selection Engine (in-place upgrade) ✅

**Status: COMPLETE — architect evaluate_task PASS.**

`channel_selection` already existed, so it was upgraded in place (no new orchestrator switch case, no parity-observer change).

- New async wrapper `runChannelSelectionWithAIProposal` in `server/strategy/channel-selection/ai-channel-proposal.ts` (engine dir, LLM-whitelisted). The synchronous `runChannelSelectionEngine` is untouched and remains the deterministic constraint floor + recorded fallback.
- The AI picks the primary channel **only from the deterministically-viable channels** (whitelist floor — it cannot resurrect a hard-blocked channel) and supplies a product-specific rationale.
- `runCandidateGateBattery(kind="channel_rationale")` is the sole judge; 3 attempts, temperature 0.3 → 0.4 → 0.5; **every** attempt recorded in `gateTrace` including NOT_RUN.
- `mode` / `fallbackReason` are strict enums. On a validated swap, all primary-derived fields are recomputed in lockstep.
- `index.ts` touched only at the call site (hash bumped `channel-selection-v1` → `v2`; `appendPriorDecision` on both fresh and reuse paths). Budget governor untouched.
- Fix applied: `proposer_failed` is now classified separately from `gates_exhausted` (B4).

---

## Phase 4 — Telemetry & Verification ✅

**Status: COMPLETE — architect review PASS, no severe issues.**

### T16 — Per-run AI-path telemetry + aggregator

- Engines `audience` / `positioning` / `offer` emit an `EngineAiPathEmission` (`mode`, `attempts`, `failedGates[]`, `fallbackReason`) via `emissionFromBattery(finalPassed, attempts)` onto `output.aiPathTelemetry`. `channel_selection` carries its `aiChannelProposal`.
- Aggregator `server/orchestrator/ai-path-report.ts` → `buildAndRecordAiPathReport(results, doctrineResolution)` rolls per-engine telemetry into `orchestrator_jobs.ai_path_report` and records two **label-less** gauges (`engineCoverage`, `attemptSuccessRate`) — no tenant labels.
- `reused` / `not_run` engines are **excluded** from coverage denominators (B4 — counting them would inflate coverage). Null ratios carry an explicit reason field (D5). The aggregator has **no LLM import** and is < 200 lines (replay ESLint constraint satisfied).

### T17 — Operator endpoint

- New `GET /api/diagnose/ai-path-report?runId=&source=`.
- Admin-gated via `METRICS_ADMIN_TOKEN` + `timingSafeEqual`, **fail-closed 401** when the token is absent (mirrors `/api/admin/continuity/panel`; not `requireCampaign`).
- Missing report → `200 { available:false, reason }`, **never 404** (visibility over silence). Loads an orchestrator job or a boss run (which carries a copied envelope with provenance). All verdict-shaped fields use strict `z.enum`; response is schema-validated before send.

### T18 — Verification runs

`.local/scripts/validate-ai-path-report.ts` drives the **real** loop — `runCandidateGateBattery` → `emissionFromBattery` → real `buildAndRecordAiPathReport` — with live LLM judges (a full DB+proxy orchestrator run is not reproducible in a dev shell; this exercises the same code the engines/aggregator use, disclosed in the harness header).

**Result: 6/6 hard assertions passed.**

**With `product_anchor` — full report:**
- `doctrineResolution = "anchored"`
- All four engines: `mode = "ai"`, `attempts = 2`, `failedGates = ["interchangeability"]`
- `engineCoverage = 1`, `attemptSuccessRate = 0.5`

**Generic-rejected-then-corrected (per engine):**

| Engine | Generic candidate (attempt 1) | Specific candidate (attempt 2) |
|--------|-------------------------------|--------------------------------|
| audience | REJECTED ← interchangeability | ACCEPTED ✔ |
| positioning | REJECTED ← interchangeability | ACCEPTED ✔ |
| offer | REJECTED ← interchangeability | ACCEPTED ✔ |
| channel_selection | REJECTED ← interchangeability | ACCEPTED ✔ |

**Without `product_anchor` — degraded path confirmed:**
- `resolveDoctrine(null).resolution = "business_level_degraded"` ✔
- Doctrine block renders the business-level banner with **no `[not set]` placeholder** ✔
- Aggregated report carries `doctrineResolution = "business_level_degraded"` ✔

**Post-review hardening (Phase 4):** `emissionFromChannelProposal` now guarantees a `mode="fallback"` emission always carries an explicit non-null reason (B4/D5 parity with `emissionFromBattery`).

---

## Overall status

| | |
|---|---|
| Phases 0–4 | **COMPLETE** |
| Backend boot | Clean (schema floor v36) |
| Migrations | Applied (035, 036) |
| Type check (`tsc`) | 713 — **0 net-new errors** (pre-existing baseline only; none in touched files) |
| Doctrine | D1 clean, D3 strict enums, D5 explicit reasons, B2/B4 explicit classification, NO-TENANT-LEAK verified |
| Judge validators | breadth 11/11 · interchangeability 8/8 · contradiction 4/4 (+1/1 abstention) |
| End-to-end verification | 6/6 hard assertions |
| Architect review | PASS at every phase — no severe/blocking issues |

**"Done means" (from the plan) — all criteria met:** all 4 phases implemented, backend boots clean, migrations applied, judges validated against synthetic examples, verification runs produce a readable ai-path-report, and architect review passes with no severe issues.

### Known infrastructure note (pre-existing, not caused by this work)
`.local/eslint-rules/` is gitignored and untracked; 6 of 8 rule files referenced by `eslint.config.js` are missing on disk, so `npm run lint` cannot load its config and the line-ceiling / semantic rules are currently unenforced by CI. Doctrine (D1/D3, line ceilings) was therefore enforced manually via targeted `rg` checks throughout Phases 1–4.
