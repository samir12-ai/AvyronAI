import { aiChat } from "../ai-client";
import { resolveModelForTier, DISCOVERY_MODEL_TIERS } from "./model-router";
import {
  CompetitorEntityRole,
  CompetitorClassification,
  CompetitorTier,
  CompetitorStrategicRole,
  CompetitorGeographicClassification,
  JudgeVerdict,
  IdentityVerificationResult,
  RelevanceVerificationResult,
  FinalJudgeDecision,
  CompetitorStorefront,
  SourcePageType,
  MentionedCompetitorLead,
} from "@shared/contracts/discovery-contracts";
import type { BusinessClassificationProfile } from "@shared/business-understanding-types";
import { matchesTargetMarketDomestic } from "../shared/market-localization";
import { extractAppListingIdentity, extractBrandEntityInfo, generateCanonicalEntityId, normalizeBrandName } from "./entity-resolver";

const EXCLUDED_PLATFORM_PATTERNS = [
  /(^|\.)pinterest\./i,
  /(^|\.)youtube\.com$/i,
  /(^|\.)facebook\.com$/i,
  /(^|\.)instagram\.com$/i,
  /(^|\.)tiktok\.com$/i,
  /(^|\.)twitter\.com$/i,
  /(^|\.)x\.com$/i,
  /(^|\.)linkedin\.com$/i,
  /(^|\.)wikipedia\.org$/i,
  /(^|\.)reddit\.com$/i,
  /(^|\.)quora\.com$/i,
  /(^|\.)medium\.com$/i,
  /(^|\.)tripadvisor\./i,
  /(^|\.)yelp\./i,
  /(^|\.)google\./i,
];

/**
 * Wildcard platform & aggregator domain filter.
 * Filters out social media, wikis, and non-commercial portals, while preserving specific app store product listings.
 */
export function isExcludedPlatformDomain(domain: string, fullUrl?: string): boolean {
  if (!domain) return true;
  const clean = domain.toLowerCase().trim();
  const appListing = extractAppListingIdentity(fullUrl || clean);
  if (appListing.isAppListing) return false;
  if (clean === "apps.apple.com" || clean === "itunes.apple.com" || clean === "play.google.com") {
    return true;
  }
  return EXCLUDED_PLATFORM_PATTERNS.some((pattern) => pattern.test(clean));
}

export function resolveCanonicalEntityIdForDomain(canonicalName: string, domainOrUrl: string): string {
  const { brandToken } = extractBrandEntityInfo(domainOrUrl);
  const fallbackEntityId = generateCanonicalEntityId(brandToken);
  const normName = normalizeBrandName(canonicalName);
  const nameAlignsWithDomain =
    brandToken &&
    normName &&
    (normName.includes(brandToken) || brandToken.includes(normName));
  return nameAlignsWithDomain
    ? generateCanonicalEntityId(brandToken)
    : fallbackEntityId || generateCanonicalEntityId(canonicalName);
}

/**
 * Distinguishes customer-review provenance from vendor product pages, vendor blog/comparison posts,
 * and third-party editorial/directory content.
 */
export function classifyEvidenceSourceType(
  occurrences: Array<{ url?: string; rawTitle?: string; rawSnippet?: string; searchProvider?: string }> | undefined,
  sourcePageType?: SourcePageType
): "OFFICIAL_VENDOR_SITE" | "VENDOR_BLOG_OR_COMPARISON" | "THIRD_PARTY_REVIEW_OR_DIRECTORY" | "CUSTOMER_REVIEW_EXCERPT" | "SEARCH_SNIPPET" {
  if (sourcePageType === "VENDOR_BLOG_OR_COMPARISON_POST") {
    return "VENDOR_BLOG_OR_COMPARISON";
  }
  if (sourcePageType === "THIRD_PARTY_LISTICLE_OR_REVIEW" || sourcePageType === "MEDIA_OR_GOVERNMENT_PAGE") {
    return "THIRD_PARTY_REVIEW_OR_DIRECTORY";
  }
  const list = occurrences || [];
  for (const occ of list) {
    const u = (occ.url || "").toLowerCase();
    const text = `${occ.rawTitle || ""} ${occ.rawSnippet || ""}`.toLowerCase();
    if (
      u.includes("trustpilot") ||
      u.includes("g2.com") ||
      u.includes("capterra") ||
      /\b(verified review|customer review|rated \d(\.\d)? out of 5|stars based on \d+ reviews)\b/i.test(text)
    ) {
      return "CUSTOMER_REVIEW_EXCERPT";
    }
    if (/\/(blog|articles?|news|compare|vs|alternatives)(\/|$)/i.test(u)) {
      return "VENDOR_BLOG_OR_COMPARISON";
    }
  }
  if (sourcePageType === "VENDOR_STOREFRONT_OR_PRODUCT_PAGE") {
    return "OFFICIAL_VENDOR_SITE";
  }
  return list.length > 0 ? "OFFICIAL_VENDOR_SITE" : "SEARCH_SNIPPET";
}

/**
 * Maps semantic competitor discovery classification to canonical strategic role.
 * Invariant: Fails closed. Ambiguous classifications like RELEVANT_COMPETITOR must NOT be deterministically mapped.
 * Returns UNRESOLVED for RELEVANT_COMPETITOR, unknown classifications, and insufficient evidence.
 */
export function mapClassificationToStrategicRole(
  classification: CompetitorClassification | string | undefined | null
): CompetitorStrategicRole {
  if (!classification) return "UNRESOLVED";
  switch (classification) {
    case "DIRECT_COMPETITOR":
      return "DIRECT";
    case "ADJACENT_COMPETITOR":
    case "SUBSTITUTE_COMPETITOR":
      return "ADJACENT";
    case "BENCHMARK_COMPETITOR":
      return "ASPIRATIONAL";
    case "RELEVANT_COMPETITOR":
      return "UNRESOLVED";
    default:
      return "UNRESOLVED";
  }
}

/**
 * Resolves ambiguous competitor classification (such as RELEVANT_COMPETITOR) via LLM Strategic Role Judge.
 * Fails closed to UNRESOLVED if resolution is ambiguous or fails.
 */
export async function resolveAmbiguousCompetitorStrategicRoleWithLLM(
  input: {
    candidateName: string;
    domain: string;
    evidenceText: string;
    context: CompetitorQualityCampaignContext;
  },
  options?: {
    accountId?: string;
    campaignId?: string;
    budget?: CompetitorQualityBudgetTracker;
  }
): Promise<CompetitorStrategicRole> {
  options?.budget?.recordLlmCall();

  const prompt = [
    "You are Avyron's Strategic Competitor Role Judge.",
    'Analyze candidate "' + input.candidateName + '" (' + input.domain + ") and determine its EXACT canonical Strategic Role relative to our campaign:",
    "",
    "OUR CAMPAIGN CONTEXT:",
    '- Hero Offering: "' + input.context.offeringName + '"',
    '- Category: "' + input.context.category + '"',
    '- Business / Delivery Model: "' + (input.context.classificationProfile?.offeringAndDelivery?.category || input.context.businessModel || "Unspecified") + '"',
    '- Buyer Segments: "' + (input.context.classificationProfile?.buyerSegment?.category || "Unspecified") + '"',
    '- Target Market: "' + input.context.targetMarket + '"',
    "- Target Roles: " + JSON.stringify(input.context.targetRoles || []),
    "- Canonical Product Facts: " + JSON.stringify(input.context.productTruthFacts || []),
    "",
    "CANDIDATE EVIDENCE:",
    input.evidenceText.slice(0, 1800),
    "",
    "CANONICAL STRATEGIC ROLES:",
    "- DIRECT: Direct commercial competitor offering the same or directly substitutable product/software/service to the target buyer segments.",
    "- ADJACENT: Competitor in an adjacent category or substitute workflow serving the same underlying buyer need or use case.",
    "- ASPIRATIONAL: Major global/regional category benchmark leader or reference brand.",
    "- UNRESOLVED: Insufficient or ambiguous evidence to establish role.",
    "",
    "Return ONLY valid JSON:",
    '{"strategicRole": "DIRECT" | "ADJACENT" | "ASPIRATIONAL" | "UNRESOLVED", "reasoning": "Clear explanation"}'
  ].join("\n");

  try {
    const res = await aiChat({
      model: resolveModelForTier(DISCOVERY_MODEL_TIERS.RELEVANCE_VERIFIER),
      messages: [
        { role: "system", content: "You are the Avyron Strategic Competitor Role Judge. Output JSON only." },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 400,
      response_format: { type: "json_object" },
      accountId: options?.accountId || "system",
      campaignId: options?.campaignId,
      operationType: "competitor_discovery",
      endpoint: "competitor-strategic-role-judge",
    });

    const parsed = JSON.parse(res.choices?.[0]?.message?.content || "{}");
    const validRoles: CompetitorStrategicRole[] = ["DIRECT", "ADJACENT", "ASPIRATIONAL", "UNRESOLVED"];
    return validRoles.includes(parsed.strategicRole) ? parsed.strategicRole : "UNRESOLVED";
  } catch (err: any) {
    return "UNRESOLVED";
  }
}

export interface CompetitorQualityEvidenceInput {
  candidateKey: string;
  name: string;
  domain: string;
  websiteUrl: string;
  evidenceText: string;
  storefronts?: CompetitorStorefront[];
}

export interface CompetitorQualityCampaignContext {
  businessName: string;
  offeringName: string;
  category: string;
  targetMarket: string;
  productTruthFacts: string[];
  targetRoles: string[];
  businessModel?: string;
  offeringType?: string;
  pricingModel?: string;
  classificationProfile?: BusinessClassificationProfile;
  evidenceGaps?: string[];
}

export interface CompetitorQualityEvaluationResult {
  identity: IdentityVerificationResult;
  relevance: RelevanceVerificationResult;
  judge: FinalJudgeDecision;
}

export interface CompetitorQualityBudgetTracker {
  recordLlmCall: () => void;
}

/**
 * Generic self-brand and own-product listing detector.
 * Flags occurrences where snippet/title references the client's own brand.
 * Does NOT blacklist domains.
 */
export function flagOwnProductListings(
  occurrences: any[],
  businessName: string,
  offeringName?: string
): { ownProductCount: number; competingCount: number } {
  if (!businessName || !businessName.trim()) {
    return { ownProductCount: 0, competingCount: occurrences.length };
  }

  const cleanBrand = businessName.trim().toLowerCase();
  const escapedBrand = cleanBrand.replace(/[.*+?^$\{}()|[\]\\]/g, "\\$&");
  const brandRegex = new RegExp("(^|[^a-zA-Z0-9çğıöşüÇĞİÖŞÜ])" + escapedBrand + "([^a-zA-Z0-9çğıöşüÇĞİÖŞÜ]|$)", "i");

  let ownProductCount = 0;
  let competingCount = 0;

  for (const occ of occurrences) {
    const textToCheck = (occ.rawTitle || "") + " " + (occ.rawSnippet || "") + " " + (occ.url || "");
    const matchesBrand = brandRegex.test(textToCheck);

    if (matchesBrand) {
      occ.isOwnProductListing = true;
      occ.ownProductListingReason = 'Discovered listing references client own brand (' + businessName + ').';
      ownProductCount++;
    } else {
      occ.isOwnProductListing = false;
      competingCount++;
    }
  }

  return { ownProductCount, competingCount };
}

/**
 * Stage 4: Canonical Identity Verification, Entity Role, and Source Page vs. Company Distinction.
 * Distinguishes:
 * - A real vendor's own blog/comparison post (e.g., vendor.com/blog/top-platforms -> vendor IS a real business, NOT a media publisher/directory)
 * - A third-party listicle/directory/review site (extracts mentionedCompetitorLeads while classifying the site itself as DIRECTORY_AGGREGATOR / MEDIA_PUBLISHER)
 */
export async function verifyCompetitorIdentity(
  input: CompetitorQualityEvidenceInput,
  options?: {
    accountId?: string;
    campaignId?: string;
    budget?: CompetitorQualityBudgetTracker;
  }
): Promise<IdentityVerificationResult> {
  options?.budget?.recordLlmCall();

  const { brandToken } = extractBrandEntityInfo(input.domain || input.websiteUrl);
  const fallbackEntityId = generateCanonicalEntityId(brandToken);

  const prompt = [
    "You are Avyron's Competitor Identity, Entity Role, and Source-vs-Company Verifier.",
    "Analyze this candidate discovered via web search/evidence and determine:",
    "1. DISTINGUISH THE SOURCE PAGE FROM THE UNDERLYING COMPANY OWNING THE DOMAIN:",
    "   - VENDOR_STOREFRONT_OR_PRODUCT_PAGE: The landing page, product page, pricing page, or app page of a commercial vendor/SaaS/service.",
    "   - VENDOR_BLOG_OR_COMPARISON_POST: A blog post, SEO comparison article, or 'Top X Platforms' article hosted on a real commercial vendor's OWN domain (e.g., `acmecloud.io/blog/top-platforms`). CRITICAL: When a commercial product/SaaS/service company publishes a blog or comparison post on its own website, the company (`acmecloud.io`) IS A REAL COMMERCIAL BUSINESS (`isRealBusiness: true`, `entityRole: BRAND_DIRECT_SELLER`), NOT a `MEDIA_PUBLISHER` or `DIRECTORY_AGGREGATOR`!",
    "   - THIRD_PARTY_LISTICLE_OR_REVIEW: An independent review blog, directory, software aggregator, or editorial listicle that does NOT sell a competing product/service itself. Extract any actual competitor companies or domains named in its snippet into `mentionedCompetitorLeads`.",
    "   - MARKETPLACE_LISTING: A multi-vendor marketplace platform (e.g., Amazon, Fiverr, Etsy, Noon).",
    "   - MEDIA_OR_GOVERNMENT_PAGE: News publication, government portal, encyclopedia, academic site, or social forum.",
    "2. Is the domain owner a REAL COMMERCIAL BUSINESS entity (selling SaaS, digital products/services, physical goods, or professional services directly)?",
    "3. What is the domain owner's PRIMARY ENTITY ROLE:",
    "   - BRAND_DIRECT_SELLER: First-party company/SaaS/service/brand selling its own software, digital service, or product directly.",
    "   - SPECIALTY_RETAILER: Focused specialist store or agency specializing in this category.",
    "   - MULTI_BRAND_RETAILER: Retailer selling products from multiple brands directly to buyers.",
    "   - DEPARTMENT_STORE: Multi-category general department store with direct inventory.",
    "   - PURE_MARKETPLACE_PLATFORM: Multi-vendor platform for third-party sellers.",
    "   - MARKETPLACE_PLATFORM: Multi-vendor platform facilitating third-party merchant transactions.",
    "   - DIRECTORY_AGGREGATOR: Third-party link directory, review aggregator, or listing site.",
    "   - MEDIA_PUBLISHER: Third-party magazine, news outlet, blog publication, or government/educational portal.",
    "   - COMMUNITY_FORUM: Discussion board, social forum, or community hub.",
    "   - UNKNOWN: Unclear or unidentifiable.",
    "",
    "CANDIDATE:",
    "- Domain: " + input.domain,
    "- URL: " + input.websiteUrl,
    '- Name: "' + input.name + '"',
    "- Search / Website Evidence:\n" + input.evidenceText.slice(0, 1800),
    "",
    "Return ONLY valid JSON:",
    '{"isRealBusiness": true, "entityRole": "BRAND_DIRECT_SELLER" | "SPECIALTY_RETAILER" | "MULTI_BRAND_RETAILER" | "DEPARTMENT_STORE" | "PURE_MARKETPLACE_PLATFORM" | "MARKETPLACE_PLATFORM" | "DIRECTORY_AGGREGATOR" | "MEDIA_PUBLISHER" | "COMMUNITY_FORUM" | "UNKNOWN", "sourcePageType": "VENDOR_STOREFRONT_OR_PRODUCT_PAGE" | "VENDOR_BLOG_OR_COMPARISON_POST" | "THIRD_PARTY_LISTICLE_OR_REVIEW" | "MARKETPLACE_LISTING" | "MEDIA_OR_GOVERNMENT_PAGE" | "UNKNOWN", "mentionedCompetitorLeads": [{"name": "...", "domain": "...", "reason": "..."}], "entityRoleReasoning": "...", "canonicalName": "...", "canonicalDomain": "' + input.domain + '", "confidence": 0.9, "reasoning": "..."}'
  ].join("\n");

  try {
    const res = await aiChat({
      model: resolveModelForTier(DISCOVERY_MODEL_TIERS.IDENTITY_VERIFIER),
      messages: [
        { role: "system", content: "You are the Avyron Competitor Identity Verifier. Always return valid JSON." },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 600,
      response_format: { type: "json_object" },
      accountId: options?.accountId || "system",
      campaignId: options?.campaignId,
      operationType: "competitor_discovery",
      endpoint: "competitor-identity-verifier",
    });

    const parsed = JSON.parse(res.choices?.[0]?.message?.content || "{}");
    const validRoles: CompetitorEntityRole[] = [
      "BRAND_DIRECT_SELLER", "SPECIALTY_RETAILER", "MULTI_BRAND_RETAILER", "DEPARTMENT_STORE", "PURE_MARKETPLACE_PLATFORM", "MARKETPLACE_PLATFORM", "DIRECTORY_AGGREGATOR", "MEDIA_PUBLISHER", "COMMUNITY_FORUM", "UNKNOWN"
    ];
    const validSourceTypes: SourcePageType[] = [
      "VENDOR_STOREFRONT_OR_PRODUCT_PAGE",
      "VENDOR_BLOG_OR_COMPARISON_POST",
      "THIRD_PARTY_LISTICLE_OR_REVIEW",
      "MARKETPLACE_LISTING",
      "MEDIA_OR_GOVERNMENT_PAGE",
      "UNKNOWN",
    ];
    let sourcePageType: SourcePageType = validSourceTypes.includes(parsed.sourcePageType)
      ? parsed.sourcePageType
      : "UNKNOWN";
    let entityRole = validRoles.includes(parsed.entityRole) ? parsed.entityRole : "UNKNOWN";
    let isRealBusiness = parsed.isRealBusiness === true;

    // Guardrail: If the page is a vendor's own blog/comparison post, ensure the vendor is not misclassified as a media publisher/directory
    if (sourcePageType === "VENDOR_BLOG_OR_COMPARISON_POST") {
      isRealBusiness = true;
      if (entityRole === "MEDIA_PUBLISHER" || entityRole === "DIRECTORY_AGGREGATOR" || entityRole === "UNKNOWN") {
        entityRole = "BRAND_DIRECT_SELLER";
      }
    }

    const canonicalName = parsed.canonicalName || input.name;
    // Use domain brandToken for canonicalEntityId unless canonicalName aligns with the domain brandToken,
    // preventing generic SEO titles (e.g. "Personalised Songs UK") from merging unrelated domains.
    const normName = normalizeBrandName(canonicalName);
    const nameAlignsWithDomain =
      brandToken &&
      normName &&
      (normName.includes(brandToken) || brandToken.includes(normName));
    const canonicalEntityId = nameAlignsWithDomain
      ? generateCanonicalEntityId(brandToken)
      : fallbackEntityId || generateCanonicalEntityId(canonicalName);
    const mentionedCompetitorLeads: MentionedCompetitorLead[] = Array.isArray(parsed.mentionedCompetitorLeads)
      ? parsed.mentionedCompetitorLeads
          .filter((l: any) => l && typeof l.name === "string" && l.name.trim())
          .map((l: any) => ({
            name: String(l.name).trim(),
            domain: typeof l.domain === "string" && l.domain.trim() ? String(l.domain).trim().toLowerCase() : undefined,
            reason: typeof l.reason === "string" ? l.reason.trim() : undefined,
          }))
      : [];

    return {
      candidateKey: input.candidateKey,
      canonicalEntityId,
      isRealBusiness,
      entityRole,
      entityRoleReasoning: parsed.entityRoleReasoning || "",
      sourcePageType,
      mentionedCompetitorLeads,
      canonicalName,
      canonicalDomain: input.domain,
      storefronts: input.storefronts || [{ domain: input.domain, url: input.websiteUrl, title: canonicalName }],
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.8,
      reasoning: parsed.reasoning || "Verified from provider search snippets.",
    };
  } catch (err: any) {
    const text = input.evidenceText.toLowerCase();
    const isCommercial =
      /\b(pricing|platform|software|saas|app|create|generator|custom|service|studio|agency|shop|cart|price|buy|order|store|subscription|plan)\b/i.test(text);
    const isBlogUrl = /\/(blog|articles?|compare|alternatives)(\/|$)/i.test(input.websiteUrl);
    return {
      candidateKey: input.candidateKey,
      canonicalEntityId: fallbackEntityId,
      isRealBusiness: isCommercial,
      entityRole: isCommercial ? "BRAND_DIRECT_SELLER" : "UNKNOWN",
      entityRoleReasoning: "Fallback entity role from structural signals.",
      sourcePageType: isCommercial && isBlogUrl ? "VENDOR_BLOG_OR_COMPARISON_POST" : isCommercial ? "VENDOR_STOREFRONT_OR_PRODUCT_PAGE" : "UNKNOWN",
      canonicalName: input.name,
      canonicalDomain: input.domain,
      storefronts: input.storefronts || [{ domain: input.domain, url: input.websiteUrl, title: input.name }],
      confidence: 0.5,
      reasoning: "Identity determined via structural evidence signals.",
    };
  }
}

/**
 * Stage 5: Canonical Competitive Relationship & Market Availability Verification.
 * Evaluates Competitive Relationship and Market Availability as two independent dimensions.
 */
export async function verifyCompetitorRelevance(
  input: CompetitorQualityEvidenceInput & { occurrences?: any[] },
  identity: IdentityVerificationResult,
  context: CompetitorQualityCampaignContext,
  options?: {
    accountId?: string;
    campaignId?: string;
    budget?: CompetitorQualityBudgetTracker;
  }
): Promise<RelevanceVerificationResult> {
  options?.budget?.recordLlmCall();

  const occurrences = input.occurrences || [];
  const { ownProductCount, competingCount } = flagOwnProductListings(occurrences, context.businessName, context.offeringName);
  const allEvidenceIsOwnProduct = occurrences.length > 0 && ownProductCount === occurrences.length && competingCount === 0;

  if (allEvidenceIsOwnProduct) {
    return {
      candidateKey: input.candidateKey,
      isRelevant: false,
      classification: "NOT_COMPETITOR",
      competingOffering: "NONE",
      servesBuyerNeed: false,
      buyerNeedRationale: "Candidate occurrences only reference our own brand.",
      competitorType: "EXCLUDED",
      geographicClassification: "UNVERIFIED",
      tier: "B",
      reason: 'Rejected: All discovered search evidence consists of candidate retailing or indexing client own brand (' + context.businessName + ').',
    };
  }

  const domesticSignal = matchesTargetMarketDomestic(input.domain, input.evidenceText, context.targetMarket);
  const deliveryCategory =
    context.classificationProfile?.offeringAndDelivery?.value ||
    context.classificationProfile?.offeringAndDelivery?.category ||
    context.offeringType ||
    "UNCERTAIN";
  const deliveryReasoning =
    context.classificationProfile?.offeringAndDelivery?.summary ||
    context.classificationProfile?.offeringAndDelivery?.reasoning ||
    "N/A";
  const buyerCategory =
    context.classificationProfile?.buyerSegment?.value ||
    context.classificationProfile?.buyerSegment?.category ||
    "UNCERTAIN";
  const buyerReasoning =
    context.classificationProfile?.buyerSegment?.summary ||
    context.classificationProfile?.buyerSegment?.reasoning ||
    "N/A";
  const monetizationCategory =
    context.classificationProfile?.monetization?.value ||
    context.classificationProfile?.monetization?.category ||
    context.pricingModel ||
    "UNKNOWN";

  const prompt = [
    "You are Avyron's Contextual Competitive & Market Availability Assessor.",
    'Evaluate candidate "' + (identity.canonicalName || input.name) + '" (' + input.domain + ') on TWO SEPARATE DIMENSIONS:',
    "  Dimension A: COMPETITIVE RELATIONSHIP (which specific offering of the candidate competes with our selected offering, and does it serve the relevant buyer need/use case?)",
    "  Dimension B: MARKET AVAILABILITY (what does the evidence establish about its relationship to our target market?)",
    "",
    "OUR CANONICAL CAMPAIGN CONTEXT:",
    '- Our Business / Brand: "' + context.businessName + '"',
    '- Selected Offering: "' + context.offeringName + '"',
    '- Category: "' + context.category + '"',
    '- Business Model: "' + (context.businessModel || "Unspecified") + '"',
    '- Offering & Delivery Model: "' + deliveryCategory + '" (' + deliveryReasoning + ")",
    '- Buyer Segments: "' + buyerCategory + '" (' + buyerReasoning + ")",
    '- Monetization Model: "' + monetizationCategory + '"',
    '- Target Market: "' + context.targetMarket + '"',
    "- Target Buyer Roles: " + JSON.stringify(context.targetRoles || []),
    "- Canonical Product Truth Facts: " + JSON.stringify(context.productTruthFacts || []),
    "",
    "CANDIDATE:",
    "- Domain: " + input.domain,
    "- Source Page Type: " + (identity.sourcePageType || "UNKNOWN"),
    "- Entity Role: " + (identity.entityRole || "UNKNOWN"),
    "- Role Rationale: " + (identity.entityRoleReasoning || identity.reasoning || "N/A"),
    "- Evidence: " + input.evidenceText.slice(0, 1800),
    (ownProductCount > 0 ? '- Note on Own-Brand Presence: ' + ownProductCount + ' occurrences contain listings of our own brand "' + context.businessName + '".' : ""),
    "",
    "DIMENSION A — COMPETITIVE RELATIONSHIP & SPECIFIC COMPETING OFFERING (evaluate independently of geography!):",
    "1. Identify `competingOffering`: What specific product, service, or offering from this candidate actually competes with our Selected Offering (`" + context.offeringName + "`)? If the company sells other products/services that do NOT compete with `" + context.offeringName + "`, set `competingOffering: \"NONE\"` and `classification: \"NOT_COMPETITOR\"`.",
    "2. Determine `servesBuyerNeed` (`true` or `false`) and `buyerNeedRationale`: Does the candidate's offering solve the same buyer need or use case as `" + context.offeringName + "`?",
    "3. Classify the relationship:",
    "- DIRECT_COMPETITOR: Offers the same core product/software/service category or solves the same primary job-to-be-done with a comparable delivery model for B2C and/or B2B buyers.",
    "- ADJACENT_COMPETITOR: Offers a closely related capability, vertical tool, or adjacent service targeting overlapping buyer segments or workflows.",
    "- SUBSTITUTE_COMPETITOR: Offers an alternative way buyers fulfill the same underlying need or budget (e.g., traditional studio/agency vs. AI platform, or physical/experiential gift alternative vs. digital personalized song gift).",
    "- BENCHMARK_COMPETITOR: Major global or regional category leader / reference brand.",
    "- NOT_COMPETITOR: Unrelated industry, non-commercial entity, or lacks any offering that competes with `" + context.offeringName + "`.",
    "IMPORTANT: Do NOT mark a relevant competitor as NOT_COMPETITOR just because its availability in " + context.targetMarket + " is unverified! Keep its true competitive relationship.",
    "",
    "DIMENSION B — MARKET AVAILABILITY IN " + context.targetMarket + ":",
    '- "LOCAL_MARKET": Concrete evidence of domestic presence, local office/entity, country ccTLD, or explicit domestic operations inside "' + context.targetMarket + '".',
    '- "CROSS_BORDER_SERVING_MARKET": Foreign or global business with explicit evidence in the snippet/site that it actively serves, targets, bills, or delivers to customers in "' + context.targetMarket + '".',
    '- "INTERNATIONAL_REFERENCE": Established foreign/global competitor whose evidence shows it operates in other specific regions (or globally as a benchmark) without verified active targeting of "' + context.targetMarket + '".',
    '- "UNVERIFIED": The candidate is a real, relevant competitor, but the current snippets do NOT contain enough geographic evidence to confirm whether it actively serves "' + context.targetMarket + '".',
    "",
    "STRICT MARKET-EVIDENCE INTEGRITY RULES:",
    '1. DO NOT automatically promote a candidate to "LOCAL_MARKET" or "CROSS_BORDER_SERVING_MARKET" merely because its website is accessible online, written in English or Arabic, or sells a digital/SaaS product.',
    '2. DO NOT invent hypothetical market service ("would compete if it expands to ' + context.targetMarket + '").',
    '3. If a candidate is competitively relevant (DIRECT_COMPETITOR, ADJACENT_COMPETITOR, or SUBSTITUTE_COMPETITOR) but its availability in "' + context.targetMarket + '" is not explicitly established by the evidence, set `isRelevant: true`, set `geographicClassification: "UNVERIFIED"`, and explain what market evidence is missing in `marketAvailabilityUncertainty`.',
    "",
    "Return ONLY valid JSON:",
    '{"isRelevant": true, "competingOffering": "Specific competing product/service name or NONE", "servesBuyerNeed": true, "buyerNeedRationale": "How it serves or fails to serve the buyer need", "classification": "DIRECT_COMPETITOR" | "RELEVANT_COMPETITOR" | "SUBSTITUTE_COMPETITOR" | "BENCHMARK_COMPETITOR" | "ADJACENT_COMPETITOR" | "NOT_COMPETITOR" | "INSUFFICIENT_EVIDENCE", "geographicClassification": "LOCAL_MARKET" | "CROSS_BORDER_SERVING_MARKET" | "INTERNATIONAL_REFERENCE" | "UNVERIFIED", "geographicReasoning": "...", "marketAvailabilityUncertainty": "Optional explanation when geographicClassification is UNVERIFIED", "tier": "A" | "B", "reason": "..."}'
  ].join("\n");

  try {
    const res = await aiChat({
      model: resolveModelForTier(DISCOVERY_MODEL_TIERS.RELEVANCE_VERIFIER),
      messages: [
        { role: "system", content: "You are the Avyron Competitive Relevance & Market Availability Assessor. Always return valid JSON." },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 750,
      response_format: { type: "json_object" },
      accountId: options?.accountId || "system",
      campaignId: options?.campaignId,
      operationType: "competitor_discovery",
      endpoint: "competitor-relevance-verifier",
    });

    const parsed = JSON.parse(res.choices?.[0]?.message?.content || "{}");
    const validClassifications: CompetitorClassification[] = [
      "DIRECT_COMPETITOR",
      "RELEVANT_COMPETITOR",
      "SUBSTITUTE_COMPETITOR",
      "BENCHMARK_COMPETITOR",
      "ADJACENT_COMPETITOR",
      "NOT_COMPETITOR",
      "INSUFFICIENT_EVIDENCE",
    ];
    let classification: CompetitorClassification = validClassifications.includes(parsed.classification)
      ? parsed.classification
      : "ADJACENT_COMPETITOR";

    const competingOffering =
      typeof parsed.competingOffering === "string" && parsed.competingOffering.trim()
        ? parsed.competingOffering.trim()
        : undefined;
    const servesBuyerNeed =
      typeof parsed.servesBuyerNeed === "boolean"
        ? parsed.servesBuyerNeed
        : classification !== "NOT_COMPETITOR" && classification !== "INSUFFICIENT_EVIDENCE";
    const buyerNeedRationale =
      typeof parsed.buyerNeedRationale === "string" && parsed.buyerNeedRationale.trim()
        ? parsed.buyerNeedRationale.trim()
        : parsed.reason || undefined;

    // Guardrail: If company lacks a competing offering or does not serve the buyer need, classify as NOT_COMPETITOR
    if (
      competingOffering?.toUpperCase() === "NONE" ||
      parsed.servesBuyerNeed === false
    ) {
      classification = "NOT_COMPETITOR";
    }

    const validGeo: CompetitorGeographicClassification[] = [
      "LOCAL_MARKET", "CROSS_BORDER_SERVING_MARKET", "INTERNATIONAL_REFERENCE", "UNVERIFIED"
    ];
    let geographicClassification: CompetitorGeographicClassification = validGeo.includes(parsed.geographicClassification)
      ? parsed.geographicClassification
      : "UNVERIFIED";

    let reason = parsed.reason || "";
    let geographicReasoning = parsed.geographicReasoning || "";
    let marketAvailabilityUncertainty =
      typeof parsed.marketAvailabilityUncertainty === "string" && parsed.marketAvailabilityUncertainty.trim()
        ? parsed.marketAvailabilityUncertainty.trim()
        : undefined;

    // Guardrail 1: Reject hypothetical local promotion without erasing competitive relationship
    const combinedReasonText = (reason + " " + geographicReasoning).toLowerCase();
    if (
      combinedReasonText.includes("if it expands") ||
      combinedReasonText.includes("would compete if") ||
      combinedReasonText.includes("hypothetically") ||
      combinedReasonText.includes("if they expand")
    ) {
      if (geographicClassification === "LOCAL_MARKET" || geographicClassification === "CROSS_BORDER_SERVING_MARKET") {
        geographicClassification = "UNVERIFIED";
        geographicReasoning = `Market availability in ${context.targetMarket} is not verified by explicit evidence (hypothetical expansion is not market proof).`;
        marketAvailabilityUncertainty = geographicReasoning;
      }
    }

    // Guardrail 2: Prevent auto-promoting digital/accessible websites to LOCAL_MARKET or CROSS_BORDER_SERVING_MARKET without actual target-market evidence
    if (
      (geographicClassification === "LOCAL_MARKET" || geographicClassification === "CROSS_BORDER_SERVING_MARKET") &&
      !domesticSignal.isDomesticMatch
    ) {
      const geoLower = geographicReasoning.toLowerCase();
      const evidenceLower = input.evidenceText.toLowerCase();
      const targetLower = context.targetMarket.toLowerCase();
      const hasExplicitMarketMention =
        evidenceLower.includes(targetLower) ||
        (targetLower.includes("united arab emirates") && /\b(uae|dubai|abu dhabi|sharjah|aed|dirham|gcc|middle east|mena)\b/i.test(evidenceLower));
      const promotedOnlyBecauseAccessibleOrDigital =
        /\b(accessible globally|accessible online|digital platform so|available worldwide online|website is accessible|english or arabic)\b/i.test(geoLower) &&
        !hasExplicitMarketMention;

      if (promotedOnlyBecauseAccessibleOrDigital) {
        geographicClassification = "UNVERIFIED";
        marketAvailabilityUncertainty = `Product is delivered digitally online, but current evidence does not explicitly confirm localization, pricing, or customer adoption in ${context.targetMarket}.`;
        geographicReasoning = marketAvailabilityUncertainty;
      }
    }

    // Heuristic confirmation ONLY if high-confidence domestic ccTLD or explicit domestic address/signal exists
    if (domesticSignal.confidence === "HIGH" && geographicClassification === "UNVERIFIED") {
      geographicClassification = "LOCAL_MARKET";
      geographicReasoning = domesticSignal.reason;
      marketAvailabilityUncertainty = undefined;
    }

    if (geographicClassification === "UNVERIFIED" && !marketAvailabilityUncertainty) {
      marketAvailabilityUncertainty =
        geographicReasoning ||
        `Competitive with ${context.offeringName}, but explicit availability or customer service in ${context.targetMarket} is not yet verified from captured snippets.`;
    }

    const isRelevant = classification !== "NOT_COMPETITOR" && classification !== "INSUFFICIENT_EVIDENCE";
    const tier: CompetitorTier =
      parsed.tier === "A" || classification === "DIRECT_COMPETITOR" || classification === "RELEVANT_COMPETITOR"
        ? "A"
        : "B";

    const competitorType: RelevanceVerificationResult["competitorType"] =
      !isRelevant
        ? classification === "INSUFFICIENT_EVIDENCE"
          ? "INSUFFICIENT_EVIDENCE"
          : "EXCLUDED"
        : classification === "DIRECT_COMPETITOR" || classification === "RELEVANT_COMPETITOR"
          ? "DIRECT"
          : "INDIRECT_SUBSTITUTE";

    const monitoredProductUrls = Array.from(
      new Set(
        occurrences
          .map((o: any) => o?.url)
          .filter((u: any) => typeof u === "string" && u.startsWith("http"))
      )
    );
    if (monitoredProductUrls.length === 0 && input.websiteUrl) {
      monitoredProductUrls.push(input.websiteUrl);
    }

    return {
      candidateKey: input.candidateKey,
      isRelevant,
      classification,
      competingOffering: competingOffering || (isRelevant ? context.offeringName : "NONE"),
      servesBuyerNeed,
      buyerNeedRationale,
      competitorType,
      monitoredProductUrls,
      geographicClassification,
      geographicReasoning,
      marketAvailabilityUncertainty,
      tier,
      reason,
    };
  } catch (err: any) {
    console.warn("[verifyCompetitorRelevance] AI call error:", err?.message || err);
    const geo: CompetitorGeographicClassification = domesticSignal.isDomesticMatch ? "LOCAL_MARKET" : "UNVERIFIED";
    return {
      candidateKey: input.candidateKey,
      isRelevant: true,
      classification: "ADJACENT_COMPETITOR",
      competingOffering: context.offeringName,
      servesBuyerNeed: true,
      buyerNeedRationale: `Commercial candidate discovered for ${context.offeringName}.`,
      competitorType: "INDIRECT_SUBSTITUTE",
      monitoredProductUrls: input.websiteUrl ? [input.websiteUrl] : [],
      geographicClassification: geo,
      geographicReasoning: domesticSignal.reason,
      marketAvailabilityUncertainty:
        geo === "UNVERIFIED"
          ? `Availability in ${context.targetMarket} could not be verified from search snippet alone.`
          : undefined,
      tier: "B",
      reason: 'Commercial candidate discovered for ' + context.offeringName + '.',
    };
  }
}

/**
 * Stage 6: Canonical Final Semantic Judge.
 * Never rejects an approved relevant competitor solely because geographicClassification === "UNVERIFIED".
 */
export function runCompetitorFinalJudge(
  input: CompetitorQualityEvidenceInput,
  identity: IdentityVerificationResult,
  relevance: RelevanceVerificationResult,
  context: { offeringName: string; targetMarket: string },
  options?: {
    accountId?: string;
    budget?: CompetitorQualityBudgetTracker;
  }
): FinalJudgeDecision {
  const geo = relevance.geographicClassification || "UNVERIFIED";

  // 1. Rejection: Not a verified business entity
  if (!identity.isRealBusiness) {
    return {
      candidateKey: input.candidateKey,
      canonicalEntityId: identity.canonicalEntityId,
      name: input.name,
      websiteUrl: input.websiteUrl,
      storefronts: identity.storefronts,
      entityRole: identity.entityRole,
      sourcePageType: identity.sourcePageType,
      geographicClassification: geo,
      geographicReasoning: relevance.geographicReasoning,
      marketAvailabilityUncertainty: relevance.marketAvailabilityUncertainty,
      verdict: "REJECTED",
      tier: "B",
      finalReason: 'Rejected: Not a verified commercial business entity (' + (identity.entityRoleReasoning || identity.reasoning) + ').',
      classification: "NOT_COMPETITOR",
    };
  }

  // 2. Rejection: Pure marketplace platforms, directories, publishers, forums
  // Note: A vendor's own blog/comparison post (VENDOR_BLOG_OR_COMPARISON_POST) is already protected in verifyCompetitorIdentity.
  if (
    identity.sourcePageType !== "VENDOR_BLOG_OR_COMPARISON_POST" &&
    (identity.entityRole === "PURE_MARKETPLACE_PLATFORM" ||
      identity.entityRole === "MARKETPLACE_PLATFORM" ||
      identity.entityRole === "DIRECTORY_AGGREGATOR" ||
      identity.entityRole === "MEDIA_PUBLISHER" ||
      identity.entityRole === "COMMUNITY_FORUM")
  ) {
    return {
      candidateKey: input.candidateKey,
      canonicalEntityId: identity.canonicalEntityId,
      name: input.name,
      websiteUrl: input.websiteUrl,
      storefronts: identity.storefronts,
      entityRole: identity.entityRole,
      sourcePageType: identity.sourcePageType,
      geographicClassification: geo,
      geographicReasoning: relevance.geographicReasoning,
      marketAvailabilityUncertainty: relevance.marketAvailabilityUncertainty,
      verdict: "REJECTED",
      tier: "B",
      finalReason: 'Rejected: Entity role is ' + identity.entityRole + ' (' + (identity.entityRoleReasoning || identity.reasoning) + '). Multi-vendor marketplace platforms, directories, and publishers are discovery sources rather than direct competitors.',
      classification: "NOT_COMPETITOR",
    };
  }

  // 3. Rejection: Irrelevant / Not a competitor
  if (!relevance.isRelevant || relevance.classification === "NOT_COMPETITOR") {
    return {
      candidateKey: input.candidateKey,
      canonicalEntityId: identity.canonicalEntityId,
      name: input.name,
      websiteUrl: input.websiteUrl,
      storefronts: identity.storefronts,
      entityRole: identity.entityRole,
      sourcePageType: identity.sourcePageType,
      geographicClassification: geo,
      geographicReasoning: relevance.geographicReasoning,
      marketAvailabilityUncertainty: relevance.marketAvailabilityUncertainty,
      verdict: "REJECTED",
      tier: "B",
      finalReason: 'Rejected: Not competitively relevant to ' + context.offeringName + ' (' + relevance.reason + ').',
      classification: "NOT_COMPETITOR",
    };
  }

  // 4. Insufficient evidence
  if (relevance.classification === "INSUFFICIENT_EVIDENCE") {
    return {
      candidateKey: input.candidateKey,
      canonicalEntityId: identity.canonicalEntityId,
      name: input.name,
      websiteUrl: input.websiteUrl,
      storefronts: identity.storefronts,
      entityRole: identity.entityRole,
      sourcePageType: identity.sourcePageType,
      geographicClassification: geo,
      geographicReasoning: relevance.geographicReasoning,
      marketAvailabilityUncertainty: relevance.marketAvailabilityUncertainty,
      verdict: "INSUFFICIENT_EVIDENCE",
      tier: "B",
      strategicRole: "UNRESOLVED",
      finalReason: "Insufficient evidence to determine competitive relationship.",
      classification: "INSUFFICIENT_EVIDENCE",
    };
  }

  // 5. Approved candidate (including geographicClassification === "UNVERIFIED"!)
  const strategicRole = geo === "INTERNATIONAL_REFERENCE"
    ? "ASPIRATIONAL"
    : mapClassificationToStrategicRole(relevance.classification);

  return {
    candidateKey: input.candidateKey,
    canonicalEntityId: identity.canonicalEntityId,
    name: identity.canonicalName || input.name,
    websiteUrl: input.websiteUrl,
    storefronts: identity.storefronts,
    entityRole: identity.entityRole,
    sourcePageType: identity.sourcePageType,
    geographicClassification: geo,
    geographicReasoning: relevance.geographicReasoning,
    marketAvailabilityUncertainty: relevance.marketAvailabilityUncertainty,
    verdict: "APPROVED",
    tier: geo === "INTERNATIONAL_REFERENCE" ? "B" : relevance.tier,
    strategicRole,
    finalReason: relevance.reason,
    classification: relevance.classification,
  };
}

/**
 * Unified Competitor Quality Evaluation Pipeline.
 */
export async function evaluateCompetitorQuality(
  input: CompetitorQualityEvidenceInput,
  context: CompetitorQualityCampaignContext,
  options?: {
    accountId?: string;
    campaignId?: string;
    budget?: CompetitorQualityBudgetTracker;
  }
): Promise<CompetitorQualityEvaluationResult> {
  const identity = await verifyCompetitorIdentity(input, options);
  // Optimization: If identity check already established this domain is not a real business or is a third-party directory/media/forum,
  // do not waste an LLM call on verifyCompetitorRelevance.
  if (
    !identity.isRealBusiness ||
    (identity.sourcePageType !== "VENDOR_BLOG_OR_COMPARISON_POST" &&
      (identity.entityRole === "PURE_MARKETPLACE_PLATFORM" ||
        identity.entityRole === "MARKETPLACE_PLATFORM" ||
        identity.entityRole === "DIRECTORY_AGGREGATOR" ||
        identity.entityRole === "MEDIA_PUBLISHER" ||
        identity.entityRole === "COMMUNITY_FORUM"))
  ) {
    const skippedRelevance: RelevanceVerificationResult = {
      candidateKey: input.candidateKey,
      isRelevant: false,
      classification: "NOT_COMPETITOR",
      geographicClassification: "UNVERIFIED",
      geographicReasoning: "Skipped relevance check because entity is not a commercial competitor.",
      tier: "B",
      reason: identity.entityRoleReasoning || identity.reasoning || "Non-competitor entity role.",
    };
    const judge = runCompetitorFinalJudge(input, identity, skippedRelevance, context, options);
    return { identity, relevance: skippedRelevance, judge };
  }

  const relevance = await verifyCompetitorRelevance(input, identity, context, options);
  const judge = runCompetitorFinalJudge(input, identity, relevance, context, options);

  return {
    identity,
    relevance,
    judge,
  };
}
