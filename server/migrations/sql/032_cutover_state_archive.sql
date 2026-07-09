-- Task #93 / Phase 4-E — Archive `cutover_state` singleton.
--
-- The Phase 4-D cutover system (admin routes, dispatch HOF, parity
-- auto-revert, recordPersistCall counters) was deleted in Task #93.
-- The table is renamed to `cutover_state_archive` so any operator
-- forensics (audit of the final trafficPercent + lastReason at the
-- time of cleanup) remain queryable for the 30d retention window.
--
-- After 30d an operator MAY:
--   DROP TABLE IF EXISTS cutover_state_archive;
--
-- 2026-07-09 state-aware rewrite (publish-sync collision fix):
-- On a production DB provisioned by Replit's publish-time schema sync,
-- `cutover_state_archive` ALREADY EXISTS (copied from the dev schema)
-- before this migration ever runs, while `cutover_state` is a freshly
-- replayed default singleton recreated by migration 030 moments
-- earlier in the same boot. The original unconditional RENAME failed
-- there with `relation "cutover_state_archive" already exists`,
-- crashing every production boot. This version handles every state:
--   * only cutover_state exists           → rename (original behaviour)
--   * BOTH exist (publish-sync collision) → drop the replayed
--     cutover_state singleton; the synced archive is authoritative
--   * only archive exists / neither       → no-op (already done)
-- Editing this file is safe: databases that already recorded version 32
-- in schema_migrations (e.g. dev) never re-execute it.
DO $$
BEGIN
  IF to_regclass('public.cutover_state') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS cutover_state_increment_guard ON cutover_state;
    IF to_regclass('public.cutover_state_archive') IS NULL THEN
      ALTER TABLE cutover_state RENAME TO cutover_state_archive;
    ELSE
      DROP TABLE cutover_state;
    END IF;
  END IF;

  IF to_regclass('public.cutover_state_archive') IS NOT NULL THEN
    COMMENT ON TABLE cutover_state_archive IS
      'Task #93 / P4-E archive of the deleted Phase 4-D cutover singleton. Read-only forensics; safe to DROP after 30d retention window.';
  END IF;
END $$;

DROP FUNCTION IF EXISTS cutover_state_increment_guard_fn();
