import { db } from "./db";
import { studioItems, requiredWork, strategicPlans } from "@shared/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { getBranchForMediaType } from "../lib/media-types";
export async function computeFulfillment(campaignId, accountId = "default") {
    const activePlanStatuses = [
        "APPROVED",
        "GENERATED_TO_CALENDAR",
        "CREATIVE_GENERATED",
        "REVIEW",
        "SCHEDULED",
        "PUBLISHED",
    ];
    const plans = await db
        .select({ id: strategicPlans.id })
        .from(strategicPlans)
        .where(and(eq(strategicPlans.accountId, accountId), eq(strategicPlans.campaignId, campaignId), sql `${strategicPlans.status} IN (${sql.join(activePlanStatuses.map((s) => sql `${s}`), sql `, `)})`))
        .orderBy(sql `${strategicPlans.createdAt} DESC`);
    const activePlanIds = plans.map((p) => p.id);
    let workRec = null;
    if (activePlanIds.length > 0) {
        const workRows = await db
            .select()
            .from(requiredWork)
            .where(and(inArray(requiredWork.planId, activePlanIds), eq(requiredWork.campaignId, campaignId)))
            .orderBy(sql `${requiredWork.createdAt} DESC`)
            .limit(1);
        workRec = workRows[0] || null;
    }
    const reelReq = (workRec?.totalReels || 0) + (workRec?.totalVideos || 0);
    const postReq = (workRec?.totalPosts || 0) + (workRec?.totalCarousels || 0);
    const storyReq = workRec?.totalStories || 0;
    const requiredByBranch = {
        REELS: reelReq || workRec?.reelItems || 0,
        POSTS: postReq || workRec?.postItems || 0,
        STORIES: storyReq || workRec?.storyItems || 0,
    };
    const totalRequired = workRec?.totalContentPieces || 0;
    const siRows = await db
        .select({
        contentType: studioItems.contentType,
        status: studioItems.status,
    })
        .from(studioItems)
        .where(and(eq(studioItems.campaignId, campaignId), eq(studioItems.accountId, accountId)));
    const fulfilledByBranch = {
        REELS: 0,
        POSTS: 0,
        STORIES: 0,
    };
    const statusCounts = {
        draft: 0,
        ready: 0,
        scheduled: 0,
        published: 0,
        failed: 0,
    };
    for (const item of siRows) {
        const branch = getBranchForMediaType(item.contentType);
        fulfilledByBranch[branch]++;
        countStatus(statusCounts, item.status);
    }
    const totalFulfilled = fulfilledByBranch.REELS +
        fulfilledByBranch.POSTS +
        fulfilledByBranch.STORIES;
    const totalRemaining = Math.max(0, totalRequired - totalFulfilled);
    const progressPercent = totalRequired > 0
        ? Math.min(100, Math.round((totalFulfilled / totalRequired) * 100))
        : 0;
    return {
        total: {
            required: totalRequired,
            fulfilled: totalFulfilled,
            remaining: totalRemaining,
        },
        byBranch: {
            REELS: {
                required: requiredByBranch.REELS,
                fulfilled: fulfilledByBranch.REELS,
                remaining: Math.max(0, requiredByBranch.REELS - fulfilledByBranch.REELS),
            },
            POSTS: {
                required: requiredByBranch.POSTS,
                fulfilled: fulfilledByBranch.POSTS,
                remaining: Math.max(0, requiredByBranch.POSTS - fulfilledByBranch.POSTS),
            },
            STORIES: {
                required: requiredByBranch.STORIES,
                fulfilled: fulfilledByBranch.STORIES,
                remaining: Math.max(0, requiredByBranch.STORIES - fulfilledByBranch.STORIES),
            },
        },
        byStatus: statusCounts,
        progressPercent,
        planId: activePlanIds[0] || null,
        campaignId,
        accountId,
        computedAt: new Date().toISOString(),
    };
}
function countStatus(counts, status) {
    if (!status)
        return;
    const s = status.toUpperCase();
    if (s === "DRAFT")
        counts.draft++;
    else if (s === "READY")
        counts.ready++;
    else if (s === "SCHEDULED" || s === "SCHEDULE")
        counts.scheduled++;
    else if (s === "PUBLISHED")
        counts.published++;
    else if (s === "FAILED")
        counts.failed++;
}
