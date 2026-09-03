import "dotenv/config";
import { Pool } from "pg";

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  const client = await pool.connect();

  try {
    const accountId = "f020f6c7-15d8-4129-90a6-83a40558c642";

    const res = await client.query(`
      SELECT competitor_id, platform, caption, likes, comments, timestamp 
      FROM ci_competitor_posts 
      WHERE account_id = $1 
      LIMIT 25
    `, [accountId]);

    console.log(`=== SAMPLE 25 POST CAPTIONS FROM CI_COMPETITOR_POSTS ===`);
    res.rows.forEach((r, i) => {
      console.log(`[${i + 1}] Comp: ${r.competitor_id} | Platform: ${r.platform} | Likes: ${r.likes} | Comments: ${r.comments}`);
      console.log(`    Caption: ${JSON.stringify(r.caption?.slice(0, 200))}\n`);
    });

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
