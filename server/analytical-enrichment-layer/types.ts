export interface RootCause {
  surfaceSignal: string;
  deepCause: string;
  causalReasoning: string;
  sourceData: string;
  confidenceLevel: "high" | "medium" | "low";
}

export interface PainTypeEntry {
  painPoint: string;
  painType: "trust" | "financial" | "knowledge_gap" | "status_identity" | "efficiency";
  severity: "critical" | "moderate" | "minor";
  underlyingCause: string;
  evidence: string;
}

export interface CausalChain {
  pain: string;
  cause: string;
  impact: string;
  behavior: string;
  conversionEffect: string;
}

export interface BuyingBarrier {
  barrier: string;
  rootCause: string;
  userThinking: string;
  requiredResolution: string;
  severity: "blocking" | "major" | "moderate";
}

export interface MechanismGap {
  area: string;
  whatUserDoesNotUnderstand: string;
  whyItMatters: string;
  currentPerception: string;
  idealPerception: string;
  gapSeverity: "critical" | "moderate" | "minor";
}

export interface TrustGapEntry {
  gap: string;
  barrier: string;
  currentTrustLevel: "none" | "low" | "moderate" | "high";
  requiredTrustLevel: "low" | "moderate" | "high" | "very_high";
  proofRequired: string;
}

export interface ContradictionFlag {
  surfaceSignal: string;
  actualReality: string;
  whyMisleading: string;
  correctInterpretation: string;
  severity: "blocking" | "concerning" | "minor";
}

export interface PriorityRanking {
  insight: string;
  dimension: string;
  impactOnConversion: "critical" | "high" | "moderate" | "low";
  frequency: "pervasive" | "common" | "occasional" | "rare";
  actionability: "immediate" | "short_term" | "long_term";
  rank: number;
}

export interface ConfidenceNote {
  area: string;
  note: string;
  dataQuality: "strong" | "adequate" | "weak" | "insufficient";
}

export interface AnalyticalPackage {
  root_causes: RootCause[];
  pain_types: PainTypeEntry[];
  causal_chains: CausalChain[];
  buying_barriers: BuyingBarrier[];
  mechanism_gaps: MechanismGap[];
  trust_gaps: TrustGapEntry[];
  contradiction_flags: ContradictionFlag[];
  priority_ranking: PriorityRanking[];
  confidence_notes: ConfidenceNote[];
  generatedAt: string;
  version: number;
  inputSummary: {
    hasMI: boolean;
    hasAudience: boolean;
    hasProductDNA: boolean;
    hasCompetitiveData: boolean;
    signalCount: number;
  };
}

export interface AELInput {
  mi: any;
  audience: any;
  productDNA: any | null;
  competitiveData?: any;
  accountId: string;
  campaignId: string;
}

export const EMPTY_ANALYTICAL_PACKAGE: AnalyticalPackage = {
  root_causes: [],
  pain_types: [],
  causal_chains: [],
  buying_barriers: [],
  mechanism_gaps: [],
  trust_gaps: [],
  contradiction_flags: [],
  priority_ranking: [],
  confidence_notes: [],
  generatedAt: new Date().toISOString(),
  version: 2,
  inputSummary: {
    hasMI: false,
    hasAudience: false,
    hasProductDNA: false,
    hasCompetitiveData: false,
    signalCount: 0,
  },
};
