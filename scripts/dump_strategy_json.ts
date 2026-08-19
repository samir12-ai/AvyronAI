import "dotenv/config";
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const campaignId = "campaign_1773576062201_6t0oxi";
  const outDir = path.join(process.cwd(), "scratch", "marketmind_strategy_dump");
  fs.mkdirSync(outDir, { recursive: true });

  const tables = [
    "strategy_roots",
    "strategic_plans",
    "plan_documents",
    "audience_snapshots",
    "positioning_snapshots",
    "differentiation_snapshots",
    "mechanism_snapshots",
    "offer_snapshots",
    "awareness_snapshots",
    "persuasion_snapshots",
    "funnel_snapshots",
    "channel_selection_snapshots",
    "business_data_layer",
    "goal_decompositions",
    "growth_simulations",
    "root_bundles",
  ];

  for (const t of tables) {
    const res = await db.execute(sql.raw(`SELECT * FROM ${t} WHERE campaign_id = '${campaignId}'`));
    fs.writeFileSync(path.join(outDir, `${t}.json`), JSON.stringify(res.rows, null, 2));
    console.log(`Wrote ${res.rows.length} rows to ${t}.json`);
  }

  // Also check strategic_blueprints and blueprint_versions
  const bp = await db.execute(sql.raw(`SELECT * FROM strategic_blueprints WHERE campaign_id = '${campaignId}'`));
  fs.writeFileSync(path.join(outDir, `strategic_blueprints.json`), JSON.stringify(bp.rows, null, 2));
  console.log(`Wrote ${bp.rows.length} rows to strategic_blueprints.json`);

  process.exit(0);
}

main().catch(console.error);
