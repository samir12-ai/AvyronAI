import * as crypto from "crypto";
import type { CompetitorInput } from "./types";

export function computeCompetitorHash(competitors: CompetitorInput[]): string {
  const ids = competitors.map(c => c.id).sort();
  return crypto.createHash("sha256").update(ids.join("|")).digest("hex").slice(0, 16);
}

export function parseJsonSafe<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try { return JSON.parse(json); } catch { return fallback; }
}
