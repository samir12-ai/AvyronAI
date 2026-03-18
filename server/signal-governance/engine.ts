import type { StructuredSignals, StructuredSignalCluster } from "../audience-engine/engine";
import {
  type GovernedSignal,
  type SignalCoverageReport,
  type SignalGovernanceState,
  type SignalResolution,
  type EngineSignalConsumption,
  type EngineId,
  ENGINE_SIGNAL_REQUIREMENTS,
} from "./types";
import {
  SGL_VERSION,
  MIN_SIGNALS_PER_CATEGORY,
  MIN_TOTAL_SIGNALS,
  SIGNAL_CONFIDENCE_FLOOR,
  LEAKAGE_PATTERNS,
  RAW_COMMENT_PATTERNS,
} from "./constants";

function generateTraceToken(): string {
  return `SGL_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
}

export function isRawComment(text: string): boolean {
  for (const pattern of RAW_COMMENT_PATTERNS) {
    if (pattern.test(text)) return true;
  }
  return false;
}

export function purifyEvidence(rawEvidence: string[]): string[] {
  const purified: string[] = [];
  let discarded = 0;

  for (const item of rawEvidence) {
    if (isRawComment(item)) {
      discarded++;
      continue;
    }
    const sanitized = sanitizeSignalText(item);
    if (sanitized.length > 3 && sanitized !== "[SANITIZED]") {
      purified.push(sanitized);
    } else {
      discarded++;
    }
  }

  if (discarded > 0 && purified.length === 0) {
    purified.push(`[${discarded} raw source(s) purified — structured signal only]`);
  }

  return purified;
}

function clusterToGovernedSignals(
  clusters: StructuredSignalCluster[],
  category: GovernedSignal["category"],
  sourceEngine: string,
  traceId: string,
): GovernedSignal[] {
  return clusters
    .filter(c => c.confidence >= SIGNAL_CONFIDENCE_FLOOR)
    .filter(c => !isRawComment(c.label))
    .map((cluster, idx) => ({
      signalId: `SGL_${category.toUpperCase()}_${String(idx + 1).padStart(3, "0")}`,
      category,
      text: sanitizeSignalText(cluster.label),
      confidence: cluster.confidence,
      evidence: purifyEvidence(cluster.evidence || []),
      sourceEngine,
      sourceLayer: cluster.sourceLayer || "unknown",
      traceId,
      consumedBy: [],
    }));
}

export function sanitizeSignalText(text: string): string {
  let clean = text.trim();
  if (isRawComment(clean)) {
    return "[SANITIZED]";
  }
  for (const pattern of LEAKAGE_PATTERNS) {
    if (pattern.test(clean)) {
      clean = clean.replace(pattern, "[SANITIZED]");
    }
  }
  return clean.slice(0, 500);
}

function buildCoverageReport(signals: GovernedSignal[]): SignalCoverageReport {
  const counts: Record<string, number> = {
    pain: 0, desire: 0, objection: 0,
    pattern: 0, root_cause: 0, psychological_driver: 0,
  };
  for (const s of signals) {
    counts[s.category] = (counts[s.category] || 0) + 1;
  }

  const missingCategories: string[] = [];
  for (const [cat, min] of Object.entries(MIN_SIGNALS_PER_CATEGORY)) {
    if ((counts[cat] || 0) < min) {
      missingCategories.push(cat);
    }
  }

  return {
    pains: counts.pain,
    desires: counts.desire,
    objections: counts.objection,
    patterns: counts.pattern,
    rootCauses: counts.root_cause,
    psychologicalDrivers: counts.psychological_driver,
    totalSignals: signals.length,
    coverageSufficient: signals.length >= MIN_TOTAL_SIGNALS && missingCategories.length === 0,
    missingCategories,
  };
}

export function initializeSignalGovernance(
  structuredSignals: StructuredSignals,
  objectionMap: Array<{ label: string; confidence: number; evidence?: string[] }>,
): SignalGovernanceState {
  const traceToken = generateTraceToken();
  const sourceEngine = "audience";

  const painSignals = clusterToGovernedSignals(
    structuredSignals.pain_clusters, "pain", sourceEngine, traceToken
  );
  const desireSignals = clusterToGovernedSignals(
    structuredSignals.desire_clusters, "desire", sourceEngine, traceToken
  );
  const patternSignals = clusterToGovernedSignals(
    structuredSignals.pattern_clusters, "pattern", sourceEngine, traceToken
  );
  const rootCauseSignals = clusterToGovernedSignals(
    structuredSignals.root_causes, "root_cause", sourceEngine, traceToken
  );
  const psychDriverSignals = clusterToGovernedSignals(
    structuredSignals.psychological_drivers, "psychological_driver", sourceEngine, traceToken
  );

  const objectionSignals: GovernedSignal[] = objectionMap
    .filter(o => (o.confidence || 0.5) >= SIGNAL_CONFIDENCE_FLOOR)
    .filter(o => !isRawComment(o.label))
    .map((obj, idx) => ({
      signalId: `SGL_OBJECTION_${String(idx + 1).padStart(3, "0")}`,
      category: "objection" as const,
      text: sanitizeSignalText(obj.label),
      confidence: obj.confidence || 0.5,
      evidence: purifyEvidence(obj.evidence || []),
      sourceEngine,
      sourceLayer: "surface",
      traceId: traceToken,
      consumedBy: [],
    }));

  const allSignals = [
    ...painSignals, ...desireSignals, ...objectionSignals,
    ...patternSignals, ...rootCauseSignals, ...psychDriverSignals,
  ];

  const totalInputClusters =
    structuredSignals.pain_clusters.length +
    structuredSignals.desire_clusters.length +
    structuredSignals.pattern_clusters.length +
    structuredSignals.root_causes.length +
    structuredSignals.psychological_drivers.length +
    objectionMap.length;
  const purifiedCount = totalInputClusters - allSignals.length;

  const coverageReport = buildCoverageReport(allSignals);

  console.log(
    `[SGL] INITIALIZED | v=${SGL_VERSION} | trace=${traceToken} | ` +
    `signals=${allSignals.length} | purified=${purifiedCount} | ` +
    `pains=${coverageReport.pains} | desires=${coverageReport.desires} | ` +
    `objections=${coverageReport.objections} | patterns=${coverageReport.patterns} | ` +
    `rootCauses=${coverageReport.rootCauses} | psychDrivers=${coverageReport.psychologicalDrivers} | ` +
    `sufficient=${coverageReport.coverageSufficient}`
  );

  if (purifiedCount > 0) {
    console.log(`[SGL] PURIFICATION | removed ${purifiedCount} raw/contaminated input(s) from ${totalInputClusters} total`);
  }

  if (coverageReport.missingCategories.length > 0) {
    console.warn(`[SGL] COVERAGE_GAP | missing=[${coverageReport.missingCategories.join(",")}]`);
  }

  return {
    initialized: true,
    sourceEngine,
    governedSignals: allSignals,
    coverageReport,
    consumptionLog: [],
    createdAt: new Date().toISOString(),
    traceToken,
  };
}

function buildEngineCoverageReport(signals: GovernedSignal[], requiredCategories: string[]): SignalCoverageReport {
  const counts: Record<string, number> = {
    pain: 0, desire: 0, objection: 0,
    pattern: 0, root_cause: 0, psychological_driver: 0,
  };
  for (const s of signals) {
    counts[s.category] = (counts[s.category] || 0) + 1;
  }

  const missingCategories: string[] = [];
  for (const cat of requiredCategories) {
    const min = MIN_SIGNALS_PER_CATEGORY[cat] || 1;
    if ((counts[cat] || 0) < min) {
      missingCategories.push(cat);
    }
  }

  return {
    pains: counts.pain,
    desires: counts.desire,
    objections: counts.objection,
    patterns: counts.pattern,
    rootCauses: counts.root_cause,
    psychologicalDrivers: counts.psychological_driver,
    totalSignals: signals.length,
    coverageSufficient: signals.length >= 1 && missingCategories.length === 0,
    missingCategories,
  };
}

export function resolveSignalsForEngine(
  state: SignalGovernanceState,
  engineId: EngineId,
): SignalResolution {
  const requiredCategories = ENGINE_SIGNAL_REQUIREMENTS[engineId] || [];

  const signals = state.governedSignals.filter(s =>
    requiredCategories.includes(s.category)
  );

  const cleanSignals: GovernedSignal[] = [];
  let contaminatedCount = 0;
  for (const signal of signals) {
    const leakCheck = checkSignalLeakage(signal.text);
    if (!leakCheck.clean) {
      contaminatedCount++;
      console.warn(`[SGL] PRE_DISPATCH_BLOCK | engine=${engineId} | signal=${signal.signalId} | leaks=[${leakCheck.leaks.join(",")}]`);
      continue;
    }
    const cleanEvidence: string[] = [];
    for (const ev of signal.evidence) {
      const evCheck = checkSignalLeakage(ev);
      if (evCheck.clean) {
        cleanEvidence.push(ev);
      }
    }
    cleanSignals.push({ ...signal, evidence: cleanEvidence });
  }
  if (contaminatedCount > 0) {
    console.warn(`[SGL] PRE_DISPATCH_PURGE | engine=${engineId} | blocked=${contaminatedCount} contaminated signal(s)`);
  }

  const coverage = buildEngineCoverageReport(cleanSignals, requiredCategories);

  if (!coverage.coverageSufficient) {
    console.warn(
      `[SGL] COVERAGE_INSUFFICIENT | engine=${engineId} | ` +
      `signals=${cleanSignals.length} | missing=[${coverage.missingCategories.join(",")}] | ` +
      `required=[${requiredCategories.join(",")}]`
    );
  }

  for (const signal of cleanSignals) {
    if (!signal.consumedBy.includes(engineId)) {
      signal.consumedBy.push(engineId);
    }
  }

  const consumption: EngineSignalConsumption = {
    engineId,
    signalsConsumed: cleanSignals.map(s => s.signalId),
    coverageReport: coverage,
    timestamp: new Date().toISOString(),
  };
  state.consumptionLog.push(consumption);

  console.log(
    `[SGL] RESOLVE | engine=${engineId} | raw=${signals.length} | clean=${cleanSignals.length} | ` +
    `blocked=${contaminatedCount} | categories=[${requiredCategories.join(",")}] | sufficient=${coverage.coverageSufficient}`
  );

  return {
    signals: cleanSignals,
    coverage,
    traceToken: state.traceToken,
    engineId,
  };
}

export function checkSignalLeakage(text: string): { clean: boolean; leaks: string[] } {
  const leaks: string[] = [];
  for (const pattern of LEAKAGE_PATTERNS) {
    if (pattern.test(text)) {
      leaks.push(pattern.source);
    }
  }
  if (isRawComment(text)) {
    leaks.push("RAW_COMMENT_CONTAMINATION");
  }
  return { clean: leaks.length === 0, leaks };
}

export function getGovernanceSummary(state: SignalGovernanceState): {
  version: number;
  traceToken: string;
  totalSignals: number;
  coverage: SignalCoverageReport;
  enginesServed: string[];
  consumptionLog: EngineSignalConsumption[];
} {
  return {
    version: SGL_VERSION,
    traceToken: state.traceToken,
    totalSignals: state.governedSignals.length,
    coverage: state.coverageReport,
    enginesServed: [...new Set(state.consumptionLog.map(c => c.engineId))],
    consumptionLog: state.consumptionLog,
  };
}
