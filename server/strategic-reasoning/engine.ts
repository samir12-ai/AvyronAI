/**
 * Strategic Reasoning Engine (P-4)
 *
 * Sits ABOVE the Watchtower. The Watchtower's responsibility ends at grounded
 * Market Insights; this layer connects multiple verified intelligence sources
 * into one coherent business interpretation, expressed as evidence-cited
 * Reasoning Cards.
 *
 *   Watchtower Market Insights (market_memory â€” validated, deduped)
 *   Performance Loop outcomes  (performance_cycle_reports / decision_verdicts)
 *   Historical Performance Memory (strategy_memory)
 *   Historical Market Memory   (market_memory, 12-month horizon)
 *   Company profile            (business_data_layer)
 *   Business objectives        (goal_decompositions, active)
 *   Competitor context         (ci_competitors)
 *        â†“
 *   Deterministic historical analysis (recurrence, resemblance, momentum)
 *        â†“
 *   LLM reasoning (interpretation ONLY) â†’ code guards â†’ LLM judge
 *        â†“
 *   Reasoning Cards â€” every card cites evidence refs; rejected output is
 *   replaced by deterministic cards and never exposed.
 *
 * Doctrine (same as the P-3 grounded-interpretation layer):
 *   - No raw posts, no raw classifications â€” only verified upstream outputs.
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
import { generateWithRepair, LLMReliabilityError } from "../shared/llm-reliability/reliability-runner";

const LOG = "[StrategicReasoning]";
const REASONER_MODEL = "gpt-4.1-mini";
const JUDGE_MODEL = "gpt-4.1-mini";
const CARDS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CARDS_CACHE_MAX = 100;

// â”€â”€ card & evidence model â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
  dbId: string | null;               // underlying row id (internal only â€” never serialized to customers)
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
  /** Internal telemetry â€” never serialized to customers. */
  deterministicReason?: "no_trigger" | "guards_rejected" | "judge_rejected" | "llm_failed";
}

// â”€â”€ context assembly (deterministic) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
  // never createdAt (when the row happened to be written â€” backfills would
  // corrupt spacing). Recurrence/resemblance/momentum only compare rows of
  // the SAME window granularity: a 30d emerging theme and a 90d emerging
  // theme are not the same observation and must not be double-counted.
  const sameWindowHistory = history.filter((r) => r.windowDays === current.windowDays);

  // Recurrence: a theme that emerged in â‰¥2 same-window memory rows spaced â‰¥14 days apart.
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

  // Resemblance: strongest emerging-theme overlap with a past (â‰¥21 days old,
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
    .slice(0, 4); // newest â†’ oldest
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
      observedAt: row.windowTo, // coverage time â€” matches reader ordering (P-5)
      label: `Market insight Â· ${monthLabel(row.windowTo)} (${row.windowDays}-day view)`,
      detail: `[${row.windowTo.toISOString().slice(0, 10)}, window=${row.windowDays}d, confidence=${row.confidence}, dataStatus=${row.dataStatus}, basedOn=${row.basedOn}] ${row.headline}. ${row.narrative} | Dominant: ${dominant.join("; ") || "none"} | Emerging: ${emerging.join("; ") || "none"} | Declining: ${declining.join("; ") || "none"}`,
    });
  });

  reports.forEach((r, i) => {
    evidence.push({
      ref: `PR-${i + 1}`,
      type: "performance_report",
      dbId: r.id,
      label: `Performance cycle report Â· ${monthLabel(r.createdAt)}`,
      detail: `[${r.createdAt.toISOString().slice(0, 10)}, platform=${r.platform}, status=${r.status}] businessVerdict=${r.businessVerdict ?? "n/a"}, sales ${r.salesBefore ?? "n/a"} â†’ ${r.salesAfter ?? "n/a"}, decisions=${r.decisionsTotal}, attributionConfidence=${r.attributionConfidence ?? "n/a"}`,
    });
  });

  verdicts.forEach((v, i) => {
    evidence.push({
      ref: `PDV-${i + 1}`,
      type: "performance_verdict",
      dbId: v.id,
      label: `Performance verdict Â· ${v.decisionDimension}`,
      detail: `[${v.createdAt.toISOString().slice(0, 10)}] ${v.decisionDimension}="${v.decisionValue}" â†’ ${v.verdict} (${v.evidenceStrength}${v.confidence != null ? `, confidence=${v.confidence}` : ""}); executed=${v.executed}; reason: ${v.verdictReason}`,
    });
  });

  perfMemory.forEach((m, i) => {
    evidence.push({
      ref: `SM-${i + 1}`,
      type: "performance_memory",
      dbId: m.id,
      label: `Performance memory Â· ${m.label}`,
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
      label: `Business objective Â· ${g.goalType}`,
      detail: `goal=${g.goalType}${g.goalTarget != null ? ` target=${g.goalTarget}` : ""}${g.goalLabel ? ` (â€œ${g.goalLabel}â€)` : ""}, horizon=${g.timeHorizonDays}d, feasibility=${g.feasibility}${g.feasibilityScore != null ? ` (${g.feasibilityScore})` : ""}`,
    });
  }

  competitors.forEach((c, i) => {
    evidence.push({
      ref: `COMP-${i + 1}`,
      type: "competitor",
      dbId: c.id,
      label: `Competitor Â· ${c.name}`,
      detail: `${c.name}: type=${c.businessType}, objective=${c.primaryObjective}, tone=${c.messagingTone ?? "n/a"}`,
    });
  });

  const currentInsight = memoryRows[0] ?? null;
  const refFor = (row: MarketMemoryRow) => memoryRefById.get(row.id) ?? "MM-?";
  const marketFindings: MarketHistoryFindings = currentInsight
    ? analyzeHistory(currentInsight, memoryRows.slice(1), refFor)
    : { recurring: [], resemblance: null, momentum: [] };

  // P-5 M3: deterministic pattern retrieval over the append-only belief
  // histories. All values are verbatim from revision rows â€” no computation
  // beyond formatting, so everything stays guard-compatible evidence.
  const parseJsonArray = (s: string): string[] => {
    try { const v = JSON.parse(s); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
  };
  const parseJsonObject = (s: string): Record<string, unknown> => {
    try { const v = JSON.parse(s); return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}; } catch { return {}; }
  };
  const fmtVal = (v: unknown): string => {
    const s = v == null ? "not set" : typeof v === "string" ? v : JSON.stringify(v);
    return s.length > 80 ? `${s.slice(0, 77)}â€¦` : s;
  };

  const bizRevsTop = bizRevs.slice(0, 3);
  const businessChanges = bizRevsTop.map((r) => ({
    when: monthLabel(r.createdAt),
    fields: parseJsonArray(r.changedFields),
  }));

  const latestCompRev = new Map<string, (typeof compRevs)[number]>();
  for (const r of compRevs) {
    if (!latestCompRev.has(r.competitorId)) latestCompRev.set(r.competitorId, r); // desc order â†’ first is latest
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
      changes: fields.map((f) => `${f}: "${fmtVal(prev[f])}" â†’ "${fmtVal(curr[f])}"`),
    };
  });

  const findings: HistoricalFindings = { ...marketFindings, businessChanges, competitorChanges };

  // Historical-analysis findings are themselves evidence (deterministically computed).
  findings.recurring.forEach((r, i) => {
    evidence.push({
      ref: `HIST-R${i + 1}`,
      type: "historical_analysis",
      dbId: null,
      label: `Recurring pattern Â· ${r.value}`,
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
      label: `Momentum Â· ${m.value} ${m.direction}`,
      detail: `"${m.dimension}: ${m.value}" has been ${m.direction} across ${m.consecutiveWindows} consecutive ${currentInsight?.windowDays ?? 30}-day views (shares newestâ†’oldest: ${m.shares.join("%, ")}%)`,
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
      label: "Historical comparison â€” no patterns yet",
      detail: `${memoryRows.length} stored market snapshot(s) analyzed: no recurring themes, no resemblance to past states, and no sustained momentum detected yet. Historical reasoning strengthens as memory accumulates.`,
    });
  }

  // P-5 M3: belief-history findings are citable evidence like any other
  // finding â€” they point at their real revision rows.
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



// â”€â”€ LLM reasoning (interpretation only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const REASONER_SYSTEM_PROMPT = `You are a strategic reasoning engine for a business owner. You receive an EVIDENCE REGISTRY of verified intelligence (market insights, performance outcomes, historical analysis, company profile, objectives, competitors) plus deterministic historical findings.

Your job: connect these sources into coherent, evidence-cited REASONING CARDS that answer â€” why does this matter, why now, who is affected, has this happened before, is it temporary or recurring, is it relevant to THIS company, which signals reinforce each other.

STRICT RULES:
1. Use ONLY facts present in the evidence registry. Never invent numbers, competitors, events, or history.
2. Every card MUST cite the evidence refs (e.g. "MM-1", "HIST-R1", "BIZ-1") it draws from in evidenceRefs. Cite only refs that appear in the evidence registry. The historicalFindings block is context only â€” cite it through its corresponding HIST-* registry entries; NEVER cite "historicalFindings" or any other non-registry string. If no HIST-* entries exist, ground historical statements in MM-* entries instead. A card reporting ABSENCE (no recurrence found, no confirmed shifts, shallow history) still needs evidence: cite the MM-* entries whose data establishes that absence.
3. Historical comparisons may ONLY use the HIST-* findings and MM-* entries â€” never remembered or assumed history.
4. All calculations are already done. Never derive new percentages or counts.
5. Observations and context ONLY. NEVER recommend actions or strategy ("should", "recommend", "opportunity to" are forbidden).
6. Causation: hedged framing only ("consistent with", "might explain"); never proven causation about business outcomes.
7. Respect stated confidence and data limitations; say clearly what remains uncertain.
8. Plain business English, specific to this company. No filler.

Produce EXACTLY one card per type: market_direction, market_momentum, recurring_pattern, strategic_context, competitive_pressure, evidence_summary, confidence, uncertainty.

Respond ONLY with JSON:
{ "cards": [ { "cardType": "...", "title": "short specific title", "body": "2-4 sentences", "evidenceRefs": ["MM-1"], "confidence": "high|medium|low" } ] }`;

async function generateReasonerCandidate(ctx: ReasoningContext, accountId: string, lastError: string = ""): Promise<{ cards: ReasoningCard[] }> {
  const payload = {
    historicalFindings: ctx.findings,
    evidenceRegistry: ctx.evidence.map(({ ref, type, label, detail }) => ({ ref, type, label, detail })),
  };

  const userContent = lastError
    ? `Evidence:\n${JSON.stringify(payload, null, 2)}\n\n[SELF-CORRECTION] Your previous response failed: ${lastError}. Return ONLY complete valid JSON with exactly one card per required type. Keep bodies concise.`
    : `Evidence:\n${JSON.stringify(payload, null, 2)}`;

  const response = await aiChat({
    model: REASONER_MODEL,
    max_tokens: 1800,
    temperature: 0.2,
    timeoutMs: 90_000,
    accountId,
    endpoint: "strategic-reasoning-cards",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: REASONER_SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
  });

  const raw = response.choices?.[0]?.message?.content ?? "{}";
  const match = raw.match(/\{[\s\S]*\}/);
  const jsonStr = match ? match[0] : "{}";
  return JSON.parse(jsonStr);
}

// â”€â”€ deterministic guards â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
    // 1. Every cited ref must exist â€” the core grounding contract.
    for (const ref of card.evidenceRefs) {
      if (!validRefs.has(ref)) violations.push(`${card.cardType}: cites nonexistent evidence "${ref}"`);
    }
    if (card.evidenceRefs.length === 0) violations.push(`${card.cardType}: cites no evidence`);

    const text = `${card.title} ${card.body}`;
    // 2. Numbers must come from the evidence registry (years excluded â€” month
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

// â”€â”€ LLM judge â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const JUDGE_SYSTEM_PROMPT = `You are a strict grounding judge. You receive (a) a verified EVIDENCE REGISTRY with deterministic historical findings and (b) AI-written reasoning cards, each citing evidence refs.

REJECT if ANY card:
1. States a fact, statistic, event, or historical comparison not supported by the evidence items it cites (or the registry at all).
2. Names a competitor, theme, or time period absent from the registry.
3. Asserts proven causation about business OUTCOMES (sales, revenue, results) or definitively that one signal caused another. NOTE: describing signals as connected, reinforcing, coexisting, or part of one movement is REQUIRED reasoning and NOT a violation when the cited evidence moves in compatible directions; noting that competitor objectives or postures are consistent with observed messaging trends is descriptive grouping, not causation. Hedged language ("suggesting", "consistent with", "may", "might") is always acceptable. Only flag definitive unhedged claims that something CAUSED a business outcome.
4. Gives strategic advice or recommendations (what the business should do).
5. Overstates confidence â€” flag only clear overstatement, e.g. certainty language ("definitely", "proves") over evidence marked low-confidence or thin. A card's confidence field reflecting the strength of its cited pattern is the intended design, not a violation.
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

// â”€â”€ orchestration + cache â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
    throw new LLMReliabilityError("EVIDENCE_FAILURE: Missing current market insight", "EVIDENCE_FAILURE");
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
  let rejectedCards: ReasoningCard[] | null = null;
  let rejectionReasons: string[] | null = null;

  try {
    const { result: candidate } = await generateWithRepair<{ ctx: ReasoningContext, accountId: string }, { cards: ReasoningCard[] }>({
      engineName: "StrategicReasoning",
      touchpointName: "ReasoningCards",
      authoritativeInput: { ctx, accountId },
      generate: async (input) => generateReasonerCandidate(input.ctx, input.accountId),
      judge: async (input, parsed) => {
        if (!parsed || !Array.isArray(parsed.cards)) {
          return { valid: false, failureClass: "GENERATION_QUALITY_FAILURE", rejections: [{ reason: "missing cards array", rule: "schema_validation" }] };
        }
        const cards = parsed.cards;
        const missing = CARD_TYPES.filter((t) => !cards.some((c) => c.cardType === t));
        if (missing.length > 0) {
          return { valid: false, failureClass: "GENERATION_QUALITY_FAILURE", rejections: [{ reason: `missing card types: ${missing.join(", ")}`, rule: "schema_validation" }] };
        }
        
        const validShape = cards.every(
          (c): c is ReasoningCard =>
            !!c && typeof c.cardType === "string" && CARD_TYPES.includes(c.cardType as any) &&
            typeof c.title === "string" && typeof c.body === "string" &&
            Array.isArray(c.evidenceRefs) &&
            ["high", "medium", "low"].includes(c.confidence)
        );
        if (!validShape) {
          return { valid: false, failureClass: "GENERATION_QUALITY_FAILURE", rejections: [{ reason: "malformed cards array", rule: "schema_validation" }] };
        }

        const guards = runCardGuards(input.ctx, cards);
        if (!guards.ok) {
          return { valid: false, failureClass: "GENERATION_QUALITY_FAILURE", rejections: guards.violations.map(v => ({ reason: v, rule: "code_guards" })) };
        }

        const judge = await judgeCards(input.ctx, cards, input.accountId);
        if (judge.verdict !== "PASS") {
          return { valid: false, failureClass: "GENERATION_QUALITY_FAILURE", rejections: judge.violations.map(v => ({ reason: v, rule: "llm_judge" })) };
        }

        return { valid: true };
      },
      repair: async (input, _, rejections) => {
        const errs = rejections.map(r => r.reason).join("; ");
        return generateReasonerCandidate(input.ctx, input.accountId, errs);
      }
    });

    let finalCards = (candidate.cards || []);
    if (Array.isArray(finalCards)) {
       finalCards = CARD_TYPES.map((t) => finalCards.find((c) => c.cardType === t)).filter(Boolean) as ReasoningCard[];
    }

    result = { state: "ready", source: "ai", cards: finalCards, evidence: evidencePublic, generatedAt: new Date().toISOString() };
    
    if ((candidate as any)._system_validation) {
       (result as any)._system_validation = (candidate as any)._system_validation;
       rejectedCards = finalCards;
       rejectionReasons = [(candidate as any)._system_validation.reason];
       console.log(`${LOG} REASONER_SOFT_FAIL campaign=${campaignId} detail=${(candidate as any)._system_validation.reason}`);
    }
  } catch (err: any) {
    if (err instanceof LLMReliabilityError && err.failureClass === "EVIDENCE_FAILURE") {
      throw err;
    }
    throw err;
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

// â”€â”€ P-5 run persistence + evidence registration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
  // registry evidence when the row changes â€” old citations keep resolving to
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
 * cite (lazy â€” only cited facts enter the registry) and record the run with
 * status, cited UIDs, and any rejected AI output + reasons. `no_history`
 * early-returns are not recorded â€” nothing was interpreted. Never throws.
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

/** Customer-safe projection â€” strips internal telemetry; the route serializes ONLY this. */
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
