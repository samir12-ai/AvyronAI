/**
 * What To Do Today — Task Production Blueprint & Full Script Generator
 * 
 * Converts an approved strategic execution task into a complete, broadcast-ready
 * production blueprint (word-for-word script, scene-by-scene timestamps, camera
 * shooting angles, visual/b-roll directions, teleprompter text, and platform post copy).
 */

import { db } from "../db";
import * as schema from "@shared/schema";
import { eq } from "drizzle-orm";
import { aiChat } from "../ai-client";
import { buildExecutionPlanningContext } from "./context-builder";
import { logger } from "../logger";
import { evaluateTaskEligibility } from "../shared/task-eligibility";

export interface ProductionScene {
  sceneNumber: number;
  phase: "HOOK" | "PROBLEM_AGITATION" | "MECHANISM_DEMO" | "EVIDENCE_PROOF" | "OBJECTION_HANDLING" | "OFFER_CALLOUT" | "CTA";
  timestamp: string; // e.g. "0:00 - 0:08"
  durationSeconds: number; // e.g. 8
  shootingAngle: string; // e.g. "Close-Up Talking Head (Eye Level, direct eye contact)"
  visualCue: string; // e.g. "Screen recording shows product interface in active use"
  spokenScript: string; // Word-for-word spoken dialogue
  onScreenText: string; // On-screen graphic/text callout
  soundCue?: string; // e.g. "Subtle tech riser / whoosh transition"
}

export interface CarouselSlide {
  slideNumber: number;
  headline: string;
  subhead?: string;
  visualPrompt: string; // Visual design / diagram description
  bodyCopy: string;
  onScreenElements: string[];
  swipeCta?: string;
}

export interface PlatformPostCopy {
  postTitle?: string;
  caption: string;
  hashtags: string[];
  firstComment?: string;
  ctaLinkText: string;
  ctaUrl: string;
  thumbnailHookText?: string;
}

export interface TaskProductionBlueprint {
  taskId: string;
  taskTitle: string;
  channel: string;
  channelRole: string;
  targetFormat: string; // e.g. "YouTube Long-form (16:9 4K)", "TikTok Short (9:16)", "Instagram Carousel (4:5)"
  estimatedTotalDuration: string;
  aspectRatio: "16:9" | "9:16" | "4:5" | "1:1" | "TEXT_THREAD";
  strategicIntent: string;
  keyTakeaway: string;
  scenes: ProductionScene[];
  carouselSlides?: CarouselSlide[];
  platformPost: PlatformPostCopy;
  teleprompterFullScript: string;
  productionChecklist: Array<{ step: string; isCompleted: boolean }>;
  generatedAt: string;
}

export class TaskBlueprintGenerator {
  /**
   * Generates or retrieves the cached production blueprint for a specific task.
   */
  static async getOrGenerateBlueprint(
    taskId: string,
    forceRegenerate: boolean = false
  ): Promise<TaskProductionBlueprint> {
    // 1. Fetch Task
    const [task] = await db
      .select()
      .from(schema.dailyExecutionTasks)
      .where(eq(schema.dailyExecutionTasks.id, taskId))
      .limit(1);

    if (!task) {
      throw new Error(`TASK_NOT_FOUND: Execution task ${taskId} does not exist.`);
    }

    // Task execution guard: Draft or blocked tasks cannot generate executable production blueprints
    if (task.status === "DRAFT" || task.status === "BLOCKED") {
      throw new Error(`TASK_NOT_EXECUTABLE: Task ${taskId} is in ${task.status} status and cannot generate production content.`);
    }

    // 2. Return cached blueprint if available and not forced (always return cached in Demo Mode)
    if (task.productionBlueprint && (!forceRegenerate || process.env.AVYRON_DEMO_MODE === "1")) {
      return task.productionBlueprint as TaskProductionBlueprint;
    }

    // 3. Build Planning Context from Strategy Lineage
    const context = await buildExecutionPlanningContext(task.campaignId);

    // 4. Validate Task Eligibility with structured operational purpose and verified evidence
    const taskEligibility = evaluateTaskEligibility(task as any, {
      planStatus: "APPROVED",
      isPlanDesignatedActive: true,
      verifiedEvidenceTexts: [
        context.approvedMechanism.mechanismName,
        context.approvedMechanism.corePrinciple,
        context.approvedMechanism.proofArtifact,
        ...context.approvedLanes.map(l => l.primaryPain || ""),
      ].filter(Boolean),
      unresolvedDependencies: Array.isArray(task.dependencies) ? (task.dependencies as string[]) : [],
    });

    if (!taskEligibility.isEligible) {
      throw new Error(`TASK_RESTRICTED: ${taskEligibility.reason || "Task cannot generate production content"}`);
    }

    // 4. Generate with LLM
    const taskLane =
      context.approvedLanes.find(l => l.laneId === task.laneId) || context.approvedLanes[0];
    const resolvedCtaUrl =
      context.productUrl ||
      taskLane?.destinationUrl ||
      (task.ctaDestination && task.ctaDestination.includes("http") ? task.ctaDestination : "");
    const resolvedCtaDestination =
      task.ctaDestination ||
      `${taskLane?.primaryCta || context.funnelJourney?.ctaPrimary || "Start Free Trial"}${resolvedCtaUrl ? ` (${resolvedCtaUrl})` : ""}`;

    const systemPrompt = `You are the Creative Production Director & Strategic Content Architect for ${context.businessName || "the brand"}.
Your role is to produce a comprehensive, broadcast-ready, professional production script and shooting blueprint for an approved marketing task.

CONSTITUTIONAL PRINCIPLES:
1. STRICT STRATEGY FIDELITY:
   - Deeply ground the script in the approved positioning umbrella: "${context.strategyName}".
   - Positioning Narrative: "${context.positioningSummary}".
   - Core Mechanism: "${context.approvedMechanism.mechanismName}" (${context.approvedMechanism.corePrinciple || "Approved Principle"}).
   - Contrast Axis: "${context.contrastAxis}".
   - Proof Artifact to demonstrate: "${task.proofRequired || context.approvedMechanism.proofArtifact || "Approved Product Demonstration"}".
   - Target Audience Lane: [${taskLane?.laneId || "lane_1"}] "${taskLane?.title || "Target Segment"}" (Core Buying Tension: ${taskLane?.primaryPain || "Target Pain"}; Objections: ${(taskLane?.objections || []).slice(0, 3).join("; ")}).
   - Funnel Conversion CTA & Destination: "${resolvedCtaDestination}".
   - NEVER use generic B2B phrases like "Webinar / Demo", "Target audience operators", or "Serious operators" unless explicitly present in the approved strategy.

2. ACTIONABLE PRODUCTION SPECIFICATIONS:
   - Provide concrete, word-for-word spoken dialogue (NO generic placeholder sentences like "insert explanation here").
   - Include exact scene-by-scene timestamps and durations (e.g. 0:00 - 0:07, 7s).
   - Detail specific professional camera shooting angles and visual directions tailored to the product and audience.
   - Detail exact visual cues, b-roll footage, and on-screen text for every single scene.

3. CHANNEL-SPECIFIC NATIVENESS:
   - If TIKTOK / INSTAGRAM REELS / SHORTS: Generate a fast-paced 30–60s vertical (9:16) video blueprint (4–6 scenes) with an emotional or curiosity 2-second visual hook, clear contrast against generic alternatives, authentic product/keepsake demonstration, and clear CTA to ${resolvedCtaDestination}.
   - If INSTAGRAM CAROUSEL: Generate 6–8 visually rich slides with slide headlines, visual layout prompts, body copy, and swipe prompts leading to ${resolvedCtaDestination}.
   - If YOUTUBE: Generate a structured video blueprint with punchy hook, problem breakdown, mechanism demonstration, proof walkthrough, objection handling, and clear CTA to ${resolvedCtaDestination}.
   - If X / FACEBOOK: Generate structured scene/thread beats with visual asset recommendations.

Return a structured JSON object strictly matching this format:
{
  "targetFormat": "e.g. Instagram Reel (9:16 Vertical) or Instagram Carousel (4:5)",
  "estimatedTotalDuration": "e.g. 45 secs",
  "aspectRatio": "16:9" | "9:16" | "4:5" | "1:1" | "TEXT_THREAD",
  "strategicIntent": "One clear sentence explaining the strategic conversion goal for ${taskLane?.title || "the audience"}",
  "keyTakeaway": "Core insight the viewer will remember",
  "scenes": [
    {
      "sceneNumber": 1,
      "phase": "HOOK" | "PROBLEM_AGITATION" | "MECHANISM_DEMO" | "EVIDENCE_PROOF" | "OBJECTION_HANDLING" | "OFFER_CALLOUT" | "CTA",
      "timestamp": "0:00 - 0:08",
      "durationSeconds": 8,
      "shootingAngle": "Specific camera angle & lens framing",
      "visualCue": "Detailed on-screen visual action & B-roll direction",
      "spokenScript": "Exact word-for-word spoken dialogue",
      "onScreenText": "On-screen text callout or lower third",
      "soundCue": "Sound effect or musical cue"
    }
  ],
  "carouselSlides": [
    {
      "slideNumber": 1,
      "headline": "Slide headline",
      "subhead": "Slide subhead",
      "visualPrompt": "Visual layout description",
      "bodyCopy": "Slide text content",
      "onScreenElements": ["element 1", "element 2"],
      "swipeCta": "Swipe for next slide"
    }
  ],
  "platformPost": {
    "postTitle": "Platform-optimized title",
    "caption": "Full platform-native post caption with line breaks",
    "hashtags": ["#relevant", "#hashtags"],
    "firstComment": "Engaging first comment / discussion starter",
    "ctaLinkText": "${taskLane?.primaryCta || context.funnelJourney?.ctaPrimary || "Start Free Trial"}",
    "ctaUrl": "${resolvedCtaUrl}",
    "thumbnailHookText": "Punchy 3-4 word text for cover/thumbnail"
  },
  "teleprompterFullScript": "Complete continuous script for teleprompter reading",
  "productionChecklist": [
    { "step": "Review & customize script talking points", "isCompleted": true },
    { "step": "Record primary scenes & emotional reaction clips", "isCompleted": false },
    { "step": "Capture product / keepsake visual showcase", "isCompleted": false },
    { "step": "Edit video & add captions, lower thirds, and audio", "isCompleted": false },
    { "step": "Prepare cover image & copy platform caption", "isCompleted": false }
  ]
}`;

    const userPrompt = `Generate the complete Production Blueprint for this task:

TASK TO EXECUTE:
- Title: ${task.title}
- Description: ${task.description}
- Channel: ${task.channel} (${task.channelRole})
- Target Audience Lane: [${taskLane?.laneId || "lane_1"}] ${taskLane?.title || "Target Audience"}
- Core Buying Pain: ${taskLane?.primaryPain || "Target Pain"}
- Task Type: ${task.taskType}
- Priority: ${task.priority}
- Strategic Objective: ${task.objective}
- Why This Matters: ${task.reason}
- Execution Approach Guidance: ${task.executionApproach}
- Required Proof Asset: ${task.proofRequired || context.approvedMechanism.proofArtifact}
- CTA / Destination: ${resolvedCtaDestination}
- Destination URL: ${resolvedCtaUrl}
- Estimated Effort: ${task.estimatedEffort || "60 mins"}`;

    try {
      const response = await aiChat({
        model: "gpt-4o-mini",
        temperature: 0.25,
        accountId: context.accountId,
        endpoint: "what-to-do-today-blueprint",
        response_format: { type: "json_object" },
        max_tokens: 3200,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error("EMPTY_LLM_RESPONSE: Blueprint generator returned empty content.");
      }

      const parsed = JSON.parse(content);

      const blueprint: TaskProductionBlueprint = {
        taskId: task.id,
        taskTitle: task.title,
        channel: task.channel,
        channelRole: task.channelRole,
        targetFormat: parsed.targetFormat || `${task.channel} Production Asset`,
        estimatedTotalDuration: parsed.estimatedTotalDuration || task.estimatedEffort || "45-60 secs",
        aspectRatio: parsed.aspectRatio || (task.channel === "YOUTUBE" ? "16:9" : task.channel === "TIKTOK" || task.channel === "INSTAGRAM" ? "9:16" : "4:5"),
        strategicIntent: parsed.strategicIntent || task.objective || `Drive ${taskLane?.title || "target buyers"} toward ${resolvedCtaDestination}.`,
        keyTakeaway: parsed.keyTakeaway || context.approvedPromise || context.positioningSummary,
        scenes: Array.isArray(parsed.scenes) ? parsed.scenes : [],
        carouselSlides: Array.isArray(parsed.carouselSlides) ? parsed.carouselSlides : undefined,
        platformPost: {
          postTitle: parsed.platformPost?.postTitle || task.title,
          caption: parsed.platformPost?.caption || task.description,
          hashtags: Array.isArray(parsed.platformPost?.hashtags) ? parsed.platformPost.hashtags : [],
          firstComment: parsed.platformPost?.firstComment,
          ctaLinkText: parsed.platformPost?.ctaLinkText || taskLane?.primaryCta || context.funnelJourney?.ctaPrimary || "Learn More",
          ctaUrl: parsed.platformPost?.ctaUrl || resolvedCtaUrl || resolvedCtaDestination,
          thumbnailHookText: parsed.platformPost?.thumbnailHookText,
        },
        teleprompterFullScript: parsed.teleprompterFullScript || (parsed.scenes ? parsed.scenes.map((s: any) => s.spokenScript).join("\n\n") : task.description),
        productionChecklist: Array.isArray(parsed.productionChecklist) ? parsed.productionChecklist : [
          { step: "Review & finalize script", isCompleted: true },
          { step: "Record primary scenes", isCompleted: false },
          { step: "Capture product & keepsake showcase", isCompleted: false },
          { step: "Edit & export final asset", isCompleted: false },
        ],
        generatedAt: new Date().toISOString(),
      };

      // Persist in DB
      await db
        .update(schema.dailyExecutionTasks)
        .set({
          productionBlueprint: blueprint,
          updatedAt: new Date(),
        })
        .where(eq(schema.dailyExecutionTasks.id, task.id));

      logger.info(`[TaskBlueprintGenerator] Successfully generated & persisted blueprint for task ${task.id}`);
      return blueprint;
    } catch (err: any) {
      logger.error(`[TaskBlueprintGenerator] Failed to generate blueprint for task ${task.id}:`, err);
      throw err;
    }
  }
}
