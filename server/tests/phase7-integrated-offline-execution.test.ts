import "dotenv/config";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "../db";
import {
  audienceSnapshots,
  ciCompetitors,
  ciCompetitorReviews,
  evidenceRegistry,
  strategicPlans,
  strategyRoots,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { fetchReviewsViaApify } from "../acquisition/multi-source-providers";
import * as apifyClient from "../acquisition/apify-client";
import {
  buildCommercialAudienceSynthesis,
  getLatestAudienceSnapshot,
} from "../audience-engine/engine";
import { runProductAssessmentForPain } from "../strategic-reasoning/product-assessment";
import {
  classifyTerritoryLevel,
  filterAudienceTerritories,
  type Territory,
} from "../positioning-engine/engine";
import { assembleAudiencePositioningData } from "../audience-positioning-service";
import {
  registerEvidence,
  resolveEvidenceItem,
  versionedSourceId,
  canonicalEvidenceUid,
} from "../strategic-reasoning/evidence-registry";
import * as aiClient from "../ai-client";

describe("Phase 7: Executable Offline Integration & Pipeline Handoff", () => {
  const synthCpgAccountId = `tenant_synth_cpg_${Date.now()}`;
  const synthCpgCampaignId = `camp_synth_cpg_${Date.now()}`;
  const synthCpgOfferingId = `off_synth_sweets_400g`;
  const synthCpgCompetitorId = `comp_synth_cpg_${Date.now()}`;

  const synthSaasAccountId = `tenant_synth_saas_${Date.now()}`;
  const synthSaasCampaignId = `camp_synth_saas_${Date.now()}`;
  const synthSaasOfferingId = `off_synth_saas_analytics`;

  const synthServiceAccountId = `tenant_synth_service_${Date.now()}`;
  const synthServiceCampaignId = `camp_synth_service_${Date.now()}`;
  const synthServiceOfferingId = `off_synth_security_audit`;

  beforeEach(async () => {
    vi.restoreAllMocks();
    await db.delete(audienceSnapshots).where(eq(audienceSnapshots.campaignId, synthCpgCampaignId));
    await db.delete(ciCompetitorReviews).where(eq(ciCompetitorReviews.campaignId, synthCpgCampaignId));
    await db.delete(ciCompetitors).where(eq(ciCompetitors.campaignId, synthCpgCampaignId));
    await db.delete(evidenceRegistry).where(eq(evidenceRegistry.campaignId, synthCpgCampaignId));
    await db.delete(strategicPlans).where(eq(strategicPlans.campaignId, synthCpgCampaignId));
    await db.delete(strategyRoots).where(eq(strategyRoots.campaignId, synthCpgCampaignId));

    await db.insert(ciCompetitors).values({
      id: synthCpgCompetitorId,
      accountId: synthCpgAccountId,
      campaignId: synthCpgCampaignId,
      name: "Standard Sweet Importers",
      businessType: "DIRECT_COMPETITOR",
      primaryObjective: "CUSTOMER_ACQUISITION",
      isActive: true,
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.delete(audienceSnapshots).where(eq(audienceSnapshots.campaignId, synthCpgCampaignId));
    await db.delete(ciCompetitorReviews).where(eq(ciCompetitorReviews.campaignId, synthCpgCampaignId));
    await db.delete(ciCompetitors).where(eq(ciCompetitors.campaignId, synthCpgCampaignId));
    await db.delete(evidenceRegistry).where(eq(evidenceRegistry.campaignId, synthCpgCampaignId));
    await db.delete(strategicPlans).where(eq(strategicPlans.campaignId, synthCpgCampaignId));
    await db.delete(strategyRoots).where(eq(strategyRoots.campaignId, synthCpgCampaignId));
  });

  it("executes the full end-to-end internal handoff pipeline across physical product, SaaS, and service fixtures", async () => {
    // ── 1. SOURCE ACQUISITION & NORMALIZATION ──
    const rawReviewItem = {
      reviewText: "Pastries tasted fresh, but the corners were completely crushed during courier transit.",
      rating: 4.6, // float rating requiring rounding
      date: "2026-04-03T11:00:00Z",
      author: "Verified Purchaser Layla",
      isVerified: true,
      reviewUrl: "https://trustpilot.com/review/competitor-sweets-101",
    };

    vi.spyOn(apifyClient, "runActorAndGetItems").mockResolvedValueOnce({
      items: [rawReviewItem],
      totalCount: 1,
      durationMs: 380,
      runId: "run_p7_mock",
    } as any);

    const acquisitionResult = await fetchReviewsViaApify({
      targetUrl: "https://www.trustpilot.com/review/competitor.com",
      platformType: "trustpilot",
      campaignId: synthCpgCampaignId,
      accountId: synthCpgAccountId,
      competitorId: synthCpgCompetitorId,
      maxReviews: 5,
    });

    expect(acquisitionResult.reviews).toHaveLength(1);
    expect(acquisitionResult.reviews[0].rating).toBe(5); // Math.round(4.6) -> 5
    expect(acquisitionResult.reviews[0].platform.toUpperCase()).toBe("TRUSTPILOT");
    const reviewItemText = (acquisitionResult.reviews[0] as any).text || (acquisitionResult.reviews[0] as any).reviewText;
    expect(reviewItemText).toContain("completely crushed during courier transit");

    // Verify row was persisted in ciCompetitorReviews
    const dbReviews = await db
      .select()
      .from(ciCompetitorReviews)
      .where(eq(ciCompetitorReviews.campaignId, synthCpgCampaignId));
    expect(dbReviews).toHaveLength(1);
    expect(dbReviews[0].rating).toBe(5);
    const persistedReview = dbReviews[0];


    // ── 2. COMPETITOR COMMERCIAL EVIDENCE & REVIEW HANDOFF ──
    // Positive review -> competitor strength; Negative review -> scoped customer need
    const positiveReviewSnippet = "Unbeatable wholesale bulk pricing for office events.";
    const competitorCommercialStrength = "Low bulk price point for standard catering";

    // ── 3. MANIFEST FREEZE & CANONICAL EVIDENCE REGISTRATION ──
    const reviewPayload = persistedReview.reviewText;
    const reviewSourceId = versionedSourceId(persistedReview.id, reviewPayload);
    const reviewUid = canonicalEvidenceUid(
      "customer_review",
      "ci_competitor_reviews",
      persistedReview.id,
      reviewPayload
    );

    const buPayload = "Handcrafted Baklava Selection: 400g Gourmet Metal Gift Box (24 individual pieces, $32 USD). Protective food-grade metal tin.";
    const buSourceId = versionedSourceId("snap_bu_cpg_1", buPayload);
    const buUid = canonicalEvidenceUid(
      "product_truth",
      "business_understanding_snapshots",
      "snap_bu_cpg_1",
      buPayload
    );

    const registeredUids = await registerEvidence(synthCpgAccountId, synthCpgCampaignId, [
      {
        kind: "customer_review",
        sourceTable: "ci_competitor_reviews",
        sourceId: reviewSourceId,
        label: "Courier transit damage review",
        detail: reviewPayload,
        observedAt: new Date(),
      },
      {
        kind: "product_truth",
        sourceTable: "business_understanding_snapshots",
        sourceId: buSourceId,
        label: "CPG 400g Gift Box Truth",
        detail: buPayload,
        observedAt: new Date(),
      },
    ]);

    expect(registeredUids).toContain(reviewUid);
    expect(registeredUids).toContain(buUid);

    // Verify manifest freeze resolution
    const resolvedReview = await resolveEvidenceItem({
      accountId: synthCpgAccountId,
      campaignId: synthCpgCampaignId,
      uid: reviewUid,
    });
    expect(resolvedReview?.textSnippet).toBe(reviewPayload);

    // ── 4. CORRECT VARIANT & PRICE BINDING ──
    const cpgBuFixture = {
      offerings: [
        {
          id: synthCpgOfferingId,
          offeringName: "Handcrafted Mixed Baklava Selection",
          variantName: "400g Gourmet Metal Gift Box",
          scope: "400g net weight, 24 individual pieces",
          pricing: { amount: 32, currency: "USD" },
        },
      ],
      competitors: [
        {
          id: "comp_synth_competitor_a",
          name: "Standard Sweet Importers",
          productName: "Bulk Assorted Pastries 500g",
          pricing: "28 USD",
        },
      ],
    };

    const cpgPainsFixture = [
      {
        canonical: "Transit crushing and broken pieces during courier delivery",
        frequency: 8,
        confidenceScore: 0.85,
        evidence: [persistedReview.reviewText],
        sourceSignals: ["reviews"],
        inputSnapshotId: null,
        evidenceCount: 8,
      },
    ];

    // ── 5. AUDIENCE ENGINE COMMERCIAL SYNTHESIS & PERSISTENCE ──
    const commercialSynthesis = buildCommercialAudienceSynthesis({
      businessUnderstanding: cpgBuFixture,
      painMap: cpgPainsFixture,
      selectedOfferingId: synthCpgOfferingId,
      currencyCode: "USD",
      evidenceUnits: [
        {
          id: reviewUid,
          competitorId: "comp_synth_competitor_a",
          competitorName: "Standard Sweet Importers",
          sentiment: "POSITIVE",
          rating: 5,
          text: positiveReviewSnippet,
        } as any,
      ],
    });


    expect(commercialSynthesis.selectedOfferingId).toBe(synthCpgOfferingId);
    expect(commercialSynthesis.selectedOfferingName).toBe("Handcrafted Mixed Baklava Selection");
    expect(commercialSynthesis.selectedVariantName).toBe("400g Gourmet Metal Gift Box");
    expect(commercialSynthesis.selectedVariantPricing?.amount).toBe(32);
    expect(commercialSynthesis.comparableCompetitors).toHaveLength(1);
    expect(commercialSynthesis.comparableCompetitors[0].pricingSummary).toBe("28 USD");

    // Persist Audience Snapshot with StructuredSignals
    const audSnapId = `snap_aud_${Date.now()}`;
    await db.insert(audienceSnapshots).values({
      id: audSnapId,
      accountId: synthCpgAccountId,
      campaignId: synthCpgCampaignId,
      jobId: `job_${Date.now()}`,
      offerSnapshotId: `off_snap_${Date.now()}`,
      miSnapshotId: `mi_snap_${Date.now()}`,
      audienceSegments: JSON.stringify([
        {
          id: "seg_cpg_1",
          name: "Gourmet Confectionery Gift Buyers",
          buyerRole: "Gift Purchaser",
          marketType: "Specialty Confectionery",
          pains: [
            {
              painId: "pain_transit_crush",
              pain: "Transit crushing and broken pieces during courier delivery",
              evidence: [persistedReview.reviewText],
              evidenceCount: 8,
            },
          ],
        },
      ]),
      audiencePains: JSON.stringify([
        {
          painId: "pain_transit_crush",
          canonical: "Transit crushing and broken pieces during courier delivery",
          originalStatement: persistedReview.reviewText,
        },
      ]),
      desireMap: JSON.stringify(["Pristine gift-ready arrival", "Artisanal Antep pistachio flavor"]),
      objectionMap: JSON.stringify(["Courier damage risk", "Higher price than supermarket brands"]),
      emotionalDrivers: JSON.stringify(["Pride in gifting", "Fear of embarrassing broken delivery"]),
      structuredSignals: JSON.stringify({
        primaryBuyingPain: {
          canonical: "Transit crushing and broken pieces during courier delivery",
          experience: "Box corners crushed and pastries broken upon opening",
          commercialImpact: "Spoiled gift occasion and recipient dissatisfaction",
          whyWeCanSolveIt: "Rigid decorative metal tin with sealed food-grade compartments",
        },
        commercialAudienceSynthesis: commercialSynthesis,
      }),
      status: "COMPLETE",
    });

    // ── 6. DOWNSTREAM API READBACK & VIEW MODEL INTEGRATION ──
    const viewModel = await assembleAudiencePositioningData(synthCpgCampaignId, synthCpgAccountId);

    expect(viewModel).toBeDefined();
    expect(viewModel.hasAudience).toBe(true);
    expect(viewModel.commercialAudienceSynthesis).toBeDefined();
    expect(viewModel.commercialAudienceSynthesis?.selectedVariantName).toBe("400g Gourmet Metal Gift Box");
    expect(viewModel.commercialAudienceSynthesis?.offeringFitBreakdown?.[0].fitType).toBe("STRATEGIC_FIT");
    expect(viewModel.commercialAudienceSynthesis?.offeringFitBreakdown?.[0].unresolvedRequirements).toContain(
      "Crush-resistant outer courier packaging or carrier handling SLA verification"
    );

    console.log(
      "[PHASE7_CAPTURED_TRACE]",
      JSON.stringify({
        accountId: synthCpgAccountId,
        campaignId: synthCpgCampaignId,
        offeringId: synthCpgOfferingId,
        evidenceUids: registeredUids,
        persistedReviewRating: persistedReview.rating,
        commercialAudienceSynthesis: viewModel.commercialAudienceSynthesis,
      })
    );
  });



  describe("Explicit Negative Cases", () => {
    it("Negative Case 1: Packaging alone cannot become crush-proof without certified testing", async () => {
      vi.spyOn(aiClient, "aiChat").mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                fitType: "DIRECT_FIT",
                reason: "Metal tin is durable and solves transit damage.",
                requirementBreakdown: [
                  {
                    requirement: "Protective food-grade packaging",
                    status: "SUPPORTED",
                    evidenceFactIds: ["FACT-1"],
                  },
                ],
                proposedPrerequisites: [],
                unprovenParts: [],
              }),
            },
          },
        ],
      } as any);

      const result = await runProductAssessmentForPain({
        painId: "pain_courier_damage",
        canonicalPain: "Pastries crushed and broken during courier transit delivery",
        campaignOfferingId: synthCpgOfferingId,
        businessUnderstandingAuthorityId: "bu_auth_cpg_1",
        productTruthFacts: [
          {
            productTruthFactId: "FACT-1",
            statement: "Packaged in food-grade decorative metal tin box",
            verifiedCapability: "Airtight metal container with food-grade seal",
          },
        ],
        accountId: synthCpgAccountId,
        campaignId: synthCpgCampaignId,
        jobId: `job_${Date.now()}`,
      });

      // Epistemic rule demotes naive DIRECT_FIT to STRATEGIC_FIT
      expect(result.fitType).toBe("STRATEGIC_FIT");
      expect(result.unprovenParts).toBeDefined();
      expect(result.unprovenParts?.some(u => u.toLowerCase().includes("crush") || u.toLowerCase().includes("transit"))).toBe(true);
    });

    it("Negative Case 2: Daily production speed does not establish competitor warehouse shelf storage without evidence", () => {
      const cpgBu = {
        offerings: [
          {
            id: synthCpgOfferingId,
            offeringName: "Handcrafted Sweets",
            variantName: "Fresh Baked Daily",
            scope: "400g",
            pricing: { amount: 32, currency: "USD" },
          },
        ],
        competitors: [
          {
            id: "comp_b",
            name: "Supermarket Sweets",
            productName: "Boxed Sweets 400g",
            // No warehouse evidence provided
          },
        ],
      };

      const synthesis = buildCommercialAudienceSynthesis({
        businessUnderstanding: cpgBu,
        painMap: [
          {
            canonical: "Uncertain freshness compared to warehouse stored inventory",
            frequency: 4,
            confidenceScore: 0.7,
            evidence: ["Freshness uncertain"],
            sourceSignals: ["reviews"],
            inputSnapshotId: null,
            evidenceCount: 4,
          },
        ],
        selectedOfferingId: synthCpgOfferingId,
      });

      // Product truth must remain STRATEGIC_FIT: daily baking does NOT prove competitor warehouse shelf storage
      const freshnessFit = synthesis.offeringFitBreakdown?.find(f => f.need.toLowerCase().includes("freshness"));
      expect(freshnessFit?.fitType).toBe("STRATEGIC_FIT");
      expect(freshnessFit?.unresolvedRequirements).toContain(
        "Competitor storage/handling evidence to establish comparative freshness advantage"
      );
    });


    it("Negative Case 3: Incompatible currencies are not compared without explicit conversion basis", () => {
      const mixedCurrencyBu = {
        offerings: [
          {
            id: synthCpgOfferingId,
            offeringName: "Handcrafted Sweets",
            variantName: "400g Box",
            scope: "400g",
            pricing: { amount: 32, currency: "USD" },
          },
        ],
        competitors: [
          {
            id: "comp_lbp",
            name: "Regional Bakery",
            productName: "400g Sweets",
            pricing: "2,800,000 LBP", // Incompatible currency
          },
        ],
      };

      const synthesis = buildCommercialAudienceSynthesis({
        businessUnderstanding: mixedCurrencyBu,
        painMap: [],
        selectedOfferingId: synthCpgOfferingId,
        currencyCode: "USD",
      });

      const currencyLimitation = synthesis.priceValueLimitations?.find(
        (l) => l.limitation.includes("Incompatible currencies cannot be compared without explicit exchange rate")
      );
      expect(currencyLimitation).toBeDefined();
      expect(currencyLimitation?.limitation).toContain("Incompatible currencies cannot be compared without explicit exchange rate");
    });


    it("Negative Case 4: Unknown variant prices remain unknown without hallucination", () => {
      const unpricedBu = {
        offerings: [
          {
            id: synthServiceOfferingId,
            offeringName: "Enterprise Cybersecurity Audit",
            variantName: "Full Architecture Review",
            scope: "2-week advisory engagement",
            // Pricing omitted
          },
        ],
        competitors: [],
      };

      const synthesis = buildCommercialAudienceSynthesis({
        businessUnderstanding: unpricedBu,
        painMap: [],
        selectedOfferingId: synthServiceOfferingId,
      });

      expect(synthesis.selectedVariantPricing).toBeNull();
      const priceLimitation = synthesis.priceValueLimitations.find(
        (l) => l.dimension.toLowerCase().includes("variant pricing")
      );
      expect(priceLimitation).toBeDefined();
      expect(priceLimitation?.unknownFactor).toContain("Offering variant pricing not specified");
    });

    it("Negative Case 5: Valid territory without predefined dictionary nouns is accepted when semantically grounded", () => {
      const semanticGroundedTerritory: Territory = {
        name: "Ambient thermal degradation during cross-border courier handoffs",
        enemyDefinition: "Delicate pastry fillings degrade because prolonged uninsulated transit exposes items to extreme ambient temperature fluctuations.",
        narrativeDirection: "Direct temperature-monitored refrigerated dispatch preserving delicate crispness from baker to door.",
        domainFailure: "Unmonitored freight handoffs lead to filling melting and pastry texture collapse.",
        operationalProblem: "Prolonged courier transit handoffs without thermal buffering.",
        confidenceScore: 0.85,
        targetPains: ["pain_thermal_collapse"],
        mappedSignalIds: ["sig_1", "sig_2"],
      } as any;

      const classification = classifyTerritoryLevel(semanticGroundedTerritory);
      expect(classification.level).toBe("system");
      expect(classification.reasons).toHaveLength(0);

      const { systemLevel, rejected } = filterAudienceTerritories([semanticGroundedTerritory]);
      expect(systemLevel).toHaveLength(1);
      expect(rejected).toHaveLength(0);
      expect(systemLevel[0].name).toBe("Ambient thermal degradation during cross-border courier handoffs");
    });

    it("Negative Case 6: Unsupported territory containing an approved noun still fails validation", () => {
      // Territory containing the approved nouns "platform" and "tool", but lacking operational grounding and failure condition
      const hypeTerritoryWithApprovedNoun: Territory = {
        name: "The Ultimate Confectionery Platform and Sweet Delight Tool",
        oneLiner: "We bring pure happiness and love in every single bite!",
        enemyDefinition: "Our competitors are not as passionate about making people smile.",
        narrativeDirection: "Spreading joy and sweetness to everyone around the globe.",
        customerProofPoints: [],
        confidenceScore: 0.4,
      } as any;

      const classification = classifyTerritoryLevel(hypeTerritoryWithApprovedNoun);
      expect(classification.level).not.toBe("system");
      expect(classification.reasons.length).toBeGreaterThan(0);

      const { systemLevel, rejected } = filterAudienceTerritories([hypeTerritoryWithApprovedNoun]);
      expect(systemLevel).toHaveLength(0);
      expect(rejected).toHaveLength(1);
    });
  });

  describe("Multi-Domain Fixture Validation (SaaS & Professional Service)", () => {
    it("processes B2B SaaS fixture with seat-based scope and SLA limitations", () => {
      const saasBu = {
        offerings: [
          {
            id: synthSaasOfferingId,
            offeringName: "Real-Time Observability Cloud",
            variantName: "10-Seat Team Tier",
            scope: "10 active seats, 500GB log retention",
            pricing: { amount: 150, currency: "USD" },
          },
        ],
        competitors: [
          {
            id: "comp_saas_1",
            name: "Legacy Monitor Inc",
            productName: "Enterprise Agent 10 Seats",
            pricing: "200 USD",
          },
        ],
      };

      const saasSynthesis = buildCommercialAudienceSynthesis({
        businessUnderstanding: saasBu,
        painMap: [
          {
            canonical: "Query latency exceeds SLA during peak load events",
            frequency: 12,
            confidenceScore: 0.9,
            evidence: ["Queries take 10+ seconds"],
            sourceSignals: ["reviews"],
            inputSnapshotId: null,
            evidenceCount: 12,
          },
        ],
        selectedOfferingId: synthSaasOfferingId,
        currencyCode: "USD",
      });

      expect(saasSynthesis.selectedOfferingName).toBe("Real-Time Observability Cloud");
      expect(saasSynthesis.selectedVariantName).toBe("10-Seat Team Tier");
      expect(saasSynthesis.selectedVariantPricing?.amount).toBe(150);
      expect(saasSynthesis.comparableCompetitors[0].pricingSummary).toBe("200 USD");
      expect(saasSynthesis.packageOrScopeSuitability.suitabilityVerdict).toBe("SUITABLE");
    });

    it("processes Professional Service fixture with milestone scope and verification boundaries", () => {
      const serviceBu = {
        offerings: [
          {
            id: synthServiceOfferingId,
            offeringName: "Comprehensive Cloud Security Audit",
            variantName: "Production Infrastructure Tier",
            scope: "2-week fixed review, IAM and VPC threat modeling",
            pricing: { amount: 5000, currency: "USD" },
          },
        ],
        competitors: [
          {
            id: "comp_sec_firm",
            name: "Apex Defense Advisors",
            productName: "Cloud Readiness Assessment",
            pricing: "7500 USD",
          },
        ],
      };

      const serviceSynthesis = buildCommercialAudienceSynthesis({
        businessUnderstanding: serviceBu,
        painMap: [
          {
            canonical: "Audit reports take 6 weeks and lack remediable code snippets",
            frequency: 6,
            confidenceScore: 0.85,
            evidence: ["Report took too long", "No code fixes provided"],
            sourceSignals: ["reviews"],
            inputSnapshotId: null,
            evidenceCount: 6,
          },
        ],
        selectedOfferingId: synthServiceOfferingId,
        currencyCode: "USD",
      });

      expect(serviceSynthesis.selectedOfferingName).toBe("Comprehensive Cloud Security Audit");
      expect(serviceSynthesis.selectedVariantName).toBe("Production Infrastructure Tier");
      expect(serviceSynthesis.selectedVariantPricing?.amount).toBe(5000);
      expect(serviceSynthesis.comparableCompetitors[0].competitorName).toBe("Apex Defense Advisors");
    });
  });
});
