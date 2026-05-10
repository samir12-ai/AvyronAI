/**
 * U5c cutover-lock test (May 2026, Unified Weighted Reliability Doctrine).
 *
 * Asserts that the orchestrator gate-retry path at
 * `server/orchestrator/index.ts` consults `planRetry` (the U5a/U5b-proven
 * single source of truth) and does NOT re-introduce the inline ternary
 * policy that U5c removed.
 *
 * Concrete invariants (per architect rec #2 from U5b review — "lock
 * semantics at integration level"):
 *   1. The orchestrator MUST import `planRetry` from `decision-policy/retry-policy`.
 *   2. The orchestrator MUST call `planRetry({...})` at least once.
 *   3. The previous if-discriminator `if (gateResult.shouldRetry)` MUST
 *      be gone — replaced by `if (retryDecision.retry)`.
 *   4. The previous BLOCK discriminator `if (gateResult.severity === "critical")`
 *      MUST NOT appear inside the gate-retry block at the cutover line range.
 *      It is replaced by `if (retryDecision.onFinalFailure === "BLOCK")`.
 *
 * This is a structural test (file-content scan) intentionally — the
 * planRetry decision contract itself is already proven by the U5b shadow
 * harness at .local/validation/retry-policy-shadow.ts (180/180 parity).
 * What this test guards against is a future regression where someone
 * silently re-introduces inline policy that bypasses planRetry.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const ORCH_FILE = path.join(REPO_ROOT, "server/orchestrator/index.ts");

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

const src = fs.readFileSync(ORCH_FILE, "utf8");
const lines = src.split("\n");

const checks: Check[] = [];

// Invariant 1: planRetry is imported from decision-policy/retry-policy
{
  const importPattern = /import\s*{\s*planRetry\s*}\s*from\s+['"][^'"]*decision-policy\/retry-policy['"]/;
  const matched = importPattern.test(src);
  checks.push({
    name: "planRetry imported from decision-policy/retry-policy",
    pass: matched,
    detail: matched
      ? "import found — single source of truth wired"
      : "MISSING — orchestrator no longer routes through planRetry",
  });
}

// Invariant 2: planRetry is called at least once
{
  const callCount = (src.match(/\bplanRetry\s*\(/g) ?? []).length;
  checks.push({
    name: "planRetry called at least once in orchestrator",
    pass: callCount >= 1,
    detail: `call count = ${callCount}`,
  });
}

// Invariant 3: legacy `if (gateResult.shouldRetry)` if-discriminator is gone
{
  const legacyDiscriminator = /\bif\s*\(\s*gateResult\.shouldRetry\s*\)/;
  const matched = legacyDiscriminator.test(src);
  checks.push({
    name: "legacy `if (gateResult.shouldRetry)` discriminator removed",
    pass: !matched,
    detail: matched
      ? "STILL PRESENT — cutover incomplete; planRetry is being bypassed"
      : "removed — control flow now driven by retryDecision.retry",
  });
}

// Invariant 4: new discriminator `if (retryDecision.retry)` is present
{
  const newDiscriminator = /\bif\s*\(\s*retryDecision\.retry\s*\)/;
  const matched = newDiscriminator.test(src);
  checks.push({
    name: "new `if (retryDecision.retry)` discriminator present",
    pass: matched,
    detail: matched
      ? "found — retry branch driven by planRetry decision"
      : "MISSING — retry branch is no longer wired to planRetry",
  });
}

// Invariant 4b (dataflow): retryDecision MUST be bound to planRetry's return
//   value — not aliased to gateResult fields. Catches the regression where
//   someone redeclares `const retryDecision = { retry: gateResult.shouldRetry, ... }`
//   without calling planRetry, defeating the cutover while keeping the
//   variable name. Architect rec from U5c review (#2 — dataflow assertion).
{
  const dataflowPattern = /\bconst\s+retryDecision\s*=\s*planRetry\s*\(/;
  const matched = dataflowPattern.test(src);
  checks.push({
    name: "retryDecision bound directly to planRetry() return value",
    pass: matched,
    detail: matched
      ? "dataflow proven — retryDecision = planRetry(...)"
      : "MISSING — retryDecision may be aliased; planRetry's decision could be bypassed",
  });
}

// Invariant 5: BLOCK discriminator now reads `retryDecision.onFinalFailure === "BLOCK"`
//   and NOT `gateResult.severity === "critical"` inside the gate-retry block.
//   Note: `gateResult.severity` may legitimately appear elsewhere (e.g.,
//   registerProblem severity argument); we only forbid the BLOCK-equality
//   check in the gate-retry control flow.
{
  const blockBranchPattern = /\bif\s*\(\s*retryDecision\.onFinalFailure\s*===\s*['"]BLOCK['"]\s*\)/g;
  const blockBranchCount = (src.match(blockBranchPattern) ?? []).length;
  checks.push({
    name: "BLOCK discriminator uses retryDecision.onFinalFailure",
    pass: blockBranchCount >= 2, // both retry-failed branch and no-retry branch
    detail: `match count = ${blockBranchCount} (expected ≥ 2: one for retry-failed branch, one for no-retry branch)`,
  });

  // Find any remaining `if (gateResult.severity === "critical")` — those
  // should be gone from the cutover region. Scope the check to lines in
  // the gate-retry block (locate by anchor).
  const anchorIdx = lines.findIndex((l) => l.includes("MID_PIPELINE_GATE_RETRY |"));
  const blockEndIdx = lines.findIndex(
    (l, i) => i > anchorIdx && l.includes("results.set(engineDef.id, stepResult);"),
  );
  const cutoverRegion = lines.slice(Math.max(0, anchorIdx - 20), blockEndIdx + 10).join("\n");
  const legacyBlockPattern = /\bif\s*\(\s*gateResult\.severity\s*===\s*['"]critical['"]\s*\)/;
  const legacyBlockMatched = legacyBlockPattern.test(cutoverRegion);
  checks.push({
    name: "legacy `if (gateResult.severity === \"critical\")` removed from gate-retry block",
    pass: !legacyBlockMatched,
    detail: legacyBlockMatched
      ? "STILL PRESENT in cutover region — planRetry's onFinalFailure is being bypassed"
      : "removed — BLOCK decision now flows through planRetry",
  });
}

console.log("U5c Cutover-Lock Test");
console.log("══════════════════════════════════════════════════════════════════");
console.log("File: server/orchestrator/index.ts");
console.log(`Invariants checked: ${checks.length}`);
console.log("");

let allPassed = true;
for (const c of checks) {
  const tag = c.pass ? "✓" : "✗";
  console.log(`  ${tag} ${c.name}`);
  console.log(`      ${c.detail}`);
  if (!c.pass) allPassed = false;
}
console.log("");

if (allPassed) {
  console.log("✓ CUTOVER LOCKED");
  console.log("  Orchestrator gate-retry path is wired to planRetry.");
  console.log("  Inline ternary policy is gone. Future regressions will fail this test.");
  process.exit(0);
}

console.log("✗ CUTOVER REGRESSION");
console.log("  One or more cutover invariants failed. The orchestrator gate-retry");
console.log("  path has either been partially reverted or had inline policy");
console.log("  re-introduced. Restore planRetry as the single source of truth.");
process.exit(1);
