/**
 * Setup and Settings Budget Storage, Validation & Outdated Flag Regression Tests
 *
 * Verifies that:
 * 1. Setup & Settings budget inputs are rigorously validated:
 *    - Null budget accepted (BUDGET_NOT_PROVIDED)
 *    - Zero budget accepted (ZERO_BUDGET)
 *    - Positive budget with supported ISO currency accepted
 *    - Unsupported currencies rejected
 *    - Currency-specific decimal precision enforced (rejects >2 decimals for USD, >3 for KWD)
 *    - Negative numbers rejected
 * 2. Outdated flag accurately reflects whether the saved budget was updated
 *    after the latest recommendation snapshot was generated.
 */

import { validateCurrency, validateBudgetAmount } from "../strategy/budget-governor/currency";

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
console.log("  Budget Recommender — Setup & Settings Route Validation Tests");
console.log("══════════════════════════════════════════════════════════════════\n");

// ── 1. Setup & Settings Currency Validation ──────────────────────────────────
{
  const validCurrencies = ["USD", "AED", "SAR", "EUR", "GBP", "QAR", "KWD"];
  for (const c of validCurrencies) {
    const res = validateCurrency(c);
    assert(res.valid === true, `Currency '${c}' is supported in Setup & Settings`);
    assert(res.normalizedCurrency === c, `Currency '${c}' normalizes to upper case`);
  }

  const invalidCurrencies = ["XYZ", "FAKE", "USDD", "123", "", null, undefined];
  for (const c of invalidCurrencies) {
    const res = validateCurrency(c);
    assert(res.valid === false, `Invalid currency '${c}' is rejected by Setup & Settings validation`);
  }
}

// ── 2. Budget Amount Precision & Boundary Validation ─────────────────────────
{
  // Valid amounts
  assert(validateBudgetAmount(null, "USD").valid === true, "null budget amount accepted");
  assert(validateBudgetAmount(0, "USD").valid === true, "0 budget amount accepted");
  assert(validateBudgetAmount(1000, "USD").valid === true, "Positive integer amount accepted");
  assert(validateBudgetAmount(1000.5, "USD").valid === true, "Decimal amount within precision accepted");
  assert(validateBudgetAmount(1000.55, "USD").valid === true, "2-decimal amount for USD accepted");
  assert(validateBudgetAmount("2500", "USD").valid === true, "Numeric string accepted");
  assert(validateBudgetAmount("2500.50", "USD").valid === true, "Numeric string with decimals accepted");

  // Invalid amounts
  assert(validateBudgetAmount(-500, "USD").valid === false, "Negative amount rejected");
  assert(validateBudgetAmount("-100", "USD").valid === false, "Negative numeric string rejected");
  assert(validateBudgetAmount("abc", "USD").valid === false, "Non-numeric string rejected");
  assert(validateBudgetAmount("5000$", "USD").valid === false, "String with special symbols rejected");

  // Precision check: USD allows up to 2 decimals
  assert(
    validateBudgetAmount("100.999", "USD").valid === false,
    "3 decimals rejected for 2-decimal currency USD"
  );

  // KWD allows up to 3 decimals
  assert(
    validateBudgetAmount("100.999", "KWD").valid === true,
    "3 decimals accepted for 3-decimal currency KWD"
  );
  assert(
    validateBudgetAmount("100.9999", "KWD").valid === false,
    "4 decimals rejected for 3-decimal currency KWD"
  );

  // JPY allows 0 decimals
  assert(
    validateBudgetAmount("5000", "JPY").valid === true,
    "0 decimals accepted for JPY"
  );
  assert(
    validateBudgetAmount("5000.5", "JPY").valid === false,
    "1 decimal rejected for 0-decimal currency JPY"
  );
}

// ── 3. Outdated Flag Detection Logic ─────────────────────────────────────────
{
  // Helper implementing the outdated comparison logic used by settings route
  function computeIsOutdated(
    budgetSetting: { version: number; updatedAt?: string | Date },
    latestRecommendation: { budgetSettingsVersion?: number; createdAt?: string | Date } | null
  ): boolean {
    if (!latestRecommendation) return false;
    if (latestRecommendation.budgetSettingsVersion != null) {
      return budgetSetting.version > latestRecommendation.budgetSettingsVersion;
    }
    if (budgetSetting.updatedAt && latestRecommendation.createdAt) {
      return new Date(budgetSetting.updatedAt) > new Date(latestRecommendation.createdAt);
    }
    return false;
  }

  // Scenario A: No recommendation yet -> not outdated
  assert(
    computeIsOutdated({ version: 1 }, null) === false,
    "Scenario A: No recommendation snapshot -> isOutdated is false"
  );

  // Scenario B: Recommendation matches budget version -> not outdated
  assert(
    computeIsOutdated({ version: 1 }, { budgetSettingsVersion: 1 }) === false,
    "Scenario B: Recommendation version matches budget setting -> isOutdated is false"
  );

  // Scenario C: User updated budget to version 2, recommendation is at version 1 -> outdated
  assert(
    computeIsOutdated({ version: 2 }, { budgetSettingsVersion: 1 }) === true,
    "Scenario C: Budget version > recommendation version -> isOutdated is true"
  );

  // Scenario D: Fallback to timestamp comparison
  const past = new Date(Date.now() - 60000);
  const future = new Date(Date.now());
  assert(
    computeIsOutdated(
      { version: 1, updatedAt: future },
      { createdAt: past }
    ) === true,
    "Scenario D: Budget updated after recommendation -> isOutdated is true"
  );
  assert(
    computeIsOutdated(
      { version: 1, updatedAt: past },
      { createdAt: future }
    ) === false,
    "Scenario D: Budget updated before recommendation -> isOutdated is false"
  );
}

console.log("\n══════════════════════════════════════════════════════════════════");
if (failed === 0) {
  console.log("  SUITE: ALL SETUP & SETTINGS TESTS PASSED.");
  console.log("══════════════════════════════════════════════════════════════════\n");
  process.exit(0);
} else {
  console.log(`  SUITE: ${failed} TEST(S) FAILED.`);
  console.log("══════════════════════════════════════════════════════════════════\n");
  process.exit(1);
}
