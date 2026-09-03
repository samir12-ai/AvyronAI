import "dotenv/config";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });

async function main() {
  const client = await pool.connect();
  try {
    const cols = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name='funnel_snapshots'");
    console.log("funnel_snapshots cols:", cols.rows.map((c: any) => c.column_name).join(", "));

    const fn = await client.query("SELECT * FROM funnel_snapshots WHERE job_id=$1 LIMIT 1", ["orch_1787659544899_kjkup2"]);
    if (fn.rows[0]) {
      for (const k of Object.keys(fn.rows[0])) {
        const val = fn.rows[0][k];
        if (typeof val === "object" || (typeof val === "string" && val.length < 500)) {
          console.log(`  ${k}:`, typeof val === "object" ? JSON.stringify(val).substring(0, 300) : val);
        }
      }
    }

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
