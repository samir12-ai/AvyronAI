import * as fs from "fs";
import * as path from "path";

function main() {
  const dir = path.join(process.cwd(), "scratch", "marketmind_strategy_dump");

  console.log("=== INSPECTING STRATEGY_PLANS.JSON ===");
  const plans = JSON.parse(fs.readFileSync(path.join(dir, "strategic_plans.json"), "utf8"));
  plans.forEach((p: any, idx: number) => {
    console.log(`\n--- Plan #${idx+1} (ID: ${p.id}, status: ${p.status}, createdAt: ${p.created_at}) ---`);
    console.log("sections.strategicSummary:", JSON.stringify(p.plan_data?.sections?.strategicSummary, null, 2));
    console.log("sections.businessRepresentation:", JSON.stringify(p.plan_data?.sections?.businessRepresentation, null, 2));
    console.log("sections.strategicPillars:", JSON.stringify(p.plan_data?.sections?.strategicPillars, null, 2));
    console.log("lockedDecisionLabels:", JSON.stringify(p.plan_data?.lockedDecisionLabels, null, 2));
  });

  console.log("\n=== INSPECTING STRATEGY_ROOTS.JSON ===");
  const roots = JSON.parse(fs.readFileSync(path.join(dir, "strategy_roots.json"), "utf8"));
  roots.forEach((r: any, idx: number) => {
    console.log(`\n--- Strategy Root #${idx+1} (ID: ${r.id}, version: ${r.version}, status: ${r.status}, createdAt: ${r.created_at}) ---`);
    console.log("canonical_statement:", r.canonical_statement);
    console.log("payload keys:", Object.keys(r.payload || {}));
    console.log("payload:", JSON.stringify(r.payload, null, 2));
  });
}

main();
