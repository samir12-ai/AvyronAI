import { aiChat } from "../ai-client";
import { acknowledgeAelInput, applyPartialAelDowngrade } from "../analytical-enrichment-layer/consumer-guard";
import { logSafe } from "../log-redact";

// Seal #10 / Task #28 / F2.7 — typed accessor for Drizzle table internals
// (replaces ad-hoc `(table as any)?._?.name` casts in log emission).
type DrizzleTableInternals = { _?: { name?: string } };
function tableName(t: unknown): string {
  return ((t as DrizzleTableInternals)?._?.name) ?? "unknown";
}
import type { AnalyticalPackage } from "../analytical-enrichment-layer/types";
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

export type BuildPlanBlockReason = "STALE_LINEAGE" | "AI_RESPONSE_INVALID";

export interface BuildPlanResult {
  status: "SUCCESS" | "ACTIONABILITY_FAILED" | "INSUFFICIENT_DATA" | "BLOCKED" | "ERROR";
  plan: BuildPlanOutput | null;
  actionabilityScore: number;
  failedBlocks: string[];
  attempts: number;
  error?: string;
  reason?: BuildPlanBlockReason;
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

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
type SnapshotRow = { data: unknown };

function safeParseSnapshot(raw: SnapshotRow | { data: Json } | null | undefined): Json | null {
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

/**
 * P0-6 (runtime-truth-isolation-seal): every snapshot read must declare a
 * sourceJobId. The previous "latest by (accountId, campaignId)" pattern silently
 * stitched together engine outputs from DIFFERENT runs whenever a single engine
 * had failed and the orchestrator retried — producing build-plans whose
 * positioning came from run A and whose offer came from run B, with no audit
 * trail. When a `sourceJobId` is provided, every snapshot table is scoped by
 * jobId so cross-run blending becomes structurally impossible. The legacy
 * "latest" path is retained only when explicitly opted into (no runId provided)
 * and emits a STALE_LINEAGE warning so the choice is visible in logs.
 */
async function getLatestSnapshot(
  table: any,
  accountId: string,
  campaignId: string,
  sourceJobId?: string | null,
): Promise<any | null> {
  try {
    const conditions = [eq(table.accountId, accountId), eq(table.campaignId, campaignId)];
    if (sourceJobId && "jobId" in table) {
      conditions.push(eq(table.jobId, sourceJobId));
    }
    const [snap] = await db
      .select()
      .from(table)
      .where(and(...conditions))
      .orderBy(desc(table.createdAt))
      .limit(1);
    if (!snap && sourceJobId) {
      console.warn(logSafe(`[BuildPlanLayer] SNAPSHOT_MISS_FOR_RUN | account=${accountId} campaign=${campaignId} jobId=${sourceJobId} table=${tableName(table)}`));
    } else if (!sourceJobId) {
      // Phase 4 hardening (May 2026): elevated from console.warn to a structured
      // signal. The caller still receives the snapshot (D4 backwards compat —
      // not every legacy reader passes sourceJobId yet), but the fact that we
      // had to fall back to a latest-row read is captured on stderr at WARN
      // level for log-based alerting. System Control consumes the upstream
      // sourceJobId-presence flag separately via ctx wiring; this branch is
      // the last-resort breadcrumb when that wiring is bypassed.
      console.warn(logSafe(`[BuildPlanLayer] STALE_LINEAGE_READ | severity=high | account=${accountId} campaign=${campaignId} table=${tableName(table)} — no sourceJobId provided; latest snapshot may belong to a different run. Caller MUST pass sourceJobId for runtime-truth correctness.`));
    }
    return snap || null;
  } catch {
    return null;
  }
}

async function collectValidatedEngineOutputs(
  accountId: string,
  campaignId: string,
  depthGateStatus?: Record<string, string>,
  sourceJobId?: string | null,
): Promise<EngineSnapshot[]> {
  const snapshots: EngineSnapshot[] = [];

  const GATED_PASS_STATES = ["SIGNAL_PASSED", "DEPTH_PASSED"];

  const miSnap = await getLatestSnapshot(miSnapshots, accountId, campaignId, sourceJobId);
  if (miSnap) {
    snapshots.push({ engineId: "market_intelligence", data: miSnap });
  }

  const audienceSnap = await getLatestSnapshot(audienceSnapshots, accountId, campaignId, sourceJobId);
  if (audienceSnap) {
    snapshots.push({ engineId: "audience", data: audienceSnap });
  }

  // Seal #9 (F2.2 #7) — D5 honesty: a missing depth-gate status is
  // CONTRACT_INCOMPLETE, NOT silently treated as PASS. The previous
  // `!status || GATED_PASS_STATES.includes(status)` admitted snapshots
  // whose depth-gate evaluation was absent — silently substituting
  // "no verdict" for "pass". We now require an explicit gated-pass
  // verdict; missing/non-pass snapshots are excluded from build-plan
  // synthesis and logged as CONTRACT_INCOMPLETE for visibility.
  const includeIfGatedPass = (
    engineId: string,
    snap: any,
    status: string | undefined,
  ): void => {
    if (status && GATED_PASS_STATES.includes(status)) {
      snapshots.push({ engineId, data: snap, depthGateStatus: status });
      return;
    }
    if (!status) {
      console.warn(`[BuildPlanLayer] CONTRACT_INCOMPLETE | engine=${engineId} | reason=missing_depth_gate_status | account=${accountId} campaign=${campaignId}`);
      return;
    }
    console.log(`[BuildPlanLayer] DEPTH_GATE_NOT_PASS | engine=${engineId} | status=${status}`);
  };

  const posSnap = await getLatestSnapshot(positioningSnapshots, accountId, campaignId, sourceJobId);
  if (posSnap) includeIfGatedPass("positioning", posSnap, depthGateStatus?.positioning);

  const diffSnap = await getLatestSnapshot(differentiationSnapshots, accountId, campaignId, sourceJobId);
  if (diffSnap) includeIfGatedPass("differentiation", diffSnap, depthGateStatus?.differentiation);

  const mechSnap = await getLatestSnapshot(mechanismSnapshots, accountId, campaignId, sourceJobId);
  if (mechSnap) includeIfGatedPass("mechanism", mechSnap, depthGateStatus?.mechanism);

  const offerSnap = await getLatestSnapshot(offerSnapshots, accountId, campaignId, sourceJobId);
  if (offerSnap) includeIfGatedPass("offer", offerSnap, depthGateStatus?.offer);

  const funnelSnap = await getLatestSnapshot(funnelSnapshots, accountId, campaignId, sourceJobId);
  if (funnelSnap) includeIfGatedPass("funnel", funnelSnap, depthGateStatus?.funnel);

  const awarenessSnap = await getLatestSnapshot(awarenessSnapshots, accountId, campaignId, sourceJobId);
  if (awarenessSnap) includeIfGatedPass("awareness", awarenessSnap, depthGateStatus?.awareness);

  const persuasionSnap = await getLatestSnapshot(persuasionSnapshots, accountId, campaignId, sourceJobId);
  if (persuasionSnap) includeIfGatedPass("persuasion", persuasionSnap, depthGateStatus?.persuasion);

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

// Seal #10 / Task #28 / F4.3 — strict zod schema for the AI build-plan
// response. Replaces the prior shape-via-truthy-check + try/catch JSON.parse
// pattern that silently fell back to `null` on ANY shape violation. Now an
// invalid response yields a structured ValidationError so the caller can
// distinguish "AI returned malformed JSON" from "no response".
import { z } from "zod";

const BuildPlanResponseSchema = z.object({
  positioning: z.string().min(1),
  differentiation: z.string().min(1),
  mechanism: z.object({
    name: z.string().min(1),
    explanation: z.string().min(1),
  }),
  offer: z.string().min(1),
  funnel: z.object({
    top: z.string().min(1),
    middle: z.string().min(1),
    bottom: z.string().min(1),
  }),
  contentDna: z.object({
    contentTypes: z.object({
      problems: z.string().optional().default(""),
      proof: z.string().optional().default(""),
      education: z.string().optional().default(""),
      conversion: z.string().optional().default(""),
    }).optional().default(() => ({ problems: "", proof: "", education: "", conversion: "" })),
    contentAngles: z.array(z.any()).optional().default([]),
    hookStyles: z.array(z.any()).optional().default([]),
    messagingThemes: z.array(z.any()).optional().default([]),
    contentMixRatio: z.record(z.any()).optional().default({}),
  }),
  kpiRules: z.object({
    postingFrequency: z.string().optional().default(""),
    contentMix: z.string().optional().default(""),
    conversionTargets: z.string().optional().default(""),
  }),
  executionActions: z.object({
    daily: z.array(z.any()).optional(),
    weekly: z.array(z.any()).optional(),
    biweekly: z.array(z.any()).optional(),
  }).optional().default(() => ({ daily: [], weekly: [], biweekly: [] })),
});

type BuildPlanResponse = z.infer<typeof BuildPlanResponseSchema>;
type ParseAIResult =
  | { ok: true; plan: BuildPlanOutput }
  | { ok: false; kind: "JSON_MALFORMED" | "SHAPE_INVALID"; detail: string };

function parseAIResponse(content: string, rhythm: AdaptiveRhythm): ParseAIResult {
  let cleaned = content.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(cleaned);
  } catch (err: any) {
    const detail = err?.message ?? "parse_error";
    console.warn(`[BuildPlanLayer] AI_RESPONSE_PARSE_FAILED | reason=invalid_json | error=${detail}`);
    return { ok: false, kind: "JSON_MALFORMED", detail };
  }
  const result = BuildPlanResponseSchema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues.slice(0, 5).map(i => `${i.path.join(".")}=${i.code}`).join(",");
    console.warn(`[BuildPlanLayer] AI_RESPONSE_SHAPE_INVALID | reason=zod_validation_failed | issues=${detail}`);
    return { ok: false, kind: "SHAPE_INVALID", detail };
  }
  const parsed: BuildPlanResponse = result.data;
  try {
    const contentAngles = Array.isArray(parsed.contentDna?.contentAngles) ? parsed.contentDna.contentAngles.map(String) : [];
    const hookStyles = Array.isArray(parsed.contentDna?.hookStyles) ? parsed.contentDna.hookStyles.map(String) : [];
    const messagingThemes = Array.isArray(parsed.contentDna?.messagingThemes) ? parsed.contentDna.messagingThemes.map(String) : [];
    const mixRatio = parsed.contentDna?.contentMixRatio || {};

    const execActions = parsed.executionActions || {};

    const built: BuildPlanOutput = {
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
    return { ok: true, plan: built };
  } catch (err: any) {
    const detail = err?.message ?? "unknown";
    console.warn(`[BuildPlanLayer] AI_RESPONSE_BUILD_FAILED | reason=post_zod_construction_error | error=${detail}`);
    return { ok: false, kind: "SHAPE_INVALID", detail };
  }
}

export async function runBuildPlanLayer(
  accountId: string,
  campaignId: string,
  depthGateStatus?: Record<string, string>,
  sourceJobId?: string | null,
  analyticalEnrichment?: AnalyticalPackage | null,
): Promise<BuildPlanResult> {
  const MAX_ATTEMPTS = 3;
  const aelAck = acknowledgeAelInput("BuildPlanLayer", analyticalEnrichment ?? null, accountId);

  // F2.5 / F2.9 / pass-8 — hard BLOCK when sourceJobId is absent.
  // Without it we cannot prove the snapshots belong to the same run, so
  // synthesis is refused on every code path (no NODE_ENV gate). The
  // public contract is `{status:"BLOCKED", reason:"STALE_LINEAGE"}` so
  // downstream consumers and tests have a stable shape to switch on.
  if (!sourceJobId) {
    console.error(logSafe(`[BuildPlanLayer] STALE_LINEAGE_BLOCK | account=${accountId} campaign=${campaignId} — refusing build-plan synthesis without sourceJobId (cross-run snapshot stitching forbidden)`));
    const blockedResult: BuildPlanResult = {
      status: "BLOCKED",
      reason: "STALE_LINEAGE",
      plan: null,
      actionabilityScore: 0,
      failedBlocks: ["STALE_LINEAGE_BLOCK"],
      attempts: 0,
      error: "STALE_LINEAGE: no sourceJobId provided — refusing to synthesize build plan from unbound snapshots",
    };
    return applyPartialAelDowngrade("BuildPlanLayer", blockedResult, aelAck);
  }
  const snapshots = await collectValidatedEngineOutputs(accountId, campaignId, depthGateStatus, sourceJobId);

  if (snapshots.length < 3) {
    return applyPartialAelDowngrade("BuildPlanLayer", {
      status: "INSUFFICIENT_DATA",
      plan: null,
      actionabilityScore: 0,
      failedBlocks: [],
      attempts: 0,
      error: `Only ${snapshots.length} validated engine outputs available. Need at least 3.`,
    } as BuildPlanResult, aelAck);
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
        model: "gpt-4.1",
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

      const parseResult = parseAIResponse(content, adaptiveRhythm);
      if (!parseResult.ok) {
        // F8.3 / pass-9 — SHAPE_INVALID is a contract failure (zod said the
        // AI didn't return a build-plan-shaped object). Short-circuit to
        // BLOCKED with reason="AI_RESPONSE_INVALID" instead of retrying or
        // returning null — the AI cannot recover a shape contract by retry.
        // JSON_MALFORMED keeps the retry loop (transient stream truncation).
        if (parseResult.kind === "SHAPE_INVALID") {
          const blockedShape: BuildPlanResult = {
            status: "BLOCKED",
            reason: "AI_RESPONSE_INVALID",
            plan: null,
            actionabilityScore: 0,
            failedBlocks: ["AI_RESPONSE_SHAPE_INVALID"],
            attempts: attempt,
            error: `AI_RESPONSE_INVALID: ${parseResult.detail}`,
          };
          return applyPartialAelDowngrade("BuildPlanLayer", blockedShape, aelAck);
        }
        console.warn(`[BuildPlanLayer] Attempt ${attempt}: ${parseResult.kind} (${parseResult.detail}) — retrying`);
        continue;
      }
      const plan = parseResult.plan;

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
        const successResult: BuildPlanResult = {
          status: "SUCCESS",
          plan,
          actionabilityScore: actionability.score,
          failedBlocks: [],
          attempts: attempt,
        };
        return applyPartialAelDowngrade("BuildPlanLayer", successResult, aelAck);
      }

      lastFailedBlocks = actionability.failedBlocks;

      if (attempt === MAX_ATTEMPTS) {
        return applyPartialAelDowngrade("BuildPlanLayer", {
          status: "ACTIONABILITY_FAILED",
          plan,
          actionabilityScore: actionability.score,
          failedBlocks: actionability.failedBlocks,
          attempts: attempt,
        } as BuildPlanResult, aelAck);
      }
    } catch (err: any) {
      console.error(`[BuildPlanLayer] Attempt ${attempt} error:`, err.message);
      if (attempt === MAX_ATTEMPTS) {
        return applyPartialAelDowngrade("BuildPlanLayer", {
          status: "ERROR",
          plan: null,
          actionabilityScore: 0,
          failedBlocks: [],
          attempts: attempt,
          error: err.message,
        } as BuildPlanResult, aelAck);
      }
    }
  }

  return applyPartialAelDowngrade("BuildPlanLayer", {
    status: "ERROR",
    plan: null,
    actionabilityScore: 0,
    failedBlocks: [],
    attempts: MAX_ATTEMPTS,
    error: "All attempts exhausted",
  } as BuildPlanResult, aelAck);
}
