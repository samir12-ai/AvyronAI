export type SignalOriginType = "real" | "competitor" | "inferred" | "fallback" | "unknown";

export interface SignalComposition {
  real: number;
  competitor: number;
  inferred: number;
  fallback: number;
  unknown: number;
  total: number;
  dominantType: SignalOriginType;
  competitorRatio: number;
  realRatio: number;
  inferredRatio: number;
}

export function computeSignalComposition(entries: SignalLineageEntry[]): SignalComposition {
  const counts: Record<SignalOriginType, number> = { real: 0, competitor: 0, inferred: 0, fallback: 0, unknown: 0 };
  for (const e of entries) {
    const t = e.originType || "unknown";
    counts[t] = (counts[t] || 0) + 1;
  }
  const total = entries.length || 1;
  let dominantType: SignalOriginType = "unknown";
  let maxCount = 0;
  for (const [type, count] of Object.entries(counts)) {
    if (count > maxCount) {
      maxCount = count;
      dominantType = type as SignalOriginType;
    }
  }
  return {
    ...counts,
    total: entries.length,
    dominantType,
    competitorRatio: counts.competitor / total,
    realRatio: counts.real / total,
    inferredRatio: counts.inferred / total,
  };
}

export function formatCompositionLog(comp: SignalComposition): string {
  return `real=${comp.real} competitor=${comp.competitor} inferred=${comp.inferred} fallback=${comp.fallback} unknown=${comp.unknown} | dominant=${comp.dominantType} | realRatio=${(comp.realRatio * 100).toFixed(0)}% competitorRatio=${(comp.competitorRatio * 100).toFixed(0)}%`;
}

export interface SignalLineageEntry {
  signalId: string;
  originEngine: string;
  signalCategory: string;
  signalText: string;
  parentSignalId: string | null;
  hopDepth: number;
  signalPath: string[];
  createdAt: string;
  originType: SignalOriginType;
}

export function generateLineageId(engine: string, category: string, index: number): string {
  const prefix = engine.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const cat = category.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  return `${prefix}_${cat}_${String(index + 1).padStart(3, "0")}`;
}

export function createSourceLineageEntry(
  engine: string,
  category: string,
  signalText: string,
  index: number,
  originType: SignalOriginType = "unknown",
): SignalLineageEntry {
  const signalId = generateLineageId(engine, category, index);
  return {
    signalId,
    originEngine: engine,
    signalCategory: category,
    signalText: signalText.slice(0, 200),
    parentSignalId: null,
    hopDepth: 0,
    signalPath: [engine],
    createdAt: new Date().toISOString(),
    originType,
  };
}

export function createDerivedLineageEntry(
  engine: string,
  category: string,
  signalText: string,
  parentEntry: SignalLineageEntry,
  index: number,
): SignalLineageEntry {
  const signalId = generateLineageId(engine, category, index);
  return {
    signalId,
    originEngine: parentEntry.originEngine,
    signalCategory: category,
    signalText: signalText.slice(0, 200),
    parentSignalId: parentEntry.signalId,
    hopDepth: parentEntry.hopDepth + 1,
    signalPath: [...parentEntry.signalPath, engine],
    createdAt: new Date().toISOString(),
    originType: parentEntry.originType || "unknown",
  };
}

export function findBestParentSignal(
  claimText: string,
  upstreamLineage: SignalLineageEntry[],
): SignalLineageEntry | null {
  const lower = claimText.toLowerCase();
  const claimWords = lower.split(/\s+/).filter(w => w.length > 3);
  if (claimWords.length === 0) return null;

  let bestMatch: SignalLineageEntry | null = null;
  let bestScore = 0;

  for (const entry of upstreamLineage) {
    const signalWords = new Set(entry.signalText.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    let matches = 0;
    for (const w of claimWords) {
      if (signalWords.has(w)) matches++;
    }
    if (matches >= 1 && matches > bestScore) {
      bestScore = matches;
      bestMatch = entry;
    }
  }

  return bestMatch;
}

export function mergeLineageArrays(...arrays: SignalLineageEntry[][]): SignalLineageEntry[] {
  const seen = new Set<string>();
  const result: SignalLineageEntry[] = [];
  for (const arr of arrays) {
    for (const entry of arr) {
      if (!seen.has(entry.signalId)) {
        seen.add(entry.signalId);
        result.push(entry);
      }
    }
  }
  return result;
}

function normalizeLineageEntry(raw: any): SignalLineageEntry {
  return {
    signalId: raw.signalId || "",
    originEngine: raw.originEngine || "",
    signalCategory: raw.signalCategory || "",
    signalText: raw.signalText || "",
    parentSignalId: raw.parentSignalId || null,
    hopDepth: raw.hopDepth || 0,
    signalPath: raw.signalPath || [],
    createdAt: raw.createdAt || "",
    originType: raw.originType || "unknown",
  };
}

export function parseLineageFromSnapshot(raw: string | null): SignalLineageEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeLineageEntry);
  } catch {
    return [];
  }
}

export interface QualifyingSignal {
  signalId: string;
  originEngine: string;
  category: string;
  text: string;
  hopDepth: number;
  originType: SignalOriginType;
}

export function extractQualifyingSignals(lineage: SignalLineageEntry[]): QualifyingSignal[] {
  return lineage
    .filter(e => e.hopDepth === 0)
    .map(e => ({
      signalId: e.signalId,
      originEngine: e.originEngine,
      category: e.signalCategory,
      text: e.signalText,
      hopDepth: e.hopDepth,
      originType: e.originType,
    }));
}

export const MIN_QUALIFYING_SIGNALS = 3;

export interface SignalGroundingResult {
  totalClaims: number;
  groundedClaims: number;
  ungroundedClaims: number;
  groundingRatio: number;
  signalSufficient: boolean;
  groundedEntries: SignalLineageEntry[];
  strippedClaims: string[];
  composition: SignalComposition;
}

export function validateClaimGrounding(
  claims: string[],
  upstreamLineage: SignalLineageEntry[],
  engine: string,
  category: string,
): SignalGroundingResult {
  const groundedEntries: SignalLineageEntry[] = [];
  const strippedClaims: string[] = [];
  let idx = 0;

  for (const claim of claims) {
    const parent = findBestParentSignal(claim, upstreamLineage);
    if (parent) {
      groundedEntries.push(createDerivedLineageEntry(engine, category, claim, parent, idx));
      idx++;
    } else {
      strippedClaims.push(claim);
    }
  }

  const totalClaims = claims.length;
  const groundedClaims = groundedEntries.length;
  return {
    totalClaims,
    groundedClaims,
    ungroundedClaims: strippedClaims.length,
    groundingRatio: totalClaims > 0 ? groundedClaims / totalClaims : 0,
    signalSufficient: upstreamLineage.filter(e => e.hopDepth === 0).length >= MIN_QUALIFYING_SIGNALS,
    groundedEntries,
    strippedClaims,
    composition: computeSignalComposition(groundedEntries),
  };
}
