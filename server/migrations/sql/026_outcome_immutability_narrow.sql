-- Task #65 / Phase 2 — narrow the decision_outcomes immutability trigger.
--
-- Migration 025 installed `decision_outcomes_immutable_after_eval()` that
-- raised on ANY update when OLD.outcome IS NOT NULL. Code review (#65)
-- flagged this as stricter than documented intent: administrative metadata
-- patches (e.g. backfilling attribution columns) on already-evaluated rows
-- should be permitted as long as the verdict itself does not change.
--
-- This migration replaces the function so it raises only when:
--   (a) OLD.outcome IS NOT NULL (row has been evaluated), AND
--   (b) NEW.outcome IS DISTINCT FROM OLD.outcome (verdict would change).
--
-- IS DISTINCT FROM correctly handles NULL-to-non-NULL and non-NULL-to-NULL
-- transitions as "different"; same-value updates pass through silently.

CREATE OR REPLACE FUNCTION decision_outcomes_immutable_after_eval()
RETURNS trigger AS $$
BEGIN
  IF OLD.outcome IS NOT NULL AND NEW.outcome IS DISTINCT FROM OLD.outcome THEN
    RAISE EXCEPTION 'DECISION_OUTCOME_IMMUTABLE: outcome already set to "%" on row % (decision=%, evaluated_at=%); attempted to re-evaluate as "%" — post-evaluation verdict mutation is forbidden (Task #65 / Phase 2 step 1).',
      OLD.outcome, OLD.id, OLD.decision_id, OLD.evaluated_at, NEW.outcome;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
