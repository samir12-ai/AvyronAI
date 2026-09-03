import "dotenv/config";
import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function forensicTrace() {
  console.log("=== 1. campaign_offerings (off_70677f8f-1) ===");
  const co = await db.execute(sql`SELECT * FROM campaign_offerings WHERE id = 'off_70677f8f-1'`);
  console.log(JSON.stringify(co.rows, null, 2));

  console.log("\n=== 2. offering_input_evidence (all for camp_mtewrp8kkom3 / off_70677f8f-1 / ev_3df52138-4) ===");
  const oie = await db.execute(sql`SELECT * FROM offering_input_evidence WHERE id = 'ev_3df52138-4' OR campaign_offering_id = 'off_70677f8f-1' OR campaign_id = 'camp_mtewrp8kkom3'`);
  console.log(JSON.stringify(oie.rows, null, 2));

  console.log("\n=== 3. business_understanding_snapshots ===");
  const bu = await db.execute(sql`SELECT id, account_id, campaign_id, campaign_offering_id, offering_input_evidence_id, status, created_at, business_understanding FROM business_understanding_snapshots WHERE campaign_id = 'camp_mtewrp8kkom3'`);
  console.log(JSON.stringify(bu.rows, null, 2));

  console.log("\n=== 4. campaign_selections ===");
  const cs = await db.execute(sql`SELECT * FROM campaign_selections WHERE selected_campaign_id = 'camp_mtewrp8kkom3'`);
  console.log(JSON.stringify(cs.rows, null, 2));

  console.log("\n=== 5. growth_campaigns ===");
  const gc = await db.execute(sql`SELECT * FROM growth_campaigns WHERE id = 'camp_mtewrp8kkom3'`);
  console.log(JSON.stringify(gc.rows, null, 2));

  console.log("\n=== 6. strategy_roots ===");
  const sr = await db.execute(sql`SELECT * FROM strategy_roots WHERE campaign_id = 'camp_mtewrp8kkom3'`);
  console.log(JSON.stringify(sr.rows, null, 2));

  console.log("\n=== 7. business_data_layer ===");
  const bdl = await db.execute(sql`SELECT * FROM business_data_layer WHERE account_id = 'f020f6c7-15d8-4129-90a6-83a40558c642'`);
  console.log(JSON.stringify(bdl.rows, null, 2));

  process.exit(0);
}

forensicTrace().catch(console.error);
