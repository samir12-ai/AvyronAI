-- Migration 054: Delete Legacy Competitor Source Authority & Establish competitor_sources as Sole Authority

BEGIN;

-- 1. One-time safe data preservation of genuine verified social URLs before column deletion
-- Instagram preservation (only if real instagram.com URL)
INSERT INTO competitor_sources (
  id, competitor_id, campaign_id, account_id, platform, canonical_url, external_account_id, status, last_verified_at, created_at
)
SELECT 
  gen_random_uuid()::varchar,
  c.id,
  c.campaign_id,
  c.account_id,
  'INSTAGRAM',
  TRIM(c.profile_link),
  SUBSTRING(TRIM(c.profile_link) FROM 'instagram.com/([a-zA-Z0-9_.-]+)'),
  'VERIFIED',
  NOW(),
  NOW()
FROM ci_competitors c
WHERE c.profile_link IS NOT NULL 
  AND c.profile_link ILIKE '%instagram.com%'
  AND NOT EXISTS (
    SELECT 1 FROM competitor_sources cs 
    WHERE cs.competitor_id = c.id 
      AND cs.platform = 'INSTAGRAM'
  );

-- TikTok preservation (only if real tiktok.com URL)
INSERT INTO competitor_sources (
  id, competitor_id, campaign_id, account_id, platform, canonical_url, external_account_id, status, last_verified_at, created_at
)
SELECT 
  gen_random_uuid()::varchar,
  c.id,
  c.campaign_id,
  c.account_id,
  'TIKTOK',
  TRIM(c.tiktok_url),
  SUBSTRING(TRIM(c.tiktok_url) FROM 'tiktok.com/@?([a-zA-Z0-9_.-]+)'),
  'VERIFIED',
  NOW(),
  NOW()
FROM ci_competitors c
WHERE c.tiktok_url IS NOT NULL 
  AND c.tiktok_url ILIKE '%tiktok.com%'
  AND NOT EXISTS (
    SELECT 1 FROM competitor_sources cs 
    WHERE cs.competitor_id = c.id 
      AND cs.platform = 'TIKTOK'
  );

-- Google Maps preservation
INSERT INTO competitor_sources (
  id, competitor_id, campaign_id, account_id, platform, canonical_url, status, last_verified_at, created_at
)
SELECT 
  gen_random_uuid()::varchar,
  c.id,
  c.campaign_id,
  c.account_id,
  'GOOGLE_MAPS',
  TRIM(c.google_maps_url),
  'VERIFIED',
  NOW(),
  NOW()
FROM ci_competitors c
WHERE c.google_maps_url IS NOT NULL 
  AND LENGTH(TRIM(c.google_maps_url)) > 5
  AND NOT EXISTS (
    SELECT 1 FROM competitor_sources cs 
    WHERE cs.competitor_id = c.id 
      AND cs.platform = 'GOOGLE_MAPS'
  );

-- Blog preservation
INSERT INTO competitor_sources (
  id, competitor_id, campaign_id, account_id, platform, canonical_url, status, last_verified_at, created_at
)
SELECT 
  gen_random_uuid()::varchar,
  c.id,
  c.campaign_id,
  c.account_id,
  'BLOG',
  TRIM(c.blog_url),
  'VERIFIED',
  NOW(),
  NOW()
FROM ci_competitors c
WHERE c.blog_url IS NOT NULL 
  AND LENGTH(TRIM(c.blog_url)) > 5
  AND NOT EXISTS (
    SELECT 1 FROM competitor_sources cs 
    WHERE cs.competitor_id = c.id 
      AND cs.platform = 'BLOG'
  );

-- 2. Deduplicate any duplicate competitor_sources rows before unique index creation
DELETE FROM competitor_sources a USING (
  SELECT MIN(ctid) as min_ctid, competitor_id, platform, canonical_url
  FROM competitor_sources 
  GROUP BY competitor_id, platform, canonical_url 
  HAVING COUNT(*) > 1
) b
WHERE a.competitor_id = b.competitor_id 
  AND a.platform = b.platform 
  AND a.canonical_url = b.canonical_url 
  AND a.ctid <> b.min_ctid;

-- 3. Add compound unique index on competitor_sources
CREATE UNIQUE INDEX IF NOT EXISTS uidx_competitor_sources_comp_plat_url 
ON competitor_sources (competitor_id, platform, canonical_url);

-- 4. Add source_id to evidence tables
ALTER TABLE ci_competitor_posts 
ADD COLUMN IF NOT EXISTS source_id varchar(128);

CREATE INDEX IF NOT EXISTS idx_ci_posts_source_id 
ON ci_competitor_posts (source_id);

ALTER TABLE ci_competitor_comments 
ADD COLUMN IF NOT EXISTS source_id varchar(128);

CREATE INDEX IF NOT EXISTS idx_ci_comments_source_id 
ON ci_competitor_comments (source_id);

ALTER TABLE ci_competitor_reviews 
ADD COLUMN IF NOT EXISTS source_id varchar(128);

CREATE INDEX IF NOT EXISTS idx_ci_reviews_source_id 
ON ci_competitor_reviews (source_id);

-- 5. Drop legacy columns from ci_competitors
ALTER TABLE ci_competitors DROP COLUMN IF EXISTS profile_link;
ALTER TABLE ci_competitors DROP COLUMN IF EXISTS tiktok_url;
ALTER TABLE ci_competitors DROP COLUMN IF EXISTS google_maps_url;
ALTER TABLE ci_competitors DROP COLUMN IF EXISTS blog_url;
ALTER TABLE ci_competitors DROP COLUMN IF EXISTS platform;

COMMIT;
