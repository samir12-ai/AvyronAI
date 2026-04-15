import type { EngineId, EngineStepResult } from "../orchestrator/priority-matrix";
import type { IntegrityReport } from "../system-integrity/types";
import type { ComplianceResult } from "../causal-enforcement-layer/engine";
import type { SignalComposition } from "../shared/signal-lineage";

export type SystemVerdict = "PASS" | "DOWNGRADE" | "REPAIR" | "BLOCK";

export type ExecutionMode =
  | "FULL_EXECUTION"
  | "RESTRICTED_EXECUTION"
  | "TEST_ONLY"
  | "REVIEW_REQUIRED"
  | "HALTED";

export type BlockCode =
  | "NO_CONVERSION_PATH"
  | "SCALE_WITHOUT_REAL_DATA"
  | "INTEGRITY_FAILURE"
  | "COMPLIANCE_FAILURE"
  | "BUDGET_KILL"
  | "BUDGET_HALT";

export type DowngradeCode =
  | "UNVERIFIED_CAC"
  | "WEAK_FUNNEL_FOR_SCALE"
  | "LOW_SIGNAL_TRUST"
  | "INTEGRITY_PARTIAL";

export type ReviewCode =
  | "SYNTHESIS_DRIFT"
  | "CAC_DEVIATION"
  | "ASSUMPTION_RISK"
  | "STRUCTURAL_WEAKNESS";

export interface BlockReason {
  code: BlockCode;
  description: string;
  source: string;
  severity: "critical" | "high";
}

export interface Downgrade {
  from: string;
  to: string;
  reason: string;
  code: DowngradeCode;
  affectedEngine: string;
}

export interface StructuralCheck {
  check: string;
  passed: boolean;
  details: string;
}

export interface Contradiction {
  engineA: string;
  engineB: string;
  description: string;
  resolution: string;
}

export type RepairActionCode =
  | "INJECT_FALLBACK_CONVERSION"
  | "DOWNGRADE_SCALE_TO_TEST"
  | "REVALIDATE_INTEGRITY"
  | "FLAG_FOR_REVIEW";

export interface RepairAction {
  code: RepairActionCode;
  targetBlock: BlockCode;
  description: string;
  safe: boolean;
  executed: boolean;
  succeeded: boolean;
  detail: string;
}

export interface SystemControlVerdict {
  verdict: SystemVerdict;
  executionMode: ExecutionMode;
  blockReasons: BlockReason[];
  downgrades: Downgrade[];
  structuralChecks: StructuralCheck[];
  contradictions: Contradiction[];
  repairActions: RepairAction[];
  repairAttempted: boolean;
  timestamp: Date;
  durationMs: number;
  controlVersion: string;
  shadowMode: boolean;
}

export interface SystemControlInput {
  results: Map<EngineId, EngineStepResult>;
  integrityReport: IntegrityReport | null;
  celResults: ComplianceResult[];
  signalComposition: SignalComposition | null;
  sglCoverageSufficient: boolean | null;
  config: {
    campaignId: string;
    accountId: string;
  };
}
