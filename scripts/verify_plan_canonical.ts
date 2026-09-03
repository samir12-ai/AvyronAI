import "dotenv/config";
import { db } from "../server/db";
import { strategicPlans } from "@shared/schema";
import { eq } from "drizzle-orm";

async function main() {
  const planId = "plan_canonical_1787563688292";
  const [p] = await db.select().from(strategicPlans).where(eq(strategicPlans.id, planId));
  if (!p) throw new Error("Plan not found: " + planId);

  const plan = JSON.parse(p.planJson);
  console.log("=== PLAN INSPECTION ===");
  console.log("ID:", p.id);
  console.log("Status:", p.status);
  console.log("Campaign ID:", p.campaignId);
  console.log("Approved Lanes:", plan.approvedLanes);
  console.log("Buyer Conversion Journeys Count:", plan.buyerConversionJourneys?.length);
  console.log("Buyer Journey 0:", JSON.stringify(plan.buyerConversionJourneys?.[0], null, 2));
  console.log("Persuasion Strategy:", JSON.stringify(plan.buyerConversionJourney?.persuasionStrategy, null, 2));
  console.log("Content Pillars:", JSON.stringify(plan.contentDistribution?.contentPillars, null, 2));
  console.log("Creative Tests:", JSON.stringify(plan.creativeTesting?.tests, null, 2));
  console.log("Strategic Summary:", JSON.stringify(plan.strategicSummary, null, 2));
  console.log("Brand Spine:", JSON.stringify(plan.brandSpine, null, 2));
}

main().catch(console.error);
