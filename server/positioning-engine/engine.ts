import { db } from "../db";
import {
  positioningSnapshots,
  miSnapshots,
  audienceSnapshots,
  ciCompetitors,
} from "@shared/schema";
import { inArray, eq, and, desc } from "drizzle-orm";
import { aiChat } from "../ai-client";
import { checkForOrphanClaims, type OrphanCheckResult } from "../shared/signal-quality-gate";
import { enforceGlobalStateRefresh } from "../shared/engine-health";
import {
  POSITIONING_ENGINE_VERSION,
  POSITIONING_THRESHOLDS,
  GENERIC_TERRITORY_PATTERNS,
  BOUNDARY_BLOCKED_PATTERNS,
  BOUNDARY_HARD_PATTERNS,
  BOUNDARY_SOFT_PATTERNS,
  type PositioningStatus,
  type Territory,
  type StrategyCard,
  type MarketPowerEntry,
  type OpportunityGap,
  type StabilityResult,
  type StabilityAdvisory,
  FLANKING_STRATEGIES,
} from "./constants";
import {
  sanitizeBoundary,
  enforceBoundaryWithSanitization,
  applySoftSanitization,
  assessDataReliability,
  normalizeConfidence,
  detectGenericOutput,
  pruneOldSnapshots,
  type DataReliabilityDiagnostics,
} from "../engine-hardening";
import { verifySnapshotIntegrity } from "../market-intelligence-v3/engine-state";
import { ENGINE_VERSION as MI_ENGINE_VERSION } from "../market-intelligence-v3/constants";
import { buildFreshnessMetadata, logFreshnessTraceability } from "../shared/snapshot-trust";

interface PositioningEngineResult {
  status: PositioningStatus;
  statusMessage: string | null;
  territory: Territory | null;
  territories: Territory[];
  strategyCards: StrategyCard[];
  marketPowerAnalysis: MarketPowerEntry[];
  opportunityGaps: OpportunityGap[];
  narrativeSaturation: Record<string, number>;
  segmentPriority: { segment: string; priority: number; painAlignment: number }[];
  stabilityResult: StabilityResult;
  enemyDefinition: string;
  contrastAxis: string;
  narrativeDirection: string;
  differentiationVector: string[];
  proofSignals: string[];
  confidenceScore: number;
  inputSummary: {
    miSnapshotId: string;
    audienceSnapshotId: string;
    competitorCount: number;
    signalCount: number;
    audienceSignalCount: number;
    executionTimeMs: number;
    flankingMode: boolean;
    detectedCategory: string;
    strategicSubcategory: string | null;
    strategicSignalCount: number;
    strategicClusterCount: number;
  };
  snapshotId: string;
  executionTimeMs: number;
  createdAt: string;
}

interface CategoryResult {
  macro: string;
  subcategory: string | null;
}

function layer1_categoryDetection(miData: any, competitorCount: number = 0, signalCount: number = 0): CategoryResult {
  const marketState = miData.marketState || "";
  const diagnosis = miData.marketDiagnosis || "";
  const narrative = miData.narrativeSynthesis || "";
  const contentDna = safeJsonParse(miData.contentDnaData, []);

  const combined = `${marketState} ${diagnosis} ${narrative}`.toLowerCase();

  const categories: Record<string, string[]> = {
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
      if (combined.includes(kw)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      best = cat;
    }
  }

  let subcategory: string | null = null;
  const sufficientData = competitorCount >= 8 && signalCount >= 6;

  if (sufficientData || bestScore >= 3) {
    const subcategories: Record<string, { keywords: string[]; label: string }[]> = {
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

    const dnaText = contentDna.map((e: any) => {
      const hooks = (e.hookArchetypes || []).map((h: any) => typeof h === "string" ? h : h.type || h.name || "").join(" ");
      const frameworks = (e.narrativeFrameworks || []).map((n: any) => typeof n === "string" ? n : n.type || n.name || "").join(" ");
      const captions = (e.topCaptions || e.sampleCaptions || []).join(" ");
      return `${hooks} ${frameworks} ${captions}`;
    }).join(" ").toLowerCase();

    const enrichedText = `${combined} ${dnaText}`;

    const subOptions = subcategories[best] || [];
    let bestSub: string | null = null;
    let bestSubScore = 0;

    for (const sub of subOptions) {
      let score = 0;
      for (const kw of sub.keywords) {
        if (enrichedText.includes(kw)) score++;
      }
      if (score > bestSubScore) {
        bestSubScore = score;
        bestSub = sub.label;
      }
    }

    if (bestSubScore >= 2) {
      subcategory = bestSub;
    } else if (sufficientData) {
      const allSubs = Object.values(subcategories).flat();
      let topLabel: string | null = null;
      let topScore = 0;
      let topParent: string | null = null;
      for (const [parentCat, subs] of Object.entries(subcategories)) {
        for (const sub of subs) {
          let score = 0;
          for (const kw of sub.keywords) {
            if (enrichedText.includes(kw)) score++;
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

function layer2_marketNarrativeMap(miData: any): Record<string, string[]> {
  const narrativeMap: Record<string, string[]> = {};

  const contentDna = safeJsonParse(miData.contentDnaData, []);
  for (const entry of contentDna) {
    const compName = entry.competitorName || entry.competitor || "Unknown";
    const hooks = entry.hookArchetypes || [];
    const narratives = entry.narrativeFrameworks || [];
    narrativeMap[compName] = [
      ...hooks.map((h: any) => typeof h === "string" ? h : h.type || h.name || ""),
      ...narratives.map((n: any) => typeof n === "string" ? n : n.type || n.name || ""),
    ].filter(Boolean);
  }

  return narrativeMap;
}

function layer3_narrativeSaturationDetection(
  narrativeMap: Record<string, string[]>,
  miData?: any,
): Record<string, number> {
  const dominanceData = miData ? safeJsonParse(miData.dominanceData, []) : [];
  const authorityScores: Record<string, number> = {};
  for (const d of dominanceData) {
    const name = d.competitor || d.competitorName || "";
    if (name) {
      authorityScores[name] = Math.min(1.0, (d.dominanceScore || d.score || 0) / 100);
    }
  }

  const totalAuthorityWeight = Object.keys(narrativeMap).reduce((sum, comp) => {
    return sum + (authorityScores[comp] || 0.1);
  }, 0) || 1;

  const narrativeWeights: Record<string, number> = {};

  for (const [comp, narratives] of Object.entries(narrativeMap)) {
    const compWeight = authorityScores[comp] || 0.1;
    for (const n of narratives) {
      const key = n.toLowerCase().trim();
      if (key) {
        narrativeWeights[key] = (narrativeWeights[key] || 0) + compWeight;
      }
    }
  }

  const saturation: Record<string, number> = {};
  for (const [narrative, weight] of Object.entries(narrativeWeights)) {
    saturation[narrative] = Math.min(1.0, weight / totalAuthorityWeight);
  }
  return saturation;
}

function layer4_trustGapDetection(audienceData: any): { trustGaps: string[]; trustGapScore: number } {
  const objections = safeJsonParse(audienceData.objectionMap, []);
  const awareness = safeJsonParse(audienceData.awarenessLevel, {});

  const trustGaps: string[] = [];
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

function layer5_segmentPriorityResolution(audienceData: any): { segment: string; priority: number; painAlignment: number }[] {
  const segments = safeJsonParse(audienceData.audienceSegments, []);
  const density = safeJsonParse(audienceData.segmentDensity, []);
  const pains = safeJsonParse(audienceData.audiencePains, []);

  return segments.map((seg: any, i: number) => {
    const densityItem = density.find((d: any) => d.segment === seg.name);
    const densityScore = densityItem?.densityScore || 0;

    let painAlignment = 0;
    if (seg.painProfile && pains.length > 0) {
      const matchedPains = seg.painProfile.filter((p: string) =>
        pains.some((pain: any) => pain.canonical.toLowerCase().includes(p.toLowerCase()))
      );
      painAlignment = seg.painProfile.length > 0 ? matchedPains.length / seg.painProfile.length : 0;
    }

    return {
      segment: seg.name,
      priority: densityScore,
      painAlignment: Math.round(painAlignment * 100) / 100,
    };
  }).sort((a: any, b: any) => b.priority - a.priority);
}

function layer6_marketPowerAnalysis(miData: any, competitors: any[]): {
  entries: MarketPowerEntry[];
  authorityGap: number;
  flankingMode: boolean;
} {
  const dominanceData = safeJsonParse(miData.dominanceData, []);
  const contentDna = safeJsonParse(miData.contentDnaData, []);

  const entries: MarketPowerEntry[] = [];

  for (const comp of competitors) {
    const domEntry = dominanceData.find((d: any) =>
      d.competitor === comp.name || d.competitorName === comp.name
    );
    const dnaEntry = contentDna.find((d: any) =>
      d.competitor === comp.name || d.competitorName === comp.name
    );

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

  const flankingMode =
    authorityGap >= POSITIONING_THRESHOLDS.AUTHORITY_GAP_FLANKING_THRESHOLD ||
    categoryControlIndex >= 0.70 ||
    multiSignalDominance;

  return { entries, authorityGap, flankingMode };
}

export function computeSpecificityScore(territory: string, category: string): number {
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
  } else if (tokens.length === 2) {
    penalty = Math.max(penalty, 0.10);
  }

  const categoryTokens = category.toLowerCase().split(/\s+/);
  const hasCategoryContext = tokens.some(t => categoryTokens.some(ct => t === ct || (t.length >= 4 && ct.length >= 4 && (t.includes(ct) || ct.includes(t)))));
  const categoryBonus = hasCategoryContext ? 0.10 : 0;

  const hasContrast = lower.includes(" vs ") || lower.includes(" versus ") || lower.includes(" over ") ||
    lower.includes("-driven") || lower.includes("-backed") || lower.includes("-focused");
  const contrastBonus = hasContrast ? 0.15 : 0;

  const lengthBonus = tokens.length >= 4 ? 0.05 : 0;
  return Math.max(0, Math.min(1.15, 1 - penalty + categoryBonus + contrastBonus + lengthBonus));
}

export function validateNarrativeOutput(text: string): { valid: boolean; reason?: string } {
  if (!text || typeof text !== "string") return { valid: false, reason: "Empty or non-string input" };
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

export function computeSemanticSaturation(
  territory: string,
  narrativeMap: Record<string, string[]>,
  contentDna: any[],
  competitorCount: number,
): number {
  const tLower = territory.toLowerCase();
  const tTokens = new Set(tLower.split(/\s+/).filter(t => t.length > 2));
  if (tTokens.size === 0) return 0;

  let matchSignals = 0;
  let totalSignals = 0;

  for (const narratives of Object.values(narrativeMap)) {
    for (const n of narratives) {
      totalSignals++;
      const nTokens = new Set(n.toLowerCase().split(/\s+/));
      let overlap = 0;
      for (const t of tTokens) {
        for (const nt of nTokens) {
          if (t.includes(nt) || nt.includes(t)) { overlap++; break; }
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
      const fwTokens = new Set(fwLower.split(/\s+/).filter((t: string) => t.length > 2));
      let fwOverlap = 0;
      for (const t of tTokens) {
        for (const ft of fwTokens) {
          if (t.includes(ft) || ft.includes(t)) { fwOverlap++; break; }
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
        if (cLower.includes(t)) tokenOverlap++;
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
          if (ctaText.includes(t)) ctaOverlap++;
        }
        if (ctaOverlap / tTokens.size >= 0.3) matchSignals++;
      }
    }
  }

  const semanticRatio = totalSignals > 0 ? matchSignals / totalSignals : 0;

  const floor = Math.min(0.15, competitorCount * POSITIONING_THRESHOLDS.MIN_SATURATION_FLOOR_PER_COMPETITOR);

  return Math.max(floor, Math.min(1.0, semanticRatio));
}

export function checkCrossCampaignDiversity(
  territories: { name: string; opportunityScore: number }[],
  recentTerritoryNames: string[],
): { name: string; penalty: number }[] {
  const penalties: { name: string; penalty: number }[] = [];

  for (const territory of territories) {
    const tTokens = new Set(territory.name.toLowerCase().split(/\s+/).filter(Boolean));
    let maxSimilarity = 0;

    for (const recent of recentTerritoryNames) {
      const rTokens = new Set(recent.toLowerCase().split(/\s+/).filter(Boolean));
      let overlap = 0;
      for (const t of tTokens) {
        if (rTokens.has(t)) overlap++;
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

const STRATEGIC_SIGNAL_PATTERNS: { pattern: RegExp; signal: string; cluster: string }[] = [
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

function extractStrategicSignals(miData: any): { signal: string; cluster: string; source: string }[] {
  const signals: { signal: string; cluster: string; source: string }[] = [];
  const seen = new Set<string>();

  const textSources: { text: string; source: string }[] = [];

  const marketState = miData.marketState || "";
  const diagnosis = miData.marketDiagnosis || "";
  const narrative = miData.narrativeSynthesis || "";
  if (marketState) textSources.push({ text: marketState, source: "market_intelligence" });
  if (diagnosis) textSources.push({ text: diagnosis, source: "market_intelligence" });
  if (narrative) textSources.push({ text: narrative, source: "market_intelligence" });

  const contentDna = safeJsonParse(miData.contentDnaData, []);
  for (const entry of contentDna) {
    const hooks = (entry.hookArchetypes || []).map((h: any) => typeof h === "string" ? h : h.type || h.name || "");
    const frameworks = (entry.narrativeFrameworks || []).map((n: any) => typeof n === "string" ? n : n.type || n.name || "");
    const captions = entry.topCaptions || entry.sampleCaptions || [];
    const ctas = (entry.ctaPatterns || []).map((c: any) => typeof c === "string" ? c : c.pattern || "");
    for (const t of [...hooks, ...frameworks, ...captions, ...ctas]) {
      if (t) textSources.push({ text: t, source: "competitor_content" });
    }
  }

  const dominanceData = safeJsonParse(miData.dominanceData, []);
  for (const d of dominanceData) {
    if (d.contentThemes) textSources.push({ text: JSON.stringify(d.contentThemes), source: "competitor_positioning" });
    if (d.narrativeStyle) textSources.push({ text: d.narrativeStyle, source: "competitor_positioning" });
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

function extractAudienceStrategicSignals(audienceData: any): { signal: string; cluster: string; source: string }[] {
  const signals: { signal: string; cluster: string; source: string }[] = [];
  const seen = new Set<string>();

  const pains = safeJsonParse(audienceData.audiencePains, []);
  const desires = safeJsonParse(audienceData.desireMap, []);
  const objections = safeJsonParse(audienceData.objectionMap, []);

  const audienceTexts: string[] = [];
  for (const p of pains) { if (p.canonical) audienceTexts.push(p.canonical); }
  for (const d of desires) { if (d.canonical) audienceTexts.push(d.canonical); }
  for (const o of objections) { if (o.canonical) audienceTexts.push(o.canonical); }

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

interface EvidenceDensityResult {
  uniqueClusterCount: number;
  crossSourceCount: number;
  hasRedundancy: boolean;
  densityScore: number;
  confidencePenalty: number;
}

function validateTerritoryEvidenceDensity(
  territory: Territory,
  miSignals: { signal: string; cluster: string; source: string }[],
  audienceSignals: { signal: string; cluster: string; source: string }[],
): EvidenceDensityResult {
  const allSignals = [...miSignals, ...audienceSignals];

  const territoryTokens = new Set(territory.name.toLowerCase().split(/\s+/).filter(t => t.length > 2));
  const evidenceTokens = new Set(
    [...territory.painAlignment, ...territory.desireAlignment, ...territory.evidenceSignals]
      .map(s => s.toLowerCase())
  );

  const relevantSignals = allSignals.filter(s => {
    const signalTokens = s.signal.replace(/_/g, " ").toLowerCase().split(/\s+/);
    const clusterTokens = s.cluster.replace(/_/g, " ").toLowerCase().split(/\s+/);
    for (const t of territoryTokens) {
      for (const st of [...signalTokens, ...clusterTokens]) {
        if (t.includes(st) || st.includes(t)) return true;
      }
    }
    for (const e of evidenceTokens) {
      for (const st of [...signalTokens, ...clusterTokens]) {
        if (e.includes(st) || st.includes(e)) return true;
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
      for (const t of a) { if (b.has(t)) overlap++; }
      const union = new Set([...a, ...b]).size;
      if (union > 0 && overlap / union >= 0.6) redundantPairs++;
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

function layer7_opportunityGapDetection(
  narrativeSaturation: Record<string, number>,
  audienceData: any,
  marketPower: MarketPowerEntry[],
  category: string = "general",
  narrativeMap: Record<string, string[]> = {},
  contentDna: any[] = [],
  competitionIntensityScore: number = 0,
): OpportunityGap[] {
  const pains = safeJsonParse(audienceData.audiencePains, []);
  const desires = safeJsonParse(audienceData.desireMap, []);
  const competitorCount = Object.keys(narrativeMap).length || marketPower.length;

  const painTerritories = pains.slice(0, 8).map((p: any) => ({
    name: p.canonical,
    demand: Math.min(1.0, p.frequency / 20),
    signals: p.evidence || [],
    type: "pain" as const,
  }));

  const desireTerritories = desires.slice(0, 8).map((d: any) => ({
    name: d.canonical,
    demand: Math.min(1.0, d.frequency / 20),
    signals: d.evidence || [],
    type: "desire" as const,
  }));

  const allTerritories = [...painTerritories, ...desireTerritories];
  const avgCompAuthority = marketPower.length > 0
    ? marketPower.reduce((s, e) => s + e.authorityScore, 0) / marketPower.length
    : 0;

  const opportunities: OpportunityGap[] = allTerritories.map(t => {
    const baseSatLevel = narrativeSaturation[t.name.toLowerCase()] || 0;
    const semanticSat = computeSemanticSaturation(t.name, narrativeMap, contentDna, competitorCount);
    const satLevel = Math.max(baseSatLevel, semanticSat);
    const compAuth = avgCompAuthority;

    const specificity = computeSpecificityScore(t.name, category);

    const intensityPenalty = competitionIntensityScore >= 0.45
      ? Math.min(0.10, competitionIntensityScore * 0.15)
      : 0;
    const opportunityScore =
      (1 - satLevel) * 0.40 +
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

function layer8_differentiationAxisConstruction(
  opportunities: OpportunityGap[],
  trustGaps: string[],
  flankingMode: boolean,
): string[] {
  const axes: string[] = [];

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
    if (topOpp.saturationLevel < 0.3) axes.push("whitespace_positioning");
    if (topOpp.audienceDemand > 0.7) axes.push("demand_driven_authority");
  }

  return [...new Set(axes)].slice(0, 5);
}

function layer9_narrativeDistanceScoring(
  territory: string,
  narrativeMap: Record<string, string[]>,
): number {
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
        } else {
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
      if (distance < minDistance) minDistance = distance;

      const keywordOverlap = territoryTokens.size > 0 ? totalOverlap / territoryTokens.size : 0;
      maxKeywordOverlap = Math.max(maxKeywordOverlap, keywordOverlap);
    }
  }

  if (maxKeywordOverlap > POSITIONING_THRESHOLDS.KEYWORD_OVERLAP_DISTANCE_CAP_THRESHOLD) {
    minDistance = Math.min(minDistance, POSITIONING_THRESHOLDS.NARRATIVE_DISTANCE_MAX_WITH_OVERLAP);
  }

  return Math.round(minDistance * 100) / 100;
}

function layer10_strategicTerritorySelection(
  opportunities: OpportunityGap[],
  narrativeMap: Record<string, string[]>,
  narrativeSaturation: Record<string, number>,
  marketPower: MarketPowerEntry[],
  differentiationAxes: string[],
  segmentPriority: { segment: string; priority: number; painAlignment: number }[],
  trustGaps: string[],
  flankingMode: boolean,
): Territory[] {
  const topSegments = segmentPriority.slice(0, 2);

  const rawTerritories: Territory[] = opportunities.slice(0, 8).map(opp => {
    const narrativeDistance = layer9_narrativeDistanceScoring(opp.territory, narrativeMap);

    const painAlignment = opp.painSignals.length > 0 ? opp.painSignals : [];
    const desireAlignment = opp.desireSignals.length > 0 ? opp.desireSignals : [];

    let enemyDefinition = "The status quo";
    if (opp.saturationLevel > 0.5) {
      enemyDefinition = "Oversaturated generic advice";
    } else if (flankingMode) {
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
    if (sat >= POSITIONING_THRESHOLDS.DOMINANT_COMPETITOR_THRESHOLD) return false;
    return true;
  });

  const sorted = filtered.sort((a, b) => b.opportunityScore - a.opportunityScore);

  if (sorted.length > POSITIONING_THRESHOLDS.MAX_TERRITORIES) {
    return sorted.slice(0, POSITIONING_THRESHOLDS.MAX_TERRITORIES);
  }

  return sorted;
}

function deduplicateTerritories(territories: Territory[]): Territory[] {
  const result: Territory[] = [];

  for (const t of territories) {
    let isDuplicate = false;
    for (const existing of result) {
      const tokens1 = new Set(t.name.toLowerCase().split(/\s+/));
      const tokens2 = new Set(existing.name.toLowerCase().split(/\s+/));
      let overlap = 0;
      for (const tok of tokens1) {
        if (tokens2.has(tok)) overlap++;
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

async function layer11_positioningStatementGeneration(
  territories: Territory[],
  category: string,
  segmentPriority: { segment: string; priority: number }[],
  accountId: string,
): Promise<Territory[]> {
  if (territories.length === 0) return territories;

  try {
    const topSegment = segmentPriority[0]?.segment || "target audience";

    const prompt = `You are a strategic positioning analyst. Generate precise positioning statements for each territory.

MARKET CATEGORY: ${category}
PRIMARY AUDIENCE SEGMENT: ${topSegment}

TERRITORIES:
${territories.map((t, i) => `${i + 1}. "${t.name}" (opportunity: ${t.opportunityScore}, distance: ${t.narrativeDistanceScore})
   Pain alignment: ${t.painAlignment.join(", ") || "general"}
   Enemy: ${t.enemyDefinition}
   Contrast axis: ${t.contrastAxis}`).join("\n\n")}

For each territory, return a JSON array with objects containing:
{
  "index": number,
  "enemyDefinition": "precise enemy statement",
  "narrativeDirection": "one-sentence positioning narrative",
  "contrastAxis": "clear contrast axis statement"
}

Keep statements concise, strategic, and evidence-grounded. Return ONLY the JSON array.`;

    const response = await aiChat({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 1500,
      endpoint: "positioning-engine-v3-statements",
      accountId,
    });

    const content = response.choices[0]?.message?.content?.trim() || "[]";
    const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned) as any[];

    for (const item of parsed) {
      const idx = (item.index || 1) - 1;
      if (idx >= 0 && idx < territories.length) {
        if (item.enemyDefinition && validateNarrativeOutput(item.enemyDefinition).valid) {
          territories[idx].enemyDefinition = item.enemyDefinition;
        }
        if (item.narrativeDirection && validateNarrativeOutput(item.narrativeDirection).valid) {
          territories[idx].narrativeDirection = item.narrativeDirection;
        }
        if (item.contrastAxis && validateNarrativeOutput(item.contrastAxis).valid) {
          territories[idx].contrastAxis = item.contrastAxis;
        }
      }
    }
  } catch (err: any) {
    console.error("[PositioningEngine-V3] Statement generation failed:", err.message);
  }

  return territories;
}

function layer12_stabilityGuard(
  territories: Territory[],
  narrativeSaturation: Record<string, number>,
  marketPower: MarketPowerEntry[],
  segmentPriority: { segment: string; priority: number; painAlignment: number }[],
  narrativeMap?: Record<string, string[]>,
  competitorCount: number = 0,
  signalCount: number = 0,
): { territories: Territory[]; stabilityResult: StabilityResult } {
  const checks: StabilityResult["checks"] = [];
  const advisories: StabilityAdvisory[] = [];
  let fallbackApplied = false;
  let fallbackReason: string | undefined;

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
    const territoryChecks: { passed: boolean; reason: string }[] = [];

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

function generateStrategyCards(territories: Territory[]): StrategyCard[] {
  return territories.map((t, i) => ({
    territoryName: t.name,
    enemyDefinition: t.enemyDefinition,
    narrativeDirection: t.narrativeDirection,
    evidenceSignals: t.evidenceSignals,
    confidenceScore: t.confidenceScore,
    isPrimary: i === 0,
  }));
}

function safeJsonParse(data: string | null | undefined, fallback: any): any {
  if (!data) return fallback;
  try {
    return JSON.parse(data);
  } catch {
    return fallback;
  }
}

export async function runPositioningEngine(
  accountId: string,
  campaignId: string,
  miSnapshotId: string,
  audienceSnapshotId: string,
): Promise<PositioningEngineResult> {
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
      .where(and(
        eq(miSnapshots.campaignId, campaignId),
        eq(miSnapshots.accountId, accountId),
        inArray(miSnapshots.status, ["COMPLETE", "PARTIAL"]),
        eq(miSnapshots.analysisVersion, MI_ENGINE_VERSION),
      ))
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
    return buildEmptyResult(
      "MISSING_DEPENDENCY",
      miFreshnessMetadata.warning || `MI data freshness check failed (${miFreshnessMetadata.freshnessClass}). Re-run Market Intelligence.`,
      executionTimeMs, miSnapshotId, audienceSnapshotId,
    );
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

  if (totalSignals < POSITIONING_THRESHOLDS.MIN_AUDIENCE_SIGNALS) {
    const executionTimeMs = Date.now() - startTime;
    return buildEmptyResult("INSUFFICIENT_SIGNALS", `Insufficient audience signals (${totalSignals}) for positioning — need ≥${POSITIONING_THRESHOLDS.MIN_AUDIENCE_SIGNALS}`, executionTimeMs, miSnapshotId, audienceSnapshotId);
  }

  const miConfidenceRaw = (activeMiSnapshot as any).confidenceScore ?? (activeMiSnapshot as any).overallConfidence ?? 0;
  const dataReliability = assessDataReliability(
    competitors.length,
    totalSignals,
    !!activeMiSnapshot.marketDiagnosis,
    true,
    audiencePains.length > 0,
    typeof miConfidenceRaw === "number" ? miConfidenceRaw : 0,
  );
  if (dataReliability.isWeak) {
    console.log(`[PositioningEngine-V3] WEAK_DATA | reliability=${dataReliability.overallReliability.toFixed(2)} | advisories=${dataReliability.advisories.length}`);
  }

  console.log(`[PositioningEngine-V3] Starting 12-layer analysis | MI=${miSnapshotId} | Audience=${audienceSnapshotId} | Competitors=${competitors.length}`);

  const categoryResult = layer1_categoryDetection(activeMiSnapshot, competitors.length, totalSignals);
  const category = categoryResult.macro;
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
  const opportunityGaps = layer7_opportunityGapDetection(narrativeSaturation, audienceSnapshot, marketPower, category, narrativeMap, contentDna, competitionIntensityFromMI);
  console.log(`[PositioningEngine-V3] L7 Opportunities: ${opportunityGaps.length} viable territories`);

  const differentiationAxes = layer8_differentiationAxisConstruction(opportunityGaps, trustGaps, flankingMode);
  console.log(`[PositioningEngine-V3] L8 Differentiation: ${differentiationAxes.join(", ")}`);

  const miStrategicSignals = extractStrategicSignals(activeMiSnapshot);
  const audienceStrategicSignals = extractAudienceStrategicSignals(audienceSnapshot);
  const allStrategicSignals = [...miStrategicSignals, ...audienceStrategicSignals];
  const strategicClusters = new Set(allStrategicSignals.map(s => s.cluster));
  console.log(`[PositioningEngine-V3] Signal extraction: ${allStrategicSignals.length} strategic signals across ${strategicClusters.size} clusters`);

  let territories = layer10_strategicTerritorySelection(
    opportunityGaps, narrativeMap, narrativeSaturation,
    marketPower, differentiationAxes, segmentPriority, trustGaps, flankingMode,
  );
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
      .where(and(
        eq(positioningSnapshots.accountId, accountId),
      ))
      .orderBy(desc(positioningSnapshots.createdAt))
      .limit(20);

    const recentTerritoryNames: string[] = [];
    for (const snap of recentSnapshots) {
      const summary = safeJsonParse(snap.inputSummary, {});
      if (summary.detectedCategory && summary.detectedCategory !== category) continue;
      const parsedTerritories = safeJsonParse(snap.territories, []);
      for (const t of parsedTerritories) {
        if (t.name) recentTerritoryNames.push(t.name);
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
  } catch (err: any) {
    console.warn(`[PositioningEngine-V3] Cross-campaign diversity check skipped: ${err.message}`);
  }

  territories = await layer11_positioningStatementGeneration(territories, category, segmentPriority, accountId);
  console.log(`[PositioningEngine-V3] L11 Statements generated`);

  const boundaryText = territories.map(t =>
    `${t.name} ${t.enemyDefinition} ${t.contrastAxis} ${t.narrativeDirection} ${t.evidenceSignals?.join(" ") || ""}`
  ).join(" ");
  const boundaryCheck = enforceBoundaryWithSanitization(boundaryText, BOUNDARY_HARD_PATTERNS, BOUNDARY_SOFT_PATTERNS);
  if (!boundaryCheck.clean) {
    console.error(`[PositioningEngine-V3] BOUNDARY VIOLATION: ${boundaryCheck.violations.join("; ")}`);
    const executionTimeMs = Date.now() - startTime;
    return {
      ...buildEmptyResult("INTEGRITY_FAILED" as PositioningStatus, `Boundary enforcement failed: ${boundaryCheck.violations.join("; ")}`, executionTimeMs, miSnapshotId, audienceSnapshotId),
      confidenceScore: 0,
    };
  }
  if (boundaryCheck.sanitized && boundaryCheck.warnings.length > 0) {
    for (const warning of boundaryCheck.warnings) {
      console.log(`[PositioningEngine-V3] BOUNDARY WARNING: ${warning}`);
    }
    for (const t of territories) {
      t.name = applySoftSanitization(t.name, BOUNDARY_SOFT_PATTERNS);
      t.enemyDefinition = applySoftSanitization(t.enemyDefinition, BOUNDARY_SOFT_PATTERNS);
      t.contrastAxis = applySoftSanitization(t.contrastAxis, BOUNDARY_SOFT_PATTERNS);
      t.narrativeDirection = applySoftSanitization(t.narrativeDirection, BOUNDARY_SOFT_PATTERNS);
      if (t.evidenceSignals) {
        t.evidenceSignals = t.evidenceSignals.map((s: string) => applySoftSanitization(s, BOUNDARY_SOFT_PATTERNS));
      }
    }
  }

  const { territories: finalTerritories, stabilityResult } = layer12_stabilityGuard(
    territories, narrativeSaturation, marketPower, segmentPriority, narrativeMap,
    competitors.length, totalSignals,
  );
  const advisoryCount = stabilityResult.advisories.length;
  console.log(`[PositioningEngine-V3] L12 Stability: ${stabilityResult.isStable ? "STABLE" : "UNSTABLE"} | fallback=${stabilityResult.fallbackApplied} | advisories=${advisoryCount}`);
  if (advisoryCount > 0) {
    for (const adv of stabilityResult.advisories) {
      console.log(`[PositioningEngine-V3] ADVISORY: ${adv.message}`);
    }
  }

  const strategyCards = generateStrategyCards(finalTerritories);

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
    rejectedSignals: [] as any[],
    deduplicatedCount: 0,
    crossValidatedCount: allStrategicSignals.length,
    averageQuality: 1,
    gatePass: allStrategicSignals.length >= 3,
    gateSummary: "",
  };

  let totalOrphanedClaims = 0;
  let totalTracedClaims = 0;
  for (const territory of finalTerritories) {
    const claims = [territory.name, territory.enemyDefinition, territory.contrastAxis, territory.narrativeDirection].filter(Boolean);
    const orphanResult = checkForOrphanClaims(claims, strategicSignalGate);

    totalOrphanedClaims += orphanResult.orphanedClaims.length;
    totalTracedClaims += orphanResult.tracedClaims;

    if (orphanResult.orphanedClaims.length > 0) {
      for (const orphan of orphanResult.orphanedClaims) {
        if (!territory.stabilityNotes) territory.stabilityNotes = [];
        territory.stabilityNotes.push(`[HYPOTHESIS] Claim not directly traceable to MIv3 signal: "${orphan.slice(0, 80)}"`);
      }
      territory.confidenceScore = Math.max(0, territory.confidenceScore - (orphanResult.orphanedClaims.length * 0.05));
    }
  }
  if (totalOrphanedClaims > 0) {
    console.log(`[PositioningEngine-V3] ORPHAN_AUDIT | orphaned=${totalOrphanedClaims} | traced=${totalTracedClaims} | territories=${finalTerritories.length} — orphaned claims flagged as [HYPOTHESIS]`);
  } else {
    console.log(`[PositioningEngine-V3] ORPHAN_AUDIT | ZERO_ORPHANS | all ${totalTracedClaims} claims traceable to MIv3 signals`);
  }

  const primaryTerritory = finalTerritories[0] || null;
  const executionTimeMs = Date.now() - startTime;

  const allPositioningText = finalTerritories.map(t => [
    t.name, t.enemyDefinition || "", t.narrativeDirection || "", t.contrastAxis || "",
    ...(t.evidenceSignals || []),
  ].join(" ")).join(" ");
  const genericOutputCheck = detectGenericOutput(allPositioningText);
  if (genericOutputCheck.genericDetected) {
    for (const territory of finalTerritories) {
      territory.confidenceScore = Math.max(0, territory.confidenceScore - genericOutputCheck.penalty);
    }
    console.log(`[PositioningEngine-V3] GENERIC_OUTPUT_PENALTY | phrases=${genericOutputCheck.genericPhrases.length} | penalty=${genericOutputCheck.penalty.toFixed(2)}`);
  }

  const rawConfidence = primaryTerritory
    ? Math.round(primaryTerritory.confidenceScore * 100) / 100
    : 0;
  const overallConfidence = normalizeConfidence(rawConfidence, dataReliability);
  const confidenceNormalized = rawConfidence !== overallConfidence;

  const status: PositioningStatus = !stabilityResult.isStable ? "UNSTABLE" : "COMPLETE";
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
    executionTimeMs,
  }).returning({ id: positioningSnapshots.id });

  await pruneOldSnapshots(db, positioningSnapshots, campaignId, 20, accountId);

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
  };
}

function buildEmptyResult(
  status: PositioningStatus,
  message: string,
  executionTimeMs: number,
  miSnapshotId: string,
  audienceSnapshotId: string,
): PositioningEngineResult {
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

export async function getLatestPositioningSnapshot(accountId: string, campaignId: string) {
  const [snapshot] = await db.select().from(positioningSnapshots)
    .where(and(
      eq(positioningSnapshots.accountId, accountId),
      eq(positioningSnapshots.campaignId, campaignId),
      eq(positioningSnapshots.engineVersion, POSITIONING_ENGINE_VERSION),
    ))
    .orderBy(desc(positioningSnapshots.createdAt))
    .limit(1);

  if (!snapshot) return null;

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
  };
}

export {
  layer1_categoryDetection,
  layer2_marketNarrativeMap,
  layer3_narrativeSaturationDetection,
  layer4_trustGapDetection,
  layer5_segmentPriorityResolution,
  layer6_marketPowerAnalysis,
  layer7_opportunityGapDetection,
  layer8_differentiationAxisConstruction,
  layer9_narrativeDistanceScoring,
  layer10_strategicTerritorySelection,
  layer12_stabilityGuard,
  deduplicateTerritories,
  generateStrategyCards,
};
