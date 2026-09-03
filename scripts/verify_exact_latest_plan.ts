import "dotenv/config";
import { db } from "../server/db";
import { strategicPlans } from "@shared/schema";
import { eq } from "drizzle-orm";

async function main() {
  const planId = "plan_canonical_1787563986548";
  const [p] = await db.select().from(strategicPlans).where(eq(strategicPlans.id, planId));
  if (!p) throw new Error("Plan not found: " + planId);

  const plan = JSON.parse(p.planJson);
  console.log("=== PLAN VERIFICATION REPORT ===");
  console.log("ID:", p.id);
  console.log("Status:", p.status);
  console.log("Campaign ID:", p.campaignId);
  console.log("Job ID:", p.jobId);
  console.log("CreatedAt:", p.createdAt);
  console.log("\n--- APPROVED LANES ---");
  console.log(JSON.stringify(plan.approvedLanes, null, 2));
  console.log("\n--- BUYER CONVERSION JOURNEYS (" + plan.buyerConversionJourneys?.length + ") ---");
  console.log(JSON.stringify(plan.buyerConversionJourneys, null, 2));
  console.log("\n--- CONTENT PILLARS ---");
  console.log(JSON.stringify(plan.contentDistribution?.contentPillars, null, 2));
  console.log("\n--- CREATIVE TESTS ---");
  console.log(JSON.stringify(plan.creativeTesting?.tests, null, 2));
  console.log("\n--- STRATEGIC SUMMARY ---");
  console.log("Strategy:", plan.strategicSummary?.strategy);
  console.log("\nTarget Audience:", plan.strategicSummary?.targetAudience);
  console.log("\nRationale:", plan.strategicSummary?.rationale);
  console.log("\n--- BRAND SPINE ---");
  console.log(JSON.stringify(plan.brandSpine, null, 2));
}

main().catch(console.error);
