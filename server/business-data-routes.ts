import type { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { businessDataLayer, campaignSelections } from "@shared/schema";
import { eq, and } from "drizzle-orm";

const VALID_FUNNEL_OBJECTIVES = ["AWARENESS", "LEADS", "SALES", "AUTHORITY"] as const;
const VALID_CONVERSION_CHANNELS = ["WHATSAPP", "WEBSITE", "DM", "FORM"] as const;

const REQUIRED_FIELDS = [
  "businessLocation",
  "businessType",
  "coreOffer",
  "priceRange",
  "targetAudienceAge",
  "targetAudienceSegment",
  "monthlyBudget",
  "funnelObjective",
  "primaryConversionChannel",
] as const;

export function registerBusinessDataRoutes(app: Express) {
  app.get("/api/business-data/:campaignId", async (req: Request, res: Response) => {
    try {
      const { campaignId } = req.params;
      const accountId = (req.query.accountId as string) || "default";

      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      const rows = await db
        .select()
        .from(businessDataLayer)
        .where(
          and(
            eq(businessDataLayer.campaignId, campaignId),
            eq(businessDataLayer.accountId, accountId)
          )
        )
        .limit(1);

      if (rows.length === 0) {
        return res.json({ exists: false, data: null });
      }

      res.json({ exists: true, data: rows[0] });
    } catch (error: any) {
      console.error("[BusinessData] GET error:", error);
      res.status(500).json({ error: "Failed to fetch business data" });
    }
  });

  app.put("/api/business-data/:campaignId", async (req: Request, res: Response) => {
    try {
      const { campaignId } = req.params;
      const accountId = (req.body.accountId as string) || "default";

      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      const missing: string[] = [];
      for (const field of REQUIRED_FIELDS) {
        if (!req.body[field] || String(req.body[field]).trim() === "") {
          missing.push(field);
        }
      }

      if (missing.length > 0) {
        return res.status(400).json({
          error: "MISSING_FIELDS",
          message: `Missing required fields: ${missing.join(", ")}`,
          missingFields: missing,
        });
      }

      const funnelObjective = req.body.funnelObjective as string;
      if (!VALID_FUNNEL_OBJECTIVES.includes(funnelObjective as any)) {
        return res.status(400).json({
          error: "INVALID_FUNNEL_OBJECTIVE",
          message: `funnelObjective must be one of: ${VALID_FUNNEL_OBJECTIVES.join(", ")}`,
        });
      }

      const primaryConversionChannel = req.body.primaryConversionChannel as string;
      if (!VALID_CONVERSION_CHANNELS.includes(primaryConversionChannel as any)) {
        return res.status(400).json({
          error: "INVALID_CONVERSION_CHANNEL",
          message: `primaryConversionChannel must be one of: ${VALID_CONVERSION_CHANNELS.join(", ")}`,
        });
      }

      const dataValues = {
        businessLocation: req.body.businessLocation,
        businessType: req.body.businessType,
        coreOffer: req.body.coreOffer,
        priceRange: req.body.priceRange,
        targetAudienceAge: req.body.targetAudienceAge,
        targetAudienceSegment: req.body.targetAudienceSegment,
        monthlyBudget: req.body.monthlyBudget,
        funnelObjective,
        primaryConversionChannel,
        updatedAt: new Date(),
      };

      const existing = await db
        .select()
        .from(businessDataLayer)
        .where(
          and(
            eq(businessDataLayer.campaignId, campaignId),
            eq(businessDataLayer.accountId, accountId)
          )
        )
        .limit(1);

      let result;
      if (existing.length > 0) {
        const updated = await db
          .update(businessDataLayer)
          .set(dataValues)
          .where(
            and(
              eq(businessDataLayer.campaignId, campaignId),
              eq(businessDataLayer.accountId, accountId)
            )
          )
          .returning();
        result = updated[0];
      } else {
        const inserted = await db
          .insert(businessDataLayer)
          .values({
            campaignId,
            accountId,
            ...dataValues,
          })
          .returning();
        result = inserted[0];
      }

      console.log(`[BusinessData] Saved for campaign ${campaignId}, account ${accountId}`);
      res.json({ success: true, data: result });
    } catch (error: any) {
      console.error("[BusinessData] PUT error:", error);
      res.status(500).json({ error: "Failed to save business data" });
    }
  });
}

export async function requireBusinessData(req: Request, res: Response, next: NextFunction) {
  try {
    const accountId = (req.query.accountId as string) || (req.body?.accountId as string) || "default";

    const selections = await db
      .select()
      .from(campaignSelections)
      .where(eq(campaignSelections.accountId, accountId))
      .limit(1);

    if (selections.length === 0) {
      return res.status(400).json({
        error: "CAMPAIGN_REQUIRED",
        message: "No campaign selected. Please select a campaign first.",
      });
    }

    const campaignId = selections[0].selectedCampaignId;
    if (!campaignId) {
      return res.status(400).json({
        error: "CAMPAIGN_REQUIRED",
        message: "No campaign selected. Please select a campaign first.",
      });
    }

    const rows = await db
      .select()
      .from(businessDataLayer)
      .where(
        and(
          eq(businessDataLayer.campaignId, campaignId),
          eq(businessDataLayer.accountId, accountId)
        )
      )
      .limit(1);

    if (rows.length === 0) {
      return res.status(400).json({
        error: "BUSINESS_DATA_REQUIRED",
        message: "Business data must be completed before plan orchestration. Please fill in all business profile fields.",
        campaignId,
      });
    }

    (req as any).businessData = rows[0];
    next();
  } catch (error: any) {
    console.error("[BusinessData] Middleware error:", error);
    return res.status(500).json({ error: "Failed to validate business data" });
  }
}
