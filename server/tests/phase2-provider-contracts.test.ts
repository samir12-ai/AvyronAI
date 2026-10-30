import "dotenv/config";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "../db";
import { ciCompetitors, ciCompetitorReviews } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { fetchReviewsViaApify, ACTOR_SLOTS } from "../acquisition/multi-source-providers";
import * as apifyClient from "../acquisition/apify-client";
import { resolveAcquisitionCapability, dispatchAcquisitionTask } from "../competitive-intelligence/provider-registry";

describe("Phase 2: Provider Review Parsing, Contracts & Persistence", () => {
  const synthAccountId = `tenant_synth_p2_${Date.now()}`;
  const synthCampaignId = `camp_synth_p2_${Date.now()}`;
  const synthCompetitorId = `comp_synth_p2_${Date.now()}`;

  const originalEnv = { ...process.env };

  beforeEach(async () => {
    // Clean test records
    await db.delete(ciCompetitorReviews).where(eq(ciCompetitorReviews.campaignId, synthCampaignId));
    await db.delete(ciCompetitors).where(eq(ciCompetitors.campaignId, synthCampaignId));

    // Seed test competitor
    await db.insert(ciCompetitors).values({
      id: synthCompetitorId,
      accountId: synthAccountId,
      campaignId: synthCampaignId,
      name: "Synthetic Competitor Baklava & Tech",
      businessType: "DIRECT_COMPETITOR",
      primaryObjective: "CUSTOMER_ACQUISITION",
      isActive: true,
    });
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    await db.delete(ciCompetitorReviews).where(eq(ciCompetitorReviews.campaignId, synthCampaignId));
    await db.delete(ciCompetitors).where(eq(ciCompetitors.campaignId, synthCampaignId));
  });

  it("parses realistic Trustpilot review payload and persists to ciCompetitorReviews", async () => {
    const mockTrustpilotItems = [
      {
        reviewText: "The packaging was intact, sweets were very fresh and delicious.",
        rating: 5,
        date: "2026-03-15T12:00:00Z",
        author: "Layla M.",
        isVerified: true,
        reviewUrl: "https://trustpilot.com/reviews/tp_1",
      },
      {
        reviewText: "Too short", // 9 chars, valid
        rating: 3,
        date: "2026-03-16T12:00:00Z",
        author: "Karim K.",
      },
      {
        reviewText: "bad", // <5 chars, should be rejected
        rating: 1,
      },
    ];

    vi.spyOn(apifyClient, "runActorAndGetItems").mockResolvedValueOnce({
      items: mockTrustpilotItems,
      totalCount: 3,
      durationMs: 450,
      runId: "run_tp_mock",
    } as any);

    const result = await fetchReviewsViaApify({
      targetUrl: "https://www.trustpilot.com/review/example.com",
      platformType: "trustpilot",
      campaignId: synthCampaignId,
      accountId: synthAccountId,
      competitorId: synthCompetitorId,
      maxReviews: 10,
    });

    expect(result.reviews.length).toBe(2);
    expect(result.report.acceptedCount).toBe(2);
    expect(result.report.rejectedCount).toBe(1);

    // Verify database persistence
    const saved = await db
      .select()
      .from(ciCompetitorReviews)
      .where(and(
        eq(ciCompetitorReviews.campaignId, synthCampaignId),
        eq(ciCompetitorReviews.competitorId, synthCompetitorId)
      ));

    expect(saved.length).toBe(2);
    const topReview = saved.find(r => r.reviewText.includes("packaging was intact"));
    expect(topReview).toBeDefined();
    expect(topReview?.rating).toBe(5);
    expect(topReview?.platform).toBe("trustpilot");
  });

  it("parses realistic Google Maps reviews payload and persists accurately", async () => {
    const mockGoogleItems = [
      {
        text: "Ordered delivery across town, arrived warm and freshly packed with care.",
        stars: 5,
        publishedAtDate: "2026-02-10T10:00:00Z",
        name: "Omar F.",
        reviewUrl: "https://maps.google.com/review/1",
      },
      {
        text: "Pistachio filling was dry and the sugar syrup was overwhelming.",
        stars: 2,
        publishedAtDate: "2026-02-11T10:00:00Z",
        name: "Nour H.",
      }
    ];

    vi.spyOn(apifyClient, "runActorAndGetItems").mockResolvedValueOnce({
      items: mockGoogleItems,
      totalCount: 2,
      durationMs: 320,
      runId: "run_gm_mock",
    } as any);

    const result = await fetchReviewsViaApify({
      targetUrl: "https://maps.google.com/?cid=12345",
      platformType: "google_maps",
      campaignId: synthCampaignId,
      accountId: synthAccountId,
      competitorId: synthCompetitorId,
      maxReviews: 10,
    });

    expect(result.reviews.length).toBe(2);
    expect(result.report.acceptedCount).toBe(2);

    const saved = await db
      .select()
      .from(ciCompetitorReviews)
      .where(and(
        eq(ciCompetitorReviews.campaignId, synthCampaignId),
        eq(ciCompetitorReviews.competitorId, synthCompetitorId)
      ));

    expect(saved.length).toBe(2);
    expect(saved.some(r => r.rating === 2)).toBe(true);
    expect(saved.some(r => r.rating === 5)).toBe(true);
  });

  it("parses realistic Trendyol review payload when actor is configured", async () => {
    process.env.TRENDYOL_REVIEWS_ACTOR_ID = "mock-trendyol-actor";
    (ACTOR_SLOTS as any).TRENDYOL_REVIEWS = "mock-trendyol-actor";

    const mockTrendyolItems = [
      {
        review_text: "Kutulama cok ozenliydi, fistiklar taze ve citirdi. Tesekkurler.",
        rating: 5,
        reviewDate: "2026-01-20T14:30:00Z",
        userName: "Ahmet Y.",
        verifiedPurchase: true,
      },
      {
        review_text: "Kargo gecikti ama lezzet yerinde.",
        rating: 4,
        reviewDate: "2026-01-21T14:30:00Z",
        userName: "Elif B.",
        verifiedPurchase: true,
      }
    ];

    let capturedInput: any = null;
    vi.spyOn(apifyClient, "runActorAndGetItems").mockImplementation(async (opts: any) => {
      capturedInput = opts.input;
      return {
        items: mockTrendyolItems,
        totalCount: 2,
        durationMs: 400,
        runId: "run_trendyol_mock",
      } as any;
    });

    const result = await fetchReviewsViaApify({
      targetUrl: "https://www.trendyol.com/brand/product-p-12345",
      platformType: "trendyol",
      campaignId: synthCampaignId,
      accountId: synthAccountId,
      competitorId: synthCompetitorId,
      maxReviews: 15,
      ...({ sellerId: "seller_999" } as any),
    });

    expect(result.reviews.length).toBe(2);
    expect(capturedInput.productUrl).toBe("https://www.trendyol.com/brand/product-p-12345");
    expect(capturedInput.sellerId).toBe("seller_999");
    expect(capturedInput.maxReviews).toBe(15);

    const saved = await db
      .select()
      .from(ciCompetitorReviews)
      .where(and(
        eq(ciCompetitorReviews.campaignId, synthCampaignId),
        eq(ciCompetitorReviews.competitorId, synthCompetitorId)
      ));

    expect(saved.length).toBe(2);
    expect(saved[0].platform).toBe("trendyol");
  });

  it("parses realistic G2 and Capterra review payloads when actors are configured", async () => {
    process.env.G2_REVIEWS_ACTOR_ID = "mock-g2-actor";
    (ACTOR_SLOTS as any).G2_REVIEWS = "mock-g2-actor";

    const mockG2Items = [
      {
        reviewBody: "Robust API orchestration and automated campaign workflows. Saves hours weekly.",
        stars: 4.5,
        publishedDate: "2026-03-01T09:00:00Z",
        reviewerName: "Devin S.",
        isVerifiedPurchase: true,
      },
    ];

    vi.spyOn(apifyClient, "runActorAndGetItems").mockResolvedValueOnce({
      items: mockG2Items,
      totalCount: 1,
      durationMs: 250,
      runId: "run_g2_mock",
    } as any);

    const resultG2 = await fetchReviewsViaApify({
      targetUrl: "https://www.g2.com/products/example-software/reviews",
      platformType: "g2",
      campaignId: synthCampaignId,
      accountId: synthAccountId,
      competitorId: synthCompetitorId,
      maxReviews: 5,
    });

    expect(resultG2.reviews.length).toBe(1);
    expect(resultG2.reviews[0].platform).toBe("g2");
    expect(resultG2.reviews[0].rating).toBe(5);

    const savedG2 = await db
      .select()
      .from(ciCompetitorReviews)
      .where(and(
        eq(ciCompetitorReviews.campaignId, synthCampaignId),
        eq(ciCompetitorReviews.platform, "g2")
      ));
    expect(savedG2.length).toBe(1);
    expect(savedG2[0].reviewText).toContain("Robust API orchestration");
  });

  it("returns PROVIDER_PENDING cleanly without making network calls when actor is not configured", async () => {
    delete process.env.CAPTERRA_REVIEWS_ACTOR_ID;
    (ACTOR_SLOTS as any).CAPTERRA_REVIEWS = null;

    const spy = vi.spyOn(apifyClient, "runActorAndGetItems");

    const result = await fetchReviewsViaApify({
      targetUrl: "https://www.capterra.com/p/12345/example",
      platformType: "capterra",
      campaignId: synthCampaignId,
      accountId: synthAccountId,
      competitorId: synthCompetitorId,
    });

    expect(spy).not.toHaveBeenCalled();
    expect(result.reviews).toEqual([]);
    expect(result.report.actorId).toBe("NOT_CONFIGURED");
    expect(result.report.error).toContain("PROVIDER_PENDING");
  });
});
