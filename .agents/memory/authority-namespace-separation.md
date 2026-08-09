---
name: Authority namespace separation
description: Pain Registry = problem authority; Product Anchor/capability registry = capability authority; audited anchor writes
---

- Two namespaces, never merged: Pain Registry decides WHAT PROBLEM exists; Product Anchor (via `capability-registry.ts` deterministic derivation, stable `cap_<hash>` IDs) decides WHAT THE PRODUCT CAN DO. Engines only connect them.
- Enforcement is layered: grounding-contract prompt rules (problem/capability/synthesis) + deterministic `authority-validator` (UNAUTHORIZED_PROBLEM / UNSUPPORTED_CAPABILITY / PAIN_CAPABILITY_MERGE) as gate 0 of the candidate battery + interchangeability judge authority section + build-plan final scan.
- **Why:** a strategy-derived differentiator ("Refund & Access Pipeline Failure method") was promoted into the Product Anchor and, via grounding RULE 1, poisoned ALL engines' problem framing (anchor-poisoning incident). Cleaned 2026-08-09 via the tenant route.
- Product Anchor writes go ONLY through `writeProductAnchorAudited` (product_anchor_audit table, migration 060); `checkAnchorAuditConsistency` at doctrine-seed detects unaudited/direct-SQL writes (loud log, never blocks — legacy anchors have no audit trail).
- DNA-enrichment resolve now validates the candidate against authoritative BDL/anchor fields; non-ACCEPT requires explicit `confirmUnverified=true` (recorded as USER_CONFIRMED_UNVERIFIED). No automatic promotion of strategy language into identity.
- Refund/complaint mentions citing AEL root causes ([RC*]) in plans are legitimate market evidence — do not "clean" them; only the anchor's capability claims were poisoned.
- run-real-campaign.ts already had a single-shot arm guard (REAL_RUN_ARMED file consumed before work, or REAL_RUN_CONFIRM=YES) — check for an existing guard before adding one.
- POST_PURCHASE_FRICTION pains route ONLY to retention (USES_BY_CLASS); test fixtures for the registry need `eligible` + `allowedUses` (use `allowedUsesForClass`).
