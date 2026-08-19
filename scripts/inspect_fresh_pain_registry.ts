import "dotenv/config";
import { db } from "../server/db";
import { audiencePainRegistry, strategicLanes } from "../shared/schema";
import { eq, desc } from "drizzle-orm";

async function main() {
  const campaignId = "campaign_1773576062201_6t0oxi";

  console.log("=== INSPECTING FRESH AUDIENCE PAIN REGISTRY ===");
  const pains = await db
    .select()
    .from(audiencePainRegistry)
    .where(eq(audiencePainRegistry.campaignId, campaignId))
    .orderBy(desc(audiencePainRegistry.createdAt));

  console.log(`Total Pains in Registry: ${pains.length}`);
  pains.forEach((p, i) => {
    console.log(`\n[#${i + 1}] ID: ${p.id} | Pain: "${p.pain}"`);
    console.log(` - Canonical: ${p.canonicalPain}`);
    console.log(` - Source Role: ${p.sourceRole} | Assigned Role: ${p.assignedRole}`);
    console.log(` - Role Alignment: ${p.roleAlignmentScore} | Frequency: ${p.frequency}`);
    console.log(` - Product Fit: ${p.productFitEligibility} | Reason: ${p.ineligibilityReason}`);
    console.log(` - Evidence: ${JSON.stringify(p.rawEvidence?.slice(0, 2))}`);
    console.log(` - CreatedAt: ${p.createdAt}`);
  });

  console.log("\n=== INSPECTING STRATEGIC LANES ===");
  const lanes = await db
    .select()
    .from(strategicLanes)
    .where(eq(strategicLanes.campaignId, campaignId))
    .orderBy(desc(strategicLanes.createdAt));

  console.log(`Total Lanes: ${lanes.length}`);
  lanes.forEach((l, i) => {
    console.log(`\n[Lane #${i + 1}] ID: ${l.id} | Title: "${l.title}"`);
    console.log(` - Role: ${l.buyerRole}`);
    console.log(` - Pains: ${JSON.stringify(l.pains)}`);
    console.log(` - Objections: ${JSON.stringify(l.objections)}`);
    console.log(` - CreatedAt: ${l.createdAt}`);
  });

  process.exit(0);
}

main().catch(console.error);
