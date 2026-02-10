import type { Express } from "express";
import { db } from "./db";
import { videoProjects } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import multer from "multer";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { GoogleGenAI } from "@google/genai";

const execAsync = promisify(exec);

const videoOutputDir = path.join(process.cwd(), "uploads", "video-output");
const refImagesDir = path.join(process.cwd(), "uploads", "ref-images");
if (!fs.existsSync(videoOutputDir)) fs.mkdirSync(videoOutputDir, { recursive: true });
if (!fs.existsSync(refImagesDir)) fs.mkdirSync(refImagesDir, { recursive: true });

const refImageUpload = multer({
  storage: multer.diskStorage({
    destination: refImagesDir,
    filename: (req, file, cb) => {
      const uniqueName = Date.now() + '-' + Math.random().toString(36).substr(2, 9) + path.extname(file.originalname);
      cb(null, uniqueName);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

function getVeoClient(): GoogleGenAI | null {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({ apiKey });
}

function buildVeoPrompt(params: {
  creativeBrief: string;
  videoType: string;
  targetAudience: string;
  keyMessage: string;
  style: string;
  mood: string;
  pace: string;
  addText: boolean;
  textOverlay: string;
}): string {
  const parts: string[] = [];

  parts.push(params.creativeBrief);

  const styleMap: Record<string, string> = {
    cinematic: 'cinematic look with dramatic lighting and depth of field',
    energetic: 'high-energy dynamic visuals with vibrant colors',
    minimal: 'clean minimal aesthetic with subtle movements',
    documentary: 'documentary-style natural footage',
    social: 'trendy social media style optimized for engagement',
    commercial: 'polished commercial-grade production quality',
  };
  if (styleMap[params.style]) {
    parts.push(styleMap[params.style]);
  }

  const moodMap: Record<string, string> = {
    energetic: 'energetic and exciting mood',
    calm: 'calm and serene atmosphere',
    dramatic: 'dramatic and intense feeling',
    playful: 'playful and fun vibe',
    luxurious: 'luxurious and premium feel',
    warm: 'warm and inviting tone',
  };
  if (moodMap[params.mood]) {
    parts.push(moodMap[params.mood]);
  }

  const paceMap: Record<string, string> = {
    slow: 'slow deliberate camera movements',
    medium: 'moderate pacing with balanced rhythm',
    fast: 'fast-paced quick cuts and dynamic motion',
  };
  if (paceMap[params.pace]) {
    parts.push(paceMap[params.pace]);
  }

  if (params.targetAudience) {
    parts.push(`targeting ${params.targetAudience}`);
  }

  if (params.keyMessage) {
    parts.push(`conveying the message: "${params.keyMessage}"`);
  }

  if (params.addText && params.textOverlay) {
    parts.push(`include text overlay saying "${params.textOverlay}"`);
  }

  return parts.join('. ') + '.';
}

export function registerVideoRoutes(app: Express) {
  app.use("/uploads/video-output", (req, res, next) => {
    res.setHeader("Accept-Ranges", "bytes");
    next();
  });

  app.get("/api/video/veo-status", (req, res) => {
    const hasKey = !!process.env.GOOGLE_GEMINI_API_KEY;
    res.json({ configured: hasKey });
  });

  app.post("/api/video/upload-ref-images", (req, res, next) => {
    refImageUpload.array("images", 3)(req, res, (err) => {
      if (err) {
        console.error("Ref image upload error:", err.message);
        return res.status(400).json({ error: `Upload error: ${err.message}` });
      }
      next();
    });
  }, async (req, res) => {
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        return res.status(400).json({ error: "No images uploaded" });
      }

      const images = files.map((file) => ({
        filename: file.filename,
        originalName: file.originalname,
        path: `/uploads/ref-images/${file.filename}`,
        size: file.size,
        mimetype: file.mimetype,
      }));

      res.json({ images });
    } catch (error) {
      console.error("Ref image upload error:", error);
      res.status(500).json({ error: "Failed to upload reference images" });
    }
  });

  app.post("/api/video/generate", async (req, res) => {
    try {
      const {
        creativeBrief,
        videoType,
        targetAudience,
        keyMessage,
        style,
        mood,
        pace,
        addText,
        textOverlay,
        duration,
        aspectRatio,
        referenceImages,
      } = req.body;

      if (!creativeBrief?.trim()) {
        return res.status(400).json({ error: "Creative brief is required" });
      }

      const ai = getVeoClient();
      if (!ai) {
        return res.status(400).json({
          error: "Google Gemini API key not configured. Please add your GOOGLE_GEMINI_API_KEY in the Secrets tab to use Veo 3 Pro video generation.",
        });
      }

      const [project] = await db.insert(videoProjects).values({
        title: keyMessage || creativeBrief.slice(0, 60),
        status: 'processing',
        style: style || 'cinematic',
        mood: mood || 'energetic',
      }).returning();

      const prompt = buildVeoPrompt({
        creativeBrief,
        videoType: videoType || 'promo',
        targetAudience: targetAudience || '',
        keyMessage: keyMessage || '',
        style: style || 'cinematic',
        mood: mood || 'energetic',
        pace: pace || 'medium',
        addText: addText || false,
        textOverlay: textOverlay || '',
      });

      console.log("[Veo3] Starting video generation:", {
        projectId: project.id,
        prompt: prompt.slice(0, 200) + '...',
        duration: duration || 8,
        aspectRatio: aspectRatio || '16:9',
        hasRefImages: !!referenceImages?.length,
      });

      try {
        const generateConfig: any = {
          aspectRatio: aspectRatio || "16:9",
          numberOfVideos: 1,
        };

        if (duration) {
          generateConfig.durationSeconds = duration;
        }

        let operation;

        if (referenceImages?.length > 0) {
          const refImageContents: any[] = [];
          for (const img of referenceImages) {
            const imgPath = path.join(refImagesDir, img.filename);
            if (fs.existsSync(imgPath)) {
              const imgData = fs.readFileSync(imgPath);
              refImageContents.push({
                inlineData: {
                  data: imgData.toString('base64'),
                  mimeType: img.mimetype || 'image/jpeg',
                },
              });
            }
          }

          if (refImageContents.length > 0) {
            operation = await ai.models.generateVideos({
              model: "veo-3.0-generate-preview",
              prompt: prompt,
              image: refImageContents[0],
              config: generateConfig,
            });
          } else {
            operation = await ai.models.generateVideos({
              model: "veo-3.0-generate-preview",
              prompt: prompt,
              config: generateConfig,
            });
          }
        } else {
          operation = await ai.models.generateVideos({
            model: "veo-3.0-generate-preview",
            prompt: prompt,
            config: generateConfig,
          });
        }

        console.log("[Veo3] Generation started, polling for result...");

        let attempts = 0;
        const maxAttempts = 120;
        while (!operation.done && attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 5000));
          operation = await ai.operations.get({ operation: operation });
          attempts++;
          console.log(`[Veo3] Poll attempt ${attempts}/${maxAttempts}, done: ${operation.done}`);
        }

        if (!operation.done) {
          await db.update(videoProjects)
            .set({ status: 'failed' })
            .where(eq(videoProjects.id, project.id));
          return res.status(504).json({ error: "Video generation timed out. Please try a shorter duration or simpler prompt." });
        }

        const result = operation.response;
        const generatedVideos = result?.generatedVideos;

        if (!generatedVideos || generatedVideos.length === 0) {
          console.error("[Veo3] No videos in result:", JSON.stringify(result));
          await db.update(videoProjects)
            .set({ status: 'failed' })
            .where(eq(videoProjects.id, project.id));
          return res.status(500).json({ error: "Veo 3 Pro did not return a video. The content may have been filtered. Try adjusting your prompt." });
        }

        const video = generatedVideos[0];
        const videoData = video.video;

        if (!videoData) {
          await db.update(videoProjects)
            .set({ status: 'failed' })
            .where(eq(videoProjects.id, project.id));
          return res.status(500).json({ error: "Generated video data is empty" });
        }

        const outputFilename = `veo3_${Date.now()}.mp4`;
        const outputPath = path.join(videoOutputDir, outputFilename);

        let videoDuration = duration || 8;

        if (videoData.uri) {
          const https = await import('https');
          const http = await import('http');
          const downloadModule = videoData.uri.startsWith('https') ? https : http;

          await new Promise<void>((resolve, reject) => {
            const file = fs.createWriteStream(outputPath);
            downloadModule.get(videoData.uri!, (response: any) => {
              response.pipe(file);
              file.on('finish', () => {
                file.close();
                resolve();
              });
            }).on('error', (err: any) => {
              fs.unlink(outputPath, () => {});
              reject(err);
            });
          });

          try {
            const { stdout } = await execAsync(
              `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${outputPath}"`
            );
            videoDuration = Math.round(parseFloat(stdout.trim()) || duration || 8);
          } catch {}
        } else if (videoData.videoBytes) {
          const videoBuffer = Buffer.from(videoData.videoBytes, 'base64');
          fs.writeFileSync(outputPath, videoBuffer);

          try {
            const { stdout } = await execAsync(
              `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${outputPath}"`
            );
            videoDuration = Math.round(parseFloat(stdout.trim()) || duration || 8);
          } catch {}
        } else {
          await db.update(videoProjects)
            .set({ status: 'failed' })
            .where(eq(videoProjects.id, project.id));
          return res.status(500).json({ error: "Could not extract video data from Veo 3 response" });
        }

        console.log("[Veo3] Video saved:", outputFilename, `${videoDuration}s`);

        await db.update(videoProjects).set({
          status: 'completed',
          outputUrl: `/uploads/video-output/${outputFilename}`,
          duration: videoDuration,
          updatedAt: new Date(),
        }).where(eq(videoProjects.id, project.id));

        res.json({
          success: true,
          projectId: project.id,
          outputUrl: `/uploads/video-output/${outputFilename}`,
          duration: videoDuration,
          creativeNotes: `Generated with Veo 3 Pro using ${style} style, ${mood} mood, and ${pace} pace. Aspect ratio: ${aspectRatio || '16:9'}. ${referenceImages?.length ? `Used ${referenceImages.length} reference image(s) for visual guidance.` : 'Text-to-video generation from creative brief.'}`,
        });
      } catch (veoError: any) {
        console.error("[Veo3] Generation error:", veoError?.message || veoError);
        console.error("[Veo3] Error details:", JSON.stringify(veoError?.response?.data || veoError?.cause || ''));

        await db.update(videoProjects)
          .set({ status: 'failed' })
          .where(eq(videoProjects.id, project.id));

        let errorMsg = veoError?.message || "Video generation failed";
        if (errorMsg.includes("PERMISSION_DENIED") || errorMsg.includes("403")) {
          errorMsg = "Your Google API key doesn't have access to Veo 3 Pro. Make sure you have a paid Google AI plan with Veo access enabled.";
        } else if (errorMsg.includes("RESOURCE_EXHAUSTED") || errorMsg.includes("429")) {
          errorMsg = "Rate limit reached. Please wait a minute and try again.";
        } else if (errorMsg.includes("INVALID_ARGUMENT")) {
          errorMsg = "Invalid request. Try simplifying your prompt or changing settings.";
        }

        res.status(500).json({ error: errorMsg });
      }
    } catch (error: any) {
      console.error("[Veo3] Route error:", error?.message || error);
      res.status(500).json({ error: error?.message || "Failed to generate video" });
    }
  });

  app.get("/api/video/projects", async (req, res) => {
    try {
      const projects = await db.select().from(videoProjects).orderBy(desc(videoProjects.createdAt));
      res.json(projects);
    } catch (error) {
      console.error("List projects error:", error);
      res.status(500).json({ error: "Failed to load projects" });
    }
  });

  app.get("/api/video/projects/:id", async (req, res) => {
    try {
      const [project] = await db.select().from(videoProjects).where(eq(videoProjects.id, req.params.id));
      if (!project) return res.status(404).json({ error: "Project not found" });
      res.json(project);
    } catch (error) {
      console.error("Get project error:", error);
      res.status(500).json({ error: "Failed to load project" });
    }
  });

  app.delete("/api/video/projects/:id", async (req, res) => {
    try {
      await db.delete(videoProjects).where(eq(videoProjects.id, req.params.id));
      res.json({ success: true });
    } catch (error) {
      console.error("Delete project error:", error);
      res.status(500).json({ error: "Failed to delete project" });
    }
  });
}
