/**
 * Authoritative Audience Pain classifier — LLM proposer + deterministic judge.
 *
 * Architecture contract (Task 163 validation):
 * - The LLM MAY: classify a pain, explain the classification, judge product
 *   fit against the supplied Product Identity, and rank pains semantically.
 * - The LLM MAY NOT: invent pain IDs, invent evidence, rewrite a pain's
 *   wording, merge pains, change tenant/run lineage, or promote a
 *   post-purchase complaint into a purchase motivation without evidence.
 * - The deterministic judge verifies every LLM record. Invalid records are
 *   REJECTED and the pain keeps its deterministic classification
 *   (fail closed / stay uncertain — never trust unverified LLM output).
 *
 * The registry itself stays pure (audience-pain-registry.ts); this module is
 * the only place LLM classification may touch it.
 */
import { aiChat } from "../ai-client";
import {
  type AuthoritativeAudiencePain,
  type AudiencePainClass,
  allowedUsesForClass,
  prohibitedUsesForClass,
  classifyAudiencePainDetailed,
} from "./audience-pain-registry";
import { getEvidenceByUids } from "../strategic-reasoning/evidence-registry";

export const LLM_CLASSIFIER_VERSION = "llm_v1+judge_v1";

const VALID_CLASSES: AudiencePainClass[] = ["CORE_PURCHASE", "OBJECTION", "POST_PURCHASE_FRICTION", "SUPPORTING"];
const VALID_FIT = ["ELIGIBLE", "INELIGIBLE", "UNKNOWN"] as const;
const LLM_TIMEOUT_MS = 30_000;

export interface LlmPainRecord {
  painId: string;
  classification: string;
  productFit: string;
  reason: string;
  semanticRank?: number;
}

export interface PainJudgeResult {
  accepted: Map<string, { classification: AudiencePainClass; productFit: typeof VALID_FIT[number]; reason: string }>;
  /** Applied only when the LLM returned a full valid permutation over all supplied painIds. */
  semanticRanks: Map<string, number> | null;
  rejections: Array<{ painId: string; code: string }>;
}

/** Ask the LLM to classify each pain. Returns null on any transport/parse
 * failure — callers must treat null as "deterministic classification stands". */
export async function classifyPainRegistryWithLLM(
  registry: AuthoritativeAudiencePain[],
  opts: { accountId: string; productCapabilities?: string | null },
): Promise<LlmPainRecord[] | null> {
  if (registry.length === 0) return null;
  const prompt = `You are a strict marketing-pain classifier. Classify EACH pain below.

RULES (violations are rejected by a deterministic judge):
- Use ONLY the supplied painId values. Never invent, drop into free text, merge, or rewrite pains.
- classification must be one of: CORE_PURCHASE (pre-purchase unmet outcome / purchase motivation), OBJECTION (pre-purchase hesitation: price, risk, trust, proof, time), POST_PURCHASE_FRICTION (refund, cancellation, support, onboarding, access, delivery — problems occurring AFTER purchase), SUPPORTING (contextual, not a direct purchase driver).
- productFit judges whether the PRODUCT described below can genuinely solve the pain: ELIGIBLE, INELIGIBLE (product does not provide this capability), UNKNOWN (cannot tell from the given identity). If uncertain, answer UNKNOWN — do not guess ELIGIBLE.
- reason: one concise sentence citing the pain wording itself. Do not reference evidence you were not given.
- semanticRank: rank ALL pains from 1 (most strategically dominant purchase driver) to N. Every rank exactly once.

PRODUCT IDENTITY (authoritative capability boundary):
${opts.productCapabilities || "UNKNOWN — if product capability is required to judge a pain, use productFit=UNKNOWN"}

PAINS:
${registry.map((p) => `- painId=${p.painId} rank=${p.rank} text="${p.canonical}"`).join("\n")}

Respond ONLY with JSON: {"records":[{"painId":"...","classification":"...","productFit":"...","reason":"...","semanticRank":1}]}`;

  try {
    const response = await Promise.race([
      aiChat({
        model: "gpt-4.1-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        max_tokens: 2000,
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

/** Deterministic judge. Every check here is code, not model output. */
export function judgePainClassifierOutput(
  registry: AuthoritativeAudiencePain[],
  records: LlmPainRecord[] | null,
): PainJudgeResult {
  const accepted = new Map<string, { classification: AudiencePainClass; productFit: typeof VALID_FIT[number]; reason: string }>();
  const rejections: Array<{ painId: string; code: string }> = [];
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
      // Invented pain ID — the cardinal violation. Reject the record.
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
    if (!VALID_FIT.includes(record.productFit as any)) {
      rejections.push({ painId, code: "LLM_PRODUCT_FIT_INVALID" });
      continue;
    }
    if (typeof record.reason !== "string" || record.reason.trim().length < 10) {
      rejections.push({ painId, code: "LLM_REASON_MISSING" });
      continue;
    }
    // Promotion guard: a pain whose own wording deterministically carries
    // post-purchase markers may not be promoted to a purchase motivation —
    // the LLM has no evidence beyond the wording we gave it.
    const deterministic = classifyAudiencePainDetailed(source.canonical).classification;
    if (deterministic === "POST_PURCHASE_FRICTION" && record.classification === "CORE_PURCHASE") {
      rejections.push({ painId, code: "LLM_POST_PURCHASE_PROMOTION_FORBIDDEN" });
      continue;
    }
    accepted.set(painId, {
      classification: record.classification as AudiencePainClass,
      productFit: record.productFit as typeof VALID_FIT[number],
      reason: record.reason.trim(),
    });
    if (Number.isFinite(record.semanticRank)) rankCandidates.set(painId, record.semanticRank as number);
  }

  // Semantic ranking is applied ONLY as a full valid permutation over every
  // registry pain (no partial reorders that silently bury unranked pains).
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
 * inside THIS account+campaign's evidence registry. A pain citing evidence
 * that does not resolve within the tenant scope is marked ineligible —
 * another customer's evidence can never validate this tenant's pain. */
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
    // Fail closed: if ownership cannot be verified, do not silently accept.
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

/** One-call pipeline entry: deterministic build already done by the caller;
 * this refines it with LLM classification (judged) and evidence ownership. */
export async function refineAudiencePainRegistry(
  registry: AuthoritativeAudiencePain[],
  opts: { accountId: string; campaignId: string; productCapabilities?: string | null; llmEnabled?: boolean },
): Promise<{ registry: AuthoritativeAudiencePain[]; classifierUsed: string; judgeRejections: string[]; evidenceIssues: string[] }> {
  let working = registry;
  let classifierUsed = "deterministic_v1";
  let judgeRejections: string[] = [];
  if (opts.llmEnabled !== false && registry.length > 0) {
    const llmRecords = await classifyPainRegistryWithLLM(registry, {
      accountId: opts.accountId,
      productCapabilities: opts.productCapabilities ?? null,
    });
    const judged = judgePainClassifierOutput(registry, llmRecords);
    judgeRejections = judged.rejections.map((r) => `${r.code}:${r.painId}`);
    if (judged.accepted.size > 0) {
      working = applyJudgedPainClassification(registry, judged);
      classifierUsed = LLM_CLASSIFIER_VERSION;
    }
  }
  const ownership = await validatePainEvidenceOwnership(working, opts.accountId, opts.campaignId);
  return { registry: ownership.registry, classifierUsed, judgeRejections, evidenceIssues: ownership.issues };
}
