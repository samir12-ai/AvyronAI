
import { type StrategicLane } from "../shared/lane-grouper";

export type MIInput = any;
export interface AudienceInput {
  painRegistry?: any[];
  audienceSegments?: any[];
  audiencePains?: any[];
  productTruthFacts?: any[];
  strategicLanes?: StrategicLane[];
  marketPains?: string[];
  [key: string]: any;
}
export type ProfileInput = any;

export type ComparisonBaselineEvidenceBasis =
  | "COMPETITOR_FACT"
  | "COMPETITOR_CUSTOMER_VOICE"
  | "UNATTRIBUTED_MARKET_VOICE"
  | "STRATEGIC_MARKET_EMPHASIS";

export interface CanonicalCustomerEvidenceItem {
  customerEvidenceId: string;
  rawEvidenceUids: string[];
  painIds: string[];
  origin: "MARKET_VOICE" | "COMPETITOR_COMMENT" | "COMPETITOR_REVIEW" | "BENCHMARK";
  actorType: "CUSTOMER" | "MARKET_VOICE";
  platform: string;
  author?: string;
  url?: string;
  verbatimText: string;
  competitorId?: string;
  competitorName?: string;
  offeringId?: string;
  productOrVariantScope?: string;
  semanticScope?: string;
  transferability?: string;
  isAllegation: boolean;
  rawEvidenceReference?: {
    table: "market_voice_evidence" | "ci_competitor_comments" | "ci_competitor_reviews";
    id: string;
  };
  accountId?: string;
  campaignId?: string;
  campaignOfferingId?: string;
  snapshotId?: string;
}

export interface CanonicalDifferentiationInput {
  lineage: {
    accountId: string;
    campaignId: string;
    jobId: string;
    audienceSnapshotId: string;
    miSnapshotId: string;
    campaignOfferingId?: string;
    productTruthSnapshotId?: string;
    productTruthFingerprint?: string;
    evidenceManifestFingerprint?: string;
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
    evidenceUids?: string[];
    customerEvidenceIds?: string[];
    customerEvidence?: CanonicalCustomerEvidenceItem[];
  }>;
  productTruth: Array<{
    factId?: string;
    productTruthFactId?: string;
    factType?: string;
    fact: string;
    statement?: string;
    status?: string;
    rationale?: string;
    evidenceRefIds?: string[];
    campaignOfferingId?: string;
    sourceRef?: string;
    scope?: string;
    qualifications?: string[];
  }>;
  competitiveAuthority: Array<{
    miAuthorityId: string;
    competitorId: string;
    competitorName?: string;
    factType: string;
    fact: string;
    sourceScope?: "OBSERVED_COMPETITOR" | "CATEGORY_SIGNAL";
    miSnapshotId: string;
  }>;
  customerEvidence?: CanonicalCustomerEvidenceItem[];
  ourProductFacts?: any[];
  miFacts?: any[];
  strategicLanes?: StrategicLane[];
  marketContext?: {
    marketState?: string;
    marketDiagnosis?: string;
    opportunitySignals?: string[];
    threatSignals?: string[];
    marketPains?: string[];
    categoryMaturity?: string;
  };
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
    customerEvidenceIds?: string[];
    competitorIds: string[];
    evidenceBasisType?: ComparisonBaselineEvidenceBasis;
  };
  distinctiveProperty: string;
  productTruthFactIds: string[];
  buyerValue: string;
  mechanismStatus: MechanismStatus;
  mechanismName: string | null;
  proofBoundary: string;
  strategicForm?: "DOCUMENTED_COMPARATIVE_CONTRAST" | "STRATEGIC_MARKET_EMPHASIS";
  ourEstablishedFacts?: string[];
  competitorContrastingFacts?: string[];
  customerEvidenceIds?: string[];
  isJudgeApproved?: boolean;
  approvalFingerprint?: string;
  evidenceDependencyIds?: string[];
  targetedBaselineRepairAudit?: {
    repairedFromDefectCode: string;
    resolutionMode:
      | "RESTORED_COMPETITOR_CUSTOMER_VOICE"
      | "RESTORED_COMPETITOR_FACT"
      | "NARROWED_UNATTRIBUTED_CONCERN"
      | "NEUTRALIZED_STRATEGIC_EMPHASIS";
    verifiedDeterministically: boolean;
    notes: string;
  };
}

export type JudgeRejectionCode =
  | "GENERIC_INTERCHANGEABLE"
  | "CAPABILITY_NOT_DIFFERENTIATION"
  | "VALUE_MISTAKEN_FOR_DIFFERENTIATION"
  | "PRODUCT_TRUTH_UNSUPPORTED"
  | "MI_BASELINE_UNSUPPORTED"
  | "COMPETITIVE_SCOPE_OVERCLAIM"
  | "UNSUPPORTED_NEGATIVE_CLAIM"
  | "MECHANISM_HALLUCINATED"
  | "PAIN_MEANING_DRIFT"
  | "BUYER_VALUE_NOT_ESTABLISHED"
  | "LINEAGE_REFERENCE_INVALID"
  | "STRUCTURAL_DISPOSITION_MISSING"
  | "SPECIFICITY_LACKING"
  | "COMMERCIAL_MEANINGFULNESS";

export interface JudgeDefect {
  differentiationId?: string;
  painId?: string;
  code: JudgeRejectionCode;
  reason: string;
  unsupportedStatement?: string;
  missingOrContradictedAuthority?: string;
  whatEvidenceEstablishes?: string;
  usableComponents?: string[];
  rejectedFields: string[];
  fixDirective: string;
}

export interface DifferentiationJudgeAssessmentDetails {
  productFactualSupport: boolean;
  competitiveFactualSupport: boolean;
  audienceLaneRelevance: boolean;
  commercialMeaningfulness: boolean;
  strategicRoleValidity: boolean;
  evidenceCompleteness: boolean;
}

export interface DifferentiationJudgeOutput {
  valid: boolean;
  assessmentsCompleted: boolean;
  assessmentDetails: DifferentiationJudgeAssessmentDetails;
  defects: JudgeDefect[];
  overallVerdictRationale: string;
}

export type DifferentiationFailureCategory =
  | "SEMANTIC_REJECTION"
  | "MISSING_EVIDENCE_HANDOFF"
  | "TECHNICAL_EXECUTION_FAILURE";

export interface DifferentiationResult {
  status: string;
  statusMessage?: string;
  errorCode?: string;
  failureCategory?: DifferentiationFailureCategory;
  differentiations: DifferentiationCandidate[];
  pillars?: any[];
  claimStructures?: any[];
  proofArchitecture?: any[];
  painDispositions: PainDisposition[];
  confidenceScore: number;
  executionTimeMs: number;
  engineVersion: number;
  productTruthSnapshotId?: string;
  productTruthFingerprint?: string;
  evidenceManifestFingerprint?: string;
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

