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
import { userPublicProfiles, ciCompetitors } from "@shared/schema";
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

  const competitorItems: DiscoveredItem[] = compRows.map((c) => ({
    lane: "competitor",
    entityType: platformToCompetitorEntityType(c.platform),
    entityId: c.id,
    discoveryRowId: c.id,
    displayName: c.name ?? `competitor:${c.id.slice(0, 8)}`,
  }));

  if (compRows.length === 0) {
    notes.push(
      onlyIds
        ? "no_competitors_matched_scope"
        : "no_active_competitors_for_campaign",
    );
  }

  return { userItems, competitorItems, notes };
}
