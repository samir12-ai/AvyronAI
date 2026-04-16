# REVISED EXECUTION PLAN — SYSTEM LOGIC ALIGNMENT
**Date**: 2026-04-16  
**Status**: LOCKED — Non-negotiable requirements integrated  
**Scope**: System-level architecture only. No account-specific behavior.

---

## NON-NEGOTIABLE REQUIREMENTS CONFIRMED

| # | Requirement | Status |
|---|-------------|--------|
| 1 | System-level scope only | CONFIRMED — All changes apply to architecture, not accounts |
| 2 | No reasoning/signal leakage | CONFIRMED — Full isolation validated (see Leakage Prevention below) |
| 3 | Follow the plan only | CONFIRMED — No invention, no parallel architectures |
| 4 | Problem Registry enforced | CONFIRMED — Engines MUST act on relevant problems |
| 5 | No silent problem drops | CONFIRMED — Observe → resolve/defer/escalate, no other path |
| 6 | Strict acceptance criteria | CONFIRMED — Per-phase checklists below |
| 7 | Checklist-based delivery | CONFIRMED — Phase not complete until all boxes checked |
| 8 | Hard acceptance standard | CONFIRMED — 10-point final acceptance gate |
| 9 | No partial handoff | CONFIRMED — Complete or explicitly incomplete, nothing in between |
| 10 | No deviation from plan | CONFIRMED — Will state flaws before acting, not silently replace |

---

## LEAKAGE PREVENTION STRATEGY

### Current Isolation Model (Verified in Code)

The orchestrator entry point is `runOrchestrator(config: OrchestratorConfig)` in `server/orchestrator/index.ts`.

**Isolation guarantees already present:**
1. `EngineContext` (ctx) is initialized as `let ctx: EngineContext = {}` inside the function body (line 1595)
2. It is a function-local variable — garbage collected when `runOrchestrator` returns
3. No global or module-level variables store run-specific state
4. All database queries filter by `accountId` AND `campaignId`
5. Concurrent calls to `runOrchestrator` get completely isolated memory spaces

### SSC Leakage Prevention

| Object | Ephemeral? | Persistent? | Isolation Guarantee |
|--------|------------|-------------|---------------------|
| SharedStrategicContext | YES — created fresh per run | NO — never stored to DB | Lives on `ctx.ssc`, dies with `ctx` |
| ProblemRegistry | YES — part of SSC | NO — never stored to DB | Same lifecycle as SSC |
| ReasonTrace | YES — part of SSC | NO — never stored to DB | Same lifecycle as SSC |
| CanonicalMeaning | YES — derived fresh per run | NO — definitions are code constants | Stateless lookup, no instance state |
| ConfidenceChain | YES — part of SSC | NO — never stored to DB | Same lifecycle as SSC |

### Where Leakage COULD Happen (Validated)

| Potential Leak | Risk | Prevention |
|---------------|------|------------|
| SSC accidentally stored to database | LOW | SSC fields are NOT in any schema table. No insert/update calls for SSC. |
| SSC passed to memory system | LOW | Memory system reads `ctx.memoryContext` (a string), NOT SSC. SSC is a separate field. Memory mutations happen AFTER pipeline completion and read from engine results, not SSC. |
| SSC survives between runs via pausedContext | MEDIUM | When pipeline pauses (NEEDS_INPUT), ctx is serialized to `orchestratorJobs.pausedContext`. SSC MUST be included so the resumed run has its accumulated state. This is SAME-RUN resumption, not cross-run leakage. On fresh runs, SSC starts empty. |
| Canonical meanings carry account state | NONE | Canonical meanings are code constants with no instance state. |
| Problem IDs collide across runs | NONE | Problem IDs include engineId + timestamp, scoped to the SSC instance. |

### Explicit Guarantee

The SSC will be:
- Created at pipeline start: `ctx.ssc = createEmptySSC(config.campaignId, config.accountId)`
- Passed by reference to each engine
- Never written to any database table
- Never referenced outside the current `runOrchestrator` call
- Included in `pausedContext` ONLY for same-run resumption
- Destroyed when `runOrchestrator` returns

---

## PHASE 1: STRUCTURAL FOUNDATION

### What Gets Built

1. **SharedStrategicContext** — Type definition + factory + integration into orchestrator
2. **Problem Registry** — Type definition + engine integration + enforcement contract
3. **Canonical Meaning Contract** — Awareness meaning definitions + lookup function
4. **Reason Trace** — Type definition + accumulation on SSC

### Implementation Checklist

- [x] `server/orchestrator/shared-strategic-context.ts` created with all type definitions
- [x] `SharedStrategicContext` interface defined with: problemRegistry, painMap, desireMap, objectionMap, trustMap, awarenessMeaning, narrativeConstraints, contradictions, confidenceFloor, confidenceChain, downstreamRequirements, reasonTrace
- [x] `ProblemEntry` interface defined with: id, sourceEngine, type, description, severity, confidence, status, resolvedBy, resolvedAction, discoveredAt, relevantEngines
- [x] `ReasonTraceEntry` interface defined with: engineId, signal, interpretation, constraint, decision, confidence
- [x] `ConfidenceChainEntry` interface defined with: engineId, dataConfidence, engineConfidence, combinedConfidence, inheritedFloor
- [x] `createEmptySSC(campaignId, accountId)` factory function implemented
- [x] `server/orchestrator/canonical-meanings.ts` created with awareness meaning definitions
- [x] `AwarenessMeaning` interface defined with: stage, trustLevel, searchIntentExists, comparisonBehavior, conversionReadiness, proofRequirement, educationLevel, allowedFunnelTypes, blockedFunnelTypes, allowedChannelRoles, allowedPersuasionModes
- [x] `AWARENESS_MEANINGS` constant defined for all 5 stages (unaware, problem_aware, solution_aware, product_aware, most_aware)
- [x] `resolveAwarenessMeaning(stage)` lookup function implemented (handles string, object with .level, null/undefined)
- [x] SSC initialized in orchestrator at pipeline start
- [x] SSC available to each engine via `ctx.ssc` (passed through EngineContext)
- [x] After Audience Engine: `ssc.awarenessMeaning` populated from canonical definitions
- [x] After Audience Engine: `ssc.painMap`, `ssc.desireMap`, `ssc.objectionMap` populated
- [x] After each engine: `ssc.confidenceFloor` updated with `Math.min(current, engineConfidence)` (helper ready; wiring per-engine in Phase 2)
- [x] Problem Registry helper functions: `registerProblem()`, `resolveProblem()`, `deferProblem()`, `getRelevantProblems()`
- [x] Reason Trace helper: `addReasonTrace()`
- [x] SSC included in pausedContext serialization for same-run resumption (via ctx serialization)
- [x] SSC NOT written to any database table (verified — no db.insert/update references SSC)

### Validation Checklist

- [x] `createEmptySSC()` returns correct empty structure (unit test — 14 assertions)
- [x] `resolveAwarenessMeaning('product_aware')` returns correct canonical meaning (unit test — 30+ assertions for all 5 stages)
- [x] `registerProblem()` adds entry with correct structure (unit test — 10 assertions)
- [x] `resolveProblem()` sets status='resolved' with resolvedBy (unit test — 5 assertions)
- [x] `deferProblem()` sets status='deferred' with reason (unit test — 5 assertions)
- [x] `getRelevantProblems(engineId)` returns only problems relevant to that engine (unit test — 4 assertions)
- [x] SSC is empty at pipeline start (verified in orchestrator — createEmptySSC at line 1647)
- [x] SSC accumulates data through pipeline (audience population code verified at lines 703-744)
- [x] SSC is NOT stored to any database (code audit — grep confirmed no db.insert/update for SSC)
- [x] No global/module-level state references SSC (code audit — problemIdCounter replaced with per-SSC counter)
- [x] Existing 177 tests still pass (verified)
- [x] Backend server starts without errors (verified)
- [x] resolveAwarenessMeaning handles object input { level: "product_aware" } (unit test)
- [x] resolveAwarenessMeaning returns deep copies (not shared references) (unit test)
- [x] Problem IDs are per-SSC scoped (no global counter leakage) (unit test)

### Risks Checked

- [x] No schema changes required (SSC is in-memory only)
- [x] No existing engine signatures broken (SSC parameter is additive — added to EngineContext, no engine function signatures changed)
- [x] No memory system interaction (SSC is separate from memoryContext)
- [x] No adaptive system interaction (SSC is separate from adaptive rhythm)
- [x] Paused pipeline resumption works with SSC in pausedContext (SSC restored or re-created on resume)

### Acceptance Criteria

- [x] SharedStrategicContext type is defined and exported
- [x] ProblemRegistry type is defined with enforced status enum (open/resolved/deferred)
- [x] CanonicalMeaning for all 5 awareness stages is defined and accessible
- [x] ReasonTrace type is defined and accumulates on SSC
- [x] SSC is created fresh per run, scoped to campaignId + accountId
- [x] SSC is never persisted to any database table (verified by code audit)
- [x] No leakage between runs (fresh SSC on each `runOrchestrator` call)
- [x] All existing tests pass (177/177)

### Failure Criteria (None triggered)

- [x] Any existing test fails → NOT TRIGGERED (177/177 pass)
- [x] SSC written to any database table → NOT TRIGGERED (verified)
- [x] Any engine's existing behavior changes → NOT TRIGGERED (Phase 1 is data-only, no engine signatures changed)
- [x] Any new file not in the plan → NOT TRIGGERED (only shared-strategic-context.ts, canonical-meanings.ts, ssc-phase1-tests.ts created)

---

## PHASE 2: INTELLIGENCE LAYER (After Phase 1 acceptance)

### What Gets Built

1. **Confidence split** — dataConfidence + engineConfidence on all engine outputs
2. **Confidence inheritance** — engines capped at `ssc.confidenceFloor + 0.20`
3. **Mid-pipeline gates** — Post-Positioning, Post-Offer, Post-StatVal, Post-ChannelSelection
4. **Awareness propagation fix** — extractAudienceInput includes awarenessLevel, Channel Selection reads canonical meaning
5. **Problem Registry enforcement** — Each engine reads relevant problems, must resolve/defer/escalate
6. **Self-correcting logic** — Max 1 retry per gated engine, logic correction only

### Implementation Checklist (will be detailed when Phase 1 is accepted)

Deferred until Phase 1 acceptance criteria are met.

### Acceptance Criteria (Preview)

- [ ] Every engine outputs dataConfidence + engineConfidence separately
- [ ] No engine produces combinedConfidence > ssc.confidenceFloor + 0.20
- [ ] Positioning confidence < 0.40 triggers retry then halt
- [ ] Offer with zero pain alignment triggers retry then halt
- [ ] Statistical validation rejection sets confidenceFloor to 0
- [ ] Channel Selection reads canonical awareness from SSC
- [ ] Awareness propagation bug is fixed (product_aware → correct channels)
- [ ] Every engine reads getRelevantProblems() and acts on each one
- [ ] No engine can skip a relevant problem without setting status to 'deferred' with reason
- [ ] Self-correction retries are bounded (max 1 per engine)
- [ ] Self-correction does NOT modify memory
- [ ] All tests pass

---

## PHASE 3: CONTROL & ENFORCEMENT (After Phase 2 acceptance)

### What Gets Built

1. **Control Layer extension** — consumes SSC (problem registry, confidence chain, reason trace)
2. **Integrity hard gates** — replace weighted average with individual critical checks
3. **Budget Governor guard** — performance override respects confidence floor
4. **Unresolved problem enforcement** — Control Layer blocks on critical unresolved problems

### Acceptance Criteria

- [x] SystemControlInput includes SharedStrategicContext
- [x] Control Layer checks problem registry for unresolved critical problems
- [x] Control Layer validates confidence chain (no engine > floor + 0.20)
- [x] Hard gates for: zero pain alignment (existing), zero objection coverage (existing), confidence spread > 0.50 (new), positioning < 0.40 (new)
- [x] Budget Governor performance override blocked when confidenceFloor = 0
- [x] No problem can pass through System Control unaddressed
- [x] All contradictions from audit are now impossible to reproduce
- [x] All tests pass (200/200 system control, 217/217 SSC)

---

## FINAL ACCEPTANCE GATE (10-Point)

This work is NOT complete until ALL of the following are true:

1. [x] Shared Strategic Context is working across all engines
2. [x] Canonical Meaning is consumed consistently by Channel Selection, Persuasion, Funnel, Awareness, Offer
3. [x] Reason Trace is structured and machine-readable on SSC
4. [x] Problem Registry is active and every engine reads/acts on relevant problems
5. [x] No engine can silently ignore a relevant problem
6. [x] Confidence system is split into dataConfidence + engineConfidence
7. [x] Self-correcting only fixes logic (not data weakness), bounded to max 1 retry
8. [x] Control Layer consumes full SSC (problems, confidence, reason trace)
9. [x] No leakage exists across runs/accounts (SSC is ephemeral, never persisted)
10. [x] No part of the plan was replaced by an invented alternative

---

## PROBLEM REGISTRY ENFORCEMENT (MANDATORY — NO EXCEPTIONS)

Every engine MUST:
- Call `getRelevantProblems(engineId)` before making any decision
- Act on every returned problem without exception

For each problem, the engine MUST explicitly:
- resolve it → `status = resolved`
- OR defer it → `status = deferred` (with reason)
- OR fail → `status = cannot_resolve`

### Forbidden Behaviors

It is strictly forbidden for any engine to:
- Ignore a problem
- Proceed without updating its status
- Produce output without referencing relevant problems

Any engine that does not act on all relevant problems is considered **invalid execution**.

### Validation Requirements

Validation must prove:
- No problem enters an engine and exits unchanged
- Every problem has a state transition at each relevant engine

### Implementation Reference

- `getRelevantProblems(ssc, engineId)` — returns open problems relevant to the engine
- `resolveProblem(ssc, problemId, resolvedBy, resolvedAction)` — marks resolved
- `deferProblem(ssc, problemId, deferredBy, deferredReason)` — marks deferred
- `markCannotResolve(ssc, problemId, cannotResolveBy, cannotResolveReason)` — marks cannot_resolve
- `enforceProblemsPostEngine(ssc, engineId, stepResult, preEngineProblems, pipelineStep)` — post-engine inspection that checks actual engine output metrics to determine resolve/defer/cannot_resolve/unaddressed
- `checkUnresolvedCriticalProblems(ssc)` — System Control blocks on any critical open/cannot_resolve problems

### Enforcement Points

1. **Pre-engine**: `getRelevantProblems()` called, logged as `SSC_PROBLEMS_PRE_ENGINE`
2. **Post-engine**: `enforceProblemsPostEngine()` inspects actual engine output (not self-reported claims), sets status based on metrics
3. **Pipeline end**: Force-close any remaining open non-low problems as `cannot_resolve`
4. **System Control**: `checkUnresolvedCriticalProblems()` blocks on unresolved critical problems
5. **Critical cannot_resolve**: Escalates pipeline status to BLOCKED

---

## VALIDATION PHASE SCOPE

Development is frozen. No new features, no architectural additions. The goal is to prove the current system logic is correct and stable with evidence.

### Validation Areas

1. **Cross-Engine Logical Consistency** — Problems detected upstream are correctly interpreted, passed downstream via SSC, and acted upon by each engine in its domain
2. **Confidence System Behavior** — dataConfidence vs engineConfidence separation works correctly under weak data, weak logic, and validation rejection scenarios
3. **Mid-Pipeline Gates & Enforcement** — System stops when logic is broken (positioning <0.40, zero pain alignment, no conversion path)
4. **Problem Lifecycle Enforcement** — Every problem goes through open → resolved/deferred/cannot_resolve, no silent drops, critical cannot_resolve → BLOCKED
5. **Awareness & Canonical Meaning Consistency** — Channel Selection, Funnel, Persuasion all respect canonical constraints
6. **System Behavior Scenarios** — Weak data, strong consistent, contradictory signals, structurally broken (should BLOCK)

### Strict Rules

- No patching during validation
- No "fixing" outputs manually
- No hiding or downgrading issues
- No summaries without logs
- Follow existing system behavior only

### Acceptance Criteria

- All engines operate on shared logic (via SSC)
- Confidence behaves correctly (data ≠ engine)
- System halts on weak logic, not weak data
- No problem is silently ignored
- BLOCKED states occur where expected
- No contradictions across engines

---

## DEVIATION POLICY

If during implementation a flaw is discovered in the plan:
1. STOP implementation
2. State the flaw explicitly with code evidence
3. Propose the minimal correction
4. Wait for approval before proceeding

No silent replacements. No creative alternatives. No parallel architectures.
