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
  | "HUMAN_REVIEW_REQUIRED"       // System judgement: principal-level decision exceeds automation envelope
  // Phase R (May 2026) reliability/truthfulness modes
  | "SYSTEM_UNTRUSTED"            // Pipeline incomplete / stale / timed out — verdict cannot be trusted, no execution
  | "NEEDS_RECONCILIATION";       // Cross-engine contradiction unresolved — manual reconciliation required

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
  | "BUDGET_OVERRIDE_ZERO_CONFIDENCE"
  // Phase R reliability blocks
  | "PIPELINE_INCOMPLETE"           // one or more required checks could not be evaluated (NOT_REACHED/TIMEOUT/STALE/UNKNOWN)
  | "STALE_SNAPSHOT_EVIDENCE"       // a check was forced to use a snapshot from a prior run
  | "ENGINE_TIMEOUT"                // a critical engine timed out and downstream cannot be evaluated
  | "UNRESOLVED_CONTRADICTION"      // cross-engine contradiction with no auto-resolution path
  // Runtime Truth Track (May 2026)
  | "ANALYTICAL_ENRICHMENT_PARTIAL" // T3.B — AEL built with degraded data (parse failure / build error / partial LLM)
  | "SIGNAL_LINEAGE_UNKNOWN_DOMINANT" // T1.A — unknownRatio > 0.30 (untagged/legacy signals dominate strategy)
  | "CONFIDENCE_INTEGRITY_INCOMPLETE"; // T3.A v2 — a critical engine emitted no confidence at all

export type DowngradeCode =
  | "UNVERIFIED_CAC"
  | "WEAK_FUNNEL_FOR_SCALE"
  | "LOW_SIGNAL_TRUST"
  | "INTEGRITY_PARTIAL"
  | "CROSS_ENGINE_CONTRADICTIONS"
  // Runtime Truth Track (May 2026)
  | "ANALYTICAL_ENRICHMENT_DEGRADED" // T3.B downgrade companion when AEL partial but other gates pass
  | "LINEAGE_UNTRUSTED"               // T1.A downgrade companion when unknownRatio > threshold but composition still has some real ratio
  | "CONFIDENCE_INTEGRITY_DEGRADED";  // T3.A v2 downgrade when default_floor / inferred_synthesis present on the chain (no critical absence)

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

/**
 * Reliability-grade status for a structural check. Replaces the previous
 * boolean `passed` semantics where "skipped because data missing" was
 * indistinguishable from "passed because data is good."
 *
 * Semantic rules:
 *   - PASS         → check ran and the system genuinely satisfies the rule
 *   - FAIL         → check ran and the system violates the rule
 *   - BLOCK        → check ran and discovered a hard block
 *   - SKIPPED      → check chose not to run (e.g. not applicable to this state)
 *   - NOT_REACHED  → upstream engine did not produce required input
 *   - TIMEOUT      → upstream engine timed out before producing input
 *   - STALE        → only stale (prior-run) data was available
 *   - UNKNOWN      → required data is missing in a way we cannot classify
 *
 * Only `status === "PASS"` counts toward checksPassed in any verdict logic.
 * Any of {NOT_REACHED, TIMEOUT, STALE, UNKNOWN} renders the verdict
 * untrustworthy and triggers PIPELINE_INCOMPLETE / SYSTEM_UNTRUSTED.
 */
export type CheckStatus =
  | "PASS"
  | "FAIL"
  | "BLOCK"
  | "SKIPPED"
  | "NOT_REACHED"
  | "TIMEOUT"
  | "STALE"
  | "UNKNOWN";

export interface StructuralCheck {
  check: string;
  /** True iff status === "PASS". Kept for backwards-compat readers, but verdict logic must use `status`. */
  passed: boolean;
  /** Reliability-grade status. Only "PASS" counts as passed. */
  status: CheckStatus;
  details: string;
  /** Optional human-readable reason the check could not be verified (NOT_REACHED/TIMEOUT/STALE/UNKNOWN). */
  unverifiedReason?: string;
}

/**
 * Statuses that mean "this check did not actually verify the system."
 *
 * Note SKIPPED is included: if an applicability gate skipped the check we
 * cannot truthfully claim the system passes the underlying rule, so SKIPPED
 * must block a confident PASS verdict the same way NOT_REACHED/TIMEOUT do.
 * If a check is genuinely vacuously-satisfied (e.g. "no objections were
 * declared so coverage is trivially complete") it must return PASS, not
 * SKIPPED — see structural-checks.ts:skipped() for the contract.
 */
export const UNVERIFIED_STATUSES: ReadonlyArray<CheckStatus> = [
  "NOT_REACHED",
  "TIMEOUT",
  "STALE",
  "UNKNOWN",
  "SKIPPED",
];

/** Type guard: did this check actually verify the system passes the rule? */
export function isVerifiedPass(c: StructuralCheck): boolean {
  return c.status === "PASS";
}

/** Type guard: did this check actually verify the system FAILS the rule? */
export function isVerifiedFail(c: StructuralCheck): boolean {
  return c.status === "FAIL" || c.status === "BLOCK";
}

/** Type guard: was this check unable to verify the system either way? */
export function isUnverified(c: StructuralCheck): boolean {
  return UNVERIFIED_STATUSES.includes(c.status);
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
  | "FLAG_FOR_REVIEW"
  // v1 Actionable Block Recovery (May 2026) — pure-mutation repairs.
  // Single-pass, idempotent, provenance-stamped, downgrade-only,
  // risk-reducing only. No engine reruns. No retry loops.
  | "CAP_CONFIDENCE_AT_FLOOR_PLUS_DELTA"
  | "CLAMP_TO_LOWER_CONFIDENCE"
  | "FORCE_BUDGET_HOLD_ON_ZERO_FLOOR"
  | "MODE_DOWNGRADE_TO_CHANNEL_VALIDATION";

export interface RepairAction {
  code: RepairActionCode;
  targetBlock: BlockCode;
  description: string;
  safe: boolean;
  executed: boolean;
  succeeded: boolean;
  detail: string;
  /**
   * Optional execution-mode hint emitted by repair handlers that resolve a
   * block via mode flip rather than data mutation (e.g. channel-confidence
   * → CHANNEL_VALIDATION_REQUIRED). Verdict synthesis prefers this when the
   * resolved-block path lands in REPAIR/DOWNGRADE.
   */
  modeHint?: ExecutionMode;
}

/**
 * Who can resolve a given block code at runtime.
 *
 *   - "system"   → repair is wired (or could be re-executed by the system without
 *                  external action) and operationally addressable in-platform
 *   - "user"     → human review / decision required (HUMAN_REVIEW_REQUIRED path)
 *   - "external" → real-world data acquisition required (proof collection,
 *                  validation window, MI refresh) — neither system nor user
 *                  can resolve at runtime
 */
export type ResolverActor = "system" | "user" | "external";

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
  /**
   * v1 Actionable Block Recovery (May 2026): is this block safely repairable
   * inside `evaluateSystemControl()` at runtime? Derived from the static
   * recovery-map declaration — never inferred per-run. Drives UI affordance:
   * `true` → "Auto-resolve" / pre-applied; `false` → manual recovery path.
   */
  retrySafe: boolean;
  /**
   * v1 Actionable Block Recovery (May 2026): who can resolve this block? Lifts
   * the previously-plan-level `humanReviewNeeded` boolean to per-issue
   * granularity so a stuck user can see for each block whether the system,
   * the user, or external data acquisition is required.
   */
  resolverActor: ResolverActor;
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

/**
 * Phase R T002 — provenance attached to a hydrated engine output when System
 * Control needs to decide whether the result is fresh-from-this-run or a
 * reused snapshot from a prior run.
 *
 * Set by snapshot-reuse.ts:safeReuse() on every reuse hit. When absent, the
 * result is assumed to come from a fresh in-run engine execution and freshness
 * is not in question.
 */
export interface SnapshotProvenance {
  /** jobId stamped on the snapshot row at the time it was originally written. */
  sourceJobId: string | null;
  /** Snapshot row id (for traceability). */
  sourceSnapshotId: string;
  /** ISO timestamp the snapshot was originally written. */
  createdAt: string | null;
  /** True iff the engine did not run this round; the result was loaded from cache. */
  wasReused: boolean;
  /** snapshot-trust freshness classification (FRESH/AGING/NEEDS_REFRESH/...) */
  freshnessClass?: string;
  /** Snapshot age in days at the moment the verdict is being computed. */
  ageInDays?: number;
}

export interface SystemControlInput {
  results: Map<EngineId, EngineStepResult>;
  integrityReport: IntegrityReport | null;
  celResults: ComplianceResult[];
  signalComposition: SignalComposition | null;
  sglCoverageSufficient: boolean | null;
  ssc: SharedStrategicContext | null;
  /**
   * T3.B (Runtime Truth Track) — AEL partial-build flag propagated from
   * orchestrator. When `true`, the analytical-enrichment package was built
   * with degraded data (parse failure, build error, or LLM partial response)
   * and `analyticalEnrichmentReason` carries the reason. Pre-T3.B this only
   * surfaced as a console.warn (`AEL_PARTIAL`); now it MUST drive a
   * deterministic execution-mode downgrade in System Control so downstream
   * engines never silently consume incomplete enrichment for live decisions.
   */
  analyticalEnrichmentPartial?: boolean;
  analyticalEnrichmentReason?: string | null;
  /**
   * T1.A (Runtime Truth Track) — pre-aggregated lineage observations from
   * the orchestrator's signal-composition build pass. When `unknownRatio` is
   * present and exceeds the lineage threshold, System Control surfaces it as
   * a structural FAIL instead of treating untagged signals as benign noise.
   */
  signalCompositionUnknownThresholdHit?: boolean;
  /**
   * T3.A v2 (Runtime Truth Track) — runtime confidence-integrity verdict
   * computed by `summarizeConfidenceIntegrity()` over the per-engine
   * provenance log. Pre-v2 this was returned on the orchestrator response
   * but never consulted by `evaluateSystemControl`, so the verdict was
   * observational only. Now System Control hard-gates on it:
   *   - "INCOMPLETE" (a critical engine emitted no confidence at all) →
   *      blockReason `CONFIDENCE_INTEGRITY_INCOMPLETE`, verdict BLOCK
   *   - "DEGRADED"   (any default_floor / inferred_synthesis on the chain) →
   *      downgrade `CONFIDENCE_INTEGRITY_DEGRADED`, verdict DOWNGRADE
   *   - "COMPLETE" or absent → no-op
   */
  confidenceIntegrityVerdict?: "COMPLETE" | "DEGRADED" | "INCOMPLETE" | null;
  confidenceIntegrityCriticalAbsent?: string[];
  confidenceIntegrityDegradedEngines?: string[];
  config: {
    campaignId: string;
    accountId: string;
    /**
     * Phase R T002 — the jobId for the run currently being evaluated. Required
     * for `checkSnapshotFreshness` to detect engine outputs whose snapshot row
     * carries a different sourceJobId (i.e. result silently reused from a
     * prior run). When null/undefined, freshness check is skipped (legacy
     * callers that have not been migrated yet).
     */
    currentJobId?: string | null;
  };
}
