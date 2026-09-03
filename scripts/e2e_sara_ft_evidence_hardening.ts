import "dotenv/config";
import { db } from "../server/db";
import { buildCampaignEvidenceBundle } from "../server/competitive-intelligence/evidence-bundle";
import { runAudienceEngine } from "../server/audience-engine/engine";
import { initializeSignalGovernance, resolveSignalsForEngine } from "../server/signal-governance/engine";
import { ENGINE_SIGNAL_REQUIREMENTS } from "../server/signal-governance/types";
import { MIN_SIGNALS_PER_CATEGORY, MIN_TOTAL_SIGNALS, SIGNAL_CONFIDENCE_FLOOR } from "../server/signal-governance/constants";
import { PLATFORM_PROVIDER_CAPABILITIES } from "../server/competitive-intelligence/provider-registry";

const ACCOUNT_ID = "f020f6c7-15d8-4129-90a6-83a40558c642";
const CAMPAIGN_ID = "camp_mtewrp8kkom3";

async function main() {
  console.log("============================================================");
  console.log("AVYRON — SARA-FT END-TO-END EVIDENCE AUTHORITY & AUDIENCE TRACE");
  console.log("============================================================\n");

  // Step 1: Build Canonical Campaign Evidence Bundle
  console.log("--- STEP 1: ASSEMBLING CANONICAL CAMPAIGN EVIDENCE BUNDLE ---");
  const bundle = await buildCampaignEvidenceBundle(ACCOUNT_ID, CAMPAIGN_ID);

  console.log("Evidence Bundle Summary:");
  console.log(`  Sources in competitor_sources: ${bundle.counts.sources}`);
  console.log(`  Competitors mapped: ${bundle.competitors.length}`);
  console.log(`  Website Snapshots: ${bundle.counts.websiteSnapshots}`);
  console.log(`  Posts (All Platforms): ${bundle.counts.posts}`);
  console.log(`  Customer Voice Comments: ${bundle.counts.comments}`);
  console.log(`  Customer Voice Reviews: ${bundle.counts.reviews}`);
  console.log(`  Post Classifications: ${bundle.counts.classifications}`);
  console.log(`  TikTok Posts: ${bundle.tiktokEvidence.posts.length}`);
  console.log(`  TikTok Comments: ${bundle.tiktokEvidence.comments.length}`);
  console.log(`  LinkedIn Posts: ${bundle.linkedinEvidence.length}`);
  console.log(`  X (Twitter) Posts: ${bundle.xEvidence.length}`);
  console.log(`  YouTube Videos: ${bundle.youtubeEvidence.length}`);

  // Step 2: Show Sample Real Comments from Bundle
  console.log("\n--- STEP 2: VERIFYING CUSTOMER VOICE VISIBILITY ---");
  console.log(`Sample of first 10 customer voice comments consumed by bundle:`);
  bundle.customerVoiceComments.slice(0, 10).forEach((c, i) => {
    console.log(`  [${i + 1}] @${c.username || "anonymous"} (Post: ${c.postId.slice(0, 20)}...): ${JSON.stringify(c.commentText)} (Likes: ${c.likesCount ?? 0})`);
  });

  // Step 3: Run Audience Engine on Canonical Evidence
  console.log("\n--- STEP 3: RUNNING AUDIENCE ENGINE ON REAL EVIDENCE ---");
  const audRes = await runAudienceEngine(ACCOUNT_ID, CAMPAIGN_ID);

  console.log(`\nAudience Engine Status: ${audRes.status}`);
  console.log(`Audience Pains: ${audRes.audiencePains?.length || 0}`);
  console.log(`Desire Map: ${audRes.desireMap?.length || 0}`);
  console.log(`Objection Map: ${audRes.objectionMap?.length || 0}`);
  console.log(`Transformation Map: ${audRes.transformationMap?.length || 0}`);
  console.log(`Emotional Drivers: ${audRes.emotionalDrivers?.length || 0}`);
  console.log(`Audience Segments: ${audRes.audienceSegments?.length || 0}`);

  if (audRes.desireMap && audRes.desireMap.length > 0) {
    console.log("\nGrounded Desires Extracted from Evidence:");
    audRes.desireMap.forEach((d: any, i: number) => {
      console.log(`  [${i + 1}] Canonical: "${d.canonical}" | Frequency: ${d.frequency} | EvidenceCount: ${d.evidenceCount} | Conf: ${d.confidenceScore.toFixed(4)}`);
      console.log(`      Sample Evidence: ${JSON.stringify(d.evidence.slice(0, 2))}`);
      console.log(`      Source Types: [${(d.sourceTypes || []).join(", ")}] | Competitors: [${(d.competitorIds || []).slice(0, 3).join(", ")}...]`);
    });
  }

  // Step 4: Structured Signals and Signal Governance
  console.log("\n--- STEP 4: SIGNAL GOVERNANCE LAYER (SGL) EVALUATION ---");
  const rawObjections = audRes.objectionMap || [];
  const mappedObjections = rawObjections.map((o: any) => ({
    label: o.label ?? o.canonical ?? o.pain ?? o.signal ?? "",
    confidence: o.confidence ?? o.confidenceScore ?? 0.5,
    evidence: Array.isArray(o.evidence) ? o.evidence : [],
  }));

  const structuredSignals = audRes.structuredSignals || {
    pain_clusters: [],
    desire_clusters: [],
    pattern_clusters: [],
    root_causes: [],
    psychological_drivers: [],
  };

  console.log("Structured Signals in Audience Output:");
  console.log(`  Pain Clusters: ${structuredSignals.pain_clusters.length}`);
  console.log(`  Desire Clusters: ${structuredSignals.desire_clusters.length}`);
  console.log(`  Pattern Clusters: ${structuredSignals.pattern_clusters.length}`);
  console.log(`  Root Causes: ${structuredSignals.root_causes.length}`);
  console.log(`  Psychological Drivers: ${structuredSignals.psychological_drivers.length}`);

  const sglState = initializeSignalGovernance(structuredSignals, mappedObjections);

  console.log(`\nSGL Governed Signals Total: ${sglState.governedSignals.length}`);
  console.log("SGL Coverage Report:", sglState.coverageReport);

  // Step 5: Strategy Engine Resolution Check
  console.log("\n--- STEP 5: STRATEGY ENGINE RESOLUTION CHECKS ---");
  const engines = ["differentiation", "positioning", "mechanism", "offer", "awareness", "funnel", "persuasion"] as const;
  for (const eng of engines) {
    const res = resolveSignalsForEngine(sglState, eng as any);
    console.log(`Engine [${eng}]:`);
    console.log(`  Required: [${ENGINE_SIGNAL_REQUIREMENTS[eng].join(", ")}]`);
    console.log(`  Blocked: ${res.blocked}`);
    console.log(`  Insufficient: [${res.insufficientCategories.join(", ")}]`);
    console.log(`  Clean Signals Passed: ${res.signals.length}`);
  }

  // Step 6: Platform Provider Capability Summary
  console.log("\n--- STEP 6: PLATFORM PROVIDER REGISTRY STATUS ---");
  console.table(
    Object.values(PLATFORM_PROVIDER_CAPABILITIES).map(p => ({
      Platform: p.platform,
      Discovery: p.discovery ? "YES" : "NO",
      Verification: p.verification ? "YES" : "NO",
      Fetch: p.fetch ? "YES" : "NO",
      Comments: p.comments ? "YES" : "NO",
      Media: p.media ? "YES" : "NO",
      Recurring: p.recurringMonitoring ? "YES" : "NO",
      Status: p.status,
    }))
  );
}

main().catch(console.error);
