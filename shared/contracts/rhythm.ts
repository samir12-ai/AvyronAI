import { z } from "zod";
import { SCHEMA_VERSION } from "./version";

/**
 * RhythmConfigContract — canonical shape persisted to
 * strategic_plans.approved_rhythm_json and plan_approvals.rhythm_snapshot_json.
 *
 * Phase 6.5 — Integrity Engineering (Samir, locked 2026-04-20):
 *   One canonical shape. snake_case only. No alternate shapes. No permissive
 *   parsing. Readers MUST parse through this schema; on failure they MUST
 *   throw a structured RHYTHM_CONFIG_INVALID, never fall back to {}.
 *
 *   The previous camelCase shape is treated as legacy and rejected on read.
 *   Operators rebake plans manually (no migrations, per doctrine).
 */
export const RhythmConfigV1Schema = z.object({
  posts_per_week: z.number().int().nonnegative(),
  reels_per_week: z.number().int().nonnegative(),
  carousels_per_week: z.number().int().nonnegative(),
  videos_per_week: z.number().int().nonnegative().default(0),
  stories_per_day: z.number().int().nonnegative(),
  approved_at: z.string().datetime(),
  schema_version: z.literal(SCHEMA_VERSION),
});

/**
 * Versioned compatibility for legacy v0 camelCase rhythm snapshots persisted
 * by strategic plan approval before canonical snake_case v1 standardization.
 * Requires all core numeric counters + ISO datetime approvedAt so corrupt or
 * unrelated JSON objects are still strictly rejected.
 */
export const LegacyRhythmConfigV0Schema = z.object({
  postsPerWeek: z.number().int().nonnegative(),
  reelsPerWeek: z.number().int().nonnegative(),
  carouselsPerWeek: z.number().int().nonnegative(),
  videosPerWeek: z.number().int().nonnegative().optional().default(0),
  storiesPerDay: z.number().int().nonnegative(),
  approvedAt: z.string().datetime(),
  schema_version: z.enum(["v0", SCHEMA_VERSION]).optional(),
});

export const RhythmConfigSchema = z.preprocess((val) => {
  if (val && typeof val === "object" && !Array.isArray(val)) {
    const rec = val as Record<string, unknown>;
    // If canonical snake_case fields are already present, validate directly as v1
    if ("posts_per_week" in rec || "reels_per_week" in rec) {
      return rec;
    }
    // Check if it is a valid v0 camelCase rhythm snapshot
    const v0 = LegacyRhythmConfigV0Schema.safeParse(rec);
    if (v0.success) {
      return {
        posts_per_week: v0.data.postsPerWeek,
        reels_per_week: v0.data.reelsPerWeek,
        carousels_per_week: v0.data.carouselsPerWeek,
        videos_per_week: v0.data.videosPerWeek ?? 0,
        stories_per_day: v0.data.storiesPerDay,
        approved_at: v0.data.approvedAt,
        schema_version: SCHEMA_VERSION,
      };
    }
  }
  return val;
}, RhythmConfigV1Schema);

export type RhythmConfig = z.infer<typeof RhythmConfigV1Schema>;
