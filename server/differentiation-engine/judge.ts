
import { z } from "zod";
import { aiChat } from "../ai-client";
import { buildCompactDifferentiationPromptInput } from "./proposer";
import {
  CanonicalDifferentiationInput,
  DifferentiationCandidate,
  DifferentiationJudgeOutput,
  JudgeDefect,
} from "./types";

const log = (ctx: string, msg: string) => console.log(`[${ctx}] ${msg}`);

export const VALID_DEFECT_CODES = [
  "GENERIC_INTERCHANGEABLE",
  "CAPABILITY_NOT_DIFFERENTIATION",
  "VALUE_MISTAKEN_FOR_DIFFERENTIATION",
  "PRODUCT_TRUTH_UNSUPPORTED",
  "MI_BASELINE_UNSUPPORTED",
  "COMPETITIVE_SCOPE_OVERCLAIM",
  "UNSUPPORTED_NEGATIVE_CLAIM",
  "MECHANISM_HALLUCINATED",
  "PAIN_MEANING_DRIFT",
  "BUYER_VALUE_NOT_ESTABLISHED",
  "LINEAGE_REFERENCE_INVALID",
  "STRUCTURAL_DISPOSITION_MISSING",
  "SPECIFICITY_LACKING",
  "COMMERCIAL_MEANINGFULNESS",
] as const;

export function normalizeJudgeDefectCode(val: unknown): string {
  if (typeof val !== "string" || !val.trim()) return "SPECIFICITY_LACKING";
  const upper = val.toUpperCase().trim().replace(/[^A-Z0-9_]/g, "_");
  if (VALID_DEFECT_CODES.includes(upper as any)) return upper;
  if (upper.includes("COMMERCIAL") || upper.includes("MEANINGFUL")) return "VALUE_MISTAKEN_FOR_DIFFERENTIATION";
  if (upper.includes("CAPABILITY") || upper.includes("FEATURE")) return "CAPABILITY_NOT_DIFFERENTIATION";
  if (upper.includes("GENERIC") || upper.includes("INTERCHANGEABLE")) return "GENERIC_INTERCHANGEABLE";
  if (upper.includes("PRODUCT") || upper.includes("FACT")) return "PRODUCT_TRUTH_UNSUPPORTED";
  if (upper.includes("NEGATIVE") || upper.includes("UNSUPPORTED_NEG")) return "UNSUPPORTED_NEGATIVE_CLAIM";
  if (upper.includes("COMPETIT") || upper.includes("SCOPE") || upper.includes("OVERCLAIM")) return "COMPETITIVE_SCOPE_OVERCLAIM";
  if (upper.includes("BASELINE") || upper.includes("MI_")) return "MI_BASELINE_UNSUPPORTED";
  if (upper.includes("PAIN") || upper.includes("LANE") || upper.includes("DRIFT") || upper.includes("RELEVANCE")) return "PAIN_MEANING_DRIFT";
  if (upper.includes("MECHANISM")) return "MECHANISM_HALLUCINATED";
  if (upper.includes("BUYER") || upper.includes("VALUE")) return "BUYER_VALUE_NOT_ESTABLISHED";
  if (upper.includes("LINEAGE")) return "LINEAGE_REFERENCE_INVALID";
  if (upper.includes("STRUCTURAL") || upper.includes("DISPOSITION")) return "STRUCTURAL_DISPOSITION_MISSING";
  if (upper.includes("EVIDENCE") || upper.includes("COMPLETE")) return "PRODUCT_TRUTH_UNSUPPORTED";
  if (upper.includes("STRATEGIC") || upper.includes("ROLE")) return "CAPABILITY_NOT_DIFFERENTIATION";
  return "SPECIFICITY_LACKING";
}

const DifferentiationJudgeDefectSchema = z.object({
  differentiationId: z.string().optional(),
  painId: z.string().optional(),
  code: z.preprocess(normalizeJudgeDefectCode, z.enum(VALID_DEFECT_CODES)),
  reason: z.string().min(1).default("Defect identified by Differentiation Judge"),
  unsupportedStatement: z.string().optional(),
  missingOrContradictedAuthority: z.string().optional(),
  whatEvidenceEstablishes: z.string().optional(),
  usableComponents: z.preprocess(
    (v) => (Array.isArray(v) ? v.map(String) : []),
    z.array(z.string()).optional()
  ),
  rejectedFields: z.preprocess(
    (v) => (Array.isArray(v) ? v.map(String) : typeof v === "string" ? [v] : []),
    z.array(z.string())
  ),
  fixDirective: z.string().min(1).default("Ensure candidate aligns with verified evidence."),
});

const DifferentiationJudgeAssessmentSchema = z.object({
  productFactualSupport: z.preprocess((v) => Boolean(v), z.boolean()),
  competitiveFactualSupport: z.preprocess((v) => Boolean(v), z.boolean()),
  audienceLaneRelevance: z.preprocess((v) => Boolean(v), z.boolean()),
  commercialMeaningfulness: z.preprocess((v) => Boolean(v), z.boolean()),
  strategicRoleValidity: z.preprocess((v) => Boolean(v), z.boolean()),
  evidenceCompleteness: z.preprocess((v) => Boolean(v), z.boolean()),
});

const DifferentiationJudgeResponseSchema = z.object({
  valid: z.preprocess((v) => Boolean(v), z.boolean()),
  assessmentsCompleted: z.preprocess((v) => Boolean(v), z.boolean()),
  assessmentDetails: DifferentiationJudgeAssessmentSchema,
  defects: z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(DifferentiationJudgeDefectSchema)),
  overallVerdictRationale: z.string().min(1).default("Judge assessment complete"),
});

const JUDGE_PROMPT = `
You are the Independent Differentiation Judge.
Your mandate is to evaluate each proposed differentiation candidate against the exact CanonicalDifferentiationInput under rigorous, practical strategic and evidentiary standards.

EVALUATION ASSESSMENTS:

1. PRODUCT FACTUAL SUPPORT (productFactualSupport):
   - Verify that every material product attribute, ingredient, provenance, production process, pricing fact, or policy asserted in the candidate is grounded in ourProductFacts / Product Truth.
   - PRACTICAL PARAPHRASE & SYNTHESIS STANDARD:
     * Accept faithful paraphrases of verified product facts, ordinary descriptive wording, coherent combinations of complementary facts, and bounded explanations of buyer value.
     * Do NOT require every phrase to appear verbatim in ourProductFacts.
   - DISTINGUISH NATURAL DESCRIPTION FROM MATERIAL NEW PROMISES:
     * Verified ingredient provenance (e.g. Antep pistachio use) supports describing the ingredient and its provenance; it does NOT automatically establish guaranteed superior taste.
     * Verified production frequency (e.g. daily production in Gaziantep) supports describing production frequency; it does NOT automatically establish guaranteed moistness, mold prevention, or guaranteed freshness on arrival.
   - Reject with PRODUCT_TRUTH_UNSUPPORTED if the candidate invents unverified guarantees, certifications, laboratory results, or technical mechanisms absent from ourProductFacts.

2. COMPETITIVE FACTUAL SUPPORT (competitiveFactualSupport):
   - Evaluate comparisonBaseline against BOTH competitiveAuthority (miFacts) AND customerEvidence (canonical customer reviews/comments):
     * COMPETITOR_FACT: Supported by valid miAuthorityIds from competitiveAuthority within the cited scope.
     * COMPETITOR_CUSTOMER_VOICE: Customer reviews and comments about a specific competitor ARE valid competitive evidence when cited via customerEvidenceIds with a verified competitorId. Do NOT reject a comparisonBaseline merely because miAuthorityIds is empty if valid customerEvidenceIds support it!
     * UNATTRIBUTED_MARKET_VOICE: Cites customerEvidenceIds without a competitorId to establish a buyer concern in the market without attributing behavior to a specific competitor.
     * STRATEGIC_MARKET_EMPHASIS: Neutral non-comparative baseline focused on our product's verified strengths addressing the supported buyer concern (miAuthorityIds=[], customerEvidenceIds=[], competitorIds=[]).
   - STRICT CUSTOMER-EVIDENCE SCOPE RULES:
     * Single review != universal behavior: A competitor-linked review supports "A customer reviewing competitor X reported receiving dry baklava." It does NOT support "Competitor X always sells dry baklava."
     * Allegation status: An allegation of ingredient substitution (isAllegation=true) MUST remain an attributed customer allegation unless independent evidence establishes the underlying ingredient fact.
     * Product/variant scope: A review about a specific product or variant (productOrVariantScope) must NOT silently become a claim about every product sold by that competitor.
     * Unattributed commentary: General market commentary without a verified competitorId must NOT be attributed to a specific competitor.
     * Disclaimer trap: An "unverified competitor details" or "specific competitor practices are not verified" disclaimer does NOT cure an uncited accusation about competitors.

3. AUDIENCE & LANE RELEVANCE (audienceLaneRelevance):
   - Verify that the differentiation directly addresses the cited CORE pain and buyer tension within the strategic lane.
   - If the claim drifts into solving unrelated issues, reject with code PAIN_MEANING_DRIFT.

4. COMMERCIAL MEANINGFULNESS (commercialMeaningfulness):
   - Evaluate whether the candidate establishes a coherent, grounded strategic emphasis or comparative contrast addressing the buyer's purchase hesitation.
   - Do NOT demand proprietary technology, explicit guarantees, or proven global exclusivity for STRATEGIC_MARKET_EMPHASIS. Coherent combinations of complementary verified facts explaining bounded buyer value satisfy commercial meaningfulness.

5. STRATEGIC ROLE VALIDITY (strategicRoleValidity):
   - Mechanisms must be ESTABLISHED from Product Truth facts or labeled as NO_DISTINCT_MECHANISM_ESTABLISHED. Reject MECHANISM_HALLUCINATED if an unverified operational engine is invented.
   - Keep product facts and customer experiences distinguishable in the explanation while allowing both to contribute to a comparison.

6. EVIDENCE COMPLETENESS (evidenceCompleteness):
   - All cited productTruthFactIds, miAuthorityIds, and customerEvidenceIds must exist in the canonical input and match the run's tenant, campaign, offering, and snapshot boundaries.

OUTPUT SCHEMA:
Return a JSON object matching this exact structure:
{
  "valid": boolean,
  "assessmentsCompleted": true,
  "assessmentDetails": {
    "productFactualSupport": boolean,
    "competitiveFactualSupport": boolean,
    "audienceLaneRelevance": boolean,
    "commercialMeaningfulness": boolean,
    "strategicRoleValidity": boolean,
    "evidenceCompleteness": boolean
  },
  "defects": [
    {
      "differentiationId": "string",
      "painId": "string",
      "code": "GENERIC_INTERCHANGEABLE | CAPABILITY_NOT_DIFFERENTIATION | VALUE_MISTAKEN_FOR_DIFFERENTIATION | PRODUCT_TRUTH_UNSUPPORTED | MI_BASELINE_UNSUPPORTED | COMPETITIVE_SCOPE_OVERCLAIM | UNSUPPORTED_NEGATIVE_CLAIM | MECHANISM_HALLUCINATED | PAIN_MEANING_DRIFT | BUYER_VALUE_NOT_ESTABLISHED | LINEAGE_REFERENCE_INVALID | STRUCTURAL_DISPOSITION_MISSING | SPECIFICITY_LACKING",
      "reason": "Detailed explanation of the failure",
      "unsupportedStatement": "Exact quote or phrase that is unsupported or weak",
      "missingOrContradictedAuthority": "Exact authority missing or contradicted",
      "whatEvidenceEstablishes": "What the available evidence actually verifies",
      "usableComponents": ["List of components or citations that remain valid"],
      "rejectedFields": ["Field names to be revised"],
      "fixDirective": "Actionable instructions for targeted repair"
    }
  ],
  "overallVerdictRationale": "Summary of evaluation"
}

ENFORCEMENT RULES:
- If ANY defect exists, valid MUST be false.
- If ANY assessment in assessmentDetails is false, valid MUST be false.
- Do NOT mark valid true if there are unsupported assertions or missing evidence.
`;

export function validateCandidateComparisonAndScopeDeterministically(
  input: CanonicalDifferentiationInput,
  cand: DifferentiationCandidate
): JudgeDefect[] {
  const defects: JudgeDefect[] = [];
  const ourProductFacts = (input.ourProductFacts && input.ourProductFacts.length > 0)
    ? input.ourProductFacts
    : (input.productTruth || []);
  const miFacts = (input.miFacts && input.miFacts.length > 0)
    ? input.miFacts
    : (input.competitiveAuthority || []);
  const customerEvidence = input.customerEvidence || [];

  const expectedAccountId = input.lineage?.accountId || "";
  const expectedCampaignId = input.lineage?.campaignId || "";
  const expectedOfferingId = input.lineage?.campaignOfferingId || "";
  const expectedPtSnapshotId = input.lineage?.productTruthSnapshotId || "";
  const expectedMiSnapshotId = input.lineage?.miSnapshotId || "";

  const factById = new Map<string, any>();
  for (const f of ourProductFacts) {
    const id = f.productTruthFactId || f.factId || f.id;
    if (id) factById.set(String(id), f);
  }
  const miById = new Map<string, any>();
  for (const m of miFacts) {
    if (m.miAuthorityId) miById.set(String(m.miAuthorityId), m);
  }
  const custEvById = new Map<string, any>();
  for (const ce of customerEvidence) {
    if (ce.customerEvidenceId) custEvById.set(String(ce.customerEvidenceId), ce);
    for (const ruid of ce.rawEvidenceUids || []) {
      if (!custEvById.has(String(ruid))) custEvById.set(String(ruid), ce);
    }
  }

  const candId = cand.differentiationId;
  const primaryPainId = cand.corePainIds?.[0];

  // 1. Validate cited productTruthFactIds & boundary isolation (Case I)
  const citedFactIds = Array.isArray(cand.productTruthFactIds) ? cand.productTruthFactIds : [];
  if (citedFactIds.length === 0) {
    defects.push({
      differentiationId: candId,
      painId: primaryPainId,
      code: "PRODUCT_TRUTH_UNSUPPORTED",
      reason: "Candidate cites zero productTruthFactIds.",
      rejectedFields: ["productTruthFactIds", "differentiationClaim"],
      fixDirective: "Cite verified productTruthFactIds from ourProductFacts.",
    });
  }
  for (const fid of citedFactIds) {
    const fact = factById.get(fid);
    if (!fact) {
      defects.push({
        differentiationId: candId,
        painId: primaryPainId,
        code: "LINEAGE_REFERENCE_INVALID",
        reason: `Cited productTruthFactId '${fid}' does not exist in the canonical Product Truth snapshot.`,
        missingOrContradictedAuthority: fid,
        rejectedFields: ["productTruthFactIds"],
        fixDirective: "Remove unknown productTruthFactIds and cite only facts in ourProductFacts.",
      });
      continue;
    }
    if (expectedOfferingId && fact.campaignOfferingId && fact.campaignOfferingId !== expectedOfferingId) {
      defects.push({
        differentiationId: candId,
        painId: primaryPainId,
        code: "LINEAGE_REFERENCE_INVALID",
        reason: `Cited productTruthFactId '${fid}' belongs to offering '${fact.campaignOfferingId}', not '${expectedOfferingId}'.`,
        missingOrContradictedAuthority: fid,
        rejectedFields: ["productTruthFactIds", "differentiationClaim"],
        fixDirective: "Cite only Product Truth facts belonging to the active campaign offering.",
      });
    }
    if (expectedAccountId && fact.accountId && fact.accountId !== expectedAccountId) {
      defects.push({
        differentiationId: candId,
        painId: primaryPainId,
        code: "LINEAGE_REFERENCE_INVALID",
        reason: `Cited productTruthFactId '${fid}' belongs to a different account '${fact.accountId}'.`,
        missingOrContradictedAuthority: fid,
        rejectedFields: ["productTruthFactIds", "differentiationClaim"],
        fixDirective: "Cite only Product Truth facts belonging to the active account.",
      });
    }
    if (expectedPtSnapshotId && fact.snapshotId && fact.snapshotId !== expectedPtSnapshotId) {
      defects.push({
        differentiationId: candId,
        painId: primaryPainId,
        code: "LINEAGE_REFERENCE_INVALID",
        reason: `Cited productTruthFactId '${fid}' belongs to stale snapshot '${fact.snapshotId}', expected '${expectedPtSnapshotId}'.`,
        missingOrContradictedAuthority: fid,
        rejectedFields: ["productTruthFactIds", "differentiationClaim"],
        fixDirective: "Cite only Product Truth facts from the run's frozen Product Truth snapshot.",
      });
    }
  }

  // 2. Validate comparisonBaseline citations, scope, allegations, and disclaimer trap
  const baseline = cand.comparisonBaseline || { statement: "", miAuthorityIds: [], customerEvidenceIds: [], competitorIds: [] };
  const stmt = String(baseline.statement || "").trim();
  const miIds = Array.isArray(baseline.miAuthorityIds) ? baseline.miAuthorityIds : [];
  const custIds = Array.isArray(baseline.customerEvidenceIds)
    ? baseline.customerEvidenceIds
    : (Array.isArray(cand.customerEvidenceIds) ? cand.customerEvidenceIds : []);
  const compIds = Array.isArray(baseline.competitorIds) ? baseline.competitorIds : [];

  // 2a. Check MI authority IDs & snapshot/account isolation
  for (const mid of miIds) {
    const miItem = miById.get(mid);
    if (!miItem) {
      defects.push({
        differentiationId: candId,
        painId: primaryPainId,
        code: "LINEAGE_REFERENCE_INVALID",
        reason: `Cited miAuthorityId '${mid}' does not exist in competitiveAuthority.`,
        missingOrContradictedAuthority: mid,
        rejectedFields: ["comparisonBaseline.miAuthorityIds", "comparisonBaseline.statement"],
        fixDirective: "Cite only valid miAuthorityIds from competitiveAuthority or use valid customerEvidenceIds.",
      });
      continue;
    }
    if (expectedMiSnapshotId && miItem.miSnapshotId && miItem.miSnapshotId !== expectedMiSnapshotId) {
      defects.push({
        differentiationId: candId,
        painId: primaryPainId,
        code: "LINEAGE_REFERENCE_INVALID",
        reason: `Cited miAuthorityId '${mid}' belongs to MI snapshot '${miItem.miSnapshotId}', expected '${expectedMiSnapshotId}'.`,
        missingOrContradictedAuthority: mid,
        rejectedFields: ["comparisonBaseline.miAuthorityIds", "comparisonBaseline.statement"],
        fixDirective: "Cite only MI authorities from the run's active MI snapshot.",
      });
    }
  }

  // 2b. Check customerEvidenceIds & tenant/campaign/offering/snapshot isolation (Case I)
  const resolvedCustEv: any[] = [];
  for (const cid of custIds) {
    const ce = custEvById.get(cid);
    if (!ce) {
      defects.push({
        differentiationId: candId,
        painId: primaryPainId,
        code: "LINEAGE_REFERENCE_INVALID",
        reason: `Cited customerEvidenceId '${cid}' does not exist in the run's frozen customerEvidence manifest.`,
        missingOrContradictedAuthority: cid,
        rejectedFields: ["comparisonBaseline.customerEvidenceIds", "comparisonBaseline.statement"],
        fixDirective: "Cite only canonical customerEvidenceIds present in customerEvidence.",
      });
      continue;
    }
    if (expectedAccountId && ce.accountId && ce.accountId !== expectedAccountId) {
      defects.push({
        differentiationId: candId,
        painId: primaryPainId,
        code: "LINEAGE_REFERENCE_INVALID",
        reason: `Cited customerEvidenceId '${cid}' belongs to account '${ce.accountId}', not '${expectedAccountId}'.`,
        missingOrContradictedAuthority: cid,
        rejectedFields: ["comparisonBaseline.customerEvidenceIds", "comparisonBaseline.statement"],
        fixDirective: "Remove cross-account customer evidence references.",
      });
      continue;
    }
    if (expectedCampaignId && ce.campaignId && ce.campaignId !== expectedCampaignId) {
      defects.push({
        differentiationId: candId,
        painId: primaryPainId,
        code: "LINEAGE_REFERENCE_INVALID",
        reason: `Cited customerEvidenceId '${cid}' belongs to campaign '${ce.campaignId}', not '${expectedCampaignId}'.`,
        missingOrContradictedAuthority: cid,
        rejectedFields: ["comparisonBaseline.customerEvidenceIds", "comparisonBaseline.statement"],
        fixDirective: "Remove cross-campaign customer evidence references.",
      });
      continue;
    }
    if (expectedOfferingId && ce.campaignOfferingId && ce.campaignOfferingId !== expectedOfferingId) {
      defects.push({
        differentiationId: candId,
        painId: primaryPainId,
        code: "LINEAGE_REFERENCE_INVALID",
        reason: `Cited customerEvidenceId '${cid}' belongs to offering '${ce.campaignOfferingId}', not '${expectedOfferingId}'.`,
        missingOrContradictedAuthority: cid,
        rejectedFields: ["comparisonBaseline.customerEvidenceIds", "comparisonBaseline.statement"],
        fixDirective: "Remove customer evidence references scoped to a different campaign offering.",
      });
      continue;
    }
    resolvedCustEv.push(ce);
  }

  // 2c. Forbidden Disclaimer Trap (Step 4)
  const hasDisclaimerTrap =
    /\b(specific\s+competitor\s+(?:details|practices)\s+are\s+(?:unverified|not\s+verified)|though\s+competitor\s+specifics\s+are\s+unverified)\b/i.test(stmt) &&
    miIds.length === 0 &&
    custIds.length === 0;
  if (hasDisclaimerTrap) {
    defects.push({
      differentiationId: candId,
      painId: primaryPainId,
      code: "COMPETITIVE_SCOPE_OVERCLAIM",
      reason: "comparisonBaseline.statement uses an 'unverified competitor details/practices' disclaimer to make uncited market/competitor claims with empty miAuthorityIds and empty customerEvidenceIds.",
      unsupportedStatement: stmt,
      missingOrContradictedAuthority: "No miAuthorityIds or customerEvidenceIds cited.",
      rejectedFields: ["comparisonBaseline.statement"],
      fixDirective: "Either cite valid customerEvidenceIds/miAuthorityIds with bounded attribution, or replace with a neutral STRATEGIC_MARKET_EMPHASIS baseline.",
    });
  }

  // 2d. Unattributed review must NOT acquire fabricated competitor association (Case F)
  if (resolvedCustEv.length > 0 && miIds.length === 0) {
    const verifiedCustCompIds = new Set(
      resolvedCustEv
        .map((ce) => ce.competitorId)
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    );
    const fabricatedCompIds = compIds.filter((id) => !verifiedCustCompIds.has(id));
    if (fabricatedCompIds.length > 0) {
      defects.push({
        differentiationId: candId,
        painId: primaryPainId,
        code: "COMPETITIVE_SCOPE_OVERCLAIM",
        reason: `comparisonBaseline claims competitorIds [${fabricatedCompIds.join(", ")}] that are not associated with the cited customerEvidenceIds.`,
        unsupportedStatement: stmt,
        missingOrContradictedAuthority: fabricatedCompIds.join(", "),
        rejectedFields: ["comparisonBaseline.competitorIds", "comparisonBaseline.statement"],
        fixDirective: "Do not invent competitor attribution for unattributed customer reviews; keep competitorIds empty and state the buyer concern without competitor attribution.",
      });
    }
    if (verifiedCustCompIds.size === 0 && /\b(competitor\s+[A-Z0-9_]+|güllüoğlu|gulluoglu|karaköy|karakoy|hafiz\s+mustafa|koçak|kocak|imam\s+cagdas)\b/i.test(stmt)) {
      defects.push({
        differentiationId: candId,
        painId: primaryPainId,
        code: "COMPETITIVE_SCOPE_OVERCLAIM",
        reason: "comparisonBaseline.statement attributes customer complaints to a specific competitor when the cited customerEvidence has no verified competitor association.",
        unsupportedStatement: stmt,
        rejectedFields: ["comparisonBaseline.statement"],
        fixDirective: "Remove invented competitor attribution from comparisonBaseline.statement; describe the unattributed customer concern at the market level.",
      });
    }
  }

  // 2e. Allegation status enforcement (Case G): ingredient substitution allegation must remain an attributed allegation
  const hasAllegationEvidence = resolvedCustEv.some((ce) => ce.isAllegation === true);
  const combinedClaimAndBaseline = `${stmt} ${cand.differentiationClaim || ""}`;
  const mentionsIngredientSubstitution =
    /\b(pea\s+puree|bezelye\s+püresi|fake\s+pistachio|artificial\s+dye|food\s+coloring|adulterat\w*|substitut\w*\s+(?:pistachio\w*\s+)?with\s+pea|uses?\s+pea\s+puree|sells?\s+pea\s+puree)\b/i.test(
      combinedClaimAndBaseline
    );
  if ((hasAllegationEvidence || mentionsIngredientSubstitution) && miIds.length === 0) {
    const hasAttributedAllegationFraming =
      /\b(customer\w*|reviewer\w*|shopper\w*|buyer\w*|user\w*|discussant\w*|commenter\w*|reddit\s+user\w*)\b[\s\S]{0,180}\b(alleg\w*|report\w*|claim\w*|complained|stated|noted|described|accused|suspected)\b|\b(alleged\s+by|customer\s+allegation|attributed\s+customer\s+complaint|reported\s+receiving)\b/i.test(
        stmt
      );
    const statesSubstitutionAsFact =
      /\b(competitors?\s+(?:use|substitute|replace|sell)\s+(?:green\s+)?pea\s+puree|uses?\s+(?:green\s+)?pea\s+puree\s+instead\s+of|[a-z]+\s+substitutes?\s+(?:green\s+)?pea\s+puree|[a-z]+\s+uses?\s+fake\s+pistachio)\b/i.test(
        combinedClaimAndBaseline
      ) && !hasAttributedAllegationFraming;

    if (statesSubstitutionAsFact || (mentionsIngredientSubstitution && !hasAttributedAllegationFraming)) {
      defects.push({
        differentiationId: candId,
        painId: primaryPainId,
        code: "COMPETITIVE_SCOPE_OVERCLAIM",
        reason: "Customer allegation of ingredient substitution must remain an attributed customer allegation/report unless independent evidence establishes the underlying ingredient fact.",
        unsupportedStatement: stmt,
        rejectedFields: ["comparisonBaseline.statement"],
        fixDirective: "Frame the ingredient-substitution complaint explicitly as an attributed customer allegation or report within its exact product scope.",
      });
    }
  }

  // 2f. Single complaint / product-scoped complaint overgeneralization check (Case H)
  const universalOverclaimPattern =
    /\b(always\s+sells?|never\s+uses?|all\s+of\s+their\s+products|every\s+product\s+sold\s+by|across\s+all\s+products|entire\s+product\s+line|systematically\s+sells?|universally\s+fails?|all\s+competitors\s+sell)\b/i;
  if (universalOverclaimPattern.test(combinedClaimAndBaseline)) {
    const rejectedFields: string[] = [];
    if (universalOverclaimPattern.test(stmt)) rejectedFields.push("comparisonBaseline.statement");
    if (universalOverclaimPattern.test(cand.differentiationClaim || "")) rejectedFields.push("differentiationClaim");
    defects.push({
      differentiationId: candId,
      painId: primaryPainId,
      code: "COMPETITIVE_SCOPE_OVERCLAIM",
      reason: "Candidate generalizes customer feedback into a universal competitor-wide or market-wide claim ('always sells', 'every product sold by', etc.) not supported by the scope or prevalence of the evidence.",
      unsupportedStatement: stmt,
      rejectedFields: rejectedFields.length > 0 ? rejectedFields : ["comparisonBaseline.statement"],
      fixDirective: "Narrow the statement to the specific customer report(s) and product/variant scope established by the cited evidence.",
    });
  }

  // Check product/variant scope overgeneralization when evidence is scoped to a specific variant
  const scopedEvidenceItems = resolvedCustEv.filter((ce) => ce.productOrVariantScope);
  if (scopedEvidenceItems.length > 0 && scopedEvidenceItems.length === resolvedCustEv.length) {
    const broadBrandClaimPattern =
      /\b(every\s+product|all\s+baklava\s+sold\s+by|all\s+products\s+from|brand-wide|across\s+its\s+entire\s+catalog)\b/i;
    if (broadBrandClaimPattern.test(combinedClaimAndBaseline)) {
      defects.push({
        differentiationId: candId,
        painId: primaryPainId,
        code: "COMPETITIVE_SCOPE_OVERCLAIM",
        reason: `Cited customer evidence is scoped to '${scopedEvidenceItems[0].productOrVariantScope}', which cannot support a claim about every product sold by that competitor.`,
        unsupportedStatement: stmt,
        rejectedFields: ["comparisonBaseline.statement"],
        fixDirective: `Keep the comparison scoped to '${scopedEvidenceItems[0].productOrVariantScope}'.`,
      });
    }
  }

  // 3. Unsupported material guarantees check on differentiationClaim / buyerValue (Case C + Digital/Commercial/Access Guarantees)
  const allFactText = ourProductFacts.map((f: any) => `${f.fact || ""} ${f.statement || ""}`).join(" ").toLowerCase();
  const claimAndValueText = `${cand.differentiationClaim || ""} ${cand.buyerValue || ""}`;
  const proofBoundaryText = String(cand.proofBoundary || "");
  const guaranteeChecks: Array<{ pattern: RegExp; factKeyword: RegExp; label: string }> = [
    {
      pattern: /\b(guarantees?\s+(?:moistness|zero\s+dryness|never\s+dry|freshness\s+on\s+arrival|mold[- ]free|mold\s+prevention)|guaranteed\s+(?:not\s+to\s+dry|superior\s+taste|best\s+taste\s+in\s+the\s+market|moisture\s+retention))\b/i,
      factKeyword: /\b(guarantee\w*\s+(?:moist|fresh|taste|mold))\b/i,
      label: "guaranteed sensory outcome, moisture retention, mold prevention, or superior taste guarantee",
    },
    {
      pattern: /\b(patented\s+moisture[- ]lock|laboratory[- ]certified\s+taste|zero[- ]downtime\s+SLA\s+guarantee|100%\s+mold[- ]proof\s+seal)\b/i,
      factKeyword: /\b(patented|laboratory[- ]certified|zero[- ]downtime|mold[- ]proof)\b/i,
      label: "unverified technical certification or patented mechanism",
    },
    {
      pattern: /\b(permanent(?:\s+and\s+unrestricted)?\s+access|unrestricted\s+access|lifetime\s+(?:access|hosting|storage)|immediate\s+ownership|full\s+(?:commercial\s+|copyright\s+)?ownership|DRM[- ]free\s+guarantee)\b/i,
      factKeyword: /\b(permanent|unrestricted|lifetime\s+(?:access|hosting|storage)|immediate\s+ownership|commercial\s+ownership|copyright\s+ownership|drm[- ]free)\b/i,
      label: "unverified permanent/unrestricted access, lifetime hosting, or immediate ownership guarantee",
    },
    {
      pattern: /\b(guarantees?\s+(?:no|zero)\s+(?:hidden|post-purchase|extra)\s+(?:fees?|charges?)|avoiding\s+unexpected\s+post-purchase\s+charges|without\s+(?:fear\s+of\s+)?(?:hidden\s+fees|surprise\s+add-ons)|zero\s+hidden\s+fees)\b/i,
      factKeyword: /\b(no\s+hidden\s+fees|zero\s+hidden\s+fees|zero\s+post-purchase|no\s+extra\s+charges|no\s+surprise\s+add-ons)\b/i,
      label: "unverified zero-post-purchase-fee or no-hidden-fees guarantee",
    },
  ];
  for (const chk of guaranteeChecks) {
    if (chk.pattern.test(claimAndValueText) && !chk.factKeyword.test(allFactText)) {
      const rejFields: string[] = [];
      if (chk.pattern.test(cand.differentiationClaim || "")) rejFields.push("differentiationClaim");
      if (chk.pattern.test(cand.buyerValue || "")) rejFields.push("buyerValue");
      defects.push({
        differentiationId: candId,
        painId: primaryPainId,
        code: "PRODUCT_TRUTH_UNSUPPORTED",
        reason: `Candidate asserts ${chk.label}, which goes beyond the verified facts in ourProductFacts.`,
        unsupportedStatement: claimAndValueText,
        rejectedFields: rejFields.length > 0 ? rejFields : ["differentiationClaim"],
        fixDirective: "Narrow the wording to describe the verified product capabilities, delivery format, or pricing tiers without promising unverified guarantees.",
      });
    }
  }

  // 3b. Proof-boundary self-contradiction check: if proofBoundary admits a guarantee is not stated/proven, claim/buyerValue must not assert it
  const boundaryContradictionPairs: Array<{ boundaryDisclaims: RegExp; claimAsserts: RegExp; label: string }> = [
    {
      boundaryDisclaims: /\b(permanent\s+hosting|permanent\s+access|drm[- ]free)[\s\S]{0,80}\b(not\s+(?:explicitly\s+)?(?:stated|proven|guaranteed|detailed)|unverified)\b/i,
      claimAsserts: /\b(permanent(?:\s+and\s+unrestricted)?\s+access|unrestricted\s+access|immediate\s+ownership|lifetime\s+access)\b/i,
      label: "permanent/unrestricted access or ownership that its own proofBoundary admits is not stated in Product Truth",
    },
    {
      boundaryDisclaims: /\b(post-purchase\s+fees|hidden\s+fees|billing\s+dispute)[\s\S]{0,80}\b(not\s+(?:explicitly\s+)?(?:stated|proven|guaranteed|detailed)|unverified)\b/i,
      claimAsserts: /\b(avoiding\s+unexpected\s+post-purchase\s+charges|without\s+(?:fear\s+of\s+)?(?:hidden\s+fees|surprise\s+add-ons)|zero\s+post-purchase\s+fees)\b/i,
      label: "absence of post-purchase/hidden fees that its own proofBoundary admits is not detailed in Product Truth",
    },
  ];
  for (const pair of boundaryContradictionPairs) {
    if (pair.boundaryDisclaims.test(proofBoundaryText) && pair.claimAsserts.test(claimAndValueText)) {
      const rejFields: string[] = [];
      if (pair.claimAsserts.test(cand.differentiationClaim || "")) rejFields.push("differentiationClaim");
      if (pair.claimAsserts.test(cand.buyerValue || "")) rejFields.push("buyerValue");
      const alreadyFlagged = defects.some(
        (d) => d.differentiationId === candId && d.code === "PRODUCT_TRUTH_UNSUPPORTED"
      );
      if (!alreadyFlagged) {
        defects.push({
          differentiationId: candId,
          painId: primaryPainId,
          code: "PRODUCT_TRUTH_UNSUPPORTED",
          reason: `Candidate asserts ${pair.label}.`,
          unsupportedStatement: claimAndValueText,
          rejectedFields: rejFields.length > 0 ? rejFields : ["differentiationClaim"],
          fixDirective: "Align differentiationClaim and buyerValue with proofBoundary by removing guarantees that proofBoundary notes are unproven.",
        });
      }
    }
  }

  return defects;
}

export async function judgeDifferentiation(
  input: CanonicalDifferentiationInput,
  candidates: DifferentiationCandidate[]
): Promise<DifferentiationJudgeOutput> {
  log("DifferentiationJudge", "Running independent semantic judge");

  const ourProductFacts = (input.ourProductFacts && input.ourProductFacts.length > 0)
    ? input.ourProductFacts
    : (input.productTruth || []);
  const customerEvidence = input.customerEvidence || [];

  const targetPainIds = Array.from(
    new Set(candidates.flatMap((c) => c.corePainIds || []).filter(Boolean))
  );
  const boundedInput = buildCompactDifferentiationPromptInput(input, {
    targetPainIds: targetPainIds.length > 0 ? targetPainIds : undefined,
  });

  const systemPrompt =
    JUDGE_PROMPT +
    "\n\nCANONICAL INPUT:\n" +
    JSON.stringify(boundedInput) +
    "\n\nCANDIDATES FOR EVALUATION:\n" +
    JSON.stringify(candidates);

  try {
    const response = await aiChat({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: "Evaluate the proposed differentiation candidates according to the 6 assessments and return the strict JSON verdict." }
      ],
      response_format: { type: "json_object" },
      model: "gpt-4.1-mini",
      accountId: (input as any).accountId || input.lineage?.accountId || "a2d87878-a1e9-41ea-a8a5-90beff569673",
      endpoint: "differentiation",
      temperature: 0.1,
      max_tokens: 2500,
    });

    const rawContent = response.choices?.[0]?.message?.content || "{}";
    const rawJson = JSON.parse(rawContent);

    const parseResult = DifferentiationJudgeResponseSchema.safeParse(rawJson);
    if (!parseResult.success) {
      log("DifferentiationJudge", `Schema validation failed: ${JSON.stringify(parseResult.error.format())} | rawContent=${rawContent}`);
      return {
        valid: false,
        assessmentsCompleted: false,
        assessmentDetails: {
          productFactualSupport: false,
          competitiveFactualSupport: false,
          audienceLaneRelevance: false,
          commercialMeaningfulness: false,
          strategicRoleValidity: false,
          evidenceCompleteness: false,
        },
        defects: candidates.map(c => ({
          differentiationId: c.differentiationId,
          code: "SPECIFICITY_LACKING",
          reason: `Judge response failed schema contract validation: ${parseResult.error.issues.map(i => i.message).join("; ")}`,
          rejectedFields: ["differentiationClaim"],
          fixDirective: "Ensure Judge output strictly adheres to DifferentiationJudgeResponseSchema with all assessment booleans and structured defect fields.",
        })),
        overallVerdictRationale: "Judge output schema validation failure.",
      };
    }

    const data = parseResult.data;

    // Associate any defects missing valid differentiationId
    data.defects.forEach((d: any) => {
      if (!d.differentiationId || !candidates.some(c => c.differentiationId === d.differentiationId)) {
        if (d.painId) {
          const match = candidates.find(c => {
            const pids = Array.isArray(c.corePainIds) ? c.corePainIds : (Array.isArray((c as any).painIds) ? (c as any).painIds : []);
            return pids.includes(d.painId);
          });
          if (match?.differentiationId) {
            d.differentiationId = match.differentiationId;
          }
        }
        if (!d.differentiationId && candidates.length === 1) {
          d.differentiationId = candidates[0].differentiationId;
        }
      }
    });

    const validFactIdSet = new Set(
      ourProductFacts.map((f: any) => f.productTruthFactId || f.factId || f.id).filter(Boolean)
    );
    const validCustEvById = new Map<string, any>();
    for (const ce of customerEvidence) {
      if (ce.customerEvidenceId) validCustEvById.set(String(ce.customerEvidenceId), ce);
      for (const ruid of ce.rawEvidenceUids || []) {
        if (!validCustEvById.has(String(ruid))) validCustEvById.set(String(ruid), ce);
      }
    }

    // Filter out only:
    // 1) Spurious defects complaining solely about duplicate fact IDs when citations have already been deduplicated.
    // 2) Spurious defects rejecting a valid COMPETITOR_CUSTOMER_VOICE baseline solely because miAuthorityIds is empty
    //    when valid competitor-linked customerEvidenceIds are cited and deterministic scope validation passes.
    if (data.defects.length > 0) {
      data.defects = data.defects.filter((d: any) => {
        const cand = candidates.find((c) => c.differentiationId === d.differentiationId) || (candidates.length === 1 ? candidates[0] : undefined);
        const candFactIds = Array.isArray(cand?.productTruthFactIds)
          ? Array.from(new Set(cand!.productTruthFactIds.filter((id) => validFactIdSet.has(id))))
          : [];
        const combinedText = `${d.reason || ""} ${d.missingOrContradictedAuthority || ""} ${d.unsupportedStatement || ""}`;

        const isDuplicateFactIdComplaint =
          /repetition of the same fact id|repeated fact id|duplicate.*fact id|multiple times without additional distinct/i.test(combinedText) &&
          candFactIds.length >= 1;
        if (isDuplicateFactIdComplaint) {
          log("DifferentiationJudge", `DETERMINISTIC_CITATION_GUARD: Stripping duplicate-fact-ID defect on candidate ${d.differentiationId}`);
          return false;
        }

        if (cand) {
          const custIds = Array.isArray(cand.comparisonBaseline?.customerEvidenceIds)
            ? cand.comparisonBaseline.customerEvidenceIds
            : (Array.isArray(cand.customerEvidenceIds) ? cand.customerEvidenceIds : []);
          const hasValidCompetitorCustVoice =
            custIds.length > 0 &&
            custIds.every((id) => {
              const ce = validCustEvById.get(id);
              return ce && typeof ce.competitorId === "string" && ce.competitorId.trim().length > 0;
            });
          const detDefects = validateCandidateComparisonAndScopeDeterministically(input, cand);
          const complainsOnlyAboutEmptyMiAuthorityIds =
            hasValidCompetitorCustVoice &&
            detDefects.length === 0 &&
            (d.code === "MI_BASELINE_UNSUPPORTED" || d.code === "COMPETITIVE_SCOPE_OVERCLAIM" || d.code === "UNSUPPORTED_NEGATIVE_CLAIM") &&
            d.rejectedFields?.every((f: string) => f.startsWith("comparisonBaseline")) &&
            /\b(miAuthorityIds\s+is\s+empty|no\s+miAuthorityIds|missing\s+miAuthorityId|without\s+miAuthorityIds)\b/i.test(combinedText);
          if (complainsOnlyAboutEmptyMiAuthorityIds) {
            log("DifferentiationJudge", `CUSTOMER_VOICE_AUTHORITY_GUARD: Accepting valid competitor-linked customerEvidenceIds on candidate ${d.differentiationId} despite empty miAuthorityIds`);
            return false;
          }

          const demandsDisclaimedGuaranteeForStrategicEmphasis =
            data.assessmentDetails?.productFactualSupport === true &&
            detDefects.length === 0 &&
            cand.strategicForm === "STRATEGIC_MARKET_EMPHASIS" &&
            d.code === "COMMERCIAL_MEANINGFULNESS" &&
            /\bdoes\s+not\s+(?:claim|guarantee)\b/i.test(cand.proofBoundary || "") &&
            /\b(provide\s+explicit\s+[\w\s-]*guarantee|no\s+explicit\s+product\s+truth\s+fact[\s\S]*verifies\s+direct\s+[\w\s-]*guarantees|while\s+grounded\s+in\s+product\s+truth,\s+it\s+does\s+not\s+prove)\b/i.test(
              `${d.reason || ""} ${d.missingOrContradictedAuthority || ""} ${d.fixDirective || ""}`
            );
          if (demandsDisclaimedGuaranteeForStrategicEmphasis) {
            log(
              "DifferentiationJudge",
              `STRATEGIC_EMPHASIS_BOUNDARY_GUARD: Stripping self-contradictory guarantee demand on grounded candidate ${d.differentiationId}`
            );
            return false;
          }
        }

        return true;
      });
    }

    // Append any deterministic boundary/scope/allegation/guarantee defects not already caught
    for (const cand of candidates) {
      const detDefects = validateCandidateComparisonAndScopeDeterministically(input, cand);
      for (const dd of detDefects) {
        const alreadyPresent = data.defects.some(
          (existing: any) =>
            existing.differentiationId === dd.differentiationId &&
            existing.code === dd.code &&
            existing.rejectedFields?.some((rf: string) => dd.rejectedFields.includes(rf))
        );
        if (!alreadyPresent) {
          data.defects.push(dd as any);
          if (dd.code === "PRODUCT_TRUTH_UNSUPPORTED") {
            data.assessmentDetails.productFactualSupport = false;
          } else if (dd.code === "LINEAGE_REFERENCE_INVALID") {
            data.assessmentDetails.evidenceCompleteness = false;
          } else if (
            dd.code === "COMPETITIVE_SCOPE_OVERCLAIM" ||
            dd.code === "MI_BASELINE_UNSUPPORTED" ||
            dd.code === "UNSUPPORTED_NEGATIVE_CLAIM"
          ) {
            data.assessmentDetails.competitiveFactualSupport = false;
          }
        }
      }
    }

    if (
      data.defects.length === 0 &&
      data.assessmentsCompleted === true &&
      data.assessmentDetails.productFactualSupport === true &&
      data.assessmentDetails.audienceLaneRelevance === true &&
      data.assessmentDetails.commercialMeaningfulness === true &&
      data.assessmentDetails.strategicRoleValidity === true &&
      data.assessmentDetails.evidenceCompleteness === true
    ) {
      data.assessmentDetails.competitiveFactualSupport = true;
      data.valid = true;
    }

    const hasDefects = data.defects.length > 0;
    const allAssessmentsTrue =
      data.assessmentsCompleted === true &&
      data.assessmentDetails.productFactualSupport === true &&
      data.assessmentDetails.competitiveFactualSupport === true &&
      data.assessmentDetails.audienceLaneRelevance === true &&
      data.assessmentDetails.commercialMeaningfulness === true &&
      data.assessmentDetails.strategicRoleValidity === true &&
      data.assessmentDetails.evidenceCompleteness === true;

    // Fail-closed enforcement: explicit valid === true, all assessments passed, and zero blocking defects
    const isStrictlyValid = data.valid === true && !hasDefects && allAssessmentsTrue;

    // If there is a contradiction (e.g. data.valid is true but defects exist or assessments failed), force valid = false
    if (data.valid === true && (hasDefects || !allAssessmentsTrue)) {
      log("DifferentiationJudge", "CONTRADICTION_DETECTED: Judge claimed valid=true but defects exist or assessments failed. Forcing valid=false.");
      if (data.defects.length === 0) {
        if (candidates.length > 0) {
          candidates.forEach(c => {
            data.defects.push({
              differentiationId: c.differentiationId,
              code: "CAPABILITY_NOT_DIFFERENTIATION",
              reason: "Contradictory assessment: one or more required assessments failed but no explicit defects were listed.",
              rejectedFields: ["differentiationClaim"],
              fixDirective: "Re-evaluate candidate against failed assessment areas.",
            });
          });
        } else {
          data.defects.push({
            code: "CAPABILITY_NOT_DIFFERENTIATION",
            reason: "Contradictory assessment: one or more required assessments failed but no explicit defects were listed.",
            rejectedFields: ["differentiationClaim"],
            fixDirective: "Re-evaluate candidate against failed assessment areas.",
          });
        }
      }
    }

    return {
      valid: isStrictlyValid,
      assessmentsCompleted: data.assessmentsCompleted,
      assessmentDetails: data.assessmentDetails,
      defects: data.defects as JudgeDefect[],
      overallVerdictRationale: data.overallVerdictRationale,
    };
  } catch (e: any) {
    log("DifferentiationJudge", `Failed to parse LLM response: ${e.message}`);
    return {
      valid: false,
      assessmentsCompleted: false,
      assessmentDetails: {
        productFactualSupport: false,
        competitiveFactualSupport: false,
        audienceLaneRelevance: false,
        commercialMeaningfulness: false,
        strategicRoleValidity: false,
        evidenceCompleteness: false,
      },
      defects: candidates.length > 0
        ? candidates.map(c => ({
            differentiationId: c.differentiationId,
            code: "GENERIC_INTERCHANGEABLE" as const,
            reason: `Judge execution exception: ${e.message}`,
            rejectedFields: ["differentiationClaim"],
            fixDirective: "Fix output format and ensure valid JSON is produced.",
          }))
        : [
            {
              code: "GENERIC_INTERCHANGEABLE" as const,
              reason: `Judge execution exception: ${e.message}`,
              rejectedFields: [],
              fixDirective: "Fix output format and ensure valid JSON is produced.",
            },
          ],
      overallVerdictRationale: "Fatal parse/execution exception in Differentiation Judge.",
    };
  }
}

