import type { Express } from "express";
import { db } from "../db";
import { conversionEvents, trackingLinks, leads } from "@shared/schema";
import { eq, and, sql, desc, gte } from "drizzle-orm";
import { featureFlagService } from "../feature-flags";
import { logAudit } from "../audit";
import { requireCampaign } from "../campaign-routes";

export function registerConversionTrackingRoutes(app: Express) {
  app.get("/api/track/:trackingId", async (req, res) => {
    try {
      const link = await db.select().from(trackingLinks)
        .where(eq(trackingLinks.trackingId, req.params.trackingId))
        .limit(1);

      if (!link[0] || !link[0].isActive) {
        return res.status(404).json({ error: "Link not found" });
      }

      const accountId = link[0].accountId;
      const convEnabled = await featureFlagService.isEnabled("conversion_tracking_enabled", accountId);

      if (convEnabled) {
        await db.insert(conversionEvents).values({
          accountId,
          eventType: link[0].linkType === "whatsapp" ? "whatsapp_click" : "link_click",
          trackingId: req.params.trackingId,
          postId: link[0].postId,
          ctaVariantId: link[0].ctaVariantId,
          campaignId: link[0].campaignId,
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
          referrer: req.headers.referer || null,
        });
      }

      await db.update(trackingLinks).set({
        clicks: sql`${trackingLinks.clicks} + 1`,
      }).where(eq(trackingLinks.id, link[0].id));

      res.redirect(link[0].destinationUrl);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/track/pixel/:trackingId.gif", async (req, res) => {
    try {
      const trackingId = req.params.trackingId;
      const link = await db.select().from(trackingLinks)
        .where(eq(trackingLinks.trackingId, trackingId))
        .limit(1);

      if (link[0]) {
        const accountId = link[0].accountId;
        const convEnabled = await featureFlagService.isEnabled("conversion_tracking_enabled", accountId);
        if (convEnabled) {
          await db.insert(conversionEvents).values({
            accountId,
            eventType: "page_view",
            trackingId,
            postId: link[0].postId,
            campaignId: link[0].campaignId,
            ipAddress: req.ip || null,
            userAgent: req.headers["user-agent"] || null,
            referrer: req.headers.referer || null,
          });
        }
      }

      const pixel = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
      res.set("Content-Type", "image/gif");
      res.set("Cache-Control", "no-store, no-cache, must-revalidate");
      res.send(pixel);
    } catch {
      const pixel = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
      res.set("Content-Type", "image/gif");
      res.send(pixel);
    }
  });

  app.post("/api/conversion-events", async (req, res) => {
    try {
      const accountId = (req as any).accountId || "default";
      if (!(await featureFlagService.isEnabled("conversion_tracking_enabled", accountId))) {
        return res.status(403).json({ error: "Conversion tracking is not enabled" });
      }
      const { eventType, trackingId, leadId, postId, ctaVariantId, campaignId, landingPageId, leadMagnetId, metadata } = req.body;
      if (!eventType) {
        return res.status(400).json({ error: "eventType is required" });
      }
      const inserted = await db.insert(conversionEvents).values({
        accountId, eventType, trackingId, leadId, postId, ctaVariantId,
        campaignId, landingPageId, leadMagnetId,
        metadata: metadata ? JSON.stringify(metadata) : null,
        ipAddress: req.ip || null,
        userAgent: req.headers["user-agent"] || null,
        referrer: req.headers.referer || null,
      }).returning();

      await logAudit(accountId, "CONVERSION_EVENT", {
        details: { eventId: inserted[0].id, eventType, trackingId, leadId },
      });

      res.json({ event: inserted[0] });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/conversion-events", async (req, res) => {
    try {
      const accountId = (req as any).accountId || "default";
      if (!(await featureFlagService.isEnabled("conversion_tracking_enabled", accountId))) {
        return res.json({ events: [], disabled: true });
      }
      const limit = parseInt(req.query.limit as string) || 100;
      const eventType = req.query.eventType as string;

      let result;
      if (eventType) {
        result = await db.select().from(conversionEvents)
          .where(and(eq(conversionEvents.accountId, accountId), eq(conversionEvents.eventType, eventType)))
          .orderBy(desc(conversionEvents.createdAt)).limit(limit);
      } else {
        result = await db.select().from(conversionEvents)
          .where(eq(conversionEvents.accountId, accountId))
          .orderBy(desc(conversionEvents.createdAt)).limit(limit);
      }
      res.json({ events: result });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/conversion-events/stats", requireCampaign, async (req, res) => {
    try {
      const accountId = (req as any).accountId || "default";
      if (!(await featureFlagService.isEnabled("conversion_tracking_enabled", accountId))) {
        return res.json({ stats: null, disabled: true });
      }
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const allEvents = await db.select().from(conversionEvents)
        .where(eq(conversionEvents.accountId, accountId));

      const monthEvents = allEvents.filter(e => e.createdAt && e.createdAt >= monthStart);

      const byType: Record<string, number> = {};
      for (const event of allEvents) {
        byType[event.eventType] = (byType[event.eventType] || 0) + 1;
      }

      const monthByType: Record<string, number> = {};
      for (const event of monthEvents) {
        monthByType[event.eventType] = (monthByType[event.eventType] || 0) + 1;
      }

      res.json({
        stats: {
          totalEvents: allEvents.length,
          eventsThisMonth: monthEvents.length,
          byType,
          monthByType,
          linkClicks: byType["link_click"] || 0,
          formSubmissions: byType["form_submission"] || 0,
          whatsappClicks: byType["whatsapp_click"] || 0,
          pageViews: byType["page_view"] || 0,
        },
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
