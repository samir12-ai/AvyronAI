/**
 * Phase 8.0 — Collector discovery.
 *
 * Pure read. Enumerates the entities the Boss agent should plan acquisitions
 * for, sourced from Main's existing tables:
 *   - user_channel  ← user_public_profiles (Task #10)
 *   - competitor_*  ← ci_competitors (active rows only)
 *
 * Returns BossPlanItem-compatible structures (structurally typed to avoid
 * a circular import between server/collector/* and server/boss/*). The Boss
 * planner widens these via type compatibility — no runtime conversion needed.
 *
 * Honors scope.onlyEntityIds (filters to specific user_public_profiles.id
 * or ci_competitors.id values) when provided. No DB writes — pure discovery.
 */

import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { userPublicProfiles, ciCompetitors, competitorSources } from "@shared/schema";
import type { CollectorEntityType, CollectorLane } from "./envelope";

export interface DiscoveredItem {
  lane: CollectorLane;
  entityType: CollectorEntityType;
  entityId: string;
  discoveryRowId: string;
  displayName: string;
}

export interface DiscoveryResult {
  userItems: DiscoveredItem[];
  competitorItems: DiscoveredItem[];
  notes: string[];
}

/** Subset of BossScope this discovery surface honors. Kept as a strict
 *  subtype (no index signature) so BossScope assigns cleanly without
 *  introducing a circular import between collector/* and boss/*. */
export interface DiscoveryScope {
  onlyEntityIds?: string[];
}

function platformToCompetitorEntityType(platform: string | null | undefined): CollectorEntityType {
  switch ((platform ?? "instagram").toLowerCase()) {
    case "tiktok":
      return "competitor_tiktok";
    case "youtube":
      return "competitor_youtube";
    case "website":
    case "site":
      return "competitor_website";
    case "google_search":
    case "serp":
      return "competitor_google_search";
    case "linkedin":
      return "competitor_linkedin";
    case "x":
    case "twitter":
      return "competitor_x";
    case "google":
    case "yelp":
    case "trustpilot":
    case "reviews":
    case "google_reviews":
      return "competitor_reviews";
    case "instagram":
    default:
      return "competitor_instagram";
  }
}

export async function discoverEntities(
  accountId: string,
  campaignId: string,
  scope?: DiscoveryScope,
): Promise<DiscoveryResult> {
  const notes: string[] = [];
  const onlyIds = scope?.onlyEntityIds && scope.onlyEntityIds.length > 0 ? scope.onlyEntityIds : null;

  // ── User channels ─────────────────────────────────────────────────
  const userQueryConds = [
    eq(userPublicProfiles.accountId, accountId),
    eq(userPublicProfiles.campaignId, campaignId),
  ];
  if (onlyIds) userQueryConds.push(inArray(userPublicProfiles.id, onlyIds));

  const userRows = await db
    .select()
    .from(userPublicProfiles)
    .where(and(...userQueryConds));

  const userItems: DiscoveredItem[] = userRows.map((p) => ({
    lane: "user",
    entityType: "user_channel",
    entityId: p.id,
    discoveryRowId: p.id,
    displayName: `${p.platform}:${p.handle ?? p.url ?? p.id.slice(0, 8)}`,
  }));

  if (userRows.length === 0) {
    notes.push(
      onlyIds
        ? "no_user_channels_matched_scope"
        : "no_user_channels_registered_for_campaign",
    );
  }

  // ── Competitors ──────────────────────────────────────────────────
  const compQueryConds = [
    eq(ciCompetitors.accountId, accountId),
    eq(ciCompetitors.campaignId, campaignId),
    eq(ciCompetitors.isActive, true),
  ];
  if (onlyIds) compQueryConds.push(inArray(ciCompetitors.id, onlyIds));

  const compRows = await db
    .select()
    .from(ciCompetitors)
    .where(and(...compQueryConds));

  const competitorItems: DiscoveredItem[] = [];
  const seenCompetitorEntityTypes = new Set<string>();

  // Pre-load competitor_sources so quarantined/disabled primary platforms are not scheduled
  let allCampaignSources: Array<typeof competitorSources.$inferSelect> = [];
  if (compRows.length > 0) {
    try {
      allCampaignSources = await db
        .select()
        .from(competitorSources)
        .where(
          and(
            eq(competitorSources.campaignId, campaignId),
            inArray(
              competitorSources.competitorId,
              compRows.map((c) => c.id),
            ),
          ),
        );
    } catch {
      // Non-fatal fallback if competitor_sources is unavailable in isolated unit tests
    }
  }

  for (const c of compRows) {
    const primaryType = platformToCompetitorEntityType(c.platform);
    const compSources = allCampaignSources.filter((s) => s.competitorId === c.id);
    const matchingPrimarySources = compSources.filter((s) => {
      const pUpper = (s.platform || "").toUpperCase();
      if (primaryType === "competitor_instagram") return pUpper === "INSTAGRAM";
      return platformToCompetitorEntityType(pUpper) === primaryType;
    });
    const isPrimaryQuarantinedOrDisabled =
      compSources.length > 0 &&
      (matchingPrimarySources.length === 0 ||
        matchingPrimarySources.every(
          (s) =>
            s.status === "DISABLED" ||
            s.status === "REJECTED" ||
            s.verificationStatus === "REJECTED" ||
            s.activityState === "QUARANTINED_MISATTRIBUTED"
        ));

    if (!isPrimaryQuarantinedOrDisabled) {
      const primaryKey = `${c.id}:${primaryType}`;
      seenCompetitorEntityTypes.add(primaryKey);
      competitorItems.push({
        lane: "competitor",
        entityType: primaryType,
        entityId: c.id,
        discoveryRowId: c.id,
        displayName: c.name ?? `competitor:${c.id.slice(0, 8)}`,
      });
    }

    // If competitor has a websiteUrl but primary platform was social (e.g. instagram),
    // also include competitor_website so Watchtower compares website changes too.
    if (c.websiteUrl && primaryType !== "competitor_website") {
      const webKey = `${c.id}:competitor_website`;
      if (!seenCompetitorEntityTypes.has(webKey)) {
        seenCompetitorEntityTypes.add(webKey);
        competitorItems.push({
          lane: "competitor",
          entityType: "competitor_website",
          entityId: c.id,
          discoveryRowId: `${c.id}:website`,
          displayName: `${c.name ?? `competitor:${c.id.slice(0, 8)}`} (website)`,
        });
      }
    }
  }

  // Also discover registered active/verified competitor_sources (Instagram, TikTok, YouTube, Reviews, Website)
  if (compRows.length > 0 && allCampaignSources.length > 0) {
    const compById = new Map(compRows.map((c) => [c.id, c]));
    const watchtowerSourcePlatforms = new Set([
      "WEBSITE",
      "INSTAGRAM",
      "TIKTOK",
      "YOUTUBE",
      "REVIEWS",
      "GOOGLE_REVIEWS",
    ]);

    for (const src of allCampaignSources) {
      const platUpper = (src.platform || "").toUpperCase();
      if (!watchtowerSourcePlatforms.has(platUpper)) continue;
      if (src.status === "DISABLED" || src.status === "REJECTED" || src.verificationStatus === "REJECTED") continue;
      if (
        src.activityState === "UNSUPPORTED_PROVIDER" ||
        src.activityState === "INVALID_HANDLE" ||
        src.activityState === "NO_POSTS" ||
        src.activityState === "QUARANTINED_MISATTRIBUTED"
      ) {
        continue;
      }

      const entityType = platformToCompetitorEntityType(platUpper);
      const key = `${src.competitorId}:${entityType}`;
      if (seenCompetitorEntityTypes.has(key)) continue;
      seenCompetitorEntityTypes.add(key);

      const comp = compById.get(src.competitorId);
      competitorItems.push({
        lane: "competitor",
        entityType,
        entityId: src.competitorId,
        discoveryRowId: src.id,
        displayName: `${comp?.name ?? `competitor:${src.competitorId.slice(0, 8)}`} (${platUpper.toLowerCase()})`,
      });
    }
  }

  if (compRows.length === 0) {
    notes.push(
      onlyIds
        ? "no_competitors_matched_scope"
        : "no_active_competitors_for_campaign",
    );
  }

  return { userItems, competitorItems, notes };
}
