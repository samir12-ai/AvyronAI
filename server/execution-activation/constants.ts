export const EXECUTION_STATES = {
  IDLE: "IDLE",
  ACTIVATING: "ACTIVATING",
  ACTIVE: "ACTIVE",
  RUNNING: "RUNNING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  ACTIVATION_FAILED: "ACTIVATION_FAILED",
  STARVED: "STARVED",
} as const;

export type ExecutionState = typeof EXECUTION_STATES[keyof typeof EXECUTION_STATES];

export const VALID_STATE_TRANSITIONS: Record<string, string[]> = {
  IDLE: ["ACTIVATING"],
  ACTIVATING: ["ACTIVE", "ACTIVATION_FAILED"],
  ACTIVE: ["RUNNING", "FAILED", "STARVED"],
  RUNNING: ["COMPLETED", "FAILED", "ACTIVE"],
  COMPLETED: ["IDLE", "ACTIVATING"],
  FAILED: ["ACTIVATING", "IDLE"],
  ACTIVATION_FAILED: ["ACTIVATING", "IDLE"],
  STARVED: ["ACTIVATING", "ACTIVE"],
};

export const CONTENT_MINIMUMS = {
  reels: 3,
  carousels: 2,
  stories: 2,
} as const;

export const REELS_RATIO_MINIMUM = 0.1;

export const ACTIVATION_CONFIG = {
  maxContentGenerationRetries: 2,
  generationBatchSize: 5,
  generationDelayMs: 500,
  activationTimeoutMs: 120_000,
} as const;
