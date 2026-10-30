/**
 * Budget Governor recommendation-only contract — proof tests
 *
 * The budget_governor engine emits a recommendation_only contract:
 *   - `mode`: "recommendation_only"
 *   - `status`: "COMPLETE" | "BUDGET_NOT_PROVIDED" | "ZERO_BUDGET" | "MISSING_CHANNELS" | "FAILED"
 *   - `statusMessage`: string
 *   - `allocations`: ChannelAllocation[]
 *   - `overallRationale`: string
 *   - Optional legacy adapter: `decision.action` ∈ { test | scale | hold | halt }
 *
 * These tests prove:
 *   1. Recommendation mode and status vocabularies satisfy the contract
 *   2. Wrong mode or status vocabulary is rejected
 *   3. Missing required recommendation fields → CONTRACT_INCOMPLETE
 *   4. Legacy adapter field (if present) is properly validated without forcing spending semantics
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
    mode: "recommendation_only",
    status: "COMPLETE",
    statusMessage: "Budget recommendation complete.",
    allocations: [
      {
        channel: "Meta Ads",
        sharePercentage: 60,
        allocatedAmount: 3000,
        rationale: "Primary conversion engine for validated audience",
      },
      {
        channel: "Google Search",
        sharePercentage: 40,
        allocatedAmount: 2000,
        rationale: "Captures high intent search queries",
      },
    ],
    overallRationale: "Balanced distribution across validated acquisition channels.",
    totalMonthlyBudget: 5000,
    currency: "USD",
    ...overrides,
  };
}

console.log("\n══════════════════════════════════════════════════════════════════");
console.log("  Budget Governor — Recommendation-Only Contract Verification");
console.log("══════════════════════════════════════════════════════════════════\n");

// ── S0: registry has required recommendation fields ──────────────────────────
const contract = getContract("budget_governor");
assert(!!contract, "S0: registry has budget_governor contract");
const modeField = contract?.requiredOutputs.find((f) => f.id === "mode");
assert(!!modeField, "S0: contract requires 'mode'");
const statusField = contract?.requiredOutputs.find((f) => f.id === "status");
assert(!!statusField, "S0: contract requires 'status'");
const allocField = contract?.requiredOutputs.find((f) => f.id === "allocations");
assert(!!allocField, "S0: contract requires 'allocations'");
const ratField = contract?.requiredOutputs.find((f) => f.id === "overallRationale");
assert(!!ratField, "S0: contract requires 'overallRationale'");

// ── S1: each canonical recommendation status passes ─────────────────────────
const canonicalStatuses = ["COMPLETE", "BUDGET_NOT_PROVIDED", "ZERO_BUDGET", "MISSING_CHANNELS", "FAILED"];
for (const status of canonicalStatuses) {
  const out = baseOutput({ status });
  const v = validateContractCompleteness("budget_governor", out);
  assert(
    v.status === "COMPLETE",
    `S1: canonical status '${status}' satisfies contract`,
    describe(v),
  );
}

// ── S2: wrong mode rejected ────────────────────────────────────────────────
for (const mode of ["spending", "automatic", "scale", "autonomous"]) {
  const out = baseOutput({ mode });
  const v = validateContractCompleteness("budget_governor", out);
  assert(
    v.status === "INVALID" && v.invalidFields.some((f) => f.fieldId === "mode"),
    `S2: invalid mode='${mode}' rejected`,
    describe(v),
  );
}

// ── S3: wrong status rejected ──────────────────────────────────────────────
const wrongStatuses = [
  "TEST",
  "SCALE",
  "HOLD",
  "HALT",
  "PASS",
  "approved",
  "pending",
];
for (const status of wrongStatuses) {
  const out = baseOutput({ status });
  const v = validateContractCompleteness("budget_governor", out);
  assert(
    v.status === "INVALID" && v.invalidFields.some((f) => f.fieldId === "status"),
    `S3: invalid status='${status}' rejected by strict enum`,
    describe(v),
  );
}

// ── S4: missing required outputs → INCOMPLETE ──────────────────────────────
{
  const out = baseOutput();
  delete (out as any).mode;
  const v = validateContractCompleteness("budget_governor", out);
  assert(
    v.status === "INCOMPLETE" && v.missingRequiredOutputs.includes("mode"),
    "S4: missing mode → CONTRACT_INCOMPLETE",
    describe(v),
  );
}
{
  const out = baseOutput();
  delete (out as any).overallRationale;
  const v = validateContractCompleteness("budget_governor", out);
  assert(
    v.status === "INCOMPLETE" && v.missingRequiredOutputs.includes("overallRationale"),
    "S4: missing overallRationale → CONTRACT_INCOMPLETE",
    describe(v),
  );
}

// ── S5: optional legacy decision adapter ────────────────────────────────────
{
  // Valid legacy decision adapter
  const out = baseOutput({ decision: { action: "hold", reasoning: "legacy adapter" } });
  const v = validateContractCompleteness("budget_governor", out);
  assert(v.status === "COMPLETE", "S5: optional legacy decision.action='hold' accepted", describe(v));

  const actField = contract?.optionalOutputs.find((f) => f.id === "decisionAction");
  assert(!!actField, "S5: registry has optional decisionAction field");
  assert(actField?.shape.safeParse("hold").success === true, "S5: 'hold' matches decisionAction shape");
  assert(actField?.shape.safeParse("INVALID_VOCAB").success === false, "S5: invalid legacy decision.action rejected by shape");
}

console.log("\n══════════════════════════════════════════════════════════════════");
if (failed === 0) {
  console.log("  SUITE: ALL TESTS PASSED — recommendation contract verified.");
  console.log("══════════════════════════════════════════════════════════════════\n");
  process.exit(0);
} else {
  console.log(`  SUITE: ${failed} TEST(S) FAILED.`);
  console.log("══════════════════════════════════════════════════════════════════\n");
  process.exit(1);
}
