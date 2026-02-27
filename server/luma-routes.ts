import type { Express } from "express";
import LumaAI from "lumaai";
import multer from "multer";
import path from "path";
import fs from "fs";
import FormData from "form-data";
import https from "https";

const upload = multer({
  dest: "/tmp/luma-uploads",
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

const FREEIMAGE_API_KEY = "6d207e02198a847aa98d0a2a901485a5";

function uploadToPublicHost(filePath: string, originalName: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("source", fs.createReadStream(filePath), { filename: originalName });
    form.append("type", "file");
    form.append("action", "upload");

    const options = {
      hostname: "freeimage.host",
      path: `/api/1/upload?key=${FREEIMAGE_API_KEY}`,
      method: "POST",
      headers: form.getHeaders(),
    };

    const request = https.request(options, (response) => {
      let data = "";
      response.on("data", (chunk) => { data += chunk; });
      response.on("end", () => {
        try {
          const result = JSON.parse(data);
          if (result.status_code === 200 && result.image?.image?.url) {
            resolve(result.image.image.url);
          } else {
            reject(new Error(`Image host upload failed: ${result.error?.message || "Unknown error"}`));
          }
        } catch (e) {
          reject(new Error("Failed to parse image host response"));
        }
      });
    });

    request.on("error", (err) => reject(err));
    form.pipe(request);
  });
}

let lumaClient: LumaAI | null = null;

function getLumaClient(): LumaAI | null {
  if (!process.env.LUMA_API_KEY) {
    return null;
  }
  if (!lumaClient) {
    lumaClient = new LumaAI({ authToken: process.env.LUMA_API_KEY });
  }
  return lumaClient;
}

export function registerLumaRoutes(app: Express) {
  const uploadsDir = "/tmp/luma-uploads";
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  app.use("/api/luma/files", (req, res, next) => {
    const filePath = path.join(uploadsDir, path.basename(req.path));
    if (fs.existsSync(filePath)) {
      res.sendFile(filePath);
    } else {
      res.status(404).json({ error: "File not found" });
    }
  });

  app.post("/api/luma/upload-image", upload.single("image"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No image file provided" });
      }

      const filePath = req.file.path;
      const publicUrl = await uploadToPublicHost(filePath, req.file.originalname || "image.jpg");

      try { fs.unlinkSync(filePath); } catch {}

      res.json({ imageUrl: publicUrl });
    } catch (error: any) {
      console.error("Image upload error:", error);
      res.status(500).json({ error: error.message || "Failed to upload image" });
    }
  });

  app.post("/api/luma/generate-video", async (req, res) => {
    try {
      const client = getLumaClient();
      if (!client) {
        return res.status(400).json({ error: "Luma AI API key not configured. Add LUMA_API_KEY in secrets." });
      }

      const { prompt, aspectRatio, duration, loop, model, resolution, startImageUrl, endImageUrl, extendGenerationId, reverseExtend, concepts } = req.body;

      if (!prompt) {
        return res.status(400).json({ error: "Prompt is required" });
      }

      const generationParams: any = {
        prompt,
        model: model || "ray-2",
        aspect_ratio: aspectRatio || "16:9",
        duration: duration || "5s",
        loop: loop || false,
      };

      if (resolution) {
        generationParams.resolution = resolution;
      } else {
        generationParams.resolution = "1080p";
      }

      if (concepts && concepts.length > 0) {
        generationParams.concepts = concepts.map((c: string) => ({ key: c }));
      }

      const keyframes: any = {};
      let hasKeyframes = false;

      if (extendGenerationId) {
        if (reverseExtend) {
          keyframes.frame1 = { type: "generation", id: extendGenerationId };
        } else {
          keyframes.frame0 = { type: "generation", id: extendGenerationId };
        }
        hasKeyframes = true;

        if (startImageUrl && reverseExtend) {
          keyframes.frame0 = { type: "image", url: startImageUrl };
        }
        if (endImageUrl && !reverseExtend) {
          keyframes.frame1 = { type: "image", url: endImageUrl };
        }
      } else {
        if (startImageUrl) {
          keyframes.frame0 = { type: "image", url: startImageUrl };
          hasKeyframes = true;
        }
        if (endImageUrl) {
          keyframes.frame1 = { type: "image", url: endImageUrl };
          hasKeyframes = true;
        }
      }

      if (hasKeyframes) {
        generationParams.keyframes = keyframes;
      }

      const generation = await client.generations.create(generationParams);

      res.json({
        id: generation.id,
        state: generation.state,
      });
    } catch (error: any) {
      console.error("Luma AI video generation error:", error);
      res.status(500).json({ error: error.message || "Failed to start video generation" });
    }
  });

  app.post("/api/luma/generate", async (req, res) => {
    try {
      const client = getLumaClient();
      if (!client) {
        return res.status(400).json({ error: "Luma AI API key not configured. Add LUMA_API_KEY in secrets." });
      }

      const { prompt, aspectRatio, duration, loop, model, imageUrl } = req.body;

      if (!prompt) {
        return res.status(400).json({ error: "Prompt is required" });
      }

      const generationParams: any = {
        prompt,
        model: model || "ray-2",
        aspect_ratio: aspectRatio || "16:9",
        duration: duration || "5s",
        loop: loop || false,
        resolution: "1080p",
      };

      if (imageUrl) {
        generationParams.keyframes = {
          frame0: {
            type: "image",
            url: imageUrl,
          },
        };
      }

      const generation = await client.generations.create(generationParams);

      res.json({
        id: generation.id,
        state: generation.state,
        message: "Video generation started. Poll the status endpoint to check progress.",
      });
    } catch (error: any) {
      console.error("Luma AI generation error:", error);
      res.status(500).json({ error: error.message || "Failed to start video generation" });
    }
  });

  app.post("/api/luma/generate-image", async (req, res) => {
    try {
      const client = getLumaClient();
      if (!client) {
        return res.status(400).json({ error: "Luma AI API key not configured. Add LUMA_API_KEY in secrets." });
      }

      const { prompt, aspectRatio, model, imageRef, styleRef, characterRef, modifyImageRef } = req.body;

      if (!prompt) {
        return res.status(400).json({ error: "Prompt is required" });
      }

      const params: any = {
        prompt,
        aspect_ratio: aspectRatio || "16:9",
        model: model || "photon-1",
      };

      if (imageRef && imageRef.length > 0) {
        params.image_ref = imageRef.map((ref: any) => ({
          url: ref.url,
          weight: ref.weight ?? 0.85,
        }));
      }

      if (styleRef && styleRef.length > 0) {
        params.style_ref = styleRef.map((ref: any) => ({
          url: ref.url,
          weight: ref.weight ?? 0.8,
        }));
      }

      if (characterRef && characterRef.images && characterRef.images.length > 0) {
        params.character_ref = {
          identity0: {
            images: characterRef.images,
          },
        };
      }

      if (modifyImageRef) {
        params.modify_image_ref = {
          url: modifyImageRef.url,
          weight: modifyImageRef.weight ?? 1.0,
        };
      }

      const generation = await (client.generations as any).image.create(params);

      res.json({
        id: generation.id,
        state: generation.state,
        type: "image",
      });
    } catch (error: any) {
      console.error("Luma AI image generation error:", error);
      res.status(500).json({ error: error.message || "Failed to start image generation" });
    }
  });

  app.get("/api/luma/status/:id", async (req, res) => {
    try {
      const client = getLumaClient();
      if (!client) {
        return res.status(400).json({ error: "Luma AI API key not configured." });
      }

      const generation = await client.generations.get(req.params.id);

      res.json({
        id: generation.id,
        state: generation.state,
        type: (generation as any).type || "video",
        videoUrl: generation.assets?.video || null,
        imageUrl: (generation.assets as any)?.image || null,
        thumbnailUrl: (generation.assets as any)?.thumbnail || null,
        failure_reason: (generation as any).failure_reason || null,
      });
    } catch (error: any) {
      console.error("Luma AI status error:", error);
      res.status(500).json({ error: error.message || "Failed to get generation status" });
    }
  });

  app.get("/api/luma/generations", async (req, res) => {
    try {
      const client = getLumaClient();
      if (!client) {
        return res.status(400).json({ error: "Luma AI API key not configured." });
      }

      const limit = parseInt(req.query.limit as string) || 20;
      const offset = parseInt(req.query.offset as string) || 0;

      const generations = await client.generations.list({ limit, offset });
      res.json({ generations });
    } catch (error: any) {
      console.error("Luma AI list error:", error);
      res.status(500).json({ error: error.message || "Failed to list generations" });
    }
  });

  app.delete("/api/luma/generations/:id", async (req, res) => {
    try {
      const client = getLumaClient();
      if (!client) {
        return res.status(400).json({ error: "Luma AI API key not configured." });
      }

      await client.generations.delete(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Luma AI delete error:", error);
      res.status(500).json({ error: error.message || "Failed to delete generation" });
    }
  });

  app.get("/api/luma/concepts", async (req, res) => {
    try {
      const client = getLumaClient();
      if (!client) {
        return res.status(400).json({ error: "Luma AI API key not configured." });
      }

      const concepts = await client.generations.concepts.list();
      res.json({ concepts });
    } catch (error: any) {
      console.error("Luma AI concepts error:", error);
      res.status(500).json({ error: error.message || "Failed to get concepts" });
    }
  });

  app.get("/api/luma/camera-motions", async (req, res) => {
    try {
      const client = getLumaClient();
      if (!client) {
        return res.status(400).json({ error: "Luma AI API key not configured." });
      }

      const motions = await (client.generations as any).cameraMotion.list();
      res.json({ motions });
    } catch (error: any) {
      console.error("Luma AI camera motions error:", error);
      const fallbackMotions = [
        "camera orbit left", "camera orbit right",
        "camera pan left", "camera pan right",
        "camera pan up", "camera pan down",
        "camera push in", "camera pull out",
        "camera zoom in", "camera zoom out",
        "camera tilt up", "camera tilt down",
        "camera dolly in", "camera dolly out",
        "camera crane up", "camera crane down",
        "camera tracking shot left", "camera tracking shot right",
        "camera static shot", "camera handheld shot",
      ];
      res.json({ motions: fallbackMotions });
    }
  });
}
