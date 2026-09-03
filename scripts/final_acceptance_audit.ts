import 'dotenv/config';
import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  console.log("=== FINAL ACCEPTANCE AUDIT ===");

  const activeCamp = "campaign_1773576062201_6t0oxi";
  const events = await db.execute(sql`
    SELECT 
      pce.id,
      pce.status,
      pce.kind,
      pce.severity,
      cc.name as competitor_name,
      pce.created_at,
      pce.validated_at
    FROM pipeline_change_events pce
    LEFT JOIN ci_competitors cc ON pce.competitor_id = cc.id
    WHERE pce.campaign_id = ${activeCamp}
    ORDER BY pce.created_at DESC
  `);

  console.log(`Campaign: ${activeCamp}`);
  console.log(`Total rows in DB: ${events.rows.length}`);
  
  const underReview = events.rows.filter(r => r.status === 'candidate');
  const confirmed = events.rows.filter(r => r.status === 'confirmed');
  const dismissed = events.rows.filter(r => r.status === 'dismissed');

  console.log(`- Under Review (Candidate): ${underReview.length}`);
  console.log(`- Confirmed: ${confirmed.length}`);
  console.log(`- Dismissed / Invalidated: ${dismissed.length}`);

  console.log("\nDismissed Events (Synthetic Fallback Contamination Safely Invalidated):");
  for (const d of dismissed) {
    console.log(`  * ID: ${d.id} | Competitor: ${d.competitor_name} | Kind: ${d.kind}`);
  }

  process.exit(0);
}

main();
