/**
 * Task #89 / Phase 4-A — Replay CLI.
 *
 * Subcommands:
 *   list                                — list cassettes (source, hash, age)
 *   run --cassette <hash> [--against current|candidate]
 *                                       — replay cassette against current
 *                                         orchestrator (default) or a candidate.
 *                                         Exit code is non-zero on any
 *                                         non-TIMING_ONLY divergence.
 *   capture-synthetic [--dir <path>]    — load every JSON cassette under
 *                                         server/tests/orchestrator-replay/
 *                                         cassettes/ into the DB so the
 *                                         operator panel + CV-13 coverage
 *                                         matrix include the synthetic floor.
 *
 * The "current orchestrator" candidate is intentionally a STUB in this
 * phase — the player accepts any CandidateOrchestrator; the real wiring
 * lands in P4-B when the orchestrator is decomposed enough to be invoked
 * with a StrictLlmMock-injected llmAdapter. The stub here exists so the
 * CLI surface is real and the exit-code contract is testable.
 */
/* eslint-disable no-console */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../server/db";
import { hashValue } from "../server/orchestrator/replay/hash";
import { play, type CandidateOrchestrator } from "../server/orchestrator/replay/player";
import { StrictLlmMock, withStrictLlmMock } from "../server/orchestrator/replay/llm-strict-mock";
import { groupByClass } from "../server/orchestrator/replay/diff";
import type {
  ActualReplayObservation,
} from "../server/orchestrator/replay/diff";
import type { ReplayCassette, ReplayCassetteBody } from "../server/orchestrator/replay/types";
import { REPLAY_CASSETTE_SCHEMA_VERSION } from "../server/orchestrator/replay/types";

const SYNTHETIC_DIR = path.resolve(
  process.cwd(),
  "server",
  "tests",
  "orchestrator-replay",
  "cassettes",
);

function parseArgs(argv: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out.set(key, next);
      i++;
    } else {
      out.set(key, "true");
    }
  }
  return out;
}

async function cmdList(): Promise<number> {
  const rows = await pool.query<{ cassette_hash: string; source: string; path_shape: string | null; captured_at: Date }>(
    `SELECT cassette_hash, source, path_shape, captured_at
     FROM orchestrator_replay_cassettes ORDER BY captured_at DESC LIMIT 200`,
  );
  console.log(`# Replay cassettes (most-recent 200):`);
  console.log(`# hash                                                              source     path_shape            captured_at`);
  for (const r of rows.rows) {
    console.log(
      `${r.cassette_hash.padEnd(66)} ${r.source.padEnd(10)} ${(r.path_shape ?? "-").padEnd(22)} ${new Date(r.captured_at).toISOString()}`,
    );
  }
  console.log(`# total=${rows.rows.length}`);
  return 0;
}

/**
 * Adapter that drives the REAL `runOrchestrator` with the cassette's input
 * envelope and projects its `OrchestratorRunResult` into an
 * `ActualReplayObservation` the diff classifier understands.
 *
 * Task #89 / P4-A — HERMETIC. The candidate wraps `runOrchestrator(...)`
 * in `withStrictLlmMock(llm, () => ...)`. ai-client.aiChat / aiGemini
 * detect the bound mock via ALS and short-circuit BEFORE any provider
 * call. Zero network, zero token spend. A mock miss surfaces as a
 * `LlmMockMissError` and the player classifies it STRUCTURAL — never a
 * re-roll.
 */
/**
 * Narrow projection of `OrchestratorRunResult` used by the CLI adapter.
 * Mirrors only the fields the diff classifier needs. Keeping this typed
 * (instead of `as any`) means any drift in `OrchestratorRunResult` will
 * surface as a compile error in this file — the brittle integration
 * boundary stays observable to TypeScript.
 */
interface OrchestratorRunResultProjection {
  jobId: string;
  status: "COMPLETED" | "PARTIAL" | "BLOCKED" | "ERROR" | "NEEDS_INPUT" | "BLOCKED_BY_INTEGRITY";
  completedEngines: string[];
  failedEngine?: string;
  blockReason?: string;
  planId?: string;
  durationMs: number;
  controlVerdict?: {
    integrityVerdict: "PASS" | "PARTIAL" | "FAIL";
    executionMode?: "FULL" | "DEGRADED" | "HALT";
    blockReasons?: string[];
  };
  budgetDecisionLedger?: Array<{
    finalAction: "test" | "scale" | "hold" | "halt";
    downgradeReasons?: string[];
  }>;
  results?: Map<string, unknown>;
}

function currentOrchestratorCandidate(): CandidateOrchestrator {
  return {
    async run(input, llm: StrictLlmMock) {
      // Lazy import so `replay:list` / `capture-synthetic` don't pull the
      // whole orchestrator graph into memory.
      const orch = (await import("../server/orchestrator/index")) as {
        runOrchestrator: (cfg: {
          campaignId: string;
          accountId: string;
          forceRefresh?: boolean;
          scopedEngines?: string[];
          resumeFromEngine?: string;
          pausedJobId?: string;
        }) => Promise<OrchestratorRunResultProjection>;
      };
      // Bind the strict mock to the async context so every aiChat/aiGemini
      // call originating inside runOrchestrator routes through it. This
      // is what makes --against current HERMETIC.
      const result: OrchestratorRunResultProjection = await withStrictLlmMock(llm, () =>
        orch.runOrchestrator({
          campaignId: input.campaignId,
          accountId: input.accountId,
          forceRefresh: !!input.forceRefresh,
          scopedEngines: input.scopedEngines,
          resumeFromEngine: input.resumeFromEngine,
          pausedJobId: input.pausedJobId,
        }),
      );
      const verdict = result.controlVerdict
        ? {
            integrityVerdict: result.controlVerdict.integrityVerdict,
            executionMode: result.controlVerdict.executionMode ?? "FULL",
            blockReasons: result.controlVerdict.blockReasons ?? [],
          }
        : undefined;
      const obs: ActualReplayObservation = {
        finalResult: {
          jobId: result.jobId,
          status: result.status,
          completedEngines: result.completedEngines ?? [],
          failedEngine: result.failedEngine,
          blockReason: result.blockReason ?? null,
          planId: result.planId ?? null,
          durationMs: result.durationMs,
          controlVerdict: verdict,
          ledgerEntryCount: result.budgetDecisionLedger?.length ?? 0,
        },
        systemControlVerdict: verdict,
        budgetLedger: (result.budgetDecisionLedger ?? []).map((e) => ({
          engineId: "budget_governor",
          decisionAction: e.finalAction,
          downgradeReason: (e.downgradeReasons ?? []).join(",") || null,
          appliedAt: 0,
        })),
        engineOrder: Array.from(result.results?.keys() ?? []),
        contextKeys: [],
        inputHashes: {},
      };
      return obs;
    },
  };
}

/**
 * Identity candidate — replays cassette inputs by echoing the cassette's own
 * observation. Used by `--against candidate` as the harness smoke target: it
 * exercises every code path from cassette load → mock injection → classifier
 * with deterministic, hermetic inputs, so any FAIL is a harness bug.
 */
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

async function cmdRun(args: Map<string, string>): Promise<number> {
  const hash = args.get("cassette");
  if (!hash) {
    console.error("--cassette <hash> is required");
    return 2;
  }
  const against = args.get("against") ?? "current";
  const row = await pool.query<{ body: ReplayCassetteBody }>(
    `SELECT body FROM orchestrator_replay_cassettes WHERE cassette_hash = $1`,
    [hash],
  );
  if (row.rows.length === 0) {
    console.error(`No cassette with hash=${hash}`);
    return 2;
  }
  const body = row.rows[0].body;
  if (body.schemaVersion !== REPLAY_CASSETTE_SCHEMA_VERSION) {
    console.error(`Cassette schemaVersion=${body.schemaVersion} is not supported (expected ${REPLAY_CASSETTE_SCHEMA_VERSION})`);
    return 3;
  }
  const cassette: ReplayCassette = { cassetteHash: hash, body };
  if (against !== "current" && against !== "candidate") {
    console.error(`--against must be 'current' or 'candidate' (got ${against})`);
    return 2;
  }
  // P4-A wiring:
  //   --against current   → runs real `runOrchestrator(cassette.input)` and
  //                         projects its result into ActualReplayObservation
  //                         (NON-HERMETIC until P4-B injects StrictLlmMock).
  //   --against candidate → identity candidate (echoes cassette body) — used
  //                         as the harness smoke target so CI can keep a
  //                         deterministic green replay run while the real
  //                         current candidate is non-hermetic.
  const candidate = against === "current"
    ? currentOrchestratorCandidate()
    : identityCandidate(body);
  if (against === "current") {
    console.log(`# --against current: HERMETIC (StrictLlmMock bound via ALS; zero network).`);
  }
  const result = await play(cassette, candidate);
  const grouped = groupByClass(result.divergences);
  console.log(`# Replay against=${against} cassette=${hash}`);
  console.log(`# passed=${result.passed} divergences=${result.divergences.length} engineWallClockMs=${result.engineWallClockMs}`);
  console.log(`# finalPlanHash=${result.finalPlanHash}`);
  console.log(`# finalVerdictHash=${result.finalVerdictHash}`);
  for (const [k, list] of Object.entries(grouped)) {
    if (list.length === 0) continue;
    console.log(`\n## ${k} (${list.length})`);
    for (const d of list) {
      console.log(`  - ${d.path}: expected=${JSON.stringify(d.expected)} actual=${JSON.stringify(d.actual)}`);
    }
  }
  return result.passed ? 0 : 1;
}

async function cmdCaptureSynthetic(args: Map<string, string>): Promise<number> {
  const dir = args.get("dir") ?? SYNTHETIC_DIR;
  if (!fs.existsSync(dir)) {
    console.error(`Synthetic cassette dir not found: ${dir}`);
    return 2;
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  let loaded = 0;
  for (const f of files) {
    const full = path.join(dir, f);
    const body = JSON.parse(fs.readFileSync(full, "utf-8")) as ReplayCassetteBody;
    // Doctrine REPLAY-HASH — cassette content-address is SHA-256 of the
    // INPUT envelope ONLY (not the entire body). Must stay in lock-step
    // with `LiveRecorder.finalize()` so a synthetic cassette captured
    // here can be resolved by the player using the same hash a
    // recorder-produced cassette of the same input would emit.
    const hash = hashValue(body.input);
    await pool.query(
      `INSERT INTO orchestrator_replay_cassettes
        (cassette_hash, schema_version, source, captured_at, redaction_applied,
         path_shape, campaign_id, account_id, body)
       VALUES ($1, $2, 'synthetic', $3, true, $4, $5, $6, $7::jsonb)
       ON CONFLICT (cassette_hash) DO NOTHING`,
      [
        hash,
        body.schemaVersion,
        body.capturedAt,
        body.pathShape,
        body.input.campaignId,
        body.input.accountId,
        JSON.stringify(body),
      ],
    );
    loaded += 1;
    console.log(`+ ${hash}  ${body.pathShape.padEnd(22)} ${f}`);
  }
  console.log(`# loaded=${loaded} files`);
  return 0;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const sub = argv[0];
  const rest = parseArgs(argv.slice(1));
  switch (sub) {
    case "list":
      return cmdList();
    case "run":
      return cmdRun(rest);
    case "capture-synthetic":
      return cmdCaptureSynthetic(rest);
    default:
      console.error(`Usage:
  tsx scripts/replay-cli.ts list
  tsx scripts/replay-cli.ts run --cassette <hash> [--against current|candidate]
  tsx scripts/replay-cli.ts capture-synthetic [--dir <path>]`);
      return 2;
  }
}

// Only run when invoked as a script, not when imported by tests.
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main()
    .then((code) => {
      void pool.end();
      process.exit(code);
    })
    .catch((err) => {
      console.error(err);
      void pool.end();
      process.exit(1);
    });
}

export { identityCandidate, currentOrchestratorCandidate, parseArgs, cmdRun, cmdList, cmdCaptureSynthetic };
