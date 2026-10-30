import type { Express, Request, Response } from "express";
import { db } from "./db";
import * as schema from "@shared/schema";
import { eq, and, desc, sql, gte, inArray, like, or } from "drizzle-orm";
import { requireCampaign } from "./campaign-routes";
import { resolveEffectiveNow } from "./performance-loop/clock";
import { isWeeklyInventoryDue } from "./performance-loop/weekly-inventory-engine";

export const CLARIFICATION_REMINDER_DELAY_HOURS = Number(process.env.CLARIFICATION_REMINDER_HOURS) || 48;
export const MAX_CLARIFICATION_REMINDERS = Number(process.env.CLARIFICATION_MAX_REMINDERS) || 2;

export async function syncNotificationsForCampaign(accountId: string, campaignId: string, nowOverride?: Date) {
  try {
    const now = resolveEffectiveNow(campaignId, nowOverride);
    const reminderDelayMs = CLARIFICATION_REMINDER_DELAY_HOURS * 60 * 60 * 1000;

    // 1. Pending strategy change proposals -> STRATEGY_REVIEW_REQUIRED
    const pendingProposals = await db
      .select()
      .from(schema.strategyChangeProposals)
      .where(
        and(
          eq(schema.strategyChangeProposals.accountId, accountId),
          eq(schema.strategyChangeProposals.campaignId, campaignId),
          eq(schema.strategyChangeProposals.status, "PENDING_USER_APPROVAL")
        )
      );

    for (const prop of pendingProposals) {
      await db
        .insert(schema.notifications)
        .values({
          accountId,
          campaignId,
          type: "STRATEGY_REVIEW_REQUIRED",
          title: "Strategic Review Required",
          message: prop.summary || "A strategic proposal requires your approval.",
          severity: "HIGH",
          sourceEntityType: "strategy_change_proposal",
          sourceEntityId: prop.id,
          targetRoute: "/(tabs)/reasoning-evidence",
          isRead: false,
        })
        .onConflictDoNothing();
    }

    // 2. Applied strategy change proposals -> STRATEGY_UPDATED
    const appliedProposals = await db
      .select()
      .from(schema.strategyChangeProposals)
      .where(
        and(
          eq(schema.strategyChangeProposals.accountId, accountId),
          eq(schema.strategyChangeProposals.campaignId, campaignId),
          eq(schema.strategyChangeProposals.status, "APPLIED")
        )
      )
      .orderBy(desc(schema.strategyChangeProposals.createdAt))
      .limit(2);

    for (const prop of appliedProposals) {
      await db
        .insert(schema.notifications)
        .values({
          accountId,
          campaignId,
          type: "STRATEGY_UPDATED",
          title: "Strategy Updated",
          message: prop.summary || "Strategy plan recomputed and activated.",
          severity: "MEDIUM",
          sourceEntityType: "strategy_change_proposal",
          sourceEntityId: prop.id,
          targetRoute: "/(tabs)/strategy-plan",
          isRead: false,
        })
        .onConflictDoNothing();
    }

    // 3. Confirmed Watchtower Events -> WATCHTOWER_HIGH_IMPACT_CONFIRMED
    const confirmedEvents = await db
      .select()
      .from(schema.pipelineChangeEvents)
      .where(
        and(
          eq(schema.pipelineChangeEvents.accountId, accountId),
          eq(schema.pipelineChangeEvents.campaignId, campaignId),
          eq(schema.pipelineChangeEvents.status, "confirmed")
        )
      )
      .orderBy(desc(schema.pipelineChangeEvents.createdAt))
      .limit(3);

    for (const ev of confirmedEvents) {
      await db
        .insert(schema.notifications)
        .values({
          accountId,
          campaignId,
          type: "WATCHTOWER_HIGH_IMPACT_CONFIRMED",
          title: "Market Change Confirmed",
          message: `Watchtower confirmed competitor shift in ${ev.kind}.`,
          severity: "MEDIUM",
          sourceEntityType: "pipeline_change_event",
          sourceEntityId: ev.id,
          targetRoute: "/(tabs)/watchtower",
          isRead: false,
        })
        .onConflictDoNothing();
    }

    // 4. Finalized Monthly Reports -> REPORT_FINALIZED
    const finalizedReports = await db
      .select()
      .from(schema.monthlyReports)
      .where(
        and(
          eq(schema.monthlyReports.accountId, accountId),
          eq(schema.monthlyReports.campaignId, campaignId),
          eq(schema.monthlyReports.status, "FINALIZED")
        )
      )
      .orderBy(desc(schema.monthlyReports.reportPeriodYear), desc(schema.monthlyReports.reportPeriodMonth))
      .limit(1);

    for (const rep of finalizedReports) {
      const p = (rep.reportPayload || {}) as any;
      const periodLabel = p.periodLabel || `${rep.reportPeriodYear}-${rep.reportPeriodMonth}`;
      await db
        .insert(schema.notifications)
        .values({
          accountId,
          campaignId,
          type: "REPORT_FINALIZED",
          title: "Monthly Report Finalized",
          message: `Monthly Report for ${periodLabel} is now finalized.`,
          severity: "INFO",
          sourceEntityType: "monthly_report",
          sourceEntityId: rep.id,
          targetRoute: "/(tabs)/reports",
          isRead: false,
        })
        .onConflictDoNothing();
    }

    // 5. Today's WTDT Execution Tasks -> WTDT_ACTION_REQUIRED
    const todayTasks = await db
      .select()
      .from(schema.executionTasks)
      .where(
        and(
          eq(schema.executionTasks.accountId, accountId),
          eq(schema.executionTasks.campaignId, campaignId),
          eq(schema.executionTasks.status, "PLANNED")
        )
      )
      .limit(1);

    if (todayTasks.length > 0) {
      const todayStr = now.toISOString().split("T")[0];
      await db
        .insert(schema.notifications)
        .values({
          accountId,
          campaignId,
          type: "WTDT_ACTION_REQUIRED",
          title: "Action Items Planned",
          message: "Strategic execution tasks are ready for today.",
          severity: "INFO",
          sourceEntityType: "execution_day",
          sourceEntityId: `day_${todayStr}`,
          targetRoute: "/(tabs)/what-to-do-today",
          isRead: false,
        })
        .onConflictDoNothing();
    }

    // 6. Pending Performance Clarification Requests -> PERFORMANCE_CLARIFICATION_REQUIRED + 48h Reminder Policy
    const allClarifications = await db
      .select()
      .from(schema.clarificationRequests)
      .where(
        and(
          eq(schema.clarificationRequests.accountId, accountId),
          eq(schema.clarificationRequests.campaignId, campaignId)
        )
      )
      .orderBy(desc(schema.clarificationRequests.createdAt));

    const hasAnsweredBaseline = allClarifications.some(r => r.status === "ANSWERED");
    const pendingClarifications = allClarifications.filter(r => r.status === "PENDING");

    // Reconcile duplicate or stale pending baseline requests so only one canonical pending baseline can exist when unanswered
    const canonicalPendingBaseline = !hasAnsweredBaseline && pendingClarifications.length > 0
      ? pendingClarifications[0]
      : null;
    const stalePendingBaselines = hasAnsweredBaseline
      ? pendingClarifications
      : pendingClarifications.slice(1);

    for (const staleReq of stalePendingBaselines) {
      await db
        .update(schema.clarificationRequests)
        .set({
          status: "RESOLVED",
          nextReminderAt: null,
          updatedAt: now,
        })
        .where(eq(schema.clarificationRequests.id, staleReq.id));
    }

    if (canonicalPendingBaseline) {
      const reqRow = canonicalPendingBaseline;
      const qText = (reqRow as any).question || (reqRow as any).questionText || "Please answer a quick business baseline question so Performance Loop can calibrate your campaign.";
      await db
        .insert(schema.notifications)
        .values({
          accountId,
          campaignId,
          type: "PERFORMANCE_CLARIFICATION_REQUIRED",
          title: "Business Baseline Clarification Needed",
          message: qText,
          severity: "HIGH",
          sourceEntityType: "clarification_request",
          sourceEntityId: reqRow.id,
          targetRoute: "/(tabs)/performance",
          isRead: false,
        })
        .onConflictDoNothing();

      // 48-hour unanswered reminder policy starting from actual request creation time
      const createdAtMs = reqRow.createdAt ? new Date(reqRow.createdAt).getTime() : now.getTime();
      const lastRemindedVal = (reqRow as any).lastRemindedAt || (reqRow as any).lastReminderAt || null;
      const lastReminderMs = lastRemindedVal ? new Date(lastRemindedVal).getTime() : null;
      const currentReminders = Number(reqRow.reminderCount ?? 0);
      const isInitialAgeReached = now.getTime() - createdAtMs >= reminderDelayMs;
      const isRepeatCooldownReached = lastReminderMs === null || now.getTime() - lastReminderMs >= reminderDelayMs;

      if (isInitialAgeReached && isRepeatCooldownReached && currentReminders < MAX_CLARIFICATION_REMINDERS) {
        const nextReminderNum = currentReminders + 1;
        const reminderEntityId = `${reqRow.id}_reminder_${nextReminderNum}`;
        await db
          .insert(schema.notifications)
          .values({
            accountId,
            campaignId,
            type: "PERFORMANCE_CLARIFICATION_REMINDER",
            title: `Reminder (${nextReminderNum}/${MAX_CLARIFICATION_REMINDERS}): Business Baseline Needed`,
            message: `Unanswered for ${CLARIFICATION_REMINDER_DELAY_HOURS}+ hours: ${qText}`,
            severity: "HIGH",
            sourceEntityType: "clarification_request_reminder",
            sourceEntityId: reminderEntityId,
            targetRoute: "/(tabs)/performance",
            isRead: false,
          })
          .onConflictDoNothing();

        await db
          .update(schema.clarificationRequests)
          .set({
            reminderCount: nextReminderNum,
            lastRemindedAt: now,
            nextReminderAt: nextReminderNum < MAX_CLARIFICATION_REMINDERS ? new Date(now.getTime() + reminderDelayMs) : null,
            updatedAt: now,
          })
          .where(eq(schema.clarificationRequests.id, reqRow.id));
      } else if (!isInitialAgeReached && currentReminders === 0 && !reqRow.nextReminderAt) {
        await db
          .update(schema.clarificationRequests)
          .set({
            nextReminderAt: new Date(createdAtMs + reminderDelayMs),
          })
          .where(eq(schema.clarificationRequests.id, reqRow.id));
      }
    }

    // Mark clarification notifications as read if the underlying request is now ANSWERED or RESOLVED
    const resolvedOrAnsweredClarifications = allClarifications.filter(
      r => r.status === "ANSWERED" || r.status === "RESOLVED" || stalePendingBaselines.some(s => s.id === r.id)
    );
    for (const ans of resolvedOrAnsweredClarifications) {
      await db
        .update(schema.notifications)
        .set({ isRead: true, readAt: now })
        .where(
          and(
            eq(schema.notifications.accountId, accountId),
            eq(schema.notifications.campaignId, campaignId),
            or(
              eq(schema.notifications.sourceEntityId, ans.id),
              like(schema.notifications.sourceEntityId, `${ans.id}_reminder_%`)
            ),
            eq(schema.notifications.isRead, false)
          )
        );
    }

    // 7. Weekly Business Results Inventory -> Lifecycle-driven due notification & 48h reminder timing from periodEnd
    const allInventories = await db
      .select()
      .from(schema.weeklyBusinessInventories)
      .where(
        and(
          eq(schema.weeklyBusinessInventories.accountId, accountId),
          eq(schema.weeklyBusinessInventories.campaignId, campaignId)
        )
      )
      .orderBy(desc(schema.weeklyBusinessInventories.periodStart))
      .limit(12);

    for (const inv of allInventories) {
      const dueNow = isWeeklyInventoryDue(inv, now);
      const isCompletedOrExpired = inv.status === "COMPLETED" || inv.status === "EXPIRED";

      if (isCompletedOrExpired) {
        // Resolve notifications and stop reminders once completed
        await db
          .update(schema.notifications)
          .set({ isRead: true, readAt: now })
          .where(
            and(
              eq(schema.notifications.accountId, accountId),
              eq(schema.notifications.campaignId, campaignId),
              or(
                eq(schema.notifications.sourceEntityId, inv.id),
                like(schema.notifications.sourceEntityId, `${inv.id}_reminder_%`)
              ),
              eq(schema.notifications.isRead, false)
            )
          );

        if (inv.nextReminderAt !== null) {
          await db
            .update(schema.weeklyBusinessInventories)
            .set({ nextReminderAt: null, updatedAt: now })
            .where(eq(schema.weeklyBusinessInventories.id, inv.id));
        }
        continue;
      }

      if (!dueNow) {
        // Period is still open (now < periodEnd): no premature due notification or reminders allowed.
        // Reconcile and remove any premature notifications created before the period ended.
        await db
          .delete(schema.notifications)
          .where(
            and(
              eq(schema.notifications.accountId, accountId),
              eq(schema.notifications.campaignId, campaignId),
              or(
                eq(schema.notifications.sourceEntityId, inv.id),
                like(schema.notifications.sourceEntityId, `${inv.id}_reminder_%`)
              )
            )
          );

        if (Number(inv.reminderCount ?? 0) > 0 || inv.lastRemindedAt !== null || inv.nextReminderAt !== null) {
          await db
            .update(schema.weeklyBusinessInventories)
            .set({
              reminderCount: 0,
              lastRemindedAt: null,
              nextReminderAt: null,
              updatedAt: now,
            })
            .where(eq(schema.weeklyBusinessInventories.id, inv.id));
        }
        continue;
      }

      // Period has ended (now >= periodEnd) and final figures are still missing (WAITING_FOR_USER or PARTIAL)
      const pStart = inv.periodStart ? new Date(inv.periodStart).toISOString().slice(0, 10) : "current window";
      const pEnd = inv.periodEnd ? new Date(inv.periodEnd).toISOString().slice(0, 10) : "now";
      await db
        .insert(schema.notifications)
        .values({
          accountId,
          campaignId,
          type: "WEEKLY_INVENTORY_DUE",
          title: "Weekly Check-In Due",
          message: `Your reporting period (${pStart} to ${pEnd}) has ended. Submit your final weekly figures (leads, conversions, revenue, ad spend).`,
          severity: "MEDIUM",
          sourceEntityType: "weekly_business_inventory",
          sourceEntityId: inv.id,
          targetRoute: "/(tabs)/performance",
          isRead: false,
        })
        .onConflictDoNothing();

      // Start unanswered reminder timing from actual due time (periodEnd), NOT inventory creation time
      const dueAtMs = inv.periodEnd ? new Date(inv.periodEnd).getTime() : now.getTime();
      const rawLastReminded = (inv as any).lastRemindedAt || (inv as any).lastReminderAt || null;
      const rawLastReminderMs = rawLastReminded ? new Date(rawLastReminded).getTime() : null;
      // Ignore any legacy reminder timestamp that occurred before the period was actually due
      const lastReminderMs = rawLastReminderMs !== null && rawLastReminderMs >= dueAtMs ? rawLastReminderMs : null;
      const currentReminders = lastReminderMs === null && Number(inv.reminderCount ?? 0) > 0 && rawLastReminderMs !== null && rawLastReminderMs < dueAtMs
        ? 0
        : Number(inv.reminderCount ?? 0);

      const isInitialAgeReached = now.getTime() - dueAtMs >= reminderDelayMs;
      const isRepeatCooldownReached = lastReminderMs === null || now.getTime() - lastReminderMs >= reminderDelayMs;

      if (isInitialAgeReached && isRepeatCooldownReached && currentReminders < MAX_CLARIFICATION_REMINDERS) {
        const nextReminderNum = currentReminders + 1;
        const reminderEntityId = `${inv.id}_reminder_${nextReminderNum}`;
        await db
          .insert(schema.notifications)
          .values({
            accountId,
            campaignId,
            type: "WEEKLY_INVENTORY_REMINDER",
            title: `Reminder (${nextReminderNum}/${MAX_CLARIFICATION_REMINDERS}): Weekly Check-In Due`,
            message: `Your 7-day reporting window (${pStart} to ${pEnd}) ended ${CLARIFICATION_REMINDER_DELAY_HOURS}+ hours ago and is awaiting final figures.`,
            severity: "MEDIUM",
            sourceEntityType: "weekly_business_inventory_reminder",
            sourceEntityId: reminderEntityId,
            targetRoute: "/(tabs)/performance",
            isRead: false,
          })
          .onConflictDoNothing();

        await db
          .update(schema.weeklyBusinessInventories)
          .set({
            reminderCount: nextReminderNum,
            lastRemindedAt: now,
            nextReminderAt: nextReminderNum < MAX_CLARIFICATION_REMINDERS ? new Date(now.getTime() + reminderDelayMs) : null,
            updatedAt: now,
          })
          .where(eq(schema.weeklyBusinessInventories.id, inv.id));
      } else if (!isInitialAgeReached && currentReminders === 0) {
        const expectedFirstReminderAt = new Date(dueAtMs + reminderDelayMs);
        if (!inv.nextReminderAt || new Date(inv.nextReminderAt).getTime() !== expectedFirstReminderAt.getTime()) {
          await db
            .update(schema.weeklyBusinessInventories)
            .set({
              reminderCount: 0,
              lastRemindedAt: null,
              nextReminderAt: expectedFirstReminderAt,
            })
            .where(eq(schema.weeklyBusinessInventories.id, inv.id));
        }
      }
    }
  } catch (err: any) {
    console.error("[Notifications] sync error:", err);
  }
}

export function registerNotificationsRoutes(app: Express) {
  app.get("/api/notifications", requireCampaign, async (req: Request, res: Response) => {
    try {
      const { accountId, campaignId } = (req as any).campaignContext;
      const now = resolveEffectiveNow(campaignId, req.query.nowOverride as string | undefined, req);
      await syncNotificationsForCampaign(accountId, campaignId, now);

      const rows = await db
        .select()
        .from(schema.notifications)
        .where(
          and(
            eq(schema.notifications.accountId, accountId),
            eq(schema.notifications.campaignId, campaignId)
          )
        )
        .orderBy(desc(schema.notifications.createdAt))
        .limit(20);

      const unreadCount = rows.filter(r => !r.isRead).length;

      return res.json({
        success: true,
        notifications: rows,
        unreadCount,
      });
    } catch (err: any) {
      console.error("[Notifications] get error:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post("/api/notifications/:id/read", requireCampaign, async (req: Request, res: Response) => {
    try {
      const { accountId, campaignId } = (req as any).campaignContext;
      const { id } = req.params;

      const [updated] = await db
        .update(schema.notifications)
        .set({
          isRead: true,
          readAt: new Date(),
        })
        .where(
          and(
            eq(schema.notifications.id, id),
            eq(schema.notifications.accountId, accountId)
          )
        )
        .returning();

      return res.json({
        success: true,
        notification: updated,
      });
    } catch (err: any) {
      console.error("[Notifications] mark read error:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post("/api/notifications/read-all", requireCampaign, async (req: Request, res: Response) => {
    try {
      const { accountId, campaignId } = (req as any).campaignContext;

      await db
        .update(schema.notifications)
        .set({
          isRead: true,
          readAt: new Date(),
        })
        .where(
          and(
            eq(schema.notifications.accountId, accountId),
            eq(schema.notifications.campaignId, campaignId),
            eq(schema.notifications.isRead, false)
          )
        );

      return res.json({
        success: true,
      });
    } catch (err: any) {
      console.error("[Notifications] mark read all error:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });
}
