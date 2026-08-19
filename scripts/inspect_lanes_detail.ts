import * as fs from "fs";

const root = JSON.parse(fs.readFileSync("scripts/latest_root_dump.json", "utf-8"));
console.log("=== Strategy Root Identity ===");
console.log("ID:", root.id);
console.log("Account ID:", root.account_id);
console.log("Campaign ID:", root.campaign_id);
console.log("Run ID:", root.run_id);
console.log("Root Hash:", root.root_hash);
console.log("Primary Axis:", root.primary_axis);
console.log("Contrast Axis Text:", root.contrast_axis_text);

const lanes = typeof root.approved_lanes === "string" ? JSON.parse(root.approved_lanes) : root.approved_lanes;
console.log("\n=== Approved Lanes ===");
lanes.forEach((l: any, idx: number) => {
  console.log(`\n--- Lane ${idx + 1}: ${l.title} ---`);
  console.log("ID:", l.id);
  console.log("Audience Segments:", l.audienceSegments);
  console.log("Pain IDs:", l.painIds);
  console.log("Desires:", l.desires);
  console.log("Objections:", l.objections);
  console.log("Messaging Direction:", l.messagingDirection);
  console.log("Commercial Priority:", l.commercialPriority);
});
