import type { Express } from "express";
import { db } from "../db";
import { ciCompetitors } from "@shared/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { featureFlagService } from "../feature-flags";
import { getCompetitorDataCoverage } from "./data-acquisition";

import { resolveAccountId } from "../auth";
import { assertCampaignBelongsTo, handleOwnershipError } from "../auth-helpers";
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
      const accountId = resolveAccountId(req);
      const campaignId = req.query.campaignId as string;
      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }
      const enabled = await featureFlagService.isEnabled("competitive_intelligence_enabled", accountId);
      if (!enabled) {
        return res.json({ disabled: true, competitors: [] });
      }
      const competitors = await db.select().from(ciCompetitors)
        .where(and(eq(ciCompetitors.accountId, accountId), eq(ciCompetitors.campaignId, campaignId), eq(ciCompetitors.isActive, true), eq(ciCompetitors.isDemo, false)))
        .orderBy(sql`${ciCompetitors.createdAt} DESC`);

      const ids = competitors.map(c => c.id);
      const extraUrlsMap: Record<string, { tiktokUrl: string | null; googleMapsUrl: string | null }> = {};
      if (ids.length > 0) {
        const extraRes = await db.execute(sql`SELECT id, tiktok_url, google_maps_url FROM ci_competitors WHERE id IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`);
        for (const row of extraRes.rows as any[]) {
          extraUrlsMap[row.id] = { tiktokUrl: row.tiktok_url ?? null, googleMapsUrl: row.google_maps_url ?? null };
        }
      }

      const enriched = await Promise.all(competitors.map(async c => {
        const validation = validateEvidence(c);
        const coverage = await getCompetitorDataCoverage(c.id, accountId);
        const extra = extraUrlsMap[c.id] ?? { tiktokUrl: null, googleMapsUrl: null };
        return {
          id: c.id,
          accountId: c.accountId,
          campaignId: c.campaignId,
          name: c.name,
          platform: c.platform,
          profileLink: c.profileLink,
          businessType: c.businessType,
          primaryObjective: c.primaryObjective,
          postingFrequency: c.postingFrequency,
          contentTypeRatio: c.contentTypeRatio,
          engagementRatio: c.engagementRatio,
          ctaPatterns: c.ctaPatterns,
          discountFrequency: c.discountFrequency,
          hookStyles: c.hookStyles,
          messagingTone: c.messagingTone,
          socialProofPresence: c.socialProofPresence,
          screenshotUrls: c.screenshotUrls,
          notes: c.notes,
          websiteUrl: c.websiteUrl,
          blogUrl: c.blogUrl,
          tiktokUrl: extra.tiktokUrl,
          googleMapsUrl: extra.googleMapsUrl,
          isActive: c.isActive,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
          evidenceComplete: validation.complete,
          missingFields: validation.missing,
          dataCoverage: coverage,
        };
      }));
      res.json({ competitors: enriched });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/ci/competitors", async (req, res) => {
    try {
      const accountId = resolveAccountId(req);
      const campaignId = req.body.campaignId as string;
      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }
      // P0-4 (launch-closure Wave 1): assert campaignId belongs to caller
      // before inserting competitor records under (accountId, campaignId).
      // Without this, attacker could create competitor entries pointing at
      // a victim's campaignId — strategic pollution surface.
      try { await assertCampaignBelongsTo(accountId, campaignId); }
      catch (e) { if (handleOwnershipError(e, res)) return; throw e; }

      const enabled = await featureFlagService.isEnabled("competitive_intelligence_enabled", accountId);
      if (!enabled) {
        return res.status(403).json({ error: "Competitive intelligence is disabled" });
      }

      const existing = await db.select().from(ciCompetitors)
        .where(and(eq(ciCompetitors.accountId, accountId), eq(ciCompetitors.campaignId, campaignId), eq(ciCompetitors.isActive, true)));
      if (existing.length >= 12) {
        return res.status(400).json({ error: "Maximum 12 competitors allowed per campaign" });
      }

      const { name, platform, profileLink, businessType, primaryObjective,
        postingFrequency, contentTypeRatio, engagementRatio, ctaPatterns,
        discountFrequency, hookStyles, messagingTone, socialProofPresence,
        screenshotUrls, notes, websiteUrl, blogUrl, tiktokUrl, googleMapsUrl, tier } = req.body;

      if (!name || !profileLink || !businessType || !primaryObjective) {
        return res.status(400).json({ error: "name, profileLink, businessType, primaryObjective are required" });
      }

      // Seal #5 / F8.1 — sanitize ALL user-supplied URLs before persistence.
      // Bad URLs become persisted attack surface (logged, fed to scrapers, fed
      // to LLM context). Reject up-front. Empty/null are allowed (optional fields).
      // Seal #5 / F8.1 (validator-#4 closure): typed sanitized URL bag
      // replaces the prior `(req.body as any)` mutation pattern. Casts to
      // `any` in security-sensitive paths are forbidden by review policy —
      // they erase type protection on the very fields that need it most.
      type SanitizedUrls = {
        profileLink: string;
        websiteUrl: string | null;
        blogUrl: string | null;
        tiktokUrl: string | null;
        googleMapsUrl: string | null;
      };
      const { validateUserUrl } = await import("./scrape-safety");
      let safeUrls: SanitizedUrls;
      try {
        safeUrls = {
          profileLink: validateUserUrl(profileLink),
          websiteUrl: websiteUrl ? validateUserUrl(websiteUrl) : null,
          blogUrl: blogUrl ? validateUserUrl(blogUrl) : null,
          tiktokUrl: tiktokUrl ? validateUserUrl(tiktokUrl) : null,
          googleMapsUrl: googleMapsUrl ? validateUserUrl(googleMapsUrl) : null,
        };
      } catch (urlErr: any) {
        return res.status(400).json({ error: `Invalid URL: ${urlErr.message}` });
      }
      // F7.8 — accept optional tier ('A'|'B'); default 'B'. Tier-A competitors
      // refresh on a 24h cooldown (priority); tier-B on the standard 72h.
      const tierValue = tier === "A" ? "A" : "B";

      const [competitor] = await db.insert(ciCompetitors).values({
        accountId,
        campaignId,
        name,
        platform: platform || "instagram",
        profileLink: safeUrls.profileLink,
        businessType,
        primaryObjective,
        postingFrequency: postingFrequency !== undefined && postingFrequency !== null && postingFrequency !== '' ? (isNaN(parseInt(postingFrequency)) ? null : parseInt(postingFrequency)) : null,
        contentTypeRatio: contentTypeRatio || null,
        engagementRatio: engagementRatio !== undefined && engagementRatio !== null && engagementRatio !== '' ? (isNaN(parseFloat(engagementRatio)) ? null : parseFloat(engagementRatio)) : null,
        ctaPatterns: ctaPatterns || null,
        discountFrequency: discountFrequency || null,
        hookStyles: hookStyles || null,
        messagingTone: messagingTone || null,
        socialProofPresence: socialProofPresence || null,
        screenshotUrls: screenshotUrls || null,
        notes: notes || null,
        websiteUrl: safeUrls.websiteUrl,
        blogUrl: safeUrls.blogUrl,
        tiktokUrl: safeUrls.tiktokUrl,
        googleMapsUrl: safeUrls.googleMapsUrl,
        tier: tierValue,
        isDemo: false,
        enrichmentStatus: "PENDING",
        fetchMethod: null,
        postsCollected: 0,
        commentsCollected: 0,
        dataFreshnessDays: null,
      }).returning();

      // Seal #5 / F8.1 (architect-#10 fix): the post-insert raw SQL update
      // previously used the UNSANITIZED `tiktokUrl`/`googleMapsUrl` from the
      // closure, re-introducing attack surface. Use the sanitized values that
      // validateUserUrl already verified. Insert above also writes these
      // fields, so this update is now defensive-only.
      const safeTiktok = safeUrls.tiktokUrl;
      const safeMaps = safeUrls.googleMapsUrl;
      if (safeTiktok || safeMaps) {
        await db.execute(sql`UPDATE ci_competitors SET tiktok_url = ${safeTiktok}, google_maps_url = ${safeMaps} WHERE id = ${competitor.id}`);
      }

      const validation = validateEvidence(competitor);
      res.json({ competitor: { ...competitor, tiktokUrl: safeTiktok, googleMapsUrl: safeMaps, evidenceComplete: validation.complete, missingFields: validation.missing } });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/ci/competitors/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const accountId = resolveAccountId(req);
      // Body-level campaignId ownership is asserted just-in-time below,
      // immediately after the campaignId is parsed off req.body. The PUT
      // mutates `ci_competitors` rows and the WHERE clause also filters by
      // accountId+campaignId, but explicit assert is required by W5 doctrine.
      const enabled = await featureFlagService.isEnabled("competitive_intelligence_enabled", accountId);
      if (!enabled) {
        return res.status(403).json({ error: "Competitive intelligence is disabled" });
      }

      // Seal #5 / F8.1 (architect-#10 fix): validate URL fields on PUT path
      // too. Previously POST validated but PUT wrote raw user input.
      const { validateUserUrl: _validateUserUrlPut } = await import("./scrape-safety");
      const URL_FIELDS = new Set(["profileLink", "websiteUrl", "blogUrl", "tiktokUrl", "googleMapsUrl"]);

      const updates: any = { updatedAt: new Date() };
      const fields = ["name", "platform", "profileLink", "businessType", "primaryObjective",
        "postingFrequency", "contentTypeRatio", "engagementRatio", "ctaPatterns",
        "discountFrequency", "hookStyles", "messagingTone", "socialProofPresence",
        "screenshotUrls", "notes", "websiteUrl", "blogUrl", "tiktokUrl", "googleMapsUrl"];

      for (const f of fields) {
        if (req.body[f] !== undefined) {
          if (f === "postingFrequency") { const v = req.body[f]; updates[f] = v !== undefined && v !== null && v !== '' ? (isNaN(parseInt(v)) ? null : parseInt(v)) : null; }
          else if (f === "engagementRatio") { const v = req.body[f]; updates[f] = v !== undefined && v !== null && v !== '' ? (isNaN(parseFloat(v)) ? null : parseFloat(v)) : null; }
          else if (URL_FIELDS.has(f)) {
            const raw = req.body[f];
            if (raw === null || raw === "" || raw === undefined) {
              updates[f] = null;
            } else {
              try { updates[f] = _validateUserUrlPut(raw); }
              catch (urlErr: any) { return res.status(400).json({ error: `Invalid URL on ${f}: ${urlErr.message}` }); }
            }
          }
          else updates[f] = req.body[f];
        }
      }

      const campaignId = req.body.campaignId as string;
      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      // W5 (architect re-review #6): explicit ownership assert at the boundary.
      // The UPDATE WHERE clause below also filters by accountId AND campaignId,
      // but strict doctrine requires explicit ownership truth before any
      // tenant-scoped DB mutation.
      try {
        await assertCampaignBelongsTo(accountId, campaignId);
      } catch (e) {
        if (handleOwnershipError(e, res)) return;
        throw e;
      }

      const [updated] = await db.update(ciCompetitors)
        .set(updates)
        .where(and(eq(ciCompetitors.id, id), eq(ciCompetitors.accountId, accountId), eq(ciCompetitors.campaignId, campaignId)))
        .returning();

      if (!updated) return res.status(404).json({ error: "Competitor not found" });

      // Seal #5 / F8.1 (validator-#2 fix): use SANITIZED `updates` values
      // (already through validateUserUrl above), not raw req.body, so the
      // post-update sync cannot reintroduce non-canonical input.
      const hasTiktok = req.body.tiktokUrl !== undefined;
      const hasGmaps = req.body.googleMapsUrl !== undefined;
      const safeTiktokPut = updates.tiktokUrl ?? null;
      const safeGmapsPut = updates.googleMapsUrl ?? null;
      if (hasTiktok && hasGmaps) {
        await db.execute(sql`UPDATE ci_competitors SET tiktok_url = ${safeTiktokPut}, google_maps_url = ${safeGmapsPut} WHERE id = ${id}`);
      } else if (hasTiktok) {
        await db.execute(sql`UPDATE ci_competitors SET tiktok_url = ${safeTiktokPut} WHERE id = ${id}`);
      } else if (hasGmaps) {
        await db.execute(sql`UPDATE ci_competitors SET google_maps_url = ${safeGmapsPut} WHERE id = ${id}`);
      }
      const extraRes = await db.execute(sql`SELECT tiktok_url, google_maps_url FROM ci_competitors WHERE id = ${id}`);
      const extra = (extraRes.rows as any[])[0] ?? {};

      const validation = validateEvidence(updated);
      res.json({ competitor: { ...updated, tiktokUrl: extra.tiktok_url ?? null, googleMapsUrl: extra.google_maps_url ?? null, evidenceComplete: validation.complete, missingFields: validation.missing } });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/ci/competitors/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const accountId = resolveAccountId(req);
      const campaignId = req.query.campaignId as string;
      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }
      await db.update(ciCompetitors)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(ciCompetitors.id, id), eq(ciCompetitors.accountId, accountId), eq(ciCompetitors.campaignId, campaignId)));
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/ci/competitors/:id/evidence", async (req, res) => {
    try {
      const { id } = req.params;
      const accountId = resolveAccountId(req);
      const campaignId = req.query.campaignId as string;
      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }
      const [competitor] = await db.select().from(ciCompetitors)
        .where(and(eq(ciCompetitors.id, id), eq(ciCompetitors.accountId, accountId), eq(ciCompetitors.campaignId, campaignId)));
      if (!competitor) return res.status(404).json({ error: "Not found" });
      const validation = validateEvidence(competitor);
      res.json({
        competitorId: id,
        competitorName: competitor.name,
        evidenceComplete: validation.complete,
        missingFields: validation.missing,
        requiredFields: REQUIRED_EVIDENCE_FIELDS,
        inventory: {
          postsCollected: competitor.postsCollected || 0,
          commentsCollected: competitor.commentsCollected || 0,
          dataFreshnessDays: competitor.dataFreshnessDays,
        },
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
