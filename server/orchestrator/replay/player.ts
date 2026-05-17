/**
 * Task #89 / Phase 4-A — Replay player.
 *
 * Accepts a `ReplayCassette` and a candidate orchestrator function. Wires up
 * the strict LLM mock (zero network), drives the candidate with the same
 * inputs the cassette was recorded with, captures the candidate's actual
 * observation shape, then runs the divergence classifier.
 *
 * No network calls. The candidate orchestrator is responsible for taking the
 * StrictLlmMock in its `llmAdapter` slot (P4-B will wire this through; today
 * the player exposes the mock so the synthetic-cassette tests can use it
 * directly, proving the divergence machinery works).
 */
import { hashValue } from "./hash";
import { classifyReplay, passes } from "./diff";
import { recordPlayerRun } from "./cv13-metrics";
import { StrictLlmMock } from "./llm-strict-mock";
import { REPLAY_CASSETTE_SCHEMA_VERSION } from "./types";
import type {
  ActualReplayObservation,
  ExpectedReplayObservation,
} from "./diff";
import type { ReplayCassette, ReplayResult } from "./types";

export class ReplayCassetteVersionError extends Error {}

export interface CandidateOrchestrator {
  run(
    input: ReplayCassette["body"]["input"],
    llm: StrictLlmMock,
  ): Promise<ActualReplayObservation>;
}

export interface PlayOptions {
  now?: () => number;
}

export async function play(
  cassette: ReplayCassette,
  candidate: CandidateOrchestrator,
  opts: PlayOptions = {},
): Promise<ReplayResult> {
  const now = opts.now ?? (() => Date.now());
  if (cassette.body.schemaVersion !== REPLAY_CASSETTE_SCHEMA_VERSION) {
    throw new ReplayCassetteVersionError(
      `Unsupported cassette schemaVersion=${cassette.body.schemaVersion}; expected ${REPLAY_CASSETTE_SCHEMA_VERSION}`,
    );
  }

  const llm = new StrictLlmMock(cassette.body.llmCalls);
  const startedAt = now();
  let actual: ActualReplayObservation;
  try {
    actual = await candidate.run(cassette.body.input, llm);
  } catch (err) {
    recordPlayerRun("ERROR");
    throw err;
  }
  const engineWallClockMs = now() - startedAt;

  const expected: ExpectedReplayObservation = {
    finalResult: cassette.body.finalResult,
    systemControlVerdict: cassette.body.systemControlVerdict,
    budgetLedger: cassette.body.budgetLedger,
    engineOrder: cassette.body.engineOutputs.map((e) => e.engineId),
    planPersist: cassette.body.planPersist,
    contextKeys: cassette.body.contextResolved.contextKeys,
    inputHashes: cassette.body.contextResolved.inputHashes,
  };

  const divergences = classifyReplay(expected, actual);
  const ok = passes(divergences);
  recordPlayerRun(ok ? "PASS" : "FAIL");

  const finalPlanHash = hashValue({
    planId: actual.finalResult.planId,
    completedEngines: actual.finalResult.completedEngines,
  });
  const finalVerdictHash = hashValue({
    integrityVerdict: actual.systemControlVerdict?.integrityVerdict,
    executionMode: actual.systemControlVerdict?.executionMode,
    blockReasons: actual.systemControlVerdict?.blockReasons ?? [],
  });

  return {
    cassetteHash: cassette.cassetteHash,
    divergences,
    engineWallClockMs,
    finalPlanHash,
    finalVerdictHash,
    passed: ok,
  };
}
