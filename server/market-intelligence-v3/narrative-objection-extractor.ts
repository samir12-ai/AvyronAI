import type { CompetitorInput, PostData } from "./types";

export interface NarrativeObjectionItem {
  objection: string;
  frequencyScore: number;
  narrativeConfidence: number;
  supportingEvidence: Array<{ caption: string; competitorName: string; matchedPattern: string }>;
  competitorSources: string[];
  patternCategory: string;
}

export interface NarrativeObjectionMap {
  objections: NarrativeObjectionItem[];
  totalObjectionsDetected: number;
  objectionsFromMultipleCompetitors: number;
  objectionDensity: number;
  captionsScanned: number;
  extractionTimestamp: string;
}

interface PatternDef {
  category: string;
  patterns: RegExp[];
  objectionLabel: string;
}

const NARRATIVE_OBJECTION_PATTERNS: PatternDef[] = [
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

function extractFromCaption(
  caption: string,
): Array<{ objectionLabel: string; patternCategory: string; evidence: string; matchedPattern: string }> {
  const results: Array<{ objectionLabel: string; patternCategory: string; evidence: string; matchedPattern: string }> = [];
  if (!caption || caption.length < 15) return results;

  const seenLabels = new Set<string>();

  for (const def of NARRATIVE_OBJECTION_PATTERNS) {
    if (seenLabels.has(def.objectionLabel)) continue;

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

export function extractNarrativeObjections(competitors: CompetitorInput[]): NarrativeObjectionMap {
  const objectionAgg = new Map<string, {
    patternCategory: string;
    hitCount: number;
    evidence: Array<{ caption: string; competitorName: string; matchedPattern: string }>;
    competitorNames: Set<string>;
  }>();

  let captionsScanned = 0;

  for (const comp of competitors) {
    const posts = (comp.posts || []).slice(0, 12);

    for (const post of posts) {
      const caption = (post.caption || "").trim();
      if (caption.length < 15) continue;
      captionsScanned++;

      const sentences = caption.split(/[.\n!?]/).filter(s => s.trim().length > 5);
      const hookLine = sentences[0] || "";
      const ctaLine = sentences.length > 1 ? sentences[sentences.length - 1] : "";

      const textsToScan = [caption];
      if (hookLine && hookLine !== caption) textsToScan.push(hookLine);
      if (ctaLine && ctaLine !== caption && ctaLine !== hookLine) textsToScan.push(ctaLine);

      const seenForPost = new Set<string>();
      for (const text of textsToScan) {
        const hits = extractFromCaption(text);
        for (const hit of hits) {
          if (seenForPost.has(hit.objectionLabel)) continue;
          seenForPost.add(hit.objectionLabel);

          if (!objectionAgg.has(hit.objectionLabel)) {
            objectionAgg.set(hit.objectionLabel, {
              patternCategory: hit.patternCategory,
              hitCount: 0,
              evidence: [],
              competitorNames: new Set(),
            });
          }
          const entry = objectionAgg.get(hit.objectionLabel)!;
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

  const objections: NarrativeObjectionItem[] = [];
  for (const [label, data] of objectionAgg.entries()) {
    const totalHits = data.hitCount;
    const frequencyScore = Math.min(totalHits / Math.max(captionsScanned, 1), 1.0);
    const multiCompetitorBonus = data.competitorNames.size >= 2 ? 0.2 : 0;
    const narrativeConfidence = Math.min(
      0.3 + (frequencyScore * 0.4) + multiCompetitorBonus + (Math.min(totalHits, 4) * 0.05),
      1.0,
    );

    objections.push({
      objection: label,
      frequencyScore: Math.round(frequencyScore * 1000) / 1000,
      narrativeConfidence: Math.round(narrativeConfidence * 1000) / 1000,
      supportingEvidence: data.evidence,
      competitorSources: Array.from(data.competitorNames),
      patternCategory: data.patternCategory,
    });
  }

  objections.sort((a, b) => b.narrativeConfidence - a.narrativeConfidence || b.frequencyScore - a.frequencyScore);

  const objectionsFromMultiple = objections.filter(o => o.competitorSources.length >= 2).length;
  const objectionDensity = captionsScanned > 0
    ? Math.round((objections.reduce((s, o) => s + o.frequencyScore, 0) / Math.max(objections.length, 1)) * 1000) / 1000
    : 0;

  return {
    objections,
    totalObjectionsDetected: objections.length,
    objectionsFromMultipleCompetitors: objectionsFromMultiple,
    objectionDensity,
    captionsScanned,
    extractionTimestamp: new Date().toISOString(),
  };
}
