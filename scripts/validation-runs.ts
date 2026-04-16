import { runOrchestrator } from "../server/orchestrator/index";
import { db } from "../server/db";
import { sql } from "drizzle-orm";

const ACCOUNT_ID = "a2d87878-a1e9-41ea-a8a5-90beff569673";

const CAMPAIGNS = [
  { id: "campaign_1773576062201_6t0oxi", label: "MarketMindAI" },
  { id: "campaign_1772334831096_uzmp6t", label: "SWA Media" },
];

interface ChainEntry { engine: string; snapshotId: string | null; status?: string; }

async function summarizeRun(jobId: string, campaignId: string, label: string) {
  const job = await db.execute(sql`SELECT * FROM orchestrator_jobs WHERE id=${jobId} LIMIT 1`);
  const j: any = job.rows?.[0];
  const sectionStatuses = j?.section_statuses ? JSON.parse(j.section_statuses) : [];
  console.log(`\n=== ${label} (${campaignId}) ===`);
  console.log(`Job: ${jobId} | overall=${j?.status}`);

  // collect per-engine snapshot IDs
  const tables: Array<[string, string, string]> = [
    ["MI", "mi_snapshots", "createdAt"],
    ["Audience", "audience_snapshots", "createdAt"],
    ["Positioning", "positioning_snapshots", "createdAt"],
    ["Differentiation", "differentiation_snapshots", "createdAt"],
    ["Mechanism", "mechanism_snapshots", "createdAt"],
    ["Offer", "offer_snapshots", "createdAt"],
    ["Awareness", "awareness_snapshots", "createdAt"],
    ["Funnel", "funnel_snapshots", "createdAt"],
    ["Persuasion", "persuasion_snapshots", "createdAt"],
    ["Integrity", "integrity_snapshots", "createdAt"],
    ["StatVal", "statistical_validation_snapshots", "createdAt"],
    ["Budget", "budget_governor_snapshots", "createdAt"],
    ["Channel", "channel_selection_snapshots", "createdAt"],
    ["Iteration", "iteration_snapshots", "createdAt"],
    ["Retention", "retention_snapshots", "createdAt"],
  ];

  const chain: ChainEntry[] = [];
  for (const [name, tbl] of tables) {
    try {
      const r: any = await db.execute(sql.raw(
        `SELECT id, status FROM ${tbl} WHERE campaign_id='${campaignId}' ORDER BY created_at DESC LIMIT 1`
      ));
      const row = r.rows?.[0];
      chain.push({ engine: name, snapshotId: row?.id || null, status: row?.status });
    } catch (e: any) {
      chain.push({ engine: name, snapshotId: null, status: `ERR:${e.message?.slice(0, 40)}` });
    }
  }

  console.log("\nSnapshot Chain (latest per engine after run):");
  for (const c of chain) {
    console.log(`  ${c.engine.padEnd(16)} | ${c.status?.padEnd(20) ?? "-".padEnd(20)} | ${c.snapshotId ?? "<none>"}`);
  }

  // awareness consistency check
  try {
    const aud: any = await db.execute(sql.raw(
      `SELECT id, awareness_level FROM audience_snapshots WHERE campaign_id='${campaignId}' ORDER BY created_at DESC LIMIT 1`));
    const aw: any = await db.execute(sql.raw(
      `SELECT id, route_data FROM awareness_snapshots WHERE campaign_id='${campaignId}' ORDER BY created_at DESC LIMIT 1`));
    if (aud.rows?.[0] && aw.rows?.[0]) {
      const audLevel = JSON.parse(aud.rows[0].awareness_level || "{}")?.level;
      const route = JSON.parse(aw.rows[0].route_data || "{}");
      const trs = route?.primaryRoute?.targetReadinessStage || route?.targetReadinessStage;
      console.log(`\nSingle-source awareness check:`);
      console.log(`  audience.awarenessLevel.level   = ${audLevel}`);
      console.log(`  awareness.targetReadinessStage  = ${trs}`);
      console.log(`  MATCH = ${audLevel === trs ? "YES ✓" : "NO ✗"}`);
    }
  } catch (e: any) {
    console.log(`\nAwareness check failed: ${e.message}`);
  }
}

async function main() {
  for (const c of CAMPAIGNS) {
    const jobId = `orch_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    await db.execute(sql`
      INSERT INTO orchestrator_jobs (id, blueprint_id, account_id, campaign_id, status, section_statuses)
      VALUES (${jobId}, 'orchestrator-v2', ${ACCOUNT_ID}, ${c.id}, 'RUNNING', '[]')
    `);
    console.log(`\n>>> Starting ${c.label} | jobId=${jobId}`);
    const t0 = Date.now();
    try {
      const result = await runOrchestrator({
        accountId: ACCOUNT_ID,
        campaignId: c.id,
        forceRefresh: false,
        preassignedJobId: jobId,
      });
      console.log(`<<< ${c.label} done in ${((Date.now() - t0) / 1000).toFixed(1)}s | status=${result.status} | engines=${result.completedEngines.length}`);
      if (result.needsInput) console.log(`    needsInput: ${result.needsInput.engine} — ${result.needsInput.reason}`);
    } catch (e: any) {
      console.error(`<<< ${c.label} FAILED: ${e.message}`);
    }
    await summarizeRun(jobId, c.id, c.label);
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
