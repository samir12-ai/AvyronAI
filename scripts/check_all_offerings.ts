import "dotenv/config";
import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function checkAllOfferings() {
  console.log("=== All campaign_offerings for camp_mtewrp8kkom3 ===");
  const allCO = await db.execute(sql`SELECT * FROM campaign_offerings WHERE campaign_id = 'camp_mtewrp8kkom3'`);
  console.log(allCO.rows);

  console.log("\n=== All offering_input_evidence for camp_mtewrp8kkom3 ===");
  const allOIE = await db.execute(sql`SELECT * FROM offering_input_evidence WHERE campaign_id = 'camp_mtewrp8kkom3'`);
  console.log(allOIE.rows);

  console.log("\n=== All campaign_offerings across DB ===");
  const totalCO = await db.execute(sql`SELECT * FROM campaign_offerings LIMIT 20`);
  console.log(totalCO.rows);

  process.exit(0);
}
checkAllOfferings().catch(console.error);
