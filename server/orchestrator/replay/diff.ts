/**
 * Task #89 / Phase 4-A — Divergence classifier.
 *
 * Compares an expected `CassetteFinalResult` + ancillary state against the
 * actual output of a candidate orchestrator run. Every difference is
 * classified into one of the declared divergence classes. The diff is
 * deep-by-default; well-known noisy fields (durations, captured-at) are
 * routed to TIMING_ONLY.
 *
 * Class precedence (top wins):
 *   STRUCTURAL          — type / shape mismatch (e.g. array vs object,
 *                         primitive vs object, missing required field).
 *   CANONICAL_FIELD     — a D2-tracked canonical field changed value:
 *                           - finalResult.status                 (executionStatus)
 *                           - systemControlVerdict.integrityVerdict
 *                           - systemControlVerdict.executionMode
 *                           - budgetLedger[*].decisionAction
 *   DEGRADATION_SURFACE — planPersist.degraded or planPersist.source flipped.
 *   BUDGET_LEDGER       — ledger length / entry-tuple changed.
 *   PROVENANCE          — inputHashes or contextResolved keys changed.
 *   ORDER               — engineOutputs[].engineId sequence differs.
 *   TIMING_ONLY         — duration-ish fields only (whitelist).
 */
import type {
  CassetteBudgetLedgerEntry,
  CassetteFinalResult,
  Divergence,
  DivergenceClass,
  ReplayCassetteBody,
} from "./types";

const TIMING_KEYS = new Set([
  "durationMs",
  "engineWallClockMs",
  "capturedAt",
  "appliedAt",
  "at",
  "runStartedAt",
]);

const CANONICAL_FIELD_PATHS = new Set([
  "finalResult.status",
  "systemControlVerdict.integrityVerdict",
  "systemControlVerdict.executionMode",
]);

/**
 * Deep, structural walker over the observation tree. Yields a Divergence
 * for every value-mismatch the hand-coded boutique checks above did NOT
 * already cover, classifying each by:
 *   - the field name lands in `TIMING_KEYS`       → TIMING_ONLY
 *   - the full path lands in `CANONICAL_FIELD_PATHS` → CANONICAL_FIELD
 *   - the path begins with `budgetLedger`         → BUDGET_LEDGER
 *   - the path begins with `inputHashes` / `contextResolved` → PROVENANCE
 *   - the path is `engineOrder`                   → ORDER
 *   - any other primitive / shape diff            → STRUCTURAL
 *
 * The walker:
 *   • respects type-tag (array vs object vs primitive) — class STRUCTURAL.
 *   • walks every key of every object on both sides (extra key on either
 *     side surfaces as STRUCTURAL with `expected/actual === undefined`).
 *   • short-circuits on `path === "finalResult.durationMs"` style timing
 *     to TIMING_ONLY (so the candidate's wall-clock drift never causes
 *     a hard FAIL).
 */
function classifyPath(path: string, key: string): "TIMING_ONLY" | "CANONICAL_FIELD" | "BUDGET_LEDGER" | "PROVENANCE" | "ORDER" | "STRUCTURAL" {
  if (TIMING_KEYS.has(key)) return "TIMING_ONLY";
  if (CANONICAL_FIELD_PATHS.has(path)) return "CANONICAL_FIELD";
  if (path === "engineOrder") return "ORDER";
  if (path.startsWith("budgetLedger")) return "BUDGET_LEDGER";
  if (path.startsWith("inputHashes") || path.startsWith("contextResolved") || path.startsWith("contextKeys")) return "PROVENANCE";
  return "STRUCTURAL";
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepWalk(
  path: string,
  expected: unknown,
  actual: unknown,
  out: Divergence[],
  seen: Set<string>,
): void {
  if (seen.has(path)) return;
  // Type-tag mismatch → STRUCTURAL.
  const eType = expected === null ? "null" : Array.isArray(expected) ? "array" : typeof expected;
  const aType = actual === null ? "null" : Array.isArray(actual) ? "array" : typeof actual;
  if (eType !== aType) {
    out.push({ class: "STRUCTURAL", path: path || "<root>", expected, actual });
    seen.add(path);
    return;
  }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    const len = Math.max(expected.length, actual.length);
    if (expected.length !== actual.length && !seen.has(`${path}.length`)) {
      out.push({
        class: classifyPath(`${path}.length`, "length"),
        path: `${path}.length`,
        expected: expected.length,
        actual: actual.length,
      });
      seen.add(`${path}.length`);
    }
    for (let i = 0; i < len; i++) {
      deepWalk(`${path}[${i}]`, expected[i], actual[i], out, seen);
    }
    return;
  }
  if (isPlainObject(expected) && isPlainObject(actual)) {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const k of keys) {
      const childPath = path ? `${path}.${k}` : k;
      deepWalk(childPath, expected[k], actual[k], out, seen);
    }
    return;
  }
  // Primitive comparison.
  if (expected !== actual) {
    const key = path.split(/[.\[]/).pop() ?? path;
    out.push({
      class: classifyPath(path, key),
      path: path || "<root>",
      expected,
      actual,
    });
    seen.add(path);
  }
}

export interface ActualReplayObservation {
  finalResult: CassetteFinalResult;
  systemControlVerdict?: ReplayCassetteBody["systemControlVerdict"];
  budgetLedger: CassetteBudgetLedgerEntry[];
  engineOrder: string[];
  planPersist?: ReplayCassetteBody["planPersist"];
  contextKeys?: string[];
  inputHashes?: Record<string, string>;
}

export interface ExpectedReplayObservation {
  finalResult: CassetteFinalResult;
  systemControlVerdict?: ReplayCassetteBody["systemControlVerdict"];
  budgetLedger: CassetteBudgetLedgerEntry[];
  engineOrder: string[];
  planPersist?: ReplayCassetteBody["planPersist"];
  contextKeys?: string[];
  inputHashes?: Record<string, string>;
}

export function classifyReplay(
  expected: ExpectedReplayObservation,
  actual: ActualReplayObservation,
): Divergence[] {
  const divergences: Divergence[] = [];

  // Canonical fields — explicit checks first so they outrank generic value diffs.
  if (expected.finalResult.status !== actual.finalResult.status) {
    divergences.push({
      class: "CANONICAL_FIELD",
      path: "finalResult.status",
      expected: expected.finalResult.status,
      actual: actual.finalResult.status,
    });
  }
  if (
    expected.systemControlVerdict?.integrityVerdict !==
    actual.systemControlVerdict?.integrityVerdict
  ) {
    divergences.push({
      class: "CANONICAL_FIELD",
      path: "systemControlVerdict.integrityVerdict",
      expected: expected.systemControlVerdict?.integrityVerdict,
      actual: actual.systemControlVerdict?.integrityVerdict,
    });
  }
  if (
    expected.systemControlVerdict?.executionMode !==
    actual.systemControlVerdict?.executionMode
  ) {
    divergences.push({
      class: "CANONICAL_FIELD",
      path: "systemControlVerdict.executionMode",
      expected: expected.systemControlVerdict?.executionMode,
      actual: actual.systemControlVerdict?.executionMode,
    });
  }

  // Degradation surface — planPersist.source / degraded flips.
  const expPP = expected.planPersist;
  const actPP = actual.planPersist;
  if (!!expPP !== !!actPP) {
    divergences.push({
      class: "STRUCTURAL",
      path: "planPersist",
      expected: expPP,
      actual: actPP,
    });
  } else if (expPP && actPP) {
    if (expPP.degraded !== actPP.degraded) {
      divergences.push({
        class: "DEGRADATION_SURFACE",
        path: "planPersist.degraded",
        expected: expPP.degraded,
        actual: actPP.degraded,
      });
    }
    if (expPP.source !== actPP.source) {
      divergences.push({
        class: "DEGRADATION_SURFACE",
        path: "planPersist.source",
        expected: expPP.source,
        actual: actPP.source,
      });
    }
  }

  // Budget ledger — length AND per-entry canonical action.
  if (expected.budgetLedger.length !== actual.budgetLedger.length) {
    divergences.push({
      class: "BUDGET_LEDGER",
      path: "budgetLedger.length",
      expected: expected.budgetLedger.length,
      actual: actual.budgetLedger.length,
    });
  } else {
    for (let i = 0; i < expected.budgetLedger.length; i++) {
      const e = expected.budgetLedger[i];
      const a = actual.budgetLedger[i];
      if (e.engineId !== a.engineId) {
        divergences.push({
          class: "BUDGET_LEDGER",
          path: `budgetLedger[${i}].engineId`,
          expected: e.engineId,
          actual: a.engineId,
        });
      }
      if (e.decisionAction !== a.decisionAction) {
        divergences.push({
          class: "BUDGET_LEDGER",
          path: `budgetLedger[${i}].decisionAction`,
          expected: e.decisionAction,
          actual: a.decisionAction,
        });
      }
    }
  }

  // Order — engine execution sequence.
  if (expected.engineOrder.join("|") !== actual.engineOrder.join("|")) {
    divergences.push({
      class: "ORDER",
      path: "engineOrder",
      expected: expected.engineOrder,
      actual: actual.engineOrder,
    });
  }

  // Provenance — inputHashes / context keys.
  const expHashes = expected.inputHashes ?? {};
  const actHashes = actual.inputHashes ?? {};
  const allHashKeys = new Set([...Object.keys(expHashes), ...Object.keys(actHashes)]);
  for (const k of allHashKeys) {
    if (expHashes[k] !== actHashes[k]) {
      divergences.push({
        class: "PROVENANCE",
        path: `inputHashes.${k}`,
        expected: expHashes[k],
        actual: actHashes[k],
      });
    }
  }
  if (expected.contextKeys && actual.contextKeys) {
    const expSet = [...expected.contextKeys].sort().join(",");
    const actSet = [...actual.contextKeys].sort().join(",");
    if (expSet !== actSet) {
      divergences.push({
        class: "PROVENANCE",
        path: "contextKeys",
        expected: expected.contextKeys,
        actual: actual.contextKeys,
      });
    }
  }

  // Generic completedEngines / planId / jobId checks (structural).
  if (
    JSON.stringify(expected.finalResult.completedEngines) !==
    JSON.stringify(actual.finalResult.completedEngines)
  ) {
    // If lengths match but order differs → ORDER; else STRUCTURAL.
    const eqLen =
      expected.finalResult.completedEngines.length ===
      actual.finalResult.completedEngines.length;
    divergences.push({
      class: eqLen ? "ORDER" : "STRUCTURAL",
      path: "finalResult.completedEngines",
      expected: expected.finalResult.completedEngines,
      actual: actual.finalResult.completedEngines,
    });
  }
  if (expected.finalResult.planId !== actual.finalResult.planId) {
    divergences.push({
      class: "STRUCTURAL",
      path: "finalResult.planId",
      expected: expected.finalResult.planId,
      actual: actual.finalResult.planId,
    });
  }
  if (expected.finalResult.blockReason !== actual.finalResult.blockReason) {
    divergences.push({
      class: "STRUCTURAL",
      path: "finalResult.blockReason",
      expected: expected.finalResult.blockReason,
      actual: actual.finalResult.blockReason,
    });
  }

  // Timing — durationMs differences are TIMING_ONLY.
  if (expected.finalResult.durationMs !== actual.finalResult.durationMs) {
    divergences.push({
      class: "TIMING_ONLY",
      path: "finalResult.durationMs",
      expected: expected.finalResult.durationMs,
      actual: actual.finalResult.durationMs,
    });
  }

  // True deep diff over the full observation shape — catches any field
  // the boutique checks above did NOT explicitly enumerate (e.g. a new
  // canonical field added by a future engine, or a controlVerdict
  // blockReason array drift). The `seen` set carries every path the
  // boutique checks already classified so we never double-report.
  const seen = new Set<string>(divergences.map((d) => d.path));
  const allBoutiquePaths = [
    "finalResult.status",
    "finalResult.planId",
    "finalResult.blockReason",
    "finalResult.completedEngines",
    "finalResult.durationMs",
    "systemControlVerdict.integrityVerdict",
    "systemControlVerdict.executionMode",
    "engineOrder",
    "budgetLedger.length",
    "planPersist",
    "planPersist.degraded",
    "planPersist.source",
  ];
  for (const p of allBoutiquePaths) seen.add(p);
  // Pre-seed budgetLedger element paths the boutique already walked.
  for (let i = 0; i < Math.min(expected.budgetLedger.length, actual.budgetLedger.length); i++) {
    seen.add(`budgetLedger[${i}].engineId`);
    seen.add(`budgetLedger[${i}].decisionAction`);
  }
  // Pre-seed inputHashes keys the boutique already walked.
  for (const k of new Set([
    ...Object.keys(expected.inputHashes ?? {}),
    ...Object.keys(actual.inputHashes ?? {}),
  ])) {
    seen.add(`inputHashes.${k}`);
  }
  seen.add("contextKeys");

  const expEnvelope = {
    finalResult: expected.finalResult,
    systemControlVerdict: expected.systemControlVerdict,
    budgetLedger: expected.budgetLedger,
    planPersist: expected.planPersist,
  };
  const actEnvelope = {
    finalResult: actual.finalResult,
    systemControlVerdict: actual.systemControlVerdict,
    budgetLedger: actual.budgetLedger,
    planPersist: actual.planPersist,
  };
  deepWalk("", expEnvelope, actEnvelope, divergences, seen);

  return divergences;
}

export function passes(divergences: Divergence[]): boolean {
  return divergences.every((d) => d.class === "TIMING_ONLY");
}

/** Helper — group divergences by class for the CLI report. */
export function groupByClass(
  divergences: Divergence[],
): Record<DivergenceClass, Divergence[]> {
  const out = {
    STRUCTURAL: [],
    CANONICAL_FIELD: [],
    DEGRADATION_SURFACE: [],
    BUDGET_LEDGER: [],
    PROVENANCE: [],
    ORDER: [],
    TIMING_ONLY: [],
  } as Record<DivergenceClass, Divergence[]>;
  for (const d of divergences) out[d.class].push(d);
  return out;
}

export { TIMING_KEYS, CANONICAL_FIELD_PATHS };
