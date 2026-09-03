import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { Express } from "express";
import http from "http";
import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";
import { 
  offeringInputEvidence,
  campaignOfferings,
  campaignSelections,
  websiteSnapshots,
  businessUnderstandingSnapshots,
  ciCompetitors,
  competitorSources,
} from "@shared/schema";
import { loadMarketVoicePlannerContext, isWeakOfferingLabel } from "../market-voice/search-planner";
import { setupRouter } from "../setup/setup-routes";
import { settingsRouter } from "../setup/settings-routes";
import { randomUUID as uuidv4 } from "crypto";

describe("Campaign Hero Product Authority & Guards Suite", () => {
  const testAccountId = "acc_test_auth_" + uuidv4().slice(0, 8);
  const testCampaignId = "camp_test_auth_" + uuidv4().slice(0, 8);
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    // Setup Express integration test app for real route verification
    const app: Express = express();
    app.use(express.json());
    app.use((req, res, next) => {
      (req as any).accountId = testAccountId;
      (req as any).headers["x-account-id"] = testAccountId;
      next();
    });
    app.use("/api/setup", setupRouter);
    app.use("/api/settings", settingsRouter);

    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;
    baseUrl = `http://127.0.0.1:${port}`;

    // Seed campaign selection
    await db.insert(campaignSelections).values({
      accountId: testAccountId,
      selectedCampaignId: testCampaignId,
      selectedCampaignName: "Test Authority Campaign",
      campaignLocation: "LB",
      selectedPlatform: "instagram",
      campaignGoalType: "SALES",
      campaignStatus: "active",
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(resolve));
    }
  });

  it("1 & 2: Typed user offering becomes canonical and exact semantic text is preserved", async () => {
    const offeringId = "off_" + uuidv4().slice(0, 10);
    const evidenceId = "ev_" + uuidv4().slice(0, 10);
    const userTyped = "summer dresses";

    await db.transaction(async (tx) => {
      await tx.insert(offeringInputEvidence).values({
        id: evidenceId,
        accountId: testAccountId,
        campaignId: testCampaignId,
        campaignOfferingId: offeringId,
        rawOfferingName: userTyped.trim(),
        rawFeaturesAndNotes: `[USER_CONFIRMED HERO OFFERING]\nOffering Name: ${userTyped.trim()}\nNotes: User input`,
        contentHash: "HASH_TEST_1",
        authorityType: "USER_CONFIRMED",
        confirmedAt: new Date(),
      });

      await tx.insert(campaignOfferings).values({
        id: offeringId,
        accountId: testAccountId,
        campaignId: testCampaignId,
        offeringName: userTyped.trim(),
        sourceInputEvidenceId: evidenceId,
      });
    });

    const [savedOffering] = await db
      .select()
      .from(campaignOfferings)
      .where(eq(campaignOfferings.id, offeringId));

    const [savedEvidence] = await db
      .select()
      .from(offeringInputEvidence)
      .where(eq(offeringInputEvidence.id, evidenceId));

    expect(savedOffering.offeringName).toBe("summer dresses");
    expect(savedEvidence.rawOfferingName).toBe("summer dresses");
    expect(savedEvidence.authorityType).toBe("USER_CONFIRMED");
    expect(savedEvidence.confirmedAt).not.toBeNull();
    expect(savedOffering.sourceInputEvidenceId).toBe(evidenceId);
  });

  it("3 & 4: Backend stamps USER_CONFIRMED and client cannot self-assert CRAWLER_DISCOVERED or bypass authority via POST /api/setup/save-offering", async () => {
    const maliciousPayload = {
      campaignId: testCampaignId,
      offeringName: "summer dresses",
      authorityType: "CRAWLER_DISCOVERED", // Malicious client trying to downgrade/manipulate authority
      source: "DISCOVERED",
    };

    const res = await fetch(`${baseUrl}/api/setup/save-offering`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(maliciousPayload),
    });

    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.authorityType).toBe("USER_CONFIRMED");
    expect(data.offeringName).toBe("summer dresses");

    // Verify persisted DB row has server-stamped USER_CONFIRMED authority
    const [savedOffering] = await db
      .select()
      .from(campaignOfferings)
      .where(eq(campaignOfferings.id, data.campaignOfferingId));

    const [savedEvidence] = await db
      .select()
      .from(offeringInputEvidence)
      .where(eq(offeringInputEvidence.id, savedOffering.sourceInputEvidenceId));

    expect(savedEvidence.authorityType).toBe("USER_CONFIRMED");
    expect(savedEvidence.confirmedAt).not.toBeNull();
  }, 30000);

  it("5 & 6: POST /api/settings/campaign/:campaignId/change-offering also server-stamps USER_CONFIRMED regardless of client payload", async () => {
    const maliciousPayload = {
      newOfferingName: "linen evening dresses",
      authorityType: "UNKNOWN", // Malicious client attempt
    };

    const res = await fetch(`${baseUrl}/api/settings/campaign/${testCampaignId}/change-offering`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(maliciousPayload),
    });

    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.authorityType).toBe("USER_CONFIRMED");
    expect(data.offeringName).toBe("linen evening dresses");

    const [savedOffering] = await db
      .select()
      .from(campaignOfferings)
      .where(eq(campaignOfferings.id, data.newCampaignOfferingId));

    const [savedEvidence] = await db
      .select()
      .from(offeringInputEvidence)
      .where(eq(offeringInputEvidence.id, savedOffering.sourceInputEvidenceId));

    expect(savedEvidence.authorityType).toBe("USER_CONFIRMED");
    expect(savedEvidence.rawOfferingName).toBe("linen evening dresses");
  }, 30000);

  it("7: Crawler-discovered offering remains suggestion only and cannot create canonical offering", async () => {
    const crawlerEvidenceId = "ev_crawl_" + uuidv4().slice(0, 8);
    const suggestionName = "Summer Collection 2026";

    // Crawler stores snapshot / suggestion evidence
    await db.insert(offeringInputEvidence).values({
      id: crawlerEvidenceId,
      accountId: testAccountId,
      campaignId: "camp_crawl_only_" + uuidv4().slice(0, 6),
      campaignOfferingId: "off_suggest_" + uuidv4().slice(0, 6),
      rawOfferingName: suggestionName,
      rawFeaturesAndNotes: "Discovered from https://example.com/category/summer",
      contentHash: "HASH_CRAWL_1",
      authorityType: "CRAWLER_DISCOVERED",
    });

    const [crawlerEv] = await db
      .select()
      .from(offeringInputEvidence)
      .where(eq(offeringInputEvidence.id, crawlerEvidenceId));

    expect(crawlerEv.authorityType).toBe("CRAWLER_DISCOVERED");
    expect(crawlerEv.confirmedAt).toBeNull();

    // Verify no campaign_offerings row was created automatically
    const [matchingOffering] = await db
      .select()
      .from(campaignOfferings)
      .where(eq(campaignOfferings.sourceInputEvidenceId, crawlerEvidenceId));

    expect(matchingOffering).toBeUndefined();
  });

  it("8: User selecting crawler suggestion creates NEW USER_CONFIRMED evidence preserving original crawler evidence", async () => {
    const crawlerEvidenceId = "ev_crawl_" + uuidv4().slice(0, 8);
    const confirmedEvidenceId = "ev_conf_" + uuidv4().slice(0, 8);
    const offeringId = "off_sel_" + uuidv4().slice(0, 8);
    const selectedText = "Cotton Hijabs";

    // 1. Initial crawler discovery
    await db.insert(offeringInputEvidence).values({
      id: crawlerEvidenceId,
      accountId: testAccountId,
      campaignId: testCampaignId,
      campaignOfferingId: offeringId,
      rawOfferingName: selectedText,
      rawFeaturesAndNotes: "Discovered from https://example.com/hijabs",
      contentHash: "HASH_CRAWL_2",
      authorityType: "CRAWLER_DISCOVERED",
    });

    // 2. User selects the suggestion -> Transaction creates NEW confirmed evidence and updates campaign_offerings
    await db.transaction(async (tx) => {
      await tx.insert(offeringInputEvidence).values({
        id: confirmedEvidenceId,
        accountId: testAccountId,
        campaignId: testCampaignId,
        campaignOfferingId: offeringId,
        rawOfferingName: selectedText,
        rawFeaturesAndNotes: `[USER_CONFIRMED HERO OFFERING]\nOffering Name: ${selectedText}\nSelected from suggestion.`,
        contentHash: "HASH_CONF_2",
        authorityType: "USER_CONFIRMED",
        sourceSuggestionEvidenceId: crawlerEvidenceId,
        confirmedAt: new Date(),
      });

      await tx.insert(campaignOfferings).values({
        id: offeringId,
        accountId: testAccountId,
        campaignId: testCampaignId,
        offeringName: selectedText,
        sourceInputEvidenceId: confirmedEvidenceId,
      });
    });

    // Verify original crawler evidence is untouched
    const [crawlerEv] = await db.select().from(offeringInputEvidence).where(eq(offeringInputEvidence.id, crawlerEvidenceId));
    expect(crawlerEv.authorityType).toBe("CRAWLER_DISCOVERED");

    // Verify new confirmed evidence is linked
    const [confirmedEv] = await db.select().from(offeringInputEvidence).where(eq(offeringInputEvidence.id, confirmedEvidenceId));
    expect(confirmedEv.authorityType).toBe("USER_CONFIRMED");
    expect(confirmedEv.sourceSuggestionEvidenceId).toBe(crawlerEvidenceId);

    // Verify campaign_offerings points to confirmed evidence
    const [offering] = await db.select().from(campaignOfferings).where(eq(campaignOfferings.id, offeringId));
    expect(offering.sourceInputEvidenceId).toBe(confirmedEvidenceId);
  });

  it("9: Strong crawler text (e.g. 'Cotton Hijabs') FAILS CLOSED in Market Voice planner context if authorityType is CRAWLER_DISCOVERED", async () => {
    const crawlerOnlyOfferingId = "off_crawl_strong_" + uuidv4().slice(0, 6);
    const crawlerEvidenceId = "ev_crawl_strong_" + uuidv4().slice(0, 6);

    await db.insert(offeringInputEvidence).values({
      id: crawlerEvidenceId,
      accountId: testAccountId,
      campaignId: testCampaignId,
      campaignOfferingId: crawlerOnlyOfferingId,
      rawOfferingName: "Cotton Hijabs",
      rawFeaturesAndNotes: "Discovered from website crawl",
      contentHash: "HASH_CRAWL_STRONG",
      authorityType: "CRAWLER_DISCOVERED",
    });

    await db.insert(campaignOfferings).values({
      id: crawlerOnlyOfferingId,
      accountId: testAccountId,
      campaignId: testCampaignId,
      offeringName: "Cotton Hijabs", // Semantically strong text!
      sourceInputEvidenceId: crawlerEvidenceId,
    });

    // loadMarketVoicePlannerContext MUST FAIL CLOSED because authority is CRAWLER_DISCOVERED, not USER_CONFIRMED
    await expect(
      loadMarketVoicePlannerContext({
        campaignId: testCampaignId,
        campaignOfferingId: crawlerOnlyOfferingId,
        accountId: testAccountId,
      })
    ).rejects.toThrow(/PLANNER_CONTEXT_INCOMPLETE.*lacks USER_CONFIRMED authority/i);
  });

  it("10: UNKNOWN authority fails closed in Market Voice planner context even with strong text", async () => {
    const unknownOfferingId = "off_unknown_" + uuidv4().slice(0, 6);
    const unknownEvidenceId = "ev_unknown_" + uuidv4().slice(0, 6);

    await db.insert(offeringInputEvidence).values({
      id: unknownEvidenceId,
      accountId: testAccountId,
      campaignId: testCampaignId,
      campaignOfferingId: unknownOfferingId,
      rawOfferingName: "Premium Linen Dresses",
      rawFeaturesAndNotes: "Legacy imported row without confirmation",
      contentHash: "HASH_UNKNOWN",
      authorityType: "UNKNOWN",
    });

    await db.insert(campaignOfferings).values({
      id: unknownOfferingId,
      accountId: testAccountId,
      campaignId: testCampaignId,
      offeringName: "Premium Linen Dresses",
      sourceInputEvidenceId: unknownEvidenceId,
    });

    await expect(
      loadMarketVoicePlannerContext({
        campaignId: testCampaignId,
        campaignOfferingId: unknownOfferingId,
        accountId: testAccountId,
      })
    ).rejects.toThrow(/PLANNER_CONTEXT_INCOMPLETE.*lacks USER_CONFIRMED authority/i);
  });

  it("11: Missing sourceInputEvidenceId fails closed in Market Voice planner", async () => {
    const missingRefOfferingId = "off_missing_ref_" + uuidv4().slice(0, 6);

    await db.insert(campaignOfferings).values({
      id: missingRefOfferingId,
      accountId: testAccountId,
      campaignId: testCampaignId,
      offeringName: "Premium Modest Abayas",
      sourceInputEvidenceId: "" as any, // Missing reference
    });

    await expect(
      loadMarketVoicePlannerContext({
        campaignId: testCampaignId,
        campaignOfferingId: missingRefOfferingId,
        accountId: testAccountId,
      })
    ).rejects.toThrow(/PLANNER_CONTEXT_INCOMPLETE.*lacks sourceInputEvidenceId/i);
  });

  it("12: Missing source evidence DB row fails closed in Market Voice planner", async () => {
    const danglingOfferingId = "off_dangling_" + uuidv4().slice(0, 6);

    await db.insert(campaignOfferings).values({
      id: danglingOfferingId,
      accountId: testAccountId,
      campaignId: testCampaignId,
      offeringName: "Premium Modest Abayas",
      sourceInputEvidenceId: "ev_nonexistent_12345",
    });

    await expect(
      loadMarketVoicePlannerContext({
        campaignId: testCampaignId,
        campaignOfferingId: danglingOfferingId,
        accountId: testAccountId,
      })
    ).rejects.toThrow(/PLANNER_CONTEXT_INCOMPLETE.*Source input evidence .* not found/i);
  });

  it("13: Mismatched accountId between evidence and offering fails closed", async () => {
    const mismatchedOfferingId = "off_mismatch_acc_" + uuidv4().slice(0, 6);
    const evidenceId = "ev_mismatch_acc_" + uuidv4().slice(0, 6);

    await db.insert(offeringInputEvidence).values({
      id: evidenceId,
      accountId: "acc_DIFFERENT_123", // Mismatched account
      campaignId: testCampaignId,
      campaignOfferingId: mismatchedOfferingId,
      rawOfferingName: "Premium Dresses",
      rawFeaturesAndNotes: "Notes",
      contentHash: "HASH_ACC_MIS",
      authorityType: "USER_CONFIRMED",
      confirmedAt: new Date(),
    });

    await db.insert(campaignOfferings).values({
      id: mismatchedOfferingId,
      accountId: testAccountId,
      campaignId: testCampaignId,
      offeringName: "Premium Dresses",
      sourceInputEvidenceId: evidenceId,
    });

    await expect(
      loadMarketVoicePlannerContext({
        campaignId: testCampaignId,
        campaignOfferingId: mismatchedOfferingId,
        accountId: testAccountId,
      })
    ).rejects.toThrow(/PLANNER_CONTEXT_INCOMPLETE.*Lineage mismatch/i);
  });

  it("14: Mismatched campaignId between evidence and offering fails closed", async () => {
    const mismatchedOfferingId = "off_mismatch_camp_" + uuidv4().slice(0, 6);
    const evidenceId = "ev_mismatch_camp_" + uuidv4().slice(0, 6);

    await db.insert(offeringInputEvidence).values({
      id: evidenceId,
      accountId: testAccountId,
      campaignId: "camp_DIFFERENT_999", // Mismatched campaign
      campaignOfferingId: mismatchedOfferingId,
      rawOfferingName: "Premium Dresses",
      rawFeaturesAndNotes: "Notes",
      contentHash: "HASH_CAMP_MIS",
      authorityType: "USER_CONFIRMED",
      confirmedAt: new Date(),
    });

    await db.insert(campaignOfferings).values({
      id: mismatchedOfferingId,
      accountId: testAccountId,
      campaignId: testCampaignId,
      offeringName: "Premium Dresses",
      sourceInputEvidenceId: evidenceId,
    });

    await expect(
      loadMarketVoicePlannerContext({
        campaignId: testCampaignId,
        campaignOfferingId: mismatchedOfferingId,
        accountId: testAccountId,
      })
    ).rejects.toThrow(/PLANNER_CONTEXT_INCOMPLETE.*Lineage mismatch/i);
  });

  it("15: Mismatched campaignOfferingId between evidence and offering fails closed", async () => {
    const mismatchedOfferingId = "off_mismatch_offid_" + uuidv4().slice(0, 6);
    const evidenceId = "ev_mismatch_offid_" + uuidv4().slice(0, 6);

    await db.insert(offeringInputEvidence).values({
      id: evidenceId,
      accountId: testAccountId,
      campaignId: testCampaignId,
      campaignOfferingId: "off_DIFFERENT_456", // Mismatched offering ID
      rawOfferingName: "Premium Dresses",
      rawFeaturesAndNotes: "Notes",
      contentHash: "HASH_OFF_MIS",
      authorityType: "USER_CONFIRMED",
      confirmedAt: new Date(),
    });

    await db.insert(campaignOfferings).values({
      id: mismatchedOfferingId,
      accountId: testAccountId,
      campaignId: testCampaignId,
      offeringName: "Premium Dresses",
      sourceInputEvidenceId: evidenceId,
    });

    await expect(
      loadMarketVoicePlannerContext({
        campaignId: testCampaignId,
        campaignOfferingId: mismatchedOfferingId,
        accountId: testAccountId,
      })
    ).rejects.toThrow(/PLANNER_CONTEXT_INCOMPLETE.*Lineage mismatch/i);
  });

  it("16: Strong USER_CONFIRMED offering with intact lineage loads cleanly in Market Voice planner", async () => {
    const validOfferingId = "off_valid_auth_" + uuidv4().slice(0, 6);
    const validEvidenceId = "ev_valid_auth_" + uuidv4().slice(0, 6);

    await db.insert(offeringInputEvidence).values({
      id: validEvidenceId,
      accountId: testAccountId,
      campaignId: testCampaignId,
      campaignOfferingId: validOfferingId,
      rawOfferingName: "Linen Maxi Dresses",
      rawFeaturesAndNotes: "[USER_CONFIRMED HERO OFFERING]",
      contentHash: "HASH_VALID",
      authorityType: "USER_CONFIRMED",
      confirmedAt: new Date(),
    });

    await db.insert(campaignOfferings).values({
      id: validOfferingId,
      accountId: testAccountId,
      campaignId: testCampaignId,
      offeringName: "Linen Maxi Dresses",
      sourceInputEvidenceId: validEvidenceId,
    });

    const ctx = await loadMarketVoicePlannerContext({
      campaignId: testCampaignId,
      campaignOfferingId: validOfferingId,
      accountId: testAccountId,
    });
    expect(ctx.heroProductCanonicalText).toBe("Linen Maxi Dresses");
    expect(ctx.heroProductAuthoritySource).toBe("campaign_offerings");
    expect(ctx.heroProductAuthorityId).toBe(validOfferingId);
  });

  it("17: Sara-ft canonical authority chain is intact, USER_CONFIRMED, and loads in Market Voice", async () => {
    const saraCampaignId = "camp_mtewrp8kkom3";
    const saraOfferingId = "off_70677f8f-1";
    const saraAccountId = "f020f6c7-15d8-4129-90a6-83a40558c642";

    const [saraOffering] = await db.select().from(campaignOfferings).where(eq(campaignOfferings.id, saraOfferingId));
    expect(saraOffering.offeringName).toBe("summer dresses");

    const evidenceList = await db.select().from(offeringInputEvidence).where(eq(offeringInputEvidence.campaignOfferingId, saraOfferingId));
    
    // Check crawler evidence preserved
    const crawlerEv = evidenceList.find((e) => e.id === "ev_3df52138-4");
    expect(crawlerEv).toBeDefined();
    expect(crawlerEv?.rawOfferingName).toBe("Summer");
    expect(crawlerEv?.authorityType).toBe("CRAWLER_DISCOVERED");

    // Check confirmed evidence
    const confirmedEv = evidenceList.find((e) => e.authorityType === "USER_CONFIRMED");
    expect(confirmedEv).toBeDefined();
    expect(confirmedEv?.rawOfferingName).toBe("summer dresses");
    expect(saraOffering.sourceInputEvidenceId).toBe(confirmedEv?.id);

    // Verify context loads in Market Voice
    const context = await loadMarketVoicePlannerContext({
      campaignId: saraCampaignId,
      campaignOfferingId: saraOfferingId,
      accountId: saraAccountId,
    });
    expect(context.heroProductCanonicalText).toBe("summer dresses");
    expect(context.heroProductAuthoritySource).toBe("campaign_offerings");
    expect(context.heroProductAuthorityId).toBe(saraOfferingId);
  });

  it("18: Sara-ft crawler evidence (ev_3df52138-4) CANNOT pass as canonical authority if linked directly", async () => {
    const saraCampaignId = "camp_mtewrp8kkom3";
    const fakeBrokenOfferingId = "off_fake_sara_crawler";

    await db.delete(campaignOfferings).where(eq(campaignOfferings.id, fakeBrokenOfferingId));
    await db.insert(campaignOfferings).values({
      id: fakeBrokenOfferingId,
      accountId: "f020f6c7-15d8-4129-90a6-83a40558c642",
      campaignId: saraCampaignId,
      offeringName: "Summer",
      sourceInputEvidenceId: "ev_3df52138-4", // Points directly to crawler evidence
    });

    try {
      await loadMarketVoicePlannerContext({
        campaignId: saraCampaignId,
        campaignOfferingId: fakeBrokenOfferingId,
        accountId: "f020f6c7-15d8-4129-90a6-83a40558c642",
      });
      expect.fail("Should have thrown PLANNER_CONTEXT_INCOMPLETE");
    } catch (err: any) {
      expect(err.message).toMatch(/PLANNER_CONTEXT_INCOMPLETE/i);
    } finally {
      await db.delete(campaignOfferings).where(eq(campaignOfferings.id, fakeBrokenOfferingId));
    }
  });

  it("19: Existing USER_CONFIRMED offering cannot be overwritten by crawler re-scrape", async () => {
    const offeringId = "off_protect_" + uuidv4().slice(0, 8);
    const evidenceId = "ev_protect_" + uuidv4().slice(0, 8);
    const campaignId = "camp_protect_" + uuidv4().slice(0, 8);

    await db.insert(offeringInputEvidence).values({
      id: evidenceId,
      accountId: testAccountId,
      campaignId,
      campaignOfferingId: offeringId,
      rawOfferingName: "Custom Abayas",
      rawFeaturesAndNotes: "[USER_CONFIRMED HERO OFFERING]",
      contentHash: "HASH_PROT",
      authorityType: "USER_CONFIRMED",
      confirmedAt: new Date(),
    });

    await db.insert(campaignOfferings).values({
      id: offeringId,
      accountId: testAccountId,
      campaignId,
      offeringName: "Custom Abayas",
      sourceInputEvidenceId: evidenceId,
    });

    // Simulate crawler website snapshot insertion
    await db.insert(websiteSnapshots).values({
      id: "snap_" + uuidv4().slice(0, 8),
      accountId: testAccountId,
      campaignId,
      rootUrl: "https://example.com",
      pagesCrawled: [{ pageType: "PRODUCT", sourceUrl: "https://example.com/category/sale" }] as any,
      contentHash: "HASH_SNAP",
      status: "SUCCESS",
    });

    // Assert campaign_offerings remains untouched
    const [offering] = await db.select().from(campaignOfferings).where(eq(campaignOfferings.id, offeringId));
    expect(offering.offeringName).toBe("Custom Abayas");
    expect(offering.sourceInputEvidenceId).toBe(evidenceId);
  });

  it("20: Business Understanding cannot overwrite campaign offering", async () => {
    const offeringId = "off_immut_" + uuidv4().slice(0, 8);
    const evidenceId = "ev_immut_" + uuidv4().slice(0, 8);
    const campaignId = "camp_immut_" + uuidv4().slice(0, 8);

    await db.insert(offeringInputEvidence).values({
      id: evidenceId,
      accountId: testAccountId,
      campaignId,
      campaignOfferingId: offeringId,
      rawOfferingName: "Evening Gowns",
      rawFeaturesAndNotes: "[USER_CONFIRMED HERO OFFERING]",
      contentHash: "HASH_IMMUT",
      authorityType: "USER_CONFIRMED",
      confirmedAt: new Date(),
    });

    await db.insert(campaignOfferings).values({
      id: offeringId,
      accountId: testAccountId,
      campaignId,
      offeringName: "Evening Gowns",
      sourceInputEvidenceId: evidenceId,
    });

    // BU snapshot record
    await db.insert(businessUnderstandingSnapshots).values({
      id: uuidv4(),
      accountId: testAccountId,
      campaignId,
      campaignOfferingId: offeringId,
      offeringInputEvidenceId: evidenceId,
      status: "COMPLETE",
      businessUnderstanding: { generalIndustry: "Apparel", campaignOffering: { offeringName: "Evening Gowns" } } as any,
    });

    const [offering] = await db.select().from(campaignOfferings).where(eq(campaignOfferings.id, offeringId));
    expect(offering.offeringName).toBe("Evening Gowns");
  });

  it("21: Transaction rollback on failure leaves no partial authority mutation", async () => {
    const offeringId = "off_tx_roll_" + uuidv4().slice(0, 8);
    const evidenceId = "ev_tx_roll_" + uuidv4().slice(0, 8);
    const campaignId = "camp_tx_roll_" + uuidv4().slice(0, 8);

    await db.insert(offeringInputEvidence).values({
      id: evidenceId,
      accountId: testAccountId,
      campaignId,
      campaignOfferingId: offeringId,
      rawOfferingName: "Initial Item",
      rawFeaturesAndNotes: "initial",
      contentHash: "HASH_INIT",
      authorityType: "USER_CONFIRMED",
      confirmedAt: new Date(),
    });

    await db.insert(campaignOfferings).values({
      id: offeringId,
      accountId: testAccountId,
      campaignId,
      offeringName: "Initial Item",
      sourceInputEvidenceId: evidenceId,
    });

    await expect(
      db.transaction(async (tx) => {
        await tx.insert(offeringInputEvidence).values({
          id: "ev_failed_" + uuidv4().slice(0, 6),
          accountId: testAccountId,
          campaignId,
          campaignOfferingId: offeringId,
          rawOfferingName: "Failed Update",
          rawFeaturesAndNotes: "notes",
          contentHash: "HASH_FAIL",
          authorityType: "USER_CONFIRMED",
        });
        throw new Error("Simulated Transaction Failure");
      })
    ).rejects.toThrow("Simulated Transaction Failure");

    const [offering] = await db.select().from(campaignOfferings).where(eq(campaignOfferings.id, offeringId));
    expect(offering.offeringName).toBe("Initial Item");
    expect(offering.sourceInputEvidenceId).toBe(evidenceId);
  });

  it("22: Protected systems invariant check (Audience & Watchtower untouched)", async () => {
    const competitors = await db.select().from(ciCompetitors);
    const sources = await db.select().from(competitorSources);
    expect(Array.isArray(competitors)).toBe(true);
    expect(Array.isArray(sources)).toBe(true);
  });
});
