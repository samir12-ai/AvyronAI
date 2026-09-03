import 'dotenv/config';
import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  console.log("=== EVENTS GROUPED BY CAMPAIGN ===");
  const campCounts = await db.execute(sql`
    SELECT 
      campaign_id, 
      COUNT(*) as total,
      COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as confirmed_count,
      COUNT(CASE WHEN status = 'candidate' THEN 1 END) as candidate_count,
      COUNT(CASE WHEN status IN ('archived', 'dismissed', 'closed') THEN 1 END) as archived_count,
      array_agg(DISTINCT status) as statuses,
      array_agg(DISTINCT kind) as kinds
    FROM pipeline_change_events
    GROUP BY campaign_id
  `);

  console.log(JSON.stringify(campCounts.rows, null, 2));

  console.log("\n=== EVENTS FOR CAMPAIGN: campaign_1773576062201_6t0oxi ===");
  const activeCampEvents = await db.execute(sql`
    SELECT 
      pce.id,
      pce.account_id,
      pce.campaign_id,
      pce.competitor_id,
      cc.name as competitor_name,
      pce.kind,
      pce.severity,
      pce.status,
      pce.scope,
      pce.created_at,
      pce.validated_at,
      pce.updated_at,
      pce.baseline_snapshot_id,
      pce.current_snapshot_id,
      pce.evidence
    FROM pipeline_change_events pce
    LEFT JOIN ci_competitors cc ON pce.competitor_id = cc.id
    WHERE pce.campaign_id = 'campaign_1773576062201_6t0oxi'
    ORDER BY pce.created_at DESC
  `);
  console.log(`Total events for campaign_1773576062201_6t0oxi: ${activeCampEvents.rows.length}`);
  for (const e of activeCampEvents.rows) {
    console.log(`\n- Event: ${e.id} | Status: "${e.status}" | Kind: "${e.kind}" | Sev: "${e.severity}" | Comp: "${e.competitor_name}"`);
    console.log(`  Created: ${e.created_at} | Validated: ${e.validated_at}`);
    console.log(`  Snapshots: baseline=${e.baseline_snapshot_id}, current=${e.current_snapshot_id}`);
    console.log(`  Evidence: ${e.evidence}`);
  }

  process.exit(0);
}

main();
