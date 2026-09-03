import "dotenv/config";
import { db } from "../server/db";
import { strategicPlans } from "@shared/schema";
import { eq } from "drizzle-orm";

async function main() {
  const planId = "plan_canonical_1787565713913";
  const [p] = await db.select().from(strategicPlans).where(eq(strategicPlans.id, planId));
  const plan = JSON.parse(p.planJson);

  console.log("==================================================");
  console.log("FINAL CANONICAL PLAN FULL AUDIT & VERIFICATION");
  console.log("==================================================");
  console.log("Plan ID:", p.id);
  console.log("Status:", p.status);
  console.log("Campaign ID:", p.campaignId);
  console.log("Job ID:", p.jobId);
  console.log("Approved Lanes Count:", plan.approvedLanes?.length);
  console.log("Buyer Conversion Journeys Count:", plan.buyerConversionJourneys?.length);
  
  const journey = plan.buyerConversionJourneys?.[0];
  console.log("\n--- BUYER CONVERSION JOURNEY (LANE 1) ---");
  console.log("Lane ID:", journey?.laneId);
  console.log("Lane Label:", journey?.laneLabel);
  console.log("Journey Name:", journey?.journeyName);
  console.log("Journey Type:", journey?.journeyType);
  console.log("Stages Count:", journey?.stages?.length);
  journey?.stages?.forEach((s: any, idx: number) => {
    console.log(`\n  Stage ${idx + 1}: ${s.stageName}`);
    console.log(`    Goal: ${s.goal}`);
    console.log(`    Buyer State: ${s.buyerState}`);
    console.log(`    Core Message: ${s.coreMessage}`);
    console.log(`    Action: ${s.contentAction}`);
    console.log(`    Proofs (${s.proof?.length}):`, JSON.stringify(s.proof));
    console.log(`    CTA: ${s.cta}`);
  });

  console.log("\n--- PERSUASION STRATEGY ---");
  console.log("Mode:", journey?.persuasionStrategy?.mode);
  console.log("Belief Shift [From]:", journey?.persuasionStrategy?.coreBeliefTransformation?.currentBelief);
  console.log("Belief Shift [To]:", journey?.persuasionStrategy?.coreBeliefTransformation?.desiredBelief);
  console.log("Objections Count:", journey?.persuasionStrategy?.objections?.length);
  journey?.persuasionStrategy?.objections?.forEach((o: any, idx: number) => {
    console.log(`  ${idx + 1}. [${o.objectionId}] "${o.objection}"`);
    console.log(`     Response: "${o.response}"`);
    console.log(`     Required Proof: "${o.requiredProof}"`);
  });
  console.log("Trust Strategy:", JSON.stringify(journey?.persuasionStrategy?.trustStrategy, null, 2));

  console.log("\n--- CONTENT PILLARS ---");
  plan.contentDistribution?.contentPillars?.forEach((cp: any) => {
    console.log(`- ${cp.pillar} (${cp.percentage})`);
    console.log(`  Examples:`, cp.examples);
  });

  console.log("\n--- CREATIVE TESTS ---");
  plan.creativeTesting?.tests?.forEach((t: any) => {
    console.log(`- Test: ${t.testName} | Variable: ${t.variable}`);
    console.log(`  Rationale: ${t.rationale}`);
  });

  console.log("\n--- STRATEGIC SUMMARY ---");
  console.log("Strategy:\n", plan.strategicSummary?.strategy);
  console.log("\nTarget Audience:\n", plan.strategicSummary?.targetAudience);
  console.log("\nRationale:\n", plan.strategicSummary?.rationale);

  // Verification checks
  console.log("\n==================================================");
  console.log("CANONICAL VERIFICATION ASSERTIONS");
  console.log("==================================================");
  
  const planJsonStr = JSON.stringify(plan);
  
  // 1. Lane Count
  console.log("1. Lane Invariant:", plan.buyerConversionJourneys?.length === 1 ? "PASS (1 Lane)" : "FAIL");
  console.log("2. Single Journey Lane ID:", journey?.laneId === "lane_3507f25bfd04" ? "PASS (lane_3507f25bfd04)" : "FAIL");
  
  // 2. Test Fixture Leak Check
  const hasEnterpriseFixture = planJsonStr.includes("lane_enterprise");
  const hasMidmarketFixture = planJsonStr.includes("lane_midmarket");
  console.log("3. Test Fixture Isolation (lane_enterprise):", !hasEnterpriseFixture ? "PASS (Zero Leaks)" : "FAIL");
  console.log("4. Test Fixture Isolation (lane_midmarket):", !hasMidmarketFixture ? "PASS (Zero Leaks)" : "FAIL");

  // 3. Ungrounded Claims Check
  const hasUngroundedSOC2 = /SOC-2 Type II Certified(?!.*REQUIRED_FUTURE_PROOF)/i.test(planJsonStr);
  const hasUngrounded42 = /42% Targeting Accuracy Uplift(?!.*REQUIRED_FUTURE_PROOF)/i.test(planJsonStr);
  const hasUngroundedSLA = /Guaranteed 14-Day Production Deployment SLA(?!.*REQUIRED_FUTURE_PROOF)/i.test(planJsonStr);
  console.log("5. Claim Gate (SOC-2):", !hasUngroundedSOC2 ? "PASS (Classified/Sanitized)" : "FAIL");
  console.log("6. Claim Gate (42% Uplift):", !hasUngrounded42 ? "PASS (Classified/Sanitized)" : "FAIL");
  console.log("7. Claim Gate (14-Day SLA):", !hasUngroundedSLA ? "PASS (Classified/Sanitized)" : "FAIL");

  // 4. Billing/Refund as Product Solution Check
  const hasBillingPillars = plan.contentDistribution?.contentPillars?.some((p: any) => /billing|refund/i.test(p.pillar));
  console.log("8. Excluded Pain Enforcement (Content Pillars):", !hasBillingPillars ? "PASS (Zero Billing Pillars)" : "FAIL");
}

main().catch(console.error);
