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
    const res = await client.query("SELECT id, brand_spine, created_at FROM strategy_roots WHERE campaign_id = $1 ORDER BY created_at DESC LIMIT 1", [campaignId]);
    if (res.rows.length > 0) {
      const root = res.rows[0];
      const spine = typeof root.brand_spine === 'string' ? JSON.parse(root.brand_spine) : root.brand_spine;
      const audience = spine.engines?.find((e: any) => e.engineName === 'audience' || e.name === 'audience');
      if (audience && audience.details && audience.details.painRegistry) {
         console.log(JSON.stringify(audience.details.painRegistry, null, 2));
      } else if (spine.audience) {
         console.log(JSON.stringify(spine.audience.details?.painRegistry || spine.audience.painRegistry, null, 2));
      } else {
         console.log("Could not find painRegistry in root:", JSON.stringify(Object.keys(spine), null, 2));
      }
    } else {
      console.log("No roots found");
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
