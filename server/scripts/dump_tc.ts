import { db } from "../db";
import { audienceSnapshots } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { attachTargetCoverageToPainRegistry } from "../shared/audience-pain-registry";
import { refineAudiencePainRegistry } from "../shared/pain-classifier";

async function run() {
  const accountId = "a2d87878-a1e9-41ea-a8a5-90beff569673";
  const campaignId = "campaign_1773576062201_6t0oxi";

  const [snap] = await db.select().from(audienceSnapshots)
    .where(eq(audienceSnapshots.campaignId, campaignId))
    .orderBy(desc(audienceSnapshots.createdAt))
    .limit(1);

  if (!snap) return console.log("No snapshot found");

  const tc = typeof snap.targetCoverage === "string" ? JSON.parse(snap.targetCoverage) : snap.targetCoverage;
  const segments = typeof snap.audienceSegments === "string" ? JSON.parse(snap.audienceSegments) : snap.audienceSegments;
  const pains = typeof snap.audiencePains === "string" ? JSON.parse(snap.audiencePains) : snap.audiencePains;

  console.log("1. NORMALIZED BUSINESS TARGETS");
  console.log(JSON.stringify(tc.targetRoles.map(t => ({ id: t.targetId, role: t.roleName })), null, 2));
  
  console.log("\n2. CANONICAL AUDIENCE SEGMENTS");
  console.log(JSON.stringify(segments.map(s => ({ id: s.id, name: s.name, role: s.role })), null, 2));

  console.log("\n3. COVERAGE DECISION (TARGET X SEGMENT)");
  console.log(JSON.stringify((tc.matches || []).map(m => ({
    target: m.roleName,
    segment: m.matchedSegmentNames,
    decision: m.coverageDecision,
    reason: m.reason
  })), null, 2));

  // Run the pain attachment logic
  const attached = attachTargetCoverageToPainRegistry(pains, tc, segments);

  console.log("\n4 & 5. INHERITED TARGET COVERAGE PER PAIN & SEGMENT");
  attached.forEach(p => {
    console.log(`Pain: ${String(p.originalStatement || p.canonical || p.painId).slice(0, 50)}... | Segment: ${p.segmentName} | Covered: ${p.targetCovered}`);
  });

  // Run the product fit / eligibility logic
  const refined = pains;
  
  const corePains = refined.filter(p => p.classification === "CORE" || p.classification === "CORE_PURCHASE");
  const directFit = refined.filter(p => p.productFit === "DIRECT_FIT" || p.productFit === "ELIGIBLE");

  console.log("\n6. FINAL DIRECT_FIT PAINS");
  console.log(JSON.stringify(directFit.map(p => p.originalStatement), null, 2));

  console.log("\n7. FINAL CORE PAINS");
  console.log(JSON.stringify(corePains.map(p => p.originalStatement), null, 2));

  process.exit(0);
}
run();
