// @ts-nocheck
import { deriveValidatedCapabilities, ValidatedCapability } from "../shared/capability-registry";
import { validateAuthorityBoundaries } from "../shared/authority-validator";
import { evaluateClaimSemanticEntailment } from "../shared/claim-entailment";
import {
  computeProductTruthFingerprint,
  verifyProductTruthSnapshotLineage,
  type ProductTruthFactItem,
} from "../shared/product-dna";
import { aiChat, classifyAIError, type AIErrorCategory } from "../ai-client";
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
import { formatAELForPrompt, filterAELForStrategicUse } from "../analytical-enrichment-layer/engine";
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
  MechanismAuthorityRole,
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
    emphasis: ["unique approach", "distinct methodology", "practical process"],
    banned: ["generic", "standard", "typical"],
  };
}

export type MechanismSemanticRoleClaimType =
  | "VERIFIED_EXISTING_CAPABILITY"
  | "EXISTING_FACTUAL_CLAIM"
  | "SUPPORTED_FACTUAL_STATEMENT"
  | "REASONABLE_DESCRIPTIVE_SYNTHESIS"
  | "BOUNDED_INTERPRETATION"
  | "STRATEGIC_COMBINATION"
  | "STRATEGIC_SYNTHESIS"
  | "PROPOSED_EXECUTION"
  | "UNSUPPORTED_MATERIAL_ASSERTION"
  | "UNSUPPORTED_EXISTING_PROCESS";

export interface MechanismOperationalClaim {
  claim: string;
  role: MechanismSemanticRoleClaimType;
  supportedByCapability?: string | null;
  capabilityRef?: string | null;
}

export interface EmbeddedMechanismFactualPredicate {
  predicate: string;
  category: "MATERIAL_COMPOSITION" | "PHYSICAL_PERFORMANCE" | "OPERATIONAL_PROCESS" | "SKU_OR_COMMERCIAL" | "OTHER";
  evaluationKind?:
    | "SUPPORTED_FACTUAL_STATEMENT"
    | "REASONABLE_DESCRIPTIVE_SYNTHESIS"
    | "BOUNDED_INTERPRETATION"
    | "UNSUPPORTED_MATERIAL_ASSERTION";
  isSupported: boolean;
  supportedByCapability?: string | null;
  reasonIfNotSupported?: string;
}

export interface MechanismSemanticRoleJudgeResult {
  verdict: "APPROVE" | "REPAIR" | "BLOCK" | "NOT_EVALUATED";
  axisVerdict: "ALIGNED" | "MISALIGNED" | "NOT_EVALUATED";
  axisReason?: string;
  reasons: string[];
  failureType:
    | "POSITIONING_REWRITTEN"
    | "DIFFERENTIATION_REWRITTEN"
    | "MARKETING_COMMUNICATION"
    | "NOT_A_HOW_EXPLANATION"
    | "AXIS_MISALIGNED"
    | "UNSUPPORTED_CAPABILITIES"
    | "PHYSICAL_ATTRIBUTE_UPGRADE"
    | "OPERATIONAL_CAPABILITY_UPGRADE"
    | "JUDGE_UNAVAILABLE"
    | "NONE";
  errorCategory?: AIErrorCategory;
  feedback?: string;
  operationalClaims?: MechanismOperationalClaim[];
  embeddedFactualPredicates?: EmbeddedMechanismFactualPredicate[];
  unsupportedPredicates?: string[];
  mechanismAuthorityRole?: MechanismAuthorityRole;
  mechanismRoleVerdict?: "VALID_HOW" | "INVALID_ROLE" | "NOT_EVALUATED";
  factualPostureVerdict?: "FACTUALLY_GROUNDED" | "UNSUPPORTED_FACTUAL_CLAIM" | "NOT_EVALUATED";
  productTruthSnapshotId?: string;
  productTruthFingerprint?: string;
}

/**
 * Semantic Role & Practical Factual Posture Judge for Mechanism Engine.
 * Evaluates whether a Mechanism candidate is a commercially useful "HOW" explanation
 * separated from Positioning (WHERE) and Differentiation (WHY), and verifies that its
 * factual posture is grounded in the shared canonical Product Truth inventory without
 * demanding verbatim copying, proprietary technology, formal QA labs, or total guarantees.
 */
export async function judgeMechanismSemanticRole(input: {
  candidate: {
    name: string;
    description: string;
    steps: string[];
    logic: string;
    promise?: string;
    problem?: string;
    mechanismAuthorityRole?: MechanismAuthorityRole;
  };
  positioning: {
    primaryAxis: string;
    contrastAxis?: string;
    enemyDefinition?: string;
    territoryName?: string;
  };
  productTruthCapabilities?: string[];
  capabilities?: ValidatedCapability[];
  productTruthFacts?: ProductTruthFactItem[];
  productTruthSnapshotId?: string;
  productTruthSnapshotFingerprint?: string;
  previouslyAcceptedClaims?: string[];
  businessContext?: {
    businessType?: string;
    coreOffer?: string;
  };
  accountId?: string;
}): Promise<MechanismSemanticRoleJudgeResult> {
  const richCaps: Array<{
    capabilityId?: string;
    factId?: string;
    factType?: string;
    status?: string;
    statement: string;
    scope?: string;
    qualifications?: string[];
  }> = [];

  if (Array.isArray(input.capabilities) && input.capabilities.length > 0) {
    for (const c of input.capabilities) {
      if (!c || !c.statement) continue;
      richCaps.push({
        capabilityId: c.capabilityId,
        factId: c.sourceFactId,
        factType: c.factType || "CAPABILITY",
        status: c.verificationStatus || "VERIFIED",
        statement: c.statement,
        scope: c.scope,
        qualifications: c.qualifications,
      });
    }
  } else if (Array.isArray(input.productTruthFacts) && input.productTruthFacts.length > 0) {
    for (const f of input.productTruthFacts) {
      if (!f || !f.statement) continue;
      richCaps.push({
        factId: f.productTruthFactId || f.id,
        factType: f.factType || "CAPABILITY",
        status: f.status || "VERIFIED",
        statement: f.statement,
        scope: f.scope,
        qualifications: f.qualifications,
      });
    }
  } else if (Array.isArray(input.productTruthCapabilities) && input.productTruthCapabilities.length > 0) {
    input.productTruthCapabilities.forEach((stmt, idx) => {
      if (typeof stmt === "string" && stmt.trim()) {
        richCaps.push({
          factId: `fact_${idx + 1}`,
          factType: "CAPABILITY",
          status: "VERIFIED",
          statement: stmt.trim(),
        });
      }
    });
  }

  const capsList = richCaps.length > 0
    ? richCaps
        .map((c, i) => {
          const idPart = [
            c.capabilityId ? `id=${c.capabilityId}` : "",
            c.factId ? `factId=${c.factId}` : "",
            `type=${c.factType || "CAPABILITY"}`,
            c.status ? `status=${c.status}` : "",
          ]
            .filter(Boolean)
            .join(", ");
          const scopePart = c.scope ? ` [scope: ${c.scope}]` : "";
          const qualPart = Array.isArray(c.qualifications) && c.qualifications.length > 0
            ? ` [qualifications: ${c.qualifications.join("; ")}]`
            : "";
          return `${i + 1}. (${idPart})${scopePart}${qualPart} ${c.statement}`;
        })
        .join("\n")
    : "None documented in Product Truth";

  const acceptedLockBlock = Array.isArray(input.previouslyAcceptedClaims) && input.previouslyAcceptedClaims.length > 0
    ? `\n════ PREVIOUSLY ACCEPTED CLAIMS (DO NOT RE-REJECT UNCHANGED SUPPORTED CONTENT) ════\nThe following claims/predicates already passed evaluation in Round 1 and must remain accepted if unchanged:\n${input.previouslyAcceptedClaims.map((c, i) => `- [PASSED_${i + 1}] ${c}`).join("\n")}\n`
    : "";

  const judgePrompt = `You are a Semantic Role & Practical Factual Posture Judge for a commercial marketing strategy engine.
Your mission is to evaluate whether the candidate Mechanism is a commercially useful "HOW" explanation grounded in the canonical Product Truth inventory (which includes CAPABILITY, QUALITY, OPERATIONAL, PROOF, OFFER, DELIVERY_MECHANISM, PRICING_FACT, and USE_CASE facts).

════ 1. PRACTICAL MECHANISM STANDARD (HOW vs WHERE vs WHY) ════
- A valid Mechanism explains HOW the product, ingredients, production steps, product configuration/assortment, packaging, or service/shipping delivery work together to address a customer concern.
- A valid Mechanism does NOT need:
  * A proprietary invention or patented process.
  * A laboratory or formal QA inspection protocol.
  * A quantified performance improvement.
  * A guarantee eliminating the entire customer pain.
  * Defensible competitive exclusivity ("how the product works" is separate from "competitors cannot do this").
  * Artificial "Engine", "System", or "Framework" terminology.
- Do NOT reject an ordinary, commercially useful explanation built from verified product facts merely because it describes ordinary ingredients, daily preparation, assortment structure, hygienic packaging, or shipping workflows.
- Only reject for role failure if the candidate is purely:
  * "POSITIONING_REWRITTEN": Pure market territory or whitespace label with no explanation of how the product/service works.
  * "DIFFERENTIATION_REWRITTEN": Pure competitive superiority boast without explaining how the offering works.
  * "MARKETING_COMMUNICATION": Advertising/media buying advice instead of product/service mechanism.
  * "NOT_A_HOW_EXPLANATION": Empty slogan with no product, ingredient, configuration, or service explanation.

════ 2. FOUR-CATEGORY CLAIM EVALUATION (DISTINGUISH SYNTHESIS FROM INVENTION) ════
Evaluate every claim/predicate in the candidate using these four categories:
1. "SUPPORTED_FACTUAL_STATEMENT" (or "EXISTING_FACTUAL_CLAIM"):
   - Direct statement or faithful paraphrase of one or more verified Product Truth facts (any factType: CAPABILITY, QUALITY, OPERATIONAL, PROOF, OFFER, etc.).
   - Set isSupported: true and cite the supporting capabilityId/factId/statement.
2. "REASONABLE_DESCRIPTIVE_SYNTHESIS":
   - Natural descriptive language or a coherent combination of complementary verified facts that introduces no material new promise.
   - ACCEPT these examples as isSupported: true:
     * A verified mixed box containing seven varieties described as a "varied assortment" or "curated assortment" (provided it does not claim an unverified expert-selection committee or lab protocol).
     * Verified daily production and hygienic packaging combined to describe the production-and-packaging approach.
     * Verified ingredient choices (e.g. 100% pure animal ghee, premium pistachios, free of preservatives and artificial colors) explaining the product's approach to flavor and composition without requiring a separate authenticity certification.
3. "BOUNDED_INTERPRETATION":
   - Bounded explanation of how verified attributes address part of a buyer concern without claiming a stronger guarantee that the candidate never claimed. Partial relevance is acceptable when the limitation is clear.
   - Set isSupported: true.
4. "UNSUPPORTED_MATERIAL_ASSERTION":
   - Genuinely invented material claims not supported by Product Truth. Set isSupported: false!
   - REJECT these examples as isSupported: false:
     * Turning verified "same-day shipping" into "same-day delivery" (shipping dispatch vs arrival delivery are materially distinct).
     * Unsupported mold-prevention, shelf-life extension, or freshness-preservation performance guarantees not in Product Truth.
     * Invented laboratories, formal QA inspection protocols, light-box testing, or unverified third-party certifications.
     * Physical attribute upgrades (e.g. upgrading "comfort" or "premium fabrics" into "breathable", "cooling", or "opaque/non-sheer" guarantees).

════ 3. MECHANISM AUTHORITY ROLE ════
Classify the candidate mechanism into one of three authority roles:
- "STRATEGIC_SYNTHESIS": Coherent synthesis or combination of verified product attributes, ingredients, assortment configuration, production steps, or service facts.
- "VERIFIED_EXISTING_PROCESS": Backed directly by verified operational/production facts in Product Truth.
- "PROPOSED_EXECUTION": Explicit future recommendation framed as a proposal.

════ 4. POSITIONING CONTRAST AXIS ALIGNMENT ════
- ALIGNED: The mechanism plausibly supports or reinforces the positioning primary axis ("${input.positioning.primaryAxis}") or contrast axis ("${input.positioning.contrastAxis || input.positioning.primaryAxis}").
- MISALIGNED: Only mark MISALIGNED if the mechanism directly contradicts the positioning axis.
${acceptedLockBlock}
CANONICAL PRODUCT TRUTH INVENTORY (Snapshot=${input.productTruthSnapshotId || "canonical"}, Fingerprint=${input.productTruthSnapshotFingerprint || "n/a"}):
${capsList}

CANDIDATE TO REVIEW:
Name: "${input.candidate.name}"
Role: "${input.candidate.mechanismAuthorityRole || "unspecified"}"
Description: "${input.candidate.description}"
Steps: ${JSON.stringify(input.candidate.steps)}
Logic: "${input.candidate.logic}"
Promise: "${input.candidate.promise || ""}"
Problem: "${input.candidate.problem || ""}"

POSITIONING CONTEXT:
Primary Axis: "${input.positioning.primaryAxis}"
Contrast Axis: "${input.positioning.contrastAxis || "n/a"}"
Enemy: "${input.positioning.enemyDefinition || "n/a"}"

Respond with ONLY valid JSON:
{
  "verdict": "APPROVE" | "REPAIR" | "BLOCK",
  "mechanismRoleVerdict": "VALID_HOW" | "INVALID_ROLE",
  "factualPostureVerdict": "FACTUALLY_GROUNDED" | "UNSUPPORTED_FACTUAL_CLAIM",
  "mechanismAuthorityRole": "STRATEGIC_SYNTHESIS" | "VERIFIED_EXISTING_PROCESS" | "PROPOSED_EXECUTION",
  "axisVerdict": "ALIGNED" | "MISALIGNED",
  "axisReason": "Concise explanation of contrast axis consistency",
  "reasons": ["Specific justification for verdict"],
  "failureType": "NONE" | "POSITIONING_REWRITTEN" | "DIFFERENTIATION_REWRITTEN" | "MARKETING_COMMUNICATION" | "NOT_A_HOW_EXPLANATION" | "AXIS_MISALIGNED" | "UNSUPPORTED_CAPABILITIES" | "PHYSICAL_ATTRIBUTE_UPGRADE" | "OPERATIONAL_CAPABILITY_UPGRADE",
  "feedback": "Actionable guidance for targeted repair if needed",
  "embeddedFactualPredicates": [
    {
      "predicate": "phrase from candidate",
      "category": "MATERIAL_COMPOSITION" | "PHYSICAL_PERFORMANCE" | "OPERATIONAL_PROCESS" | "SKU_OR_COMMERCIAL" | "OTHER",
      "evaluationKind": "SUPPORTED_FACTUAL_STATEMENT" | "REASONABLE_DESCRIPTIVE_SYNTHESIS" | "BOUNDED_INTERPRETATION" | "UNSUPPORTED_MATERIAL_ASSERTION",
      "isSupported": true | false,
      "supportedByCapability": "cap_xxx or factId or statement, or null for synthesis/unsupported",
      "reasonIfNotSupported": "why not supported (only when isSupported is false)"
    }
  ],
  "unsupportedPredicates": ["exact unsupported phrases only"],
  "operationalClaims": [
    {
      "claim": "statement extracted from candidate",
      "role": "SUPPORTED_FACTUAL_STATEMENT" | "EXISTING_FACTUAL_CLAIM" | "REASONABLE_DESCRIPTIVE_SYNTHESIS" | "BOUNDED_INTERPRETATION" | "STRATEGIC_SYNTHESIS" | "PROPOSED_EXECUTION" | "UNSUPPORTED_MATERIAL_ASSERTION",
      "supportedByCapability": "cap_xxx or factId or statement, or null"
    }
  ]
}`;

  try {
    const resp = await aiChat({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: judgePrompt }],
      max_tokens: 1500,
      temperature: 0.1,
      response_format: { type: "json_object" },
      accountId: input.accountId,
    });

    const parsed = safeJsonParse(resp?.choices?.[0]?.message?.content || "{}");
    if (parsed && (parsed.verdict === "APPROVE" || parsed.verdict === "REPAIR" || parsed.verdict === "BLOCK")) {
      const previouslyAcceptedNorm = new Set(
        (input.previouslyAcceptedClaims || []).map((s) =>
          String(s || "").toLowerCase().replace(/\s+/g, " ").trim()
        ).filter(Boolean)
      );

      const embeddedFactualPredicates: EmbeddedMechanismFactualPredicate[] = Array.isArray(parsed.embeddedFactualPredicates)
        ? parsed.embeddedFactualPredicates.map((p: any) => {
            const predNorm = String(p?.predicate || "").toLowerCase().replace(/\s+/g, " ").trim();
            const wasPreviouslyAccepted = predNorm.length > 0 && previouslyAcceptedNorm.has(predNorm);
            const isSupported = wasPreviouslyAccepted ? true : Boolean(p?.isSupported);
            return {
              predicate: String(p?.predicate || ""),
              category: p?.category || "OTHER",
              evaluationKind: p?.evaluationKind || (isSupported ? (p?.supportedByCapability ? "SUPPORTED_FACTUAL_STATEMENT" : "REASONABLE_DESCRIPTIVE_SYNTHESIS") : "UNSUPPORTED_MATERIAL_ASSERTION"),
              isSupported,
              supportedByCapability: p?.supportedByCapability || null,
              reasonIfNotSupported: isSupported ? undefined : p?.reasonIfNotSupported,
            };
          })
        : [];

      const rawOperationalClaims: any[] = Array.isArray(parsed.operationalClaims) ? parsed.operationalClaims : [];

      let operationalClaims: MechanismOperationalClaim[] = rawOperationalClaims.map((c: any) => {
        const claimText = String(c?.claim || "");
        const claimNorm = claimText.toLowerCase().replace(/\s+/g, " ").trim();
        const wasPreviouslyAccepted = claimNorm.length > 0 && previouslyAcceptedNorm.has(claimNorm);
        const supp = c?.supportedByCapability || c?.capabilityRef || null;
        let role: MechanismSemanticRoleClaimType = c?.role || (supp ? "EXISTING_FACTUAL_CLAIM" : "REASONABLE_DESCRIPTIVE_SYNTHESIS");
        // Do not force synthesis/interpretation claims without a single verbatim capabilityRef into EXISTING_FACTUAL_CLAIM
        if (
          (role === "EXISTING_FACTUAL_CLAIM" || role === "SUPPORTED_FACTUAL_STATEMENT" || role === "VERIFIED_EXISTING_CAPABILITY") &&
          !supp &&
          (parsed.verdict === "APPROVE" || wasPreviouslyAccepted)
        ) {
          role = "REASONABLE_DESCRIPTIVE_SYNTHESIS";
        }
        return {
          claim: claimText,
          role,
          supportedByCapability: supp,
          capabilityRef: supp,
        };
      });

      if (operationalClaims.length === 0 && embeddedFactualPredicates.length > 0) {
        operationalClaims = embeddedFactualPredicates.map((p) => {
          const supp = p.supportedByCapability || null;
          let role: MechanismSemanticRoleClaimType;
          if (!p.isSupported || p.evaluationKind === "UNSUPPORTED_MATERIAL_ASSERTION") {
            role = "UNSUPPORTED_MATERIAL_ASSERTION";
          } else if (
            p.evaluationKind === "REASONABLE_DESCRIPTIVE_SYNTHESIS" ||
            p.evaluationKind === "BOUNDED_INTERPRETATION" ||
            !supp
          ) {
            role = p.evaluationKind === "BOUNDED_INTERPRETATION"
              ? "BOUNDED_INTERPRETATION"
              : "REASONABLE_DESCRIPTIVE_SYNTHESIS";
          } else {
            role = "EXISTING_FACTUAL_CLAIM";
          }
          return {
            claim: p.predicate,
            role,
            supportedByCapability: supp,
            capabilityRef: supp,
          };
        });
      }

      if (embeddedFactualPredicates.length === 0 && operationalClaims.length > 0) {
        for (const c of operationalClaims) {
          const isUnsupportedRole =
            c.role === "UNSUPPORTED_MATERIAL_ASSERTION" ||
            c.role === "UNSUPPORTED_EXISTING_PROCESS" ||
            ((c.role === "VERIFIED_EXISTING_CAPABILITY" || c.role === "EXISTING_FACTUAL_CLAIM" || c.role === "SUPPORTED_FACTUAL_STATEMENT") && !c.supportedByCapability);
          embeddedFactualPredicates.push({
            predicate: c.claim,
            category: "OTHER",
            evaluationKind: isUnsupportedRole
              ? "UNSUPPORTED_MATERIAL_ASSERTION"
              : c.supportedByCapability
                ? "SUPPORTED_FACTUAL_STATEMENT"
                : "REASONABLE_DESCRIPTIVE_SYNTHESIS",
            isSupported: !isUnsupportedRole,
            supportedByCapability: c.supportedByCapability || null,
          });
        }
      }

      const unsupportedPredicates: string[] = embeddedFactualPredicates
        .filter((p) => !p.isSupported)
        .map((p) => p.predicate);

      if (Array.isArray(parsed.unsupportedPredicates)) {
        for (const up of parsed.unsupportedPredicates) {
          if (typeof up === "string" && up.trim()) {
            const trimmed = up.trim();
            const norm = trimmed.toLowerCase().replace(/\s+/g, " ").trim();
            if (!previouslyAcceptedNorm.has(norm) && !unsupportedPredicates.includes(trimmed)) {
              unsupportedPredicates.push(trimmed);
            }
          }
        }
      }

      const axisVerdict = parsed.axisVerdict === "MISALIGNED" ? "MISALIGNED" : "ALIGNED";
      const axisReason = typeof parsed.axisReason === "string" ? parsed.axisReason : (axisVerdict === "ALIGNED" ? "Mechanism aligns with contrast axis" : "Mechanism misaligned with contrast axis");

      const hasUnsupportedClaim =
        unsupportedPredicates.length > 0 ||
        operationalClaims.some(
          (c) =>
            c.role === "UNSUPPORTED_EXISTING_PROCESS" ||
            c.role === "UNSUPPORTED_MATERIAL_ASSERTION" ||
            ((c.role === "EXISTING_FACTUAL_CLAIM" || c.role === "VERIFIED_EXISTING_CAPABILITY" || c.role === "SUPPORTED_FACTUAL_STATEMENT") && !c.supportedByCapability)
        ) ||
        (parsed.factualPostureVerdict === "UNSUPPORTED_FACTUAL_CLAIM" && unsupportedPredicates.length > 0);

      let verdict = parsed.verdict;
      let failureType = parsed.failureType || (verdict === "APPROVE" ? "NONE" : "NOT_A_HOW_EXPLANATION");

      if (hasUnsupportedClaim && verdict === "APPROVE") {
        verdict = "REPAIR";
        failureType = "UNSUPPORTED_CAPABILITIES";
      }

      if (axisVerdict === "MISALIGNED" && verdict === "APPROVE") {
        verdict = "REPAIR";
        failureType = "AXIS_MISALIGNED";
      }

      const reasons = Array.isArray(parsed.reasons) ? parsed.reasons : [parsed.reasons || "Evaluated by semantic role judge"];
      if (hasUnsupportedClaim && !reasons.some((r: string) => String(r).toLowerCase().includes("unsupported") || String(r).toLowerCase().includes("product truth"))) {
        reasons.unshift(
          unsupportedPredicates.length > 0
            ? `Mechanism contains unsupported factual predicates: ${unsupportedPredicates.join("; ")}`
            : "Mechanism asserts unverified operational process or physical capability without Product Truth backing"
        );
      }

      const mechanismAuthorityRole: MechanismAuthorityRole =
        parsed.mechanismAuthorityRole === "VERIFIED_EXISTING_PROCESS" ||
        parsed.mechanismAuthorityRole === "PROPOSED_EXECUTION" ||
        parsed.mechanismAuthorityRole === "STRATEGIC_SYNTHESIS"
          ? parsed.mechanismAuthorityRole
          : "STRATEGIC_SYNTHESIS";

      const feedback = parsed.feedback || (unsupportedPredicates.length > 0
        ? `Repair ONLY the unsupported factual phrase(s): ${unsupportedPredicates.join("; ")}. Replace them with verified Product Truth facts and preserve all supported content.`
        : "");

      return {
        verdict,
        axisVerdict,
        axisReason,
        reasons,
        failureType,
        feedback,
        operationalClaims,
        embeddedFactualPredicates,
        unsupportedPredicates,
        mechanismAuthorityRole,
        mechanismRoleVerdict: parsed.mechanismRoleVerdict || (parsed.failureType === "POSITIONING_REWRITTEN" || parsed.failureType === "DIFFERENTIATION_REWRITTEN" || parsed.failureType === "MARKETING_COMMUNICATION" ? "INVALID_ROLE" : "VALID_HOW"),
        factualPostureVerdict: hasUnsupportedClaim ? "UNSUPPORTED_FACTUAL_CLAIM" : (parsed.factualPostureVerdict || "FACTUALLY_GROUNDED"),
        productTruthSnapshotId: input.productTruthSnapshotId,
        productTruthFingerprint: input.productTruthSnapshotFingerprint,
      };
    }

    return {
      verdict: "NOT_EVALUATED",
      axisVerdict: "NOT_EVALUATED",
      axisReason: "Judge returned invalid or unparseable evaluation",
      reasons: ["Judge returned invalid or unparseable evaluation"],
      failureType: "JUDGE_UNAVAILABLE",
      errorCategory: "MALFORMED_OUTPUT",
      feedback: "Semantic role judge failed to return a valid structured verdict.",
      embeddedFactualPredicates: [],
      unsupportedPredicates: [],
      mechanismRoleVerdict: "NOT_EVALUATED",
      factualPostureVerdict: "NOT_EVALUATED",
      productTruthSnapshotId: input.productTruthSnapshotId,
      productTruthFingerprint: input.productTruthSnapshotFingerprint,
    };
  } catch (err: any) {
    const classified = classifyAIError(err);
    console.warn(`[MechanismEngine] SEMANTIC_ROLE_JUDGE_ERROR | category=${classified.category} | ${err.message}`);
    return {
      verdict: "NOT_EVALUATED",
      axisVerdict: "NOT_EVALUATED",
      axisReason: `Judge infrastructure failure: semantic role judge unavailable (${err.message})`,
      reasons: [`Judge infrastructure failure: semantic role judge unavailable (${err.message})`],
      failureType: "JUDGE_UNAVAILABLE",
      errorCategory: classified.category,
      feedback: "Semantic role judge service is unavailable.",
      embeddedFactualPredicates: [],
      unsupportedPredicates: [],
      mechanismRoleVerdict: "NOT_EVALUATED",
      factualPostureVerdict: "NOT_EVALUATED",
      productTruthSnapshotId: input.productTruthSnapshotId,
      productTruthFingerprint: input.productTruthSnapshotFingerprint,
    };
  }
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
    positioning, differentiation, accountId, analyticalEnrichment, strategic, productDna, painRegistry,
  );
  // Authoritative pain routing: mechanism explains the root cause of the CORE purchase pain
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

export function applyDeterministicMechanismCleanup(
  mech: MechanismOutput,
  capabilities: ValidatedCapability[],
  groundingRefs: string[],
): { cleanedGroundingRefs: string[]; fixesApplied: string[] } {
  const fixesApplied: string[] = [];

  if (Array.isArray(mech.capabilityRefs) && mech.capabilityRefs.length > 0) {
    const deduped = Array.from(new Set(mech.capabilityRefs.map((r) => String(r || "").trim()).filter(Boolean)));
    if (deduped.length !== mech.capabilityRefs.length) {
      fixesApplied.push(`deduplicated_capability_refs:${mech.capabilityRefs.length}->${deduped.length}`);
    }
    mech.capabilityRefs = deduped;
  }

  if (Array.isArray(mech.mechanismSteps) && mech.mechanismSteps.length > 0) {
    const seenSteps = new Set<string>();
    const dedupedSteps: string[] = [];
    for (const step of mech.mechanismSteps) {
      const trimmed = String(step || "").trim();
      const norm = trimmed.toLowerCase().replace(/\s+/g, " ");
      if (!norm || seenSteps.has(norm)) continue;
      seenSteps.add(norm);
      dedupedSteps.push(trimmed);
    }
    if (dedupedSteps.length !== mech.mechanismSteps.length) {
      fixesApplied.push(`deduplicated_steps:${mech.mechanismSteps.length}->${dedupedSteps.length}`);
    }
    mech.mechanismSteps = dedupedSteps;
  }

  if (Array.isArray(mech.operationalClaims) && mech.operationalClaims.length > 0) {
    const seenClaims = new Set<string>();
    const dedupedClaims = [];
    for (const c of mech.operationalClaims) {
      const key = `${String(c?.claim || "").toLowerCase().replace(/\s+/g, " ").trim()}::${String(c?.role || "").toUpperCase()}`;
      if (!key || seenClaims.has(key)) continue;
      seenClaims.add(key);
      dedupedClaims.push(c);
    }
    if (dedupedClaims.length !== mech.operationalClaims.length) {
      fixesApplied.push(`deduplicated_operational_claims:${mech.operationalClaims.length}->${dedupedClaims.length}`);
    }
    mech.operationalClaims = dedupedClaims;
  }

  const cleanedGroundingRefs = Array.from(
    new Set((groundingRefs || []).map((r) => String(r || "").trim()).filter(Boolean))
  );
  if (cleanedGroundingRefs.length !== (groundingRefs || []).length) {
    fixesApplied.push(`deduplicated_grounding_refs:${(groundingRefs || []).length}->${cleanedGroundingRefs.length}`);
  }

  return { cleanedGroundingRefs, fixesApplied };
}

function containsUnsupportedPhrase(text: string, unsupportedPredicates: string[]): boolean {
  if (!text || !Array.isArray(unsupportedPredicates) || unsupportedPredicates.length === 0) return false;
  const lower = text.toLowerCase();
  return unsupportedPredicates.some((up) => {
    const normUp = String(up || "").toLowerCase().trim();
    return normUp.length > 0 && lower.includes(normUp);
  });
}

export function mergeRepairedMechanismCandidate(
  previousCandidate: MechanismOutput,
  repairedCandidate: MechanismOutput,
  unsupportedPredicates: string[],
  capabilities: ValidatedCapability[],
): MechanismOutput {
  const merged: MechanismOutput = {
    ...previousCandidate,
    ...repairedCandidate,
  };

  if (!repairedCandidate.mechanismName || repairedCandidate.mechanismName === "Unnamed Mechanism") {
    if (!containsUnsupportedPhrase(previousCandidate.mechanismName, unsupportedPredicates)) {
      merged.mechanismName = previousCandidate.mechanismName;
    }
  }
  if (!repairedCandidate.mechanismDescription && !containsUnsupportedPhrase(previousCandidate.mechanismDescription, unsupportedPredicates)) {
    merged.mechanismDescription = previousCandidate.mechanismDescription;
  }
  if (!repairedCandidate.mechanismLogic && !containsUnsupportedPhrase(previousCandidate.mechanismLogic, unsupportedPredicates)) {
    merged.mechanismLogic = previousCandidate.mechanismLogic;
  }
  if (!repairedCandidate.mechanismPromise && !containsUnsupportedPhrase(previousCandidate.mechanismPromise, unsupportedPredicates)) {
    merged.mechanismPromise = previousCandidate.mechanismPromise;
  }
  if (!repairedCandidate.mechanismProblem && !containsUnsupportedPhrase(previousCandidate.mechanismProblem, unsupportedPredicates)) {
    merged.mechanismProblem = previousCandidate.mechanismProblem;
  }
  if ((!Array.isArray(repairedCandidate.mechanismSteps) || repairedCandidate.mechanismSteps.length === 0) && Array.isArray(previousCandidate.mechanismSteps)) {
    merged.mechanismSteps = previousCandidate.mechanismSteps.filter(
      (s) => !containsUnsupportedPhrase(s, unsupportedPredicates)
    );
  }
  if (!repairedCandidate.whyItWorks && previousCandidate.whyItWorks && !containsUnsupportedPhrase(previousCandidate.whyItWorks, unsupportedPredicates)) {
    merged.whyItWorks = previousCandidate.whyItWorks;
  }
  if ((!repairedCandidate.failureModes || repairedCandidate.failureModes.length === 0) && previousCandidate.failureModes) {
    merged.failureModes = previousCandidate.failureModes;
  }
  if ((!repairedCandidate.causalChain || repairedCandidate.causalChain.length === 0) && previousCandidate.causalChain) {
    merged.causalChain = previousCandidate.causalChain;
  }
  if (!repairedCandidate.commercialFunction && previousCandidate.commercialFunction) {
    merged.commercialFunction = previousCandidate.commercialFunction;
  }
  if (!repairedCandidate.upstreamDependency && previousCandidate.upstreamDependency) {
    merged.upstreamDependency = previousCandidate.upstreamDependency;
  }
  if ((!repairedCandidate.capabilityRefs || repairedCandidate.capabilityRefs.length === 0) && previousCandidate.capabilityRefs) {
    const validCapIds = new Set(capabilities.map((c) => c.capabilityId));
    merged.capabilityRefs = previousCandidate.capabilityRefs.filter((id) => validCapIds.has(id));
  }

  // Deterministic shipping-vs-delivery wording normalization during repair when "same-day shipping" is verified and "same-day delivery" is not
  const hasVerifiedSameDayShipping = capabilities.some((c) => /same[-\s]?day\s+ship/i.test(c.statement));
  const hasVerifiedSameDayDelivery = capabilities.some((c) => /same[-\s]?day\s+deliver/i.test(c.statement));
  if (hasVerifiedSameDayShipping && !hasVerifiedSameDayDelivery) {
    const replaceDelivery = (str: string) =>
      String(str || "").replace(/\bsame[-\s]?day\s+delivery\b/gi, "same-day shipping");
    merged.mechanismDescription = replaceDelivery(merged.mechanismDescription);
    merged.mechanismPromise = replaceDelivery(merged.mechanismPromise);
    merged.mechanismLogic = replaceDelivery(merged.mechanismLogic);
    merged.mechanismSteps = (merged.mechanismSteps || []).map(replaceDelivery);
    if (merged.whyItWorks) merged.whyItWorks = replaceDelivery(merged.whyItWorks);
  }

  return merged;
}

function buildTargetedRepairDirective(params: {
  unsupportedPredicates: string[];
  rejectionReasons: string[];
  capabilities: ValidatedCapability[];
  passedClaims: string[];
  previousCandidate: MechanismOutput;
  snapshotId?: string;
  snapshotFingerprint?: string;
  axisError?: string;
}): string {
  const factsLines = params.capabilities.map((c, idx) => {
    const scopeInfo = c.scope ? ` | scope=${c.scope}` : "";
    const qualInfo = Array.isArray(c.qualifications) && c.qualifications.length > 0
      ? ` | limitations/qualifications=${c.qualifications.join("; ")}`
      : typeof c.qualifications === "string" && c.qualifications.trim().length > 0
        ? ` | limitations/qualifications=${c.qualifications.trim()}`
        : "";
    return `  ${idx + 1}. [${c.factType || "CAPABILITY"}] id=${c.capabilityId}${c.sourceFactId ? ` (factId=${c.sourceFactId})` : ""}${scopeInfo}${qualInfo}: "${c.statement}"`;
  });

  return `═══ TARGETED MECHANISM REPAIR (LIGHTWEIGHT — PRESERVE PASSED CONTENT) ═══
CANONICAL PRODUCT TRUTH SNAPSHOT:
- Snapshot ID: ${params.snapshotId || "canonical"}
- Snapshot Fingerprint: ${params.snapshotFingerprint || "n/a"}

1. EXACT UNSUPPORTED PREDICATES TO REPAIR OR REMOVE:
${params.unsupportedPredicates.length > 0 ? params.unsupportedPredicates.map((p) => `- "${p}"`).join("\n") : "- None specified (see rejection reasons)"}

2. REASONS FOR REJECTION:
${params.rejectionReasons.map((r) => `- ${r}`).join("\n")}
${params.axisError ? `- AXIS ALIGNMENT ISSUE: ${params.axisError}\n` : ""}
3. RELEVANT SUPPORTING FACT IDs & THEIR LIMITATIONS (CANONICAL INVENTORY):
${factsLines.length > 0 ? factsLines.join("\n") : "  (No verified Product Truth facts available)"}

4. PARTS OF THE CANDIDATE THAT ALREADY PASSED (PRESERVE THESE):
${params.passedClaims.length > 0 ? params.passedClaims.map((c) => `- [PASSED] ${c}`).join("\n") : "- Preserve all supported steps and explanations from Round 1"}

ROUND 1 CANDIDATE BASELINE (edit ONLY the unsupported phrase(s) above; keep all passing structure, steps, and explanations intact):
${JSON.stringify(
  {
    name: params.previousCandidate.mechanismName,
    type: params.previousCandidate.mechanismType,
    mechanismAuthorityRole: params.previousCandidate.mechanismAuthorityRole,
    description: params.previousCandidate.mechanismDescription,
    steps: params.previousCandidate.mechanismSteps,
    promise: params.previousCandidate.mechanismPromise,
    problem: params.previousCandidate.mechanismProblem,
    logic: params.previousCandidate.mechanismLogic,
    capabilityRefs: params.previousCandidate.capabilityRefs,
  },
  null,
  2,
)}

REPAIR INSTRUCTIONS:
- Replace ONLY the unsupported phrase(s) with verified Product Truth facts (for example: replace an unsupported freshness-preservation or mold-prevention guarantee with the verified daily production and hygienic packaging facts; keep "same-day shipping" if verified while avoiding "same-day delivery").
- Do NOT discard or rewrite the supported ingredient, assortment, production, packaging, or shipping explanations that already passed.`;
}

async function runMechanismEngineInternal(
  positioning: MechanismEnginePositioningInput,
  differentiation: MechanismEngineDifferentiationInput,
  accountId: string,
  analyticalEnrichment?: any,
  strategic?: RunStrategicContext,
  productDna?: ProductDnaLike | null,
  painRegistry?: any[],
): Promise<MechanismEngineResult> {
  const startTime = Date.now();
  const diagnostics: Record<string, any> = {};

  // Verify Canonical Product Truth Snapshot Lineage before any generation
  const rawDnaFacts: ProductTruthFactItem[] = Array.isArray((productDna as any)?.productTruthFacts)
    ? (productDna as any).productTruthFacts
    : [];
  const dnaOfferingId =
    (productDna as any)?.campaignOfferingId ||
    (productDna as any)?.canonicalProductTruthSnapshot?.campaignOfferingId ||
    rawDnaFacts.find((f) => f?.campaignOfferingId)?.campaignOfferingId ||
    undefined;
  const dnaSnapshotId =
    (productDna as any)?.snapshotId ||
    (productDna as any)?.canonicalProductTruthSnapshot?.snapshotId ||
    (rawDnaFacts.length > 0 ? `pt_snap_${dnaOfferingId || "default"}` : undefined);
  const dnaFingerprint =
    (productDna as any)?.snapshotFingerprint ||
    (productDna as any)?.canonicalProductTruthSnapshot?.snapshotFingerprint ||
    (rawDnaFacts.length > 0
      ? computeProductTruthFingerprint({
          campaignOfferingId: dnaOfferingId,
          snapshotId: dnaSnapshotId,
          facts: rawDnaFacts,
        })
      : undefined);

  if (
    differentiation?.campaignOfferingId ||
    differentiation?.productTruthSnapshotId ||
    differentiation?.productTruthFingerprint
  ) {
    verifyProductTruthSnapshotLineage(
      {
        snapshotId: dnaSnapshotId,
        snapshotFingerprint: dnaFingerprint,
        campaignOfferingId: dnaOfferingId,
      },
      {
        expectedOfferingId: differentiation.campaignOfferingId,
        expectedSnapshotId: differentiation.productTruthSnapshotId,
        expectedFingerprint: differentiation.productTruthFingerprint,
      },
      "MechanismEngine"
    );
  }

  const resolvedOfferingId = dnaOfferingId || differentiation?.campaignOfferingId;
  const resolvedSnapshotId = dnaSnapshotId || differentiation?.productTruthSnapshotId || "pt_snap_canonical";
  const resolvedFingerprint =
    dnaFingerprint ||
    differentiation?.productTruthFingerprint ||
    computeProductTruthFingerprint({
      campaignOfferingId: resolvedOfferingId,
      snapshotId: resolvedSnapshotId,
      facts: rawDnaFacts,
    });

  const primaryAxis = resolvePrimaryAxis(positioning);
  const allAxes = positioning.differentiationVector || [primaryAxis];
  const guidance = getAxisGuidance(primaryAxis);
  const rawDiffCore = differentiation.mechanismCore;
  const diffCore = rawDiffCore && rawDiffCore !== "null"
    ? (typeof rawDiffCore === "string" ? safeJsonParse(rawDiffCore) : rawDiffCore)
    : null;
  const diffFraming = differentiation.mechanismFraming || {};
  const pillars = differentiation.pillars || [];

  diagnostics.primaryAxis = primaryAxis;
  diagnostics.allAxes = allAxes;
  diagnostics.hasDiffCore = !!diffCore;
  diagnostics.pillarCount = pillars.length;
  diagnostics.campaignOfferingId = resolvedOfferingId;
  diagnostics.productTruthSnapshotId = resolvedSnapshotId;
  diagnostics.productTruthFingerprint = resolvedFingerprint;

  console.log(`[MechanismEngine] START | axis=${primaryAxis} | axes=[${allAxes.join(",")}] | diffCore=${!!diffCore} | pillars=${pillars.length} | ptSnapshot=${resolvedSnapshotId} | ptFingerprint=${resolvedFingerprint}`);

  if (!positioning.contrastAxis && allAxes.length === 0 && pillars.length === 0) {
    return {
      status: STATUS.INSUFFICIENT_INPUT,
      statusMessage: "No positioning axis, contrast axis, or differentiation pillars available — cannot generate axis-aligned mechanism",
      primaryMechanism: null as any,
      alternativeMechanism: null,
      axisConsistency: { consistent: false, primaryAxis, mechanismAxis: primaryAxis, failures: ["Insufficient positioning data"] },
      confidenceScore: 0.2,
      executionTimeMs: Date.now() - startTime,
      engineVersion: ENGINE_VERSION,
      diagnostics,
      productTruthSnapshotId: resolvedSnapshotId,
      productTruthFingerprint: resolvedFingerprint,
    };
  }

  const filteredAelCtx = filterAELForStrategicUse(analyticalEnrichment || null, painRegistry);
  const activeAel = filteredAelCtx ? filteredAelCtx.filteredPkg : (analyticalEnrichment || null);
  const aelBlock = formatAELForPrompt(activeAel, painRegistry);
  const causalDirective = buildCausalDirectiveForPrompt(activeAel);
  const aelStructuredBlock = buildStructuredAELBlock(activeAel);
  if (aelBlock.length > 0) {
    console.log(`[MechanismEngine] AEL_INJECTED | enrichmentSize=${aelBlock.length}chars | structuredBlock=${aelStructuredBlock.length}chars`);
  }

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

  const mechCaps = deriveValidatedCapabilities(mechAnchor, productDna);
  diagnostics.productTruthFactCount = mechCaps.length;
  diagnostics.productTruthFactTypes = Array.from(new Set(mechCaps.map((c) => c.factType || "CAPABILITY")));

  const groundingContractBlock = buildGroundingContract(mechAnchor, analyticalEnrichment || null, { capabilities: mechCaps });

  const pillarSummary = pillars.slice(0, 5).map((p: any) => `"${p.name || p.territory}": ${p.description || ""}`.slice(0, 120)).join("\n");

  const validatedClaims = (differentiation.claimStructures || []) as any[];
  const sortedClaims = [...validatedClaims].sort((a: any, b: any) => (b?.overallScore || 0) - (a?.overallScore || 0)).slice(0, 5);
  const claimsBlock = sortedClaims.length > 0
    ? sortedClaims.map((c: any, i: number) => `[CLAIM ${i + 1}] (score=${(c.overallScore || 0).toFixed(2)}, territory="${c.territory || "n/a"}"): ${c.claim}`).join("\n")
    : "";
  const claimsSection = claimsBlock ? `
═══ APPROVED DIFFERENTIATION CLAIMS (STRATEGIC CONTEXT — RESOLVE AGAINST PRODUCT TRUTH) ═══
Treat these Differentiation claims as strategic context for the commercial angle. Resolve all factual attributes, ingredients, production steps, packaging, and shipping claims strictly against the Canonical Product Truth inventory above. Do NOT repeat any upstream narrative phrase that is not supported by verified Product Truth.

${claimsBlock}

In your output, set "anchorClaimIndex" to the [CLAIM N] you aligned with (1-based), while keeping your mechanism's promise strictly grounded in verified Product Truth facts.
` : "";

  const existingMechanismSection = diffCore && typeof diffCore === "object" && diffCore.mechanismType && diffCore.mechanismType !== "none" && Array.isArray(diffCore.mechanismSteps) ? `
EXISTING MECHANISM CONTEXT FROM DIFFERENTIATION (strategic foundation — verify all facts against Product Truth):
Name: "${diffCore.mechanismName}"
Type: ${diffCore.mechanismType}
Steps: ${diffCore.mechanismSteps.map((s: string, i: number) => `${i + 1}. ${s}`).join("\n")}
Promise: ${diffCore.mechanismPromise}
Problem: ${diffCore.mechanismProblem}
Logic: ${diffCore.mechanismLogic}

Refine this mechanism for axis alignment while resolving every factual statement against the Canonical Product Truth inventory.` : `
No validated mechanism exists yet. Generate a practical, grounded mechanism based on the canonical Product Truth inventory, positioning axis, and differentiation context.`;

  const prompt = `You are a Mechanism Architect. Your job is to generate a practical, commercially useful mechanism that is aligned with the positioning axis and grounded in the canonical Product Truth inventory (Snapshot=${resolvedSnapshotId}, Fingerprint=${resolvedFingerprint}).
${doctrineBlock ? `\n${doctrineBlock}\n` : ""}${dnaAnchorBlock}${anchorGroundingRule}${groundingContractBlock}
${aelBlock ? `═══ ANALYTICAL ENRICHMENT LAYER (CAUSAL FOUNDATION) ═══
${aelBlock}

${causalDirective}
${aelStructuredBlock}

Your mechanism should derive from the root causes and causal chains above. Every step in the mechanism must address a real behavioral barrier or causal factor. Ground your explanation in the causal analysis without copying entire sentences unnaturally.

AEL CAUSAL GROUNDING:
- Reference at least one ROOT CAUSE by its [RC#] identifier from the AEL STRUCTURE
- Reference the causal logic from the CAUSAL CHAINS [CC#]
- Resolve at least one specific BARRIER [BB#] and explain HOW the mechanism resolves it
- The "rootCauseUsed" and "barrierResolved" fields in the output are REQUIRED
` : ""}═══ STRATEGIC INPUTS vs FACTUAL AUTHORITIES (NAMESPACE SEPARATION) ═══
CRITICAL JURISDICTION BOUNDARY & FACTUAL AUTHORITY PRECEDENCE:
- FACTUAL AUTHORITY PRECEDENCE:
  Canonical Product Truth Inventory (CAPABILITY, QUALITY, OPERATIONAL, PROOF, OFFER, DELIVERY_MECHANISM, PRICING_FACT, USE_CASE) > Strategic Context (Positioning, Differentiation, AEL, Market Voice).
- Product Truth is the SOLE factual authority for what ingredients, physical attributes, materials, product configurations, packaging, and operational/shipping processes the business actually has.
- Upstream Strategic Context (Positioning, Differentiation, AEL, Customer Voice):
  These inputs define WHERE we compete and WHY our angle matters. Treat approved Differentiation as strategic context and resolve its factual claims against the Canonical Product Truth inventory.
  * Never repeat an upstream narrative assertion that exceeds verified Product Truth.

═══ PRACTICAL MECHANISM STANDARD (HOW THE OFFERING WORKS) ═══
A valid mechanism explains HOW ordinary ingredients, production steps, product configuration/assortment, packaging, or service/shipping delivery work together to address a buyer concern.
It does NOT need:
- A proprietary invention or patented process.
- A laboratory or formal QA inspection protocol.
- A quantified performance improvement.
- A guarantee eliminating the entire customer pain.
- Competitive exclusivity ("how the product works" is separate from "competitors cannot do this").
- Artificial "Engine", "System", or "Framework" terminology.

ACCEPTABLE & ENCOURAGED GROUNDED EXPLANATIONS:
- Faithful paraphrases of verified facts (CAPABILITY, QUALITY, OPERATIONAL, PROOF, OFFER, etc.).
- Natural descriptive language and coherent combinations of complementary verified facts:
  * A verified mixed box containing seven varieties may be described as a "varied assortment" or "curated assortment" (without claiming an unverified expert-selection committee).
  * Verified daily production and hygienic packaging may be combined to explain the production-and-packaging approach.
  * Verified ingredient choices (e.g., 100% pure animal ghee, premium pistachios, free of preservatives/artificial colors) may explain the product's approach to flavor and composition without requiring a separate authenticity certification.
  * Bounded explanations of how verified attributes address part of a buyer concern (without overclaiming total elimination of the pain).

STRICT ANTI-INVENTION BOUNDARIES:
- Keep "same-day shipping" (dispatch) strictly distinct from "same-day delivery" (arrival). Never claim "same-day delivery" if Product Truth only verifies "same-day shipping".
- Never invent unsupported mold-prevention, shelf-life extension, or freshness-preservation performance guarantees.
- Never invent laboratories, formal QA inspection protocols, light-box testing, patents, or third-party certifications unless present in Product Truth.
- Never upgrade general attributes into unverified physical performance specs (e.g., "comfort" does not mean "breathable/cooling"; "modesty" does not mean "opaque").
- Keep free trials, conditional payment triggers (such as paying when gifting or obtaining the final product), refund policies, and satisfaction guarantees ("pay only when satisfied") strictly distinct. Never claim "customers pay only when satisfied" if Product Truth only establishes paying when gifting or obtaining the final product.
- If using "risk-free", qualify it with the specific risk addressed (such as a free generation trial before paying when gifting or obtaining the final product).
- Attribute customer complaints of generic or impersonal results to reported buyer perception; never assert unverified facts about competitors' internal production architecture (such as "mass-produced automated prompt workflows" or "template-bound services").

═══ MECHANISM AUTHORITY ROLE MODEL ═══
Every mechanism must declare its mechanismAuthorityRole:
- "STRATEGIC_SYNTHESIS": A coherent combination or descriptive synthesis of verified ingredients, product configuration, production steps, packaging, or service attributes into a causal explanation.
- "VERIFIED_EXISTING_PROCESS": Directly backed by verified operational/production facts in Product Truth.
- "PROPOSED_EXECUTION": An explicitly future-oriented or recommended process.

═══ POSITIONING AXIS (STRATEGIC CONTRAST LENS) ═══
Primary Axis: "${primaryAxis}"
Contrast Axis: "${positioning.contrastAxis || "not defined"}"
Enemy: "${positioning.enemyDefinition || "not defined"}"
Narrative Direction: "${positioning.narrativeDirection || "not defined"}"
All Differentiation Axes: [${allAxes.join(", ")}]

═══ AXIS ALIGNMENT RULES ═══
The mechanism must plausibly support the outcome targeted by "${primaryAxis}":
- EMPHASIZE these themes: ${guidance.emphasis.join(", ")}
- NEVER use these themes: ${guidance.banned.join(", ")}
- DO NOT name the mechanism "Positioning Framework" or append "${primaryAxis} Positioning".

═══ DIFFERENTIATION PILLARS (STRATEGIC CONTEXT) ═══
${pillarSummary || "No pillars available"}
${claimsSection}
${existingMechanismSection}

═══ MECHANISM NAMING GUIDELINES ═══
Use a clear, natural name describing how the product, assortment, preparation, or service works:
- Natural names (e.g. "Daily Fresh Production & Seven-Variety Assortment", "Pure Ghee & Pistachio Craft Approach", "Curated Silhouette Architecture", "Two-Stage Selection Approach") are welcome; artificial "Engine", "System", or "Framework" labels are NOT required.
- NEVER name a mechanism "The [Axis] Positioning Framework", "Whitespace Positioning", or "Marketing Strategy".

═══ STRUCTURAL REQUIREMENTS ═══
1. Clear name describing how the product/service works
2. 3-5 concrete steps explaining HOW the verified attributes, ingredients, assortment, preparation, packaging, or service work together
3. Each step explains cause → product/process action → bounded buyer outcome
4. The mechanism promise must be grounded in verified Product Truth facts (no unverified guarantees)
5. The mechanism problem must use natural buyer language

═══ MECHANISM v2 — COMMERCIAL REASONING DEPTH (REQUIRED) ═══
Beyond the structural fields, every mechanism MUST justify itself commercially:
- "whyItWorks": one paragraph (60-120 words) explaining the BUYER PSYCHOLOGY this mechanism converts — do NOT restate the steps; explain why a real buyer changes belief/behavior because of it. Reference at least one [RC#] root cause or [BB#] barrier.
- "failureModes": 2-4 SPECIFIC counterfactual conditions under which this mechanism FAILS (audience type, market state, missing proof, wrong awareness stage). Be concrete; "if applied poorly" does NOT count.
- "causalChain": ordered array of 3-5 steps, each {"cause": "what buyer believes/experiences (cite [RC#]/[BB#])", "impact": "structural change the mechanism produces", "behavior": "buyer behavior that follows", "upstreamSignalRefs": ["[RC#]", "[BB#]" ...]}. This is the cause→impact→behavior chain.
- "commercialFunction": {"type": one of "trust_transfer"|"risk_reduction"|"identity_shift"|"perception_change"|"category_capture", "description": one sentence naming what commercial work this mechanism does}.
- "upstreamDependency": {"positioningHook": which positioning element this anchors on (axis/contrast/enemy text), "differentiationHook": which differentiation pillar/claim this anchors on}.
- "alternativeMechanisms": 1-2 mechanisms you considered but did NOT pick, each {"name", "whyAlternative": one sentence stating the trade-off and why the chosen primary is stronger}.
- "capabilityRefs": array of validated capability/fact IDs (cap_<hash>) from the Grounding Contract that this mechanism cites or embodies.

═══ OUTPUT FORMAT ═══
Respond with ONLY valid JSON, no markdown:
{
  "primary": {
    "name": "mechanism name",
    "type": "framework|system|protocol|method|architecture|engine|process",
    "mechanismAuthorityRole": "STRATEGIC_SYNTHESIS|VERIFIED_EXISTING_PROCESS|PROPOSED_EXECUTION",
    "description": "one-paragraph description emphasizing ${primaryAxis} — grounded in causal analysis and verified Product Truth",
    "steps": ["step 1 addressing [RC#] cause", "step 2 following [CC#] chain", "step 3 resolving [BB#] barrier"],
    "promise": "grounded promise supported by verified facts",
    "problem": "specific problem in audience language",
    "logic": "how the mechanism addresses the problem through ${primaryAxis}",
    "structuralFrame": "natural structural summary of the mechanism",
    "axisEmphasis": ["keyword1", "keyword2", "keyword3"],
    "rootCauseUsed": "[RC#] identifier and deep cause text used",
    "barrierResolved": "[BB#] identifier and barrier text resolved",
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
    ],
    "capabilityRefs": ["cap_..."]
  },
  "alternative": {
    "name": "alternative mechanism name",
    "type": "framework|system|protocol|method|architecture|engine|process",
    "mechanismAuthorityRole": "STRATEGIC_SYNTHESIS|VERIFIED_EXISTING_PROCESS|PROPOSED_EXECUTION",
    "description": "alternative approach still on ${primaryAxis} axis",
    "steps": ["step 1", "step 2", "step 3"],
    "promise": "grounded promise",
    "problem": "specific problem in audience language",
    "logic": "alternative logic through ${primaryAxis}",
    "structuralFrame": "natural structural summary",
    "axisEmphasis": ["keyword1", "keyword2", "keyword3"],
    "rootCauseUsed": "[RC#] identifier and deep cause text used",
    "barrierResolved": "[BB#] identifier and barrier text resolved",
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
  let lastCandidateForRepair: MechanismOutput | null = null;
  let lastPassedClaims: string[] = [];
  let lastUnsupportedPredicates: string[] = [];

  for (let depthAttempt = 1; depthAttempt <= depthGateMaxAttempts; depthAttempt++) {
    if (depthAttempt > 1) {
      console.log(`[MechanismEngine] DEPTH_GATE: Targeted repair attempt ${depthAttempt}/${depthGateMaxAttempts} | ptSnapshot=${resolvedSnapshotId} | ptFingerprint=${resolvedFingerprint}`);
    }

    const fullPrompt = depthRejectionContext ? `${prompt}\n\n${depthRejectionContext}` : prompt;
    console.log(`[MechanismEngine] ANCHOR_EVIDENCE | engine=mechanism | site=first_prompt | attempt=${depthAttempt} | present=${mechAnchor ? "yes" : "no"} | source=${mechAnchorSource} | ptSnapshot=${resolvedSnapshotId}`);

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
        console.log(`[MechanismEngine] AI_PARSE_FAILED_AFTER_RETRY | finish_reason=${finishReason2} | contentChars=${content.length}${truncNote2} — failing closed`);
        diagnostics.aiFailed = true;
        diagnostics.parseRetryFailed = true;
        diagnostics.retryFinishReason = finishReason2;
        return {
          status: STATUS.NO_DISTINCT_MECHANISM_ESTABLISHED,
          statusMessage: "AI generation unparseable after retry — no synthetic fallback permitted",
          primaryMechanism: null as any,
          alternativeMechanism: null,
          axisConsistency: {
            consistent: false,
            primaryAxis,
            mechanismAxis: primaryAxis,
            failures: ["AI generation failed after retry"],
          },
          confidenceScore: 0.2,
          executionTimeMs: Date.now() - startTime,
          engineVersion: ENGINE_VERSION,
          diagnostics,
          productTruthSnapshotId: resolvedSnapshotId,
          productTruthFingerprint: resolvedFingerprint,
        };
      }

      let primaryMech = buildMechanismOutput(parsed.primary, primaryAxis, pillars, resolvedSnapshotId, resolvedFingerprint);
      const altMech = parsed.alternative ? buildMechanismOutput(parsed.alternative, primaryAxis, pillars, resolvedSnapshotId, resolvedFingerprint) : null;

      // Preserve supported Round 1 content during targeted repair
      if (depthAttempt > 1 && lastCandidateForRepair) {
        primaryMech = mergeRepairedMechanismCandidate(
          lastCandidateForRepair,
          primaryMech,
          lastUnsupportedPredicates,
          mechCaps,
        );
        diagnostics.repairedCandidateMerged = true;
      }

      // Deterministic cleanup for exact duplicates and citation hygiene
      const rawGroundingRefs: string[] = Array.isArray(parsed.groundingRefs)
        ? parsed.groundingRefs.filter((r: any) => typeof r === "string" && r.trim().length > 0).map((r: string) => r.trim())
        : [];
      const cleanupRes = applyDeterministicMechanismCleanup(primaryMech, mechCaps, rawGroundingRefs);
      const mechGroundingRefs = cleanupRes.cleanedGroundingRefs;
      if (cleanupRes.fixesApplied.length > 0) {
        diagnostics.deterministicCleanup = cleanupRes.fixesApplied;
      }

      const aelRefs = [parsed.primary, parsed.alternative].filter(Boolean);
      const rcHits = aelRefs.filter((r: any) => r.rootCauseUsed && /\[RC\d+\]/.test(r.rootCauseUsed)).length;
      const bbHits = aelRefs.filter((r: any) => r.barrierResolved && /\[BB\d+\]/.test(r.barrierResolved)).length;
      console.log(`[MechanismEngine] AEL_GROUNDING_RESULT | mechanisms=${aelRefs.length} | rootCauseRefs=${rcHits}/${aelRefs.length} | barrierRefs=${bbHits}/${aelRefs.length}`);
      checkGroundingContract({
        engine: "mechanism",
        site: "primary_mechanism",
        groundingRefs: mechGroundingRefs,
        ael: analyticalEnrichment || null,
        accountId,
        attemptNumber: depthAttempt,
      });

      let nameValidation = validateMechanismName(primaryMech.mechanismName, positioning.domainVocab, mechAnchor, mechCaps, primaryAxis);
      if (!nameValidation.valid) {
        const sanitizedName = sanitizeRepairedMechanismName(primaryMech.mechanismName, primaryAxis);
        const recheck = validateMechanismName(sanitizedName, positioning.domainVocab, mechAnchor, mechCaps, primaryAxis);
        if (recheck.valid) {
          console.log(`[MechanismEngine] NAME_SANITIZED | old="${primaryMech.mechanismName}" | sanitized="${sanitizedName}"`);
          primaryMech.mechanismName = sanitizedName;
          diagnostics.nameRepaired = true;
          nameValidation = recheck;
        } else {
          console.warn(`[MechanismEngine] NAME_INVALID | reason="${nameValidation.reason}" | triggering candidate regeneration`);
          if (depthAttempt < depthGateMaxAttempts) {
            depthRejectionContext = `CRITICAL REGENERATION NEEDED: The candidate mechanism name "${primaryMech.mechanismName}" is invalid: ${nameValidation.reason}.
Generate a mechanism candidate with a clear name that describes how the product or service works without using positioning or whitespace labels.`;
            continue;
          }
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

      // 1. Semantic Role & Practical Factual Posture Judge (receives full canonical Product Truth inventory)
      const roleVerdict = await judgeMechanismSemanticRole({
        candidate: {
          name: primaryMech.mechanismName,
          description: primaryMech.mechanismDescription,
          steps: primaryMech.mechanismSteps,
          logic: primaryMech.mechanismLogic,
          promise: primaryMech.mechanismPromise,
          problem: primaryMech.mechanismProblem,
          mechanismAuthorityRole: primaryMech.mechanismAuthorityRole,
        },
        positioning: {
          primaryAxis,
          contrastAxis: positioning.contrastAxis,
          enemyDefinition: positioning.enemyDefinition,
        },
        productTruthCapabilities: mechCaps.map((c: any) => c.statement),
        capabilities: mechCaps,
        productTruthFacts: rawDnaFacts,
        productTruthSnapshotId: resolvedSnapshotId,
        productTruthSnapshotFingerprint: resolvedFingerprint,
        previouslyAcceptedClaims: depthAttempt > 1 ? lastPassedClaims : undefined,
        accountId,
      });
      diagnostics.semanticRoleVerdict = roleVerdict;
      if (roleVerdict.mechanismAuthorityRole) {
        primaryMech.mechanismAuthorityRole = roleVerdict.mechanismAuthorityRole;
      }

      // Deterministic prose-field entailment check across ALL Mechanism prose fields (including whyItWorks and causalChain)
      if (mechCaps.length > 0 && roleVerdict.verdict === "APPROVE") {
        const capStmts = mechCaps.map((c: any) => c.statement).filter(Boolean);
        const mechProseFields = [
          primaryMech.mechanismDescription,
          primaryMech.mechanismPromise,
          primaryMech.mechanismProblem,
          primaryMech.mechanismLogic,
          primaryMech.whyItWorks || "",
          ...(primaryMech.mechanismSteps || []),
          ...(primaryMech.causalChain || []).map((cc: any) => `${cc?.cause || ""} ${cc?.impact || ""} ${cc?.behavior || ""}`),
        ].filter(Boolean);
        for (const prose of mechProseFields) {
          const ent = evaluateClaimSemanticEntailment(prose, capStmts);
          if (!ent.isGrounded && (ent.status === "UNSUPPORTED_EXPANSION" || ent.status === "CONTRADICTED")) {
            roleVerdict.verdict = "REPAIR";
            roleVerdict.failureType = "UNSUPPORTED_MATERIAL_OR_PROCESS";
            for (const v of ent.violations) {
              if (!roleVerdict.reasons.includes(v)) roleVerdict.reasons.push(v);
              if (!roleVerdict.unsupportedPredicates.includes(v)) roleVerdict.unsupportedPredicates.push(v);
            }
          }
        }
      }

      const computePassedClaimsFromRound = (): string[] => {
        const passed = new Set<string>();
        for (const p of roleVerdict.embeddedFactualPredicates || []) {
          if (p.isSupported && p.predicate) passed.add(p.predicate.trim());
        }
        for (const c of roleVerdict.operationalClaims || []) {
          if (
            c.claim &&
            c.role !== "UNSUPPORTED_MATERIAL_ASSERTION" &&
            c.role !== "UNSUPPORTED_EXISTING_PROCESS" &&
            !((c.role === "EXISTING_FACTUAL_CLAIM" || c.role === "SUPPORTED_FACTUAL_STATEMENT" || c.role === "VERIFIED_EXISTING_CAPABILITY") && !c.supportedByCapability)
          ) {
            passed.add(c.claim.trim());
          }
        }
        for (const step of primaryMech.mechanismSteps || []) {
          if (step && !containsUnsupportedPhrase(step, roleVerdict.unsupportedPredicates || [])) {
            passed.add(step.trim());
          }
        }
        return Array.from(passed);
      };

      if (roleVerdict.failureType === "JUDGE_UNAVAILABLE" || roleVerdict.verdict === "NOT_EVALUATED") {
        const errCat = roleVerdict.errorCategory || "AI_CALL_FAILED";
        console.warn(`[MechanismEngine] SEMANTIC_ROLE_JUDGE_UNAVAILABLE | category=${errCat} | preserving candidate without consuming semantic repair attempts`);
        diagnostics.technicalFailure = {
          failureType: "JUDGE_UNAVAILABLE",
          errorCategory: errCat,
          reasons: roleVerdict.reasons,
          retryable: errCat !== "BILLING_EXHAUSTED",
        };
        diagnostics.preservedCandidate = {
          primaryMechanism: primaryMech,
          alternativeMechanism: altMech,
        };
        return {
          status: STATUS.INCOMPLETE,
          statusMessage: `Mechanism semantic role judge unavailable (${errCat}): ${roleVerdict.reasons.join("; ")}`,
          primaryMechanism: primaryMech,
          alternativeMechanism: altMech,
          axisConsistency: { consistent: true, primaryAxis, mechanismAxis: primaryAxis, failures: [] },
          confidenceScore: 0.35,
          executionTimeMs: Date.now() - startTime,
          engineVersion: ENGINE_VERSION,
          diagnostics,
          productTruthSnapshotId: resolvedSnapshotId,
          productTruthFingerprint: resolvedFingerprint,
        };
      }

      if (roleVerdict.verdict === "REPAIR" || roleVerdict.axisVerdict === "MISALIGNED") {
        const failureType = roleVerdict.axisVerdict === "MISALIGNED" && roleVerdict.verdict === "APPROVE"
          ? "AXIS_MISALIGNED"
          : roleVerdict.failureType;
        const reasons = [
          ...roleVerdict.reasons,
          ...(roleVerdict.axisVerdict === "MISALIGNED" ? [`Axis misalignment: ${roleVerdict.axisReason || "Mechanism does not align with positioning contrast axis"}`] : []),
        ];
        console.warn(`[MechanismEngine] SEMANTIC_ROLE_OR_AXIS_REJECTED | failureType=${failureType} | ${reasons.join("; ")}`);
        if (depthAttempt < depthGateMaxAttempts) {
          lastCandidateForRepair = primaryMech;
          lastPassedClaims = computePassedClaimsFromRound();
          lastUnsupportedPredicates = [...(roleVerdict.unsupportedPredicates || [])];
          diagnostics.repairHandoff = {
            productTruthSnapshotId: resolvedSnapshotId,
            productTruthFingerprint: resolvedFingerprint,
            unsupportedPredicates: lastUnsupportedPredicates,
            rejectionReasons: reasons,
            passedClaims: lastPassedClaims,
            supportingFactIds: mechCaps.map((c) => c.sourceFactId || c.capabilityId),
          };
          depthRejectionContext = buildTargetedRepairDirective({
            unsupportedPredicates: lastUnsupportedPredicates,
            rejectionReasons: reasons,
            capabilities: mechCaps,
            passedClaims: lastPassedClaims,
            previousCandidate: primaryMech,
            snapshotId: resolvedSnapshotId,
            snapshotFingerprint: resolvedFingerprint,
            axisError: roleVerdict.axisVerdict === "MISALIGNED" ? roleVerdict.axisReason : undefined,
          });
          continue;
        }
        // Retries exhausted on semantic role or axis failure -> fail-closed
        console.error(`[MechanismEngine] SEMANTIC_ROLE_OR_AXIS_EXHAUSTED | Returning NO_DISTINCT_MECHANISM_ESTABLISHED`);
        return {
          status: STATUS.NO_DISTINCT_MECHANISM_ESTABLISHED,
          statusMessage: `Semantic role or axis alignment failure after ${depthGateMaxAttempts} attempts: ${reasons.join("; ")}`,
          primaryMechanism: null as any,
          alternativeMechanism: null,
          axisConsistency: { consistent: false, primaryAxis, mechanismAxis: primaryAxis, failures: reasons },
          confidenceScore: 0.2,
          executionTimeMs: Date.now() - startTime,
          engineVersion: ENGINE_VERSION,
          diagnostics,
          productTruthSnapshotId: resolvedSnapshotId,
          productTruthFingerprint: resolvedFingerprint,
        };
      } else if (roleVerdict.verdict === "BLOCK") {
        console.error(`[MechanismEngine] SEMANTIC_ROLE_BLOCKED | ${roleVerdict.reasons.join("; ")}`);
        return {
          status: STATUS.NO_DISTINCT_MECHANISM_ESTABLISHED,
          statusMessage: `Semantic role blocked: ${roleVerdict.reasons.join("; ")}`,
          primaryMechanism: null as any,
          alternativeMechanism: null,
          axisConsistency: { consistent: false, primaryAxis, mechanismAxis: primaryAxis, failures: roleVerdict.reasons },
          confidenceScore: 0.1,
          executionTimeMs: Date.now() - startTime,
          engineVersion: ENGINE_VERSION,
          diagnostics,
          productTruthSnapshotId: resolvedSnapshotId,
          productTruthFingerprint: resolvedFingerprint,
        };
      }

      // 2. Gate 0: Structural Authority Validation (uses full canonical Product Truth inventory)
      if (mechCaps.length > 0) {
        const authCheck = validateAuthorityBoundaries({
          engineId: "mechanism",
          centralProblemTexts: primaryMech.mechanismProblem ? [primaryMech.mechanismProblem] : [],
          capabilityRefs: primaryMech.capabilityRefs,
          operationalClaims: roleVerdict.operationalClaims,
          unsupportedPredicates: roleVerdict.unsupportedPredicates,
          selectedPains: [],
          capabilities: mechCaps,
        });
        if (!authCheck.passed) {
          console.warn(`[MechanismEngine] AUTHORITY_VIOLATION | ${authCheck.violations.map(v => v.detail).join("; ")}`);
          if (depthAttempt < depthGateMaxAttempts) {
            lastCandidateForRepair = primaryMech;
            lastPassedClaims = computePassedClaimsFromRound();
            lastUnsupportedPredicates = [
              ...(roleVerdict.unsupportedPredicates || []),
              ...authCheck.violations.map((v) => v.detail),
            ];
            diagnostics.repairHandoff = {
              productTruthSnapshotId: resolvedSnapshotId,
              productTruthFingerprint: resolvedFingerprint,
              unsupportedPredicates: lastUnsupportedPredicates,
              rejectionReasons: authCheck.violations.map((v) => v.retryFeedback),
              passedClaims: lastPassedClaims,
              supportingFactIds: mechCaps.map((c) => c.sourceFactId || c.capabilityId),
            };
            depthRejectionContext = buildTargetedRepairDirective({
              unsupportedPredicates: lastUnsupportedPredicates,
              rejectionReasons: authCheck.violations.map((v) => v.retryFeedback),
              capabilities: mechCaps,
              passedClaims: lastPassedClaims,
              previousCandidate: primaryMech,
              snapshotId: resolvedSnapshotId,
              snapshotFingerprint: resolvedFingerprint,
            });
            continue;
          }
          console.error(`[MechanismEngine] AUTHORITY_EXHAUSTED | Returning NO_DISTINCT_MECHANISM_ESTABLISHED`);
          return {
            status: STATUS.NO_DISTINCT_MECHANISM_ESTABLISHED,
            statusMessage: `Authority violation after ${depthGateMaxAttempts} attempts: ${authCheck.violations.map(v => v.detail).join("; ")}`,
            primaryMechanism: null as any,
            alternativeMechanism: null,
            axisConsistency: { consistent: false, primaryAxis, mechanismAxis: primaryAxis, failures: authCheck.violations.map(v => v.detail) },
            confidenceScore: 0.2,
            executionTimeMs: Date.now() - startTime,
            engineVersion: ENGINE_VERSION,
            diagnostics,
            productTruthSnapshotId: resolvedSnapshotId,
            productTruthFingerprint: resolvedFingerprint,
          };
        }

        primaryMech.factualCapabilities = authCheck.canonicalFactualClaims || [];
        primaryMech.proposedExecutions = authCheck.proposedExecutions || [];
        primaryMech.operationalClaims = roleVerdict.operationalClaims;
      }

      const finalValidation = {
        consistent: roleVerdict.axisVerdict === "ALIGNED",
        failures: roleVerdict.axisVerdict === "ALIGNED" ? [] : [roleVerdict.axisReason || "Axis misaligned"],
      };
      diagnostics.axisValidation = finalValidation;

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

      depthGateLog.push(`Attempt ${depthAttempt}: PASSED (depthScore=${celDepth.causalDepthScore})`);
      if (celDepth.violations.length > 0) {
        for (const logEntry of celDepth.enforcementLog) {
          console.log(`[MechanismEngine] CEL_DEPTH: ${logEntry}`);
        }
      } else {
        console.log(`[MechanismEngine] CEL_DEPTH: CLEAN | depthScore=${celDepth.causalDepthScore} | rootCauseRefs=${celDepth.rootCauseReferences}`);
      }

      const rawConfidence = computeConfidence(primaryMech, primaryAxis, pillars, roleVerdict.axisVerdict === "ALIGNED");
      const depthPenaltyFactor = celDepth.passed ? 1.0 : Math.max(0.5, celDepth.score);
      const rawLLMConfidence = clamp(rawConfidence * depthPenaltyFactor);

      const confidence = rawLLMConfidence;
      const inheritedConfidence = rawLLMConfidence;
      const confidencePenalty = 0;

      const depthGateResult = buildDepthGateResult(celDepth, depthAttempt, depthGateMaxAttempts, depthGateLog, celSourceTexts);

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

      console.log(`[MechanismEngine-v2] COMPLETE | mechanism="${primaryMech.mechanismName}" | axis=${primaryAxis} | role=${primaryMech.mechanismAuthorityRole} | consistent=${finalValidation.consistent} | rawConf=${rawLLMConfidence.toFixed(2)} | finalConf=${confidence.toFixed(2)} | depthScore=${celDepth.causalDepthScore} | depthAttempts=${depthAttempt} | ptSnapshot=${resolvedSnapshotId} | ptFingerprint=${resolvedFingerprint}`);

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
        inheritedConfidence,
        rawLLMConfidence,
        confidencePenalty,
        alternativeMechanisms,
        productTruthSnapshotId: resolvedSnapshotId,
        productTruthFingerprint: resolvedFingerprint,
      };
    } catch (error: any) {
      console.error(`[MechanismEngine] ERROR | ${error.message}`);
      if (depthAttempt < depthGateMaxAttempts) {
        depthGateLog.push(`Attempt ${depthAttempt}: ERROR (${error.message})`);
        continue;
      }
      return {
        status: STATUS.NO_DISTINCT_MECHANISM_ESTABLISHED,
        statusMessage: `Mechanism generation failed: ${error.message}`,
        primaryMechanism: null as any,
        alternativeMechanism: null,
        axisConsistency: { consistent: false, primaryAxis, mechanismAxis: primaryAxis, failures: [error.message] },
        confidenceScore: 0.2,
        executionTimeMs: Date.now() - startTime,
        engineVersion: ENGINE_VERSION,
        diagnostics: { ...diagnostics, error: error.message },
        productTruthSnapshotId: resolvedSnapshotId,
        productTruthFingerprint: resolvedFingerprint,
      };
    }
  }

  return {
    status: STATUS.NO_DISTINCT_MECHANISM_ESTABLISHED,
    statusMessage: "Mechanism generation failed after all depth gate attempts",
    primaryMechanism: null as any,
    alternativeMechanism: null,
    axisConsistency: { consistent: false, primaryAxis, mechanismAxis: primaryAxis, failures: ["All attempts failed"] },
    confidenceScore: 0,
    executionTimeMs: Date.now() - startTime,
    engineVersion: ENGINE_VERSION,
    diagnostics,
    productTruthSnapshotId: resolvedSnapshotId,
    productTruthFingerprint: resolvedFingerprint,
  };
}

function buildMechanismOutput(
  raw: any,
  primaryAxis: string,
  pillars: any[],
  productTruthSnapshotId?: string,
  productTruthFingerprint?: string,
): MechanismOutput {
  const topPillar = pillars.length > 0 ? (pillars[0].name || pillars[0].territory || "core pillar") : "core pillar";

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

  const capabilityRefs = Array.isArray(raw.capabilityRefs)
    ? raw.capabilityRefs.filter((r: any) => typeof r === "string" && r.trim().length > 0).map((r: string) => r.trim())
    : undefined;

  const proposedExecutions = Array.isArray(raw.proposedExecutions)
    ? raw.proposedExecutions.filter((p: any) => typeof p === "string" && p.trim().length > 0)
    : undefined;

  const operationalClaims = Array.isArray(raw.operationalClaims)
    ? raw.operationalClaims
    : undefined;

  const mechanismAuthorityRole: MechanismAuthorityRole =
    raw.mechanismAuthorityRole === "VERIFIED_EXISTING_PROCESS" ||
    raw.mechanismAuthorityRole === "PROPOSED_EXECUTION" ||
    raw.mechanismAuthorityRole === "STRATEGIC_SYNTHESIS"
      ? raw.mechanismAuthorityRole
      : "STRATEGIC_SYNTHESIS";

  return {
    mechanismName: raw.name || "Unnamed Mechanism",
    mechanismType: raw.type || "system",
    mechanismAuthorityRole,
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
    structuralFrame: raw.structuralFrame || `The ${raw.name || "Core"} Approach`,
    differentiationLink: `Mechanism anchored to ${topPillar} via ${primaryAxis} axis`,
    whyItWorks,
    failureModes,
    causalChain,
    commercialFunction,
    upstreamDependency,
    capabilityRefs,
    proposedExecutions,
    operationalClaims,
    productTruthSnapshotId,
    productTruthFingerprint,
  };
}

export function sanitizeRepairedMechanismName(name: string, primaryAxis?: string): string {
  if (!name || typeof name !== "string") return "";
  let clean = name.trim();
  clean = clean.replace(/^["'`]+|["'`]+$/g, "").trim();
  const axisTokens = [
    "whitespace_positioning",
    "whitespace positioning",
    "whitespace-positioning",
    "whitespace",
    "positioning_framework",
    "positioning framework",
    "positioning_strategy",
    "positioning strategy",
    "positioning",
  ];
  if (primaryAxis) {
    const norm = primaryAxis.toLowerCase().replace(/_/g, " ");
    axisTokens.push(norm);
    axisTokens.push(primaryAxis.toLowerCase());
  }
  for (const token of axisTokens) {
    const regex = new RegExp(`\\b${token}\\b`, "gi");
    clean = clean.replace(regex, "").trim();
  }
  clean = clean.replace(/[\s\-_]+$/, "").replace(/^[\s\-_]+/, "").trim();
  clean = clean.replace(/\s{2,}/g, " ");
  return clean;
}

export function validateMechanismName(
  name: string,
  domainVocab?: string,
  mechAnchor?: ProductAnchor | null,
  capabilities?: ValidatedCapability[] | string[],
  primaryAxis?: string,
): { valid: boolean; reason?: string } {
  if (!name || typeof name !== "string" || name.trim() === "" || name === "Unnamed Mechanism" || name === "Pending Mechanism") {
    return { valid: false, reason: "Name is empty or placeholder" };
  }
  const lower = name.toLowerCase().replace(/^the\s+/, "").trim();

  // If anchored, match against anchor name or feature
  if (mechAnchor) {
    const anchorName = (mechAnchor.name || "").toLowerCase();
    const anchorDiff = (mechAnchor.differentiatingFeature || "").toLowerCase();
    if (anchorName && (anchorName.includes(lower) || lower.includes(anchorName))) {
      return { valid: true };
    }
    if (anchorDiff && (anchorDiff.includes(lower) || lower.includes(anchorDiff))) {
      return { valid: true };
    }
  }

  // Structural hygiene: Reject positioning strategy labels or axis leakage
  if (lower.includes("positioning") || lower.includes("whitespace positioning") || lower.endsWith("whitespace")) {
    return { valid: false, reason: `Name "${name}" is positioning strategy terminology, not an operational mechanism` };
  }

  if (primaryAxis) {
    const axisNorm = primaryAxis.toLowerCase().replace(/_/g, " ").trim();
    if (axisNorm.length > 3 && (lower === axisNorm || lower.includes(`${axisNorm} positioning`))) {
      return { valid: false, reason: `Name "${name}" leaks primary axis label into mechanism name` };
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
