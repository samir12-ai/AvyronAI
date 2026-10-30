import { aiChat } from "../ai-client";
import {
  type AuthoritativeAudiencePain,
  type AudiencePainClass,
  type ProductFitType,
  type GroundedPainEvidence,
  type StrategicPainMateriality,
  type CandidateAudiencePain,
  type CanonicalEvidenceRegistry,
  bindPainEvidence,
  LLM_CLASSIFIER_VERSION,
  allowedUsesForClass,
  prohibitedUsesForClass,
} from "./audience-pain-registry";

export {
  LLM_CLASSIFIER_VERSION,
  bindPainEvidence,
};
export type {
  GroundedPainEvidence,
  StrategicPainMateriality,
  CandidateAudiencePain,
  CanonicalEvidenceRegistry,
};

import { getEvidenceByUids } from "../strategic-reasoning/evidence-registry";
import { runTargetAssessmentForPain } from "../strategic-reasoning/target-assessment";
import { runProductAssessmentForPain } from "../strategic-reasoning/product-assessment";
import { judgeStrategicPainDecision } from "../strategic-pain-decision-judge";
import { refineFinalPainAtomicityRegistry } from "./pain-atomicity";

export interface ProductTruthFact {
  factId: string;
  sourceField: string;
  rawValue: string;
  campaignId?: string;
  accountId?: string;
  provenance?: string;
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

/**
 * Resolves the SPD Materiality Dossier for an authoritative audience pain.
 * If the pain is already grounded, returns its canonical materiality directly.
 * If candidate pain needs binding, binds via bindPainEvidence.
 */
export function buildMaterialityContextForPain(
  pain: AuthoritativeAudiencePain | CandidateAudiencePain,
  canonicalEvidenceRegistry?: CanonicalEvidenceRegistry | EvidenceContextMap,
): StrategicPainMateriality {
  if ((pain as any).materiality) {
    return (pain as any).materiality;
  }
  if (canonicalEvidenceRegistry) {
    const bound = bindPainEvidence(pain, canonicalEvidenceRegistry as any);
    if (bound) return bound;
  }
  return {
    mode: "NONE",
    evidence: [],
    rawEvidenceUids: [],
    rawCitationCount: 0,
    uniqueEvidenceCount: 0,
    sourceTypes: [],
    uniqueCompetitorCount: 0,
  };
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




export type PainFidelityVerdict = "FAITHFUL" | "OVER_GENERALIZED" | "SEMANTIC_DRIFT" | "UNSUPPORTED" | "FIDELITY_JUDGE_INCOMPLETE";

/**
 * Hostile Audience Pain-Fidelity Judge & Targeted Bounded Repair.
 * Enforces that every pain claim is strictly and completely entailed by cited customer evidence.
 * Prevents routine customer questions from becoming complaints, and restock inquiries from becoming system failures.
 * Executes a bounded retry/repair loop (up to 3 attempts) before failing closed.
 */
const painFidelityCache = new Map<string, {
  verdict: PainFidelityVerdict;
  canonical: string;
  critique?: string;
}>();

export function __clearPainClassifierCacheForTests(): void {
  painFidelityCache.clear();
}

function computePainFidelityCacheKey(accountId: string, painClaim: string, evidenceTexts: string[]): string {
  const normClaim = String(painClaim || "").trim().toLowerCase().replace(/\s+/g, " ");
  const normEv = [...evidenceTexts]
    .map(t => String(t || "").trim().toLowerCase().replace(/\s+/g, " "))
    .filter(Boolean)
    .sort()
    .join("||");
  return `${accountId || "default"}::${normClaim}::${normEv}`;
}

export async function judgeAndRepairPainFidelityWithLLM(opts: {
  painClaim: string;
  evidenceTexts: string[];
  segmentName?: string;
  segmentDefinition?: string;
  accountId: string;
}): Promise<{
  verdict: PainFidelityVerdict;
  canonical: string;
  critique?: string;
}> {
  const { painClaim, evidenceTexts, segmentName, segmentDefinition, accountId } = opts;
  if (!evidenceTexts || evidenceTexts.length === 0) {
    return { verdict: "FAITHFUL", canonical: painClaim };
  }

  const cacheKey = computePainFidelityCacheKey(accountId, painClaim, evidenceTexts);
  const cached = painFidelityCache.get(cacheKey);
  if (cached) {
    return { ...cached };
  }

  const MAX_ATTEMPTS = 3;
  let lastError = "Initial generation unstarted";
  let lastRawResponse = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const isRepairAttempt = attempt > 1;
    const prompt = isRepairAttempt
      ? `You are the Hostile Audience Pain Fidelity Judge (TARGETED REPAIR Attempt ${attempt} of ${MAX_ATTEMPTS}).
A previous evaluation attempt failed validation.

PROPOSED PAIN CLAIM:
"${painClaim}"

CITED CUSTOMER EVIDENCE:
${evidenceTexts.map((t, idx) => `[Evidence ${idx + 1}] "${t}"`).join("\n")}

${segmentName ? `SEGMENT CONTEXT: ${segmentName}${segmentDefinition ? ` — ${segmentDefinition}` : ""}\n` : ""}
PREVIOUS VALIDATION ERROR:
${lastError}
${lastRawResponse ? `PREVIOUS INVALID RAW RESPONSE:\n${lastRawResponse}\n` : ""}
CONSTITUTIONAL FIDELITY INVARIANTS:
1. CUSTOMER QUESTION != CUSTOMER PAIN:
   - Routine customer inquiries (e.g. "Price please", "How much?", "What size is the model wearing?", "When will medium be back?") represent information seeking, sizing questions, or purchase intent.
   - They MUST NOT be classified as negative customer complaints, frictions, or "difficulty finding pricing/sizing" unless the evidence explicitly expresses confusion, hidden pricing, or complaint.
   - If a claim converts simple questions into negative pain without evidence of difficulty/friction -> verdict = "OVER_GENERALIZED" or "UNSUPPORTED".
2. RESTOCK VS SYSTEM FAILURE:
   - Inquiries asking for restocks (e.g. "Please restock medium", "Everything is sold out :(((") establish stockout / product availability frustration.
   - They DO NOT establish "poor inventory transparency", "operational fulfillment failure", "lack of accessible stock information", or warehouse/tracking defects.
   - If a claim asserts operational/system failure for simple restock requests -> verdict = "OVER_GENERALIZED" or "SEMANTIC_DRIFT".
3. STRICT ENTAILMENT:
   - Every material clause in the canonical pain must be directly supported by the quotes.
   - Do NOT allow ungrounded compound conjoining of unrelated frictions.
4. NO OVER-SPECIALIZATION / PREFERENCE TO REQUIREMENT UPGRADE:
   - Customer preferences, tips, or material dislikes (e.g. "polyester feels hot", "prefer cotton/linen", "avoid synthetic blends in summer") describe fabric comfort, breathability, or heat discomfort frictions.
   - They MUST NOT be upgraded into a mandatory universal requirement or category exclusion (e.g. "buyers require natural breathable fabrics", "cannot wear synthetics") unless the cited evidence explicitly proves an absolute category requirement.
   - If a claim converts informal material advice or examples into a strict universal requirement -> verdict = "OVER_GENERALIZED" or "SEMANTIC_DRIFT".
   - The "repairedClaim" MUST remove the unsupported narrow specificity while preserving the faithful core customer problem (e.g. difficulty finding comfortable, breathable clothing for hot weather).

CORRECTION INSTRUCTIONS:
- You MUST return a single valid JSON object matching the exact schema below.
- If verdict is "OVER_GENERALIZED" or "SEMANTIC_DRIFT", you MUST provide a non-empty "repairedClaim" that rewrites the pain to express ONLY what customers actually stated.
- If evidence contains NO customer friction or complaint at all, set verdict = "UNSUPPORTED".

Output JSON format exactly:
{
  "verdict": "FAITHFUL" | "OVER_GENERALIZED" | "SEMANTIC_DRIFT" | "UNSUPPORTED",
  "critique": "Specific reason for the verdict",
  "repairedClaim": "Faithfully rewritten claim (required if OVER_GENERALIZED or SEMANTIC_DRIFT)"
}`
      : `You are the Hostile Audience Pain Fidelity Judge.
Your sole job is to verify that the proposed canonical pain claim is strictly and completely entailed by the cited customer evidence.

PROPOSED PAIN CLAIM:
"${painClaim}"

CITED CUSTOMER EVIDENCE:
${evidenceTexts.map((t, idx) => `[Evidence ${idx + 1}] "${t}"`).join("\n")}

${segmentName ? `SEGMENT CONTEXT: ${segmentName}${segmentDefinition ? ` — ${segmentDefinition}` : ""}` : ""}

CONSTITUTIONAL FIDELITY INVARIANTS:
1. CUSTOMER QUESTION != CUSTOMER PAIN:
   - Routine customer inquiries (e.g. "Price please", "How much?", "What size is the model wearing?", "When will medium be back?") represent information seeking, sizing questions, or purchase intent.
   - They MUST NOT be classified as negative customer complaints, frictions, or "difficulty finding pricing/sizing" unless the evidence explicitly expresses confusion, hidden pricing, or complaint.
   - If a claim converts simple questions into negative pain without evidence of difficulty/friction -> verdict = "OVER_GENERALIZED" or "UNSUPPORTED".
2. RESTOCK VS SYSTEM FAILURE:
   - Inquiries asking for restocks (e.g. "Please restock medium", "Everything is sold out :(((") establish stockout / product availability frustration.
   - They DO NOT establish "poor inventory transparency", "operational fulfillment failure", "lack of accessible stock information", or warehouse/tracking defects.
   - If a claim asserts operational/system failure for simple restock requests -> verdict = "OVER_GENERALIZED" or "SEMANTIC_DRIFT".
3. STRICT ENTAILMENT:
   - Every material clause in the canonical pain must be directly supported by the quotes.
   - Do NOT allow ungrounded compound conjoining of unrelated frictions.
4. NO OVER-SPECIALIZATION / PREFERENCE TO REQUIREMENT UPGRADE:
   - Customer preferences, tips, or material dislikes (e.g. "polyester feels hot", "prefer cotton/linen", "avoid synthetic blends in summer") describe fabric comfort, breathability, or heat discomfort frictions.
   - They MUST NOT be upgraded into a mandatory universal requirement or category exclusion (e.g. "buyers require natural breathable fabrics", "cannot wear synthetics") unless the cited evidence explicitly proves an absolute category requirement.
   - If a claim converts informal material advice or examples into a strict universal requirement -> verdict = "OVER_GENERALIZED" or "SEMANTIC_DRIFT".
   - The "repairedClaim" MUST remove the unsupported narrow specificity while preserving the faithful core customer problem (e.g. difficulty finding comfortable, breathable clothing for hot weather).

VERDICT OPTIONS:
- "FAITHFUL": The claim is fully and directly supported by the evidence without exaggeration, speculation, or invented operational mechanisms.
- "OVER_GENERALIZED": The claim takes a narrow or simple signal (e.g. asking for a price or restock) and exaggerates it into a broad operational problem.
- "SEMANTIC_DRIFT": The claim asserts causes, mechanisms, or issues that differ from what the customer actually said.
- "UNSUPPORTED": The evidence does not describe a friction/pain at all (e.g. routine questions, positive praise, spam).

TASK:
1. Determine if the claim is FAITHFUL, OVER_GENERALIZED, SEMANTIC_DRIFT, or UNSUPPORTED.
2. If OVER_GENERALIZED or SEMANTIC_DRIFT, provide "repairedClaim" that rewrites the pain to express ONLY the strongest semantic claim directly supported by the cited customer evidence.
   - Do NOT strengthen the pain.
   - Do NOT infer hidden causes or operational failures.
   - Do NOT convert simple questions into complaints.
   - State ONLY what customers actually experienced or expressed.

Output JSON format:
{
  "verdict": "FAITHFUL" | "OVER_GENERALIZED" | "SEMANTIC_DRIFT" | "UNSUPPORTED",
  "critique": "Specific reason for the verdict",
  "repairedClaim": "Faithfully rewritten claim (required if OVER_GENERALIZED or SEMANTIC_DRIFT)"
}`;

    try {
      const res = await aiChat({
        messages: [{ role: "user", content: prompt }],
        model: "gpt-4.1-mini",
        max_tokens: 1024,
        response_format: { type: "json_object" },
        accountId,
        endpoint: "pain-fidelity-judge"
      });

      lastRawResponse = res.choices[0]?.message?.content || "";
      let parsed: any;
      try {
        parsed = JSON.parse(lastRawResponse);
      } catch (parseErr: any) {
        lastError = `JSON parse failed: ${parseErr.message}`;
        console.warn(`[PainClassifier] Pain fidelity judge attempt ${attempt}/${MAX_ATTEMPTS} malformed JSON: ${parseErr.message}`);
        continue;
      }

      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        lastError = "Response was not a valid JSON object";
        console.warn(`[PainClassifier] Pain fidelity judge attempt ${attempt}/${MAX_ATTEMPTS} invalid root object`);
        continue;
      }

      const verdict = parsed.verdict;
      if (!["FAITHFUL", "OVER_GENERALIZED", "SEMANTIC_DRIFT", "UNSUPPORTED"].includes(verdict)) {
        lastError = `Invalid verdict '${verdict}'. Must be FAITHFUL, OVER_GENERALIZED, SEMANTIC_DRIFT, or UNSUPPORTED`;
        console.warn(`[PainClassifier] Pain fidelity judge attempt ${attempt}/${MAX_ATTEMPTS} invalid verdict: ${verdict}`);
        continue;
      }

      const critique = typeof parsed.critique === "string" ? parsed.critique.trim() : "";

      if (verdict === "FAITHFUL") {
        const resObj = { verdict: "FAITHFUL" as const, canonical: painClaim, critique };
        painFidelityCache.set(cacheKey, resObj);
        return resObj;
      }

      if (verdict === "UNSUPPORTED") {
        const resObj = { verdict: "UNSUPPORTED" as const, canonical: painClaim, critique };
        painFidelityCache.set(cacheKey, resObj);
        return resObj;
      }

      if (verdict === "OVER_GENERALIZED" || verdict === "SEMANTIC_DRIFT") {
        if (!parsed.repairedClaim || typeof parsed.repairedClaim !== "string" || parsed.repairedClaim.trim().length < 3) {
          lastError = `Verdict was '${verdict}' but 'repairedClaim' was missing, not a string, or under 3 characters`;
          console.warn(`[PainClassifier] Pain fidelity judge attempt ${attempt}/${MAX_ATTEMPTS} missing/invalid repairedClaim`);
          continue;
        }
        const repaired = parsed.repairedClaim.trim();
        const resObj = { verdict: verdict as PainFidelityVerdict, canonical: repaired, critique };
        painFidelityCache.set(cacheKey, resObj);
        const repairedKey = computePainFidelityCacheKey(accountId, repaired, evidenceTexts);
        painFidelityCache.set(repairedKey, { verdict: "FAITHFUL", canonical: repaired, critique });
        return resObj;
      }
    } catch (chatErr: any) {
      lastError = `Provider error: ${chatErr.message}`;
      console.warn(`[PainClassifier] Pain fidelity judge attempt ${attempt}/${MAX_ATTEMPTS} provider error: ${chatErr.message}`);
    }
  }

  // All bounded attempts exhausted -> FAIL CLOSED explicitly
  console.warn(`[PainClassifier] PAIN_FIDELITY_EXHAUSTED | painClaim="${painClaim}" | attempts=${MAX_ATTEMPTS} | lastError=${lastError}`);
  return {
    verdict: "FIDELITY_JUDGE_INCOMPLETE",
    canonical: painClaim,
    critique: `Pain fidelity judge exhausted ${MAX_ATTEMPTS} bounded attempts. Last error: ${lastError}`,
  };
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let currentIndex = 0;
  async function worker() {
    while (currentIndex < items.length) {
      const idx = currentIndex++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
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
    evidenceContext?: EvidenceContextMap;
    llmEnabled?: boolean;
    atomicityJudge?: any;
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
      const { resolveCurrentBusinessUnderstanding } = await import("../business-understanding/resolver");
      const buResult = await resolveCurrentBusinessUnderstanding({
        accountId: opts.accountId,
        campaignId: opts.campaignId,
      });
      bu = buResult?.payload;
    } catch (e: any) {
      console.warn(`[PainClassifier] Failed to resolve canonical Business Understanding: ${e.message}`);
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

  // 1b. Authoritative Final Pain Atomicity Judge & Splitter (post-consolidation, pre-PA gate)
  const { registry: atomicRegistry, atomicityRejections } = await refineFinalPainAtomicityRegistry(registry, {
    accountId: opts.accountId,
    campaignId: opts.campaignId,
    evidenceContext: opts.evidenceContext,
    audienceSegments: opts.audienceSegments,
    llmEnabled: opts.llmEnabled,
    atomicityJudge: opts.atomicityJudge,
  });
  allJudgeRejections.push(...atomicityRejections);

  console.log(`[PainClassifier] FINAL_ATOMICITY_PROCESSED | inputPains=${registry.length} -> atomicPains=${atomicRegistry.length} | atomicityRejections=${atomicityRejections.length}`);

  // 2. Concurrent Assessment per Atomic Canonical Pain: Fidelity Check -> TargetAssessment -> ProductAssessment -> StrategicPainDecision
  const assessedPains = await mapConcurrent(atomicRegistry, 4, async (pain) => {
    // Fail-closed gate: incomplete or already excluded pains from atomicity bypass PA/TA/SPD
    if (pain.classificationReason?.startsWith("ATOMICITY_INCOMPLETE")) {
      return {
        evaluated: pain,
        rejectionNotice: `ATOMICITY_EXCLUDED:${pain.painId} - ${pain.classificationReason}`,
      };
    }

    const segContext = (opts.audienceSegments || []).find(
      (s: any) => s.id === pain.segmentId || s.name === pain.segmentName || s.name === pain.segmentId
    );

    // Step 0: Hostile Pain-Fidelity Judge & Targeted Bounded Repair (per atomic pain with child evidence subset)
    let effectiveCanonicalPain = pain.canonical;
    let evidenceTexts: string[] = [];
    if ((pain as any).materiality?.mode === "GROUNDED") {
      evidenceTexts = (pain as any).materiality.evidence.map((e: any) => e.verbatimText);
    } else if (opts.evidenceContext && pain.evidenceUids) {
      evidenceTexts = pain.evidenceUids.map(uid => opts.evidenceContext?.get(uid)?.detail || "").filter(Boolean);
    }
    if (evidenceTexts.length === 0 && Array.isArray((pain as any).evidence)) {
      evidenceTexts = (pain as any).evidence.filter((e: any) => typeof e === "string");
    }
    if (evidenceTexts.length === 0 && Array.isArray((pain as any).evidenceSummaries)) {
      evidenceTexts = (pain as any).evidenceSummaries.filter((e: any) => typeof e === "string");
    }

    if (evidenceTexts.length > 0 && opts.llmEnabled !== false) {
      const fidelityResult = await judgeAndRepairPainFidelityWithLLM({
        painClaim: pain.canonical,
        evidenceTexts,
        segmentName: segContext?.name,
        segmentDefinition: segContext?.segmentDefinition?.claim || segContext?.description,
        accountId: opts.accountId
      });

      if (fidelityResult.verdict === "UNSUPPORTED" || fidelityResult.verdict === "FIDELITY_JUDGE_INCOMPLETE") {
        const isJudgeIncomplete = fidelityResult.verdict === "FIDELITY_JUDGE_INCOMPLETE";
        console.log(`[PainClassifier] ${isJudgeIncomplete ? "PAIN_FIDELITY_INCOMPLETE" : "PAIN_FIDELITY_UNSUPPORTED"} | painId=${pain.painId} | critique=${fidelityResult.critique || 'no negative friction in evidence'}`);
        return {
          evaluated: {
            ...pain,
            classification: "UNKNOWN" as AudiencePainClass,
            strategicPainDecisionAuthorityId: undefined,
            targetAssessmentAuthorityId: undefined,
            productAssessmentAuthorityId: undefined,
            targetUnderstandingAuthorityId,
            businessUnderstandingAuthorityId,
            campaignOfferingId,
            coverageDecision: undefined,
            fitType: "UNKNOWN" as ProductFitType,
            productFit: "UNKNOWN" as const,
            allowedUses: [],
            prohibitedUses: prohibitedUsesForClass("UNKNOWN"),
            productTruthFactIds,
            eligible: false,
            classifierVersion: LLM_CLASSIFIER_VERSION,
            classificationReason: fidelityResult.critique || (isJudgeIncomplete ? "Fidelity judge incomplete — could not verify against evidence." : "Evidence describes routine questions/intent, not a negative customer pain."),
          },
          rejectionNotice: `${isJudgeIncomplete ? "PAIN_FIDELITY_INCOMPLETE" : "PAIN_FIDELITY_UNSUPPORTED"}:${pain.painId} - ${fidelityResult.critique || 'unverified or unsupported customer pain'}`,
        };
      }

      if (fidelityResult.canonical !== pain.canonical) {
        console.log(`[PainClassifier] PAIN_FIDELITY_REPAIRED | painId=${pain.painId} | original="${pain.canonical}" -> repaired="${fidelityResult.canonical}"`);
        effectiveCanonicalPain = fidelityResult.canonical;
      }
    }

    // Step A: Target Assessment
    const ta = await runTargetAssessmentForPain({
      painId: pain.painId,
      segmentId: pain.segmentId || pain.segmentName || "default_segment",
      canonicalPain: effectiveCanonicalPain,
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
      canonicalPain: effectiveCanonicalPain,
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
      painClaim: effectiveCanonicalPain,
      productFitType: pa.fitType,
      targetCoverageDecision: ta.decision,
      productTruthFacts,
      productAssessmentReason: pa.reason,
      materiality: (pain as any).materiality || buildMaterialityContextForPain(pain, opts.evidenceContext as any),
      accountId: opts.accountId,
      campaignId: opts.campaignId,
    });

    let finalClass: AudiencePainClass = "SUPPORTING";
    let rejectionNotice: string | null = null;
    if (spd.finalClassification === "CORE_PURCHASE") {
      finalClass = "CORE_PURCHASE";
    } else if (spd.finalClassification === "SUPPORTING") {
      finalClass = "SUPPORTING";
    } else if (spd.finalClassification === "EXCLUDE" || spd.finalClassification === "DROPPED") {
      finalClass = "UNKNOWN";
      rejectionNotice = `STRATEGIC_EXCLUDED:${pain.painId} - ${spd.reason}`;
    }

    const allowedUses = allowedUsesForClass(finalClass);
    const prohibitedUses = prohibitedUsesForClass(finalClass);

    return {
      evaluated: {
        ...pain,
        canonical: effectiveCanonicalPain,
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
        eligible: finalClass !== "UNKNOWN" && allowedUses.length > 0 && effectiveCanonicalPain.length > 0,
        classifierVersion: LLM_CLASSIFIER_VERSION,
        classificationReason: spd.reason,
      },
      rejectionNotice,
    };
  });

  for (const item of assessedPains) {
    working.push(item.evaluated as AuthoritativeAudiencePain);
    if (item.rejectionNotice) {
      allJudgeRejections.push(item.rejectionNotice);
    }
  }

  working.sort((a, b) => a.rank - b.rank);

  const ownership = await validatePainEvidenceOwnership(working, opts.accountId, opts.campaignId);
  return { registry: ownership.registry, classifierUsed, judgeRejections: allJudgeRejections, evidenceIssues: ownership.issues };
}

