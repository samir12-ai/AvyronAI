import type { Express } from "express";
import type { GoogleGenAI } from "@google/genai";
import { getGemini } from "./ai-client";
import multer from "multer";
import fs from "fs";
import path from "path";

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

function getVeoClient(): GoogleGenAI | null {
  try {
    return getGemini();
  } catch {
    return null;
  }
}

export function registerVeoRoutes(app: Express) {
  const uploadsDir = "/tmp/veo-uploads";
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

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
        imageFileUri,
        imageMimeType,
        lastFrameFileUri,
        lastFrameMimeType,
        referenceImages,
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
        if (!isNaN(seconds) && [4, 6, 8].includes(seconds)) {
          config.durationSeconds = seconds;
        }
      }

      if (resolution && ["720p", "1080p"].includes(resolution)) {
        config.resolution = resolution;
      }

      if (negativePrompt && typeof negativePrompt === "string" && negativePrompt.trim()) {
        config.negativePrompt = negativePrompt.trim();
      }

      if (lastFrameFileUri && lastFrameMimeType) {
        config.lastFrame = {
          image: {
            fileUri: lastFrameFileUri,
            mimeType: lastFrameMimeType,
          },
        };
      }

      if (referenceImages && Array.isArray(referenceImages) && referenceImages.length > 0) {
        config.referenceImages = referenceImages.slice(0, 3).map((img: any) => ({
          image: {
            fileUri: img.fileUri,
            mimeType: img.mimeType,
          },
        }));
      }

      const params: any = {
        model: "veo-3.1-generate-preview",
        prompt,
        config,
      };

      if (imageFileUri && imageMimeType) {
        params.image = {
          fileUri: imageFileUri,
          mimeType: imageMimeType,
        };
      }

      const operation = await client.models.generateVideos(params);

      res.json({
        operationName: operation.name,
        done: operation.done || false,
      });
    } catch (error: any) {
      console.error("Veo video generation error:", error);
      const msg = error.message || "Failed to start video generation";
      if (msg.includes("SERVICE_DISABLED") || msg.includes("PERMISSION_DENIED") || msg.includes("has not been used in project")) {
        return res.status(403).json({
          error: "GOOGLE_API_NOT_ENABLED",
          message: "The Generative Language API is not enabled for your Google Cloud project. Enable it at console.developers.google.com, then wait a few minutes and try again.",
        });
      }
      res.status(500).json({ error: msg });
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
      console.error("Veo status error:", error);
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
      if (!videoUrl || !videoUrl.includes("generativelanguage.googleapis.com")) {
        return res.status(400).json({ error: "Invalid video URL" });
      }

      const separator = videoUrl.includes("?") ? "&" : "?";
      const authedUrl = `${videoUrl}${separator}key=${apiKey}`;
      const videoResponse = await fetch(authedUrl);

      if (!videoResponse.ok) {
        const errText = await videoResponse.text();
        console.error("[VeoProxy] Upstream error:", videoResponse.status, errText);
        return res.status(videoResponse.status).json({ error: "Failed to fetch video from Google" });
      }

      const contentType = videoResponse.headers.get("content-type") || "video/mp4";
      const contentLength = videoResponse.headers.get("content-length");

      res.setHeader("Content-Type", contentType);
      if (contentLength) res.setHeader("Content-Length", contentLength);
      res.setHeader("Cache-Control", "public, max-age=3600");

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

  app.post("/api/veo/upload-image", upload.single("image"), async (req, res) => {
    try {
      const client = getVeoClient();
      if (!client) {
        return res.status(400).json({ error: "GOOGLE_GEMINI_API_KEY not configured." });
      }

      if (!req.file) {
        return res.status(400).json({ error: "No image file provided" });
      }

      const filePath = req.file.path;
      const mimeType = req.file.mimetype || "image/jpeg";

      const uploaded = await client.files.upload({
        file: filePath,
        config: { mimeType },
      });

      try { fs.unlinkSync(filePath); } catch {}

      res.json({
        fileUri: uploaded.uri,
        mimeType: uploaded.mimeType,
      });
    } catch (error: any) {
      console.error("Veo image upload error:", error);
      try { if (req.file?.path) fs.unlinkSync(req.file.path); } catch {}
      res.status(500).json({ error: error.message || "Failed to upload image" });
    }
  });
}
