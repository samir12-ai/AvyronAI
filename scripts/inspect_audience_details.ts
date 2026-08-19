import * as fs from "fs";
import * as path from "path";

function main() {
  const dir = path.join(process.cwd(), "scratch", "marketmind_strategy_dump");
  const aud = JSON.parse(fs.readFileSync(path.join(dir, "audience_snapshots.json"), "utf8"));
  
  aud.forEach((a: any, i: number) => {
    console.log(`\n================================================================================`);
    console.log(`  AUDIENCE SNAPSHOT #${i+1} (ID: ${a.id}, CreatedAt: ${a.created_at})`);
    console.log(`================================================================================`);
    for (const [k, v] of Object.entries(a)) {
      if (k === "id" || k === "campaign_id" || k === "account_id") continue;
      console.log(`\n--- FIELD: ${k} ---`);
      if (typeof v === "string" && (v.startsWith("{") || v.startsWith("["))) {
        try {
          console.log(JSON.stringify(JSON.parse(v), null, 2));
        } catch {
          console.log(v);
        }
      } else {
        console.log(typeof v === "object" ? JSON.stringify(v, null, 2) : v);
      }
    }
  });
}

main();
