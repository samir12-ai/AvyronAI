export interface IterationPerformanceInput {
  campaignId: string;
  impressions: number;
  reach: number;
  clicks: number;
  conversions: number;
  ctr: number;
  cpc: number;
  cpa: number;
  roas: number;
  spend: number;
  engagementRate: number;
}

export interface IterationFunnelInput {
  funnelType: string;
  stageConversions: StageConversion[];
  dropOffPoints: string[];
  overallConversionRate: number;
}

export interface StageConversion {
  stageName: string;
  entryCount: number;
  exitCount: number;
  conversionRate: number;
}

export interface IterationCreativeInput {
  totalCreatives: number;
  topPerformers: CreativeResult[];
  bottomPerformers: CreativeResult[];
  fatigueSignals: string[];
}

export interface CreativeResult {
  creativeId: string;
  label: string;
  impressions: number;
  ctr: number;
  conversionRate: number;
  spend: number;
  status: "active" | "paused" | "killed";
}

export interface IterationPersuasionInput {
  persuasionMode: string;
  persuasionStrengthScore: number;
  objectionsCovered: number;
  trustSequenceLength: number;
  frictionNotes: string[];
}

export interface TestHypothesis {
  hypothesisId: string;
  hypothesis: string;
  variable: string;
  expectedOutcome: string;
  priority: "high" | "medium" | "low";
  riskLevel: "low" | "moderate" | "high";
  testDurationDays: number;
  successMetric: string;
  successThreshold: number;
}

export interface OptimizationTarget {
  targetArea: string;
  currentValue: number;
  targetValue: number;
  improvementStrategy: string;
  confidence: number;
  effort: "low" | "medium" | "high";
}

export interface FailedStrategyFlag {
  strategyName: string;
  failureReason: string;
  failureDate: string;
  shouldRetry: boolean;
  retryConditions: string[];
}

export interface IterationPlanStep {
  stepNumber: number;
  action: string;
  variable: string;
  duration: string;
  successCriteria: string;
  fallbackAction: string;
}

export interface LayerResult {
  layerName: string;
  passed: boolean;
  score: number;
  findings: string[];
  warnings: string[];
}

export interface IterationResult {
  status: string;
  statusMessage: string | null;
  nextTestHypotheses: TestHypothesis[];
  optimizationTargets: OptimizationTarget[];
  failedStrategyFlags: FailedStrategyFlag[];
  iterationPlan: IterationPlanStep[];
  layerResults: LayerResult[];
  structuralWarnings: string[];
  boundaryCheck: { passed: boolean; violations: string[] };
  dataReliability: {
    signalDensity: number;
    performanceDataQuality: number;
    overallReliability: number;
    isWeak: boolean;
    advisories: string[];
  };
  confidenceScore: number;
  executionTimeMs: number;
  engineVersion: number;
  strategyAcceptability?: import("../../shared/strategy-acceptability").StrategyAcceptability;
}
