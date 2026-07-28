---
name: Unified memory architecture verdict (P-5 audit)
description: The approved-direction memory layer model and what was explicitly rejected — consult before adding any new persistence for intelligence
---

Full audit: `.local/validation/p5-memory-architecture-audit.md` (design-only; implementation gated on user approval).

## The five-layer model (house architecture for intelligence persistence)
L1 observations (cleaned up) → L2 confirmed events (append-only) → L3 frozen outcomes (immutable) → L4 evolving beliefs (upserted) → L5 validated interpretations (judge-gated). Each layer reads only at-or-below itself. New intelligence storage must be classified into a layer, not bolted on.

## Verdict — additive only
Keep every store as its own system of record. Approved direction: thin `evidence_registry` (pointer/lineage index, lazy registration, payloads stay in source tables), persisted `reasoning_runs` (cards or rejections + cited UIDs), append-only history for the three overwrite-in-place L4 stores.
**Rejected explicitly:** merging tables, memory graph/graph DB, embedding-based semantic retrieval (conflicts with citation doctrine at this scale).

## Durable facts uncovered
- `ci_competitors` has multi-writer fan-out (MI orchestrator, CI acquisition, profile store, routes) — any history capture there needs a DB trigger or a mandatory single writer module; convention hooks will leak.
- The snapshot-cleanup 20-per-campaign cap applies only to campaign-scoped snapshot tables; `performance_snapshots` is campaignScoped:false (30/90d only).
- Coverage-time (`windowTo`) ordering is the comparison rule but the `market_memory` reader still orders by `createdAt` — readers should move to coverage time.
- Judge rejections and reasoning-card runs are currently never persisted → reasoning accuracy unmeasurable (biggest gap; persisting insights/rejections was once deferred by user — don't re-propose as a task unprompted).
