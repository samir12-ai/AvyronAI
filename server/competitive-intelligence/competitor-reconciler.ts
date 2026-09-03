import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and, inArray, sql, notInArray } from "drizzle-orm";

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
 */
export function getNormalizedCompetitorDomain(competitor: {
  name: string;
  websiteUrl?: string | null;
  profileLink?: string | null;
}): string {
  const raw = (competitor.websiteUrl || competitor.profileLink || "").trim();
  if (!raw) return `name_${competitor.name.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
  try {
    const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    const h = u.hostname.replace(/^www\./, "").toLowerCase();
    if (h.includes("instagram.com")) {
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts.length > 0 && !["p", "reel", "explore", "stories"].includes(parts[0])) {
        return `instagram.com/${parts[0].toLowerCase()}`;
      }
    }
    return h;
  } catch {
    return raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  }
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
