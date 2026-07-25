-- Seal #11 / Task #29 / F6.8 — orphan-grace tracking table.
-- Pre-fix: orphan grace was gated on snapshot timestamp (snapshot age),
-- which meant a long-lived snapshot could be purged immediately the
-- moment its campaign was deselected (no `campaigns.deleted_at` exists
-- in the schema, so we cannot gate on campaign-deletion age either).
-- Architect pass-3 required: the 7-day grace must be measured from
-- WHEN THE SNAPSHOT FIRST BECAME ORPHANED, not from snapshot age.
--
-- Now: every snapshot-cleanup tick records (table, snapshot_id) the
-- FIRST time it sees the snapshot in an orphaned state. Subsequent
-- ticks read first_observed_at; deletion only happens once
-- (now() - first_observed_at) >= 7 days. When a campaign is re-selected
-- (snapshot is no longer orphaned), the row is deleted so the grace
-- counter resets if it later becomes orphaned again.
--
-- Composite PK on (table_name, snapshot_id) — one row per snapshot per
-- snapshot-table.

-- ID column types match the existing snapshot + campaign tables
-- (varchar in shared/schema.ts — e.g. mi_snapshots.id,
-- campaign_selections.selected_campaign_id). Using uuid here would
-- cause an operator-class mismatch on the orphan subquery joins.
-- campaign_id is NOT NULL to match the drizzle model.
CREATE TABLE IF NOT EXISTS snapshot_orphan_observed (
  table_name        varchar      NOT NULL,
  snapshot_id       varchar      NOT NULL,
  campaign_id       varchar      NOT NULL,
  first_observed_at timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (table_name, snapshot_id)
);

CREATE INDEX IF NOT EXISTS snapshot_orphan_observed_first_observed_at_idx
  ON snapshot_orphan_observed (first_observed_at);
CREATE INDEX IF NOT EXISTS snapshot_orphan_observed_campaign_id_idx
  ON snapshot_orphan_observed (campaign_id);
