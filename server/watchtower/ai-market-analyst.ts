/**
 * Watchtower AI Interpretation Layer (P-3 Enhancement — "Grounded by Code")
 *
 * Sits ABOVE the deterministic Watchtower Truth Engine:
 *
 *   Watchtower Truth Engine (shift detection + distribution intelligence)
 *        ↓ Verified Market Signals (structured, numeric, deterministic)
 *   AI Market Analyst (LLM — INTERPRETATION ONLY)
 *        ↓
 *   Deterministic grounding guards (code) → Grounding / Quality Judge (LLM)
 *        ↓
 *   Customer Insight  (or deterministic summary fallback)
 *
 * Doctrine:
 *   - The LLM NEVER sees raw posts or captions — only verified structured output.
 *   - The LLM NEVER calculates, discovers, or changes deterministic values.
 *   - Every AI interpretation must pass (a) deterministic code guards and
 *     (b) an LLM grounding judge. Rejected output is NEVER exposed — the
 *     deterministic summary is returned instead.
 *   - Observations only. No strategic recommendations.
 *   - LLM runs only when meaningful verified signals exist (trigger gate),
 *     and results are cached by payload fingerprint so identical signal
 *     states never re-invoke the model.
 */

import { createHash } from "crypto";
import { and, desc, eq, gte, isNotNull } from "drizzle-orm";
import { db } from "../db";
import { pipelineChangeEvents, ciCompetitors } from "../../shared/schema";
import { aiChat } from "../ai-client";
import {
  computeMarketDistributionSnapshot,
  type MarketDistributionSnapshot,
  type WindowDays,
} from "./distribution-intelligence";
import {
  translateSignalKind,
  translateSignalScope,
  translateSignalSeverity,
  humanizeSemanticValue,
} from "../../shared/perception-translator";
import { recordMarketInsight } from "../strategic-reasoning/market-memory";

const LOG = "[AIMarketAnalyst]";
import { recordReasoningRun } from "../strategic-reasoning/evidence-registry";

const ANALYST_MODEL = "gpt-4.1-mini";
const JUDGE_MODEL = "gpt-4.1-mini";
const INSIGHT_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — payload-hash keyed, so cache only matters while signals are unchanged
const INSIGHT_CACHE_MAX = 200;

// ── verified signal bundle (the ONLY thing the LLM sees) ─────────────────────

export interface ConfirmedSignalInput {
  label: string;                 // translated kind, e.g. "Value proposition shift"
  severity: string;              // "Minor shift" | "Moderate shift" | "Major shift"
  scope: string;                 // "One competitor" | "Several competitors" | "Market-wide"
  scopeCompetitorCount: number;
  competitor: string | null;     // competitor display name (verified)
  evidence: string[];            // deterministic evidence notes
  detectedAt: string | null;
}

export interface VerifiedSignalBundle {
  windowDays: number;
  currentWindow: { from: string; to: string };
  previousWindow: { from: string; to: string };
  totalPosts: number;
  totalCompetitors: number;
  dataStatus: "ok" | "thin" | "insufficient";
  confirmedShifts: ConfirmedSignalInput[];
  dominantPatterns: Array<{
    dimension: string;
    leader: string;
    leaderShare: number;
    trend: string;
    trendDeltaPp: number;
    sampleSize: number;
    competitorCount: number;
    confidence: string;
  }>;
  emergingPatterns: Array<{
    dimension: string;
    value: string;
    previousShare: number;
    currentShare: number;
    deltaPp: number;
    competitorCount: number;
    adoptionGrowthPp: number | null;
    adoptionAccelerationPp: number | null;
  }>;
  decliningPatterns: Array<{
    dimension: string;
    value: string;
    previousShare: number;
    currentShare: number;
    deltaPp: number;
    competitorCount: number;
  }>;
}

export interface AiInterpretation {
  headline: string;
  narrative: string;
  signalGroups: Array<{ title: string; signals: string[]; observation: string }>;
  strongestObservations: string[];
  uncertainObservations: string[];
}

export interface JudgeResult {
  verdict: "PASS" | "REJECT";
  violations: string[];
}

export interface MarketInsight {
  source: "ai" | "deterministic";
  headline: string;
  narrative: string;
  signalGroups: Array<{ title: string; signals: string[]; observation: string }>;
  strongestObservations: string[];
  uncertainObservations: string[];
  generatedAt: string;
  windowDays: number;
  basedOn: { confirmedShifts: number; posts: number; competitors: number };
  /** Internal telemetry — why the deterministic path was used (never customer copy). */
  deterministicReason?: "no_trigger" | "guards_rejected" | "judge_rejected" | "llm_failed";
}

// ── bundle construction (deterministic — reuses the Truth Engine) ────────────

export async function buildVerifiedSignalBundle(
  campaignId: string,
  windowDays: WindowDays = 30,
): Promise<{ bundle: VerifiedSignalBundle; snapshot: MarketDistributionSnapshot }> {
  const snapshot = await computeMarketDistributionSnapshot(campaignId, windowDays);

  const rows = await db
    .select({
      kind: pipelineChangeEvents.kind,
      severity: pipelineChangeEvents.severity,
      scope: pipelineChangeEvents.scope,
      scopeCompetitorCount: pipelineChangeEvents.scopeCompetitorCount,
      evidence: pipelineChangeEvents.evidence,
      validatedAt: pipelineChangeEvents.validatedAt,
      competitorName: ciCompetitors.name,
    })
    .from(pipelineChangeEvents)
    .leftJoin(ciCompetitors, eq(pipelineChangeEvents.competitorId, ciCompetitors.id))
    .where(
      and(
        eq(pipelineChangeEvents.campaignId, campaignId),
        isNotNull(pipelineChangeEvents.validatedAt),
        isNotNull(pipelineChangeEvents.kind),
        // Period honesty: the insight claims "last N days" — only shifts
        // confirmed inside the snapshot's CURRENT window may inform it.
        gte(pipelineChangeEvents.validatedAt, new Date(snapshot.currentWindow.from)),
      ),
    )
    .orderBy(desc(pipelineChangeEvents.validatedAt))
    .limit(20);

  const confirmedShifts: ConfirmedSignalInput[] = rows
    .map((row) => {
      const label = translateSignalKind(row.kind);
      if (!label) return null; // allowlist: unknown kinds are dropped, never paraphrased
      let notes: string[] = [];
      if (row.evidence) {
        try {
          const parsed = JSON.parse(row.evidence);
          notes = Array.isArray(parsed?.notes)
            ? (parsed.notes as unknown[]).filter((n): n is string => typeof n === "string")
            : [];
        } catch { notes = []; }
      }
      return {
        label,
        severity: translateSignalSeverity(row.severity),
        scope: translateSignalScope(row.scope),
        scopeCompetitorCount: row.scopeCompetitorCount ?? 1,
        competitor: row.competitorName ?? null,
        evidence: notes,
        detectedAt: row.validatedAt instanceof Date ? row.validatedAt.toISOString() : (row.validatedAt as string | null),
      };
    })
    .filter((s): s is ConfirmedSignalInput => s !== null);

  const adoptionFor = (dimension: string, value: string) =>
    snapshot.adoption.find((a) => a.dimensionLabel === dimension && a.value === value) ?? null;

  const bundle: VerifiedSignalBundle = {
    windowDays: snapshot.windowDays,
    currentWindow: snapshot.currentWindow,
    previousWindow: snapshot.previousWindow,
    totalPosts: snapshot.totalPosts,
    totalCompetitors: snapshot.totalCompetitors,
    dataStatus: snapshot.dataStatus,
    confirmedShifts,
    dominantPatterns: snapshot.insights
      .filter((i) => i.leader !== null)
      .map((i) => ({
        dimension: i.dimensionLabel,
        leader: humanizeSemanticValue(i.leader),
        leaderShare: i.leaderShare,
        trend: i.trend,
        trendDeltaPp: i.trendDeltaPp,
        sampleSize: i.sampleSize,
        competitorCount: i.competitorCount,
        confidence: i.confidence,
      })),
    emergingPatterns: snapshot.emerging.map((p) => {
      const a = adoptionFor(p.dimensionLabel, p.value);
      return {
        dimension: p.dimensionLabel,
        value: humanizeSemanticValue(p.value),
        previousShare: p.previousShare,
        currentShare: p.currentShare,
        deltaPp: p.deltaPp,
        competitorCount: p.competitorCount,
        adoptionGrowthPp: a ? a.growthPp : null,
        adoptionAccelerationPp: a ? a.accelerationPp : null,
      };
    }),
    decliningPatterns: snapshot.declining.map((p) => ({
      dimension: p.dimensionLabel,
      value: humanizeSemanticValue(p.value),
      previousShare: p.previousShare,
      currentShare: p.currentShare,
      deltaPp: p.deltaPp,
      competitorCount: p.competitorCount,
    })),
  };

  return { bundle, snapshot };
}

// ── trigger gate (§9: don't invoke the LLM for every scrape) ─────────────────

export function shouldInvokeAnalyst(bundle: VerifiedSignalBundle): boolean {
  if (bundle.dataStatus === "insufficient") return false;
  const marketWideShift = bundle.confirmedShifts.some((s) => s.scope === "Market-wide" || s.scope === "Several competitors");
  const meaningful =
    bundle.confirmedShifts.length > 0 ||
    bundle.emergingPatterns.length > 0 ||
    bundle.decliningPatterns.length > 0 ||
    marketWideShift;
  return meaningful;
}

// ── deterministic summary (fallback + no-trigger output) ─────────────────────

export function buildDeterministicSummary(bundle: VerifiedSignalBundle): MarketInsight {
  const parts: string[] = [];
  const strongest: string[] = [];
  const uncertain: string[] = [];

  if (bundle.dataStatus === "insufficient") {
    parts.push(
      `Not enough classified competitor activity in the last ${bundle.windowDays} days to describe the market structure (${bundle.totalPosts} posts).`,
    );
  } else {
    for (const s of bundle.confirmedShifts.slice(0, 3)) {
      parts.push(
        `${s.label} confirmed (${s.severity.toLowerCase()}, ${s.scope.toLowerCase()}${s.competitor ? `, ${s.competitor}` : ""}).`,
      );
    }
    for (const p of bundle.emergingPatterns.slice(0, 3)) {
      parts.push(`${p.dimension}: "${p.value}" grew from ${p.previousShare}% to ${p.currentShare}% of classified posts (${p.competitorCount} competitors).`);
    }
    for (const p of bundle.decliningPatterns.slice(0, 3)) {
      parts.push(`${p.dimension}: "${p.value}" fell from ${p.previousShare}% to ${p.currentShare}%.`);
    }
    const topDominant = bundle.dominantPatterns
      .filter((d) => d.confidence !== "low")
      .slice(0, 2);
    for (const d of topDominant) {
      parts.push(`Most common ${d.dimension.toLowerCase()}: "${d.leader}" at ${d.leaderShare}% (${d.sampleSize} posts, ${d.competitorCount} competitors).`);
      strongest.push(`${d.dimension}: "${d.leader}" leads at ${d.leaderShare}%`);
    }
    const insufficientTrends = bundle.dominantPatterns.filter((d) => d.trend === "insufficient_history").length;
    if (insufficientTrends > 0) {
      uncertain.push(`Trend direction is not yet established for ${insufficientTrends} dimensions — the previous period has too little classified history.`);
    }
    if (parts.length === 0) {
      parts.push(`No confirmed market shifts or significant pattern changes in the last ${bundle.windowDays} days across ${bundle.totalCompetitors} competitors (${bundle.totalPosts} classified posts).`);
    }
  }

  return {
    source: "deterministic",
    headline: bundle.confirmedShifts.length > 0 || bundle.emergingPatterns.length > 0
      ? "Verified market changes this period"
      : "Market activity summary",
    narrative: parts.join(" "),
    signalGroups: [],
    strongestObservations: strongest,
    uncertainObservations: uncertain,
    generatedAt: new Date().toISOString(),
    windowDays: bundle.windowDays,
    basedOn: {
      confirmedShifts: bundle.confirmedShifts.length,
      posts: bundle.totalPosts,
      competitors: bundle.totalCompetitors,
    },
  };
}

// ── AI Market Analyst (interpretation only) ──────────────────────────────────

const ANALYST_SYSTEM_PROMPT = `You are a market analyst interpreting VERIFIED competitive-market signals for a business owner.

The signals were computed deterministically from classified competitor social posts. They are the ONLY source of truth. You interpret; you never calculate, discover, or invent.

STRICT RULES — violating any of these makes your output unusable:
1. Use ONLY the numbers, competitors, dimensions, and values present in the supplied data. Never invent a number, competitor, trend, or pattern.
2. Never change a deterministic value (shares, deltas, scope, severity, confidence).
3. Never upgrade or downgrade scope (e.g. one competitor ≠ market-wide).
4. Respect confidence and history: if trend="insufficient_history" or dataStatus is "thin", explicitly say trend confidence is limited.
5. Observations only. NEVER recommend actions, strategy, or what the business "should" do.
6. Causation: you may say what business behavior MIGHT explain a change ("suggesting", "consistent with"), but never claim proven causation or commercial outcomes.
7. Connect related signals into coherent market movements where the data supports it; state clearly when changes appear independent.
8. Plain business English. No template filler. No hype.

Respond ONLY with JSON:
{
  "headline": "one short sentence naming the overall market story",
  "narrative": "2-5 sentences synthesizing what the signals collectively show, which are connected vs independent, and what behavior might explain them",
  "signalGroups": [{ "title": "short group name", "signals": ["signal refs from the data"], "observation": "1-2 sentences on why these belong together" }],
  "strongestObservations": ["the best-supported observations, each citing its numbers"],
  "uncertainObservations": ["observations that remain uncertain and why (sample size, insufficient history, low confidence)"]
}
signalGroups may be empty if changes are independent — then say so in the narrative.`;

export async function runMarketAnalyst(
  bundle: VerifiedSignalBundle,
  accountId: string,
): Promise<AiInterpretation> {
  let lastError = "";
  let parsed: ({ headline: string; narrative: string } & Partial<AiInterpretation>) | null = null;

  // 2 attempts — large live bundles occasionally truncate or malform JSON;
  // attempt 2 restates the failure so the model self-corrects (classifier pattern).
  for (let attempt = 1; attempt <= 2 && !parsed; attempt++) {
    const userContent =
      attempt === 1
        ? `Verified Watchtower market signals:\n${JSON.stringify(bundle, null, 2)}`
        : `Verified Watchtower market signals:\n${JSON.stringify(bundle, null, 2)}\n\n[SELF-CORRECTION] Your previous response failed: ${lastError}. Return ONLY the complete, valid JSON object. Keep signalGroups and observation lists concise so the response fits.`;
    const response = await aiChat({
      model: ANALYST_MODEL,
      max_tokens: 1400,
      temperature: 0.2,
      timeoutMs: 60_000, // 90d bundles are large; default timeout was observed to trip
      accountId,
      endpoint: "watchtower-market-analyst",
      messages: [
        { role: "system", content: ANALYST_SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
    });
    const raw = response.choices?.[0]?.message?.content ?? "";
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("no JSON object in response");
      const candidate = JSON.parse(match[0]) as Partial<AiInterpretation>;
      if (typeof candidate.headline !== "string" || typeof candidate.narrative !== "string") {
        throw new Error("JSON missing headline/narrative");
      }
      parsed = candidate as { headline: string; narrative: string } & Partial<AiInterpretation>;
    } catch (err) {
      lastError = (err as Error).message;
      console.warn(`${LOG} ANALYST_PARSE_RETRY attempt=${attempt} detail=${lastError}`);
    }
  }
  if (!parsed) throw new Error(`Analyst failed after 2 attempts: ${lastError}`);

  return {
    headline: parsed.headline,
    narrative: parsed.narrative,
    signalGroups: Array.isArray(parsed.signalGroups)
      ? parsed.signalGroups.filter(
          (g): g is AiInterpretation["signalGroups"][number] =>
            !!g && typeof g.title === "string" && typeof g.observation === "string" && Array.isArray(g.signals),
        )
      : [],
    strongestObservations: Array.isArray(parsed.strongestObservations)
      ? parsed.strongestObservations.filter((s): s is string => typeof s === "string")
      : [],
    uncertainObservations: Array.isArray(parsed.uncertainObservations)
      ? parsed.uncertainObservations.filter((s): s is string => typeof s === "string")
      : [],
  };
}

// ── deterministic grounding guards (code — run BEFORE the LLM judge) ─────────

/** Collect every number that legitimately appears in the bundle. */
function collectAllowedNumbers(bundle: VerifiedSignalBundle): Set<number> {
  const allowed = new Set<number>();
  const walk = (v: unknown): void => {
    if (typeof v === "number" && Number.isFinite(v)) {
      allowed.add(Math.abs(Math.round(v * 10) / 10));
      allowed.add(Math.abs(Math.round(v)));
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
    else if (typeof v === "string") {
      // Numbers embedded in evidence strings are also legitimate citations.
      for (const m of v.matchAll(/\d+(?:\.\d+)?/g)) allowed.add(Math.abs(parseFloat(m[0])));
    }
  };
  walk(bundle);
  // Small counting numbers (e.g. "two of the three competitors") and 0 are always fine.
  for (let i = 0; i <= 12; i++) allowed.add(i);
  return allowed;
}

const RECOMMENDATION_PATTERNS = [
  /\byou should\b/i, /\bwe recommend\b/i, /\brecommendation\b/i, /\bconsider (?:adopting|shifting|using|adding)\b/i,
  /\bought to\b/i, /\bmust (?:adopt|shift|invest|respond)\b/i, /\bopportunity to\b/i, /\bcapitalize on\b/i,
  /\bto stay competitive\b/i, /\byour (?:brand|business|campaign) should\b/i,
];

export function runDeterministicGuards(
  bundle: VerifiedSignalBundle,
  interp: AiInterpretation,
): { ok: boolean; violations: string[] } {
  const violations: string[] = [];
  const text = [
    interp.headline,
    interp.narrative,
    ...interp.signalGroups.map((g) => `${g.title} ${g.observation} ${g.signals.join(" ")}`),
    ...interp.strongestObservations,
    ...interp.uncertainObservations,
  ].join("\n");

  // 1. Every cited number must exist in the verified bundle.
  const allowed = collectAllowedNumbers(bundle);
  for (const m of text.matchAll(/\d+(?:\.\d+)?/g)) {
    const n = Math.abs(parseFloat(m[0]));
    if (!allowed.has(n) && !allowed.has(Math.round(n))) {
      violations.push(`fabricated statistic: "${m[0]}" does not appear in verified signals`);
    }
  }

  // 2. No strategic recommendations.
  for (const pat of RECOMMENDATION_PATTERNS) {
    const m = text.match(pat);
    if (m) violations.push(`strategic recommendation detected: "${m[0]}"`);
  }

  // 3. Thin/limited data must be acknowledged when present.
  const hasInsufficientTrends =
    bundle.dataStatus === "thin" || bundle.dominantPatterns.some((d) => d.trend === "insufficient_history");
  if (hasInsufficientTrends) {
    const acknowledges = /(limited|insufficient|not yet|too (?:little|few)|small sample|early|building|thin|caution|uncertain)/i.test(text);
    if (!acknowledges) violations.push("data limitations (thin data / insufficient_history) not acknowledged");
  }

  return { ok: violations.length === 0, violations };
}

// ── grounding / quality judge (LLM) ──────────────────────────────────────────

const JUDGE_SYSTEM_PROMPT = `You are a strict grounding judge. You receive (a) VERIFIED deterministic market signals and (b) an AI-written interpretation of them.

REJECT the interpretation if ANY of these hold:
1. It cites a statistic, percentage, count, or trend not present in the verified signals.
2. It names a competitor not present in the verified signals.
3. It asserts proven causation about business OUTCOMES (sales, revenue, engagement results, performance) or states definitively that one signal caused another. NOTE: describing signals as connected, reinforcing, related, or part of one market movement is REQUIRED interpretive behavior and is NOT a violation when those signals move in compatible directions within the same window; hedged language ("suggesting", "appears", "consistent with", "might explain") is always acceptable.
4. It contradicts the deterministic data (wrong direction, changed scope or severity, upgraded/downgraded market scope).
5. It gives strategic advice or recommendations (what the business should do).
6. It ignores stated data limitations (thin data, insufficient history, low confidence) while making confident trend claims.
7. It is generic template filler that a human would not find materially more useful than the raw numbers.

Otherwise PASS. Judge substance, not style.

Respond ONLY with JSON: { "verdict": "PASS" | "REJECT", "violations": ["specific reason for each violation, empty if PASS"] }`;

export async function judgeInterpretation(
  bundle: VerifiedSignalBundle,
  interp: AiInterpretation,
  accountId: string,
): Promise<JudgeResult> {
  const response = await aiChat({
    model: JUDGE_MODEL,
    max_tokens: 400,
    temperature: 0,
    accountId,
    endpoint: "watchtower-insight-judge",
    messages: [
      { role: "system", content: JUDGE_SYSTEM_PROMPT },
      {
        role: "user",
        content: `VERIFIED SIGNALS:\n${JSON.stringify(bundle, null, 2)}\n\nAI INTERPRETATION:\n${JSON.stringify(interp, null, 2)}`,
      },
    ],
  });
  const raw = response.choices?.[0]?.message?.content ?? "";
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Judge returned no JSON object");
  const parsed = JSON.parse(match[0]) as Partial<JudgeResult>;
  if (parsed.verdict !== "PASS" && parsed.verdict !== "REJECT") {
    throw new Error(`Judge returned invalid verdict: ${String(parsed.verdict)}`);
  }
  return {
    verdict: parsed.verdict,
    violations: Array.isArray(parsed.violations) ? parsed.violations.filter((v): v is string => typeof v === "string") : [],
  };
}

// ── orchestration + payload-fingerprint cache ────────────────────────────────

const insightCache = new Map<string, { at: number; fingerprint: string; insight: MarketInsight }>();

function fingerprintBundle(bundle: VerifiedSignalBundle): string {
  // currentWindow/previousWindow/generatedAt move with the clock on every call;
  // fingerprint only the signal CONTENT so unchanged signals reuse the insight.
  const { currentWindow: _c, previousWindow: _p, ...content } = bundle;
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

/**
 * Full pipeline: verified signals → trigger gate → analyst → guards → judge →
 * customer insight (or deterministic summary). Never throws on LLM/judge
 * problems — those degrade to the deterministic summary with an internal
 * reason. DB failures DO propagate (no-silent-fallback for infrastructure).
 */
export async function getMarketInsight(
  campaignId: string,
  accountId: string,
  windowDays: WindowDays = 30,
  opts: { skipCache?: boolean } = {},
): Promise<MarketInsight> {
  const { bundle } = await buildVerifiedSignalBundle(campaignId, windowDays);
  const fingerprint = fingerprintBundle(bundle);
  const cacheKey = `${campaignId}:${windowDays}`;

  if (!opts.skipCache) {
    const hit = insightCache.get(cacheKey);
    if (hit && hit.fingerprint === fingerprint && Date.now() - hit.at < INSIGHT_CACHE_TTL_MS) {
      return hit.insight;
    }
  }

  let insight: MarketInsight;
  // P-5: rejected AI output is persisted to reasoning_runs (accuracy
  // learning), NEVER served. Captured here, written after serving decision.
  let rejectedInterp: unknown = null;
  let rejectionReasons: string[] | null = null;

  if (!shouldInvokeAnalyst(bundle)) {
    insight = { ...buildDeterministicSummary(bundle), deterministicReason: "no_trigger" };
  } else {
    try {
      const interp = await runMarketAnalyst(bundle, accountId);
      const guards = runDeterministicGuards(bundle, interp);
      if (!guards.ok) {
        console.warn(`${LOG} GUARDS_REJECTED campaign=${campaignId} violations=${JSON.stringify(guards.violations)}`);
        rejectedInterp = interp;
        rejectionReasons = guards.violations;
        insight = { ...buildDeterministicSummary(bundle), deterministicReason: "guards_rejected" };
      } else {
        const judge = await judgeInterpretation(bundle, interp, accountId);
        if (judge.verdict !== "PASS") {
          console.warn(`${LOG} JUDGE_REJECTED campaign=${campaignId} violations=${JSON.stringify(judge.violations)}`);
          rejectedInterp = interp;
          rejectionReasons = judge.violations;
          insight = { ...buildDeterministicSummary(bundle), deterministicReason: "judge_rejected" };
        } else {
          insight = {
            source: "ai",
            headline: interp.headline,
            narrative: interp.narrative,
            signalGroups: interp.signalGroups,
            strongestObservations: interp.strongestObservations,
            uncertainObservations: interp.uncertainObservations,
            generatedAt: new Date().toISOString(),
            windowDays: bundle.windowDays,
            basedOn: {
              confirmedShifts: bundle.confirmedShifts.length,
              posts: bundle.totalPosts,
              competitors: bundle.totalCompetitors,
            },
          };
        }
      }
    } catch (err) {
      console.error(`${LOG} LLM_FAILED campaign=${campaignId} detail=${(err as Error).message}`);
      rejectionReasons = [(err as Error).message];
      insight = { ...buildDeterministicSummary(bundle), deterministicReason: "llm_failed" };
    }
  }

  // P-4 Market Memory: persist every fresh validated insight (deduped by the
  // same content fingerprint). Persistence failure must never block serving
  // the customer insight, but must be loudly visible to operators.
  try {
    await recordMarketInsight({ campaignId, accountId, fingerprint, insight, bundle });
  } catch (err) {
    console.error(`${LOG} MEMORY_WRITE_FAILED campaign=${campaignId} detail=${(err as Error).message}`);
  }

  // P-5 M1: persist this fresh run's outcome (accepted OR rejected) to
  // reasoning_runs so interpretation accuracy is measurable over time.
  // recordReasoningRun never throws. The analyst's grounding contract is the
  // verified signal bundle (not the evidence registry), so evidenceUids is
  // legitimately empty here.
  await recordReasoningRun({
    accountId,
    campaignId,
    layer: "market_analyst",
    status:
      insight.source === "ai"
        ? "accepted_ai"
        : ((insight.deterministicReason ?? "no_trigger") as
            | "no_trigger"
            | "guards_rejected"
            | "judge_rejected"
            | "llm_failed"),
    contextFingerprint: fingerprint,
    model: ANALYST_MODEL,
    output: {
      source: insight.source,
      windowDays: insight.windowDays,
      headline: insight.headline,
      deterministicReason: insight.deterministicReason ?? null,
    },
    rejectedOutput: rejectedInterp,
    rejectionReasons,
    evidenceUids: [],
  });

  // Bounded fingerprint cache.
  const nowMs = Date.now();
  for (const [k, v] of insightCache) {
    if (nowMs - v.at >= INSIGHT_CACHE_TTL_MS) insightCache.delete(k);
  }
  insightCache.delete(cacheKey);
  insightCache.set(cacheKey, { at: nowMs, fingerprint, insight });
  while (insightCache.size > INSIGHT_CACHE_MAX) {
    const oldest = insightCache.keys().next().value;
    if (oldest === undefined) break;
    insightCache.delete(oldest);
  }

  console.log(
    `${LOG} INSIGHT campaign=${campaignId} window=${windowDays}d source=${insight.source}${insight.deterministicReason ? ` reason=${insight.deterministicReason}` : ""} shifts=${bundle.confirmedShifts.length} emerging=${bundle.emergingPatterns.length} declining=${bundle.decliningPatterns.length}`,
  );
  return insight;
}

/**
 * Customer-safe projection — the ONLY shape the route may serialize.
 * Structurally strips internal telemetry (deterministicReason) so it can
 * never leak even if MarketInsight grows more internal fields.
 */
export function toCustomerInsightPayload(insight: MarketInsight): {
  source: "ai" | "deterministic";
  headline: string;
  narrative: string;
  signalGroups: Array<{ title: string; signals: string[]; observation: string }>;
  strongestObservations: string[];
  uncertainObservations: string[];
  generatedAt: string;
  windowDays: number;
  basedOn: { confirmedShifts: number; posts: number; competitors: number };
} {
  return {
    source: insight.source,
    headline: insight.headline,
    narrative: insight.narrative,
    signalGroups: insight.signalGroups,
    strongestObservations: insight.strongestObservations,
    uncertainObservations: insight.uncertainObservations,
    generatedAt: insight.generatedAt,
    windowDays: insight.windowDays,
    basedOn: insight.basedOn,
  };
}

/** Test seam for validation harnesses. */
export function _clearInsightCache(): void {
  insightCache.clear();
}
