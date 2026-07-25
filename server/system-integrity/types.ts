export interface EngineIntegrityCheck {
  engineId: string;
  status: "PASS" | "FAIL" | "SKIPPED" | "BLOCKED";
  receivedValidSignals: boolean;
  outputTraceable: boolean;
  signalMappingComplete: boolean;
  noRawDataPassthrough: boolean;
  alignedWithUpstream: boolean;
  leakageDetected: boolean;
  orphanOutputs: string[];
  details: string[];
}

export interface CrossEngineAlignmentCheck {
  sourceEngine: string;
  targetEngine: string;
  aligned: boolean;
  alignmentScore: number;
  mismatches: string[];
}

export interface IntegrityReport {
  reportId: string;
  timestamp: string;
  /**
   * Legacy integrity VERDICT (PASS|PARTIAL|FAIL). Retained for back-compat
   * with the FE SystemIntegrityPanel + existing snapshot rows. Carries the
   * same value as `integrityVerdict` during the transition window.
   * @deprecated Prefer `integrityVerdict` — D4 forbids reading this field
   * on any live verdict path; system-control reads MUST go through
   * `requireIntegrityVerdict()`.
   */
  overallStatus: "PASS" | "FAIL" | "PARTIAL";
  /**
   * Phase 3 (Task #66) — canonical integrity VERDICT field. Read via
   * `server/system-control/integrity-verdict.ts::requireIntegrityVerdict`.
   * Mirrors `overallStatus` during the transition window so existing
   * persisted reports and the FE remain compatible while live decision
   * paths cut over to the canonical field name.
   */
  integrityVerdict: "PASS" | "FAIL" | "PARTIAL";
  engineChecks: EngineIntegrityCheck[];
  crossEngineAlignment: CrossEngineAlignmentCheck[];
  signalFlowVerified: boolean;
  traceabilityComplete: boolean;
  zeroLeakage: boolean;
  noOrphanOutputs: boolean;
  signalCoverageComplete: boolean;
  summary: string;
  failureReasons: string[];
  sglTraceToken: string | null;
}
