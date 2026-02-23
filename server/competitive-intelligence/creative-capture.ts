import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { ProxyAgent } from "undici";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import type { ScrapedPost } from "./profile-scraper";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const geminiAi = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY || "",
  httpOptions: {
    baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL || "",
  },
});

const CACHE_DIR = "/tmp/ci-creative-cache";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FRAME_TIMESTAMPS = [0, 0.5, 1.5, 3, 5];
const MAX_REELS_PER_COMPETITOR = 5;
const RATE_LIMIT_MS = 60 * 1000;

let lastCompetitorTime = 0;

function ensureCacheDir(): void {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function cleanExpiredCache(): void {
  if (!fs.existsSync(CACHE_DIR)) return;
  const now = Date.now();
  try {
    const files = fs.readdirSync(CACHE_DIR);
    for (const file of files) {
      const filePath = path.join(CACHE_DIR, file);
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > CACHE_TTL_MS) {
        if (stat.isDirectory()) {
          fs.rmSync(filePath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(filePath);
        }
      }
    }
  } catch {}
}

function getProxyConfig(): { url: string; host: string; port: string; username: string; password: string } | null {
  const host = process.env.BRIGHT_DATA_PROXY_HOST;
  const port = process.env.BRIGHT_DATA_PROXY_PORT;
  const username = process.env.BRIGHT_DATA_PROXY_USERNAME;
  const password = process.env.BRIGHT_DATA_PROXY_PASSWORD;
  if (!host || !port || !username || !password) return null;
  return { url: `http://${username}:${password}@${host}:${port}`, host, port, username, password };
}

function getProxyDispatcher(): ProxyAgent | undefined {
  const proxy = getProxyConfig();
  if (!proxy) return undefined;
  return new ProxyAgent({
    uri: proxy.url,
    requestTls: { rejectUnauthorized: false },
  });
}

export interface FrameOcrResult {
  frameTimestamp: string;
  extractedText: string;
  confidence: number;
  languageHint: "EN" | "AR" | "MIXED" | "UNKNOWN";
}

export interface DeterministicSignals {
  ctaSignals: { text: string; source: string; language: string }[];
  offerSignals: { text: string; source: string; language: string }[];
  urgencySignals: { text: string; source: string; language: string }[];
}

export interface EvidencePack {
  reelPermalink: string;
  shortcode: string;
  sourcesAttempted: string[];
  sourcesSucceeded: string[];
  warnings: { source: string; code: string; reason: string }[];

  captionFirstLine: string | null;
  fullCaption: string | null;
  pinnedCommentText: string | null;
  hashtagsScan: string[];

  ocrTopLines: string[];
  ocrFullText: string;
  ocrFrameResults: FrameOcrResult[];

  transcript: string | null;
  transcriptConfidence: number | null;

  deterministicSignals: DeterministicSignals;

  status: "COMPLETE" | "PARTIAL";
}

export interface InterpretedSignals {
  hookCandidates: { text: string; source: string; confidence: number; status: "MEASURED" }[];
  ctaSignals: { text: string; source: string; confidence: number; status: "MEASURED" }[];
  offerSignals: { text: string; source: string; confidence: number; status: "MEASURED" }[];
  proofSignals: { text: string; source: string; confidence: number; status: "MEASURED" }[];
  unavailable: { signal: string; reason: string; status: "UNAVAILABLE" }[];
}

export interface CreativeCaptureResult {
  reelPermalink: string;
  evidencePack: EvidencePack;
  interpreted: InterpretedSignals;
}

const CTA_PATTERNS_EN = /\b(dm\s*(us|me|now)?|comment\s*(below)?|book\s*(now|a\s*call|today)?|whatsapp|link\s*in\s*bio|tap|swipe\s*up|call\s*(us|now)|order\s*(now|today)?|sign\s*up|register|subscribe|shop\s*now|get\s*started|learn\s*more|apply\s*now|send\s*(a\s*)?message|click|grab)\b/gi;
const CTA_PATTERNS_AR = /(احجز|تواصل|رسالة|اطلب|اضغط|سجل|اشترك|تسوق|ابدأ|اتصل|ارسل|اطلع)/g;

const OFFER_PATTERNS_EN = /\b(AED|USD|SAR|\$|€|free|starting\s*from|starts?\s*at|audit|consultation|off|discount|deal|offer|bonus|save|promo|trial|sample|complimentary|no\s*cost)\b/gi;
const OFFER_PATTERNS_AR = /(مجاني|خصم|عرض|يبدأ من|تدقيق|استشارة|تجربة|هدية|توفير|سعر)/g;

const URGENCY_PATTERNS_EN = /\b(today|limited|deadline|spots?\s*left|last\s*chance|ends?\s*(soon|today)?|hurry|now\s*or\s*never|don'?t\s*miss|act\s*now|only\s*\d+|few\s*left|closing\s*soon|expires?|countdown|rush|asap)\b/gi;
const URGENCY_PATTERNS_AR = /(اليوم|محدود|آخر فرصة|ينتهي|عجل|لا تفوت|باقي|قريبا|حصري|الآن)/g;

function extractDeterministicSignals(text: string, source: string): DeterministicSignals {
  const ctaSignals: DeterministicSignals["ctaSignals"] = [];
  const offerSignals: DeterministicSignals["offerSignals"] = [];
  const urgencySignals: DeterministicSignals["urgencySignals"] = [];

  const seen = new Set<string>();

  for (const match of text.matchAll(CTA_PATTERNS_EN)) {
    const key = `cta_en_${match[0].toLowerCase()}`;
    if (!seen.has(key)) { seen.add(key); ctaSignals.push({ text: match[0], source, language: "EN" }); }
  }
  for (const match of text.matchAll(CTA_PATTERNS_AR)) {
    const key = `cta_ar_${match[0]}`;
    if (!seen.has(key)) { seen.add(key); ctaSignals.push({ text: match[0], source, language: "AR" }); }
  }

  for (const match of text.matchAll(OFFER_PATTERNS_EN)) {
    const key = `offer_en_${match[0].toLowerCase()}`;
    if (!seen.has(key)) { seen.add(key); offerSignals.push({ text: match[0], source, language: "EN" }); }
  }
  for (const match of text.matchAll(OFFER_PATTERNS_AR)) {
    const key = `offer_ar_${match[0]}`;
    if (!seen.has(key)) { seen.add(key); offerSignals.push({ text: match[0], source, language: "AR" }); }
  }

  for (const match of text.matchAll(URGENCY_PATTERNS_EN)) {
    const key = `urg_en_${match[0].toLowerCase()}`;
    if (!seen.has(key)) { seen.add(key); urgencySignals.push({ text: match[0], source, language: "EN" }); }
  }
  for (const match of text.matchAll(URGENCY_PATTERNS_AR)) {
    const key = `urg_ar_${match[0]}`;
    if (!seen.has(key)) { seen.add(key); urgencySignals.push({ text: match[0], source, language: "AR" }); }
  }

  return { ctaSignals, offerSignals, urgencySignals };
}

function mergeSignals(...signalSets: DeterministicSignals[]): DeterministicSignals {
  const merged: DeterministicSignals = { ctaSignals: [], offerSignals: [], urgencySignals: [] };
  const seen = new Set<string>();

  for (const s of signalSets) {
    for (const sig of s.ctaSignals) {
      const key = `cta_${sig.text.toLowerCase()}_${sig.language}`;
      if (!seen.has(key)) { seen.add(key); merged.ctaSignals.push(sig); }
    }
    for (const sig of s.offerSignals) {
      const key = `offer_${sig.text.toLowerCase()}_${sig.language}`;
      if (!seen.has(key)) { seen.add(key); merged.offerSignals.push(sig); }
    }
    for (const sig of s.urgencySignals) {
      const key = `urg_${sig.text.toLowerCase()}_${sig.language}`;
      if (!seen.has(key)) { seen.add(key); merged.urgencySignals.push(sig); }
    }
  }

  return merged;
}

async function downloadAsset(url: string, destPath: string): Promise<boolean> {
  const dispatcher = getProxyDispatcher();
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  };
  const fetchOptions: any = { headers, redirect: "follow" };
  if (dispatcher) fetchOptions.dispatcher = dispatcher;

  try {
    const response = await fetch(url, fetchOptions);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(destPath, buffer);
    console.log(`[Creative Capture] Downloaded ${(buffer.length / 1024).toFixed(1)} KB → ${path.basename(destPath)}`);
    return true;
  } catch (err: any) {
    console.log(`[Creative Capture] Download failed: ${err.message}`);
    return false;
  }
}

function extractFrames(videoPath: string, outputDir: string): string[] {
  const frames: string[] = [];
  let duration = 10;

  try {
    const durationStr = execSync(
      `ffprobe -v quiet -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`,
      { timeout: 15000 }
    ).toString().trim();
    duration = parseFloat(durationStr) || 10;
  } catch {}

  const timestamps = [...FRAME_TIMESTAMPS.filter(t => t < duration), Math.max(0, duration - 0.1)];

  for (const ts of timestamps) {
    const framePath = path.join(outputDir, `frame_${ts.toFixed(1).replace(".", "_")}s.png`);
    try {
      execSync(
        `ffmpeg -ss ${ts} -i "${videoPath}" -vframes 1 -q:v 2 -y "${framePath}" 2>/dev/null`,
        { timeout: 15000 }
      );
      if (fs.existsSync(framePath) && fs.statSync(framePath).size > 100) {
        frames.push(framePath);
      }
    } catch {}
  }

  console.log(`[Creative Capture] Extracted ${frames.length} frames from video (duration: ${duration.toFixed(1)}s)`);
  return frames;
}

function extractAudio(videoPath: string, outputDir: string): string | null {
  const audioPath = path.join(outputDir, "audio.mp3");
  try {
    execSync(
      `ffmpeg -i "${videoPath}" -vn -acodec libmp3lame -q:a 4 -y "${audioPath}" 2>/dev/null`,
      { timeout: 30000 }
    );
    if (fs.existsSync(audioPath) && fs.statSync(audioPath).size > 1000) {
      console.log(`[Creative Capture] Extracted audio (${(fs.statSync(audioPath).size / 1024).toFixed(1)} KB)`);
      return audioPath;
    }
  } catch {}
  return null;
}

async function runOcrOnFrames(framePaths: string[]): Promise<FrameOcrResult[]> {
  const results: FrameOcrResult[] = [];

  for (const framePath of framePaths) {
    const frameTs = path.basename(framePath).replace("frame_", "").replace("s.png", "s").replace("_", ".");
    try {
      const imageBytes = fs.readFileSync(framePath);
      const base64 = imageBytes.toString("base64");

      const response = await geminiAi.models.generateContent({
        model: "gemini-2.0-flash",
        contents: [{
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType: "image/png",
                data: base64,
              },
            },
            {
              text: `Extract ALL visible text from this video frame. Include text overlays, titles, captions, watermarks, buttons, and any readable text.

Return a JSON object with exactly these fields:
{
  "extracted_text": "all text found, separated by newlines",
  "confidence": 0.0 to 1.0,
  "language_hint": "EN" or "AR" or "MIXED" or "UNKNOWN"
}

If no text is visible, return {"extracted_text": "", "confidence": 1.0, "language_hint": "UNKNOWN"}.
Return ONLY the JSON object, no markdown.`,
            },
          ],
        }],
      });

      const content = response?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const cleanJson = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

      try {
        const parsed = JSON.parse(cleanJson);
        results.push({
          frameTimestamp: frameTs,
          extractedText: parsed.extracted_text || "",
          confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
          languageHint: ["EN", "AR", "MIXED", "UNKNOWN"].includes(parsed.language_hint) ? parsed.language_hint : "UNKNOWN",
        });
      } catch {
        results.push({
          frameTimestamp: frameTs,
          extractedText: content.substring(0, 500),
          confidence: 0.3,
          languageHint: "UNKNOWN",
        });
      }
    } catch (err: any) {
      console.log(`[Creative Capture] OCR failed for ${frameTs}: ${err.message}`);
      results.push({
        frameTimestamp: frameTs,
        extractedText: "",
        confidence: 0,
        languageHint: "UNKNOWN",
      });
    }
  }

  return results;
}

function deduplicateOcrText(ocrResults: FrameOcrResult[]): { topLines: string[]; fullText: string } {
  const lineFrequency = new Map<string, { count: number; maxConfidence: number }>();

  for (const result of ocrResults) {
    if (!result.extractedText) continue;
    const lines = result.extractedText.split(/\n/).map(l => l.trim()).filter(l => l.length > 0);
    for (const line of lines) {
      const normalized = line.toLowerCase().replace(/\s+/g, " ");
      const existing = lineFrequency.get(normalized);
      if (existing) {
        existing.count++;
        existing.maxConfidence = Math.max(existing.maxConfidence, result.confidence);
      } else {
        lineFrequency.set(normalized, { count: 1, maxConfidence: result.confidence });
      }
    }
  }

  const sorted = [...lineFrequency.entries()]
    .sort((a, b) => (b[1].maxConfidence * b[1].count) - (a[1].maxConfidence * a[1].count));

  const topLines = sorted.slice(0, 15).map(([line]) => line);
  const fullText = sorted.map(([line]) => line).join("\n");

  return { topLines, fullText };
}

async function transcribeAudio(audioPath: string): Promise<{ transcript: string; confidence: number } | null> {
  try {
    const audioFile = fs.createReadStream(audioPath);
    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: "whisper-1",
      response_format: "verbose_json",
    });

    const text = (transcription as any).text || "";
    const segments = (transcription as any).segments || [];
    const avgConfidence = segments.length > 0
      ? segments.reduce((sum: number, s: any) => sum + (s.avg_logprob || -1), 0) / segments.length
      : -0.5;
    const confidence = Math.max(0, Math.min(1, 1 + avgConfidence));

    console.log(`[Creative Capture] Transcribed ${text.length} chars, confidence: ${confidence.toFixed(2)}`);
    return { transcript: text, confidence };
  } catch (err: any) {
    console.log(`[Creative Capture] Transcription failed: ${err.message}`);
    return null;
  }
}

async function fetchPinnedComment(shortcode: string): Promise<string | null> {
  if (!shortcode) return null;

  const postUrl = `https://www.instagram.com/p/${shortcode}/`;
  const dispatcher = getProxyDispatcher();
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
  };

  const fetchOptions: any = { headers, redirect: "follow" };
  if (dispatcher) fetchOptions.dispatcher = dispatcher;

  try {
    const response = await fetch(postUrl, fetchOptions);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();

    const sharedDataMatch = html.match(/window\._sharedData\s*=\s*({.+?});<\/script>/s);
    if (sharedDataMatch) {
      const sharedData = JSON.parse(sharedDataMatch[1]);
      const media = sharedData?.entry_data?.PostPage?.[0]?.graphql?.shortcode_media;
      if (media) {
        const comments = media.edge_media_to_parent_comment?.edges || [];
        for (const edge of comments) {
          if (edge.node?.is_pinned) {
            return edge.node.text || null;
          }
        }
      }
    }

    const additionalDataMatch = html.match(/window\.__additionalDataLoaded\s*\([^,]+,\s*({.+?})\s*\);<\/script>/s);
    if (additionalDataMatch) {
      const data = JSON.parse(additionalDataMatch[1]);
      const media = data?.graphql?.shortcode_media || data?.shortcode_media;
      if (media) {
        const comments = media.edge_media_to_parent_comment?.edges || [];
        for (const edge of comments) {
          if (edge.node?.is_pinned) {
            return edge.node.text || null;
          }
        }
      }
    }

    const jsonMatches = html.matchAll(/"is_pinned"\s*:\s*true/g);
    for (const _ of jsonMatches) {
      const commentBlockMatch = html.match(/"text"\s*:\s*"([^"]{3,500})"\s*[,}][\s\S]{0,200}"is_pinned"\s*:\s*true/);
      if (commentBlockMatch) {
        return commentBlockMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
      }
      const reverseMatch = html.match(/"is_pinned"\s*:\s*true[\s\S]{0,200}"text"\s*:\s*"([^"]{3,500})"/);
      if (reverseMatch) {
        return reverseMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
      }
    }

    return null;
  } catch (err: any) {
    console.log(`[Creative Capture] Pinned comment fetch failed for ${shortcode}: ${err.message}`);
    return null;
  }
}

function extractHashtags(text: string): string[] {
  const matches = text.match(/#[\w\u0600-\u06FF]+/g) || [];
  return [...new Set(matches.map(h => h.toLowerCase()))];
}

async function buildEvidencePack(post: ScrapedPost): Promise<EvidencePack> {
  const sourcesAttempted: string[] = [];
  const sourcesSucceeded: string[] = [];
  const warnings: EvidencePack["warnings"] = [];

  ensureCacheDir();
  cleanExpiredCache();

  const reelDir = path.join(CACHE_DIR, `reel_${post.shortcode || crypto.randomUUID().substring(0, 8)}`);
  if (!fs.existsSync(reelDir)) fs.mkdirSync(reelDir, { recursive: true });

  const captionFirstLine = post.caption ? post.caption.split("\n")[0].substring(0, 300) : null;
  const fullCaption = post.caption || null;
  const hashtagsScan = post.caption ? extractHashtags(post.caption) : [];

  let ocrFrameResults: FrameOcrResult[] = [];
  let ocrTopLines: string[] = [];
  let ocrFullText = "";
  let transcript: string | null = null;
  let transcriptConfidence: number | null = null;
  let pinnedCommentText: string | null = null;

  sourcesAttempted.push("caption");
  if (fullCaption) {
    sourcesSucceeded.push("caption");
  } else {
    warnings.push({ source: "caption", code: "CAPTION_EMPTY", reason: "No caption text available for this reel" });
  }

  sourcesAttempted.push("pinned_comment");
  try {
    pinnedCommentText = await fetchPinnedComment(post.shortcode);
    if (pinnedCommentText) {
      sourcesSucceeded.push("pinned_comment");
      console.log(`[Creative Capture] Found pinned comment for ${post.shortcode}: "${pinnedCommentText.substring(0, 80)}..."`);
    } else {
      warnings.push({ source: "pinned_comment", code: "PINNED_COMMENT_UNAVAILABLE", reason: "No pinned comment found on this post" });
    }
  } catch (err: any) {
    warnings.push({ source: "pinned_comment", code: "PINNED_COMMENT_UNAVAILABLE", reason: `Fetch failed: ${err.message}` });
  }

  let videoDownloaded = false;
  let thumbnailPath: string | null = null;

  if (post.videoUrl) {
    sourcesAttempted.push("video");
    const videoPath = path.join(reelDir, "video.mp4");
    videoDownloaded = await downloadAsset(post.videoUrl, videoPath);
    if (videoDownloaded) {
      sourcesSucceeded.push("video");

      sourcesAttempted.push("video_frames");
      const framePaths = extractFrames(videoPath, reelDir);
      if (framePaths.length > 0) {
        sourcesSucceeded.push("video_frames");
        ocrFrameResults = await runOcrOnFrames(framePaths);
        const deduped = deduplicateOcrText(ocrFrameResults);
        ocrTopLines = deduped.topLines;
        ocrFullText = deduped.fullText;
      } else {
        warnings.push({ source: "video_frames", code: "FRAME_EXTRACTION_FAILED", reason: "FFmpeg could not extract frames from video" });
      }

      sourcesAttempted.push("audio");
      const audioPath = extractAudio(videoPath, reelDir);
      if (audioPath) {
        const result = await transcribeAudio(audioPath);
        if (result) {
          sourcesSucceeded.push("audio");
          transcript = result.transcript;
          transcriptConfidence = result.confidence;
        } else {
          warnings.push({ source: "audio", code: "AUDIO_UNAVAILABLE", reason: "Whisper transcription failed" });
        }
      } else {
        warnings.push({ source: "audio", code: "AUDIO_UNAVAILABLE", reason: "No audio track found in video" });
      }
    } else {
      warnings.push({ source: "video", code: "VIDEO_DOWNLOAD_FAILED", reason: "Could not download video file" });
    }
  } else {
    warnings.push({ source: "video", code: "VIDEO_DOWNLOAD_FAILED", reason: "No video_url available from scraper" });
  }

  if (!videoDownloaded && post.displayUrl) {
    sourcesAttempted.push("thumbnail");
    thumbnailPath = path.join(reelDir, "thumbnail.jpg");
    const thumbOk = await downloadAsset(post.displayUrl, thumbnailPath);
    if (thumbOk) {
      sourcesSucceeded.push("thumbnail");
      ocrFrameResults = await runOcrOnFrames([thumbnailPath]);
      const deduped = deduplicateOcrText(ocrFrameResults);
      ocrTopLines = deduped.topLines;
      ocrFullText = deduped.fullText;
    } else {
      warnings.push({ source: "thumbnail", code: "THUMBNAIL_DOWNLOAD_FAILED", reason: "Could not download thumbnail image" });
    }
  }

  if (ocrTopLines.length > 0 && !sourcesSucceeded.includes("ocr")) {
    sourcesSucceeded.push("ocr");
  }

  const captionSignals = fullCaption ? extractDeterministicSignals(fullCaption, "caption") : { ctaSignals: [], offerSignals: [], urgencySignals: [] };
  const ocrSignals = ocrFullText ? extractDeterministicSignals(ocrFullText, "ocr") : { ctaSignals: [], offerSignals: [], urgencySignals: [] };
  const transcriptSignals = transcript ? extractDeterministicSignals(transcript, "transcript") : { ctaSignals: [], offerSignals: [], urgencySignals: [] };
  const pinnedSignals = pinnedCommentText ? extractDeterministicSignals(pinnedCommentText, "pinned_comment") : { ctaSignals: [], offerSignals: [], urgencySignals: [] };

  const deterministicSignals = mergeSignals(captionSignals, ocrSignals, transcriptSignals, pinnedSignals);

  const hasAnyEvidence = fullCaption || ocrFullText || transcript || pinnedCommentText;
  const status: EvidencePack["status"] = sourcesSucceeded.includes("video") || (sourcesSucceeded.length >= 2) ? "COMPLETE" : "PARTIAL";

  return {
    reelPermalink: post.permalink,
    shortcode: post.shortcode,
    sourcesAttempted,
    sourcesSucceeded,
    warnings,
    captionFirstLine,
    fullCaption,
    pinnedCommentText,
    hashtagsScan,
    ocrTopLines,
    ocrFullText,
    ocrFrameResults,
    transcript,
    transcriptConfidence,
    deterministicSignals,
    status,
  };
}

async function interpretEvidencePack(evidencePack: EvidencePack): Promise<InterpretedSignals> {
  const hookCandidates: InterpretedSignals["hookCandidates"] = [];
  const ctaSignals: InterpretedSignals["ctaSignals"] = [];
  const offerSignals: InterpretedSignals["offerSignals"] = [];
  const proofSignals: InterpretedSignals["proofSignals"] = [];
  const unavailable: InterpretedSignals["unavailable"] = [];

  for (const sig of evidencePack.deterministicSignals.ctaSignals) {
    ctaSignals.push({ text: sig.text, source: sig.source, confidence: 1.0, status: "MEASURED" });
  }
  for (const sig of evidencePack.deterministicSignals.offerSignals) {
    offerSignals.push({ text: sig.text, source: sig.source, confidence: 1.0, status: "MEASURED" });
  }

  if (evidencePack.captionFirstLine) {
    hookCandidates.push({ text: evidencePack.captionFirstLine, source: "caption", confidence: 0.7, status: "MEASURED" });
  }
  if (evidencePack.ocrTopLines.length > 0) {
    const firstOverlay = evidencePack.ocrTopLines[0];
    if (firstOverlay && firstOverlay.length > 5) {
      hookCandidates.push({ text: firstOverlay, source: "ocr_frame_0s", confidence: 0.85, status: "MEASURED" });
    }
  }

  const proofPatterns = /\b(\d+[\d,]*\s*(%|x|leads?|clients?|sales?|revenue|ROAS|ROI|growth|increase|results?)|(before|after)\s*(and|&|\/)\s*(after|before)|testimonial|case\s*study|review)\b/gi;
  const allText = [
    evidencePack.fullCaption || "",
    evidencePack.ocrFullText || "",
    evidencePack.transcript || "",
    evidencePack.pinnedCommentText || "",
  ].join(" ");

  const proofMatches = allText.matchAll(proofPatterns);
  const seenProof = new Set<string>();
  for (const match of proofMatches) {
    const key = match[0].toLowerCase();
    if (!seenProof.has(key)) {
      seenProof.add(key);
      proofSignals.push({ text: match[0], source: "text_analysis", confidence: 0.9, status: "MEASURED" });
    }
  }

  const hasEnoughEvidence = (evidencePack.fullCaption || evidencePack.ocrFullText || evidencePack.transcript);

  if (!hasEnoughEvidence) {
    unavailable.push({ signal: "hook", reason: "No caption, OCR text, or transcript available to detect hook", status: "UNAVAILABLE" });
    unavailable.push({ signal: "cta", reason: "No text sources available to detect CTA patterns", status: "UNAVAILABLE" });
    unavailable.push({ signal: "offer", reason: "No text sources available to detect offer signals", status: "UNAVAILABLE" });
    unavailable.push({ signal: "proof", reason: "No text sources available to detect social proof", status: "UNAVAILABLE" });
    return { hookCandidates, ctaSignals, offerSignals, proofSignals, unavailable };
  }

  try {
    const evidenceSummary = `EVIDENCE PACK for reel ${evidencePack.reelPermalink}:

CAPTION (first line): ${evidencePack.captionFirstLine || "[NONE]"}
FULL CAPTION: ${evidencePack.fullCaption?.substring(0, 500) || "[NONE]"}
PINNED COMMENT: ${evidencePack.pinnedCommentText || "[NONE]"}
OCR TEXT (overlay): ${evidencePack.ocrTopLines.join(" | ") || "[NONE]"}
TRANSCRIPT (spoken): ${evidencePack.transcript?.substring(0, 500) || "[NONE]"}
HASHTAGS: ${evidencePack.hashtagsScan.join(", ") || "[NONE]"}

DETERMINISTIC SIGNALS ALREADY DETECTED:
- CTA: ${evidencePack.deterministicSignals.ctaSignals.map(s => s.text).join(", ") || "[NONE]"}
- Offers: ${evidencePack.deterministicSignals.offerSignals.map(s => s.text).join(", ") || "[NONE]"}
- Urgency: ${evidencePack.deterministicSignals.urgencySignals.map(s => s.text).join(", ") || "[NONE]"}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{
        role: "system",
        content: `You are analyzing marketing reel evidence. You may ONLY cite patterns found in the provided evidence. Do NOT guess or invent. If something is not in the evidence, say UNAVAILABLE.`,
      }, {
        role: "user",
        content: `${evidenceSummary}

Analyze ONLY the evidence above. Return JSON:
{
  "additional_hooks": [{"text": "exact text from evidence", "source": "caption|ocr|transcript|pinned_comment", "confidence": 0.0-1.0}],
  "additional_cta": [{"text": "exact text from evidence", "source": "caption|ocr|transcript|pinned_comment", "confidence": 0.0-1.0}],
  "additional_offers": [{"text": "exact text from evidence", "source": "caption|ocr|transcript|pinned_comment", "confidence": 0.0-1.0}],
  "additional_proof": [{"text": "exact text from evidence", "source": "caption|ocr|transcript|pinned_comment", "confidence": 0.0-1.0}],
  "unavailable_signals": [{"signal": "hook|cta|offer|proof", "reason": "specific reason from evidence"}]
}

Return ONLY JSON, no markdown.`,
      }],
      temperature: 0.3,
      max_tokens: 800,
      response_format: { type: "json_object" },
    });

    const aiContent = completion.choices[0]?.message?.content;
    if (aiContent) {
      const aiParsed = JSON.parse(aiContent);

      for (const h of (aiParsed.additional_hooks || [])) {
        if (h.text && !hookCandidates.some(hc => hc.text.toLowerCase() === h.text.toLowerCase())) {
          hookCandidates.push({ text: h.text, source: h.source || "ai_analysis", confidence: h.confidence || 0.6, status: "MEASURED" });
        }
      }
      for (const c of (aiParsed.additional_cta || [])) {
        if (c.text && !ctaSignals.some(cs => cs.text.toLowerCase() === c.text.toLowerCase())) {
          ctaSignals.push({ text: c.text, source: c.source || "ai_analysis", confidence: c.confidence || 0.6, status: "MEASURED" });
        }
      }
      for (const o of (aiParsed.additional_offers || [])) {
        if (o.text && !offerSignals.some(os => os.text.toLowerCase() === o.text.toLowerCase())) {
          offerSignals.push({ text: o.text, source: o.source || "ai_analysis", confidence: o.confidence || 0.6, status: "MEASURED" });
        }
      }
      for (const p of (aiParsed.additional_proof || [])) {
        if (p.text && !proofSignals.some(ps => ps.text.toLowerCase() === p.text.toLowerCase())) {
          proofSignals.push({ text: p.text, source: p.source || "ai_analysis", confidence: p.confidence || 0.6, status: "MEASURED" });
        }
      }
      for (const u of (aiParsed.unavailable_signals || [])) {
        if (u.signal && !unavailable.some(x => x.signal === u.signal)) {
          unavailable.push({ signal: u.signal, reason: u.reason || "Not found in evidence", status: "UNAVAILABLE" });
        }
      }
    }
  } catch (err: any) {
    console.log(`[Creative Capture] AI interpretation failed: ${err.message}`);
  }

  if (hookCandidates.length === 0) {
    unavailable.push({ signal: "hook", reason: "No hook pattern detected in caption, overlay text, or transcript", status: "UNAVAILABLE" });
  }
  if (ctaSignals.length === 0) {
    unavailable.push({ signal: "cta", reason: "No CTA pattern detected in any available source", status: "UNAVAILABLE" });
  }
  if (offerSignals.length === 0) {
    unavailable.push({ signal: "offer", reason: "No offer/pricing pattern detected in any available source", status: "UNAVAILABLE" });
  }
  if (proofSignals.length === 0) {
    unavailable.push({ signal: "proof", reason: "No social proof pattern detected in any available source", status: "UNAVAILABLE" });
  }

  return { hookCandidates, ctaSignals, offerSignals, proofSignals, unavailable };
}

export async function captureReelCreative(post: ScrapedPost): Promise<CreativeCaptureResult> {
  console.log(`[Creative Capture] Processing reel ${post.shortcode} (${post.permalink})`);

  const evidencePack = await buildEvidencePack(post);
  const interpreted = await interpretEvidencePack(evidencePack);

  console.log(`[Creative Capture] Done ${post.shortcode}: ${evidencePack.sourcesSucceeded.length}/${evidencePack.sourcesAttempted.length} sources, ${interpreted.hookCandidates.length} hooks, ${interpreted.ctaSignals.length} CTAs, ${interpreted.offerSignals.length} offers, ${interpreted.proofSignals.length} proof`);

  return {
    reelPermalink: post.permalink,
    evidencePack,
    interpreted,
  };
}

export async function captureCompetitorCreatives(
  posts: ScrapedPost[],
  options?: { saveFixtures?: boolean; fixtureDir?: string }
): Promise<CreativeCaptureResult[]> {
  const now = Date.now();
  const timeSinceLast = now - lastCompetitorTime;
  if (timeSinceLast < RATE_LIMIT_MS) {
    const waitMs = RATE_LIMIT_MS - timeSinceLast;
    console.log(`[Creative Capture] Rate limiting: waiting ${(waitMs / 1000).toFixed(0)}s`);
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }
  lastCompetitorTime = Date.now();

  const reels = posts
    .filter(p => p.mediaType === "REEL" || p.mediaType === "VIDEO")
    .slice(0, MAX_REELS_PER_COMPETITOR);

  if (reels.length === 0) {
    const fallback = posts.filter(p => p.caption).slice(0, MAX_REELS_PER_COMPETITOR);
    if (fallback.length === 0) {
      console.log("[Creative Capture] No reels or posts with captions to analyze");
      return [];
    }
    console.log(`[Creative Capture] No reels found, using ${fallback.length} posts with captions`);
    const results: CreativeCaptureResult[] = [];
    for (const post of fallback) {
      const result = await captureReelCreative(post);
      results.push(result);
    }
    return results;
  }

  console.log(`[Creative Capture] Analyzing ${reels.length} reels (max ${MAX_REELS_PER_COMPETITOR})`);

  const results: CreativeCaptureResult[] = [];
  for (const reel of reels) {
    const result = await captureReelCreative(reel);
    results.push(result);

    if (options?.saveFixtures && options.fixtureDir) {
      try {
        const fixtureSubDir = path.join(options.fixtureDir, `reel_${reel.shortcode}`);
        if (!fs.existsSync(fixtureSubDir)) fs.mkdirSync(fixtureSubDir, { recursive: true });

        const reelCacheDir = path.join(CACHE_DIR, `reel_${reel.shortcode}`);
        if (fs.existsSync(reelCacheDir)) {
          const thumbPath = path.join(reelCacheDir, "thumbnail.jpg");
          const frameSample = fs.readdirSync(reelCacheDir).find(f => f.startsWith("frame_"));
          if (fs.existsSync(thumbPath)) {
            fs.copyFileSync(thumbPath, path.join(fixtureSubDir, "thumbnail.jpg"));
          } else if (frameSample) {
            fs.copyFileSync(path.join(reelCacheDir, frameSample), path.join(fixtureSubDir, "frame_sample.png"));
          }
        }

        fs.writeFileSync(
          path.join(fixtureSubDir, "ocr_raw.json"),
          JSON.stringify(result.evidencePack.ocrFrameResults, null, 2)
        );
        if (result.evidencePack.transcript) {
          fs.writeFileSync(path.join(fixtureSubDir, "transcript.txt"), result.evidencePack.transcript);
        }
        if (result.evidencePack.pinnedCommentText) {
          fs.writeFileSync(path.join(fixtureSubDir, "pinned_comment.txt"), result.evidencePack.pinnedCommentText);
        }
        fs.writeFileSync(
          path.join(fixtureSubDir, "evidence_pack.json"),
          JSON.stringify(result.evidencePack, null, 2)
        );
        fs.writeFileSync(
          path.join(fixtureSubDir, "interpreted.json"),
          JSON.stringify(result.interpreted, null, 2)
        );

        console.log(`[Creative Capture] Saved test fixture for ${reel.shortcode} → ${fixtureSubDir}`);
      } catch (err: any) {
        console.log(`[Creative Capture] Failed to save fixture: ${err.message}`);
      }
    }
  }

  return results;
}
