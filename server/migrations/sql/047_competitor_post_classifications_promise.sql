-- Migration 047: Add core_marketing_promise column to competitor_post_classifications
--
-- WHY: The v1 classifier captured HOW a post communicates (hook, narrative,
-- CTA, emotional trigger, etc.). This column captures WHAT the post is
-- fundamentally promising to the customer — the core value proposition.
-- It is an additive column on the existing table; v1 rows default to UNKNOWN.
-- The classifier version bumps to competitor-post-v2 so v1 and v2 rows
-- are separately queryable by any consumer.

ALTER TABLE competitor_post_classifications
  ADD COLUMN IF NOT EXISTS core_marketing_promise text NOT NULL DEFAULT 'UNKNOWN';

ALTER TABLE competitor_post_classifications
  DROP CONSTRAINT IF EXISTS cpc_core_marketing_promise_check;

ALTER TABLE competitor_post_classifications
  ADD CONSTRAINT cpc_core_marketing_promise_check
  CHECK (core_marketing_promise IN (
    'SAVE_TIME',
    'SAVE_MONEY',
    'BETTER_QUALITY',
    'PREMIUM_EXPERIENCE',
    'FAMILY_EXPERIENCE',
    'CONVENIENCE',
    'TRUST_AND_RELIABILITY',
    'SOCIAL_STATUS',
    'EXCLUSIVITY',
    'BETTER_TASTE',
    'BETTER_HEALTH',
    'ENTERTAINMENT',
    'COMMUNITY',
    'PERSONAL_GROWTH',
    'SIMPLICITY',
    'UNKNOWN'
  ));

-- Index for analytics: "which promise does each competitor use most?"
CREATE INDEX IF NOT EXISTS competitor_post_classifications_promise_idx
  ON competitor_post_classifications (core_marketing_promise, classifier_version);
