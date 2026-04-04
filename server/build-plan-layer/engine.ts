import { aiChat } from "../ai-client";
import { db } from "../db";
import {
  positioningSnapshots,
  differentiationSnapshots,
  mechanismSnapshots,
  offerSnapshots,
  funnelSnapshots,
  awarenessSnapshots,
  persuasionSnapshots,
  audienceSnapshots,
  miSnapshots,
  businessDataLayer,
} from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";
import { computeAdaptiveRhythm, type AdaptiveRhythm } from "../adaptive-rhythm/engine";
import { buildMemoryContext, applyMemoryConstraints, type MemoryOverride } from "../orchestrator/memory-context";

export type { AdaptiveRhythm };

export interface BuildPlanOutput {
  positioning: string;
  differentiation: string;
  mechanism: { name: string; explanation: string };
  offer: string;
  funnel: { top: string; middle: string; bottom: string };
  contentDna: {
    weeklyStructure: { reels: number; carousels: number; stories: number };
    contentTypes: { problems: string; proof: string; education: string; conversion: string };
    contentAngles: string[];
    hookStyles: string[];
    messagingThemes: string[];
    contentMixRatio: { problemAgitation: number; mechanismEducation: number; proof: number; conversion: number };
    rhythmReasoning?: string;
  };
  executionActions: {
    daily: string[];
    weekly: string[];
    biweekly: string[];
  };
  kpiRules: {
    postingFrequency: string;
    contentMix: string;
    conversionTargets: string;
  };
  memoryOverrides?: MemoryOverride[];
}

export interface BuildPlanResult {
  status: "SUCCESS" | "ACTIONABILITY_FAILED" | "INSUFFICIENT_DATA" | "ERROR";
  plan: BuildPlanOutput | null;
  actionabilityScore: number;
  failedBlocks: string[];
  attempts: number;
  error?: string;
}

interface EngineSnapshot {
  engineId: string;
  data: any;
  depthGateStatus?: string;
}

const ACTIONABILITY_RULES = [
  { name: "specificity", test: (v: string) => v.length > 20 && !/focus on|leverage|utilize|optimize/i.test(v) },
  { name: "clarity", test: (v: string) => !/\b(maybe|perhaps|could|might|possibly|consider)\b/i.test(v) },
  { name: "usability", test: (v: string) => !/\b(various|multiple|different|many|several|some)\b/i.test(v) || v.length > 50 },
];

function safeParseSnapshot(raw: any): any | null {
  try {
    if (typeof raw === "string") return JSON.parse(raw);
    return raw;
  } catch {
    return null;
  }
}

function enforceActionability(output: BuildPlanOutput): { passed: boolean; score: number; failedBlocks: string[] } {
  const blocks: Array<{ name: string; value: string }> = [
    { name: "positioning", value: output.positioning },
    { name: "differentiation", value: output.differentiation },
    { name: "mechanism", value: `${output.mechanism.name}: ${output.mechanism.explanation}` },
    { name: "offer", value: output.offer },
    { name: "funnel_top", value: output.funnel.top },
    { name: "funnel_middle", value: output.funnel.middle },
    { name: "funnel_bottom", value: output.funnel.bottom },
    { name: "contentDna_problems", value: output.contentDna.contentTypes.problems },
    { name: "contentDna_proof", value: output.contentDna.contentTypes.proof },
    { name: "contentDna_education", value: output.contentDna.contentTypes.education },
    { name: "contentDna_conversion", value: output.contentDna.contentTypes.conversion },
    { name: "kpi_frequency", value: output.kpiRules.postingFrequency },
    { name: "kpi_mix", value: output.kpiRules.contentMix },
    { name: "kpi_targets", value: output.kpiRules.conversionTargets },
  ];

  for (const action of output.executionActions.daily) {
    blocks.push({ name: "execution_daily", value: action });
  }
  for (const action of output.executionActions.weekly) {
    blocks.push({ name: "execution_weekly", value: action });
  }
  for (const angle of output.contentDna.contentAngles) {
    blocks.push({ name: "content_angle", value: angle });
  }
  for (const hook of output.contentDna.hookStyles) {
    blocks.push({ name: "hook_style", value: hook });
  }

  const failedBlocks: string[] = [];
  let passed = 0;

  for (const block of blocks) {
    const blockPassed = ACTIONABILITY_RULES.every(rule => rule.test(block.value));
    if (blockPassed) {
      passed++;
    } else {
      failedBlocks.push(block.name);
    }
  }

  const minDailyActions = output.executionActions.daily.length >= 2;
  const minWeeklyActions = output.executionActions.weekly.length >= 1;
  const minAngles = output.contentDna.contentAngles.length >= 2;
  const minHooks = output.contentDna.hookStyles.length >= 2;

  if (!minDailyActions) failedBlocks.push("execution_daily_count");
  if (!minWeeklyActions) failedBlocks.push("execution_weekly_count");
  if (!minAngles) failedBlocks.push("content_angles_count");
  if (!minHooks) failedBlocks.push("hook_styles_count");

  const structureOk = minDailyActions && minWeeklyActions && minAngles && minHooks;
  const score = passed / blocks.length;
  return { passed: score >= 0.85 && structureOk, score, failedBlocks };
}

async function getLatestSnapshot(table: any, accountId: string, campaignId: string): Promise<any | null> {
  try {
    const [snap] = await db
      .select()
      .from(table)
      .where(and(eq(table.accountId, accountId), eq(table.campaignId, campaignId)))
      .orderBy(desc(table.createdAt))
      .limit(1);
    return snap || null;
  } catch {
    return null;
  }
}

async function collectValidatedEngineOutputs(
  accountId: string,
  campaignId: string,
  depthGateStatus?: Record<string, string>
): Promise<EngineSnapshot[]> {
  const snapshots: EngineSnapshot[] = [];

  const GATED_PASS_STATES = ["SIGNAL_PASSED", "DEPTH_PASSED"];

  const miSnap = await getLatestSnapshot(miSnapshots, accountId, campaignId);
  if (miSnap) {
    snapshots.push({ engineId: "market_intelligence", data: miSnap });
  }

  const audienceSnap = await getLatestSnapshot(audienceSnapshots, accountId, campaignId);
  if (audienceSnap) {
    snapshots.push({ engineId: "audience", data: audienceSnap });
  }

  const posSnap = await getLatestSnapshot(positioningSnapshots, accountId, campaignId);
  if (posSnap) {
    const status = depthGateStatus?.positioning;
    if (!status || GATED_PASS_STATES.includes(status)) {
      snapshots.push({ engineId: "positioning", data: posSnap, depthGateStatus: status });
    }
  }

  const diffSnap = await getLatestSnapshot(differentiationSnapshots, accountId, campaignId);
  if (diffSnap) {
    const status = depthGateStatus?.differentiation;
    if (!status || GATED_PASS_STATES.includes(status)) {
      snapshots.push({ engineId: "differentiation", data: diffSnap, depthGateStatus: status });
    }
  }

  const mechSnap = await getLatestSnapshot(mechanismSnapshots, accountId, campaignId);
  if (mechSnap) {
    const status = depthGateStatus?.mechanism;
    if (!status || GATED_PASS_STATES.includes(status)) {
      snapshots.push({ engineId: "mechanism", data: mechSnap, depthGateStatus: status });
    }
  }

  const offerSnap = await getLatestSnapshot(offerSnapshots, accountId, campaignId);
  if (offerSnap) {
    const status = depthGateStatus?.offer;
    if (!status || GATED_PASS_STATES.includes(status)) {
      snapshots.push({ engineId: "offer", data: offerSnap, depthGateStatus: status });
    }
  }

  const funnelSnap = await getLatestSnapshot(funnelSnapshots, accountId, campaignId);
  if (funnelSnap) {
    const status = depthGateStatus?.funnel;
    if (!status || GATED_PASS_STATES.includes(status)) {
      snapshots.push({ engineId: "funnel", data: funnelSnap, depthGateStatus: status });
    }
  }

  const awarenessSnap = await getLatestSnapshot(awarenessSnapshots, accountId, campaignId);
  if (awarenessSnap) {
    const status = depthGateStatus?.awareness;
    if (!status || GATED_PASS_STATES.includes(status)) {
      snapshots.push({ engineId: "awareness", data: awarenessSnap, depthGateStatus: status });
    }
  }

  const persuasionSnap = await getLatestSnapshot(persuasionSnapshots, accountId, campaignId);
  if (persuasionSnap) {
    const status = depthGateStatus?.persuasion;
    if (!status || GATED_PASS_STATES.includes(status)) {
      snapshots.push({ engineId: "persuasion", data: persuasionSnap, depthGateStatus: status });
    }
  }

  return snapshots;
}

function safeParse(val: any): any {
  if (!val) return val;
  if (typeof val === "string") { try { return JSON.parse(val); } catch { return val; } }
  return val;
}

function safeArr(val: any): any[] {
  const parsed = safeParse(val);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") return Object.values(parsed);
  return [];
}

function buildEngineContext(snapshots: EngineSnapshot[]): string {
  const parts: string[] = [];

  for (const snap of snapshots) {
    const data = snap.data;
    switch (snap.engineId) {
      case "market_intelligence": {
        const competitors = safeArr(data.competitorData).slice(0, 5).map((c: any) => c.name || c.handle || "unknown").join(", ");
        const signals = safeArr(data.signalData).slice(0, 5).map((s: any) => s.text || s.signal || "").join("; ");
        parts.push(`[Market Intelligence] Competitors: ${competitors}. Key signals: ${signals}. Market state: ${data.marketState || "active"}`);
        break;
      }
      case "audience": {
        const pains = safeArr(data.audiencePains).slice(0, 3).map((p: any) => typeof p === "string" ? p : p.pain || p.label || p.name || "").join("; ");
        const desires = safeArr(data.desireMap).slice(0, 3).map((d: any) => typeof d === "string" ? d : d.desire || d.label || d.name || "").join("; ");
        const segments = safeArr(data.audienceSegments).slice(0, 2).map((s: any) => typeof s === "string" ? s : s.name || s.segment || "").join(", ");
        parts.push(`[Audience] Top pains: ${pains}. Top desires: ${desires}. Segments: ${segments}`);
        break;
      }
      case "positioning": {
        const result = safeParse(data.result) || data;
        const narrative = result.narrative || result.narrativeDirection || data.narrativeDirection || "";
        const territories = safeArr(result.territories || data.territories).slice(0, 2).map((t: any) => typeof t === "string" ? t : t.name || t.territory || "").join(", ");
        parts.push(`[Positioning] Narrative: ${narrative}. Territories: ${territories}`);
        break;
      }
      case "differentiation": {
        const result = safeParse(data.result) || data;
        const claims = safeArr(result.validatedClaims || result.claimStructures || data.claimStructures).slice(0, 3).map((c: any) => typeof c === "string" ? c : c.claim || c.title || "").join("; ");
        const mode = result.authorityMode?.mode || result.authorityMode || data.authorityMode || "";
        parts.push(`[Differentiation] Claims: ${claims}. Authority mode: ${typeof mode === "object" ? mode.mode || "" : mode}`);
        break;
      }
      case "mechanism": {
        const result = safeParse(data.result) || data;
        const name = result.mechanismName || result.name || data.mechanismName || "";
        const explanation = result.mechanismExplanation || result.explanation || result.howItWorks || "";
        parts.push(`[Mechanism] Name: ${name}. Explanation: ${typeof explanation === "string" ? explanation.substring(0, 200) : ""}`);
        break;
      }
      case "offer": {
        const result = safeParse(data.result) || data;
        const headline = result.offerHeadline || result.headline || data.offerHeadline || "";
        const value = result.primaryValueProp || result.valueProposition || "";
        parts.push(`[Offer] Headline: ${typeof headline === "string" ? headline : ""}.  Value: ${typeof value === "string" ? value : ""}`);
        break;
      }
      case "funnel": {
        const result = safeParse(data.result) || data;
        const stages = safeArr(result.stages || result.funnelStages || data.stages).slice(0, 3).map((s: any) => `${s.name || s.stage || ""}: ${s.objective || s.description || ""}`).join(" → ");
        parts.push(`[Funnel] ${stages}`);
        break;
      }
      case "awareness": {
        const result = safeParse(data.result) || data;
        const route = result.primaryRoute?.routeName || result.primaryRoute?.name || "";
        parts.push(`[Awareness] Primary route: ${route}`);
        break;
      }
      case "persuasion": {
        const result = safeParse(data.result) || data;
        const route = result.primaryRoute?.routeName || result.primaryRoute?.name || "";
        const alt = result.alternativeRoute?.routeName || "";
        parts.push(`[Persuasion] Primary: ${route}${alt ? `, Alternative: ${alt}` : ""}`);
        break;
      }
    }
  }

  return parts.join("\n");
}

function buildBuildPlanPrompt(engineContext: string, rhythm: AdaptiveRhythm, previousFailures?: string[]): string {
  let failureContext = "";
  if (previousFailures && previousFailures.length > 0) {
    failureContext = `\n\nPREVIOUS ATTEMPT FAILED ACTIONABILITY CHECK. These blocks were rejected for being vague/generic: ${previousFailures.join(", ")}.\nYou MUST make them more specific, concrete, and directly usable. No generic advice. Only clear, executable decisions.\n`;
  }

  return `You are an Execution Synthesis Engine. Convert analysis into EXACT ACTIONS the user does TODAY.

CRITICAL RULES:
- NO paragraphs, NO theory, NO abstract KPIs, NO generic percentages
- ONLY concrete, specific actions a person can follow without interpretation
- Every output must answer: "What do I do RIGHT NOW?"
- REJECT any urge to add context, caveats, alternatives, or meaningless projections

ADAPTIVE CONTENT RHYTHM — DO NOT CHANGE THESE VALUES (data-driven, based on ${rhythm.performanceBasis}):
  reels: ${rhythm.reelsPerWeek} per week
  carousels: ${rhythm.carouselsPerWeek} per week
  stories: ${rhythm.storiesPerDay} per day
  posts: ${rhythm.postsPerWeek} per week
  Rhythm basis: ${rhythm.reasoning}
  Confidence: ${(rhythm.confidenceScore * 100).toFixed(0)}%
The weeklyStructure object in your JSON MUST use exactly these numbers.

ENGINE DATA:
${engineContext}
${failureContext}
Return EXACTLY this JSON structure:

{
  "positioning": "ONE phrase or sentence. Not generic. Example: 'The only AI tool that delivers clear reports in under 5 minutes' — NOT 'Focus on simplicity'",
  "differentiation": "ONE dominant angle as a single statement. Must be concrete and provable.",
  "mechanism": {
    "name": "Clear name for the mechanism (2-4 words)",
    "explanation": "One-line explanation of how it works. Must be specific."
  },
  "offer": "Ready-to-use offer statement. What they get + outcome + constraint (time/price/guarantee).",
  "funnel": {
    "top": "Specific attention format: what type of content captures attention and how",
    "middle": "Specific trust-building content: what to post and why it builds credibility",
    "bottom": "Specific conversion trigger: exact CTA and mechanism to close"
  },
  "contentDna": {
    "weeklyStructure": { "reels": ${rhythm.reelsPerWeek}, "carousels": ${rhythm.carouselsPerWeek}, "stories": ${rhythm.storiesPerDay} },
    "contentTypes": {
      "problems": "EXACT problem content to create (specific topics, not categories)",
      "proof": "EXACT proof content to create (what results/cases to show)",
      "education": "EXACT education content to create (what to teach, specific lessons)",
      "conversion": "EXACT conversion content to create (what offer to push, how)"
    },
    "contentAngles": ["Angle 1: specific perspective to post from", "Angle 2: another specific angle", "Angle 3: third angle"],
    "hookStyles": ["Hook style 1: exact opening pattern", "Hook style 2: another pattern", "Hook style 3: third pattern"],
    "messagingThemes": ["Theme 1: core topic thread", "Theme 2: secondary theme", "Theme 3: supporting theme"],
    "contentMixRatio": { "problemAgitation": 60, "mechanismEducation": 25, "proof": 10, "conversion": 5 }
  },
  "executionActions": {
    "daily": [
      "Post 1 Reel using [specific hook style] about [specific angle]",
      "Post 2-3 Stories: 1 behind-the-scenes + 1 poll/question + 1 result/tip",
      "Reply to 10 comments and send 5 DMs to engaged followers"
    ],
    "weekly": [
      "Publish 1 carousel case study showing [specific result type]",
      "Create 1 educational post about [specific mechanism/topic]",
      "Review last 7 days: which hook got most saves? Double down on it"
    ],
    "biweekly": [
      "Publish 1 long-form case study or testimonial breakdown",
      "A/B test 2 different hook styles on similar content",
      "Audit content mix — adjust if problem content is under 50%"
    ]
  },
  "kpiRules": {
    "postingFrequency": "Exact schedule: e.g. 'Mon-Sat: 1 Reel at 9am, 2 Stories at 12pm and 6pm. Sunday: rest'",
    "contentMix": "Exact split tied to actions: e.g. '60% problem reels, 25% mechanism education, 10% proof carousels, 5% direct offer'",
    "conversionTargets": "Specific measurable targets: e.g. '15 DM conversations/week, 3 booked calls/week, track save rate per post'"
  }
}

Return ONLY valid JSON. No markdown, no code blocks, no explanation.`;
}

function parseAIResponse(content: string, rhythm: AdaptiveRhythm): BuildPlanOutput | null {
  try {
    let cleaned = content.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    const parsed = JSON.parse(cleaned);

    if (!parsed.positioning || !parsed.differentiation || !parsed.mechanism || !parsed.offer || !parsed.funnel || !parsed.contentDna || !parsed.kpiRules) {
      return null;
    }

    const contentAngles = Array.isArray(parsed.contentDna?.contentAngles) ? parsed.contentDna.contentAngles.map(String) : [];
    const hookStyles = Array.isArray(parsed.contentDna?.hookStyles) ? parsed.contentDna.hookStyles.map(String) : [];
    const messagingThemes = Array.isArray(parsed.contentDna?.messagingThemes) ? parsed.contentDna.messagingThemes.map(String) : [];
    const mixRatio = parsed.contentDna?.contentMixRatio || {};

    const execActions = parsed.executionActions || {};

    return {
      positioning: String(parsed.positioning),
      differentiation: String(parsed.differentiation),
      mechanism: {
        name: String(parsed.mechanism?.name || ""),
        explanation: String(parsed.mechanism?.explanation || ""),
      },
      offer: String(parsed.offer),
      funnel: {
        top: String(parsed.funnel?.top || ""),
        middle: String(parsed.funnel?.middle || ""),
        bottom: String(parsed.funnel?.bottom || ""),
      },
      contentDna: {
        weeklyStructure: {
          reels: rhythm.reelsPerWeek,
          carousels: rhythm.carouselsPerWeek,
          stories: rhythm.storiesPerDay,
        },
        contentTypes: {
          problems: String(parsed.contentDna?.contentTypes?.problems || ""),
          proof: String(parsed.contentDna?.contentTypes?.proof || ""),
          education: String(parsed.contentDna?.contentTypes?.education || ""),
          conversion: String(parsed.contentDna?.contentTypes?.conversion || ""),
        },
        contentAngles: contentAngles.length > 0 ? contentAngles : ["Problem-first angle", "Result-showcase angle", "Behind-the-scenes angle"],
        hookStyles: hookStyles.length > 0 ? hookStyles : ["Pattern interrupt hook", "Question-based hook", "Bold claim hook"],
        messagingThemes: messagingThemes.length > 0 ? messagingThemes : ["Core problem theme", "Solution mechanism theme", "Social proof theme"],
        contentMixRatio: {
          problemAgitation: Number(mixRatio.problemAgitation || 60),
          mechanismEducation: Number(mixRatio.mechanismEducation || 25),
          proof: Number(mixRatio.proof || 10),
          conversion: Number(mixRatio.conversion || 5),
        },
        rhythmReasoning: rhythm.reasoning || undefined,
      },
      executionActions: {
        daily: Array.isArray(execActions.daily) ? execActions.daily.map(String) : [
          "Post 1 Reel with problem-agitation hook",
          "Post 2 Stories: 1 tip + 1 engagement poll",
          "Reply to comments and send 5 DMs to engaged followers",
        ],
        weekly: Array.isArray(execActions.weekly) ? execActions.weekly.map(String) : [
          "Publish 1 carousel case study",
          "Review last 7 days: double down on highest-save content",
        ],
        biweekly: Array.isArray(execActions.biweekly) ? execActions.biweekly.map(String) : [
          "A/B test 2 hook styles",
          "Audit content mix ratios",
        ],
      },
      kpiRules: {
        postingFrequency: String(parsed.kpiRules?.postingFrequency || ""),
        contentMix: String(parsed.kpiRules?.contentMix || ""),
        conversionTargets: String(parsed.kpiRules?.conversionTargets || ""),
      },
    };
  } catch {
    return null;
  }
}

export async function runBuildPlanLayer(
  accountId: string,
  campaignId: string,
  depthGateStatus?: Record<string, string>
): Promise<BuildPlanResult> {
  const MAX_ATTEMPTS = 3;

  const snapshots = await collectValidatedEngineOutputs(accountId, campaignId, depthGateStatus);

  if (snapshots.length < 3) {
    return {
      status: "INSUFFICIENT_DATA",
      plan: null,
      actionabilityScore: 0,
      failedBlocks: [],
      attempts: 0,
      error: `Only ${snapshots.length} validated engine outputs available. Need at least 3.`,
    };
  }

  const adaptiveRhythm = await computeAdaptiveRhythm(campaignId, accountId);

  console.log(`[BuildPlanLayer] Adaptive rhythm: reels=${adaptiveRhythm.reelsPerWeek}/wk carousels=${adaptiveRhythm.carouselsPerWeek}/wk stories=${adaptiveRhythm.storiesPerDay}/day posts=${adaptiveRhythm.postsPerWeek}/wk | basis=${adaptiveRhythm.performanceBasis}`);

  let memoryBlockForConstraints: import("../memory-system/types").MemoryBlock | null = null;
  try {
    memoryBlockForConstraints = await buildMemoryContext(campaignId, accountId);
  } catch (memErr: any) {
    console.warn(`[BuildPlanLayer] Memory context load failed (non-blocking):`, memErr.message);
  }

  const engineContext = buildEngineContext(snapshots);
  let lastFailedBlocks: string[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const prompt = buildBuildPlanPrompt(engineContext, adaptiveRhythm, attempt > 1 ? lastFailedBlocks : undefined);

      const response = await aiChat({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1500,
        temperature: 0.3,
        accountId,
        endpoint: "build-plan-layer",
      });

      const content = response.choices?.[0]?.message?.content;
      if (!content) {
        console.warn(`[BuildPlanLayer] Attempt ${attempt}: Empty AI response`);
        continue;
      }

      const plan = parseAIResponse(content, adaptiveRhythm);
      if (!plan) {
        console.warn(`[BuildPlanLayer] Attempt ${attempt}: Failed to parse response`);
        continue;
      }

      if (memoryBlockForConstraints && (memoryBlockForConstraints.reinforceSlots.length > 0 || memoryBlockForConstraints.avoidSlots.length > 0)) {
        try {
          const baseline = memoryBlockForConstraints.industryBaseline ?? undefined;
          const ws = plan.contentDna.weeklyStructure;
          const distribution = { reelsPerWeek: ws.reels, carouselsPerWeek: ws.carousels, storiesPerDay: ws.stories };
          const { adjusted, overrides } = applyMemoryConstraints(distribution, memoryBlockForConstraints, baseline);
          if (overrides.length > 0) {
            plan.contentDna.weeklyStructure = { reels: adjusted.reelsPerWeek ?? ws.reels, carousels: adjusted.carouselsPerWeek ?? ws.carousels, stories: adjusted.storiesPerDay ?? ws.stories };
            plan.memoryOverrides = overrides;
            console.log(`[BuildPlanLayer] MEMORY_CONSTRAINTS_APPLIED | overrides=${overrides.length} | fields=${overrides.map(o => o.field).join(",")}`);
          }
        } catch (memApplyErr: any) {
          console.warn(`[BuildPlanLayer] Memory constraint application failed (non-blocking):`, memApplyErr.message);
        }
      }

      const actionability = enforceActionability(plan);
      console.log(`[BuildPlanLayer] Attempt ${attempt}: actionability=${actionability.score.toFixed(2)}, passed=${actionability.passed}, failed=${actionability.failedBlocks.join(",")}`);

      if (actionability.passed) {
        return {
          status: "SUCCESS",
          plan,
          actionabilityScore: actionability.score,
          failedBlocks: [],
          attempts: attempt,
        };
      }

      lastFailedBlocks = actionability.failedBlocks;

      if (attempt === MAX_ATTEMPTS) {
        return {
          status: "ACTIONABILITY_FAILED",
          plan,
          actionabilityScore: actionability.score,
          failedBlocks: actionability.failedBlocks,
          attempts: attempt,
        };
      }
    } catch (err: any) {
      console.error(`[BuildPlanLayer] Attempt ${attempt} error:`, err.message);
      if (attempt === MAX_ATTEMPTS) {
        return {
          status: "ERROR",
          plan: null,
          actionabilityScore: 0,
          failedBlocks: [],
          attempts: attempt,
          error: err.message,
        };
      }
    }
  }

  return {
    status: "ERROR",
    plan: null,
    actionabilityScore: 0,
    failedBlocks: [],
    attempts: MAX_ATTEMPTS,
    error: "All attempts exhausted",
  };
}
