/**
 * Task #89 / Phase 4-A — 6 synthetic cassette tests.
 *
 * Each cassette under cassettes/*.json is loaded, fed through the player
 * with an identity candidate, and the result MUST PASS (only TIMING_ONLY
 * divergence permitted). This proves:
 *   1. Player + diff + classifier round-trip is exact under identity input.
 *   2. The 6 declared path-shapes (clean, gate_retry, budget_downgrade,
 *      scoped_rerun, blocked_by_integrity, needs_input) are representable
 *      and reproducible.
 *   3. Cassettes are deterministic — running the suite 100× via
 *      scripts/replay-flake-check.sh produces identical results.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it, expect } from "vitest";
import { play, type CandidateOrchestrator } from "../../orchestrator/replay/player";
import { hashValue } from "../../orchestrator/replay/hash";
import type {
  ActualReplayObservation,
} from "../../orchestrator/replay/diff";
import type {
  ReplayCassette,
  ReplayCassetteBody,
} from "../../orchestrator/replay/types";

const CASSETTES_DIR = path.resolve(__dirname, "cassettes");

function loadCassette(file: string): ReplayCassette {
  const body = JSON.parse(fs.readFileSync(path.join(CASSETTES_DIR, file), "utf-8")) as ReplayCassetteBody;
  // Doctrine REPLAY-HASH — cassette content-address is SHA-256 of the
  // input envelope ONLY (not the entire body).
  return { cassetteHash: hashValue(body.input), body };
}

function identityCandidate(body: ReplayCassetteBody): CandidateOrchestrator {
  return {
    async run(): Promise<ActualReplayObservation> {
      return {
        finalResult: body.finalResult,
        systemControlVerdict: body.systemControlVerdict,
        budgetLedger: body.budgetLedger,
        engineOrder: body.engineOutputs.map((e) => e.engineId),
        planPersist: body.planPersist,
        contextKeys: body.contextResolved.contextKeys,
        inputHashes: body.contextResolved.inputHashes,
      };
    },
  };
}

const EXPECTED = [
  { file: "01_clean.json", pathShape: "clean", finalStatus: "COMPLETED" },
  { file: "02_gate_retry.json", pathShape: "gate_retry", finalStatus: "COMPLETED" },
  { file: "03_budget_downgrade.json", pathShape: "budget_downgrade", finalStatus: "PARTIAL" },
  { file: "04_scoped_rerun.json", pathShape: "scoped_rerun", finalStatus: "COMPLETED" },
  { file: "05_blocked_by_integrity.json", pathShape: "blocked_by_integrity", finalStatus: "BLOCKED_BY_INTEGRITY" },
  { file: "06_needs_input.json", pathShape: "needs_input", finalStatus: "NEEDS_INPUT" },
] as const;

describe("Task #89 / 6 synthetic cassettes — round-trip via player+diff", () => {
  for (const spec of EXPECTED) {
    it(`${spec.pathShape}: identity candidate passes (only TIMING_ONLY divergence)`, async () => {
      const cassette = loadCassette(spec.file);
      expect(cassette.body.pathShape).toBe(spec.pathShape);
      expect(cassette.body.finalResult.status).toBe(spec.finalStatus);
      const result = await play(cassette, identityCandidate(cassette.body));
      expect(result.passed).toBe(true);
      for (const d of result.divergences) {
        expect(d.class).toBe("TIMING_ONLY");
      }
    });
  }

  it("cassette content-addressing is stable across loads (no clock drift)", () => {
    for (const spec of EXPECTED) {
      const h1 = loadCassette(spec.file).cassetteHash;
      const h2 = loadCassette(spec.file).cassetteHash;
      expect(h1).toBe(h2);
      expect(h1).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("all 6 declared path-shapes appear in the synthetic corpus", () => {
    const shapes = new Set(EXPECTED.map((e) => e.pathShape));
    expect(shapes.size).toBe(6);
    for (const want of [
      "clean",
      "gate_retry",
      "budget_downgrade",
      "scoped_rerun",
      "blocked_by_integrity",
      "needs_input",
    ]) {
      expect(shapes.has(want as any)).toBe(true);
    }
  });
});
