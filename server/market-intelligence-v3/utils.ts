import * as crypto from "crypto";
import type { CompetitorInput } from "./types";

export function computeCompetitorHash(competitors: CompetitorInput[]): string {
  const ids = competitors.map(c => c.id).sort();
  return crypto.createHash("sha256").update(ids.join("|")).digest("hex").slice(0, 16);
}

/**
 * Content-aware fingerprint of a competitor set. Unlike `computeCompetitorHash`
 * (ID-only — used for structural equality by delta comparison and sticky
 * sessions), this folds in each competitor's post volume and freshest post
 * timestamp so that newly scraped posts change the hash. Used exclusively by the
 * MI snapshot reuse gate and downstream input-hash propagation so fresh data
 * invalidates stale cached intelligence. Deterministic (sorted parts).
 */
export function computeCompetitorContentHash(competitors: CompetitorInput[]): string {
  const parts = competitors.map(c => {
    const posts = Array.isArray(c.posts) ? c.posts : [];
    let newestMs = 0;
    for (const p of posts) {
      const ts = typeof p.timestamp === "string" ? p.timestamp : "";
      const ms = Date.parse(ts);
      if (!Number.isNaN(ms) && ms > newestMs) newestMs = ms;
    }
    return `${c.id}:${posts.length}:${newestMs}`;
  }).sort();
  return crypto.createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
}

export function parseJsonSafe<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try { return JSON.parse(json); } catch { return fallback; }
}
