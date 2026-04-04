export type MemoryClass =
  | "content_rhythm"
  | "channel_decision"
  | "budget_decision"
  | "iteration_direction"
  | "retention_approach"
  | "content_distribution"
  | "self_improvement"
  | "industry_baseline"
  | "exploration_budget"
  | "agent_action";

export type EnforcementStrength = "none" | "soft" | "moderate" | "strong";

export interface MemorySlot {
  id: string;
  accountId: string;
  campaignId: string;
  memoryType: MemoryClass;
  engineName: string | null;
  label: string;
  details: string | null;
  performance: string | null;
  score: number;
  confidenceScore: number;
  isWinner: boolean;
  usageCount: number;
  planId: string | null;
  strategyFingerprint: string | null;
  updatedAt: Date | null;
  createdAt: Date | null;
}

export interface MemoryBlock {
  campaignId: string;
  accountId: string;
  reinforceSlots: MemorySlot[];
  avoidSlots: MemorySlot[];
  pendingSlots: MemorySlot[];
  rhythmSlot: MemorySlot | null;
  industryBaseline: IndustryBaseline | null;
  loadedAt: Date;
}

export interface IndustryBaseline {
  reelsPerWeek: number;
  postsPerWeek: number;
  storiesPerDay: number;
  carouselsPerWeek: number;
  videosPerWeek: number;
  objective: string;
  businessType: string;
  confidenceScore: number;
  source: "derived";
}

export interface ConfidenceWeightedConstraint {
  label: string;
  details: string | null;
  enforcementStrength: EnforcementStrength;
  enforcementMultiplier: number;
  confidenceScore: number;
  memoryType: MemoryClass;
  engineName: string | null;
}
