/**
 * Competitor Post Classifier — public API.
 *
 * Import surface for consumers. All other files in this module are internal.
 */

export { classifyCompetitorPost } from "./classifier";
export { classifyAndPersistPost, runBatchClassification } from "./batch";
export type {
  CompetitorPostInput,
  CompetitorPostClassification,
  HookArchetype,
  NarrativeFramework,
  CtaType,
  OfferType,
  EmotionalTrigger,
  AwarenessStage,
  PositioningStyle,
  ContentFormatIntent,
  PrimaryGoal,
} from "./types";
export type { BatchOptions, BatchResult } from "./batch";
export { CLASSIFIER_VERSION, HOOK_ARCHETYPES, NARRATIVE_FRAMEWORKS, CTA_TYPES, OFFER_TYPES, EMOTIONAL_TRIGGERS, AWARENESS_STAGES, POSITIONING_STYLES, CONTENT_FORMAT_INTENTS, PRIMARY_GOALS } from "./types";
