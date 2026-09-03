import 'dotenv/config';
import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  const events = await db.execute(sql`
    SELECT 
      pce.id,
      pce.account_id,
      pce.campaign_id,
      pce.competitor_id,
      cc.name as competitor_name,
      cc.is_demo,
      pce.kind,
      pce.severity,
      pce.status,
      pce.created_at,
      pce.validated_at,
      pce.updated_at,
      pce.baseline_snapshot_id,
      pce.current_snapshot_id,
      pce.run_id,
      pce.evidence
    FROM pipeline_change_events pce
    LEFT JOIN ci_competitors cc ON pce.competitor_id = cc.id
    WHERE pce.campaign_id = 'campaign_1773576062201_6t0oxi'
    ORDER BY pce.created_at DESC
  `);

  console.log(`=== 26 EVENTS FOR CAMPAIGN: campaign_1773576062201_6t0oxi ===\n`);
  events.rows.forEach((e, idx) => {
    let notes: string[] = [];
    try {
      const ev = typeof e.evidence === 'string' ? JSON.parse(e.evidence) : e.evidence;
      notes = Array.isArray(ev?.notes) ? ev.notes : [];
    } catch(err) {}

    console.log(`[${idx + 1}/26] ID: ${e.id} | Status: "${e.status}" | Kind: "${e.kind}" | Sev: "${e.severity}" | Comp: "${e.competitor_name}" (${e.competitor_id})`);
    console.log(`     Created: ${e.created_at} | Validated: ${e.validated_at}`);
    console.log(`     Snapshots: baseline=${e.baseline_snapshot_id} | current=${e.current_snapshot_id} | Run: ${e.run_id}`);
    console.log(`     Evidence notes: ${JSON.stringify(notes)}`);
  });

  process.exit(0);
}

main();
