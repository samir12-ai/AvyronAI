/**
 * Shared Epistemic Claim Status Contract
 *
 * Strict architectural distinctions across Avyron:
 * 1. CUSTOMER_NEED: Empirical friction, desire, or objection from market/customer voice.
 * 2. MARKET_OBSERVATION: Observed competitor pattern, pricing baseline, or category shift.
 * 3. ATTRIBUTED_BRAND_CLAIM: Published marketing promise from a brand/competitor website (unverified performance).
 * 4. SUPPORTED_CAPABILITY: Verified fact directly evidenced by first-party Product Truth.
 * 5. PROPOSED_CAPABILITY: Strategic proposal beyond existing capabilities; requires validation / implementation.
 * 6. UNPROVEN_CLAIM: Claim or premise that lacks empirical verification or is explicitly outside proven boundaries.
 */

export const ClaimEpistemicStatus = {
  CUSTOMER_NEED: "CUSTOMER_NEED",
  MARKET_OBSERVATION: "MARKET_OBSERVATION",
  ATTRIBUTED_BRAND_CLAIM: "ATTRIBUTED_BRAND_CLAIM",
  SUPPORTED_CAPABILITY: "SUPPORTED_CAPABILITY",
  PROPOSED_CAPABILITY: "PROPOSED_CAPABILITY",
  UNPROVEN_CLAIM: "UNPROVEN_CLAIM",
} as const;

export type ClaimEpistemicStatus = (typeof ClaimEpistemicStatus)[keyof typeof ClaimEpistemicStatus];

export const CLAIM_EPISTEMIC_LABELS: Record<ClaimEpistemicStatus, string> = {
  CUSTOMER_NEED: "Customer Need — Empirical Buyer Voice",
  MARKET_OBSERVATION: "Market Observation — Competitive Intelligence",
  ATTRIBUTED_BRAND_CLAIM: "Attributed Brand Claim — Published marketing promise (unverified performance)",
  SUPPORTED_CAPABILITY: "Supported Product Capability — Verified by Product Truth",
  PROPOSED_CAPABILITY: "Proposed — requires validation/implementation",
  UNPROVEN_CLAIM: "Unproven — Lacks empirical verification",
} as const;

export type FactualSupportStatus =
  | "VERIFIED"
  | "ATTRIBUTED"
  | "INFERRED"
  | "UNKNOWN"
  | "CONTRADICTED"
  | "UNSUPPORTED";

export type CompetitiveSupportStatus =
  | "COMPARATIVE_VERIFIED"
  | "COMPETITOR_ATTRIBUTED"
  | "PARITY_SHARED"
  | "INSUFFICIENT_COMPETITOR_EVIDENCE"
  | "NOT_APPLICABLE";

export type StrategicDecisionStatus =
  | "SUPPORTED_DIFFERENTIATOR"
  | "VALUABLE_COMBINATION"
  | "STRATEGIC_MARKET_EMPHASIS"
  | "STRATEGIC_HYPOTHESIS"
  | "PROPOSED_OPERATIONAL_CHANGE"
  | "UNSUPPORTED_ASSERTION";

export type ExecutionEligibilityStatus =
  | "EXECUTABLE"
  | "RESTRICTED_FRAMING"
  | "DEGRADED_FALLBACK"
  | "BLOCKED";

export type BusinessApprovalStatus =
  | "NOT_REQUIRED"
  | "APPROVED_EXISTING_POLICY"
  | "PENDING_BUSINESS_APPROVAL"
  | "REJECTED";

export const DifferentiationClassification = {
  SUPPORTED_CAPABILITY_DIFFERENCE: "SUPPORTED_CAPABILITY_DIFFERENCE",
  VALUABLE_CAPABILITY_COMBINATION: "VALUABLE_CAPABILITY_COMBINATION",
  SHARED_CAPABILITY_STRATEGIC_EMPHASIS: "SHARED_CAPABILITY_STRATEGIC_EMPHASIS",
  PROPOSED_STRATEGIC_HYPOTHESIS: "PROPOSED_STRATEGIC_HYPOTHESIS",
  PROPOSED_PRODUCT_OR_OPERATIONAL_CHANGE: "PROPOSED_PRODUCT_OR_OPERATIONAL_CHANGE",
  UNSUPPORTED_FACTUAL_ASSERTION: "UNSUPPORTED_FACTUAL_ASSERTION",
} as const;

export type DifferentiationClassification =
  (typeof DifferentiationClassification)[keyof typeof DifferentiationClassification];

export const MechanismClassification = {
  EXISTING_PRODUCT_WORKFLOW: "EXISTING_PRODUCT_WORKFLOW",
  REPACKAGED_DELIVERY_EXPERIENCE: "REPACKAGED_DELIVERY_EXPERIENCE",
  PROPOSED_OPERATIONAL_CHANGE: "PROPOSED_OPERATIONAL_CHANGE",
  UNVERIFIED_TECHNICAL_CLAIM: "UNVERIFIED_TECHNICAL_CLAIM",
} as const;

export type MechanismClassification =
  (typeof MechanismClassification)[keyof typeof MechanismClassification];

export interface ClaimDecisionDimensions {
  factualSupport: FactualSupportStatus;
  competitiveSupport: CompetitiveSupportStatus;
  strategicStatus: StrategicDecisionStatus;
  executionStatus: ExecutionEligibilityStatus;
  businessApprovalStatus: BusinessApprovalStatus;
}

export function deriveHonestClaimLabel(params: {
  status: ClaimEpistemicStatus;
  factualSupport?: FactualSupportStatus;
  competitiveSupport?: CompetitiveSupportStatus;
  strategicStatus?: StrategicDecisionStatus;
  executionStatus?: ExecutionEligibilityStatus;
  businessApprovalStatus?: BusinessApprovalStatus;
}): string {
  if (params.businessApprovalStatus === "PENDING_BUSINESS_APPROVAL") {
    return "Proposed Operational Change — Pending Business Approval";
  }
  if (params.executionStatus === "DEGRADED_FALLBACK") {
    return "Degraded Fallback — Requires Re-Verification";
  }
  if (params.executionStatus === "BLOCKED") {
    return "Blocked — Unsupported or Contradicted Claim";
  }
  if (params.strategicStatus === "STRATEGIC_MARKET_EMPHASIS") {
    if (params.status === ClaimEpistemicStatus.SUPPORTED_CAPABILITY || params.factualSupport === "VERIFIED") {
      return "Supported Product Capability · Strategic Market Emphasis (Competitor Uniqueness Unverified)";
    }
    return "Strategic Market Emphasis — Competitor Uniqueness Unverified";
  }
  if (params.strategicStatus === "VALUABLE_COMBINATION") {
    return "Supported Product Capability Combination · Strategic Advantage";
  }
  if (params.strategicStatus === "SUPPORTED_DIFFERENTIATOR" && params.competitiveSupport === "COMPARATIVE_VERIFIED") {
    return "Verified Competitive Differentiator — Supported by Product & Competitor Evidence";
  }
  if (params.strategicStatus === "PROPOSED_OPERATIONAL_CHANGE") {
    return "Proposed Product/Operational Change — Pending Business Approval";
  }
  if (params.strategicStatus === "STRATEGIC_HYPOTHESIS") {
    return "Proposed Strategic Hypothesis — Requires Market Validation";
  }
  return CLAIM_EPISTEMIC_LABELS[params.status] || CLAIM_EPISTEMIC_LABELS.UNPROVEN_CLAIM;
}

export interface StructuredClaim {
  statement: string;
  status: ClaimEpistemicStatus;
  label: string;
  factualSupport?: FactualSupportStatus;
  competitiveSupport?: CompetitiveSupportStatus;
  strategicStatus?: StrategicDecisionStatus;
  executionStatus?: ExecutionEligibilityStatus;
  businessApprovalStatus?: BusinessApprovalStatus;
  differentiationClassification?: DifferentiationClassification;
  mechanismClassification?: MechanismClassification;
  sourceFactIds?: string[];
  evidenceRefIds?: string[];
  prerequisites?: string[];
  limitations?: string[];
  attributedTo?: string;
  capturedAt?: string | number;
}

export type ProductTruthStatus = "SUPPORTED" | "PROPOSED";

export const PRODUCT_TRUTH_LABELS = {
  SUPPORTED: "Supported by Product Truth",
  PROPOSED: "Proposed — requires implementation or verification",
} as const;

export type ProductTruthLabel = (typeof PRODUCT_TRUTH_LABELS)[keyof typeof PRODUCT_TRUTH_LABELS];

export interface GroundedIdea {
  text: string;
  status: ProductTruthStatus;
  label: ProductTruthLabel;
  isSupported: boolean;
  isProposed: boolean;
  epistemicStatus?: ClaimEpistemicStatus;
  factualSupport?: FactualSupportStatus;
  competitiveSupport?: CompetitiveSupportStatus;
  strategicStatus?: StrategicDecisionStatus;
  executionStatus?: ExecutionEligibilityStatus;
  businessApprovalStatus?: BusinessApprovalStatus;
  sourceFactId?: string;
  supportingFacts?: string[];
  unsupportedTerms?: string[];
  prerequisites?: string[];
  limitations?: string[];
}

export const ObjectionResolutionStatus = {
  ADDRESSED: "ADDRESSED",
  PARTIALLY_MITIGATED: "PARTIALLY_MITIGATED",
  PROPOSED: "PROPOSED",
  UNRESOLVED: "UNRESOLVED",
} as const;

export type ObjectionResolutionStatus = (typeof ObjectionResolutionStatus)[keyof typeof ObjectionResolutionStatus];

export const OBJECTION_RESOLUTION_LABELS: Record<ObjectionResolutionStatus, string> = {
  ADDRESSED: "Addressed — Directly verified by product capability",
  PARTIALLY_MITIGATED: "Partially Mitigated — Risk lowered by operational policy (underlying property unverified)",
  PROPOSED: "Proposed — Requires validation / implementation",
  UNRESOLVED: "Unresolved — Lacks verified capability or mitigation",
};

export type DimensionCategory =
  | "PHYSICAL_INTRINSIC_PROPERTY"
  | "OPERATIONAL_COMMERCIAL_RECOURSE"
  | "SERVICE_DELIVERY_SLA"
  | "OUTCOME_ACHIEVEMENT";

export interface SupportingClaimRef {
  claimId: string;
  claimContentHash?: string;
  epistemicStatus: ClaimEpistemicStatus;
  factualSupport?: FactualSupportStatus;
  competitiveSupport?: CompetitiveSupportStatus;
  strategicStatus?: StrategicDecisionStatus;
  executionStatus?: ExecutionEligibilityStatus;
  businessApprovalStatus?: BusinessApprovalStatus;
  category?: DimensionCategory | string;
  evidenceRefUids?: string[];
  claimSummary?: string;
  revision?: number;
}

export interface StructuredLimitation {
  limitationCode: string;
  description: string;
  appliesToDimension?: string;
}

export interface StructuredPrerequisite {
  prerequisiteId: string;
  description: string;
  verificationType?: "USER_VALIDATION" | "PARTNERSHIP_CONTRACT" | "TECHNICAL_INTEGRATION" | "LAB_CERTIFICATION" | string;
  isMet?: boolean;
}

export interface StructuredObjectionResolution {
  objection: string;
  objectionId?: string;
  resolutionStatus: ObjectionResolutionStatus;
  resolutionText: string;
  factualSupport?: FactualSupportStatus;
  competitiveSupport?: CompetitiveSupportStatus;
  strategicStatus?: StrategicDecisionStatus;
  executionStatus?: ExecutionEligibilityStatus;
  businessApprovalStatus?: BusinessApprovalStatus;
  // Upstream Provenance Pointers
  originatingPainId?: string;
  painContentHash?: string;
  audienceSnapshotId?: string;
  productAssessmentId?: string;
  targetAssessmentId?: string;
  strategicPainDecisionId?: string;
  // Multi-claim support
  supportingClaims?: SupportingClaimRef[];
  // Legacy single-status compatibility
  supportingCapabilityStatus?: ClaimEpistemicStatus;
  supportingEvidenceIds?: string[];
  // String arrays for display compatibility
  prerequisites?: string[];
  limitations?: string[];
  // Structured typed arrays
  structuredPrerequisites?: StructuredPrerequisite[];
  structuredLimitations?: StructuredLimitation[];
  prohibitedMarketingAngles?: string[];
  remainingGaps?: string[];
}


