import type { Express } from "express";
import { GoogleGenAI } from "@google/genai";
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

let veoClient: GoogleGenAI | null = null;

function getVeoClient(): GoogleGenAI | null {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) return null;
  if (!veoClient) {
    veoClient = new GoogleGenAI({ apiKey });
  }
  return veoClient;
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

      const { prompt, aspectRatio, duration, imageFileUri, imageMimeType } = req.body;

      if (!prompt) {
        return res.status(400).json({ error: "Prompt is required" });
      }

      const config: any = {
        aspectRatio: aspectRatio || "16:9",
        numberOfVideos: 1,
      };

      if (duration) {
        const seconds = parseInt(duration.replace("s", ""));
        if (!isNaN(seconds)) {
          config.durationSeconds = seconds;
        }
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
      res.status(500).json({ error: error.message || "Failed to start video generation" });
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

      let videoUrl = null;
      if (operation.done && operation.response?.generateVideoResponse?.generatedSamples) {
        const samples = operation.response.generateVideoResponse.generatedSamples;
        if (samples.length > 0 && samples[0].video?.uri) {
          videoUrl = samples[0].video.uri;
        }
      }

      res.json({
        done: operation.done || false,
        videoUrl,
        state: operation.done ? "completed" : "processing",
      });
    } catch (error: any) {
      console.error("Veo status error:", error);
      res.status(500).json({ error: error.message || "Failed to get generation status" });
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
