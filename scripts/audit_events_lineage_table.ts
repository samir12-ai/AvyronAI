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
      pce.scope,
      pce.scope_competitor_count,
      pce.to_value,
      pce.created_at,
      pce.validated_at,
      pce.updated_at,
      pce.baseline_snapshot_id,
      pce.current_snapshot_id,
      pce.run_id,
      pce.evidence
    FROM pipeline_change_events pce
    LEFT JOIN ci_competitors cc ON pce.competitor_id = cc.id
    ORDER BY pce.created_at DESC
  `);

  console.log("=== ALL 40 EVENTS AUDIT TABLE ===\n");
  console.log("| Event ID | Campaign | Competitor | Status | Kind | First Seen (CreatedAt) | ConfirmedAt (ValidatedAt) | Baseline Snap | Current Snap | Run ID | Evidence Notes Count | Notes Preview |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|---|");

  for (const e of events.rows) {
    let notes: string[] = [];
    try {
      const ev = typeof e.evidence === 'string' ? JSON.parse(e.evidence) : e.evidence;
      notes = Array.isArray(ev?.notes) ? ev.notes : [];
    } catch(err) {}

    const firstSeen = e.created_at ? (e.created_at instanceof Date ? e.created_at.toISOString() : String(e.created_at)) : "null";
    const confirmedAt = e.validated_at ? (e.validated_at instanceof Date ? e.validated_at.toISOString() : String(e.validated_at)) : "null";
    const notesPreview = notes.length > 0 ? notes[0].replace(/\|/g, "/").slice(0, 60) : "none";

    console.log(`| ${e.id} | ${e.campaign_id} | ${e.competitor_name || "null"} | ${e.status} | ${e.kind} | ${firstSeen} | ${confirmedAt} | ${e.baseline_snapshot_id} | ${e.current_snapshot_id} | ${e.run_id} | ${notes.length} | ${notesPreview} |`);
  }

  process.exit(0);
}

main();
