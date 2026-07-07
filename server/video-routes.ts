/**
 * Video routes — Launch-Closure Wave 1 (P0-1) tenant isolation seal.
 *
 * Pre-seal state (master audit): every /api/video/* route was unauthenticated
 * and the videoProjects table had no account_id column → any caller could
 * list, read, mutate, edit, or delete any tenant's video projects (including
 * triggering ffmpeg work on attacker-supplied clips against another tenant's
 * project row).
 *
 * Seal:
 *   1. authMiddleware on every route. No more anonymous access.
 *   2. account_id stamped on insert; every read/update/delete filters by it.
 *   3. multer filename sanitised (UUID-based, no original-name interpolation
 *      into paths or shell commands).
 *   4. ffmpeg input/output paths whitelisted to videoUploadsDir/videoOutputDir
 *      and any path-traversal attempt is rejected before exec.
 */
import type { Express } from "express";
import { db } from "./db";
import { videoProjects, videoProjectCreateSchema } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import multer from "multer";
import fs from "fs";
import path from "path";
import { aiChat } from "./ai-client";
import { normalizeMediaType } from "../lib/media-types";
import { authMiddleware, resolveAccountId, type AuthRequest } from "./auth";
import { aiRateLimitPerAccount } from "./middleware/ai-rate-limit";
import { aiSpendCapPerAccount } from "./middleware/ai-spend-cap";
// Seal #3 (Task #21) F1.10/F1.11/F9.6: replace shell-form `execAsync(\`ffmpeg ...\`)`
// with arg-array `spawn("ffmpeg", [...], { shell: false })` to eliminate shell
// injection entirely, and validate AI-derived filter strings against a
// restrictive whitelist.
import { runFfmpeg, runFfprobe, validateFilterComplex } from "./video-routes-helpers";

const videoUploadsDir = path.resolve(process.cwd(), "uploads", "videos");
const videoOutputDir = path.resolve(process.cwd(), "uploads", "video-output");
if (!fs.existsSync(videoUploadsDir)) fs.mkdirSync(videoUploadsDir, { recursive: true });
if (!fs.existsSync(videoOutputDir)) fs.mkdirSync(videoOutputDir, { recursive: true });

// P0-1: every clip filename used in ffmpeg MUST resolve inside videoUploadsDir.
// Caller-supplied `clip.filename` was previously interpolated raw into the
// shell command — an attacker could supply `../../etc/passwd` and read host
// files. We now resolve the candidate path and assert containment.
function safeUploadPath(filename: string): string | null {
  if (typeof filename !== "string" || !filename) return null;
  // Reject anything that looks like a path; only the bare leaf filename is allowed.
  const base = path.basename(filename);
  if (base !== filename) return null;
  const candidate = path.resolve(videoUploadsDir, base);
  if (!candidate.startsWith(videoUploadsDir + path.sep)) return null;
  return candidate;
}

const videoUpload = multer({
  storage: multer.diskStorage({
    destination: videoUploadsDir,
    // P0-1: filename derives ONLY from server-side entropy. Original-name
    // extension is sanitised to alphanum to block shell-meta in extensions.
    filename: (_req, file, cb) => {
      const rawExt = path.extname(file.originalname || "").toLowerCase();
      const safeExt = /^\.[a-z0-9]{1,8}$/.test(rawExt) ? rawExt : ".mp4";
      const uniqueName = Date.now() + "-" + Math.random().toString(36).substr(2, 9) + safeExt;
      cb(null, uniqueName);
    },
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const videoExtensions = [".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v", ".3gp"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.mimetype.startsWith("video/") || file.mimetype === "application/octet-stream" || videoExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Only video files are allowed"));
    }
  },
});

async function getVideoDuration(filePath: string): Promise<number> {
  try {
    // Seal #3 F9.6: arg-array spawn — no shell, no interpolation.
    const { stdout } = await runFfprobe(
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath],
      { timeoutMs: 30_000 },
    );
    return parseFloat(stdout.trim()) || 0;
  } catch {
    return 0;
  }
}

async function getVideoInfo(filePath: string): Promise<{ duration: number; width: number; height: number }> {
  try {
    const { stdout } = await runFfprobe(
      ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,duration", "-show_entries", "format=duration", "-of", "json", filePath],
      { timeoutMs: 30_000 },
    );
    const info = JSON.parse(stdout);
    const stream = info.streams?.[0] || {};
    const duration = parseFloat(stream.duration || info.format?.duration || "0");
    return { duration, width: stream.width || 1920, height: stream.height || 1080 };
  } catch {
    return { duration: 0, width: 1920, height: 1080 };
  }
}

/**
 * P0-1 helper: load a video project row IFF it belongs to the authed tenant.
 * Returns null on miss — callers respond 404 to avoid leaking row existence.
 */
async function loadOwnedProject(projectId: string, accountId: string) {
  const [row] = await db
    .select()
    .from(videoProjects)
    .where(and(eq(videoProjects.id, projectId), eq(videoProjects.accountId, accountId)))
    .limit(1);
  return row || null;
}

export function registerVideoRoutes(app: Express) {
  app.use("/uploads/videos", (_req, res, next) => {
    res.setHeader("Accept-Ranges", "bytes");
    next();
  });

  app.post(
    "/api/video/upload-clips",
    authMiddleware,
    (req, res, next) => {
      videoUpload.array("clips", 20)(req, res, (err) => {
        if (err) {
          console.error("Multer upload error:", err.message);
          return res.status(400).json({ error: `Upload error: ${err.message}` });
        }
        next();
      });
    },
    async (req: AuthRequest, res) => {
      try {
        const accountId = resolveAccountId(req);
        const files = req.files as Express.Multer.File[];
        console.log("Upload request received:", {
          accountId,
          filesCount: files?.length || 0,
          contentType: req.headers["content-type"],
        });
        if (!files || files.length === 0) {
          return res.status(400).json({ error: "No video files uploaded" });
        }

        // Seal #3 F1.10: validate body BEFORE any DB write or filesystem
        // commitment. Strict schema → unknown keys (e.g. accountId, status,
        // outputUrl) are REJECTED. Multer parses multipart text fields as
        // strings on req.body, so the schema sees raw user input.
        const parsedBody = videoProjectCreateSchema.safeParse(req.body);
        if (!parsedBody.success) {
          // Clean up the just-uploaded files since we won't be persisting a
          // project row that points at them.
          for (const f of files) {
            try { fs.unlinkSync(path.join(videoUploadsDir, f.filename)); } catch {}
          }
          const issues = parsedBody.error.issues.map(i => ({
            field: i.path.join("."),
            code: i.code,
          }));
          return res.status(400).json({ error: "INVALID_BODY", issues });
        }
        const bodyData = parsedBody.data;

        const clips = await Promise.all(
          files.map(async (file) => {
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
          }),
        );

        const [project] = await db
          .insert(videoProjects)
          .values({
            accountId, // P0-1
            title: bodyData.title || "Untitled Project",
            status: "uploaded",
            clipCount: clips.length,
            style: bodyData.style || "cinematic",
            mood: bodyData.mood || "energetic",
          })
          .returning();

        res.json({ project, clips });
      } catch (error) {
        console.error("Video upload error:", error);
        res.status(500).json({ error: "Failed to upload video clips" });
      }
    },
  );

  app.post("/api/video/ai-edit", authMiddleware, aiRateLimitPerAccount(), aiSpendCapPerAccount(), async (req: AuthRequest, res) => {
    try {
      const accountId = resolveAccountId(req);
      const { projectId, clips, style, mood, pace, addMusic, addTransitions, addText, textOverlay, creativeBrief, videoType, targetAudience, keyMessage } = req.body;

      if (!projectId) return res.status(400).json({ error: "projectId is required" });
      if (!clips || clips.length === 0) {
        return res.status(400).json({ error: "No clips provided" });
      }

      // P0-1: assert ownership BEFORE any work. Avoids both data leak and
      // attacker-driven ffmpeg exec on victim's project.
      const owned = await loadOwnedProject(projectId, accountId);
      if (!owned) return res.status(404).json({ error: "Project not found" });

      // P0-1: every supplied clip filename must be a leaf inside videoUploadsDir.
      // Reject the request if ANY clip path is malformed/traversal.
      for (const c of clips as any[]) {
        if (!safeUploadPath(c?.filename || "")) {
          return res.status(400).json({ error: "Invalid clip filename" });
        }
      }

      await db.update(videoProjects)
        .set({ status: "processing", style, mood })
        .where(and(eq(videoProjects.id, projectId), eq(videoProjects.accountId, accountId)));

      const clipDetails = clips
        .map((c: any, i: number) => `Clip ${i + 1}: "${c.originalName}" (${c.duration?.toFixed(1)}s, ${c.width}x${c.height})`)
        .join("\n");

      const aiResponse = await aiChat({
        model: "gpt-5.2",
        max_tokens: 800,
        accountId,
        endpoint: "video-brief",
        messages: [
          {
            role: "system",
            content: `You are Avyron AI, an elite AI video editor and creative director. You create professional, broadcast-quality edit decisions for video projects. You deeply understand cinematic language, pacing, transitions, color grading, storytelling through visual media, and marketing psychology.

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
}`,
          },
          {
            role: "user",
            content: `Create a professional edit plan for this video project.

=== CREATIVE BRIEF ===
${creativeBrief || "Create a professional, engaging video edit."}

=== VIDEO TYPE ===
${videoType || "promo"}

=== TARGET AUDIENCE ===
${targetAudience || "General audience"}

=== KEY MESSAGE ===
${keyMessage || "Not specified"}

=== EDIT PREFERENCES ===
STYLE: ${style || "cinematic"}
MOOD: ${mood || "energetic"}
PACE: ${pace || "medium"}
ADD TRANSITIONS: ${addTransitions !== false ? "Yes" : "No"}
ADD TEXT OVERLAY: ${addText ? "Yes" : "No"}
TEXT TO OVERLAY: ${textOverlay || "None specified"}

=== AVAILABLE CLIPS ===
${clipDetails}

Based on the creative brief above, create an edit plan that fulfills the client's vision. Consider the video type, target audience, and key message when making your editing decisions. Determine the best clip order for storytelling, trim to keep the strongest moments, choose transitions that match the mood, and suggest appropriate color grading.`,
          },
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
          .set({ status: "failed" })
          .where(and(eq(videoProjects.id, projectId), eq(videoProjects.accountId, accountId)));
        return res.status(500).json({ error: "AI failed to generate edit plan" });
      }

      const plan = editPlan.editPlan || editPlan;
      const clipOrder = plan.clipOrder || clips.map((_: any, i: number) => i);
      const outputFilename = `edited_${Date.now()}.mp4`;
      const outputPath = path.join(videoOutputDir, outputFilename);

      try {
        const filterParts: string[] = [];
        const concatInputs: string[] = [];
        let inputArgs = "";

        for (let i = 0; i < clipOrder.length; i++) {
          const clipIdx = clipOrder[i];
          const clip = clips[clipIdx];
          if (!clip) continue;

          const clipPath = safeUploadPath(clip.filename);
          if (!clipPath || !fs.existsSync(clipPath)) continue;

          inputArgs += ` -i "${clipPath}"`;

          const clipPlan = plan.clips?.find((c: any) => c.index === clipIdx);
          const startTime = Number.isFinite(clipPlan?.startTime) ? Number(clipPlan.startTime) : 0;
          const endTime = Number.isFinite(clipPlan?.endTime) ? Number(clipPlan.endTime) : (clip.duration || 10);

          filterParts.push(
            `[${i}:v]trim=start=${startTime}:end=${endTime},setpts=PTS-STARTPTS,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2[v${i}]`,
          );
          filterParts.push(`[${i}:a]atrim=start=${startTime}:end=${endTime},asetpts=PTS-STARTPTS[a${i}]`);
          concatInputs.push(`[v${i}][a${i}]`);
        }

        if (concatInputs.length === 0) {
          await db.update(videoProjects)
            .set({ status: "failed" })
            .where(and(eq(videoProjects.id, projectId), eq(videoProjects.accountId, accountId)));
          return res.status(500).json({ error: "No valid clips to process" });
        }

        const filterComplex = filterParts.join(";") + ";" + concatInputs.join("") + `concat=n=${concatInputs.length}:v=1:a=1[outv][outa]`;

        // Seal #3 F1.11/F9.6: defense-in-depth. The filter string is built
        // from server-controlled templates with AI-derived NUMERIC values
        // (already coerced via Number.isFinite above), but we still gate on
        // the whitelist before spawn so any future regression that lets an
        // LLM-supplied string flow into the filter is caught here.
        const filterCheck = validateFilterComplex(filterComplex);
        if (!filterCheck.ok) {
          await db.update(videoProjects)
            .set({ status: "failed" })
            .where(and(eq(videoProjects.id, projectId), eq(videoProjects.accountId, accountId)));
          return res.status(400).json({ error: "INVALID_FILTER", reason: filterCheck.reason });
        }

        // Seal #3 F1.11: arg-array spawn (shell:false) — every input path,
        // every flag, every value is a separate argv element so shell
        // metacharacters cannot escape into a shell.
        // Build the inputs array by reusing the same safeUploadPath that
        // gated the filter graph above (concatInputs/filterParts walks the
        // same clipOrder loop, so the index alignment is preserved).
        const inputPathArgs: string[] = [];
        for (let i = 0; i < clipOrder.length; i++) {
          const clipIdx = clipOrder[i];
          const c = clips[clipIdx];
          if (!c) continue;
          const p = safeUploadPath(c.filename);
          if (!p || !fs.existsSync(p)) continue;
          inputPathArgs.push("-i", p);
        }
        const ffmpegArgs = [
          "-y",
          ...inputPathArgs,
          "-filter_complex", filterComplex,
          "-map", "[outv]",
          "-map", "[outa]",
          "-c:v", "libx264",
          "-preset", "fast",
          "-crf", "23",
          "-c:a", "aac",
          "-b:a", "128k",
          "-movflags", "+faststart",
          outputPath,
        ];
        await runFfmpeg(ffmpegArgs, { timeoutMs: 300_000 });

        const outputDuration = await getVideoDuration(outputPath);

        await db
          .update(videoProjects)
          .set({
            status: "completed",
            outputUrl: `/uploads/video-output/${outputFilename}`,
            duration: Math.round(outputDuration),
            updatedAt: new Date(),
          })
          .where(and(eq(videoProjects.id, projectId), eq(videoProjects.accountId, accountId)));

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
            .filter((c: any) => {
              const p = safeUploadPath(c?.filename || "");
              return p && fs.existsSync(p);
            });

          if (validClips.length === 0) throw new Error("No valid clips");

          const listFile = path.join(videoOutputDir, `list_${Date.now()}.txt`);
          // Seal #3 F1.11: ffmpeg's concat-demuxer list file uses single
          // quotes around the path. safeUploadPath has already validated
          // the basename has no path separators or shell metacharacters, so
          // the embedded path is always a leaf inside videoUploadsDir. Even
          // so, defensively strip any single-quote that somehow makes it
          // through (cannot happen with the current validator, but keeps
          // the file format unparseable for an attacker if the validator
          // ever regresses).
          const listContent = validClips
            .map((c: any) => `file '${String(safeUploadPath(c.filename)).replace(/'/g, "")}'`)
            .join("\n");
          fs.writeFileSync(listFile, listContent);

          await runFfmpeg(
            [
              "-y",
              "-f", "concat",
              "-safe", "0",
              "-i", listFile,
              "-c:v", "libx264",
              "-preset", "fast",
              "-crf", "23",
              "-c:a", "aac",
              "-b:a", "128k",
              "-movflags", "+faststart",
              outputPathSimple,
            ],
            { timeoutMs: 300_000 },
          );

          fs.unlinkSync(listFile);
          const outputDuration = await getVideoDuration(outputPathSimple);

          await db
            .update(videoProjects)
            .set({
              status: "completed",
              outputUrl: `/uploads/video-output/${outputFilenameSimple}`,
              duration: Math.round(outputDuration),
              updatedAt: new Date(),
            })
            .where(and(eq(videoProjects.id, projectId), eq(videoProjects.accountId, accountId)));

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
          await db
            .update(videoProjects)
            .set({ status: "failed" })
            .where(and(eq(videoProjects.id, projectId), eq(videoProjects.accountId, accountId)));
          res.status(500).json({ error: "Video processing failed" });
        }
      }
    } catch (error: any) {
      console.error("AI edit error:", error?.message || error);
      console.error("AI edit error stack:", error?.stack);
      res.status(500).json({ error: error?.message || "Failed to process video edit" });
    }
  });

  // P0-1: list filtered by tenant.
  app.get("/api/video/projects", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const accountId = resolveAccountId(req);
      const projects = await db
        .select()
        .from(videoProjects)
        .where(eq(videoProjects.accountId, accountId))
        .orderBy(desc(videoProjects.createdAt));
      res.json(projects);
    } catch (error) {
      console.error("List projects error:", error);
      res.status(500).json({ error: "Failed to load projects" });
    }
  });

  // P0-1: single-row read scoped to tenant. 404 on miss (don't leak existence).
  app.get("/api/video/projects/:id", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const accountId = resolveAccountId(req);
      const project = await loadOwnedProject(req.params.id, accountId);
      if (!project) return res.status(404).json({ error: "Project not found" });
      res.json(project);
    } catch (error) {
      console.error("Get project error:", error);
      res.status(500).json({ error: "Failed to load project" });
    }
  });

  app.post("/api/studio/video-analyze", authMiddleware, aiRateLimitPerAccount(), aiSpendCapPerAccount(), async (req: AuthRequest, res) => {
    try {
      const accountId = resolveAccountId(req);
      const { title, platform, goal, audience, cta, series, offer, mediaType: rawMediaType, duration } = req.body;

      if (!title) {
        return res.status(400).json({ error: "Title is required for analysis" });
      }

      if (rawMediaType && typeof rawMediaType === "string") {
        const knownAliases = [
          "video", "videos", "reel", "reels", "image", "images", "photo", "poster", "carousel", "post", "caption", "story", "stories",
          "VIDEO", "REEL", "IMAGE", "CAROUSEL", "POST", "STORY",
        ];
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
        accountId,
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

Generate 4-6 scenes. Every scene must have specific camera directions, not vague descriptions.`,
          },
          {
            role: "user",
            content: `Produce a complete production script for this video:
Title: ${title}
Platform: ${platform || "Instagram"}
Goal: ${goal || "Engagement"}
Target Audience: ${audience || "General"}
Current CTA: ${cta || "None"}
Content Series: ${series || "None"}
Offer/Product: ${offer || "None"}
Media Type: ${mediaType || "video"}
Duration: ${duration || "30-60 seconds"}

Generate a full production-ready script with scene-by-scene breakdown, exact spoken words, camera directions, and on-screen text.`,
          },
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

  app.post("/api/studio/ai-metadata", authMiddleware, aiRateLimitPerAccount(), aiSpendCapPerAccount(), async (req: AuthRequest, res) => {
    try {
      const accountId = resolveAccountId(req);
      const { title, mediaType, platform } = req.body;

      if (!title || !title.trim()) {
        return res.status(400).json({ error: "Title is required for AI metadata generation" });
      }

      const response = await aiChat({
        model: "gpt-4.1-mini",
        max_tokens: 600,
        accountId,
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
Be specific and actionable. Match the goal to the content topic. Keep audience targeted.`,
          },
          {
            role: "user",
            content: `Content Title: ${title.trim()}
Media Type: ${mediaType || "video"}
Platform: ${platform || "Instagram"}

Suggest the best publishing metadata for this content.`,
          },
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

  // P0-1: delete scoped to tenant. 404 if not owned (no existence leak).
  app.delete("/api/video/projects/:id", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const accountId = resolveAccountId(req);
      const result = await db
        .delete(videoProjects)
        .where(and(eq(videoProjects.id, req.params.id), eq(videoProjects.accountId, accountId)))
        .returning({ id: videoProjects.id });
      if (result.length === 0) return res.status(404).json({ error: "Project not found" });
      res.json({ success: true });
    } catch (error) {
      console.error("Delete project error:", error);
      res.status(500).json({ error: "Failed to delete project" });
    }
  });
}
