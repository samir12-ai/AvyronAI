# Control Layer Architecture — Technical Validation & Design

**Date:** April 15, 2026
**Purpose:** Validate proposed Control Layer against actual codebase, define integration, prevent conflicts
**Method:** Code-grounded analysis with exact file paths, line numbers, and function references

---

## Table of Contents

1. [Is This Architecture Directionally Correct?](#1-is-this-architecture-directionally-correct)
2. [Does This Conflict with the Existing Agent/Adaptive System?](#2-does-this-conflict-with-the-existing-agentadaptive-system)
3. [What Belongs to Control Layer vs. Current Agent System?](#3-what-belongs-to-control-layer-vs-current-agent-system)
4. [Where Does the Control Layer Sit in the Current Flow?](#4-where-does-the-control-layer-sit-in-the-current-flow)
5. [What Should the Control Layer Consume as Inputs?](#5-what-should-the-control-layer-consume-as-inputs)
6. [What Outputs Should It Produce?](#6-what-outputs-should-it-produce)
7. [Which Warnings Should Be Upgraded to Hard Blocks?](#7-which-warnings-should-be-upgraded-to-hard-blocks)
8. [What Self-Correcting Actions Are Safe to Automate?](#8-what-self-correcting-actions-are-safe-to-automate)
9. [Should It Wrap, Replace, or Consume Existing Gates?](#9-should-it-wrap-replace-or-consume-existing-gates)
10. [Cleanest Implementation Path](#10-cleanest-implementation-path)

---

## 1. Is This Architecture Directionally Correct?

**Yes. The architecture is directionally correct, and the codebase validates the need for it.**

### Code-Level Evidence

The current system has a clear architectural gap: there is no single point of final authority between engine completion and plan storage. Here is the exact flow today:

```
server/orchestrator/index.ts:

Line 1806:  Engine loop ends
Line 1818:  runSystemIntegrityValidation()    → generates report, stores it
Line 1826:  getGovernanceSummary()             → logs SGL coverage
Line 1832:  if (overallStatus !== "BLOCKED")   → THE ONLY GATE before synthesis
Line 1834:    synthesizePlan()                 → generates and stores plan
Line 1837:    writeStrategyMemoryEntries()     → persists to memory
Line 1846:  Update job record
Line 1884:  Return result
```

The gap: between line 1818 (integrity report generated) and line 1832 (plan synthesis gate), the ONLY check is `overallStatus !== "BLOCKED"`. This status is set by engine-level failures (individual engines returning ERROR/BLOCKED), NOT by cross-system analysis.

The cross-engine integrity override (`plan-synthesis.ts:1069`) runs INSIDE `synthesizePlan()`, meaning it can set `safeToExecute=false` but cannot prevent the plan from being created. The plan is always persisted — it just gets tagged.

**What's missing:**

1. **No unified system state assessment** — Integrity report, SGL summary, budget decision, channel status, CEL results are all generated but never aggregated into a single verdict BEFORE synthesis.

2. **No structural validation gate** — The system checks scores (integrityScore, signalTrustedRatio) but doesn't check structural questions like "is there a real conversion path?" as a hard gate.

3. **No correction authority** — When warnings are generated, nothing in the current flow can trigger a targeted fix. Warnings are logged and passed downstream.

4. **No single final gate** — There are 5+ separate gate systems (execution-activation, gates/registry, task-composer, budget governor, signal governance) that each enforce independently. No single authority aggregates them.

The Control Layer fills exactly this gap.

---

## 2. Does This Conflict with the Existing Agent/Adaptive System?

### No conflict if these boundaries are respected:

| Agent/Adaptive System Responsibility | Control Layer Responsibility | Boundary |
|---------------------------------------|------------------------------|----------|
| Performance monitoring (CTR, ROAS, CPA) | Structural completeness checks | Agent monitors METRICS, Control checks STRUCTURE |
| Memory write/read/decay/flip | Using memory system for persistence | Control USES memory system, doesn't replace it |
| Adaptive rhythm (content format frequency) | Bounds on rhythm (max/min limits) | Agent TUNES frequency, Control sets BOUNDS |
| Exploration budget (% for testing) | Whether testing is safe to execute | Agent decides WHAT to test, Control decides IF testing is safe |
| Iteration engine (test hypotheses) | Whether hypotheses are structurally sound | Agent GENERATES hypotheses, Control VALIDATES context |
| Prompt influence (REINFORCE/AVOID) | Execution blocking (safeToExecute) | Agent influences AI OUTPUT, Control governs EXECUTION |
| Autonomous worker (background monitoring) | Pre-execution final authority | Agent monitors ONGOING, Control gates BEFORE start |

### Specific Overlap Risks and Mitigations

#### Risk 1: Memory System Collision
```
Agent path:   iteration engine → writeStrategyMemoryEntries() → applyMemoryMutation()
Control path: verdict → correction action → ???

MITIGATION: Control Layer MUST NOT write directly to strategyMemory.
If it needs persistence, it uses its own table (system_control_verdicts)
or writes through existing policyEnforcedMemoryCheck() gate.
```

#### Risk 2: Prompt Injection Competition
```
Current:  serializeMemoryContextForPrompt() injects "[MEMORY SYSTEM — HARD CONSTRAINTS]"
          at orchestrator/memory-context.ts:146-149

MITIGATION: Control Layer constraints go into a SEPARATE section:
"[SYSTEM CONTROL — EXECUTION CONSTRAINTS]" injected BEFORE memory block.
The prompt hierarchy is: SYSTEM CONTROL > MEMORY SYSTEM > ENGINE OUTPUT.
This is additive, not competitive.
```

#### Risk 3: Monitoring Loop Duplication
```
Autonomous worker: runs every 5 min, processes accounts every 6 hours
                   server/autonomous-worker.ts

MITIGATION: Control Layer does NOT run as a background loop.
It runs ONCE per orchestrator run, inline, between engine completion and synthesis.
The autonomous worker continues its separate lifecycle monitoring.
No dual loop is created.
```

#### Risk 4: Gate Duplication
```
Current gates:
  - gates/registry.ts: SAFE_MODE, autopilot, AI budget
  - execution-activation/engine.ts: plan status, emergency stop
  - task-composer.ts: budget kill, integrity score, signal ratio
  - budget-governor: halt/hold actions
  - plan-synthesis.ts: cross-engine integrity override

MITIGATION: Control Layer READS the outputs of these gates.
It does not duplicate their logic. It aggregates their verdicts
into a single final assessment. See Section 9 for details.
```

### What Must NOT Be Duplicated

These systems remain untouched:

| System | File | Why It Stays |
|--------|------|--------------|
| Adaptive Rhythm | `server/adaptive-rhythm/engine.ts` | Already handles content frequency tuning with stabilization (±2 max delta) |
| Iteration Engine | `server/strategy/iteration-engine/engine.ts` | Already handles performance analysis, test hypotheses, failure detection |
| Memory Write/Read/Decay | `server/memory-mutation/engine.ts`, `server/memory-system/manager.ts` | Already handles confidence decay (30-day half-life), direction flips, blended updates |
| Exploration Budget | `server/exploration-budget/engine.ts` | Already handles test allocation with confidence penalties |
| Confidence Enforcement | `server/memory-system/manager.ts:18-23` | Already handles enforcement bands (none/soft/moderate/strong) |
| Memory Context Injection | `server/orchestrator/memory-context.ts` | Already handles prompt serialization and format constraints |
| Autonomous Worker | `server/autonomous-worker.ts` | Already handles background monitoring, state transitions, guardrail checks |

---

## 3. What Belongs to Control Layer vs. Current Agent System?

### CONTROL LAYER OWNS:

| Capability | Reason (Code Evidence) |
|------------|----------------------|
| **Final system verdict** | No single verdict exists today. `overallStatus` (orchestrator/index.ts:1832) only tracks engine-level failures, not system-level readiness. |
| **Structural validation** | Channel selection warns about funnel gaps (channel-selection/engine.ts:584) but doesn't block. Budget governor warns about funnel strength (budget-governor/engine.ts:136) but doesn't halt for it. |
| **Cross-engine contradiction detection** | Cross-engine integrity override (plan-synthesis.ts:1069) only checks for ERROR/BLOCKED status on 3 engines (offer, funnel, positioning). It doesn't detect logical contradictions (e.g., budget says scale + no conversion channel). |
| **Warning → block upgrades** | Multiple warnings exist that should be blocks. See Section 7. |
| **Targeted correction dispatch** | No code path exists today to trigger a targeted engine re-run from within the orchestrator loop. |
| **Execution mode determination** | Today, `safeToExecute` is binary. Control Layer introduces graduated modes: PASS / DOWNGRADE / REPAIR / BLOCK. |

### AGENT SYSTEM KEEPS:

| Capability | Reason (Code Evidence) |
|------------|----------------------|
| **Performance analysis** | Iteration engine's 4-layer analysis (engine.ts:117-366) is self-contained and produces test hypotheses. Control Layer has no reason to replicate this. |
| **Memory evolution** | The write threshold (MEMORY_WRITE_MIN=0.65), blending (60/40), decay (30-day half-life), and direction flip (3 consecutive snapshots >20% above baseline) are all calibrated. Control Layer should not second-guess these. |
| **Content rhythm tuning** | Adaptive rhythm's stabilization (±2 max delta per week) prevents erratic shifts. Control Layer should only set outer bounds, not tune individual format counts. |
| **Prompt influence** | REINFORCE/AVOID injection with confidence-weighted enforcement bands is a fine-grained mechanism. Control Layer should not duplicate prompt engineering. |
| **Background monitoring** | Autonomous worker's 5-min tick / 6-hour cycle is a lifecycle monitor. Control Layer is an inline gate, not a monitor. |

---

## 4. Where Does the Control Layer Sit in the Current Flow?

### Exact Insertion Point

```
server/orchestrator/index.ts:

Line 1806:  Engine loop ends
Line 1818:  runSystemIntegrityValidation()
Line 1826:  getGovernanceSummary()

            ┌─────────────────────────────────────────┐
            │  >>> CONTROL LAYER RUNS HERE <<<         │
            │                                          │
            │  Input: all engine results, integrity    │
            │         report, SGL summary, budget      │
            │         decision, CEL results, memory    │
            │                                          │
            │  Output: SystemVerdict                   │
            │    - verdict: PASS|DOWNGRADE|REPAIR|BLOCK│
            │    - correctionActions: []               │
            │    - blockReasons: []                    │
            │    - executionMode: string               │
            │    - repairResults: []                   │
            └─────────────────────────────────────────┘

Line 1832:  if (verdict !== "BLOCK") {        ← REPLACES overallStatus check
Line 1834:    synthesizePlan(config, ctx, results, ...)
              ↑ now receives verdict + executionMode
```

### Why This Location?

1. **After ALL engines** — has access to complete system state
2. **After integrity validation** — can read the integrity report
3. **After SGL summary** — can read signal governance coverage
4. **Before plan synthesis** — can prevent or modify synthesis
5. **Before memory write** — can influence what gets persisted

### File Location

```
New file: server/system-control/engine.ts
```

This is a NEW module, not an extension of any existing engine. It does not participate in the ENGINE_PRIORITY_ORDER. It runs as a dedicated post-engine phase.

### Integration Code Shape

```typescript
// In server/orchestrator/index.ts, after line 1826:

const controlVerdict = await runSystemControl({
  results,                           // Map<EngineId, EngineStepResult>
  ctx,                               // EngineContext with all accumulated data
  integrityReport: ctx.integrityReport,
  celResults: ctx.celResults,
  signalComposition: ctx.signalComposition,
  memoryBlock: loadedMemoryBlock,
  config,
});

// Replace the simple overallStatus check (line 1832):
if (controlVerdict.verdict === "BLOCK") {
  overallStatus = "BLOCKED";
  blockReason = controlVerdict.blockReasons.join("; ");
}

if (controlVerdict.verdict === "REPAIR") {
  // Execute repair actions (re-runs, downgrades)
  for (const action of controlVerdict.repairActions) {
    await executeRepairAction(action, config, ctx, results);
  }
  // Re-assess after repairs
  // ...
}

// Pass verdict to synthesizePlan:
if (overallStatus !== "BLOCKED") {
  const planResult = await synthesizePlan(
    config, ctx, results,
    memoryContextBlock,
    loadedMemoryBlock,
    controlVerdict,  // NEW parameter
  );
}
```

---

## 5. What Should the Control Layer Consume as Inputs?

### Complete Input Specification

```typescript
interface SystemControlInput {
  // === Engine Results (from results Map) ===
  budgetGovernor: {
    action: "scale" | "test" | "hold" | "halt";
    killFlag: boolean;
    confidence: number;
    riskScore: number;
    funnelStrengthScore: number;
    warnings: string[];
  };
  channelSelection: {
    channels: ChannelResult[];
    funnelStages: { awareness: any[]; nurture: any[]; conversion: any[] };
    warnings: string[];                    // includes "FUNNEL GAP" warning
    reconstructionLog: string[];
  };
  integrity: {
    integrityScore: number;
    warnings: string[];
    layers: IntegrityLayerResult[];
  };
  offer: {
    status: EngineStatus;
    offerName: string;
    coreOutcome: string;
    proofStrength: number;
  };
  funnel: {
    status: EngineStatus;
    stages: FunnelStage[];
  };
  positioning: {
    status: EngineStatus;
    contrastAxis: string;
  };
  iteration: {
    failedStrategyFlags: FailedStrategyFlag[];
    optimizationTargets: OptimizationTarget[];
    dataReliability: { overall: number };
  };
  statisticalValidation: {
    status: EngineStatus;
    output: any;
  };

  // === Cross-System Reports ===
  integrityReport: {
    overallStatus: "PASS" | "PARTIAL" | "FAIL";
    failureReasons: string[];
    semanticMisalignments: string[];
    orphanOutputs: string[];
    leakageDetected: boolean;
  };
  celResults: ComplianceResult[];
  signalComposition: {
    realRatio: number;
    competitorRatio: number;
    unknownRatio: number;
    trustedRatio: number;
  };

  // === Governance State ===
  sglSummary: {
    totalSignals: number;
    coverageSufficient: boolean;
    enginesServed: string[];
  };

  // === Memory Context ===
  memoryBlock: MemoryBlock;

  // === Config ===
  config: {
    campaignId: string;
    accountId: string;
  };
}
```

### Source Mapping

| Input | Source Variable | Source Location |
|-------|----------------|----------------|
| budgetGovernor | `results.get("budget_governor")?.output` | orchestrator/index.ts:1181 |
| channelSelection | `results.get("channel_selection")?.output` | orchestrator/index.ts:1225 |
| integrity | `results.get("integrity")?.output` | orchestrator/index.ts:995 |
| offer | `results.get("offer")` | orchestrator/index.ts:866 |
| funnel | `results.get("funnel")` | orchestrator/index.ts:956 |
| positioning | `results.get("positioning")` | orchestrator/index.ts:712 |
| iteration | `results.get("iteration")?.output` | orchestrator/index.ts:1288 |
| integrityReport | `ctx.integrityReport` | orchestrator/index.ts:1818 |
| celResults | `ctx.celResults` | Collected throughout run |
| signalComposition | `ctx.signalComposition` | orchestrator/index.ts:498 |
| sglSummary | `getGovernanceSummary(ctx.sglState)` | orchestrator/index.ts:1826 |
| memoryBlock | `loadedMemoryBlock` | orchestrator/index.ts:1643 |

---

## 6. What Outputs Should It Produce?

### Output Specification

```typescript
interface SystemControlVerdict {
  // === Primary Verdict ===
  verdict: "PASS" | "DOWNGRADE" | "REPAIR" | "BLOCK";

  // === Execution Mode (replaces binary safeToExecute) ===
  executionMode:
    | "FULL_EXECUTION"       // all clear, proceed normally
    | "RESTRICTED_EXECUTION" // proceed but with volume/scope reduction
    | "TEST_ONLY"            // downgraded from scale to test mode
    | "REVIEW_REQUIRED"      // plan generated but flagged for human review
    | "HALTED";              // execution blocked entirely

  // === Blocking Reasons (when verdict = BLOCK) ===
  blockReasons: Array<{
    code: string;            // e.g. "NO_CONVERSION_PATH", "INTEGRITY_FAIL"
    description: string;
    source: string;          // which check produced this
    severity: "critical" | "high";
  }>;

  // === Downgrade Details (when verdict = DOWNGRADE) ===
  downgrades: Array<{
    from: string;            // e.g. "scale"
    to: string;              // e.g. "test"
    reason: string;
    affectedEngine: string;
  }>;

  // === Repair Actions (when verdict = REPAIR) ===
  repairActions: Array<{
    actionType:
      | "RERUN_ENGINE"              // re-execute a specific engine
      | "INJECT_CONVERSION_CHANNEL" // force funnel completion
      | "DOWNGRADE_BUDGET_ACTION"   // scale → test or test → hold
      | "MARK_FOR_REVIEW"           // flag plan for human review
      | "FORCE_REVALIDATION";       // re-run integrity check
    targetEngine?: string;
    parameters?: Record<string, any>;
    reason: string;
    automated: boolean;      // false = requires human confirmation
  }>;

  // === Repair Results (after corrections applied) ===
  repairResults: Array<{
    action: string;
    success: boolean;
    details: string;
  }>;

  // === Structural Checks Performed ===
  structuralChecks: Array<{
    check: string;           // e.g. "conversion_path_exists"
    passed: boolean;
    details: string;
  }>;

  // === Cross-Engine Contradictions Detected ===
  contradictions: Array<{
    engineA: string;
    engineB: string;
    description: string;
    resolution: string;
  }>;

  // === Metadata ===
  timestamp: Date;
  durationMs: number;
  controlVersion: string;
}
```

### How Outputs Are Consumed

```
verdict → replaces overallStatus check at orchestrator/index.ts:1832
executionMode → passed to synthesizePlan() to adjust plan generation mode
blockReasons → stored in orchestratorJobs.error field
downgrades → modify budget action before plan synthesis
repairActions → executed inline before synthesis (targeted re-runs)
repairResults → attached to plan metadata for audit trail
structuralChecks → stored alongside integrity report
contradictions → logged and stored for governance dashboard
```

---

## 7. Which Warnings Should Be Upgraded to Hard Blocks?

### Upgrade 1: Funnel Conversion Gap → BLOCK

**Current:** Warning only
```
File: server/strategy/channel-selection/engine.ts
Line 584: warnings.push("FUNNEL GAP: No conversion channel assigned — funnel completion enforcement could not resolve");
```
**Control Layer behavior:** If `channelSelection.funnelStages.conversion.length === 0` AND the injected channel also failed (line 576-579), the Control Layer issues a BLOCK verdict with code `NO_CONVERSION_PATH`.

**Why block:** A strategy with no conversion channel has no path to revenue. Executing it wastes budget.

### Upgrade 2: Zero Real Signals + Scale Decision → BLOCK

**Current:** Downgrade to "hold" only
```
File: server/strategy/budget-governor/engine.ts
Line 180-181: if (comp.realRatio === 0) → downgrade "scale" to "hold"
```
**Control Layer behavior:** If `signalComposition.realRatio === 0` AND budget decision is "scale", BLOCK with code `SCALE_WITHOUT_REAL_DATA`. The current "hold" downgrade happens inside budget governor — the Control Layer enforces this as a hard gate in case the downgrade somehow doesn't fire (e.g., due to the performance override at line 50).

**Why block:** Scaling with zero real data means spending real money on unvalidated assumptions.

### Upgrade 3: Integrity FAIL + Plan Generation → BLOCK

**Current:** Degraded/restricted mode, plan still generated
```
File: server/orchestrator/plan-synthesis.ts
Line 1079: INTEGRITY_DEGRADED_MODE → plan generated in "degraded-safe" mode
Line 1082: INTEGRITY_RESTRICTED_MODE → content volume reduced
```
**Control Layer behavior:** If `integrityReport.overallStatus === "FAIL"` (not PARTIAL, but FAIL), BLOCK with code `INTEGRITY_FAILURE`. PARTIAL status still allows degraded-mode generation.

**Why block:** A FAIL integrity report means engine outputs are not traceable to source signals, leaked data exists, or semantic misalignment is critical. Generating a plan from this is dangerous.

### Upgrade 4: CEL Enforcement Failed → BLOCK

**Current:** Warning, safeToExecute set to false (inside synthesis)
```
File: server/orchestrator/plan-synthesis.ts
Line 1054-1058: celFailed → crossEngineFailures.push("CEL enforcement failed") → safeToExecute = false
```
**Control Layer behavior:** If ANY CEL result has `passed === false`, BLOCK with code `COMPLIANCE_FAILURE`. The current code only catches this INSIDE synthesizePlan — Control Layer catches it BEFORE.

**Why block:** CEL checks compliance requirements. Failing them means the plan may violate advertising regulations or brand safety rules.

### Upgrade 5: Missing Budget Data + Scaling → DOWNGRADE

**Current:** Warning only
```
File: server/strategy/budget-governor/engine.ts
Line 360: warnings.push("No historical CPA data available — CAC projections are unverified assumptions")
```
**Control Layer behavior:** If budget decision is "scale" AND no historical CPA data exists, DOWNGRADE to "test" with code `UNVERIFIED_CAC`.

**Why downgrade:** Scaling budget based on assumed CAC is a financial risk. Testing first is prudent.

### Upgrade 6: Synthesis Verification Failed → MARK_FOR_REVIEW

**Current:** Warning only
```
File: server/orchestrator/plan-synthesis.ts
Line 1163-1165: SYNTHESIS_VERIFICATION_FAILED → logged but plan stored
```
**Control Layer behavior:** If synthesis verification fails (locked decisions not preserved), set executionMode to `REVIEW_REQUIRED` with code `SYNTHESIS_DRIFT`.

**Why review:** If the AI output didn't preserve locked decisions, the plan may contradict the strategy foundation. Human review required.

### Summary Table

| Current Warning | File:Line | Control Layer Action | Code |
|----------------|-----------|---------------------|------|
| Funnel gap (no conversion channel) | channel-selection/engine.ts:584 | **BLOCK** | `NO_CONVERSION_PATH` |
| Scale + zero real signals | budget-governor/engine.ts:180 | **BLOCK** | `SCALE_WITHOUT_REAL_DATA` |
| Integrity report FAIL | system-integrity/engine.ts:325 | **BLOCK** | `INTEGRITY_FAILURE` |
| CEL enforcement failed | plan-synthesis.ts:1054 | **BLOCK** | `COMPLIANCE_FAILURE` |
| Scale + no CPA data | budget-governor/engine.ts:360 | **DOWNGRADE** | `UNVERIFIED_CAC` |
| Synthesis verification failed | plan-synthesis.ts:1163 | **REVIEW_REQUIRED** | `SYNTHESIS_DRIFT` |
| Budget deviates from benchmark | budget-governor/engine.ts:352 | **REVIEW_REQUIRED** | `CAC_DEVIATION` |
| Funnel strength below scaling threshold | budget-governor/engine.ts:136 | **DOWNGRADE** | `WEAK_FUNNEL_FOR_SCALE` |

---

## 8. What Self-Correcting Actions Are Safe to Automate?

### SAFE TO AUTOMATE:

#### 1. Inject Conversion Channel (Funnel Completion)
```
Trigger: channelSelection.funnelStages.conversion.length === 0
Action: Call injectConversionChannel() (channel-selection/engine.ts:576)
Why safe: This function already exists and has bounded logic.
          It picks from scored candidates, not from AI generation.
          The Control Layer just calls it again with relaxed constraints.
Automated: YES
```

#### 2. Downgrade Budget Action (Scale → Test)
```
Trigger: budget action is "scale" but structural conditions unmet
Action: Override budgetGovernor.output.decision.action = "test"
Why safe: This is a conservative direction change (less spending, not more).
          The budget governor already supports test/hold/scale as outputs.
Automated: YES
```

#### 3. Downgrade Budget Action (Test → Hold)
```
Trigger: budget action is "test" but integrity is PARTIAL
Action: Override budgetGovernor.output.decision.action = "hold"
Why safe: Same conservative direction change.
Automated: YES
```

#### 4. Force Re-validation of Integrity
```
Trigger: integrityReport.overallStatus === "PARTIAL" AND specific fixable issue
Action: Re-run runSystemIntegrityValidation() after repairs
Why safe: Integrity validation is pure computation (no DB writes, no AI calls).
          Re-running it is cheap and deterministic.
Automated: YES
```

#### 5. Mark Plan for Human Review
```
Trigger: Any REVIEW_REQUIRED condition
Action: Set plan metadata: reviewRequired = true, reviewReasons = [...]
Why safe: Non-destructive. Plan is still generated but flagged.
Automated: YES
```

### SAFE WITH BOUNDS (automated but capped):

#### 6. Re-run Channel Selection Engine
```
Trigger: Conversion path missing AND injected channel also failed
Action: Re-execute channel_selection engine with adjusted context
Why safe IF bounded:
  - MAX 1 re-run per engine per orchestrator execution
  - Only if the engine originally returned SUCCESS or PARTIAL
  - Re-run uses same inputs plus Control Layer hints
Automated: YES (with max 1 re-run limit)
```

#### 7. Re-run Funnel Engine
```
Trigger: Funnel structural completeness < minimum threshold
Action: Re-execute funnel engine with explicit completeness requirements
Why safe IF bounded:
  - MAX 1 re-run
  - Only if funnel returned SUCCESS or PARTIAL but is structurally incomplete
Automated: YES (with max 1 re-run limit)
```

### NOT SAFE TO AUTOMATE:

#### 8. Re-run Offer Engine
```
Why NOT safe:
  - Offer engine uses AI generation (LLM call)
  - Re-running may produce a completely different offer
  - Offer changes cascade through positioning, differentiation, mechanism
  - Too many downstream dependencies
Action: REVIEW_REQUIRED (flag for human, don't re-run)
```

#### 9. Override Integrity Score
```
Why NOT safe:
  - Integrity score reflects real cross-engine alignment
  - Overriding it masks structural problems
  - Could allow unsafe plans to execute
Action: Never override. Only re-validate after repairs.
```

#### 10. Override Budget Kill Flag
```
Why NOT safe:
  - Kill flag is a financial safety mechanism
  - Budget governor sets it for critical reasons (P&L risk)
  - Overriding could authorize dangerous spending
Action: Never override. BLOCK is final for kill flag.
```

#### 11. Modify Memory Entries
```
Why NOT safe:
  - Memory system has its own calibrated evolution mechanism
  - Control Layer writing to memory would create a competing write path
  - Blending, decay, and direction flip logic are self-consistent
Action: Control Layer READS memory. Never WRITES to it.
```

#### 12. Change Engine Priority Order
```
Why NOT safe:
  - ENGINE_PRIORITY_ORDER is a foundational invariant
  - Changing execution order breaks dependency cascades
Action: Never modify. Fixed architectural contract.
```

### Summary Table

| Action | Automated? | Max per Run | Code Safety |
|--------|-----------|-------------|-------------|
| Inject conversion channel | YES | 1 | Existing function, bounded logic |
| Downgrade scale → test | YES | 1 | Conservative direction |
| Downgrade test → hold | YES | 1 | Conservative direction |
| Re-validate integrity | YES | 1 | Pure computation, no side effects |
| Mark plan for review | YES | N/A | Non-destructive metadata |
| Re-run channel selection | YES (bounded) | 1 | Same inputs, deterministic |
| Re-run funnel engine | YES (bounded) | 1 | Same inputs, deterministic |
| Re-run offer engine | NO | - | AI generation, cascade risk |
| Override integrity score | NO | - | Masks structural problems |
| Override budget kill flag | NO | - | Financial safety mechanism |
| Write to memory system | NO | - | Competing write path |
| Change engine priority | NO | - | Foundational invariant |

---

## 9. Should It Wrap, Replace, or Consume Existing Gates?

### Recommendation: CONSUME into one final gate.

### Current Gate Inventory

```
Gate System                          | File                              | What It Controls
────────────────────────────────────|───────────────────────────────────|──────────────────
gates/registry.ts                    | SAFE_MODE, autopilot, AI budget  | Account-level access
execution-activation/engine.ts       | plan.status, emergency stop       | Plan state transitions
task-composer.ts                     | budgetKill, integrity, signals    | Task generation filtering
budget-governor/engine.ts            | halt/hold/scale decisions          | Budget authority
plan-synthesis.ts (cross-engine)     | offer/funnel/positioning failures  | Synthesis blocking
signal-governance/engine.ts          | coverage sufficiency               | Signal dispatch
system-integrity/engine.ts           | alignment, leakage, traceability   | Output integrity
```

### Why CONSUME (not wrap or replace):

**Wrapping** would add another layer without removing complexity. Each gate would still run independently, and the Control Layer would just read their results. This adds latency without clarity.

**Replacing** would require rewriting 7 different gate systems. Massive risk, no benefit. These gates work correctly for their individual domains.

**Consuming** means: each gate still runs and produces its output. The Control Layer READS all gate outputs and produces the ONE final verdict. No gate is removed, but no gate directly controls downstream behavior anymore — only the Control Layer verdict does.

### How Consumption Works

```typescript
// The Control Layer reads, not replaces:

function evaluateSystemControl(input: SystemControlInput): SystemControlVerdict {
  const checks: StructuralCheck[] = [];
  const contradictions: Contradiction[] = [];
  const blockReasons: BlockReason[] = [];
  const downgrades: Downgrade[] = [];

  // 1. Consume budget governor gate
  if (input.budgetGovernor.killFlag) {
    blockReasons.push({ code: "BUDGET_KILL", ... });
  }

  // 2. Consume integrity gate
  if (input.integrityReport.overallStatus === "FAIL") {
    blockReasons.push({ code: "INTEGRITY_FAILURE", ... });
  }

  // 3. Consume CEL gate
  if (input.celResults.some(c => !c.passed)) {
    blockReasons.push({ code: "COMPLIANCE_FAILURE", ... });
  }

  // 4. Consume signal composition gate
  if (input.signalComposition.realRatio === 0 && input.budgetGovernor.action === "scale") {
    blockReasons.push({ code: "SCALE_WITHOUT_REAL_DATA", ... });
  }

  // 5. Structural checks (NEW — not in any existing gate)
  if (input.channelSelection.funnelStages.conversion.length === 0) {
    blockReasons.push({ code: "NO_CONVERSION_PATH", ... });
  }

  // 6. Cross-engine contradiction checks (NEW)
  if (input.budgetGovernor.action === "scale" && input.budgetGovernor.funnelStrengthScore < 0.5) {
    contradictions.push({ engineA: "budget_governor", engineB: "funnel", ... });
    downgrades.push({ from: "scale", to: "test", ... });
  }

  // 7. Determine final verdict
  if (blockReasons.length > 0) return { verdict: "BLOCK", ... };
  if (downgrades.length > 0) return { verdict: "DOWNGRADE", ... };
  if (repairNeeded) return { verdict: "REPAIR", ... };
  return { verdict: "PASS", ... };
}
```

### What Changes Downstream

```
BEFORE Control Layer:
  orchestrator/index.ts:1832  → if (overallStatus !== "BLOCKED")     → synthesize
  plan-synthesis.ts:1036      → if (budgetKillFlag)                  → halt plan
  plan-synthesis.ts:1069      → if (crossEngineFailures)             → safeToExecute=false
  task-composer.ts:109        → if (budgetKillFlag || halt)          → zero tasks
  task-composer.ts:125        → if (safeToExecute === false)         → review-only tasks

AFTER Control Layer:
  orchestrator/index.ts:1832  → if (controlVerdict.verdict !== "BLOCK") → synthesize
  synthesizePlan receives     → controlVerdict.executionMode to set correct plan mode
  task-composer receives      → controlVerdict.executionMode (FULL/RESTRICTED/TEST_ONLY/REVIEW_REQUIRED/HALTED)

  The individual gates still RUN (budget governor still calculates kill flag,
  integrity still produces score) but the Control Layer is THE authority
  that translates them into the final downstream behavior.
```

---

## 10. Cleanest Implementation Path

### Phase 1: Core Control Engine (No Behavior Change Yet)

```
New file: server/system-control/engine.ts

Functions:
  evaluateSystemControl(input: SystemControlInput): SystemControlVerdict

Behavior:
  - Reads all engine results and gate outputs
  - Evaluates structural checks
  - Detects cross-engine contradictions
  - Produces verdict

Integration:
  - Called at orchestrator/index.ts between line 1826 and 1832
  - Verdict is LOGGED but does NOT yet replace overallStatus check
  - Shadow mode: runs alongside existing logic, reports differences

Why shadow first:
  - Validates that the Control Layer agrees with existing behavior
  - Identifies false positives before enforcement
  - Zero risk to current system
```

### Phase 2: Activate Enforcement

```
Modified file: server/orchestrator/index.ts

Change:
  Line 1832: Replace `if (overallStatus !== "BLOCKED")`
  With: `if (controlVerdict.verdict !== "BLOCK")`

  Pass controlVerdict to synthesizePlan as new parameter

Behavior change:
  - Control Layer verdict is now THE gate
  - Warning → block upgrades are active
  - Structural validation is enforced
```

### Phase 3: Add Repair Actions

```
Modified file: server/system-control/engine.ts

Add:
  executeRepairAction() function

Behavior:
  - When verdict is REPAIR, execute bounded corrections
  - Re-run channel selection (max 1)
  - Inject conversion channel
  - Downgrade budget action
  - Re-validate integrity after repairs
  - Re-evaluate verdict after repairs
```

### Phase 4: Verdict Storage & Dashboard

```
New migration: Add system_control_verdicts table

Fields:
  - id, campaignId, accountId, planId
  - verdict, executionMode
  - blockReasons (JSON), downgrades (JSON)
  - repairActions (JSON), repairResults (JSON)
  - structuralChecks (JSON), contradictions (JSON)
  - createdAt

Integration:
  - Stored after verdict is produced
  - Accessible via API for governance dashboard
  - Audit trail for every orchestrator run
```

### File Structure

```
server/system-control/
├── engine.ts              Core verdict engine
├── types.ts               SystemControlInput, SystemControlVerdict interfaces
├── structural-checks.ts   Conversion path, funnel completeness, upstream deps
├── contradiction-detector.ts   Cross-engine contradiction logic
├── repair-actions.ts      Bounded correction execution
└── constants.ts           Thresholds, check codes, version
```

### Integration Points (Minimal Touch)

```
Files modified (minimal changes):
  server/orchestrator/index.ts        → Add control layer call + verdict gate (5-10 lines)
  server/orchestrator/plan-synthesis.ts → Accept controlVerdict parameter (2-3 lines)
  server/task-composer.ts              → Read executionMode from verdict (3-5 lines)

Files NOT modified:
  server/memory-mutation/engine.ts     → Untouched
  server/memory-system/manager.ts      → Untouched
  server/adaptive-rhythm/engine.ts     → Untouched
  server/exploration-budget/engine.ts  → Untouched
  server/strategy/iteration-engine/*   → Untouched
  server/autonomous-worker.ts          → Untouched
  server/decision-policy/index.ts      → Untouched
  server/conflict-resolver.ts          → Untouched
  All engine files                     → Untouched
```

### Estimated Scope

| Component | New Lines | Modified Lines | Risk |
|-----------|-----------|----------------|------|
| system-control/engine.ts | ~300 | 0 | LOW (new file) |
| system-control/types.ts | ~80 | 0 | LOW (new file) |
| system-control/structural-checks.ts | ~150 | 0 | LOW (new file) |
| system-control/contradiction-detector.ts | ~100 | 0 | LOW (new file) |
| system-control/repair-actions.ts | ~120 | 0 | LOW (new file) |
| system-control/constants.ts | ~40 | 0 | LOW (new file) |
| orchestrator/index.ts | 0 | ~15 | MEDIUM (integration point) |
| orchestrator/plan-synthesis.ts | 0 | ~5 | LOW (parameter addition) |
| task-composer.ts | 0 | ~8 | LOW (mode reading) |
| **TOTAL** | **~790** | **~28** | **LOW overall** |

---

## Architecture Diagram

```
                    ┌──────────────────────────────────────────────┐
                    │            ORCHESTRATOR LOOP                  │
                    │                                              │
                    │  MI → Audience → Positioning → Diff →        │
                    │  Mechanism → Offer → Awareness → Funnel →    │
                    │  Persuasion → Integrity → StatVal →          │
                    │  BudgetGov → ChannelSel → Iteration →       │
                    │  Retention                                   │
                    │         ↓                                    │
                    │  System Integrity Validation                 │
                    │  Signal Governance Summary                   │
                    └──────────────┬───────────────────────────────┘
                                   │
                    ┌──────────────▼───────────────────────────────┐
                    │         SYSTEM CONTROL LAYER                 │
                    │                                              │
                    │  ┌─────────────────────────────────────┐     │
                    │  │ 1. Structural Checks                │     │
                    │  │    - Conversion path exists?         │     │
                    │  │    - Funnel structurally complete?   │     │
                    │  │    - Upstream deps present?          │     │
                    │  └─────────────────────────────────────┘     │
                    │  ┌─────────────────────────────────────┐     │
                    │  │ 2. Gate Consumption                 │     │
                    │  │    - Budget kill/halt/hold           │     │
                    │  │    - Integrity score                 │     │
                    │  │    - CEL compliance                  │     │
                    │  │    - Signal composition              │     │
                    │  │    - SGL coverage                    │     │
                    │  └─────────────────────────────────────┘     │
                    │  ┌─────────────────────────────────────┐     │
                    │  │ 3. Contradiction Detection           │     │
                    │  │    - Budget scale + no conversion    │     │
                    │  │    - Plan approved + incomplete ctx   │     │
                    │  │    - Funnel pass + structural weakness│     │
                    │  └─────────────────────────────────────┘     │
                    │  ┌─────────────────────────────────────┐     │
                    │  │ 4. Verdict Engine                    │     │
                    │  │    → PASS / DOWNGRADE / REPAIR / BLOCK│    │
                    │  └─────────────┬───────────────────────┘     │
                    │                │                              │
                    │  ┌─────────────▼───────────────────────┐     │
                    │  │ 5. Self-Correction (Execution Arm)  │     │
                    │  │    IF verdict == REPAIR:             │     │
                    │  │    - Re-run engine (max 1)           │     │
                    │  │    - Inject conversion channel       │     │
                    │  │    - Downgrade budget action          │     │
                    │  │    - Re-validate integrity            │     │
                    │  │    - Re-assess verdict                │     │
                    │  └─────────────────────────────────────┘     │
                    │                                              │
                    │  Output: SystemControlVerdict                │
                    │    verdict, executionMode, blockReasons,     │
                    │    downgrades, repairActions, repairResults  │
                    └──────────────┬───────────────────────────────┘
                                   │
                    ┌──────────────▼───────────────────────────────┐
                    │         PLAN SYNTHESIS                        │
                    │  (receives verdict + executionMode)           │
                    │  Plan generated in appropriate mode           │
                    └──────────────┬───────────────────────────────┘
                                   │
                    ┌──────────────▼───────────────────────────────┐
                    │         TASK COMPOSER                         │
                    │  (reads executionMode from verdict)           │
                    │  Tasks filtered based on execution authority  │
                    └──────────────────────────────────────────────┘
```

---

## What Stays Untouched (Explicit List)

| System | Files | Status |
|--------|-------|--------|
| Adaptive Rhythm | `server/adaptive-rhythm/engine.ts` | UNCHANGED |
| Iteration Engine | `server/strategy/iteration-engine/*` | UNCHANGED |
| Retention Engine | `server/strategy/retention-engine/*` | UNCHANGED |
| Memory Mutation | `server/memory-mutation/engine.ts` | UNCHANGED |
| Memory System | `server/memory-system/manager.ts` | UNCHANGED |
| Memory Context | `server/orchestrator/memory-context.ts` | UNCHANGED |
| Decision Policy | `server/decision-policy/index.ts` | UNCHANGED |
| Exploration Budget | `server/exploration-budget/engine.ts` | UNCHANGED |
| Autonomous Worker | `server/autonomous-worker.ts` | UNCHANGED |
| Conflict Resolver | `server/conflict-resolver.ts` | UNCHANGED |
| All 15 Engine Files | Various | UNCHANGED |
| Gates Registry | `server/gates/registry.ts` | UNCHANGED |
| Execution Activation | `server/execution-activation/*` | UNCHANGED |
| Signal Governance | `server/signal-governance/*` | UNCHANGED |
| System Integrity | `server/system-integrity/*` | UNCHANGED |
| Engine Hardening | `server/engine-hardening/*` | UNCHANGED |
