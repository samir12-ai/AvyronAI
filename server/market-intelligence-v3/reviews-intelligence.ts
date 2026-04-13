import type { NarrativeSignalType, ObjectionCluster } from "./narrative-objection-extractor";

export interface ReviewPainSignal {
  painText: string;
  frequencyScore: number;
  confidence: number;
  reviewSources: string[];
  avgRating: number;
  evidenceCount: number;
  signalType: NarrativeSignalType;
}

export interface ReviewObjectionItem {
  objection: string;
  frequencyScore: number;
  confidence: number;
  reviewSources: string[];
  avgRating: number;
  supportingReviews: Array<{ text: string; rating: number; competitorName: string }>;
  patternCategory: string;
  signalType: NarrativeSignalType;
}

export interface ReviewPainCluster {
  clusterId: string;
  canonicalPain: string;
  memberPains: string[];
  totalFrequency: number;
  avgRating: number;
  signalType: NarrativeSignalType;
  competitorSources: string[];
  dominanceScore: number;
  frequencyBand: "HIGH" | "MEDIUM" | "LOW";
  lowVolumePenalty: number;
  recencyWeight: number;
}

export interface ReviewsReliabilityGuard {
  totalVolume: number;
  volumeBand: "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT";
  lowVolumePenalty: number;
  recencyWeightApplied: boolean;
  reliabilityNotes: string[];
}

export interface ReviewsIntelligenceResult {
  painSignals: ReviewPainSignal[];
  objections: ReviewObjectionItem[];
  painClusters: ReviewPainCluster[];
  objectionClusters: ReviewPainCluster[];
  clusters: ReviewPainCluster[];
  totalReviewsProcessed: number;
  avgRating: number;
  ratingDistribution: Record<number, number>;
  extractionTimestamp: string;
  painDominance: number;
  objectionDominance: number;
  reliabilityGuard: ReviewsReliabilityGuard;
}

interface RawReview {
  id: string;
  reviewId?: string;
  text?: string;
  reviewText?: string;
  rating: number | null;
  platform?: string;
  reviewDate?: string | Date | null;
  isSynthetic?: boolean;
}

interface CompetitorReviews {
  competitorId: string;
  competitorName: string;
  reviews: RawReview[];
}

const MIN_REVIEWS_FOR_HIGH_VOLUME = 30;
const MIN_REVIEWS_FOR_MEDIUM_VOLUME = 10;
const MIN_REVIEWS_FOR_ANY_SIGNAL = 3;
const RECENCY_DECAY_DAYS = 180;

const REVIEW_PAIN_PATTERNS: Array<{ category: string; patterns: RegExp[]; label: string; signalType: NarrativeSignalType }> = [
  {
    category: "frustration",
    patterns: [
      /frustrated|frustrating|annoying|annoyed|disappointed|disappointing/i,
      /terrible experience|awful|horrible|worst/i,
      /waste of (time|money)/i,
    ],
    label: "Users frustrated with experience quality",
    signalType: "pain",
  },
  {
    category: "unresponsive",
    patterns: [
      /no response|never responded|didn'?t (reply|respond|answer|get back)/i,
      /ignored|ghosted|no follow.?up/i,
      /hard to (reach|contact|get.{0,10}hold)/i,
    ],
    label: "Poor responsiveness and communication",
    signalType: "pain",
  },
  {
    category: "overpriced",
    patterns: [
      /overpriced|too expensive|not worth.{0,15}(price|money|cost)/i,
      /rip.?off|scam|charged.{0,10}(too much|extra)/i,
      /hidden (fees|charges|costs)/i,
    ],
    label: "Pricing perceived as too high for value",
    signalType: "objection",
  },
  {
    category: "quality",
    patterns: [
      /poor quality|low quality|subpar|mediocre|below average/i,
      /not (professional|what I expected|as advertised|as described)/i,
      /cheap.{0,10}(looking|feel|quality)/i,
    ],
    label: "Delivered quality below expectations",
    signalType: "pain",
  },
  {
    category: "broken_promises",
    patterns: [
      /promised.{0,20}(but|however|never|didn'?t)/i,
      /didn'?t deliver|failed to deliver|under.?deliver/i,
      /over.?promise|said.{0,10}(would|could).{0,20}(but|never|didn'?t)/i,
    ],
    label: "Promises made but not delivered",
    signalType: "trust_barrier",
  },
  {
    category: "slow_service",
    patterns: [
      /slow (service|response|delivery|turnaround)/i,
      /took (too long|forever|weeks|months)/i,
      /delayed|delays|waiting/i,
    ],
    label: "Service delivery is too slow",
    signalType: "pain",
  },
  {
    category: "no_results",
    patterns: [
      /no results|zero results|didn'?t (work|help|make a difference)/i,
      /nothing changed|same as before|no improvement/i,
      /waste.{0,5}(of time|of money|money)/i,
    ],
    label: "No tangible results delivered",
    signalType: "objection",
  },
  {
    category: "lack_expertise",
    patterns: [
      /don'?t know what they'?re doing|inexperienced|unprofessional/i,
      /lack.{0,10}(knowledge|expertise|experience|skill)/i,
      /amateur|clueless|incompetent/i,
    ],
    label: "Perceived lack of expertise",
    signalType: "trust_barrier",
  },
  {
    category: "misleading",
    patterns: [
      /misleading|false (advertising|claims|promises)/i,
      /not (what was|as) (shown|advertised|described|promised)/i,
      /bait.{0,5}(and|&).{0,5}switch/i,
    ],
    label: "Marketing is misleading or deceptive",
    signalType: "trust_barrier",
  },
  {
    category: "poor_support",
    patterns: [
      /no support|poor (customer service|support)/i,
      /rude (staff|employee|service|person|agent)/i,
      /unhelpful|condescending|dismissive/i,
    ],
    label: "Customer support is inadequate",
    signalType: "pain",
  },
];

const REVIEW_CLUSTER_KEYWORDS: Record<string, string[]> = {
  price_value: ["expensive", "overpriced", "rip off", "cost", "price", "money", "worth", "hidden fees", "charge"],
  quality: ["quality", "poor", "subpar", "mediocre", "cheap", "below", "professional"],
  responsiveness: ["response", "respond", "reply", "contact", "reach", "ignored", "ghosted", "communication"],
  trust: ["promise", "deliver", "misleading", "false", "bait", "scam", "trust", "honest"],
  results: ["results", "work", "improvement", "changed", "difference", "waste"],
  service_speed: ["slow", "delayed", "waiting", "long", "forever", "turnaround"],
  expertise: ["expertise", "experience", "knowledge", "professional", "competent", "skilled"],
};

function normalizeReview(r: RawReview): { text: string; rating: number; competitorName: string; reviewDate: Date | null } {
  const { sanitizeReviewText } = require("../shared/text-sanitizer");
  const raw = (r.text || r.reviewText || "").trim();
  const sanitized = sanitizeReviewText(raw);
  return {
    text: sanitized.text,
    rating: r.rating || 0,
    competitorName: "",
    reviewDate: r.reviewDate ? new Date(r.reviewDate) : null,
  };
}

function computeReviewRecencyWeight(reviewDate: Date | null): number {
  if (!reviewDate) return 0.5;
  const ageDays = (Date.now() - reviewDate.getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays <= 30) return 1.0;
  if (ageDays <= 90) return 0.85;
  if (ageDays <= RECENCY_DECAY_DAYS) return 0.6;
  return 0.3;
}

function computeVolumeReliability(totalReviews: number): ReviewsReliabilityGuard {
  const notes: string[] = [];
  let volumeBand: ReviewsReliabilityGuard["volumeBand"];
  let lowVolumePenalty = 0;

  if (totalReviews >= MIN_REVIEWS_FOR_HIGH_VOLUME) {
    volumeBand = "HIGH";
  } else if (totalReviews >= MIN_REVIEWS_FOR_MEDIUM_VOLUME) {
    volumeBand = "MEDIUM";
    lowVolumePenalty = 0.15;
    notes.push(`Moderate review volume (${totalReviews}) — cluster dominance scores adjusted downward`);
  } else if (totalReviews >= MIN_REVIEWS_FOR_ANY_SIGNAL) {
    volumeBand = "LOW";
    lowVolumePenalty = 0.35;
    notes.push(`Low review volume (${totalReviews}) — pain/objection clusters may not be representative of actual market sentiment`);
  } else {
    volumeBand = "INSUFFICIENT";
    lowVolumePenalty = 0.6;
    notes.push(`Insufficient review volume (${totalReviews}) — signals heavily downgraded, do not use for validated decisions`);
  }

  return {
    totalVolume: totalReviews,
    volumeBand,
    lowVolumePenalty,
    recencyWeightApplied: true,
    reliabilityNotes: notes,
  };
}

export function extractReviewsIntelligence(reviews: RawReview[] | CompetitorReviews[]): ReviewsIntelligenceResult {
  let competitorReviews: CompetitorReviews[];

  if (reviews.length > 0 && "reviews" in reviews[0]) {
    competitorReviews = reviews as CompetitorReviews[];
  } else {
    competitorReviews = [{
      competitorId: "aggregated",
      competitorName: "aggregated",
      reviews: reviews as RawReview[],
    }];
  }

  let totalProcessed = 0;
  let totalRatingSum = 0;
  let ratedCount = 0;
  const ratingDistribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

  const painAgg = new Map<string, {
    category: string;
    hitCount: number;
    reviews: Array<{ text: string; rating: number; competitorName: string }>;
    competitorNames: Set<string>;
    totalRating: number;
    ratedReviews: number;
    signalType: NarrativeSignalType;
    recencyWeights: number[];
  }>();

  for (const cr of competitorReviews) {
    for (const review of cr.reviews) {
      if ((review as any).isSynthetic) continue;
      totalProcessed++;
      const normalized = normalizeReview(review);
      const text = normalized.text;
      const rating = normalized.rating;
      const recencyW = computeReviewRecencyWeight(normalized.reviewDate);
      const compName = cr.competitorName || "unknown";

      if (rating > 0 && rating <= 5) {
        totalRatingSum += rating;
        ratedCount++;
        ratingDistribution[Math.round(rating)] = (ratingDistribution[Math.round(rating)] || 0) + 1;
      }

      if (text.length < 10) continue;

      const seenLabels = new Set<string>();
      for (const pattern of REVIEW_PAIN_PATTERNS) {
        if (seenLabels.has(pattern.label)) continue;
        for (const regex of pattern.patterns) {
          if (regex.test(text)) {
            seenLabels.add(pattern.label);
            if (!painAgg.has(pattern.label)) {
              painAgg.set(pattern.label, {
                category: pattern.category,
                hitCount: 0,
                reviews: [],
                competitorNames: new Set(),
                totalRating: 0,
                ratedReviews: 0,
                signalType: pattern.signalType,
                recencyWeights: [],
              });
            }
            const entry = painAgg.get(pattern.label)!;
            entry.hitCount++;
            entry.competitorNames.add(compName);
            entry.recencyWeights.push(recencyW);
            if (rating > 0) { entry.totalRating += rating; entry.ratedReviews++; }
            if (entry.reviews.length < 5) {
              entry.reviews.push({ text: text.slice(0, 200), rating, competitorName: compName });
            }
            break;
          }
        }
      }
    }
  }

  const reliabilityGuard = computeVolumeReliability(totalProcessed);

  const painSignals: ReviewPainSignal[] = [];
  const objections: ReviewObjectionItem[] = [];

  for (const [label, data] of painAgg.entries()) {
    const rawFrequency = Math.min(data.hitCount / Math.max(totalProcessed, 1), 1.0);
    const avgRecency = data.recencyWeights.length > 0
      ? data.recencyWeights.reduce((a, b) => a + b, 0) / data.recencyWeights.length
      : 0.5;
    const frequencyScore = rawFrequency * (0.7 + avgRecency * 0.3);

    const multiCompetitorBonus = data.competitorNames.size >= 2 ? 0.2 : 0;
    let confidence = Math.min(
      0.35 + (frequencyScore * 0.4) + multiCompetitorBonus + (Math.min(data.hitCount, 5) * 0.05),
      1.0,
    );

    confidence = Math.max(0, confidence - reliabilityGuard.lowVolumePenalty);

    const avgRating = data.ratedReviews > 0 ? Math.round((data.totalRating / data.ratedReviews) * 10) / 10 : 0;

    if (data.signalType === "pain") {
      painSignals.push({
        painText: label,
        frequencyScore: Math.round(frequencyScore * 1000) / 1000,
        confidence: Math.round(confidence * 1000) / 1000,
        reviewSources: Array.from(data.competitorNames),
        avgRating,
        evidenceCount: data.hitCount,
        signalType: data.signalType,
      });
    }

    objections.push({
      objection: label,
      frequencyScore: Math.round(frequencyScore * 1000) / 1000,
      confidence: Math.round(confidence * 1000) / 1000,
      reviewSources: Array.from(data.competitorNames),
      avgRating,
      supportingReviews: data.reviews,
      patternCategory: data.category,
      signalType: data.signalType,
    });
  }

  painSignals.sort((a, b) => b.confidence - a.confidence);
  objections.sort((a, b) => b.confidence - a.confidence);

  const painClusters = clusterReviewSignals(painSignals.map(p => ({
    text: p.painText,
    frequency: p.frequencyScore,
    avgRating: p.avgRating,
    signalType: p.signalType,
    sources: p.reviewSources,
    evidenceCount: p.evidenceCount,
  })), totalProcessed, reliabilityGuard.lowVolumePenalty);

  const objectionClusters = clusterReviewSignals(objections.map(o => ({
    text: o.objection,
    frequency: o.frequencyScore,
    avgRating: o.avgRating,
    signalType: o.signalType,
    sources: o.reviewSources,
    evidenceCount: o.supportingReviews.length,
  })), totalProcessed, reliabilityGuard.lowVolumePenalty);

  const allClusters = [...painClusters, ...objectionClusters].sort((a, b) => b.dominanceScore - a.dominanceScore);

  const avgRating = ratedCount > 0 ? Math.round((totalRatingSum / ratedCount) * 10) / 10 : 0;
  const painDominance = totalProcessed > 0 ? painSignals.reduce((s, p) => s + p.evidenceCount, 0) / totalProcessed : 0;
  const objectionDominance = totalProcessed > 0 ? objections.reduce((s, o) => s + o.frequencyScore, 0) / Math.max(objections.length, 1) : 0;

  console.log(
    `[ReviewsIntelligence] processed=${totalProcessed} | avgRating=${avgRating} | painSignals=${painSignals.length} | objections=${objections.length} | painClusters=${painClusters.length} | objectionClusters=${objectionClusters.length} | volumeBand=${reliabilityGuard.volumeBand} | lowVolumePenalty=${reliabilityGuard.lowVolumePenalty}`
  );

  return {
    painSignals,
    objections,
    painClusters,
    objectionClusters,
    clusters: allClusters,
    totalReviewsProcessed: totalProcessed,
    avgRating,
    ratingDistribution,
    extractionTimestamp: new Date().toISOString(),
    painDominance: Math.round(painDominance * 1000) / 1000,
    objectionDominance: Math.round(objectionDominance * 1000) / 1000,
    reliabilityGuard,
  };
}

function clusterReviewSignals(items: Array<{
  text: string;
  frequency: number;
  avgRating: number;
  signalType: NarrativeSignalType;
  sources: string[];
  evidenceCount: number;
}>, totalReviews: number, volumePenalty: number): ReviewPainCluster[] {
  const clusterMap = new Map<string, {
    members: typeof items;
    totalFreq: number;
    totalRating: number;
    ratedCount: number;
    sources: Set<string>;
    totalEvidence: number;
  }>();

  for (const item of items) {
    const lower = item.text.toLowerCase();
    let bestCluster = "unclustered";
    let bestScore = 0;

    for (const [clusterId, keywords] of Object.entries(REVIEW_CLUSTER_KEYWORDS)) {
      let score = 0;
      for (const kw of keywords) {
        if (lower.includes(kw)) score++;
      }
      if (score > bestScore) {
        bestScore = score;
        bestCluster = clusterId;
      }
    }

    if (!clusterMap.has(bestCluster)) {
      clusterMap.set(bestCluster, { members: [], totalFreq: 0, totalRating: 0, ratedCount: 0, sources: new Set(), totalEvidence: 0 });
    }
    const cluster = clusterMap.get(bestCluster)!;
    cluster.members.push(item);
    cluster.totalFreq += item.frequency;
    cluster.totalEvidence += item.evidenceCount;
    if (item.avgRating > 0) { cluster.totalRating += item.avgRating; cluster.ratedCount++; }
    for (const src of item.sources) cluster.sources.add(src);
  }

  const totalClusterFreq = [...clusterMap.values()].reduce((s, c) => s + c.totalFreq, 0);

  const clusters: ReviewPainCluster[] = [];
  for (const [clusterId, data] of clusterMap.entries()) {
    if (data.members.length === 0) continue;
    const sorted = [...data.members].sort((a, b) => b.frequency - a.frequency);

    let rawDominance = totalClusterFreq > 0 ? data.totalFreq / totalClusterFreq : 0;
    rawDominance = Math.max(0, rawDominance - volumePenalty * 0.3);

    let frequencyBand: "HIGH" | "MEDIUM" | "LOW";
    if (data.totalEvidence >= 5 && rawDominance >= 0.3) frequencyBand = "HIGH";
    else if (data.totalEvidence >= 2 && rawDominance >= 0.1) frequencyBand = "MEDIUM";
    else frequencyBand = "LOW";

    const lowVolPenalty = totalReviews < MIN_REVIEWS_FOR_MEDIUM_VOLUME
      ? Math.min(0.4, (MIN_REVIEWS_FOR_MEDIUM_VOLUME - totalReviews) * 0.04)
      : 0;

    const recencyWeight = 1.0;

    clusters.push({
      clusterId,
      canonicalPain: sorted[0].text,
      memberPains: sorted.map(m => m.text),
      totalFrequency: data.totalFreq,
      avgRating: data.ratedCount > 0 ? Math.round((data.totalRating / data.ratedCount) * 10) / 10 : 0,
      signalType: sorted[0].signalType,
      competitorSources: Array.from(data.sources),
      dominanceScore: Math.round(rawDominance * 1000) / 1000,
      frequencyBand,
      lowVolumePenalty: Math.round(lowVolPenalty * 1000) / 1000,
      recencyWeight,
    });
  }

  clusters.sort((a, b) => b.dominanceScore - a.dominanceScore);
  return clusters;
}

export function getReviewsContributionMultiplier(guard: ReviewsReliabilityGuard): number {
  switch (guard.volumeBand) {
    case "HIGH": return 1.0;
    case "MEDIUM": return 0.75;
    case "LOW": return 0.4;
    case "INSUFFICIENT": return 0.15;
  }
}
