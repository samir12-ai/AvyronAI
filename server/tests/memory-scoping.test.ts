import assert from "assert";
import { execSync } from "child_process";

const SIGNAL_TABLES = ["strategy_memory", "strategy_insights", "moat_candidates"];
const STRATEGY_ROUTES_FILE = "server/strategy-routes.ts";
const ORCHESTRATOR_ROUTES_FILE = "server/strategic-core/orchestrator-routes.ts";
const WORKER_FILE = "server/autonomous-worker.ts";

function grepFile(pattern: string, file: string): string {
  try {
    return execSync(`grep -n '${pattern}' ${file}`, { cwd: "/home/runner/workspace", encoding: "utf-8" });
  } catch {
    return "";
  }
}

function grepFileCount(pattern: string, file: string): number {
  try {
    const result = execSync(`grep -c '${pattern}' ${file}`, { cwd: "/home/runner/workspace", encoding: "utf-8" });
    return parseInt(result.trim(), 10);
  } catch {
    return 0;
  }
}

async function testNoClientControlledAccountId() {
  const hits = grepFile("req\\.query\\.accountId", STRATEGY_ROUTES_FILE);
  assert.strictEqual(hits, "", `FAIL: strategy-routes.ts still reads accountId from req.query:\n${hits}`);
  console.log("  [PASS] No req.query.accountId in strategy-routes.ts");
}

async function testNoDualScopeBypass() {
  for (const table of SIGNAL_TABLES) {
    const tableVar = table === "strategy_memory" ? "strategyMemory"
      : table === "strategy_insights" ? "strategyInsights"
      : "moatCandidates";

    const selectHits = grepFile(`\\.from(${tableVar})`, STRATEGY_ROUTES_FILE);
    if (selectHits) {
      const lines = selectHits.split("\n").filter(Boolean);
      for (const line of lines) {
        const lineNum = parseInt(line.split(":")[0], 10);
        const context = execSync(
          `sed -n '${lineNum},${lineNum + 5}p' /home/runner/workspace/${STRATEGY_ROUTES_FILE}`,
          { encoding: "utf-8" }
        );
        assert.ok(
          context.includes("campaignId") || context.includes("campaign_id"),
          `FAIL: SELECT from ${table} at line ${lineNum} missing campaignId filter:\n${context}`
        );
      }
    }
  }
  console.log("  [PASS] All signal table SELECTs include campaignId filter");
}

async function testDatabaseNotNullConstraints() {
  const pgQuery = `SELECT table_name, column_name, is_nullable FROM information_schema.columns WHERE table_name IN ('strategy_memory','strategy_insights','moat_candidates') AND column_name IN ('account_id','campaign_id') ORDER BY table_name, column_name;`;
  const result = execSync(
    `echo "${pgQuery}" | psql "$DATABASE_URL" -t -A -F,`,
    { cwd: "/home/runner/workspace", encoding: "utf-8" }
  );
  const rows = result.trim().split("\n").filter(Boolean);
  for (const row of rows) {
    const [table, col, nullable] = row.split(",");
    assert.strictEqual(nullable, "NO", `FAIL: ${table}.${col} is nullable (expected NOT NULL)`);
  }
  assert.strictEqual(rows.length, 6, "Expected 6 constraint rows (3 tables x 2 columns)");
  console.log("  [PASS] NOT NULL constraints on account_id + campaign_id for all 3 signal tables");
}

async function testLegacyDataExclusion() {
  const orchestratorContent = execSync(
    `cat /home/runner/workspace/${ORCHESTRATOR_ROUTES_FILE}`,
    { encoding: "utf-8" }
  );
  assert.ok(
    orchestratorContent.includes("unscoped_legacy"),
    "FAIL: Orchestrator does not exclude unscoped_legacy rows"
  );
  console.log("  [PASS] Orchestrator excludes unscoped_legacy data from signal injection");
}

async function testCompositeIndexes() {
  const pgQuery = `SELECT tablename, indexname FROM pg_indexes WHERE indexname LIKE '%account_campaign%' ORDER BY tablename;`;
  const result = execSync(
    `echo "${pgQuery}" | psql "$DATABASE_URL" -t -A -F,`,
    { cwd: "/home/runner/workspace", encoding: "utf-8" }
  );
  const indexCount = result.trim().split("\n").filter(Boolean).length;
  assert.ok(indexCount >= 3, `FAIL: Expected at least 3 composite indexes, found ${indexCount}`);
  console.log(`  [PASS] ${indexCount} composite (account_id, campaign_id) indexes found`);
}

async function testRequireCampaignMiddleware() {
  const routeFile = execSync(
    `cat /home/runner/workspace/${STRATEGY_ROUTES_FILE}`,
    { encoding: "utf-8" }
  );
  const requireCampaignCount = (routeFile.match(/requireCampaign/g) || []).length;
  assert.ok(requireCampaignCount >= 10, `FAIL: Expected 10+ requireCampaign usages, found ${requireCampaignCount}`);
  console.log(`  [PASS] requireCampaign middleware used ${requireCampaignCount} times in strategy-routes.ts`);
}

async function runAll() {
  console.log("\n=== Memory Scoping Integrity Tests ===\n");

  const tests = [
    testNoClientControlledAccountId,
    testNoDualScopeBypass,
    testDatabaseNotNullConstraints,
    testLegacyDataExclusion,
    testCompositeIndexes,
    testRequireCampaignMiddleware,
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      await test();
      passed++;
    } catch (err: any) {
      console.error(`  [FAIL] ${test.name}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    process.exit(1);
  }
  console.log("Memory scoping integrity VERIFIED");
}

runAll();
