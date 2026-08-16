import { z } from "zod";

export const SystemValidationFlagSchema = z.object({
  passed: z.boolean(),
  reason: z.string(),
  confidence: z.literal("LOW"),
});

export type SystemValidationFlag = z.infer<typeof SystemValidationFlagSchema>;
