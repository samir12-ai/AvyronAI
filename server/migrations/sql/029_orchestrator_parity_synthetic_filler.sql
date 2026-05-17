-- Task #91 / Phase 4-C — Extend orchestrator_replay_cassettes.source to
-- include 'synthetic_filler' so the parity gate's auto-capture handler
-- can tag last-resort cassettes distinctly from hand-built 'synthetic'
-- fixtures. Path-shape coverage counts both as covering the shape, but
-- the operator panel surfaces the filler tag separately so gaps remain
-- visible even when readyForCutover=true is technically attainable.
--
-- Down-block reversal:
--   ALTER TABLE orchestrator_replay_cassettes
--     DROP CONSTRAINT orchestrator_replay_cassettes_source_chk;
--   ALTER TABLE orchestrator_replay_cassettes
--     ADD CONSTRAINT orchestrator_replay_cassettes_source_chk
--     CHECK (source IN ('production', 'synthetic'));

ALTER TABLE orchestrator_replay_cassettes
  DROP CONSTRAINT IF EXISTS orchestrator_replay_cassettes_source_chk;

ALTER TABLE orchestrator_replay_cassettes
  ADD CONSTRAINT orchestrator_replay_cassettes_source_chk
  CHECK (source IN ('production', 'synthetic', 'synthetic_filler'));
