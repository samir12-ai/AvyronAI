import { aiChat } from "../ai-client";
import {
  type AuthoritativeAudiencePain,
  type AudiencePainClass,
  type ProductFitType,
  type EvidenceContextMap,
  LLM_CLASSIFIER_VERSION,
  allowedUsesForClass,
  prohibitedUsesForClass,
  normalizeStatement,
} from "./audience-pain-registry";
import { generateWithRepair, LLMReliabilityError } from "../shared/llm-reliability/reliability-runner";

export interface SplitPatch {
  claimId?: string;
  action: "REMOVE" | "REPLACE" | "SPLIT" | "KEEP";
  repairedClaim?: {
    claim: string;
    evidenceIds: string[];
  };
  splitClaims?: Array<{
    claim: string;
    evidenceIds: string[];
  }>;
}

export interface PairedEvidenceItem {
  evidenceId: string;
  text: string;
}

export type PainAtomicityVerdict = "ATOMIC" | "COMPOUND_PAIN" | "ATOMICITY_INCOMPLETE";

export interface FinalAtomicityResult {
  verdict: PainAtomicityVerdict;
  action: "KEEP" | "SPLIT" | "REPLACE";
  repairedClaim?: string;
  splitClaims?: Array<{ claim: string; evidenceIds: string[] }>;
  critique?: string;
}

/**
 * Extracts evidence items from a pain claim and evidence context as strict ID <-> text pairs.
 * Filters invalid or missing entries as pairs, ensuring that every displayed evidence text
 * always corresponds to its exact evidence ID.
 */
export function extractPairedEvidence(
  pain: AuthoritativeAudiencePain,
  evidenceContext?: EvidenceContextMap
): PairedEvidenceItem[] {
  const paired: PairedEvidenceItem[] = [];
  const rawUids = Array.isArray(pain.evidenceUids) && pain.evidenceUids.length > 0
    ? pain.evidenceUids
    : (pain.sourceSignalIds || []);

  if (evidenceContext && rawUids.length > 0) {
    for (const uid of rawUids) {
      const item = evidenceContext.get(uid);
      const text = item?.detail || item?.label || "";
      if (typeof text === "string" && text.trim().length > 0) {
        paired.push({ evidenceId: uid, text: text.trim() });
      }
    }
  }

  // Fallback to embedded evidence / evidenceSummaries if no evidenceContext matches
  if (paired.length === 0) {
    const embeddedTexts: string[] = [];
    if (Array.isArray((pain as any).evidence)) {
      embeddedTexts.push(...(pain as any).evidence.filter((e: any) => typeof e === "string" && e.trim().length > 0));
    }
    if (embeddedTexts.length === 0 && Array.isArray((pain as any).evidenceSummaries)) {
      embeddedTexts.push(...(pain as any).evidenceSummaries.filter((e: any) => typeof e === "string" && e.trim().length > 0));
    }
    for (let idx = 0; idx < embeddedTexts.length; idx++) {
      const fallbackId = rawUids[idx] || `EV_${idx + 1}`;
      paired.push({ evidenceId: fallbackId, text: embeddedTexts[idx].trim() });
    }
  }

  // Fallback to rawUids if no text detail was available
  if (paired.length === 0 && rawUids.length > 0) {
    for (let idx = 0; idx < rawUids.length; idx++) {
      paired.push({ evidenceId: rawUids[idx], text: `Cited customer evidence reference ${rawUids[idx]}` });
    }
  }

  return paired;
}

/**
 * Structural safety validator and deterministic merger for action: "SPLIT".
 * Ensures every SPLIT child claim:
 * 1. Has non-empty claim text.
 * 2. Has non-empty evidenceIds array.
 * 3. Enforces the structural invariant: childEvidenceIds ⊆ authorizedParentEvidenceUniverse.
 * 4. Fails closed (throws) on invented/unauthorized evidence or malformed structure.
 */
export function validateAndApplySplitClaim(
  parentClaim: { claimId: string; claim: string; evidenceIds: string[] },
  patch: SplitPatch,
  allowedEvidenceUniverse?: Set<string>
): Array<{ claimId: string; claim: string; evidenceIds: string[] }> {
  if (!patch || patch.action !== "SPLIT" || !Array.isArray(patch.splitClaims) || patch.splitClaims.length < 2) {
    throw new Error("SPLIT patch must contain at least 2 splitClaims");
  }

  const parentUniverse = allowedEvidenceUniverse || new Set<string>((parentClaim.evidenceIds || []).map(String));

  const resultingClaims: Array<{ claimId: string; claim: string; evidenceIds: string[] }> = [];

  for (let scIdx = 0; scIdx < patch.splitClaims.length; scIdx++) {
    const sc = patch.splitClaims[scIdx];
    if (!sc || typeof sc.claim !== "string" || sc.claim.trim().length === 0) {
      throw new Error(`SPLIT child claim at index ${scIdx} is missing or has empty text`);
    }
    if (!Array.isArray(sc.evidenceIds) || sc.evidenceIds.length === 0) {
      throw new Error(`SPLIT child claim at index ${scIdx} must have a non-empty evidenceIds array`);
    }

    // Structural invariant: childEvidenceIds ⊆ authorizedParentEvidenceUniverse
    for (const eid of sc.evidenceIds) {
      if (typeof eid !== "string" || !parentUniverse.has(eid)) {
        throw new Error(`SPLIT child claim "${sc.claim}" cites unauthorized or invented evidence ID "${eid}" outside authorized parent universe`);
      }
    }

    resultingClaims.push({
      claimId: `${parentClaim.claimId}_split_${scIdx + 1}`,
      claim: sc.claim.trim(),
      evidenceIds: [...new Set(sc.evidenceIds)],
    });
  }

  return resultingClaims;
}

/**
 * Builds domain-neutral constitutional atomicity judge and repair prompts.
 * Free of domain-specific (fashion, fabric, refund, SaaS, database, healthcare) hardcoding.
 */
export function buildAtomicityPrompt(opts: {
  painClaim: string;
  evidenceItems: PairedEvidenceItem[];
  segmentName?: string;
  segmentDefinition?: string;
  rejectionFeedback?: string;
}): string {
  const { painClaim, evidenceItems, segmentName, segmentDefinition, rejectionFeedback } = opts;
  const isRepair = !!rejectionFeedback;

  return `${isRepair ? `You are the Authoritative Final Pain Atomicity Judge (TARGETED REPAIR).
A previous evaluation attempt failed validation: ${rejectionFeedback}
Please correct the verdict/action and payload accordingly.
` : `You are the Authoritative Final Pain Atomicity Judge.
Your sole responsibility is to evaluate whether the proposed canonical customer pain claim represents ONE COHERENT CAUSAL PROBLEM UNIT, or whether it conjoins multiple distinct, independently actionable problems.
`}
PROPOSED PAIN CLAIM:
"${painClaim}"

CITED CUSTOMER EVIDENCE:
${evidenceItems.length > 0
  ? evidenceItems.map(item => `[Evidence ID: ${item.evidenceId}] "${item.text}"`).join("\n")
  : "(No specific customer evidence quotes provided)"}

${segmentName ? `SEGMENT CONTEXT: ${segmentName}${segmentDefinition ? ` — ${segmentDefinition}` : ""}` : ""}

CONSTITUTIONAL ATOMICITY DOCTRINE:
1. ONE COHERENT CAUSAL PROBLEM UNIT (ATOMIC):
   - A valid atomic pain describes ONE coherent causal customer problem, friction, or constraint.
   - Descriptive attributes, qualifiers, or compound phrases that elaborate the SAME underlying problem form a single coherent problem unit.
   - A grammatical conjunction (e.g. "and", "or", "while", "with") alone does NOT make a claim compound if it articulates one unified causal problem.

2. INDEPENDENTLY ACTIONABLE / DISTINCT CAPABILITY REQUIREMENTS (COMPOUND -> SPLIT):
   - Conjoining distinct customer problems that are independently actionable and require materially different product capabilities, operational delivery mechanisms, or proof architectures to solve.
   - If solving one problem leaves the other completely unsolved because they require different capabilities -> verdict = "COMPOUND_PAIN", action = "SPLIT".

3. CROSS-LIFECYCLE CONJOINING (COMPOUND -> SPLIT):
   - Conjoining issues across different buyer journey stages that receive materially different strategic treatment (e.g., pre-purchase discovery/evaluation barriers vs in-use product performance vs post-purchase support/fulfillment disputes).
   - If problems represent distinct lifecycle phases requiring different strategic positioning or handling -> verdict = "COMPOUND_PAIN", action = "SPLIT".

4. EVIDENCE-BOUNDED SPLIT:
   - When action is "SPLIT", return 2 or more distinct atomic claims under "splitClaims".
   - Each split claim MUST cite ONLY the specific evidence ID(s) from the cited evidence above that directly support that child claim.
   - Every split claim MUST cite at least 1 valid evidence ID from the parent evidence universe: [${evidenceItems.map(i => i.evidenceId).join(", ")}].
   - Do NOT invent evidence IDs.

VALID VERDICT / ACTION COMBINATIONS ONLY:
- {"verdict": "ATOMIC", "action": "KEEP"}: The claim represents a single coherent problem unit.
- {"verdict": "COMPOUND_PAIN", "action": "SPLIT", "splitClaims": [...]}: The claim contains multiple distinct problems that must be split into 2 or more atomic child claims.
- {"verdict": "COMPOUND_PAIN", "action": "REPLACE", "repairedClaim": "..."}: The claim is refined into a single focused atomic statement. Note: repairedClaim will be revalidated for atomicity.

FORBIDDEN INCONSISTENT COMBINATIONS:
- COMPOUND_PAIN with action KEEP is STRICTLY FORBIDDEN.
- ATOMIC with action SPLIT or REPLACE is STRICTLY FORBIDDEN.

Output JSON format exactly:
{
  "verdict": "ATOMIC" | "COMPOUND_PAIN",
  "action": "KEEP" | "SPLIT" | "REPLACE",
  "critique": "Specific causal critique explaining why the claim is atomic or compound",
  "splitClaims": [
    { "claim": "First distinct atomic customer problem...", "evidenceIds": ["${evidenceItems[0]?.evidenceId || "EV_1"}"] },
    { "claim": "Second distinct atomic customer problem...", "evidenceIds": ["${evidenceItems[1]?.evidenceId || evidenceItems[0]?.evidenceId || "EV_2"}"] }
  ],
  "repairedClaim": "Single focused atomic claim (required ONLY if action is REPLACE)"
}`;
}

/**
 * Revalidates a proposed REPLACE repaired claim using the exact same constitutional atomicity doctrine.
 * Returns isAtomic=true only if revalidation returns ATOMIC + KEEP.
 */
async function revalidateRepairedClaim(
  repairedClaim: string,
  evidenceItems: PairedEvidenceItem[],
  accountId: string
): Promise<{ isAtomic: boolean; critique: string }> {
  try {
    const prompt = buildAtomicityPrompt({
      painClaim: repairedClaim,
      evidenceItems,
    });
    const res = await aiChat({
      messages: [{ role: "user", content: prompt }],
      model: "gpt-4.1-mini",
      max_tokens: 1000,
      temperature: 0.0,
      response_format: { type: "json_object" },
      accountId,
      endpoint: "final-pain-atomicity-revalidation"
    });
    const parsed = JSON.parse(res.choices[0]?.message?.content || "{}");
    if (parsed.verdict === "ATOMIC" && parsed.action === "KEEP") {
      return { isAtomic: true, critique: parsed.critique || "Repaired claim certified atomic" };
    }
    return {
      isAtomic: false,
      critique: parsed.critique || `Revalidation returned inconsistent or compound verdict=${parsed.verdict}, action=${parsed.action}`
    };
  } catch (err: any) {
    return { isAtomic: false, critique: `Revalidation provider error: ${err.message}` };
  }
}

/**
 * Authoritative Final Pain Atomicity Judge & Targeted Bounded Repair.
 * Uses shared reliability runner (generateWithRepair) to evaluate whether a candidate canonical pain claim
 * represents ONE COHERENT CAUSAL CUSTOMER PROBLEM or conjoins multiple distinct, independently actionable problems.
 * Strictly enforces verdict/action consistency and revalidates REPLACE outputs before downstream passage.
 */
const atomicityCache = new Map<string, FinalAtomicityResult>();

export function __clearPainAtomicityCacheForTests(): void {
  atomicityCache.clear();
}

function computeAtomicityCacheKey(accountId: string, painClaim: string, evidenceItems: PairedEvidenceItem[]): string {
  const normClaim = String(painClaim || "").trim().toLowerCase().replace(/\s+/g, " ");
  const normEv = [...evidenceItems]
    .map(e => `${e.evidenceId}:${String(e.text || "").trim().toLowerCase().replace(/\s+/g, " ")}`)
    .sort()
    .join("||");
  return `${accountId || "default"}::${normClaim}::${normEv}`;
}

export async function judgeAndRepairFinalPainAtomicityWithLLM(opts: {
  painClaim: string;
  painId: string;
  evidenceItems?: PairedEvidenceItem[];
  evidenceTexts?: string[];
  evidenceUids?: string[];
  segmentName?: string;
  segmentDefinition?: string;
  accountId: string;
}): Promise<FinalAtomicityResult> {
  const { painClaim, painId, segmentName, segmentDefinition, accountId } = opts;

  // Build aligned paired evidence items
  let evidenceItems: PairedEvidenceItem[] = opts.evidenceItems || [];
  if (evidenceItems.length === 0 && Array.isArray(opts.evidenceUids) && Array.isArray(opts.evidenceTexts)) {
    const minLen = Math.min(opts.evidenceUids.length, opts.evidenceTexts.length);
    for (let i = 0; i < minLen; i++) {
      const uid = opts.evidenceUids[i];
      const txt = opts.evidenceTexts[i];
      if (uid && typeof txt === "string" && txt.trim().length > 0) {
        evidenceItems.push({ evidenceId: uid, text: txt.trim() });
      }
    }
  }

  const cacheKey = computeAtomicityCacheKey(accountId, painClaim, evidenceItems);
  const cached = atomicityCache.get(cacheKey);
  if (cached) {
    return { ...cached };
  }

  const parentUniverse = new Set<string>([...evidenceItems.map(i => i.evidenceId), ...(opts.evidenceUids || [])]);

  try {
    const runnerOutput = await generateWithRepair<
      { painClaim: string; evidenceItems: PairedEvidenceItem[]; segmentName?: string; segmentDefinition?: string; accountId: string },
      FinalAtomicityResult
    >({
      engineName: "audience",
      touchpointName: "final_pain_atomicity",
      authoritativeInput: { painClaim, evidenceItems, segmentName, segmentDefinition, accountId },
      config: {
        maxRepairs: 2,
        maxTechnicalRetries: 2,
        failClosed: true
      },
      generate: async (input) => {
        const prompt = buildAtomicityPrompt({
          painClaim: input.painClaim,
          evidenceItems: input.evidenceItems,
          segmentName: input.segmentName,
          segmentDefinition: input.segmentDefinition,
        });
        const res = await aiChat({
          messages: [{ role: "user", content: prompt }],
          model: "gpt-4.1-mini",
          max_tokens: 1500,
          temperature: 0.0,
          response_format: { type: "json_object" },
          accountId: input.accountId,
          endpoint: "final-pain-atomicity-judge"
        });
        return JSON.parse(res.choices[0]?.message?.content || "{}");
      },
      judge: async (_input, candidate) => {
        if (!candidate || typeof candidate !== "object") {
          return {
            valid: false,
            failureClass: "CONTRACT_FAILURE",
            rejections: [{ rule: "INVALID_JSON_OBJECT", reason: "Candidate output is not a JSON object" }]
          };
        }

        const { verdict, action, critique, splitClaims, repairedClaim } = candidate;

        // Inconsistent: COMPOUND_PAIN + KEEP
        if (verdict === "COMPOUND_PAIN" && action === "KEEP") {
          return {
            valid: false,
            failureClass: "GENERATION_QUALITY_FAILURE",
            rejections: [{
              rule: "INCONSISTENT_VERDICT_ACTION_COMPOUND_KEEP",
              reason: "Inconsistent output: verdict COMPOUND_PAIN with action KEEP is strictly forbidden. If compound, you must provide action SPLIT with splitClaims, or action REPLACE with repairedClaim."
            }]
          };
        }

        // Inconsistent: ATOMIC + SPLIT / REPLACE
        if (verdict === "ATOMIC" && (action === "SPLIT" || action === "REPLACE")) {
          return {
            valid: false,
            failureClass: "GENERATION_QUALITY_FAILURE",
            rejections: [{
              rule: "INCONSISTENT_VERDICT_ACTION_ATOMIC_SPLIT",
              reason: `Inconsistent output: verdict ATOMIC with action ${action} is strictly forbidden. If atomic, you must use action KEEP.`
            }]
          };
        }

        // Valid: ATOMIC + KEEP
        if (verdict === "ATOMIC" && action === "KEEP") {
          return { valid: true };
        }

        // Valid: COMPOUND_PAIN + SPLIT
        if (verdict === "COMPOUND_PAIN" && action === "SPLIT") {
          if (!Array.isArray(splitClaims) || splitClaims.length < 2) {
            return {
              valid: false,
              failureClass: "CONTRACT_FAILURE",
              rejections: [{ rule: "SPLIT_MIN_CHILDREN", reason: "Action SPLIT requires at least 2 splitClaims" }]
            };
          }

          try {
            validateAndApplySplitClaim(
              { claimId: painId, claim: painClaim, evidenceIds: Array.from(parentUniverse) },
              { action: "SPLIT", splitClaims },
              parentUniverse
            );
            return { valid: true };
          } catch (splitErr: any) {
            return {
              valid: false,
              failureClass: "EVIDENCE_FAILURE",
              rejections: [{ rule: "SPLIT_STRUCTURAL_FAILURE", reason: splitErr.message }]
            };
          }
        }

        // Valid candidate: COMPOUND_PAIN + REPLACE (MUST BE REVALIDATED)
        if (verdict === "COMPOUND_PAIN" && action === "REPLACE") {
          if (!repairedClaim || typeof repairedClaim !== "string" || repairedClaim.trim().length < 3) {
            return {
              valid: false,
              failureClass: "CONTRACT_FAILURE",
              rejections: [{ rule: "REPLACE_EMPTY_CLAIM", reason: "Action REPLACE requires a non-empty repairedClaim string (at least 3 characters)" }]
            };
          }

          // Authoritative revalidation: repairedClaim must be certified ATOMIC + KEEP
          const reval = await revalidateRepairedClaim(repairedClaim.trim(), evidenceItems, accountId);
          if (!reval.isAtomic) {
            return {
              valid: false,
              failureClass: "GENERATION_QUALITY_FAILURE",
              rejections: [{
                rule: "ATOMICITY_REPLACE_STILL_COMPOUND",
                reason: `Proposed repairedClaim "${repairedClaim.trim()}" failed atomicity revalidation: ${reval.critique}. Replacement must be genuinely atomic or split into splitClaims.`
              }]
            };
          }

          return { valid: true };
        }

        return {
          valid: false,
          failureClass: "CONTRACT_FAILURE",
          rejections: [{ rule: "UNKNOWN_VERDICT_ACTION", reason: `Unrecognized verdict=${verdict}, action=${action}` }]
        };
      },
      repair: async (input, failedCandidate, rejections) => {
        const rejectionFeedback = rejections.map(r => `[${r.rule}] ${r.reason}`).join("; ");
        const prompt = buildAtomicityPrompt({
          painClaim: input.painClaim,
          evidenceItems: input.evidenceItems,
          segmentName: input.segmentName,
          segmentDefinition: input.segmentDefinition,
          rejectionFeedback,
        });
        const res = await aiChat({
          messages: [{ role: "user", content: prompt }],
          model: "gpt-4.1-mini",
          max_tokens: 1500,
          temperature: 0.0,
          response_format: { type: "json_object" },
          accountId: input.accountId,
          endpoint: "final-pain-atomicity-repair"
        });
        return JSON.parse(res.choices[0]?.message?.content || "{}");
      }
    });

    const finalRes: FinalAtomicityResult = {
      verdict: runnerOutput.result.verdict,
      action: runnerOutput.result.action,
      repairedClaim: runnerOutput.result.repairedClaim?.trim(),
      splitClaims: runnerOutput.result.splitClaims,
      critique: runnerOutput.result.critique,
    };
    if (finalRes.verdict !== "ATOMICITY_INCOMPLETE") {
      atomicityCache.set(cacheKey, finalRes);
    }
    return finalRes;
  } catch (err: any) {
    console.warn(`[PainAtomicity] FINAL_ATOMICITY_EXHAUSTED | painId=${painId} | claim="${painClaim}" | error=${err.message}`);
    return {
      verdict: "ATOMICITY_INCOMPLETE",
      action: "KEEP",
      critique: `Final pain atomicity judge exhausted bounded repair attempts: ${err.message}`
    };
  }
}

async function mapAtomicityConcurrent<T, R>(items: T[], concurrency: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
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

/**
 * Authoritative Final Pain Atomicity Pipeline Step.
 * Evaluates the full pain registry after consolidation and before Product Assessment.
 * Converts compound pains into atomic child pains (which replace the compound parent) or fails closed.
 */
export async function refineFinalPainAtomicityRegistry(
  registry: AuthoritativeAudiencePain[],
  opts: {
    accountId: string;
    campaignId: string;
    evidenceContext?: EvidenceContextMap;
    audienceSegments?: any[];
    llmEnabled?: boolean;
    atomicityJudge?: (opts: {
      painClaim: string;
      painId: string;
      evidenceItems: PairedEvidenceItem[];
      segmentName?: string;
      segmentDefinition?: string;
      accountId: string;
    }) => Promise<FinalAtomicityResult>;
  }
): Promise<{
  registry: AuthoritativeAudiencePain[];
  atomicityRejections: string[];
}> {
  if (!Array.isArray(registry) || registry.length === 0) {
    return { registry: [], atomicityRejections: [] };
  }

  const perPainResults = await mapAtomicityConcurrent(registry, 4, async (pain) => {
    const localWorking: AuthoritativeAudiencePain[] = [];
    const localRejections: string[] = [];

    const segContext = (opts.audienceSegments || []).find(
      (s: any) => s.id === pain.segmentId || s.name === pain.segmentName || s.name === pain.segmentId
    );

    const pairedEvidence = extractPairedEvidence(pain, opts.evidenceContext);
    const parentEvidenceUids = pairedEvidence.length > 0
      ? pairedEvidence.map(p => p.evidenceId)
      : (Array.isArray(pain.evidenceUids) && pain.evidenceUids.length > 0 ? pain.evidenceUids : (pain.sourceSignalIds || []));

    // Production safety: no bypass of final atomicity authority
    if (opts.llmEnabled === false && !opts.atomicityJudge) {
      localRejections.push(`ATOMICITY_INCOMPLETE:${pain.painId} - Final atomicity authority cannot be bypassed without validation`);
      localWorking.push({
        ...pain,
        classification: "UNKNOWN" as AudiencePainClass,
        productFit: "UNKNOWN" as const,
        fitType: "UNKNOWN" as ProductFitType,
        eligible: false,
        allowedUses: [],
        prohibitedUses: prohibitedUsesForClass("UNKNOWN"),
        classifierVersion: LLM_CLASSIFIER_VERSION,
        classificationReason: "ATOMICITY_INCOMPLETE: Atomicity validation required before Product Assessment",
      });
      return { localWorking, localRejections };
    }

    const atomicityResult = opts.atomicityJudge
      ? await opts.atomicityJudge({
          painClaim: pain.canonical,
          painId: pain.painId,
          evidenceItems: pairedEvidence,
          segmentName: segContext?.name,
          segmentDefinition: segContext?.segmentDefinition?.claim || segContext?.description,
          accountId: opts.accountId
        })
      : await judgeAndRepairFinalPainAtomicityWithLLM({
          painClaim: pain.canonical,
          painId: pain.painId,
          evidenceItems: pairedEvidence,
          segmentName: segContext?.name,
          segmentDefinition: segContext?.segmentDefinition?.claim || segContext?.description,
          accountId: opts.accountId
        });

    if (atomicityResult.verdict === "ATOMICITY_INCOMPLETE") {
      localRejections.push(`ATOMICITY_INCOMPLETE:${pain.painId} - ${atomicityResult.critique || "Compound pain failed final atomicity evaluation"}`);
      localWorking.push({
        ...pain,
        classification: "UNKNOWN" as AudiencePainClass,
        productFit: "UNKNOWN" as const,
        fitType: "UNKNOWN" as ProductFitType,
        eligible: false,
        allowedUses: [],
        prohibitedUses: prohibitedUsesForClass("UNKNOWN"),
        classifierVersion: LLM_CLASSIFIER_VERSION,
        classificationReason: `ATOMICITY_INCOMPLETE: ${atomicityResult.critique || "Compound pain failed final atomicity validation"}`,
      });
      return { localWorking, localRejections };
    }

    if (atomicityResult.verdict === "COMPOUND_PAIN" && atomicityResult.action === "SPLIT" && Array.isArray(atomicityResult.splitClaims) && atomicityResult.splitClaims.length >= 2) {
      console.log(`[PainAtomicity] FINAL_PAIN_SPLIT | parentId=${pain.painId} | parentText="${pain.canonical}" -> ${atomicityResult.splitClaims.length} atomic children`);
      
      const appliedChildren = validateAndApplySplitClaim(
        { claimId: pain.painId, claim: pain.canonical, evidenceIds: parentEvidenceUids },
        { action: "SPLIT", splitClaims: atomicityResult.splitClaims },
        new Set(parentEvidenceUids)
      );

      for (let idx = 0; idx < appliedChildren.length; idx++) {
        const child = appliedChildren[idx];
        const childPain: AuthoritativeAudiencePain = {
          ...pain,
          painId: child.claimId,
          canonical: child.claim,
          originalStatement: child.claim,
          normalizedStatement: normalizeStatement(child.claim),
          evidenceUids: child.evidenceIds,
          citationCount: child.evidenceIds.length,
          uniqueEvidenceCount: child.evidenceIds.length,
          occurrenceCount: Math.max(1, child.evidenceIds.length),
        };
        localWorking.push(childPain);
      }
      return { localWorking, localRejections };
    }

    if (atomicityResult.verdict === "COMPOUND_PAIN" && atomicityResult.action === "REPLACE" && atomicityResult.repairedClaim) {
      console.log(`[PainAtomicity] FINAL_PAIN_REPAIRED | parentId=${pain.painId} | original="${pain.canonical}" -> repaired="${atomicityResult.repairedClaim}"`);
      localWorking.push({
        ...pain,
        canonical: atomicityResult.repairedClaim,
        originalStatement: atomicityResult.repairedClaim,
        normalizedStatement: normalizeStatement(atomicityResult.repairedClaim),
      });
      return { localWorking, localRejections };
    }

    // Default: ATOMIC + KEEP
    if (atomicityResult.verdict === "ATOMIC" && atomicityResult.action === "KEEP") {
      localWorking.push(pain);
      return { localWorking, localRejections };
    }

    // Any other case fails closed
    localRejections.push(`ATOMICITY_INCOMPLETE:${pain.painId} - Unhandled atomicity state verdict=${atomicityResult.verdict} action=${atomicityResult.action}`);
    localWorking.push({
      ...pain,
      classification: "UNKNOWN" as AudiencePainClass,
      productFit: "UNKNOWN" as const,
      fitType: "UNKNOWN" as ProductFitType,
      eligible: false,
      allowedUses: [],
      prohibitedUses: prohibitedUsesForClass("UNKNOWN"),
      classifierVersion: LLM_CLASSIFIER_VERSION,
      classificationReason: `ATOMICITY_INCOMPLETE: Inconsistent atomicity result verdict=${atomicityResult.verdict} action=${atomicityResult.action}`,
    });
    return { localWorking, localRejections };
  });

  const finalWorking = perPainResults.flatMap(r => r.localWorking);
  const atomicityRejections = perPainResults.flatMap(r => r.localRejections);

  // Re-index sequential ranks
  finalWorking.forEach((p, idx) => {
    p.rank = idx + 1;
  });

  return { registry: finalWorking, atomicityRejections };
}
