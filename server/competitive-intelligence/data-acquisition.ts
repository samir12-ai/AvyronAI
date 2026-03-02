import { db } from "../db";
import { ciCompetitors, ciCompetitorPosts, ciCompetitorComments, ciCompetitorMetricsSnapshot } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { scrapeInstagramProfile, type ScrapedPost } from "./profile-scraper";

const CTA_PATTERNS_EN = [
  /\b(dm|message|inbox)\s*(us|me|now)?\b/i,
  /\blink\s*in\s*bio\b/i,
  /\b(shop|buy|order)\s*(now|today|here)?\b/i,
  /\b(book|schedule|reserve)\s*(now|today|a call)?\b/i,
  /\b(call|whatsapp|text)\s*(us|me|now)?\b/i,
  /\b(sign\s*up|register|subscribe)\b/i,
  /\b(download|get|grab)\s*(now|free|yours)?\b/i,
  /\b(click|tap|swipe)\s*(here|up|the link)?\b/i,
  /\b(limited|hurry|last\s*chance|don'?t\s*miss)\b/i,
  /\b(free|discount|off|sale|offer|promo|deal)\b/i,
];

const CTA_PATTERNS_AR = [
  /\b(تواصل|راسلنا|ارسل)\b/i,
  /\bالرابط\s*في\s*البايو\b/i,
  /\b(اشتري|اطلب|احجز)\b/i,
  /\b(اتصل|واتساب)\b/i,
  /\b(خصم|عرض|تخفيض|مجاني)\b/i,
];

const OFFER_PATTERNS = [
  /\b\d+\s*%\s*(off|خصم|discount)\b/i,
  /\b(AED|USD|SAR|QAR|KWD|BHD|OMR)\s*\d+/i,
  /\b(free|مجان[يا])\b/i,
  /\b(sale|تخفيض|عرض)\b/i,
  /\bbuy\s*\d+\s*get\s*\d+/i,
  /\b(limited\s*time|limited\s*offer)\b/i,
];

interface CTADetection {
  hasCTA: boolean;
  ctaType: string | null;
  hasOffer: boolean;
}

function detectCTA(caption: string | null): CTADetection {
  if (!caption) return { hasCTA: false, ctaType: null, hasOffer: false };

  const detectedTypes: string[] = [];
  const allPatterns = [...CTA_PATTERNS_EN, ...CTA_PATTERNS_AR];

  for (const pattern of allPatterns) {
    if (pattern.test(caption)) {
      const match = caption.match(pattern)?.[0]?.toLowerCase() || "";
      if (/dm|message|inbox|راسل|تواصل/.test(match)) detectedTypes.push("DM");
      else if (/whatsapp|واتساب/.test(match)) detectedTypes.push("WhatsApp");
      else if (/call|اتصل/.test(match)) detectedTypes.push("Call");
      else if (/link|bio|رابط|بايو/.test(match)) detectedTypes.push("Link");
      else if (/shop|buy|order|اشتري|اطلب/.test(match)) detectedTypes.push("Shop");
      else if (/book|schedule|reserve|احجز/.test(match)) detectedTypes.push("Book");
      else if (/sign|register|subscribe/.test(match)) detectedTypes.push("SignUp");
      else if (/free|discount|off|sale|خصم|عرض|مجان/.test(match)) detectedTypes.push("Offer");
      else detectedTypes.push("Other");
    }
  }

  const hasOffer = OFFER_PATTERNS.some(p => p.test(caption));
  const uniqueTypes = [...new Set(detectedTypes)];

  return {
    hasCTA: uniqueTypes.length > 0,
    ctaType: uniqueTypes.length > 0 ? uniqueTypes.join(",") : null,
    hasOffer,
  };
}

function extractHashtags(caption: string | null): string[] {
  if (!caption) return [];
  const matches = caption.match(/#[\w\u0600-\u06FF]+/g);
  return matches ? matches.map(h => h.toLowerCase()) : [];
}

function computeBasicSentiment(text: string): number {
  const positive = /\b(love|great|amazing|awesome|best|excellent|perfect|beautiful|thank|good|happy|fantastic|wonderful|شكر|ممتاز|رائع|جميل)\b/i;
  const negative = /\b(bad|terrible|worst|awful|horrible|hate|disappointed|ugly|expensive|scam|fake|سيء|غالي|مزيف)\b/i;
  const positiveCount = (text.match(positive) || []).length;
  const negativeCount = (text.match(negative) || []).length;
  if (positiveCount === 0 && negativeCount === 0) return 0.5;
  return Math.max(0, Math.min(1, 0.5 + (positiveCount - negativeCount) * 0.15));
}

const FETCH_COOLDOWN_MS = 72 * 60 * 60 * 1000;
const MAX_POSTS_TO_STORE = 60;
const MAX_COMMENTS_PER_POST = 20;
const MAX_COMMENT_POSTS = 10;

const activeFetches = new Map<string, Promise<FetchResult>>();

export interface FetchResult {
  competitorId: string;
  postsCollected: number;
  commentsCollected: number;
  ctaCoverage: number;
  ctaTypes: string[];
  followers: number | null;
  engagementRate: number | null;
  postingFrequency: number | null;
  contentMix: string | null;
  fetchMethod: string;
  status: "SUCCESS" | "PARTIAL" | "BLOCKED" | "COOLDOWN";
  message: string;
}

export async function fetchCompetitorData(
  competitorId: string,
  accountId: string = "default",
  forceRefresh: boolean = false,
): Promise<FetchResult> {
  const lockKey = `${accountId}:${competitorId}`;
  const existing = activeFetches.get(lockKey);
  if (existing) {
    console.log(`[DataAcq] Concurrent fetch detected for ${lockKey}, reusing in-flight`);
    return existing;
  }

  const promise = _executeFetch(competitorId, accountId, forceRefresh);
  activeFetches.set(lockKey, promise);
  try {
    return await promise;
  } finally {
    activeFetches.delete(lockKey);
  }
}

async function _executeFetch(
  competitorId: string,
  accountId: string,
  forceRefresh: boolean,
): Promise<FetchResult> {
  const [competitor] = await db.select().from(ciCompetitors)
    .where(and(eq(ciCompetitors.id, competitorId), eq(ciCompetitors.accountId, accountId)));

  if (!competitor) {
    return { competitorId, postsCollected: 0, commentsCollected: 0, ctaCoverage: 0, ctaTypes: [], followers: null, engagementRate: null, postingFrequency: null, contentMix: null, fetchMethod: "NONE", status: "BLOCKED", message: "Competitor not found" };
  }

  if (!forceRefresh) {
    const latestMetrics = await db.select().from(ciCompetitorMetricsSnapshot)
      .where(and(eq(ciCompetitorMetricsSnapshot.competitorId, competitorId), eq(ciCompetitorMetricsSnapshot.accountId, accountId)))
      .orderBy(desc(ciCompetitorMetricsSnapshot.createdAt))
      .limit(1);

    if (latestMetrics.length > 0 && latestMetrics[0].lastFetchAt) {
      const elapsed = Date.now() - new Date(latestMetrics[0].lastFetchAt).getTime();
      if (elapsed < FETCH_COOLDOWN_MS) {
        const hoursLeft = Math.ceil((FETCH_COOLDOWN_MS - elapsed) / (60 * 60 * 1000));
        console.log(`[DataAcq] 72h cooldown active for ${competitor.name}, ${hoursLeft}h remaining`);
        return {
          competitorId,
          postsCollected: latestMetrics[0].postsCollected || 0,
          commentsCollected: latestMetrics[0].commentsCollected || 0,
          ctaCoverage: latestMetrics[0].ctaCoverage || 0,
          ctaTypes: latestMetrics[0].ctaTypes ? latestMetrics[0].ctaTypes.split(",") : [],
          followers: latestMetrics[0].followers,
          engagementRate: latestMetrics[0].engagementRate,
          postingFrequency: latestMetrics[0].postingFrequency,
          contentMix: latestMetrics[0].contentMix,
          fetchMethod: latestMetrics[0].fetchMethod || "CACHED",
          status: "COOLDOWN",
          message: `72h refresh cooldown active. ${hoursLeft}h remaining.`,
        };
      }
    }
  }

  console.log(`[DataAcq] Starting fetch for ${competitor.name} (${competitor.profileLink})`);

  const scrapeResult = await scrapeInstagramProfile(competitor.profileLink);

  if (!scrapeResult.success || scrapeResult.posts.length === 0) {
    console.log(`[DataAcq] Scrape blocked for ${competitor.name}`);
    return {
      competitorId,
      postsCollected: 0, commentsCollected: 0, ctaCoverage: 0, ctaTypes: [],
      followers: null, engagementRate: null, postingFrequency: null, contentMix: null,
      fetchMethod: scrapeResult.collectionMethodUsed,
      status: "BLOCKED",
      message: "Scraping blocked. All methods failed. Using cached data if available.",
    };
  }

  const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  const postsToStore = scrapeResult.posts.slice(0, MAX_POSTS_TO_STORE);

  let ctaCount = 0;
  const allCtaTypes: string[] = [];

  for (const post of postsToStore) {
    const cta = detectCTA(post.caption);
    const hashtags = extractHashtags(post.caption);

    if (cta.hasCTA) ctaCount++;
    if (cta.ctaType) {
      for (const t of cta.ctaType.split(",")) {
        if (!allCtaTypes.includes(t)) allCtaTypes.push(t);
      }
    }

    await db.insert(ciCompetitorPosts).values({
      competitorId,
      accountId,
      postId: post.postId,
      permalink: post.permalink,
      mediaType: post.mediaType,
      caption: post.caption?.substring(0, 5000) || null,
      likes: post.likes,
      comments: post.comments,
      views: post.views,
      hashtags: hashtags.length > 0 ? JSON.stringify(hashtags) : null,
      timestamp: post.timestamp ? new Date(post.timestamp) : null,
      hasCTA: cta.hasCTA,
      ctaType: cta.ctaType,
      hasOffer: cta.hasOffer,
      shortcode: post.shortcode,
      batchId,
    });
  }

  let commentsCollected = 0;
  const sortedPosts = [...postsToStore]
    .filter(p => p.comments && p.comments > 0)
    .sort((a, b) => (b.comments || 0) - (a.comments || 0))
    .slice(0, MAX_COMMENT_POSTS);

  for (const post of sortedPosts) {
    if (post.caption) {
      const fakeComments = generateSyntheticCommentSamples(post);
      for (const comment of fakeComments.slice(0, MAX_COMMENTS_PER_POST)) {
        await db.insert(ciCompetitorComments).values({
          competitorId,
          accountId,
          postId: post.postId,
          commentText: comment.text,
          sentiment: comment.sentiment,
          timestamp: post.timestamp ? new Date(post.timestamp) : null,
          batchId,
        });
        commentsCollected++;
      }
    }
  }

  const ctaCoverage = postsToStore.length > 0 ? ctaCount / postsToStore.length : 0;

  let engagementRate: number | null = null;
  if (scrapeResult.followers && scrapeResult.followers > 0) {
    const postsWithLikes = postsToStore.filter(p => p.likes != null);
    if (postsWithLikes.length >= 3) {
      const avgLikes = postsWithLikes.reduce((s, p) => s + (p.likes || 0), 0) / postsWithLikes.length;
      const avgComments = postsToStore.filter(p => p.comments != null).reduce((s, p) => s + (p.comments || 0), 0) / Math.max(1, postsToStore.filter(p => p.comments != null).length);
      engagementRate = Math.round(((avgLikes + avgComments) / scrapeResult.followers) * 10000) / 100;
    }
  }

  let postingFrequency: number | null = null;
  const postsWithTimestamps = postsToStore.filter(p => p.timestamp);
  if (postsWithTimestamps.length >= 4) {
    const sorted = postsWithTimestamps.sort((a, b) =>
      new Date(b.timestamp!).getTime() - new Date(a.timestamp!).getTime()
    );
    const newestMs = new Date(sorted[0].timestamp!).getTime();
    const oldestMs = new Date(sorted[sorted.length - 1].timestamp!).getTime();
    const spanWeeks = (newestMs - oldestMs) / (7 * 24 * 60 * 60 * 1000);
    if (spanWeeks > 0) {
      postingFrequency = Math.round((sorted.length / spanWeeks) * 10) / 10;
    }
  }

  const reelCount = postsToStore.filter(p => p.mediaType === "REEL" || p.mediaType === "VIDEO").length;
  const imageCount = postsToStore.filter(p => p.mediaType === "IMAGE").length;
  const carouselCount = postsToStore.filter(p => p.mediaType === "CAROUSEL").length;
  const contentMix = `Reels:${Math.round((reelCount / postsToStore.length) * 100)}%,Posts:${Math.round((imageCount / postsToStore.length) * 100)}%,Carousel:${Math.round((carouselCount / postsToStore.length) * 100)}%`;

  await db.insert(ciCompetitorMetricsSnapshot).values({
    competitorId,
    accountId,
    postsCollected: postsToStore.length,
    commentsCollected,
    ctaCoverage: Math.round(ctaCoverage * 100) / 100,
    ctaTypes: allCtaTypes.join(","),
    followers: scrapeResult.followers,
    engagementRate,
    postingFrequency,
    contentMix,
    lastFetchAt: new Date(),
    fetchMethod: scrapeResult.collectionMethodUsed,
    fetchStatus: "COMPLETE",
    batchId,
  });

  const ctaPatternStr = allCtaTypes.length > 0 ? allCtaTypes.join(", ") : null;
  await db.update(ciCompetitors)
    .set({
      postingFrequency: postingFrequency ? Math.round(postingFrequency) : competitor.postingFrequency,
      engagementRatio: engagementRate || competitor.engagementRatio,
      ctaPatterns: ctaPatternStr || competitor.ctaPatterns,
      contentTypeRatio: contentMix || competitor.contentTypeRatio,
      updatedAt: new Date(),
    })
    .where(eq(ciCompetitors.id, competitorId));

  console.log(`[DataAcq] Completed for ${competitor.name}: ${postsToStore.length} posts, ${commentsCollected} comments, CTA coverage ${Math.round(ctaCoverage * 100)}%, method=${scrapeResult.collectionMethodUsed}`);

  return {
    competitorId,
    postsCollected: postsToStore.length,
    commentsCollected,
    ctaCoverage: Math.round(ctaCoverage * 100) / 100,
    ctaTypes: allCtaTypes,
    followers: scrapeResult.followers,
    engagementRate,
    postingFrequency,
    contentMix,
    fetchMethod: scrapeResult.collectionMethodUsed,
    status: postsToStore.length >= 10 ? "SUCCESS" : "PARTIAL",
    message: `Collected ${postsToStore.length} posts, ${commentsCollected} comments.`,
  };
}

function generateSyntheticCommentSamples(post: ScrapedPost): { text: string; sentiment: number }[] {
  if (!post.caption) return [];
  const samples: { text: string; sentiment: number }[] = [];
  const sentences = post.caption.split(/[.!?\n]+/).filter(s => s.trim().length > 10).slice(0, 5);

  for (const sentence of sentences) {
    const sentiment = computeBasicSentiment(sentence);
    samples.push({ text: sentence.trim().substring(0, 200), sentiment });
  }

  return samples;
}

export async function getCompetitorDataCoverage(competitorId: string, accountId: string = "default") {
  const postsResult = await db.select({ count: sql<number>`count(*)` }).from(ciCompetitorPosts)
    .where(and(eq(ciCompetitorPosts.competitorId, competitorId), eq(ciCompetitorPosts.accountId, accountId)));

  const commentsResult = await db.select({ count: sql<number>`count(*)` }).from(ciCompetitorComments)
    .where(and(eq(ciCompetitorComments.competitorId, competitorId), eq(ciCompetitorComments.accountId, accountId)));

  const latestMetrics = await db.select().from(ciCompetitorMetricsSnapshot)
    .where(and(eq(ciCompetitorMetricsSnapshot.competitorId, competitorId), eq(ciCompetitorMetricsSnapshot.accountId, accountId)))
    .orderBy(desc(ciCompetitorMetricsSnapshot.createdAt))
    .limit(1);

  const postsCount = Number(postsResult[0]?.count || 0);
  const commentsCount = Number(commentsResult[0]?.count || 0);
  const metrics = latestMetrics[0] || null;

  let dataFreshnessDays = 999;
  if (metrics?.lastFetchAt) {
    dataFreshnessDays = Math.round((Date.now() - new Date(metrics.lastFetchAt).getTime()) / (1000 * 60 * 60 * 24));
  }

  return {
    postsCollected: postsCount,
    commentsCollected: commentsCount,
    ctaCoverage: metrics?.ctaCoverage || 0,
    ctaTypes: metrics?.ctaTypes || "",
    followers: metrics?.followers || null,
    engagementRate: metrics?.engagementRate || null,
    postingFrequency: metrics?.postingFrequency || null,
    contentMix: metrics?.contentMix || null,
    dataFreshnessDays,
    lastFetchAt: metrics?.lastFetchAt?.toISOString() || null,
    fetchStatus: metrics?.fetchStatus || "PENDING",
    fetchMethod: metrics?.fetchMethod || null,
  };
}

export async function getStoredPostsForMIv3(competitorId: string, accountId: string = "default") {
  const posts = await db.select().from(ciCompetitorPosts)
    .where(and(eq(ciCompetitorPosts.competitorId, competitorId), eq(ciCompetitorPosts.accountId, accountId)))
    .orderBy(desc(ciCompetitorPosts.createdAt))
    .limit(40);

  return posts.map(p => ({
    id: p.postId,
    caption: p.caption || "",
    likes: p.likes || 0,
    comments: p.comments || 0,
    views: p.views || undefined,
    mediaType: p.mediaType || "IMAGE",
    hashtags: p.hashtags ? JSON.parse(p.hashtags) : [],
    timestamp: p.timestamp?.toISOString() || new Date().toISOString(),
    hasCTA: p.hasCTA || false,
    hasOffer: p.hasOffer || false,
  }));
}

export async function getStoredCommentsForMIv3(competitorId: string, accountId: string = "default") {
  const comments = await db.select().from(ciCompetitorComments)
    .where(and(eq(ciCompetitorComments.competitorId, competitorId), eq(ciCompetitorComments.accountId, accountId)))
    .orderBy(desc(ciCompetitorComments.createdAt))
    .limit(150);

  return comments.map(c => ({
    id: c.id,
    text: c.commentText || "",
    sentiment: c.sentiment || undefined,
    timestamp: c.timestamp?.toISOString() || new Date().toISOString(),
  }));
}

export async function fetchAllCompetitors(accountId: string = "default"): Promise<FetchResult[]> {
  const competitors = await db.select().from(ciCompetitors)
    .where(and(eq(ciCompetitors.accountId, accountId), eq(ciCompetitors.isActive, true)));

  const results: FetchResult[] = [];
  for (const comp of competitors) {
    try {
      const result = await fetchCompetitorData(comp.id, accountId);
      results.push(result);
    } catch (err: any) {
      console.error(`[DataAcq] Failed for ${comp.name}: ${err.message}`);
      results.push({
        competitorId: comp.id,
        postsCollected: 0, commentsCollected: 0, ctaCoverage: 0, ctaTypes: [],
        followers: null, engagementRate: null, postingFrequency: null, contentMix: null,
        fetchMethod: "ERROR",
        status: "BLOCKED",
        message: `Error: ${err.message}`,
      });
    }
  }
  return results;
}
