-- Task #92 / Phase 4-D — cassette purpose tag.
--
-- Phase 4-D ships hand-crafted cassettes that INTENTIONALLY produce
-- divergence under the candidate orchestrator (the divergence is the
-- proof that the behavioral change took effect). Without a tag, those
-- cassettes would block `readyForCutover` forever by polluting the
-- parity gate's BLOCK-divergence histogram.
--
-- `purpose` discriminates:
--   - 'parity'                  — historical default; expected to match
--                                  current ≡ candidate byte-for-byte.
--   - 'behavioral_change_proof' — expected to diverge; parity gate
--                                  excludes these from its histogram.
--
-- Existing rows backfill to 'parity'. NOT NULL after backfill.

ALTER TABLE orchestrator_replay_cassettes
  ADD COLUMN IF NOT EXISTS purpose TEXT;

UPDATE orchestrator_replay_cassettes
  SET purpose = 'parity'
  WHERE purpose IS NULL;

ALTER TABLE orchestrator_replay_cassettes
  ALTER COLUMN purpose SET NOT NULL,
  ALTER COLUMN purpose SET DEFAULT 'parity';

ALTER TABLE orchestrator_replay_cassettes
  DROP CONSTRAINT IF EXISTS orchestrator_replay_cassettes_purpose_chk;

ALTER TABLE orchestrator_replay_cassettes
  ADD CONSTRAINT orchestrator_replay_cassettes_purpose_chk
  CHECK (purpose IN ('parity', 'behavioral_change_proof'));

CREATE INDEX IF NOT EXISTS orchestrator_replay_cassettes_purpose_idx
  ON orchestrator_replay_cassettes (purpose);
