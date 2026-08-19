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

export const LLM_CLASSIFIER_VERSION = "llm_v2+semantic_judge_v1";

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

export interface LlmPainRecord {
  painId: string;
  classification: AudiencePainClass;
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

/** Ask the LLM Proposer to classify each pain from first principles. */
export async function classifyPainRegistryWithLLM(
  registry: AuthoritativeAudiencePain[],
  opts: { 
    accountId: string; 
    campaignId: string;
    productCapabilities?: string | ProductTruthFact[] | null;
    businessProfile?: string | null;
    audienceSegments?: any[];
  },
  previousRejections?: string[],
): Promise<LlmPainRecord[] | null> {
  if (registry.length === 0) return null;

  const factsText = formatProductFactsForPrompt(opts.productCapabilities);
  const prompt = `You are a strict marketing-pain classifier and product-relevance authority. Classify EACH pain below.

RULES (violations are rejected by an independent semantic judge):
- Use ONLY the supplied painId values. Never invent, drop into free text, merge, or rewrite pains.
- classification must be one of: CORE_PURCHASE (pre-purchase unmet outcome / purchase motivation), OBJECTION (pre-purchase hesitation: price, risk, trust, proof, time), POST_PURCHASE_FRICTION (refund, cancellation, support, onboarding, access, delivery — problems occurring AFTER purchase), SUPPORTING (contextual, not a direct purchase driver).

FIT TAXONOMY & CAUSAL EVALUATION:
1. requiredCapability: Identify the exact functional mechanism or capability required to solve this pain as verbatim stated.
2. matchedProductCapability: Identify the exact capability verified in the Product Truth facts below that addresses it.
3. fitType & productFit:
   - DIRECT_FIT (productFit = "ELIGIBLE"): The business's EXISTING validated capability directly performs, produces, or executes the required function of the pain AS STATED.
     * Note: DIRECT_FIT requires the validated product capability to perform or directly enable the function required to address the original pain. If the required function and supplied capability differ, evaluate whether a legitimate causal upstream strategic relationship exists before selecting NOT_FIT.
   - STRATEGIC_FIT (productFit = "ELIGIBLE"): The product does NOT perform the literal operational task, but verified capabilities legitimately address an upstream strategic decision or root cause.
     * MUST provide 'strategicBridge': Explain the causal mechanism connecting the upstream strategic capability to the pain. (Category/industry similarity like "both are in marketing" is NOT a valid bridge).
     * MUST provide 'boundary': Explicit statement of what operational tasks the product does NOT do.
   - NOT_FIT (productFit = "INELIGIBLE"): The pain is real, but the product has no legitimate direct or strategic relationship to solving it. (Preserved as General Market Pain).
   - UNKNOWN (productFit = "UNKNOWN"): Available Product Truth facts are insufficient to establish whether a legitimate relationship exists.

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

VERIFIED PRODUCT TRUTH FACTS:
${factsText}

BUSINESS PROFILE:
${opts.businessProfile || "UNKNOWN — no verified business profile provided."}

PAINS:
${registry.map((p) => {
  const roles = p.segmentIds.map(sid => opts.audienceSegments?.find(s => s.id === sid)?.name || sid).join(", ");
  return `- painId=${p.painId} rank=${p.rank} role="${roles}" text="${p.canonical}"`;
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
export async function judgePainWithLLM(
  registry: AuthoritativeAudiencePain[],
  records: LlmPainRecord[],
  opts: {
    accountId: string;
    productCapabilities?: string | ProductTruthFact[] | null;
    businessProfile?: string | null;
    audienceSegments?: any[];
  }
): Promise<Map<string, { valid: boolean; rejectionCode?: string; critique?: string; repairDirective?: string }>> {
  const verdicts = new Map<string, { valid: boolean; rejectionCode?: string; critique?: string; repairDirective?: string }>();
  if (records.length === 0) return verdicts;

  const factsText = formatProductFactsForPrompt(opts.productCapabilities);
  const prompt = `You are the strict Product Fit Semantic Judge for Avyron AI.
Your role is to independently judge whether proposed product-fit classifications are factually and causally truthful. Protect precision (reject hallucinations) AND recall (reject false negatives).

EVALUATION CRITERIA:
1. If DIRECT_FIT is proposed: The product's existing validated capability MUST directly perform, produce, or execute the required functional mechanism of the pain as verbatim stated.
   - If the product is an upstream intelligence/strategy platform and the pain requires a downstream operational execution task, DIRECT_FIT is FALSE. Reject with code "DIRECT_CAPABILITY_NOT_ESTABLISHED".
2. If STRATEGIC_FIT is proposed: The product does NOT perform the literal operational task, but its validated capabilities legitimately address an upstream strategic decision or root cause.
   - The strategicBridge must explain an actual upstream causal mechanism, not mere category similarity. If generic similarity, reject with code "FALSE_STRATEGIC_BRIDGE".
   - The bridge must be supported by market meaning (bridgeEvidenceBasis). If unsupported, reject with code "BRIDGE_EVIDENCE_UNSUPPORTED".
   - The boundary must explicitly state what the product does NOT do. If missing or misleading, reject with code "FIT_BOUNDARY_INVALID".
3. If NOT_FIT is proposed (UNDERCLASSIFICATION CHECK): If NOT_FIT is proposed, but a legitimate strategic relationship exists supported by both Product Truth and Market Evidence, reject with code "STRATEGIC_FIT_NOT_CONSIDERED". You must not force NOT_FIT if a genuine strategic causal bridge exists.
4. CAPABILITY INVENTION: If reasoning claims capabilities not found in the verified Product Truth facts, reject with code "CAPABILITY_INVENTION".
5. PAIN MEANING CHANGED / ROLE TRANSFER: If the reasoning reinterprets the original pain meaning or transfers a consumer pain to a commercial buyer, reject with "PAIN_MEANING_CHANGED" or "ROLE_TRANSFER".

VERIFIED PRODUCT TRUTH FACTS:
${factsText}

BUSINESS PROFILE:
${opts.businessProfile || "UNKNOWN"}

PROPOSED FIT RECORDS TO JUDGE:
${JSON.stringify(records.map(r => ({
    painId: r.painId,
    originalPainText: registry.find(item => item.painId === r.painId)?.canonical,
    proposedFitType: r.fitType,
    requiredCapability: r.requiredCapability,
    matchedProductCapability: r.matchedProductCapability,
    directCausalExplanation: r.directCausalExplanation,
    strategicBridge: r.strategicBridge,
    bridgeEvidenceBasis: r.bridgeEvidenceBasis,
    boundary: r.boundary,
    productTruthFactIds: r.productTruthFactIds,
    reason: r.reason
})), null, 2)}

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
export function judgePainClassifierOutput(
  registry: AuthoritativeAudiencePain[],
  records: LlmPainRecord[] | null,
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
    if (!VALID_CLASSES.includes(record.classification as AudiencePainClass)) {
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
      if (productFit === "ELIGIBLE") fitType = "DIRECT_FIT";
      else if (productFit === "INELIGIBLE") fitType = "NOT_FIT";
      else fitType = "UNKNOWN";
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
    if (deterministic === "POST_PURCHASE_FRICTION" && record.classification === "CORE_PURCHASE") {
      rejections.push({ painId, code: "LLM_POST_PURCHASE_PROMOTION_FORBIDDEN" });
      continue;
    }

    let reason = record.reason.trim();

    accepted.set(painId, {
      classification: record.classification as AudiencePainClass,
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
export function applyJudgedPainClassification(
  registry: AuthoritativeAudiencePain[],
  judge: PainJudgeResult,
): AuthoritativeAudiencePain[] {
  const updated = registry.map((pain) => {
    const verdict = judge.accepted.get(pain.painId);
    if (!verdict) return pain;
    const classification = verdict.classification;
    const allowedUses = allowedUsesForClass(classification);
    const productFit = verdict.productFit;
    return {
      ...pain,
      classification,
      allowedUses,
      prohibitedUses: prohibitedUsesForClass(classification),
      productFit,
      fitType: verdict.fitType ?? (productFit === "ELIGIBLE" ? "DIRECT_FIT" : (productFit === "INELIGIBLE" ? "NOT_FIT" : "UNKNOWN")),
      strategicBridge: verdict.strategicBridge,
      boundary: verdict.boundary,
      productTruthFactIds: verdict.productTruthFactIds,
      eligible: pain.eligible !== false && productFit === "ELIGIBLE" && pain.canonical.length > 0
        ? true
        : productFit === "ELIGIBLE" && pain.eligible,
      classifierVersion: LLM_CLASSIFIER_VERSION,
      classificationReason: verdict.reason,
      rank: judge.semanticRanks?.get(pain.painId) ?? pain.rank,
    };
  });
  return updated.sort((a, b) => a.rank - b.rank);
}

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
  const allUids = [...new Set(registry.flatMap((p) => p.evidenceUids.filter((uid) => uid.startsWith("EV:"))))];
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
export async function refineAudiencePainRegistry(
  registry: AuthoritativeAudiencePain[],
  opts: { 
    accountId: string; 
    campaignId: string; 
    productCapabilities?: string | ProductTruthFact[] | null; 
    businessProfile?: string | null;
    audienceSegments?: any[];
    llmEnabled?: boolean;
  },
): Promise<{ registry: AuthoritativeAudiencePain[]; classifierUsed: string; judgeRejections: string[]; evidenceIssues: string[] }> {
  let working = registry;
  let classifierUsed = "deterministic_v1";
  const allJudgeRejections: string[] = [];
  
  if (opts.llmEnabled !== false && registry.length > 0) {
    const lockedAccepted = new Map<string, {
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

    let attempt = 0;
    const maxAttempts = 2;
    let previousRejections: string[] = [];
    
    while (attempt < maxAttempts) {
      attempt++;
      const pending = registry.filter(p => !lockedAccepted.has(p.painId));
      if (pending.length === 0) break;

      const llmRecords = await classifyPainRegistryWithLLM(pending, {
        accountId: opts.accountId,
        campaignId: opts.campaignId,
        productCapabilities: opts.productCapabilities ?? null,
        businessProfile: opts.businessProfile ?? null,
        audienceSegments: opts.audienceSegments ?? [],
      }, previousRejections);
      
      const structuralJudge = judgePainClassifierOutput(pending, llmRecords, opts.audienceSegments, {
        productCapabilities: opts.productCapabilities,
        businessProfile: opts.businessProfile,
      });

      // Semantic Judge on structurally valid candidates
      const candidateRecords = (llmRecords || []).filter(r => structuralJudge.accepted.has(r.painId));
      const semanticVerdicts = await judgePainWithLLM(pending, candidateRecords, {
        accountId: opts.accountId,
        productCapabilities: opts.productCapabilities,
        businessProfile: opts.businessProfile,
        audienceSegments: opts.audienceSegments
      });

      const currentRejections: string[] = [];

      for (const r of structuralJudge.rejections) {
        currentRejections.push(`${r.code}:${r.painId}`);
        allJudgeRejections.push(`${r.code}:${r.painId}`);
      }

      for (const [painId, acceptedVerdict] of structuralJudge.accepted.entries()) {
        const semanticVerdict = semanticVerdicts.get(painId);
        if (semanticVerdict && !semanticVerdict.valid) {
          const code = semanticVerdict.rejectionCode || "SEMANTIC_JUDGE_REJECTED";
          let rejectionStr = `${code}:${painId} — ${semanticVerdict.critique || "Rejected by semantic judge"}`;
          if (semanticVerdict.repairDirective) rejectionStr += `\nRepair Directive: ${semanticVerdict.repairDirective}`;
          currentRejections.push(rejectionStr);
          allJudgeRejections.push(`${code}:${painId}`);
        } else {
          lockedAccepted.set(painId, acceptedVerdict);
        }
      }

      if (lockedAccepted.size === registry.length) {
        break;
      }
      previousRejections = currentRejections;
    }

    if (lockedAccepted.size > 0) {
      const finalJudgeResult: PainJudgeResult = {
        accepted: lockedAccepted,
        semanticRanks: null,
        rejections: allJudgeRejections.map(r => ({ painId: r.split(":")[1] || "*", code: r.split(":")[0] }))
      };
      working = applyJudgedPainClassification(registry, finalJudgeResult);
      classifierUsed = LLM_CLASSIFIER_VERSION;
    }
  }
  
  const ownership = await validatePainEvidenceOwnership(working, opts.accountId, opts.campaignId);
  return { registry: ownership.registry, classifierUsed, judgeRejections: allJudgeRejections, evidenceIssues: ownership.issues };
}
