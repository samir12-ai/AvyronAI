import { SIMILARITY_MIN_EVIDENCE_THRESHOLD } from "./constants";
function cosineSimilarity(a, b) {
    if (a.length !== b.length || a.length === 0)
        return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0)
        return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
function jaccardSimilarity(setA, setB) {
    if (setA.size === 0 && setB.size === 0)
        return 0;
    const intersection = [...setA].filter(x => setB.has(x)).length;
    const union = new Set([...setA, ...setB]).size;
    if (union === 0)
        return 0;
    return intersection / union;
}
function parseContentMix(contentTypeRatio) {
    const mix = {};
    if (!contentTypeRatio)
        return mix;
    const parts = contentTypeRatio.split(",");
    for (const part of parts) {
        const [key, val] = part.split(":");
        if (key && val) {
            mix[key.trim().toLowerCase()] = parseFloat(val) / 100 || 0;
        }
    }
    return mix;
}
function contentMixVector(mix, allKeys) {
    return allKeys.map(k => mix[k] || 0);
}
function computeContentMixSimilarity(competitors) {
    const mixes = competitors.map(c => parseContentMix(c.contentTypeRatio));
    const hasData = mixes.filter(m => Object.keys(m).length > 0);
    if (hasData.length < 2)
        return { score: 0, sufficient: false };
    const allKeys = [...new Set(mixes.flatMap(m => Object.keys(m)))];
    const vectors = mixes.map(m => contentMixVector(m, allKeys));
    let totalSim = 0;
    let pairCount = 0;
    for (let i = 0; i < vectors.length; i++) {
        for (let j = i + 1; j < vectors.length; j++) {
            totalSim += cosineSimilarity(vectors[i], vectors[j]);
            pairCount++;
        }
    }
    return { score: pairCount > 0 ? Math.round((totalSim / pairCount) * 1000) / 1000 : 0, sufficient: true };
}
function computeOfferLanguageSimilarity(competitors) {
    const offerSets = [];
    for (const c of competitors) {
        const posts = c.posts || [];
        if (posts.length === 0) {
            offerSets.push(new Set());
            continue;
        }
        const offerTerms = new Set();
        for (const p of posts) {
            if (p.hasOffer && p.caption) {
                const words = p.caption.toLowerCase().split(/\s+/).filter(w => w.length > 3);
                for (const w of words)
                    offerTerms.add(w);
            }
        }
        offerSets.push(offerTerms);
    }
    const withData = offerSets.filter(s => s.size > 0);
    if (withData.length < 2)
        return { score: 0, sufficient: false };
    let totalSim = 0;
    let pairCount = 0;
    for (let i = 0; i < offerSets.length; i++) {
        if (offerSets[i].size === 0)
            continue;
        for (let j = i + 1; j < offerSets.length; j++) {
            if (offerSets[j].size === 0)
                continue;
            totalSim += jaccardSimilarity(offerSets[i], offerSets[j]);
            pairCount++;
        }
    }
    return { score: pairCount > 0 ? Math.round((totalSim / pairCount) * 1000) / 1000 : 0, sufficient: true };
}
function computeHookStyleSimilarity(competitors) {
    const hookSets = [];
    for (const c of competitors) {
        if (c.hookStyles) {
            hookSets.push(new Set(c.hookStyles.split(",").map(h => h.trim().toLowerCase()).filter(Boolean)));
        }
        else {
            hookSets.push(new Set());
        }
    }
    const withData = hookSets.filter(s => s.size > 0);
    if (withData.length < 2)
        return { score: 0, sufficient: false };
    let totalSim = 0;
    let pairCount = 0;
    for (let i = 0; i < hookSets.length; i++) {
        if (hookSets[i].size === 0)
            continue;
        for (let j = i + 1; j < hookSets.length; j++) {
            if (hookSets[j].size === 0)
                continue;
            totalSim += jaccardSimilarity(hookSets[i], hookSets[j]);
            pairCount++;
        }
    }
    return { score: pairCount > 0 ? Math.round((totalSim / pairCount) * 1000) / 1000 : 0, sufficient: true };
}
function computeCTADistributionSimilarity(competitors) {
    const ctaVectors = [];
    for (const c of competitors) {
        const posts = c.posts || [];
        if (posts.length === 0) {
            ctaVectors.push([]);
            continue;
        }
        const totalPosts = posts.length;
        const ctaCount = posts.filter(p => p.hasCTA).length;
        const offerCount = posts.filter(p => p.hasOffer).length;
        const noCTACount = posts.filter(p => !p.hasCTA && !p.hasOffer).length;
        ctaVectors.push([
            ctaCount / totalPosts,
            offerCount / totalPosts,
            noCTACount / totalPosts,
        ]);
    }
    const withData = ctaVectors.filter(v => v.length > 0);
    if (withData.length < 2)
        return { score: 0, sufficient: false };
    let totalSim = 0;
    let pairCount = 0;
    for (let i = 0; i < ctaVectors.length; i++) {
        if (ctaVectors[i].length === 0)
            continue;
        for (let j = i + 1; j < ctaVectors.length; j++) {
            if (ctaVectors[j].length === 0)
                continue;
            totalSim += cosineSimilarity(ctaVectors[i], ctaVectors[j]);
            pairCount++;
        }
    }
    return { score: pairCount > 0 ? Math.round((totalSim / pairCount) * 1000) / 1000 : 0, sufficient: true };
}
function buildEvidenceCoverageMap(competitors) {
    return competitors.map(c => {
        const posts = c.posts || [];
        const comments = c.comments || [];
        const missing = [];
        if (posts.length === 0)
            missing.push("posts");
        if (comments.length === 0)
            missing.push("comments");
        if (!c.contentTypeRatio)
            missing.push("contentTypeRatio");
        if (!c.hookStyles)
            missing.push("hookStyles");
        if (!c.ctaPatterns)
            missing.push("ctaPatterns");
        if (!c.engagementRatio)
            missing.push("engagementRatio");
        if (!c.messagingTone)
            missing.push("messagingTone");
        const totalFields = 7;
        const availableFields = totalFields - missing.length;
        return {
            competitorId: c.id,
            competitorName: c.name,
            postsAvailable: posts.length,
            commentsAvailable: comments.length,
            missingDataPoints: missing,
            coverageRatio: Math.round((availableFields / totalFields) * 100) / 100,
        };
    });
}
export function computeSimilarityDiagnosis(competitors, signalResults) {
    if (competitors.length < 2) {
        return {
            overallSimilarityIndex: 0,
            dimensions: {
                contentMix: { score: 0, sufficient: false },
                offerLanguage: { score: 0, sufficient: false },
                hookStyle: { score: 0, sufficient: false },
                ctaIntent: { score: 0, sufficient: false },
            },
            evidenceCoverage: buildEvidenceCoverageMap(competitors),
            diagnosis: "INSUFFICIENT_DATA",
            explanation: "At least 2 competitors required for similarity analysis",
        };
    }
    const contentMix = computeContentMixSimilarity(competitors);
    const offerLanguage = computeOfferLanguageSimilarity(competitors);
    const hookStyle = computeHookStyleSimilarity(competitors);
    const ctaIntent = computeCTADistributionSimilarity(competitors);
    const dimensions = {
        contentMix,
        offerLanguage,
        hookStyle,
        ctaIntent,
    };
    const sufficientDimensions = [contentMix, offerLanguage, hookStyle, ctaIntent].filter(d => d.sufficient);
    if (sufficientDimensions.length === 0) {
        return {
            overallSimilarityIndex: 0,
            dimensions,
            evidenceCoverage: buildEvidenceCoverageMap(competitors),
            diagnosis: "INSUFFICIENT_DATA",
            explanation: "No dimensions have sufficient data to compute similarity",
        };
    }
    const overallSimilarityIndex = Math.round((sufficientDimensions.reduce((s, d) => s + d.score, 0) / sufficientDimensions.length) * 1000) / 1000;
    const evidenceCoverage = buildEvidenceCoverageMap(competitors);
    const avgCoverage = evidenceCoverage.reduce((s, c) => s + c.coverageRatio, 0) / evidenceCoverage.length;
    const anyMissingPosts = evidenceCoverage.some(c => c.postsAvailable === 0);
    const lowPostEvidence = competitors.some(c => (c.posts || []).length < SIMILARITY_MIN_EVIDENCE_THRESHOLD);
    const lowCoverage = avgCoverage < 0.5 || anyMissingPosts;
    let diagnosis;
    let explanation;
    if (lowPostEvidence) {
        const belowThreshold = competitors.filter(c => (c.posts || []).length < SIMILARITY_MIN_EVIDENCE_THRESHOLD);
        const names = belowThreshold.map(c => c.name).join(", ");
        diagnosis = "LOW_CONFIDENCE";
        explanation = `LOW_CONFIDENCE: Competitor(s) ${names} have fewer than ${SIMILARITY_MIN_EVIDENCE_THRESHOLD} posts. Similarity index (${overallSimilarityIndex}) is unreliable due to insufficient evidence per competitor.`;
    }
    else if (lowCoverage && overallSimilarityIndex > 0.6) {
        diagnosis = "SIMILARITY_LIKELY_DATA_LIMITATION";
        explanation = `High similarity (${overallSimilarityIndex}) detected with low evidence coverage (avg ${Math.round(avgCoverage * 100)}%). Similarity is likely an artifact of limited data, not market reality.`;
    }
    else if (!lowCoverage && overallSimilarityIndex > 0.6) {
        diagnosis = "SIMILARITY_LIKELY_MARKET_REALITY";
        explanation = `High similarity (${overallSimilarityIndex}) detected with sufficient evidence coverage (avg ${Math.round(avgCoverage * 100)}%). Competitors genuinely operate with similar strategies.`;
    }
    else if (overallSimilarityIndex <= 0.6) {
        diagnosis = "LOW_SIMILARITY";
        explanation = `Competitors show distinct strategies (similarity: ${overallSimilarityIndex}). ${sufficientDimensions.length}/${Object.keys(dimensions).length} dimensions had sufficient data.`;
    }
    else {
        diagnosis = "INSUFFICIENT_DATA";
        explanation = "Unable to determine similarity cause due to mixed evidence quality.";
    }
    return {
        overallSimilarityIndex,
        dimensions,
        evidenceCoverage,
        diagnosis,
        explanation,
    };
}
