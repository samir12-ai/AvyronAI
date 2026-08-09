---
name: Source-agnostic customer-origin evidence
description: Cross-signal layer evidence philosophy — semantic origin roles, independent-voice counting, CTA metadata containment
---

Rule: cross-signal validation classifies evidence by SEMANTIC ORIGIN (canonical contract in `server/market-intelligence-v3/evidence-origin.ts`), not by platform. `real` origin = CUSTOMER_ORIGIN (formal reviews AND provenance-validated social comments); formal review platforms are optional sources, never prerequisites.

Key invariants:
- Comment promotion is fail-closed: owner/unknown-author/spam/low-signal/CTA-label/non-substantive comments are rejected (`validateCustomerComment`). Pre-migration rows without `authorType` need a username or they're rejected UNVERIFIED_AUTHOR.
- Independence = distinct voices, not platforms: cross-posted identical competitor text is deduped to ONE voice; different customer authors on one platform are separate voices (`independentVoiceCount` drives classifyDecision; thresholds 0.45/0.70 unchanged).
- CTA detector labels (LinkInBio, Download…) are Avyron-generated METADATA — kept as ci_competitors analytics, never extracted as strategic signals (this alone was 8/30 weak decisions in the audited run).
- Circularity ban: Pain Registry statements are interpreted objects; only their underlying artifacts enter the layer, tagged with painId lineage (`linkedPainIds`) — a pain never corroborates its own evidence.
- Customer-origin signals get reviews-grade role weights regardless of platform (`roleWeightFor`).

**Why:** forensic audit of `degraded_no_decisions` showed 30/30 decisions were competitor/inferred with realRatio=0 because customer comments carried `originType: competitor` and reviews were the only `real` path.
**How to apply:** any new evidence source must be assigned an EvidenceOriginRole at ingestion; never add a platform-keyed origin branch.
