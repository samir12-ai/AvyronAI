/**
 * Avyron Canonical Evidence Routing & Normalization Layer
 * 
 * Enforces the strict boundary between:
 * 1. Customer Voice (Customer-authored comments, reviews, and market quotes)
 * 2. Competitor / Market Intelligence (Competitor-authored posts, videos, blogs, website features)
 * 
 * Constitutional Invariants:
 * - Evidence is routed by (Source Identity + Authorship + Evidence Type), NOT platform alone.
 * - Customer Voice != Pain. This layer normalizes evidence; semantic interpretation belongs to Audience downstream.
 * - Raw tables (ci_competitor_posts, ci_competitor_comments, ci_competitor_reviews, market_voice_evidence) are preserved.
 * - Brand/owner replies are excluded from Customer Voice.
 */

import { db } from "../db";
import { 
  ciCompetitors, 
  ciCompetitorPosts, 
  ciCompetitorComments, 
  ciCompetitorReviews, 
  marketVoiceEvidence, 
  competitorSources,
  type CompetitorStrategicRole,
} from "@shared/schema";
import { type CustomerEvidencePool } from "@shared/contracts/discovery-contracts";
import { type SemanticEvidenceScope, type MarketTransferability } from "@shared/contracts/market-voice";
import { eq, and, inArray } from "drizzle-orm";
import { createHash } from "crypto";

export type CustomerEvidenceOrigin = "COMPETITOR_COMMENT" | "COMPETITOR_REVIEW" | "MARKET_VOICE";

export interface EvidenceContributor {
  evidenceId: string;
  origin?: CustomerEvidenceOrigin;
  sourceId?: string;
  competitorId?: string;
  competitorName?: string;
  platform: string;
  strategicRole?: CompetitorStrategicRole;
  evidencePool: CustomerEvidencePool;
  semanticScope?: SemanticEvidenceScope;
  transferability?: MarketTransferability;
}

export type RegistryResolutionStatus =
  | "REGISTERED_COMPETITOR"
  | "OBSERVED_UNREGISTERED_SUBJECT"
  | "UNATTRIBUTED";

export interface CustomerEvidenceUnit {
  evidenceId: string;
  origin: CustomerEvidenceOrigin;
  platform: "instagram" | "tiktok" | "youtube" | "trustpilot" | "google" | "reddit" | "forums" | "web" | string;
  competitorId?: string;
  competitorName?: string;
  observedSubjectDomain?: string;
  observedSubjectName?: string;
  registryResolutionStatus?: RegistryResolutionStatus;
  strategicRole?: CompetitorStrategicRole;
  evidencePool: CustomerEvidencePool;
  semanticScope?: SemanticEvidenceScope;
  transferability?: MarketTransferability;
  eligibilityVerdict?: string;
  contributors?: EvidenceContributor[];
  sourceId?: string;
  accountId: string;
  campaignId: string;
  offeringId?: string;
  parentContentId?: string;
  text: string;
  author: string | null;
  authorType: "CUSTOMER" | "COMMUNITY_USER";
  likesCount?: number;
  sourceTimestamp?: string;
  acquiredAt: string;
  verificationProvenance: {
    isVerified: boolean;
    verificationMethod?: string;
    sourceUrl?: string;
  };
  rawEvidenceReference: {
    table: "ci_competitor_comments" | "ci_competitor_reviews" | "market_voice_evidence";
    id: string;
  };
}

export interface CompetitorContentEvidence {
  contentId: string;
  competitorId: string;
  competitorName?: string;
  sourceId?: string;
  platform: "instagram" | "tiktok" | "youtube" | "website" | "blog" | string;
  contentType: "post" | "video" | "product_page" | "feature" | "offer" | "blog_article";
  title?: string;
  caption?: string;
  text: string;
  url?: string;
  engagement?: {
    likes?: number;
    comments?: number;
    views?: number;
    shares?: number;
  };
  timestamp?: string;
  metadata?: Record<string, any>;
  acquisitionLineage: {
    accountId: string;
    campaignId: string;
    batchId?: string;
    acquiredAt: string;
  };
}

/**
 * Computes a deterministic identity hash for customer evidence units.
 */
export function computeCustomerEvidenceId(origin: CustomerEvidenceOrigin, platform: string, externalOrDbId: string, textSnippet: string): string {
  const normText = textSnippet.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 100);
  const hash = createHash("sha256").update(`${origin}:${platform}:${externalOrDbId}:${normText}`).digest("hex").slice(0, 16);
  return `cev_${origin.toLowerCase().slice(0, 3)}_${hash}`;
}

/**
 * Determines whether an evidence item is customer-authored or competitor-authored.
 */
export function classifyEvidenceAuthorship(item: {
  evidenceType: "post" | "video" | "comment" | "review" | "article" | "quote";
  platform: string;
  authorType?: string;
  isOwnerReply?: boolean;
}): { destination: "CUSTOMER_VOICE" | "COMPETITOR_INTELLIGENCE"; authorClass: "CUSTOMER" | "COMPETITOR" | "COMMUNITY" } {
  const { evidenceType, authorType, isOwnerReply } = item;

  // Competitor-authored content
  if (
    evidenceType === "post" ||
    evidenceType === "video" ||
    evidenceType === "article" ||
    isOwnerReply === true ||
    authorType === "brand" ||
    authorType === "owner" ||
    authorType === "competitor"
  ) {
    return { destination: "COMPETITOR_INTELLIGENCE", authorClass: "COMPETITOR" };
  }

  // Customer-authored comments and reviews
  if (evidenceType === "comment" || evidenceType === "review") {
    return { destination: "CUSTOMER_VOICE", authorClass: "CUSTOMER" };
  }

  // Broad market voice discussions
  if (evidenceType === "quote") {
    return { destination: "CUSTOMER_VOICE", authorClass: "COMMUNITY" };
  }

  return { destination: "COMPETITOR_INTELLIGENCE", authorClass: "COMPETITOR" };
}

/**
 * Loads all raw customer-authored evidence for a campaign and normalizes into CustomerEvidenceUnit[].
 */
export async function loadCanonicalCustomerVoice(
  accountId: string,
  campaignId: string,
  options?: {
    approvedMarketVoiceEvidenceIds?: string[];
    evidenceManifest?: import("@shared/schema").EvidenceManifest | null;
  }
): Promise<CustomerEvidenceUnit[]> {
  const activeComps = await db.select().from(ciCompetitors)
    .where(and(
      eq(ciCompetitors.accountId, accountId),
      eq(ciCompetitors.campaignId, campaignId),
      eq(ciCompetitors.isActive, true)
    ));
  const activeCompMap = new Map(activeComps.map(c => [c.id, c.name]));
  const compRoleMap = new Map(activeComps.map(c => [c.id, (c.strategicRole as CompetitorStrategicRole) || "UNRESOLVED"]));
  const activeCompIds = activeComps.map(c => c.id);

  const units: CustomerEvidenceUnit[] = [];

  // 1. Competitor Comments (Instagram, TikTok, YouTube)
  if (activeCompIds.length > 0) {
    const commentAllowedIds = options?.evidenceManifest?.includedCommentIds
      ? (options.evidenceManifest.includedCommentIds as string[])
      : undefined;

    let rawComments: any[] = [];
    if (commentAllowedIds !== undefined) {
      if (commentAllowedIds.length > 0) {
        rawComments = await db.select().from(ciCompetitorComments)
          .where(and(
            eq(ciCompetitorComments.accountId, accountId),
            inArray(ciCompetitorComments.competitorId, activeCompIds),
            inArray(ciCompetitorComments.id, commentAllowedIds)
          ));
      } else {
        rawComments = [];
      }
    } else {
      rawComments = await db.select().from(ciCompetitorComments)
        .where(and(
          eq(ciCompetitorComments.accountId, accountId),
          inArray(ciCompetitorComments.competitorId, activeCompIds)
        ));
    }

    for (const comm of rawComments) {
      // Exclude brand/owner replies
      if (comm.authorType === "brand" || comm.authorType === "owner") continue;
      if (!comm.commentText || comm.commentText.trim().length === 0) continue;

      let plat = (comm as any).platform || "instagram";
      if (comm.source === "tiktok_scrape") plat = "tiktok";
      else if (comm.source === "youtube_scrape") plat = "youtube";

      const strategicRole = compRoleMap.get(comm.competitorId) || "UNRESOLVED";
      let evidencePool: CustomerEvidencePool = "UNRESOLVED_EXCLUDED";
      if (strategicRole === "DIRECT" || strategicRole === "ADJACENT") evidencePool = "SUPPORTING_SOCIAL_CUSTOMER_VOICE";
      else if (strategicRole === "ASPIRATIONAL") evidencePool = "BENCHMARK_CONTEXT";
      else evidencePool = "UNRESOLVED_EXCLUDED";

      const unitId = computeCustomerEvidenceId("COMPETITOR_COMMENT", plat, comm.commentId || comm.id, comm.commentText);

      units.push({
        evidenceId: unitId,
        origin: "COMPETITOR_COMMENT",
        platform: plat,
        competitorId: comm.competitorId,
        competitorName: activeCompMap.get(comm.competitorId) || undefined,
        strategicRole,
        evidencePool,
        accountId,
        campaignId,
        parentContentId: comm.postId || undefined,
        text: comm.commentText.trim(),
        author: (comm as any).authorUsername || comm.username || comm.authorType || null,
        authorType: "CUSTOMER",
        likesCount: comm.likesCount ?? (comm as any).likes ?? undefined,
        sourceTimestamp: comm.timestamp ? new Date(comm.timestamp).toISOString() : undefined,
        acquiredAt: comm.createdAt ? new Date(comm.createdAt).toISOString() : new Date().toISOString(),
        verificationProvenance: {
          isVerified: true,
          verificationMethod: "platform_comment_scrape",
        },
        rawEvidenceReference: {
          table: "ci_competitor_comments",
          id: comm.id,
        },
      });
    }

    // 2. Competitor Reviews (Trustpilot, Google Reviews)
    const reviewAllowedIds = options?.evidenceManifest?.includedReviewIds
      ? (options.evidenceManifest.includedReviewIds as string[])
      : undefined;

    let rawReviews: any[] = [];
    if (reviewAllowedIds !== undefined) {
      if (reviewAllowedIds.length > 0) {
        rawReviews = await db.select().from(ciCompetitorReviews)
          .where(and(
            eq(ciCompetitorReviews.accountId, accountId),
            inArray(ciCompetitorReviews.competitorId, activeCompIds),
            inArray(ciCompetitorReviews.id, reviewAllowedIds)
          ));
      } else {
        rawReviews = [];
      }
    } else {
      rawReviews = await db.select().from(ciCompetitorReviews)
        .where(and(
          eq(ciCompetitorReviews.accountId, accountId),
          inArray(ciCompetitorReviews.competitorId, activeCompIds)
        ));
    }

    for (const rev of rawReviews) {
      if (!rev.reviewText || rev.reviewText.trim().length === 0) continue;

      const plat = rev.platform || "trustpilot";
      const strategicRole = compRoleMap.get(rev.competitorId) || "UNRESOLVED";
      let evidencePool: CustomerEvidencePool = "UNRESOLVED_EXCLUDED";
      if (strategicRole === "DIRECT") evidencePool = "PRIMARY_MARKET_VOICE";
      else if (strategicRole === "ADJACENT") evidencePool = "SUPPORTING_SOCIAL_CUSTOMER_VOICE";
      else if (strategicRole === "ASPIRATIONAL") evidencePool = "BENCHMARK_CONTEXT";
      else evidencePool = "UNRESOLVED_EXCLUDED";

      const unitId = computeCustomerEvidenceId("COMPETITOR_REVIEW", plat, rev.reviewId || rev.id, rev.reviewText);

      units.push({
        evidenceId: unitId,
        origin: "COMPETITOR_REVIEW",
        platform: plat,
        competitorId: rev.competitorId,
        competitorName: activeCompMap.get(rev.competitorId) || undefined,
        strategicRole,
        evidencePool,
        accountId,
        campaignId,
        text: rev.reviewText.trim(),
        author: (rev as any).authorName || rev.authorHash || null,
        authorType: "CUSTOMER",
        sourceTimestamp: rev.reviewDate ? new Date(rev.reviewDate).toISOString() : undefined,
        acquiredAt: rev.scrapedAt ? new Date(rev.scrapedAt).toISOString() : new Date().toISOString(),
        verificationProvenance: {
          isVerified: true,
          verificationMethod: "verified_review_profile",
          sourceUrl: (rev as any).reviewUrl || undefined,
        },
        rawEvidenceReference: {
          table: "ci_competitor_reviews",
          id: rev.id,
        },
      });
    }
  }

  // 3. Market Voice Evidence (Reddit, Google SERP customer quotes, Forums)
  let allowedMvIds: string[] | undefined = undefined;
  if (options?.evidenceManifest?.includedMarketVoiceIds !== undefined) {
    allowedMvIds = options.evidenceManifest.includedMarketVoiceIds as string[];
  }
  if (options?.approvedMarketVoiceEvidenceIds !== undefined) {
    if (allowedMvIds !== undefined) {
      allowedMvIds = allowedMvIds.filter(id => options.approvedMarketVoiceEvidenceIds!.includes(id));
    } else {
      allowedMvIds = options.approvedMarketVoiceEvidenceIds;
    }
  }

  let rawMv: any[] = [];
  if (allowedMvIds !== undefined) {
    if (allowedMvIds.length > 0) {
      rawMv = await db.select().from(marketVoiceEvidence)
        .where(and(
          eq(marketVoiceEvidence.accountId, accountId),
          eq(marketVoiceEvidence.campaignId, campaignId),
          inArray(marketVoiceEvidence.id, allowedMvIds)
        ));
    } else {
      rawMv = [];
    }
  } else {
    rawMv = await db.select().from(marketVoiceEvidence)
      .where(and(
        eq(marketVoiceEvidence.accountId, accountId),
        eq(marketVoiceEvidence.campaignId, campaignId)
      ));
  }

  // Build lookup of active competitor domains and normalized review texts so competitor reviews
  // captured via Market Voice (e.g. trustpilot.com/review/<competitor-domain>) retain attribution.
  const compDomainMatchers: Array<{ id: string; name: string; role: CompetitorStrategicRole; domain: string }> = [];
  for (const c of activeComps) {
    const rawUrl = (c as any).websiteUrl || (c as any).url || "";
    let domain = "";
    if (rawUrl) {
      try {
        const parsed = new URL(rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`);
        domain = parsed.hostname.replace(/^www\./i, "").toLowerCase();
      } catch {
        domain = String(rawUrl).replace(/^https?:\/\/(www\.)?/i, "").split("/")[0].toLowerCase();
      }
    }
    if (!domain && c.name) {
      const slug = c.name.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (slug.length >= 5) domain = `${slug}.com`;
    }
    if (domain) {
      compDomainMatchers.push({
        id: c.id,
        name: c.name,
        role: compRoleMap.get(c.id) || "UNRESOLVED",
        domain,
      });
    }
  }

  const reviewTextToComp = new Map<string, { id: string; name: string; role: CompetitorStrategicRole }>();
  for (const u of units) {
    if (u.origin === "COMPETITOR_REVIEW" && u.competitorId && u.text) {
      const normText = u.text.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 160);
      if (normText.length >= 25) {
        reviewTextToComp.set(normText, {
          id: u.competitorId,
          name: u.competitorName || activeCompMap.get(u.competitorId) || "Competitor",
          role: u.strategicRole || "UNRESOLVED",
        });
      }
    }
  }

  for (const mv of rawMv) {
    const text = mv.verbatimText || "";
    if (!text || text.trim().length === 0) continue;

    const plat = mv.platform || "web";
    const unitId = computeCustomerEvidenceId("MARKET_VOICE", plat, mv.externalId || mv.id, text);

    let matchedComp: { id: string; name: string; role: CompetitorStrategicRole } | undefined;
    const extUrlLower = String(mv.externalUrl || "").toLowerCase();
    if (extUrlLower) {
      for (const m of compDomainMatchers) {
        if (
          extUrlLower.includes(`/review/${m.domain}`) ||
          extUrlLower.includes(`/reviews/${m.domain}`) ||
          extUrlLower.includes(m.domain)
        ) {
          matchedComp = { id: m.id, name: m.name, role: m.role };
          break;
        }
      }
    }
    if (!matchedComp) {
      const normMvText = text.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 160);
      if (normMvText.length >= 25) {
        matchedComp = reviewTextToComp.get(normMvText);
      }
    }
    if (!matchedComp) {
      const lowerText = text.toLowerCase();
      for (const c of activeComps) {
        const cName = String(c.name || "").trim();
        if (cName.length >= 5 && lowerText.includes(cName.toLowerCase())) {
          matchedComp = {
            id: c.id,
            name: cName,
            role: compRoleMap.get(c.id) || "UNRESOLVED",
          };
          break;
        }
      }
    }

    let observedSubjectDomain: string | undefined;
    let observedSubjectName: string | undefined;
    if (!matchedComp) {
      // Check if review URL identifies a specific reviewed domain (e.g. trustpilot.com/review/songlygift.com)
      const tpDomainMatch = extUrlLower.match(/trustpilot\.com\/reviews?\/(?:www\.)?([a-z0-9.-]+\.[a-z]{2,})/i);
      if (tpDomainMatch && tpDomainMatch[1]) {
        observedSubjectDomain = tpDomainMatch[1].toLowerCase();
        observedSubjectName = observedSubjectDomain;
      }
      // Also check if the review text explicitly names a reviewed business subject (e.g. "I used Divine Songs for...")
      const usedMatch =
        text.match(/\b(?:I|we)\s+(?:used|ordered\s+from|bought\s+from|purchased\s+from|hired|tried)\s+([A-Z][A-Za-z0-9&.+-]*(?:\s+[A-Z][A-Za-z0-9&.+-]*){0,3})\s+(?:for|to|and|on|because)\b/) ||
        text.match(/\b([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+){0,2}\s+(?:Songs?|Music|Studio|Gifts?))\b/);
      if (usedMatch && usedMatch[1]) {
        const candidateSubject = usedMatch[1].trim();
        const stopSubjects = new Set(["The Song", "My Song", "Our Song", "This Song", "Custom Song", "Personalized Song", "Personalised Song", " AI Song"]);
        if (candidateSubject.length >= 4 && !stopSubjects.has(candidateSubject)) {
          observedSubjectName = candidateSubject;
        }
      }
    }

    const registryResolutionStatus: RegistryResolutionStatus = matchedComp
      ? "REGISTERED_COMPETITOR"
      : (observedSubjectName || observedSubjectDomain)
        ? "OBSERVED_UNREGISTERED_SUBJECT"
        : "UNATTRIBUTED";

    const effectiveCompetitorName = matchedComp?.name || observedSubjectName || observedSubjectDomain || undefined;

    units.push({
      evidenceId: unitId,
      origin: "MARKET_VOICE",
      platform: plat,
      competitorId: matchedComp?.id,
      competitorName: effectiveCompetitorName,
      observedSubjectDomain,
      observedSubjectName,
      registryResolutionStatus,
      strategicRole: matchedComp?.role,
      evidencePool: "PRIMARY_MARKET_VOICE",
      semanticScope: (mv.semanticScope as any) || undefined,
      transferability: (mv.transferability as any) || undefined,
      eligibilityVerdict: (mv.eligibilityVerdict as any) || undefined,
      accountId,
      campaignId,
      offeringId: mv.campaignOfferingId || undefined,
      text: text.trim(),
      author: mv.authorHash || null,
      authorType: matchedComp || observedSubjectName || observedSubjectDomain ? "CUSTOMER" : "COMMUNITY_USER",
      likesCount: mv.likesCount || undefined,
      sourceTimestamp: mv.publishedAt ? new Date(mv.publishedAt).toISOString() : undefined,
      acquiredAt: mv.createdAt ? new Date(mv.createdAt).toISOString() : new Date().toISOString(),
      verificationProvenance: {
        isVerified: true,
        verificationMethod: "market_voice_discovery_job",
        sourceUrl: mv.externalUrl || undefined,
      },
      rawEvidenceReference: {
        table: "market_voice_evidence",
        id: mv.id,
      },
    });
  }

  return units;
}

/**
 * Loads all raw competitor-authored content for a campaign and normalizes into CompetitorContentEvidence[].
 */
export async function loadCanonicalCompetitorContent(
  accountId: string,
  campaignId: string,
  options?: {
    evidenceManifest?: import("@shared/schema").EvidenceManifest | null;
  }
): Promise<CompetitorContentEvidence[]> {
  const activeComps = await db.select().from(ciCompetitors)
    .where(and(
      eq(ciCompetitors.accountId, accountId),
      eq(ciCompetitors.campaignId, campaignId),
      eq(ciCompetitors.isActive, true)
    ));
  const activeCompMap = new Map(activeComps.map(c => [c.id, c.name]));
  const activeCompIds = activeComps.map(c => c.id);

  if (activeCompIds.length === 0) return [];

  const postAllowedIds = options?.evidenceManifest?.includedPostIds
    ? (options.evidenceManifest.includedPostIds as string[])
    : undefined;

  let rawPosts: any[] = [];
  if (postAllowedIds !== undefined) {
    if (postAllowedIds.length > 0) {
      rawPosts = await db.select().from(ciCompetitorPosts)
        .where(and(
          eq(ciCompetitorPosts.accountId, accountId),
          inArray(ciCompetitorPosts.competitorId, activeCompIds),
          inArray(ciCompetitorPosts.id, postAllowedIds)
        ));
    } else {
      rawPosts = [];
    }
  } else {
    rawPosts = await db.select().from(ciCompetitorPosts)
      .where(and(
        eq(ciCompetitorPosts.accountId, accountId),
        inArray(ciCompetitorPosts.competitorId, activeCompIds)
      ));
  }

  const content: CompetitorContentEvidence[] = [];

  for (const p of rawPosts) {
    const text = p.caption || p.hookText || "";
    const plat = p.platform || "instagram";
    const isVideo = plat === "tiktok" || plat === "youtube" || p.mediaType === "VIDEO";

    content.push({
      contentId: p.id,
      competitorId: p.competitorId,
      competitorName: activeCompMap.get(p.competitorId) || undefined,
      platform: plat,
      contentType: isVideo ? "video" : "post",
      caption: p.caption || undefined,
      text: text.trim(),
      url: p.permalink || undefined,
      engagement: {
        likes: p.likes || undefined,
        comments: p.comments || undefined,
        views: p.views || undefined,
      },
      timestamp: p.timestamp ? new Date(p.timestamp).toISOString() : undefined,
      metadata: {
        hashtags: p.hashtags,
        mediaType: p.mediaType,
        hookText: p.hookText,
        transcript: p.transcript,
      },
      acquisitionLineage: {
        accountId,
        campaignId,
        batchId: p.batchId || undefined,
        acquiredAt: p.createdAt ? new Date(p.createdAt).toISOString() : new Date().toISOString(),
      },
    });
  }

  return content;
}

const POOL_PRIORITY: Record<CustomerEvidencePool, number> = {
  PRIMARY_MARKET_VOICE: 3,
  SUPPORTING_SOCIAL_CUSTOMER_VOICE: 2,
  BENCHMARK_CONTEXT: 1,
  UNRESOLVED_EXCLUDED: 0,
};

/**
 * Deduplicates CustomerEvidenceUnit[] using exact fingerprinting while preserving distinct user voices.
 * Preserves pool provenance: if identical text appears in multiple pools, retains the highest-priority pool.
 */
export function deduplicateCustomerVoice(units: CustomerEvidenceUnit[]): {
  rawCount: number;
  uniqueUnits: CustomerEvidenceUnit[];
  exactDuplicatesRemoved: number;
  duplicateMap: Record<string, string[]>;
} {
  const seenFingerprints = new Map<string, CustomerEvidenceUnit>();
  const duplicateMap: Record<string, string[]> = {};
  const uniqueUnits: CustomerEvidenceUnit[] = [];

  for (const u of units) {
    const norm = u.text.trim().toLowerCase().replace(/\s+/g, " ");
    const fingerprint = `${u.platform}:${norm}`;

    if (seenFingerprints.has(fingerprint)) {
      const canonical = seenFingerprints.get(fingerprint)!;
      duplicateMap[canonical.evidenceId] = duplicateMap[canonical.evidenceId] || [];
      duplicateMap[canonical.evidenceId].push(u.evidenceId);

      // Track full contributor lineage
      if (!canonical.contributors) {
        canonical.contributors = [{
          evidenceId: canonical.evidenceId,
          origin: canonical.origin,
          sourceId: canonical.sourceId,
          competitorId: canonical.competitorId,
          competitorName: canonical.competitorName,
          platform: canonical.platform,
          strategicRole: canonical.strategicRole,
          evidencePool: canonical.evidencePool,
          semanticScope: canonical.semanticScope,
          transferability: canonical.transferability,
        }];
      }
      canonical.contributors!.push({
        evidenceId: u.evidenceId,
        origin: u.origin,
        sourceId: u.sourceId,
        competitorId: u.competitorId,
        competitorName: u.competitorName,
        platform: u.platform,
        strategicRole: u.strategicRole,
        evidencePool: u.evidencePool,
        semanticScope: u.semanticScope,
        transferability: u.transferability,
      });

      // Preserve/upgrade semantic scope
      if (u.semanticScope && (!canonical.semanticScope || canonical.semanticScope === "INSUFFICIENT_SCOPE")) {
        canonical.semanticScope = u.semanticScope;
        canonical.transferability = u.transferability;
      }

      // Preserve/upgrade competitor attribution if canonical lacks it
      if (!canonical.competitorId && u.competitorId) {
        canonical.competitorId = u.competitorId;
        canonical.competitorName = u.competitorName || canonical.competitorName;
        canonical.strategicRole = canonical.strategicRole || u.strategicRole;
      }

      // Upgrade canonical to higher-priority pool if current duplicate has higher priority
      if ((POOL_PRIORITY[u.evidencePool] || 0) > (POOL_PRIORITY[canonical.evidencePool] || 0)) {
        canonical.evidencePool = u.evidencePool;
        if (u.strategicRole) canonical.strategicRole = u.strategicRole;
        if (u.competitorId) {
          canonical.competitorId = u.competitorId;
          canonical.competitorName = u.competitorName || canonical.competitorName;
        }
        canonical.origin = u.origin;
        canonical.sourceId = u.sourceId;
        if (u.semanticScope) {
          canonical.semanticScope = u.semanticScope;
          canonical.transferability = u.transferability;
        }
      }
    } else {
      if (!u.contributors) {
        u.contributors = [{
          evidenceId: u.evidenceId,
          origin: u.origin,
          sourceId: u.sourceId,
          competitorId: u.competitorId,
          competitorName: u.competitorName,
          platform: u.platform,
          strategicRole: u.strategicRole,
          evidencePool: u.evidencePool,
          semanticScope: u.semanticScope,
          transferability: u.transferability,
        }];
      }
      seenFingerprints.set(fingerprint, u);
      uniqueUnits.push(u);
    }
  }

  return {
    rawCount: units.length,
    uniqueUnits,
    exactDuplicatesRemoved: units.length - uniqueUnits.length,
    duplicateMap,
  };
}
