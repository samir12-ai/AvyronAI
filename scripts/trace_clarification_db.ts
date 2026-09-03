import "dotenv/config";
import { db } from "../server/db";
import {
  clarificationRequests,
  businessExecutionStates,
  performanceContexts,
  pipelineUserTruth,
  manualCampaignMetrics,
  ownedSourceSnapshots,
} from "@shared/schema";
import { desc, eq } from "drizzle-orm";

async function main() {
  console.log("=== ALL CLARIFICATION REQUESTS IN DB ===");
  const allReqs = await db.select().from(clarificationRequests).orderBy(desc(clarificationRequests.createdAt));
  console.log("Total clarificationRequests count:", allReqs.length);
  allReqs.forEach((r) => {
    console.log({
      id: r.id,
      campaignId: r.campaignId,
      accountId: r.accountId,
      missingFactType: r.missingFactType,
      question: r.question,
      status: r.status,
      userAnswer: r.userAnswer,
      answeredAt: r.answeredAt,
      createdAt: r.createdAt,
    });
  });

  console.log("\n=== ALL BUSINESS EXECUTION STATES IN DB ===");
  const allStates = await db.select().from(businessExecutionStates).orderBy(desc(businessExecutionStates.createdAt)).limit(10);
  console.log("Total businessExecutionStates count:", allStates.length);
  allStates.forEach((s) => {
    console.log({
      id: s.id,
      campaignId: s.campaignId,
      accountId: s.accountId,
      mode: s.mode,
      primaryBottleneck: s.primaryBottleneck,
      confidence: s.confidence,
      reason: s.reason,
      createdAt: s.createdAt,
    });
  });

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
