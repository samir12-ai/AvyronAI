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
  overallStatus: "PASS" | "FAIL" | "PARTIAL";
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
