import { db } from "../db";
import {
  strategicPlans,
  calendarEntries,
  studioItems,
  requiredWork,
  businessDataLayer,
  publishedPosts,
} from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { logAudit } from "../audit";
import { aiChat } from "../ai-client";
import {
  EXECUTION_STATES,
  VALID_STATE_TRANSITIONS,
  ACTIVATION_CONFIG,
} from "./constants";
import {
  validateContentQueue,
  validateFunnelFeeding,
  type ContentQueueItem,
  type ContentQueueValidation,
  type FunnelFeedingValidation,
} from "./validators";

export interface ActivationResult {
  success: boolean;
  planId: string;
  previousState: string;
  newState: string;
  calendarEntriesGenerated: number;
  contentItemsGenerated: number;
  contentGenerationErrors: string[];
  contentQueueValidation: ContentQueueValidation;
  funnelValidation: FunnelFeedingValidation | null;
  activationLog: string[];
  error?: string;
}

export interface ActivationStatus {
  planId: string;
  planStatus: string;
  executionStatus: string;
  contentQueue: ContentQueueValidation | null;
  funnelFeeding: FunnelFeedingValidation | null;
  calendarEntryCount: number;
  studioItemCount: number;
  activationTimestamp: string | null;
}

function isValidTransition(from: string, to: string): boolean {
  const allowed = VALID_STATE_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

async function transitionState(planId: string, from: string, to: string, accountId: string): Promise<boolean> {
  if (!isValidTransition(from, to)) {
    console.error(`[ExecutionActivation] INVALID_TRANSITION: ${from} → ${to} for plan ${planId}`);
    return false;
  }

  await db.update(strategicPlans)
    .set({ executionStatus: to, updatedAt: new Date() })
    .where(eq(strategicPlans.id, planId));

  await logAudit(accountId, "EXECUTION_STATE_TRANSITION", {
    details: { planId, from, to },
  });

  console.log(`[ExecutionActivation] STATE_TRANSITION: ${from} → ${to} | plan=${planId}`);
  return true;
}

function deriveDistribution(bizData: any): {
  reelsPerWeek: number;
  postsPerWeek: number;
  storiesPerDay: number;
  carouselsPerWeek: number;
  videosPerWeek: number;
} {
  const objective = bizData?.funnelObjective || "AWARENESS";
  const budgetStr = bizData?.monthlyBudget || "0";
  const budget = parseInt(budgetStr.replace(/[^0-9]/g, "")) || 0;
  const businessType = (bizData?.businessType || "").toLowerCase();

  const isVisual = ["photography", "fashion", "beauty", "food", "restaurant", "fitness", "travel", "real estate", "interior design", "art", "design"].some(t => businessType.includes(t));
  const isService = ["consulting", "coaching", "legal", "accounting", "saas", "tech", "software", "agency", "clinic", "medical", "dental"].some(t => businessType.includes(t));

  let base = { reelsPerWeek: 3, postsPerWeek: 1, storiesPerDay: 1, carouselsPerWeek: 1, videosPerWeek: 0 };

  switch (objective) {
    case "AWARENESS":
      base = isVisual
        ? { reelsPerWeek: 4, postsPerWeek: 1, storiesPerDay: 2, carouselsPerWeek: 1, videosPerWeek: 1 }
        : { reelsPerWeek: 3, postsPerWeek: 2, storiesPerDay: 1, carouselsPerWeek: 1, videosPerWeek: 0 };
      break;
    case "LEADS":
      base = isService
        ? { reelsPerWeek: 3, postsPerWeek: 2, storiesPerDay: 1, carouselsPerWeek: 2, videosPerWeek: 0 }
        : { reelsPerWeek: 3, postsPerWeek: 1, storiesPerDay: 1, carouselsPerWeek: 2, videosPerWeek: 1 };
      break;
    case "SALES":
      base = isVisual
        ? { reelsPerWeek: 4, postsPerWeek: 1, storiesPerDay: 2, carouselsPerWeek: 1, videosPerWeek: 1 }
        : { reelsPerWeek: 3, postsPerWeek: 2, storiesPerDay: 1, carouselsPerWeek: 2, videosPerWeek: 0 };
      break;
    case "AUTHORITY":
      base = isService
        ? { reelsPerWeek: 2, postsPerWeek: 2, storiesPerDay: 1, carouselsPerWeek: 3, videosPerWeek: 1 }
        : { reelsPerWeek: 3, postsPerWeek: 1, storiesPerDay: 1, carouselsPerWeek: 2, videosPerWeek: 1 };
      break;
  }

  let volumeMultiplier = 1;
  if (budget >= 5000) volumeMultiplier = 1.5;
  else if (budget >= 2000) volumeMultiplier = 1.2;
  else if (budget <= 500) volumeMultiplier = 0.7;

  return {
    reelsPerWeek: Math.max(3, Math.round(base.reelsPerWeek * volumeMultiplier)),
    postsPerWeek: Math.round(base.postsPerWeek * volumeMultiplier),
    storiesPerDay: Math.max(1, Math.round(base.storiesPerDay * volumeMultiplier)),
    carouselsPerWeek: Math.max(1, Math.round(base.carouselsPerWeek * volumeMultiplier)),
    videosPerWeek: Math.round(base.videosPerWeek * volumeMultiplier),
  };
}

function calcTotals(distribution: any, periodDays: number) {
  const weeks = Math.ceil(periodDays / 7);
  const days = periodDays;

  const totalReels = (distribution.reelsPerWeek || 0) * weeks;
  const totalPosts = (distribution.postsPerWeek || 0) * weeks;
  const totalStories = (distribution.storiesPerDay || 0) * days;
  const totalCarousels = (distribution.carouselsPerWeek || 0) * weeks;
  const totalVideos = (distribution.videosPerWeek || 0) * weeks;
  const totalContentPieces = totalReels + totalPosts + totalStories + totalCarousels + totalVideos;

  return {
    totalReels,
    totalPosts,
    totalStories,
    totalCarousels,
    totalVideos,
    totalContentPieces,
    reelItems: totalReels + totalVideos,
    postItems: totalPosts + totalCarousels,
    storyItems: totalStories,
    ...distribution,
  };
}

function generateCalendarSlots(
  planId: string,
  campaignId: string,
  accountId: string,
  work: any,
  startDate: Date,
  periodDays: number
): any[] {
  const slots: any[] = [];
  const contentQueue: { type: string; count: number }[] = [];

  if (work.totalReels > 0) contentQueue.push({ type: "reel", count: work.totalReels });
  if (work.totalPosts > 0) contentQueue.push({ type: "post", count: work.totalPosts });
  if (work.totalCarousels > 0) contentQueue.push({ type: "carousel", count: work.totalCarousels });
  if (work.totalVideos > 0) contentQueue.push({ type: "video", count: work.totalVideos });
  if (work.totalStories > 0) contentQueue.push({ type: "story", count: work.totalStories });

  const allItems: { type: string; index: number }[] = [];
  for (const q of contentQueue) {
    for (let i = 0; i < q.count; i++) {
      allItems.push({ type: q.type, index: i });
    }
  }

  if (allItems.length === 0) return [];

  const gap = periodDays / allItems.length;
  const postTimes = ["09:00", "12:00", "15:00", "18:00", "20:00"];

  for (let i = 0; i < allItems.length; i++) {
    const dayOffset = Math.floor(i * gap);
    const d = new Date(startDate);
    d.setDate(d.getDate() + dayOffset);
    const dateStr = d.toISOString().split("T")[0];
    const time = postTimes[i % postTimes.length];

    slots.push({
      planId,
      campaignId,
      accountId,
      contentType: allItems[i].type,
      scheduledDate: dateStr,
      scheduledTime: time,
      title: `${allItems[i].type.charAt(0).toUpperCase() + allItems[i].type.slice(1)} #${allItems[i].index + 1}`,
      status: "DRAFT",
      sourceLabel: "auto-activation",
    });
  }

  return slots;
}

async function generateCreativeForEntry(
  entry: any,
  planContext: string,
): Promise<{ caption: string; creativeBrief: string; ctaCopy: string }> {
  const response = await aiChat({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `You are a social media content creator. Generate content for a ${entry.contentType} post.\n\nContext: ${planContext}\n\nRespond in JSON: { "caption": "...", "creativeBrief": "...", "ctaCopy": "..." }`,
      },
      {
        role: "user",
        content: `Create content for: "${entry.title}" scheduled for ${entry.scheduledDate}. Content type: ${entry.contentType}.`,
      },
    ],
    max_tokens: 800,
    response_format: { type: "json_object" },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("AI returned empty response");

  const parsed = JSON.parse(content);
  return {
    caption: parsed.caption || "Caption pending",
    creativeBrief: parsed.creativeBrief || "Brief pending",
    ctaCopy: parsed.ctaCopy || "CTA pending",
  };
}

export async function activateExecution(planId: string): Promise<ActivationResult> {
  const activationLog: string[] = [];
  const contentGenerationErrors: string[] = [];
  const startTime = Date.now();

  activationLog.push(`[${new Date().toISOString()}] ACTIVATION_START | planId=${planId}`);

  const [plan] = await db.select().from(strategicPlans).where(eq(strategicPlans.id, planId)).limit(1);

  if (!plan) {
    return {
      success: false,
      planId,
      previousState: "UNKNOWN",
      newState: "UNKNOWN",
      calendarEntriesGenerated: 0,
      contentItemsGenerated: 0,
      contentGenerationErrors: ["PLAN_NOT_FOUND"],
      contentQueueValidation: validateContentQueue([]),
      funnelValidation: null,
      activationLog: ["PLAN_NOT_FOUND"],
      error: "Plan not found",
    };
  }

  if (plan.status !== "APPROVED") {
    activationLog.push(`ACTIVATION_BLOCKED: Plan status is ${plan.status}, must be APPROVED`);
    return {
      success: false,
      planId,
      previousState: plan.executionStatus,
      newState: plan.executionStatus,
      calendarEntriesGenerated: 0,
      contentItemsGenerated: 0,
      contentGenerationErrors: [`Plan status is ${plan.status}, not APPROVED`],
      contentQueueValidation: validateContentQueue([]),
      funnelValidation: null,
      activationLog,
      error: "PLAN_NOT_APPROVED",
    };
  }

  if (plan.emergencyStopped) {
    activationLog.push("ACTIVATION_BLOCKED: Emergency stop is active");
    return {
      success: false,
      planId,
      previousState: plan.executionStatus,
      newState: plan.executionStatus,
      calendarEntriesGenerated: 0,
      contentItemsGenerated: 0,
      contentGenerationErrors: ["Emergency stop active"],
      contentQueueValidation: validateContentQueue([]),
      funnelValidation: null,
      activationLog,
      error: "EMERGENCY_STOPPED",
    };
  }

  const previousState = plan.executionStatus;

  const canTransition = isValidTransition(previousState, EXECUTION_STATES.ACTIVATING);
  if (!canTransition) {
    activationLog.push(`ACTIVATION_BLOCKED: Cannot transition from ${previousState} to ACTIVATING`);
    return {
      success: false,
      planId,
      previousState,
      newState: previousState,
      calendarEntriesGenerated: 0,
      contentItemsGenerated: 0,
      contentGenerationErrors: [`Invalid state transition: ${previousState} → ACTIVATING`],
      contentQueueValidation: validateContentQueue([]),
      funnelValidation: null,
      activationLog,
      error: "INVALID_STATE_TRANSITION",
    };
  }

  await transitionState(planId, previousState, EXECUTION_STATES.ACTIVATING, plan.accountId);
  activationLog.push(`STATE: ${previousState} → ACTIVATING`);

  try {
    let planJson: any;
    try {
      planJson = JSON.parse(plan.planJson || "{}");
    } catch {
      planJson = {};
    }

    let bizData: any = null;
    try {
      const bizRows = await db.select().from(businessDataLayer)
        .where(and(
          eq(businessDataLayer.campaignId, plan.campaignId),
          eq(businessDataLayer.accountId, plan.accountId)
        ))
        .limit(1);
      if (bizRows.length > 0) bizData = bizRows[0];
    } catch {}

    const existingEntries = await db.select().from(calendarEntries)
      .where(eq(calendarEntries.planId, planId));

    let calendarEntriesGenerated = 0;

    if (existingEntries.length === 0) {
      activationLog.push("CALENDAR: No existing entries found — generating calendar slots");

      const distribution = planJson.contentDistributionPlan || {};
      const weeklyCalendar = distribution.weeklyCalendar || [];

      const calReels = weeklyCalendar.filter((d: any) => d.contentType?.toLowerCase() === "reel").length;
      const calCarousels = weeklyCalendar.filter((d: any) => d.contentType?.toLowerCase() === "carousel").length;
      const calStories = weeklyCalendar.filter((d: any) => d.contentType?.toLowerCase() === "story").length;
      const calPosts = weeklyCalendar.filter((d: any) => ["post", "static post"].includes(d.contentType?.toLowerCase())).length;
      const calVideos = weeklyCalendar.filter((d: any) => d.contentType?.toLowerCase() === "video").length;

      const bizDerived = deriveDistribution(bizData);

      const parsedDistribution = {
        reelsPerWeek: calReels > 0 ? calReels : bizDerived.reelsPerWeek,
        postsPerWeek: calPosts > 0 ? calPosts : bizDerived.postsPerWeek,
        storiesPerDay: calStories > 0 ? 1 : bizDerived.storiesPerDay,
        carouselsPerWeek: calCarousels > 0 ? calCarousels : bizDerived.carouselsPerWeek,
        videosPerWeek: calVideos > 0 ? calVideos : bizDerived.videosPerWeek,
      };

      const periodDays = 30;
      const totals = calcTotals(parsedDistribution, periodDays);

      const existingWork = await db.select().from(requiredWork)
        .where(and(eq(requiredWork.planId, planId), eq(requiredWork.campaignId, plan.campaignId)))
        .limit(1);

      if (existingWork.length > 0) {
        await db.update(requiredWork)
          .set({ ...totals, ...parsedDistribution, periodDays, updatedAt: new Date() })
          .where(eq(requiredWork.id, existingWork[0].id));
      } else {
        await db.insert(requiredWork).values({
          planId,
          campaignId: plan.campaignId,
          accountId: plan.accountId,
          periodDays,
          ...parsedDistribution,
          ...totals,
        });
      }

      const slots = generateCalendarSlots(planId, plan.campaignId, plan.accountId, totals, new Date(), periodDays);

      if (slots.length > 0) {
        await db.insert(calendarEntries).values(slots);
        calendarEntriesGenerated = slots.length;
        activationLog.push(`CALENDAR: Generated ${slots.length} calendar slots`);
      } else {
        activationLog.push("CALENDAR_WARNING: Zero slots generated — distribution may be empty");
      }

      await logAudit(plan.accountId, "AUTO_CALENDAR_GENERATED", {
        details: { planId, entries: slots.length, periodDays },
      });
    } else {
      activationLog.push(`CALENDAR: ${existingEntries.length} existing entries found — skipping generation`);
      calendarEntriesGenerated = existingEntries.length;
    }

    const allEntries = await db.select().from(calendarEntries)
      .where(and(eq(calendarEntries.planId, planId), eq(calendarEntries.status, "DRAFT")));

    activationLog.push(`CONTENT_GENERATION: ${allEntries.length} DRAFT entries to process`);

    let planContext = "Marketing campaign content";
    try {
      const brand = planJson.brandIdentity?.brandName || planJson.brandName || "";
      const industry = planJson.marketAnalysis?.industry || planJson.industry || "";
      const tone = planJson.contentStrategy?.toneOfVoice || planJson.toneOfVoice || "";
      planContext = `Brand: ${brand}. Industry: ${industry}. Tone: ${tone}.`.replace(/\.\s*\./g, ".");
    } catch {}

    let contentItemsGenerated = 0;

    for (let i = 0; i < allEntries.length; i += ACTIVATION_CONFIG.generationBatchSize) {
      const batch = allEntries.slice(i, i + ACTIVATION_CONFIG.generationBatchSize);

      for (const entry of batch) {
        if (Date.now() - startTime > ACTIVATION_CONFIG.activationTimeoutMs) {
          activationLog.push(`CONTENT_GENERATION: Timeout reached at ${contentItemsGenerated}/${allEntries.length} items`);
          break;
        }

        const existingItem = await db.select().from(studioItems)
          .where(eq(studioItems.calendarEntryId, entry.id))
          .limit(1);

        if (existingItem.length > 0 && existingItem[0].status !== "FAILED") {
          contentItemsGenerated++;
          continue;
        }

        let retries = 0;
        let generated = false;

        while (retries <= ACTIVATION_CONFIG.maxContentGenerationRetries && !generated) {
          try {
            const aiContent = await generateCreativeForEntry(entry, planContext);

            if (existingItem.length > 0) {
              await db.update(studioItems)
                .set({
                  caption: aiContent.caption,
                  creativeBrief: aiContent.creativeBrief,
                  ctaCopy: aiContent.ctaCopy,
                  status: "DRAFT",
                  errorReason: null,
                  updatedAt: new Date(),
                })
                .where(eq(studioItems.id, existingItem[0].id));
            } else {
              await db.insert(studioItems).values({
                planId,
                campaignId: plan.campaignId,
                accountId: plan.accountId,
                calendarEntryId: entry.id,
                contentType: entry.contentType,
                caption: aiContent.caption,
                creativeBrief: aiContent.creativeBrief,
                ctaCopy: aiContent.ctaCopy,
                status: "DRAFT",
                title: entry.title,
              });
            }

            await db.update(calendarEntries)
              .set({ status: "GENERATED", updatedAt: new Date() })
              .where(eq(calendarEntries.id, entry.id));

            contentItemsGenerated++;
            generated = true;
          } catch (err: any) {
            retries++;
            if (retries > ACTIVATION_CONFIG.maxContentGenerationRetries) {
              contentGenerationErrors.push(`Entry ${entry.id} (${entry.contentType}): ${err.message}`);
              await db.update(calendarEntries)
                .set({ status: "FAILED", errorReason: err.message, updatedAt: new Date() })
                .where(eq(calendarEntries.id, entry.id));
            }
          }
        }

        if (ACTIVATION_CONFIG.generationDelayMs > 0) {
          await new Promise(r => setTimeout(r, ACTIVATION_CONFIG.generationDelayMs));
        }
      }
    }

    activationLog.push(`CONTENT_GENERATION: Completed — ${contentItemsGenerated} generated, ${contentGenerationErrors.length} errors`);

    const finalEntries = await db.select().from(calendarEntries)
      .where(eq(calendarEntries.planId, planId));

    const contentQueueItems: ContentQueueItem[] = finalEntries.map(e => ({
      id: e.id,
      contentType: e.contentType || "unknown",
      status: e.status || "DRAFT",
      scheduledDate: e.scheduledDate,
      scheduledTime: e.scheduledTime,
    }));

    const contentQueueValidation = validateContentQueue(contentQueueItems);

    let published: any[] = [];
    try {
      published = await db.select().from(publishedPosts)
        .where(and(
          eq(publishedPosts.campaignId, plan.campaignId),
          eq(publishedPosts.status, "published")
        ));
    } catch {}

    const funnelValidation = validateFunnelFeeding(contentQueueItems, published.length, 0);

    if (contentQueueValidation.valid) {
      await transitionState(planId, EXECUTION_STATES.ACTIVATING, EXECUTION_STATES.ACTIVE, plan.accountId);
      activationLog.push(`STATE: ACTIVATING → ACTIVE | Content queue valid — all minimums met`);
    } else {
      activationLog.push(`CONTENT_QUEUE_VIOLATIONS: ${contentQueueValidation.violations.join(" | ")}`);

      await transitionState(planId, EXECUTION_STATES.ACTIVATING, EXECUTION_STATES.ACTIVATION_FAILED, plan.accountId);
      activationLog.push(`STATE: ACTIVATING → ACTIVATION_FAILED | Content queue validation failed — system blocks progression`);

      await logAudit(plan.accountId, "ACTIVATION_BLOCKED", {
        details: {
          planId,
          violations: contentQueueValidation.violations,
          contentGenerated: contentItemsGenerated,
          calendarEntries: calendarEntriesGenerated,
        },
      });

      return {
        success: false,
        planId,
        previousState,
        newState: EXECUTION_STATES.ACTIVATION_FAILED,
        calendarEntriesGenerated,
        contentItemsGenerated,
        contentGenerationErrors,
        contentQueueValidation,
        funnelValidation,
        activationLog,
        error: "CONTENT_QUEUE_VALIDATION_FAILED",
      };
    }

    await logAudit(plan.accountId, "EXECUTION_ACTIVATED", {
      details: {
        planId,
        calendarEntries: calendarEntriesGenerated,
        contentGenerated: contentItemsGenerated,
        contentErrors: contentGenerationErrors.length,
        queueValid: contentQueueValidation.valid,
        funnelStatus: funnelValidation.funnelStatus,
      },
    });

    activationLog.push(`ACTIVATION_COMPLETE | duration=${Date.now() - startTime}ms`);

    return {
      success: true,
      planId,
      previousState,
      newState: EXECUTION_STATES.ACTIVE,
      calendarEntriesGenerated,
      contentItemsGenerated,
      contentGenerationErrors,
      contentQueueValidation,
      funnelValidation,
      activationLog,
    };
  } catch (err: any) {
    console.error(`[ExecutionActivation] ACTIVATION_ERROR: ${err.message}`);
    activationLog.push(`ACTIVATION_ERROR: ${err.message}`);

    await transitionState(planId, EXECUTION_STATES.ACTIVATING, EXECUTION_STATES.ACTIVATION_FAILED, plan.accountId);

    return {
      success: false,
      planId,
      previousState,
      newState: EXECUTION_STATES.ACTIVATION_FAILED,
      calendarEntriesGenerated: 0,
      contentItemsGenerated: 0,
      contentGenerationErrors: [err.message],
      contentQueueValidation: validateContentQueue([]),
      funnelValidation: null,
      activationLog,
      error: err.message,
    };
  }
}

export async function getActivationStatus(planId: string): Promise<ActivationStatus> {
  const [plan] = await db.select().from(strategicPlans).where(eq(strategicPlans.id, planId)).limit(1);

  if (!plan) {
    throw new Error("PLAN_NOT_FOUND");
  }

  const entries = await db.select().from(calendarEntries)
    .where(eq(calendarEntries.planId, planId));

  const items = await db.select().from(studioItems)
    .where(eq(studioItems.planId, planId));

  const contentQueueItems: ContentQueueItem[] = entries.map(e => ({
    id: e.id,
    contentType: e.contentType || "unknown",
    status: e.status || "DRAFT",
    scheduledDate: e.scheduledDate,
    scheduledTime: e.scheduledTime,
  }));

  const contentQueue = entries.length > 0 ? validateContentQueue(contentQueueItems) : null;

  let published: any[] = [];
  try {
    published = await db.select().from(publishedPosts)
      .where(and(
        eq(publishedPosts.campaignId, plan.campaignId),
        eq(publishedPosts.status, "published")
      ));
  } catch {}

  const funnelFeeding = entries.length > 0
    ? validateFunnelFeeding(contentQueueItems, published.length, 0)
    : null;

  return {
    planId,
    planStatus: plan.status,
    executionStatus: plan.executionStatus,
    contentQueue,
    funnelFeeding,
    calendarEntryCount: entries.length,
    studioItemCount: items.length,
    activationTimestamp: plan.updatedAt?.toISOString() || null,
  };
}
