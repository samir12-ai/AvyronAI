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

export type GoalMode = "REACH_MODE" | "STRATEGY_MODE";

export type GuardDecision = "PROCEED" | "DOWNGRADE" | "BLOCK";

export type MIv3Mode = "overview" | "dominance" | "threats" | "history";

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

export type CompetitorLifecycle = "ACTIVE" | "DORMANT" | "LOW_SIGNAL";

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
  authorityWeight: number;
  lifecycle: CompetitorLifecycle;
  lowSample: boolean;
  commentCount: number;
}

export type IntentConfidenceBand = "STRONG" | "MODERATE" | "UNCERTAIN" | "DEGRADED";

export type IntentStatus = "PROVISIONAL" | "FINAL";

export interface IntentResult {
  competitorId: string;
  competitorName: string;
  intentCategory: IntentCategory;
  intentScore: number;
  scores: Record<IntentCategory, number>;
  degraded: boolean;
  degradeReason?: string;
  topIntentScore: number;
  intentConfidence: number;
  intentConfidenceBand: IntentConfidenceBand;
  intentStatus: IntentStatus;
  intentStatusReason?: string;
}

export interface TrajectoryData {
  marketHeatingIndex: number;
  narrativeConvergenceScore: number;
  offerCompressionIndex: number;
  angleSaturationLevel: number;
  revivalPotential: number;
  marketActivityLevel: number;
  demandConfidence: number;
  marketCompressionScore: number;
  competitionIntensityScore: number;
}

export interface DominanceModeMetadata {
  mode: GoalMode;
  weights: Record<string, number>;
}

export interface DominanceResult {
  competitorId: string;
  competitorName: string;
  dominanceScore: number;
  dominanceLevel: string;
  weaknesses: string[];
  strengths: string[];
  engagementWeightBiasRisk?: string | null;
  dominanceModeMetadata: DominanceModeMetadata;
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

export interface EvidenceCoverage {
  postsAnalyzed: number;
  commentsAnalyzed: number;
  competitorsWithSufficientData: number;
  totalCompetitors: number;
}

export interface EngagementQuality {
  highIntentCount: number;
  lowValueCount: number;
  engagementQualityRatio: number;
}

export interface MIv3Output {
  marketState: string;
  dominantIntentType: IntentCategory;
  competitorIntentMap: IntentResult[];
  trajectoryDirection: string;
  narrativeSaturationLevel: number;
  revivalPotential: number;
  marketDiagnosis: string | null;
  threatSignals: string[];
  opportunitySignals: string[];
  confidence: ConfidenceResult;
  missingSignalFlags: string[];
  dataFreshnessDays: number;
  volatilityIndex: number;
  signalNoiseRatio: number;
  evidenceCoverage: EvidenceCoverage;
  engagementQuality: EngagementQuality;
  marketActivityLevel: number;
  demandConfidence: number;
  competitionIntensityScore: number;
  competitionIntensityLevel: string;
  audienceIntentSignals: string[];
}

export interface SampleBiasResult {
  hasBias: boolean;
  biasFlags: string[];
  biasScore: number;
}

export interface MIDiagnostics {
  activityScore: number;
  competitionIntensityScore: number;
  demandScore: number;
  narrativeSaturationScore: number;
  competitorWeights: { competitorId: string; competitorName: string; authorityWeight: number; lifecycle: CompetitorLifecycle }[];
  sampleBiasFlag: boolean;
  realCommentRatio: number;
  demandPressureScore: number;
  narrativeConvergenceScore: number;
  audiencePressureSignal: number;
  echoChamberRisk: number;
}

export type CacheInvalidationReason = "ENGINE_UPGRADE" | "COMPETITOR_SET_CHANGED" | "INCOMPLETE_SNAPSHOT" | "STALE" | null;

export interface MIv3DiagnosticResult {
  output: MIv3Output;
  snapshotId: string;
  snapshotStatus: "COMPLETE" | "PARTIAL";
  executionMode: ExecutionMode;
  goalMode: GoalMode;
  telemetry: TelemetryRecord;
  dominanceData: DominanceResult[];
  trajectoryData: TrajectoryData;
  signalGuard: SignalStabilityGuard;
  twoRunStatus: TwoRunConfirmation;
  similarityData: SimilarityResult | null;
  contentDnaData: CompetitorContentDNA[] | null;
  deltaReport: DeltaReport | null;
  diagnostics: MIDiagnostics | null;
  cached: boolean;
  cacheInvalidationReason: CacheInvalidationReason;
  snapshotSource: "FRESH_DATA" | "CACHED_DATA";
  fetchExecuted: boolean;
  timestamp: string;
  dataStatus: "LIVE" | "ENRICHING" | "COMPLETE";
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

export interface SimilarityDimension {
  score: number;
  sufficient: boolean;
}

export interface CompetitorEvidenceCoverage {
  competitorId: string;
  competitorName: string;
  postsAvailable: number;
  commentsAvailable: number;
  missingDataPoints: string[];
  coverageRatio: number;
}

export interface SimilarityResult {
  overallSimilarityIndex: number;
  dimensions: Record<string, SimilarityDimension>;
  evidenceCoverage: CompetitorEvidenceCoverage[];
  diagnosis: "SIMILARITY_LIKELY_MARKET_REALITY" | "SIMILARITY_LIKELY_DATA_LIMITATION" | "LOW_SIMILARITY" | "INSUFFICIENT_DATA" | "LOW_CONFIDENCE";
  explanation: string;
}

export type HookArchetype = "shock" | "authority" | "curiosity" | "problem" | "question" | "statistic" | "story";
export type NarrativeFramework = "mistake_fix" | "problem_solution" | "before_after" | "story_lesson" | "listicle" | "how_to";
export type CTAFramework = "explicit" | "soft" | "narrative" | "trust";

export interface ContentDNAEvidence {
  postId: string;
  snippet: string;
  detectedType: string;
}

export interface CompetitorContentDNA {
  competitorId: string;
  competitorName: string;
  hookArchetypes: HookArchetype[];
  narrativeFrameworks: NarrativeFramework[];
  ctaFrameworks: CTAFramework[];
  evidence: ContentDNAEvidence[];
  dnaConfidence: number;
  missingSignalFlags: string[];
}

export interface SignalDelta {
  competitorId: string;
  competitorName: string;
  signalField: string;
  previous: number;
  current: number;
  delta: number;
}

export interface IntentChange {
  competitorId: string;
  competitorName: string;
  previousIntent: IntentCategory;
  currentIntent: IntentCategory;
  changed: boolean;
}

export interface TrajectoryDelta {
  field: string;
  previous: number;
  current: number;
  delta: number;
}

export interface DominanceChange {
  competitorId: string;
  competitorName: string;
  previousScore: number;
  currentScore: number;
  previousLevel: string;
  currentLevel: string;
  scoreDelta: number;
  levelChanged: boolean;
}

export interface DeltaReport {
  signalDeltas: SignalDelta[];
  intentChanges: IntentChange[];
  trajectoryDeltas: TrajectoryDelta[];
  dominanceChanges: DominanceChange[];
  competitorHashMatch: boolean;
  hasMeaningfulChanges: boolean;
}

export interface RefreshDecision {
  competitorId: string;
  shouldRefresh: boolean;
  reason: string;
  nextRefreshAt: Date;
  intervalDays: number;
  volatilityIndex: number;
}
