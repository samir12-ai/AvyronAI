import "dotenv/config";
import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  console.log("=== SNAPSHOTS PER COMPETITOR PER CAMPAIGN ===");

  const snapshotGroups = await db.execute(sql`
    SELECT 
      ps.campaign_id,
      ps.account_id,
      ps.entity_id,
      ps.lane,
      cc.name as competitor_name,
      COUNT(ps.id) as snapshot_count,
      MIN(ps.collected_at) as earliest_collected,
      MAX(ps.collected_at) as latest_collected
    FROM pipeline_snapshots ps
    LEFT JOIN ci_competitors cc ON ps.entity_id = cc.id
    GROUP BY ps.campaign_id, ps.account_id, ps.entity_id, ps.lane, cc.name
    ORDER BY ps.campaign_id, ps.entity_id
  `);
  console.table(snapshotGroups.rows);

  process.exit(0);
}

main().catch(console.error);
