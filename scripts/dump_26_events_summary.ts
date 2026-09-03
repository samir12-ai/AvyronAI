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
      pce.kind,
      pce.severity,
      pce.status,
      pce.created_at,
      pce.validated_at,
      pce.baseline_snapshot_id,
      pce.current_snapshot_id,
      pce.evidence
    FROM pipeline_change_events pce
    LEFT JOIN ci_competitors cc ON pce.competitor_id = cc.id
    WHERE pce.campaign_id = 'campaign_1773576062201_6t0oxi'
    ORDER BY pce.created_at DESC
  `);

  console.log(`TOTAL: ${events.rows.length}`);
  for (let i = 0; i < events.rows.length; i++) {
    const e = events.rows[i];
    let notes: string[] = [];
    try {
      const ev = typeof e.evidence === 'string' ? JSON.parse(e.evidence) : e.evidence;
      notes = Array.isArray(ev?.notes) ? ev.notes : [];
    } catch(err) {}

    console.log(`[${i+1}] ${e.id} | ${e.competitor_name} | ${e.kind} | ${e.severity} | ${e.status} | ${e.created_at} | ${notes[0] || 'no notes'}`);
  }

  process.exit(0);
}

main();
