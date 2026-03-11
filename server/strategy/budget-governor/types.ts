export interface BudgetGovernorInput {
  offerStrength: number;
  offerProofScore: number;
  offerCompleteness: boolean;
  funnelStrengthScore: number;
  funnelFrictionScore: number;
  funnelProjections: {
    expectedConversionRate: number;
    expectedCPA: number;
    expectedROAS: number;
  };
  channelRisk: number;
  validationConfidence: number;
  validationState: string;
  marketIntensity: number;
  competitorSpendEstimate: number;
  audienceSize: string;
  currentBudget: number;
  historicalCPA: number | null;
  historicalROAS: number | null;
}

export interface BudgetDecision {
  action: "test" | "scale" | "hold" | "halt";
  reasoning: string;
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

export interface BudgetGovernorResult {
  status: string;
  statusMessage: string | null;
  decision: BudgetDecision;
  testBudgetRange: BudgetRange;
  scaleBudgetRange: BudgetRange;
  expansionPermission: ExpansionPermission;
  killFlag: boolean;
  killReasons: string[];
  guardResult: BudgetGuardResult;
  riskAssessment: {
    overallRisk: number;
    riskFactors: string[];
    mitigations: string[];
  };
  cacAssumptionCheck: {
    realistic: boolean;
    estimatedCAC: number;
    industryBenchmarkCAC: number;
    deviation: number;
    warnings: string[];
  };
  boundaryCheck: { passed: boolean; violations: string[] };
  structuralWarnings: string[];
  confidenceScore: number;
  executionTimeMs: number;
  engineVersion: number;
  layerDiagnostics: Record<string, any>;
  strategyAcceptability?: import("../../shared/strategy-acceptability").StrategyAcceptability;
}
