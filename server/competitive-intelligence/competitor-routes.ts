import type { Express } from "express";
import { db } from "../db";
import { ciCompetitors } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { featureFlagService } from "../feature-flags";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const REQUIRED_EVIDENCE_FIELDS = [
  "profileLink",
  "postingFrequency",
  "contentTypeRatio",
  "engagementRatio",
  "ctaPatterns",
] as const;

function validateEvidence(competitor: any): { complete: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!competitor.profileLink) missing.push("profileLink");
  if (competitor.postingFrequency == null || competitor.postingFrequency === "") missing.push("postingFrequency");
  if (!competitor.contentTypeRatio) missing.push("contentTypeRatio");
  if (competitor.engagementRatio == null || competitor.engagementRatio === "") missing.push("engagementRatio");
  if (!competitor.ctaPatterns) missing.push("ctaPatterns");
  return { complete: missing.length === 0, missing };
}

export function registerCiCompetitorRoutes(app: Express) {
  app.get("/api/ci/competitors", async (req, res) => {
    try {
      const accountId = (req.query.accountId as string) || "default";
      const enabled = await featureFlagService.isEnabled("competitive_intelligence_enabled", accountId);
      if (!enabled) {
        return res.json({ disabled: true, competitors: [] });
      }
      const competitors = await db.select().from(ciCompetitors)
        .where(and(eq(ciCompetitors.accountId, accountId), eq(ciCompetitors.isActive, true)))
        .orderBy(sql`${ciCompetitors.createdAt} DESC`);

      const enriched = competitors.map(c => {
        const validation = validateEvidence(c);
        return { ...c, evidenceComplete: validation.complete, missingFields: validation.missing };
      });
      res.json({ competitors: enriched });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/ci/competitors", async (req, res) => {
    try {
      const accountId = (req.body.accountId as string) || "default";
      const enabled = await featureFlagService.isEnabled("competitive_intelligence_enabled", accountId);
      if (!enabled) {
        return res.status(403).json({ error: "Competitive intelligence is disabled" });
      }

      const existing = await db.select().from(ciCompetitors)
        .where(and(eq(ciCompetitors.accountId, accountId), eq(ciCompetitors.isActive, true)));
      if (existing.length >= 5) {
        return res.status(400).json({ error: "Maximum 5 competitors allowed" });
      }

      const { name, platform, profileLink, businessType, primaryObjective,
        postingFrequency, contentTypeRatio, engagementRatio, ctaPatterns,
        discountFrequency, hookStyles, messagingTone, socialProofPresence,
        screenshotUrls, notes } = req.body;

      if (!name || !profileLink || !businessType || !primaryObjective) {
        return res.status(400).json({ error: "name, profileLink, businessType, primaryObjective are required" });
      }

      const [competitor] = await db.insert(ciCompetitors).values({
        accountId,
        name,
        platform: platform || "instagram",
        profileLink,
        businessType,
        primaryObjective,
        postingFrequency: postingFrequency != null ? parseInt(postingFrequency) : null,
        contentTypeRatio: contentTypeRatio || null,
        engagementRatio: engagementRatio != null ? parseFloat(engagementRatio) : null,
        ctaPatterns: ctaPatterns || null,
        discountFrequency: discountFrequency || null,
        hookStyles: hookStyles || null,
        messagingTone: messagingTone || null,
        socialProofPresence: socialProofPresence || null,
        screenshotUrls: screenshotUrls || null,
        notes: notes || null,
      }).returning();

      const validation = validateEvidence(competitor);
      res.json({ competitor: { ...competitor, evidenceComplete: validation.complete, missingFields: validation.missing } });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/ci/competitors/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const accountId = (req.body.accountId as string) || "default";
      const enabled = await featureFlagService.isEnabled("competitive_intelligence_enabled", accountId);
      if (!enabled) {
        return res.status(403).json({ error: "Competitive intelligence is disabled" });
      }

      const updates: any = { updatedAt: new Date() };
      const fields = ["name", "platform", "profileLink", "businessType", "primaryObjective",
        "postingFrequency", "contentTypeRatio", "engagementRatio", "ctaPatterns",
        "discountFrequency", "hookStyles", "messagingTone", "socialProofPresence",
        "screenshotUrls", "notes"];

      for (const f of fields) {
        if (req.body[f] !== undefined) {
          if (f === "postingFrequency") updates[f] = req.body[f] != null ? parseInt(req.body[f]) : null;
          else if (f === "engagementRatio") updates[f] = req.body[f] != null ? parseFloat(req.body[f]) : null;
          else updates[f] = req.body[f];
        }
      }

      const [updated] = await db.update(ciCompetitors)
        .set(updates)
        .where(and(eq(ciCompetitors.id, id), eq(ciCompetitors.accountId, accountId)))
        .returning();

      if (!updated) return res.status(404).json({ error: "Competitor not found" });

      const validation = validateEvidence(updated);
      res.json({ competitor: { ...updated, evidenceComplete: validation.complete, missingFields: validation.missing } });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/ci/competitors/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const accountId = (req.query.accountId as string) || "default";
      await db.update(ciCompetitors)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(ciCompetitors.id, id), eq(ciCompetitors.accountId, accountId)));
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/ci/competitors/:id/evidence", async (req, res) => {
    try {
      const { id } = req.params;
      const accountId = (req.query.accountId as string) || "default";
      const [competitor] = await db.select().from(ciCompetitors)
        .where(and(eq(ciCompetitors.id, id), eq(ciCompetitors.accountId, accountId)));
      if (!competitor) return res.status(404).json({ error: "Not found" });
      const validation = validateEvidence(competitor);
      res.json({
        competitorId: id,
        competitorName: competitor.name,
        evidenceComplete: validation.complete,
        missingFields: validation.missing,
        requiredFields: REQUIRED_EVIDENCE_FIELDS,
        data: {
          profileLink: competitor.profileLink,
          postingFrequency: competitor.postingFrequency,
          contentTypeRatio: competitor.contentTypeRatio,
          engagementRatio: competitor.engagementRatio,
          ctaPatterns: competitor.ctaPatterns,
          discountFrequency: competitor.discountFrequency,
          hookStyles: competitor.hookStyles,
          messagingTone: competitor.messagingTone,
          socialProofPresence: competitor.socialProofPresence,
          screenshotUrls: competitor.screenshotUrls,
        },
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/ci/competitors/auto-analyze", async (req, res) => {
    try {
      const { name, profileLink } = req.body;

      if (!name || !profileLink) {
        return res.status(400).json({ error: "Company name and profile URL are required" });
      }

      const platform = profileLink.includes("instagram") ? "instagram"
        : profileLink.includes("facebook") ? "facebook"
        : profileLink.includes("tiktok") ? "tiktok"
        : profileLink.includes("linkedin") ? "linkedin"
        : profileLink.includes("twitter") || profileLink.includes("x.com") ? "twitter"
        : "instagram";

      const prompt = `You are a competitive intelligence analyst specializing in social media marketing in the Middle East/Dubai market.

Given this competitor:
- Company Name: ${name}
- Profile URL: ${profileLink}
- Platform: ${platform}

Analyze this competitor's social media presence by examining their likely content strategy based on their brand, industry, and market positioning. Imagine you have reviewed their 3-5 most viral/top-performing posts.

Return a JSON object with these exact fields (no markdown, just raw JSON):
{
  "businessType": "string - their business category (e.g. Social Media Agency, E-commerce, F&B, Real Estate, Fashion, etc.)",
  "primaryObjective": "string - their main marketing goal (e.g. Lead Generation, Brand Awareness, Sales, Community Building)",
  "postingFrequency": "number - estimated posts per week (1-14)",
  "contentTypeRatio": "string - JSON string like {\"reels\":50,\"static\":30,\"stories\":20}",
  "engagementRatio": "number - estimated engagement rate as percentage (0.5-15.0)",
  "ctaPatterns": "string - their common call-to-action patterns, comma-separated",
  "discountFrequency": "string - how often they run promotions/offers",
  "hookStyles": "string - their content hook styles, comma-separated",
  "messagingTone": "string - their brand voice/tone description",
  "socialProofPresence": "string - types of social proof they use",
  "viralVideoInsights": "string - brief analysis of what makes their top content perform well, 2-3 sentences"
}

Be specific and data-driven in your estimates. Base your analysis on what is typical for this type of brand in the Dubai/MENA social media landscape.`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 1000,
        response_format: { type: "json_object" },
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        return res.status(500).json({ error: "AI analysis returned empty response" });
      }

      const analysis = JSON.parse(content);

      res.json({
        success: true,
        analysis: {
          name,
          profileLink,
          platform,
          businessType: analysis.businessType || "Social Media Marketing",
          primaryObjective: analysis.primaryObjective || "Brand Awareness",
          postingFrequency: String(analysis.postingFrequency || 5),
          contentTypeRatio: typeof analysis.contentTypeRatio === "string"
            ? analysis.contentTypeRatio
            : JSON.stringify(analysis.contentTypeRatio || { reels: 50, static: 30, stories: 20 }),
          engagementRatio: String(analysis.engagementRatio || 3.0),
          ctaPatterns: analysis.ctaPatterns || "",
          discountFrequency: analysis.discountFrequency || "",
          hookStyles: analysis.hookStyles || "",
          messagingTone: analysis.messagingTone || "",
          socialProofPresence: analysis.socialProofPresence || "",
          viralVideoInsights: analysis.viralVideoInsights || "",
        },
      });
    } catch (error: any) {
      console.error("Auto-analyze error:", error);
      res.status(500).json({ error: "AI analysis failed: " + (error.message || "Unknown error") });
    }
  });
}
