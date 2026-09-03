import "dotenv/config";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });

const CAMPAIGN = "campaign_1773576062201_6t0oxi";

async function main() {
  const client = await pool.connect();
  try {
    const bdl = await client.query("SELECT * FROM business_data_layer WHERE campaign_id=$1", [CAMPAIGN]);
    console.log("business_data_layer rows:", bdl.rows.length);
    if (bdl.rows[0]) {
      console.log(JSON.stringify(bdl.rows[0], null, 2));
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
