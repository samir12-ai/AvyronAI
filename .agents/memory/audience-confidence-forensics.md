---
name: Audience confidence forensics & v2 recalibration
description: How to decompose audience confidence values arithmetically, why v1 structurally blocked caption+comment campaigns, and the v2 model that replaced it
---

## Forensic method (P-6.7)
Decompose observed confidence values arithmetically against the model formula before blaming any input. Every production value must reconcile exactly — if it does, the model inputs are proven and the "wrong data" hypothesis dies. Example: 0.3933 = 1/3×0.5 + 1/5×0.3 + 10/12×0.2 proved competitorCount was 10, not 1.

**Why:** P-6.6 spent a whole investigation on a wrong premise (competitor filtering) that 5 minutes of arithmetic disproved.

Blueprint `competitorUrls` ≠ `ci_competitors` — never infer engine inputs from blueprint fields.

## v1 structural defect (historical)
v1: freq(hard 10%-of-corpus bar)×0.5 + sourceTypes/5×0.3 + inventory/12×0.2. A caption+comment-only campaign could never exceed 2/5 diversity (60% of that weight unreachable) and distributed pains never hit the 10% bar → 0 root causes → SGL BLOCKED → V2 pipeline never completed. This was the true root cause behind the BLOCKED_BY_INTEGRITY cascade era.

## v2 model (audience-confidence-v2, shipped 2026-07-28)
`freq(w/(w+k), k=max(3, 2% weighted corpus))×0.45 + primarySources(caption,comment)/2×0.30 + competitorSpread(distinct evidencing / max(2, ceil(30% inventory)))×0.25 + corroboration(+0.05/optional source, cap 0.10)`, clamp [0.05,0.95]. v1 kept exported as HISTORICAL; snapshots stamped with `confidence_model`.

**How to apply:**
- Score against what the platform *can* collect (2 primary sources), make optional sources additive bonus — never a structural penalty. Same precedent as `computePrimaryDataStrength`.
- Competitor spread must come from competitors *actually evidencing* the signal (threaded competitorId), not flat inventory.
- Aggregate corpus-wide metrics (language/awareness/maturity/intent) pass `distinctCompetitors = competitorCount` by construction.

## Traceability gotchas
- `confidenceBreakdown.finalConfidence` = **raw model output**. The emitted `confidenceScore` can differ: market-scope relevance scaling multiplies post-hoc (×0.4/×0.2/×0 for off-scope pains), root-cause promotion adds +0.1 driver-linkage boost, derived pains scale ×0.5/×0.6. Downstream readers must not treat the breakdown as the final score.
- Signals born outside pattern matching (MI narrative-merged objections, bridge) carry their own confidence and no v2 breakdown — that's truthful, not a bug.
- When merging signals, union `sourceTypes`/`competitorIds` (see `mergeSignalProvenance`) or attribution under-reports.

## E2E outcome
With v2, the full V2 orchestrator completed 13/15 engines for the first time and wrote the first `strategy_roots` row. The pipeline's designed terminal stop is the Iteration Engine's user-input gate (`primaryKpi`, `dataWindowDays` — user-settable campaign fields), not a defect.
