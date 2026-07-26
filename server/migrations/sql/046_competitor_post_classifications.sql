-- Migration 046: competitor_post_classifications
--
-- WHY: The existing ci_competitor_posts table stores scraped post data.
-- Classification (hook archetype, narrative, CTA type, etc.) is a separate,
-- async, AI-powered process that runs after scraping. Keeping classifications
-- in a dedicated table:
--   1. Preserves the scrape row as immutable source truth.
--   2. Allows re-classification (new classifierVersion) without touching
--      the source data.
--   3. Lets any future engine LEFT JOIN classifications onto posts cleanly.
--   4. Keeps NULL semantics honest: a post without a classification row
--      is "unclassified", not "classified as UNKNOWN".
--
-- The unique index is on (post_id, classifier_version) — a new prompt version
-- produces a new row, old rows remain queryable for diff/regression analysis.

CREATE TABLE IF NOT EXISTS competitor_post_classifications (
  id                    varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id               varchar NOT NULL,            -- FK-shaped to ci_competitor_posts.id
  competitor_id         varchar NOT NULL,

  -- Free-text dimensions (nullable — null = classifier could not extract).
  primary_hook          text,
  primary_angle         text,

  -- Enumerated dimensions.
  -- All use text (not PG enum types) so new values are additive migrations.
  -- Constraint names are explicit so they can be dropped/recreated cleanly.
  hook_archetype        text NOT NULL DEFAULT 'UNKNOWN',
  narrative             text NOT NULL DEFAULT 'UNKNOWN',
  cta_type              text NOT NULL DEFAULT 'UNKNOWN',
  offer_type            text NOT NULL DEFAULT 'UNKNOWN',
  emotional_trigger     text NOT NULL DEFAULT 'UNKNOWN',
  awareness_stage       text NOT NULL DEFAULT 'UNKNOWN',
  positioning_style     text NOT NULL DEFAULT 'UNKNOWN',
  content_format_intent text NOT NULL DEFAULT 'UNKNOWN',
  primary_goal          text NOT NULL DEFAULT 'UNKNOWN',

  -- 0.0–1.0 confidence score from the classifier.
  confidence_score      numeric(4,3) NOT NULL DEFAULT 0,

  -- Version string (e.g. "competitor-post-v1"). Used to scope queries and
  -- to identify rows that need re-classification after a prompt change.
  classifier_version    text NOT NULL,

  classified_at         timestamp NOT NULL,
  created_at            timestamp NOT NULL DEFAULT now()
);

-- Unique index: one classification row per (post, version).
-- ON CONFLICT DO UPDATE in the application layer makes upserts idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS competitor_post_classifications_post_version_idx
  ON competitor_post_classifications (post_id, classifier_version);

-- Lookup by competitor (common query: "all classified posts for competitor X").
CREATE INDEX IF NOT EXISTS competitor_post_classifications_competitor_idx
  ON competitor_post_classifications (competitor_id, classifier_version);

-- Lookup by hook archetype / narrative for future analytics queries.
CREATE INDEX IF NOT EXISTS competitor_post_classifications_hook_idx
  ON competitor_post_classifications (hook_archetype, classifier_version);

CREATE INDEX IF NOT EXISTS competitor_post_classifications_narrative_idx
  ON competitor_post_classifications (narrative, classifier_version);

-- Enum-value constraints — text column but with a CHECK so the DB rejects
-- invalid values from any path (not just the application layer).
ALTER TABLE competitor_post_classifications
  DROP CONSTRAINT IF EXISTS cpc_hook_archetype_check;
ALTER TABLE competitor_post_classifications
  ADD CONSTRAINT cpc_hook_archetype_check
  CHECK (hook_archetype IN (
    'QUESTION','BOLD_CLAIM','PAIN_AGITATION','SOCIAL_PROOF',
    'CURIOSITY_GAP','HOW_TO','STORY_OPEN','UNKNOWN'
  ));

ALTER TABLE competitor_post_classifications
  DROP CONSTRAINT IF EXISTS cpc_narrative_check;
ALTER TABLE competitor_post_classifications
  ADD CONSTRAINT cpc_narrative_check
  CHECK (narrative IN (
    'PROBLEM_SOLUTION','BEFORE_AFTER','STORY_LESSON','MISTAKE_FIX',
    'HOW_TO_LIST','TRANSFORMATION','SOCIAL_PROOF_NARRATIVE','UNKNOWN'
  ));

ALTER TABLE competitor_post_classifications
  DROP CONSTRAINT IF EXISTS cpc_cta_type_check;
ALTER TABLE competitor_post_classifications
  ADD CONSTRAINT cpc_cta_type_check
  CHECK (cta_type IN (
    'LINK_IN_BIO','DM_US','SAVE_THIS','COMMENT_BELOW','FOLLOW_FOR_MORE',
    'SHOP_NOW','BOOK_NOW','NONE','UNKNOWN'
  ));

ALTER TABLE competitor_post_classifications
  DROP CONSTRAINT IF EXISTS cpc_offer_type_check;
ALTER TABLE competitor_post_classifications
  ADD CONSTRAINT cpc_offer_type_check
  CHECK (offer_type IN (
    'FREE_RESOURCE','DISCOUNT','TRIAL','CONSULTATION',
    'PRODUCT_LAUNCH','EVENT','NONE','UNKNOWN'
  ));

ALTER TABLE competitor_post_classifications
  DROP CONSTRAINT IF EXISTS cpc_emotional_trigger_check;
ALTER TABLE competitor_post_classifications
  ADD CONSTRAINT cpc_emotional_trigger_check
  CHECK (emotional_trigger IN (
    'FEAR','ASPIRATION','CURIOSITY','BELONGING','URGENCY',
    'TRUST','PRIDE','FRUSTRATION','RELIEF','UNKNOWN'
  ));

ALTER TABLE competitor_post_classifications
  DROP CONSTRAINT IF EXISTS cpc_awareness_stage_check;
ALTER TABLE competitor_post_classifications
  ADD CONSTRAINT cpc_awareness_stage_check
  CHECK (awareness_stage IN (
    'UNAWARE','PROBLEM_AWARE','SOLUTION_AWARE',
    'PRODUCT_AWARE','MOST_AWARE','UNKNOWN'
  ));

ALTER TABLE competitor_post_classifications
  DROP CONSTRAINT IF EXISTS cpc_positioning_style_check;
ALTER TABLE competitor_post_classifications
  ADD CONSTRAINT cpc_positioning_style_check
  CHECK (positioning_style IN (
    'AUTHORITY','RELATABILITY','EDUCATION','ENTERTAINMENT',
    'TRANSFORMATION','SOCIAL_PROOF','ASPIRATIONAL','UNKNOWN'
  ));

ALTER TABLE competitor_post_classifications
  DROP CONSTRAINT IF EXISTS cpc_content_format_intent_check;
ALTER TABLE competitor_post_classifications
  ADD CONSTRAINT cpc_content_format_intent_check
  CHECK (content_format_intent IN (
    'EDUCATIONAL','INSPIRATIONAL','PROMOTIONAL','ENGAGEMENT_BAIT',
    'STORYTELLING','PRODUCT_DEMO','BEHIND_SCENES','UNKNOWN'
  ));

ALTER TABLE competitor_post_classifications
  DROP CONSTRAINT IF EXISTS cpc_primary_goal_check;
ALTER TABLE competitor_post_classifications
  ADD CONSTRAINT cpc_primary_goal_check
  CHECK (primary_goal IN (
    'AWARENESS','ENGAGEMENT','LEAD_GEN','CONVERSION',
    'RETENTION','COMMUNITY','UNKNOWN'
  ));

ALTER TABLE competitor_post_classifications
  DROP CONSTRAINT IF EXISTS cpc_confidence_score_check;
ALTER TABLE competitor_post_classifications
  ADD CONSTRAINT cpc_confidence_score_check
  CHECK (confidence_score >= 0 AND confidence_score <= 1);
