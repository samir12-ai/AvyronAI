export interface IntegrityPositioningInput {
  territories: any[];
  enemyDefinition: string | null;
  contrastAxis: string | null;
  narrativeDirection: string | null;
  confidenceScore: number | null;
}

export interface MechanismCore {
  mechanismName: string;
  mechanismType: "method" | "system" | "protocol" | "framework" | "none";
  mechanismSteps: string[];
  mechanismPromise: string;
  mechanismProblem: string;
  mechanismLogic: string;
}

export interface IntegrityDifferentiationInput {
  pillars: any[];
  mechanismFraming: any;
  mechanismCore: MechanismCore | null;
  authorityMode: string | null;
  claimStructures: any[];
  proofArchitecture: any[];
  confidenceScore: number | null;
}

export interface IntegrityAudienceInput {
  objectionMap: Record<string, any>;
  emotionalDrivers: any[];
  maturityIndex: number | null;
  awarenessLevel: string | null;
  audiencePains: any[];
  desireMap: Record<string, any>;
  audienceSegments: any[];
}

export interface IntegrityOfferInput {
  offerName: string;
  coreOutcome: string;
  mechanismDescription: string;
  deliverables: string[];
  proofAlignment: string[];
  offerStrengthScore: number;
  riskNotes: string[];
  completeness: { complete: boolean; missingLayers: string[] };
  genericFlag: boolean;
  frictionLevel: number;
}

export interface IntegrityFunnelInput {
  funnelName: string;
  funnelType: string;
  stageMap: any[];
  trustPath: any[];
  proofPlacements: any[];
  commitmentLevel: string;
  frictionMap: any[];
  entryTrigger: { mechanismType: string; purpose: string };
  funnelStrengthScore: number;
  compressionApplied: boolean;
}

export interface IntegrityMIInput {
  marketDiagnosis: string | null;
  overallConfidence: number;
  opportunitySignals: any[];
  threatSignals: any[];
}

/**
 * Per-layer evaluation state — Phase 1 / CLP-15 (May 2026, intelligence
 * hardening). D3 strict-enum, D5 no silent substitution.
 *
 *   EVALUATED              — layer had its required upstream inputs and ran.
 *                            `passed` and `score` are meaningful.
 *   INSUFFICIENT_EVIDENCE  — one or more prerequisite upstream snapshots
 *                            were missing (e.g. positioning_snapshot_id=N/A).
 *                            `passed: null`, `score: null`. NEVER `passed:true`.
 *   DEPENDENCY_CRASHED     — a prerequisite engine crashed mid-run; this
 *                            layer's evaluation is not safe to attempt.
 */
export type LayerEvaluationState =
  | "EVALUATED"
  | "INSUFFICIENT_EVIDENCE"
  | "DEPENDENCY_CRASHED";

export interface LayerResult {
  layerName: string;
  /**
   * `null` when `evaluationState !== "EVALUATED"`. Consumers MUST require
   * the compound check `passed === true && evaluationState === "EVALUATED"`
   * before treating the layer as a green signal.
   */
  passed: boolean | null;
  /**
   * `null` when `evaluationState !== "EVALUATED"`. Excluded from
   * `overall_integrity_score` numerator AND denominator in that case.
   */
  score: number | null;
  findings: string[];
  warnings: string[];
  /**
   * Evaluation state — required field (D2/D3).
   */
  evaluationState: LayerEvaluationState;
  /**
   * Populated when `evaluationState === "INSUFFICIENT_EVIDENCE"`. Names the
   * upstream snapshots / inputs that were missing or empty.
   */
  missingDeps?: string[];
  /**
   * Phase 3 (Task #66) — typed cross-engine contradictions emitted by
   * this layer. Consumed by system-control via the shared dedupe
   * pipeline (`server/shared/contradictions.ts::dedupeContradictions`).
   * Optional during the migration window — layers that have not yet
   * been converted from string warnings emit `undefined`.
   */
  contradictions?: import("../shared/contradictions").Contradiction[];
}

export interface IntegrityResult {
  /**
   * Engine-execution status: COMPLETE | INTEGRITY_FAILED |
   * INSUFFICIENT_LAYER_COVERAGE. NOT a verdict.
   *
   * `INSUFFICIENT_LAYER_COVERAGE` (Phase 1 / CLP-15, May 2026) fires when
   * fewer than `MIN_EVALUATED_BASE_LAYERS` of the seven base layers were
   * EVALUATED — `safeToExecute` is forced to `false` in that case.
   */
  status: string;
  /**
   * CLP-15 — count of layers whose `evaluationState === "EVALUATED"`.
   * Excludes INSUFFICIENT_EVIDENCE and DEPENDENCY_CRASHED.
   */
  evaluatedLayerCount?: number;
  /** CLP-15 — count of layers whose evaluationState !== "EVALUATED". */
  insufficientLayerCount?: number;
  /**
   * CLP-15 — names of upstream snapshots / inputs that were missing across
   * any INSUFFICIENT_EVIDENCE layers. De-duplicated. Empty array when all
   * layers evaluated.
   */
  missingPrerequisites?: string[];
  /**
   * Legacy integrity VERDICT field (PASS|PARTIAL|FAIL). Retained for back-compat
   * with the FE SystemIntegrityPanel and existing snapshot rows.
   * @deprecated Prefer `integrityVerdict` (H4, 2026-05-10). Both fields carry
   * the same value during the transition period.
   */
  overallStatus: "PASS" | "PARTIAL" | "FAIL";
  /**
   * Canonical integrity VERDICT (PASS|PARTIAL|FAIL) under a semantically-explicit
   * name. Distinct from the engine-execution `status` field. No legacy fallback —
   * see registry.ts INTEGRITY_CONTRACT (H4, 2026-05-10).
   */
  integrityVerdict: "PASS" | "PARTIAL" | "FAIL";
  statusMessage: string | null;
  overallIntegrityScore: number;
  safeToExecute: boolean;
  failureReasons: string[];
  zeroLeakage: boolean;
  traceabilityComplete: boolean;
  layerResults: LayerResult[];
  structuralWarnings: string[];
  flaggedInconsistencies: string[];
  boundaryCheck: { passed: boolean; violations: string[] };
  executionTimeMs: number;
  engineVersion: number;
  layerDiagnostics: Record<string, any>;
}
