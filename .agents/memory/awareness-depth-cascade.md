---
name: Awareness depth cascade & AEL v2 field contract
description: Why awareness DEPTH_FAILED cascades the whole 15-engine pipeline; the snake_case AEL v2 field contract consumers must match; the BuildPlanLayer reload gap.
---

## AEL v2 field contract (the silent-zero trap)
`AnalyticalPackage` (analytical-enrichment-layer/types.ts) is **snake_case** at the top level: `root_causes`, `causal_chains`, `buying_barriers`. Items carry `deepCause` / `surfaceSignal` / `causalReasoning` (root_causes) and `pain` / `cause` / `impact` / `behavior` (causal_chains). They do **NOT** carry `description` / `statement` / `rootCause`.

**Why this bites:** any consumer that reads camelCase (`causalChains`) or the wrong item field (`description||statement||rootCause`) matches **nothing** and returns `rootCauses=0` — which looks like "no data" (truthful degradation) rather than "wrong field name" (a bug). The failure is silent. `rootCauses=8` vs `rootCauses=0` in the myth-breaker STEP_1 log is the tell.

**How to apply:** when an AEL consumer reports empty/zero extraction, first confirm it reads the real snake_case contract + `deepCause`/`cause`, not that the data is missing. Fix by matching the contract; do NOT lower the depth gate.

## The cascade
awareness myth-breaker gets `rootCauses=0` → AEL treated MISSING → `depthScore` falls to the 0.1 floor → `DEPTH_FAILED` → SystemControl BLOCK → downstream engines NOT_REACHED → Build Plan INSUFFICIENT_DATA. One bad field read at engine 7 zeroes the whole run. depthScore gate threshold is 0.20; a genuinely-grounded myth-breaker scores ~0.55.

**celSourceTexts must carry substance:** the awareness depth gate scores `celSourceTexts`. If it only contains route labels and omits the myth-breaker (`mythBreakerStatement`/`beliefToContradict`/`contradictionLogic`) and `narrativeReframe`, the gate scores a strawman and fails even when the engine produced grounded output. `narrativeReframe` is attached dynamically via `(primaryRoute as any).narrativeReframe` — access it with the same cast, not the typed field.

## BuildPlanLayer reload gap (distinct bug, on the critical path)
`runBuildPlanLayer(accountId, campaignId, depthGateStatus?, sourceJobId?, analyticalEnrichment?)` takes the depth-gate map AND the AEL package as **caller-supplied params** and **never reloads either from DB**. So persisting AEL to `ael_snapshots` does NOT feed BuildPlan — it reads neither table. Passing `undefined` depthGateStatus → `missing_depth_gate_status` for every engine + `AEL_MISSING_PROPAGATED`.

**Integrity concern:** the production build-plan route sources `depthGateStatus` from `req.body.depthGateStatus` (client-controlled) — a client could choose which engines "cleared" the depth gate. The correct fix loads depthGateStatus + AEL server-side from the run's persisted state, never from req.body.

## Commercial reasoner industry propagation
The commercial reasoner resolves industry via the `COMMERCIAL_REASONER_CURRENT_INDUSTRY` env var (`resolveIndustry()` in commercial-reasoning/awareness-depth-interpreter.ts). There is **no canonical industry-slug column**; do NOT map BCL `BusinessModel` values (they differ from the allowlist slugs). Missing/mismatched industry → `INDUSTRY_NOT_ALLOWED` → reasoner skipped. On zod rejection the interpreter falls back to the deterministic depth floor by design (B3) — acceptable, not a gate bypass.
