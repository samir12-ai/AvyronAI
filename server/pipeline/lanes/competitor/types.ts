/**
 * Phase 7.3 — Competitor Lane interpretation primitives (shared types).
 *
 * Locked by Samir 2026-04-21:
 *   - Instagram = strategy source (what competitors are doing).
 *   - TikTok    = validation layer (what is actually working).
 *   - This module set DETECTS and STRUCTURES; it never scores, never picks
 *     winners, never recommends. Boss assembles.
 *
 * Inputs are normalized per-post records emitted by the existing competitor
 * lane runner (`server/pipeline/lanes/competitor.ts`). The new interpretation
 * layer never touches DB; it operates on already-validated post records.
 */

export type CompetitorChannel = "instagram" | "tiktok";

export interface CompetitorPost {
  /** Stable competitor handle / id. */
  competitorId: string;
  channel: CompetitorChannel;
  /** Theme tokens already extracted upstream. Each post may map to N themes. */
  themeTokens: string[];
  /** ISO timestamp; consumers may use it for freshness, this layer does not. */
  observedAt: string;
}
