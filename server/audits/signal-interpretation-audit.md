# SIGNAL INTERPRETATION & PROPAGATION AUDIT
**Date**: 2026-04-16  
**Campaign**: campaign_1773576062201_6t0oxi (MarketMindAI)  
**Scope**: How signals are interpreted, transformed into meaning, and propagated  
**Status**: COMPLETE — ROOT CAUSES TRACED

---

## DEFINITIVE ANSWER

**Does the system currently:**  
**A) Interpret signals into meaning and enforce them across engines?**  
**B) Or simply pass signals and let each engine decide independently?**

**Answer: The system is a HYBRID — but the hybrid is broken.**

Each engine individually has strong signal interpretation. Engines DO translate signals into meaning internally. But the system as a whole fails because:

1. **Meaning is constructed locally but not shared globally.** Each engine builds its own understanding of what "product_aware" or "low trust" means, but this understanding is not propagated as structured constraints to other engines.

2. **Signals are passed, but meaning is stripped.** The orchestrator extraction functions (`extractAudienceInput`, `extractOfferInput`, etc.) pass data fields but drop the semantic interpretation that the source engine attached.

3. **Confidence is inherited by some engines but not by others.** The Positioning Engine caps confidence based on upstream quality. The Mechanism Engine does not. There is no system-wide rule.

4. **Execution order creates temporal contradictions.** The Awareness Engine evaluates the Funnel before it exists. This is an architectural design flaw, not a logic flaw.

**Classification: The system is a SCORING SYSTEM with LOCAL REASONING.**

Each engine contains genuine reasoning logic (awareness stage → trust requirements → channel restrictions). But the inter-engine communication layer reduces this reasoning to numbers and labels, losing the constraints that the reasoning derived.

---

## ENGINE-BY-ENGINE SIGNAL INTERPRETATION ANALYSIS

---

### ENGINE 1: MARKET INTELLIGENCE

**Signal → Meaning → Decision Flow:**
```
RAW SIGNAL: Instagram competitor post with CTA "Book a demo"
    ↓ [Interpretation]
MEANING: ctaPattern="demo_request", competitorType="direct", channelPresence="instagram"
    ↓ [Decision]
OUTPUT: Opportunity signal with market_state="ESTABLISHED_COMPETITION"
```

**Interpretation Quality**: STRONG  
MI correctly classifies raw scraping data into structured signal types with source attribution and confidence scoring.

**Constraint Propagation**: NOT APPLICABLE  
MI is a data-gathering layer. It produces signals; it does not consume them.

**Missing Interpretation**: None. MI is the healthiest engine.

---

### ENGINE 2: AUDIENCE

**Signal → Meaning → Decision Flow:**
```
RAW SIGNAL: MI signals showing "pricing page visits" + "demo requests"
    ↓ [Interpretation]
MEANING: awarenessLevel = { level: "product_aware", distribution: {...}, confidenceScore: 0.46 }
         SEMANTIC: "audience is evaluating specific products"
    ↓ [Decision]
OUTPUT: Audience profile with pains, desires, objections, segments, awareness classification
```

**Interpretation Quality**: GOOD — but meaning is attached in the wrong place.

The engine correctly interprets "product_aware" as "audience is evaluating specific products" and injects this interpretation into `psychological_drivers`. However:

- The semantic interpretation ("evaluating specific products") is buried inside the psychological_drivers map
- The primary output (`awarenessLevel.level`) is just a string label: `"product_aware"`
- Downstream engines receive the label, not the derived meaning
- Trust implications, urgency implications, and clarity implications are NOT derived as separate fields

**What the audience engine UNDERSTANDS but does NOT EXPORT:**

| Derived Meaning | Internally Known? | Exported? |
|-----------------|-------------------|-----------|
| Trust level is moderate-to-high | YES (implicit in awareness classification) | NO |
| Urgency is evaluation-driven, not panic-driven | YES | NO |
| Comparison content is appropriate | YES (in psychological_drivers text) | NO |
| Direct conversion may be possible | YES | NO |
| Search intent exists | YES | NO |

**The gap**: The engine builds semantic understanding internally but exports only a label and a score. Downstream engines must independently re-derive the meaning of "product_aware."

---

### ENGINE 3: POSITIONING

**Signal → Meaning → Decision Flow:**
```
RAW SIGNAL: MI threats + Audience pains + Product DNA
    ↓ [Interpretation]
MEANING: Territory = "marketing capability transformation validation gap"
         Narrative = system-level failure language
         Contrast axis = derived from audience trust gaps
    ↓ [Decision]
OUTPUT: Positioning with territories, narrative direction, enemy definition, confidence=0.20
```

**Interpretation Quality**: STRONG internally, but output doesn't carry its own uncertainty.

The engine correctly uses `assessDataReliability` to evaluate input quality and caps confidence when data is weak:
- If `overallReliability < 0.45` → confidence capped at 0.65, score scaled by 0.6
- Orphan claims → -0.05 per orphan
- Generic language → -0.15 penalty

**Confidence Inheritance**: YES — this engine DOES implement confidence inheritance.

**What breaks**: The engine outputs confidence=0.20, which is a clear signal that this positioning is unreliable. But this signal is NOT enforced as a constraint for downstream consumers. The orchestrator passes the positioning output to Differentiation, Mechanism, Offer, and Persuasion without any quality gate.

**CRITICAL FINDING**: Positioning has confidence inheritance FROM upstream, but there is no confidence inheritance TO downstream. The chain breaks here.

```
MI (0.71) → Audience (null) → Positioning (0.20) → Differentiation (0.50) → Mechanism (0.95)
                                   ↑                        ↑                      ↑
                              CORRECTLY LOW          IGNORES UPSTREAM         IGNORES UPSTREAM
```

---

### ENGINE 4: DIFFERENTIATION

**Signal → Meaning → Decision Flow:**
```
RAW SIGNAL: Positioning territories + Audience pains + MI competitive data
    ↓ [Interpretation]  
MEANING: Pillars derived from positioning narrative
         Authority mode selected based on competitive landscape
         Mechanism core proposed
    ↓ [Decision]
OUTPUT: Differentiation pillars, mechanism framing, authority mode, confidence=0.50
```

**Interpretation Quality**: MODERATE

The engine interprets positioning into differentiation pillars and derives authority mode from competitive analysis. It uses CEL depth gates for structural validation.

**Confidence Inheritance**: NO  
The engine does NOT check positioning confidence before operating. It receives positioning output at 0.20 confidence and proceeds to build differentiation pillars on it without degradation.

**What this means**: The differentiation engine treats a 20%-confidence positioning as if it were a 100%-confidence positioning. The output (0.50) appears to be a "reasonable" confidence — but it's built on sand.

---

### ENGINE 5: MECHANISM

**Signal → Meaning → Decision Flow:**
```
RAW SIGNAL: Positioning + Differentiation outputs
    ↓ [Interpretation]
MEANING: Primary axis resolved from differentiation vector
         Axis alignment enforced (emphasis/banned keywords)
         Causal depth validated
    ↓ [Decision]
OUTPUT: Mechanism name, type, axis alignment, confidence=0.95
```

**Interpretation Quality**: STRONG within its own domain

The engine has robust internal reasoning:
- Axis alignment with emphasis/banned keywords
- CEL depth gate (blocks if causal depth < 0.20)
- Structural naming rules (Domain/Action/Identity)

**Confidence Inheritance**: NONE  
The Mechanism Engine produces 0.95 confidence despite being built on positioning at 0.20. This is the most extreme confidence inflation in the system.

**Why this happens**: The engine scores the STRUCTURAL QUALITY of the mechanism (naming, axis alignment, causal depth) independently of the STRATEGIC QUALITY of the positioning it's built on. A mechanism can be structurally perfect and strategically irrelevant.

**This is the core architectural issue**: Each engine scores the quality of ITS OWN WORK, not the quality of THE DECISION CHAIN.

---

### ENGINE 6: OFFER

**Signal → Meaning → Decision Flow:**
```
RAW SIGNAL: All upstream outputs + Audience pains/desires/objections
    ↓ [Interpretation]
MEANING: Pain alignment checked (substring matching against combined offer text)
         Objection coverage calculated
         Mechanism grounding validated
    ↓ [Decision]
OUTPUT: Offer with strength=0.462, warnings about zero pain alignment
```

**Interpretation Quality**: MODERATE — interpretation exists but enforcement is soft.

The engine DOES interpret audience data meaningfully:
- Builds a `MarketLanguageMap` from audience pains, desires, emotional drivers
- Validates claim grounding (strips ungrounded claims)
- Checks pain alignment via substring matching

**Where interpretation breaks**: The matching is naive substring comparison. It checks if a 15-character substring of a pain appears in the offer text. This means:
- Pain: "cost and affordability concerns" → checks if "cost and affordab" appears in offer
- This is a CHARACTER MATCH, not a MEANING MATCH
- An offer addressing the same concern with different words (e.g., "budget-friendly pricing") would fail

**Enforcement**: Pain misalignment produces a -0.25 penalty but NOT a rejection. The offer proceeds at 0.462 strength. At the system level, a strategy with an offer that doesn't address ANY audience pain should not be producible.

---

### ENGINE 7: AWARENESS

**Signal → Meaning → Decision Flow:**
```
RAW SIGNAL: MI + Audience + Positioning + Differentiation + Offer + Funnel
    ↓ [Interpretation]
MEANING: Entry mechanism type derived (proof_led, myth_breaker, etc.)
         Trust readiness guard enforced
         Narrative entry alignment validated
    ↓ [Decision]
OUTPUT: Awareness route with strength=0.9794
```

**Interpretation Quality**: STRONG — this engine genuinely reasons about trust, entry, and readiness.

**Signal interpretation is real**:
- `unaware` + high problem intensity → `myth_breaker_entry`
- Low trust (<0.4) → forces `proof_led_entry`
- Saturated market + high threats → `authority_entry`

**But it evaluates a phantom funnel**: The Awareness Engine runs BEFORE the Funnel Engine. It receives an empty funnel object (`trustPath: []`) and generates the warning "Funnel has no trust path." This warning is a temporal artifact, not a real finding.

**ARCHITECTURAL DESIGN FLAW**: The pipeline order creates a paradox:
```
Awareness runs at step 7 → evaluates Funnel (which runs at step 8) → sees empty funnel → warns
Funnel runs at step 8 → builds trustPathScore=1.0 → but Awareness warning already emitted
```

This is not a logic error — it's an execution order error. The Awareness Engine's funnel evaluation is structurally invalid because it's evaluating data that doesn't exist yet.

---

### ENGINE 8: FUNNEL

**Signal → Meaning → Decision Flow:**
```
RAW SIGNAL: Audience awareness + Offer friction + Positioning + Differentiation
    ↓ [Interpretation]
MEANING: Commitment tolerance derived from awareness stage
         Trust step requirements derived from proof architecture
         Awareness Priority Matrix (5 layers) applied
    ↓ [Decision]
OUTPUT: Funnel type="webinar", trustPathScore=1.0, strength=0.80
```

**Interpretation Quality**: STRONG — this engine has the deepest constraint derivation.

**Meaningful constraint propagation**:
- P1: Awareness route → blocks incompatible funnels
- P2: Trust requirement → blocks "trust-light" funnels if trust is low
- P3: Awareness stage → HARD BLOCK on high-commitment funnels for low-awareness
- P5: Commitment tolerance → blocks funnels exceeding audience readiness

**Trust path contradiction explained**:
- Funnel Engine calculates `trustPathScore` GENERATIVELY (it creates the path, then scores what it created)
- It always produces a path (at least 2-3 steps by default)
- Score = 0.3 + (proofCoverage × 0.4) + (length bonus) + (pillar bonus)
- With full proof coverage + 4+ steps + pillars → 0.3 + 0.4 + 0.2 + 0.1 = 1.0
- This score measures "did I build a good path?" not "does this path solve trust requirements?"

---

### ENGINE 9: PERSUASION

**Signal → Meaning → Decision Flow:**
```
RAW SIGNAL: Audience awareness + Positioning narrative + Differentiation + Offer
    ↓ [Interpretation]
MEANING: Persuasion mode derived from AWARENESS_PERSUASION_MAP
         Trust barriers classified from positioning gaps
         Influence drivers selected from authority mode + entry mechanism
         Blocked tactics enforced (no hard CTA for unaware)
    ↓ [Decision]
OUTPUT: Persuasion route with strength=0.85, 4 positioning drift warnings
```

**Interpretation Quality**: STRONG — this engine builds genuine reasoning from signals.

The persuasion engine does NOT just pass data to AI. It builds a structured "Persuasion Route" through 8 deterministic layers:
- Awareness → Persuasion mode mapping (hardcoded, not AI-decided)
- Trust barrier classification (mechanism disbelief, competitor similarity)
- Influence driver selection (authority, contrast, specificity)
- Tactical blocking (no hard CTA for unaware audiences)

**Where it fails**: The engine correctly detects 4 positioning lock drifts (cosine similarity 0.06-0.17 against locked decisions). But drift is penalized (-0.20), not rejected. The output score (0.85) doesn't reflect the severity of the misalignment.

**The fundamental problem**: The persuasion engine has excellent INTERNAL reasoning but cannot force upstream engines to fix their outputs. It detects that positioning decisions are not reflected in the persuasion output, but it can only warn — it cannot reject.

---

### ENGINE 10: CHANNEL SELECTION

**Signal → Meaning → Decision Flow:**
```
RAW SIGNAL: Awareness stage + Audience + Persuasion mode + Budget
    ↓ [Interpretation]
MEANING: AWARENESS_CHANNEL_MAP lookup → eligible channels
         CHANNEL_ROLE_REGISTRY → role-based constraints
         Awareness stage hard blocks → eliminate incompatible channels
    ↓ [Decision]
OUTPUT: Primary=TikTok Organic, confidence=0.45, 12 channels blocked
```

**Interpretation Quality**: STRONG for its lookup logic, BROKEN for input reception.

The engine has genuine understanding encoded in its lookup tables:
- `CHANNEL_ROLE_REGISTRY` contains semantic reasoning: "google_search is blocked for unaware because audience MUST have existing search intent"
- `AWARENESS_STAGE_ALLOWED_ROLES` encodes the trust journey: unaware=discovery only, product_aware=nurture+conversion

**THE BUG (confirmed)**: The engine receives awareness data from TWO sources:
1. `extractAudienceInput()` — which DROPS the awarenessLevel field entirely
2. `ctx.awareness` — which comes from the Awareness Engine (runs after Audience)

The orchestrator maps awareness input at lines 1209-1210:
```
const awarenessInput = ctx.awareness || {};
```
But `ctx.awareness` contains the Awareness Engine's output format (`primaryRoute.targetReadinessStage`), not the Audience Engine's awareness level (`level: "product_aware"`). If the Awareness Engine's `primaryRoute` is null or its `targetReadinessStage` uses different terminology, the Channel Selection engine falls back to a default.

**What happens in practice**:
```
Audience Engine outputs: { level: "product_aware", distribution: {...} }
    ↓ [extractAudienceInput] DROPS awarenessLevel
Awareness Engine outputs: { primaryRoute: { targetReadinessStage: ??? } }
    ↓ [orchestrator] passes as awarenessInput
Channel Selection receives: targetReadinessStage = possibly null/undefined
    ↓ [safeString fallback]
Channel Selection uses: "problem_aware" (default)
    ↓ [AWARENESS_STAGE_ALLOWED_ROLES]
Blocks 12 channels as if audience is low-readiness
```

**This is not a reasoning failure — it's a data plumbing failure.** The engine's reasoning logic is correct; it's being fed the wrong input.

---

### ENGINE 11: BUDGET GOVERNOR

**Signal → Meaning → Decision Flow:**
```
RAW SIGNAL: Validation confidence + Performance data + Risk factors
    ↓ [Interpretation]
MEANING: Performance override eligible (126 conv, $500 spend, statistically valid)
         Base confidence 50% → reconciled to 89%
    ↓ [Decision]
OUTPUT: Budget action with reconciled confidence, risk mitigations
```

**Interpretation Quality**: MODERATE — strong performance interpretation, zero strategic interpretation.

**Performance Override Deep Dive**:
The override activates when:
- `conversions >= 100` (126 ≥ 100 ✓)
- `spend >= $500` ($500 ≥ $500 ✓)
- `isStatisticallyValid === true` ✓

When activated, the override logic:
```typescript
const reconciledConfidence = Math.max(
  performanceConfidence,          // 0.89 (from campaign stats)
  minReconciledConfidence         // 0.80 (floor)
);
// Base confidence (0.50) is DISCARDED
```

**What the budget governor does NOT check during override**:
| Signal | Checked? | Impact |
|--------|----------|--------|
| Statistical validation result (rejected) | NO | Override proceeds even if strategy is rejected |
| Positioning confidence (0.20) | NO | Override proceeds even with weak positioning |
| Offer pain alignment (zero) | NO | Override proceeds even with misaligned offer |
| Integrity safeToExecute | NO | Override proceeds regardless |

**Why this is dangerous**: The performance override assumes that good conversion numbers validate the strategy. But conversions could come from:
- A different creative than the strategy recommends
- A segment the strategy doesn't target
- A channel the strategy didn't optimize for
- Historical momentum unrelated to current strategy quality

The override conflates "campaign is performing" with "strategy is correct." These are fundamentally different assertions.

---

### ENGINE 12: STATISTICAL VALIDATION

**Signal → Meaning → Decision Flow:**
```
RAW SIGNAL: Claims from Offer, Persuasion, Awareness, Funnel
    ↓ [Interpretation]
MEANING: 8 claims unmapped to signal clusters
         Evidence density insufficient
         Proof types, persuasion drivers, awareness triggers lack signal origin
    ↓ [Decision]
OUTPUT: result="rejected", confidence=0.67
```

**Interpretation Quality**: STRONG — this engine correctly identifies grounding failures.

The engine extracts discrete claims from strategy outputs and attempts to map each claim to a signal cluster. When it finds that proof types ("transparency_proof", "outcome_proof", "process_proof"), persuasion drivers ("education", "diagnosis", "authority"), and awareness triggers ("trust_breakdown", "proof_led_entry") cannot be mapped to any signal cluster, it correctly rejects.

**Where propagation fails**: The rejection is emitted but not enforced. The orchestrator records the result but does not gate subsequent steps on it.

---

### ENGINE 13: INTEGRITY

**Signal → Meaning → Decision Flow:**
```
RAW SIGNAL: All engine outputs
    ↓ [Interpretation]
MEANING: 8-layer validation
         Detects: pain misalignment, objection gap, confidence spread, narrative contradiction
    ↓ [Decision]
OUTPUT: score=0.9475, safeToExecute=true, 4 warnings
```

**Interpretation Quality**: MODERATE — detects problems but scoring masks severity.

**Layer 2 (Audience-Offer Alignment) scoring math**:
```
Base score: 1.0
Pain alignment: no match → -0.15 → score = 0.85
Readiness gap: within tolerance → 0.0 → score = 0.85
Objection coverage: 0/3 → -0.10 → score = 0.75
Layer 2 final: 0.75 (PASSES — threshold is 0.50)
```

**Why safeToExecute=true despite 4 warnings**:
The formula: `boundaryCheck.passed && failedCount <= 2 && overallIntegrityScore >= 0.4 && !hasEnforcementFailure`

- boundaryCheck.passed = true (no prohibited content)
- failedCount: Each layer only "fails" if score < 0.5. With -0.15 and -0.10 penalties, no single layer drops below 0.5
- overallIntegrityScore: Weighted average across 8 layers, each starting at 1.0 with small penalties → lands at 0.9475
- hasEnforcementFailure: Our recent fix added pain alignment as a hard gate, but the live run predates those changes

**The core problem with integrity**: The 8-layer weighted average is STRUCTURALLY INCAPABLE of failing when individual critical checks find problems:
- Pain alignment failure = -0.15 on one layer (weight: 15%) → total impact: -0.0225 on overall score
- Zero objection coverage = -0.10 on one layer (weight: 15%) → total impact: -0.015
- Confidence spread = -0.10 on one layer (weight: 6%) → total impact: -0.006
- Narrative contradiction = -0.10 on one layer (weight: 12%) → total impact: -0.012
- **Total penalty on overall score: -0.0555** (from 1.0 to 0.9445 — nowhere near the 0.40 threshold)

The weighted average dilutes critical failures across 8 layers. A single catastrophic issue (offer doesn't address ANY audience need) becomes a 2.25% dip in the overall score.

---

## CONSTRAINT PROPAGATION MAP

### What IS propagated between engines:

| From | To | What's Passed | Format | Meaning Preserved? |
|------|----|---------------|--------|-------------------|
| MI | Audience | Signals, market state | Structured JSON | YES |
| MI | Positioning | Snapshot + AEL enrichment | Snapshot ID + causal data | YES |
| Audience | Positioning | Snapshot ID | ID reference (engine loads directly) | YES |
| Positioning | Differentiation | Extracted fields | `extractPositioningInput()` | PARTIAL — territories, narrative, but not confidence context |
| Differentiation | Mechanism | Manual mapping | Hand-built `diffForMech` object | PARTIAL — pillars and core, but schema may drift |
| Awareness | Funnel | `awarenessInput` | Structured: stage, entry, trust | YES |
| Funnel | Persuasion | `extractFunnelInput()` | Normalized stages + trustPath | PARTIAL — structure preserved, reasoning lost |

### What is NOT propagated:

| Missing Propagation | Impact |
|---------------------|--------|
| Audience `awarenessLevel` → Channel Selection | Channels blocked for wrong stage |
| Positioning confidence → Downstream engines | Invalid confidence inflation |
| Statistical validation result → Budget Governor | Performance override bypasses rejection |
| Integrity warnings → Any engine | Warnings are terminal; no engine acts on them |
| Awareness funnel evaluation → Funnel Engine | Temporal contradiction (evaluates before creation) |
| Engine-derived trust requirements → Global state | Each engine re-derives trust independently |

---

## CONTRADICTION ORIGIN TRACING

### Contradiction 1: Audience = product_aware → Channels blocked for unaware

**Origin Engine**: ORCHESTRATOR (data plumbing)  
**Logic Break**: DATA PROPAGATION FAILURE  
**Trace**:
```
Step 1: Audience Engine → outputs awarenessLevel.level = "product_aware" ✓
Step 2: extractAudienceInput() → extracts pains, desires, segments → DROPS awarenessLevel ✗
Step 3: Orchestrator → passes ctx.awareness.primaryRoute as awarenessInput
Step 4: Awareness Engine → primaryRoute may be null or use different stage terminology
Step 5: Channel Selection → safeString(awareness.targetReadinessStage, "problem_aware")
Step 6: Channel Selection → uses default "problem_aware" or "unknown"
Step 7: AWARENESS_STAGE_ALLOWED_ROLES blocks 12 channels
```
**Missing**: A single canonical `awarenessStage` field that flows through the entire pipeline unchanged.

---

### Contradiction 2: Positioning = 0.20 → Mechanism = 0.95

**Origin Engine**: MECHANISM ENGINE (and all downstream)  
**Logic Break**: MISSING CONFIDENCE INHERITANCE  
**Trace**:
```
Step 1: Positioning Engine → confidence = 0.20 (correctly low due to weak data) ✓
Step 2: Orchestrator → passes positioning output to Differentiation (no quality gate) ✗
Step 3: Differentiation → builds on positioning, produces confidence = 0.50 ✗
Step 4: Orchestrator → passes differentiation to Mechanism (no quality gate) ✗
Step 5: Mechanism → builds mechanism, scores its OWN structural quality = 0.95 ✗
```
**Missing**: `maxAllowedConfidence = min(upstreamConfidences) + confidenceBuffer`. Each engine scores its OWN work quality, not the CHAIN quality. A perfectly structured mechanism built on unreliable positioning is scored as excellent.

---

### Contradiction 3: Offer not aligned with pains → still accepted

**Origin Engine**: OFFER ENGINE + INTEGRITY ENGINE  
**Logic Break**: SOFT SCORING WHERE HARD REJECTION IS NEEDED  
**Trace**:
```
Step 1: Audience Engine → 4 pains, 5 desires, 3 objections identified ✓
Step 2: Offer Engine → AI generates offer that doesn't reference any pains ✗
Step 3: Offer Engine → validateOfferAlignment detects zero overlap ✓
Step 4: Offer Engine → applies -0.25 penalty (score: 0.462) ← SOFT, NOT HARD
Step 5: Integrity Engine → Layer 2 detects pain misalignment ✓
Step 6: Integrity Engine → applies -0.15 on Layer 2 (score: 0.85) ← SOFT, NOT HARD
Step 7: Integrity Engine → overall = 0.9475, safeToExecute=true ✗
```
**Missing**: A hard gate at the Offer Engine level: `IF painOverlap === 0 AND pains.length > 0 THEN REJECT`. The detection exists; the enforcement does not.

---

### Contradiction 4: Statistical validation = rejected → system proceeds

**Origin Engine**: ORCHESTRATOR  
**Logic Break**: RESULT NOT CONSUMED AS CONSTRAINT  
**Trace**:
```
Step 1: Statistical Validation → 8 unmapped claims, result = "rejected" ✓
Step 2: Orchestrator → stores result in ctx.statisticalValidation ✓
Step 3: Orchestrator → continues to next engine (no gate) ✗
Step 4: Budget Governor → reconcileValidationWithPerformance ← uses base confidence, not result
Step 5: Performance override → elevates confidence from 50% to 89% ✗
Step 6: System → status = "COMPLETED" ✗
```
**Missing**: `IF statisticalValidation.result === "rejected" THEN HALT pipeline`. The System Control Layer now has this block, but it runs at the END. The orchestrator itself does not gate on rejection mid-pipeline.

---

### Contradiction 5: Funnel trust = 1.0 → Awareness says "no trust path"

**Origin Engine**: ORCHESTRATOR (execution order)  
**Logic Break**: TEMPORAL DEPENDENCY VIOLATION  
**Trace**:
```
Step 1: Orchestrator pipeline order: ... → Awareness (step 7) → Funnel (step 8) → ...
Step 2: Awareness Engine runs, receives EMPTY_FUNNEL (Funnel hasn't run yet)
Step 3: Awareness checks funnel.trustPath.length → 0 → warns "no trust path"
Step 4: Funnel Engine runs, builds full trust path → score = 1.0
Step 5: Both results stored — contradictory warnings coexist
```
**Missing**: Either:
- Reorder: Funnel runs BEFORE Awareness (dependency-aware scheduling)
- Or: Awareness Engine skips funnel evaluation if funnel hasn't run yet
- Or: Post-pipeline reconciliation removes stale warnings

---

## THE SYSTEM'S FUNDAMENTAL ARCHITECTURE PROBLEM

### Current Architecture: "Engine-Local Reasoning"

```
┌─────────┐    label    ┌──────────────┐    label    ┌─────────────┐
│ Audience │──────────→  │ Positioning  │──────────→  │ Mechanism   │
│          │             │              │             │             │
│ BUILDS:  │             │ BUILDS:      │             │ BUILDS:     │
│ meaning  │             │ meaning      │             │ meaning     │
│ locally  │             │ locally      │             │ locally     │
│          │             │              │             │             │
│ EXPORTS: │             │ EXPORTS:     │             │ EXPORTS:    │
│ label +  │             │ label +      │             │ label +     │
│ score    │             │ score        │             │ score       │
└─────────┘             └──────────────┘             └─────────────┘
     ↓                        ↓                           ↓
  meaning                  meaning                     meaning
  LOST                     LOST                        LOST
```

Each engine:
1. Receives labels and scores from upstream
2. Independently re-derives meaning from those labels
3. Builds its own understanding of the strategic context
4. Exports labels and scores (not understanding)

### What's Missing: "Shared Strategic Context"

The system lacks a shared understanding layer — a single, evolving document that carries:
1. **Derived constraints** (not just labels): "product_aware means trust is moderate, search intent exists, comparison is appropriate"
2. **Confidence chain**: Each engine's confidence capped by its weakest upstream dependency
3. **Hard gates**: Conditions that must be true for the pipeline to continue
4. **Temporal consistency**: No engine evaluates data that doesn't exist yet

### The Three Missing Layers

**Layer 1: Strategic Context Object**
A shared object that accumulates meaning as it flows through the pipeline:
```
{
  awarenessStage: "product_aware",
  derivedConstraints: {
    trustLevel: "moderate",
    searchIntentExists: true,
    comparisonAppropriate: true,
    directConversionPossible: true,
    educationRequired: false
  },
  confidenceFloor: 0.20,  // minimum of all upstream confidences
  hardGates: {
    painAligned: false,     // BLOCKS downstream
    trustPathExists: true,
    objectionsCovered: false // BLOCKS downstream
  }
}
```

**Layer 2: Confidence Inheritance Protocol**
Every engine:
- Reads the `confidenceFloor` from the shared context
- Cannot produce a confidence higher than `confidenceFloor + 0.20`
- Updates `confidenceFloor` with `min(current floor, own confidence)`

**Layer 3: Mid-Pipeline Gates**
After critical engines, the orchestrator checks:
- After Positioning: if confidence < 0.40, HALT
- After Offer: if painAligned === false, HALT
- After Statistical Validation: if result === "rejected", HALT
- These gates prevent the pipeline from building on broken foundations

---

## WHERE "UNDERSTANDING" IS MISSING

| Gap | Description | Current State | Target State |
|-----|-------------|---------------|--------------|
| Semantic Export | Engines export labels, not derived constraints | `awarenessLevel: "product_aware"` | `awarenessLevel: "product_aware", constraints: { trustLevel: "moderate", ... }` |
| Confidence Chain | Each engine scores its own work quality | Mechanism: 0.95 on positioning: 0.20 | Mechanism capped at 0.40 (upstream + buffer) |
| Mid-Pipeline Gates | Pipeline runs to completion regardless | All 15 engines always run | Pipeline halts when foundations are broken |
| Temporal Ordering | Engines evaluate non-existent data | Awareness evaluates empty funnel | Dependency-aware scheduling or skip rules |
| Shared Understanding | Each engine independently interprets labels | 15 independent interpretations of "product_aware" | One canonical derivation, shared across all |
| Enforcement Escalation | Warnings don't become blocks | 4 critical warnings, safeToExecute=true | Critical warning count > 2 → safeToExecute=false |

---

## CLASSIFICATION OF EACH ENGINE

| Engine | Signal Interpretation | Meaning Construction | Constraint Propagation | Dependency Awareness |
|--------|----------------------|---------------------|----------------------|---------------------|
| MI | Data extraction only | N/A | N/A (source) | N/A |
| Audience | STRONG | GOOD (semantic mapping) | WEAK (exports label only) | N/A (consumes MI only) |
| Positioning | STRONG | STRONG (territory reasoning) | BROKEN (confidence not enforced downstream) | GOOD (caps own confidence) |
| Differentiation | MODERATE | MODERATE | WEAK | NONE (ignores upstream confidence) |
| Mechanism | STRONG (axis alignment) | STRONG (causal depth) | WEAK | NONE (ignores upstream confidence) |
| Offer | MODERATE (substring matching) | MODERATE | WEAK | NONE (ignores upstream confidence) |
| Awareness | STRONG (8-layer reasoning) | STRONG | MODERATE | GOOD (but evaluates phantom funnel) |
| Funnel | STRONG (5-priority matrix) | STRONG | MODERATE | GOOD (validates upstream alignment) |
| Persuasion | STRONG (deterministic routing) | STRONG | WEAK (drift detected, not rejected) | PARTIAL (detects drift, can't enforce) |
| Channel Selection | STRONG (semantic registry) | STRONG | N/A (terminal) | BROKEN (wrong awareness input) |
| Budget Governor | MODERATE | MODERATE | N/A (terminal) | BROKEN (performance overrides quality) |
| Statistical Validation | STRONG | STRONG | BROKEN (rejection not enforced) | GOOD |
| Integrity | MODERATE (detects issues) | WEAK (scoring masks severity) | BROKEN (safeToExecute too permissive) | GOOD (reads all engines) |
| Iteration | MODERATE | MODERATE | N/A (post-execution) | GOOD |
| Retention | MODERATE | MODERATE | N/A (post-execution) | GOOD |

---

## NEXT ARCHITECTURE STEP

The system needs three structural changes, in this order:

### 1. Shared Strategic Context (SSC)
Create a `StrategicContext` object that accumulates through the pipeline. Each engine reads it, derives constraints, and writes back to it. This replaces label-passing with meaning-passing.

### 2. Confidence Inheritance Protocol (CIP)
Enforce: `engine.confidence ≤ min(upstream confidences) + 0.20`. No engine can claim higher confidence than its weakest input justifies.

### 3. Mid-Pipeline Gates (MPG)
Add hard stops after critical engines:
- Post-Positioning: confidence < 0.40 → HALT
- Post-Offer: zero pain alignment → HALT  
- Post-Statistical-Validation: rejected → HALT
- Post-Channel-Selection: zero conversion channels → HALT

These three changes transform the system from a scoring system with local reasoning into a reasoning system with shared understanding.
