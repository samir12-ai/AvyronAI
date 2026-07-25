import { z } from "zod";
import { LaneSchema } from "./lane";
import { SCHEMA_VERSION } from "./version";

export const SnapshotEntityType = z.enum([
  "user_channel",
  "competitor_channel",
  "user_content",
  "competitor_content",
  "manual_input",
  "bridged_signal_set",
]);
export type SnapshotEntityType = z.infer<typeof SnapshotEntityType>;

/**
 * SnapshotContract — canonical pipeline snapshot shape.
 *
 * Phase 6.5 — Integrity Engineering (Samir, locked 2026-04-20):
 *   First-class lineage. Every snapshot must prove account_id, campaign_id,
 *   lane, run_id, and (for collected lanes) acquisition_id without joining
 *   around missing identity. window_id is optional (Phase 5 producers set it).
 *
 *   Bridge / shared lanes synthesise snapshots from upstream runs and have no
 *   single acquisition. They are the only lanes allowed to omit acquisition_id.
 */
export const SnapshotContractSchema = z
  .object({
    snapshot_id: z.string().min(1),
    run_id: z.string().min(1),
    account_id: z.string().min(1),
    campaign_id: z.string().min(1),
    /** Required for lane=user|competitor. Null only for lane=bridge|shared. */
    acquisition_id: z.string().min(1).nullable(),
    /** Optional Phase-5 anchor reference. */
    window_id: z.string().min(1).nullable().optional(),
    entity_id: z.string().min(1),
    entity_type: SnapshotEntityType,
    lane: LaneSchema,
    source: z.string().min(1),
    collected_at: z.string().datetime(),
    payload: z.record(z.string(), z.unknown()),
    schema_version: z.literal(SCHEMA_VERSION),
  })
  .superRefine((s, ctx) => {
    if ((s.lane === "user" || s.lane === "competitor") && !s.acquisition_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["acquisition_id"],
        message: `acquisition_id is required for lane=${s.lane}`,
      });
    }
  });
export type SnapshotContract = z.infer<typeof SnapshotContractSchema>;
