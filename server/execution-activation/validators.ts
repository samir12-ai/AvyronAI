import { CONTENT_MINIMUMS, REELS_RATIO_MINIMUM } from "./constants";

export interface ContentQueueItem {
  id: string;
  contentType: string;
  status: string;
  scheduledDate: string | null;
  scheduledTime: string | null;
}

export interface ContentQueueValidation {
  valid: boolean;
  totalItems: number;
  reelsCount: number;
  carouselsCount: number;
  storiesCount: number;
  postsCount: number;
  videosCount: number;
  reelsRatio: number;
  scheduledCount: number;
  unscheduledCount: number;
  violations: string[];
  contentBreakdown: Record<string, number>;
}

export function validateContentQueue(items: ContentQueueItem[]): ContentQueueValidation {
  const violations: string[] = [];

  const reelsCount = items.filter(i => (i.contentType || "").toLowerCase() === "reel").length;
  const carouselsCount = items.filter(i => (i.contentType || "").toLowerCase() === "carousel").length;
  const storiesCount = items.filter(i => (i.contentType || "").toLowerCase() === "story").length;
  const postsCount = items.filter(i => (i.contentType || "").toLowerCase() === "post").length;
  const videosCount = items.filter(i => (i.contentType || "").toLowerCase() === "video").length;

  const totalItems = items.length;
  const reelsRatio = totalItems > 0 ? (reelsCount + videosCount) / totalItems : 0;

  const scheduledCount = items.filter(i => i.scheduledDate !== null).length;
  const unscheduledCount = totalItems - scheduledCount;

  if (totalItems === 0) {
    violations.push("NO_CONTENT_TO_DISTRIBUTE: Content queue is empty — system cannot proceed");
  }

  if (reelsCount < CONTENT_MINIMUMS.reels) {
    violations.push(`REELS_MINIMUM_NOT_MET: ${reelsCount} reels found, minimum required: ${CONTENT_MINIMUMS.reels}`);
  }

  if (carouselsCount < CONTENT_MINIMUMS.carousels) {
    violations.push(`CAROUSELS_MINIMUM_NOT_MET: ${carouselsCount} carousels found, minimum required: ${CONTENT_MINIMUMS.carousels}`);
  }

  if (storiesCount < CONTENT_MINIMUMS.stories) {
    violations.push(`STORIES_MINIMUM_NOT_MET: ${storiesCount} stories found, minimum required: ${CONTENT_MINIMUMS.stories}`);
  }

  if (reelsRatio < REELS_RATIO_MINIMUM && totalItems > 0) {
    violations.push(`REELS_RATIO_VIOLATION: Reels ratio ${(reelsRatio * 100).toFixed(0)}% is below required ${(REELS_RATIO_MINIMUM * 100).toFixed(0)}%`);
  }

  if (unscheduledCount > 0) {
    violations.push(`SCHEDULING_INCOMPLETE: ${unscheduledCount} of ${totalItems} items have no scheduled date`);
  }

  return {
    valid: violations.length === 0,
    totalItems,
    reelsCount,
    carouselsCount,
    storiesCount,
    postsCount,
    videosCount,
    reelsRatio,
    scheduledCount,
    unscheduledCount,
    violations,
    contentBreakdown: {
      reel: reelsCount,
      carousel: carouselsCount,
      story: storiesCount,
      post: postsCount,
      video: videosCount,
    },
  };
}

export interface FunnelFeedingValidation {
  valid: boolean;
  trafficFlowing: boolean;
  contentGenerated: number;
  contentScheduled: number;
  contentPublished: number;
  funnelStatus: "ACTIVE" | "STARVED" | "PENDING";
  violations: string[];
}

export function validateFunnelFeeding(
  contentItems: ContentQueueItem[],
  publishedCount: number,
  reachMetric: number,
): FunnelFeedingValidation {
  const violations: string[] = [];

  const contentGenerated = contentItems.filter(i => i.status !== "DRAFT").length;
  const contentScheduled = contentItems.filter(i => i.scheduledDate !== null).length;

  const trafficFlowing = publishedCount > 0 || reachMetric > 0;

  if (!trafficFlowing && contentGenerated > 0) {
    violations.push("FUNNEL_STARVED: Content exists but no traffic is flowing — funnel has zero input");
  }

  if (contentGenerated === 0) {
    violations.push("NO_CONTENT_GENERATED: Zero content pieces have been generated — funnel cannot activate");
  }

  if (contentScheduled === 0 && contentItems.length > 0) {
    violations.push("NO_CONTENT_SCHEDULED: Content exists but none is scheduled for distribution");
  }

  let funnelStatus: "ACTIVE" | "STARVED" | "PENDING" = "PENDING";
  if (trafficFlowing && contentGenerated > 0) {
    funnelStatus = "ACTIVE";
  } else if (contentGenerated > 0 && !trafficFlowing) {
    funnelStatus = "STARVED";
  }

  return {
    valid: violations.length === 0,
    trafficFlowing,
    contentGenerated,
    contentScheduled,
    contentPublished: publishedCount,
    funnelStatus,
    violations,
  };
}
