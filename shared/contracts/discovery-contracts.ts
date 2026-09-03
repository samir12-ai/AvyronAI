import { createHash } from "crypto";

export type MarketVoiceBroadPlatform = "GOOGLE_SEARCH" | "REDDIT" | "WEB_FORUMS";

export const ALLOWED_MARKET_VOICE_BROAD_PLATFORMS: MarketVoiceBroadPlatform[] = [
  "GOOGLE_SEARCH",
  "REDDIT",
  "WEB_FORUMS",
];

export type CompetitorClassification =
  | "DIRECT_COMPETITOR"
  | "RELEVANT_COMPETITOR"
  | "BENCHMARK_COMPETITOR"
  | "ADJACENT_COMPETITOR"
  | "NOT_COMPETITOR"
  | "INSUFFICIENT_EVIDENCE";

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
}

export interface DiscoveredCompetitorCandidate {
  candidateKey: string; // domain or normalized key
  name: string;
  domain: string;
  websiteUrl: string;
  occurrences: CandidateProvenance[];
  isCommercialBusiness?: boolean;
  entityRole?: CompetitorEntityRole;
  entityRoleReasoning?: string;
  identityConfidence?: number;
  identityReasoning?: string;
  classification?: CompetitorClassification;
  relevanceReason?: string;
  tier?: CompetitorTier;
  judgeVerdict?: JudgeVerdict;
  judgeReason?: string;
  canonicalCompetitorId?: string;
  isOnboarded?: boolean;
}

export interface IdentityVerificationResult {
  candidateKey: string;
  isRealBusiness: boolean;
  entityRole: CompetitorEntityRole;
  entityRoleReasoning: string;
  canonicalName: string;
  canonicalDomain: string;
  confidence: number;
  reasoning: string;
}

export interface RelevanceVerificationResult {
  candidateKey: string;
  isRelevant: boolean;
  classification: CompetitorClassification;
  tier: CompetitorTier;
  reason: string;
}

export interface FinalJudgeDecision {
  candidateKey: string;
  name: string;
  websiteUrl: string;
  entityRole: CompetitorEntityRole;
  verdict: JudgeVerdict;
  tier: CompetitorTier;
  finalReason: string;
  classification: CompetitorClassification;
}

export interface CompetitorDiscoveryReport {
  status: "DISCOVERY_COMPLETE" | "NO_VERIFIED_COMPETITORS" | "SEARCH_PROVIDER_UNAVAILABLE" | "INSUFFICIENT_CONTEXT" | "VERIFIED_COMPETITOR_COUNT_INSUFFICIENT_FOR_BUILD_GATE";
  searchMissions: DiscoveryMission[];
  totalOccurrencesDiscovered: number;
  uniqueCandidateCount: number;
  approvedCandidates: DiscoveredCompetitorCandidate[];
  rejectedCandidates: DiscoveredCompetitorCandidate[];
  insufficientEvidenceCandidates: DiscoveredCompetitorCandidate[];
  candidates: DiscoveredCompetitorCandidate[]; // For backwards-compatible array view
  onboardedCompetitors: Array<{
    id: string;
    name: string;
    websiteUrl: string;
    tier: CompetitorTier;
    isExisting: boolean;
  }>;
  message?: string;
  telemetry: {
    missionsPlanned: number;
    missionsExecuted: number;
    providerCallsMade: number;
    llmCallsMade: number;
    totalRuntimeMs: number;
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
