import * as fs from "fs";

const plan = JSON.parse(fs.readFileSync("scripts/sfi_plan_dump.json", "utf-8"));
const roots = JSON.parse(fs.readFileSync("scripts/sfi_roots_dump.json", "utf-8"));

console.log("=== SFI PLAN FORENSIC DUMP ===");
console.log("Strategic Summary:", JSON.stringify(plan.strategicSummary, null, 2));
console.log("\nMonthly Objective:", JSON.stringify(plan.monthlyObjective, null, 2));
console.log("\nContent Distribution:", JSON.stringify(plan.contentDistribution, null, 2));
console.log("\nExecution Blueprint DNA Link:", JSON.stringify(plan.executionBlueprintDnaLink, null, 2));
console.log("\nBrand Spine in Plan:", JSON.stringify(plan.brandSpine, null, 2));
console.log("\nApproved Lanes in Plan:", JSON.stringify(plan.approvedLanes, null, 2));

console.log("\n=== LATEST STRATEGY ROOT DUMP ===");
const r0 = roots[0];
console.log("Root ID:", r0.id);
console.log("Primary Axis:", r0.primary_axis);
console.log("Contrast Axis Text:", r0.contrast_axis_text);
console.log("Approved Mechanism:", r0.approved_mechanism);
console.log("Approved Claims:", r0.approved_claims || r0.approved_claim);
console.log("Approved Audience Pains:", r0.approved_audience_pains);
console.log("Approved Positioning Context:", r0.approved_positioning_context);
console.log("Approved Lanes:", r0.approved_lanes);
console.log("Brand Spine:", r0.brand_spine);
