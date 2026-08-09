-- 060: Product Anchor write audit trail.
-- Every product_anchor write must preserve writer, source, reason, previous
-- value, new value, and validation decision. Direct unaudited writes are
-- DETECTED at doctrine-seed time by comparing the live anchor hash against the
-- newest audit row (ANCHOR_WRITE_UNAUDITED loud log).
CREATE TABLE IF NOT EXISTS product_anchor_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id varchar NOT NULL,
  account_id varchar NOT NULL,
  writer text NOT NULL,             -- route/service that performed the write
  source text NOT NULL,             -- user_edit | campaign_create | dna_enrichment_resolve | ...
  reason text NOT NULL,
  previous_value jsonb,             -- null when no anchor existed before
  new_value jsonb,                  -- null when the anchor was cleared
  validation_decision text NOT NULL, -- SCHEMA_VALID | ACCEPT | REJECT | NEEDS_USER_CONFIRMATION | USER_CONFIRMED | CLEARED
  anchor_hash text NOT NULL,        -- computeAnchorHash(new_value) ("" when cleared)
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_anchor_audit_campaign_idx
  ON product_anchor_audit (campaign_id, created_at DESC);
