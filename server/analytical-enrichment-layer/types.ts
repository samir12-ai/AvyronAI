export interface RootCauseCandidate {
  claim: string;
  sourceEngine: string;
  evidence: string;
  confidenceLevel: "high" | "medium" | "low";
}

export interface PainTypeEntry {
  painPoint: string;
  painType: "functional" | "emotional" | "social" | "financial" | "identity";
  severity: "critical" | "moderate" | "minor";
  evidence: string;
}

export interface TrustGapEntry {
  gap: string;
  barrier: string;
  currentTrustLevel: "none" | "low" | "moderate" | "high";
  requiredTrustLevel: "low" | "moderate" | "high" | "very_high";
}

export interface MechanismGapHint {
  area: string;
  currentState: string;
  idealState: string;
  gapSeverity: "critical" | "moderate" | "minor";
}

export interface ProofNeedHint {
  claim: string;
  proofType: "testimonial" | "data" | "demonstration" | "authority" | "social";
  urgency: "immediate" | "important" | "nice_to_have";
}

export interface StrategicAngleCandidate {
  angle: string;
  rationale: string;
  targetSegment: string;
  differentiationPotential: "high" | "medium" | "low";
}

export interface ContradictionFlag {
  element1: string;
  element2: string;
  nature: string;
  severity: "blocking" | "concerning" | "minor";
}

export interface ConfidenceNote {
  area: string;
  note: string;
  dataQuality: "strong" | "adequate" | "weak" | "insufficient";
}

export interface AnalyticalPackage {
  root_cause_candidates: RootCauseCandidate[];
  pain_type_map: PainTypeEntry[];
  trust_gap_map: TrustGapEntry[];
  mechanism_gap_hints: MechanismGapHint[];
  proof_need_hints: ProofNeedHint[];
  strategic_angle_candidates: StrategicAngleCandidate[];
  contradiction_flags: ContradictionFlag[];
  confidence_notes: ConfidenceNote[];
  generatedAt: string;
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
  root_cause_candidates: [],
  pain_type_map: [],
  trust_gap_map: [],
  mechanism_gap_hints: [],
  proof_need_hints: [],
  strategic_angle_candidates: [],
  contradiction_flags: [],
  confidence_notes: [],
  generatedAt: new Date().toISOString(),
  inputSummary: {
    hasMI: false,
    hasAudience: false,
    hasProductDNA: false,
    hasCompetitiveData: false,
    signalCount: 0,
  },
};
