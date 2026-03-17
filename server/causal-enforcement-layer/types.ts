export interface CausalConstraintRule {
  id: string;
  rootCausePattern: RegExp;
  requiredAxisPatterns: RegExp[];
  blockedAxisPatterns: RegExp[];
  description: string;
}

export interface ComplianceResult {
  engineId: string;
  passed: boolean;
  score: number;
  violations: ComplianceViolation[];
  appliedRules: string[];
  rootCausesEvaluated: number;
  enforcementLog: string[];
}

export interface ComplianceViolation {
  ruleId: string;
  violationType: "generic_fallback" | "causal_mismatch" | "blocked_pattern" | "missing_alignment";
  severity: "blocking" | "major" | "minor";
  details: string;
  rootCause: string;
  engineOutput: string;
  requiredDirection: string;
}

export interface CELReport {
  timestamp: string;
  campaignId: string;
  aelVersion: number;
  engineResults: ComplianceResult[];
  overallScore: number;
  overallPassed: boolean;
  summary: string;
}
