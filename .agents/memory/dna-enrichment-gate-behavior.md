---
name: DNA Enrichment Gate — verification behaviour
description: How the Path A/Path B DNA enrichment gate behaves end-to-end, and why a richer product_anchor can reach FEWER engines than a blander one.
---

# DNA Enrichment Gate — verified runtime behaviour

- **Path A is candidate-only and MUST re-pass the UNCHANGED interchangeability judge.** On judge rejection, the engine fires `DNA_ENRICHMENT_TRIGGER`, makes exactly ONE grounded-LLM candidate call (grounded in real AEL evidence, e.g. `refs=RC2+CC2`), and re-submits to the same judge. If the candidate still fails, `BATTERY_GATE: EXHAUSTED` after 3 attempts and the engine proceeds degraded. **A truthful rejection here is the correct outcome — the gate must never manufacture a pass.**
- **Path B then raises a dashboard flag** (`DNA_ENRICHMENT_REQUEST_RAISED` → one `open` row per engine in `dna_enrichment_requests`, engine_kind ∈ {positioning_claim, offer}). The stored `suggestion_text` IS the customer-facing card copy ("Based on what competitors keep getting wrong, your edge may be: … Confirm it, or write one line describing what you do that no competitor does."). Card reads `/api/dna-enrichment/pending`, resolves via `/api/dna-enrichment/resolve`.

## Non-obvious: engine-count is NOT a monotonic quality signal
**Why:** A richer `product_anchor` can move `doctrineResolution` from `business_level_degraded` → `anchored`, yet still make the Positioning engine synthesise an ABSTRACT territory phrase (e.g. "marketing capability transformation validation gap") that (a) the interchangeability judge still rejects as generic, and (b) the Integrity engine flags as offer↔audience-pain MISaligned. That integrity `overallStatus=FAIL / safeToExecute=false` fires `BLOCKED_BY_INTEGRITY`, halting the downstream engines (statistical_validation, budget_governor, channel_selection, iteration, retention → PENDING/NOT_REACHED) and driving System Control `PIPELINE_INCOMPLETE`.
- Result observed: blander anchor ran 15/15 engines (all degraded) but still BLOCKED; richer anchor ran only 9/15 but also BLOCKED. **Fewer engines reached ≠ regression** — trace it to the integrity gate + judge, both unchanged, reacting to genuinely degraded offer/funnel outputs.
**How to apply:** When verifying enrichment/anchor changes, judge success by the gate loop closing (Path A fired once → Path B flag raised, no WRITE_FAILED, `DEPTH_CASCADE_BLOCKED=0`), NOT by engine completion count. Compare System Control block codes + `doctrineResolution` against the prior run, not raw engine totals.
