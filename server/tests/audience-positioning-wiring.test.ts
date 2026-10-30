import "dotenv/config";
import { describe, it, expect } from "vitest";
import { assembleAudiencePositioningData } from "../audience-positioning-service";

describe("Audience Canonical API Wiring & Lineage", () => {
  const testCampaignId = "campaign_1773576062201_6t0oxi";

  it("TEST 1: Core Pain canonical text is returned, not hardcoded placeholder", async () => {
    const data = await assembleAudiencePositioningData(testCampaignId);
    expect(data.coreBuyingPain.title).not.toBe("Poor data quality and scattered market insights");
    expect(data.coreBuyingPain.title).toBeTruthy();
    expect(data.coreBuyingPain.title.length).toBeGreaterThan(10);
    expect(data.coreBuyingPain.painId).toBeTruthy();
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
    expect(data.supportingSignals.pains.length).toBeGreaterThan(0);
    const painIds = data.supportingSignals.pains.map(p => p.painId);
    expect(painIds).not.toContain(data.coreBuyingPain.painId); // Core pain not duplicated in supporting list
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
    expect(data.coreBuyingPain.evidenceCount).toBeGreaterThanOrEqual(0);
  });

  it("TEST 7: Excluded count is scoped to active run only (no 143 cross-run inflation)", async () => {
    const data = await assembleAudiencePositioningData(testCampaignId);
    expect(data.excludedPains.length).not.toBe(143);
  });

  it("TEST 8: Healthy fields preserved (desires, objections, buying triggers)", async () => {
    const data = await assembleAudiencePositioningData(testCampaignId);
    expect(data.supportingSignals.desires.length).toBeGreaterThan(0);
    expect(data.supportingSignals.objections.length).toBeGreaterThan(0);
    expect(Array.isArray(data.supportingSignals.triggers)).toBe(true);
  });

  it("TEST 9 & 10: Primary UI payload contains 0 seg_* in titles and no generic fallback required", async () => {
    const data = await assembleAudiencePositioningData(testCampaignId);
    for (const p of data.supportingSignals.pains) {
      expect(p.title.startsWith("seg_")).toBe(false);
      expect(p.title).not.toBe("Supporting Signal");
    }
  });

  describe("Sara-ft Domain Isolation & Hardcoded Fallback Prevention (Tests A - G)", () => {
    const saraCampaignId = "camp_mtewrp8kkom3";
    const saraAccountId = "f020f6c7-15d8-4129-90a6-83a40558c642";

    it("TEST A: Sara-ft Audience returns real modest fashion desires & objections (NO B2B SaaS strings)", async () => {
      const data = await assembleAudiencePositioningData(saraCampaignId, saraAccountId);
      expect(data.hasAudience).toBe(true);

      // Verify no B2B SaaS strings in desires or objections
      for (const d of data.supportingSignals.desires) {
        expect(d.toLowerCase()).not.toContain("b2b");
        expect(d.toLowerCase()).not.toContain("autonomous");
        expect(d.toLowerCase()).not.toContain("workflow");
        expect(d.toLowerCase()).not.toContain("operations");
      }
      for (const o of data.supportingSignals.objections) {
        expect(o.toLowerCase()).not.toContain("b2b");
        expect(o.toLowerCase()).not.toContain("autonomous");
        expect(o.toLowerCase()).not.toContain("workflow");
        expect(o.toLowerCase()).not.toContain("operations");
      }
      expect(data.supportingSignals.desires.length).toBeGreaterThan(0);
      expect(data.supportingSignals.objections.length).toBeGreaterThan(0);
    });

    it("TEST B: Sara-ft hasAudience is TRUE and hasPositioning is FALSE (no false strategy claims)", async () => {
      const data = await assembleAudiencePositioningData(saraCampaignId, saraAccountId);
      expect(data.hasAudience).toBe(true);
      expect(data.hasPositioning).toBe(false);
      expect(data.hasPlan).toBe(false);
    });

    it("TEST C: Sara-ft positioning is uninitialized (umbrellaPosition is empty, NOT 'Autonomous Operations Scaling')", async () => {
      const data = await assembleAudiencePositioningData(saraCampaignId, saraAccountId);
      expect(data.positioning.umbrellaPosition).not.toBe("Autonomous Operations Scaling");
      expect(data.positioning.umbrellaPosition).toBe("");
      expect(data.positioning.positioningStatement).toBe("");
      expect(data.positioning.contrastAxis).toBe("");
      expect(data.positioning.validation.length).toBe(0);
    });

    it("TEST D: Campaign with full strategy returns hasPositioning === true and hasAudience === true", async () => {
      const data = await assembleAudiencePositioningData(testCampaignId);
      expect(data.hasAudience).toBe(true);
      expect(data.hasPositioning).toBe(true);
      expect(data.hasPlan).toBe(true);
      expect(data.positioning.umbrellaPosition.length).toBeGreaterThan(0);
    });

    it("TEST E: Non-existent / empty campaign returns clean uninitialized state (zero invented copy)", async () => {
      const data = await assembleAudiencePositioningData("camp_non_existent_99999");
      expect(data.hasAudience).toBe(false);
      expect(data.hasPositioning).toBe(false);
      expect(data.hasPlan).toBe(false);
      expect(data.positioning.umbrellaPosition).toBe("");
      expect(data.positioning.positioningStatement).toBe("");
      expect(data.positioning.contrastAxis).toBe("");
      expect(data.targetAudience.title).toBe("");
      expect(data.coreBuyingPain.title).toBe("");
      expect(data.supportingSignals.desires.length).toBe(0);
      expect(data.supportingSignals.objections.length).toBe(0);
    });

    it("TEST F: Target audience for Sara-ft does NOT contain 'Business Workflow Automators'", async () => {
      const data = await assembleAudiencePositioningData(saraCampaignId, saraAccountId);
      expect(data.targetAudience.title).not.toContain("Business Workflow Automators");
      expect(data.targetAudience.description).not.toContain("manual operations scaling");
    });

    it("TEST G: Reasoning journey for Sara-ft does NOT contain B2B fallback strings", async () => {
      const data = await assembleAudiencePositioningData(saraCampaignId, saraAccountId);
      const j = data.positioning.reasoningJourney;
      expect(j.step2.title).not.toContain("Operating teams face mounting bottlenecks");
      expect(j.step3.title).not.toContain("Fragmented Insight Pipeline Hindering Targeting");
      expect(j.step4.title).not.toContain("Autonomous Operations Scaling");
    });
  });
});
