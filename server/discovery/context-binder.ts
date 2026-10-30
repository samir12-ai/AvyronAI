import { createHash } from "crypto";
import { db } from "../db";
import { and, desc, eq } from "drizzle-orm";
import {
  campaignOfferings,
  campaignSelections,
  growthCampaigns,
  offeringInputEvidence,
  websiteSnapshots,
  businessUnderstandingSnapshots,
  competitorSources,
  ciCompetitors,
} from "@shared/schema";
import { resolveCurrentBusinessUnderstanding } from "../business-understanding/resolver";
import { resolveMarketLocalization } from "../shared/market-localization";
import type {
  BusinessClassificationProfile,
  ProductTruthFact,
  TargetRoleFact,
} from "@shared/business-understanding-types";

export interface PinnedDiscoveryContext {
  accountId: string;
  campaignId: string;
  campaignOfferingId: string;
  offeringName: string;
  offeringEvidenceId?: string;
  offeringFingerprint?: string;
  buSnapshotId: string;
  buVersion?: number;
  sourceEvidenceFingerprint?: string;
  targetMarket: string;
  marketRevision?: string;
  businessName: string;
  businessModel: string;
  generalIndustry?: string;
  category: string;
  offeringType?: string;
  pricingModel?: string;
  classificationProfile?: BusinessClassificationProfile;
  evidenceGaps?: string[];
  productTruthFacts: string[];
  structuredProductTruthFacts?: ProductTruthFact[];
  targetRoles: string[];
  structuredTargetRoles?: TargetRoleFact[];
  pinnedAt?: number;
  canonicalWebsite?: string;
  canonicalDomain?: string;
  targetLanguage?: string;
  contextFingerprint?: string;
  knownCompetitorDomains?: string[];
  knownCompetitorNames?: string[];
}

export interface ContextVerificationResult {
  valid: boolean;
  reason?: string;
}

function canonicalizeMarketKey(rawMarket?: string | null): string {
  const trimmed = (rawMarket || "").trim().toLowerCase();
  if (!trimmed) return "";
  const loc = resolveMarketLocalization(trimmed);
  if (loc.countryName && loc.countryName !== "Global / Regional") {
    return loc.countryName.toLowerCase();
  }
  return trimmed;
}

/**
 * Checks whether a persisted competitorDiscoverySessions row is compatible with the current pinned context
 * (target market, selected offering, and canonical BU snapshot).
 */
export function checkDiscoverySessionCompatibility(
  session: {
    targetMarket?: string | null;
    campaignOfferingId?: string | null;
    buSnapshotId?: string | null;
    [key: string]: any;
  } | null | undefined,
  current: {
    targetMarket: string;
    campaignOfferingId?: string | null;
    buSnapshotId?: string | null;
  }
): ContextVerificationResult {
  if (!session) {
    return { valid: false, reason: "No existing discovery session found." };
  }
  const sessionMarket = canonicalizeMarketKey(session.targetMarket);
  const currentMarket = canonicalizeMarketKey(current.targetMarket);
  if (sessionMarket && currentMarket && sessionMarket !== currentMarket) {
    return {
      valid: false,
      reason: `Target market changed from '${session.targetMarket}' to '${current.targetMarket}'. Previous discovery results belong to a different market and cannot be reused directly.`,
    };
  }
  if (
    current.campaignOfferingId &&
    session.campaignOfferingId &&
    session.campaignOfferingId !== current.campaignOfferingId
  ) {
    return {
      valid: false,
      reason: `Selected offering changed from '${session.campaignOfferingId}' to '${current.campaignOfferingId}'.`,
    };
  }
  if (
    current.buSnapshotId &&
    session.buSnapshotId &&
    session.buSnapshotId !== current.buSnapshotId
  ) {
    return {
      valid: false,
      reason: `Canonical Business Understanding snapshot changed from '${session.buSnapshotId}' to '${current.buSnapshotId}'.`,
    };
  }
  return { valid: true };
}

/**
 * Resolves and pins immutable context exactly once per discovery run.
 * Contract:
 * - accountId, campaignId
 * - offering + revision / fingerprint
 * - buSnapshotId + version
 * - sourceEvidenceFingerprint
 * - market + revision
 * Fails closed if canonical Business Understanding or hero offering is missing.
 */
export async function resolvePinnedDiscoveryContext(params: {
  accountId: string;
  campaignId: string;
}): Promise<PinnedDiscoveryContext> {
  const { accountId, campaignId } = params;

  // 1. Resolve Target Market Authoritatively
  let targetMarket = "Unspecified";
  let marketRevision = "0";
  const [camp] = await db
    .select()
    .from(campaignSelections)
    .where(and(
      eq(campaignSelections.accountId, accountId),
      eq(campaignSelections.selectedCampaignId, campaignId)
    ))
    .limit(1);

  if (camp?.campaignLocation?.trim()) {
    targetMarket = camp.campaignLocation.trim();
    marketRevision = String(camp.updatedAt?.getTime() || camp.selectedAt?.getTime() || 0);
  } else {
    const [growthCamp] = await db
      .select()
      .from(growthCampaigns)
      .where(eq(growthCampaigns.id, campaignId))
      .limit(1);
    if ((growthCamp as any)?.targetMarket?.trim()) {
      targetMarket = (growthCamp as any).targetMarket.trim();
      marketRevision = String((growthCamp as any).updatedAt?.getTime() || 0);
    }
  }

  // 2. Fetch Authoritative Hero Offering
  const [offering] = await db
    .select()
    .from(campaignOfferings)
    .where(and(
      eq(campaignOfferings.accountId, accountId),
      eq(campaignOfferings.campaignId, campaignId)
    ))
    .orderBy(desc(campaignOfferings.createdAt))
    .limit(1);

  if (!offering || !offering.sourceInputEvidenceId) {
    throw new Error(
      `[ContextBinder] FAIL-CLOSED: No confirmed Hero Offering exists for accountId=${accountId}, campaignId=${campaignId}.`
    );
  }

  const [evidence] = await db
    .select()
    .from(offeringInputEvidence)
    .where(and(
      eq(offeringInputEvidence.id, offering.sourceInputEvidenceId),
      eq(offeringInputEvidence.accountId, accountId),
      eq(offeringInputEvidence.campaignId, campaignId)
    ))
    .limit(1);

  const offeringFingerprint = evidence?.contentHash || `off_${offering.offeringName}_${evidence?.confirmedAt?.getTime() || 0}`;

  // 3. Resolve Supporting Canonical Business Understanding Context via hardened resolver
  const buResult = await resolveCurrentBusinessUnderstanding({
    accountId,
    campaignId,
    campaignOfferingId: offering.id,
  });

  if (!buResult || buResult.status !== "COMPLETE" || !buResult.payload) {
    throw new Error(
      `[ContextBinder] FAIL-CLOSED: No COMPLETE Business Understanding snapshot exists for campaign offering ${offering.id}.`
    );
  }

  const buPayload = buResult.payload;
  const buRow = buResult.snapshotRow;

  // 4. Source Evidence Fingerprint from Website Snapshot
  const [website] = await db
    .select()
    .from(websiteSnapshots)
    .where(and(
      eq(websiteSnapshots.accountId, accountId),
      eq(websiteSnapshots.campaignId, campaignId)
    ))
    .orderBy(desc(websiteSnapshots.createdAt))
    .limit(1);

  const sourceEvidenceFingerprint = website?.contentHash || "NO_WEBSITE_EVIDENCE";

  const allStructuredProductTruthFacts: ProductTruthFact[] = Array.isArray(buPayload.campaignOffering?.productTruthFacts)
    ? buPayload.campaignOffering.productTruthFacts
    : [];
  const structuredProductTruthFacts: ProductTruthFact[] = allStructuredProductTruthFacts.filter(
    (f: any) => f?.status !== "UNKNOWN"
  );

  const productTruthFacts = structuredProductTruthFacts.map((f: any) => {
    const stmt = f.statement || f.factText || String(f);
    const sources = Array.isArray(f.sourceIds) && f.sourceIds.length > 0 ? ` [sources: ${f.sourceIds.join(",")}]` : "";
    return `${stmt}${sources}`;
  });

  const structuredTargetRoles: TargetRole[] = Array.isArray(buPayload.targetUnderstanding?.targetRoles)
    ? buPayload.targetUnderstanding.targetRoles
    : [];

  const targetRoles = structuredTargetRoles.map((r: any) => {
    const title = r.roleTitle || String(r);
    const rationale = r.rationale ? ` — ${r.rationale}` : "";
    const sources = Array.isArray(r.sourceIds) && r.sourceIds.length > 0 ? ` [sources: ${r.sourceIds.join(",")}]` : "";
    return `${title}${rationale}${sources}`;
  });

  const evidenceGaps = Array.isArray(buPayload.evidenceGaps)
    ? buPayload.evidenceGaps
    : Array.isArray(buPayload.classificationProfile?.evidenceGaps)
      ? buPayload.classificationProfile.evidenceGaps
      : [];

  return {
    accountId,
    campaignId,
    campaignOfferingId: offering.id,
    offeringName: offering.offeringName,
    offeringEvidenceId: offering.sourceInputEvidenceId,
    offeringFingerprint,
    buSnapshotId: buResult.snapshotId,
    buVersion: buRow.version || 1,
    sourceEvidenceFingerprint,
    targetMarket,
    marketRevision,
    businessName: buPayload.businessName || offering.offeringName,
    businessModel: buPayload.businessModel || "Unspecified",
    generalIndustry: buPayload.generalIndustry || buPayload.campaignOffering?.category || "Unspecified",
    category: buPayload.campaignOffering?.category || buPayload.generalIndustry || "Unspecified",
    offeringType: buPayload.campaignOffering?.offeringType,
    pricingModel: buPayload.campaignOffering?.pricingModel,
    classificationProfile: buPayload.classificationProfile,
    evidenceGaps,
    productTruthFacts,
    structuredProductTruthFacts,
    targetRoles,
    structuredTargetRoles,
    pinnedAt: Date.now(),
  };
}

/**
 * Verifies that the pinned context has NOT drifted or been modified during the discovery run.
 * Aborts if offering, BU snapshot, or target market changed mid-run.
 */
export async function verifyPinnedDiscoveryContextStillCurrent(
  pinned: PinnedDiscoveryContext
): Promise<ContextVerificationResult> {
  // 1. Verify offering still current
  const [currentOffering] = await db
    .select()
    .from(campaignOfferings)
    .where(and(
      eq(campaignOfferings.accountId, pinned.accountId),
      eq(campaignOfferings.campaignId, pinned.campaignId)
    ))
    .orderBy(desc(campaignOfferings.createdAt))
    .limit(1);

  if (!currentOffering || currentOffering.id !== pinned.campaignOfferingId || currentOffering.sourceInputEvidenceId !== pinned.offeringEvidenceId) {
    return {
      valid: false,
      reason: `Hero Offering drifted mid-run: expected offeringId=${pinned.campaignOfferingId}, got offeringId=${currentOffering?.id}.`,
    };
  }

  // 2. Verify BU snapshot still resolves to the pinned snapshot
  const buResult = await resolveCurrentBusinessUnderstanding({
    accountId: pinned.accountId,
    campaignId: pinned.campaignId,
    campaignOfferingId: pinned.campaignOfferingId,
  });

  if (!buResult || buResult.snapshotId !== pinned.buSnapshotId || buResult.status !== "COMPLETE") {
    return {
      valid: false,
      reason: `Canonical Business Understanding drifted mid-run: expected snapshotId=${pinned.buSnapshotId}, got snapshotId=${buResult?.snapshotId} (status=${buResult?.status}).`,
    };
  }

  // 3. Verify target market still matches
  const [camp] = await db
    .select()
    .from(campaignSelections)
    .where(and(
      eq(campaignSelections.accountId, pinned.accountId),
      eq(campaignSelections.selectedCampaignId, pinned.campaignId)
    ))
    .limit(1);

  const currentMarket = camp?.campaignLocation?.trim() || "Unspecified";
  if (currentMarket !== pinned.targetMarket) {
    return {
      valid: false,
      reason: `Target Market drifted mid-run: expected '${pinned.targetMarket}', got '${currentMarket}'.`,
    };
  }

  return { valid: true };
}

/**
 * Normalizes a URL or domain string to a clean, lowercase hostname without protocol or www prefix.
 */
export function normalizeDomain(rawUrl: string): string {
  if (!rawUrl) return "";
  try {
    let urlStr = rawUrl.trim();
    if (!urlStr.startsWith("http://") && !urlStr.startsWith("https://")) {
      urlStr = "https://" + urlStr;
    }
    const parsed = new URL(urlStr);
    return parsed.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return rawUrl.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  }
}

export interface CanonicalAuthoritativeContext extends PinnedDiscoveryContext {
  canonicalWebsite: string;
  canonicalDomain: string;
  targetLanguage: string;
  contextFingerprint: string;
  knownCompetitorDomains: string[];
  knownCompetitorNames: string[];
}

/**
 * Resolves the immutable, canonical business and campaign context before acquisition or analysis runs.
 * Computes a deterministic SHA-256 fingerprint from the authoritative BU v2, hero offering,
 * target market, and campaign domain settings.
 */
export async function resolveCanonicalContext(params: {
  accountId: string;
  campaignId: string;
}): Promise<CanonicalAuthoritativeContext> {
  const pinned = await resolvePinnedDiscoveryContext(params);

  // 1. Resolve canonical website & domain
  const [website] = await db
    .select()
    .from(websiteSnapshots)
    .where(and(
      eq(websiteSnapshots.accountId, params.accountId),
      eq(websiteSnapshots.campaignId, params.campaignId)
    ))
    .orderBy(desc(websiteSnapshots.createdAt))
    .limit(1);

  const rawWebsite = website?.rootUrl || "";
  const canonicalDomain = normalizeDomain(rawWebsite);
  const canonicalWebsite = rawWebsite || (canonicalDomain ? `https://${canonicalDomain}` : "");

  // 2. Resolve language
  const [growthCamp] = await db
    .select()
    .from(growthCampaigns)
    .where(eq(growthCampaigns.id, params.campaignId))
    .limit(1);

  const marketLocalizedLang = resolveMarketLocalization(pinned.targetMarket)?.languageCode;
  const targetLanguage = (growthCamp as any)?.targetLanguage || (growthCamp as any)?.language || marketLocalizedLang || "en";

  // 3. Resolve known competitor domains and names to prevent own-brand confusion
  const compRows = await db
    .select({ name: ciCompetitors.name })
    .from(ciCompetitors)
    .where(and(
      eq(ciCompetitors.accountId, params.accountId),
      eq(ciCompetitors.campaignId, params.campaignId)
    ));
  const knownCompetitorNames = compRows.map(c => c.name.trim()).filter(Boolean);

  const sourceRows = await db
    .select({ canonicalUrl: competitorSources.canonicalUrl })
    .from(competitorSources)
    .where(and(
      eq(competitorSources.accountId, params.accountId),
      eq(competitorSources.campaignId, params.campaignId)
    ));

  const knownCompetitorDomains = Array.from(new Set(
    sourceRows
      .map(s => normalizeDomain(s.canonicalUrl))
      .filter(d => Boolean(d) && d !== canonicalDomain)
  ));

  // 4. Deterministic Context Fingerprint
  const canonicalPayload = {
    brandName: pinned.businessName.trim().toLowerCase(),
    canonicalDomain,
    category: pinned.category.trim().toLowerCase(),
    heroProduct: pinned.offeringName.trim().toLowerCase(),
    targetMarket: pinned.targetMarket.trim().toLowerCase(),
    targetLanguage: targetLanguage.trim().toLowerCase(),
    buSnapshotId: pinned.buSnapshotId,
    buVersion: pinned.buVersion,
    offeringEvidenceId: pinned.offeringEvidenceId,
    offeringFingerprint: pinned.offeringFingerprint,
  };

  const contextFingerprint = createHash("sha256").update(JSON.stringify(canonicalPayload)).digest("hex");

  return {
    ...pinned,
    canonicalWebsite,
    canonicalDomain,
    targetLanguage,
    contextFingerprint,
    knownCompetitorDomains,
    knownCompetitorNames,
  };
}

