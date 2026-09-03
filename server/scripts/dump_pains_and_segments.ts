import 'dotenv/config';
import { db } from "../db";
import { sql } from "drizzle-orm";

async function main() {
  const audRes = await db.execute(sql`SELECT * FROM audience_snapshots WHERE id = 'f9f9cd63-7cbc-44d2-9161-81f9ff98a381'`);
  const aud = audRes.rows[0] as any;
  const pains = JSON.parse(aud.audience_pains || "[]");
  console.log("=== ALL 10 PAINS ===");
  pains.forEach((p: any, i: number) => {
    console.log(`\n--- PAIN ${i + 1} ---`);
    console.log("Key / ID:", p.id || p.painId || p.category);
    console.log("Label / Category:", p.category || p.label);
    console.log("Text / Description:", p.description || p.pain || p.statement);
    console.log("Frequency:", p.frequency);
    console.log("Evidence count:", p.evidenceCount);
    console.log("Evidence sample:", p.evidence?.slice(0, 2));
    console.log("Severity:", p.severity);
  });

  console.log("\n=== ALL 3 SEGMENTS ===");
  const segs = JSON.parse(aud.audience_segments || "[]");
  segs.forEach((s: any, i: number) => {
    console.log(`\n--- SEGMENT ${i + 1} ---`);
    console.log("ID:", s.id);
    console.log("Name:", s.name);
    console.log("Description:", s.description);
    console.log("Pains:", JSON.stringify(s.pains, null, 2));
    console.log("Target Coverage:", JSON.stringify(s.targetCoverage, null, 2));
  });

  process.exit(0);
}

main();
