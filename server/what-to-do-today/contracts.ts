/**
 * What To Do Today — Daily Execution Engine Contracts
 * 
 * Constitutional Principle:
 * What To Do Today is strictly a downstream execution layer.
 * It translates approved strategic intelligence into realistic, prioritized,
 * platform-native daily tasks without inventing strategy authority.
 */

export type ChannelName = "YOUTUBE" | "INSTAGRAM" | "TIKTOK" | "FACEBOOK" | "X" | "LINKEDIN" | "WEBSITE" | "EMAIL" | "OTHER";
export type ChannelMode = "ORGANIC" | "PAID";
export type ChannelRole = "PRIMARY" | "SECONDARY" | "SUPPORTING" | "TESTING";

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

export interface ApprovedChannelDecision {
  channelName: string;
  platform: ChannelName;
  mode: ChannelMode;
  strategicRole: ChannelRole;
  allocationPct?: number;
  monthlyAmount?: number;
  currency?: string;
  cadence?: string;
  rationale?: string;
  primaryObjective?: string;
  readinessStatus?: "READY_FOR_ORGANIC_EXECUTION" | "READY_FOR_CONTROLLED_VALIDATION_TEST" | "PREREQUISITE_GATED";
  initialTestingEligibility?: string;
  prerequisiteSummary?: string | null;
  requiredWarmAudiencePool?: number | null;
  requiredLandingPageVisits?: number | null;
  requiredConversionMeasurement?: string | null;
}

export interface StrategicLaneContext {
  laneId: string;
  title: string;
  segmentId?: string;
  targetRole?: string;
  primaryPain?: string;
  buyingTension?: string;
  corePains?: string[];
  desires?: string[];
  objections?: string[];
  proofRequirements?: string[];
  funnelSnapshotId?: string;
  persuasionSnapshotId?: string;
  funnelStages?: Array<{
    stageName: string;
    stageType?: string;
    objective?: string;
    cta?: string;
    conversionAction?: string;
    destinationUrl?: string;
  }>;
  primaryCta?: string;
  conversionAction?: string;
  destinationUrl?: string;
}

export interface ExecutionPlanningContext {
  campaignId: string;
  accountId: string;
  businessId?: string | null;
  productId?: string | null;
  offeringId?: string | null;
  businessName?: string;
  productUrl?: string;
  businessDate: string; // YYYY-MM-DD
  strategyRootId: string;
  strategyRootVersion: number | null;
  rootBundleId: string;
  rootBundleVersion: number;
  strategicPlanId: string;
  strategicPlanVersion: number;
  selectedSnapshotIds?: Record<string, any>;
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
    conversionAction?: string;
    destinationUrl?: string;
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
    primaryChannelMode: ChannelMode;
    primaryChannelDecision: ApprovedChannelDecision;
    supportingChannels: ChannelName[];
    approvedChannels: ApprovedChannelDecision[];
    rejectedPaidChannels: string[];
    rejectedOrganicChannels: string[];
    channelGuidance?: Record<string, string>;
  };
  budgetConstraints: {
    totalBudget?: string;
    monthlyBudgetAmount?: number;
    currency?: string;
    paidAllocationPct?: number;
    organicEffortAllocationPct?: number;
    mediaSpendWithheld?: boolean;
    operationalMode?: string; // e.g. BUILD, SCALE
    spendRule?: string;
    spendAction?: string;
    authorityHierarchy?: Record<string, any>;
    monthlyBudgetEnvelope?: number;
    finalPlannedChannelAllocation?: Array<{
      channelName: string;
      sharePercentage: number;
      monthlyAmount: number;
      isOrganic: boolean;
      readinessStatus: string;
    }>;
    initialTestingAllowance?: number;
    initialTestingAllowancePct?: number;
    unreleasedReserve?: number;
    unreleasedReservePct?: number;
    actualSpend?: number | null;
    actualSpendStatus?: string;
    monetaryProductionCosts?: number;
    holdPolicy?: Record<string, any>;
    channelPrerequisites?: Array<Record<string, any>>;
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
  channelMode?: ChannelMode;
  channelRole: ChannelRole;
  laneId?: string;
  funnelStage?: string;
  buyingTension?: string;
  intendedMessage?: string;
  objective: string;
  reason: string;
  expectedOutcome: string;
  sourceAuthority: string;
  sourceDecisionIds?: string[];
  sourceStrategyVersion?: number;
  estimatedEffort: string;
  dependencies?: string[];
  executionApproach: string;
  proofRequired?: string;
  conversionAction?: string;
  ctaDestination?: string;
  destinationUrl?: string;
}

export interface ChannelPlanItem {
  channel: ChannelName;
  mode?: ChannelMode;
  role: ChannelRole;
  allocationPct?: number;
  monthlyAmount?: number;
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
