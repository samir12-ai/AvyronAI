import type { Express } from "express";
import { db } from "../db";
import { leadMagnets } from "@shared/schema";
import { eq, desc, sql } from "drizzle-orm";
import { featureFlagService } from "../feature-flags";
import { logAudit } from "../audit";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export function registerLeadMagnetRoutes(app: Express) {
  app.get("/api/lead-magnets", async (req, res) => {
    try {
      const accountId = (req.query.accountId as string) || "default";
      if (!(await featureFlagService.isEnabled("lead_magnet_enabled", accountId))) {
        return res.json({ magnets: [], disabled: true });
      }
      const result = await db.select().from(leadMagnets)
        .where(eq(leadMagnets.accountId, accountId))
        .orderBy(desc(leadMagnets.createdAt));
      res.json({ magnets: result });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/lead-magnets/generate", async (req, res) => {
    try {
      const accountId = req.body.accountId || "default";
      if (!(await featureFlagService.isEnabled("lead_magnet_enabled", accountId))) {
        return res.status(403).json({ error: "Lead Magnet Generator is not enabled" });
      }

      const { magnetType, topic, industry, targetAudience } = req.body;
      if (!magnetType || !topic) {
        return res.status(400).json({ error: "magnetType and topic are required" });
      }

      let prompt = "";
      if (magnetType === "guide") {
        prompt = `Create a comprehensive free guide/PDF outline for: "${topic}". Industry: ${industry || "general"}. Target audience: ${targetAudience || "business owners"}. Include: title, subtitle, 8-10 chapters with summaries, key takeaways, and a compelling description for the landing page. Return JSON with fields: "title", "subtitle", "description", "chapters" (array of {title, summary}), "keyTakeaways" (array of strings).`;
      } else if (magnetType === "discount") {
        prompt = `Generate a compelling discount/coupon offer for: "${topic}". Industry: ${industry || "general"}. Include: discount code, offer headline, terms, urgency message, and a compelling CTA. Return JSON with: "code", "headline", "description", "terms", "urgencyMessage", "ctaText".`;
      } else if (magnetType === "consultation") {
        prompt = `Create a free consultation offer for: "${topic}". Industry: ${industry || "general"}. Include: consultation title, what's included, duration, value proposition, booking CTA, and what they'll learn. Return JSON with: "title", "description", "includes" (array), "duration", "valueProposition", "ctaText".`;
      } else {
        prompt = `Create a lead magnet for: "${topic}". Type: ${magnetType}. Return JSON with: "title", "description", "content", "ctaText".`;
      }

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are an expert lead generation strategist. Create compelling lead magnets that drive conversions. Always return valid JSON." },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      });

      const generated = JSON.parse(response.choices[0]?.message?.content || "{}");
      const name = generated.title || generated.headline || `${magnetType} - ${topic}`;

      const inserted = await db.insert(leadMagnets).values({
        accountId, name, magnetType,
        content: JSON.stringify(generated),
        deliveryMethod: magnetType === "consultation" ? "email" : "download",
        discountCode: generated.code || null,
        offerDetails: generated.description || null,
      }).returning();

      await logAudit(accountId, "LEAD_MAGNET_GENERATED", {
        details: { magnetId: inserted[0].id, magnetType, topic },
      });

      res.json({ magnet: inserted[0], generated });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/lead-magnets/:id", async (req, res) => {
    try {
      const { name, content, deliveryMethod, downloadUrl, discountCode, offerDetails, isActive } = req.body;
      const updated = await db.update(leadMagnets).set({
        ...(name && { name }),
        ...(content && { content: typeof content === "string" ? content : JSON.stringify(content) }),
        ...(deliveryMethod && { deliveryMethod }),
        ...(downloadUrl !== undefined && { downloadUrl }),
        ...(discountCode !== undefined && { discountCode }),
        ...(offerDetails !== undefined && { offerDetails }),
        ...(isActive !== undefined && { isActive }),
        updatedAt: new Date(),
      }).where(eq(leadMagnets.id, req.params.id)).returning();
      res.json({ magnet: updated[0] });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/lead-magnets/:id/download", async (req, res) => {
    try {
      const magnet = await db.select().from(leadMagnets)
        .where(eq(leadMagnets.id, req.params.id)).limit(1);
      if (!magnet[0] || !magnet[0].isActive) {
        return res.status(404).json({ error: "Lead magnet not found or inactive" });
      }

      await db.update(leadMagnets).set({
        downloads: sql`${leadMagnets.downloads} + 1`,
      }).where(eq(leadMagnets.id, req.params.id));

      res.json({
        magnet: magnet[0],
        content: magnet[0].content ? JSON.parse(magnet[0].content) : null,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/lead-magnets/:id", async (req, res) => {
    try {
      await db.delete(leadMagnets).where(eq(leadMagnets.id, req.params.id));
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
