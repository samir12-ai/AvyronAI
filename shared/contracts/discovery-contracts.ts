import { createHash } from "crypto";

export type MarketVoiceBroadPlatform = "GOOGLE_SEARCH" | "REDDIT" | "WEB_FORUMS";

export const ALLOWED_MARKET_VOICE_BROAD_PLATFORMS: MarketVoiceBroadPlatform[] = [
  "GOOGLE_SEARCH",
  "REDDIT",
  "WEB_FORUMS",
];

export type CompetitorStrategicRole = "DIRECT" | "ADJACENT" | "ASPIRATIONAL" | "UNRESOLVED";
export type CustomerEvidencePool = "PRIMARY_MARKET_VOICE" | "SUPPORTING_SOCIAL_CUSTOMER_VOICE" | "BENCHMARK_CONTEXT" | "UNRESOLVED_EXCLUDED";

export type CompetitorGeographicClassification =
  | "LOCAL_MARKET"
  | "CROSS_BORDER_SERVING_MARKET"
  | "INTERNATIONAL_REFERENCE"
  | "UNVERIFIED";

export type CompetitorClassification =
  | "DIRECT_COMPETITOR"
  | "RELEVANT_COMPETITOR"
  | "SUBSTITUTE_COMPETITOR"
  | "BENCHMARK_COMPETITOR"
  | "ADJACENT_COMPETITOR"
  | "NOT_COMPETITOR"
  | "INSUFFICIENT_EVIDENCE";

export type SourcePageType =
  | "VENDOR_STOREFRONT_OR_PRODUCT_PAGE"
  | "VENDOR_BLOG_OR_COMPARISON_POST"
  | "THIRD_PARTY_LISTICLE_OR_REVIEW"
  | "MARKETPLACE_LISTING"
  | "MEDIA_OR_GOVERNMENT_PAGE"
  | "UNKNOWN";

export type CompetitorEntityRole =
  | "BRAND_DIRECT_SELLER"
  | "SPECIALTY_RETAILER"
  | "MULTI_BRAND_RETAILER"
  | "DEPARTMENT_STORE"
  | "PURE_MARKETPLACE_PLATFORM"
  | "MARKETPLACE_PLATFORM"
  | "DIRECTORY_AGGREGATOR"
  | "MEDIA_PUBLISHER"
  | "COMMUNITY_FORUM"
  | "UNKNOWN";

export type CompetitorTier = "A" | "B";

export type JudgeVerdict = "APPROVED" | "REJECTED" | "INSUFFICIENT_EVIDENCE";

export interface DiscoveryMission {
  id: string;
  title: string;
  targetProvider: "GOOGLE" | "REDDIT" | "WEB_FORUMS" | "OPEN_WEB";
  query: string;
  rationale: string;
  priority: number;
  searchLanguage?: string;
  marketScope?: "MARKET_SPECIFIC" | "REGIONAL_OR_GLOBAL";
  competitorCategoryTarget?: string;
  buyerSegmentTarget?: string;
}

export interface CandidateProvenance {
  missionId: string;
  searchProvider: string;
  searchQuery: string;
  rawTitle: string;
  rawSnippet: string;
  url: string;
  domain: string;
  retrievedAt: string;
  isOwnProductListing?: boolean;
  ownProductListingReason?: string;
}

export interface CompetitorStorefront {
  domain: string;
  url: string;
  market?: string;
  title?: string;
}

export interface MentionedCompetitorLead {
  name: string;
  domain?: string;
  reason?: string;
}

export type EvidenceDataReuseStatus =
  | "REUSED_FROM_CACHE"
  | "NEWLY_ACQUIRED"
  | "REVALIDATED"
  | "EXCLUDED_IRRELEVANT_OR_STALE";

export interface DiscoveredCompetitorCandidate {
  candidateKey: string; // domain or normalized key
  canonicalEntityId?: string; // stable identifier across multi-ccTLD / store domains
  name: string;
  domain: string;
  websiteUrl: string;
  storefronts?: CompetitorStorefront[];
  occurrences: CandidateProvenance[];
  isCommercialBusiness?: boolean;
  entityRole?: CompetitorEntityRole;
  entityRoleReasoning?: string;
  sourcePageType?: SourcePageType;
  mentionedCompetitorLeads?: MentionedCompetitorLead[];
  identityConfidence?: number;
  identityReasoning?: string;
  geographicClassification?: CompetitorGeographicClassification;
  geographicReasoning?: string;
  marketAvailabilityUncertainty?: string;
  classification?: CompetitorClassification;
  strategicRole?: CompetitorStrategicRole;
  relevanceReason?: string;
  competingOffering?: string;
  servesBuyerNeed?: boolean;
  buyerNeedRationale?: string;
  competitorType?: "DIRECT" | "INDIRECT_SUBSTITUTE" | "EXCLUDED" | "INSUFFICIENT_EVIDENCE";
  monitoredProductUrls?: string[];
  dataReuseStatus?: EvidenceDataReuseStatus;
  evidenceSourceType?:
    | "OFFICIAL_VENDOR_SITE"
    | "VENDOR_BLOG_OR_COMPARISON"
    | "THIRD_PARTY_REVIEW_OR_DIRECTORY"
    | "CUSTOMER_REVIEW_EXCERPT"
    | "SEARCH_SNIPPET";
  tier?: CompetitorTier;
  judgeVerdict?: JudgeVerdict;
  judgeReason?: string;
  canonicalCompetitorId?: string;
  isOnboarded?: boolean;
  selected?: boolean;
}

export interface IdentityVerificationResult {
  candidateKey: string;
  canonicalEntityId?: string;
  isRealBusiness: boolean;
  entityRole: CompetitorEntityRole;
  entityRoleReasoning: string;
  sourcePageType?: SourcePageType;
  mentionedCompetitorLeads?: MentionedCompetitorLead[];
  canonicalName: string;
  canonicalDomain: string;
  storefronts?: CompetitorStorefront[];
  confidence: number;
  reasoning: string;
}

export interface RelevanceVerificationResult {
  candidateKey: string;
  isRelevant: boolean;
  classification: CompetitorClassification;
  competingOffering?: string;
  servesBuyerNeed?: boolean;
  buyerNeedRationale?: string;
  competitorType?: "DIRECT" | "INDIRECT_SUBSTITUTE" | "EXCLUDED" | "INSUFFICIENT_EVIDENCE";
  monitoredProductUrls?: string[];
  geographicClassification?: CompetitorGeographicClassification;
  geographicReasoning?: string;
  marketAvailabilityUncertainty?: string;
  tier: CompetitorTier;
  reason: string;
}

export interface FinalJudgeDecision {
  candidateKey: string;
  canonicalEntityId?: string;
  name: string;
  websiteUrl: string;
  storefronts?: CompetitorStorefront[];
  entityRole: CompetitorEntityRole;
  sourcePageType?: SourcePageType;
  verdict: JudgeVerdict;
  tier: CompetitorTier;
  strategicRole?: CompetitorStrategicRole;
  geographicClassification?: CompetitorGeographicClassification;
  geographicReasoning?: string;
  marketAvailabilityUncertainty?: string;
  finalReason: string;
  classification: CompetitorClassification;
}

export type DiscoveryReadinessVerdict = "READY" | "READY_WITH_LIMITED_EVIDENCE" | "BLOCKED";

export interface CompetitorDiscoveryReadiness {
  verdict: DiscoveryReadinessVerdict;
  canProceed: boolean;
  headline: string;
  reason: string;
  nextAction: string;
  offeringCoverage: string;
  buyerSegmentCoverage: string;
  marketApplicability: string;
  materialGaps: string[];
  counts: {
    totalApproved: number;
    selectedCount: number;
    directCount: number;
    adjacentOrSubstituteCount: number;
    localCount: number;
    crossBorderCount: number;
    internationalReferenceCount: number;
    unverifiedMarketCount: number;
  };
  discoveryHealth: {
    contextCompatible: boolean;
    incompatibilityReason?: string;
    providerErrorCount: number;
    emptyResultMissionCount: number;
    budgetExhausted: boolean;
  };
}

export interface CompetitorDiscoveryReport {
  status: "DISCOVERY_COMPLETE" | "NO_VERIFIED_COMPETITORS" | "SEARCH_PROVIDER_UNAVAILABLE" | "INSUFFICIENT_CONTEXT" | "VERIFIED_COMPETITOR_COUNT_INSUFFICIENT_FOR_BUILD_GATE";
  discoverySessionId?: string;
  searchMissions: DiscoveryMission[];
  totalOccurrencesDiscovered: number;
  uniqueCandidateCount: number;
  approvedCandidates: DiscoveredCompetitorCandidate[];
  rejectedCandidates: DiscoveredCompetitorCandidate[];
  insufficientEvidenceCandidates: DiscoveredCompetitorCandidate[];
  localCandidates?: DiscoveredCompetitorCandidate[];
  crossBorderCandidates?: DiscoveredCompetitorCandidate[];
  internationalReferenceCandidates?: DiscoveredCompetitorCandidate[];
  unverifiedMarketCandidates?: DiscoveredCompetitorCandidate[];
  pendingVerificationCandidates?: DiscoveredCompetitorCandidate[];
  localVerifiedCount?: number;
  requiredLocalCount?: number;
  shortfall?: number;
  isBuildEligible?: boolean;
  readiness?: CompetitorDiscoveryReadiness;
  candidates: DiscoveredCompetitorCandidate[]; // For backwards-compatible array view
  onboardedCompetitors: Array<{
    id: string;
    name: string;
    websiteUrl: string;
    tier: CompetitorTier;
    strategicRole?: CompetitorStrategicRole;
    isExisting: boolean;
  }>;
  message?: string;
  telemetry: {
    missionsPlanned: number;
    missionsExecuted: number;
    providerCallsMade: number;
    llmCallsMade: number;
    totalRuntimeMs: number;
    providerErrors?: number;
    emptyResultMissions?: number;
    budgetExhausted?: boolean;
    reusedCandidatesCount?: number;
    contextCompatible?: boolean;
    incompatibilityReason?: string;
  };
}

export interface ParallelDiscoveryResult {
  accountId: string;
  campaignId: string;
  campaignOfferingId: string;
  competitorDiscovery: CompetitorDiscoveryReport;
  marketVoice?: {
    discoveryJobId?: string;
    status: string;
    totalIntents: number;
    totalResultsPersisted: number;
  };
  globalStatus: "COMPLETED" | "COMPLETED_WITH_GAPS" | "FAILED";
  totalRuntimeMs: number;
}
