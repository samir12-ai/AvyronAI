-- =============================================================================
-- Migration 072: Multi-Campaign Support & Product-Specific Isolation
-- =============================================================================
-- Establishes first-class Account -> Business -> Product -> Campaign hierarchy,
-- per-campaign Competitor Relevance Decisions with data reuse provenance,
-- per-campaign AI & Acquisition usage/cost attribution, and configurable
-- package entitlements (Starter $199/1, Growth $399/2, Agency $699/4).
-- Backfills existing campaigns (preserving Songai camp_ac86e8b8-55b 100% intact)
-- and marks ambiguous legacy campaigns with review_status = 'NEEDS_REVIEW'.
-- =============================================================================

-- 1. Businesses table (reusable company-level identity & verified company facts)
CREATE TABLE IF NOT EXISTS businesses (
  id VARCHAR(128) PRIMARY KEY,
  account_id VARCHAR(128) NOT NULL,
  name TEXT NOT NULL,
  canonical_domain TEXT,
  website_url TEXT,
  industry TEXT,
  business_model TEXT,
  classification_profile JSONB DEFAULT '{}'::jsonb,
  verified_company_facts JSONB DEFAULT '[]'::jsonb,
  shared_channels JSONB DEFAULT '[]'::jsonb,
  source_website_snapshot_id VARCHAR(128),
  review_status VARCHAR(32) NOT NULL DEFAULT 'CONFIRMED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_businesses_account ON businesses(account_id);
CREATE INDEX IF NOT EXISTS idx_businesses_domain ON businesses(account_id, canonical_domain);

-- 2. Business Products table (distinct products/services/offerings under a business)
CREATE TABLE IF NOT EXISTS business_products (
  id VARCHAR(128) PRIMARY KEY,
  account_id VARCHAR(128) NOT NULL,
  business_id VARCHAR(128) NOT NULL,
  name TEXT NOT NULL,
  product_type VARCHAR(64) NOT NULL DEFAULT 'PRODUCT',
  description TEXT,
  product_url TEXT,
  documentation_text TEXT,
  verified_capabilities JSONB DEFAULT '[]'::jsonb,
  pricing_model TEXT,
  purchase_model TEXT,
  evidence_provenance JSONB DEFAULT '{}'::jsonb,
  input_snapshot_version VARCHAR(128),
  review_status VARCHAR(32) NOT NULL DEFAULT 'CONFIRMED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_business_products_account_biz ON business_products(account_id, business_id);

-- 3. Extend campaign_selections with Business/Product linkage & lifecycle fields
ALTER TABLE campaign_selections
  ADD COLUMN IF NOT EXISTS business_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS product_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS campaign_offering_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS setup_status VARCHAR(32) DEFAULT 'IN_PROGRESS',
  ADD COLUMN IF NOT EXISTS setup_step VARCHAR(32) DEFAULT '01_BUSINESS',
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_campaign_selections_account_campaign
  ON campaign_selections(account_id, selected_campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_selections_business_product
  ON campaign_selections(account_id, business_id, product_id);

-- 4. Extend campaign_offerings with full product-specific metadata & provenance
ALTER TABLE campaign_offerings
  ADD COLUMN IF NOT EXISTS business_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS product_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS product_type VARCHAR(64) DEFAULT 'PRODUCT',
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS product_url TEXT,
  ADD COLUMN IF NOT EXISTS documentation_text TEXT,
  ADD COLUMN IF NOT EXISTS verified_capabilities JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS pricing_model TEXT,
  ADD COLUMN IF NOT EXISTS purchase_model TEXT,
  ADD COLUMN IF NOT EXISTS evidence_provenance JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS input_snapshot_version VARCHAR(128),
  ADD COLUMN IF NOT EXISTS review_status VARCHAR(32) DEFAULT 'CONFIRMED';

-- 5. Extend business_understanding_snapshots to keep company facts, product facts, and campaign choices distinct
ALTER TABLE business_understanding_snapshots
  ADD COLUMN IF NOT EXISTS business_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS product_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS company_facts JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS product_facts JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS campaign_choices JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS evidence_provenance JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS input_snapshot_version VARCHAR(128);

-- 6. Competitor Relevance Decisions table (per-campaign, per-product semantic relevance & data reuse tracking)
CREATE TABLE IF NOT EXISTS competitor_relevance_decisions (
  id VARCHAR(128) PRIMARY KEY,
  account_id VARCHAR(128) NOT NULL,
  business_id VARCHAR(128),
  product_id VARCHAR(128),
  campaign_id VARCHAR(128) NOT NULL,
  campaign_offering_id VARCHAR(128),
  bu_snapshot_id VARCHAR(128),
  competitor_id VARCHAR(128),
  candidate_domain TEXT NOT NULL,
  candidate_name TEXT NOT NULL,
  competing_offering TEXT,
  serves_buyer_need BOOLEAN,
  buyer_need_rationale TEXT,
  target_market TEXT,
  target_market_relevance VARCHAR(64),
  competitor_type VARCHAR(64) NOT NULL DEFAULT 'DIRECT',
  decision_verdict VARCHAR(32) NOT NULL DEFAULT 'INCLUDED',
  inclusion_evidence JSONB DEFAULT '[]'::jsonb,
  unknowns_and_gaps JSONB DEFAULT '[]'::jsonb,
  exclusion_reason TEXT,
  data_reuse_status VARCHAR(64) NOT NULL DEFAULT 'NEWLY_ACQUIRED',
  monitored_product_urls JSONB DEFAULT '[]'::jsonb,
  source_observation_ids JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comp_rel_decisions_campaign
  ON competitor_relevance_decisions(account_id, campaign_id, decision_verdict);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_comp_rel_decisions_campaign_domain
  ON competitor_relevance_decisions(campaign_id, candidate_domain);

-- 7. Account Entitlements table (Starter $199/1, Growth $399/2, Agency $699/4, Test Isolated)
CREATE TABLE IF NOT EXISTS account_entitlements (
  account_id VARCHAR(128) PRIMARY KEY,
  package_tier VARCHAR(32) NOT NULL DEFAULT 'starter',
  monthly_price_usd INTEGER NOT NULL DEFAULT 199,
  max_active_campaigns INTEGER NOT NULL DEFAULT 1,
  is_test_entitlement BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Extend ai_usage_log with per-campaign usage & cost attribution
ALTER TABLE ai_usage_log
  ADD COLUMN IF NOT EXISTS campaign_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS operation_type VARCHAR(64),
  ADD COLUMN IF NOT EXISTS provider VARCHAR(32),
  ADD COLUMN IF NOT EXISTS input_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS output_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS cached_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS reasoning_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS cost_usd DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS cost_status VARCHAR(32) DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS provider_call_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_category VARCHAR(64),
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS shared_consumer_campaign_ids JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS attribution_policy VARCHAR(64) DEFAULT 'ORIGINATING_CAMPAIGN_ONCE';

CREATE INDEX IF NOT EXISTS idx_ai_usage_log_campaign
  ON ai_usage_log(account_id, campaign_id, created_at);

-- 9. Extend acquisition_tasks & acquisition_requests with product context & shared-consumer attribution
ALTER TABLE acquisition_tasks
  ADD COLUMN IF NOT EXISTS product_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS shared_consumer_campaign_ids JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS attribution_policy VARCHAR(64) DEFAULT 'ORIGINATING_CAMPAIGN_ONCE',
  ADD COLUMN IF NOT EXISTS data_reuse_status VARCHAR(64) DEFAULT 'NEWLY_ACQUIRED';

ALTER TABLE acquisition_requests
  ADD COLUMN IF NOT EXISTS product_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS shared_consumer_campaign_ids JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS attribution_policy VARCHAR(64) DEFAULT 'ORIGINATING_CAMPAIGN_ONCE',
  ADD COLUMN IF NOT EXISTS data_reuse_status VARCHAR(64) DEFAULT 'NEWLY_ACQUIRED';

-- =============================================================================
-- 10. Backfill Songai (camp_ac86e8b8-55b) and Existing Campaigns Safely
-- =============================================================================

-- 10a. Backfill Songai Business from stored website_snapshots & business_understanding_snapshots
INSERT INTO businesses (
  id,
  account_id,
  name,
  canonical_domain,
  website_url,
  industry,
  business_model,
  classification_profile,
  verified_company_facts,
  shared_channels,
  source_website_snapshot_id,
  review_status,
  created_at,
  updated_at
)
SELECT
  'biz_songai_ce5c11b9',
  'ce5c11b9-9a9a-499c-a4f8-b75e6ec6055f',
  COALESCE(ws.preliminary_extraction->>'companyName', 'The Songai'),
  'thesongai.com',
  COALESCE(ws.root_url, 'https://thesongai.com/'),
  COALESCE(ws.preliminary_extraction->>'industry', 'Music & Personalization'),
  COALESCE(ws.preliminary_extraction->>'businessModel', 'E-Commerce / Direct-to-Consumer'),
  COALESCE(bu.business_understanding->'classificationProfile', '{}'::jsonb),
  jsonb_build_array(
    jsonb_build_object(
      'factId', 'cf_songai_domain',
      'category', 'COMPANY_IDENTITY',
      'statement', 'The Songai operates at https://thesongai.com/ in the Music & Personalization category.',
      'sourceEvidenceId', ws.id,
      'verified', true
    )
  ),
  COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'platform', upp.platform,
          'handle', upp.handle,
          'url', upp.url
        )
      )
      FROM user_public_profiles upp
      WHERE upp.campaign_id = 'camp_ac86e8b8-55b'
    ),
    '[]'::jsonb
  ),
  ws.id,
  'CONFIRMED',
  ws.created_at,
  NOW()
FROM website_snapshots ws
LEFT JOIN business_understanding_snapshots bu
  ON bu.campaign_id = ws.campaign_id AND bu.website_snapshot_id = ws.id
WHERE ws.campaign_id = 'camp_ac86e8b8-55b'
ORDER BY ws.created_at DESC
LIMIT 1
ON CONFLICT (id) DO NOTHING;

-- 10b. Backfill Songai Product ("Personalized Songs") from stored campaign_offerings & offering_input_evidence
INSERT INTO business_products (
  id,
  account_id,
  business_id,
  name,
  product_type,
  description,
  product_url,
  documentation_text,
  verified_capabilities,
  pricing_model,
  purchase_model,
  evidence_provenance,
  input_snapshot_version,
  review_status,
  created_at,
  updated_at
)
SELECT
  'prod_songai_personalized_songs',
  'ce5c11b9-9a9a-499c-a4f8-b75e6ec6055f',
  'biz_songai_ce5c11b9',
  co.offering_name,
  'DIGITAL_PRODUCT',
  'Custom songs created from personal memories, complete with artwork, videos, and more.',
  'https://thesongai.com/',
  oie.raw_features_and_notes,
  COALESCE(bu.business_understanding->'verifiedCapabilities', '[]'::jsonb),
  'One-time digital custom song order (exact tier pricing UNKNOWN in truncated crawl)',
  'Direct online self-serve checkout via website',
  jsonb_build_object(
    'offeringInputEvidenceId', oie.id,
    'websiteSnapshotId', bu.website_snapshot_id,
    'buSnapshotId', bu.id,
    'authorityType', oie.authority_type
  ),
  'v1_backfill_' || COALESCE(oie.content_hash, 'songai'),
  'CONFIRMED',
  co.created_at,
  NOW()
FROM campaign_offerings co
LEFT JOIN offering_input_evidence oie ON oie.id = co.source_input_evidence_id
LEFT JOIN business_understanding_snapshots bu ON bu.campaign_id = co.campaign_id
WHERE co.campaign_id = 'camp_ac86e8b8-55b'
ORDER BY co.created_at DESC
LIMIT 1
ON CONFLICT (id) DO NOTHING;

-- 10c. Link Songai campaign_selections, campaign_offerings, and business_understanding_snapshots
UPDATE campaign_selections
SET
  business_id = 'biz_songai_ce5c11b9',
  product_id = 'prod_songai_personalized_songs',
  campaign_offering_id = 'off_6ab47aa7-8',
  setup_status = 'COMPLETE',
  setup_step = '06_READY'
WHERE selected_campaign_id = 'camp_ac86e8b8-55b';

UPDATE campaign_offerings
SET
  business_id = 'biz_songai_ce5c11b9',
  product_id = 'prod_songai_personalized_songs',
  product_type = 'DIGITAL_PRODUCT',
  description = 'Custom songs created from personal memories, complete with artwork, videos, and more.',
  product_url = 'https://thesongai.com/',
  review_status = 'CONFIRMED',
  input_snapshot_version = 'v1_backfill_HASH_1792144213878'
WHERE campaign_id = 'camp_ac86e8b8-55b';

UPDATE business_understanding_snapshots
SET
  business_id = 'biz_songai_ce5c11b9',
  product_id = 'prod_songai_personalized_songs',
  company_facts = jsonb_build_array(
    jsonb_build_object(
      'factId', 'cf_songai_domain',
      'statement', 'The Songai operates at https://thesongai.com/ in the Music & Personalization industry.'
    )
  ),
  product_facts = COALESCE(business_understanding->'verifiedCapabilities', '[]'::jsonb),
  campaign_choices = jsonb_build_object(
    'targetMarket', 'United Kingdom',
    'campaignGoalType', 'LEADS',
    'offeringName', 'Personalized Songs'
  ),
  evidence_provenance = jsonb_build_object(
    'websiteSnapshotId', website_snapshot_id,
    'offeringInputEvidenceId', offering_input_evidence_id,
    'dataReuseStatus', 'NEWLY_ACQUIRED'
  ),
  input_snapshot_version = 'v1_songai_canonical'
WHERE campaign_id = 'camp_ac86e8b8-55b';

-- 10d. Backfill other legacy campaigns that lack explicit offering evidence as NEEDS_REVIEW (never guess!)
INSERT INTO businesses (
  id,
  account_id,
  name,
  website_url,
  review_status,
  created_at,
  updated_at
)
SELECT DISTINCT ON (cs.account_id)
  'biz_legacy_' || SUBSTRING(MD5(cs.account_id), 1, 12),
  cs.account_id,
  COALESCE(ws.preliminary_extraction->>'companyName', cs.selected_campaign_name),
  ws.root_url,
  CASE WHEN ws.id IS NOT NULL THEN 'CONFIRMED' ELSE 'NEEDS_REVIEW' END,
  COALESCE(cs.selected_at, NOW()),
  NOW()
FROM campaign_selections cs
LEFT JOIN website_snapshots ws ON ws.campaign_id = cs.selected_campaign_id
WHERE cs.selected_campaign_id <> 'camp_ac86e8b8-55b'
  AND cs.business_id IS NULL
ON CONFLICT (id) DO NOTHING;

INSERT INTO business_products (
  id,
  account_id,
  business_id,
  name,
  product_type,
  description,
  review_status,
  created_at,
  updated_at
)
SELECT
  'prod_legacy_' || SUBSTRING(MD5(cs.selected_campaign_id), 1, 12),
  cs.account_id,
  'biz_legacy_' || SUBSTRING(MD5(cs.account_id), 1, 12),
  COALESCE(co.offering_name, cs.selected_campaign_name),
  'PRODUCT',
  CASE
    WHEN co.offering_name IS NOT NULL THEN 'Backfilled from stored campaign offering'
    ELSE 'Ambiguous legacy campaign offering — marked NEEDS_REVIEW for explicit product confirmation'
  END,
  CASE WHEN co.id IS NOT NULL THEN 'CONFIRMED' ELSE 'NEEDS_REVIEW' END,
  COALESCE(cs.selected_at, NOW()),
  NOW()
FROM campaign_selections cs
LEFT JOIN campaign_offerings co ON co.campaign_id = cs.selected_campaign_id
WHERE cs.selected_campaign_id <> 'camp_ac86e8b8-55b'
  AND cs.product_id IS NULL
ON CONFLICT (id) DO NOTHING;

UPDATE campaign_selections cs
SET
  business_id = 'biz_legacy_' || SUBSTRING(MD5(cs.account_id), 1, 12),
  product_id = 'prod_legacy_' || SUBSTRING(MD5(cs.selected_campaign_id), 1, 12),
  campaign_offering_id = co.id,
  setup_status = CASE
    WHEN EXISTS (SELECT 1 FROM strategic_plans sp WHERE sp.campaign_id = cs.selected_campaign_id) THEN 'COMPLETE'
    ELSE 'IN_PROGRESS'
  END,
  setup_step = CASE
    WHEN EXISTS (SELECT 1 FROM strategic_plans sp WHERE sp.campaign_id = cs.selected_campaign_id) THEN '06_READY'
    ELSE '01_BUSINESS'
  END
FROM (
  SELECT DISTINCT ON (campaign_id) id, campaign_id FROM campaign_offerings
) co
WHERE cs.selected_campaign_id = co.campaign_id
  AND cs.selected_campaign_id <> 'camp_ac86e8b8-55b'
  AND cs.business_id IS NULL;

UPDATE campaign_selections cs
SET
  business_id = 'biz_legacy_' || SUBSTRING(MD5(cs.account_id), 1, 12),
  product_id = 'prod_legacy_' || SUBSTRING(MD5(cs.selected_campaign_id), 1, 12),
  setup_status = CASE
    WHEN EXISTS (SELECT 1 FROM strategic_plans sp WHERE sp.campaign_id = cs.selected_campaign_id) THEN 'COMPLETE'
    ELSE 'IN_PROGRESS'
  END,
  setup_step = CASE
    WHEN EXISTS (SELECT 1 FROM strategic_plans sp WHERE sp.campaign_id = cs.selected_campaign_id) THEN '06_READY'
    ELSE '01_BUSINESS'
  END
WHERE cs.selected_campaign_id <> 'camp_ac86e8b8-55b'
  AND cs.business_id IS NULL;

-- 10e. Backfill competitor_relevance_decisions for Songai's existing competitors
INSERT INTO competitor_relevance_decisions (
  id,
  account_id,
  business_id,
  product_id,
  campaign_id,
  campaign_offering_id,
  bu_snapshot_id,
  competitor_id,
  candidate_domain,
  candidate_name,
  competing_offering,
  serves_buyer_need,
  buyer_need_rationale,
  target_market,
  target_market_relevance,
  competitor_type,
  decision_verdict,
  inclusion_evidence,
  unknowns_and_gaps,
  data_reuse_status,
  monitored_product_urls
)
SELECT
  'crd_' || SUBSTRING(MD5(c.campaign_id || ':' || COALESCE(c.website_url, c.name)), 1, 16),
  c.account_id,
  'biz_songai_ce5c11b9',
  'prod_songai_personalized_songs',
  c.campaign_id,
  'off_6ab47aa7-8',
  '8e16a7ca-4340-4b36-a0d4-20c26e9d965b',
  c.id,
  COALESCE(
     NULLIF(REGEXP_REPLACE(LOWER( COALESCE(c.website_url, c.name) ), '^https?://(www\.)?|/.*$', '', 'g'), ''),
    LOWER(c.name)
  ),
  c.name,
  'Personalized Custom Songs & Music Gifts',
  TRUE,
  COALESCE(c.notes, 'Verified custom song competitor serving personalized gift buyers in target market.'),
  'United Kingdom',
  COALESCE(c.geographic_classification, 'LOCAL_MARKET'),
  CASE
    WHEN c.strategic_role = 'DIRECT' THEN 'DIRECT'
    WHEN c.strategic_role IN ('ADJACENT', 'ASPIRATIONAL') THEN 'INDIRECT_SUBSTITUTE'
    ELSE 'DIRECT'
  END,
  CASE WHEN c.is_active THEN 'INCLUDED' ELSE 'EXCLUDED' END,
  jsonb_build_array(
    jsonb_build_object(
      'competitorId', c.id,
      'websiteUrl', c.website_url,
      'strategicRole', c.strategic_role
    )
  ),
  '[]'::jsonb,
  'NEWLY_ACQUIRED',
  CASE WHEN c.website_url IS NOT NULL THEN jsonb_build_array(c.website_url) ELSE '[]'::jsonb END
FROM ci_competitors c
WHERE c.campaign_id = 'camp_ac86e8b8-55b'
ON CONFLICT (campaign_id, candidate_domain) DO NOTHING;

-- 10f. Seed default account_entitlements for existing accounts
-- Preserve existing active campaign counts so no existing account is broken,
-- without upgrading or altering customer billing tiers in production.
INSERT INTO account_entitlements (
  account_id,
  package_tier,
  monthly_price_usd,
  max_active_campaigns,
  is_test_entitlement,
  notes
)
SELECT
  account_id,
  CASE
    WHEN COUNT(*) FILTER (WHERE campaign_status = 'active') > 2 THEN 'agency'
    WHEN COUNT(*) FILTER (WHERE campaign_status = 'active') = 2 THEN 'growth'
    ELSE 'starter'
  END,
  CASE
    WHEN COUNT(*) FILTER (WHERE campaign_status = 'active') > 2 THEN 699
    WHEN COUNT(*) FILTER (WHERE campaign_status = 'active') = 2 THEN 399
    ELSE 199
  END,
  CASE
    WHEN COUNT(*) FILTER (WHERE campaign_status = 'active') > 2 THEN GREATEST(4, COUNT(*) FILTER (WHERE campaign_status = 'active')::int)
    WHEN COUNT(*) FILTER (WHERE campaign_status = 'active') = 2 THEN 2
    ELSE 1
  END,
  FALSE,
  'Backfilled by migration 072 from existing active campaign count (no customer billing mutation)'
FROM campaign_selections
GROUP BY account_id
ON CONFLICT (account_id) DO NOTHING;
