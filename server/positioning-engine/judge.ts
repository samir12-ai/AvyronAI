import { aiChat, classifyAIError } from "../ai-client";
import type { ProductAnchor } from "../shared/product-dna";

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

export interface PositioningCandidateToJudge {
  name: string;
  enemyDefinition: string;
  contrastAxis: string;
  narrativeDirection: string;
  capabilityRefs?: string[];
}

export interface EmbeddedFactualPredicate {
  predicate: string;
  category: "MATERIAL_COMPOSITION" | "PHYSICAL_PERFORMANCE" | "OPERATIONAL_PROCESS" | "SKU_OR_COMMERCIAL" | "PROPOSED_DIRECTION" | "OTHER";
  isSupported: boolean;
  supportedByCapability?: string | null;
  reasonIfNotSupported?: string;
}

export interface PositioningOperationalClaim {
  claim: string;
  role: "STRATEGIC_SYNTHESIS" | "EXISTING_FACTUAL_CLAIM" | "PROPOSED_EXECUTION";
  capabilityRef?: string | null;
}

export interface PositioningFactualPostureVerdict {
  verdict: "ACCEPTED" | "REJECTED" | "NOT_EVALUATED";
  positioningRoleVerdict: "VALID" | "INVALID" | "UNKNOWN";
  factualPostureVerdict: "GROUNDED" | "UNSUPPORTED" | "UNKNOWN";
  differentiationAlignmentVerdict: "ALIGNED" | "MISALIGNED" | "UNKNOWN";
  painLaneAlignmentVerdict: "ALIGNED" | "MISALIGNED" | "UNKNOWN";
  epistemicClassification?: "SUPPORTED_CAPABILITY" | "STRATEGIC_SYNTHESIS" | "PROPOSED_CAPABILITY";
  rationale?: string;
  assumptions?: string[];
  validationNeeds?: string[];
  errorCategory?: string;
  reason: string;
  fix: string;
  embeddedFactualPredicates: EmbeddedFactualPredicate[];
  unsupportedPredicates: string[];
  operationalClaims: PositioningOperationalClaim[];
}

const UNSUPPORTED_HARD_GUARANTEE_REGEX =
  /\b(permanent\s+(?:and\s+unrestricted\s+)?(?:hosted\s+)?access|unrestricted\s+(?:usage\s+|commercial\s+)?rights|no\s+(?:hidden|additional|unexpected)\s+(?:post-purchase\s+)?(?:fees|charges)|lifetime\s+(?:hosting|storage|access|warranty)|100%\s+money[- ]back\s+guarantee|24[- ]hour\s+guaranteed|pay\s+only\s+(?:when|if|after)\s+(?:you\s+are\s+|you're\s+|they\s+are\s+|customers?\s+are\s+|buyers?\s+are\s+|fully\s+|completely\s+)?satisfied|satisfaction[-\s]contingent\s+payment|only\s+pay\s+for\s+a\s+(?:song|product|track|deliverable)\s+(?:they|you)\s+love\s+and\s+are\s+satisfied\s+with|mass[-\s]produced\s+automated\s+prompt\s+workflows?|template[-\s]bound\s+(?:music\s+generation\s+|song\s+|custom\s+song\s+)?(?:services?|workflows?|platforms?)\s+(?:produce|generate|rely\s+on|deliver|create)|blind[-\s]purchase\s+(?:custom\s+)?(?:song\s+|audio\s+)?services?\s+with\s+isolated\s+audio\s+tracks?)\b/i;

export async function judgePositioningFactualPosture(input: {
  candidate: PositioningCandidateToJudge;
  productTruthCapabilities?: string[];
  productAnchor?: ProductAnchor | null;
  differentiation?: string;
  approvedPains?: string[];
  competitorComparisonContext?: string;
  accountId?: string;
}): Promise<PositioningFactualPostureVerdict> {
  const { candidate, productTruthCapabilities = [], productAnchor, differentiation = "", approvedPains = [], competitorComparisonContext = "", accountId } = input;

  const capsList = productTruthCapabilities.length > 0
    ? productTruthCapabilities.map((c, i) => `${i + 1}. ${c}`).join("\n")
    : "None established in Product Truth";

  const painsList = approvedPains.length > 0
    ? approvedPains.map(p => `- ${p}`).join("\n")
    : "None established";

  const prompt = `You are a Hostile Independent Factual Posture & Semantic Role Judge for a strategic Positioning Engine.
Your job is to rigorously verify whether a candidate Positioning Territory stays within its legitimate strategic authority or violates factual posture, while distinguishing between:
1. SUPPORTED_CAPABILITY: Positioning claims directly backed by verbatim facts in Verified Product Truth Capabilities.
2. STRATEGIC_SYNTHESIS: Strategic market interpretations grounded in verified Product Truth and Approved Customer Pains.
3. PROPOSED_CAPABILITY: Legitimate proposed positioning directions that combine verified Product Truth capabilities (e.g., online custom song creation) with real customer problems (e.g., delivery/access friction) into a recommended strategic direction requiring validation/implementation — WITHOUT asserting unverified hard factual guarantees.
4. UNSUPPORTED FACTUAL GUARANTEES (MUST REJECT): False or unverified factual assertions about physical materials ("linen", "cotton", "breathable"), fake lab certifications/QA testing systems, or unverified legal/commercial guarantees ("permanent hosted access", "unrestricted usage rights", "no additional fees", "lifetime hosting").

════ AUTHORITY BOUNDARIES & CRITICAL CONTRACT RULE ════
1. POSITIONING OWNS:
   WHERE to compete and WHY we win strategically (market tension, category enemy, contrast axis, narrative angle).
   A positioning idea does NOT need to appear verbatim in source evidence: it may combine verified product capabilities and real customer problems into a proposed strategic direction, provided it does NOT assert unverified hard factual guarantees.
2. POSITIONING DOES NOT OWN AND MAY NOT INVENT HARD FACTUAL GUARANTEES:
   - Unverified physical product attributes (materials, technical specs, fiber types, physical properties).
   - Unverified operational company testing/QA systems (lab testing protocols, inspection workflows, certification standards) presented as already-existing infrastructure.
   - Unverified commercial/hosting/licensing guarantees (permanent access, lifetime storage, unrestricted rights, zero fees) not present in Product Truth.
3. CRITICAL DISTINCTION — PROPOSED DIRECTION vs UNSUPPORTED GUARANTEE:
   - ALLOWED (ACCEPTED as STRATEGIC_SYNTHESIS or PROPOSED_CAPABILITY):
     Contrasting the product's verified delivery model (e.g. online custom song creation from personal stories and genre selection) against a market/competitor failure (e.g. opaque post-purchase access or poor delivery communication) to propose a strategic direction centered on clear, accessible online delivery expectations.
   - FORBIDDEN (REJECTED as UNSUPPORTED):
     Upgrading "online delivery" into "guaranteed permanent cloud hosting with unrestricted usage rights and no additional fees", upgrading "pay when gifting or obtaining the full final product" into "pay only when satisfied", asserting unverified competitor internal workflows ("mass-produced automated prompt workflows"), or upgrading "dresses" into "breathable 100% linen/cotton with lab-tested opacity guarantees".

════ EVALUATION INSTRUCTIONS ════
PHASE 1: POSITIONING ROLE VERDICT
- Does the candidate describe WHERE / WHY WE WIN (market angle, customer worldview, category enemy, strategic contrast)?
- Set positioningRoleVerdict: "VALID" | "INVALID".

PHASE 2: EMBEDDED FACTUAL PREDICATE EXTRACTION & EPISTEMIC CLASSIFICATION
Extract embedded predicates inside the candidate (name, enemyDefinition, contrastAxis, narrativeDirection):
- If a predicate asserts a hard physical/material property, existing QA/testing certification, commercial/hosting/licensing guarantee, satisfaction-contingent payment policy, unverified competitor internal workflow, or market-wide competitor contrast NOT supported by Product Truth / Competitor Evidence: set isSupported: false.
- If a predicate is a strategic synthesis or proposed positioning angle combining verified Product Truth with Approved Customer Pains (without asserting unverified hard guarantees): set category: "PROPOSED_DIRECTION", isSupported: true.
- Classify the territory's overall epistemicClassification:
  * "SUPPORTED_CAPABILITY": All claims are directly stated in Product Truth.
  * "STRATEGIC_SYNTHESIS": Pure strategic framing of verified capabilities vs market pain.
  * "PROPOSED_CAPABILITY": Combines verified capabilities and real customer pains into a proposed positioning direction that requires operational/execution validation. Populate "rationale", "assumptions", and "validationNeeds".

PHASE 3: FACTUAL POSTURE VERDICT
- If ANY embedded predicate is an unsupported hard factual guarantee (isSupported: false):
  * factualPostureVerdict MUST BE "UNSUPPORTED"
  * verdict MUST BE "REJECTED"
  * Populate "unsupportedPredicates" with the exact unsupported phrases.
- Otherwise:
  * factualPostureVerdict is "GROUNDED"
  * verdict is "ACCEPTED" (when positioningRoleVerdict is "VALID").

VERIFIED PRODUCT TRUTH CAPABILITIES (THE SOLE FACTUAL AUTHORITY):
${capsList}

APPROVED CUSTOMER PAINS:
${painsList}

${competitorComparisonContext ? `COMPETITOR EVIDENCE & COUNTEREXAMPLES (DO NOT CONTRADICT):\n${competitorComparisonContext}\n\n` : ""}STRATEGIC CONTEXT (DIFFERENTIATION / STRATEGIC LENSES — NOT FACTUAL AUTHORITY):
${differentiation || "None provided"}

PRODUCT ANCHOR:
${productAnchor ? `Name: ${productAnchor.name}, Type: ${productAnchor.type}, Problem: ${productAnchor.coreProblemSolved}, Differentiator: ${productAnchor.differentiatingFeature}` : "None"}

CANDIDATE POSITIONING TERRITORY TO JUDGE:
Name: "${candidate.name}"
Enemy Definition: "${candidate.enemyDefinition}"
Contrast Axis: "${candidate.contrastAxis}"
Narrative Direction: "${candidate.narrativeDirection}"
Cited CapabilityRefs: ${JSON.stringify(candidate.capabilityRefs || [])}

Respond with ONLY valid JSON:
{
  "verdict": "ACCEPTED" | "REJECTED",
  "positioningRoleVerdict": "VALID" | "INVALID",
  "factualPostureVerdict": "GROUNDED" | "UNSUPPORTED",
  "differentiationAlignmentVerdict": "ALIGNED" | "MISALIGNED",
  "painLaneAlignmentVerdict": "ALIGNED" | "MISALIGNED",
  "epistemicClassification": "SUPPORTED_CAPABILITY" | "STRATEGIC_SYNTHESIS" | "PROPOSED_CAPABILITY",
  "rationale": "Why this positioning direction connects verified capabilities to the customer problem",
  "assumptions": ["Any strategic or operational assumptions involved in this positioning direction"],
  "validationNeeds": ["What must be verified or maintained in execution to support this positioning direction"],
  "reason": "Detailed explanation of judgment",
  "fix": "Actionable repair directive if rejected, otherwise empty string",
  "embeddedFactualPredicates": [
    {
      "predicate": "exact phrase from candidate",
      "category": "MATERIAL_COMPOSITION" | "PHYSICAL_PERFORMANCE" | "OPERATIONAL_PROCESS" | "SKU_OR_COMMERCIAL" | "PROPOSED_DIRECTION" | "OTHER",
      "isSupported": true | false,
      "supportedByCapability": "verified capability text or cap_xxx, or null if unsupported",
      "reasonIfNotSupported": "why this predicate is an unsupported factual guarantee"
    }
  ],
  "unsupportedPredicates": ["list of any unsupported factual guarantees, or empty array"]
}`;

  try {
    const resp = await aiChat({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1500,
      temperature: 0.1,
      response_format: { type: "json_object" },
      endpoint: "positioning-factual-posture-judge",
      accountId,
    });

    const content = resp?.choices?.[0]?.message?.content?.trim() || "{}";
    const parsed = safeJsonParse(content);

    if (parsed && (parsed.verdict === "ACCEPTED" || parsed.verdict === "REJECTED")) {
      const embeddedFactualPredicates: EmbeddedFactualPredicate[] = Array.isArray(parsed.embeddedFactualPredicates)
        ? parsed.embeddedFactualPredicates
        : [];

      const rawOperationalClaims: any[] = Array.isArray(parsed.operationalClaims) ? parsed.operationalClaims : [];

      let operationalClaims: PositioningOperationalClaim[] = rawOperationalClaims.map(c => ({
        claim: c.claim || "",
        role: c.role || "STRATEGIC_SYNTHESIS",
        capabilityRef: c.capabilityRef || c.supportedByCapability || null,
      }));

      if (operationalClaims.length === 0 && embeddedFactualPredicates.length > 0) {
        operationalClaims = embeddedFactualPredicates.map(p => ({
          claim: p.predicate,
          role: p.category === "PROPOSED_DIRECTION" ? "PROPOSED_EXECUTION" : (p.isSupported ? "STRATEGIC_SYNTHESIS" : "EXISTING_FACTUAL_CLAIM"),
          capabilityRef: p.supportedByCapability || null,
        }));
      }

      if (embeddedFactualPredicates.length === 0 && operationalClaims.length > 0) {
        for (const c of operationalClaims) {
          const isSupported =
            (c.role === "EXISTING_FACTUAL_CLAIM" && !!c.capabilityRef) ||
            c.role === "STRATEGIC_SYNTHESIS" ||
            c.role === "PROPOSED_EXECUTION";
          embeddedFactualPredicates.push({
            predicate: c.claim,
            category: c.role === "PROPOSED_EXECUTION" ? "PROPOSED_DIRECTION" : "OTHER",
            isSupported,
            supportedByCapability: c.capabilityRef || null,
          });
        }
      }

      const unsupportedPredicates: string[] = embeddedFactualPredicates
        .filter(p => !p.isSupported)
        .map(p => p.predicate);

      if (Array.isArray(parsed.unsupportedPredicates)) {
        for (const up of parsed.unsupportedPredicates) {
          if (typeof up === "string" && up.trim() && !unsupportedPredicates.includes(up.trim())) {
            unsupportedPredicates.push(up.trim());
          }
        }
      }

      // Deterministic guard: never allow unsupported hard guarantees (e.g. permanent access, unrestricted rights, no additional fees)
      // to pass by being relabeled as Proposed when Product Truth does not establish them.
      const fullCandidateText = `${candidate.name} ${candidate.enemyDefinition} ${candidate.contrastAxis} ${candidate.narrativeDirection}`;
      const capsCombined = productTruthCapabilities.join(" ").toLowerCase();
      const hardGuaranteeMatch = fullCandidateText.match(UNSUPPORTED_HARD_GUARANTEE_REGEX);
      if (hardGuaranteeMatch && !capsCombined.includes(hardGuaranteeMatch[0].toLowerCase())) {
        if (!unsupportedPredicates.includes(hardGuaranteeMatch[0])) {
          unsupportedPredicates.push(hardGuaranteeMatch[0]);
        }
      }

      const hasUnsupportedPredicate = unsupportedPredicates.length > 0 ||
        operationalClaims.some(c => c.role === "EXISTING_FACTUAL_CLAIM" && !c.capabilityRef) ||
        parsed.factualPostureVerdict === "UNSUPPORTED";

      let verdict: "ACCEPTED" | "REJECTED" = parsed.verdict;
      let factualPostureVerdict: "GROUNDED" | "UNSUPPORTED" = parsed.factualPostureVerdict === "UNSUPPORTED" ? "UNSUPPORTED" : "GROUNDED";
      if (hasUnsupportedPredicate) {
        verdict = "REJECTED";
        factualPostureVerdict = "UNSUPPORTED";
      }

      const epistemicClassification: "SUPPORTED_CAPABILITY" | "STRATEGIC_SYNTHESIS" | "PROPOSED_CAPABILITY" =
        parsed.epistemicClassification === "SUPPORTED_CAPABILITY" ||
        parsed.epistemicClassification === "STRATEGIC_SYNTHESIS" ||
        parsed.epistemicClassification === "PROPOSED_CAPABILITY"
          ? parsed.epistemicClassification
          : (embeddedFactualPredicates.some(p => p.category === "PROPOSED_DIRECTION") ||
             operationalClaims.some(c => c.role === "PROPOSED_EXECUTION")
              ? "PROPOSED_CAPABILITY"
              : "STRATEGIC_SYNTHESIS");

      return {
        verdict,
        positioningRoleVerdict: parsed.positioningRoleVerdict === "INVALID" ? "INVALID" : "VALID",
        factualPostureVerdict,
        differentiationAlignmentVerdict: parsed.differentiationAlignmentVerdict === "MISALIGNED" ? "MISALIGNED" : "ALIGNED",
        painLaneAlignmentVerdict: parsed.painLaneAlignmentVerdict === "MISALIGNED" ? "MISALIGNED" : "ALIGNED",
        epistemicClassification,
        rationale: typeof parsed.rationale === "string" ? parsed.rationale.trim() : undefined,
        assumptions: Array.isArray(parsed.assumptions) ? parsed.assumptions.filter((x: any) => typeof x === "string" && x.trim()) : [],
        validationNeeds: Array.isArray(parsed.validationNeeds) ? parsed.validationNeeds.filter((x: any) => typeof x === "string" && x.trim()) : [],
        reason: typeof parsed.reason === "string" && parsed.reason.trim()
          ? parsed.reason
          : (unsupportedPredicates.length > 0
              ? `Positioning contains unsupported factual predicates: ${unsupportedPredicates.join("; ")}`
              : "Evaluated by positioning factual posture judge"),
        fix: typeof parsed.fix === "string" && parsed.fix.trim()
          ? parsed.fix
          : (unsupportedPredicates.length > 0
              ? `Remove or correct unsupported factual claims: ${unsupportedPredicates.join("; ")}. Ground strictly in verified Product Truth facts.`
              : ""),
        embeddedFactualPredicates,
        unsupportedPredicates,
        operationalClaims,
      };
    }

    return {
      verdict: "NOT_EVALUATED",
      positioningRoleVerdict: "UNKNOWN",
      factualPostureVerdict: "UNKNOWN",
      differentiationAlignmentVerdict: "UNKNOWN",
      painLaneAlignmentVerdict: "UNKNOWN",
      errorCategory: "MALFORMED_OUTPUT",
      reason: "Positioning factual posture judge returned unparseable evaluation",
      fix: "",
      embeddedFactualPredicates: [],
      unsupportedPredicates: [],
      operationalClaims: [],
    };
  } catch (err: any) {
    const classified = classifyAIError(err);
    console.warn(`[PositioningJudge] JUDGE_ERROR | category=${classified.category} | ${err.message}`);
    return {
      verdict: "NOT_EVALUATED",
      positioningRoleVerdict: "UNKNOWN",
      factualPostureVerdict: "UNKNOWN",
      differentiationAlignmentVerdict: "UNKNOWN",
      painLaneAlignmentVerdict: "UNKNOWN",
      errorCategory: classified.category,
      reason: `Positioning factual posture judge unavailable (${classified.category}): ${err.message}`,
      fix: "",
      embeddedFactualPredicates: [],
      unsupportedPredicates: [],
      operationalClaims: [],
    };
  }
}
