import "dotenv/config";
import { Pool } from "pg";

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  const client = await pool.connect();
  const campaignId = "campaign_1786718877499_3jk4zv";

  try {
    const logs = await client.query("SELECT * FROM audit_log WHERE event_type LIKE '%pain%' OR details LIKE '%pain%' OR details LIKE '%CLASSIFIER%' ORDER BY created_at DESC LIMIT 50");
    console.log("Audit logs:", logs.rows);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
