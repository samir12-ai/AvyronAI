import type { Express, Request, Response } from "express";
import { GoogleGenAI } from "@google/genai";
import multer from "multer";
import { db } from "../db";
import { strategicBlueprints } from "@shared/schema";
import { eq } from "drizzle-orm";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const geminiAi = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY || "",
  httpOptions: {
    apiVersion: "",
    baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL || "",
  },
});

const EXTRACTION_PROMPT = `You are a campaign creative analysis engine. Analyze the provided media (video or image) and extract structured marketing intelligence.

Your tasks:
1. Auto-detect the language used in the creative
2. If video: transcribe all speech (multilingual support)
3. Extract all visible text (OCR)
4. Detect the offer being made
5. Detect the call-to-action (CTA)
6. Infer the positioning strategy: one of "premium", "discount", "authority", "convenience", or "value"
7. Infer the funnel stage: one of "awareness", "consideration", "conversion", "retention"
8. Infer the target audience
9. Detect any visible price

CRITICAL RULES:
- You MUST respond with ONLY a valid JSON object. No markdown, no explanation, no free text.
- Each field MUST have its own confidence score (0-100).
- If you cannot determine a field, set its value to "INSUFFICIENT_DATA" and its confidence to 0.
- NEVER guess or hallucinate. If unsure, mark as INSUFFICIENT_DATA.
- A field with confidence below 60 means the AI is NOT confident — the user must confirm.

Response format (strict JSON only):
{
  "detectedLanguage": "string",
  "transcribedText": "string or null",
  "ocrText": "string or null",
  "detectedOffer": { "value": "string or INSUFFICIENT_DATA", "confidence": 0-100 },
  "detectedPositioning": { "value": "premium|discount|authority|convenience|value|INSUFFICIENT_DATA", "confidence": 0-100 },
  "detectedCTA": { "value": "string or INSUFFICIENT_DATA", "confidence": 0-100 },
  "detectedAudienceGuess": { "value": "string or INSUFFICIENT_DATA", "confidence": 0-100 },
  "detectedFunnelStage": { "value": "awareness|consideration|conversion|retention|INSUFFICIENT_DATA", "confidence": 0-100 },
  "detectedPriceIfVisible": { "value": "number or null", "confidence": 0-100 }
}`;

function normalizeExtraction(raw: any): any {
  const fields = ["detectedOffer", "detectedPositioning", "detectedCTA", "detectedAudienceGuess", "detectedFunnelStage", "detectedPriceIfVisible"];
  const result: any = {
    detectedLanguage: raw.detectedLanguage || "unknown",
    transcribedText: raw.transcribedText || null,
    ocrText: raw.ocrText || null,
  };

  for (const field of fields) {
    const val = raw[field];
    if (val && typeof val === "object" && "value" in val && "confidence" in val) {
      result[field] = {
        value: val.value === null || val.value === undefined || val.value === "" ? "INSUFFICIENT_DATA" : val.value,
        confidence: typeof val.confidence === "number" ? Math.max(0, Math.min(100, val.confidence)) : 0,
      };
    } else if (val !== null && val !== undefined && val !== "" && val !== "null") {
      result[field] = { value: val, confidence: 50 };
    } else {
      result[field] = { value: "INSUFFICIENT_DATA", confidence: 0 };
    }

    if (result[field].value === "INSUFFICIENT_DATA") {
      result[field].confidence = 0;
    }
  }

  return result;
}

export function registerExtractionRoutes(app: Express) {
  app.post("/api/strategic/analyze-creative", upload.single("media"), async (req: Request, res: Response) => {
    try {
      const { blueprintId } = req.body;

      if (!blueprintId) {
        return res.status(400).json({ error: "blueprintId is required" });
      }

      const [blueprint] = await db.select().from(strategicBlueprints).where(eq(strategicBlueprints.id, blueprintId)).limit(1);
      if (!blueprint) {
        return res.status(404).json({ error: "Blueprint not found" });
      }

      if (!["GATE_PASSED", "EXTRACTION_COMPLETE", "ANALYSIS_COMPLETE"].includes(blueprint.status)) {
        return res.status(400).json({ error: "Blueprint must pass Phase 0 gate before creative analysis" });
      }

      if (!req.file) {
        return res.status(400).json({ error: "Media file is required (video or image)" });
      }

      const mimeType = req.file.mimetype;
      const base64Data = req.file.buffer.toString("base64");
      const isVideo = mimeType.startsWith("video/");
      const isImage = mimeType.startsWith("image/");

      if (!isVideo && !isImage) {
        return res.status(400).json({ error: "Only video and image files are supported" });
      }

      const parts: any[] = [
        { text: EXTRACTION_PROMPT },
        { inlineData: { data: base64Data, mimeType } },
      ];

      const response = await geminiAi.models.generateContent({
        model: "gemini-3-pro-preview",
        contents: [{ role: "user", parts }],
        config: { maxOutputTokens: 2048 },
      });

      const rawText = response.text || "";
      let rawAnalysis: any;

      try {
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          rawAnalysis = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("No JSON found in response");
        }
      } catch (parseErr) {
        console.error("[StrategicCore] Failed to parse AI extraction:", parseErr);
        return res.status(500).json({ error: "AI extraction returned invalid format. Please try again." });
      }

      const draftBlueprint = normalizeExtraction(rawAnalysis);

      await db.update(strategicBlueprints)
        .set({
          status: "EXTRACTION_COMPLETE",
          creativeMediaType: isVideo ? "video" : "image",
          draftBlueprint: JSON.stringify(draftBlueprint),
          creativeAnalysis: JSON.stringify(draftBlueprint),
          confirmedBlueprint: null,
          marketMap: null,
          validationResult: null,
          orchestratorPlan: null,
          analysisCompletedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(strategicBlueprints.id, blueprintId));

      res.json({
        success: true,
        blueprintId,
        status: "EXTRACTION_COMPLETE",
        draftBlueprint,
      });
    } catch (error: any) {
      console.error("[StrategicCore] Creative analysis error:", error.message);
      res.status(500).json({ error: "Failed to analyze creative. Please try again." });
    }
  });
}
