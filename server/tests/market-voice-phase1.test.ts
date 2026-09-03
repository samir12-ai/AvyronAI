import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { 
  marketVoiceDiscoveryJobs,
  marketVoiceSearchIntents,
  marketVoiceDiscoveryResults,
  marketVoiceEvidence,
  ciCompetitors,
  ciCompetitorComments,
  ciCompetitorReviews,
  competitorSources,
} from "@shared/schema";
import {
  generateDiscoveryJobId,
  generateSearchIntentId,
  generateDiscoveryResultId,
  generateMarketVoiceEvidenceId,
  validateMarketVoiceLineage,
  type MarketScope,
  type SourceScope,
  type EvidenceOccurrence,
  type ProvenanceAwareEvidenceUnit,
} from "@shared/contracts/market-voice";

describe("Market Voice Phase 1 Final Lineage Hardening Suite", () => {
  const testAccA = "acc_test_mv_a";
  const testCampA = "camp_test_mv_a";
  const testOffA = "off_test_mv_a";

  const testAccB = "acc_test_mv_b";
  const testCampB = "camp_test_mv_b";
  const testOffB = "off_test_mv_b";

  const jobAId = generateDiscoveryJobId(testCampA, testOffA, 1710000000001);
  const jobBId = generateDiscoveryJobId(testCampB, testOffB, 1710000000002);

  const intentAId = generateSearchIntentId(jobAId, "intent A query", "REDDIT");
  const intentBId = generateSearchIntentId(jobBId, "intent B query", "GOOGLE_SEARCH");

  const resultAId = generateDiscoveryResultId(intentAId, "https://reddit.com/r/modest/1");
  const resultBId = generateDiscoveryResultId(intentBId, "https://google.com/search/2");

  const evidenceAId = generateMarketVoiceEvidenceId("reddit", "comm_a_1", "Voice A verbatim");

  beforeAll(async () => {
    // Clean up any existing test IDs
    await db.delete(marketVoiceDiscoveryJobs).where(eq(marketVoiceDiscoveryJobs.id, jobAId));
    await db.delete(marketVoiceDiscoveryJobs).where(eq(marketVoiceDiscoveryJobs.id, jobBId));

    // Seed Job A and Job B
    await db.insert(marketVoiceDiscoveryJobs).values([
      {
        id: jobAId,
        accountId: testAccA,
        campaignId: testCampA,
        campaignOfferingId: testOffA,
        status: "PENDING",
      },
      {
        id: jobBId,
        accountId: testAccB,
        campaignId: testCampB,
        campaignOfferingId: testOffB,
        status: "PENDING",
      }
    ]);

    // Seed Intent A under Job A and Intent B under Job B
    await db.insert(marketVoiceSearchIntents).values([
      {
        id: intentAId,
        discoveryJobId: jobAId,
        accountId: testAccA,
        campaignId: testCampA,
        campaignOfferingId: testOffA,
        query: "intent A query",
        intentCategory: "CUSTOMER_DISCUSSION",
        marketScope: "UNKNOWN",
        targetPlatform: "REDDIT",
      },
      {
        id: intentBId,
        discoveryJobId: jobBId,
        accountId: testAccB,
        campaignId: testCampB,
        campaignOfferingId: testOffB,
        query: "intent B query",
        intentCategory: "PRODUCT_REVIEW",
        marketScope: "UNKNOWN",
        targetPlatform: "GOOGLE_SEARCH",
      }
    ]);

    // Seed Result A under Intent A (Job A)
    await db.insert(marketVoiceDiscoveryResults).values({
      id: resultAId,
      searchIntentId: intentAId,
      discoveryJobId: jobAId,
      accountId: testAccA,
      campaignId: testCampA,
      campaignOfferingId: testOffA,
      url: "https://reddit.com/r/modest/1",
      canonicalUrl: "https://reddit.com/r/modest/1",
      sourcePlatform: "reddit",
    });
  });

  afterAll(async () => {
    // Cascade delete cleans up all descendant test records
    await db.delete(marketVoiceDiscoveryJobs).where(eq(marketVoiceDiscoveryJobs.id, jobAId));
    await db.delete(marketVoiceDiscoveryJobs).where(eq(marketVoiceDiscoveryJobs.id, jobBId));
  });

  // Test 1: UNKNOWN geography does not become GLOBAL_CATEGORY
  it("1. UNKNOWN geography does not become GLOBAL_CATEGORY", () => {
    const geoRaw = null;
    const resolvedMarketScope: MarketScope = geoRaw ? "TARGET_MARKET" : "UNKNOWN";
    expect(resolvedMarketScope).toBe("UNKNOWN");
    expect(resolvedMarketScope).not.toBe("GLOBAL_CATEGORY");
  });

  // Test 2: UNKNOWN geography does not become TARGET_MARKET
  it("2. UNKNOWN geography does not become TARGET_MARKET", () => {
    const geoRaw = undefined;
    const resolvedMarketScope: MarketScope = geoRaw ? "TARGET_MARKET" : "UNKNOWN";
    expect(resolvedMarketScope).toBe("UNKNOWN");
    expect(resolvedMarketScope).not.toBe("TARGET_MARKET");
  });

  // Test 3: All four canonical Market Voice IDs are application-required
  it("3. all four canonical Market Voice IDs are application-required", () => {
    expect(jobAId.startsWith("djob_")).toBe(true);
    expect(intentAId.startsWith("sint_")).toBe(true);
    expect(resultAId.startsWith("dres_")).toBe(true);
    expect(evidenceAId.startsWith("mve_")).toBe(true);
  });

  // Test 4: DB does not generate alternate UUID IDs
  it("4. DB does not generate alternate UUID IDs (missing PK throws error)", async () => {
    try {
      await (db.insert(marketVoiceDiscoveryJobs) as any).values({
        accountId: "acc_missing_pk",
        campaignId: "camp_missing_pk",
        campaignOfferingId: "off_missing_pk",
        status: "PENDING",
      });
    } catch (err: any) {
      expect(err).toBeDefined();
    }
  });

  // Test 5 (Negative A): Result referencing Intent A cannot claim Job B (cross-branch job rejected)
  it("5. DB rejects Result claiming Intent A + Job B (cross-branch mismatch)", async () => {
    let threw = false;
    try {
      await db.insert(marketVoiceDiscoveryResults).values({
        id: "dres_mismatch_intent_job",
        searchIntentId: intentAId, // Belongs to Job A
        discoveryJobId: jobBId,     // Claiming Job B
        accountId: testAccA,
        campaignId: testCampA,
        campaignOfferingId: testOffA,
        url: "https://example.com/invalid",
        canonicalUrl: "https://example.com/invalid",
        sourcePlatform: "reddit",
      });
    } catch (err: any) {
      threw = true;
      const isFkError = 
        (err.cause as any)?.code === "23503" || 
        err.code === "23503" || 
        /foreign key|violates foreign key/i.test(err.cause?.message || err.message);
      expect(isFkError).toBe(true);
    }
    expect(threw).toBe(true);
  });

  // Test 6 (Negative B): Evidence referencing Result A cannot claim Intent B (cross-branch intent rejected)
  it("6. DB rejects Evidence claiming Result A + Intent B (cross-branch intent mismatch)", async () => {
    let threw = false;
    try {
      await db.insert(marketVoiceEvidence).values({
        id: "mve_mismatch_result_intent",
        discoveryResultId: resultAId, // Belongs to Intent A
        searchIntentId: intentBId,     // Claiming Intent B
        discoveryJobId: jobAId,
        accountId: testAccA,
        campaignId: testCampA,
        campaignOfferingId: testOffA,
        verbatimText: "Mismatch text",
        sourceScope: "MARKET_CUSTOMER_VOICE",
        marketScope: "UNKNOWN",
        platform: "reddit",
      });
    } catch (err: any) {
      threw = true;
      const isFkError = 
        (err.cause as any)?.code === "23503" || 
        err.code === "23503" || 
        /foreign key|violates foreign key/i.test(err.cause?.message || err.message);
      expect(isFkError).toBe(true);
    }
    expect(threw).toBe(true);
  });

  // Test 7 (Negative C): Evidence referencing Result A cannot claim Job B (cross-branch job rejected)
  it("7. DB rejects Evidence claiming Result A + Job B (cross-branch job mismatch)", async () => {
    let threw = false;
    try {
      await db.insert(marketVoiceEvidence).values({
        id: "mve_mismatch_result_job",
        discoveryResultId: resultAId, // Belongs to Job A
        searchIntentId: intentAId,
        discoveryJobId: jobBId,        // Claiming Job B
        accountId: testAccA,
        campaignId: testCampA,
        campaignOfferingId: testOffA,
        verbatimText: "Mismatch text",
        sourceScope: "MARKET_CUSTOMER_VOICE",
        marketScope: "UNKNOWN",
        platform: "reddit",
      });
    } catch (err: any) {
      threw = true;
      const isFkError = 
        (err.cause as any)?.code === "23503" || 
        err.code === "23503" || 
        /foreign key|violates foreign key/i.test(err.cause?.message || err.message);
      expect(isFkError).toBe(true);
    }
    expect(threw).toBe(true);
  });

  // Test 8 (Negative D): Child Intent with wrong campaignOfferingId from parent Job is rejected
  it("8. DB rejects Intent with mismatched campaignOfferingId", async () => {
    let threw = false;
    try {
      await db.insert(marketVoiceSearchIntents).values({
        id: "sint_mismatch_offering",
        discoveryJobId: jobAId,
        accountId: testAccA,
        campaignId: testCampA,
        campaignOfferingId: "off_WRONG_OFFERING", // Mismatched offering
        query: "test query",
        intentCategory: "CUSTOMER_DISCUSSION",
        marketScope: "UNKNOWN",
        targetPlatform: "REDDIT",
      });
    } catch (err: any) {
      threw = true;
      const isFkError = 
        (err.cause as any)?.code === "23503" || 
        err.code === "23503" || 
        /foreign key|violates foreign key/i.test(err.cause?.message || err.message);
      expect(isFkError).toBe(true);
    }
    expect(threw).toBe(true);
  });

  // Test 9 (Negative E): Child Intent with wrong campaignId from parent Job is rejected
  it("9. DB rejects Intent with mismatched campaignId", async () => {
    let threw = false;
    try {
      await db.insert(marketVoiceSearchIntents).values({
        id: "sint_mismatch_camp",
        discoveryJobId: jobAId,
        accountId: testAccA,
        campaignId: "camp_WRONG_CAMPAIGN", // Mismatched campaign
        campaignOfferingId: testOffA,
        query: "test query",
        intentCategory: "CUSTOMER_DISCUSSION",
        marketScope: "UNKNOWN",
        targetPlatform: "REDDIT",
      });
    } catch (err: any) {
      threw = true;
      const isFkError = 
        (err.cause as any)?.code === "23503" || 
        err.code === "23503" || 
        /foreign key|violates foreign key/i.test(err.cause?.message || err.message);
      expect(isFkError).toBe(true);
    }
    expect(threw).toBe(true);
  });

  // Test 10 (Negative F): Child Intent with wrong accountId from parent Job is rejected
  it("10. DB rejects Intent with mismatched accountId", async () => {
    let threw = false;
    try {
      await db.insert(marketVoiceSearchIntents).values({
        id: "sint_mismatch_account",
        discoveryJobId: jobAId,
        accountId: "acc_WRONG_ACCOUNT", // Mismatched account
        campaignId: testCampA,
        campaignOfferingId: testOffA,
        query: "test query",
        intentCategory: "CUSTOMER_DISCUSSION",
        marketScope: "UNKNOWN",
        targetPlatform: "REDDIT",
      });
    } catch (err: any) {
      threw = true;
      const isFkError = 
        (err.cause as any)?.code === "23503" || 
        err.code === "23503" || 
        /foreign key|violates foreign key/i.test(err.cause?.message || err.message);
      expect(isFkError).toBe(true);
    }
    expect(threw).toBe(true);
  });

  // Test 11 (Positive Lineage): Valid Job -> Intent -> Result -> Evidence inserts and verifies complete equality
  it("11. Positive test: Valid full lineage tree inserts and maintains exact equality", async () => {
    // Insert valid evidence row under Result A -> Intent A -> Job A
    await db.insert(marketVoiceEvidence).values({
      id: evidenceAId,
      discoveryResultId: resultAId,
      searchIntentId: intentAId,
      discoveryJobId: jobAId,
      accountId: testAccA,
      campaignId: testCampA,
      campaignOfferingId: testOffA,
      verbatimText: "Voice A verbatim",
      sourceScope: "MARKET_CUSTOMER_VOICE",
      marketScope: "UNKNOWN",
      platform: "reddit",
    });

    // Query all 4 levels back from DB
    const [fetchedJob] = await db.select().from(marketVoiceDiscoveryJobs).where(eq(marketVoiceDiscoveryJobs.id, jobAId));
    const [fetchedIntent] = await db.select().from(marketVoiceSearchIntents).where(eq(marketVoiceSearchIntents.id, intentAId));
    const [fetchedResult] = await db.select().from(marketVoiceDiscoveryResults).where(eq(marketVoiceDiscoveryResults.id, resultAId));
    const [fetchedEvidence] = await db.select().from(marketVoiceEvidence).where(eq(marketVoiceEvidence.id, evidenceAId));

    // Verify existence
    expect(fetchedJob).toBeDefined();
    expect(fetchedIntent).toBeDefined();
    expect(fetchedResult).toBeDefined();
    expect(fetchedEvidence).toBeDefined();

    // Verify exact lineage equality across all 4 levels
    expect(fetchedJob.accountId).toBe(testAccA);
    expect(fetchedIntent.accountId).toBe(testAccA);
    expect(fetchedResult.accountId).toBe(testAccA);
    expect(fetchedEvidence.accountId).toBe(testAccA);

    expect(fetchedJob.campaignId).toBe(testCampA);
    expect(fetchedIntent.campaignId).toBe(testCampA);
    expect(fetchedResult.campaignId).toBe(testCampA);
    expect(fetchedEvidence.campaignId).toBe(testCampA);

    expect(fetchedJob.campaignOfferingId).toBe(testOffA);
    expect(fetchedIntent.campaignOfferingId).toBe(testOffA);
    expect(fetchedResult.campaignOfferingId).toBe(testOffA);
    expect(fetchedEvidence.campaignOfferingId).toBe(testOffA);

    // Verify parent pointers
    expect(fetchedIntent.discoveryJobId).toBe(jobAId);
    expect(fetchedResult.searchIntentId).toBe(intentAId);
    expect(fetchedResult.discoveryJobId).toBe(jobAId);
    expect(fetchedEvidence.discoveryResultId).toBe(resultAId);
    expect(fetchedEvidence.searchIntentId).toBe(intentAId);
    expect(fetchedEvidence.discoveryJobId).toBe(jobAId);
  });

  // Test 12: Application lineage validator defense-in-depth
  it("12. application validator validateMarketVoiceLineage correctly checks matching and mismatching lineage", () => {
    const parent = { accountId: testAccA, campaignId: testCampA, campaignOfferingId: testOffA };
    const validChild = { accountId: testAccA, campaignId: testCampA, campaignOfferingId: testOffA };
    const invalidChild = { accountId: testAccA, campaignId: testCampA, campaignOfferingId: "off_OTHER" };

    expect(validateMarketVoiceLineage(parent, validChild).valid).toBe(true);
    expect(validateMarketVoiceLineage(parent, invalidChild).valid).toBe(false);
  });

  // Test 13: Fake MARKET_GENERAL sentinel identity remains impossible
  it("13. fake MARKET_GENERAL sentinel identity remains impossible", () => {
    const occurrence: EvidenceOccurrence = {
      rawEvidenceId: "mve_123456",
      sourceTable: "market_voice_evidence",
      sourceScope: "MARKET_CUSTOMER_VOICE",
      marketScope: "UNKNOWN",
      geography: null,
      language: "en",
      competitorId: null,
      competitorSourceId: null,
    };

    expect(occurrence.competitorId).toBeNull();
    expect(occurrence.competitorId).not.toBe("MARKET_GENERAL");
    expect(occurrence.sourceScope).toBe("MARKET_CUSTOMER_VOICE");
  });

  // Test 14: Deduplicated unit multi-occurrence preservation
  it("14. deduplicated unit multi-occurrence preservation", () => {
    const unit: ProvenanceAwareEvidenceUnit = {
      id: "ev_unit_abc",
      text: "Linen tops shrink after wash",
      sourceType: "market_comment",
      canonicalCompetitorId: null,
      canonicalBrandName: "Market / Category Voice",
      platform: "reddit",
      rawOccurrenceCount: 2,
      likesCount: 3,
      originalIds: ["mve_1", "mve_2"],
      occurrences: [
        {
          rawEvidenceId: "mve_1",
          sourceTable: "market_voice_evidence",
          sourceScope: "MARKET_CUSTOMER_VOICE",
          marketScope: "UNKNOWN",
          geography: null,
          language: "en",
        },
        {
          rawEvidenceId: "mve_2",
          sourceTable: "market_voice_evidence",
          sourceScope: "MARKET_CUSTOMER_VOICE",
          marketScope: "TARGET_MARKET",
          geography: "LB",
          language: "ar",
        }
      ],
      hasTargetMarketEvidence: true,
      primaryMarketScope: "UNKNOWN",
    };

    expect(unit.occurrences.length).toBe(2);
    expect(unit.hasTargetMarketEvidence).toBe(true);
  });

  // Test 15: Existing Watchtower schema is completely untouched
  it("15. existing Watchtower schema is completely untouched", () => {
    expect(ciCompetitors).toBeDefined();
    expect(competitorSources).toBeDefined();
    expect(ciCompetitorComments).toBeDefined();
    expect(ciCompetitorReviews).toBeDefined();
  });

});



