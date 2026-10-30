/**
 * Budget Recommender Allocation Engine Regression Test
 *
 * Verifies that:
 * 1. ISO currency validation and decimal precision (2 for USD/AED, 3 for KWD, 0 for JPY)
 * 2. Exact minor-unit reconciliation ensures sum(allocatedAmount) === totalMonthlyBudget
 * 3. BUDGET_NOT_PROVIDED returned when monthlyBudget is null
 * 4. ZERO_BUDGET returned when monthlyBudget is 0
 * 5. MISSING_CHANNELS returned when selected channels are empty
 * 6. Positive budget produces COMPLETE state with mode === "recommendation_only"
 * 7. Legacy adapter fields are properly isolated
 */

import {
  validateCurrencyCode,
  getCurrencyDecimals,
  validateBudgetAmount,
  reconcileAllocations,
} from "../strategy/budget-governor/currency";

import { runBudgetGovernorEngine } from "../strategy/budget-governor/engine";
import type { BudgetGovernorInput, SelectedChannelInput } from "../strategy/budget-governor/types";

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

async function runTests() {
  console.log("\n══════════════════════════════════════════════════════════════════");
  console.log("  Budget Recommender — Allocation & Currency Engine Tests");
  console.log("══════════════════════════════════════════════════════════════════\n");

  // ── 1. Currency validation & decimals ────────────────────────────────────────
  assert(validateCurrencyCode("USD") === true, "USD is valid ISO currency");
  assert(validateCurrencyCode("usd") === true, "usd (lowercase) is accepted and normalized");
  assert(validateCurrencyCode("AED") === true, "AED is valid ISO currency");
  assert(validateCurrencyCode("SAR") === true, "SAR is valid ISO currency");
  assert(validateCurrencyCode("KWD") === true, "KWD is valid ISO currency");
  assert(validateCurrencyCode("INVALID_XYZ") === false, "INVALID_XYZ is rejected");
  assert(validateCurrencyCode("") === false, "Empty string is rejected");

  assert(getCurrencyDecimals("USD") === 2, "USD has 2 decimals");
  assert(getCurrencyDecimals("EUR") === 2, "EUR has 2 decimals");
  assert(getCurrencyDecimals("KWD") === 3, "KWD has 3 decimals");
  assert(getCurrencyDecimals("BHD") === 3, "BHD has 3 decimals");
  assert(getCurrencyDecimals("JPY") === 0, "JPY has 0 decimals");

  // ── 2. Budget amount validation ──────────────────────────────────────────────
  assert(validateBudgetAmount(null).valid === true, "null budget is valid (BUDGET_NOT_PROVIDED)");
  assert(validateBudgetAmount(0).valid === true, "0 budget is valid (ZERO_BUDGET)");
  assert(validateBudgetAmount(5000).valid === true, "Positive budget is valid");
  assert(validateBudgetAmount(-100).valid === false, "Negative budget is invalid");
  assert(validateBudgetAmount(NaN).valid === false, "NaN budget is invalid");
  assert(validateBudgetAmount(Infinity).valid === false, "Infinity budget is invalid");

  // ── 3. Exact minor-unit reconciliation ───────────────────────────────────────
  {
    // 3-way split of 100 USD (33.333... each)
    const rawAllocations = [
      { channel: "Meta Ads", sharePercentage: 33.3333, allocatedAmount: 33.3333, rationale: "c1" },
      { channel: "Google Search", sharePercentage: 33.3333, allocatedAmount: 33.3333, rationale: "c2" },
      { channel: "LinkedIn Ads", sharePercentage: 33.3334, allocatedAmount: 33.3334, rationale: "c3" },
    ];
    const reconciled = reconcileAllocations(rawAllocations, 100, "USD");
    const totalAmount = reconciled.reduce((sum, a) => sum + a.allocatedAmount, 0);
    const totalShare = reconciled.reduce((sum, a) => sum + a.sharePercentage, 0);

    assert(
      Math.abs(totalAmount - 100) < 0.0001,
      "reconciled sum(allocatedAmount) === 100.00 USD exactly",
      `actual=${totalAmount}`
    );
    assert(
      Math.abs(totalShare - 100) < 0.0001,
      "reconciled sum(sharePercentage) === 100.0% exactly",
      `actual=${totalShare}`
    );
    // Check that each amount has at most 2 decimal places
    for (const a of reconciled) {
      assert(
        Number(a.allocatedAmount.toFixed(2)) === a.allocatedAmount,
        `reconciled channel ${a.channel} amount has exact currency precision`,
        `amount=${a.allocatedAmount}`
      );
    }
  }

  {
    // KWD with 3 decimal places
    const rawAllocations = [
      { channel: "Meta Ads", sharePercentage: 50, allocatedAmount: 50, rationale: "c1" },
      { channel: "TikTok Ads", sharePercentage: 50, allocatedAmount: 50, rationale: "c2" },
    ];
    const reconciled = reconcileAllocations(rawAllocations, 100, "KWD");
    const totalAmount = reconciled.reduce((sum, a) => sum + a.allocatedAmount, 0);
    assert(
      Math.abs(totalAmount - 100) < 0.0001,
      "reconciled KWD sum equals total exactly",
      `actual=${totalAmount}`
    );
  }

  // ── 4. Engine: BUDGET_NOT_PROVIDED ──────────────────────────────────────────
  {
    const input: BudgetGovernorInput = {
      campaignId: "test-campaign-1",
      monthlyBudget: null,
      currency: "USD",
      selectedChannels: [{ channel: "Meta Ads", fitScore: 85, isOrganic: false }],
    };
    const res = await runBudgetGovernorEngine(input);
    assert(res.mode === "recommendation_only", "mode is recommendation_only");
    assert(res.status === "BUDGET_NOT_PROVIDED", "status is BUDGET_NOT_PROVIDED when budget is null");
    assert(res.totalMonthlyBudget === null, "totalMonthlyBudget is null");
    assert(res.allocations.length === 0, "allocations array is empty");
    assert(res.decision?.action === "hold", "legacy adapter decision.action is 'hold'");
    assert(res.killFlag === false, "legacy adapter killFlag is false");
  }

  // ── 5. Engine: ZERO_BUDGET ──────────────────────────────────────────────────
  {
    const input: BudgetGovernorInput = {
      campaignId: "test-campaign-2",
      monthlyBudget: 0,
      currency: "USD",
      selectedChannels: [
        { channel: "Instagram Organic", fitScore: 90, isOrganic: true },
        { channel: "Meta Ads", fitScore: 80, isOrganic: false },
      ],
    };
    const res = await runBudgetGovernorEngine(input);
    assert(res.mode === "recommendation_only", "mode is recommendation_only");
    assert(res.status === "ZERO_BUDGET", "status is ZERO_BUDGET when budget is 0");
    assert(res.totalMonthlyBudget === 0, "totalMonthlyBudget is 0");
    assert(res.allocations.length > 0, "allocations recommended for organic channels");
    assert(res.allocations.every((a) => a.monthlyAmount === 0), "all allocated amounts are 0");
    assert(res.allocations.every((a) => a.sharePercentage === 0), "all share percentages are 0 for zero budget");
  }

  // ── 6. Engine: MISSING_CHANNELS ─────────────────────────────────────────────
  {
    const input: BudgetGovernorInput = {
      campaignId: "test-campaign-3",
      monthlyBudget: 5000,
      currency: "USD",
      selectedChannels: [],
    };
    const res = await runBudgetGovernorEngine(input);
    assert(res.mode === "recommendation_only", "mode is recommendation_only");
    assert(res.status === "MISSING_CHANNELS", "status is MISSING_CHANNELS when channels array is empty");
    assert(res.allocations.length === 0, "allocations array is empty");
    assert(res.totalMonthlyBudget === 5000, "totalMonthlyBudget is preserved");
  }

  // ── 7. Engine: Positive Budget COMPLETE (Deterministic LLM Mock) ───────────
  {
    const channels: SelectedChannelInput[] = [
      { channelId: "meta_ads", channelName: "Meta Ads", fitScore: 90, isOrganic: false, strategicRole: "Primary conversion driver" },
      { channelId: "google_search", channelName: "Google Search", fitScore: 80, isOrganic: false, strategicRole: "Capture high-intent search" },
      { channelId: "linkedin_ads", channelName: "LinkedIn Ads", fitScore: 65, isOrganic: false, strategicRole: "B2B awareness" },
    ];
    const input: BudgetGovernorInput = {
      campaignId: "test-campaign-4",
      monthlyBudget: 7500,
      currency: "USD",
      selectedChannels: channels,
      _mockLlmOutput: {
        allocations: [
          { channelId: "meta_ads", sharePercentage: 50, why: "Primary conversion driver", proposedUse: "Paid social" },
          { channelId: "google_search", sharePercentage: 35, why: "Intent capture", proposedUse: "Search ads" },
          { channelId: "linkedin_ads", sharePercentage: 15, why: "B2B awareness", proposedUse: "Sponsored content" },
        ],
        overallRationale: "High-fit diversified paid portfolio focusing on proven channels.",
      },
    };
    const res = await runBudgetGovernorEngine(input);
    assert(res.mode === "recommendation_only", "positive budget returns recommendation_only mode");
    assert(res.status === "COMPLETE", "positive budget produces COMPLETE recommendation");
    assert(res.totalMonthlyBudget === 7500, "totalMonthlyBudget is 7500");
    assert(res.currency === "USD", "currency is USD");
    assert(res.allocations.length === 3, "allocations has 3 channels");

    const totalAllocated = res.allocations.reduce((sum, a) => sum + a.monthlyAmount, 0);
    assert(
      Math.abs(totalAllocated - 7500) < 0.01,
      "sum of allocated amounts equals totalMonthlyBudget exactly",
      `actual=${totalAllocated}`
    );

    const totalShare = res.allocations.reduce((sum, a) => sum + a.sharePercentage, 0);
    assert(
      Math.abs(totalShare - 100) < 0.01,
      "sum of share percentages equals 100% exactly",
      `actual=${totalShare}`
    );

    for (const alloc of res.allocations) {
      assert(!!alloc.why, `channel '${alloc.channelName}' has why rationale`, alloc.why);
      assert(alloc.monthlyAmount >= 0, `channel '${alloc.channelName}' has non-negative amount`);
    }

    assert(!!res.overallRationale, "overallRationale is populated");
  }

  // ── 8. Engine: Malformed Output FAILED State ─────────────────────────────────
  {
    const channels: SelectedChannelInput[] = [
      { channelId: "meta_ads", channelName: "Meta Ads" },
    ];
    const input: BudgetGovernorInput = {
      campaignId: "test-campaign-5",
      monthlyBudget: 5000,
      currency: "USD",
      selectedChannels: channels,
      _mockLlmOutput: {
        allocations: [
          { channelId: "meta_ads", sharePercentage: 200, why: "Share over 100%" },
        ],
      },
    };
    const res = await runBudgetGovernorEngine(input);
    assert(res.mode === "recommendation_only", "malformed allocation returns recommendation_only mode");
    assert(res.status === "FAILED", "malformed allocation produces FAILED status");
    assert(res.allocations.length === 0, "failed result has empty allocations");
  }

  console.log("\n══════════════════════════════════════════════════════════════════");
  if (failed === 0) {
    console.log("  SUITE: ALL ALLOCATION & CURRENCY TESTS PASSED.");
    console.log("══════════════════════════════════════════════════════════════════\n");
    process.exit(0);
  } else {
    console.log(`  SUITE: ${failed} TEST(S) FAILED.`);
    console.log("══════════════════════════════════════════════════════════════════\n");
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution threw error:", err);
  process.exit(1);
});
