/**
 * Shared Business Understanding Contracts & Types
 */

export interface ProductTruthFact {
  productTruthFactId: string;
  campaignOfferingId: string;
  statement: string;
  factType: "CAPABILITY" | "BOUNDARY" | "USE_CASE" | "DELIVERY_MECHANISM" | "PRICING_FACT" | "PROOF";
  status: "WEBSITE_ESTABLISHED" | "USER_CONFIRMED" | "SYSTEM_INFERRED" | "UNKNOWN";
  evidenceRefIds: string[];
  sourcePageUrl?: string;
  sourceQuote?: string;
  sourceEvidenceId?: string;
  sourceSection?: string;
  capturedAt?: number;
  sourceVersion?: string;
  rationale?: string;
}

export interface TargetRoleFact {
  targetRoleFactId: string;
  campaignOfferingId: string;
  roleType: "USER" | "BUYER" | "DECISION_MAKER" | "BUSINESS_CONTEXT";
  roleTitle: string;
  status: "WEBSITE_ESTABLISHED" | "USER_CONFIRMED" | "SYSTEM_INFERRED" | "UNKNOWN";
  evidenceRefIds: string[];
  sourcePageUrl?: string;
  sourceQuote?: string;
  sourceEvidenceId?: string;
  rationale?: string;
}

export interface DiscoveredOffering {
  offeringName: string;
  offeringScope?: "B2C" | "B2B" | "HYBRID" | string;
  description?: string;
  isSelectedCampaignScope?: boolean;
  sourcePageUrls?: string[];
}

export interface UnresolvedBusinessConflict {
  conflictId: string;
  dimension: "MONETIZATION" | "CAPABILITY" | "DELIVERY" | "BUYER_SCOPE" | "POLICY";
  summary: string;
  evidenceA: { statement: string; sourceUrl?: string; evidenceId?: string };
  evidenceB: { statement: string; sourceUrl?: string; evidenceId?: string };
  resolutionStatus: "UNRESOLVED_CONFLICT" | "SCOPED_BY_OFFERING";
}

export interface AcquisitionCoverageReport {
  discoveredUrls: string[];
  acquiredUrls: string[];
  resolvedFragments: string[];
  extractedSectionsCount: number;
  answeredFaqCount: number;
  unansweredFaqQuestions: string[];
  omittedUrls: string[];
  inaccessibleItems: string[];
  contradictorySignals: string[];
}

export type PriceKind =
  | "FIXED"
  | "SUBSCRIPTION"
  | "UNIT_RATE"
  | "TIERED"
  | "QUOTE_BASED"
  | "FREE"
  | "USAGE_BASED";

export type BillingPeriod =
  | "ONE_TIME"
  | "MONTHLY"
  | "ANNUAL"
  | "WEEKLY"
  | "HOURLY"
  | "PER_PROJECT";

export interface NormalizedPricePerUnit {
  unit: string;
  normalizedAmount: number;
  currency: string;
  displayString: string;
}

export interface CanonicalPrice {
  kind: PriceKind;
  currency: string;
  amount?: number | null;
  billingPeriod?: BillingPeriod | null;
  unit?: string | null;
  unitQuantity?: number | null;
  normalized?: NormalizedPricePerUnit | null;
  rawPriceString?: string | null;
  pricingNotes?: string | null;
}

export type DeliveryCategory =
  | "SAAS_OR_WEB_APPLICATION"
  | "DIGITAL_PRODUCT_OR_SERVICE"
  | "PHYSICAL_PRODUCT"
  | "PROFESSIONAL_OR_LOCAL_SERVICE"
  | "MARKETPLACE_OR_PLATFORM"
  | "HYBRID"
  | "UNCERTAIN";

export type BuyerSegmentCategory =
  | "B2C"
  | "B2B"
  | "B2B_AND_B2C"
  | "HYBRID"
  | "UNCERTAIN";

export type MonetizationCategory =
  | "SUBSCRIPTION"
  | "ONE_TIME_PURCHASE"
  | "USAGE_OR_TRANSACTION_BASED"
  | "FREEMIUM_OR_TRIAL_TO_PAID"
  | "QUOTE_OR_CONTRACT_BASED"
  | "HYBRID"
  | "UNKNOWN";

export interface ClassificationDimension<T extends string = string> {
  value: T;
  category?: T;
  summary: string;
  reasoning?: string;
  confidence: "HIGH" | "MEDIUM" | "LOW" | "UNCERTAIN" | "INSUFFICIENT_EVIDENCE";
  evidence: string[];
  supportingEvidence?: string[];
  uncertaintyReason?: string | null;
  uncertaintyNote?: string | null;
}

export interface BusinessClassificationProfile {
  offeringAndDelivery: ClassificationDimension<DeliveryCategory>;
  buyerSegment: ClassificationDimension<BuyerSegmentCategory>;
  monetization: ClassificationDimension<MonetizationCategory>;
  evidenceGaps: string[];
}

export interface OfferingVariantSpec {
  variantId: string;
  name: string;
  offeringType: "PHYSICAL_PRODUCT" | "DIGITAL_PRODUCT" | "SAAS" | "SERVICE" | "HYBRID";
  sku?: string | null;
  attributes?: Record<string, string | number | boolean>;
  price: CanonicalPrice;
  isDefault?: boolean;
  isSelectedCampaignVariant?: boolean;
}

export interface CampaignOffering {
  campaignOfferingId: string;
  accountId: string;
  campaignId: string;
  offeringName: string;
  sourceInputEvidenceId: string;
  createdAt: number;
  businessUnderstandingAuthorityId: string;
  offeringType?: "PRODUCT" | "SERVICE" | "HYBRID_OFFERING" | "SAAS" | "DIGITAL_PRODUCT" | "PHYSICAL_PRODUCT";
  category?: string;
  pricingModel?: string;
  deliveryModel?: DeliveryCategory;
  buyerSegment?: BuyerSegmentCategory;
  monetizationModel?: MonetizationCategory;
  variants?: OfferingVariantSpec[];
  selectedVariantId?: string | null;
  canonicalPrice?: CanonicalPrice | null;
  productTruthFactIds: string[];
  productTruthFacts: ProductTruthFact[];
  boundAt?: number;
}

export interface TargetUnderstanding {
  targetUnderstandingAuthorityId: string;
  businessUnderstandingAuthorityId: string;
  campaignOfferingId: string;
  accountId: string;
  campaignId: string;
  targetRoles: TargetRoleFact[];
  likelyUsers?: string[];
  likelyBuyers?: string[];
  likelyDecisionMakers?: string[];
  status: "COMPLETE" | "INCOMPLETE" | "FAILED";
  evaluatedAt: number;
  parentAuthorityIds: string[];
}

export interface BusinessUnderstandingPayload {
  businessUnderstandingAuthorityId: string;
  accountId: string;
  campaignId: string;
  parentAuthorityIds: string[];
  businessName: string;
  businessModel: string;
  generalIndustry: string;
  classificationProfile?: BusinessClassificationProfile;
  evidenceGaps?: string[];
  coverageReport?: AcquisitionCoverageReport;
  unresolvedConflicts?: UnresolvedBusinessConflict[];
  discoveredOfferings?: DiscoveredOffering[];
  campaignOffering: CampaignOffering;
  targetUnderstanding: TargetUnderstanding;
  status: "COMPLETE" | "INCOMPLETE" | "FAILED";
  reason?: string;
  errorDetail?: string;
  analyzedAt: number;
}


