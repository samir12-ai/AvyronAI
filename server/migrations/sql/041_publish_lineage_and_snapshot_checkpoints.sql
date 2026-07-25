-- P-1: Wire Publish Lineage + Revive Outcome Tracker (data-plumbing only).
--
-- WHY (Part 1 — publish lineage): published_posts persisted goal/audience/cta/
-- series/offer/campaign_id but NO plan-level lineage (plan_id, calendar_entry_id,
-- studio_item_id, hook_style, content_angle, planned_slot). The outcome tracker's
-- action-scope join (published_posts.media_item_id IN studio_items.id) is
-- structurally dead — media_item_id holds client-generated media library ids
-- that never match studio_items.id (verified: 0 matches). studio_item_id gives
-- the tracker a real FK-shaped join key captured at publish time.
--
-- lineage_source is an explicit classification (B4 — explicit classification
-- over hidden ambiguity):
--   'planned'   — post traceable to a plan-generated calendar entry.
--   'unplanned' — user manual publish; measured but excluded from plan scoring.
--   'legacy'    — row predates this migration; lineage unknowable, flagged not faked.
--
-- WHY (Part 2 — snapshot checkpoints): performance_snapshots had no capture-point
-- tag, and the publish-worker 6h loop overwrites published_posts metrics in place
-- (history destroyed). The revisit scheduler appends one snapshot row per post per
-- checkpoint (24h/72h/7d after publish). checkpoint classifies every row's origin:
--   'sync'  — legacy/manual Meta sync route (default for all pre-existing rows).
--   '24h' | '72h' | '7d' — revisit-scheduler checkpoints (append-only history).
--   'adhoc' — manually triggered revisit outside the fixed checkpoints.
--
-- Idempotency: UNIQUE (post_id, checkpoint) partial index over the scheduled
-- checkpoints lets the scheduler INSERT ... ON CONFLICT DO NOTHING — multi-replica
-- safe (no select-then-insert race), per MULTI-REPLICA-SAFE doctrine.

ALTER TABLE published_posts ADD COLUMN IF NOT EXISTS plan_id varchar;
ALTER TABLE published_posts ADD COLUMN IF NOT EXISTS calendar_entry_id varchar;
ALTER TABLE published_posts ADD COLUMN IF NOT EXISTS studio_item_id varchar;
ALTER TABLE published_posts ADD COLUMN IF NOT EXISTS hook_style text;
ALTER TABLE published_posts ADD COLUMN IF NOT EXISTS content_angle text;
ALTER TABLE published_posts ADD COLUMN IF NOT EXISTS planned_slot text;
ALTER TABLE published_posts ADD COLUMN IF NOT EXISTS lineage_source text NOT NULL DEFAULT 'unplanned';

-- Rows existing before this migration cannot prove their lineage — flag, don't fake.
UPDATE published_posts SET lineage_source = 'legacy';

ALTER TABLE published_posts DROP CONSTRAINT IF EXISTS published_posts_lineage_source_check;
ALTER TABLE published_posts ADD CONSTRAINT published_posts_lineage_source_check
  CHECK (lineage_source IN ('planned', 'unplanned', 'legacy'));

CREATE INDEX IF NOT EXISTS published_posts_studio_item_idx
  ON published_posts (studio_item_id) WHERE studio_item_id IS NOT NULL;

ALTER TABLE performance_snapshots ADD COLUMN IF NOT EXISTS checkpoint text NOT NULL DEFAULT 'sync';

-- Meta's post_engaged_users metric had no honest home (legacy columns are
-- integer DEFAULT 0 — a fabricated zero for never-fetched metrics). Nullable,
-- NO default: null means "not captured", 0 means "Meta returned 0".
ALTER TABLE performance_snapshots ADD COLUMN IF NOT EXISTS engaged_users integer;

ALTER TABLE performance_snapshots DROP CONSTRAINT IF EXISTS performance_snapshots_checkpoint_check;
ALTER TABLE performance_snapshots ADD CONSTRAINT performance_snapshots_checkpoint_check
  CHECK (checkpoint IN ('sync', '24h', '72h', '7d', 'adhoc'));

-- One snapshot per (post, scheduled checkpoint); 'sync'/'adhoc' rows are unlimited.
CREATE UNIQUE INDEX IF NOT EXISTS performance_snapshots_post_checkpoint_uidx
  ON performance_snapshots (post_id, checkpoint)
  WHERE checkpoint IN ('24h', '72h', '7d');

COMMENT ON COLUMN published_posts.lineage_source IS
  'Explicit publish lineage classification: planned (from a plan calendar entry), unplanned (manual publish, excluded from plan scoring), legacy (predates lineage wiring — unknowable, never faked).';
COMMENT ON COLUMN performance_snapshots.checkpoint IS
  'Capture-point tag: sync (manual Meta sync route), 24h/72h/7d (revisit-scheduler append-only checkpoints), adhoc (manual revisit).';
