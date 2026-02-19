import type { Express } from "express";
import { db } from "../db";
import { landingPages, conversionEvents } from "@shared/schema";
import { eq, desc, sql } from "drizzle-orm";
import { featureFlagService } from "../feature-flags";
import { logAudit } from "../audit";

export function registerLandingPageRoutes(app: Express) {
  app.get("/api/landing-pages", async (req, res) => {
    try {
      const accountId = (req.query.accountId as string) || "default";
      if (!(await featureFlagService.isEnabled("landing_pages_enabled", accountId))) {
        return res.json({ pages: [], disabled: true });
      }
      const result = await db.select().from(landingPages)
        .where(eq(landingPages.accountId, accountId))
        .orderBy(desc(landingPages.createdAt));
      res.json({ pages: result });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/landing-pages", async (req, res) => {
    try {
      const accountId = req.body.accountId || "default";
      if (!(await featureFlagService.isEnabled("landing_pages_enabled", accountId))) {
        return res.status(403).json({ error: "Landing Pages module is not enabled" });
      }
      const { title, slug, headline, subheadline, bodyContent, ctaText, ctaUrl, formId, leadMagnetId, ctaVariantId, backgroundImage, colorScheme } = req.body;
      if (!title || !slug) {
        return res.status(400).json({ error: "title and slug are required" });
      }
      const existing = await db.select().from(landingPages).where(eq(landingPages.slug, slug)).limit(1);
      if (existing[0]) {
        return res.status(400).json({ error: "A page with this slug already exists" });
      }

      const inserted = await db.insert(landingPages).values({
        accountId, title, slug, headline, subheadline, bodyContent,
        ctaText, ctaUrl, formId, leadMagnetId, ctaVariantId,
        backgroundImage, colorScheme,
      }).returning();

      res.json({ page: inserted[0] });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/landing-pages/:id", async (req, res) => {
    try {
      const { title, headline, subheadline, bodyContent, ctaText, ctaUrl, formId, leadMagnetId, ctaVariantId, backgroundImage, colorScheme, isPublished } = req.body;
      const updates: any = { updatedAt: new Date() };
      if (title !== undefined) updates.title = title;
      if (headline !== undefined) updates.headline = headline;
      if (subheadline !== undefined) updates.subheadline = subheadline;
      if (bodyContent !== undefined) updates.bodyContent = bodyContent;
      if (ctaText !== undefined) updates.ctaText = ctaText;
      if (ctaUrl !== undefined) updates.ctaUrl = ctaUrl;
      if (formId !== undefined) updates.formId = formId;
      if (leadMagnetId !== undefined) updates.leadMagnetId = leadMagnetId;
      if (ctaVariantId !== undefined) updates.ctaVariantId = ctaVariantId;
      if (backgroundImage !== undefined) updates.backgroundImage = backgroundImage;
      if (colorScheme !== undefined) updates.colorScheme = colorScheme;
      if (isPublished !== undefined) {
        updates.isPublished = isPublished;
        if (isPublished) {
          const page = await db.select().from(landingPages).where(eq(landingPages.id, req.params.id)).limit(1);
          if (page[0]) {
            await logAudit(page[0].accountId, "LANDING_PAGE_PUBLISHED", {
              details: { pageId: req.params.id, slug: page[0].slug },
            });
          }
        }
      }

      const updated = await db.update(landingPages).set(updates)
        .where(eq(landingPages.id, req.params.id)).returning();
      res.json({ page: updated[0] });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/lp/:slug", async (req, res) => {
    try {
      const page = await db.select().from(landingPages)
        .where(eq(landingPages.slug, req.params.slug)).limit(1);
      if (!page[0] || !page[0].isPublished) {
        return res.status(404).json({ error: "Page not found" });
      }

      await db.update(landingPages).set({
        views: sql`${landingPages.views} + 1`,
      }).where(eq(landingPages.id, page[0].id));

      const convEnabled = await featureFlagService.isEnabled("conversion_tracking_enabled", page[0].accountId);
      if (convEnabled) {
        await db.insert(conversionEvents).values({
          accountId: page[0].accountId,
          eventType: "landing_page_view",
          landingPageId: page[0].id,
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
          referrer: req.headers.referer || null,
        });
      }

      res.json({ page: page[0] });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/landing-pages/:id", async (req, res) => {
    try {
      await db.delete(landingPages).where(eq(landingPages.id, req.params.id));
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
