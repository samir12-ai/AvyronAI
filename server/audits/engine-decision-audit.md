# FULL ENGINE DECISION LOGIC AUDIT
**Date**: 2026-04-16  
**Campaign**: campaign_1773576062201_6t0oxi (MarketMindAI)  
**Auditor**: System Architect  
**Status**: ROOT CAUSE ANALYSIS COMPLETE

---

## EXECUTIVE SUMMARY

The system is generating **logically inconsistent strategies** because engines operate with independent scoring heuristics rather than shared hard rules. The Control Layer catches some of these at the end, but **the damage is already done** — invalid decisions propagate through the pipeline and compound.

**Core finding**: The system has **no unified Rules Matrix** that prevents invalid strategic combinations at the point of decision. Instead, it relies on:
1. Per-engine confidence scoring (soft)
2. Post-hoc warnings (informational only)
3. End-of-pipeline blocking (too late)

**Live campaign proof**: MarketMindAI produced a strategy where:
- Audience is `product_aware` → Channel Selection blocked 12 channels for `unaware` stage
- Offer doesn't reference any audience pains → Integrity still said `safeToExecute=true`
- Statistical Validation rejected the strategy → System status shows "COMPLETED"
- Persuasion has 4 positioning lock drifts → Score is still 0.85
- Channel Selection has NO nurture and NO conversion channels → System proceeds

---

## ENGINE-BY-ENGINE AUDIT

---

### 1. MARKET INTELLIGENCE ENGINE

**Decision Logic**:
- Inputs: Competitor scraping data (Instagram, TikTok, Website, Blog, Reviews)
- Rules: 8-engine sequential pipeline, purely data-gathering
- Output: Opportunity/threat signals, market state classification

**Constraint Validation**:
| Rule | Enforced? | Gap |
|------|-----------|-----|
| Minimum data sources required | YES (5-source) | None |
| Data freshness check | YES (14-day decay) | None |
| Signal tagging with origin type | YES | None |

**Cross-Engine Awareness**: Produces data, does not consume downstream. No validation gaps here.

**Failure Cases**: None observed. This is a data layer, not a decision layer.

**Rule Gaps**: None. MI is the healthiest engine.

---

### 2. AUDIENCE ENGINE

**Decision Logic**:
- Inputs: MI snapshot, business context
- Rules: Structured signal extraction (pains, desires, objections, awareness level)
- Output: Audience profile with awareness stage classification

**Constraint Validation**:
| Rule | Enforced? | Gap |
|------|-----------|-----|
| Minimum signal count | YES | None |
| Awareness level validation | PARTIAL | See below |
| Objection map completeness | NO | No minimum required |

**Cross-Engine Awareness**: Consumes MI only. Does not validate its own outputs against downstream expectations.

**Failure Cases (LIVE)**:
- Audience says `product_aware` but Channel Selection treated audience as `unaware` and blocked 12 channels
- **ROOT CAUSE**: Audience Engine outputs awareness as a JSON blob with distribution percentages, but Channel Selection reads a different field or defaults

**Rule Gaps**:
- `MISSING RULE`: Awareness level output MUST be a simple string enum, not a distribution object — downstream engines cannot reliably parse it
- `MISSING RULE`: If objectionCount > 0, at minimum 1 objection handling strategy must be required from Offer Engine

---

### 3. POSITIONING ENGINE

**Decision Logic**:
- Inputs: MI + Audience snapshots, Product DNA
- Rules: 12-layer pipeline, territory selection, narrative direction
- Hard constraints: Specificity gate (must contain system noun + failure verb), audience-level territory rejection

**Constraint Validation**:
| Rule | Enforced? | Gap |
|------|-----------|-----|
| Territory specificity | YES | None |
| System-level language | YES | None |
| Orphan claim detection | YES | None |
| Minimum confidence for downstream use | **NO** | **CRITICAL GAP** |

**Cross-Engine Awareness**: Validates MI data freshness. Does NOT enforce minimum output quality for downstream consumption.

**Failure Cases (LIVE)**:
- Positioning confidence = **0.20** (critically low)
- Despite this, ALL downstream engines consumed and built on this positioning
- Differentiation used it, Mechanism used it, Offer used it, Persuasion used it
- Result: Entire strategic chain built on a foundation with 20% confidence

**Rule Gaps**:
- `MISSING HARD RULE`: **IF positioning confidence < 0.40 THEN downstream engines MUST NOT consume this output** — currently there is no minimum quality gate on positioning output
- `MISSING HARD RULE`: IF positioning territory has opportunityScore < 0.50 THEN territory MUST be rejected and re-selected

---

### 4. DIFFERENTIATION ENGINE

**Decision Logic**:
- Inputs: MI + Audience + Positioning snapshots
- Rules: Pillar generation, mechanism framing, authority mode selection
- Hard constraints: Mechanism core must be grounded in positioning

**Constraint Validation**:
| Rule | Enforced? | Gap |
|------|-----------|-----|
| Pillar uniqueness | PARTIAL (compression layer) | None |
| Mechanism grounding | YES (CEL) | None |
| Upstream quality gate | **NO** | Accepts positioning at any confidence |

**Cross-Engine Awareness**: Consumes positioning without quality check.

**Failure Cases (LIVE)**:
- Built differentiation pillars on positioning with 20% confidence
- Integrity detected: "Enemy narrative language appears in differentiation mechanism — potential narrative contradiction"
- System proceeded anyway

**Rule Gaps**:
- `MISSING HARD RULE`: IF upstream positioning confidence < 0.40 THEN differentiation engine MUST return BLOCKED status
- `MISSING HARD RULE`: IF enemy definition contradicts mechanism framing THEN hard reject (currently warning only)

---

### 5. MECHANISM ENGINE

**Decision Logic**:
- Inputs: Positioning + Differentiation outputs
- Rules: Axis alignment (emphasis/banned keywords), naming convention (Domain/Action/Identity), CEL depth gate
- Hard constraints: Axis mismatch → AXIS_REJECTED, depth gate → BLOCKED

**Constraint Validation**:
| Rule | Enforced? | Gap |
|------|-----------|-----|
| Axis alignment | YES | None |
| CEL depth gate | YES | None |
| Naming convention | YES | None |
| Upstream quality gate | **NO** | Accepts low-confidence positioning |

**Cross-Engine Awareness**: Strong within its layer. Weak at input quality validation.

**Failure Cases (LIVE)**:
- Mechanism confidence = 0.95 (high), but built on positioning at 0.20
- The mechanism itself is structurally sound but **strategically irrelevant** because its foundation is weak
- No engine detected this contradiction

**Rule Gaps**:
- `MISSING HARD RULE`: Mechanism confidence MUST be capped at MAX(upstream positioning confidence + 0.20, 0.60) — a mechanism cannot be more confident than the positioning it's built on

---

### 6. OFFER ENGINE

**Decision Logic**:
- Inputs: All upstream snapshots (MI, Audience, Positioning, Differentiation, Mechanism)
- Rules: 8-dimension depth scoring, generic detection, integrity check, friction penalty
- Hard constraints: Axis mismatch → AXIS_MISMATCH, boundary violations → reject

**Constraint Validation**:
| Rule | Enforced? | Gap |
|------|-----------|-----|
| Pain alignment check | YES (validateOfferAlignment) | Detection works, **enforcement is soft** |
| Objection coverage | PARTIAL (score contribution only) | No hard requirement |
| Mechanism lock | YES | None |
| Generic detection | YES (-0.35 penalty) | None |

**Failure Cases (LIVE)**:
- **Offer doesn't reference ANY of 4 audience pains or 5 desire signals**
- Two warnings fired: "Outcome statement does not reflect any identified audience pain signals or desires" and "audience_pain_alignment" failure
- Despite this, offer still produced with strength score 0.462
- Offer name literally starts with "Simplicity and Ease:" — a positioning axis label, not a customer-facing offer name
- **No hard block occurred**

**Rule Gaps**:
- `MISSING HARD RULE`: **IF offer outcome references ZERO audience pains AND ZERO audience desires THEN status = REJECTED** (not scored, REJECTED)
- `MISSING HARD RULE`: IF offer name contains a positioning axis label verbatim THEN name MUST be regenerated
- `MISSING HARD RULE`: IF objectionCount > 0 AND objectionHandling.length === 0 THEN offer MUST include at least 1 objection response
- Currently: Pain misalignment = -0.25 penalty. Should be: Pain misalignment = HARD REJECT

---

### 7. AWARENESS ENGINE

**Decision Logic**:
- Inputs: MI, Audience, Positioning, Differentiation, Offer, Funnel
- Rules: 8-layer pipeline (market entry detection, readiness mapping, trigger mapping, etc.)
- Hard constraints: Signal sufficiency gate, boundary enforcement, CEL depth gate

**Constraint Validation**:
| Rule | Enforced? | Gap |
|------|-----------|-----|
| Signal sufficiency | YES | None |
| Entry mechanism compatibility | YES (Layer 4) | None |
| Trust readiness guard | YES (Layer 6) | None |
| Awareness-funnel fit | YES (Layer 5) | See below |

**Cross-Engine Awareness**: Good — validates funnel compatibility.

**Failure Cases (LIVE)**:
- Awareness engine scored 0.9794 (excellent)
- But warning: "Funnel has no trust path" — if trust is required, awareness can't compensate alone
- Despite this, no adjustment to downstream funnel expectations

**Rule Gaps**:
- `MISSING HARD RULE`: IF awareness engine detects trust requirement AND funnel lacks trust path THEN funnel MUST be re-evaluated (currently just a warning)

---

### 8. FUNNEL ENGINE

**Decision Logic**:
- Inputs: Audience, Offer, Positioning, Differentiation, MI, Awareness context
- Rules: 8-layer pipeline with Awareness Priority Matrix (P1-P5), blocked funnel list for unaware audiences
- Hard constraints: AWARENESS_BLOCKED_FUNNELS (direct, tripwire, application blocked for unaware), commitment mismatch detection

**Constraint Validation**:
| Rule | Enforced? | Gap |
|------|-----------|-----|
| Awareness-blocked funnels | YES | None |
| Commitment tolerance | YES (P5) | None |
| Trust step requirement | YES (integrity guard) | None |
| Cross-engine alignment | YES (CEL depth) | None |

**Cross-Engine Awareness**: Strong — validates against awareness stage, offer friction, commitment level.

**Failure Cases (LIVE)**:
- Funnel type = "webinar" with strength 0.80 — reasonable
- Trust path score = 1.0 — strong
- But awareness warning said "Funnel has no trust path" — **contradiction between funnel and awareness assessment**
- Funnel engine says trust is fine; awareness engine says trust is missing

**Rule Gaps**:
- `MISSING HARD RULE`: Funnel trust path assessment and awareness trust assessment MUST agree — if they disagree, the more conservative (lower trust) MUST win

---

### 9. PERSUASION ENGINE

**Decision Logic**:
- Inputs: Audience, Positioning, Differentiation, Offer, Funnel, Awareness
- Rules: 8-layer pipeline, readiness multiplier, mode compatibility, objection-proof linking
- Hard constraints: Scarcity blocked if unresolved objections, boundary enforcement

**Constraint Validation**:
| Rule | Enforced? | Gap |
|------|-----------|-----|
| Positioning lock drift detection | YES (cosine similarity) | **Detection only, no hard block** |
| Objection-proof linking | YES | Only penalty, no block |
| Funnel compatibility | YES | None |
| Readiness alignment | YES | None |

**Failure Cases (LIVE)**:
- **4 POSITIONING LOCK DRIFT violations** detected (scores: 0.10, 0.06, 0.17, 0.08 — all below 0.20 threshold)
- **GENERIC DRIFT WARNING**: Only 9/34 positioning anchors referenced
- Despite all this: persuasion strength score = **0.8484**
- The score penalty (-0.20 from our recent fix) was applied, but the base score was inflated because layer weights don't penalize drift enough

**Rule Gaps**:
- `MISSING HARD RULE`: **IF positioning lock drift count >= 3 THEN status = INTEGRITY_FAILED** (not a score penalty, a HARD REJECT)
- `MISSING HARD RULE`: IF generic drift warning fires (>60% anchors missing) THEN persuasion MUST be regenerated, not scored
- Currently: drift = -0.20 penalty. Should be: drift at this level = REJECT

---

### 10. CHANNEL SELECTION ENGINE

**Decision Logic**:
- Inputs: Audience, Awareness, Persuasion, Offer, Budget, Validation
- Rules: Weighted scoring (9 layers), awareness stage hard blocks via CHANNEL_ROLE_REGISTRY, funnel reconstruction
- Hard constraints: Budget kill flag, awareness blocking, decision gate downgrade

**Constraint Validation**:
| Rule | Enforced? | Gap |
|------|-----------|-----|
| Awareness stage blocking | YES | **Uses wrong awareness value** |
| Funnel completeness | PARTIAL (reconstruction attempts) | See below |
| Persuasion compatibility | YES (threshold) | None |

**Failure Cases (LIVE — CRITICAL)**:
- Audience engine output: `product_aware`
- Channel Selection behavior: Blocked 12 channels for `unaware` stage
- **ROOT CAUSE**: Channel Selection is reading a DIFFERENT awareness field or defaulting to a more conservative value. The audience says `product_aware` but channels are being blocked as if `unaware`
- Result: NO nurture channels, NO conversion channels
- Funnel reconstruction rescued 4 channels but only for awareness — **complete strategic breakdown**
- Confidence = 0.45 (below the 0.50 minimum we just enforced)

**Rule Gaps**:
- `CRITICAL BUG`: Channel Selection awareness stage input MUST read the canonical awareness level from Audience Engine, not derive its own — current behavior creates contradictions
- `MISSING HARD RULE`: **IF no conversion channel exists after reconstruction THEN status = BLOCKED** (currently just a warning)
- `MISSING HARD RULE`: IF no nurture channel exists THEN strategy MUST include at least 1 email/content channel injection

---

### 11. BUDGET GOVERNOR

**Decision Logic**:
- Inputs: Validation confidence, offer strength, funnel strength, risk factors, performance data
- Rules: Hierarchical decision (HALT → HOLD → TEST → SCALE), guard constraints, signal composition enforcement
- Hard constraints: HALT if offer < 0.2 or confidence < 0.15 or risk > 0.9

**Constraint Validation**:
| Rule | Enforced? | Gap |
|------|-----------|-----|
| Kill conditions | YES | None |
| Performance override | **DANGEROUS** | See below |
| Signal composition | YES | None |

**Failure Cases (LIVE)**:
- Base validation confidence = 50% → reconciled to 89% via **PERFORMANCE OVERRIDE**
- 126 conversions + $500 spend → "statistically valid" → confidence elevated from 50% to 89%
- **ROOT CAUSE**: Performance override BYPASSES upstream engine quality signals. Even if positioning is at 20%, offer is misaligned, and statistical validation rejects the strategy — budget governor sees good conversion numbers and says "proceed"

**Rule Gaps**:
- `CRITICAL RULE GAP`: **Performance override MUST NOT elevate confidence above upstream minimum**. If statistical validation = rejected, performance data cannot override that rejection
- `MISSING HARD RULE`: IF statistical_validation.result = "rejected" THEN budget governor MUST enforce HOLD at minimum, regardless of performance data
- `MISSING HARD RULE`: IF positioning confidence < 0.40 THEN budget governor cannot approve SCALE, regardless of performance

---

### 12. STATISTICAL VALIDATION ENGINE

**Decision Logic**:
- Inputs: Claims extracted from Offer, Persuasion, Awareness, Funnel
- Rules: 7-layer weighted scoring, signal-claim mapping, grounding threshold (75%)
- Hard constraints: Boundary violation → reject, grounding < 75% → provisional/rejected

**Constraint Validation**:
| Rule | Enforced? | Gap |
|------|-----------|-----|
| Signal grounding threshold | YES | None |
| Boundary enforcement | YES | None |
| Confidence calibration | YES | None |

**Failure Cases (LIVE)**:
- Result: **REJECTED** (reported in system summary)
- 8 unmapped signals detected (proof types, persuasion drivers, awareness triggers)
- Confidence: 0.67
- **Despite rejection, system status = "COMPLETED" and no block occurred**

**Rule Gaps**:
- `CRITICAL GAP`: Statistical validation rejection MUST propagate as a hard system block. Our recent enforcement fix adds this at the Control Layer, but it didn't fire because no Control Layer verdict was stored for this run (the orchestrator ran before our fixes)
- The engine itself is sound — the gap is in how its result is consumed

---

### 13. INTEGRITY ENGINE

**Decision Logic**:
- Inputs: All engine outputs (MI, Audience, Positioning, Differentiation, Offer, Funnel)
- Rules: 8-layer validation (strategic consistency, audience-offer alignment, positioning compatibility, trust path, proof sufficiency, conversion feasibility, system coherence)
- Hard constraints: Boundary check, failed layer limit (<=2), minimum score (>=0.4)

**Constraint Validation**:
| Rule | Enforced? | Gap |
|------|-----------|-----|
| Audience-offer alignment | YES (Layer 2) | **Detects but doesn't block** |
| Proof sufficiency | YES (Layer 6) | **Detects but doesn't block** |
| Confidence spread detection | YES (Layer 8) | Warning only |
| safeToExecute gate | **FLAWED** | See below |

**Failure Cases (LIVE — CRITICAL)**:
- Integrity detected ALL the problems:
  - "Offer outcome does not reference audience pain language — potential misalignment"
  - "Only 0 of 3 audience objections are addressed in the funnel path"
  - "Enemy narrative language appears in differentiation mechanism"
  - "Large confidence spread: min=0.20, max=0.90"
- **Despite all 4 warnings, safeToExecute = TRUE and score = 0.9475**
- The integrity engine SEES the contradictions but does not ACT on them

**Rule Gaps**:
- `CRITICAL RULE GAP`: **safeToExecute MUST be FALSE if ANY of these conditions exist**:
  - Offer references zero audience pains
  - Zero objections addressed in funnel
  - Confidence spread > 0.50 between engines
  - Positioning confidence < 0.40
- Currently: These are warnings that don't affect the boolean gate. Our recent fix added some of these, but the thresholds are too loose for the integrity engine's own layer scores

---

### 14. ITERATION ENGINE

**Decision Logic**:
- Inputs: Performance metrics, funnel data, creative performance
- Rules: Metric floors (CTR 0.5%, ROAS 0.8, CVR 1.0%), data volume thresholds, iteration guard (max 3 concurrent tests)

**Constraint Validation**: Sound — operates on performance data with clear floors.

**Failure Cases (LIVE)**:
- "No data-driven hypotheses generated — baseline exploration hypotheses injected"
- "Insufficient funnel granularity"
- These are appropriate given the data state

**Rule Gaps**: None critical. This engine correctly degrades when data is insufficient.

---

### 15. RETENTION ENGINE

**Decision Logic**:
- Inputs: Customer journey data, offer structure, qualitative data
- Rules: AI-generated retention loops validated by guard layer

**Constraint Validation**: Sound — guard layer validates AI outputs.

**Failure Cases**: None observed. Produced 3 loops, 3 churn risks.

**Rule Gaps**: None critical.

---

## CROSS-ENGINE CONTRADICTIONS FOUND IN LIVE RUN

| # | Engine A | Says | Engine B | Says | Contradiction |
|---|----------|------|----------|------|---------------|
| 1 | Audience | `product_aware` | Channel Selection | Blocks for `unaware` | **Awareness stage not propagated correctly** |
| 2 | Positioning | confidence 0.20 | Mechanism | confidence 0.95 | **Downstream more confident than upstream** |
| 3 | Offer | Zero pain alignment | Integrity | safeToExecute=true | **Integrity sees problem but doesn't act** |
| 4 | Statistical Validation | REJECTED | System Status | COMPLETED | **Rejection not enforced as block** |
| 5 | Persuasion | 4 positioning drifts | Persuasion score | 0.85 | **Score doesn't reflect severity** |
| 6 | Funnel | trustPathScore=1.0 | Awareness | "No trust path" | **Contradictory trust assessments** |
| 7 | Audience | 3 objections | Offer/Funnel | 0 addressed | **Zero objection coverage allowed** |
| 8 | Budget Governor | confidence 89% | Base confidence | 50% | **Performance override bypasses quality** |

---

## REQUIRED RULES MATRIX

### Awareness x Funnel Rules (HARD)

| Awareness Stage | Allowed Funnels | Blocked Funnels | Currently Enforced? |
|-----------------|-----------------|-----------------|---------------------|
| unaware | content_education, quiz, diagnostic | direct, tripwire, application, product-launch | YES |
| problem_aware | webinar, challenge, quiz, diagnostic | direct, tripwire | PARTIAL |
| solution_aware | webinar, challenge, consult | application (without trust steps) | NO |
| product_aware | ALL except product-launch (without proof) | None hard-blocked | YES |
| most_aware | ALL | None | YES |

### Offer x Audience Rules (HARD — MISSING)

| Condition | Required Action | Currently Enforced? |
|-----------|----------------|---------------------|
| offer references 0 audience pains | REJECT offer | NO (penalty only) |
| offer references 0 audience desires | REJECT offer | NO (penalty only) |
| audience has objections AND offer has 0 objection handling | REJECT offer | NO (recently added as Control Layer block, not at offer engine level) |
| offer name contains positioning axis label | REGENERATE name | NO |

### Positioning x Downstream Rules (HARD — MISSING)

| Condition | Required Action | Currently Enforced? |
|-----------|----------------|---------------------|
| positioning confidence < 0.40 | BLOCK all downstream engines | NO |
| positioning confidence < 0.30 | HALT pipeline | NO |
| downstream confidence > positioning confidence + 0.20 | CAP downstream confidence | NO |

### Persuasion x Positioning Rules (HARD — MISSING)

| Condition | Required Action | Currently Enforced? |
|-----------|----------------|---------------------|
| positioning lock drift count >= 3 | REJECT persuasion output | NO (penalty only) |
| generic drift > 60% anchors missing | REGENERATE persuasion | NO (penalty only) |
| positioning lock alignment < 0.15 on any decision | BLOCK persuasion | NO |

### Channel x Funnel Rules (HARD — PARTIALLY MISSING)

| Condition | Required Action | Currently Enforced? |
|-----------|----------------|---------------------|
| 0 conversion channels after reconstruction | BLOCK strategy | NO (warning only) |
| 0 nurture channels | INJECT email/content channel | NO (warning only) |
| channel confidence < 0.50 | BLOCK strategy | YES (recently added) |

### Budget x Validation Rules (HARD — MISSING)

| Condition | Required Action | Currently Enforced? |
|-----------|----------------|---------------------|
| statistical_validation = rejected | Budget MUST NOT approve scale | NO (performance override can bypass) |
| positioning confidence < 0.40 | Budget MUST NOT approve scale | NO |
| integrity safeToExecute = false | Budget MUST enforce HOLD minimum | NO |

### Integrity Gate Rules (HARD — PARTIALLY MISSING)

| Condition | Required Action | Currently Enforced? |
|-----------|----------------|---------------------|
| offer references 0 audience pains | safeToExecute = false | PARTIAL (recently added, threshold-based) |
| 0 objections addressed in funnel | safeToExecute = false | PARTIAL (recently added) |
| confidence spread > 0.50 | safeToExecute = false | NO |
| positioning confidence < 0.40 | safeToExecute = false | NO |

---

## ROOT CAUSES (ORDERED BY SEVERITY)

### RC-1: No Upstream Quality Gate (CRITICAL)
Engines consume upstream outputs at ANY confidence level. A positioning engine at 0.20 confidence feeds into Differentiation → Mechanism → Offer → Persuasion, each building on a weak foundation. There is no "minimum viable input quality" check.

### RC-2: Awareness Stage Propagation Bug (CRITICAL)  
**CONFIRMED BUG**: `extractAudienceInput()` in `server/orchestrator/index.ts` (lines 322-332) does NOT extract the `awarenessLevel` field from the Audience Engine output. It extracts painProfiles, desireMap, objectionMap, transformationMap, emotionalDrivers, and segments — but **completely drops awarenessLevel**. Channel Selection then falls back to `"problem_aware"` or `"unknown"` via its default: `safeString(awareness.targetReadinessStage, "problem_aware")`. This causes a `product_aware` audience to be treated as `unaware/problem_aware`, blocking 12 of 16 channels. Fix: Add `awarenessLevel` extraction to `extractAudienceInput()` and map it to Channel Selection's `targetReadinessStage`.

### RC-3: Performance Override Bypasses Quality Signals (HIGH)
Budget Governor's performance override elevates confidence from 50% to 89% based on conversion count alone, ignoring that statistical validation rejected the strategy and positioning is at 20%. Performance data should inform, not override, strategic quality.

### RC-4: Integrity Engine Sees But Doesn't Act (HIGH)
Integrity detects pain misalignment, zero objection coverage, confidence spread, and narrative contradictions — but `safeToExecute` remains true. **ROOT CAUSE**: The `safeToExecute` formula is: `boundaryCheck.passed && failedCount <= 2 && overallIntegrityScore >= 0.4 && !hasEnforcementFailure`. The threshold is **0.4** (permissive by design). Individual warnings only apply -0.1 penalties per layer, so 4 warnings across 4 layers = 4 × -0.1 = still well above 0.4 when starting from 1.0. The `hasEnforcementFailure` flag has escape hatches — pain alignment only fails if score < 0.3, and objection coverage uses a slice-of-5 calculation. The system is designed to "fail-soft" with up to 2 failed layers, but in practice this means critical strategic misalignments pass through unblocked.

### RC-5: Penalties Instead of Rejections (HIGH)
The system applies score penalties where it should apply hard rejections. An offer that references zero audience pains gets -0.25 (still producible at 0.462). Persuasion with 4 positioning drifts gets -0.20 (still 0.85). These are not "slightly bad" outputs — they are fundamentally invalid.

### RC-6: Statistical Validation Rejection Not Enforced (MEDIUM)
Statistical validation rejects the strategy but the orchestrator status is "COMPLETED." Our recent Control Layer enforcement fix addresses this, but it only fires when the Control Layer runs — the orchestrator must invoke it.

---

## SUGGESTED HARD RULES (NOT SCORING)

### Rule 1: Upstream Quality Gate
```
FOR EACH engine IN pipeline:
  IF ANY upstream dependency has confidence < 0.40:
    BLOCK this engine
    SET status = "UPSTREAM_QUALITY_INSUFFICIENT"
    LOG which upstream engine failed
```

### Rule 2: Offer Pain Alignment Gate
```
IF offer.painAlignment === 0 AND audience.painCount > 0:
  REJECT offer
  SET status = "PAIN_ALIGNMENT_FAILED"
  DO NOT produce offer candidate
```

### Rule 3: Positioning Lock Enforcement
```
IF persuasion.positioningDriftCount >= 3:
  REJECT persuasion
  SET status = "POSITIONING_DRIFT_CRITICAL"
IF persuasion.genericDrift > 0.60:
  REGENERATE persuasion
```

### Rule 4: Performance Override Guard
```
IF budget_governor.performanceOverride === true:
  IF statistical_validation.result === "rejected":
    CANCEL override
    ENFORCE original confidence
  IF positioning.confidence < 0.40:
    CAP override confidence at 0.60
```

### Rule 5: Channel Funnel Completeness
```
IF channel_selection.conversionChannels.length === 0:
  BLOCK strategy
IF channel_selection.nurtureChannels.length === 0:
  INJECT fallback nurture channel (email)
```

### Rule 6: Confidence Inheritance Cap
```
FOR EACH engine IN pipeline:
  maxAllowedConfidence = MIN(upstream confidences) + 0.20
  IF engine.confidence > maxAllowedConfidence:
    engine.confidence = maxAllowedConfidence
    LOG "CONFIDENCE_CAPPED: {engine} from {original} to {capped}"
```

### Rule 7: Integrity Hard Gates
```
IF integrity detects:
  - offer pain alignment = 0: safeToExecute = false
  - objection coverage = 0: safeToExecute = false  
  - confidence spread > 0.50: safeToExecute = false
  - positioning confidence < 0.40: safeToExecute = false
THEN safeToExecute = false (hard, not score-based)
```

---

## FILES REFERENCED

| Engine | Primary File | Constants |
|--------|-------------|-----------|
| Market Intelligence | server/mi-engine/engine.ts | server/mi-engine/constants.ts |
| Audience | server/audience-engine/engine.ts | server/audience-engine/constants.ts |
| Positioning | server/positioning-engine/engine.ts | server/positioning-engine/constants.ts |
| Differentiation | server/differentiation-engine/engine.ts | server/differentiation-engine/constants.ts |
| Mechanism | server/mechanism-engine/engine.ts | server/mechanism-engine/constants.ts |
| Offer | server/offer-engine/engine.ts | server/offer-engine/constants.ts |
| Awareness | server/awareness-engine/engine.ts | server/awareness-engine/constants.ts |
| Funnel | server/funnel-engine/engine.ts | server/funnel-engine/constants.ts |
| Persuasion | server/persuasion-engine/engine.ts | server/persuasion-engine/constants.ts |
| Channel Selection | server/strategy/channel-selection/engine.ts | server/strategy/channel-selection/constants.ts |
| Budget Governor | server/strategy/budget-governor/engine.ts | server/strategy/budget-governor/constants.ts |
| Statistical Validation | server/strategy/statistical-validation/engine.ts | server/strategy/statistical-validation/constants.ts |
| Iteration | server/strategy/iteration-engine/engine.ts | server/strategy/iteration-engine/constants.ts |
| Retention | server/strategy/retention-engine/engine.ts | server/strategy/retention-engine/constants.ts |
| Integrity | server/integrity-engine/engine.ts | server/integrity-engine/constants.ts |
| System Control | server/system-control/engine.ts | server/system-control/constants.ts |
