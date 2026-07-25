# Feasibility Audit — Inverting the AI Architecture: "AI Proposes, Code Validates"

**Date:** 2026-07-07  
**Scope:** Read-only assessment — no code was modified.  
**Method:** Direct source-file reads with exact file/line evidence for every claim.

---

## A. CONTEXT PLUMBING

### Q1 — Can RunStrategicContext be threaded through the orchestrator without restructuring?

**Short answer: YES, with a targeted extension — no restructuring required.**

The orchestrator already threads a shared mutable context object (`ctx`) through every engine call. The relevant fields:

| Pointer | File / Line | What it is today |
|---|---|---|
| `ctx.ssc` | `server/orchestrator/index.ts` L241 | `SharedStrategicContext` — already live |
| `emitCommercialSignal(ctx.ssc, ...)` | L1607, L1805, L2180, L2310, L2626 | Engines write signals to SSC after they run |
| `ctx.ssc?.commercialSignals` | L2170, L2291 | Downstream engines read commercial signals |

**Engine execution order** (from switch-case labels in `server/orchestrator/index.ts`):

```
1. market_intelligence  (L1542)
2. audience             (L1570)  ← AEL built here after audience completes (L1625)
3. positioning          (L1748)  ← reads ctx.ssc.commercialSignals (buyerPsychology)
4. differentiation      (L1842)
5. mechanism            (L1948)
6. offer                (L2117)  ← reads gameDimension, strategy root
7. awareness            (L2255)  ← reads awarenessMeaning from SSC (L2417)
8. funnel               (L2382)
9. integrity            (L2502)
10. persuasion          (L2569)
11. iteration           (L3133)
12. retention           (L3267)
```

**What already works:** `buyerPsychology` emitted at step 2 flows into Positioning (step 3). `gameDimension` emitted at step 3 flows into Offer (step 6). `valueArchitecture` emitted at step 6 flows downstream. The plumbing is proven.

**What needs to be added:** The current SSC lacks a `priorEngineDecisions` prompt-ready text block and a `strategicDoctrine` block seeded at run start. The SSC interface (`server/orchestrator/shared-strategic-context.ts` L289) would need two new optional fields:
- `doctrine?: StrategicDoctrine` — seeded once before step 1
- `priorDecisions: EngineDecisionSummary[]` — each engine appends its one-paragraph human-readable summary

No engine call signatures need to change — Positioning, Offer, Audience already receive `ctx.analyticalEnrichment` as an optional parameter through the same pattern. A `doctrine` block follows the same injection pattern.

**Verdict: READY** — thread + emit pattern already demonstrated across 5 signal types. Adding 2 new fields to SSC and seeding `doctrine` at run start is < 1 day of work.

---

### Q2 — Does the campaign data model carry a specific product/offer anchor?

**Short answer: NO — the campaign table has no product-level anchor. Schema change required.**

**`growth_campaigns` table** (`shared/schema.ts` L312–331):
```
id, name, stage, dayNumber, totalDays, testingAngles, winningAngles,
killedAngles, budget, spent, results, isActive, goalMode,
explorationBudgetPercent, startedAt, updatedAt
```
No `productName`, no `specificOffer`, no `productType`, no `productAnchor`.

**What exists nearby:**
- `strategy_root` table (L1719): `coreOffer text NOT NULL` — **business-level**, not campaign-specific. The shoe store's `coreOffer` would be "premium leather footwear," not "classic Oxford leather shoes."
- `campaignSelections` (L1114): has `selectedCampaignName`, `offerPhrases`, `pricingAnchors` — raw text blobs, no structured product fields.
- The audience engine receives `businessContext.coreOffer` and `businessContext.industry` — both business-level strings.

**What the design requires:** A structured product anchor per campaign:
```
productAnchor: {
  name: string,          // "Classic Oxford Leather Shoe"
  type: string,          // "physical product" | "service" | "digital" | "subscription"
  keyAttributes: string[],
  coreProblemSolved: string,
  differentiatingFeature: string
}
```

**Required change:** One migration adding a `product_anchor` text column (nullable JSON) to `growth_campaigns`. No FK changes. Existing rows default to null and fall back to `strategy_root.coreOffer`. **Verdict: NEEDS ADAPTATION** — one migration + onboarding field.

---

### Q3 — Can the Boss agent's input accept the enriched context without touching Q1/Q2 verdict logic?

**Short answer: YES — the Q1/Q2 rule paths are isolated; a new optional field is safe.**

The Boss entry point is `runBoss(input: BossRunInput)` at `server/boss/run.ts` L57. Looking at the existing flow:
- Q1 evaluation at L450 receives `phase6Ctx.q1_inputs` — a structured object with cluster comparison, composition, lead quality, outcome regression. These come from lane runs, not from the orchestrator's strategic context.
- Q2 evaluation at L501 receives `phase7Ctx.q2_inputs` — competitor interpretation, DNA, user data. Also lane-run sourced.

The `BossRunInput` type (`server/boss/types.ts`) would need a new optional field: `enrichedStrategicContext?: RunStrategicContextSummary`. This flows *around* Q1/Q2 — it would only be read when assembling the Boss's final action summary or the plan document. The verdict logic at L450 and L501 is never touched.

**Verdict: READY** — add one optional field to `BossRunInput`, no Q1/Q2 logic changes.

---

## B. GATES & VALIDATION

### Q4 — Existing validation gates per engine — can they accept AI-generated candidates?

**Current gates per engine:**

| Engine | Gate | File / Line | Works on AI output? |
|---|---|---|---|
| Positioning | `validateClaimGrounding(text, seed)` | `server/positioning-engine/engine.ts` L1583 | ✅ Yes — takes text + seed, validates content against signals |
| Positioning | Specificity gate (territory-level) | L2421–2470 | ✅ Yes — pattern-matching on territory string, no pre-computation dependency |
| Positioning | Grounding gate (per field) | L1822–1843 | ⚠️ Needs adaptation — currently validates against `seed` from pre-computed claim seeds. With AI-generated content, anchor seeds come from `RunStrategicContext` instead |
| Positioning | Stability guard (L12) | L2416 | ✅ Yes — structural checks, content-agnostic |
| Positioning | CEL/AT3 (AT3 via orchestrator) | orchestrator L1830 | ✅ Yes — substring blocklist, content-agnostic |
| Offer | `validateClaimGrounding` | `server/offer-engine/engine.ts` L2433 | ✅ Yes — same function |
| Offer | Alignment validation | L2886 | ✅ Yes — checks output structure |
| Offer | Axis correction retry | L1996–1998 | ✅ Yes — already a retry-with-feedback loop |
| Audience | Prescriptive text sanitizer | L1305 (approx) | ✅ Yes — regex-based, content-agnostic |

**One gate that needs adaptation:** The per-field grounding gate in Positioning (L1822) compares AI output against a `seed` object that currently comes from pre-computed claim seeds. With the proposed architecture, when AI generates freely (Analyst mode), there are no claim seeds — the gate must fall back to using `RunStrategicContext` anchor terms (territory names, mechanism name, product anchor) as the validation allowlist. The gate function signature already accepts an allowlist — only the caller needs updating, not the gate itself.

**Verdict: NEEDS ADAPTATION** — one caller-side change to the per-field grounding gate. All other gates accept AI candidates unchanged.

---

### Q5 — Is there existing LLM-judge infrastructure for the Specificity Gate?

**Short answer: YES — `server/positioning-engine/category-game.ts` implements the exact pattern.**

The file contains (verbatim from source):
- **Designer call:** `gpt-4.1-mini` @ temperature 0.3 — generates the strategic output
- **Hostile judge call:** `gpt-4.1-mini` @ temperature 0.1 — reviews and returns `"ACCEPTED" | "REJECTED" | "NOT_RUN"` with a reason (L233–252)
- **One retry with fix injected:** If judge rejects, `judgeFix` is injected into the prompt and the designer re-runs (L264–281)
- **Result struct:** `judgeVerdict`, `judgeReason`, `retryCount` (L47–49)
- **Safe fallback on judge failure:** `console.warn("[CategoryGame] FINAL_REJECTED ...")` (L326–332) — engine continues without the output

The interchangeability test described in the design (temp 0, YES/NO: "could this apply to any generic competitor?") is structurally identical to the hostile judge call in category-game.ts. A new `interchangeability-judge.ts` file using the same `aiChat` + parse + `judgeVerdict` pattern can be written in ~100 lines, reusing the proven architecture.

**Verdict: READY** — pattern exists and is battle-tested. New file needed, no new infrastructure.

---

## C. RETRY & TELEMETRY

### Q6 — Do LLM call sites support retry loops, or are they single-shot?

| Engine | Current call structure | File / Line |
|---|---|---|
| **Positioning** | `for (specificityAttempt = 0; specificityAttempt <= SPECIFICITY_MAX_RETRIES; ...)` — **2 total attempts** with rejection context injected on retry | `server/positioning-engine/engine.ts` L2421–2470 |
| **Offer** | Single generation call + **one alignment retry** if `offerAlignmentValidation.failures.length > 0` (L2886–2901) — **2 total attempts** | `server/offer-engine/engine.ts` L2886 |
| **Audience (segments)** | **Single-shot** — `await aiChat(...)` at L1227, no retry loop | `server/audience-engine/engine.ts` L1227 |
| **Audience (ads targeting)** | **Single-shot** — `await aiChat(...)` at L1363, catch returns hardcoded fallback | L1363 |
| **Channel selection** | No `server/channel-selection/` directory found — not implemented as a separate engine | N/A |

**Gap:** Positioning needs its retry constant bumped from `SPECIFICITY_MAX_RETRIES = 1` (2 attempts) to 2 (3 attempts) to match the design. Offer needs its single retry extended to 3. Audience needs a retry loop added from scratch.

**Verdict: NEEDS ADAPTATION** — Positioning is closest to ready (2 → 3 attempts); Offer needs extension; Audience needs a new loop.

---

### Q7 — Where would aiPathStatus persist?

The `boss_runs` table (`shared/schema.ts` L3015–3032) already has an `execution text` column (L3023) that stores a JSON blob of acquisitions, lane run IDs, and bridge run ID. This is the natural home.

Two options, ranked by implementation cost:

**Option A (no migration):** Extend the `execution` JSON blob with an `aiPathReport` key. No schema change. Downside: untyped, not queryable.

**Option B (one nullable column, 1 migration):** Add `aiPathReport text` to `boss_runs` — stores the per-run JSON struct:
```json
{
  "engines": [
    { "engine": "audience", "mode": "ai", "attempts": 2, "failedGates": ["specificity"], "durationMs": 1200 },
    { "engine": "positioning", "mode": "ai", "attempts": 1, "failedGates": [], "durationMs": 800 },
    { "engine": "offer", "mode": "fallback", "attempts": 3, "failedGates": ["grounding","grounding","specificity"], "durationMs": 3400 }
  ],
  "aiCoverage": 0.67,
  "totalAttempts": 6,
  "durationMs": 5400
}
```

Option B is preferred — it makes `aiCoverage` queryable with a JSON path expression. The operator endpoint `GET /api/diagnose/ai-path-report?runId=` reads this column by `boss_runs.id`.

**Verdict: READY** — one migration (Option B) or zero migration (Option A).

---

### Q8 — Cost and latency estimate per full run

**Baseline today** (with data flowing, approximate):
- ~6–8 LLM calls across core strategy engines
- Average duration: ~8–12s total for AI calls

**Proposed additions per full run:**

| Addition | Calls added | Latency added (est.) | Cost added (est.) |
|---|---|---|---|
| 2-3 generation candidates per engine × 4 engines | +8–12 calls | +8–12s | +$0.004–0.008 |
| Interchangeability judge (temp 0, ~150 tokens) × 4 engines × 1 attempt | +4 calls | +2–4s | +$0.001 |
| Retry attempt 2 (rejection feedback) × worst case 4 engines | +4 calls | +4–6s | +$0.002–0.004 |
| Retry attempt 3 (all 4 engines still failing) | +4 calls (rare) | +4–6s (rare) | +$0.002–0.004 |
| **Best-case total addition** | **+12 calls** | **+~10s** | **+~$0.005** |
| **Worst-case total addition** | **+20 calls** | **+~25s** | **+~$0.015** |

**Model:** All estimates use `gpt-4.1-mini` at ~$0.40/1M input tokens, ~$1.60/1M output tokens, avg ~800 tokens/call.

**Important caveat:** The above is **only valid when data flows**. With the current Bright Data 407 / zero-posts condition, every engine's LLM call receives near-empty input. Additional generation attempts on empty data will not improve quality and will add latency and cost with no benefit. The cost/latency delta is meaningful only after the data pipeline is unblocked.

---

## D. GAPS & RISKS

### Q9 — What cannot be supported without restructuring? (Blockers)

| Gap | Blocker description | File / Line Evidence |
|---|---|---|
| **Product anchor missing from campaign schema** | `growth_campaigns` has no product-level field. Without it, P1 (exact target segment) and P3 (product-problem fit) cannot be answered at campaign level. The fallback `strategy_root.coreOffer` is business-level and will produce the exact generic output the design is trying to prevent. | `shared/schema.ts` L312–331 |
| **Doctrine block not in engine prompt builders** | Every engine (audience, positioning, offer) has its own isolated `buildPrompt()` function. The doctrine P1–P6 block must be injected into each. Currently none of their function signatures accept a doctrine parameter. Changing 4 function signatures is adaptation, not restructuring — but it's required before any doctrine flows. | `server/audience-engine/engine.ts` L1190; `server/positioning-engine/engine.ts` L1735; `server/offer-engine/engine.ts` L1819 |
| **SSC `priorDecisions` field does not exist** | The current `SharedStrategicContext` (L289) has `commercialSignals` (typed, structured) but no `priorDecisions: EngineDecisionSummary[]` prompt-ready text block. Downstream engines cannot read prior decisions unless this is added. | `server/orchestrator/shared-strategic-context.ts` L289 |
| **`SPECIFICITY_MAX_RETRIES` is a hard constant** | Currently `= 1` (2 attempts). The design calls for 3 total attempts. Must be changed to a parameter or environment-variable override. | `server/positioning-engine/engine.ts` L2421 |
| **Audience engine has no retry loop** | The segment generation call (L1227) is single-shot with no retry structure. Adding 3-attempt loop with temperature escalation requires writing new code in the audience engine. | `server/audience-engine/engine.ts` L1227 |
| **No `channel_selection` engine exists** | The orchestrator switch has no `case "channel_selection"`. Budget/channel decisions are made inside the commercial-reasoning module (L3057: `channelOrchestration`), not as a separable generation engine. The design's "channel-selection" engine doesn't map to an existing component. | `server/orchestrator/index.ts` L1119 (type list) |

---

### Q10 — What is missing from this design?

1. **Partial doctrine handling.** P3 (product-problem fit) and P4 (channels where this segment actually is) depend on data that doesn't exist until the product anchor schema change is made AND populated via onboarding. The design doesn't define what happens when P3/P4 are empty — the engine would receive doctrine placeholders like `"[Product anchor not set — skip P3]"`, which could corrupt LLM reasoning. A **partial-doctrine fallback policy** needs to be specified (skip the principle entirely vs. use business-level fallback vs. halt the engine).

2. **Doctrine-consistency check between engines.** If Audience says "P1: segment = restaurant owners" and Offer says "P3: product fit = enterprise software teams," the system currently has no cross-engine contradiction detector for doctrine-level outputs. The SSC's `contradictions` array (already exists) could extend to doctrine contradictions, but the design doesn't mention this.

3. **The interchangeability judge prompt is not designed.** The category-game hostile judge (`category-game.ts` L173+) is a detailed multi-constraint prompt. The interchangeability test ("could this apply to a generic competitor?") needs its own specific prompt for each of the 4 output shapes (segment, territory, offer, channel). A generic "is this specific enough?" prompt will produce unreliable YES/NO verdicts. This is a design gap — 4 separate judge prompts need to be written and validated before implementation begins.

4. **No doctrine versioning.** P1–P6 will evolve as the product matures. The design doesn't say how doctrine changes propagate to cached snapshots (audience/positioning/offer snapshots use `inputHash` for reuse). A doctrine version should be part of the input hash so stale snapshots are invalidated when doctrine changes.

5. **aiCoverage metric definition.** The design says "overall aiCoverage % on the run summary." This needs a precise formula — is it `(engines that completed via AI path) / (total engines run)`? Or `(LLM calls that passed validation) / (total LLM attempts)`? The two metrics tell different stories about system health and should both be tracked separately.

6. **Pricing exclusion consistency.** The design correctly excludes pricing (P is excluded from P1–P6). But `campaignSelections.pricingAnchors` (schema L1146) exists and is already injected into some prompts. If a user has set pricing anchors, the doctrine block needs an explicit instruction to downstream engines: "pricing doctrine is in pricingAnchors — do NOT derive pricing recommendations from P1–P6."

---

### Q11 — What can be built and verified now (zero posts) vs. what needs live data?

**Can build and verify now, with business-profile data only:**

| Component | Why verifiable without posts |
|---|---|
| `server/shared/strategic-doctrine.ts` — P1–P6 struct, injectable text builder | Pure code — no data dependency |
| `RunStrategicContext` struct — doctrine + `priorDecisions[]` | Schema definition work |
| Orchestrator threading — doctrine passed to each engine call signature | Code change, testable with synthetic profile |
| Product anchor migration — add `product_anchor` column to `growth_campaigns` | Pure schema change |
| Interchangeability judge infrastructure — reusing `category-game.ts` pattern | Testable with synthetic positioning outputs |
| Audience engine retry loop — 3-attempt wrapper | Testable with mock LLM responses |
| `aiPathStatus` telemetry struct + persistence to `boss_runs` | Pure code + migration |
| Breadth check (gate B3) — regex on "anyone who...", "people who want [category]" | Pattern matching, no data |
| `SPECIFICITY_MAX_RETRIES = 2` constant change | 1-line change |
| P1–P6 doctrine output with business-profile only | Low quality but structurally correct — testable in SYNTHETIC_AUDIT_MODE |

**Requires live data to show value (not just compile):**

| Component | Why blocked |
|---|---|
| P2 (segment problems in this specific market) | Needs AEL causal chains from real audience posts; without them, doctrine P2 is a generic placeholder |
| P4 (channels where this segment actually is) | Needs competitor presence data (which platforms) + audience scrape signals |
| Interchangeability judge quality | Without competitor context, the judge can't assess "could this apply to a generic competitor?" — it has nothing to compare against |
| Signal anchor validation in specificity gate | With zero signals, every territory passes (trivially specific when nothing to compare); false-pass rate will be high |
| aiCoverage metric meaningful | With empty inputs, engines fall back after 3 failed attempts — `aiCoverage` will be 0 on every run, which is technically correct but not useful for quality measurement |
| Quality delta measurement | The whole point of the inversion is AI output that's more specific than deterministic seeds. Measuring this improvement requires having real posts to generate real seeds to compare against |

---

## Readiness Verdict per Component

| Component | Verdict | Blocker / Note |
|---|---|---|
| SSC threading (`RunStrategicContext`) | **READY** | Pattern already proven; add 2 fields to SSC interface |
| Product anchor schema | **NEEDS ADAPTATION** | One migration + onboarding UI field |
| Boss agent enriched context | **READY** | Add optional field to `BossRunInput`; no Q1/Q2 changes |
| Engine prompt doctrine injection | **NEEDS ADAPTATION** | 4 prompt builder function signatures need a `doctrine?` parameter |
| Existing grounding/AT3/stability gates | **READY** | Accept AI candidates unchanged |
| Per-field grounding gate anchor source | **NEEDS ADAPTATION** | Caller passes `RunStrategicContext` anchors instead of pre-computed seeds |
| Interchangeability judge infrastructure | **READY** | Reuse `category-game.ts` pattern; write 4 engine-specific prompts |
| Positioning retry (2 → 3 attempts) | **NEEDS ADAPTATION** | Constant + slight refactor |
| Offer retry (2 → 3 attempts) | **NEEDS ADAPTATION** | Extend existing retry branch |
| Audience retry (0 → 3 attempts) | **NEEDS ADAPTATION** | New loop, no blocker |
| Channel selection as AI generation engine | **BLOCKED** | No `channel_selection` engine exists; it lives inside `channelOrchestration` commercial module. Needs scoping decision. |
| `aiPathStatus` persistence | **READY** | One migration or JSON extension of `boss_runs.execution` |
| Operator telemetry endpoint | **READY** | Standard admin-gated route, no new infrastructure |
| Doctrine versioning in input hash | **NEEDS ADAPTATION** | Missing from design; required before cache reuse is safe |
| Interchangeability judge prompts (4) | **NEEDS ADAPTATION** | Must be written and validated before implementation begins |

---

## Recommended Implementation Order

**Phase 0 — Schema & infrastructure (no logic changes, fully verifiable now):**
1. Migration: add `product_anchor` to `growth_campaigns`
2. Migration: add `aiPathReport` to `boss_runs`
3. Create `server/shared/strategic-doctrine.ts` — P1–P6 struct + text builder
4. Add `doctrine` and `priorDecisions` fields to `SharedStrategicContext`
5. Seed `doctrine` in orchestrator at run start (before step 1)
6. Doctrine version token added to all engine input hashes

**Phase 1 — Gate & retry hardening (buildable and testable with synthetic data):**
7. Audience retry loop (3-attempt with temperature escalation + rejection feedback)
8. Positioning `SPECIFICITY_MAX_RETRIES` → 2
9. Offer retry extension → 3 attempts
10. Per-field grounding gate caller update (use `RunStrategicContext` anchors)
11. Interchangeability judge infrastructure (reuse category-game.ts pattern)
12. Write and validate the 4 engine-specific interchangeability judge prompts

**Phase 2 — AI generation mode (requires live data to measure quality):**
13. Inject doctrine block into all 4 engine prompt builders
14. Inject `priorDecisions` summary into Positioning, Offer, Awareness prompt builders
15. Switch from "compress pre-computed" to "generate from market data + doctrine" in Audience, Positioning, Offer
16. Enable `aiPathStatus` logging and telemetry endpoint
17. Run audit pipeline in `SYNTHETIC_AUDIT_MODE` against all 3 industries to baseline quality
18. Unblock Bright Data credentials → first real-data quality measurement
