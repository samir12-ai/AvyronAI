import crypto from "node:crypto";
import { deriveValidatedCapabilities } from "../shared/capability-registry";
import { db } from "../db";
import { audienceSnapshots, miSnapshots, ciCompetitors, ciCompetitorPosts, ciCompetitorComments, ciCompetitorReviews, growthCampaigns, campaignSelections, orchestratorJobs } from "@shared/schema";
import { computePainContentHash } from "../shared/audience-pain-registry";
import { loadProductDNA, formatProductDNAForPrompt } from "../shared/product-dna";
import { inArray, eq, and, desc, sql, or, isNull } from "drizzle-orm";
import {
  AUDIENCE_ENGINE_VERSION,
  AUDIENCE_THRESHOLDS,
  PAIN_CLUSTERS,
  DESIRE_CLUSTERS,
  OBJECTION_CLUSTERS,
  TRANSFORMATION_PATTERNS,
  EMOTIONAL_DRIVER_PATTERNS,
  AWARENESS_PATTERNS,
  MATURITY_KEYWORDS,
  INTENT_KEYWORDS,
  LANGUAGE_PATTERNS,
  SYNTHETIC_FILTERS,
  CONFIDENCE_WEIGHTS,
  AUDIENCE_CONFIDENCE_MODEL_VERSION,
  PRIMARY_EVIDENCE_SOURCES,
  OPTIONAL_EVIDENCE_SOURCES,
  CONFIDENCE_WEIGHTS_V2,
  FREQ_SATURATION_V2,
  COMPETITOR_SPREAD_V2,
  CORROBORATION_BONUS_V2,
  OBJECTION_CONTEXT_RULES,
  MIN_EVIDENCE_PER_SIGNAL,
  BRIDGE_SUPPRESS_THRESHOLD,
  COMMENT_QUALITY_WEIGHTS,
  LOW_SIGNAL_COMMENT_PHRASES,
  MAX_EXPECTED_SOURCE_TYPES,
  SOURCE_QUALITY_WEIGHTS,
  type PatternCluster,
  type MarketScope,
} from "./constants";
import { pruneOldSnapshots, assessDataReliability as sharedAssessDataReliability, normalizeConfidence as sharedNormalizeConfidence, detectGenericOutput } from "../engine-hardening";
import { aiChat } from "../ai-client";
import { createSourceLineageEntry, type SignalLineageEntry } from "../shared/signal-lineage";
import { executeSemanticBridge, mergeBridgedIntoAudienceMap, validateBridgeIntegrity, type SemanticBridgeResult } from "./semantic-bridge";
import { CanonicalAudienceSegment, generateAudienceSignatures, generateCrossAudienceStrategy } from "./sophistication-llm";
import { selectEvidence, AudienceEvidenceUnit, formatEvidenceUnits } from "./evidence-selector";
import { scoreAudienceSophistication, type AudienceSophisticationOutput } from "./sophistication-llm";
import { runCandidateGateBattery } from "../shared/candidate-gate-battery";
import { emissionFromBattery, type BatteryAttemptLike, type EngineAiPathEmission } from "../shared/ai-path-telemetry";
import { safeJsonParse, buildDoctrineBlock, type RunStrategicContext } from "../shared/strategic-doctrine";
import { buildGroundingContract, checkGroundingContract, groundingRefsSchema } from "../shared/grounding-contract";
import { generateWithRepair, LLMReliabilityError } from "../shared/llm-reliability/reliability-runner";
import { z } from "zod";
import { evaluateTargetCoverage, type TargetCoverageResult } from "./target-coverage";
import { runDynamicCustomerVoiceExtraction, buildCanonicalCompetitorMap } from "./semantic-reasoner";
import { loadCanonicalCustomerVoice } from "../competitive-intelligence/evidence-routing";
import { judgePrimaryMarketVoiceSufficiencyWithLLM } from "./semantic-sufficiency-judge";
import { evaluateCombinedEvidenceReadiness } from "../shared/combined-readiness";
import { judgeAndRepairPainFidelityWithLLM } from "../shared/pain-classifier";

interface EvidenceMeta {
  evidenceCount: number;
  confidenceScore: number;
  sourceSignals: string[];
  inputSnapshotId: string | null;
}

/** audience-confidence-v2 — per-signal component breakdown (full traceability). */
export interface ConfidenceBreakdownV2 {
  model: string;
  frequencyScore: number;
  primarySourceScore: number;
  competitorSpreadScore: number;
  corroborationBonus: number;
  finalConfidence: number;
}

interface SignalItem extends EvidenceMeta {
  canonical: string;
  frequency: number;
  evidence: string[];
  /** audience-confidence-v2 provenance — source types that evidenced this signal. */
  sourceTypes?: string[];
  /** audience-confidence-v2 provenance — distinct competitor IDs whose content evidenced this signal. */
  competitorIds?: string[];
  /** audience-confidence-v2 provenance — component breakdown of the confidence computation. */
  confidenceBreakdown?: ConfidenceBreakdownV2;
}

interface LanguageSignals extends EvidenceMeta {
  problemExpressions: { count: number; samples: string[] };
  questionPatterns: { count: number; samples: string[] };
  goalExpressions: { count: number; samples: string[] };
  totalAnalyzed: number;
}

interface AwarenessResult extends EvidenceMeta {
  level: "unaware" | "problem_aware" | "solution_aware" | "product_aware" | "most_aware" | "insufficient_signals";
  distribution: Record<string, number>;
}

interface MaturityResult extends EvidenceMeta {
  level: "beginner" | "developing" | "mature" | "insufficient_signals";
  distribution: Record<string, number>;
  indicators: string[];
}

interface IntentDistribution extends EvidenceMeta {
  curiosity: number;
  learning: number;
  comparison: number;
  purchaseIntent: number;
  totalClassified: number;
}

export interface ClaimItem {
  claimId: string;
  canonicalClaimId?: string;
  derivedFromPainId?: string;
  sourcePainId?: string;
  claim: string;
  evidenceIds: string[];
}

export interface RoleClaim {
  claimId: string;
  value: "END_CONSUMER" | "BUYER" | "PRACTITIONER" | "BUSINESS_OWNER" | "PROCUREMENT" | "RESELLER" | "SUPPLIER" | "UNKNOWN";
  evidenceIds: string[];
}

export interface SegmentDefinitionClaim {
  claimId: string;
  claim: string;
  evidenceIds: string[];
}

interface AudienceSegment extends EvidenceMeta {
  id: string;
  name: string;
  role: "END_CONSUMER" | "BUYER" | "PRACTITIONER" | "BUSINESS_OWNER" | "PROCUREMENT" | "RESELLER" | "SUPPLIER" | "UNKNOWN";
  roleClaim?: RoleClaim;
  segmentDefinition?: SegmentDefinitionClaim;
  description: string;
  pains?: ClaimItem[];
  desires?: ClaimItem[];
  objections?: ClaimItem[];
  motivations?: ClaimItem[];
  outcomes?: ClaimItem[];
  painProfile: string[];
  desireProfile: string[];
  objectionProfile: string[];
  motivationProfile: string[];
  estimatedPercentage: number;
  groundingRefs?: string[];
}

interface SegmentDensityItem extends EvidenceMeta {
  segment: string;
  densityScore: number;
  signalCount: number;
}

interface AdsTargetingHint extends EvidenceMeta {
  suggestedInterests: string[];
  suggestedBehaviors: string[];
  suggestedAgeRange: { min: number; max: number };
  suggestedGender: string;
  suggestedLocations: string[];
  rationale: string;
}

export interface StructuredSignalCluster {
  id: string;
  label: string;
  frequency: number;
  confidence: number;
  evidence: string[];
  sourceLayer: "surface" | "pattern" | "interpretation";
  /** audience-confidence-v2 provenance (optional — absent on pre-v2 snapshots). */
  evidenceCount?: number;
  sourceTypes?: string[];
  competitorIds?: string[];
  confidenceBreakdown?: ConfidenceBreakdownV2;
}

export interface CommercialAudienceSynthesis {
  selectedOffering: {
    offeringId: string;
    offeringName: string;
    variantName?: string;
    scope: string;
  };
  comparableCompetitors: Array<{
    competitorId: string;
    competitorName: string;
    productName?: string;
    productOrServiceName?: string;
    pricingContext?: string;
    pricingSummary?: string;
    evidenceReferences: string[];
    evidenceUids?: string[];
    strengthsSupportedByReviews: string[];
  }>;
  purchaseSituations: Array<{
    situation: string;
    context: string;
    suitability: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
  }>;
  offeringNeedFit: Array<{
    need: string;
    fitLevel: "DIRECT_FIT" | "STRATEGIC_FIT" | "NOT_FIT" | "UNKNOWN";
    supportedEvidence: string[];
    partialSupportReason?: string;
    unresolvedRequirements: string[];
  }>;
  packageScopeSuitability: {
    unitQuantityOrScope: string;
    suitabilityNotes: string;
    limitations: string[];
  };
  priceValueAnalysis: {
    pricePerception: string;
    comparabilityLimitations: string[];
    unknowns: string[];
  };
  proposedImprovements: Array<{
    improvement: string;
    status: "PROPOSED" | "EVALUATING" | "REJECTED";
    prerequisites: string[];
  }>;
  // Optional flat compatibility fields for ViewModel & consumer assertions
  selectedOfferingId?: string;
  selectedOfferingName?: string;
  selectedVariantName?: string;
  selectedVariantScope?: string;
  selectedVariantPricing?: { amount?: number; currency?: string } | null;
  reviewBackedStrengths?: Array<{
    competitorName: string;
    strength: string;
    sampleReviewSnippet?: string;
    reviewRating?: number;
    platform?: string;
  }>;
  offeringFitBreakdown?: Array<{
    need: string;
    fitType: string;
    provenClauses: string[];
    unresolvedRequirements: string[];
    prerequisites?: string[];
  }>;
  packageOrScopeSuitability?: {
    suitabilityVerdict: "SUITABLE" | "BORDERLINE" | "INSUFFICIENT_EVIDENCE";
    notes: string;
  };
  priceValueLimitations?: Array<{
    dimension: string;
    limitation: string;
    unknownFactor?: string;
  }>;
  proposedCapabilities?: Array<{
    capability: string;
    status: string;
    prerequisites: string[];
  }>;
}


export interface StructuredSignals {
  pain_clusters: StructuredSignalCluster[];
  desire_clusters: StructuredSignalCluster[];
  pattern_clusters: StructuredSignalCluster[];
  root_causes: StructuredSignalCluster[];
  psychological_drivers: StructuredSignalCluster[];
  /** Confidence model version used to score these signals (absent = v1). */
  confidence_model?: string;
  /** Phase 3 — Commercial Audience Synthesis */
  commercialAudienceSynthesis?: CommercialAudienceSynthesis;
}

// `PARTIAL` added: emitted when the engine
// produced usable output but signal coverage was below the qualifying
// threshold (or only some downstream maps populated). Distinct from
// INSUFFICIENT_SIGNALS (no usable output) and DEFENSIVE_MODE (low-trust).
// Downstream consumers (System Control, snapshot reuse) treat PARTIAL as
// "use with caution" — never as COMPLETE.
export type EngineStatus = "COMPLETE" | "PARTIAL" | "DATASET_TOO_SMALL" | "INSUFFICIENT_SIGNALS" | "DEFENSIVE_MODE" | "MISSING_DEPENDENCY" | "TARGET_AUDIENCE_EVIDENCE_GAP" | "INCOMPLETE";

export interface AudienceEngineV3Result {
  status: EngineStatus;
  statusMessage: string | null;
  /** Phase 4 — AI-proposal path telemetry emitted by the engine this run. */
  aiPathTelemetry?: EngineAiPathEmission;
  defensiveMode: boolean;
  languageSignals: LanguageSignals;
  painMap: SignalItem[];
  desireMap: SignalItem[];
  objectionMap: SignalItem[];
  transformationMap: SignalItem[];
  emotionalDrivers: SignalItem[];
  audienceSegments: AudienceSegment[];
  segmentDensity: SegmentDensityItem[];
  awarenessLevel: AwarenessResult;
  maturityIndex: MaturityResult;
  intentDistribution: IntentDistribution;
  adsTargetingHints: AdsTargetingHint[];
  structuredSignals: StructuredSignals;
  commercialAudienceSynthesis?: CommercialAudienceSynthesis;
  targetCoverage?: TargetCoverageResult;
  confidenceScore?: number;
  dataReliability?: any;
  inputSummary: {
    postsAnalyzed: number;
    commentsAnalyzed: number;
    competitorsAnalyzed: number;
    sanitizedCount: number;
    /** Confidence model version used for signal scoring (audience-confidence-v2+). */
    confidenceModel?: string;
    miSnapshotId: string | null;
    miSnapshotAge: string | null;
    semanticBridge?: {
      totalIngested: number;
      totalPassed: number;
      conflictsResolved: number;
      bridgeIntegrity: boolean;
      cleanPipeEnforced: boolean;
    };
  };
  engineVersion: number;
  executionTimeMs: number;
  snapshotId: string;
  evidenceUnits?: AudienceEvidenceUnit[];
  audienceSophistication?: import("./sophistication-llm").AudienceSophisticationOutput | null;
  buyerPsychologyProfile?: import("./buyer-psychology").BuyerPsychologyProfile | null;
  failureAttribution?: AudienceFailureAttribution;
  judgeDiagnostics?: AudienceJudgeDiagnosticEntry[];
}

export type AudienceFailureCategory =
  | "TECHNICAL_EXECUTION_FAILURE"
  | "JUDGE_CONTRACT_FAILURE"
  | "SEMANTIC_REJECTION"
  | "INSUFFICIENT_EVIDENCE"
  | "AUTHORITY_VACUUM";

export interface AudienceFailureAttribution {
  category: AudienceFailureCategory;
  retryBudgetExhausted: boolean;
  attemptsUsed: number;
  maxAttempts: number;
  errorCode?: string;
  diagnosticId?: string;
  summary: string;
}

export interface AudienceJudgeDiagnosticEntry {
  diagnosticId: string;
  timestamp: string;
  runId: string;
  accountId: string;
  campaignId?: string;
  offeringId?: string;
  traceId?: string;
  candidateFingerprint: string;
  attempt: number;
  maxAttempts: number;
  batchIndex: number;
  totalBatches: number;
  requestedEvaluationKeys: Array<{
    evaluationKey: string;
    canonicalClaimId: string;
    segmentId: string;
    claimType: string;
  }>;
  rawResponse: string;
  parsedResult: any;
  validationOutcome:
    | "PENDING_PARSE"
    | "PARSE_ERROR"
    | "CONTRACT_ERROR"
    | "VALID_PASS"
    | "VALID_WITH_COLLAPSED_EQUIVALENT_DUPLICATES"
    | "SEMANTIC_REJECTION";
  errorCode?: string;
  duplicateKeys: string[];
  collapsedEquivalentDuplicateKeys: string[];
  nonEquivalentDuplicateKeys: string[];
  contradictoryDuplicateKeys: string[];
  missingKeys: string[];
  unknownKeys: string[];
  wrongBatchKeys: string[];
  retryOrRepairDecision:
    | "PROCEED"
    | "COLLAPSE_EQUIVALENT_AND_PROCEED"
    | "TARGETED_JUDGE_BATCH_REPAIR"
    | "SEMANTIC_CANDIDATE_REPAIR"
    | "TERMINAL_CONTRACT_FAILURE"
    | "TERMINAL_SEMANTIC_FAILURE"
    | "TERMINAL_TECHNICAL_FAILURE";
  attemptCounts: {
    attempt: number;
    maxAttempts: number;
    technicalRetries: number;
  };
}

const MAX_AUDIENCE_JUDGE_DIAGNOSTICS = 200;
const audienceJudgeDiagnosticsStore: AudienceJudgeDiagnosticEntry[] = [];

export function redactDiagnosticText(raw: string): string {
  if (!raw || typeof raw !== "string") return "";
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_\-]{12,}\b/g, "sk-[REDACTED]")
    .replace(/("?(?:api[_-]?key|secret|token|password|authorization)"?\s*:\s*")[^"]+(")/gi, "$1[REDACTED]$2");
}

export function recordAudienceJudgeDiagnostic(
  entry: Omit<AudienceJudgeDiagnosticEntry, "diagnosticId" | "timestamp"> & {
    diagnosticId?: string;
    timestamp?: string;
  },
): AudienceJudgeDiagnosticEntry {
  const normalized: AudienceJudgeDiagnosticEntry = {
    ...entry,
    diagnosticId: entry.diagnosticId || `aud_jdiag_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: entry.timestamp || new Date().toISOString(),
    rawResponse: redactDiagnosticText(entry.rawResponse),
  };
  audienceJudgeDiagnosticsStore.push(normalized);
  if (audienceJudgeDiagnosticsStore.length > MAX_AUDIENCE_JUDGE_DIAGNOSTICS) {
    audienceJudgeDiagnosticsStore.splice(0, audienceJudgeDiagnosticsStore.length - MAX_AUDIENCE_JUDGE_DIAGNOSTICS);
  }
  return normalized;
}

export function getRecentAudienceJudgeDiagnostics(filter?: {
  accountId?: string;
  campaignId?: string;
  offeringId?: string;
  runId?: string;
}): AudienceJudgeDiagnosticEntry[] {
  return audienceJudgeDiagnosticsStore.filter((d) => {
    if (filter?.accountId && d.accountId !== filter.accountId) return false;
    if (filter?.campaignId && d.campaignId !== filter.campaignId) return false;
    if (filter?.offeringId && d.offeringId !== filter.offeringId) return false;
    if (filter?.runId && d.runId !== filter.runId) return false;
    return true;
  });
}

export function clearAudienceJudgeDiagnosticsForTest(): void {
  audienceJudgeDiagnosticsStore.length = 0;
}

function sanitizeTexts(texts: string[]): { clean: string[]; removed: number } {
  let removed = 0;
  const clean: string[] = [];
  for (const text of texts) {
    const lower = text.toLowerCase();
    let isSynthetic = false;
    for (const filter of SYNTHETIC_FILTERS) {
      if (lower.includes(filter)) {
        isSynthetic = true;
        removed++;
        break;
      }
    }
    if (!isSynthetic) {
      clean.push(text);
    }
  }
  return { clean, removed };
}

/** Item-preserving variant of sanitizeTexts — keeps competitor attribution attached to each text. */
function sanitizeTextItems<T extends { text: string }>(items: T[]): { clean: T[]; removed: number } {
  let removed = 0;
  const clean: T[] = [];
  for (const item of items) {
    const lower = item.text.toLowerCase();
    let isSynthetic = false;
    for (const filter of SYNTHETIC_FILTERS) {
      if (lower.includes(filter)) {
        isSynthetic = true;
        removed++;
        break;
      }
    }
    if (!isSynthetic) {
      clean.push(item);
    }
  }
  return { clean, removed };
}

type CommentQuality = "HIGH" | "MEDIUM" | "LOW" | "NOISE";

interface LabeledText {
  text: string;
  source: string;
  qualityWeight: number;
  /** Competitor whose content produced this text (audience-confidence-v2 spread + traceability). */
  competitorId?: string | null;
}

const EMOJI_ONLY_REGEX = /^[\p{Emoji}\p{Z}\s!?.,"']+$/u;
const SUBSTANTIVE_MARKER_REGEX = /\?|how|why|what|when|where|help|problem|issue|struggle|tried|can't|doesn't|not working|advice|question|difficult|challenge|frustrat|confus|overwhelm/i;

function classifyCommentQuality(text: string): CommentQuality {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  if (trimmed.length < 8) return "NOISE";
  if (EMOJI_ONLY_REGEX.test(trimmed)) return "NOISE";

  const isLowPhrase = (LOW_SIGNAL_COMMENT_PHRASES as readonly string[]).some(p =>
    lower.includes(p) && trimmed.length < 40
  );
  if (isLowPhrase) return "LOW";

  if (SUBSTANTIVE_MARKER_REGEX.test(lower)) return "HIGH";
  if (trimmed.length > 80) return "HIGH";
  if (trimmed.length > 30) return "MEDIUM";

  return "LOW";
}

interface SourcedTextItem {
  text: string;
  competitorId?: string | null;
}

function buildLabeledComments(comments: SourcedTextItem[]): {
  labeled: LabeledText[];
  noiseCount: number;
  lowCount: number;
  highCount: number;
  mediumCount: number;
} {
  const labeled: LabeledText[] = [];
  let noiseCount = 0;
  let lowCount = 0;
  let highCount = 0;
  let mediumCount = 0;

  for (const { text, competitorId } of comments) {
    const quality = classifyCommentQuality(text);
    if (quality === "NOISE") {
      noiseCount++;
      continue;
    }
    const qualityWeight =
      quality === "HIGH"
        ? COMMENT_QUALITY_WEIGHTS.HIGH
        : quality === "MEDIUM"
        ? COMMENT_QUALITY_WEIGHTS.MEDIUM
        : COMMENT_QUALITY_WEIGHTS.LOW;

    if (quality === "HIGH") highCount++;
    else if (quality === "MEDIUM") mediumCount++;
    else lowCount++;

    labeled.push({ text, source: "comment", qualityWeight, competitorId });
  }

  return { labeled, noiseCount, lowCount, highCount, mediumCount };
}

function buildLabeledCaptions(captions: SourcedTextItem[]): LabeledText[] {
  return captions.map(({ text, competitorId }) => ({ text, source: "caption", qualityWeight: SOURCE_QUALITY_WEIGHTS.CAPTION, competitorId }));
}

function buildLabeledReviews(reviews: SourcedTextItem[]): LabeledText[] {
  const labeled: LabeledText[] = [];
  for (const { text, competitorId } of reviews) {
    const quality = classifyCommentQuality(text);
    if (quality === "NOISE") continue;
    const baseWeight =
      quality === "HIGH"
        ? COMMENT_QUALITY_WEIGHTS.HIGH
        : quality === "MEDIUM"
        ? COMMENT_QUALITY_WEIGHTS.MEDIUM
        : COMMENT_QUALITY_WEIGHTS.LOW;
    labeled.push({ text, source: "review", qualityWeight: baseWeight * SOURCE_QUALITY_WEIGHTS.REVIEW, competitorId });
  }
  return labeled;
}

function buildLabeledTiktok(tiktokTexts: SourcedTextItem[]): LabeledText[] {
  return tiktokTexts
    .filter(t => t.text.trim().length >= 5)
    .map(({ text, competitorId }) => ({ text, source: "tiktok", qualityWeight: SOURCE_QUALITY_WEIGHTS.TIKTOK, competitorId }));
}

function computePrimaryDataStrength(
  labeledComments: LabeledText[],
  labeledCaptions: LabeledText[],
): number {
  const totalLabeled = labeledComments.length + labeledCaptions.length;
  if (totalLabeled === 0) return 0;

  const highQualityComments = labeledComments.filter(t => t.qualityWeight >= COMMENT_QUALITY_WEIGHTS.HIGH).length;
  const uniqueSources = new Set<string>();
  if (labeledComments.length > 0) uniqueSources.add("comment");
  if (labeledCaptions.length > 0) uniqueSources.add("caption");

  const volumeScore = Math.min(1, totalLabeled / 80);
  const qualityScore = labeledComments.length > 0
    ? Math.min(1, highQualityComments / Math.max(labeledComments.length, 1))
    : 0.4;
  const sourceScore = Math.min(1, uniqueSources.size / 2);
  const captionScore = Math.min(1, labeledCaptions.length / 20);

  return (
    volumeScore * 0.35 +
    qualityScore * 0.25 +
    sourceScore * 0.20 +
    captionScore * 0.20
  );
}

const MARKET_DETECTION_KEYWORDS: Record<MarketScope, string[]> = {
  fitness: ["workout", "exercise", "gym", "training", "muscle", "body", "weight loss", "bulk", "lean", "cardio", "تمرين", "رياضة", "جيم"],
  health: ["health", "nutrition", "diet", "wellness", "medical", "therapy", "condition", "صحة", "تغذية", "علاج"],
  marketing: ["marketing", "brand", "audience", "content", "social media", "ads", "campaign", "تسويق", "علامة تجارية"],
  ecommerce: ["store", "product", "shop", "buy", "sell", "ecommerce", "dropship", "متجر", "منتج"],
  education: ["course", "learn", "student", "teacher", "school", "education", "certificate", "تعليم", "دورة", "طالب"],
  finance: ["invest", "stock", "crypto", "money", "wealth", "trading", "portfolio", "استثمار", "مال"],
  tech: ["software", "app", "code", "developer", "startup", "saas", "tech", "تقنية", "برمجة"],
  beauty: ["beauty", "skin", "makeup", "cosmetic", "hair", "skincare", "جمال", "بشرة", "مكياج"],
  food: ["recipe", "cook", "restaurant", "food", "bake", "chef", "طبخ", "أكل", "مطعم"],
  universal: [],
};

interface MarketScopeMetadata {
  scopeConfidence: number;
  matchedKeywordDensity: number;
  scopeAmbiguityFlag: boolean;
}

function getMarketScopeMetadata(): MarketScopeMetadata {
  return { scopeConfidence: 0, matchedKeywordDensity: 0, scopeAmbiguityFlag: false };
}

function detectMarketScope(
  texts: string[],
  businessContext: { industry: string; coreOffer: string },
): { markets: MarketScope[]; metadata: MarketScopeMetadata } {
  const allText = [...texts.slice(0, 200), businessContext.industry, businessContext.coreOffer].join(" ").toLowerCase();
  const totalWords = allText.split(/\s+/).length || 1;
  const scores: Record<MarketScope, number> = {} as any;

  let totalKeywordMatches = 0;
  for (const [scope, keywords] of Object.entries(MARKET_DETECTION_KEYWORDS)) {
    if (scope === "universal") continue;
    let count = 0;
    for (const kw of keywords) {
      const regex = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      const matches = allText.match(regex);
      if (matches) count += matches.length;
    }
    scores[scope as MarketScope] = count;
    totalKeywordMatches += count;
  }

  const matchedKeywordDensity = Math.min(1, totalKeywordMatches / totalWords);

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]).filter(([, v]) => v > 0);
  if (sorted.length === 0) {
    return {
      markets: ["universal"],
      metadata: { scopeConfidence: 0, matchedKeywordDensity: 0, scopeAmbiguityFlag: false },
    };
  }

  const topScore = sorted[0][1];
  const secondScore = sorted[1]?.[1] || 0;

  const scopeAmbiguityFlag = secondScore > 0 && (topScore - secondScore) / topScore < 0.20;

  const separationFactor = secondScore > 0 ? (topScore - secondScore) / topScore : 1;
  const densityFactor = Math.min(1, totalKeywordMatches / 10);
  const scopeConfidence = Math.round(Math.min(1, Math.max(0, separationFactor * 0.5 + densityFactor * 0.5)) * 1000) / 1000;

  const detected = sorted.filter(([, v]) => v >= topScore * 0.3).map(([k]) => k as MarketScope);
  return {
    markets: detected.length > 0 ? detected : ["universal"],
    metadata: { scopeConfidence, matchedKeywordDensity, scopeAmbiguityFlag },
  };
}

function filterClustersByMarket(clusters: PatternCluster[], detectedMarkets: MarketScope[]): PatternCluster[] {
  return clusters.filter(cluster => {
    if (!cluster.marketScope) return true;
    if (detectedMarkets.includes("universal")) return true;
    return cluster.marketScope.some(s => detectedMarkets.includes(s));
  });
}

/**
 * Union audience-confidence-v2 provenance (sourceTypes/competitorIds) from
 * `source` into `target` when two signals are merged. The breakdown of the
 * surviving item is kept as-is (raw model output of the dominant signal);
 * spread/source scores are not recomputed post-merge.
 */
function mergeSignalProvenance(target: SignalItem, source: SignalItem): void {
  if (source.sourceTypes?.length) {
    target.sourceTypes = Array.from(new Set([...(target.sourceTypes ?? []), ...source.sourceTypes]));
  }
  if (source.competitorIds?.length) {
    target.competitorIds = Array.from(new Set([...(target.competitorIds ?? []), ...source.competitorIds]));
  }
}

function applyObjectionContextRules(
  objectionMap: SignalItem[],
  texts: string[],
): SignalItem[] {
  const allTextLower = texts.join(" ").toLowerCase();

  const result: SignalItem[] = [];
  const fallbackMerge = new Map<string, SignalItem>();

  for (const item of objectionMap) {
    const rule = OBJECTION_CONTEXT_RULES[item.canonical];
    if (!rule) {
      result.push(item);
      continue;
    }

    const hasContext = rule.requireKeywords.some(kw => allTextLower.includes(kw.toLowerCase()));
    if (hasContext) {
      result.push(item);
      continue;
    }

    const existing = fallbackMerge.get(rule.fallbackCanonical);
    if (existing) {
      existing.frequency += item.frequency;
      existing.evidenceCount += item.evidenceCount;
      existing.evidence = [...existing.evidence, ...item.evidence].slice(0, 3);
      existing.confidenceScore = Math.max(existing.confidenceScore, item.confidenceScore);
      mergeSignalProvenance(existing, item);
    } else {
      const existingInResult = result.find(r => r.canonical === rule.fallbackCanonical);
      if (existingInResult) {
        existingInResult.frequency += item.frequency;
        existingInResult.evidenceCount += item.evidenceCount;
        existingInResult.evidence = [...existingInResult.evidence, ...item.evidence].slice(0, 3);
        mergeSignalProvenance(existingInResult, item);
      } else {
        fallbackMerge.set(rule.fallbackCanonical, { ...item, canonical: rule.fallbackCanonical });
      }
    }
  }

  for (const [, merged] of fallbackMerge) {
    result.push(merged);
  }

  return result;
}

function buildNarrativeObjectionSignals(
  latestSnapshot: any,
  miSnapshotId: string | null,
): SignalItem[] {
  if (!latestSnapshot?.objectionMapData) return [];
  let miObjMap: any = null;
  try {
    miObjMap = typeof latestSnapshot.objectionMapData === "string"
      ? JSON.parse(latestSnapshot.objectionMapData)
      : latestSnapshot.objectionMapData;
  } catch { return []; }
  const narrativeObjections: any[] = Array.isArray(miObjMap?.objections) ? miObjMap.objections : [];
  if (narrativeObjections.length === 0) return [];

  const signals: SignalItem[] = [];
  for (const obj of narrativeObjections) {
    const canonical = typeof obj?.objection === "string" ? obj.objection.trim() : "";
    if (!canonical) continue;
    const supporting: any[] = Array.isArray(obj.supportingEvidence) ? obj.supportingEvidence : [];
    const competitorSources: string[] = Array.isArray(obj.competitorSources) ? obj.competitorSources : [];
    const evidenceTexts = supporting
      .map((e: any) => (typeof e?.caption === "string" ? e.caption.slice(0, 200) : ""))
      .filter((s: string) => s.length > 0)
      .slice(0, 3);
    const evidenceCount = Math.max(supporting.length, evidenceTexts.length);
    const frequency = Math.max(supporting.length, competitorSources.length, 1);
    const confidenceScore = typeof obj.narrativeConfidence === "number" ? obj.narrativeConfidence : 0.3;
    const matchedPatterns = supporting
      .map((e: any) => (typeof e?.matchedPattern === "string" ? `narrative:${e.matchedPattern}` : null))
      .filter((s: string | null): s is string => !!s)
      .slice(0, 5);
    signals.push({
      canonical,
      frequency,
      evidence: evidenceTexts,
      evidenceCount,
      confidenceScore,
      sourceSignals: ["narrative_objection_extractor", obj.signalType || "objection", obj.patternCategory || "unclassified", ...matchedPatterns],
      inputSnapshotId: miSnapshotId,
    });
  }
  return signals;
}

function mergeNarrativeObjectionsIntoMap(
  existing: SignalItem[],
  narrative: SignalItem[],
): { merged: SignalItem[]; added: number; reinforced: number } {
  if (narrative.length === 0) return { merged: existing, added: 0, reinforced: 0 };
  const byKey = new Map<string, SignalItem>();
  for (const s of existing) {
    byKey.set(s.canonical.toLowerCase(), { ...s });
  }
  let added = 0;
  let reinforced = 0;
  for (const narr of narrative) {
    const key = narr.canonical.toLowerCase();
    const prev = byKey.get(key);
    if (prev) {
      prev.frequency += narr.frequency;
      prev.evidenceCount += narr.evidenceCount;
      for (const ev of narr.evidence) {
        if (prev.evidence.length < 3 && !prev.evidence.includes(ev)) prev.evidence.push(ev);
      }
      prev.confidenceScore = Math.max(prev.confidenceScore, narr.confidenceScore);
      for (const src of narr.sourceSignals) {
        if (!prev.sourceSignals.includes(src)) prev.sourceSignals.push(src);
      }
      reinforced++;
    } else {
      byKey.set(key, { ...narr });
      added++;
    }
  }
  const merged = Array.from(byKey.values()).sort((a, b) => b.confidenceScore - a.confidenceScore);
  return { merged, added, reinforced };
}

function applyEvidenceIntegrityFilter(signals: SignalItem[]): SignalItem[] {
  return signals.filter(s => s.evidenceCount >= MIN_EVIDENCE_PER_SIGNAL && s.frequency >= MIN_EVIDENCE_PER_SIGNAL);
}

function inferPainsFromObjections(objectionMap: SignalItem[], inputSnapshotId: string | null): SignalItem[] {
  const inferred: SignalItem[] = [];
  for (const obj of objectionMap) {
    // Competitor-authored motivational captions from narrative_objection_extractor
    // must not be converted into synthetic customer pains unless corroborated by customer voice.
    if (
      Array.isArray(obj.sourceSignals) &&
      obj.sourceSignals.length > 0 &&
      obj.sourceSignals.every(s => s === "narrative_objection_extractor" || s === "competitor_caption")
    ) {
      continue;
    }
    const painCanonical = `Problem behind objection: ${obj.canonical}`;
    const derivedConfidence = obj.confidenceScore * 0.6;
    inferred.push({
      canonical: painCanonical,
      frequency: Math.max(1, Math.round(obj.frequency * 0.7)),
      evidence: obj.evidence.slice(0, 2),
      evidenceCount: Math.max(1, Math.round(obj.evidenceCount * 0.7)),
      // no 0.1 floor — inferred confidence is a strict multiple of the
      // source objection's confidence. If the source is zero, the inference is zero.
      confidenceScore: derivedConfidence,
      sourceSignals: [...obj.sourceSignals, "inferred_from_objection"],
      inputSnapshotId,
      // audience-confidence-v2 provenance — inherited from the source objection;
      // finalConfidence reflects the documented ×0.6 derivation scaling.
      sourceTypes: obj.sourceTypes,
      competitorIds: obj.competitorIds,
      confidenceBreakdown: obj.confidenceBreakdown
        ? { ...obj.confidenceBreakdown, finalConfidence: Number(derivedConfidence.toFixed(4)) }
        : undefined,
    });
  }
  return inferred;
}

function inferPainsFromEmotionalDrivers(drivers: SignalItem[], inputSnapshotId: string | null): SignalItem[] {
  // Constitutional Invariant: Dynamic semantic reasoner & judge must determine pains from real evidence.
  // Deterministic fallbacks synthesizing "Unresolved need: ..." are strictly retired.
  return [];
}

function mergePainLayers(
  directPains: SignalItem[],
  objectionInferred: SignalItem[],
  driverInferred: SignalItem[],
  bridgePains: SignalItem[],
): { finalPainMap: SignalItem[]; painSources: { direct: number; objectionInferred: number; driverInferred: number; bridge: number } } {
  const seen = new Set<string>();
  const final: SignalItem[] = [];

  for (const p of directPains) {
    seen.add(p.canonical.toLowerCase());
    final.push(p);
  }

  for (const p of bridgePains) {
    const key = p.canonical.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      final.push(p);
    }
  }

  for (const p of objectionInferred) {
    const key = p.canonical.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      final.push(p);
    }
  }

  for (const p of driverInferred) {
    const key = p.canonical.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      final.push(p);
    }
  }

  final.sort((a, b) => b.confidenceScore - a.confidenceScore);

  return {
    finalPainMap: final,
    painSources: {
      direct: directPains.length,
      objectionInferred: objectionInferred.filter(p => final.includes(p)).length,
      driverInferred: driverInferred.filter(p => final.includes(p)).length,
      bridge: bridgePains.filter(p => final.includes(p)).length,
    },
  };
}

function computeSegmentSimilarity(segA: AudienceSegment, segB: AudienceSegment): number {
  const tokensA = new Set([
    ...segA.name.toLowerCase().split(/\s+/),
    ...segA.painProfile.map(p => p.toLowerCase()),
    ...segA.desireProfile.map(d => d.toLowerCase()),
    ...(segA.objectionProfile || []).map(o => o.toLowerCase()),
    ...(segA.motivationProfile || []).map(m => m.toLowerCase()),
  ]);
  const tokensB = new Set([
    ...segB.name.toLowerCase().split(/\s+/),
    ...segB.painProfile.map(p => p.toLowerCase()),
    ...segB.desireProfile.map(d => d.toLowerCase()),
    ...(segB.objectionProfile || []).map(o => o.toLowerCase()),
    ...(segB.motivationProfile || []).map(m => m.toLowerCase()),
  ]);

  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }
  const union = new Set([...tokensA, ...tokensB]).size;
  return union > 0 ? intersection / union : 0;
}

function canonicalizeSegments(segments: AudienceSegment[]): AudienceSegment[] {
  if (segments.length <= 1) return segments;

  const SIMILARITY_THRESHOLD = 0.80;
  const MAX_SEGMENTS = 4;

  const merged: AudienceSegment[] = [];
  const used = new Set<number>();

  for (let i = 0; i < segments.length; i++) {
    if (used.has(i)) continue;

    let canonical = { ...segments[i] };
    const mergeGroup = [segments[i]];

    for (let j = i + 1; j < segments.length; j++) {
      if (used.has(j)) continue;
      const similarity = computeSegmentSimilarity(canonical, segments[j]);
      if (similarity >= SIMILARITY_THRESHOLD) {
        mergeGroup.push(segments[j]);
        used.add(j);
      }
    }

    if (mergeGroup.length > 1) {
      const best = mergeGroup.sort((a, b) => (b.estimatedPercentage || 0) - (a.estimatedPercentage || 0))[0];
      const combinedPercentage = mergeGroup.reduce((s, seg) => s + (seg.estimatedPercentage || 0), 0);
      const allPains = [...new Set(mergeGroup.flatMap(s => s.painProfile))];
      const allDesires = [...new Set(mergeGroup.flatMap(s => s.desireProfile))];
      const allObjections = [...new Set(mergeGroup.flatMap(s => s.objectionProfile || []))];
      const allMotivations = [...new Set(mergeGroup.flatMap(s => s.motivationProfile || []))];
      const allSourceSignals = [...new Set(mergeGroup.flatMap(s => s.sourceSignals || []))];
      const totalEvidence = mergeGroup.reduce((s, seg) => s + (seg.evidenceCount || 0), 0);
      const allClaimPains = mergeGroup.flatMap(s => s.pains || []);
      const allClaimDesires = mergeGroup.flatMap(s => s.desires || []);
      const allClaimObjections = mergeGroup.flatMap(s => s.objections || []);
      const allClaimMotivations = mergeGroup.flatMap(s => s.motivations || []);
      const allClaimOutcomes = mergeGroup.flatMap(s => s.outcomes || []);

      canonical = {
        ...best,
        pains: allClaimPains.length > 0 ? allClaimPains : best.pains,
        desires: allClaimDesires.length > 0 ? allClaimDesires : best.desires,
        objections: allClaimObjections.length > 0 ? allClaimObjections : best.objections,
        motivations: allClaimMotivations.length > 0 ? allClaimMotivations : best.motivations,
        outcomes: allClaimOutcomes.length > 0 ? allClaimOutcomes : best.outcomes,
        roleClaim: best.roleClaim,
        segmentDefinition: best.segmentDefinition,
        estimatedPercentage: combinedPercentage,
        painProfile: allPains,
        desireProfile: allDesires,
        objectionProfile: allObjections,
        motivationProfile: allMotivations,
        evidenceCount: totalEvidence,
        confidenceScore: Math.min(0.95, (best.confidenceScore || 0.5) + mergeGroup.length * 0.05),
        sourceSignals: allSourceSignals,
      };
    }

    merged.push(canonical);
    used.add(i);
  }

  if (merged.length <= MAX_SEGMENTS) return merged;

  const sorted = merged.sort((a, b) => (b.estimatedPercentage || 0) - (a.estimatedPercentage || 0));
  const kept = sorted.slice(0, MAX_SEGMENTS - 1);
  const overflow = sorted.slice(MAX_SEGMENTS - 1);

  const overflowPercentage = overflow.reduce((s, seg) => s + (seg.estimatedPercentage || 0), 0);
  const overflowEvidence = overflow.reduce((s, seg) => s + (seg.evidenceCount || 0), 0);

  kept.push({
    name: "Secondary Segment Cluster",
    description: `Merged cluster of ${overflow.length} smaller audience segments`,
    painProfile: [...new Set(overflow.flatMap(s => s.painProfile).slice(0, 5))],
    desireProfile: [...new Set(overflow.flatMap(s => s.desireProfile).slice(0, 5))],
    objectionProfile: [...new Set(overflow.flatMap(s => s.objectionProfile || []).slice(0, 3))],
    motivationProfile: [...new Set(overflow.flatMap(s => s.motivationProfile || []).slice(0, 3))],
    estimatedPercentage: overflowPercentage,
    evidenceCount: overflowEvidence,
    confidenceScore: 0.3,
    sourceSignals: ["merged-overflow"],
    inputSnapshotId: overflow[0]?.inputSnapshotId || null,
  });

  return kept;
}

/**
 * audience-confidence-v1 — HISTORICAL, retained for audit/comparison only.
 * No production call sites remain (superseded by computeCalibratedConfidenceV2
 * in P-6.8). v1 penalized campaigns for lacking source types they were never
 * designed to have (MAX_EXPECTED_SOURCE_TYPES = 5 vs. the 2 primary sources)
 * and required a signal to match 10% of the corpus for full frequency score.
 */
export function computeCalibratedConfidence(
  frequency: number,
  totalTexts: number,
  sourceTypes: string[],
  competitorCount: number,
): number {
  const freqScore = totalTexts > 0 ? Math.min(1, frequency / Math.max(totalTexts * 0.1, 1)) : 0;
  const diversityScore = Math.min(1, sourceTypes.length / MAX_EXPECTED_SOURCE_TYPES);
  const competitorScore = Math.min(1, competitorCount / MI_COST_LIMITS.MAX_COMPETITORS);

  const raw =
    freqScore * CONFIDENCE_WEIGHTS.SIGNAL_FREQUENCY +
    diversityScore * CONFIDENCE_WEIGHTS.SOURCE_DIVERSITY +
    competitorScore * CONFIDENCE_WEIGHTS.COMPETITOR_OVERLAP;

  return Math.min(0.95, Math.max(0.05, raw));
}

/** Normalizes legacy plural source labels to the canonical singular form. */
const SOURCE_TYPE_ALIASES: Record<string, string> = {
  comments: "comment",
  captions: "caption",
  reviews: "review",
  tiktoks: "tiktok",
};

export interface ConfidenceV2Input {
  /** Quality-weighted occurrence count of the signal. */
  weightedFrequency: number;
  /** Quality-weighted size of the analyzed corpus. */
  totalWeightedTexts: number;
  /** Source types that evidenced the signal (caption/comment/review/tiktok/...). */
  sourceTypes: string[];
  /** Total competitors in the campaign inventory. */
  competitorCount: number;
  /** Distinct competitors whose content evidenced this signal. */
  distinctCompetitors: number;
}

/**
 * audience-confidence-v2 (P-6.8).
 * Primary evidence = caption + comment (Avyron's designed evidence
 * architecture — same principle as computePrimaryDataStrength). Optional
 * sources (review, tiktok, MI bridge, website) add a corroboration bonus but
 * are never required to reach base confidence.
 *
 *  - frequencyScore:       saturating w/(w+k) — meaningful repetition, not corpus domination
 *  - primarySourceScore:   primary source types hit / 2 (caption-only or comment-only = 0.5)
 *  - competitorSpreadScore: distinct evidencing competitors vs ~30% of the inventory
 *  - corroborationBonus:   +0.05 per optional source type, capped at +0.10
 */
export function computeCalibratedConfidenceV2(input: ConfidenceV2Input): ConfidenceBreakdownV2 {
  const { weightedFrequency, totalWeightedTexts, competitorCount, distinctCompetitors } = input;
  const sourceTypes = input.sourceTypes.map(s => SOURCE_TYPE_ALIASES[s] ?? s);

  const halfSaturation = Math.max(
    FREQ_SATURATION_V2.MIN_HALF_SATURATION,
    totalWeightedTexts * FREQ_SATURATION_V2.CORPUS_FRACTION,
  );
  const frequencyScore = totalWeightedTexts > 0 && weightedFrequency > 0
    ? weightedFrequency / (weightedFrequency + halfSaturation)
    : 0;

  const primaryHits = PRIMARY_EVIDENCE_SOURCES.filter(s => sourceTypes.includes(s)).length;
  const primarySourceScore = Math.min(1, primaryHits / PRIMARY_EVIDENCE_SOURCES.length);

  const spreadNorm = Math.max(
    COMPETITOR_SPREAD_V2.MIN_NORM,
    Math.ceil(competitorCount * COMPETITOR_SPREAD_V2.FRACTION),
  );
  const competitorSpreadScore = competitorCount > 0
    ? Math.min(1, distinctCompetitors / spreadNorm)
    : 0;

  const optionalHits = OPTIONAL_EVIDENCE_SOURCES.filter(s => sourceTypes.includes(s)).length;
  const corroborationBonus = Math.min(
    CORROBORATION_BONUS_V2.CAP,
    optionalHits * CORROBORATION_BONUS_V2.PER_SOURCE,
  );

  const raw =
    frequencyScore * CONFIDENCE_WEIGHTS_V2.SIGNAL_FREQUENCY +
    primarySourceScore * CONFIDENCE_WEIGHTS_V2.PRIMARY_SOURCE_COVERAGE +
    competitorSpreadScore * CONFIDENCE_WEIGHTS_V2.COMPETITOR_SPREAD +
    corroborationBonus;

  const finalConfidence = Math.min(0.95, Math.max(0.05, raw));

  return {
    model: AUDIENCE_CONFIDENCE_MODEL_VERSION,
    frequencyScore: Number(frequencyScore.toFixed(4)),
    primarySourceScore: Number(primarySourceScore.toFixed(4)),
    competitorSpreadScore: Number(competitorSpreadScore.toFixed(4)),
    corroborationBonus: Number(corroborationBonus.toFixed(4)),
    finalConfidence: Number(finalConfidence.toFixed(4)),
  };
}

function matchPatternClusters(
  labeledTexts: LabeledText[],
  clusters: PatternCluster[],
  inputSnapshotId: string | null,
  competitorCount: number,
): SignalItem[] {
  const results: Map<string, {
    weightedCount: number;
    rawCount: number;
    evidence: string[];
    matchedPatterns: Set<string>;
    hitSources: Set<string>;
    hitCompetitors: Set<string>;
  }> = new Map();

  for (const cluster of clusters) {
    results.set(cluster.canonical, {
      weightedCount: 0,
      rawCount: 0,
      evidence: [],
      matchedPatterns: new Set(),
      hitSources: new Set(),
      hitCompetitors: new Set(),
    });
  }

  const totalWeightedTexts = labeledTexts.reduce((sum, t) => sum + t.qualityWeight, 0);

  for (const { text, source, qualityWeight, competitorId } of labeledTexts) {
    const lower = text.toLowerCase();
    for (const cluster of clusters) {
      for (const pattern of cluster.patterns) {
        if (lower.includes(pattern)) {
          const entry = results.get(cluster.canonical)!;
          entry.weightedCount += qualityWeight;
          entry.rawCount++;
          entry.matchedPatterns.add(pattern);
          entry.hitSources.add(source);
          if (competitorId) entry.hitCompetitors.add(competitorId);
          if (entry.evidence.length < 3) {
            entry.evidence.push(text.slice(0, 150));
          }
          break;
        }
      }
    }
  }

  return Array.from(results.entries())
    .filter(([, v]) => v.rawCount > 0)
    .sort((a, b) => b[1].weightedCount - a[1].weightedCount)
    .map(([canonical, data]) => {
      const breakdown = computeCalibratedConfidenceV2({
        weightedFrequency: data.weightedCount,
        totalWeightedTexts,
        sourceTypes: Array.from(data.hitSources),
        competitorCount,
        distinctCompetitors: data.hitCompetitors.size,
      });
      return {
        canonical,
        frequency: Math.round(data.weightedCount),
        evidence: data.evidence,
        evidenceCount: data.rawCount,
        confidenceScore: breakdown.finalConfidence,
        sourceSignals: Array.from(data.matchedPatterns),
        inputSnapshotId,
        sourceTypes: Array.from(data.hitSources),
        competitorIds: Array.from(data.hitCompetitors),
        confidenceBreakdown: breakdown,
      };
    });
}

function analyzeLanguage(
  comments: string[],
  captions: string[],
  inputSnapshotId: string | null,
  competitorCount: number,
  reviews: string[] = [],
  tiktokTexts: string[] = [],
): LanguageSignals {
  const allText = [...comments, ...captions, ...reviews, ...tiktokTexts];
  const result: LanguageSignals = {
    problemExpressions: { count: 0, samples: [] },
    questionPatterns: { count: 0, samples: [] },
    goalExpressions: { count: 0, samples: [] },
    totalAnalyzed: allText.length,
    evidenceCount: 0,
    confidenceScore: 0,
    sourceSignals: [],
    inputSnapshotId,
  };

  for (const text of allText) {
    const lower = text.toLowerCase();

    for (const pattern of LANGUAGE_PATTERNS.PROBLEM_EXPRESSIONS) {
      if (lower.includes(pattern)) {
        result.problemExpressions.count++;
        if (result.problemExpressions.samples.length < 3) {
          result.problemExpressions.samples.push(text.slice(0, 120));
        }
        break;
      }
    }

    for (const pattern of LANGUAGE_PATTERNS.QUESTION_PATTERNS) {
      if (lower.includes(pattern)) {
        result.questionPatterns.count++;
        if (result.questionPatterns.samples.length < 3) {
          result.questionPatterns.samples.push(text.slice(0, 120));
        }
        break;
      }
    }

    for (const pattern of LANGUAGE_PATTERNS.GOAL_EXPRESSIONS) {
      if (lower.includes(pattern)) {
        result.goalExpressions.count++;
        if (result.goalExpressions.samples.length < 3) {
          result.goalExpressions.samples.push(text.slice(0, 120));
        }
        break;
      }
    }
  }

  const total = result.problemExpressions.count + result.questionPatterns.count + result.goalExpressions.count;
  result.evidenceCount = total;
  const sourceTypes = [];
  if (comments.length > 0) sourceTypes.push("comments");
  if (captions.length > 0) sourceTypes.push("captions");
  if (reviews.length > 0) sourceTypes.push("reviews");
  if (tiktokTexts.length > 0) sourceTypes.push("tiktok");
  result.confidenceScore = computeCalibratedConfidenceV2({
    weightedFrequency: total,
    totalWeightedTexts: allText.length,
    sourceTypes,
    competitorCount,
    distinctCompetitors: competitorCount,
  }).finalConfidence;
  result.sourceSignals = sourceTypes;

  return result;
}

function detectAwareness(
  comments: string[],
  inputSnapshotId: string | null,
  competitorCount: number,
  miObjectionDensity: number = 0,
  miObjectionCount: number = 0,
): AwarenessResult {
  const distribution: Record<string, number> = {
    unaware: 0,
    problem_aware: 0,
    solution_aware: 0,
    product_aware: 0,
    most_aware: 0,
  };

  const levelKeys: [string, readonly string[]][] = [
    ["most_aware", AWARENESS_PATTERNS.MOST_AWARE],
    ["product_aware", AWARENESS_PATTERNS.PRODUCT_AWARE],
    ["solution_aware", AWARENESS_PATTERNS.SOLUTION_AWARE],
    ["problem_aware", AWARENESS_PATTERNS.PROBLEM_AWARE],
    ["unaware", AWARENESS_PATTERNS.UNAWARE],
  ];

  let totalMatched = 0;

  for (const text of comments) {
    const lower = text.toLowerCase();
    let matched = false;
    for (const [level, patterns] of levelKeys) {
      for (const p of patterns) {
        if (lower.includes(p)) {
          distribution[level]++;
          totalMatched++;
          matched = true;
          break;
        }
      }
      if (matched) break;
    }
  }

  if (totalMatched < 3) {
    if (miObjectionCount >= 3 && miObjectionDensity > 0.1) {
      return {
        level: "problem_aware",
        distribution: { problem_aware: 100 },
        evidenceCount: miObjectionCount,
        confidenceScore: Math.min(miObjectionDensity + 0.1, 0.6),
        sourceSignals: ["mi_narrative_objections"],
        inputSnapshotId,
      };
    }
    return {
      level: "insufficient_signals",
      distribution: {},
      evidenceCount: totalMatched,
      confidenceScore: 0,
      sourceSignals: ["comments"],
      inputSnapshotId,
    };
  }

  let dominantLevel = "problem_aware";
  let maxCount = 0;
  for (const [level, count] of Object.entries(distribution)) {
    if (count > maxCount) {
      maxCount = count;
      dominantLevel = level;
    }
  }

  if (dominantLevel === "unaware" && miObjectionCount >= 3 && miObjectionDensity > 0.15) {
    const problemAwareCount = distribution["problem_aware"] || 0;
    const solutionAwareCount = distribution["solution_aware"] || 0;
    if (solutionAwareCount > problemAwareCount && solutionAwareCount > 0) {
      dominantLevel = "solution_aware";
    } else {
      dominantLevel = "problem_aware";
    }
    console.log(`[AudienceEngine-V3] OBJECTION_DENSITY_OVERRIDE | miObjections=${miObjectionCount} | density=${miObjectionDensity} | overrideFrom=unaware | overrideTo=${dominantLevel}`);
  }

  const pct: Record<string, number> = {};
  for (const [level, count] of Object.entries(distribution)) {
    pct[level] = Math.round((count / totalMatched) * 100);
  }

  return {
    level: dominantLevel as AwarenessResult["level"],
    distribution: pct,
    evidenceCount: totalMatched,
    confidenceScore: computeCalibratedConfidenceV2({
      weightedFrequency: totalMatched,
      totalWeightedTexts: comments.length,
      sourceTypes: ["comment"],
      competitorCount,
      distinctCompetitors: competitorCount,
    }).finalConfidence,
    sourceSignals: ["comments"],
    inputSnapshotId,
  };
}

function detectMaturity(
  comments: string[],
  captions: string[],
  inputSnapshotId: string | null,
  competitorCount: number,
): MaturityResult {
  const allText = [...comments, ...captions];
  const signals = { beginner: 0, developing: 0, mature: 0 };
  const indicators: string[] = [];

  for (const text of allText) {
    const lower = text.toLowerCase();

    for (const kw of MATURITY_KEYWORDS.MATURE) {
      if (lower.includes(kw)) {
        signals.mature++;
        if (indicators.length < 5) indicators.push(kw);
        break;
      }
    }
    for (const kw of MATURITY_KEYWORDS.DEVELOPING) {
      if (lower.includes(kw)) { signals.developing++; break; }
    }
    for (const kw of MATURITY_KEYWORDS.BEGINNER) {
      if (lower.includes(kw)) { signals.beginner++; break; }
    }
  }

  const total = signals.beginner + signals.developing + signals.mature;

  if (total < 3) {
    return {
      level: "insufficient_signals",
      distribution: {},
      indicators: [],
      evidenceCount: total,
      confidenceScore: 0,
      sourceSignals: ["comments", "captions"],
      inputSnapshotId,
    };
  }

  const dist: Record<string, number> = {
    beginner: Math.round((signals.beginner / total) * 100),
    developing: Math.round((signals.developing / total) * 100),
    mature: Math.round((signals.mature / total) * 100),
  };

  let level: "beginner" | "developing" | "mature" = "beginner";
  if (signals.mature > signals.developing && signals.mature > signals.beginner) level = "mature";
  else if (signals.developing > signals.beginner) level = "developing";

  const sourceTypes = [];
  if (comments.length > 0) sourceTypes.push("comments");
  if (captions.length > 0) sourceTypes.push("captions");

  return {
    level,
    distribution: dist,
    indicators,
    evidenceCount: total,
    confidenceScore: computeCalibratedConfidenceV2({
      weightedFrequency: total,
      totalWeightedTexts: allText.length,
      sourceTypes,
      competitorCount,
      distinctCompetitors: competitorCount,
    }).finalConfidence,
    sourceSignals: sourceTypes,
    inputSnapshotId,
  };
}

function classifyIntents(
  comments: string[],
  inputSnapshotId: string | null,
  competitorCount: number,
): IntentDistribution {
  let curiosity = 0;
  let learning = 0;
  let comparison = 0;
  let purchaseIntent = 0;
  let totalClassified = 0;

  for (const text of comments) {
    const lower = text.toLowerCase();
    let classified = false;

    for (const kw of INTENT_KEYWORDS.PURCHASE_INTENT) {
      if (lower.includes(kw)) { purchaseIntent++; classified = true; break; }
    }
    if (!classified) {
      for (const kw of INTENT_KEYWORDS.COMPARISON) {
        if (lower.includes(kw)) { comparison++; classified = true; break; }
      }
    }
    if (!classified) {
      for (const kw of INTENT_KEYWORDS.LEARNING) {
        if (lower.includes(kw)) { learning++; classified = true; break; }
      }
    }
    if (!classified) {
      for (const kw of INTENT_KEYWORDS.CURIOSITY) {
        if (lower.includes(kw)) { curiosity++; classified = true; break; }
      }
    }
    if (classified) totalClassified++;
  }

  if (totalClassified === 0) {
    return {
      curiosity: 0, learning: 0, comparison: 0, purchaseIntent: 0,
      totalClassified: 0,
      evidenceCount: 0,
      confidenceScore: 0,
      sourceSignals: ["comments"],
      inputSnapshotId,
    };
  }

  return {
    curiosity: Math.round((curiosity / totalClassified) * 100),
    learning: Math.round((learning / totalClassified) * 100),
    comparison: Math.round((comparison / totalClassified) * 100),
    purchaseIntent: Math.round((purchaseIntent / totalClassified) * 100),
    totalClassified,
    evidenceCount: totalClassified,
    confidenceScore: computeCalibratedConfidenceV2({
      weightedFrequency: totalClassified,
      totalWeightedTexts: comments.length,
      sourceTypes: ["comment"],
      competitorCount,
      distinctCompetitors: competitorCount,
    }).finalConfidence,
    sourceSignals: ["comments"],
    inputSnapshotId,
  };
}

type IntentTemperature = "cold" | "warm" | "hot" | "very_hot";

function deriveIntentTemperature(intentDist: IntentDistribution): IntentTemperature {
  if (intentDist.totalClassified === 0) return "cold";

  const weighted =
    intentDist.curiosity * 0.1 +
    intentDist.learning * 0.3 +
    intentDist.comparison * 0.6 +
    intentDist.purchaseIntent * 1.0;

  const normalizedTemp = weighted / 100;

  if (normalizedTemp >= 0.55) return "very_hot";
  if (normalizedTemp >= 0.35) return "hot";
  if (normalizedTemp >= 0.20) return "warm";
  return "cold";
}

function computeSegmentDensity(
  painMap: SignalItem[],
  desireMap: SignalItem[],
  segments: AudienceSegment[],
  inputSnapshotId: string | null,
): SegmentDensityItem[] {
  const totalSignals = painMap.reduce((s, p) => s + p.frequency, 0) + desireMap.reduce((s, d) => s + d.frequency, 0);

  const rawDensities = segments.map(seg => {
    let signalCount = 0;
    for (const pain of painMap) {
      if (seg.painProfile.some(p => pain.canonical.toLowerCase().includes(p.toLowerCase()))) {
        signalCount += pain.frequency;
      }
    }
    for (const desire of desireMap) {
      if (seg.desireProfile.some(d => desire.canonical.toLowerCase().includes(d.toLowerCase()))) {
        signalCount += desire.frequency;
      }
    }
    return { segment: seg.name, signalCount };
  });

  const rawTotal = rawDensities.reduce((s, d) => s + d.signalCount, 0);

  const items = rawDensities.map(d => ({
    segment: d.segment,
    rawDensity: rawTotal > 0 ? (d.signalCount / rawTotal) * 100 : 0,
    signalCount: d.signalCount,
  }));

  const floored = items.map(d => ({ ...d, densityScore: Math.floor(d.rawDensity) }));
  let remainder = 100 - floored.reduce((s, d) => s + d.densityScore, 0);
  const sorted = floored.map((d, i) => ({ ...d, idx: i, frac: d.rawDensity - d.densityScore }))
    .sort((a, b) => b.frac - a.frac);
  for (const item of sorted) {
    if (remainder <= 0) break;
    floored[item.idx].densityScore += 1;
    remainder--;
  }

  return floored.map(d => ({
    segment: d.segment,
    densityScore: rawTotal > 0 ? d.densityScore : 0,
    signalCount: d.signalCount,
    evidenceCount: d.signalCount,
    confidenceScore: rawTotal > 0 ? Math.min(0.95, d.signalCount / rawTotal) : 0,
    sourceSignals: ["painMap", "desireMap"],
    inputSnapshotId,
  }));
}

const ClaimWithIdSchema = z.object({
  claimId: z.string().min(1),
  canonicalClaimId: z.string().optional(),
  derivedFromPainId: z.string().optional(),
  sourcePainId: z.string().optional(),
  claim: z.string().min(1),
  evidenceIds: z.array(z.string()).default([]),
});

const RoleClaimSchema = z.object({
  claimId: z.string().default("role_claim"),
  value: z.enum(["END_CONSUMER", "BUYER", "PRACTITIONER", "BUSINESS_OWNER", "PROCUREMENT", "RESELLER", "SUPPLIER", "UNKNOWN"]).default("UNKNOWN"),
  evidenceIds: z.array(z.string()).default([]),
});

const SegmentDefinitionSchema = z.object({
  claimId: z.string().default("segment_def"),
  claim: z.string().min(1),
  evidenceIds: z.array(z.string()).default([]),
});

const SegmentCandidateSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  segmentDefinition: SegmentDefinitionSchema.optional(),
  role: z.union([
    RoleClaimSchema,
    z.enum(["END_CONSUMER", "BUYER", "PRACTITIONER", "BUSINESS_OWNER", "PROCUREMENT", "RESELLER", "SUPPLIER", "UNKNOWN"])
  ]),
  description: z.string().min(1),
  pains: z.array(z.union([ClaimWithIdSchema, z.string()])).default([]),
  desires: z.array(z.union([ClaimWithIdSchema, z.string()])).optional().default([]),
  objections: z.array(z.union([ClaimWithIdSchema, z.string()])).optional().default([]),
  motivations: z.array(z.union([ClaimWithIdSchema, z.string()])).optional().default([]),
  outcomes: z.array(z.union([ClaimWithIdSchema, z.string()])).optional().default([]),
  painProfile: z.array(z.string()).optional().default([]),
  desireProfile: z.array(z.string()).optional().default([]),
  objectionProfile: z.array(z.string()).optional().default([]),
  motivationProfile: z.array(z.string()).optional().default([]),
  estimatedPercentage: z.coerce.number().catch(0),
  groundingRefs: groundingRefsSchema,
});
const SegmentArraySchema = z.array(SegmentCandidateSchema);

export function normalizeSegmentCandidate(seg: any, segIndex: number) {
  const canonicalId = seg.id || `seg_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const segPrefix = `seg_${segIndex + 1}`;
  
  const segmentDef: SegmentDefinitionClaim = seg.segmentDefinition && typeof seg.segmentDefinition === "object"
    ? {
        claimId: seg.segmentDefinition.claimId || `${segPrefix}_def`,
        claim: seg.segmentDefinition.claim || seg.description || seg.name,
        evidenceIds: Array.isArray(seg.segmentDefinition.evidenceIds) && seg.segmentDefinition.evidenceIds.length > 0 ? seg.segmentDefinition.evidenceIds : (Array.isArray(seg.groundingRefs) ? seg.groundingRefs : []),
      }
    : {
        claimId: `${segPrefix}_def`,
        claim: seg.description || seg.name,
        evidenceIds: Array.isArray(seg.groundingRefs) ? seg.groundingRefs : [],
      };

  const roleObj: RoleClaim = typeof seg.role === "object" && seg.role !== null
    ? {
        claimId: seg.role.claimId || `${segPrefix}_role`,
        value: seg.role.value || "UNKNOWN",
        evidenceIds: Array.isArray(seg.role.evidenceIds) && seg.role.evidenceIds.length > 0 ? seg.role.evidenceIds : (Array.isArray(seg.groundingRefs) ? seg.groundingRefs : []),
      }
    : {
        claimId: `${segPrefix}_role`,
        value: typeof seg.role === "string" ? seg.role : "UNKNOWN",
        evidenceIds: Array.isArray(seg.groundingRefs) ? seg.groundingRefs : [],
      };

  const normalizeClaimList = (list: any[], fieldName: string): ClaimItem[] => {
    if (!Array.isArray(list)) return [];
    return list.map((item, idx) => {
      const claimText = typeof item === "object" && item !== null
        ? (item.claim || item.text || item.canonical || item.label)
        : null;
      if (typeof item === "object" && item !== null && claimText) {
        const resolvedClaimId = item.claimId || `${segPrefix}_${fieldName}_${idx + 1}`;
        const derivedPain = item.derivedFromPainId || item.sourcePainId || undefined;
        const explicitEvIds = Array.isArray(item.evidenceIds)
          ? item.evidenceIds
          : Array.isArray(item.evidenceUids)
            ? item.evidenceUids
            : null;
        return {
          claimId: resolvedClaimId,
          ...(item.canonicalClaimId
            ? { canonicalClaimId: item.canonicalClaimId }
            : fieldName === "pain"
              ? { canonicalClaimId: resolvedClaimId }
              : {}),
          ...(derivedPain ? { derivedFromPainId: derivedPain, sourcePainId: item.sourcePainId || derivedPain } : {}),
          claim: String(claimText),
          // Never assign arbitrary segment-level groundingRefs to a pain claim without explicit pain evidenceIds
          evidenceIds: explicitEvIds !== null
            ? explicitEvIds
            : fieldName === "pain"
              ? []
              : (Array.isArray(seg.groundingRefs) ? seg.groundingRefs : []),
        };
      }
      const fallbackId = `${segPrefix}_${fieldName}_${idx + 1}`;
      return {
        claimId: fallbackId,
        ...(fieldName === "pain" ? { canonicalClaimId: fallbackId } : {}),
        claim: String(item),
        evidenceIds: fieldName === "pain" ? [] : (Array.isArray(seg.groundingRefs) ? seg.groundingRefs : []),
      };
    });
  };

  const pains = normalizeClaimList(seg.pains && seg.pains.length > 0 ? seg.pains : (seg.painProfile || []), "pain");
  const desires = normalizeClaimList(seg.desires && seg.desires.length > 0 ? seg.desires : (seg.desireProfile || []), "desire");
  const objections = normalizeClaimList(seg.objections && seg.objections.length > 0 ? seg.objections : (seg.objectionProfile || []), "objection");
  const motivations = normalizeClaimList(seg.motivations && seg.motivations.length > 0 ? seg.motivations : (seg.motivationProfile || []), "motivation");
  const outcomes = normalizeClaimList(seg.outcomes || [], "outcome");

  const allRefs = Array.from(new Set([
    ...segmentDef.evidenceIds,
    ...roleObj.evidenceIds,
    ...pains.flatMap(p => p.evidenceIds),
    ...desires.flatMap(d => d.evidenceIds),
    ...objections.flatMap(o => o.evidenceIds),
    ...motivations.flatMap(m => m.evidenceIds),
    ...outcomes.flatMap(oc => oc.evidenceIds),
    ...(Array.isArray(seg.groundingRefs) ? seg.groundingRefs : []),
  ])).filter(Boolean);

  return {
    id: canonicalId,
    name: seg.name,
    segmentDefinition: segmentDef,
    role: roleObj.value,
    roleClaim: roleObj,
    description: seg.description || segmentDef.claim,
    pains,
    desires,
    objections,
    motivations,
    outcomes,
    painProfile: pains.map(p => p.claim),
    desireProfile: desires.map(d => d.claim),
    objectionProfile: objections.map(o => o.claim),
    motivationProfile: motivations.map(m => m.claim),
    estimatedPercentage: seg.estimatedPercentage || 0,
    groundingRefs: allRefs,
  };
}

function normalizeClaimTextForIdentity(text: unknown): string {
  return String(text ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeEvidenceIdsForIdentity(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  return Array.from(new Set(ids.map((x) => String(x ?? "").trim()).filter(Boolean))).sort();
}

function areEvidenceIdsEquivalent(a: unknown, b: unknown): boolean {
  const normA = normalizeEvidenceIdsForIdentity(a);
  const normB = normalizeEvidenceIdsForIdentity(b);
  if (normA.length !== normB.length) return false;
  for (let i = 0; i < normA.length; i++) {
    if (normA[i] !== normB[i]) return false;
  }
  return true;
}

function refreshSegmentProfilesAndGrounding(seg: any): void {
  if (!seg || typeof seg !== "object") return;
  const pains = Array.isArray(seg.pains) ? seg.pains : [];
  const desires = Array.isArray(seg.desires) ? seg.desires : [];
  const objections = Array.isArray(seg.objections) ? seg.objections : [];
  const motivations = Array.isArray(seg.motivations) ? seg.motivations : [];
  const outcomes = Array.isArray(seg.outcomes) ? seg.outcomes : [];
  seg.painProfile = pains.map((p: any) => p.claim);
  seg.desireProfile = desires.map((d: any) => d.claim);
  seg.objectionProfile = objections.map((o: any) => o.claim);
  seg.motivationProfile = motivations.map((m: any) => m.claim);
  const segDefRefs = Array.isArray(seg.segmentDefinition?.evidenceIds) ? seg.segmentDefinition.evidenceIds : [];
  const roleRefs = Array.isArray(seg.roleClaim?.evidenceIds)
    ? seg.roleClaim.evidenceIds
    : Array.isArray(seg.role?.evidenceIds)
      ? seg.role.evidenceIds
      : [];
  seg.groundingRefs = Array.from(
    new Set([
      ...segDefRefs,
      ...roleRefs,
      ...pains.flatMap((p: any) => p.evidenceIds || []),
      ...desires.flatMap((d: any) => d.evidenceIds || []),
      ...objections.flatMap((o: any) => o.evidenceIds || []),
      ...motivations.flatMap((m: any) => m.evidenceIds || []),
      ...outcomes.flatMap((oc: any) => oc.evidenceIds || []),
      ...(Array.isArray(seg.groundingRefs) ? seg.groundingRefs : []),
    ]),
  ).filter(Boolean);
}

/**
 * Deterministic, idempotent grouping repair for discovered pains.
 * - Restores misplaced discovered pains (matching canonical ID, text, and evidenceIds) to pains
 *   and removes the accidental duplicate placement from non-pain lists.
 * - Adds genuinely missing discovered pains to their assigned segment.
 * - Preserves distinct objections derived from a pain (with derivedFromPainId / sourcePainId).
 */
export function applyGroupingRepairDeterministically(
  candidateSegments: any[],
  assignments: Array<{ claimId?: string; painId?: string; assignToSegmentIndex?: number; segmentIndex?: number }>,
  discoveredPains: Array<{ claimId?: string; id?: string; claim?: string; pain?: string; text?: string; evidenceIds: string[] }>,
): any[] & { segments: any[] } {
  const patchedSegments = JSON.parse(JSON.stringify(Array.isArray(candidateSegments) ? candidateSegments : []));
  Object.defineProperty(patchedSegments, "segments", {
    value: patchedSegments,
    enumerable: false,
    configurable: true,
  });
  if (patchedSegments.length === 0) return patchedSegments as any;

  const canonicalMap = new Map<string, { claimId: string; claim: string; evidenceIds: string[] }>();
  for (const dp of discoveredPains || []) {
    const cid = dp?.claimId || dp?.id;
    const text = dp?.claim || dp?.pain || dp?.text || "";
    if (cid) {
      canonicalMap.set(cid, {
        claimId: cid,
        claim: text,
        evidenceIds: Array.isArray(dp.evidenceIds) ? dp.evidenceIds : [],
      });
    }
  }

  const assignmentMap = new Map<string, number>();
  for (const assign of assignments || []) {
    const cid = assign?.claimId || assign?.painId;
    const idx =
      typeof assign?.assignToSegmentIndex === "number"
        ? assign.assignToSegmentIndex
        : typeof assign?.segmentIndex === "number"
          ? assign.segmentIndex
          : -1;
    if (cid && idx >= 0 && idx < patchedSegments.length) {
      assignmentMap.set(cid, idx);
    }
  }

  // 1. Scan non-pain lists across all segments for unambiguous misplaced discovered pains
  for (let sIdx = 0; sIdx < patchedSegments.length; sIdx++) {
    const seg = patchedSegments[sIdx];
    if (!Array.isArray(seg.pains)) seg.pains = [];

    for (const nonPainField of ["objections", "desires", "motivations", "outcomes"] as const) {
      if (!Array.isArray(seg[nonPainField])) continue;
      const retained: any[] = [];
      for (const item of seg[nonPainField]) {
        const itemCid = item?.canonicalClaimId || item?.claimId;
        const itemText = item?.claim || item?.text || "";
        const hasDerivedProvenance = Boolean(item?.derivedFromPainId || item?.sourcePainId);
        const canonicalPain = itemCid ? canonicalMap.get(itemCid) : undefined;

        if (
          canonicalPain &&
          !hasDerivedProvenance &&
          normalizeClaimTextForIdentity(itemText) === normalizeClaimTextForIdentity(canonicalPain.claim) &&
          areEvidenceIdsEquivalent(item?.evidenceIds, canonicalPain.evidenceIds)
        ) {
          // Unambiguous misplaced discovered pain: restore to target segment's pains and remove from nonPainField
          const targetIdx = assignmentMap.get(canonicalPain.claimId) ?? sIdx;
          const targetSeg = patchedSegments[targetIdx] || seg;
          if (!Array.isArray(targetSeg.pains)) targetSeg.pains = [];
          const alreadyInTarget = targetSeg.pains.some(
            (p: any) => (p?.canonicalClaimId || p?.claimId) === canonicalPain.claimId,
          );
          if (!alreadyInTarget) {
            targetSeg.pains.push({
              claimId: canonicalPain.claimId,
              canonicalClaimId: canonicalPain.claimId,
              claim: canonicalPain.claim,
              evidenceIds: [...canonicalPain.evidenceIds],
            });
          }
          continue;
        }
        retained.push(item);
      }
      seg[nonPainField] = retained;
    }
  }

  // 2. Apply explicit missing-pain assignments idempotently
  for (const [claimId, targetIdx] of assignmentMap.entries()) {
    const painToAssign = canonicalMap.get(claimId);
    const targetSeg = patchedSegments[targetIdx];
    if (!painToAssign || !targetSeg) continue;
    if (!Array.isArray(targetSeg.pains)) targetSeg.pains = [];

    const alreadyInTarget = targetSeg.pains.some(
      (p: any) => (p?.canonicalClaimId || p?.claimId) === claimId,
    );
    if (!alreadyInTarget) {
      targetSeg.pains.push({
        claimId: painToAssign.claimId,
        canonicalClaimId: painToAssign.claimId,
        claim: painToAssign.claim,
        evidenceIds: [...painToAssign.evidenceIds],
      });
    }
  }

  // 3. Deduplicate exact identical pain entries within each segment and refresh profile arrays
  for (const seg of patchedSegments) {
    if (Array.isArray(seg.pains)) {
      const dedupedPains: any[] = [];
      const seenExactKey = new Set<string>();
      for (const p of seg.pains) {
        const cid = p?.canonicalClaimId || p?.claimId || "";
        const pText = p?.claim || p?.text || "";
        const exactKey = `${cid}||${normalizeClaimTextForIdentity(pText)}||${normalizeEvidenceIdsForIdentity(p?.evidenceIds).join(",")}`;
        if (seenExactKey.has(exactKey)) continue;
        seenExactKey.add(exactKey);
        dedupedPains.push({
          ...p,
          claimId: p.claimId || cid,
          canonicalClaimId: p.canonicalClaimId || cid,
          claim: pText,
        });
      }
      seg.pains = dedupedPains;
    }
    refreshSegmentProfilesAndGrounding(seg);
  }

  return patchedSegments as any;
}

export interface CandidateValidationResult {
  valid: boolean;
  failureClass?: "GROUPING_INCOMPLETE" | "CLAIM_FAILURE" | "CONTRACT_FAILURE";
  normalizedCandidates: any[];
  segments: any[];
  rejections: Array<{
    rule: string;
    rejectionCode?: string;
    reason: string;
    claimId?: string;
    canonicalClaimId?: string;
    offendingClaimIds?: string[];
    segmentId?: string;
    claimType?: string;
    missingPainIds?: string[];
    missingPains?: any[];
    unknownAssignedIds?: string[];
  }>;
  missingPainIds: string[];
  missingPains: any[];
}

/**
 * Reconciles unambiguous misplaced discovered pains and validates segment candidates
 * and claim identities BEFORE any Judge LLM call.
 */
export function reconcileAndValidateSegmentCandidates(
  rawSegments: any[],
  discoveredPains: Array<{ claimId?: string; id?: string; claim?: string; pain?: string; text?: string; evidenceIds: string[] }> = [],
  validEvidenceIds?: Set<string>,
): CandidateValidationResult {
  const canonicalPainMap = new Map<string, { claimId: string; claim: string; evidenceIds: string[] }>();
  const normalizedDiscoveredPains: Array<{ claimId: string; claim: string; evidenceIds: string[] }> = [];
  for (const dp of discoveredPains || []) {
    const cid = dp?.claimId || dp?.id;
    const text = dp?.claim || dp?.pain || dp?.text || "";
    if (cid) {
      const entry = {
        claimId: cid,
        claim: text,
        evidenceIds: Array.isArray(dp.evidenceIds) ? dp.evidenceIds : [],
      };
      canonicalPainMap.set(cid, entry);
      normalizedDiscoveredPains.push(entry);
    }
  }

  const normalizedCandidates = (Array.isArray(rawSegments) ? rawSegments : []).map((seg, idx) =>
    normalizeSegmentCandidate(JSON.parse(JSON.stringify(seg)), idx),
  );

  const rejections: CandidateValidationResult["rejections"] = [];
  const unknownAssignedIds: string[] = [];

  for (let sIdx = 0; sIdx < normalizedCandidates.length; sIdx++) {
    const seg = normalizedCandidates[sIdx];
    const segPrefix = `seg_${sIdx + 1}`;
    const segId = seg.id || segPrefix;

    // 1. Reconcile unambiguous misplaced discovered pains in non-pain arrays
    for (const nonPainField of ["objections", "desires", "motivations", "outcomes"] as const) {
      if (!Array.isArray(seg[nonPainField])) continue;
      const retained: any[] = [];
      for (const item of seg[nonPainField]) {
        const cid = item?.claimId;
        const hasDerivedProvenance = Boolean(item?.derivedFromPainId || item?.sourcePainId);
        const canonicalPain = cid ? canonicalPainMap.get(cid) : undefined;

        if (canonicalPain && !hasDerivedProvenance) {
          const textMatches =
            normalizeClaimTextForIdentity(item?.claim) === normalizeClaimTextForIdentity(canonicalPain.claim);
          const evidenceMatches = areEvidenceIdsEquivalent(item?.evidenceIds, canonicalPain.evidenceIds);

          if (textMatches && evidenceMatches) {
            // Unambiguous misplaced discovered pain: restore to seg.pains if not already present, remove from nonPainField
            const existingInPains = seg.pains.find(
              (p: any) => (p.canonicalClaimId || p.claimId) === canonicalPain.claimId,
            );
            if (!existingInPains) {
              seg.pains.push({
                claimId: canonicalPain.claimId,
                canonicalClaimId: canonicalPain.claimId,
                claim: canonicalPain.claim,
                evidenceIds: [...canonicalPain.evidenceIds],
              });
            }
            continue;
          } else {
            // Conflicting payload using a canonical pain ID in a non-pain list without distinct claimId
            rejections.push({
              rule: "CLAIM_IDENTITY_CONFLICT",
              rejectionCode: "CLAIM_IDENTITY_CONFLICT",
              claimId: cid,
              canonicalClaimId: canonicalPain.claimId,
              offendingClaimIds: [cid],
              segmentId: segId,
              claimType: nonPainField,
              reason: `CLAIM_IDENTITY_CONFLICT: Claim '${cid}' in ${segPrefix}.${nonPainField} reuses canonical discovered pain ID '${canonicalPain.claimId}' with conflicting text or evidenceIds.`,
            });
          }
        }
        retained.push(item);
      }
      seg[nonPainField] = retained;
    }

    // 2. Validate pains against canonical discovered pains (when discoveredPains is non-empty)
    if (canonicalPainMap.size > 0) {
      for (const p of seg.pains) {
        let cid = p.canonicalClaimId || p.claimId;
        if (!cid || !canonicalPainMap.has(cid)) {
          // Match by exact normalized text AND compatible evidence (never by similar wording alone)
          const matchedByExactTextAndEvidence = normalizedDiscoveredPains.find(
            (dp) =>
              normalizeClaimTextForIdentity(dp.claim) === normalizeClaimTextForIdentity(p.claim) &&
              (areEvidenceIdsEquivalent(p.evidenceIds, dp.evidenceIds) ||
                !Array.isArray(p.evidenceIds) ||
                p.evidenceIds.length === 0),
          );
          if (matchedByExactTextAndEvidence) {
            cid = matchedByExactTextAndEvidence.claimId;
            p.claimId = cid;
            p.canonicalClaimId = cid;
            if (!Array.isArray(p.evidenceIds) || p.evidenceIds.length === 0) {
              p.evidenceIds = [...matchedByExactTextAndEvidence.evidenceIds];
            }
          }
        }

        if (!cid || !canonicalPainMap.has(cid)) {
          if (cid) unknownAssignedIds.push(cid);
          continue;
        }

        const canonicalPain = canonicalPainMap.get(cid)!;
        const textMatches =
          normalizeClaimTextForIdentity(p.claim) === normalizeClaimTextForIdentity(canonicalPain.claim);
        const evidenceMatches = areEvidenceIdsEquivalent(p.evidenceIds, canonicalPain.evidenceIds);
        if (!textMatches || !evidenceMatches) {
          rejections.push({
            rule: "CLAIM_IDENTITY_CONFLICT",
            rejectionCode: "CLAIM_IDENTITY_CONFLICT",
            claimId: p.claimId,
            canonicalClaimId: cid,
            offendingClaimIds: [p.claimId],
            segmentId: segId,
            claimType: "pains",
            reason: `CLAIM_IDENTITY_CONFLICT: Pain '${p.claimId}' in ${segPrefix}.pains conflicts with canonical discovered pain '${cid}' in text or evidenceIds.`,
          });
        } else {
          p.canonicalClaimId = cid;
        }
      }
    }

    // 3. Deduplicate exact identical claims within the same array, and detect intra-segment identity collisions
    const intraSegmentByClaimId = new Map<
      string,
      { claimType: string; normText: string; normEv: string[] }
    >();

    const checkIntraSegmentClaim = (
      cid: string,
      claimType: string,
      text: string,
      evIds: string[],
    ): boolean => {
      const normText = normalizeClaimTextForIdentity(text);
      const normEv = normalizeEvidenceIdsForIdentity(evIds);
      const prev = intraSegmentByClaimId.get(cid);
      if (!prev) {
        intraSegmentByClaimId.set(cid, { claimType, normText, normEv });
        return false; // not a duplicate
      }
      if (
        prev.claimType === claimType &&
        prev.normText === normText &&
        JSON.stringify(prev.normEv) === JSON.stringify(normEv)
      ) {
        return true; // exact same-array duplicate -> safe to collapse
      }
      rejections.push({
        rule: "CLAIM_IDENTITY_CONFLICT",
        rejectionCode: "CLAIM_IDENTITY_CONFLICT",
        claimId: cid,
        offendingClaimIds: [cid],
        segmentId: segId,
        claimType,
        reason: `CLAIM_IDENTITY_CONFLICT: Duplicate claimId '${cid}' within segment '${segId}' across '${prev.claimType}' and '${claimType}' with non-equivalent payload or role.`,
      });
      return false;
    };

    if (seg.segmentDefinition?.claimId) {
      checkIntraSegmentClaim(
        seg.segmentDefinition.claimId,
        "segmentDefinition",
        seg.segmentDefinition.claim,
        seg.segmentDefinition.evidenceIds,
      );
    }
    if (seg.roleClaim?.claimId) {
      checkIntraSegmentClaim(
        seg.roleClaim.claimId,
        "role",
        seg.roleClaim.value,
        seg.roleClaim.evidenceIds,
      );
    }
    for (const field of ["pains", "desires", "objections", "motivations", "outcomes"] as const) {
      if (!Array.isArray(seg[field])) continue;
      const dedupedList: any[] = [];
      for (const c of seg[field]) {
        const isExactDup = checkIntraSegmentClaim(c.claimId, field, c.claim, c.evidenceIds);
        if (!isExactDup) {
          dedupedList.push(c);
        }
      }
      seg[field] = dedupedList;
    }

    refreshSegmentProfilesAndGrounding(seg);
  }

  // 4. Cross-segment identity check:
  //    - Legitimate cross-segment pain reuse (same canonical pain in pains of multiple segments with matching text + evidence) is ALLOWED.
  //    - Conflicting text/evidence or non-pain ID collisions across segments are REJECTED as CLAIM_IDENTITY_CONFLICT.
  const crossSegmentOccurrences = new Map<
    string,
    Array<{ segmentId: string; claimType: string; normText: string; normEv: string[] }>
  >();

  for (let sIdx = 0; sIdx < normalizedCandidates.length; sIdx++) {
    const seg = normalizedCandidates[sIdx];
    const segId = seg.id || `seg_${sIdx + 1}`;
    const recordOcc = (cid: string, claimType: string, text: string, evIds: string[]) => {
      if (!cid) return;
      const list = crossSegmentOccurrences.get(cid) || [];
      list.push({
        segmentId: segId,
        claimType,
        normText: normalizeClaimTextForIdentity(text),
        normEv: normalizeEvidenceIdsForIdentity(evIds),
      });
      crossSegmentOccurrences.set(cid, list);
    };

    if (seg.segmentDefinition?.claimId) {
      recordOcc(seg.segmentDefinition.claimId, "segmentDefinition", seg.segmentDefinition.claim, seg.segmentDefinition.evidenceIds);
    }
    if (seg.roleClaim?.claimId) {
      recordOcc(seg.roleClaim.claimId, "role", seg.roleClaim.value, seg.roleClaim.evidenceIds);
    }
    for (const field of ["pains", "desires", "objections", "motivations", "outcomes"] as const) {
      for (const c of seg[field] || []) {
        recordOcc(c.canonicalClaimId || c.claimId, field, c.claim, c.evidenceIds);
      }
    }
  }

  for (const [cid, occs] of crossSegmentOccurrences.entries()) {
    if (occs.length <= 1) continue;
    const baseline = occs[0];
    const allPains = occs.every((o) => o.claimType === "pains");
    const allPayloadEquivalent = occs.every(
      (o) =>
        o.normText === baseline.normText &&
        JSON.stringify(o.normEv) === JSON.stringify(baseline.normEv),
    );
    if (!allPains || !allPayloadEquivalent) {
      const alreadyFlagged = rejections.some(
        (r) => r.rule === "CLAIM_IDENTITY_CONFLICT" && (r.claimId === cid || r.canonicalClaimId === cid),
      );
      if (!alreadyFlagged) {
        rejections.push({
          rule: "CLAIM_IDENTITY_CONFLICT",
          rejectionCode: "CLAIM_IDENTITY_CONFLICT",
          claimId: cid,
          canonicalClaimId: cid,
          offendingClaimIds: [cid],
          reason: `CLAIM_IDENTITY_CONFLICT: Claim ID '${cid}' appears across multiple segments/types (${occs.map((o) => `${o.segmentId}.${o.claimType}`).join(", ")}) with conflicting text, evidence, or claim type.`,
        });
      }
    }
  }

  // 5. Validate evidence references when validEvidenceIds is provided
  if (validEvidenceIds && validEvidenceIds.size > 0) {
    for (let sIdx = 0; sIdx < normalizedCandidates.length; sIdx++) {
      const seg = normalizedCandidates[sIdx];
      const segId = seg.id || `seg_${sIdx + 1}`;
      for (const field of ["pains", "desires", "objections", "motivations", "outcomes"] as const) {
        for (const c of seg[field] || []) {
          const evs = Array.isArray(c.evidenceIds) ? c.evidenceIds : [];
          const invalidIds = evs.filter((eid: string) => !validEvidenceIds.has(eid));
          if (invalidIds.length > 0) {
            rejections.push({
              rule: "INVALID_EVIDENCE_REFERENCE",
              rejectionCode: "INVALID_EVIDENCE_REFERENCE",
              claimId: c.claimId,
              canonicalClaimId: c.canonicalClaimId || c.claimId,
              offendingClaimIds: [c.claimId],
              segmentId: segId,
              claimType: field,
              reason: `INVALID_EVIDENCE_REFERENCE: Claim '${c.claimId}' cites unknown evidenceIds: ${invalidIds.join(", ")}`,
            });
          }
        }
      }
    }
  }

  // 6. Check missing canonical discovered pains
  const assignedCanonicalPainIds = new Set<string>();
  for (const seg of normalizedCandidates) {
    for (const p of seg.pains || []) {
      const cid = p.canonicalClaimId || p.claimId;
      if (cid && canonicalPainMap.has(cid)) {
        assignedCanonicalPainIds.add(cid);
      }
    }
  }

  const missingPainIds = [...canonicalPainMap.keys()].filter((id) => !assignedCanonicalPainIds.has(id));
  const missingPains = missingPainIds.map((id) => canonicalPainMap.get(id)!).filter(Boolean);

  if (missingPainIds.length > 0) {
    rejections.push({
      rule: "GROUPING_INCOMPLETE",
      rejectionCode: "GROUPING_INCOMPLETE",
      reason: `Discovered pains omitted from segment grouping: ${missingPainIds.join(", ")}`,
      missingPainIds,
      missingPains,
    });
  }

  if (unknownAssignedIds.length > 0) {
    rejections.push({
      rule: "UNKNOWN_PAIN_INVENTED",
      rejectionCode: "UNKNOWN_PAIN_INVENTED",
      reason: `Unknown pain IDs invented in segment grouping: ${unknownAssignedIds.join(", ")}`,
      unknownAssignedIds,
    });
  }

  if (rejections.length > 0) {
    const hasIdentityConflict = rejections.some(
      (r) => r.rule === "CLAIM_IDENTITY_CONFLICT" || r.rule === "INVALID_EVIDENCE_REFERENCE",
    );
    const hasGroupingIncomplete = rejections.some((r) => r.rule === "GROUPING_INCOMPLETE");
    return {
      valid: false,
      failureClass: hasIdentityConflict
        ? "CONTRACT_FAILURE"
        : hasGroupingIncomplete
          ? "GROUPING_INCOMPLETE"
          : "CLAIM_FAILURE",
      normalizedCandidates,
      segments: normalizedCandidates,
      rejections,
      missingPainIds,
      missingPains,
    };
  }

  return {
    valid: true,
    normalizedCandidates,
    segments: normalizedCandidates,
    rejections: [],
    missingPainIds: [],
    missingPains: [],
  };
}

export interface SegmentClaimManifestItem {
  claimId: string;
  evaluationKey: string;
  canonicalClaimId: string;
  derivedFromPainId?: string;
  claimType: string;
  segmentId: string;
  segmentPrefix: string;
  text: string;
  evidenceIds: string[];
}

/**
 * Builds the Judge evaluation manifest from normalized segment candidates.
 * - Separates canonical claim identity (`canonicalClaimId`), segment-claim relationship (`segmentId`, `claimType`),
 *   and the unique evaluation item key (`claimId` / `evaluationKey`) submitted to the Judge.
 * - When a canonical pain is legitimately shared across multiple segments, scopes its evaluation key
 *   as `${segPrefix}::${canonicalId}` while preserving `canonicalClaimId`.
 */
export function buildSegmentClaimManifest(
  normalizedCandidates: any[],
): SegmentClaimManifestItem[] & { manifest: SegmentClaimManifestItem[] } {
  const claimIdSegmentCount = new Map<string, number>();
  for (const seg of normalizedCandidates || []) {
    const seenInSeg = new Set<string>();
    for (const field of ["pains", "desires", "objections", "motivations", "outcomes"] as const) {
      for (const c of seg[field] || []) {
        const cid = c?.canonicalClaimId || c?.claimId;
        if (cid && !seenInSeg.has(cid)) {
          seenInSeg.add(cid);
          claimIdSegmentCount.set(cid, (claimIdSegmentCount.get(cid) || 0) + 1);
        }
      }
    }
  }

  const claimManifest: SegmentClaimManifestItem[] = [];
  const usedEvaluationKeys = new Set<string>();

  (normalizedCandidates || []).forEach((seg: any, sIdx: number) => {
    const segPrefix = seg.segmentDefinition?.claimId
      ? seg.segmentDefinition.claimId.split("_def")[0]
      : `seg_${sIdx + 1}`;
    const segId = seg.id || segPrefix;

    const pushItem = (
      rawClaimId: string,
      canonicalClaimId: string,
      claimType: string,
      text: string,
      evidenceIds: string[],
      derivedFromPainId?: string,
    ) => {
      const isSharedAcrossSegments = (claimIdSegmentCount.get(canonicalClaimId) || 0) > 1;
      let evaluationKey = isSharedAcrossSegments ? `${segId}::${canonicalClaimId}` : rawClaimId;
      if (usedEvaluationKeys.has(evaluationKey)) {
        evaluationKey = `${segId}::${claimType}::${rawClaimId}`;
      }
      usedEvaluationKeys.add(evaluationKey);

      claimManifest.push({
        claimId: evaluationKey,
        evaluationKey,
        canonicalClaimId,
        ...(derivedFromPainId ? { derivedFromPainId } : {}),
        claimType,
        segmentId: segId,
        segmentPrefix: segPrefix,
        text,
        evidenceIds: Array.isArray(evidenceIds) ? evidenceIds : [],
      });
    };

    if (seg.segmentDefinition?.claimId) {
      pushItem(
        seg.segmentDefinition.claimId,
        seg.segmentDefinition.claimId,
        "segmentDefinition",
        seg.segmentDefinition.claim,
        seg.segmentDefinition.evidenceIds,
      );
    }
    const roleClaim = seg.roleClaim || (typeof seg.role === "object" && seg.role !== null ? seg.role : null);
    if (roleClaim?.claimId) {
      pushItem(
        roleClaim.claimId,
        roleClaim.claimId,
        "role",
        roleClaim.value,
        roleClaim.evidenceIds,
      );
    }
    for (const field of ["pains", "desires", "objections", "motivations", "outcomes"] as const) {
      if (Array.isArray(seg[field])) {
        for (const c of seg[field]) {
          if (c?.claimId) {
            pushItem(
              c.claimId,
              c.canonicalClaimId || c.claimId,
              field,
              c.claim || c.text,
              c.evidenceIds,
              c.derivedFromPainId || c.sourcePainId,
            );
          }
        }
      }
    }
  });

  Object.defineProperty(claimManifest, "manifest", {
    value: claimManifest,
    enumerable: false,
    configurable: true,
  });
  return claimManifest as any;
}

export interface JudgeBatchValidationResult {
  valid: boolean;
  errorCode?:
    | "JUDGE_EVALUATION_DUPLICATES"
    | "JUDGE_EVALUATION_INCOMPLETE"
    | "JUDGE_UNKNOWN_CLAIM_ID"
    | "JUDGE_WRONG_BATCH_CLAIM_ID";
  reason?: string;
  defectReason?: string;
  offendingClaimIds: string[];
  allowedClaimIds: string[];
  collapsedEquivalentDuplicates: boolean;
  duplicateKeys: string[];
  collapsedEquivalentDuplicateKeys: string[];
  nonEquivalentDuplicateKeys: string[];
  contradictoryDuplicateKeys: string[];
  conflictingDuplicateKeys: string[];
  missingKeys: string[];
  unknownKeys: string[];
  wrongBatchKeys: string[];
  normalizedVerdicts: any[];
}

function normalizeJudgeVerdictStatus(rawStatus: unknown): string {
  const s = String(rawStatus ?? "").trim().toUpperCase();
  if (s === "APPROVED") return "VALID";
  if (s === "UNSUPPORTED" || s === "REJECTED") return "INVALID";
  return s;
}

function areJudgeVerdictsEquivalent(a: any, b: any): boolean {
  const statusA = normalizeJudgeVerdictStatus(a?.status);
  const statusB = normalizeJudgeVerdictStatus(b?.status);
  if (!statusA || statusA !== statusB) return false;
  if (statusA !== "VALID" && statusA !== "INVALID") return false;

  const codeA = String(a?.rejectionCode ?? "").trim().toUpperCase();
  const codeB = String(b?.rejectionCode ?? "").trim().toUpperCase();
  if (codeA !== codeB) return false;

  const critiqueA = normalizeClaimTextForIdentity(a?.critique ?? a?.reason ?? "");
  const critiqueB = normalizeClaimTextForIdentity(b?.critique ?? b?.reason ?? "");
  if (critiqueA !== critiqueB) return false;

  const dirA = normalizeClaimTextForIdentity(a?.repairDirective ?? "");
  const dirB = normalizeClaimTextForIdentity(b?.repairDirective ?? "");
  if (dirA !== dirB) return false;

  return true;
}

/**
 * Validates and normalizes a single Judge batch response before combining results.
 * - Enforces batch membership (`batchAllowedIds`) and whole-manifest membership (`allManifestIds`).
 * - Collapses duplicate verdicts ONLY when equivalent across all decision-relevant fields
 *   (`status`, `rejectionCode`, `critique`, `repairDirective`), recording the anomaly.
 * - Rejects same-status non-equivalent duplicates, contradictory duplicates, missing keys,
 *   unknown keys, and wrong-batch keys with explicit offending keys and allowed keys.
 */
export function validateAndNormalizeJudgeBatchVerdicts(
  rawVerdicts: any[],
  batchManifest: Array<{ claimId: string; canonicalClaimId?: string; segmentId?: string; claimType?: string }>,
  allManifestIds: Set<string>,
  batchIndex: number = 0,
): JudgeBatchValidationResult {
  const allowedClaimIds = batchManifest.map((m) => m.claimId);
  const batchAllowedSet = new Set(allowedClaimIds);

  const duplicateKeys: string[] = [];
  const collapsedEquivalentDuplicateKeys: string[] = [];
  const nonEquivalentDuplicateKeys: string[] = [];
  const contradictoryDuplicateKeys: string[] = [];
  const missingKeys: string[] = [];
  const unknownKeys: string[] = [];
  const wrongBatchKeys: string[] = [];

  const groupedByClaimId = new Map<string, any[]>();

  for (const v of Array.isArray(rawVerdicts) ? rawVerdicts : []) {
    const cid = typeof v?.claimId === "string" ? v.claimId.trim() : "";
    if (!cid || !allManifestIds.has(cid)) {
      unknownKeys.push(cid || "<missing_claimId>");
      continue;
    }
    if (!batchAllowedSet.has(cid)) {
      wrongBatchKeys.push(cid);
      continue;
    }
    const normalizedV = {
      ...v,
      status: normalizeJudgeVerdictStatus(v?.status),
    };
    const group = groupedByClaimId.get(cid) || [];
    group.push(normalizedV);
    groupedByClaimId.set(cid, group);
  }

  const normalizedVerdicts: any[] = [];

  for (const expectedId of allowedClaimIds) {
    const group = groupedByClaimId.get(expectedId);
    if (!group || group.length === 0) {
      missingKeys.push(expectedId);
      continue;
    }
    if (group.length === 1) {
      normalizedVerdicts.push(group[0]);
      continue;
    }

    // Duplicate verdicts for expectedId
    duplicateKeys.push(expectedId);
    const statuses = new Set(group.map((g) => normalizeJudgeVerdictStatus(g?.status)));
    if (statuses.size > 1) {
      contradictoryDuplicateKeys.push(expectedId);
      continue;
    }

    const baseline = group[0];
    const allEquivalent = group.every((g) => areJudgeVerdictsEquivalent(baseline, g));
    if (allEquivalent) {
      collapsedEquivalentDuplicateKeys.push(expectedId);
      normalizedVerdicts.push(baseline);
    } else {
      nonEquivalentDuplicateKeys.push(expectedId);
    }
  }

  // Verify full coverage after collapsing equivalent duplicates
  const coveredIds = new Set(normalizedVerdicts.map((v) => v.claimId));
  for (const expectedId of allowedClaimIds) {
    if (
      !coveredIds.has(expectedId) &&
      !missingKeys.includes(expectedId) &&
      !contradictoryDuplicateKeys.includes(expectedId) &&
      !nonEquivalentDuplicateKeys.includes(expectedId)
    ) {
      missingKeys.push(expectedId);
    }
  }

  if (
    contradictoryDuplicateKeys.length > 0 ||
    nonEquivalentDuplicateKeys.length > 0 ||
    wrongBatchKeys.length > 0 ||
    unknownKeys.length > 0 ||
    missingKeys.length > 0
  ) {
    let errorCode: NonNullable<JudgeBatchValidationResult["errorCode"]>;
    let reason: string;

    if (contradictoryDuplicateKeys.length > 0) {
      errorCode = "JUDGE_EVALUATION_DUPLICATES";
      reason = `CONTRADICTORY_DUPLICATE: Judge returned contradictory duplicate verdicts in batch ${batchIndex + 1} for keys: ${contradictoryDuplicateKeys.join(", ")}`;
    } else if (nonEquivalentDuplicateKeys.length > 0) {
      errorCode = "JUDGE_EVALUATION_DUPLICATES";
      reason = `SAME_STATUS_NON_EQUIVALENT_DUPLICATE: Judge returned non-equivalent duplicate verdicts in batch ${batchIndex + 1} for keys: ${nonEquivalentDuplicateKeys.join(", ")}`;
    } else if (wrongBatchKeys.length > 0) {
      errorCode = "JUDGE_WRONG_BATCH_CLAIM_ID";
      reason = `WRONG_BATCH_EVALUATION_KEYS: Judge returned verdicts belonging to another batch in batch ${batchIndex + 1}: ${wrongBatchKeys.join(", ")}`;
    } else if (unknownKeys.length > 0) {
      errorCode = "JUDGE_UNKNOWN_CLAIM_ID";
      reason = `UNKNOWN_EVALUATION_KEYS: Judge returned verdict for unknown claimId(s) in batch ${batchIndex + 1}: ${unknownKeys.join(", ")}`;
    } else {
      errorCode = "JUDGE_EVALUATION_INCOMPLETE";
      reason = `MISSING_EVALUATION_KEYS: Judge missed required evaluation keys in batch ${batchIndex + 1}: ${missingKeys.join(", ")}`;
    }

    const offendingClaimIds = Array.from(
      new Set([
        ...contradictoryDuplicateKeys,
        ...nonEquivalentDuplicateKeys,
        ...wrongBatchKeys,
        ...unknownKeys,
        ...missingKeys,
      ]),
    );

    return {
      valid: false,
      errorCode,
      reason,
      defectReason: reason,
      offendingClaimIds,
      allowedClaimIds,
      collapsedEquivalentDuplicates: collapsedEquivalentDuplicateKeys.length > 0,
      duplicateKeys,
      collapsedEquivalentDuplicateKeys,
      nonEquivalentDuplicateKeys,
      contradictoryDuplicateKeys,
      conflictingDuplicateKeys: contradictoryDuplicateKeys,
      missingKeys,
      unknownKeys,
      wrongBatchKeys,
      normalizedVerdicts: [],
    };
  }

  return {
    valid: true,
    collapsedEquivalentDuplicates: collapsedEquivalentDuplicateKeys.length > 0,
    offendingClaimIds: [],
    allowedClaimIds,
    duplicateKeys,
    collapsedEquivalentDuplicateKeys,
    nonEquivalentDuplicateKeys: [],
    contradictoryDuplicateKeys: [],
    conflictingDuplicateKeys: [],
    missingKeys: [],
    unknownKeys: [],
    wrongBatchKeys: [],
    normalizedVerdicts,
  };
}

export function buildAudienceFailureAttribution(
  err: any,
  diagnostics: AudienceJudgeDiagnosticEntry[] = [],
): AudienceFailureAttribution & {
  code?: string;
  failureAttribution: AudienceFailureAttribution;
  statusMessage: string;
} {
  const telemetry = err?.telemetry;
  const rejections: any[] = Array.isArray(err?.rejections) ? err.rejections : [];
  const rawAttempts =
    typeof telemetry?.attempts === "number" && telemetry.attempts > 0
      ? telemetry.attempts
      : typeof telemetry?.attemptsUsed === "number" && telemetry.attemptsUsed > 0
        ? telemetry.attemptsUsed
        : diagnostics.length > 0
          ? Math.max(...diagnostics.map((d) => d.attempt))
          : 1;
  const attemptsUsed = rawAttempts;
  const maxAttempts =
    typeof telemetry?.maxAttempts === "number" && telemetry.maxAttempts > 0
      ? telemetry.maxAttempts
      : 4;
  const retryBudgetExhausted = attemptsUsed >= maxAttempts && maxAttempts > 1;

  const firstRejectionCode =
    rejections[0]?.rejectionCode ||
    rejections[0]?.rule ||
    diagnostics[diagnostics.length - 1]?.errorCode;

  const msg = String(err?.message || "Audience segmentation failed");
  const codeMatch = msg.match(
    /\b(CLAIM_IDENTITY_CONFLICT|INVALID_EVIDENCE_REFERENCE|JUDGE_EVALUATION_DUPLICATES|JUDGE_EVALUATION_INCOMPLETE|JUDGE_UNKNOWN_CLAIM_ID|JUDGE_WRONG_BATCH_CLAIM_ID|JUDGE_MALFORMED_JSON|JUDGE_RESPONSE_CONTRACT_FAILURE|UNSUPPORTED_PAIN|COMPOUND_PAIN|GROUPING_INCOMPLETE)\b/,
  );
  const errorCode = firstRejectionCode || codeMatch?.[1] || undefined;

  let category: AudienceFailureCategory = "SEMANTIC_REJECTION";
  if (
    err?.failureClass === "CONTRACT_FAILURE" ||
    (errorCode &&
      (errorCode.startsWith("JUDGE_") ||
        errorCode === "CLAIM_IDENTITY_CONFLICT" ||
        errorCode === "INVALID_EVIDENCE_REFERENCE"))
  ) {
    category = "JUDGE_CONTRACT_FAILURE";
  } else if (err?.failureClass === "TECHNICAL_FAILURE") {
    category = "TECHNICAL_EXECUTION_FAILURE";
  } else if (err?.failureClass === "EVIDENCE_FAILURE") {
    category = "INSUFFICIENT_EVIDENCE";
  }

  const latestDiagId = diagnostics.length > 0 ? diagnostics[diagnostics.length - 1].diagnosticId : undefined;
  const detailReason =
    rejections.length > 0
      ? rejections.map((r) => r.reason || r.rule).join("; ")
      : msg;

  const statusMessage = retryBudgetExhausted
    ? `Audience segmentation failed after maximum retries (${attemptsUsed}/${maxAttempts}) [${category}${errorCode ? `:${errorCode}` : ""}]. ${detailReason}`
    : `Audience segmentation halted on attempt ${attemptsUsed} of ${maxAttempts} [${category}${errorCode ? `:${errorCode}` : ""}]. ${detailReason}`;

  const failureAttribution: AudienceFailureAttribution = {
    category,
    retryBudgetExhausted,
    attemptsUsed,
    maxAttempts,
    ...(errorCode ? { errorCode } : {}),
    ...(latestDiagId ? { diagnosticId: latestDiagId } : {}),
    summary: statusMessage,
  };

  return {
    ...failureAttribution,
    code: errorCode,
    failureAttribution,
    statusMessage,
  };
}

const AdsTargetingCandidateSchema = z.object({
  suggestedInterests: z.array(z.string()).default([]),
  suggestedBehaviors: z.array(z.string()).default([]),
  suggestedAgeRange: z
    .object({ min: z.coerce.number().catch(18), max: z.coerce.number().catch(55) })
    .default({ min: 18, max: 55 }),
  suggestedGender: z.string().default("all"),
  suggestedLocations: z.array(z.string()).default([]),
  rationale: z.string().default(""),
});
const AdsTargetingArraySchema = z.array(AdsTargetingCandidateSchema);

import { validateAndApplySplitClaim, type SplitPatch } from "../shared/pain-atomicity";
export { validateAndApplySplitClaim, type SplitPatch };

/**
 * Decoupled Atomic Audience Pain Discovery
 * Discovers candidate buyer problems strictly and directly from raw customer evidence,
 * completely decoupled from segment clustering and strictly independent of Product Truth.
 * Enforces:
 * 1. Multi-concept evidence preservation: Multiple distinct issues in one evidence unit produce separate atomic claims.
 * 2. Minority pain preservation: High frequency in one theme does not silence distinct minority issues.
 * 3. Local pain fidelity verification: Each discovered pain is checked via judgeAndRepairPainFidelityWithLLM.
 */
export async function discoverAtomicAudiencePains(
  evidenceItems: AudienceEvidenceUnit[],
  targetContext: { industry?: string; coreOffer?: string; targetAudience?: string; targetRoles?: string[] },
  accountId: string = "system",
): Promise<Array<{ claimId: string; claim: string; evidenceIds: string[] }>> {
  if (!Array.isArray(evidenceItems) || evidenceItems.length === 0) {
    return [];
  }

  const discoveryPrompt = `You are the Audience Pain Discovery Engine discovering candidate buyer problems strictly and directly from RAW CUSTOMER EVIDENCE.

GOAL:
Discover ALL materially distinct, recurring customer problems, frictions, product defects, or purchasing barriers that are directly substantiated by the customer evidence.

CRITICAL DISCOVERY PRINCIPLES:
1. EVIDENCE DECIDES COMPLETENESS:
   - Discover pains based ONLY on what customers in the market actually report, complain about, or struggle with.
   - Do NOT invent or assume problems not grounded in quotes.
   - Every pain MUST cite specific valid evidence IDs from RAW EVIDENCE (e.g. evidenceIds: ["EV-1", "EV-5"]).

2. MULTI-CONCEPT EVIDENCE PRESERVATION:
   - If a customer review or quote describes multiple distinct problems (e.g. defective/see-through garment construction AND customer service/refund friction, or sizing chart discrepancies AND material heat discomfort), you MUST emit SEPARATE atomic pain items for each distinct problem, each citing the relevant evidenceId.
   - Never collapse distinct customer complaints together or discard one because another was mentioned in the same quote.

3. MATERIALLY DISTINCT MINORITY PAIN PRESERVATION:
   - If one complaint theme is very frequent (e.g. 30 comments about heat discomfort or fabric breathability), that MUST NOT silence, erase, or crowd out distinct minority customer problems (e.g. 2-3 complaints about see-through fabric, cheap seams, incorrect sizing, or return delays).
   - Capture EVERY distinct, recurring customer friction that is substantiated by evidence.

4. PAIN ATOMICITY (ONE COHERENT CAUSAL PROBLEM UNIT):
   - Each pain claim MUST represent ONE coherent customer problem or causal issue unit.
   - Do NOT combine multiple distinct, independently actionable issues into compound sentences (e.g. do NOT conjoin pricing with sizing, or customer service with garment sheerness).

5. PAIN FIDELITY INVARIANTS:
   - CUSTOMER QUESTION != CUSTOMER PAIN: Routine customer inquiries ("Price please?", "What size?") and restock requests ("Please restock size M") are INQUIRIES or STOCKOUT FRUSTRATIONS, NOT systemic operational/pricing transparency defects.
   - NO OVER-SPECIALIZATION / PREFERENCE TO REQUIREMENT UPGRADE:
     Customer preferences, tips, or material dislikes (e.g. "polyester feels hot / prefer cotton in summer") describe fabric comfort, breathability, or heat discomfort frictions.
     They MUST NOT be upgraded into mandatory universal requirements or category exclusions (e.g. "buyers require 100% natural, breathable fabrics").
     Capture the faithful core friction (e.g. difficulty finding comfortable, breathable modest clothing for hot weather without heat discomfort).

BUSINESS & TARGET CONTEXT (for situational framing only, NOT evidence):
Industry: ${targetContext.industry || "General"}
Core Offering: ${targetContext.coreOffer || "N/A"}
Target Audience: ${targetContext.targetAudience || "General Audience"}
${targetContext.targetRoles && targetContext.targetRoles.length > 0 ? `Target Roles: ${targetContext.targetRoles.join(", ")}` : ""}

RAW CUSTOMER EVIDENCE:
${formatEvidenceUnits(evidenceItems)}

OUTPUT FORMAT:
Return a JSON object containing an array of atomic pains:
{
  "pains": [
    {
      "claimId": "disc_pain_1",
      "claim": "Specific customer problem directly grounded in evidence...",
      "evidenceIds": ["EV-1", "EV-2"]
    }
  ]
}

Return ONLY valid JSON matching this schema.`;

  let candidatePains: Array<{ claimId: string; claim: string; evidenceIds: string[] }> = [];

  try {
    const aiRes = await aiChat({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: discoveryPrompt }],
      temperature: 0.1,
      max_tokens: 3500,
      response_format: { type: "json_object" },
      endpoint: "audience-engine-v3-pain-discovery",
      accountId,
    });

    const rawContent = aiRes.choices[0]?.message?.content?.trim() || "{}";
    const parsed = safeJsonParse<any>(rawContent, z.any());
    const painList = Array.isArray(parsed?.pains) ? parsed.pains : (Array.isArray(parsed) ? parsed : []);

    candidatePains = painList
      .filter((p: any) => p && typeof p.claim === "string" && p.claim.trim().length > 0)
      .map((p: any, idx: number) => ({
        claimId: p.claimId || `disc_pain_${idx + 1}`,
        claim: p.claim.trim(),
        evidenceIds: Array.isArray(p.evidenceIds) && p.evidenceIds.length > 0 ? p.evidenceIds.map(String) : [],
      }));
  } catch (err: any) {
    console.error(`[AudienceEngine-V3] Pain discovery LLM error: ${err.message}`);
    return [];
  }

  if (candidatePains.length === 0) {
    return [];
  }

  // Build evidence text lookup map
  const evidenceMap = new Map<string, string>();
  for (const u of evidenceItems) {
    if ('text' in u && u.text) {
      evidenceMap.set(String(u.id), u.text);
    } else if ('representativeEvidence' in u && Array.isArray(u.representativeEvidence)) {
      evidenceMap.set(String(u.id || (u as any).clusterId), u.representativeEvidence.join(" | "));
    }
  }

  // Local Pain Fidelity & Atomicity Verification Gate
  const verifiedPains: Array<{ claimId: string; claim: string; evidenceIds: string[] }> = [];

  for (const p of candidatePains) {
    const evidenceTexts = p.evidenceIds
      .map(eid => evidenceMap.get(eid))
      .filter((t): t is string => typeof t === "string" && t.length > 0);

    if (evidenceTexts.length === 0) {
      console.warn(`[AudienceEngine-V3] Pain ${p.claimId} has no resolved evidence text for cited IDs: ${p.evidenceIds.join(", ")}`);
      continue;
    }

    try {
      const fidelityResult = await judgeAndRepairPainFidelityWithLLM({
        painClaim: p.claim,
        evidenceTexts,
        accountId,
      });

      if (fidelityResult.verdict === "UNSUPPORTED") {
        console.log(`[AudienceEngine-V3] Pain dropped by fidelity judge (UNSUPPORTED): "${p.claim}" - ${fidelityResult.critique}`);
        continue;
      }

      const finalClaimText = (fidelityResult.canonical && fidelityResult.canonical.trim().length > 0)
        ? fidelityResult.canonical.trim()
        : p.claim;

      if (fidelityResult.canonical !== p.claim) {
        console.log(`[AudienceEngine-V3] Pain fidelity repaired: "${p.claim}" -> "${finalClaimText}" (${fidelityResult.verdict})`);
      }

      verifiedPains.push({
        claimId: p.claimId,
        claim: finalClaimText,
        evidenceIds: p.evidenceIds,
      });
    } catch (err: any) {
      console.warn(`[AudienceEngine-V3] Fidelity check error for pain ${p.claimId}: ${err.message}, retaining original`);
      verifiedPains.push(p);
    }
  }

  return verifiedPains;
}

export async function constructSegments(
  painMap: SignalItem[],
  desireMap: SignalItem[],
  objectionMap: SignalItem[],
  emotionalDrivers: SignalItem[],
  maturity: MaturityResult,
  awareness: AwarenessResult,
  businessContext: { industry: string; coreOffer: string; targetAudience: string },
  evidenceItems: AudienceEvidenceUnit[],
  accountId: string,
  inputSnapshotId: string | null,
  strategic?: RunStrategicContext,
  aiPathSink?: { emission: EngineAiPathEmission | null },
  preDiscoveredPains?: Array<{ claimId: string; claim: string; evidenceIds: string[] }>,
): Promise<AudienceSegment[]> {
  const segmentBatteryAttempts: BatteryAttemptLike[] = [];

  const discoveredPains = (preDiscoveredPains && preDiscoveredPains.length > 0)
    ? preDiscoveredPains
    : await discoverAtomicAudiencePains(evidenceItems, businessContext, accountId);

  let multiSourceSection = "";
  try {
    const { loadMultiSourceContext, buildMultiSourcePromptSection, buildSourceFallbackContext } = await import("../shared/multi-source-loader");
    if (inputSnapshotId) {
      const msCtx = await loadMultiSourceContext(inputSnapshotId);
      if (msCtx && (msCtx.hasMeaningfulWebData || msCtx.hasMeaningfulBlogData)) {
        multiSourceSection = buildMultiSourcePromptSection(msCtx);
        multiSourceSection += "\n\nIMPORTANT: Use website headlines and blog titles to infer audience pains even when comments are absent. Website copy reveals what the market responds to. Blog topics reveal what questions the audience asks repeatedly.";
      } else {
        multiSourceSection = buildSourceFallbackContext(msCtx);
      }
    }
  } catch {}

  const productDnaBlock = (businessContext as any).productDna ? formatProductDNAForPrompt((businessContext as any).productDna) : "";

  let doctrineBlock = "";
  if (strategic?.doctrine) {
    doctrineBlock = buildDoctrineBlock(strategic);
  } else {
    console.log("[AudienceEngine-V3] DOCTRINE_ABSENT — no strategic context threaded; omitting doctrine block");
  }

  let productAnchor = strategic?.doctrine ? strategic.doctrine.productAnchor : null;
  const dnaForAnchor = (businessContext as any).productDna;
  if (!productAnchor && dnaForAnchor) {
    let dnaDifferentiator = "";
    if (dnaForAnchor.strategicAdvantage && String(dnaForAnchor.strategicAdvantage).trim().length > 0) {
      dnaDifferentiator = String(dnaForAnchor.strategicAdvantage).trim();
    } else if (dnaForAnchor.uniqueMechanism && String(dnaForAnchor.uniqueMechanism).trim().length > 0) {
      dnaDifferentiator = String(dnaForAnchor.uniqueMechanism).trim();
    }
    const dnaProblem = dnaForAnchor.coreProblemSolved ? String(dnaForAnchor.coreProblemSolved).trim() : "";
    const dnaName = dnaForAnchor.coreOffer ? String(dnaForAnchor.coreOffer).trim() : "";
    const dnaType = dnaForAnchor.businessType ? String(dnaForAnchor.businessType).trim() : "";
    if (dnaDifferentiator.length > 0 && dnaProblem.length > 0 && dnaName.length > 0 && dnaType.length > 0) {
      productAnchor = {
        name: dnaName,
        type: dnaType,
        keyAttributes: dnaForAnchor.productCategory ? [dnaForAnchor.productCategory] : [],
        coreProblemSolved: dnaProblem,
        differentiatingFeature: dnaDifferentiator,
      };
      console.log(`[AudienceEngine-V3] SEGMENT_ANCHOR_FROM_DNA | doctrine absent — judge anchor derived from business context`);
    }
  }
  const priorDecisions = strategic?.priorDecisions || [];
  let audienceAnchorSource: "doctrine" | "dna" | "none" = "none";
  if (strategic?.doctrine?.productAnchor) {
    audienceAnchorSource = "doctrine";
  } else if (productAnchor) {
    audienceAnchorSource = "dna";
  }
  console.log(`[AudienceEngine-V3] ANCHOR_EVIDENCE | engine=audience | site=first_prompt | attempt=1 | present=${productAnchor ? "yes" : "no"} | source=${audienceAnchorSource}`);

  const audEffectiveAnchor = strategic?.doctrine?.productAnchor ? strategic.doctrine.productAnchor : (productAnchor || null);

  const basePrompt = `You are the Audience Analysis Engine deriving audience intelligence strictly from Judge-approved evidence.

PERMANENT PRINCIPLE: EVIDENCE DECIDES COMPLETENESS. SCHEMA DOES NOT.
Do not populate optional fields (desires, objections, motivations, outcomes) unless evidence explicitly supports them.
Empty arrays are valid and expected when evidence is absent.
Do NOT weaken evidence standards to fill schema fields.
- Every claim MUST carry its own stable claimId and specific evidence IDs (e.g. claimId: "seg_1_pain_1", evidenceIds: ["EV-2", "EV-3"]).
- Do NOT use evidence supporting one claim to justify a different claim (e.g., pain evidence cannot prove a desire or outcome).
- Fewer fully supported claims are far better than a complete-looking persona containing speculation.
- PAIN ATOMICITY: Each pain claim MUST represent ONE coherent customer problem or causal issue unit. Do NOT combine multiple distinct, independently actionable issues (e.g. do not conjoin pricing with sizing, or customer service with return delays and defective items). If multiple distinct problems exist in evidence, emit them as separate atomic pain items, each with its own claimId and specific evidenceIds.
- PAIN FIDELITY INVARIANT & QUESTION-VS-PAIN:
  * Customer questions (e.g. "Price please?", "What size is the model wearing?", "Do you ship to X?") or routine product restock requests ("Please restock size M") are INQUIRIES or STOCKOUT FRUSTRATIONS, NOT systemic operational failures.
  * DO NOT convert routine price/size questions into operational failure or transparency pains (e.g. "Difficulty finding pricing", "Lack of pricing transparency").
  * DO NOT convert restock requests into logistics/inventory software defect claims (e.g. "Inventory tracking failure", "Poor inventory management"). Capture strictly as availability frustration without asserting unverified operational mechanisms.
  * Real operational or quality failures (e.g. "I received only half my order", "Defective seam", "Refund refused") MUST be preserved faithfully.
- MARKET_NARRATIVE_CONTEXT may provide market context but must NOT be used as direct buyer pain testimony.
- Respect the safeUses and prohibitedUses listed on each evidence item.

BUSINESS TARGET CONTEXT (for reference only, NOT evidence):
Industry: ${businessContext.industry}
Core Offering: ${businessContext.coreOffer || "N/A"}
Target Audience: ${businessContext.targetAudience}
${productDnaBlock ? `\nPRODUCT OFFERING CONTEXT:\n${productDnaBlock}\n` : ""}
MARKET MATURITY: ${maturity.level}
AWARENESS LEVEL: ${awareness.level}
${multiSourceSection}

SAMPLE EVIDENCE (raw market data with source actor attribution, authority class, and safe/prohibited uses):
${formatEvidenceUnits(evidenceItems)}
${discoveredPains.length > 0 ? `
CANONICAL DISCOVERED AUDIENCE PAINS (PRE-DISCOVERED & FIDELITY-VERIFIED):
These are the authoritative, evidence-grounded customer pains discovered directly from customer evidence:
${JSON.stringify(discoveredPains, null, 2)}

MANDATORY SEGMENT GROUPING & PAIN ASSIGNMENT INVARIANTS:
1. STRICT 1-3 SEGMENT CONTRACT:
   - You MUST create between 1 and 3 audience segments. (NEVER create more than 3 segments).
   - Group customers into 1, 2, or at most 3 segments based on shared usage context, buyer role, or core motivations.
2. ALL DISCOVERED PAINS MUST BE ASSIGNED:
   - EVERY single pain from the CANONICAL DISCOVERED AUDIENCE PAINS list MUST be assigned to exactly one of the 1-3 segments.
   - When assigning a pain to a segment's "pains" array, you MUST preserve its exact "claimId", "claim", and "evidenceIds".
   - Do NOT drop, omit, or ignore any discovered pain. Every discovered pain must appear in the output.
   - Do NOT invent new pains that are not in the CANONICAL DISCOVERED AUDIENCE PAINS list.
` : ""}
Return a JSON object with a "segments" array containing 1-3 distinct segments actually supported by the evidence. Each segment format:
{
  "segments": [
    {
      "name": "concise label for this group",
      "segmentDefinition": {
        "claimId": "seg_1_def",
        "claim": "concrete definition of who this audience group is",
        "evidenceIds": ["EV-1", "EV-2"]
      },
      "role": {
        "claimId": "seg_1_role",
        "value": "END_CONSUMER",
        "evidenceIds": ["EV-1"]
      },
      "description": "concrete description of their operational/usage context",
      "pains": [
        { "claimId": "${discoveredPains[0]?.claimId || 'disc_pain_1'}", "claim": "exact claim from canonical discovered pains", "evidenceIds": ["EV-2", "EV-3"] }
      ],
      "desires": [
        // Include ONLY if evidence directly expresses a desire/goal. Otherwise OMIT or leave empty [].
        { "claimId": "seg_1_desire_1", "claim": "specific desire directly stated in evidence", "evidenceIds": ["EV-4"] }
      ],
      "objections": [
        // Include ONLY if evidence directly expresses an objection/skepticism. Otherwise OMIT or leave empty [].
        { "claimId": "seg_1_objection_1", "claim": "specific objection directly stated in evidence", "evidenceIds": ["EV-5"] }
      ],
      "motivations": [], // OMIT if unsupported
      "outcomes": [], // OMIT if unsupported
      "estimatedPercentage": 50,
      "groundingRefs": ["EV-1", "EV-2", "EV-3"]
    }
  ]
}

Return ONLY valid JSON matching this schema.`;

  const runDiagnostics: AudienceJudgeDiagnosticEntry[] = [];
  let judgeAttemptCounter = 0;
  let activeCandidateFingerprint: string | null = null;
  const validatedBatchVerdictsByIndex = new Map<number, any[]>();
  const pendingJudgeBatchRepairs = new Map<
    number,
    {
      errorCode: string;
      reason: string;
      offendingClaimIds: string[];
      allowedClaimIds: string[];
    }
  >();

  let rawSegments: string;
  try {
    const repairRun = await generateWithRepair<string, string>({
      engineName: "AudienceEngine-V3",
      touchpointName: "segment_generation",
      authoritativeInput: basePrompt,
      config: { maxRepairs: 3, failClosed: true },
      generate: async (input) => {
        const response = await aiChat({
          model: "gpt-4.1-mini",
          messages: [{ role: "user", content: input }],
          temperature: 0.2,
          max_tokens: 4500,
          response_format: { type: "json_object" },
          endpoint: "audience-engine-v3-segments",
          accountId,
        });
        return response.choices[0]?.message?.content?.trim() || '{"segments":[]}';
      },
      judge: async (input, candidate) => {
        judgeAttemptCounter++;
        let parsed = safeJsonParse<any>(candidate);
        if (!parsed) {
          try {
            const str = String(candidate).trim();
            const startBrace = str.indexOf("{");
            const lastBrace = str.lastIndexOf("}");
            if (startBrace !== -1 && lastBrace !== -1 && lastBrace > startBrace) {
              parsed = JSON.parse(str.substring(startBrace, lastBrace + 1));
            } else {
              const startBracket = str.indexOf("[");
              const lastBracket = str.lastIndexOf("]");
              if (startBracket !== -1 && lastBracket !== -1 && lastBracket > startBracket) {
                parsed = JSON.parse(str.substring(startBracket, lastBracket + 1));
              }
            }
          } catch {}
        }
        if (!parsed) {
          return {
            valid: false,
            failureClass: "GENERATION_QUALITY_FAILURE",
            rejections: [{ rule: "Structural Integrity", reason: "output was not valid JSON" }],
          };
        }

        if (!Array.isArray(parsed) && Array.isArray((parsed as any).segments)) {
          parsed = (parsed as any).segments;
        } else if (!Array.isArray(parsed) && Array.isArray((parsed as any).candidateSegments)) {
          parsed = (parsed as any).candidateSegments;
        }

        if (!Array.isArray(parsed) || parsed.length === 0) {
          return {
            valid: false,
            failureClass: "GENERATION_QUALITY_FAILURE",
            rejections: [{ rule: "Structural Integrity", reason: "output did not contain a non-empty array of segments" }],
          };
        }

        // 1. Strict 1-3 Segment Count Contract Gate
        if (parsed.length > 3) {
          return {
            valid: false,
            failureClass: "SEGMENT_CAPACITY_CONSTRAINT" as any,
            rejections: [
              {
                rule: "SEGMENT_CAPACITY_CONSTRAINT",
                reason: `Segment count must be strictly 1-3, got ${parsed.length}. Cannot fit pains into allowed segment count.`,
              },
            ],
            recoveredValue: JSON.stringify(parsed),
          };
        }

        // 2. Pre-Judge Deterministic Reconciliation & Candidate Identity/Completeness Gate
        const candidateValidation = reconcileAndValidateSegmentCandidates(parsed, discoveredPains);
        if (!candidateValidation.valid) {
          if (candidateValidation.failureClass === "CONTRACT_FAILURE") {
            const conflictReason = candidateValidation.rejections.map((r) => r.reason).join("; ");
            throw new LLMReliabilityError(
              conflictReason,
              "CONTRACT_FAILURE",
              candidateValidation.rejections,
              {
                engine: "AudienceEngine-V3",
                touchpoint: "segment_generation",
                attempts: judgeAttemptCounter,
                maxAttempts: 4,
                technicalRetries: 0,
                finalVerdict: "HONEST_FAIL",
                repairLog: [],
              },
            );
          }

          return {
            valid: false,
            failureClass: (candidateValidation.failureClass || "GROUPING_INCOMPLETE") as any,
            rejections: candidateValidation.rejections,
            recoveredValue: JSON.stringify({
              candidateSegments: candidateValidation.normalizedCandidates,
              missingPainIds: candidateValidation.missingPainIds,
              missingPains: candidateValidation.missingPains,
            }),
          };
        }

        const normalizedCandidates = candidateValidation.normalizedCandidates;

        // 3. Build Unambiguous Structural Manifest
        const claimManifest = buildSegmentClaimManifest(normalizedCandidates);
        const manifestIds = new Set(claimManifest.map((c) => c.claimId));

        if (claimManifest.length === 0) {
          return { valid: true, recoveredValue: JSON.stringify(normalizedCandidates) };
        }

        const candidateFingerprint = crypto
          .createHash("sha256")
          .update(
            JSON.stringify(
              claimManifest.map((m) => ({
                evaluationKey: m.claimId,
                canonicalClaimId: m.canonicalClaimId,
                segmentId: m.segmentId,
                claimType: m.claimType,
                text: m.text,
                evidenceIds: [...(m.evidenceIds || [])].sort(),
              })),
            ),
          )
          .digest("hex")
          .slice(0, 16);

        // Never accumulate or reuse batch verdicts when candidate inputs change
        if (activeCandidateFingerprint !== candidateFingerprint) {
          activeCandidateFingerprint = candidateFingerprint;
          validatedBatchVerdictsByIndex.clear();
          pendingJudgeBatchRepairs.clear();
        }

        // 4. SEMANTIC AUDIENCE JUDGE (Batched evaluation with per-batch contract validation & diagnostics)
        const BATCH_SIZE = 15;
        const totalBatches = Math.ceil(claimManifest.length / BATCH_SIZE);
        const allJudgeReports: any[] = [];

        for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
          const i = batchIndex * BATCH_SIZE;
          const batchManifest = claimManifest.slice(i, i + BATCH_SIZE);
          const batchAllowedIds = batchManifest.map((m) => m.claimId);

          // Reuse already-validated batch on the exact same candidateFingerprint when targeting another defective batch
          if (validatedBatchVerdictsByIndex.has(batchIndex) && !pendingJudgeBatchRepairs.has(batchIndex)) {
            continue;
          }

          const priorDefect = pendingJudgeBatchRepairs.get(batchIndex);
          const contractRepairAddendum = priorDefect
            ? `\n--- JUDGE RESPONSE CONTRACT REPAIR DIRECTIVE (BATCH ${batchIndex + 1} OF ${totalBatches}) ---
Your previous Judge response for this batch failed response-contract validation:
- Defect Code: ${priorDefect.errorCode}
- Reason: ${priorDefect.reason}
- Offending Keys: ${JSON.stringify(priorDefect.offendingClaimIds)}
- Required Allowed Evaluation Keys for This Batch (MUST return EXACTLY ONE verdict for each of these ${batchAllowedIds.length} keys and NO OTHER keys):
${JSON.stringify(batchAllowedIds)}
-------------------------------------------------------------------------\n`
            : "";

          const judgePrompt = `You are the Semantic Audience Judge evaluating proposed audience segments against RAW EVIDENCE.
Your job is to inspect EVERY SINGLE claim in the provided CLAIM MANIFEST and determine which are SUPPORTED vs REJECTED.

RAW EVIDENCE:
${formatEvidenceUnits(evidenceItems)}

PROPOSED SEGMENTS (Full Context):
${JSON.stringify(normalizedCandidates, null, 2)}

CURRENT CLAIM MANIFEST BATCH (Evaluate exactly these IDs):
${JSON.stringify(batchManifest, null, 2)}

CANONICAL BUSINESS & TARGET CONTEXT:
Industry: ${businessContext.industry}
Core Offering: ${businessContext.coreOffer || "N/A"}
${productDnaBlock ? `\n${productDnaBlock}\n` : ""}
${contractRepairAddendum}
EVALUATION RULES:
1. EVIDENCE SUPPORT: Does the cited evidenceIds directly and genuinely support this specific claim?
   - If unsupported: rejectionCode = "UNSUPPORTED_PAIN", "UNSUPPORTED_DESIRE", etc.
2. SOURCE ROLE PRESERVATION: Does the role match who the cited evidence is actually about? (Code: "ROLE_TRANSFER")
3. BUSINESS & TARGET RELEVANCE:
   - Does this evidence describe a real buyer problem relevant to purchasing or using the campaign offering and its target roles, OR does it merely describe customer dissatisfaction with a competitor/vendor (e.g. competitor billing disputes, refund delays, poor customer service)?
   - A competitor complaint must NOT become a canonical audience segment or buyer pain if it is unrelated to the offering's Product Truth and target roles.
   - If invalid: rejectionCode = "AUDIENCE_RELEVANCE_PROMOTION_FAILED"
4. OPTIONAL FIELDS ARE VALID WHEN OMITTED: A segment with only supported role and pains (and empty desires/objections) is 100% VALID. Do NOT reject for omitting optional fields. Do NOT invent claims that are not in the manifest.
5. PAIN ATOMICITY (ONE COHERENT CAUSAL PROBLEM UNIT):
   - For every pain claim: Does this claim describe ONE coherent customer problem, or has the generator conjoined multiple distinct, independently actionable issues with different capability requirements, lifecycle stages, or strategic treatments?
   - Examples of compound pains requiring repair:
     * Conjoining price/value concerns with sizing/fit defects.
     * Conjoining customer service responsiveness with refund delays, return process friction, and defective item delivery.
     * Conjoining product aesthetic preferences with sizing chart inaccuracies.
   - If a pain claim is compound:
     * status = "INVALID"
     * rejectionCode = "COMPOUND_PAIN"
     * critique = "This pain statement conjoins multiple distinct, independently actionable customer problems with different capability requirements or lifecycle stages into a single claim."
     * repairDirective = "Split this compound claim into separate, evidence-grounded atomic claims under splitClaims, or replace it with a single focused atomic claim under repairedClaim. Provide specific, verified evidenceIds for each child claim. Do not copy evidenceIds blindly."
6. PAIN FIDELITY & QUESTION-VS-PAIN:
   - Routine buyer inquiries (e.g. "Price please", "How much?", "What size?") and stock requests ("Please restock size M") are NOT operational system failures.
   - If a proposed pain converts routine questions into claims of lack of transparency or operational defects:
     * status = "INVALID"
     * rejectionCode = "QUESTION_AS_PAIN"
     * critique = "Converts routine customer inquiry or restock request into an ungrounded systemic operational failure."
     * repairDirective = "Drop this pain claim or rephrase strictly to reflect what the customer actually stated without claiming operational or transparency defects."
7. SEMANTIC DRIFT:
   - Does the pain claim preserve the concrete reality of what the customer experienced without escalating into ungrounded business/technology claims?
   - If invalid: status = "INVALID", rejectionCode = "SEMANTIC_DRIFT_PAIN", critique = "Claim escalates concrete customer testimony into ungrounded systemic failure."

INSTRUCTIONS:
Evaluate EVERY claim listed in the CURRENT CLAIM MANIFEST BATCH.
You MUST return EXACTLY ONE verdict for EVERY claimId in the CURRENT CLAIM MANIFEST BATCH (${JSON.stringify(batchAllowedIds)}).
Do NOT return duplicate verdicts for the same claimId, and do NOT return claimIds from outside this batch.
Return a JSON object:
{
  "verdicts": [
    {
      "claimId": "seg_1_pain_1",
      "status": "VALID"
    },
    {
      "claimId": "seg_1_desire_1",
      "status": "INVALID",
      "rejectionCode": "UNSUPPORTED_DESIRE",
      "critique": "Detailed reason...",
      "repairDirective": "Omit this desire completely; keep accepted claims unchanged."
    }
  ]
}
`;

          const judgeRes = await aiChat({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: judgePrompt }],
            temperature: 0.0,
            max_tokens: 3500,
            response_format: { type: "json_object" },
            endpoint: "audience-engine-v3-judge",
            accountId,
          });

          const judgeContent = judgeRes.choices[0]?.message?.content?.trim() || "";

          // Record diagnostic BEFORE parsing or validation can throw
          const diagEntry = recordAudienceJudgeDiagnostic({
            runId: (strategic as any)?.jobId || (strategic as any)?.runId || inputSnapshotId || `aud_run_${Date.now()}`,
            accountId,
            campaignId: (strategic as any)?.campaignId || (businessContext as any)?.campaignId,
            offeringId: (strategic as any)?.doctrine?.campaignOfferingId || (businessContext as any)?.productDna?.campaignOfferingId,
            traceId: (strategic as any)?.traceId,
            candidateFingerprint,
            attempt: judgeAttemptCounter,
            maxAttempts: 4,
            batchIndex,
            totalBatches,
            requestedEvaluationKeys: batchManifest.map((m) => ({
              evaluationKey: m.claimId,
              canonicalClaimId: m.canonicalClaimId,
              segmentId: m.segmentId,
              claimType: m.claimType,
            })),
            rawResponse: judgeContent,
            parsedResult: null,
            validationOutcome: "PENDING_PARSE",
            duplicateKeys: [],
            collapsedEquivalentDuplicateKeys: [],
            nonEquivalentDuplicateKeys: [],
            contradictoryDuplicateKeys: [],
            missingKeys: [],
            unknownKeys: [],
            wrongBatchKeys: [],
            retryOrRepairDecision: "PROCEED",
            attemptCounts: {
              attempt: judgeAttemptCounter,
              maxAttempts: 4,
              technicalRetries: 0,
            },
          });
          runDiagnostics.push(diagEntry);

          let judgeParsed: any = null;
          try {
            judgeParsed = JSON.parse(judgeContent || "{}");
          } catch (parseErr: any) {
            diagEntry.validationOutcome = "PARSE_ERROR";
            diagEntry.errorCode = "JUDGE_MALFORMED_JSON";
            diagEntry.retryOrRepairDecision =
              judgeAttemptCounter < 4 ? "TARGETED_JUDGE_BATCH_REPAIR" : "TERMINAL_CONTRACT_FAILURE";
            pendingJudgeBatchRepairs.set(batchIndex, {
              errorCode: "JUDGE_MALFORMED_JSON",
              reason: `Judge returned malformed JSON in batch ${batchIndex + 1}: ${parseErr.message}`,
              offendingClaimIds: [],
              allowedClaimIds: batchAllowedIds,
            });
            continue;
          }

          diagEntry.parsedResult = judgeParsed;
          const verdicts = Array.isArray(judgeParsed?.verdicts) ? judgeParsed.verdicts : null;
          if (!verdicts) {
            diagEntry.validationOutcome = "CONTRACT_ERROR";
            diagEntry.errorCode = "JUDGE_MALFORMED_JSON";
            diagEntry.retryOrRepairDecision =
              judgeAttemptCounter < 4 ? "TARGETED_JUDGE_BATCH_REPAIR" : "TERMINAL_CONTRACT_FAILURE";
            pendingJudgeBatchRepairs.set(batchIndex, {
              errorCode: "JUDGE_MALFORMED_JSON",
              reason: `Judge response in batch ${batchIndex + 1} did not contain a 'verdicts' array`,
              offendingClaimIds: [],
              allowedClaimIds: batchAllowedIds,
            });
            continue;
          }

          const batchValidation = validateAndNormalizeJudgeBatchVerdicts(
            verdicts,
            batchManifest,
            manifestIds,
            batchIndex,
          );

          diagEntry.duplicateKeys = batchValidation.duplicateKeys;
          diagEntry.collapsedEquivalentDuplicateKeys = batchValidation.collapsedEquivalentDuplicateKeys;
          diagEntry.nonEquivalentDuplicateKeys = batchValidation.nonEquivalentDuplicateKeys;
          diagEntry.contradictoryDuplicateKeys = batchValidation.contradictoryDuplicateKeys;
          diagEntry.missingKeys = batchValidation.missingKeys;
          diagEntry.unknownKeys = batchValidation.unknownKeys;
          diagEntry.wrongBatchKeys = batchValidation.wrongBatchKeys;

          if (!batchValidation.valid) {
            diagEntry.validationOutcome = "CONTRACT_ERROR";
            diagEntry.errorCode = batchValidation.errorCode;
            diagEntry.retryOrRepairDecision =
              judgeAttemptCounter < 4 ? "TARGETED_JUDGE_BATCH_REPAIR" : "TERMINAL_CONTRACT_FAILURE";
            pendingJudgeBatchRepairs.set(batchIndex, {
              errorCode: batchValidation.errorCode!,
              reason: batchValidation.reason!,
              offendingClaimIds: batchValidation.offendingClaimIds,
              allowedClaimIds: batchValidation.allowedClaimIds,
            });
            continue;
          }

          if (batchValidation.collapsedEquivalentDuplicates) {
            console.warn(
              `[AudienceEngine-V3] JUDGE_EQUIVALENT_DUPLICATES_COLLAPSED | batch=${batchIndex + 1}/${totalBatches} | keys=${batchValidation.collapsedEquivalentDuplicateKeys.join(",")}`,
            );
            diagEntry.validationOutcome = "VALID_WITH_COLLAPSED_EQUIVALENT_DUPLICATES";
            diagEntry.retryOrRepairDecision = "COLLAPSE_EQUIVALENT_AND_PROCEED";
          } else {
            const hasSemanticRejections = batchValidation.normalizedVerdicts.some((v: any) => v.status === "INVALID");
            diagEntry.validationOutcome = hasSemanticRejections ? "SEMANTIC_REJECTION" : "VALID_PASS";
            diagEntry.retryOrRepairDecision = hasSemanticRejections
              ? judgeAttemptCounter < 4
                ? "SEMANTIC_CANDIDATE_REPAIR"
                : "TERMINAL_SEMANTIC_FAILURE"
              : "PROCEED";
          }

          validatedBatchVerdictsByIndex.set(batchIndex, batchValidation.normalizedVerdicts);
          pendingJudgeBatchRepairs.delete(batchIndex);
          allJudgeReports.push(judgeParsed);
        }

        // 5. If any batch had a Judge response-contract failure, route through bounded repair targeting only the failed batch(es)
        if (pendingJudgeBatchRepairs.size > 0) {
          const contractRejections = Array.from(pendingJudgeBatchRepairs.entries()).map(([bIdx, info]) => ({
            rule: "JUDGE_RESPONSE_CONTRACT_FAILURE",
            rejectionCode: info.errorCode,
            reason: `${info.errorCode}: ${info.reason}`,
            batchIndex: bIdx,
            offendingClaimIds: info.offendingClaimIds,
            allowedClaimIds: info.allowedClaimIds,
          }));

          return {
            valid: false,
            failureClass: "CONTRACT_FAILURE",
            rejections: contractRejections,
            recoveredValue: JSON.stringify({
              candidateSegments: normalizedCandidates,
              candidateFingerprint,
              judgeContractRepair: true,
            }),
          };
        }

        // 6. Combine validated batch verdicts in deterministic batch order and verify whole-manifest coverage
        const allVerdicts: any[] = [];
        for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
          const batchVerdicts = validatedBatchVerdictsByIndex.get(batchIndex) || [];
          allVerdicts.push(...batchVerdicts);
        }

        const returnedIds = new Set(allVerdicts.map((v: any) => v.claimId));
        const wholeMissingIds = [...manifestIds].filter((mid) => !returnedIds.has(mid));
        if (wholeMissingIds.length > 0 || allVerdicts.length !== manifestIds.size) {
          return {
            valid: false,
            failureClass: "CONTRACT_FAILURE",
            rejections: [
              {
                rule: "JUDGE_RESPONSE_CONTRACT_FAILURE",
                rejectionCode:
                  wholeMissingIds.length > 0 ? "JUDGE_EVALUATION_INCOMPLETE" : "JUDGE_EVALUATION_DUPLICATES",
                reason:
                  wholeMissingIds.length > 0
                    ? `JUDGE_EVALUATION_INCOMPLETE: Judge missed claims across batches: ${wholeMissingIds.join(", ")}`
                    : `JUDGE_EVALUATION_DUPLICATES: Combined batch verdicts contained duplicates`,
                offendingClaimIds: wholeMissingIds,
                allowedClaimIds: [...manifestIds],
              },
            ],
            recoveredValue: JSON.stringify({
              candidateSegments: normalizedCandidates,
              candidateFingerprint,
              judgeContractRepair: true,
            }),
          };
        }

        const rejectedVerdicts = allVerdicts.filter((v: any) => v.status === "INVALID");

        if (rejectedVerdicts.length > 0) {
          return {
            valid: false,
            failureClass: (rejectedVerdicts[0]?.rejectionCode || "UNSUPPORTED_PAIN") as any,
            rejections: rejectedVerdicts.map((r: any) => {
              const manifestClaim = claimManifest.find((c) => c.claimId === r.claimId) || ({} as any);
              return {
                rule: r.rejectionCode || "CLAIM_FAILURE",
                reason: r.critique || r.reason || "unsupported",
                claimId: r.claimId,
                canonicalClaimId: manifestClaim.canonicalClaimId || r.claimId,
                claimType: manifestClaim.claimType || "field",
                segmentId:
                  manifestClaim.segmentId ||
                  (r.claimId.split("_")[0] + "_" + r.claimId.split("_")[1]),
                rejectionCode: r.rejectionCode,
                critique: r.critique || r.reason,
                repairDirective: r.repairDirective,
              };
            }),
            recoveredValue: JSON.stringify({
              judgeReport: allJudgeReports,
              candidateSegments: normalizedCandidates,
            }),
          };
        }

        return { valid: true, recoveredValue: JSON.stringify(normalizedCandidates) };
      },
      repair: async (input, failedCandidate, rejections) => {
        let acceptedIds: string[] = [];
        let rejectedList: any[] = rejections;
        let candidateSegments: any[] = [];

        try {
          const rawObj = JSON.parse(failedCandidate);
          if (Array.isArray(rawObj)) {
            candidateSegments = rawObj;
          } else if (Array.isArray(rawObj.segments)) {
            candidateSegments = rawObj.segments;
          } else if (rawObj.candidateSegments) {
            candidateSegments = rawObj.candidateSegments;
          }

          if (rawObj.judgeReport) {
            acceptedIds = rawObj.judgeReport.acceptedClaimIds || [];
            if (Array.isArray(rawObj.judgeReport.rejectedClaims) && rawObj.judgeReport.rejectedClaims.length > 0) {
              rejectedList = rawObj.judgeReport.rejectedClaims;
            }
          } else {
            rejectedList = rejections;
          }
        } catch {
          // Should not happen if failedCandidate was valid JSON
        }

        // Targeted Judge Response-Contract Repair:
        // Do NOT regenerate valid segments when the defect is strictly in the Judge's response contract;
        // preserve candidateSegments so the next attempt re-evaluates only the defective Judge batch(es).
        if (
          rejectedList.length > 0 &&
          rejectedList.every((r: any) => r.rule === "JUDGE_RESPONSE_CONTRACT_FAILURE")
        ) {
          return JSON.stringify({
            candidateSegments,
            judgeContractRepair: true,
          });
        }

        // Handle Bounded LLM Segment Grouping Repair (Deterministic + Idempotent)
        const groupingRejection = rejectedList.find((r: any) => r.rule === "GROUPING_INCOMPLETE");
        if (groupingRejection) {
          const missingPainIds: string[] = groupingRejection.missingPainIds || [];
          const canonicalMap = new Map<string, { claimId: string; claim: string; evidenceIds: string[] }>();
          for (const dp of discoveredPains) {
            canonicalMap.set(dp.claimId, dp);
          }
          const missingPains =
            groupingRejection.missingPains ||
            missingPainIds.map((id: string) => canonicalMap.get(id)).filter(Boolean);

          const existingSegmentsSummary = candidateSegments.map((s: any, idx: number) => ({
            segmentIndex: idx,
            segmentName: s.name,
            description: s.description || s.segmentDefinition?.claim,
            currentlyAssignedPainIds: (s.pains || []).map((p: any) => p.canonicalClaimId || p.claimId),
          }));

          const repairPrompt = `--- BOUNDED LLM SEGMENT GROUPING REPAIR ---
Structural completeness check failed: Certain canonical discovered pains were OMITTED from the 1-3 audience segments.

EXISTING VALID SEGMENTS & ASSIGNMENTS (LOCKED - PRESERVE THESE):
${JSON.stringify(existingSegmentsSummary, null, 2)}

MISSING CANONICAL PAINS TO ASSIGN:
${JSON.stringify(missingPains, null, 2)}

MANDATORY TASK:
Assign EACH of the MISSING CANONICAL PAINS to one of the existing segments (index 0, 1, or 2) where it best fits contextually.
Do NOT modify or remove existing valid assignments.
Do NOT create new segments.
Do NOT drop any missing pain.

OUTPUT SCHEMA:
Return JSON:
{
  "assignments": [
    {
      "claimId": "exact_missing_claimId",
      "assignToSegmentIndex": 0
    }
  ]
}`;

          const repairRes = await aiChat({
            model: "gpt-4.1-mini",
            messages: [{ role: "user", content: repairPrompt }],
            temperature: 0.1,
            max_tokens: 1500,
            response_format: { type: "json_object" },
            endpoint: "audience-engine-v3-grouping-repair",
            accountId,
          });

          const parsedRepair = safeJsonParse<any>(repairRes.choices[0]?.message?.content?.trim(), z.any());
          const assignments = Array.isArray(parsedRepair?.assignments) ? parsedRepair.assignments : [];

          const patchedSegments = applyGroupingRepairDeterministically(
            candidateSegments,
            assignments,
            discoveredPains,
          );

          return JSON.stringify(patchedSegments);
        }

        // Handle Segment Capacity Constraint Repair
        const capacityRejection = rejectedList.find((r: any) => r.rule === "SEGMENT_CAPACITY_CONSTRAINT");
        if (capacityRejection) {
          const consolidatePrompt = `--- BOUNDED LLM SEGMENT CONSOLIDATION REPAIR ---
Segment count exceeded maximum limit (must be strictly 1-3 segments).
Current segments (${candidateSegments.length}):
${JSON.stringify(candidateSegments, null, 2)}

TASK:
Consolidate these ${candidateSegments.length} segments into AT MOST 3 distinct segments.
You MUST preserve all assigned pains across the resulting 1-3 segments without dropping any pain.
Return ONLY valid JSON matching { "segments": [ ... ] } with at most 3 segments.`;

          const regenResponse = await aiChat({
            model: "gpt-4.1-mini",
            messages: [{ role: "user", content: consolidatePrompt }],
            temperature: 0.1,
            max_tokens: 4500,
            response_format: { type: "json_object" },
            endpoint: "audience-engine-v3-capacity-repair",
            accountId,
          });
          return regenResponse.choices[0]?.message?.content?.trim() || '{"segments":[]}';
        }

        if (
          rejectedList.some(
            (r: any) =>
              r.rule === "EMPTY_AUDIENCE" ||
              r.rule === "Structural Integrity" ||
              r.rejectionCode === "CONTRACT_FAILURE",
          )
        ) {
          const regenResponse = await aiChat({
            model: "gpt-4.1-mini",
            messages: [
              {
                role: "user",
                content:
                  input + '\n\nCRITICAL: Return ONLY a valid JSON object matching { "segments": [ ... ] }.',
              },
            ],
            temperature: 0.2,
            max_tokens: 4500,
            response_format: { type: "json_object" },
            endpoint: "audience-engine-v3-segments-regen",
            accountId,
          });
          return regenResponse.choices[0]?.message?.content?.trim() || '{"segments":[]}';
        }

        const repairDirectives = rejectedList
          .map((r: any) => {
            const code = r.rejectionCode || r.rule || "CLAIM_ERROR";
            const reason = r.critique || r.reason || "";
            const directive = r.repairDirective ? ` -> Directive: ${r.repairDirective}` : "";

            const cid = r.claimId || "unknown";
            return `[Claim ID: ${cid}] (${r.claimType || r.field || "field"} - ${code}): ${reason}${directive}`;
          })
          .join("\n");

        // Build explicitly structural patch prompt
        const attemptPrompt = `--- SYSTEM: REPAIR MODE (PATCH ONLY) ---
The Semantic Judge REJECTED one or more claims in your previous generation.
You must NOT regenerate the entire Audience. You must return ONLY a structural JSON patch describing how to fix or remove the rejected claims.

RAW EVIDENCE:
${formatEvidenceUnits(evidenceItems)}

REJECTED CLAIMS TO REPAIR / REMOVE:
${repairDirectives}

MANDATORY PATCH RULES:
1. ONLY rejected claims may be targeted. Accepted claims are LOCKED.
2. If evidence does not directly support an optional or non-core claim (desires, objections, motivations, outcomes, or secondary pains), return action: "REMOVE".
3. If a claim is replaced (action: "REPLACE"), the repaired claim MUST be a single coherent atomic claim directly grounded in the RAW EVIDENCE above, citing valid evidenceIds from RAW EVIDENCE.
4. If a compound claim is split (action: "SPLIT"), return an array of 2 or more distinct atomic claims under "splitClaims". Each split claim must have its own "claim" text and ONLY the specific "evidenceIds" from RAW EVIDENCE that directly support that individual claim. Do NOT copy evidenceIds blindly. Every split claim MUST cite at least 1 valid evidence unit.
5. Do NOT add ungrounded claims. Do NOT attempt to modify locked claims.

OUTPUT SCHEMA:
Return a JSON object with this exact structure:
{
  "repairs": [
    {
      "claimId": "exact_rejected_claimId",
      "action": "REMOVE" | "REPLACE" | "SPLIT",
      "repairedClaim": { "claim": "reworded atomic text grounded in raw evidence...", "evidenceIds": ["EV-1"] },
      "splitClaims": [
        { "claim": "first atomic problem grounded in evidence...", "evidenceIds": ["EV-1"] },
        { "claim": "second atomic problem grounded in evidence...", "evidenceIds": ["EV-2"] }
      ]
    }
  ]
}`;

        const response = await aiChat({
          model: "gpt-4.1-mini",
          messages: [{ role: "user", content: attemptPrompt }],
          temperature: 0.1,
          max_tokens: 2500,
          response_format: { type: "json_object" },
          endpoint: "audience-engine-v3-segments-repair",
          accountId,
        });

        const patchRaw = response.choices[0]?.message?.content?.trim() || '{"repairs":[]}';

        // Deterministic Structural Merge (segment-scoped so valid cross-segment pains are preserved)
        try {
          const patchObj = JSON.parse(patchRaw);
          const repairs = patchObj.repairs || [];

          const mergedSegments = JSON.parse(JSON.stringify(candidateSegments));

          const validPatches = new Map<string, any>();
          for (const patch of repairs) {
            if (!patch?.claimId) continue;
            const isRejected = rejectedList.some(
              (r: any) => r.claimId === patch.claimId || r.canonicalClaimId === patch.claimId,
            );
            if (isRejected) {
              validPatches.set(patch.claimId, patch);
            }
          }

          for (let sIdx = 0; sIdx < mergedSegments.length; sIdx++) {
            const seg = mergedSegments[sIdx];
            const segPrefix = seg.segmentDefinition?.claimId
              ? seg.segmentDefinition.claimId.split("_def")[0]
              : `seg_${sIdx + 1}`;
            const segId = seg.id || segPrefix;

            for (const key of ["pains", "desires", "objections", "motivations", "outcomes"]) {
              if (Array.isArray(seg[key])) {
                const updatedList: any[] = [];
                for (const c of seg[key]) {
                  const canonicalCid = c.canonicalClaimId || c.claimId;
                  const scopedEvalKey = `${segPrefix}::${canonicalCid}`;
                  const matchingRejection = rejectedList.find(
                    (r: any) =>
                      r.claimId === scopedEvalKey ||
                      (r.claimId === c.claimId &&
                        (!r.segmentId || r.segmentId === segId || r.segmentId === segPrefix)),
                  );
                  const patch =
                    validPatches.get(scopedEvalKey) ||
                    (matchingRejection ? validPatches.get(c.claimId) || validPatches.get(canonicalCid) : undefined);

                  if (patch && matchingRejection) {
                    if (patch.action === "REMOVE") {
                      continue;
                    }
                    if (patch.action === "REPLACE" && patch.repairedClaim) {
                      updatedList.push({
                        ...patch.repairedClaim,
                        claimId: c.claimId,
                        ...(c.canonicalClaimId ? { canonicalClaimId: c.canonicalClaimId } : {}),
                      });
                      continue;
                    }
                    if (patch.action === "SPLIT") {
                      const splitChildren = validateAndApplySplitClaim(c, patch);
                      updatedList.push(...splitChildren);
                      continue;
                    }
                  }
                  if (!matchingRejection) {
                    updatedList.push(c);
                  }
                }
                seg[key] = updatedList;
              }
            }
            for (const key of ["segmentDefinition", "role", "roleClaim"]) {
              if (seg[key]?.claimId) {
                const patch = validPatches.get(seg[key].claimId);
                if (patch && patch.action === "REPLACE" && patch.repairedClaim) {
                  Object.assign(seg[key], patch.repairedClaim, { claimId: seg[key].claimId });
                }
              }
            }
            refreshSegmentProfilesAndGrounding(seg);
          }

          // Prune empty segments that lost all core pains
          const survivingSegments = mergedSegments.filter((seg: any) => {
            return Array.isArray(seg.pains) && seg.pains.length > 0;
          });

          return JSON.stringify(survivingSegments);
        } catch (err: any) {
          console.error(`[AudienceEngine-V3] Structural patch merge failed: ${err.message}`);
          return failedCandidate;
        }
      },
    });
    rawSegments = repairRun.result;
  } catch (err: any) {
    if (err && typeof err === "object") {
      (err as any).judgeDiagnostics = runDiagnostics;
    }
    throw err;
  }

  const rawParsed = safeJsonParse<any>(rawSegments, z.any());
  const segsList = Array.isArray(rawParsed) ? rawParsed : (rawParsed?.segments || rawParsed?.candidateSegments || []);
  const acceptedSegments = segsList.map((s: any, idx: number) => normalizeSegmentCandidate(s, idx));

  if (!acceptedSegments || acceptedSegments.length === 0) {
     throw new LLMReliabilityError("Could not parse accepted segments JSON", "TECHNICAL_FAILURE");
  }

  const audGroundingRefs = acceptedSegments.flatMap((s: any) => Array.isArray(s.groundingRefs) ? s.groundingRefs.map(String) : []);
  checkGroundingContract({
    engine: "audience_segments",
    site: "segment_generation",
    groundingRefs: audGroundingRefs,
    ael: null,
    accountId,
  });

  if (aiPathSink) aiPathSink.emission = emissionFromBattery(true, segmentBatteryAttempts);
  
  const consolidatedSegments = await consolidateSegmentPainsSemantic(acceptedSegments, accountId, evidenceItems);

  return consolidatedSegments.map(seg => {
    const segPains = (seg.painProfile || []) as string[];
    const segDesires = (seg.desireProfile || []) as string[];
    const segObjections = (seg.objectionProfile || []) as string[];

    let painDesireMatchCount = 0;
    for (const p of segPains) {
      if (painMap.some(pm => pm.canonical.toLowerCase().includes(p.toLowerCase()))) painDesireMatchCount++;
    }
    for (const d of segDesires) {
      if (desireMap.some(dm => dm.canonical.toLowerCase().includes(d.toLowerCase()))) painDesireMatchCount++;
    }
    const totalProfileItems = segPains.length + segDesires.length;
    const signalCoverage = totalProfileItems > 0 ? Math.min(1, painDesireMatchCount / totalProfileItems) : 0;
    const painDesireDensity = Math.min(1, (painMap.length + desireMap.length) / 10);

    const allOtherSegments = consolidatedSegments.filter((s: any) => s.name !== seg.name);
    let avgSim = 0;
    if (allOtherSegments.length > 0) {
      let simSum = 0;
      for (const other of allOtherSegments) {
        const overlap = [...segPains, ...segDesires].filter(
          t => [...(other.painProfile || []), ...(other.desireProfile || [])].some(
            (o: string) => o.toLowerCase() === t.toLowerCase()
          )
        ).length;
        const totalTokens = new Set([...segPains, ...segDesires, ...(other.painProfile || []), ...(other.desireProfile || [])]).size;
        simSum += totalTokens > 0 ? overlap / totalTokens : 0;
      }
      avgSim = simSum / allOtherSegments.length;
    }
    const segmentDistinctiveness = 1 - avgSim;

    const evidenceSupport = Math.min(1, (segObjections.length > 0 ? 0.5 : 0) + (segPains.length >= 2 ? 0.3 : 0.1) + (segDesires.length >= 2 ? 0.2 : 0.1));

    const segmentConfidence = Math.round(Math.min(0.95, Math.max(0.05,
      signalCoverage * 0.40 + painDesireDensity * 0.30 + segmentDistinctiveness * 0.20 + evidenceSupport * 0.10
    )) * 1000) / 1000;

    return {
      ...seg,
      evidenceCount: painMap.length + desireMap.length + objectionMap.length,
      confidenceScore: segmentConfidence,
      sourceSignals: ["painMap", "desireMap", "objectionMap", "emotionalDrivers"],
      inputSnapshotId,
    };
  });
}

/**
 * Semantic root-pain consolidation: Merges claims within a segment that represent
 * the same underlying buyer problem + same causal business consequence into one canonical claim,
 * revalidates the merged wording against supporting evidence (with targeted repair or unmerge fallback),
 * and strictly preserves the union of all supporting evidenceIds (zero evidence loss).
 */
export async function consolidateSegmentPainsSemantic(
  segments: any[],
  accountId: string = "system",
  evidenceItems: AudienceEvidenceUnit[] = []
): Promise<any[]> {
  if (!Array.isArray(segments) || segments.length === 0) return segments;

  const resultSegments: any[] = [];

  for (const seg of segments) {
    const rawPains: Array<{ claimId: string; claim: string; evidenceIds: string[] }> = 
      Array.isArray(seg.pains) ? seg.pains : [];

    if (rawPains.length <= 1) {
      resultSegments.push(seg);
      continue;
    }

    try {
      const prompt = `You are the Semantic Pain Consolidation Judge.
Evaluate candidate pain claims within the audience segment "${seg.name || 'Segment'}" to determine if any represent the SAME ROOT PAIN (the same underlying buyer problem + same causal business consequence).

CANDIDATE PAIN CLAIMS:
${JSON.stringify(rawPains, null, 2)}

CONSOLIDATION RULES:
1. MERGE ONLY TRUE SAME-ROOT PAINS:
   - Merge claims ONLY when they represent ONE COHERENT CAUSAL CUSTOMER PROBLEM (the same underlying buyer problem + same causal business consequence).
   - The resulting merged claim MUST ITSELF REMAIN STRICTLY ATOMIC.
   - FORBIDDEN MERGES:
     * Claims from different lifecycle stages (e.g. pre-purchase price/sizing uncertainty vs product quality/defect vs post-purchase delivery/customer service/refund disputes) MUST REMAIN SEPARATE.
     * Claims with distinct product capability requirements (e.g. price/affordability vs sizing/fit vs fabric/material vs shipping speed) MUST REMAIN SEPARATE.
     * Do NOT merge claims merely because they were mentioned in the same review, share the same audience segment, or occurred in the same customer journey.
2. NO EVIDENCE LOSS (CRITICAL INVARIANT):
   - Every single evidenceId from all candidate claims MUST be preserved.
   - For merged claims, combine their evidenceIds into a unified list.
3. OUTPUT FORMAT:
   Return JSON only:
   {
     "canonicalPains": [
       {
         "claimId": "primary_claim_id",
         "claim": "Clear, unified canonical pain phrasing representing the single root problem",
         "evidenceIds": ["EV-1", "EV-2"]
       }
     ]
   }`;

      let proposedPains: Array<{ claimId: string; claim: string; evidenceIds: string[] }> = [];

      try {
        const aiRes = await aiChat({
          model: "gpt-4.1-mini",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.1,
          max_tokens: 2000,
          response_format: { type: "json_object" },
          endpoint: "audience-engine-v3-pain-consolidation",
          accountId,
        });
        let text = aiRes.choices[0]?.message?.content || "{}";
        text = text.replace(/^```json\s*/, "").replace(/\s*```$/, "").trim();
        const parsed = JSON.parse(text || "{}");
        if (Array.isArray(parsed.canonicalPains) && parsed.canonicalPains.length > 0) {
          proposedPains = parsed.canonicalPains;
        }
      } catch (err: any) {
        console.warn(`[AudienceEngine-V3] Pain consolidation LLM error: ${err.message}, falling back to original claims`);
        proposedPains = rawPains;
      }

      if (proposedPains.length === 0) {
        proposedPains = rawPains;
      }

      // PHASE 1 STEP 3: MERGED CLAIM EVIDENCE REVALIDATION & REPAIR
      const validatedPains: Array<{ claimId: string; claim: string; evidenceIds: string[] }> = [];

      for (const p of proposedPains) {
        const pEvidenceSet = new Set(p.evidenceIds || []);
        const constituentPains = rawPains.filter(rp => 
          (Array.isArray(rp.evidenceIds) && rp.evidenceIds.some(eid => pEvidenceSet.has(eid))) ||
          rp.claimId === p.claimId
        );

        // If this canonical pain was formed by merging multiple candidate claims, revalidate against evidence
        if (constituentPains.length >= 2) {
          try {
            const revalPrompt = `You are the Audience Merged-Claim Evidence Revalidation & Atomicity Judge.
Two or more candidate pain claims were semantically merged into one canonical pain phrasing.
Verify whether the proposed canonical phrasing is strictly and fully supported by the constituent candidate claims and cited evidence IDs (${p.evidenceIds.join(", ")}), AND whether it remains a single coherent atomic problem unit.

CONSTITUENT CANDIDATE CLAIMS MERGED:
${JSON.stringify(constituentPains, null, 2)}

PROPOSED CANONICAL PAIN PHRASING:
"${p.claim}"

EVALUATION CRITERIA:
1. "VALID": The canonical statement accurately captures ONE shared root problem without exaggeration AND remains strictly atomic (does not conjoin multiple distinct capability requirements or lifecycle stages).
2. "OVERSTATED": The canonical phrasing makes assertions that exceed what the constituent claims/evidence substantiate, but can be repaired into a single atomic statement. If so, you MUST provide a "repairedClaim".
3. "INVALID": The claims describe distinct problems, different lifecycle stages (e.g. product defect vs customer service/refunds), or require different capability solutions. They are compound and MUST NOT be merged. (Set status="INVALID", canMerge=false).

Output JSON only:
{
  "status": "VALID" | "OVERSTATED" | "INVALID",
  "repairedClaim": "Faithfully bounded atomic phrasing...",
  "canMerge": true
}`;

            let revalText = "";
            const aiReval = await aiChat({
              model: "gpt-4.1-mini",
              messages: [{ role: "user", content: revalPrompt }],
              temperature: 0.0,
              max_tokens: 1000,
              response_format: { type: "json_object" },
              endpoint: "audience-engine-v3-merged-claim-revalidation",
              accountId,
            });
            revalText = aiReval.choices[0]?.message?.content || "{}";

            revalText = revalText.replace(/^```json\s*/, "").replace(/\s*```$/, "").trim();
            const revalParsed = JSON.parse(revalText || "{}");

            if (revalParsed.status === "VALID" && revalParsed.canMerge !== false) {
              validatedPains.push(p);
            } else if (revalParsed.status === "OVERSTATED" && revalParsed.canMerge !== false && typeof revalParsed.repairedClaim === "string" && revalParsed.repairedClaim.trim().length > 0) {
              console.log(`[AudienceEngine-V3] Merged claim repaired from "${p.claim}" -> "${revalParsed.repairedClaim}"`);
              validatedPains.push({
                ...p,
                claim: revalParsed.repairedClaim.trim()
              });
            } else {
              // Merge rejected / compound / repair failed: Keep original distinct constituent claims
              console.warn(`[AudienceEngine-V3] Merged claim failed revalidation / atomicity check. Retaining ${constituentPains.length} original atomic claims.`);
              for (const cp of constituentPains) {
                if (!validatedPains.some(vp => vp.claimId === cp.claimId || (vp.claim === cp.claim && JSON.stringify(vp.evidenceIds) === JSON.stringify(cp.evidenceIds)))) {
                  validatedPains.push(cp);
                }
              }
            }
          } catch (revalErr: any) {
            console.warn(`[AudienceEngine-V3] Merged claim revalidation error: ${revalErr.message}, retaining proposed merge`);
            validatedPains.push(p);
          }
        } else {
          validatedPains.push(p);
        }
      }

      const consolidatedPains = validatedPains.length > 0 ? validatedPains : rawPains;

      // STRICT COMPLETENESS VALIDATION: Ensure no evidence UIDs were dropped
      const originalEvidenceSet = new Set(rawPains.flatMap(p => p.evidenceIds || []));
      const consolidatedEvidenceSet = new Set(consolidatedPains.flatMap(p => p.evidenceIds || []));

      // If any evidence UID was dropped by the LLM, re-attach to the primary surviving pain
      for (const eid of originalEvidenceSet) {
        if (!consolidatedEvidenceSet.has(eid)) {
          console.warn(`[AudienceEngine-V3] Preserving dropped evidenceId ${eid} during consolidation`);
          if (consolidatedPains[0]) {
            consolidatedPains[0].evidenceIds = Array.from(new Set([...(consolidatedPains[0].evidenceIds || []), eid]));
          }
        }
      }

      // Update segment pains and painProfile
      const updatedSeg = {
        ...seg,
        pains: consolidatedPains,
        painProfile: consolidatedPains.map(p => p.claim)
      };

      console.log(`[AudienceEngine-V3] Pain consolidation for segment "${seg.name}": ${rawPains.length} candidate claims -> ${consolidatedPains.length} canonical pains`);
      resultSegments.push(updatedSeg);
    } catch (segErr: any) {
      console.error(`[AudienceEngine-V3] Error in pain consolidation for segment ${seg.name}:`, segErr);
      resultSegments.push(seg);
    }
  }

  // Component 4: Structural Unique Claim ID Enforcement & Lineage
  // Enforce deterministic, non-colliding canonical claim IDs across all segments with lineage preservation
  const assignedPainIds = new Set<string>();
  for (let sIdx = 0; sIdx < resultSegments.length; sIdx++) {
    const seg = resultSegments[sIdx];
    const segPrefix = `seg_${sIdx + 1}`;
    if (Array.isArray(seg.pains)) {
      seg.pains = seg.pains.map((p: any, pIdx: number) => {
        const rawClaim = p.claim || p.canonical || p.pain || "";
        const cHash = computePainContentHash(rawClaim);
        let targetClaimId = `${segPrefix}_pain_${pIdx + 1}`;
        if (assignedPainIds.has(targetClaimId)) {
          targetClaimId = `${segPrefix}_pain_${pIdx + 1}_${cHash.slice(0, 6)}`;
        }
        assignedPainIds.add(targetClaimId);
        const originalClaimId = p.claimId || p.painId;
        const updatedPain = {
          ...p,
          claimId: targetClaimId,
          contentHash: cHash,
          ...(originalClaimId && originalClaimId !== targetClaimId ? { previousClaimId: originalClaimId } : {})
        };
        return updatedPain;
      });
      seg.painProfile = seg.pains.map((p: any) => p.claim);
    }
  }

  // Structural Invariant assertion: every pain ID must be unique
  const allFinalPainIds = resultSegments.flatMap((s: any) => (s.pains || []).map((p: any) => p.claimId));
  if (new Set(allFinalPainIds).size !== allFinalPainIds.length) {
    throw new Error(`DUPLICATE_CLAIM_IDS: Expected ${allFinalPainIds.length} unique claim IDs, but found ${new Set(allFinalPainIds).size}`);
  }

  return resultSegments;
}

const ADS_PRESCRIPTIVE_PATTERNS = [
  /\bset (?:your |the )?budget\b/i,
  /\ballocate \$?\d/i,
  /\bspend \$?\d/i,
  /\bdaily budget\b/i,
  /\blifetime budget\b/i,
  /\bcreate (?:a |an )?(?:ad set|campaign|ad group)\b/i,
  /\bgo to ads manager\b/i,
  /\bselect (?:conversion|traffic|reach) objective\b/i,
  /\bconfigure (?:the |your )?pixel\b/i,
  /\benable (?:CBO|ABO|advantage\+)\b/i,
  /\boptimize for (?:conversions|clicks|reach|impressions)\b/i,
  /\buse (?:automatic|manual) placements\b/i,
  /\bscale (?:the |your )?campaign\b/i,
  /\bincrease (?:the |your )?budget\b/i,
  /\ba\/b test (?:the |your )/i,
];

function sanitizeAdsTargetingHint(hint: AdsTargetingHint): AdsTargetingHint {
  if (hint.rationale) {
    for (const pattern of ADS_PRESCRIPTIVE_PATTERNS) {
      if (pattern.test(hint.rationale)) {
        hint.rationale = hint.rationale.replace(pattern, "[hint]").trim();
      }
    }
  }
  return hint;
}

async function translateToAdsTargeting(
  segments: AudienceSegment[],
  maturity: MaturityResult,
  businessContext: { industry: string; coreOffer: string; location: string },
  accountId: string,
  inputSnapshotId: string | null,
): Promise<AdsTargetingHint[]> {
  // Deterministic last-resort targeting — shared by the retry-exhaustion path
  // and the outer catch so a failure is NEVER silent (mode=fallback, logged).
  const adsFallback = (): AdsTargetingHint[] => [{
    suggestedInterests: [businessContext.industry],
    suggestedBehaviors: ["Engaged shoppers"],
    suggestedAgeRange: { min: 18, max: 55 },
    suggestedGender: "all",
    suggestedLocations: businessContext.location ? [businessContext.location] : ["Unspecified Target Market"],
    rationale: "Preliminary Meta Ads targeting hints (Proposed) — final platform and budget decisions governed by Channel Selection",
    evidenceCount: 0,
    confidenceScore: 0.2,
    sourceSignals: ["fallback"],
    inputSnapshotId,
  }];
  try {
    const prompt = `You are a Meta Ads targeting expert. Translate audience segments into Meta Ads Manager targeting suggestions.

BUSINESS: ${businessContext.industry} — ${businessContext.coreOffer}
LOCATION: ${businessContext.location || "Not specified"}
MARKET MATURITY: ${maturity.level}

SEGMENTS:
${segments.map(s => `- ${s.name}: Pains=${s.painProfile.join(", ")}. Desires=${s.desireProfile.join(", ")}. Objections=${s.objectionProfile.join(", ")}`).join("\n")}

For each segment, return:
{
  "suggestedInterests": ["real Meta interest categories"],
  "suggestedBehaviors": ["real Meta behavior targeting options"],
  "suggestedAgeRange": { "min": number, "max": number },
  "suggestedGender": "all" | "male" | "female",
  "suggestedLocations": ["country/region suggestions"],
  "rationale": "brief explanation"
}

Return ONLY a JSON array matching the segments count. Use real Meta Ads targeting options.`;

    // T8 (item 6): retry loop around the ads-targeting call — 3 total attempts,
    // temperature escalation 0.3 → 0.4 → 0.5, structured rejection feedback each
    // pass. Validation is STRUCTURAL ONLY (Zod schema + one-object-per-segment +
    // non-empty interests) — the breadth gate does NOT apply because Meta targeting
    // language (broad interests/behaviors/locations) is legitimately non-specific.
    const ADS_TEMPERATURE_LADDER = [0.3, 0.4, 0.5];
    const ADS_MAX_ATTEMPTS = 3;
    let adsRejectionFeedback = "";
    for (let attempt = 0; attempt < ADS_MAX_ATTEMPTS; attempt++) {
      const attemptTemp = ADS_TEMPERATURE_LADDER[Math.min(attempt, ADS_TEMPERATURE_LADDER.length - 1)];
      const attemptPrompt = adsRejectionFeedback
        ? `${prompt}\n\n--- RETRY DIRECTIVE ---\n${adsRejectionFeedback}`
        : prompt;
      try {
        const response = await aiChat({
          model: "gpt-4.1-mini",
          messages: [{ role: "user", content: attemptPrompt }],
          temperature: attemptTemp,
          max_tokens: 1500,
          endpoint: "audience-engine-v3-ads-targeting",
          accountId,
        });
        const content = response.choices[0]?.message?.content?.trim() || "[]";
        const parsed = safeJsonParse<z.infer<typeof AdsTargetingArraySchema>>(content, AdsTargetingArraySchema);
        if (!parsed) {
          adsRejectionFeedback = `Rejected by structural gate: output was not valid JSON or failed schema validation. Return a JSON array with one targeting object per segment. Fix exactly this.`;
          console.error(`[AudienceEngine-V3] ADS_TARGETING_GATE attempt ${attempt + 1}/${ADS_MAX_ATTEMPTS}: SCHEMA_REJECT`);
          continue;
        }
        if (parsed.length !== segments.length) {
          adsRejectionFeedback = `Rejected by structural gate: returned ${parsed.length} targeting object(s) but there are ${segments.length} segment(s). Return exactly one object per segment, in the same order. Fix exactly this.`;
          console.error(`[AudienceEngine-V3] ADS_TARGETING_GATE attempt ${attempt + 1}/${ADS_MAX_ATTEMPTS}: COUNT_MISMATCH | got=${parsed.length} expected=${segments.length}`);
          continue;
        }
        const emptyInterestIdx = parsed.findIndex(h => h.suggestedInterests.length === 0);
        if (emptyInterestIdx !== -1) {
          adsRejectionFeedback = `Rejected by structural gate: targeting object #${emptyInterestIdx + 1} has no suggestedInterests. Every segment needs at least one real Meta interest category. Fix exactly this.`;
          console.error(`[AudienceEngine-V3] ADS_TARGETING_GATE attempt ${attempt + 1}/${ADS_MAX_ATTEMPTS}: EMPTY_INTERESTS | idx=${emptyInterestIdx}`);
          continue;
        }
        console.log(`[AudienceEngine-V3] ADS_TARGETING_GATE: PASSED | attempt=${attempt + 1}/${ADS_MAX_ATTEMPTS} | hints=${parsed.length} | temp=${attemptTemp}`);
        return parsed.map(hint => sanitizeAdsTargetingHint({
          ...hint,
          evidenceCount: segments.length,
          confidenceScore: 0.6,
          sourceSignals: ["audienceSegments", "maturityIndex"],
          inputSnapshotId,
        }));
      } catch (attemptErr: any) {
        adsRejectionFeedback = `Rejected by parser: previous output could not be processed (${attemptErr.message}). Return ONLY a valid JSON array. Fix exactly this.`;
        console.error(`[AudienceEngine-V3] ADS_TARGETING_GATE attempt ${attempt + 1}/${ADS_MAX_ATTEMPTS}: AI_ERROR | ${attemptErr.message}`);
      }
    }
    console.error(`[AudienceEngine-V3] ADS_TARGETING_GATE: EXHAUSTED after ${ADS_MAX_ATTEMPTS} attempts — using deterministic fallback (mode=fallback, never silent)`);
    return adsFallback();
  } catch (err: any) {
    console.error("[AudienceEngine-V3] Ads targeting failed:", err.message);
    return adsFallback();
  }
}

export function buildCommercialAudienceSynthesis(params: {
  businessUnderstanding?: any;
  selectedOfferingId?: string;
  painMap?: SignalItem[];
  candidatePains?: any[];
  evidenceUnits?: AudienceEvidenceUnit[];
  productTruthFacts?: any[];
  currencyCode?: string;
}): CommercialAudienceSynthesis {
  const { businessUnderstanding, selectedOfferingId, evidenceUnits = [], productTruthFacts = [] } = params;
  const painMap: any[] = params.painMap || params.candidatePains || [];


  // 1. Identify selected offering and variant
  let offeringId = selectedOfferingId || "default_offering";
  let offeringName = "Primary Offering";
  let variantName: string | undefined = undefined;
  let scope = "Standard Commercial Scope";

  const offerings = businessUnderstanding?.offerings || (businessUnderstanding?.selectedOffering ? [businessUnderstanding.selectedOffering] : []);
  const matchedOffering = offerings.find((o: any) => o.id === selectedOfferingId || o.offeringId === selectedOfferingId) || offerings[0];
  if (matchedOffering) {
    offeringId = matchedOffering.id || matchedOffering.offeringId || offeringId;
    offeringName = matchedOffering.offeringName || matchedOffering.name || offeringName;
    variantName = matchedOffering.variantName || matchedOffering.selectedVariantName || undefined;
    scope = matchedOffering.scope || matchedOffering.unitQuantity || matchedOffering.description || scope;
  } else if (businessUnderstanding?.brandName || businessUnderstanding?.businessName) {
    offeringName = `${businessUnderstanding.brandName || businessUnderstanding.businessName} Flagship`;
  }

  // 2. Comparable competitors & strengths from evidence
  const competitorsList = businessUnderstanding?.competitors || [];
  const comparableCompetitors = competitorsList.map((comp: any) => {
    const compId = comp.id || comp.competitorId || "comp_unknown";
    const compName = comp.name || comp.competitorName || "Competitor";
    const compEvUnits = evidenceUnits.filter(e => (e as any).competitorId === compId || (e as any).competitorName === compName);
    const positiveReviews = compEvUnits.filter(e => (e as any).sentiment === "POSITIVE" || ((e as any).rating && (e as any).rating >= 4));
    const evRefs = compEvUnits.map(e => e.id || (e as any).externalId).filter(Boolean);
    return {
      competitorId: compId,
      competitorName: compName,
      productName: comp.offeringName || comp.productName || undefined,
      productOrServiceName: comp.offeringName || comp.productName || undefined,
      pricingContext: comp.pricing || comp.priceSummary || undefined,
      pricingSummary: comp.pricing || comp.priceSummary || undefined,
      evidenceReferences: evRefs,
      evidenceUids: evRefs,
      strengthsSupportedByReviews: positiveReviews.map(r => r.text.slice(0, 100)),
    };
  });

  // 3. Determine canonical offering/delivery modality from product truth & business understanding
  // Older snapshots missing classification fields or labeled "ecommerce" must NOT silently acquire physical-product shipping assumptions.
  const ptStatements = [
    ...productTruthFacts.map((f: any) => (typeof f === "string" ? f : f.statement || f.verifiedCapability || "")),
    matchedOffering?.offeringName,
    matchedOffering?.variantName,
    matchedOffering?.scope,
    matchedOffering?.description,
    businessUnderstanding?.coreOffer,
    businessUnderstanding?.valueProposition,
    businessUnderstanding?.productCategory,
  ].filter(Boolean);

  const offeringCorpus = ptStatements.join(" ").toLowerCase();
  const painCorpus = painMap.map(p => String(p?.canonical || "")).join(" ").toLowerCase();
  const explicitDeliveryModel = String(
    matchedOffering?.deliveryModel ||
    businessUnderstanding?.deliveryModel ||
    businessUnderstanding?.offeringType ||
    ""
  ).toUpperCase();

  const isDigitalOrServiceOffering =
    explicitDeliveryModel.includes("DIGITAL") ||
    explicitDeliveryModel.includes("SAAS") ||
    explicitDeliveryModel.includes("SERVICE") ||
    /\b(digital|custom song|personalized song|bespoke song|song|music|audio|mp3|wav|streaming|download|online platform|software|saas|web app|virtual)\b/i.test(offeringCorpus);

  const isPhysicalPerishableOrShipped =
    !isDigitalOrServiceOffering &&
    (explicitDeliveryModel.includes("PHYSICAL") ||
      /\b(courier|crush-proof|crush|perishable|baklava|pastry|packaging|box|parcel|thermal|shelf|warehouse)\b/i.test(`${offeringCorpus} ${painCorpus}`));

  const purchaseSituations = isPhysicalPerishableOrShipped
    ? [
        {
          situation: "Direct Customer Purchase / Gifting",
          context: "Buyer evaluates immediate arrival freshness, condition, and presentation.",
          suitability: "HIGH" as const,
        },
        {
          situation: "Cross-Border / Multi-Day Transit",
          context: "Requires durable packaging and thermal stability to avoid transit degradation.",
          suitability: "MEDIUM" as const,
        },
      ]
    : [
        {
          situation: "Milestone & Occasion Gifting / Direct Commissioning",
          context: "Buyer evaluates emotional personalization, creative fidelity to their brief, and predictable turnaround.",
          suitability: "HIGH" as const,
        },
        {
          situation: "Time-Sensitive / Multi-Stakeholder Ordering",
          context: "Buyer requires transparent revision terms, clear delivery timelines, and reliable access to completed deliverables.",
          suitability: "MEDIUM" as const,
        },
      ];

  // 4. Offering-to-need fit analysis
  const offeringNeedFit = painMap.slice(0, 8).map(pain => {
    const painText = pain.canonical.toLowerCase();
    const isTransitDamage =
      isPhysicalPerishableOrShipped &&
      (painText.includes("transit") || painText.includes("crush") || painText.includes("damage") || painText.includes("arrive"));
    const isFreshness =
      isPhysicalPerishableOrShipped &&
      (painText.includes("fresh") || painText.includes("shelf") || painText.includes("warehouse"));

    const relevantFacts = ptStatements.filter((stmt: string) => {
      const lower = stmt.toLowerCase();
      return painText.split(/\s+/).some(token => token.length > 4 && lower.includes(token));
    });

    let fitLevel: "DIRECT_FIT" | "STRATEGIC_FIT" | "NOT_FIT" | "UNKNOWN" = "UNKNOWN";
    let partialSupportReason: string | undefined = undefined;
    const unresolvedRequirements: string[] = [];

    if (isTransitDamage) {
      // Packaging alone does NOT prove crush-proof courier transit
      const hasPackaging = ptStatements.some((s: string) => s.toLowerCase().includes("packaging") || s.toLowerCase().includes("box") || s.toLowerCase().includes("pack"));
      const hasTransitTest = ptStatements.some((s: string) => s.toLowerCase().includes("crush-proof") || s.toLowerCase().includes("transit test") || s.toLowerCase().includes("courier certified"));
      if (hasPackaging && !hasTransitTest) {
        fitLevel = "STRATEGIC_FIT";
        partialSupportReason = "Protective packaging mitigates minor handling risk but does not guarantee crush-proof courier transit.";
        unresolvedRequirements.push("Crush-resistant outer courier packaging or carrier handling SLA verification");
      } else if (hasTransitTest) {
        fitLevel = "DIRECT_FIT";
      } else {
        fitLevel = "NOT_FIT";
        unresolvedRequirements.push("Verified protective transit packaging");
      }
    } else if (isFreshness) {
      const hasDailyBake = ptStatements.some((s: string) => s.toLowerCase().includes("daily") || s.toLowerCase().includes("fresh") || s.toLowerCase().includes("dispatch"));
      if (hasDailyBake) {
        fitLevel = "STRATEGIC_FIT";
        partialSupportReason = "Daily production/dispatch establishes preparation recency but does not prove warehouse comparison without competitor evidence.";
        unresolvedRequirements.push("Competitor storage/handling evidence to establish comparative freshness advantage");
      } else {
        fitLevel = "UNKNOWN";
      }
    } else if (relevantFacts.length > 0) {
      fitLevel = "DIRECT_FIT";
    } else if (isDigitalOrServiceOffering) {
      fitLevel = "STRATEGIC_FIT";
      partialSupportReason = "Offering addresses custom creative/digital fulfillment but specific SLA or policy terms for this pain require explicit product verification.";
      unresolvedRequirements.push("Verified turnaround SLA, revision policy, or deliverable access terms in product truth");
    }

    return {
      need: pain.canonical,
      fitLevel,
      supportedEvidence: relevantFacts,
      partialSupportReason,
      unresolvedRequirements,
    };
  });

  // 5. Package / quantity suitability
  const packageScopeSuitability = {
    unitQuantityOrScope: scope,
    suitabilityNotes: `Offering scope '${scope}' evaluated for individual and gift consumer needs.`,
    limitations: variantName ? [] : ["Specific variant/unit pricing not specified; evaluation uses standard catalog baseline."],
  };

  // 6. Price / value analysis
  const comparabilityLimitations = isPhysicalPerishableOrShipped
    ? [
        "Cross-currency prices must be normalized with explicit exchange basis before direct ranking.",
        "Competitor unit weights and bundled shipping vary across channels.",
      ]
    : [
        "Cross-currency prices must be normalized with explicit exchange basis before direct ranking.",
        "Competitor tier inclusions, revision allowances, and delivery speed add-ons vary across providers.",
      ];
  const hasCurrencyMismatch = competitorsList.some((c: any) => {
    const pricingStr = String(c.pricing || c.priceSummary || "");
    return (pricingStr.includes("LBP") && (params.currencyCode === "USD" || !pricingStr.includes("USD"))) ||
           (pricingStr.includes("EUR") && params.currencyCode === "USD");
  });
  if (hasCurrencyMismatch) {
    comparabilityLimitations.push("Incompatible currencies cannot be compared without explicit exchange rate basis.");
  }

  const unknownsList = isPhysicalPerishableOrShipped
    ? ["Exact courier transit insurance rates for cross-border delivery."]
    : ["Specific revision allowance and expedited turnaround fee structure not specified in verified product facts."];
  if (!matchedOffering?.pricing) {
    unknownsList.push("Offering variant pricing not specified in business understanding.");
  }

  const priceValueAnalysis = {
    pricePerception: "Mid-market value proposition based on observed market pricing.",
    comparabilityLimitations,
    unknowns: unknownsList,
  };

  // 7. Proposed improvements
  const proposedImprovements = isPhysicalPerishableOrShipped
    ? [
        {
          improvement: "Courier-certified shock-absorbing packaging for long-distance transit",
          status: "PROPOSED" as const,
          prerequisites: [
            "Supplier testing of rigid outer box liners",
            "Carrier drop-test certification under transit conditions",
          ],
        },
      ]
    : [
        {
          improvement: "Structured pre-delivery preview, clear revision terms, and transparent digital delivery milestones",
          status: "PROPOSED" as const,
          prerequisites: [
            "Define standard delivery turnaround window and revision scope in product truth",
            "Provide upfront audio/creative samples and clear usage terms before checkout",
          ],
        },
      ];

  return {
    selectedOffering: {
      offeringId,
      offeringName,
      variantName,
      scope,
    },
    comparableCompetitors,
    purchaseSituations,
    offeringNeedFit,
    packageScopeSuitability,
    priceValueAnalysis,
    proposedImprovements,
    // Flat compatibility aliases for UI ViewModel & test assertions
    selectedOfferingId: offeringId,
    selectedOfferingName: offeringName,
    selectedVariantName: variantName,
    selectedVariantScope: scope,
    selectedVariantPricing: matchedOffering?.pricing || null,
    offeringFitBreakdown: offeringNeedFit.map(f => ({
      need: f.need,
      fitType: f.fitLevel,
      provenClauses: f.supportedEvidence,
      unresolvedRequirements: f.unresolvedRequirements,
      prerequisites: f.partialSupportReason ? [f.partialSupportReason] : [],
    })),
    packageOrScopeSuitability: {
      suitabilityVerdict: (packageScopeSuitability.limitations.length > 0 ? "BORDERLINE" : "SUITABLE") as "SUITABLE" | "BORDERLINE" | "INSUFFICIENT_EVIDENCE",
      notes: packageScopeSuitability.suitabilityNotes,
    },
    priceValueLimitations: [
      ...priceValueAnalysis.comparabilityLimitations.map(lim => ({
        dimension: "Currency & Comparability",
        limitation: lim,
        unknownFactor: undefined,
      })),
      ...priceValueAnalysis.unknowns.map(unk => ({
        dimension: unk.includes("pricing") ? "Variant Pricing" : "Market Logistics",
        limitation: unk,
        unknownFactor: unk,
      })),
    ],
    proposedCapabilities: proposedImprovements.map(p => ({
      capability: p.improvement,
      status: p.status,
      prerequisites: p.prerequisites,
    })),
  };
}


function buildStructuredSignals(
  painMap: SignalItem[],
  desireMap: SignalItem[],
  objectionMap: SignalItem[],
  transformationMap: SignalItem[],
  emotionalDrivers: SignalItem[],
  awarenessLevel: AwarenessResult,
  intentDistribution: IntentDistribution,
  rootCauseMap?: SignalItem[],
  commercialSynthesis?: CommercialAudienceSynthesis,
): StructuredSignals {
  const toCluster = (items: SignalItem[], layer: "surface" | "pattern" | "interpretation"): StructuredSignalCluster[] =>
    items.map((item, i) => ({
      id: `${layer}_${i}_${item.canonical.replace(/\s+/g, "_").toLowerCase().slice(0, 30)}`,
      label: item.canonical,
      frequency: item.frequency,
      confidence: item.confidenceScore,
      evidence: item.evidence.slice(0, 3),
      sourceLayer: layer,
      // audience-confidence-v2 provenance (traceability — P-6.8)
      evidenceCount: item.evidenceCount,
      sourceTypes: item.sourceTypes,
      competitorIds: item.competitorIds,
      confidenceBreakdown: item.confidenceBreakdown,
    }));

  const pain_clusters = toCluster(painMap, "surface");
  const desire_clusters = toCluster(desireMap, "surface");

  const allFrequencyItems = [...painMap, ...desireMap, ...objectionMap].filter(s => s.frequency >= 2);
  const sortedByFreq = allFrequencyItems.sort((a, b) => b.frequency - a.frequency);
  const pattern_clusters = toCluster(sortedByFreq.slice(0, 10), "pattern");

  const rootCauseInputs: SignalItem[] = [];
  const highConfPains = painMap.filter(p => p.confidenceScore >= 0.4);
  const highConfObjections = objectionMap.filter(o => o.confidenceScore >= 0.3);

  for (const pain of highConfPains) {
    const relatedDriver = emotionalDrivers.find(d =>
      d.evidence.some(e => pain.evidence.some(pe => e.toLowerCase().includes(pe.toLowerCase().slice(0, 20)) || pe.toLowerCase().includes(e.toLowerCase().slice(0, 20))))
    );
    rootCauseInputs.push({
      ...pain,
      canonical: relatedDriver
        ? `${pain.canonical} driven by ${relatedDriver.canonical}`
        : `${pain.canonical} (recurring audience friction)`,
      confidenceScore: Math.min(0.95, pain.confidenceScore + (relatedDriver ? 0.1 : 0)),
    });
  }

  for (const obj of highConfObjections.slice(0, 3)) {
    if (!rootCauseInputs.some(r => r.canonical.toLowerCase().includes(obj.canonical.toLowerCase()))) {
      rootCauseInputs.push({
        ...obj,
        canonical: `Buying barrier: ${obj.canonical}`,
      });
    }
  }

  if (Array.isArray(rootCauseMap) && rootCauseMap.length > 0) {
    for (const rc of rootCauseMap) {
      if (!rootCauseInputs.some(r => r.canonical.toLowerCase().includes(rc.canonical.toLowerCase()))) {
        rootCauseInputs.push(rc);
      }
    }
  }

  const root_causes = toCluster(
    rootCauseInputs.sort((a, b) => b.confidenceScore - a.confidenceScore).slice(0, 8),
    "interpretation",
  );

  const psychDriverInputs: SignalItem[] = emotionalDrivers.map(d => ({
    ...d,
    canonical: d.canonical,
  }));

  if (awarenessLevel.level !== "insufficient_signals") {
    psychDriverInputs.push({
      canonical: `Awareness state: ${awarenessLevel.level} — audience ${awarenessLevel.level === "unaware" ? "doesn't know the problem exists" : awarenessLevel.level === "problem_aware" ? "feels the pain but doesn't know solutions" : awarenessLevel.level === "solution_aware" ? "knows solutions exist but hasn't chosen" : "is evaluating specific products"}`,
      frequency: awarenessLevel.evidenceCount,
      evidence: [],
      evidenceCount: awarenessLevel.evidenceCount,
      confidenceScore: awarenessLevel.confidenceScore,
      sourceSignals: ["awareness"],
      inputSnapshotId: awarenessLevel.inputSnapshotId,
    });
  }

  if (intentDistribution.totalClassified > 0) {
    const dominantIntent = intentDistribution.purchaseIntent >= 30 ? "purchase-ready"
      : intentDistribution.comparison >= 30 ? "comparison-shopping"
      : intentDistribution.learning >= 30 ? "learning-phase"
      : "curiosity-stage";
    psychDriverInputs.push({
      canonical: `Dominant intent: ${dominantIntent} (${intentDistribution.totalClassified} signals classified)`,
      frequency: intentDistribution.totalClassified,
      evidence: [],
      evidenceCount: intentDistribution.totalClassified,
      confidenceScore: intentDistribution.confidenceScore,
      sourceSignals: ["intent"],
      inputSnapshotId: null,
    });
  }

  for (const t of transformationMap.slice(0, 3)) {
    psychDriverInputs.push({
      ...t,
      canonical: `Desired transformation: ${t.canonical}`,
    });
  }

  const psychological_drivers = toCluster(
    psychDriverInputs.sort((a, b) => b.confidenceScore - a.confidenceScore).slice(0, 8),
    "interpretation",
  );

  return {
    pain_clusters,
    desire_clusters,
    pattern_clusters,
    root_causes,
    psychological_drivers,
    confidence_model: AUDIENCE_CONFIDENCE_MODEL_VERSION,
    commercialAudienceSynthesis: commercialSynthesis,
  };
}

const EMPTY_STRUCTURED_SIGNALS: StructuredSignals = {
  pain_clusters: [],
  desire_clusters: [],
  pattern_clusters: [],
  root_causes: [],
  psychological_drivers: [],
};

function buildEmptyResult(
  status: EngineStatus,
  statusMessage: string,
  inputSummary: AudienceEngineV3Result["inputSummary"],
  executionTimeMs: number,
  snapshotId: string,
): AudienceEngineV3Result {
  const emptyMeta: EvidenceMeta = { evidenceCount: 0, confidenceScore: 0, sourceSignals: [], inputSnapshotId: inputSummary.miSnapshotId };
  return {
    status,
    statusMessage,
    defensiveMode: status === "DEFENSIVE_MODE",
    languageSignals: { ...emptyMeta, problemExpressions: { count: 0, samples: [] }, questionPatterns: { count: 0, samples: [] }, goalExpressions: { count: 0, samples: [] }, totalAnalyzed: 0 },
    painMap: [],
    desireMap: [],
    objectionMap: [],
    transformationMap: [],
    emotionalDrivers: [],
    audienceSegments: [],
    segmentDensity: [],
    awarenessLevel: { ...emptyMeta, level: "insufficient_signals", distribution: {} },
    maturityIndex: { ...emptyMeta, level: "insufficient_signals", distribution: {}, indicators: [] },
    intentDistribution: { ...emptyMeta, curiosity: 0, learning: 0, comparison: 0, purchaseIntent: 0, totalClassified: 0 },
    adsTargetingHints: [],
    structuredSignals: EMPTY_STRUCTURED_SIGNALS,
    inputSummary,
    engineVersion: AUDIENCE_ENGINE_VERSION,
    executionTimeMs,
    snapshotId,
  };
}

export async function runAudienceEngine(
  accountId: string,
  campaignId: string,
  miSnapshotIdParam?: string,
  jobId?: string,
  strategic?: RunStrategicContext,
  options?: {
    approvedMarketVoiceEvidenceIds?: string[];
    evidenceManifest?: import("@shared/schema").EvidenceManifest | null;
    businessUnderstanding?: any;
    campaignOfferingId?: string;
  }
): Promise<AudienceEngineV3Result> {
  const startTime = Date.now();
  const effectiveJobId = jobId || `job_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  console.log(`[AudienceEngine-V3] Starting analysis for account=${accountId} campaign=${campaignId}${miSnapshotIdParam ? ` | run-scoped MI=${miSnapshotIdParam}` : " | unscoped (will resolve latest)"}`);

  let businessUnderstanding = options?.businessUnderstanding || (strategic as any)?.doctrine?.businessUnderstanding;
  if (!businessUnderstanding) {
    try {
      const { resolveCurrentBusinessUnderstanding } = await import("../business-understanding/resolver");
      const buResult = await resolveCurrentBusinessUnderstanding({
        accountId,
        campaignId,
        campaignOfferingId: options?.campaignOfferingId,
      });
      businessUnderstanding = buResult?.payload || buResult;
    } catch (e: any) {
      // Non-fatal BU resolution
    }
  }

  const [campaignRecord] = await db.select().from(growthCampaigns)
    .where(eq(growthCampaigns.id, campaignId))
    .limit(1);
  const [campaignSelectionRecord] = await db.select().from(campaignSelections)
    .where(
      accountId
        ? and(eq(campaignSelections.selectedCampaignId, campaignId), eq(campaignSelections.accountId, accountId))
        : eq(campaignSelections.selectedCampaignId, campaignId)
    )
    .limit(1);
  const resolvedTargetMarket = campaignSelectionRecord?.campaignLocation || (campaignRecord as any)?.targetMarket || "";

  let latestSnapshot: any = null;
  if (miSnapshotIdParam) {
    const [byId] = await db.select().from(miSnapshots)
      .where(and(
        eq(miSnapshots.id, miSnapshotIdParam),
        eq(miSnapshots.accountId, accountId),
        eq(miSnapshots.campaignId, campaignId),
      ))
      .limit(1);
    latestSnapshot = byId || null;
    if (!latestSnapshot) {
      console.log(`[AudienceEngine-V3] RUN_SCOPED_MI_NOT_FOUND | id=${miSnapshotIdParam} — failing fast (no latest fallback in scoped mode)`);
      const executionTimeMs = Date.now() - startTime;
      return buildEmptyResult(
        "MISSING_DEPENDENCY",
        `Run-scoped MI snapshot ${miSnapshotIdParam} not found for campaign ${campaignId}`,
        { postsAnalyzed: 0, commentsAnalyzed: 0, competitorsAnalyzed: 0, sanitizedCount: 0, miSnapshotId: miSnapshotIdParam, miSnapshotAge: null },
        executionTimeMs,
        "",
      );
    }
  } else {
    const [byLatest] = await db.select().from(miSnapshots)
      .where(and(
        eq(miSnapshots.accountId, accountId),
        eq(miSnapshots.campaignId, campaignId),
        inArray(miSnapshots.status, ["COMPLETE", "PARTIAL"]),
      ))
      .orderBy(desc(miSnapshots.createdAt))
      .limit(1);
    latestSnapshot = byLatest || null;
  }

  const miSnapshotId = latestSnapshot?.id || null;
  const miSnapshotAge = latestSnapshot?.createdAt
    ? `${Math.round((Date.now() - new Date(latestSnapshot.createdAt).getTime()) / 3600000)}h ago`
    : null;
  let miFreshnessMetadata: import("../shared/snapshot-trust").FreshnessMetadata | null = null;
  if (latestSnapshot) {
    const { logFreshnessTraceability, buildFreshnessMetadata } = await import("../shared/snapshot-trust");
    miFreshnessMetadata = buildFreshnessMetadata(latestSnapshot);
    logFreshnessTraceability("AudienceEngine", latestSnapshot, miFreshnessMetadata);

    if (miFreshnessMetadata.blockedForStrategy) {
      console.log(`[AudienceEngine-V3] MI freshness BLOCKED | class=${miFreshnessMetadata.freshnessClass} | age=${miFreshnessMetadata.ageInDays}d | trust=${miFreshnessMetadata.trustScore} | schema=${miFreshnessMetadata.schemaRecommendation}`);
      const executionTimeMs = Date.now() - startTime;
      return buildEmptyResult(
        "MISSING_DEPENDENCY",
        miFreshnessMetadata.warning || `MI data freshness check failed (${miFreshnessMetadata.freshnessClass}). Re-run Market Intelligence before audience analysis.`,
        { postsAnalyzed: 0, commentsAnalyzed: 0, competitorsAnalyzed: 0, sanitizedCount: 0, miSnapshotId: miSnapshotId, miSnapshotAge: miSnapshotAge },
        executionTimeMs,
        "",
      );
    }
  }
  if (latestSnapshot && latestSnapshot.analysisVersion !== undefined) {
    const { ENGINE_VERSION: MI_EV } = await import("../market-intelligence-v3/constants");
    if (latestSnapshot.analysisVersion !== MI_EV) {
      console.log(`[AudienceEngine-V3] MI snapshot version mismatch: got v${latestSnapshot.analysisVersion}, expected v${MI_EV} — results may use stale MI data`);
    }
  }

  const competitors = await db.select().from(ciCompetitors)
    .where(and(
      eq(ciCompetitors.accountId, accountId),
      or(eq(ciCompetitors.campaignId, campaignId), isNull(ciCompetitors.campaignId)),
      eq(ciCompetitors.isActive, true),
    ));

  const enrichedCount = competitors.filter(c => c.enrichmentStatus === "ENRICHED").length;
  const pendingCount = competitors.filter(c => c.enrichmentStatus === "PENDING" || !c.enrichmentStatus).length;
  if (competitors.length > 0) {
    console.log(`[AudienceEngine-V3] INVENTORY_STATUS | total=${competitors.length} | enriched=${enrichedCount} | pending=${pendingCount}`);
  }

  const competitorIds = competitors.map(c => c.id);
  const competitorCount = competitorIds.length;

  // 1. Ingest unified Canonical Customer Voice universe (Market Voice quotes as Primary, Instagram/TikTok comments as Supporting, Reviews & Benchmark)
  const rawCustomerUnits = await loadCanonicalCustomerVoice(accountId, campaignId, {
    approvedMarketVoiceEvidenceIds: options?.approvedMarketVoiceEvidenceIds,
    evidenceManifest: options?.evidenceManifest,
  });
  const primaryMarketVoiceCount = rawCustomerUnits.filter(u => u.evidencePool === "PRIMARY_MARKET_VOICE").length;
  const supportingSocialVoiceCount = rawCustomerUnits.filter(u => u.evidencePool === "SUPPORTING_SOCIAL_CUSTOMER_VOICE").length;
  const benchmarkContextCount = rawCustomerUnits.filter(u => u.evidencePool === "BENCHMARK_CONTEXT").length;
  const unresolvedExcludedCount = rawCustomerUnits.filter(u => u.evidencePool === "UNRESOLVED_EXCLUDED").length;

  // Fail closed: unresolved competitors are excluded from Audience reasoning
  const canonicalCustomerUnits = rawCustomerUnits.filter(u => u.evidencePool !== "UNRESOLVED_EXCLUDED");

  // 2. Ingest competitor-authored content (captions, formats, engagement)
  let posts: { caption: string | null; platform: string; competitorId: string }[] = [];
  if (competitorIds.length > 0) {
    const allowedPostIds = options?.evidenceManifest?.includedPostIds
      ? (options.evidenceManifest.includedPostIds as string[])
      : undefined;

    if (allowedPostIds !== undefined) {
      if (allowedPostIds.length > 0) {
        posts = await db.select({ 
          caption: ciCompetitorPosts.caption, 
          platform: ciCompetitorPosts.platform, 
          competitorId: ciCompetitorPosts.competitorId 
        })
          .from(ciCompetitorPosts)
          .where(and(
            inArray(ciCompetitorPosts.competitorId, competitorIds),
            inArray(ciCompetitorPosts.id, allowedPostIds)
          ))
          .orderBy(desc(ciCompetitorPosts.createdAt))
          .limit(AUDIENCE_THRESHOLDS.MAX_POSTS_TO_ANALYZE);
      } else {
        posts = [];
      }
    } else {
      const idList = sql.join(competitorIds.map(id => sql`${id}`), sql`, `);
      posts = await db.select({ 
        caption: ciCompetitorPosts.caption, 
        platform: ciCompetitorPosts.platform, 
        competitorId: ciCompetitorPosts.competitorId 
      })
        .from(ciCompetitorPosts)
        .where(sql`${ciCompetitorPosts.competitorId} IN (${idList})`)
        .orderBy(desc(ciCompetitorPosts.createdAt))
        .limit(AUDIENCE_THRESHOLDS.MAX_POSTS_TO_ANALYZE);
    }
  }

  const rawCaptionItems = posts
    .map(p => ({ text: p.caption, competitorId: p.competitorId }))
    .filter((i): i is { text: string; competitorId: string } => !!i.text && i.text.length > 5);

  const captionSanitized = sanitizeTextItems(rawCaptionItems);
  const captions = captionSanitized.clean.map(i => i.text);

  // Group Customer Voice items by Origin for downstream linguistic analysis
  const commentUnits = canonicalCustomerUnits.filter(u => u.origin === "COMPETITOR_COMMENT");
  const reviewUnits = canonicalCustomerUnits.filter(u => u.origin === "COMPETITOR_REVIEW");
  const marketVoiceUnits = canonicalCustomerUnits.filter(u => u.origin === "MARKET_VOICE");

  const mapCustomerUnitToRawItem = (u: (typeof canonicalCustomerUnits)[number], fallbackCompetitorId: string) => ({
    text: u.text,
    competitorId: u.competitorId || fallbackCompetitorId,
    actualCompetitorId: u.competitorId,
    competitorName: u.competitorName,
    canonicalEvidenceId: u.evidenceId,
    origin: u.origin,
    platform: u.platform,
    author: u.author,
    url: u.verificationProvenance?.sourceUrl,
    semanticScope: u.semanticScope,
    transferability: u.transferability,
    offeringId: u.offeringId,
    rawEvidenceReference: u.rawEvidenceReference,
  });

  const rawCommentItems = commentUnits
    .map(c => mapCustomerUnitToRawItem(c, "unknown"))
    .filter(i => !!i.text && i.text.length > 3);
  const rawReviewItems = reviewUnits
    .map(r => mapCustomerUnitToRawItem(r, "unknown"))
    .filter(i => !!i.text && i.text.length > 5);
  const rawMarketVoiceItems = marketVoiceUnits
    .map(m => mapCustomerUnitToRawItem(m, "market_voice"))
    .filter(i => !!i.text && i.text.length > 5);

  const commentSanitized = sanitizeTextItems(rawCommentItems);
  const commentTexts = commentSanitized.clean.map(i => i.text);
  const rawReviewTexts = rawReviewItems.map(i => i.text);
  const rawMarketVoiceTexts = rawMarketVoiceItems.map(i => i.text);
  const totalSanitized = captionSanitized.removed + commentSanitized.removed;

  const commentClassification = buildLabeledComments(commentSanitized.clean);
  const labeledComments = commentClassification.labeled;
  const labeledCaptions = buildLabeledCaptions(captionSanitized.clean);
  const labeledReviews = buildLabeledReviews(rawReviewItems);
  const labeledAllTexts: LabeledText[] = [...labeledComments, ...labeledCaptions, ...labeledReviews];
  const primaryDataStrength = computePrimaryDataStrength(labeledComments, labeledCaptions);

  console.log(
    `[AudienceEngine-V3] Canonical Customer Voice: ${canonicalCustomerUnits.length} active units (raw=${rawCustomerUnits.length})` +
    ` [PRIMARY_MARKET_VOICE=${primaryMarketVoiceCount}, SUPPORTING_SOCIAL=${supportingSocialVoiceCount}, BENCHMARK=${benchmarkContextCount}, UNRESOLVED_EXCLUDED=${unresolvedExcludedCount}]` +
    ` (comments=${commentUnits.length}, reviews=${reviewUnits.length}, marketVoice=${marketVoiceUnits.length})` +
    ` | Competitor posts=${posts.length} captions=${captions.length}` +
    ` | primaryStrength=${primaryDataStrength.toFixed(3)}`
  );

  const baseInputSummary = {
    postsAnalyzed: captions.length,
    commentsAnalyzed: commentTexts.length,
    competitorsAnalyzed: competitorCount,
    sanitizedCount: totalSanitized,
    reviewsAnalyzed: labeledReviews.length,
    tiktokAnalyzed: canonicalCustomerUnits.filter(u => u.platform === "tiktok").length,
    marketVoiceAnalyzed: marketVoiceUnits.length,
    evidencePools: {
      primaryMarketVoice: primaryMarketVoiceCount,
      supportingSocialVoice: supportingSocialVoiceCount,
      benchmarkContext: benchmarkContextCount,
      unresolvedExcluded: unresolvedExcludedCount,
    },
    commentQuality: {
      noise: commentClassification.noiseCount,
      low: commentClassification.lowCount,
      medium: commentClassification.mediumCount,
      high: commentClassification.highCount,
    },
    primaryDataStrength,
    confidenceModel: AUDIENCE_CONFIDENCE_MODEL_VERSION,
    miSnapshotId,
    miSnapshotAge,
    detectedMarkets: [] as string[],
  };



  const totalCustomerEvidence = canonicalCustomerUnits.length;
  const datasetTooSmall =
    (competitorCount < AUDIENCE_THRESHOLDS.MIN_COMPETITORS_FOR_ANALYSIS && totalCustomerEvidence < 5) ||
    (captions.length < AUDIENCE_THRESHOLDS.MIN_POSTS_FOR_ANALYSIS && totalCustomerEvidence < 5);

  let bridgeResult: SemanticBridgeResult | null = null;
  if (latestSnapshot) {
    if (!datasetTooSmall && primaryDataStrength >= BRIDGE_SUPPRESS_THRESHOLD) {
      console.log(
        `[AudienceEngine-V3] BRIDGE_SUPPRESSED | primaryStrength=${primaryDataStrength.toFixed(3)} >= threshold=${BRIDGE_SUPPRESS_THRESHOLD} | primary data is sufficient`
      );
    } else {
      bridgeResult = executeSemanticBridge(latestSnapshot);
      const bridgeValidation = validateBridgeIntegrity(bridgeResult);
      if (!bridgeValidation.valid) {
        console.log(`[AudienceEngine-V3] SEMANTIC_BRIDGE_VALIDATION_FAIL | issues=${bridgeValidation.issues.join("; ")}`);
        bridgeResult = null;
      } else {
        console.log(`[AudienceEngine-V3] SEMANTIC_BRIDGE_ACTIVE | pains=${bridgeResult.painSignals.length} | desires=${bridgeResult.desireSignals.length} | objections=${bridgeResult.objectionSignals.length} | integrity=${bridgeResult.bridgeIntegrity} | reason=${datasetTooSmall ? "dataset_too_small" : "primary_weak"}`);
      }
    }
  }

  const bridgeCanRescue = bridgeResult && bridgeResult.bridgeIntegrity && bridgeResult.totalPassed >= AUDIENCE_THRESHOLDS.MIN_SIGNAL_MATCHES_FOR_AI;

  if (datasetTooSmall) {
    if (bridgeCanRescue) {
      console.log(`[AudienceEngine-V3] DATASET_TOO_SMALL bypassed — Semantic Bridge provides ${bridgeResult!.totalPassed} quality-gated signals from MIv3 contentDnaData (bridge-only mode)`);
    } else {
      const msg = `DATASET TOO SMALL FOR RELIABLE AUDIENCE INTELLIGENCE — Need ≥${AUDIENCE_THRESHOLDS.MIN_COMPETITORS_FOR_ANALYSIS} competitors (have ${competitorCount}), ≥${AUDIENCE_THRESHOLDS.MIN_POSTS_FOR_ANALYSIS} posts (have ${captions.length}), comments available: ${commentTexts.length}${latestSnapshot ? `, bridge signals: ${bridgeResult?.totalPassed || 0}` : ", no MI snapshot"}`;
      console.log(`[AudienceEngine-V3] ${msg}`);

      const executionTimeMs = Date.now() - startTime;
      const [inserted] = await db.insert(audienceSnapshots).values({
        accountId, campaignId, jobId: effectiveJobId, miSnapshotId,
        engineVersion: AUDIENCE_ENGINE_VERSION,
        inputSummary: JSON.stringify({ ...baseInputSummary, status: "DATASET_TOO_SMALL", statusMessage: msg }),
        executionTimeMs,
      }).returning({ id: audienceSnapshots.id });

      await pruneOldSnapshots(db, audienceSnapshots, campaignId, 20, accountId);

      const emptyResult = buildEmptyResult("DATASET_TOO_SMALL", msg, baseInputSummary, executionTimeMs, inserted.id);
      return { ...emptyResult, freshnessMetadata: miFreshnessMetadata };
    }
  }

  if (commentTexts.length === 0) {
    console.log(`[AudienceEngine-V3] NO_COMMENT_TEXT — proceeding with ${captions.length} captions${bridgeCanRescue ? " + semantic bridge signals" : " only"}`);
  }

  const [campaign] = await db.select().from(growthCampaigns)
    .where(eq(growthCampaigns.id, campaignId))
    .limit(1);

  const productDna = await loadProductDNA(campaignId, accountId);

  // ── AUTHORITY VACUUM GUARD (Rule 11) ──
  // Canonical business authority (campaignOfferingId, targetRoles / target definition) must be available.
  // Audience generation MUST NOT proceed with competitor evidence alone if canonical authority is missing.
  if (!productDna || !productDna.campaignOfferingId || (!productDna.targetRoles?.length && !productDna.targetDecisionMaker && !productDna.targetAudienceSegment)) {
    console.error(`[AudienceEngine-V3] AUTHORITY_VACUUM | Canonical Business / Target Understanding is missing or incomplete for campaign=${campaignId}`);
    const executionTimeMs = Date.now() - startTime;
    const vacuumMsg = "AUTHORITY_VACUUM: Canonical Business Understanding or Target Understanding is missing. Cannot proceed with competitor evidence alone.";
    return {
      ...buildEmptyResult(
        "INCOMPLETE",
        vacuumMsg,
        baseInputSummary,
        executionTimeMs,
        "",
      ),
      failureAttribution: {
        category: "AUTHORITY_VACUUM",
        retryBudgetExhausted: false,
        attemptsUsed: 0,
        maxAttempts: 0,
        errorCode: "AUTHORITY_VACUUM",
        summary: vacuumMsg,
      },
    };
  }

  const primaryTarget = productDna.targetRoles?.map(r => `${r.roleTitle} (${r.roleType})`).join("; ")
    || productDna.targetDecisionMaker
    || productDna.targetAudienceSegment
    || "Target Market";

  // ── COMBINED CUSTOMER EVIDENCE READINESS & FINGERPRINT-PINNED SUFFICIENCY ──
  const readiness = await evaluateCombinedEvidenceReadiness({
    accountId,
    campaignId,
    campaignOfferingId: productDna.campaignOfferingId,
    approvedMarketVoiceEvidenceIds: options?.approvedMarketVoiceEvidenceIds,
    evidenceManifest: options?.evidenceManifest,
  });

  if (!readiness.isSufficient) {
    const msg = `PRIMARY_MARKET_VOICE_INCOMPLETE: Customer evidence corpus is semantically insufficient (${readiness.reason}). Category relevance: ${readiness.assessment.categoryRelevance}, Buyer authenticity: ${readiness.assessment.buyerAuthenticity}.`;
    console.error(`[AudienceEngine-V3] ${msg}`);
    const executionTimeMs = Date.now() - startTime;
    return {
      ...buildEmptyResult(
        "INCOMPLETE",
        msg,
        {
          ...baseInputSummary,
          corpusFingerprint: readiness.fingerprint,
          sufficiencyDetails: {
            verdict: readiness.assessment.verdict,
            reason: readiness.assessment.reason,
            categoryRelevance: readiness.assessment.categoryRelevance,
            buyerAuthenticity: readiness.assessment.buyerAuthenticity,
            substantiveThemesFound: readiness.assessment.substantiveThemesFound,
          },
        },
        executionTimeMs,
        ""
      ),
      failureAttribution: {
        category: "INSUFFICIENT_EVIDENCE",
        retryBudgetExhausted: false,
        attemptsUsed: 0,
        maxAttempts: 0,
        errorCode: "PRIMARY_MARKET_VOICE_INCOMPLETE",
        summary: msg,
      },
    };
  }

  const sufficiencyResult = readiness.assessment;
  (baseInputSummary as any).corpusFingerprint = readiness.fingerprint;
  (baseInputSummary as any).sufficiencyDetails = {
    verdict: readiness.assessment.verdict,
    reason: readiness.assessment.reason,
    categoryRelevance: readiness.assessment.categoryRelevance,
    buyerAuthenticity: readiness.assessment.buyerAuthenticity,
    substantiveThemesFound: readiness.assessment.substantiveThemesFound,
  };

  const businessContext = {
    industry: productDna.productCategory || productDna.businessType || campaign?.name || "General",
    coreOffer: productDna.coreOffer || campaign?.name || "Products/Services",
    targetAudience: primaryTarget,
    location: resolvedTargetMarket,
    productDna: productDna,
    campaignOfferingId: productDna.campaignOfferingId,
    businessUnderstandingId: productDna.businessUnderstandingAuthorityId,
    targetUnderstandingId: productDna.targetUnderstandingAuthorityId,
    productTruthFacts: productDna.productTruthFacts || [],
    targetRoles: productDna.targetRoles || [],
  };
  if (productDna) {
    console.log(`[AudienceEngine-V3] PRODUCT_DNA_LOADED | offering=${productDna.coreOffer} | category=${productDna.productCategory || "n/a"} | targetRoles=${(productDna.targetRoles || []).length} | truthFacts=${(productDna.productTruthFacts || []).length}`);
  }

  const allText = [...commentTexts, ...captions];

  const { markets: detectedMarkets, metadata: scopeMetadata } = detectMarketScope(allText, businessContext);
  baseInputSummary.detectedMarkets = detectedMarkets;
  console.log(`[AudienceEngine-V3] Market scope detected: ${detectedMarkets.join(", ")} | scopeConfidence=${scopeMetadata.scopeConfidence} | ambiguity=${scopeMetadata.scopeAmbiguityFlag}`);

  // ── DYNAMIC CUSTOMER VOICE SEMANTIC REASONING ──
  // Replaces domain-specific static dictionaries with dynamic LLM Reasoner + Hostile Semantic Judge
  const dynamicSemanticResult = await runDynamicCustomerVoiceExtraction({
    accountId,
    campaignId,
    competitors: competitors.map(c => ({
      id: c.id,
      name: c.name,
      websiteUrl: c.websiteUrl,
            platform: c.platform,
    })),
    customerEvidenceUnits: canonicalCustomerUnits,
    businessContext: {
      heroProduct: productDna?.coreOffer || campaign?.name || "Products/Services",
      businessName: campaign?.name || "Business",
      market: campaign?.targetMarket || "Target Market",
      category: productDna?.productCategory || "Apparel & Retail",
    },
  });

  const allCustomerVoiceTexts = canonicalCustomerUnits.map(u => u.text).filter(Boolean);
  const languageSignals = analyzeLanguage(allCustomerVoiceTexts, captions, miSnapshotId, competitorCount, rawReviewTexts, rawMarketVoiceTexts);

  let directPainMap: SignalItem[] = dynamicSemanticResult.pains.map(p => ({
    canonical: p.canonical,
    frequency: p.frequency,
    evidence: p.evidence,
    evidenceCount: p.evidenceCount,
    confidenceScore: p.confidenceScore,
    sourceSignals: p.sourceSignals,
    inputSnapshotId: miSnapshotId,
    sourceTypes: p.sourceTypes,
    competitorIds: p.competitorIds,
    confidenceBreakdown: p.confidenceBreakdown,
  }));

  let desireMap: SignalItem[] = dynamicSemanticResult.desires.map(d => ({
    canonical: d.canonical,
    frequency: d.frequency,
    evidence: d.evidence,
    evidenceCount: d.evidenceCount,
    confidenceScore: d.confidenceScore,
    sourceSignals: d.sourceSignals,
    inputSnapshotId: miSnapshotId,
    sourceTypes: d.sourceTypes,
    competitorIds: d.competitorIds,
    confidenceBreakdown: d.confidenceBreakdown,
  }));

  let objectionMap: SignalItem[] = dynamicSemanticResult.objections.map(o => ({
    canonical: o.canonical,
    frequency: o.frequency,
    evidence: o.evidence,
    evidenceCount: o.evidenceCount,
    confidenceScore: o.confidenceScore,
    sourceSignals: o.sourceSignals,
    inputSnapshotId: miSnapshotId,
    sourceTypes: o.sourceTypes,
    competitorIds: o.competitorIds,
    confidenceBreakdown: o.confidenceBreakdown,
  }));

  const transformationMap: SignalItem[] = dynamicSemanticResult.patterns.map(t => ({
    canonical: t.canonical,
    frequency: t.frequency,
    evidence: t.evidence,
    evidenceCount: t.evidenceCount,
    confidenceScore: t.confidenceScore,
    sourceSignals: t.sourceSignals,
    inputSnapshotId: miSnapshotId,
    sourceTypes: t.sourceTypes,
    competitorIds: t.competitorIds,
    confidenceBreakdown: t.confidenceBreakdown,
  }));

  const emotionalDrivers: SignalItem[] = dynamicSemanticResult.psychologicalDrivers.map(ed => ({
    canonical: ed.canonical,
    frequency: ed.frequency,
    evidence: ed.evidence,
    evidenceCount: ed.evidenceCount,
    confidenceScore: ed.confidenceScore,
    sourceSignals: ed.sourceSignals,
    inputSnapshotId: miSnapshotId,
    sourceTypes: ed.sourceTypes,
    competitorIds: ed.competitorIds,
    confidenceBreakdown: ed.confidenceBreakdown,
  }));

  const rootCauseMap: SignalItem[] = (dynamicSemanticResult.rootCauses || []).map(rc => ({
    canonical: rc.canonical,
    frequency: rc.frequency,
    evidence: rc.evidence,
    evidenceCount: rc.evidenceCount,
    confidenceScore: rc.confidenceScore,
    sourceSignals: rc.sourceSignals,
    inputSnapshotId: miSnapshotId,
    sourceTypes: rc.sourceTypes,
    competitorIds: rc.competitorIds,
    confidenceBreakdown: rc.confidenceBreakdown,
  }));

  const narrativeObjectionSignals = buildNarrativeObjectionSignals(latestSnapshot, miSnapshotId);
  if (narrativeObjectionSignals.length > 0) {
    const narrMerge = mergeNarrativeObjectionsIntoMap(objectionMap, narrativeObjectionSignals);
    objectionMap = narrMerge.merged;
    console.log(`[AudienceEngine-V3] NARRATIVE_OBJECTIONS_MERGED | ingested=${narrativeObjectionSignals.length} | added=${narrMerge.added} | reinforced=${narrMerge.reinforced} | total=${objectionMap.length}`);
  }

  let bridgePainSignals: SignalItem[] = [];
  let totalBridgeConflicts = 0;
  if (bridgeResult && bridgeResult.bridgeIntegrity) {
    const painMerge = mergeBridgedIntoAudienceMap(directPainMap, bridgeResult.painSignals, miSnapshotId);
    directPainMap = painMerge.merged;
    bridgePainSignals = bridgeResult.painSignals.map((bs: any) => ({
      canonical: bs.canonical,
      frequency: bs.frequency || 1,
      evidence: bs.evidence || [],
      evidenceCount: bs.evidenceCount || 1,
      confidenceScore: (typeof bs.confidenceScore === "number" ? bs.confidenceScore : 0) * 0.7,
      sourceSignals: [...(bs.sourceSignals || []), "bridge_signal"],
      inputSnapshotId: miSnapshotId,
    }));
    totalBridgeConflicts += painMerge.conflictsResolved;

    const desireMerge = mergeBridgedIntoAudienceMap(desireMap, bridgeResult.desireSignals, miSnapshotId);
    desireMap = desireMerge.merged;
    totalBridgeConflicts += desireMerge.conflictsResolved;

    const objectionMerge = mergeBridgedIntoAudienceMap(objectionMap, bridgeResult.objectionSignals, miSnapshotId);
    objectionMap = objectionMerge.merged;
    totalBridgeConflicts += objectionMerge.conflictsResolved;

    if (totalBridgeConflicts > 0) {
      console.log(`[AudienceEngine-V3] CONFLICT_RESOLUTION | conflictsResolved=${totalBridgeConflicts} | anchor=MIv3_QUALITY_GATED`);
    }
    console.log(`[AudienceEngine-V3] SEMANTIC_BRIDGE_MERGED | pains=${directPainMap.length} | desires=${desireMap.length} | objections=${objectionMap.length}`);
  }

  const qualifiedObjections = objectionMap.filter(o => o.confidenceScore >= 0.25 && o.evidenceCount >= 1);
  const qualifiedDrivers = emotionalDrivers.filter(d => d.confidenceScore >= 0.25 && d.evidenceCount >= 1);
  const objectionInferredPains = inferPainsFromObjections(qualifiedObjections, miSnapshotId).slice(0, 5);
  const driverInferredPains = inferPainsFromEmotionalDrivers(qualifiedDrivers, miSnapshotId).slice(0, 3);
  const { finalPainMap, painSources } = mergePainLayers(directPainMap, objectionInferredPains, driverInferredPains, bridgePainSignals);
  let painMap = finalPainMap;
  console.log(`[AudienceEngine-V3] PAIN_LAYERED_CONSTRUCTION | direct=${painSources.direct} | objectionInferred=${painSources.objectionInferred} | driverInferred=${painSources.driverInferred} | bridge=${painSources.bridge} | final=${painMap.length}`);

  let miObjectionDensity = 0;
  let miObjectionCount = 0;
  if (latestSnapshot?.objectionMapData) {
    try {
      const miObjMap = JSON.parse(latestSnapshot.objectionMapData);
      miObjectionDensity = miObjMap?.objectionDensity || 0;
      miObjectionCount = miObjMap?.totalObjectionsDetected || 0;
      if (miObjectionCount > 0) {
        console.log(`[AudienceEngine-V3] MI_NARRATIVE_OBJECTIONS | count=${miObjectionCount} | density=${miObjectionDensity} | multiCompetitor=${miObjMap?.objectionsFromMultipleCompetitors || 0}`);
      }
    } catch {}
  }

  const awarenessInput = commentTexts.length > 0 ? commentTexts : captions;
  const awarenessLevel = detectAwareness(awarenessInput, miSnapshotId, competitorCount, miObjectionDensity, miObjectionCount);
  const maturityIndex = detectMaturity(commentTexts, captions, miSnapshotId, competitorCount);
  const intentInput = commentTexts.length > 0 ? commentTexts : captions;
  const intentDistribution = classifyIntents(intentInput, miSnapshotId, competitorCount);
  const intentTemperature = deriveIntentTemperature(intentDistribution);
  console.log(`[AudienceEngine-V3] Intent temperature: ${intentTemperature} (curiosity=${intentDistribution.curiosity}% learning=${intentDistribution.learning}% comparison=${intentDistribution.comparison}% purchase=${intentDistribution.purchaseIntent}%)`);

  const totalSignalMatches = painMap.length + desireMap.length + objectionMap.length + transformationMap.length + emotionalDrivers.length + rootCauseMap.length;
  const totalSignalFrequency = [painMap, desireMap, objectionMap, transformationMap, emotionalDrivers, rootCauseMap]
    .flat().reduce((sum, s) => sum + s.frequency, 0);

  const dataReliability = sharedAssessDataReliability(
    competitorCount,
    totalSignalMatches,
    false,
    false,
    true,
    0.5,
  );
  if (dataReliability.isWeak) {
    console.log(`[AudienceEngine-V3] DATA_RELIABILITY_WEAK | reliability=${dataReliability.overallReliability.toFixed(3)} | advisories=${dataReliability.advisories.join("; ")}`);
  }

  const genericCheck = detectGenericOutput(allText.join(" ").substring(0, 2000));
  if (genericCheck.genericDetected) {
    console.log(`[AudienceEngine-V3] GENERIC_OUTPUT_DETECTED | penalty=${genericCheck.penalty.toFixed(3)} | matches=${genericCheck.genericPhrases.join(", ")}`);
  }

  const isDefensiveMode = totalSignalFrequency < AUDIENCE_THRESHOLDS.DEFENSIVE_MODE_SIGNAL_THRESHOLD && totalCustomerEvidence < AUDIENCE_THRESHOLDS.DEFENSIVE_MODE_SIGNAL_THRESHOLD;

  let audienceSegments: AudienceSegment[] = [];
  let adsTargetingHints: AdsTargetingHint[] = [];
  let selectedEvidenceUnits: AudienceEvidenceUnit[] = [];
  // Phase 4: constructSegments (the doctrine-battery path) writes its emission
  // here so the main return can surface it. Ads targeting is structural-only
  // (breadth gate N/A) and is intentionally excluded from AI-path telemetry.
  const audienceAiPathSink: { emission: EngineAiPathEmission | null } = { emission: null };

  const hasSufficientEvidence = readiness.isSufficient || totalSignalMatches >= AUDIENCE_THRESHOLDS.MIN_SIGNAL_MATCHES_FOR_AI;

  if (totalSignalMatches === 0 || (!hasSufficientEvidence && totalSignalMatches < AUDIENCE_THRESHOLDS.MIN_SIGNAL_MATCHES_FOR_AI)) {
    console.log(`[AudienceEngine-V3] INSUFFICIENT SIGNALS for AI layers — ${totalSignalMatches} signal matches (need ≥${AUDIENCE_THRESHOLDS.MIN_SIGNAL_MATCHES_FOR_AI})`);
  } else if (isDefensiveMode && !readiness.isSufficient) {
    console.log(`[AudienceEngine-V3] DEFENSIVE MODE — signal density too low (${totalSignalFrequency} total frequency), skipping AI layers`);
  } else {
    try {
      const allRawEvidence = [
        ...captionSanitized.clean.map(i => ({ text: i.text, competitorId: i.competitorId, sourceActor: "COMPETITOR_BRAND" })),
        ...commentSanitized.clean.map(i => ({
          text: i.text,
          sourceActor: "CUSTOMER_COMMENTER",
          canonicalEvidenceId: i.canonicalEvidenceId,
          origin: i.origin,
          competitorId: i.actualCompetitorId,
          competitorName: i.competitorName,
          platform: i.platform,
          author: i.author,
          url: i.url,
          semanticScope: i.semanticScope,
          transferability: i.transferability,
          offeringId: i.offeringId,
          rawEvidenceReference: i.rawEvidenceReference,
        })),
        ...rawReviewItems.map(i => ({
          text: i.text,
          sourceActor: "REVIEWER",
          canonicalEvidenceId: i.canonicalEvidenceId,
          origin: i.origin,
          competitorId: i.actualCompetitorId,
          competitorName: i.competitorName,
          platform: i.platform,
          author: i.author,
          url: i.url,
          semanticScope: i.semanticScope,
          transferability: i.transferability,
          offeringId: i.offeringId,
          rawEvidenceReference: i.rawEvidenceReference,
        })),
        ...rawMarketVoiceItems.map(i => ({
          text: i.text,
          sourceActor: "CUSTOMER_DISCUSSANT",
          canonicalEvidenceId: i.canonicalEvidenceId,
          origin: i.origin,
          competitorId: i.actualCompetitorId,
          competitorName: i.competitorName,
          platform: i.platform,
          author: i.author,
          url: i.url,
          semanticScope: i.semanticScope,
          transferability: i.transferability,
          offeringId: i.offeringId,
          rawEvidenceReference: i.rawEvidenceReference,
        })),
      ];

      const selectionResult = await selectEvidence(
        allRawEvidence,
        "AUDIENCE_DISCOVERY",
        JSON.stringify(businessContext),
        "gpt-4.1-mini", // Generator model
        "gpt-4o-mini" // Judge model
      );

      if (!selectionResult.valid) {
        const selectionFailMsg =
          "EVIDENCE_SELECTION_INCOMPLETE: Selection Judge rejected evidence payload after maximum retries. " +
          (selectionResult.rejectionReasons?.join("; ") || "");
        console.error(`[AudienceEngine-V3] ${selectionFailMsg}`);
        return {
          status: "INCOMPLETE",
          statusMessage: selectionFailMsg,
          defensiveMode: isDefensiveMode,
          languageSignals, painMap, desireMap, objectionMap, transformationMap, emotionalDrivers,
          audienceSegments: [], segmentDensity: [], awarenessLevel, maturityIndex, intentDistribution,
          adsTargetingHints: [], structuredSignals: buildStructuredSignals(painMap, desireMap, objectionMap, emotionalDrivers, transformationMap, awarenessLevel, intentDistribution, rootCauseMap),
          targetCoverage: {
            status: "NOT_EVALUATED",
            supportedTargetRoles: [],
            unsupportedTargetRoles: [],
            evidenceGap: false,
            reason: "Target coverage not evaluated due to incomplete audience evidence selection."
          },
          inputSummary: baseInputSummary,
          engineVersion: AUDIENCE_ENGINE_VERSION,
          executionTimeMs: Date.now() - startTime,
          snapshotId: "",
          failureAttribution: {
            category: "SEMANTIC_REJECTION",
            retryBudgetExhausted: true,
            attemptsUsed: 3,
            maxAttempts: 3,
            errorCode: "EVIDENCE_SELECTION_INCOMPLETE",
            summary: selectionFailMsg,
          },
        };
      }
      
      selectedEvidenceUnits = selectionResult.selectedUnits;
      const evidenceItems = selectedEvidenceUnits;

      const discoveredPains = await discoverAtomicAudiencePains(
        evidenceItems,
        {
          industry: businessContext.industry,
          coreOffer: businessContext.coreOffer,
          targetAudience: businessContext.targetAudience,
        },
        accountId,
      );
      console.log(`[AudienceEngine-V3] Discovered ${discoveredPains.length} atomic pains directly from customer evidence`);

      const rawSegments = await constructSegments(
        painMap, desireMap, objectionMap, emotionalDrivers,
        maturityIndex, awarenessLevel,
        businessContext, evidenceItems, accountId, miSnapshotId, strategic,
        audienceAiPathSink,
        discoveredPains,
      );

      audienceSegments = canonicalizeSegments(rawSegments);
      for (let sIdx = 0; sIdx < audienceSegments.length; sIdx++) {
        const seg = audienceSegments[sIdx];
        const segId = seg.id || `seg_${sIdx + 1}`;
        if (Array.isArray(seg.pains)) {
          seg.pains = seg.pains.map((p: any, pIdx: number) => {
            const baseId = p.claimId || `pain_${pIdx + 1}`;
            const occurrenceId = baseId.startsWith(`${segId}_`) ? baseId : `${segId}_${baseId}`;
            return {
              ...p,
              occurrenceId,
              canonicalClaimId: p.canonicalClaimId || baseId,
              claimId: occurrenceId,
            };
          });
        }
      }
      const finalPainIds = audienceSegments.flatMap((s: any) => (s.pains || []).map((p: any) => p.claimId));
      if (new Set(finalPainIds).size !== finalPainIds.length) {
        throw new Error(`DUPLICATE_CLAIM_IDS: Expected ${finalPainIds.length} unique claim IDs, but found ${new Set(finalPainIds).size}`);
      }
      console.log(`[AudienceEngine-V3] Canonicalization: ${rawSegments.length} raw → ${audienceSegments.length} canonical segments (${finalPainIds.length} unique pains)`);

      // Unify top-level painMap with canonical segment pains so audiencePains, structuredSignals,
      // and commercialSynthesis never contradict the canonical segment pain claims.
      const canonicalSegmentPains: SignalItem[] = [];
      const seenCanonPainText = new Set<string>();
      for (const seg of audienceSegments) {
        for (const p of (seg.pains || []) as any[]) {
          const text = String(p.claim || p.pain || p.canonical || p.statement || "").trim();
          if (!text) continue;
          const normKey = text.toLowerCase();
          if (seenCanonPainText.has(normKey)) continue;
          seenCanonPainText.add(normKey);
          const evIds = Array.isArray(p.evidenceIds) ? p.evidenceIds : [];
          canonicalSegmentPains.push({
            painId: p.claimId || p.canonicalClaimId || p.occurrenceId,
            id: p.claimId || p.canonicalClaimId || p.occurrenceId,
            canonical: text,
            frequency: Math.max(1, evIds.length || Number(p.frequency) || 1),
            evidence: Array.isArray(p.evidenceQuotes) ? p.evidenceQuotes.slice(0, 3) : (Array.isArray(p.evidence) ? p.evidence.slice(0, 3) : []),
            evidenceIds: evIds,
            evidenceCount: Math.max(1, evIds.length || Number(p.evidenceCount) || 1),
            confidenceScore: typeof p.confidence === "number" ? p.confidence : (typeof p.confidenceScore === "number" ? p.confidenceScore : 0.8),
            sourceSignals: ["canonical_segment_pain"],
            inputSnapshotId: miSnapshotId,
            segmentIds: [seg.id],
          } as any);
        }
      }
      if (canonicalSegmentPains.length > 0) {
        painMap = canonicalSegmentPains;
      }

      adsTargetingHints = await translateToAdsTargeting(
        audienceSegments, maturityIndex, businessContext, accountId, miSnapshotId,
      );
    } catch (err: any) {
      if (err instanceof LLMReliabilityError) {
        const diagnostics: AudienceJudgeDiagnosticEntry[] = Array.isArray((err as any)?.judgeDiagnostics)
          ? (err as any).judgeDiagnostics
          : getRecentAudienceJudgeDiagnostics({ accountId, campaignId });
        const { failureAttribution, statusMessage } = buildAudienceFailureAttribution(err, diagnostics);
        console.error(`[AudienceEngine-V3] ${statusMessage}. Returning INCOMPLETE state.`);
        return {
          status: "INCOMPLETE",
          statusMessage,
          defensiveMode: isDefensiveMode,
          languageSignals, painMap, desireMap, objectionMap, transformationMap, emotionalDrivers,
          audienceSegments: [], segmentDensity: [], awarenessLevel, maturityIndex, intentDistribution,
          adsTargetingHints: [], structuredSignals: buildStructuredSignals(painMap, desireMap, objectionMap, emotionalDrivers, transformationMap, awarenessLevel, intentDistribution),
          targetCoverage: {
            status: "NOT_EVALUATED",
            supportedTargetRoles: [],
            unsupportedTargetRoles: [],
            evidenceGap: false,
            reason: "Target coverage not evaluated due to incomplete audience status."
          },
          inputSummary: baseInputSummary,
          engineVersion: AUDIENCE_ENGINE_VERSION,
          executionTimeMs: Date.now() - startTime,
          snapshotId: "",
          failureAttribution,
          judgeDiagnostics: diagnostics,
        };
      }
      throw err;
    }
  }

  // ── INTELLIGENCE UPGRADE: Sophistication Tier Scoring (Schwartz tradition) ──
  let audienceSophistication: AudienceSophisticationOutput | null = null;
  if (audienceSegments.length > 0) {
    try {
      const competitorClaimsForSophistication: string[] = [];
      try {
        const latestMi = await db
          .select({ marketDiagnosis: miSnapshots.marketDiagnosis, opportunitySignals: miSnapshots.opportunitySignals })
          .from(miSnapshots)
          .where(eq(miSnapshots.id, miSnapshotId || ""))
          .limit(1);
        if (latestMi[0]) {
          const opps = JSON.parse((latestMi[0].opportunitySignals as any) || "[]");
          for (const o of opps.slice(0, 8)) {
            const c = typeof o === "string" ? o : (o.signal || o.text || o.claim || "");
            if (c) competitorClaimsForSophistication.push(c);
          }
        }
      } catch { /* ignore */ }

      audienceSophistication = await scoreAudienceSophistication({
        industry: businessContext.industry,
        coreOffer: businessContext.coreOffer,
        segments: audienceSegments.map(s => ({
          name: s.name,
          description: (s as any).description,
          painProfile: s.painProfile || [],
          desireProfile: s.desireProfile || [],
          objectionProfile: s.objectionProfile || [],
        })),
        comments: commentTexts,
        objections: objectionMap.slice(0, 12).map(o => o.canonical),
        marketDiagnosis: null,
        competitorClaims: competitorClaimsForSophistication,
        accountId,
      });

      if (audienceSophistication) {
        for (const segment of audienceSegments) {
          const profile = audienceSophistication.segments.find(p =>
            p.segmentName.toLowerCase().trim() === segment.name.toLowerCase().trim(),
          );
          if (profile) {
            (segment as any).sophisticationProfile = profile;
          }
        }
        console.log(`[AudienceEngine-V3] SOPHISTICATION_ATTACHED | globalTier=${audienceSophistication.globalTier} | segmentsScored=${audienceSophistication.segments.length}/${audienceSegments.length} | burnt=${audienceSophistication.marketIsBurnt}`);
      }
    } catch (sophErr: any) {
      console.error(`[AudienceEngine-V3] SOPHISTICATION_FAILED | ${sophErr.message}`);
    }
  }

  // ── PHASE 4 MARKETING-LOGIC UPGRADE: Buyer Psychology Profiler ──
  // Reasons about belief model + rejection history + decision trigger + identity aspiration
  // for the highest-density segment. Sophistication tier becomes a byproduct of belief-model
  // maturity, not the primary output. Cialdini leverages are psychology-matched, not category-default.
  let buyerPsychologyProfile: import("./buyer-psychology").BuyerPsychologyProfile | null = null;
  if (totalSignalMatches >= AUDIENCE_THRESHOLDS.MIN_SIGNAL_MATCHES_FOR_AI && audienceSegments.length > 0) {
    try {
      const { profileBuyerPsychology } = await import("./buyer-psychology");
      const targetSegment: any = audienceSegments[0];
      const rejectedClaimPatterns: string[] = [];
      const segProfile = (targetSegment as any)?.sophisticationProfile;
      if (segProfile?.rejectedClaimPatterns) {
        for (const p of segProfile.rejectedClaimPatterns) rejectedClaimPatterns.push(p.pattern);
      }
      const competitorClaimsForPsych: string[] = [];
      try {
        const latestMi2 = await db.select()
          .from(miSnapshots)
          .where(eq(miSnapshots.id, miSnapshotId || ""))
          .limit(1);
        if (latestMi2[0]) {
          const opps = JSON.parse((latestMi2[0].opportunitySignals as any) || "[]");
          for (const o of opps.slice(0, 8)) {
            const c = typeof o === "string" ? o : (o.signal || o.text || o.claim || "");
            if (c) competitorClaimsForPsych.push(c);
          }
        }
      } catch { /* ignore */ }

      buyerPsychologyProfile = await profileBuyerPsychology({
        segmentName: targetSegment.name || "Primary Segment",
        segmentDescription: (targetSegment as any).description || "",
        audiencePains: painMap.slice(0, 8).map(p => p.canonical),
        audienceDesires: desireMap.slice(0, 8).map(d => d.canonical),
        audienceObjections: objectionMap.slice(0, 8).map(o => o.canonical),
        buyerComments: commentTexts.slice(0, 8),
        competitorClaims: competitorClaimsForPsych,
        rejectedClaimPatterns,
        industry: businessContext.industry || "",
        coreOffer: businessContext.coreOffer || "",
        accountId,
      });
      if (buyerPsychologyProfile) {
        console.log(`[AudienceEngine-V3] BUYER_PSYCHOLOGY_ATTACHED | tier=${buyerPsychologyProfile.sophisticationByproduct.tier} | aspirational="${buyerPsychologyProfile.identityAspiration.aspirationalIdentity.slice(0, 50)}" | leverages=[${buyerPsychologyProfile.cialdiniLeverages.join(",")}] | retries=${buyerPsychologyProfile.retryCount}`);
      } else {
        console.log(`[AudienceEngine-V3] BUYER_PSYCHOLOGY_FALLBACK | profiler returned null — engine continuing with legacy output`);
      }
    } catch (psychErr: any) {
      console.error(`[AudienceEngine-V3] BUYER_PSYCHOLOGY_FAILED | ${psychErr.message} — engine continuing with legacy output`);
    }
  }

  const segmentDensity = computeSegmentDensity(painMap, desireMap, audienceSegments, miSnapshotId);

  let executionTimeMs = Date.now() - startTime;

  let status: string = "COMPLETE";
  let statusMessage: string = "";

  if (dynamicSemanticResult && (dynamicSemanticResult.status === "INCOMPLETE" || dynamicSemanticResult.providerFailure)) {
    status = "INCOMPLETE";
    statusMessage = `SEMANTIC_SYNTHESIS_INCOMPLETE: ${dynamicSemanticResult.statusMessage || "Semantic Reasoner failed during global audience synthesis"}`;
  } else if (totalSignalMatches === 0 || (!hasSufficientEvidence && totalSignalMatches < AUDIENCE_THRESHOLDS.MIN_SIGNAL_MATCHES_FOR_AI)) {
    status = "INSUFFICIENT_SIGNALS";
    statusMessage = "INSUFFICIENT DATA FOR RELIABLE AUDIENCE INTELLIGENCE — AI layers skipped due to weak signal coverage";
  } else if (awarenessLevel?.level === "insufficient_signals" && intentDistribution?.totalClassified === 0) {
    status = "INSUFFICIENT_SIGNALS";
    statusMessage = "Key classifiers returned insufficient signals — awareness and intent data unreliable";
  } else if (isDefensiveMode && !readiness.isSufficient) {
    status = "DEFENSIVE_MODE";
    statusMessage = "Low signal environment detected — Audience intelligence limited — More market data required";
  } else {
    // PARTIAL emission: engine produced usable
    // output but coverage is incomplete. Triggers when (a) signals are above
    // the AI floor but below the doubled "rich coverage" mark, OR (b) any of
    // the core maps came back empty, OR (c) no audience segments resolved.
    // Snapshot-reuse + System Control read this status verbatim.
    const richSignalFloor = AUDIENCE_THRESHOLDS.MIN_SIGNAL_MATCHES_FOR_AI * 2;
    const coreMaps = [painMap, desireMap, objectionMap];
    const anyEmpty = coreMaps.some((m) => !Array.isArray(m) || m.length === 0);
    if (totalSignalMatches < richSignalFloor || anyEmpty || (audienceSegments?.length ?? 0) === 0) {
      status = "PARTIAL";
      const reasons: string[] = [];
      if (totalSignalMatches < richSignalFloor) reasons.push(`signals=${totalSignalMatches}<${richSignalFloor}`);
      if (anyEmpty) reasons.push("core_map_empty");
      if ((audienceSegments?.length ?? 0) === 0) reasons.push("no_segments");
      statusMessage = `PARTIAL audience output — coverage incomplete (${reasons.join("; ")}); downstream engines must treat as low-confidence`;
    }
  }

  const inputSummary = {
    ...baseInputSummary,
    evidenceUnits: selectedEvidenceUnits,
    ...(bridgeResult ? {
      semanticBridge: {
        totalIngested: bridgeResult.totalIngested,
        totalPassed: bridgeResult.totalPassed,
        conflictsResolved: totalBridgeConflicts,
        bridgeIntegrity: bridgeResult.bridgeIntegrity,
        cleanPipeEnforced: bridgeResult.cleanPipeEnforced,
      },
    } : {}),
  };

  const audienceLineage: SignalLineageEntry[] = [];
  painMap.forEach((p: any, i: number) => {
    if (p.canonical) audienceLineage.push(createSourceLineageEntry("audience", "audience_pain", p.canonical, i, "competitor"));
  });
  desireMap.forEach((d: any, i: number) => {
    if (d.canonical) audienceLineage.push(createSourceLineageEntry("audience", "audience_desire", d.canonical, i, "competitor"));
  });
  objectionMap.forEach((o: any, i: number) => {
    if (o.canonical) audienceLineage.push(createSourceLineageEntry("audience", "audience_objection", o.canonical, i, "competitor"));
  });
  (emotionalDrivers || []).forEach((d: any, i: number) => {
    const text = typeof d === "string" ? d : (d?.driver || d?.description || d?.canonical || "");
    if (text) audienceLineage.push(createSourceLineageEntry("audience", "emotional_driver", text, i, "competitor"));
  });
  if (bridgeResult && bridgeResult.bridgeIntegrity) {
    const allBridgedSignals = [...bridgeResult.painSignals, ...bridgeResult.desireSignals, ...bridgeResult.objectionSignals];
    allBridgedSignals.forEach((bs, i) => {
      audienceLineage.push(createSourceLineageEntry(
        "audience",
        `bridge_${bs.category}_${bs.bridgeSource}`,
        `${bs.canonical} [parent:${bs.parentSignalId}]`,
        i,
        "competitor",
      ));
    });
  }
  console.log(`[AudienceEngine-V3] LINEAGE_GENERATED | entries=${audienceLineage.length} | pains=${painMap.length} | desires=${desireMap.length} | objections=${objectionMap.length} | bridged=${bridgeResult?.totalPassed || 0}`);

  const commercialSynthesis = buildCommercialAudienceSynthesis({
    businessUnderstanding,
    selectedOfferingId: options?.campaignOfferingId,
    painMap,
    evidenceUnits: selectedEvidenceUnits,
    productTruthFacts: productDna?.productTruthFacts || [],
  });

  const structuredSignals = buildStructuredSignals(
    painMap, desireMap, objectionMap, transformationMap, emotionalDrivers,
    awarenessLevel, intentDistribution, rootCauseMap,
    commercialSynthesis,
  );
  console.log(`[AudienceEngine-V3] STRUCTURED_SIGNALS | pains=${structuredSignals.pain_clusters.length} | desires=${structuredSignals.desire_clusters.length} | patterns=${structuredSignals.pattern_clusters.length} | rootCauses=${structuredSignals.root_causes.length} | psychDrivers=${structuredSignals.psychological_drivers.length}`);

  const targetCoverage = await evaluateTargetCoverage(
    campaignId,
    accountId,
    audienceSegments,
    status,
    { campaignId, accountId }
  );

  executionTimeMs = Date.now() - startTime;
  const [inserted] = await db.insert(audienceSnapshots).values({
    accountId, campaignId, jobId: effectiveJobId, miSnapshotId,
    engineVersion: AUDIENCE_ENGINE_VERSION,
    languageSignals: JSON.stringify(languageSignals),
    audiencePains: JSON.stringify(painMap),
    desireMap: JSON.stringify(desireMap),
    objectionMap: JSON.stringify(objectionMap),
    transformationMap: JSON.stringify(transformationMap),
    emotionalDrivers: JSON.stringify(emotionalDrivers),
    audienceSegments: JSON.stringify(audienceSegments),
    segmentDensity: JSON.stringify(segmentDensity),
    awarenessLevel: JSON.stringify(awarenessLevel),
    maturityIndex: JSON.stringify(maturityIndex),
    audienceIntentDistribution: JSON.stringify(intentDistribution),
    adsTargetingHints: JSON.stringify(adsTargetingHints),
    inputSummary: JSON.stringify(inputSummary),
    signalLineage: JSON.stringify(audienceLineage),
    structuredSignals: JSON.stringify(structuredSignals),
    targetCoverage: JSON.stringify(targetCoverage),
    executionTimeMs,
  }).returning({ id: audienceSnapshots.id });

  await pruneOldSnapshots(db, audienceSnapshots, campaignId, 20, accountId);

  try {
    const { invalidateDownstreamOnRegeneration } = await import("../shared/strategy-root");
    const inv = await invalidateDownstreamOnRegeneration(campaignId, accountId, "audience");
    if (inv.supersededRoots > 0) {
      console.log(`[AudienceEngine-V3] ROOT_INVALIDATED | superseded=${inv.supersededRoots}`);
    }
  } catch (invErr: any) {
    console.error(`[AudienceEngine-V3] Root invalidation failed (non-blocking): ${invErr.message}`);
  }

  console.log(`[AudienceEngine-V3] ${status} in ${executionTimeMs}ms | snapshot=${inserted.id} | signals=${totalSignalMatches} | freq=${totalSignalFrequency} | segments=${audienceSegments.length} | defensive=${isDefensiveMode} | coverage=${targetCoverage?.status}`);

  return {
    status,
    statusMessage,
    aiPathTelemetry: audienceAiPathSink.emission
      ? audienceAiPathSink.emission
      : { mode: "fallback", attempts: 0, failedGates: [], fallbackReason: "segments_not_constructed" },
    defensiveMode: isDefensiveMode,
    languageSignals,
    painMap,
    desireMap,
    objectionMap,
    transformationMap,
    emotionalDrivers,
    audienceSegments,
    segmentDensity,
    awarenessLevel,
    maturityIndex,
    intentDistribution,
    adsTargetingHints,
    structuredSignals,
    commercialAudienceSynthesis: commercialSynthesis,
    targetCoverage,
    productTruthFacts: productDna?.productTruthFacts || [],
    evidenceUnits: selectedEvidenceUnits,
    inputSummary,
    confidenceScore: 0.85,
    dataReliability,
    engineVersion: AUDIENCE_ENGINE_VERSION,
    executionTimeMs,
    snapshotId: inserted.id,
    freshnessMetadata: miFreshnessMetadata,
  };
}

export async function getLatestAudienceSnapshot(accountId: string, campaignId: string, runId?: string | null) {
  const baseFilters = [
    eq(audienceSnapshots.accountId, accountId),
    eq(audienceSnapshots.campaignId, campaignId),
  ];
  if (runId) baseFilters.push(eq(audienceSnapshots.jobId, runId));
  const query = db.select().from(audienceSnapshots).where(and(...baseFilters));
  const [snapshot] = runId
    ? await query.limit(1)
    : await query.orderBy(desc(audienceSnapshots.createdAt)).limit(1);

  if (!snapshot) return null;

  if (!runId) {
    try {
      const [latestJob] = await db
        .select({
          id: orchestratorJobs.id,
          status: orchestratorJobs.status,
          error: orchestratorJobs.error,
          sectionStatuses: orchestratorJobs.sectionStatuses,
          createdAt: orchestratorJobs.createdAt,
        })
        .from(orchestratorJobs)
        .where(
          and(
            eq(orchestratorJobs.accountId, accountId),
            eq(orchestratorJobs.campaignId, campaignId),
          ),
        )
        .orderBy(desc(orchestratorJobs.createdAt))
        .limit(1);

      const snapJobId = snapshot.jobId || (snapshot as any).runId;
      if (latestJob && latestJob.id !== snapJobId) {
        const jobTime = latestJob.createdAt ? new Date(latestJob.createdAt).getTime() : 0;
        const snapTime = snapshot.createdAt ? new Date(snapshot.createdAt).getTime() : 0;
        if (jobTime >= snapTime) {
          let audSectionStatus: string | undefined;
          try {
            const parsedSections = latestJob.sectionStatuses ? JSON.parse(latestJob.sectionStatuses) : null;
            if (Array.isArray(parsedSections)) {
              audSectionStatus = parsedSections.find((s: any) => s && s.id === "audience")?.status;
            } else if (parsedSections && typeof parsedSections === "object") {
              audSectionStatus = parsedSections.audience?.status;
            }
          } catch {}
          const failedEngineField = (latestJob as any).failedEngine;
          const audienceFailedInLatestRun =
            audSectionStatus === "BLOCKED" ||
            audSectionStatus === "FAILED" ||
            audSectionStatus === "ERROR" ||
            audSectionStatus === "INCOMPLETE" ||
            ((latestJob.status === "BLOCKED" || latestJob.status === "FAILED") &&
              ((typeof failedEngineField === "string" &&
                failedEngineField.toLowerCase().includes("audience")) ||
                (typeof latestJob.error === "string" &&
                  /Blocked at Audience/i.test(latestJob.error))));
          if (audienceFailedInLatestRun) {
            return null;
          }
        }
      }
    } catch {}
  }

  let freshnessMetadata = null;
  if (snapshot.miSnapshotId) {
    const [miSnap] = await db.select().from(miSnapshots)
      .where(and(eq(miSnapshots.id, snapshot.miSnapshotId), eq(miSnapshots.accountId, accountId)))
      .limit(1);
    if (miSnap) {
      const { buildFreshnessMetadata } = await import("../shared/snapshot-trust");
      freshnessMetadata = buildFreshnessMetadata(miSnap);
    }
  }

  const parsedStructuredSignals: StructuredSignals = JSON.parse(
    snapshot.structuredSignals || '{"pain_clusters":[],"desire_clusters":[],"pattern_clusters":[],"root_causes":[],"psychological_drivers":[]}'
  );

  return {
    ...snapshot,
    languageSignals: JSON.parse(snapshot.languageSignals || "{}"),
    painMap: JSON.parse(snapshot.audiencePains || "[]"),
    desireMap: JSON.parse(snapshot.desireMap || "[]"),
    objectionMap: JSON.parse(snapshot.objectionMap || "[]"),
    transformationMap: JSON.parse(snapshot.transformationMap || "[]"),
    emotionalDrivers: JSON.parse(snapshot.emotionalDrivers || "[]"),
    audienceSegments: JSON.parse(snapshot.audienceSegments || "[]"),
    segmentDensity: JSON.parse(snapshot.segmentDensity || "[]"),
    awarenessLevel: JSON.parse(snapshot.awarenessLevel || "{}"),
    maturityIndex: JSON.parse(snapshot.maturityIndex || "{}"),
    intentDistribution: JSON.parse(snapshot.audienceIntentDistribution || "{}"),
    adsTargetingHints: JSON.parse(snapshot.adsTargetingHints || "[]"),
    structuredSignals: parsedStructuredSignals,
    commercialAudienceSynthesis: parsedStructuredSignals.commercialAudienceSynthesis || null,
    inputSummary: JSON.parse(snapshot.inputSummary || "{}"),
    evidenceUnits: JSON.parse(snapshot.inputSummary || "{}")?.evidenceUnits || [],
    productTruthFacts: JSON.parse(snapshot.inputSummary || "{}")?.productTruthFacts || [],
    freshnessMetadata,
  };
}

export {
  detectMarketScope,
  getMarketScopeMetadata,
  filterClustersByMarket,
  applyObjectionContextRules,
  applyEvidenceIntegrityFilter,
  computeSegmentSimilarity,
  canonicalizeSegments,
  computeSegmentDensity,
  deriveIntentTemperature,
};
