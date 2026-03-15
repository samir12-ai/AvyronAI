import type { AuthorityMode, ProofCategory } from "./constants";

export interface MIInput {
  dominanceData: any;
  contentDnaData: any;
  marketDiagnosis: string | null;
  opportunitySignals: any[];
  threatSignals: any[];
  narrativeSynthesis: string | null;
}

export interface AudienceInput {
  objectionMap: Record<string, any>;
  emotionalDrivers: any[];
  maturityIndex: number | null;
  awarenessLevel: string | null;
  audiencePains: any[];
  desireMap: Record<string, any>;
  audienceSegments: any[];
  intentDistribution: any;
}

export interface ProfileInput {
  businessType: string | null;
  coreOffer: string | null;
  targetAudienceSegment: string | null;
  targetAudienceAge: string | null;
  priceRange: string | null;
  funnelObjective: string | null;
  businessLocation: string | null;
  goalDescription: string | null;
}

export interface ProfileSignals {
  claimTokens: Set<string>;
  offerTokens: Set<string>;
  audienceTokens: Set<string>;
  strategyTokens: Set<string>;
  signalCount: number;
  hasProfile: boolean;
}

export interface PositioningInput {
  territories: Territory[];
  differentiationVector: any;
  enemyDefinition: string | null;
  contrastAxis: string | null;
  narrativeDirection: string | null;
  flankingMode: boolean;
  stabilityResult: any;
  strategyCards: any[];
}

export interface Territory {
  name: string;
  opportunityScore?: number;
  confidenceScore?: number;
  narrativeDistance?: number;
  category?: string;
  description?: string;
}

export interface CompetitorClaim {
  competitorId?: string;
  claim: string;
  source: string;
  category: string;
  strength: number;
}

export interface ClaimCollision {
  candidateClaim: string;
  competitorClaim: string;
  similarity: number;
  narrativeProximity: number;
  collisionRisk: number;
  competitorSource: string;
}

export interface ProofDemand {
  category: ProofCategory;
  priority: number;
  rationale: string;
  requiredFor: string[];
}

export interface TrustGap {
  objection: string;
  severity: number;
  relevanceToTerritory: number;
  priorityRank: number;
}

export interface ProofAsset {
  category: ProofCategory;
  description: string;
  feasibility: number;
  impactScore: number;
}

export interface MechanismCandidate {
  name: string | null;
  description: string;
  supported: boolean;
  proofBasis: string[];
  type: "named_process" | "branded_method" | "framework" | "system" | "none";
}

export interface DifferentiationPillar {
  name: string;
  description: string;
  uniqueness: number;
  proofability: number;
  trustAlignment: number;
  positioningAlignment: number;
  objectionCoverage: number;
  overallScore: number;
  territory: string;
  supportingProof: string[];
}

export interface ClaimStructure {
  claim: string;
  territory: string;
  distinctiveness: number;
  believability: number;
  defensibility: number;
  relevance: number;
  overallScore: number;
  collisionRisk: number;
  proofBasis: string[];
}

export interface MechanismCore {
  mechanismName: string;
  mechanismType: "method" | "system" | "protocol" | "framework" | "none";
  mechanismSteps: string[];
  mechanismPromise: string;
  mechanismProblem: string;
  mechanismLogic: string;
}

export interface DifferentiationResult {
  status: string;
  statusMessage: string | null;
  pillars: DifferentiationPillar[];
  proofArchitecture: ProofAsset[];
  claimStructures: ClaimStructure[];
  authorityMode: AuthorityMode;
  authorityRationale: string;
  mechanismFraming: MechanismCandidate;
  mechanismCore: MechanismCore;
  trustPriorityMap: TrustGap[];
  claimScores: { averageScore: number; highestCollision: number; totalClaims: number };
  collisionDiagnostics: ClaimCollision[];
  stabilityResult: { stable: boolean; failures: string[] };
  confidenceScore: number;
  executionTimeMs: number;
  engineVersion: number;
  layerDiagnostics: Record<string, any>;
}
