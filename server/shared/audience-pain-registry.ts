import { randomUUID } from 'crypto';
import crypto from "crypto";

export type AudiencePainClass =
  | "CORE_PURCHASE"
  | "OBJECTION"
  | "POST_PURCHASE_FRICTION"
  | "SUPPORTING"
  | "UNKNOWN"
  | "NOT_EVALUATED";

export type PainUse =
  | "positioning"
  | "differentiation"
  | "mechanism"
  | "offer_core"
  | "offer_objection"
  | "awareness"
  | "funnel"
  | "persuasion"
  | "channel"
  | "retention";

export const DETERMINISTIC_CLASSIFIER_VERSION = "deterministic_v1";
export const LLM_CLASSIFIER_VERSION = "strategic_pain_pipeline_v3";

export type EvidenceContextMap = Map<string, { label: string; detail: string; [key: string]: any }>;

export type ProductFitType = "DIRECT_FIT" | "STRATEGIC_FIT" | "NOT_FIT" | "UNKNOWN";

export type CompetitorRelationshipScope =
  | "DIRECT_COMPETITOR"
  | "ADJACENT_ALTERNATIVE"
  | "CATEGORY_TOOL"
  | "GENERAL_MARKET";

export type PassageSupportVerdict =
  | "NEGATIVE_COMPLAINT_PASSAGE"
  | "MIXED_COMPLAINT_IN_POSITIVE_REVIEW"
  | "FEATURE_PRAISE_IN_LOW_RATING"
  | "POSITIVE_PRAISE_MISMATCH"
  | "UNRELATED_PASSAGE";

export interface GroundedPainEvidence {
  evidenceUid: string;
  rawEvidenceUids: string[];
  canonicalEvidenceId: string;
  actorType: "CUSTOMER" | "MARKET_VOICE" | "COMPETITOR";
  authorityClass: string;
  sourceType: string;
  sourceIdentity?: string;
  author?: string;
  url?: string;
  timestamp?: string;
  subjectBusinessOrProduct?: string;
  verbatimText: string;
  supportingPassage?: string;
  passageSupportVerdict?: PassageSupportVerdict;
  competitorRelationshipScope?: CompetitorRelationshipScope;
  boundedExcerpt: string;
  origin?: "MARKET_VOICE" | "COMPETITOR_COMMENT" | "COMPETITOR_REVIEW" | "BENCHMARK";
  competitorId?: string;
  competitorName?: string;
  offeringId?: string;
  productOrVariantScope?: string;
  semanticScope?: string;
  transferability?: string;
  isAllegation?: boolean;
  rawEvidenceReference?: {
    table: "market_voice_evidence" | "ci_competitor_comments" | "ci_competitor_reviews";
    id: string;
  };
}

export interface ConflictingPainEvidence {
  evidenceUid: string;
  verbatimText: string;
  supportingPassage?: string;
  reason: string;
  subjectBusinessOrProduct?: string;
}

export type GroundedMateriality = {
  mode: "GROUNDED";
  evidence: [GroundedPainEvidence, ...GroundedPainEvidence[]];
  rawEvidenceUids: string[];
  rawCitationCount: number;
  uniqueEvidenceCount: number;
  sourceTypes: string[];
  uniqueCompetitorCount?: number;
  conflictingEvidence?: ConflictingPainEvidence[];
  competitorRelationshipScopes?: CompetitorRelationshipScope[];
};

export type NonEmpiricalMateriality = {
  mode: "NONE";
  evidence?: [];
  rawEvidenceUids?: [];
  rawCitationCount?: 0;
  uniqueEvidenceCount?: 0;
  sourceTypes?: [];
  uniqueCompetitorCount?: 0;
  conflictingEvidence?: ConflictingPainEvidence[];
  competitorRelationshipScopes?: CompetitorRelationshipScope[];
};

export type StrategicPainMateriality = GroundedMateriality | NonEmpiricalMateriality;

export type CanonicalEvidenceRegistry = Map<string, {
  label?: string;
  detail?: string;
  verbatimText?: string;
  text?: string;
  platform?: string;
  source?: string;
  url?: string;
  externalUrl?: string;
  externalId?: string;
  author?: string;
  authorHash?: string;
  sourceActor?: string;
  actorType?: string;
  authorType?: string;
  authorRole?: string;
  sourceScope?: string;
  marketScope?: string;
  authorityClass?: string;
  rating?: number;
  sentiment?: string;
  sentimentPolarity?: string;
  createdAt?: string;
  timestamp?: string;
  competitorRelationshipScope?: CompetitorRelationshipScope;
  [key: string]: any;
}>;

export interface CandidateAudiencePain {
  painId: string;
  claimId?: string;
  canonical: string;
  originalStatement?: string;
  role?: string;
  strategicRole?: string;
  roleClaimId?: string;
  segmentId?: string;
  segmentName?: string;
  segmentIds?: string[];
  segmentDefinition?: string;
  segmentDefClaimId?: string;
  evidenceUids: string[];
  evidenceIds?: string[];
  sourceSignalIds?: string[];
  sourceTypes?: string[];
  rootCauseIds?: string[];
  [key: string]: any;
}

export function normalizePainText(text: string): string {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export function computePainContentHash(text: string): string {
  const norm = normalizePainText(text);
  return crypto.createHash("sha256").update(norm).digest("hex").slice(0, 16);
}

export function computeEvidenceHash(evidenceUids: string[] = []): string {
  const sorted = [...evidenceUids].map(u => String(u).trim()).filter(Boolean).sort().join(",");
  return crypto.createHash("sha256").update(sorted).digest("hex").slice(0, 16);
}

export function buildPainCompositeKey(
  optsOrAccountId: {
    campaignId?: string;
    accountId?: string;
    audienceSnapshotId?: string;
    segmentId?: string;
    painId?: string;
    claim?: string;
    canonical?: string;
    contentHash?: string;
    evidenceUids?: string[];
    evidenceHash?: string;
  } | string,
  maybeSnapId?: string,
  maybePainId?: string,
  maybeHashOrClaim?: string,
  maybeSegmentId?: string
): string {
  if (typeof optsOrAccountId === "object" && optsOrAccountId !== null) {
    const text = optsOrAccountId.canonical || optsOrAccountId.claim || "";
    const hash = optsOrAccountId.contentHash || computePainContentHash(text);
    const snap = optsOrAccountId.audienceSnapshotId || "global";
    const pid = optsOrAccountId.painId || "unknown";
    const seg = optsOrAccountId.segmentId ? `:${optsOrAccountId.segmentId}` : "";
    const evHash = optsOrAccountId.evidenceHash || (optsOrAccountId.evidenceUids && optsOrAccountId.evidenceUids.length > 0 ? `:${computeEvidenceHash(optsOrAccountId.evidenceUids)}` : "");
    return `${snap}${seg}:${pid}:${hash}${evHash}`;
  }

  const snap = maybeSnapId || "global";
  const pid = maybePainId || "unknown";
  const hashOrClaim = maybeHashOrClaim || "";
  const hash = hashOrClaim.length === 16 && /^[0-9a-f]+$/i.test(hashOrClaim)
    ? hashOrClaim
    : computePainContentHash(hashOrClaim);
  const seg = maybeSegmentId ? `:${maybeSegmentId}` : "";
  return `${snap}${seg}:${pid}:${hash}`;
}

interface BaseAuthoritativeAudiencePain {
  painId: string;
  canonical: string;
  /** Content-addressed stable hash of normalized canonical text */
  contentHash?: string;
  /** Content-addressed stable hash of sorted supporting evidence UIDs */
  evidenceHash?: string;
  /** Composite identity key incorporating audienceSnapshotId + segmentId + painId + contentHash + evidenceHash */
  compositeKey?: string;
  /** Verbatim source wording exactly as supplied by the Audience engine. */
  originalStatement: string;
  /** Normalized form (lowercase, collapsed non-alphanumerics) used for stable ID derivation. */
  normalizedStatement: string;
  classification: AudiencePainClass;
  rank: number;
  productFit: "ELIGIBLE" | "INELIGIBLE" | "UNKNOWN";
  /** Granular Product Fit Taxonomy distinguishing direct vs strategic fit */
  fitType?: ProductFitType;
  /** Explains how existing Product Truth addresses an upstream strategic cause of the pain */
  strategicBridge?: string;

  /** Explicit statement of what the product does NOT solve (boundary enforcement) */
  boundary?: string;
  /** Exact Product Truth fact IDs cited to justify fit */
  productTruthFactIds?: string[];
  /** Structural ID for the Product Fit decision */
  productFitAuthorityId?: string;
  /** Whether the associated role is covered by Target Authority */
  targetCovered?: boolean;
  /** Target coverage semantic decision */
  coverageDecision?: "COVERED" | "RELATED_BUT_UNPROVEN" | "NOT_COVERED";
  /** Structural ID for the Target Coverage decision */
  targetCoverageAuthorityId?: string;
  eligible: boolean;
  allowedUses: PainUse[];
  prohibitedUses: PainUse[];
  evidenceUids: string[];
  sourceSignalIds: string[];
  /** Structural ID for the final CORE Strategic Priority decision */
  coreDecisionId?: string;
  strategicPainDecisionAuthorityId?: string;
  targetAssessmentAuthorityId?: string;
  productAssessmentAuthorityId?: string;
  targetUnderstandingAuthorityId?: string;
  businessUnderstandingAuthorityId?: string;
  campaignOfferingId?: string;
  segmentId?: string;
  /** Source channel/type labels carried from the Audience signal (e.g. review, comment). */
  sourceTypes: string[];
  /** DEPRECATED: Non-authoritative backward compatibility field. Never used for semantic gating. */
  evidenceStrength?: number;
  /** Factual count of total citations across evidence UIDs and source signals */
  citationCount?: number;
  /** Factual count of unique evidence UIDs */
  uniqueEvidenceCount?: number;
  /** Factual count of unique source types/channels */
  uniqueSourceCount?: number;
  /** Factual count of unique competitors or source entities */
  uniqueCompetitorCount?: number;
  /** Factual occurrence count */
  occurrenceCount?: number;
  /** Grounded evidence quotes / summaries if available */
  evidenceSummaries?: string[];
  /** Claim/passage-level supporting excerpts extracted from verbatim evidence */
  supportingPassages?: string[];
  /** Canonical buyer role/segment affected by this pain */
  affectedBuyer?: string;
  /** Purchase or usage context in which this pain occurs */
  context?: string;
  /** Explicit scope & prevalence limitations (e.g. single competitor vs category tool vs general market) */
  prevalenceLimitations?: string[];
  /** Conflicting or positive evidence excluded from pain support */
  conflictingEvidence?: ConflictingPainEvidence[];
  /** Competitor relationship scopes represented in the supporting evidence */
  competitorRelationshipScopes?: CompetitorRelationshipScope[];
  /** AEL root-cause identifiers behind this pain, where the Audience engine supplied them. */
  rootCauseIds: string[];
  /** Dynamic target audience segments associated with this pain. */
  segmentIds: string[];
  /** Segment name if available */
  segmentName?: string;
  /** Strategic role designation (e.g. CORE_BUYER, CORE_USER, OBJECTION) */
  strategicRole?: string;
  /** Which classifier produced `classification` (initial_neutral_registry | strategic_pain_pipeline_v3). */
  classifierVersion: string;
  /** Human-auditable reason for the classification decision. */
  classificationReason: string;
  lineage: { accountId: string; audienceSnapshotId: string };
}

export interface GroundedAuthoritativeAudiencePain extends BaseAuthoritativeAudiencePain {
  materiality: GroundedMateriality;
}

export interface NonEmpiricalAuthoritativeAudiencePain extends BaseAuthoritativeAudiencePain {
  evidenceUids: [];
  materiality: NonEmpiricalMateriality;
}

export type AuthoritativeAudiencePain =
  | GroundedAuthoritativeAudiencePain
  | NonEmpiricalAuthoritativeAudiencePain;

export interface MarketPainPortfolio {
  campaignId: string;
  accountId: string;
  audienceSnapshotId: string;
  pains: AuthoritativeAudiencePain[];
}

export interface PainPortfolioViews {
  marketPortfolio: MarketPainPortfolio;
  productAligned: AuthoritativeAudiencePain[];
  generalMarket: AuthoritativeAudiencePain[];
  reconciliation: {
    total: number;
    directFit: number;
    strategicFit: number;
    notFit: number;
    unknown: number;
    sumMatchesTotal: boolean;
  };
}

export interface PainRegistryValidation {
  valid: boolean;
  issues: string[];
}

const USES_BY_CLASS: Record<AudiencePainClass, PainUse[]> = {
  CORE_PURCHASE: ["positioning", "differentiation", "mechanism", "offer_core", "awareness", "funnel", "persuasion", "channel"],
  OBJECTION: ["offer_objection", "awareness", "funnel", "persuasion"],
  POST_PURCHASE_FRICTION: ["retention"],
  SUPPORTING: ["awareness", "funnel", "persuasion", "channel"],
  UNKNOWN: [],
  NOT_EVALUATED: [],
};

export function allowedUsesForClass(classification: AudiencePainClass): PainUse[] {
  return [...(USES_BY_CLASS[classification] || [])];
}

export function prohibitedUsesForClass(classification: AudiencePainClass): PainUse[] {
  const allowed = USES_BY_CLASS[classification] || [];
  return (Object.keys(USES_BY_CLASS) as AudiencePainClass[])
    .flatMap((kind) => USES_BY_CLASS[kind])
    .filter((use, position, all) => all.indexOf(use) === position && !allowed.includes(use));
}

function painText(pain: any): string {
  return typeof pain === "string"
    ? pain
    : String(pain?.canonical ?? pain?.claim ?? pain?.pain ?? pain?.text ?? pain?.label ?? pain?.name ?? "").trim();
}

export function normalizeStatement(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function stableId(snapshotId: string, text: string): string {
  const normalized = normalizeStatement(text);
  return `pain_${crypto.createHash("sha256").update(`${snapshotId}:${normalized}`).digest("hex").slice(0, 16)}`;
}


function values(value: any): string[] {
  const raw = Array.isArray(value) ? value : value == null ? [] : [value];
  return raw.map((item) => {
    if (typeof item === "string") return item;
    return item?.uid ?? item?.evidenceUid ?? item?.id ?? item?.signalId ?? item?.rootCauseId ?? "";
  }).filter((item): item is string => typeof item === "string" && item.length > 0);
}

/**
 * Extract canonical Judge-approved pain claims directly from audienceSegments.
 * Preserves claimId, canonical text, evidenceIds, segment context, and role.
 * Does NOT perform fuzzy text matching or merge with legacy painMap.
 */
export function extractCanonicalSegmentPains(segments: any[]): any[] {
  if (!Array.isArray(segments) || segments.length === 0) return [];
  const claimIdOccurrences = new Map<string, number>();
  segments.forEach((seg: any) => {
    const pains = Array.isArray(seg?.pains) ? seg.pains : [];
    pains.forEach((p: any) => {
      const cid = typeof p === "object" ? (p.claimId || p.painId || p.id) : undefined;
      if (cid) {
        claimIdOccurrences.set(String(cid), (claimIdOccurrences.get(String(cid)) || 0) + 1);
      }
    });
  });

  const extracted: any[] = [];
  segments.forEach((seg: any, sIdx: number) => {
    const segName = seg.name ? String(seg.name).trim() : `Segment ${sIdx + 1}`;
    // Audience owns segment identity: consume canonical seg.id directly
    const segId = seg.id || `seg_legacy_${sIdx + 1}`;
    const role = seg.role || seg.roleClaim?.value || seg.demographics?.role || "PRACTITIONER";
    const roleClaimId = seg.roleClaim?.claimId || seg.roleClaimId;
    const segmentDefinition = typeof seg.segmentDefinition === "object" ? seg.segmentDefinition?.claim : seg.segmentDefinition;
    const segmentDefClaimId = typeof seg.segmentDefinition === "object" ? seg.segmentDefinition?.claimId : undefined;

    const pains = Array.isArray(seg.pains) ? seg.pains : [];
    pains.forEach((p: any, pIdx: number) => {
      const claimText = typeof p === "string" ? p : (p.description || p.claim || p.text || p.canonical || p.pain || "");
      if (!claimText || String(claimText).trim().length === 0) return;
      const cleanClaim = String(claimText).trim();
      const rawClaimId = typeof p === "object" ? (p.claimId || p.painId || p.id) : undefined;
      const canonicalClaimId = typeof p === "object" ? (p.canonicalClaimId || rawClaimId) : undefined;
      const isSharedClaimId = rawClaimId && (claimIdOccurrences.get(String(rawClaimId)) || 0) > 1;
      const resolvedPainId = rawClaimId
        ? isSharedClaimId && !String(rawClaimId).startsWith(`${segId}_`)
          ? `${segId}_${rawClaimId}`
          : String(rawClaimId)
        : `pain_${sIdx + 1}_${pIdx + 1}`;
      const evidenceIds = typeof p === "object" ? (p.evidenceIds || p.evidenceUids || p.evidence || []) : [];

      extracted.push({
        painId: resolvedPainId,
        claimId: resolvedPainId,
        ...(canonicalClaimId ? { canonicalClaimId } : {}),
        canonical: cleanClaim,
        originalStatement: cleanClaim,
        role,
        strategicRole: role,
        roleClaimId,
        segmentId: segId,
        segmentName: segName,
        segmentIds: [segId],
        segmentDefinition,
        segmentDefClaimId,
        evidenceUids: Array.isArray(evidenceIds) ? evidenceIds : [evidenceIds],
        evidenceIds: Array.isArray(evidenceIds) ? evidenceIds : [evidenceIds],
      });
    });
  });
  return extracted;
}

export function isCompetitorAuthoredContent(ev: any): boolean {
  const actor = String(ev.sourceActor || ev.actorType || ev.authorType || "").toUpperCase();
  if (actor === "COMPETITOR" || actor === "BRAND" || actor === "COMPETITOR_OFFICIAL") {
    return true;
  }
  const authClass = String(ev.authorityClass || "").toUpperCase();
  if (authClass === "COMPETITOR_ASSET" || authClass === "COMPETITOR_POST" || authClass === "COMPETITOR_MARKETING") {
    return true;
  }
  const authorRole = String(ev.authorRole || "").toUpperCase();
  if (authorRole === "COMPETITOR") {
    return true;
  }
  return false;
}

export function decodeHtmlEntities(text: string): string {
  return String(text || "")
    .replace(/&#39;|&#x27;|&apos;/gi, "'")
    .replace(/&quot;|&#34;|&#x22;/gi, '"')
    .replace(/&amp;|&#38;|&#x26;/gi, "&")
    .replace(/&lt;|&#60;|&#x3c;/gi, "<")
    .replace(/&gt;|&#62;|&#x3e;/gi, ">")
    .replace(/&nbsp;|&#160;/gi, " ");
}

export function detectCustomerEvidenceQualifications(verbatim: string, ev?: any): {
  isAllegation: boolean;
  productOrVariantScope?: string;
} {
  const decoded = decodeHtmlEntities(verbatim);
  const explicitAllegation = ev?.isAllegation === true;
  const allegationPattern = /\b(bezelye\s+püresi\w*|pea\s+puree|kakalamış\w*|sahte\s+fıstık|fake\s+pistachio|artificial\s+dye|food\s+coloring|gıda\s+boyası|adulterat\w*|substituted\s+with|instead\s+of\s+real\s+pistachio|boyalı\s+yer\s+fıstığı|allegedly|iddia\s+ediyor\w*)\b/i;
  const isAllegation = explicitAllegation || allegationPattern.test(decoded);

  let productOrVariantScope: string | undefined =
    ev?.productOrVariantScope || ev?.productScope || ev?.variantScope || undefined;
  if (!productOrVariantScope) {
    if (/\b(marketlerde\s+gördüğüm\s+plastik\s+paket\w*|plastik\s+paketteki\s+baklava\w*|plastic[- ]packaged\s+baklava|supermarket\s+plastic\s+pack\w*)\b/i.test(decoded)) {
      productOrVariantScope = "supermarket plastic-packaged baklava variant";
    } else if (ev?.offeringId && String(ev.offeringId).trim().length > 0) {
      productOrVariantScope = String(ev.offeringId).trim();
    }
  }

  return { isAllegation, productOrVariantScope };
}

export function extractCanonicalEvidenceIdentity(ev: any, uid: string, verbatim: string): string {
  // 1. Stable canonical customer-voice identity (cev_*) already present in registry
  const rawCanon = String(ev?.canonicalEvidenceId || ev?.evidenceId || "").trim();
  if (rawCanon.length > 0 && !/^(?:ext:)?(?:ev|cluster)[-_:]\d+$/i.test(rawCanon)) {
    if (rawCanon.startsWith("cev_") || rawCanon.startsWith("canon:") || rawCanon.startsWith("rev:") || rawCanon.startsWith("post:") || rawCanon.startsWith("hash:")) {
      return rawCanon;
    }
    return `canon:${rawCanon}`;
  }

  // 2. Canonical source review / comment permalink ID from URL
  const urlStr = String(ev.url || ev.externalUrl || "");
  const reviewMatch = urlStr.match(/reviews\/([a-zA-Z0-9_-]+)/i);
  if (reviewMatch && reviewMatch[1]) {
    return `rev:${reviewMatch[1].toLowerCase()}`;
  }
  const commentPermalinkMatch = urlStr.match(/comment\/([a-zA-Z0-9_-]+)/i);
  if (commentPermalinkMatch && commentPermalinkMatch[1]) {
    return `post:${commentPermalinkMatch[1].toLowerCase()}`;
  }
  const threadMatch = urlStr.match(/comments\/([a-zA-Z0-9_-]+)/i);
  if (threadMatch && threadMatch[1] && !ev.canonicalEvidenceId) {
    const decodedNorm = decodeHtmlEntities(verbatim).toLowerCase().replace(/\s+/g, " ").trim();
    const shortHash = crypto.createHash("sha256").update(decodedNorm).digest("hex").slice(0, 8);
    return `post:${threadMatch[1].toLowerCase()}:${shortHash}`;
  }

  // 3. externalId / provider canonical ID (excluding synthetic EV-xxx / CLUSTER-xxx selector UIDs)
  const rawExt = String(ev.externalId || "").trim();
  if (rawExt.length > 0 && !/^(?:ev|cluster)[-_:]\d+$/i.test(rawExt)) {
    return `ext:${rawExt.toLowerCase()}`;
  }

  // 4. Scoped exact normalized-text hash fallback (HTML-entity decoded)
  const normText = decodeHtmlEntities(verbatim).toLowerCase().replace(/\s+/g, " ").trim();
  const textHash = crypto.createHash("sha256").update(normText).digest("hex").slice(0, 16);
  const platformScope = String(ev.platform || ev.source || "gen").toLowerCase();
  const authorScope = String(ev.author || ev.authorHash || "anon").slice(0, 8).toLowerCase();
  return `hash:${platformScope}:${authorScope}:${textHash}`;
}

export function classifyCompetitorRelationshipScope(
  ev: any,
  verbatim: string,
  cleanCompetitorId?: string,
): CompetitorRelationshipScope {
  if (
    ev?.competitorRelationshipScope &&
    ["DIRECT_COMPETITOR", "ADJACENT_ALTERNATIVE", "CATEGORY_TOOL", "GENERAL_MARKET"].includes(
      String(ev.competitorRelationshipScope).toUpperCase()
    )
  ) {
    return String(ev.competitorRelationshipScope).toUpperCase() as CompetitorRelationshipScope;
  }

  const combined = `${ev?.competitorName || ""} ${ev?.url || ""} ${ev?.externalUrl || ""} ${verbatim}`.toLowerCase();
  if (
    !cleanCompetitorId &&
    /\b(generator\s+app|self[- ]serve\s+tool|credit\s+pack|generation\s+credits|monthly\s+credits|token\s+credits|api\s+credits|diy\s+software\s+tool)\b/i.test(
      combined
    )
  ) {
    return "CATEGORY_TOOL";
  }
  if (
    !cleanCompetitorId &&
    /\b(freelance\s+marketplace|hire\s+a\s+freelancer|freelancer\s+platform|custom\s+commission\s+marketplace|gig\s+marketplace)\b/i.test(
      combined
    )
  ) {
    return "ADJACENT_ALTERNATIVE";
  }
  if (cleanCompetitorId || (ev?.competitorName && String(ev.competitorName).trim().length > 0)) {
    return "DIRECT_COMPETITOR";
  }
  return "GENERAL_MARKET";
}

export function evaluatePassageSupportForPain(
  verbatim: string,
  painTextStr: string,
  ev?: any,
): {
  supportsPain: boolean;
  supportingPassage: string;
  verdict: PassageSupportVerdict;
  reason: string;
} {
  const cleanVerbatim = String(verbatim || "").trim();
  const cleanPain = String(painTextStr || "").trim().toLowerCase();
  if (!cleanVerbatim) {
    return {
      supportsPain: false,
      supportingPassage: "",
      verdict: "UNRELATED_PASSAGE",
      reason: "Empty verbatim text",
    };
  }

  // Split into sentence/contrast clauses so mixed reviews (e.g. 5-star with "though/but/wish" complaint) are evaluated at the passage level
  const clauses = cleanVerbatim
    .split(/(?<=[.!?])\s+|\s+(?=(?:however|although|though|even though|but|yet|except|unfortunately|only issue|my only complaint|downside|i wish|wished)\b)/i)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

  const negativeCuePattern =
    /\b(wish|wished|unfortunately|however|though|although|but\b|issue|problem|disappointed|frustrat\w*|delay\w*|late|never\s+received|broken|couldn't|cannot|can't|hard\s+to|difficult|expensive|overpriced|hidden\s+fee|charged\s+twice|auto[- ]?renew\w*|subscription\s+trap|no\s+revision|extra\s+fee|wrong|mistake|mispronounc\w*|robotic|generic|refund|scam|waiting|took\s+too\s+long|missing|confus\w*|lack\s+of|unable\s+to|failed|failure|error|poor|bad|worst)\b/i;

  const pureDeliveryPraisePattern =
    /\b(delivered\s+in\s+\d+\s*(?:minutes|mins|hours|hrs)|super\s+fast\s+delivery|instant\s+delivery|arrived\s+right\s+on\s+time|delivered\s+earlier\s+than\s+expected|fast\s+turnaround|quick\s+delivery)\b/i;

  const pureOverallPraisePattern =
    /\b(brought\s+tears|cried\s+happy\s+tears|best\s+gift\s+ever|absolutely\s+loved\s+it|amazing\s+experience|highly\s+recommend|10\/10|five\s+stars|5\s+stars|exceeded\s+expectations|perfect\s+(?:gift|product|service|experience|result|order)|perfection|so\s+happy\s+with)\b/i;

  const isDeliveryFailurePain =
    /\b(delivery\s+(?:delay|failure|time|problem|issue)|late\s+delivery|broken\s+(?:download|link)|access\s+failure|turnaround\s+delay|never\s+arrived|missing\s+delivery)\b/i.test(
      cleanPain
    );

  // Check if any clause contains a genuine complaint/friction/hesitation
  const complaintClauses = clauses.filter((c) => negativeCuePattern.test(c));

  // Case 1: Positive delivery feedback cited for a delivery failure pain with no complaint clause
  if (
    isDeliveryFailurePain &&
    (pureDeliveryPraisePattern.test(cleanVerbatim) || pureOverallPraisePattern.test(cleanVerbatim)) &&
    complaintClauses.length === 0
  ) {
    return {
      supportsPain: false,
      supportingPassage: cleanVerbatim,
      verdict: "POSITIVE_PRAISE_MISMATCH",
      reason: "Positive delivery/customer praise cannot be used as evidence of delivery failure.",
    };
  }

  // Case 2: Purely positive review/comment with zero complaint/friction cues anywhere in the text
  const hasExplicitPurePraise =
    (pureOverallPraisePattern.test(cleanVerbatim) || pureDeliveryPraisePattern.test(cleanVerbatim)) &&
    complaintClauses.length === 0;
  if (hasExplicitPurePraise && cleanPain.length > 0) {
    return {
      supportsPain: false,
      supportingPassage: cleanVerbatim,
      verdict: "POSITIVE_PRAISE_MISMATCH",
      reason: "Purely positive praise passage with no complaint or friction statement.",
    };
  }

  // Case 3: Low-star review that praises a specific feature while complaining about something else
  if (clauses.length >= 2 && complaintClauses.length > 0 && cleanPain.length > 0) {
    const praiseClauses = clauses.filter((c) => !negativeCuePattern.test(c) && /\b(great|studio[- ]grade|amazing|excellent|loved|good|fantastic|clear|beautiful)\b/i.test(c));
    if (praiseClauses.length > 0) {
      const painTokens = cleanPain
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 4 && !["pain", "issue", "problem", "customer", "buyers", "lack", "with", "from", "that", "this"].includes(t));
      const matchesPraiseOnly =
        painTokens.length > 0 &&
        praiseClauses.some((pc) => painTokens.some((t) => pc.toLowerCase().includes(t))) &&
        !complaintClauses.some((cc) => painTokens.some((t) => cc.toLowerCase().includes(t)));
      if (matchesPraiseOnly) {
        return {
          supportsPain: false,
          supportingPassage: praiseClauses[0],
          verdict: "FEATURE_PRAISE_IN_LOW_RATING",
          reason: "Passage praises this feature while the review's complaint concerns a different issue.",
        };
      }
    }
  }

  // Case 4: Mixed review (e.g. 5-star review or positive intro with a genuine complaint clause)
  const isHighRatingOrPositive =
    (typeof ev?.rating === "number" && ev.rating >= 4) ||
    String(ev?.sentiment || ev?.sentimentPolarity || "").toUpperCase() === "POSITIVE" ||
    pureOverallPraisePattern.test(cleanVerbatim);

  if (complaintClauses.length > 0) {
    const bestPassage = complaintClauses.join(" ").trim();
    return {
      supportsPain: true,
      supportingPassage: bestPassage,
      verdict: isHighRatingOrPositive ? "MIXED_COMPLAINT_IN_POSITIVE_REVIEW" : "NEGATIVE_COMPLAINT_PASSAGE",
      reason: isHighRatingOrPositive
        ? "Extracted genuine complaint passage from mixed/high-rating review."
        : "Extracted supporting negative/friction passage.",
    };
  }

  return {
    supportsPain: true,
    supportingPassage: cleanVerbatim,
    verdict: "NEGATIVE_COMPLAINT_PASSAGE",
    reason: "Verbatim customer statement bound to pain.",
  };
}

export function bindPainEvidence(
  candidatePain: CandidateAudiencePain | { evidenceUids?: string[]; canonical?: string; [key: string]: any },
  canonicalEvidenceRegistry: CanonicalEvidenceRegistry,
): GroundedMateriality | NonEmpiricalMateriality | null {
  const rawUids = Array.isArray(candidatePain.evidenceUids) ? candidatePain.evidenceUids : [];
  const painCanonicalText = painText(candidatePain);

  if (rawUids.length === 0) {
    return {
      mode: "NONE",
      evidence: [],
      rawEvidenceUids: [],
      rawCitationCount: 0,
      uniqueEvidenceCount: 0,
      sourceTypes: [],
      uniqueCompetitorCount: 0,
      conflictingEvidence: [],
      competitorRelationshipScopes: [],
    };
  }

  const boundMap = new Map<string, GroundedPainEvidence>();
  const textDedupToCanonKey = new Map<string, string>();
  const allResolvedRawUids: string[] = [];
  const sourceTypesSet = new Set<string>();
  const distinctCompetitors = new Set<string>();
  const conflictingEvidence: ConflictingPainEvidence[] = [];
  const relationshipScopesSet = new Set<CompetitorRelationshipScope>();

  for (const uid of rawUids) {
    const ev: any = canonicalEvidenceRegistry.get(uid);
    if (!ev) continue;

    // Authorship authority check: Do NOT exclude customer reviews about competitors!
    // Competitor-authored marketing/posts are excluded.
    if (isCompetitorAuthoredContent(ev)) {
      continue;
    }

    const rawVerbatim = String(ev.verbatimText || ev.detail || ev.text || "").trim();
    if (!rawVerbatim) continue;
    const verbatim = decodeHtmlEntities(rawVerbatim);

    const cleanCompetitorId =
      ev.competitorId &&
      String(ev.competitorId).trim().length > 0 &&
      !["unknown", "market_voice", "none", "null"].includes(String(ev.competitorId).trim().toLowerCase())
        ? String(ev.competitorId).trim()
        : undefined;

    const passageCheck = evaluatePassageSupportForPain(verbatim, painCanonicalText, ev);
    if (!passageCheck.supportsPain) {
      conflictingEvidence.push({
        evidenceUid: uid,
        verbatimText: verbatim,
        supportingPassage: passageCheck.supportingPassage,
        reason: `${passageCheck.verdict}: ${passageCheck.reason}`,
        subjectBusinessOrProduct: ev.competitorName || cleanCompetitorId || ev.offeringId || undefined,
      });
      continue;
    }

    allResolvedRawUids.push(uid);

    const canonicalId = extractCanonicalEvidenceIdentity(ev, uid, verbatim);
    const platform = ev.platform || ev.source || "customer_voice";
    sourceTypesSet.add(platform);

    const normDecoded = verbatim.toLowerCase().replace(/\s+/g, " ").trim();
    const authorKey = String(ev.author || ev.authorHash || "anon").toLowerCase().trim();
    const textDedupKey = normDecoded.length >= 25
      ? `text:${normDecoded}`
      : `${String(platform).toLowerCase()}|${authorKey}|${normDecoded}`;

    if (cleanCompetitorId) {
      distinctCompetitors.add(cleanCompetitorId);
    }

    const relScope = classifyCompetitorRelationshipScope(ev, verbatim, cleanCompetitorId);
    relationshipScopesSet.add(relScope);

    const mappedCanonKey = textDedupToCanonKey.get(textDedupKey) || canonicalId;
    const existing = boundMap.get(mappedCanonKey);
    if (existing) {
      if (!existing.rawEvidenceUids.includes(uid)) {
        existing.rawEvidenceUids.push(uid);
      }
      if (!existing.competitorId && cleanCompetitorId) {
        existing.competitorId = cleanCompetitorId;
      }
      if (!existing.competitorName && (ev.competitorName || ev.observedSubjectName)) {
        existing.competitorName = ev.competitorName || ev.observedSubjectName;
      }
    } else {
      textDedupToCanonKey.set(textDedupKey, canonicalId);
      const author = ev.author || ev.authorHash;
      const label = ev.label || (ev.platform ? `${ev.platform}${author ? ` - Customer ${String(author).slice(0, 8)}` : ""}` : "Customer Review");

      let bounded = passageCheck.supportingPassage || verbatim;
      const maxChars = 280;
      if (bounded.length > maxChars) {
        const cutpoint = bounded.lastIndexOf(".", maxChars);
        bounded = cutpoint > maxChars * 0.5 ? bounded.slice(0, cutpoint + 1) : bounded.slice(0, maxChars) + "…";
      }

      const qualifications = detectCustomerEvidenceQualifications(verbatim, ev);
      const actorType: "CUSTOMER" | "MARKET_VOICE" | "COMPETITOR" =
        ev.origin === "MARKET_VOICE" || ev.actorType === "MARKET_VOICE" ? "CUSTOMER" : "CUSTOMER";

      const observedSubjectName =
        (ev.competitorName && String(ev.competitorName).trim().length > 0 ? String(ev.competitorName).trim() : undefined) ||
        (ev.observedSubjectName && String(ev.observedSubjectName).trim().length > 0 ? String(ev.observedSubjectName).trim() : undefined);
      const observedSubjectDomain =
        ev.observedSubjectDomain && String(ev.observedSubjectDomain).trim().length > 0
          ? String(ev.observedSubjectDomain).trim()
          : undefined;
      const registryResolutionStatus = cleanCompetitorId
        ? "REGISTERED_COMPETITOR"
        : (observedSubjectName || observedSubjectDomain ? "OBSERVED_UNREGISTERED_SUBJECT" : (ev.registryResolutionStatus || "UNATTRIBUTED"));

      boundMap.set(canonicalId, {
        evidenceUid: uid,
        rawEvidenceUids: [uid],
        canonicalEvidenceId: canonicalId,
        actorType,
        authorityClass: ev.authorityClass || "DIRECT_CUSTOMER_VOICE",
        sourceType: ev.sourceType || (ev.origin === "COMPETITOR_COMMENT" ? "COMMENT" : "REVIEW"),
        sourceIdentity: platform,
        author,
        url: ev.url || ev.externalUrl,
        timestamp: ev.timestamp || ev.createdAt || undefined,
        subjectBusinessOrProduct: observedSubjectName || observedSubjectDomain || cleanCompetitorId || ev.offeringId || "Category / Market",
        verbatimText: verbatim,
        supportingPassage: passageCheck.supportingPassage,
        passageSupportVerdict: passageCheck.verdict,
        competitorRelationshipScope: relScope,
        boundedExcerpt: `[${label}] "${bounded}"`,
        origin: ev.origin,
        competitorId: cleanCompetitorId,
        competitorName: observedSubjectName || observedSubjectDomain || undefined,
        observedSubjectDomain,
        registryResolutionStatus,
        offeringId: ev.offeringId || undefined,
        productOrVariantScope: qualifications.productOrVariantScope,
        semanticScope: ev.semanticScope || undefined,
        transferability: ev.transferability || undefined,
        isAllegation: qualifications.isAllegation,
        rawEvidenceReference: ev.rawEvidenceReference || undefined,
      } as any);
    }
  }

  const boundEvidenceList = Array.from(boundMap.values());

  // Fail-closed gate: Evidence-backed pain could not ground any customer evidence
  if (boundEvidenceList.length === 0) {
    return null;
  }

  const nonNullTuple: [GroundedPainEvidence, ...GroundedPainEvidence[]] = [
    boundEvidenceList[0],
    ...boundEvidenceList.slice(1),
  ];

  return {
    mode: "GROUNDED",
    evidence: nonNullTuple,
    rawEvidenceUids: allResolvedRawUids,
    rawCitationCount: allResolvedRawUids.length,
    uniqueEvidenceCount: boundEvidenceList.length,
    sourceTypes: Array.from(sourceTypesSet),
    uniqueCompetitorCount:
      typeof (candidatePain as any).uniqueCompetitorCount === "number"
        ? (candidatePain as any).uniqueCompetitorCount
        : distinctCompetitors.size,
    conflictingEvidence: conflictingEvidence.length > 0 ? conflictingEvidence : undefined,
    competitorRelationshipScopes: Array.from(relationshipScopesSet),
  };
}

export function buildAudiencePainRegistry(
  pains: any[],
  lineage: { accountId: string; audienceSnapshotId: string },
  canonicalEvidenceRegistry?: CanonicalEvidenceRegistry | any[],
  segments?: any[],
): AuthoritativeAudiencePain[] {
  let effectiveRegistry: CanonicalEvidenceRegistry | undefined = undefined;
  let effectiveSegments: any[] | undefined = segments;

  if (canonicalEvidenceRegistry instanceof Map) {
    effectiveRegistry = canonicalEvidenceRegistry;
    effectiveSegments = segments;
  } else if (Array.isArray(canonicalEvidenceRegistry)) {
    effectiveSegments = canonicalEvidenceRegistry;
    effectiveRegistry = undefined;
  } else if (canonicalEvidenceRegistry && typeof canonicalEvidenceRegistry === "object") {
    effectiveRegistry = new Map(Object.entries(canonicalEvidenceRegistry));
    effectiveSegments = segments;
  }

  const segmentIdByName = new Map<string, string>();
  const segmentNameById = new Map<string, string>();
  if (Array.isArray(effectiveSegments)) {
    effectiveSegments.forEach((seg: any, sIdx: number) => {
      if (seg) {
        const cleanName = seg.name ? String(seg.name).trim() : `Segment ${sIdx + 1}`;
        const canonicalId = seg.id || `seg_legacy_${sIdx + 1}`;
        segmentIdByName.set(cleanName.toLowerCase(), canonicalId);
        segmentNameById.set(canonicalId, cleanName);
        segmentNameById.set(cleanName, cleanName);
        if (!seg.id) seg.id = canonicalId;
      }
    });
  }

  const result = pains.flatMap((raw, index) => {
    const canonical = painText(raw);
    const suppliedClass = raw?.classification && Object.hasOwn(USES_BY_CLASS, raw.classification) && raw.classification !== "NOT_EVALUATED"
      ? raw.classification as AudiencePainClass
      : null;
    const classification: AudiencePainClass = suppliedClass ?? "NOT_EVALUATED";
    const classificationReason = typeof raw?.classificationReason === "string" && raw.classificationReason.length > 0
      ? raw.classificationReason
      : (suppliedClass ? "classification supplied by upstream registry record" : "initial unassessed pain claim");
    const classifierVersion = typeof raw?.classifierVersion === "string" && raw.classifierVersion.length > 0
      ? raw.classifierVersion
      : "initial_neutral_registry";
    const evidenceUids = values(raw?.evidenceUids ?? raw?.evidenceIds ?? raw?.evidence ?? raw?.groundingRefs);
    const sourceSignalIds = values(raw?.sourceSignalIds ?? raw?.signalIds ?? raw?.sourceSignals ?? raw?.parentSignalId);
    const sourceTypes = values(raw?.sourceTypes ?? raw?.sourceType);
    const rootCauseIds = values(raw?.rootCauseIds ?? raw?.rootCauses ?? raw?.deepCauseIds);

    // Canonical Materiality Binding & Fail-Closed Ungrounded Rejection (User Corrections 1 & 2)
    let materiality: StrategicPainMateriality | null = null;
    if (evidenceUids.length > 0 && effectiveRegistry) {
      materiality = bindPainEvidence({ ...raw, evidenceUids }, effectiveRegistry) || raw?.materiality || null;
      if (!materiality || materiality.mode !== "GROUNDED") {
        console.warn(`[AudiencePainRegistry] UNGROUNDED_EVIDENCE_EXCLUDED | painId=${raw?.painId || raw?.claimId} | canonical="${canonical}" | evidenceUids=${evidenceUids.join(",")} | reason=Could not ground evidence in canonical registry`);
        return [];
      }
    } else if (raw?.materiality) {
      materiality = raw.materiality;
    } else if (evidenceUids.length > 0) {
      materiality = {
        mode: "GROUNDED",
        evidence: Array.isArray(raw?.evidence) ? raw.evidence : [],
        rawEvidenceUids: evidenceUids,
        rawCitationCount: evidenceUids.length,
        uniqueEvidenceCount: Array.from(new Set(evidenceUids)).length,
        sourceTypes: sourceTypes,
        uniqueCompetitorCount: (raw as any)?.uniqueCompetitorCount,
      };
    } else {
      materiality = {
        mode: "NONE",
        evidence: [],
        rawEvidenceUids: [],
        rawCitationCount: 0,
        uniqueEvidenceCount: 0,
        sourceTypes: [],
        uniqueCompetitorCount: 0,
      };
    }

    const segmentIds: string[] = [];
    const rawSegIds = values(raw?.segmentIds ?? raw?.segments ?? raw?.audienceSegmentIds ?? raw?.targetSegmentIds ?? raw?.segmentId);
    if (rawSegIds.length > 0) {
      segmentIds.push(...rawSegIds);
    } else if (Array.isArray(effectiveSegments)) {
      effectiveSegments.forEach((seg: any) => {
        if (seg?.name) {
          const segId = segmentIdByName.get(seg.name.toLowerCase().trim());
          if (segId) {
            const profiles = [
              ...(Array.isArray(seg.painProfile) ? seg.painProfile : []),
              ...(Array.isArray(seg.objectionProfile) ? seg.objectionProfile : []),
              ...(Array.isArray(seg.motivationProfile) ? seg.motivationProfile : []),
              ...(Array.isArray(seg.desireProfile) ? seg.desireProfile : []),
            ].map(p => String(p).toLowerCase().trim());
            const canonicalLC = canonical.toLowerCase().trim();
            const match = profiles.some(profileText => {
              if (profileText === canonicalLC) return true;
              if (canonicalLC.includes(profileText) || profileText.includes(canonicalLC)) return true;
              const words1 = canonicalLC.split(/[^a-z0-9]+/).filter(w => w.length > 4);
              const words2 = profileText.split(/[^a-z0-9]+/).filter(w => w.length > 4);
              return words1.some(w => words2.includes(w));
            });
            if (match) {
              segmentIds.push(segId);
            }
          }
        }
      });
    }
    if (segmentIds.length === 0) {
      if (Array.isArray(effectiveSegments)) {
        segmentIds.push("UNMATCHED");
      }
    }
    const strategicRole = typeof raw?.strategicRole === "string"
      ? raw.strategicRole
      : typeof raw?.role === "string"
        ? raw.role
        : undefined;
    
    // Factual counts derived directly from structural evidence identity
    const uniqueSourceSignals = Array.from(new Set(sourceSignalIds));

    // DEPRECATED backward-compatibility field: preserved only if explicit, never fabricated as 1.0 or / 4
    const evidenceStrength = Number.isFinite(raw?.evidenceStrength)
      ? Math.max(0, Math.min(1, raw.evidenceStrength))
      : undefined;

    const effectiveMateriality: StrategicPainMateriality = materiality || {
      mode: "NONE",
      evidence: [],
      rawEvidenceUids: [],
      rawCitationCount: 0,
      uniqueEvidenceCount: 0,
      sourceTypes: [],
    };

    const makeRecordForSegment = (targetSegmentId: string | null, suffixId?: string) => {
      const segList = targetSegmentId ? [targetSegmentId] : segmentIds;
      const defaultFit: "ELIGIBLE" | "INELIGIBLE" | "UNKNOWN" = 
        raw?.productFit === "ELIGIBLE" || raw?.productFit === "INELIGIBLE" || raw?.productFit === "UNKNOWN"
          ? raw.productFit
          : "UNKNOWN";

      const productFit = raw?.productFit === "INELIGIBLE" || raw?.productFit === "UNKNOWN"
        ? raw.productFit
        : (segList.includes("UNMATCHED")
            ? "UNKNOWN"
            : (raw?.productFit === "ELIGIBLE" ? "ELIGIBLE" : defaultFit));

      const pid = suffixId 
        ? `${typeof raw?.painId === "string" ? raw.painId : (typeof raw?.claimId === "string" ? raw.claimId : stableId(lineage.audienceSnapshotId, canonical))}_${suffixId}`
        : (typeof raw?.painId === "string" ? raw.painId : (typeof raw?.claimId === "string" ? raw.claimId : stableId(lineage.audienceSnapshotId, canonical)));

      // FAIL CLOSED: UNKNOWN / NOT_EVALUATED never auto-promotes to eligible=true
      const eligible: boolean = 
        raw?.eligible !== undefined 
          ? Boolean(raw.eligible) 
          : (productFit === "ELIGIBLE" && classification !== "UNKNOWN" && classification !== "NOT_EVALUATED" && canonical.length > 0);

      // NO EARLY PERMISSIONS: allowedUses is empty until judge confirms classification and eligibility
      const allowedUses: PainUse[] = Array.isArray(raw?.allowedUses)
        ? raw.allowedUses.filter((use: unknown): use is PainUse => typeof use === "string" && (USES_BY_CLASS[classification] as string[]).includes(use))
        : (eligible && classification !== "NOT_EVALUATED" && classification !== "UNKNOWN" ? USES_BY_CLASS[classification] : []);

      const contentHash = computePainContentHash(canonical);
      const effectiveEvidenceUids = effectiveMateriality.mode === "GROUNDED" ? effectiveMateriality.rawEvidenceUids : [];
      const evidenceHash = computeEvidenceHash(effectiveEvidenceUids);
      const compositeKey = buildPainCompositeKey({
        audienceSnapshotId: lineage.audienceSnapshotId,
        segmentId: segList[0] || (targetSegmentId ?? undefined),
        painId: pid,
        contentHash,
        evidenceHash,
      });

      const relScopes = effectiveMateriality.mode === "GROUNDED"
        ? (effectiveMateriality.competitorRelationshipScopes || [])
        : [];
      const prevalenceLimitations: string[] = Array.isArray(raw?.prevalenceLimitations)
        ? [...raw.prevalenceLimitations]
        : [];
      if (relScopes.includes("CATEGORY_TOOL") && !relScopes.includes("DIRECT_COMPETITOR")) {
        prevalenceLimitations.push(
          "Grounded in general category-tool feedback (e.g., self-serve AI subscription apps); must not be transferred as a formal policy of direct personalized-gift competitors."
        );
      }
      if (relScopes.includes("ADJACENT_ALTERNATIVE") && !relScopes.includes("DIRECT_COMPETITOR")) {
        prevalenceLimitations.push(
          "Grounded in adjacent alternative/marketplace feedback; not direct competitor policy."
        );
      }
      if (effectiveMateriality.mode === "GROUNDED" && (effectiveMateriality.uniqueCompetitorCount || 0) === 1) {
        prevalenceLimitations.push(
          "Observed in customer experience for a single named competitor; not proof of universal category behavior."
        );
      }
      if (effectiveMateriality.mode === "GROUNDED" && effectiveMateriality.uniqueEvidenceCount === 1) {
        prevalenceLimitations.push(
          "Single-citation customer report; treat as an individual experience rather than universal market prevalence."
        );
      }

      const resolvedSegName = (segList[0] && segmentNameById.get(segList[0])) || raw?.segmentName || undefined;
      const affectedBuyer = raw?.affectedBuyer || resolvedSegName || strategicRole || "Target Category Buyer";
      const painContext =
        raw?.context ||
        (classification === "POST_PURCHASE_FRICTION"
          ? "Post-purchase fulfillment, delivery, or service experience"
          : classification === "OBJECTION"
            ? "Pre-purchase hesitation or checkout barrier"
            : "Core buying decision and offering evaluation");

      return {
        painId: pid,
        canonical,
        contentHash,
        evidenceHash,
        compositeKey,
        originalStatement: typeof raw?.originalStatement === "string" && raw.originalStatement.length > 0
          ? raw.originalStatement
          : canonical,
        normalizedStatement: normalizeStatement(canonical),
        classification,
        rank: Number.isFinite(raw?.rank) ? raw.rank : index + 1,
        eligibleAudience: segList.includes("UNMATCHED") ? "ALL" : (segList[0] || "ALL"),
        productFit,
        fitType: typeof raw?.fitType === "string" ? raw.fitType : "UNKNOWN",
        targetCoverageAuthorityId: raw?.targetCoverageAuthorityId,
        productFitAuthorityId: raw?.productFitAuthorityId,
        coreDecisionId: raw?.coreDecisionId,
        strategicBridge: raw?.strategicBridge,
        boundary: raw?.boundary,
        productTruthFactIds: raw?.productTruthFactIds,
        eligible,
        allowedUses,
        prohibitedUses: (Object.keys(USES_BY_CLASS) as AudiencePainClass[])
          .flatMap((kind) => USES_BY_CLASS[kind])
          .filter((use, position, all) => all.indexOf(use) === position && !allowedUses.includes(use)),
        evidenceUids: effectiveMateriality.mode === "GROUNDED" ? effectiveMateriality.rawEvidenceUids : [],
        sourceSignalIds: uniqueSourceSignals,
        sourceTypes: effectiveMateriality.mode === "GROUNDED" ? effectiveMateriality.sourceTypes : sourceTypes,
        evidenceStrength,
        citationCount: effectiveMateriality.mode === "GROUNDED" ? effectiveMateriality.rawCitationCount : 0,
        uniqueEvidenceCount: effectiveMateriality.mode === "GROUNDED" ? effectiveMateriality.uniqueEvidenceCount : 0,
        uniqueSourceCount: effectiveMateriality.mode === "GROUNDED" ? new Set(effectiveMateriality.sourceTypes).size : 0,
        uniqueCompetitorCount: effectiveMateriality.mode === "GROUNDED" ? effectiveMateriality.uniqueCompetitorCount : undefined,
        occurrenceCount: effectiveMateriality.mode === "GROUNDED" ? Math.max(1, effectiveMateriality.rawCitationCount) : 1,
        evidenceSummaries: effectiveMateriality.mode === "GROUNDED" ? effectiveMateriality.evidence.map(e => e.boundedExcerpt) : undefined,
        supportingPassages: effectiveMateriality.mode === "GROUNDED"
          ? effectiveMateriality.evidence.map(e => e.supportingPassage || e.verbatimText)
          : [],
        affectedBuyer,
        context: painContext,
        prevalenceLimitations,
        conflictingEvidence: effectiveMateriality.conflictingEvidence || [],
        competitorRelationshipScopes: relScopes,
        rootCauseIds,
        segmentId: segList[0] || (targetSegmentId ?? undefined),
        segmentIds: segList,
        segmentName: resolvedSegName,
        strategicRole,
        classifierVersion,
        classificationReason,
        lineage,
        materiality,
      } as AuthoritativeAudiencePain;
    };

    if (segmentIds.length > 1) {
      return segmentIds.map((segId, i) => makeRecordForSegment(segId, `seg${i}`));
    }
    return [makeRecordForSegment(segmentIds[0] || null)];
  });
  
  // Sort primarily by upstream rank (or appearance order) and reassign a strict sequential rank
  result.sort((a, b) => a.rank - b.rank);
  return result.map((r, i) => ({ ...r, rank: i + 1 }));
}

export function isPositiveAppreciationSignal(input: string | Record<string, any> | null | undefined): boolean {
  const raw = typeof input === "string" ? input : (input ? painText(input) : "");
  const clean = String(raw || "").trim();
  if (!clean) return false;
  return (
    /^\s*(?:some\s+|many\s+)?(?:customers|buyers|users|people|recipients|listeners|clients)\s+(?:appreciate|love|praise|enjoy|commend|celebrate|are\s+pleased|are\s+happy|are\s+grateful|express\s+(?:strong\s+)?(?:satisfaction|gratitude|appreciation))\b/i.test(clean) ||
    /\b(?:customers|buyers|users)\s+appreciate\s+that\b/i.test(clean) ||
    /\bpositive\s+customer\s+appreciation\b/i.test(clean)
  );
}

const CORE_PROBLEM_USES: ReadonlySet<PainUse> = new Set<PainUse>([
  "positioning",
  "differentiation",
  "mechanism",
  "offer_core",
]);

export function selectPainForUse(pains: any[], use: PainUse): AuthoritativeAudiencePain {
  const registry = (pains || []) as AuthoritativeAudiencePain[];
  const eligible = registry.filter((pain) => {
    const uses = Array.isArray(pain?.allowedUses) && pain.allowedUses.length > 0
      ? pain.allowedUses
      : (pain?.classification ? allowedUsesForClass(pain.classification) : []);
    return (
      uses.includes(use) &&
      pain.classification !== "UNKNOWN" &&
      pain.classification !== "NOT_EVALUATED" &&
      (pain.classification as any) !== "EXCLUDE"
    );
  });
  const nonPositiveEligible = CORE_PROBLEM_USES.has(use)
    ? eligible.filter((pain) => !isPositiveAppreciationSignal(painText(pain)))
    : eligible;
  const pool = nonPositiveEligible.length > 0 ? nonPositiveEligible : eligible;
  const primaryLaneCore = pool.find((pain: any) => pain._isPrimaryLaneCore === true);
  const pain = primaryLaneCore || pool[0];
  if (!pain) {
    throw new Error(`NO_ELIGIBLE_PAIN: No authoritative pain found for use '${use}'`);
  }
  return pain;
}

export function selectPainsForUse(pains: any[], use: PainUse): AuthoritativeAudiencePain[] {
  const registry = (pains || []) as AuthoritativeAudiencePain[];
  const eligible = registry.filter((pain) => {
    const uses = Array.isArray(pain?.allowedUses) && pain.allowedUses.length > 0
      ? pain.allowedUses
      : (pain?.classification ? allowedUsesForClass(pain.classification) : []);
    return (
      uses.includes(use) &&
      pain.classification !== "UNKNOWN" &&
      pain.classification !== "NOT_EVALUATED" &&
      (pain.classification as any) !== "EXCLUDE"
    );
  });
  if (CORE_PROBLEM_USES.has(use)) {
    const nonPositive = eligible.filter((pain) => !isPositiveAppreciationSignal(painText(pain)));
    if (nonPositive.length > 0) return nonPositive;
  }
  return eligible;
}

/**
 * Attach `selectedPainRoles` to an engine result OUTSIDE the engine entry
 * wrapper. The five pain-routing engines (positioning, differentiation,
 * mechanism, funnel, persuasion) attach roles via their entry wrappers, but
 * orchestrator snapshot-REUSE branches assign `reused.hydrated` directly and
 * skip those wrappers — without this, reuse runs would silently drop pain
 * routing from plan_json.audiencePainRoles. Selection is deterministic given
 * the registry, so re-deriving here yields the same roles a fresh run would.
 * Mirrors each wrapper's role structure exactly; keep them in lockstep.
 */
export function attachSelectedPainRoles(
  engine: "positioning" | "differentiation" | "mechanism" | "funnel" | "persuasion",
  result: any,
  painRegistry: any[] | undefined,
): void {
  if (!result || !Array.isArray(painRegistry) || painRegistry.length === 0) return;
  switch (engine) {
    case "positioning": {
      const corePain = selectPainForUse(painRegistry, "positioning");
      result.selectedPainRoles = {
        core: corePain
          ? { painId: corePain.painId, canonical: corePain.canonical, rank: corePain.rank, role: "purchase_motivation" as const, classification: corePain.classification }
          : null,
      };
      break;
    }
    case "differentiation": {
      const corePain = selectPainForUse(painRegistry, "differentiation");
      result.selectedPainRoles = {
        core: corePain
          ? { painId: corePain.painId, canonical: corePain.canonical, rank: corePain.rank, role: "core_differentiation" as const, classification: corePain.classification }
          : null,
      };
      break;
    }
    case "mechanism": {
      const corePain = selectPainForUse(painRegistry, "mechanism");
      result.selectedPainRoles = {
        core: corePain
          ? {
              painId: corePain.painId,
              canonical: corePain.canonical,
              rank: corePain.rank,
              role: "mechanism_root_cause" as const,
              classification: corePain.classification,
              rootCauseIds: corePain.rootCauseIds || [],
            }
          : null,
      };
      break;
    }
    case "funnel": {
      const funnelEligible = selectPainsForUse(painRegistry, "funnel");
      const objections = funnelEligible.filter((pain) => pain.classification === "OBJECTION");
      const primary = objections[0] ?? funnelEligible[0] ?? null;
      result.selectedPainRoles = {
        primary: primary
          ? { painId: primary.painId, canonical: primary.canonical, rank: primary.rank, role: "conversion_barrier" as const, classification: primary.classification }
          : null,
        objections: objections.map((pain) => ({
          painId: pain.painId, canonical: pain.canonical, rank: pain.rank, role: "conversion_barrier" as const, classification: pain.classification,
        })),
      };
      break;
    }
    case "persuasion": {
      const persuasionEligible = selectPainsForUse(painRegistry, "persuasion");
      const motivations = persuasionEligible.filter((pain) => pain.classification === "CORE_PURCHASE");
      const objections = persuasionEligible.filter((pain) => pain.classification === "OBJECTION");
      result.selectedPainRoles = {
        motivations: motivations.map((pain) => ({
          painId: pain.painId, canonical: pain.canonical, rank: pain.rank, role: "purchase_motivation" as const, classification: pain.classification,
        })),
        objections: objections.map((pain) => ({
          painId: pain.painId, canonical: pain.canonical, rank: pain.rank, role: "pre_purchase_objection" as const, classification: pain.classification,
        })),
      };
      break;
    }
  }
}

export function validateAudiencePainRegistry(
  pains: any,
  expected: { accountId: string; audienceSnapshotId: string },
): PainRegistryValidation {
  const issues: string[] = [];
  if (!Array.isArray(pains) || pains.length === 0) return { valid: false, issues: ["PAIN_REGISTRY_MISSING"] };
  const ids = new Set<string>();
  for (const pain of pains as AuthoritativeAudiencePain[]) {
    if (!pain?.painId || !pain?.canonical) issues.push("PAIN_ID_OR_TEXT_MISSING");
    if (ids.has(pain?.painId)) issues.push(`PAIN_ID_DUPLICATE:${pain.painId}`);
    ids.add(pain?.painId);
    if (pain?.lineage?.accountId !== expected.accountId || pain?.lineage?.audienceSnapshotId !== expected.audienceSnapshotId) {
      issues.push(`PAIN_LINEAGE_MISMATCH:${pain?.painId ?? "unknown"}`);
    }
    if (pain?.eligible && (!Array.isArray(pain?.allowedUses) || pain.allowedUses.length === 0)) {
      issues.push(`PAIN_ALLOWED_USES_MISSING:${pain.painId}`);
    }
    if (pain?.classification === "POST_PURCHASE_FRICTION" && pain.allowedUses.includes("offer_core")) {
      issues.push(`POST_PURCHASE_CORE_FORBIDDEN:${pain.painId}`);
    }
    if (pain?.classification === "POST_PURCHASE_FRICTION" && pain.allowedUses.includes("positioning")) {
      issues.push(`POST_PURCHASE_POSITIONING_FORBIDDEN:${pain.painId}`);
    }
  }
  return { valid: issues.length === 0, issues };
}

export function buildMarketPainPortfolio(
  pains: AuthoritativeAudiencePain[],
  context: { campaignId: string; accountId: string; audienceSnapshotId: string }
): MarketPainPortfolio {
  return {
    campaignId: context.campaignId,
    accountId: context.accountId,
    audienceSnapshotId: context.audienceSnapshotId,
    pains: [...pains],
  };
}

export function splitMarketPainPortfolio(
  portfolio: MarketPainPortfolio | AuthoritativeAudiencePain[],
  context?: { campaignId: string; accountId: string; audienceSnapshotId: string }
): PainPortfolioViews {
  const pains: AuthoritativeAudiencePain[] = Array.isArray(portfolio) ? portfolio : portfolio.pains;
  const ctx = Array.isArray(portfolio)
    ? (context || {
        campaignId: pains[0]?.lineage?.accountId || "",
        accountId: pains[0]?.lineage?.accountId || "",
        audienceSnapshotId: pains[0]?.lineage?.audienceSnapshotId || "",
      })
    : {
        campaignId: portfolio.campaignId,
        accountId: portfolio.accountId,
        audienceSnapshotId: portfolio.audienceSnapshotId,
      };

  const productAligned = pains.filter((p) => p.fitType === "DIRECT_FIT" || p.fitType === "STRATEGIC_FIT");
  const generalMarket = pains.filter((p) => p.fitType === "NOT_FIT" || p.fitType === "UNKNOWN" || !p.fitType);

  let directFit = 0;
  let strategicFit = 0;
  let notFit = 0;
  let unknown = 0;

  for (const p of pains) {
    if (p.fitType === "DIRECT_FIT") directFit++;
    else if (p.fitType === "STRATEGIC_FIT") strategicFit++;
    else if (p.fitType === "NOT_FIT") notFit++;
    else unknown++;
  }

  return {
    marketPortfolio: {
      campaignId: ctx.campaignId,
      accountId: ctx.accountId,
      audienceSnapshotId: ctx.audienceSnapshotId,
      pains,
    },
    productAligned,
    generalMarket,
    reconciliation: {
      total: pains.length,
      directFit,
      strategicFit,
      notFit,
      unknown,
      sumMatchesTotal: directFit + strategicFit + notFit + unknown === pains.length,
    },
  };
}

/**
 * Attaches frozen Target Coverage authority to the audience pain registry.
 * Strictly consumes previously evaluated Target Coverage matches — does NOT
 * recompute, infer, or guess target relevance from role enums or keywords.
 */
export function attachTargetCoverageToPainRegistry(
  registry: AuthoritativeAudiencePain[],
  targetCoverage: {
    status: "FULL" | "PARTIAL" | "GAP" | "NOT_EVALUATED";
    matches?: Array<{
      coverageDecision?: "COVERED" | "RELATED_BUT_UNPROVEN" | "NOT_COVERED";
      isCovered?: boolean;
      matchedSegmentNames?: string[];
    }>;
  },
  audienceSegments?: Array<{ name: string; id?: string }>
): AuthoritativeAudiencePain[] {
  if (targetCoverage.status === "GAP") {
    return registry.map((p) => ({ ...p, targetCovered: false }));
  }
  if (targetCoverage.status === "NOT_EVALUATED") {
    return registry.map((p) => ({ ...p, targetCovered: false }));
  }

  const coverageMap = new Map<string, {cov: boolean | undefined, dec: "COVERED" | "RELATED_BUT_UNPROVEN" | "NOT_COVERED"}>();
  (targetCoverage.matches || []).forEach(m => {
    const isCov = m.coverageDecision === 'COVERED' ? true : m.coverageDecision === 'RELATED_BUT_UNPROVEN' ? undefined : m.isCovered === true ? true : false;
    const dec = m.coverageDecision || (m.isCovered ? "COVERED" : "NOT_COVERED");
    (m.matchedSegmentNames || []).forEach(n => {
       const key = String(n).trim().toLowerCase();
       const existing = coverageMap.get(key);
       if (isCov === true) coverageMap.set(key, {cov: true, dec});
       else if (isCov === undefined && (!existing || existing.cov !== true)) coverageMap.set(key, {cov: undefined, dec});
       else if (isCov === false && !existing) coverageMap.set(key, {cov: false, dec});
    });
  });

  const segmentIdToName = new Map<string, string>();
  if (Array.isArray(audienceSegments)) {
    audienceSegments.forEach((seg) => {
      if (seg) {
        const cleanName = seg.name ? String(seg.name).trim() : "";
        if (seg.id && cleanName) {
          segmentIdToName.set(seg.id, cleanName);
        }
        if (cleanName) {
          segmentIdToName.set(cleanName.toLowerCase(), cleanName);
        }
      }
    });
  }

  return registry.map((pain) => {
    let isCovered: boolean | undefined = false;
    let coverageDec: "COVERED" | "RELATED_BUT_UNPROVEN" | "NOT_COVERED" | undefined = undefined;
    const segNamesToCheck: string[] = [...(pain.segmentIds || []), pain.segmentName].filter((s): s is string => typeof s === "string" && s.length > 0);
    for (const segId of segNamesToCheck) {
      const segName = segmentIdToName.get(segId) || segmentIdToName.get(segId.trim().toLowerCase()) || segId;
      const key = segName.trim().toLowerCase();
      if (coverageMap.has(key)) {
         const val = coverageMap.get(key)!;
         if (val.cov === true) {
           isCovered = true;
           coverageDec = val.dec;
           break;
         }
         if (val.cov === undefined) {
           isCovered = undefined;
           coverageDec = val.dec;
         } else if (val.cov === false) {
           isCovered = false;
           coverageDec = val.dec;
         }
      }
    }

    return {
      ...pain,
      targetCovered: isCovered,
      coverageDecision: coverageDec,
      targetCoverageAuthorityId: randomUUID(),
    };
  });
}

