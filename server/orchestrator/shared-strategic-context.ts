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
  };
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

export const MAX_CONFIDENCE_AMPLIFICATION = 0.20;

export function updateConfidenceChain(
  ssc: SharedStrategicContext,
  engineId: EngineId,
  dataConfidence: number,
  engineConfidence: number,
  combinedConfidence: number
): void {
  const floorBeforeThisEngine = ssc.confidenceFloor;
  const localCombined = combinedConfidence;
  const rolledUp = floorBeforeThisEngine >= 1.0
    ? localCombined
    : Math.min(localCombined, floorBeforeThisEngine + MAX_CONFIDENCE_AMPLIFICATION);
  ssc.confidenceFloor = Math.min(ssc.confidenceFloor, rolledUp);
  ssc.confidenceChain.push({
    engineId,
    dataConfidence,
    engineConfidence,
    combinedConfidence: rolledUp,
    localCombined,
    inheritedFloor: floorBeforeThisEngine,
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
