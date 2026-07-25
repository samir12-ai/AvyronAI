import { z } from "zod";
import { SCHEMA_VERSION } from "./version";

export const DnaStatus = z.enum(["proposed", "active", "paused", "retired"]);
export type DnaStatus = z.infer<typeof DnaStatus>;

export const DnaContractSchema = z.object({
  dna_id: z.string().min(1),
  hypothesis: z.string().min(1),
  status: DnaStatus,
  score_history: z
    .array(z.object({ at: z.string().datetime(), score: z.number() }))
    .default([]),
  linked_cluster_ids: z.array(z.string()).default([]),
  schema_version: z.literal(SCHEMA_VERSION),
});
export type DnaContract = z.infer<typeof DnaContractSchema>;
