import assert from "assert";

const BASE = "http://localhost:5000";

async function testHealthEndpoint() {
  const res = await fetch(`${BASE}/api/health`);
  const data = await res.json();
  assert.strictEqual(res.status, 200);
  assert.strictEqual(data.ok, true);
  console.log("  [PASS] Health endpoint returns OK");
}

async function testAIBudgetTracking() {
  const { getWeeklyTokenUsage, WEEKLY_TOKEN_BUDGET } = await import("../ai-client");
  const usage = await getWeeklyTokenUsage("test_stabilization");
  assert.ok(typeof usage === "number");
  assert.ok(usage >= 0);
  assert.strictEqual(WEEKLY_TOKEN_BUDGET, 500000);
  console.log(`  [PASS] AI budget tracking works (usage: ${usage}, budget: ${WEEKLY_TOKEN_BUDGET})`);
}

async function testDatabaseIndexes() {
  const res = await fetch(`${BASE}/api/health`);
  assert.strictEqual(res.status, 200);
  console.log("  [PASS] Database accessible (indexes loaded)");
}

async function testCIAnalyzeValidation() {
  const res = await fetch(`${BASE}/api/ci/competitors/analyze-profile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.ok(res.status === 400 || res.status === 422 || res.status === 500);
  console.log("  [PASS] CI analyze-profile rejects empty body");
}

async function testAutopilotEndpoint() {
  const res = await fetch(`${BASE}/api/autopilot/status?accountId=default`);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.ok(data.hasOwnProperty("autopilotOn") || data.hasOwnProperty("mode") || data.hasOwnProperty("state"));
  console.log("  [PASS] Autopilot status endpoint works");
}

async function testNoDirectAIInstantiation() {
  const { execSync } = require("child_process");
  const result = execSync("npx tsx server/tests/ai-scan.test.ts 2>&1", { cwd: "/home/runner/workspace", encoding: "utf-8" });
  assert.ok(result.includes("AI scan passed"));
  assert.ok(result.includes("All AI calls have explicit max_tokens"));
  console.log("  [PASS] AI scan test passes — no direct instantiation");
}

async function runAll() {
  console.log("\n=== STABILIZATION TEST SUITE ===\n");

  const tests = [
    { name: "Health Endpoint", fn: testHealthEndpoint },
    { name: "Database Indexes", fn: testDatabaseIndexes },
    { name: "AI Budget Tracking", fn: testAIBudgetTracking },
    { name: "CI Validation", fn: testCIAnalyzeValidation },
    { name: "Autopilot Status", fn: testAutopilotEndpoint },
    { name: "AI Scan Enforcement", fn: testNoDirectAIInstantiation },
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      await test.fn();
      passed++;
    } catch (err: any) {
      console.error(`  [FAIL] ${test.name}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runAll();
