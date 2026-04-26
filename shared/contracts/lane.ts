import { z } from "zod";

export const LANE = ["user", "competitor", "bridge", "shared"] as const;
export const LaneSchema = z.enum(LANE);
export type Lane = z.infer<typeof LaneSchema>;
