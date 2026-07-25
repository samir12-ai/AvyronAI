import { runOrchestrator } from "../server/orchestrator/index";
import { db } from "../server/db";
import { sql } from "drizzle-orm";

const ACCOUNT_ID = "a2d87878-a1e9-41ea-a8a5-90beff569673";
const CAMPAIGN_ID = "campaign_1772334831096_uzmp6t";

async function main() {
  const jobId = `orch_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  await db.execute(sql`
    INSERT INTO orchestrator_jobs (id, blueprint_id, account_id, campaign_id, status, section_statuses)
    VALUES (${jobId}, 'orchestrator-v2', ${ACCOUNT_ID}, ${CAMPAIGN_ID}, 'RUNNING', '[]')
  `);
  console.log(`>>> SWA run | jobId=${jobId}`);
  const t0 = Date.now();
  try {
    const result = await runOrchestrator({
      accountId: ACCOUNT_ID,
      campaignId: CAMPAIGN_ID,
      forceRefresh: false,
      preassignedJobId: jobId,
    });
    console.log(`<<< SWA done in ${((Date.now() - t0) / 1000).toFixed(1)}s | status=${result.status} | engines=${result.completedEngines.length}`);
    console.log(`completed=${JSON.stringify(result.completedEngines)}`);
    console.log(`failed=${JSON.stringify(result.failedEngines || [])}`);
    if (result.needsInput) console.log(`needsInput: ${result.needsInput.engine} — ${result.needsInput.reason}`);
  } catch (e: any) {
    console.error(`<<< SWA FAILED: ${e.message}\n${e.stack}`);
  }

  // Inspect audience objection map
  const aud: any = await db.execute(sql.raw(
    `SELECT id, objection_map FROM audience_snapshots WHERE campaign_id='${CAMPAIGN_ID}' ORDER BY created_at DESC LIMIT 1`));
  const row = aud.rows?.[0];
  if (row) {
    const objs = JSON.parse(row.objection_map || "[]");
    console.log(`\nAudience snapshot ${row.id}: ${objs.length} objections`);
    for (const o of objs.slice(0, 10)) {
      console.log(`  - "${o.canonical}" conf=${o.confidenceScore?.toFixed(3)} ev=${o.evidenceCount} freq=${o.frequency} src=[${(o.sourceSignals || []).slice(0, 3).join(",")}]`);
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
