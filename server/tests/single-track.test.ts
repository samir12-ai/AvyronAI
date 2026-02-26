import assert from "assert";
import fs from "fs";
import path from "path";

const AUTHORIZED_FILES = [
  "server/strategic-core/execution-routes.ts",
  "server/strategic-core/orchestrator-routes.ts",
];

const TRACKED_TABLES = [
  "strategicPlans",
  "requiredWork",
  "calendarEntries",
  "studioItems",
  "planApprovals",
];

const WRITE_PATTERNS = TRACKED_TABLES.flatMap((table) => [
  new RegExp(`\\.insert\\(${table}\\)`),
  new RegExp(`\\.update\\(${table}\\)`),
  new RegExp(`db\\.delete\\(${table}\\)`),
]);

function getAllServerFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "tests") continue;
      results.push(...getAllServerFiles(fullPath));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      results.push(fullPath);
    }
  }
  return results;
}

function normalizeFilePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

async function testSingleExecutionTrack() {
  console.log("\n=== Single Execution Track Static Scan ===\n");

  const serverDir = path.resolve(__dirname, "..");
  const files = getAllServerFiles(serverDir);

  const violations: { file: string; line: number; content: string; table: string }[] = [];

  for (const filePath of files) {
    const relativePath = normalizeFilePath(path.relative(path.resolve(__dirname, "../.."), filePath));

    if (AUTHORIZED_FILES.includes(relativePath)) {
      continue;
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const pattern of WRITE_PATTERNS) {
        if (pattern.test(line)) {
          const table = TRACKED_TABLES.find((t) => line.includes(t)) || "unknown";
          violations.push({
            file: relativePath,
            line: i + 1,
            content: line.trim(),
            table,
          });
        }
      }
    }
  }

  if (violations.length > 0) {
    console.log("  [FAIL] Unauthorized writes detected:\n");
    for (const v of violations) {
      console.log(`    File: ${v.file}`);
      console.log(`    Line: ${v.line}`);
      console.log(`    Table: ${v.table}`);
      console.log(`    Code: ${v.content}`);
      console.log();
    }
  } else {
    console.log("  [PASS] Zero unauthorized writes to execution tables found outside authorized files.");
  }

  assert.strictEqual(
    violations.length,
    0,
    `Found ${violations.length} unauthorized write(s) to execution tables. All writes to [${TRACKED_TABLES.join(", ")}] must be in [${AUTHORIZED_FILES.join(", ")}].`
  );
}

async function testAuthorizedFilesExist() {
  console.log("\n=== Authorized Files Existence Check ===\n");

  for (const file of AUTHORIZED_FILES) {
    const fullPath = path.resolve(__dirname, "../..", file);
    const exists = fs.existsSync(fullPath);
    assert.ok(exists, `Authorized file missing: ${file}`);
    console.log(`  [PASS] ${file} exists`);
  }
}

async function testDemoRoutesRemoved() {
  console.log("\n=== Demo Routes Removal Check ===\n");

  const demoFiles = [
    path.resolve(__dirname, "../strategic-core/demo-routes.ts"),
    path.resolve(__dirname, "../competitive-intelligence/demo-routes.ts"),
  ];

  for (const filePath of demoFiles) {
    if (fs.existsSync(filePath)) {
      console.log(`  [FAIL] ${path.basename(filePath)} still exists — demo routes must be removed`);
      assert.fail(`Demo route file ${path.basename(filePath)} must not exist`);
    } else {
      console.log(`  [PASS] ${path.basename(filePath)} removed`);
    }
  }
}

async function runAllTests() {
  console.log("╔════════════════════════════════════════════════════╗");
  console.log("║  SINGLE EXECUTION TRACK ENFORCEMENT TEST SUITE    ║");
  console.log("╚════════════════════════════════════════════════════╝");

  let passed = 0;
  let failed = 0;
  const errors: string[] = [];

  const tests = [
    { name: "Authorized files exist", fn: testAuthorizedFilesExist },
    { name: "Single execution track enforcement", fn: testSingleExecutionTrack },
    { name: "Demo routes removed", fn: testDemoRoutesRemoved },
  ];

  for (const test of tests) {
    try {
      await test.fn();
      passed++;
    } catch (err: any) {
      failed++;
      errors.push(`${test.name}: ${err.message}`);
      console.error(`\n  [FAIL] ${test.name}: ${err.message}`);
    }
  }

  console.log("\n════════════════════════════════════════════════════");
  console.log(`Results: ${passed} passed, ${failed} failed out of ${tests.length} tests`);
  console.log("════════════════════════════════════════════════════\n");

  if (failed > 0) {
    console.error("Failures:");
    errors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }
}

runAllTests();
