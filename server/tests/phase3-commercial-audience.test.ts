import "dotenv/config";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "../db";
import { audienceSnapshots } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import {
  buildCommercialAudienceSynthesis,
  getLatestAudienceSnapshot,
  type CommercialAudienceSynthesis,
  type StructuredSignals,
} from "../audience-engine/engine";

describe("Phase 3: Audience Commercial Synthesis & Persistence", () => {
  const synthAccountId = `tenant_synth_p3_${Date.now()}`;
  const synthCampaignId = `camp_synth_p3_${Date.now()}`;
  const synthOfferingId = `off_synth_sweets_400g`;

  beforeEach(async () => {
    await db.delete(audienceSnapshots).where(eq(audienceSnapshots.campaignId, synthCampaignId));
  });

  afterEach(async () => {
    await db.delete(audienceSnapshots).where(eq(audienceSnapshots.campaignId, synthCampaignId));
  });

  it("builds complete commercial audience synthesis with partial fit and unresolved requirements", () => {
    const mockBu = {
      offerings: [
        {
          id: synthOfferingId,
          offeringName: "Handcrafted Mixed Baklava Selection",
          variantName: "400g Gourmet Metal Gift Box",
          scope: "400g net weight, 24 individual pieces",
          pricing: { amount: 32, currency: "USD" },
        },
      ],
      competitors: [
        {
          id: "comp_synth_confectionery_a",
          name: "Standard Sweet Importers",
          productName: "Bulk Assorted Pastries 500g",
          pricing: "28 USD",
        },
      ],
    };

    const mockPains = [
      {
        canonical: "Transit crushing and broken pieces during courier delivery",
        frequency: 8,
        confidenceScore: 0.85,
        evidence: ["Box arrived crushed", "Corner pastries were smashed"],
        sourceSignals: ["reviews"],
        inputSnapshotId: null,
        evidenceCount: 8,
      },
      {
        canonical: "Uncertain freshness compared to warehouse stored inventory",
        frequency: 5,
        confidenceScore: 0.75,
        evidence: ["Felt stale, seemed to sit on shelf for weeks"],
        sourceSignals: ["reviews"],
        inputSnapshotId: null,
        evidenceCount: 5,
      },
    ];

    const mockEvidenceUnits = [
      {
        id: "ev_rev_1",
        text: "The pistachios tasted premium and very aromatic.",
        rating: 5,
        sentiment: "POSITIVE",
        competitorId: "comp_synth_confectionery_a",
      },
    ];

    const mockProductTruthFacts = [
      {
        statement: "Packaged in food-grade protective decorative tin box",
        verifiedCapability: "Decorative metal box with inner food-grade lining",
      },
      {
        statement: "Daily artisanal production and dispatch from central bakery",
        verifiedCapability: "Fresh preparation on day of dispatch",
      },
    ];

    const synthesis = buildCommercialAudienceSynthesis({
      businessUnderstanding: mockBu,
      selectedOfferingId: synthOfferingId,
      painMap: mockPains as any,
      evidenceUnits: mockEvidenceUnits as any,
      productTruthFacts: mockProductTruthFacts,
    });

    // 1. Verify offering and variant
    expect(synthesis.selectedOffering.offeringId).toBe(synthOfferingId);
    expect(synthesis.selectedOffering.variantName).toBe("400g Gourmet Metal Gift Box");
    expect(synthesis.selectedOffering.scope).toContain("400g");

    // 2. Verify competitor evidence & review-backed strengths
    expect(synthesis.comparableCompetitors.length).toBe(1);
    expect(synthesis.comparableCompetitors[0].competitorName).toBe("Standard Sweet Importers");
    expect(synthesis.comparableCompetitors[0].strengthsSupportedByReviews.length).toBe(1);
    expect(synthesis.comparableCompetitors[0].strengthsSupportedByReviews[0]).toContain("premium");

    // 3. Verify transit damage fit is STRATEGIC_FIT (not DIRECT_FIT) with unresolved requirement
    const transitFit = synthesis.offeringNeedFit.find(f => f.need.includes("Transit crushing"));
    expect(transitFit).toBeDefined();
    expect(transitFit?.fitLevel).toBe("STRATEGIC_FIT");
    expect(transitFit?.partialSupportReason).toContain("does not guarantee crush-proof courier transit");
    expect(transitFit?.unresolvedRequirements.length).toBeGreaterThan(0);
    expect(transitFit?.unresolvedRequirements[0]).toContain("Crush-resistant outer courier packaging");

    // 4. Verify freshness fit preserves comparison limitations
    const freshnessFit = synthesis.offeringNeedFit.find(f => f.need.includes("freshness"));
    expect(freshnessFit).toBeDefined();
    expect(freshnessFit?.fitLevel).toBe("STRATEGIC_FIT");
    expect(freshnessFit?.unresolvedRequirements[0]).toContain("Competitor storage/handling evidence");

    // 5. Verify price/value limitations and proposed improvement prerequisites
    expect(synthesis.priceValueAnalysis.comparabilityLimitations.length).toBeGreaterThan(0);
    expect(synthesis.proposedImprovements.length).toBeGreaterThan(0);
    expect(synthesis.proposedImprovements[0].status).toBe("PROPOSED");
    expect(synthesis.proposedImprovements[0].prerequisites.length).toBeGreaterThan(0);
  });

  it("persists and reloads commercial audience synthesis cleanly from database snapshot", async () => {
    const mockSynthesis: CommercialAudienceSynthesis = {
      selectedOffering: {
        offeringId: synthOfferingId,
        offeringName: "Baklawati Premium 400g Box",
        variantName: "Metal Tin 400g",
        scope: "400g sweets box",
      },
      comparableCompetitors: [
        {
          competitorId: "comp_synth_test_1",
          competitorName: "Rival Pastries",
          productName: "Mixed Box 500g",
          pricingContext: "35 USD",
          evidenceReferences: ["ev_1", "ev_2"],
          strengthsSupportedByReviews: ["Crispy pastry layers praised in 5-star reviews"],
        },
      ],
      purchaseSituations: [
        {
          situation: "Corporate Gifting",
          context: "Delivered to office clients with custom card",
          suitability: "HIGH",
        },
      ],
      offeringNeedFit: [
        {
          need: "Damage-free delivery in summer heat",
          fitLevel: "STRATEGIC_FIT",
          supportedEvidence: ["Metal box provides rigid interior"],
          partialSupportReason: "Protective container mitigates deformation but lacks refrigerated transit SLA.",
          unresolvedRequirements: ["Thermal carrier handling verification"],
        },
      ],
      packageScopeSuitability: {
        unitQuantityOrScope: "400g net",
        suitabilityNotes: "Ideal for 2-4 person sharing",
        limitations: [],
      },
      priceValueAnalysis: {
        pricePerception: "Premium artisanal value",
        comparabilityLimitations: ["Competitor sells bulk unwrapped trays; direct price/gram lacks packaging adjustment"],
        unknowns: ["Courier surcharge for fragile handling"],
      },
      proposedImprovements: [
        {
          improvement: "Insulated thermal sleeve for July-August delivery",
          status: "PROPOSED",
          prerequisites: ["Thermal chamber temperature logging test"],
        },
      ],
    };

    const structuredSignals: StructuredSignals = {
      pain_clusters: [],
      desire_clusters: [],
      pattern_clusters: [],
      root_causes: [],
      psychological_drivers: [],
      confidence_model: "audience-confidence-v2",
      commercialAudienceSynthesis: mockSynthesis,
    };

    // Insert snapshot
    const testJobId = `job_synth_p3_${Date.now()}`;
    await db.insert(audienceSnapshots).values({
      accountId: synthAccountId,
      campaignId: synthCampaignId,
      jobId: testJobId,
      engineVersion: 3,
      languageSignals: "{}",
      audiencePains: "[]",
      desireMap: "[]",
      objectionMap: "[]",
      transformationMap: "[]",
      emotionalDrivers: "[]",
      audienceSegments: "[]",
      segmentDensity: "[]",
      awarenessLevel: "{}",
      maturityIndex: "{}",
      audienceIntentDistribution: "{}",
      adsTargetingHints: "[]",
      inputSummary: "{}",
      signalLineage: "[]",
      structuredSignals: JSON.stringify(structuredSignals),
      targetCoverage: "{}",
      executionTimeMs: 120,
    });

    // Reload through canonical reader
    const reloaded = await getLatestAudienceSnapshot(synthAccountId, synthCampaignId);
    expect(reloaded).not.toBeNull();
    expect(reloaded?.commercialAudienceSynthesis).toBeDefined();

    const loadedSynth = reloaded?.commercialAudienceSynthesis as CommercialAudienceSynthesis;
    expect(loadedSynth.selectedOffering.offeringId).toBe(synthOfferingId);
    expect(loadedSynth.selectedOffering.variantName).toBe("Metal Tin 400g");
    expect(loadedSynth.comparableCompetitors.length).toBe(1);
    expect(loadedSynth.comparableCompetitors[0].competitorName).toBe("Rival Pastries");
    expect(loadedSynth.offeringNeedFit.length).toBe(1);
    expect(loadedSynth.offeringNeedFit[0].fitLevel).toBe("STRATEGIC_FIT");
    expect(loadedSynth.offeringNeedFit[0].unresolvedRequirements[0]).toBe("Thermal carrier handling verification");
    expect(loadedSynth.proposedImprovements[0].status).toBe("PROPOSED");
    expect(loadedSynth.proposedImprovements[0].prerequisites[0]).toContain("Thermal chamber");
  });
});
