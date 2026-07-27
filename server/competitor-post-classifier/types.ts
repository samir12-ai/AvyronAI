/**
 * Competitor Post Classifier — shared types.
 *
 * This module is the ONLY source of truth for:
 *   - the classification output schema
 *   - the enumerated dimension values
 *   - the classifier version constant
 *
 * Any consumer (Performance Loop, Content DNA, Watchtower, etc.)
 * imports from here — never re-declares these shapes locally.
 */

// ---------------------------------------------------------------------------
// Classifier version — bump when the prompt or schema changes meaningfully.
// Old rows remain queryable; consumers can filter by classifierVersion.
// ---------------------------------------------------------------------------
export const CLASSIFIER_VERSION = "competitor-post-v2";

// ---------------------------------------------------------------------------
// Enumerated dimension values.
// All enums include UNKNOWN so the classifier can be honest rather than
// hallucinating when a dimension cannot be inferred from available text.
// ---------------------------------------------------------------------------

export const HOOK_ARCHETYPES = [
  "QUESTION",
  "BOLD_CLAIM",
  "PAIN_AGITATION",
  "SOCIAL_PROOF",
  "CURIOSITY_GAP",
  "HOW_TO",
  "STORY_OPEN",
  "UNKNOWN",
] as const;
export type HookArchetype = (typeof HOOK_ARCHETYPES)[number];

export const NARRATIVE_FRAMEWORKS = [
  "PROBLEM_SOLUTION",
  "BEFORE_AFTER",
  "STORY_LESSON",
  "MISTAKE_FIX",
  "HOW_TO_LIST",
  "TRANSFORMATION",
  "SOCIAL_PROOF_NARRATIVE",
  "UNKNOWN",
] as const;
export type NarrativeFramework = (typeof NARRATIVE_FRAMEWORKS)[number];

export const CTA_TYPES = [
  "LINK_IN_BIO",
  "DM_US",
  "SAVE_THIS",
  "COMMENT_BELOW",
  "FOLLOW_FOR_MORE",
  "SHOP_NOW",
  "BOOK_NOW",
  "NONE",
  "UNKNOWN",
] as const;
export type CtaType = (typeof CTA_TYPES)[number];

export const OFFER_TYPES = [
  "FREE_RESOURCE",
  "DISCOUNT",
  "TRIAL",
  "CONSULTATION",
  "PRODUCT_LAUNCH",
  "EVENT",
  "NONE",
  "UNKNOWN",
] as const;
export type OfferType = (typeof OFFER_TYPES)[number];

export const EMOTIONAL_TRIGGERS = [
  "FEAR",
  "ASPIRATION",
  "CURIOSITY",
  "BELONGING",
  "URGENCY",
  "TRUST",
  "PRIDE",
  "FRUSTRATION",
  "RELIEF",
  "UNKNOWN",
] as const;
export type EmotionalTrigger = (typeof EMOTIONAL_TRIGGERS)[number];

export const AWARENESS_STAGES = [
  "UNAWARE",
  "PROBLEM_AWARE",
  "SOLUTION_AWARE",
  "PRODUCT_AWARE",
  "MOST_AWARE",
  "UNKNOWN",
] as const;
export type AwarenessStage = (typeof AWARENESS_STAGES)[number];

export const POSITIONING_STYLES = [
  "AUTHORITY",
  "RELATABILITY",
  "EDUCATION",
  "ENTERTAINMENT",
  "TRANSFORMATION",
  "SOCIAL_PROOF",
  "ASPIRATIONAL",
  "UNKNOWN",
] as const;
export type PositioningStyle = (typeof POSITIONING_STYLES)[number];

export const CONTENT_FORMAT_INTENTS = [
  "EDUCATIONAL",
  "INSPIRATIONAL",
  "PROMOTIONAL",
  "ENGAGEMENT_BAIT",
  "STORYTELLING",
  "PRODUCT_DEMO",
  "BEHIND_SCENES",
  "UNKNOWN",
] as const;
export type ContentFormatIntent = (typeof CONTENT_FORMAT_INTENTS)[number];

export const PRIMARY_GOALS = [
  "AWARENESS",
  "ENGAGEMENT",
  "LEAD_GEN",
  "CONVERSION",
  "RETENTION",
  "COMMUNITY",
  "UNKNOWN",
] as const;
export type PrimaryGoal = (typeof PRIMARY_GOALS)[number];

export const CORE_MARKETING_PROMISES = [
  "SAVE_TIME",
  "SAVE_MONEY",
  "BETTER_QUALITY",
  "PREMIUM_EXPERIENCE",
  "FAMILY_EXPERIENCE",
  "CONVENIENCE",
  "TRUST_AND_RELIABILITY",
  "SOCIAL_STATUS",
  "EXCLUSIVITY",
  "BETTER_TASTE",
  "BETTER_HEALTH",
  "ENTERTAINMENT",
  "COMMUNITY",
  "PERSONAL_GROWTH",
  "SIMPLICITY",
  "UNKNOWN",
] as const;
export type CoreMarketingPromise = (typeof CORE_MARKETING_PROMISES)[number];

// ---------------------------------------------------------------------------
// Input — the subset of ci_competitor_posts columns the classifier uses.
// Kept explicit so callers don't pass DB rows with stale shape accidentally.
// ---------------------------------------------------------------------------
export interface CompetitorPostInput {
  id: string;
  competitorId: string;
  caption: string | null;
  hookText: string | null;
  hashtags: string | null;
  mediaType: string | null;
  likes: number | null;
  comments: number | null;
  views: number | null;
  permalink: string | null;
}

// ---------------------------------------------------------------------------
// Output — what classifyCompetitorPost() returns.
// All dimensions are typed with their enums; primaryHook and primaryAngle
// are free-text strings (brief extracts / descriptions, never rewrites).
// ---------------------------------------------------------------------------
export interface CompetitorPostClassification {
  postId: string;           // competitor_post_classifications.post_id (FK to ci_competitor_posts.id)
  competitorId: string;

  /** Verbatim or minimally paraphrased opening hook text (≤10 words). */
  primaryHook: string | null;
  hookArchetype: HookArchetype;

  /** 3–8 word description of the strategic messaging angle. */
  primaryAngle: string | null;
  narrative: NarrativeFramework;

  ctaType: CtaType;
  offerType: OfferType;
  emotionalTrigger: EmotionalTrigger;
  awarenessStage: AwarenessStage;
  positioningStyle: PositioningStyle;
  contentFormatIntent: ContentFormatIntent;
  primaryGoal: PrimaryGoal;

  /** 0.0–1.0. Low when caption is empty, very short, or uninterpretable. */
  confidenceScore: number;

  /**
   * The fundamental customer value proposition the post is making.
   * Answers "What is the customer actually being promised?" — not the hook,
   * angle wording, emotional trigger, or CTA, but the underlying promise.
   */
  coreMarketingPromise: CoreMarketingPromise;

  classifierVersion: string;
}
