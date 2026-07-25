import { z } from "zod";
import { LaneSchema } from "./lane";
import { SCHEMA_VERSION } from "./version";

export const SignalType = z.enum([
  "pain",
  "desire",
  "objection",
  "pattern",
  "change_indicator",
  "metric",
  "other",
]);
export type SignalType = z.infer<typeof SignalType>;

/**
 * SignalContract — canonical pipeline signal shape.
 *
 * Phase 6.5 — Integrity Engineering (Samir, locked 2026-04-20):
 *   First-class lineage. Every signal must prove account_id, campaign_id,
 *   lane, run_id, source_snapshot_id, and (for collected lanes) acquisition_id.
 *   Bridge-lane signals carry derived_from_signal_id pointing back to the
 *   competitor-lane signal they were synthesised from.
 */
export const SignalContractSchema = z
  .object({
    signal_id: z.string().min(1),
    run_id: z.string().min(1),
    account_id: z.string().min(1),
    campaign_id: z.string().min(1),
    /** Required for lane=user|competitor. Null only for lane=bridge|shared. */
    acquisition_id: z.string().min(1).nullable(),
    /** Optional Phase-5 anchor reference. */
    window_id: z.string().min(1).nullable().optional(),
    /** Set only on bridge-lane signals; points to the competitor-lane signal id. */
    derived_from_signal_id: z.string().min(1).nullable().optional(),
    source_snapshot_id: z.string().min(1),
    lane: LaneSchema,
    type: SignalType,
    value: z.string().min(1),
    confidence: z.number().min(0).max(1),
    evidence: z.array(z.string()).default([]),
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
    if (s.lane === "bridge" && !s.derived_from_signal_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["derived_from_signal_id"],
        message: "derived_from_signal_id is required for bridge-lane signals",
      });
    }
  });
export type SignalContract = z.infer<typeof SignalContractSchema>;
