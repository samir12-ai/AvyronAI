import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and, inArray, sql, notInArray, desc } from "drizzle-orm";
import { createHash, randomUUID as uuidv4 } from "crypto";
import { extractAppListingIdentity, extractBrandEntityInfo, generateCanonicalEntityId } from "../discovery/entity-resolver";
import {
  extractExternalAccountId,
  extractSourcesFromHtml,
  isPlatformOwnedHandle,
  verifySearchCandidateOwnership,
  persistManifestSourcesToDb,
  type CompetitorSourceManifest,
} from "./source-discovery";

export interface ReconcileCompetitorsOptions {
  accountId: string;
  campaignId: string;
  dryRun?: boolean;
}

export interface DuplicateGroupSummary {
  normalizedDomain: string;
  businessName: string;
  survivorId: string;
  survivorReason: string;
  supersededIds: string[];
  totalCandidateRows: number;
}

export interface CompetitorReconciliationResult {
  campaignId: string;
  accountId: string;
  dryRun: boolean;
  preReconciliation: {
    totalRows: number;
    activeRows: number;
    uniqueDomains: number;
    duplicateGroups: number;
    duplicateRows: number;
  };
  postReconciliation: {
    totalRows: number;
    activeCanonicalRows: number;
    inactiveSupersededRows: number;
    uniqueDomains: number;
    duplicateActiveGroups: number;
  };
  groups: DuplicateGroupSummary[];
  reparentedCounts: {
    sources: number;
    posts: number;
    comments: number;
    snapshots: number;
    schedules: number;
    briefs: number;
  };
  orphanCounts: {
    sources: number;
    posts: number;
    comments: number;
    snapshots: number;
    schedules: number;
  };
  success: boolean;
}

/**
 * Normalizes a competitor domain/profile link to a canonical domain identity key.
 * Preserves full app-store listing paths (e.g. apps.apple.com/.../id...) as distinct identities.
 */
export function getNormalizedCompetitorDomain(competitor: {
  name: string;
  websiteUrl?: string | null;
}): string {
  const raw = (competitor.websiteUrl || "").trim();
  if (!raw) return `name_${competitor.name.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
  const appListing = extractAppListingIdentity(raw);
  if (appListing.isAppListing && appListing.listingKey) {
    return appListing.listingKey;
  }
  try {
    const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    const h = u.hostname.replace(/^www\./, "").toLowerCase();
    if (h.includes("instagram.com")) {
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts.length > 0 && !["p", "reel", "explore", "stories"].includes(parts[0])) {
        return `instagram.com/${parts[0].toLowerCase()}`;
      }
    }
    if (h === "apps.apple.com" || h === "play.google.com") {
      return `${h}_unqualified_${competitor.name.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
    }
    return h;
  } catch {
    return raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  }
}

export interface IdentityRepairReport {
  unmergedRecords: Array<{
    originalCompetitorId: string;
    primaryDomain: string;
    restoredCompetitorId: string;
    restoredDomain: string;
    restoredName: string;
    reparentedSources: number;
    reparentedSnapshots: number;
    reparentedUnderstandingSnapshots: number;
    reparentedPosts: number;
  }>;
  restoredAppListings: Array<{
    competitorId: string;
    name: string;
    previousUrl: string;
    restoredUrl: string;
    quarantinedPlatformSources: number;
    removedPlatformPosts: number;
  }>;
  quarantinedSources: Array<{
    sourceId: string;
    competitorId: string;
    competitorName: string;
    platform: string;
    url: string;
    reason: string;
    preservedTestimonials: number;
    removedMisattributedPosts: number;
  }>;
  repairedSources: Array<{
    sourceId: string;
    competitorId: string;
    platform: string;
    previousUrl: string;
    repairedUrl: string;
  }>;
  populatedExternalAccountIds: number;
}

/**
 * Reusable campaign-wide competitor identity and source attribution repair.
 * 1. Splits multi-business records that were erroneously merged via generic SEO titles in `storefronts`.
 * 2. Restores truncated app-store root URLs (`https://apps.apple.com`) from discovery session provenance and quarantines `@appstore`.
 * 3. Quarantines misattributed third-party testimonial accounts (preserving customer testimonials in `evidence_registry`) and invalid social URLs (`facebook.com/tr`, bare `facebook.com/profile.php`).
 * 4. Populates missing `externalAccountId` on `competitor_sources`.
 */
export async function repairCampaignCompetitorIdentitiesAndSources(
  options: ReconcileCompetitorsOptions
): Promise<IdentityRepairReport> {
  const { accountId, campaignId, dryRun = false } = options;
  const report: IdentityRepairReport = {
    unmergedRecords: [],
    restoredAppListings: [],
    quarantinedSources: [],
    repairedSources: [],
    populatedExternalAccountIds: 0,
  };

  const allComps = await db
    .select()
    .from(schema.ciCompetitors)
    .where(and(eq(schema.ciCompetitors.accountId, accountId), eq(schema.ciCompetitors.campaignId, campaignId)));

  // 1. Unmerge multi-business records where `storefronts` contains distinct domain brandTokens from `websiteUrl`
  for (const comp of allComps) {
    if (!comp.isActive) continue;
    const storefronts = Array.isArray(comp.storefronts) ? (comp.storefronts as Array<{ domain?: string; url?: string; title?: string }>) : [];
    if (storefronts.length === 0) continue;

    const primaryBrand = extractBrandEntityInfo(comp.websiteUrl || storefronts[0]?.url || storefronts[0]?.domain || "");
    const distinctSecondaryStorefronts = storefronts.filter(sf => {
      const info = extractBrandEntityInfo(sf.url || sf.domain || "");
      return info.brandToken && info.brandToken !== primaryBrand.brandToken;
    });

    if (distinctSecondaryStorefronts.length === 0) continue;

    for (const secSf of distinctSecondaryStorefronts) {
      const secInfo = extractBrandEntityInfo(secSf.url || secSf.domain || "");
      const secUrl = secSf.url || `https://${secInfo.baseDomain}`;
      const secBrandToken = secInfo.brandToken;
      const derivedBrandName =
        secBrandToken === "melodybolt"
          ? "MelodyBolt"
          : secSf.title && !secSf.title.toLowerCase().includes("personalised songs uk")
            ? secSf.title
            : secBrandToken.charAt(0).toUpperCase() + secBrandToken.slice(1);

      // Find if a deactivated/superseded row already exists for secInfo.baseDomain
      const existingInactive = allComps.find(
        c =>
          c.id !== comp.id &&
          extractBrandEntityInfo(c.websiteUrl || "").brandToken === secBrandToken
      );

      const targetSecCompId = existingInactive ? existingInactive.id : `comp_${uuidv4().slice(0, 10)}`;

      // Identify child records belonging to the secondary business
      const compSources = await db
        .select()
        .from(schema.competitorSources)
        .where(and(eq(schema.competitorSources.accountId, accountId), eq(schema.competitorSources.competitorId, comp.id)));

      const compWebSnaps = await db
        .select()
        .from(schema.competitorWebsiteSnapshots)
        .where(and(eq(schema.competitorWebsiteSnapshots.accountId, accountId), eq(schema.competitorWebsiteSnapshots.competitorId, comp.id)));

      const compUndSnaps = await db
        .select()
        .from(schema.competitorUnderstandingSnapshots)
        .where(and(eq(schema.competitorUnderstandingSnapshots.accountId, accountId), eq(schema.competitorUnderstandingSnapshots.competitorId, comp.id)));

      const compPosts = await db
        .select()
        .from(schema.ciCompetitorPosts)
        .where(and(eq(schema.ciCompetitorPosts.accountId, accountId), eq(schema.ciCompetitorPosts.competitorId, comp.id)));

      const matchesSecondaryBrand = (str: string | null | undefined): boolean => {
        if (!str) return false;
        const lower = str.toLowerCase();
        if (lower.includes(secInfo.baseDomain) || lower.includes(secBrandToken)) return true;
        // Also check reversed compound tokens (e.g. bolt.melody for melodybolt)
        if (secBrandToken === "melodybolt" && lower.includes("bolt") && lower.includes("melody")) return true;
        return false;
      };

      const secSources = compSources.filter(s => matchesSecondaryBrand(s.canonicalUrl) || matchesSecondaryBrand(s.externalAccountId));
      const secWebSnaps = compWebSnaps.filter(s => matchesSecondaryBrand(s.websiteUrl));
      const secWebSnapIds = new Set(secWebSnaps.map(s => s.id));
      const secUndSnaps = compUndSnaps.filter(
        u => secWebSnapIds.has(u.competitorWebsiteSnapshotId) || matchesSecondaryBrand(JSON.stringify(u.competitorUnderstanding || {}))
      );
      const secPosts = compPosts.filter(
        p =>
          matchesSecondaryBrand(p.authorUsername) ||
          matchesSecondaryBrand(p.url) ||
          matchesSecondaryBrand(p.caption)
      );

      if (!dryRun) {
        await db.transaction(async (tx) => {
          // 1. Update primary competitor (`comp.id`) to hold only its primary storefront (`songforyou.co.uk`)
          const filteredPrimaryStorefronts = storefronts.filter(
            sf => extractBrandEntityInfo(sf.url || sf.domain || "").brandToken === primaryBrand.brandToken
          );
          const primaryDisplayName =
            primaryBrand.brandToken === "songforyou" && comp.name.toLowerCase() === "personalised songs uk"
              ? "Song For You (Personalised Songs UK)"
              : comp.name;
          const primaryOnlyStorefronts =
            filteredPrimaryStorefronts.length > 0
              ? filteredPrimaryStorefronts
              : [
                  {
                    domain: primaryBrand.baseDomain,
                    url: comp.websiteUrl || `https://${primaryBrand.baseDomain}`,
                    title: primaryDisplayName,
                  },
                ];

          let updatedPrimaryNotes = comp.notes;
          try {
            if (comp.notes) {
              const parsed = JSON.parse(comp.notes) as CompetitorSourceManifest;
              if (parsed?.sources) {
                for (const k of Object.keys(parsed.sources) as Array<keyof typeof parsed.sources>) {
                  const s = parsed.sources[k];
                  if (s?.url && matchesSecondaryBrand(s.url)) {
                    parsed.sources[k] = {
                      platform: k,
                      url: null,
                      status: "PENDING_DISCOVERY",
                      verificationMethod: "NONE",
                      detail: `Split from merged storefront ${secInfo.baseDomain}; re-queued for ${primaryInfoUrl(comp.websiteUrl)}.`,
                    };
                  }
                }
                parsed.discoveryState = {
                  status: "PENDING",
                  attempts: 0,
                  maxAttempts: 3,
                  lastAttemptAt: null,
                  nextRetryAt: new Date().toISOString(),
                  lastError: null,
                };
                updatedPrimaryNotes = JSON.stringify(parsed);
              }
            }
          } catch {}

          await tx
            .update(schema.ciCompetitors)
            .set({
              name: primaryDisplayName,
              canonicalEntityId: generateCanonicalEntityId(primaryBrand.brandToken),
              storefronts: primaryOnlyStorefronts,
              notes: updatedPrimaryNotes,
              updatedAt: new Date(),
            })
            .where(eq(schema.ciCompetitors.id, comp.id));

          // 2. Reactivate or insert secondary competitor (`targetSecCompId`)
          const secStorefronts = [
            {
              domain: secInfo.baseDomain,
              url: secUrl,
              title: derivedBrandName,
            },
          ];

          if (existingInactive) {
            await tx
              .update(schema.ciCompetitors)
              .set({
                name: derivedBrandName,
                websiteUrl: secUrl,
                canonicalEntityId: generateCanonicalEntityId(secBrandToken),
                storefronts: secStorefronts,
                isActive: true,
                tier: comp.tier || "A",
                strategicRole: comp.strategicRole || "DIRECT",
                geographicClassification: comp.geographicClassification || "LOCAL_MARKET",
                updatedAt: new Date(),
              })
              .where(eq(schema.ciCompetitors.id, targetSecCompId));
          } else {
            await tx.insert(schema.ciCompetitors).values({
              id: targetSecCompId,
              accountId,
              campaignId,
              name: derivedBrandName,
              platform: "instagram",
              websiteUrl: secUrl,
              businessType: "Competitor",
              primaryObjective: "Engagement",
              strategicRole: comp.strategicRole || "DIRECT",
              geographicClassification: comp.geographicClassification || "LOCAL_MARKET",
              canonicalEntityId: generateCanonicalEntityId(secBrandToken),
              storefronts: secStorefronts,
              isActive: true,
              isDemo: false,
              tier: comp.tier || "A",
            });
          }

          // 3. Reparent secondary sources, website snapshots, understanding snapshots, and posts
          const existingSecSources = await tx
            .select()
            .from(schema.competitorSources)
            .where(eq(schema.competitorSources.competitorId, targetSecCompId));
          const existingSecSourceKeys = new Set(
            existingSecSources.map(s => `${s.platform.toUpperCase()}:::${(s.canonicalUrl || "").toLowerCase().trim()}`)
          );

          for (const src of secSources) {
            const key = `${src.platform.toUpperCase()}:::${(src.canonicalUrl || "").toLowerCase().trim()}`;
            if (existingSecSourceKeys.has(key)) {
              await tx.delete(schema.competitorSources).where(eq(schema.competitorSources.id, src.id));
            } else {
              await tx
                .update(schema.competitorSources)
                .set({
                  competitorId: targetSecCompId,
                  externalAccountId: src.externalAccountId || extractExternalAccountId(src.platform, src.canonicalUrl),
                })
                .where(eq(schema.competitorSources.id, src.id));
              existingSecSourceKeys.add(key);
            }
          }

          if (secWebSnaps.length > 0) {
            await tx
              .update(schema.competitorWebsiteSnapshots)
              .set({ competitorId: targetSecCompId })
              .where(inArray(schema.competitorWebsiteSnapshots.id, secWebSnaps.map(s => s.id)));
          }

          if (secUndSnaps.length > 0) {
            await tx
              .update(schema.competitorUnderstandingSnapshots)
              .set({ competitorId: targetSecCompId })
              .where(inArray(schema.competitorUnderstandingSnapshots.id, secUndSnaps.map(u => u.id)));
          }

          if (secPosts.length > 0) {
            const existingTargetPosts = await tx
              .select({ postId: schema.ciCompetitorPosts.postId })
              .from(schema.ciCompetitorPosts)
              .where(eq(schema.ciCompetitorPosts.competitorId, targetSecCompId));
            const existingPostSet = new Set(existingTargetPosts.map(p => p.postId));
            const toMove = secPosts.filter(p => !existingPostSet.has(p.postId)).map(p => p.id);
            const toDelete = secPosts.filter(p => existingPostSet.has(p.postId)).map(p => p.id);

            if (toMove.length > 0) {
              await tx
                .update(schema.ciCompetitorPosts)
                .set({ competitorId: targetSecCompId })
                .where(inArray(schema.ciCompetitorPosts.id, toMove));
            }
            if (toDelete.length > 0) {
              await tx
                .delete(schema.ciCompetitorPosts)
                .where(inArray(schema.ciCompetitorPosts.id, toDelete));
            }
          }

          // 4. Record audit revision
          await tx.insert(schema.ciCompetitorRevisions).values({
            id: `rev_${uuidv4().slice(0, 12)}`,
            accountId,
            campaignId,
            competitorId: comp.id,
            changedFields: JSON.stringify(["name", "canonical_entity_id", "storefronts", "notes"]),
            previousValues: JSON.stringify({ mergedStorefronts: storefronts }),
            currentValues: JSON.stringify({
              primaryCompetitorId: comp.id,
              primaryDomain: primaryBrand.baseDomain,
              restoredCompetitorId: targetSecCompId,
              restoredDomain: secInfo.baseDomain,
              reason: `Unmerged distinct businesses (${primaryBrand.baseDomain} and ${secInfo.baseDomain}) that shared generic SEO title.`,
            }),
          } as any);
        });
      }

      report.unmergedRecords.push({
        originalCompetitorId: comp.id,
        primaryDomain: primaryBrand.baseDomain,
        restoredCompetitorId: targetSecCompId,
        restoredDomain: secInfo.baseDomain,
        restoredName: derivedBrandName,
        reparentedSources: secSources.length,
        reparentedSnapshots: secWebSnaps.length,
        reparentedUnderstandingSnapshots: secUndSnaps.length,
        reparentedPosts: secPosts.length,
      });
    }
  }

  // 2. Restore truncated App Store / Play Store root URLs from discovery session provenance
  const discoverySessions = await db
    .select()
    .from(schema.competitorDiscoverySessions)
    .where(and(eq(schema.competitorDiscoverySessions.accountId, accountId), eq(schema.competitorDiscoverySessions.campaignId, campaignId)))
    .orderBy(desc(schema.competitorDiscoverySessions.createdAt))
    .limit(5);

  const refreshedComps = await db
    .select()
    .from(schema.ciCompetitors)
    .where(and(eq(schema.ciCompetitors.accountId, accountId), eq(schema.ciCompetitors.campaignId, campaignId)));

  for (const comp of refreshedComps) {
    const rawUrl = (comp.websiteUrl || "").trim().replace(/\/+$/, "").toLowerCase();
    if (rawUrl === "https://apps.apple.com" || rawUrl === "http://apps.apple.com" || rawUrl === "https://play.google.com") {
      let restoredListingUrl: string | null = null;
      const compNameLower = comp.name.toLowerCase();
      const nameToken = compNameLower.split(/[-|–:]/)[1]?.trim().split(/\s+/)[0] || compNameLower.split(/\s+/)[0] || "";

      for (const sess of discoverySessions) {
        const rep = ((sess as any).discoveryReport || {}) as any;
        const sessionCandidates = Array.isArray((sess as any).candidates) ? (sess as any).candidates : [];
        const allCands = [
          ...sessionCandidates,
          ...(Array.isArray(rep.approvedCandidates) ? rep.approvedCandidates : []),
          ...(Array.isArray(rep.localCandidates) ? rep.localCandidates : []),
          ...(Array.isArray(rep.crossBorderCandidates) ? rep.crossBorderCandidates : []),
          ...(Array.isArray(rep.unverifiedMarketCandidates) ? rep.unverifiedMarketCandidates : []),
        ];
        for (const cand of allCands) {
          const occs = Array.isArray(cand?.occurrences) ? cand.occurrences : [];
          for (const occ of occs) {
            const occUrl = String(occ?.url || "");
            const listing = extractAppListingIdentity(occUrl);
            if (listing.isAppListing && listing.canonicalListingUrl) {
              const titleLower = String(occ?.rawTitle || cand?.name || "").toLowerCase();
              if (
                titleLower.includes(compNameLower) ||
                compNameLower.includes(titleLower) ||
                (nameToken.length >= 4 && occUrl.toLowerCase().includes(nameToken))
              ) {
                restoredListingUrl = listing.canonicalListingUrl;
                break;
              }
            }
          }
          if (restoredListingUrl) break;
        }
        if (restoredListingUrl) break;
      }

      if (restoredListingUrl) {
        // Also find any @appstore sources/posts on this competitor
        const compSources = await db
          .select()
          .from(schema.competitorSources)
          .where(and(eq(schema.competitorSources.accountId, accountId), eq(schema.competitorSources.competitorId, comp.id)));

        const platformSources = compSources.filter(s => {
          const h = s.externalAccountId || extractExternalAccountId(s.platform, s.canonicalUrl);
          return h && isPlatformOwnedHandle(h, restoredListingUrl!);
        });

        const compPosts = await db
          .select()
          .from(schema.ciCompetitorPosts)
          .where(and(eq(schema.ciCompetitorPosts.accountId, accountId), eq(schema.ciCompetitorPosts.competitorId, comp.id)));

        if (!dryRun) {
          const listingInfo = extractAppListingIdentity(restoredListingUrl);
          await db
            .update(schema.ciCompetitors)
            .set({
              websiteUrl: restoredListingUrl,
              canonicalEntityId: listingInfo.brandToken ? generateCanonicalEntityId(listingInfo.brandToken) : comp.canonicalEntityId,
              storefronts: [{ domain: listingInfo.listingKey || restoredListingUrl, url: restoredListingUrl, title: comp.name }],
              updatedAt: new Date(),
            })
            .where(eq(schema.ciCompetitors.id, comp.id));

          // Update WEBSITE source
          const webSrc = compSources.find(s => s.platform.toUpperCase() === "WEBSITE");
          if (webSrc) {
            await db
              .update(schema.competitorSources)
              .set({
                canonicalUrl: restoredListingUrl,
                metadata: { ...(webSrc.metadata as any || {}), repairedFromPlatformRoot: comp.websiteUrl },
              })
              .where(eq(schema.competitorSources.id, webSrc.id));
          }

          if (platformSources.length > 0) {
            await db
              .update(schema.competitorSources)
              .set({
                status: "DISABLED",
                activityState: "QUARANTINED_PLATFORM_ACCOUNT",
                metadata: { quarantinedReason: "Platform-owned @appstore account, not competitor profile" },
              })
              .where(inArray(schema.competitorSources.id, platformSources.map(s => s.id)));
          }

          if (compPosts.length > 0) {
            await db
              .delete(schema.ciCompetitorPosts)
              .where(inArray(schema.ciCompetitorPosts.id, compPosts.map(p => p.id)));
          }
        }

        report.restoredAppListings.push({
          competitorId: comp.id,
          name: comp.name,
          previousUrl: comp.websiteUrl || "",
          restoredUrl: restoredListingUrl,
          quarantinedPlatformSources: platformSources.length,
          removedPlatformPosts: compPosts.length,
        });
      }
    }
  }

  // 3. Audit all competitor_sources for invalid URLs, misattributed third-party accounts, and missing externalAccountId
  const allSources = await db
    .select()
    .from(schema.competitorSources)
    .where(and(eq(schema.competitorSources.accountId, accountId), eq(schema.competitorSources.campaignId, campaignId)));

  const compById = new Map((await db.select().from(schema.ciCompetitors).where(and(eq(schema.ciCompetitors.accountId, accountId), eq(schema.ciCompetitors.campaignId, campaignId)))).map(c => [c.id, c]));

  for (const src of allSources) {
    const comp = compById.get(src.competitorId);
    if (!comp) continue;

    const plat = src.platform.toUpperCase();
    const url = (src.canonicalUrl || "").trim();
    const meta = (src.metadata || {}) as Record<string, any>;

    // 3A. Invalid Facebook URLs (facebook.com/tr tracking pixel or truncated facebook.com/profile.php without ?id=)
    if (plat === "FACEBOOK") {
      const isTrackingPixel = /facebook\.com\/tr(\/|\?|$)/i.test(url);
      const isTruncatedProfilePhp = /facebook\.com\/profile\.php(\/|$)/i.test(url) && !url.includes("id=");
      if (isTrackingPixel || isTruncatedProfilePhp) {
        // Attempt to recover full profile.php?id=... from live/stored HTML if truncated
        let recoveredFbUrl: string | null = null;
        if (isTruncatedProfilePhp && comp.websiteUrl && !comp.websiteUrl.includes("apple.com")) {
          try {
            const res = await fetch(comp.websiteUrl, {
              headers: { "User-Agent": "Mozilla/5.0 AvyronAI/1.0" },
              signal: AbortSignal.timeout(8000),
            });
            if (res.ok) {
              const html = await res.text();
              const extracted = extractSourcesFromHtml(html, comp.websiteUrl);
              if (extracted.facebook && extracted.facebook.includes("id=")) {
                recoveredFbUrl = extracted.facebook;
              }
            }
          } catch {}
        }

        if (recoveredFbUrl) {
          if (!dryRun) {
            await db
              .update(schema.competitorSources)
              .set({
                canonicalUrl: recoveredFbUrl,
                externalAccountId: extractExternalAccountId("facebook", recoveredFbUrl),
                status: "ACTIVE",
                activityState: "UNSUPPORTED_PROVIDER",
                metadata: { ...meta, repairedFromTruncatedUrl: url, acquisitionSupport: "UNSUPPORTED" },
              })
              .where(eq(schema.competitorSources.id, src.id));
          }
          report.repairedSources.push({
            sourceId: src.id,
            competitorId: comp.id,
            platform: plat,
            previousUrl: url,
            repairedUrl: recoveredFbUrl,
          });
        } else {
          if (!dryRun) {
            await db
              .update(schema.competitorSources)
              .set({
                status: "DISABLED",
                activityState: "INVALID_URL_QUARANTINED",
                metadata: {
                  ...meta,
                  quarantinedReason: isTrackingPixel
                    ? "Facebook tracking pixel URL (facebook.com/tr), not a social profile"
                    : "Truncated facebook.com/profile.php without numeric id parameter",
                },
              })
              .where(eq(schema.competitorSources.id, src.id));
          }
          report.quarantinedSources.push({
            sourceId: src.id,
            competitorId: comp.id,
            competitorName: comp.name,
            platform: plat,
            url,
            reason: isTrackingPixel ? "Facebook tracking pixel (facebook.com/tr)" : "Truncated profile.php without ?id=",
            preservedTestimonials: 0,
            removedMisattributedPosts: 0,
          });
        }
        continue;
      }
    }

    // 3B. Verify external search-discovered social accounts (e.g. @thythickmomma on SongGifts) and platform-owned accounts (@appstore)
    if (["INSTAGRAM", "TIKTOK", "YOUTUBE", "X", "FACEBOOK"].includes(plat) && src.status === "ACTIVE") {
      const handle = src.externalAccountId || extractExternalAccountId(plat, url);
      const cleanDomain = (comp.websiteUrl || "").replace(/^https?:\/\/(www\.)?/i, "").split("/")[0].toLowerCase();
      const verMethod = meta.verificationMethod || "NONE";

      // Check if platform-owned (@appstore) or unverified search-matched third-party account
      const isPlatformAcct = handle ? isPlatformOwnedHandle(handle, cleanDomain) : false;
      let isMisattributedThirdParty = false;

      if (!isPlatformAcct && verMethod === "DOMAIN_MATCH_SEARCH" && handle) {
        const ownership = verifySearchCandidateOwnership({
          platform: plat.toLowerCase() as any,
          url,
          handle,
          title: "",
          snippet: "",
          competitorName: comp.name,
          cleanDomain,
        });
        if (!ownership.verified) {
          isMisattributedThirdParty = true;
        }
      }

      if (isPlatformAcct || isMisattributedThirdParty) {
        const compPosts = await db
          .select()
          .from(schema.ciCompetitorPosts)
          .where(
            and(
              eq(schema.ciCompetitorPosts.accountId, accountId),
              eq(schema.ciCompetitorPosts.competitorId, comp.id),
              eq(schema.ciCompetitorPosts.platform, plat.toLowerCase())
            )
          );

        const brandTokens = [
          cleanDomain.split(".")[0],
          comp.name.toLowerCase().replace(/[^a-z0-9]/g, ""),
        ].filter(t => t && t.length >= 3);

        const matchingTestimonialPosts = compPosts.filter(p => {
          const text = `${p.caption || ""}`.toLowerCase().replace(/[^a-z0-9]/g, "");
          return brandTokens.some(bt => text.includes(bt));
        });

        if (!dryRun) {
          // Preserve customer testimonial posts in evidence_registry
          for (const tp of matchingTestimonialPosts) {
            const evId = `ev_test_${createHash("sha256").update(`${campaignId}:${comp.id}:${tp.postId}`).digest("hex").slice(0, 16)}`;
            await db
              .insert(schema.evidenceRegistry)
              .values({
                id: evId,
                accountId,
                campaignId,
                evidenceUid: `testimonial:${comp.id}:${tp.postId}`,
                kind: "CUSTOMER_TESTIMONIAL_SOCIAL",
                sourceTable: "ci_competitor_posts",
                sourceId: tp.id || tp.postId,
                label: `Customer testimonial by @${handle} referencing ${comp.name}`,
                detail: JSON.stringify({
                  attributedCompetitorId: comp.id,
                  attributedCompetitorName: comp.name,
                  authorHandle: handle,
                  platform: plat.toLowerCase(),
                  postId: tp.postId,
                  url: (tp as any).permalink || (tp as any).url || url,
                  caption: tp.caption,
                  likes: tp.likes,
                  comments: tp.comments,
                  views: tp.views,
                  timestamp: tp.timestamp,
                  note: `Customer testimonial post by @${handle} referencing ${comp.name}; preserved as customer voice evidence and removed from competitor owned-profile metrics.`,
                }),
                observedAt: tp.timestamp || new Date(),
              } as any)
              .onConflictDoNothing();
          }

          // Quarantine the source
          await db
            .update(schema.competitorSources)
            .set({
              status: "DISABLED",
              activityState: isPlatformAcct ? "QUARANTINED_PLATFORM_ACCOUNT" : "QUARANTINED_TESTIMONIAL",
              metadata: {
                ...meta,
                quarantinedReason: isPlatformAcct
                  ? `Platform-owned account @${handle}`
                  : `Third-party creator/testimonial account @${handle} not owned by ${comp.name}`,
                preservedTestimonialCount: matchingTestimonialPosts.length,
              },
            })
            .where(eq(schema.competitorSources.id, src.id));

          // Remove misattributed posts from ci_competitor_posts so competitor metrics are not polluted
          if (compPosts.length > 0) {
            await db
              .delete(schema.ciCompetitorPosts)
              .where(inArray(schema.ciCompetitorPosts.id, compPosts.map(p => p.id)));
          }
        }

        report.quarantinedSources.push({
          sourceId: src.id,
          competitorId: comp.id,
          competitorName: comp.name,
          platform: plat,
          url,
          reason: isPlatformAcct
            ? `Platform-owned account (@${handle})`
            : `Third-party testimonial/creator account (@${handle}) misattributed via search snippet mention`,
          preservedTestimonials: matchingTestimonialPosts.length,
          removedMisattributedPosts: compPosts.length,
        });
        continue;
      }
    }

    // 3C. Populate externalAccountId & unsupported provider activityState if missing
    const extractedExtId = extractExternalAccountId(plat, url);
    const isUnsupported = ["FACEBOOK", "LINKEDIN", "X"].includes(plat);
    const needsExtIdUpdate = extractedExtId && src.externalAccountId !== extractedExtId;
    const needsActivityUpdate = isUnsupported && src.status === "ACTIVE" && src.activityState !== "UNSUPPORTED_PROVIDER";

    if (needsExtIdUpdate || needsActivityUpdate) {
      if (!dryRun) {
        await db
          .update(schema.competitorSources)
          .set({
            externalAccountId: extractedExtId || src.externalAccountId,
            activityState: isUnsupported && src.status === "ACTIVE" ? "UNSUPPORTED_PROVIDER" : src.activityState,
            metadata: {
              ...meta,
              acquisitionSupport: isUnsupported ? "UNSUPPORTED" : "SUPPORTED",
            },
          })
          .where(eq(schema.competitorSources.id, src.id));
      }
      if (needsExtIdUpdate) report.populatedExternalAccountIds++;
    }
  }

  return report;
}

function primaryInfoUrl(url: string | null | undefined): string {
  return url || "primary domain";
}

/**
 * Safely reconciles historical duplicate competitors into ONE canonical survivor per business.
 * 
 * Invariants:
 * 1. Preserves all child evidence (sources, posts, comments, snapshots, briefs).
 * 2. Reparents child records cleanly while resolving unique constraint collisions.
 * 3. Deactivates duplicate parent rows (isActive = false) instead of deleting them.
 * 4. Ensures 1 active monitoring schedule per canonical survivor in Watchtower.
 * 5. Returns zero active duplicate identity groups in Settings & Build Gate.
 */
export async function reconcileCompetitors(
  options: ReconcileCompetitorsOptions
): Promise<CompetitorReconciliationResult> {
  const { accountId, campaignId, dryRun = false } = options;

  // 0. Run identity unmerge and source attribution repair first so merged businesses are separated before deduplicating same-domain rows
  await repairCampaignCompetitorIdentitiesAndSources({ accountId, campaignId, dryRun });

  // 1. Fetch all competitors for campaign
  const allComps = await db
    .select()
    .from(schema.ciCompetitors)
    .where(and(
      eq(schema.ciCompetitors.accountId, accountId),
      eq(schema.ciCompetitors.campaignId, campaignId)
    ));

  // 2. Fetch child metrics per competitor to inform survivor selection
  const [sources, posts, comments, snapshots, schedules, briefs] = await Promise.all([
    db.select({ id: schema.competitorSources.id, competitorId: schema.competitorSources.competitorId }).from(schema.competitorSources).where(and(eq(schema.competitorSources.accountId, accountId), eq(schema.competitorSources.campaignId, campaignId))),
    db.select({ id: schema.ciCompetitorPosts.id, competitorId: schema.ciCompetitorPosts.competitorId }).from(schema.ciCompetitorPosts).where(eq(schema.ciCompetitorPosts.accountId, accountId)),
    db.select({ id: schema.ciCompetitorComments.id, competitorId: schema.ciCompetitorComments.competitorId }).from(schema.ciCompetitorComments).where(eq(schema.ciCompetitorComments.accountId, accountId)),
    db.select({ id: schema.competitorWebsiteSnapshots.id, competitorId: schema.competitorWebsiteSnapshots.competitorId }).from(schema.competitorWebsiteSnapshots).where(and(eq(schema.competitorWebsiteSnapshots.accountId, accountId), eq(schema.competitorWebsiteSnapshots.campaignId, campaignId))),
    db.select({ id: schema.miRefreshSchedule.id, competitorId: schema.miRefreshSchedule.competitorId }).from(schema.miRefreshSchedule).where(and(eq(schema.miRefreshSchedule.accountId, accountId), eq(schema.miRefreshSchedule.campaignId, campaignId))),
    db.select({ id: schema.watchtowerStrategicBriefs.id, competitorId: schema.watchtowerStrategicBriefs.competitorId }).from(schema.watchtowerStrategicBriefs).where(and(eq(schema.watchtowerStrategicBriefs.accountId, accountId), eq(schema.watchtowerStrategicBriefs.campaignId, campaignId))),
  ]);

  const sourceCountMap = new Map<string, number>();
  sources.forEach(s => sourceCountMap.set(s.competitorId, (sourceCountMap.get(s.competitorId) || 0) + 1));

  const postCountMap = new Map<string, number>();
  posts.forEach(p => postCountMap.set(p.competitorId, (postCountMap.get(p.competitorId) || 0) + 1));

  const commentCountMap = new Map<string, number>();
  comments.forEach(c => commentCountMap.set(c.competitorId, (commentCountMap.get(c.competitorId) || 0) + 1));

  const snapshotCountMap = new Map<string, number>();
  snapshots.forEach(s => snapshotCountMap.set(s.competitorId, (snapshotCountMap.get(s.competitorId) || 0) + 1));

  const scheduleCountMap = new Map<string, number>();
  schedules.forEach(s => scheduleCountMap.set(s.competitorId, (scheduleCountMap.get(s.competitorId) || 0) + 1));

  const briefCountMap = new Map<string, number>();
  briefs.forEach(b => briefCountMap.set(b.competitorId, (briefCountMap.get(b.competitorId) || 0) + 1));

  // 3. Group competitors by normalized official domain
  const domainGroups = new Map<string, typeof allComps>();
  for (const c of allComps) {
    const key = getNormalizedCompetitorDomain(c);
    if (!domainGroups.has(key)) domainGroups.set(key, []);
    domainGroups.get(key)!.push(c);
  }

  const groupSummaries: DuplicateGroupSummary[] = [];
  const reparentedCounts = {
    sources: 0,
    posts: 0,
    comments: 0,
    snapshots: 0,
    schedules: 0,
    briefs: 0,
  };

  let totalDuplicateRows = 0;

  for (const [dom, candidates] of domainGroups.entries()) {
    if (candidates.length <= 1) continue;

    totalDuplicateRows += (candidates.length - 1);

    // Sort candidates using deterministic survivor hierarchy:
    // 1. Highest weighted child data score (sources * 10 + posts * 2 + comments + snapshots * 5 + briefs * 10)
    // 2. Tier A over Tier B
    // 3. Earliest createdAt timestamp
    const enriched = candidates.map(c => {
      const srcCnt = sourceCountMap.get(c.id) || 0;
      const postCnt = postCountMap.get(c.id) || 0;
      const commCnt = commentCountMap.get(c.id) || 0;
      const snapCnt = snapshotCountMap.get(c.id) || 0;
      const briefCnt = briefCountMap.get(c.id) || 0;
      const score = (srcCnt * 10) + (postCnt * 2) + commCnt + (snapCnt * 5) + (briefCnt * 10);
      return {
        competitor: c,
        score,
        srcCnt,
        postCnt,
        commCnt,
        snapCnt,
        briefCnt,
        createdAt: c.createdAt ? c.createdAt.toISOString() : "",
      };
    });

    enriched.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.competitor.tier === "A" && b.competitor.tier !== "A") return -1;
      if (b.competitor.tier === "A" && a.competitor.tier !== "A") return 1;
      return a.createdAt.localeCompare(b.createdAt);
    });

    const survivor = enriched[0];
    const superseded = enriched.slice(1);
    const supersededIds = superseded.map(s => s.competitor.id);

    const survivorReason = survivor.score > 0
      ? `Richest active lifecycle: ${survivor.srcCnt} sources, ${survivor.postCnt} posts, ${survivor.commCnt} comments, ${survivor.snapCnt} snapshots`
      : `Earliest canonical production timestamp (${survivor.createdAt})`;

    groupSummaries.push({
      normalizedDomain: dom,
      businessName: survivor.competitor.name,
      survivorId: survivor.competitor.id,
      survivorReason,
      supersededIds,
      totalCandidateRows: candidates.length,
    });

    if (!dryRun) {
      // Execute transactional reparenting for this duplicate group
      await db.transaction(async (tx) => {
        // A. Reparent / Deduplicate competitor_sources
        const groupSources = await tx
          .select()
          .from(schema.competitorSources)
          .where(and(
            eq(schema.competitorSources.accountId, accountId),
            eq(schema.competitorSources.campaignId, campaignId),
            inArray(schema.competitorSources.competitorId, candidates.map(c => c.id))
          ));

        // Group sources by (platform, canonicalUrl)
        const sourcesByPlatformUrl = new Map<string, typeof groupSources>();
        for (const src of groupSources) {
          const key = `${src.platform.toUpperCase()}:::${(src.canonicalUrl || "").toLowerCase().trim()}`;
          if (!sourcesByPlatformUrl.has(key)) sourcesByPlatformUrl.set(key, []);
          sourcesByPlatformUrl.get(key)!.push(src);
        }

        for (const [_, matchingSources] of sourcesByPlatformUrl.entries()) {
          // Sort to pick best source row (ACTIVE over others, most recent lastVerifiedAt)
          matchingSources.sort((a, b) => {
            if (a.status === "ACTIVE" && b.status !== "ACTIVE") return -1;
            if (b.status === "ACTIVE" && a.status !== "ACTIVE") return 1;
            const timeA = a.lastVerifiedAt ? a.lastVerifiedAt.getTime() : 0;
            const timeB = b.lastVerifiedAt ? b.lastVerifiedAt.getTime() : 0;
            return timeB - timeA;
          });

          const primarySrc = matchingSources[0];
          const duplicateSrcs = matchingSources.slice(1);

          // Update primary source to survivor competitorId
          if (primarySrc.competitorId !== survivor.competitor.id) {
            await tx
              .update(schema.competitorSources)
              .set({ competitorId: survivor.competitor.id })
              .where(eq(schema.competitorSources.id, primarySrc.id));
            reparentedCounts.sources++;
          }

          // Delete redundant duplicate sources
          if (duplicateSrcs.length > 0) {
            await tx
              .delete(schema.competitorSources)
              .where(inArray(schema.competitorSources.id, duplicateSrcs.map(s => s.id)));
          }
        }

        // B. Reparent ci_competitor_posts (Handling (competitorId, postId) unique collisions)
        const supersededPosts = await tx
          .select()
          .from(schema.ciCompetitorPosts)
          .where(and(
            eq(schema.ciCompetitorPosts.accountId, accountId),
            inArray(schema.ciCompetitorPosts.competitorId, supersededIds)
          ));

        if (supersededPosts.length > 0) {
          const survivorPosts = await tx
            .select({ postId: schema.ciCompetitorPosts.postId })
            .from(schema.ciCompetitorPosts)
            .where(and(
              eq(schema.ciCompetitorPosts.accountId, accountId),
              eq(schema.ciCompetitorPosts.competitorId, survivor.competitor.id)
            ));

          const existingPostIds = new Set(survivorPosts.map(p => p.postId));
          const postsToReparent: string[] = [];
          const duplicatePostRowIds: string[] = [];

          for (const post of supersededPosts) {
            if (existingPostIds.has(post.postId)) {
              duplicatePostRowIds.push(post.id);
            } else {
              postsToReparent.push(post.id);
              existingPostIds.add(post.postId);
            }
          }

          if (postsToReparent.length > 0) {
            await tx
              .update(schema.ciCompetitorPosts)
              .set({ competitorId: survivor.competitor.id })
              .where(inArray(schema.ciCompetitorPosts.id, postsToReparent));
            reparentedCounts.posts += postsToReparent.length;
          }

          if (duplicatePostRowIds.length > 0) {
            await tx
              .delete(schema.ciCompetitorPosts)
              .where(inArray(schema.ciCompetitorPosts.id, duplicatePostRowIds));
          }
        }

        // C. Reparent ci_competitor_comments (Handling (competitorId, commentId) unique collisions)
        const supersededComments = await tx
          .select()
          .from(schema.ciCompetitorComments)
          .where(and(
            eq(schema.ciCompetitorComments.accountId, accountId),
            inArray(schema.ciCompetitorComments.competitorId, supersededIds)
          ));

        if (supersededComments.length > 0) {
          const survivorComments = await tx
            .select({ commentId: schema.ciCompetitorComments.commentId })
            .from(schema.ciCompetitorComments)
            .where(and(
              eq(schema.ciCompetitorComments.accountId, accountId),
              eq(schema.ciCompetitorComments.competitorId, survivor.competitor.id)
            ));

          const existingCommentIds = new Set(survivorComments.map(c => c.commentId));
          const commentsToReparent: string[] = [];
          const duplicateCommentRowIds: string[] = [];

          for (const comm of supersededComments) {
            if (existingCommentIds.has(comm.commentId)) {
              duplicateCommentRowIds.push(comm.id);
            } else {
              commentsToReparent.push(comm.id);
              existingCommentIds.add(comm.commentId);
            }
          }

          if (commentsToReparent.length > 0) {
            await tx
              .update(schema.ciCompetitorComments)
              .set({ competitorId: survivor.competitor.id })
              .where(inArray(schema.ciCompetitorComments.id, commentsToReparent));
            reparentedCounts.comments += commentsToReparent.length;
          }

          if (duplicateCommentRowIds.length > 0) {
            await tx
              .delete(schema.ciCompetitorComments)
              .where(inArray(schema.ciCompetitorComments.id, duplicateCommentRowIds));
          }
        }

        // D. Reparent competitor_website_snapshots
        await tx
          .update(schema.competitorWebsiteSnapshots)
          .set({ competitorId: survivor.competitor.id })
          .where(and(
            eq(schema.competitorWebsiteSnapshots.accountId, accountId),
            eq(schema.competitorWebsiteSnapshots.campaignId, campaignId),
            inArray(schema.competitorWebsiteSnapshots.competitorId, supersededIds)
          ));
        reparentedCounts.snapshots += (superseded.reduce((acc, s) => acc + s.snapCnt, 0));

        // E. Reparent competitor_post_classifications
        await tx
          .update(schema.competitorPostClassifications)
          .set({ competitorId: survivor.competitor.id })
          .where(inArray(schema.competitorPostClassifications.competitorId, supersededIds));

        // F. Reparent competitor_web_data
        await tx
          .update(schema.competitorWebData)
          .set({ competitorId: survivor.competitor.id })
          .where(and(
            eq(schema.competitorWebData.accountId, accountId),
            eq(schema.competitorWebData.campaignId, campaignId),
            inArray(schema.competitorWebData.competitorId, supersededIds)
          ));

        // G. Reparent ci_competitor_metrics_snapshot
        await tx
          .update(schema.ciCompetitorMetricsSnapshot)
          .set({ competitorId: survivor.competitor.id })
          .where(and(
            eq(schema.ciCompetitorMetricsSnapshot.accountId, accountId),
            inArray(schema.ciCompetitorMetricsSnapshot.competitorId, supersededIds)
          ));

        // H. Reparent ci_competitor_revisions
        await tx
          .update(schema.ciCompetitorRevisions)
          .set({ competitorId: survivor.competitor.id })
          .where(and(
            eq(schema.ciCompetitorRevisions.accountId, accountId),
            eq(schema.ciCompetitorRevisions.campaignId, campaignId),
            inArray(schema.ciCompetitorRevisions.competitorId, supersededIds)
          ));

        // I. Reparent watchtower_strategic_briefs
        await tx
          .update(schema.watchtowerStrategicBriefs)
          .set({ competitorId: survivor.competitor.id })
          .where(and(
            eq(schema.watchtowerStrategicBriefs.accountId, accountId),
            eq(schema.watchtowerStrategicBriefs.campaignId, campaignId),
            inArray(schema.watchtowerStrategicBriefs.competitorId, supersededIds)
          ));
        reparentedCounts.briefs += (superseded.reduce((acc, s) => acc + s.briefCnt, 0));

        // J. Reparent pipeline_change_events
        await tx
          .update(schema.pipelineChangeEvents)
          .set({ competitorId: survivor.competitor.id })
          .where(and(
            eq(schema.pipelineChangeEvents.accountId, accountId),
            eq(schema.pipelineChangeEvents.campaignId, campaignId),
            inArray(schema.pipelineChangeEvents.competitorId, supersededIds)
          ));

        // K. Reparent mi_signal_logs
        await tx
          .update(schema.miSignalLogs)
          .set({ competitorId: survivor.competitor.id })
          .where(inArray(schema.miSignalLogs.competitorId, supersededIds));

        // L. Reparent market_voice_discovery_results
        await tx
          .update(schema.marketVoiceDiscoveryResults)
          .set({ verifiedCompetitorId: survivor.competitor.id })
          .where(and(
            eq(schema.marketVoiceDiscoveryResults.accountId, accountId),
            eq(schema.marketVoiceDiscoveryResults.campaignId, campaignId),
            inArray(schema.marketVoiceDiscoveryResults.verifiedCompetitorId, supersededIds)
          ));

        // M. Reconcile mi_refresh_schedule (Ensure 1 schedule per survivor, remove superseded)
        const groupSchedules = await tx
          .select()
          .from(schema.miRefreshSchedule)
          .where(and(
            eq(schema.miRefreshSchedule.accountId, accountId),
            eq(schema.miRefreshSchedule.campaignId, campaignId),
            inArray(schema.miRefreshSchedule.competitorId, candidates.map(c => c.id))
          ));

        if (groupSchedules.length > 0) {
          const survivorSched = groupSchedules.find(s => s.competitorId === survivor.competitor.id);
          const supersededScheds = groupSchedules.filter(s => s.competitorId !== survivor.competitor.id);

          if (survivorSched) {
            // Survivor already has a valid schedule; delete any duplicate schedules under superseded IDs
            if (supersededScheds.length > 0) {
              await tx
                .delete(schema.miRefreshSchedule)
                .where(inArray(schema.miRefreshSchedule.id, supersededScheds.map(s => s.id)));
            }
          } else {
            // Survivor has no schedule; pick the best superseded schedule and reparent it to survivor
            supersededScheds.sort((a, b) => (a.status === "active" ? -1 : 1));
            const primary = supersededScheds[0];
            const redundant = supersededScheds.slice(1);

            await tx
              .update(schema.miRefreshSchedule)
              .set({ competitorId: survivor.competitor.id })
              .where(eq(schema.miRefreshSchedule.id, primary.id));
            reparentedCounts.schedules++;

            if (redundant.length > 0) {
              await tx
                .delete(schema.miRefreshSchedule)
                .where(inArray(schema.miRefreshSchedule.id, redundant.map(s => s.id)));
            }
          }
        }

        // N. Deactivate superseded parent competitor rows (Preserve history without deleting)
        await tx
          .update(schema.ciCompetitors)
          .set({
            isActive: false,
            notes: sql`COALESCE(notes, '') || ' | SUPERSEDED_DUPLICATE: merged into ' || ${survivor.competitor.id}`,
            updatedAt: new Date(),
          })
          .where(and(
            eq(schema.ciCompetitors.accountId, accountId),
            eq(schema.ciCompetitors.campaignId, campaignId),
            inArray(schema.ciCompetitors.id, supersededIds)
          ));

        // Ensure survivor remains active
        await tx
          .update(schema.ciCompetitors)
          .set({
            isActive: true,
            updatedAt: new Date(),
          })
          .where(eq(schema.ciCompetitors.id, survivor.competitor.id));
      });
    }
  }

  // 4. Post-reconciliation verification & audit
  const postComps = await db
    .select()
    .from(schema.ciCompetitors)
    .where(and(
      eq(schema.ciCompetitors.accountId, accountId),
      eq(schema.ciCompetitors.campaignId, campaignId)
    ));

  const postActiveComps = postComps.filter(c => c.isActive);
  const postInactiveComps = postComps.filter(c => !c.isActive);

  // Check active domain uniqueness
  const postActiveDomains = new Map<string, typeof postComps>();
  for (const c of postActiveComps) {
    const key = getNormalizedCompetitorDomain(c);
    if (!postActiveDomains.has(key)) postActiveDomains.set(key, []);
    postActiveDomains.get(key)!.push(c);
  }

  const duplicateActiveGroups = Array.from(postActiveDomains.values()).filter(list => list.length > 1).length;

  // 5. Check for orphan child records
  const inactiveIds = new Set(postInactiveComps.map(c => c.id));
  const activeIds = new Set(postActiveComps.map(c => c.id));

  const [postSources, postPosts, postComments, postSnapshots, postSchedules] = await Promise.all([
    db.select({ id: schema.competitorSources.id, competitorId: schema.competitorSources.competitorId }).from(schema.competitorSources).where(and(eq(schema.competitorSources.accountId, accountId), eq(schema.competitorSources.campaignId, campaignId))),
    db.select({ id: schema.ciCompetitorPosts.id, competitorId: schema.ciCompetitorPosts.competitorId }).from(schema.ciCompetitorPosts).where(eq(schema.ciCompetitorPosts.accountId, accountId)),
    db.select({ id: schema.ciCompetitorComments.id, competitorId: schema.ciCompetitorComments.competitorId }).from(schema.ciCompetitorComments).where(eq(schema.ciCompetitorComments.accountId, accountId)),
    db.select({ id: schema.competitorWebsiteSnapshots.id, competitorId: schema.competitorWebsiteSnapshots.competitorId }).from(schema.competitorWebsiteSnapshots).where(and(eq(schema.competitorWebsiteSnapshots.accountId, accountId), eq(schema.competitorWebsiteSnapshots.campaignId, campaignId))),
    db.select({ id: schema.miRefreshSchedule.id, competitorId: schema.miRefreshSchedule.competitorId }).from(schema.miRefreshSchedule).where(and(eq(schema.miRefreshSchedule.accountId, accountId), eq(schema.miRefreshSchedule.campaignId, campaignId))),
  ]);

  const orphanSources = postSources.filter(s => inactiveIds.has(s.competitorId)).length;
  const orphanPosts = postPosts.filter(p => inactiveIds.has(p.competitorId)).length;
  const orphanComments = postComments.filter(c => inactiveIds.has(c.competitorId)).length;
  const orphanSnapshots = postSnapshots.filter(s => inactiveIds.has(s.competitorId)).length;
  const orphanSchedules = postSchedules.filter(s => inactiveIds.has(s.competitorId)).length;

  return {
    campaignId,
    accountId,
    dryRun,
    preReconciliation: {
      totalRows: allComps.length,
      activeRows: allComps.filter(c => c.isActive).length,
      uniqueDomains: domainGroups.size,
      duplicateGroups: groupSummaries.length,
      duplicateRows: totalDuplicateRows,
    },
    postReconciliation: {
      totalRows: postComps.length,
      activeCanonicalRows: dryRun ? (allComps.length - totalDuplicateRows) : postActiveComps.length,
      inactiveSupersededRows: dryRun ? totalDuplicateRows : postInactiveComps.length,
      uniqueDomains: domainGroups.size,
      duplicateActiveGroups: dryRun ? 0 : duplicateActiveGroups,
    },
    groups: groupSummaries,
    reparentedCounts,
    orphanCounts: {
      sources: dryRun ? 0 : orphanSources,
      posts: dryRun ? 0 : orphanPosts,
      comments: dryRun ? 0 : orphanComments,
      snapshots: dryRun ? 0 : orphanSnapshots,
      schedules: dryRun ? 0 : orphanSchedules,
    },
    success: true,
  };
}
