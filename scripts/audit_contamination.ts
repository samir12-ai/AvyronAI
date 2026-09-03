import "dotenv/config";
import { db } from "../server/db";
import {
  clarificationRequests,
  businessExecutionStates,
  performanceContexts,
  manualCampaignMetrics,
  ownedSourceSnapshots,
} from "@shared/schema";
import { eq, desc, asc } from "drizzle-orm";
import { resolveAccountIdFromCampaign } from "../server/performance-loop/account-resolver";

async function main() {
  const campaignId = "campaign_1773576062201_6t0oxi";
  const accountId = await resolveAccountIdFromCampaign(campaignId);
  console.log("=== CANONICAL ACCOUNT FOR", campaignId, ":", accountId, "===");

  console.log("\n=== PART 1: ALL CLARIFICATION REQUESTS FOR CAMPAIGN ===");
  const reqs = await db
    .select()
    .from(clarificationRequests)
    .where(eq(clarificationRequests.campaignId, campaignId))
    .orderBy(asc(clarificationRequests.createdAt));

  console.log("Total clarificationRequests count:", reqs.length);
  reqs.forEach((r, idx) => {
    console.log(`[#${idx + 1}]`, {
      id: r.id,
      accountId: r.accountId,
      missingFactType: r.missingFactType,
      question: r.question,
      status: r.status,
      userAnswer: r.userAnswer,
      answeredAt: r.answeredAt,
      createdAt: r.createdAt,
    });
  });

  console.log("\n=== PART 2: ALL MANUAL CAMPAIGN METRICS FOR CAMPAIGN ===");
  const metrics = await db
    .select()
    .from(manualCampaignMetrics)
    .where(eq(manualCampaignMetrics.campaignId, campaignId))
    .orderBy(asc(manualCampaignMetrics.createdAt));

  console.log("Total manualCampaignMetrics count:", metrics.length);
  metrics.forEach((m, idx) => {
    console.log(`[#${idx + 1}]`, {
      id: m.id,
      accountId: m.accountId,
      spend: m.spend,
      revenue: m.revenue,
      leads: m.leads,
      conversions: m.conversions,
      createdAt: m.createdAt,
    });
  });

  console.log("\n=== PART 3: ALL BUSINESS EXECUTION STATES FOR CAMPAIGN ===");
  const states = await db
    .select()
    .from(businessExecutionStates)
    .where(eq(businessExecutionStates.campaignId, campaignId))
    .orderBy(asc(businessExecutionStates.createdAt));

  console.log("Total businessExecutionStates count:", states.length);
  states.forEach((s, idx) => {
    console.log(`[#${idx + 1}]`, {
      id: s.id,
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
