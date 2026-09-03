import "dotenv/config";
import { db } from "../server/db";
import { performanceContexts, businessExecutionStates } from "@shared/schema";
import { eq, desc } from "drizzle-orm";

async function main() {
  const campaignId = "campaign_1773576062201_6t0oxi";
  const accountId = "a2d87878-a1e9-41ea-a8a5-90beff569673";

  console.log("=== PERFORMANCE CONTEXT AUDIT ===");
  const states = await db.select().from(businessExecutionStates).where(eq(businessExecutionStates.campaignId, campaignId)).orderBy(desc(businessExecutionStates.createdAt));
  console.log("businessExecutionStates count:", states.length);
  for (const s of states.slice(0, 3)) {
    console.log(`  State ID: ${s.id} | mode: ${s.mode} | confidence: ${s.confidence} | dataSufficiency: ${s.dataSufficiency} | baselineQuality: ${s.baselineQuality} | createdAt: ${s.createdAt}`);
  }

  const contexts = await db.select().from(performanceContexts).where(eq(performanceContexts.campaignId, campaignId)).orderBy(desc(performanceContexts.createdAt));
  console.log("performanceContexts count:", contexts.length);
  for (const c of contexts.slice(0, 3)) {
    console.log(`  Context ID: ${c.id} | stateId: ${c.businessExecutionStateId} | mode: ${c.mode} | bottleneck: ${c.primaryBottleneck} | confidence: ${c.confidence} | createdAt: ${c.createdAt}`);
  }

  process.exit(0);
}

main().catch(console.error);
