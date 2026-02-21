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

You MUST respond with ONLY a valid JSON object. No markdown, no explanation, no free text.

If you cannot determine a field with confidence, still include it but lower the confidenceScore.
If a field is completely undetectable, use null for its value.

Response format (strict JSON only):
{
  "detectedLanguage": "string",
  "transcribedText": "string or null",
  "ocrText": "string or null",
  "detectedOffer": "string or null",
  "detectedPositioning": "premium | discount | authority | convenience | value",
  "detectedCTA": "string or null",
  "detectedAudienceGuess": "string or null",
  "detectedFunnelStage": "awareness | consideration | conversion | retention",
  "detectedPriceIfVisible": "number or null",
  "confidenceScore": 0-100
}`;

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
        {
          inlineData: {
            data: base64Data,
            mimeType,
          },
        },
      ];

      const response = await geminiAi.models.generateContent({
        model: "gemini-3-pro-preview",
        contents: [{ role: "user", parts }],
        config: { maxOutputTokens: 2048 },
      });

      const rawText = response.text || "";
      let analysis: any;

      try {
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          analysis = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("No JSON found in response");
        }
      } catch (parseErr) {
        console.error("[StrategicCore] Failed to parse AI extraction:", parseErr);
        return res.status(500).json({ error: "AI extraction returned invalid format. Please try again." });
      }

      const requiredFields = [
        "detectedOffer", "detectedPositioning", "detectedCTA",
        "detectedAudienceGuess", "detectedFunnelStage", "detectedPriceIfVisible",
        "confidenceScore",
      ];

      for (const field of requiredFields) {
        if (!(field in analysis)) {
          analysis[field] = null;
        }
      }

      if (typeof analysis.confidenceScore !== "number") {
        analysis.confidenceScore = 30;
      }

      await db.update(strategicBlueprints)
        .set({
          status: "EXTRACTION_COMPLETE",
          creativeMediaType: isVideo ? "video" : "image",
          creativeAnalysis: JSON.stringify(analysis),
          analysisCompletedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(strategicBlueprints.id, blueprintId));

      res.json({
        success: true,
        blueprintId,
        status: "EXTRACTION_COMPLETE",
        creativeAnalysis: analysis,
      });
    } catch (error: any) {
      console.error("[StrategicCore] Creative analysis error:", error.message);
      res.status(500).json({ error: "Failed to analyze creative. Please try again." });
    }
  });
}
