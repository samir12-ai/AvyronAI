export interface MechanismEnginePositioningInput {
  contrastAxis: string | null;
  enemyDefinition: string | null;
  narrativeDirection: string | null;
  differentiationVector: string[];
  territories: any[];
  domainVocab?: string;
  /** v2: confidence flows downstream — mechanism cannot exceed positioning ceiling */
  confidenceScore?: number | null;
}

export interface MechanismEngineDifferentiationInput {
  pillars: any[];
  mechanismFraming: any;
  mechanismCore: {
    mechanismName: string;
    mechanismType: string;
    mechanismSteps: string[];
    mechanismPromise: string;
    mechanismProblem: string;
    mechanismLogic: string;
  } | null;
  authorityMode: string | null;
  claimStructures: any[];
  proofArchitecture: any[];
  /** v2: confidence flows downstream */
  confidenceScore?: number | null;
  /** Canonical Product Truth snapshot lineage */
  campaignOfferingId?: string;
  productTruthSnapshotId?: string;
  productTruthFingerprint?: string;
}

/** v2: structural causality — cause→impact→behavior tied to upstream signal IDs */
export interface CausalChainStep {
  cause: string;          // What the buyer experiences/believes that the mechanism intervenes on
  impact: string;         // The structural change the mechanism produces (not a vibe)
  behavior: string;       // The buyer behavior that follows (commercial outcome)
  upstreamSignalRefs?: string[]; // RC#/CC#/BB#/PAIN#/DESIRE# from MI v3
}

export interface AlternativeMechanismRef {
  name: string;
  whyAlternative: string;
}

export type MechanismCommercialFunction =
  | "trust_transfer"
  | "risk_reduction"
  | "identity_shift"
  | "perception_change"
  | "category_capture";

export type MechanismAuthorityRole =
  | "STRATEGIC_SYNTHESIS"
  | "VERIFIED_EXISTING_PROCESS"
  | "PROPOSED_EXECUTION";

export interface MechanismOutput {
  mechanismName: string;
  mechanismType: string;
  mechanismAuthorityRole?: MechanismAuthorityRole;
  mechanismDescription: string;
  mechanismSteps: string[];
  mechanismPromise: string;
  mechanismProblem: string;
  mechanismLogic: string;
  axisAlignment: {
    primaryAxis: string;
    axisEmphasis: string[];
    axisConfidence: number;
  };
  structuralFrame: string;
  differentiationLink: string;
  // ─── v2 fields (commercial-reasoning depth) ───
  /** Buyer-psychology-grounded explanation of why this mechanism converts */
  whyItWorks?: string;
  /** Counterfactual: when/where this mechanism would FAIL */
  failureModes?: string[];
  /** Cause→Impact→Behavior chain tied to upstream MI signals */
  causalChain?: CausalChainStep[];
  /** Named commercial function this mechanism serves */
  commercialFunction?: {
    type: MechanismCommercialFunction;
    description: string;
  };
  /** Upstream lineage: which positioning + differentiation hooks this mechanism inherits */
  upstreamDependency?: {
    positioningHook: string;
    differentiationHook: string;
  };
  /** Validated capability IDs (cap_<hash>) cited by this mechanism (CAPABILITY_NAMESPACE) */
  capabilityRefs?: string[];
  /** Canonical factual claims structurally bound to Capability Registry entries */
  factualCapabilities?: Array<{
    role: "EXISTING_FACTUAL_CLAIM";
    capabilityRef: string;
    canonicalStatement: string;
    factType?: string;
    sourceFactId?: string;
    _debugClaimText?: string;
  }>;
  /** Proposed/future execution recommendations (distinct from existing capabilities) */
  proposedExecutions?: string[];
  /** Operational claims classified during semantic role judgment */
  operationalClaims?: Array<{
    claim: string;
    role:
      | "EXISTING_FACTUAL_CLAIM"
      | "SUPPORTED_FACTUAL_STATEMENT"
      | "REASONABLE_DESCRIPTIVE_SYNTHESIS"
      | "BOUNDED_INTERPRETATION"
      | "STRATEGIC_SYNTHESIS"
      | "PROPOSED_EXECUTION"
      | "UNSUPPORTED_MATERIAL_ASSERTION"
      | string;
    capabilityRef?: string | null;
    supportedByCapability?: string | null;
  }>;
  productTruthSnapshotId?: string;
  productTruthFingerprint?: string;
}

export interface MechanismEngineResult {
  status: string;
  statusMessage: string | null;
  primaryMechanism: MechanismOutput;
  alternativeMechanism: MechanismOutput | null;
  axisConsistency: {
    consistent: boolean;
    primaryAxis: string;
    mechanismAxis: string;
    failures: string[];
  };
  confidenceScore: number;
  executionTimeMs: number;
  engineVersion: number;
  diagnostics: Record<string, any>;
  celDepthCompliance?: any;
  depthGateResult?: any;
  // ─── v2 confidence audit trail ───
  /** Ceiling computed from upstream positioning.confidence + differentiation.confidence */
  inheritedConfidence?: number;
  /** What the LLM/scoring would have produced before the ceiling was applied */
  rawLLMConfidence?: number;
  /** rawLLMConfidence - finalConfidence (zero or positive — penalty due to upstream weakness) */
  confidencePenalty?: number;
  /** Alternatives the LLM considered but did not pick — surfaced for audit */
  alternativeMechanisms?: AlternativeMechanismRef[];
  /** Canonical Product Truth snapshot lineage */
  productTruthSnapshotId?: string;
  productTruthFingerprint?: string;
}
