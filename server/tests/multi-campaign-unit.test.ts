import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PROPOSED_PACKAGE_CATALOG } from "../entitlements";
import { runWithAiCampaignContext, getCurrentAiCampaignContext } from "../ai-client";
import { REQUIRED_SCHEMA_VERSION } from "../migrations/runner";
import * as schema from "@shared/schema";

describe("Multi-Campaign Offline Unit & Schema Contract Verification (Zero DB / Zero Network)", () => {
  it("1. Exposes REQUIRED_SCHEMA_VERSION = 72 and migration 072 SQL without production customer entitlement upgrades", () => {
    expect(REQUIRED_SCHEMA_VERSION).toBe(72);

    const migPath = path.resolve(
      process.cwd(),
      "server/migrations/sql/072_multi_campaign_product_isolation.sql"
    );
    expect(fs.existsSync(migPath)).toBe(true);

    const sqlText = fs.readFileSync(migPath, "utf8");
    expect(sqlText).toContain("CREATE TABLE IF NOT EXISTS businesses");
    expect(sqlText).toContain("CREATE TABLE IF NOT EXISTS business_products");
    expect(sqlText).toContain("CREATE TABLE IF NOT EXISTS competitor_relevance_decisions");
    expect(sqlText).toContain("CREATE TABLE IF NOT EXISTS account_entitlements");

    // Verify migration 072 does not hardcode upgrading Songai's account to 'agency' in production
    const entitlementSection = sqlText.split("INSERT INTO account_entitlements")[1] || "";
    expect(entitlementSection).not.toContain("ce5c11b9-9a9a-499c-a4f8-b75e6ec6055f");
  });

  it("2. Defines proposed package catalog tiers (Starter $199/1, Growth $399/2, Agency $699/4, Test Isolated $0/4)", () => {
    expect(PROPOSED_PACKAGE_CATALOG.starter).toMatchObject({
      tier: "starter",
      monthlyPriceUsd: 199,
      maxActiveCampaigns: 1,
    });
    expect(PROPOSED_PACKAGE_CATALOG.growth).toMatchObject({
      tier: "growth",
      monthlyPriceUsd: 399,
      maxActiveCampaigns: 2,
    });
    expect(PROPOSED_PACKAGE_CATALOG.agency).toMatchObject({
      tier: "agency",
      monthlyPriceUsd: 699,
      maxActiveCampaigns: 4,
    });
    expect(PROPOSED_PACKAGE_CATALOG.test_isolated).toMatchObject({
      tier: "test_isolated",
      monthlyPriceUsd: 0,
      maxActiveCampaigns: 4,
    });
  });

  it("3. Isolates concurrent AI campaign contexts via AsyncLocalStorage without cross-campaign bleed", async () => {
    expect(getCurrentAiCampaignContext()).toBeUndefined();

    const [ctxA, ctxB] = await Promise.all([
      runWithAiCampaignContext(
        {
          accountId: "acc_test_1",
          campaignId: "camp_alpha",
          operationType: "ORCHESTRATOR_PIPELINE",
        },
        async () => {
          await new Promise((r) => setTimeout(r, 10));
          return getCurrentAiCampaignContext();
        }
      ),
      runWithAiCampaignContext(
        {
          accountId: "acc_test_1",
          campaignId: "camp_beta",
          operationType: "COMPETITOR_DISCOVERY",
        },
        async () => {
          await new Promise((r) => setTimeout(r, 5));
          return getCurrentAiCampaignContext();
        }
      ),
    ]);

    expect(ctxA?.campaignId).toBe("camp_alpha");
    expect(ctxA?.operationType).toBe("ORCHESTRATOR_PIPELINE");
    expect(ctxB?.campaignId).toBe("camp_beta");
    expect(ctxB?.operationType).toBe("COMPETITOR_DISCOVERY");
    expect(getCurrentAiCampaignContext()).toBeUndefined();
  });

  it("4. Exports all multi-campaign Drizzle tables and columns", () => {
    expect(schema.businesses).toBeDefined();
    expect(schema.businessProducts).toBeDefined();
    expect(schema.competitorRelevanceDecisions).toBeDefined();
    expect(schema.accountEntitlements).toBeDefined();
    expect(schema.campaignSelections.businessId).toBeDefined();
    expect(schema.campaignSelections.productId).toBeDefined();
    expect(schema.campaignOfferings.productId).toBeDefined();
    expect(schema.businessUnderstandingSnapshots.companyFacts).toBeDefined();
    expect(schema.businessUnderstandingSnapshots.productFacts).toBeDefined();
    expect(schema.businessUnderstandingSnapshots.campaignChoices).toBeDefined();
    expect(schema.aiUsageLog.campaignId).toBeDefined();
    expect(schema.aiUsageLog.attributionPolicy).toBeDefined();
  });
});
