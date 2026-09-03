/**
 * What To Do Today — Daily Execution Engine Contracts
 * 
 * Constitutional Principle:
 * What To Do Today is strictly a downstream execution layer.
 * It translates approved strategic intelligence into realistic, prioritized,
 * platform-native daily tasks without inventing strategy authority.
 */

export type ChannelName = "YOUTUBE" | "INSTAGRAM" | "TIKTOK" | "FACEBOOK" | "X" | "WEBSITE" | "EMAIL" | "OTHER";
export type ChannelRole = "PRIMARY" | "SUPPORTING" | "TESTING";

export type TaskPriority = "MUST_DO" | "SHOULD_DO" | "OPTIONAL" | "WAITING_BLOCKED";

export type TaskStatus =
  | "PLANNED"
  | "ACTIVE"
  | "DONE"
  | "MISSED"
  | "BLOCKED"
  | "DEFERRED"
  | "STALE"
  | "CANCELLED"
  | "REPLACED";

export type TaskType =
  | "CONTENT"
  | "PROOF_ASSET"
  | "DISTRIBUTION"
  | "MARKET_LEARNING"
  | "SALES_OUTREACH"
  | "CONVERSION"
  | "FOLLOW_UP"
  | "MEASUREMENT"
  | "OPTIMIZATION";

export interface StrategicLaneContext {
  laneId: string;
  title: string;
  segmentId?: string;
  targetRole?: string;
  primaryPain?: string;
  corePains?: string[];
}

export interface ExecutionPlanningContext {
  campaignId: string;
  accountId: string;
  businessDate: string; // YYYY-MM-DD
  strategyRootId: string;
  strategyRootVersion: number;
  rootBundleId: string;
  rootBundleVersion: number;
  strategicPlanId: string;
  strategicPlanVersion: number;
  strategyName: string;
  primaryAxis: string;
  contrastAxis: string;
  approvedPromise: string;
  approvedTransformation: string;
  approvedMechanism: {
    mechanismName: string;
    corePrinciple?: string;
    proofArtifact?: string;
  };
  approvedLanes: StrategicLaneContext[];
  positioningSummary: string;
  differentiationPillars?: string[];
  offerSummary?: string;
  awarenessStrategy?: {
    narrativeReframe?: string;
    mythBreaker?: string;
    entryStage?: string;
  };
  funnelJourney?: {
    acquisitionChannel?: string;
    conversionPath?: string;
    leadMagnet?: string;
    proofArtifact?: string;
    ctaPrimary?: string;
  };
  persuasionTrust?: {
    mode?: string;
    buyerRiskState?: string;
    trustDeficit?: string;
    transferMechanismName?: string;
    proofArtifact?: string;
    primaryCialdiniPrinciple?: string;
    objections?: Array<{
      objection: string;
      response: string;
      requiredProof?: string;
    }>;
  };
  channelHierarchy: {
    primaryChannel: ChannelName;
    supportingChannels: ChannelName[];
    channelGuidance?: Record<string, string>;
  };
  budgetConstraints: {
    totalBudget?: string;
    mediaSpendWithheld?: boolean;
    operationalMode?: string; // e.g. BUILD, SCALE
    spendRule?: string;
  };
  strategicGoals: {
    planSummary: string;
    campaignGoal?: string;
    strategicFocus?: string;
  };
}

export interface TaskDraft {
  title: string;
  description: string;
  priority: TaskPriority;
  taskType: TaskType;
  channel: ChannelName;
  channelRole: ChannelRole;
  laneId?: string;
  objective: string;
  reason: string;
  expectedOutcome: string;
  sourceAuthority: string;
  sourceDecisionIds?: string[];
  estimatedEffort: string;
  dependencies?: string[];
  executionApproach: string;
  proofRequired?: string;
  ctaDestination?: string;
}

export interface ChannelPlanItem {
  channel: ChannelName;
  role: ChannelRole;
  executionIntent: string;
  whyToday: string;
  currentTaskTitle?: string;
  coverageState: "ACTIVE" | "PENDING_PREREQUISITE" | "UNTESTED" | "ROTATION_DUE";
}

export interface DailyPlanDraft {
  dailyMission: string;
  executionRationale: string;
  tasks: TaskDraft[];
  channelPlan: ChannelPlanItem[];
}

export interface ExecutionJudgeReport {
  valid: boolean;
  score: number; // 0.0 - 1.0
  rejectionReasons: string[];
  repairDirectives: string[];
  feedback: string;
}
