import type { CommentData, EngagementQuality } from "./types";
import { MI_DEMAND_PRESSURE } from "./constants";

export interface DemandPressureComponents {
  engagementDensity: number;
  commentIntensity: number;
  intentSignalStrength: number;
  objectionDensity: number;
  purchaseIntentDensity: number;
}

export type DemandPressureLevel = "HIGH" | "MODERATE" | "LOW";

export interface DemandPressureResult {
  score: number;
  level: DemandPressureLevel;
  components: DemandPressureComponents;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

const PURCHASE_INTENT_PATTERNS = [
  /where\s+(can|do)\s+i\s+(buy|get|order|sign\s*up)/i,
  /how\s+(to|do\s+i)\s+(buy|purchase|order|subscribe|sign\s*up|register|enroll)/i,
  /i\s+want\s+to\s+(buy|try|get|start|join)/i,
  /take\s+my\s+money/i,
  /shut\s+up\s+and\s+take/i,
  /link\s+(in\s+bio|please|pls|\?)/i,
  /price\s*(list|\?)/i,
  /how\s+much\s+(does|is|for)/i,
  /send\s+(me\s+)?(the\s+)?link/i,
  /i('m|\s+am)\s+(interested|ready|sold)/i,
  /can\s+i\s+(get|have|buy|order)/i,
  /dm\s+(me|for|sent)/i,
  /when\s+(is|does)\s+(it|this)\s+(launch|drop|release|available)/i,
  /waiting\s+for\s+(this|it)/i,
  /need\s+this/i,
];

const OBJECTION_PATTERNS = [
  /too\s+expensive/i,
  /not\s+worth/i,
  /waste\s+of\s+(money|time)/i,
  /doesn'?t\s+work/i,
  /scam/i,
  /overpriced/i,
  /skeptical/i,
  /doubt/i,
  /but\s+(what\s+about|how\s+about|does\s+it)/i,
  /i'?m\s+not\s+sure/i,
  /is\s+(this|it)\s+(legit|real|worth)/i,
  /seems\s+(too\s+good|fake|shady)/i,
  /tried.*didn'?t\s+work/i,
  /can'?t\s+afford/i,
  /what'?s\s+the\s+catch/i,
];

const HIGH_INTENT_LANGUAGE = [
  /how\s+do\s+(i|you|we)/i,
  /what\s+(is|are)\s+the\s+best/i,
  /recommend/i,
  /advice/i,
  /tips?\s+(for|on|about)/i,
  /help\s+(me|us|with)/i,
  /struggling\s+with/i,
  /anyone\s+(tried|used|know)/i,
  /does\s+(this|it|anyone)/i,
  /looking\s+for/i,
  /need\s+(help|advice|tips|guidance)/i,
  /compared?\s+to/i,
  /vs\.?\s/i,
  /difference\s+between/i,
  /which\s+(one|is\s+better)/i,
  /should\s+i/i,
];

export function computeDemandPressure(
  comments: CommentData[],
  engagementQuality: EngagementQuality,
  audienceIntentSignals: string[],
  commentCount?: number,
): DemandPressureResult {
  const engagementDensity = clamp01(engagementQuality.engagementQualityRatio);
  const metadataCommentCount = commentCount ?? 0;
  const commentIntensity = clamp01(metadataCommentCount / MI_DEMAND_PRESSURE.COMMENT_INTENSITY_NORMALIZATION);

  if (comments.length === 0) {
    const intentSignalStrength = clamp01(audienceIntentSignals.length / MI_DEMAND_PRESSURE.INTENT_SIGNAL_NORMALIZATION * 0.5);
    const score = clamp01(
      engagementDensity * (MI_DEMAND_PRESSURE.WEIGHT_ENGAGEMENT + MI_DEMAND_PRESSURE.WEIGHT_OBJECTION + MI_DEMAND_PRESSURE.WEIGHT_PURCHASE_INTENT) +
      commentIntensity * MI_DEMAND_PRESSURE.WEIGHT_COMMENT_INTENSITY +
      intentSignalStrength * MI_DEMAND_PRESSURE.WEIGHT_INTENT_SIGNAL
    );
    const roundedScore = Math.round(score * 1000) / 1000;
    let level: DemandPressureLevel = "LOW";
    if (roundedScore >= MI_DEMAND_PRESSURE.HIGH_THRESHOLD) level = "HIGH";
    else if (roundedScore >= MI_DEMAND_PRESSURE.MODERATE_THRESHOLD) level = "MODERATE";
    console.log(`[DemandPressure] NO_COMMENT_TEXT — commentCount=${metadataCommentCount} used as engagement signal only, score=${roundedScore}`);
    return {
      score: roundedScore,
      level,
      components: {
        engagementDensity: Math.round(engagementDensity * 1000) / 1000,
        commentIntensity: Math.round(commentIntensity * 1000) / 1000,
        intentSignalStrength: Math.round(intentSignalStrength * 1000) / 1000,
        objectionDensity: 0,
        purchaseIntentDensity: 0,
      },
    };
  }

  const texts = comments.map(c => (c.text || "").trim()).filter(t => t.length > 0);
  const totalTexts = texts.length;

  let purchaseIntentCount = 0;
  let objectionCount = 0;
  let highIntentLanguageCount = 0;

  for (const text of texts) {
    if (PURCHASE_INTENT_PATTERNS.some(p => p.test(text))) purchaseIntentCount++;
    if (OBJECTION_PATTERNS.some(p => p.test(text))) objectionCount++;
    if (HIGH_INTENT_LANGUAGE.some(p => p.test(text))) highIntentLanguageCount++;
  }

  const purchaseIntentDensity = clamp01(purchaseIntentCount / Math.max(1, totalTexts) * MI_DEMAND_PRESSURE.PURCHASE_INTENT_AMPLIFIER);
  const objectionDensity = clamp01(objectionCount / Math.max(1, totalTexts) * MI_DEMAND_PRESSURE.OBJECTION_AMPLIFIER);
  const intentSignalStrength = clamp01(
    (audienceIntentSignals.length / MI_DEMAND_PRESSURE.INTENT_SIGNAL_NORMALIZATION) * 0.5 +
    (highIntentLanguageCount / Math.max(1, totalTexts)) * 0.5
  );

  const score = clamp01(
    engagementDensity * MI_DEMAND_PRESSURE.WEIGHT_ENGAGEMENT +
    commentIntensity * MI_DEMAND_PRESSURE.WEIGHT_COMMENT_INTENSITY +
    intentSignalStrength * MI_DEMAND_PRESSURE.WEIGHT_INTENT_SIGNAL +
    objectionDensity * MI_DEMAND_PRESSURE.WEIGHT_OBJECTION +
    purchaseIntentDensity * MI_DEMAND_PRESSURE.WEIGHT_PURCHASE_INTENT
  );

  const roundedScore = Math.round(score * 1000) / 1000;

  let level: DemandPressureLevel = "LOW";
  if (roundedScore >= MI_DEMAND_PRESSURE.HIGH_THRESHOLD) level = "HIGH";
  else if (roundedScore >= MI_DEMAND_PRESSURE.MODERATE_THRESHOLD) level = "MODERATE";

  return {
    score: roundedScore,
    level,
    components: {
      engagementDensity: Math.round(engagementDensity * 1000) / 1000,
      commentIntensity: Math.round(commentIntensity * 1000) / 1000,
      intentSignalStrength: Math.round(intentSignalStrength * 1000) / 1000,
      objectionDensity: Math.round(objectionDensity * 1000) / 1000,
      purchaseIntentDensity: Math.round(purchaseIntentDensity * 1000) / 1000,
    },
  };
}
