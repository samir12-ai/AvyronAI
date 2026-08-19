import * as fs from "fs";
import * as path from "path";

function main() {
  const dir = path.join(process.cwd(), "scratch", "marketmind_strategy_dump");

  console.log("=== PLAN 2 (ACTIVE APPROVED PLAN: 23b8556c-fe75-440a-8ccb-fd520a3d6273) ===");
  const plans = JSON.parse(fs.readFileSync(path.join(dir, "strategic_plans.json"), "utf8"));
  const activePlan = plans.find((p: any) => p.id === "23b8556c-fe75-440a-8ccb-fd520a3d6273");
  const planJson = typeof activePlan.plan_json === "string" ? JSON.parse(activePlan.plan_json) : activePlan.plan_json;
  console.log(JSON.stringify(planJson, null, 2));

  console.log("\n=== STRATEGY ROOTS ALL ===");
  const roots = JSON.parse(fs.readFileSync(path.join(dir, "strategy_roots.json"), "utf8"));
  roots.forEach((r: any) => {
    console.log(`\n--- Root ID: ${r.id} (status: ${r.status}, createdAt: ${r.created_at}) ---`);
    console.log("primary_axis:", r.primary_axis);
    console.log("contrast_axis_text:", r.contrast_axis_text);
    console.log("approved_mechanism:", r.approved_mechanism);
    console.log("approved_audience_pains:", r.approved_audience_pains);
    console.log("approved_desires:", r.approved_desires);
    console.log("approved_claims:", r.approved_claims);
    console.log("approved_promise:", r.approved_promise);
    console.log("approved_objections:", r.approved_objections);
    console.log("approved_positioning_context:", r.approved_positioning_context);
    console.log("approved_lanes:", r.approved_lanes);
  });
}

main();
