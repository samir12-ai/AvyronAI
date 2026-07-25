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
export const RhythmConfigSchema = z.object({
  posts_per_week: z.number().int().nonnegative(),
  reels_per_week: z.number().int().nonnegative(),
  carousels_per_week: z.number().int().nonnegative(),
  videos_per_week: z.number().int().nonnegative().default(0),
  stories_per_day: z.number().int().nonnegative(),
  approved_at: z.string().datetime(),
  schema_version: z.literal(SCHEMA_VERSION),
});
export type RhythmConfig = z.infer<typeof RhythmConfigSchema>;
