import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "./db";
import { businessDataLayer, campaignSelections } from "@shared/schema";
import { eq, and } from "drizzle-orm";

import { resolveAccountId } from "./auth";
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

// P1-22 (W4.1 launch-closure): Zod schema replaces ad-hoc string-walk
// validation. Required fields enforced as non-empty strings; enum fields
// enforced via z.enum; optional descriptive fields kept as plain strings.
const businessDataPutSchema = z.object({
  businessLocation: z.string().trim().min(1),
  businessType: z.string().trim().min(1),
  coreOffer: z.string().trim().min(1),
  priceRange: z.string().trim().min(1),
  targetAudienceAge: z.string().trim().min(1),
  targetAudienceSegment: z.string().trim().min(1),
  monthlyBudget: z.string().trim().min(1),
  funnelObjective: z.enum(VALID_FUNNEL_OBJECTIVES),
  primaryConversionChannel: z.enum(VALID_CONVERSION_CHANNELS),
  productCategory: z.string().optional(),
  coreProblemSolved: z.string().optional(),
  uniqueMechanism: z.string().optional(),
  strategicAdvantage: z.string().optional(),
  targetDecisionMaker: z.string().optional(),
  goalTarget: z.string().optional(),
  goalTimeline: z.string().optional(),
  goalDescription: z.string().optional(),
}).strict();

export function registerBusinessDataRoutes(app: Express) {
  app.get("/api/business-data/:campaignId", async (req: Request, res: Response) => {
    try {
      const { campaignId } = req.params;
      const accountId = resolveAccountId(req);

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
      const accountId = resolveAccountId(req);

      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      const parsed = businessDataPutSchema.safeParse(req.body);
      if (!parsed.success) {
        const issues = parsed.error.issues;
        const missing = issues
          .filter((i) => i.code === "invalid_type" || i.code === "too_small")
          .map((i) => i.path.join("."));
        return res.status(400).json({
          error: "VALIDATION_FAILED",
          message: issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
          missingFields: missing.length > 0 ? missing : undefined,
          issues,
        });
      }
      const body = parsed.data;
      const dataValues: Record<string, any> = {
        ...body,
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
    const accountId = resolveAccountId(req);

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
