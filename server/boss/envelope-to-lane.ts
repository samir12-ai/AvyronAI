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

export interface LanePayload extends Record<string, unknown> {
  acquisition_id: string;
  patterns?: string[];
  objections?: string[];
  pricing?: string[];
  pains?: string[];
  desires?: string[];
  frequency?: number;
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
      return out;
    }

    case "competitor_instagram": {
      const captions = pickCaptions(env.payload.posts, "caption");
      const tags = strArr(env.payload.hashtags);
      if (captions.length) { out.patterns = captions; sources.push("payload.posts[].caption"); }
      if (tags.length) {
        out.patterns = [...(out.patterns ?? []), ...tags];
        sources.push("payload.hashtags");
      }
      const postCount = Array.isArray(env.payload.posts) ? env.payload.posts.length : 0;
      if (postCount > 0) { out.frequency = postCount; sources.push("payload.posts.length"); }
      return out;
    }

    case "competitor_tiktok": {
      const texts = pickCaptions(env.payload.posts, "text");
      const captions = pickCaptions(env.payload.posts, "caption");
      const all = [...texts, ...captions];
      if (all.length) { out.patterns = all; sources.push("payload.posts[].text|caption"); }
      const postCount = Array.isArray(env.payload.posts) ? env.payload.posts.length : 0;
      if (postCount > 0) { out.frequency = postCount; sources.push("payload.posts.length"); }
      return out;
    }

    case "competitor_reviews": {
      // Phase 3: reviews intentionally NOT translated into a lane payload.
      // The acquisition was still recorded — see audit §3.5 / R-3.4.
      return null;
    }

    case "competitor_google_search": {
      const results = Array.isArray(env.payload.search_results) ? env.payload.search_results : [];
      const snippets = results
        .map((r: any) => typeof r === "string" ? r : (r.text || `${r.title || ""}: ${r.snippet || r.description || ""}`).trim())
        .filter(Boolean);
      if (snippets.length) {
        out.patterns = snippets;
        sources.push("payload.search_results");
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
      }
      return out;
    }
  }
}
