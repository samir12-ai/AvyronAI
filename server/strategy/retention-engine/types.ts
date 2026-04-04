export interface RetentionInput {
  customerJourneyData: CustomerJourneyData;
  offerStructure: OfferStructureInput;
  purchaseMotivations: PurchaseMotivation[];
  postPurchaseObjections: PostPurchaseObjection[];
  campaignId: string;
  accountId: string;
  memoryContext?: string;
}

export interface CustomerJourneyData {
  touchpoints: JourneyTouchpoint[];
  avgTimeToConversion: number | null;
  repeatPurchaseRate: number | null;
  churnRate: number | null;
  customerLifetimeValue: number | null;
  retentionWindowDays: number | null;
  engagementDecayRate: number | null;
}

export interface JourneyTouchpoint {
  stage: string;
  channel: string;
  engagementScore: number;
  dropoffRate: number;
  description: string;
}

export interface OfferStructureInput {
  offerName: string | null;
  coreOutcome: string | null;
  deliverables: string[];
  proofStrength: number | null;
  riskReducers: string[];
  mechanismDescription: string | null;
}

export interface PurchaseMotivation {
  motivation: string;
  strength: number;
  category: string;
}

export interface PostPurchaseObjection {
  objection: string;
  severity: number;
  frequency: number;
  category: string;
}

export interface RetentionLoop {
  name: string;
  type: string;
  description: string;
  triggerCondition: string;
  expectedImpact: number;
  implementationDifficulty: number;
  priorityScore: number;
}

export interface ChurnRiskFlag {
  riskFactor: string;
  severity: number;
  timeframe: string;
  mitigationStrategy: string;
  dataConfidence: number;
}

export interface LTVExpansionPath {
  pathName: string;
  description: string;
  estimatedLTVIncrease: number;
  requiredConditions: string[];
  riskNotes: string[];
  confidenceScore: number;
}

export interface UpsellTrigger {
  triggerName: string;
  triggerCondition: string;
  suggestedOffer: string;
  timing: string;
  expectedConversionRate: number;
  priorityRank: number;
}

export interface RetentionGuardResult {
  passed: boolean;
  flags: string[];
  valueDeliveryClarity: number;
  trustDecayRisk: number;
  retentionMechanismPresence: number;
}

export interface RetentionResult {
  status: string;
  statusMessage: string | null;
  retentionLoops: RetentionLoop[];
  churnRiskFlags: ChurnRiskFlag[];
  ltvExpansionPaths: LTVExpansionPath[];
  upsellTriggers: UpsellTrigger[];
  guardResult: RetentionGuardResult;
  boundaryCheck: { passed: boolean; violations: string[] };
  structuralWarnings: string[];
  confidenceScore: number;
  executionTimeMs: number;
  engineVersion: number;
  dataReliability: {
    overallReliability: number;
    isWeak: boolean;
    advisories: string[];
  };
  strategyAcceptability?: import("../../shared/strategy-acceptability").StrategyAcceptability;
}
