import * as path from "path";
import { scrapeInstagramProfile, type ScrapedPost, type ScrapeResult } from "./profile-scraper";
import { captureCompetitorCreatives, type CreativeCaptureResult, type EvidencePack, type InterpretedSignals } from "./creative-capture";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

type WarningCode =
  | "SCRAPE_BLOCKED"
  | "TIMESTAMPS_MISSING"
  | "INSUFFICIENT_POSTS"
  | "NO_REELS_FOUND"
  | "FOLLOWERS_UNAVAILABLE"
  | "ENGAGEMENT_UNAVAILABLE";

interface MeasuredMetric<T> {
  value: T;
  timeframe: string;
  source: string;
  sampleSize: number;
}

interface ContentMix {
  reels_ratio: number;
  static_ratio: number;
  source: string;
  sampleSize: number;
}

interface EngagementData {
  value: number;
  formula: string;
  timeframe: string;
  source: string;
  sampleSize: number;
  avgLikes: number;
  avgComments: number;
  followers: number;
}

interface InferredInsight {
  category: "hook_style" | "cta_pattern" | "messaging_tone" | "social_proof" | "funnel_clarity";
  finding: string;
  evidencePermalinks: string[];
}

export interface ProfileAnalysisResult {
  status: "VALID" | "PARTIAL";
  warnings: WarningCode[];
  warningDetails: string[];
  source_type: "PUBLIC_HTML";
  collection_method_used: "WEB_API" | "HTML_PARSE" | "HEADLESS_RENDER" | "NONE";
  attempts: string[];
  scannedPosts: number;
  profileName: string | null;
  profileUrl: string;
  measured: {
    posts_last_7d: MeasuredMetric<number> | null;
    reels_last_7d: MeasuredMetric<number> | null;
    avg_posts_per_week_28d: MeasuredMetric<number> | null;
    content_mix: ContentMix | null;
    engagement_rate: EngagementData | null;
    followers: MeasuredMetric<number> | null;
  };
  inferred: {
    insights: InferredInsight[];
    sampledReels: { permalink: string; caption: string | null }[];
  } | null;
  creativeCapture: CreativeCaptureResult[] | null;
  scannedPostsList: {
    postId: string;
    permalink: string;
    mediaType: string;
    timestamp: string | null;
    hasCaption: boolean;
  }[];
}

function computeDeterministicMetrics(posts: ScrapedPost[], followers: number | null) {
  const warnings: WarningCode[] = [];
  const warningDetails: string[] = [];

  const postsWithTimestamps = posts.filter(p => p.timestamp !== null);
  const totalScanned = posts.length;

  if (postsWithTimestamps.length === 0 && totalScanned > 0) {
    warnings.push("TIMESTAMPS_MISSING");
    warningDetails.push("Posts were found but timestamps could not be parsed from the profile page.");
  }

  if (totalScanned < 12) {
    warnings.push("INSUFFICIENT_POSTS");
    warningDetails.push(`Only ${totalScanned} posts were scanned. Minimum 12 required for reliable analysis.`);
  }

  const reels = posts.filter(p => p.mediaType === "REEL" || p.mediaType === "VIDEO");
  if (reels.length === 0) {
    warnings.push("NO_REELS_FOUND");
    warningDetails.push("No video or reel content detected in scanned posts.");
  }

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twentyEightDaysAgo = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);

  let postsLast7d: MeasuredMetric<number> | null = null;
  let reelsLast7d: MeasuredMetric<number> | null = null;
  let avgPostsPerWeek28d: MeasuredMetric<number> | null = null;

  if (postsWithTimestamps.length > 0) {
    const last7d = postsWithTimestamps.filter(p => new Date(p.timestamp!) >= sevenDaysAgo);
    postsLast7d = {
      value: last7d.length,
      timeframe: "7d",
      source: "public_html",
      sampleSize: totalScanned,
    };

    const reelsLast7dCount = last7d.filter(p => p.mediaType === "REEL" || p.mediaType === "VIDEO").length;
    reelsLast7d = {
      value: reelsLast7dCount,
      timeframe: "7d",
      source: "public_html",
      sampleSize: totalScanned,
    };

    const last28d = postsWithTimestamps.filter(p => new Date(p.timestamp!) >= twentyEightDaysAgo);
    if (last28d.length >= 4) {
      avgPostsPerWeek28d = {
        value: Math.round((last28d.length / 4) * 10) / 10,
        timeframe: "28d",
        source: "public_html",
        sampleSize: totalScanned,
      };
    }
  }

  let contentMix: ContentMix | null = null;
  if (totalScanned > 0) {
    const reelCount = posts.filter(p => p.mediaType === "REEL" || p.mediaType === "VIDEO").length;
    const staticCount = posts.filter(p => p.mediaType === "IMAGE" || p.mediaType === "CAROUSEL" || p.mediaType === "UNKNOWN").length;
    contentMix = {
      reels_ratio: Math.round((reelCount / totalScanned) * 100) / 100,
      static_ratio: Math.round((staticCount / totalScanned) * 100) / 100,
      source: "public_html",
      sampleSize: totalScanned,
    };
  }

  let engagementRate: EngagementData | null = null;
  if (followers && followers > 0) {
    const postsWithLikes = posts.filter(p => p.likes !== null && p.likes !== undefined);
    const postsWithComments = posts.filter(p => p.comments !== null && p.comments !== undefined);

    if (postsWithLikes.length >= 5) {
      const avgLikes = postsWithLikes.reduce((sum, p) => sum + (p.likes || 0), 0) / postsWithLikes.length;
      const avgComments = postsWithComments.length > 0
        ? postsWithComments.reduce((sum, p) => sum + (p.comments || 0), 0) / postsWithComments.length
        : 0;
      const rate = ((avgLikes + avgComments) / followers) * 100;
      engagementRate = {
        value: Math.round(rate * 100) / 100,
        formula: "(avg_likes + avg_comments) / followers * 100",
        timeframe: `last_${postsWithLikes.length}_posts`,
        source: "public_html",
        sampleSize: postsWithLikes.length,
        avgLikes: Math.round(avgLikes),
        avgComments: Math.round(avgComments),
        followers,
      };
    } else {
      warnings.push("ENGAGEMENT_UNAVAILABLE");
      warningDetails.push("Like/comment counts are not publicly visible on enough posts to calculate engagement.");
    }
  } else {
    warnings.push("FOLLOWERS_UNAVAILABLE");
    warningDetails.push("Follower count could not be reliably parsed from the profile page.");
    if (!posts.some(p => p.likes !== null)) {
      warnings.push("ENGAGEMENT_UNAVAILABLE");
      warningDetails.push("Like/comment counts are not publicly visible.");
    }
  }

  let followersMetric: MeasuredMetric<number> | null = null;
  if (followers) {
    followersMetric = {
      value: followers,
      timeframe: "current",
      source: "public_html",
      sampleSize: 1,
    };
  }

  return {
    warnings,
    warningDetails,
    postsLast7d,
    reelsLast7d,
    avgPostsPerWeek28d,
    contentMix,
    engagementRate,
    followersMetric,
  };
}

async function runAIQualitativeAnalysis(
  reelPosts: ScrapedPost[],
  profileName: string
): Promise<InferredInsight[]> {
  const sample = reelPosts.slice(0, 5);
  if (sample.length === 0) return [];

  const postDescriptions = sample.map((p, i) => {
    const parts = [`Reel ${i + 1}:`];
    parts.push(`  Permalink: ${p.permalink}`);
    if (p.caption) parts.push(`  Caption: "${p.caption.substring(0, 500)}"`);
    if (p.timestamp) parts.push(`  Posted: ${p.timestamp}`);
    return parts.join("\n");
  }).join("\n\n");

  const permalinks = sample.map(p => p.permalink);

  const prompt = `You are a competitive intelligence analyst. You are given ${sample.length} real Instagram reels/videos from "${profileName}".

ABSOLUTE RULES:
- Do NOT generate ANY numbers, percentages, or metrics.
- Do NOT estimate posting frequency, engagement rates, or follower counts.
- Do NOT mention Stories.
- ONLY describe qualitative patterns you can observe from the provided captions.
- Every insight MUST reference which specific reels support it.

Here are the reels:

${postDescriptions}

Analyze these reels and return a JSON array of insights. Each insight must follow this exact structure:
[
  {
    "category": "hook_style" | "cta_pattern" | "messaging_tone" | "social_proof" | "funnel_clarity",
    "finding": "A specific qualitative observation based ONLY on the provided captions/content",
    "evidenceReelIndexes": [0, 1]
  }
]

Return 4-6 insights covering different categories. evidenceReelIndexes are 0-based indexes into the reel list above. Return ONLY the JSON array, no markdown.`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.5,
      max_tokens: 1200,
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) return [];

    const parsed = JSON.parse(content);
    const insightsArray = Array.isArray(parsed) ? parsed : parsed.insights || [];

    return insightsArray.map((insight: any) => ({
      category: insight.category || "messaging_tone",
      finding: insight.finding || "",
      evidencePermalinks: (insight.evidenceReelIndexes || insight.evidencePermalinks || []).map((idx: any) => {
        if (typeof idx === "number" && idx >= 0 && idx < permalinks.length) return permalinks[idx];
        if (typeof idx === "string" && idx.startsWith("http")) return idx;
        return permalinks[0] || "";
      }).filter((p: string) => p),
    }));
  } catch (err: any) {
    console.error("AI qualitative analysis failed:", err.message);
    return [];
  }
}

function normalizeProfileUrl(rawUrl: string): string {
  let url = rawUrl.trim().split("?")[0].split("#")[0].replace(/\/$/, "");
  const match = url.match(/instagram\.com\/([^\/\?#]+)/);
  const handle = match ? match[1].toLowerCase() : rawUrl.replace(/^@/, "").split("/")[0].toLowerCase();
  return `https://www.instagram.com/${handle}/`;
}

export async function analyzeInstagramProfile(rawUrl: string, companyName: string, options?: { enableCreativeCapture?: boolean; saveFixtures?: boolean }): Promise<ProfileAnalysisResult> {
  const scrapeResult = await scrapeInstagramProfile(rawUrl);
  const profileUrl = normalizeProfileUrl(rawUrl);

  if (!scrapeResult.success || scrapeResult.posts.length === 0) {
    return {
      status: "PARTIAL",
      warnings: ["SCRAPE_BLOCKED"],
      warningDetails: [
        "Instagram blocked both HTML parsing and headless rendering attempts. No post data could be retrieved.",
        ...(scrapeResult.warnings.filter(w => w !== "SCRAPE_BLOCKED")),
      ],
      source_type: "PUBLIC_HTML",
      collection_method_used: scrapeResult.collectionMethodUsed,
      attempts: scrapeResult.attempts,
      scannedPosts: 0,
      profileName: scrapeResult.profileName || companyName,
      profileUrl,
      measured: {
        posts_last_7d: null,
        reels_last_7d: null,
        avg_posts_per_week_28d: null,
        content_mix: null,
        engagement_rate: null,
        followers: null,
      },
      inferred: null,
      creativeCapture: null,
      scannedPostsList: [],
    };
  }

  const metrics = computeDeterministicMetrics(scrapeResult.posts, scrapeResult.followers);

  const allWarnings: WarningCode[] = [...metrics.warnings];
  const allWarningDetails = [...metrics.warningDetails];

  if (scrapeResult.warnings.length > 0 && !scrapeResult.warnings.includes("SCRAPE_BLOCKED")) {
    allWarningDetails.push(...scrapeResult.warnings);
  }

  const reelPosts = scrapeResult.posts.filter(p => p.mediaType === "REEL" || p.mediaType === "VIDEO");
  const postsWithCaptions = reelPosts.filter(p => p.caption);
  const aiSample = postsWithCaptions.length > 0 ? postsWithCaptions : reelPosts;

  let inferred: ProfileAnalysisResult["inferred"] = null;
  if (aiSample.length > 0) {
    const insights = await runAIQualitativeAnalysis(aiSample.slice(0, 5), companyName);
    inferred = {
      insights,
      sampledReels: aiSample.slice(0, 5).map(p => ({ permalink: p.permalink, caption: p.caption })),
    };
  }

  let creativeCapture: CreativeCaptureResult[] | null = null;
  try {
    const enableCC = options?.enableCreativeCapture !== false;
    if (enableCC && scrapeResult.posts.length > 0) {
      console.log(`[Profile Analyzer] Starting Creative Capture for ${companyName}`);
      const fixtureDir = options?.saveFixtures
        ? path.resolve(__dirname, "test-fixtures")
        : undefined;
      creativeCapture = await captureCompetitorCreatives(scrapeResult.posts, {
        saveFixtures: !!options?.saveFixtures,
        fixtureDir,
      });
      console.log(`[Profile Analyzer] Creative Capture complete: ${creativeCapture.length} reels analyzed`);
    }
  } catch (err: any) {
    console.error(`[Profile Analyzer] Creative Capture failed (non-blocking): ${err.message}`);
    allWarningDetails.push(`Creative capture failed: ${err.message}`);
  }

  const postsWithTimestamps = scrapeResult.posts.filter(p => p.timestamp !== null);
  const isValid = postsWithTimestamps.length >= 12 && reelPosts.length >= 1;

  return {
    status: isValid ? "VALID" : "PARTIAL",
    warnings: allWarnings,
    warningDetails: allWarningDetails,
    source_type: "PUBLIC_HTML",
    collection_method_used: scrapeResult.collectionMethodUsed,
    attempts: scrapeResult.attempts,
    scannedPosts: scrapeResult.posts.length,
    profileName: scrapeResult.profileName || companyName,
    profileUrl,
    measured: {
      posts_last_7d: metrics.postsLast7d,
      reels_last_7d: metrics.reelsLast7d,
      avg_posts_per_week_28d: metrics.avgPostsPerWeek28d,
      content_mix: metrics.contentMix,
      engagement_rate: metrics.engagementRate,
      followers: metrics.followersMetric,
    },
    inferred,
    creativeCapture,
    scannedPostsList: scrapeResult.posts.map(p => ({
      postId: p.postId,
      permalink: p.permalink,
      mediaType: p.mediaType,
      timestamp: p.timestamp,
      hasCaption: !!p.caption,
    })),
  };
}
