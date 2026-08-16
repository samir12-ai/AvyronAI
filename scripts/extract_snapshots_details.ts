import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  const campaignId = "campaign_1786718877499_3jk4zv";

  console.log("=== EXTRACTING DATA FROM DB ===");

  // 1. mi_snapshots
  const mi = await db.execute(sql`SELECT * FROM mi_snapshots WHERE campaign_id = ${campaignId} ORDER BY created_at DESC LIMIT 1`);
  console.log("\n--- MI SNAPSHOT ---");
  if (mi.rows.length > 0) {
    console.log(JSON.stringify(mi.rows[0], null, 2));
  } else {
    console.log("None");
  }

  // 2. audience_snapshots
  const aud = await db.execute(sql`SELECT * FROM audience_snapshots WHERE campaign_id = ${campaignId} ORDER BY created_at DESC LIMIT 1`);
  console.log("\n--- AUDIENCE SNAPSHOT ---");
  if (aud.rows.length > 0) {
    console.log(JSON.stringify(aud.rows[0], null, 2));
  } else {
    console.log("None");
  }

  // 3. positioning_snapshots
  const pos = await db.execute(sql`SELECT * FROM positioning_snapshots WHERE campaign_id = ${campaignId} ORDER BY created_at DESC LIMIT 1`);
  console.log("\n--- POSITIONING SNAPSHOT ---");
  if (pos.rows.length > 0) {
    console.log(JSON.stringify(pos.rows[0], null, 2));
  } else {
    console.log("None");
  }

  // 4. differentiation_snapshots
  const diff = await db.execute(sql`SELECT * FROM differentiation_snapshots WHERE campaign_id = ${campaignId} ORDER BY created_at DESC LIMIT 1`);
  console.log("\n--- DIFFERENTIATION SNAPSHOT ---");
  if (diff.rows.length > 0) {
    console.log(JSON.stringify(diff.rows[0], null, 2));
  } else {
    console.log("None");
  }

  // 5. mechanism_snapshots
  const mech = await db.execute(sql`SELECT * FROM mechanism_snapshots WHERE campaign_id = ${campaignId} ORDER BY created_at DESC LIMIT 1`);
  console.log("\n--- MECHANISM SNAPSHOT ---");
  if (mech.rows.length > 0) {
    console.log(JSON.stringify(mech.rows[0], null, 2));
  } else {
    console.log("None");
  }

  // 6. offer_snapshots
  const offer = await db.execute(sql`SELECT * FROM offer_snapshots WHERE campaign_id = ${campaignId} ORDER BY created_at DESC LIMIT 1`);
  console.log("\n--- OFFER SNAPSHOT ---");
  if (offer.rows.length > 0) {
    console.log(JSON.stringify(offer.rows[0], null, 2));
  } else {
    console.log("None");
  }

  // 7. funnel_snapshots
  const fun = await db.execute(sql`SELECT * FROM funnel_snapshots WHERE campaign_id = ${campaignId} ORDER BY created_at DESC LIMIT 1`);
  console.log("\n--- FUNNEL SNAPSHOT ---");
  if (fun.rows.length > 0) {
    console.log(JSON.stringify(fun.rows[0], null, 2));
  } else {
    console.log("None");
  }

  // 8. strategy_roots
  const roots = await db.execute(sql`SELECT * FROM strategy_roots WHERE campaign_id = ${campaignId} ORDER BY created_at DESC LIMIT 1`);
  console.log("\n--- STRATEGY ROOT ---");
  if (roots.rows.length > 0) {
    console.log(JSON.stringify(roots.rows[0], null, 2));
  } else {
    console.log("None");
  }
}

main().then(() => process.exit(0)).catch(e => {
  console.error(e);
  process.exit(1);
});
