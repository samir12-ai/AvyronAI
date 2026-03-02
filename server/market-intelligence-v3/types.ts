export type IntentCategory =
  | "DEFENSIVE"
  | "AGGRESSIVE_SCALING"
  | "TESTING"
  | "POSITIONING_SHIFT"
  | "PRICE_WAR"
  | "DECLINING"
  | "STABLE_DOMINANT";

export type ConfidenceLevel =
  | "STRONG"
  | "MODERATE"
  | "LOW"
  | "UNSTABLE"
  | "INSUFFICIENT";

export type ExecutionMode = "FULL" | "REDUCED" | "LIGHT";

export type GuardDecision = "PROCEED" | "DOWNGRADE" | "BLOCK";

export type MIv3Mode = "overview" | "dominance" | "actions" | "history";

export interface SignalData {
  postingFrequencyTrend: number;
  engagementVolatility: number;
  ctaIntensityShift: number;
  offerLanguageChange: number;
  hashtagDriftScore: number;
  bioModificationFrequency: number;
  sentimentDrift: number;
  reviewVelocityChange: number;
  contentExperimentRate: number;
}

export interface CompetitorSignalResult {
  competitorId: string;
  competitorName: string;
  signals: SignalData;
  signalCoverageScore: number;
  sourceReliabilityScore: number;
  sampleSize: number;
  timeWindowDays: number;
  varianceScore: number;
  dominantSourceRatio: number;
  missingFields: string[];
}

export interface IntentResult {
  competitorId: string;
  competitorName: string;
  intentCategory: IntentCategory;
  intentScore: number;
  scores: Record<IntentCategory, number>;
  degraded: boolean;
  degradeReason?: string;
}

export interface TrajectoryData {
  marketHeatingIndex: number;
  narrativeConvergenceScore: number;
  offerCompressionIndex: number;
  angleSaturationLevel: number;
  revivalPotential: number;
}

export interface DominanceResult {
  competitorId: string;
  competitorName: string;
  dominanceScore: number;
  dominanceLevel: string;
  weaknesses: string[];
  strengths: string[];
}

export interface ConfidenceFactors {
  dataCompleteness: number;
  freshnessDecay: number;
  sourceReliability: number;
  sampleStrength: number;
  crossCompetitorConsistency: number;
  signalStability: number;
}

export interface ConfidenceResult {
  overall: number;
  level: ConfidenceLevel;
  factors: ConfidenceFactors;
  guardDecision: GuardDecision;
  guardReasons: string[];
}

export interface SignalStabilityGuard {
  signalCoverageScore: number;
  sourceReliabilityScore: number;
  sampleSize: number;
  timeWindowDays: number;
  varianceScore: number;
  dominantSourceRatio: number;
  missingFields: string[];
  decision: GuardDecision;
  reasons: string[];
}

export interface TwoRunConfirmation {
  confirmedRuns: number;
  isConfirmed: boolean;
  previousDirection: string | null;
  currentDirection: string;
  directionStable: boolean;
}

export interface TokenBudgetEstimate {
  projectedTokens: number;
  ceiling: number;
  selectedMode: ExecutionMode;
  downgradeReason: string | null;
}

export interface TelemetryRecord {
  executionMode: ExecutionMode;
  projectedTokens: number;
  actualTokensUsed: number;
  competitorsCount: number;
  commentSampleSize: number;
  postSampleSize: number;
  downgradeReason: string | null;
  postsProcessed: number;
  commentsProcessed: number;
  refreshReason: string | null;
}

export interface MIv3Output {
  marketState: string;
  dominantIntentType: IntentCategory;
  competitorIntentMap: IntentResult[];
  trajectoryDirection: string;
  narrativeSaturationLevel: number;
  revivalPotential: number;
  entryStrategy: string | null;
  defensiveRisks: string[];
  confidence: ConfidenceResult;
  missingSignalFlags: string[];
  dataFreshnessDays: number;
  volatilityIndex: number;
}

export interface MIv3DiagnosticResult {
  output: MIv3Output;
  snapshotId: string;
  executionMode: ExecutionMode;
  telemetry: TelemetryRecord;
  dominanceData: DominanceResult[];
  trajectoryData: TrajectoryData;
  signalGuard: SignalStabilityGuard;
  twoRunStatus: TwoRunConfirmation;
  cached: boolean;
  timestamp: string;
}

export interface CompetitorInput {
  id: string;
  name: string;
  platform: string;
  profileLink: string;
  businessType: string;
  postingFrequency: number | null;
  contentTypeRatio: string | null;
  engagementRatio: number | null;
  ctaPatterns: string | null;
  discountFrequency: string | null;
  hookStyles: string | null;
  messagingTone: string | null;
  socialProofPresence: string | null;
  websiteUrl?: string | null;
  googleMapsUrl?: string | null;
  manualNotes?: string | null;
  pricingHints?: string | null;
  posts?: PostData[];
  comments?: CommentData[];
}

export interface PostData {
  id: string;
  caption: string;
  likes: number;
  comments: number;
  views?: number;
  mediaType: string;
  hashtags: string[];
  timestamp: string;
  hasCTA: boolean;
  hasOffer: boolean;
}

export interface CommentData {
  id: string;
  text: string;
  sentiment?: number;
  timestamp: string;
}

export interface RefreshDecision {
  competitorId: string;
  shouldRefresh: boolean;
  reason: string;
  nextRefreshAt: Date;
  intervalDays: number;
  volatilityIndex: number;
}
