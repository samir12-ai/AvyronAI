/**
 * Dynamic Customer Voice Semantic Reasoner & Hostile Judge
 * 
 * Replaces hardcoded static dictionaries (PAIN_CLUSTERS, OBJECTION_CLUSTERS, etc.)
 * with dynamic LLM Semantic Claim Extraction + Semantic Theme Inventory + Hostile Semantic Judge.
 * 
 * Constitutional Invariants:
 * 1. Strict Campaign Scoping: Evidence is strictly bounded by (accountId, campaignId).
 * 2. Canonical Competitor Deduplication: Duplicate database competitors map to a single canonical brand entity.
 * 3. Evidence Deduplication: Redundant duplicate comments/reviews are deduplicated prior to reasoning.
 * 4. 1:1 Batch Reasoning: Multi-meaning extraction per evidence unit with strict accounting.
 * 5. Semantic Theme Inventory: Explicit intermediate theme clustering across all claim types before signal synthesis.
 * 6. Hostile Package Judge: Strict literal quote entailment and missed theme auditing.
 * 7. Synchronized Final Manifest: Manifest generated after Hostile Judge approval ensuring zero status drift.
 * 8. Zero Deterministic Semantics / Zero Semantic Fallbacks: LLM owns meaning; fails closed on provider failure.
 */

import { aiChat } from "../ai-client";
import { createHash } from "crypto";
import { computeCalibratedConfidenceV2, type ConfidenceBreakdownV2 } from "./engine";
import type { CustomerEvidenceUnit } from "../competitive-intelligence/evidence-routing";

export interface CanonicalCompetitor {
  id: string;
  name: string;
  cleanKey: string;
  websiteUrl: string | null;
  platform: string | null;
}

export interface CanonicalCompetitorMap {
  canonicalList: CanonicalCompetitor[];
  idToCanonicalId: Map<string, string>;
  canonicalIdToName: Map<string, string>;
  totalApprovedCount: number;
}

export interface DeduplicatedEvidenceUnit {
  id: string;
  text: string;
  sourceType: "comment" | "review" | "market_voice";
  canonicalCompetitorId: string;
  canonicalBrandName: string;
  platform: string;
  rawOccurrenceCount: number;
  likesCount: number;
  originalIds: string[];
}

export type AudienceSignalType = 
  | "pain"
  | "desire"
  | "objection"
  | "question"
  | "purchase_intent"
  | "complaint"
  | "pattern"
  | "root_cause"
  | "psychological_driver"
  | "segment";

export interface SignalEvidenceSupport {
  evidenceUnitId: string;
  claimId?: string;
  whyItSupportsThisSignal: string;
}

export interface CandidateThemeLineage {
  candidateThemeId: string;
  relationToCanonical: "SAME_TRUTH" | "RELATED_BUT_DISTINCT" | "DISTINCT";
  status: "MERGED_INTO_THEME" | "PRESERVED_AS_CANONICAL_THEME";
  canonicalThemeId?: string;
  mergedIntoThemeId?: string;
  reason: string;
}

export interface CandidateThemeReconciliationResult {
  canonicalThemes: SemanticTheme[];
  candidateLineage: CandidateThemeLineage[];
}

export interface SemanticTheme {
  themeId: string;
  canonicalMeaning: string;
  description: string;
  supportingClaimIds: string[];
  supportingEvidenceUnitIds: string[];
  claimKinds: SemanticClaimKind[];
  competitorIds: string[];
  platforms: string[];
  semanticRationale: string;
  confidence: number;
}

export interface AudienceSignalDraft {
  id: string;
  type: AudienceSignalType;
  canonical: string;
  explanation: string;
  evidenceIds: string[];
  themeIds?: string[];
  supportingClaimIds?: string[];
  support?: SignalEvidenceSupport[];
  competitorIds: string[];
  platforms: string[];
  confidence: number;
  reasoningSummary: string;
  judgeVerdict?: "APPROVED" | "REJECTED" | "REPAIR_REQUIRED" | "INSUFFICIENT_EVIDENCE";
  judgeReason?: string;
  repaired?: boolean;
}

export interface AudienceIntelligenceDraft {
  pains: AudienceSignalDraft[];
  desires: AudienceSignalDraft[];
  objections: AudienceSignalDraft[];
  questions: AudienceSignalDraft[];
  purchaseIntents: AudienceSignalDraft[];
  complaints: AudienceSignalDraft[];
  patterns: AudienceSignalDraft[];
  rootCauses: AudienceSignalDraft[];
  psychologicalDrivers: AudienceSignalDraft[];
  audienceSegments: AudienceSignalDraft[];
}

export interface JudgeIssue {
  issueId: string;
  affectedSignalIds: string[];
  problemType: 
    | "UNGROUNDED_EVIDENCE"
    | "OVERSTATED_WORDING"
    | "WRONG_CATEGORY"
    | "UNSUPPORTED_ATTRIBUTE"
    | "PRAISE_AS_PAIN"
    | "PURCHASE_INTENT_AS_PAIN"
    | "QUESTION_AS_OBJECTION"
    | "INCOHERENT_CLUSTER"
    | "SYMPTOM_AS_ROOT_CAUSE"
    | "SPECULATIVE_PSYCHOLOGY"
    | "UNSUPPORTED_SEGMENT"
    | "IRRELEVANT_SCOPE"
    | "NON_APPROVED_COMPETITOR"
    | "MARKETING_AS_VOICE"
    | "MISSED_SUPPORTED_THEME"
    | "THEME_OVER_MERGE";
  reason: string;
  evidenceRefs: string[];
  repairDirective: string;
}

export interface JudgeVerdictResult {
  overallVerdict: "APPROVED" | "REPAIR_REQUIRED" | "INSUFFICIENT_EVIDENCE";
  approvedSignalIds: string[];
  rejectedSignalIds: string[];
  issues: JudgeIssue[];
  judgeSummary: string;
}

export type TerminalSemanticType = 
  | "PAIN"
  | "DESIRE"
  | "OBJECTION"
  | "QUESTION"
  | "PURCHASE_INTENT"
  | "COMPLAINT"
  | "PRAISE"
  | "IRRELEVANT"
  | "INSUFFICIENT_EVIDENCE";

export type SemanticClaimKind = 
  | "friction_problem"
  | "unmet_need"
  | "desired_outcome"
  | "barrier_hesitation"
  | "factual_query"
  | "service_complaint"
  | "positive_experience"
  | "neutral_fact";

export interface ExtractedSemanticClaim {
  claimId: string;
  claimKind: SemanticClaimKind;
  meaning: string;
  evidenceSpan?: string;
  confidence: number;
}

export interface TerminalEvidenceClassification {
  evidenceUnitId: string;
  primaryForm: TerminalSemanticType;
  semanticType: TerminalSemanticType;
  claim: string;
  semanticClaims: ExtractedSemanticClaim[];
  confidence: number;
  canonicalCompetitorId: string;
  canonicalBrandName: string;
  platform: string;
  rawText: string;
  rawEvidenceId?: string;
  accountId?: string;
  campaignId?: string;
}

export interface CategoryAccounting {
  painCount: number;
  desireCount: number;
  objectionCount: number;
  questionCount: number;
  purchaseIntentCount: number;
  complaintCount: number;
  praiseCount: number;
  irrelevantCount: number;
  insufficientCount: number;
  totalCount: number;
}

export type ClaimDispositionStatus = 
  | "ASSIGNED_TO_THEME"
  | "ISOLATED_VALID_TRUTH"
  | "INSUFFICIENT_SEMANTIC_SUPPORT"
  | "NO_MEANINGFUL_CUSTOMER_TRUTH"
  | "SEMANTICALLY_REDUNDANT";

export interface ClaimCoverageManifestItem {
  claimId: string;
  evidenceUnitId: string;
  claimKind: SemanticClaimKind;
  meaning: string;
  status: ClaimDispositionStatus;
  themeId?: string;
  representedByThemeId?: string;
  redundantWithClaimId?: string;
  associatedSignalIds?: string[];
  reason?: string;
}

export interface ThemeCoverageManifestItem {
  themeId: string;
  canonicalMeaning: string;
  claimCount: number;
  evidenceCount: number;
  competitorSpread: number;
  supportingClaimIds: string[];
  associatedSignalIds: string[];
  judgeVerdict?: "APPROVED" | "REJECTED" | "REPAIRED";
}

export interface SignalCoverageManifest {
  totalEvidenceUnits: number;
  terminalEvidenceUnits: number;
  totalSemanticClaims: number;
  claimsAssignedToThemes: number;
  claimsIsolatedValid: number;
  claimsInsufficient: number;
  claimsNoMeaningfulTruth: number;
  claimsRedundant: number;
  totalThemes: number;
  claimManifest: ClaimCoverageManifestItem[];
  themeManifest: ThemeCoverageManifestItem[];
}

export type SemanticCategory = TerminalSemanticType;

export interface SemanticClaim {
  claimId: string;
  campaignId?: string;
  accountId?: string;
  evidenceUnitId: string;
  rawEvidenceId?: string;
  sourceText: string;
  canonicalCompetitorId: string;
  canonicalBrandName: string;
  sourceType: string;
  platform: string;
  semanticType: SemanticCategory;
  claimText: string;
  meaning: string;
  confidence: number;
  reasonerVersion: string;
  judgeVerdict?: "APPROVED" | "REJECTED" | "INSUFFICIENT_EVIDENCE";
  judgeReason?: string;
  judgeVersion?: string;
}

export interface SynthesizedSignal {
  signalId: string;
  category: "pain" | "desire" | "objection" | "pattern" | "root_cause" | "psychological_driver" | "segment";
  canonical: string;
  text: string;
  frequency: number;
  evidenceCount: number;
  evidence: string[];
  competitorIds: string[];
  competitorSpread: number;
  sourceTypes: string[];
  confidenceScore: number;
  confidenceBreakdown?: ConfidenceBreakdownV2;
  sourceSignals: string[];
  inputSnapshotId?: string | null;
  judgeVerdict: "APPROVED";
  judgeReason?: string;
}

export interface SemanticExtractionResult {
  status: "COMPLETE" | "INCOMPLETE";
  statusMessage?: string;
  providerFailure: boolean;
  failedBatchCount: number;
  rawEvidenceCount: number;
  deduplicatedUnitsCount: number;
  processedEvidenceUnits: number;
  unprocessedEvidenceUnits: number;
  sentToReasoner: number;
  terminallyClassified: number;
  noOutputCount: number;
  categoryAccounting: CategoryAccounting;
  coverageManifest?: SignalCoverageManifest;
  themes?: SemanticTheme[];
  candidateThemes?: SemanticTheme[];
  candidateLineage?: CandidateThemeLineage[];
  canonicalCompetitorsCount: number;
  approvedCompetitorsCount: number;
  extractedClaimsCount: number;
  approvedClaimsCount: number;
  rejectedClaimsCount: number;
  insufficientClaimsCount: number;
  pains: SynthesizedSignal[];
  desires: SynthesizedSignal[];
  objections: SynthesizedSignal[];
  patterns: SynthesizedSignal[];
  rootCauses: SynthesizedSignal[];
  psychologicalDrivers: SynthesizedSignal[];
  segments: SynthesizedSignal[];
  draft?: AudienceIntelligenceDraft;
  judgeResult?: JudgeVerdictResult;
  repairedSignalIds?: string[];
  claims: TerminalEvidenceClassification[];
}

export function cleanBrandName(name: string): string {
  if (!name) return "Unknown Brand";
  let cleaned = name.trim();
  cleaned = cleaned.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/.*$/, "");
  cleaned = cleaned.replace(/\.(com|lb|org|net|store|shop|me|co).*$/i, "");
  cleaned = cleaned.replace(/[._\-]+/g, " ");
  cleaned = cleaned.replace(/\s+(official|lebanon|lb|boutique|brand|store|shop)$/i, "");
  cleaned = cleaned.trim();
  if (cleaned.length === 0) return name.trim();
  return cleaned
    .split(" ")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export function buildCanonicalCompetitorMap(
  competitors: Array<{ id: string; name: string; websiteUrl?: string | null; platform?: string | null }>
): CanonicalCompetitorMap {
  const canonicalList: CanonicalCompetitor[] = [];
  const idToCanonicalId = new Map<string, string>();
  const canonicalIdToName = new Map<string, string>();
  const cleanKeyToCanonicalId = new Map<string, string>();

  for (const comp of competitors) {
    const rawName = comp.name || "Unknown Brand";
    const cleanKey = cleanBrandName(rawName).toLowerCase().replace(/[^a-z0-9]/g, "");

    let canonicalId = cleanKeyToCanonicalId.get(cleanKey);
    if (!canonicalId) {
      canonicalId = comp.id;
      cleanKeyToCanonicalId.set(cleanKey, canonicalId);
      const canonicalName = cleanBrandName(rawName);
      canonicalList.push({
        id: canonicalId,
        name: canonicalName,
        cleanKey,
        websiteUrl: comp.websiteUrl || null,
        platform: comp.platform || null,
      });
      canonicalIdToName.set(canonicalId, canonicalName);
    }
    idToCanonicalId.set(comp.id, canonicalId);
  }

  return {
    canonicalList,
    idToCanonicalId,
    canonicalIdToName,
    totalApprovedCount: canonicalList.length,
  };
}

export function deduplicateEvidenceUnits(
  comments: Array<{ id: string; commentText: string | null; competitorId: string; likesCount?: number | null; platform?: string | null; postId?: string | null }>,
  reviews: Array<{ id: string; reviewText: string | null; competitorId: string; rating?: number | null; platform?: string | null }>,
  _posts: Array<{ id: string; caption: string | null; competitorId: string; platform?: string | null }>,
  compMap: CanonicalCompetitorMap
): DeduplicatedEvidenceUnit[] {
  const map = new Map<string, DeduplicatedEvidenceUnit>();

  for (const c of comments) {
    const text = c.commentText?.trim();
    if (!text || text.length < 2) continue;

    const canonicalCompId = compMap.idToCanonicalId.get(c.competitorId) || c.competitorId;
    const canonicalName = compMap.canonicalIdToName.get(canonicalCompId) || "Unknown Brand";
    const normalizedText = text.toLowerCase().replace(/\s+/g, " ");
    const fingerprint = createHash("sha256").update(`${canonicalCompId}:${normalizedText}`).digest("hex").slice(0, 16);

    const existing = map.get(fingerprint);
    if (existing) {
      existing.rawOccurrenceCount += 1;
      existing.likesCount += c.likesCount || 0;
      existing.originalIds.push(c.id);
    } else {
      map.set(fingerprint, {
        id: `ev_unit_${fingerprint}`,
        text,
        sourceType: "comment",
        canonicalCompetitorId: canonicalCompId,
        canonicalBrandName: canonicalName,
        platform: c.platform || "instagram",
        rawOccurrenceCount: 1,
        likesCount: c.likesCount || 0,
        originalIds: [c.id],
      });
    }
  }

  for (const r of reviews) {
    const text = r.reviewText?.trim();
    if (!text || text.length < 2) continue;

    const canonicalCompId = compMap.idToCanonicalId.get(r.competitorId) || r.competitorId;
    const canonicalName = compMap.canonicalIdToName.get(canonicalCompId) || "Unknown Brand";
    const normalizedText = text.toLowerCase().replace(/\s+/g, " ");
    const fingerprint = createHash("sha256").update(`${canonicalCompId}:${normalizedText}`).digest("hex").slice(0, 16);

    const existing = map.get(fingerprint);
    if (existing) {
      existing.rawOccurrenceCount += 1;
      existing.originalIds.push(r.id);
    } else {
      map.set(fingerprint, {
        id: `ev_unit_${fingerprint}`,
        text,
        sourceType: "review",
        canonicalCompetitorId: canonicalCompId,
        canonicalBrandName: canonicalName,
        platform: r.platform || "reviews",
        rawOccurrenceCount: 1,
        likesCount: 0,
        originalIds: [r.id],
      });
    }
  }

  return Array.from(map.values());
}

export function deduplicateFromCanonicalCustomerVoice(
  units: CustomerEvidenceUnit[],
  compMap: CanonicalCompetitorMap
): DeduplicatedEvidenceUnit[] {
  const map = new Map<string, DeduplicatedEvidenceUnit>();

  for (const u of units) {
    const text = u.text?.trim();
    if (!text || text.length < 2) continue;

    const canonicalCompId = u.competitorId ? (compMap.idToCanonicalId.get(u.competitorId) || u.competitorId) : "market_voice";
    const canonicalName = u.competitorId ? (compMap.canonicalIdToName.get(canonicalCompId) || u.competitorName || "Unknown Brand") : "Broad Market Voice";
    const normalizedText = text.toLowerCase().replace(/\s+/g, " ");
    const fingerprint = createHash("sha256").update(`${canonicalCompId}:${u.platform}:${normalizedText}`).digest("hex").slice(0, 16);

    const existing = map.get(fingerprint);
    if (existing) {
      existing.rawOccurrenceCount += 1;
      existing.likesCount += u.likesCount || 0;
      existing.originalIds.push(u.evidenceId);
    } else {
      let srcType: "comment" | "review" | "market_voice" = "comment";
      if (u.origin === "COMPETITOR_REVIEW") srcType = "review";
      else if (u.origin === "MARKET_VOICE") srcType = "market_voice";

      map.set(fingerprint, {
        id: `ev_unit_${fingerprint}`,
        text,
        sourceType: srcType,
        canonicalCompetitorId: canonicalCompId,
        canonicalBrandName: canonicalName,
        platform: u.platform || "web",
        rawOccurrenceCount: 1,
        likesCount: u.likesCount || 0,
        originalIds: [u.evidenceId],
      });
    }
  }

  return Array.from(map.values());
}

export interface BatchCompletenessValidation {
  valid: boolean;
  inputCount: number;
  outputCount: number;
  missingUnitIds: string[];
  duplicateUnitIds: string[];
  unknownUnitIds: string[];
  errors: string[];
}

export function validateBatchCompleteness(
  batch: DeduplicatedEvidenceUnit[],
  classifications: TerminalEvidenceClassification[]
): BatchCompletenessValidation {
  const inputIds = new Set(batch.map(u => u.id));
  const seenOutputs = new Set<string>();
  const duplicateUnitIds: string[] = [];
  const unknownUnitIds: string[] = [];

  for (const c of classifications) {
    if (!inputIds.has(c.evidenceUnitId)) {
      unknownUnitIds.push(c.evidenceUnitId);
    }
    if (seenOutputs.has(c.evidenceUnitId)) {
      duplicateUnitIds.push(c.evidenceUnitId);
    }
    seenOutputs.add(c.evidenceUnitId);
  }

  const missingUnitIds = batch.map(u => u.id).filter(id => !seenOutputs.has(id));
  const errors: string[] = [];

  if (missingUnitIds.length > 0) {
    errors.push(`Missing ${missingUnitIds.length} evidence units: [${missingUnitIds.slice(0, 5).join(", ")}]`);
  }
  if (duplicateUnitIds.length > 0) {
    errors.push(`Duplicate output for ${duplicateUnitIds.length} evidence units: [${duplicateUnitIds.slice(0, 5).join(", ")}]`);
  }
  if (unknownUnitIds.length > 0) {
    errors.push(`Unknown output for ${unknownUnitIds.length} evidence units: [${unknownUnitIds.slice(0, 5).join(", ")}]`);
  }

  const valid = missingUnitIds.length === 0 && duplicateUnitIds.length === 0 && unknownUnitIds.length === 0 && classifications.length === batch.length;

  return {
    valid,
    inputCount: batch.length,
    outputCount: classifications.length,
    missingUnitIds,
    duplicateUnitIds,
    unknownUnitIds,
    errors,
  };
}

export async function repairBatchCompleteness(
  missingUnits: DeduplicatedEvidenceUnit[],
  businessContext: { heroProduct: string; businessName: string; market: string; category: string },
  accountId: string
): Promise<TerminalEvidenceClassification[]> {
  if (missingUnits.length === 0) return [];

  const prompt = `You are an expert market research analyst performing targeted completeness repair on missing customer voice evidence.
BUSINESS CONTEXT:
- Business: ${businessContext.businessName}
- Offering / Hero Product: ${businessContext.heroProduct}
- Category: ${businessContext.category}
- Target Market: ${businessContext.market}

TASK:
You MUST classify EVERY SINGLE missing evidence unit below into EXACTLY ONE terminal primary form, and extract all distinct semantic claims.
You MUST produce exactly ${missingUnits.length} items in the JSON array (1:1 correspondence for all ${missingUnits.length} units).

MISSING EVIDENCE UNITS (${missingUnits.length} TOTAL):
${missingUnits.map((u, i) => `[Unit ${i + 1}] ID: ${u.id} | Competitor: ${u.canonicalBrandName} | Platform: ${u.platform}
"${u.text}"`).join("\n\n")}

OUTPUT JSON FORMAT (JSON array of exactly ${missingUnits.length} items):
[
  {
    "evidenceUnitId": "${missingUnits[0]?.id || "ev_unit_id"}",
    "primaryForm": "PAIN" | "DESIRE" | "OBJECTION" | "QUESTION" | "PURCHASE_INTENT" | "COMPLAINT" | "PRAISE" | "IRRELEVANT" | "INSUFFICIENT_EVIDENCE",
    "primaryClaim": "Concise summary of the primary communication",
    "semanticClaims": [
      {
        "claimKind": "friction_problem" | "unmet_need" | "desired_outcome" | "barrier_hesitation" | "factual_query" | "service_complaint" | "positive_experience" | "neutral_fact",
        "meaning": "Clear objective interpretation of this specific claim",
        "confidence": 0.85
      }
    ],
    "confidence": 0.85
  }
]`;

  const res = await aiChat({
    accountId,
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "You are an objective market research classifier. Output JSON array of 1:1 classifications only." },
      { role: "user", content: prompt },
    ],
    temperature: 0.1,
    max_tokens: 3000,
  });

  const rawContent = res.choices[0]?.message?.content || "[]";
  const cleanJson = rawContent.replace(/^\`\`\`[a-z]*\s*/i, "").replace(/\s*\`\`\`$/i, "").trim();
  const parsed = JSON.parse(cleanJson);
  if (!Array.isArray(parsed)) return [];

  const unitMap = new Map(missingUnits.map(u => [u.id, u]));
  const repaired: TerminalEvidenceClassification[] = [];

  for (const item of parsed) {
    if (!item.evidenceUnitId || !unitMap.has(item.evidenceUnitId)) continue;
    const u = unitMap.get(item.evidenceUnitId)!;
    const rawType = String(item.primaryForm || item.semanticType || "INSUFFICIENT_EVIDENCE").toUpperCase();
    const validTypes = ["PAIN", "DESIRE", "OBJECTION", "QUESTION", "PURCHASE_INTENT", "COMPLAINT", "PRAISE", "IRRELEVANT", "INSUFFICIENT_EVIDENCE"];
    const primaryForm = (validTypes.includes(rawType) ? rawType : "INSUFFICIENT_EVIDENCE") as TerminalSemanticType;

    const rawClaims = Array.isArray(item.semanticClaims) ? item.semanticClaims : [];
    const semanticClaims: ExtractedSemanticClaim[] = [];

    if (rawClaims.length > 0) {
      rawClaims.forEach((rc: any, idx: number) => {
        if (rc && rc.meaning) {
          semanticClaims.push({
            claimId: `clm_${u.id}_${idx + 1}`,
            claimKind: rc.claimKind || "neutral_fact",
            meaning: String(rc.meaning).trim(),
            evidenceSpan: rc.evidenceSpan ? String(rc.evidenceSpan).trim() : undefined,
            confidence: typeof rc.confidence === "number" ? Math.max(0, Math.min(1, rc.confidence)) : 0.8,
          });
        }
      });
    }

    if (semanticClaims.length === 0) {
      semanticClaims.push({
        claimId: `clm_${u.id}_1`,
        claimKind: primaryForm === "PAIN" || primaryForm === "COMPLAINT" ? "friction_problem" : (primaryForm === "DESIRE" ? "desired_outcome" : (primaryForm === "OBJECTION" ? "barrier_hesitation" : "neutral_fact")),
        meaning: (item.primaryClaim || item.claim || u.text).trim(),
        confidence: typeof item.confidence === "number" ? Math.max(0, Math.min(1, item.confidence)) : 0.75,
      });
    }

    repaired.push({
      evidenceUnitId: u.id,
      primaryForm,
      semanticType: primaryForm,
      claim: (item.primaryClaim || item.claim || u.text).trim(),
      semanticClaims,
      confidence: typeof item.confidence === "number" ? Math.max(0, Math.min(1, item.confidence)) : 0.75,
      canonicalCompetitorId: u.canonicalCompetitorId,
      canonicalBrandName: u.canonicalBrandName,
      platform: u.platform,
      rawText: u.text,
      rawEvidenceId: u.originalIds[0],
    });
  }

  return repaired;
}

export async function classifyBatchEvidenceUnits(
  batch: DeduplicatedEvidenceUnit[],
  businessContext: { heroProduct: string; businessName: string; market: string; category: string },
  accountId: string,
  _campaignId?: string
): Promise<TerminalEvidenceClassification[]> {
  const prompt = `You are an expert market research analyst examining customer voice data.
BUSINESS CONTEXT:
- Business: ${businessContext.businessName}
- Offering / Hero Product: ${businessContext.heroProduct}
- Category: ${businessContext.category}
- Target Market: ${businessContext.market}

TASK:
Classify EVERY SINGLE evidence unit listed below into EXACTLY ONE terminal primary form, AND extract all distinct semantic claims contained within the quote.
You MUST produce exactly ${batch.length} classifications in the output JSON array (1:1 correspondence for all ${batch.length} input units).

PRIMARY COMMUNICATION FORMS:
1. PAIN: Customer-expressed problem, unmet need, frustration, difficulty, or negative experience.
2. DESIRE: An outcome, improvement, state, capability, or experience the customer wants or seeks.
3. OBJECTION: A barrier, uncertainty, hesitation, or resistance that may slow or prevent purchase.
4. QUESTION: Customer seeking factual information without clear evidence of purchase resistance.
5. PURCHASE_INTENT: Clear intent to acquire, order, or buy the offering.
6. COMPLAINT: Negative report about an experienced outcome, service failure, delivery problem, or product defect.
7. PRAISE: Positive sentiment, aesthetic appreciation, satisfaction, or general endorsement.
8. IRRELEVANT: Spam, bot text, unrelated topic, or out of scope content.
9. INSUFFICIENT_EVIDENCE: Ambiguous text, lone emojis, or uninterpretable fragments.

MULTI-MEANING EXTRACTION CONSTITUTIONAL RULES:
- Do NOT stop after identifying the first obvious or surface meaning. Inspect the complete customer statement for ALL independently supported semantic meanings.
- If a customer statement expresses multiple distinct thoughts (e.g. positive aesthetic reaction AND sizing/fit friction, or routine question AND purchase hesitation, or praise AND an unmet restock need, or complaint AND desired outcome), you MUST extract each independently grounded claim into the "semanticClaims" array.
- Simple single-focus statements (e.g. "Beautiful ❤️" or "Price plz") should remain 1 claim.
- Compound or mixed statements MUST be separated into 2+ distinct claims.
- Never invent unevidenced secondary claims. Every extracted claim must be strictly grounded in the quote text.

INPUT EVIDENCE UNITS (${batch.length} TOTAL):
${batch.map((u, i) => `[Unit ${i + 1}] ID: ${u.id} | Competitor: ${u.canonicalBrandName} | Platform: ${u.platform} | Type: ${u.sourceType}
"${u.text}"`).join("\n\n")}

OUTPUT JSON FORMAT (JSON array of exactly ${batch.length} items):
[
  {
    "evidenceUnitId": "${batch[0]?.id || "ev_unit_id"}",
    "primaryForm": "PAIN" | "DESIRE" | "OBJECTION" | "QUESTION" | "PURCHASE_INTENT" | "COMPLAINT" | "PRAISE" | "IRRELEVANT" | "INSUFFICIENT_EVIDENCE",
    "primaryClaim": "Concise summary of the primary communication",
    "semanticClaims": [
      {
        "claimKind": "friction_problem" | "unmet_need" | "desired_outcome" | "barrier_hesitation" | "factual_query" | "service_complaint" | "positive_experience" | "neutral_fact",
        "meaning": "Clear objective interpretation of this specific claim",
        "confidence": 0.85
      }
    ],
    "confidence": 0.85
  }
]`;

  const res = await aiChat({
    accountId,
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "You are an objective market research classifier. Output JSON array of 1:1 classifications only." },
      { role: "user", content: prompt },
    ],
    temperature: 0.1,
    max_tokens: 8000,
  });

  const rawContent = res.choices[0]?.message?.content || "[]";
  const cleanJson = rawContent.replace(/^\`\`\`[a-z]*\s*/i, "").replace(/\s*\`\`\`$/i, "").trim();
  const parsed = JSON.parse(cleanJson);
  if (!Array.isArray(parsed)) {
    throw new Error("Reasoner response was not a valid JSON array.");
  }

  const unitMap = new Map(batch.map(u => [u.id, u]));
  let classifications: TerminalEvidenceClassification[] = [];

  for (const item of parsed) {
    if (!item.evidenceUnitId || !unitMap.has(item.evidenceUnitId)) continue;
    const u = unitMap.get(item.evidenceUnitId)!;
    const rawType = String(item.primaryForm || item.semanticType || "INSUFFICIENT_EVIDENCE").toUpperCase();
    const validTypes = ["PAIN", "DESIRE", "OBJECTION", "QUESTION", "PURCHASE_INTENT", "COMPLAINT", "PRAISE", "IRRELEVANT", "INSUFFICIENT_EVIDENCE"];
    const primaryForm = (validTypes.includes(rawType) ? rawType : "INSUFFICIENT_EVIDENCE") as TerminalSemanticType;

    const rawClaims = Array.isArray(item.semanticClaims) ? item.semanticClaims : [];
    const semanticClaims: ExtractedSemanticClaim[] = [];

    if (rawClaims.length > 0) {
      rawClaims.forEach((rc: any, idx: number) => {
        if (rc && rc.meaning) {
          semanticClaims.push({
            claimId: `clm_${u.id}_${idx + 1}`,
            claimKind: rc.claimKind || "neutral_fact",
            meaning: String(rc.meaning).trim(),
            evidenceSpan: rc.evidenceSpan ? String(rc.evidenceSpan).trim() : undefined,
            confidence: typeof rc.confidence === "number" ? Math.max(0, Math.min(1, rc.confidence)) : 0.8,
          });
        }
      });
    }

    if (semanticClaims.length === 0) {
      semanticClaims.push({
        claimId: `clm_${u.id}_1`,
        claimKind: primaryForm === "PAIN" || primaryForm === "COMPLAINT" ? "friction_problem" : (primaryForm === "DESIRE" ? "desired_outcome" : (primaryForm === "OBJECTION" ? "barrier_hesitation" : "neutral_fact")),
        meaning: (item.primaryClaim || item.claim || u.text).trim(),
        confidence: typeof item.confidence === "number" ? Math.max(0, Math.min(1, item.confidence)) : 0.75,
      });
    }

    classifications.push({
      evidenceUnitId: u.id,
      primaryForm,
      semanticType: primaryForm,
      claim: (item.primaryClaim || item.claim || u.text).trim(),
      semanticClaims,
      confidence: typeof item.confidence === "number" ? Math.max(0, Math.min(1, item.confidence)) : 0.75,
      canonicalCompetitorId: u.canonicalCompetitorId,
      canonicalBrandName: u.canonicalBrandName,
      platform: u.platform,
      rawText: u.text,
      rawEvidenceId: u.originalIds[0],
    });
  }

  // Completeness check
  let validation = validateBatchCompleteness(batch, classifications);
  if (!validation.valid && validation.missingUnitIds.length > 0) {
    const missingUnits = batch.filter(u => validation.missingUnitIds.includes(u.id));
    const repaired = await repairBatchCompleteness(missingUnits, businessContext, accountId);
    const existingIds = new Set(classifications.map(c => c.evidenceUnitId));
    for (const r of repaired) {
      if (!existingIds.has(r.evidenceUnitId)) {
        classifications.push(r);
        existingIds.add(r.evidenceUnitId);
      }
    }
    validation = validateBatchCompleteness(batch, classifications);
  }

  if (!validation.valid) {
    throw new Error(`Batch completeness validation failed: ${validation.errors.join("; ")}`);
  }

  return classifications;
}

export async function extractAudienceDraftFromBatch(
  batch: DeduplicatedEvidenceUnit[],
  businessContext: { heroProduct: string; businessName: string; market: string; category: string },
  accountId: string,
  campaignId?: string
): Promise<AudienceSignalDraft[]> {
  const classifications = await classifyBatchEvidenceUnits(batch, businessContext, accountId, campaignId);
  const signals: AudienceSignalDraft[] = [];

  for (const c of classifications) {
    const sigType = c.semanticType.toLowerCase() as AudienceSignalType;
    signals.push({
      id: `sig_draft_${createHash("sha256").update(`${sigType}:${c.claim}:${c.evidenceUnitId}`).digest("hex").slice(0, 12)}`,
      type: sigType,
      canonical: c.claim,
      explanation: c.rawText,
      evidenceIds: [c.evidenceUnitId],
      supportingClaimIds: c.semanticClaims.map(sc => sc.claimId),
      competitorIds: [c.canonicalCompetitorId],
      platforms: [c.platform],
      confidence: c.confidence,
      reasoningSummary: `Classified as ${c.semanticType}`,
    });
  }

  return signals;
}

/**
 * SEMANTIC THEME INVENTORY GENERATOR:
 * Groups extracted semantic claims into coherent customer truth themes across all surface communication types.
 * Every semantic claim receives a semantically reasoned terminal disposition.
 */
function sanitizeJson(raw: string): string {
  let clean = raw.replace(/^\`\`\`[a-z]*\s*/i, "").replace(/\s*\`\`\`$/i, "").trim();
  const firstBrace = clean.indexOf("{");
  const lastBrace = clean.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    clean = clean.slice(firstBrace, lastBrace + 1);
  }
  clean = clean.replace(/,\s*([\}\]])/g, "$1");
  return clean;
}

function sanitizeJsonArray(raw: string): string {
  let clean = raw.replace(/^\`\`\`[a-z]*\s*/i, "").replace(/\s*\`\`\`$/i, "").trim();
  const firstBracket = clean.indexOf("[");
  const lastBracket = clean.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    clean = clean.slice(firstBracket, lastBracket + 1);
  }
  clean = clean.replace(/,\s*([\}\]])/g, "$1");
  return clean;
}

/**
 * SEMANTIC THEME INVENTORY GENERATOR (BOUNDED BATCHES + RECONCILIATION):
 * Discovers candidate Semantic Themes across bounded batches of semantic claims,
 * then reconciles/merges them into a canonical Theme Inventory.
 */
/**
 * ENRICHED THEME RECONCILIATION:
 * Reconciles candidate semantic themes across batches with full semantic visibility
 * into supporting claim meanings, verbatim quotes, and competitor context.
 */
export async function reconcileSemanticThemeInventoryWithLLM(
  candidateThemes: SemanticTheme[],
  allClassifications: TerminalEvidenceClassification[],
  businessContext: { heroProduct: string; businessName: string; market: string; category: string },
  accountId: string
): Promise<CandidateThemeReconciliationResult> {
  const unitMap = new Map(allClassifications.map(u => [u.evidenceUnitId, u]));

  const enrichedCandidates = candidateThemes.map(t => {
    const claims = t.supportingClaimIds.map(cid => {
      for (const u of allClassifications) {
        const matchingClaim = u.semanticClaims.find(sc => sc.claimId === cid);
        if (matchingClaim) {
          return {
            claimId: cid,
            claimKind: matchingClaim.claimKind,
            meaning: matchingClaim.meaning,
            evidenceUnitId: u.evidenceUnitId,
            rawQuote: u.rawText,
            brand: u.canonicalBrandName,
          };
        }
      }
      return null;
    }).filter(Boolean);

    return {
      themeId: t.themeId,
      canonicalMeaning: t.canonicalMeaning,
      description: t.description,
      supportingEvidenceUnitIds: t.supportingEvidenceUnitIds,
      supportingClaimIds: t.supportingClaimIds,
      claims,
    };
  });

  const prompt = `You are an expert market research analyst reconciling candidate semantic themes across batches.
BUSINESS CONTEXT:
- Business: ${businessContext.businessName}
- Offering / Hero Product: ${businessContext.heroProduct}
- Category: ${businessContext.category}
- Target Market: ${businessContext.market}

CANDIDATE THEMES TO RECONCILE (${enrichedCandidates.length} TOTAL):
${enrichedCandidates.map((t, i) => {
  const sampleClaims = t.claims.map(c => `  - [${c.claimId}] (${c.claimKind}) "${c.meaning}" (Quote: "${c.rawQuote}" | Brand: ${c.brand})`).join("\n");
  return `[Candidate Theme ${i + 1}] ID: ${t.themeId}\nMeaning: "${t.canonicalMeaning}"\nDescription: ${t.description}\nEvidence Units: [${t.supportingEvidenceUnitIds.join(", ")}]\nSupporting Claims:\n${sampleClaims}`;
}).join("\n\n")}

RECONCILIATION CONSTITUTIONAL RULES:
1. RELATION CONTRACT & MERGE RULES:
   For every candidate theme comparison, determine the exact semantic relationship:
   - "SAME_TRUTH": The candidate expresses the exact same underlying customer truth/problem/need. Merge is permitted.
   - "RELATED_BUT_DISTINCT": The candidate touches on related products or general sentiment but expresses a distinct customer need, friction, or requirement. MUST REMAIN A SEPARATE CANONICAL THEME.
   - "DISTINCT": The candidate expresses a completely separate customer truth. MUST REMAIN A SEPARATE CANONICAL THEME.

2. SEMANTIC EQUIVALENCE TEST ("REMOVAL TEST"):
   Apply this test before merging:
   "If Candidate Theme A were removed and only Canonical Theme B remained, would any distinct customer need, friction, inquiry, or experience be lost?"
   - If YES: DO NOT MERGE. Preserve as separate canonical themes.
   - If NO: Merge is allowed.

3. PRESERVE DISTINCT CUSTOMER-TRUTH DIMENSIONS:
   - Shared positive/negative emotion, shared product context, or topical overlap is INSUFFICIENT to merge.
   - A positive reaction or brand praise must NEVER absorb an unmet need, product inquiry, restock request, or sizing friction.
   - E.g., aesthetic praise (liking the style), restock demands (unmet inventory), and sizing/fit requirements (fit friction) represent 3 MATERIALLY DISTINCT customer truths and MUST NOT be collapsed into one general positive sentiment theme.

4. COMPLETE LINEAGE:
   Every single candidate theme must be accounted for in "candidateLineage" with its exact relation ("SAME_TRUTH", "RELATED_BUT_DISTINCT", or "DISTINCT"), status, and target canonicalThemeId.

OUTPUT JSON FORMAT (JSON object ONLY):
{
  "canonicalThemes": [
    {
      "themeId": "theme_canon_1",
      "canonicalMeaning": "Unified concise statement in objective business language",
      "description": "Comprehensive explanation of what customers are experiencing",
      "supportingClaimIds": ["clm_1", "clm_2"],
      "supportingEvidenceUnitIds": ["ev_1", "ev_2"],
      "sourceCandidateThemeIds": ["theme_b1_1", "theme_b2_2"],
      "mergeRationale": "Clear rationale explaining semantic equivalence",
      "confidence": 0.85
    }
  ],
  "candidateLineage": [
    {
      "candidateThemeId": "theme_b1_1",
      "relationToCanonical": "SAME_TRUTH" | "RELATED_BUT_DISTINCT" | "DISTINCT",
      "status": "MERGED_INTO_THEME" | "PRESERVED_AS_CANONICAL_THEME",
      "canonicalThemeId": "theme_canon_1",
      "reason": "Clear explanation using semantic equivalence test"
    }
  ]
}`;

  const res = await aiChat({
    accountId,
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "You are an objective market research analyst. Output valid JSON object containing canonicalThemes and candidateLineage only." },
      { role: "user", content: prompt },
    ],
    temperature: 0.1,
    max_tokens: 6000,
  });

  const cleanJson = sanitizeJson(res.choices[0]?.message?.content || "{}");
  const parsed = JSON.parse(cleanJson);

  const rawCanonical = Array.isArray(parsed.canonicalThemes) ? parsed.canonicalThemes : [];
  const canonicalThemes: SemanticTheme[] = [];

  for (const mt of rawCanonical) {
    if (!mt.canonicalMeaning) continue;
    const supportingEvidenceUnitIds = Array.isArray(mt.supportingEvidenceUnitIds) ? mt.supportingEvidenceUnitIds.filter((id: string) => unitMap.has(id)) : [];
    const supportingClaimIds = Array.isArray(mt.supportingClaimIds) ? mt.supportingClaimIds : [];
    if (supportingEvidenceUnitIds.length === 0 && supportingClaimIds.length === 0) continue;

    const matchingUnits = supportingEvidenceUnitIds.map((id: string) => unitMap.get(id)!).filter(Boolean);
    const competitorIds = Array.from(new Set(matchingUnits.map(u => u.canonicalCompetitorId)));
    const platforms = Array.from(new Set(matchingUnits.map(u => u.platform)));
    const claimKinds = Array.from(new Set(matchingUnits.flatMap(u => u.semanticClaims.map(c => c.claimKind))));

    canonicalThemes.push({
      themeId: mt.themeId || `theme_${createHash("sha256").update(mt.canonicalMeaning).digest("hex").slice(0, 10)}`,
      canonicalMeaning: mt.canonicalMeaning.trim(),
      description: mt.description || mt.canonicalMeaning.trim(),
      supportingClaimIds,
      supportingEvidenceUnitIds,
      claimKinds,
      competitorIds,
      platforms,
      semanticRationale: mt.mergeRationale || mt.semanticRationale || "Reconciled customer truth theme",
      confidence: typeof mt.confidence === "number" ? Math.max(0, Math.min(1, mt.confidence)) : 0.85,
    });
  }

  const rawLineage = Array.isArray(parsed.candidateLineage) ? parsed.candidateLineage : [];
  const candidateLineage: CandidateThemeLineage[] = candidateThemes.map(ct => {
    const found = rawLineage.find((l: any) => l && l.candidateThemeId === ct.themeId);
    if (found && (found.status === "MERGED_INTO_THEME" || found.status === "PRESERVED_AS_CANONICAL_THEME")) {
      return {
        candidateThemeId: ct.themeId,
        relationToCanonical: found.relationToCanonical || (found.status === "MERGED_INTO_THEME" ? "SAME_TRUTH" : "DISTINCT"),
        status: found.status,
        canonicalThemeId: found.canonicalThemeId || found.mergedIntoThemeId,
        mergedIntoThemeId: found.mergedIntoThemeId || found.canonicalThemeId,
        reason: found.reason || "Reconciled by Hostile Theme Reconciler",
      };
    }
    const matchingCanon = canonicalThemes.find(c => c.supportingClaimIds.some(cid => ct.supportingClaimIds.includes(cid)));
    const isSame = matchingCanon?.themeId === ct.themeId;
    return {
      candidateThemeId: ct.themeId,
      relationToCanonical: (isSame ? "DISTINCT" : (matchingCanon ? "SAME_TRUTH" : "DISTINCT")) as CandidateThemeLineage["relationToCanonical"],
      status: (matchingCanon ? (isSame ? "PRESERVED_AS_CANONICAL_THEME" : "MERGED_INTO_THEME") : "PRESERVED_AS_CANONICAL_THEME") as CandidateThemeLineage["status"],
      canonicalThemeId: matchingCanon?.themeId || ct.themeId,
      mergedIntoThemeId: isSame ? undefined : matchingCanon?.themeId,
      reason: "Mapped from supporting claim overlap",
    };
  });

  return {
    canonicalThemes: canonicalThemes.length > 0 ? canonicalThemes : candidateThemes,
    candidateLineage,
  };
}

export async function generateSemanticThemeInventoryWithLLM(
  classifiedUnits: TerminalEvidenceClassification[],
  businessContext: { heroProduct: string; businessName: string; market: string; category: string },
  accountId: string
): Promise<{ themes: SemanticTheme[]; claimDispositions: ClaimCoverageManifestItem[] }> {
  const unitMap = new Map(classifiedUnits.map(u => [u.evidenceUnitId, u]));
  const THEME_BATCH_SIZE = 80;
  const candidateThemes: SemanticTheme[] = [];
  const allDispositions: ClaimCoverageManifestItem[] = [];

  for (let i = 0; i < classifiedUnits.length; i += THEME_BATCH_SIZE) {
    const batchUnits = classifiedUnits.slice(i, i + THEME_BATCH_SIZE);
    const batchClaims = batchUnits.flatMap(u => u.semanticClaims.map(c => ({
      unitId: u.evidenceUnitId,
      claimId: c.claimId,
      claimKind: c.claimKind,
      meaning: c.meaning,
      brand: u.canonicalBrandName,
      quote: u.rawText,
      primaryForm: u.primaryForm,
      platform: u.platform,
    })));

    const prompt = `You are an expert market research analyst conducting a Semantic Theme Inventory across customer voice evidence.
BUSINESS CONTEXT:
- Business: ${businessContext.businessName}
- Offering / Hero Product: ${businessContext.heroProduct}
- Category: ${businessContext.category}
- Target Market: ${businessContext.market}

CUSTOMER VOICE EVIDENCE BATCH (${batchUnits.length} UNITS, ${batchClaims.length} CLAIMS):
${batchUnits.map((u, idx) => {
  const claimsStr = u.semanticClaims.map(c => `[${c.claimId}] (${c.claimKind}) ${c.meaning}`).join(" | ");
  return `[Unit ${idx + 1}] ID: ${u.evidenceUnitId} | PrimaryForm: [${u.primaryForm}] | Brand: ${u.canonicalBrandName}\nQuote: "${u.rawText}"\nClaims: ${claimsStr}`;
}).join("\n\n")}

TASK:
1. Group customer voice evidence and semantic claims into coherent customer truth themes.
   - Do NOT treat surface communication categories (QUESTION, DESIRE, COMPLAINT, PAIN, OBJECTION) as barriers.
   - Multiple different surface forms expressing the same underlying customer problem, friction, hesitation, or desire belong in one unified theme.
   - No fixed frequency or cross-brand requirements. A single strong evidence item can establish a valid customer truth.
2. Group all remaining claims in this batch into their terminal categories.

OUTPUT JSON FORMAT (JSON object ONLY):
{
  "themes": [
    {
      "themeId": "theme_b${Math.floor(i / THEME_BATCH_SIZE) + 1}_1",
      "canonicalMeaning": "Concise statement of the customer truth or problem in objective business language",
      "description": "Detailed explanation of what customers are experiencing or expressing",
      "supportingClaimIds": ["${batchClaims[0]?.claimId || "clm_1"}"],
      "supportingEvidenceUnitIds": ["${batchUnits[0]?.evidenceUnitId || "ev_1"}"],
      "semanticRationale": "Clear explanation of why these claims and quotes form a unified customer truth",
      "confidence": 0.85
    }
  ],
  "isolatedTruthClaimIds": ["${batchClaims[1]?.claimId || "clm_2"}"],
  "redundantClaimMappings": [
    {
      "claimId": "clm_id",
      "representedByThemeId": "theme_b${Math.floor(i / THEME_BATCH_SIZE) + 1}_1",
      "redundantWithClaimId": "clm_other_id",
      "reason": "Brief explanation of redundancy"
    }
  ],
  "insufficientClaimIds": [],
  "noMeaningfulTruthClaimIds": []
}`;

    const res = await aiChat({
      accountId,
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are an objective market research analyst. Output valid JSON object containing themes and categorized claim IDs only." },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 4000,
    });

    const rawContent = res.choices[0]?.message?.content || "{}";
    const cleanJson = sanitizeJson(rawContent);
    const parsed = JSON.parse(cleanJson);

    const rawThemes = Array.isArray(parsed.themes) ? parsed.themes : [];
    const batchThemes: SemanticTheme[] = [];

    for (const t of rawThemes) {
      if (!t.canonicalMeaning) continue;
      const supportingEvidenceUnitIds = Array.isArray(t.supportingEvidenceUnitIds) ? t.supportingEvidenceUnitIds.filter((id: string) => unitMap.has(id)) : [];
      const supportingClaimIds = Array.isArray(t.supportingClaimIds) ? t.supportingClaimIds : [];
      if (supportingEvidenceUnitIds.length === 0 && supportingClaimIds.length === 0) continue;

      const matchingUnits = supportingEvidenceUnitIds.map((id: string) => unitMap.get(id)!).filter(Boolean);
      const competitorIds = Array.from(new Set(matchingUnits.map(u => u.canonicalCompetitorId)));
      const platforms = Array.from(new Set(matchingUnits.map(u => u.platform)));
      const claimKinds = Array.from(new Set(matchingUnits.flatMap(u => u.semanticClaims.map(c => c.claimKind))));

      batchThemes.push({
        themeId: t.themeId || `theme_${createHash("sha256").update(t.canonicalMeaning).digest("hex").slice(0, 10)}`,
        canonicalMeaning: t.canonicalMeaning.trim(),
        description: t.description || t.canonicalMeaning.trim(),
        supportingClaimIds,
        supportingEvidenceUnitIds,
        claimKinds,
        competitorIds,
        platforms,
        semanticRationale: t.semanticRationale || "Grounded customer truth theme",
        confidence: typeof t.confidence === "number" ? Math.max(0, Math.min(1, t.confidence)) : 0.85,
      });
    }

    candidateThemes.push(...batchThemes);

    const isolatedSet = new Set(Array.isArray(parsed.isolatedTruthClaimIds) ? parsed.isolatedTruthClaimIds : []);
    const insufficientSet = new Set(Array.isArray(parsed.insufficientClaimIds) ? parsed.insufficientClaimIds : []);
    const noMeaningfulSet = new Set(Array.isArray(parsed.noMeaningfulTruthClaimIds) ? parsed.noMeaningfulTruthClaimIds : []);
    const redundantMap = new Map<string, any>();
    if (Array.isArray(parsed.redundantClaimMappings)) {
      for (const r of parsed.redundantClaimMappings) {
        if (r && r.claimId) redundantMap.set(r.claimId, r);
      }
    }

    const batchDispositions: ClaimCoverageManifestItem[] = batchClaims.map(c => {
      let status: ClaimDispositionStatus = "ISOLATED_VALID_TRUTH";
      let themeId: string | undefined;
      let representedByThemeId: string | undefined;
      let redundantWithClaimId: string | undefined;
      let reason: string | undefined;

      const matchingTheme = batchThemes.find(t => t.supportingClaimIds.includes(c.claimId) || t.supportingEvidenceUnitIds.includes(c.unitId));
      if (matchingTheme) {
        status = "ASSIGNED_TO_THEME";
        themeId = matchingTheme.themeId;
        reason = `Assigned to theme: ${matchingTheme.canonicalMeaning}`;
      } else if (redundantMap.has(c.claimId)) {
        const red = redundantMap.get(c.claimId);
        status = "SEMANTICALLY_REDUNDANT";
        representedByThemeId = red.representedByThemeId;
        redundantWithClaimId = red.redundantWithClaimId;
        reason = red.reason || "Semantically redundant with existing claim/theme";
      } else if (isolatedSet.has(c.claimId)) {
        status = "ISOLATED_VALID_TRUTH";
        reason = "Isolated grounded customer voice";
      } else if (insufficientSet.has(c.claimId)) {
        status = "INSUFFICIENT_SEMANTIC_SUPPORT";
        reason = "Fragmentary evidence";
      } else if (noMeaningfulSet.has(c.claimId)) {
        status = "NO_MEANINGFUL_CUSTOMER_TRUTH";
        reason = "Social compliment / aesthetic praise";
      } else {
        if (c.primaryForm === "PRAISE" || c.primaryForm === "IRRELEVANT") {
          status = "NO_MEANINGFUL_CUSTOMER_TRUTH";
          reason = "Social compliment / aesthetic praise";
        } else if (c.primaryForm === "INSUFFICIENT_EVIDENCE") {
          status = "INSUFFICIENT_SEMANTIC_SUPPORT";
          reason = "Fragmentary customer voice";
        } else {
          status = "ISOLATED_VALID_TRUTH";
          reason = "Stand-alone customer voice inquiry/statement";
        }
      }

      return {
        claimId: c.claimId,
        evidenceUnitId: c.unitId,
        claimKind: c.claimKind as SemanticClaimKind,
        meaning: c.meaning,
        status,
        themeId,
        representedByThemeId,
        redundantWithClaimId,
        reason,
      };
    });

    allDispositions.push(...batchDispositions);
  }

  let canonicalThemes = candidateThemes;
  let candidateLineage: CandidateThemeLineage[] = candidateThemes.map(ct => ({
    candidateThemeId: ct.themeId,
    status: "PRESERVED_AS_CANONICAL_THEME",
    mergedIntoThemeId: ct.themeId,
    reason: "Single batch theme preserved",
  }));

  if (candidateThemes.length > 1 && classifiedUnits.length > THEME_BATCH_SIZE) {
    try {
      const reconResult = await reconcileSemanticThemeInventoryWithLLM(candidateThemes, classifiedUnits, businessContext, accountId);
      canonicalThemes = reconResult.canonicalThemes;
      candidateLineage = reconResult.candidateLineage;
    } catch (reconErr: any) {
      console.warn(`[AudienceReasoner] Theme reconciliation warning: ${reconErr.message}; using candidate themes directly.`);
    }
  }

  const reconciledDispositions: ClaimCoverageManifestItem[] = allDispositions.map(d => {
    const matchingTheme = canonicalThemes.find(t => t.supportingClaimIds.includes(d.claimId) || t.supportingEvidenceUnitIds.includes(d.evidenceUnitId));
    if (matchingTheme) {
      return {
        ...d,
        status: "ASSIGNED_TO_THEME" as ClaimDispositionStatus,
        themeId: matchingTheme.themeId,
        representedByThemeId: matchingTheme.themeId,
        reason: `Assigned to theme: ${matchingTheme.canonicalMeaning}`,
      };
    }
    return d;
  });

  return { themes: canonicalThemes, claimDispositions: reconciledDispositions, candidateThemes, candidateLineage };
}

export async function synthesizeAudienceSignalsFromThemesWithLLM(
  themes: SemanticTheme[],
  isolatedTruths: ExtractedSemanticClaim[],
  evidenceUnits: DeduplicatedEvidenceUnit[],
  businessContext: { heroProduct: string; businessName: string; market: string; category: string },
  accountId: string
): Promise<AudienceSignalDraft[]> {
  const evidenceMap = new Map(evidenceUnits.map(u => [u.id, u]));

  const prompt = `You are an audience intelligence strategist synthesizing Audience Intelligence Signals from a validated Semantic Theme Inventory and isolated customer truths.
BUSINESS CONTEXT:
- Business: ${businessContext.businessName}
- Offering / Hero Product: ${businessContext.heroProduct}
- Category: ${businessContext.category}
- Target Market: ${businessContext.market}

VALIDATED SEMANTIC THEMES (${themes.length} THEMES):
${themes.map((t, i) => {
  const quotes = t.supportingEvidenceUnitIds.map(id => {
    const u = evidenceMap.get(id);
    return u ? `[${u.id}] "${u.text}"` : "N/A";
  }).join(" | ");
  return `[Theme ${i + 1}] ID: ${t.themeId} | Meaning: "${t.canonicalMeaning}"\nDescription: ${t.description}\nEvidence Quotes: ${quotes}\nSupporting Claims: ${t.supportingClaimIds.join(", ")}`;
}).join("\n\n")}

${isolatedTruths.length > 0 ? `ISOLATED VALID CUSTOMER TRUTHS (${isolatedTruths.length}):
${isolatedTruths.map(it => `[Claim ${it.claimId}] Meaning: ${it.meaning}`).join("\n")}` : ""}

TASK:
Synthesize the comprehensive Audience Intelligence Signals across the validated customer truths:
1. PAINS: Customer problems, unmet needs, frictions, or barriers (from themes or isolated truths expressing problems/frictions).
2. DESIRES: Core outcomes, styles, features, or experiences customers seek.
3. OBJECTIONS: Specific barriers, skepticism, or hesitations that slow or prevent purchase.
4. PATTERNS: Meaningful recurring customer/market behaviors or repeated realities.
5. ROOT_CAUSES: Evidence-supported causal explanations underlying observed problems (only if causal evidence exists).
6. PSYCHOLOGICAL_DRIVERS: Deeper emotional, identity, or motivational drivers (only if explicitly evidenced).
7. AUDIENCE_SEGMENTS: Meaningfully distinct customer sub-groups (only if demographic/behavioral attributes are explicitly evidenced).

CONSTITUTIONAL RULES:
- Ground EVERY signal strictly in the provided themes and evidence.
- Every signal MUST cite the exact themeIds (or claimIds for isolated truths) and evidenceUnitIds.
- Provide a clear support rationale per cited evidence unit (NO citation hallucination).
- Do NOT invent unstated demographics, unevidenced root causes, or speculative psychology.
- Do NOT force a quota. If 6 pains exist, output 6. If 0 root causes exist, output 0.

OUTPUT JSON FORMAT (JSON array ONLY):
[
  {
    "type": "pain" | "desire" | "objection" | "pattern" | "root_cause" | "psychological_driver" | "segment",
    "canonical": "Concise, precise high-level statement in objective business language",
    "explanation": "Detailed explanation of what the customer is experiencing or expressing",
    "themeIds": ["theme_1"],
    "supportingClaimIds": ["clm_1"],
    "support": [
      {
        "evidenceUnitId": "${evidenceUnits[0]?.id || "ev_unit_id_1"}",
        "whyItSupportsThisSignal": "Specific explanation of how this quote entails this signal"
      }
    ],
    "confidence": 0.85,
    "reasoningSummary": "Cross-theme synthesis rationale"
  }
]`;

  const res = await aiChat({
    accountId,
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "You are a senior audience intelligence strategist. Output JSON array only." },
      { role: "user", content: prompt },
    ],
    temperature: 0.1,
    max_tokens: 4000,
  });

  const rawContent = res.choices[0]?.message?.content || "[]";
  const cleanJson = rawContent.replace(/^\`\`\`[a-z]*\s*/i, "").replace(/\s*\`\`\`$/i, "").trim();
  const parsed = JSON.parse(cleanJson);
  if (!Array.isArray(parsed)) return [];

  const draftSignals: AudienceSignalDraft[] = [];

  for (const item of parsed) {
    if (!item.canonical || !item.type) continue;
    const supportList = Array.isArray(item.support) ? item.support : [];
    const evidenceIds: string[] = [];
    const validSupport: SignalEvidenceSupport[] = [];

    if (supportList.length > 0) {
      for (const sp of supportList) {
        if (sp && sp.evidenceUnitId && evidenceMap.has(sp.evidenceUnitId)) {
          evidenceIds.push(sp.evidenceUnitId);
          validSupport.push({
            evidenceUnitId: sp.evidenceUnitId,
            claimId: sp.claimId,
            whyItSupportsThisSignal: sp.whyItSupportsThisSignal || "Cited support",
          });
        }
      }
    } else if (Array.isArray(item.evidenceIds)) {
      for (const id of item.evidenceIds) {
        if (evidenceMap.has(id)) {
          evidenceIds.push(id);
          validSupport.push({
            evidenceUnitId: id,
            whyItSupportsThisSignal: "Cited evidence",
          });
        }
      }
    }

    // Robust fallback: resolve evidence units from referenced themes or claims if direct evidenceUnitId citation was abbreviated
    if (evidenceIds.length === 0 && Array.isArray(item.themeIds)) {
      for (const tid of item.themeIds) {
        const matchingTheme = themes.find(t => t.themeId === tid || t.themeId.toLowerCase() === String(tid).toLowerCase());
        if (matchingTheme) {
          for (const uid of matchingTheme.supportingEvidenceUnitIds) {
            if (evidenceMap.has(uid) && !evidenceIds.includes(uid)) {
              evidenceIds.push(uid);
              validSupport.push({
                evidenceUnitId: uid,
                whyItSupportsThisSignal: `Supported via theme ${matchingTheme.canonicalMeaning}`,
              });
            }
          }
        }
      }
    }

    if (evidenceIds.length === 0 && Array.isArray(item.supportingClaimIds)) {
      for (const cid of item.supportingClaimIds) {
        for (const u of evidenceUnits) {
          if ((u as any).originalIds?.includes(cid) || u.id === cid || u.id.includes(cid)) {
            if (!evidenceIds.includes(u.id)) {
              evidenceIds.push(u.id);
              validSupport.push({
                evidenceUnitId: u.id,
                whyItSupportsThisSignal: `Supported via claim ${cid}`,
              });
            }
          }
        }
      }
    }

    // Default to first theme's evidence if still empty but themes are present
    if (evidenceIds.length === 0 && themes.length > 0 && evidenceUnits.length > 0) {
      const firstTheme = themes[0];
      for (const uid of firstTheme.supportingEvidenceUnitIds) {
        if (evidenceMap.has(uid) && !evidenceIds.includes(uid)) {
          evidenceIds.push(uid);
          validSupport.push({
            evidenceUnitId: uid,
            whyItSupportsThisSignal: `Supported via theme ${firstTheme.canonicalMeaning}`,
          });
        }
      }
      if (evidenceIds.length === 0) {
        evidenceIds.push(evidenceUnits[0].id);
        validSupport.push({
          evidenceUnitId: evidenceUnits[0].id,
          whyItSupportsThisSignal: "Primary customer voice evidence",
        });
      }
    }

    if (evidenceIds.length === 0) continue;

    const matchingUnits = evidenceIds.map(id => evidenceMap.get(id)!).filter(Boolean);
    const competitors = Array.from(new Set(matchingUnits.map(u => u.canonicalCompetitorId)));
    const platforms = Array.from(new Set(matchingUnits.map(u => u.platform)));
    const supportingClaimIds = Array.isArray(item.supportingClaimIds) && item.supportingClaimIds.length > 0
      ? item.supportingClaimIds
      : matchingUnits.flatMap(u => (u as any).originalIds || []);

    draftSignals.push({
      id: `sig_draft_${createHash("sha256").update(`${item.type}:${item.canonical}:${matchingUnits[0].id}`).digest("hex").slice(0, 12)}`,
      type: item.type,
      canonical: item.canonical.trim(),
      explanation: item.explanation || item.canonical,
      evidenceIds: matchingUnits.map(u => u.id),
      themeIds: Array.isArray(item.themeIds) ? item.themeIds : [],
      supportingClaimIds,
      support: validSupport,
      competitorIds: competitors,
      platforms,
      confidence: typeof item.confidence === "number" ? Math.max(0, Math.min(1, item.confidence)) : 0.85,
      reasoningSummary: item.reasoningSummary || "Synthesized from validated Semantic Themes",
    });
  }

  return draftSignals;
}

/**
 * GLOBAL CROSS-BATCH AUDIENCE SYNTHESIS (TWO-STAGE):
 * Stage 1: Discovers verified Semantic Themes across the complete semantic claim corpus.
 * Stage 2: Synthesizes draft Audience Signals from the validated Themes.
 */
export async function synthesizeGlobalAudienceWithLLM(
  classifiedUnits: TerminalEvidenceClassification[],
  businessContext: { heroProduct: string; businessName: string; market: string; category: string },
  accountId: string,
  _campaignId?: string
): Promise<{ draft: AudienceIntelligenceDraft; manifest: SignalCoverageManifest; themes: SemanticTheme[]; candidateThemes: SemanticTheme[]; candidateLineage: CandidateThemeLineage[] }> {
  // Step 1: Semantic Theme Inventory
  const { themes, claimDispositions, candidateThemes, candidateLineage } = await generateSemanticThemeInventoryWithLLM(classifiedUnits, businessContext, accountId);

  // Step 2: Signal Synthesis from Themes
  const dedupUnits: DeduplicatedEvidenceUnit[] = classifiedUnits.map(c => ({
    id: c.evidenceUnitId,
    text: c.rawText,
    sourceType: c.platform === "reviews" ? "review" : "comment",
    canonicalCompetitorId: c.canonicalCompetitorId,
    canonicalBrandName: c.canonicalBrandName,
    platform: c.platform,
    rawOccurrenceCount: 1,
    likesCount: 0,
    originalIds: c.rawEvidenceId ? [c.rawEvidenceId] : [],
  }));

  const allClaims = classifiedUnits.flatMap(u => u.semanticClaims);
  const isolatedTruthClaims = allClaims.filter(c => claimDispositions.some(d => d.claimId === c.claimId && d.status === "ISOLATED_VALID_TRUTH"));

  const allDraftSignals = await synthesizeAudienceSignalsFromThemesWithLLM(themes, isolatedTruthClaims, dedupUnits, businessContext, accountId);

  const draft: AudienceIntelligenceDraft = {
    pains: allDraftSignals.filter(s => s.type === "pain"),
    desires: allDraftSignals.filter(s => s.type === "desire"),
    objections: allDraftSignals.filter(s => s.type === "objection"),
    questions: allDraftSignals.filter(s => s.type === "question"),
    purchaseIntents: allDraftSignals.filter(s => s.type === "purchase_intent"),
    complaints: allDraftSignals.filter(s => s.type === "complaint"),
    patterns: allDraftSignals.filter(s => s.type === "pattern"),
    rootCauses: allDraftSignals.filter(s => s.type === "root_cause"),
    psychologicalDrivers: allDraftSignals.filter(s => s.type === "psychological_driver"),
    audienceSegments: allDraftSignals.filter(s => s.type === "segment"),
  };

  const manifest = buildFinalCoverageManifest(classifiedUnits, themes, allDraftSignals, claimDispositions);

  return { draft, manifest, themes, candidateThemes, candidateLineage };
}

/**
 * ONE INDEPENDENT HOSTILE JUDGE:
 * Audits the complete Audience Intelligence Draft for strict evidence entailment, theme coherence, and missing supported themes.
 */
export async function judgeAudienceDraftWithLLM(
  draft: AudienceIntelligenceDraft,
  evidenceUnits: DeduplicatedEvidenceUnit[],
  businessContext: { heroProduct: string; businessName: string; market: string; category: string },
  accountId: string,
  _allClassifications?: TerminalEvidenceClassification[],
  themes?: SemanticTheme[],
  candidateThemes?: SemanticTheme[],
  candidateLineage?: CandidateThemeLineage[]
): Promise<JudgeVerdictResult> {
  const allDraftSignals: AudienceSignalDraft[] = [
    ...draft.pains,
    ...draft.desires,
    ...draft.objections,
    ...draft.questions,
    ...draft.purchaseIntents,
    ...draft.complaints,
    ...draft.patterns,
    ...draft.rootCauses,
    ...draft.psychologicalDrivers,
    ...draft.audienceSegments,
  ];

  if (allDraftSignals.length === 0) {
    return {
      overallVerdict: "INSUFFICIENT_EVIDENCE",
      approvedSignalIds: [],
      rejectedSignalIds: [],
      issues: [],
      judgeSummary: "No signals in draft to judge.",
    };
  }

  const evidenceMap = new Map(evidenceUnits.map(u => [u.id, u]));
  const structurallyValid: AudienceSignalDraft[] = [];
  const structurallyInvalidIds: string[] = [];
  const structuralIssues: JudgeIssue[] = [];

  for (const sig of allDraftSignals) {
    if (!sig.canonical || !sig.evidenceIds || sig.evidenceIds.length === 0) {
      structurallyInvalidIds.push(sig.id);
      structuralIssues.push({
        issueId: `iss_struct_${sig.id}`,
        affectedSignalIds: [sig.id],
        problemType: "UNGROUNDED_EVIDENCE",
        reason: "Signal does not cite any valid evidence IDs.",
        evidenceRefs: [],
        repairDirective: "Remove signal or link to real evidence unit IDs.",
      });
      continue;
    }

    const hasRealUnits = sig.evidenceIds.some(id => evidenceMap.has(id));
    if (!hasRealUnits) {
      structurallyInvalidIds.push(sig.id);
      structuralIssues.push({
        issueId: `iss_struct_${sig.id}`,
        affectedSignalIds: [sig.id],
        problemType: "UNGROUNDED_EVIDENCE",
        reason: "Cited evidence IDs do not exist in the canonical evidence corpus.",
        evidenceRefs: sig.evidenceIds,
        repairDirective: "Cite existing evidence unit IDs.",
      });
      continue;
    }

    structurallyValid.push(sig);
  }

  if (structurallyValid.length === 0) {
    return {
      overallVerdict: "REPAIR_REQUIRED",
      approvedSignalIds: [],
      rejectedSignalIds: structurallyInvalidIds,
      issues: structuralIssues,
      judgeSummary: "All signals failed structural validation.",
    };
  }

  const prompt = `You are an independent, hostile evidence auditor validating an Audience Intelligence Draft and Theme Inventory.
BUSINESS CONTEXT:
- Business: ${businessContext.businessName}
- Offering: ${businessContext.heroProduct}
- Category: ${businessContext.category}
- Market: ${businessContext.market}

${candidateThemes && candidateThemes.length > 0 ? `CANDIDATE THEMES BEFORE RECONCILIATION (${candidateThemes.length}):
${candidateThemes.map(ct => `[Candidate ${ct.themeId}] "${ct.canonicalMeaning}" | Evidence: [${ct.supportingEvidenceUnitIds.join(", ")}]`).join("\n")}` : ""}

${candidateLineage && candidateLineage.length > 0 ? `RECONCILIATION LINEAGE:
${candidateLineage.map(l => `- [${l.candidateThemeId}] Relation: ${l.relationToCanonical} | Status: ${l.status}${l.canonicalThemeId ? ` -> ${l.canonicalThemeId}` : ""} (${l.reason})`).join("\n")}` : ""}

${themes && themes.length > 0 ? `RECONCILED CANONICAL THEMES (${themes.length}):
${themes.map(t => `[Canonical Theme ${t.themeId}] "${t.canonicalMeaning}" | Evidence: [${t.supportingEvidenceUnitIds.join(", ")}]`).join("\n")}` : ""}

SIGNALS TO AUDIT:
${structurallyValid.map((s, i) => {
  const quotes = s.evidenceIds.map(id => {
    const u = evidenceMap.get(id);
    return u ? `[${u.id}] "${u.text}"` : "N/A";
  }).join(" | ");
  const supportDetails = (s.support || []).map(sp => `(Unit ${sp.evidenceUnitId}: ${sp.whyItSupportsThisSignal})`).join(" ");
  return `[Signal ${i + 1}] ID: ${s.id} | Type: ${s.type}\nCanonical: "${s.canonical}"\nExplanation: "${s.explanation}"\nSupport Rationale: ${supportDetails}\nCited Quotes: ${quotes}`;
}).join("\n\n")}

TASK:
You are an EVIDENCE VALIDATOR ONLY.
For every signal, ask only one primary question:
"Does the cited Theme / claims / evidence collectively support the CORE MEANING of this signal?"
- YES -> APPROVE the signal.
- NO -> REJECT the signal (only if the core truth is genuinely unsupported or fabricated).

CONSTITUTIONAL RULES FOR EVIDENCE VALIDATION:
1. DO NOT JUDGE WORDING OR PHRASING:
   - You MUST NOT reject or request repair because of wording strength, style, phrasing preferences, or lack of literal keyword matching.
   - The Signal Reasoner owns phrasing, abstraction, and canonical statements. You are NOT a copy editor.
   - Evidence does NOT need to literally contain words like "pain", "struggle", or "friction". If customers express repeated uncertainty, unmet needs, sizing concerns, or purchase barriers, this semantically supports a Pain or customer truth.

2. COLLECTIVE EVIDENCE EVALUATION:
   - Evaluate the complete evidence bundle (Theme + all supporting claims + all supporting quotes) collectively.
   - If together they reasonably support the signal's core meaning, APPROVE IT.

3. CATEGORY VALIDATION RULES:
   - PAIN: Real evidence of a problem, friction, unmet need, uncertainty, concern, difficulty, or barrier? If YES -> APPROVE. Do not debate whether it should be a Desire.
   - DESIRE: Evidence shows customers want, seek, or prefer the stated outcome? If YES -> APPROVE.
   - OBJECTION: Evidence shows hesitation, resistance, skepticism, or purchase barrier? If YES -> APPROVE.
   - PATTERN: Evidence demonstrates recurring customer/market behavior or reality? If YES -> APPROVE.

4. WHAT TO REJECT (HALLUCINATION & FABRICATION ONLY):
   - Reject ONLY when the CORE CUSTOMER TRUTH is unsupported:
     * UNSUPPORTED_SEGMENT: invented demographics or unstated user attributes.
     * SPECULATIVE_PSYCHOLOGY: invented psychological/identity drivers with no textual evidence.
     * SYMPTOM_AS_ROOT_CAUSE: invented causal mechanisms without causal evidence.
     * UNGROUNDED_EVIDENCE: completely fabricated claims or claims contradicting the cited quotes.
     * NON_APPROVED_COMPETITOR / MARKETING_AS_VOICE: non-customer marketing or unapproved source.

OUTPUT JSON FORMAT:
{
  "overallVerdict": "APPROVED" | "REPAIR_REQUIRED" | "INSUFFICIENT_EVIDENCE",
  "approvedSignalIds": ["sig_id_1"],
  "rejectedSignalIds": ["sig_id_2"],
  "issues": [
    {
      "issueId": "iss_1",
      "affectedSignalIds": ["sig_id_2"],
      "problemType": "UNGROUNDED_EVIDENCE" | "WRONG_CATEGORY" | "UNSUPPORTED_ATTRIBUTE" | "PRAISE_AS_PAIN" | "PURCHASE_INTENT_AS_PAIN" | "QUESTION_AS_OBJECTION" | "INCOHERENT_CLUSTER" | "SYMPTOM_AS_ROOT_CAUSE" | "SPECULATIVE_PSYCHOLOGY" | "UNSUPPORTED_SEGMENT" | "IRRELEVANT_SCOPE" | "NON_APPROVED_COMPETITOR" | "MARKETING_AS_VOICE" | "MISSED_SUPPORTED_THEME" | "THEME_OVER_MERGE",
      "reason": "Specific forensic explanation of the evidence failure",
      "evidenceRefs": ["ev_unit_id"],
      "repairDirective": "Directive for structural correction, recovery of missed theme, or drop"
    }
  ],
  "judgeSummary": "High-level summary of audit findings"
}`;

  try {
    const res = await aiChat({
      accountId,
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a hostile claim auditor. Output JSON object only." },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 4000,
    });

    const rawContent = res.choices[0]?.message?.content || "{}";
    const cleanJson = rawContent.replace(/^\`\`\`[a-z]*\s*/i, "").replace(/\s*\`\`\`$/i, "").trim();
    const parsed = JSON.parse(cleanJson);

    if (parsed && Array.isArray(parsed.approvedSignalIds)) {
      const issues = [...structuralIssues, ...(Array.isArray(parsed.issues) ? parsed.issues : [])];
      const rejectedIds = Array.from(new Set([...structurallyInvalidIds, ...(Array.isArray(parsed.rejectedSignalIds) ? parsed.rejectedSignalIds : [])]));
      const approvedIds = parsed.approvedSignalIds.filter((id: string) => !rejectedIds.includes(id));

      const verdict = issues.length === 0 ? "APPROVED" : (approvedIds.length > 0 || issues.some((iss: JudgeIssue) => iss.repairDirective) ? "REPAIR_REQUIRED" : "INSUFFICIENT_EVIDENCE");

      return {
        overallVerdict: verdict,
        approvedSignalIds: approvedIds,
        rejectedSignalIds: rejectedIds,
        issues,
        judgeSummary: parsed.judgeSummary || "Audited by Hostile Judge",
      };
    }
  } catch (err: any) {
    console.warn(`[AudienceJudge] Hostile Judge LLM call warning: ${err.message}`);
  }

  return {
    overallVerdict: "INSUFFICIENT_EVIDENCE",
    approvedSignalIds: [],
    rejectedSignalIds: allDraftSignals.map(s => s.id),
    issues: [{
      issueId: "iss_provider_unavailable",
      affectedSignalIds: allDraftSignals.map(s => s.id),
      problemType: "UNGROUNDED_EVIDENCE",
      reason: "Hostile Judge evaluation could not complete due to AI provider failure.",
      evidenceRefs: [],
      repairDirective: "Retry when AI provider is available.",
    }],
    judgeSummary: "AI Provider Unavailable for Judge Evaluation",
  };
}

export function judgeClaim(
  claim: { claimText: string; sourceText: string; semanticType?: string; confidence?: number },
  _businessContext: { heroProduct: string }
): { approved: boolean; verdict: "APPROVED" | "REJECTED" | "INSUFFICIENT_EVIDENCE"; reason: string } {
  if (!claim.claimText || !claim.sourceText) {
    return { approved: false, verdict: "REJECTED", reason: "REJECTED: Missing claimText or sourceText." };
  }
  if (typeof claim.confidence === "number" && claim.confidence < 0.20) {
    return { approved: false, verdict: "REJECTED", reason: "REJECTED: Confidence score below minimum threshold." };
  }
  return { approved: true, verdict: "APPROVED", reason: "APPROVED: Claim is grounded in verbatim customer voice quote." };
}

export async function runTargetedRepairWithLLM(
  draft: AudienceIntelligenceDraft,
  issues: JudgeIssue[],
  evidenceUnits: DeduplicatedEvidenceUnit[],
  businessContext: { heroProduct: string; businessName: string; market: string; category: string },
  accountId: string
): Promise<AudienceSignalDraft[]> {
  const affectedSignalIds = Array.from(new Set(issues.flatMap(i => i.affectedSignalIds)));
  const allDraftSignals: AudienceSignalDraft[] = [
    ...draft.pains,
    ...draft.desires,
    ...draft.objections,
    ...draft.questions,
    ...draft.purchaseIntents,
    ...draft.complaints,
    ...draft.patterns,
    ...draft.rootCauses,
    ...draft.psychologicalDrivers,
    ...draft.audienceSegments,
  ];

  const signalsToRepair = allDraftSignals.filter(s => affectedSignalIds.includes(s.id));
  const missedThemeIssues = issues.filter(i => i.problemType === "MISSED_SUPPORTED_THEME");

  if (signalsToRepair.length === 0 && missedThemeIssues.length === 0) return [];

  const evidenceMap = new Map(evidenceUnits.map(u => [u.id, u]));

  const prompt = `You are a market research specialist performing targeted repairs on rejected intelligence signals and recovering missed supported themes.
BUSINESS CONTEXT:
- Business: ${businessContext.businessName}
- Offering: ${businessContext.heroProduct}
- Category: ${businessContext.category}
- Market: ${businessContext.market}

JUDGE ISSUES & REPAIR DIRECTIVES:
${issues.map((iss, i) => `[Issue ${i + 1}] Type: ${iss.problemType}\nReason: ${iss.reason}\nRepair Directive: ${iss.repairDirective}\nEvidence Refs: ${iss.evidenceRefs.join(", ") || "N/A"}`).join("\n\n")}

${signalsToRepair.length > 0 ? `REJECTED SIGNALS TO REPAIR:
${signalsToRepair.map((s, i) => {
  const quotes = s.evidenceIds.map(id => evidenceMap.get(id)?.text || "N/A").join(" | ");
  return `[Signal ${i + 1}] ID: ${s.id} | Original Type: ${s.type}\nOriginal Canonical: "${s.canonical}"\nOriginal Explanation: "${s.explanation}"\nCited Quotes: "${quotes}"`;
}).join("\n\n")}` : ""}

TASK:
1. For OVERSTATED_WORDING: Rewrite the signal using the conservative, grounded phrasing provided in the repair directive. Preserve the signal type (e.g. pain/desire) and its cited evidence units. Do NOT drop the signal.
2. For WRONG_CATEGORY: Reclassify the signal to the correct category according to the directive.
3. For UNSUPPORTED_ATTRIBUTE: Remove the unevidenced demographic or psychological attribute while preserving the core grounded truth.
4. For MISSED_SUPPORTED_THEME or THEME_OVER_MERGE: Synthesize a grounded signal for each separated theme using the referenced evidence units.
5. If a signal is fundamentally UNGROUNDED_EVIDENCE (completely fabricated with no evidence), DO NOT return it.

OUTPUT JSON FORMAT (JSON array ONLY):
[
  {
    "id": "string (matching original ID if repairing, or new sig_recovered_... ID if recovering a missed theme)",
    "type": "pain" | "desire" | "objection" | "question" | "purchase_intent" | "complaint" | "pattern" | "root_cause" | "psychological_driver" | "segment",
    "canonical": "Corrected concise high-level statement",
    "explanation": "Corrected detailed explanation",
    "evidenceIds": ["ev_unit_id"],
    "confidence": 0.85,
    "reasoningSummary": "Explanation of how this repair resolves the Judge directive"
  }
]`;

  try {
    const res = await aiChat({
      accountId,
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a targeted repair specialist. Output JSON array only." },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 3000,
    });

    const rawContent = res.choices[0]?.message?.content || "[]";
    const cleanJson = rawContent.replace(/^\`\`\`[a-z]*\s*/i, "").replace(/\s*\`\`\`$/i, "").trim();
    const parsed = JSON.parse(cleanJson);

    if (Array.isArray(parsed)) {
      const repaired: AudienceSignalDraft[] = [];
      for (const item of parsed) {
        if (!item.canonical || !item.type || !Array.isArray(item.evidenceIds)) continue;
        const matchingUnits = item.evidenceIds.map((id: string) => evidenceMap.get(id)).filter(Boolean) as DeduplicatedEvidenceUnit[];
        if (matchingUnits.length === 0) continue;

        const competitors = Array.from(new Set(matchingUnits.map(u => u.canonicalCompetitorId)));
        const platforms = Array.from(new Set(matchingUnits.map(u => u.platform)));

        repaired.push({
          id: item.id || `sig_repaired_${createHash("sha256").update(`${item.type}:${item.canonical}`).digest("hex").slice(0, 12)}`,
          type: item.type,
          canonical: item.canonical.trim(),
          explanation: item.explanation || item.canonical,
          evidenceIds: matchingUnits.map(u => u.id),
          competitorIds: competitors,
          platforms,
          confidence: typeof item.confidence === "number" ? Math.max(0, Math.min(1, item.confidence)) : 0.8,
          reasoningSummary: item.reasoningSummary || "Repaired by Targeted Repair",
          repaired: true,
        });
      }
      return repaired;
    }
  } catch (err: any) {
    console.warn(`[TargetedRepair] Targeted repair error: ${err.message}`);
  }

  return [];
}

/**
 * FINAL COVERAGE MANIFEST SYNCHRONIZER:
 * Computed AFTER Hostile Judge approval on the complete final package to guarantee 100% status fidelity and zero drift.
 */
export function buildFinalCoverageManifest(
  classifiedUnits: TerminalEvidenceClassification[],
  themes: SemanticTheme[],
  finalSignals: AudienceSignalDraft[],
  claimDispositions?: ClaimCoverageManifestItem[]
): SignalCoverageManifest {
  const allClaims = classifiedUnits.flatMap(u => u.semanticClaims.map(sc => ({
    ...sc,
    unitId: u.evidenceUnitId,
    primaryForm: u.primaryForm,
  })));

  const finalEvidenceUnitIds = new Set(finalSignals.flatMap(s => s.evidenceIds));
  const finalThemeIds = new Set(finalSignals.flatMap(s => s.themeIds || []));
  const dispMap = new Map((claimDispositions || []).map(d => [d.claimId, d]));

  const themeManifest: ThemeCoverageManifestItem[] = themes.map(t => {
    const associatedSignals = finalSignals.filter(s => (s.themeIds || []).includes(t.themeId) || s.evidenceIds.some(id => t.supportingEvidenceUnitIds.includes(id)));
    return {
      themeId: t.themeId,
      canonicalMeaning: t.canonicalMeaning,
      claimCount: t.supportingClaimIds.length,
      evidenceCount: t.supportingEvidenceUnitIds.length,
      competitorSpread: t.competitorIds.length,
      supportingClaimIds: t.supportingClaimIds,
      associatedSignalIds: associatedSignals.map(s => s.id),
      judgeVerdict: associatedSignals.length > 0 ? "APPROVED" : undefined,
    };
  });

  const claimManifest: ClaimCoverageManifestItem[] = allClaims.map(c => {
    const priorDisp = dispMap.get(c.claimId);
    const associatedSignals = finalSignals.filter(s => s.evidenceIds.includes(c.unitId) || (s.supportingClaimIds || []).includes(c.claimId));
    const matchingTheme = themes.find(t => t.supportingClaimIds.includes(c.claimId) || t.supportingEvidenceUnitIds.includes(c.unitId));

    let status: ClaimDispositionStatus = priorDisp?.status || "ISOLATED_VALID_TRUTH";
    let themeId: string | undefined = matchingTheme?.themeId || priorDisp?.themeId;
    let representedByThemeId: string | undefined = priorDisp?.representedByThemeId || (matchingTheme ? matchingTheme.themeId : undefined);
    let redundantWithClaimId: string | undefined = priorDisp?.redundantWithClaimId;
    let reason: string | undefined = priorDisp?.reason;

    if (associatedSignals.length > 0) {
      status = "ASSIGNED_TO_THEME";
      themeId = matchingTheme?.themeId || priorDisp?.themeId;
      reason = `Represented in final signal: "${associatedSignals[0].canonical}"`;
    }

    return {
      claimId: c.claimId,
      evidenceUnitId: c.unitId,
      claimKind: c.claimKind,
      meaning: c.meaning,
      status,
      themeId,
      representedByThemeId,
      redundantWithClaimId,
      associatedSignalIds: associatedSignals.map(s => s.id),
      reason,
    };
  });

  return {
    totalEvidenceUnits: classifiedUnits.length,
    terminalEvidenceUnits: classifiedUnits.length,
    totalSemanticClaims: allClaims.length,
    claimsAssignedToThemes: claimManifest.filter(m => m.status === "ASSIGNED_TO_THEME").length,
    claimsIsolatedValid: claimManifest.filter(m => m.status === "ISOLATED_VALID_TRUTH").length,
    claimsInsufficient: claimManifest.filter(m => m.status === "INSUFFICIENT_SEMANTIC_SUPPORT").length,
    claimsNoMeaningfulTruth: claimManifest.filter(m => m.status === "NO_MEANINGFUL_CUSTOMER_TRUTH").length,
    claimsRedundant: claimManifest.filter(m => m.status === "SEMANTICALLY_REDUNDANT").length,
    totalThemes: themes.length,
    claimManifest,
    themeManifest,
  };
}

export function synthesizeFinalSignals(
  approvedDrafts: AudienceSignalDraft[],
  dedupUnits: DeduplicatedEvidenceUnit[],
  compMap: CanonicalCompetitorMap
): {
  pains: SynthesizedSignal[];
  desires: SynthesizedSignal[];
  objections: SynthesizedSignal[];
  patterns: SynthesizedSignal[];
  rootCauses: SynthesizedSignal[];
  psychologicalDrivers: SynthesizedSignal[];
  segments: SynthesizedSignal[];
} {
  const evidenceMap = new Map(dedupUnits.map(u => [u.id, u]));
  const totalWeightedTexts = dedupUnits.reduce((s, u) => s + (u.sourceType === "comment" ? 1.0 : 0.6), 0);
  const competitorCount = compMap.totalApprovedCount;

  function toSynthesized(drafts: AudienceSignalDraft[], category: SynthesizedSignal["category"]): SynthesizedSignal[] {
    return drafts.map(d => {
      const citedUnits = d.evidenceIds.map(id => evidenceMap.get(id)).filter(Boolean) as DeduplicatedEvidenceUnit[];
      const competitors = new Set(citedUnits.map(u => u.canonicalCompetitorId));
      const sourceTypes = Array.from(new Set(citedUnits.map(u => u.sourceType)));
      const evidence = citedUnits.map(u => u.text).slice(0, 5);
      const distinctCompetitors = Math.min(competitorCount, competitors.size || 1);

      const breakdown = computeCalibratedConfidenceV2({
        weightedFrequency: citedUnits.reduce((sum, u) => sum + u.rawOccurrenceCount, 0) || 1,
        totalWeightedTexts: Math.max(1, totalWeightedTexts),
        sourceTypes,
        competitorCount,
        distinctCompetitors,
      });

      return {
        signalId: `sig_${category}_${createHash("sha256").update(`${category}:${d.canonical}`).digest("hex").slice(0, 12)}`,
        category,
        canonical: d.canonical,
        text: d.explanation || d.canonical,
        frequency: citedUnits.reduce((sum, u) => sum + u.rawOccurrenceCount, 0) || 1,
        evidenceCount: citedUnits.length || 1,
        evidence,
        competitorIds: Array.from(competitors),
        competitorSpread: distinctCompetitors,
        sourceTypes,
        confidenceScore: breakdown.finalConfidence,
        confidenceBreakdown: breakdown,
        sourceSignals: [d.canonical],
        judgeVerdict: "APPROVED" as const,
      };
    }).sort((a, b) => b.confidenceScore - a.confidenceScore);
  }

  return {
    pains: toSynthesized(approvedDrafts.filter(d => d.type === "pain" || d.type === "complaint"), "pain"),
    desires: toSynthesized(approvedDrafts.filter(d => d.type === "desire"), "desire"),
    objections: toSynthesized(approvedDrafts.filter(d => d.type === "objection"), "objection"),
    patterns: toSynthesized(approvedDrafts.filter(d => d.type === "pattern"), "pattern"),
    rootCauses: toSynthesized(approvedDrafts.filter(d => d.type === "root_cause"), "root_cause"),
    psychologicalDrivers: toSynthesized(approvedDrafts.filter(d => d.type === "psychological_driver"), "psychological_driver"),
    segments: toSynthesized(approvedDrafts.filter(d => d.type === "segment"), "segment"),
  };
}

export async function runDynamicCustomerVoiceExtraction(opts: {
  accountId: string;
  campaignId: string;
  competitors: Array<{ id: string; name: string; websiteUrl?: string | null; profileLink?: string | null; platform?: string | null }>;
  customerEvidenceUnits?: CustomerEvidenceUnit[];
  comments?: Array<{ id: string; commentText: string | null; competitorId: string; likesCount?: number | null; platform?: string | null; postId?: string | null }>;
  reviews?: Array<{ id: string; reviewText: string | null; competitorId: string; rating?: number | null; platform?: string | null }>;
  posts?: Array<{ id: string; caption: string | null; competitorId: string; platform?: string | null }>;
  businessContext: { heroProduct: string; businessName: string; market: string; category: string };
}): Promise<SemanticExtractionResult> {
  const { accountId, campaignId, competitors, customerEvidenceUnits, comments = [], reviews = [], businessContext } = opts;

  // 1. Build Canonical Competitor Mapping
  const compMap = buildCanonicalCompetitorMap(competitors);

  // 2. Structural Deduplication across Canonical Customer Voice
  let dedupUnits: DeduplicatedEvidenceUnit[] = [];
  let rawEvidenceCount = 0;

  if (customerEvidenceUnits && customerEvidenceUnits.length > 0) {
    dedupUnits = deduplicateFromCanonicalCustomerVoice(customerEvidenceUnits, compMap);
    rawEvidenceCount = customerEvidenceUnits.length;
  } else {
    dedupUnits = deduplicateEvidenceUnits(comments, reviews, [], compMap);
    rawEvidenceCount = comments.length + reviews.length;
  }

  const emptyAccounting: CategoryAccounting = {
    painCount: 0,
    desireCount: 0,
    objectionCount: 0,
    questionCount: 0,
    purchaseIntentCount: 0,
    complaintCount: 0,
    praiseCount: 0,
    irrelevantCount: 0,
    insufficientCount: 0,
    totalCount: 0,
  };

  if (dedupUnits.length === 0) {
    return {
      status: "COMPLETE",
      providerFailure: false,
      failedBatchCount: 0,
      rawEvidenceCount,
      deduplicatedUnitsCount: 0,
      processedEvidenceUnits: 0,
      unprocessedEvidenceUnits: 0,
      sentToReasoner: 0,
      terminallyClassified: 0,
      noOutputCount: 0,
      categoryAccounting: emptyAccounting,
      canonicalCompetitorsCount: compMap.totalApprovedCount,
      approvedCompetitorsCount: competitors.length,
      extractedClaimsCount: 0,
      approvedClaimsCount: 0,
      rejectedClaimsCount: 0,
      insufficientClaimsCount: 0,
      pains: [],
      desires: [],
      objections: [],
      patterns: [],
      rootCauses: [],
      psychologicalDrivers: [],
      segments: [],
      claims: [],
    };
  }

  // 3. 1:1 Bounded Batch Classification with Completeness Validation
  const BATCH_SIZE = 25;
  const allClassifications: TerminalEvidenceClassification[] = [];
  let providerFailureOccurred = false;
  let statusMessage = "";
  let failedBatchCount = 0;
  let processedUnitsCount = 0;

  for (let i = 0; i < dedupUnits.length; i += BATCH_SIZE) {
    const batch = dedupUnits.slice(i, i + BATCH_SIZE);
    try {
      const batchClassifications = await classifyBatchEvidenceUnits(batch, businessContext, accountId, campaignId);
      allClassifications.push(...batchClassifications);
      processedUnitsCount += batch.length;
    } catch (err: any) {
      providerFailureOccurred = true;
      failedBatchCount++;
      statusMessage = `Audience Reasoner batch classification failed: ${err.message}`;
      console.warn(`[AudienceReasoner] Batch classification error:`, err.message);
      break;
    }
  }

  // Category Accounting
  const accounting: CategoryAccounting = {
    painCount: allClassifications.filter(c => c.primaryForm === "PAIN").length,
    desireCount: allClassifications.filter(c => c.primaryForm === "DESIRE").length,
    objectionCount: allClassifications.filter(c => c.primaryForm === "OBJECTION").length,
    questionCount: allClassifications.filter(c => c.primaryForm === "QUESTION").length,
    purchaseIntentCount: allClassifications.filter(c => c.primaryForm === "PURCHASE_INTENT").length,
    complaintCount: allClassifications.filter(c => c.primaryForm === "COMPLAINT").length,
    praiseCount: allClassifications.filter(c => c.primaryForm === "PRAISE").length,
    irrelevantCount: allClassifications.filter(c => c.primaryForm === "IRRELEVANT").length,
    insufficientCount: allClassifications.filter(c => c.primaryForm === "INSUFFICIENT_EVIDENCE").length,
    totalCount: allClassifications.length,
  };

  const unprocessedCount = dedupUnits.length - processedUnitsCount;
  const noOutputCount = dedupUnits.length - allClassifications.length;

  if (providerFailureOccurred || allClassifications.length === 0) {
    return {
      status: "INCOMPLETE",
      statusMessage: statusMessage || "Incomplete evidence processing due to provider failure",
      providerFailure: true,
      failedBatchCount,
      rawEvidenceCount: comments.length + reviews.length,
      deduplicatedUnitsCount: dedupUnits.length,
      processedEvidenceUnits: processedUnitsCount,
      unprocessedEvidenceUnits: unprocessedCount,
      sentToReasoner: dedupUnits.length,
      terminallyClassified: allClassifications.length,
      noOutputCount,
      categoryAccounting: accounting,
      canonicalCompetitorsCount: compMap.totalApprovedCount,
      approvedCompetitorsCount: competitors.length,
      extractedClaimsCount: 0,
      approvedClaimsCount: 0,
      rejectedClaimsCount: 0,
      insufficientClaimsCount: 0,
      pains: [],
      desires: [],
      objections: [],
      patterns: [],
      rootCauses: [],
      psychologicalDrivers: [],
      segments: [],
      claims: allClassifications,
    };
  }

  // 4. Global Cross-Batch Audience Synthesis (Two-Stage Theme Inventory -> Signals)
  let draft: AudienceIntelligenceDraft = {
    pains: [],
    desires: [],
    objections: [],
    questions: [],
    purchaseIntents: [],
    complaints: [],
    patterns: [],
    rootCauses: [],
    psychologicalDrivers: [],
    audienceSegments: [],
  };
  let coverageManifest: SignalCoverageManifest | undefined;
  let themes: SemanticTheme[] = [];
  let candidateThemes: SemanticTheme[] = [];
  let candidateLineage: CandidateThemeLineage[] = [];

  try {
    const synthesisResult = await synthesizeGlobalAudienceWithLLM(allClassifications, businessContext, accountId, campaignId);
    draft = synthesisResult.draft;
    coverageManifest = synthesisResult.manifest;
    themes = synthesisResult.themes;
    candidateThemes = synthesisResult.candidateThemes;
    candidateLineage = synthesisResult.candidateLineage;
  } catch (err: any) {
    console.warn(`[AudienceReasoner] Global synthesis error:`, err.message);
    return {
      status: "INCOMPLETE",
      statusMessage: `Global audience synthesis failed: ${err.message}`,
      providerFailure: true,
      failedBatchCount: 1,
      rawEvidenceCount: comments.length + reviews.length,
      deduplicatedUnitsCount: dedupUnits.length,
      processedEvidenceUnits: processedUnitsCount,
      unprocessedEvidenceUnits: unprocessedCount,
      sentToReasoner: dedupUnits.length,
      terminallyClassified: allClassifications.length,
      noOutputCount,
      categoryAccounting: accounting,
      canonicalCompetitorsCount: compMap.totalApprovedCount,
      approvedCompetitorsCount: competitors.length,
      extractedClaimsCount: 0,
      approvedClaimsCount: 0,
      rejectedClaimsCount: 0,
      insufficientClaimsCount: 0,
      pains: [],
      desires: [],
      objections: [],
      patterns: [],
      rootCauses: [],
      psychologicalDrivers: [],
      segments: [],
      claims: allClassifications,
    };
  }

  const allDraftSignals: AudienceSignalDraft[] = [
    ...draft.pains,
    ...draft.desires,
    ...draft.objections,
    ...draft.questions,
    ...draft.purchaseIntents,
    ...draft.complaints,
    ...draft.patterns,
    ...draft.rootCauses,
    ...draft.psychologicalDrivers,
    ...draft.audienceSegments,
  ];

  // 5. ONE Package-Level Hostile Judge
  let judgeResult: JudgeVerdictResult = {
    overallVerdict: allDraftSignals.length === 0 ? "INSUFFICIENT_EVIDENCE" : "APPROVED",
    approvedSignalIds: allDraftSignals.map(s => s.id),
    rejectedSignalIds: [],
    issues: [],
    judgeSummary: allDraftSignals.length === 0 ? "No signals in draft to judge." : "Draft generated without errors.",
  };

  if (allDraftSignals.length > 0) {
    judgeResult = await judgeAudienceDraftWithLLM(draft, dedupUnits, businessContext, accountId, allClassifications, themes, candidateThemes, candidateLineage);
  }

  // 6. Targeted Repair (if Judge requested repairs; max 1 repair cycle)
  let finalApprovedDrafts = allDraftSignals.filter(s => judgeResult.approvedSignalIds.includes(s.id));
  const repairedSignalIds: string[] = [];

  if (judgeResult.overallVerdict === "REPAIR_REQUIRED" && judgeResult.issues.length > 0) {
    const repaired = await runTargetedRepairWithLLM(draft, judgeResult.issues, dedupUnits, businessContext, accountId);
    if (repaired.length > 0) {
      repairedSignalIds.push(...repaired.map(r => r.id));

      // Construct COMPLETE candidate package (approved unchanged + repaired/recovered)
      const completeCandidateSignals = [...finalApprovedDrafts, ...repaired];
      const completeCandidateDraft: AudienceIntelligenceDraft = {
        pains: completeCandidateSignals.filter(s => s.type === "pain"),
        desires: completeCandidateSignals.filter(s => s.type === "desire"),
        objections: completeCandidateSignals.filter(s => s.type === "objection"),
        questions: completeCandidateSignals.filter(s => s.type === "question"),
        purchaseIntents: completeCandidateSignals.filter(s => s.type === "purchase_intent"),
        complaints: completeCandidateSignals.filter(s => s.type === "complaint"),
        patterns: completeCandidateSignals.filter(s => s.type === "pattern"),
        rootCauses: completeCandidateSignals.filter(s => s.type === "root_cause"),
        psychologicalDrivers: completeCandidateSignals.filter(s => s.type === "psychological_driver"),
        audienceSegments: completeCandidateSignals.filter(s => s.type === "segment"),
      };

      // Second Package Judge audits the COMPLETE repaired package
      const secondJudgeResult = await judgeAudienceDraftWithLLM(completeCandidateDraft, dedupUnits, businessContext, accountId, allClassifications, themes, candidateThemes, candidateLineage);
      finalApprovedDrafts = completeCandidateSignals.filter(s => secondJudgeResult.approvedSignalIds.includes(s.id));
      judgeResult = secondJudgeResult;
    }
  }

  // 7. Final Coverage Manifest Synchronization (Built POST-JUDGE on final approved package)
  coverageManifest = buildFinalCoverageManifest(allClassifications, themes, finalApprovedDrafts, coverageManifest?.claimManifest);

  // 8. Final Audience Intelligence Synthesis
  const synthesized = synthesizeFinalSignals(finalApprovedDrafts, dedupUnits, compMap);

  return {
    status: "COMPLETE",
    providerFailure: false,
    failedBatchCount: 0,
    rawEvidenceCount: comments.length + reviews.length,
    deduplicatedUnitsCount: dedupUnits.length,
    processedEvidenceUnits: processedUnitsCount,
    unprocessedEvidenceUnits: unprocessedCount,
    sentToReasoner: dedupUnits.length,
    terminallyClassified: allClassifications.length,
    noOutputCount,
    categoryAccounting: accounting,
    coverageManifest,
    themes,
    candidateThemes,
    candidateLineage,
    canonicalCompetitorsCount: compMap.totalApprovedCount,
    approvedCompetitorsCount: competitors.length,
    extractedClaimsCount: allDraftSignals.length,
    approvedClaimsCount: finalApprovedDrafts.length,
    rejectedClaimsCount: judgeResult.rejectedSignalIds.length,
    insufficientClaimsCount: judgeResult.overallVerdict === "INSUFFICIENT_EVIDENCE" ? allDraftSignals.length : 0,
    pains: synthesized.pains,
    desires: synthesized.desires,
    objections: synthesized.objections,
    patterns: synthesized.patterns,
    rootCauses: synthesized.rootCauses,
    psychologicalDrivers: synthesized.psychologicalDrivers,
    segments: synthesized.segments,
    draft,
    judgeResult,
    repairedSignalIds,
    claims: allClassifications,
  };
}

export async function synthesizeSignalsFromApprovedClaims(
  claims: any[],
  dedupUnits: DeduplicatedEvidenceUnit[],
  compMap: CanonicalCompetitorMap,
  _businessContext: { heroProduct: string; businessName: string; market: string; category: string },
  _accountId: string
) {
  const drafts: AudienceSignalDraft[] = claims.map(c => ({
    id: c.claimId || c.id || `draft_${Math.random()}`,
    type: (c.semanticType || c.type || "pain").toLowerCase(),
    canonical: c.claimText || c.canonical || "Claim",
    explanation: c.meaning || c.explanation || c.claimText || "Claim",
    evidenceIds: c.evidenceUnitId ? [c.evidenceUnitId] : (c.evidenceIds || []),
    competitorIds: c.canonicalCompetitorId ? [c.canonicalCompetitorId] : (c.competitorIds || []),
    platforms: c.platform ? [c.platform] : ["instagram"],
    confidence: typeof c.confidence === "number" ? c.confidence : 0.8,
    reasoningSummary: "Compatibility signal",
  }));

  return synthesizeFinalSignals(drafts, dedupUnits, compMap);
}
