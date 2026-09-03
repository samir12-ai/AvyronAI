import "dotenv/config";
import { describe, it, expect } from "vitest";
import { assembleAudiencePositioningData } from "../audience-positioning-service";

describe("Audience Canonical API Wiring & Lineage", () => {
  const testCampaignId = "campaign_1773576062201_6t0oxi";

  it("TEST 1: Core Pain canonical text is returned, not hardcoded placeholder", async () => {
    const data = await assembleAudiencePositioningData(testCampaignId);
    expect(data.coreBuyingPain.title).not.toBe("Poor data quality and scattered market insights");
    expect(data.coreBuyingPain.title).toBe("Challenges in scaling operations without constant manual intervention and oversight.");
    expect(data.coreBuyingPain.painId).toBe("seg_3_pain_1");
  });

  it("TEST 2: Supporting Pain titles equal canonical human-readable pain text with 0 seg_* in titles", async () => {
    const data = await assembleAudiencePositioningData(testCampaignId);
    expect(data.supportingSignals.pains.length).toBeGreaterThan(0);
    for (const p of data.supportingSignals.pains) {
      expect(p.title).not.toMatch(/^seg_\d+_pain_\d+$/i);
      expect(p.title.length).toBeGreaterThan(10);
    }
  });

  it("TEST 3: Active canonical portfolio only (no historical 255 SPD rows leaking into primary strategy)", async () => {
    const data = await assembleAudiencePositioningData(testCampaignId);
    // Active Strategy Root has 2 supporting pains (seg_1_pain_1 and seg_2_pain_1)
    expect(data.supportingSignals.pains.length).toBe(2);
    const painIds = data.supportingSignals.pains.map(p => p.painId);
    expect(painIds).toContain("seg_1_pain_1");
    expect(painIds).toContain("seg_2_pain_1");
    expect(painIds).not.toContain("seg_3_pain_1"); // Core pain not duplicated in supporting list
  });

  it("TEST 4: Decision History / SPD rows are scoped to active orchestrator run", async () => {
    const data = await assembleAudiencePositioningData(testCampaignId);
    // Excluded claims scoped to active run
    expect(data.excludedPains.length).toBeLessThan(50); // No 143 cross-run accumulation
  });

  it("TEST 5: No raw SPD reason as business description in primary supporting pains", async () => {
    const data = await assembleAudiencePositioningData(testCampaignId);
    for (const p of data.supportingSignals.pains) {
      if (p.description) {
        expect(p.description).not.toContain("The Target Relationship is COVERED");
        expect(p.description).not.toContain("The Product Relationship is DIRECT_FIT");
        expect(p.description).not.toContain("Pain Materiality");
      }
    }
  });

  it("TEST 6: No fake citation floor (actual citation count used, not static 12 minimum)", async () => {
    const data = await assembleAudiencePositioningData(testCampaignId);
    expect(data.coreBuyingPain.evidenceCount).toBeDefined();
    // Actual citation count for active core pain seg_3_pain_1 is 3
    expect(data.coreBuyingPain.evidenceCount).toBe(3);
  });

  it("TEST 7: Excluded count is scoped to active run only (no 143 cross-run inflation)", async () => {
    const data = await assembleAudiencePositioningData(testCampaignId);
    expect(data.excludedPains.length).not.toBe(143);
  });

  it("TEST 8: Healthy fields preserved (desires, objections, buying triggers)", async () => {
    const data = await assembleAudiencePositioningData(testCampaignId);
    expect(data.supportingSignals.desires).toEqual([
      "Scale operations with minimal manual intervention",
      "Automate repetitive tasks to focus on strategic decisions",
      "Leverage reliable, connected data for actionable insights",
    ]);
    expect(data.supportingSignals.objections).toEqual([
      "Concerns about losing operational control with automation",
      "Skepticism about data reliability and integration",
      "Fear of complexity in implementing autonomous systems",
    ]);
    expect(data.supportingSignals.triggers.length).toBeGreaterThan(0);
  });

  it("TEST 9 & 10: Primary UI payload contains 0 seg_* in titles and no generic fallback required", async () => {
    const data = await assembleAudiencePositioningData(testCampaignId);
    for (const p of data.supportingSignals.pains) {
      expect(p.title.startsWith("seg_")).toBe(false);
      expect(p.title).not.toBe("Supporting Signal");
    }
  });
});
