---
name: Strategic angle selection forensics
description: Why Community/Peer Validation won Positioning — frequency-saturated argmax + array-order primary + absolute-only judges + unbounded LLM naming expansion; system-wide selection map.
---

# Strategic angle selection — proven mechanics (audit 2026-08-09, run campaign_1773576062201_6t0oxi_realrun_1786285706968)

- Positioning winner = `sort desc opportunityScore` then `finalTerritories[0]` (engine.ts ~1405, 3321). opportunityScore = base + min(1, freq/15)*weight + conf*0.15 (~2717/2735) — frequency saturates at 15, so any freq≥15 cluster maxes the dominant term; ties decided by cluster confidence, never by strategic fit, purchase relevance, or product connection.
- Community cluster (pain freq 20 + desire "community and belonging" freq 37) beat "complexity" 0.84 vs 0.81 purely on the 0.15*confidence term. "Most marketing lacks strategic direction" existed as a pain but at freq 1 → buried by design.
- Semantic expansion happens in `generateGroundedTerritoryNames` + LLM contrastAxis/enemyDefinition composition: "belonging/community" → "Community Validation and Social Proof" → "peer recognition / community-driven validation". No entailment check exists between cluster evidence and the generated strategic claim; the run's evidence quotes were about email accuracy and liking a marketing team.
- Judges (interchangeability, authority/specificity battery) are absolute validators over the already-chosen candidate; they never see rejected alternatives, so a coherent-but-inferior angle passes.
- Segment intelligence contradicting the winner (top segment = "Overwhelmed by Strategy Complexity Seeking Evidence-Grounded Clarity", priority 42) is persisted but not consulted at territory selection — lossy handoff (only pain/desire frequency clusters feed territory scoring).
- Same defect family elsewhere: pain registry = rank sort + first-eligible; Audience = first candidate set that passes gates + `audienceSegments[0]`; Mechanism = first differentiation vector + LLM pick over top-5 score-sorted claims; Differentiation = score-sorted argmax. provenance=system_default territories (confidence capped 0.30) can still win primary.
