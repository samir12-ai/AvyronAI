import "dotenv/config";
import { evaluateAndPersistBusinessExecutionState } from "../server/performance-loop/execution-intelligence";
import { translatePerformanceToBll } from "../server/performance-loop/bll";

async function main() {
  const campaignId = "campaign_1773576062201_6t0oxi";
  const correctAccountId = "a2d87878-a1e9-41ea-a8a5-90beff569673";

  console.log("=== EVALUATING WITH CORRECT ACCOUNT ID:", correctAccountId, "===");
  const result = await evaluateAndPersistBusinessExecutionState({ accountId: correctAccountId, campaignId });
  const p = translatePerformanceToBll(result.executionState, result.performanceContext, result.clarificationRequest);

  console.log("ExecutionState ID:", result.executionState.id);
  console.log("Mode:", result.executionState.mode);
  console.log("Primary Bottleneck:", result.executionState.primaryBottleneck);
  console.log("Confidence:", result.executionState.confidence);
  console.log("Reason:", result.executionState.reason);
  console.log("Judge Status:", result.judgeVerdict.status);
  console.log("Clarification Question:", result.clarificationRequest?.question || "NONE");
  console.log("BLL Badge Label:", p.stateBadgeLabel);
  console.log("Website Fact:", result.dossier.websiteFact);
  console.log("Instagram Fact:", result.dossier.instagramFact);

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
