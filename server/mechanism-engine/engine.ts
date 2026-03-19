import { aiChat } from "../ai-client";
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
  try { return JSON.parse(text); } catch { return null; }
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
      axisConsistency: { consistent: false, primaryAxis, mechanismAxis: "none", failures: ["Insufficient positioning data"] },
      confidenceScore: 0.2,
      executionTimeMs: Date.now() - startTime,
      engineVersion: ENGINE_VERSION,
      diagnostics,
    };
  }

  const aelBlock = formatAELForPrompt(analyticalEnrichment || null);
  const causalDirective = buildCausalDirectiveForPrompt(analyticalEnrichment || null);
  if (aelBlock.length > 0) {
    console.log(`[MechanismEngine] AEL_INJECTED | enrichmentSize=${aelBlock.length}chars`);
  }

  const pillarSummary = pillars.slice(0, 5).map((p: any) => `"${p.name || p.territory}": ${p.description || ""}`.slice(0, 120)).join("\n");
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

${aelBlock ? `═══ ANALYTICAL ENRICHMENT LAYER (CAUSAL FOUNDATION — MANDATORY) ═══
${aelBlock}

${causalDirective}

Your mechanism MUST derive from the root causes and causal chains above. Every step in the mechanism must address a real behavioral barrier or causal factor. Do NOT invent steps that aren't grounded in the analysis.
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

═══ OUTPUT FORMAT ═══
Respond with ONLY valid JSON, no markdown:
{
  "primary": {
    "name": "mechanism name",
    "type": "framework|system|protocol|method|architecture|engine|process",
    "description": "one-paragraph description emphasizing ${primaryAxis}",
    "steps": ["step 1", "step 2", "step 3"],
    "promise": "specific measurable promise",
    "problem": "specific problem in audience language",
    "logic": "how the mechanism solves the problem through ${primaryAxis}",
    "structuralFrame": "The [Name] Framework|System|Protocol",
    "axisEmphasis": ["keyword1", "keyword2", "keyword3"]
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
    "axisEmphasis": ["keyword1", "keyword2", "keyword3"]
  }
}`;

  const depthGateMaxAttempts = DEPTH_GATE_MAX_RETRIES + 1;
  const depthGateLog: string[] = [];
  let depthRejectionContext = "";

  for (let depthAttempt = 1; depthAttempt <= depthGateMaxAttempts; depthAttempt++) {
    if (depthAttempt > 1) {
      console.log(`[MechanismEngine] DEPTH_GATE: Regenerating attempt ${depthAttempt}/${depthGateMaxAttempts}`);
    }

    const fullPrompt = depthRejectionContext ? `${prompt}\n\n${depthRejectionContext}` : prompt;

    try {
      const response = await aiChat({
        model: "gpt-4.1-mini",
        messages: [{ role: "user", content: fullPrompt }],
        max_tokens: 2000,
        temperature: 0.7,
      });

      const content = response?.choices?.[0]?.message?.content || "";
      const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const parsed = safeJsonParse(cleaned);

      if (!parsed || !parsed.primary) {
        console.log(`[MechanismEngine] AI_PARSE_FAILED | falling back to differentiation core`);
        diagnostics.aiFailed = true;
        return {
          status: STATUS.FAILED,
          statusMessage: "Failed to parse AI mechanism generation response",
          primaryMechanism: buildFallbackMechanism(diffCore, primaryAxis),
          alternativeMechanism: null,
          axisConsistency: { consistent: false, primaryAxis, mechanismAxis: "unknown", failures: ["AI generation failed"] },
          confidenceScore: 0.3,
          executionTimeMs: Date.now() - startTime,
          engineVersion: ENGINE_VERSION,
          diagnostics,
        };
      }

      const primaryMech = buildMechanismOutput(parsed.primary, primaryAxis, pillars);
      const altMech = parsed.alternative ? buildMechanismOutput(parsed.alternative, primaryAxis, pillars) : null;

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

      const celDepth = enforceEngineDepthCompliance(
        "mechanism",
        [
          primaryMech.mechanismDescription,
          primaryMech.mechanismLogic,
          primaryMech.mechanismPromise,
          primaryMech.mechanismProblem,
          ...primaryMech.mechanismSteps,
        ],
        analyticalEnrichment || null,
      );
      diagnostics.celDepthCompliance = celDepth;

      if (analyticalEnrichment && isDepthBlocking(celDepth)) {
        depthGateLog.push(`Attempt ${depthAttempt}: BLOCKED (depthScore=${celDepth.causalDepthScore}, violations=${celDepth.violations.length})`);
        console.log(`[MechanismEngine] DEPTH_GATE: Attempt ${depthAttempt} BLOCKED | depthScore=${celDepth.causalDepthScore} | violations=${celDepth.violations.length}`);

        if (depthAttempt >= depthGateMaxAttempts) {
          const depthGateResult = buildDepthGateResult(celDepth, depthAttempt, depthGateMaxAttempts, depthGateLog);
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
      const confidence = clamp(rawConfidence * depthPenaltyFactor);
      const depthGateResult = buildDepthGateResult(celDepth, depthAttempt, depthGateMaxAttempts, depthGateLog);

      console.log(`[MechanismEngine] COMPLETE | mechanism="${primaryMech.mechanismName}" | axis=${primaryAxis} | consistent=${finalValidation.consistent} | confidence=${confidence.toFixed(2)} | depthScore=${celDepth.causalDepthScore} | depthAttempts=${depthAttempt}`);

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
      axisConsistency: { consistent: false, primaryAxis, mechanismAxis: "fallback", failures: [error.message] },
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
    axisConsistency: { consistent: false, primaryAxis, mechanismAxis: "unknown", failures: ["All attempts failed"] },
    confidenceScore: 0,
    executionTimeMs: Date.now() - startTime,
    engineVersion: ENGINE_VERSION,
    diagnostics,
  };
}

function buildMechanismOutput(raw: any, primaryAxis: string, pillars: any[]): MechanismOutput {
  const topPillar = pillars.length > 0 ? (pillars[0].name || pillars[0].territory || "core pillar") : "core pillar";
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
