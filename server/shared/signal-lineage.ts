export interface SignalLineageEntry {
  signalId: string;
  originEngine: string;
  signalCategory: string;
  signalText: string;
  parentSignalId: string | null;
  hopDepth: number;
  signalPath: string[];
  createdAt: string;
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

export function parseLineageFromSnapshot(raw: string | null): SignalLineageEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
