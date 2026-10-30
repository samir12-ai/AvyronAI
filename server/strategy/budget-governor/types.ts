/**
 * Canonical types for Avyron Channel-Based Budget Recommender.
 *
 * Product Decision:
 * Avyron does NOT automatically spend advertising money or issue execution commands.
 * The output is an intelligent, evidence-based recommendation grounded in
 * Channel Selection output and user-configured monthly budget.
 */

export type BudgetGovernorMode = "recommendation_only";

export type BudgetGovernorStatus =
  | "COMPLETE"
  | "BUDGET_NOT_PROVIDED"
  | "ZERO_BUDGET"
  | "MISSING_CHANNELS"
  | "FAILED";

export interface SelectedChannelInput {
  channelId?: string;
  channelName?: string;
  channel?: string;
  strategicRole?: string;
  role?: string;
  selectionRationale?: string;
  audienceFit?: string;
  businessObjectiveFit?: string;
  fitScore?: number;
  priorityRank?: number;
  isOrganic?: boolean;
  laneAssociations?: string[];
  costAssumptions?: string;
}

export interface BusinessContextInput {
  businessType?: string;
  offeringName?: string;
  targetAudience?: string;
  campaignObjective?: string;
  geography?: string;
}

export interface ChannelBudgetRecommenderInput {
  accountId?: string;
  campaignId?: string;
  monthlyBudget: number | null;
  currency: string | null;
  budgetSettingsVersion?: number;
  budgetUpdatedAt?: string;
  businessContext?: BusinessContextInput;
  selectedChannels?: SelectedChannelInput[];
  channelSelectionSnapshotId?: string | null;
  _mockLlmOutput?: any;
}

export interface ChannelAllocation {
  channelId: string;
  channelName: string;
  sharePercentage: number;
  monthlyAmount: number | null;
  why: string;
  isOrganic?: boolean;
  proposedUse?: string;
}

export interface ValidationSummary {
  valid: boolean;
  errors: string[];
}

export interface BudgetGovernorRecommendationResult {
  mode: BudgetGovernorMode;
  status: BudgetGovernorStatus;
  statusMessage: string;
  totalMonthlyBudget: number | null;
  currency: string | null;
  allocations: ChannelAllocation[];
  overallRationale: string;
  validationResult: ValidationSummary;
  budgetSettingsVersion?: number;
  channelSelectionSnapshotId?: string | null;
  budgetConfirmation?: "user_confirmed" | "unconfirmed" | "missing";
  executionMode?: "recommendation_only" | "execution";
  authority?: string;
  isOutdated?: boolean;
  executionTimeMs: number;
  engineVersion: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Legacy / Back-Compat Types & Adapter
// Kept in an isolated compatibility envelope so legacy readers/tests
// do NOT crash, but never allow spending authorization or scaling rules.
// ────────────────────────────────────────────────────────────────────────────

export interface CampaignPerformanceMetrics {
  conversions: number;
  spend: number;
  revenue: number;
  isStatisticallyValid: boolean;
  statisticalConfidence: number;
}

export interface BudgetGovernorInput {
  offerStrength?: number;
  offerProofScore?: number;
  offerCompleteness?: boolean;
  funnelStrengthScore?: number;
  funnelFrictionScore?: number;
  funnelProjections?: {
    expectedConversionRate: number;
    expectedCPA: number;
    expectedROAS: number;
  };
  channelRisk?: number;
  validationConfidence?: number;
  validationState?: string;
  marketIntensity?: number;
  competitorSpendEstimate?: number;
  audienceSize?: string;
  currentBudget?: number | null;
  currency?: string | null;
  historicalCPA?: number | null;
  historicalROAS?: number | null;
  campaignPerformance?: CampaignPerformanceMetrics;
  signalComposition?: import("../../shared/signal-lineage").SignalComposition;
  selectedChannels?: SelectedChannelInput[];
  businessContext?: BusinessContextInput;
}

export interface BudgetDecision {
  action: "test" | "scale" | "hold" | "halt";
  reasoning: string;
  executionMode?: "recommendation_only" | "governed";
}

export interface BudgetRange {
  min: number;
  max: number;
  recommended: number;
  currency: string;
}

export interface ExpansionPermission {
  allowed: boolean;
  maxScaleFactor: number;
  conditions: string[];
  blockers: string[];
}

export interface BudgetGuardResult {
  passed: boolean;
  violations: string[];
  warnings: string[];
  overrides: string[];
}

export interface BudgetGovernorResult extends BudgetGovernorRecommendationResult {
  decision: BudgetDecision;
  testBudgetRange?: BudgetRange;
  scaleBudgetRange?: BudgetRange;
  expansionPermission?: ExpansionPermission;
  killFlag?: boolean;
  killReasons?: string[];
  guardResult?: BudgetGuardResult;
  riskAssessment?: {
    overallRisk: number;
    riskFactors: string[];
    mitigations: string[];
  };
  cacAssumptionCheck?: {
    realistic: boolean;
    estimatedCAC: number;
    industryBenchmarkCAC: number;
    deviation: number;
    warnings: string[];
  };
  boundaryCheck?: { passed: boolean; violations: string[] };
  structuralWarnings?: string[];
  confidenceScore?: number;
  layerDiagnostics?: Record<string, any>;
  dataSource?: any;
}
