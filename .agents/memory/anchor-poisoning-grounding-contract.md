---
name: Product-anchor poisoning × grounding contract RULE 1
description: How a fabricated differentiatingFeature in growth_campaigns.product_anchor forces refund-centric outputs in every engine, and how to prove anchor→output causation.
---

# Anchor poisoning is amplified by design, not by a routing bug

- `growth_campaigns.product_anchor` is **jsonb** — node-pg returns a parsed object. `String(row.product_anchor)` prints `[object Object]` (15 chars) and looks like corruption. Always `JSON.stringify` jsonb columns before judging content. A whole forensic session mis-ruled the anchor "corrupted/null" because of this.
- Grounding contract **RULE 1** (`buildGroundingContract`, server/shared/grounding-contract.ts) makes every judged engine (audience, positioning, differentiation, mechanism, offer-identity, funnel, awareness, persuasion) name `anchor.differentiatingFeature` **verbatim** as the product's core mechanism. `buildDoctrineBlock` additionally injects it as "Differentiating feature: …". So a poisoned differentiatingFeature saturates ALL engine outputs while the pain registry stays clean and deterministic routing still selects the correct pains — the contamination channel is Product Identity, not pain routing.
- **Causation proof recipe:** anchor n-gram fingerprinting. Take distinctive 2-4 grams from the anchor sentence ("live market mirror", "preempt refund triggers", key-attribute phrases) and count them in each run snapshot. Saturation across engines + `doctrineResolution:"anchored"` in the run's ai_path_report = proven anchor→prompt→output chain.
- **Write-vector audit:** every anchor-writing route bumps `updated_at`; a poisoned anchor with a stale `updated_at` proves a direct SQL write outside all routes (task agents / prior sessions share the DB). `anchorHash` is only logged at seedDoctrine, never persisted — don't hunt for it in snapshots.
- DNA-enrichment candidates assert fabricated capabilities ("Product X uniquely integrates its <invented> method…") derived from competitor complaints; if such text ever reaches the anchor without operator resolve, the echo loop is closed: enrichment re-proposes anchor-shaped candidates every run, and the interchangeability judge *approves* refund-centric outputs because they match the anchor.
