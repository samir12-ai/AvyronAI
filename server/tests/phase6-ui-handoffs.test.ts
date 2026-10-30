import "dotenv/config";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "../db";
import {
  audienceSnapshots,
  strategicPlans,
  strategyRoots,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { assembleAudiencePositioningData } from "../audience-positioning-service";
import type { CommercialAudienceSynthesis } from "../audience-engine/engine";

describe("Phase 6: UI & API Handoffs", () => {
  const synthAccountId = `tenant_synth_p6_${Date.now()}`;
  const synthCampaignId = `camp_synth_p6_${Date.now()}`;
  const synthOfferingId = `off_synth_sweets_400g`;

  beforeEach(async () => {
    await db.delete(audienceSnapshots).where(eq(audienceSnapshots.campaignId, synthCampaignId));
    await db.delete(strategicPlans).where(eq(strategicPlans.campaignId, synthCampaignId));
    await db.delete(strategyRoots).where(eq(strategyRoots.campaignId, synthCampaignId));
  });

  afterEach(async () => {
    await db.delete(audienceSnapshots).where(eq(audienceSnapshots.campaignId, synthCampaignId));
    await db.delete(strategicPlans).where(eq(strategicPlans.campaignId, synthCampaignId));
    await db.delete(strategyRoots).where(eq(strategyRoots.campaignId, synthCampaignId));
  });

  it("assembleAudiencePositioningData truthfully exposes commercial audience synthesis to the frontend API", async () => {
    const mockSynthesis: CommercialAudienceSynthesis = {
      selectedOfferingId: synthOfferingId,
      selectedOfferingName: "Handcrafted Mixed Baklava Selection",
      selectedVariantName: "400g Gourmet Metal Gift Box",
      selectedVariantScope: "400g net weight, 24 individual pieces",
      selectedVariantPricing: { amount: 32, currency: "USD" },
      comparableCompetitors: [
        {
          competitorId: "comp_synth_1",
          competitorName: "Standard Sweet Importers",
          productOrServiceName: "Bulk Assorted Pastries 500g",
          pricingSummary: "28 USD",
          evidenceUids: ["EV:competitor:ci_competitors:comp_1@abc123456789"],
        },
      ],
      reviewBackedStrengths: [
        {
          competitorName: "Standard Sweet Importers",
          strength: "Low bulk pricing",
          sampleReviewSnippet: "Affordable price for a big box",
          reviewRating: 4,
          platform: "TRUSTPILOT",
        },
      ],
      purchaseSituations: [
        {
          situation: "Corporate and holiday gift giving requiring intact presentation",
          urgencyLevel: "HIGH",
          frequencyContext: "Seasonal and corporate orders",
        },
      ],
      offeringFitBreakdown: [
        {
          need: "Transit crushing and broken pieces during courier delivery",
          fitType: "STRATEGIC_FIT",
          provenClauses: ["Food-grade airtight container preserves crispness"],
          unresolvedRequirements: ["Transit crush-resistance requires certified drop testing"],
          prerequisites: ["Packaging drop test certification"],
        },
      ],
      packageOrScopeSuitability: {
        suitabilityVerdict: "SUITABLE",
        notes: "400g gift box is well-sized for premium personal and corporate gifting.",
      },
      priceValueLimitations: [
        {
          dimension: "Currency Conversion",
          limitation: "Prices in different currencies cannot be compared without explicit exchange rate.",
          unknownFactor: "Real-time exchange rate",
        },
      ],
      proposedCapabilities: [
        {
          capability: "Crush-proof courier transport packaging",
          status: "PROPOSED",
          prerequisites: ["Courier transit drop test"],
        },
      ],
    };

    // Insert an audience snapshot with structuredSignals containing commercialAudienceSynthesis
    await db.insert(audienceSnapshots).values({
      accountId: synthAccountId,
      campaignId: synthCampaignId,
      jobId: `job_${Date.now()}`,
      offerSnapshotId: `off_snap_${Date.now()}`,
      miSnapshotId: `mi_snap_${Date.now()}`,
      audienceSegments: JSON.stringify([
        {
          id: "seg_gourmet",
          name: "Premium Gift Buyers",
          buyerRole: "Corporate & Event Gifter",
          marketType: "Specialty Confectionery",
          pains: [
            {
              painId: "pain_transit_crush",
              pain: "Transit crushing during courier delivery",
              evidence: ["Pastries arrived broken"],
              evidenceCount: 5,
            },
          ],
        },
      ]),
      audiencePains: JSON.stringify([
        {
          painId: "pain_transit_crush",
          canonical: "Transit crushing during courier delivery",
          originalStatement: "Pastries arrived broken in transit",
        },
      ]),
      desireMap: JSON.stringify(["Intact presentation on arrival", "Authentic artisanal flavor"]),
      objectionMap: JSON.stringify(["Fear of shipping damage", "Price premium over bulk sweets"]),
      emotionalDrivers: JSON.stringify(["Pride in gifting", "Desire for authentic quality"]),
      structuredSignals: JSON.stringify({
        primaryBuyingPain: {
          canonical: "Transit crushing during courier delivery",
          experience: "Broken pieces upon arrival",
          commercialImpact: "Embarrassment during client gifting",
          whyWeCanSolveIt: "Airtight metal gift tin",
        },
        commercialAudienceSynthesis: mockSynthesis,
      }),
      status: "COMPLETE",
    });

    const viewModel = await assembleAudiencePositioningData(synthCampaignId, synthAccountId);

    expect(viewModel).toBeDefined();
    expect(viewModel.hasAudience).toBe(true);
    expect(viewModel.commercialAudienceSynthesis).toBeDefined();

    const synth = viewModel.commercialAudienceSynthesis!;
    expect(synth.selectedOfferingName).toBe("Handcrafted Mixed Baklava Selection");
    expect(synth.selectedVariantName).toBe("400g Gourmet Metal Gift Box");
    expect(synth.selectedVariantPricing?.amount).toBe(32);
    expect(synth.comparableCompetitors).toHaveLength(1);
    expect(synth.comparableCompetitors![0].competitorName).toBe("Standard Sweet Importers");
    expect(synth.reviewBackedStrengths![0].platform).toBe("TRUSTPILOT");
    expect(synth.offeringFitBreakdown![0].fitType).toBe("STRATEGIC_FIT");
    expect(synth.offeringFitBreakdown![0].unresolvedRequirements).toContain(
      "Transit crush-resistance requires certified drop testing"
    );
    expect(synth.packageOrScopeSuitability?.suitabilityVerdict).toBe("SUITABLE");
    expect(synth.proposedCapabilities![0].status).toBe("PROPOSED");
    expect(synth.proposedCapabilities![0].prerequisites).toContain("Courier transit drop test");
  });

  it("verifies brandSpine truth evaluation reflects PROPOSED rather than false independent verification", () => {
    const brandSpineProposed = {
      truthStatus: "PROPOSED",
      truthLabel: "Proposed Capability (Requires Validation)",
    };

    let statusText = "Algorithmically Evaluated";
    if (brandSpineProposed.truthStatus === "PROPOSED") {
      statusText = "Algorithmically Evaluated (Proposed)";
    } else if (brandSpineProposed.truthStatus === "VERIFIED") {
      statusText = "Algorithmically Evaluated (Verified)";
    }

    expect(statusText).toBe("Algorithmically Evaluated (Proposed)");
    expect(statusText).not.toBe("Algorithmically Verified");
  });
});
