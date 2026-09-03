import "dotenv/config";
import { db } from "../server/db";
import { runAudienceEngine } from "../server/audience-engine/engine";
import { initializeSignalGovernance, resolveSignalsForEngine } from "../server/signal-governance/engine";
import { ENGINE_SIGNAL_REQUIREMENTS } from "../server/signal-governance/types";

async function main() {
  const accountId = "f020f6c7-15d8-4129-90a6-83a40558c642";
  const campaignId = "camp_mtewrp8kkom3";

  console.log("=== RUNNING AUDIENCE ENGINE FOR REAL CAMPAIGN ===");
  const audRes = await runAudienceEngine(accountId, campaignId);
  console.log("\nAudience Engine Status:", audRes.status);
  console.log("Audience Pains:", audRes.audiencePains);
  console.log("Desire Map:", audRes.desireMap);
  console.log("Objection Map:", audRes.objectionMap);
  console.log("Audience Segments:", audRes.audienceSegments);
  console.log("\nStructured Signals in Audience Result:");
  console.log(JSON.stringify(audRes.structuredSignals, null, 2));

  console.log("\n=== INITIALIZING SGL WITH AUDIENCE RESULT ===");
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

  console.log("\nSGL Initialized Governed Signals Count:", sglState.governedSignals.length);
  console.log("SGL Governed Signals:", sglState.governedSignals.map(s => ({ id: s.signalId, cat: s.category, text: s.text, conf: s.confidence })));
  console.log("\nSGL Coverage Report:", sglState.coverageReport);

  console.log("\n=== EVALUATING SGL FOR EVERY DOWNSTREAM ENGINE ===");
  const engines = ["differentiation", "positioning", "mechanism", "offer", "awareness", "funnel", "persuasion"] as const;
  for (const eng of engines) {
    const res = resolveSignalsForEngine(sglState, eng as any);
    console.log(`\nEngine [${eng}]:`);
    console.log(`  Required: [${ENGINE_SIGNAL_REQUIREMENTS[eng].join(", ")}]`);
    console.log(`  Blocked: ${res.blocked}`);
    console.log(`  Insufficient Categories: [${res.insufficientCategories.join(", ")}]`);
    console.log(`  Clean Signals Count: ${res.signals.length}`);
  }

  process.exit(0);
}

main().catch(console.error);
