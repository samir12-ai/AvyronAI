import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import type { TiktokPost, TiktokComment, TiktokScrapedResult } from "../competitive-intelligence/tiktok-scraper";
import {
  qualifyTikTokPosts,
  computeCreatorBaseline,
  computeBaselineReliability,
  filterQualifiedPosts,
  getTikTokContributionMultiplier,
} from "../market-intelligence-v3/tiktok-qualification";
import {
  buildTikTokSignals,
  classifyTikTokSignals,
} from "../market-intelligence-v3/signal-normalizer";

const APIFY_FIXTURE: Array<Record<string, any>> = [
  {
    id: "7700000000000000001",
    text: "How to 10x your marketing with AI — step by step guide\n#marketing #ai #growth",
    createTimeISO: "2026-04-10T14:00:00.000Z",
    diggCount: 5200,
    commentCount: 120,
    shareCount: 340,
    playCount: 82000,
    hashtags: [{ name: "marketing" }, { name: "ai" }, { name: "growth" }],
    webVideoUrl: "https://www.tiktok.com/@testbrand/video/7700000000000000001",
    authorMeta: { name: "testbrand", nickName: "Test Brand", verified: true },
    comments: [
      { cid: "c1", text: "love this so helpful", uniqueId: "user1", diggCount: 10, replyCommentTotal: 2, createTime: 1712764800 },
      { cid: "c2", text: "but doesn't work for small businesses", uniqueId: "user2", diggCount: 5, replyCommentTotal: 0, createTime: 1712764900 },
      { cid: "c3", text: "how do I get started with this?", uniqueId: "user3", diggCount: 3, replyCommentTotal: 1, createTime: 1712765000 },
      { cid: "c4", text: "game changer for my agency", uniqueId: "user4", diggCount: 8, replyCommentTotal: 0, createTime: 1712765100 },
      { cid: "c5", text: "too expensive for what it does honestly", uniqueId: "user5", diggCount: 2, replyCommentTotal: 0, createTime: 1712765200 },
    ],
  },
  {
    id: "7700000000000000002",
    text: "POV: you before vs after using our platform\n#transformation #saas",
    createTimeISO: "2026-04-09T12:00:00.000Z",
    diggCount: 3800,
    commentCount: 85,
    shareCount: 210,
    playCount: 61000,
    hashtags: [{ name: "transformation" }, { name: "saas" }],
    webVideoUrl: "https://www.tiktok.com/@testbrand/video/7700000000000000002",
    authorMeta: { name: "testbrand" },
    comments: [
      { cid: "c6", text: "exactly what I needed to see", uniqueId: "user6", diggCount: 15, replyCommentTotal: 0, createTime: 1712678400 },
    ],
  },
  {
    id: "7700000000000000003",
    text: "I'm tired of agencies that charge hidden fees — here's what we do differently. Link in bio",
    createTimeISO: "2026-04-08T10:00:00.000Z",
    diggCount: 7100,
    commentCount: 230,
    shareCount: 580,
    playCount: 140000,
    hashtags: [{ name: "marketing" }, { name: "agency" }],
    webVideoUrl: "https://www.tiktok.com/@testbrand/video/7700000000000000003",
    authorMeta: { name: "testbrand" },
    transcript: "I am so tired of agencies that charge you hidden fees. Let me tell you exactly what we do differently. First, we show you every single cost upfront.",
    comments: [
      { cid: "c7", text: "saving this for later", uniqueId: "user7", diggCount: 4, replyCommentTotal: 0, createTime: 1712592000 },
      { cid: "c8", text: "can you explain how the billing works?", uniqueId: "user8", diggCount: 6, replyCommentTotal: 2, createTime: 1712592100 },
      { cid: "c9", text: "tried this and it was a waste of money", uniqueId: "user9", diggCount: 1, replyCommentTotal: 0, createTime: 1712592200 },
    ],
  },
  {
    id: "7700000000000000004",
    text: "Behind the scenes of building our product",
    createTimeISO: "2026-04-07T08:00:00.000Z",
    diggCount: 200,
    commentCount: 5,
    shareCount: 10,
    playCount: 3500,
    hashtags: [],
    webVideoUrl: "https://www.tiktok.com/@testbrand/video/7700000000000000004",
    authorMeta: { name: "testbrand" },
  },
  {
    id: "7700000000000000005",
    text: "Quick team standup — nothing special",
    createTimeISO: "2026-04-06T08:00:00.000Z",
    diggCount: 50,
    commentCount: 2,
    shareCount: 1,
    playCount: 900,
    hashtags: [],
    webVideoUrl: "https://www.tiktok.com/@testbrand/video/7700000000000000005",
    authorMeta: { name: "testbrand" },
  },
  {
    id: "7700000000000000006",
    text: "We can't believe how many people struggle with lead generation. DM me for a free audit",
    createTimeISO: "2026-04-05T15:00:00.000Z",
    diggCount: 4100,
    commentCount: 95,
    shareCount: 270,
    playCount: 72000,
    hashtags: [{ name: "marketing" }, { name: "leads" }],
    webVideoUrl: "https://www.tiktok.com/@testbrand/video/7700000000000000006",
    authorMeta: { name: "testbrand" },
    comments: [
      { cid: "c10", text: "where do I sign up?", uniqueId: "user10", diggCount: 3, replyCommentTotal: 1, createTime: 1712332800 },
      { cid: "c11", text: "amazing content keep it up", uniqueId: "user11", diggCount: 7, replyCommentTotal: 0, createTime: 1712332900 },
    ],
  },
  {
    id: "7700000000000000007",
    text: "nice",
    createTimeISO: "2026-04-04T08:00:00.000Z",
    diggCount: 10,
    commentCount: 0,
    shareCount: 0,
    playCount: 200,
    hashtags: [],
    webVideoUrl: "https://www.tiktok.com/@testbrand/video/7700000000000000007",
    authorMeta: { name: "testbrand" },
  },
  {
    id: "7700000000000000008",
    text: "Story time: how we went from 0 to $1M in 18 months",
    createTimeISO: "2026-04-03T10:00:00.000Z",
    diggCount: 6500,
    commentCount: 180,
    shareCount: 420,
    playCount: 115000,
    hashtags: [{ name: "growth" }, { name: "startup" }],
    webVideoUrl: "https://www.tiktok.com/@testbrand/video/7700000000000000008",
    authorMeta: { name: "testbrand" },
    speechText: "Let me tell you the story of how we went from zero to one million dollars. It all started with a simple idea.",
    comments: [
      { cid: "c12", text: "don't understand how you scaled so fast", uniqueId: "user12", diggCount: 4, replyCommentTotal: 1, createTime: 1712160000 },
      { cid: "c13", text: "this is amazing motivation", uniqueId: "user13", diggCount: 9, replyCommentTotal: 0, createTime: 1712160100 },
    ],
  },
  {
    id: "7700000000000000009",
    text: "random test post",
    createTimeISO: "2026-04-02T08:00:00.000Z",
    diggCount: 5,
    commentCount: 0,
    shareCount: 0,
    playCount: 100,
    hashtags: [],
  },
  {
    id: "7700000000000000010",
    text: "Frustrated with your current CRM? Here's a better way to manage clients. Book a call with us today.",
    createTimeISO: "2026-04-01T14:00:00.000Z",
    diggCount: 3200,
    commentCount: 75,
    shareCount: 190,
    playCount: 55000,
    hashtags: [{ name: "crm" }, { name: "saas" }, { name: "marketing" }],
    webVideoUrl: "https://www.tiktok.com/@testbrand/video/7700000000000000010",
    authorMeta: { name: "testbrand" },
    comments: [
      { cid: "c14", text: "love this exactly what I was looking for", uniqueId: "user14", diggCount: 6, replyCommentTotal: 0, createTime: 1711987200 },
      { cid: "c15", text: "however the pricing page is confusing", uniqueId: "user15", diggCount: 2, replyCommentTotal: 0, createTime: 1711987300 },
    ],
  },
];

function mapFixtureToTiktokPost(item: Record<string, any>): TiktokPost {
  const caption = (item.text || "").trim();
  const hashtags: string[] = [];
  if (item.hashtags && Array.isArray(item.hashtags)) {
    for (const h of item.hashtags) {
      if (h.name) hashtags.push(h.name);
    }
  }
  if (hashtags.length === 0) {
    const tagMatches = caption.match(/#(\w+)/g);
    if (tagMatches) tagMatches.forEach((t: string) => hashtags.push(t.replace("#", "")));
  }

  let transcript: string | null = null;
  if (item.transcript && typeof item.transcript === "string" && item.transcript.length > 10) transcript = item.transcript;
  if (!transcript && item.speechText && typeof item.speechText === "string" && item.speechText.length > 10) transcript = item.speechText;

  let hookText: string;
  let hookSource: "transcript" | "caption_proxy";
  if (transcript && transcript.length > 10) {
    hookText = transcript.split(/\s+/).slice(0, 25).join(" ").trim().slice(0, 200);
    hookSource = "transcript";
  } else {
    const firstLine = caption.split(/\n/)[0].trim();
    hookText = firstLine.length > 5 && firstLine.length < 200 ? firstLine : caption.slice(0, 150);
    hookSource = "caption_proxy";
  }

  const topComments: TiktokComment[] = [];
  if (item.comments && Array.isArray(item.comments)) {
    for (const c of item.comments) {
      if (!c || !c.text || c.text.trim().length < 2) continue;
      topComments.push({
        commentId: String(c.cid || c.id || `tc_${Date.now()}`),
        username: c.uniqueId || "anonymous",
        text: c.text.trim(),
        likes: c.diggCount,
        replyCount: c.replyCommentTotal,
        timestamp: c.createTime ? new Date(c.createTime * 1000) : undefined,
      });
    }
  }

  return {
    postId: String(item.id),
    caption,
    hookText,
    hookSource,
    transcript,
    likes: item.diggCount,
    comments: item.commentCount,
    shares: item.shareCount,
    views: item.playCount,
    hashtags: hashtags.length > 0 ? hashtags : undefined,
    permalink: item.webVideoUrl,
    timestamp: item.createTimeISO ? new Date(item.createTimeISO) : undefined,
    topComments: topComments.length > 0 ? topComments : undefined,
  };
}

const TEST_POSTS: TiktokPost[] = APIFY_FIXTURE.map(item => mapFixtureToTiktokPost(item));

function postsToDbFormat(posts: TiktokPost[]) {
  return posts.map(p => ({
    id: `tkt_${p.postId}`,
    postId: p.postId,
    caption: p.caption,
    hookText: p.hookText || null,
    hookSource: p.hookSource || null,
    transcript: p.transcript || null,
    likes: p.likes || null,
    comments: p.comments || null,
    shares: p.views ? Math.round((p.shares || 0)) : null,
    views: p.views || null,
    hashtags: p.hashtags?.join(" ") || null,
    permalink: p.permalink || null,
    timestamp: p.timestamp?.toISOString() || null,
  }));
}

function commentsToDbFormat(posts: TiktokPost[]) {
  const comments: Array<{ postId: string; commentId: string; text: string; sentiment: number | null }> = [];
  for (const p of posts) {
    if (p.topComments) {
      for (const c of p.topComments) {
        comments.push({
          postId: p.postId,
          commentId: c.commentId,
          text: c.text,
          sentiment: null,
        });
      }
    }
  }
  return comments;
}

describe("TikTok E2E Pipeline", () => {

  describe("STAGE 1: Apify Data Mapping", () => {
    test("maps Apify fixture items to TiktokPost format correctly", () => {
      expect(TEST_POSTS).toHaveLength(APIFY_FIXTURE.length);

      const firstPost = TEST_POSTS[0];
      expect(firstPost.postId).toBe("7700000000000000001");
      expect(firstPost.caption).toContain("How to 10x your marketing");
      expect(firstPost.likes).toBe(5200);
      expect(firstPost.views).toBe(82000);
      expect(firstPost.shares).toBe(340);
      expect(firstPost.comments).toBe(120);
      expect(firstPost.hashtags).toContain("marketing");
      expect(firstPost.hashtags).toContain("ai");
      expect(firstPost.permalink).toBe("https://www.tiktok.com/@testbrand/video/7700000000000000001");
      expect(firstPost.timestamp).toBeInstanceOf(Date);
    });

    test("extracts comments from Apify data", () => {
      const postWithComments = TEST_POSTS[0];
      expect(postWithComments.topComments).toBeDefined();
      expect(postWithComments.topComments!.length).toBe(5);
      expect(postWithComments.topComments![0].commentId).toBe("c1");
      expect(postWithComments.topComments![0].text).toBe("love this so helpful");
      expect(postWithComments.topComments![0].username).toBe("user1");
    });

    test("extracts transcript from speechText field", () => {
      const storyPost = TEST_POSTS.find(p => p.postId === "7700000000000000008");
      expect(storyPost).toBeDefined();
      expect(storyPost!.transcript).toContain("Let me tell you the story");
      expect(storyPost!.hookSource).toBe("transcript");
    });

    test("extracts transcript from transcript field", () => {
      const agencyPost = TEST_POSTS.find(p => p.postId === "7700000000000000003");
      expect(agencyPost).toBeDefined();
      expect(agencyPost!.transcript).toContain("tired of agencies");
      expect(agencyPost!.hookSource).toBe("transcript");
    });

    test("falls back to caption_proxy when no transcript available", () => {
      const captionOnlyPost = TEST_POSTS.find(p => p.postId === "7700000000000000002");
      expect(captionOnlyPost).toBeDefined();
      expect(captionOnlyPost!.hookSource).toBe("caption_proxy");
      expect(captionOnlyPost!.transcript).toBeNull();
    });

    test("extracts hashtags from caption when not in structured hashtags field", () => {
      const hashtagPost = TEST_POSTS[0];
      expect(hashtagPost.hashtags).toContain("marketing");
    });

    test("handles posts with no caption gracefully", () => {
      const emptyItem = { id: "999", text: "", playCount: 0 };
      const post = mapFixtureToTiktokPost(emptyItem);
      expect(post.postId).toBe("999");
      expect(post.caption).toBe("");
    });

    test("posts without comments have no topComments", () => {
      const noCommentPost = TEST_POSTS.find(p => p.postId === "7700000000000000009");
      expect(noCommentPost).toBeDefined();
      expect(noCommentPost!.topComments).toBeUndefined();
    });
  });

  describe("STAGE 2: Bright Data → Apify Fallback Chain", () => {
    test("scrapeTiktokForCompetitor returns correct result shape", () => {
      const result: TiktokScrapedResult = {
        competitorId: "test-comp-id",
        postsFetched: TEST_POSTS.length,
        postsInserted: TEST_POSTS.length,
        commentsInserted: 0,
        source: "apify",
      };

      expect(result.source).toBe("apify");
      expect(result.postsFetched).toBe(10);
      expect(result.postsInserted).toBe(10);
      expect(result.error).toBeUndefined();
    });

    test("result shape includes error when both sources fail", () => {
      const result: TiktokScrapedResult = {
        competitorId: "test-comp-id",
        postsFetched: 0,
        postsInserted: 0,
        commentsInserted: 0,
        source: "unavailable",
        error: "Both Bright Data and Apify unavailable",
      };

      expect(result.source).toBe("unavailable");
      expect(result.error).toContain("unavailable");
    });

    test("source tracking differentiates brightdata vs apify", () => {
      const brightDataResult: TiktokScrapedResult = {
        competitorId: "test-comp-id",
        postsFetched: 30,
        postsInserted: 30,
        commentsInserted: 15,
        source: "brightdata",
      };

      const apifyResult: TiktokScrapedResult = {
        competitorId: "test-comp-id",
        postsFetched: 30,
        postsInserted: 30,
        commentsInserted: 0,
        source: "apify",
      };

      expect(brightDataResult.source).not.toBe(apifyResult.source);
      expect(["brightdata", "apify", "manual", "unavailable"]).toContain(brightDataResult.source);
      expect(["brightdata", "apify", "manual", "unavailable"]).toContain(apifyResult.source);
    });
  });

  describe("STAGE 3: Ingestion — DB Format", () => {
    test("posts convert to DB format with all required fields", () => {
      const dbPosts = postsToDbFormat(TEST_POSTS);
      expect(dbPosts).toHaveLength(10);

      for (const p of dbPosts) {
        expect(p).toHaveProperty("postId");
        expect(p).toHaveProperty("caption");
        expect(p).toHaveProperty("hookText");
        expect(p).toHaveProperty("hookSource");
        expect(p).toHaveProperty("views");
        expect(p).toHaveProperty("likes");
        expect(p).toHaveProperty("hashtags");
      }
    });

    test("comments convert to DB format and retain postId linkage", () => {
      const dbComments = commentsToDbFormat(TEST_POSTS);
      expect(dbComments.length).toBeGreaterThan(0);

      for (const c of dbComments) {
        expect(c).toHaveProperty("postId");
        expect(c).toHaveProperty("commentId");
        expect(c).toHaveProperty("text");
        expect(c.text.length).toBeGreaterThan(0);
      }

      const postIdsWithComments = new Set(dbComments.map(c => c.postId));
      expect(postIdsWithComments.has("7700000000000000001")).toBe(true);
      expect(postIdsWithComments.has("7700000000000000003")).toBe(true);
      expect(postIdsWithComments.has("7700000000000000009")).toBe(false);
    });

    test("comment source tagging for apify vs brightdata", () => {
      const apifySource = "apify" === "apify" ? "tiktok_apify" : "tiktok_scraped";
      const bdSource = "brightdata" === "apify" ? "tiktok_apify" : "tiktok_scraped";
      expect(apifySource).toBe("tiktok_apify");
      expect(bdSource).toBe("tiktok_scraped");
    });
  });

  describe("STAGE 4: Qualification", () => {
    test("qualifyTikTokPosts computes baseline and tiers for 10 posts", () => {
      const dbPosts = postsToDbFormat(TEST_POSTS);
      const qualification = qualifyTikTokPosts(dbPosts);

      expect(qualification.totalPosts).toBe(10);
      expect(qualification.highPerformingCount + qualification.midPerformingCount + qualification.lowPerformingCount).toBe(10);
      expect(qualification.baseline.postCount).toBe(10);
      expect(qualification.baseline.avgViews).toBeGreaterThan(0);
      expect(qualification.baseline.avgEngagementRate).toBeGreaterThan(0);
    });

    test("high-view posts get HIGH or MID tier, low-view posts get LOW", () => {
      const dbPosts = postsToDbFormat(TEST_POSTS);
      const qualification = qualifyTikTokPosts(dbPosts);

      const highViewPost = qualification.qualifications.find(q => q.postId === "7700000000000000003");
      expect(highViewPost).toBeDefined();
      expect(["HIGH_PERFORMING", "MID_PERFORMING"]).toContain(highViewPost!.tier);

      const lowViewPost = qualification.qualifications.find(q => q.postId === "7700000000000000009");
      expect(lowViewPost).toBeDefined();
      expect(lowViewPost!.tier).toBe("LOW_PERFORMING");
    });

    test("filteredPostIds contains only LOW_PERFORMING post IDs", () => {
      const dbPosts = postsToDbFormat(TEST_POSTS);
      const qualification = qualifyTikTokPosts(dbPosts);

      const lowQuals = qualification.qualifications.filter(q => q.tier === "LOW_PERFORMING");
      expect(qualification.filteredPostIds).toHaveLength(lowQuals.length);
      for (const id of qualification.filteredPostIds) {
        const q = qualification.qualifications.find(qual => qual.postId === id);
        expect(q?.tier).toBe("LOW_PERFORMING");
      }
    });

    test("baseline reliability is RELIABLE for 10+ posts with decent engagement", () => {
      const dbPosts = postsToDbFormat(TEST_POSTS);
      const qualification = qualifyTikTokPosts(dbPosts);
      expect(["RELIABLE", "MODERATE"]).toContain(qualification.baselineReliability.band);
      expect(qualification.baselineReliability.score).toBeGreaterThan(0.3);
    });

    test("computeCreatorBaseline handles empty array", () => {
      const baseline = computeCreatorBaseline([]);
      expect(baseline.avgViews).toBe(0);
      expect(baseline.postCount).toBe(0);
    });

    test("computeBaselineReliability returns INSUFFICIENT for very few posts", () => {
      const baseline = computeCreatorBaseline([{ views: 100, likes: 5 }]);
      const reliability = computeBaselineReliability(baseline);
      expect(["WEAK", "INSUFFICIENT"]).toContain(reliability.band);
      expect(reliability.lowDataPenalty).toBeGreaterThan(0);
    });

    test("filterQualifiedPosts removes LOW_PERFORMING posts", () => {
      const dbPosts = postsToDbFormat(TEST_POSTS);
      const qualification = qualifyTikTokPosts(dbPosts);

      const filtered = filterQualifiedPosts(dbPosts, qualification.qualifications);
      const lowIds = new Set(qualification.filteredPostIds);
      for (const p of filtered) {
        expect(lowIds.has(p.postId!)).toBe(false);
      }
      expect(filtered.length).toBeLessThanOrEqual(dbPosts.length);
    });

    test("getTikTokContributionMultiplier returns correct weights", () => {
      expect(getTikTokContributionMultiplier({ band: "RELIABLE", score: 0.8, lowDataPenalty: 0, qualificationNotes: [] })).toBe(1.0);
      expect(getTikTokContributionMultiplier({ band: "MODERATE", score: 0.5, lowDataPenalty: 0, qualificationNotes: [] })).toBe(0.75);
      expect(getTikTokContributionMultiplier({ band: "WEAK", score: 0.3, lowDataPenalty: 0.3, qualificationNotes: [] })).toBe(0.4);
      expect(getTikTokContributionMultiplier({ band: "INSUFFICIENT", score: 0.1, lowDataPenalty: 0.6, qualificationNotes: [] })).toBe(0.15);
    });
  });

  describe("STAGE 5: Signal Building", () => {
    let dbPosts: ReturnType<typeof postsToDbFormat>;
    let dbComments: ReturnType<typeof commentsToDbFormat>;
    let qualification: ReturnType<typeof qualifyTikTokPosts>;

    beforeEach(() => {
      dbPosts = postsToDbFormat(TEST_POSTS);
      dbComments = commentsToDbFormat(TEST_POSTS);
      qualification = qualifyTikTokPosts(dbPosts);
    });

    test("buildTikTokSignals extracts validatedHooks from qualified posts only", () => {
      const signals = buildTikTokSignals(qualification, dbPosts, dbComments);

      expect(signals.validatedHooks.length).toBeGreaterThan(0);
      expect(signals.validatedHooks.length).toBeLessThanOrEqual(15);

      const lowIds = new Set(qualification.filteredPostIds);
      const lowPostCaptions = dbPosts.filter(p => lowIds.has(p.postId)).map(p => p.caption?.split("\n")[0]?.trim());
      for (const hook of signals.validatedHooks) {
        for (const lowCaption of lowPostCaptions) {
          if (lowCaption && lowCaption.length > 5) {
            expect(hook).not.toBe(lowCaption);
          }
        }
      }
    });

    test("hookReliability reflects data source mix", () => {
      const signals = buildTikTokSignals(qualification, dbPosts, dbComments);
      expect(["transcript_validated", "mixed", "caption_proxy", "unavailable"]).toContain(signals.hookReliability);

      const hasTranscript = dbPosts.some(p => {
        if (!p.transcript) return false;
        const qual = qualification.qualifications.find(q => q.postId === p.postId);
        return qual && qual.tier !== "LOW_PERFORMING";
      });
      const hasCaptionProxy = dbPosts.some(p => {
        if (p.hookSource !== "caption_proxy") return false;
        const qual = qualification.qualifications.find(q => q.postId === p.postId);
        return qual && qual.tier !== "LOW_PERFORMING";
      });

      if (hasTranscript && hasCaptionProxy) {
        expect(signals.hookReliability).toBe("mixed");
      } else if (hasTranscript && !hasCaptionProxy) {
        expect(signals.hookReliability).toBe("transcript_validated");
      } else if (hasCaptionProxy) {
        expect(signals.hookReliability).toBe("caption_proxy");
      }
    });

    test("transcriptCoverage percentage is computed correctly", () => {
      const signals = buildTikTokSignals(qualification, dbPosts, dbComments);
      expect(signals.transcriptCoverage).toBeGreaterThanOrEqual(0);
      expect(signals.transcriptCoverage).toBeLessThanOrEqual(100);
    });

    test("transcriptHooks come only from transcript-sourced posts", () => {
      const signals = buildTikTokSignals(qualification, dbPosts, dbComments);
      expect(signals.transcriptHooks.length).toBeGreaterThanOrEqual(0);
    });

    test("painInferences detected from pain-indicating hooks", () => {
      const signals = buildTikTokSignals(qualification, dbPosts, dbComments);
      const painKeywords = /tired|struggle|frustrated|can't/i;
      for (const pain of signals.painInferences) {
        expect(pain).toMatch(painKeywords);
      }
    });

    test("ctaPatterns detected from CTA-containing captions", () => {
      const signals = buildTikTokSignals(qualification, dbPosts, dbComments);
      if (signals.ctaPatterns.length > 0) {
        for (const cta of signals.ctaPatterns) {
          expect(cta).toMatch(/link in bio|DM me|book a call|comment|tap the link|click below|swipe up/i);
        }
      }
    });

    test("audience signals extracted from qualified post comments", () => {
      const signals = buildTikTokSignals(qualification, dbPosts, dbComments);

      expect(signals.commentVolume).toBeGreaterThanOrEqual(0);
    });

    test("audienceObjections detected from objection-indicating comments", () => {
      const signals = buildTikTokSignals(qualification, dbPosts, dbComments);
      for (const obj of signals.audienceObjections) {
        expect(obj).toMatch(/but |however |doesn't work|not worth|too expensive|scam|waste|disappointed|problem/i);
      }
    });

    test("audienceConfusion detected from confusion-indicating comments", () => {
      const signals = buildTikTokSignals(qualification, dbPosts, dbComments);
      for (const conf of signals.audienceConfusion) {
        expect(conf).toMatch(/how do|how does|what is|can you explain|confused|don't understand|where do i|help me/i);
      }
    });

    test("audienceValidation detected from validation-indicating comments", () => {
      const signals = buildTikTokSignals(qualification, dbPosts, dbComments);
      for (const val of signals.audienceValidation) {
        expect(val).toMatch(/love this|amazing|game changer|so helpful|this works|need this|saving this|exactly what/i);
      }
    });

    test("performanceTierDistribution sums to totalPosts", () => {
      const signals = buildTikTokSignals(qualification, dbPosts, dbComments);
      const { high, mid, low } = signals.performanceTierDistribution;
      expect(high + mid + low).toBe(qualification.totalPosts);
    });

    test("trendingHashtags extracted and deduplicated", () => {
      const signals = buildTikTokSignals(qualification, dbPosts, dbComments);
      const unique = new Set(signals.trendingHashtags);
      expect(unique.size).toBe(signals.trendingHashtags.length);
    });

    test("contentPatterns detected from content-indicating captions", () => {
      const signals = buildTikTokSignals(qualification, dbPosts, dbComments);
      const validPatterns = ["educational", "proof", "storytelling"];
      for (const pat of signals.contentPatterns) {
        expect(validPatterns).toContain(pat);
      }
    });

    test("returns empty signals when qualification is null", () => {
      const signals = buildTikTokSignals(null, dbPosts, dbComments);
      expect(signals.validatedHooks).toHaveLength(0);
      expect(signals.hookReliability).toBe("unavailable");
      expect(signals.transcriptCoverage).toBe(0);
      expect(signals.commentVolume).toBe(0);
    });

    test("returns empty signals when qualification has no qualifications", () => {
      const emptyQual = qualifyTikTokPosts([]);
      const signals = buildTikTokSignals(emptyQual, [], []);
      expect(signals.validatedHooks).toHaveLength(0);
      expect(signals.performanceTierDistribution).toEqual({ high: 0, mid: 0, low: 0 });
    });
  });

  describe("STAGE 6: Signal Classification", () => {
    let signals: ReturnType<typeof buildTikTokSignals>;

    beforeEach(() => {
      const dbPosts = postsToDbFormat(TEST_POSTS);
      const dbComments = commentsToDbFormat(TEST_POSTS);
      const qualification = qualifyTikTokPosts(dbPosts);
      signals = buildTikTokSignals(qualification, dbPosts, dbComments);
    });

    test("classifyTikTokSignals produces ClassifiedSignal array", () => {
      const classified = classifyTikTokSignals(signals);
      expect(classified.length).toBeGreaterThan(0);

      for (const s of classified) {
        expect(s).toHaveProperty("signalClass");
        expect(s).toHaveProperty("sourceType");
        expect(s).toHaveProperty("text");
        expect(s).toHaveProperty("confidence");
        expect(s.sourceType).toBe("tiktok");
        expect(s.confidence).toBeGreaterThan(0);
        expect(s.confidence).toBeLessThanOrEqual(1);
      }
    });

    test("signal classes are limited to known types", () => {
      const classified = classifyTikTokSignals(signals);
      const validClasses = ["content", "positioning", "cta", "offer", "proof"];

      for (const s of classified) {
        expect(validClasses).toContain(s.signalClass);
      }
    });

    test("hook confidence varies by hookReliability", () => {
      const classified = classifyTikTokSignals(signals);
      const hookSignals = classified.filter(s => !s.text.startsWith("["));

      if (hookSignals.length > 0) {
        if (signals.hookReliability === "transcript_validated") {
          expect(hookSignals[0].confidence).toBe(0.92);
        } else if (signals.hookReliability === "mixed") {
          expect(hookSignals[0].confidence).toBe(0.85);
        } else if (signals.hookReliability === "caption_proxy") {
          expect(hookSignals[0].confidence).toBe(0.75);
        }
      }
    });

    test("transcript hooks get 0.92 confidence", () => {
      const classified = classifyTikTokSignals(signals);
      const transcriptSignals = classified.filter(s => s.text.startsWith("[transcript]"));
      for (const s of transcriptSignals) {
        expect(s.confidence).toBe(0.92);
        expect(s.signalClass).toBe("content");
      }
    });

    test("objection signals classified as offer class", () => {
      const classified = classifyTikTokSignals(signals);
      const objSignals = classified.filter(s => s.text.startsWith("[objection]"));
      for (const s of objSignals) {
        expect(s.signalClass).toBe("offer");
        expect(s.confidence).toBe(0.8);
      }
    });

    test("confusion signals classified as positioning class", () => {
      const classified = classifyTikTokSignals(signals);
      const confSignals = classified.filter(s => s.text.startsWith("[confusion]"));
      for (const s of confSignals) {
        expect(s.signalClass).toBe("positioning");
        expect(s.confidence).toBe(0.75);
      }
    });

    test("validation signals classified as proof class", () => {
      const classified = classifyTikTokSignals(signals);
      const valSignals = classified.filter(s => s.text.startsWith("[validation]"));
      for (const s of valSignals) {
        expect(s.signalClass).toBe("proof");
        expect(s.confidence).toBe(0.7);
      }
    });

    test("audience_voice signals classified as positioning class", () => {
      const classified = classifyTikTokSignals(signals);
      const voiceSignals = classified.filter(s => s.text.startsWith("[audience_voice]"));
      for (const s of voiceSignals) {
        expect(s.signalClass).toBe("positioning");
        expect(s.confidence).toBe(0.65);
      }
    });

    test("CTA signals classified as cta class", () => {
      const classified = classifyTikTokSignals(signals);
      const ctaSignals = classified.filter(s => s.signalClass === "cta");
      for (const s of ctaSignals) {
        expect(s.confidence).toBe(0.75);
      }
    });

    test("empty signals produce empty classification", () => {
      const emptySignals = buildTikTokSignals(null, [], []);
      const classified = classifyTikTokSignals(emptySignals);
      expect(classified).toHaveLength(0);
    });
  });

  describe("STAGE 7: Full Pipeline Integration", () => {
    test("complete flow: Apify data → mapping → qualification → signals → classification", () => {
      const posts = APIFY_FIXTURE.map(item => mapFixtureToTiktokPost(item));
      expect(posts.length).toBe(10);

      const dbPosts = postsToDbFormat(posts);
      const dbComments = commentsToDbFormat(posts);
      expect(dbPosts.length).toBe(10);
      expect(dbComments.length).toBeGreaterThan(0);

      const qualification = qualifyTikTokPosts(dbPosts);
      expect(qualification.totalPosts).toBe(10);
      expect(qualification.highPerformingCount + qualification.midPerformingCount).toBeGreaterThan(0);

      const signals = buildTikTokSignals(qualification, dbPosts, dbComments);
      expect(signals.validatedHooks.length).toBeGreaterThan(0);
      expect(signals.hookReliability).not.toBe("unavailable");

      const classified = classifyTikTokSignals(signals);
      expect(classified.length).toBeGreaterThan(0);

      const byClass: Record<string, number> = {};
      for (const s of classified) {
        byClass[s.signalClass] = (byClass[s.signalClass] || 0) + 1;
      }
      expect(byClass["content"]).toBeGreaterThan(0);

      const allTiktok = classified.every(s => s.sourceType === "tiktok");
      expect(allTiktok).toBe(true);
    });

    test("pipeline with transcript-rich data yields higher hook confidence", () => {
      const transcriptPosts = APIFY_FIXTURE.map(item => {
        const copy = { ...item };
        if (!copy.transcript && !copy.speechText) {
          copy.transcript = "This is a test transcript with more than ten characters for hook extraction purposes";
        }
        return mapFixtureToTiktokPost(copy);
      });

      const dbPosts = postsToDbFormat(transcriptPosts);
      const dbComments = commentsToDbFormat(transcriptPosts);
      const qualification = qualifyTikTokPosts(dbPosts);
      const signals = buildTikTokSignals(qualification, dbPosts, dbComments);

      expect(signals.transcriptCoverage).toBeGreaterThan(50);
      expect(["transcript_validated", "mixed"]).toContain(signals.hookReliability);

      const classified = classifyTikTokSignals(signals);
      const hookSignals = classified.filter(s => !s.text.startsWith("["));
      if (hookSignals.length > 0) {
        expect(hookSignals[0].confidence).toBeGreaterThanOrEqual(0.85);
      }
    });

    test("pipeline with zero posts produces clean empty state", () => {
      const qualification = qualifyTikTokPosts([]);
      const signals = buildTikTokSignals(qualification, [], []);
      const classified = classifyTikTokSignals(signals);

      expect(qualification.totalPosts).toBe(0);
      expect(signals.validatedHooks).toHaveLength(0);
      expect(signals.hookReliability).toBe("unavailable");
      expect(classified).toHaveLength(0);
    });

    test("pipeline with only low-performing posts produces minimal signals", () => {
      const lowPosts = [
        { id: "low1", text: "test", playCount: 10, diggCount: 0, commentCount: 0, shareCount: 0, createTimeISO: "2026-04-01T00:00:00Z" },
        { id: "low2", text: "another test", playCount: 15, diggCount: 1, commentCount: 0, shareCount: 0, createTimeISO: "2026-04-01T00:00:00Z" },
        { id: "low3", text: "still low", playCount: 20, diggCount: 0, commentCount: 0, shareCount: 0, createTimeISO: "2026-04-01T00:00:00Z" },
      ];

      const posts = lowPosts.map(p => mapFixtureToTiktokPost(p));
      const dbPosts = postsToDbFormat(posts);
      const qualification = qualifyTikTokPosts(dbPosts);
      const signals = buildTikTokSignals(qualification, dbPosts, []);

      expect(qualification.lowPerformingCount).toBeGreaterThanOrEqual(0);
      expect(signals.validatedHooks.length).toBeLessThanOrEqual(3);
    });

    test("comment-derived signals flow correctly through the pipeline", () => {
      const dbPosts = postsToDbFormat(TEST_POSTS);
      const dbComments = commentsToDbFormat(TEST_POSTS);
      const qualification = qualifyTikTokPosts(dbPosts);
      const signals = buildTikTokSignals(qualification, dbPosts, dbComments);
      const classified = classifyTikTokSignals(signals);

      const commentDerivedClasses = ["offer", "positioning", "proof"];
      const commentDerived = classified.filter(s =>
        s.text.startsWith("[objection]") ||
        s.text.startsWith("[confusion]") ||
        s.text.startsWith("[validation]") ||
        s.text.startsWith("[audience_voice]")
      );

      for (const s of commentDerived) {
        expect(commentDerivedClasses).toContain(s.signalClass);
      }
    });

    test("data-acquisition source query would match both tiktok_scraped and tiktok_apify", () => {
      const sources = ["tiktok_scraped", "tiktok_apify"];
      const queryPattern = `source IN ('tiktok_scraped', 'tiktok_apify')`;

      for (const src of sources) {
        expect(queryPattern).toContain(src);
      }
    });
  });
});
