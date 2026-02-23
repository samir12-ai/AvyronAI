import type { Express } from "express";
import { db } from "../db";
import { ciCompetitors } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { featureFlagService } from "../feature-flags";
import { analyzeInstagramProfile } from "./profile-analyzer";
import { getScrapeStats } from "./profile-scraper";

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

  app.post("/api/ci/competitors/analyze-profile", async (req, res) => {
    try {
      const { name, profileLink, enableCreativeCapture, saveFixtures } = req.body;

      if (!name || !profileLink) {
        return res.status(400).json({ error: "Company name and profile URL are required" });
      }

      if (!profileLink.includes("instagram.com")) {
        return res.status(400).json({ error: "Currently only Instagram profiles are supported for deterministic analysis." });
      }

      const result = await analyzeInstagramProfile(profileLink, name, {
        enableCreativeCapture: enableCreativeCapture !== false,
        saveFixtures: !!saveFixtures,
      });
      res.json(result);
    } catch (error: any) {
      console.error("Profile analysis error:", error);
      res.status(500).json({ error: "Profile analysis failed: " + (error.message || "Unknown error") });
    }
  });

  app.get("/api/ci/scrape-stats", async (_req, res) => {
    try {
      const stats = getScrapeStats();
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
