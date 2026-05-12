/**
 * Migration 014 — Seal #5 (Task #23): Scraping security & reliability columns.
 *
 * F7.7 — `ci_competitor_reviews.author_hash`: sha256(name).slice(0,12). The
 *        reviewer's plaintext name was previously extracted but never persisted;
 *        this column gives us PII-safe dedup + reviewer-pattern analysis.
 *        Backfill is N/A (no historical raw names exist in production).
 *
 * F7.8 — `ci_competitors.tier`: 'A' | 'B'. Tier-A = priority competitor (24h
 *        cooldown). Tier-B = standard (72h). Default 'B' for safety; operators
 *        promote competitors to tier A explicitly.
 */
import { db } from "../db";
import { sql } from "drizzle-orm";

export async function migrateScrapeSecurity() {
  console.log("[Migration-014] Adding scrape-security columns (F7.7 author_hash, F7.8 tier)...");

  await db.execute(sql`
    ALTER TABLE ci_competitors
      ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'B'
  `);
  await db.execute(sql`
    ALTER TABLE ci_competitors
      ADD CONSTRAINT ci_competitors_tier_check CHECK (tier IN ('A', 'B'))
  `).catch((e: any) => {
    // Idempotent re-run: constraint already present.
    if (!String(e.message || "").includes("already exists")) throw e;
  });
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_ci_competitors_tier ON ci_competitors (tier)`);

  await db.execute(sql`
    ALTER TABLE ci_competitor_reviews
      ADD COLUMN IF NOT EXISTS author_hash VARCHAR(12)
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_ci_competitor_reviews_author_hash ON ci_competitor_reviews (author_hash)`);

  console.log("[Migration-014] Done. ci_competitors.tier (default 'B') + ci_competitor_reviews.author_hash added.");
}
