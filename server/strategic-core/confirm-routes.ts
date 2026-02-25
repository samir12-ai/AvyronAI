import type { Express, Request, Response } from "express";
import { db } from "../db";
import { strategicBlueprints, blueprintVersions } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { logAuditEvent } from "./audit-logger";

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

async function snapshotVersion(blueprint: any): Promise<string | null> {
  try {
    const currentVersion = blueprint.blueprintVersion || 1;
    const [snapshot] = await db.insert(blueprintVersions).values({
      blueprintId: blueprint.id,
      version: currentVersion,
      accountId: blueprint.accountId,
      campaignId: blueprint.campaignId,
      campaignContext: blueprint.campaignContext,
      confirmedBlueprint: blueprint.confirmedBlueprint,
      draftBlueprint: blueprint.draftBlueprint,
      competitorUrls: blueprint.competitorUrls,
      averageSellingPrice: blueprint.averageSellingPrice,
      marketMap: blueprint.marketMap,
      validationResult: blueprint.validationResult,
      orchestratorPlan: blueprint.orchestratorPlan,
    }).returning();
    return snapshot.id;
  } catch (err: any) {
    console.error("[StrategicCore] Version snapshot error:", err.message);
    return null;
  }
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

      if (!["GATE_PASSED", "EXTRACTION_COMPLETE", "EXTRACTION_FALLBACK", "CONFIRMED", "ANALYSIS_COMPLETE", "VALIDATED"].includes(blueprint.status)) {
        return res.status(400).json({ error: "Blueprint must be in an editable state" });
      }

      const currentDraft = blueprint.draftBlueprint ? JSON.parse(blueprint.draftBlueprint) : {};
      const previousValues: Record<string, any> = {};

      for (const [key, value] of Object.entries(fields)) {
        const oldVal = currentDraft[key];
        previousValues[key] = oldVal ? (typeof oldVal === "object" ? oldVal.value : oldVal) : null;
        currentDraft[key] = { value, confidence: 100 };
      }

      const wasConfirmed = ["CONFIRMED", "ANALYSIS_COMPLETE", "VALIDATED"].includes(blueprint.status);

      let newVersion = blueprint.blueprintVersion || 1;
      let previousVersionId: string | null = null;

      if (wasConfirmed) {
        previousVersionId = await snapshotVersion(blueprint);
        newVersion = (blueprint.blueprintVersion || 1) + 1;
      }

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
        updateData.blueprintVersion = newVersion;
      }

      await db.update(strategicBlueprints)
        .set(updateData)
        .where(eq(strategicBlueprints.id, id));

      for (const [fieldName, newValue] of Object.entries(fields)) {
        await logAuditEvent({
          accountId: blueprint.accountId,
          campaignId: blueprint.campaignId || undefined,
          blueprintId: id,
          blueprintVersion: newVersion,
          event: "FIELD_EDITED",
          details: { field: fieldName, previousValue: previousValues[fieldName], newValue },
        });
      }

      if (wasConfirmed) {
        await logAuditEvent({
          accountId: blueprint.accountId,
          campaignId: blueprint.campaignId || undefined,
          blueprintId: id,
          blueprintVersion: newVersion,
          event: "BLUEPRINT_RESET",
          details: {
            previousVersion: blueprint.blueprintVersion,
            newVersion,
            previousVersionSnapshotId: previousVersionId,
            reason: "Edit after confirmation",
          },
        });
      }

      const clarifications = buildClarificationPrompts(currentDraft);

      res.json({
        success: true,
        blueprintId: id,
        blueprintVersion: newVersion,
        updatedFields: Object.keys(fields),
        draftBlueprint: currentDraft,
        statusReset: wasConfirmed,
        resetReason: wasConfirmed ? "Edit after confirmation resets to EXTRACTION_COMPLETE. Re-confirm and re-validate required." : null,
        previousVersionId,
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

      if (!["GATE_PASSED", "EXTRACTION_COMPLETE", "EXTRACTION_FALLBACK"].includes(blueprint.status)) {
        return res.status(400).json({ error: "Blueprint must be in GATE_PASSED, EXTRACTION_COMPLETE, or EXTRACTION_FALLBACK state to confirm" });
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
      if (competitorUrls.length < 1) {
        return res.status(400).json({
          error: "GATE_FAILED",
          field: "competitorUrls",
          message: "At least 1 competitor is required.",
        });
      }

      const currentVersion = blueprint.blueprintVersion || 1;

      const confirmedData: any = {
        confirmedAt: new Date().toISOString(),
        blueprintVersion: currentVersion,
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

      const clarifications = buildClarificationPrompts(draft);

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

      await logAuditEvent({
        accountId: blueprint.accountId,
        campaignId: blueprint.campaignId || undefined,
        blueprintId: id,
        blueprintVersion: currentVersion,
        event: "BLUEPRINT_CONFIRMED",
        details: {
          version: currentVersion,
          hasWeakFields: clarifications.length > 0,
          weakFieldCount: clarifications.length,
        },
      });

      res.json({
        success: true,
        blueprintId: id,
        blueprintVersion: currentVersion,
        status: "CONFIRMED",
        confirmedBlueprint: confirmedData,
        warnings: clarifications.length > 0 ? {
          message: "Blueprint confirmed with weak fields. Orchestrator will refuse execution if required fields are missing or INSUFFICIENT_DATA.",
          weakFields: clarifications,
        } : null,
      });
    } catch (error: any) {
      console.error("[StrategicCore] Confirm error:", error.message);
      res.status(500).json({ error: "Failed to confirm blueprint" });
    }
  });
}
