/**
 * Phase 3 — Envelope → lane payload translation.
 *
 * Hygiene only. Picks fields, normalizes shapes, attaches `acquisition_id`.
 * Does NOT score, rank, or interpret. Same constraint as Phase 1.6 diff hygiene.
 *
 * The lane payload schema today is `{ patterns, objections, frequency, ... }`
 * (designed for the synthetic harness). Real adapter envelopes are richer.
 * Translation is intentionally lossy — see audit §3.5 / R-3.2.
 */
import type { CollectorEnvelope } from "../collector/envelope";

export interface FrequencyWindowMeta {
  windowDays: number;
  postsInWindow: number;
  totalSampled: number;
  oldestPostAt: string | null;
  newestPostAt: string | null;
  isSampleCapped: boolean;
  hasPublicationTimestamps: boolean;
}

export interface LanePayload extends Record<string, unknown> {
  acquisition_id: string;
  patterns?: string[];
  objections?: string[];
  pricing?: string[];
  pains?: string[];
  desires?: string[];
  frequency?: number;
  frequency_meta?: FrequencyWindowMeta;
  post_ids?: string[];
  sample_size?: number;
  is_empty_or_failed?: boolean;
  metrics?: Record<string, number>;
  /** Diagnostic — which adapter-payload fields contributed to this lane payload. */
  _translation_sources: string[];
}

function strArr(v: unknown, max = 50): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x === "string") {
      const t = x.trim();
      if (t) out.push(t);
    }
    if (out.length >= max) break;
  }
  return out;
}

function normalizeHashtagList(v: unknown, max = 50): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of v) {
    if (typeof x === "string") {
      const cleaned = x.replace(/^#+/, "").trim().toLowerCase();
      if (cleaned && !seen.has(cleaned)) {
        seen.add(cleaned);
        out.push(cleaned);
      }
    }
    if (out.length >= max) break;
  }
  return out;
}

function extractPostIds(posts: unknown): string[] {
  if (!Array.isArray(posts)) return [];
  const ids: string[] = [];
  for (const p of posts) {
    if (p && typeof p === "object") {
      const obj = p as Record<string, unknown>;
      const id = obj.postId ?? obj.id ?? obj.videoId;
      if (typeof id === "string" && id.trim()) ids.push(id.trim());
    }
  }
  return ids;
}

/**
 * Computes posting frequency over a comparable 30-day publication window
 * rather than treating cumulative stored post count or scraper cap as frequency.
 * Falls back to array length only when synthetic test fixtures omit timestamps.
 */
export function computePublicationWindowFrequency(
  posts: unknown,
  collectedAtIso?: string,
  windowDays = 30,
): { frequency: number; meta: FrequencyWindowMeta } | null {
  if (!Array.isArray(posts) || posts.length === 0) return null;
  const timestamps: number[] = [];
  for (const p of posts) {
    if (p && typeof p === "object") {
      const obj = p as Record<string, unknown>;
      const rawTs = obj.timestamp ?? obj.publishedAt ?? obj.createdAt ?? obj.date;
      if (rawTs instanceof Date && !Number.isNaN(rawTs.getTime())) {
        timestamps.push(rawTs.getTime());
      } else if (typeof rawTs === "string" && rawTs.trim()) {
        const ms = Date.parse(rawTs);
        if (!Number.isNaN(ms)) timestamps.push(ms);
      } else if (typeof rawTs === "number" && Number.isFinite(rawTs)) {
        timestamps.push(rawTs > 1e12 ? rawTs : rawTs * 1000);
      }
    }
  }

  if (timestamps.length === 0) {
    return {
      frequency: posts.length,
      meta: {
        windowDays,
        postsInWindow: posts.length,
        totalSampled: posts.length,
        oldestPostAt: null,
        newestPostAt: null,
        isSampleCapped: false,
        hasPublicationTimestamps: false,
      },
    };
  }

  const parsedAnchor = collectedAtIso ? Date.parse(collectedAtIso) : NaN;
  const anchorMs = !Number.isNaN(parsedAnchor) ? parsedAnchor : Date.now();
  const windowStartMs = anchorMs - windowDays * 24 * 60 * 60 * 1000;
  const postsInWindow = timestamps.filter(
    (ms) => ms >= windowStartMs && ms <= anchorMs + 24 * 60 * 60 * 1000,
  ).length;
  const oldestMs = Math.min(...timestamps);
  const newestMs = Math.max(...timestamps);
  const isSampleCapped = posts.length >= 12 && oldestMs > windowStartMs;

  return {
    frequency: postsInWindow,
    meta: {
      windowDays,
      postsInWindow,
      totalSampled: posts.length,
      oldestPostAt: new Date(oldestMs).toISOString(),
      newestPostAt: new Date(newestMs).toISOString(),
      isSampleCapped,
      hasPublicationTimestamps: true,
    },
  };
}

function pickCaptions(posts: unknown, captionField: string, max = 25): string[] {
  if (!Array.isArray(posts)) return [];
  const out: string[] = [];
  for (const p of posts) {
    if (p && typeof p === "object") {
      const v = (p as Record<string, unknown>)[captionField];
      if (typeof v === "string" && v.trim()) {
        out.push(v.trim().slice(0, 280)); // truncate to keep payload bounded
      }
    }
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Translate a Collector envelope into a lane payload the existing
 * runUserLane / runCompetitorLane functions can consume.
 *
 * Returns null when this envelope's adapter is intentionally not translated
 * in Phase 3 (e.g. competitor-reviews per F-2.C). The caller should treat
 * a null return as "skip this entity for the lane payload but keep the
 * acquisition recorded".
 */
export function translateEnvelopeToLanePayload(env: CollectorEnvelope): LanePayload | null {
  const sources: string[] = [];
  const out: LanePayload = {
    acquisition_id: env.acquisition_id,
    _translation_sources: sources,
  };

  switch (env.entity_type) {
    case "user_channel": {
      const headlines = strArr(env.payload.headlines);
      const ctas = strArr(env.payload.cta_labels);
      const pains = strArr(env.payload.pains);
      const desires = strArr(env.payload.desires);
      const metrics = (env.payload.metrics as Record<string, unknown>) ?? {};
      const cleanMetrics: Record<string, number> = {};
      for (const [k, v] of Object.entries(metrics)) {
        if (typeof v === "number" && Number.isFinite(v)) cleanMetrics[k] = v;
      }
      if (headlines.length) { out.patterns = headlines; sources.push("payload.headlines"); }
      if (ctas.length) {
        out.patterns = [...(out.patterns ?? []), ...ctas];
        sources.push("payload.cta_labels");
      }
      if (pains.length) { out.pains = pains; sources.push("payload.pains"); }
      if (desires.length) { out.desires = desires; sources.push("payload.desires"); }
      if (Object.keys(cleanMetrics).length) {
        out.metrics = cleanMetrics;
        sources.push("payload.metrics");
      }
      const userWarnList = Array.isArray(env.provenance?.warnings) ? env.provenance.warnings : [];
      if (
        userWarnList.some((w) => w.includes("failed") || w.includes("error") || w.includes("inconclusive") || w.includes("empty")) ||
        (!headlines.length && !ctas.length && !pains.length && !desires.length && !Object.keys(cleanMetrics).length)
      ) {
        out.is_empty_or_failed = true;
      }
      return out;
    }

    case "competitor_website": {
      const headlines = strArr(env.payload.headlines);
      const ctas = strArr(env.payload.cta_labels);
      const offers = strArr(env.payload.offer_phrases);
      const pricing = strArr(env.payload.pricing_anchors || env.payload.pricing);
      if (headlines.length) { out.patterns = headlines; sources.push("payload.headlines"); }
      if (ctas.length) {
        out.patterns = [...(out.patterns ?? []), ...ctas];
        sources.push("payload.cta_labels");
      }
      if (offers.length) {
        // Offer phrases are observed-claims, not literal "objections" — see audit §3.5.
        out.objections = offers;
        sources.push("payload.offer_phrases");
      }
      if (pricing.length) {
        out.pricing = pricing;
        sources.push("payload.pricing_anchors");
      }
      const warnList = Array.isArray(env.provenance?.warnings) ? env.provenance.warnings : [];
      if (
        warnList.some((w) => w.includes("failed") || w.includes("error") || w.includes("no_website_signals")) ||
        (!headlines.length && !ctas.length && !offers.length && !pricing.length)
      ) {
        out.is_empty_or_failed = true;
      }
      return out;
    }

    case "competitor_instagram": {
      const postsArr = Array.isArray(env.payload.posts) ? env.payload.posts : [];
      const captions = pickCaptions(postsArr, "caption");
      const tags = normalizeHashtagList(env.payload.hashtags);
      if (captions.length) { out.patterns = captions; sources.push("payload.posts[].caption"); }
      if (tags.length) {
        out.patterns = [...(out.patterns ?? []), ...tags];
        sources.push("payload.hashtags");
      }
      const freqInfo = computePublicationWindowFrequency(postsArr, env.collected_at);
      if (freqInfo) {
        out.frequency = freqInfo.frequency;
        out.frequency_meta = freqInfo.meta;
        out.post_ids = extractPostIds(postsArr);
        out.sample_size = postsArr.length;
        sources.push("payload.posts.window_frequency");
      } else {
        out.is_empty_or_failed = true;
      }
      return out;
    }

    case "competitor_tiktok": {
      const postsArr = Array.isArray(env.payload.posts) ? env.payload.posts : [];
      const texts = pickCaptions(postsArr, "text");
      const captions = pickCaptions(postsArr, "caption");
      const tags = normalizeHashtagList(env.payload.hashtags);
      const all = Array.from(new Set([...texts, ...captions, ...tags]));
      if (all.length) { out.patterns = all; sources.push("payload.posts[].text|caption"); }
      const freqInfo = computePublicationWindowFrequency(postsArr, env.collected_at);
      if (freqInfo) {
        out.frequency = freqInfo.frequency;
        out.frequency_meta = freqInfo.meta;
        out.post_ids = extractPostIds(postsArr);
        out.sample_size = postsArr.length;
        sources.push("payload.posts.window_frequency");
      } else {
        out.is_empty_or_failed = true;
      }
      return out;
    }

    case "competitor_youtube": {
      const postsArr = Array.isArray(env.payload.posts) ? env.payload.posts : [];
      const captions = pickCaptions(postsArr, "caption");
      const titles = pickCaptions(postsArr, "title");
      const tags = normalizeHashtagList(env.payload.hashtags);
      const all = Array.from(new Set([...titles, ...captions, ...tags]));
      if (all.length) { out.patterns = all; sources.push("payload.posts[].title|caption"); }
      const freqInfo = computePublicationWindowFrequency(postsArr, env.collected_at);
      if (freqInfo) {
        out.frequency = freqInfo.frequency;
        out.frequency_meta = freqInfo.meta;
        out.post_ids = extractPostIds(postsArr);
        out.sample_size = postsArr.length;
        sources.push("payload.posts.window_frequency");
      } else {
        out.is_empty_or_failed = true;
      }
      return out;
    }

    case "competitor_reviews": {
      const reviews = Array.isArray(env.payload.reviews) ? env.payload.reviews : [];
      if (reviews.length === 0) {
        // When no reviews exist, return null per Phase 3 contract so empty review rows are skipped cleanly.
        return null;
      }
      const reviewTexts = pickCaptions(reviews, "text", 25);
      if (reviewTexts.length) {
        out.patterns = reviewTexts;
        out.sample_size = reviews.length;
        sources.push("payload.reviews[].text");
      }
      return out;
    }

    case "competitor_google_search": {
      const results = Array.isArray(env.payload.search_results) ? env.payload.search_results : [];
      const snippets = results
        .map((r: any) => typeof r === "string" ? r : (r.text || `${r.title || ""}: ${r.snippet || r.description || ""}`).trim())
        .filter(Boolean);
      if (snippets.length) {
        out.patterns = snippets;
        sources.push("payload.search_results");
      } else {
        out.is_empty_or_failed = true;
      }
      return out;
    }

    case "competitor_linkedin": {
      const posts = Array.isArray(env.payload.posts) ? env.payload.posts : [];
      const texts = posts
        .map((p: any) => typeof p === "string" ? p : (p.text || p.content || p.commentary || "").trim())
        .filter(Boolean);
      if (texts.length) {
        out.patterns = texts;
        sources.push("payload.linkedin_posts");
      }
      if (posts.length > 0) {
        out.frequency = posts.length;
        sources.push("payload.posts.length");
      } else {
        out.is_empty_or_failed = true;
      }
      return out;
    }

    case "competitor_x": {
      const tweets = Array.isArray(env.payload.tweets) ? env.payload.tweets : [];
      const texts = tweets
        .map((t: any) => typeof t === "string" ? t : (t.text || t.full_text || "").trim())
        .filter(Boolean);
      if (texts.length) {
        out.patterns = texts;
        sources.push("payload.x_tweets");
      }
      if (tweets.length > 0) {
        out.frequency = tweets.length;
        sources.push("payload.tweets.length");
      } else {
        out.is_empty_or_failed = true;
      }
      return out;
    }
  }
}
