import type { Express } from "express";
import LumaAI from "lumaai";

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
        model: model || "ray-flash-2",
        aspect_ratio: aspectRatio || "16:9",
        duration: duration || "5s",
        loop: loop || false,
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
        videoUrl: generation.assets?.video || null,
        thumbnailUrl: (generation.assets as any)?.thumbnail || null,
        failure_reason: (generation as any).failure_reason || null,
      });
    } catch (error: any) {
      console.error("Luma AI status error:", error);
      res.status(500).json({ error: error.message || "Failed to get generation status" });
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
}
