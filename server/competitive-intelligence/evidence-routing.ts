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
  competitorSources 
} from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { createHash } from "crypto";

export type CustomerEvidenceOrigin = "COMPETITOR_COMMENT" | "COMPETITOR_REVIEW" | "MARKET_VOICE";

export interface CustomerEvidenceUnit {
  evidenceId: string;
  origin: CustomerEvidenceOrigin;
  platform: "instagram" | "tiktok" | "youtube" | "trustpilot" | "google" | "reddit" | "forums" | "web" | string;
  competitorId?: string;
  competitorName?: string;
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
  campaignId: string
): Promise<CustomerEvidenceUnit[]> {
  const activeComps = await db.select().from(ciCompetitors)
    .where(and(
      eq(ciCompetitors.accountId, accountId),
      eq(ciCompetitors.campaignId, campaignId),
      eq(ciCompetitors.isActive, true)
    ));
  const activeCompMap = new Map(activeComps.map(c => [c.id, c.name]));
  const activeCompIds = activeComps.map(c => c.id);

  const units: CustomerEvidenceUnit[] = [];

  // 1. Competitor Comments (Instagram, TikTok, YouTube)
  if (activeCompIds.length > 0) {
    const rawComments = await db.select().from(ciCompetitorComments)
      .where(and(
        eq(ciCompetitorComments.accountId, accountId),
        inArray(ciCompetitorComments.competitorId, activeCompIds)
      ));

    for (const comm of rawComments) {
      // Exclude brand/owner replies
      if (comm.authorType === "brand" || comm.authorType === "owner") continue;
      if (!comm.commentText || comm.commentText.trim().length === 0) continue;

      let plat = (comm as any).platform || "instagram";
      if (comm.source === "tiktok_scrape") plat = "tiktok";
      else if (comm.source === "youtube_scrape") plat = "youtube";

      const unitId = computeCustomerEvidenceId("COMPETITOR_COMMENT", plat, comm.commentId || comm.id, comm.commentText);

      units.push({
        evidenceId: unitId,
        origin: "COMPETITOR_COMMENT",
        platform: plat,
        competitorId: comm.competitorId,
        competitorName: activeCompMap.get(comm.competitorId) || undefined,
        accountId,
        campaignId,
        parentContentId: comm.postId || undefined,
        text: comm.commentText.trim(),
        author: comm.authorUsername || comm.authorType || null,
        authorType: "CUSTOMER",
        likesCount: comm.likes || undefined,
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
    const rawReviews = await db.select().from(ciCompetitorReviews)
      .where(and(
        eq(ciCompetitorReviews.accountId, accountId),
        inArray(ciCompetitorReviews.competitorId, activeCompIds)
      ));

    for (const rev of rawReviews) {
      if (!rev.reviewText || rev.reviewText.trim().length === 0) continue;

      const plat = rev.platform || "trustpilot";
      const unitId = computeCustomerEvidenceId("COMPETITOR_REVIEW", plat, rev.reviewId || rev.id, rev.reviewText);

      units.push({
        evidenceId: unitId,
        origin: "COMPETITOR_REVIEW",
        platform: plat,
        competitorId: rev.competitorId,
        competitorName: activeCompMap.get(rev.competitorId) || undefined,
        accountId,
        campaignId,
        text: rev.reviewText.trim(),
        author: rev.authorName || null,
        authorType: "CUSTOMER",
        sourceTimestamp: rev.reviewDate ? new Date(rev.reviewDate).toISOString() : undefined,
        acquiredAt: rev.scrapedAt ? new Date(rev.scrapedAt).toISOString() : new Date().toISOString(),
        verificationProvenance: {
          isVerified: true,
          verificationMethod: "verified_review_profile",
          sourceUrl: rev.reviewUrl || undefined,
        },
        rawEvidenceReference: {
          table: "ci_competitor_reviews",
          id: rev.id,
        },
      });
    }
  }

  // 3. Market Voice Evidence (Reddit, Google SERP customer quotes, Forums)
  const rawMv = await db.select().from(marketVoiceEvidence)
    .where(and(
      eq(marketVoiceEvidence.accountId, accountId),
      eq(marketVoiceEvidence.campaignId, campaignId)
    ));

  for (const mv of rawMv) {
    const text = mv.verbatimText || "";
    if (!text || text.trim().length === 0) continue;

    const plat = mv.platform || "web";
    const unitId = computeCustomerEvidenceId("MARKET_VOICE", plat, mv.externalId || mv.id, text);

    units.push({
      evidenceId: unitId,
      origin: "MARKET_VOICE",
      platform: plat,
      accountId,
      campaignId,
      offeringId: mv.campaignOfferingId || undefined,
      text: text.trim(),
      author: mv.authorHash || null,
      authorType: "COMMUNITY_USER",
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
  campaignId: string
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

  const rawPosts = await db.select().from(ciCompetitorPosts)
    .where(and(
      eq(ciCompetitorPosts.accountId, accountId),
      inArray(ciCompetitorPosts.competitorId, activeCompIds)
    ));

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

/**
 * Deduplicates CustomerEvidenceUnit[] using exact fingerprinting while preserving distinct user voices.
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
    } else {
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
