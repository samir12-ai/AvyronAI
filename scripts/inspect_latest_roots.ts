import "dotenv/config";
import { db } from "../server/db";
import { strategyRoots, orchestratorJobs } from "@shared/schema";
import { eq, desc } from "drizzle-orm";

async function main() {
  const campaignId = "campaign_1786718877499_3jk4zv";
  
  const roots = await db
    .select()
    .from(strategyRoots)
    .where(eq(strategyRoots.campaignId, campaignId))
    .orderBy(desc(strategyRoots.createdAt))
    .limit(3);

  console.log("=== Strategy Roots for Campaign ===");
  for (const r of roots) {
    console.log(`\nRoot ID: ${r.id} | Created: ${r.createdAt}`);
    console.log(`Primary Axis: ${r.primaryAxis}`);
    console.log(`Contrast Axis: ${r.contrastAxisText?.slice(0, 120)}...`);
    console.log(`Brand Spine:`, typeof r.brandSpine === "string" ? r.brandSpine.slice(0, 100) : JSON.stringify(r.brandSpine)?.slice(0, 100));
    const lanes = typeof r.approvedLanes === "string" ? JSON.parse(r.approvedLanes) : r.approvedLanes;
    console.log(`Approved Lanes Count:`, lanes?.length);
    if (lanes) {
      lanes.forEach((l: any, i: number) => console.log(`  [${i+1}] ${l.title || l.laneName}`));
    }
  }
}

main().catch(console.error);
