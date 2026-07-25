import { z } from "zod";
import { SCHEMA_VERSION } from "./version";

export const ClusterEvaluationStatus = z.enum([
  "pending",
  "evaluating",
  "evaluated",
  "skipped",
]);
export type ClusterEvaluationStatus = z.infer<typeof ClusterEvaluationStatus>;

export const ClusterContractSchema = z.object({
  cluster_id: z.string().min(1),
  dna_id: z.string().min(1),
  window_id: z.string().min(1),
  content_ids: z.array(z.string()).default([]),
  evaluation_status: ClusterEvaluationStatus,
  schema_version: z.literal(SCHEMA_VERSION),
});
export type ClusterContract = z.infer<typeof ClusterContractSchema>;
