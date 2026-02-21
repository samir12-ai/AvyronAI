import type { Express, Request, Response } from "express";
import { db } from "../db";
import { strategicBlueprints } from "@shared/schema";
import { eq } from "drizzle-orm";

const LOW_CONFIDENCE_THRESHOLD = 60;

const CRITICAL_FIELDS = ["detectedOffer", "detectedCTA", "detectedPositioning", "detectedAudienceGuess"];

const CLARIFICATION_QUESTIONS: Record<string, { label: string; questions: string[] }> = {
  detectedOffer: {
    label: "Offer",
    questions: [
      "What specific offer or deal are you promoting?",
      "Is there a discount, free trial, or special promotion?",
      "What does the customer get and at what terms?",
    ],
  },
  detectedCTA: {
    label: "Call to Action",
    questions: [
      "What action should viewers take after seeing this?",
      "Where should interested customers go — website, DM, or link in bio?",
      "What's the next step you want people to take?",
    ],
  },
  detectedPositioning: {
    label: "Positioning",
    questions: [
      "How would you describe your brand — premium, value, discount, or authority?",
      "What makes your product stand out from competitors?",
    ],
  },
  detectedAudienceGuess: {
    label: "Target Audience",
    questions: [
      "Who is the ideal customer for this campaign?",
      "What age range, interests, or demographics describe your target?",
    ],
  },
  detectedFunnelStage: {
    label: "Funnel Stage",
    questions: [
      "Is this for reaching new people, nurturing warm leads, or driving immediate sales?",
    ],
  },
};

function buildClarificationPrompts(draft: any): { field: string; label: string; currentValue: string; questions: string[] }[] {
  const prompts: { field: string; label: string; currentValue: string; questions: string[] }[] = [];

  for (const field of CRITICAL_FIELDS) {
    const fieldData = draft[field];
    if (!fieldData) continue;

    const isInsufficient = fieldData.value === "INSUFFICIENT_DATA";
    const isLowConfidence = typeof fieldData.confidence === "number" && fieldData.confidence < LOW_CONFIDENCE_THRESHOLD;

    if (isInsufficient || isLowConfidence) {
      const q = CLARIFICATION_QUESTIONS[field];
      if (q) {
        prompts.push({
          field,
          label: q.label,
          currentValue: isInsufficient ? "" : String(fieldData.value),
          questions: q.questions.slice(0, 3),
        });
      }
    }
  }

  return prompts.slice(0, 3);
}

export function registerConfirmRoutes(app: Express) {
  app.put("/api/strategic/blueprint/:id/edit", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { fields } = req.body;

      const [blueprint] = await db.select().from(strategicBlueprints).where(eq(strategicBlueprints.id, id)).limit(1);
      if (!blueprint) {
        return res.status(404).json({ error: "Blueprint not found" });
      }

      if (!["GATE_PASSED", "EXTRACTION_COMPLETE", "CONFIRMED", "ANALYSIS_COMPLETE", "VALIDATED"].includes(blueprint.status)) {
        return res.status(400).json({ error: "Blueprint must be in an editable state" });
      }

      const currentDraft = blueprint.draftBlueprint ? JSON.parse(blueprint.draftBlueprint) : {};

      for (const [key, value] of Object.entries(fields)) {
        if (currentDraft[key] && typeof currentDraft[key] === "object") {
          currentDraft[key] = { value, confidence: 100 };
        } else {
          currentDraft[key] = { value, confidence: 100 };
        }
      }

      const wasConfirmed = ["CONFIRMED", "ANALYSIS_COMPLETE", "VALIDATED"].includes(blueprint.status);

      const updateData: any = {
        draftBlueprint: JSON.stringify(currentDraft),
        creativeAnalysis: JSON.stringify(currentDraft),
        updatedAt: new Date(),
      };

      if (wasConfirmed) {
        updateData.status = "EXTRACTION_COMPLETE";
        updateData.confirmedBlueprint = null;
        updateData.confirmedAt = null;
        updateData.marketMap = null;
        updateData.validationResult = null;
        updateData.validatedAt = null;
        updateData.orchestratorPlan = null;
        updateData.orchestratedAt = null;
      }

      await db.update(strategicBlueprints)
        .set(updateData)
        .where(eq(strategicBlueprints.id, id));

      const clarifications = buildClarificationPrompts(currentDraft);

      res.json({
        success: true,
        blueprintId: id,
        updatedFields: Object.keys(fields),
        draftBlueprint: currentDraft,
        statusReset: wasConfirmed,
        resetReason: wasConfirmed ? "Edit after confirmation resets to EXTRACTION_COMPLETE. Re-confirm and re-validate required." : null,
        pendingClarifications: clarifications,
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

      if (!["GATE_PASSED", "EXTRACTION_COMPLETE"].includes(blueprint.status)) {
        return res.status(400).json({ error: "Blueprint must be in GATE_PASSED or EXTRACTION_COMPLETE state to confirm" });
      }

      const draft = blueprint.draftBlueprint ? JSON.parse(blueprint.draftBlueprint) : null;
      if (!draft) {
        return res.status(400).json({ error: "No draft blueprint found. Complete Phase 1 first." });
      }

      if (!blueprint.averageSellingPrice) {
        return res.status(400).json({
          error: "GATE_FAILED",
          field: "price",
          message: "Price is required for confirmation.",
        });
      }

      const competitorUrls = blueprint.competitorUrls ? JSON.parse(blueprint.competitorUrls) : [];
      if (competitorUrls.length < 2) {
        return res.status(400).json({
          error: "GATE_FAILED",
          field: "competitorUrls",
          message: "Minimum 2 competitor URLs required.",
        });
      }

      const clarifications = buildClarificationPrompts(draft);
      if (clarifications.length > 0) {
        return res.json({
          success: false,
          needsClarification: true,
          clarificationPrompts: clarifications,
          message: "Some critical fields have low confidence or insufficient data. Please provide input before confirming.",
        });
      }

      const confirmedData: any = {
        confirmedAt: new Date().toISOString(),
        detectedLanguage: draft.detectedLanguage,
        transcribedText: draft.transcribedText,
        ocrText: draft.ocrText,
      };

      const extractionFields = ["detectedOffer", "detectedPositioning", "detectedCTA", "detectedAudienceGuess", "detectedFunnelStage", "detectedPriceIfVisible"];
      for (const field of extractionFields) {
        const fieldData = draft[field];
        if (fieldData && typeof fieldData === "object" && "value" in fieldData) {
          confirmedData[field] = fieldData.value;
          confirmedData[field + "Confidence"] = fieldData.confidence;
        } else {
          confirmedData[field] = fieldData;
          confirmedData[field + "Confidence"] = 50;
        }
      }

      await db.update(strategicBlueprints)
        .set({
          status: "CONFIRMED",
          confirmedBlueprint: JSON.stringify(confirmedData),
          confirmedAt: new Date(),
          marketMap: null,
          validationResult: null,
          validatedAt: null,
          orchestratorPlan: null,
          orchestratedAt: null,
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
