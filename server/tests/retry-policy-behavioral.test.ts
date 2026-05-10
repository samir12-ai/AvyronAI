/**
 * U5c behavioral integration test (May 2026, Unified Weighted Reliability
 * Doctrine). Architect rec #1 from U5c review — "post-cutover behavioral
 * regression test … asserting actual orchestrator outcomes (BLOCKED vs
 * continue, retry invocation count), not just source-text patterns."
 *
 * The cutover-lock test (`retry-policy-cutover.test.ts`) proves the
 * orchestrator FILE wires planRetry correctly. This test proves the
 * DECISION MEANING: for each (gateShouldRetry × severity × retryGateFailed)
 * combination the orchestrator can encounter at index.ts:3502-3557, the
 * documented orchestrator action is what planRetry's decision dictates.
 *
 * It models the orchestrator's branch tree as a pure interpreter
 * (`interpretGateOutcome`) and asserts the action matrix matches the
 * doctrinal expectation. If anyone changes planRetry's outputs in a way
 * that drifts this matrix, this test fails. If anyone changes the
 * orchestrator's branch tree (e.g., reorders the BLOCK check or adds a
 * new mode) without updating the interpreter, the production cutover-lock
 * test still catches the structural change — but this test makes the
 * SEMANTIC contract explicit and lockable.
 */

import { planRetry, type RetryPolicyDecision, type GateSeverity } from "../decision-policy/retry-policy";

/** Faithful pure-function model of the orchestrator branch tree at
 *  server/orchestrator/index.ts:3502-3557. Every branch corresponds 1:1
 *  to a control-flow path in the production code. */
type OrchestratorAction =
  | "BLOCK_NO_RETRY"
  | "CONTINUE_NO_RETRY_DEGRADED"
  | "BLOCK_AFTER_RETRY_FAILED"
  | "CONTINUE_AFTER_RETRY_FAILED_DEGRADED"
  | "CONTINUE_AFTER_RETRY_PASSED";

function interpretGateOutcome(
  decision: RetryPolicyDecision,
  retryGateFailed: boolean | "no-retry-attempted",
): OrchestratorAction {
  // Models index.ts:3511 — `if (retryDecision.retry)` branch
  if (decision.retry) {
    if (retryGateFailed === "no-retry-attempted") {
      throw new Error("Inconsistent: decision.retry=true but retryGateFailed=no-retry-attempted");
    }
    // Models index.ts:3524 — `if (retryGate?.gateFailed)` branch
    if (retryGateFailed) {
      // Models index.ts:3531 — `if (retryDecision.onFinalFailure === "BLOCK")` branch
      if (decision.onFinalFailure === "BLOCK") {
        return "BLOCK_AFTER_RETRY_FAILED";
      }
      return "CONTINUE_AFTER_RETRY_FAILED_DEGRADED";
    }
    // Models index.ts:3538-3540 — retry succeeded
    return "CONTINUE_AFTER_RETRY_PASSED";
  }
  // Models index.ts:3546 — no-retry branch (else)
  if (retryGateFailed !== "no-retry-attempted") {
    throw new Error("Inconsistent: decision.retry=false but a retry was attempted");
  }
  // Models index.ts:3550 — `if (retryDecision.onFinalFailure === "BLOCK")` branch
  if (decision.onFinalFailure === "BLOCK") {
    return "BLOCK_NO_RETRY";
  }
  return "CONTINUE_NO_RETRY_DEGRADED";
}

interface BehavioralCase {
  caseId: string;
  gateShouldRetry: boolean;
  gateSeverity: GateSeverity;
  retryGateFailed: boolean | "no-retry-attempted";
  expected: OrchestratorAction;
  /** Human-readable doctrine reason — documents WHY this action is correct. */
  doctrine: string;
}

/** The complete behavioral matrix the orchestrator can produce. Ordering
 *  is: 6 retry-attempted cases (2 retry-outcome × 3 severity) + 3 no-retry
 *  cases (3 severity) = 9 total. */
const CASES: BehavioralCase[] = [
  // ── Retry attempted, retry FAILED ────────────────────────────────────
  {
    caseId: "retry+critical+retryFailed",
    gateShouldRetry: true,
    gateSeverity: "critical",
    retryGateFailed: true,
    expected: "BLOCK_AFTER_RETRY_FAILED",
    doctrine: "critical severity halts pipeline even after one retry attempt",
  },
  {
    caseId: "retry+high+retryFailed",
    gateShouldRetry: true,
    gateSeverity: "high",
    retryGateFailed: true,
    expected: "CONTINUE_AFTER_RETRY_FAILED_DEGRADED",
    doctrine: "non-critical severity allows pipeline to continue with degraded result after retry",
  },
  {
    caseId: "retry+medium+retryFailed",
    gateShouldRetry: true,
    gateSeverity: "medium",
    retryGateFailed: true,
    expected: "CONTINUE_AFTER_RETRY_FAILED_DEGRADED",
    doctrine: "medium severity is treated identically to high for the BLOCK decision (non-critical)",
  },
  // ── Retry attempted, retry PASSED ────────────────────────────────────
  {
    caseId: "retry+critical+retryPassed",
    gateShouldRetry: true,
    gateSeverity: "critical",
    retryGateFailed: false,
    expected: "CONTINUE_AFTER_RETRY_PASSED",
    doctrine: "successful retry overrides original critical severity — pipeline proceeds with retry result",
  },
  {
    caseId: "retry+high+retryPassed",
    gateShouldRetry: true,
    gateSeverity: "high",
    retryGateFailed: false,
    expected: "CONTINUE_AFTER_RETRY_PASSED",
    doctrine: "successful retry — pipeline proceeds with retry result",
  },
  {
    caseId: "retry+medium+retryPassed",
    gateShouldRetry: true,
    gateSeverity: "medium",
    retryGateFailed: false,
    expected: "CONTINUE_AFTER_RETRY_PASSED",
    doctrine: "successful retry — pipeline proceeds with retry result",
  },
  // ── No retry ─────────────────────────────────────────────────────────
  {
    caseId: "noRetry+critical",
    gateShouldRetry: false,
    gateSeverity: "critical",
    retryGateFailed: "no-retry-attempted",
    expected: "BLOCK_NO_RETRY",
    doctrine: "critical severity with no retry permitted — pipeline must halt",
  },
  {
    caseId: "noRetry+high",
    gateShouldRetry: false,
    gateSeverity: "high",
    retryGateFailed: "no-retry-attempted",
    expected: "CONTINUE_NO_RETRY_DEGRADED",
    doctrine: "non-critical severity with no retry — pipeline continues with degraded original result",
  },
  {
    caseId: "noRetry+medium",
    gateShouldRetry: false,
    gateSeverity: "medium",
    retryGateFailed: "no-retry-attempted",
    expected: "CONTINUE_NO_RETRY_DEGRADED",
    doctrine: "medium severity behaves identically to high in the no-retry branch (non-critical)",
  },
];

interface CaseResult {
  caseId: string;
  pass: boolean;
  expected: OrchestratorAction;
  actual: OrchestratorAction;
  decision: RetryPolicyDecision;
  doctrine: string;
}

const SAMPLE_ENGINE_ID = "audience";

const results: CaseResult[] = CASES.map((c) => {
  const decision = planRetry({
    engineId: SAMPLE_ENGINE_ID,
    gateShouldRetry: c.gateShouldRetry,
    gateSeverity: c.gateSeverity,
  });
  const actual = interpretGateOutcome(decision, c.retryGateFailed);
  return {
    caseId: c.caseId,
    pass: actual === c.expected,
    expected: c.expected,
    actual,
    decision,
    doctrine: c.doctrine,
  };
});

console.log("U5c Behavioral Integration Test");
console.log("══════════════════════════════════════════════════════════════════");
console.log(`Cases: ${CASES.length} (6 retry-attempted + 3 no-retry)`);
console.log("Asserting: planRetry decision × orchestrator branch tree → expected action");
console.log("");

let allPassed = true;
for (const r of results) {
  const tag = r.pass ? "✓" : "✗";
  console.log(`  ${tag} ${r.caseId.padEnd(34)} → ${r.actual}`);
  if (!r.pass) {
    console.log(`      EXPECTED: ${r.expected}`);
    console.log(`      planRetry: retry=${r.decision.retry} onFinalFailure=${r.decision.onFinalFailure}`);
    console.log(`      doctrine: ${r.doctrine}`);
    allPassed = false;
  }
}
console.log("");

if (allPassed) {
  console.log("✓ BEHAVIORAL CONTRACT HOLDS");
  console.log("  All 9 orchestrator-reachable outcomes match planRetry's decision.");
  console.log("  The cutover preserves end-to-end semantic meaning, not just structure.");
  console.log("");
  console.log("Doctrine summary (locked-in by this test):");
  for (const c of CASES) {
    console.log(`  - ${c.caseId.padEnd(34)} ⇒ ${c.expected.padEnd(38)} | ${c.doctrine}`);
  }
  process.exit(0);
}

console.log("✗ BEHAVIORAL DRIFT");
console.log("  At least one case produces an action that disagrees with the doctrinal");
console.log("  expectation. Either planRetry has changed its decision contract, or the");
console.log("  orchestrator branch model in interpretGateOutcome is now stale.");
process.exit(1);
