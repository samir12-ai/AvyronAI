import 'dotenv/config';
import { db } from "../db";
import { positioningSnapshots, audienceSnapshots } from "@shared/schema";
import { eq, desc } from "drizzle-orm";

async function run() {
  const campaignId = "campaign_1773576062201_6t0oxi";

  console.log("=== LATEST POSITIONING SNAPSHOT ===");
  const [posSnap] = await db.select().from(positioningSnapshots)
    .where(eq(positioningSnapshots.campaignId, campaignId))
    .orderBy(desc(positioningSnapshots.createdAt))
    .limit(1);

  if (posSnap) {
    console.log("Positioning Snapshot ID:", posSnap.id);
    console.log("Created At:", posSnap.createdAt);
    const registry = typeof posSnap.painRegistry === "string" ? JSON.parse(posSnap.painRegistry) : posSnap.painRegistry;
    console.log("\nPain Registry Items Count:", registry?.length || 0);
    if (registry && Array.isArray(registry)) {
      registry.forEach((p: any, idx: number) => {
        console.log(`\n--- PAIN ${idx + 1} ---`);
        console.log(`painId: ${p.painId || p.id}`);
        console.log(`canonicalPain: ${p.canonicalPain || p.canonical || p.painText || p.text}`);
        console.log(`coverageDecision: ${p.coverageDecision || p.targetCoverageDecision}`);
        console.log(`fitType: ${p.fitType || p.productFit}`);
        console.log(`enteredMateriality: ${p.enteredMateriality !== undefined ? p.enteredMateriality : (p.coverageDecision !== 'NOT_COVERED' && p.fitType === 'DIRECT_FIT')}`);
        console.log(`MaterialityVerdict: ${p.materialityVerdict || p.materialityClassification || p.materialityDecision || p.coreClassification || 'N/A'}`);
        console.log(`finalClassification: ${p.finalClassification || p.classification || p.role || 'N/A'}`);
        console.log(`full JSON:`, JSON.stringify(p));
      });
    }
  } else {
    console.log("No positioning snapshot found!");
  }

  console.log("\n=== LATEST AUDIENCE SNAPSHOT ===");
  const [audSnap] = await db.select().from(audienceSnapshots)
    .where(eq(audienceSnapshots.campaignId, campaignId))
    .orderBy(desc(audienceSnapshots.createdAt))
    .limit(1);

  if (audSnap) {
    console.log("Audience Snapshot ID:", audSnap.id);
    console.log("Target Coverage:", audSnap.targetCoverage ? JSON.parse(typeof audSnap.targetCoverage === 'string' ? audSnap.targetCoverage : JSON.stringify(audSnap.targetCoverage)) : "N/A");
  }

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
