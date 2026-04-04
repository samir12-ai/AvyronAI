export function generateLineageId(engine, category, index) {
    const prefix = engine.toUpperCase().replace(/[^A-Z0-9]/g, "_");
    const cat = category.toUpperCase().replace(/[^A-Z0-9]/g, "_");
    return `${prefix}_${cat}_${String(index + 1).padStart(3, "0")}`;
}
export function createSourceLineageEntry(engine, category, signalText, index) {
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
export function createDerivedLineageEntry(engine, category, signalText, parentEntry, index) {
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
export function findBestParentSignal(claimText, upstreamLineage) {
    const lower = claimText.toLowerCase();
    const claimWords = lower.split(/\s+/).filter(w => w.length > 3);
    if (claimWords.length === 0)
        return null;
    let bestMatch = null;
    let bestScore = 0;
    for (const entry of upstreamLineage) {
        const signalWords = new Set(entry.signalText.toLowerCase().split(/\s+/).filter(w => w.length > 3));
        let matches = 0;
        for (const w of claimWords) {
            if (signalWords.has(w))
                matches++;
        }
        if (matches >= 1 && matches > bestScore) {
            bestScore = matches;
            bestMatch = entry;
        }
    }
    return bestMatch;
}
export function mergeLineageArrays(...arrays) {
    const seen = new Set();
    const result = [];
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
export function parseLineageFromSnapshot(raw) {
    if (!raw)
        return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    }
    catch {
        return [];
    }
}
export function extractQualifyingSignals(lineage) {
    return lineage
        .filter(e => e.hopDepth === 0)
        .map(e => ({
        signalId: e.signalId,
        originEngine: e.originEngine,
        category: e.signalCategory,
        text: e.signalText,
        hopDepth: e.hopDepth,
    }));
}
export const MIN_QUALIFYING_SIGNALS = 3;
export function validateClaimGrounding(claims, upstreamLineage, engine, category) {
    const groundedEntries = [];
    const strippedClaims = [];
    let idx = 0;
    for (const claim of claims) {
        const parent = findBestParentSignal(claim, upstreamLineage);
        if (parent) {
            groundedEntries.push(createDerivedLineageEntry(engine, category, claim, parent, idx));
            idx++;
        }
        else {
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
    };
}
