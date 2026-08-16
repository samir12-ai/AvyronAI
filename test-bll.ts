import { db } from './server/db';
import { miSnapshots } from './shared/schema';
import { MarketIntelligenceV3 } from './server/market-intelligence-v3/engine';
import { eq } from 'drizzle-orm';

async function runTest() {
  const accountId = 'default';
  
  console.log("Looking for an existing campaign...");
  const snap = await db.select().from(miSnapshots).limit(1);
  if (!snap.length) {
    console.log("No snapshots found to test against.");
    return;
  }
  
  const campaignId = snap[0].campaignId;
  console.log(`Found campaign: ${campaignId}. Running analysis...`);

  try {
    const result = await MarketIntelligenceV3.run("overview", accountId, campaignId, true, "STRATEGY_MODE", "test-job-id");
    console.log("Analysis Result Generated Successfully!");
    
    // Now simulate what routes.ts does:
    const updatedSnap = await db.select().from(miSnapshots).where(eq(miSnapshots.id, result.snapshot.id));
    const snapshot = updatedSnap[0];
    
    let executiveSummaryData = undefined;
    if (snapshot.diagnosticsData) {
      let diag: any = {};
      try { diag = typeof snapshot.diagnosticsData === "string" ? JSON.parse(snapshot.diagnosticsData) : snapshot.diagnosticsData; } catch {}
      console.log(`BLL Diagnostics ID: ${diag?.executiveSummaryId}, Snapshot ID: ${snapshot.id}`);
      if (diag?.executiveSummaryData && diag?.executiveSummaryId === snapshot.id) {
        executiveSummaryData = diag.executiveSummaryData;
      }
    }
    
    console.log("-----------------------------------------");
    console.log("Extracted Executive Summary Data:");
    console.log(JSON.stringify(executiveSummaryData, null, 2));
    console.log("-----------------------------------------");

    if (executiveSummaryData?.the_bottom_line && !executiveSummaryData?.the_bottom_line?.includes("Data is currently being processed")) {
      console.log("SUCCESS! The UI will render this flawlessly.");
    } else {
      console.log("FAILURE! Fallback or null returned.");
    }
  } catch (err) {
    console.error("Engine failed:", err);
  }
  process.exit(0);
}

runTest();
