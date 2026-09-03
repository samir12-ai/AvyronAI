import 'dotenv/config';
import { db } from "../db";
import { sql } from "drizzle-orm";

async function main() {
  const jobId = "orch_1787420716056_rbf142";
  const campaignId = "campaign_1773576062201_6t0oxi";

  // 1. Positioning snapshot raw JSON
  const posRes = await db.execute(sql`SELECT * FROM positioning_snapshots WHERE job_id = ${jobId}`);
  const posSnap = posRes.rows[0] as any;
  console.log("=== POSITIONING FULL SNAPSHOT ===");
  for (const k of Object.keys(posSnap)) {
    let val = posSnap[k];
    if (typeof val === 'string' && (val.startsWith('{') || val.startsWith('['))) {
      try { val = JSON.parse(val); } catch {}
    }
    console.log(`[${k}]:`, typeof val === 'object' ? JSON.stringify(val, null, 2) : val);
  }

  // 2. Mechanism snapshot raw JSON
  const mechRes = await db.execute(sql`SELECT * FROM mechanism_snapshots WHERE job_id = ${jobId}`);
  const mechSnap = mechRes.rows[0] as any;
  console.log("\n=== MECHANISM FULL SNAPSHOT ===");
  for (const k of Object.keys(mechSnap)) {
    let val = mechSnap[k];
    if (typeof val === 'string' && (val.startsWith('{') || val.startsWith('['))) {
      try { val = JSON.parse(val); } catch {}
    }
    console.log(`[${k}]:`, typeof val === 'object' ? JSON.stringify(val, null, 2) : val);
  }

  // 3. Offer snapshot raw JSON
  const offerRes = await db.execute(sql`SELECT * FROM offer_snapshots WHERE job_id = ${jobId}`);
  const offerSnap = offerRes.rows[0] as any;
  console.log("\n=== OFFER FULL SNAPSHOT ===");
  for (const k of Object.keys(offerSnap)) {
    let val = offerSnap[k];
    if (typeof val === 'string' && (val.startsWith('{') || val.startsWith('['))) {
      try { val = JSON.parse(val); } catch {}
    }
    console.log(`[${k}]:`, typeof val === 'object' ? JSON.stringify(val, null, 2) : val);
  }

  process.exit(0);
}

main();
