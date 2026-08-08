import type {
  StrategicDoctrine,
  EngineDecisionSummary,
} from "../shared/strategic-doctrine";

type EngineId =
  | "market_intelligence"
  | "audience"
  | "positioning"
  | "differentiation"
  | "mechanism"
  | "offer"
  | "awareness"
  | "funnel"
  | "integrity"
  | "persuasion"
  | "statistical_validation"
  | "budget_governor"
  | "channel_selection"
  | "iteration"
  | "retention";

export type ProblemType =
  | "market"
  | "audience"
  | "structural"
  | "conversion"
  | "trust"
  | "alignment";

export type ProblemSeverity = "critical" | "high" | "medium" | "low";

export type ProblemStatus = "open" | "resolved" | "deferred" | "cannot_resolve";

export interface ProblemEntry {
  id: string;
  sourceEngine: EngineId;
  type: ProblemType;
  description: string;
  severity: ProblemSeverity;
  confidence: number;
  status: ProblemStatus;
  resolvedBy?: EngineId;
  resolvedAction?: string;
  deferredBy?: EngineId;
  deferredReason?: string;
  cannotResolveBy?: EngineId;
  cannotResolveReason?: string;
  discoveredAt: number;
  relevantEngines: EngineId[];
}

export interface ReasonTraceEntry {
  engineId: EngineId;
  signal: string;
  interpretation: string;
  constraint: string;
  decision: string;
  confidence: number;
  upstreamRef?: string;
}

export interface ConfidenceChainEntry {
  engineId: EngineId;
  dataConfidence: number;
  engineConfidence: number;
  combinedConfidence: number;
  localCombined: number;
  inheritedFloor: number;
}

export interface PainMapEntry {
  canonical: string;
  sourceSignal: string;
  frequency: number;
  severity: number;
}

export interface DesireMapEntry {
  canonical: string;
  sourceSignal: string;
  intensity: number;
}

export interface ObjectionMapEntry {
  canonical: string;
  sourceSignal: string;
  severity: number;
  addressed: boolean;
  addressedBy?: EngineId;
}

export interface TrustAssessment {
  level: "none" | "low" | "moderate" | "high";
  barriers: string[];
  proofRequired: boolean;
  educationRequired: boolean;
}

export interface NarrativeConstraint {
  sourceEngine: EngineId;
  constraint: string;
  lockedAt: number;
}

export interface ContradictionEntry {
  id: string;
  engineA: EngineId;
  engineB: EngineId;
  description: string;
  severity: ProblemSeverity;
  discoveredAt: number;
}

export interface DownstreamRequirement {
  requiredBy: EngineId;
  requirement: string;
  satisfied: boolean;
  satisfiedBy?: EngineId;
}

/**
 * COMMERCIAL SIGNALS REGISTRY — the new cross-engine signal map.
 * Each engine emits its commercial-reasoning signal into the SSC; downstream
 * engines read from here when reasoning. Distinct from problem registry
 * (which tracks open issues) and reasonTrace (which logs decisions).
 *
 * Pipeline-flow direction (upstream → downstream consumers):
 *   audience.buyerPsychology → consumed by positioning, offer, awareness, persuasion
 *   positioning.gameDimension → consumed by offer, awareness, persuasion
 *   offer.valueArchitecture   → consumed by awareness, persuasion
 *   awareness.narrativeReframe → consumed by persuasion
 *   persuasion.trustMechanism → consumed by downstream content/funnel/channel engines
 */
export interface TrustMechanismSignal {
  buyerRiskState: string;
  riskSeverity: "low" | "moderate" | "high" | "critical";
  trustDeficit: string;
  transferMechanism: string;
  proofArtifact: string;
  commercialFunction: string;
  judgeVerdict: "ACCEPTED" | "REJECTED" | "NOT_RUN";
  emittedAt: number;
}

export interface GameDimensionSignal {
  buyerActualGame: string;
  competitorGames: Array<{ name: string; dimension: string; trapForUs: string }>;
  ourDimension: string;
  ourGame: string;
  defensibility: string;
  defensibilityProof: string;
  judgeVerdict: "ACCEPTED" | "REJECTED" | "NOT_RUN";
  emittedAt: number;
}

export interface ValueArchitectureSignal {
  primaryValueWedge: string;
  identityShift: { fromIdentity: string; toIdentity: string; identityCost: string };
  commercialLeverage: { pointInChain: "feature" | "functional" | "emotional" | "identity"; leverageMechanism: string; leverageProof: string };
  topObjectionEconomics: Array<{ objection: string; revenueAtStakeIfUnresolved: string; neutralizingMechanism: string; costOfNeutralizing: string }>;
  groundedInTrustMechanism: string | null;
  groundedInGameDimension: string | null;
  judgeVerdict: "ACCEPTED" | "REJECTED" | "NOT_RUN";
  emittedAt: number;
}

export interface BuyerPsychologySignal {
  beliefModel: { aboutCategory: string; aboutThemselves: string; aboutAlternatives: string };
  topRejectionPatterns: string[];      // patterns the buyer reflexively rejects
  decisionTrigger: { triggeringEvent: string; timeWindow: string; consequenceIfNotResolved: string };
  identityAspiration: { currentIdentityFelt: string; aspirationalIdentity: string; publicProofTheyAchieved: string };
  sophisticationTier: 1 | 2 | 3 | 4 | 5;
  cialdiniLeverages: string[];          // 1-2 principles psychology-matched
  segmentName: string;                  // which segment this profile is for
  judgeVerdict: "ACCEPTED" | "REJECTED" | "NOT_RUN";
  emittedAt: number;
}

export interface NarrativeReframeSignal {
  currentModelStatement: string;
  newModelReclassification: string;
  namedPrinciple: string;
  bridgeMovement: "analogy" | "first_principle" | "decisive_evidence" | "status_reframe" | "category_re_assignment";
  specificMove: string;
  discomfortCost: { privateAdmission: string; statusGivenUp: string };
  groundedInBuyerBeliefModel: boolean;
  groundedInTrustMechanism: boolean;
  groundedInGameDimension: boolean;
  judgeVerdict: "ACCEPTED" | "REJECTED" | "NOT_RUN";
  emittedAt: number;
}

// ─── Phase 2 (May 2026) downstream commercial signals ───
// Emitted by the 6 downstream commercial-decision engines AFTER the 5 strategic
// engines. These signals project per-engine commercial reasoning into the SSC
// so the System Control layer (and any future cross-engine consumer) can reason
// about the full commercial DNA, not just per-engine outputs.

export interface ValidationQualitySignal {
  validationState: "validated" | "provisional" | "weak" | "rejected";
  evidenceStrength: number;
  signalBackedClaimRatio: number;
  commercialUsability: "usable_for_scale" | "usable_for_test" | "usable_for_learning_only" | "not_usable";
  topTrustGaps: string[];
  whatWouldUnlockNextTier: string;
  judgeVerdict: "ACCEPTED" | "REJECTED" | "NOT_RUN";
  emittedAt: number;
}

export interface BudgetStrategySignal {
  action: "test" | "scale" | "hold" | "halt";
  spendPace: "aggressive" | "measured" | "cautious" | "frozen";
  learningBudgetCarveOutPct: number;
  capitalEfficiencyAssessment: string;
  killTriggerThreshold: string;
  expansionPrecondition: string;
  judgeVerdict: "ACCEPTED" | "REJECTED" | "NOT_RUN";
  emittedAt: number;
}

export interface ChannelOrchestrationSignal {
  primaryChannel: string;
  secondaryChannel: string;
  marketEntryPattern: string;
  channelInterlock: string;
  withdrawalTrigger: string;
  validationMilestone: string;
  riskBudgetBalance: string;
  judgeVerdict: "ACCEPTED" | "REJECTED" | "NOT_RUN";
  emittedAt: number;
}

export interface IterationStrategySignal {
  learningPriority: string;
  killVsRetainHeuristic: string;
  hypothesisDependencyChain: string[];
  acceptableLossPerTest: string;
  decisionVelocity: "fast" | "measured" | "slow";
  judgeVerdict: "ACCEPTED" | "REJECTED" | "NOT_RUN";
  emittedAt: number;
}

export interface RetentionEconomicsSignal {
  ltvUnlockSequence: string;
  churnDefensePriority: string;
  expansionRevenuePath: string;
  paybackPeriodAssessment: string;
  retentionROIThesis: string;
  judgeVerdict: "ACCEPTED" | "REJECTED" | "NOT_RUN";
  emittedAt: number;
}

export interface SystemJudgementSignal {
  verdict: "PASS" | "DOWNGRADE" | "REPAIR" | "BLOCK";
  recommendedExecutionMode: string;
  commercialReadinessAssessment: string;
  biggestRisk: string;
  conditionsToUpgrade: string[];
  principalCall: string;
  judgeVerdict: "ACCEPTED" | "REJECTED" | "NOT_RUN";
  emittedAt: number;
}

export interface CommercialSignals {
  trustMechanism?: TrustMechanismSignal;
  gameDimension?: GameDimensionSignal;
  valueArchitecture?: ValueArchitectureSignal;
  buyerPsychology?: BuyerPsychologySignal;
  narrativeReframe?: NarrativeReframeSignal;
  // Phase 2 downstream signals
  validationQuality?: ValidationQualitySignal;
  budgetStrategy?: BudgetStrategySignal;
  channelOrchestration?: ChannelOrchestrationSignal;
  iterationStrategy?: IterationStrategySignal;
  retentionEconomics?: RetentionEconomicsSignal;
  systemJudgement?: SystemJudgementSignal;
}

export interface AwarenessMeaningRef {
  stage: string;
  trustLevel: "none" | "low" | "moderate" | "high";
  searchIntentExists: boolean;
  comparisonBehavior: boolean;
  conversionReadiness: "not_ready" | "needs_nurture" | "evaluating" | "ready";
  proofRequirement: "not_needed" | "educational" | "comparative" | "decisive";
  educationLevel: "full" | "moderate" | "minimal" | "none";
  allowedFunnelTypes: string[];
  blockedFunnelTypes: string[];
  allowedChannelRoles: string[];
  allowedPersuasionModes: string[];
}

export interface SharedStrategicContext {
  campaignId: string;
  accountId: string;

  problemRegistry: ProblemEntry[];
  painMap: PainMapEntry[];
  desireMap: DesireMapEntry[];
  objectionMap: ObjectionMapEntry[];
  trustMap: TrustAssessment;
  awarenessMeaning: AwarenessMeaningRef | null;
  narrativeConstraints: NarrativeConstraint[];
  contradictions: ContradictionEntry[];
  confidenceFloor: number;
  confidenceChain: ConfidenceChainEntry[];
  downstreamRequirements: DownstreamRequirement[];
  reasonTrace: ReasonTraceEntry[];
  commercialSignals: CommercialSignals;

  // Phase 0 (AI Proposes / Code Validates). `doctrine` is seeded at run start
  // (before market_intelligence) by server/orchestrator/doctrine-seed.ts.
  // `priorDecisions` is appended by each engine after it produces a validated
  // output, so downstream engines can be gated against upstream decisions.
  doctrine?: StrategicDoctrine;
  priorDecisions: EngineDecisionSummary[];
}

export function createEmptySSC(
  campaignId: string,
  accountId: string
): SharedStrategicContext {
  return {
    campaignId,
    accountId,
    problemRegistry: [],
    painMap: [],
    desireMap: [],
    objectionMap: [],
    trustMap: {
      level: "none",
      barriers: [],
      proofRequired: false,
      educationRequired: false,
    },
    awarenessMeaning: null,
    narrativeConstraints: [],
    contradictions: [],
    confidenceFloor: 1.0,
    confidenceChain: [],
    downstreamRequirements: [],
    reasonTrace: [],
    commercialSignals: {},
    priorDecisions: [],
  };
}

/**
 * Emit a commercial signal from an engine into the SSC.
 * Generic — works for any future signal key as the schema grows.
 * Logs the emission so cross-engine flow is traceable in pipeline output.
 */
export function emitCommercialSignal<K extends keyof CommercialSignals>(
  ssc: SharedStrategicContext,
  key: K,
  signal: NonNullable<CommercialSignals[K]>
): void {
  if (!ssc.commercialSignals) ssc.commercialSignals = {};
  ssc.commercialSignals[key] = signal;
  console.log(`[SSC.CommercialSignal] EMIT | key=${String(key)} | campaign=${ssc.campaignId}`);
}

/**
 * Read a commercial signal previously emitted by an upstream engine.
 * Returns undefined if not present (engine should fall back to legacy reasoning).
 */
export function readCommercialSignal<K extends keyof CommercialSignals>(
  ssc: SharedStrategicContext | null | undefined,
  key: K
): CommercialSignals[K] | undefined {
  if (!ssc || !ssc.commercialSignals) return undefined;
  return ssc.commercialSignals[key];
}

export function registerProblem(
  ssc: SharedStrategicContext,
  sourceEngine: EngineId,
  type: ProblemType,
  description: string,
  severity: ProblemSeverity,
  confidence: number,
  relevantEngines: EngineId[],
  pipelineStep: number
): ProblemEntry {
  const seqId = ssc.problemRegistry.length + 1;
  const entry: ProblemEntry = {
    id: `prob_${sourceEngine}_${pipelineStep}_${seqId}`,
    sourceEngine,
    type,
    description,
    severity,
    confidence,
    status: "open",
    discoveredAt: pipelineStep,
    relevantEngines,
  };
  ssc.problemRegistry.push(entry);
  return entry;
}

export function resolveProblem(
  ssc: SharedStrategicContext,
  problemId: string,
  resolvedBy: EngineId,
  resolvedAction: string
): boolean {
  const problem = ssc.problemRegistry.find((p) => p.id === problemId);
  if (!problem) return false;
  problem.status = "resolved";
  problem.resolvedBy = resolvedBy;
  problem.resolvedAction = resolvedAction;
  return true;
}

export function deferProblem(
  ssc: SharedStrategicContext,
  problemId: string,
  deferredBy: EngineId,
  deferredReason: string
): boolean {
  const problem = ssc.problemRegistry.find((p) => p.id === problemId);
  if (!problem) return false;
  problem.status = "deferred";
  problem.deferredBy = deferredBy;
  problem.deferredReason = deferredReason;
  return true;
}

export function markCannotResolve(
  ssc: SharedStrategicContext,
  problemId: string,
  cannotResolveBy: EngineId,
  cannotResolveReason: string
): boolean {
  const problem = ssc.problemRegistry.find((p) => p.id === problemId);
  if (!problem) return false;
  problem.status = "cannot_resolve";
  problem.cannotResolveBy = cannotResolveBy;
  problem.cannotResolveReason = cannotResolveReason;
  return true;
}

export function getRelevantProblems(
  ssc: SharedStrategicContext,
  engineId: EngineId
): ProblemEntry[] {
  return ssc.problemRegistry.filter(
    (p) =>
      p.status === "open" && p.relevantEngines.includes(engineId)
  );
}

export function addReasonTrace(
  ssc: SharedStrategicContext,
  engineId: EngineId,
  signal: string,
  interpretation: string,
  constraint: string,
  decision: string,
  confidence: number,
  upstreamRef?: string
): void {
  ssc.reasonTrace.push({
    engineId,
    signal,
    interpretation,
    constraint,
    decision,
    confidence,
    upstreamRef,
  });
}

export function updateConfidenceChain(
  ssc: SharedStrategicContext,
  engineId: EngineId,
  dataConfidence: number,
  engineConfidence: number,
  combinedConfidence: number
): void {
  // Each engine's combinedConfidence records its own local score only.
  // There is no rolling floor cap: upstream confidence weakness is expressed
  // via lineage, CEL, grounding, hard gates, and DEGRADED states — not by
  // numerically crushing downstream self-assessments.
  // confidenceFloor tracks the minimum observed across all engines and is
  // retained for checkBudgetOverrideZeroConfidence (blocks scale/test budget
  // actions when any engine genuinely emitted 0 combined confidence).
  const floorBeforeThisEngine = ssc.confidenceFloor;
  ssc.confidenceFloor = Math.min(ssc.confidenceFloor, combinedConfidence);
  ssc.confidenceChain.push({
    engineId,
    dataConfidence,
    engineConfidence,
    combinedConfidence,
    localCombined: combinedConfidence,
    inheritedFloor: floorBeforeThisEngine, // diagnostic record only — no longer a cap
  });
}

export function addContradiction(
  ssc: SharedStrategicContext,
  engineA: EngineId,
  engineB: EngineId,
  description: string,
  severity: ProblemSeverity,
  pipelineStep: number
): void {
  ssc.contradictions.push({
    id: `contra_${engineA}_${engineB}_${pipelineStep}`,
    engineA,
    engineB,
    description,
    severity,
    discoveredAt: pipelineStep,
  });
}

export function addNarrativeConstraint(
  ssc: SharedStrategicContext,
  sourceEngine: EngineId,
  constraint: string,
  pipelineStep: number
): void {
  ssc.narrativeConstraints.push({
    sourceEngine,
    constraint,
    lockedAt: pipelineStep,
  });
}

export function getUnresolvedCriticalProblems(
  ssc: SharedStrategicContext
): ProblemEntry[] {
  return ssc.problemRegistry.filter(
    (p) => p.status === "open" && p.severity === "critical"
  );
}

export function getUnresolvedHighProblems(
  ssc: SharedStrategicContext
): ProblemEntry[] {
  return ssc.problemRegistry.filter(
    (p) => p.status === "open" && p.severity === "high"
  );
}
