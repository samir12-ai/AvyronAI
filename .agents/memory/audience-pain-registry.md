---
name: Audience pain registry & role routing
description: How authoritative Audience pain roles flow Strategy Root → engines → plan synthesis, and the invariants that must hold.
---

# Audience pain registry & role routing

**Rule:** `strategy_roots.approvedAudiencePains` doubles as the authoritative pain registry (enriched in the Strategy Root assembler — no separate table). Engines hydrate roles from it, never invent them:
- Offer selects the highest-priority pain eligible for `offer_core` and keeps objection pains in a separate role; merging pain IDs is a validation failure.
- Retention selects the highest-priority `retention`-eligible pain (`POST_PURCHASE_FRICTION`); such pains are never `offer_core`-eligible.
- Engines emit `selectedPainRoles` on **every** return path (including deterministic fallbacks), so preservation survives AI failures.
- Plan synthesis (`extractAudiencePainRoles`) preserves engine-selected roles verbatim — it never reselects, flattens, or merges; violations (`OFFER_CORE_PAIN_MERGED`, `RETENTION_PAIN_CONFLICTS_WITH_CORE`) are recorded on the plan, not repaired.

**Why:** Real but contextually wrong signals (e.g. refund friction) were hijacking core positioning. Classification + allowed/prohibited uses keep each signal in its legitimate downstream role without discarding it.

**How to apply:** When adding pain consumption to another engine, hydrate from the root registry via `selectPainForUse(pains, <use>)`, pass only enriched records (with `painId` — never reconstruct registries ad hoc, that poisons lineage validation), and attach the chosen role to the engine result rather than re-deriving it downstream. Classification is deterministic and evidence-only by design (LLM classifier deliberately not used — determinism beats nuance here).

**Gotcha:** legacy roots without `painId` records are valid — registry validation only engages when records carry `painId`.
