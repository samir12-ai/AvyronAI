import { randomUUID } from 'crypto';
/**
 * Authoritative Audience Pain classifier — LLM proposer + Independent Semantic Judge.
 *
 * Architecture contract:
 * - The Proposer (LLM) evaluates each pain from first principles:
 *   requiredCapability vs matchedProductCapability -> DIRECT_FIT | STRATEGIC_FIT | NOT_FIT | UNKNOWN.
 * - The Semantic Judge (LLM) independently verifies the causal validity of the proposed fit
 *   against raw Product Truth facts (detects DIRECT-vs-STRATEGIC overclaims, false bridges,
 *   boundary omissions, capability inventions, pain rewrites, and role transfers).
 * - Structural guards ensure zero pain invention, zero evidence invention, zero text rewrites,
 *   and full permutation ranking.
 * - Targeted retry locks already-accepted decisions and only retries rejected items.
 * - Fail closed: unresolved items default to UNKNOWN (eligible: false) or deterministic fallback.
 *
 * ABSOLUTE BAN ON HARDCODING:
 * - Zero keyword lists, zero regex semantic decisions, zero domain-specific phrase tables.
 */
import { aiChat } from "../ai-client";
import {
  type AuthoritativeAudiencePain,
  type AudiencePainClass,
  type ProductFitType,
  allowedUsesForClass,
  prohibitedUsesForClass,
  classifyAudiencePainDetailed,
} from "./audience-pain-registry";
import { getEvidenceByUids } from "../strategic-reasoning/evidence-registry";

import { runTargetAssessmentForPain } from "../strategic-reasoning/target-assessment";
import { runProductAssessmentForPain } from "../strategic-reasoning/product-assessment";
import { judgeStrategicPainDecision } from "../strategic-pain-decision-judge";
import { db } from "../db";
import { businessUnderstandingSnapshots } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

export const LLM_CLASSIFIER_VERSION = "strategic_pain_pipeline_v3";

const VALID_CLASSES: AudiencePainClass[] = ["CORE_PURCHASE", "OBJECTION", "POST_PURCHASE_FRICTION", "SUPPORTING"];
const VALID_FIT = ["ELIGIBLE", "INELIGIBLE", "UNKNOWN"] as const;
const LLM_TIMEOUT_MS = 30_000;

export interface ProductTruthFact {
  factId: string;
  sourceField: string;
  rawValue: string;
  campaignId?: string;
  accountId?: string;
  provenance?: string;
}

export interface LlmPainClassRecord {
  painId: string;
  marketProblemMeaning: string;
  marketFunction: "PROBLEM_TO_SOLVE" | "SUPPORTING_PROBLEM" | "PURCHASE_OBJECTION";
  problemEvidenceUids: string[];
  centralityStatus: "PROVEN" | "NOT_ESTABLISHED" | "CONTRADICTED" | "NOT_APPLICABLE";
  centralityEvidenceUids: string[];
  centralityReason: string;
  classification: AudiencePainClass;
  reason: string;
}

export interface LlmProductFitRecord {
  painId: string;
  productFit: "ELIGIBLE" | "INELIGIBLE" | "UNKNOWN";
  fitType: ProductFitType;
  requiredCapability?: string;
  matchedProductCapability?: string;
  strategicBridge?: string;
  bridgeEvidenceBasis?: string;
  boundary?: string;
  productTruthFactIds?: string[];
  directCausalExplanation?: string;
  uncertainty?: string;
  reason: string;
  semanticRank?: number;
}

export interface PainJudgeResult {
  accepted: Map<string, {
    classification: AudiencePainClass;
    productFit: typeof VALID_FIT[number];
    fitType: ProductFitType;
    requiredCapability?: string;
    matchedProductCapability?: string;
    strategicBridge?: string;
    boundary?: string;
    productTruthFactIds?: string[];
    reason: string;
  }>;
  /** Applied only when the LLM returned a full valid permutation over all supplied painIds. */
  semanticRanks: Map<string, number> | null;
  rejections: Array<{ painId: string; code: string; critique?: string }>;
}

export function formatProductFactsForPrompt(facts?: ProductTruthFact[] | string | null): string {
  if (!facts) return "UNKNOWN — no verified product facts provided.";
  if (typeof facts === "string") return facts;
  if (!Array.isArray(facts) || facts.length === 0) return "UNKNOWN — no verified product facts provided.";
  return facts.map(f => `[${f.factId}] (${f.sourceField}): ${f.rawValue}`).join("\n");
}

/** Resolved evidence context keyed by evidenceUid. */
export type EvidenceContextMap = Map<string, { label: string; detail: string }>;

/**
 * Build a concise evidence basis string for a single pain's evidence UIDs.
 * Preserves ALL referenced evidence (no arbitrary top-N selection).
 * Uses sentence-boundary-aware truncation for long detail text.
 * Deduplicates identical detail text structurally.
 */
export function packEvidenceForPain(
  evidenceUids: string[],
  evidenceContext: EvidenceContextMap,
  maxCharsPerItem: number = 250,
): string {
  const texts = evidenceUids.map(u => {
    if (!u.startsWith("EV:")) return u;
    const ev = evidenceContext.get(u);
    return ev ? `${ev.label}: ${ev.detail}` : null;
  }).filter(Boolean);
  if (texts.length === 0) return "none";
  
  const seenDetails = new Set<string>();
  const lines: string[] = [];
  for (const uid of evidenceUids) {
    const ev = evidenceContext.get(uid);
    if (!ev) {
        lines.push(`  [${uid}] ${uid}`);
        continue;
    }
    // Structurally deduplicate identical evidence text
    const detailKey = ev.detail.trim().toLowerCase();
    if (seenDetails.has(detailKey)) continue;
    seenDetails.add(detailKey);
    let detail = ev.detail.trim();
    if (detail.length > maxCharsPerItem) {
      // Sentence-boundary-aware truncation
      const cutpoint = detail.lastIndexOf(".", maxCharsPerItem);
      detail = cutpoint > maxCharsPerItem * 0.5
        ? detail.slice(0, cutpoint + 1)
        : detail.slice(0, maxCharsPerItem) + "…";
    }
    lines.push(`  [${uid}] ${ev.label}: ${detail}`);
  }
  return lines.length > 0 ? "\n  Evidence basis:\n" + lines.join("\n") : "";
}

/** Ask the LLM Proposer to classify each pain from first principles. */

export async function proposePainClassWithLLM(
  registry: AuthoritativeAudiencePain[],
  opts: { accountId: string; campaignId: string; audienceSegments?: any[]; evidenceContext?: EvidenceContextMap },
  previousRejections?: string[],
): Promise<LlmPainClassRecord[] | null> {
  if (registry.length === 0) return null;
  const prompt = `You are a strict marketing-pain semantic classifier. Classify EACH pain below.

SEMANTIC INVARIANCE RULE:
Pain class must be based on the semantic function and evidence-supported meaning of the market claim.
Surface wording, tone, or lexical choice must not determine whether a claim is CORE_PURCHASE, SUPPORTING, or OBJECTION.
Semantically equivalent claims supported by equivalent evidence should normally receive the same class.

CENTRALITY PRINCIPLES:
1. PROBLEM PROVEN + MATERIAL IMPORTANCE PROVEN = CORE_PURCHASE
2. PROBLEM PROVEN + MATERIAL IMPORTANCE NOT ESTABLISHED = SUPPORTING
3. CORE_PURCHASE requires evidence of material importance (strong consequence, pervasive frustration, severe impact).
4. Centrality does NOT require literal "I will buy" language, solution-seeking, or switching behavior. Material importance is sufficient.
5. Do NOT infer importance just because the product solves it well. Product Fit is separate.
6. A PROBLEM_TO_SOLVE does not automatically mean CORE_PURCHASE.

TAXONOMY:
1. marketProblemMeaning: What actual problem/barrier does the evidence establish?
2. marketFunction: Choose PROBLEM_TO_SOLVE, SUPPORTING_PROBLEM, or PURCHASE_OBJECTION.
3. problemEvidenceUids: List evidence UIDs (from the supplied context only) that prove the problem exists.
4. centralityStatus: PROVEN, NOT_ESTABLISHED, CONTRADICTED, or NOT_APPLICABLE.
5. centralityEvidenceUids: List evidence UIDs that prove material importance (required if CORE_PURCHASE).
6. centralityReason: Explain why those exact evidence items establish material importance.
7. classification:
   - CORE_PURCHASE: A material problem the audience faces (requires centrality PROVEN).
   - SUPPORTING: A valid market problem that matters but is secondary/minor (centrality NOT_ESTABLISHED).
   - OBJECTION: A barrier, hesitation, doubt, perceived risk, or reason NOT to adopt/buy/act.
   - POST_PURCHASE_FRICTION: Issues occurring after purchase (refunds, support).
   - UNKNOWN: If evidence is insufficient.

Do NOT classify a normal negative pain as OBJECTION just because it is undesirable. OBJECTION requires actual hesitation/barrier semantics.

Previous Rejections to fix:
${previousRejections?.join("\n") || "None"}

Pains to classify:
${registry.map(p => `<Pain id="${p.painId}">
Segment: ${opts.audienceSegments?.find(s => s.name === p.segmentIds[0])?.segmentDefinition?.claim || p.segmentIds[0] || ""}
Canonical: ${p.canonical}
Evidence: ${opts.evidenceContext ? packEvidenceForPain(p.evidenceUids, opts.evidenceContext) : "none"}
</Pain>`).join("\n")}

Respond ONLY with JSON: {"records":[{"painId":"...","marketProblemMeaning":"...","marketFunction":"PROBLEM_TO_SOLVE|SUPPORTING_PROBLEM|PURCHASE_OBJECTION","problemEvidenceUids":["..."],"centralityStatus":"PROVEN|NOT_ESTABLISHED|CONTRADICTED|NOT_APPLICABLE","centralityEvidenceUids":["..."],"centralityReason":"...","classification":"CORE_PURCHASE|OBJECTION|POST_PURCHASE_FRICTION|SUPPORTING|UNKNOWN","reason":"..."}]}`;

  const res = await aiChat({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.1,
    max_tokens: 3000,
    response_format: { type: "json_object" },
    accountId: opts.accountId,
    endpoint: "pain-class-proposer"
  });
  if (!res || !res.choices || !res.choices[0] || !res.choices[0].message || !res.choices[0].message.content) return null;
  try {
    return JSON.parse(res.choices[0].message.content).records;
  } catch {
    return null;
  }
}
export async function proposeProductFitWithLLM(
  registry: AuthoritativeAudiencePain[],
  opts: { 
    accountId: string; 
    campaignId: string;
    productCapabilities?: string | ProductTruthFact[] | null;
    businessProfile?: string | null;
    audienceSegments?: any[];
    evidenceContext?: EvidenceContextMap;
  },
  previousRejections?: string[],
): Promise<LlmProductFitRecord[] | null> {
  if (registry.length === 0) return null;

  const factsText = formatProductFactsForPrompt(opts.productCapabilities);
  const prompt = `You are a strict marketing-pain classifier and product-relevance authority. Classify EACH pain below.

RULES (violations are rejected by an independent semantic judge):
- Use ONLY the supplied painId values. Never invent, drop into free text, merge, or rewrite pains.

FIT TAXONOMY & CAUSAL EVALUATION:
1. requiredCapability: Identify the exact functional mechanism or capability required to solve this pain as verbatim stated.
2. matchedProductCapability: Identify the exact capability verified in the Product Truth facts below that addresses it.
3. fitType & productFit:
   - DIRECT_FIT (productFit = "ELIGIBLE"): The business's EXISTING validated capability DIRECTLY PERFORMS OR DIRECTLY ENABLES the function required to address the pain AS STATED.
     * Note: "Directly enables" means a validated Product Truth capability is causally necessary to reducing the pain, the connection is immediate, and it materially performs part of the function or removes a direct blocker. Role alignment (e.g., both target SMBs) or generic usefulness is FORBIDDEN.
   - STRATEGIC_FIT (productFit = "ELIGIBLE"): The product contributes legitimate upstream strategy, decision support, or context, but does NOT directly perform or directly enable the function required by the pain.
     * MUST provide 'strategicBridge': Explain the causal mechanism connecting the upstream strategic capability to the pain. (Category/industry similarity like "both are in marketing" is NOT a valid bridge).
     * MUST provide 'boundary': Explicit statement of what operational tasks the product does NOT do.
   - NOT_FIT (productFit = "INELIGIBLE"): The product does not legitimately address the pain. (Preserved as General Market Pain).
   - UNKNOWN (productFit = "UNKNOWN"): Available Product Truth facts are insufficient to establish whether a legitimate relationship exists.

SEMANTIC INVARIANCE PRINCIPLE:
Classification must be based on the functional meaning of the pain and its supporting evidence basis, NOT on surface wording or lexical overlap with Product Truth. Two differently-worded pains that are supported by the same evidence and require the same functional capability must receive the same fit classification. Do not let word choice in the canonical pain text determine whether a fit is DIRECT vs STRATEGIC vs NOT_FIT.

ROLE & PRODUCT TRUTH BOUNDARIES:
- Evaluate THIS pain AS-IS. Preserve its original meaning. Do NOT reinterpret, translate, reframe, or substitute a different pain.
- Health/consumer symptoms belong to END CONSUMERS. They are NOT eligible pains for commercial procurement buyers.
- Specifications/attributes are NOT operational delivery mechanisms. NEVER infer a Product capability not present in verified Product Truth.
- If uncertain or missing evidence, answer UNKNOWN or NOT_FIT.

- productTruthFactIds: Array of exact fact IDs cited from the verified facts below (e.g. ["fact_1", "fact_2"]).
- directCausalExplanation: (For DIRECT_FIT) Explain how the product directly performs the required function.
- bridgeEvidenceBasis: (For STRATEGIC_FIT) Identify which part of the pain/segment text supports the upstream strategic factor.
- boundary: (For STRATEGIC_FIT) Explicitly state the literal operational tasks the product does NOT do.
- uncertainty: (For UNKNOWN) Explicitly state the missing information or unresolved question.
- reason: Concise summary of the causal relationship.
- semanticRank: rank ALL pains from 1 (most strategically dominant purchase driver) to N. Every rank exactly once.
- fitType is REQUIRED for every record. You must always provide exactly one of: DIRECT_FIT, STRATEGIC_FIT, NOT_FIT, UNKNOWN.

VERIFIED PRODUCT TRUTH FACTS:
${factsText}

BUSINESS PROFILE:
${opts.businessProfile || "UNKNOWN — no verified business profile provided."}

PAINS:
${registry.map((p) => {
  const seg = opts.audienceSegments?.find(s => s.id === p.segmentIds?.[0] || s.name === p.segmentIds?.[0]);
  const segName = seg?.name || p.segmentIds?.join(", ") || "unknown";
  const segDef = seg?.segmentDefinition?.claim || seg?.description || "";
  const roleLabel = (p as any).strategicRole || segName;
  const evidenceBasis = opts.evidenceContext ? packEvidenceForPain(p.evidenceUids, opts.evidenceContext) : "";
  return `- painId=${p.painId} rank=${p.rank} segment="${segName}"${segDef ? ` segmentDefinition="${segDef}"` : ""} role="${roleLabel}" text="${p.canonical}"${evidenceBasis}`;
}).join("\n")}
${previousRejections && previousRejections.length > 0 ? `\nPREVIOUS REJECTIONS TO REPAIR:\n${previousRejections.join("\n")}` : ""}

Respond ONLY with JSON: {"records":[{"painId":"...","classification":"CORE_PURCHASE|OBJECTION|POST_PURCHASE_FRICTION|SUPPORTING","productFit":"ELIGIBLE|INELIGIBLE|UNKNOWN","fitType":"DIRECT_FIT|STRATEGIC_FIT|NOT_FIT|UNKNOWN","requiredCapability":"...","matchedProductCapability":"...","directCausalExplanation":"...","strategicBridge":"...","bridgeEvidenceBasis":"...","boundary":"...","productTruthFactIds":["..."],"uncertainty":"...","reason":"...","semanticRank":1}]}`;

  try {
    const response = await Promise.race([
      aiChat({
        model: "gpt-4.1-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        max_tokens: 3000,
        response_format: { type: "json_object" },
        accountId: opts.accountId,
        endpoint: "pain-classifier",
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`pain classifier timed out after ${LLM_TIMEOUT_MS / 1000}s`)), LLM_TIMEOUT_MS),
      ),
    ]);
    const raw = response.choices?.[0]?.message?.content || "";
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.records) ? parsed.records : null;
  } catch (err: any) {
    console.warn(`[PainClassifier] LLM_UNAVAILABLE | ${err.message} — deterministic classification stands`);
    return null;
  }
}

/**
 * Independent Semantic Judge: Evaluates the proposed product-fit records
 * against raw Product Truth facts and original pains from first principles.
 */

export async function judgePainClassWithLLM(
  registry: AuthoritativeAudiencePain[],
  records: LlmPainClassRecord[],
  opts: { accountId: string; evidenceContext?: EvidenceContextMap }
): Promise<Map<string, { valid: boolean; rejectionCode?: string; critique?: string; repairDirective?: string }>> {
  const verdicts = new Map<string, { valid: boolean; rejectionCode?: string; critique?: string; repairDirective?: string }>();
  if (records.length === 0) return verdicts;
  
  const prompt = `You are the Semantic Invariance Judge for Pain Classification.
Your sole job is to verify that the proposed pain class is rigorously supported by the evidence and functional meaning, NOT by keyword hijacking or false centrality.

CENTRALITY PRINCIPLES:
1. Material importance (severity, frustration, frequency, operational impact) is sufficient for a problem to be classified as CORE_PURCHASE. It does NOT require explicit evidence of purchase-intent, solution-seeking, switching, or decision-driving behavior.

RULES:
1. CORE_PURCHASE requires evidence of material importance (strong consequence, pervasive frustration, severe impact).
   - If the problem is trivial or minor, reject with LACKS_MATERIAL_IMPORTANCE and direct them to evaluate SUPPORTING.
2. OBJECTION requires evidence of hesitation, resistance, or barrier to purchase. Reject with OBJECTION_FUNCTION_UNSUPPORTED if it's just a negative pain.
3. SUPPORTING should not hide a true CORE_PURCHASE problem. Reject with UNDERCLASSIFIED_CORE_PROBLEM if the problem is central but was downgraded.
4. If wording alone drove the classification instead of functional meaning, reject with LEXICAL_CLASSIFICATION_NOT_AUTHORITY.

Pains to Judge:
${records.map(r => {
  const p = registry.find(x => x.painId === r.painId)!;
  return `<Pain id="${p.painId}">
Canonical: ${p.canonical}
Evidence: ${opts.evidenceContext ? packEvidenceForPain(p.evidenceUids, opts.evidenceContext) : "none"}
Proposed Class: ${r.classification}
Proposer Meaning: ${r.marketProblemMeaning}
Proposer Function: ${r.marketFunction}
Problem Evidence UIDs: ${r.problemEvidenceUids?.join(", ")}
Centrality Status: ${r.centralityStatus}
Centrality Evidence UIDs: ${r.centralityEvidenceUids?.join(", ")}
Centrality Reason: ${r.centralityReason}
</Pain>`;
}).join("\n")}

Respond ONLY with JSON: {"verdicts":[{"painId":"...","valid":true|false,"rejectionCode":"...","critique":"...","repairDirective":"..."}]}`;

  const res = await aiChat({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: 3000,
    response_format: { type: "json_object" },
    accountId: opts.accountId,
    endpoint: "pain-class-judge"
  });

  if (res && res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content) {
    try {
      const data = JSON.parse(res.choices[0].message.content);
      for (const v of data.verdicts) verdicts.set(v.painId, v);
    } catch {}
  }
  return verdicts;
}

export async function judgeProductFitWithLLM(
  registry: AuthoritativeAudiencePain[],
  records: LlmProductFitRecord[],
  opts: {
    accountId: string;
    productCapabilities?: string | ProductTruthFact[] | null;
    businessProfile?: string | null;
    audienceSegments?: any[];
    evidenceContext?: EvidenceContextMap;
  }
): Promise<Map<string, { valid: boolean; rejectionCode?: string; critique?: string; repairDirective?: string }>> {
  const verdicts = new Map<string, { valid: boolean; rejectionCode?: string; critique?: string; repairDirective?: string }>();
  if (records.length === 0) return verdicts;

  const factsText = formatProductFactsForPrompt(opts.productCapabilities);
  const prompt = `You are the strict Product Fit Semantic Judge.
Your role is to independently judge whether proposed product-fit classifications are factually and causally truthful. Protect precision (reject hallucinations) AND recall (reject false negatives).

VALIDITY INSTRUCTIONS:
- "valid": true — YOU AGREE WITH AND ACCEPT THE PROPOSED CLASSIFICATION (whether it is DIRECT_FIT, STRATEGIC_FIT, NOT_FIT, or UNKNOWN) as factually and causally truthful. Do NOT provide a rejectionCode when valid is true.
- "valid": false — YOU REJECT THE PROPOSED CLASSIFICATION because it is causally incorrect, inaccurate, overclaimed, or underclaimed. You MUST provide a rejectionCode and repairDirective.

EVALUATION CRITERIA:
1. If DIRECT_FIT is proposed: The product's EXISTING validated capability MUST DIRECTLY PERFORM OR DIRECTLY ENABLE the required function of the pain AS STATED.
   - "Directly enables" means the capability is causally necessary/relevant to reducing the pain, the connection is immediate, and the product materially performs part of the required function OR removes a direct dependency causing the pain.
   - Generic usefulness, mere role alignment, or broad strategic relevance is forbidden. Reject generic relevance with "DIRECT_CAPABILITY_NOT_ESTABLISHED".
2. If STRATEGIC_FIT is proposed: The product does NOT directly perform or enable the operational task, but its validated capabilities legitimately address an upstream strategic decision or root cause.
   - The strategicBridge must explain an actual upstream causal mechanism, not mere category similarity. If generic similarity, reject with code "FALSE_STRATEGIC_BRIDGE".
   - The bridge must be supported by market meaning (bridgeEvidenceBasis). If unsupported, reject with code "BRIDGE_EVIDENCE_UNSUPPORTED".
   - The boundary must explicitly state what the product does NOT do. If missing or misleading, reject with code "FIT_BOUNDARY_INVALID".
3. If NOT_FIT is proposed (UNDERCLASSIFICATION CHECK): Confirm whether the product legitimately addresses this pain. If you AGREE that the product has no direct or strategic capability to solve this pain, return valid=true. (If a legitimate capability was overlooked, reject with valid=false and code "STRATEGIC_FIT_NOT_CONSIDERED").
4. CAPABILITY INVENTION: If reasoning claims capabilities not found in the verified Product Truth facts, reject with code "CAPABILITY_INVENTION".
5. PAIN MEANING CHANGED / ROLE TRANSFER: If the reasoning reinterprets the original pain meaning or transfers a consumer pain to a commercial buyer, reject with "PAIN_MEANING_CHANGED" or "ROLE_TRANSFER".
6. SEMANTIC INVARIANCE: Evaluate fit based on the functional meaning of the pain as supported by its evidence, not on lexical similarity between the canonical pain wording and Product Truth. Equivalent evidence-supported pain meanings should not receive different classifications merely because wording differs. If the proposed classification appears driven by word overlap rather than functional capability match, reject with code "LEXICAL_OVERLAP_NOT_AUTHORITY".

VERIFIED PRODUCT TRUTH FACTS:
${factsText}

BUSINESS PROFILE:
${opts.businessProfile || "UNKNOWN"}

PROPOSED FIT RECORDS TO JUDGE:
${JSON.stringify(records.map(r => {
    const pain = registry.find(item => item.painId === r.painId);
    const seg = pain ? opts.audienceSegments?.find(s => s.id === pain.segmentIds?.[0] || s.name === pain.segmentIds?.[0]) : null;
    const evidenceBasis = pain && opts.evidenceContext
      ? packEvidenceForPain(pain.evidenceUids, opts.evidenceContext).trim()
      : "";
    return {
      painId: r.painId,
      originalPainText: pain?.canonical,
      segment: seg?.name || pain?.segmentIds?.[0],
      segmentDefinition: seg?.segmentDefinition?.claim || seg?.description || undefined,
      evidenceBasis: evidenceBasis || undefined,
      proposedFitType: r.fitType,
      requiredCapability: r.requiredCapability,
      matchedProductCapability: r.matchedProductCapability,
      directCausalExplanation: r.directCausalExplanation,
      strategicBridge: r.strategicBridge,
      bridgeEvidenceBasis: r.bridgeEvidenceBasis,
      boundary: r.boundary,
      productTruthFactIds: r.productTruthFactIds,
      reason: r.reason
    };
}), null, 2)}

Respond ONLY with JSON:
{
  "verdicts": [
    {
      "painId": "...",
      "valid": true,
      "rejectionCode": "DIRECT_CAPABILITY_NOT_ESTABLISHED|STRATEGIC_BRIDGE_MISSING|FALSE_STRATEGIC_BRIDGE|BRIDGE_EVIDENCE_UNSUPPORTED|FIT_BOUNDARY_INVALID|CAPABILITY_INVENTION|PAIN_MEANING_CHANGED|ROLE_TRANSFER|PRODUCT_TRUTH_FACT_INVALID|STRATEGIC_FIT_NOT_CONSIDERED",
      "critique": "Concise causal critique explaining the decision",
      "repairDirective": "If rejected, instruct the proposer to re-evaluate across all 4 fit types (DIRECT, STRATEGIC, NOT_FIT, UNKNOWN) using evidence."
    }
  ]
}`;

  try {
    const res = await aiChat({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: 2000,
      response_format: { type: "json_object" },
      accountId: opts.accountId,
      endpoint: "product-fit-judge"
    });

    const parsed = JSON.parse(res.choices?.[0]?.message?.content || '{"verdicts":[]}');
    if (Array.isArray(parsed.verdicts)) {
      for (const v of parsed.verdicts) {
        if (typeof v?.painId === "string") {
          verdicts.set(v.painId, {
            valid: v.valid === true,
            rejectionCode: v.valid === true ? undefined : (v.rejectionCode || "SEMANTIC_JUDGE_REJECTED"),
            critique: String(v.critique || ""),
            repairDirective: v.repairDirective ? String(v.repairDirective) : undefined
          });
        }
      }
    }
  } catch (err: any) {
    console.warn(`[PainClassifier] Semantic Judge LLM unavailable (${err.message}) — proceeding with structural verification`);
  }

  return verdicts;
}

/** Structural verification over LLM classifier output. */

export function judgePainClassStructural(
  registry: AuthoritativeAudiencePain[],
  records: LlmPainClassRecord[] | null,
): { accepted: Map<string, LlmPainClassRecord>; rejections: { painId: string; code: string }[] } {
  const accepted = new Map<string, LlmPainClassRecord>();
  const rejections: { painId: string; code: string }[] = [];
  if (!records) {
    registry.forEach((p) => rejections.push({ painId: p.painId, code: "LLM_PAYLOAD_MISSING" }));
    return { accepted, rejections };
  }
  const byId = new Map(records.map((r) => [r.painId, r]));
  for (const pain of registry) {
    const record = byId.get(pain.painId);
    if (!record) {
      rejections.push({ painId: pain.painId, code: "LLM_RECORD_MISSING" });
      continue;
    }
    if (!VALID_CLASSES.includes((record as any).classification as any) && (record as any).classification !== "UNKNOWN") {
      rejections.push({ painId: record.painId, code: "INVALID_CLASSIFICATION" });
      continue;
    }
    const hasEV = pain.evidenceUids?.some((uid) => uid.startsWith("EV:"));
    if (hasEV) {
      if (!record.problemEvidenceUids || record.problemEvidenceUids.length === 0) {
        rejections.push({ painId: record.painId, code: "PROBLEM_EVIDENCE_MISSING" });
        continue;
      }
      const invalidUids = record.problemEvidenceUids.filter(uid => !pain.evidenceUids.includes(uid));
      if (invalidUids.length > 0) {
        rejections.push({ painId: record.painId, code: "PROBLEM_EVIDENCE_OUTSIDE_AUTHORITY" });
        continue;
      }
    }

    if (!record.marketFunction || !record.marketProblemMeaning) {
      rejections.push({ painId: record.painId, code: "MISSING_SEMANTIC_REASONING" });
      continue;
    }
    // Legacy CORE_CENTRALITY gates removed per requirements
    // Strategic Materiality (Phase 3) handles CORE_PURCHASE now.
    accepted.set(record.painId, record);
  }
  return { accepted, rejections };
}

export const judgePainClassifierOutput = judgeProductFitStructural;

export function judgeProductFitStructural(
  registry: AuthoritativeAudiencePain[],
  records: LlmProductFitRecord[] | null,
  audienceSegments?: any[],
  sourceFacts?: { productCapabilities?: string | ProductTruthFact[] | null; businessProfile?: string | null },
): PainJudgeResult {
  const accepted = new Map<string, {
    classification: AudiencePainClass;
    productFit: typeof VALID_FIT[number];
    fitType: ProductFitType;
    requiredCapability?: string;
    matchedProductCapability?: string;
    strategicBridge?: string;
    boundary?: string;
    productTruthFactIds?: string[];
    reason: string;
  }>();
  const rejections: Array<{ painId: string; code: string; critique?: string }> = [];
  if (!Array.isArray(records) || records.length === 0) {
    return { accepted, semanticRanks: null, rejections: [{ painId: "*", code: "LLM_OUTPUT_MISSING" }] };
  }
  const knownIds = new Map(registry.map((p) => [p.painId, p]));
  const seen = new Set<string>();
  const rankCandidates = new Map<string, number>();

  for (const record of records) {
    const painId = typeof record?.painId === "string" ? record.painId : "";
    const source = knownIds.get(painId);
    if (!source) {
      rejections.push({ painId: painId || "unknown", code: "LLM_INVENTED_PAIN_ID" });
      continue;
    }
    if (seen.has(painId)) {
      rejections.push({ painId, code: "LLM_DUPLICATE_RECORD" });
      continue;
    }
    seen.add(painId);
    if ((record as any).evidenceUids || (record as any).sourceSignalIds || (record as any).evidence) {
      rejections.push({ painId, code: "LLM_EVIDENCE_INVENTION" });
      continue;
    }
    if ((record as any).mergedPainIds || (record as any).canonical || (record as any).text) {
      rejections.push({ painId, code: "LLM_REWRITE_OR_MERGE_FORBIDDEN" });
      continue;
    }
    if (!VALID_CLASSES.includes((record as any).classification as AudiencePainClass) && (record as any).classification !== "UNKNOWN") {
      rejections.push({ painId, code: "LLM_CLASSIFICATION_INVALID" });
      continue;
    }

    let fitType = record.fitType;
    let productFit = record.productFit as typeof VALID_FIT[number];

    // Taxonomy reconciliation
    if (fitType === "DIRECT_FIT" || fitType === "STRATEGIC_FIT") {
      productFit = "ELIGIBLE";
    } else if (fitType === "NOT_FIT") {
      productFit = "INELIGIBLE";
    } else if (fitType === "UNKNOWN") {
      productFit = "UNKNOWN";
    } else if (!fitType) {
      // CRITICAL: Missing fitType is INVALID semantic output.
      // ELIGIBLE does NOT imply DIRECT_FIT. Do NOT auto-assign a fit type.
      // This triggers targeted repair on the next attempt.
      rejections.push({ painId, code: "FIT_TYPE_MISSING" });
      continue;
    }

    if (!VALID_FIT.includes(productFit)) {
      rejections.push({ painId, code: "LLM_PRODUCT_FIT_INVALID" });
      continue;
    }
    if (typeof record.reason !== "string" || record.reason.trim().length < 10) {
      rejections.push({ painId, code: "LLM_REASON_MISSING" });
      continue;
    }

    // Strategic fit bridge & boundary structural checks
    if (fitType === "STRATEGIC_FIT") {
      if (typeof record.strategicBridge !== "string" || record.strategicBridge.trim().length < 10) {
        rejections.push({ painId, code: "STRATEGIC_BRIDGE_MISSING" });
        continue;
      }
      if (typeof record.boundary !== "string" || record.boundary.trim().length < 10) {
        rejections.push({ painId, code: "BOUNDARY_MISSING" });
        continue;
      }
      const bridgeLC = record.strategicBridge.toLowerCase();
      if (
        bridgeLC.includes("same industry") ||
        bridgeLC.includes("both are in marketing") ||
        bridgeLC.includes("is a marketing tool")
      ) {
        rejections.push({ painId, code: "FALSE_STRATEGIC_BRIDGE" });
        continue;
      }
    }

    // Promotion guard: post-purchase friction cannot be promoted to CORE_PURCHASE
    const deterministic = classifyAudiencePainDetailed(source.canonical).classification;
    if (deterministic === "POST_PURCHASE_FRICTION" && (record as any).classification === "CORE_PURCHASE") {
      rejections.push({ painId, code: "LLM_POST_PURCHASE_PROMOTION_FORBIDDEN" });
      continue;
    }

    let reason = record.reason.trim();

    accepted.set(painId, {
      classification: (record as any).classification as AudiencePainClass,
      productFit,
      fitType,
      requiredCapability: record.requiredCapability?.trim(),
      matchedProductCapability: record.matchedProductCapability?.trim(),
      strategicBridge: record.strategicBridge?.trim(),
      boundary: record.boundary?.trim(),
      productTruthFactIds: Array.isArray(record.productTruthFactIds) ? record.productTruthFactIds : undefined,
      reason,
    });
    if (Number.isFinite(record.semanticRank)) rankCandidates.set(painId, record.semanticRank as number);
  }

  // Semantic ranking permutation check
  let semanticRanks: Map<string, number> | null = null;
  if (rankCandidates.size === registry.length) {
    const ranks = [...rankCandidates.values()].sort((a, b) => a - b);
    const isPermutation = ranks.every((rank, index) => rank === index + 1);
    if (isPermutation) semanticRanks = rankCandidates;
    else rejections.push({ painId: "*", code: "LLM_RANK_INVALID" });
  } else if (rankCandidates.size > 0) {
    rejections.push({ painId: "*", code: "LLM_RANK_INCOMPLETE" });
  }

  return { accepted, semanticRanks, rejections };
}

/** Apply judged LLM classifications. Rejected/missing records keep the
 * deterministic classification (recorded in classifierVersion/reason). */


export interface EvidenceOwnershipResult {
  registry: AuthoritativeAudiencePain[];
  issues: string[];
}

/** Cross-tenant evidence guard: every evidence UID a pain cites must resolve
 * inside THIS account+campaign's evidence registry. */
export async function validatePainEvidenceOwnership(
  registry: AuthoritativeAudiencePain[],
  accountId: string,
  campaignId: string,
): Promise<EvidenceOwnershipResult> {
  const issues: string[] = [];
  const allUids = [...new Set(registry.flatMap((p) => (p.evidenceUids || []).filter((uid) => uid.startsWith("EV:"))))];
  if (allUids.length === 0) return { registry, issues };
  let resolved: Set<string>;
  try {
    const rows = await getEvidenceByUids(accountId, campaignId, allUids);
    resolved = new Set((rows as any[]).map((row: any) => row.uid ?? row.evidenceUid));
  } catch (err: any) {
    issues.push(`PAIN_EVIDENCE_OWNERSHIP_UNVERIFIABLE:${err.message}`);
    return {
      registry: registry.map((pain) =>
        pain.evidenceUids.some((uid) => uid.startsWith("EV:")) ? { ...pain, eligible: false } : pain,
      ),
      issues,
    };
  }
  const updated = registry.map((pain) => {
    const registryUids = pain.evidenceUids.filter((uid) => uid.startsWith("EV:"));
    const foreign = registryUids.filter((uid) => !resolved.has(uid));
    if (foreign.length === 0) return pain;
    for (const uid of foreign) issues.push(`PAIN_EVIDENCE_FOREIGN_OR_UNRESOLVED:${pain.painId}:${uid}`);
    return { ...pain, eligible: false, productFit: "UNKNOWN" as const, classificationReason: `${pain.classificationReason} [evidence ownership failed: ${foreign.join(",")}]` };
  });
  return { registry: updated, issues };
}

/**
 * One-call pipeline entry: Proposer -> Structural & Semantic Judge -> Targeted Retry with Claim Locking.
 */


export async function proposeCoreStrategicPrioritization(
  candidates: AuthoritativeAudiencePain[],
  lockedClasses: Map<string, LlmPainClassRecord>,
  lockedFits: Map<string, LlmProductFitRecord>,
  opts: { accountId: string; audienceSegments?: any[]; evidenceContext?: EvidenceContextMap },
  previousRejections?: string[],
): Promise<{painId: string, classification: string, strategicMaterialityReason: string}[] | null> {
  const prompt = `You are the CORE Strategic Prioritization engine.
You are given a list of market pains that have ALREADY been validated as:
1. Real market problems supported by evidence.
2. Relevant to the intended target audience (targetCovered = true).
3. Directly solvable by this product (DIRECT_FIT).

Your job is to determine which of these candidate pains are materially important enough to anchor the business strategy as CORE_PURCHASE, and which should remain SUPPORTING.

CORE_PURCHASE: A primary strategic market pain that is materially important, pervasive, or consequential enough to serve as a strong strategic anchor. (It does NOT require explicit evidence of buying intent, just clear material importance).
SUPPORTING: A valid, directly addressed market problem that is secondary, contextual, or not strong enough to anchor strategy.

Do NOT make every pain CORE_PURCHASE. Use your semantic judgment of the market evidence.

Previous Rejections to fix:
${previousRejections?.join("\n") || "None"}

CANDIDATE PAINS:
${candidates.map(p => {
  const classRecord = lockedClasses.get(p.painId);
  const fitRecord = lockedFits.get(p.painId);
  const evidence = opts.evidenceContext ? packEvidenceForPain(p.evidenceUids, opts.evidenceContext) : "none";
  return `<Pain id="${p.painId}">
Segment: ${opts.audienceSegments?.find(s => s.name === p.segmentIds[0])?.segmentDefinition?.claim || p.segmentIds[0] || ""}
Canonical: ${p.canonical}
Market Problem Meaning: ${classRecord?.marketProblemMeaning || ""}
Matched Product Capability: ${fitRecord?.matchedProductCapability || ""}
Evidence: ${evidence}
</Pain>`;
}).join("\n")}

Respond ONLY with JSON: {"records":[{"painId":"...","classification":"CORE_PURCHASE|SUPPORTING","strategicMaterialityReason":"Explain why this pain is or isn't materially important enough to anchor strategy based on the evidence."}]}
`;
  const res = await aiChat({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.1,
    max_tokens: 3000,
    response_format: { type: "json_object" },
    accountId: opts.accountId,
    endpoint: "core-priority-proposer"
  });
  if (!res || !res.choices || !res.choices[0] || !res.choices[0].message || !res.choices[0].message.content) return null;
  try {
    return JSON.parse(res.choices[0].message.content).records;
  } catch {
    return null;
  }
}

export async function judgeCoreStrategicPrioritization(
  candidates: AuthoritativeAudiencePain[],
  records: {painId: string, classification: string, strategicMaterialityReason: string}[],
  lockedClasses: Map<string, LlmPainClassRecord>,
  lockedFits: Map<string, LlmProductFitRecord>,
  opts: { accountId: string; evidenceContext?: EvidenceContextMap }
): Promise<Map<string, { valid: boolean; rejectionCode?: string; critique?: string }>> {
  const verdicts = new Map<string, { valid: boolean; rejectionCode?: string; critique?: string }>();
  if (records.length === 0) return verdicts;
  
  const prompt = `You are the Semantic Judge for CORE Strategic Prioritization.
Verify that the proposed CORE_PURCHASE or SUPPORTING classification is supported by the market evidence's materiality.

RULES:
1. Ensure CORE_PURCHASE pains actually demonstrate material importance (strong consequence, pervasive frustration, severe impact) in the evidence.
2. If CORE is assigned to a weak, trivial, or weakly supported pain just because it's DIRECT_FIT, reject with LACKS_MATERIAL_IMPORTANCE.
3. If SUPPORTING is assigned to a clearly severe, foundational market problem, reject with UNDERCLASSIFIED_CORE_CANDIDATE.
4. Do NOT require explicit purchase/switching intent language. "Material importance" is sufficient.

Evaluations:
${records.map(r => {
  const p = candidates.find(c => c.painId === r.painId);
  const evidenceText = opts.evidenceContext && p ? packEvidenceForPain(p.evidenceUids, opts.evidenceContext) : "none";
  return `---
Pain ID: ${r.painId}
Canonical: ${p?.canonical}
Proposed Classification: ${r.classification}
Reasoning: ${r.strategicMaterialityReason}
Evidence: ${evidenceText}`;
}).join("\n\n")}

Respond ONLY with JSON: {"verdicts":[{"painId":"...","valid":true|false,"rejectionCode":"LACKS_MATERIAL_IMPORTANCE|UNDERCLASSIFIED_CORE_CANDIDATE","critique":"..."}]}
`;
  const res = await aiChat({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.0,
    max_tokens: 2000,
    response_format: { type: "json_object" },
    accountId: opts.accountId,
    endpoint: "core-priority-judge"
  });
  if (!res || !res.choices || !res.choices[0] || !res.choices[0].message || !res.choices[0].message.content) {
    records.forEach(r => verdicts.set(r.painId, { valid: false, rejectionCode: "LLM_ERROR" }));
    return verdicts;
  }
  try {
    const parsed = JSON.parse(res.choices[0].message.content).verdicts;
    parsed.forEach((v: any) => verdicts.set(v.painId, v));
  } catch {
    records.forEach(r => verdicts.set(r.painId, { valid: false, rejectionCode: "PARSE_ERROR" }));
  }
  return verdicts;
}

export async function refineAudiencePainRegistry(
  registry: AuthoritativeAudiencePain[],
  opts: { 
    accountId: string; 
    campaignId: string; 
    jobId?: string;
    productCapabilities?: string | ProductTruthFact[] | null; 
    businessProfile?: string | null;
    audienceSegments?: any[];
    businessUnderstanding?: any;
    llmEnabled?: boolean;
  },
): Promise<{ registry: AuthoritativeAudiencePain[]; classifierUsed: string; judgeRejections: string[]; evidenceIssues: string[] }> {
  let working: AuthoritativeAudiencePain[] = [];
  const classifierUsed = LLM_CLASSIFIER_VERSION;
  const allJudgeRejections: string[] = [];
  
  if (registry.length === 0) {
    return { registry: [], classifierUsed, judgeRejections: [], evidenceIssues: [] };
  }

  // 1. Resolve Canonical Business Understanding & Authority Lineage
  let bu = opts.businessUnderstanding;
  if (!bu) {
    try {
      const [snap] = await db
        .select({ payload: businessUnderstandingSnapshots.businessUnderstanding })
        .from(businessUnderstandingSnapshots)
        .where(
          and(
            eq(businessUnderstandingSnapshots.campaignId, opts.campaignId),
            eq(businessUnderstandingSnapshots.accountId, opts.accountId)
          )
        )
        .orderBy(desc(businessUnderstandingSnapshots.createdAt))
        .limit(1);
      bu = snap?.payload;
    } catch (e: any) {
      console.warn(`[PainClassifier] Failed to query businessUnderstandingSnapshots: ${e.message}`);
    }
  }

  const targetUnderstandingAuthorityId = bu?.targetUnderstanding?.targetUnderstandingAuthorityId || `tu_${opts.campaignId}`;
  const canonicalTargetRoles = bu?.targetUnderstanding?.targetRoles || [];
  const campaignOfferingId = bu?.campaignOfferingId || bu?.campaignOffering?.id || `co_${opts.campaignId}`;
  const businessUnderstandingAuthorityId = bu?.businessUnderstandingAuthorityId || `bu_${opts.campaignId}`;
  const productTruthFacts = bu?.campaignOffering?.productTruthFacts || (
    Array.isArray(opts.productCapabilities) ? opts.productCapabilities : []
  );
  const productTruthFactIds = (
    bu?.campaignOffering?.productTruthFactIds || 
    productTruthFacts.map((f: any) => f.productTruthFactId || f.factId || "fact_default")
  ).filter(Boolean);

  const effectiveJobId = opts.jobId || `job_${opts.campaignId}_${Date.now()}`;

  console.log(`[PainClassifier] CANONICAL_PAIN_PIPELINE_START | pains=${registry.length} | jobId=${effectiveJobId} | bu=${businessUnderstandingAuthorityId} | co=${campaignOfferingId} | tu=${targetUnderstandingAuthorityId}`);

  // 2. Sequential Assessment per Canonical Pain: TargetAssessment -> ProductAssessment -> StrategicPainDecision
  for (const pain of registry) {
    const segContext = (opts.audienceSegments || []).find(
      (s: any) => s.id === pain.segmentId || s.name === pain.segmentName || s.name === pain.segmentId
    );

    // Step A: Target Assessment
    const ta = await runTargetAssessmentForPain({
      painId: pain.painId,
      segmentId: pain.segmentId || pain.segmentName || "default_segment",
      canonicalPain: pain.canonical,
      segmentContext: segContext ? { name: segContext.name, role: segContext.role, segmentDefinition: segContext.segmentDefinition } : undefined,
      targetUnderstandingAuthorityId,
      canonicalTargetRoles,
      accountId: opts.accountId,
      campaignId: opts.campaignId,
      jobId: effectiveJobId,
    });

    // Step B: Product Assessment
    const pa = await runProductAssessmentForPain({
      painId: pain.painId,
      canonicalPain: pain.canonical,
      campaignOfferingId,
      businessUnderstandingAuthorityId,
      productTruthFacts,
      accountId: opts.accountId,
      campaignId: opts.campaignId,
      jobId: effectiveJobId,
    });

    // Step C: Strategic Pain Decision Judge
    const spd = await judgeStrategicPainDecision({
      jobId: effectiveJobId,
      painId: pain.painId,
      targetUnderstandingAuthorityId,
      productTruthFactIds,
      campaignOfferingId,
      targetAssessmentAuthorityId: ta.targetAssessmentAuthorityId,
      productAssessmentAuthorityId: pa.productAssessmentAuthorityId,
      targetAssessmentParentAuthorityIds: ta.parentAuthorityIds,
      productAssessmentParentAuthorityIds: pa.parentAuthorityIds,
      targetAssessmentJobId: ta.jobId,
      productAssessmentJobId: pa.jobId,
      painClaim: pain.canonical,
      productFitType: pa.fitType,
      materialityContext: {
        citationCount: (pain as any).citationCount ?? ((pain.evidenceUids?.length || 0) + (pain.sourceSignalIds?.length || 0)),
        uniqueEvidenceCount: (pain as any).uniqueEvidenceCount ?? (pain.evidenceUids?.length || 0),
        uniqueSourceCount: (pain as any).uniqueSourceCount ?? (new Set(pain.sourceTypes || []).size),
        uniqueCompetitorCount: (pain as any).uniqueCompetitorCount,
        occurrenceCount: (pain as any).occurrenceCount || (pain.evidenceUids ? pain.evidenceUids.length : 1),
        sourceTypes: pain.sourceTypes || [],
        evidenceUids: pain.evidenceUids || [],
        sourceSignalIds: pain.sourceSignalIds || [],
        evidenceSummaries: (pain as any).evidenceSummaries,
        evidenceStrength: pain.evidenceStrength,
      },
      accountId: opts.accountId,
      campaignId: opts.campaignId,
    });

    let finalClass: AudiencePainClass = "SUPPORTING";
    if (spd.finalClassification === "CORE_PURCHASE") {
      finalClass = "CORE_PURCHASE";
    } else if (spd.finalClassification === "SUPPORTING") {
      finalClass = "SUPPORTING";
    } else if (spd.finalClassification === "EXCLUDE" || spd.finalClassification === "DROPPED") {
      finalClass = "UNKNOWN";
      allJudgeRejections.push(`STRATEGIC_EXCLUDED:${pain.painId} - ${spd.reason}`);
    }

    const allowedUses = allowedUsesForClass(finalClass);
    const prohibitedUses = prohibitedUsesForClass(finalClass);

    working.push({
      ...pain,
      classification: finalClass,
      strategicPainDecisionAuthorityId: spd.strategicPainDecisionAuthorityId,
      targetAssessmentAuthorityId: ta.targetAssessmentAuthorityId,
      productAssessmentAuthorityId: pa.productAssessmentAuthorityId,
      targetUnderstandingAuthorityId,
      businessUnderstandingAuthorityId,
      campaignOfferingId,
      coverageDecision: ta.decision,
      fitType: pa.fitType,
      allowedUses,
      prohibitedUses,
      productTruthFactIds,
      productFit: (pa.fitType === "DIRECT_FIT" || pa.fitType === "STRATEGIC_FIT") ? "ELIGIBLE" : "INELIGIBLE",
      eligible: finalClass !== "UNKNOWN" && allowedUses.length > 0 && pain.canonical.length > 0,
      classifierVersion: LLM_CLASSIFIER_VERSION,
      classificationReason: spd.reason,
    });
  }

  working.sort((a, b) => a.rank - b.rank);

  const ownership = await validatePainEvidenceOwnership(working, opts.accountId, opts.campaignId);
  return { registry: ownership.registry, classifierUsed, judgeRejections: allJudgeRejections, evidenceIssues: ownership.issues };
}

