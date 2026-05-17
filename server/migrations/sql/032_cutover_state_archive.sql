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
-- Trigger drop: the Phase 4-D `cutover_state_increment_guard` BEFORE-
-- UPDATE trigger is removed unconditionally — no writer remains.
DROP TRIGGER IF EXISTS cutover_state_increment_guard ON cutover_state;
DROP FUNCTION IF EXISTS cutover_state_increment_guard_fn();

ALTER TABLE IF EXISTS cutover_state RENAME TO cutover_state_archive;

COMMENT ON TABLE cutover_state_archive IS
  'Task #93 / P4-E archive of the deleted Phase 4-D cutover singleton. Read-only forensics; safe to DROP after 30d retention window.';
