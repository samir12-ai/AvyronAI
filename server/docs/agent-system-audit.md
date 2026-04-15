# Agent System — Complete Code-Level Audit

**Date:** April 15, 2026
**Purpose:** Full technical deep-dive before Control Layer introduction
**Method:** Static code analysis with exact file paths, line numbers, and function signatures

---

## Table of Contents

1. [Full Agent Architecture](#1-full-agent-architecture)
2. [Iteration Engine — Full Breakdown](#2-iteration-engine--full-breakdown)
3. [Adaptive System](#3-adaptive-system)
4. [Strategic Memory System](#4-strategic-memory-system)
5. [Agent → System Influence](#5-agent--system-influence)
6. [Feedback Loop Mechanics](#6-feedback-loop-mechanics)
7. [Limitations (Code-Level)](#7-limitations-code-level)
8. [Conflict Potential with Control Layer](#8-conflict-potential-with-control-layer)
9. [Data Contracts](#9-data-contracts)
10. [Full Flow Example](#10-full-flow-example-end-to-end)

---

## 1. Full Agent Architecture

### 1.1 All Files

| File | Role |
|------|------|
| `server/strategy/iteration-engine/engine.ts` | Core iteration logic: 4-layer analysis + plan generation |
| `server/strategy/iteration-engine/routes.ts` | API endpoints, input validation gates, DB persistence |
| `server/strategy/iteration-engine/constants.ts` | Thresholds: CTR_FLOOR, ROAS_FLOOR, boundary patterns |
| `server/strategy/iteration-engine/types.ts` | TypeScript interfaces for all inputs/outputs |
| `server/strategy/retention-engine/engine.ts` | Post-purchase LTV, churn risk, retention loops |
| `server/strategy/retention-engine/routes.ts` | Retention API endpoints |
| `server/memory-mutation/engine.ts` | Memory write/update/decay logic (791 lines) |
| `server/memory-system/manager.ts` | Memory read, conflict resolution, prompt serialization (292 lines) |
| `server/memory-system/types.ts` | MemorySlot, MemoryBlock, MemoryClass type definitions |
| `server/memory-system/industry-baseline.ts` | Industry baseline derivation for memory comparison |
| `server/orchestrator/memory-context.ts` | Memory injection into orchestrator, format constraints, results override (209 lines) |
| `server/decision-policy/index.ts` | Write gates: MEMORY_WRITE_MIN, confidence thresholds (293 lines) |
| `server/adaptive-rhythm/engine.ts` | Content format frequency adaptation |
| `server/exploration-budget/engine.ts` | Exploration % allocation for untested strategies |
| `server/autonomous-worker.ts` | Background autonomous analysis every 5 minutes |
| `server/conflict-resolver.ts` | Priority-based conflict resolution between engines |
| `server/confidence.ts` | System state machine: ACTIVE / RECOVERY_MODE / SAFE_MODE |

### 1.2 Entry Points in Orchestrator

**File:** `server/orchestrator/index.ts`

```
Line 1643: buildMemoryContext()        → loads memory from DB
Line 1649: serializeMemoryContextForPrompt() → formats for injection
Line 1651: ctx.memoryContext = serialized  → stored in engine context

Line 1280: executeEngine("iteration")  → runs iteration engine (Tier 7: CREATIVE)
Line 1380: executeEngine("retention")  → runs retention engine (Tier 7: CREATIVE)

Line 1473: writeStrategyMemoryEntries() → persists engine decisions to memory
Line 1575: applyMemoryMutation()       → physical DB write
```

### 1.3 Execution Order

```
ENGINE_PRIORITY_ORDER (from priority-matrix.ts):

Tier 1 MARKET_REALITY:  market_intelligence → audience
Tier 2 POSITIONING:     positioning → differentiation
Tier 3 OFFER:           mechanism → offer
Tier 4 MESSAGING:       awareness → funnel → persuasion → integrity
Tier 5 FINANCIAL:       statistical_validation → budget_governor
Tier 6 CHANNEL:         channel_selection
Tier 7 CREATIVE:        iteration → retention          ← AGENT RUNS HERE (LAST)
```

The Agent (iteration + retention) runs AFTER all other engines. It has read access to all upstream outputs but cannot re-trigger them.

### 1.4 Dependencies (What Agent Reads)

```
Iteration Engine reads:
  - performance data (manualCampaignMetrics, growthCampaigns)
  - ctx.funnel (Funnel Engine output)
  - ctx.persuasion (Persuasion Engine output)
  - ctx.memoryContext (serialized memory string)

Retention Engine reads:
  - Audience data (pains, objections, desires)
  - Offer data (offerName, coreOutcome, deliverables, proofStrength)
  - Funnel data (stages mapped to touchpoints)
  - Manual retention metrics (refundRate, repeatPurchaseRate, churnRate)
  - ctx.memoryContext
```

---

## 2. Iteration Engine — Full Breakdown

### 2.1 File Structure

```
server/strategy/iteration-engine/
├── engine.ts     (907 lines)  — Core logic
├── routes.ts     (148 lines)  — API + validation
├── constants.ts  (85 lines)   — Thresholds
└── types.ts      (112 lines)  — Interfaces
```

### 2.2 Input Validation Gate

**File:** `server/strategy/iteration-engine/routes.ts`, lines 66-87

Before engine runs, validates:
```typescript
hasExistingAsset    // must have a campaign to iterate on
primaryKpi          // must have a defined optimization goal
dataWindowDays      // must be 7, 14, 30, or 60
// At least ONE real metric:
spend || impressions || clicks || leads || revenue
```

If any missing → engine returns `NEEDS_INPUT` status, orchestrator pauses.

### 2.3 Processing Layers

#### Layer 1: Performance Analysis
**File:** `engine.ts`, lines 117-159

```typescript
// Thresholds (from constants.ts):
CTR_FLOOR = 0.005                // 0.5%
ROAS_FLOOR = 0.8
CONVERSION_RATE_FLOOR = 0.01     // 1%
CPA_CEILING_MULTIPLIER = 2.5

// Detection logic:
if (ctr < CTR_FLOOR) → flags "creative/targeting issues"
if (roas < ROAS_FLOOR) → flags "cost efficiency issues"
if (conversionRate < CONVERSION_RATE_FLOOR) → flags "conversion bottleneck"
if (cpa > targetCpa * CPA_CEILING_MULTIPLIER) → flags "CPA ceiling breach"
```

#### Layer 2: Funnel Analysis
**File:** `engine.ts`, lines 161-236

```typescript
// Detects drop-off points:
for each funnelStage:
  if (stage.conversionRate < 0.10) → flagged as bottleneck  // line 217

// If explicit funnel data missing, synthesizes from metrics:
// lines 169-202: builds synthetic funnel from impression→click→conversion chain
```

#### Layer 3: Creative Analysis
**File:** `engine.ts`, lines 238-316

```typescript
// Identifies bottom performers:
bottomPerformers = creatives.filter(c => c.performanceScore < median * 0.6)

// Detects creative fatigue (line 306):
fatigueSignals = creatives.filter(c =>
  c.impressions > impressionThreshold &&
  c.ctr < CTR_FLOOR * 0.5  // CTR dropped below half the floor
)
```

#### Layer 4: Iteration Guard
**File:** `engine.ts`, lines 318-366

```typescript
MAX_CONCURRENT_TESTS = 3
FAILED_TEST_REPEAT_WINDOW_DAYS = 30

// Blocks hypotheses that:
// 1. Exceed concurrent test limit
// 2. Repeat a strategy that failed within last 30 days
// 3. Match BOUNDARY_BLOCKED_PATTERNS (financial guarantees, etc.)
```

### 2.4 Boundary Sanitization

**File:** `engine.ts`, lines 43-50

```typescript
function sanitizeBoundary(text: string): { passed: boolean; violations: string[] } {
  for (const [domain, pattern] of Object.entries(BOUNDARY_BLOCKED_PATTERNS)) {
    if (pattern.test(text)) {
      violations.push(`Boundary violation: ${domain} domain detected`);
    }
  }
}
// BOUNDARY_BLOCKED_PATTERNS (constants.ts lines 29-33):
// - Financial guarantees
// - Unrealistic scaling promises
// - Medical/legal claims
```

### 2.5 Output Structure

**File:** `types.ts`, line 100

```typescript
interface IterationResult {
  nextTestHypotheses: TestHypothesis[];      // specific A/B tests to run
  optimizationTargets: OptimizationTarget[];  // metrics to improve + confidence
  failedStrategyFlags: FailedStrategyFlag[];  // post-mortem of failures
  iterationPlan: IterationPlanStep[];         // step-by-step with fallbacks
  dataReliability: {
    overall: number;                          // 0-1
    signalDensity: number;
    hasSufficientData: boolean;
  };
  confidence: number;                         // composite score
  warnings: string[];
  engineVersion: string;
}
```

### 2.6 Benchmark Exploration Mode

**File:** `engine.ts`, lines 754-774

When NO performance data exists:
```
Skips analysis layers entirely
Returns industry-standard baseline hypotheses:
  - "Test hook angles for audience engagement"
  - "Test audience segments for targeting"
  - "Establish baseline metrics"
```

### 2.7 Memory Context Adjustment

**File:** `engine.ts`, lines 784-813

```typescript
if (memoryContext) {
  // Parse REINFORCE/AVOID from serialized memory
  for each target in optimizationTargets:
    if (target.label matches REINFORCE pattern) → priority += 0.15
    if (target.label matches AVOID pattern) → priority -= 0.20
}
```

---

## 3. Adaptive System

### 3.1 Adaptive Rhythm Engine

**File:** `server/adaptive-rhythm/engine.ts`
**Main function:** `computeAdaptiveRhythm()` (line 95)

#### Inputs:
```typescript
{
  contentPerformanceSnapshots,  // smoothedPerformanceScore per format
  miSnapshots,                  // competitor velocity data
  businessDataLayer,            // monthlyBudget, goalTimeline, goalTarget
  strategyMemory,               // historical content_rhythm decisions
  currentRhythm                 // previous week's distribution
}
```

#### Processing:
```
Step 1: Basis Selection (lines 213-267)
  if (has performance data) → basis = "performance_data"
  else if (has competitor data) → basis = "competitor_benchmark"
  else → basis = "default_balanced"

Step 2: Competitor Velocity (line 48, extractCompetitorVelocity)
  Calculates ratio of formats used by competitors from MI snapshots

Step 3: Memory Bias (lines 269-288)
  If memory has winners/avoids for specific formats:
    blendFactor = 0.25
    format_weight = (1 - blendFactor) * data_weight + blendFactor * memory_weight

Step 4: Stabilization (line 306)
  MAX_DELTA = ±2 units per week vs previous rhythm
  No format changes more than ±2 in a single cycle
```

#### Output:
```typescript
{
  reelsPerWeek: number,
  carouselsPerWeek: number,
  storiesPerDay: number,
  postsPerWeek: number,
  basis: "performance_data" | "competitor_benchmark" | "default_balanced",
  deltas: { format: string, previous: number, current: number }[]
}
```

### 3.2 Exploration Budget

**File:** `server/exploration-budget/engine.ts`
**Main function:** `computeExplorationBudget()` (line 88)

```typescript
explorationPercent = range(10%, 35%)

// Adjustment factors:
if (many high-confidence "reinforce" entries in memory):
  explorationPercent -= confidencePenalty  // line 111

if (many low-confidence "avoid" entries):
  explorationPercent += uncertaintyBonus   // triggers "retests" (line 155)

// Discovery slots for never-tested formats (line 164):
discoveryFormats = formats.filter(f => !memory.has(f) && !avoid.has(f))
```

### 3.3 Where Adaptation is Called

```
server/build-plan-layer/engine.ts, line 496:
  rhythm = computeAdaptiveRhythm(...)

server/orchestrator/plan-synthesis.ts, line 1205:
  rhythm = computeAdaptiveRhythm(...)
  // Then applyMemoryConstraints() adjusts the rhythm
```

---

## 4. Strategic Memory System

### 4.1 Memory Write

#### A. Write Entry Point

**File:** `server/memory-mutation/engine.ts`
**Main function:** `applyMemoryMutation()` (line 28)

```typescript
async function applyMemoryMutation(
  campaignId: string,
  accountId: string,
  entries: MemoryMutationEntry[],
  planId: string,
): Promise<{ written: number; updated: number; decayed: number }>
```

#### B. Write Conditions & Thresholds

**File:** `server/decision-policy/index.ts`, lines 1-10

```typescript
DECISION_CONFIDENCE_THRESHOLDS = {
  MEMORY_WRITE_MIN: 0.65,              // strategic memories blocked below this
  PLAN_INCLUSION_MIN: 0.5,             // decisions blocked from plan below this
  AGENT_ACTION_MIN: 0.5,               // agent actions blocked below this
  PROVISIONAL_WRITE_PERIODS_REQUIRED: 2, // 2 consecutive periods above baseline
  FALLBACK_SOURCE_PENALTY: 0.15,       // penalty for manual/API data sources
  FALLBACK_SOURCE_MIN_FLOOR: 0.2,      // absolute floor after penalty
}
```

**Gate function:** `policyEnforcedMemoryCheck()` (decision-policy/index.ts)

```
Called at:
  memory-mutation/engine.ts line 70 (UPDATE path)
  memory-mutation/engine.ts line 99 (INSERT path)

Logic:
  if (confidence < MEMORY_WRITE_MIN && memoryType is strategic) → BLOCKED
  Exception: content_rhythm and exploration_budget bypass threshold
    (they represent operational state, not strategic bias)
```

#### C. Memory Object Structure

**Table:** `strategyMemory` in `shared/schema.ts`, lines 186-216

```typescript
{
  id: string,                    // UUID
  accountId: string,
  campaignId: string,
  memoryType: MemoryClass,       // "content_rhythm" | "channel_decision" | "market_signal" |
                                 // "budget_decision" | "iteration_direction" | "retention_approach"
  engineName: string | null,     // originating engine
  label: string,                 // human-readable description
  details: string | null,        // extended context
  score: number,                 // blended performance score (0-1)
  confidenceScore: number,       // 0.0 to 1.0
  direction: "reinforce" | "avoid" | "neutral",
  isWinner: boolean,             // true when direction === "reinforce"
  strategyFingerprint: string,   // dedup key: "engine::label::details" hash
  planId: string | null,         // plan that created this memory
  usageCount: number,            // how many times this memory was used
  decayRate: number,             // default 0.95
  lastValidatedAt: Date | null,
  validationCount: number,
  // Contextual scoping:
  industry: string | null,
  platform: string | null,
  campaignType: string | null,
  funnelObjective: string | null,
  sourceOutcomeId: string | null, // links to specific outcome
}
```

#### D. Winner / Avoid / Reinforce Logic

**Write side** (`memory-mutation/engine.ts` lines 63-66, 93-95):

```typescript
// Direction resolution priority:
1. Explicit entry.direction (if provided)
2. entry.isWinner === true → "reinforce", false → "avoid"
3. Previous direction (if updating existing)
4. Default → "neutral"

// Convenience functions:
recordWinnerMemory()  → direction: "reinforce", isWinner: true, confidence: 0.85
recordAvoidMemory()   → direction: "avoid", isWinner: false, confidence: 0.15
```

**Read side** (`memory-system/manager.ts` lines 172-182):

```typescript
// Categorization during load:
if (direction === "reinforce" || (direction === "neutral" && effectiveConfidence >= 0.6)):
  → reinforceSlots
if (direction === "avoid" || (direction === "neutral" && effectiveConfidence < 0.4)):
  → avoidSlots
else:
  → pendingSlots  // neutral with confidence 0.4-0.6
```

#### E. Update Logic (Blending)

**File:** `memory-mutation/engine.ts`, lines 59-60

```typescript
// When memory with same fingerprint already exists:
blendedScore = 0.6 * previousScore + 0.4 * newConfidence
// Old evidence weighted 60%, new evidence 40%
```

### 4.2 Memory Read & Injection

#### A. Load Function

**File:** `server/memory-system/manager.ts`, function `loadMemoryBlock()` (line 119)

```typescript
async function loadMemoryBlock(
  campaignId, accountId, bizData?, memoryContext?
): Promise<MemoryBlock>

Steps:
1. Fetch last 100 memory rows for this campaign (line 135)
2. Skip content_rhythm (handled separately) and non-strategic types
3. Context match: filter by industry, platform, campaignType, funnelObjective (line 162)
4. Compute effective confidence with decay (line 164)
5. Skip if effectiveConfidence < 0.1 (line 165)
6. Resolve conflicts: same fingerprint → highest effective confidence wins (line 170)
7. Categorize into reinforce/avoid/pending (lines 172-182)
8. Derive industry baseline (line 186)
```

#### B. Confidence Enforcement Bands

**File:** `memory-system/manager.ts`, lines 18-23

```typescript
CONFIDENCE_ENFORCEMENT_MAP:
  0.0 - 0.4  → strength: "none",     multiplier: 0.0   // ignored
  0.4 - 0.6  → strength: "soft",     multiplier: 0.25  // informational
  0.6 - 0.8  → strength: "moderate", multiplier: 0.6   // meaningful
  0.8 - 1.0  → strength: "strong",   multiplier: 0.9   // near-mandatory
```

#### C. Prompt Serialization

**File:** `memory-system/manager.ts`, function `serializeMemoryBlockForPrompt()` (line 241)

```
Output format:
"STRATEGY_MEMORY (confidence-weighted constraints):
REINFORCE (prefer these directions — weight by confidence band):
  [STRONG guidance 85% effective confidence] [channel_selection] "Instagram Reels": Top performer 3 cycles
AVOID (confidence-weighted — apply proportionally, not as hard blocks):
  [MODERATE guidance 52% effective confidence] [iteration_engine] "TikTok Ads": Failed 2 consecutive tests
CONTENT_RHYTHM (adaptive): 4 reels/wk, 2 carousels/wk — current distribution
INDUSTRY_BASELINE (AWARENESS/coaching): Reels 3/wk · Carousels 2/wk · Stories 2/day · Posts 3/wk
INSTRUCTION: Apply all REINFORCE and AVOID entries with weight proportional to their effective confidence band..."
```

#### D. Which Engines Receive Memory

```
Via ctx.memoryContext (injected at orchestrator/index.ts line 1651):
  ALL engines receive this string as part of their context.
  However, only engines that USE it in their prompt matter:

Engines that actively parse memoryContext:
  - iteration-engine/engine.ts (lines 784-813): adjusts priority ±0.15/0.20
  - retention-engine/engine.ts: uses as AI context
  - plan-synthesis.ts: included in synthesis prompt
  - autonomous-worker.ts: uses for strategy analysis

Engines that receive but don't specifically parse:
  - All other engines get it in their prompt as "HARD CONSTRAINTS" text
  - AI models are instructed to follow it proportionally
```

#### E. Physical Injection Point

**File:** `server/orchestrator/memory-context.ts`, line 146-149

```typescript
function serializeMemoryContextForPrompt(block: MemoryBlock): string {
  return `[MEMORY SYSTEM — HARD CONSTRAINTS]
The following content format rules are already applied to your output by the system.
Your generated content format allocations must not contradict these constraints —
they are hard limits enforced at the system level...

${serializeMemoryBlockForPrompt(block)}`;
}
```

### 4.3 Memory Mutation & Decay

#### A. Decay Mechanism

**File:** `memory-mutation/engine.ts`, lines 23-26, 130-166

```typescript
DECAY_HALF_LIFE_DAYS = 30
DECAY_THRESHOLD = 0.05

function computeDecay(score, daysSinceUpdate):
  return score * Math.pow(0.5, daysSinceUpdate / 30)

// Applied after every mutation batch (line 124):
applyConfidenceDecay():
  For each memory older than 30 days:
    newScore = computeDecay(currentScore, daysSinceUpdate)
    if (newScore < 0.05):
      → set score=0, direction="neutral", confidence=0.1  // neutralized
    else:
      → update score and confidence to decayed values
```

#### B. Direction Flip

**File:** `server/orchestrator/memory-context.ts`, lines 157-200

```typescript
function checkResultsOverrideMemory(memoryEntry, recentSnapshots):
  // Only evaluates "avoid" entries
  if (entry.direction !== "avoid") → no evaluation

  // Requires 3 consecutive snapshots
  if (snapshots.length < 3) → insufficient data

  // Each snapshot must outperform baseline by >20%
  for each of last 3 snapshots:
    threshold = baseline * 1.20
    if (performanceScore > threshold) → count++

  if (count >= 3):
    → override: true
    → newConfidenceDirection: "reinforce"
    → reason: "outperformed industry baseline by X% across 3 snapshots"
```

#### C. Mutation Constants

**File:** `memory-mutation/engine.ts`, lines 193-200

```typescript
MIN_PERIODS_FOR_CONFIDENCE_MOVE = 2    // 2 periods to shift confidence
MIN_PERIODS_FOR_FLIP = 3              // 3 periods to flip direction
BELOW_BASELINE_THRESHOLD = 0.15       // 15% below baseline = challenged
CONFIDENCE_INCREMENT = 0.05           // per-period confidence shift
FLIP_RESET_CONFIDENCE = 0.35          // confidence after a flip
DECAY_NEUTRAL_THRESHOLD = 0.1         // below this → neutralize
INDUSTRY_BASELINE_DEFAULT = 0.5       // fallback baseline
MAX_SNAPSHOTS = 4                     // max snapshots to evaluate
```

---

## 5. Agent → System Influence

### 5.1 Influence Map

| Target System | Direct Modification? | Mechanism | Code Reference |
|---------------|---------------------|-----------|----------------|
| **Plan Synthesis** | NO | Attaches "Conflicts" and "Hints" metadata | plan-synthesis.ts:1226-1259 |
| **Budget Decisions** | NO | Iteration data is "Insight" only | orchestrator/index.ts:1504 |
| **Funnel Decisions** | NO | Provides funnel analysis findings to context | plan-synthesis.ts:341 |
| **Channel Selection** | NO | Flags past channel failures in memory | Written via writeStrategyMemoryEntries |
| **Content Rhythm** | YES (indirect) | Memory adjusts adaptive rhythm weights | adaptive-rhythm/engine.ts:269 |
| **All Engine Prompts** | YES (indirect) | Injects REINFORCE/AVOID into LLM context | orchestrator/index.ts:1651 |

### 5.2 Specific Influence Code Paths

#### Plan Synthesis Conflict Detection

**File:** `server/orchestrator/plan-synthesis.ts`, lines 1226-1259

```typescript
// After AI generates plan, check for iteration conflicts:
if (iterationResult?.failedStrategyFlags) {
  for each flag in failedStrategyFlags:
    if (planContent.includes(flag.strategy)):
      iterationConflicts.push({
        strategy: flag.strategy,
        reason: flag.reason,
        confidence: flag.confidence
      })
}

// Attach as metadata (NOT as a block or override):
plan.iterationConflicts = iterationConflicts    // line 1240
plan.iterationOptimizationHints = optimizationTargets  // line 1252
```

#### Memory Write from Iteration

**File:** `server/orchestrator/index.ts`, lines 1523-1530

```typescript
// In writeStrategyMemoryEntries():
if (iterationResult) {
  const topTarget = iterationResult.optimizationTargets[0];
  entries.push({
    engineName: "iteration_engine",
    memoryType: "iteration_direction" as MemoryClass,
    label: topTarget?.label || "Iteration optimization target",
    details: topTarget?.description,
    confidenceScore: topTarget?.confidence,
    direction: "reinforce",
  });
}
```

### 5.3 Key Finding: Prompt Influence vs. Code Modification

The Agent system **NEVER** directly modifies:
- Engine decision variables
- Budget amounts or scaling factors
- Funnel structure or stages
- Channel assignments
- Integrity scores
- `safeToExecute` flag
- `executionStatus`
- Plan approval status

It influences through two paths:
1. **Memory → Prompt**: Serialized text injected into LLM context for all engines
2. **Memory → Adaptive Rhythm**: Physical adjustment of content format counts (±2 max delta)

---

## 6. Feedback Loop Mechanics

### 6.1 Complete Loop

```
RUN N:
  1. Orchestrator starts
  2. Memory loaded: buildMemoryContext() → loadMemoryBlock()
     (orchestrator/index.ts:1643)
  3. Memory serialized: serializeMemoryContextForPrompt()
     (orchestrator/index.ts:1649)
  4. ctx.memoryContext = serialized string
     (orchestrator/index.ts:1651)
  5. All engines run with ctx.memoryContext in their prompt
  6. Iteration engine runs (Tier 7, LAST)
  7. Iteration analyzes performance → generates hypotheses + flags
  8. synthesizePlan() attaches iteration conflicts/hints
  9. writeStrategyMemoryEntries() → extracts decisions
     (orchestrator/index.ts:1473-1585)
  10. applyMemoryMutation() → writes/updates to strategyMemory table
      (memory-mutation/engine.ts:28)
  11. applyConfidenceDecay() → decays stale memories
      (memory-mutation/engine.ts:130)

RUN N+1:
  1. Orchestrator starts
  2. Memory loaded → includes iteration findings from Run N
  3. Engines receive updated REINFORCE/AVOID constraints
  4. AI models adjust their outputs proportionally
  5. Cycle repeats
```

### 6.2 Timing

```
Is feedback real-time?  → NO
Is feedback next-run only?  → YES (for orchestrator loop)

Exception: Autonomous Worker
  File: server/autonomous-worker.ts
  Runs every 5 minutes (line 31: WORKER_INTERVAL_MS = 5 * 60 * 1000)
  But processes each account only once per 6 hours (CYCLE_THRESHOLD_MS)
  Can generate up to 1 decision per hour (MAX_DECISIONS_PER_HOUR)
  Uses same memory system but operates OUTSIDE the orchestrator loop
```

### 6.3 Autonomous Worker Loop

**File:** `server/autonomous-worker.ts`

```
Every 5 minutes:
  1. Lock acquisition (lines 39-69)
  2. Safety checks:
     - Skip if idle > 7 days (lines 304-335)
     - Skip if circuit breaker tripped (lines 296-302)
  3. Load plan: must be APPROVED or READY_FOR_REVIEW (line 384)
  4. Run guardrails: budget caps, CPA guards, ROAS floors (line 454)
  5. Evaluate pending outcomes: close the loop on past decisions (line 458)
  6. Run strategy analysis with GPT (lines 101-246):
     - Input: performance snapshots, strategy memory, guardrail state
     - Output: up to 3 JSON decisions per cycle
  7. Execute decisions (with confidence gates)
  8. Write to memory
```

---

## 7. Limitations (Code-Level)

### 7.1 Cannot Block Execution

```
The Agent CANNOT set:
  - safeToExecute = false    (only integrity engine + cross-engine override can)
  - executionStatus = "HALTED"  (only plan-synthesis via budget governor)
  - plan.status changes       (only manual approval or execution-activation)
  - emergencyStopped = true   (only user action or autonomous worker safe mode)

Code proof:
  In executeEngine("iteration") at orchestrator/index.ts:1280:
    result = await runIterationEngine(performance, funnel, creative, persuasion, memory)
    // Result is stored in results Map but NOT checked for blocking:
    // No call to shouldBlockDownstream() for iteration results
```

### 7.2 Cannot Override Budget

```
Budget governor (Tier 5) runs BEFORE iteration (Tier 7).
Iteration has no code path to:
  - Modify budgetDecision
  - Change the kill flag
  - Adjust scaling factors

The only budget influence is through memory:
  writeStrategyMemoryEntries writes "budget_decision" memory (index.ts:1511)
  But this only affects the NEXT run's prompt, not the current decision.
```

### 7.3 Cannot Force Engine Re-run

```
Engine execution is one-pass in the orchestrator loop.
There is no code path from iteration or retention to trigger:
  - Re-execution of an upstream engine
  - Invalidation of an upstream snapshot
  - Forced re-synthesis

The only "re-run" mechanism is:
  orchestrator/routes.ts: POST /api/orchestrator/run with scopedEngines
  This requires a NEW API call — it's user-initiated, not agent-initiated.

Exception: Autonomous Worker (autonomous-worker.ts)
  The worker CAN trigger system state changes:
  - checkSafeModeConditions() → can set state to SAFE_MODE (line 500)
  - But this blocks execution, it doesn't re-run engines
```

### 7.4 Cannot Modify Upstream Outputs

```
server/strategy/dependency-validation.ts enforces PROHIBITED_CROSS_ENGINE_WRITES:
  - Iteration cannot write to budget_risk_score, offer_completeness, funnel_strength, etc.
  - Only the Master Plan (Orchestrator) reconciles engine outputs
```

### 7.5 Cannot Reject Plan

```
Iteration runs within the orchestrator loop.
Plan synthesis happens AFTER iteration (orchestrator/index.ts:1834).
Iteration CAN attach warnings/conflicts to the plan.
Iteration CANNOT:
  - Prevent synthesizePlan() from running
  - Set plan.status to anything other than what synthesis decides
  - Override the final safeToExecute verdict
```

---

## 8. Conflict Potential with Control Layer

### 8.1 Memory Injection Overlap

```
RISK: HIGH
WHERE: orchestrator/memory-context.ts line 146-149

The memory system injects "[MEMORY SYSTEM — HARD CONSTRAINTS]" into every engine prompt.
If the Control Layer ALSO injects system-level constraints into prompts:
  → Two competing constraint blocks
  → AI may follow one and ignore the other
  → Conflicting guidance (memory says "reinforce reels" while control says "halt all content")

RECOMMENDATION:
  Control Layer should WRAP or SUPERSEDE memory injection, not compete with it.
  The Control Layer's constraints should be injected BEFORE memory constraints,
  with explicit priority ordering in the prompt.
```

### 8.2 Execution Gating Duplication

```
RISK: MEDIUM
WHERE: Multiple files

Current gates:
  execution-activation/engine.ts:266 → plan.status === "APPROVED"
  task-composer.ts → integrityScore >= 0.6, signalTrustedRatio >= 0.3
  plan-synthesis.ts:1069 → cross-engine integrity override
  gates/registry.ts → autopilot, safe mode, AI budget

If Control Layer adds its OWN execution gate:
  → Must integrate with existing gates, not create a parallel system
  → Must be THE final gate (after all others), not one of many

RECOMMENDATION:
  Control Layer should be the SINGLE gate that consumes all other checks,
  not an additional check alongside them.
```

### 8.3 Adaptive Rhythm Competition

```
RISK: MEDIUM
WHERE: adaptive-rhythm/engine.ts + memory-context.ts

Current flow:
  1. computeAdaptiveRhythm() → calculates base rhythm
  2. applyMemoryConstraints() → adjusts based on memory
  3. Plan synthesis uses the adjusted rhythm

If Control Layer also adjusts content distribution:
  → Three competing rhythm adjusters
  → Memory says "+2 reels", rhythm says "-1 reel", control says "0 reels"

RECOMMENDATION:
  Control Layer should set BOUNDS, not specific numbers.
  "Max 5 reels/week" is a bound. "Set reels to 3" conflicts with existing logic.
```

### 8.4 Self-Correction vs. Memory Mutation

```
RISK: HIGH
WHERE: memory-mutation/engine.ts + memory-context.ts:157

The Agent already has a self-correction mechanism:
  - checkResultsOverrideMemory() flips avoid→reinforce after 3 strong snapshots
  - applyConfidenceDecay() neutralizes stale memories
  - Blended updates (60/40 old/new) smooth transitions

If Control Layer adds its OWN self-correction:
  → Two competing correction loops
  → Memory mutation says "avoid" but control layer says "proceed"
  → Decay timeline conflicts (memory: 30-day half-life vs. control: ???)

RECOMMENDATION:
  Control Layer should OPERATE THROUGH the memory system, not around it.
  Self-correction should feed into memory writes with appropriate confidence,
  using the existing policyEnforcedMemoryCheck() gates.
```

### 8.5 Autonomous Worker Overlap

```
RISK: HIGH
WHERE: server/autonomous-worker.ts

The autonomous worker ALREADY:
  - Analyzes performance every 6 hours
  - Generates up to 3 decisions per cycle
  - Evaluates pending outcomes
  - Can trigger SAFE_MODE
  - Checks guardrails and compliance

If Control Layer adds continuous monitoring:
  → Two background monitoring systems
  → Worker makes a decision, Control Layer overrides it
  → Conflicting state transitions

RECOMMENDATION:
  Control Layer should REPLACE or WRAP the autonomous worker,
  not run alongside it. The worker's functionality should be
  subsumed into the Control Layer's monitoring loop.
```

### 8.6 Conflict Resolver Priority Clash

```
RISK: LOW
WHERE: server/conflict-resolver.ts

Current priority hierarchy:
  hard_constraints > compliance > goal_feasibility > funnel_math > budget_limits > ...

If Control Layer introduces its own priority system:
  → Must use the SAME hierarchy
  → Control Layer decisions should be tagged as "hard_constraints" or "compliance"

RECOMMENDATION:
  Control Layer decisions should be inserted at the TOP of CONFLICT_PRIORITY
  (above "hard_constraints") as "system_control" priority.
```

---

## 9. Data Contracts

### 9.1 Iteration Engine Input Contract

```typescript
// Called at orchestrator/index.ts:1280
runIterationEngine(
  performance: {
    impressions: number,
    clicks: number,
    conversions: number,
    spend: number,
    revenue: number,
  } | null,
  funnel: FunnelResult | null,      // from funnel engine
  creative: null,                    // currently always null
  persuasion: PersuasionResult | null, // from persuasion engine
  memoryContext: string | undefined, // serialized memory
): Promise<IterationResult>
```

### 9.2 Iteration Engine Output Contract

```typescript
IterationResult {
  nextTestHypotheses: Array<{
    id: string,
    hypothesis: string,
    testType: "A/B" | "multivariate" | "sequential",
    confidence: number,
    duration: number,
    successCriteria: string,
    fallbackAction: string,
  }>,
  optimizationTargets: Array<{
    id: string,
    label: string,
    description: string,
    currentValue: number,
    targetValue: number,
    confidence: number,
    priority: number,
  }>,
  failedStrategyFlags: Array<{
    strategy: string,
    reason: string,
    confidence: number,
    failedAt: string,
  }>,
  iterationPlan: Array<{
    step: number,
    action: string,
    metric: string,
    threshold: number,
    fallback: string,
  }>,
  dataReliability: { overall: number, signalDensity: number, hasSufficientData: boolean },
  confidence: number,
  warnings: string[],
  engineVersion: string,
}
```

### 9.3 Memory Write Contract

```typescript
MemoryMutationEntry {
  engineName: string,              // e.g. "iteration_engine"
  memoryType: MemoryClass,         // e.g. "iteration_direction"
  label: string,                   // human-readable
  details: string | null,
  confidenceScore: number,         // 0.0-1.0, must be >= 0.65 for strategic writes
  direction: "reinforce" | "avoid" | "neutral",
  isWinner: boolean,
  planId: string | null,
}
```

### 9.4 Memory Read Contract (MemoryBlock)

```typescript
MemoryBlock {
  campaignId: string,
  accountId: string,
  reinforceSlots: MemorySlot[],    // direction=reinforce OR (neutral + confidence>=0.6)
  avoidSlots: MemorySlot[],        // direction=avoid OR (neutral + confidence<0.4)
  pendingSlots: MemorySlot[],      // neutral with confidence 0.4-0.6
  rhythmSlot: MemorySlot | null,   // latest content_rhythm entry
  industryBaseline: IndustryBaseline | null,
  loadedAt: Date,
}
```

### 9.5 Connection to Signal Lineage

```
The iteration engine does NOT directly read from or write to signal lineage.
Signal lineage (server/shared/signal-lineage.ts) tracks data provenance across engines.
Iteration operates on performance data, not raw signals.

Connection is INDIRECT:
  Signal lineage → affects signalTrustedRatio → affects task composer → affects execution
  Iteration → affects memory → affects prompts → affects engine outputs
  These are parallel influence paths, not connected.
```

### 9.6 Connection to Validation

```
Iteration output connects to validation through:
  1. assessStrategyAcceptability() called at engine.ts:882
     → Uses shared strategy-acceptability module
     → Returns pass/fail on production readiness
  2. CEL enforcement: orchestrator/index.ts runs enforceGenericEngineCompliance()
     after iteration completes → pushed to ctx.celResults
```

### 9.7 Connection to Plan Synthesis

```
Iteration connects to plan synthesis at:
  plan-synthesis.ts:341 → iteration findings available in engine context
  plan-synthesis.ts:1226 → iteration conflicts checked against final plan
  plan-synthesis.ts:1252 → optimization hints attached to plan metadata
```

---

## 10. Full Flow Example (End-to-End)

### Scenario: Campaign Run → Iteration Detects Low CTR → Memory Updated → Next Run Adjusted

#### RUN 1: Initial Orchestrator Execution

```
1. POST /api/orchestrator/run { campaignId: "camp_abc" }
   → orchestrator/routes.ts creates job

2. runOrchestrator(config) starts
   → orchestrator/index.ts:1587

3. Memory loaded (first run, likely empty):
   buildMemoryContext("camp_abc", "acc_xyz")
   → memory-context.ts:137 → loadMemoryBlock()
   → memory-system/manager.ts:119 → returns empty MemoryBlock

4. ctx.memoryContext = "" (no memory yet)
   → orchestrator/index.ts:1651

5. Engines 1-14 execute (MI → Audience → ... → Channel Selection)
   Each receives empty memoryContext

6. Iteration Engine executes (engine #15):
   executeEngine("iteration") → orchestrator/index.ts:1280

   Input:
     performance = { impressions: 50000, clicks: 150, conversions: 2, spend: 500, revenue: 100 }
     funnel = ctx.funnel (from funnel engine)
     memoryContext = ""

   Layer 1 (Performance Analysis):
     CTR = 150/50000 = 0.003 → BELOW CTR_FLOOR (0.005)
     → flags: "creative/targeting issues — CTR 0.3% below 0.5% floor"

     ROAS = 100/500 = 0.2 → BELOW ROAS_FLOOR (0.8)
     → flags: "cost efficiency issues — ROAS 0.2 below 0.8 floor"

   Layer 2 (Funnel): synthesizes from metrics
     Impression→Click = 0.3% → bottleneck flagged

   Layer 3 (Creative): no creative data provided → skipped

   Layer 4 (Guard): no recent test failures → passes

   Output:
     optimizationTargets = [
       { label: "Improve CTR", priority: 0.95, confidence: 0.78 },
       { label: "Improve ROAS", priority: 0.82, confidence: 0.65 },
     ]
     failedStrategyFlags = [
       { strategy: "current_hook_angle", reason: "CTR below floor", confidence: 0.78 },
     ]
     nextTestHypotheses = [
       { hypothesis: "Test new hook angles", confidence: 0.78 },
     ]

7. synthesizePlan() runs (orchestrator/index.ts:1834)
   → plan-synthesis.ts checks iteration conflicts (line 1226)
   → No conflicts in first plan (fresh campaign)
   → Attaches optimizationHints to plan metadata

8. writeStrategyMemoryEntries() runs (orchestrator/index.ts:1473)
   → Extracts top iteration target:
     {
       engineName: "iteration_engine",
       memoryType: "iteration_direction",
       label: "Improve CTR",
       details: "CTR 0.3% below 0.5% floor — test new hook angles",
       confidenceScore: 0.78,
       direction: "reinforce",
     }
   → policyEnforcedMemoryCheck(0.78, "reinforce", "iteration_engine", "iteration_direction")
   → 0.78 >= MEMORY_WRITE_MIN (0.65) → ALLOWED
   → applyMemoryMutation() writes to strategyMemory table

9. Plan stored in strategicPlans table
```

#### RUN 2: Next Orchestrator Execution (with memory)

```
1. runOrchestrator(config) starts

2. Memory loaded:
   buildMemoryContext("camp_abc", "acc_xyz")
   → loadMemoryBlock() returns:
     reinforceSlots = [
       { label: "Improve CTR", direction: "reinforce", confidenceScore: 0.78, engineName: "iteration_engine" }
     ]

3. Memory serialized:
   serializeMemoryContextForPrompt() →
   "[MEMORY SYSTEM — HARD CONSTRAINTS]
   STRATEGY_MEMORY (confidence-weighted constraints):
   REINFORCE (prefer these directions — weight by confidence band):
     [MODERATE guidance 78% effective confidence] [iteration_engine] "Improve CTR": CTR 0.3% below floor
   INSTRUCTION: Apply all REINFORCE and AVOID entries with weight proportional..."

4. ctx.memoryContext = serialized string

5. All engines run WITH this memory in their prompt:
   - Awareness engine: AI sees "REINFORCE Improve CTR" → prioritizes engagement hooks
   - Persuasion engine: AI adjusts messaging emphasis based on CTR improvement directive
   - Channel selection: AI may weight channels with higher CTR potential

6. Iteration engine runs again:
   memoryContext is parsed (engine.ts:784-813):
     "Improve CTR" matches REINFORCE → priority += 0.15
   If CTR has improved since last run → confidence increases
   If CTR still low → new hypothesis generated, old one maintained

7. Memory updated:
   blendedScore = 0.6 * 0.78 + 0.4 * newConfidence
   Memory evolves based on actual results
```

---

## Critical Findings for Control Layer Integration

### What the Agent ALREADY Does (DO NOT DUPLICATE):

1. **Performance monitoring**: Iteration engine detects CTR/ROAS/conversion issues
2. **Memory-based self-correction**: checkResultsOverrideMemory flips avoid→reinforce
3. **Confidence decay**: 30-day half-life neutralizes stale memories
4. **Boundary enforcement**: BOUNDARY_BLOCKED_PATTERNS blocks unsafe content
5. **Prompt influence**: Memory system injects REINFORCE/AVOID into all engines
6. **Adaptive rhythm**: Adjusts content distribution based on performance
7. **Exploration budget**: Allocates testing slots for unproven strategies
8. **Autonomous monitoring**: Worker runs every 5 minutes, checks guardrails

### What the Agent CANNOT Do (CONTROL LAYER SHOULD):

1. **Block execution** — Agent cannot set safeToExecute=false or halt plans
2. **Override budget** — Agent cannot modify scaling decisions mid-run
3. **Force re-runs** — Agent cannot trigger upstream engine re-execution
4. **Cross-validate in real-time** — Agent feedback is next-run only
5. **Reject plans** — Agent can attach warnings but cannot prevent synthesis
6. **Verify operational readiness** — Agent doesn't check infrastructure
7. **Enforce structural completeness** — Agent doesn't validate funnel/channel structure
8. **Aggregate system state** — No single readiness score exists

### Integration Rules:

1. Control Layer operates THROUGH memory system for persistent influence (use `policyEnforcedMemoryCheck`)
2. Control Layer injects constraints BEFORE memory block in prompts (higher priority)
3. Control Layer is THE final execution gate (consumes all other gates)
4. Control Layer REPLACES autonomous worker for monitoring (avoids dual loops)
5. Control Layer decisions use `CONFLICT_PRIORITY` system (add "system_control" at top)
6. Control Layer can do what Agent cannot: block execution, force re-runs, reject plans
