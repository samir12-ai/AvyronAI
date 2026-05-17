-- Task #65 / Phase 2 — Memory Unification.
--
-- (a) Add `decision_id` FK on strategy_memory referencing strategy_decisions(id).
--     Pre-#65 the outcome-tracker reinforcement path issued
--       UPDATE strategy_memory SET ... WHERE id = p.decisionId
--     where p.decisionId is actually a strategy_decisions.id — an id-space
--     mismatch that silently updated zero rows for months. The FK gives the
--     reinforcement path a real binding key.
-- (b) Add `provenance_origin` so non-outcome writes (engine seeds, mutation
--     verdicts, exploration results) declare their provenance explicitly.
-- (c) Decision-outcomes immutability trigger: once `outcome` is non-null
--     (i.e. the row has been evaluated), no subsequent UPDATE may mutate it.
--     This guarantees the memory-to-outcome provenance link from Phase 1 is
--     stable — a memory row reinforced from outcome X can never be silently
--     re-pointed at a different verdict.
--
-- Backfill: existing strategy_memory rows have NULL decision_id and
-- provenance_origin='unknown'. Reads tolerate this; new reinforcement
-- writes populate both fields. A follow-up sweep can backfill from
-- source_outcome_id → decisionOutcomes.decision_id once observed safe.

ALTER TABLE strategy_memory
  ADD COLUMN IF NOT EXISTS decision_id varchar
    REFERENCES strategy_decisions(id) ON DELETE SET NULL;

ALTER TABLE strategy_memory
  ADD COLUMN IF NOT EXISTS provenance_origin text DEFAULT 'unknown';

CREATE INDEX IF NOT EXISTS strategy_memory_decision_id_idx
  ON strategy_memory (decision_id)
  WHERE decision_id IS NOT NULL;

-- Confidence-banded reader index (replaces the limit(100) order-by-updatedAt
-- scan in loadMemoryBlock that allowed recent low-confidence rows to
-- displace older high-confidence ones).
CREATE INDEX IF NOT EXISTS strategy_memory_account_campaign_confidence_idx
  ON strategy_memory (account_id, campaign_id, confidence_score DESC NULLS LAST, updated_at DESC);

-- Decision outcomes immutability trigger.
-- NOTE: the function body below is the v1 installed by this migration; it
-- was narrowed in 026_outcome_immutability_narrow.sql to permit metadata
-- patches on already-evaluated rows (only verdict CHANGES raise). The
-- CREATE OR REPLACE in 026 supersedes this definition at runtime; this DDL
-- is kept here so a fresh DB still gets the trigger in one apply.
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

DROP TRIGGER IF EXISTS decision_outcomes_immutable_after_eval_trg ON decision_outcomes;
CREATE TRIGGER decision_outcomes_immutable_after_eval_trg
  BEFORE UPDATE ON decision_outcomes
  FOR EACH ROW
  EXECUTE FUNCTION decision_outcomes_immutable_after_eval();
