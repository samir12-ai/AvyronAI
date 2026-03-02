import type { Express } from "express";
import { db } from "../db";
import { ciCompetitors } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { featureFlagService } from "../feature-flags";
import { getCompetitorDataCoverage } from "./data-acquisition";

const REQUIRED_EVIDENCE_FIELDS = [
  "profileLink",
  "postingFrequency",
  "contentTypeRatio",
  "engagementRatio",
] as const;

function validateEvidence(competitor: any): { complete: boolean; missing: string[]; meetsMinimum: boolean } {
  const missing: string[] = [];
  const coreMissing: string[] = [];
  if (competitor.postingFrequency == null || competitor.postingFrequency === "") { missing.push("postingFrequency"); coreMissing.push("postingFrequency"); }
  if (!competitor.contentTypeRatio) { missing.push("contentTypeRatio"); coreMissing.push("contentTypeRatio"); }
  if (competitor.engagementRatio == null || competitor.engagementRatio === "") { missing.push("engagementRatio"); coreMissing.push("engagementRatio"); }
  if (!competitor.profileLink) missing.push("profileLink");
  if (!competitor.ctaPatterns) missing.push("ctaPatterns");
  if (!competitor.hookStyles) missing.push("hookStyles");
  if (!competitor.messagingTone) missing.push("messagingTone");
  return { complete: missing.length === 0, missing, meetsMinimum: coreMissing.length === 0 };
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
        .where(and(eq(ciCompetitors.accountId, accountId), eq(ciCompetitors.isActive, true), eq(ciCompetitors.isDemo, false)))
        .orderBy(sql`${ciCompetitors.createdAt} DESC`);

      const enriched = await Promise.all(competitors.map(async c => {
        const validation = validateEvidence(c);
        const coverage = await getCompetitorDataCoverage(c.id, accountId);
        return { ...c, evidenceComplete: validation.complete, missingFields: validation.missing, dataCoverage: coverage };
      }));
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

  app.post("/api/ci/competitors/analyze-profile", (_req, res) => {
    res.status(410).json({ error: "DEPRECATED: Use the data acquisition system instead. Add competitor, then POST /api/ci/competitors/:id/fetch-data" });
  });

  app.post("/api/ci/generate-scripts", (_req, res) => {
    res.status(410).json({ error: "DEPRECATED: Script generation is no longer available via this endpoint." });
  });
}
