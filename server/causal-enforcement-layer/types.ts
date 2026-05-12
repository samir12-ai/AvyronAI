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
  /**
   * Seal #8 / F3.5 — explicit verdict so downstream callers can distinguish
   * a legitimate PASS/FAIL evaluation from "we could not evaluate at all"
   * (e.g. AEL missing). INCOMPLETE is treated as a hard fail by gates that
   * require positive confirmation.
   */
  verdict?: "PASS" | "FAIL" | "INCOMPLETE";
  score: number;
  violations: ComplianceViolation[];
  appliedRules: string[];
  rootCausesEvaluated: number;
  enforcementLog: string[];
}

export interface ComplianceViolation {
  ruleId: string;
  violationType: "generic_fallback" | "causal_mismatch" | "blocked_pattern" | "missing_alignment" | "missing_root_cause" | "missing_causal_chain" | "generic_without_justification" | "shallow_reasoning" | "theme_misalignment";
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
