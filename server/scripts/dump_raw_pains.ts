import 'dotenv/config';
import { db } from "../db";
import { sql } from "drizzle-orm";
import fs from "fs";

async function main() {
  const audRes = await db.execute(sql`SELECT * FROM audience_snapshots WHERE id = 'f9f9cd63-7cbc-44d2-9161-81f9ff98a381'`);
  const aud = audRes.rows[0] as any;
  const pains = JSON.parse(aud.audience_pains || "[]");
  console.log("=== RAW PAIN OBJECTS ===");
  console.log(JSON.stringify(pains, null, 2));

  console.log("\n=== AUDIENCE SEGMENTS ===");
  const segs = JSON.parse(aud.audience_segments || "[]");
  console.log(JSON.stringify(segs, null, 2));

  console.log("\n=== STRUCTURED SIGNALS ===");
  const sigs = JSON.parse(aud.structured_signals || "{}");
  console.log(JSON.stringify(sigs, null, 2));

  process.exit(0);
}

main();
