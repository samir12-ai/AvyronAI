import { describe, it, expect } from "vitest";
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

describe("Memory Scoping Integrity", () => {
  it("no client-controlled accountId in strategy-routes.ts", () => {
    const hits = grepFile("req\\.query\\.accountId", STRATEGY_ROUTES_FILE);
    expect(hits).toBe("");
  });

  it("all signal table SELECTs include campaignId filter", () => {
    const tableVars: Record<string, string> = { strategy_memory: "strategyMemory", strategy_insights: "strategyInsights", moat_candidates: "moatCandidates" };
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
          expect(
            context.includes("campaignId") || context.includes("campaign_id")
          ).toBe(true);
        }
      }
    }
  });

  it("NOT NULL + NO DEFAULT on account_id + campaign_id for all 3 signal tables", () => {
    const pgQuery = `SELECT table_name, column_name, is_nullable, column_default FROM information_schema.columns WHERE table_name IN ('strategy_memory','strategy_insights','moat_candidates') AND column_name IN ('account_id','campaign_id') ORDER BY table_name, column_name;`;
    const result = execSync(
      `echo "${pgQuery}" | psql "$DATABASE_URL" -t -A -F,`,
      { cwd: "/home/runner/workspace", encoding: "utf-8" }
    );
    const rows = result.trim().split("\n").filter(Boolean);
    for (const row of rows) {
      const parts = row.split(",");
      const table = parts[0], col = parts[1], nullable = parts[2], colDefault = parts[3] || "";
      expect(nullable).toBe("NO");
      expect(colDefault).toBe("");
    }
    expect(rows.length).toBe(6);
  });

  it("legacy excluded from all signal table reads", () => {
    const files = [STRATEGY_ROUTES_FILE, ORCHESTRATOR_ROUTES_FILE, WORKER_FILE];
    for (const file of files) {
      const content = readFile(file);
      const hasSignalTableRead = content.includes("strategyMemory") || content.includes("strategyInsights") || content.includes("moatCandidates");
      if (hasSignalTableRead) {
        expect(
          content.includes("unscoped_legacy") || content.includes("LEGACY_CAMPAIGN")
        ).toBe(true);
      }
    }
    const strategyContent = readFile(STRATEGY_ROUTES_FILE);
    const legacyCount = (strategyContent.match(/LEGACY_CAMPAIGN/g) || []).length;
    expect(legacyCount).toBeGreaterThanOrEqual(16);
  });

  it("composite indexes exist for signal tables", () => {
    const pgQuery = `SELECT tablename, indexname FROM pg_indexes WHERE indexname LIKE '%account_campaign%' ORDER BY tablename;`;
    const result = execSync(
      `echo "${pgQuery}" | psql "$DATABASE_URL" -t -A -F,`,
      { cwd: "/home/runner/workspace", encoding: "utf-8" }
    );
    const indexCount = result.trim().split("\n").filter(Boolean).length;
    expect(indexCount).toBeGreaterThanOrEqual(3);
  });

  it("requireCampaign middleware used in strategy-routes.ts", () => {
    const routeFile = readFile(STRATEGY_ROUTES_FILE);
    const requireCampaignCount = (routeFile.match(/requireCampaign/g) || []).length;
    expect(requireCampaignCount).toBeGreaterThanOrEqual(10);
  });

  it("write guard rejects legacy campaignId", () => {
    const campaignRoutes = readFile(CAMPAIGN_ROUTES_FILE);
    expect(campaignRoutes).toContain("unscoped_legacy");

    const routeFile = readFile(STRATEGY_ROUTES_FILE);
    const lines = routeFile.split("\n");
    const routeHandlers: { line: number; hasRequireCampaign: boolean }[] = [];
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
      expect(enclosingHandler).toBeDefined();
      expect(enclosingHandler!.hasRequireCampaign).toBe(true);
    }
    expect(insertLines.length).toBeGreaterThanOrEqual(4);
  });

  it("schema has NOT NULL without DEFAULT on account_id for signal tables", () => {
    const schema = readFile("shared/schema.ts");
    const signalTableDefs = [
      { start: 'strategyInsights = pgTable', end: '});' },
      { start: 'strategyMemory = pgTable', end: '});' },
      { start: 'moatCandidates = pgTable', end: '});' },
    ];
    for (const def of signalTableDefs) {
      const startIdx = schema.indexOf(def.start);
      expect(startIdx).not.toBe(-1);
      const endIdx = schema.indexOf(def.end, startIdx);
      const tableDef = schema.substring(startIdx, endIdx + def.end.length);
      expect(tableDef).not.toContain('.default("default")');
      expect(tableDef).toContain('accountId: varchar("account_id").notNull()');
    }
  });
});
