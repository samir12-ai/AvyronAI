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

  console.log(`TOTAL EVENTS: ${events.rows.length}\n`);
  events.rows.forEach((e, idx) => {
    console.log(`=== EVENT [${idx + 1}/${events.rows.length}] ===`);
    console.log(`ID: ${e.id}`);
    console.log(`Campaign: ${e.campaign_id} | Account: ${e.account_id}`);
    console.log(`Competitor: "${e.competitor_name}" (${e.competitor_id}) [is_demo: ${e.is_demo}]`);
    console.log(`Kind: "${e.kind}" | Status: "${e.status}" | Severity: "${e.severity}"`);
    console.log(`Created: ${e.created_at} | Validated: ${e.validated_at} | Updated: ${e.updated_at}`);
    console.log(`Scope: ${e.scope} | ScopeCount: ${e.scope_competitor_count} | ToValue: ${e.to_value}`);
    console.log(`BaselineSnap: ${e.baseline_snapshot_id} | CurrentSnap: ${e.current_snapshot_id}`);
    console.log(`Evidence: ${e.evidence}\n`);
  });

  process.exit(0);
}

main();
