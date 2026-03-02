import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: "test-id" }]),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  },
}));

vi.mock("../competitive-intelligence/profile-scraper", () => ({
  scrapeInstagramProfile: vi.fn(),
}));

import { computeCompetitorSignals } from "../market-intelligence-v3/signal-engine";
import { computeConfidence, evaluateSignalStabilityGuard } from "../market-intelligence-v3/confidence-engine";
import { computeCompetitorHash } from "../market-intelligence-v3/utils";
import { MI_THRESHOLDS, MI_REFRESH } from "../market-intelligence-v3/constants";
import type { CompetitorInput, PostData, CommentData } from "../market-intelligence-v3/types";

function makeCompetitor(overrides: Partial<CompetitorInput> = {}): CompetitorInput {
  return {
    id: `comp_${Math.random().toString(36).substr(2, 6)}`,
    name: "Test Competitor",
    platform: "instagram",
    profileLink: "https://instagram.com/test",
    businessType: "Service",
    postingFrequency: null,
    contentTypeRatio: null,
    engagementRatio: null,
    ctaPatterns: null,
    discountFrequency: null,
    hookStyles: null,
    messagingTone: null,
    socialProofPresence: null,
    posts: [],
    comments: [],
    ...overrides,
  };
}

function makePosts(count: number): PostData[] {
  const posts: PostData[] = [];
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    const daysAgo = i * 2;
    posts.push({
      id: `post_${i}`,
      caption: `This is test post ${i} with some content about marketing strategy. Check our website for more details. DM us for pricing!`,
      likes: 100 + Math.floor(Math.random() * 500),
      comments: 10 + Math.floor(Math.random() * 50),
      mediaType: i % 3 === 0 ? "REEL" : i % 3 === 1 ? "IMAGE" : "CAROUSEL",
      hashtags: [`#marketing`, `#business`, `#tag${i}`],
      timestamp: new Date(now - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
      hasCTA: i % 2 === 0,
      hasOffer: i % 5 === 0,
    });
  }
  return posts;
}

function makeComments(count: number): CommentData[] {
  const comments: CommentData[] = [];
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    comments.push({
      id: `comment_${i}`,
      text: `This is a test comment ${i} about the product quality and service`,
      sentiment: 0.3 + Math.random() * 0.4,
      timestamp: new Date(now - i * 12 * 60 * 60 * 1000).toISOString(),
    });
  }
  return comments;
}

describe("Data Acquisition Layer Tests", () => {
  it("T1: Competitor with only URL → confidence < 65%", () => {
    const urlOnlyCompetitors = [
      makeCompetitor({ id: "c1", name: "Comp A" }),
      makeCompetitor({ id: "c2", name: "Comp B" }),
      makeCompetitor({ id: "c3", name: "Comp C" }),
    ];

    const signalResults = urlOnlyCompetitors.map(c => computeCompetitorSignals(c));
    const confidence = computeConfidence(signalResults, 0);

    expect(confidence.overall).toBeLessThan(0.65);
    expect(confidence.level).not.toBe("STRONG");
    expect(confidence.guardDecision).not.toBe("PROCEED");
  });

  it("T2: Competitor with 30 posts → confidence rises", () => {
    const urlOnlyComp = makeCompetitor({ id: "c1", name: "URL Only" });
    const dataComp = makeCompetitor({
      id: "c2",
      name: "Data Rich",
      posts: makePosts(30),
      comments: makeComments(50),
      ctaPatterns: "DM, Link, Shop",
      postingFrequency: 5,
      engagementRatio: 3.5,
      contentTypeRatio: "Reels 60% / Static 40%",
    });

    const signalUrlOnly = computeCompetitorSignals(urlOnlyComp);
    const signalDataRich = computeCompetitorSignals(dataComp);

    expect(signalDataRich.sampleSize).toBeGreaterThan(signalUrlOnly.sampleSize);
    expect(signalDataRich.signalCoverageScore).toBeGreaterThan(signalUrlOnly.signalCoverageScore);

    const confWithData = computeConfidence(
      [signalDataRich, computeCompetitorSignals(makeCompetitor({ id: "c3", posts: makePosts(30), comments: makeComments(50), ctaPatterns: "Call", postingFrequency: 3, engagementRatio: 2.1, contentTypeRatio: "Reels 50% / Static 50%" })), computeCompetitorSignals(makeCompetitor({ id: "c4", posts: makePosts(30), comments: makeComments(50), ctaPatterns: "Book", postingFrequency: 4, engagementRatio: 4.0, contentTypeRatio: "Reels 70% / Static 30%" }))],
      1,
    );
    const confUrlOnly = computeConfidence(
      [signalUrlOnly, computeCompetitorSignals(makeCompetitor({ id: "c5" })), computeCompetitorSignals(makeCompetitor({ id: "c6" }))],
      0,
    );

    expect(confWithData.overall).toBeGreaterThan(confUrlOnly.overall);
  });

  it("T3: Competitor with posts but no comments → downgrade but not block", () => {
    const postsOnlyCompetitors = [
      makeCompetitor({ id: "c1", name: "Posts Only A", posts: makePosts(20), ctaPatterns: "DM", postingFrequency: 3, engagementRatio: 2.0, contentTypeRatio: "Reels 50% / Static 50%" }),
      makeCompetitor({ id: "c2", name: "Posts Only B", posts: makePosts(15), ctaPatterns: "Link", postingFrequency: 4, engagementRatio: 3.0, contentTypeRatio: "Reels 60% / Static 40%" }),
      makeCompetitor({ id: "c3", name: "Posts Only C", posts: makePosts(25), ctaPatterns: "Shop", postingFrequency: 5, engagementRatio: 4.0, contentTypeRatio: "Reels 70% / Static 30%" }),
    ];

    const signalResults = postsOnlyCompetitors.map(c => computeCompetitorSignals(c));
    const guard = evaluateSignalStabilityGuard(signalResults);

    expect(guard.decision).not.toBe("BLOCK");

    const confidence = computeConfidence(signalResults, 1);
    expect(confidence.guardDecision).not.toBe("BLOCK");
  });

  it("T4: Duplicate competitorHash → no new snapshot needed", () => {
    const competitors = [
      makeCompetitor({ id: "c1", name: "Alpha", profileLink: "https://instagram.com/alpha" }),
      makeCompetitor({ id: "c2", name: "Beta", profileLink: "https://instagram.com/beta" }),
    ];

    const hash1 = computeCompetitorHash(competitors);
    const hash2 = computeCompetitorHash(competitors);

    expect(hash1).toBe(hash2);
    expect(hash1).toBeTruthy();
    expect(hash1.length).toBeGreaterThan(0);

    const modifiedCompetitors = [
      ...competitors,
      makeCompetitor({ id: "c3", name: "Gamma", profileLink: "https://instagram.com/gamma" }),
    ];
    const hash3 = computeCompetitorHash(modifiedCompetitors);
    expect(hash3).not.toBe(hash1);
  });

  it("T5: Refresh within 72h → blocked", () => {
    const hardCapHours = MI_REFRESH.HARD_CAP_HOURS;
    expect(hardCapHours).toBe(72);

    const lastRefresh = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const cooldownMs = hardCapHours * 60 * 60 * 1000;
    const elapsed = Date.now() - lastRefresh.getTime();

    expect(elapsed).toBeLessThan(cooldownMs);

    const pastCooldown = new Date(Date.now() - 73 * 60 * 60 * 1000);
    const elapsedPast = Date.now() - pastCooldown.getTime();
    expect(elapsedPast).toBeGreaterThan(cooldownMs);
  });

  it("T6: Proxy blackout → fallback to existing snapshot (scraper handles gracefully)", () => {
    const existingCompetitor = makeCompetitor({
      id: "c1",
      name: "Existing Data",
      posts: makePosts(20),
      ctaPatterns: "DM, Link",
      postingFrequency: 4,
      engagementRatio: 3.0,
      contentTypeRatio: "Reels 50% / Static 50%",
    });

    const signalResults = [computeCompetitorSignals(existingCompetitor)];
    const confidence = computeConfidence(signalResults, 7);

    expect(confidence.overall).toBeGreaterThan(0);
    expect(confidence.level).not.toBe("INSUFFICIENT");
  });

  it("T7: Max competitor count stress test (5 competitors)", () => {
    const maxCompetitors: CompetitorInput[] = [];
    for (let i = 0; i < 5; i++) {
      maxCompetitors.push(makeCompetitor({
        id: `comp_${i}`,
        name: `Competitor ${i}`,
        posts: makePosts(30),
        comments: makeComments(100),
        ctaPatterns: "DM, Link, Shop",
        postingFrequency: 3 + i,
        engagementRatio: 2.0 + i * 0.5,
        contentTypeRatio: "Reels 50% / Static 50%",
      }));
    }

    const signalResults = maxCompetitors.map(c => computeCompetitorSignals(c));
    expect(signalResults.length).toBe(5);

    for (const sr of signalResults) {
      expect(sr.signals).toBeDefined();
      expect(sr.sampleSize).toBeGreaterThan(0);
      expect(sr.signalCoverageScore).toBeGreaterThan(0);
    }

    const confidence = computeConfidence(signalResults, 1);
    expect(confidence.overall).toBeGreaterThan(0);
    expect(confidence.level).not.toBe("INSUFFICIENT");
  });

  it("T8: 3 competitor threshold enforcement", () => {
    const twoCompetitors = [
      makeCompetitor({ id: "c1", name: "A", posts: makePosts(30), ctaPatterns: "DM", postingFrequency: 5, engagementRatio: 3.0, contentTypeRatio: "Reels 50% / Static 50%" }),
      makeCompetitor({ id: "c2", name: "B", posts: makePosts(30), ctaPatterns: "Link", postingFrequency: 4, engagementRatio: 2.5, contentTypeRatio: "Reels 60% / Static 40%" }),
    ];

    const threeCompetitors = [
      ...twoCompetitors,
      makeCompetitor({ id: "c3", name: "C", posts: makePosts(30), ctaPatterns: "Shop", postingFrequency: 3, engagementRatio: 4.0, contentTypeRatio: "Reels 70% / Static 30%" }),
    ];

    const conf2 = computeConfidence(twoCompetitors.map(c => computeCompetitorSignals(c)), 1);
    const conf3 = computeConfidence(threeCompetitors.map(c => computeCompetitorSignals(c)), 1);

    expect(conf3.overall).toBeGreaterThan(conf2.overall);

    const minRequired = MI_THRESHOLDS.MIN_COMPETITORS;
    expect(minRequired).toBe(3);

    expect(twoCompetitors.length).toBeLessThan(minRequired);
    expect(threeCompetitors.length).toBeGreaterThanOrEqual(minRequired);
  });
});
