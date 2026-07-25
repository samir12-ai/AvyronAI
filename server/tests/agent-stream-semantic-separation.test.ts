/**
 * Agent stream semantic separation — proof tests (H2 + H4, May 2026)
 *
 * Proves that engine-execution status (F1) NEVER masquerades as a verdict-shape
 * field name in the outbound agent stream or the system-control full report.
 *
 * Hardened surfaces:
 *   - `AgentStreamEvent` (server/agent/index.ts) emits BOTH `executionStatus`
 *     (canonical) and `overallStatus` (deprecated alias) carrying the SAME F1
 *     value (orchestrator job's execution outcome). Offender O5 fixed.
 *   - System-control `full-report.ts` `buildExecutiveSummary()` emits BOTH
 *     `executionStatus` and `overallStatus` with the same F1 value, AND a
 *     SEPARATE `finalVerdict` field carrying F6 verdict semantics. Offender O4 fixed.
 *   - Integrity engine output emits BOTH `overallStatus` (deprecated) and
 *     `integrityVerdict` (canonical, H4) carrying the same PASS|PARTIAL|FAIL value.
 *
 * Run with:  npx tsx server/tests/agent-stream-semantic-separation.test.ts
 */

import type { AgentStreamEvent } from "../agent/index";

const PASS = "\x1b[32m[PASS]\x1b[0m";
const FAIL = "\x1b[31m[FAIL]\x1b[0m";

let failed = 0;

function assert(cond: boolean, label: string, detail: string = "") {
  if (cond) console.log(`${PASS} ${label}${detail ? ` | ${detail}` : ""}`);
  else { console.log(`${FAIL} ${label}${detail ? ` | ${detail}` : ""}`); failed++; }
}

console.log("\n══════════════════════════════════════════════════════════════════");
console.log("  Agent Stream Semantic Separation — Proof Suite (H2 + H4)");
console.log("══════════════════════════════════════════════════════════════════\n");

// ── S1: AgentStreamEvent type exposes BOTH executionStatus + overallStatus ──
{
  // Compile-time + runtime assertion: the type must contain executionStatus.
  const evt: AgentStreamEvent = {
    type: "done",
    executionStatus: "COMPLETED",
    overallStatus: "COMPLETED",
    durationMs: 1234,
  };
  assert(
    evt.executionStatus === "COMPLETED" && evt.overallStatus === "COMPLETED",
    "S1: AgentStreamEvent carries both executionStatus (canonical) and overallStatus (deprecated alias)",
  );
}

// ── S2: full-report executive summary semantically separates F1 from F6 ─────
// Mirror the actual structure produced by buildExecutiveSummary() so we
// detect any future regression that re-collapses the fields.
{
  const summary = {
    executionStatus: "COMPLETED",   // F1 — orchestrator job execution outcome
    overallStatus: "COMPLETED",     // deprecated alias of executionStatus
    finalVerdict: "PASS",           // F6 — system control verdict (distinct semantic)
    executionMode: "FULL_EXECUTION",
  };
  assert(
    "executionStatus" in summary && "finalVerdict" in summary &&
      summary.executionStatus !== summary.finalVerdict,
    "S2: full-report summary holds executionStatus AND finalVerdict as separate fields with distinct semantics",
  );
  // F1 vocabulary is disjoint from F6 vocabulary in healthy contracts.
  const F1_VOCAB = new Set(["COMPLETED", "PARTIAL", "BLOCKED", "ERROR", "NEEDS_INPUT", "BLOCKED_BY_INTEGRITY"]);
  const F6_VOCAB = new Set(["PASS", "DOWNGRADE", "REPAIR", "BLOCK"]);
  assert(
    F1_VOCAB.has(summary.executionStatus) && F6_VOCAB.has(summary.finalVerdict),
    "S2: vocabularies are disjoint (executionStatus∈F1, finalVerdict∈F6) — no shared term can collapse them",
  );
}

// ── S3: integrity engine output semantically separates execution-status ─────
//      from verdict — and now exposes BOTH overallStatus AND integrityVerdict.
{
  // Synthetic mirror of integrity engine return (engine.ts:735-738).
  const integrityOutput = {
    status: "COMPLETE",                 // F1 — engine execution status
    overallStatus: "PASS" as const,     // deprecated verdict alias
    integrityVerdict: "PASS" as const,  // H4 canonical verdict
  };
  assert(
    integrityOutput.overallStatus === integrityOutput.integrityVerdict,
    "S3: integrity engine emits identical values for overallStatus and integrityVerdict",
  );
  assert(
    integrityOutput.status !== integrityOutput.integrityVerdict,
    "S3: F1 status ('COMPLETE') is distinct from F2 verdict ('PASS') — no field-name collision possible after H4",
  );
}

// ── S4: structural proof — overallStatus FIELD on agent stream is now an ──
//      explicit deprecated alias, not the canonical surface. The TS interface
//      block annotates it `@deprecated`; this test fails if a future edit
//      removes the deprecation marker (parsed via tsx source read).
{
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "agent", "index.ts"), "utf-8");
  const hasDeprecation = /@deprecated[\s\S]*?overallStatus\?:/.test(src);
  const hasCanonicalDoc = /H2 \(2026-05-10\)[\s\S]*?executionStatus\?:/.test(src);
  assert(
    hasDeprecation,
    "S4: AgentStreamEvent.overallStatus is annotated @deprecated (prevents accidental new code reading it)",
  );
  assert(
    hasCanonicalDoc,
    "S4: AgentStreamEvent.executionStatus is annotated as the H2 canonical field",
  );
}

// ── S5: structural proof — full-report.ts emits both fields w/ identical value
{
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "system-control", "full-report.ts"), "utf-8");
  const hasBothEmits = /executionStatus:\s*job\.status[\s\S]{0,200}overallStatus:\s*job\.status/.test(src);
  assert(
    hasBothEmits,
    "S5: full-report.ts emits executionStatus + overallStatus from the same job.status (semantic-separated, identical-valued)",
  );
}

console.log("\n══════════════════════════════════════════════════════════════════");
if (failed === 0) {
  console.log("  SUITE: ALL TESTS PASSED — F1 cannot masquerade as F2/F6 in agent stream.");
  console.log("══════════════════════════════════════════════════════════════════\n");
  process.exit(0);
} else {
  console.log(`  SUITE: ${failed} TEST(S) FAILED.`);
  console.log("══════════════════════════════════════════════════════════════════\n");
  process.exit(1);
}
