import "dotenv/config";
import { evaluateAndPersistBusinessExecutionState } from "../server/performance-loop/execution-intelligence";
import { translatePerformanceToBll } from "../server/performance-loop/bll";
import { db } from "../server/db";
import { businessDataLayer } from "@shared/schema";
import { eq } from "drizzle-orm";

async function main() {
  const campaignId = "campaign_1773576062201_6t0oxi";
  
  // Resolve actual accountId from DB lineage
  const [bizData] = await db
    .select({ accountId: businessDataLayer.accountId })
    .from(businessDataLayer)
    .where(eq(businessDataLayer.campaignId, campaignId))
    .limit(1);

  const accountId = bizData?.accountId || "a2d87878-a1e9-41ea-a8a5-90beff569673";

  const result = await evaluateAndPersistBusinessExecutionState({ accountId, campaignId });
  const p = translatePerformanceToBll(result.executionState, result.performanceContext, result.clarificationRequest);

  console.log("==================================================");
  console.log("REAL CAMPAIGN EVALUATION RESULT:");
  console.log("ExecutionState ID:", result.executionState.id);
  console.log("Mode:", result.executionState.mode);
  console.log("Primary Bottleneck:", result.executionState.primaryBottleneck);
  console.log("Confidence:", result.executionState.confidence);
  console.log("Reason:", result.executionState.reason);
  console.log("Judge Verdict Status:", result.judgeVerdict.status);
  console.log("Clarification Question:", result.clarificationRequest?.question || "NONE REQUIRED");
  console.log("BLL State Badge Label:", p.stateBadgeLabel);
  console.log("==================================================");

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
