export interface DataReliabilityDiagnostics {
  signalDensity: number;
  signalDiversity: number;
  narrativeStability: number;
  competitorValidity: number;
  marketMaturityConfidence: number;
  overallReliability: number;
  isWeak: boolean;
  advisories: string[];
}

export interface BoundaryCheckResult {
  clean: boolean;
  violations: string[];
}

export interface SignalDiagnostics {
  engineName: string;
  postsProcessed: number;
  signalsDetected: number;
  signalsFiltered: number;
  signalsUsed: number;
  timestamp: number;
}

export interface NarrativeOverlapResult {
  overlapDetected: boolean;
  overlapScore: number;
  duplicateNarratives: string[];
  saturationPenalty: number;
  warnings: string[];
}

export interface ValidationSession {
  sessionId: string;
  campaignId: string;
  engineCalls: Record<string, number>;
  createdAt: number;
}

export interface GenericOutputResult {
  genericDetected: boolean;
  genericPhrases: string[];
  penalty: number;
}

export interface AlignmentCheckResult {
  aligned: boolean;
  misalignments: string[];
  confidencePenalty: number;
}

export interface SoftPattern {
  pattern: RegExp;
  domain: string;
  replacement: string;
}

export interface BoundaryEnforcementResult {
  clean: boolean;
  violations: string[];
  sanitized: boolean;
  sanitizedText: string;
  warnings: string[];
}
