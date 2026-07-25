import { pool } from "../db";

async function main() {
  try {
    const cols = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'orchestrator_jobs'");
    console.log("ORCH COLUMNS:", cols.rows.map((r: any) => r.column_name).join(", "));

    const r = await pool.query("SELECT DISTINCT account_id, campaign_id FROM orchestrator_jobs ORDER BY campaign_id");
    console.log("\nORCHESTRATOR CAMPAIGNS:");
    for (const row of r.rows) console.log("  campaign=" + row.campaign_id + " | account=" + row.account_id);
  } catch (e: any) {
    console.error("orchestrator_jobs error:", e.message);
  }

  try {
    const r2 = await pool.query("SELECT DISTINCT account_id FROM strategic_blueprints LIMIT 10");
    console.log("\nBLUEPRINT ACCOUNTS:");
    for (const row of r2.rows) console.log("  account=" + row.account_id);
  } catch (e: any) {
    console.error("blueprints error:", e.message);
  }

  try {
    const r3 = await pool.query("SELECT id, account_id, campaign_id, status FROM orchestrator_jobs ORDER BY created_at DESC LIMIT 10");
    console.log("\nRECENT JOBS:");
    for (const row of r3.rows) console.log("  job=" + row.id + " | campaign=" + row.campaign_id + " | account=" + row.account_id + " | status=" + row.status);
  } catch (e: any) {
    console.error("jobs error:", e.message);
  }

  try {
    const r4 = await pool.query("SELECT DISTINCT account_id FROM mi_snapshots LIMIT 10");
    console.log("\nMI SNAPSHOT ACCOUNTS:");
    for (const row of r4.rows) console.log("  account=" + row.account_id);
  } catch (e: any) {
    console.error("mi error:", e.message);
  }

  try {
    const r5 = await pool.query("SELECT id, account_id FROM brand_config LIMIT 10");
    console.log("\nBRAND CONFIGS:");
    for (const row of r5.rows) console.log("  id=" + row.id + " | account=" + row.account_id);
  } catch (e: any) {
    console.error("brand error:", e.message);
  }

  await pool.end();
  process.exit(0);
}
main();
