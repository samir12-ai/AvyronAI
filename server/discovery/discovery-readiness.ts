import { createHash } from "crypto";
import { aiChat } from "../ai-client";
import { resolveModelForTier, DISCOVERY_MODEL_TIERS } from "./model-router";
import type {
  CompetitorDiscoveryReadiness,
  DiscoveredCompetitorCandidate,
  DiscoveryReadinessVerdict,
} from "@shared/contracts/discovery-contracts";
import type { BusinessClassificationProfile } from "@shared/business-understanding-types";

export interface EvaluateDiscoveryReadinessInput {
  hasCanonicalBusinessUnderstanding?: boolean;
  hasConfirmedOffering?: boolean;
  contextCompatible?: boolean;
  incompatibilityReason?: string;
  providerUnavailable?: boolean;
  providerErrorCount?: number;
  emptyResultMissionCount?: number;
  budgetExhausted?: boolean;
  businessName: string;
  offeringName: string;
  category: string;
  businessModel?: string;
  targetMarket: string;
  classificationProfile?: BusinessClassificationProfile;
  productTruthFacts?: string[];
  targetRoles?: string[];
  evidenceGaps?: string[];
  approvedCandidates: DiscoveredCompetitorCandidate[];
  selectedDomains?: string[];
}

export interface EvaluateDiscoveryReadinessOptions {
  accountId?: string;
  useLlmAssessment?: boolean;
  recordLlmCall?: () => void;
}

const readinessAssessmentCache = new Map<string, CompetitorDiscoveryReadiness>();

function normalizeCandidateDomain(c: Partial<DiscoveredCompetitorCandidate>): string {
  const raw = (c.domain || c.candidateKey || c.websiteUrl || "").trim().toLowerCase();
  return raw.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
}

function isStructurallyValidRelevantCompetitor(c: Partial<DiscoveredCompetitorCandidate>): boolean {
  const domain = normalizeCandidateDomain(c);
  const name = (c.name || "").trim();
  if (!domain || !name) return false;
  if (c.judgeVerdict && c.judgeVerdict !== "APPROVED") return false;
  if (c.classification === "NOT_COMPETITOR" || c.classification === "INSUFFICIENT_EVIDENCE") {
    return false;
  }
  return true;
}

/**
 * Shared readiness evaluator across backend discovery engine, setup API routes, and strategy build gates.
 * Combines deterministic contract checks with contextual LLM reasoning (cached by context+candidate fingerprint).
 * Never enforces a hardcoded universal competitor count (no 10-local rule or fixed numerical threshold).
 */
export async function evaluateCompetitorDiscoveryReadiness(
  input: EvaluateDiscoveryReadinessInput,
  options?: EvaluateDiscoveryReadinessOptions
): Promise<CompetitorDiscoveryReadiness> {
  const hasCanonicalBU = input.hasCanonicalBusinessUnderstanding !== false;
  const hasOffering = input.hasConfirmedOffering !== false;
  const contextCompatible = input.contextCompatible !== false;
  const providerErrorCount = input.providerErrorCount || 0;
  const emptyResultMissionCount = input.emptyResultMissionCount || 0;
  const budgetExhausted = Boolean(input.budgetExhausted);

  const validApproved = (input.approvedCandidates || []).filter(isStructurallyValidRelevantCompetitor);

  const explicitSelectedSet = Array.isArray(input.selectedDomains)
    ? new Set(input.selectedDomains.map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]).filter(Boolean))
    : null;

  const selectedCandidates = validApproved.filter((c) => {
    const dom = normalizeCandidateDomain(c);
    if (explicitSelectedSet) {
      return explicitSelectedSet.has(dom);
    }
    return c.selected !== false;
  });

  const directCount = selectedCandidates.filter(
    (c) => c.classification === "DIRECT_COMPETITOR" || c.classification === "RELEVANT_COMPETITOR" || c.strategicRole === "DIRECT"
  ).length;
  const adjacentOrSubstituteCount = selectedCandidates.filter(
    (c) => c.classification === "ADJACENT_COMPETITOR" || c.classification === "SUBSTITUTE_COMPETITOR" || c.strategicRole === "ADJACENT"
  ).length;
  const localCount = selectedCandidates.filter((c) => c.geographicClassification === "LOCAL_MARKET").length;
  const crossBorderCount = selectedCandidates.filter((c) => c.geographicClassification === "CROSS_BORDER_SERVING_MARKET").length;
  const internationalReferenceCount = selectedCandidates.filter((c) => c.geographicClassification === "INTERNATIONAL_REFERENCE").length;
  const unverifiedMarketCount = selectedCandidates.filter(
    (c) => !c.geographicClassification || c.geographicClassification === "UNVERIFIED"
  ).length;

  const counts = {
    totalApproved: validApproved.length,
    selectedCount: selectedCandidates.length,
    directCount,
    adjacentOrSubstituteCount,
    localCount,
    crossBorderCount,
    internationalReferenceCount,
    unverifiedMarketCount,
  };

  const discoveryHealth = {
    contextCompatible,
    incompatibilityReason: input.incompatibilityReason,
    providerErrorCount,
    emptyResultMissionCount,
    budgetExhausted,
  };

  // 1. Deterministic Contract Checks
  if (!hasCanonicalBU || !hasOffering) {
    return {
      verdict: "BLOCKED",
      canProceed: false,
      headline: "Canonical Business Understanding Required",
      reason: !hasOffering
        ? "No confirmed hero offering exists for this campaign."
        : "Canonical Business Understanding is missing or outdated for the selected offering.",
      nextAction: "Return to Business & Offering Setup to confirm your offering and generate a current Business Understanding snapshot.",
      offeringCoverage: "Unavailable until offering is confirmed.",
      buyerSegmentCoverage: "Unavailable until Business Understanding is complete.",
      marketApplicability: `Pending for ${input.targetMarket}.`,
      materialGaps: ["Canonical Business Understanding or confirmed offering is missing."],
      counts,
      discoveryHealth,
    };
  }

  if (!contextCompatible) {
    return {
      verdict: "BLOCKED",
      canProceed: false,
      headline: "Discovery Context Out of Sync with Current Setup",
      reason:
        input.incompatibilityReason ||
        `Saved competitor discovery results do not match the current target market (${input.targetMarket}) or selected offering (${input.offeringName}).`,
      nextAction: `Run a fresh competitor discovery for ${input.offeringName} in ${input.targetMarket}.`,
      offeringCoverage: "Stale — previous results belong to an earlier setup context.",
      buyerSegmentCoverage: "Stale — buyer segment context changed.",
      marketApplicability: `Incompatible with current target market (${input.targetMarket}).`,
      materialGaps: [
        input.incompatibilityReason ||
          `Discovery session does not match target market ${input.targetMarket} or offering ${input.offeringName}.`,
      ],
      counts,
      discoveryHealth,
    };
  }

  if (input.providerUnavailable && validApproved.length === 0) {
    return {
      verdict: "BLOCKED",
      canProceed: false,
      headline: "Search Provider Error Prevented Competitor Discovery",
      reason: `External search providers failed (${providerErrorCount} provider error(s)) before any relevant competitors could be verified for ${input.offeringName}.`,
      nextAction: "Retry Competitor Discovery or add a known competitor domain manually.",
      offeringCoverage: "No competitors discovered due to search provider failure.",
      buyerSegmentCoverage: "No buyer segment coverage established.",
      marketApplicability: `Could not verify market availability in ${input.targetMarket}.`,
      materialGaps: ["Search provider error prevented candidate retrieval."],
      counts,
      discoveryHealth,
    };
  }

  if (validApproved.length === 0) {
    return {
      verdict: "BLOCKED",
      canProceed: false,
      headline: "No Relevant Competitors Verified Yet",
      reason: budgetExhausted
        ? `Discovery reached its search budget without confirming a relevant competitor for ${input.offeringName} in ${input.targetMarket}.`
        : `No relevant competitors have been verified yet for ${input.offeringName} in ${input.targetMarket}.`,
      nextAction: "Use 'Continue Discovery' to run targeted follow-up searches for missing competitor categories, or add a known competitor manually.",
      offeringCoverage: `No direct, adjacent, or substitute competitors verified for ${input.offeringName}.`,
      buyerSegmentCoverage: "No buyer segment coverage established.",
      marketApplicability: `No verified or candidate competitors for ${input.targetMarket}.`,
      materialGaps: [
        `No relevant competitors verified for ${input.offeringName}.`,
        ...(emptyResultMissionCount > 0 ? [`${emptyResultMissionCount} search mission(s) returned zero results.`] : []),
      ],
      counts,
      discoveryHealth,
    };
  }

  if (selectedCandidates.length === 0) {
    return {
      verdict: "BLOCKED",
      canProceed: false,
      headline: "Select At Least One Relevant Competitor to Proceed",
      reason: `${validApproved.length} relevant competitor(s) were discovered for ${input.offeringName}, but none are currently selected.`,
      nextAction: "Select at least one relevant competitor from the discovered cohorts below to continue.",
      offeringCoverage: `${validApproved.length} candidate(s) available, 0 selected.`,
      buyerSegmentCoverage: "Select candidates to establish buyer segment coverage.",
      marketApplicability: `Candidates available for ${input.targetMarket}, awaiting selection.`,
      materialGaps: ["Zero approved competitors currently selected by user."],
      counts,
      discoveryHealth,
    };
  }

  // 2. Contextual Assessment (LLM when available + enabled, with fingerprint cache)
  const deliveryCat =
    input.classificationProfile?.offeringAndDelivery?.value ||
    input.classificationProfile?.offeringAndDelivery?.category ||
    "UNCERTAIN";
  const buyerCat =
    input.classificationProfile?.buyerSegment?.value ||
    input.classificationProfile?.buyerSegment?.category ||
    "UNCERTAIN";
  const monetizationCat =
    input.classificationProfile?.monetization?.value ||
    input.classificationProfile?.monetization?.category ||
    "UNKNOWN";

  const cacheFingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        offeringName: input.offeringName,
        targetMarket: input.targetMarket,
        deliveryCat,
        buyerCat,
        monetizationCat,
        selected: selectedCandidates.map((c) => ({
          d: normalizeCandidateDomain(c),
          cls: c.classification,
          geo: c.geographicClassification,
          role: c.strategicRole,
        })),
        providerErrorCount,
        emptyResultMissionCount,
        budgetExhausted,
      })
    )
    .digest("hex");

  const cached = readinessAssessmentCache.get(cacheFingerprint);
  if (cached) {
    return {
      ...cached,
      counts,
      discoveryHealth,
    };
  }

  if (options?.useLlmAssessment !== false) {
    try {
      options?.recordLlmCall?.();
      const candidateSummaries = selectedCandidates.slice(0, 15).map((c) => ({
        name: c.name,
        domain: normalizeCandidateDomain(c),
        competitiveRelationship: c.classification || "RELEVANT_COMPETITOR",
        marketRelationship: c.geographicClassification || "UNVERIFIED",
        reason: (c.judgeReason || c.relevanceReason || "").slice(0, 220),
        uncertainty: c.marketAvailabilityUncertainty || undefined,
      }));

      const prompt = [
        "You are Avyron's Contextual Competitor Discovery Readiness Assessor.",
        "Evaluate whether the selected competitor set provides a sound basis to proceed to Strategy Generation for this specific business, offering, delivery model, buyer segments, and target market.",
        "IMPORTANT: Do NOT apply any universal fixed number of competitors (never require 10 local competitors or any arbitrary count).",
        "Instead, judge readiness contextually based on:",
        "1. Offering & Delivery Model: A digital/SaaS/remote service can compete globally or cross-border in the target market even when local brick-and-mortar competitors are scarce or market availability is partially unverified. A physical local service or retailer relies more heavily on domestic/cross-border delivery evidence.",
        "2. Competitive Relationship Coverage: Whether direct, substitute, or adjacent competitors cover the core offering.",
        "3. Buyer Segment Coverage: Whether the selected competitors reflect the intended buyer segments (B2C, B2B, or both).",
        "4. Market Applicability: Whether the evidence for the target market is strong (READY) or has explicit caveats such as unverified market availability, only adjacent/international references, or missing B2B/B2C segment coverage (READY_WITH_LIMITED_EVIDENCE).",
        "Note: Since at least one relevant approved competitor is already selected and context is valid, choose between 'READY' and 'READY_WITH_LIMITED_EVIDENCE'.",
        "",
        "BUSINESS & OFFERING CONTEXT:",
        `- Business Name: ${input.businessName}`,
        `- Selected Offering: ${input.offeringName}`,
        `- Category: ${input.category}`,
        `- Target Market: ${input.targetMarket}`,
        `- Offering & Delivery Model: ${deliveryCat} (${input.classificationProfile?.offeringAndDelivery?.reasoning || input.businessModel || "N/A"})`,
        `- Buyer Segment: ${buyerCat} (${input.classificationProfile?.buyerSegment?.reasoning || "N/A"})`,
        `- Monetization: ${monetizationCat}`,
        `- Target Roles: ${JSON.stringify(input.targetRoles || [])}`,
        `- Product Facts: ${JSON.stringify((input.productTruthFacts || []).slice(0, 8))}`,
        `- Known Evidence Gaps: ${JSON.stringify(input.evidenceGaps || [])}`,
        "",
        `SELECTED APPROVED COMPETITORS (${selectedCandidates.length}):`,
        JSON.stringify(candidateSummaries, null, 2),
        "",
        "Return ONLY valid JSON matching:",
        "{",
        '  "verdict": "READY" | "READY_WITH_LIMITED_EVIDENCE",',
        '  "headline": "Concise status headline",',
        '  "reason": "Clear explanation of why the user can proceed and any caveats",',
        '  "nextAction": "Clear guidance on whether to proceed or optionally run Continue Discovery for specific gaps",',
        '  "offeringCoverage": "Assessment of direct/substitute/adjacent coverage for the offering",',
        '  "buyerSegmentCoverage": "Assessment of B2B/B2C buyer segment coverage",',
        '  "marketApplicability": "Assessment of market availability evidence in the target market",',
        '  "materialGaps": ["Specific remaining evidence gap 1 (if any)"]',
        "}",
      ].join("\n");

      const res = await aiChat({
        model: resolveModelForTier(DISCOVERY_MODEL_TIERS.RELEVANCE_VERIFIER),
        messages: [
          {
            role: "system",
            content:
              "You are Avyron's Contextual Competitor Discovery Readiness Assessor. Never enforce arbitrary fixed competitor counts. Output valid JSON only.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 650,
        response_format: { type: "json_object" },
        accountId: options?.accountId || "system",
        endpoint: "discovery-readiness-assessor",
      });

      const parsed = JSON.parse(res.choices?.[0]?.message?.content || "{}");
      const verdict: DiscoveryReadinessVerdict =
        parsed.verdict === "READY" || parsed.verdict === "READY_WITH_LIMITED_EVIDENCE"
          ? parsed.verdict
          : buildContextualFallbackReadiness(input, selectedCandidates, counts, discoveryHealth).verdict;

      const result: CompetitorDiscoveryReadiness = {
        verdict,
        canProceed: true,
        headline:
          typeof parsed.headline === "string" && parsed.headline.trim()
            ? parsed.headline.trim()
            : verdict === "READY"
              ? "Competitor Coverage Ready for Strategy Generation"
              : "Ready to Proceed with Limited Market Evidence",
        reason:
          typeof parsed.reason === "string" && parsed.reason.trim()
            ? parsed.reason.trim()
            : buildContextualFallbackReadiness(input, selectedCandidates, counts, discoveryHealth).reason,
        nextAction:
          typeof parsed.nextAction === "string" && parsed.nextAction.trim()
            ? parsed.nextAction.trim()
            : "You can proceed to Strategy Generation now, or run Continue Discovery to gather additional market evidence.",
        offeringCoverage:
          typeof parsed.offeringCoverage === "string" && parsed.offeringCoverage.trim()
            ? parsed.offeringCoverage.trim()
            : `${directCount} direct/relevant and ${adjacentOrSubstituteCount} adjacent/substitute competitor(s) selected.`,
        buyerSegmentCoverage:
          typeof parsed.buyerSegmentCoverage === "string" && parsed.buyerSegmentCoverage.trim()
            ? parsed.buyerSegmentCoverage.trim()
            : `Covers ${buyerCat} buyer context across ${selectedCandidates.length} selected competitor(s).`,
        marketApplicability:
          typeof parsed.marketApplicability === "string" && parsed.marketApplicability.trim()
            ? parsed.marketApplicability.trim()
            : `${localCount + crossBorderCount} verified serving ${input.targetMarket}, ${unverifiedMarketCount} with unverified market availability, ${internationalReferenceCount} international reference(s).`,
        materialGaps: Array.isArray(parsed.materialGaps)
          ? parsed.materialGaps.filter((g: any) => typeof g === "string" && g.trim())
          : [],
        counts,
        discoveryHealth,
      };

      readinessAssessmentCache.set(cacheFingerprint, result);
      return result;
    } catch (err: any) {
      console.warn("[evaluateCompetitorDiscoveryReadiness] LLM assessment fallback:", err?.message || err);
    }
  }

  const fallback = buildContextualFallbackReadiness(input, selectedCandidates, counts, discoveryHealth);
  readinessAssessmentCache.set(cacheFingerprint, fallback);
  return fallback;
}

function buildContextualFallbackReadiness(
  input: EvaluateDiscoveryReadinessInput,
  selectedCandidates: DiscoveredCompetitorCandidate[],
  counts: CompetitorDiscoveryReadiness["counts"],
  discoveryHealth: CompetitorDiscoveryReadiness["discoveryHealth"]
): CompetitorDiscoveryReadiness {
  const deliveryCat = input.classificationProfile?.offeringAndDelivery?.category || "UNCERTAIN";
  const buyerCat = input.classificationProfile?.buyerSegment?.category || "UNCERTAIN";
  const isDigitalOrSaas =
    deliveryCat === "SAAS_OR_WEB_APPLICATION" ||
    deliveryCat === "DIGITAL_PRODUCT_OR_SERVICE" ||
    deliveryCat === "MARKETPLACE_OR_PLATFORM";

  const marketVerifiedCount = counts.localCount + counts.crossBorderCount;
  const materialGaps: string[] = [];

  if (counts.directCount === 0) {
    materialGaps.push(
      `Selected competitors for ${input.offeringName} are currently adjacent, substitute, or benchmark alternatives rather than direct category matches.`
    );
  }

  if (marketVerifiedCount === 0 && counts.unverifiedMarketCount > 0) {
    materialGaps.push(
      `${counts.unverifiedMarketCount} selected competitor(s) match the offering, but explicit availability or localized pricing in ${input.targetMarket} has not yet been confirmed.`
    );
  } else if (marketVerifiedCount === 0 && counts.internationalReferenceCount > 0) {
    materialGaps.push(
      `Selected competitors are international category references without verified local presence in ${input.targetMarket}.`
    );
  }

  if (buyerCat === "B2B_AND_B2C") {
    const combinedReasons = selectedCandidates
      .map((c) => `${c.name} ${c.relevanceReason || ""} ${c.judgeReason || ""}`.toLowerCase())
      .join(" ");
    const hasB2bSignal = /\b(b2b|business|corporate|enterprise|agency|brand|commercial|team)\b/.test(combinedReasons);
    const hasB2cSignal = /\b(b2c|consumer|personal|gift|individual|customer|family|occasion)\b/.test(combinedReasons);
    if (!hasB2bSignal) {
      materialGaps.push("Selected competitor evidence primarily reflects consumer (B2C) use cases; B2B/commercial buyer alternatives are limited.");
    } else if (!hasB2cSignal) {
      materialGaps.push("Selected competitor evidence primarily reflects B2B use cases; consumer (B2C) alternatives are limited.");
    }
  }

  if (discoveryHealth.providerErrorCount > 0) {
    materialGaps.push(`${discoveryHealth.providerErrorCount} search provider call(s) encountered errors during discovery.`);
  }

  const hasStrongCoverage =
    counts.directCount > 0 &&
    (marketVerifiedCount > 0 || (isDigitalOrSaas && counts.directCount >= 1 && materialGaps.length === 0));

  const verdict: DiscoveryReadinessVerdict = hasStrongCoverage && materialGaps.length === 0
    ? "READY"
    : "READY_WITH_LIMITED_EVIDENCE";

  const offeringCoverage =
    counts.directCount > 0
      ? `${counts.directCount} direct/relevant competitor(s) and ${counts.adjacentOrSubstituteCount} adjacent/substitute alternative(s) selected for ${input.offeringName}.`
      : `${counts.adjacentOrSubstituteCount} adjacent/substitute alternative(s) and ${counts.internationalReferenceCount} benchmark reference(s) selected for ${input.offeringName}; no direct identical competitor confirmed yet.`;

  const buyerSegmentCoverage =
    buyerCat === "B2B_AND_B2C"
      ? `Evaluated against dual B2B and B2C buyer segments for ${input.offeringName}.`
      : `Evaluated against ${buyerCat} buyer context for ${input.offeringName}.`;

  const marketApplicability =
    marketVerifiedCount > 0
      ? `${marketVerifiedCount} selected competitor(s) have verified local or cross-border service in ${input.targetMarket}${counts.unverifiedMarketCount > 0 ? `, plus ${counts.unverifiedMarketCount} relevant competitor(s) with unverified ${input.targetMarket} availability` : ""}.`
      : isDigitalOrSaas
        ? `Digital/online delivery model (${deliveryCat}): ${counts.unverifiedMarketCount + counts.internationalReferenceCount} relevant software/digital competitor(s) selected; explicit ${input.targetMarket} localization is unverified.`
        : `No verified domestic ${input.targetMarket} storefront confirmed yet; proceeding with ${selectedCandidates.length} relevant competitor(s) with limited local market evidence.`;

  const headline =
    verdict === "READY"
      ? "Competitor Coverage Ready for Strategy Generation"
      : "Ready to Proceed with Caveats (Limited Market Evidence)";

  const reason =
    verdict === "READY"
      ? `Selected ${selectedCandidates.length} relevant competitor(s) covering ${input.offeringName} in ${input.targetMarket}.`
      : `You can proceed with ${selectedCandidates.length} selected competitor(s) for ${input.offeringName}. ${materialGaps.join(" ")}`;

  const nextAction =
    verdict === "READY"
      ? "Continue to Strategy Generation, or optionally add/adjust competitors."
      : "You can proceed to Strategy Generation now with explicit evidence caveats, or click 'Continue Discovery' to search specifically for remaining gaps.";

  return {
    verdict,
    canProceed: true,
    headline,
    reason,
    nextAction,
    offeringCoverage,
    buyerSegmentCoverage,
    marketApplicability,
    materialGaps,
    counts,
    discoveryHealth,
  };
}
