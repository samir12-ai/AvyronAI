const CATEGORY_TO_SIGNAL_TYPE = {
    problem_framing: "pain",
    problem_statement: "objection",
    trust_repair: "trust_barrier",
    credibility: "trust_barrier",
    comparison: "objection",
    anti_pattern: "objection",
    price_value: "objection",
    results_skepticism: "objection",
    generic_strategy: "objection",
    noise_rejection: "objection",
    differentiation_signal: "objection",
    strategy_framing: "objection",
};
const NARRATIVE_OBJECTION_PATTERNS = [
    {
        category: "comparison",
        patterns: [
            /unlike (most|other|many|typical)/i,
            /not like (most|other|the rest|typical)/i,
            /most [\w\s]{1,25}(don'?t|fail|lack|miss|ignore|won'?t|can'?t|aren'?t)/i,
            /while (others|most|everyone|they) /i,
            /what (makes|sets) .{1,20}(different|apart|unique)/i,
            /better than .{1,20}because/i,
            /compared to (other|most|typical)/i,
        ],
        objectionLabel: "Competitors use generic or undifferentiated approaches",
    },
    {
        category: "comparison",
        patterns: [
            /most (agencies|coaches|consultants|marketers|providers|companies|businesses|brands|freelancers|firms)/i,
        ],
        objectionLabel: "Industry providers lack specialized understanding",
    },
    {
        category: "anti_pattern",
        patterns: [
            /stop (wasting|paying|spending|throwing|chasing|posting|doing)/i,
            /quit (wasting|paying|spending|posting)/i,
            /done (wasting|paying|spending)/i,
            /enough (wasting|spending|paying)/i,
        ],
        objectionLabel: "Current solutions waste money without results",
    },
    {
        category: "anti_pattern",
        patterns: [
            /why .{1,30}(fails?|doesn'?t work|won'?t work|is broken|never works?|are failing|isn'?t working)/i,
            /the (problem|issue|trouble) with/i,
            /what'?s wrong with/i,
            /the real reason .{1,25}(fail|struggle|don'?t|can'?t|aren'?t)/i,
        ],
        objectionLabel: "Common approaches fundamentally fail",
    },
    {
        category: "trust_repair",
        patterns: [
            /(tired of|sick of|fed up|frustrated with|exhausted by|burnt out)/i,
        ],
        objectionLabel: "Providers overpromise and underdeliver results",
    },
    {
        category: "trust_repair",
        patterns: [
            /what .{1,25}(don'?t|won'?t|never) tell you/i,
            /what they (hide|don'?t|won'?t|never)/i,
            /the (truth|real truth|dirty secret|honest truth) about/i,
            /nobody talks about/i,
            /no one (mentions|talks|tells)/i,
            /hidden (cost|truth|reality|side)/i,
            /industry secret/i,
        ],
        objectionLabel: "Industry lacks transparency",
    },
    {
        category: "trust_repair",
        patterns: [
            /too good to be true/i,
            /sounds? too good/i,
            /hard to believe/i,
            /(prove it|show me proof|where'?s the proof)/i,
        ],
        objectionLabel: "Claims seem too good to be true",
    },
    {
        category: "problem_framing",
        patterns: [
            /the reason (most|many|so many) .{1,25}(struggle|fail|can'?t|don'?t|won'?t|aren'?t|give up)/i,
            /here'?s why (most|you|they|your|many) .{1,25}(struggle|fail|can'?t|don'?t|isn'?t|aren'?t)/i,
            /this is why (most|many|you|your) .{1,25}(struggle|fail|don'?t|can'?t)/i,
            /ever wonder(ed)? why .{1,25}(fail|struggle|don'?t|can'?t)/i,
        ],
        objectionLabel: "Most people struggle due to wrong approach",
    },
    {
        category: "problem_framing",
        patterns: [
            /(biggest|common|#1|number one|fatal|critical|worst) mistake/i,
            /if you'?re still (doing|using|trying|paying|spending|relying|posting|hoping|waiting)/i,
            /you'?re (probably|likely|still) (doing|making|wasting|missing|ignoring)/i,
        ],
        objectionLabel: "Current methods are based on common mistakes",
    },
    {
        category: "problem_statement",
        patterns: [
            /tired of .{3,60}(that|who|which|and|but|with|without)/i,
            /sick of .{3,60}(that|who|which|and|but|with|without)/i,
            /fed up with .{3,40}/i,
            /frustrated (with|by|that) .{3,40}/i,
            /exhausted (from|by) .{3,40}/i,
            /burnt out (on|from|by) .{3,40}/i,
            /overwhelmed (by|with|from) .{3,40}/i,
        ],
        objectionLabel: "Audience frustrated with current provider results",
    },
    {
        category: "problem_statement",
        patterns: [
            /struggling (with|to) .{3,50}/i,
            /can'?t (seem to|figure out|get|find|afford|achieve) .{3,40}/i,
            /having trouble .{3,40}/i,
            /finding it (hard|difficult|impossible) to .{3,40}/i,
        ],
        objectionLabel: "Audience struggles to achieve desired results",
    },
    {
        category: "problem_statement",
        patterns: [
            /stop wasting (money|time|resources|energy|effort) on .{3,40}/i,
            /stop (paying|spending) for .{3,40}(that|which|and|without)/i,
            /throwing (money|cash|budget) (at|into|away on) .{3,40}/i,
            /wasting .{1,15}(money|time|budget|resources) on .{3,40}/i,
        ],
        objectionLabel: "Current solutions waste resources without ROI",
    },
    {
        category: "problem_statement",
        patterns: [
            /most (agencies|companies|consultants|marketers|coaches|providers|firms|freelancers|businesses|brands) .{1,30}(but|yet|however|and then|then|without|don'?t|fail|won'?t|never|lack|miss)/i,
            /(agencies|companies|consultants|marketers) (promise|claim|say|tell you) .{1,30}(but|yet|however)/i,
            /(agencies|companies) that (promise|claim) .{1,30}(fail|don'?t|won'?t|never|can'?t) .{1,30}deliver/i,
        ],
        objectionLabel: "Providers overpromise results but fail to deliver",
    },
    {
        category: "problem_statement",
        patterns: [
            /you'?ve (tried|been|paid|hired|invested) .{1,30}(but|and|yet|still|without|nothing)/i,
            /i('?ve| have) (tried|been|paid|hired|worked) .{1,30}(but|and|yet|still|nothing|didn'?t)/i,
            /(tried|tested|used) .{1,20}(everything|every|multiple|several|different|so many) .{1,30}(but|and|yet|still|nothing)/i,
        ],
        objectionLabel: "Previous attempts and investments yielded no results",
    },
    {
        category: "problem_statement",
        patterns: [
            /what (nobody|no one|most) .{1,20}(tells|says|mentions|warns|admits|reveals) .{1,20}(about|is that)/i,
            /the (ugly|harsh|inconvenient|uncomfortable|hard) truth/i,
            /here'?s what .{1,20}(won'?t|don'?t|refuse to|hate to) (tell|admit|say|share|reveal)/i,
        ],
        objectionLabel: "Industry hides the real truth about results",
    },
    {
        category: "price_value",
        patterns: [
            /(high retainer|expensive|overpriced|too much money|costs? too much)/i,
            /waste of money/i,
            /(affordable|budget.?friendly|fraction of the cost)/i,
            /without breaking the bank/i,
            /save .{1,15}(money|cost|budget)/i,
            /pay .{1,20}for (nothing|no results)/i,
        ],
        objectionLabel: "Services charge high retainers without proportional value",
    },
    {
        category: "results_skepticism",
        patterns: [
            /(no guarantee|can'?t guarantee|zero guarantee)/i,
            /(vanity metrics?|fake (results|numbers|engagement|followers|growth))/i,
            /inflated (numbers|stats|metrics)/i,
            /results .{1,15}vary/i,
            /no real results/i,
        ],
        objectionLabel: "Results cannot be guaranteed or verified",
    },
    {
        category: "generic_strategy",
        patterns: [
            /cookie.?cutter/i,
            /one.?size.?fits/i,
            /generic (strateg|approach|template|plan|content|marketing)/i,
            /template.?based/i,
            /same (strategy|approach|plan|content) for (everyone|every|all)/i,
            /not (personali[sz]ed|customi[sz]ed|tailored)/i,
        ],
        objectionLabel: "Strategies are generic and not customized",
    },
    {
        category: "noise_rejection",
        patterns: [
            /(don'?t|people don'?t|they don'?t|nobody) want(s)? to be (pushed|sold|spammed|bombarded)/i,
            /less (pressure|noise|spam|selling)/i,
            /stop (selling|pushing|spamming)/i,
            /more (meaning|value|depth|authenticity)/i,
        ],
        objectionLabel: "Audiences reject pushy or noisy marketing",
    },
    {
        category: "differentiation_signal",
        patterns: [
            /we (don'?t|never) (just|only) (create|make|do|produce|post)/i,
            /not (just|only) (content|marketing|posts|ads|social media)/i,
            /more than (just|only) (content|marketing|posts|design)/i,
            /we (actually|really) (deliver|do|care|understand)/i,
        ],
        objectionLabel: "Market perceives providers as doing superficial work",
    },
    {
        category: "credibility",
        patterns: [
            /(our |from |see )?client (results|success|review|feedback|testimonial)/i,
            /real (results|growth|impact|numbers|data)/i,
            /(proven|track record|case stud)/i,
            /(from our clients|our clients say|what .{1,15}clients say)/i,
        ],
        objectionLabel: "Market demands proof of actual results",
    },
    {
        category: "strategy_framing",
        patterns: [
            /(clear|real|actual|proper|solid) (strategy|plan|roadmap|direction)/i,
            /strategic (approach|plan|marketing|direction)/i,
            /not (random|just posting|guessing|hoping)/i,
            /with(out)? a (plan|strategy|system|clear direction)/i,
        ],
        objectionLabel: "Most marketing lacks strategic direction",
    },
];
function extractFromCaption(caption) {
    const results = [];
    if (!caption || caption.length < 15)
        return results;
    const seenLabels = new Set();
    for (const def of NARRATIVE_OBJECTION_PATTERNS) {
        if (seenLabels.has(def.objectionLabel))
            continue;
        for (const pattern of def.patterns) {
            const match = caption.match(pattern);
            if (match) {
                const start = Math.max(0, (match.index || 0) - 30);
                const end = Math.min(caption.length, (match.index || 0) + match[0].length + 50);
                const evidence = caption.substring(start, end).replace(/\n/g, " ").trim();
                results.push({
                    objectionLabel: def.objectionLabel,
                    patternCategory: def.category,
                    evidence,
                    matchedPattern: match[0],
                });
                seenLabels.add(def.objectionLabel);
                break;
            }
        }
    }
    return results;
}
export function extractNarrativeObjections(competitors) {
    const objectionAgg = new Map();
    let captionsScanned = 0;
    for (const comp of competitors) {
        const posts = (comp.posts || []).slice(0, 12);
        for (const post of posts) {
            const caption = (post.caption || "").trim();
            if (caption.length < 15)
                continue;
            captionsScanned++;
            const sentences = caption.split(/[.\n!?]/).filter(s => s.trim().length > 5);
            const hookLine = sentences[0] || "";
            const ctaLine = sentences.length > 1 ? sentences[sentences.length - 1] : "";
            const textsToScan = [caption];
            if (hookLine && hookLine !== caption)
                textsToScan.push(hookLine);
            if (ctaLine && ctaLine !== caption && ctaLine !== hookLine)
                textsToScan.push(ctaLine);
            const seenForPost = new Set();
            for (const text of textsToScan) {
                const hits = extractFromCaption(text);
                for (const hit of hits) {
                    if (seenForPost.has(hit.objectionLabel))
                        continue;
                    seenForPost.add(hit.objectionLabel);
                    if (!objectionAgg.has(hit.objectionLabel)) {
                        objectionAgg.set(hit.objectionLabel, {
                            patternCategory: hit.patternCategory,
                            hitCount: 0,
                            evidence: [],
                            competitorNames: new Set(),
                        });
                    }
                    const entry = objectionAgg.get(hit.objectionLabel);
                    entry.hitCount++;
                    if (entry.evidence.length < 5) {
                        entry.evidence.push({
                            caption: hit.evidence,
                            competitorName: comp.name,
                            matchedPattern: hit.matchedPattern,
                        });
                    }
                    entry.competitorNames.add(comp.name);
                }
            }
        }
    }
    const objections = [];
    for (const [label, data] of objectionAgg.entries()) {
        const totalHits = data.hitCount;
        const frequencyScore = Math.min(totalHits / Math.max(captionsScanned, 1), 1.0);
        const multiCompetitorBonus = data.competitorNames.size >= 2 ? 0.2 : 0;
        const narrativeConfidence = Math.min(0.4 + (frequencyScore * 0.4) + multiCompetitorBonus + (Math.min(totalHits, 4) * 0.05), 1.0);
        const signalType = CATEGORY_TO_SIGNAL_TYPE[data.patternCategory] || "objection";
        objections.push({
            objection: label,
            frequencyScore: Math.round(frequencyScore * 1000) / 1000,
            narrativeConfidence: Math.round(narrativeConfidence * 1000) / 1000,
            supportingEvidence: data.evidence,
            competitorSources: Array.from(data.competitorNames),
            patternCategory: data.patternCategory,
            signalType,
        });
    }
    objections.sort((a, b) => b.narrativeConfidence - a.narrativeConfidence || b.frequencyScore - a.frequencyScore);
    const objectionsFromMultiple = objections.filter(o => o.competitorSources.length >= 2).length;
    const objectionDensity = captionsScanned > 0
        ? Math.round((objections.reduce((s, o) => s + o.frequencyScore, 0) / Math.max(objections.length, 1)) * 1000) / 1000
        : 0;
    const problemStatements = objections.filter(o => o.patternCategory === "problem_statement");
    const problemStatementsExtracted = problemStatements.length;
    if (problemStatementsExtracted > 0) {
        console.log(`[NarrativeObjectionExtractor] PROBLEM_STATEMENTS | extracted=${problemStatementsExtracted} | labels=[${problemStatements.map(o => o.objection).join("; ")}]`);
    }
    const clusteredObjections = clusterObjections(objections);
    const painCount = objections.filter(o => o.signalType === "pain").length;
    const objectionCount = objections.filter(o => o.signalType === "objection").length;
    const trustBarrierCount = objections.filter(o => o.signalType === "trust_barrier").length;
    return {
        objections,
        totalObjectionsDetected: objections.length,
        objectionsFromMultipleCompetitors: objectionsFromMultiple,
        objectionDensity,
        captionsScanned,
        extractionTimestamp: new Date().toISOString(),
        painCount,
        objectionCount,
        trustBarrierCount,
        clusteredObjections,
        problemStatementsExtracted,
    };
}
const CLUSTER_KEYWORDS = {
    overpromise: ["overpromise", "promise", "deliver", "fail to deliver", "results but", "underdeliver"],
    waste: ["waste", "wasting", "throwing money", "no results", "no ROI", "without ROI"],
    generic: ["generic", "cookie cutter", "one size", "template", "not customized", "not personalized"],
    trust: ["trust", "transparency", "hide", "secret", "truth", "prove", "proof"],
    struggle: ["struggle", "struggling", "can't", "frustrated", "tired of", "sick of", "exhausted"],
    price: ["expensive", "overpriced", "retainer", "cost", "budget", "afford"],
    results: ["results", "guarantee", "vanity metrics", "fake", "verified", "no real"],
};
export function clusterObjections(objections) {
    const clusterMap = new Map();
    for (const obj of objections) {
        const lower = obj.objection.toLowerCase();
        let bestCluster = "unclustered";
        let bestScore = 0;
        for (const [clusterId, keywords] of Object.entries(CLUSTER_KEYWORDS)) {
            let score = 0;
            for (const kw of keywords) {
                if (lower.includes(kw))
                    score++;
            }
            if (score > bestScore) {
                bestScore = score;
                bestCluster = clusterId;
            }
        }
        if (!clusterMap.has(bestCluster)) {
            clusterMap.set(bestCluster, { members: [], totalFreq: 0, sources: new Set() });
        }
        const cluster = clusterMap.get(bestCluster);
        cluster.members.push(obj);
        cluster.totalFreq += obj.frequencyScore;
        for (const src of obj.competitorSources)
            cluster.sources.add(src);
        obj.clusterId = bestCluster;
    }
    const clusters = [];
    for (const [clusterId, data] of clusterMap.entries()) {
        if (data.members.length === 0)
            continue;
        const canonical = data.members.sort((a, b) => b.narrativeConfidence - a.narrativeConfidence)[0];
        clusters.push({
            clusterId,
            canonicalObjection: canonical.objection,
            memberObjections: data.members.map(m => m.objection),
            totalFrequency: data.totalFreq,
            signalType: canonical.signalType,
            competitorSources: Array.from(data.sources),
        });
    }
    clusters.sort((a, b) => b.totalFrequency - a.totalFrequency);
    console.log(`[NarrativeObjectionExtractor] CLUSTERING | clusters=${clusters.length} | objections=${objections.length} | topCluster=${clusters[0]?.clusterId || "none"}`);
    return clusters;
}
