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
    const campaignId = "camp_mtewrp8kkom3";

    // 1. Get competitors ordered by created_at desc to see the latest 12
    const latestBatch = await client.query(`
      SELECT id, name, platform, profile_link, website_url, tiktok_url, blog_url, google_maps_url, notes, created_at
      FROM ci_competitors
      WHERE account_id = $1
      ORDER BY created_at DESC
      LIMIT 12
    `, [accountId]);

    console.log(`=== LATEST 12 INSERTED CI_COMPETITORS ===`);
    for (const c of latestBatch.rows) {
      console.log(`\nID: ${c.id} | Name: "${c.name}" | CreatedAt: ${c.created_at}`);
      console.log(`  Website: ${c.website_url}`);
      console.log(`  IG Profile: ${c.profile_link}`);
      console.log(`  TikTok: ${c.tiktok_url}`);
      console.log(`  Blog: ${c.blog_url}`);
      console.log(`  Reviews: ${c.google_maps_url}`);

      // Count posts
      const p = await client.query("SELECT count(*) as count FROM ci_competitor_posts WHERE competitor_id = $1", [c.id]);
      // Count web snapshots
      const w = await client.query("SELECT count(*) as count FROM competitor_website_snapshots WHERE competitor_id = $1", [c.id]);
      console.log(`  Evidence in DB -> Posts: ${p.rows[0].count} | WebSnapshots: ${w.rows[0].count}`);

      if (c.notes) {
        try {
          const m = JSON.parse(c.notes);
          console.log(`  Manifest Total Verified: ${m.totalVerifiedSources}`);
          for (const [srcKey, srcVal] of Object.entries(m.sources || {})) {
            const sv: any = srcVal;
            console.log(`    [${srcKey}]: status=${sv.status}, url=${sv.url}, method=${sv.verificationMethod}`);
          }
        } catch {}
      }
    }

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
