import type { Express } from "express";
import { db } from "./db";
import { videoProjects } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import multer from "multer";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { aiChat } from "./ai-client";
import { normalizeMediaType } from "../lib/media-types";

const execAsync = promisify(exec);

const videoUploadsDir = path.join(process.cwd(), "uploads", "videos");
const videoOutputDir = path.join(process.cwd(), "uploads", "video-output");
if (!fs.existsSync(videoUploadsDir)) fs.mkdirSync(videoUploadsDir, { recursive: true });
if (!fs.existsSync(videoOutputDir)) fs.mkdirSync(videoOutputDir, { recursive: true });

const videoUpload = multer({
  storage: multer.diskStorage({
    destination: videoUploadsDir,
    filename: (req, file, cb) => {
      const uniqueName = Date.now() + '-' + Math.random().toString(36).substr(2, 9) + path.extname(file.originalname);
      cb(null, uniqueName);
    },
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v', '.3gp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.mimetype.startsWith('video/') || file.mimetype === 'application/octet-stream' || videoExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only video files are allowed'));
    }
  },
});

async function getVideoDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
    );
    return parseFloat(stdout.trim()) || 0;
  } catch {
    return 0;
  }
}

async function getVideoInfo(filePath: string): Promise<{ duration: number; width: number; height: number }> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,duration -show_entries format=duration -of json "${filePath}"`
    );
    const info = JSON.parse(stdout);
    const stream = info.streams?.[0] || {};
    const duration = parseFloat(stream.duration || info.format?.duration || '0');
    return { duration, width: stream.width || 1920, height: stream.height || 1080 };
  } catch {
    return { duration: 0, width: 1920, height: 1080 };
  }
}

export function registerVideoRoutes(app: Express) {
  app.use("/uploads/videos", (req, res, next) => {
    res.setHeader("Accept-Ranges", "bytes");
    next();
  });

  app.post("/api/video/upload-clips", (req, res, next) => {
    videoUpload.array("clips", 20)(req, res, (err) => {
      if (err) {
        console.error("Multer upload error:", err.message);
        return res.status(400).json({ error: `Upload error: ${err.message}` });
      }
      next();
    });
  }, async (req, res) => {
    try {
      const files = req.files as Express.Multer.File[];
      console.log("Upload request received:", {
        filesCount: files?.length || 0,
        contentType: req.headers['content-type'],
        bodyKeys: Object.keys(req.body || {}),
      });
      if (!files || files.length === 0) {
        return res.status(400).json({ error: "No video files uploaded" });
      }

      const clips = await Promise.all(files.map(async (file) => {
        const filePath = path.join(videoUploadsDir, file.filename);
        const info = await getVideoInfo(filePath);
        return {
          filename: file.filename,
          originalName: file.originalname,
          path: `/uploads/videos/${file.filename}`,
          size: file.size,
          duration: info.duration,
          width: info.width,
          height: info.height,
        };
      }));

      const [project] = await db.insert(videoProjects).values({
        title: req.body.title || 'Untitled Project',
        status: 'uploaded',
        clipCount: clips.length,
        style: req.body.style || 'cinematic',
        mood: req.body.mood || 'energetic',
      }).returning();

      res.json({ project, clips });
    } catch (error) {
      console.error("Video upload error:", error);
      res.status(500).json({ error: "Failed to upload video clips" });
    }
  });

  app.post("/api/video/ai-edit", async (req, res) => {
    try {
      const { projectId, clips, style, mood, pace, addMusic, addTransitions, addText, textOverlay, creativeBrief, videoType, targetAudience, keyMessage } = req.body;

      if (!clips || clips.length === 0) {
        return res.status(400).json({ error: "No clips provided" });
      }

      await db.update(videoProjects)
        .set({ status: 'processing', style, mood })
        .where(eq(videoProjects.id, projectId));

      const clipDetails = clips.map((c: any, i: number) =>
        `Clip ${i + 1}: "${c.originalName}" (${c.duration?.toFixed(1)}s, ${c.width}x${c.height})`
      ).join('\n');

      const aiResponse = await aiChat({
        model: "gpt-5.2",
        max_tokens: 800,
        accountId: "default",
        endpoint: "video-brief",
        messages: [
          {
            role: "system",
            content: `You are GPT-5.2, an elite AI video editor and creative director. You create professional, broadcast-quality edit decisions for video projects. You deeply understand cinematic language, pacing, transitions, color grading, storytelling through visual media, and marketing psychology.

Your job is to:
1. Read the client's creative brief carefully to understand their vision
2. Analyze the available video clips (their names, durations, resolutions)
3. Create an optimal edit plan that fulfills the creative brief
4. Decide the best clip order for narrative flow
5. Set precise trim points (start/end times) to remove dead air and keep energy
6. Choose transition types that match the mood and style
7. Plan text overlay timing and placement if requested
8. Suggest color grading that supports the overall feel

IMPORTANT: Base your editing decisions primarily on the CREATIVE BRIEF provided by the user. The brief tells you what they want the video to achieve, who it's for, and what message it should convey. Use the style, mood, and pace settings to fine-tune your approach.

Return a JSON object with this structure:
{
  "editPlan": {
    "clipOrder": [0, 2, 1],
    "clips": [
      {
        "index": 0,
        "startTime": 0,
        "endTime": 5.0,
        "transition": "fade",
        "transitionDuration": 0.5
      }
    ],
    "textOverlays": [
      {
        "text": "Title Text",
        "startTime": 0,
        "duration": 3,
        "position": "center",
        "fontSize": 48
      }
    ],
    "colorGrade": "warm",
    "overallPace": "medium"
  },
  "creativeNotes": "Detailed description of your creative approach and why you made these editing decisions based on the brief"
}`
          },
          {
            role: "user",
            content: `Create a professional edit plan for this video project.

=== CREATIVE BRIEF ===
${creativeBrief || 'Create a professional, engaging video edit.'}

=== VIDEO TYPE ===
${videoType || 'promo'}

=== TARGET AUDIENCE ===
${targetAudience || 'General audience'}

=== KEY MESSAGE ===
${keyMessage || 'Not specified'}

=== EDIT PREFERENCES ===
STYLE: ${style || 'cinematic'}
MOOD: ${mood || 'energetic'}
PACE: ${pace || 'medium'}
ADD TRANSITIONS: ${addTransitions !== false ? 'Yes' : 'No'}
ADD TEXT OVERLAY: ${addText ? 'Yes' : 'No'}
TEXT TO OVERLAY: ${textOverlay || 'None specified'}

=== AVAILABLE CLIPS ===
${clipDetails}

Based on the creative brief above, create an edit plan that fulfills the client's vision. Consider the video type, target audience, and key message when making your editing decisions. Determine the best clip order for storytelling, trim to keep the strongest moments, choose transitions that match the mood, and suggest appropriate color grading.`
          }
        ],
      });

      const aiContent = aiResponse.choices[0]?.message?.content || "";
      let editPlan;
      try {
        const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
        editPlan = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
      } catch {
        editPlan = null;
      }

      if (!editPlan) {
        await db.update(videoProjects)
          .set({ status: 'failed' })
          .where(eq(videoProjects.id, projectId));
        return res.status(500).json({ error: "AI failed to generate edit plan" });
      }

      const plan = editPlan.editPlan || editPlan;
      const clipOrder = plan.clipOrder || clips.map((_: any, i: number) => i);
      const outputFilename = `edited_${Date.now()}.mp4`;
      const outputPath = path.join(videoOutputDir, outputFilename);

      try {
        const filterParts: string[] = [];
        const concatInputs: string[] = [];
        let inputArgs = '';

        for (let i = 0; i < clipOrder.length; i++) {
          const clipIdx = clipOrder[i];
          const clip = clips[clipIdx];
          if (!clip) continue;

          const clipPath = path.join(videoUploadsDir, clip.filename);
          if (!fs.existsSync(clipPath)) continue;

          inputArgs += ` -i "${clipPath}"`;

          const clipPlan = plan.clips?.find((c: any) => c.index === clipIdx);
          const startTime = clipPlan?.startTime || 0;
          const endTime = clipPlan?.endTime || clip.duration || 10;

          filterParts.push(
            `[${i}:v]trim=start=${startTime}:end=${endTime},setpts=PTS-STARTPTS,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2[v${i}]`
          );
          filterParts.push(
            `[${i}:a]atrim=start=${startTime}:end=${endTime},asetpts=PTS-STARTPTS[a${i}]`
          );
          concatInputs.push(`[v${i}][a${i}]`);
        }

        if (concatInputs.length === 0) {
          await db.update(videoProjects)
            .set({ status: 'failed' })
            .where(eq(videoProjects.id, projectId));
          return res.status(500).json({ error: "No valid clips to process" });
        }

        const filterComplex = filterParts.join(';') + ';' + concatInputs.join('') + `concat=n=${concatInputs.length}:v=1:a=1[outv][outa]`;

        const ffmpegCmd = `ffmpeg -y ${inputArgs} -filter_complex "${filterComplex}" -map "[outv]" -map "[outa]" -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -movflags +faststart "${outputPath}"`;

        await execAsync(ffmpegCmd, { timeout: 300000 });

        const outputDuration = await getVideoDuration(outputPath);

        await db.update(videoProjects).set({
          status: 'completed',
          outputUrl: `/uploads/video-output/${outputFilename}`,
          duration: Math.round(outputDuration),
          updatedAt: new Date(),
        }).where(eq(videoProjects.id, projectId));

        res.json({
          success: true,
          outputUrl: `/uploads/video-output/${outputFilename}`,
          duration: Math.round(outputDuration),
          editPlan: plan,
          creativeNotes: editPlan.creativeNotes,
        });
      } catch (ffmpegError: any) {
        console.error("FFmpeg error:", ffmpegError.message);

        const outputFilenameSimple = `simple_${Date.now()}.mp4`;
        const outputPathSimple = path.join(videoOutputDir, outputFilenameSimple);

        try {
          const validClips = clipOrder
            .map((idx: number) => clips[idx])
            .filter((c: any) => c && fs.existsSync(path.join(videoUploadsDir, c.filename)));

          if (validClips.length === 0) throw new Error("No valid clips");

          const listFile = path.join(videoOutputDir, `list_${Date.now()}.txt`);
          const listContent = validClips.map((c: any) =>
            `file '${path.join(videoUploadsDir, c.filename)}'`
          ).join('\n');
          fs.writeFileSync(listFile, listContent);

          await execAsync(
            `ffmpeg -y -f concat -safe 0 -i "${listFile}" -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -movflags +faststart "${outputPathSimple}"`,
            { timeout: 300000 }
          );

          fs.unlinkSync(listFile);
          const outputDuration = await getVideoDuration(outputPathSimple);

          await db.update(videoProjects).set({
            status: 'completed',
            outputUrl: `/uploads/video-output/${outputFilenameSimple}`,
            duration: Math.round(outputDuration),
            updatedAt: new Date(),
          }).where(eq(videoProjects.id, projectId));

          res.json({
            success: true,
            outputUrl: `/uploads/video-output/${outputFilenameSimple}`,
            duration: Math.round(outputDuration),
            editPlan: plan,
            creativeNotes: editPlan.creativeNotes,
            note: "Used simplified concatenation mode",
          });
        } catch (fallbackError: any) {
          console.error("Fallback FFmpeg error:", fallbackError.message);
          await db.update(videoProjects)
            .set({ status: 'failed' })
            .where(eq(videoProjects.id, projectId));
          res.status(500).json({ error: "Video processing failed" });
        }
      }
    } catch (error: any) {
      console.error("AI edit error:", error?.message || error);
      console.error("AI edit error stack:", error?.stack);
      res.status(500).json({ error: error?.message || "Failed to process video edit" });
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

  app.post("/api/studio/video-analyze", async (req, res) => {
    try {
      const { title, platform, goal, audience, cta, series, offer, mediaType: rawMediaType, duration } = req.body;

      if (!title) {
        return res.status(400).json({ error: "Title is required for analysis" });
      }

      if (rawMediaType && typeof rawMediaType === 'string') {
        const knownAliases = ['video', 'videos', 'reel', 'reels', 'image', 'images', 'photo', 'poster', 'carousel', 'post', 'caption', 'story', 'stories',
          'VIDEO', 'REEL', 'IMAGE', 'CAROUSEL', 'POST', 'STORY'];
        if (!knownAliases.includes(rawMediaType.trim().toLowerCase()) && !knownAliases.includes(rawMediaType.trim())) {
          return res.status(422).json({
            error: "MEDIA_TYPE_INVALID",
            message: `Unknown media type: "${rawMediaType}". Valid types: VIDEO, REEL, IMAGE, CAROUSEL, POST, STORY.`,
          });
        }
      }

      const mediaType = normalizeMediaType(rawMediaType || "VIDEO");
      if (mediaType !== "VIDEO" && mediaType !== "REEL") {
        return res.status(409).json({
          error: "INVALID_MEDIA_TYPE_FOR_ANALYZE",
          message: `Video analysis is only available for VIDEO or REEL content. Got: "${rawMediaType}" (normalized: ${mediaType}).`,
          mediaType,
        });
      }

      const response = await aiChat({
        model: "gpt-4.1-mini",
        max_tokens: 1800,
        accountId: req.body.accountId || "default",
        endpoint: "video-analyze",
        messages: [
          {
            role: "system",
            content: `You are a professional video director and social media content producer. Given metadata about a video, generate a complete, production-ready script breakdown. This must be executable — not ideation, not brainstorming. Every field must contain specific, actionable content a creator can film immediately.

Return ONLY valid JSON with this exact structure:
{
  "hook": "The exact opening line or action for the first 3 seconds — word-for-word what is said or shown to stop the scroll",
  "fullScript": "The complete spoken script, word-for-word, from hook to CTA. Write it as a continuous script the creator reads aloud.",
  "scenes": [
    {
      "sceneNumber": 1,
      "duration": "3-5s",
      "visualDirection": "Exact camera angle, framing, movement. Be specific: close-up, wide shot, overhead, tracking, handheld, tripod.",
      "onScreenText": "Bold text overlay shown during this scene",
      "voiceover": "Exact words spoken during this scene",
      "bRollSuggestion": "Alternative footage that could replace or supplement this scene"
    }
  ],
  "cameraDirections": "Overall filming style: lighting setup, lens recommendations, background requirements, movement patterns",
  "onScreenTextSummary": ["Array of all text overlays in sequence"],
  "bRollList": ["Array of all B-roll shots needed"],
  "ctaLine": "The exact call-to-action line spoken at the end",
  "captionDraft": "Full social media caption with line breaks and hashtags",
  "hashtags": ["hashtag1", "hashtag2", "hashtag3", "hashtag4", "hashtag5", "hashtag6", "hashtag7", "hashtag8"]
}

Generate 4-6 scenes. Every scene must have specific camera directions, not vague descriptions.`
          },
          {
            role: "user",
            content: `Produce a complete production script for this video:
Title: ${title}
Platform: ${platform || 'Instagram'}
Goal: ${goal || 'Engagement'}
Target Audience: ${audience || 'General'}
Current CTA: ${cta || 'None'}
Content Series: ${series || 'None'}
Offer/Product: ${offer || 'None'}
Media Type: ${mediaType || 'video'}
Duration: ${duration || '30-60 seconds'}

Generate a full production-ready script with scene-by-scene breakdown, exact spoken words, camera directions, and on-screen text.`
          }
        ],
      });

      const content = response.choices[0]?.message?.content || "";
      let analysis;
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
      } catch {
        analysis = null;
      }

      if (!analysis) {
        return res.status(500).json({ error: "AI failed to generate analysis" });
      }

      res.json({
        hook: analysis.hook || "",
        fullScript: analysis.fullScript || "",
        scenes: analysis.scenes || [],
        cameraDirections: analysis.cameraDirections || "",
        onScreenTextSummary: analysis.onScreenTextSummary || [],
        bRollList: analysis.bRollList || [],
        ctaLine: analysis.ctaLine || "",
        captionDraft: analysis.captionDraft || "",
        hashtags: analysis.hashtags || [],
        hookSuggestion: analysis.hook || "",
        ctaSuggestion: analysis.ctaLine || "",
        contentAngle: analysis.cameraDirections || "",
        keywords: analysis.hashtags || [],
      });
    } catch (error: any) {
      console.error("Video analyze error:", error?.message || error);
      if (error?.message?.includes("timeout") || error?.code === "ETIMEDOUT") {
        return res.status(504).json({ error: "Analysis timed out. Please try again." });
      }
      res.status(500).json({ error: error?.message || "Failed to analyze video" });
    }
  });

  app.post("/api/studio/ai-metadata", async (req, res) => {
    try {
      const { title, mediaType, platform } = req.body;

      if (!title || !title.trim()) {
        return res.status(400).json({ error: "Title is required for AI metadata generation" });
      }

      const response = await aiChat({
        model: "gpt-4.1-mini",
        max_tokens: 600,
        accountId: req.body.accountId || "default",
        endpoint: "ai-metadata",
        messages: [
          {
            role: "system",
            content: `You are a social media marketing strategist. Given a content title and media type, suggest the best publishing metadata. Return ONLY valid JSON:
{
  "goal": "The marketing goal (e.g. Drive sales, Build awareness, Generate leads, Boost engagement)",
  "audience": "Target audience description (e.g. Dubai entrepreneurs, 25-40, interested in tech)",
  "cta": "Call to action (e.g. Book now, Shop the link, DM us, Link in bio)",
  "series": "Content series name if applicable (e.g. Monday Motivation, Behind the Scenes) or empty string",
  "offer": "Offer or promotion if relevant (e.g. 20% off this week, Free consultation) or empty string"
}
Be specific and actionable. Match the goal to the content topic. Keep audience targeted.`
          },
          {
            role: "user",
            content: `Content Title: ${title.trim()}
Media Type: ${mediaType || 'video'}
Platform: ${platform || 'Instagram'}

Suggest the best publishing metadata for this content.`
          }
        ],
      });

      const content = response.choices[0]?.message?.content || "";
      let metadata;
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        metadata = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
      } catch {
        metadata = null;
      }

      if (!metadata) {
        return res.status(500).json({ error: "AI failed to generate metadata" });
      }

      res.json({
        success: true,
        goal: metadata.goal || "Boost engagement",
        audience: metadata.audience || "General audience",
        cta: metadata.cta || "Learn more",
        series: metadata.series || "",
        offer: metadata.offer || "",
      });
    } catch (error: any) {
      console.error("AI metadata error:", error?.message || error);
      res.status(500).json({ error: error?.message || "Failed to generate metadata" });
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
