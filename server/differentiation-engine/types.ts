
export interface CanonicalDifferentiationInput {
  lineage: {
    accountId: string;
    campaignId: string;
    jobId: string;
    audienceSnapshotId: string;
    miSnapshotId: string;
  };
  corePains: Array<{
    painId: string;
    targetCoverageAuthorityId: string;
    productFitAuthorityId: string;
    coreDecisionId: string;
    canonicalPain: string;
    segmentIds: string[];
    fitType: string;
    requiredCapability: string;
    matchedProductCapability: string;
    productTruthFactIds: string[];
  }>;
  productTruth: Array<{
    factId: string;
    fact: string;
  }>;
  competitiveAuthority: Array<{
    miAuthorityId: string;
    competitorId: string;
    factType: string;
    fact: string;
    miSnapshotId: string;
  }>;
}

export type PainDispositionCode =
  | "ACCEPTED_DIFFERENTIATION"
  | "NO_SUPPORTED_DIFFERENTIATION"
  | "COMPETITIVE_EVIDENCE_INSUFFICIENT"
  | "DIFFERENTIATION_INCOMPLETE"
  | "MAPPED_TO_ACCEPTED_UMBRELLA"
  | "STRUCTURAL_DISPOSITION_MISSING";

export interface PainDisposition {
  painId: string;
  disposition: PainDispositionCode;
  differentiationId?: string;
}

export type MechanismStatus = "ESTABLISHED" | "NO_DISTINCT_MECHANISM_ESTABLISHED";

export interface DifferentiationCandidate {
  differentiationId?: string;
  corePainIds: string[];
  differentiationClaim: string;
  comparisonBaseline: {
    statement: string;
    miAuthorityIds: string[];
    competitorIds: string[];
  };
  distinctiveProperty: string;
  productTruthFactIds: string[];
  buyerValue: string;
  mechanismStatus: MechanismStatus;
  mechanismName: string | null;
  proofBoundary: string;
  isJudgeApproved?: boolean;
}

export type JudgeRejectionCode =
  | "GENERIC_INTERCHANGEABLE"
  | "CAPABILITY_NOT_DIFFERENTIATION"
  | "VALUE_MISTAKEN_FOR_DIFFERENTIATION"
  | "PRODUCT_TRUTH_UNSUPPORTED"
  | "MI_BASELINE_UNSUPPORTED"
  | "COMPETITIVE_SCOPE_OVERCLAIM"
  | "MECHANISM_HALLUCINATED"
  | "PAIN_MEANING_DRIFT"
  | "BUYER_VALUE_NOT_ESTABLISHED"
  | "LINEAGE_REFERENCE_INVALID"
  | "STRUCTURAL_DISPOSITION_MISSING"
  | "SPECIFICITY_LACKING";

export interface JudgeDefect {
  differentiationId?: string;
  painId?: string;
  code: JudgeRejectionCode;
  reason: string;
  rejectedFields: string[];
  fixDirective: string;
}

export interface DifferentiationJudgeOutput {
  valid: boolean;
  defects: JudgeDefect[];
}

export interface DifferentiationResult {
  status: string;
  statusMessage?: string;
  differentiations: DifferentiationCandidate[];
  pillars?: any[];
  claimStructures?: any[];
  proofArchitecture?: any[];
  painDispositions: PainDisposition[];
  confidenceScore: number;
  executionTimeMs: number;
  engineVersion: number;
  diagnostics?: any;
}

export interface Territory {
  positioningId?: string;
  name: string;
  opportunityScore?: number;
  confidenceScore?: number;
  narrativeDistance?: number;
  category?: string;
  description?: string;
}

