import type { Express, Request, Response } from "express";
import { db } from "./db";
import * as schema from "@shared/schema";
import { eq, and, desc, sql, gte } from "drizzle-orm";
import { requireCampaign } from "./campaign-routes";

export async function syncNotificationsForCampaign(accountId: string, campaignId: string) {
  try {
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
      const todayStr = new Date().toISOString().split("T")[0];
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
  } catch (err: any) {
    console.error("[Notifications] sync error:", err);
  }
}

export function registerNotificationsRoutes(app: Express) {
  app.get("/api/notifications", requireCampaign, async (req: Request, res: Response) => {
    try {
      const { accountId, campaignId } = (req as any).campaignContext;
      await syncNotificationsForCampaign(accountId, campaignId);

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
