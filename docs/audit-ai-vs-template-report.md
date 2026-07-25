# Avyron AI — Full Audit Report
## AI Reasoning vs. Template Text & Embedded Doctrine

**Date:** 2026-07-07  
**Scope:** Read-only audit — no code was modified.  
**Method:** Direct source-file reads with exact line references. Every quoted prompt is verbatim from the file at the line cited.

---

## PART 1 — Template vs. Real AI Map

### 1.1 Template / Fallback Inventory (Complete)

---

#### 1. Narrative Layer — `server/narrative-layer.ts`

**Fallback path (L375):** Three modes are tracked as `narrativeMode`:
```
"template" | "llm_v2" | "llm_v2_failed_template_fallback"
```

**Primary or fallback?**  
- `"template"` is **PRIMARY** when: fewer than 3 engines completed (`completed.length < 3`, L388), OR `problemSource === "none"` OR `positionSource === "none"` (L388), OR the v2 LLM gate is explicitly disabled via env var (`EXPO_PUBLIC_NARRATIVE_LLM_V2 ∈ {0,false,off,no}`, L383–386).  
- `"llm_v2"` fires when the gate is on, there is enough evidence, and the LLM passes the grounding gate.  
- `"llm_v2_failed_template_fallback"` fires when the LLM call throws (L519) or the grounding gate rejects the output (L515).

**What the template is:** 5 deterministic steps assembled from engine outputs (territory name, mechanism name, offer, AEL root cause, etc.) using `humanize()`. If the LLM path fires, it rewrites these same steps — it does NOT produce new content from scratch.

**Trigger for fallback:** Grounding rejection → `console.warn("[Narrative] LLM_V2_GROUNDING_REJECTED | ...")` (L515). Call failure → `console.warn("[Narrative] LLM_V2_CALL_FAILED | ...")` (L519). ✅ **Logged.**

**When template fires silently:** The `"template"` primary path (insufficient engines) has no warning log. If 0–2 engines complete, the user sees template output with no indication. ❌ **Silent.**

---

#### 2. Audience Engine — Segment Construction — `server/audience-engine/engine.ts`

**Trigger for fallback:** The prompt call is wrapped in a `try/catch`. If the LLM call throws or `JSON.parse` fails (L1238), the surrounding function propagates the error upward. The calling context logs `console.error("[AudienceEngine-V3] ...")` (L1288). ✅ **Logged.**

**Fallback content:** The engine returns a minimal placeholder segment array. The fallback hardcodes `sourceSignals: ["fallback"]` on the returned object.

---

#### 3. Audience Engine — Ads Targeting — `server/audience-engine/engine.ts` L1383–1396

**Primary or fallback?** **FALLBACK** — always LLM primary.

**Trigger:** Any exception inside the `try` block (LLM failure, parse error). The `catch` block at L1383 fires.

**Fallback content (verbatim, L1385–1395):**
```typescript
return [{
  suggestedInterests: [businessContext.industry],
  suggestedBehaviors: ["Engaged shoppers"],
  suggestedAgeRange: { min: 18, max: 55 },
  suggestedGender: "all",
  suggestedLocations: [businessContext.location || "United States"],
  rationale: "Fallback targeting based on business context",
  confidenceScore: 0.2,
  sourceSignals: ["fallback"],
}];
```

**Logged?** `console.error("[AudienceEngine-V3] Ads targeting failed:", err.message)` at L1384. ✅ **Logged.**

---

#### 4. Positioning Engine — Claim Fields — `server/positioning-engine/engine.ts`

**Primary or fallback?** When `hasSignals=true` (L1735), the REFINER prompt runs; when `hasSignals=false` (L1770), the ANALYST prompt runs. Both are LLM paths.

**Grounding fallback (L1839–1843):** After the LLM responds, each of 3 claim fields (`enemyDefinition`, `contrastAxis`, `narrativeDirection`) is validated against the signal seeds. Fields that fail validation fall back to the pre-computed signal seed string. `fallbackFields = 3 - groundedFields` and a stability note is appended.

**Logged?** `console.log("[PositioningEngine-V3] GROUNDING_FALLBACK | territory='...' | fallbacks=N/3")` (L1843). ✅ **Logged.**

**Territory-level fallback (L1986–2080):** If no territory passes the stability guard, `fallbackApplied = true` (L2077) and the best available territory is used with a warning note appended.  
**Logged?** Logged in the stability summary `console.log` at L2508. ✅ **Logged.**

---

#### 5. Offer Engine — Refinement — `server/offer-engine/engine.ts` L1819–1883

**Primary or fallback?** LLM primary. The LLM receives pre-built skeletons and refines them. If the LLM call throws, `console.log("[OfferEngine-V4] ...")` fires and the pre-built skeletons are returned unrefined. ✅ **Logged.**

---

#### 6. Offer Engine — Generation — `server/offer-engine/engine.ts` L2007–2056

**Primary or fallback?** This is the **generation** path (when no skeletons exist yet). If generation fails, `console.error` fires and the engine returns a red-grade adaptive fallback (L2276). ✅ **Logged.**

**Insufficient differentiation fallback (L2276):**  
```
"[OfferEngine-V4] Insufficient differentiation data — returning red-grade adaptive fallback"
```

---

#### 7. Analytical Enrichment Layer (AEL v2) — `server/analytical-enrichment-layer/engine.ts`

**Primary or fallback?** LLM primary. Fallback at L144–152 fires when both `mi` and `audience` inputs are null/missing.

**Fallback content (L150–152):**
```typescript
{
  partialReason: notePartialReason("EMPTY_ANALYTICAL_PACKAGE"),
  partialDetail: "no MI or Audience input available",
}
```
**Logged?** `console.log("[AEL] ...")` at L139. ✅ **Logged.**

---

#### 8. Awareness-Depth Interpreter — `server/commercial-reasoning/awareness-depth-interpreter.ts`

**Primary or fallback?** LLM primary with a deterministic floor. When `reasoner_self_assessment === "insufficient_evidence"` in the LLM output, the system falls back to the deterministic floor (built into `buildSystemPrompt()` at L163: *"the system will fall back to the deterministic floor"*). ✅ **Logged** (OperationsGuardian tick).

---

#### 9. AI Overlay — Q2 Reasoning — `server/pipeline/ai-overlay/q2-reasoning.ts`

**Primary or fallback?** LLM primary, no fallback template. If the LLM fails or the `validate()` function returns null (schema invalid, forbidden scoring/recommendation phrases detected), `runOverlay` returns an error envelope with `status: "error"`. The Watchtower then shows no Q2 reasoning section rather than a fallback string.  
**Logged?** `runOverlay` logs the failure internally. The caller surface silently omits the section. ⚠️ **Partial** — logged inside overlay client, but UI silently omits.

---

#### 10. AI Overlay — User Interpretation — `server/pipeline/ai-overlay/user-interpretation.ts`

Same pattern as Q2 Reasoning. If `validate()` fails (e.g. a `themeToken` in `whyItWorked` is not in the allowed set), the overlay returns an error envelope. No fallback text. UI silently omits the section.  
**Logged?** Same as above. ⚠️ **Partial.**

---

#### 11. AI Overlay — Competitor Intelligence — `server/pipeline/ai-overlay/competitor.ts`

**Primary or fallback?** LLM primary, no fallback template. Error envelope returned on failure. ⚠️ **Partial.**

---

#### 12. AI Overlay — Explanation — `server/pipeline/ai-overlay/explanation.ts`

**Primary or fallback?** LLM primary, no fallback template. ⚠️ **Partial.**

---

#### 13. AI Overlay — DNA Cluster — `server/pipeline/ai-overlay/dna.ts`

**Primary or fallback?** LLM primary, no fallback template. ⚠️ **Partial.**

---

#### 14. Anti-Template Registry — `server/commercial-reasoning/template-phrases.ts` L27

**This is NOT a template source.** It is a **blocklist** of filler phrases that are rejected by Integrity Gate AT3. If an engine output contains ≥2 phrases from this list (case-insensitive substring match), the output is rejected. Sample phrases: `"transparency proof"`, `"strategic alignment"`, `"best-in-class"`, `"move the needle"`, `"platform purchase-ready framework"`.

---

### 1.2 Full User Journey — Sentence Origin Trace

| Screen | LLM path | Template / deterministic path | Split (approx.) |
|---|---|---|---|
| **Watchtower Narrative** (5-step causal chain) | LLM v2 rewrites template steps when ≥3 engines complete + grounding passes | Template steps used when <3 engines run, or grounding fails (silent in the first case, logged in the second) | **40% LLM / 60% template** under current conditions (0 posts scraped = almost all engines degraded = template primary) |
| **Q2 Market Read card** | Full LLM: `marketRead`, `clientImplications`, `operatorWeighsNext` | None (section omitted on failure) | **100% LLM or absent** |
| **Engine Outputs** (Positioning / Offer / Audience) | LLM refines pre-computed seeds (Positioning), generates from pain language (Audience, Offer) | Signal seeds used directly when grounding fails; hardcoded `"Fallback targeting based on business context"` for ads | **65% LLM / 35% template seeds + fallback** |
| **Plan Document** | Section content from orchestrator engine runs (LLM-generated via Offer / Positioning engines) | Section structure, headers, labels always pre-written; AEL analytical package is LLM-generated but falls back to empty when inputs missing | **50% LLM / 50% pre-structure + fallback** |

---

## PART 2 — Existing Doctrine Inventory

### 2.1 System Prompts — Verbatim, with File + Line

---

#### `server/narrative-layer.ts` — Narrative Rewriter, L400

```
You are a brand strategist. Rewrite each of the 5 causal narrative steps into ONE
short sentence (≤16 words) using plain language. Use ONLY the provided evidence —
do NOT invent territories, mechanisms, or claims that are not in the evidence. If
a step's evidence is 'Pending' or empty, copy the template text verbatim.
Return STRICT JSON: { steps: [{key, text}], oneLiner }.
```
**Model:** `gpt-4o-mini` | **Temperature:** 0.4 | **max_tokens:** 600  
**Grounding gate (L422–507):** Rejects any quoted string not in the evidence allowlist, any capitalized multi-word proper noun not in anchor terms, and any single mid-sentence capitalized word not in a hardcoded allow-set (`instagram`, `tiktok`, etc.). The model's `oneLiner` field is **always discarded** (L429–431); the one-liner is re-synthesized from the validated steps. Classification: **Enrichment-only.**

---

#### `server/analytical-enrichment-layer/engine.ts` — AEL v2, L157–181

```
You are a Deep Causal Interpretation Engine — the Analytical Enrichment Layer (AEL v2).

YOUR MISSION:
You interpret WHY things happen, not WHAT is happening. You extract ROOT CAUSES
beneath surface signals. You model causal chains that explain buyer behavior. You
identify the REAL reasons people don't convert — not the obvious ones.

CRITICAL DISTINCTION:
- Surface signal: "Users complain about price"
- Deep interpretation: "Users lack trust in ROI justification — they can't see how
  the investment pays back, so any price feels too high. The real barrier is proof
  of value, not affordability."

YOU MUST NOT:
- Label signals without interpretation
- Make strategic recommendations or decisions — you INTERPRET, engines DECIDE
- Fabricate data — if evidence is weak, say so in confidence_notes
```
**Classification: Real causal reasoning** — but strictly prohibited from producing any strategic recommendation or decision.

---

#### `server/commercial-reasoning/awareness-depth-interpreter.ts` — Awareness-Depth Interpreter, L153–165

```
You are the awareness commercial-depth interpreter for a marketing AI system.
The user prompt begins with a BUSINESS PROFILE block (industry, sub-industry,
business model, buyer type, pricing complexity, funnel type, commercial lens,
reasoning framework).
READ THE BUSINESS PROFILE FIRST. Use its commercial_lens.primaryLevers /
marketDynamics / buyerPsychology as the FRAMING for how you read the evidence
corpus that follows.
You produce a STRUCTURED JSON commercial assessment grounded strictly in the
supplied analytical-enrichment-layer (AEL) evidence — never invent business facts
beyond what the profile states.
Every claim you make MUST be backed by at least one evidence_refs entry that
quotes a real fragment from the AEL.
NEVER invent evidence. NEVER use template phrases like 'transparency proof',
'best-in-class', 'industry-leading', 'strategic alignment'.
If evidence is insufficient, set reasoner_self_assessment='insufficient_evidence'
and the system will fall back to the deterministic floor.
```
**Classification: Real commercial reasoning** — receives a structured Business Profile + AEL evidence corpus. Produces `depthAssessment`, `buyer_state`, `saturation_state`, `trust_state`. Strongest reasoning call in the system.

---

#### `server/pipeline/ai-overlay/q2-reasoning.ts` — Q2 Market Shift, L44–78

```
You are a commercial strategist explaining a market-shift verdict to a marketing
agency operator who will read this output to a client.

The Boss agent has already decided whether the market has shifted using deterministic
rules. You are NOT deciding anything. You are translating the verdict and the
structured market signals into language a client would understand.

Tone: Commercial, not technical. Specific, not generic. Plain language.
No jargon, no rule codes in the body, no scoring words ("high","low","score","rank").
Honest. If data is insufficient or signals are weak, say so plainly.

Hard constraints:
1. You MUST cite the verdict EXACTLY as given. Never propose a different verdict.
2. You MUST NOT invent or rename theme tokens.
3. You MUST NOT introduce thresholds, scores, rankings, or numeric magnitudes.
4. You MUST NOT recommend specific actions. You may flag what the operator should
   weigh; you may not say "do X".
5. You MUST NOT mention rule codes in any body text.

BAD (recommendation):  "you should switch to value-led messaging"
GOOD (operator-weighs): "Whether to test a value-led angle this cycle is worth a
                         conversation with the client"
```
**Forbidden scoring regex (L112):** `\b(score|scored|ranking|rank|rating|grade|tier|magnitude|severity|high risk|low risk|...)\b`  
**Forbidden recommendation regex (L123):** `\b(you should|you need to|you must|we recommend|switch to|pivot to|run a campaign|...)\b`  
**Classification: Enrichment-only** — `interpretation_only: true` is a required output field (L62). Translates a pre-made verdict; does not create strategy.

---

#### `server/pipeline/ai-overlay/user-interpretation.ts` — User Post Interpretation, L42–65

```
You are a deterministic marketing analyst interpreting a user's posts.
You receive rule-based outputs (composition, cluster interpretation lens, lead
quality, outcome regression) and a small evidence sample.

Your job is to ADD interpretation: WHY did themes work, and HOW is paid
amplification interacting with organic traction.

YOU MUST NOT:
- change any number from the inputs
- contradict any rule status
- recommend an action or pick a winner
- overwrite the verdict

Output STRICT JSON only:
{
  "interpretation_only": true,
  "whyItWorked": [{ "themeToken": string, "reasoning": string }],
  "amplificationReading": { "natural": [...], "paid": [...], "blended": [...], "reasoning": string }
}
```
**Validation (L92–120):** Every `themeToken` in `whyItWorked` must appear verbatim in the allowed themes set — invented tokens cause validation failure.  
**Classification: Enrichment-only.** `interpretation_only: true` is a required field.

---

#### `server/pipeline/ai-overlay/competitor.ts` — Competitor Theme Interpretation, L72–88

```
You are a deterministic marketing analyst.
You receive a set of competitor theme tokens (already detected by a rules-based
system) plus an evidence sample for each.
Your job is to ADD semantic interpretation. You do not change counts, statuses,
or rule decisions.

Rules:
- Every themeToken you reference MUST appear verbatim in the input themes list.
  Never invent tokens.
- Reasoning must be one or two sentences, plain English, citing observable evidence.
```
**Classification: Enrichment-only.** Adds semantic grouping to pre-detected tokens.

---

#### `server/pipeline/ai-overlay/explanation.ts` — Verdict Explanation, L36–53

```
You are a deterministic marketing analyst translating a verdict into plain English.

You receive: a verdict (already decided), the reason codes that produced it, and
optional rule context.
Your job is to ADD a narrative that explains the verdict. You do not change the
verdict. You do not add reasons that were not given to you.

Rules:
- Every "citesReason" MUST appear verbatim in the input "reasons" list.
- Do not invent reason codes.
- Do not contradict the verdict.
```
**Classification: Enrichment-only.** Narrates a pre-computed verdict.

---

#### `server/pipeline/ai-overlay/dna.ts` — Cluster DNA Interpretation, L67–85

```
You are a deterministic marketing analyst.
You receive a cluster signature (theme tokens + post counts) plus optional sample text.
Your job is to ADD semantic meaning. You do not change counts or rule decisions.

Rules:
- "clusterMeaning" is one to three sentences. Plain English. No marketing fluff.
- Reasoning must cite specific theme tokens from the input.
```
**Classification: Enrichment-only.** Labels a pre-computed cluster with semantic meaning and persuasion logic tags.

---

#### `server/audience-engine/engine.ts` — Segment Construction, L1190–1225

```
You are an audience research analyst. Based on market evidence, construct 2-4
distinct audience segments.

BUSINESS: {industry} — {coreOffer}

PAIN MAP (from real audience data):
- {canonical}: frequency={n}, confidence={%}

DESIRE MAP: ...  OBJECTION MAP: ...  EMOTIONAL DRIVERS: ...
MARKET MATURITY: ...  AWARENESS LEVEL: ...

SAMPLE COMMENTS (real audience language):
"{comment_1}"
...

Return a JSON array of 2-4 segments. Each segment:
{ "name", "description", "painProfile", "desireProfile", "objectionProfile",
  "motivationProfile", "estimatedPercentage" }
Return ONLY the JSON array, no markdown.
```
**Model:** `gpt-4.1-mini` | **Temperature:** 0.4 | **max_tokens:** 2000  
**No system/user split:** Single `user` message with all context embedded.  
**Classification: Partial reasoning** — the AI constructs segment profiles from real signal data, but prescriptive outputs are sanitized away (L1305: prescriptive patterns → `[hint]`).

---

#### `server/audience-engine/engine.ts` — Ads Targeting, L1342–1361

```
You are a Meta Ads targeting expert. Translate audience segments into Meta Ads
Manager targeting suggestions.

BUSINESS: {industry} — {coreOffer}
LOCATION: ...  MARKET MATURITY: ...

SEGMENTS:
- {name}: Pains={...}. Desires={...}. Objections={...}

For each segment, return:
{ "suggestedInterests", "suggestedBehaviors", "suggestedAgeRange",
  "suggestedGender", "suggestedLocations", "rationale" }
Return ONLY a JSON array. Use real Meta Ads targeting options.
```
**Model:** `gpt-4.1-mini` | **Temperature:** 0.3 | **max_tokens:** 1500  
**Classification: Real structured reasoning** within a narrow constrained domain.

---

#### `server/positioning-engine/engine.ts` — Positioning Refiner (hasSignals=true), L1736–1768

```
You are a strategic positioning REFINER. Your job is to SHARPEN the provided
claim seeds into precise positioning statements. You must NOT generate new
concepts — only refine what is given.

HARD CONSTRAINTS:
- Your output MUST preserve the meaning of the claim seeds. If you cannot refine
  a seed, return it as-is.
- Do NOT introduce concepts, problems, or solutions not present in the SOURCE SIGNALS.
- Every word in your output must trace back to a SOURCE SIGNAL label. If unsure,
  use the signal label directly.
```
**Model:** `gpt-4.1-mini` | **Temperature:** 0.0 | **seed:** 42  
**Classification: Enrichment-only.** Sharpens pre-computed claim seeds; forbidden from generating new concepts.

---

#### `server/positioning-engine/engine.ts` — Positioning Analyst (hasSignals=false), L1770–1788

```
You are a strategic positioning analyst. Generate precise positioning statements
for each territory.

RULES:
1. DOMAIN TRANSLATION FIRST: Before composing any field, restate each territory
   name as the operational failure it represents for this specific business type.
   Use domain-operational language — not generic emotional framing.
2. COMPRESSION: Focus on the FIRST territory as the PRIMARY positioning. Express
   it as a specific root-cause SYSTEM FAILURE.
3. enemyDefinition: Name the specific operational/system failure. Must include a
   system-level noun (tool, system, process, pipeline...) and a failure verb
   (fails, breaks, lacks, blocks, collapses, erodes, stalls).
```
**Classification: Partial reasoning** — generates from territory labels when no signal seeds exist. Still constrained to territory names provided.

---

#### `server/offer-engine/engine.ts` — Offer Copywriter (Refinement), L1819–1868

```
You are an Offer Copywriter. You must refine the wording of pre-built offer skeletons.

CRITICAL: You are NOT generating offers from scratch. The strategic structure has
already been decided.
Your ONLY job is to improve the wording to be more compelling, specific, and market-ready.

You MUST preserve:
1. The axis keywords — do NOT remove them
2. The mechanism name — do NOT rename or replace it
3. The pain/desire references — do NOT substitute different pains/desires
...

BANNED WORDS: "optimize", "leverage", "scale", "transform", "empower", "unlock",
"synergy", "holistic", "comprehensive", "innovative", "cutting-edge", "next-level",
"game-changing", "paradigm"

ABSOLUTE RULES:
- Do NOT generate funnel architecture, advertising strategy, channel selection,
  media planning, or budget recommendations
- Do NOT include financial advisory claims
```
**Model:** `gpt-4.1-mini` | **Temperature:** 0.5 | **max_tokens:** 1000  
**Classification: Enrichment-only.** Refines pre-built skeletons.

---

#### `server/offer-engine/engine.ts` — Offer Architect (Generation), L2007–2056

```
You are an Offer Architect. Generate three offer concepts.

ABSOLUTE RULES:
- Do NOT generate funnel architecture, advertising strategy, channel selection,
  media planning, budget recommendations, campaign execution, sales scripts, or
  strategic master plan decisions
- Do NOT include financial advisory claims

SECTION 1: AUDIENCE PAIN LANGUAGE (use these exact words)
Raw Pain Phrases: [...]
MANDATORY LANGUAGE RULES:
- You MUST use the audience's own words above directly in the offer name, outcome,
  mechanism, and deliverables.
- BANNED WORDS: "optimize", "leverage", "scale", "transform"...

SECTION 2: OUTCOME PRECISION (MANDATORY)
NEVER use vague outcomes like "financial improvement", "better results".

SECTION 3: MECHANISM (single source of truth)
Mechanism Name: "{mechName}"
MANDATORY: All offer mechanism descriptions MUST reference "{mechName}" by name.

SECTION 4: SIGNAL ANCHORS
Every claim must be derived from one of these upstream signals.
```
**Model:** `gpt-4.1-mini` | **Temperature:** 0.7 | **max_tokens:** 1000  
**Classification: Real generation** — creates offer structure from audience pain language + mechanism + signals. The most generative call in the system, though still highly constrained.

---

#### `server/commercial-reasoning/llm-call.ts` — Generic LLM Caller, L52 + L74

```typescript
systemPrompt: string;   // injected by caller
// ...
{ role: "system", content: input.systemPrompt },
```
This is a generic wrapper; the actual system prompt is supplied by each calling module. The awareness-depth-interpreter and other commercial-reasoning engines supply their own prompts through this function.

---

### 2.2 Is There Centralized Marketing Doctrine?

**Short answer: No.** There is no shared pre-run `StrategicDoctrine` object (target segment → segment problems → product design → pricing → channels → delivery → relationship) injected into all engines as a common foundation.

**What does exist:**

| Object | Location | Role | Shared to all engines? |
|---|---|---|---|
| `SharedStrategicContext` (SSC) | `server/orchestrator/shared-strategic-context.ts` L289 | Aggregates engine results as they complete | ❌ It is a **result collector**, not a pre-run input. Engines write to it; they don't read it before running. |
| `strategy-root` | `server/shared/strategy-root.ts`, referenced in `orchestrator/index.ts` L154 | Foundational positioning anchor built from onboarding data | ⚠️ Passed to Offer engine (L2205) and Narrative layer; not consistently injected into all engines at prompt time. |
| `commercial-dna` / `productDna` | `server/shared/commercial-dna.ts`, `app/contexts/ProductDNAContext.tsx` | Product identity: mechanism name, core promise, brand values | ⚠️ Injected into Audience (L1188), Positioning (L1740), Offer (L1872) engines as a formatted block. Not injected into Narrative, AEL, or AI overlays. |
| `BusinessProfile` (Awareness-Depth) | `server/commercial-reasoning/awareness-depth-interpreter.ts` L186+ | Industry, sub-industry, business model, buyer type, funnel type, commercial lens | ✅ Injected fully into its own LLM call — but not passed to other engines. |

**Conclusion:** Each engine has its own ad-hoc prompt. The Audience engine does not know what channels the Boss will recommend. The Offer engine does not know what the Positioning engine decided. The AEL interprets WHY but cannot share that to the Awareness-Depth interpreter. There is no pipeline where a single doctrine object flows from top to bottom of the reasoning stack.

---

### 2.3 Enrichment-Only vs. Real Reasoning — Classification

| Engine / Layer | Classification | Evidence |
|---|---|---|
| **Narrative Layer v2** | Enrichment-only | Prompt: "Use ONLY the provided evidence — do NOT invent" (L400). Grounding gate rejects new nouns (L422–507). |
| **AEL v2** | Real causal reasoning (interpretation only — no decisions) | Prompt: "You interpret WHY things happen... you INTERPRET, engines DECIDE" (L181). Full causal chain extraction. |
| **Awareness-Depth Interpreter** | Real commercial reasoning | Full business profile + AEL corpus. Produces `buyer_state`, `saturation_state`, `trust_state`. |
| **Q2 Reasoning Overlay** | Enrichment-only | `interpretation_only: true` required (L62). Translates pre-made verdict. Recommendation regex rejection (L123). |
| **User Interpretation Overlay** | Enrichment-only | `interpretation_only: true` required (L29). Cannot change any number. |
| **Competitor Overlay** | Enrichment-only | "You do not change counts, statuses, or rule decisions" (L74). |
| **Explanation Overlay** | Enrichment-only | "You do not change the verdict... do not add reasons not given" (L40). |
| **DNA Cluster Overlay** | Enrichment-only | "You do not change counts or rule decisions" (L69). |
| **Audience Engine — Segments** | Partial reasoning | Constructs segment profiles from real pain/desire data. Prescriptive outputs sanitized. |
| **Audience Engine — Ads Targeting** | Real structured reasoning (narrow domain) | Translates segments into Meta Ads parameters. Not fully constrained to pre-existing values. |
| **Positioning Engine (Refiner)** | Enrichment-only | "You must NOT generate new concepts — only refine" (L1736). Temperature 0.0, seed 42. |
| **Positioning Engine (Analyst)** | Partial reasoning | Generates from territory labels when no seeds exist; still constrained to provided territory names. |
| **Offer Engine (Copywriter/Refiner)** | Enrichment-only | "You are NOT generating offers from scratch. The strategic structure has already been decided." (L1821). |
| **Offer Engine (Architect/Generator)** | Real generation (highly constrained) | Creates offer concepts from audience language + mechanism + signals. Most generative call. Temperature 0.7. |
| **Boss Agent / Orchestrator** | Real strategy decision | Decides `action ∈ {test|scale|hold|halt}` and primary channel via deterministic rules (Q2 evaluation). Only genuine un-narrated decision point in the system. |

---

## PART 3 — Why Output Feels Templated

### Root Cause Diagnosis — Ranked by Impact

---

#### 🥇 Cause 1 (Highest impact): Prompts constrain AI to enrichment and rewording of pre-computed values

Every AI overlay carries `interpretation_only: true`. The Narrative v2 LLM is forbidden from inventing new content (L400). The Positioning Refiner is forbidden from generating new concepts (L1736). The Offer Copywriter is forbidden from generating from scratch (L1821).

**Result:** The LLM never produces a sentence that wasn't already implied by the deterministic engine outputs. It compresses, translates, and polishes — but the *substance* is always pre-determined. If the deterministic layer produces generic territory names or signal labels, the LLM will produce generic prose, because it is not permitted to supply the missing specificity.

**What would change it:** At least one engine (ideally Positioning or Offer) needs a mode where the AI receives only raw market data (audience pain language, competitor themes, AEL causal chains) with no pre-computed verdict to translate — and is asked to produce a positioning claim from scratch.

---

#### 🥈 Cause 2 (High impact): No shared marketing doctrine flows into all engines

The `SharedStrategicContext` is a result aggregator written to by each engine after it runs. There is no object that is read *before* each engine runs and that says: "This business targets segment X, which has problem Y, solved by mechanism Z, delivered through channel W, priced at P, competing against enemy E."

**Result:** Each engine reasons independently. The Audience engine produces segment names. The Positioning engine generates territory names. The Offer engine picks mechanism references. None of these engines knows what the others decided. The Narrative layer then stitches together 5 steps from these independent outputs, which forces it toward generic connective language rather than a coherent single argument.

**What would change it:** Build a `StrategicDoctrine` struct (assembled from `strategy-root` + `commercial-dna` + Boss decision + AEL top insights) at the start of each orchestrator run and inject it into every engine prompt before they run.

---

#### 🥉 Cause 3 (Medium impact): LLM calls degrading silently because the data pipeline is empty

All `mi`-dependent engines (AEL, Awareness-Depth, Positioning, Audience) require competitor and audience signal data as their primary input. As of the audit date, every fetch job in the database shows `total_posts_fetched = 0` across all recent runs (confirmed by DB query). This is caused by Bright Data proxy returning HTTP 407 (credential rejection), meaning no posts are scraped.

**Result:** The AEL fallback fires (L144–152: `"no MI or Audience input available"`). The Audience engine receives empty pain/desire maps. The Positioning engine has no signal seeds and falls through to the Analyst path with bare territory labels. The Offer Architect receives `"No qualifying signals provided — generate conservatively"` (L2043). Every engine runs on empty input, which collapses all paths to the most conservative, generic possible output even when the LLM calls technically succeed.

**This is the single highest-leverage fix for output quality.** No prompt improvement will produce specific, real outputs until the data pipeline delivers real competitor and audience posts.

---

#### 4️⃣ Cause 4 (Low impact): Anti-template blocklist narrows vocabulary further

The AT3 Integrity Gate (`template-phrases.ts`) rejects outputs containing ≥2 blocklisted phrases. With enrichment-only constraints already limiting what the AI can say, this additional vocabulary filter means an AI that is already forbidden from reasoning freely and already forbidden from common connective phrases will produce output that feels mechanical and constrained.

This is well-intentioned (it prevents specific known-bad patterns from prior judge runs) but its marginal effect on quality is low compared to causes 1–3.

---

## Summary Table

| Output Surface | Source | Fallback Trigger | Logged? |
|---|---|---|---|
| Watchtower Narrative — 5 steps | LLM v2 (primary) or template steps (fallback/primary) | `<3` engines, `problemSource="none"`, grounding gate rejection, or LLM call failure | ✅ `console.warn` L515, L519 when LLM fails; ❌ silent when template fires as primary |
| AEL Analytical Package | LLM causal reasoning | Missing `mi` + `audience` inputs | ✅ `console.log` L139 |
| Awareness-Depth Assessment | LLM commercial reasoning | `reasoner_self_assessment="insufficient_evidence"` → deterministic floor | ✅ OperationsGuardian tick |
| Audience Segments | LLM construction | LLM call or parse failure | ✅ `console.error` L1288 |
| Ads Targeting | LLM generation | LLM call or parse failure | ✅ `console.error` L1384; fallback: `"Fallback targeting based on business context"` |
| Positioning Claim Fields | LLM Refiner/Analyst | Per-field grounding gate rejection → signal seed used as-is | ✅ `console.log` L1843 |
| Offer (Refinement path) | LLM Copywriter | LLM failure | ✅ logged; pre-built skeletons returned unrefined |
| Offer (Generation path) | LLM Architect | LLM failure or insufficient differentiation data | ✅ `console.log` L2276 |
| Q2 Reasoning card | LLM translation of boss verdict | LLM failure or schema validation failure | ⚠️ Logged inside overlay client; UI silently omits section |
| User Interpretation card | LLM interpretation | LLM failure or invalid theme tokens | ⚠️ Logged inside overlay client; UI silently omits section |
| Competitor Intelligence overlay | LLM semantic grouping | LLM failure or token allowlist violation | ⚠️ Logged inside overlay client; UI silently omits section |
| DNA Cluster overlay | LLM semantic labeling | LLM failure | ⚠️ Logged inside overlay client; UI silently omits section |
| Explanation overlay | LLM verdict narrative | LLM failure or unknown reason code | ⚠️ Logged inside overlay client; UI silently omits section |
| Boss action decision | **Deterministic rules** (not LLM) | N/A | ✅ Full orchestrator audit trail |
