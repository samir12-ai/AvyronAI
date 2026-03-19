import { cosineSimilarity } from "../shared/embedding";

export type ClaimType = "factual_claim" | "inferred_insight" | "emotional_synthesis";

export interface ClassifiedClaim {
  text: string;
  type: ClaimType;
  classifiedBy: "rule" | "embedding" | "default";
}

export interface ClaimBreakdown {
  factual: number;
  inferred: number;
  emotional: number;
}

const FACTUAL_RULE_PATTERNS: RegExp[] = [
  /\b\d+\s*%/,
  /\b\d+x\b/i,
  /\b\d+(\.\d+)?\s*(times|fold|hours?|days?|weeks?|months?|years?|users?|customers?|clients?|dollars?|\$|€|£)/i,
  /\b(causes?|leads?\s+to|results?\s+in|drives?\s+to|produces?|generates?|increases?|decreases?|reduces?)\b/i,
  /\b(studies?\s+show|research\s+(shows?|indicates?|suggests?|confirms?)|data\s+(shows?|indicates?|suggests?|confirms?)|evidence\s+shows?|proven\s+to|demonstrated\s+that|clinical\s+trial|survey\s+(found|shows?))\b/i,
  /\b(on\s+average|typically|statistically|measurably|quantifiably)\b/i,
  /\b(proven|documented|measured|verified|tested|validated)\b/i,
];

const EMOTIONAL_RULE_PATTERNS: RegExp[] = [
  /\b(feel(s|ing)?|felt)\b/i,
  /\b(creates?\s+a\s+(feeling|sense|sense\s+of|feeling\s+of))\b/i,
  /\b(resonates?\s+with|taps?\s+into|speaks?\s+to|connects?\s+with)\b/i,
  /\b(inspires?|excites?|energizes?|motivates?|empowers?)\b/i,
  /\b(emotional(ly)?|deeply|heartfelt|passionate(ly)?)\b/i,
  /\b(desire|longing|aspiration|dream|fear|anxiety|dread|hope|confidence|pride)\b/i,
];

const FACTUAL_ANCHORS: string[] = [
  "increases conversion rate by 30 percent proven by data",
  "studies show users reduce churn by 25 percent on average",
  "clinical research demonstrates measurable revenue growth results",
  "data indicates 40 percent reduction in customer acquisition cost",
  "causes higher retention among qualified leads in pipeline",
  "results in documented 2x improvement in monthly recurring revenue",
];

const EMOTIONAL_ANCHORS: string[] = [
  "creates a feeling of confidence and trust in the brand",
  "resonates deeply with the audience emotional desire for security",
  "taps into the aspiration to build something meaningful and lasting",
  "inspires a sense of pride and belonging in the community",
  "speaks to the fear of missing out on a transformational opportunity",
  "connects with the longing for freedom from financial uncertainty",
];

const INFERRED_ANCHORS: string[] = [
  "suggests that the market pattern indicates an emerging opportunity",
  "likely driven by underlying behavioral resistance to change adoption",
  "appears to reflect a shift in buyer expectations around value",
  "implies that friction in the funnel stems from unresolved trust gaps",
  "points toward a structural mismatch between offer framing and audience readiness",
  "consistent with what high-intent segments typically experience before committing",
];

const FACTUAL_ANCHOR_TEXT = FACTUAL_ANCHORS.join(" ");
const EMOTIONAL_ANCHOR_TEXT = EMOTIONAL_ANCHORS.join(" ");
const INFERRED_ANCHOR_TEXT = INFERRED_ANCHORS.join(" ");

const EMBEDDING_THRESHOLD = 0.10;

function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z"'])|\n+/)
    .map(s => s.trim())
    .filter(s => s.length > 8);
}

function applyRulePass(sentence: string): ClaimType | null {
  const lower = sentence.toLowerCase();

  for (const pattern of FACTUAL_RULE_PATTERNS) {
    if (pattern.test(lower)) return "factual_claim";
  }

  for (const pattern of EMOTIONAL_RULE_PATTERNS) {
    if (pattern.test(lower)) return "emotional_synthesis";
  }

  return null;
}

function applyEmbeddingPass(sentence: string): ClaimType {
  const factualSim = cosineSimilarity(sentence, FACTUAL_ANCHOR_TEXT);
  const emotionalSim = cosineSimilarity(sentence, EMOTIONAL_ANCHOR_TEXT);
  const inferredSim = cosineSimilarity(sentence, INFERRED_ANCHOR_TEXT);

  const maxSim = Math.max(factualSim, emotionalSim, inferredSim);

  if (maxSim < EMBEDDING_THRESHOLD) {
    return "inferred_insight";
  }

  if (factualSim >= emotionalSim && factualSim >= inferredSim) {
    return "factual_claim";
  }

  if (emotionalSim >= factualSim && emotionalSim >= inferredSim) {
    return "emotional_synthesis";
  }

  return "inferred_insight";
}

export function classifyClaims(text: string): ClassifiedClaim[] {
  const sentences = splitIntoSentences(text);
  const classified: ClassifiedClaim[] = [];

  for (const sentence of sentences) {
    const ruleResult = applyRulePass(sentence);

    if (ruleResult !== null) {
      classified.push({ text: sentence, type: ruleResult, classifiedBy: "rule" });
    } else {
      const embeddingResult = applyEmbeddingPass(sentence);
      classified.push({ text: sentence, type: embeddingResult, classifiedBy: "embedding" });
    }
  }

  return classified;
}

export function buildClaimBreakdown(claims: ClassifiedClaim[]): ClaimBreakdown {
  let factual = 0;
  let inferred = 0;
  let emotional = 0;

  for (const c of claims) {
    if (c.type === "factual_claim") factual++;
    else if (c.type === "inferred_insight") inferred++;
    else emotional++;
  }

  return { factual, inferred, emotional };
}

export function extractFactualClaims(claims: ClassifiedClaim[]): string[] {
  return claims.filter(c => c.type === "factual_claim").map(c => c.text);
}

export function extractNonFactualClaims(claims: ClassifiedClaim[]): string[] {
  return claims.filter(c => c.type !== "factual_claim").map(c => c.text);
}
