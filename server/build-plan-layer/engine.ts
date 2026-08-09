import { aiChat } from "../ai-client";
import { validateAuthorityBoundaries, type AuthorityCheckResult } from "../shared/authority-validator";
import { deriveValidatedCapabilities } from "../shared/capability-registry";
import { loadCampaignProductAnchor } from "../orchestrator/doctrine-seed";
import { acknowledgeAelInput, applyPartialAelDowngrade } from "../analytical-enrichment-layer/consumer-guard";
import { logSafe } from "../log-redact";
import { wrapUntrustedText, UNTRUSTED_INPUT_SYSTEM_RULE } from "../market-intelligence-v3/prompt-safety";

function u(text: unknown, source: string): string {
  const s = String(text ?? "").trim();
  if (!s) return "";
  return wrapUntrustedText(s, { source });
}

// typed accessor for Drizzle table internals
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
  orchestratorJobs,
} from "@shared/schema";
import { eq, desc, and, sql } from "drizzle-orm";
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

export type BuildPlanBlockReason = "STALE_LINEAGE" | "AI_RESPONSE_INVALID" | "AUTHORITY_VIOLATION";

export interface BuildPlanResult {
  status: "SUCCESS" | "ACTIONABILITY_FAILED" | "INSUFFICIENT_DATA" | "BLOCKED" | "INCOMPLETE" | "ERROR";
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

type SafeParseResult =
  | { ok: true; value: Json | null }
  | { ok: false; reason: string };

const _snapshotParseFailures = { count: 0, lastReason: null as string | null };
export function _getSnapshotParseFailureStats(): { count: number; lastReason: string | null } {
  return { count: _snapshotParseFailures.count, lastReason: _snapshotParseFailures.lastReason };
}

/**
 * Phase 6 / Task #69 step 7 — typed-error replacement of the silent
 * `} catch { return null; }` swallow. Parse failures are now logged AND
 * counted in a process-local counter so the operator surface (and the
 * eventual /metrics scrape) can detect a wave of corrupt snapshot rows
 * instead of a silent fallback to null. Callers that only need the
 * legacy `Json | null` shape can use `safeParseSnapshot()` (which
 * unwraps via `tryParseSnapshot()`); new code SHOULD prefer the
 * Result-shaped variant so the failure reason is preserved.
 */
function tryParseSnapshot(raw: SnapshotRow | { data: Json } | null | undefined): SafeParseResult {
  try {
    if (typeof raw === "string") return { ok: true, value: JSON.parse(raw) };
    return { ok: true, value: (raw ?? null) as Json | null };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    _snapshotParseFailures.count++;
    _snapshotParseFailures.lastReason = reason;
    console.error(logSafe(`[BuildPlanLayer] SNAPSHOT_PARSE_FAILED | reason=${reason.slice(0, 200)}`));
    return { ok: false, reason };
  }
}

function safeParseSnapshot(raw: SnapshotRow | { data: Json } | null | undefined): Json | null {
  const r = tryParseSnapshot(raw);
  return r.ok ? r.value : null;
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
 * every snapshot read must declare a
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
      // Phase 6 / Task #69 step 6 — BPL-001 fix. Previously a warn-only
      // breadcrumb; now also recorded in a process-local counter so
      // /metrics and the Continuity panel can detect a wave of
      // sourceJobId-less reads (which indicates an upstream caller has
      // bypassed the run-id wiring entirely). The snapshot is still
      // returned for D4 back-compat with legacy readers; the new counter
      // makes the silent-bypass surface non-silent.
      _staleLineageReads.count++;
      _staleLineageReads.lastTable = tableName(table);
      _staleLineageReads.lastAccountId = accountId;
      console.warn(logSafe(`[BuildPlanLayer] STALE_LINEAGE_READ | severity=high | account=${accountId} campaign=${campaignId} table=${tableName(table)} totalSinceBoot=${_staleLineageReads.count} — no sourceJobId provided; latest snapshot may belong to a different run. Caller MUST pass sourceJobId for runtime-truth correctness.`));
    }
    return snap || null;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    _snapshotReadErrors.count++;
    _snapshotReadErrors.lastReason = reason;
    console.error(logSafe(`[BuildPlanLayer] SNAPSHOT_READ_ERROR | account=${accountId} campaign=${campaignId} table=${tableName(table)} | reason=${reason.slice(0, 200)}`));
    return null;
  }
}

// Phase 6 / Task #69 steps 6 + 7 — operator-visible counters.
const _staleLineageReads = { count: 0, lastTable: null as string | null, lastAccountId: null as string | null };
const _snapshotReadErrors = { count: 0, lastReason: null as string | null };

export function _getBuildPlanLayerStats(): {
  staleLineageReads: { count: number; lastTable: string | null; lastAccountId: string | null };
  snapshotReadErrors: { count: number; lastReason: string | null };
  snapshotParseFailures: { count: number; lastReason: string | null };
} {
  return {
    staleLineageReads: { ..._staleLineageReads },
    snapshotReadErrors: { ..._snapshotReadErrors },
    snapshotParseFailures: { ..._snapshotParseFailures },
  };
}

// (authority-scan imports live at top of file)
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

  // D5 honesty: a missing depth-gate status is
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
      console.warn(logSafe(`[BuildPlanLayer] CONTRACT_INCOMPLETE | engine=${engineId} | reason=missing_depth_gate_status | account=${accountId} campaign=${campaignId}`));
      return;
    }
    console.log(logSafe(`[BuildPlanLayer] DEPTH_GATE_NOT_PASS | engine=${engineId} | status=${status}`));
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

  // Task #70 / Phase 7 / Step 4 — Awareness → Funnel authority precedence.
  // Compute the declarative overlap-region resolution BEFORE any [Awareness]
  // / [Funnel] lines are emitted, then inject the deterministic precedence
  // summary so the LLM cannot re-decide which engine wins on overlap fields.
  const awarenessData = snapshots.find(s => s.engineId === "awareness")?.data;
  const funnelData = snapshots.find(s => s.engineId === "funnel")?.data;
  if (awarenessData || funnelData) {
    const { summarizeAuthorityPrecedence } = require("./awareness-funnel-authority") as
      typeof import("./awareness-funnel-authority");
    const awarenessResult = awarenessData ? (safeParse(awarenessData.result) || awarenessData) : null;
    const funnelResult = funnelData ? (safeParse(funnelData.result) || funnelData) : null;
    const { text, resolutions } = summarizeAuthorityPrecedence({
      awareness: awarenessResult ? { ...awarenessResult, ...(awarenessResult.primaryRoute ?? {}) } : null,
      funnel: funnelResult,
    });
    const contended = Object.values(resolutions).filter(
      r => r.state === "awareness_wins" || r.state === "funnel_wins",
    ).length;
    console.log(`[BuildPlanLayer] AWARENESS_FUNNEL_AUTHORITY | overlapFields=${Object.keys(resolutions).length} | contended=${contended}`);
    parts.push(text);
  }

  for (const snap of snapshots) {
    const data = snap.data;
    switch (snap.engineId) {
      case "market_intelligence": {
        const competitors = safeArr(data.competitorData).slice(0, 5).map((c: any) => c.name || c.handle || "unknown").join(", ");
        const signals = safeArr(data.signalData).slice(0, 5).map((s: any) => s.text || s.signal || "").join("; ");
        parts.push(`[Market Intelligence] Competitors: ${u(competitors, "mi.competitors")}. Key signals: ${u(signals, "mi.signals")}. Market state: ${u(data.marketState || "active", "mi.marketState")}`);
        break;
      }
      case "audience": {
        const pains = safeArr(data.audiencePains).slice(0, 3).map((p: any) => typeof p === "string" ? p : p.pain || p.label || p.name || "").join("; ");
        const desires = safeArr(data.desireMap).slice(0, 3).map((d: any) => typeof d === "string" ? d : d.desire || d.label || d.name || "").join("; ");
        const segments = safeArr(data.audienceSegments).slice(0, 2).map((s: any) => typeof s === "string" ? s : s.name || s.segment || "").join(", ");
        parts.push(`[Audience] Top pains: ${u(pains, "audience.pains")}. Top desires: ${u(desires, "audience.desires")}. Segments: ${u(segments, "audience.segments")}`);
        break;
      }
      case "positioning": {
        const result = safeParse(data.result) || data;
        const narrative = result.narrative || result.narrativeDirection || data.narrativeDirection || "";
        const territories = safeArr(result.territories || data.territories).slice(0, 2).map((t: any) => typeof t === "string" ? t : t.name || t.territory || "").join(", ");
        parts.push(`[Positioning] Narrative: ${u(narrative, "positioning.narrative")}. Territories: ${u(territories, "positioning.territories")}`);
        break;
      }
      case "differentiation": {
        const result = safeParse(data.result) || data;
        const claims = safeArr(result.validatedClaims || result.claimStructures || data.claimStructures).slice(0, 3).map((c: any) => typeof c === "string" ? c : c.claim || c.title || "").join("; ");
        const mode = result.authorityMode?.mode || result.authorityMode || data.authorityMode || "";
        const modeStr = typeof mode === "object" ? mode.mode || "" : mode;
        parts.push(`[Differentiation] Claims: ${u(claims, "differentiation.claims")}. Authority mode: ${u(modeStr, "differentiation.authorityMode")}`);
        break;
      }
      case "mechanism": {
        const result = safeParse(data.result) || data;
        const name = result.mechanismName || result.name || data.mechanismName || "";
        const explanation = result.mechanismExplanation || result.explanation || result.howItWorks || "";
        const explStr = typeof explanation === "string" ? explanation.substring(0, 200) : "";
        parts.push(`[Mechanism] Name: ${u(name, "mechanism.name")}. Explanation: ${u(explStr, "mechanism.explanation")}`);
        break;
      }
      case "offer": {
        const result = safeParse(data.result) || data;
        const headline = result.offerHeadline || result.headline || data.offerHeadline || "";
        const value = result.primaryValueProp || result.valueProposition || "";
        parts.push(`[Offer] Headline: ${u(typeof headline === "string" ? headline : "", "offer.headline")}.  Value: ${u(typeof value === "string" ? value : "", "offer.value")}`);
        break;
      }
      case "funnel": {
        const result = safeParse(data.result) || data;
        const stages = safeArr(result.stages || result.funnelStages || data.stages).slice(0, 3).map((s: any) => `${s.name || s.stage || ""}: ${s.objective || s.description || ""}`).join(" → ");
        parts.push(`[Funnel] ${u(stages, "funnel.stages")}`);
        break;
      }
      case "awareness": {
        const result = safeParse(data.result) || data;
        const route = result.primaryRoute?.routeName || result.primaryRoute?.name || "";
        parts.push(`[Awareness] Primary route: ${u(route, "awareness.primaryRoute")}`);
        break;
      }
      case "persuasion": {
        const result = safeParse(data.result) || data;
        const route = result.primaryRoute?.routeName || result.primaryRoute?.name || "";
        const alt = result.alternativeRoute?.routeName || "";
        parts.push(`[Persuasion] Primary: ${u(route, "persuasion.primaryRoute")}${alt ? `, Alternative: ${u(alt, "persuasion.alternativeRoute")}` : ""}`);
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

${UNTRUSTED_INPUT_SYSTEM_RULE}

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

// strict zod schema for the AI build-plan
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
    console.warn(logSafe(`[BuildPlanLayer] AI_RESPONSE_PARSE_FAILED | reason=invalid_json | error=${detail}`));
    return { ok: false, kind: "JSON_MALFORMED", detail };
  }
  const result = BuildPlanResponseSchema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues.slice(0, 5).map(i => `${i.path.join(".")}=${i.code}`).join(",");
    console.warn(logSafe(`[BuildPlanLayer] AI_RESPONSE_SHAPE_INVALID | reason=zod_validation_failed | issues=${detail}`));
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
    console.warn(logSafe(`[BuildPlanLayer] AI_RESPONSE_BUILD_FAILED | reason=post_zod_construction_error | error=${detail}`));
    return { ok: false, kind: "SHAPE_INVALID", detail };
  }
}

/**
 * Reload the per-engine depth-gate verdict map from the run's persisted state.
 *
 * The map is produced in-memory as ctx.depthGateStatus during runOrchestrator
 * and persisted to orchestrator_jobs.depth_gate_status (migration 039). We read
 * it here — scoped by accountId so a client-suppliable sourceJobId cannot reach
 * another tenant's run — when no in-process caller supplied the map.
 *
 * This is data-source resolution, NOT a D1 semantic fallback: a missing job
 * row, NULL column, or unparseable payload returns undefined, so the D5
 * CONTRACT_INCOMPLETE path in collectValidatedEngineOutputs fires — no engine
 * is ever silently defaulted to a pass state.
 */
async function loadPersistedDepthGateStatus(
  accountId: string,
  sourceJobId: string,
): Promise<Record<string, string> | undefined> {
  try {
    const [row] = await db
      .select({ depthGate: orchestratorJobs.depthGateStatus })
      .from(orchestratorJobs)
      .where(and(eq(orchestratorJobs.id, sourceJobId), eq(orchestratorJobs.accountId, accountId)))
      .limit(1);
    if (!row || !row.depthGate) {
      console.warn(logSafe(`[BuildPlanLayer] DEPTH_GATE_NOT_PERSISTED | job=${sourceJobId} account=${accountId} — gated engines will be treated as CONTRACT_INCOMPLETE`));
      return undefined;
    }
    const parsed = JSON.parse(row.depthGate);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      console.warn(logSafe(`[BuildPlanLayer] DEPTH_GATE_PARSE_FAILED | job=${sourceJobId} | reason=non_object_payload`));
      return undefined;
    }
    return parsed as Record<string, string>;
  } catch (err: any) {
    console.warn(logSafe(`[BuildPlanLayer] DEPTH_GATE_PARSE_FAILED | job=${sourceJobId} | error=${err?.message ?? err}`));
    return undefined;
  }
}

/**
 * Reload the persisted AnalyticalPackage (AEL) for this run from ael_snapshots
 * (a raw-SQL table, not a drizzle model). Scoped by job_id + account_id +
 * campaign_id — the same canonical key the narrative layer reads. Absent or
 * unreadable → null, which drives the truthful AEL-absent downgrade via
 * acknowledgeAelInput (B3) rather than a fabricated package.
 */
async function loadPersistedAel(
  accountId: string,
  campaignId: string,
  sourceJobId: string,
): Promise<AnalyticalPackage | null> {
  try {
    const res = await db.execute(
      sql`SELECT package FROM ael_snapshots
          WHERE job_id = ${sourceJobId} AND account_id = ${accountId} AND campaign_id = ${campaignId}
          LIMIT 1`,
    );
    const raw = res.rows?.[0]?.package;
    if (!raw) {
      console.warn(logSafe(`[BuildPlanLayer] AEL_NOT_PERSISTED | job=${sourceJobId} account=${accountId} — proceeding with AEL-absent downgrade`));
      return null;
    }
    const pkg = typeof raw === "string" ? JSON.parse(raw) : raw;
    return pkg as AnalyticalPackage;
  } catch (err: any) {
    console.warn(logSafe(`[BuildPlanLayer] AEL_LOAD_FAILED | job=${sourceJobId} | error=${err?.message ?? err}`));
    return null;
  }
}

/**
 * FINAL AUTHORITY VALIDATION (deterministic, no LLM) for the synthesized plan:
 * - central problem framing must resolve to the run's selected audience pains
 *   (Pain Registry = sole problem authority);
 * - structured capabilityRefs must resolve to the validated capability
 *   registry derived from the Product Anchor (capability authority).
 * When the audience snapshot carries no pain registry, the problem check is
 * skipped truthfully (no pains → no problem-namespace authority to enforce);
 * this is logged, never silently passed off as a full validation.
 */
async function runPlanAuthorityScan(
  plan: any,
  snapshots: EngineSnapshot[],
  accountId: string,
  campaignId: string,
): Promise<AuthorityCheckResult> {
  const audienceSnap = snapshots.find((s) => s.engineId === "audience");
  const rawRegistry = (audienceSnap?.data as any)?.painRegistry ?? (audienceSnap?.data as any)?.data?.painRegistry ?? null;
  const registry: any[] = typeof rawRegistry === "string" ? (() => { try { return JSON.parse(rawRegistry); } catch { return []; } })() : Array.isArray(rawRegistry) ? rawRegistry : [];
  const selectedPains = registry
    .filter((p: any) => p && typeof p.painId === "string" && typeof p.canonical === "string")
    .map((p: any) => ({ painId: p.painId, canonical: p.canonical }));

  const anchor = await loadCampaignProductAnchor(campaignId, accountId);
  const capabilities = deriveValidatedCapabilities(anchor, null);

  // Collect central problem texts + capabilityRefs from the plan JSON.
  const centralProblemTexts: string[] = [];
  const capabilityRefs: string[] = [];
  const walk = (node: any, keyPath: string) => {
    if (node == null) return;
    if (Array.isArray(node)) { node.forEach((v, i) => walk(v, `${keyPath}[${i}]`)); return; }
    if (typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        if (/capabilityRefs/i.test(k) && Array.isArray(v)) {
          for (const r of v) if (typeof r === "string") capabilityRefs.push(r);
        } else if (/(centralProblem|problemStatement|coreProblem)/i.test(k) && typeof v === "string") {
          centralProblemTexts.push(v);
        } else {
          walk(v, `${keyPath}.${k}`);
        }
      }
    }
  };
  walk(plan, "plan");

  if (selectedPains.length === 0) {
    console.log(logSafe(`[BuildPlanLayer] AUTHORITY_SCAN_PARTIAL | no pain registry on audience snapshot — problem-namespace check skipped truthfully`));
  }
  return validateAuthorityBoundaries({
    engineId: "build_plan",
    centralProblemTexts: selectedPains.length > 0 ? centralProblemTexts : [],
    capabilityRefs,
    selectedPains,
    capabilities,
  });
}

export async function runBuildPlanLayer(
  accountId: string,
  campaignId: string,
  depthGateStatus?: Record<string, string>,
  sourceJobId?: string | null,
  analyticalEnrichment?: AnalyticalPackage | null,
): Promise<BuildPlanResult> {
  const MAX_ATTEMPTS = 3;

  // hard BLOCK when sourceJobId is absent.
  // Without it we cannot prove the snapshots belong to the same run, so
  // synthesis is refused on every code path (no NODE_ENV gate). The
  // public contract is `{status:"BLOCKED", reason:"STALE_LINEAGE"}` so
  // downstream consumers and tests have a stable shape to switch on.
  if (!sourceJobId) {
    console.error(logSafe(`[BuildPlanLayer] STALE_LINEAGE_BLOCK | account=${accountId} campaign=${campaignId} — refusing build-plan synthesis without sourceJobId (cross-run snapshot stitching forbidden)`));
    const staleAck = acknowledgeAelInput("BuildPlanLayer", analyticalEnrichment ?? null, accountId);
    const blockedResult: BuildPlanResult = {
      status: "BLOCKED",
      reason: "STALE_LINEAGE",
      plan: null,
      actionabilityScore: 0,
      failedBlocks: ["STALE_LINEAGE_BLOCK"],
      attempts: 0,
      error: "STALE_LINEAGE: no sourceJobId provided — refusing to synthesize build plan from unbound snapshots",
    };
    return applyPartialAelDowngrade("BuildPlanLayer", blockedResult, staleAck);
  }

  // Reload the depth-gate map + AEL server-side from the run's persisted state
  // (bound by sourceJobId + accountId) when an in-process caller did not supply
  // them. Caller-supplied values win (future in-process orchestrator path); the
  // DB is the fallback DATA SOURCE carrying the same canonical map — source
  // resolution, not a D1 semantic fallback. Missing/NULL/unparseable →
  // undefined/null → the existing D5 CONTRACT_INCOMPLETE / AEL-absent
  // degradation fires downstream (never a fabricated pass).
  let resolvedDepthGate = depthGateStatus;
  if (!resolvedDepthGate) {
    resolvedDepthGate = await loadPersistedDepthGateStatus(accountId, sourceJobId);
  }
  let resolvedAel = analyticalEnrichment ?? null;
  if (!resolvedAel) {
    resolvedAel = await loadPersistedAel(accountId, campaignId, sourceJobId);
  }

  const aelAck = acknowledgeAelInput("BuildPlanLayer", resolvedAel, accountId);
  const snapshots = await collectValidatedEngineOutputs(accountId, campaignId, resolvedDepthGate, sourceJobId);

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

  console.log(logSafe(`[BuildPlanLayer] Adaptive rhythm: reels=${adaptiveRhythm.reelsPerWeek}/wk carousels=${adaptiveRhythm.carouselsPerWeek}/wk stories=${adaptiveRhythm.storiesPerDay}/day posts=${adaptiveRhythm.postsPerWeek}/wk | basis=${adaptiveRhythm.performanceBasis}`));

  let memoryBlockForConstraints: import("../memory-system/types").MemoryBlock | null = null;
  try {
    memoryBlockForConstraints = await buildMemoryContext(campaignId, accountId);
  } catch (memErr: any) {
    console.warn(logSafe(`[BuildPlanLayer] Memory context load failed (non-blocking): ${memErr?.message ?? ""}`));
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
        // buildPlan uses gpt-4.1 through the custom proxy which reliably
        // exceeds the 45 s HARD_TIMEOUT_MS instance default.  Pass an
        // explicit per-call override so only this call gets a larger budget;
        // the global client timeout (and all other engines) remain unchanged.
        timeoutMs: 120_000,
        accountId,
        endpoint: "build-plan-layer",
      });

      const content = response.choices?.[0]?.message?.content;
      if (!content) {
        console.warn(logSafe(`[BuildPlanLayer] Attempt ${attempt}: Empty AI response`));
        continue;
      }

      const parseResult = parseAIResponse(content, adaptiveRhythm);
      if (!parseResult.ok) {
        // SHAPE_INVALID = zod-shape contract failure → INCOMPLETE (not BLOCKED:
        // task spec calls for an "incomplete signal", not a hard execution
        // block). JSON_MALFORMED keeps the retry loop.
        if (parseResult.kind === "SHAPE_INVALID") {
          const incompleteShape: BuildPlanResult = {
            status: "INCOMPLETE",
            reason: "AI_RESPONSE_INVALID",
            plan: null,
            actionabilityScore: 0,
            failedBlocks: ["AI_RESPONSE_SHAPE_INVALID"],
            attempts: attempt,
            error: `AI_RESPONSE_INVALID: ${parseResult.detail}`,
          };
          return applyPartialAelDowngrade("BuildPlanLayer", incompleteShape, aelAck);
        }
        console.warn(logSafe(`[BuildPlanLayer] Attempt ${attempt}: ${parseResult.kind} (${parseResult.detail}) — retrying`));
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
            console.log(logSafe(`[BuildPlanLayer] MEMORY_CONSTRAINTS_APPLIED | overrides=${overrides.length} | fields=${overrides.map(o => o.field).join(",")}`));
          }
        } catch (memApplyErr: any) {
          console.warn(logSafe(`[BuildPlanLayer] Memory constraint application failed (non-blocking): ${memApplyErr?.message ?? ""}`));
        }
      }

      const actionability = enforceActionability(plan);
      console.log(logSafe(`[BuildPlanLayer] Attempt ${attempt}: actionability=${actionability.score.toFixed(2)}, passed=${actionability.passed}, failed=${actionability.failedBlocks.join(",")}`));

      if (actionability.passed) {
        // FINAL AUTHORITY VALIDATION: before the plan can succeed, its
        // problem framing must resolve to the run's selected audience pains
        // and any structured capabilityRefs must resolve to validated
        // capabilities. Deterministic — no LLM. A violation retries the
        // synthesis with exact feedback (bounded by the same MAX_ATTEMPTS).
        const authorityCheck = await runPlanAuthorityScan(plan, snapshots, accountId, campaignId);
        if (!authorityCheck.passed) {
          console.warn(logSafe(`[BuildPlanLayer] AUTHORITY_VIOLATION | attempt=${attempt} | ${authorityCheck.violations.map((v) => v.kind).join(",")}`));
          lastFailedBlocks = authorityCheck.violations.map((v) => `AUTHORITY:${v.kind}: ${v.retryFeedback}`);
          if (attempt === MAX_ATTEMPTS) {
            return applyPartialAelDowngrade("BuildPlanLayer", {
              status: "ACTIONABILITY_FAILED",
              reason: "AUTHORITY_VIOLATION",
              plan,
              actionabilityScore: actionability.score,
              failedBlocks: lastFailedBlocks,
              attempts: attempt,
            } as BuildPlanResult, aelAck);
          }
          continue;
        }
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
      console.error(logSafe(`[BuildPlanLayer] Attempt ${attempt} error: ${err?.message ?? ""}`));
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
