/**
 * Migration 012 — Launch-Closure Wave 1 (P0-1, P0-2 tenant isolation)
 *
 * Adds `account_id` columns to tables that previously had no per-tenant
 * ownership. Without this column, any authenticated user could read/write
 * any other tenant's video projects, photographer profiles, portfolio posts,
 * and reservations. Master audit P0-1 + P0-2.
 *
 * Strategy: nullable column for safe online deploy → backfill defers to
 * application code (rows authored before migration are treated as
 * legacy/orphan and visible only to nobody, since reads filter by accountId).
 * Doctrine: NO synthetic backfill — pre-migration rows have no known owner.
 *
 * Indexes added on (account_id, ...) to keep tenant-scoped reads cheap.
 */
import { db } from "../db";
import { sql } from "drizzle-orm";

export async function migrateTenantIsolationAccountId() {
  console.log("[Migration-012] Adding account_id to video_projects, photographer_profiles, portfolio_posts, reservations...");

  // video_projects
  await db.execute(sql`ALTER TABLE video_projects ADD COLUMN IF NOT EXISTS account_id VARCHAR`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_video_projects_account_id ON video_projects (account_id, created_at DESC)`);

  // photographer_profiles
  await db.execute(sql`ALTER TABLE photographer_profiles ADD COLUMN IF NOT EXISTS account_id VARCHAR`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_photographer_profiles_account_id ON photographer_profiles (account_id)`);

  // portfolio_posts
  await db.execute(sql`ALTER TABLE portfolio_posts ADD COLUMN IF NOT EXISTS account_id VARCHAR`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_portfolio_posts_account_id ON portfolio_posts (account_id, photographer_id)`);

  // reservations
  await db.execute(sql`ALTER TABLE reservations ADD COLUMN IF NOT EXISTS account_id VARCHAR`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_reservations_account_id ON reservations (account_id, photographer_id)`);

  console.log("[Migration-012] account_id columns + indexes ready.");
}
