import { db } from "../db";
import { positioningSnapshots, miSnapshots, audienceSnapshots, ciCompetitors, } from "@shared/schema";
import { loadProductDNA, formatProductDNAForPrompt } from "../shared/product-dna";
import { inArray, eq, and, desc } from "drizzle-orm";
import { aiChat } from "../ai-client";
import { checkForOrphanClaims } from "../shared/signal-quality-gate";
import { enforceGlobalStateRefresh } from "../shared/engine-health";
import { formatAELForPrompt } from "../analytical-enrichment-layer/engine";
import { enforcePositioningCompliance, buildCausalDirectiveForPrompt, applyCompliancePenalties, } from "../causal-enforcement-layer/engine";
import { POSITIONING_ENGINE_VERSION, POSITIONING_THRESHOLDS, GENERIC_TERRITORY_PATTERNS, BOUNDARY_HARD_PATTERNS, BOUNDARY_SOFT_PATTERNS, } from "./constants";
import { enforceBoundaryWithSanitization, applySoftSanitization, assessDataReliability, normalizeConfidence, detectGenericOutput, pruneOldSnapshots, } from "../engine-hardening";
import { purifyEvidence } from "../signal-governance/engine";
import { verifySnapshotIntegrity } from "../market-intelligence-v3/engine-state";
import { ENGINE_VERSION as MI_ENGINE_VERSION } from "../market-intelligence-v3/constants";
import { buildFreshnessMetadata, logFreshnessTraceability } from "../shared/snapshot-trust";
function layer1_categoryDetection(miData, competitorCount = 0, signalCount = 0) {
    const marketState = miData.marketState || "";
    const diagnosis = miData.marketDiagnosis || "";
    const narrative = miData.narrativeSynthesis || "";
    const contentDna = safeJsonParse(miData.contentDnaData, []);
    let websiteText = "";
    const multiSourceData = safeJsonParse(miData.multiSourceSignals, {});
    for (const compData of Object.values(multiSourceData)) {
        if (compData?.website) {
            websiteText += " " + (compData.website.headlineExtractions || []).join(" ");
            websiteText += " " + (compData.website.positioningLanguage || []).join(" ");
            websiteText += " " + (compData.website.featureHierarchy || []).join(" ");
        }
    }
    const combined = `${marketState} ${diagnosis} ${narrative} ${websiteText}`.toLowerCase();
    const categories = {
        fitness: ["fitness", "workout", "gym", "exercise", "weight", "muscle", "body"],
        health: ["health", "wellness", "nutrition", "diet", "medical", "therapy"],
        marketing: ["marketing", "brand", "audience", "content", "social media", "ads", "campaign"],
        ecommerce: ["ecommerce", "store", "product", "shop", "dropship", "retail"],
        education: ["education", "course", "learn", "student", "training", "certification"],
        finance: ["finance", "invest", "trading", "crypto", "wealth", "money"],
        tech: ["tech", "software", "app", "saas", "startup", "developer"],
        beauty: ["beauty", "skin", "makeup", "cosmetic", "skincare"],
        food: ["food", "recipe", "restaurant", "cook", "chef"],
    };
    let best = "general";
    let bestScore = 0;
    for (const [cat, keywords] of Object.entries(categories)) {
        let score = 0;
        for (const kw of keywords) {
            if (combined.includes(kw))
                score++;
        }
        if (score > bestScore) {
            bestScore = score;
            best = cat;
        }
    }
    let subcategory = null;
    const sufficientData = competitorCount >= 8 && signalCount >= 6;
    if (sufficientData || bestScore >= 3) {
        const subcategories = {
            marketing: [
                { keywords: ["ai", "automation", "machine learning", "intelligence", "algorithm"], label: "AI Marketing System" },
                { keywords: ["analytics", "data", "intelligence", "insights", "metrics", "dashboard"], label: "Marketing Intelligence Platform" },
                { keywords: ["growth", "scale", "roi", "revenue", "performance"], label: "Growth Marketing Platform" },
                { keywords: ["content", "creator", "influencer", "social"], label: "Content Marketing Platform" },
                { keywords: ["agency", "client", "service", "consulting", "done-for-you"], label: "Marketing Agency" },
                { keywords: ["automation", "system", "workflow", "funnel", "pipeline"], label: "Marketing Automation System" },
                { keywords: ["personal brand", "authority", "thought leader", "coaching"], label: "Authority Marketing" },
            ],
            tech: [
                { keywords: ["saas", "subscription", "platform", "cloud"], label: "SaaS Platform" },
                { keywords: ["ai", "machine learning", "automation", "intelligence"], label: "AI Technology" },
                { keywords: ["mobile", "app", "ios", "android"], label: "Mobile Technology" },
                { keywords: ["developer", "api", "tools", "devtools"], label: "Developer Tools" },
            ],
            fitness: [
                { keywords: ["online", "coaching", "program", "transformation"], label: "Online Fitness Coaching" },
                { keywords: ["supplement", "nutrition", "protein"], label: "Fitness Supplements" },
                { keywords: ["gym", "studio", "facility"], label: "Fitness Facility" },
            ],
            finance: [
                { keywords: ["crypto", "blockchain", "defi", "token"], label: "Crypto & Blockchain" },
                { keywords: ["trading", "forex", "stocks", "options"], label: "Trading Platform" },
                { keywords: ["investing", "wealth", "portfolio", "fund"], label: "Investment Management" },
            ],
            education: [
                { keywords: ["online", "course", "digital", "e-learning"], label: "Online Education" },
                { keywords: ["coaching", "mentor", "1-on-1", "consulting"], label: "Coaching & Mentorship" },
                { keywords: ["certification", "accreditation", "professional"], label: "Professional Certification" },
            ],
            ecommerce: [
                { keywords: ["dropship", "fulfillment", "supplier"], label: "Dropshipping" },
                { keywords: ["brand", "d2c", "direct", "product"], label: "Direct-to-Consumer Brand" },
                { keywords: ["marketplace", "platform", "vendor"], label: "E-commerce Marketplace" },
            ],
        };
        const dnaText = contentDna.map((e) => {
            const hooks = (e.hookArchetypes || []).map((h) => typeof h === "string" ? h : h.type || h.name || "").join(" ");
            const frameworks = (e.narrativeFrameworks || []).map((n) => typeof n === "string" ? n : n.type || n.name || "").join(" ");
            const captions = (e.topCaptions || e.sampleCaptions || []).join(" ");
            return `${hooks} ${frameworks} ${captions}`;
        }).join(" ").toLowerCase();
        const enrichedText = `${combined} ${dnaText}`;
        const subOptions = subcategories[best] || [];
        let bestSub = null;
        let bestSubScore = 0;
        for (const sub of subOptions) {
            let score = 0;
            for (const kw of sub.keywords) {
                if (enrichedText.includes(kw))
                    score++;
            }
            if (score > bestSubScore) {
                bestSubScore = score;
                bestSub = sub.label;
            }
        }
        if (bestSubScore >= 2) {
            subcategory = bestSub;
        }
        else if (sufficientData) {
            const allSubs = Object.values(subcategories).flat();
            let topLabel = null;
            let topScore = 0;
            let topParent = null;
            for (const [parentCat, subs] of Object.entries(subcategories)) {
                for (const sub of subs) {
                    let score = 0;
                    for (const kw of sub.keywords) {
                        if (enrichedText.includes(kw))
                            score++;
                    }
                    if (score > topScore) {
                        topScore = score;
                        topLabel = sub.label;
                        topParent = parentCat;
                    }
                }
            }
            if (topLabel) {
                subcategory = topLabel;
                if (best === "general" && topParent) {
                    best = topParent;
                }
            }
        }
    }
    return { macro: best, subcategory };
}
function layer2_marketNarrativeMap(miData) {
    const narrativeMap = {};
    const contentDna = safeJsonParse(miData.contentDnaData, []);
    for (const entry of contentDna) {
        const compName = entry.competitorName || entry.competitor || "Unknown";
        const hooks = entry.hookArchetypes || [];
        const narratives = entry.narrativeFrameworks || [];
        narrativeMap[compName] = [
            ...hooks.map((h) => typeof h === "string" ? h : h.type || h.name || ""),
            ...narratives.map((n) => typeof n === "string" ? n : n.type || n.name || ""),
        ].filter(Boolean);
    }
    return narrativeMap;
}
function layer3_narrativeSaturationDetection(narrativeMap, miData) {
    const dominanceData = miData ? safeJsonParse(miData.dominanceData, []) : [];
    const authorityScores = {};
    for (const d of dominanceData) {
        const name = d.competitor || d.competitorName || "";
        if (name) {
            authorityScores[name] = Math.min(1.0, (d.dominanceScore || d.score || 0) / 100);
        }
    }
    const totalAuthorityWeight = Object.keys(narrativeMap).reduce((sum, comp) => {
        return sum + (authorityScores[comp] || 0.1);
    }, 0) || 1;
    const narrativeWeights = {};
    for (const [comp, narratives] of Object.entries(narrativeMap)) {
        const compWeight = authorityScores[comp] || 0.1;
        for (const n of narratives) {
            const key = n.toLowerCase().trim();
            if (key) {
                narrativeWeights[key] = (narrativeWeights[key] || 0) + compWeight;
            }
        }
    }
    const saturation = {};
    for (const [narrative, weight] of Object.entries(narrativeWeights)) {
        saturation[narrative] = Math.min(1.0, weight / totalAuthorityWeight);
    }
    return saturation;
}
function layer4_trustGapDetection(audienceData) {
    const objections = safeJsonParse(audienceData.objectionMap, []);
    const awareness = safeJsonParse(audienceData.awarenessLevel, {});
    const trustGaps = [];
    let trustGapScore = 0;
    for (const obj of objections) {
        if (obj.canonical && obj.frequency > 0) {
            trustGaps.push(obj.canonical);
            trustGapScore += obj.frequency;
        }
    }
    if (awareness.level === "UNAWARE" || awareness.level === "PROBLEM_AWARE") {
        trustGapScore *= 1.3;
    }
    return { trustGaps, trustGapScore: Math.min(1.0, trustGapScore / 100) };
}
function layer5_segmentPriorityResolution(audienceData) {
    const segments = safeJsonParse(audienceData.audienceSegments, []);
    const density = safeJsonParse(audienceData.segmentDensity, []);
    const pains = safeJsonParse(audienceData.audiencePains, []);
    return segments.map((seg, i) => {
        const densityItem = density.find((d) => d.segment === seg.name);
        const densityScore = densityItem?.densityScore || 0;
        let painAlignment = 0;
        if (seg.painProfile && pains.length > 0) {
            const matchedPains = seg.painProfile.filter((p) => pains.some((pain) => pain.canonical.toLowerCase().includes(p.toLowerCase())));
            painAlignment = seg.painProfile.length > 0 ? matchedPains.length / seg.painProfile.length : 0;
        }
        return {
            segment: seg.name,
            priority: densityScore,
            painAlignment: Math.round(painAlignment * 100) / 100,
        };
    }).sort((a, b) => b.priority - a.priority);
}
function layer6_marketPowerAnalysis(miData, competitors) {
    const dominanceData = safeJsonParse(miData.dominanceData, []);
    const contentDna = safeJsonParse(miData.contentDnaData, []);
    const entries = [];
    for (const comp of competitors) {
        const domEntry = dominanceData.find((d) => d.competitor === comp.name || d.competitorName === comp.name);
        const dnaEntry = contentDna.find((d) => d.competitor === comp.name || d.competitorName === comp.name);
        const authorityScore = domEntry?.dominanceScore || domEntry?.score || 0;
        const engagementStrength = comp.engagementRatio || 0;
        const contentVolume = dnaEntry?.hookArchetypes?.length || 0;
        const contentDominanceScore = Math.min(1.0, contentVolume / 10);
        const narrativeOwnership = dnaEntry?.narrativeFrameworks?.length || 0;
        const narrativeOwnershipIndex = Math.min(1.0, narrativeOwnership / 5);
        entries.push({
            competitorName: comp.name,
            authorityScore: Math.min(1.0, authorityScore / 100),
            contentDominanceScore,
            narrativeOwnershipIndex,
            engagementStrength: Math.min(1.0, engagementStrength * 10),
        });
    }
    entries.sort((a, b) => b.authorityScore - a.authorityScore);
    const topAuthority = entries[0]?.authorityScore || 0;
    const avgAuthority = entries.length > 0
        ? entries.reduce((s, e) => s + e.authorityScore, 0) / entries.length
        : 0;
    const authorityGap = topAuthority - avgAuthority;
    const topEntry = entries[0];
    const categoryControlIndex = topEntry
        ? (topEntry.narrativeOwnershipIndex * 0.6) + (topEntry.contentDominanceScore * 0.4)
        : 0;
    const multiSignalDominance = topEntry
        ? (topEntry.engagementStrength >= POSITIONING_THRESHOLDS.FLANKING_ENGAGEMENT_THRESHOLD &&
            topEntry.narrativeOwnershipIndex >= POSITIONING_THRESHOLDS.FLANKING_NARRATIVE_OWNERSHIP_THRESHOLD &&
            topEntry.contentDominanceScore >= POSITIONING_THRESHOLDS.FLANKING_CONTENT_VOLUME_THRESHOLD)
        : false;
    const flankingMode = authorityGap >= POSITIONING_THRESHOLDS.AUTHORITY_GAP_FLANKING_THRESHOLD ||
        categoryControlIndex >= 0.70 ||
        multiSignalDominance;
    return { entries, authorityGap, flankingMode };
}
export function computeSpecificityScore(territory, category, productDna) {
    const lower = territory.toLowerCase().trim();
    const tokens = lower.split(/\s+/).filter(Boolean);
    let penalty = 0;
    for (const pattern of GENERIC_TERRITORY_PATTERNS) {
        const patternTokens = pattern.toLowerCase().split(/\s+/);
        const overlap = patternTokens.filter(pt => tokens.some(t => t.includes(pt) || pt.includes(t))).length;
        const similarity = patternTokens.length > 0 ? overlap / patternTokens.length : 0;
        if (similarity >= 0.5) {
            const dilution = tokens.length > patternTokens.length ? patternTokens.length / tokens.length : 1;
            penalty = Math.max(penalty, similarity * dilution * POSITIONING_THRESHOLDS.GENERIC_TERRITORY_PENALTY);
        }
    }
    if (tokens.length <= 1) {
        penalty = Math.max(penalty, 0.20);
    }
    else if (tokens.length === 2) {
        penalty = Math.max(penalty, 0.10);
    }
    const categoryTokens = category.toLowerCase().split(/\s+/);
    const hasCategoryContext = tokens.some(t => categoryTokens.some(ct => t === ct || (t.length >= 4 && ct.length >= 4 && (t.includes(ct) || ct.includes(t)))));
    const categoryBonus = hasCategoryContext ? 0.10 : 0;
    const hasContrast = lower.includes(" vs ") || lower.includes(" versus ") || lower.includes(" over ") ||
        lower.includes("-driven") || lower.includes("-backed") || lower.includes("-focused");
    const contrastBonus = hasContrast ? 0.15 : 0;
    const lengthBonus = tokens.length >= 4 ? 0.05 : 0;
    let domainSpecificityPenalty = 0;
    if (productDna) {
        const domainVocab = [
            productDna.businessType,
            productDna.coreOffer,
            productDna.coreProblemSolved,
            productDna.uniqueMechanism,
        ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .split(/\s+/)
            .filter(w => w.length >= 4);
        const hasDomainTerm = domainVocab.some(dw => tokens.some(tw => tw.includes(dw) || dw.includes(tw)));
        if (!hasDomainTerm && domainVocab.length > 0) {
            domainSpecificityPenalty = 0.15;
        }
    }
    const MECHANISM_ACTION_VERBS = ["resolves", "eliminates", "replaces", "converts", "transforms", "removes", "delivers", "solves", "fixes", "prevents", "reduces", "extracts", "generates"];
    const hasMechanismLanguage = MECHANISM_ACTION_VERBS.some(v => lower.includes(v));
    const mechanismLanguagePenalty = !hasMechanismLanguage ? 0.10 : 0;
    const SYSTEM_NOUNS = ["system", "tool", "platform", "pipeline", "process", "framework", "engine", "workflow", "protocol", "method", "mechanism", "infrastructure", "stack", "architecture", "module", "layer", "approach", "model", "structure"];
    const SERVICE_NOUNS = ["process", "approach", "model", "methodology", "framework", "practice", "protocol", "method", "structure"];
    const isServiceBusiness = productDna?.businessType
        ? /consult|agency|service|coach|freelanc|advisor/i.test(productDna.businessType)
        : false;
    const relevantNouns = isServiceBusiness ? [...SYSTEM_NOUNS, ...SERVICE_NOUNS] : SYSTEM_NOUNS;
    const hasSystemNoun = relevantNouns.some(n => tokens.some(t => t === n || t.endsWith(n) || t.startsWith(n)));
    const systemNounPenalty = !hasSystemNoun ? 0.15 : 0;
    const FAILURE_VERBS = ["fails", "breaks", "lacks", "missing", "blocks", "prevents", "collapses", "stalls", "erodes", "undermines", "fragments", "disconnects", "decays", "degrades"];
    const hasFailureLanguage = FAILURE_VERBS.some(v => lower.includes(v));
    const failurePenalty = !hasFailureLanguage ? 0.08 : 0;
    const CROSS_INDUSTRY_GENERICS = ["quality", "growth", "success", "results", "improvement", "performance", "efficiency", "value", "experience", "satisfaction", "engagement", "awareness", "loyalty", "retention", "conversion"];
    const genericWordCount = CROSS_INDUSTRY_GENERICS.filter(g => tokens.some(t => t === g)).length;
    const nonGenericCount = tokens.filter(t => !CROSS_INDUSTRY_GENERICS.includes(t)).length;
    const crossIndustryPenalty = genericWordCount > 0 && nonGenericCount < 2 ? 0.12 : 0;
    const AUDIENCE_SIGNAL_MARKERS = ["concerns", "needs", "desires", "fears", "anxiety", "hesitation", "worry", "belonging", "community", "affordability", "aspiration", "motivation", "sentiment", "emotion", "feeling", "perception", "belief", "attitude", "mindset"];
    const audienceMarkerCount = AUDIENCE_SIGNAL_MARKERS.filter(m => tokens.some(t => t === m || t.endsWith(m))).length;
    const hasAnySystemNoun = relevantNouns.some(n => tokens.some(t => t === n || t.endsWith(n) || t.startsWith(n)));
    const audienceLevelPenalty = (audienceMarkerCount >= 1 && !hasAnySystemNoun) ? 0.20 : (audienceMarkerCount >= 2 ? 0.12 : 0);
    const totalPenalty = Math.min(0.90, penalty + domainSpecificityPenalty + mechanismLanguagePenalty + systemNounPenalty + failurePenalty + crossIndustryPenalty + audienceLevelPenalty);
    return Math.max(0, Math.min(1.15, 1 - totalPenalty + categoryBonus + contrastBonus + lengthBonus));
}
export function classifyTerritoryLevel(territory) {
    const combined = `${territory.name} ${territory.enemyDefinition || ""} ${territory.narrativeDirection || ""} ${territory.domainFailure || ""}`.toLowerCase();
    const tokens = combined.split(/\s+/).filter(Boolean);
    const reasons = [];
    const SYSTEM_STRUCTURE_MARKERS = ["system", "tool", "platform", "pipeline", "process", "framework", "engine", "workflow", "protocol", "method", "mechanism", "infrastructure", "stack", "architecture", "module", "layer", "approach", "model", "structure", "integration", "validation", "verification", "audit"];
    const FAILURE_MARKERS = ["fail", "fails", "break", "breaks", "lack", "lacks", "missing", "block", "blocks", "prevent", "prevents", "collapse", "collapses", "stall", "stalls", "erode", "erodes", "undermine", "undermines", "fragment", "fragments", "disconnect", "disconnects", "inability", "absence", "breakdown", "failure", "deficit", "gap", "blind spot", "bottleneck"];
    const AUDIENCE_EMOTION_MARKERS = ["concerns", "needs", "desires", "fears", "anxiety", "hesitation", "worry", "belonging", "community", "affordability", "aspiration", "motivation", "trust", "cost", "transformation", "simplicity", "empowerment", "wellness", "satisfaction", "loyalty"];
    const hasSystem = SYSTEM_STRUCTURE_MARKERS.some(m => tokens.some(t => t === m || t.endsWith(m) || t.startsWith(m)));
    const hasFailure = FAILURE_MARKERS.some(m => combined.includes(m));
    const audienceCount = AUDIENCE_EMOTION_MARKERS.filter(m => tokens.some(t => t === m || t.endsWith(m))).length;
    if (!hasSystem)
        reasons.push("no system-level noun (tool, process, pipeline, framework, etc.)");
    if (!hasFailure)
        reasons.push("no failure condition (fails, breaks, lacks, missing, etc.)");
    if (audienceCount >= 2)
        reasons.push(`${audienceCount} audience-level emotional markers detected`);
    const nameTokens = territory.name.toLowerCase().split(/\s+/);
    const nameAudienceCount = AUDIENCE_EMOTION_MARKERS.filter(m => nameTokens.some(t => t === m)).length;
    const nameSystemCount = SYSTEM_STRUCTURE_MARKERS.some(m => nameTokens.some(t => t === m));
    if (nameAudienceCount >= 1 && !nameSystemCount) {
        reasons.push(`territory name "${territory.name}" is audience-level language, not system-level`);
    }
    if (hasSystem && hasFailure && audienceCount < 2)
        return { level: "system", reasons: [] };
    if (!hasSystem && !hasFailure && audienceCount >= 1)
        return { level: "audience", reasons };
    return { level: "mixed", reasons };
}
export function validateTerritorySpecificity(territories) {
    const rejections = [];
    let systemCount = 0;
    let audienceCount = 0;
    for (const t of territories) {
        const classification = classifyTerritoryLevel(t);
        if (classification.level === "system") {
            systemCount++;
        }
        else if (classification.level === "audience") {
            audienceCount++;
            rejections.push({ name: t.name, reasons: classification.reasons });
        }
        else {
            const hasMinimalStructure = (t.domainFailure && t.domainFailure.trim().length > 15) ||
                (t.operationalProblem && t.operationalProblem.trim().length > 15);
            if (hasMinimalStructure) {
                systemCount++;
            }
            else {
                audienceCount++;
                rejections.push({ name: t.name, reasons: [...classification.reasons, "mixed but lacks domain failure or operational problem detail"] });
            }
        }
    }
    return {
        passed: rejections.length === 0,
        rejections,
        systemCount,
        audienceCount,
    };
}
export function validateNarrativeOutput(text) {
    if (!text || typeof text !== "string")
        return { valid: false, reason: "Empty or non-string input" };
    const lower = text.toLowerCase().trim();
    if (/^we\s/i.test(text.trim()) || /\bwe (help|elevate|transform|empower|deliver|create|provide|offer|guarantee)\b/i.test(lower)) {
        return { valid: false, reason: "First-person promotional language" };
    }
    if (/^(get|join|start|discover|unlock|experience|try|buy|sign up|subscribe)\s/i.test(text.trim())) {
        return { valid: false, reason: "Imperative CTA detected" };
    }
    if (/\b(best|#1|number one|world-class|unrivaled|unmatched|guaranteed|absolutely|incredible|amazing|revolutionary)\b/i.test(lower)) {
        return { valid: false, reason: "Unsubstantiated superlative" };
    }
    if (/^your\s.*(awaits|starts here|begins now|is here|deserves)/i.test(text.trim())) {
        return { valid: false, reason: "Promotional CTA pattern" };
    }
    if (lower.length < 15) {
        return { valid: false, reason: "Too short for strategic framing" };
    }
    return { valid: true };
}
export function computeSemanticSaturation(territory, narrativeMap, contentDna, competitorCount) {
    const tLower = territory.toLowerCase();
    const tTokens = new Set(tLower.split(/\s+/).filter(t => t.length > 2));
    if (tTokens.size === 0)
        return 0;
    let matchSignals = 0;
    let totalSignals = 0;
    for (const narratives of Object.values(narrativeMap)) {
        for (const n of narratives) {
            totalSignals++;
            const nTokens = new Set(n.toLowerCase().split(/\s+/));
            let overlap = 0;
            for (const t of tTokens) {
                for (const nt of nTokens) {
                    if (t.includes(nt) || nt.includes(t)) {
                        overlap++;
                        break;
                    }
                }
            }
            if (tTokens.size > 0 && overlap / tTokens.size >= 0.3) {
                matchSignals++;
            }
        }
    }
    for (const entry of contentDna) {
        const hooks = entry.hookArchetypes || [];
        const captions = entry.topCaptions || entry.sampleCaptions || [];
        const ctas = entry.ctaPatterns || [];
        const frameworks = entry.narrativeFrameworks || [];
        for (const fw of frameworks) {
            totalSignals++;
            const fwLower = (typeof fw === "string" ? fw : fw.name || "").toLowerCase();
            const fwTokens = new Set(fwLower.split(/\s+/).filter((t) => t.length > 2));
            let fwOverlap = 0;
            for (const t of tTokens) {
                for (const ft of fwTokens) {
                    if (t.includes(ft) || ft.includes(t)) {
                        fwOverlap++;
                        break;
                    }
                }
            }
            if (tTokens.size > 0 && fwOverlap / tTokens.size >= 0.25) {
                matchSignals++;
            }
        }
        for (const h of hooks) {
            totalSignals++;
            const hText = (typeof h === "string" ? h : h.type || h.name || "").toLowerCase();
            if (tLower.includes(hText) || hText.includes(tLower.split(/\s+/)[0] || "___")) {
                matchSignals++;
            }
        }
        for (const caption of captions) {
            totalSignals++;
            const cLower = (typeof caption === "string" ? caption : "").toLowerCase();
            let tokenOverlap = 0;
            for (const t of tTokens) {
                if (cLower.includes(t))
                    tokenOverlap++;
            }
            if (tTokens.size > 0 && tokenOverlap / tTokens.size >= 0.25) {
                matchSignals++;
            }
        }
        for (const cta of ctas) {
            totalSignals++;
            const ctaText = (typeof cta === "string" ? cta : cta.pattern || "").toLowerCase();
            if (tTokens.size > 0) {
                let ctaOverlap = 0;
                for (const t of tTokens) {
                    if (ctaText.includes(t))
                        ctaOverlap++;
                }
                if (ctaOverlap / tTokens.size >= 0.3)
                    matchSignals++;
            }
        }
    }
    const semanticRatio = totalSignals > 0 ? matchSignals / totalSignals : 0;
    const floor = Math.min(0.15, competitorCount * POSITIONING_THRESHOLDS.MIN_SATURATION_FLOOR_PER_COMPETITOR);
    return Math.max(floor, Math.min(1.0, semanticRatio));
}
export function checkCrossCampaignDiversity(territories, recentTerritoryNames) {
    const penalties = [];
    for (const territory of territories) {
        const tTokens = new Set(territory.name.toLowerCase().split(/\s+/).filter(Boolean));
        let maxSimilarity = 0;
        for (const recent of recentTerritoryNames) {
            const rTokens = new Set(recent.toLowerCase().split(/\s+/).filter(Boolean));
            let overlap = 0;
            for (const t of tTokens) {
                if (rTokens.has(t))
                    overlap++;
            }
            const union = new Set([...tTokens, ...rTokens]).size;
            const similarity = union > 0 ? overlap / union : 0;
            maxSimilarity = Math.max(maxSimilarity, similarity);
        }
        const penalty = maxSimilarity >= POSITIONING_THRESHOLDS.CROSS_CAMPAIGN_SIMILARITY_THRESHOLD
            ? POSITIONING_THRESHOLDS.CROSS_CAMPAIGN_PENALTY
            : 0;
        penalties.push({ name: territory.name, penalty });
    }
    return penalties;
}
const STRATEGIC_SIGNAL_PATTERNS = [
    { pattern: /\b(automat|autopilot|hands-?free|set.?and.?forget|auto-?\w+)\b/i, signal: "automation_replacing_manual", cluster: "automation" },
    { pattern: /\b(no.?agency|without.?agency|replace.?your.?agency|fire.?your.?agency|diy|in-?house)\b/i, signal: "anti_agency_positioning", cluster: "anti_agency" },
    { pattern: /\b(cut.?costs?|save.?money|reduce.?spend|lower.?cost|affordable|budget|cost.?effective|roi|return.?on)\b/i, signal: "cost_reduction", cluster: "cost_efficiency" },
    { pattern: /\b(efficien|streamlin|optimiz|productiv|lean|eliminat.?waste)\b/i, signal: "operational_efficiency", cluster: "cost_efficiency" },
    { pattern: /\b(fast|speed|quick|rapid|instant|real-?time|minutes.?not.?hours|10x.?faster)\b/i, signal: "execution_speed", cluster: "speed" },
    { pattern: /\b(system|framework|blueprint|playbook|operating.?system|method|process|sop)\b/i, signal: "systemization", cluster: "systematization" },
    { pattern: /\b(authority|expert|thought.?leader|credib|trust|proven|track.?record)\b/i, signal: "authority_driven", cluster: "authority" },
    { pattern: /\b(strategy|strategic|plan|roadmap|position|differentiat)\b/i, signal: "strategy_led", cluster: "strategy" },
    { pattern: /\b(execut|implement|deploy|launch|ship|deliver|done|result)\b/i, signal: "execution_led", cluster: "execution" },
    { pattern: /\b(ai|artificial.?intelligence|machine.?learning|smart|intelligent|predictive|algorithm)\b/i, signal: "ai_powered", cluster: "technology" },
    { pattern: /\b(data|analytic|measur|metric|insight|dashboard|report)\b/i, signal: "data_driven", cluster: "analytics" },
    { pattern: /\b(scale|growth|grow|expand|multiply|leverage|compound)\b/i, signal: "scalability", cluster: "growth" },
    { pattern: /\b(personal|custom|tailor|bespoke|unique|individual|1.?on.?1)\b/i, signal: "personalization", cluster: "customization" },
    { pattern: /\b(communit|tribe|network|ecosystem|collective|peer)\b/i, signal: "community_driven", cluster: "community" },
    { pattern: /\b(transparen|honest|authentic|real|genuine|no.?bs|no.?fluff)\b/i, signal: "transparency_play", cluster: "transparency" },
];
function extractStrategicSignals(miData) {
    const signals = [];
    const seen = new Set();
    const textSources = [];
    const marketState = miData.marketState || "";
    const diagnosis = miData.marketDiagnosis || "";
    const narrative = miData.narrativeSynthesis || "";
    if (marketState)
        textSources.push({ text: marketState, source: "market_intelligence" });
    if (diagnosis)
        textSources.push({ text: diagnosis, source: "market_intelligence" });
    if (narrative)
        textSources.push({ text: narrative, source: "market_intelligence" });
    const contentDna = safeJsonParse(miData.contentDnaData, []);
    for (const entry of contentDna) {
        const hooks = (entry.hookArchetypes || []).map((h) => typeof h === "string" ? h : h.type || h.name || "");
        const frameworks = (entry.narrativeFrameworks || []).map((n) => typeof n === "string" ? n : n.type || n.name || "");
        const captions = entry.topCaptions || entry.sampleCaptions || [];
        const ctas = (entry.ctaPatterns || []).map((c) => typeof c === "string" ? c : c.pattern || "");
        for (const t of [...hooks, ...frameworks, ...captions, ...ctas]) {
            if (t)
                textSources.push({ text: t, source: "competitor_content" });
        }
    }
    const dominanceData = safeJsonParse(miData.dominanceData, []);
    for (const d of dominanceData) {
        if (d.contentThemes)
            textSources.push({ text: JSON.stringify(d.contentThemes), source: "competitor_positioning" });
        if (d.narrativeStyle)
            textSources.push({ text: d.narrativeStyle, source: "competitor_positioning" });
    }
    for (const { text, source } of textSources) {
        for (const { pattern, signal, cluster } of STRATEGIC_SIGNAL_PATTERNS) {
            if (pattern.test(text)) {
                const key = `${signal}:${source}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    signals.push({ signal, cluster, source });
                }
            }
        }
    }
    return signals;
}
function extractAudienceStrategicSignals(audienceData) {
    const signals = [];
    const seen = new Set();
    const pains = safeJsonParse(audienceData.audiencePains, []);
    const desires = safeJsonParse(audienceData.desireMap, []);
    const objections = safeJsonParse(audienceData.objectionMap, []);
    const audienceTexts = [];
    for (const p of pains) {
        if (p.canonical)
            audienceTexts.push(p.canonical);
    }
    for (const d of desires) {
        if (d.canonical)
            audienceTexts.push(d.canonical);
    }
    for (const o of objections) {
        if (o.canonical)
            audienceTexts.push(o.canonical);
    }
    for (const text of audienceTexts) {
        for (const { pattern, signal, cluster } of STRATEGIC_SIGNAL_PATTERNS) {
            if (pattern.test(text)) {
                const key = `${signal}:audience`;
                if (!seen.has(key)) {
                    seen.add(key);
                    signals.push({ signal, cluster, source: "audience_insights" });
                }
            }
        }
    }
    return signals;
}
function validateTerritoryEvidenceDensity(territory, miSignals, audienceSignals) {
    const allSignals = [...miSignals, ...audienceSignals];
    const territoryTokens = new Set(territory.name.toLowerCase().split(/\s+/).filter(t => t.length > 2));
    const evidenceTokens = new Set([...territory.painAlignment, ...territory.desireAlignment, ...territory.evidenceSignals]
        .map(s => s.toLowerCase()));
    const relevantSignals = allSignals.filter(s => {
        const signalTokens = s.signal.replace(/_/g, " ").toLowerCase().split(/\s+/);
        const clusterTokens = s.cluster.replace(/_/g, " ").toLowerCase().split(/\s+/);
        for (const t of territoryTokens) {
            for (const st of [...signalTokens, ...clusterTokens]) {
                if (t.includes(st) || st.includes(t))
                    return true;
            }
        }
        for (const e of evidenceTokens) {
            for (const st of [...signalTokens, ...clusterTokens]) {
                if (e.includes(st) || st.includes(e))
                    return true;
            }
        }
        return false;
    });
    const clusters = new Set(relevantSignals.map(s => s.cluster));
    const uniqueClusterCount = clusters.size;
    const sources = new Set(relevantSignals.map(s => s.source));
    const crossSourceCount = sources.size;
    const evidenceTexts = [...territory.painAlignment, ...territory.desireAlignment, ...territory.evidenceSignals];
    let redundantPairs = 0;
    let totalPairs = 0;
    for (let i = 0; i < evidenceTexts.length; i++) {
        for (let j = i + 1; j < evidenceTexts.length; j++) {
            totalPairs++;
            const a = new Set(evidenceTexts[i].toLowerCase().split(/\s+/).filter(t => t.length > 2));
            const b = new Set(evidenceTexts[j].toLowerCase().split(/\s+/).filter(t => t.length > 2));
            let overlap = 0;
            for (const t of a) {
                if (b.has(t))
                    overlap++;
            }
            const union = new Set([...a, ...b]).size;
            if (union > 0 && overlap / union >= 0.6)
                redundantPairs++;
        }
    }
    const hasRedundancy = totalPairs > 0 && redundantPairs / totalPairs >= 0.5;
    let densityScore = 1.0;
    let confidencePenalty = 0;
    if (uniqueClusterCount < 2) {
        densityScore -= 0.15;
        confidencePenalty += 0.10;
    }
    if (crossSourceCount < 2) {
        densityScore -= 0.10;
        confidencePenalty += 0.08;
    }
    if (hasRedundancy) {
        densityScore -= 0.10;
        confidencePenalty += 0.05;
    }
    return {
        uniqueClusterCount,
        crossSourceCount,
        hasRedundancy,
        densityScore: Math.max(0, densityScore),
        confidencePenalty,
    };
}
export function translateToSystemTerritory(audienceLabel, signalType, productDna) {
    const lower = audienceLabel.toLowerCase().trim();
    const cleanLabel = lower
        .replace(/\([\d\s\w]+\)/g, "")
        .replace(/driven by\s+.*/i, "")
        .replace(/\(recurring audience friction\)/i, "")
        .replace(/buying barrier:\s*/i, "")
        .replace(/awareness state:\s*/i, "")
        .replace(/dominant intent:\s*/i, "")
        .replace(/desired transformation:\s*/i, "")
        .trim();
    const domainNoun = inferDomainNoun(productDna);
    const PAIN_TO_SYSTEM = {
        "cost and affordability concerns": `${domainNoun} pricing-to-value translation gap`,
        "social comparison and pressure": `${domainNoun} competitive differentiation visibility failure`,
        "frustration with lack of results": `${domainNoun} outcome validation process breakdown`,
        "confusion and overwhelm": `${domainNoun} decision workflow complexity bottleneck`,
        "trust and credibility doubts": `${domainNoun} proof-of-credibility pipeline gap`,
        "fear of commitment": `${domainNoun} risk-mitigation framework absence`,
        "lack of support": `${domainNoun} onboarding support structure deficit`,
        "complexity / too hard": `${domainNoun} implementation complexity bottleneck`,
        "too hard": `${domainNoun} implementation complexity bottleneck`,
        "lack of results": `${domainNoun} outcome verification process failure`,
        "cost concerns": `${domainNoun} pricing-to-value translation gap`,
        "affordability": `${domainNoun} pricing-to-value translation gap`,
    };
    const DESIRE_TO_SYSTEM = {
        "community and belonging": `${domainNoun} user retention loop gap`,
        "social recognition / status": `${domainNoun} authority signaling mechanism deficit`,
        "learn skills / knowledge": `${domainNoun} capability transfer process gap`,
        "save time / efficiency": `${domainNoun} workflow automation bottleneck`,
        "financial improvement": `${domainNoun} ROI proof-path breakdown`,
        "belonging / community": `${domainNoun} user retention loop gap`,
        "status / social proof": `${domainNoun} authority signaling mechanism deficit`,
    };
    const PSYCH_TO_SYSTEM = {
        "belonging / community": `${domainNoun} user retention loop gap`,
        "desperation / urgency": `${domainNoun} time-to-value pipeline stall`,
        "status / social proof": `${domainNoun} authority signaling mechanism deficit`,
        "hope / aspiration": `${domainNoun} outcome prediction framework gap`,
        "desire for attractiveness": `${domainNoun} competitive positioning visibility deficit`,
        "comparison-shopping": `${domainNoun} comparison evaluation framework failure`,
        "weak → strong": `${domainNoun} capability transformation validation gap`,
    };
    if (signalType === "pain" || signalType === "root_cause") {
        for (const [key, value] of Object.entries(PAIN_TO_SYSTEM)) {
            if (cleanLabel.includes(key) || lower.includes(key))
                return value;
        }
    }
    if (signalType === "desire") {
        for (const [key, value] of Object.entries(DESIRE_TO_SYSTEM)) {
            if (cleanLabel.includes(key) || lower.includes(key))
                return value;
        }
    }
    if (signalType === "psych_driver") {
        for (const [key, value] of Object.entries(PSYCH_TO_SYSTEM)) {
            if (cleanLabel.includes(key) || lower.includes(key))
                return value;
        }
    }
    for (const [key, value] of Object.entries({ ...PAIN_TO_SYSTEM, ...DESIRE_TO_SYSTEM, ...PSYCH_TO_SYSTEM })) {
        if (cleanLabel.includes(key) || lower.includes(key))
            return value;
    }
    return buildGenericSystemTerritory(cleanLabel, domainNoun, signalType);
}
function inferDomainNoun(productDna) {
    if (!productDna)
        return "operational";
    const offer = (productDna.coreOffer || "").toLowerCase();
    const bType = (productDna.businessType || "").toLowerCase();
    const category = (productDna.productCategory || "").toLowerCase();
    if (/saas|software|platform|app|tool/i.test(bType + " " + offer))
        return "platform";
    if (/market|advertis|campaign|brand/i.test(offer + " " + category))
        return "marketing";
    if (/consult|agency|service|coach|freelanc|advisor/i.test(bType))
        return "service delivery";
    if (/ecommerce|shop|store|retail|product/i.test(bType + " " + offer))
        return "conversion";
    if (/health|fitness|wellness|medical/i.test(offer + " " + category))
        return "care delivery";
    if (/education|course|training|learn/i.test(offer + " " + category))
        return "learning";
    if (/finance|invest|trading|banking/i.test(offer + " " + category))
        return "financial";
    const offerTokens = offer.split(/\s+/).filter(w => w.length > 4);
    if (offerTokens.length > 0)
        return offerTokens[0];
    return "operational";
}
function buildGenericSystemTerritory(cleanLabel, domainNoun, signalType) {
    const FAILURE_SUFFIXES = {
        pain: "process breakdown",
        desire: "mechanism gap",
        root_cause: "structural failure",
        psych_driver: "framework deficit",
    };
    const suffix = FAILURE_SUFFIXES[signalType] || "operational gap";
    const stripped = cleanLabel
        .replace(/concerns?|needs?|desires?|fears?|anxiety|hesitation|worry|belonging|community|affordability|aspiration|motivation|trust|cost|transformation|simplicity|empowerment|wellness|satisfaction|loyalty|emotion|feeling|comfort|desperation|urgency|overwhelm|confusion|skepticism|resistance|status|proof|social|intent|dominant|comparison|shopping|credibility|reputation|influence|perception|awareness|recognition|identity/g, "")
        .replace(/\s+/g, " ")
        .trim();
    if (stripped.length >= 4) {
        return `${domainNoun} ${stripped} ${suffix}`;
    }
    return `${domainNoun} ${suffix}`;
}
function layer7_opportunityGapDetection(narrativeSaturation, audienceData, marketPower, category = "general", narrativeMap = {}, contentDna = [], competitionIntensityScore = 0, productDna) {
    const pains = safeJsonParse(audienceData.audiencePains, []);
    const desires = safeJsonParse(audienceData.desireMap, []);
    const competitorCount = Object.keys(narrativeMap).length || marketPower.length;
    const painTerritories = pains.slice(0, 8).map((p) => ({
        name: translateToSystemTerritory(p.canonical, "pain", productDna),
        demand: Math.min(1.0, p.frequency / 20),
        signals: purifyEvidence(p.evidence || []),
        type: "pain",
    }));
    const desireTerritories = desires.slice(0, 8).map((d) => ({
        name: translateToSystemTerritory(d.canonical, "desire", productDna),
        demand: Math.min(1.0, d.frequency / 20),
        signals: purifyEvidence(d.evidence || []),
        type: "desire",
    }));
    const allTerritories = [...painTerritories, ...desireTerritories];
    const avgCompAuthority = marketPower.length > 0
        ? marketPower.reduce((s, e) => s + e.authorityScore, 0) / marketPower.length
        : 0;
    const opportunities = allTerritories.map(t => {
        const baseSatLevel = narrativeSaturation[t.name.toLowerCase()] || 0;
        const semanticSat = computeSemanticSaturation(t.name, narrativeMap, contentDna, competitorCount);
        const satLevel = Math.max(baseSatLevel, semanticSat);
        const compAuth = avgCompAuthority;
        const specificity = computeSpecificityScore(t.name, category, productDna);
        const intensityPenalty = competitionIntensityScore >= 0.45
            ? Math.min(0.10, competitionIntensityScore * 0.15)
            : 0;
        const opportunityScore = (1 - satLevel) * 0.40 +
            t.demand * 0.35 +
            (1 - compAuth) * 0.15 +
            specificity * 0.10 -
            intensityPenalty;
        return {
            territory: t.name,
            saturationLevel: Math.round(satLevel * 100) / 100,
            audienceDemand: t.demand,
            competitorAuthority: compAuth,
            opportunityScore: Math.round(opportunityScore * 100) / 100,
            painSignals: t.type === "pain" ? t.signals.slice(0, 3) : [],
            desireSignals: t.type === "desire" ? t.signals.slice(0, 3) : [],
        };
    });
    return opportunities
        .filter(o => o.opportunityScore >= POSITIONING_THRESHOLDS.OPPORTUNITY_SCORE_THRESHOLD)
        .sort((a, b) => b.opportunityScore - a.opportunityScore);
}
function layer8_differentiationAxisConstruction(opportunities, trustGaps, flankingMode) {
    const axes = [];
    if (flankingMode) {
        axes.push("niche_expertise");
        axes.push("underserved_audience_focus");
    }
    if (trustGaps.includes("skepticism / doesn't believe it works")) {
        axes.push("proof_and_transparency");
    }
    if (trustGaps.includes("too expensive")) {
        axes.push("value_accessibility");
    }
    if (trustGaps.includes("complexity / too hard")) {
        axes.push("simplicity_and_ease");
    }
    if (trustGaps.includes("no time")) {
        axes.push("speed_and_efficiency");
    }
    const topOpp = opportunities[0];
    if (topOpp) {
        if (topOpp.saturationLevel < 0.3)
            axes.push("whitespace_positioning");
        if (topOpp.audienceDemand > 0.7)
            axes.push("demand_driven_authority");
    }
    return [...new Set(axes)].slice(0, 5);
}
function layer9_narrativeDistanceScoring(territory, narrativeMap) {
    const territoryLower = territory.toLowerCase();
    const territoryTokens = new Set(territoryLower.split(/\s+/).filter(t => t.length > 2));
    let minDistance = 1.0;
    let maxKeywordOverlap = 0;
    for (const narratives of Object.values(narrativeMap)) {
        for (const n of narratives) {
            const nLower = n.toLowerCase();
            const nTokens = new Set(nLower.split(/\s+/).filter(t => t.length > 2));
            let exactOverlap = 0;
            let substringOverlap = 0;
            for (const t of territoryTokens) {
                if (nTokens.has(t)) {
                    exactOverlap++;
                }
                else {
                    for (const nt of nTokens) {
                        if (t.length >= 4 && nt.length >= 4 && (t.includes(nt) || nt.includes(t))) {
                            substringOverlap++;
                            break;
                        }
                    }
                }
            }
            const totalOverlap = exactOverlap + substringOverlap * 0.7;
            const union = new Set([...territoryTokens, ...nTokens]).size;
            const similarity = union > 0 ? totalOverlap / union : 0;
            const distance = 1 - similarity;
            if (distance < minDistance)
                minDistance = distance;
            const keywordOverlap = territoryTokens.size > 0 ? totalOverlap / territoryTokens.size : 0;
            maxKeywordOverlap = Math.max(maxKeywordOverlap, keywordOverlap);
        }
    }
    if (maxKeywordOverlap > POSITIONING_THRESHOLDS.KEYWORD_OVERLAP_DISTANCE_CAP_THRESHOLD) {
        minDistance = Math.min(minDistance, POSITIONING_THRESHOLDS.NARRATIVE_DISTANCE_MAX_WITH_OVERLAP);
    }
    return Math.round(minDistance * 100) / 100;
}
export function filterAudienceTerritories(territories) {
    const SYSTEM_NOUNS = ["system", "tool", "platform", "pipeline", "process", "framework", "engine", "workflow", "protocol", "method", "mechanism", "infrastructure", "stack", "architecture", "module", "layer", "approach", "model", "structure", "integration", "validation", "verification", "audit", "funnel", "loop", "sequence", "automation", "flow", "conversion", "setup", "configuration", "deployment", "routing", "indexing", "tracking", "onboarding", "orchestration", "segmentation", "scoring", "mapping"];
    const FAILURE_VERBS = ["fails", "breaks", "lacks", "missing", "blocks", "prevents", "collapses", "stalls", "erodes", "undermines", "fragments", "disconnects", "inability", "absence", "breakdown", "failure", "deficit", "gap", "blind spot", "bottleneck", "weak", "broken", "degraded", "inefficient", "unreliable", "inconsistent", "misaligned"];
    const AUDIENCE_ONLY = ["concerns", "needs", "desires", "fears", "anxiety", "hesitation", "worry", "belonging", "community", "affordability", "aspiration", "motivation", "trust", "cost", "transformation", "simplicity", "empowerment", "wellness", "satisfaction", "loyalty", "emotion", "feeling", "comfort", "happiness", "frustration", "anger", "relief", "hope", "excitement", "desperation", "urgency", "overwhelm", "confusion", "skepticism", "resistance", "apathy", "indifference", "curiosity", "longing", "insecurity", "vulnerability", "pressure", "stress", "burnout", "fatigue", "exhaustion", "isolation", "loneliness", "envy", "jealousy", "shame", "guilt", "regret", "pride", "ambition", "desire", "need", "fear", "pain", "struggle", "suffering", "status", "proof", "social", "intent", "dominant", "comparison", "shopping", "credibility", "reputation", "influence", "perception", "awareness", "recognition", "identity", "self"];
    const systemLevel = [];
    const rejected = [];
    for (const t of territories) {
        const nameTokens = t.name.toLowerCase().replace(/[^a-z0-9\s/,→←]/g, "").split(/[\s/,→←]+/).filter(Boolean);
        const hasSystemNoun = SYSTEM_NOUNS.some(n => nameTokens.some(tok => tok === n || tok.endsWith(n)));
        const hasFailureVerb = FAILURE_VERBS.some(f => nameTokens.some(tok => tok === f || tok.startsWith(f)));
        const audienceTokenCount = AUDIENCE_ONLY.filter(a => nameTokens.some(tok => tok === a)).length;
        const nonStopTokens = nameTokens.filter(tok => tok.length > 3 && !["and", "the", "for", "with", "from", "that", "this", "driven", "based", "desired", "strong", "high", "low"].includes(tok));
        const audienceRatio = nonStopTokens.length > 0 ? audienceTokenCount / nonStopTokens.length : 0;
        const isDataLabel = /\(\d+\s+\w+/.test(t.name) || /\d+\s+signals/.test(t.name.toLowerCase());
        const isSystemLevel = !isDataLabel && (hasSystemNoun || (hasFailureVerb && audienceRatio < 0.5));
        const isPureAudience = isDataLabel || (!hasSystemNoun && audienceRatio >= 0.5);
        if (isPureAudience) {
            rejected.push(t);
        }
        else {
            systemLevel.push(t);
        }
    }
    return { systemLevel, rejected };
}
function layer10_strategicTerritorySelection(opportunities, narrativeMap, narrativeSaturation, marketPower, differentiationAxes, segmentPriority, trustGaps, flankingMode) {
    const topSegments = segmentPriority.slice(0, 2);
    const rawTerritories = opportunities.slice(0, 8).map(opp => {
        const narrativeDistance = layer9_narrativeDistanceScoring(opp.territory, narrativeMap);
        const painAlignment = opp.painSignals.length > 0 ? opp.painSignals : [];
        const desireAlignment = opp.desireSignals.length > 0 ? opp.desireSignals : [];
        let enemyDefinition = "The status quo";
        if (opp.saturationLevel > 0.5) {
            enemyDefinition = "Oversaturated generic advice";
        }
        else if (flankingMode) {
            enemyDefinition = "Dominant players who ignore underserved audiences";
        }
        let contrastAxis = differentiationAxes[0] || "unique_approach";
        let narrativeDirection = `Position around ${opp.territory} with ${contrastAxis} differentiation`;
        return {
            name: opp.territory,
            opportunityScore: opp.opportunityScore,
            narrativeDistanceScore: narrativeDistance,
            painAlignment,
            desireAlignment,
            enemyDefinition,
            contrastAxis,
            narrativeDirection,
            isStable: true,
            stabilityNotes: [],
            evidenceSignals: [...opp.painSignals, ...opp.desireSignals].slice(0, 5),
            confidenceScore: Math.round(opp.opportunityScore * narrativeDistance * 100) / 100,
        };
    });
    const deduped = deduplicateTerritories(rawTerritories);
    const filtered = deduped.filter(t => {
        const sat = narrativeSaturation[t.name.toLowerCase()] || 0;
        if (sat >= POSITIONING_THRESHOLDS.DOMINANT_COMPETITOR_THRESHOLD)
            return false;
        return true;
    });
    const { systemLevel, rejected } = filterAudienceTerritories(filtered);
    if (rejected.length > 0) {
        console.log(`[PositioningEngine] TERRITORY_FILTER: Rejected ${rejected.length} audience-level territories: ${rejected.map(r => `"${r.name}"`).join(", ")}`);
    }
    const territoriesToSort = systemLevel.length > 0 ? systemLevel : filtered;
    if (systemLevel.length === 0 && filtered.length > 0) {
        console.log(`[PositioningEngine] TERRITORY_FILTER: FALLBACK — all ${filtered.length} territories were audience-level, using best available candidates`);
    }
    const sorted = territoriesToSort.sort((a, b) => b.opportunityScore - a.opportunityScore);
    const compressed = compressTerritories(sorted);
    if (compressed.length > POSITIONING_THRESHOLDS.MAX_TERRITORIES) {
        return compressed.slice(0, POSITIONING_THRESHOLDS.MAX_TERRITORIES);
    }
    return compressed;
}
export function compressTerritories(sorted) {
    if (sorted.length <= 1)
        return sorted;
    const primary = sorted[0];
    const result = [primary];
    for (let i = 1; i < sorted.length; i++) {
        const candidate = sorted[i];
        const primaryTokens = new Set(primary.name.toLowerCase().split(/\s+/));
        const candidateTokens = candidate.name.toLowerCase().split(/\s+/);
        const overlap = candidateTokens.filter(t => primaryTokens.has(t)).length;
        const similarity = candidateTokens.length > 0 ? overlap / Math.max(primaryTokens.size, candidateTokens.length) : 0;
        if (similarity >= 0.60) {
            const mergedPains = [...new Set([...primary.painAlignment, ...candidate.painAlignment])];
            const mergedDesires = [...new Set([...primary.desireAlignment, ...candidate.desireAlignment])];
            const mergedEvidence = [...new Set([...primary.evidenceSignals, ...candidate.evidenceSignals])].slice(0, 8);
            primary.painAlignment = mergedPains;
            primary.desireAlignment = mergedDesires;
            primary.evidenceSignals = mergedEvidence;
            primary.stabilityNotes.push(`[COMPRESSION] Absorbed similar territory: "${candidate.name}" (similarity: ${(similarity * 100).toFixed(0)}%)`);
            primary.opportunityScore = Math.max(primary.opportunityScore, candidate.opportunityScore);
            console.log(`[PositioningEngine] COMPRESSION: Merged "${candidate.name}" into primary "${primary.name}" (overlap: ${(similarity * 100).toFixed(0)}%)`);
        }
        else if (result.length < POSITIONING_THRESHOLDS.MAX_TERRITORIES) {
            result.push(candidate);
        }
    }
    console.log(`[PositioningEngine] COMPRESSION: ${sorted.length} territories → ${result.length} (primary: "${result[0].name}")`);
    return result;
}
function deduplicateTerritories(territories) {
    const result = [];
    for (const t of territories) {
        let isDuplicate = false;
        for (const existing of result) {
            const tokens1 = new Set(t.name.toLowerCase().split(/\s+/));
            const tokens2 = new Set(existing.name.toLowerCase().split(/\s+/));
            let overlap = 0;
            for (const tok of tokens1) {
                if (tokens2.has(tok))
                    overlap++;
            }
            const union = new Set([...tokens1, ...tokens2]).size;
            if (union > 0 && overlap / union >= POSITIONING_THRESHOLDS.TERRITORY_OVERLAP_THRESHOLD) {
                isDuplicate = true;
                if (t.opportunityScore > existing.opportunityScore) {
                    Object.assign(existing, t);
                }
                break;
            }
        }
        if (!isDuplicate) {
            result.push({ ...t });
        }
    }
    return result;
}
function formatStructuredSignalsForPrompt(signals) {
    const formatClusters = (clusters, label) => {
        if (clusters.length === 0)
            return "";
        const lines = clusters.map((c, i) => `  ${i + 1}. [${c.id}] "${c.label}" (freq=${c.frequency}, conf=${c.confidence.toFixed(2)}, layer=${c.sourceLayer})`);
        return `\n${label}:\n${lines.join("\n")}`;
    };
    return [
        formatClusters(signals.pain_clusters, "PAIN CLUSTERS"),
        formatClusters(signals.desire_clusters, "DESIRE CLUSTERS"),
        formatClusters(signals.pattern_clusters, "PATTERN CLUSTERS"),
        formatClusters(signals.root_causes, "ROOT CAUSES"),
        formatClusters(signals.psychological_drivers, "PSYCHOLOGICAL DRIVERS"),
    ].filter(Boolean).join("\n");
}
function getAllSignalLabels(signals) {
    return [
        ...signals.pain_clusters,
        ...signals.desire_clusters,
        ...signals.pattern_clusters,
        ...signals.root_causes,
        ...signals.psychological_drivers,
    ].map(c => c.label.toLowerCase());
}
function mapSignalsToTerritories(territories, signals) {
    const allClusters = [
        ...signals.pain_clusters.map(c => ({ id: c.id, label: c.label, category: "pain", frequency: c.frequency, confidence: c.confidence })),
        ...signals.desire_clusters.map(c => ({ id: c.id, label: c.label, category: "desire", frequency: c.frequency, confidence: c.confidence })),
        ...signals.pattern_clusters.map(c => ({ id: c.id, label: c.label, category: "pattern", frequency: c.frequency, confidence: c.confidence })),
        ...signals.root_causes.map(c => ({ id: c.id, label: c.label, category: "root_cause", frequency: c.frequency, confidence: c.confidence })),
        ...signals.psychological_drivers.map(c => ({ id: c.id, label: c.label, category: "psychological_driver", frequency: c.frequency, confidence: c.confidence })),
    ];
    const mapping = new Map();
    for (let tIdx = 0; tIdx < territories.length; tIdx++) {
        const t = territories[tIdx];
        const tName = t.name.toLowerCase();
        const tWords = new Set(tName.split(/\s+/).filter(w => w.length > 3));
        const painWords = new Set(t.painAlignment.flatMap(p => p.toLowerCase().split(/\s+/).filter(w => w.length > 3)));
        const desireWords = new Set(t.desireAlignment.flatMap(d => d.toLowerCase().split(/\s+/).filter(w => w.length > 3)));
        const allTerritoryWords = new Set([...tWords, ...painWords, ...desireWords]);
        const scored = [];
        for (const cluster of allClusters) {
            const clusterWords = cluster.label.toLowerCase().split(/\s+/).filter(w => w.length > 3);
            if (clusterWords.length === 0)
                continue;
            let matchCount = 0;
            for (const cw of clusterWords) {
                if (tName.includes(cw)) {
                    matchCount += 2;
                    continue;
                }
                for (const tw of allTerritoryWords) {
                    if (tw.includes(cw) || cw.includes(tw)) {
                        matchCount += 1;
                        break;
                    }
                }
            }
            if (matchCount > 0) {
                scored.push({ cluster, score: matchCount / clusterWords.length });
            }
        }
        scored.sort((a, b) => b.score - a.score);
        const mapped = scored
            .filter(s => s.score >= 0.3)
            .slice(0, 6)
            .map(s => s.cluster);
        if (mapped.length === 0 && allClusters.length > 0) {
            const topByFreq = [...allClusters].sort((a, b) => b.frequency - a.frequency).slice(0, 3);
            mapping.set(tIdx, topByFreq);
        }
        else {
            mapping.set(tIdx, mapped);
        }
    }
    return mapping;
}
function formatMappedSignalsForTerritory(mapped) {
    if (mapped.length === 0)
        return "  (no signals mapped)";
    return mapped.map(m => `  - [${m.id}] "${m.label}" (${m.category}, freq=${m.frequency}, conf=${m.confidence.toFixed(2)})`).join("\n");
}
async function layer11_positioningStatementGeneration(territories, category, segmentPriority, accountId, miData, productDna, analyticalEnrichment, structuredSignals, specificityRejectionContext) {
    if (territories.length === 0)
        return territories;
    try {
        const topSegment = segmentPriority[0]?.segment || "target audience";
        let websitePositioningContext = "";
        const multiSourceData = safeJsonParse(miData.multiSourceSignals, {});
        if (multiSourceData && typeof multiSourceData === "object") {
            const headlines = [];
            const positioning = [];
            for (const compData of Object.values(multiSourceData)) {
                if (compData?.website) {
                    for (const h of (compData.website.headlineExtractions || []).slice(0, 3)) {
                        if (typeof h === "string" && h.trim())
                            headlines.push(h);
                    }
                    for (const p of (compData.website.positioningLanguage || []).slice(0, 3)) {
                        if (typeof p === "string" && p.trim())
                            positioning.push(p);
                    }
                }
            }
            if (headlines.length > 0 || positioning.length > 0) {
                websitePositioningContext = `\n\nWEBSITE INTELLIGENCE (competitor positioning from their websites):`;
                if (headlines.length > 0)
                    websitePositioningContext += `\nCompetitor Headlines: ${JSON.stringify(headlines.slice(0, 8))}`;
                if (positioning.length > 0)
                    websitePositioningContext += `\nCompetitor Positioning Language: ${JSON.stringify(positioning.slice(0, 8))}`;
                websitePositioningContext += `\nUse this to identify gaps and differentiation opportunities. Position AGAINST these competitor claims.`;
            }
        }
        const productDnaBlock = productDna ? formatProductDNAForPrompt(productDna) : "";
        const aelBlock = formatAELForPrompt(analyticalEnrichment || null);
        const causalDirective = buildCausalDirectiveForPrompt(analyticalEnrichment || null);
        if (aelBlock)
            console.log(`[PositioningEngine-V3] AEL_INJECTED | enrichmentSize=${aelBlock.length}chars | causalDirective=${causalDirective.length}chars`);
        const hasSignals = structuredSignals && getAllSignalLabels(structuredSignals).length > 0;
        const signalMapping = hasSignals ? mapSignalsToTerritories(territories, structuredSignals) : null;
        if (signalMapping) {
            const totalMapped = Array.from(signalMapping.values()).reduce((s, arr) => s + arr.length, 0);
            console.log(`[PositioningEngine-V3] SIGNAL_DIRECT_MODE | pre-mapped ${totalMapped} signals across ${territories.length} territories`);
        }
        const allSignalIds = hasSignals ? new Set([
            ...structuredSignals.pain_clusters,
            ...structuredSignals.desire_clusters,
            ...structuredSignals.pattern_clusters,
            ...structuredSignals.root_causes,
            ...structuredSignals.psychological_drivers,
        ].map(c => c.id)) : null;
        const territoriesBlock = territories.map((t, i) => {
            const mapped = signalMapping?.get(i) || [];
            const signalSection = mapped.length > 0
                ? `\n   SOURCE SIGNALS (compose your output FROM these):\n${formatMappedSignalsForTerritory(mapped)}`
                : "";
            return `${i + 1}. "${t.name}" (opportunity: ${t.opportunityScore}, distance: ${t.narrativeDistanceScore})
   Pain alignment: ${t.painAlignment.join(", ") || "general"}
   Desire alignment: ${t.desireAlignment.join(", ") || "general"}${signalSection}`;
        }).join("\n\n");
        const domainTranslationInstruction = productDna ? `
DOMAIN TRANSLATION REQUIREMENT (apply before composing any field):
This campaign is for a "${productDna.businessType}" offering "${productDna.coreOffer}".${productDna.coreProblemSolved ? ` Core problem it solves: "${productDna.coreProblemSolved}".` : ""}${productDna.uniqueMechanism ? ` Unique mechanism: "${productDna.uniqueMechanism}".` : ""}

Before composing enemyDefinition, contrastAxis, and narrativeDirection — restate each signal label as an operational failure SPECIFIC to this business type and offer. Do NOT use the surface label (e.g. "cost and affordability concerns") in your output. Instead write what that signal means as a concrete operational breakdown for a buyer of "${productDna.coreOffer}" from a "${productDna.businessType}".

Also return three additional fields per territory:
- domainFailure: the operational/system failure in this specific domain that the signal represents
- operationalProblem: what concretely breaks in the buyer's workflow or decision process because of this failure
- proofRequirement: what type of evidence would resolve the enemy claim (e.g. "live demo", "case study with metrics", "transparent pricing breakdown", "third-party audit")
` : "";
        const rejectionBlock = specificityRejectionContext ? `\n${specificityRejectionContext}\n` : "";
        const prompt = hasSignals
            ? `You are a strategic positioning COMPOSER. You build positioning statements by DIRECTLY COMPOSING from the provided audience signal clusters — not by generating freely.

MARKET CATEGORY: ${category}
PRIMARY AUDIENCE SEGMENT: ${topSegment}
${productDnaBlock ? `\n${productDnaBlock}\n` : ""}${aelBlock}${causalDirective}${domainTranslationInstruction}
TERRITORIES WITH THEIR SOURCE SIGNALS:
${territoriesBlock}
${websitePositioningContext}
${rejectionBlock}
RULES:
1. DOMAIN TRANSLATION FIRST: Before composing any field, restate each signal label as the operational failure it represents for this specific business type and offer. Use that operational language — not the surface signal label — in every field you write.
2. COMPRESSION: Focus on the FIRST territory as the PRIMARY positioning. Express it as a specific root-cause SYSTEM FAILURE — not an emotional category. The enemyDefinition must name what specific process, system, or operational component breaks for the buyer. If the territory is broad (e.g. "cost concerns" or "trust issues"), compress it into the ONE operational failure that causes it.
3. enemyDefinition: Compose from the PAIN and ROOT_CAUSE signals mapped to this territory. Translate them into the domain-specific operational failure. Name what specifically fails in this market for this type of buyer. Must contain a system-level noun (tool, system, process, pipeline, framework, workflow, platform, method) and a failure verb (fails, breaks, lacks, blocks, collapses, erodes, stalls).
4. contrastAxis: Compose from the DESIRE and PATTERN signals. Name what the buyer wants operationally vs what currently breaks — in terms specific to this business type.
5. narrativeDirection: Synthesize across all mapped signals into one positioning sentence that uses domain-operational language. No surface emotional labels. No broad categories — name the specific operational breakdown and its resolution.
6. mappedSignalIds: List the exact signal IDs you used from the SOURCE SIGNALS.
7. Do NOT invent concepts outside the provided signals. Every word of substance must trace to a signal label.
8. If a territory has no usable signals, set narrativeDirection to "UNMAPPED".

Return a JSON array:
[{ "index": 1, "enemyDefinition": "...", "contrastAxis": "...", "narrativeDirection": "...", "mappedSignalIds": ["id1", "id2"], "domainFailure": "...", "operationalProblem": "...", "proofRequirement": "..." }]

Return ONLY the JSON array.`
            : `You are a strategic positioning analyst. Generate precise positioning statements for each territory.

MARKET CATEGORY: ${category}
PRIMARY AUDIENCE SEGMENT: ${topSegment}
${productDnaBlock ? `\n${productDnaBlock}\n` : ""}${aelBlock}${causalDirective}${domainTranslationInstruction}
TERRITORIES:
${territoriesBlock}
${websitePositioningContext}
${rejectionBlock}
RULES:
1. DOMAIN TRANSLATION FIRST: Before composing any field, restate each territory name as the operational failure it represents for this specific business type and offer. Use domain-operational language — not generic emotional framing — in every field.
2. COMPRESSION: Focus on the FIRST territory as the PRIMARY positioning. Express it as a specific root-cause SYSTEM FAILURE — not an emotional category. If the territory is broad, compress it into the ONE operational failure that causes it.
3. enemyDefinition: Name the specific operational/system failure in this market for this type of buyer. Not emotions — operational breakdown. Must include a system-level noun (tool, system, process, pipeline, framework, workflow, platform, method) and a failure verb (fails, breaks, lacks, blocks, collapses, erodes, stalls).
4. contrastAxis: Name what operationally the buyer gains vs what currently fails — specific to this business domain.
5. narrativeDirection: One sentence using domain-operational language. No surface emotional labels. No broad categories — name the specific operational breakdown and its resolution.

For each territory, return a JSON array with objects containing:
{ "index": number, "enemyDefinition": "precise enemy statement", "narrativeDirection": "one-sentence positioning narrative", "contrastAxis": "clear contrast axis", "domainFailure": "...", "operationalProblem": "...", "proofRequirement": "..." }

Keep statements concise, strategic, and domain-grounded. Return ONLY the JSON array.`;
        const response = await aiChat({
            model: "gpt-4.1-mini",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.2,
            max_tokens: 1500,
            endpoint: "positioning-engine-v3-statements",
            accountId,
        });
        const content = response.choices[0]?.message?.content?.trim() || "[]";
        const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        const parsed = JSON.parse(cleaned);
        for (const item of parsed) {
            const idx = (item.index || 1) - 1;
            if (idx >= 0 && idx < territories.length) {
                if (item.narrativeDirection && typeof item.narrativeDirection === "string" && item.narrativeDirection.includes("UNMAPPED")) {
                    territories[idx].confidenceScore = Math.max(0, territories[idx].confidenceScore - 0.15);
                    territories[idx].stabilityNotes.push("[SIGNAL_UNMAPPED] Territory could not be grounded in audience signals");
                    console.log(`[PositioningEngine-V3] L11 UNMAPPED territory: "${territories[idx].name}"`);
                    continue;
                }
                if (item.enemyDefinition && validateNarrativeOutput(item.enemyDefinition).valid) {
                    territories[idx].enemyDefinition = item.enemyDefinition;
                }
                if (item.narrativeDirection && validateNarrativeOutput(item.narrativeDirection).valid) {
                    territories[idx].narrativeDirection = item.narrativeDirection;
                }
                if (item.contrastAxis && validateNarrativeOutput(item.contrastAxis).valid) {
                    territories[idx].contrastAxis = item.contrastAxis;
                }
                if (item.domainFailure && typeof item.domainFailure === "string" && item.domainFailure.trim()) {
                    territories[idx].domainFailure = item.domainFailure.trim();
                }
                if (item.operationalProblem && typeof item.operationalProblem === "string" && item.operationalProblem.trim()) {
                    territories[idx].operationalProblem = item.operationalProblem.trim();
                }
                if (item.proofRequirement && typeof item.proofRequirement === "string" && item.proofRequirement.trim()) {
                    territories[idx].proofRequirement = item.proofRequirement.trim();
                }
                if (hasSignals && Array.isArray(item.mappedSignalIds) && allSignalIds) {
                    const preMapped = signalMapping?.get(idx) || [];
                    const preMappedIds = new Set(preMapped.map(m => m.id));
                    const validIds = item.mappedSignalIds.filter((id) => allSignalIds.has(id));
                    const groundedIds = validIds.filter((id) => preMappedIds.has(id));
                    const extraIds = validIds.filter((id) => !preMappedIds.has(id));
                    territories[idx].mappedSignalIds = validIds;
                    if (groundedIds.length > 0) {
                        territories[idx].stabilityNotes.push(`[SIGNAL_COMPOSED] Built from ${groundedIds.length} source signal(s): ${groundedIds.join(", ")}`);
                    }
                    if (extraIds.length > 0) {
                        territories[idx].stabilityNotes.push(`[SIGNAL_EXTRA] ${extraIds.length} signal(s) outside pre-mapped set: ${extraIds.join(", ")}`);
                    }
                    if (validIds.length === 0) {
                        territories[idx].stabilityNotes.push("[SIGNAL_WEAK] No valid signal IDs returned — composition may not be grounded");
                        territories[idx].confidenceScore = Math.max(0, territories[idx].confidenceScore - 0.10);
                    }
                }
            }
        }
    }
    catch (err) {
        console.error("[PositioningEngine-V3] Statement generation failed:", err.message);
    }
    for (const t of territories) {
        const compressionScore = evaluateCompressionQuality(t);
        if (compressionScore < 0.50) {
            const penalty = Math.min(0.20, (0.50 - compressionScore) * 0.40);
            t.confidenceScore = Math.max(0, t.confidenceScore - penalty);
            t.stabilityNotes.push(`[COMPRESSION_WEAK] Compression quality: ${(compressionScore * 100).toFixed(0)}% — territory may be too broad (penalty: -${(penalty * 100).toFixed(0)}%)`);
            console.log(`[PositioningEngine] COMPRESSION_QUALITY: "${t.name}" scored ${(compressionScore * 100).toFixed(0)}% — penalty applied: -${(penalty * 100).toFixed(0)}%`);
        }
    }
    return territories;
}
export function evaluateCompressionQuality(territory) {
    let score = 0.50;
    const SYSTEM_NOUNS = ["system", "tool", "platform", "pipeline", "process", "framework", "engine", "workflow", "protocol", "method", "mechanism", "infrastructure", "approach", "model", "structure"];
    const FAILURE_VERBS = ["fails", "breaks", "lacks", "missing", "blocks", "prevents", "collapses", "stalls", "erodes", "undermines", "fragments", "disconnects", "inability", "absence", "breakdown", "failure", "deficit", "gap"];
    const enemy = (territory.enemyDefinition || "").toLowerCase();
    const narrative = (territory.narrativeDirection || "").toLowerCase();
    const domainFail = (territory.domainFailure || "").toLowerCase();
    const combined = `${enemy} ${narrative} ${domainFail}`;
    const hasSystemNoun = SYSTEM_NOUNS.some(n => combined.includes(n));
    const hasFailureVerb = FAILURE_VERBS.some(v => combined.includes(v));
    if (hasSystemNoun)
        score += 0.20;
    if (hasFailureVerb)
        score += 0.15;
    if (territory.domainFailure && territory.domainFailure.trim().length > 10)
        score += 0.10;
    if (territory.operationalProblem && territory.operationalProblem.trim().length > 10)
        score += 0.05;
    const BROAD_MARKERS = ["cost concerns", "trust issues", "affordability", "belonging needs", "community needs", "emotional connection", "personal growth"];
    const broadCount = BROAD_MARKERS.filter(m => combined.includes(m)).length;
    if (broadCount >= 2)
        score -= 0.15;
    const AUDIENCE_NAME_MARKERS = ["concerns", "needs", "desires", "fears", "belonging", "community", "affordability", "trust", "cost", "transformation", "simplicity", "wellness"];
    const nameTokens = territory.name.toLowerCase().split(/\s+/);
    const nameAudienceHits = AUDIENCE_NAME_MARKERS.filter(m => nameTokens.some(t => t === m)).length;
    const nameHasSystem = SYSTEM_NOUNS.some(n => nameTokens.some(t => t === n));
    if (nameAudienceHits >= 1 && !nameHasSystem)
        score -= 0.20;
    if (nameAudienceHits >= 2)
        score -= 0.10;
    const CROSS_DOMAIN_GENERIC_PHRASES = [
        "value delivery system fails", "support system lacks", "onboarding process breaks",
        "communication framework fails", "customer experience breaks", "service delivery fails",
        "feedback system lacks", "retention process breaks", "engagement system fails",
        "conversion pipeline stalls", "acquisition process fails", "growth system stalls",
        "pricing model fails", "billing system breaks", "payment process lacks",
        "reporting system lacks", "analytics pipeline fails", "tracking system breaks",
        "collaboration platform fails", "team workflow breaks", "management system lacks",
    ];
    const DOMAIN_ANCHOR_NOUNS = [
        "lead", "campaign", "funnel", "ad", "seo", "keyword", "cpc", "cpa", "roas",
        "listing", "property", "mortgage", "escrow", "appraisal",
        "workout", "nutrition", "rep", "set", "calorie", "macro",
        "patient", "diagnosis", "treatment", "prescription", "clinical",
        "invoice", "ledger", "reconciliation", "payroll", "tax",
        "shipment", "inventory", "warehouse", "logistics", "fulfillment",
        "curriculum", "enrollment", "lesson", "course", "student",
        "compliance", "regulation", "audit", "filing", "contract",
        "recipe", "menu", "reservation", "kitchen", "ingredient",
        "portfolio", "equity", "dividend", "ticker", "hedge",
        "subscriber", "churn", "mrr", "arr", "saas",
        "tenant", "deployment", "ci/cd", "devops", "microservice",
        "competitor", "market intelligence", "audience", "positioning",
    ];
    const genericHit = CROSS_DOMAIN_GENERIC_PHRASES.some(p => combined.includes(p));
    const hasDomainAnchor = DOMAIN_ANCHOR_NOUNS.some(n => combined.includes(n));
    if (hasSystemNoun && hasFailureVerb && !hasDomainAnchor) {
        score -= 0.18;
        console.log(`[COMPRESSION_QUALITY] FALSE_SPECIFICITY: system+failure vocabulary present but no domain anchor detected`);
    }
    else if (genericHit && !hasDomainAnchor) {
        score -= 0.12;
        console.log(`[COMPRESSION_QUALITY] CROSS_DOMAIN_GENERIC: matched generic phrase without domain anchor`);
    }
    return Math.max(0, Math.min(1, score));
}
function layer12_stabilityGuard(territories, narrativeSaturation, marketPower, segmentPriority, narrativeMap, competitorCount = 0, signalCount = 0) {
    const checks = [];
    const advisories = [];
    let fallbackApplied = false;
    let fallbackReason;
    const topComp = marketPower[0];
    const hasDominantCompetitor = topComp && topComp.authorityScore >= POSITIONING_THRESHOLDS.DOMINANT_COMPETITOR_THRESHOLD;
    if (hasDominantCompetitor) {
        advisories.push({
            type: "dominant_competitor",
            message: `Dominant competitor detected (${topComp.competitorName}, authority: ${(topComp.authorityScore * 100).toFixed(0)}%) — stronger differentiation strategy required`,
            competitorName: topComp.competitorName,
            authorityScore: topComp.authorityScore,
        });
        advisories.push({
            type: "flanking_recommended",
            message: `Flanking or niche positioning recommended to differentiate against ${topComp.competitorName}`,
            competitorName: topComp.competitorName,
        });
    }
    const sufficientMarketData = competitorCount >= 8 && signalCount >= 6;
    for (const territory of territories) {
        const territoryChecks = [];
        const sat = narrativeSaturation[territory.name.toLowerCase()] || 0;
        const satPassed = sat < POSITIONING_THRESHOLDS.STABILITY_SATURATION_LIMIT;
        territoryChecks.push({
            passed: satPassed,
            reason: satPassed
                ? `Saturation ${(sat * 100).toFixed(0)}% below limit`
                : `Saturation ${(sat * 100).toFixed(0)}% exceeds ${POSITIONING_THRESHOLDS.STABILITY_SATURATION_LIMIT * 100}% limit`,
        });
        checks.push({
            name: territory.name,
            passed: true,
            detail: hasDominantCompetitor
                ? `Dominant competitor ${topComp.competitorName} (authority: ${(topComp.authorityScore * 100).toFixed(0)}%) — differentiation strategy recommended`
                : "No dominant competitor blocking territory",
        });
        const topSegment = segmentPriority[0];
        const painPassed = !topSegment || topSegment.painAlignment >= POSITIONING_THRESHOLDS.MIN_PAIN_ALIGNMENT;
        territoryChecks.push({
            passed: painPassed,
            reason: painPassed
                ? "Audience pain alignment sufficient"
                : `Pain alignment ${topSegment?.painAlignment} below minimum ${POSITIONING_THRESHOLDS.MIN_PAIN_ALIGNMENT}`,
        });
        if (narrativeMap) {
            const narrativeDistance = layer9_narrativeDistanceScoring(territory.name, narrativeMap);
            const collisionPassed = narrativeDistance >= POSITIONING_THRESHOLDS.NARRATIVE_COLLISION_MIN_DISTANCE;
            territoryChecks.push({
                passed: collisionPassed,
                reason: collisionPassed
                    ? `Narrative distance ${(narrativeDistance * 100).toFixed(0)}% — sufficiently differentiated`
                    : `Narrative distance ${(narrativeDistance * 100).toFixed(0)}% below ${POSITIONING_THRESHOLDS.NARRATIVE_COLLISION_MIN_DISTANCE * 100}% — pseudo-differentiation risk`,
            });
        }
        const allPassed = territoryChecks.every(c => c.passed);
        territory.isStable = allPassed;
        territory.stabilityNotes = territoryChecks.filter(c => !c.passed).map(c => c.reason);
        if (hasDominantCompetitor && allPassed) {
            territory.stabilityNotes.push(`ADVISORY: Dominant competitor ${topComp.competitorName} — niche or differentiation angle required`);
        }
        if (sufficientMarketData && !allPassed) {
            const failCount = territoryChecks.filter(c => !c.passed).length;
            if (failCount === 1) {
                territory.isStable = true;
                territory.stabilityNotes.push("CONFIDENCE_BOOST: Sufficient market data (≥8 competitors, ≥6 signals) — single-check failure overridden");
            }
        }
        for (const check of territoryChecks) {
            checks.push({
                name: territory.name,
                passed: check.passed,
                detail: check.reason,
            });
        }
    }
    const stableTerritories = territories.filter(t => t.isStable);
    const unstableTerritories = territories.filter(t => !t.isStable);
    if (stableTerritories.length === 0 && territories.length > 0) {
        fallbackApplied = true;
        fallbackReason = "All territories failed stability checks — using best available with warning";
        const best = territories.sort((a, b) => b.opportunityScore - a.opportunityScore)[0];
        best.stabilityNotes.push("FALLBACK: Selected despite stability concerns due to no better alternatives");
        stableTerritories.push(best);
    }
    const finalTerritories = [...stableTerritories, ...unstableTerritories.slice(0, POSITIONING_THRESHOLDS.MAX_TERRITORIES - stableTerritories.length)];
    return {
        territories: finalTerritories,
        stabilityResult: {
            isStable: !fallbackApplied && stableTerritories.length > 0,
            checks,
            advisories,
            fallbackApplied,
            fallbackReason,
        },
    };
}
function generateStrategyCards(territories) {
    return territories.map((t, i) => ({
        territoryName: t.name,
        enemyDefinition: t.enemyDefinition,
        narrativeDirection: t.narrativeDirection,
        evidenceSignals: t.evidenceSignals,
        confidenceScore: t.confidenceScore,
        isPrimary: i === 0,
    }));
}
function safeJsonParse(data, fallback) {
    if (!data)
        return fallback;
    try {
        return JSON.parse(data);
    }
    catch {
        return fallback;
    }
}
export async function runPositioningEngine(accountId, campaignId, miSnapshotId, audienceSnapshotId, analyticalEnrichment) {
    const startTime = Date.now();
    const stateRefresh = await enforceGlobalStateRefresh(accountId, campaignId);
    if (stateRefresh.refreshRequired) {
        console.log(`[PositioningEngine-V3] GLOBAL_STATE_REFRESH_BLOCKED | fresh=${stateRefresh.fresh} | age=${stateRefresh.details.ageInDays}d | versionMatch=${stateRefresh.details.versionMatch}`);
        const executionTimeMs = Date.now() - startTime;
        if (!stateRefresh.details.snapshotId) {
            return buildEmptyResult("MISSING_DEPENDENCY", `Global state refresh failed: No MIv3 snapshot exists for campaign ${campaignId}. Run Market Intelligence first.`, executionTimeMs, miSnapshotId, audienceSnapshotId);
        }
        if (!stateRefresh.details.versionMatch) {
            return buildEmptyResult("MISSING_DEPENDENCY", `Global state refresh failed: MIv3 snapshot version mismatch (expected current engine version). Re-run Market Intelligence to update.`, executionTimeMs, miSnapshotId, audienceSnapshotId);
        }
        if (!stateRefresh.fresh) {
            return buildEmptyResult("MISSING_DEPENDENCY", `Global state refresh failed: MIv3 snapshot is stale (${stateRefresh.details.ageInDays}d old, max 14d). Re-run Market Intelligence.`, executionTimeMs, miSnapshotId, audienceSnapshotId);
        }
    }
    const [miSnapshot] = await db.select().from(miSnapshots)
        .where(eq(miSnapshots.id, miSnapshotId))
        .limit(1);
    if (!miSnapshot) {
        const executionTimeMs = Date.now() - startTime;
        return buildEmptyResult("MISSING_DEPENDENCY", `Market Intelligence snapshot ${miSnapshotId} not found`, executionTimeMs, miSnapshotId, audienceSnapshotId);
    }
    if (miSnapshot.campaignId !== campaignId) {
        const executionTimeMs = Date.now() - startTime;
        return buildEmptyResult("MISSING_DEPENDENCY", `MI snapshot ${miSnapshotId} belongs to campaign ${miSnapshot.campaignId}, not ${campaignId}`, executionTimeMs, miSnapshotId, audienceSnapshotId);
    }
    let activeMiSnapshot = miSnapshot;
    const miIntegrity = verifySnapshotIntegrity(miSnapshot, MI_ENGINE_VERSION, campaignId);
    if (!miIntegrity.valid) {
        console.log(`[PositioningEngine-V3] MI snapshot integrity failed: ${miIntegrity.failures.join(", ")} — attempting self-healing`);
        const [healed] = await db.select().from(miSnapshots)
            .where(and(eq(miSnapshots.campaignId, campaignId), eq(miSnapshots.accountId, accountId), inArray(miSnapshots.status, ["COMPLETE", "PARTIAL"]), eq(miSnapshots.analysisVersion, MI_ENGINE_VERSION)))
            .orderBy(desc(miSnapshots.createdAt))
            .limit(1);
        if (!healed) {
            console.log(`[PositioningEngine-V3] Self-healing failed: no valid MI snapshot found for campaign ${campaignId}`);
            const executionTimeMs = Date.now() - startTime;
            return buildEmptyResult("MISSING_DEPENDENCY", `MI snapshot integrity verification failed and no valid fallback found: ${miIntegrity.failures.join("; ")}`, executionTimeMs, miSnapshotId, audienceSnapshotId);
        }
        console.log(`[PositioningEngine-V3] Self-healed: resolved stale MI ${miSnapshotId} → ${healed.id}`);
        activeMiSnapshot = healed;
    }
    const miFreshnessMetadata = buildFreshnessMetadata(activeMiSnapshot);
    logFreshnessTraceability("PositioningEngine", activeMiSnapshot, miFreshnessMetadata);
    const isStrategyMode = true;
    if (isStrategyMode && miFreshnessMetadata.blockedForStrategy) {
        console.log(`[PositioningEngine-V3] MI freshness BLOCKED | class=${miFreshnessMetadata.freshnessClass} | age=${miFreshnessMetadata.ageInDays}d | trust=${miFreshnessMetadata.trustScore} | schema=${miFreshnessMetadata.schemaRecommendation}`);
        const executionTimeMs = Date.now() - startTime;
        return buildEmptyResult("MISSING_DEPENDENCY", miFreshnessMetadata.warning || `MI data freshness check failed (${miFreshnessMetadata.freshnessClass}). Re-run Market Intelligence.`, executionTimeMs, miSnapshotId, audienceSnapshotId);
    }
    const miFreshness = activeMiSnapshot.dataFreshnessDays;
    if (miFreshness !== null && miFreshness !== undefined && miFreshness > 14) {
        console.log(`[PositioningEngine-V3] MI data stale: ${miFreshness}d exceeds 14d threshold — requires MI refresh first`);
        const executionTimeMs = Date.now() - startTime;
        return buildEmptyResult("MISSING_DEPENDENCY", `MI data is stale (${miFreshness}d) — refresh Market Intelligence before running Positioning`, executionTimeMs, miSnapshotId, audienceSnapshotId);
    }
    const [audienceSnapshot] = await db.select().from(audienceSnapshots)
        .where(eq(audienceSnapshots.id, audienceSnapshotId))
        .limit(1);
    if (!audienceSnapshot) {
        const executionTimeMs = Date.now() - startTime;
        return buildEmptyResult("MISSING_DEPENDENCY", `Audience Intelligence snapshot ${audienceSnapshotId} not found`, executionTimeMs, miSnapshotId, audienceSnapshotId);
    }
    if (audienceSnapshot.campaignId !== campaignId) {
        const executionTimeMs = Date.now() - startTime;
        return buildEmptyResult("MISSING_DEPENDENCY", `Audience snapshot ${audienceSnapshotId} belongs to campaign ${audienceSnapshot.campaignId}, not ${campaignId}`, executionTimeMs, miSnapshotId, audienceSnapshotId);
    }
    const competitors = await db.select().from(ciCompetitors)
        .where(and(eq(ciCompetitors.campaignId, campaignId), eq(ciCompetitors.isActive, true)));
    const enrichedCount = competitors.filter(c => c.enrichmentStatus === "ENRICHED").length;
    if (competitors.length > 0) {
        console.log(`[PositioningEngine-V3] INVENTORY_STATUS | total=${competitors.length} | enriched=${enrichedCount}`);
    }
    const audiencePains = safeJsonParse(audienceSnapshot.audiencePains, []);
    const audienceDesires = safeJsonParse(audienceSnapshot.desireMap, []);
    const totalSignals = audiencePains.length + audienceDesires.length;
    let parsedStructuredSignals = null;
    if (audienceSnapshot.structuredSignals) {
        const raw = safeJsonParse(audienceSnapshot.structuredSignals, null);
        if (raw &&
            Array.isArray(raw.pain_clusters) &&
            Array.isArray(raw.desire_clusters) &&
            Array.isArray(raw.pattern_clusters) &&
            Array.isArray(raw.root_causes) &&
            Array.isArray(raw.psychological_drivers)) {
            parsedStructuredSignals = raw;
            const totalStructured = getAllSignalLabels(parsedStructuredSignals).length;
            console.log(`[PositioningEngine-V3] STRUCTURED_SIGNALS_LOADED | total=${totalStructured} | pains=${parsedStructuredSignals.pain_clusters.length} | desires=${parsedStructuredSignals.desire_clusters.length} | patterns=${parsedStructuredSignals.pattern_clusters.length} | rootCauses=${parsedStructuredSignals.root_causes.length} | psychDrivers=${parsedStructuredSignals.psychological_drivers.length}`);
        }
        else {
            console.log(`[PositioningEngine-V3] STRUCTURED_SIGNALS_MALFORMED — SIGNAL_REQUIRED: invalid signal shape`);
            const executionTimeMs = Date.now() - startTime;
            return buildAndPersistEmptyResult("SIGNAL_REQUIRED", "Structured audience signals are malformed. Re-run Audience Engine to regenerate valid signal clusters.", executionTimeMs, miSnapshotId, audienceSnapshotId, accountId, campaignId);
        }
    }
    else {
        console.log(`[PositioningEngine-V3] STRUCTURED_SIGNALS_ABSENT — SIGNAL_REQUIRED: cannot run without structured audience signals`);
        const executionTimeMs = Date.now() - startTime;
        return buildAndPersistEmptyResult("SIGNAL_REQUIRED", "Positioning engine requires structured audience signals. Re-run Audience Engine to generate signal clusters before positioning.", executionTimeMs, miSnapshotId, audienceSnapshotId, accountId, campaignId);
    }
    if (totalSignals < POSITIONING_THRESHOLDS.MIN_AUDIENCE_SIGNALS) {
        const executionTimeMs = Date.now() - startTime;
        return buildEmptyResult("INSUFFICIENT_SIGNALS", `Insufficient audience signals (${totalSignals}) for positioning — need ≥${POSITIONING_THRESHOLDS.MIN_AUDIENCE_SIGNALS}`, executionTimeMs, miSnapshotId, audienceSnapshotId);
    }
    const miConfidenceRaw = activeMiSnapshot.confidenceScore ?? activeMiSnapshot.overallConfidence ?? 0;
    const dataReliability = assessDataReliability(competitors.length, totalSignals, !!activeMiSnapshot.marketDiagnosis, true, audiencePains.length > 0, typeof miConfidenceRaw === "number" ? miConfidenceRaw : 0);
    if (dataReliability.isWeak) {
        console.log(`[PositioningEngine-V3] WEAK_DATA | reliability=${dataReliability.overallReliability.toFixed(2)} | advisories=${dataReliability.advisories.length}`);
    }
    const productDna = await loadProductDNA(campaignId, accountId);
    if (productDna) {
        console.log(`[PositioningEngine-V3] PRODUCT_DNA_LOADED | category=${productDna.productCategory || "n/a"} | mechanism=${productDna.uniqueMechanism || "n/a"} | advantage=${productDna.strategicAdvantage || "n/a"}`);
    }
    console.log(`[PositioningEngine-V3] Starting 12-layer analysis | MI=${miSnapshotId} | Audience=${audienceSnapshotId} | Competitors=${competitors.length}`);
    const categoryResult = layer1_categoryDetection(activeMiSnapshot, competitors.length, totalSignals);
    const category = productDna?.productCategory || categoryResult.macro;
    console.log(`[PositioningEngine-V3] L1 Category: ${category}${categoryResult.subcategory ? ` / ${categoryResult.subcategory}` : ""}`);
    const narrativeMap = layer2_marketNarrativeMap(activeMiSnapshot);
    console.log(`[PositioningEngine-V3] L2 Narratives: ${Object.keys(narrativeMap).length} competitors mapped`);
    const narrativeSaturation = layer3_narrativeSaturationDetection(narrativeMap, activeMiSnapshot);
    console.log(`[PositioningEngine-V3] L3 Saturation: ${Object.keys(narrativeSaturation).length} narratives scored (authority-weighted)`);
    const { trustGaps, trustGapScore } = layer4_trustGapDetection(audienceSnapshot);
    console.log(`[PositioningEngine-V3] L4 Trust gaps: ${trustGaps.length} (score: ${trustGapScore.toFixed(2)})`);
    const segmentPriority = layer5_segmentPriorityResolution(audienceSnapshot);
    console.log(`[PositioningEngine-V3] L5 Segments: ${segmentPriority.length} prioritized`);
    const { entries: marketPower, authorityGap, flankingMode } = layer6_marketPowerAnalysis(activeMiSnapshot, competitors);
    console.log(`[PositioningEngine-V3] L6 Market power: ${marketPower.length} competitors | gap=${authorityGap.toFixed(2)} | flanking=${flankingMode}`);
    const contentDna = safeJsonParse(activeMiSnapshot.contentDnaData, []);
    const miTrajectory = safeJsonParse(activeMiSnapshot.trajectoryData, {});
    const competitionIntensityFromMI = miTrajectory.competitionIntensityScore || 0;
    let opportunityGaps = layer7_opportunityGapDetection(narrativeSaturation, audienceSnapshot, marketPower, category, narrativeMap, contentDna, competitionIntensityFromMI, productDna);
    console.log(`[PositioningEngine-V3] L7 Opportunities: ${opportunityGaps.length} viable territories`);
    if (parsedStructuredSignals) {
        const signalTerritories = [];
        const existingNames = new Set(opportunityGaps.map(o => o.territory.toLowerCase()));
        for (const rc of parsedStructuredSignals.root_causes) {
            const translatedName = translateToSystemTerritory(rc.label, "root_cause", productDna);
            if (!existingNames.has(translatedName.toLowerCase())) {
                signalTerritories.push({
                    territory: translatedName,
                    saturationLevel: 0,
                    audienceDemand: Math.min(1.0, rc.frequency / 15),
                    competitorAuthority: 0,
                    opportunityScore: Math.round((0.40 + Math.min(1.0, rc.frequency / 15) * 0.35 + rc.confidence * 0.15) * 100) / 100,
                    painSignals: purifyEvidence(rc.evidence || []).slice(0, 3),
                    desireSignals: [],
                    signalSource: rc.id,
                });
                existingNames.add(translatedName.toLowerCase());
            }
        }
        for (const pd of parsedStructuredSignals.psychological_drivers) {
            const translatedName = translateToSystemTerritory(pd.label, "psych_driver", productDna);
            if (!existingNames.has(translatedName.toLowerCase())) {
                signalTerritories.push({
                    territory: translatedName,
                    saturationLevel: 0,
                    audienceDemand: Math.min(1.0, pd.frequency / 15),
                    competitorAuthority: 0,
                    opportunityScore: Math.round((0.35 + Math.min(1.0, pd.frequency / 15) * 0.30 + pd.confidence * 0.15) * 100) / 100,
                    painSignals: [],
                    desireSignals: purifyEvidence(pd.evidence || []).slice(0, 3),
                    signalSource: pd.id,
                });
                existingNames.add(translatedName.toLowerCase());
            }
        }
        if (signalTerritories.length > 0) {
            opportunityGaps = [...opportunityGaps, ...signalTerritories]
                .sort((a, b) => b.opportunityScore - a.opportunityScore);
            console.log(`[PositioningEngine-V3] SIGNAL_INJECTED_TERRITORIES | added=${signalTerritories.length} from root_causes+psych_drivers | total=${opportunityGaps.length}`);
        }
    }
    const differentiationAxes = layer8_differentiationAxisConstruction(opportunityGaps, trustGaps, flankingMode);
    console.log(`[PositioningEngine-V3] L8 Differentiation: ${differentiationAxes.join(", ")}`);
    const miStrategicSignals = extractStrategicSignals(activeMiSnapshot);
    const audienceStrategicSignals = extractAudienceStrategicSignals(audienceSnapshot);
    const allStrategicSignals = [...miStrategicSignals, ...audienceStrategicSignals];
    const strategicClusters = new Set(allStrategicSignals.map(s => s.cluster));
    console.log(`[PositioningEngine-V3] Signal extraction: ${allStrategicSignals.length} strategic signals across ${strategicClusters.size} clusters`);
    let territories = layer10_strategicTerritorySelection(opportunityGaps, narrativeMap, narrativeSaturation, marketPower, differentiationAxes, segmentPriority, trustGaps, flankingMode);
    console.log(`[PositioningEngine-V3] L10 Territories: ${territories.length} selected`);
    for (const territory of territories) {
        const density = validateTerritoryEvidenceDensity(territory, miStrategicSignals, audienceStrategicSignals);
        if (density.confidencePenalty > 0) {
            territory.confidenceScore = Math.max(0, territory.confidenceScore - density.confidencePenalty);
            if (density.uniqueClusterCount < 2) {
                territory.stabilityNotes.push(`Low semantic cluster diversity (${density.uniqueClusterCount} clusters)`);
            }
            if (density.crossSourceCount < 2) {
                territory.stabilityNotes.push(`Limited cross-source confirmation (${density.crossSourceCount} source${density.crossSourceCount === 1 ? "" : "s"})`);
            }
            if (density.hasRedundancy) {
                territory.stabilityNotes.push("Evidence shows redundant semantic framing");
            }
        }
    }
    console.log(`[PositioningEngine-V3] Territory evidence density validated`);
    try {
        const recentSnapshots = await db.select({
            territories: positioningSnapshots.territories,
            inputSummary: positioningSnapshots.inputSummary,
        })
            .from(positioningSnapshots)
            .where(and(eq(positioningSnapshots.accountId, accountId)))
            .orderBy(desc(positioningSnapshots.createdAt))
            .limit(20);
        const recentTerritoryNames = [];
        for (const snap of recentSnapshots) {
            const summary = safeJsonParse(snap.inputSummary, {});
            if (summary.detectedCategory && summary.detectedCategory !== category)
                continue;
            const parsedTerritories = safeJsonParse(snap.territories, []);
            for (const t of parsedTerritories) {
                if (t.name)
                    recentTerritoryNames.push(t.name);
            }
        }
        if (recentTerritoryNames.length > 0) {
            const diversityPenalties = checkCrossCampaignDiversity(territories, recentTerritoryNames);
            for (const dp of diversityPenalties) {
                if (dp.penalty > 0) {
                    const territory = territories.find(t => t.name === dp.name);
                    if (territory) {
                        territory.opportunityScore = Math.max(0, territory.opportunityScore - dp.penalty);
                        territory.confidenceScore = Math.max(0, territory.confidenceScore - dp.penalty);
                        territory.stabilityNotes.push(`Cross-campaign similarity penalty: -${(dp.penalty * 100).toFixed(0)}%`);
                    }
                }
            }
            console.log(`[PositioningEngine-V3] Cross-campaign diversity: checked ${recentTerritoryNames.length} recent territories`);
        }
    }
    catch (err) {
        console.warn(`[PositioningEngine-V3] Cross-campaign diversity check skipped: ${err.message}`);
    }
    let finalTerritories = [];
    let stabilityResult = { isStable: true, fallbackApplied: false, advisories: [], checks: [] };
    let strategyCards = [];
    let signalTraceability = undefined;
    {
        const SPECIFICITY_MAX_RETRIES = 1;
        let specificityAttempt = 0;
        let specificityRejectionContext = "";
        let generatedTerritories = [];
        for (specificityAttempt = 0; specificityAttempt <= SPECIFICITY_MAX_RETRIES; specificityAttempt++) {
            const territoriesSnapshot = JSON.parse(JSON.stringify(territories));
            if (specificityAttempt > 0) {
                console.log(`[PositioningEngine-V3] SPECIFICITY_GATE: Retry attempt ${specificityAttempt + 1}/${SPECIFICITY_MAX_RETRIES + 1} — re-generating with rejection context`);
            }
            generatedTerritories = await layer11_positioningStatementGeneration(territoriesSnapshot, category, segmentPriority, accountId, activeMiSnapshot, productDna, analyticalEnrichment, parsedStructuredSignals, specificityRejectionContext || undefined);
            console.log(`[PositioningEngine-V3] L11 SIGNAL_DIRECT_COMPOSITION | aelProvided=${!!analyticalEnrichment} | signalBound=${!!parsedStructuredSignals}${specificityAttempt > 0 ? " | retryAttempt=" + (specificityAttempt + 1) : ""}`);
            const specificityCheck = validateTerritorySpecificity(generatedTerritories);
            if (specificityCheck.passed) {
                console.log(`[PositioningEngine-V3] SPECIFICITY_GATE: PASSED | system=${specificityCheck.systemCount} | audience=${specificityCheck.audienceCount} | attempt=${specificityAttempt + 1}`);
                break;
            }
            console.log(`[PositioningEngine-V3] SPECIFICITY_GATE: FAILED | system=${specificityCheck.systemCount} | audience=${specificityCheck.audienceCount} | rejections=${specificityCheck.rejections.length} | attempt=${specificityAttempt + 1}`);
            for (const r of specificityCheck.rejections) {
                console.log(`[PositioningEngine-V3] SPECIFICITY_REJECTED: "${r.name}" — ${r.reasons.join("; ")}`);
            }
            if (specificityAttempt < SPECIFICITY_MAX_RETRIES) {
                const rejectionLines = specificityCheck.rejections.map(r => `REJECTED: "${r.name}" — ${r.reasons.join("; ")}`).join("\n");
                specificityRejectionContext = `
PREVIOUS OUTPUT REJECTED — TERRITORIES WERE AUDIENCE-LEVEL, NOT SYSTEM-LEVEL:
${rejectionLines}

CORRECTION REQUIRED:
- Do NOT output emotional/audience-level territory framing (e.g. "cost concerns", "belonging needs", "trust issues").
- Each territory MUST describe a specific SYSTEM FAILURE or OPERATIONAL BREAKDOWN.
- Every enemyDefinition MUST name what system/process/tool FAILS — not what the buyer FEELS.
- Format: "[specific system/process] fails/lacks/breaks because [specific operational cause]"
- The territory name itself must be rewritten to reflect the operational failure, not the audience emotion.`;
            }
            else {
                for (const t of generatedTerritories) {
                    const classification = classifyTerritoryLevel(t);
                    if (classification.level === "audience") {
                        t.confidenceScore = Math.max(0, t.confidenceScore - 0.15);
                        t.stabilityNotes.push(`[SPECIFICITY_FAILED] Territory remains audience-level after retry: ${classification.reasons.join("; ")}`);
                    }
                }
                console.log(`[PositioningEngine-V3] SPECIFICITY_GATE: EXHAUSTED | proceeding with best available output after ${specificityAttempt + 1} attempts`);
            }
        }
        const boundaryText = generatedTerritories.map(t => `${t.name} ${t.enemyDefinition} ${t.contrastAxis} ${t.narrativeDirection} ${t.evidenceSignals?.join(" ") || ""}`).join(" ");
        const boundaryCheck = enforceBoundaryWithSanitization(boundaryText, BOUNDARY_HARD_PATTERNS, BOUNDARY_SOFT_PATTERNS);
        if (!boundaryCheck.clean) {
            console.error(`[PositioningEngine-V3] BOUNDARY VIOLATION: ${boundaryCheck.violations.join("; ")}`);
            const executionTimeMs = Date.now() - startTime;
            return {
                ...buildEmptyResult("INTEGRITY_FAILED", `Boundary enforcement failed: ${boundaryCheck.violations.join("; ")}`, executionTimeMs, miSnapshotId, audienceSnapshotId),
                confidenceScore: 0,
            };
        }
        if (boundaryCheck.sanitized && boundaryCheck.warnings.length > 0) {
            for (const warning of boundaryCheck.warnings) {
                console.log(`[PositioningEngine-V3] BOUNDARY WARNING: ${warning}`);
            }
            for (const t of generatedTerritories) {
                t.name = applySoftSanitization(t.name, BOUNDARY_SOFT_PATTERNS);
                t.enemyDefinition = applySoftSanitization(t.enemyDefinition, BOUNDARY_SOFT_PATTERNS);
                t.contrastAxis = applySoftSanitization(t.contrastAxis, BOUNDARY_SOFT_PATTERNS);
                t.narrativeDirection = applySoftSanitization(t.narrativeDirection, BOUNDARY_SOFT_PATTERNS);
                if (t.evidenceSignals) {
                    t.evidenceSignals = t.evidenceSignals.map((s) => applySoftSanitization(s, BOUNDARY_SOFT_PATTERNS));
                }
            }
        }
        const stabilityOutput = layer12_stabilityGuard(generatedTerritories, narrativeSaturation, marketPower, segmentPriority, narrativeMap, competitors.length, totalSignals);
        generatedTerritories = stabilityOutput.territories;
        stabilityResult = stabilityOutput.stabilityResult;
        const advisoryCount = stabilityResult.advisories.length;
        console.log(`[PositioningEngine-V3] L12 Stability: ${stabilityResult.isStable ? "STABLE" : "UNSTABLE"} | fallback=${stabilityResult.fallbackApplied} | advisories=${advisoryCount}`);
        if (advisoryCount > 0) {
            for (const adv of stabilityResult.advisories) {
                console.log(`[PositioningEngine-V3] ADVISORY: ${adv.message}`);
            }
        }
        const strategicSignalGate = {
            passedSignals: allStrategicSignals.map((s, i) => ({
                signalId: `STR-${i}`,
                snippet: s.signal,
                sourceCompetitor: s.source,
                category: s.cluster,
                confidenceScore: 1,
                sourceCount: 1,
                freshnessFactor: 1,
                crossValidated: true,
                qualityScore: 1,
            })),
            totalInputSignals: allStrategicSignals.length,
            rejectedSignals: [],
            deduplicatedCount: 0,
            crossValidatedCount: allStrategicSignals.length,
            averageQuality: 1,
            gatePass: allStrategicSignals.length >= 3,
            gateSummary: "",
        };
        let totalOrphanedClaims = 0;
        let totalTracedClaims = 0;
        for (const territory of generatedTerritories) {
            const claims = [territory.name, territory.enemyDefinition, territory.contrastAxis, territory.narrativeDirection].filter(Boolean);
            const orphanResult = checkForOrphanClaims(claims, strategicSignalGate);
            totalOrphanedClaims += orphanResult.orphanedClaims.length;
            totalTracedClaims += orphanResult.tracedClaims;
            if (orphanResult.orphanedClaims.length > 0) {
                for (const orphan of orphanResult.orphanedClaims) {
                    if (!territory.stabilityNotes)
                        territory.stabilityNotes = [];
                    territory.stabilityNotes.push(`[HYPOTHESIS] Claim not directly traceable to MIv3 signal: "${orphan.slice(0, 80)}"`);
                }
                territory.confidenceScore = Math.max(0, territory.confidenceScore - (orphanResult.orphanedClaims.length * 0.05));
            }
        }
        if (totalOrphanedClaims > 0) {
            console.log(`[PositioningEngine-V3] ORPHAN_AUDIT | orphaned=${totalOrphanedClaims} | traced=${totalTracedClaims} | territories=${generatedTerritories.length} — orphaned claims flagged as [HYPOTHESIS]`);
        }
        else {
            console.log(`[PositioningEngine-V3] ORPHAN_AUDIT | ZERO_ORPHANS | all ${totalTracedClaims} claims traceable to MIv3 signals`);
        }
        const allPositioningText = generatedTerritories.map(t => [
            t.name, t.enemyDefinition || "", t.narrativeDirection || "", t.contrastAxis || "",
            ...(t.evidenceSignals || []),
        ].join(" ")).join(" ");
        const genericOutputCheck = detectGenericOutput(allPositioningText);
        if (genericOutputCheck.genericDetected) {
            console.log(`[PositioningEngine-V3] GENERIC_WARNING | ${genericOutputCheck.genericPhrases.length} generic phrases detected: ${genericOutputCheck.genericPhrases.slice(0, 5).join(", ")}`);
            for (const t of generatedTerritories) {
                t.stabilityNotes.push(`[GENERIC_DETECTED] Output may contain generic marketing language`);
                t.confidenceScore = Math.max(0, t.confidenceScore - 0.10);
            }
        }
        if (parsedStructuredSignals) {
            const allMappedIds = new Set();
            const unmappedTerritories = [];
            for (const t of generatedTerritories) {
                if (t.mappedSignalIds && t.mappedSignalIds.length > 0) {
                    for (const id of t.mappedSignalIds)
                        allMappedIds.add(id);
                }
                else {
                    const isUnmapped = t.stabilityNotes.some(n => n.includes("SIGNAL_UNMAPPED"));
                    if (!isUnmapped) {
                        unmappedTerritories.push(t.name);
                    }
                }
            }
            const totalAvailable = getAllSignalLabels(parsedStructuredSignals).length;
            const coverage = totalAvailable > 0 ? allMappedIds.size / totalAvailable : 0;
            const nonUnmappedCount = generatedTerritories.filter(t => !t.stabilityNotes.some(n => n.includes("SIGNAL_UNMAPPED"))).length;
            const groundedCount = generatedTerritories.filter(t => t.mappedSignalIds && t.mappedSignalIds.length > 0).length;
            const compositionPassed = nonUnmappedCount > 0 && groundedCount >= Math.ceil(nonUnmappedCount * 0.5);
            signalTraceability = {
                totalSignalsAvailable: totalAvailable,
                signalsUsed: Array.from(allMappedIds),
                signalCoverage: Math.round(coverage * 100) / 100,
                unmappedElements: unmappedTerritories,
                validationPassed: compositionPassed,
            };
            console.log(`[PositioningEngine-V3] SIGNAL_COMPOSITION_REPORT | mapped=${allMappedIds.size}/${totalAvailable} signals | coverage=${(coverage * 100).toFixed(1)}% | grounded=${groundedCount}/${nonUnmappedCount} territories | passed=${compositionPassed}`);
        }
        finalTerritories = generatedTerritories;
        strategyCards = generateStrategyCards(finalTerritories);
        console.log(`[PositioningEngine-V3] SIGNAL_DIRECT_COMPOSITION COMPLETE | territories=${finalTerritories.length} | cards=${strategyCards.length}`);
    }
    const celCompliance = enforcePositioningCompliance(finalTerritories, analyticalEnrichment || null);
    if (celCompliance.violations.length > 0) {
        applyCompliancePenalties(finalTerritories, celCompliance);
        for (const logEntry of celCompliance.enforcementLog) {
            console.log(`[PositioningEngine-V3] CEL: ${logEntry}`);
        }
        console.log(`[PositioningEngine-V3] CEL_RESULT | passed=${celCompliance.passed} | score=${celCompliance.score.toFixed(2)} | violations=${celCompliance.violations.length} | rules=${celCompliance.appliedRules.join(",")}`);
    }
    else {
        console.log(`[PositioningEngine-V3] CEL_RESULT | CLEAN | score=1.00 | rootCauses=${celCompliance.rootCausesEvaluated}`);
    }
    if (signalTraceability?.validationPassed) {
        console.log(`[PositioningEngine-V3] SIGNAL_TRACE_PASSED | coverage=${(signalTraceability.signalCoverage * 100).toFixed(1)}% | used=${signalTraceability.signalsUsed.length}/${signalTraceability.totalSignalsAvailable} | unmapped=${signalTraceability.unmappedElements.length}`);
    }
    const primaryTerritory = finalTerritories[0] || null;
    const executionTimeMs = Date.now() - startTime;
    const rawConfidence = primaryTerritory
        ? Math.round(primaryTerritory.confidenceScore * 100) / 100
        : 0;
    const overallConfidence = normalizeConfidence(rawConfidence, dataReliability);
    const confidenceNormalized = rawConfidence !== overallConfidence;
    const status = !stabilityResult.isStable ? "UNSTABLE" : "COMPLETE";
    const hasAdvisories = stabilityResult.advisories.length > 0;
    const statusMessage = !stabilityResult.isStable
        ? "Positioning generated but stability checks failed — review recommended"
        : hasAdvisories
            ? stabilityResult.advisories.map(a => a.message).join("; ")
            : null;
    const combinedSignalCount = totalSignals + allStrategicSignals.length;
    const resolvedMiSnapshotId = activeMiSnapshot.id;
    const inputSummary = {
        miSnapshotId: resolvedMiSnapshotId,
        audienceSnapshotId,
        competitorCount: competitors.length,
        signalCount: combinedSignalCount,
        audienceSignalCount: totalSignals,
        executionTimeMs,
        flankingMode,
        detectedCategory: category,
        strategicSubcategory: categoryResult.subcategory,
        strategicSignalCount: allStrategicSignals.length,
        strategicClusterCount: strategicClusters.size,
    };
    const dataReliabilityDiagnostics = {
        dataReliability,
        confidenceNormalized,
        rawConfidence: confidenceNormalized ? rawConfidence : undefined,
    };
    const [inserted] = await db.insert(positioningSnapshots).values({
        accountId,
        campaignId,
        miSnapshotId: resolvedMiSnapshotId,
        audienceSnapshotId,
        engineVersion: POSITIONING_ENGINE_VERSION,
        status,
        statusMessage,
        territory: JSON.stringify(primaryTerritory),
        enemyDefinition: primaryTerritory?.enemyDefinition || "",
        contrastAxis: primaryTerritory?.contrastAxis || "",
        narrativeDirection: primaryTerritory?.narrativeDirection || "",
        differentiationVector: JSON.stringify(differentiationAxes),
        proofSignals: JSON.stringify(primaryTerritory?.evidenceSignals || []),
        strategyCards: JSON.stringify(strategyCards),
        territories: JSON.stringify(finalTerritories),
        stabilityResult: JSON.stringify(stabilityResult),
        marketPowerAnalysis: JSON.stringify(marketPower),
        opportunityGaps: JSON.stringify(opportunityGaps),
        narrativeSaturation: JSON.stringify(narrativeSaturation),
        segmentPriority: JSON.stringify(segmentPriority),
        inputSummary: JSON.stringify(inputSummary),
        confidenceScore: overallConfidence,
        signalTraceability: signalTraceability ? JSON.stringify(signalTraceability) : null,
        executionTimeMs,
    }).returning({ id: positioningSnapshots.id });
    await pruneOldSnapshots(db, positioningSnapshots, campaignId, 20, accountId);
    try {
        const { invalidateDownstreamOnRegeneration } = await import("../shared/strategy-root");
        const inv = await invalidateDownstreamOnRegeneration(campaignId, accountId, "positioning");
        if (inv.supersededRoots > 0) {
            console.log(`[PositioningEngine-V3] ROOT_INVALIDATED | superseded=${inv.supersededRoots}`);
        }
    }
    catch (invErr) {
        console.error(`[PositioningEngine-V3] Root invalidation failed (non-blocking): ${invErr.message}`);
    }
    console.log(`[PositioningEngine-V3] ${status} in ${executionTimeMs}ms | snapshot=${inserted.id} | territories=${finalTerritories.length} | confidence=${overallConfidence}`);
    return {
        status,
        statusMessage,
        territory: primaryTerritory,
        territories: finalTerritories,
        strategyCards,
        marketPowerAnalysis: marketPower,
        opportunityGaps,
        narrativeSaturation,
        segmentPriority,
        stabilityResult,
        enemyDefinition: primaryTerritory?.enemyDefinition || "",
        contrastAxis: primaryTerritory?.contrastAxis || "",
        narrativeDirection: primaryTerritory?.narrativeDirection || "",
        differentiationVector: differentiationAxes,
        proofSignals: primaryTerritory?.evidenceSignals || [],
        confidenceScore: overallConfidence,
        inputSummary,
        snapshotId: inserted.id,
        executionTimeMs,
        createdAt: new Date().toISOString(),
        signalTraceability,
    };
}
async function buildAndPersistEmptyResult(status, message, executionTimeMs, miSnapshotId, audienceSnapshotId, accountId, campaignId, extra) {
    const result = buildEmptyResult(status, message, executionTimeMs, miSnapshotId, audienceSnapshotId);
    const merged = { ...result, ...extra };
    try {
        const [inserted] = await db.insert(positioningSnapshots).values({
            accountId,
            campaignId,
            miSnapshotId,
            audienceSnapshotId,
            engineVersion: POSITIONING_ENGINE_VERSION,
            status,
            statusMessage: message,
            territory: JSON.stringify(null),
            enemyDefinition: "",
            contrastAxis: "",
            narrativeDirection: "",
            differentiationVector: JSON.stringify([]),
            proofSignals: JSON.stringify([]),
            strategyCards: JSON.stringify([]),
            territories: JSON.stringify([]),
            stabilityResult: JSON.stringify({ isStable: false, checks: [], advisories: [], fallbackApplied: false }),
            marketPowerAnalysis: JSON.stringify([]),
            opportunityGaps: JSON.stringify([]),
            narrativeSaturation: JSON.stringify({}),
            segmentPriority: JSON.stringify([]),
            inputSummary: JSON.stringify(merged.inputSummary),
            confidenceScore: 0,
            signalTraceability: extra?.signalTraceability ? JSON.stringify(extra.signalTraceability) : null,
            executionTimeMs,
        }).returning({ id: positioningSnapshots.id });
        merged.snapshotId = inserted.id;
        console.log(`[PositioningEngine-V3] ${status} persisted | snapshot=${inserted.id} | ${message.slice(0, 80)}`);
    }
    catch (err) {
        console.error(`[PositioningEngine-V3] Failed to persist ${status} snapshot: ${err.message}`);
    }
    return merged;
}
function buildEmptyResult(status, message, executionTimeMs, miSnapshotId, audienceSnapshotId) {
    return {
        status,
        statusMessage: message,
        territory: null,
        territories: [],
        strategyCards: [],
        marketPowerAnalysis: [],
        opportunityGaps: [],
        narrativeSaturation: {},
        segmentPriority: [],
        stabilityResult: { isStable: false, checks: [], advisories: [], fallbackApplied: false },
        enemyDefinition: "",
        contrastAxis: "",
        narrativeDirection: "",
        differentiationVector: [],
        proofSignals: [],
        confidenceScore: 0,
        inputSummary: {
            miSnapshotId,
            audienceSnapshotId,
            competitorCount: 0,
            signalCount: 0,
            audienceSignalCount: 0,
            executionTimeMs,
            flankingMode: false,
            detectedCategory: "unknown",
            strategicSubcategory: null,
            strategicSignalCount: 0,
            strategicClusterCount: 0,
        },
        snapshotId: "",
        executionTimeMs,
        createdAt: new Date().toISOString(),
    };
}
export async function getLatestPositioningSnapshot(accountId, campaignId) {
    const [snapshot] = await db.select().from(positioningSnapshots)
        .where(and(eq(positioningSnapshots.accountId, accountId), eq(positioningSnapshots.campaignId, campaignId), eq(positioningSnapshots.engineVersion, POSITIONING_ENGINE_VERSION)))
        .orderBy(desc(positioningSnapshots.createdAt))
        .limit(1);
    if (!snapshot)
        return null;
    return {
        ...snapshot,
        territory: safeJsonParse(snapshot.territory, null),
        differentiationVector: safeJsonParse(snapshot.differentiationVector, []),
        proofSignals: safeJsonParse(snapshot.proofSignals, []),
        strategyCards: safeJsonParse(snapshot.strategyCards, []),
        territories: safeJsonParse(snapshot.territories, []),
        stabilityResult: safeJsonParse(snapshot.stabilityResult, {}),
        marketPowerAnalysis: safeJsonParse(snapshot.marketPowerAnalysis, []),
        opportunityGaps: safeJsonParse(snapshot.opportunityGaps, []),
        narrativeSaturation: safeJsonParse(snapshot.narrativeSaturation, {}),
        segmentPriority: safeJsonParse(snapshot.segmentPriority, []),
        inputSummary: safeJsonParse(snapshot.inputSummary, {}),
        signalTraceability: snapshot.signalTraceability ? safeJsonParse(snapshot.signalTraceability, null) : null,
    };
}
export { layer1_categoryDetection, layer2_marketNarrativeMap, layer3_narrativeSaturationDetection, layer4_trustGapDetection, layer5_segmentPriorityResolution, layer6_marketPowerAnalysis, layer7_opportunityGapDetection, layer8_differentiationAxisConstruction, layer9_narrativeDistanceScoring, layer10_strategicTerritorySelection, layer12_stabilityGuard, deduplicateTerritories, generateStrategyCards, };
