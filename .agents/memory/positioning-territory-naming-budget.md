---
name: Positioning territory naming budget
description: Why generic Strategy Root/Mechanism/Offer DNA traces to a timed-out grounded-naming LLM call, not a template bug
---

The generic phrase family ("<domain> capability transformation validation gap",
"<domain> comparison evaluation framework failure") in Strategy Root / Mechanism /
Offer originates in positioning `generateGroundedTerritoryNames`. It is the
NAME source for signal-injected root_cause + psych_driver territories; on success
it emits product-specific names (territoryNameSource="llm"), on failure it falls
back per-territory to the static `translateToSystemTerritory` lookup
(territoryNameSource="template_fallback") — which is where the interchangeable
canned phrases live.

**Root cause of the doom loop:** the batched call used the client default 45s
hard timeout and a flat 800-token ceiling. A ~16-cluster batch deterministically
timed out (`TERRITORY_GENERATION_FAILED reason=Request timed out.`), so EVERY
territory fell back to template phrases → generic Mechanism/Claim DNA → the
interchangeability judge (correctly) rejected it → DNA_ENRICHMENT_REQUIRED /
DEPTH_FAILED cascaded to Offer.

**Why:** big batched LLM calls need timeout + token budgets sized to batch size,
plus a retry — a single flaky/slow call otherwise degrades the whole strategy
chain silently while looking like a template/gate problem.

**How to apply:** when template_fallback territories show up, check the
positioning log for TERRITORY_GENERATION_FAILED first — do NOT edit
translateToSystemTerritory or the judge. Budget = min(180s, 60s+5s/cluster) and
tokens = min(2000, 300+80/cluster); truncation (finish_reason:"length") is a
retryable failure, never parse a partial array. Fail-closed to template fallback
is deliberate and must stay.
