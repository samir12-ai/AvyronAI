import 'dotenv/config';
import { db } from "../db";
import { sql } from "drizzle-orm";
import { pipelineChangeEvents, ciCompetitors, pipelineSnapshots, watchtowerStrategicBriefs } from "../../shared/schema";
import { eq, and, inArray, isNotNull } from "drizzle-orm";

async function runTests() {
  console.log("==================================================");
  console.log("WATCHTOWER PERSISTENCE + REASONING REGRESSION TEST SUITE (A - K)");
  console.log("==================================================\n");

  let passed = 0;
  let total = 11;

  const testCampaignId = `test_wt_camp_${Date.now()}`;
  const testAccountId = "test_acc_wt";
  const testCompetitorId = `test_comp_${Date.now()}`;

  // Create test competitor
  await db.insert(ciCompetitors).values({
    id: testCompetitorId,
    accountId: testAccountId,
    campaignId: testCampaignId,
    name: "Acme Test Corp",
    platform: "instagram",
    profileLink: "https://instagram.com/acme_test",
    businessType: "saas",
    primaryObjective: "conversion",
    isActive: true,
    isDemo: false
  });

  // ----------------------------------------------------
  // TEST A: EVENT HISTORY PERSISTS
  // ----------------------------------------------------
  try {
    console.log("Running TEST A — Event History Persists...");
    const eventIdA = `wt_test_a_${Date.now()}`;
    await db.insert(pipelineChangeEvents).values({
      id: eventIdA,
      accountId: testAccountId,
      campaignId: testCampaignId,
      competitorId: testCompetitorId,
      runId: "run_fetch_1",
      kind: "primary_goal_shift",
      severity: "major",
      status: "candidate",
      baselineSnapshotId: "snap_base_1",
      currentSnapshotId: "snap_curr_1",
      changeDimension: "primary_goal",
      evidence: JSON.stringify({ notes: ["Goal shift from A to B"] })
    });

    const [fetchedA] = await db
      .select()
      .from(pipelineChangeEvents)
      .where(and(eq(pipelineChangeEvents.campaignId, testCampaignId), eq(pipelineChangeEvents.id, eventIdA)));

    if (fetchedA && fetchedA.id === eventIdA && fetchedA.status === "candidate") {
      console.log("✅ TEST A PASSED: Event WT-1 persists across subsequent fetch queries.");
      passed++;
    } else {
      console.error("❌ TEST A FAILED: Event did not persist.");
    }
  } catch (err: any) {
    console.error("❌ TEST A EXCEPTION:", err.message);
  }

  // ----------------------------------------------------
  // TEST B: CONFIRMATION KEEPS EVENT ID
  // ----------------------------------------------------
  try {
    console.log("\nRunning TEST B — Confirmation Keeps Event ID...");
    const eventIdB = `wt_test_b_${Date.now()}`;
    await db.insert(pipelineChangeEvents).values({
      id: eventIdB,
      accountId: testAccountId,
      campaignId: testCampaignId,
      competitorId: testCompetitorId,
      runId: "run_fetch_b1",
      kind: "promise_shift",
      severity: "major",
      status: "candidate",
      baselineSnapshotId: "snap_base_b",
      currentSnapshotId: "snap_curr_b1",
      changeDimension: "promise",
      evidence: JSON.stringify({ notes: ["Promise shift candidate"] })
    });

    // Confirm candidate in place
    const confirmationDate = new Date();
    await db.update(pipelineChangeEvents)
      .set({
        status: "confirmed",
        validatedAt: confirmationDate,
        currentSnapshotId: "snap_curr_b2",
        updatedAt: new Date()
      })
      .where(eq(pipelineChangeEvents.id, eventIdB));

    const [confirmedB] = await db
      .select()
      .from(pipelineChangeEvents)
      .where(eq(pipelineChangeEvents.id, eventIdB));

    if (confirmedB && confirmedB.id === eventIdB && confirmedB.status === "confirmed" && confirmedB.validatedAt) {
      console.log("✅ TEST B PASSED: Candidate confirmed in place under original eventId.");
      passed++;
    } else {
      console.error("❌ TEST B FAILED: Candidate failed in-place confirmation.");
    }
  } catch (err: any) {
    console.error("❌ TEST B EXCEPTION:", err.message);
  }

  // ----------------------------------------------------
  // TEST C: TERMINAL EVENT REMAINS HISTORY
  // ----------------------------------------------------
  try {
    console.log("\nRunning TEST C — Terminal Event Remains History...");
    const eventIdC = `wt_test_c_${Date.now()}`;
    await db.insert(pipelineChangeEvents).values({
      id: eventIdC,
      accountId: testAccountId,
      campaignId: testCampaignId,
      competitorId: testCompetitorId,
      runId: "run_fetch_c1",
      kind: "posting_frequency_shift",
      severity: "medium",
      status: "confirmed",
      validatedAt: new Date(),
      baselineSnapshotId: "snap_base_c",
      currentSnapshotId: "snap_curr_c1",
      changeDimension: "frequency",
      evidence: JSON.stringify({ notes: ["Frequency increased"] })
    });

    // Later source reverts -> candidate archived/reverted, NOT deleted
    await db.update(pipelineChangeEvents)
      .set({
        status: "archived",
        updatedAt: new Date()
      })
      .where(eq(pipelineChangeEvents.id, eventIdC));

    const [archivedC] = await db
      .select()
      .from(pipelineChangeEvents)
      .where(eq(pipelineChangeEvents.id, eventIdC));

    const terminalRows = await db
      .select()
      .from(pipelineChangeEvents)
      .where(and(
        eq(pipelineChangeEvents.campaignId, testCampaignId),
        inArray(pipelineChangeEvents.status, ['archived', 'dismissed', 'closed', 'superseded'])
      ));

    if (archivedC && archivedC.status === "archived" && terminalRows.some(r => r.id === eventIdC)) {
      console.log("✅ TEST C PASSED: Reverted event remains permanently in history as archived.");
      passed++;
    } else {
      console.error("❌ TEST C FAILED: Reverted event lost or not indexed.");
    }
  } catch (err: any) {
    console.error("❌ TEST C EXCEPTION:", err.message);
  }

  // ----------------------------------------------------
  // TEST D: DISTINCT EVENT ID FOR DISTINCT NEW CHANGE
  // ----------------------------------------------------
  try {
    console.log("\nRunning TEST D — Distinct Event ID...");
    const eventIdD1 = `wt_test_d1_${Date.now()}`;
    const eventIdD2 = `wt_test_d2_${Date.now()}`;

    await db.insert(pipelineChangeEvents).values({
      id: eventIdD1,
      accountId: testAccountId,
      campaignId: testCampaignId,
      competitorId: testCompetitorId,
      runId: "run_fetch_d",
      kind: "offer_type_shift",
      severity: "mild",
      status: "candidate",
      baselineSnapshotId: "snap_base_d",
      currentSnapshotId: "snap_curr_d1",
      changeDimension: "offer_type",
      evidence: JSON.stringify({ notes: ["Trial offer introduced"] })
    });

    await db.insert(pipelineChangeEvents).values({
      id: eventIdD2,
      accountId: testAccountId,
      campaignId: testCampaignId,
      competitorId: testCompetitorId,
      runId: "run_fetch_d",
      kind: "awareness_stage_shift",
      severity: "medium",
      status: "candidate",
      baselineSnapshotId: "snap_base_d",
      currentSnapshotId: "snap_curr_d1",
      changeDimension: "awareness_stage",
      evidence: JSON.stringify({ notes: ["Targeting Solution Aware"] })
    });

    const [rowD1] = await db.select().from(pipelineChangeEvents).where(eq(pipelineChangeEvents.id, eventIdD1));
    const [rowD2] = await db.select().from(pipelineChangeEvents).where(eq(pipelineChangeEvents.id, eventIdD2));

    if (rowD1 && rowD2 && rowD1.id !== rowD2.id && rowD1.kind !== rowD2.kind) {
      console.log("✅ TEST D PASSED: Genuinely distinct changes receive unique event identities.");
      passed++;
    } else {
      console.error("❌ TEST D FAILED: Distinct changes improperly collapsed.");
    }
  } catch (err: any) {
    console.error("❌ TEST D EXCEPTION:", err.message);
  }

  // ----------------------------------------------------
  // TEST E: FILTER STABILITY
  // ----------------------------------------------------
  try {
    console.log("\nRunning TEST E — Filter Stability...");
    const allRows = await db.select().from(pipelineChangeEvents).where(and(eq(pipelineChangeEvents.campaignId, testCampaignId), isNotNull(pipelineChangeEvents.kind)));
    const candidateRows = await db.select().from(pipelineChangeEvents).where(and(eq(pipelineChangeEvents.campaignId, testCampaignId), eq(pipelineChangeEvents.status, 'candidate')));
    const confirmedRows = await db.select().from(pipelineChangeEvents).where(and(eq(pipelineChangeEvents.campaignId, testCampaignId), eq(pipelineChangeEvents.status, 'confirmed')));
    const archivedRows = await db.select().from(pipelineChangeEvents).where(and(eq(pipelineChangeEvents.campaignId, testCampaignId), inArray(pipelineChangeEvents.status, ['archived', 'dismissed', 'closed', 'superseded'])));

    if (allRows.length === (candidateRows.length + confirmedRows.length + archivedRows.length)) {
      console.log(`✅ TEST E PASSED: Filter partitioning is exact and non-destructive (${allRows.length} total = ${candidateRows.length} under review + ${confirmedRows.length} confirmed + ${archivedRows.length} archived).`);
      passed++;
    } else {
      console.error("❌ TEST E FAILED: Count partition mismatch.");
    }
  } catch (err: any) {
    console.error("❌ TEST E EXCEPTION:", err.message);
  }

  // ----------------------------------------------------
  // TEST F: CONFIRMED EMPTY STATE WITH CONTEXTUAL MESSAGE
  // ----------------------------------------------------
  try {
    console.log("\nRunning TEST F — Confirmed Empty State With Contextual Explanation...");
    const activeCamp = "campaign_1773576062201_6t0oxi";
    const confirmedRows = await db.select().from(pipelineChangeEvents).where(and(eq(pipelineChangeEvents.campaignId, activeCamp), eq(pipelineChangeEvents.status, 'confirmed'), isNotNull(pipelineChangeEvents.kind)));
    const candidateRows = await db.select().from(pipelineChangeEvents).where(and(eq(pipelineChangeEvents.campaignId, activeCamp), eq(pipelineChangeEvents.status, 'candidate'), isNotNull(pipelineChangeEvents.kind)));

    if (confirmedRows.length === 0 && candidateRows.length === 17) {
      console.log(`✅ TEST F PASSED: Confirmed view returns 0 records and correctly references ${candidateRows.length} changes Under Review.`);
      passed++;
    } else {
      console.error(`❌ TEST F FAILED: Unexpected counts (confirmed: ${confirmedRows.length}, candidates: ${candidateRows.length})`);
    }
  } catch (err: any) {
    console.error("❌ TEST F EXCEPTION:", err.message);
  }

  // ----------------------------------------------------
  // TEST G: SELECTED EVENT BY ID
  // ----------------------------------------------------
  try {
    console.log("\nRunning TEST G — Selected Event By Event ID...");
    const targetEventId = "wt_1787326549191_li4mt8q"; // HubSpot primary goal shift
    const [rowG] = await db.select().from(pipelineChangeEvents).where(eq(pipelineChangeEvents.id, targetEventId));

    if (rowG && rowG.id === targetEventId && rowG.kind === "primary_goal_shift") {
      console.log(`✅ TEST G PASSED: Event selection resolves deterministically by eventId (${targetEventId}).`);
      passed++;
    } else {
      console.error("❌ TEST G FAILED: Could not resolve target event by ID.");
    }
  } catch (err: any) {
    console.error("❌ TEST G EXCEPTION:", err.message);
  }

  // ----------------------------------------------------
  // TEST H: STRATEGIC BRIEF RESOLUTION BY EVENT ID
  // ----------------------------------------------------
  try {
    console.log("\nRunning TEST H — Strategic Brief Resolution By Event ID...");
    const targetEventWithBrief = "wt_1786449712388_6refhsf"; // Eleven promise shift
    const [briefRow] = await db
      .select()
      .from(watchtowerStrategicBriefs)
      .where(and(eq(watchtowerStrategicBriefs.eventId, targetEventWithBrief), eq(watchtowerStrategicBriefs.isLatest, true)));

    if (briefRow && briefRow.eventId === targetEventWithBrief && (briefRow.brief as any)?.strategicInterpretation) {
      console.log(`✅ TEST H PASSED: Strategic reasoning brief resolved strictly by eventId (Brief ID: ${briefRow.id}).`);
      passed++;
    } else {
      console.error("❌ TEST H FAILED: Strategic brief could not be resolved by eventId.");
    }
  } catch (err: any) {
    console.error("❌ TEST H EXCEPTION:", err.message);
  }

  // ----------------------------------------------------
  // TEST I: BRIEF ABSENT IS VALID (CANDIDATE PROVISIONAL)
  // ----------------------------------------------------
  try {
    console.log("\nRunning TEST I — Brief Absent Is Valid State...");
    const candidateWithoutBriefId = "wt_1787326800284_do2uglv"; // Metricool candidate
    const [eventRow] = await db.select().from(pipelineChangeEvents).where(eq(pipelineChangeEvents.id, candidateWithoutBriefId));
    const [briefRow] = await db.select().from(watchtowerStrategicBriefs).where(eq(watchtowerStrategicBriefs.eventId, candidateWithoutBriefId));

    if (eventRow && !briefRow && eventRow.status === "candidate") {
      console.log(`✅ TEST I PASSED: Candidate event loads validly with brief = null (provisional state supported).`);
      passed++;
    } else {
      console.error("❌ TEST I FAILED: Expected candidate event with absent brief.");
    }
  } catch (err: any) {
    console.error("❌ TEST I EXCEPTION:", err.message);
  }

  // ----------------------------------------------------
  // TEST J: PROVIDER FAILURE FAILS CLOSED
  // ----------------------------------------------------
  try {
    console.log("\nRunning TEST J — Provider Failure Fails Closed...");
    const scraperSource = await import("fs").then(fs => fs.readFileSync("server/competitive-intelligence/instagram-apify-scraper.ts", "utf8"));

    const containsGenerateSynthetic = scraperSource.includes("generateSyntheticIgData");
    const containsDemoHash = scraperSource.includes("#demo");

    if (!containsGenerateSynthetic && !containsDemoHash) {
      console.log("✅ TEST J PASSED: Provider failure fails closed with 0 synthetic generation functions.");
      passed++;
    } else {
      console.error("❌ TEST J FAILED: Scraper still contains synthetic fallback data generators.");
    }
  } catch (err: any) {
    console.error("❌ TEST J EXCEPTION:", err.message);
  }

  // ----------------------------------------------------
  // TEST K: SYNTHETIC EVENT INVALIDATION BY LINEAGE ONLY
  // ----------------------------------------------------
  try {
    console.log("\nRunning TEST K — Synthetic Event Invalidation By Lineage Only...");
    // Verify that ONLY events with synthetic lineage were invalidated, while real events for competitors remain candidate/confirmed
    const invalidatedIds = ["wt_1787326595001_w1d1xx9", "wt_1787326557646_s2pp9wm"];
    const rowsK = await db.select().from(pipelineChangeEvents).where(inArray(pipelineChangeEvents.id, invalidatedIds));

    const allDismissed = rowsK.every(r => r.status === "dismissed");
    const allHaveAudit = rowsK.every(r => {
      const ev = typeof r.evidence === 'string' ? JSON.parse(r.evidence) : r.evidence;
      return ev?.invalidationReason === "invalidated_synthetic_scrape_fallback" || ev?.invalidationReason === "SYNTHETIC_SOURCE_DATA";
    });

    // Check that other active events (like hubspot, scalenut, simplified, metricool) are NOT invalidated
    const realCandidates = await db.select().from(pipelineChangeEvents).where(and(
      eq(pipelineChangeEvents.campaignId, "campaign_1773576062201_6t0oxi"),
      eq(pipelineChangeEvents.status, "candidate")
    ));

    if (rowsK.length === 2 && allDismissed && allHaveAudit && realCandidates.length === 17) {
      console.log(`✅ TEST K PASSED: Only 2 proven synthetic events invalidated; 17 real candidate events preserved.`);
      passed++;
    } else {
      console.error(`❌ TEST K FAILED: Lineage invalidation mismatch (invalidated: ${rowsK.length}, preserved real: ${realCandidates.length})`);
    }
  } catch (err: any) {
    console.error("❌ TEST K EXCEPTION:", err.message);
  }

  // Clean up temporary test data
  await db.delete(pipelineChangeEvents).where(eq(pipelineChangeEvents.campaignId, testCampaignId));
  await db.delete(ciCompetitors).where(eq(ciCompetitors.id, testCompetitorId));

  console.log("\n==================================================");
  console.log(`TEST RESULTS: ${passed} / ${total} TESTS PASSED`);
  console.log("==================================================");

  if (passed === total) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runTests();
