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

    console.log("=== MI_FETCH_JOBS ===");
    const jobs = await client.query(`
      SELECT id, campaign_id, competitor_hash, status, stage_statuses, fetch_limit_reasons, 
             total_posts_fetched, total_comments_fetched, competitor_count, error, 
             collection_mode, data_status, created_at, completed_at
      FROM mi_fetch_jobs
      WHERE account_id = $1
      ORDER BY created_at ASC
    `, [accountId]);

    console.log(`Total mi_fetch_jobs: ${jobs.rows.length}`);
    jobs.rows.forEach((j, idx) => {
      console.log(`[${idx + 1}] ID: ${j.id} | Status: ${j.status} | Mode: ${j.collection_mode} | Posts: ${j.total_posts_fetched} | Comments: ${j.total_comments_fetched}`);
      console.log(`     Created: ${j.created_at} | Completed: ${j.completed_at}`);
      console.log(`     Error: ${j.error}`);
      console.log(`     StageStatuses: ${j.stage_statuses}`);
    });

    console.log("\n=== MI_REFRESH_SCHEDULE SUMMARY ===");
    const sched = await client.query(`
      SELECT status, refresh_reason, count(*) as count, MIN(created_at) as min_created, MAX(created_at) as max_created,
             MIN(last_refresh_at) as min_last_refresh, MAX(last_refresh_at) as max_last_refresh
      FROM mi_refresh_schedule
      WHERE account_id = $1
      GROUP BY status, refresh_reason
    `, [accountId]);
    console.log(sched.rows);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
