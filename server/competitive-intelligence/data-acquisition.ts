import { db } from "../db";
import { ciCompetitors, ciCompetitorPosts, ciCompetitorComments, ciCompetitorMetricsSnapshot, ciCompetitorReviews, competitorPostClassifications, competitorSources } from "@shared/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { scrapeCommentsForPosts, extractHandleFromUrl } from "./profile-scraper";
import { scrapeInstagramForCompetitor } from "./instagram-provider";
import { lookupSharedProfile, upsertSharedProfile, linkCompetitorToSharedProfile, reuseFromSharedPool } from "./shared-profile-store";
import { MI_THRESHOLDS } from "../market-intelligence-v3/constants";
import { executeSourceFetch, type SourceFetchExecutionResult, type SourceFetchStatus } from "./provider-registry";


const EXPLICIT_CTA_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\b(dm|message|inbox)\s*(us|me|now)?\b/i, label: "DM" },
  { pattern: /\blink\s*in\s*bio\b/i, label: "LinkInBio" },
  { pattern: /\b(shop|buy|order)\s*(now|today|here)?\b/i, label: "Shop" },
  { pattern: /\b(book|schedule|reserve)\s*(now|today|a call)?\b/i, label: "Book" },
  { pattern: /\b(call|whatsapp|text)\s*(us|me|now)?\b/i, label: "Contact" },
  { pattern: /\b(sign\s*up|register|subscribe)\b/i, label: "SignUp" },
  { pattern: /\b(download|get|grab)\s*(now|free|yours)?\b/i, label: "Download" },
  { pattern: /\b(click|tap|swipe)\s*(here|up|the link)?\b/i, label: "ClickAction" },
  { pattern: /\b(limited|hurry|last\s*chance|don'?t\s*miss)\b/i, label: "Urgency" },
  { pattern: /(تواصل|راسلنا|ارسل)/i, label: "DM_AR" },
  { pattern: /الرابط\s*في\s*البايو/i, label: "LinkInBio_AR" },
  { pattern: /(اشتري|اطلب|احجز)/i, label: "Shop_AR" },
  { pattern: /(اتصل|واتساب)/i, label: "Contact_AR" },
];

const SOFT_CTA_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\b(check\s*(it\s*)?out|take\s*a\s*look)\b/i, label: "CheckOut" },
  { pattern: /\b(learn\s*more|find\s*out|read\s*more)\b/i, label: "LearnMore" },
  { pattern: /\b(discover|explore|uncover)\b/i, label: "Discover" },
  { pattern: /\b(see\s*how|see\s*what|see\s*why|watch\s*how)\b/i, label: "SeeHow" },
  { pattern: /\b(try\s*(it|this|now)|give\s*(it\s*)?a\s*try)\b/i, label: "Try" },
  { pattern: /\b(start\s*(your|the)|begin\s*(your|the))\b/i, label: "StartYour" },
  { pattern: /\b(don'?t\s*wait|act\s*now|today\s*only)\b/i, label: "ActNow" },
  { pattern: /\b(join\s*(us|the|our))\b/i, label: "Join" },
  { pattern: /\b(save\s*your\s*spot|secure\s*your)\b/i, label: "SecureSpot" },
  { pattern: /\b(what\s*are\s*you\s*waiting\s*for)\b/i, label: "WhatWaiting" },
  { pattern: /(اكتشف|تعرف|جرب)/i, label: "Discover_AR" },
  { pattern: /(شوف|شاهد)/i, label: "SeeHow_AR" },
];

const NARRATIVE_CTA_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\b(before\s*and\s*after|transformation)\b/i, label: "BeforeAfter" },
  { pattern: /\b(my\s*(journey|story|experience)|our\s*(journey|story))\b/i, label: "JourneyStory" },
  { pattern: /\b(here'?s?\s*(what|how|why)|this\s*is\s*(how|why|what))\b/i, label: "HeresHow" },
  { pattern: /\b(i\s*(used\s*to|never\s*thought|was\s*struggling|couldn'?t))\b/i, label: "PersonalStruggle" },
  { pattern: /\b(changed\s*my\s*life|game\s*changer|life\s*changing|turned\s*around)\b/i, label: "LifeChanger" },
  { pattern: /\b(imagine\s*(if|what|how|a\s*world))\b/i, label: "Imagine" },
  { pattern: /\b(the\s*secret\s*(to|of|behind)|what\s*no\s*one\s*tells)\b/i, label: "SecretReveal" },
  { pattern: /\b(step\s*by\s*step|how\s*i\s*(did|made|built|grew))\b/i, label: "StepByStep" },
  { pattern: /\b(real\s*talk|honest(ly)?|truth\s*(is|bomb))\b/i, label: "RealTalk" },
  { pattern: /\b(behind\s*the\s*scenes|the\s*process|making\s*of)\b/i, label: "BehindScenes" },
  { pattern: /\b(lesson\s*(i\s*)?learned|what\s*i\s*learned|takeaway)\b/i, label: "LessonLearned" },
  { pattern: /\b(what\s*would\s*you\s*do|would\s*you\s*rather|have\s*you\s*ever)\b/i, label: "EngagementQuestion" },
  { pattern: /\b(unpopular\s*opinion|hot\s*take|controversial)\b/i, label: "OpinionHook" },
  { pattern: /\b(the\s*truth\s*about|nobody\s*talks\s*about|no\s*one\s*mentions)\b/i, label: "TruthReveal" },
  { pattern: /\b(how\s*to|guide\s*to|tips\s*for|ways\s*to)\b/i, label: "HowToGuide" },
  { pattern: /(قصتي|رحلتي|تجربتي)/i, label: "JourneyStory_AR" },
  { pattern: /(قبل\s*و\s*بعد|التحول)/i, label: "BeforeAfter_AR" },
  { pattern: /(تعلمت|درس|عبرة)/i, label: "LessonLearned_AR" },
  { pattern: /(السر|ما\s*لا\s*يقوله\s*أحد)/i, label: "SecretReveal_AR" },
  { pattern: /(كيف\s*(بدأت|حققت|نجحت|وصلت))/i, label: "StepByStep_AR" },
  { pattern: /(تخيل|تصور)/i, label: "Imagine_AR" },
  { pattern: /(نصائح|طريقة|خطوات)/i, label: "HowToGuide_AR" },
];

const TRUST_CTA_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\b(\d+\s*\+?\s*(clients?|customers?|projects?|years?))\b/i, label: "ClientCount" },
  { pattern: /\b(review|testimonial|feedback|what\s*(they|clients?|customers?)\s*sa(y|id))\b/i, label: "Reviews" },
  { pattern: /\b(results?\s*(speak|proven|guaranteed|driven))\b/i, label: "ResultsLanguage" },
  { pattern: /\b(certif(ied|ication)|award[- ]?winning|accredited|licensed)\b/i, label: "Certification" },
  { pattern: /\b(trusted\s*by|as\s*seen\s*(in|on)|featured\s*(in|on|by))\b/i, label: "TrustedBy" },
  { pattern: /\b(guarantee|money\s*back|risk\s*free|no\s*risk)\b/i, label: "Guarantee" },
  { pattern: /\b(rated|rating|\d+(\.\d+)?\s*stars?|⭐)\b/i, label: "Rating" },
  { pattern: /\b(proven|track\s*record|success\s*rate)\b/i, label: "ProvenRecord" },
  { pattern: /\b(satisfied|happy\s*(clients?|customers?))\b/i, label: "HappyClients" },
  { pattern: /\b(case\s*study|success\s*stor(y|ies))\b/i, label: "CaseStudy" },
  { pattern: /\b(exclusive|members?\s*only|insider)\b/i, label: "Exclusivity" },
  { pattern: /\b(industry\s*leader|market\s*leader|number\s*one|#1)\b/i, label: "MarketLeader" },
  { pattern: /(عملاء|شهادات|نتائج|معتمد)/i, label: "Trust_AR" },
  { pattern: /(ضمان|مضمون|بدون\s*مخاطر)/i, label: "Guarantee_AR" },
  { pattern: /(حائز|جائزة|الأول|رقم\s*واحد)/i, label: "MarketLeader_AR" },
  { pattern: /(حصري|للأعضاء\s*فقط)/i, label: "Exclusivity_AR" },
];

const OFFER_PATTERNS = [
  /\d+\s*%\s*(off|خصم|discount)/i,
  /\b(AED|USD|SAR|QAR|KWD|BHD|OMR)\s*\d+/i,
  /\b(free)\b|مجان[يا]/i,
  /\b(sale)\b|تخفيض|عرض/i,
  /\bbuy\s*\d+\s*get\s*\d+/i,
  /\b(limited\s*time|limited\s*offer)\b/i,
];

export interface CTAIntentResult {
  ctaIntentScore: number;
  ctaTypeDistribution: {
    explicit: number;
    soft: number;
    narrative: number;
    trust: number;
  };
  detectedPatterns: string[];
  explanation: string;
  hasCTA: boolean;
  ctaType: string | null;
  hasOffer: boolean;
  missingSignalFlags: { ctaPatterns: boolean };
  confidenceDowngrade: boolean;
}

export function detectCTAIntent(caption: string | null): CTAIntentResult {
  const emptyResult: CTAIntentResult = {
    ctaIntentScore: 0,
    ctaTypeDistribution: { explicit: 0, soft: 0, narrative: 0, trust: 0 },
    detectedPatterns: [],
    explanation: "No caption text available",
    hasCTA: false,
    ctaType: null,
    hasOffer: false,
    missingSignalFlags: { ctaPatterns: true },
    confidenceDowngrade: true,
  };

  if (!caption) return emptyResult;

  const trimmed = caption.trim();
  if (trimmed.length < 10) {
    return {
      ...emptyResult,
      explanation: "Insufficient caption text for CTA analysis",
    };
  }

  const explicitMatches: string[] = [];
  const softMatches: string[] = [];
  const narrativeMatches: string[] = [];
  const trustMatches: string[] = [];

  for (const { pattern, label } of EXPLICIT_CTA_PATTERNS) {
    if (pattern.test(trimmed)) explicitMatches.push(label);
  }
  for (const { pattern, label } of SOFT_CTA_PATTERNS) {
    if (pattern.test(trimmed)) softMatches.push(label);
  }
  for (const { pattern, label } of NARRATIVE_CTA_PATTERNS) {
    if (pattern.test(trimmed)) narrativeMatches.push(label);
  }
  for (const { pattern, label } of TRUST_CTA_PATTERNS) {
    if (pattern.test(trimmed)) trustMatches.push(label);
  }

  const allPatterns = [...explicitMatches, ...softMatches, ...narrativeMatches, ...trustMatches];
  const totalMatches = allPatterns.length;

  const explicitWeight = 1.0;
  const softWeight = 0.7;
  const narrativeWeight = 0.5;
  const trustWeight = 0.6;

  const weightedScore =
    explicitMatches.length * explicitWeight +
    softMatches.length * softWeight +
    narrativeMatches.length * narrativeWeight +
    trustMatches.length * trustWeight;

  const maxPossibleScore = 5.0;
  const ctaIntentScore = Math.min(1, Math.round((weightedScore / maxPossibleScore) * 100) / 100);

  const totalCategoryMatches = Math.max(1, totalMatches);
  const ctaTypeDistribution = {
    explicit: Math.round((explicitMatches.length / totalCategoryMatches) * 100) / 100,
    soft: Math.round((softMatches.length / totalCategoryMatches) * 100) / 100,
    narrative: Math.round((narrativeMatches.length / totalCategoryMatches) * 100) / 100,
    trust: Math.round((trustMatches.length / totalCategoryMatches) * 100) / 100,
  };

  const hasOffer = OFFER_PATTERNS.some(p => p.test(trimmed));
  const hasCTA = totalMatches > 0;

  const explanationParts: string[] = [];
  if (explicitMatches.length > 0) explanationParts.push(`Explicit(${explicitMatches.join(",")})`);
  if (softMatches.length > 0) explanationParts.push(`Soft(${softMatches.join(",")})`);
  if (narrativeMatches.length > 0) explanationParts.push(`Narrative(${narrativeMatches.join(",")})`);
  if (trustMatches.length > 0) explanationParts.push(`Trust(${trustMatches.join(",")})`);

  const explanation = explanationParts.length > 0
    ? `Intent detected: ${explanationParts.join(" | ")}`
    : "No CTA intent patterns detected";

  const legacyCtaTypes: string[] = [];
  if (explicitMatches.length > 0) legacyCtaTypes.push(...explicitMatches);
  if (softMatches.length > 0) legacyCtaTypes.push(...softMatches);
  if (narrativeMatches.length > 0) legacyCtaTypes.push(...narrativeMatches);
  if (trustMatches.length > 0) legacyCtaTypes.push(...trustMatches);

  return {
    ctaIntentScore,
    ctaTypeDistribution,
    detectedPatterns: allPatterns,
    explanation,
    hasCTA,
    ctaType: legacyCtaTypes.length > 0 ? legacyCtaTypes.join(",") : null,
    hasOffer,
    missingSignalFlags: { ctaPatterns: false },
    confidenceDowngrade: false,
  };
}

interface CTADetection {
  hasCTA: boolean;
  ctaType: string | null;
  hasOffer: boolean;
}

function detectCTA(caption: string | null): CTADetection {
  const intent = detectCTAIntent(caption);
  return {
    hasCTA: intent.hasCTA,
    ctaType: intent.ctaType,
    hasOffer: intent.hasOffer,
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

const SPAM_BOT_PATTERNS = [
  /\bfollow\s*(me|back|4follow|for\s*follow)\b/i,
  /\b(dm|message)\s*(me|for)\s*(promo|collab|deal|info)\b/i,
  /\bcheck\s*(my|out\s*my)\s*(page|profile|bio|link)\b/i,
  /\blink\s*in\s*(my\s*)?bio\b/i,
  /\b(free|earn)\s*(money|cash|gift|followers|likes)\b/i,
  /\bgrow\s*your\s*(account|followers|page)\b/i,
  /\b(buy|get)\s*(followers|likes|views)\b/i,
  /\bI\s*can\s*help\s*you\s*(grow|get|gain)\b/i,
  /\b(promo|promote)\s*(available|dm|prices?)\b/i,
  /\bwant\s*to\s*be\s*featured\b/i,
  /\bcongrat[sz]?\s*you\s*(won|are\s*selected)\b/i,
  /\b(click|tap)\s*(the\s*)?(link|here)\b/i,
];

const EMOJI_ONLY_RE = /^[\s\p{Emoji}\p{Emoji_Presentation}\p{Emoji_Modifier}\p{Emoji_Modifier_Base}\p{Emoji_Component}\u200d\ufe0f\u2764\u2665\u2600-\u26FF\u2700-\u27BF]*$/u;
const MIN_MEANINGFUL_CHARS = 3;

interface SpamFilterResult {
  filtered: { text: string; [key: string]: any }[];
  spamCount: number;
  spamReasons: Record<string, number>;
}

export function filterSpamComments<T extends { text?: string; commentText?: string }>(comments: T[]): SpamFilterResult & { filtered: T[] } {
  const filtered: T[] = [];
  let spamCount = 0;
  const spamReasons: Record<string, number> = {};

  function countReason(reason: string) {
    spamReasons[reason] = (spamReasons[reason] || 0) + 1;
    spamCount++;
  }

  for (const comment of comments) {
    const text = (comment.text || comment.commentText || "").trim();

    if (!text || text.length === 0) {
      countReason("empty");
      continue;
    }

    const strippedText = text.replace(/[\s@#\p{Emoji}\p{Emoji_Presentation}\p{Emoji_Modifier}\p{Emoji_Modifier_Base}\p{Emoji_Component}\u200d\ufe0f\u2764\u2665\u2600-\u26FF\u2700-\u27BF]/gu, "");
    if (strippedText.length < MIN_MEANINGFUL_CHARS) {
      if (EMOJI_ONLY_RE.test(text)) {
        countReason("emoji_only");
      } else {
        countReason("too_short");
      }
      continue;
    }

    const tagStripped = text.replace(/@[\w.]+/g, "").replace(/#[\w\u0600-\u06FF]+/g, "").trim();
    if (tagStripped.length < MIN_MEANINGFUL_CHARS) {
      countReason("tag_only");
      continue;
    }

    if (/^(.)\1{4,}$/.test(strippedText)) {
      countReason("repeated_chars");
      continue;
    }

    let isSpam = false;
    for (const pattern of SPAM_BOT_PATTERNS) {
      if (pattern.test(text)) {
        countReason("bot_spam");
        isSpam = true;
        break;
      }
    }
    if (isSpam) continue;

    filtered.push(comment);
  }

  return { filtered, spamCount, spamReasons };
}

export type CollectionMode = "FAST_PASS" | "DEEP_PASS";
export type ScrapeMode = "INITIAL" | "INCREMENTAL";

export interface FetchOptions {
  scrapeMode?: ScrapeMode;
  windowDays?: number;
  watermark?: Date | null;
}

const TARGET_POSTS_FAST = 12;
const TARGET_POSTS_BASELINE = 12;
const TARGET_POSTS_INCREMENTAL = 5;
const CONSECUTIVE_DUPLICATE_THRESHOLD = 3;

const TARGET_POSTS_DEEP = 12;
const MAX_COMMENT_POSTS_DEEP = 12;
const MAX_COMMENTS_PER_POST_DEEP = 10;

const FETCH_COOLDOWN_MS = 72 * 60 * 60 * 1000;
const CACHE_REUSE_WINDOW_MS = 12 * 60 * 60 * 1000;
const MAX_POSTS_TO_STORE = 12;
const MIN_POSTS_THRESHOLD = MI_THRESHOLDS.MIN_POSTS_PER_COMPETITOR;
const MIN_COMMENTS_THRESHOLD = MI_THRESHOLDS.MIN_COMMENTS_SAMPLE;

export { TARGET_POSTS_FAST, TARGET_POSTS_DEEP, MAX_COMMENT_POSTS_DEEP, MAX_COMMENTS_PER_POST_DEEP, CACHE_REUSE_WINDOW_MS };

// F6.9 — each in-flight fetch carries an AbortController + 45s wall-clock
// watchdog. On timeout the entry is aborted+evicted and resolved with
// INSUFFICIENT_DATA so a fresh attempt can run. The signal is threaded
// into _executeFetch so cancellable paths short-circuit via FETCH_ABORTED.
// P-6.12: default raised 45s → 300s. Apify actor runs complete in 13–315s
// (live-verified P-6.11); a 45s watchdog would abort most healthy actor runs.
export const FETCH_WATCHDOG_TIMEOUT_MS = parseInt(
  process.env.FETCH_WATCHDOG_TIMEOUT_MS || "300000",
  10,
);
interface ActiveFetch {
  promise: Promise<FetchResult>;
  abortController: AbortController;
  startedAt: number;
}
const activeFetches = new Map<string, ActiveFetch>();

/**
 * Race a promise against a wall-clock timeout. On timeout, abort the
 * controller, run onTimeout(), and resolve with the fallback value.
 * Always clears the timer in finally so we never leak handles.
 *
 * Exported for behavioral testing (architect-required: must validate
 * timer cleanup + leak prevention under forced timeout, not via regex).
 */
export async function withWatchdog<T>(
  promise: Promise<T>,
  timeoutMs: number,
  abortController: AbortController,
  onTimeout: () => T,
): Promise<{ value: T; timedOut: boolean }> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;
  const watchdogPromise = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      try { abortController.abort(); } catch {}
      resolve(onTimeout());
    }, timeoutMs);
  });
  try {
    const value = await Promise.race([promise, watchdogPromise]);
    return { value, timedOut };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function cancelFetch(accountId: string, competitorId: string): boolean {
  const lockKey = `${accountId}:${competitorId}`;
  const entry = activeFetches.get(lockKey);
  if (!entry) return false;
  try { entry.abortController.abort(); } catch {}
  activeFetches.delete(lockKey);
  return true;
}

export function getActiveFetchCount(): number {
  return activeFetches.size;
}

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
  status: "SUCCESS" | "PARTIAL" | "BLOCKED" | "COOLDOWN" | "INSUFFICIENT_DATA";
  message: string;
  // Fix #1 — set ONLY on status "BLOCKED". Lets the fetch-orchestrator gate the
  // 24h platform-block stamp: only "GENUINE_BLOCK" (a verified auth/challenge/
  // 403 wall) may persist it; "TRANSIENT" (timeout / contention / cooldown echo)
  // must never re-stamp. Absent ⇒ treated as non-genuine (no stamp).
  blockClass?: "GENUINE_BLOCK" | "TRANSIENT";
  rawFetchedCount?: number;
  paginationPages?: number;
  paginationStopReason?: string;
  collectionMode?: CollectionMode;
  cachedPostsReused?: number;
  newWatermark?: Date | null;
  scrapeMode?: ScrapeMode;
}

export async function fetchCompetitorData(
  competitorId: string,
  accountId: string,
  forceRefresh: boolean = false,
  // Deprecated (P-6.12): sticky proxy sessions retired with Bright Data.
  // Positional slot kept so existing call sites need no change; value ignored.
  _legacyProxyCtx?: unknown,
  collectionMode: CollectionMode = "FAST_PASS",
  fetchOptions?: FetchOptions,
): Promise<FetchResult> {
  const lockKey = `${accountId}:${competitorId}`;
  const existing = activeFetches.get(lockKey);
  if (existing) {
    // F6.9 watchdog — if the in-flight entry has been alive longer than
    // FETCH_WATCHDOG_TIMEOUT_MS, treat it as dead, abort, evict, and
    // start a fresh fetch. This is the safety net for the case where
    // _executeFetch's inner await never resolves.
    if (Date.now() - existing.startedAt > FETCH_WATCHDOG_TIMEOUT_MS) {
      console.warn(`[DataAcq] WATCHDOG_EVICT | ${lockKey} | ageMs=${Date.now() - existing.startedAt} | aborting and restarting`);
      try { existing.abortController.abort(); } catch {}
      activeFetches.delete(lockKey);
    } else {
      console.log(`[DataAcq] Concurrent fetch detected for ${lockKey}, reusing in-flight`);
      return existing.promise;
    }
  }

  const abortController = new AbortController();
  // Thread the abort signal into _executeFetch so cancellable awaits
  // (scraper, DB checkpoints) can observe signal.aborted and bail.
  const innerPromise = _executeFetch(
    competitorId, accountId, forceRefresh, collectionMode, fetchOptions,
    abortController.signal,
  );
  const racedTask = withWatchdog<FetchResult>(
    innerPromise,
    FETCH_WATCHDOG_TIMEOUT_MS,
    abortController,
    () => {
      console.warn(`[DataAcq] FETCH_TIMEOUT | ${lockKey} | timeoutMs=${FETCH_WATCHDOG_TIMEOUT_MS} | returning INSUFFICIENT_DATA`);
      return {
        competitorId,
        postsCollected: 0,
        commentsCollected: 0,
        ctaCoverage: 0,
        ctaTypes: [],
        followers: null,
        engagementRate: null,
        postingFrequency: null,
        contentMix: null,
        fetchMethod: "watchdog_timeout",
        status: "INSUFFICIENT_DATA" as const,
        message: `Fetch exceeded ${FETCH_WATCHDOG_TIMEOUT_MS}ms watchdog`,
      };
    },
  ).then(({ value }) => value);

  activeFetches.set(lockKey, { promise: racedTask, abortController, startedAt: Date.now() });
  try {
    return await racedTask;
  } finally {
    activeFetches.delete(lockKey);
  }
}

/** Throws FETCH_ABORTED if the abort signal has been triggered. Called
 *  at every major checkpoint inside _executeFetch so the watchdog can
 *  actually preempt long-running scraper work. */
function checkAborted(signal: AbortSignal | undefined, where: string): void {
  if (signal?.aborted) {
    const e: any = new Error(`FETCH_ABORTED at ${where}`);
    e.code = "FETCH_ABORTED";
    throw e;
  }
}

async function _executeFetch(
  competitorId: string,
  accountId: string,
  forceRefresh: boolean,
  collectionMode: CollectionMode = "FAST_PASS",
  fetchOptions?: FetchOptions,
  signal?: AbortSignal,
): Promise<FetchResult> {
  checkAborted(signal, "executeFetch:entry");
  const [competitor] = await db.select().from(ciCompetitors)
    .where(and(eq(ciCompetitors.id, competitorId), eq(ciCompetitors.accountId, accountId)));

  if (!competitor) {
    return { competitorId, postsCollected: 0, commentsCollected: 0, ctaCoverage: 0, ctaTypes: [], followers: null, engagementRate: null, postingFrequency: null, contentMix: null, fetchMethod: "NONE", status: "BLOCKED", blockClass: "TRANSIENT", message: "Competitor not found" };
  }

  if (collectionMode === "DEEP_PASS") {
    console.log(`[DataAcq] DEEP_PASS_CACHE_BYPASS: ${competitor.name} — skipping cache/cooldown checks for DEEP_PASS post expansion`);
  }

  const normalizedHandle = extractHandleFromUrl(competitor.profileLink ?? "");

  if (!forceRefresh && collectionMode !== "DEEP_PASS" && normalizedHandle) {
    const sharedLookup = await lookupSharedProfile("instagram", normalizedHandle, MIN_POSTS_THRESHOLD);

    if (sharedLookup.found && !sharedLookup.isStale && sharedLookup.sharedProfileId) {
      const reuseResult = await reuseFromSharedPool(
        competitorId,
        accountId,
        sharedLookup.sharedProfileId,
        sharedLookup
      );

      if (reuseResult) {
        const hoursAgo = sharedLookup.lastScrapedAt
          ? Math.round((Date.now() - sharedLookup.lastScrapedAt.getTime()) / (60 * 60 * 1000) * 10) / 10
          : 0;

        return {
          competitorId,
          postsCollected: reuseResult.postsCollected,
          commentsCollected: reuseResult.commentsCollected,
          ctaCoverage: reuseResult.ctaCoverage,
          ctaTypes: reuseResult.ctaTypes,
          followers: reuseResult.followers,
          engagementRate: reuseResult.engagementRate,
          postingFrequency: reuseResult.postingFrequency,
          contentMix: reuseResult.contentMix,
          fetchMethod: "SHARED_REUSE",
          status: "SUCCESS",
          message: `Shared pool reuse: data from ${hoursAgo}h ago with ${reuseResult.postsCollected} posts — no re-scrape needed.`,
          cachedPostsReused: reuseResult.postsCollected,
        };
      }
    }
  }

  // Fix #1b — recovery probe replaces the blind 24h lock-out. A competitor
  // previously stamped BLOCKED_BY_PLATFORM is NOT held for a full 24h with zero
  // attempts. The self-perpetuation bug (every failed run re-stamping
  // lastCheckedAt) is fixed in the fetch-orchestrator (only a GENUINE_BLOCK
  // re-stamps). Here we additionally re-probe: once the block is older than
  // BLOCKED_PROBE_INTERVAL_MS we fall through and actually attempt a scrape. A
  // genuine still-blocked result re-stamps upstream (resetting this window); a
  // recovery overwrites fetchMethod on the successful-fetch update, clearing the
  // flag. Only a very recent block short-circuits, to avoid hammering a real
  // wall on every scheduled run. The short-circuit returns status BLOCKED
  // WITHOUT blockClass "GENUINE_BLOCK" so it can NEVER re-stamp (that would
  // reintroduce self-perpetuation through the cooldown echo).
  const BLOCKED_PROBE_INTERVAL_MS = 6 * 60 * 60 * 1000;
  if (!forceRefresh && collectionMode !== "DEEP_PASS" && competitor.fetchMethod === "BLOCKED_BY_PLATFORM" && competitor.lastCheckedAt) {
    const elapsedSinceBlock = Date.now() - new Date(competitor.lastCheckedAt).getTime();
    const hoursAgo = Math.round(elapsedSinceBlock / (60 * 60 * 1000) * 10) / 10;
    if (elapsedSinceBlock < BLOCKED_PROBE_INTERVAL_MS) {
      const minutesLeft = Math.ceil((BLOCKED_PROBE_INTERVAL_MS - elapsedSinceBlock) / (60 * 1000));
      console.log(`[DataAcq] BLOCKED_COOLDOWN: ${competitor.name} was platform-blocked ${hoursAgo}h ago. Next recovery probe in ${minutesLeft}m.`);
      return {
        competitorId,
        postsCollected: 0,
        commentsCollected: 0,
        ctaCoverage: 0,
        ctaTypes: [],
        followers: null,
        engagementRate: null,
        postingFrequency: null,
        contentMix: null,
        fetchMethod: "BLOCKED_COOLDOWN",
        status: "BLOCKED",
        blockClass: "TRANSIENT",
        message: `Platform blocked ${hoursAgo}h ago — next recovery probe in ${minutesLeft}m.`,
      };
    }
    console.log(`[DataAcq] BLOCKED_COOLDOWN_PROBE: ${competitor.name} was platform-blocked ${hoursAgo}h ago (>= ${Math.round(BLOCKED_PROBE_INTERVAL_MS / (60 * 60 * 1000))}h probe interval). Attempting recovery scrape.`);
  }

  if (!forceRefresh && collectionMode !== "DEEP_PASS") {
    const latestMetrics = await db.select().from(ciCompetitorMetricsSnapshot)
      .where(and(eq(ciCompetitorMetricsSnapshot.competitorId, competitorId), eq(ciCompetitorMetricsSnapshot.accountId, accountId)))
      .orderBy(desc(ciCompetitorMetricsSnapshot.createdAt))
      .limit(1);

    if (latestMetrics.length > 0 && latestMetrics[0].lastFetchAt) {
      const elapsed = Date.now() - new Date(latestMetrics[0].lastFetchAt).getTime();

      if (elapsed < CACHE_REUSE_WINDOW_MS) {
        const livePostCount = await db.select({ count: sql<number>`count(*)` }).from(ciCompetitorPosts)
          .where(and(eq(ciCompetitorPosts.competitorId, competitorId), eq(ciCompetitorPosts.accountId, accountId)));
        const cachedPosts = Number(livePostCount[0]?.count || 0);

        if (cachedPosts >= MIN_POSTS_THRESHOLD) {
          const liveCommentCount = await db.select({ count: sql<number>`count(*)` }).from(ciCompetitorComments)
            .where(and(eq(ciCompetitorComments.competitorId, competitorId), eq(ciCompetitorComments.accountId, accountId)));
          const cachedComments = Number(liveCommentCount[0]?.count || 0);
          const hoursAgo = Math.round(elapsed / (60 * 60 * 1000) * 10) / 10;

          console.log(`[DataAcq] CACHE_REUSE: ${competitor.name} fetched ${hoursAgo}h ago with ${cachedPosts} posts (>= ${MIN_POSTS_THRESHOLD}). Reusing cached data.`);

          return {
            competitorId,
            postsCollected: cachedPosts,
            commentsCollected: cachedComments,
            ctaCoverage: latestMetrics[0].ctaCoverage || 0,
            ctaTypes: latestMetrics[0].ctaTypes ? latestMetrics[0].ctaTypes.split(",") : [],
            followers: latestMetrics[0].followers,
            engagementRate: latestMetrics[0].engagementRate,
            postingFrequency: latestMetrics[0].postingFrequency,
            contentMix: latestMetrics[0].contentMix,
            fetchMethod: "CACHE_REUSE",
            status: "SUCCESS",
            message: `Cache reuse: data fetched ${hoursAgo}h ago with sufficient coverage (${cachedPosts} posts, ${cachedComments} comments).`,
            cachedPostsReused: cachedPosts,
          };
        }
      }

      // Seal #5 / F7.8 — tier-aware cooldown. Tier-A = priority competitor
      // (24h refresh); Tier-B = standard (72h). Falls back to 72h if the
      // tier column is unset or unrecognized.
      const competitorTier = (competitor as any).tier === "A" ? "A" : "B";
      const tierCooldownMs = competitorTier === "A" ? 24 * 60 * 60 * 1000 : FETCH_COOLDOWN_MS;
      if (elapsed < tierCooldownMs) {
        const hoursLeft = Math.ceil((tierCooldownMs - elapsed) / (60 * 60 * 1000));

        const livePostCount = await db.select({ count: sql<number>`count(*)` }).from(ciCompetitorPosts)
          .where(and(eq(ciCompetitorPosts.competitorId, competitorId), eq(ciCompetitorPosts.accountId, accountId)));
        const liveCommentCount = await db.select({ count: sql<number>`count(*)` }).from(ciCompetitorComments)
          .where(and(eq(ciCompetitorComments.competitorId, competitorId), eq(ciCompetitorComments.accountId, accountId)));

        const postsCollected = Number(livePostCount[0]?.count || 0);
        const commentsCollected = Number(liveCommentCount[0]?.count || 0);

        const coverageMet = postsCollected >= MIN_POSTS_THRESHOLD;

        if (!coverageMet) {
          console.log(`[DataAcq] COOLDOWN_BYPASS: Coverage insufficient for ${competitor.name} (${postsCollected}/${MIN_POSTS_THRESHOLD} posts). Allowing re-fetch despite ${hoursLeft}h cooldown remaining.`);
        } else {
          const tierLabel = competitorTier === "A" ? "24h (tier A)" : "72h (tier B)";
          console.log(`[DataAcq] ${tierLabel} cooldown active for ${competitor.name}, ${hoursLeft}h remaining. Coverage met (${postsCollected} posts, ${commentsCollected} comments).`);

          return {
            competitorId,
            postsCollected,
            commentsCollected,
            ctaCoverage: latestMetrics[0].ctaCoverage || 0,
            ctaTypes: latestMetrics[0].ctaTypes ? latestMetrics[0].ctaTypes.split(",") : [],
            followers: latestMetrics[0].followers,
            engagementRate: latestMetrics[0].engagementRate,
            postingFrequency: latestMetrics[0].postingFrequency,
            contentMix: latestMetrics[0].contentMix,
            fetchMethod: latestMetrics[0].fetchMethod || "CACHED",
            status: "COOLDOWN",
            message: `${tierLabel} refresh cooldown active. ${hoursLeft}h remaining.`,
          };
        }
      }
    }
  }

  const scrapeMode: ScrapeMode = fetchOptions?.scrapeMode ?? "INITIAL";
  const windowDays = fetchOptions?.windowDays ?? 7;
  const watermark = fetchOptions?.watermark ?? null;

  const isIncremental = scrapeMode === "INCREMENTAL" && collectionMode !== "DEEP_PASS";
  const cutoffDate: Date | null = isIncremental
    ? (() => {
        const windowCutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
        if (watermark && watermark > windowCutoff) return watermark;
        return windowCutoff;
      })()
    : null;

  if (isIncremental) {
    console.log(`[DataAcq] INCREMENTAL mode for ${competitor.name} | windowDays=${windowDays} | watermark=${watermark?.toISOString() ?? "none"} | cutoff=${cutoffDate!.toISOString()}`);
  }

  const maxPosts = isIncremental ? TARGET_POSTS_INCREMENTAL : (collectionMode === "FAST_PASS" ? TARGET_POSTS_FAST : TARGET_POSTS_DEEP);

  if (collectionMode === "DEEP_PASS") {
    const storedPostCount = await db.select({ count: sql<number>`count(*)` }).from(ciCompetitorPosts)
      .where(and(eq(ciCompetitorPosts.competitorId, competitorId), eq(ciCompetitorPosts.accountId, accountId)));
    const existingStoredPostTotal = Number(storedPostCount[0]?.count || 0);
    if (existingStoredPostTotal >= TARGET_POSTS_DEEP) {
      console.log(`[DataAcq] DEEP_PASS_SKIP: ${competitor.name} already has ${existingStoredPostTotal} posts (>= ${TARGET_POSTS_DEEP}). Skipping additional post collection.`);

      const existingCommentCount = await db.select({ count: sql<number>`count(*)` }).from(ciCompetitorComments)
        .where(and(eq(ciCompetitorComments.competitorId, competitorId), eq(ciCompetitorComments.accountId, accountId)));
      const existingComments = Number(existingCommentCount[0]?.count || 0);

      return {
        competitorId,
        postsCollected: existingStoredPostTotal,
        commentsCollected: existingComments,
        ctaCoverage: 0, ctaTypes: [],
        followers: null, engagementRate: null, postingFrequency: null, contentMix: null,
        fetchMethod: "DEEP_PASS_SKIP" as any,
        status: existingStoredPostTotal >= MIN_POSTS_THRESHOLD ? "COMPLETE" : "PARTIAL_COMPLETE",
        message: `Already has ${existingStoredPostTotal} posts. Post collection skipped.`,
      };
    }
  }

  console.log(`[DataAcq] Starting ${collectionMode} fetch for ${competitor.name} (${competitor.profileLink}) | maxPosts=${maxPosts}`);

  checkAborted(signal, "executeFetch:beforeProfileScrape");
  // P-6.12: ALL competitor profile acquisition routes through the Instagram
  // provider (Apify actor). Bright Data no longer exists in this codebase.
  // (competitor.platform is instagram-only today; TikTok posts arrive via the
  // dedicated tiktok-scraper path, not _executeFetch.)
  const scrapeResult = await scrapeInstagramForCompetitor(normalizedHandle || competitor.profileLink || "", maxPosts, accountId);
  checkAborted(signal, "executeFetch:afterProfileScrape");

  if (!scrapeResult.success || scrapeResult.posts.length === 0) {
    // Fix #1 — split "healthy empty" from a genuine/transient block. When the
    // scraper's transport reached the platform and returned zero posts
    // (failureClass === "NONE"), this is NOT a block — it is a competitor with
    // no fetchable recent posts. Report INSUFFICIENT_DATA carrying whatever is
    // already stored, and emit NO blockClass so the orchestrator never persists
    // a 24h platform-block stamp. Only a classified transport failure
    // (GENUINE_BLOCK / TRANSIENT) returns status BLOCKED with blockClass, and
    // only GENUINE_BLOCK is allowed to stamp downstream.
    const existingStoredForEmpty = await db.select({ count: sql<number>`count(*)` }).from(ciCompetitorPosts)
      .where(and(eq(ciCompetitorPosts.competitorId, competitorId), eq(ciCompetitorPosts.accountId, accountId)));
    const existingStoredEmptyCount = Number(existingStoredForEmpty[0]?.count || 0);

    if (scrapeResult.failureClass === "NONE") {
      // Report what is already stored (posts AND comments) rather than zeroing.
      // The success/processed path writes these counts onto ciCompetitors, so a
      // hard 0 here would erase the recorded comment count while the comments
      // remain in the DB. Mirrors postsCollected = existingStoredEmptyCount.
      const existingCommentsForEmpty = await db.select({ count: sql<number>`count(*)` }).from(ciCompetitorComments)
        .where(and(eq(ciCompetitorComments.competitorId, competitorId), eq(ciCompetitorComments.accountId, accountId)));
      const existingCommentsEmptyCount = Number(existingCommentsForEmpty[0]?.count || 0);
      console.log(`[DataAcq] HEALTHY_EMPTY: ${competitor.name} — transport reached platform, 0 new posts (stored=${existingStoredEmptyCount}, comments=${existingCommentsEmptyCount}). Not a block.`);
      return {
        competitorId,
        postsCollected: existingStoredEmptyCount, commentsCollected: existingCommentsEmptyCount, ctaCoverage: 0, ctaTypes: [],
        followers: scrapeResult.followers, engagementRate: null, postingFrequency: null, contentMix: null,
        fetchMethod: scrapeResult.collectionMethodUsed,
        status: "INSUFFICIENT_DATA",
        message: `No fetchable recent posts (transport OK). ${existingStoredEmptyCount} post(s) already stored.`,
      };
    }

    console.log(`[DataAcq] Scrape blocked for ${competitor.name} | blockClass=${scrapeResult.failureClass}`);
    return {
      competitorId,
      postsCollected: 0, commentsCollected: 0, ctaCoverage: 0, ctaTypes: [],
      followers: null, engagementRate: null, postingFrequency: null, contentMix: null,
      fetchMethod: scrapeResult.collectionMethodUsed,
      status: "BLOCKED",
      blockClass: scrapeResult.failureClass,
      message: "Scraping blocked. All methods failed. Using cached data if available.",
    };
  }

  const existingPostCount = await db.select({ count: sql<number>`count(*)` }).from(ciCompetitorPosts)
    .where(and(eq(ciCompetitorPosts.competitorId, competitorId), eq(ciCompetitorPosts.accountId, accountId)));
  const existingPosts = Number(existingPostCount[0]?.count || 0);

  if (!isIncremental && existingPosts > 0 && scrapeResult.posts.length < existingPosts) {
    console.log(`[DataAcq] DATA_DEGRADATION_GUARD: New fetch returned ${scrapeResult.posts.length} posts, DB has ${existingPosts}. Keeping existing data for ${competitor.name}.`);
    const existingCommentCount = await db.select({ count: sql<number>`count(*)` }).from(ciCompetitorComments)
      .where(and(eq(ciCompetitorComments.competitorId, competitorId), eq(ciCompetitorComments.accountId, accountId)));
    const existingComments = Number(existingCommentCount[0]?.count || 0);

    await db.insert(ciCompetitorMetricsSnapshot).values({
      competitorId, accountId,
      postsCollected: existingPosts,
      commentsCollected: existingComments,
      followers: scrapeResult.followers,
      lastFetchAt: new Date(),
      fetchMethod: scrapeResult.collectionMethodUsed,
    });

    // Clear any BLOCKED_BY_PLATFORM stamp when the scrape actually succeeded
    // (DATA_DEGRADATION_GUARD preserves stored data but the transport was healthy).
    await db.update(ciCompetitors)
      .set({
        fetchMethod: scrapeResult.collectionMethodUsed || collectionMode || "FAST_PASS",
        lastCheckedAt: new Date(),
        updatedAt: new Date(),
        ...(scrapeResult.followers != null ? { followers: scrapeResult.followers } : {}),
      })
      .where(eq(ciCompetitors.id, competitorId));

    return {
      competitorId,
      postsCollected: existingPosts,
      commentsCollected: existingComments,
      ctaCoverage: 0, ctaTypes: [],
      followers: scrapeResult.followers,
      engagementRate: null, postingFrequency: null, contentMix: null,
      fetchMethod: scrapeResult.collectionMethodUsed,
      status: existingPosts >= MIN_POSTS_THRESHOLD ? "PARTIAL_COMPLETE" : "INSUFFICIENT_DATA",
      message: `Kept existing ${existingPosts} posts (new fetch got only ${scrapeResult.posts.length}). Pagination limited by Instagram API ceiling.`,
      paginationStopReason: scrapeResult.paginationStopReason || "INSTAGRAM_API_CEILING",
      rawFetchedCount: scrapeResult.rawFetchedCount,
      paginationPages: scrapeResult.paginationPages,
    };
  }

  const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  const postsToStore = scrapeResult.posts.slice(0, MAX_POSTS_TO_STORE);

  const existingStoredPosts = await db.select({
    postId: ciCompetitorPosts.postId,
    shortcode: ciCompetitorPosts.shortcode,
  }).from(ciCompetitorPosts)
    .where(and(eq(ciCompetitorPosts.competitorId, competitorId), eq(ciCompetitorPosts.accountId, accountId)));

  const existingPostIds = new Set(existingStoredPosts.map(p => p.postId));
  const existingShortcodes = new Set(existingStoredPosts.filter(p => p.shortcode).map(p => p.shortcode!));

  const existingPostIdsWithComments = new Set<string>();
  if (existingPostIds.size > 0) {
    const postIdsArray = Array.from(existingPostIds);
    const postsWithComments = await db.select({
      postId: ciCompetitorComments.postId,
    }).from(ciCompetitorComments)
      .where(and(
        eq(ciCompetitorComments.competitorId, competitorId),
        eq(ciCompetitorComments.accountId, accountId),
        inArray(ciCompetitorComments.postId, postIdsArray),
      ));
    for (const row of postsWithComments) {
      existingPostIdsWithComments.add(row.postId);
    }
  }

  const initialExistingPostCount = existingPostIds.size;

  let ctaCount = 0;
  const allCtaTypes: string[] = [];
  let commentsCollected = 0;
  let cachedPostsReused = 0;
  let consecutiveDuplicates = 0;
  let dateCutoffSkipped = 0;
  let earlyStopReason: string | null = null;

  const postInserts: Parameters<typeof db.insert>[0] extends any ? any[] : never = [];
  const commentInserts: any[] = [];
  const newPostIds: string[] = [];

  for (const post of postsToStore) {
    if (earlyStopReason) break;

    const isDuplicate = existingPostIds.has(post.postId) ||
      (post.shortcode && existingShortcodes.has(post.shortcode));

    if (isDuplicate) {
      cachedPostsReused++;
      if (isIncremental) {
        consecutiveDuplicates++;
        if (consecutiveDuplicates >= CONSECUTIVE_DUPLICATE_THRESHOLD) {
          earlyStopReason = `CONSECUTIVE_DUPLICATES_${consecutiveDuplicates}`;
          console.log(`[DataAcq] INCREMENTAL early-stop for ${competitor.name}: ${consecutiveDuplicates} consecutive duplicates hit`);
        }
      }
      continue;
    }

    consecutiveDuplicates = 0;

    if (isIncremental && cutoffDate && post.timestamp) {
      const postDate = new Date(post.timestamp);
      if (postDate < cutoffDate) {
        dateCutoffSkipped++;
        continue;
      }
    }

    const cta = detectCTA(post.caption);
    const hashtags = extractHashtags(post.caption);

    if (cta.hasCTA) ctaCount++;
    if (cta.ctaType) {
      for (const t of cta.ctaType.split(",")) {
        if (!allCtaTypes.includes(t)) allCtaTypes.push(t);
      }
    }

    newPostIds.push(post.postId);
    postInserts.push({
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
    existingPostIds.add(post.postId);
    if (post.shortcode) existingShortcodes.add(post.shortcode);
  }

  if (cachedPostsReused > 0) {
    console.log(`[DataAcq] CACHE_FIRST: ${cachedPostsReused} existing posts reused, ${postInserts.length} new posts to insert for ${competitor.name}`);
  }

  if (isIncremental && !earlyStopReason && dateCutoffSkipped > 0) {
    earlyStopReason = `INCREMENTAL_WINDOW_EXHAUSTED_cutoff=${dateCutoffSkipped}`;
    console.log(`[DataAcq] INCREMENTAL window exhausted for ${competitor.name}: ${dateCutoffSkipped} posts outside ${windowDays}d window, ${postInserts.length} new posts inserted`);
  }

  // P-6.12: comment acquisition is fully decoupled from the profile scrape.
  // The Apify profile actor returns no embedded comment threads
  // (scrapeResult.embeddedComments is always []), and synthetic comment
  // generation is RETIRED — comments are real-only, acquired by the dedicated
  // comment actor in enrichCompetitorWithComments (DEEP_PASS enrich flow).
  if (collectionMode !== "FAST_PASS") {
    console.log(`[DataAcq] ${collectionMode}: comment acquisition deferred to enrichCompetitorWithComments (real comment actor) for ${competitor.name}`);
  }

  await db.transaction(async (tx) => {
    for (const postRow of postInserts) {
      await tx.insert(ciCompetitorPosts).values(postRow).onConflictDoNothing();
    }
    for (const commentRow of commentInserts) {
      await tx.insert(ciCompetitorComments).values(commentRow).onConflictDoNothing();
    }
  });
  console.log(`[DataAcq] Transaction complete: inserted ${postInserts.length} new posts + ${commentInserts.length} comments (reused ${cachedPostsReused} cached posts) for ${competitor.name}`);

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

  const verifyPosts = await db.select({ count: sql<number>`count(*)` }).from(ciCompetitorPosts)
    .where(and(eq(ciCompetitorPosts.competitorId, competitorId), eq(ciCompetitorPosts.accountId, accountId)));
  const verifyComments = await db.select({ count: sql<number>`count(*)` }).from(ciCompetitorComments)
    .where(and(eq(ciCompetitorComments.competitorId, competitorId), eq(ciCompetitorComments.accountId, accountId)));

  const persistedPostCount = Number(verifyPosts[0]?.count || 0);
  const persistedCommentCount = Number(verifyComments[0]?.count || 0);

  const expectedPostCount = initialExistingPostCount + postInserts.length;
  if (persistedPostCount !== expectedPostCount) {
    console.warn(`[DataAcq] DATA_MISMATCH_WARN for ${competitor.name}: expected ${expectedPostCount} posts (${initialExistingPostCount} existing + ${postInserts.length} attempted) but DB has ${persistedPostCount} — likely caused by concurrent scrape or ON CONFLICT skip`);
  }

  let dataFreshnessDays = 0;
  const postTimestamps = postsToStore
    .filter(p => p.timestamp)
    .map(p => new Date(p.timestamp!).getTime());
  const commentTimestamps = commentInserts
    .filter((c: any) => c.timestamp)
    .map((c: any) => new Date(c.timestamp).getTime());
  const allTimestamps = [...postTimestamps, ...commentTimestamps];
  const newestTs = allTimestamps.length > 0 ? Math.max(...allTimestamps) : 0;
  if (newestTs > 0) {
    dataFreshnessDays = Math.max(0, Math.round((Date.now() - newestTs) / (1000 * 60 * 60 * 24)));
  }

  await db.insert(ciCompetitorMetricsSnapshot).values({
    competitorId,
    accountId,
    postsCollected: persistedPostCount,
    commentsCollected: persistedCommentCount,
    ctaCoverage: Math.round(ctaCoverage * 100) / 100,
    ctaTypes: allCtaTypes.join(","),
    followers: scrapeResult.followers,
    engagementRate,
    postingFrequency,
    contentMix,
    lastFetchAt: new Date(),
    fetchMethod: collectionMode || scrapeResult.collectionMethodUsed,
    fetchStatus: "COMPLETE",
    batchId,
    dataFreshnessDays,
  });

  const ctaPatternStr = allCtaTypes.length > 0 ? allCtaTypes.join(", ") : null;

  await db.update(ciCompetitors)
    .set({
      postingFrequency: postingFrequency ? Math.round(postingFrequency) : competitor.postingFrequency,
      engagementRatio: engagementRate || competitor.engagementRatio,
      ctaPatterns: ctaPatternStr || competitor.ctaPatterns,
      contentTypeRatio: contentMix || competitor.contentTypeRatio,
      lastCheckedAt: new Date(),
      analysisLevel: collectionMode === "DEEP_PASS" ? "DEEP_PASS" : "FAST_PASS",
      fetchMethod: collectionMode || "FAST_PASS",
      postsCollected: persistedPostCount,
      commentsCollected: persistedCommentCount,
      dataFreshnessDays,
      updatedAt: new Date(),
    })
    .where(eq(ciCompetitors.id, competitorId));

  if (normalizedHandle) {
    try {
      const sharedProfileId = await upsertSharedProfile("instagram", normalizedHandle, {
        followers: scrapeResult.followers,
        postCount: persistedPostCount,
        commentCount: persistedCommentCount,
        scrapeQuality: collectionMode === "DEEP_PASS" ? "DEEP_PASS" : "FAST_PASS",
        fetchMethod: collectionMode || scrapeResult.collectionMethodUsed || null,
      });
      await linkCompetitorToSharedProfile(competitorId, sharedProfileId);
      console.log(`[SharedPool] Upserted shared profile for @${normalizedHandle} (id=${sharedProfileId}, posts=${persistedPostCount})`);
    } catch (err) {
      console.warn(`[SharedPool] Non-fatal: failed to upsert shared profile for @${normalizedHandle}:`, err);
    }
  }

  const postsTarget = collectionMode === "FAST_PASS" ? TARGET_POSTS_FAST : MIN_POSTS_THRESHOLD;
  const coverageSufficient = persistedPostCount >= postsTarget;
  let fetchStatus: FetchResult["status"];
  let fetchMessage: string;

  const cacheInfo = cachedPostsReused > 0 ? ` (${cachedPostsReused} cached reused)` : "";

  if (coverageSufficient) {
    fetchStatus = "SUCCESS";
    fetchMessage = `${collectionMode}: Collected ${persistedPostCount} posts, ${persistedCommentCount} comments${cacheInfo}. Coverage thresholds met.`;
  } else if (persistedPostCount >= 5) {
    fetchStatus = "INSUFFICIENT_DATA";
    const missing: string[] = [];
    if (persistedPostCount < postsTarget) missing.push(`posts: ${persistedPostCount}/${postsTarget}`);
    fetchMessage = `${collectionMode}: Partial data collected${cacheInfo}. Below thresholds: ${missing.join(", ")}. Stop reason: ${scrapeResult.paginationStopReason || "unknown"}.`;
  } else {
    fetchStatus = "PARTIAL";
    fetchMessage = `${collectionMode}: Low data: ${persistedPostCount} posts, ${persistedCommentCount} comments${cacheInfo}. Scrape may be blocked or account is private.`;
  }

  const confirmedBatchPosts = postInserts.length > 0
    ? await db.select({ timestamp: ciCompetitorPosts.timestamp })
        .from(ciCompetitorPosts)
        .where(and(
          eq(ciCompetitorPosts.competitorId, competitorId),
          eq(ciCompetitorPosts.accountId, accountId),
          eq(ciCompetitorPosts.batchId, batchId),
        ))
    : [];
  const confirmedTimestamps = confirmedBatchPosts
    .map(p => p.timestamp)
    .filter((t): t is Date => t instanceof Date);
  const newWatermark: Date | null = confirmedTimestamps.length > 0
    ? new Date(Math.max(...confirmedTimestamps.map(t => t.getTime())))
    : null;

  console.log(
    `[DataAcq] SCRAPE_COMPLETE | competitor=${competitor.name}` +
    ` | scrapeMode=${scrapeMode}` +
    ` | window=${isIncremental ? `${windowDays}d` : "N/A"}` +
    ` | watermarkBefore=${watermark?.toISOString() ?? "none"}` +
    ` | rawFetched=${scrapeResult.posts.length}` +
    ` | inserted=${postInserts.length}` +
    ` | duplicatesSkipped=${cachedPostsReused}` +
    ` | cutoffSkipped=${dateCutoffSkipped}` +
    ` | stopReason=${earlyStopReason ?? scrapeResult.paginationStopReason ?? "N/A"}` +
    ` | watermarkAfter=${newWatermark?.toISOString() ?? "none"}` +
    ` | totalDBPosts=${persistedPostCount}` +
    ` | status=${fetchStatus}`
  );

  return {
    competitorId,
    postsCollected: persistedPostCount,
    commentsCollected: persistedCommentCount,
    ctaCoverage: Math.round(ctaCoverage * 100) / 100,
    ctaTypes: allCtaTypes,
    followers: scrapeResult.followers,
    engagementRate,
    postingFrequency,
    contentMix,
    fetchMethod: scrapeResult.collectionMethodUsed,
    status: fetchStatus,
    message: fetchMessage,
    rawFetchedCount: scrapeResult.rawFetchedCount,
    paginationPages: scrapeResult.paginationPages,
    paginationStopReason: earlyStopReason || scrapeResult.paginationStopReason,
    collectionMode,
    cachedPostsReused,
    newWatermark,
    scrapeMode,
  };
}

// P-6.12: generateSyntheticCommentSamples RETIRED. Synthetic comment
// generation no longer exists anywhere in acquisition — comments are
// real-only, from the Apify comment actor. Legacy synthetic-row cleanup
// (cleanupSyntheticData & friends below) is retained to purge historical rows.

export async function enrichCompetitorWithComments(competitorId: string, accountId: string, options?: { skipCooldown?: boolean }): Promise<{ commentsGenerated: number; status: string }> {
  const [competitor] = await db.select().from(ciCompetitors)
    .where(and(eq(ciCompetitors.id, competitorId), eq(ciCompetitors.accountId, accountId)));

  if (!competitor) {
    return { commentsGenerated: 0, status: "COMPETITOR_NOT_FOUND" };
  }

  if (!competitor.lastCheckedAt) {
    console.log(`[DataAcq] DEEP_PASS_BLOCKED: ${competitor.name} has no FAST_PASS data (lastCheckedAt is null). Cannot enrich before FAST_PASS completes.`);
    return { commentsGenerated: 0, status: "FAST_PASS_INCOMPLETE" };
  }

  if (!options?.skipCooldown && isSyntheticCooldownActive(competitor.lastSyntheticEnrichmentAt)) {
    const daysSince = ((Date.now() - new Date(competitor.lastSyntheticEnrichmentAt!).getTime()) / (1000 * 60 * 60 * 24)).toFixed(1);
    console.log(`[DataAcq] DEEP_PASS_ENRICH: ${competitor.name} — cooldown active (${daysSince}d since last enrichment, cooldown=${SYNTHETIC_ENRICHMENT_COOLDOWN_DAYS}d). Skipping.`);
    return { commentsGenerated: 0, status: "COOLDOWN_ACTIVE" };
  }

  const realCommentCount = await db.select({ count: sql<number>`count(*)` }).from(ciCompetitorComments)
    .where(and(eq(ciCompetitorComments.competitorId, competitorId), eq(ciCompetitorComments.accountId, accountId), eq(ciCompetitorComments.isSynthetic, false)));
  const realComments = Number(realCommentCount[0]?.count || 0);

  if (realComments >= MIN_COMMENTS_THRESHOLD) {
    console.log(`[DataAcq] DEEP_PASS_ENRICH: ${competitor.name} has ${realComments} real comments (>= ${MIN_COMMENTS_THRESHOLD} optimization target). Real data sufficient.`);
    return { commentsGenerated: realComments, status: "REAL_DATA_SUFFICIENT" };
  }

  if (competitor.enrichmentStatus === "ENRICHED" && !options?.skipCooldown && realComments >= MIN_COMMENTS_THRESHOLD) {
    console.log(`[DataAcq] DEEP_PASS_ENRICH: ${competitor.name} — already enriched (enrichmentStatus=ENRICHED) with sufficient real data. ALREADY_ENRICHED.`);
    return { commentsGenerated: 0, status: "ALREADY_ENRICHED" };
  }

  console.log(`[DataAcq] DEEP_PASS_ENRICH: ${competitor.name} has ${realComments} real comments (optimization target: ${MIN_COMMENTS_THRESHOLD}). Comment text is optional enrichment — pipeline will not block.`);

  const existingCommentCount = await db.select({ count: sql<number>`count(*)` }).from(ciCompetitorComments)
    .where(and(eq(ciCompetitorComments.competitorId, competitorId), eq(ciCompetitorComments.accountId, accountId)));
  const existingComments = Number(existingCommentCount[0]?.count || 0);

  const storedPosts = await db.select().from(ciCompetitorPosts)
    .where(and(eq(ciCompetitorPosts.competitorId, competitorId), eq(ciCompetitorPosts.accountId, accountId)))
    .orderBy(desc(ciCompetitorPosts.createdAt));

  if (storedPosts.length === 0) {
    console.log(`[DataAcq] DEEP_PASS_ENRICH: ${competitor.name} has no stored posts. Cannot scrape comments.`);
    return { commentsGenerated: 0, status: "NO_POSTS" };
  }

  const existingPostIdsWithComments = new Set<string>();
  const postIds = storedPosts.map(p => p.postId);
  const postsWithComments = await db.select({ postId: ciCompetitorComments.postId })
    .from(ciCompetitorComments)
    .where(and(
      eq(ciCompetitorComments.competitorId, competitorId),
      eq(ciCompetitorComments.accountId, accountId),
      inArray(ciCompetitorComments.postId, postIds),
    ));
  for (const row of postsWithComments) {
    existingPostIdsWithComments.add(row.postId);
  }

  const postsNeedingComments = storedPosts
    .filter(p => !existingPostIdsWithComments.has(p.postId))
    .filter(p => p.shortcode && ((p.comments && p.comments > 0) || (p.caption && p.caption.length > 10)))
    .sort((a, b) => {
      const engA = (a.likes || 0) + (a.comments || 0);
      const engB = (b.likes || 0) + (b.comments || 0);
      if (engB !== engA) return engB - engA;
      const tsA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const tsB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return tsB - tsA;
    })
    .slice(0, MAX_COMMENT_POSTS_DEEP);

  if (postsNeedingComments.length === 0) {
    console.log(`[DataAcq] DEEP_PASS_ENRICH: ${competitor.name} — all posts already have comments or no eligible posts.`);
    return { commentsGenerated: existingComments, status: "NO_ELIGIBLE_POSTS" };
  }

  const batchId = `deeppass_real_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  let realCommentsScraped = 0;
  let actorRunId: string | null = null;
  const commentInserts: any[] = [];

  console.log(`[DataAcq] DEEP_PASS_ENRICH: ${competitor.name} — scraping REAL comments for ${postsNeedingComments.length} posts via Apify comment actor (existing: ${existingComments} comments, ${realComments} real)`);

  try {
    // P-6.12: comments come EXCLUSIVELY from the Apify comment actor (one
    // batched run per competitor). The old profile re-scrape for embedded
    // comments is gone — the profile actor returns no comment threads, and
    // the Bright Data per-post comment ladder no longer exists.
    // NOTE: enrichCompetitorWithComments runs OUTSIDE the watchdog'd
    // _executeFetch path (called by enrich-only flows that have no
    // AbortSignal), so checkAborted is intentionally not invoked here.
    const commentsNeeded = Math.max(MIN_COMMENTS_THRESHOLD - existingComments, 50);
    const scrapeResult = await scrapeCommentsForPosts(
      postsNeedingComments.map(p => ({
        postId: p.postId,
        shortcode: p.shortcode || "",
        commentCount: p.comments ?? null,
      })),
      { maxTotalComments: commentsNeeded, maxPerPost: MAX_COMMENTS_PER_POST_DEEP },
    );
    actorRunId = scrapeResult.meta.runId;

    // Unified acquisition filter (P-6.12 Phase 7): dedup/spam/owner
    // classification with full accounting — rejects are never persisted,
    // every rejection is counted by reason.
    const { filterComments, formatFilterStats } = await import("../acquisition/comment-filter");

    const existingCIds = new Set<string>();
    const existingCRows = await db.select({ commentId: ciCompetitorComments.commentId })
      .from(ciCompetitorComments)
      .where(and(eq(ciCompetitorComments.competitorId, competitorId), eq(ciCompetitorComments.accountId, accountId)));
    for (const r of existingCRows) {
      if (r.commentId) existingCIds.add(r.commentId);
    }

    const ownerHandle = extractHandleFromUrl(competitor.profileLink ?? "");
    const allScraped = scrapeResult.results.flatMap(r => r.comments);
    const { accepted, stats } = filterComments(
      allScraped.map(c => ({
        commentId: c.commentId,
        username: c.username,
        text: c.text,
        postId: c.postId,
        timestamp: c.timestamp,
        likes: c.likes,
        repliesCount: c.repliesCount ?? null,
      })),
      { ownerHandles: ownerHandle ? [ownerHandle] : [], seenCommentIds: existingCIds },
    );
    console.log(`[DataAcq] COMMENT_FILTER: ${competitor.name} — ${formatFilterStats(stats)}`);

    for (const { comment, decision } of accepted) {
      commentInserts.push({
        competitorId,
        accountId,
        postId: comment.postId,
        commentId: comment.commentId,
        username: comment.username,
        commentText: comment.text,
        sentiment: computeBasicSentiment(comment.text),
        timestamp: comment.timestamp ? new Date(comment.timestamp) : null,
        batchId,
        isSynthetic: false,
        source: "real_scrape",
        authorType: decision.authorType,
        likesCount: comment.likes ?? null,
        repliesCount: comment.repliesCount ?? null,
        actorRunId,
        filterStatus: decision.status,
        filterReason: decision.reason,
      });
      realCommentsScraped++;
    }

    console.log(`[DataAcq] DEEP_PASS_ENRICH: ${competitor.name} — ${realCommentsScraped} real comments accepted from actor run ${actorRunId ?? "n/a"} (≈$${scrapeResult.meta.estimatedCostUsd})`);

    const totalAfterReal = existingComments + realCommentsScraped;
    if (totalAfterReal < MIN_COMMENTS_THRESHOLD) {
      console.log(`[DataAcq] DEEP_PASS_ENRICH: ${competitor.name} — real comments below optimization target (${totalAfterReal}/${MIN_COMMENTS_THRESHOLD}). Comment text is optional — pipeline continues without blocking. NO synthetic fallback (retired P-6.12).`);
    }
  } catch (err: any) {
    console.warn(`[DataAcq] DEEP_PASS_ENRICH: Comment scraping failed for ${competitor.name}: ${err.message}. Comment text is optional enrichment — returning success with 0 comments.`);
  }

  if (commentInserts.length > 0) {
    await db.transaction(async (tx) => {
      for (const commentRow of commentInserts) {
        // Partial unique index (competitor_id, comment_id) makes re-runs idempotent.
        await tx.insert(ciCompetitorComments).values(commentRow).onConflictDoNothing();
      }
    });
  }

  // Repurposed stamp (P-6.12): lastSyntheticEnrichmentAt now records the last
  // PAID comment-actor enrichment attempt, so the existing cooldown gate paces
  // actor spend. syntheticEnrichmentCount / churn tracking are NOT touched —
  // nothing synthetic is generated anymore.
  await db.update(ciCompetitors)
    .set({ lastSyntheticEnrichmentAt: new Date(), updatedAt: new Date() })
    .where(eq(ciCompetitors.id, competitorId));

  const totalComments = existingComments + realCommentsScraped;
  const status = "ENRICHED";

  const postDistribution: Record<string, number> = {};
  for (const ci of commentInserts) {
    postDistribution[ci.postId] = (postDistribution[ci.postId] || 0) + 1;
  }
  const postsWithNewComments = Object.keys(postDistribution).length;
  const distributionSummary = Object.entries(postDistribution).map(([pid, n]) => `${pid.slice(0, 8)}:R${n}`).join(", ");
  console.log(`[DataAcq] COMMENT_DISTRIBUTION: ${competitor.name} — ${postsWithNewComments} posts with new comments | ${distributionSummary}`);

  console.log(`[DataAcq] DEEP_PASS_ENRICH: ${competitor.name} — real=${realCommentsScraped}, existing=${existingComments}, total=${totalComments} | status=${status}`);

  return { commentsGenerated: totalComments, status };
}

export async function getCompetitorDataCoverage(competitorId: string, accountId: string) {
  const [competitor] = await db.select().from(ciCompetitors)
    .where(and(eq(ciCompetitors.id, competitorId), eq(ciCompetitors.accountId, accountId)));

  const postsResult = await db.select({ count: sql<number>`count(*)` }).from(ciCompetitorPosts)
    .where(and(eq(ciCompetitorPosts.competitorId, competitorId), eq(ciCompetitorPosts.accountId, accountId)));

  const totalCommentsResult = await db.select({ count: sql<number>`count(*)` }).from(ciCompetitorComments)
    .where(and(eq(ciCompetitorComments.competitorId, competitorId), eq(ciCompetitorComments.accountId, accountId)));

  const realCommentsResult = await db.select({ count: sql<number>`count(*)` }).from(ciCompetitorComments)
    .where(and(
      eq(ciCompetitorComments.competitorId, competitorId),
      eq(ciCompetitorComments.accountId, accountId),
      eq(ciCompetitorComments.isSynthetic, false),
    ));

  const latestMetrics = await db.select().from(ciCompetitorMetricsSnapshot)
    .where(and(eq(ciCompetitorMetricsSnapshot.competitorId, competitorId), eq(ciCompetitorMetricsSnapshot.accountId, accountId)))
    .orderBy(desc(ciCompetitorMetricsSnapshot.createdAt))
    .limit(1);

  const postsCount = Number(postsResult[0]?.count || 0);
  const commentsCount = Number(totalCommentsResult[0]?.count || 0);
  const realCommentsCount = Number(realCommentsResult[0]?.count || 0);
  const syntheticCommentsCount = commentsCount - realCommentsCount;
  const metrics = latestMetrics[0] || null;

  let dataFreshnessDays = competitor?.dataFreshnessDays ?? 999;
  if (dataFreshnessDays === 999 || dataFreshnessDays === null) {
    const newestPost = await db.select({ ts: ciCompetitorPosts.timestamp })
      .from(ciCompetitorPosts)
      .where(and(eq(ciCompetitorPosts.competitorId, competitorId), eq(ciCompetitorPosts.accountId, accountId)))
      .orderBy(desc(ciCompetitorPosts.timestamp))
      .limit(1);

    if (newestPost.length > 0 && newestPost[0].ts) {
      dataFreshnessDays = Math.max(0, Math.round((Date.now() - new Date(newestPost[0].ts).getTime()) / (1000 * 60 * 60 * 24)));
    } else if (metrics?.lastFetchAt) {
      dataFreshnessDays = Math.round((Date.now() - new Date(metrics.lastFetchAt).getTime()) / (1000 * 60 * 60 * 24));
    }
  }

  return {
    analysisLevel: competitor?.analysisLevel || "FAST_PASS",
    enrichmentStatus: competitor?.enrichmentStatus || "PENDING",
    fetchMethod: competitor?.fetchMethod || metrics?.fetchMethod || null,
    postsCollected: postsCount,
    commentsCollected: commentsCount,
    realCommentsCount,
    syntheticCommentsCount,
    ctaCoverage: metrics?.ctaCoverage || 0,
    ctaTypes: metrics?.ctaTypes || "",
    followers: metrics?.followers || null,
    engagementRate: metrics?.engagementRate || null,
    postingFrequency: metrics?.postingFrequency || null,
    contentMix: metrics?.contentMix || null,
    dataFreshnessDays,
    lastFetchAt: metrics?.lastFetchAt?.toISOString() || null,
    fetchStatus: metrics?.fetchStatus || "PENDING",
    lastCheckedAt: competitor?.lastCheckedAt?.toISOString() || null,
  };
}

export async function getStoredPostsForMIv3(competitorId: string, accountId: string) {
  const rows = await db.select({
    post: ciCompetitorPosts,
    classification: competitorPostClassifications,
  })
  .from(ciCompetitorPosts)
  .leftJoin(
    competitorPostClassifications,
    and(
      eq(ciCompetitorPosts.postId, competitorPostClassifications.postId),
      eq(competitorPostClassifications.classifierVersion, "competitor-post-v2")
    )
  )
  .where(and(eq(ciCompetitorPosts.competitorId, competitorId), eq(ciCompetitorPosts.accountId, accountId)))
  .orderBy(desc(ciCompetitorPosts.createdAt))
  .limit(40);

  return rows.map(r => {
    const p = r.post;
    const c = r.classification;
    return {
      id: p.postId,
      caption: p.caption || "",
      likes: p.likes || 0,
      comments: p.comments || 0,
      views: p.views || undefined,
      mediaType: p.mediaType || "IMAGE",
      hashtags: p.hashtags ? (() => { try { return JSON.parse(p.hashtags!); } catch { return p.hashtags!.split(/[\s,]+/).filter(Boolean); } })() : [],
      timestamp: p.timestamp?.toISOString() || new Date().toISOString(),
      hasCTA: p.hasCTA || false,
      hasOffer: p.hasOffer || false,
      hookArchetype: c?.hookArchetype || "UNKNOWN",
      narrative: c?.narrative || "UNKNOWN",
      ctaType: c?.ctaType || "UNKNOWN",
      offerType: c?.offerType || "UNKNOWN",
      emotionalTrigger: c?.emotionalTrigger || "UNKNOWN",
      awarenessStage: c?.awarenessStage || "UNKNOWN",
      positioningStyle: c?.positioningStyle || "UNKNOWN",
      contentFormatIntent: c?.contentFormatIntent || "UNKNOWN",
      primaryGoal: c?.primaryGoal || "UNKNOWN",
      primaryHook: c?.primaryHook || null,
      primaryAngle: c?.primaryAngle || null,
    };
  });
}

export async function getStoredCommentsForMIv3(competitorId: string, accountId: string) {
  const comments = await db.select().from(ciCompetitorComments)
    .where(and(eq(ciCompetitorComments.competitorId, competitorId), eq(ciCompetitorComments.accountId, accountId)))
    .orderBy(desc(ciCompetitorComments.createdAt))
    .limit(150);

  return comments.map(c => ({
    id: c.id,
    text: c.commentText || "",
    sentiment: c.sentiment || undefined,
    timestamp: c.timestamp?.toISOString() || new Date().toISOString(),
    isSynthetic: c.isSynthetic ?? false,
    source: c.source ?? "scraped",
  }));
}

export async function getStoredTikTokPostsForMIv3(competitorId: string, accountId: string) {
  const posts = await db.select().from(ciCompetitorPosts)
    .where(and(
      eq(ciCompetitorPosts.competitorId, competitorId),
      eq(ciCompetitorPosts.accountId, accountId),
      eq(ciCompetitorPosts.platform, "tiktok"),
    ))
    .orderBy(desc(ciCompetitorPosts.createdAt))
    .limit(50);

  return posts.map(p => ({
    id: p.id,
    postId: p.postId,
    caption: p.caption || "",
    hookText: p.hookText || null,
    hookSource: (p as any).hookSource || null,
    transcript: (p as any).transcript || null,
    likes: p.likes || 0,
    comments: p.comments || 0,
    views: p.views || 0,
    shares: 0,
    hashtags: p.hashtags || "",
    timestamp: p.timestamp?.toISOString() || new Date().toISOString(),
  }));
}

export async function getStoredTikTokCommentsForMIv3(competitorId: string, accountId: string) {
  const comments = await db.select().from(ciCompetitorComments)
    .where(and(
      eq(ciCompetitorComments.competitorId, competitorId),
      eq(ciCompetitorComments.accountId, accountId),
      sql`${ciCompetitorComments.source} IN ('tiktok_scraped', 'tiktok_apify')`,
    ))
    .orderBy(desc(ciCompetitorComments.createdAt))
    .limit(200);

  return comments.map(c => ({
    postId: c.postId,
    commentId: c.commentId || c.id,
    username: c.username || "anonymous",
    text: c.commentText || "",
    sentiment: c.sentiment ?? null,
  }));
}

/**
 * Aug 2026 — provenance-rich comment rows for the source-agnostic
 * CUSTOMER_ORIGIN evidence path (evidence-origin.ts). Returns BOTH
 * Instagram and TikTok comment rows with the acquisition-time authorType
 * so the customer-evidence validator can fail closed on owner/unknown
 * authors. Synthetic rows are excluded — never customer evidence.
 */
export async function getStoredCommentsForCustomerEvidence(competitorId: string, accountId: string) {
  const comments = await db.select().from(ciCompetitorComments)
    .where(and(
      eq(ciCompetitorComments.competitorId, competitorId),
      eq(ciCompetitorComments.accountId, accountId),
      eq(ciCompetitorComments.isSynthetic, false),
    ))
    .orderBy(desc(ciCompetitorComments.createdAt))
    .limit(300);

  return comments.map(c => ({
    commentId: c.commentId || c.id,
    username: c.username || null,
    text: c.commentText || "",
    authorType: c.authorType ?? null,
    platform: (c.source || "").startsWith("tiktok") ? "tiktok" as const : "instagram" as const,
    competitorId: c.competitorId,
  }));
}

export async function getStoredReviewsForMIv3(competitorId: string, accountId: string) {
  const reviews = await db.select().from(ciCompetitorReviews)
    .where(and(
      eq(ciCompetitorReviews.competitorId, competitorId),
      eq(ciCompetitorReviews.accountId, accountId),
    ))
    .orderBy(desc(ciCompetitorReviews.createdAt))
    .limit(100);

  return reviews.map(r => ({
    id: r.id,
    reviewId: r.reviewId || r.id,
    text: r.reviewText || "",
    rating: r.rating ?? 0,
    platform: r.platform || "google",
    reviewDate: r.reviewDate?.toISOString() || null,
    isSynthetic: r.isSynthetic ?? false,
  }));
}


export const SYNTHETIC_RETENTION_DAYS = 30;
export const SYNTHETIC_ENRICHMENT_COOLDOWN_DAYS = 5;
export const SYNTHETIC_CHURN_WINDOW_DAYS = 14;
export const SYNTHETIC_CHURN_THRESHOLD = 2;

export interface SyntheticLifecycleDiagnostics {
  syntheticGeneratedCount: number;
  syntheticExpiredCount: number;
  syntheticRegeneratedCount: number;
  competitorsReEnriched: number;
  highChurnCompetitors: string[];
  cooldownBlockedCount: number;
  realDataSufficientCount: number;
  averageDaysBetweenSyntheticRegeneration: number | null;
}

function isSyntheticCooldownActive(lastEnrichmentAt: Date | null): boolean {
  if (!lastEnrichmentAt) return false;
  const daysSinceEnrichment = (Date.now() - new Date(lastEnrichmentAt).getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceEnrichment < SYNTHETIC_ENRICHMENT_COOLDOWN_DAYS;
}

function detectHighSyntheticChurn(enrichmentCount: number, lastSyntheticEnrichmentAt: Date | null, firstEnrichmentApproxAt: Date | null): boolean {
  if (enrichmentCount <= SYNTHETIC_CHURN_THRESHOLD) return false;
  if (!lastSyntheticEnrichmentAt) return false;
  const referenceDate = firstEnrichmentApproxAt || lastSyntheticEnrichmentAt;
  const daysSinceReference = (Date.now() - new Date(referenceDate).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceReference <= SYNTHETIC_CHURN_WINDOW_DAYS) {
    return true;
  }
  const avgDaysBetween = daysSinceReference / Math.max(enrichmentCount - 1, 1);
  return avgDaysBetween < (SYNTHETIC_CHURN_WINDOW_DAYS / SYNTHETIC_CHURN_THRESHOLD);
}

export async function cleanupExpiredSyntheticComments(): Promise<{ deleted: number; competitorsAffected: string[]; reEnriched: number; diagnostics: SyntheticLifecycleDiagnostics }> {
  const cutoffDate = new Date(Date.now() - SYNTHETIC_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const diagnostics: SyntheticLifecycleDiagnostics = {
    syntheticGeneratedCount: 0,
    syntheticExpiredCount: 0,
    syntheticRegeneratedCount: 0,
    competitorsReEnriched: 0,
    highChurnCompetitors: [],
    cooldownBlockedCount: 0,
    realDataSufficientCount: 0,
    averageDaysBetweenSyntheticRegeneration: null,
  };

  const totalSyntheticResult = await db.select({ count: sql<number>`count(*)` }).from(ciCompetitorComments)
    .where(eq(ciCompetitorComments.isSynthetic, true));
  diagnostics.syntheticGeneratedCount = Number(totalSyntheticResult[0]?.count || 0);

  const expiredRows = await db.select({
    competitorId: ciCompetitorComments.competitorId,
    accountId: ciCompetitorComments.accountId,
  }).from(ciCompetitorComments)
    .where(and(
      eq(ciCompetitorComments.isSynthetic, true),
      sql`${ciCompetitorComments.createdAt} < ${cutoffDate}`,
    ));

  if (expiredRows.length === 0) {
    const churnFlaggedResult = await db.select({ id: ciCompetitors.id }).from(ciCompetitors)
      .where(eq(ciCompetitors.syntheticChurnFlag, "HIGH_SYNTHETIC_CHURN"));
    diagnostics.highChurnCompetitors = churnFlaggedResult.map(r => r.id);

    return { deleted: 0, competitorsAffected: [], reEnriched: 0, diagnostics };
  }

  const affectedCompetitors = new Map<string, string>();
  for (const row of expiredRows) {
    affectedCompetitors.set(row.competitorId, row.accountId);
  }

  const deleteResult = await db.execute(sql`
    DELETE FROM ci_competitor_comments
    WHERE is_synthetic = true AND created_at < ${cutoffDate}
  `);

  const deleted = Number((deleteResult as any).rowCount || expiredRows.length);
  const competitorsAffected = Array.from(affectedCompetitors.keys());
  diagnostics.syntheticExpiredCount = deleted;

  console.log(`[SyntheticCleanup] Deleted ${deleted} expired synthetic comments from ${competitorsAffected.length} competitors (retention=${SYNTHETIC_RETENTION_DAYS}d)`);

  let reEnriched = 0;
  for (const [competitorId, accountId] of affectedCompetitors.entries()) {
    const [comp] = await db.select().from(ciCompetitors)
      .where(eq(ciCompetitors.id, competitorId));

    if (!comp || !comp.isActive) continue;

    const realCount = await db.select({ count: sql<number>`count(*)` }).from(ciCompetitorComments)
      .where(and(eq(ciCompetitorComments.competitorId, competitorId), eq(ciCompetitorComments.accountId, accountId), eq(ciCompetitorComments.isSynthetic, false)));
    const realComments = Number(realCount[0]?.count || 0);

    if (realComments >= MIN_COMMENTS_THRESHOLD) {
      console.log(`[SyntheticCleanup] ${competitorId}: real comments (${realComments}) meet optimization target — no re-enrichment needed`);
      diagnostics.realDataSufficientCount++;
      continue;
    }

    if (isSyntheticCooldownActive(comp.lastSyntheticEnrichmentAt)) {
      console.log(`[SyntheticCleanup] ${competitorId}: cooldown active — skipping re-enrichment`);
      diagnostics.cooldownBlockedCount++;
      continue;
    }

    const remainingCount = await db.select({ count: sql<number>`count(*)` }).from(ciCompetitorComments)
      .where(and(eq(ciCompetitorComments.competitorId, competitorId), eq(ciCompetitorComments.accountId, accountId)));
    const remaining = Number(remainingCount[0]?.count || 0);

    if (remaining >= MIN_COMMENTS_THRESHOLD) {
      continue;
    }

    const hasPosts = await db.select({ count: sql<number>`count(*)` }).from(ciCompetitorPosts)
      .where(and(eq(ciCompetitorPosts.competitorId, competitorId), eq(ciCompetitorPosts.accountId, accountId)));

    if (Number(hasPosts[0]?.count || 0) > 0) {
      try {
        const result = await enrichCompetitorWithComments(competitorId, accountId);
        if (result.status === "COOLDOWN_ACTIVE") {
          diagnostics.cooldownBlockedCount++;
        } else if (result.status === "REAL_DATA_SUFFICIENT") {
          diagnostics.realDataSufficientCount++;
        } else {
          console.log(`[SyntheticCleanup] Re-enriched ${competitorId}: ${result.commentsGenerated} comments, status=${result.status}`);
          diagnostics.syntheticRegeneratedCount += result.commentsGenerated;
          reEnriched++;
        }
      } catch (err: any) {
        console.error(`[SyntheticCleanup] Re-enrichment failed for ${competitorId}: ${err.message}`);
      }
    } else {
      await db.update(ciCompetitors)
        .set({ analysisLevel: "FAST_PASS", updatedAt: new Date() })
        .where(eq(ciCompetitors.id, competitorId));
      console.log(`[SyntheticCleanup] Demoted ${competitorId} to FAST_PASS (no posts for re-enrichment)`);
    }
  }

  diagnostics.competitorsReEnriched = reEnriched;

  const enrichedCompetitors = await db.select({
    id: ciCompetitors.id,
    syntheticEnrichmentCount: ciCompetitors.syntheticEnrichmentCount,
    lastSyntheticEnrichmentAt: ciCompetitors.lastSyntheticEnrichmentAt,
    createdAt: ciCompetitors.createdAt,
  }).from(ciCompetitors)
    .where(sql`${ciCompetitors.syntheticEnrichmentCount} > 1`);

  if (enrichedCompetitors.length > 0) {
    let totalAvgDays = 0;
    let validCount = 0;
    for (const comp of enrichedCompetitors) {
      if (comp.lastSyntheticEnrichmentAt && comp.createdAt && comp.syntheticEnrichmentCount > 1) {
        const spanDays = (new Date(comp.lastSyntheticEnrichmentAt).getTime() - new Date(comp.createdAt).getTime()) / (1000 * 60 * 60 * 24);
        const avgDays = spanDays / (comp.syntheticEnrichmentCount - 1);
        totalAvgDays += avgDays;
        validCount++;
      }
    }
    diagnostics.averageDaysBetweenSyntheticRegeneration = validCount > 0 ? Math.round((totalAvgDays / validCount) * 10) / 10 : null;
  }

  const churnFlaggedResult = await db.select({ id: ciCompetitors.id }).from(ciCompetitors)
    .where(eq(ciCompetitors.syntheticChurnFlag, "HIGH_SYNTHETIC_CHURN"));
  diagnostics.highChurnCompetitors = churnFlaggedResult.map(r => r.id);

  const orphanCheck = await db.execute(sql`
    SELECT cc.id FROM ci_competitor_comments cc
    LEFT JOIN ci_competitors c ON cc.competitor_id = c.id
    WHERE c.id IS NULL
  `);
  const orphanCount = (orphanCheck.rows || []).length;
  if (orphanCount > 0) {
    await db.execute(sql`
      DELETE FROM ci_competitor_comments
      WHERE competitor_id NOT IN (SELECT id FROM ci_competitors)
    `);
    console.log(`[SyntheticCleanup] Removed ${orphanCount} orphaned comment references`);
  }

  console.log(`[SyntheticCleanup] Diagnostics: expired=${diagnostics.syntheticExpiredCount}, reEnriched=${reEnriched}, cooldownBlocked=${diagnostics.cooldownBlockedCount}, realSufficient=${diagnostics.realDataSufficientCount}, highChurn=${diagnostics.highChurnCompetitors.length}`);

  return { deleted, competitorsAffected, reEnriched, diagnostics };
}

export async function fetchAllCompetitors(accountId: string, campaignId: string): Promise<FetchResult[]> {
  const competitors = await db.select().from(ciCompetitors)
    .where(and(eq(ciCompetitors.accountId, accountId), eq(ciCompetitors.campaignId, campaignId), eq(ciCompetitors.isActive, true)));

  const results: FetchResult[] = [];
  for (const comp of competitors) {
    try {
      const result = await fetchCompetitorData(comp.id, accountId, false);
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

export interface MultiSourceEnrichmentResult {
  competitorId: string;
  sourcesAttempted: number;
  sourcesSucceeded: number;
  sourcesFailed: number;
  postsCollected: number;
  commentsCollected: number;
  reviewsCollected: number;
  results: SourceFetchExecutionResult[];
}

/**
 * Executes platform-specific acquisition for non-Instagram verified competitor sources
 * (TikTok, YouTube, Reviews, etc.) from canonical competitor_sources table.
 * 
 * Guarantees:
 * - Authority model: reads canonical competitor_sources
 * - Preserves source verification status (no mutation of isVerified / lastVerifiedAt)
 * - Updates lastFetchedAt on success
 * - Append-safe / on-conflict idempotent persistence
 */
export async function enrichCompetitorWithMultiSources(
  competitorId: string,
  accountId: string,
  campaignId: string,
  options?: {
    platforms?: string[];
    forceRefresh?: boolean;
    maxSources?: number;
  }
): Promise<MultiSourceEnrichmentResult> {
  const { platforms, forceRefresh = false, maxSources = 10 } = options || {};

  // 1. Load active verified sources for this competitor
  const activeSources = await db
    .select()
    .from(competitorSources)
    .where(and(
      eq(competitorSources.competitorId, competitorId),
      eq(competitorSources.accountId, accountId),
      eq(competitorSources.campaignId, campaignId),
      eq(competitorSources.status, "ACTIVE")
    ));

  // Filter target platforms (default: TIKTOK, YOUTUBE, REVIEWS)
  const targetPlatforms = platforms 
    ? platforms.map(p => p.toUpperCase())
    : ["TIKTOK", "YOUTUBE", "REVIEWS"];

  const eligibleSources = activeSources
    .filter(s => targetPlatforms.includes(s.platform.toUpperCase()))
    .slice(0, maxSources);

  const results: SourceFetchExecutionResult[] = [];
  let totalPosts = 0;
  let totalComments = 0;
  let totalReviews = 0;
  let succeeded = 0;
  let failed = 0;

  for (const src of eligibleSources) {
    // Check freshness cache (72h cooldown) unless forceRefresh is set
    if (!forceRefresh && src.lastFetchedAt) {
      const elapsed = Date.now() - new Date(src.lastFetchedAt).getTime();
      if (elapsed < 72 * 60 * 60 * 1000) {
        results.push({
          sourceId: src.id,
          platform: src.platform,
          status: "SKIPPED_FRESH_CACHE",
          itemsCount: 0,
          commentsCount: 0,
          durationMs: 0,
        });
        continue;
      }
    }

    try {
      const res = await executeSourceFetch({
        sourceId: src.id,
        competitorId,
        accountId,
        campaignId,
        platform: src.platform,
        canonicalUrl: src.canonicalUrl,
      });
      results.push(res);

      if (res.status === "SUCCESS" || res.status === "SUCCESS_ZERO_CONTENT" || res.status === "FETCH_SUCCESS") {
        succeeded++;
        if (src.platform.toUpperCase() === "REVIEWS") {
          totalReviews += res.commentsCount || res.itemsCount;
        } else {
          totalPosts += res.itemsCount;
          totalComments += res.commentsCount;
        }
      } else {
        failed++;
      }
    } catch (fetchErr: any) {
      failed++;
      results.push({
        sourceId: src.id,
        platform: src.platform,
        status: "PROVIDER_FAILED",
        itemsCount: 0,
        commentsCount: 0,
        durationMs: 0,
        error: fetchErr.message,
      });
    }
  }

  return {
    competitorId,
    sourcesAttempted: eligibleSources.length,
    sourcesSucceeded: succeeded,
    sourcesFailed: failed,
    postsCollected: totalPosts,
    commentsCollected: totalComments,
    reviewsCollected: totalReviews,
    results,
  };
}

/**
 * Orchestrates campaign-wide multi-source acquisition across all active canonical competitors.
 */
export async function executeMultiSourceAcquisitionForCampaign(
  accountId: string,
  campaignId: string,
  options?: {
    platforms?: string[];
    forceRefresh?: boolean;
    concurrency?: number;
  }
): Promise<{
  totalCompetitors: number;
  competitorsProcessed: number;
  totalSourcesAttempted: number;
  totalPostsCollected: number;
  totalCommentsCollected: number;
  totalReviewsCollected: number;
  competitorResults: MultiSourceEnrichmentResult[];
}> {
  const { platforms, forceRefresh = false } = options || {};

  const competitors = await db
    .select()
    .from(ciCompetitors)
    .where(and(
      eq(ciCompetitors.accountId, accountId),
      eq(ciCompetitors.campaignId, campaignId),
      eq(ciCompetitors.isActive, true)
    ));

  let totalSourcesAttempted = 0;
  let totalPostsCollected = 0;
  let totalCommentsCollected = 0;
  let totalReviewsCollected = 0;
  const competitorResults: MultiSourceEnrichmentResult[] = [];

  for (const comp of competitors) {
    const res = await enrichCompetitorWithMultiSources(comp.id, accountId, campaignId, {
      platforms,
      forceRefresh,
    });
    totalSourcesAttempted += res.sourcesAttempted;
    totalPostsCollected += res.postsCollected;
    totalCommentsCollected += res.commentsCollected;
    totalReviewsCollected += res.reviewsCollected;
    competitorResults.push(res);
  }

  return {
    totalCompetitors: competitors.length,
    competitorsProcessed: competitorResults.length,
    totalSourcesAttempted,
    totalPostsCollected,
    totalCommentsCollected,
    totalReviewsCollected,
    competitorResults,
  };
}

