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
    const res = await client.query("SELECT id, plan_json FROM strategic_plans WHERE campaign_id = $1 ORDER BY created_at DESC LIMIT 1", [campaignId]);
    if (res.rows.length > 0) {
      const plan = res.rows[0];
      const pj = typeof plan.plan_json === 'string' ? JSON.parse(plan.plan_json) : plan.plan_json;
      // Is it in the audience engine's output?
      const audience = pj.engines?.find((e: any) => e.engineName === 'audience' || e.name === 'audience');
      if (audience && audience.details?.painRegistry) {
        console.log(JSON.stringify(audience.details.painRegistry, null, 2));
      } else if (pj.audience?.painRegistry) {
        console.log(JSON.stringify(pj.audience.painRegistry, null, 2));
      } else if (pj.painRegistry) {
        console.log(JSON.stringify(pj.painRegistry, null, 2));
      } else if (pj.strategicSummary?.audiencePains) {
        console.log(JSON.stringify(pj.strategicSummary.audiencePains, null, 2));
      } else {
        console.log("Could not find painRegistry in plan_json keys:", Object.keys(pj));
        if (pj.engines) console.log("Engines:", pj.engines.map((e:any) => e.engineName || e.name));
      }
    } else {
      console.log("No strategic_plans found");
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
