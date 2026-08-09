import { aiChat } from "../ai-client";
import { selectPainForUse } from "../shared/audience-pain-registry";
import {
  buildDoctrineBlock,
  deriveAnchorFromProductDna,
  type RunStrategicContext,
  type ProductAnchor,
  type ProductDnaLike,
} from "../shared/strategic-doctrine";
import {
  ENGINE_VERSION,
  STATUS,
  AXIS_MECHANISM_GUIDANCE,
  MIN_MECHANISM_CONFIDENCE,
} from "./constants";
import {
  enforceBoundaryWithSanitization,
  applySoftSanitization,
  assessDataReliability,
  normalizeConfidence,
} from "../engine-hardening";
import { formatAELForPrompt } from "../analytical-enrichment-layer/engine";
import { buildStructuredAELBlock } from "../differentiation-engine/engine";
import { buildGroundingContract, checkGroundingContract } from "../shared/grounding-contract";
import {
  buildCausalDirectiveForPrompt,
  enforceEngineDepthCompliance,
  applyDepthPenalty,
  isDepthBlocking,
  buildDepthRejectionDirective,
  buildDepthGateResult,
  DEPTH_GATE_MAX_RETRIES,
  type DepthGateResult,
  type DepthComplianceResult,
} from "../causal-enforcement-layer/engine";
import type {
  MechanismEnginePositioningInput,
  MechanismEngineDifferentiationInput,
  MechanismOutput,
  MechanismEngineResult,
} from "./types";

function clamp(v: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, v));
}

function safeJsonParse(text: any): any {
  if (!text) return null;
  if (typeof text !== "string") return text;
  try { return JSON.parse(text); } catch {}

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const slice = text.slice(firstBrace, lastBrace + 1);
    try { return JSON.parse(slice); } catch {}

    const repaired = slice
      .replace(/,(\s*[}\]])/g, "$1")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'");
    try { return JSON.parse(repaired); } catch {}
  }

  return null;
}

function resolvePrimaryAxis(positioning: MechanismEnginePositioningInput): string {
  const axes = positioning.differentiationVector || [];
  if (axes.length > 0) return axes[0];

  const contrast = (positioning.contrastAxis || "").toLowerCase();
  if (contrast.includes("simple") || contrast.includes("easy") || contrast.includes("complex")) return "simplicity_and_ease";
  if (contrast.includes("cost") || contrast.includes("afford") || contrast.includes("cheap") || contrast.includes("expensive")) return "cost_affordability";
  if (contrast.includes("fast") || contrast.includes("speed") || contrast.includes("quick") || contrast.includes("slow")) return "speed_and_efficiency";
  if (contrast.includes("proof") || contrast.includes("transparen") || contrast.includes("evidence") || contrast.includes("data")) return "proof_and_transparency";
  if (contrast.includes("niche") || contrast.includes("speciali") || contrast.includes("expert")) return "niche_expertise";

  return "unique_approach";
}

function getAxisGuidance(axis: string): { emphasis: string[]; banned: string[] } {
  return AXIS_MECHANISM_GUIDANCE[axis] || {
    emphasis: ["unique approach", "distinct methodology", "proprietary process"],
    banned: ["generic", "standard", "typical"],
  };
}

function validateMechanismAxisAlignment(
  mechanism: MechanismOutput,
  primaryAxis: string,
): { consistent: boolean; failures: string[] } {
  const failures: string[] = [];
  const mechText = `${mechanism.mechanismName} ${mechanism.mechanismDescription} ${mechanism.mechanismLogic} ${mechanism.mechanismPromise}`.toLowerCase();
  const guidance = getAxisGuidance(primaryAxis);

  const emphasisHits = guidance.emphasis.filter(e => mechText.includes(e.toLowerCase()));
  const bannedHits = guidance.banned.filter(b => mechText.includes(b.toLowerCase()));

  if (emphasisHits.length === 0 && guidance.emphasis.length > 0) {
    failures.push(`Mechanism does not reflect ${primaryAxis} axis — no emphasis keywords found. Expected themes: ${guidance.emphasis.slice(0, 3).join(", ")}`);
  }

  if (bannedHits.length > 0) {
    failures.push(`Mechanism contains banned language for ${primaryAxis} axis: ${bannedHits.join(", ")}`);
  }

  if (mechanism.axisAlignment.primaryAxis !== primaryAxis) {
    failures.push(`Mechanism declares axis "${mechanism.axisAlignment.primaryAxis}" but positioning requires "${primaryAxis}"`);
  }

  return { consistent: failures.length === 0, failures };
}

export async function runMechanismEngine(
  positioning: MechanismEnginePositioningInput,
  differentiation: MechanismEngineDifferentiationInput,
  accountId: string,
  analyticalEnrichment?: any,
  strategic?: RunStrategicContext,
  productDna?: ProductDnaLike | null,
  painRegistry?: any[],
): Promise<MechanismEngineResult> {
  const result = await runMechanismEngineInternal(
    positioning, differentiation, accountId, analyticalEnrichment, strategic, productDna,
  );
  // Authoritative pain routing (Task 163): mechanism explains the root cause
  // of the CORE purchase pain — never a post-purchase complaint (the
  // `mechanism` use is only carried by CORE_PURCHASE). Entry wrapper ⇒ the
  // selected role rides EVERY return path, including degraded ones.
  if (Array.isArray(painRegistry) && painRegistry.length > 0) {
    const corePain = selectPainForUse(painRegistry, "mechanism");
    if (corePain) {
      console.log(`[MechanismEngine] MECHANISM_PAIN_SELECTED | painId=${corePain.painId} | class=${corePain.classification} | rank=${corePain.rank} | rootCauses=${(corePain.rootCauseIds || []).length}`);
    }
    (result as any).selectedPainRoles = {
      core: corePain
        ? {
            painId: corePain.painId,
            canonical: corePain.canonical,
            rank: corePain.rank,
            role: "mechanism_root_cause" as const,
            classification: corePain.classification,
            rootCauseIds: corePain.rootCauseIds || [],
          }
        : null,
    };
  }
  return result;
}

async function runMechanismEngineInternal(
  positioning: MechanismEnginePositioningInput,
  differentiation: MechanismEngineDifferentiationInput,
  accountId: string,
  analyticalEnrichment?: any,
  strategic?: RunStrategicContext,
  productDna?: ProductDnaLike | null,
): Promise<MechanismEngineResult> {
  const startTime = Date.now();
  const diagnostics: Record<string, any> = {};

  const primaryAxis = resolvePrimaryAxis(positioning);
  const allAxes = positioning.differentiationVector || [primaryAxis];
  const guidance = getAxisGuidance(primaryAxis);
  const diffCore = differentiation.mechanismCore;
  const diffFraming = differentiation.mechanismFraming || {};
  const pillars = differentiation.pillars || [];

  diagnostics.primaryAxis = primaryAxis;
  diagnostics.allAxes = allAxes;
  diagnostics.hasDiffCore = !!diffCore;
  diagnostics.pillarCount = pillars.length;

  console.log(`[MechanismEngine] START | axis=${primaryAxis} | axes=[${allAxes.join(",")}] | diffCore=${!!diffCore} | pillars=${pillars.length}`);

  if (!positioning.contrastAxis && allAxes.length === 0 && pillars.length === 0) {
    return {
      status: STATUS.INSUFFICIENT_INPUT,
      statusMessage: "No positioning axis, contrast axis, or differentiation pillars available — cannot generate axis-aligned mechanism",
      primaryMechanism: buildFallbackMechanism(diffCore, primaryAxis),
      alternativeMechanism: null,
      axisConsistency: { consistent: false, primaryAxis, mechanismAxis: primaryAxis, failures: ["Insufficient positioning data"] },
      confidenceScore: 0.2,
      executionTimeMs: Date.now() - startTime,
      engineVersion: ENGINE_VERSION,
      diagnostics,
    };
  }

  const aelBlock = formatAELForPrompt(analyticalEnrichment || null);
  const causalDirective = buildCausalDirectiveForPrompt(analyticalEnrichment || null);
  const aelStructuredBlock = buildStructuredAELBlock(analyticalEnrichment || null);
  if (aelBlock.length > 0) {
    console.log(`[MechanismEngine] AEL_INJECTED | enrichmentSize=${aelBlock.length}chars | structuredBlock=${aelStructuredBlock.length}chars`);
  }

  // Anchor doctrine (criteria A + B): inject the strategic doctrine block when
  // threaded; when the doctrine anchor is absent, derive an anchor from Product
  // DNA (F5a). deriveAnchorFromProductDna returns null unless differentiator +
  // problem + name + type all exist (D5 — never fabricate).
  let doctrineBlock = "";
  if (strategic) {
    doctrineBlock = buildDoctrineBlock(strategic);
  } else {
    console.log("[MechanismEngine] DOCTRINE_ABSENT — no strategic context threaded; omitting doctrine block");
  }
  let mechAnchor: ProductAnchor | null = strategic ? strategic.doctrine.productAnchor : null;
  if (!mechAnchor && productDna) {
    const derivedAnchor = deriveAnchorFromProductDna(productDna);
    if (derivedAnchor) {
      mechAnchor = derivedAnchor;
      console.log("[MechanismEngine] ANCHOR_FROM_DNA | doctrine anchor absent — prompt anchor derived from business context (F5a)");
    }
  }
  // Explicit if/else source classification — no semantic-fallback chains (D1).
  let mechAnchorSource: "doctrine" | "dna" | "none" = "none";
  if (strategic && strategic.doctrine.productAnchor) {
    mechAnchorSource = "doctrine";
  } else if (mechAnchor) {
    mechAnchorSource = "dna";
  }
  const dnaAnchorBlock = mechAnchorSource === "dna" && mechAnchor
    ? `
=== PRODUCT ANCHOR (from Product Identity — resolve the mechanism to THIS product) ===
Product name: ${mechAnchor.name}
Product type: ${mechAnchor.type}${mechAnchor.keyAttributes.length > 0 ? `\nKey attributes: ${mechAnchor.keyAttributes.join("; ")}` : ""}
Core problem solved: ${mechAnchor.coreProblemSolved}
Differentiating feature: ${mechAnchor.differentiatingFeature}
`
    : "";
  const anchorGroundingRule = mechAnchor
    ? "\nANCHOR GROUNDING: The mechanism name, steps, promise, and logic MUST be specific to the anchored product above — its core problem and differentiating feature. Anchor grounding SUPPLEMENTS the AEL causal grounding rules below; it never replaces the [RC#]/[BB#]/[CC#] requirements.\n"
    : "";
  const groundingContractBlock = buildGroundingContract(mechAnchor, analyticalEnrichment || null);

  const pillarSummary = pillars.slice(0, 5).map((p: any) => `"${p.name || p.territory}": ${p.description || ""}`.slice(0, 120)).join("\n");

  const validatedClaims = (differentiation.claimStructures || []) as any[];
  const sortedClaims = [...validatedClaims].sort((a: any, b: any) => (b?.overallScore || 0) - (a?.overallScore || 0)).slice(0, 5);
  const claimsBlock = sortedClaims.length > 0
    ? sortedClaims.map((c: any, i: number) => `[CLAIM ${i + 1}] (score=${(c.overallScore || 0).toFixed(2)}, territory="${c.territory || "n/a"}"): ${c.claim}`).join("\n")
    : "";
  const claimsSection = claimsBlock ? `
═══ VALIDATED CLAIMS FROM DIFFERENTIATION (CANONICAL — anchor your promise to one of these) ═══
The Differentiation Engine produced and validated these claims via three layers (scoring, refinement, stability guard). Your mechanism's "promise" field MUST be a refined version of ONE of these claims — same core meaning, sharpened for axis alignment. Do NOT invent a new promise unrelated to these claims.

${claimsBlock}

In your output, set "anchorClaimIndex" to the [CLAIM N] you anchored on (1-based). The promise text must preserve the semantic core of that claim.
` : "";

  const existingMechanismSection = diffCore && diffCore.mechanismType !== "none" ? `
EXISTING MECHANISM FROM DIFFERENTIATION ENGINE (use as foundation):
Name: "${diffCore.mechanismName}"
Type: ${diffCore.mechanismType}
Steps: ${diffCore.mechanismSteps.map((s: string, i: number) => `${i + 1}. ${s}`).join("\n")}
Promise: ${diffCore.mechanismPromise}
Problem: ${diffCore.mechanismProblem}
Logic: ${diffCore.mechanismLogic}

You MUST keep the core identity of this mechanism. Refine it to strengthen axis alignment, do NOT replace it entirely.` : `
No validated mechanism exists yet. Generate a NEW mechanism from scratch based on the positioning axis and differentiation pillars.`;

  const prompt = `You are a Mechanism Architect. Your job is to generate a strategic mechanism that is STRICTLY aligned with the positioning axis and GROUNDED in causal analysis.
${doctrineBlock ? `\n${doctrineBlock}\n` : ""}${dnaAnchorBlock}${anchorGroundingRule}${groundingContractBlock}
${aelBlock ? `═══ ANALYTICAL ENRICHMENT LAYER (CAUSAL FOUNDATION — MANDATORY) ═══
${aelBlock}

${causalDirective}
${aelStructuredBlock}

Your mechanism MUST derive from the root causes and causal chains above. Every step in the mechanism must address a real behavioral barrier or causal factor. Do NOT invent steps that aren't grounded in the analysis.

AEL CAUSAL GROUNDING (MANDATORY — output will be rejected if missing):
- The mechanism description MUST explicitly reference at least one ROOT CAUSE by its [RC#] identifier from the AEL STRUCTURE above
- Each mechanism step MUST follow a causal chain (cause → intervention → outcome) using language from the CAUSAL CHAINS [CC#] above
- The mechanism MUST resolve at least one specific BARRIER [BB#] and explain HOW it resolves it
- CRITICAL: You MUST embed the EXACT "Deep cause" text and EXACT barrier text from the AEL STRUCTURE directly into your mechanism description, steps, and logic. Do not paraphrase — copy the key phrases verbatim. The depth checker uses text matching to verify AEL usage.
- Include the cause→impact→behavior chain text from the CAUSAL CHAINS verbatim in the mechanism logic
- The "rootCauseUsed" and "barrierResolved" fields in the output are REQUIRED — not optional
` : ""}═══ POSITIONING AXIS (IMMUTABLE — ALL MECHANISMS MUST ALIGN) ═══
Primary Axis: "${primaryAxis}"
Contrast Axis: "${positioning.contrastAxis || "not defined"}"
Enemy: "${positioning.enemyDefinition || "not defined"}"
Narrative Direction: "${positioning.narrativeDirection || "not defined"}"
All Differentiation Axes: [${allAxes.join(", ")}]

═══ AXIS ALIGNMENT RULES (VIOLATION = REJECTION) ═══
The mechanism MUST embody the "${primaryAxis}" axis in every component:
- EMPHASIZE these themes: ${guidance.emphasis.join(", ")}
- NEVER use these themes: ${guidance.banned.join(", ")}
- The mechanism name, description, steps, promise, and logic must ALL reference the "${primaryAxis}" axis
- If positioning says "${primaryAxis}", the mechanism must directly enable that quality

═══ DIFFERENTIATION PILLARS ═══
${pillarSummary || "No pillars available"}
${claimsSection}
${existingMechanismSection}

═══ MECHANISM NAMING RULES (MUST SATISFY ALL) ═══
The mechanism name MUST contain all three elements:
1. DOMAIN OBJECT: A noun from the business type, offer, or core problem (e.g., "SaaS Onboarding", "Lead Qualification", "Menu Pricing", "Clinic Intake", "Campaign ROI")
2. OPERATIONAL ACTION: A verb or action phrase describing what the mechanism does (e.g., "Diagnostic", "Extraction", "Repair", "Conversion", "Audit", "Compression")
3. UNIQUE IDENTITY: A descriptor that makes the name specific to this business (e.g., the axis name "${primaryAxis}", or a specific outcome)

INVALID names (too generic — will be rejected):
- "The Clarity System" — no domain object
- "Growth Engine" — no operational action
- "Simplicity Framework" — no domain anchor
- "The Transformation Protocol" — domain-agnostic

VALID name examples (domain-grounded):
- "The SaaS ROI Proof Diagnostic" — domain object (SaaS ROI) + action (Proof Diagnostic)
- "The Agency Lead Qualification Engine" — domain object (Agency Lead) + action (Qualification Engine)
- "The Clinic Intake Trust Audit" — domain object (Clinic Intake) + action (Trust Audit)
- "The Campaign Signal-to-Strategy Pipeline" — domain object (Campaign Signal) + action (to-Strategy Pipeline)

═══ STRUCTURAL REQUIREMENTS ═══
1. Mechanism must have a clear structural name that satisfies ALL three naming rules above
2. Mechanism must have 3-5 concrete steps
3. Each step must connect to the "${primaryAxis}" axis
4. The mechanism promise must be specific and measurable
5. The mechanism problem must use audience language, not consultant language

═══ MECHANISM v2 — COMMERCIAL REASONING DEPTH (REQUIRED, depth like Persuasion v3 / Differentiation v8) ═══
Beyond the structural fields, every mechanism MUST justify itself commercially:
- "whyItWorks": one paragraph (60-120 words) explaining the BUYER PSYCHOLOGY this mechanism converts — do NOT restate the steps; explain why a real buyer changes belief/behavior because of it. Reference at least one [RC#] root cause or [BB#] barrier.
- "failureModes": 2-4 SPECIFIC counterfactual conditions under which this mechanism FAILS (audience type, market state, missing proof, wrong awareness stage). Be concrete; "if applied poorly" does NOT count.
- "causalChain": ordered array of 3-5 steps, each {"cause": "what buyer believes/experiences (cite [RC#]/[BB#])", "impact": "structural change the mechanism produces", "behavior": "buyer behavior that follows", "upstreamSignalRefs": ["[RC#]", "[BB#]" ...]}. This is the cause→impact→behavior chain.
- "commercialFunction": {"type": one of "trust_transfer"|"risk_reduction"|"identity_shift"|"perception_change"|"category_capture", "description": one sentence naming what commercial work this mechanism does}.
- "upstreamDependency": {"positioningHook": which positioning element this anchors on (axis/contrast/enemy text), "differentiationHook": which differentiation pillar/claim this anchors on}.
- "alternativeMechanisms": 1-2 mechanisms you considered but did NOT pick, each {"name", "whyAlternative": one sentence stating the trade-off and why the chosen primary is stronger}.

═══ OUTPUT FORMAT ═══
Respond with ONLY valid JSON, no markdown:
{
  "primary": {
    "name": "mechanism name",
    "type": "framework|system|protocol|method|architecture|engine|process",
    "description": "one-paragraph description emphasizing ${primaryAxis} — MUST contain verbatim AEL root cause and barrier language",
    "steps": ["step 1 addressing [RC#] cause", "step 2 following [CC#] chain", "step 3 resolving [BB#] barrier"],
    "promise": "specific measurable promise",
    "problem": "specific problem in audience language",
    "logic": "how the mechanism solves the problem through ${primaryAxis} — MUST include cause→impact→behavior chain language from AEL",
    "structuralFrame": "The [Name] Framework|System|Protocol",
    "axisEmphasis": ["keyword1", "keyword2", "keyword3"],
    "rootCauseUsed": "[RC#] identifier and exact deep cause text used",
    "barrierResolved": "[BB#] identifier and exact barrier text resolved",
    "anchorClaimIndex": 1,
    "whyItWorks": "60-120 word buyer-psychology explanation citing [RC#]/[BB#]",
    "failureModes": ["specific condition 1", "specific condition 2", "specific condition 3"],
    "causalChain": [
      { "cause": "buyer belief from [RC#] / [BB#]", "impact": "structural change", "behavior": "buyer behavior", "upstreamSignalRefs": ["[RC#]", "[BB#]"] },
      { "cause": "...", "impact": "...", "behavior": "...", "upstreamSignalRefs": ["..."] },
      { "cause": "...", "impact": "...", "behavior": "...", "upstreamSignalRefs": ["..."] }
    ],
    "commercialFunction": { "type": "trust_transfer|risk_reduction|identity_shift|perception_change|category_capture", "description": "one sentence" },
    "upstreamDependency": { "positioningHook": "axis/contrast/enemy text", "differentiationHook": "pillar/claim text" },
    "alternativeMechanisms": [
      { "name": "alt 1 name", "whyAlternative": "trade-off and why primary wins" }
    ]
  },
  "alternative": {
    "name": "alternative mechanism name",
    "type": "framework|system|protocol|method|architecture|engine|process",
    "description": "alternative approach still on ${primaryAxis} axis",
    "steps": ["step 1", "step 2", "step 3"],
    "promise": "specific measurable promise",
    "problem": "specific problem in audience language",
    "logic": "alternative logic through ${primaryAxis}",
    "structuralFrame": "The [Name] Framework|System|Protocol",
    "axisEmphasis": ["keyword1", "keyword2", "keyword3"],
    "rootCauseUsed": "[RC#] identifier and exact deep cause text used",
    "barrierResolved": "[BB#] identifier and exact barrier text resolved",
    "whyItWorks": "60-120 word buyer-psychology explanation",
    "failureModes": ["specific condition 1", "specific condition 2"],
    "causalChain": [
      { "cause": "...", "impact": "...", "behavior": "...", "upstreamSignalRefs": ["..."] }
    ],
    "commercialFunction": { "type": "trust_transfer|risk_reduction|identity_shift|perception_change|category_capture", "description": "one sentence" },
    "upstreamDependency": { "positioningHook": "...", "differentiationHook": "..." }
  },
  "groundingRefs": ["RC1"]
}`;

  const depthGateMaxAttempts = DEPTH_GATE_MAX_RETRIES + 1;
  const depthGateLog: string[] = [];
  let depthRejectionContext = "";

  for (let depthAttempt = 1; depthAttempt <= depthGateMaxAttempts; depthAttempt++) {
    if (depthAttempt > 1) {
      console.log(`[MechanismEngine] DEPTH_GATE: Regenerating attempt ${depthAttempt}/${depthGateMaxAttempts}`);
    }

    const fullPrompt = depthRejectionContext ? `${prompt}\n\n${depthRejectionContext}` : prompt;
    console.log(`[MechanismEngine] ANCHOR_EVIDENCE | engine=mechanism | site=first_prompt | attempt=${depthAttempt} | present=${mechAnchor ? "yes" : "no"} | source=${mechAnchorSource}`);

    try {
      let response = await aiChat({
        model: "gpt-4.1-mini",
        messages: [{ role: "user", content: fullPrompt }],
        max_tokens: 4000,
        temperature: 0.7,
      });

      let content = response?.choices?.[0]?.message?.content || "";
      let cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      let parsed = safeJsonParse(cleaned);

      if (!parsed || !parsed.primary) {
        const rawFinish1 = response?.choices?.[0]?.finish_reason;
        const finishReason1 = typeof rawFinish1 === "string" ? rawFinish1 : "unknown";
        const truncNote1 = finishReason1 === "length" ? " | OUTPUT_TRUNCATED (finish_reason=length — max_tokens exhausted before JSON closed)" : "";
        console.log(`[MechanismEngine] AI_PARSE_FAILED | finish_reason=${finishReason1} | contentChars=${content.length}${truncNote1} | attempting one-shot retry with strict JSON reinforcement`);
        diagnostics.parseRetryAttempted = true;
        diagnostics.firstFinishReason = finishReason1;
        const strictPrompt = `${fullPrompt}\n\n═══ STRICT OUTPUT FORMAT (PREVIOUS RESPONSE WAS UNPARSEABLE) ═══\nRespond with EXACTLY ONE valid JSON object and NOTHING else. No markdown, no preamble, no explanation. Start your response with "{" and end with "}". The top-level object MUST contain a "primary" key.`;
        response = await aiChat({
          model: "gpt-4.1-mini",
          messages: [{ role: "user", content: strictPrompt }],
          max_tokens: 4000,
          temperature: 0.3,
        });
        content = response?.choices?.[0]?.message?.content || "";
        cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
        parsed = safeJsonParse(cleaned);
      }

      if (!parsed || !parsed.primary) {
        const rawFinish2 = response?.choices?.[0]?.finish_reason;
        const finishReason2 = typeof rawFinish2 === "string" ? rawFinish2 : "unknown";
        const truncNote2 = finishReason2 === "length" ? " | OUTPUT_TRUNCATED (finish_reason=length — max_tokens still exhausted after retry)" : "";
        console.log(`[MechanismEngine] AI_PARSE_FAILED_AFTER_RETRY | finish_reason=${finishReason2} | contentChars=${content.length}${truncNote2} | falling back to differentiation core with deterministic axis="${primaryAxis}"`);
        diagnostics.aiFailed = true;
        diagnostics.parseRetryFailed = true;
        diagnostics.retryFinishReason = finishReason2;
        const fallbackMech = buildFallbackMechanism(diffCore, primaryAxis);
        const hasUsableFallback = !!(diffCore && diffCore.mechanismType !== "none" && diffCore.mechanismName);
        return {
          status: hasUsableFallback ? STATUS.COMPLETE : STATUS.FAILED,
          statusMessage: hasUsableFallback
            ? `AI generation unparseable — using differentiation-core fallback (axis="${primaryAxis}" propagated deterministically; confidence reduced)`
            : `AI generation unparseable and no differentiation-core fallback available (axis="${primaryAxis}" propagated deterministically)`,
          primaryMechanism: fallbackMech,
          alternativeMechanism: null,
          axisConsistency: {
            consistent: hasUsableFallback,
            primaryAxis,
            mechanismAxis: primaryAxis,
            failures: hasUsableFallback ? [] : ["AI generation failed and no differentiation-core fallback available"],
          },
          confidenceScore: hasUsableFallback ? 0.4 : 0.3,
          executionTimeMs: Date.now() - startTime,
          engineVersion: ENGINE_VERSION,
          diagnostics,
        };
      }

      const primaryMech = buildMechanismOutput(parsed.primary, primaryAxis, pillars);
      const altMech = parsed.alternative ? buildMechanismOutput(parsed.alternative, primaryAxis, pillars) : null;

      const aelRefs = [parsed.primary, parsed.alternative].filter(Boolean);
      const rcHits = aelRefs.filter((r: any) => r.rootCauseUsed && /\[RC\d+\]/.test(r.rootCauseUsed)).length;
      const bbHits = aelRefs.filter((r: any) => r.barrierResolved && /\[BB\d+\]/.test(r.barrierResolved)).length;
      console.log(`[MechanismEngine] AEL_GROUNDING_RESULT | mechanisms=${aelRefs.length} | rootCauseRefs=${rcHits}/${aelRefs.length} | barrierRefs=${bbHits}/${aelRefs.length}`);
      const mechGroundingRefs: string[] = Array.isArray(parsed.groundingRefs)
        ? parsed.groundingRefs.filter((r: any) => typeof r === "string" && r.trim().length > 0).map((r: string) => r.trim())
        : [];
      checkGroundingContract({
        engine: "mechanism",
        site: "primary_mechanism",
        groundingRefs: mechGroundingRefs,
        ael: analyticalEnrichment || null,
        accountId,
        attemptNumber: depthAttempt,
      });

      const nameValidation = validateMechanismName(primaryMech.mechanismName, positioning.domainVocab);
      if (!nameValidation.valid) {
        console.log(`[MechanismEngine] NAME_INVALID | reason="${nameValidation.reason}" | attempting name repair`);
        try {
          const nameRepairResponse = await aiChat({
            model: "gpt-4.1-mini",
            messages: [{ role: "user", content: `The mechanism name "${primaryMech.mechanismName}" is invalid because: ${nameValidation.reason}.

Rename it to satisfy ALL THREE requirements:
1. DOMAIN OBJECT: A noun specific to this business context: "${positioning.contrastAxis || primaryAxis}" with enemy: "${positioning.enemyDefinition || "unknown"}"
2. OPERATIONAL ACTION: One of: Diagnostic, Extraction, Audit, Pipeline, Conversion, Qualification, Validation, Assessment, Protocol, Mapping, Tracker
3. UNIQUE IDENTITY: Must reference the "${primaryAxis}" axis or the specific domain problem

Return ONLY the new mechanism name as a JSON object: {"name": "The [Domain Object] [Action] [Identity]"}` }],
            max_tokens: 100,
            temperature: 0.3,
            endpoint: "mechanism-name-repair",
            accountId,
          });
          const repairContent = nameRepairResponse?.choices?.[0]?.message?.content?.trim() || "";
          const repairCleaned = repairContent.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
          const repairParsed = safeJsonParse(repairCleaned);
          if (repairParsed?.name && typeof repairParsed.name === "string" && repairParsed.name.trim()) {
            console.log(`[MechanismEngine] NAME_REPAIRED | old="${primaryMech.mechanismName}" | new="${repairParsed.name.trim()}"`);
            primaryMech.mechanismName = repairParsed.name.trim();
            diagnostics.nameRepaired = true;
          }
        } catch (repairErr: any) {
          console.warn(`[MechanismEngine] NAME_REPAIR_FAILED | ${repairErr.message}`);
          diagnostics.nameRepairFailed = true;
        }
      } else {
        console.log(`[MechanismEngine] NAME_VALID | name="${primaryMech.mechanismName}"`);
      }
      diagnostics.nameValidation = nameValidation;

      const sanitizedPrimary = applySoftSanitization(primaryMech.mechanismDescription, []);
      if (sanitizedPrimary !== primaryMech.mechanismDescription) {
        primaryMech.mechanismDescription = sanitizedPrimary;
        diagnostics.primarySanitized = true;
      }

      const axisValidation = validateMechanismAxisAlignment(primaryMech, primaryAxis);
      diagnostics.axisValidation = axisValidation;

      if (!axisValidation.consistent && diffCore) {
        console.log(`[MechanismEngine] AXIS_MISMATCH | ${axisValidation.failures.join("; ")} — attempting correction`);
        primaryMech.axisAlignment.primaryAxis = primaryAxis;

        const emphasisFromDiff = extractAxisEmphasisFromCore(diffCore, primaryAxis);
        if (emphasisFromDiff.length > 0) {
          primaryMech.axisAlignment.axisEmphasis = [...new Set([...primaryMech.axisAlignment.axisEmphasis, ...emphasisFromDiff])];
        }
      }

      const finalValidation = validateMechanismAxisAlignment(primaryMech, primaryAxis);

      const celSourceTexts = [
        primaryMech.mechanismDescription,
        primaryMech.mechanismLogic,
        primaryMech.mechanismPromise,
        primaryMech.mechanismProblem,
        ...primaryMech.mechanismSteps,
      ];
      const celDepth = enforceEngineDepthCompliance(
        "mechanism",
        celSourceTexts,
        analyticalEnrichment || null,
      );
      diagnostics.celDepthCompliance = celDepth;

      if (analyticalEnrichment && isDepthBlocking(celDepth, celSourceTexts)) {
        depthGateLog.push(`Attempt ${depthAttempt}: BLOCKED (depthScore=${celDepth.causalDepthScore}, violations=${celDepth.violations.length})`);
        console.log(`[MechanismEngine] DEPTH_GATE: Attempt ${depthAttempt} BLOCKED | depthScore=${celDepth.causalDepthScore} | violations=${celDepth.violations.length}`);

        if (depthAttempt >= depthGateMaxAttempts) {
          const depthGateResult = buildDepthGateResult(celDepth, depthAttempt, depthGateMaxAttempts, depthGateLog, celSourceTexts);
          console.log(`[MechanismEngine] DEPTH_GATE: FINAL FAILURE after ${depthGateMaxAttempts} attempts — returning DEPTH_FAILED`);
          return {
            status: "DEPTH_FAILED",
            statusMessage: `Depth gate failed after ${depthGateMaxAttempts} attempts: depthScore=${celDepth.causalDepthScore}`,
            primaryMechanism: primaryMech,
            alternativeMechanism: altMech,
            axisConsistency: { consistent: false, primaryAxis, mechanismAxis: primaryMech.axisAlignment.primaryAxis, failures: ["DEPTH_FAILED"] },
            confidenceScore: 0,
            executionTimeMs: Date.now() - startTime,
            engineVersion: ENGINE_VERSION,
            diagnostics: { ...diagnostics, depthGate: depthGateResult },
            celDepthCompliance: celDepth,
            depthGateResult,
          };
        }

        depthRejectionContext = buildDepthRejectionDirective(celDepth, depthAttempt);
        continue;
      }

      depthGateLog.push(`Attempt ${depthAttempt}: PASSED (depthScore=${celDepth.causalDepthScore})`);
      if (celDepth.violations.length > 0) {
        for (const logEntry of celDepth.enforcementLog) {
          console.log(`[MechanismEngine] CEL_DEPTH: ${logEntry}`);
        }
      } else {
        console.log(`[MechanismEngine] CEL_DEPTH: CLEAN | depthScore=${celDepth.causalDepthScore} | rootCauseRefs=${celDepth.rootCauseReferences}`);
      }

      const rawConfidence = computeConfidence(primaryMech, primaryAxis, pillars, finalValidation.consistent);
      const depthPenaltyFactor = celDepth.passed ? 1.0 : Math.max(0.5, celDepth.score);
      const rawLLMConfidence = clamp(rawConfidence * depthPenaltyFactor);

      // Mechanism evaluates the quality of ITS OWN output only.
      // Upstream engines (positioning, differentiation) may be weak — that is
      // represented via lineage, CEL, grounding, and hard validation guards,
      // NOT by numerically capping this engine's self-assessment.
      // The former inherited-confidence ceiling (min(pos,diff)+0.05) has been
      // removed because it conflated positioning territory-ranking maturity
      // scores with mechanism structural quality — structurally incomparable
      // metrics that produced a false CONFIDENCE_SPREAD_EXCESSIVE boot-strap
      // deadlock on every first real campaign run.
      const confidence = rawLLMConfidence;
      const inheritedConfidence = rawLLMConfidence; // retained for audit trail only — no longer a cap
      const confidencePenalty = 0;                  // retained for audit trail only

      const depthGateResult = buildDepthGateResult(celDepth, depthAttempt, depthGateMaxAttempts, depthGateLog, celSourceTexts);

      // T002 v2: collect alternativeMechanisms surfaced by the LLM for audit
      const altMechanismsRaw = Array.isArray(parsed.primary?.alternativeMechanisms)
        ? parsed.primary.alternativeMechanisms
        : [];
      const alternativeMechanisms = altMechanismsRaw
        .filter((a: any) => a && typeof a === "object" && a.name)
        .map((a: any) => ({
          name: String(a.name),
          whyAlternative: String(a.whyAlternative || ""),
        }))
        .slice(0, 3);

      console.log(`[MechanismEngine-v2] COMPLETE | mechanism="${primaryMech.mechanismName}" | axis=${primaryAxis} | consistent=${finalValidation.consistent} | rawConf=${rawLLMConfidence.toFixed(2)} | finalConf=${confidence.toFixed(2)} | depthScore=${celDepth.causalDepthScore} | depthAttempts=${depthAttempt} | hasWhyItWorks=${!!primaryMech.whyItWorks} | failureModes=${(primaryMech.failureModes || []).length} | causalChainSteps=${(primaryMech.causalChain || []).length}`);

      return {
        status: finalValidation.consistent ? STATUS.COMPLETE : STATUS.AXIS_REJECTED,
        statusMessage: finalValidation.consistent ? null : `Mechanism axis mismatch: ${finalValidation.failures.join("; ")}`,
        primaryMechanism: primaryMech,
        alternativeMechanism: altMech,
        axisConsistency: {
          consistent: finalValidation.consistent,
          primaryAxis,
          mechanismAxis: primaryMech.axisAlignment.primaryAxis,
          failures: finalValidation.failures,
        },
        confidenceScore: confidence,
        executionTimeMs: Date.now() - startTime,
        engineVersion: ENGINE_VERSION,
        diagnostics: { ...diagnostics, depthGate: depthGateResult },
        celDepthCompliance: celDepth,
        depthGateResult,
        // v2 audit trail
        inheritedConfidence,
        rawLLMConfidence,
        confidencePenalty,
        alternativeMechanisms,
      };
    } catch (error: any) {
      console.error(`[MechanismEngine] ERROR | ${error.message}`);
      if (depthAttempt < depthGateMaxAttempts) {
        depthGateLog.push(`Attempt ${depthAttempt}: ERROR (${error.message})`);
        continue;
      }
      return {
        status: STATUS.FAILED,
      statusMessage: `Mechanism generation failed: ${error.message}`,
      primaryMechanism: buildFallbackMechanism(diffCore, primaryAxis),
      alternativeMechanism: null,
      axisConsistency: { consistent: false, primaryAxis, mechanismAxis: primaryAxis, failures: [error.message] },
      confidenceScore: 0.2,
      executionTimeMs: Date.now() - startTime,
      engineVersion: ENGINE_VERSION,
      diagnostics: { ...diagnostics, error: error.message },
    };
    }
  }

  return {
    status: STATUS.FAILED,
    statusMessage: "Mechanism generation failed after all depth gate attempts",
    primaryMechanism: buildFallbackMechanism(diffCore, primaryAxis),
    alternativeMechanism: null,
    axisConsistency: { consistent: false, primaryAxis, mechanismAxis: primaryAxis, failures: ["All attempts failed"] },
    confidenceScore: 0,
    executionTimeMs: Date.now() - startTime,
    engineVersion: ENGINE_VERSION,
    diagnostics,
  };
}

function buildMechanismOutput(raw: any, primaryAxis: string, pillars: any[]): MechanismOutput {
  const topPillar = pillars.length > 0 ? (pillars[0].name || pillars[0].territory || "core pillar") : "core pillar";

  // T002 v2: parse new commercial-reasoning fields
  const validFunctions = new Set(["trust_transfer", "risk_reduction", "identity_shift", "perception_change", "category_capture"]);
  const cf = raw.commercialFunction;
  const commercialFunction = (cf && typeof cf === "object" && validFunctions.has(cf.type))
    ? { type: cf.type, description: typeof cf.description === "string" ? cf.description : "" }
    : undefined;

  const causalChain = Array.isArray(raw.causalChain)
    ? raw.causalChain
        .filter((s: any) => s && typeof s === "object" && (s.cause || s.impact || s.behavior))
        .map((s: any) => ({
          cause: String(s.cause || ""),
          impact: String(s.impact || ""),
          behavior: String(s.behavior || ""),
          upstreamSignalRefs: Array.isArray(s.upstreamSignalRefs) ? s.upstreamSignalRefs.map(String) : [],
        }))
    : undefined;

  const failureModes = Array.isArray(raw.failureModes)
    ? raw.failureModes.filter((f: any) => typeof f === "string" && f.trim().length > 0).slice(0, 6)
    : undefined;

  const upstream = raw.upstreamDependency;
  const upstreamDependency = (upstream && typeof upstream === "object")
    ? {
        positioningHook: String(upstream.positioningHook || ""),
        differentiationHook: String(upstream.differentiationHook || ""),
      }
    : undefined;

  const whyItWorks = typeof raw.whyItWorks === "string" && raw.whyItWorks.trim().length > 0
    ? raw.whyItWorks.trim()
    : undefined;

  return {
    mechanismName: raw.name || "Unnamed Mechanism",
    mechanismType: raw.type || "system",
    mechanismDescription: raw.description || "",
    mechanismSteps: Array.isArray(raw.steps) ? raw.steps : [],
    mechanismPromise: raw.promise || "",
    mechanismProblem: raw.problem || "",
    mechanismLogic: raw.logic || "",
    axisAlignment: {
      primaryAxis,
      axisEmphasis: Array.isArray(raw.axisEmphasis) ? raw.axisEmphasis : [],
      axisConfidence: 0.7,
    },
    structuralFrame: raw.structuralFrame || `The ${raw.name || "Core"} System`,
    differentiationLink: `Mechanism anchored to ${topPillar} via ${primaryAxis} axis`,
    whyItWorks,
    failureModes,
    causalChain,
    commercialFunction,
    upstreamDependency,
  };
}

function buildFallbackMechanism(diffCore: any, primaryAxis: string): MechanismOutput {
  if (diffCore && diffCore.mechanismType !== "none") {
    return {
      mechanismName: diffCore.mechanismName,
      mechanismType: diffCore.mechanismType,
      mechanismDescription: diffCore.mechanismLogic || diffCore.mechanismPromise || "",
      mechanismSteps: diffCore.mechanismSteps || [],
      mechanismPromise: diffCore.mechanismPromise || "",
      mechanismProblem: diffCore.mechanismProblem || "",
      mechanismLogic: diffCore.mechanismLogic || "",
      axisAlignment: {
        primaryAxis,
        axisEmphasis: [],
        axisConfidence: 0.3,
      },
      structuralFrame: `The ${diffCore.mechanismName} ${diffCore.mechanismType === "framework" ? "Framework" : "System"}`,
      differentiationLink: "Fallback from Differentiation Engine — not axis-validated",
    };
  }

  return {
    mechanismName: "Pending Mechanism",
    mechanismType: "system",
    mechanismDescription: "Mechanism awaiting generation — insufficient upstream data",
    mechanismSteps: [],
    mechanismPromise: "",
    mechanismProblem: "",
    mechanismLogic: "",
    axisAlignment: {
      primaryAxis,
      axisEmphasis: [],
      axisConfidence: 0,
    },
    structuralFrame: "Pending",
    differentiationLink: "No mechanism generated",
  };
}

function extractAxisEmphasisFromCore(diffCore: any, axis: string): string[] {
  const guidance = getAxisGuidance(axis);
  const coreText = `${diffCore.mechanismName} ${diffCore.mechanismLogic} ${diffCore.mechanismPromise} ${diffCore.mechanismProblem}`.toLowerCase();
  return guidance.emphasis.filter(e => coreText.includes(e.toLowerCase()));
}

const MECHANISM_GENERIC_NAMES = [
  "clarity system", "growth engine", "simplicity framework", "transformation protocol",
  "success system", "results framework", "impact engine", "clarity framework",
  "growth framework", "performance system", "excellence engine", "solution framework",
];

const MECHANISM_OPERATION_WORDS = [
  "diagnostic", "extraction", "repair", "conversion", "audit", "compression",
  "qualification", "validation", "pipeline", "protocol", "assessment", "mapping",
  "acquisition", "activation", "detection", "optimization", "analysis", "tracker",
];

function validateMechanismName(name: string, domainVocab?: string): { valid: boolean; reason?: string } {
  if (!name || name === "Unnamed Mechanism" || name === "Pending Mechanism") {
    return { valid: false, reason: "Name is empty or placeholder" };
  }
  const lower = name.toLowerCase().replace(/^the\s+/, "");
  const isGeneric = MECHANISM_GENERIC_NAMES.some(g => lower === g || lower.startsWith(g));
  if (isGeneric) {
    return { valid: false, reason: `Name "${name}" is domain-agnostic — matches generic pattern` };
  }
  const hasOperationWord = MECHANISM_OPERATION_WORDS.some(w => lower.includes(w));
  if (!hasOperationWord) {
    return { valid: false, reason: `Name "${name}" lacks an operational action word` };
  }
  if (domainVocab) {
    const domainWords = domainVocab.toLowerCase().split(/\s+/).filter(w => w.length >= 4);
    const hasDomainWord = domainWords.some(dw => lower.includes(dw));
    if (!hasDomainWord && domainWords.length >= 3) {
      return { valid: false, reason: `Name "${name}" has no domain-specific vocabulary from positioning context` };
    }
  }
  return { valid: true };
}

function computeConfidence(
  mechanism: MechanismOutput,
  primaryAxis: string,
  pillars: any[],
  axisConsistent: boolean,
): number {
  let score = 0.5;

  if (axisConsistent) score += 0.2;
  if (mechanism.mechanismSteps.length >= 3) score += 0.1;
  if (mechanism.mechanismSteps.length >= 5) score += 0.05;
  if (mechanism.mechanismName && mechanism.mechanismName !== "Unnamed Mechanism") score += 0.05;
  if (mechanism.structuralFrame && !mechanism.structuralFrame.includes("Pending")) score += 0.05;
  if (mechanism.axisAlignment.axisEmphasis.length > 0) score += 0.05;

  const pillarNames = pillars.map((p: any) => (p.name || "").toLowerCase());
  const mechText = mechanism.mechanismDescription.toLowerCase();
  const pillarAlignment = pillarNames.filter(n => mechText.includes(n)).length;
  score += clamp(pillarAlignment * 0.03, 0, 0.1);

  return clamp(score);
}
