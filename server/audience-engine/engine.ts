import { deriveValidatedCapabilities } from "../shared/capability-registry";
import { db } from "../db";
import { audienceSnapshots, miSnapshots, ciCompetitors, ciCompetitorPosts, ciCompetitorComments, ciCompetitorReviews, growthCampaigns } from "@shared/schema";
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
import { aiChat, aiGemini } from "../ai-client";
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

export interface StructuredSignals {
  pain_clusters: StructuredSignalCluster[];
  desire_clusters: StructuredSignalCluster[];
  pattern_clusters: StructuredSignalCluster[];
  root_causes: StructuredSignalCluster[];
  psychological_drivers: StructuredSignalCluster[];
  /** Confidence model version used to score these signals (absent = v1). */
  confidence_model?: string;
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
  audienceSophistication?: import("./sophistication-llm").AudienceSophisticationOutput | null;
  buyerPsychologyProfile?: import("./buyer-psychology").BuyerPsychologyProfile | null;
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
      if (typeof item === "object" && item !== null && item.claim) {
        return {
          claimId: item.claimId || `${segPrefix}_${fieldName}_${idx + 1}`,
          claim: item.claim,
          evidenceIds: Array.isArray(item.evidenceIds) ? item.evidenceIds : (Array.isArray(seg.groundingRefs) ? seg.groundingRefs : []),
        };
      }
      return {
        claimId: `${segPrefix}_${fieldName}_${idx + 1}`,
        claim: String(item),
        evidenceIds: Array.isArray(seg.groundingRefs) ? seg.groundingRefs : [],
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

async function constructSegments(
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
): Promise<AudienceSegment[]> {
  const segmentBatteryAttempts: BatteryAttemptLike[] = [];

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
  if (strategic) {
    doctrineBlock = buildDoctrineBlock(strategic);
  } else {
    console.log("[AudienceEngine-V3] DOCTRINE_ABSENT — no strategic context threaded; omitting doctrine block");
  }

  let productAnchor = strategic ? strategic.doctrine.productAnchor : null;
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
  const priorDecisions = strategic ? strategic.priorDecisions : [];
  let audienceAnchorSource: "doctrine" | "dna" | "none" = "none";
  if (strategic && strategic.doctrine.productAnchor) {
    audienceAnchorSource = "doctrine";
  } else if (productAnchor) {
    audienceAnchorSource = "dna";
  }
  console.log(`[AudienceEngine-V3] ANCHOR_EVIDENCE | engine=audience | site=first_prompt | attempt=1 | present=${productAnchor ? "yes" : "no"} | source=${audienceAnchorSource}`);

  const audEffectiveAnchor = (strategic && strategic.doctrine.productAnchor) ? strategic.doctrine.productAnchor : (productAnchor || null);

  const basePrompt = `You are the Audience Analysis Engine deriving audience intelligence strictly from Judge-approved evidence.

PERMANENT PRINCIPLE: EVIDENCE DECIDES COMPLETENESS. SCHEMA DOES NOT.
Do not populate optional fields (desires, objections, motivations, outcomes) unless evidence explicitly supports them.
Empty arrays are valid and expected when evidence is absent.
Do NOT weaken evidence standards to fill schema fields.
- Every claim MUST carry its own stable claimId and specific evidence IDs (e.g. claimId: "seg_1_pain_1", evidenceIds: ["EV-2", "EV-3"]).
- Do NOT use evidence supporting one claim to justify a different claim (e.g., pain evidence cannot prove a desire or outcome).
- Fewer fully supported claims are far better than a complete-looking persona containing speculation.
- PAIN ATOMICITY: Each pain claim MUST represent ONE coherent customer problem or causal issue unit. Do NOT combine multiple distinct, independently actionable issues (e.g. do not conjoin pricing with sizing, or customer service with return delays and defective items). If multiple distinct problems exist in evidence, emit them as separate atomic pain items, each with its own claimId and specific evidenceIds.
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
        { "claimId": "seg_1_pain_1", "claim": "specific problem directly stated in evidence", "evidenceIds": ["EV-2", "EV-3"] }
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

  const { result: rawSegments } = await generateWithRepair<string, string>({
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
      let parsed = safeJsonParse<any>(candidate);
      if (!parsed) {
        try {
          const str = String(candidate).trim();
          const startBrace = str.indexOf('{');
          const lastBrace = str.lastIndexOf('}');
          if (startBrace !== -1 && lastBrace !== -1 && lastBrace > startBrace) {
            parsed = JSON.parse(str.substring(startBrace, lastBrace + 1));
          } else {
            const startBracket = str.indexOf('[');
            const lastBracket = str.lastIndexOf(']');
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
          rejections: [{ rule: "Structural Integrity", reason: "output was not valid JSON" }]
        };
      }

      if (!Array.isArray(parsed) && Array.isArray((parsed as any).segments)) {
        parsed = (parsed as any).segments;
      }

      if (!Array.isArray(parsed) || parsed.length === 0) {
        return {
          valid: false,
          failureClass: "GENERATION_QUALITY_FAILURE",
          rejections: [{ rule: "Structural Integrity", reason: "output did not contain a non-empty array of segments" }]
        };
      }

      const normalizedCandidates = parsed.map((seg: any, idx: number) => normalizeSegmentCandidate(seg, idx));

      // 1. Build Structural Manifest
      const claimManifest: any[] = [];
      normalizedCandidates.forEach((seg: any) => {
        const segId = seg.segmentDefinition?.claimId ? seg.segmentDefinition.claimId.split("_def")[0] : "unknown";
        if (seg.segmentDefinition?.claimId) claimManifest.push({ claimId: seg.segmentDefinition.claimId, claimType: "segmentDefinition", segmentId: segId, text: seg.segmentDefinition.claim, evidenceIds: seg.segmentDefinition.evidenceIds });
        if (seg.role?.claimId) claimManifest.push({ claimId: seg.role.claimId, claimType: "role", segmentId: segId, text: seg.role.value, evidenceIds: seg.role.evidenceIds });
        ['pains', 'desires', 'objections', 'motivations', 'outcomes'].forEach(field => {
          if (Array.isArray(seg[field])) {
            seg[field].forEach((c: any) => {
              if (c.claimId) claimManifest.push({ claimId: c.claimId, claimType: field, segmentId: segId, text: c.claim, evidenceIds: c.evidenceIds });
            });
          }
        });
      });

      const manifestIds = new Set(claimManifest.map(c => c.claimId));

      // SEMANTIC AUDIENCE JUDGE (Single-pass claim-level evaluation, with batching)
      const BATCH_SIZE = 15;
      let allVerdicts: any[] = [];
      let allJudgeReports: any[] = [];
      
      if (claimManifest.length === 0) {
        return { valid: true, recoveredValue: JSON.stringify(normalizedCandidates) };
      }

      for (let i = 0; i < claimManifest.length; i += BATCH_SIZE) {
        const batchManifest = claimManifest.slice(i, i + BATCH_SIZE);
        
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

INSTRUCTIONS:
Evaluate EVERY claim listed in the CURRENT CLAIM MANIFEST BATCH.
You MUST return a verdict for EVERY claimId in the batch manifest.
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

        try {
          const judgeRes = await aiChat({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: judgePrompt }],
            temperature: 0.0,
            max_tokens: 3500,
            response_format: { type: "json_object" },
            endpoint: "audience-engine-v3-judge",
            accountId,
          });

          const judgeContent = judgeRes.choices[0]?.message?.content?.trim() || "{}";
          const judgeParsed = JSON.parse(judgeContent);
          const verdicts = Array.isArray(judgeParsed.verdicts) ? judgeParsed.verdicts : [];
          allVerdicts.push(...verdicts);
          allJudgeReports.push(judgeParsed);
        } catch (err: any) {
          console.error("[AudienceEngine-V3] Semantic Judge batch error:", err.message);
          throw err;
        }
      }

      // Coverage validation across all batches
      const returnedIds = new Set(allVerdicts.map((v: any) => v.claimId));
      
      // 1. Check for ghost claims
      for (const rid of returnedIds) {
        if (!manifestIds.has(rid)) {
          throw new Error(`JUDGE_UNKNOWN_CLAIM_ID: Judge returned verdict for non-existent claim '${rid}'`);
        }
      }
      
      // 2. Check for missing claims
      const missingIds = [];
      for (const mid of manifestIds) {
        if (!returnedIds.has(mid)) {
          missingIds.push(mid);
        }
      }
      if (missingIds.length > 0) {
        throw new Error(`JUDGE_EVALUATION_INCOMPLETE: Judge missed claims: ${missingIds.join(', ')}`);
      }
      
      // 3. Check for duplicates
      if (allVerdicts.length !== returnedIds.size) {
          throw new Error(`JUDGE_EVALUATION_DUPLICATES: Judge returned duplicate verdicts`);
      }

      const rejectedVerdicts = allVerdicts.filter((v: any) => v.status === "INVALID");
      
      if (rejectedVerdicts.length > 0) {
        return {
          valid: false,
          failureClass: rejectedVerdicts[0]?.rejectionCode || "UNSUPPORTED_PAIN",
          rejections: rejectedVerdicts.map((r: any) => {
            const manifestClaim = claimManifest.find(c => c.claimId === r.claimId) || {};
            return {
              rule: r.rejectionCode || "CLAIM_FAILURE",
              reason: r.critique || r.reason || "unsupported",
              claimId: r.claimId,
              claimType: manifestClaim.claimType || "field",
              segmentId: manifestClaim.segmentId || (r.claimId.split("_")[0] + "_" + r.claimId.split("_")[1]),
              rejectionCode: r.rejectionCode,
              critique: r.critique || r.reason,
              repairDirective: r.repairDirective
            };
          }),
          recoveredValue: JSON.stringify({
            judgeReport: allJudgeReports,
            candidateSegments: normalizedCandidates
          })
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
          // Fallback if judge didn't provide explicit list, assume only provided rejections are rejected
          rejectedList = rejections;
        }
      } catch {
         // Should not happen if failedCandidate was valid JSON
      }

      if (rejectedList.some((r: any) => r.rule === "EMPTY_AUDIENCE" || r.rule === "Structural Integrity" || r.rejectionCode === "CONTRACT_FAILURE")) {
        const regenResponse = await aiChat({
          model: "gpt-4.1-mini",
          messages: [{ role: "user", content: input + "\n\nCRITICAL: Return ONLY a valid JSON object matching { \"segments\": [ ... ] }." }],
          temperature: 0.2,
          max_tokens: 4500,
          response_format: { type: "json_object" },
          endpoint: "audience-engine-v3-segments-regen",
          accountId,
        });
        return regenResponse.choices[0]?.message?.content?.trim() || '{"segments":[]}';
      }

      const repairDirectives = rejectedList.map((r: any) => {
        const code = r.rejectionCode || r.rule || "CLAIM_ERROR";
        const reason = r.critique || r.reason || "";
        const directive = r.repairDirective ? ` -> Directive: ${r.repairDirective}` : "";
        
        // Use structural claimId directly now
        const cid = r.claimId || "unknown"; 
        return `[Claim ID: ${cid}] (${r.claimType || r.field || "field"} - ${code}): ${reason}${directive}`;
      }).join("\n");

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
        temperature: 0.1, // extremely low temperature for patching
        max_tokens: 2500,
        response_format: { type: "json_object" },
        endpoint: "audience-engine-v3-segments-repair",
        accountId,
      });

      const patchRaw = response.choices[0]?.message?.content?.trim() || '{"repairs":[]}';
      
      // Deterministic Structural Merge
      try {
        const patchObj = JSON.parse(patchRaw);
        const repairs = patchObj.repairs || [];

        // Deep clone candidate segments so we don't mutate input
        const mergedSegments = JSON.parse(JSON.stringify(candidateSegments));

        const validPatches = new Map<string, any>();
        for (const patch of repairs) {
          if (!patch?.claimId) continue;
          const isRejected = rejectedList.some((r: any) => r.claimId === patch.claimId);
          if (isRejected) {
            validPatches.set(patch.claimId, patch);
          }
        }

        for (const seg of mergedSegments) {
          for (const key of ['pains', 'desires', 'objections', 'motivations', 'outcomes']) {
            if (Array.isArray(seg[key])) {
              const updatedList: any[] = [];
              for (const c of seg[key]) {
                const patch = validPatches.get(c.claimId);
                const isRejected = rejectedList.some((r: any) => r.claimId === c.claimId);
                if (patch) {
                  if (patch.action === 'REMOVE') {
                    continue;
                  }
                  if (patch.action === 'REPLACE' && patch.repairedClaim) {
                    updatedList.push({
                      ...patch.repairedClaim,
                      claimId: c.claimId,
                    });
                    continue;
                  }
                  if (patch.action === 'SPLIT' && Array.isArray(patch.splitClaims) && patch.splitClaims.length > 0) {
                    patch.splitClaims.forEach((sc: any, scIdx: number) => {
                      if (sc?.claim && Array.isArray(sc?.evidenceIds) && sc.evidenceIds.length > 0) {
                        updatedList.push({
                          claimId: `${c.claimId}_split_${scIdx + 1}`,
                          claim: sc.claim,
                          evidenceIds: sc.evidenceIds,
                        });
                      }
                    });
                    continue;
                  }
                }
                if (!isRejected) {
                  updatedList.push(c);
                }
              }
              seg[key] = updatedList;
            }
          }
          for (const key of ['segmentDefinition', 'role', 'roleClaim']) {
            if (seg[key]?.claimId) {
              const patch = validPatches.get(seg[key].claimId);
              if (patch && patch.action === 'REPLACE' && patch.repairedClaim) {
                Object.assign(seg[key], patch.repairedClaim, { claimId: seg[key].claimId });
              }
            }
          }
        }
        
        // Prune empty segments that lost all core pains
        const survivingSegments = mergedSegments.filter((seg: any) => {
          return Array.isArray(seg.pains) && seg.pains.length > 0;
        });

        // Return the fully merged structural result for the Judge
        return JSON.stringify(survivingSegments);
      } catch (err: any) {
        console.error(`[AudienceEngine-V3] Structural patch merge failed: ${err.message}`);
        return failedCandidate;
      }
    }
  });

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
   - Merge claims ONLY when they represent the same core problem and causal business consequence (e.g., "scattered data insights prevent buying signals" and "visibility problems limit decision-making" describe the same data fragmentation & market visibility root problem).
   - Claims with distinct root problems or different consequences (e.g. "billing issues" vs "poor customer support" vs "generic copy") MUST remain separate.
2. NO EVIDENCE LOSS (CRITICAL INVARIANT):
   - Every single evidenceId from all candidate claims MUST be preserved.
   - For merged claims, combine their evidenceIds into a unified list.
3. OUTPUT FORMAT:
   Return JSON only:
   {
     "canonicalPains": [
       {
         "claimId": "primary_claim_id",
         "claim": "Clear, unified canonical pain phrasing representing the root problem",
         "evidenceIds": ["EV-1", "EV-2"]
       }
     ]
   }`;

      let proposedPains: Array<{ claimId: string; claim: string; evidenceIds: string[] }> = [];

      try {
        const rawRes: any = await aiGemini({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: { responseMimeType: "application/json", maxOutputTokens: 2000 },
          model: "gemini-2.5-flash",
          accountId
        }).catch(() => null);

        let text = typeof rawRes === "string" ? rawRes : rawRes?.candidates?.[0]?.content?.parts?.[0]?.text || rawRes?.text || "";
        if (!text) {
          const aiRes = await aiChat({
            model: "gpt-4.1-mini",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.1,
            max_tokens: 2000,
            response_format: { type: "json_object" },
            endpoint: "audience-engine-v3-pain-consolidation",
            accountId,
          });
          text = aiRes.choices[0]?.message?.content || "{}";
        }

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
            const revalPrompt = `You are the Audience Merged-Claim Evidence Revalidation Judge.
Two or more candidate pain claims were semantically merged into one canonical pain phrasing.
Verify whether the proposed canonical phrasing is strictly and fully supported by the constituent candidate claims and cited evidence IDs (${p.evidenceIds.join(", ")}), or if it overstates the evidence.

CONSTITUENT CANDIDATE CLAIMS MERGED:
${JSON.stringify(constituentPains, null, 2)}

PROPOSED CANONICAL PAIN PHRASING:
"${p.claim}"

EVALUATION CRITERIA:
1. "VALID": The canonical statement accurately captures the shared root problem and causal consequence without exaggeration or adding ungrounded new assertions.
2. "OVERSTATED": The canonical phrasing makes assertions that exceed what the constituent claims/evidence substantiate. If so, you MUST provide a "repairedClaim" that faithfully represents the shared root problem strictly bounded by the evidence.
3. "INVALID": The claims are fundamentally incompatible and should NOT have been merged.

Output JSON only:
{
  "status": "VALID" | "OVERSTATED" | "INVALID",
  "repairedClaim": "Faithfully bounded phrasing...",
  "canMerge": true
}`;

            let revalText = "";
            const rawReval: any = await aiGemini({
              contents: [{ role: "user", parts: [{ text: revalPrompt }] }],
              config: { responseMimeType: "application/json", maxOutputTokens: 1000 },
              model: "gemini-2.5-flash",
              accountId
            }).catch(() => null);

            revalText = typeof rawReval === "string" ? rawReval : rawReval?.candidates?.[0]?.content?.parts?.[0]?.text || rawReval?.text || "";
            if (!revalText) {
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
            }

            revalText = revalText.replace(/^```json\s*/, "").replace(/\s*```$/, "").trim();
            const revalParsed = JSON.parse(revalText || "{}");

            if (revalParsed.status === "VALID") {
              validatedPains.push(p);
            } else if (revalParsed.status === "OVERSTATED" && revalParsed.canMerge !== false && typeof revalParsed.repairedClaim === "string" && revalParsed.repairedClaim.trim().length > 0) {
              console.log(`[AudienceEngine-V3] Merged claim repaired from "${p.claim}" -> "${revalParsed.repairedClaim}"`);
              validatedPains.push({
                ...p,
                claim: revalParsed.repairedClaim.trim()
              });
            } else {
              // Merge rejected / repair failed: Keep original distinct constituent claims
              console.warn(`[AudienceEngine-V3] Merged claim failed revalidation and could not be repaired. Retaining ${constituentPains.length} original claims.`);
              validatedPains.push(...constituentPains);
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
    suggestedLocations: [businessContext.location || "United States"],
    rationale: "Fallback targeting based on business context",
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

function buildStructuredSignals(
  painMap: SignalItem[],
  desireMap: SignalItem[],
  objectionMap: SignalItem[],
  transformationMap: SignalItem[],
  emotionalDrivers: SignalItem[],
  awarenessLevel: AwarenessResult,
  intentDistribution: IntentDistribution,
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

export async function runAudienceEngine(accountId: string, campaignId: string, miSnapshotIdParam?: string, jobId?: string, strategic?: RunStrategicContext): Promise<AudienceEngineV3Result> {
  const startTime = Date.now();
  const effectiveJobId = jobId || `job_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  console.log(`[AudienceEngine-V3] Starting analysis for account=${accountId} campaign=${campaignId}${miSnapshotIdParam ? ` | run-scoped MI=${miSnapshotIdParam}` : " | unscoped (will resolve latest)"}`);

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

  // 1. Ingest unified Canonical Customer Voice universe (Instagram, TikTok, YouTube comments, Reviews, Market Voice quotes)
  const canonicalCustomerUnits = await loadCanonicalCustomerVoice(accountId, campaignId);

  // 2. Ingest competitor-authored content (captions, formats, engagement)
  let posts: { caption: string | null; platform: string; competitorId: string }[] = [];
  if (competitorIds.length > 0) {
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

  const rawCaptionItems = posts
    .map(p => ({ text: p.caption, competitorId: p.competitorId }))
    .filter((i): i is { text: string; competitorId: string } => !!i.text && i.text.length > 5);

  const captionSanitized = sanitizeTextItems(rawCaptionItems);
  const captions = captionSanitized.clean.map(i => i.text);

  // Group Customer Voice items by Origin for downstream linguistic analysis
  const commentUnits = canonicalCustomerUnits.filter(u => u.origin === "COMPETITOR_COMMENT");
  const reviewUnits = canonicalCustomerUnits.filter(u => u.origin === "COMPETITOR_REVIEW");
  const marketVoiceUnits = canonicalCustomerUnits.filter(u => u.origin === "MARKET_VOICE");

  const rawCommentItems = commentUnits
    .map(c => ({ text: c.text, competitorId: c.competitorId || "unknown" }))
    .filter((i): i is { text: string; competitorId: string } => !!i.text && i.text.length > 3);
  const rawReviewItems = reviewUnits
    .map(r => ({ text: r.text, competitorId: r.competitorId || "unknown" }))
    .filter(i => i.text.length > 5);
  const rawMarketVoiceItems = marketVoiceUnits
    .map(m => ({ text: m.text, competitorId: "market_voice" }))
    .filter(i => i.text.length > 5);

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
    `[AudienceEngine-V3] Canonical Customer Voice: ${canonicalCustomerUnits.length} total units` +
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
    return buildEmptyResult(
      "INCOMPLETE",
      "AUTHORITY_VACUUM: Canonical Business Understanding or Target Understanding is missing. Cannot proceed with competitor evidence alone.",
      baseInputSummary,
      executionTimeMs,
      "",
    );
  }

  const primaryTarget = productDna.targetRoles?.map(r => `${r.roleTitle} (${r.roleType})`).join("; ")
    || productDna.targetDecisionMaker
    || productDna.targetAudienceSegment
    || "Target Market";

  const businessContext = {
    industry: productDna.productCategory || productDna.businessType || campaign?.name || "General",
    coreOffer: productDna.coreOffer || campaign?.name || "Products/Services",
    targetAudience: primaryTarget,
    location: "",
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
      profileLink: c.profileLink,
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

  const totalSignalMatches = painMap.length + desireMap.length + objectionMap.length + transformationMap.length + emotionalDrivers.length;
  const totalSignalFrequency = [painMap, desireMap, objectionMap, transformationMap, emotionalDrivers]
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
  // Phase 4: constructSegments (the doctrine-battery path) writes its emission
  // here so the main return can surface it. Ads targeting is structural-only
  // (breadth gate N/A) and is intentionally excluded from AI-path telemetry.
  const audienceAiPathSink: { emission: EngineAiPathEmission | null } = { emission: null };

  if (totalSignalMatches < AUDIENCE_THRESHOLDS.MIN_SIGNAL_MATCHES_FOR_AI) {
    console.log(`[AudienceEngine-V3] INSUFFICIENT SIGNALS for AI layers — ${totalSignalMatches} signal matches (need ≥${AUDIENCE_THRESHOLDS.MIN_SIGNAL_MATCHES_FOR_AI})`);
  } else if (isDefensiveMode) {
    console.log(`[AudienceEngine-V3] DEFENSIVE MODE — signal density too low (${totalSignalFrequency} total frequency), skipping AI layers`);
  } else {
    try {
      const allRawEvidence = [
        ...captionSanitized.clean.map(i => ({ text: i.text, sourceActor: "COMPETITOR_BRAND" })),
        ...commentSanitized.clean.map(i => ({ text: i.text, sourceActor: "CUSTOMER_COMMENTER" })),
        ...rawReviewItems.map(i => ({ text: i.text, sourceActor: "REVIEWER" })),
        ...rawMarketVoiceItems.map(i => ({ text: i.text, sourceActor: "CUSTOMER_DISCUSSANT" })),
      ];

      const selectionResult = await selectEvidence(
        allRawEvidence,
        "AUDIENCE_DISCOVERY",
        JSON.stringify(businessContext),
        "gpt-4.1-mini", // Generator model
        "gpt-4o-mini" // Judge model
      );

      if (!selectionResult.valid) {
        console.error(`[AudienceEngine-V3] EVIDENCE_SELECTION_INCOMPLETE — Selection Judge rejected evidence payload after maximum retries. Reasons: ${selectionResult.rejectionReasons?.join("; ")}`);
        return {
          status: "INCOMPLETE",
          statusMessage: "EVIDENCE_SELECTION_INCOMPLETE: Selection Judge rejected evidence payload after maximum retries. " + (selectionResult.rejectionReasons?.join("; ") || ""),
          defensiveMode: isDefensiveMode,
          languageSignals, painMap, desireMap, objectionMap, transformationMap, emotionalDrivers,
          audienceSegments: [], segmentDensity: [], awarenessLevel, maturityIndex, intentDistribution,
          adsTargetingHints: [], structuredSignals: buildStructuredSignals(painMap, desireMap, objectionMap, emotionalDrivers, transformationMap, awarenessLevel, intentDistribution),
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
          snapshotId: miSnapshotId,
        };
      }
      
      const evidenceItems = selectionResult.selectedUnits;

      const rawSegments = await constructSegments(
        painMap, desireMap, objectionMap, emotionalDrivers,
        maturityIndex, awarenessLevel,
        businessContext, evidenceItems, accountId, miSnapshotId, strategic,
        audienceAiPathSink,
      );

      audienceSegments = canonicalizeSegments(rawSegments);
      console.log(`[AudienceEngine-V3] Canonicalization: ${rawSegments.length} raw → ${audienceSegments.length} canonical segments`);

      adsTargetingHints = await translateToAdsTargeting(
        audienceSegments, maturityIndex, businessContext, accountId, miSnapshotId,
      );
    } catch (err: any) {
      if (err instanceof LLMReliabilityError) {
        console.error(`[AudienceEngine-V3] Segments exhausted retries: ${err.message}. Returning INCOMPLETE state.`);
        return {
          status: "INCOMPLETE",
          statusMessage: "Audience segmentation failed after maximum retries. " + err.message,
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
          snapshotId: miSnapshotId,
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

  let status: EngineStatus = "COMPLETE";
  let statusMessage: string | null = null;

  if (totalSignalMatches < AUDIENCE_THRESHOLDS.MIN_SIGNAL_MATCHES_FOR_AI) {
    status = "INSUFFICIENT_SIGNALS";
    statusMessage = "INSUFFICIENT DATA FOR RELIABLE AUDIENCE INTELLIGENCE — AI layers skipped due to weak signal coverage";
  } else if (awarenessLevel?.level === "insufficient_signals" && intentDistribution?.totalClassified === 0) {
    status = "INSUFFICIENT_SIGNALS";
    statusMessage = "Key classifiers returned insufficient signals — awareness and intent data unreliable";
  } else if (isDefensiveMode) {
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

  const structuredSignals = buildStructuredSignals(
    painMap, desireMap, objectionMap, transformationMap, emotionalDrivers,
    awarenessLevel, intentDistribution,
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
    targetCoverage,
    productTruthFacts: productDna?.productTruthFacts || [],
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
    structuredSignals: JSON.parse(snapshot.structuredSignals || '{"pain_clusters":[],"desire_clusters":[],"pattern_clusters":[],"root_causes":[],"psychological_drivers":[]}'),
    inputSummary: JSON.parse(snapshot.inputSummary || "{}"),
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
