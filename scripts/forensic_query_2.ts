import "dotenv/config";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });

async function main() {
  const client = await pool.connect();
  try {
    // 1. Audience snapshot for the fresh run
    console.log("=== AUDIENCE SNAPSHOT (fresh run) ===");
    const aud = await client.query(
      "SELECT id, created_at, job_id FROM audience_snapshots WHERE job_id=$1",
      ["orch_1787659544899_kjkup2"]
    );
    console.log("Rows:", aud.rows.length);
    if (aud.rows[0]) {
      console.log("ID:", aud.rows[0].id, "| Created:", aud.rows[0].created_at);
    }

    // Get audience pains from the snapshot
    const cols = await client.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name='audience_snapshots'",
    );
    console.log("\nAudience columns:", cols.rows.map((c: any) => c.column_name).join(", "));

    // Get the full snapshot data - look for segment/pain data
    const full = await client.query(
      "SELECT * FROM audience_snapshots WHERE job_id=$1",
      ["orch_1787659544899_kjkup2"]
    );
    if (full.rows[0]) {
      const row = full.rows[0];
      // Search each large text/json column for contamination
      for (const key of Object.keys(row)) {
        const val = String(row[key] || "");
        if (val.length > 100) {
          const hasBilling = val.toLowerCase().includes("billing");
          const hasRefund = val.toLowerCase().includes("refund");
          const hasFrustrated = val.toLowerCase().includes("frustrated saa");
          const hasUnauthorized = val.toLowerCase().includes("unauthorized");
          if (hasBilling || hasRefund || hasFrustrated || hasUnauthorized) {
            console.log("\n*** CONTAMINATION in column " + key + " ***");
            for (const term of ["billing", "refund", "frustrated saa", "unauthorized"]) {
              const idx = val.toLowerCase().indexOf(term);
              if (idx >= 0) {
                console.log("  " + term + ": ..." + val.substring(Math.max(0, idx - 60), idx + term.length + 60).replace(/\n/g, " ") + "...");
              }
            }
          }
        }
      }
    }

    // 2. Strategy Root - check which root was used
    console.log("\n=== STRATEGY ROOT ===");
    const rootCols = await client.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name='strategy_roots'",
    );
    console.log("Strategy root columns:", rootCols.rows.map((c: any) => c.column_name).join(", "));

    const roots = await client.query(
      "SELECT id, version, campaign_id, created_at FROM strategy_roots WHERE campaign_id=$1 ORDER BY created_at DESC LIMIT 3",
      ["campaign_1773576062201_6t0oxi"]
    );
    console.log("\nRecent strategy roots:");
    for (const r of roots.rows) {
      console.log("  ID=" + r.id + " v" + r.version + " created=" + r.created_at);
    }

    // 3. Growth objective from plan
    console.log("\n=== GROWTH OBJECTIVE SOURCE ===");
    const plan = await client.query(
      "SELECT plan_json FROM strategic_plans WHERE id=$1",
      ["9ba567fd-0ae1-4d69-91b1-0ab561ac5960"]
    );
    if (plan.rows[0]) {
      const planStr = plan.rows[0].plan_json;
      const goIdx = planStr.indexOf("growthObjective");
      if (goIdx >= 0) {
        console.log("growthObjective context:", planStr.substring(goIdx, goIdx + 200).replace(/\n/g, " "));
      }
      const funnelIdx = planStr.indexOf("qualified lead");
      if (funnelIdx >= 0) {
        console.log("\n'qualified lead' context:", planStr.substring(Math.max(0, funnelIdx - 100), funnelIdx + 100).replace(/\n/g, " "));
      }
      const ctrMatch = planStr.match(/[0-9,.]+%?\s*CTR/gi);
      if (ctrMatch) console.log("\nCTR refs:", ctrMatch.slice(0, 5));
      const prospectMatch = planStr.match(/[0-9,]+\s*prospect/gi);
      if (prospectMatch) console.log("Prospect refs:", prospectMatch.slice(0, 5));
    }

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => { console.error(err.message); process.exit(1); });
