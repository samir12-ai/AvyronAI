import 'dotenv/config';
import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  console.log("==================================================");
  console.log("FULL FORENSIC WATCHTOWER AUDIT DATA");
  console.log("==================================================\n");

  // 1. All events in pipeline_change_events
  const events = await db.execute(sql`
    SELECT 
      pce.id,
      pce.account_id,
      pce.campaign_id,
      pce.competitor_id,
      cc.name as competitor_name,
      cc.is_demo,
      cc.is_active,
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
  
  console.log(`TOTAL EVENTS: ${events.rows.length}`);
  for (const e of events.rows) {
    console.log(`\n--------------------------------------------------`);
    console.log(`EVENT ID: ${e.id}`);
    console.log(`Campaign: ${e.campaign_id} | Account: ${e.account_id}`);
    console.log(`Competitor: "${e.competitor_name}" (ID: ${e.competitor_id}, is_demo: ${e.is_demo}, is_active: ${e.is_active})`);
    console.log(`Status: "${e.status}" | Kind: "${e.kind}" | Severity: "${e.severity}"`);
    console.log(`Created: ${e.created_at} | Validated: ${e.validated_at} | Updated: ${e.updated_at}`);
    console.log(`Scope: ${e.scope} (count: ${e.scope_competitor_count}) | to_value: ${e.to_value}`);
    console.log(`Snapshots: baseline=${e.baseline_snapshot_id} | current=${e.current_snapshot_id}`);
    console.log(`Run ID: ${e.run_id}`);
    console.log(`Evidence: ${e.evidence}`);
  }

  // 2. Strategic Briefs details
  console.log("\n==================================================");
  console.log("STRATEGIC BRIEFS");
  console.log("==================================================");
  const briefs = await db.execute(sql`
    SELECT id, event_id, campaign_id, account_id, status, is_latest, prompt_version, generator_version, judge_version, evidence_version, created_at, completed_at, brief, evidence_registry, judge_result
    FROM watchtower_strategic_briefs
    ORDER BY created_at DESC
  `);
  console.log(`Total strategic briefs: ${briefs.rows.length}`);
  for (const b of briefs.rows) {
    console.log(`- Brief ID: ${b.id} | Event ID: ${b.event_id} | Campaign: ${b.campaign_id} | Status: ${b.status} | Latest: ${b.is_latest} | Created: ${b.created_at}`);
    console.log(`  Brief keys: ${Object.keys(typeof b.brief === 'string' ? JSON.parse(b.brief || '{}') : (b.brief || {}))}`);
    console.log(`  Brief content: ${JSON.stringify(b.brief, null, 2)}`);
  }

  process.exit(0);
}

main();
