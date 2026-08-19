import * as fs from "fs";
import * as path from "path";

function main() {
  const dir = path.join(process.cwd(), "scratch", "marketmind_strategy_dump");

  const files = [
    "audience_snapshots.json",
    "positioning_snapshots.json",
    "differentiation_snapshots.json",
    "mechanism_snapshots.json",
    "offer_snapshots.json",
    "awareness_snapshots.json",
    "persuasion_snapshots.json",
    "funnel_snapshots.json",
    "channel_selection_snapshots.json",
    "strategy_roots.json",
    "strategic_plans.json",
    "root_bundles.json",
  ];

  for (const file of files) {
    const filePath = path.join(dir, file);
    if (!fs.existsSync(filePath)) continue;
    const items = JSON.parse(fs.readFileSync(filePath, "utf8"));
    console.log(`\n================================================================================`);
    console.log(`  FILE: ${file} (rows=${items.length})`);
    console.log(`================================================================================`);
    items.forEach((item: any, idx: number) => {
      console.log(`\n--- [Row #${idx+1}] ID: ${item.id} | Status: ${item.status} | CreatedAt: ${item.created_at} ---`);
      for (const [k, v] of Object.entries(item)) {
        if (k === "id" || k === "campaign_id" || k === "account_id") continue;
        if (typeof v === "string" && (v.startsWith("{") || v.startsWith("["))) {
          try {
            console.log(`  ${k}:`, JSON.stringify(JSON.parse(v), null, 2));
          } catch {
            console.log(`  ${k}:`, v);
          }
        } else {
          console.log(`  ${k}:`, typeof v === "object" ? JSON.stringify(v, null, 2) : v);
        }
      }
    });
  }
}

main();
