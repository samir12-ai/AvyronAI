export interface TargetAudienceViewModel {
  title: string;
  description: string;
  segmentId: string;
  laneId: string;
  commercialRelevance: string;
  buyerRole: string;
  marketType: string;
}

export interface CoreBuyingPainViewModel {
  painId: string;
  title: string;
  rawText: string;
  experience: string;
  commercialImpact: string;
  whyWeCanSolveIt: string;
  reasoning: {
    marketEvidence: string;
    buyerRelevance: string;
    productFit: string;
    strategicDecision: string;
  };
  evidenceSnippets: string[];
  evidenceCount: number;
}

export interface SupportingSignalPain {
  painId: string;
  title: string;
  description: string;
  classification: string;
}

export interface SupportingSignalsViewModel {
  pains: SupportingSignalPain[];
  desires: string[];
  objections: string[];
  triggers: string[];
  emotionalDrivers: string[];
}

export interface ExcludedPainViewModel {
  painId: string;
  title: string;
  reason: string;
  classification: string;
}

export interface ReasoningStep {
  step: string;
  label: string;
  title: string;
  description: string;
  source: string;
  painId?: string;
  capability?: string;
  contrast?: string;
  evidenceCount?: number;
}

export interface BrandConnectionViewModel {
  productTruth: string;
  differentiation: string;
  positioning: string;
  mechanism?: string;
}

export interface ValidationItemViewModel {
  label: string;
  detail: string;
  passed: boolean;
}

export interface DecisionHistoryItemViewModel {
  alternative: string;
  status: string;
  reason: string;
  authority: string;
}

export interface PositioningViewModel {
  umbrellaPosition: string;
  positioningStatement: string;
  contrastAxis: string;
  reasoningJourney: {
    step1: ReasoningStep;
    step2: ReasoningStep;
    step3: ReasoningStep;
    step4: ReasoningStep;
  };
  brandSpine: BrandConnectionViewModel;
  validation: ValidationItemViewModel[];
  decisionHistory: DecisionHistoryItemViewModel[];
}

export interface AudiencePositioningViewModel {
  campaignId: string;
  hasPlan: boolean;
  targetAudience: TargetAudienceViewModel;
  coreBuyingPain: CoreBuyingPainViewModel;
  supportingSignals: SupportingSignalsViewModel;
  excludedPains: ExcludedPainViewModel[];
  positioning: PositioningViewModel;
}
