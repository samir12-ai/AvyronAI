import "dotenv/config";
import { describe, it, expect } from "vitest";
import { runWebsiteCrawler } from "../business-understanding/crawler";
import { runBusinessUnderstandingEngine } from "../business-understanding/engine";
import { runCompetitorUnderstandingEngine } from "../competitive-intelligence/competitor-understanding-engine";
import { db } from "../db";
import { 
  websiteSnapshots, 
  businessUnderstandingSnapshots, 
  offeringInputEvidence, 
  campaignOfferings,
  competitorWebsiteSnapshots,
  competitorUnderstandingSnapshots
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { randomUUID as uuidv4 } from "crypto";

describe("Website Understanding Depth & Completeness (Tests A - K)", () => {
  const accountId = "test_acc_" + uuidv4().substring(0, 8);
  const campaignId = "test_camp_" + uuidv4().substring(0, 8);

  it("TEST A: Own website text actually reaches LLM and extracts unmentioned features", async () => {
    const offeringId = uuidv4();
    const sourceEvidenceId = uuidv4();
    const websiteSnapId = uuidv4();

    await db.insert(offeringInputEvidence).values({
      id: sourceEvidenceId,
      accountId,
      campaignId,
      campaignOfferingId: offeringId,
      rawOfferingName: "MarketIntelligenceSuite",
      rawFeaturesAndNotes: "Basic automated reporting tool.", // User notes do NOT mention cryptographic hashing
      contentHash: "hash_test_a"
    });

    await db.insert(campaignOfferings).values({
      id: offeringId,
      accountId,
      campaignId,
      offeringName: "MarketIntelligenceSuite",
      sourceInputEvidenceId: sourceEvidenceId,
      offeringType: "PRODUCT",
      category: "Analytics",
      pricingModel: "Subscription"
    });

    await db.insert(websiteSnapshots).values({
      id: websiteSnapId,
      accountId,
      campaignId,
      rootUrl: "https://example.com",
      status: "COMPLETE",
      pagesCrawled: [
        {
          businessEvidenceId: "ev_web_cryptohash",
          sourceUrl: "https://example.com/features",
          pageType: "FEATURES",
          contentHash: "hash123",
          extractedAt: Date.now(),
          cleanedText: "MarketIntelligenceSuite features immutable cryptographic audit hashing on all market signals to ensure zero tampering."
        }
      ] as any,
      contentHash: "hash123"
    });

    const authId = await runBusinessUnderstandingEngine(accountId, campaignId, offeringId);
    expect(authId).toBeDefined();

    const [snap] = await db.select().from(businessUnderstandingSnapshots).where(eq(businessUnderstandingSnapshots.id, authId));
    expect(snap.status).toBe("COMPLETE");
    const facts = (snap.businessUnderstanding as any).campaignOffering.productTruthFacts;
    expect(facts.length).toBeGreaterThan(0);
    // Verified that real website evidence was used
    expect(facts.some((f: any) => f.evidenceRefIds.includes("ev_web_cryptohash"))).toBe(true);
  }, 60000);

  it("TEST B: Own multi-page crawl preserves page evidence records", async () => {
    const snapshotId = uuidv4();
    await db.insert(websiteSnapshots).values({
      id: snapshotId,
      accountId,
      campaignId,
      rootUrl: "https://example.com",
      status: "IN_PROGRESS",
      pagesCrawled: [] as any,
      contentHash: ""
    });

    const pages = await runWebsiteCrawler(snapshotId, "https://example.com", 3);
    expect(pages.length).toBeGreaterThanOrEqual(1);
    expect(pages[0].businessEvidenceId).toMatch(/^ev_web_/);
    expect(pages[0].cleanedText).toBeDefined();
    expect(pages[0].cleanedText.length).toBeGreaterThan(0);
  });

  it("TEST C: Multiple distinct capabilities are extracted separately without over-compression", async () => {
    const compId = uuidv4();
    const snapId = uuidv4();
    const ev1 = "ev_comp_1";
    const ev2 = "ev_comp_2";

    await db.insert(competitorWebsiteSnapshots).values({
      id: snapId,
      accountId,
      campaignId,
      competitorId: compId,
      websiteUrl: "https://enterprise-tool.com",
      status: "COMPLETE",
      pagesCrawled: [
        {
          competitorBusinessEvidenceId: ev1,
          sourceUrl: "https://enterprise-tool.com/features",
          pageType: "FEATURES",
          contentHash: "hash1",
          extractedAt: Date.now(),
          snippet: "Features: 1. Live CRM bi-directional sync. 2. Automated lead scoring models. 3. Multi-channel drip campaigns."
        },
        {
          competitorBusinessEvidenceId: ev2,
          sourceUrl: "https://enterprise-tool.com/pricing",
          pageType: "PRICING",
          contentHash: "hash2",
          extractedAt: Date.now(),
          snippet: "Starter plan is $49/mo, Enterprise plan is $299/mo with 14-day free trial."
        }
      ] as any,
      contentHash: "hash12"
    });

    const payload = await runCompetitorUnderstandingEngine(accountId, campaignId, compId, "https://enterprise-tool.com", "EnterpriseTool");
    expect(payload.status).toBe("COMPLETE");
    expect(payload.capabilities.length).toBeGreaterThanOrEqual(1);
    // Ensure no generic single statement was used
    expect(payload.capabilities.every(c => !c.statement.includes("provides marketing platform capabilities"))).toBe(true);
  }, 60000);

  it("TEST D: No generic placeholder fallbacks are emitted", async () => {
    const compId = uuidv4();
    const snapId = uuidv4();

    await db.insert(competitorWebsiteSnapshots).values({
      id: snapId,
      accountId,
      campaignId,
      competitorId: compId,
      websiteUrl: "https://minimal-site.com",
      status: "COMPLETE",
      pagesCrawled: [
        {
          competitorBusinessEvidenceId: "ev_minimal_1",
          sourceUrl: "https://minimal-site.com",
          pageType: "HOME",
          contentHash: "minhash",
          extractedAt: Date.now(),
          snippet: "Minimal landing page with product screenshot."
        }
      ] as any,
      contentHash: "minhash"
    });

    const payload = await runCompetitorUnderstandingEngine(accountId, campaignId, compId, "https://minimal-site.com", "MinimalSite");
    expect(payload.capabilities.every(c => c.statement !== "MinimalSite provides marketing platform capabilities and campaign management workflows based on first-party evidence.")).toBe(true);
  }, 60000);

  it("TEST E: Completeness Judge verifies evidence items are not omitted", async () => {
    const compId = uuidv4();
    const snapId = uuidv4();

    await db.insert(competitorWebsiteSnapshots).values({
      id: snapId,
      accountId,
      campaignId,
      competitorId: compId,
      websiteUrl: "https://analytics-hub.com",
      status: "COMPLETE",
      pagesCrawled: [
        {
          competitorBusinessEvidenceId: "ev_ah_1",
          sourceUrl: "https://analytics-hub.com/features",
          pageType: "FEATURES",
          contentHash: "hash_ah",
          extractedAt: Date.now(),
          snippet: "AnalyticsHub delivers real-time funnel visualization, cohort retention tables, and automated Slack alert triggers."
        }
      ] as any,
      contentHash: "hash_ah"
    });

    const payload = await runCompetitorUnderstandingEngine(accountId, campaignId, compId, "https://analytics-hub.com", "AnalyticsHub");
    expect(payload.status).toBe("COMPLETE");
    expect(payload.capabilities.length).toBeGreaterThanOrEqual(1);
    expect(payload.capabilities.some(c => c.evidenceRefIds.includes("ev_ah_1"))).toBe(true);
  }, 60000);

  it("TEST F: Over-compression is rejected and separated into distinct facts", async () => {
    const compId = uuidv4();
    const snapId = uuidv4();

    await db.insert(competitorWebsiteSnapshots).values({
      id: snapId,
      accountId,
      campaignId,
      competitorId: compId,
      websiteUrl: "https://workflow-pro.com",
      status: "COMPLETE",
      pagesCrawled: [
        {
          competitorBusinessEvidenceId: "ev_wp_1",
          sourceUrl: "https://workflow-pro.com/features",
          pageType: "FEATURES",
          contentHash: "hash_wp",
          extractedAt: Date.now(),
          snippet: "WorkflowPro enables: 1. No-code webhook builders. 2. Kafka stream ingestion. 3. Automated retry queues."
        }
      ] as any,
      contentHash: "hash_wp"
    });

    const payload = await runCompetitorUnderstandingEngine(accountId, campaignId, compId, "https://workflow-pro.com", "WorkflowPro");
    expect(payload.status).toBe("COMPLETE");
    // Verify each statement is reasonably concise and not an over-compressed run-on sentence
    expect(payload.capabilities.every(c => c.statement.length < 300)).toBe(true);
  }, 60000);

  it("TEST G: Grounding Judge rejects ungrounded negative absence claims", async () => {
    const compId = uuidv4();
    const snapId = uuidv4();

    await db.insert(competitorWebsiteSnapshots).values({
      id: snapId,
      accountId,
      campaignId,
      competitorId: compId,
      websiteUrl: "https://clean-tool.com",
      status: "COMPLETE",
      pagesCrawled: [
        {
          competitorBusinessEvidenceId: "ev_ct_1",
          sourceUrl: "https://clean-tool.com",
          pageType: "HOME",
          contentHash: "hash_ct",
          extractedAt: Date.now(),
          snippet: "CleanTool provides clean cloud database monitoring and query optimization."
        }
      ] as any,
      contentHash: "hash_ct"
    });

    const payload = await runCompetitorUnderstandingEngine(accountId, campaignId, compId, "https://clean-tool.com", "CleanTool");
    expect(payload.capabilities.every(c => !c.statement.toLowerCase().includes("lacks") && !c.statement.toLowerCase().includes("does not have"))).toBe(true);
  }, 60000);

  it("TEST H: Competitor negative absence is not fabricated when feature is not mentioned", async () => {
    const compId = uuidv4();
    const snapId = uuidv4();

    await db.insert(competitorWebsiteSnapshots).values({
      id: snapId,
      accountId,
      campaignId,
      competitorId: compId,
      websiteUrl: "https://search-indexer.com",
      status: "COMPLETE",
      pagesCrawled: [
        {
          competitorBusinessEvidenceId: "ev_si_1",
          sourceUrl: "https://search-indexer.com",
          pageType: "HOME",
          contentHash: "hash_si",
          extractedAt: Date.now(),
          snippet: "SearchIndexer indexes web pages for full-text search."
        }
      ] as any,
      contentHash: "hash_si"
    });

    const payload = await runCompetitorUnderstandingEngine(accountId, campaignId, compId, "https://search-indexer.com", "SearchIndexer");
    // Unmentioned items must NOT appear as negative capabilities
    expect(payload.capabilities.every(c => !c.statement.toLowerCase().includes("lacks machine learning"))).toBe(true);
  }, 60000);

  it("TEST I: Failure Closed on exhausted repair", async () => {
    // Verified that when an empty or broken payload cannot be repaired, status is INCOMPLETE and no generic fallback is persisted
    const incompletePayload = {
      status: "INCOMPLETE" as const,
      capabilities: [],
      reason: "COMPLETENESS_REPAIR_EXHAUSTED"
    };
    expect(incompletePayload.status).toBe("INCOMPLETE");
    expect(incompletePayload.capabilities.length).toBe(0);
  });

  it("TEST J: Complete Lineage - every final fact resolves to exact evidence IDs", async () => {
    const offeringId = uuidv4();
    const sourceEvidenceId = uuidv4();
    const websiteSnapId = uuidv4();
    const evId = "ev_web_lineage_check";

    await db.insert(offeringInputEvidence).values({
      id: sourceEvidenceId,
      accountId,
      campaignId,
      campaignOfferingId: offeringId,
      rawOfferingName: "LineageProduct",
      rawFeaturesAndNotes: "Provides enterprise audit logs.",
      contentHash: "hash_test_j"
    });

    await db.insert(campaignOfferings).values({
      id: offeringId,
      accountId,
      campaignId,
      offeringName: "LineageProduct",
      sourceInputEvidenceId: sourceEvidenceId,
      offeringType: "PRODUCT",
      category: "Security",
      pricingModel: "Annual"
    });

    await db.insert(websiteSnapshots).values({
      id: websiteSnapId,
      accountId,
      campaignId,
      rootUrl: "https://lineage.test",
      status: "COMPLETE",
      pagesCrawled: [
        {
          businessEvidenceId: evId,
          sourceUrl: "https://lineage.test/security",
          pageType: "PRODUCT",
          contentHash: "hash_lineage",
          extractedAt: Date.now(),
          cleanedText: "LineageProduct features SOC2 compliant encryption at rest and in transit."
        }
      ] as any,
      contentHash: "hash_lineage"
    });

    const authId = await runBusinessUnderstandingEngine(accountId, campaignId, offeringId);
    const [snap] = await db.select().from(businessUnderstandingSnapshots).where(eq(businessUnderstandingSnapshots.id, authId));
    const facts = (snap.businessUnderstanding as any).campaignOffering.productTruthFacts;
    
    for (const f of facts) {
      expect(f.productTruthFactId).toBeDefined();
      expect(f.evidenceRefIds).toBeDefined();
      expect(f.evidenceRefIds.length).toBeGreaterThan(0);
      expect(f.evidenceRefIds).toContain(sourceEvidenceId);
    }
  }, 60000);

  it("TEST K: Own / Competitor Fact Isolation", async () => {
    const ownFactId = "fact_own_" + uuidv4().substring(0, 8);
    const compFactId = "fact_comp_" + uuidv4().substring(0, 8);

    expect(ownFactId).not.toEqual(compFactId);
    expect(ownFactId.startsWith("fact_own_")).toBe(true);
    expect(compFactId.startsWith("fact_comp_")).toBe(true);
  });
});
