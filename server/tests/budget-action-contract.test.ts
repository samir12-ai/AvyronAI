/**
 * Budget Governor decision-action contract — proof tests (H3, May 2026)
 *
 * The budget_governor engine emits an F9 action vocabulary distinct from F1
 * engine-execution status:
 *   - `decision.action` ∈ { test | scale | hold | halt }
 *
 * These tests prove:
 *   1. Canonical action satisfies the contract
 *   2. Wrong vocabulary is rejected (verdict-shape, status-shape, uppercase)
 *   3. Missing canonical action → CONTRACT_INCOMPLETE
 *   4. The legacy fallback `decision.verdict || decision.status || "reviewed"`
 *      (offender O2) cannot accidentally satisfy the contract under any vocab
 *
 * Run with:  npx tsx server/tests/budget-action-contract.test.ts
 */

import { validateContractCompleteness, getContract } from "../orchestrator/contract-registry/helpers";

type Verdict = ReturnType<typeof validateContractCompleteness>;

const PASS = "\x1b[32m[PASS]\x1b[0m";
const FAIL = "\x1b[31m[FAIL]\x1b[0m";

let failed = 0;

function assert(cond: boolean, label: string, detail: string = "") {
  if (cond) console.log(`${PASS} ${label}${detail ? ` | ${detail}` : ""}`);
  else { console.log(`${FAIL} ${label}${detail ? ` | ${detail}` : ""}`); failed++; }
}

function describe(verdict: Verdict): string {
  const miss = verdict.missingRequiredOutputs.join(",") || "—";
  const inv = verdict.invalidFields.map((f) => `${f.fieldId}(${f.reason})`).join(",") || "—";
  return `status=${verdict.status} missing=[${miss}] invalid=[${inv}]`;
}

function baseOutput(overrides: Record<string, any> = {}) {
  return {
    decision: { action: "test", reasoning: "begin with small test budget" },
    testBudgetRange: { min: 500, max: 1500 },
    scaleBudgetRange: { min: 5000, max: 15000 },
    killFlag: false,
    killReasons: [],
    guardResult: { warnings: [] },
    expansionPermission: { allowed: false },
    cacAssumptionCheck: { ok: true },
    confidenceScore: 0.6,
    ...overrides,
  };
}

console.log("\n══════════════════════════════════════════════════════════════════");
console.log("  Budget Governor — decision.action Contract Hardening (H3)");
console.log("══════════════════════════════════════════════════════════════════\n");

// ── S0: registry has strict enum on decisionAction ──────────────────────────
const contract = getContract("budget_governor");
const actField = contract?.requiredOutputs.find((f) => f.id === "decisionAction");
assert(!!actField, "S0: registry has budget_governor.decisionAction field");
assert(
  JSON.stringify(actField?.path) === JSON.stringify(["decision", "action"]),
  "S0: canonical path is ['decision','action']",
);

// ── S1: each canonical action vocab passes ─────────────────────────────────
for (const action of ["test", "scale", "hold", "halt"]) {
  const out = baseOutput({ decision: { action, reasoning: "x" } });
  const v = validateContractCompleteness("budget_governor", out);
  assert(
    v.status === "COMPLETE",
    `S1: canonical action '${action}' satisfies contract`,
    describe(v),
  );
}

// ── S2: wrong vocabularies rejected (incl. O2 fallback chain values) ────────
const wrongVocabs = [
  "TEST",            // uppercase — wrong case
  "reviewed",        // O2 fallback literal
  "PASS",            // verdict-shape leaking in
  "COMPLETE",        // execution-status leaking in
  "approved",
  "denied",
];
for (const action of wrongVocabs) {
  const out = baseOutput({ decision: { action, reasoning: "x" } });
  const v = validateContractCompleteness("budget_governor", out);
  assert(
    v.status === "INVALID" && v.invalidFields.some((f) => f.fieldId === "decisionAction"),
    `S2: wrong-vocab action='${action}' rejected by strict enum`,
    describe(v),
  );
}

// ── S3: missing decision.action → INCOMPLETE ───────────────────────────────
{
  const out = baseOutput({ decision: { reasoning: "no action set" } });
  const v = validateContractCompleteness("budget_governor", out);
  assert(
    v.status === "INCOMPLETE" && v.missingRequiredOutputs.includes("decisionAction"),
    "S3: missing decision.action → CONTRACT_INCOMPLETE",
    describe(v),
  );
}

// ── S4: O2 simulation — decision.verdict / decision.status cannot stand in ──
// Even if the engine fabricated a `verdict` or `status` field on `decision`,
// the contract refuses to read them. Proves no semantic fallback path exists.
{
  const out = baseOutput({ decision: { verdict: "test", status: "test" } });
  const v = validateContractCompleteness("budget_governor", out);
  assert(
    v.status === "INCOMPLETE" && v.missingRequiredOutputs.includes("decisionAction"),
    "S4: decision.verdict/status alone cannot satisfy decisionAction (no semantic fallback)",
    describe(v),
  );
}

console.log("\n══════════════════════════════════════════════════════════════════");
if (failed === 0) {
  console.log("  SUITE: ALL TESTS PASSED — budget action contract is hardened.");
  console.log("══════════════════════════════════════════════════════════════════\n");
  process.exit(0);
} else {
  console.log(`  SUITE: ${failed} TEST(S) FAILED.`);
  console.log("══════════════════════════════════════════════════════════════════\n");
  process.exit(1);
}
