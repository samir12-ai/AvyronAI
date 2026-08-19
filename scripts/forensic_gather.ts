import "dotenv/config";
import { db } from "../server/db";
import { strategicPlans, orchestratorJobs, strategyRoots, engineSnapshots, marketIntelligence, productAnchors } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import * as fs from "fs";

async function gatherTrace() {
  const campaignId = "campaign_1786718877499_3jk4zv";
  const trace: any = {};

  const [activePlan] = await db
    .select()
    .from(strategicPlans)
    .where(eq(strategicPlans.campaignId, campaignId))
    .orderBy(desc(strategicPlans.version))
    .limit(1);

  trace.activePlan = activePlan;

  const [job] = await db
    .select()
    .from(orchestratorJobs)
    .where(eq(orchestratorJobs.id, "orch_1786957670170_4ivuno"))
    .limit(1);

  trace.job = job;

  const [root] = await db
    .select()
    .from(strategyRoots)
    .where(eq(strategyRoots.id, "8b3878cb-2de3-4588-8b02-cc941e713d8e"))
    .limit(1);
    
  trace.root = root;

  const snaps = await db
    .select()
    .from(engineSnapshots)
    .where(eq(engineSnapshots.campaignId, campaignId))
    .orderBy(desc(engineSnapshots.createdAt))
    .limit(30);
    
  trace.snapshots = snaps.map(s => ({
    id: s.id,
    engineName: s.engineName,
    status: s.status,
    createdAt: s.createdAt,
    hash: s.inputHash,
    payload: typeof s.payload === 'string' ? JSON.parse(s.payload) : s.payload
  }));

  const [anchor] = await db
    .select()
    .from(productAnchors)
    .where(eq(productAnchors.id, "anchor_sfi"))
    .limit(1);
  trace.productAnchor = anchor;

  const [mi3] = await db
    .select()
    .from(marketIntelligence)
    .where(eq(marketIntelligence.campaignId, campaignId))
    .orderBy(desc(marketIntelligence.createdAt))
    .limit(1);
  trace.marketIntelligence = mi3;

  fs.writeFileSync("C:/Users/mahmo/.gemini/antigravity/brain/f336cf20-23bb-4ecf-ad9a-7bee22987109/scratch/full_trace.json", JSON.stringify(trace, null, 2));
  console.log("Trace extracted to scratch/full_trace.json");
}

gatherTrace().catch(console.error);
