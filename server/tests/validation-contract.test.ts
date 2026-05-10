/**
 * Statistical Validation contract hardening — proof tests (H1, May 2026)
 *
 * The statistical_validation engine emits TWO conceptually distinct fields:
 *   - `status`          — engine EXECUTION status (COMPLETE | ERROR | …)
 *   - `validationState` — claim-evidence VERDICT: validated | provisional | weak | rejected
 *
 * Per the H1 doctrine these tests prove:
 *
 *   1. A correctly-shaped output (validationState=provisional, status=COMPLETE) → COMPLETE
 *   2. Output emitting only `status="COMPLETE"` (no validationState)            → INCOMPLETE
 *   3. Output emitting only `status="provisional"` (legacy chain) → INCOMPLETE  (legacy `status`
 *      can NEVER satisfy the validationState contract; offender O1+O3 patched)
 *   4. Wrong-vocabulary value rejected (e.g. validationState="PASS" or "complete")
 *   5. The full live engine output satisfies the contract via the canonical path
 *
 * Run with:  npx tsx server/tests/validation-contract.test.ts
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

function baseOutput(overrides: Record<string, any> = {}) {
  return {
    claimConfidenceScore: 0.7,
    evidenceStrength: 0.6,
    assumptionFlags: [],
    claimValidations: [{ claim: "x", validated: true }],
    signalClusters: [{ id: "c1" }],
    signalBackedClaimRatio: 0.5,
    originTypeDistribution: { real: 0.6, inferred: 0.4 },
    confidenceExplanation: { reason: "ok" },
    ...overrides,
  };
}

console.log("\n══════════════════════════════════════════════════════════════════");
console.log("  Statistical Validation Contract Hardening — Proof Suite (H1)");
console.log("══════════════════════════════════════════════════════════════════\n");

// ── S0: registry has strict enum, no legacyPaths ────────────────────────────
const contract = getContract("statistical_validation");
const vsField = contract?.requiredOutputs.find((f) => f.id === "validationState");
assert(!!vsField, "S0: registry has statistical_validation.validationState contract field");
assert(
  !vsField?.legacyPaths || vsField.legacyPaths.length === 0,
  "S0: validationState has NO legacyPaths (no fallback to `status`)",
  `legacyPaths=${JSON.stringify(vsField?.legacyPaths ?? [])}`,
);
assert(
  JSON.stringify(vsField?.path) === JSON.stringify(["validationState"]),
  "S0: canonical path is exactly ['validationState']",
);

// Probe the shape: emitting an enum value should pass; emitting wrong vocab fails.
{
  const probeValid = baseOutput({ validationState: "validated" });
  const probeWrong = baseOutput({ validationState: "PASS" });
  const v1 = validateContractCompleteness("statistical_validation", probeValid);
  const v2 = validateContractCompleteness("statistical_validation", probeWrong);
  assert(
    v1.status === "COMPLETE",
    "S0: shape accepts canonical enum value 'validated'",
    describe(v1),
  );
  assert(
    v2.status === "INVALID" && v2.invalidFields.some((f) => f.fieldId === "validationState"),
    "S0: shape REJECTS wrong-vocab 'PASS' (proves z.enum tightening, not z.string)",
    describe(v2),
  );
}

// ── S1: canonical verdict + COMPLETE engine status → COMPLETE ───────────────
{
  const out = baseOutput({ validationState: "provisional", status: "COMPLETE" });
  const v = validateContractCompleteness("statistical_validation", out);
  assert(
    v.status === "COMPLETE",
    "S1: validationState=provisional + status=COMPLETE → contract COMPLETE",
    describe(v),
  );
}

// ── S2: only status="COMPLETE", no validationState → INCOMPLETE ─────────────
{
  const out = baseOutput({ status: "COMPLETE" });
  const v = validateContractCompleteness("statistical_validation", out);
  assert(
    v.status === "INCOMPLETE" && v.missingRequiredOutputs.includes("validationState"),
    "S2: status='COMPLETE' but no validationState → CONTRACT_INCOMPLETE",
    describe(v),
  );
}

// ── S3: legacy chain — engine emits a verdict-shaped value as `status` only ─
// This proves offender O1+O3 are dead: even when `status` carries a valid
// validation-vocabulary string, the contract refuses to substitute it.
{
  const out = baseOutput({ status: "provisional" });
  const v = validateContractCompleteness("statistical_validation", out);
  assert(
    v.status === "INCOMPLETE" && v.missingRequiredOutputs.includes("validationState"),
    "S3: status='provisional' alone CANNOT satisfy validationState contract (no semantic fallback)",
    describe(v),
  );
}

// ── S4: wrong vocabularies blocked ──────────────────────────────────────────
{
  const cases = ["complete", "PASS", "FAIL", "ok", "ERROR", "VALIDATED"]; // last is uppercase, should fail
  for (const wrong of cases) {
    const out = baseOutput({ validationState: wrong });
    const v = validateContractCompleteness("statistical_validation", out);
    assert(
      v.status === "INVALID" && v.invalidFields.some((f) => f.fieldId === "validationState"),
      `S4: wrong vocab validationState='${wrong}' rejected by strict enum`,
      describe(v),
    );
  }
}

// ── S5: full live engine output satisfies via canonical path ────────────────
{
  const liveShape = {
    status: "COMPLETE",
    validationState: "provisional",
    claimConfidenceScore: 0.62,
    evidenceStrength: 0.55,
    assumptionFlags: ["pricing_assumed"],
    claimValidations: Array.from({ length: 6 }, (_, i) => ({ claim: `c${i}`, validated: i < 4 })),
    signalClusters: [{ id: "cluster_1", size: 12 }],
    signalBackedClaimRatio: 0.46,
    originTypeDistribution: { real: 0.5, inferred: 0.3, competitor: 0.2 },
    confidenceExplanation: { reason: "moderate evidence; some inferred" },
    statusMessage: "Validation complete",
    engineVersion: 4,
    executionTimeMs: 890,
  };
  const v = validateContractCompleteness("statistical_validation", liveShape);
  assert(
    v.status === "COMPLETE",
    "S5: realistic live engine output satisfies contract via canonical path",
    describe(v),
  );
}

console.log("\n══════════════════════════════════════════════════════════════════");
if (failed === 0) {
  console.log("  SUITE: ALL TESTS PASSED — statistical_validation contract is hardened.");
  console.log("══════════════════════════════════════════════════════════════════\n");
  process.exit(0);
} else {
  console.log(`  SUITE: ${failed} TEST(S) FAILED.`);
  console.log("══════════════════════════════════════════════════════════════════\n");
  process.exit(1);
}
