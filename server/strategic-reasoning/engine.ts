/**
 * Strategic Reasoning Engine (P-4)
 *
 * Sits ABOVE the Watchtower. The Watchtower's responsibility ends at grounded
 * Market Insights; this layer connects multiple verified intelligence sources
 * into one coherent business interpretation, expressed as evidence-cited
 * Reasoning Cards.
 *
 *   Watchtower Market Insights (market_memory — validated, deduped)
 *   Performance Loop outcomes  (performance_cycle_reports / decision_verdicts)
 *   Historical Performance Memory (strategy_memory)
 *   Historical Market Memory   (market_memory, 12-month horizon)
 *   Company profile            (business_data_layer)
 *   Business objectives        (goal_decompositions, active)
 *   Competitor context         (ci_competitors)
 *        ↓
 *   Deterministic historical analysis (recurrence, resemblance, momentum)
 *        ↓
 *   LLM reasoning (interpretation ONLY) → code guards → LLM judge
 *        ↓
 *   Reasoning Cards — every card cites evidence refs; rejected output is
 *   replaced by deterministic cards and never exposed.
 *
 * Doctrine (same as the P-3 grounded-interpretation layer):
 *   - No raw posts, no raw classifications — only verified upstream outputs.
 *   - The LLM never calculates or discovers; all numbers and historical
 *     comparisons are computed deterministically first.
 *   - Every card must cite evidence refs that exist in the evidence registry
 *     (checked in code, not by the LLM).
 *   - Observations and context only. NO strategic recommendations.
 */

import { createHash } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import {
  performanceCycleReports,
  performanceDecisionVerdicts,
  strategyMemory,
  businessDataLayer,
  goalDecompositions,
  ciCompetitors,
  businessDataRevisions,
  ciCompetitorRevisions,
  type MarketMemoryRow,
} from "../../shared/schema";
import { aiChat } from "../ai-client";
import { getMarketInsight } from "../watchtower/ai-market-analyst";
import { getMarketMemoryRows, type StoredTheme } from "./market-memory";
import {
  registerEvidence,
  recordReasoningRun,
  derivedSourceId,
  versionedSourceId,
  type RegistryEntry,
  type EvidenceKind,
} from "./evidence-registry";

const LOG = "[StrategicReasoning]";
const REASONER_MODEL = "gpt-4.1-mini";
const JUDGE_MODEL = "gpt-4.1-mini";
const CARDS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CARDS_CACHE_MAX = 100;

// ── card & evidence model ─────────────────────────────────────────────────────

export const CARD_TYPES = [
  "market_direction",
  "market_momentum",
  "recurring_pattern",
  "strategic_context",
  "competitive_pressure",
  "evidence_summary",
  "confidence",
  "uncertainty",
] as const;
export type CardType = (typeof CARD_TYPES)[number];

/** One entry in the evidence registry. `ref` is the ONLY id the LLM sees/cites. */
export interface EvidenceItem {
  ref: string;                       // "MM-1", "PR-1", "PDV-2", "SM-1", "BIZ-1", "GOAL-1", "COMP-3", "HIST-1"
  type:
    | "market_insight"
    | "performance_report"
    | "performance_verdict"
    | "performance_memory"
    | "business_context"
    | "objective"
    | "competitor"
    | "historical_analysis";
  dbId: string | null;               // underlying row id (internal only — never serialized to customers)
  label: string;                     // short customer-safe description
  detail: string;                    // verified facts the LLM may interpret
  /** Coverage time for registry registration (P-5); defaults to now at persist. */
  observedAt?: Date;
}

export interface ReasoningCard {
  cardType: CardType;
  title: string;
  body: string;
  evidenceRefs: string[];
  confidence: "high" | "medium" | "low";
}

export interface ReasoningResult {
  state: "ready" | "no_history";
  source: "ai" | "deterministic";
  cards: ReasoningCard[];
  evidence: Array<{ ref: string; type: EvidenceItem["type"]; label: string }>;
  generatedAt: string;
  /** Internal telemetry — never serialized to customers. */
  deterministicReason?: "no_trigger" | "guards_rejected" | "judge_rejected" | "llm_failed";
}

// ── context assembly (deterministic) ─────────────────────────────────────────

interface MarketHistoryFindings {
  recurring: Array<{ dimension: string; value: string; occurrences: number; firstSeen: string; lastSeen: string; memoryRefs: string[] }>;
  resemblance: { matchRef: string; matchDate: string; overlapPct: number; sharedThemes: string[] } | null;
  momentum: Array<{ dimension: string; value: string; direction: "building" | "fading"; consecutiveWindows: number; shares: number[] }>;
}

/**
 * Market-history findings plus belief-history findings (P-5 M3): deterministic
 * pattern retrieval over the append-only revision stores (business profile
 * changes, competitor profile changes). Cited via HIST-B* / HIST-C* evidence.
 */
interface HistoricalFindings extends MarketHistoryFindings {
  businessChanges: Array<{ when: string; fields: string[] }>;
  competitorChanges: Array<{ when: string; competitor: string; changes: string[] }>;
}

export interface ReasoningContext {
  campaignId: string;
  currentInsight: MarketMemoryRow | null;
  historyCount: number;
  evidence: EvidenceItem[];
  findings: HistoricalFindings;
}

const parseThemes = (json: string): StoredTheme[] => {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};
const themeKey = (t: StoredTheme) => `${t.dimension}::${t.value}`;
const monthLabel = (d: Date) => d.toLocaleDateString("en-US", { month: "long", year: "numeric" });

function analyzeHistory(current: MarketMemoryRow, history: MarketMemoryRow[], refFor: (row: MarketMemoryRow) => string): MarketHistoryFindings {
  const currentEmerging = parseThemes(current.emergingThemes);
  // All temporal comparisons use windowTo (what the data actually covers),
  // never createdAt (when the row happened to be written — backfills would
  // corrupt spacing). Recurrence/resemblance/momentum only compare rows of
  // the SAME window granularity: a 30d emerging theme and a 90d emerging
  // theme are not the same observation and must not be double-counted.
  const sameWindowHistory = history.filter((r) => r.windowDays === current.windowDays);

  // Recurrence: a theme that emerged in ≥2 same-window memory rows spaced ≥14 days apart.
  const occurrences = new Map<string, { theme: StoredTheme; rows: MarketMemoryRow[] }>();
  for (const row of [current, ...sameWindowHistory]) {
    for (const t of parseThemes(row.emergingThemes)) {
      const k = themeKey(t);
      const entry = occurrences.get(k) ?? { theme: t, rows: [] };
      entry.rows.push(row);
      occurrences.set(k, entry);
    }
  }
  const recurring = [...occurrences.values()]
    .filter((e) => {
      if (e.rows.length < 2) return false;
      const times = e.rows.map((r) => r.windowTo.getTime()).sort((a, b) => a - b);
      return times[times.length - 1] - times[0] >= 14 * 86400000;
    })
    .map((e) => {
      const sorted = [...e.rows].sort((a, b) => a.windowTo.getTime() - b.windowTo.getTime());
      return {
        dimension: e.theme.dimension,
        value: e.theme.value,
        occurrences: e.rows.length,
        firstSeen: monthLabel(sorted[0].windowTo),
        lastSeen: monthLabel(sorted[sorted.length - 1].windowTo),
        memoryRefs: sorted.map(refFor),
      };
    })
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, 5);

  // Resemblance: strongest emerging-theme overlap with a past (≥21 days old,
  // same-window) state.
  let resemblance: HistoricalFindings["resemblance"] = null;
  if (currentEmerging.length > 0) {
    const currentKeys = new Set(currentEmerging.map(themeKey));
    for (const row of sameWindowHistory) {
      if (current.windowTo.getTime() - row.windowTo.getTime() < 21 * 86400000) continue;
      const shared = parseThemes(row.emergingThemes).filter((t) => currentKeys.has(themeKey(t)));
      const overlapPct = Math.round((shared.length / currentKeys.size) * 100);
      if (shared.length >= 1 && overlapPct >= 40 && (!resemblance || overlapPct > resemblance.overlapPct)) {
        resemblance = {
          matchRef: refFor(row),
          matchDate: monthLabel(row.windowTo),
          overlapPct,
          sharedThemes: shared.map((t) => `${t.dimension}: ${t.value}`),
        };
      }
    }
  }

  // Momentum: dominant-theme share trajectory across consecutive same-window rows.
  const momentum: HistoricalFindings["momentum"] = [];
  const sameWindow = [current, ...sameWindowHistory]
    .sort((a, b) => b.windowTo.getTime() - a.windowTo.getTime())
    .slice(0, 4); // newest → oldest
  for (const t of parseThemes(current.dominantThemes).slice(0, 6)) {
    const shares: number[] = [];
    for (const row of sameWindow) {
      const match = parseThemes(row.dominantThemes).find((d) => themeKey(d) === themeKey(t));
      if (!match) break;
      shares.push(match.share);
    }
    if (shares.length >= 2) {
      const newestFirst = shares; // index 0 = current
      const strictlyBuilding = newestFirst.every((s, i) => i === newestFirst.length - 1 || s > newestFirst[i + 1]);
      const strictlyFading = newestFirst.every((s, i) => i === newestFirst.length - 1 || s < newestFirst[i + 1]);
      if (strictlyBuilding || strictlyFading) {
        momentum.push({
          dimension: t.dimension,
          value: t.value,
          direction: strictlyBuilding ? "building" : "fading",
          consecutiveWindows: shares.length,
          shares: newestFirst,
        });
      }
    }
  }

  return { recurring, resemblance, momentum: momentum.slice(0, 4) };
}

export async function buildReasoningContext(campaignId: string, accountId: string): Promise<ReasoningContext> {
  // Ensure a fresh validated insight exists and is recorded in memory first.
  // If the 30-day view has no storable insight (insufficient data), fall back
  // to the 90-day view so reasoning can still run on a wider verified window.
  await getMarketInsight(campaignId, accountId, 30);
  let memoryRows = await getMarketMemoryRows(campaignId, accountId, { monthsBack: 12, limit: 40 });
  if (memoryRows.length === 0) {
    await getMarketInsight(campaignId, accountId, 90);
    memoryRows = await getMarketMemoryRows(campaignId, accountId, { monthsBack: 12, limit: 40 });
  }
  // Every read is scoped by accountId AND campaignId (tenant isolation).
  const [reports, verdicts, perfMemory, bizRows, goals, competitors, bizRevs, compRevs] = await Promise.all([
    db.select().from(performanceCycleReports)
      .where(and(eq(performanceCycleReports.accountId, accountId), eq(performanceCycleReports.campaignId, campaignId)))
      .orderBy(desc(performanceCycleReports.createdAt)).limit(3),
    db.select().from(performanceDecisionVerdicts)
      .where(and(eq(performanceDecisionVerdicts.accountId, accountId), eq(performanceDecisionVerdicts.campaignId, campaignId)))
      .orderBy(desc(performanceDecisionVerdicts.createdAt)).limit(10),
    db.select().from(strategyMemory)
      .where(and(eq(strategyMemory.accountId, accountId), eq(strategyMemory.campaignId, campaignId)))
      .orderBy(desc(strategyMemory.score)).limit(10),
    db.select().from(businessDataLayer)
      .where(and(eq(businessDataLayer.accountId, accountId), eq(businessDataLayer.campaignId, campaignId))).limit(1),
    db.select().from(goalDecompositions)
      .where(and(eq(goalDecompositions.accountId, accountId), eq(goalDecompositions.campaignId, campaignId), eq(goalDecompositions.status, "active")))
      .orderBy(desc(goalDecompositions.createdAt)).limit(1),
    db.select({
      id: ciCompetitors.id,
      name: ciCompetitors.name,
      businessType: ciCompetitors.businessType,
      primaryObjective: ciCompetitors.primaryObjective,
      messagingTone: ciCompetitors.messagingTone,
    }).from(ciCompetitors)
      .where(and(eq(ciCompetitors.accountId, accountId), eq(ciCompetitors.campaignId, campaignId))).limit(15),
    // P-5 M3: append-only belief histories (business + competitor revisions).
    db.select().from(businessDataRevisions)
      .where(and(eq(businessDataRevisions.accountId, accountId), eq(businessDataRevisions.campaignId, campaignId)))
      .orderBy(desc(businessDataRevisions.createdAt)).limit(3),
    db.select().from(ciCompetitorRevisions)
      .where(and(eq(ciCompetitorRevisions.accountId, accountId), eq(ciCompetitorRevisions.campaignId, campaignId)))
      .orderBy(desc(ciCompetitorRevisions.createdAt)).limit(20),
  ]);

  const evidence: EvidenceItem[] = [];
  const memoryRefById = new Map<string, string>();

  memoryRows.forEach((row, i) => {
    const ref = `MM-${i + 1}`;
    memoryRefById.set(row.id, ref);
    const emerging = parseThemes(row.emergingThemes).map((t) => `${t.dimension}: ${t.value} at ${t.share}% (${t.deltaPp !== null ? `${t.deltaPp > 0 ? "+" : ""}${t.deltaPp}pp` : "no trend"})`);
    const declining = parseThemes(row.decliningThemes).map((t) => `${t.dimension}: ${t.value} down to ${t.share}% (${t.deltaPp}pp)`);
    const dominant = parseThemes(row.dominantThemes).slice(0, 5).map((t) => `${t.dimension}: ${t.value} at ${t.share}% [${t.confidence ?? "n/a"}]`);
    evidence.push({
      ref,
      type: "market_insight",
      dbId: row.id,
      observedAt: row.windowTo, // coverage time — matches reader ordering (P-5)
      label: `Market insight · ${monthLabel(row.windowTo)} (${row.windowDays}-day view)`,
      detail: `[${row.windowTo.toISOString().slice(0, 10)}, window=${row.windowDays}d, confidence=${row.confidence}, dataStatus=${row.dataStatus}, basedOn=${row.basedOn}] ${row.headline}. ${row.narrative} | Dominant: ${dominant.join("; ") || "none"} | Emerging: ${emerging.join("; ") || "none"} | Declining: ${declining.join("; ") || "none"}`,
    });
  });

  reports.forEach((r, i) => {
    evidence.push({
      ref: `PR-${i + 1}`,
      type: "performance_report",
      dbId: r.id,
      label: `Performance cycle report · ${monthLabel(r.createdAt)}`,
      detail: `[${r.createdAt.toISOString().slice(0, 10)}, platform=${r.platform}, status=${r.status}] businessVerdict=${r.businessVerdict ?? "n/a"}, sales ${r.salesBefore ?? "n/a"} → ${r.salesAfter ?? "n/a"}, decisions=${r.decisionsTotal}, attributionConfidence=${r.attributionConfidence ?? "n/a"}`,
    });
  });

  verdicts.forEach((v, i) => {
    evidence.push({
      ref: `PDV-${i + 1}`,
      type: "performance_verdict",
      dbId: v.id,
      label: `Performance verdict · ${v.decisionDimension}`,
      detail: `[${v.createdAt.toISOString().slice(0, 10)}] ${v.decisionDimension}="${v.decisionValue}" → ${v.verdict} (${v.evidenceStrength}${v.confidence != null ? `, confidence=${v.confidence}` : ""}); executed=${v.executed}; reason: ${v.verdictReason}`,
    });
  });

  perfMemory.forEach((m, i) => {
    evidence.push({
      ref: `SM-${i + 1}`,
      type: "performance_memory",
      dbId: m.id,
      label: `Performance memory · ${m.label}`,
      detail: `type=${m.memoryType}, label="${m.label}", direction=${m.direction ?? "n/a"}, score=${m.score ?? 0}, confidence=${m.confidenceScore ?? "n/a"}, winner=${m.isWinner ?? false}, validations=${m.validationCount ?? 0}`,
    });
  });

  if (bizRows.length > 0) {
    const b = bizRows[0];
    evidence.push({
      ref: "BIZ-1",
      type: "business_context",
      dbId: b.id,
      label: "Company profile",
      detail: `businessType=${b.businessType ?? "n/a"}, coreOffer=${b.coreOffer ?? "n/a"}, audience=${b.targetAudienceSegment ?? "n/a"} (age ${b.targetAudienceAge ?? "n/a"}), category=${b.productCategory ?? "n/a"}, problemSolved=${b.coreProblemSolved ?? "n/a"}, uniqueMechanism=${b.uniqueMechanism ?? "n/a"}, advantage=${b.strategicAdvantage ?? "n/a"}, funnelObjective=${b.funnelObjective ?? "n/a"}`,
    });
  }

  if (goals.length > 0) {
    const g = goals[0];
    evidence.push({
      ref: "GOAL-1",
      type: "objective",
      dbId: g.id,
      label: `Business objective · ${g.goalType}`,
      detail: `goal=${g.goalType}${g.goalTarget != null ? ` target=${g.goalTarget}` : ""}${g.goalLabel ? ` (“${g.goalLabel}”)` : ""}, horizon=${g.timeHorizonDays}d, feasibility=${g.feasibility}${g.feasibilityScore != null ? ` (${g.feasibilityScore})` : ""}`,
    });
  }

  competitors.forEach((c, i) => {
    evidence.push({
      ref: `COMP-${i + 1}`,
      type: "competitor",
      dbId: c.id,
      label: `Competitor · ${c.name}`,
      detail: `${c.name}: type=${c.businessType}, objective=${c.primaryObjective}, tone=${c.messagingTone ?? "n/a"}`,
    });
  });

  const currentInsight = memoryRows[0] ?? null;
  const refFor = (row: MarketMemoryRow) => memoryRefById.get(row.id) ?? "MM-?";
  const marketFindings: MarketHistoryFindings = currentInsight
    ? analyzeHistory(currentInsight, memoryRows.slice(1), refFor)
    : { recurring: [], resemblance: null, momentum: [] };

  // P-5 M3: deterministic pattern retrieval over the append-only belief
  // histories. All values are verbatim from revision rows — no computation
  // beyond formatting, so everything stays guard-compatible evidence.
  const parseJsonArray = (s: string): string[] => {
    try { const v = JSON.parse(s); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
  };
  const parseJsonObject = (s: string): Record<string, unknown> => {
    try { const v = JSON.parse(s); return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}; } catch { return {}; }
  };
  const fmtVal = (v: unknown): string => {
    const s = v == null ? "not set" : typeof v === "string" ? v : JSON.stringify(v);
    return s.length > 80 ? `${s.slice(0, 77)}…` : s;
  };

  const bizRevsTop = bizRevs.slice(0, 3);
  const businessChanges = bizRevsTop.map((r) => ({
    when: monthLabel(r.createdAt),
    fields: parseJsonArray(r.changedFields),
  }));

  const latestCompRev = new Map<string, (typeof compRevs)[number]>();
  for (const r of compRevs) {
    if (!latestCompRev.has(r.competitorId)) latestCompRev.set(r.competitorId, r); // desc order → first is latest
  }
  const compNameById = new Map(competitors.map((c) => [c.id, c.name]));
  const compRevsTop = [...latestCompRev.values()].slice(0, 5);
  const competitorChanges = compRevsTop.map((r) => {
    const fields = parseJsonArray(r.changedFields);
    const prev = parseJsonObject(r.previousValues);
    const curr = parseJsonObject(r.currentValues);
    return {
      when: monthLabel(r.createdAt),
      competitor: compNameById.get(r.competitorId) ?? "a tracked competitor",
      changes: fields.map((f) => `${f}: "${fmtVal(prev[f])}" → "${fmtVal(curr[f])}"`),
    };
  });

  const findings: HistoricalFindings = { ...marketFindings, businessChanges, competitorChanges };

  // Historical-analysis findings are themselves evidence (deterministically computed).
  findings.recurring.forEach((r, i) => {
    evidence.push({
      ref: `HIST-R${i + 1}`,
      type: "historical_analysis",
      dbId: null,
      label: `Recurring pattern · ${r.value}`,
      detail: `"${r.dimension}: ${r.value}" emerged ${r.occurrences} times between ${r.firstSeen} and ${r.lastSeen} (memory: ${r.memoryRefs.join(", ")})`,
    });
  });
  if (findings.resemblance) {
    evidence.push({
      ref: "HIST-S1",
      type: "historical_analysis",
      dbId: null,
      label: `Resemblance to ${findings.resemblance.matchDate}`,
      detail: `Current emerging themes overlap ${findings.resemblance.overlapPct}% with the state recorded in ${findings.resemblance.matchDate} (${findings.resemblance.matchRef}): shared ${findings.resemblance.sharedThemes.join("; ")}`,
    });
  }
  findings.momentum.forEach((m, i) => {
    evidence.push({
      ref: `HIST-M${i + 1}`,
      type: "historical_analysis",
      dbId: null,
      label: `Momentum · ${m.value} ${m.direction}`,
      detail: `"${m.dimension}: ${m.value}" has been ${m.direction} across ${m.consecutiveWindows} consecutive ${currentInsight?.windowDays ?? 30}-day views (shares newest→oldest: ${m.shares.join("%, ")}%)`,
    });
  });
  // Absence is a finding too: register it as citable evidence so cards that
  // truthfully report "no recurrence / no momentum yet" have a deterministic
  // citation instead of being tempted to cite the findings block itself.
  if (
    currentInsight &&
    findings.recurring.length === 0 &&
    !findings.resemblance &&
    findings.momentum.length === 0
  ) {
    evidence.push({
      ref: "HIST-0",
      type: "historical_analysis",
      dbId: null,
      label: "Historical comparison — no patterns yet",
      detail: `${memoryRows.length} stored market snapshot(s) analyzed: no recurring themes, no resemblance to past states, and no sustained momentum detected yet. Historical reasoning strengthens as memory accumulates.`,
    });
  }

  // P-5 M3: belief-history findings are citable evidence like any other
  // finding — they point at their real revision rows.
  businessChanges.forEach((c, i) => {
    evidence.push({
      ref: `HIST-B${i + 1}`,
      type: "historical_analysis",
      dbId: bizRevsTop[i].id,
      observedAt: bizRevsTop[i].createdAt,
      label: `Business profile change · ${c.when}`,
      detail: `Company profile updated in ${c.when}; fields changed: ${c.fields.join(", ") || "unrecorded"}.`,
    });
  });
  competitorChanges.forEach((c, i) => {
    evidence.push({
      ref: `HIST-C${i + 1}`,
      type: "historical_analysis",
      dbId: compRevsTop[i].id,
      observedAt: compRevsTop[i].createdAt,
      label: `Competitor profile change · ${c.competitor}`,
      detail: `${c.competitor} profile changed in ${c.when}: ${c.changes.join("; ") || "fields updated"}.`,
    });
  });

  return { campaignId, currentInsight, historyCount: memoryRows.length, evidence, findings };
}

// ── deterministic fallback cards ─────────────────────────────────────────────

export function buildDeterministicCards(ctx: ReasoningContext): ReasoningCard[] {
  const cards: ReasoningCard[] = [];
  const cur = ctx.currentInsight;
  if (!cur) return cards;
  const curRef = "MM-1";
  const emerging = parseThemes(cur.emergingThemes);
  const declining = parseThemes(cur.decliningThemes);
  const conf = (cur.confidence as ReasoningCard["confidence"]) ?? "low";

  cards.push({
    cardType: "market_direction",
    title: cur.headline,
    body: cur.narrative,
    evidenceRefs: [curRef],
    confidence: conf,
  });

  const momentumBody = ctx.findings.momentum.length > 0
    ? ctx.findings.momentum.map((m) => `"${m.value}" (${m.dimension.toLowerCase()}) is ${m.direction} across ${m.consecutiveWindows} consecutive periods (${m.shares.join("% → ")}%).`).join(" ")
    : emerging.length > 0
      ? emerging.slice(0, 3).map((t) => `${t.dimension}: "${t.value}" moved to ${t.share}%${t.deltaPp !== null ? ` (${t.deltaPp > 0 ? "+" : ""}${t.deltaPp}pp)` : ""}.`).join(" ")
      : "No sustained momentum measurable yet — more history is needed.";
  cards.push({
    cardType: "market_momentum",
    title: ctx.findings.momentum.length > 0 ? "Sustained movement detected" : "Momentum still forming",
    body: momentumBody,
    evidenceRefs: [curRef, ...ctx.findings.momentum.map((_, i) => `HIST-M${i + 1}`)],
    confidence: ctx.findings.momentum.length > 0 ? conf : "low",
  });

  cards.push({
    cardType: "recurring_pattern",
    title: ctx.findings.recurring.length > 0 ? "This has happened before" : "No recurring behavior yet",
    body: ctx.findings.recurring.length > 0
      ? ctx.findings.recurring.map((r) => `"${r.value}" (${r.dimension.toLowerCase()}) emerged ${r.occurrences} times between ${r.firstSeen} and ${r.lastSeen}.`).join(" ")
      : `Across ${ctx.historyCount} stored market snapshots, no theme has recurred yet — recurrence detection strengthens as history accumulates.`,
    evidenceRefs: ctx.findings.recurring.length > 0 ? ctx.findings.recurring.map((_, i) => `HIST-R${i + 1}`) : [curRef],
    confidence: ctx.findings.recurring.length > 0 ? "medium" : "low",
  });

  const biz = ctx.evidence.find((e) => e.ref === "BIZ-1");
  const goal = ctx.evidence.find((e) => e.ref === "GOAL-1");
  cards.push({
    cardType: "strategic_context",
    title: "How this relates to your business",
    body: [
      biz ? `Your profile: ${biz.detail.split(", ").slice(0, 3).join(", ")}.` : "No company profile stored yet.",
      goal ? `Active objective: ${goal.detail}.` : "",
      `The current market movement (${cur.headline.toLowerCase()}) is observed in your competitive set${emerging.length > 0 ? `, most visibly in ${emerging[0].dimension.toLowerCase()}` : ""}.`,
    ].filter(Boolean).join(" "),
    evidenceRefs: [curRef, ...(biz ? ["BIZ-1"] : []), ...(goal ? ["GOAL-1"] : [])],
    confidence: biz ? conf : "low",
  });

  const shifts = (() => { try { const v = JSON.parse(cur.confirmedShifts); return Array.isArray(v) ? v : []; } catch { return []; } })();
  const compRefs = ctx.evidence.filter((e) => e.type === "competitor").slice(0, 3).map((e) => e.ref);
  cards.push({
    cardType: "competitive_pressure",
    title: shifts.length > 0 ? "Confirmed competitor shifts this period" : "No confirmed competitor shifts this period",
    body: shifts.length > 0
      ? shifts.slice(0, 3).map((s: any) => `${s.label} (${String(s.severity).toLowerCase()}, ${String(s.scope).toLowerCase()}${s.competitor ? `, ${s.competitor}` : ""}).`).join(" ")
      : `No two-fetch-confirmed competitor shifts in this window; pressure is currently expressed through gradual pattern movement${declining.length > 0 ? ` and the decline of ${declining[0].value.toLowerCase()} messaging` : ""}.`,
    evidenceRefs: [curRef, ...compRefs],
    confidence: shifts.length > 0 ? "high" : conf,
  });

  const counts = new Map<string, number>();
  for (const e of ctx.evidence) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  cards.push({
    cardType: "evidence_summary",
    title: "What this reasoning is built on",
    body: [...counts.entries()].map(([t, n]) => `${n} ${t.replace(/_/g, " ")}${n > 1 ? "s" : ""}`).join(", ") + ".",
    evidenceRefs: ctx.evidence.slice(0, 8).map((e) => e.ref),
    confidence: "high",
  });

  cards.push({
    cardType: "confidence",
    title: `Overall confidence: ${conf}`,
    body: `Current market view is based on ${JSON.parse(cur.basedOn || "{}").posts ?? "n/a"} classified posts across ${JSON.parse(cur.basedOn || "{}").competitors ?? "n/a"} competitors (data status: ${cur.dataStatus}), with ${ctx.historyCount} historical snapshots available for comparison.`,
    evidenceRefs: [curRef],
    confidence: conf,
  });

  const uncertainties: string[] = [];
  if (cur.dataStatus === "thin") uncertainties.push("the current window has thin classified-post coverage");
  if (ctx.historyCount < 3) uncertainties.push("historical memory is still shallow, so recurrence and momentum reads are early");
  if (ctx.evidence.filter((e) => e.type === "performance_verdict").length === 0) uncertainties.push("no performance verdicts yet connect market movement to your own results");
  cards.push({
    cardType: "uncertainty",
    title: "What remains uncertain",
    body: uncertainties.length > 0 ? uncertainties.join("; ") + "." : "No major structural uncertainty beyond normal sampling limits.",
    evidenceRefs: [curRef],
    confidence: "high",
  });

  return cards;
}

// ── LLM reasoning (interpretation only) ──────────────────────────────────────

const REASONER_SYSTEM_PROMPT = `You are a strategic reasoning engine for a business owner. You receive an EVIDENCE REGISTRY of verified intelligence (market insights, performance outcomes, historical analysis, company profile, objectives, competitors) plus deterministic historical findings.

Your job: connect these sources into coherent, evidence-cited REASONING CARDS that answer — why does this matter, why now, who is affected, has this happened before, is it temporary or recurring, is it relevant to THIS company, which signals reinforce each other.

STRICT RULES:
1. Use ONLY facts present in the evidence registry. Never invent numbers, competitors, events, or history.
2. Every card MUST cite the evidence refs (e.g. "MM-1", "HIST-R1", "BIZ-1") it draws from in evidenceRefs. Cite only refs that appear in the evidence registry. The historicalFindings block is context only — cite it through its corresponding HIST-* registry entries; NEVER cite "historicalFindings" or any other non-registry string. If no HIST-* entries exist, ground historical statements in MM-* entries instead. A card reporting ABSENCE (no recurrence found, no confirmed shifts, shallow history) still needs evidence: cite the MM-* entries whose data establishes that absence.
3. Historical comparisons may ONLY use the HIST-* findings and MM-* entries — never remembered or assumed history.
4. All calculations are already done. Never derive new percentages or counts.
5. Observations and context ONLY. NEVER recommend actions or strategy ("should", "recommend", "opportunity to" are forbidden).
6. Causation: hedged framing only ("consistent with", "might explain"); never proven causation about business outcomes.
7. Respect stated confidence and data limitations; say clearly what remains uncertain.
8. Plain business English, specific to this company. No filler.

Produce EXACTLY one card per type: market_direction, market_momentum, recurring_pattern, strategic_context, competitive_pressure, evidence_summary, confidence, uncertainty.

Respond ONLY with JSON:
{ "cards": [ { "cardType": "...", "title": "short specific title", "body": "2-4 sentences", "evidenceRefs": ["MM-1"], "confidence": "high|medium|low" } ] }`;

export async function runReasoner(ctx: ReasoningContext, accountId: string): Promise<ReasoningCard[]> {
  const payload = {
    historicalFindings: ctx.findings,
    evidenceRegistry: ctx.evidence.map(({ ref, type, label, detail }) => ({ ref, type, label, detail })),
  };
  let lastError = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const userContent =
      attempt === 1
        ? `Evidence:\n${JSON.stringify(payload, null, 2)}`
        : `Evidence:\n${JSON.stringify(payload, null, 2)}\n\n[SELF-CORRECTION] Your previous response failed: ${lastError}. Return ONLY complete valid JSON with exactly one card per required type. Keep bodies concise.`;
    const response = await aiChat({
      model: REASONER_MODEL,
      max_tokens: 1800,
      temperature: 0.2,
      timeoutMs: 90_000,
      accountId,
      endpoint: "strategic-reasoning-cards",
      messages: [
        { role: "system", content: REASONER_SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
    });
    const raw = response.choices?.[0]?.message?.content ?? "";
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("no JSON object in response");
      const parsed = JSON.parse(match[0]) as { cards?: unknown };
      if (!Array.isArray(parsed.cards)) throw new Error("missing cards array");
      const cards = parsed.cards.filter(
        (c): c is ReasoningCard =>
          !!c && typeof (c as any).cardType === "string" && CARD_TYPES.includes((c as any).cardType) &&
          typeof (c as any).title === "string" && typeof (c as any).body === "string" &&
          Array.isArray((c as any).evidenceRefs) &&
          ["high", "medium", "low"].includes((c as any).confidence),
      );
      const missing = CARD_TYPES.filter((t) => !cards.some((c) => c.cardType === t));
      if (missing.length > 0) throw new Error(`missing card types: ${missing.join(", ")}`);
      return CARD_TYPES.map((t) => cards.find((c) => c.cardType === t)!);
    } catch (err) {
      lastError = (err as Error).message;
      console.warn(`${LOG} REASONER_PARSE_RETRY attempt=${attempt} detail=${lastError}`);
    }
  }
  throw new Error(`Reasoner failed after 2 attempts: ${lastError}`);
}

// ── deterministic guards ──────────────────────────────────────────────────────

const RECOMMENDATION_PATTERNS = [
  /\byou should\b/i, /\bwe recommend\b/i, /\brecommendation\b/i, /\bconsider (?:adopting|shifting|using|adding|investing)\b/i,
  /\bought to\b/i, /\bmust (?:adopt|shift|invest|respond|act)\b/i, /\bopportunity to\b/i, /\bcapitalize on\b/i,
  /\bto stay competitive\b/i, /\byour (?:brand|business|campaign) should\b/i, /\bit is time to\b/i,
];

function collectAllowedNumbers(ctx: ReasoningContext): Set<number> {
  const allowed = new Set<number>();
  const addFromString = (s: string) => {
    for (const m of s.matchAll(/\d+(?:\.\d+)?/g)) allowed.add(Math.abs(parseFloat(m[0])));
  };
  for (const e of ctx.evidence) { addFromString(e.detail); addFromString(e.label); }
  addFromString(JSON.stringify(ctx.findings));
  // Deterministically derivable counts are legitimate evidence-supported
  // numbers (e.g. "7 competitors tracked"). No blanket small-number exemption:
  // every allowed number must come from evidence content or these counts.
  allowed.add(ctx.historyCount);
  allowed.add(ctx.evidence.length);
  allowed.add(CARD_TYPES.length);
  const perType = new Map<string, number>();
  for (const e of ctx.evidence) perType.set(e.type, (perType.get(e.type) ?? 0) + 1);
  for (const n of perType.values()) allowed.add(n);
  allowed.add(ctx.findings.recurring.length);
  allowed.add(ctx.findings.momentum.length);
  allowed.add(0);
  return allowed;
}

export function runCardGuards(ctx: ReasoningContext, cards: ReasoningCard[]): { ok: boolean; violations: string[] } {
  const violations: string[] = [];
  const validRefs = new Set(ctx.evidence.map((e) => e.ref));
  const allowedNumbers = collectAllowedNumbers(ctx);

  for (const card of cards) {
    // 1. Every cited ref must exist — the core grounding contract.
    for (const ref of card.evidenceRefs) {
      if (!validRefs.has(ref)) violations.push(`${card.cardType}: cites nonexistent evidence "${ref}"`);
    }
    if (card.evidenceRefs.length === 0) violations.push(`${card.cardType}: cites no evidence`);

    const text = `${card.title} ${card.body}`;
    // 2. Numbers must come from the evidence registry (years excluded — month
    //    labels like "March 2026" are legitimate evidence citations).
    for (const m of text.matchAll(/\d+(?:\.\d+)?/g)) {
      const n = Math.abs(parseFloat(m[0]));
      if (n >= 2000 && n <= 2100) continue;
      if (!allowedNumbers.has(n) && !allowedNumbers.has(Math.round(n))) {
        violations.push(`${card.cardType}: fabricated statistic "${m[0]}"`);
      }
    }
    // 3. No strategic recommendations.
    for (const pat of RECOMMENDATION_PATTERNS) {
      const m = text.match(pat);
      if (m) violations.push(`${card.cardType}: strategic recommendation "${m[0]}"`);
    }
  }
  return { ok: violations.length === 0, violations };
}

// ── LLM judge ─────────────────────────────────────────────────────────────────

const JUDGE_SYSTEM_PROMPT = `You are a strict grounding judge. You receive (a) a verified EVIDENCE REGISTRY with deterministic historical findings and (b) AI-written reasoning cards, each citing evidence refs.

REJECT if ANY card:
1. States a fact, statistic, event, or historical comparison not supported by the evidence items it cites (or the registry at all).
2. Names a competitor, theme, or time period absent from the registry.
3. Asserts proven causation about business OUTCOMES (sales, revenue, results) or definitively that one signal caused another. NOTE: describing signals as connected, reinforcing, coexisting, or part of one movement is REQUIRED reasoning and NOT a violation when the cited evidence moves in compatible directions; noting that competitor objectives or postures are consistent with observed messaging trends is descriptive grouping, not causation. Hedged language ("suggesting", "consistent with", "may", "might") is always acceptable. Only flag definitive unhedged claims that something CAUSED a business outcome.
4. Gives strategic advice or recommendations (what the business should do).
5. Overstates confidence — flag only clear overstatement, e.g. certainty language ("definitely", "proves") over evidence marked low-confidence or thin. A card's confidence field reflecting the strength of its cited pattern is the intended design, not a violation.
6. Is generic filler that ignores the company-specific evidence.

Otherwise PASS. Judge substance, not style.

Respond ONLY with JSON: { "verdict": "PASS" | "REJECT", "violations": ["specific reason per violation, empty if PASS"] }`;

export interface CardJudgeResult { verdict: "PASS" | "REJECT"; violations: string[] }

export async function judgeCards(ctx: ReasoningContext, cards: ReasoningCard[], accountId: string): Promise<CardJudgeResult> {
  const response = await aiChat({
    model: JUDGE_MODEL,
    max_tokens: 500,
    temperature: 0,
    timeoutMs: 60_000,
    accountId,
    endpoint: "strategic-reasoning-judge",
    messages: [
      { role: "system", content: JUDGE_SYSTEM_PROMPT },
      {
        role: "user",
        content: `EVIDENCE REGISTRY + FINDINGS:\n${JSON.stringify({ historicalFindings: ctx.findings, evidenceRegistry: ctx.evidence.map(({ ref, type, label, detail }) => ({ ref, type, label, detail })) }, null, 2)}\n\nREASONING CARDS:\n${JSON.stringify(cards, null, 2)}`,
      },
    ],
  });
  const raw = response.choices?.[0]?.message?.content ?? "";
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Judge returned no JSON object");
  const parsed = JSON.parse(match[0]) as Partial<CardJudgeResult>;
  if (parsed.verdict !== "PASS" && parsed.verdict !== "REJECT") {
    throw new Error(`Judge returned invalid verdict: ${String(parsed.verdict)}`);
  }
  return {
    verdict: parsed.verdict,
    violations: Array.isArray(parsed.violations) ? parsed.violations.filter((v): v is string => typeof v === "string") : [],
  };
}

// ── orchestration + cache ─────────────────────────────────────────────────────

const cardsCache = new Map<string, { at: number; fingerprint: string; result: ReasoningResult }>();

function fingerprintContext(ctx: ReasoningContext): string {
  const content = {
    evidence: ctx.evidence.map((e) => `${e.ref}|${e.detail}`),
    findings: ctx.findings,
  };
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

export async function getReasoningCards(
  campaignId: string,
  accountId: string,
  opts: { skipCache?: boolean } = {},
): Promise<ReasoningResult> {
  const ctx = await buildReasoningContext(campaignId, accountId);

  if (!ctx.currentInsight) {
    return {
      state: "no_history",
      source: "deterministic",
      cards: [],
      evidence: [],
      generatedAt: new Date().toISOString(),
      deterministicReason: "no_trigger",
    };
  }

  const cacheKey = `${accountId}:${campaignId}`; // tenant-safe cache key
  const fingerprint = fingerprintContext(ctx);
  if (!opts.skipCache) {
    const hit = cardsCache.get(cacheKey);
    if (hit && hit.fingerprint === fingerprint && Date.now() - hit.at < CARDS_CACHE_TTL_MS) {
      return hit.result;
    }
  }

  const evidencePublic = ctx.evidence.map(({ ref, type, label }) => ({ ref, type, label }));
  let result: ReasoningResult;
  // P-5: rejected AI output is persisted to reasoning_runs (accuracy learning),
  // NEVER served. Captured here, written by persistReasoningRun below.
  let rejectedCards: ReasoningCard[] | null = null;
  let rejectionReasons: string[] | null = null;
  try {
    const cards = await runReasoner(ctx, accountId);
    const guards = runCardGuards(ctx, cards);
    if (!guards.ok) {
      console.warn(`${LOG} GUARDS_REJECTED campaign=${campaignId} violations=${JSON.stringify(guards.violations)}`);
      rejectedCards = cards;
      rejectionReasons = guards.violations;
      result = { state: "ready", source: "deterministic", cards: buildDeterministicCards(ctx), evidence: evidencePublic, generatedAt: new Date().toISOString(), deterministicReason: "guards_rejected" };
    } else {
      const judge = await judgeCards(ctx, cards, accountId);
      if (judge.verdict !== "PASS") {
        console.warn(`${LOG} JUDGE_REJECTED campaign=${campaignId} violations=${JSON.stringify(judge.violations)}`);
        rejectedCards = cards;
        rejectionReasons = judge.violations;
        result = { state: "ready", source: "deterministic", cards: buildDeterministicCards(ctx), evidence: evidencePublic, generatedAt: new Date().toISOString(), deterministicReason: "judge_rejected" };
      } else {
        result = { state: "ready", source: "ai", cards, evidence: evidencePublic, generatedAt: new Date().toISOString() };
      }
    }
  } catch (err) {
    console.error(`${LOG} LLM_FAILED campaign=${campaignId} detail=${(err as Error).message}`);
    rejectionReasons = [(err as Error).message];
    result = { state: "ready", source: "deterministic", cards: buildDeterministicCards(ctx), evidence: evidencePublic, generatedAt: new Date().toISOString(), deterministicReason: "llm_failed" };
  }

  const nowMs = Date.now();
  for (const [k, v] of cardsCache) {
    if (nowMs - v.at >= CARDS_CACHE_TTL_MS) cardsCache.delete(k);
  }
  cardsCache.delete(cacheKey);
  cardsCache.set(cacheKey, { at: nowMs, fingerprint, result });
  while (cardsCache.size > CARDS_CACHE_MAX) {
    const oldest = cardsCache.keys().next().value;
    if (oldest === undefined) break;
    cardsCache.delete(oldest);
  }

  console.log(`${LOG} CARDS campaign=${campaignId} source=${result.source}${result.deterministicReason ? ` reason=${result.deterministicReason}` : ""} cards=${result.cards.length} evidence=${ctx.evidence.length} history=${ctx.historyCount}`);

  // P-5 M1: persist the run outcome + lazily register cited evidence.
  // Never blocks serving (caught internally, loud on failure).
  await persistReasoningRun(ctx, accountId, campaignId, fingerprint, result, rejectedCards, rejectionReasons);

  return result;
}

// ── P-5 run persistence + evidence registration ──────────────────────────────

const KIND_BY_TYPE: Record<EvidenceItem["type"], EvidenceKind> = {
  market_insight: "market_insight",
  performance_report: "performance_report",
  performance_verdict: "performance_verdict",
  performance_memory: "performance_memory",
  business_context: "business_context",
  objective: "objective",
  competitor: "competitor",
  historical_analysis: "historical_finding",
};

const TABLE_BY_TYPE: Record<EvidenceItem["type"], string> = {
  market_insight: "market_memory",
  performance_report: "performance_cycle_reports",
  performance_verdict: "performance_decision_verdicts",
  performance_memory: "strategy_memory",
  business_context: "business_data_layer",
  objective: "goal_decompositions",
  competitor: "ci_competitors",
  historical_analysis: "derived:historical_analysis",
};

function toRegistryEntry(e: EvidenceItem): RegistryEntry {
  // Belief-history findings point at their real revision rows; other derived
  // findings (no backing row) get a content-hash source id. Row-backed ids
  // are content-versioned (`<rowId>@<hash>`) so evidence from a MUTABLE row
  // (business_data_layer, ci_competitors, strategy_memory) becomes NEW
  // registry evidence when the row changes — old citations keep resolving to
  // the text that existed at run time. Immutable rows hash stably.
  let sourceTable = TABLE_BY_TYPE[e.type];
  if (e.ref.startsWith("HIST-B")) sourceTable = "business_data_revisions";
  else if (e.ref.startsWith("HIST-C")) sourceTable = "ci_competitor_revisions";
  return {
    kind: KIND_BY_TYPE[e.type],
    sourceTable,
    sourceId: e.dbId ? versionedSourceId(e.dbId, e.detail) : derivedSourceId(`${e.ref}|${e.detail}`),
    label: e.label,
    detail: e.detail,
    observedAt: e.observedAt ?? new Date(),
  };
}

/**
 * Persist one fresh reasoning run: register the evidence the served cards
 * cite (lazy — only cited facts enter the registry) and record the run with
 * status, cited UIDs, and any rejected AI output + reasons. `no_history`
 * early-returns are not recorded — nothing was interpreted. Never throws.
 */
async function persistReasoningRun(
  ctx: ReasoningContext,
  accountId: string,
  campaignId: string,
  fingerprint: string,
  result: ReasoningResult,
  rejectedCards: ReasoningCard[] | null,
  rejectionReasons: string[] | null,
): Promise<void> {
  try {
    const cited = new Set<string>();
    for (const c of result.cards) for (const r of c.evidenceRefs) cited.add(r);
    const items = ctx.evidence.filter((e) => cited.has(e.ref));
    const uids = await registerEvidence(accountId, campaignId, items.map(toRegistryEntry));
    const refMap: Record<string, string> = {};
    items.forEach((e, i) => { refMap[e.ref] = uids[i]; });
    await recordReasoningRun({
      accountId,
      campaignId,
      layer: "strategic_reasoning",
      status: result.source === "ai" ? "accepted_ai" : (result.deterministicReason ?? "llm_failed"),
      contextFingerprint: fingerprint,
      model: REASONER_MODEL,
      output: { state: result.state, source: result.source, cards: result.cards },
      rejectedOutput: rejectedCards,
      rejectionReasons,
      evidenceUids: uids,
      refMap,
    });
  } catch (err) {
    console.error(`${LOG} RUN_PERSIST_FAILED campaign=${campaignId} detail=${(err as Error).message}`);
  }
}

/** Customer-safe projection — strips internal telemetry; the route serializes ONLY this. */
export function toCustomerReasoningPayload(result: ReasoningResult): {
  state: "ready" | "no_history";
  source: "ai" | "deterministic";
  cards: ReasoningCard[];
  evidence: Array<{ ref: string; type: EvidenceItem["type"]; label: string }>;
  generatedAt: string;
} {
  return {
    state: result.state,
    source: result.source,
    cards: result.cards,
    evidence: result.evidence,
    generatedAt: result.generatedAt,
  };
}

/** Test seam. */
export function _clearCardsCache(): void {
  cardsCache.clear();
}
