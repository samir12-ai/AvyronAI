import type { CompetitorSignalResult, SemanticSignal, SignalCluster } from "../market-intelligence-v3/types";

export interface SignalQualityScore {
  signalId: string;
  sourceCompetitor: string;
  category: string;
  snippet: string;
  confidenceScore: number;
  sourceCount: number;
  freshnessFactor: number;
  crossValidated: boolean;
  qualityScore: number;
  rejectionReason?: string;
}

export interface QualityGateResult {
  totalInputSignals: number;
  passedSignals: SignalQualityScore[];
  rejectedSignals: SignalQualityScore[];
  deduplicatedCount: number;
  crossValidatedCount: number;
  averageQuality: number;
  gatePass: boolean;
  gateSummary: string;
}

export interface ClusterQualityResult {
  originalClusters: number;
  qualifiedClusters: number;
  filteredClusters: SignalCluster[];
  mergedDuplicates: number;
}

const QUALITY_THRESHOLD = 0.85;
const SNIPPET_SIMILARITY_THRESHOLD = 0.65;
const MIN_PASSING_SIGNALS = 3;

function normalizeSnippet(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(normalizeSnippet(a).split(" ").filter(w => w.length > 2));
  const setB = new Set(normalizeSnippet(b).split(" ").filter(w => w.length > 2));
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const word of setA) {
    if (setB.has(word)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function computeSourceReliability(sr: CompetitorSignalResult): number {
  const sampleFactor = Math.min(1, sr.sampleSize / 50);
  const coverageFactor = sr.signalCoverageScore;
  const lifecycleFactor = sr.lifecycle === "ACTIVE" ? 1.0 : sr.lifecycle === "DORMANT" ? 0.4 : 0.2;
  const authorityFactor = sr.authorityWeight;
  const lowSamplePenalty = sr.lowSample ? 0.7 : 1.0;

  return Math.min(1, (
    sampleFactor * 0.25 +
    coverageFactor * 0.25 +
    lifecycleFactor * 0.2 +
    authorityFactor * 0.2 +
    (1 - (sr.varianceScore > 0.5 ? 0.1 : 0)) * 0.1
  ) * lowSamplePenalty);
}

function computeFreshnessFactor(timeWindowDays: number): number {
  if (timeWindowDays <= 7) return 1.0;
  if (timeWindowDays <= 14) return 0.95;
  if (timeWindowDays <= 30) return 0.85;
  if (timeWindowDays <= 60) return 0.7;
  return Math.max(0.3, 1 - (timeWindowDays / 180));
}

function computeSemanticStrengthBonus(signal: SemanticSignal): number {
  return Math.min(0.15, signal.strength * 0.15);
}

export function scoreSignalQuality(
  signalResults: CompetitorSignalResult[],
): SignalQualityScore[] {
  const scored: SignalQualityScore[] = [];
  let globalIdx = 0;

  for (const sr of signalResults) {
    const sourceReliability = computeSourceReliability(sr);
    const freshness = computeFreshnessFactor(sr.timeWindowDays);

    for (const sem of sr.semanticSignals) {
      const strengthBonus = computeSemanticStrengthBonus(sem);
      const rawQuality = (
        sourceReliability * 0.35 +
        freshness * 0.25 +
        sem.strength * 0.25 +
        strengthBonus +
        (sr.commentCount > 10 ? 0.05 : 0)
      );
      const qualityScore = Math.round(Math.min(1, rawQuality) * 1000) / 1000;

      scored.push({
        signalId: `SQG-${sr.competitorId}-${globalIdx}`,
        sourceCompetitor: sr.competitorName,
        category: sem.category,
        snippet: sem.snippet,
        confidenceScore: Math.round(sourceReliability * 1000) / 1000,
        sourceCount: 1,
        freshnessFactor: Math.round(freshness * 1000) / 1000,
        crossValidated: false,
        qualityScore,
      });
      globalIdx++;
    }
  }

  return scored;
}

export function deduplicateSignals(signals: SignalQualityScore[]): SignalQualityScore[] {
  if (signals.length <= 1) return signals;

  const deduplicated: SignalQualityScore[] = [];
  const merged = new Set<number>();

  for (let i = 0; i < signals.length; i++) {
    if (merged.has(i)) continue;

    let best = signals[i];
    let sourceCount = 1;
    const sources = new Set([best.sourceCompetitor]);

    for (let j = i + 1; j < signals.length; j++) {
      if (merged.has(j)) continue;
      if (signals[i].category !== signals[j].category) continue;

      const similarity = jaccardSimilarity(signals[i].snippet, signals[j].snippet);
      if (similarity >= SNIPPET_SIMILARITY_THRESHOLD) {
        merged.add(j);
        sourceCount++;
        sources.add(signals[j].sourceCompetitor);
        if (signals[j].qualityScore > best.qualityScore) {
          best = signals[j];
        }
      }
    }

    const crossSourceBonus = sources.size >= 2 ? 0.1 : 0;
    deduplicated.push({
      ...best,
      sourceCount,
      crossValidated: sources.size >= 2,
      qualityScore: Math.round(Math.min(1, best.qualityScore + crossSourceBonus) * 1000) / 1000,
    });
  }

  return deduplicated;
}

export function crossValidateSignals(
  signals: SignalQualityScore[],
  signalClusters: SignalCluster[],
): SignalQualityScore[] {
  const clusterCategories = new Set(signalClusters.map(c => c.category));
  const reinforcedCategories = new Map<string, number>();
  for (const cluster of signalClusters) {
    if (cluster.competitorCount >= 2) {
      reinforcedCategories.set(cluster.category, cluster.reinforcedScore);
    }
  }

  return signals.map(signal => {
    let crossValidated = signal.crossValidated;
    let bonus = 0;

    if (reinforcedCategories.has(signal.category)) {
      crossValidated = true;
      bonus += 0.05;
    }

    if (signal.sourceCount >= 2) {
      crossValidated = true;
      bonus += 0.05;
    }

    if (clusterCategories.has(signal.category) && signal.sourceCount >= 2) {
      bonus += 0.03;
    }

    return {
      ...signal,
      crossValidated,
      qualityScore: Math.round(Math.min(1, signal.qualityScore + bonus) * 1000) / 1000,
    };
  });
}

export function applyQualityGate(
  signalResults: CompetitorSignalResult[],
  signalClusters: SignalCluster[],
): QualityGateResult {
  const rawScored = scoreSignalQuality(signalResults);
  const deduplicated = deduplicateSignals(rawScored);
  const crossValidated = crossValidateSignals(deduplicated, signalClusters);

  const passed: SignalQualityScore[] = [];
  const rejected: SignalQualityScore[] = [];

  for (const signal of crossValidated) {
    if (signal.qualityScore >= QUALITY_THRESHOLD) {
      passed.push(signal);
    } else {
      rejected.push({ ...signal, rejectionReason: `Quality ${signal.qualityScore.toFixed(3)} < threshold ${QUALITY_THRESHOLD}` });
    }
  }

  const deduplicatedCount = rawScored.length - deduplicated.length;
  const crossValidatedCount = crossValidated.filter(s => s.crossValidated).length;
  const averageQuality = crossValidated.length > 0
    ? Math.round((crossValidated.reduce((s, sig) => s + sig.qualityScore, 0) / crossValidated.length) * 1000) / 1000
    : 0;

  const gatePass = passed.length >= MIN_PASSING_SIGNALS;

  const gateSummary = gatePass
    ? `GATE_PASS: ${passed.length}/${crossValidated.length} signals passed quality threshold (${QUALITY_THRESHOLD}). Deduplicated ${deduplicatedCount}, cross-validated ${crossValidatedCount}.`
    : `GATE_FAIL: Only ${passed.length}/${crossValidated.length} signals passed quality threshold (${QUALITY_THRESHOLD}). Minimum ${MIN_PASSING_SIGNALS} required. Deduplicated ${deduplicatedCount}, cross-validated ${crossValidatedCount}.`;

  return {
    totalInputSignals: rawScored.length,
    passedSignals: passed.sort((a, b) => b.qualityScore - a.qualityScore),
    rejectedSignals: rejected.sort((a, b) => b.qualityScore - a.qualityScore),
    deduplicatedCount,
    crossValidatedCount,
    averageQuality,
    gatePass,
    gateSummary,
  };
}

export function filterClustersByQuality(
  clusters: SignalCluster[],
  qualityGate: QualityGateResult,
): ClusterQualityResult {
  const passedSnippets = new Set(qualityGate.passedSignals.map(s => normalizeSnippet(s.snippet)));

  const filtered: SignalCluster[] = [];
  let mergedDuplicates = 0;

  for (const cluster of clusters) {
    const qualifiedSignals = cluster.signals.filter(sig => {
      const norm = normalizeSnippet(sig.snippet);
      for (const passed of passedSnippets) {
        if (jaccardSimilarity(norm, passed) >= SNIPPET_SIMILARITY_THRESHOLD) return true;
      }
      return false;
    });

    if (qualifiedSignals.length >= 1 && cluster.competitorCount >= 2) {
      const dedupMap = new Map<string, typeof qualifiedSignals[0]>();
      for (const sig of qualifiedSignals) {
        const key = normalizeSnippet(sig.snippet).slice(0, 60);
        if (!dedupMap.has(key) || sig.strength > (dedupMap.get(key)?.strength || 0)) {
          if (dedupMap.has(key)) mergedDuplicates++;
          dedupMap.set(key, sig);
        }
      }

      filtered.push({
        ...cluster,
        signals: Array.from(dedupMap.values()),
        reinforcedScore: Math.min(1, cluster.reinforcedScore),
      });
    }
  }

  return {
    originalClusters: clusters.length,
    qualifiedClusters: filtered.length,
    filteredClusters: filtered.sort((a, b) => b.reinforcedScore - a.reinforcedScore),
    mergedDuplicates,
  };
}

export interface OrphanCheckResult {
  totalClaims: number;
  orphanedClaims: string[];
  tracedClaims: number;
  orphanFree: boolean;
}

export function checkForOrphanClaims(
  claims: string[],
  qualityGate: QualityGateResult,
): OrphanCheckResult {
  const passedSnippets = qualityGate.passedSignals.map(s => normalizeSnippet(s.snippet));
  const orphaned: string[] = [];
  let traced = 0;

  for (const claim of claims) {
    const normClaim = normalizeSnippet(claim);
    let matched = false;
    for (const snippet of passedSnippets) {
      const commonWords = normClaim.split(" ").filter(w => w.length > 2 && snippet.includes(w));
      if (commonWords.length >= 2) {
        matched = true;
        break;
      }
    }
    if (matched) {
      traced++;
    } else {
      orphaned.push(claim);
    }
  }

  return {
    totalClaims: claims.length,
    orphanedClaims: orphaned,
    tracedClaims: traced,
    orphanFree: orphaned.length === 0,
  };
}
