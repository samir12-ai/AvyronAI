import "dotenv/config";
import { Pool } from "pg";

const connStr = process.env.DATABASE_URL!;
const pool = new Pool({ connectionString: connStr, ssl: { rejectUnauthorized: false } });

const CAMPAIGN = "campaign_1773576062201_6t0oxi";
const JOB_ID = "orch_1787659544899_kjkup2";
const PLAN_ID = "9ba567fd-0ae1-4d69-91b1-0ab561ac5960";

async function main() {
  const client = await pool.connect();
  try {
    // 1. Orchestrator job details
    console.log("=== ORCHESTRATOR JOB ===");
    const job = await client.query(
      "SELECT id, campaign_id, account_id, status, plan_id, created_at, completed_at FROM orchestrator_jobs WHERE id=$1",
      [JOB_ID]
    );
    console.log(JSON.stringify(job.rows[0], null, 2));
    const jobCreatedAt = job.rows[0]?.created_at;

    // 2. Section statuses
    console.log("\n=== SECTION STATUSES ===");
    const sections = await client.query(
      "SELECT section_statuses FROM orchestrator_jobs WHERE id=$1",
      [JOB_ID]
    );
    const ss = sections.rows[0]?.section_statuses;
    if (ss) {
      const parsed = typeof ss === "string" ? JSON.parse(ss) : ss;
      for (const s of parsed) {
        console.log(`  ${s.id}: status=${s.status} snapshotId=${s.snapshotId || "N/A"} reused=${s.reused || false}`);
      }
    }

    // 3. Lineage for key snapshot tables
    const snapshotTables = [
      "mi_snapshots", "audience_snapshots", "differentiation_snapshots",
      "mechanism_snapshots", "offer_snapshots", "awareness_snapshots",
      "funnel_snapshots", "persuasion_snapshots", "integrity_snapshots",
      "budget_governor_snapshots", "channel_selection_snapshots",
      "ael_snapshots", "cel_reports",
    ];

    console.log("\n=== ENGINE ARTIFACT LINEAGE ===");
    for (const table of snapshotTables) {
      try {
        const cols = await client.query(
          "SELECT column_name FROM information_schema.columns WHERE table_name=$1 AND table_schema='public'",
          [table]
        );
        const colNames = cols.rows.map((c: any) => c.column_name);
        const hasJobId = colNames.includes("job_id");
        const hasInputHash = colNames.includes("input_hash");

        const jobCol = hasJobId ? "job_id" : "NULL as job_id";
        const hashCol = hasInputHash ? "input_hash" : "NULL as input_hash";

        const result = await client.query(
          `SELECT id, created_at, ${jobCol}, ${hashCol} FROM ${table} WHERE campaign_id=$1 ORDER BY created_at DESC LIMIT 3`,
          [CAMPAIGN]
        );
        console.log(`\n${table}:`);
        for (const row of result.rows) {
          const isFreshRun = row.job_id === JOB_ID;
          const createdDuringRun = jobCreatedAt && new Date(row.created_at) >= new Date(jobCreatedAt);
          console.log(`  ID=${row.id} | Created=${row.created_at} | JobRef=${row.job_id || 'N/A'} | FreshRun=${isFreshRun} | DuringRun=${createdDuringRun} | Hash=${row.input_hash ? row.input_hash.substring(0, 16) + '...' : 'N/A'}`);
        }
      } catch (err: any) {
        console.log(`\n${table}: ERROR - ${err.message.substring(0, 100)}`);
      }
    }

    // 4. Strategy Root
    console.log("\n=== STRATEGY ROOT ===");
    try {
      const rootTables = await client.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name LIKE '%strategy_root%' OR table_name LIKE '%root_bundle%')"
      );
      console.log("Root tables:", rootTables.rows.map((r: any) => r.table_name));
    } catch {}

    // 5. Plan JSON contamination search
    console.log("\n=== PLAN JSON CONTAMINATION ===");
    const planRow = await client.query("SELECT plan_json FROM strategic_plans WHERE id=$1", [PLAN_ID]);
    if (planRow.rows[0]) {
      const planStr = planRow.rows[0].plan_json;
      const terms = ["billing", "refund", "Frustrated SaaS", "unauthorized", "opaque pricing", "scam", "customer service", "recurring charges", "proven process", "proven outcomes", "30 qualified", "VALIDATED"];
      for (const term of terms) {
        const regex = new RegExp(term, "gi");
        const matches = planStr.match(regex);
        if (matches) {
          const idx = planStr.toLowerCase().indexOf(term.toLowerCase());
          const context = planStr.substring(Math.max(0, idx - 60), idx + term.length + 60);
          console.log(`  "${term}": ${matches.length} hits | ctx: ...${context.replace(/\n/g, " ")}...`);
        }
      }
    }

    // 6. Brand config / Product Truth
    console.log("\n=== BRAND CONFIG ===");
    try {
      const brand = await client.query("SELECT * FROM brand_config WHERE campaign_id=$1 ORDER BY created_at DESC LIMIT 1", [CAMPAIGN]);
      if (brand.rows[0]) {
        const bc = brand.rows[0];
        for (const key of Object.keys(bc)) {
          const val = String(bc[key] || "");
          if (val.length > 5 && val.length < 5000) {
            console.log(`  ${key}: ${val.substring(0, 300)}`);
          }
        }
      } else {
        console.log("  No brand_config found");
      }
    } catch (err: any) {
      console.log("  brand_config error:", err.message.substring(0, 100));
    }

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => { console.error(err.message); process.exit(1); });
