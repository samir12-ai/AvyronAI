import * as fs from "fs";

const planRow = JSON.parse(fs.readFileSync("scripts/latest_plan_dump.json", "utf-8"));
console.log("=== Strategic Plan Record ===");
console.log("ID:", planRow.id);
console.log("Status:", planRow.status);
console.log("Created At:", planRow.created_at);

const planJson = typeof planRow.plan_json === "string" ? JSON.parse(planRow.plan_json) : planRow.plan_json;
console.log("\n=== Section 1: Strategic Summary ===");
console.log(JSON.stringify(planJson.strategicSummary, null, 2));

console.log("\n=== Section 2: Monthly Objective ===");
console.log(JSON.stringify(planJson.monthlyObjective, null, 2));

console.log("\n=== Section 3: Content Distribution ===");
console.log("Rationale:", planJson.contentDistribution?.rationale);
console.log("Content Pillars:", JSON.stringify(planJson.contentDistribution?.contentPillars, null, 2));

console.log("\n=== Section 4: Creative Testing ===");
console.log(JSON.stringify(planJson.creativeTesting, null, 2));

console.log("\n=== Section 5: Budget Allocation ===");
console.log(JSON.stringify(planJson.budgetAllocation, null, 2));

console.log("\n=== Section 6: KPI Monitoring ===");
console.log(JSON.stringify(planJson.kpiMonitoring, null, 2));

console.log("\n=== Section 7: Risk Triggers & Escalation ===");
console.log(JSON.stringify(planJson.riskTriggers, null, 2));

console.log("\n=== Section 8: Execution Blueprint DNA Link ===");
console.log(JSON.stringify(planJson.executionBlueprintDnaLink, null, 2));

if (planJson.businessRepresentation) {
  console.log("\n=== BLL Business Representation ===");
  console.log(JSON.stringify(planJson.businessRepresentation, null, 2));
}
