import { z } from "zod";
import { SCHEMA_VERSION } from "./version";

export const ChangeDimension = z.enum([
  "content",
  "positioning",
  "offer",
  "frequency",
  "engagement",
  "other",
]);
export type ChangeDimension = z.infer<typeof ChangeDimension>;

// Severity vocabulary per system blueprint §3.3: mild / medium / major.
export const ChangeSeverity = z.enum(["mild", "medium", "major"]);
export type ChangeSeverity = z.infer<typeof ChangeSeverity>;

/**
 * ChangeEventContract — canonical pipeline change-event shape.
 *
 * Phase 6.5 — Integrity Engineering (Samir, locked 2026-04-20):
 *   First-class lineage. Change events are only emitted from collected lanes
 *   (currently competitor lane), so account_id, campaign_id, and acquisition_id
 *   are always required.
 */
export const ChangeEventContractSchema = z.object({
  change_event_id: z.string().min(1),
  run_id: z.string().min(1),
  account_id: z.string().min(1),
  campaign_id: z.string().min(1),
  /** Always required — change events only come from collected lanes. */
  acquisition_id: z.string().min(1),
  /** Optional Phase-5 anchor reference. */
  window_id: z.string().min(1).nullable().optional(),
  baseline_snapshot_id: z.string().min(1),
  current_snapshot_id: z.string().min(1),
  change_dimension: ChangeDimension,
  severity: ChangeSeverity,
  evidence: z.array(z.string()).default([]),
  schema_version: z.literal(SCHEMA_VERSION),
});
export type ChangeEventContract = z.infer<typeof ChangeEventContractSchema>;
