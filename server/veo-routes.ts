import type { Express } from "express";
import { GoogleGenAI } from "@google/genai";
import multer from "multer";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const upload = multer({
  dest: "/tmp/veo-uploads",
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [".jpg", ".jpeg", ".png", ".webp"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext) || file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"));
    }
  },
});

let veoClientInstance: GoogleGenAI | null = null;

function getVeoClient(): GoogleGenAI | null {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) return null;
  if (!veoClientInstance) {
    veoClientInstance = new GoogleGenAI({ apiKey });
  }
  return veoClientInstance;
}

const pendingImages = new Map<string, { filePath: string; mimeType: string; createdAt: number }>();

function cleanupOldImages() {
  const now = Date.now();
  for (const [id, entry] of pendingImages.entries()) {
    if (now - entry.createdAt > 30 * 60 * 1000) {
      try { fs.unlinkSync(entry.filePath); } catch {}
      pendingImages.delete(id);
    }
  }
}

function readImageAsBase64(imageId: string): { imageBytes: string; mimeType: string } | null {
  const entry = pendingImages.get(imageId);
  if (!entry) return null;
  try {
    const buffer = fs.readFileSync(entry.filePath);
    const imageBytes = buffer.toString("base64");
    return { imageBytes, mimeType: entry.mimeType };
  } catch (err) {
    console.error(`[Veo] Failed to read image ${imageId}:`, err);
    return null;
  }
}

function cleanupImage(imageId: string) {
  const entry = pendingImages.get(imageId);
  if (entry) {
    try { fs.unlinkSync(entry.filePath); } catch {}
    pendingImages.delete(imageId);
  }
}

export function registerVeoRoutes(app: Express) {
  const uploadsDir = "/tmp/veo-uploads";
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  app.post("/api/veo/upload-image", (req, res, next) => {
    upload.single("image")(req, res, (err: any) => {
      if (err) {
        console.error("[VeoUpload] Multer error:", err.message);
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ error: "Image file is too large. Maximum size is 20MB." });
        }
        return res.status(400).json({ error: err.message || "File upload failed" });
      }
      next();
    });
  }, async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No image file provided. Ensure the form field is named 'image'." });
      }

      const mimeType = req.file.mimetype || "image/jpeg";
      const imageId = crypto.randomUUID();

      console.log(`[VeoUpload] Received file: ${req.file.originalname} (${mimeType}, ${req.file.size} bytes) → id=${imageId}`);

      pendingImages.set(imageId, {
        filePath: req.file.path,
        mimeType,
        createdAt: Date.now(),
      });

      cleanupOldImages();

      res.json({ imageId, mimeType });
    } catch (error: any) {
      console.error("[VeoUpload] Upload error:", error);
      try { if (req.file?.path) fs.unlinkSync(req.file.path); } catch {}
      res.status(500).json({ error: error.message || "Failed to process uploaded image" });
    }
  });

  app.post("/api/veo/generate-video", async (req, res) => {
    try {
      const client = getVeoClient();
      if (!client) {
        return res.status(400).json({ error: "GOOGLE_GEMINI_API_KEY not configured. Add it in secrets." });
      }

      const {
        prompt,
        aspectRatio,
        duration,
        resolution,
        negativePrompt,
        startImageId,
        lastFrameImageId,
        personGeneration,
      } = req.body;

      if (!prompt) {
        return res.status(400).json({ error: "Prompt is required" });
      }

      const validAspectRatios = ["16:9", "9:16"];
      const config: any = {
        aspectRatio: validAspectRatios.includes(aspectRatio) ? aspectRatio : "16:9",
        numberOfVideos: 1,
      };

      if (duration) {
        const seconds = parseInt(String(duration).replace("s", ""));
        if (!isNaN(seconds) && seconds >= 5 && seconds <= 8) {
          config.durationSeconds = seconds;
        }
      }

      if (resolution && ["720p", "1080p", "4k"].includes(resolution)) {
        config.resolution = resolution;
      }

      if (negativePrompt && typeof negativePrompt === "string" && negativePrompt.trim()) {
        config.negativePrompt = negativePrompt.trim();
      }

      if (personGeneration && typeof personGeneration === "string") {
        config.personGeneration = personGeneration;
      }

      if (lastFrameImageId) {
        const lastFrameData = readImageAsBase64(lastFrameImageId);
        if (lastFrameData) {
          config.lastFrame = {
            image: {
              imageBytes: lastFrameData.imageBytes,
              mimeType: lastFrameData.mimeType,
            },
          };
          cleanupImage(lastFrameImageId);
        } else {
          console.warn(`[VeoGenerate] Last frame image ${lastFrameImageId} not found, skipping`);
        }
      }

      const params: any = {
        model: "veo-3.1-generate-preview",
        prompt,
        config,
      };

      if (startImageId) {
        const imageData = readImageAsBase64(startImageId);
        if (imageData) {
          params.image = {
            imageBytes: imageData.imageBytes,
            mimeType: imageData.mimeType,
          };
          cleanupImage(startImageId);
        } else {
          return res.status(400).json({ error: "Start image not found. Please re-upload and try again." });
        }
      }

      console.log(`[VeoGenerate] model=${params.model} prompt="${prompt.slice(0, 60)}..." aspectRatio=${config.aspectRatio} duration=${config.durationSeconds || 'default'} resolution=${config.resolution || 'default'} hasImage=${!!params.image} imageSize=${params.image?.imageBytes?.length || 0} lastFrame=${!!config.lastFrame}`);

      const operation = await client.models.generateVideos(params);

      console.log(`[VeoGenerate] Operation started: ${operation.name} done=${operation.done}`);

      res.json({
        operationName: operation.name,
        done: operation.done || false,
      });
    } catch (error: any) {
      console.error("[VeoGenerate] Error:", error?.message || error);
      if (error?.stack) {
        console.error("[VeoGenerate] Stack:", error.stack.split('\n').slice(0, 3).join('\n'));
      }
      const msg = error.message || "Failed to start video generation";
      if (msg.includes("SERVICE_DISABLED") || msg.includes("PERMISSION_DENIED") || msg.includes("has not been used in project")) {
        return res.status(403).json({
          error: "GOOGLE_API_NOT_ENABLED",
          message: "The Generative Language API is not enabled for your Google Cloud project. Enable it at console.developers.google.com, then wait a few minutes and try again.",
        });
      }
      if (msg.includes("INVALID_ARGUMENT")) {
        return res.status(400).json({
          error: "INVALID_REQUEST",
          message: `Video generation rejected: ${msg.length > 200 ? msg.substring(0, 200) : msg}`,
        });
      }
      res.status(500).json({ error: msg.length > 300 ? msg.substring(0, 300) : msg });
    }
  });

  app.post("/api/veo/status", async (req, res) => {
    try {
      const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(400).json({ error: "GOOGLE_GEMINI_API_KEY not configured." });
      }

      const { operationName } = req.body;
      if (!operationName) {
        return res.status(400).json({ error: "operationName is required" });
      }

      const statusUrl = `https://generativelanguage.googleapis.com/v1beta/${operationName}?key=${apiKey}`;
      const response = await fetch(statusUrl);
      const operation = await response.json() as any;

      if (operation.error) {
        console.error("[VeoStatus] Operation error:", JSON.stringify(operation.error));
        return res.status(500).json({ error: operation.error.message || "Operation failed", code: operation.error.code });
      }

      const videos: string[] = [];
      if (operation.done && operation.response?.generateVideoResponse?.generatedSamples) {
        for (const sample of operation.response.generateVideoResponse.generatedSamples) {
          if (sample.video?.uri) {
            const proxyUrl = `/api/veo/video-proxy?url=${encodeURIComponent(sample.video.uri)}`;
            videos.push(proxyUrl);
          }
        }
      }

      res.json({
        done: operation.done || false,
        videoUrl: videos[0] || null,
        videos,
        state: operation.done ? "completed" : "processing",
      });
    } catch (error: any) {
      console.error("[VeoStatus] Error:", error);
      res.status(500).json({ error: error.message || "Failed to get generation status" });
    }
  });

  app.get("/api/veo/video-proxy", async (req, res) => {
    try {
      const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(400).json({ error: "GOOGLE_GEMINI_API_KEY not configured." });
      }

      const videoUrl = req.query.url as string;
      if (!videoUrl) {
        return res.status(400).json({ error: "Invalid video URL" });
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(videoUrl);
      } catch {
        return res.status(400).json({ error: "Invalid video URL format" });
      }

      if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== "generativelanguage.googleapis.com") {
        return res.status(400).json({ error: "Only Google Generative Language API URLs are allowed" });
      }

      parsedUrl.searchParams.set("key", apiKey);
      const authedUrl = parsedUrl.toString();

      const rangeHeader = req.headers.range;
      const upstreamHeaders: Record<string, string> = {};
      if (rangeHeader) {
        upstreamHeaders["Range"] = rangeHeader;
      }

      const videoResponse = await fetch(authedUrl, { headers: upstreamHeaders });

      if (!videoResponse.ok && videoResponse.status !== 206) {
        const errText = await videoResponse.text();
        console.error("[VeoProxy] Upstream error:", videoResponse.status, errText);
        return res.status(videoResponse.status).json({ error: "Failed to fetch video from Google" });
      }

      const contentType = videoResponse.headers.get("content-type") || "video/mp4";
      const contentLength = videoResponse.headers.get("content-length");
      const contentRange = videoResponse.headers.get("content-range");
      const acceptRanges = videoResponse.headers.get("accept-ranges");

      res.setHeader("Content-Type", contentType);
      if (contentLength) res.setHeader("Content-Length", contentLength);
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.setHeader("Accept-Ranges", acceptRanges || "bytes");
      res.setHeader("Content-Disposition", "inline; filename=\"MarketMind_Video.mp4\"");

      if (contentRange) {
        res.setHeader("Content-Range", contentRange);
      }

      if (videoResponse.status === 206) {
        res.status(206);
      } else {
        res.status(200);
      }

      const reader = videoResponse.body?.getReader();
      if (!reader) {
        return res.status(500).json({ error: "Failed to stream video" });
      }

      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
        res.end();
      };
      await pump();
    } catch (error: any) {
      console.error("[VeoProxy] Error:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: error.message || "Failed to proxy video" });
      }
    }
  });
}
