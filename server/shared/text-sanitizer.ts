const HASHTAG_WALL_RE = /(?:#[\w\u0600-\u06FF]+[\s,]*){4,}/g;

const EMOJI_FLOOD_RE = /(?:[\p{Emoji}\p{Emoji_Presentation}\u200d\ufe0f]{2,}\s*){5,}/gu;

const PROMO_BOILERPLATE_PATTERNS = [
  /\blink\s*in\s*(my\s*)?bio\b/i,
  /\b(follow|subscribe)\s*(me|us|for\s*more)\b/i,
  /\b(dm|message)\s*(me|us|for)\s*(collab|promo|info|pricing|details)\b/i,
  /\buse\s*code\s*[A-Z0-9]+\b/i,
  /\b(giveaway|raffle|sweepstakes|win\s+(a|this))\b/i,
  /\b(tap|click|swipe)\s*(the\s*)?(link|here|up)\b/i,
  /\b(paid\s*partnership|sponsored|ad)\s*$/im,
  /\bcheck\s*(my|out\s*my)\s*(page|profile|link|bio)\b/i,
  /\b(free|earn)\s*(money|cash|followers|likes)\b/i,
  /\bgrow\s*your\s*(account|followers|page)\b/i,
  /\b(buy|get)\s*(followers|likes|views)\b/i,
  /\bI\s*can\s*help\s*you\s*(grow|get|gain)\b/i,
  /\b(promo|promote)\s*(available|dm|prices?)\b/i,
];

const REVIEW_BOILERPLATE_PATTERNS = [
  /^\(Translated by Google\)\s*/i,
  /\(Original\)\s*$/i,
  /^A Google User\s*/i,
  /^Google review\s*/i,
  /^Posted via .+$/im,
  /^Reply from .+$/im,
];

const TEMPLATE_REVIEW_PATTERNS = [
  /^(great|good|nice|excellent|wonderful|amazing|awesome|fantastic|terrible|horrible|bad|worst)\s*(service|place|experience|food|work|job|company|team|staff|quality)?\s*[.!]*$/i,
  /^(highly\s*recommend(ed)?|would\s*recommend|not\s*recommend(ed)?)\s*[.!]*$/i,
  /^(5|4|3|2|1)\s*stars?\s*[.!]*$/i,
  /^(loved?\s*it|hated?\s*it|ok(ay)?|so[-\s]*so|meh|fine)\s*[.!]*$/i,
  /^(thank(s|\s*you)?|thx)\s*[.!]*$/i,
];

const WEBSITE_BOILERPLATE_PATTERNS = [
  /\bcookie(s)?\s*(policy|notice|consent|preferences|settings)\b/i,
  /\bwe\s*use\s*cookies\b/i,
  /\baccept\s*(all\s*)?cookies\b/i,
  /\bprivacy\s*(policy|notice|statement)\b/i,
  /\bterms\s*(of\s*(service|use)|and\s*conditions)\b/i,
  /\ball\s*rights?\s*reserved\b/i,
  /\bcopyright\s*©?\s*\d{4}/i,
  /\bpowered\s*by\b/i,
  /\b(home|about(\s*us)?|contact(\s*us)?|faq|blog|careers?|press|sitemap|login|sign\s*in|sign\s*up|register)\s*$/i,
  /\b(facebook|twitter|instagram|linkedin|youtube|tiktok|pinterest)\s*$/i,
  /\bsubscribe\s*to\s*(our\s*)?newsletter\b/i,
  /\benter\s*your\s*email\b/i,
  /\b(unsubscribe|manage\s*preferences)\b/i,
];

export interface SanitizeResult {
  text: string;
  wasModified: boolean;
  removedPatterns: string[];
}

export function sanitizeCaption(raw: string, platform: "instagram" | "tiktok" = "instagram"): SanitizeResult {
  const removedPatterns: string[] = [];
  let text = (raw || "").trim();

  if (!text) return { text: "", wasModified: false, removedPatterns: [] };

  const original = text;

  if (HASHTAG_WALL_RE.test(text)) {
    text = text.replace(HASHTAG_WALL_RE, " ");
    removedPatterns.push("hashtag_wall");
  }

  if (EMOJI_FLOOD_RE.test(text)) {
    text = text.replace(EMOJI_FLOOD_RE, " ");
    removedPatterns.push("emoji_flood");
  }

  for (const pattern of PROMO_BOILERPLATE_PATTERNS) {
    if (pattern.test(text)) {
      text = text.replace(pattern, " ");
      removedPatterns.push("promo_boilerplate");
    }
  }

  text = text.replace(/@[\w.]+/g, " ");

  text = text.replace(/\s+/g, " ").trim();

  const meaningfulChars = text.replace(/[\s\p{Emoji}\p{Emoji_Presentation}\u200d\ufe0f#@]/gu, "");
  if (meaningfulChars.length < 5) {
    return { text: "", wasModified: true, removedPatterns: [...removedPatterns, "insufficient_content"] };
  }

  return { text, wasModified: text !== original, removedPatterns };
}

export function sanitizeReviewText(raw: string): SanitizeResult {
  const removedPatterns: string[] = [];
  let text = (raw || "").trim();

  if (!text) return { text: "", wasModified: false, removedPatterns: [] };

  const original = text;

  for (const pattern of REVIEW_BOILERPLATE_PATTERNS) {
    if (pattern.test(text)) {
      text = text.replace(pattern, "").trim();
      removedPatterns.push("review_boilerplate");
    }
  }

  for (const pattern of TEMPLATE_REVIEW_PATTERNS) {
    if (pattern.test(text)) {
      return { text: "", wasModified: true, removedPatterns: [...removedPatterns, "template_review"] };
    }
  }

  if (text.length < 8) {
    return { text: "", wasModified: true, removedPatterns: [...removedPatterns, "too_short"] };
  }

  text = text.replace(/\s+/g, " ").trim();

  return { text, wasModified: text !== original, removedPatterns };
}

export function sanitizeWebsiteBlock(raw: string, blockType: string = "general"): SanitizeResult {
  const removedPatterns: string[] = [];
  let text = (raw || "").trim();

  if (!text) return { text: "", wasModified: false, removedPatterns: [] };

  const original = text;

  for (const pattern of WEBSITE_BOILERPLATE_PATTERNS) {
    if (pattern.test(text)) {
      return { text: "", wasModified: true, removedPatterns: ["website_boilerplate"] };
    }
  }

  if (/href=|class=|onclick=|data-|style=|utm_|\.js|\.css/i.test(text)) {
    return { text: "", wasModified: true, removedPatterns: ["code_artifact"] };
  }

  if (blockType === "headline" || blockType === "subheadline") {
    if (text.length < 3 || text.length > 300) {
      return { text: "", wasModified: true, removedPatterns: ["invalid_length"] };
    }
  }

  text = text.replace(/\s+/g, " ").trim();

  return { text, wasModified: text !== original, removedPatterns };
}

let totalSanitized = 0;
let totalRejected = 0;

export function getSanitizationStats() {
  return { totalSanitized, totalRejected };
}

export function sanitizeCaptionBatch(captions: string[], platform: "instagram" | "tiktok"): { cleaned: string[]; stats: { total: number; cleaned: number; rejected: number; patterns: Record<string, number> } } {
  const cleaned: string[] = [];
  const patterns: Record<string, number> = {};
  let rejected = 0;

  for (const caption of captions) {
    const result = sanitizeCaption(caption, platform);
    if (result.text) {
      cleaned.push(result.text);
      totalSanitized++;
    } else {
      rejected++;
      totalRejected++;
    }
    for (const p of result.removedPatterns) {
      patterns[p] = (patterns[p] || 0) + 1;
    }
  }

  return { cleaned, stats: { total: captions.length, cleaned: cleaned.length, rejected, patterns } };
}
