import * as fs from "fs";
import * as path from "path";

function main() {
  const dir = path.join(process.cwd(), "scratch", "marketmind_strategy_dump");
  const plans = JSON.parse(fs.readFileSync(path.join(dir, "strategic_plans.json"), "utf8"));
  const p = plans.find((x: any) => x.id === "23b8556c-fe75-440a-8ccb-fd520a3d6273");
  const planJson = typeof p.plan_json === "string" ? JSON.parse(p.plan_json) : p.plan_json;

  console.log("=== STRATEGIC SUMMARY (CANONICAL DECISIONS CARD IN UI) ===");
  console.log("strategy:\n", planJson.strategicSummary?.strategy);
  console.log("\ntargetAudience:\n", planJson.strategicSummary?.targetAudience);
  console.log("\ngrowthObjective:\n", planJson.strategicSummary?.growthObjective);
  console.log("\nrationale:\n", planJson.strategicSummary?.rationale);

  console.log("\n=== BUSINESS REPRESENTATION (BUSINESS LANGUAGE LAYER CARD IN UI) ===");
  console.log("strategy:\n", planJson.businessRepresentation?.strategicSummary?.strategy);
  console.log("\ntargetAudience:\n", planJson.businessRepresentation?.strategicSummary?.targetAudience);
  console.log("\ngrowthObjective:\n", planJson.businessRepresentation?.strategicSummary?.growthObjective);
  console.log("\nrationale:\n", planJson.businessRepresentation?.strategicSummary?.rationale);

  console.log("\n=== LOCKED DECISION LABELS ===");
  console.log(JSON.stringify(planJson.lockedDecisionLabels, null, 2));

  console.log("\n=== STRATEGIC PILLARS ===");
  console.log(JSON.stringify(planJson.strategicPillars, null, 2));
}

main();
