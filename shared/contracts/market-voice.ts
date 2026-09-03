import { createHash } from "crypto";

export type MarketScope = "TARGET_MARKET" | "GLOBAL_CATEGORY" | "UNKNOWN";
export type SourceScope = "COMPETITOR_CUSTOMER_VOICE" | "MARKET_CUSTOMER_VOICE";

export type DiscoveryJobStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "COMPLETED_WITH_GAPS"
  | "COMPLETED_WITH_BUDGET_LIMIT"
  | "FAILED";

export type SearchIntentCategory =
  | "CUSTOMER_DISCUSSION"
  | "CUSTOMER_EXPERIENCE"
  | "CUSTOMER_QUESTION"
  | "PRODUCT_REVIEW"
  | "COMPARISON"
  | "RECOMMENDATION"
  | "CATEGORY_DISCUSSION"
  | "COMPETITOR_DISCOVERY";

export type SearchIntentPlatform =
  | "GOOGLE_SEARCH"
  | "REDDIT"
  | "YOUTUBE_SEARCH"
  | "WEB_FORUMS"
  | "INSTAGRAM"
  | "TIKTOK";

export type DiscoveryResultStatus =
  | "DISCOVERED"
  | "VERIFIED_CUSTOMER_SOURCE"
  | "VERIFIED_COMPETITOR"
  | "REJECTED_IRRELEVANT"
  | "REJECTED_MARKETING_COPY"
  | "NO_CUSTOMER_VOICE";

export type DiscoveredContentType =
  | "WEB_PAGE"
  | "FORUM_THREAD"
  | "COMMUNITY_POST"
  | "COMPETITOR_CANDIDATE"
  | "REVIEW_PAGE"
  | "YOUTUBE_VIDEO"
  | "INSTAGRAM_POST"
  | "INSTAGRAM_REEL"
  | "INSTAGRAM_PROFILE"
  | "TIKTOK_VIDEO"
  | "TIKTOK_PROFILE"
  | "OTHER";

export type SearchIntentExecutionStatus =
  | "PENDING"
  | "DISPATCHED"
  | "COMPLETED"
  | "NO_RESULTS"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_FAILED"
  | "BUDGET_EXHAUSTED";

export interface EvidenceOccurrence {
  rawEvidenceId: string;
  sourceTable: "ci_competitor_comments" | "ci_competitor_reviews" | "market_voice_evidence";
  sourceScope: SourceScope;
  marketScope: MarketScope;
  geography: string | null;
  language: string | null;
  competitorId?: string | null;
  competitorSourceId?: string | null;
  externalUrl?: string | null;
  externalItemId?: string | null;
  providerRunId?: string | null;
  fetchJobId?: string | null;
}

export interface ProvenanceAwareEvidenceUnit {
  id: string;
  text: string;
  sourceType: "comment" | "review" | "market_comment" | "forum_discussion";
  canonicalCompetitorId: string | null;
  canonicalBrandName: string;
  platform: string;
  rawOccurrenceCount: number;
  likesCount: number;
  originalIds: string[];
  occurrences: EvidenceOccurrence[];
  hasTargetMarketEvidence: boolean;
  primaryMarketScope: MarketScope;
}

export function generateDiscoveryJobId(campaignId: string, campaignOfferingId: string, timestamp = Date.now()): string {
  const hash = createHash("sha256")
    .update(`${campaignId}:${campaignOfferingId}:${timestamp}`)
    .digest("hex")
    .slice(0, 16);
  return `djob_${hash}`;
}

export function generateSearchIntentId(discoveryJobId: string, query: string, targetPlatform: string): string {
  const hash = createHash("sha256")
    .update(`${discoveryJobId}:${targetPlatform}:${query.trim().toLowerCase()}`)
    .digest("hex")
    .slice(0, 16);
  return `sint_${hash}`;
}

export function generateDiscoveryResultId(searchIntentId: string, canonicalUrl: string): string {
  const hash = createHash("sha256")
    .update(`${searchIntentId}:${canonicalUrl.trim()}`)
    .digest("hex")
    .slice(0, 16);
  return `dres_${hash}`;
}

export function generateMarketVoiceEvidenceId(platform: string, externalId: string, normalizedText: string): string {
  const normalized = normalizedText.trim().toLowerCase().replace(/\s+/g, " ");
  const hash = createHash("sha256")
    .update(`${platform.trim().toLowerCase()}:${externalId.trim()}:${normalized}`)
    .digest("hex")
    .slice(0, 16);
  return `mve_${hash}`;
}

/**
 * Safely normalizes URLs for structural deduplication without corrupting case-sensitive identity.
 * 
 * Rules:
 * 1. Lowercase scheme/protocol and hostname only.
 * 2. Strip fragment (#...).
 * 3. Remove default ports (80/443).
 * 4. Remove known tracking query parameters (utm_*, fbclid, gclid, srsltid, etc.).
 * 5. PRESERVE original case for pathname and remaining query parameter keys and values.
 * 6. Structurally normalize trailing slashes on pathname where safe (length > 1).
 */
export function normalizeCanonicalUrl(rawUrl: string): string {
  try {
    const trimmed = rawUrl.trim();
    if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
      return trimmed;
    }
    const parsed = new URL(trimmed);
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.hash = "";

    if ((parsed.protocol === "http:" && parsed.port === "80") || (parsed.protocol === "https:" && parsed.port === "443")) {
      parsed.port = "";
    }

    const TRACKING_PARAMS = new Set([
      "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
      "fbclid", "gclid", "gclsrc", "dclid", "zanpid", "msclkid", "ref", "ref_src",
      "igshid", "srsltid", "_hsenc", "_hsmi", "mc_cid", "mc_eid"
    ]);

    const keysToDelete: string[] = [];
    for (const key of parsed.searchParams.keys()) {
      if (TRACKING_PARAMS.has(key.toLowerCase()) || key.toLowerCase().startsWith("utm_")) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      parsed.searchParams.delete(key);
    }
    parsed.searchParams.sort();

    let pathname = parsed.pathname;
    if (pathname.length > 1 && pathname.endsWith("/")) {
      pathname = pathname.slice(0, -1);
    }
    parsed.pathname = pathname;

    return parsed.toString();
  } catch {
    return rawUrl.trim();
  }
}

export interface MarketVoiceLineageContext {
  accountId: string;
  campaignId: string;
  campaignOfferingId: string;
}

/**
 * Validates that child record lineage strictly matches the parent discovery context.
 */
export function validateMarketVoiceLineage(
  parent: MarketVoiceLineageContext,
  child: MarketVoiceLineageContext
): { valid: boolean; reason?: string } {
  if (parent.accountId !== child.accountId) {
    return { valid: false, reason: `accountId mismatch: parent=${parent.accountId} child=${child.accountId}` };
  }
  if (parent.campaignId !== child.campaignId) {
    return { valid: false, reason: `campaignId mismatch: parent=${parent.campaignId} child=${child.campaignId}` };
  }
  if (parent.campaignOfferingId !== child.campaignOfferingId) {
    return { valid: false, reason: `campaignOfferingId mismatch: parent=${parent.campaignOfferingId} child=${child.campaignOfferingId}` };
  }
  return { valid: true };
}

// =============================================
// PHASE 2: SEARCH PLANNER CONTRACTS
// =============================================

export const MIN_SEARCH_INTENTS_PER_JOB = 6;
export const DEFAULT_MAX_SEARCH_INTENTS_PER_JOB = 12;

export interface SearchIntentDraft {
  intentCategory: SearchIntentCategory;
  query: string;
  targetPlatform: SearchIntentPlatform;
  marketScope: "TARGET_MARKET" | "GLOBAL_CATEGORY";
  targetGeography: string | null;
  languageHint: string | null;
  reasonForSearch: string;
  discoveryGoal: string;
}

export interface SearchPlanPackage {
  discoveryJobId: string;
  accountId: string;
  campaignId: string;
  campaignOfferingId: string;
  intents: SearchIntentDraft[];
  plannerRationale: string;
}

export interface SearchPlanJudgeDecision {
  candidateKey: string; // e.g. "intent_1", "intent_2"
  intentQuery: string;
  relevance: boolean;
  offeringSpecificity: boolean;
  temporalRelevance: boolean;
  neutrality: boolean;
  diversity: boolean;
  marketScopeValid: boolean;
  platformFit: boolean;
  intentCategoryFit: boolean;
  competitorDiscoverySeparation: boolean;
  status: "APPROVED" | "REPAIR_REQUIRED" | "REJECTED";
  critique?: string;
}

export interface SearchPlanJudgeReport {
  overallDecision: "APPROVED" | "REPAIR_REQUIRED" | "REJECTED";
  budgetValid: boolean;
  totalIntentsEvaluated: number;
  decisions: SearchPlanJudgeDecision[];
  summary: string;
  repairInstructions?: string;
}

export interface SearchPlanValidationResult {
  valid: boolean;
  errors: string[];
  intents?: SearchIntentDraft[];
}

export interface MarketVoicePlannerContext {
  accountId: string;
  campaignId: string;
  campaignOfferingId: string;
  offeringName: string;
  heroProductCanonicalText: string;
  heroProductAuthoritySource: string;
  heroProductAuthorityId: string;
  category?: string | null;
  targetMarketGeography?: string | null;
  currentDate?: string;
  currentYear?: number;
  businessUnderstanding?: {
    businessName?: string;
    industry?: string;
    coreOffering?: string;
    targetAudience?: string;
    geographicFocus?: string;
  } | null;
  productAnchor?: {
    name?: string;
    type?: string;
    keyAttributes?: string[];
    problemSolved?: string;
    uniqueMechanism?: string;
    differentiatingFeature?: string;
  } | null;
  maxIntentsPerJob?: number;
}

// =============================================
// PHASE 3: PROVIDER SEARCH DISCOVERY CONTRACTS
// =============================================

export interface RawDiscoveryResultDraft {
  url: string;
  canonicalUrl: string;
  title?: string | null;
  snippet?: string | null;
  sourcePlatform: string;
  discoveredType: DiscoveredContentType;
  verificationStatus?: DiscoveryResultStatus;
  externalItemId?: string | null;
  providerRunId?: string | null;
  providerDatasetId?: string | null;
  authorIdentifier?: string | null;
  publishedAt?: string | Date | null;
  metadata?: Record<string, any>;
}

export interface IntentExecutionTelemetry {
  searchIntentId: string;
  targetPlatform: SearchIntentPlatform;
  approvedQuery: string;
  providerQuery: string;
  query: string; // for backward compatibility, equals approvedQuery
  status: SearchIntentExecutionStatus;
  provider: string;
  providerRunId?: string | null;
  requestedResultLimit: number;
  resultsReceived: number;
  resultsPersisted: number;
  runtimeMs: number;
  retryCount: number;
  budgetRemaining: number;
  error?: string | null;
}

export interface DiscoveryJobExecutionSummary {
  discoveryJobId: string;
  status: DiscoveryJobStatus;
  totalIntents: number;
  executedIntents: number;
  successfulIntents: number;
  failedIntents: number;
  unavailableIntents: number;
  totalResultsDiscovered: number;
  totalResultsPersisted: number;
  telemetry: IntentExecutionTelemetry[];
  budgetRemaining: number;
}

// =============================================
// PHASE 4: EVIDENCE FETCHING & VERIFICATION CONTRACTS
// =============================================

export type ContentAuthorRole =
  | "CUSTOMER_COMMUNITY_USER"
  | "BRAND_REPRESENTATIVE"
  | "SEO_CONTENT_WRITER"
  | "SPAM_OR_BOT"
  | "UNKNOWN";

export type CustomerVoiceEligibilityStatus =
  | "ELIGIBLE_CUSTOMER_VOICE"
  | "NOT_CUSTOMER_VOICE"
  | "GENERIC_NOISE"
  | "PROMOTIONAL_CONTENT"
  | "INSUFFICIENT_EVIDENCE";

export type EvidenceJudgeVerdict =
  | "APPROVE"
  | "REJECT"
  | "INSUFFICIENT_EVIDENCE";

export type FetchExecutionStatus =
  | "FETCHED"
  | "FETCH_FAILED"
  | "FETCH_CAPABILITY_MISSING"
  | "SOURCE_UNAVAILABLE";

export interface FetchedContentItem {
  itemId: string;
  sourceUrl: string;
  sourcePlatform: string;
  verbatimText: string;
  authorIdentifier?: string | null;
  publishedAt?: Date | null;
  likesCount?: number;
  extractedRole?: ContentAuthorRole;
  languageHint?: string | null;
  geographyHint?: string | null;
  metadata?: Record<string, any>;
}

export interface FetchedSourceResult {
  discoveryResultId: string;
  url: string;
  canonicalUrl: string;
  sourcePlatform: string;
  fetchStatus: FetchExecutionStatus;
  rawHtml?: string;
  pageTitle?: string;
  isCompetitorSource?: boolean;
  matchedCompetitorId?: string | null;
  contentItems: FetchedContentItem[];
  error?: string | null;
}

export interface AuthorshipVerificationResult {
  authorRole: ContentAuthorRole;
  confidence: number;
  reasoning: string;
  isCustomerAuthored: boolean;
}

export interface CustomerVoiceEligibilityResult {
  eligibility: CustomerVoiceEligibilityStatus;
  isEligible: boolean;
  voiceType?: "EXPERIENCE" | "COMPLAINT" | "QUESTION" | "COMPARISON" | "HESITATION" | "RECOMMENDATION" | "OUTCOME" | "OTHER";
  reasoning: string;
  detectedGeography?: string | null;
  detectedLanguage?: string | null;
}

export interface EvidenceJudgeDecision {
  verdict: EvidenceJudgeVerdict;
  sourceScope: SourceScope;
  marketScope: MarketScope;
  canonicalOwner: "market_voice_evidence" | "ci_competitor_comments" | "UNRESOLVED";
  geography: string | null;
  language: string | null;
  finalReason: string;
  rejectionReason?: string | null;
}

export interface VerifiedEvidenceItemResult {
  evidenceId: string;
  discoveryResultId: string;
  searchIntentId: string;
  discoveryJobId: string;
  accountId: string;
  campaignId: string;
  campaignOfferingId: string;
  verbatimText: string;
  sourceScope: SourceScope;
  marketScope: MarketScope;
  platform: string;
  externalUrl?: string | null;
  externalId?: string | null;
  authorHash?: string | null;
  likesCount: number;
  publishedAt?: Date | null;
  geography: string | null;
  language: string | null;
  judgeVerdict: EvidenceJudgeVerdict;
  judgeReason: string;
  persisted: boolean;
}

export interface MarketVoicePhase4ExecutionSummary {
  discoveryJobId: string;
  totalDiscoveryResults: number;
  fetchableResults: number;
  fetchedContentItems: number;
  customerCandidates: number;
  judgeApproved: number;
  rejected: number;
  insufficient: number;
  canonicalEvidencePersisted: number;
  evidenceItems: VerifiedEvidenceItemResult[];
  rejectionBreakdown: Record<string, number>;
  fetchFailureBreakdown: Record<string, number>;
  batchCount?: number;
  batchSizes?: number[];
  unprocessedResults?: number;
}




