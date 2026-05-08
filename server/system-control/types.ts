import type { EngineId, EngineStepResult } from "../orchestrator/priority-matrix";
import type { IntegrityReport } from "../system-integrity/types";
import type { ComplianceResult } from "../causal-enforcement-layer/engine";
import type { SignalComposition } from "../shared/signal-lineage";
import type { SharedStrategicContext } from "../orchestrator/shared-strategic-context";

export type SystemVerdict = "PASS" | "DOWNGRADE" | "REPAIR" | "BLOCK";

export type ExecutionMode =
  | "FULL_EXECUTION"
  | "RESTRICTED_EXECUTION"
  | "TEST_ONLY"
  | "REVIEW_REQUIRED"
  | "HALTED"
  // Phase 2 (May 2026) marketing-intelligence-grade modes
  | "LIMITED_SPEND"               // Budget Governor commercial fallback — small fixed-spend learning loop
  | "PROOF_COLLECTION"            // StatVal commercial fallback — execution suspended pending proof harvest
  | "CHANNEL_VALIDATION_REQUIRED" // Channel Selection commercial fallback — pilot single channel before scaling
  | "AWARENESS_BUILD_PHASE"       // System judgement: market not ready for conversion-grade execution
  | "HUMAN_REVIEW_REQUIRED";      // System judgement: principal-level decision exceeds automation envelope

export type BlockCode =
  | "NO_CONVERSION_PATH"
  | "SCALE_WITHOUT_REAL_DATA"
  | "INTEGRITY_FAILURE"
  | "COMPLIANCE_FAILURE"
  | "BUDGET_KILL"
  | "BUDGET_HALT"
  | "VALIDATION_REJECTED"
  | "SIGNAL_GROUNDING_MASS_FAILURE"
  | "OFFER_AUDIENCE_MISALIGNMENT"
  | "ZERO_OBJECTION_COVERAGE"
  | "CHANNEL_CONFIDENCE_BELOW_MINIMUM"
  | "UNRESOLVED_CRITICAL_PROBLEMS"
  | "CONFIDENCE_CHAIN_VIOLATION"
  | "POSITIONING_HARD_GATE"
  | "CONFIDENCE_SPREAD_EXCESSIVE"
  | "BUDGET_OVERRIDE_ZERO_CONFIDENCE";

export type DowngradeCode =
  | "UNVERIFIED_CAC"
  | "WEAK_FUNNEL_FOR_SCALE"
  | "LOW_SIGNAL_TRUST"
  | "INTEGRITY_PARTIAL"
  | "CROSS_ENGINE_CONTRADICTIONS";

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

export type RootCauseCategory =
  | "strategy_issue"
  | "offer_issue"
  | "funnel_issue"
  | "channel_issue"
  | "proof_issue"
  | "audience_mismatch"
  | "validation_issue"
  | "budget_risk"
  | "system_parser_issue"
  | "data_insufficiency";

export interface RecoveryIssue {
  blockCode: BlockCode | "UNKNOWN_BLOCK";
  rootCauseCategory: RootCauseCategory;
  ownerEngine: string;
  diagnosis: string;
  repairAction: string;
  successCriteria: string;
  requiredProof: string[];
  nextPossibleMode: ExecutionMode;
  priority: number;
  severity: "critical" | "high";
  source: "deterministic" | "llm_enriched";
}

/**
 * The named commercial disease pattern surfaced by the Recovery Intelligence
 * layer. Names the underlying disease behind multiple block-code symptoms.
 */
export type CommercialDisease =
  | "demand_without_delivery"        // MI sees demand, downstream cannot capture it
  | "proof_gap"                      // claims outpace evidence; validation cannot ground
  | "trust_gap"                      // buyer doesn't extend trust to the offer / brand
  | "offer_audience_mismatch"        // offer shape doesn't match buyer psychology
  | "funnel_conversion_gap"          // architecture missing a working conversion bridge
  | "channel_market_mismatch"        // chosen channels can't reach this buyer profitably
  | "validation_deficit"             // not enough real signal to make confident calls
  | "budget_risk_uncertainty"        // unit economics unclear; spending blindly
  | "execution_readiness_gap"        // strategy ahead of operational readiness
  | "category_position_collapse"     // positioning hasn't earned its game
  | "system_data_insufficiency"      // can't reason — upstream signals too thin
  | "unknown_disease";               // pattern doesn't match a known disease

export interface CausalDiagnosisStep {
  cause: string;
  symptom: string;
  downstreamEffect: string;
  repair: string;
  evidenceCitations?: string[];
}

/**
 * Strategist enrichment overlay produced by the Recovery Intelligence layer.
 * Sits ON TOP of the deterministic recovery plan — does not replace it.
 * Null when enrichment is unavailable / rejected by judge / unsafe to ship.
 */
export interface RecoveryIntelligence {
  commercialDisease: CommercialDisease;
  diseaseStatement: string;                // one-sentence plain-English diagnosis
  causalDiagnosis: CausalDiagnosisStep[];  // cause → symptom → effect → repair chain
  strategicRecoveryThesis: string;         // the principal's recovery thesis (1–2 sentences)
  priorityLogic: string;                   // why this order — causal not symptomatic
  highestLeverageFix: string;              // the single move that unlocks the most blocks
  buyerPsychologyConstraint: string;       // dominant buyer constraint blocking conversion
  nextModeRationale: string;               // why the recommended next mode is correct

  // Lineage / audit
  judgeVerdict: "ACCEPTED" | "REJECTED" | "NOT_RUN";
  judgeReason?: string;
  retryCount: number;
  modelUsed: string;
  generatedAt: string;
  upstreamSignalsUsed: string[];           // engine names whose data grounded the diagnosis
}

export interface RecoveryPlan {
  currentVerdict: SystemVerdict;
  currentExecutionMode: ExecutionMode;
  blockCodes: (BlockCode | "UNKNOWN_BLOCK")[];
  rootCauseSummary: string;
  issues: RecoveryIssue[];
  priorityOrder: (BlockCode | "UNKNOWN_BLOCK")[];
  globalRecoveryPlan: string[];
  rerunRequirements: string[];
  humanReviewNeeded: boolean;
  generatedAt: string;
  source: "deterministic" | "llm_enriched" | "fallback";
  enrichmentNote?: string;
  /** Strategist-grade enrichment overlay; null when unavailable. */
  intelligence?: RecoveryIntelligence | null;
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
  commercialJudgement?: import("./system-judgement").SystemJudgement | null;
  recoveryPlan?: RecoveryPlan | null;
}

export interface SystemControlInput {
  results: Map<EngineId, EngineStepResult>;
  integrityReport: IntegrityReport | null;
  celResults: ComplianceResult[];
  signalComposition: SignalComposition | null;
  sglCoverageSufficient: boolean | null;
  ssc: SharedStrategicContext | null;
  config: {
    campaignId: string;
    accountId: string;
  };
}
