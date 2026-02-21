import type { Express, Request, Response } from "express";
import { db } from "../db";
import { strategicBlueprints } from "@shared/schema";
import { eq } from "drizzle-orm";

const LOW_CONFIDENCE_THRESHOLD = 60;

const CLARIFICATION_QUESTIONS: Record<string, string[]> = {
  detectedOffer: [
    "What specific offer or deal are you promoting in this campaign?",
    "Is there a discount, free trial, or special promotion involved?",
  ],
  detectedPositioning: [
    "How would you describe your brand's positioning — premium, value, discount, or authority?",
    "What makes your product stand out from competitors?",
  ],
  detectedCTA: [
    "What action do you want viewers to take after seeing this creative?",
    "Where should interested customers go — website, DM, link in bio?",
  ],
  detectedAudienceGuess: [
    "Who is the ideal customer for this campaign?",
    "What age range and interests describe your target audience?",
  ],
  detectedFunnelStage: [
    "Is this campaign for reaching new people, nurturing warm leads, or driving immediate sales?",
  ],
};

export function registerConfirmRoutes(app: Express) {
  app.put("/api/strategic/blueprint/:id/edit", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { fields } = req.body;

      const [blueprint] = await db.select().from(strategicBlueprints).where(eq(strategicBlueprints.id, id)).limit(1);
      if (!blueprint) {
        return res.status(404).json({ error: "Blueprint not found" });
      }

      if (!["EXTRACTION_COMPLETE", "ANALYSIS_COMPLETE"].includes(blueprint.status)) {
        return res.status(400).json({ error: "Blueprint must be in extraction or analysis state to edit" });
      }

      const currentAnalysis = blueprint.creativeAnalysis ? JSON.parse(blueprint.creativeAnalysis) : {};
      const updatedAnalysis = { ...currentAnalysis, ...fields };

      await db.update(strategicBlueprints)
        .set({
          creativeAnalysis: JSON.stringify(updatedAnalysis),
          validationResult: null,
          validatedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(strategicBlueprints.id, id));

      res.json({
        success: true,
        blueprintId: id,
        updatedFields: Object.keys(fields),
        creativeAnalysis: updatedAnalysis,
        validationCleared: true,
      });
    } catch (error: any) {
      console.error("[StrategicCore] Edit error:", error.message);
      res.status(500).json({ error: "Failed to update blueprint fields" });
    }
  });

  app.put("/api/strategic/blueprint/:id/confirm", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const [blueprint] = await db.select().from(strategicBlueprints).where(eq(strategicBlueprints.id, id)).limit(1);
      if (!blueprint) {
        return res.status(404).json({ error: "Blueprint not found" });
      }

      if (!["EXTRACTION_COMPLETE", "ANALYSIS_COMPLETE"].includes(blueprint.status)) {
        return res.status(400).json({ error: "Blueprint must complete extraction before confirmation" });
      }

      const analysis = blueprint.creativeAnalysis ? JSON.parse(blueprint.creativeAnalysis) : null;
      if (!analysis) {
        return res.status(400).json({ error: "No creative analysis found. Complete Phase 1 first." });
      }

      if (!blueprint.averageSellingPrice && !analysis.detectedPriceIfVisible) {
        return res.status(400).json({
          error: "GATE_FAILED",
          field: "price",
          message: "Price is required for confirmation. Either set average selling price or ensure price is visible in creative.",
        });
      }

      const competitorUrls = blueprint.competitorUrls ? JSON.parse(blueprint.competitorUrls) : [];
      if (competitorUrls.length < 2) {
        return res.status(400).json({
          error: "GATE_FAILED",
          field: "competitorUrls",
          message: "Minimum 2 competitor URLs required for confirmation.",
        });
      }

      const lowConfidenceFields: string[] = [];
      const clarificationPrompts: { field: string; questions: string[] }[] = [];

      if (analysis.confidenceScore < LOW_CONFIDENCE_THRESHOLD) {
        const fieldsToCheck = ["detectedOffer", "detectedPositioning", "detectedCTA", "detectedAudienceGuess", "detectedFunnelStage"];
        for (const field of fieldsToCheck) {
          if (!analysis[field] || analysis[field] === "null") {
            lowConfidenceFields.push(field);
            if (CLARIFICATION_QUESTIONS[field]) {
              clarificationPrompts.push({
                field,
                questions: CLARIFICATION_QUESTIONS[field],
              });
            }
          }
        }

        if (clarificationPrompts.length > 0) {
          return res.json({
            success: false,
            needsClarification: true,
            lowConfidenceFields,
            clarificationPrompts: clarificationPrompts.slice(0, 3),
            message: "Some fields need your input before confirmation.",
          });
        }
      }

      const confirmedData = {
        detectedOffer: analysis.detectedOffer,
        detectedPositioning: analysis.detectedPositioning,
        detectedCTA: analysis.detectedCTA,
        detectedAudienceGuess: analysis.detectedAudienceGuess,
        detectedFunnelStage: analysis.detectedFunnelStage,
        detectedPriceIfVisible: analysis.detectedPriceIfVisible,
        confidenceScore: analysis.confidenceScore,
        detectedLanguage: analysis.detectedLanguage,
        transcribedText: analysis.transcribedText,
        ocrText: analysis.ocrText,
        confirmedAt: new Date().toISOString(),
      };

      await db.update(strategicBlueprints)
        .set({
          status: "CONFIRMED",
          confirmedBlueprint: JSON.stringify(confirmedData),
          confirmedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(strategicBlueprints.id, id));

      res.json({
        success: true,
        blueprintId: id,
        status: "CONFIRMED",
        confirmedBlueprint: confirmedData,
      });
    } catch (error: any) {
      console.error("[StrategicCore] Confirm error:", error.message);
      res.status(500).json({ error: "Failed to confirm blueprint" });
    }
  });
}
