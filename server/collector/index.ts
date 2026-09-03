/**
 * Phase 8.0 — Collector adapter (thin).
 *
 * Single acquisition surface for the new pipeline. Wraps the existing Main
 * acquisition logic (server/competitive-intelligence/data-acquisition.ts
 * + server/user-channel-scraper.ts storage) into the CollectorEnvelope
 * contract every downstream pipeline component consumes.
 *
 * Scope of this adapter (kept intentionally thin per Phase 8.0 directive):
 *   1. Resolve the entity from Main's existing tables (no rewrite of
 *      scrapers; no fan-out into Apify / external HTTP).
 *   2. Read whatever Main has already stored for that entity.
 *   3. Persist one envelope row per acquire() call into
 *      pipeline_acquisitions for lineage. acquisition_id is the only id
 *      every downstream pipeline row references.
 *   4. Cache lookups (envelope reuse based on freshness.maxAgeMs) are
 *      deferred to a later phase. For now every acquire creates a fresh
 *      row; cache_hit is always false on the returning envelope.
 *
 * Any Main scraper / external-fetch evolution stays in
 * server/competitive-intelligence/. This adapter only translates what's
 * already there into the envelope shape.
 */

import * as crypto from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import {
  pipelineAcquisitions,
  ciCompetitors,
  competitorUnderstandingSnapshots,
  userPublicProfiles,
  userChannelSnapshots,
} from "@shared/schema";
import {
  getStoredPostsForMIv3,
  getStoredTikTokPostsForMIv3,
  getStoredReviewsForMIv3,
  fetchCompetitorData,
} from "../competitive-intelligence/data-acquisition";
import { extractHandleFromUrl } from "../competitive-intelligence/profile-scraper";
import {
  fetchGoogleSearchEvidence,
  fetchLinkedInEvidence,
  fetchXEvidence,
} from "../acquisition/multi-source-providers";
import { runCompetitorWebsiteCrawler } from "../competitive-intelligence/competitor-crawler";
import { runCompetitorUnderstandingEngine } from "../competitive-intelligence/competitor-understanding-engine";
import type {
  CollectorEnvelope,
  CollectorEntityType,
  CollectorLane,
  CollectorProvenance,
} from "./envelope";

export type {
  CollectorEnvelope,
  CollectorEntityType,
  CollectorLane,
  CollectorProvenance,
} from "./envelope";

export interface AcquireInput {
  accountId: string;
  campaignId: string;
  lane: CollectorLane;
  entityType: CollectorEntityType;
  entityId: string;
  scope?: Record<string, unknown>;
  freshness?: { force?: boolean; maxAgeMs?: number };
}

export interface AdapterDescriptor {
  entityType: CollectorEntityType;
  sourceAdapter: string;
  version: string;
  description: string;
}

const ADAPTERS: AdapterDescriptor[] = [
  {
    entityType: "user_channel",
    sourceAdapter: "main:user_channel_snapshots",
    version: "1.0.0",
    description: "Reads latest snapshot from user_channel_snapshots for the user's public profile.",
  },
  {
    entityType: "competitor_website",
    sourceAdapter: "main:ci_competitors_website",
    version: "1.0.0",
    description: "Reads website-derived fields from ci_competitors (cta_patterns, messaging_tone, social_proof_presence).",
  },
  {
    entityType: "competitor_instagram",
    sourceAdapter: "main:ci_competitor_posts.instagram",
    version: "1.0.0",
    description: "Reads stored Instagram posts for a competitor via getStoredPostsForMIv3.",
  },
  {
    entityType: "competitor_tiktok",
    sourceAdapter: "main:ci_competitor_posts.tiktok",
    version: "1.0.0",
    description: "Reads stored TikTok posts for a competitor via getStoredTikTokPostsForMIv3.",
  },
  {
    entityType: "competitor_reviews",
    sourceAdapter: "main:ci_competitor_reviews",
    version: "1.0.0",
    description: "Reads stored reviews for a competitor via getStoredReviewsForMIv3.",
  },
  {
    entityType: "competitor_google_search",
    sourceAdapter: "main:ci_competitors_google_search",
    version: "1.0.0",
    description: "Fetches organic Google Search / SERP evidence for competitor pricing/offers.",
  },
  {
    entityType: "competitor_linkedin",
    sourceAdapter: "main:ci_competitors_linkedin",
    version: "1.0.0",
    description: "Fetches company posts from LinkedIn profile for a competitor.",
  },
  {
    entityType: "competitor_x",
    sourceAdapter: "main:ci_competitors_x",
    version: "1.0.0",
    description: "Fetches tweets and announcements from X / Twitter for a competitor.",
  },
];

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour — informational only; no cache lookup yet.

export function getAdapterRegistry(): AdapterDescriptor[] {
  return ADAPTERS.slice();
}

function safeJsonStringArray(s: string | null | undefined): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  } catch {
    // not JSON — try comma/whitespace split
    return s
      .split(/[\s,]+/)
      .map((x) => x.trim())
      .filter((x) => x.length > 0);
  }
  return [];
}

async function buildPayload(
  input: AcquireInput,
  warnings: string[],
): Promise<Record<string, unknown>> {
  switch (input.entityType) {
    case "user_channel": {
      const profile = await db
        .select()
        .from(userPublicProfiles)
        .where(eq(userPublicProfiles.id, input.entityId))
        .limit(1);
      if (profile.length === 0) {
        warnings.push("entity_not_found:user_public_profiles");
        return {};
      }
      const p = profile[0];
      const handle = p.handle;
      const baseConds = [
        eq(userChannelSnapshots.accountId, input.accountId),
        eq(userChannelSnapshots.campaignId, input.campaignId),
        eq(userChannelSnapshots.platform, p.platform),
      ];
      const conds = handle
        ? [...baseConds, eq(userChannelSnapshots.handle, handle)]
        : baseConds;
      const snaps = await db
        .select()
        .from(userChannelSnapshots)
        .where(and(...conds))
        .orderBy(desc(userChannelSnapshots.scrapedAt))
        .limit(1);
      if (snaps.length === 0) {
        warnings.push("no_snapshot_available");
        return {
          platform: p.platform,
          handle: p.handle,
          url: p.url,
        };
      }
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(snaps[0].snapshotData ?? "{}");
      } catch {
        warnings.push("snapshot_data_invalid_json");
      }
      // Merge profile context so translateEnvelopeToLanePayload has metadata
      // even when the snapshotData blob is sparse.
      return {
        platform: p.platform,
        handle: p.handle,
        url: p.url,
        scraped_at: snaps[0].scrapedAt?.toISOString() ?? null,
        ...parsed,
      };
    }

    case "competitor_website": {
      const compRows = await db
        .select()
        .from(ciCompetitors)
        .where(eq(ciCompetitors.id, input.entityId))
        .limit(1);
      if (compRows.length === 0) {
        warnings.push("entity_not_found:ci_competitors");
        return {};
      }
      const c = compRows[0];

      let offerPhrases: string[] = [];
      let pricingAnchors: string[] = [];
      let headlines: string[] = [];
      try {
        const [uSnap] = await db
          .select()
          .from(competitorUnderstandingSnapshots)
          .where(eq(competitorUnderstandingSnapshots.competitorId, input.entityId))
          .orderBy(desc(competitorUnderstandingSnapshots.analyzedAt))
          .limit(1);
        if (uSnap && uSnap.payload) {
          const uPayload = typeof uSnap.payload === "string" ? JSON.parse(uSnap.payload) : uSnap.payload;
          if (Array.isArray(uPayload.offers)) {
            for (const off of uPayload.offers) {
              if (off.offerStatement) offerPhrases.push(off.offerStatement);
              if (off.planPackage) offerPhrases.push(off.planPackage);
              if (off.pricing) pricingAnchors.push(off.pricing);
            }
          }
          if (Array.isArray(uPayload.positioning)) {
            for (const pos of uPayload.positioning) {
              if (pos.statement) headlines.push(pos.statement);
            }
          }
        }
      } catch {
        // non-fatal
      }

      return {
        headlines,
        cta_labels: safeJsonStringArray(c.ctaPatterns),
        offer_phrases: offerPhrases,
        pricing_anchors: pricingAnchors,
        messaging_tone: c.messagingTone ?? null,
        social_proof_presence: c.socialProofPresence ?? null,
        hook_styles: safeJsonStringArray(c.hookStyles),
        website_url: c.websiteUrl,
        website_scraped_at: c.websiteScrapedAt?.toISOString() ?? null,
      };
    }

    case "competitor_instagram": {
      if (input.freshness?.force) {
        try {
          await fetchCompetitorData(input.entityId, input.accountId, true);
        } catch (err) {
          warnings.push(`instagram_fresh_fetch_failed:${(err as Error).message}`);
        }
      }
      const posts = await getStoredPostsForMIv3(input.entityId, input.accountId);
      if (posts.length === 0) warnings.push("no_instagram_posts_available");
      // Aggregate hashtags for translation hygiene.
      const hashtags = Array.from(
        new Set(
          posts
            .flatMap((p) => (Array.isArray(p.hashtags) ? p.hashtags : []))
            .filter((h): h is string => typeof h === "string" && h.length > 0),
        ),
      ).slice(0, 100);
      return { posts, hashtags };
    }

    case "competitor_tiktok": {
      const posts = await getStoredTikTokPostsForMIv3(input.entityId, input.accountId);
      if (posts.length === 0) warnings.push("no_tiktok_posts_available");
      return { posts };
    }

    case "competitor_reviews": {
      const reviews = await getStoredReviewsForMIv3(input.entityId, input.accountId);
      if (reviews.length === 0) warnings.push("no_reviews_available");
      return { reviews };
    }

    case "competitor_google_search": {
      const compRows = await db
        .select()
        .from(ciCompetitors)
        .where(eq(ciCompetitors.id, input.entityId))
        .limit(1);
      const compName = compRows[0]?.name || "competitor";
      const query = `${compName} pricing plans offers`;
      const result = await fetchGoogleSearchEvidence({
        query,
        campaignId: input.campaignId,
        accountId: input.accountId,
        competitorId: input.entityId,
        maxResults: 10,
      });
      if (result.report.error) {
        warnings.push(`google_search_failed:${result.report.error}`);
      }
      return {
        query,
        search_results: result.items,
        report: result.report,
      };
    }

    case "competitor_linkedin": {
      const compRows = await db
        .select()
        .from(ciCompetitors)
        .where(eq(ciCompetitors.id, input.entityId))
        .limit(1);
      const profileUrl = compRows[0]?.profileLink || `https://www.linkedin.com/company/${compRows[0]?.name?.toLowerCase().replace(/\\s+/g, "-")}`;
      const result = await fetchLinkedInEvidence({
        profileUrl,
        campaignId: input.campaignId,
        accountId: input.accountId,
        competitorId: input.entityId,
        maxPosts: 10,
      });
      if (result.report.error) {
        warnings.push(`linkedin_failed:${result.report.error}`);
      }
      return {
        profile_url: profileUrl,
        posts: result.items,
        report: result.report,
      };
    }

    case "competitor_x": {
      const compRows = await db
        .select()
        .from(ciCompetitors)
        .where(eq(ciCompetitors.id, input.entityId))
        .limit(1);
      const handle = compRows[0]?.profileLink ? extractHandleFromUrl(compRows[0].profileLink) : (compRows[0]?.name || "");
      const result = await fetchXEvidence({
        handle,
        campaignId: input.campaignId,
        accountId: input.accountId,
        competitorId: input.entityId,
        maxTweets: 10,
      });
      if (result.report.error) {
        warnings.push(`x_failed:${result.report.error}`);
      }
      return {
        handle,
        tweets: result.items,
        report: result.report,
      };
    }
  }
}

export async function acquire(input: AcquireInput): Promise<CollectorEnvelope> {
  const adapter = ADAPTERS.find((a) => a.entityType === input.entityType);
  if (!adapter) {
    throw new Error(`UnknownEntityType:${input.entityType}`);
  }
  if (!input.accountId || !input.campaignId || !input.entityId) {
    throw new Error("BadRequest:accountId, campaignId, entityId are required");
  }

  const acqId = crypto.randomUUID();
  const startedAt = new Date();
  const warnings: string[] = [];

  let payload: Record<string, unknown>;
  try {
    payload = await buildPayload(input, warnings);
  } catch (err) {
    warnings.push(`adapter_error:${(err as Error).message.slice(0, 200)}`);
    payload = {};
  }

  const finishedAt = new Date();
  const provenance: CollectorProvenance = {
    cache_hit: false,
    warnings,
    upstream_adapter: adapter.sourceAdapter,
    fetch_started_at: startedAt.toISOString(),
    fetch_finished_at: finishedAt.toISOString(),
    fetch_duration_ms: finishedAt.getTime() - startedAt.getTime(),
    forced_freshness: input.freshness?.force === true,
  };

  await db.insert(pipelineAcquisitions).values({
    id: acqId,
    accountId: input.accountId,
    campaignId: input.campaignId,
    lane: input.lane,
    entityType: input.entityType,
    entityId: input.entityId,
    sourceAdapter: adapter.sourceAdapter,
    collectedAt: finishedAt,
    payload: JSON.stringify(payload),
    provenance: JSON.stringify(provenance),
    ttlMs: DEFAULT_TTL_MS,
    scopeHash: "default",
  });

  return {
    acquisition_id: acqId,
    account_id: input.accountId,
    campaign_id: input.campaignId,
    lane: input.lane,
    entity_type: input.entityType,
    entity_id: input.entityId,
    source_adapter: adapter.sourceAdapter,
    collected_at: finishedAt.toISOString(),
    payload,
    provenance,
  };
}

export async function getAcquisition(id: string): Promise<CollectorEnvelope | null> {
  const rows = await db
    .select()
    .from(pipelineAcquisitions)
    .where(eq(pipelineAcquisitions.id, id))
    .limit(1);
  if (rows.length === 0) return null;
  const row = rows[0];

  let payload: Record<string, unknown> = {};
  let provenance: CollectorProvenance = { cache_hit: true, warnings: [] };
  try {
    const parsed = JSON.parse(row.payload);
    if (parsed && typeof parsed === "object") payload = parsed as Record<string, unknown>;
  } catch {
    /* leave empty */
  }
  try {
    const parsed = JSON.parse(row.provenance);
    if (parsed && typeof parsed === "object") {
      provenance = { ...(parsed as CollectorProvenance), cache_hit: true };
    }
  } catch {
    /* leave default */
  }

  return {
    acquisition_id: row.id,
    account_id: row.accountId,
    campaign_id: row.campaignId,
    lane: row.lane as CollectorLane,
    entity_type: row.entityType as CollectorEntityType,
    entity_id: row.entityId,
    source_adapter: row.sourceAdapter,
    collected_at: row.collectedAt.toISOString(),
    payload,
    provenance,
  };
}
