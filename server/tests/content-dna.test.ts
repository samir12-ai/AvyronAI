import { describe, it, expect } from "vitest";
import { computeContentDNA, computeAllContentDNA } from "../market-intelligence-v3/content-dna";
import { computeSnapshotDeltas } from "../market-intelligence-v3/engine";
import type { CompetitorInput, PostData } from "../market-intelligence-v3/types";
import { SIMILARITY_MIN_EVIDENCE_THRESHOLD } from "../market-intelligence-v3/constants";
import * as fs from "fs";
import * as path from "path";

function makePost(overrides: Partial<PostData> & { id: string; caption: string }): PostData {
  return {
    likes: 100,
    comments: 10,
    mediaType: "IMAGE",
    hashtags: [],
    timestamp: new Date().toISOString(),
    hasCTA: false,
    hasOffer: false,
    ...overrides,
  };
}

function makeCompetitor(id: string, name: string, posts: PostData[]): CompetitorInput {
  return {
    id,
    name,
    platform: "instagram",
    profileLink: `https://instagram.com/${name}`,
    businessType: "retail",
    postingFrequency: null,
    contentTypeRatio: null,
    engagementRatio: null,
    ctaPatterns: null,
    discountFrequency: null,
    hookStyles: null,
    messagingTone: null,
    socialProofPresence: null,
    posts,
    comments: [],
  };
}

describe("T005: Torture Tests", () => {
  describe("A) Content DNA Detection", () => {
    it("A1: detects shock hook archetype from known patterns", () => {
      const posts = Array.from({ length: 10 }, (_, i) =>
        makePost({ id: `p${i}`, caption: i < 5 ? "This is SHOCKING news that you won't believe happened today!" : "Regular post about our product launch" })
      );
      const comp = makeCompetitor("c1", "ShockBrand", posts);
      const result = computeContentDNA(comp);
      expect(result.hookArchetypes).toContain("shock");
    });

    it("A2: detects question hook archetype", () => {
      const posts = Array.from({ length: 10 }, (_, i) =>
        makePost({ id: `p${i}`, caption: "Do you know why most businesses fail in their first year of operation?" })
      );
      const comp = makeCompetitor("c1", "QuestionBrand", posts);
      const result = computeContentDNA(comp);
      expect(result.hookArchetypes).toContain("question");
    });

    it("A3: detects statistic hook archetype from percentage patterns", () => {
      const posts = Array.from({ length: 10 }, (_, i) =>
        makePost({ id: `p${i}`, caption: "Did you know that 73% of marketers report higher engagement with video content?" })
      );
      const comp = makeCompetitor("c1", "StatBrand", posts);
      const result = computeContentDNA(comp);
      expect(result.hookArchetypes).toContain("statistic");
    });

    it("A4: detects authority hook archetype", () => {
      const posts = Array.from({ length: 10 }, (_, i) =>
        makePost({ id: `p${i}`, caption: "Research shows that our certified professional method delivers proven results every time" })
      );
      const comp = makeCompetitor("c1", "AuthorityBrand", posts);
      const result = computeContentDNA(comp);
      expect(result.hookArchetypes).toContain("authority");
    });

    it("A5: detects curiosity hook archetype", () => {
      const posts = Array.from({ length: 10 }, (_, i) =>
        makePost({ id: `p${i}`, caption: "The secret that most people don't know about growing their Instagram following fast" })
      );
      const comp = makeCompetitor("c1", "CuriosityBrand", posts);
      const result = computeContentDNA(comp);
      expect(result.hookArchetypes).toContain("curiosity");
    });

    it("A6: detects story hook archetype", () => {
      const posts = Array.from({ length: 10 }, (_, i) =>
        makePost({ id: `p${i}`, caption: "I remember when I first started my journey into entrepreneurship back in 2015" })
      );
      const comp = makeCompetitor("c1", "StoryBrand", posts);
      const result = computeContentDNA(comp);
      expect(result.hookArchetypes).toContain("story");
    });

    it("A7: detects problem hook archetype", () => {
      const posts = Array.from({ length: 10 }, (_, i) =>
        makePost({ id: `p${i}`, caption: "Are you struggling with low engagement and frustrated with your content performance?" })
      );
      const comp = makeCompetitor("c1", "ProblemBrand", posts);
      const result = computeContentDNA(comp);
      expect(result.hookArchetypes).toContain("problem");
    });

    it("A8: detects implicit soft CTA (DM me) — classifies as soft, not missing", () => {
      const posts = Array.from({ length: 10 }, (_, i) =>
        makePost({ id: `p${i}`, caption: "Want to learn more about our program? DM me and I will send you the details!" })
      );
      const comp = makeCompetitor("c1", "SoftCTABrand", posts);
      const result = computeContentDNA(comp);
      expect(result.ctaFrameworks).toContain("soft");
      expect(result.missingSignalFlags).not.toContain("No CTA frameworks detected");
    });

    it("A9: detects implicit soft CTA (comment below) — classifies as soft", () => {
      const posts = Array.from({ length: 10 }, (_, i) =>
        makePost({ id: `p${i}`, caption: "What do you think about this approach? Comment below and share your thoughts with us!" })
      );
      const comp = makeCompetitor("c1", "CommentCTABrand", posts);
      const result = computeContentDNA(comp);
      expect(result.ctaFrameworks).toContain("soft");
    });

    it("A10: detects explicit CTA (shop now, link in bio)", () => {
      const posts = Array.from({ length: 10 }, (_, i) =>
        makePost({ id: `p${i}`, caption: "Shop now and get 20% off! Link in bio for the exclusive offer - limited time only!" })
      );
      const comp = makeCompetitor("c1", "ExplicitCTABrand", posts);
      const result = computeContentDNA(comp);
      expect(result.ctaFrameworks).toContain("explicit");
    });

    it("A11: detects trust CTA (review, testimonial)", () => {
      const posts = Array.from({ length: 10 }, (_, i) =>
        makePost({ id: `p${i}`, caption: "See what our client said about our service - another 5 star review from a happy customer!" })
      );
      const comp = makeCompetitor("c1", "TrustCTABrand", posts);
      const result = computeContentDNA(comp);
      expect(result.ctaFrameworks).toContain("trust");
    });

    it("A12: detects narrative CTA", () => {
      const posts = Array.from({ length: 10 }, (_, i) =>
        makePost({ id: `p${i}`, caption: "I decided to change everything and that's when my life changed completely for the better" })
      );
      const comp = makeCompetitor("c1", "NarrativeCTABrand", posts);
      const result = computeContentDNA(comp);
      expect(result.ctaFrameworks).toContain("narrative");
    });

    it("A13: detects problem_solution narrative framework", () => {
      const posts = Array.from({ length: 10 }, (_, i) =>
        makePost({ id: `p${i}`, caption: "The biggest problem most brands face is low reach. Here's how we solve it with our proven solution methodology" })
      );
      const comp = makeCompetitor("c1", "ProbSolBrand", posts);
      const result = computeContentDNA(comp);
      expect(result.narrativeFrameworks).toContain("problem_solution");
    });

    it("A14: detects before_after narrative framework", () => {
      const posts = Array.from({ length: 10 }, (_, i) =>
        makePost({ id: `p${i}`, caption: "Before we implemented this strategy, our engagement was low. After the transformation, everything changed!" })
      );
      const comp = makeCompetitor("c1", "BeforeAfterBrand", posts);
      const result = computeContentDNA(comp);
      expect(result.narrativeFrameworks).toContain("before_after");
    });

    it("A15: detects listicle narrative framework", () => {
      const posts = Array.from({ length: 10 }, (_, i) =>
        makePost({ id: `p${i}`, caption: "5 tips to boost your Instagram engagement and grow your following this month" })
      );
      const comp = makeCompetitor("c1", "ListicleBrand", posts);
      const result = computeContentDNA(comp);
      expect(result.narrativeFrameworks).toContain("listicle");
    });

    it("A16: detects how_to narrative framework", () => {
      const posts = Array.from({ length: 10 }, (_, i) =>
        makePost({ id: `p${i}`, caption: "How to create a content calendar step by step — a complete guide for beginners" })
      );
      const comp = makeCompetitor("c1", "HowToBrand", posts);
      const result = computeContentDNA(comp);
      expect(result.narrativeFrameworks).toContain("how_to");
    });

    it("A17: detects story_lesson narrative framework", () => {
      const posts = Array.from({ length: 10 }, (_, i) =>
        makePost({ id: `p${i}`, caption: "The biggest lesson I learned from my first failed business venture was about persistence" })
      );
      const comp = makeCompetitor("c1", "StoryLessonBrand", posts);
      const result = computeContentDNA(comp);
      expect(result.narrativeFrameworks).toContain("story_lesson");
    });

    it("A18: empty/very short captions → missingSignalFlags populated", () => {
      const posts = Array.from({ length: 10 }, (_, i) =>
        makePost({ id: `p${i}`, caption: "Hi" })
      );
      const comp = makeCompetitor("c1", "EmptyCaptionBrand", posts);
      const result = computeContentDNA(comp);
      expect(result.missingSignalFlags.length).toBeGreaterThan(0);
      expect(result.missingSignalFlags.some(f => f.includes("too short") || f.includes("No hook") || f.includes("No narrative") || f.includes("No CTA"))).toBe(true);
    });

    it("A19: evidence references real postIds, never fabricated", () => {
      const posts = Array.from({ length: 10 }, (_, i) =>
        makePost({ id: `real-post-${i}`, caption: "This is SHOCKING news — a secret method that 73% of experts use to get proven results" })
      );
      const comp = makeCompetitor("c1", "EvidenceBrand", posts);
      const result = computeContentDNA(comp);
      expect(result.evidence.length).toBeGreaterThan(0);
      for (const ev of result.evidence) {
        expect(ev.postId).toMatch(/^real-post-\d+$/);
        expect(ev.snippet.length).toBeLessThanOrEqual(50);
        expect(ev.detectedType).toBeTruthy();
      }
    });

    it("A20: detects Arabic hook patterns", () => {
      const posts = Array.from({ length: 10 }, (_, i) =>
        makePost({ id: `p${i}`, caption: "اكتشف السر الذي لا يعرفه معظم الناس عن التسويق الرقمي" })
      );
      const comp = makeCompetitor("c1", "ArabicBrand", posts);
      const result = computeContentDNA(comp);
      expect(result.hookArchetypes.length).toBeGreaterThan(0);
    });

    it("A21: detects multiple archetypes from mixed content", () => {
      const posts = [
        makePost({ id: "p1", caption: "SHOCKING: The secret that 90% of marketers don't know about" }),
        makePost({ id: "p2", caption: "How to create better content — a step by step guide for you" }),
        makePost({ id: "p3", caption: "Shop now and get our exclusive deal! Link in bio today" }),
        makePost({ id: "p4", caption: "I remember when I first started my journey into business" }),
        makePost({ id: "p5", caption: "Do you struggle with low engagement on your posts every day?" }),
        makePost({ id: "p6", caption: "Before our strategy: 100 likes. After the transformation: 10000 likes!" }),
        makePost({ id: "p7", caption: "5 tips to boost your Instagram reach and grow your audience" }),
        makePost({ id: "p8", caption: "See what our client said in this 5 star review of our service" }),
      ];
      const comp = makeCompetitor("c1", "MixedBrand", posts);
      const result = computeContentDNA(comp);
      expect(result.hookArchetypes.length).toBeGreaterThanOrEqual(3);
      expect(result.narrativeFrameworks.length).toBeGreaterThanOrEqual(2);
      expect(result.ctaFrameworks.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("B) Pipeline Integration", () => {
    it("B1: computeAllContentDNA returns array matching competitor count", () => {
      const competitors = [
        makeCompetitor("c1", "Brand1", Array.from({ length: 10 }, (_, i) => makePost({ id: `p1-${i}`, caption: "How to grow your brand with proven strategies that actually work" }))),
        makeCompetitor("c2", "Brand2", Array.from({ length: 10 }, (_, i) => makePost({ id: `p2-${i}`, caption: "This SHOCKING revelation will change everything about your marketing" }))),
      ];
      const results = computeAllContentDNA(competitors);
      expect(results).toHaveLength(2);
      expect(results[0].competitorId).toBe("c1");
      expect(results[1].competitorId).toBe("c2");
    });

    it("B2: static scan — only content-dna.ts exports computeContentDNA", () => {
      const contentDnaPath = path.join(__dirname, "../market-intelligence-v3/content-dna.ts");
      const contentDnaSrc = fs.readFileSync(contentDnaPath, "utf-8");
      expect(contentDnaSrc).toContain("export function computeContentDNA");
      expect(contentDnaSrc).toContain("export function computeAllContentDNA");

      const miv3Dir = path.join(__dirname, "../market-intelligence-v3");
      const files = fs.readdirSync(miv3Dir).filter(f => f.endsWith(".ts") && f !== "content-dna.ts" && !f.endsWith(".test.ts"));
      for (const file of files) {
        const src = fs.readFileSync(path.join(miv3Dir, file), "utf-8");
        expect(src).not.toMatch(/export\s+function\s+computeContentDNA\b/);
        expect(src).not.toMatch(/export\s+function\s+computeAllContentDNA\b/);
      }
    });

    it("B3: engine.ts imports computeAllContentDNA from content-dna", () => {
      const enginePath = path.join(__dirname, "../market-intelligence-v3/engine.ts");
      const engineSrc = fs.readFileSync(enginePath, "utf-8");
      expect(engineSrc).toContain('import { computeAllContentDNA } from "./content-dna"');
    });

    it("B4: pipeline order — Content DNA computed between Signals and Intent", () => {
      const enginePath = path.join(__dirname, "../market-intelligence-v3/engine.ts");
      const engineSrc = fs.readFileSync(enginePath, "utf-8");
      const signalsIdx = engineSrc.indexOf("computeAllSignals(competitors)");
      const dnaIdx = engineSrc.indexOf("computeAllContentDNA(competitors)");
      const intentsIdx = engineSrc.indexOf("classifyAllIntents(signalResults)");
      expect(signalsIdx).toBeGreaterThan(-1);
      expect(dnaIdx).toBeGreaterThan(-1);
      expect(intentsIdx).toBeGreaterThan(-1);
      expect(dnaIdx).toBeGreaterThan(signalsIdx);
      expect(dnaIdx).toBeLessThan(intentsIdx);
    });

    it("B5: contentDnaData included in snapshotPayload", () => {
      const enginePath = path.join(__dirname, "../market-intelligence-v3/engine.ts");
      const engineSrc = fs.readFileSync(enginePath, "utf-8");
      expect(engineSrc).toContain("contentDnaData: JSON.stringify(contentDnaResults)");
    });

    it("B6: contentDnaData present in MIv3DiagnosticResult type", () => {
      const typesPath = path.join(__dirname, "../market-intelligence-v3/types.ts");
      const typesSrc = fs.readFileSync(typesPath, "utf-8");
      expect(typesSrc).toMatch(/contentDnaData.*CompetitorContentDNA\[\]\s*\|\s*null/);
    });

    it("B7: contentDnaData parsed in buildResultFromSnapshot", () => {
      const enginePath = path.join(__dirname, "../market-intelligence-v3/engine.ts");
      const engineSrc = fs.readFileSync(enginePath, "utf-8");
      expect(engineSrc).toContain("parseJsonSafe(snapshot.contentDnaData");
    });
  });

  describe("C) Guard Behavior", () => {
    it("C1: < 8 posts → dnaConfidence low + missingSignalFlags", () => {
      const posts = Array.from({ length: 5 }, (_, i) =>
        makePost({ id: `p${i}`, caption: "This is a short caption for testing the confidence guard" })
      );
      const comp = makeCompetitor("c1", "LowDataBrand", posts);
      const result = computeContentDNA(comp);
      expect(result.dnaConfidence).toBeLessThanOrEqual(0.3);
      expect(result.missingSignalFlags.some(f => f.includes("Insufficient posts"))).toBe(true);
    });

    it("C2: 0 posts → dnaConfidence = 0", () => {
      const comp = makeCompetitor("c1", "EmptyBrand", []);
      const result = computeContentDNA(comp);
      expect(result.dnaConfidence).toBe(0);
      expect(result.missingSignalFlags.some(f => f.includes("Insufficient posts"))).toBe(true);
    });

    it("C3: sufficient posts (>= threshold) → dnaConfidence > 0.3", () => {
      const posts = Array.from({ length: SIMILARITY_MIN_EVIDENCE_THRESHOLD + 2 }, (_, i) =>
        makePost({ id: `p${i}`, caption: "How to build a better marketing strategy with proven methods step by step" })
      );
      const comp = makeCompetitor("c1", "GoodDataBrand", posts);
      const result = computeContentDNA(comp);
      expect(result.dnaConfidence).toBeGreaterThan(0.3);
    });

    it("C4: rich content with many detections → higher dnaConfidence", () => {
      const posts = Array.from({ length: 20 }, (_, i) => {
        const captions = [
          "SHOCKING: The secret that 90% of marketers miss completely",
          "How to create viral content — step by step guide for you",
          "Shop now and grab this exclusive deal! Link in bio today",
          "I remember when my journey started and the lesson I learned",
          "Do you struggle with low reach? Here's the proven solution",
        ];
        return makePost({ id: `p${i}`, caption: captions[i % captions.length] });
      });
      const comp = makeCompetitor("c1", "RichBrand", posts);
      const result = computeContentDNA(comp);
      expect(result.dnaConfidence).toBeGreaterThan(0.5);
    });

    it("C5: SIMILARITY_MIN_EVIDENCE_THRESHOLD equals 8", () => {
      expect(SIMILARITY_MIN_EVIDENCE_THRESHOLD).toBe(8);
    });
  });

  describe("D) Delta Intelligence", () => {
    const baseCurrSnapshot = {
      competitorHash: "abc123",
      signalData: [
        { competitorId: "c1", competitorName: "Brand1", signals: { postingFrequencyTrend: 0.5, engagementVolatility: 0.3, ctaIntensityShift: 0.2, offerLanguageChange: 0.1, hashtagDriftScore: 0.4, bioModificationFrequency: 0.0, sentimentDrift: 0.1, reviewVelocityChange: 0.0, contentExperimentRate: 0.3 } },
      ],
      intentData: [
        { competitorId: "c1", competitorName: "Brand1", intentCategory: "AGGRESSIVE_SCALING" },
      ],
      trajectoryData: { marketHeatingIndex: 0.6, narrativeConvergenceScore: 0.4, offerCompressionIndex: 0.3, angleSaturationLevel: 0.5, revivalPotential: 0.2 },
      dominanceData: [
        { competitorId: "c1", competitorName: "Brand1", dominanceScore: 75, dominanceLevel: "DOMINANT" },
      ],
    };

    it("D1: same competitorHash → deltaReport computed with field-level deltas", () => {
      const prevSnapshot = {
        id: "prev-snap-1",
        competitorHash: "abc123",
        createdAt: new Date("2026-02-01"),
        signalData: JSON.stringify([
          { competitorId: "c1", competitorName: "Brand1", signals: { postingFrequencyTrend: 0.3, engagementVolatility: 0.2, ctaIntensityShift: 0.1, offerLanguageChange: 0.0, hashtagDriftScore: 0.3, bioModificationFrequency: 0.0, sentimentDrift: 0.0, reviewVelocityChange: 0.0, contentExperimentRate: 0.2 } },
        ]),
        intentData: JSON.stringify([
          { competitorId: "c1", competitorName: "Brand1", intentCategory: "DEFENSIVE" },
        ]),
        trajectoryData: JSON.stringify({ marketHeatingIndex: 0.4, narrativeConvergenceScore: 0.3, offerCompressionIndex: 0.2, angleSaturationLevel: 0.4, revivalPotential: 0.1 }),
        dominanceData: JSON.stringify([
          { competitorId: "c1", competitorName: "Brand1", dominanceScore: 60, dominanceLevel: "STRUCTURALLY_STRONG" },
        ]),
      };

      const result = computeSnapshotDeltas(prevSnapshot, baseCurrSnapshot);
      expect(result).not.toBeNull();
      expect(result!.competitorHashMatch).toBe(true);
      expect(result!.signalDeltas.length).toBeGreaterThan(0);
      expect(result!.hasMeaningfulChanges).toBe(true);
    });

    it("D2: different competitorHash → deltaReport = null", () => {
      const prevSnapshot = {
        id: "prev-snap-2",
        competitorHash: "different_hash",
        createdAt: new Date("2026-02-01"),
        signalData: JSON.stringify([]),
        intentData: JSON.stringify([]),
        trajectoryData: JSON.stringify({}),
        dominanceData: JSON.stringify([]),
      };

      const result = computeSnapshotDeltas(prevSnapshot, baseCurrSnapshot);
      expect(result).toBeNull();
    });

    it("D3: no previous snapshot → deltaReport = null", () => {
      const result = computeSnapshotDeltas(null, baseCurrSnapshot);
      expect(result).toBeNull();
    });

    it("D4: intent change tracking — DEFENSIVE → AGGRESSIVE_SCALING", () => {
      const prevSnapshot = {
        id: "prev-snap-4",
        competitorHash: "abc123",
        createdAt: new Date("2026-02-01"),
        signalData: JSON.stringify([
          { competitorId: "c1", competitorName: "Brand1", signals: { postingFrequencyTrend: 0.5, engagementVolatility: 0.3, ctaIntensityShift: 0.2, offerLanguageChange: 0.1, hashtagDriftScore: 0.4, bioModificationFrequency: 0.0, sentimentDrift: 0.1, reviewVelocityChange: 0.0, contentExperimentRate: 0.3 } },
        ]),
        intentData: JSON.stringify([
          { competitorId: "c1", competitorName: "Brand1", intentCategory: "DEFENSIVE" },
        ]),
        trajectoryData: JSON.stringify({ marketHeatingIndex: 0.6, narrativeConvergenceScore: 0.4, offerCompressionIndex: 0.3, angleSaturationLevel: 0.5, revivalPotential: 0.2 }),
        dominanceData: JSON.stringify([
          { competitorId: "c1", competitorName: "Brand1", dominanceScore: 75, dominanceLevel: "DOMINANT" },
        ]),
      };

      const result = computeSnapshotDeltas(prevSnapshot, baseCurrSnapshot);
      expect(result).not.toBeNull();
      const intentChange = result!.intentChanges.find(c => c.competitorId === "c1");
      expect(intentChange).toBeDefined();
      expect(intentChange!.previousIntent).toBe("DEFENSIVE");
      expect(intentChange!.currentIntent).toBe("AGGRESSIVE_SCALING");
      expect(intentChange!.changed).toBe(true);
    });

    it("D5: dominance level change detected", () => {
      const prevSnapshot = {
        id: "prev-snap-5",
        competitorHash: "abc123",
        createdAt: new Date("2026-02-01"),
        signalData: JSON.stringify(baseCurrSnapshot.signalData),
        intentData: JSON.stringify(baseCurrSnapshot.intentData),
        trajectoryData: JSON.stringify(baseCurrSnapshot.trajectoryData),
        dominanceData: JSON.stringify([
          { competitorId: "c1", competitorName: "Brand1", dominanceScore: 40, dominanceLevel: "EXPOSED" },
        ]),
      };

      const result = computeSnapshotDeltas(prevSnapshot, baseCurrSnapshot);
      expect(result).not.toBeNull();
      const domChange = result!.dominanceChanges.find(c => c.competitorId === "c1");
      expect(domChange).toBeDefined();
      expect(domChange!.levelChanged).toBe(true);
      expect(domChange!.previousLevel).toBe("EXPOSED");
      expect(domChange!.currentLevel).toBe("DOMINANT");
      expect(domChange!.scoreDelta).toBe(35);
    });

    it("D6: trajectory deltas computed for changed fields", () => {
      const prevSnapshot = {
        id: "prev-snap-6",
        competitorHash: "abc123",
        createdAt: new Date("2026-02-01"),
        signalData: JSON.stringify(baseCurrSnapshot.signalData),
        intentData: JSON.stringify(baseCurrSnapshot.intentData),
        trajectoryData: JSON.stringify({ marketHeatingIndex: 0.2, narrativeConvergenceScore: 0.4, offerCompressionIndex: 0.3, angleSaturationLevel: 0.5, revivalPotential: 0.2 }),
        dominanceData: JSON.stringify(baseCurrSnapshot.dominanceData),
      };

      const result = computeSnapshotDeltas(prevSnapshot, baseCurrSnapshot);
      expect(result).not.toBeNull();
      const heatingDelta = result!.trajectoryDeltas.find(t => t.field === "marketHeatingIndex");
      expect(heatingDelta).toBeDefined();
      expect(heatingDelta!.delta).toBeCloseTo(0.4, 1);
    });

    it("D7: no meaningful changes when snapshots are identical", () => {
      const prevSnapshot = {
        id: "prev-snap-7",
        competitorHash: "abc123",
        createdAt: new Date("2026-02-01"),
        signalData: JSON.stringify(baseCurrSnapshot.signalData),
        intentData: JSON.stringify(baseCurrSnapshot.intentData),
        trajectoryData: JSON.stringify(baseCurrSnapshot.trajectoryData),
        dominanceData: JSON.stringify(baseCurrSnapshot.dominanceData),
      };

      const result = computeSnapshotDeltas(prevSnapshot, baseCurrSnapshot);
      expect(result).not.toBeNull();
      expect(result!.hasMeaningfulChanges).toBe(false);
    });
  });

  describe("E) Calibration Isolation (Static Scans)", () => {
    const miv3Dir = path.join(__dirname, "../market-intelligence-v3");

    it("E1: baselines.ts has zero MIv3 imports", () => {
      const baselinesPath = path.join(__dirname, "../baselines.ts");
      const src = fs.readFileSync(baselinesPath, "utf-8");
      expect(src).not.toContain("market-intelligence-v3");
      expect(src).not.toContain("miSnapshots");
      expect(src).not.toContain("miFetchJobs");
      expect(src).not.toContain("miSignalLogs");
      expect(src).not.toContain("miTelemetry");
    });

    it("E2: confidence-engine.ts has zero baselines.ts imports", () => {
      const confPath = path.join(miv3Dir, "confidence-engine.ts");
      const src = fs.readFileSync(confPath, "utf-8");
      expect(src).not.toContain("baselines");
      expect(src).not.toContain("performanceSnapshots");
      expect(src).not.toContain("baselineHistory");
      expect(src).not.toContain("accountState");
    });

    it("E3: only content-dna.ts computes Content DNA (single ownership)", () => {
      const files = fs.readdirSync(miv3Dir).filter(f => f.endsWith(".ts") && f !== "content-dna.ts" && !f.endsWith(".test.ts"));
      for (const file of files) {
        const src = fs.readFileSync(path.join(miv3Dir, file), "utf-8");
        expect(src).not.toMatch(/export\s+function\s+computeContentDNA\b/);
      }
    });

    it("E4: only dominance-module.ts computes dominance (single ownership)", () => {
      const files = fs.readdirSync(miv3Dir).filter(f => f.endsWith(".ts") && f !== "dominance-module.ts" && !f.endsWith(".test.ts"));
      for (const file of files) {
        const src = fs.readFileSync(path.join(miv3Dir, file), "utf-8");
        expect(src).not.toMatch(/export\s+function\s+computeAllDominance\b/);
      }
    });

    it("E5: only confidence-engine.ts computes confidence (single ownership)", () => {
      const files = fs.readdirSync(miv3Dir).filter(f => f.endsWith(".ts") && f !== "confidence-engine.ts" && !f.endsWith(".test.ts"));
      for (const file of files) {
        const src = fs.readFileSync(path.join(miv3Dir, file), "utf-8");
        expect(src).not.toMatch(/export\s+function\s+computeConfidence\b/);
      }
    });

    it("E6: Content DNA UI renderer has zero API calls", () => {
      const uiPath = path.join(__dirname, "../../components/CompetitiveIntelligence.tsx");
      const src = fs.readFileSync(uiPath, "utf-8");
      const dnaSection = src.substring(
        src.indexOf("contentDnaData"),
        src.indexOf("contentDnaData") + 2000
      );
      expect(dnaSection).not.toContain("fetch(");
      expect(dnaSection).not.toContain("mutate(");
      expect(dnaSection).not.toContain("useQuery");
    });

    it("E7: Delta renderer has zero API calls", () => {
      const uiPath = path.join(__dirname, "../../components/CompetitiveIntelligence.tsx");
      const src = fs.readFileSync(uiPath, "utf-8");
      const deltaSection = src.substring(
        src.indexOf("deltaReport"),
        src.indexOf("deltaReport") + 2000
      );
      expect(deltaSection).not.toContain("fetch(");
      expect(deltaSection).not.toContain("mutate(");
      expect(deltaSection).not.toContain("useQuery");
    });
  });
});
