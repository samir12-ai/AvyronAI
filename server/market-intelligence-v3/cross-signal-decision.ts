import type { SourceType, MultiSourceSignals, ClassifiedSignal, TikTokSignals, ReviewsSignals } from "./source-types";
import type { NarrativeObjectionMap, NarrativeObjectionItem } from "./narrative-objection-extractor";
import type { ReviewsIntelligenceResult } from "./reviews-intelligence";
import type { TikTokQualificationResult, BaselineReliability } from "./tiktok-qualification";
import type { ReviewsReliabilityGuard } from "./reviews-intelligence";

export type DecisionType =
  | "VALIDATED_PAIN"
  | "VALIDATED_HOOK"
  | "CONFIRMED_OBJECTION"
  | "WEAK_SIGNAL"
  | "CONFLICTED_SIGNAL";

export type DecisionConfidenceLevel = "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT";

export type AgreementType =
  | "DIRECT_AGREEMENT"
  | "INDIRECT_AGREEMENT"
  | "WEAK_OVERLAP"
  | "CONFLICT"
  | "SINGLE_SOURCE";

export interface MatchedEvidence {
  source: SourceType;
  text: string;
  rawConfidence: number;
  roleWeight: number;
  matchMethod: "exact_keyword" | "phrase_overlap" | "category_alignment" | "jaccard";
  matchScore: number;
}

export interface ConfidenceFactor {
  factor: string;
  contribution: number;
  detail: string;
}

export interface CrossSignalDecision {
  signalText: string;
  type: DecisionType;
  confidenceScore: number;
  confidenceLevel: DecisionConfidenceLevel;
  confidenceFactors: ConfidenceFactor[];
  sources: SourceType[];
  agreementScore: number;
  agreementType: AgreementType;
  supportingEvidenceCount: number;
  sourceWeightsApplied: Partial<Record<SourceType, number>>;
  category: string;
  decisionReason: string;
  matchedEvidence: MatchedEvidence[];
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
  reliabilityInputs: {
    tiktokReliability: BaselineReliability | null;
    reviewsReliability: ReviewsReliabilityGuard | null;
  };
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
const DIRECT_AGREEMENT_THRESHOLD = 0.45;
const INDIRECT_AGREEMENT_THRESHOLD = 0.25;
const WEAK_OVERLAP_THRESHOLD = 0.12;

const CATEGORY_PROXIMITY: Record<string, string[]> = {
  pain: ["objection", "trust"],
  objection: ["pain", "trust"],
  trust: ["objection", "pain"],
  hook: ["content"],
  content: ["hook"],
};

const SEMANTIC_KEYWORD_CLUSTERS: Record<string, string[]> = {
  pricing: ["price", "cost", "expensive", "cheap", "affordable", "premium", "value", "worth", "money", "budget", "fee", "charge", "overpriced"],
  quality: ["quality", "poor", "excellent", "mediocre", "subpar", "professional", "amateur", "polished", "sloppy"],
  speed: ["fast", "slow", "quick", "delay", "wait", "instant", "turnaround", "responsive"],
  trust: ["trust", "reliable", "honest", "scam", "misleading", "transparent", "promise", "deliver", "guarantee"],
  results: ["results", "outcome", "improvement", "growth", "roi", "transform", "impact", "change", "progress"],
  pain: ["frustrated", "struggle", "difficult", "problem", "challenge", "issue", "stuck", "overwhelmed", "confused"],
  expertise: ["expert", "experienced", "skilled", "knowledge", "competent", "authority", "specialist", "professional"],
  communication: ["response", "reply", "contact", "communicate", "reach", "ignore", "ghost", "follow-up"],
};

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

function keywordOverlapScore(aTokens: Set<string>, bTokens: Set<string>): { score: number; matchedCluster: string | null } {
  let bestScore = 0;
  let bestCluster: string | null = null;

  for (const [cluster, keywords] of Object.entries(SEMANTIC_KEYWORD_CLUSTERS)) {
    let aHits = 0;
    let bHits = 0;
    for (const kw of keywords) {
      if (aTokens.has(kw)) aHits++;
      if (bTokens.has(kw)) bHits++;
    }
    if (aHits > 0 && bHits > 0) {
      const clusterScore = Math.min(aHits, bHits) / keywords.length;
      if (clusterScore > bestScore) {
        bestScore = clusterScore;
        bestCluster = cluster;
      }
    }
  }

  return { score: bestScore, matchedCluster: bestCluster };
}

function normalizedPhraseOverlap(a: string, b: string): number {
  const aNorm = a.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  const bNorm = b.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();

  if (aNorm === bNorm) return 1.0;
  if (aNorm.includes(bNorm) || bNorm.includes(aNorm)) return 0.8;

  const aWords = aNorm.split(/\s+/).filter(w => w.length > 2);
  const bWords = bNorm.split(/\s+/).filter(w => w.length > 2);

  if (aWords.length === 0 || bWords.length === 0) return 0;

  let consecutiveMatches = 0;
  let bestConsecutive = 0;
  for (const word of aWords) {
    if (bWords.includes(word)) {
      consecutiveMatches++;
      bestConsecutive = Math.max(bestConsecutive, consecutiveMatches);
    } else {
      consecutiveMatches = 0;
    }
  }

  const phraseScore = bestConsecutive >= 2
    ? Math.min(bestConsecutive / Math.max(aWords.length, bWords.length) * 1.5, 0.9)
    : 0;

  return phraseScore;
}

const NEGATION_MARKERS = new Set(["not", "never", "dont", "doesn", "isn", "aren", "wasn", "weren", "can't", "cant", "won't", "wont", "no", "none", "nothing", "nowhere", "neither", "nobody", "without", "lack", "lacking", "missing", "absent", "failed", "fails"]);
const POLARITY_PAIRS: Array<[string[], string[]]> = [
  [["expensive", "overpriced", "costly", "pricey"], ["affordable", "cheap", "budget", "value", "worth"]],
  [["slow", "delayed", "waiting", "forever"], ["fast", "quick", "instant", "rapid", "responsive"]],
  [["poor", "terrible", "awful", "horrible", "bad"], ["excellent", "great", "amazing", "outstanding", "good"]],
  [["unprofessional", "amateur", "incompetent", "clueless"], ["professional", "expert", "skilled", "competent"]],
  [["misleading", "dishonest", "deceptive", "scam"], ["honest", "transparent", "trustworthy", "genuine"]],
  [["frustrated", "disappointed", "annoyed"], ["satisfied", "happy", "pleased", "delighted"]],
];

function detectConflict(aTokens: Set<string>, bTokens: Set<string>): boolean {
  const aNeg = [...aTokens].some(t => NEGATION_MARKERS.has(t));
  const bNeg = [...bTokens].some(t => NEGATION_MARKERS.has(t));
  if (aNeg !== bNeg) {
    const sharedContent = [...aTokens].filter(t => bTokens.has(t) && !NEGATION_MARKERS.has(t));
    if (sharedContent.length >= 2) return true;
  }

  for (const [negative, positive] of POLARITY_PAIRS) {
    const aHasNeg = negative.some(w => aTokens.has(w));
    const aHasPos = positive.some(w => aTokens.has(w));
    const bHasNeg = negative.some(w => bTokens.has(w));
    const bHasPos = positive.some(w => bTokens.has(w));
    if ((aHasNeg && bHasPos) || (aHasPos && bHasNeg)) return true;
  }

  return false;
}

function computeAgreementType(
  aTokens: Set<string>,
  bTokens: Set<string>,
  aText: string,
  bText: string,
  aCategory: string,
  bCategory: string,
): { type: AgreementType; score: number; method: MatchedEvidence["matchMethod"] } {
  if (detectConflict(aTokens, bTokens)) {
    const jaccard = jaccardSimilarity(aTokens, bTokens);
    if (jaccard >= WEAK_OVERLAP_THRESHOLD) {
      return { type: "CONFLICT", score: jaccard, method: "exact_keyword" };
    }
  }

  const phraseOverlap = normalizedPhraseOverlap(aText, bText);
  if (phraseOverlap >= 0.7) {
    return { type: "DIRECT_AGREEMENT", score: phraseOverlap, method: "phrase_overlap" };
  }

  const jaccard = jaccardSimilarity(aTokens, bTokens);
  if (jaccard >= DIRECT_AGREEMENT_THRESHOLD) {
    return { type: "DIRECT_AGREEMENT", score: jaccard, method: "jaccard" };
  }

  const { score: kwScore } = keywordOverlapScore(aTokens, bTokens);
  if (kwScore >= 0.15 && jaccard >= INDIRECT_AGREEMENT_THRESHOLD) {
    return { type: "INDIRECT_AGREEMENT", score: (jaccard + kwScore) / 2, method: "exact_keyword" };
  }

  if (aCategory !== bCategory) {
    const proximate = CATEGORY_PROXIMITY[aCategory];
    if (proximate?.includes(bCategory)) {
      if (jaccard >= WEAK_OVERLAP_THRESHOLD || kwScore >= 0.1) {
        return { type: "INDIRECT_AGREEMENT", score: Math.max(jaccard, kwScore) * 0.8, method: "category_alignment" };
      }
    }
  }

  if (jaccard >= WEAK_OVERLAP_THRESHOLD) {
    return { type: "WEAK_OVERLAP", score: jaccard, method: "jaccard" };
  }

  if (kwScore >= 0.05) {
    return { type: "WEAK_OVERLAP", score: kwScore, method: "exact_keyword" };
  }

  return { type: "SINGLE_SOURCE", score: 0, method: "jaccard" };
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

function findSemanticGroups(signals: ExtractedSignal[]): Map<string, { members: ExtractedSignal[]; bestAgreement: AgreementType; bestMatchScore: number; evidenceTrail: MatchedEvidence[] }> {
  const groups = new Map<string, { members: ExtractedSignal[]; bestAgreement: AgreementType; bestMatchScore: number; evidenceTrail: MatchedEvidence[] }>();
  const assigned = new Set<number>();

  for (let i = 0; i < signals.length; i++) {
    if (assigned.has(i)) continue;

    const group: ExtractedSignal[] = [signals[i]];
    assigned.add(i);
    const tokensI = tokenize(signals[i].text);
    let bestAgreement: AgreementType = "SINGLE_SOURCE";
    let bestMatchScore = 0;
    const evidenceTrail: MatchedEvidence[] = [{
      source: signals[i].source,
      text: signals[i].text,
      rawConfidence: signals[i].rawConfidence,
      roleWeight: SOURCE_ROLE_WEIGHTS[signals[i].source]?.[signals[i].category] ?? 0.3,
      matchMethod: "exact_keyword",
      matchScore: 1.0,
    }];

    for (let j = i + 1; j < signals.length; j++) {
      if (assigned.has(j)) continue;

      const sameCategory = signals[i].category === signals[j].category;
      const proximateCategory = !sameCategory && (CATEGORY_PROXIMITY[signals[i].category]?.includes(signals[j].category) || false);

      if (!sameCategory && !proximateCategory) continue;

      const tokensJ = tokenize(signals[j].text);
      const agreement = computeAgreementType(
        tokensI, tokensJ,
        signals[i].text, signals[j].text,
        signals[i].category, signals[j].category,
      );

      if (agreement.type !== "SINGLE_SOURCE") {
        group.push(signals[j]);
        assigned.add(j);

        const roleWeight = SOURCE_ROLE_WEIGHTS[signals[j].source]?.[signals[j].category] ?? 0.3;
        evidenceTrail.push({
          source: signals[j].source,
          text: signals[j].text,
          rawConfidence: signals[j].rawConfidence,
          roleWeight,
          matchMethod: agreement.method,
          matchScore: agreement.score,
        });

        if (agreementRank(agreement.type) > agreementRank(bestAgreement)) {
          bestAgreement = agreement.type;
        }
        if (agreement.score > bestMatchScore) {
          bestMatchScore = agreement.score;
        }
      }
    }

    const canonicalText = group.sort((a, b) => b.rawConfidence - a.rawConfidence)[0].text;
    const key = `${group[0].category}::${canonicalText}`;
    groups.set(key, { members: group, bestAgreement, bestMatchScore, evidenceTrail });
  }

  return groups;
}

function agreementRank(type: AgreementType): number {
  switch (type) {
    case "DIRECT_AGREEMENT": return 4;
    case "INDIRECT_AGREEMENT": return 3;
    case "WEAK_OVERLAP": return 2;
    case "CONFLICT": return 1;
    case "SINGLE_SOURCE": return 0;
  }
}

function classifyDecision(
  category: string,
  sources: SourceType[],
  agreementType: AgreementType,
  confidence: number,
): DecisionType {
  if (agreementType === "CONFLICT") return "CONFLICTED_SIGNAL";

  if (sources.length >= 3 && confidence >= HIGH_CONFIDENCE_THRESHOLD && (agreementType === "DIRECT_AGREEMENT" || agreementType === "INDIRECT_AGREEMENT")) {
    if (category === "pain") return "VALIDATED_PAIN";
    if (category === "hook") return "VALIDATED_HOOK";
    if (category === "objection" || category === "trust") return "CONFIRMED_OBJECTION";
  }

  if (sources.length >= 2 && confidence >= MEDIUM_CONFIDENCE_THRESHOLD && agreementType !== "SINGLE_SOURCE") {
    if (category === "pain") return "VALIDATED_PAIN";
    if (category === "hook") return "VALIDATED_HOOK";
    if (category === "objection" || category === "trust") return "CONFIRMED_OBJECTION";
  }

  return "WEAK_SIGNAL";
}

function getConfidenceLevel(score: number): DecisionConfidenceLevel {
  if (score >= 0.75) return "HIGH";
  if (score >= 0.5) return "MEDIUM";
  if (score >= 0.3) return "LOW";
  return "INSUFFICIENT";
}

function buildDecisionReason(
  type: DecisionType,
  agreementType: AgreementType,
  sources: SourceType[],
  confidence: number,
  category: string,
  matchScore: number,
): string {
  const sourceList = sources.join(", ");

  if (type === "CONFLICTED_SIGNAL") {
    return `Conflicting signals detected across ${sources.length} sources (${sourceList}) — requires manual review`;
  }

  if (type === "WEAK_SIGNAL") {
    if (sources.length === 1) {
      return `Single-source signal from ${sourceList} — no cross-validation available, confidence=${(confidence * 100).toFixed(0)}%`;
    }
    return `Insufficient agreement (${agreementType}, matchScore=${matchScore.toFixed(2)}) across ${sourceList} — below validation threshold`;
  }

  const agreementLabel = agreementType === "DIRECT_AGREEMENT" ? "strong direct match"
    : agreementType === "INDIRECT_AGREEMENT" ? "indirect thematic agreement"
    : "weak overlap";

  return `${category} signal validated via ${agreementLabel} across ${sources.length} sources (${sourceList}), confidence=${(confidence * 100).toFixed(0)}%, matchScore=${matchScore.toFixed(2)}`;
}

function buildConfidenceFactors(
  sources: SourceType[],
  agreementType: AgreementType,
  matchScore: number,
  coverageRatio: number,
  category: string,
  tiktokReliability: BaselineReliability | null,
  reviewsReliability: ReviewsReliabilityGuard | null,
): ConfidenceFactor[] {
  const factors: ConfidenceFactor[] = [];

  const sourceCountContribution = Math.min(sources.length * 0.1, 0.3);
  factors.push({
    factor: "source_count",
    contribution: sourceCountContribution,
    detail: `${sources.length} distinct sources contribute to this signal`,
  });

  const agreementContribution = agreementType === "DIRECT_AGREEMENT" ? 0.25
    : agreementType === "INDIRECT_AGREEMENT" ? 0.15
    : agreementType === "WEAK_OVERLAP" ? 0.05
    : 0;
  factors.push({
    factor: "agreement_strength",
    contribution: agreementContribution,
    detail: `Agreement type: ${agreementType} (matchScore=${matchScore.toFixed(3)})`,
  });

  const coverageContribution = coverageRatio * 0.15;
  factors.push({
    factor: "source_coverage",
    contribution: Math.round(coverageContribution * 1000) / 1000,
    detail: `${(coverageRatio * 100).toFixed(0)}% of possible sources available`,
  });

  if (sources.includes("tiktok") && tiktokReliability) {
    if (tiktokReliability.lowDataPenalty > 0) {
      factors.push({
        factor: "tiktok_reliability_penalty",
        contribution: -tiktokReliability.lowDataPenalty * 0.3,
        detail: `TikTok baseline ${tiktokReliability.band} — penalty applied (${tiktokReliability.lowDataPenalty})`,
      });
    }
  }

  if (sources.includes("reviews") && reviewsReliability) {
    if (reviewsReliability.lowVolumePenalty > 0) {
      factors.push({
        factor: "reviews_reliability_penalty",
        contribution: -reviewsReliability.lowVolumePenalty * 0.3,
        detail: `Reviews volume ${reviewsReliability.volumeBand} — penalty applied (${reviewsReliability.lowVolumePenalty})`,
      });
    }
  }

  for (const src of sources) {
    const roleWeight = SOURCE_ROLE_WEIGHTS[src]?.[category] ?? 0.3;
    if (roleWeight >= 0.7) {
      factors.push({
        factor: `source_role_${src}`,
        contribution: 0.1,
        detail: `${src} is a primary source for ${category} signals (roleWeight=${roleWeight})`,
      });
    }
  }

  return factors;
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

  const tiktokReliability = tiktokQual?.baselineReliability ?? null;
  const reviewsReliability = reviewsIntel?.reliabilityGuard ?? null;

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
  if (tiktokReliability && tiktokReliability.band === "INSUFFICIENT") {
    fallbackNotes.push(`TikTok baseline INSUFFICIENT (score=${tiktokReliability.score}) — TikTok signals heavily downgraded`);
  }
  if (reviewsReliability && reviewsReliability.volumeBand === "INSUFFICIENT") {
    fallbackNotes.push(`Reviews volume INSUFFICIENT (${reviewsReliability.totalVolume} reviews) — review signals heavily downgraded`);
  }

  const rawSignals = extractAllSignals(multiSource, narrativeObjections, reviewsIntel, tiktokQual);
  const semanticGroups = findSemanticGroups(rawSignals);

  const decisions: CrossSignalDecision[] = [];

  for (const [key, groupData] of semanticGroups.entries()) {
    const { members: group, bestAgreement, bestMatchScore, evidenceTrail } = groupData;
    const [category, canonicalText] = key.split("::");
    const uniqueSources = [...new Set(group.map(s => s.source))];

    const sourceWeightsApplied: Partial<Record<SourceType, number>> = {};
    let weightedConfidence = 0;
    let totalWeight = 0;

    for (const src of uniqueSources) {
      const roleWeight = SOURCE_ROLE_WEIGHTS[src]?.[category] ?? 0.3;
      const maxConfInSource = Math.max(...group.filter(s => s.source === src).map(s => s.rawConfidence));
      sourceWeightsApplied[src] = roleWeight;

      let effectiveConfidence = maxConfInSource;
      if (src === "tiktok" && tiktokReliability) {
        const multiplier = tiktokReliability.band === "RELIABLE" ? 1.0
          : tiktokReliability.band === "MODERATE" ? 0.75
          : tiktokReliability.band === "WEAK" ? 0.4
          : 0.15;
        effectiveConfidence *= multiplier;
      }
      if (src === "reviews" && reviewsReliability) {
        const multiplier = reviewsReliability.volumeBand === "HIGH" ? 1.0
          : reviewsReliability.volumeBand === "MEDIUM" ? 0.75
          : reviewsReliability.volumeBand === "LOW" ? 0.4
          : 0.15;
        effectiveConfidence *= multiplier;
      }

      weightedConfidence += effectiveConfidence * roleWeight;
      totalWeight += roleWeight;
    }

    let confidence = totalWeight > 0 ? weightedConfidence / totalWeight : 0;

    confidence *= (0.5 + coverageRatio * 0.5);

    if (bestAgreement === "DIRECT_AGREEMENT" && uniqueSources.length >= 3) {
      confidence = Math.min(confidence * 1.25, 0.98);
    } else if (bestAgreement === "DIRECT_AGREEMENT" && uniqueSources.length >= 2) {
      confidence = Math.min(confidence * 1.15, 0.95);
    } else if (bestAgreement === "INDIRECT_AGREEMENT" && uniqueSources.length >= 2) {
      confidence = Math.min(confidence * 1.08, 0.9);
    }

    if (confidence >= HIGH_CONFIDENCE_THRESHOLD && bestAgreement === "WEAK_OVERLAP") {
      confidence = Math.min(confidence, HIGH_CONFIDENCE_THRESHOLD - 0.01);
    }
    if (confidence >= HIGH_CONFIDENCE_THRESHOLD && uniqueSources.length < 2) {
      confidence = Math.min(confidence, MEDIUM_CONFIDENCE_THRESHOLD + 0.1);
    }

    const agreementType = uniqueSources.length === 1 ? "SINGLE_SOURCE" as AgreementType : bestAgreement;
    const type = classifyDecision(category, uniqueSources, agreementType, confidence);
    const confidenceLevel = getConfidenceLevel(confidence);

    const confidenceFactors = buildConfidenceFactors(
      uniqueSources, agreementType, bestMatchScore, coverageRatio, category,
      tiktokReliability, reviewsReliability,
    );

    const decisionReason = buildDecisionReason(type, agreementType, uniqueSources, confidence, category, bestMatchScore);

    decisions.push({
      signalText: canonicalText,
      type,
      confidenceScore: Math.round(confidence * 1000) / 1000,
      confidenceLevel,
      confidenceFactors,
      sources: uniqueSources,
      agreementScore: Math.round((uniqueSources.length / availableSources.length) * 1000) / 1000,
      agreementType,
      supportingEvidenceCount: group.length,
      sourceWeightsApplied,
      category,
      decisionReason,
      matchedEvidence: evidenceTrail.slice(0, 10),
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
    `[CrossSignalDecision] decisions=${decisions.length} | VALIDATED_PAIN=${validatedPains.length} | VALIDATED_HOOK=${validatedHooks.length} | CONFIRMED_OBJECTION=${confirmedObjections.length} | WEAK=${weakSignals.length} | CONFLICTED=${conflictedSignals.length} | sources=${availableSources.join(",")} | coverage=${(coverageRatio * 100).toFixed(0)}% | aggregateConfidence=${aggregateConfidence} | tiktokReliability=${tiktokReliability?.band || "N/A"} | reviewsReliability=${reviewsReliability?.volumeBand || "N/A"}`
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
    reliabilityInputs: {
      tiktokReliability,
      reviewsReliability,
    },
  };
}
