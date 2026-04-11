import type { SourceType, MultiSourceSignals, ClassifiedSignal, TikTokSignals, ReviewsSignals } from "./source-types";
import type { NarrativeObjectionMap, NarrativeObjectionItem } from "./narrative-objection-extractor";
import type { ReviewsIntelligenceResult } from "./reviews-intelligence";
import type { TikTokQualificationResult } from "./tiktok-qualification";

export type DecisionType =
  | "VALIDATED_PAIN"
  | "VALIDATED_HOOK"
  | "CONFIRMED_OBJECTION"
  | "WEAK_SIGNAL"
  | "CONFLICTED_SIGNAL";

export type DecisionConfidenceLevel = "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT";

export interface CrossSignalDecision {
  signalText: string;
  type: DecisionType;
  confidenceScore: number;
  confidenceLevel: DecisionConfidenceLevel;
  sources: SourceType[];
  agreementScore: number;
  supportingEvidenceCount: number;
  sourceWeightsApplied: Partial<Record<SourceType, number>>;
  category: string;
}

export interface CrossSignalDecisionResult {
  decisions: CrossSignalDecision[];
  validatedPains: CrossSignalDecision[];
  validatedHooks: CrossSignalDecision[];
  confirmedObjections: CrossSignalDecision[];
  weakSignals: CrossSignalDecision[];
  conflictedSignals: CrossSignalDecision[];
  sourceCoverage: {
    availableSources: SourceType[];
    missingSources: SourceType[];
    coverageRatio: number;
  };
  aggregateConfidence: number;
  decisionTimestamp: string;
  fallbackNotes: string[];
}

const SOURCE_ROLE_WEIGHTS: Record<SourceType, Record<string, number>> = {
  reviews: { pain: 0.9, objection: 0.85, trust: 0.85, hook: 0.2, content: 0.1 },
  tiktok: { pain: 0.3, objection: 0.2, trust: 0.1, hook: 0.9, content: 0.85 },
  instagram: { pain: 0.4, objection: 0.3, trust: 0.2, hook: 0.7, content: 0.8 },
  website: { pain: 0.3, objection: 0.4, trust: 0.5, hook: 0.3, content: 0.4 },
  blog: { pain: 0.2, objection: 0.2, trust: 0.3, hook: 0.2, content: 0.3 },
};

const HIGH_CONFIDENCE_THRESHOLD = 0.7;
const MEDIUM_CONFIDENCE_THRESHOLD = 0.45;
const JACCARD_SIMILARITY_THRESHOLD = 0.25;

function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter(w => w.length > 2)
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

interface ExtractedSignal {
  text: string;
  source: SourceType;
  category: "pain" | "objection" | "trust" | "hook" | "content";
  rawConfidence: number;
}

function extractAllSignals(
  multiSource: MultiSourceSignals,
  narrativeObjections: NarrativeObjectionMap | null,
  reviewsIntel: ReviewsIntelligenceResult | null,
  tiktokQual: TikTokQualificationResult | null,
): ExtractedSignal[] {
  const signals: ExtractedSignal[] = [];

  if (multiSource.instagram) {
    for (const pain of multiSource.instagram.painInferences) {
      signals.push({ text: pain, source: "instagram", category: "pain", rawConfidence: 0.6 });
    }
    for (const hook of multiSource.instagram.hooks) {
      signals.push({ text: hook, source: "instagram", category: "hook", rawConfidence: 0.65 });
    }
    for (const cta of multiSource.instagram.ctaPatterns) {
      signals.push({ text: cta, source: "instagram", category: "content", rawConfidence: 0.5 });
    }
  }

  if (multiSource.tiktok) {
    for (const hook of multiSource.tiktok.validatedHooks) {
      signals.push({ text: hook, source: "tiktok", category: "hook", rawConfidence: 0.8 });
    }
    for (const pain of multiSource.tiktok.painInferences) {
      signals.push({ text: pain, source: "tiktok", category: "pain", rawConfidence: 0.5 });
    }
    for (const cap of multiSource.tiktok.highPerformingCaptions) {
      signals.push({ text: cap, source: "tiktok", category: "content", rawConfidence: 0.75 });
    }
  }

  if (multiSource.reviews) {
    for (const pain of multiSource.reviews.painPoints) {
      signals.push({ text: pain, source: "reviews", category: "pain", rawConfidence: 0.85 });
    }
    for (const obj of multiSource.reviews.objections) {
      signals.push({ text: obj, source: "reviews", category: "objection", rawConfidence: 0.8 });
    }
    for (const tb of multiSource.reviews.trustBarriers) {
      signals.push({ text: tb, source: "reviews", category: "trust", rawConfidence: 0.8 });
    }
  }

  if (multiSource.website) {
    for (const pos of multiSource.website.positioningLanguage.slice(0, 5)) {
      signals.push({ text: pos, source: "website", category: "content", rawConfidence: 0.6 });
    }
    for (const proof of multiSource.website.proofStructure.slice(0, 3)) {
      signals.push({ text: proof, source: "website", category: "trust", rawConfidence: 0.5 });
    }
  }

  if (narrativeObjections) {
    for (const obj of narrativeObjections.objections) {
      const cat = obj.signalType === "pain" ? "pain" as const
        : obj.signalType === "trust_barrier" ? "trust" as const
        : "objection" as const;
      signals.push({
        text: obj.objection,
        source: "instagram",
        category: cat,
        rawConfidence: obj.narrativeConfidence,
      });
    }
  }

  if (reviewsIntel) {
    for (const pain of reviewsIntel.painSignals) {
      const existing = signals.find(s => s.source === "reviews" && s.text === pain.painText);
      if (!existing) {
        signals.push({ text: pain.painText, source: "reviews", category: "pain", rawConfidence: pain.confidence });
      }
    }
  }

  return signals;
}

function findSemanticGroups(signals: ExtractedSignal[]): Map<string, ExtractedSignal[]> {
  const groups = new Map<string, ExtractedSignal[]>();
  const assigned = new Set<number>();

  for (let i = 0; i < signals.length; i++) {
    if (assigned.has(i)) continue;

    const group: ExtractedSignal[] = [signals[i]];
    assigned.add(i);
    const tokensI = tokenize(signals[i].text);

    for (let j = i + 1; j < signals.length; j++) {
      if (assigned.has(j)) continue;
      if (signals[i].category !== signals[j].category) continue;

      const tokensJ = tokenize(signals[j].text);
      const sim = jaccardSimilarity(tokensI, tokensJ);

      if (sim >= JACCARD_SIMILARITY_THRESHOLD) {
        group.push(signals[j]);
        assigned.add(j);
      }
    }

    const canonicalText = group.sort((a, b) => b.rawConfidence - a.rawConfidence)[0].text;
    const key = `${group[0].category}::${canonicalText}`;
    groups.set(key, group);
  }

  return groups;
}

function classifyDecision(
  category: string,
  sources: SourceType[],
  agreementScore: number,
  confidence: number,
): DecisionType {
  if (sources.length >= 3 && confidence >= HIGH_CONFIDENCE_THRESHOLD) {
    if (category === "pain") return "VALIDATED_PAIN";
    if (category === "hook") return "VALIDATED_HOOK";
    if (category === "objection" || category === "trust") return "CONFIRMED_OBJECTION";
  }

  if (sources.length >= 2 && confidence >= MEDIUM_CONFIDENCE_THRESHOLD) {
    if (category === "pain") return "VALIDATED_PAIN";
    if (category === "hook") return "VALIDATED_HOOK";
    if (category === "objection" || category === "trust") return "CONFIRMED_OBJECTION";
  }

  if (sources.length === 1) return "WEAK_SIGNAL";

  if (confidence < MEDIUM_CONFIDENCE_THRESHOLD) return "WEAK_SIGNAL";

  return "WEAK_SIGNAL";
}

function getConfidenceLevel(score: number): DecisionConfidenceLevel {
  if (score >= 0.75) return "HIGH";
  if (score >= 0.5) return "MEDIUM";
  if (score >= 0.3) return "LOW";
  return "INSUFFICIENT";
}

export function runCrossSignalDecisionLayer(
  multiSource: MultiSourceSignals,
  narrativeObjections: NarrativeObjectionMap | null,
  reviewsIntel: ReviewsIntelligenceResult | null,
  tiktokQual: TikTokQualificationResult | null,
): CrossSignalDecisionResult {
  const allSources: SourceType[] = ["instagram", "website", "blog", "tiktok", "reviews"];
  const availableSources = multiSource.sourceAvailability.availableSources;
  const missingSources = allSources.filter(s => !availableSources.includes(s));
  const coverageRatio = availableSources.length / allSources.length;

  const fallbackNotes: string[] = [];
  if (missingSources.length > 0) {
    fallbackNotes.push(`Missing sources: ${missingSources.join(", ")} — confidence reduced proportionally`);
  }
  if (availableSources.length === 1) {
    fallbackNotes.push("Single-source mode: all decisions classified as WEAK_SIGNAL due to no cross-validation");
  }
  if (!availableSources.includes("reviews")) {
    fallbackNotes.push("No reviews data — pain validation limited to comment-derived signals");
  }
  if (!availableSources.includes("tiktok")) {
    fallbackNotes.push("No TikTok data — content validation based on Instagram only");
  }

  const rawSignals = extractAllSignals(multiSource, narrativeObjections, reviewsIntel, tiktokQual);
  const semanticGroups = findSemanticGroups(rawSignals);

  const decisions: CrossSignalDecision[] = [];

  for (const [key, group] of semanticGroups.entries()) {
    const [category, canonicalText] = key.split("::");
    const uniqueSources = [...new Set(group.map(s => s.source))];
    const agreementScore = uniqueSources.length / availableSources.length;

    const sourceWeightsApplied: Partial<Record<SourceType, number>> = {};
    let weightedConfidence = 0;
    let totalWeight = 0;

    for (const src of uniqueSources) {
      const roleWeight = SOURCE_ROLE_WEIGHTS[src]?.[category] ?? 0.3;
      const maxConfInSource = Math.max(...group.filter(s => s.source === src).map(s => s.rawConfidence));
      sourceWeightsApplied[src] = roleWeight;
      weightedConfidence += maxConfInSource * roleWeight;
      totalWeight += roleWeight;
    }

    let confidence = totalWeight > 0 ? weightedConfidence / totalWeight : 0;

    confidence *= (0.5 + coverageRatio * 0.5);

    if (uniqueSources.length >= 3) confidence = Math.min(confidence * 1.2, 0.98);
    else if (uniqueSources.length >= 2) confidence = Math.min(confidence * 1.1, 0.95);

    const type = classifyDecision(category, uniqueSources, agreementScore, confidence);
    const confidenceLevel = getConfidenceLevel(confidence);

    decisions.push({
      signalText: canonicalText,
      type,
      confidenceScore: Math.round(confidence * 1000) / 1000,
      confidenceLevel,
      sources: uniqueSources,
      agreementScore: Math.round(agreementScore * 1000) / 1000,
      supportingEvidenceCount: group.length,
      sourceWeightsApplied,
      category,
    });
  }

  decisions.sort((a, b) => b.confidenceScore - a.confidenceScore);

  const validatedPains = decisions.filter(d => d.type === "VALIDATED_PAIN");
  const validatedHooks = decisions.filter(d => d.type === "VALIDATED_HOOK");
  const confirmedObjections = decisions.filter(d => d.type === "CONFIRMED_OBJECTION");
  const weakSignals = decisions.filter(d => d.type === "WEAK_SIGNAL");
  const conflictedSignals = decisions.filter(d => d.type === "CONFLICTED_SIGNAL");

  const aggregateConfidence = decisions.length > 0
    ? Math.round((decisions.reduce((s, d) => s + d.confidenceScore, 0) / decisions.length) * 1000) / 1000
    : 0;

  console.log(
    `[CrossSignalDecision] decisions=${decisions.length} | VALIDATED_PAIN=${validatedPains.length} | VALIDATED_HOOK=${validatedHooks.length} | CONFIRMED_OBJECTION=${confirmedObjections.length} | WEAK=${weakSignals.length} | CONFLICTED=${conflictedSignals.length} | sources=${availableSources.join(",")} | coverage=${(coverageRatio * 100).toFixed(0)}% | aggregateConfidence=${aggregateConfidence}`
  );

  return {
    decisions,
    validatedPains,
    validatedHooks,
    confirmedObjections,
    weakSignals,
    conflictedSignals,
    sourceCoverage: {
      availableSources,
      missingSources,
      coverageRatio: Math.round(coverageRatio * 1000) / 1000,
    },
    aggregateConfidence,
    decisionTimestamp: new Date().toISOString(),
    fallbackNotes,
  };
}
