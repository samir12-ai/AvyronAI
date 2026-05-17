/**
 * Integrity contract hardening — proof tests (May 2026, updated for Task #68 / Phase 5 Step 3)
 *
 * The integrity engine emits TWO conceptually distinct fields:
 *   - `status`           — engine EXECUTION status: COMPLETE | INTEGRITY_FAILED
 *   - `integrityVerdict` — integrity VERDICT:       PASS | PARTIAL | FAIL
 *                          (canonical; `overallStatus` is a legacyPath alias
 *                          for back-compat with pre-merge persisted snapshots)
 *
 * Task #68 / Phase 5 Step 3 merged the prior standalone `overallStatus`
 * contract entry into the single canonical `integrityVerdict` field with
 * `legacyPaths: [["overallStatus"]]`. These tests prove:
 *
 *   S0. Registry has integrity.integrityVerdict as the canonical field,
 *       with overallStatus listed as a legacyPath (not a standalone entry).
 *   S1. A correctly-shaped output (integrityVerdict=PASS, status=COMPLETE) → COMPLETE
 *   S2. Output emitting only engine-execution `status="PASS"` (no verdict)  → INCOMPLETE
 *   S3. Output emitting only engine-execution `status="COMPLETE"` (no verdict) → INCOMPLETE
 *   S4. The legacy engine-execution `status` field can NEVER satisfy the
 *       verdict contract (no semantic fallback). But the legacy *path*
 *       `overallStatus` DOES satisfy the contract via the registry's
 *       `legacyPaths` resolver (pre-merge snapshots still resolve).
 *   S5. Strict-enum vocabulary is enforced — wrong values rejected.
 *   S6. The full live engine output (real run) satisfies the contract via
 *       the canonical path.
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
// the verdict semantics. (overallIntegrityScore, safeToExecute, zeroLeakage,
// traceabilityComplete, failureReasons, structuralWarnings,
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
console.log("  Integrity Contract Hardening — Proof Suite (post-merge)");
console.log("══════════════════════════════════════════════════════════════════\n");

// ── S0: registry shape ──
// Post-merge: canonical field is `integrityVerdict`; `overallStatus` is gone
// as a standalone entry and lives only as a legacyPath on `integrityVerdict`.
const contract = getContract("integrity");
const integrityVerdictField = contract?.requiredOutputs.find((f) => f.id === "integrityVerdict");
const orphanOverallStatus = contract?.requiredOutputs.find((f) => f.id === "overallStatus");
assert(
  !!integrityVerdictField,
  "S0: Registry has integrity.integrityVerdict canonical contract field",
);
assert(
  !orphanOverallStatus,
  "S0: integrity.overallStatus is NOT a standalone entry post-merge (Task #68 / Phase 5 Step 3)",
);
assert(
  JSON.stringify(integrityVerdictField?.path) === JSON.stringify(["integrityVerdict"]),
  "S0: canonical path is exactly ['integrityVerdict']",
  `path=${JSON.stringify(integrityVerdictField?.path)}`,
);
assert(
  JSON.stringify(integrityVerdictField?.legacyPaths) === JSON.stringify([["overallStatus"]]),
  "S0: legacyPaths is exactly [['overallStatus']] (pre-merge snapshot back-compat)",
  `legacyPaths=${JSON.stringify(integrityVerdictField?.legacyPaths ?? [])}`,
);

// ── S1: canonical PASS verdict + COMPLETE engine status → COMPLETE ──
{
  // Engine dual-writes both fields during the transition window
  // (integrity-engine/engine.ts:741-742).
  const out = baseOutput({ overallStatus: "PASS", integrityVerdict: "PASS", status: "COMPLETE" });
  const v = validateContractCompleteness("integrity", out);
  assert(
    v.status === "COMPLETE",
    "S1: integrityVerdict=PASS + status=COMPLETE → contract COMPLETE",
    describe(v),
  );
}

// ── S2: only engine-execution status=PASS, no verdict field at all → INCOMPLETE ──
{
  const out = baseOutput({ status: "PASS" });
  const v = validateContractCompleteness("integrity", out);
  assert(
    v.status === "INCOMPLETE" && v.missingRequiredOutputs.includes("integrityVerdict"),
    "S2: status='PASS' but no integrityVerdict → CONTRACT_INCOMPLETE (legacy `status` does NOT satisfy verdict contract)",
    describe(v),
  );
}

// ── S3: only engine-execution status=COMPLETE, no verdict field → INCOMPLETE ──
{
  const out = baseOutput({ status: "COMPLETE" });
  const v = validateContractCompleteness("integrity", out);
  assert(
    v.status === "INCOMPLETE" && v.missingRequiredOutputs.includes("integrityVerdict"),
    "S3: status='COMPLETE' but no integrityVerdict → CONTRACT_INCOMPLETE",
    describe(v),
  );
}

// ── S4: engine-execution `status` field never satisfies verdict — but legacy
//        `overallStatus` PATH does, because the registry declares it as a
//        legacyPath for pre-merge snapshot back-compat. ──
{
  // (a) status alone, no verdict, no legacy path → INCOMPLETE
  const out = baseOutput({ status: "FAIL" });
  const v = validateContractCompleteness("integrity", out);
  assert(
    v.status === "INCOMPLETE" && v.missingRequiredOutputs.includes("integrityVerdict"),
    "S4a: legacy engine-execution `status='FAIL'` cannot stand in for verdict — INCOMPLETE",
    describe(v),
  );

  // (b) canonical integrityVerdict emitted → COMPLETE
  const outCanonical = baseOutput({ status: "FAIL", integrityVerdict: "FAIL" });
  const v2 = validateContractCompleteness("integrity", outCanonical);
  assert(
    v2.status === "COMPLETE",
    "S4b: emitting canonical integrityVerdict='FAIL' satisfies the contract",
    describe(v2),
  );

  // (c) only legacy `overallStatus` path emitted (pre-merge snapshot) → COMPLETE via legacyPaths
  const outLegacyOnly = baseOutput({ status: "FAIL", overallStatus: "FAIL" });
  const v3 = validateContractCompleteness("integrity", outLegacyOnly);
  assert(
    v3.status === "COMPLETE",
    "S4c: pre-merge snapshot with only `overallStatus` resolves via legacyPaths → COMPLETE",
    describe(v3),
  );
}

// ── S5: shape of canonical field is enforced — wrong vocabulary rejected ──
{
  const wrongVocab = baseOutput({ integrityVerdict: "COMPLETE" }); // engine-execution vocab leaking in
  const v = validateContractCompleteness("integrity", wrongVocab);
  assert(
    v.status === "INVALID" && v.invalidFields.some((f: { fieldId: string }) => f.fieldId === "integrityVerdict"),
    "S5: integrityVerdict='COMPLETE' (wrong vocabulary) is rejected — must be PASS|PARTIAL|FAIL",
    describe(v),
  );
}

// ── S6: full healthy live-engine-shaped output → COMPLETE via canonical path ──
{
  const liveShape = {
    status: "COMPLETE",
    overallStatus: "PASS",
    integrityVerdict: "PASS",
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
  console.log("  SUITE: ALL TESTS PASSED — integrity contract is hardened (post-merge).");
  console.log("══════════════════════════════════════════════════════════════════\n");
  process.exit(0);
} else {
  console.log(`  SUITE: ${failed} TEST(S) FAILED.`);
  console.log("══════════════════════════════════════════════════════════════════\n");
  process.exit(1);
}
