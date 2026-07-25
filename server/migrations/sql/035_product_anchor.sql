-- Phase 0 — AI Proposes / Code Validates — Product Anchor
--
-- Adds a per-campaign, nullable `product_anchor` JSON column to
-- `growth_campaigns`. The anchor pins every AI-generated strategy output to
-- the level of the campaign's SPECIFIC product rather than the generic
-- business category. Existing rows stay NULL; when NULL the doctrine layer
-- degrades to business-level context and stamps
-- doctrineResolution = 'business_level_degraded' (never a silent substitute).
--
-- Shape (validated by ProductAnchorSchema in server/shared/strategic-doctrine.ts):
--   { name, type, keyAttributes[], coreProblemSolved, differentiatingFeature }
--
-- Nullable by design — this is user-supplied campaign context, not a
-- code-owned canonical fact, so no CHECK/NOT NULL constraint is applied.

ALTER TABLE growth_campaigns
  ADD COLUMN IF NOT EXISTS product_anchor jsonb;

COMMENT ON COLUMN growth_campaigns.product_anchor IS
  'Phase 0 (AI Proposes / Code Validates): nullable per-campaign product identity { name, type, keyAttributes[], coreProblemSolved, differentiatingFeature } validated by ProductAnchorSchema. NULL → doctrine degrades to business_level and stamps doctrineResolution=business_level_degraded. Editing this value must invalidate cached engine snapshots (threaded through computeInputHash via sha256(product_anchor)).';
