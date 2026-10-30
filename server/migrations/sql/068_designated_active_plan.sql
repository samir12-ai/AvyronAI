-- Migration 068: Add is_designated_active to strategic_plans with partial unique index
ALTER TABLE strategic_plans 
ADD COLUMN IF NOT EXISTS is_designated_active BOOLEAN NOT NULL DEFAULT false;

-- Create partial unique index ensuring at most one active execution plan per account & campaign
CREATE UNIQUE INDEX IF NOT EXISTS strategic_plans_designated_active_idx
ON strategic_plans (account_id, campaign_id)
WHERE is_designated_active = true;
