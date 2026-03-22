import type { Express } from "express";
import { db } from "../db";
import { ctaVariants, conversionEvents } from "@shared/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { featureFlagService } from "../feature-flags";
import { logAudit } from "../audit";
import { aiChat } from "../ai-client";

export function registerCtaEngineRoutes(app: Express) {
  app.post("/api/cta-variants/generate", async (req, res) => {
    try {
      const accountId = req.body.accountId || "default";
      const check = await featureFlagService.checkWithDependencies("cta_engine_enabled", accountId);
      if (!check.enabled) {
        return res.status(403).json({ error: "CTA Engine is not enabled" });
      }

      const { postId, campaignId, contentContext, brandTone, count } = req.body;
      const numVariants = Math.min(count || 4, 8);

      const response = await aiChat({
        model: "gpt-5.2",
        messages: [
          {
            role: "system",
            content: `You are an expert conversion copywriter. Generate ${numVariants} different CTA (Call-to-Action) variants optimized for lead generation. Each CTA should be:
- Direct and action-oriented
- Create urgency or curiosity
- Be appropriate for the brand tone: ${brandTone || "professional"}
- Vary in approach (scarcity, social proof, value proposition, curiosity gap, direct benefit)

Return a JSON array of objects with fields: "text" (the CTA text), "type" (link/whatsapp/form), "approach" (the psychological approach used).`,
          },
          {
            role: "user",
            content: `Generate ${numVariants} CTA variants for this content context: ${contentContext || "general marketing post"}`,
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.8,
        max_tokens: 800,
        accountId,
        endpoint: "cta-generation",
      });

      const parsed = JSON.parse(response.choices[0]?.message?.content || "{}");
      const variants = parsed.variants || parsed.ctas || [];

      const inserted = [];
      for (let i = 0; i < variants.length; i++) {
        const v = variants[i];
        const result = await db.insert(ctaVariants).values({
          accountId,
          postId: postId || null,
          campaignId: campaignId || null,
          ctaText: v.text || v.cta || `CTA ${i + 1}`,
          ctaType: v.type || "link",
          abGroup: String.fromCharCode(65 + i),
          isActive: true,
        }).returning();
        inserted.push(result[0]);
      }

      await logAudit(accountId, "CTA_VARIANT_GENERATED", {
        details: { postId, count: inserted.length, safeMode: check.safeMode },
      });

      res.json({ variants: inserted, safeMode: check.safeMode, missingDependencies: check.missingDependencies });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/cta-variants", async (req, res) => {
    try {
      const accountId = (req as any).accountId || "default";
      if (!(await featureFlagService.isEnabled("cta_engine_enabled", accountId))) {
        return res.json({ variants: [], disabled: true });
      }
      const postId = req.query.postId as string;

      let result;
      if (postId) {
        result = await db.select().from(ctaVariants)
          .where(and(eq(ctaVariants.accountId, accountId), eq(ctaVariants.postId, postId)))
          .orderBy(desc(ctaVariants.conversionRate));
      } else {
        result = await db.select().from(ctaVariants)
          .where(eq(ctaVariants.accountId, accountId))
          .orderBy(desc(ctaVariants.createdAt))
          .limit(100);
      }
      res.json({ variants: result });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/cta-variants/serve/:postId", async (req, res) => {
    try {
      const postId = req.params.postId;
      const variants = await db.select().from(ctaVariants)
        .where(and(eq(ctaVariants.postId, postId), eq(ctaVariants.isActive, true)));

      if (variants.length === 0) {
        return res.json({ cta: null });
      }

      const winner = variants.find(v => v.isWinner);
      if (winner) {
        await db.update(ctaVariants).set({
          impressions: sql`${ctaVariants.impressions} + 1`,
        }).where(eq(ctaVariants.id, winner.id));
        return res.json({ cta: winner });
      }

      const randomIndex = Math.floor(Math.random() * variants.length);
      const selected = variants[randomIndex];
      await db.update(ctaVariants).set({
        impressions: sql`${ctaVariants.impressions} + 1`,
      }).where(eq(ctaVariants.id, selected.id));

      res.json({ cta: selected });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/cta-variants/:id/click", async (req, res) => {
    try {
      const variant = await db.select().from(ctaVariants)
        .where(eq(ctaVariants.id, req.params.id)).limit(1);
      if (!variant[0]) return res.status(404).json({ error: "CTA variant not found" });

      const accountId = variant[0].accountId;
      await db.update(ctaVariants).set({
        clicks: sql`${ctaVariants.clicks} + 1`,
        conversionRate: sql`CASE WHEN ${ctaVariants.impressions} > 0 THEN (${ctaVariants.clicks} + 1)::float / ${ctaVariants.impressions} * 100 ELSE 0 END`,
      }).where(eq(ctaVariants.id, req.params.id));

      const convEnabled = await featureFlagService.isEnabled("conversion_tracking_enabled", accountId);
      if (convEnabled) {
        await db.insert(conversionEvents).values({
          accountId, eventType: "cta_click", ctaVariantId: req.params.id,
          postId: variant[0].postId,
        });
      }

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/cta-variants/:id/convert", async (req, res) => {
    try {
      const variant = await db.select().from(ctaVariants)
        .where(eq(ctaVariants.id, req.params.id)).limit(1);
      if (!variant[0]) return res.status(404).json({ error: "CTA variant not found" });

      await db.update(ctaVariants).set({
        conversions: sql`${ctaVariants.conversions} + 1`,
        conversionRate: sql`CASE WHEN ${ctaVariants.impressions} > 0 THEN (${ctaVariants.conversions} + 1)::float / ${ctaVariants.impressions} * 100 ELSE 0 END`,
      }).where(eq(ctaVariants.id, req.params.id));

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/cta-variants/auto-promote", async (req, res) => {
    try {
      const accountId = req.body.accountId || "default";
      const check = await featureFlagService.checkWithDependencies("cta_engine_enabled", accountId);
      if (!check.enabled) {
        return res.status(403).json({ error: "CTA Engine is not enabled" });
      }
      if (check.safeMode) {
        return res.json({
          message: "CTA Engine is in safe mode - auto-promotion disabled. Enable conversion_tracking to unlock.",
          safeMode: true, missingDependencies: check.missingDependencies,
        });
      }

      const { postId, minImpressions } = req.body;
      const threshold = minImpressions || 50;

      const variants = await db.select().from(ctaVariants)
        .where(and(
          eq(ctaVariants.accountId, accountId),
          ...(postId ? [eq(ctaVariants.postId, postId)] : []),
          eq(ctaVariants.isActive, true),
        ));

      const qualified = variants.filter(v => (v.impressions || 0) >= threshold);
      if (qualified.length < 2) {
        return res.json({ message: "Not enough data for auto-promotion", promoted: null });
      }

      qualified.sort((a, b) => (b.conversionRate || 0) - (a.conversionRate || 0));
      const winner = qualified[0];

      await db.update(ctaVariants).set({ isWinner: true }).where(eq(ctaVariants.id, winner.id));

      const losers = qualified.filter(v => v.id !== winner.id && (v.conversionRate || 0) < (winner.conversionRate || 0) * 0.5);
      for (const loser of losers) {
        await db.update(ctaVariants).set({ isActive: false }).where(eq(ctaVariants.id, loser.id));
      }

      await logAudit(accountId, "CTA_AUTO_PROMOTED", {
        details: {
          winnerId: winner.id, winnerRate: winner.conversionRate,
          deactivated: losers.map(l => l.id),
        },
      });

      res.json({ promoted: winner, deactivated: losers.length });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
