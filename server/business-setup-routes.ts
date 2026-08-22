import type { Express, Request, Response } from "express";
import { z } from "zod";
import { db } from "./db";
import { 
  offeringInputEvidence, 
  campaignOfferings, 
  websiteSnapshots 
} from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { resolveAccountId } from "./auth";
import { assertCampaignBelongsTo, handleOwnershipError } from "./auth-helpers";

const businessSetupSchema = z.object({
  websiteUrl: z.string().trim().min(1),
  campaignOfferingName: z.string().trim().min(1),
  offeringFeaturesAndNotes: z.string().trim().min(1),
});

export function registerBusinessSetupRoutes(app: Express) {
  app.get("/api/business-setup/:campaignId", async (req: Request, res: Response) => {
    try {
      const { campaignId } = req.params;
      const accountId = resolveAccountId(req);

      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      try { await assertCampaignBelongsTo(accountId, campaignId); }
      catch (e) { if (handleOwnershipError(e, res)) return; throw e; }

      // We load the data from campaignOfferings + offeringInputEvidence + websiteSnapshots
      const offering = await db
        .select()
        .from(campaignOfferings)
        .where(and(eq(campaignOfferings.campaignId, campaignId), eq(campaignOfferings.accountId, accountId)))
        .limit(1);

      if (offering.length === 0) {
        return res.json({ exists: false, data: null });
      }

      const evidence = await db
        .select()
        .from(offeringInputEvidence)
        .where(eq(offeringInputEvidence.id, offering[0].sourceInputEvidenceId))
        .limit(1);
        
      const website = await db
        .select()
        .from(websiteSnapshots)
        .where(and(eq(websiteSnapshots.campaignId, campaignId), eq(websiteSnapshots.accountId, accountId)))
        .limit(1);

      res.json({
        exists: true,
        data: {
          websiteUrl: website[0]?.rootUrl || "",
          campaignOfferingName: offering[0]?.offeringName || "",
          offeringFeaturesAndNotes: evidence[0]?.rawFeaturesAndNotes || "",
        }
      });
    } catch (error: any) {
      console.error("[BusinessSetup] GET error:", error);
      res.status(500).json({ error: "Failed to fetch business setup data" });
    }
  });

  app.post("/api/business-setup/:campaignId", async (req: Request, res: Response) => {
    try {
      const { campaignId } = req.params;
      const accountIdForAssert = resolveAccountId(req);
      try { await assertCampaignBelongsTo(accountIdForAssert, campaignId); }
      catch (e) { if (handleOwnershipError(e, res)) return; throw e; }
      
      const accountId = resolveAccountId(req);
      const parsed = businessSetupSchema.safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({
          error: "VALIDATION_FAILED",
          message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        });
      }
      
      const { websiteUrl, campaignOfferingName, offeringFeaturesAndNotes } = parsed.data;

      // 1. Create OfferingInputEvidence
      const evidence = await db.insert(offeringInputEvidence).values({
        accountId,
        campaignId,
        campaignOfferingId: "temp_offering_id", // Will update after offering is created
        rawOfferingName: campaignOfferingName,
        rawFeaturesAndNotes: offeringFeaturesAndNotes,
        contentHash: "TODO_HASH",
      }).returning();
      
      const evidenceId = evidence[0].id;
      
      // 2. Create campaignOfferingId immediately
      const offering = await db.insert(campaignOfferings).values({
        accountId,
        campaignId,
        offeringName: campaignOfferingName,
        sourceInputEvidenceId: evidenceId,
      }).returning();
      
      const offeringId = offering[0].id;
      
      // Update evidence with real offeringId
      await db.update(offeringInputEvidence)
        .set({ campaignOfferingId: offeringId })
        .where(eq(offeringInputEvidence.id, evidenceId));
        
      // 3. Save lightweight website snapshot placeholder
      // (The actual crawl happens asynchronously or in next step)
      await db.insert(websiteSnapshots).values({
        accountId,
        campaignId,
        rootUrl: websiteUrl,
        pagesCrawled: [],
        contentHash: "PENDING",
        status: "PENDING",
      });

      console.log(`[BusinessSetup] Saved for campaign ${campaignId}, account ${accountId}`);
      res.json({ success: true, data: { campaignOfferingId: offeringId } });
    } catch (error: any) {
      console.error("[BusinessSetup] POST error:", error);
      res.status(500).json({ error: "Failed to save business setup data" });
    }
  });
}
