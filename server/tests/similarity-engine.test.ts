import { describe, it, expect } from "vitest";
import { computeSimilarityDiagnosis } from "../market-intelligence-v3/similarity-engine";
import type { CompetitorInput, CompetitorSignalResult } from "../market-intelligence-v3/types";

function makeCompetitor(overrides: Partial<CompetitorInput> & { id: string; name: string }): CompetitorInput {
  return {
    platform: "instagram",
    profileLink: "https://instagram.com/test",
    businessType: "retail",
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

function makeSignalResult(competitorId: string, competitorName: string): CompetitorSignalResult {
  return {
    competitorId,
    competitorName,
    signals: {
      postingFrequencyTrend: 0,
      engagementVolatility: 0,
      ctaIntensityShift: 0,
      offerLanguageChange: 0,
      hashtagDriftScore: 0,
      bioModificationFrequency: 0,
      sentimentDrift: 0,
      reviewVelocityChange: 0,
      contentExperimentRate: 0,
    },
    signalCoverageScore: 0.5,
    sourceReliabilityScore: 0.75,
    sampleSize: 10,
    timeWindowDays: 30,
    varianceScore: 0,
    dominantSourceRatio: 0.5,
    missingFields: [],
  };
}

function makePost(hasCTA: boolean, hasOffer: boolean, caption: string, mediaType: string = "IMAGE") {
  return {
    id: `post_${Math.random().toString(36).substr(2, 6)}`,
    caption,
    likes: 100,
    comments: 10,
    mediaType,
    hashtags: [],
    timestamp: new Date().toISOString(),
    hasCTA,
    hasOffer,
  };
}

describe("Similarity Engine", () => {

  describe("Insufficient data cases", () => {
    it("should return INSUFFICIENT_DATA with fewer than 2 competitors", () => {
      const comp = makeCompetitor({ id: "c1", name: "CompA" });
      const signals = [makeSignalResult("c1", "CompA")];
      const result = computeSimilarityDiagnosis([comp], signals);
      expect(result.diagnosis).toBe("INSUFFICIENT_DATA");
      expect(result.overallSimilarityIndex).toBe(0);
      expect(result.explanation).toContain("At least 2 competitors");
    });

    it("should return INSUFFICIENT_DATA when no dimension has sufficient data", () => {
      const compA = makeCompetitor({ id: "c1", name: "CompA" });
      const compB = makeCompetitor({ id: "c2", name: "CompB" });
      const signals = [makeSignalResult("c1", "CompA"), makeSignalResult("c2", "CompB")];
      const result = computeSimilarityDiagnosis([compA, compB], signals);
      expect(result.diagnosis).toBe("INSUFFICIENT_DATA");
      expect(result.overallSimilarityIndex).toBe(0);
    });
  });

  describe("Distinct competitors → low similarity", () => {
    it("should produce low similarity for competitors with distinct content mixes", () => {
      const compA = makeCompetitor({
        id: "c1",
        name: "CompA",
        contentTypeRatio: "Reels:80%,Posts:10%,Carousel:10%",
        posts: [
          makePost(true, false, "Buy now limited offer!", "REEL"),
          makePost(false, false, "Behind the scenes of our brand", "REEL"),
        ],
      });
      const compB = makeCompetitor({
        id: "c2",
        name: "CompB",
        contentTypeRatio: "Reels:10%,Posts:70%,Carousel:20%",
        posts: [
          makePost(false, false, "Our beautiful new collection showcase", "IMAGE"),
          makePost(false, true, "50% off sale discount today only", "CAROUSEL"),
        ],
      });
      const signals = [makeSignalResult("c1", "CompA"), makeSignalResult("c2", "CompB")];
      const result = computeSimilarityDiagnosis([compA, compB], signals);
      expect(result.overallSimilarityIndex).toBeLessThan(0.6);
      expect(result.diagnosis).toBe("LOW_CONFIDENCE");
    });

    it("should produce low similarity when CTA distributions differ significantly", () => {
      const posts_heavy_cta = Array.from({ length: 10 }, () => makePost(true, true, "Shop now! Limited offer! DM us!"));
      const posts_no_cta = Array.from({ length: 10 }, () => makePost(false, false, "A beautiful sunset captured today."));

      const compA = makeCompetitor({
        id: "c1",
        name: "CompA",
        contentTypeRatio: "Reels:50%,Posts:50%",
        posts: posts_heavy_cta,
      });
      const compB = makeCompetitor({
        id: "c2",
        name: "CompB",
        contentTypeRatio: "Reels:50%,Posts:50%",
        posts: posts_no_cta,
      });
      const signals = [makeSignalResult("c1", "CompA"), makeSignalResult("c2", "CompB")];
      const result = computeSimilarityDiagnosis([compA, compB], signals);
      expect(result.dimensions.ctaIntent.sufficient).toBe(true);
      expect(result.dimensions.ctaIntent.score).toBeLessThan(0.8);
    });
  });

  describe("Similar competitors → high similarity", () => {
    it("should produce high similarity for competitors with identical content mixes", () => {
      const sharedPosts = Array.from({ length: 10 }, () => makePost(true, false, "Book now! Link in bio! DM us today!", "REEL"));
      const sharedComments = Array.from({ length: 5 }, (_, i) => ({ id: `cm${i}`, text: "Great service!", timestamp: new Date().toISOString() }));
      const compA = makeCompetitor({
        id: "c1",
        name: "CompA",
        contentTypeRatio: "Reels:60%,Posts:30%,Carousel:10%",
        hookStyles: "question,listicle,how-to",
        ctaPatterns: "DM,Book",
        engagementRatio: 3.5,
        messagingTone: "professional",
        posts: sharedPosts,
        comments: sharedComments,
      });
      const compB = makeCompetitor({
        id: "c2",
        name: "CompB",
        contentTypeRatio: "Reels:60%,Posts:30%,Carousel:10%",
        hookStyles: "question,listicle,how-to",
        ctaPatterns: "DM,Book",
        engagementRatio: 4.0,
        messagingTone: "professional",
        posts: sharedPosts,
        comments: sharedComments,
      });
      const signals = [makeSignalResult("c1", "CompA"), makeSignalResult("c2", "CompB")];
      const result = computeSimilarityDiagnosis([compA, compB], signals);
      expect(result.overallSimilarityIndex).toBeGreaterThan(0.6);
      expect(result.diagnosis).toBe("SIMILARITY_LIKELY_MARKET_REALITY");
    });
  });

  describe("Missing data → similarity not asserted", () => {
    it("should flag SIMILARITY_LIKELY_DATA_LIMITATION when high similarity but low coverage", () => {
      const compA = makeCompetitor({
        id: "c1",
        name: "CompA",
        contentTypeRatio: "Reels:50%,Posts:50%",
      });
      const compB = makeCompetitor({
        id: "c2",
        name: "CompB",
        contentTypeRatio: "Reels:50%,Posts:50%",
      });
      const signals = [makeSignalResult("c1", "CompA"), makeSignalResult("c2", "CompB")];
      const result = computeSimilarityDiagnosis([compA, compB], signals);

      if (result.overallSimilarityIndex > 0.6) {
        expect(["SIMILARITY_LIKELY_DATA_LIMITATION", "LOW_CONFIDENCE"]).toContain(result.diagnosis);
      } else {
        expect(["INSUFFICIENT_DATA", "LOW_CONFIDENCE"]).toContain(result.diagnosis);
      }
    });
  });

  describe("Evidence coverage map", () => {
    it("should list missing data points per competitor", () => {
      const compA = makeCompetitor({
        id: "c1",
        name: "CompA",
        contentTypeRatio: "Reels:50%,Posts:50%",
        hookStyles: "question",
        ctaPatterns: "DM",
        engagementRatio: 3.5,
        messagingTone: "professional",
        posts: [makePost(true, false, "Test caption here")],
        comments: [{ id: "cm1", text: "Great!", timestamp: new Date().toISOString() }],
      });
      const compB = makeCompetitor({
        id: "c2",
        name: "CompB",
      });
      const signals = [makeSignalResult("c1", "CompA"), makeSignalResult("c2", "CompB")];
      const result = computeSimilarityDiagnosis([compA, compB], signals);

      const coverageA = result.evidenceCoverage.find(c => c.competitorId === "c1");
      const coverageB = result.evidenceCoverage.find(c => c.competitorId === "c2");

      expect(coverageA).toBeDefined();
      expect(coverageA!.missingDataPoints.length).toBe(0);
      expect(coverageA!.coverageRatio).toBe(1);

      expect(coverageB).toBeDefined();
      expect(coverageB!.missingDataPoints.length).toBeGreaterThan(0);
      expect(coverageB!.missingDataPoints).toContain("posts");
      expect(coverageB!.missingDataPoints).toContain("comments");
      expect(coverageB!.coverageRatio).toBeLessThan(1);
    });
  });

  describe("Deterministic computation", () => {
    it("should produce identical results for identical inputs", () => {
      const posts = Array.from({ length: 5 }, (_, i) => makePost(i % 2 === 0, i % 3 === 0, `Post ${i} content text here`));
      const compA = makeCompetitor({
        id: "c1",
        name: "CompA",
        contentTypeRatio: "Reels:40%,Posts:40%,Carousel:20%",
        hookStyles: "question,story",
        posts,
      });
      const compB = makeCompetitor({
        id: "c2",
        name: "CompB",
        contentTypeRatio: "Reels:60%,Posts:20%,Carousel:20%",
        hookStyles: "listicle,how-to",
        posts,
      });
      const signals = [makeSignalResult("c1", "CompA"), makeSignalResult("c2", "CompB")];

      const result1 = computeSimilarityDiagnosis([compA, compB], signals);
      const result2 = computeSimilarityDiagnosis([compA, compB], signals);

      expect(result1.overallSimilarityIndex).toBe(result2.overallSimilarityIndex);
      expect(result1.diagnosis).toBe(result2.diagnosis);
      expect(result1.dimensions).toEqual(result2.dimensions);
    });
  });

  describe("Similarity minimum evidence threshold (LOW_CONFIDENCE guard)", () => {
    it("should return LOW_CONFIDENCE when any competitor has fewer than 8 posts", () => {
      const fewPosts = Array.from({ length: 5 }, () => makePost(true, false, "Book now! Link in bio! DM us today!", "REEL"));
      const compA = makeCompetitor({
        id: "c1",
        name: "CompA",
        contentTypeRatio: "Reels:60%,Posts:30%,Carousel:10%",
        hookStyles: "question,listicle,how-to",
        ctaPatterns: "DM,Book",
        engagementRatio: 3.5,
        messagingTone: "professional",
        posts: fewPosts,
        comments: [{ id: "cm1", text: "Great!", timestamp: new Date().toISOString() }],
      });
      const compB = makeCompetitor({
        id: "c2",
        name: "CompB",
        contentTypeRatio: "Reels:60%,Posts:30%,Carousel:10%",
        hookStyles: "question,listicle,how-to",
        ctaPatterns: "DM,Book",
        engagementRatio: 4.0,
        messagingTone: "professional",
        posts: fewPosts,
        comments: [{ id: "cm2", text: "Nice!", timestamp: new Date().toISOString() }],
      });
      const signals = [makeSignalResult("c1", "CompA"), makeSignalResult("c2", "CompB")];
      const result = computeSimilarityDiagnosis([compA, compB], signals);
      expect(result.diagnosis).toBe("LOW_CONFIDENCE");
      expect(result.explanation).toContain("LOW_CONFIDENCE");
      expect(result.explanation).toContain("fewer than 8 posts");
    });

    it("should return LOW_CONFIDENCE when only one competitor has fewer than 8 posts", () => {
      const manyPosts = Array.from({ length: 10 }, () => makePost(true, false, "Book now! Link in bio! DM us today!", "REEL"));
      const fewPosts = Array.from({ length: 3 }, () => makePost(true, false, "Shop here! Great deals!", "IMAGE"));
      const compA = makeCompetitor({
        id: "c1",
        name: "CompA",
        contentTypeRatio: "Reels:60%,Posts:30%,Carousel:10%",
        hookStyles: "question,listicle",
        posts: manyPosts,
        comments: [{ id: "cm1", text: "Great!", timestamp: new Date().toISOString() }],
      });
      const compB = makeCompetitor({
        id: "c2",
        name: "CompB",
        contentTypeRatio: "Reels:60%,Posts:30%,Carousel:10%",
        hookStyles: "question,listicle",
        posts: fewPosts,
        comments: [{ id: "cm2", text: "Nice!", timestamp: new Date().toISOString() }],
      });
      const signals = [makeSignalResult("c1", "CompA"), makeSignalResult("c2", "CompB")];
      const result = computeSimilarityDiagnosis([compA, compB], signals);
      expect(result.diagnosis).toBe("LOW_CONFIDENCE");
      expect(result.explanation).toContain("CompB");
    });

    it("should NOT return LOW_CONFIDENCE when all competitors have >= 8 posts", () => {
      const enoughPosts = Array.from({ length: 10 }, () => makePost(true, false, "Book now! Link in bio! DM us today!", "REEL"));
      const compA = makeCompetitor({
        id: "c1",
        name: "CompA",
        contentTypeRatio: "Reels:60%,Posts:30%,Carousel:10%",
        hookStyles: "question,listicle,how-to",
        ctaPatterns: "DM,Book",
        engagementRatio: 3.5,
        messagingTone: "professional",
        posts: enoughPosts,
        comments: [{ id: "cm1", text: "Great!", timestamp: new Date().toISOString() }],
      });
      const compB = makeCompetitor({
        id: "c2",
        name: "CompB",
        contentTypeRatio: "Reels:60%,Posts:30%,Carousel:10%",
        hookStyles: "question,listicle,how-to",
        ctaPatterns: "DM,Book",
        engagementRatio: 4.0,
        messagingTone: "professional",
        posts: enoughPosts,
        comments: [{ id: "cm2", text: "Nice!", timestamp: new Date().toISOString() }],
      });
      const signals = [makeSignalResult("c1", "CompA"), makeSignalResult("c2", "CompB")];
      const result = computeSimilarityDiagnosis([compA, compB], signals);
      expect(result.diagnosis).not.toBe("LOW_CONFIDENCE");
    });
  });

  describe("Dimension sufficiency tracking", () => {
    it("should mark dimensions as insufficient when data is missing", () => {
      const compA = makeCompetitor({ id: "c1", name: "CompA" });
      const compB = makeCompetitor({ id: "c2", name: "CompB" });
      const signals = [makeSignalResult("c1", "CompA"), makeSignalResult("c2", "CompB")];
      const result = computeSimilarityDiagnosis([compA, compB], signals);

      expect(result.dimensions.contentMix.sufficient).toBe(false);
      expect(result.dimensions.offerLanguage.sufficient).toBe(false);
      expect(result.dimensions.hookStyle.sufficient).toBe(false);
      expect(result.dimensions.ctaIntent.sufficient).toBe(false);
    });

    it("should mark contentMix as sufficient when at least 2 competitors have content ratios", () => {
      const compA = makeCompetitor({ id: "c1", name: "CompA", contentTypeRatio: "Reels:50%,Posts:50%" });
      const compB = makeCompetitor({ id: "c2", name: "CompB", contentTypeRatio: "Reels:30%,Posts:70%" });
      const signals = [makeSignalResult("c1", "CompA"), makeSignalResult("c2", "CompB")];
      const result = computeSimilarityDiagnosis([compA, compB], signals);

      expect(result.dimensions.contentMix.sufficient).toBe(true);
    });
  });
});
