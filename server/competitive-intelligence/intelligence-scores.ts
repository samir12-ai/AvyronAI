import type { ProfileAnalysisResult } from "./profile-analyzer";
import type { CreativeCaptureResult } from "./creative-capture";

export interface ConversionIntelligence {
  cta_presence_score: number;
  offer_clarity_score: number;
  funnel_visibility_score: number;
  conversion_path_completeness: number;
  conversion_style: "direct" | "soft" | "none";
}

export interface NarrativeIntelligence {
  narrative_arc_detected: boolean;
  emotional_intensity_score: number;
  identity_targeting_strength: number;
  persuasion_style: "story" | "educational" | "proof-led" | "status-led" | "hybrid";
  narrative_dominance_index: number;
}

export interface PerformanceContext {
  share_velocity_index: number;
  save_ratio_index: number;
  engagement_quality_score: number;
  dominant_format: string;
}

export type MarketArchetype =
  | "Authority Builder"
  | "Conversion Closer"
  | "Viral Educator"
  | "Silent Premium"
  | "Trend Rider";

export type DominanceLevel =
  | "WEAK"
  | "EXPOSED"
  | "EFFICIENT"
  | "STRUCTURALLY_STRONG"
  | "DOMINANT";

export interface DominanceState {
  dominance_score: number;
  dominance_state: DominanceLevel;
}

export interface IntelligenceScores {
  conversion_intelligence: ConversionIntelligence;
  narrative_intelligence: NarrativeIntelligence;
  performance_context: PerformanceContext;
  archetype: MarketArchetype;
  dominance: DominanceState;
}

const EMOTIONAL_KEYWORDS_EN = /\b(transform|dream|imagine|believe|feel|love|hate|fear|excited|amazing|incredible|inspire|passion|struggle|overcome|journey|powerful|beautiful|heartbreak|proud|grateful|obsessed|mindblowing|life.?changing|game.?changer)\b/gi;
const EMOTIONAL_KEYWORDS_AR = /(حلم|تحول|شغف|حب|خوف|فخر|رحلة|إلهام|قوة|جمال|تحدي|نجاح|إنجاز|مذهل|رائع)/g;

const STORY_MARKERS = /\b(once|when\s+i|story|chapter|started|began|remember|back\s+in|years?\s+ago|that\s+day|one\s+day|my\s+journey)\b/gi;
const EDUCATIONAL_MARKERS = /\b(tip|hack|how\s+to|step|guide|learn|mistake|lesson|strategy|framework|method|system|secret|tutorial|explained)\b/gi;
const PROOF_MARKERS = /\b(results?|before\s+and\s+after|case\s+study|testimonial|review|client|proof|roi|revenue|growth|numbers?|data|stats?)\b/gi;
const STATUS_MARKERS = /\b(exclusive|luxury|premium|elite|vip|high.?end|bespoke|limited\s+edition|first\s+class|world.?class|top\s+tier)\b/gi;
const IDENTITY_MARKERS = /\b(you\s+are|you're|for\s+(those|people|anyone)|if\s+you|your\s+type|built\s+for|designed\s+for|made\s+for|entrepreneurs?|founders?|creators?|leaders?|professionals?)\b/gi;

function clamp(val: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(val)));
}

function countMatches(text: string, pattern: RegExp): number {
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
}

export function computeConversionIntelligence(
  creativeCapture: CreativeCaptureResult[] | null,
  inferred: ProfileAnalysisResult["inferred"]
): ConversionIntelligence {
  let totalCtaHits = 0;
  let totalOfferHits = 0;
  let totalReels = 0;
  let sourceDiversity = 0;

  if (creativeCapture && creativeCapture.length > 0) {
    totalReels = creativeCapture.length;
    const ctaSources = new Set<string>();
    for (const cc of creativeCapture) {
      totalCtaHits += cc.interpreted.ctaSignals.length;
      totalOfferHits += cc.interpreted.offerSignals.length;
      for (const sig of cc.interpreted.ctaSignals) ctaSources.add(sig.source);
    }
    sourceDiversity = ctaSources.size;
  }

  if (inferred?.insights) {
    const ctaInsights = inferred.insights.filter(i => i.category === "cta_pattern");
    if (ctaInsights.length > 0 && totalCtaHits === 0) totalCtaHits += ctaInsights.length * 2;
  }

  const reelDenom = Math.max(totalReels, 1);

  const cta_presence_score = clamp(
    totalCtaHits === 0 ? 0 :
    totalCtaHits >= reelDenom * 2 ? 95 :
    Math.min(95, (totalCtaHits / reelDenom) * 60 + sourceDiversity * 10)
  );

  const offer_clarity_score = clamp(
    totalOfferHits === 0 ? 0 :
    totalOfferHits >= reelDenom ? 90 :
    (totalOfferHits / reelDenom) * 70
  );

  const funnel_visibility_score = clamp(
    (cta_presence_score > 0 && offer_clarity_score > 0) ? Math.round((cta_presence_score + offer_clarity_score) / 2 * 0.9) :
    cta_presence_score > 0 ? Math.round(cta_presence_score * 0.5) :
    0
  );

  const conversion_path_completeness = clamp(
    (cta_presence_score > 0 && offer_clarity_score > 0)
      ? Math.round(cta_presence_score * 0.4 + offer_clarity_score * 0.3 + funnel_visibility_score * 0.3)
      : cta_presence_score > 0
        ? Math.round(cta_presence_score * 0.4)
        : 0
  );

  const conversion_style: ConversionIntelligence["conversion_style"] =
    totalCtaHits === 0 ? "none" :
    (totalCtaHits >= reelDenom && totalOfferHits > 0) ? "direct" :
    "soft";

  return {
    cta_presence_score,
    offer_clarity_score,
    funnel_visibility_score,
    conversion_path_completeness,
    conversion_style,
  };
}

export function computeNarrativeIntelligence(
  creativeCapture: CreativeCaptureResult[] | null,
  inferred: ProfileAnalysisResult["inferred"]
): NarrativeIntelligence {
  let allText = "";

  if (creativeCapture) {
    for (const cc of creativeCapture) {
      if (cc.evidencePack.fullCaption) allText += " " + cc.evidencePack.fullCaption;
      if (cc.evidencePack.ocrFullText) allText += " " + cc.evidencePack.ocrFullText;
      if (cc.evidencePack.transcript) allText += " " + cc.evidencePack.transcript;
      if (cc.evidencePack.pinnedCommentText) allText += " " + cc.evidencePack.pinnedCommentText;
    }
  }

  if (inferred?.sampledReels) {
    for (const r of inferred.sampledReels) {
      if (r.caption) allText += " " + r.caption;
    }
  }

  if (inferred?.insights) {
    for (const ins of inferred.insights) {
      allText += " " + ins.finding;
    }
  }

  const emotionalHitsEN = countMatches(allText, EMOTIONAL_KEYWORDS_EN);
  const emotionalHitsAR = countMatches(allText, EMOTIONAL_KEYWORDS_AR);
  const totalEmotional = emotionalHitsEN + emotionalHitsAR;

  const storyHits = countMatches(allText, STORY_MARKERS);
  const eduHits = countMatches(allText, EDUCATIONAL_MARKERS);
  const proofHits = countMatches(allText, PROOF_MARKERS);
  const statusHits = countMatches(allText, STATUS_MARKERS);
  const identityHits = countMatches(allText, IDENTITY_MARKERS);

  const narrative_arc_detected = storyHits >= 2;

  const emotional_intensity_score = clamp(
    totalEmotional === 0 ? 0 :
    totalEmotional >= 10 ? 90 :
    totalEmotional * 10
  );

  const identity_targeting_strength = clamp(
    identityHits === 0 ? 0 :
    identityHits >= 6 ? 85 :
    identityHits * 15
  );

  const scores = { story: storyHits, educational: eduHits, "proof-led": proofHits, "status-led": statusHits };
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  let persuasion_style: NarrativeIntelligence["persuasion_style"];
  if (sorted[0][1] === 0) {
    persuasion_style = "hybrid";
  } else if (sorted[0][1] > 0 && sorted[1][1] > 0 && sorted[0][1] - sorted[1][1] <= 1) {
    persuasion_style = "hybrid";
  } else {
    persuasion_style = sorted[0][0] as NarrativeIntelligence["persuasion_style"];
  }

  const narrative_dominance_index = clamp(
    emotional_intensity_score * 0.3 +
    identity_targeting_strength * 0.25 +
    (narrative_arc_detected ? 20 : 0) +
    Math.min(30, (storyHits + eduHits + proofHits + statusHits) * 4)
  );

  return {
    narrative_arc_detected,
    emotional_intensity_score,
    identity_targeting_strength,
    persuasion_style,
    narrative_dominance_index,
  };
}

export function computePerformanceContext(
  measured: ProfileAnalysisResult["measured"],
  creativeCapture: CreativeCaptureResult[] | null
): PerformanceContext {
  const engRate = measured.engagement_rate?.value ?? 0;
  const engagement_quality_score = clamp(
    engRate === 0 ? 0 :
    engRate >= 8 ? 95 :
    engRate >= 5 ? 80 :
    engRate >= 3 ? 60 :
    engRate >= 1 ? 40 :
    20
  );

  const mix = measured.content_mix;
  let dominant_format = "unknown";
  if (mix) {
    if (mix.reels_ratio >= 0.6) dominant_format = "reels";
    else if (mix.static_ratio >= 0.6) dominant_format = "static";
    else dominant_format = "mixed";
  }

  let share_velocity_index = 0;
  let save_ratio_index = 0;

  if (creativeCapture && creativeCapture.length > 0) {
    let hookCount = 0;
    let proofCount = 0;
    for (const cc of creativeCapture) {
      hookCount += cc.interpreted.hookCandidates.length;
      proofCount += cc.interpreted.proofSignals.length;
    }
    share_velocity_index = clamp(hookCount > 0 ? Math.min(80, hookCount * 15 + engagement_quality_score * 0.2) : engagement_quality_score * 0.3);
    save_ratio_index = clamp(proofCount > 0 ? Math.min(75, proofCount * 12 + engagement_quality_score * 0.15) : engagement_quality_score * 0.2);
  } else {
    share_velocity_index = clamp(engagement_quality_score * 0.3);
    save_ratio_index = clamp(engagement_quality_score * 0.2);
  }

  return {
    share_velocity_index,
    save_ratio_index,
    engagement_quality_score,
    dominant_format,
  };
}

export function classifyArchetype(
  conversion: ConversionIntelligence,
  narrative: NarrativeIntelligence,
  performance: PerformanceContext
): MarketArchetype {
  const ctaHigh = conversion.cta_presence_score >= 50;
  const ctaLow = conversion.cta_presence_score < 30;
  const offerClear = conversion.offer_clarity_score >= 40;
  const narrativeHigh = narrative.narrative_dominance_index >= 50;
  const savesHigh = performance.save_ratio_index >= 40;
  const eduTone = narrative.persuasion_style === "educational";
  const proofLed = narrative.persuasion_style === "proof-led";

  if (narrativeHigh && ctaLow) return "Authority Builder";
  if (ctaHigh && offerClear) return "Conversion Closer";
  if (savesHigh && eduTone) return "Viral Educator";
  if (proofLed && ctaLow) return "Silent Premium";
  return "Trend Rider";
}

export function computeDominanceState(
  conversion: ConversionIntelligence,
  narrative: NarrativeIntelligence,
  performance: PerformanceContext,
  positioningStrengthScore?: number
): DominanceState {
  const positioning = positioningStrengthScore ?? 0;

  const dominance_score = clamp(
    0.25 * conversion.conversion_path_completeness +
    0.25 * narrative.narrative_dominance_index +
    0.25 * performance.engagement_quality_score +
    0.25 * positioning
  );

  let dominance_state: DominanceLevel;
  if (dominance_score <= 25) dominance_state = "WEAK";
  else if (dominance_score <= 50) dominance_state = "EXPOSED";
  else if (dominance_score <= 70) dominance_state = "EFFICIENT";
  else if (dominance_score <= 85) dominance_state = "STRUCTURALLY_STRONG";
  else dominance_state = "DOMINANT";

  return { dominance_score, dominance_state };
}

export function computeAllIntelligenceScores(
  result: ProfileAnalysisResult
): IntelligenceScores {
  const conversion = computeConversionIntelligence(result.creativeCapture, result.inferred);
  const narrative = computeNarrativeIntelligence(result.creativeCapture, result.inferred);
  const performance = computePerformanceContext(result.measured, result.creativeCapture);
  const archetype = classifyArchetype(conversion, narrative, performance);
  const dominance = computeDominanceState(conversion, narrative, performance);

  return {
    conversion_intelligence: conversion,
    narrative_intelligence: narrative,
    performance_context: performance,
    archetype,
    dominance,
  };
}
