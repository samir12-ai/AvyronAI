import "dotenv/config";
import { db } from "../server/db";
import { runAudienceEngine } from "../server/audience-engine/engine";
import { initializeSignalGovernance, resolveSignalsForEngine } from "../server/signal-governance/engine";
import { ENGINE_SIGNAL_REQUIREMENTS } from "../server/signal-governance/types";
import { ciCompetitorComments, ciCompetitorPosts, competitorSources, competitorPostClassifications } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

async function main() {
  const accountId = "f020f6c7-15d8-4129-90a6-83a40558c642";
  const campaignId = "camp_mtewrp8kkom3";

  // Check counts
  const [src] = await db.select({ c: sql<number>`count(*)` }).from(competitorSources).where(eq(competitorSources.accountId, accountId));
  const [posts] = await db.select({ c: sql<number>`count(*)` }).from(ciCompetitorPosts).where(eq(ciCompetitorPosts.accountId, accountId));
  const [comms] = await db.select({ c: sql<number>`count(*)` }).from(ciCompetitorComments).where(eq(ciCompetitorComments.accountId, accountId));
  const [classifs] = await db.select({ c: sql<number>`count(*)` }).from(competitorPostClassifications);

  console.log("=== SARA-FT REAL EVIDENCE STATUS IN DB ===");
  console.log(`  competitor_sources: ${src.c}`);
  console.log(`  ci_competitor_posts: ${posts.c}`);
  console.log(`  ci_competitor_comments: ${comms.c}`);
  console.log(`  competitor_post_classifications: ${classifs.c}`);

  console.log("\n=== RUNNING AUDIENCE ENGINE ON REAL EVIDENCE ===");
  const audRes = await runAudienceEngine(accountId, campaignId);

  console.log("\nAudience Engine Status:", audRes.status);
  console.log("Pains Count:", audRes.audiencePains?.length || 0);
  console.log("Desire Map Count:", audRes.desireMap?.length || 0);
  console.log("Objection Map Count:", audRes.objectionMap?.length || 0);
  console.log("Audience Segments Count:", audRes.audienceSegments?.length || 0);
  console.log("\nAudience Pains Details:", audRes.audiencePains);
  console.log("Desire Map Details:", audRes.desireMap);
  console.log("Objection Map Details:", audRes.objectionMap);
  console.log("Structured Signals:", JSON.stringify(audRes.structuredSignals, null, 2));

  console.log("\n=== EVALUATING SIGNAL GOVERNANCE LAYER (SGL) ===");
  const rawObjections = audRes.objectionMap || [];
  const mappedObjections = rawObjections.map((o: any) => ({
    label: o.label ?? o.canonical ?? o.pain ?? o.signal ?? "",
    confidence: o.confidence ?? o.confidenceScore ?? 0.5,
    evidence: Array.isArray(o.evidence) ? o.evidence : [],
  }));

  const sglState = initializeSignalGovernance(
    audRes.structuredSignals || { pain_clusters: [], desire_clusters: [], pattern_clusters: [], root_causes: [], psychological_drivers: [] },
    mappedObjections,
  );

  console.log("SGL Governed Signals Count:", sglState.governedSignals.length);
  console.log("SGL Governed Signals:", sglState.governedSignals.map(s => ({ id: s.signalId, cat: s.category, text: s.text, conf: s.confidence })));
  console.log("\nSGL Coverage Report:", sglState.coverageReport);

  console.log("\n=== STRATEGY ENGINES GATE CHECK ===");
  const engines = ["differentiation", "positioning", "mechanism", "offer", "awareness", "funnel", "persuasion"] as const;
  for (const eng of engines) {
    const res = resolveSignalsForEngine(sglState, eng as any);
    console.log(`Engine [${eng}]:`);
    console.log(`  Required Categories: [${ENGINE_SIGNAL_REQUIREMENTS[eng].join(", ")}]`);
    console.log(`  Blocked: ${res.blocked}`);
    console.log(`  Insufficient Categories: [${res.insufficientCategories.join(", ")}]`);
    console.log(`  Clean Signals Count: ${res.signals.length}`);
  }
}

main().catch(console.error);
