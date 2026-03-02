import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const AUTHORIZED_FILES = [
  "server/strategic-core/execution-routes.ts",
  "server/strategic-core/orchestrator-routes.ts",
  "server/publish-pipeline.ts",
  "server/studio-analysis-engine.ts",
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

describe("Single Execution Track Enforcement", () => {
  it("authorized files exist", () => {
    for (const file of AUTHORIZED_FILES) {
      const fullPath = path.resolve(__dirname, "../..", file);
      expect(fs.existsSync(fullPath)).toBe(true);
    }
  });

  it("zero unauthorized writes to execution tables", () => {
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
      const violationReport = violations.map(v =>
        `File: ${v.file}, Line: ${v.line}, Table: ${v.table}, Code: ${v.content}`
      ).join("\n");
      expect.fail(`Found ${violations.length} unauthorized write(s):\n${violationReport}`);
    }

    expect(violations).toHaveLength(0);
  });

  it("demo routes removed", () => {
    const demoFiles = [
      path.resolve(__dirname, "../strategic-core/demo-routes.ts"),
      path.resolve(__dirname, "../competitive-intelligence/demo-routes.ts"),
    ];

    for (const filePath of demoFiles) {
      expect(fs.existsSync(filePath)).toBe(false);
    }
  });
});
