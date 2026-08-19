import "dotenv/config";
import { Pool } from "pg";

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  const client = await pool.connect();

  try {
    const gc = await client.query("SELECT * FROM growth_campaigns WHERE id = 'campaign_1786718877499_3jk4zv'");
    console.log("=== GROWTH CAMPAIGN ===");
    console.log(JSON.stringify(gc.rows[0] || null, null, 2));

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
