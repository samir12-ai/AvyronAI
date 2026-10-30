/**
 * Budget Recommender Pipeline Ordering & Dependency Regression Test
 *
 * Verifies that:
 * 1. channel_selection runs BEFORE budget_governor in ENGINE_PRIORITY_ORDER
 * 2. channel_selection does NOT depend on budget_governor (no circular dependency)
 * 3. budget_governor depends on channel_selection
 * 4. Tier rank consistency assertion passes without error
 */

import {
  ENGINE_PRIORITY_ORDER,
  ENGINE_TIER_RANK,
  assertTierRankConsistency,
} from "../orchestrator/priority-matrix";

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

console.log("\n══════════════════════════════════════════════════════════════════");
console.log("  Budget Recommender — Pipeline Ordering & Dependency Tests");
console.log("══════════════════════════════════════════════════════════════════\n");

// 1. Check priority ranks
const channelSelection = ENGINE_PRIORITY_ORDER.find((e) => e.id === "channel_selection");
const budgetGovernor = ENGINE_PRIORITY_ORDER.find((e) => e.id === "budget_governor");

assert(!!channelSelection, "channel_selection exists in ENGINE_PRIORITY_ORDER");
assert(!!budgetGovernor, "budget_governor exists in ENGINE_PRIORITY_ORDER");

if (channelSelection && budgetGovernor) {
  assert(
    channelSelection.priority < budgetGovernor.priority,
    "channel_selection priority rank precedes budget_governor",
    `channel_selection=${channelSelection.priority}, budget_governor=${budgetGovernor.priority}`
  );

  assert(
    channelSelection.priority === 13,
    "channel_selection priority is 13",
    `actual=${channelSelection.priority}`
  );

  assert(
    budgetGovernor.priority === 14,
    "budget_governor priority is 14",
    `actual=${budgetGovernor.priority}`
  );

  // 2. Check dependencies
  assert(
    !channelSelection.dependencies.includes("budget_governor"),
    "channel_selection does NOT depend on budget_governor (no circular dependency)",
    `deps=[${channelSelection.dependencies.join(", ")}]`
  );

  assert(
    budgetGovernor.dependencies.includes("channel_selection"),
    "budget_governor explicitly depends on channel_selection",
    `deps=[${budgetGovernor.dependencies.join(", ")}]`
  );

  // 3. Check tier ranking
  assert(
    channelSelection.tier === "ALLOCATION",
    "channel_selection belongs to ALLOCATION tier",
    `tier=${channelSelection.tier}`
  );

  assert(
    budgetGovernor.tier === "ALLOCATION",
    "budget_governor belongs to ALLOCATION tier",
    `tier=${budgetGovernor.tier}`
  );
}

// 4. Assert tier rank consistency function runs without throwing
let consistencyError: any = null;
try {
  assertTierRankConsistency();
} catch (err) {
  consistencyError = err;
}
assert(
  consistencyError === null,
  "assertTierRankConsistency() passes without error",
  consistencyError ? String(consistencyError) : "OK"
);

console.log("\n══════════════════════════════════════════════════════════════════");
if (failed === 0) {
  console.log("  SUITE: ALL PIPELINE ORDER TESTS PASSED.");
  console.log("══════════════════════════════════════════════════════════════════\n");
  process.exit(0);
} else {
  console.log(`  SUITE: ${failed} TEST(S) FAILED.`);
  console.log("══════════════════════════════════════════════════════════════════\n");
  process.exit(1);
}
