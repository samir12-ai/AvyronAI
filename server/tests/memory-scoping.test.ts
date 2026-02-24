import assert from "assert";
import { execSync } from "child_process";

const SIGNAL_TABLES = ["strategy_memory", "strategy_insights", "moat_candidates"];
const STRATEGY_ROUTES_FILE = "server/strategy-routes.ts";
const ORCHESTRATOR_ROUTES_FILE = "server/strategic-core/orchestrator-routes.ts";
const WORKER_FILE = "server/autonomous-worker.ts";
const CAMPAIGN_ROUTES_FILE = "server/campaign-routes.ts";

function readFile(file: string): string {
  return execSync(`cat /home/runner/workspace/${file}`, { encoding: "utf-8" });
}

function grepFile(pattern: string, file: string): string {
  try {
    return execSync(`grep -n '${pattern}' /home/runner/workspace/${file}`, { encoding: "utf-8" });
  } catch {
    return "";
  }
}

async function testNoClientControlledAccountId() {
  const hits = grepFile("req\\.query\\.accountId", STRATEGY_ROUTES_FILE);
  assert.strictEqual(hits, "", `strategy-routes.ts still reads accountId from req.query:\n${hits}`);
  console.log("  [PASS] Zero req.query.accountId in strategy-routes.ts");
}

async function testAllSelectsDualScoped() {
  const tableVars = { strategy_memory: "strategyMemory", strategy_insights: "strategyInsights", moat_candidates: "moatCandidates" };
  for (const [table, tableVar] of Object.entries(tableVars)) {
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
          `SELECT from ${table} at line ${lineNum} missing campaignId filter:\n${context}`
        );
      }
    }
  }
  console.log("  [PASS] All signal table SELECTs include campaignId filter");
}

async function testDatabaseNotNullNoDefault() {
  const pgQuery = `SELECT table_name, column_name, is_nullable, column_default FROM information_schema.columns WHERE table_name IN ('strategy_memory','strategy_insights','moat_candidates') AND column_name IN ('account_id','campaign_id') ORDER BY table_name, column_name;`;
  const result = execSync(
    `echo "${pgQuery}" | psql "$DATABASE_URL" -t -A -F,`,
    { cwd: "/home/runner/workspace", encoding: "utf-8" }
  );
  const rows = result.trim().split("\n").filter(Boolean);
  for (const row of rows) {
    const parts = row.split(",");
    const table = parts[0], col = parts[1], nullable = parts[2], colDefault = parts[3] || "";
    assert.strictEqual(nullable, "NO", `${table}.${col} is nullable (expected NOT NULL)`);
    assert.strictEqual(colDefault, "", `${table}.${col} has a dangerous default '${colDefault}' (expected NO DEFAULT)`);
  }
  assert.strictEqual(rows.length, 6, "Expected 6 constraint rows (3 tables x 2 columns)");
  console.log("  [PASS] NOT NULL + NO DEFAULT on account_id + campaign_id for all 3 signal tables");
}

async function testLegacyExcludedFromAllReads() {
  const files = [STRATEGY_ROUTES_FILE, ORCHESTRATOR_ROUTES_FILE, WORKER_FILE];
  for (const file of files) {
    const content = readFile(file);
    const hasSignalTableRead = content.includes("strategyMemory") || content.includes("strategyInsights") || content.includes("moatCandidates");
    if (hasSignalTableRead) {
      assert.ok(
        content.includes("unscoped_legacy") || content.includes("LEGACY_CAMPAIGN"),
        `${file} reads signal tables but does NOT exclude unscoped_legacy`
      );
    }
  }
  const strategyContent = readFile(STRATEGY_ROUTES_FILE);
  const legacyCount = (strategyContent.match(/LEGACY_CAMPAIGN/g) || []).length;
  assert.ok(legacyCount >= 16, `Expected 16+ LEGACY_CAMPAIGN exclusions in strategy-routes.ts, found ${legacyCount}`);
  console.log(`  [PASS] Legacy exclusion in all signal-reading files (${legacyCount} exclusions in strategy-routes.ts)`);
}

async function testCompositeIndexes() {
  const pgQuery = `SELECT tablename, indexname FROM pg_indexes WHERE indexname LIKE '%account_campaign%' ORDER BY tablename;`;
  const result = execSync(
    `echo "${pgQuery}" | psql "$DATABASE_URL" -t -A -F,`,
    { cwd: "/home/runner/workspace", encoding: "utf-8" }
  );
  const indexCount = result.trim().split("\n").filter(Boolean).length;
  assert.ok(indexCount >= 3, `Expected at least 3 composite indexes, found ${indexCount}`);
  console.log(`  [PASS] ${indexCount} composite (account_id, campaign_id) indexes found`);
}

async function testRequireCampaignMiddleware() {
  const routeFile = readFile(STRATEGY_ROUTES_FILE);
  const requireCampaignCount = (routeFile.match(/requireCampaign/g) || []).length;
  assert.ok(requireCampaignCount >= 10, `Expected 10+ requireCampaign usages, found ${requireCampaignCount}`);
  console.log(`  [PASS] requireCampaign middleware used ${requireCampaignCount} times in strategy-routes.ts`);
}

async function testWriteGuardRejectsLegacy() {
  const campaignRoutes = readFile(CAMPAIGN_ROUTES_FILE);
  assert.ok(
    campaignRoutes.includes("unscoped_legacy"),
    "requireCampaign middleware does NOT guard against unscoped_legacy campaignId"
  );

  const routeFile = readFile(STRATEGY_ROUTES_FILE);
  const routeHandlerPattern = /app\.(get|post|put|patch|delete)\([^)]+\)/g;
  const routeHandlers: { line: number; hasRequireCampaign: boolean }[] = [];
  const lines = routeFile.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/app\.(get|post|put|patch|delete)\(/)) {
      routeHandlers.push({
        line: i + 1,
        hasRequireCampaign: lines[i].includes("requireCampaign"),
      });
    }
  }

  const insertLines: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/db\.insert\((strategyMemory|strategyInsights|moatCandidates)\)/)) {
      insertLines.push(i + 1);
    }
  }

  for (const insertLine of insertLines) {
    const enclosingHandler = routeHandlers
      .filter((h) => h.line < insertLine)
      .pop();
    assert.ok(
      enclosingHandler && enclosingHandler.hasRequireCampaign,
      `INSERT at line ${insertLine} is inside a route handler (line ${enclosingHandler?.line}) WITHOUT requireCampaign middleware`
    );
  }
  assert.ok(insertLines.length >= 4, `Expected at least 4 signal table INSERTs, found ${insertLines.length}`);
  console.log(`  [PASS] Write guard: ${insertLines.length} signal INSERTs all behind requireCampaign + unscoped_legacy rejected`);
}

async function testSchemaNoDefault() {
  const schema = readFile("shared/schema.ts");
  const signalTableDefs = [
    { start: 'strategyInsights = pgTable', end: '});' },
    { start: 'strategyMemory = pgTable', end: '});' },
    { start: 'moatCandidates = pgTable', end: '});' },
  ];
  for (const def of signalTableDefs) {
    const startIdx = schema.indexOf(def.start);
    assert.ok(startIdx !== -1, `Could not find ${def.start} in schema.ts`);
    const endIdx = schema.indexOf(def.end, startIdx);
    const tableDef = schema.substring(startIdx, endIdx + def.end.length);
    assert.ok(
      !tableDef.includes('.default("default")'),
      `Schema for ${def.start} still has .default("default") on account_id`
    );
    assert.ok(
      tableDef.includes('accountId: varchar("account_id").notNull()'),
      `Schema for ${def.start} missing .notNull() without default on account_id`
    );
  }
  console.log("  [PASS] Schema: account_id is NOT NULL with NO DEFAULT on all 3 signal tables");
}

async function runAll() {
  console.log("\n=== Memory Scoping Integrity Tests (Final Closeout) ===\n");

  const tests = [
    testNoClientControlledAccountId,
    testAllSelectsDualScoped,
    testDatabaseNotNullNoDefault,
    testLegacyExcludedFromAllReads,
    testCompositeIndexes,
    testRequireCampaignMiddleware,
    testWriteGuardRejectsLegacy,
    testSchemaNoDefault,
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
  console.log("Memory scoping integrity VERIFIED — CLOSED");
}

runAll();
