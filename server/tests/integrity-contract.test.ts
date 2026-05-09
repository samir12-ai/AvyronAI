/**
 * Integrity contract hardening — proof tests (May 2026)
 *
 * The integrity engine emits TWO conceptually distinct fields:
 *   - `status`        — engine EXECUTION status: COMPLETE | INTEGRITY_FAILED
 *   - `overallStatus` — integrity VERDICT:        PASS | PARTIAL | FAIL
 *
 * Per the user's contract-hardening spec, these tests prove:
 *
 *   1. A correctly-shaped output (overallStatus=PASS, status=COMPLETE) → COMPLETE
 *   2. Output emitting only `status="PASS"` (no overallStatus)          → INCOMPLETE
 *   3. Output emitting only `status="COMPLETE"` (no overallStatus)      → INCOMPLETE
 *   4. The legacy `status` field can NEVER satisfy the `overallStatus` contract
 *      (no fallback path exists in the registry)
 *   5. The full live engine output (real run) satisfies the contract via the
 *      canonical path
 *
 * Run with:  npx tsx server/tests/integrity-contract.test.ts
 */

import { validateContractCompleteness, getContract } from "../orchestrator/contract-registry/helpers";

type Verdict = ReturnType<typeof validateContractCompleteness>;

const PASS = "\x1b[32m[PASS]\x1b[0m";
const FAIL = "\x1b[31m[FAIL]\x1b[0m";

let failed = 0;

function assert(cond: boolean, label: string, detail: string = "") {
  if (cond) {
    console.log(`${PASS} ${label}${detail ? ` | ${detail}` : ""}`);
  } else {
    console.log(`${FAIL} ${label}${detail ? ` | ${detail}` : ""}`);
    failed++;
  }
}

function describe(verdict: Verdict): string {
  const miss = verdict.missingRequiredOutputs.join(",") || "—";
  const inv = verdict.invalidFields.map((f) => `${f.fieldId}(${f.reason})`).join(",") || "—";
  return `status=${verdict.status} missing=[${miss}] invalid=[${inv}]`;
}

// Base output that satisfies all OTHER required fields, so each test isolates
// the overallStatus / status semantics. (overallIntegrityScore, safeToExecute,
// zeroLeakage, traceabilityComplete, failureReasons, structuralWarnings,
// flaggedInconsistencies, layerResults are all required by the integrity
// contract — see registry.ts INTEGRITY_CONTRACT.)
function baseOutput(overrides: Record<string, any> = {}) {
  return {
    overallIntegrityScore: 0.85,
    safeToExecute: true,
    zeroLeakage: true,
    traceabilityComplete: true,
    failureReasons: [],
    structuralWarnings: [],
    flaggedInconsistencies: [],
    layerResults: [{ layerName: "strategic_consistency", passed: true }],
    ...overrides,
  };
}

console.log("\n══════════════════════════════════════════════════════════════════");
console.log("  Integrity Contract Hardening — Proof Suite");
console.log("══════════════════════════════════════════════════════════════════\n");

// Sanity: confirm the registry has NO legacyPaths for integrity.overallStatus
const contract = getContract("integrity");
const overallStatusField = contract?.requiredOutputs.find((f) => f.id === "overallStatus");
assert(
  !!overallStatusField,
  "S0: Registry has integrity.overallStatus contract field",
);
assert(
  !overallStatusField?.legacyPaths || overallStatusField.legacyPaths.length === 0,
  "S0: integrity.overallStatus has NO legacyPaths (no fallback to `status`)",
  `legacyPaths=${JSON.stringify(overallStatusField?.legacyPaths ?? [])}`,
);
assert(
  JSON.stringify(overallStatusField?.path) === JSON.stringify(["overallStatus"]),
  "S0: canonical path is exactly ['overallStatus']",
  `path=${JSON.stringify(overallStatusField?.path)}`,
);

// ── Test 1: canonical PASS verdict + COMPLETE engine status → COMPLETE ──
{
  const out = baseOutput({ overallStatus: "PASS", status: "COMPLETE" });
  const v = validateContractCompleteness("integrity", out);
  assert(
    v.status === "COMPLETE",
    "S1: overallStatus=PASS + status=COMPLETE → contract COMPLETE",
    describe(v),
  );
}

// ── Test 2: only status=PASS, no overallStatus → INCOMPLETE ──
{
  const out = baseOutput({ status: "PASS" });
  const v = validateContractCompleteness("integrity", out);
  assert(
    v.status === "INCOMPLETE" && v.missingRequiredOutputs.includes("overallStatus"),
    "S2: status='PASS' but no overallStatus → CONTRACT_INCOMPLETE (legacy `status` does NOT satisfy verdict contract)",
    describe(v),
  );
}

// ── Test 3: only status=COMPLETE, no overallStatus → INCOMPLETE ──
{
  const out = baseOutput({ status: "COMPLETE" });
  const v = validateContractCompleteness("integrity", out);
  assert(
    v.status === "INCOMPLETE" && v.missingRequiredOutputs.includes("overallStatus"),
    "S3: status='COMPLETE' but no overallStatus → CONTRACT_INCOMPLETE",
    describe(v),
  );
}

// ── Test 4: System Control attempts to read legacy `status` as verdict — blocked ──
// We prove this two ways:
//   (a) The contract registry's path resolver no longer falls through to `status`.
//   (b) Even an output with status="FAIL" (semantically tempting fallback)
//       cannot satisfy the contract.
{
  const out = baseOutput({ status: "FAIL" });   // engine-execution semantics: invalid
  const v = validateContractCompleteness("integrity", out);
  assert(
    v.status === "INCOMPLETE" && v.missingRequiredOutputs.includes("overallStatus"),
    "S4: legacy `status='FAIL'` cannot stand in for verdict — INCOMPLETE",
    describe(v),
  );

  // Prove the canonical-only path is what enforces this: emitting overallStatus
  // alongside the same engine `status` flips the verdict to COMPLETE.
  const outFixed = baseOutput({ status: "FAIL", overallStatus: "FAIL" });
  const v2 = validateContractCompleteness("integrity", outFixed);
  assert(
    v2.status === "COMPLETE",
    "S4: emitting canonical overallStatus='FAIL' satisfies the contract (no fallback needed)",
    describe(v2),
  );
}

// ── Test 5: shape of canonical field is enforced — wrong vocabulary rejected ──
{
  const wrongVocab = baseOutput({ overallStatus: "COMPLETE" }); // engine-execution vocab leaking in
  const v = validateContractCompleteness("integrity", wrongVocab);
  assert(
    v.status === "INVALID" && v.invalidFields.some((f: { fieldId: string }) => f.fieldId === "overallStatus"),
    "S5: overallStatus='COMPLETE' (wrong vocabulary) is rejected — must be PASS|PARTIAL|FAIL",
    describe(v),
  );
}

// ── Test 6: full healthy live-engine-shaped output → COMPLETE via canonical path ──
{
  const liveShape = {
    status: "COMPLETE",
    overallStatus: "PASS",
    statusMessage: null,
    overallIntegrityScore: 0.92,
    safeToExecute: true,
    failureReasons: [],
    zeroLeakage: true,
    traceabilityComplete: true,
    layerResults: Array.from({ length: 8 }, (_, i) => ({
      layerName: `layer_${i}`,
      passed: true,
      score: 0.9,
    })),
    structuralWarnings: [],
    flaggedInconsistencies: [],
    boundaryCheck: { passed: true, failures: [] },
    executionTimeMs: 42,
    engineVersion: 3,
    layerDiagnostics: {},
  };
  const v = validateContractCompleteness("integrity", liveShape);
  assert(
    v.status === "COMPLETE",
    "S6: realistic live engine output (PASS/COMPLETE) satisfies contract via canonical path",
    describe(v),
  );
}

console.log("\n══════════════════════════════════════════════════════════════════");
if (failed === 0) {
  console.log("  SUITE: ALL TESTS PASSED — integrity contract is hardened.");
  console.log("══════════════════════════════════════════════════════════════════\n");
  process.exit(0);
} else {
  console.log(`  SUITE: ${failed} TEST(S) FAILED.`);
  console.log("══════════════════════════════════════════════════════════════════\n");
  process.exit(1);
}
