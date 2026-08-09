---
name: Plan synthesis truncation & snapshot-replay regeneration
description: Why orchestrator plan synthesis silently degraded, and how to regenerate only the synthesis layer from persisted snapshots without rerunning engines.
---

## Truncation failure mode
The orchestrator plan-synthesis LLM call asks for a large nine-section JSON plan; an output-token ceiling far below the required size makes the provider cut mid-string (`finish_reason: "length"`), JSON.parse throws "Unterminated string", and a single-attempt path immediately writes a `degraded_ai_failed` plan.
**Why:** the failure is invisible unless finish_reason and attempt count are logged — the degraded plan looks like a model quality problem.
**How to apply:** any big-JSON LLM call needs (1) a ceiling sized to the schema, (2) bounded retries on malformed output, (3) explicit rejection of `finish_reason:"length"`, (4) per-attempt logging. Deterministic fallback stays as last resort.

## Synthesis-only regeneration pattern
To regenerate a plan from an existing validated run WITHOUT rerunning engines: reconstruct the `results` map from job-bound snapshot rows and call the real `synthesizePlan`, then mirror the orchestrator finalize step (job row plan_id → new plan).
- Engines with a `result` column (channel_selection, iteration, retention, budget_governor, strategy_validation) store the full output verbatim.
- MI has its own rebuilder `buildResultFromSnapshot` (camelCase the row first); crossSignalDecisions live inside `diagnostics_data`.
- Other engines: map columns camelCase, but preserve engine-emitted nesting — e.g. offer `selectedPainRoles` lives INSIDE `primaryOffer`, so the extractor truthfully sees core=none; do NOT flatten nested objects or you change pain-role extraction.
- Verify fidelity by comparing the AUDIENCE_PAIN_ROLES_PRESERVED / locked-decision log lines with the original run.

## degraded_no_decisions is truthful
If ALL cross-signal decisions are policy-blocked (WEAK_SIGNAL), the plan is `degraded_no_decisions` even when the AI synthesis succeeds and verification passes. Fix the signal quality/policy, never the degradation label.
