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

    // 1. Get unique competitor names/domains from ci_competitors
    const allComps = await client.query(`
      SELECT id, name, platform, profile_link, website_url, tiktok_url, blog_url, google_maps_url, 
             notes, created_at, updated_at, is_active
      FROM ci_competitors
      WHERE account_id = $1
      ORDER BY created_at ASC
    `, [accountId]);

    console.log(`Total ci_competitors rows for account: ${allComps.rows.length}`);

    // Group by unique name or domain
    const uniqueMap = new Map();
    for (const c of allComps.rows) {
      const key = c.name.trim().toLowerCase();
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, []);
      }
      uniqueMap.get(key).push(c);
    }

    console.log(`\nUnique competitor names count: ${uniqueMap.size}`);
    let idx = 1;
    for (const [name, rows] of uniqueMap.entries()) {
      console.log(`\n[${idx++}] Competitor: "${name}" (${rows.length} duplicate rows in DB)`);
      const sample = rows[0];
      console.log(`    Website: ${sample.website_url}`);
      console.log(`    ProfileLink: ${sample.profile_link}`);
      console.log(`    TikTok: ${sample.tiktok_url}`);
      console.log(`    Blog: ${sample.blog_url}`);
      console.log(`    GoogleMaps: ${sample.google_maps_url}`);
      console.log(`    First Created: ${rows[0].created_at} | Last Created: ${rows[rows.length - 1].created_at}`);

      // Count posts for all duplicate IDs of this competitor
      const ids = rows.map((r: any) => `'${r.id}'`).join(",");
      const postRes = await client.query(`SELECT count(*) as count, MIN(timestamp) as min_ts, MAX(timestamp) as max_ts FROM ci_competitor_posts WHERE competitor_id IN (${ids})`);
      const snapRes = await client.query(`SELECT count(*) as count FROM competitor_website_snapshots WHERE competitor_id IN (${ids})`);
      const srcRes = await client.query(`SELECT count(*) as count FROM competitor_sources WHERE competitor_id IN (${ids})`);
      const jobRes = await client.query(`SELECT count(*) as count FROM mi_fetch_jobs WHERE account_id = $1`, [accountId]);
      
      console.log(`    Total Posts across all IDs: ${postRes.rows[0].count} (dates: ${postRes.rows[0].min_ts} -> ${postRes.rows[0].max_ts})`);
      console.log(`    Total Web Snapshots across all IDs: ${snapRes.rows[0].count}`);
      console.log(`    Total competitor_sources rows: ${srcRes.rows[0].count}`);

      // Check notes / manifest in first row
      if (sample.notes) {
        try {
          const m = JSON.parse(sample.notes);
          if (m.sources) {
            console.log(`    Manifest Sources:`, Object.entries(m.sources).map(([k, v]: any) => `${k}: ${v.status} (${v.url || "no-url"})`).join(" | "));
          }
        } catch {
          console.log(`    Notes (raw):`, sample.notes.slice(0, 100));
        }
      }
    }

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
