import type { Express, Request, Response } from "express";
import { GoogleGenAI } from "@google/genai";
import multer from "multer";
import { db } from "../db";
import { strategicBlueprints } from "@shared/schema";
import { eq } from "drizzle-orm";
import { logAuditEvent } from "./audit-logger";
import fs from "fs";
import path from "path";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const geminiAi = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY || "",
  httpOptions: {
    apiVersion: "",
    baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL || "",
  },
});

const AUDIT_DIR = path.join(process.cwd(), "logs", "extraction-audit");

function ensureAuditDir() {
  if (!fs.existsSync(AUDIT_DIR)) {
    fs.mkdirSync(AUDIT_DIR, { recursive: true });
  }
}

function storeRawAudit(blueprintId: string, attempts: { text: string; error?: string; model?: string; tokens?: any }[]) {
  ensureAuditDir();
  const filename = `${blueprintId}_${Date.now()}.json`;
  const filepath = path.join(AUDIT_DIR, filename);
  const payload = {
    blueprintId,
    timestamp: new Date().toISOString(),
    attempts: attempts.slice(-3),
  };
  fs.writeFileSync(filepath, JSON.stringify(payload, null, 2));
  console.log(`[StrategicCore] Audit log saved: ${filepath}`);

  const files = fs.readdirSync(AUDIT_DIR)
    .filter(f => f.endsWith(".json"))
    .sort()
    .reverse();
  if (files.length > 100) {
    for (const old of files.slice(100)) {
      fs.unlinkSync(path.join(AUDIT_DIR, old));
    }
  }
}

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

export function cleanJsonString(raw: string): string {
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, '');
  s = s.replace(/\s*```\s*$/i, '');
  s = s.trim();
  const jsonMatch = s.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("No JSON object found in response");
  }
  s = jsonMatch[0];
  s = s.replace(/\/\/[^\n]*/g, '');
  s = s.replace(/,\s*([\]}])/g, '$1');
  s = s.replace(/[\x00-\x1F\x7F]/g, (ch: string) => {
    if (ch === '\n' || ch === '\r' || ch === '\t') return ch;
    return '';
  });
  return s;
}

function buildFallbackExtraction(): any {
  return {
    detectedLanguage: "unknown",
    transcribedText: null,
    ocrText: null,
    detectedOffer: { value: "INSUFFICIENT_DATA", confidence: 0 },
    detectedPositioning: { value: "INSUFFICIENT_DATA", confidence: 0 },
    detectedCTA: { value: "INSUFFICIENT_DATA", confidence: 0 },
    detectedAudienceGuess: { value: "INSUFFICIENT_DATA", confidence: 0 },
    detectedFunnelStage: { value: "INSUFFICIENT_DATA", confidence: 0 },
    detectedPriceIfVisible: { value: null, confidence: 0 },
  };
}

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

function extractTokenUsage(response: any): { inputTokens?: number; outputTokens?: number; totalTokens?: number; truncated: boolean } {
  const usage = response.usageMetadata || response.usage || {};
  const inputTokens = usage.promptTokenCount || usage.promptTokens || usage.input_tokens;
  const outputTokens = usage.candidatesTokenCount || usage.completionTokens || usage.output_tokens;
  const totalTokens = usage.totalTokenCount || usage.totalTokens || usage.total_tokens;

  const finishReason = response.candidates?.[0]?.finishReason || "";
  const truncated = finishReason === "MAX_TOKENS" || finishReason === "STOP" && !response.text?.trim().endsWith("}");

  return { inputTokens, outputTokens, totalTokens, truncated };
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

      if (!["GATE_PASSED", "EXTRACTION_COMPLETE", "EXTRACTION_FALLBACK", "ANALYSIS_COMPLETE"].includes(blueprint.status)) {
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

      const auditAttempts: { text: string; error?: string; model?: string; tokens?: any }[] = [];
      let rawAnalysis: any = null;
      const MODEL_NAME = "gemini-3-pro-preview";

      try {
        const response = await geminiAi.models.generateContent({
          model: MODEL_NAME,
          contents: [{ role: "user", parts }],
          config: {
            maxOutputTokens: 4096,
            responseMimeType: "application/json",
          },
        });

        const rawText = response.text || "";
        const tokenInfo = extractTokenUsage(response);
        console.log(`[StrategicCore] Model: ${MODEL_NAME} | Tokens: in=${tokenInfo.inputTokens ?? "?"}, out=${tokenInfo.outputTokens ?? "?"}, total=${tokenInfo.totalTokens ?? "?"} | Truncated: ${tokenInfo.truncated}`);

        auditAttempts.push({ text: rawText, model: MODEL_NAME, tokens: tokenInfo });

        if (tokenInfo.truncated) {
          console.warn(`[StrategicCore] WARNING: Response appears truncated (finishReason or missing closing brace)`);
        }

        const cleaned = cleanJsonString(rawText);
        rawAnalysis = JSON.parse(cleaned);
      } catch (parseErr: any) {
        console.error("[StrategicCore] Attempt 1 failed:", parseErr.message);
        if (auditAttempts.length > 0) {
          auditAttempts[auditAttempts.length - 1].error = parseErr.message;
        }

        try {
          console.log("[StrategicCore] Retrying extraction with stricter prompt...");
          const retryResponse = await geminiAi.models.generateContent({
            model: MODEL_NAME,
            contents: [{
              role: "user",
              parts: [
                { text: EXTRACTION_PROMPT + "\n\nPREVIOUS ATTEMPT FAILED JSON PARSING. You MUST return ONLY a valid JSON object. No markdown code blocks. No trailing commas. No comments. Just the raw JSON object starting with { and ending with }." },
                { inlineData: { data: base64Data, mimeType } },
              ],
            }],
            config: {
              maxOutputTokens: 4096,
              responseMimeType: "application/json",
            },
          });

          const retryText = retryResponse.text || "";
          const retryTokens = extractTokenUsage(retryResponse);
          console.log(`[StrategicCore] Retry | Model: ${MODEL_NAME} | Tokens: in=${retryTokens.inputTokens ?? "?"}, out=${retryTokens.outputTokens ?? "?"} | Truncated: ${retryTokens.truncated}`);

          auditAttempts.push({ text: retryText, model: MODEL_NAME, tokens: retryTokens });

          const cleaned = cleanJsonString(retryText);
          rawAnalysis = JSON.parse(cleaned);
        } catch (retryErr: any) {
          console.error("[StrategicCore] Attempt 2 also failed:", retryErr.message);
          if (auditAttempts.length > 0) {
            auditAttempts[auditAttempts.length - 1].error = retryErr.message;
          }
        }
      }

      let extractionFallbackUsed = false;
      let parseFailedReason: string | null = null;

      if (!rawAnalysis) {
        extractionFallbackUsed = true;
        const lastAttempt = auditAttempts[auditAttempts.length - 1];
        if (lastAttempt?.tokens?.truncated) {
          parseFailedReason = "TRUNCATED";
        } else if (lastAttempt?.text && lastAttempt.text.trim().length === 0) {
          parseFailedReason = "EMPTY_RESPONSE";
        } else {
          parseFailedReason = "INVALID_JSON";
        }
        console.warn(`[StrategicCore] Extraction fallback triggered: ${parseFailedReason}`);
        storeRawAudit(blueprintId, auditAttempts);
        rawAnalysis = {};
      }

      const draftBlueprint = normalizeExtraction(rawAnalysis);

      const allInsufficient = ["detectedOffer", "detectedPositioning", "detectedCTA", "detectedAudienceGuess", "detectedFunnelStage"].every(
        f => draftBlueprint[f]?.value === "INSUFFICIENT_DATA"
      );
      if (allInsufficient && !extractionFallbackUsed) {
        extractionFallbackUsed = true;
        parseFailedReason = "EMPTY_FIELDS";
        storeRawAudit(blueprintId, auditAttempts);
      }

      draftBlueprint.extractionFallbackUsed = extractionFallbackUsed;
      draftBlueprint.parseFailedReason = parseFailedReason;

      const finalStatus = extractionFallbackUsed ? "EXTRACTION_FALLBACK" : "EXTRACTION_COMPLETE";

      await db.update(strategicBlueprints)
        .set({
          status: finalStatus,
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

      await logAuditEvent({
        accountId: blueprint.accountId,
        campaignId: blueprint.campaignId || undefined,
        blueprintId,
        blueprintVersion: blueprint.blueprintVersion,
        event: extractionFallbackUsed ? "EXTRACTION_FALLBACK" : "EXTRACTION_COMPLETED",
        details: {
          mediaType: isVideo ? "video" : "image",
          allInsufficient,
          extractionFallbackUsed,
          parseFailedReason,
          attempts: auditAttempts.length,
        },
      });

      res.json({
        success: true,
        blueprintId,
        blueprintVersion: blueprint.blueprintVersion,
        status: finalStatus,
        draftBlueprint,
        extractionFallbackUsed,
        parseFailedReason,
        _meta: {
          attempts: auditAttempts.length,
          allFieldsInsufficient: allInsufficient,
        },
      });
    } catch (error: any) {
      console.error("[StrategicCore] Creative analysis error:", error.message);
      res.status(500).json({ error: "Failed to analyze creative. Please try again." });
    }
  });
}
