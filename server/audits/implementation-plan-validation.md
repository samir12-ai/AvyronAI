# TECHNICAL VALIDATION & IMPLEMENTATION PLAN
**Date**: 2026-04-16  
**Scope**: System-level logic alignment — validated against actual codebase  
**Status**: VALIDATED — All proposals reviewed against real code paths

---

## VALIDATION SUMMARY

| Proposed Change | Compatible? | Conflicts | Risk Level |
|-----------------|-------------|-----------|------------|
| Shared Strategic Context (SSC) | YES | Minor: ctx typing is `any` | LOW |
| Problem Registry | YES | None | LOW |
| Canonical Meaning Contract | YES | Minor: some engines have local overrides | LOW |
| Reason Trace | YES with caveats | EngineOutput contract needs extension | MEDIUM |
| Confidence Refactor | PARTIAL | engine-hardening already partially implements this | MEDIUM |
| Self-Correcting System | YES | Must not conflict with memory system writes | MEDIUM |
| Control Layer Enhancement | YES | Already exists — needs extension, not replacement | LOW |
| Repair Actions | YES | Already exists — needs scoping | LOW |

---

## CURRENT SYSTEM ARCHITECTURE (VERIFIED)

### Orchestrator (`server/orchestrator/index.ts`)

**Pipeline order** (fixed, defined in `priority-matrix.ts`):
```
MI → Audience → Positioning → Differentiation → Mechanism → Offer →
Awareness → Funnel → Integrity → Persuasion → Statistical Validation →
Budget Governor → Channel Selection → Iteration → Retention
```

**Context object** (`EngineContext`, lines 131-165):
- Typed as `any` for all engine fields (mi, audience, positioning, etc.)
- Also carries: `analyticalEnrichment`, `celResults`, `depthGateStatus`, `sglState`, `integrityReport`, `memoryContext`, `signalComposition`, `performanceLineage`
- Each engine result stored as `ctx[engineId] = result`

**Data transformation**: Via extraction functions (`extractAudienceInput`, `extractOfferInput`, etc.) that selectively pull fields and drop metadata/reasoning.

**Key integration layers already present**:
- AEL (Analytical Enrichment Layer) — builds causal analysis after Audience
- CEL (Causal Enforcement Layer) — validates causal depth post-engine
- SGL (Signal Governance Layer) — validates signal coverage pre-engine
- System Control — evaluates full system state post-pipeline

### Engine Contracts (`server/engine-contracts/`)

Two parallel contract systems exist:

1. **`EngineOutputSchema`** (engine-contract.ts): Zod schema with `score`, `reasoning`, `confidence`, `dataCompleteness`, `scope`, `outputType`, `riskFlag`, `payload`
2. **Per-engine types**: Each engine directory has its own `types.ts` with specific result interfaces

The two systems are NOT unified. The V3 engines (Audience, Positioning, etc.) return their own custom types directly, NOT wrapped in `EngineOutputSchema`. The `EngineOutputSchema` is used by content-level engines (Caption, Video Analysis).

**This means**: Adding fields to `EngineOutputSchema` alone is INSUFFICIENT. Each V3 engine's return type must be individually extended.

### Memory System (`server/memory-system/`)

- Stores `MemorySlot` objects in `strategyMemory` table
- Direction: `reinforce` / `avoid` / `neutral`
- Accessed via `buildMemoryContext()` → serialized as `[MEMORY SYSTEM — HARD CONSTRAINTS]` in prompts
- Written via `applyMemoryMutation()` after pipeline completion
- Has decay (0.95 rate), confidence scores, strategy fingerprints

**CRITICAL CONSTRAINT**: The memory system must remain read-only during pipeline execution. Memory mutations happen AFTER the pipeline, not during. The proposed Problem Registry must NOT write to memory — it must be a separate, ephemeral object.

### Adaptive System

- **Adaptive Rhythm**: Adjusts content volume (reels/week, etc.)
- **Exploration Budget**: Allocates 10-35% for testing
- **Iteration Engine**: Generates A/B test hypotheses from performance data
- **Memory Mutation**: Updates memory based on performance results

**CRITICAL CONSTRAINT**: The adaptive system reads memory at pipeline start and writes to memory after pipeline completion. The proposed changes must not insert writes mid-pipeline. The adaptive system's mutation logic depends on the `strategyMemory` table schema — changes to memory structure could break `runMemoryMutation`.

### System Control Layer (`server/system-control/`)

Already implements:
- `evaluateSystemControl(input: SystemControlInput)` → `SystemControlVerdict`
- Block reasons with `BlockCode` enum
- Contradiction detection with `detectContradictions()`
- Repair actions with `assessRepairability()` + `executeRepairActions()`
- Verdict types: PASS / DOWNGRADE / REPAIR / BLOCK
- Execution modes: FULL_EXECUTION / RESTRICTED_EXECUTION / TEST_ONLY / REVIEW_REQUIRED / HALTED
- Verdict storage in `system_control_verdicts` table

**This already implements 70% of the proposed Control Layer spec.** The remaining 30% is problem registry integration and mid-pipeline gates.

---

## PROPOSAL 1: SHARED STRATEGIC CONTEXT (SSC)

### Validation: COMPATIBLE

**Where it lives**: New field on `EngineContext`:
```typescript
interface EngineContext {
  // ... existing fields ...
  strategicContext: SharedStrategicContext;
}
```

**Why this works**: `EngineContext` is already the "blackboard" that accumulates state. Adding a structured `strategicContext` field is a natural extension. Since all engine fields are typed `any`, there's no type conflict — but we should properly type the new field.

### Proposed Implementation

**File**: `server/orchestrator/shared-strategic-context.ts` (NEW)

```typescript
export interface SharedStrategicContext {
  // Accumulated maps
  problemRegistry: ProblemEntry[];
  painMap: PainMapEntry[];
  desireMap: DesireMapEntry[];
  objectionMap: ObjectionMapEntry[];
  trustMap: TrustAssessment;
  
  // Canonical awareness meaning
  awarenessMeaning: CanonicalAwarenessMeaning;
  
  // Narrative constraints (from positioning lock)
  narrativeConstraints: NarrativeConstraint[];
  
  // Contradictions detected so far
  contradictions: ContradictionEntry[];
  
  // Confidence chain
  confidenceFloor: number;
  confidenceChain: ConfidenceChainEntry[];
  
  // Downstream requirements (what later engines need)
  downstreamRequirements: DownstreamRequirement[];
  
  // Reason trace accumulator
  reasonTrace: ReasonTraceEntry[];
}
```

**Orchestrator integration point** (in `server/orchestrator/index.ts`):
```
Line ~200 (pipeline init): Initialize empty SSC
Line ~632 (executeEngine switch): Pass SSC to each engine, receive enriched SSC back
Line ~1837 (system control): Pass SSC to evaluateSystemControl
```

### Compatibility Check

| System | Impact | Risk |
|--------|--------|------|
| Memory System | NONE — SSC is ephemeral (per-run), memory is persistent | NONE |
| Adaptive System | NONE — Adaptive reads from memory, not from ctx fields | NONE |
| CEL | NONE — CEL reads from AEL enrichment, which is separate | NONE |
| SGL | NONE — SGL reads signal coverage, which is separate | NONE |
| System Control | POSITIVE — SSC feeds richer data to control layer | NONE |
| Engine contracts | MINOR — Each engine's function signature needs SSC parameter | LOW |

### Required Changes Per Engine

Each engine's `run[EngineName]Engine()` function needs:
1. An additional `ssc: SharedStrategicContext` parameter
2. Logic to READ the SSC before processing
3. Logic to WRITE back enrichments (problems, constraints, confidence updates)
4. Return the enriched SSC alongside the existing result

**Estimated file changes**: 15 engine files + 1 orchestrator file + 1 new SSC file

### Potential Issues

**Issue 1**: Engine execution is currently synchronous-sequential. The SSC must be passed by reference (object mutation) OR returned and merged. Since JavaScript passes objects by reference, mutating the SSC in-place is simplest and safest.

**Issue 2**: Some engines run conditionally (Iteration, Retention). The SSC must handle missing contributions gracefully.

**CONFIRMED: No conflicts with memory system, adaptive system, or iteration engine.**

---

## PROPOSAL 2: PROBLEM REGISTRY

### Validation: COMPATIBLE

**Where it lives**: Inside the SSC (see above) as `problemRegistry: ProblemEntry[]`

```typescript
export interface ProblemEntry {
  id: string;                                    // Unique ID
  sourceEngine: EngineId;                        // Which engine found it
  type: 'market' | 'audience' | 'structural' | 'conversion' | 'trust' | 'alignment';
  description: string;                           // What the problem is
  severity: 'critical' | 'high' | 'medium' | 'low';
  confidence: number;                            // How sure are we
  status: 'open' | 'resolved' | 'deferred';     // Current state
  resolvedBy?: EngineId;                         // Which engine resolved it
  resolvedAction?: string;                       // How it was resolved
  discoveredAt: number;                          // Pipeline step number
}
```

### Compatibility with Existing Systems

The current system already has PARTIAL problem tracking:
- **Warnings**: Each engine emits `warnings[]` — but these are strings, not structured problems
- **Block reasons**: System Control has `BlockReason[]` — but only at pipeline end
- **Contradictions**: System Control has `detectContradictions()` — but only at pipeline end

The Problem Registry unifies these into a SINGLE, EVOLVING structure that flows through the pipeline.

**No conflict with memory system**: Problems are ephemeral (per-run). They are NOT stored in `strategyMemory`. The System Control Layer can reference them for verdict decisions, but they don't persist across runs unless explicitly stored.

### Control Layer Integration

The existing `evaluateSystemControl()` already receives `results: Map<EngineId, EngineStepResult>`. Adding `ssc.problemRegistry` to the input is straightforward:

```typescript
// In SystemControlInput (types.ts), add:
problemRegistry?: ProblemEntry[];
```

New structural check: `checkUnresolvedProblems(registry)`:
- Count critical problems with status = 'open'
- If critical unresolved > 0 → BLOCK
- If high unresolved > 2 → DOWNGRADE

---

## PROPOSAL 3: CANONICAL MEANING CONTRACT

### Validation: COMPATIBLE — but requires consolidation

**Current state**: The system has FRAGMENTED meaning definitions:

| Concept | Where Defined | Format |
|---------|---------------|--------|
| Awareness stages | `audience-engine/constants.ts` (keyword patterns) | String matching |
| Awareness → Trust | `awareness-engine/engine.ts` (Layer 6) | Inline logic |
| Awareness → Channels | `channel-selection/engine.ts` (AWARENESS_CHANNEL_MAP) | Lookup table |
| Awareness → Persuasion | `persuasion-engine/constants.ts` (AWARENESS_PERSUASION_MAP) | Lookup table |
| Awareness → Funnel | `funnel-engine/constants.ts` (AWARENESS_BLOCKED_FUNNELS) | Block list |

Each engine independently defines what "product_aware" means for its own purposes. There is no single canonical definition.

### Proposed Implementation

**File**: `server/orchestrator/canonical-meanings.ts` (NEW)

```typescript
export interface AwarenessMeaning {
  stage: AwarenessStage;
  trustLevel: 'none' | 'low' | 'moderate' | 'high';
  searchIntentExists: boolean;
  comparisonBehavior: boolean;
  conversionReadiness: 'not_ready' | 'needs_nurture' | 'evaluating' | 'ready';
  proofRequirement: 'not_needed' | 'educational' | 'comparative' | 'decisive';
  educationLevel: 'full' | 'moderate' | 'minimal' | 'none';
  allowedFunnelTypes: FunnelType[];
  blockedFunnelTypes: FunnelType[];
  allowedChannelRoles: ChannelRole[];
  allowedPersuasionModes: PersuasionMode[];
}

export const AWARENESS_MEANINGS: Record<AwarenessStage, AwarenessMeaning> = {
  unaware: {
    stage: 'unaware',
    trustLevel: 'none',
    searchIntentExists: false,
    comparisonBehavior: false,
    conversionReadiness: 'not_ready',
    proofRequirement: 'educational',
    educationLevel: 'full',
    allowedFunnelTypes: ['content_education', 'quiz', 'diagnostic'],
    blockedFunnelTypes: ['direct', 'tripwire', 'application', 'product-launch'],
    allowedChannelRoles: ['discovery'],
    allowedPersuasionModes: ['education_proof_hybrid'],
  },
  problem_aware: {
    stage: 'problem_aware',
    trustLevel: 'low',
    searchIntentExists: false,
    comparisonBehavior: false,
    conversionReadiness: 'needs_nurture',
    proofRequirement: 'educational',
    educationLevel: 'moderate',
    allowedFunnelTypes: ['webinar', 'challenge', 'quiz', 'diagnostic'],
    blockedFunnelTypes: ['direct', 'tripwire'],
    allowedChannelRoles: ['discovery', 'nurture'],
    allowedPersuasionModes: ['empathy_led'],
  },
  solution_aware: {
    stage: 'solution_aware',
    trustLevel: 'moderate',
    searchIntentExists: true,
    comparisonBehavior: true,
    conversionReadiness: 'evaluating',
    proofRequirement: 'comparative',
    educationLevel: 'minimal',
    allowedFunnelTypes: ['webinar', 'challenge', 'consult'],
    blockedFunnelTypes: [],
    allowedChannelRoles: ['discovery', 'nurture', 'conversion'],
    allowedPersuasionModes: ['contrast_led'],
  },
  product_aware: {
    stage: 'product_aware',
    trustLevel: 'moderate',
    searchIntentExists: true,
    comparisonBehavior: true,
    conversionReadiness: 'evaluating',
    proofRequirement: 'decisive',
    educationLevel: 'minimal',
    allowedFunnelTypes: ['webinar', 'challenge', 'consult', 'direct', 'application'],
    blockedFunnelTypes: [],
    allowedChannelRoles: ['discovery', 'nurture', 'conversion'],
    allowedPersuasionModes: ['proof_led'],
  },
  most_aware: {
    stage: 'most_aware',
    trustLevel: 'high',
    searchIntentExists: true,
    comparisonBehavior: false,
    conversionReadiness: 'ready',
    proofRequirement: 'not_needed',
    educationLevel: 'none',
    allowedFunnelTypes: ['direct', 'tripwire', 'application', 'product-launch'],
    blockedFunnelTypes: [],
    allowedChannelRoles: ['nurture', 'conversion'],
    allowedPersuasionModes: ['proof_led'],
  },
};
```

### Migration Path

Each engine currently has its own awareness mapping. The migration is:

1. Create `canonical-meanings.ts` with the unified definition
2. Update Audience Engine to populate `ssc.awarenessMeaning` from canonical definitions after classifying awareness stage
3. Update each downstream engine to READ from `ssc.awarenessMeaning` instead of its own local lookup
4. DELETE the local mappings from each engine's constants.ts (6 files)

| Engine | Current Local Mapping | Migration |
|--------|-----------------------|-----------|
| Channel Selection | `AWARENESS_CHANNEL_MAP`, `AWARENESS_STAGE_ALLOWED_ROLES` | Replace with `ssc.awarenessMeaning.allowedChannelRoles` |
| Persuasion | `AWARENESS_PERSUASION_MAP` | Replace with `ssc.awarenessMeaning.allowedPersuasionModes` |
| Funnel | `AWARENESS_BLOCKED_FUNNELS` | Replace with `ssc.awarenessMeaning.blockedFunnelTypes` |
| Awareness | Layer 6 trust guard | Replace with `ssc.awarenessMeaning.trustLevel` |
| Offer | No direct mapping (should have one) | Read `ssc.awarenessMeaning.proofRequirement` |

### Risk Assessment

**Risk**: Engines that have EXTENDED meanings beyond the canonical definition may lose nuance.  
**Mitigation**: The canonical definition should be the MINIMUM constraint set. Engines can add stricter constraints but cannot loosen them. This is an additive model: `canonical constraints + engine-specific constraints`.

---

## PROPOSAL 4: REASON TRACE

### Validation: COMPATIBLE — with architectural caveat

### Current State

The codebase already has two reasoning-adjacent features:
1. **`reasoning: string`** in `EngineOutputSchema` — a free-text explanation
2. **`warnings: string[]`** in each engine result — informational observations
3. **`layerDiagnostics`** in some engines — layer-by-layer scoring details

None of these are machine-readable, structured, or consumed by downstream engines.

### Proposed Structure

```typescript
export interface ReasonTraceEntry {
  engineId: EngineId;
  signal: string;              // What raw signal was received
  interpretation: string;      // How the engine interpreted it
  constraint: string;          // What constraint was derived
  decision: string;            // What decision was made
  confidence: number;          // How confident in this reasoning
  upstreamRef?: string;        // Reference to upstream trace entry
}
```

### Critical Caveat: Reason Trace as a Data Contract

The proposal states: "Reason Trace must NOT be treated as debug output. It must be part of the structured data contract passed between engines."

**Validation**: This is architecturally sound but has a PERFORMANCE implication.

Currently, extraction functions (`extractAudienceInput`, etc.) strip metadata to keep inputs lean. If Reason Trace is a strict data contract:
- Each extraction function must PRESERVE the trace entries
- Downstream engines must PARSE and VALIDATE upstream traces
- This adds ~50-100ms per engine per run (15 engines × ~75ms = ~1.1 seconds total)

**Recommendation**: Reason Trace should be on the SSC (shared context), NOT on individual engine inputs. This way:
- Traces accumulate on a single object (no extraction loss)
- Downstream engines read from `ssc.reasonTrace` (no parsing per-engine-input)
- Validation is performed at mid-pipeline gates and System Control (not every engine)

### Required Changes

1. Add `reasonTrace: ReasonTraceEntry[]` to `SharedStrategicContext`
2. Each engine appends entries to `ssc.reasonTrace` during execution
3. System Control reads trace for contradiction detection
4. Mid-pipeline gates check trace for logical consistency

**No conflict with any existing system.**

---

## PROPOSAL 5: CONFIDENCE SYSTEM REFACTOR

### Validation: PARTIALLY IMPLEMENTED

### Current State

The `engine-hardening` module (`server/engine-hardening/index.ts`) already implements a two-tier confidence system:

| Current | Proposed | Status |
|---------|----------|--------|
| `rawScore` (engine's self-assessment) | Engine Confidence | EXISTS |
| `DataReliabilityDiagnostics.overallReliability` | Data Confidence | EXISTS |
| `normalizeConfidence(raw, reliability)` | Combined output | EXISTS |

**The problem is not that the system doesn't exist — it's that engines don't use it consistently.**

### Verified Engine Compliance

| Engine | Uses shared `assessDataReliability`? | Uses shared `normalizeConfidence`? |
|--------|--------------------------------------|-------------------------------------|
| Positioning | YES | YES |
| Mechanism | YES | YES |
| Awareness | NO — local override (lines 84-155) | NO — local override |
| Persuasion | NO — local override | NO — local override |
| Offer | PARTIAL | PARTIAL |
| Funnel | YES | YES |
| Channel Selection | YES | YES |
| Budget Governor | NO — performance override bypasses | NO |
| Statistical Validation | NO — own scoring system | NO |
| Integrity | NO — own scoring system | NO |

**6 of 15 engines** bypass or override the shared confidence system.

### Proposed Fix

1. **Consolidate**: Remove local overrides in Awareness and Persuasion engines. Use the shared `engine-hardening` module.
2. **Extend**: Add explicit `dataConfidence` and `engineConfidence` fields to all engine outputs.
3. **Enforce**: Budget Governor's performance override must check `dataConfidence` — not replace it.

```typescript
// Add to every engine result:
export interface EngineConfidenceOutput {
  dataConfidence: number;      // From assessDataReliability
  engineConfidence: number;    // Engine's own assessment of its logic quality
  combinedConfidence: number;  // normalizeConfidence(engineConfidence, dataReliability)
}
```

### Confidence Inheritance Protocol

```typescript
// In orchestrator, after each engine:
ssc.confidenceFloor = Math.min(ssc.confidenceFloor, result.combinedConfidence);
ssc.confidenceChain.push({
  engineId,
  dataConfidence: result.dataConfidence,
  engineConfidence: result.engineConfidence,
  combinedConfidence: result.combinedConfidence,
  inheritedFloor: ssc.confidenceFloor,
});

// Each engine reads:
const maxAllowedConfidence = ssc.confidenceFloor + 0.20;
// Engine cannot produce combinedConfidence > maxAllowedConfidence
```

### Rules Validated Against Proposal

| Rule | Implementation | Conflicts? |
|------|---------------|------------|
| Low data confidence → continue execution | Already how `normalizeConfidence` works — caps, doesn't block | NO |
| Low engine confidence → trigger correction | New: needs mid-pipeline gate | NO |
| Never block due to weak data alone | Must ensure SGL doesn't block on data quality alone | CHECK SGL |

**SGL Check**: The Signal Governance Layer (`resolveSglOrBlock`) CAN block engines when signal coverage is insufficient. This is blocking on DATA quality. 

**CONFLICT IDENTIFIED**: The proposal says "NEVER block due to weak data alone." But SGL already blocks when signal coverage is too low. This is a design tension.

**Resolution**: SGL blocking should be reclassified as an "insufficient input" block (structural), not a "weak data" block (quality). The distinction: "no data at all" vs "data exists but is weak." SGL blocks on the former, which is valid. `normalizeConfidence` handles the latter, which matches the proposal.

---

## PROPOSAL 6: SELF-CORRECTING SYSTEM

### Validation: COMPATIBLE — with strict scoping

### Current State

The system already has correction mechanisms:
1. **CEL retry**: Engines can be regenerated once if CEL depth gate fails
2. **Funnel reconstruction**: Channel Selection auto-injects missing channels
3. **System Control repair**: `executeRepairActions()` can inject conversion paths, downgrade scale decisions

### Proposed Scope

The self-correcting system must:
- Fix engine LOGIC (re-run with corrective directive)
- NOT compensate for weak DATA (that's `normalizeConfidence`)
- NOT modify MEMORY directly (memory writes happen post-pipeline only)
- NOT override SYSTEM CONTROL verdicts

### Compatibility with Memory System

**VALIDATED**: The memory system writes happen in `applyMemoryMutation()` which runs AFTER the pipeline completes. Self-correction runs DURING the pipeline. No conflict as long as self-correction does NOT call `applyMemoryMutation()` or write to the `strategyMemory` table.

**Implementation**: Self-correction should be triggered by mid-pipeline gates:
```
After Positioning: if confidence < 0.40 → re-run Positioning with corrective directive (max 1 retry)
After Offer: if painAlignment === 0 → re-run Offer with explicit pain injection (max 1 retry)
After Statistical Validation: if result === "rejected" → flag for System Control, do NOT re-run
```

### Maximum 1 Re-run Per Engine

This prevents infinite loops. The CEL already implements this pattern (`DEPTH_GATE_MAX_RETRIES = 1`). The self-correcting system should follow the same convention.

### Risk: Performance Impact

Each re-run adds ~3-8 seconds (AI call). Maximum 3 re-runs per pipeline (Positioning, Offer, Persuasion) = ~9-24 seconds additional. Current pipeline runs ~143 seconds. Worst case: ~167 seconds (17% increase). Acceptable.

---

## PROPOSAL 7: CONTROL LAYER ENHANCEMENT

### Validation: ALREADY MOSTLY IMPLEMENTED

The current System Control Layer (`server/system-control/`) already implements:

| Proposed Feature | Current Status | Gap |
|-----------------|----------------|-----|
| Consume all engine outputs | YES — receives `results: Map<EngineId, EngineStepResult>` | NONE |
| Evaluate structural completeness | YES — `collectBlockReasons()` | Add problem registry check |
| Problem resolution status | NO | NEW — check `ssc.problemRegistry` for unresolved criticals |
| Contradictions | YES — `detectContradictions()` | Extend with reason trace validation |
| Engine confidence | PARTIAL — checks some engines | Read `ssc.confidenceChain` |
| Produce PASS/DOWNGRADE/REPAIR/BLOCK | YES | NONE |

### Required Extension

```typescript
// In SystemControlInput (types.ts), add:
export interface SystemControlInput {
  // ... existing fields ...
  strategicContext?: SharedStrategicContext;  // NEW: includes problem registry, confidence chain, reason trace
}
```

New structural check: `checkProblemResolution(ssc.problemRegistry)`:
- Critical problems unresolved → BLOCK
- High problems unresolved > 2 → DOWNGRADE
- Problems discovered but never consumed by any engine → WARNING

---

## PROPOSAL 8: REPAIR ACTIONS

### Validation: ALREADY IMPLEMENTED

The repair system is fully operational in `server/system-control/repair-actions.ts`:

| Allowed Action | Current Status |
|---------------|----------------|
| Re-run specific engines (max 1 time) | YES — CEL depth gate retry |
| Inject missing structural components | YES — `INJECT_FALLBACK_CONVERSION` |
| Downgrade decisions (scale → test) | YES — `DOWNGRADE_SCALE_TO_TEST` |

| Blocked Action | Current Status |
|---------------|----------------|
| Re-run offer generation freely | ENFORCED — max 1 retry |
| Override integrity score | ENFORCED — non-repairable codes |
| Modify memory directly | ENFORCED — memory writes are post-pipeline |

**No changes needed. The repair system matches the proposal.**

---

## MID-PIPELINE GATES (NEW — CRITICAL ADDITION)

This is the MOST IMPORTANT addition not in the current system. The proposal implies this but doesn't explicitly call it out as a separate component.

### Current State

The pipeline runs ALL 15 engines to completion before System Control evaluates. There are NO mid-pipeline halts except for SGL signal coverage blocks.

### Proposed Gates

| After Engine | Gate Condition | Action |
|-------------|----------------|--------|
| Positioning | `confidence < 0.40` | Self-correct (re-run with directive). If still < 0.40 after retry → HALT pipeline, set verdict=BLOCK |
| Offer | `painAlignment === 0 AND audience.pains.length > 0` | Self-correct (re-run with explicit pain injection). If still zero → HALT pipeline |
| Statistical Validation | `result === "rejected"` | Set `ssc.problemRegistry += critical problem`. Do NOT halt (let System Control decide). But set `ssc.confidenceFloor = 0` so Budget Governor cannot scale. |
| Channel Selection | `conversionChannels === 0` | Register critical problem. System Control will block. |

### Implementation Location

In `server/orchestrator/index.ts`, after each `executeEngine` call for gated engines:

```typescript
// After positioning case:
if (ctx.positioning?.overallConfidence < 0.40) {
  // Self-correct: re-run with corrective directive
  // If still low → halt
}
```

### Performance Impact

If no gates trigger: ZERO additional latency (just an if-check).  
If one gate triggers: +3-8 seconds for retry.  
If gate fails after retry: Pipeline halts early, SAVING time (remaining engines don't run).

---

## PHASED IMPLEMENTATION PLAN (VALIDATED)

### Phase 1: Structural Foundation (Estimated: 3-4 days)

**Step 1.1**: Create `server/orchestrator/shared-strategic-context.ts`
- Define `SharedStrategicContext` interface
- Define `ProblemEntry`, `ReasonTraceEntry`, `ConfidenceChainEntry` interfaces
- Initialize function: `createEmptySSC()`
- Files: 1 new file

**Step 1.2**: Create `server/orchestrator/canonical-meanings.ts`
- Define `AwarenessMeaning` interface
- Define `AWARENESS_MEANINGS` lookup table
- Export `resolveAwarenessMeaning(stage: AwarenessStage): AwarenessMeaning`
- Files: 1 new file

**Step 1.3**: Wire SSC into orchestrator
- Add `strategicContext: createEmptySSC()` at pipeline init
- Pass `ssc` to each engine call
- After Audience Engine: populate `ssc.awarenessMeaning` from canonical definitions
- After each engine: update `ssc.confidenceFloor`
- Files: 1 modified (orchestrator/index.ts)

**Step 1.4**: Add Reason Trace to SSC
- Each engine appends trace entries to `ssc.reasonTrace`
- Start with 3 critical engines: Positioning, Offer, Channel Selection
- Expand to all engines in Phase 2
- Files: 3 engine files modified

**Step 1.5**: Add Problem Registry to SSC
- Each engine registers problems to `ssc.problemRegistry`
- Convert existing `warnings[]` to structured `ProblemEntry` objects for critical warnings
- Files: All 15 engine files (lightweight: add ~10 lines each)

**Validation**: Run test suite (177 tests) after each step. No functional behavior changes in Phase 1 — we're adding DATA, not changing DECISIONS.

### Phase 2: Intelligence Layer (Estimated: 3-4 days)

**Step 2.1**: Consolidate confidence system
- Remove local `assessDataReliability` overrides from Awareness and Persuasion engines
- Add `dataConfidence` + `engineConfidence` to all engine outputs
- Implement confidence inheritance: `maxConfidence = ssc.confidenceFloor + 0.20`
- Files: 6 engine files + engine-hardening

**Step 2.2**: Add mid-pipeline gates
- Post-Positioning gate (confidence < 0.40 → retry → halt)
- Post-Offer gate (zero pain alignment → retry → halt)
- Post-Statistical-Validation gate (rejected → confidence floor = 0)
- Post-Channel-Selection gate (zero conversion → register critical problem)
- Files: 1 file (orchestrator/index.ts)

**Step 2.3**: Fix awareness propagation bug
- Update `extractAudienceInput()` to include `awarenessLevel`
- Map canonical awareness meaning to Channel Selection input
- Ensure Channel Selection reads from `ssc.awarenessMeaning` instead of deriving its own
- Files: 2 files (orchestrator/index.ts, channel-selection/engine.ts)

**Step 2.4**: Replace per-engine awareness lookups with canonical meanings
- Channel Selection: Replace `AWARENESS_CHANNEL_MAP` reads with `ssc.awarenessMeaning.allowedChannelRoles`
- Persuasion: Replace `AWARENESS_PERSUASION_MAP` reads with `ssc.awarenessMeaning.allowedPersuasionModes`
- Funnel: Replace `AWARENESS_BLOCKED_FUNNELS` reads with `ssc.awarenessMeaning.blockedFunnelTypes`
- Files: 6 engine files

**Validation**: Run test suite. Test against live campaign. Compare outputs before/after — the awareness bug fix will change Channel Selection behavior (expected and desired).

### Phase 3: Control & Enforcement (Estimated: 2-3 days)

**Step 3.1**: Extend System Control input
- Add `strategicContext: SSC` to `SystemControlInput`
- Add `checkProblemResolution()` structural check
- Add confidence chain validation
- Files: 3 files (types.ts, structural-checks.ts, engine.ts)

**Step 3.2**: Replace integrity weighted average with hard gates
- `safeToExecute` formula changes:
  - Current: `score >= 0.4 && failedCount <= 2`
  - New: Individual critical checks become HARD GATES (not scored):
    - Zero pain alignment → false
    - Zero objection coverage → false
    - Confidence spread > 0.50 → false
    - Positioning confidence < 0.40 → false
- Files: 1 file (integrity-engine/engine.ts)

**Step 3.3**: Guard Budget Governor performance override
- Performance override must check: `ssc.confidenceFloor > 0` (statistical validation not rejected)
- Performance override must respect: `positioning confidence >= 0.40`
- Files: 1 file (budget-governor/engine.ts)

**Step 3.4**: Extend test suite
- Add tests for SSC propagation
- Add tests for mid-pipeline gates
- Add tests for confidence inheritance
- Add tests for canonical meaning enforcement
- Files: 1 file (system-control-proof.ts) + 1 new test file

**Validation**: Run full test suite. Run live campaign execution. Verify all 5 contradictions from the audit are now impossible.

---

## IDENTIFIED RISKS

### Risk 1: Engine Signature Changes (MEDIUM)
Adding `ssc` parameter to all 15 engines changes their function signatures. Any external callers (tests, API routes, direct invocations) must be updated.

**Mitigation**: Make `ssc` optional with a default empty SSC. This allows backward compatibility during migration.

### Risk 2: Performance (LOW)
SSC accumulation adds minimal overhead (~1-2ms per engine for object writes). Mid-pipeline gates add if-checks (~0ms). Retries add 3-8 seconds each (bounded at max 3).

**Mitigation**: Cap retries. Monitor pipeline duration.

### Risk 3: Memory System Interaction (LOW but MUST BE MONITORED)
SSC is ephemeral (per-run). Memory is persistent (across runs). These must stay separate. The risk is that someone adds a memory write inside an engine's SSC handler.

**Mitigation**: SSC file must have a clear comment: "SSC is per-run only. Do NOT write to strategyMemory from SSC handlers."

### Risk 4: Test Suite Breakage (MEDIUM)
177 existing tests expect current engine behavior. Phase 2 changes (confidence inheritance, awareness fix) will change outputs.

**Mitigation**: Phase 1 adds data only (no behavior changes). Phase 2 tests run separately. Phase 3 validates full integration.

---

## FINAL CONFIRMATION

### Can SSC + Problem Registry be introduced without breaking engine isolation?
**YES.** SSC is an additional parameter, not a replacement. Engines continue to return their existing types. SSC is additive.

### Can Reason Trace be enforced as a strict contract?
**YES with caveat.** It should live on SSC, not on individual engine inputs. Enforcement is at mid-pipeline gates and System Control, not at every engine boundary (too expensive).

### Is the Control Layer integration point correct?
**YES.** The orchestrator already calls `evaluateSystemControl()` at lines 1837-1844, AFTER all engines complete. Adding SSC to its input is a 1-line change to the call site.

### Are there any flaws in the proposal?
**Two flaws identified:**

1. **Confidence proposal says "NEVER block due to weak data alone"** — but SGL already blocks on insufficient signal coverage (which is a data quality issue). Resolution: Distinguish "no data" (block) from "weak data" (cap). This is already how the system behaves; the proposal just needs to acknowledge it.

2. **Execution order creates temporal contradiction** (Awareness evaluates Funnel before Funnel runs). The proposal doesn't address this. Resolution: Either reorder the pipeline (Funnel before Awareness) OR skip Funnel evaluation in Awareness when funnel hasn't run yet. Reordering is cleaner but changes the pipeline semantics.

---

## FILES REQUIRING CHANGES (COMPLETE LIST)

### Phase 1 (New files)
- `server/orchestrator/shared-strategic-context.ts` (NEW)
- `server/orchestrator/canonical-meanings.ts` (NEW)

### Phase 1 (Modified files)
- `server/orchestrator/index.ts` — SSC initialization and passing
- 15 engine files — Add SSC parameter (optional), register problems, append reason trace

### Phase 2 (Modified files)
- `server/orchestrator/index.ts` — Mid-pipeline gates, awareness fix
- `server/engine-hardening/index.ts` — Confidence output extension
- `server/awareness-engine/engine.ts` — Remove local reliability override
- `server/persuasion-engine/engine.ts` — Remove local reliability override
- `server/strategy/channel-selection/engine.ts` — Read canonical awareness
- `server/funnel-engine/engine.ts` — Read canonical awareness
- `server/strategy/budget-governor/engine.ts` — Guard performance override

### Phase 3 (Modified files)
- `server/system-control/types.ts` — Add SSC to input
- `server/system-control/structural-checks.ts` — Problem registry check
- `server/system-control/engine.ts` — Consume SSC
- `server/integrity-engine/engine.ts` — Hard gates
- `server/tests/system-control-proof.ts` — Extended tests
