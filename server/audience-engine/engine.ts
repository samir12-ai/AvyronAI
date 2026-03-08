import { db } from "../db";
import { audienceSnapshots, miSnapshots, ciCompetitors, ciCompetitorPosts, ciCompetitorComments, growthCampaigns } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
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
  OBJECTION_CONTEXT_RULES,
  MIN_EVIDENCE_PER_SIGNAL,
  type PatternCluster,
  type MarketScope,
} from "./constants";
import { MI_COST_LIMITS } from "../market-intelligence-v3/constants";
import { aiChat } from "../ai-client";

interface EvidenceMeta {
  evidenceCount: number;
  confidenceScore: number;
  sourceSignals: string[];
  inputSnapshotId: string | null;
}

interface SignalItem extends EvidenceMeta {
  canonical: string;
  frequency: number;
  evidence: string[];
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

interface AudienceSegment extends EvidenceMeta {
  name: string;
  description: string;
  painProfile: string[];
  desireProfile: string[];
  objectionProfile: string[];
  motivationProfile: string[];
  estimatedPercentage: number;
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

export type EngineStatus = "COMPLETE" | "DATASET_TOO_SMALL" | "INSUFFICIENT_SIGNALS" | "DEFENSIVE_MODE";

export interface AudienceEngineV3Result {
  status: EngineStatus;
  statusMessage: string | null;
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
  inputSummary: {
    postsAnalyzed: number;
    commentsAnalyzed: number;
    competitorsAnalyzed: number;
    sanitizedCount: number;
    miSnapshotId: string | null;
    miSnapshotAge: string | null;
  };
  engineVersion: number;
  executionTimeMs: number;
  snapshotId: string;
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

let _lastMarketScopeMetadata: MarketScopeMetadata = {
  scopeConfidence: 0,
  matchedKeywordDensity: 0,
  scopeAmbiguityFlag: false,
};

function getMarketScopeMetadata(): MarketScopeMetadata {
  return { ..._lastMarketScopeMetadata };
}

function detectMarketScope(texts: string[], businessContext: { industry: string; coreOffer: string }): MarketScope[] {
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
    _lastMarketScopeMetadata = { scopeConfidence: 0, matchedKeywordDensity: 0, scopeAmbiguityFlag: false };
    return ["universal"];
  }

  const topScore = sorted[0][1];
  const secondScore = sorted[1]?.[1] || 0;

  const scopeAmbiguityFlag = secondScore > 0 && (topScore - secondScore) / topScore < 0.20;

  const separationFactor = secondScore > 0 ? (topScore - secondScore) / topScore : 1;
  const densityFactor = Math.min(1, totalKeywordMatches / 10);
  const scopeConfidence = Math.round(Math.min(1, Math.max(0, separationFactor * 0.5 + densityFactor * 0.5)) * 1000) / 1000;

  _lastMarketScopeMetadata = { scopeConfidence, matchedKeywordDensity, scopeAmbiguityFlag };

  const detected = sorted.filter(([, v]) => v >= topScore * 0.3).map(([k]) => k as MarketScope);
  return detected.length > 0 ? detected : ["universal"];
}

function filterClustersByMarket(clusters: PatternCluster[], detectedMarkets: MarketScope[]): PatternCluster[] {
  return clusters.filter(cluster => {
    if (!cluster.marketScope) return true;
    if (detectedMarkets.includes("universal")) return true;
    return cluster.marketScope.some(s => detectedMarkets.includes(s));
  });
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
    } else {
      const existingInResult = result.find(r => r.canonical === rule.fallbackCanonical);
      if (existingInResult) {
        existingInResult.frequency += item.frequency;
        existingInResult.evidenceCount += item.evidenceCount;
        existingInResult.evidence = [...existingInResult.evidence, ...item.evidence].slice(0, 3);
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

function applyEvidenceIntegrityFilter(signals: SignalItem[]): SignalItem[] {
  return signals.filter(s => s.evidenceCount >= MIN_EVIDENCE_PER_SIGNAL && s.frequency >= MIN_EVIDENCE_PER_SIGNAL);
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

      canonical = {
        ...best,
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

function computeCalibratedConfidence(
  frequency: number,
  totalTexts: number,
  sourceTypes: string[],
  competitorCount: number,
): number {
  const freqScore = totalTexts > 0 ? Math.min(1, frequency / Math.max(totalTexts * 0.1, 1)) : 0;
  const diversityScore = Math.min(1, sourceTypes.length / 3);
  const competitorScore = Math.min(1, competitorCount / MI_COST_LIMITS.MAX_COMPETITORS);

  const raw =
    freqScore * CONFIDENCE_WEIGHTS.SIGNAL_FREQUENCY +
    diversityScore * CONFIDENCE_WEIGHTS.SOURCE_DIVERSITY +
    competitorScore * CONFIDENCE_WEIGHTS.COMPETITOR_OVERLAP;

  return Math.min(0.95, Math.max(0.05, raw));
}

function matchPatternClusters(
  texts: string[],
  clusters: PatternCluster[],
  inputSnapshotId: string | null,
  sourceTypes: string[],
  competitorCount: number,
): SignalItem[] {
  const results: Map<string, { count: number; evidence: string[]; matchedPatterns: Set<string> }> = new Map();

  for (const cluster of clusters) {
    results.set(cluster.canonical, { count: 0, evidence: [], matchedPatterns: new Set() });
  }

  for (const text of texts) {
    const lower = text.toLowerCase();
    for (const cluster of clusters) {
      for (const pattern of cluster.patterns) {
        if (lower.includes(pattern)) {
          const entry = results.get(cluster.canonical)!;
          entry.count++;
          entry.matchedPatterns.add(pattern);
          if (entry.evidence.length < 3) {
            entry.evidence.push(text.slice(0, 150));
          }
          break;
        }
      }
    }
  }

  return Array.from(results.entries())
    .filter(([, v]) => v.count > 0)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([canonical, data]) => ({
      canonical,
      frequency: data.count,
      evidence: data.evidence,
      evidenceCount: data.count,
      confidenceScore: computeCalibratedConfidence(data.count, texts.length, sourceTypes, competitorCount),
      sourceSignals: Array.from(data.matchedPatterns),
      inputSnapshotId,
    }));
}

function analyzeLanguage(
  comments: string[],
  captions: string[],
  inputSnapshotId: string | null,
  competitorCount: number,
): LanguageSignals {
  const allText = [...comments, ...captions];
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
  result.confidenceScore = computeCalibratedConfidence(total, allText.length, sourceTypes, competitorCount);
  result.sourceSignals = sourceTypes;

  return result;
}

function detectAwareness(
  comments: string[],
  inputSnapshotId: string | null,
  competitorCount: number,
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

  const pct: Record<string, number> = {};
  for (const [level, count] of Object.entries(distribution)) {
    pct[level] = Math.round((count / totalMatched) * 100);
  }

  return {
    level: dominantLevel as AwarenessResult["level"],
    distribution: pct,
    evidenceCount: totalMatched,
    confidenceScore: computeCalibratedConfidence(totalMatched, comments.length, ["comments"], competitorCount),
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
    confidenceScore: computeCalibratedConfidence(total, allText.length, sourceTypes, competitorCount),
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
    confidenceScore: computeCalibratedConfidence(totalClassified, comments.length, ["comments"], competitorCount),
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

async function constructSegments(
  painMap: SignalItem[],
  desireMap: SignalItem[],
  objectionMap: SignalItem[],
  emotionalDrivers: SignalItem[],
  maturity: MaturityResult,
  awareness: AwarenessResult,
  businessContext: { industry: string; coreOffer: string; targetAudience: string },
  commentSamples: string[],
  accountId: string,
  inputSnapshotId: string | null,
): Promise<AudienceSegment[]> {
  try {
    const prompt = `You are an audience research analyst. Based on market evidence, construct 2-4 distinct audience segments.

BUSINESS: ${businessContext.industry} — ${businessContext.coreOffer}

PAIN MAP (from real audience data):
${painMap.slice(0, 8).map(p => `- ${p.canonical}: frequency=${p.frequency}, confidence=${(p.confidenceScore * 100).toFixed(0)}%`).join("\n")}

DESIRE MAP:
${desireMap.slice(0, 8).map(d => `- ${d.canonical}: frequency=${d.frequency}`).join("\n")}

OBJECTION MAP:
${objectionMap.slice(0, 6).map(o => `- ${o.canonical}: frequency=${o.frequency}`).join("\n")}

EMOTIONAL DRIVERS:
${emotionalDrivers.slice(0, 6).map(e => `- ${e.canonical}: frequency=${e.frequency}`).join("\n")}

MARKET MATURITY: ${maturity.level}
AWARENESS LEVEL: ${awareness.level}

SAMPLE COMMENTS (real audience language):
${commentSamples.slice(0, 12).map(c => `"${c.slice(0, 100)}"`).join("\n")}

Return a JSON array of 2-4 segments. Each segment:
{
  "name": "segment name",
  "description": "brief description",
  "painProfile": ["pain1", "pain2"],
  "desireProfile": ["desire1", "desire2"],
  "objectionProfile": ["objection1"],
  "motivationProfile": ["motivation1", "motivation2"],
  "estimatedPercentage": number (must total ~100)
}

Return ONLY the JSON array, no markdown.`;

    const response = await aiChat({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
      max_tokens: 2000,
      endpoint: "audience-engine-v3-segments",
      accountId,
    });

    const content = response.choices[0]?.message?.content?.trim() || "[]";
    const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned) as any[];

    return parsed.map(seg => {
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

      const allOtherSegments = parsed.filter((s: any) => s.name !== seg.name);
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
  } catch (err: any) {
    console.error("[AudienceEngine-V3] Segment construction failed:", err.message);
    return [{
      name: "Primary Audience",
      description: "Main audience segment based on available data",
      painProfile: painMap.slice(0, 3).map(p => p.canonical),
      desireProfile: desireMap.slice(0, 3).map(d => d.canonical),
      objectionProfile: objectionMap.slice(0, 2).map(o => o.canonical),
      motivationProfile: emotionalDrivers.slice(0, 2).map(e => e.canonical),
      estimatedPercentage: 100,
      evidenceCount: painMap.length + desireMap.length,
      confidenceScore: 0.3,
      sourceSignals: ["painMap", "desireMap"],
      inputSnapshotId,
    }];
  }
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

    const response = await aiChat({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 1500,
      endpoint: "audience-engine-v3-ads-targeting",
      accountId,
    });

    const content = response.choices[0]?.message?.content?.trim() || "[]";
    const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned) as any[];

    return parsed.map(hint => sanitizeAdsTargetingHint({
      ...hint,
      evidenceCount: segments.length,
      confidenceScore: 0.6,
      sourceSignals: ["audienceSegments", "maturityIndex"],
      inputSnapshotId,
    }));
  } catch (err: any) {
    console.error("[AudienceEngine-V3] Ads targeting failed:", err.message);
    return [{
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
  }
}

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
    inputSummary,
    engineVersion: AUDIENCE_ENGINE_VERSION,
    executionTimeMs,
    snapshotId,
  };
}

export async function runAudienceEngine(accountId: string, campaignId: string): Promise<AudienceEngineV3Result> {
  const startTime = Date.now();
  console.log(`[AudienceEngine-V3] Starting analysis for account=${accountId} campaign=${campaignId}`);

  const [latestSnapshot] = await db.select().from(miSnapshots)
    .where(and(
      eq(miSnapshots.accountId, accountId),
      eq(miSnapshots.campaignId, campaignId),
      eq(miSnapshots.status, "COMPLETE"),
    ))
    .orderBy(desc(miSnapshots.createdAt))
    .limit(1);

  const miSnapshotId = latestSnapshot?.id || null;
  const miSnapshotAge = latestSnapshot?.createdAt
    ? `${Math.round((Date.now() - new Date(latestSnapshot.createdAt).getTime()) / 3600000)}h ago`
    : null;
  if (latestSnapshot && latestSnapshot.analysisVersion !== undefined) {
    const { ENGINE_VERSION: MI_EV } = await import("../market-intelligence-v3/constants");
    if (latestSnapshot.analysisVersion !== MI_EV) {
      console.log(`[AudienceEngine-V3] MI snapshot version mismatch: got v${latestSnapshot.analysisVersion}, expected v${MI_EV} — results may use stale MI data`);
    }
  }

  const competitors = await db.select().from(ciCompetitors)
    .where(and(
      eq(ciCompetitors.accountId, accountId),
      eq(ciCompetitors.campaignId, campaignId),
      eq(ciCompetitors.isActive, true),
    ));

  const enrichedCount = competitors.filter(c => c.enrichmentStatus === "ENRICHED").length;
  const pendingCount = competitors.filter(c => c.enrichmentStatus === "PENDING" || !c.enrichmentStatus).length;
  if (competitors.length > 0) {
    console.log(`[AudienceEngine-V3] INVENTORY_STATUS | total=${competitors.length} | enriched=${enrichedCount} | pending=${pendingCount}`);
  }

  const competitorIds = competitors.map(c => c.id);
  const competitorCount = competitorIds.length;

  let posts: { caption: string | null }[] = [];
  let rawComments: { commentText: string | null }[] = [];

  if (competitorIds.length > 0) {
    const idList = sql.join(competitorIds.map(id => sql`${id}`), sql`, `);

    posts = await db.select({ caption: ciCompetitorPosts.caption })
      .from(ciCompetitorPosts)
      .where(sql`${ciCompetitorPosts.competitorId} IN (${idList})`)
      .orderBy(desc(ciCompetitorPosts.createdAt))
      .limit(AUDIENCE_THRESHOLDS.MAX_POSTS_TO_ANALYZE);

    rawComments = await db.select({ commentText: ciCompetitorComments.commentText })
      .from(ciCompetitorComments)
      .where(sql`${ciCompetitorComments.competitorId} IN (${idList}) AND (${ciCompetitorComments.isSynthetic} = false OR ${ciCompetitorComments.isSynthetic} IS NULL)`)
      .orderBy(desc(ciCompetitorComments.createdAt))
      .limit(AUDIENCE_THRESHOLDS.MAX_COMMENTS_TO_ANALYZE);
  }

  const rawCaptions = posts.map(p => p.caption).filter((c): c is string => !!c && c.length > 5);
  const rawCommentTexts = rawComments.map(c => c.commentText).filter((c): c is string => !!c && c.length > 3);

  const captionSanitized = sanitizeTexts(rawCaptions);
  const commentSanitized = sanitizeTexts(rawCommentTexts);
  const captions = captionSanitized.clean;
  const commentTexts = commentSanitized.clean;
  const totalSanitized = captionSanitized.removed + commentSanitized.removed;

  console.log(`[AudienceEngine-V3] Data: ${competitorCount} competitors, ${captions.length} captions, ${commentTexts.length} comments (sanitized ${totalSanitized} synthetic signals)`);

  const baseInputSummary = {
    postsAnalyzed: captions.length,
    commentsAnalyzed: commentTexts.length,
    competitorsAnalyzed: competitorCount,
    sanitizedCount: totalSanitized,
    miSnapshotId,
    miSnapshotAge,
    detectedMarkets: [] as string[],
  };

  if (
    competitorCount < AUDIENCE_THRESHOLDS.MIN_COMPETITORS_FOR_ANALYSIS ||
    captions.length < AUDIENCE_THRESHOLDS.MIN_POSTS_FOR_ANALYSIS
  ) {
    const msg = `DATASET TOO SMALL FOR RELIABLE AUDIENCE INTELLIGENCE — Need ≥${AUDIENCE_THRESHOLDS.MIN_COMPETITORS_FOR_ANALYSIS} competitors (have ${competitorCount}), ≥${AUDIENCE_THRESHOLDS.MIN_POSTS_FOR_ANALYSIS} posts (have ${captions.length}), comments available: ${commentTexts.length}`;
    console.log(`[AudienceEngine-V3] ${msg}`);

    const executionTimeMs = Date.now() - startTime;
    const [inserted] = await db.insert(audienceSnapshots).values({
      accountId, campaignId, miSnapshotId,
      engineVersion: AUDIENCE_ENGINE_VERSION,
      inputSummary: JSON.stringify({ ...baseInputSummary, status: "DATASET_TOO_SMALL", statusMessage: msg }),
      executionTimeMs,
    }).returning({ id: audienceSnapshots.id });

    return buildEmptyResult("DATASET_TOO_SMALL", msg, baseInputSummary, executionTimeMs, inserted.id);
  }

  if (commentTexts.length === 0) {
    console.log(`[AudienceEngine-V3] NO_COMMENT_TEXT — proceeding with ${captions.length} captions only`);
  }

  const [campaign] = await db.select().from(growthCampaigns)
    .where(eq(growthCampaigns.id, campaignId))
    .limit(1);

  const businessContext = {
    industry: campaign?.name || "General",
    coreOffer: campaign?.name || "Products/Services",
    targetAudience: "Market audience",
    location: "",
  };

  const allText = [...commentTexts, ...captions];
  const sourceTypes = [];
  if (commentTexts.length > 0) sourceTypes.push("comments");
  if (captions.length > 0) sourceTypes.push("captions");

  const detectedMarkets = detectMarketScope(allText, businessContext);
  baseInputSummary.detectedMarkets = detectedMarkets;
  const scopeMetadata = getMarketScopeMetadata();
  console.log(`[AudienceEngine-V3] Market scope detected: ${detectedMarkets.join(", ")} | scopeConfidence=${scopeMetadata.scopeConfidence} | ambiguity=${scopeMetadata.scopeAmbiguityFlag}`);

  const scopedPainClusters = filterClustersByMarket(PAIN_CLUSTERS, detectedMarkets);
  const scopedDesireClusters = filterClustersByMarket(DESIRE_CLUSTERS, detectedMarkets);
  const scopedObjectionClusters = filterClustersByMarket(OBJECTION_CLUSTERS, detectedMarkets);

  const languageSignals = analyzeLanguage(commentTexts, captions, miSnapshotId, competitorCount);
  const rawPainMap = matchPatternClusters(allText, scopedPainClusters, miSnapshotId, sourceTypes, competitorCount);
  const rawDesireMap = matchPatternClusters(allText, scopedDesireClusters, miSnapshotId, sourceTypes, competitorCount);
  let rawObjectionMap = matchPatternClusters(allText, scopedObjectionClusters, miSnapshotId, sourceTypes, competitorCount);
  const rawTransformationMap = matchPatternClusters(allText, TRANSFORMATION_PATTERNS, miSnapshotId, sourceTypes, competitorCount);
  const rawEmotionalDrivers = matchPatternClusters(allText, EMOTIONAL_DRIVER_PATTERNS, miSnapshotId, sourceTypes, competitorCount);

  rawObjectionMap = applyObjectionContextRules(rawObjectionMap, allText);

  const painMap = applyEvidenceIntegrityFilter(rawPainMap);
  const desireMap = applyEvidenceIntegrityFilter(rawDesireMap);
  const objectionMap = applyEvidenceIntegrityFilter(rawObjectionMap);
  const transformationMap = applyEvidenceIntegrityFilter(rawTransformationMap);
  const emotionalDrivers = applyEvidenceIntegrityFilter(rawEmotionalDrivers);

  const awarenessInput = commentTexts.length > 0 ? commentTexts : captions;
  const awarenessLevel = detectAwareness(awarenessInput, miSnapshotId, competitorCount);
  const maturityIndex = detectMaturity(commentTexts, captions, miSnapshotId, competitorCount);
  const intentInput = commentTexts.length > 0 ? commentTexts : captions;
  const intentDistribution = classifyIntents(intentInput, miSnapshotId, competitorCount);
  const intentTemperature = deriveIntentTemperature(intentDistribution);
  console.log(`[AudienceEngine-V3] Intent temperature: ${intentTemperature} (curiosity=${intentDistribution.curiosity}% learning=${intentDistribution.learning}% comparison=${intentDistribution.comparison}% purchase=${intentDistribution.purchaseIntent}%)`);

  const totalSignalMatches = painMap.length + desireMap.length + objectionMap.length + transformationMap.length + emotionalDrivers.length;
  const totalSignalFrequency = [painMap, desireMap, objectionMap, transformationMap, emotionalDrivers]
    .flat().reduce((sum, s) => sum + s.frequency, 0);

  const isDefensiveMode = totalSignalFrequency < AUDIENCE_THRESHOLDS.DEFENSIVE_MODE_SIGNAL_THRESHOLD;

  let audienceSegments: AudienceSegment[] = [];
  let adsTargetingHints: AdsTargetingHint[] = [];

  if (totalSignalMatches < AUDIENCE_THRESHOLDS.MIN_SIGNAL_MATCHES_FOR_AI) {
    console.log(`[AudienceEngine-V3] INSUFFICIENT SIGNALS for AI layers — ${totalSignalMatches} signal matches (need ≥${AUDIENCE_THRESHOLDS.MIN_SIGNAL_MATCHES_FOR_AI})`);
  } else if (isDefensiveMode) {
    console.log(`[AudienceEngine-V3] DEFENSIVE MODE — signal density too low (${totalSignalFrequency} total frequency), skipping AI layers`);
  } else {
    const rawSegments = await constructSegments(
      painMap, desireMap, objectionMap, emotionalDrivers,
      maturityIndex, awarenessLevel,
      businessContext, commentTexts, accountId, miSnapshotId,
    );

    audienceSegments = canonicalizeSegments(rawSegments);
    console.log(`[AudienceEngine-V3] Canonicalization: ${rawSegments.length} raw → ${audienceSegments.length} canonical segments`);

    adsTargetingHints = await translateToAdsTargeting(
      audienceSegments, maturityIndex, businessContext, accountId, miSnapshotId,
    );
  }

  const segmentDensity = computeSegmentDensity(painMap, desireMap, audienceSegments, miSnapshotId);

  const executionTimeMs = Date.now() - startTime;

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
  }

  const inputSummary = { ...baseInputSummary };

  const [inserted] = await db.insert(audienceSnapshots).values({
    accountId, campaignId, miSnapshotId,
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
    executionTimeMs,
  }).returning({ id: audienceSnapshots.id });

  console.log(`[AudienceEngine-V3] ${status} in ${executionTimeMs}ms | snapshot=${inserted.id} | signals=${totalSignalMatches} | freq=${totalSignalFrequency} | segments=${audienceSegments.length} | defensive=${isDefensiveMode}`);

  return {
    status,
    statusMessage,
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
    inputSummary,
    engineVersion: AUDIENCE_ENGINE_VERSION,
    executionTimeMs,
    snapshotId: inserted.id,
  };
}

export async function getLatestAudienceSnapshot(accountId: string, campaignId: string) {
  const [snapshot] = await db.select().from(audienceSnapshots)
    .where(and(
      eq(audienceSnapshots.accountId, accountId),
      eq(audienceSnapshots.campaignId, campaignId),
    ))
    .orderBy(desc(audienceSnapshots.createdAt))
    .limit(1);

  if (!snapshot) return null;

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
    inputSummary: JSON.parse(snapshot.inputSummary || "{}"),
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
