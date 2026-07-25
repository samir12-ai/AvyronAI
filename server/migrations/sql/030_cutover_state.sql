-- Task #92 / Phase 4-D — Cutover state singleton.
--
-- Tracks the controlled-runtime cutover from the legacy inline
-- `runOrchestrator` body (`current`) to the extracted module chain
-- (`candidate`). One row (id=1). Doctrine OD-3 / OD-4 / OD-5 enforced
-- at the DB layer:
--
--   - CHECK constraint pins `traffic_percent` to the doctrine ladder
--     {0,1,5,25,50,100}. Any other value rejected at write time.
--   - BEFORE-UPDATE trigger forbids a non-zero traffic-percent
--     increment within 24h of the last_increment_at timestamp. A
--     revert-to-0 is always allowed (and updates last_revert_at).
--   - `locked_until` blocks operator promotion until expiry; the
--     auto-revert path sets this to NOW()+1h after a BLOCK divergence
--     to prevent thrash.
--
-- The trigger is intentionally STRICT: a deliberate operator who needs
-- to override the cadence must `UPDATE cutover_state SET
-- last_increment_at = NOW() - INTERVAL '25 hours' WHERE id = 1` first
-- (an explicit, auditable bypass that shows up in logs).

CREATE TABLE IF NOT EXISTS cutover_state (
  id INTEGER PRIMARY KEY DEFAULT 1,
  traffic_percent INTEGER NOT NULL DEFAULT 0,
  last_increment_at TIMESTAMPTZ,
  last_revert_at TIMESTAMPTZ,
  last_divergence_at TIMESTAMPTZ,
  locked_until TIMESTAMPTZ,
  last_actor TEXT,
  last_reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cutover_state_singleton CHECK (id = 1),
  CONSTRAINT cutover_state_traffic_ladder
    CHECK (traffic_percent IN (0, 1, 5, 25, 50, 100))
);

-- Seed the singleton row at 0 if absent.
INSERT INTO cutover_state (id, traffic_percent, updated_at)
VALUES (1, 0, NOW())
ON CONFLICT (id) DO NOTHING;

-- 24h-increment guard. Allows revert (decrease or set-to-0) any time;
-- a strict increase requires 24h since the previous increment.
CREATE OR REPLACE FUNCTION cutover_state_increment_guard()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();

  -- Always allow a decrease (operator revert) or a hold (no-op).
  IF NEW.traffic_percent <= OLD.traffic_percent THEN
    IF NEW.traffic_percent < OLD.traffic_percent THEN
      NEW.last_revert_at := NOW();
    END IF;
    RETURN NEW;
  END IF;

  -- Strict increase: must have at least 24h since last_increment_at.
  IF OLD.last_increment_at IS NOT NULL
     AND NOW() - OLD.last_increment_at < INTERVAL '24 hours' THEN
    RAISE EXCEPTION 'cutover_state: traffic-percent increment within 24h is forbidden (last_increment_at=%, attempted % → %)',
      OLD.last_increment_at, OLD.traffic_percent, NEW.traffic_percent
      USING ERRCODE = 'check_violation';
  END IF;

  -- Block promotion while locked_until is in the future.
  IF OLD.locked_until IS NOT NULL AND OLD.locked_until > NOW() THEN
    RAISE EXCEPTION 'cutover_state: traffic-percent locked until % — increment refused',
      OLD.locked_until
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.last_increment_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cutover_state_increment_guard_trigger ON cutover_state;
CREATE TRIGGER cutover_state_increment_guard_trigger
  BEFORE UPDATE ON cutover_state
  FOR EACH ROW
  EXECUTE FUNCTION cutover_state_increment_guard();
