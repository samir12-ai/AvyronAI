import type { Express } from "express";
import { db } from "../db";
import { leads, leadForms, trackingLinks, conversionEvents } from "@shared/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { featureFlagService } from "../feature-flags";
import { logAudit } from "../audit";
import { requireCampaign } from "../campaign-routes";

function generateTrackingId(): string {
  return `trk_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 10)}`;
}

export function registerLeadCaptureRoutes(app: Express) {
  app.get("/api/leads", async (req, res) => {
    try {
      const accountId = (req.query.accountId as string) || "default";
      if (!(await featureFlagService.isEnabled("lead_capture_enabled", accountId))) {
        return res.json({ leads: [], disabled: true });
      }
      const status = req.query.status as string;
      const limit = parseInt(req.query.limit as string) || 50;

      let query = db.select().from(leads).where(eq(leads.accountId, accountId));
      if (status) {
        query = db.select().from(leads).where(and(eq(leads.accountId, accountId), eq(leads.status, status)));
      }
      const result = await query.orderBy(desc(leads.createdAt)).limit(limit);
      res.json({ leads: result });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/leads", async (req, res) => {
    try {
      const accountId = req.body.accountId || "default";
      if (!(await featureFlagService.isEnabled("lead_capture_enabled", accountId))) {
        return res.status(403).json({ error: "Lead capture is not enabled" });
      }
      const { name, email, phone, customFields, sourceType, sourcePostId, sourceCampaign, sourceCtaVariantId, sourceTrackingId, sourceLandingPageId, sourceLeadMagnetId, campaignId } = req.body;
      const inserted = await db.insert(leads).values({
        accountId, name, email, phone,
        customFields: customFields ? JSON.stringify(customFields) : null,
        sourceType, sourcePostId, sourceCampaign, sourceCtaVariantId,
        sourceTrackingId, sourceLandingPageId, sourceLeadMagnetId,
        campaignId: campaignId || null,
      }).returning();

      await logAudit(accountId, "LEAD_CAPTURED", {
        details: { leadId: inserted[0].id, sourceType, sourcePostId, sourceTrackingId },
      });

      res.json({ lead: inserted[0] });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/leads/:id/status", async (req, res) => {
    try {
      const { status, accountId, notes } = req.body;
      const acct = accountId || "default";
      if (!(await featureFlagService.isEnabled("lead_capture_enabled", acct))) {
        return res.status(403).json({ error: "Lead capture is not enabled" });
      }
      const validStatuses = ["new", "contacted", "qualified", "converted", "lost"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
      }
      const existing = await db.select().from(leads).where(eq(leads.id, req.params.id)).limit(1);
      if (!existing[0]) return res.status(404).json({ error: "Lead not found" });

      const updated = await db.update(leads)
        .set({ status, notes: notes || existing[0].notes, updatedAt: new Date() })
        .where(eq(leads.id, req.params.id))
        .returning();

      await logAudit(acct, "LEAD_STATUS_CHANGED", {
        details: { leadId: req.params.id, fromStatus: existing[0].status, toStatus: status },
      });

      res.json({ lead: updated[0] });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/leads/:id", async (req, res) => {
    try {
      await db.delete(leads).where(eq(leads.id, req.params.id));
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/lead-forms", async (req, res) => {
    try {
      const accountId = (req.query.accountId as string) || "default";
      if (!(await featureFlagService.isEnabled("lead_capture_enabled", accountId))) {
        return res.json({ forms: [], disabled: true });
      }
      const result = await db.select().from(leadForms)
        .where(eq(leadForms.accountId, accountId))
        .orderBy(desc(leadForms.createdAt));
      res.json({ forms: result });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/lead-forms", async (req, res) => {
    try {
      const accountId = req.body.accountId || "default";
      if (!(await featureFlagService.isEnabled("lead_capture_enabled", accountId))) {
        return res.status(403).json({ error: "Lead capture is not enabled" });
      }
      const { name, fields, thankYouMessage, redirectUrl } = req.body;
      if (!name || !fields) {
        return res.status(400).json({ error: "name and fields are required" });
      }
      const inserted = await db.insert(leadForms).values({
        accountId, name,
        fields: typeof fields === "string" ? fields : JSON.stringify(fields),
        thankYouMessage, redirectUrl,
      }).returning();
      res.json({ form: inserted[0] });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/lead-forms/:id", async (req, res) => {
    try {
      const { name, fields, thankYouMessage, redirectUrl, isActive } = req.body;
      const updated = await db.update(leadForms).set({
        ...(name && { name }),
        ...(fields && { fields: typeof fields === "string" ? fields : JSON.stringify(fields) }),
        ...(thankYouMessage !== undefined && { thankYouMessage }),
        ...(redirectUrl !== undefined && { redirectUrl }),
        ...(isActive !== undefined && { isActive }),
        updatedAt: new Date(),
      }).where(eq(leadForms.id, req.params.id)).returning();
      res.json({ form: updated[0] });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/lead-forms/:id/submit", async (req, res) => {
    try {
      const form = await db.select().from(leadForms).where(eq(leadForms.id, req.params.id)).limit(1);
      if (!form[0] || !form[0].isActive) {
        return res.status(404).json({ error: "Form not found or inactive" });
      }
      const accountId = form[0].accountId;
      if (!(await featureFlagService.isEnabled("lead_capture_enabled", accountId))) {
        return res.status(403).json({ error: "Lead capture is not enabled" });
      }

      const { name, email, phone, customFields, trackingId, campaignId } = req.body;
      const inserted = await db.insert(leads).values({
        accountId, name, email, phone,
        customFields: customFields ? JSON.stringify(customFields) : null,
        sourceType: "form",
        sourceTrackingId: trackingId || null,
        campaignId: campaignId || null,
      }).returning();

      await db.update(leadForms).set({
        submissions: sql`${leadForms.submissions} + 1`,
      }).where(eq(leadForms.id, req.params.id));

      const convTrackingEnabled = await featureFlagService.isEnabled("conversion_tracking_enabled", accountId);
      if (convTrackingEnabled) {
        await db.insert(conversionEvents).values({
          accountId,
          eventType: "form_submission",
          leadId: inserted[0].id,
          trackingId: trackingId || null,
          metadata: JSON.stringify({ formId: req.params.id }),
        });
      }

      await logAudit(accountId, "LEAD_CAPTURED", {
        details: { leadId: inserted[0].id, sourceType: "form", formId: req.params.id },
      });

      res.json({
        success: true,
        lead: inserted[0],
        thankYouMessage: form[0].thankYouMessage,
        redirectUrl: form[0].redirectUrl,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/tracking-links", async (req, res) => {
    try {
      const accountId = req.body.accountId || "default";
      if (!(await featureFlagService.isEnabled("lead_capture_enabled", accountId))) {
        return res.status(403).json({ error: "Lead capture is not enabled" });
      }
      const { destinationUrl, linkType, postId, campaignId, ctaVariantId, whatsappNumber, whatsappMessage } = req.body;
      if (!destinationUrl) {
        return res.status(400).json({ error: "destinationUrl is required" });
      }
      const trackingId = generateTrackingId();

      let finalDestination = destinationUrl;
      if (linkType === "whatsapp" && whatsappNumber) {
        const encodedMessage = encodeURIComponent(whatsappMessage || "Hi, I'm interested!");
        finalDestination = `https://wa.me/${whatsappNumber.replace(/[^0-9]/g, "")}?text=${encodedMessage}`;
      }

      const inserted = await db.insert(trackingLinks).values({
        accountId, trackingId, destinationUrl: finalDestination,
        linkType: linkType || "cta",
        postId, campaignId, ctaVariantId,
        whatsappNumber, whatsappMessage,
      }).returning();

      res.json({ trackingLink: inserted[0] });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/tracking-links", async (req, res) => {
    try {
      const accountId = (req.query.accountId as string) || "default";
      if (!(await featureFlagService.isEnabled("lead_capture_enabled", accountId))) {
        return res.json({ links: [], disabled: true });
      }
      const result = await db.select().from(trackingLinks)
        .where(eq(trackingLinks.accountId, accountId))
        .orderBy(desc(trackingLinks.createdAt));
      res.json({ links: result });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/leads/stats", requireCampaign, async (req, res) => {
    try {
      const accountId = (req.query.accountId as string) || "default";
      if (!(await featureFlagService.isEnabled("lead_capture_enabled", accountId))) {
        return res.json({ stats: null, disabled: true });
      }
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const allLeads = await db.select().from(leads).where(eq(leads.accountId, accountId));
      const monthLeads = allLeads.filter(l => l.createdAt && l.createdAt >= monthStart);
      const converted = allLeads.filter(l => l.status === "converted");
      const totalRevenue = allLeads.reduce((sum, l) => sum + (l.revenue || 0), 0);

      res.json({
        stats: {
          totalLeads: allLeads.length,
          leadsThisMonth: monthLeads.length,
          conversionRate: allLeads.length > 0 ? (converted.length / allLeads.length * 100).toFixed(1) : 0,
          totalRevenue,
          byStatus: {
            new: allLeads.filter(l => l.status === "new").length,
            contacted: allLeads.filter(l => l.status === "contacted").length,
            qualified: allLeads.filter(l => l.status === "qualified").length,
            converted: converted.length,
            lost: allLeads.filter(l => l.status === "lost").length,
          },
        },
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
