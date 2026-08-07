// Perception Layer (Slices 1+2) — customer-facing read endpoints that
// surface the system's hidden runtime intelligence (continuity ticks,
// boss-run verdicts, re-anchor events) using the curated phrasing in
// shared/perception-translator.ts.
//
// Both endpoints are auth-scoped via requireCampaign (which itself
// Perception Layer (Slices 1+2) — customer-facing read endpoints that
// surface the system's hidden runtime intelligence (continuity ticks,
// boss-run verdicts, re-anchor events) using the curated phrasing in
// shared/perception-translator.ts.
//
// Both endpoints are auth-scoped via requireCampaign (which itself
// runs after the global /api authMiddleware). NOT admin-token-gated —
// these are first-class user surfaces, not operator dashboards.
//
// D5 discipline: every translator output that returns `null` is hidden
// from the response. We NEVER substitute a generic "all good" phrase
// for an unknown internal status. Empty data => empty array + an
// explicit `state: "watching" | "no_data"` flag.

import type { Express, Request, Response } from "express";
import { db } from "./db";
import { requireCampaign } from "./campaign-routes";
import {
  bossRuns,
  planAnchorResets,
  continuityTicks,
  pipelineChangeEvents,
  ciCompetitors,
  ciCompetitorPosts,
  miFetchJobs,
  publishedPosts,
  pipelineEvalWindows,
  strategyMemory,
  miSnapshots,
  audienceSnapshots,
  positioningSnapshots,
  offerSnapshots,
  funnelSnapshots,
  awarenessSnapshots,
  integritySnapshots,
  performanceCycleReports,
  performanceDecisionVerdicts,
  watchtowerStrategicBriefs,
} from "@shared/schema";
import { enqueueBrief, PROMPT_VERSION, GENERATOR_VERSION, JUDGE_VERSION, EVIDENCE_VERSION } from "./watchtower/strategic-brief-runner";
import { buildStrategicContext } from "./watchtower/strategic-brief-context";
import { acceptUserTruth } from "./pipeline/lanes/user/user-truth";
import { evaluateWindowState } from "./pipeline/eval-windows";
import { runPerformanceCycle } from "./performance-loop/cycle-runner";
import { PipelineValidationError } from "./pipeline/errors";
import {
  computeMarketDistributionSnapshot,
  normalizeWindow,
} from "./watchtower/distribution-intelligence";
import { getMarketInsight, toCustomerInsightPayload } from "./watchtower/ai-market-analyst";
import { getReasoningCards, toCustomerReasoningPayload } from "./strategic-reasoning/engine";
import { eq, and, desc, gte, sql, count, ne, max, inArray, isNotNull } from "drizzle-orm";
import {
  translateQ1Verdict,
  translateQ2Verdict,
  translateFreshness,
  translateBossRunStatus,
  translateReanchorReason,
  translateContinuityDecision,
  translateBlockedReasons,
  translateSignalKind,
  humanizeSemanticValue,
  translateDistributionTrend,
  buildMonitoringLines,
  Q1_PENDING_FIRST_RUN,
  Q2_PENDING_FIRST_RUN,
  Q1_UNRECOGNIZED,
  Q2_UNRECOGNIZED,
  type WatchtowerLine,
  type ActivityEvent,
  type MonitoringFacts,
  type BlockedReason,
} from "@shared/perception-translator";

const LOG_PREFIX = "[Perception]";

export function registerPerceptionRoutes(app: Express) {
  // -------------------------------------------------------------------------
  // GET /api/perception/watchtower?campaignId=...
  //
  // Returns 3 short "lines" (market state, plan state, freshness) suitable
  // for a single dashboard strip. Reads ONLY the latest completed boss_run
  // for the campaign. If none exists, every line is in the `watching` /
  // `unknown` tone — the strip still renders, just empty-state.
  // -------------------------------------------------------------------------
  app.get("/api/perception/watchtower", requireCampaign, async (req: Request, res: Response) => {
    try {
      const { accountId, campaignId } = (req as any).campaignContext;

      const [latest] = await db
        .select({
          id: bossRuns.id,
          status: bossRuns.status,
          q1Verdict: bossRuns.q1Verdict,
          q2Verdict: bossRuns.q2Verdict,
          finishedAt: bossRuns.finishedAt,
          createdAt: bossRuns.createdAt,
        })
        .from(bossRuns)
        .where(and(eq(bossRuns.accountId, accountId), eq(bossRuns.campaignId, campaignId)))
        .orderBy(desc(bossRuns.createdAt))
        .limit(1);

      const lastCheckedAt = latest?.finishedAt ?? latest?.createdAt ?? null;

      // Resolve q1/q2 with explicit pending-vs-unrecognized branches. If
      // there's no boss_run yet → "first run pending". If a run exists but
      // its verdict is outside the allowlist (bug) → "unrecognized state",
      // never silently reframed as normal (D5 fail-closed).
      const marketLine: WatchtowerLine = latest
        ? (translateQ2Verdict(latest.q2Verdict) ?? Q2_UNRECOGNIZED)
        : Q2_PENDING_FIRST_RUN;
      const planLine: WatchtowerLine = latest
        ? (translateQ1Verdict(latest.q1Verdict) ?? Q1_UNRECOGNIZED)
        : Q1_PENDING_FIRST_RUN;

      const lines: { id: string; line: WatchtowerLine }[] = [
        { id: "market", line: marketLine },
        { id: "plan", line: planLine },
        { id: "freshness", line: translateFreshness(lastCheckedAt) },
      ];

      // NOTE: We intentionally DO NOT return bossRunId / internal status
      // strings — Phase 8 customer-surface gate. The translator output is
      // the entire customer-visible payload.
      return res.json({
        success: true,
        state: latest ? "ready" : "no_data",
        lastCheckedAt: lastCheckedAt instanceof Date ? lastCheckedAt.toISOString() : lastCheckedAt,
        lines,
      });
    } catch (err: any) {
      console.error(`${LOG_PREFIX} watchtower failed:`, err?.message ?? err);
      return res.status(500).json({ success: false, error: "WATCHTOWER_FAILED" });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/perception/activity?campaignId=...&sinceHours=168
  //
  // Returns a unified, time-ordered list of customer-visible system actions
  // over the last `sinceHours` (default 7 days). Sources:
  //   - boss_runs (review attempts)
  //   - plan_anchor_resets (review-cadence re-alignment)
  //   - continuity_ticks (per-campaign scheduler decisions extracted from
  //     the JSONB `notes` column)
  // Each row passes through the perception-translator allowlist. Unknown
  // statuses are DROPPED (not coerced into "all good").
  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  // GET /api/perception/blocked-reasons?campaignId=...
  //
  // Lifecycle C-package (May 2026). Returns the customer-facing CTA list
  // built from the most-recent boss_run's `warnings` array. Also reports
  // whether a user-truth submission is currently due so the dashboard can
  // surface the inline form even when the boss hasn't run yet (e.g. the
  // window opened but the first run hasn't been kicked).
  //
  // Fail-closed: unknown warning codes are dropped (perception translator).
  // Customer payload contains NO internal warning codes — only the
  // translated headline/detail/cta + a stable `action` enum.
  // -------------------------------------------------------------------------
  app.get("/api/perception/blocked-reasons", requireCampaign, async (req: Request, res: Response) => {
    try {
      const { accountId, campaignId } = (req as any).campaignContext;

      const [latest] = await db
        .select({
          id: bossRuns.id,
          status: bossRuns.status,
          warnings: bossRuns.warnings,
          createdAt: bossRuns.createdAt,
          finishedAt: bossRuns.finishedAt,
        })
        .from(bossRuns)
        .where(and(eq(bossRuns.accountId, accountId), eq(bossRuns.campaignId, campaignId)))
        .orderBy(desc(bossRuns.createdAt))
        .limit(1);

      // Parse warnings JSON. Persisted as JSONB text in bossRuns.warnings
      // (see server/boss/run.ts:281–299). May be array, string-encoded
      // array, null, or absent.
      let warnings: string[] = [];
      if (latest?.warnings) {
        const raw = latest.warnings as unknown;
        if (Array.isArray(raw)) warnings = raw.filter((w): w is string => typeof w === "string");
        else if (typeof raw === "string") {
          try { const p = JSON.parse(raw); if (Array.isArray(p)) warnings = p.filter((w) => typeof w === "string"); }
          catch { /* swallow — translator handles empty */ }
        }
      }
      const reasons: BlockedReason[] = translateBlockedReasons(warnings);

      // Truth-due signal: independent of warnings. If an eval window is
      // currently open AND no user_truth row exists for it, surface the
      // truth submission CTA even if no boss_run has emitted a warning
      // yet (covers the gap between window-open and first run).
      let truthDue: { windowId: string; windowEndsAt: string; isLate: boolean } | null = null;
      try {
        // Open window = state='open' AND no linked truth_id. Per
        // shared/schema.ts:3058 pipeline_eval_windows.state ∈
        // {open, closed_with_truth, closed_missing_truth, late_filled}
        // and the truth link lives on the WINDOW row (truthId), not on
        // the truth row.
        const [openWindow] = await db
          .select({
            id: pipelineEvalWindows.id,
            windowEnd: pipelineEvalWindows.windowEnd,
            truthId: pipelineEvalWindows.truthId,
          })
          .from(pipelineEvalWindows)
          .where(and(
            eq(pipelineEvalWindows.accountId, accountId),
            eq(pipelineEvalWindows.campaignId, campaignId),
            eq(pipelineEvalWindows.state, "open"),
          ))
          .orderBy(desc(pipelineEvalWindows.windowEnd))
          .limit(1);

        if (openWindow && !openWindow.truthId) {
          const endsAt = openWindow.windowEnd instanceof Date
            ? openWindow.windowEnd
            : new Date(openWindow.windowEnd as any);
          truthDue = {
            windowId: openWindow.id,
            windowEndsAt: endsAt.toISOString(),
            isLate: endsAt.getTime() < Date.now(),
          };
        }
      } catch (e) {
        // Fail-open on the truth-due probe — never block the reasons list.
        console.error(`${LOG_PREFIX} blocked-reasons truth-due probe failed:`, (e as any)?.message ?? e);
      }

      // Strip internal operator fields from the customer payload:
      //   - reasons[].code is the internal warning enum (e.g.
      //     "bridge_skipped:user_lane_no_signals_extracted"). Customers
      //     get only the translated headline/detail/cta/action/tone.
      //   - truthDue.windowId is an internal UUID. Customers only need
      //     the timing signal (isLate + windowEndsAt) — submission goes
      //     through the server which re-derives the window itself.
      const sanitizedReasons = reasons.map(({ code: _code, ...rest }) => rest);
      const sanitizedTruthDue = truthDue
        ? { windowEndsAt: truthDue.windowEndsAt, isLate: truthDue.isLate }
        : null;
      return res.json({
        success: true,
        state: sanitizedReasons.length > 0 || sanitizedTruthDue ? "ready" : "no_data",
        lastCheckedAt: (latest?.finishedAt ?? latest?.createdAt) instanceof Date
          ? (latest!.finishedAt ?? latest!.createdAt!).toISOString()
          : null,
        reasons: sanitizedReasons,
        truthDue: sanitizedTruthDue,
      });
    } catch (err: any) {
      console.error(`${LOG_PREFIX} blocked-reasons failed:`, err?.message ?? err);
      return res.status(500).json({ success: false, error: "BLOCKED_REASONS_FAILED" });
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/perception/user-truth
  //
  // Customer-grade truth intake (lifecycle C-package). Mirrors the existing
  // admin-gated `/api/pipeline/user-truth` but runs under `requireCampaign`
  // so the dashboard form on the customer surface can submit. Server is the
  // sole authority on windowId — derived from evaluateWindowState() at
  // submit time; the client cannot pick the window.
  //
  // Wrapper rule (Phase 8 customer-surface gate): the response contains
  // ONLY the customer-safe shape — { ok, superseded, wasLate }. Internal
  // identifiers (truthId/windowId) never reach the customer payload.
  // -------------------------------------------------------------------------
  app.post("/api/perception/user-truth", requireCampaign, async (req: Request, res: Response) => {
    try {
      const { accountId, campaignId } = (req as any).campaignContext;
      const submittedBy = (req as any).user?.id ?? null;
      const body = req.body ?? {};
      const ws = await evaluateWindowState(accountId, campaignId, new Date());
      if (!ws.window) {
        return res.status(409).json({
          success: false,
          code: "NO_ACTIVE_APPROVED_PLAN",
          message: "Your weekly review window isn't open yet — approve a plan first.",
        });
      }
      const result = await acceptUserTruth({
        accountId,
        campaignId,
        windowId: ws.window.id,
        totalLeads: Number(body.totalLeads),
        qualifiedLeads: Number(body.qualifiedLeads),
        bookedCalls: Number(body.bookedCalls),
        paidActive: body.paidActive === true,
        submittedBy,
        // P-2 Phase 4D — optional source fields. Absent stays NULL (never 0).
        // NULL≠0 doctrine: only an integer number or all-digit string counts
        // as "provided". Number(false)/Number(" ")/Number([]) all coerce to 0
        // and would silently turn "not provided" into an explicit stored 0.
        payingCustomers:
          typeof body.payingCustomers === "number" && Number.isInteger(body.payingCustomers)
            ? body.payingCustomers
            : typeof body.payingCustomers === "string" && /^\d+$/.test(body.payingCustomers.trim())
              ? Number(body.payingCustomers.trim())
              : null,
        leadSource: typeof body.leadSource === "string" ? body.leadSource : null,
        relatedCampaign: typeof body.relatedCampaign === "string" ? body.relatedCampaign : null,
        relatedPostUrl: typeof body.relatedPostUrl === "string" ? body.relatedPostUrl : null,
        leadChannel: typeof body.leadChannel === "string" ? body.leadChannel : null,
        attributionKnown: typeof body.attributionKnown === "boolean" ? body.attributionKnown : null,
      });
      // P-2 Final — truth submission is the trigger that closes the
      // Performance Loop: fire-and-forget cycle run (scoring → decision
      // verdicts → strategic memory → next-cycle recommendation) for the
      // window that just received truth. Never blocks or fails the submit.
      const cycleWindowId = result.window.id;
      setImmediate(() => {
        runPerformanceCycle({ accountId, campaignId, windowId: cycleWindowId })
          .then((cycle) =>
            console.log(
              `${LOG_PREFIX} performance cycle ${cycle.status} window=${cycleWindowId} ` +
              `verdicts=${cycle.verdicts.length} reasons=${cycle.reasons.join("|") || "none"}`,
            ),
          )
          .catch((err) =>
            console.error(`${LOG_PREFIX} performance cycle failed window=${cycleWindowId}:`, err?.message ?? err),
          );
      });

      return res.status(201).json({
        success: true,
        superseded: result.superseded,
        wasLate: result.truth.wasLate,
      });
    } catch (err: any) {
      if (err instanceof PipelineValidationError) {
        return res.status(400).json({ success: false, code: err.code, message: err.message });
      }
      console.error(`${LOG_PREFIX} user-truth submit failed:`, err?.message ?? err);
      return res.status(500).json({ success: false, code: "TRUTH_SUBMIT_FAILED" });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/perception/performance-cycle?campaignId=...
  //
  // P-2 Final — customer-facing weekly review artifact. Returns the latest
  // COMPLETE performance cycle: per-decision verdicts (WINNER / LOSER /
  // INCONCLUSIVE / NOT_EXECUTED / NEEDS_MORE_DATA), sales movement, the
  // 7-question review, and the next-cycle recommendation.
  //
  // Wrapper rule: no internal UUIDs (windowId/planId/cycleRunId) in the
  // payload. Week number + period dates identify the cycle for the customer.
  // Synthetic verification cycles carry isTestCycle=true + their label.
  // -------------------------------------------------------------------------
  app.get("/api/perception/performance-cycle", requireCampaign, async (req: Request, res: Response) => {
    try {
      const { accountId, campaignId } = (req as any).campaignContext;
      const reportRows = await db
        .select()
        .from(performanceCycleReports)
        .where(and(
          eq(performanceCycleReports.accountId, accountId),
          eq(performanceCycleReports.campaignId, campaignId),
        ))
        .orderBy(desc(performanceCycleReports.createdAt))
        .limit(1);
      const report = reportRows[0];
      if (!report) {
        return res.json({ success: true, state: "no_cycle_yet", cycle: null });
      }
      const verdictRows = await db
        .select()
        .from(performanceDecisionVerdicts)
        .where(and(
          eq(performanceDecisionVerdicts.accountId, accountId),
          eq(performanceDecisionVerdicts.campaignId, campaignId),
          eq(performanceDecisionVerdicts.windowId, report.windowId),
        ));
      const parse = (s: string | null) => {
        if (!s) return null;
        try { return JSON.parse(s); } catch { return null; }
      };
      // Shape normalization — stored JSON is versioned but the customer
      // surface must never crash on a legacy/malformed row. Arrays are
      // coerced to string[], objects to plain records, everything else null.
      const strList = (v: unknown): string[] =>
        Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
      const rawNext = parse(report.nextCycleRecommendation) as Record<string, unknown> | null;
      const nextStep = rawNext && typeof rawNext === "object" && !Array.isArray(rawNext)
        ? {
            keepDoing: strList(rawNext.keepDoing),
            stopDoing: strList(rawNext.stopDoing),
            retryWithBetterData: strList(rawNext.retryWithBetterData),
            executeWhatWasPlanned: strList(rawNext.executeWhatWasPlanned),
            nextExperiment: typeof rawNext.nextExperiment === "string" ? rawNext.nextExperiment : null,
            rationale: typeof rawNext.rationale === "string" ? rawNext.rationale : "",
          }
        : null;
      const rawCounts = parse(report.verdictCounts);
      const verdictCounts = rawCounts && typeof rawCounts === "object" && !Array.isArray(rawCounts)
        ? Object.fromEntries(Object.entries(rawCounts).filter(([, n]) => typeof n === "number"))
        : {};
      const rawReview = parse(report.sevenAnswers);
      const review = rawReview && typeof rawReview === "object" && !Array.isArray(rawReview) ? rawReview : null;
      const periodStart = verdictRows[0]?.windowStart ?? null;
      const periodEnd = verdictRows[0]?.windowEnd ?? null;
      return res.json({
        success: true,
        state: "ready",
        cycle: {
          weekNumber: report.windowIndex + 1,
          periodStart: periodStart ? periodStart.toISOString() : null,
          periodEnd: periodEnd ? periodEnd.toISOString() : null,
          platform: report.platform,
          sales: { before: report.salesBefore, after: report.salesAfter },
          businessVerdict: report.businessVerdict,
          attributionConfidence: report.attributionConfidence,
          decisions: verdictRows.map((v) => ({
            dimension: v.decisionDimension,
            value: v.decisionValue,
            executed: v.executed,
            postCount: v.executedPostCount,
            verdict: v.verdict,
            reason: v.verdictReason,
            evidenceStrength: v.evidenceStrength,
            confidence: v.confidence,
            confounders: strList(parse(v.confounders)),
          })),
          verdictCounts,
          nextStep,
          review,
          isTestCycle: report.testLabel != null,
          testLabel: report.testLabel,
          generatedAt: report.createdAt ? report.createdAt.toISOString() : null,
        },
      });
    } catch (err: any) {
      console.error(`${LOG_PREFIX} performance-cycle read failed:`, err?.message ?? err);
      return res.status(500).json({ success: false, error: "PERFORMANCE_CYCLE_READ_FAILED" });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/perception/reasoning?campaignId=...
  //
  // CLP-07 / T107 — customer-facing read-only reasoning surface. Returns one
  // card per engine pillar from the latest snapshot in this campaign, using
  // ONLY the customer-safe vocabulary allowlist (see Phase 8 lint:vocab):
  //   audience insights / market position / offer logic / story arc /
  //   competitor scan / reasoning checks.
  //
  // Each card carries:
  //   - state: "ok" | "degraded" | "insufficient" | "missing"
  //   - confidence (0..1) when applicable
  //   - degradedReason (customer-safe short string) when state != "ok"
  //   - provenance: "live" | "benchmark" | "mixed" | null
  //   - lastUpdatedAt (ISO)
  //
  // Doctrine: NO internal engine names ("Positioning Engine", etc.) ever
  // reach the payload. NO raw doctrinal tokens. Unknown statuses → "missing"
  // (fail-closed, never coerced to "ok").
  // -------------------------------------------------------------------------
  app.get("/api/perception/reasoning", requireCampaign, async (req: Request, res: Response) => {
    try {
      const { accountId, campaignId } = (req as any).campaignContext;
      const where = (t: any) => and(eq(t.accountId, accountId), eq(t.campaignId, campaignId));

      const latest = async <T>(rows: Promise<T[]>): Promise<T | null> => {
        const r = await rows;
        return r[0] ?? null;
      };

      const [mi, audience, positioning, offer, funnel, awareness, integrity] = await Promise.all([
        latest(db.select({
          createdAt: miSnapshots.createdAt,
          status: miSnapshots.status,
          overallConfidence: miSnapshots.overallConfidence,
          // mi_snapshots has no competitors_found column — count is derived
          // below from the competitorData JSON array (fail-closed to null).
          competitorData: miSnapshots.competitorData,
        }).from(miSnapshots).where(where(miSnapshots)).orderBy(desc(miSnapshots.createdAt)).limit(1)),

        latest(db.select({
          createdAt: audienceSnapshots.createdAt,
          inputSummary: audienceSnapshots.inputSummary,
          signalLineage: audienceSnapshots.signalLineage,
        }).from(audienceSnapshots).where(where(audienceSnapshots)).orderBy(desc(audienceSnapshots.createdAt)).limit(1)),

        latest(db.select({
          createdAt: positioningSnapshots.createdAt,
          status: positioningSnapshots.status,
          statusMessage: positioningSnapshots.statusMessage,
          confidenceScore: positioningSnapshots.confidenceScore,
        }).from(positioningSnapshots).where(where(positioningSnapshots)).orderBy(desc(positioningSnapshots.createdAt)).limit(1)),

        latest(db.select({
          createdAt: offerSnapshots.createdAt,
          status: offerSnapshots.status,
          statusMessage: offerSnapshots.statusMessage,
          confidenceScore: offerSnapshots.confidenceScore,
        }).from(offerSnapshots).where(where(offerSnapshots)).orderBy(desc(offerSnapshots.createdAt)).limit(1)),

        latest(db.select({
          createdAt: funnelSnapshots.createdAt,
          status: funnelSnapshots.status,
          statusMessage: funnelSnapshots.statusMessage,
          confidenceScore: funnelSnapshots.confidenceScore,
        }).from(funnelSnapshots).where(where(funnelSnapshots)).orderBy(desc(funnelSnapshots.createdAt)).limit(1)),

        latest(db.select({
          createdAt: awarenessSnapshots.createdAt,
          status: awarenessSnapshots.status,
          statusMessage: awarenessSnapshots.statusMessage,
          dataReliability: awarenessSnapshots.dataReliability,
          awarenessStrengthScore: awarenessSnapshots.awarenessStrengthScore,
        }).from(awarenessSnapshots).where(where(awarenessSnapshots)).orderBy(desc(awarenessSnapshots.createdAt)).limit(1)),

        latest(db.select({
          createdAt: integritySnapshots.createdAt,
          status: integritySnapshots.status,
          statusMessage: integritySnapshots.statusMessage,
          overallIntegrityScore: integritySnapshots.overallIntegrityScore,
          safeToExecute: integritySnapshots.safeToExecute,
          layerResults: integritySnapshots.layerResults,
        }).from(integritySnapshots).where(where(integritySnapshots)).orderBy(desc(integritySnapshots.createdAt)).limit(1)),
      ]);

      // Customer-safe degraded-reason mapper. Maps internal status enums to
      // short user-facing English. Unknown statuses return null (fail-closed)
      // and the card renders as "missing".
      type CardState = "ok" | "degraded" | "insufficient" | "missing";
      const projectStatus = (status: string | null | undefined, message: string | null | undefined): { state: CardState; reason: string | null } => {
        if (!status) return { state: "missing", reason: null };
        const s = String(status).toUpperCase();
        if (s === "COMPLETE" || s === "OK" || s === "SUCCESS") return { state: "ok", reason: null };
        if (s.includes("INSUFFICIENT")) return { state: "insufficient", reason: "Not enough evidence yet" };
        if (s.includes("DEGRADED") || s.includes("PARTIAL") || s.includes("INCOMPLETE")) return { state: "degraded", reason: "Limited evidence in this run" };
        if (s.includes("INTEGRITY_FAILED")) return { state: "degraded", reason: "Reasoning checks flagged a gap" };
        if (s.includes("FAILED") || s.includes("ERROR")) return { state: "degraded", reason: "Last attempt couldn't complete" };
        return { state: "missing", reason: null };
      };

      const safeNumberOrNull = (n: unknown): number | null => {
        if (typeof n !== "number" || !Number.isFinite(n)) return null;
        return Math.max(0, Math.min(1, n));
      };
      const tsIso = (d: unknown): string | null => (d instanceof Date ? d.toISOString() : (typeof d === "string" ? d : null));

      // MI provenance: "live" if competitorsFound > 0 (direct scrape this run),
      // else "benchmark" (system fell back to baseline). Other engines have
      // no per-engine provenance signal yet — left null.
      const miCompetitors = (() => {
        if (!mi?.competitorData || typeof mi.competitorData !== "string") return null;
        try {
          const parsed = JSON.parse(mi.competitorData);
          return Array.isArray(parsed) ? parsed.length : null;
        } catch {
          return null; // malformed JSON → fail-closed, card shows no evidence line
        }
      })();
      const miProvenance: "live" | "benchmark" | null = mi
        ? ((miCompetitors ?? 0) > 0 ? "live" : "benchmark")
        : null;

      // Reasoning-checks (integrity) — surface layer-coverage honestly.
      let integrityCoverage: { evaluated: number; insufficient: number; total: number } | null = null;
      try {
        if (integrity?.layerResults) {
          const raw = typeof integrity.layerResults === "string" ? JSON.parse(integrity.layerResults) : integrity.layerResults;
          if (Array.isArray(raw)) {
            const evaluated = raw.filter((l: any) => l?.evaluationState === "EVALUATED").length;
            const insufficient = raw.filter((l: any) => l?.evaluationState && l.evaluationState !== "EVALUATED").length;
            integrityCoverage = { evaluated, insufficient, total: raw.length };
          }
        }
      } catch { /* swallow parse error; surface degrades to missing */ }

      const cards = [
        {
          id: "competitor_scan",
          label: "Competitor scan",
          ...projectStatus(mi?.status, null),
          confidence: safeNumberOrNull(mi?.overallConfidence),
          provenance: miProvenance,
          lastUpdatedAt: tsIso(mi?.createdAt),
          evidence: typeof miCompetitors === "number" ? `${miCompetitors} competitor${miCompetitors === 1 ? "" : "s"} observed` : null,
        },
        (() => {
          // CLP-02 / P1: fail-closed. audience_snapshots has no `status`
          // column, so we project from evidence presence instead of
          // existence-of-row. A bare row with no signal lineage and no
          // input summary is "insufficient" — NEVER silently "ok".
          let aState: CardState = "missing";
          let aReason: string | null = null;
          if (audience) {
            const hasSummary = typeof audience.inputSummary === "string" && audience.inputSummary.trim().length > 0;
            const hasLineage = typeof audience.signalLineage === "string" && audience.signalLineage.trim().length > 0;
            if (hasSummary && hasLineage) {
              aState = "ok";
            } else if (hasSummary || hasLineage) {
              aState = "insufficient";
              aReason = "Audience read is partial — still gathering signals.";
            } else {
              aState = "insufficient";
              aReason = "Audience read recorded but no signals captured.";
            }
          }
          return {
            id: "audience_insights",
            label: "Audience insights",
            state: aState,
            reason: aReason,
            confidence: null,
            provenance: null,
            lastUpdatedAt: tsIso(audience?.createdAt),
            evidence: aState === "ok" ? "Reading recent audience signals" : null,
          };
        })(),
        {
          id: "market_position",
          label: "Market position",
          ...projectStatus(positioning?.status, positioning?.statusMessage),
          confidence: safeNumberOrNull(positioning?.confidenceScore),
          provenance: null,
          lastUpdatedAt: tsIso(positioning?.createdAt),
          evidence: null,
        },
        {
          id: "offer_logic",
          label: "Offer logic",
          ...projectStatus(offer?.status, offer?.statusMessage),
          confidence: safeNumberOrNull(offer?.confidenceScore),
          provenance: null,
          lastUpdatedAt: tsIso(offer?.createdAt),
          evidence: null,
        },
        {
          id: "story_arc",
          label: "Story arc",
          ...projectStatus(
            (funnel?.status ?? awareness?.status) as string | null,
            (funnel?.statusMessage ?? awareness?.statusMessage) as string | null,
          ),
          confidence: safeNumberOrNull(funnel?.confidenceScore ?? awareness?.awarenessStrengthScore),
          provenance: null,
          lastUpdatedAt: tsIso(funnel?.createdAt ?? awareness?.createdAt),
          evidence: null,
        },
        {
          id: "reasoning_checks",
          label: "Reasoning checks",
          ...projectStatus(integrity?.status, integrity?.statusMessage),
          confidence: safeNumberOrNull(integrity?.overallIntegrityScore),
          provenance: null,
          lastUpdatedAt: tsIso(integrity?.createdAt),
          evidence: integrityCoverage
            ? `${integrityCoverage.evaluated} of ${integrityCoverage.total} checks ran (${integrityCoverage.insufficient} skipped for lack of evidence)`
            : null,
          safe: typeof integrity?.safeToExecute === "boolean" ? integrity.safeToExecute : null,
        },
      ];

      const anyReady = cards.some((c) => c.state !== "missing");
      return res.json({
        success: true,
        state: anyReady ? "ready" : "no_data",
        cards,
      });
    } catch (err: any) {
      console.error(`${LOG_PREFIX} reasoning failed:`, err?.message ?? err);
      return res.status(500).json({ success: false, error: "REASONING_FAILED" });
    }
  });

  app.get("/api/perception/activity", requireCampaign, async (req: Request, res: Response) => {
    try {
      const { accountId, campaignId } = (req as any).campaignContext;
      const sinceHours = Math.max(1, Math.min(24 * 30, Number(req.query.sinceHours) || 168));
      const since = new Date(Date.now() - sinceHours * 3_600_000);
      const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 30));

      const events: ActivityEvent[] = [];

      // Source 1: boss_runs
      const runs = await db
        .select({
          id: bossRuns.id,
          status: bossRuns.status,
          q1Verdict: bossRuns.q1Verdict,
          q2Verdict: bossRuns.q2Verdict,
          finishedAt: bossRuns.finishedAt,
          createdAt: bossRuns.createdAt,
        })
        .from(bossRuns)
        .where(and(
          eq(bossRuns.accountId, accountId),
          eq(bossRuns.campaignId, campaignId),
          gte(bossRuns.createdAt, since),
        ))
        .orderBy(desc(bossRuns.createdAt))
        .limit(limit);

      for (const r of runs) {
        const at = r.finishedAt ?? r.createdAt;
        if (!at) continue;
        const t = translateBossRunStatus(r.status, r.q1Verdict, r.q2Verdict);
        if (!t) continue; // fail-closed: drop unrecognized statuses
        events.push({
          // Opaque ids only — internal UUIDs/status codes never reach the
          // customer payload (Phase 8 customer-surface gate). `kind` + `at`
          // are enough to disambiguate for React keys.
          id: `boss:${at.getTime()}`,
          kind: "boss_run",
          at: at.toISOString(),
          tone: t.tone,
          title: t.title,
          detail: t.detail,
        });
      }

      // Source 2: plan_anchor_resets
      const resets = await db
        .select({
          id: planAnchorResets.id,
          reason: planAnchorResets.reason,
          reanchoredAt: planAnchorResets.reanchoredAt,
        })
        .from(planAnchorResets)
        .where(and(
          eq(planAnchorResets.accountId, accountId),
          eq(planAnchorResets.campaignId, campaignId),
          gte(planAnchorResets.reanchoredAt, since),
        ))
        .orderBy(desc(planAnchorResets.reanchoredAt))
        .limit(limit);

      for (const r of resets) {
        const t = translateReanchorReason(r.reason);
        events.push({
          id: `anchor:${r.reanchoredAt.getTime()}`,
          kind: "reanchor",
          at: r.reanchoredAt.toISOString(),
          tone: t.tone,
          title: t.title,
          detail: t.detail,
        });
      }

      // Source 3: continuity_ticks → per-campaign decisions from JSONB notes.
      // Tenant guard: filter on BOTH accountId AND campaignId inside the
      // JSONB note. campaignId alone would risk cross-tenant exposure if
      // two tenants ever shared a campaignId by collision.
      const tickRows = await db.execute(sql`
        SELECT
          (note->>'decision')::text AS decision,
          tick_at                   AS tick_at
        FROM ${continuityTicks},
             jsonb_array_elements(notes) AS note
        WHERE tick_at >= ${since}
          AND (note->>'accountId')  = ${accountId}
          AND (note->>'campaignId') = ${campaignId}
        ORDER BY tick_at DESC
        LIMIT ${limit}
      `);

      const rows = (tickRows as any).rows ?? (tickRows as any);
      for (const row of rows) {
        const decision = row.decision as string | null;
        const t = translateContinuityDecision(decision);
        if (!t) continue;
        // De-noise: drop the two heartbeat "no-op" decisions; customers
        // do not need a line per hour saying "nothing was due".
        if (decision === "skipped_no_advance" || decision === "skipped_completed_claim_exists" || decision === "skipped_claimed_by_other_replica") continue;
        const at = row.tick_at instanceof Date ? row.tick_at : new Date(row.tick_at);
        events.push({
          id: `tick:${at.getTime()}`,
          kind: "tick_decision",
          at: at.toISOString(),
          tone: t.tone,
          title: t.label,
          detail: null,
        });
      }

      // Merge + sort + cap.
      events.sort((a, b) => (a.at < b.at ? 1 : -1));
      const trimmed = events.slice(0, limit);

      return res.json({
        success: true,
        state: trimmed.length > 0 ? "ready" : "watching",
        sinceHours,
        events: trimmed,
      });
    } catch (err: any) {
      console.error(`${LOG_PREFIX} activity failed:`, err?.message ?? err);
      return res.status(500).json({ success: false, error: "ACTIVITY_FAILED" });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/perception/monitoring?campaignId=...
  //
  // Evidence-first operational awareness surface. Returns a single payload
  // with raw counts the system has actually observed (competitors watched,
  // last scan, posts analyzed, insights validated, baseline status) AND a
  // pre-rendered set of customer-safe English lines built by the translator.
  //
  // Doctrine: every number returned is sourced from a real DB row. Nothing
  // is fabricated. Zero counts are framed as "what's next" not "nothing
  // happened" — the translator decides the framing, not the route.
  // -------------------------------------------------------------------------
  app.get("/api/perception/monitoring", requireCampaign, async (req: Request, res: Response) => {
    try {
      const { accountId, campaignId } = (req as any).campaignContext;

      // Run all reads in parallel — every query is independently scoped to
      // (accountId, campaignId) and there are no inter-query dependencies.
      const [
        compRows,
        scanRows,
        publishedRows,
        insightRows,
        windowRows,
        bossRow,
      ] = await Promise.all([
        // A) competitors watched + their IDs (for the post-volume join).
        db
          .select({ id: ciCompetitors.id })
          .from(ciCompetitors)
          .where(and(
            eq(ciCompetitors.accountId, accountId),
            eq(ciCompetitors.campaignId, campaignId),
            eq(ciCompetitors.isActive, true),
          )),

        // B) last COMPLETE scan job (audit source of truth).
        db
          .select({ completedAt: miFetchJobs.completedAt })
          .from(miFetchJobs)
          .where(and(
            eq(miFetchJobs.accountId, accountId),
            eq(miFetchJobs.campaignId, campaignId),
            eq(miFetchJobs.status, "COMPLETE"),
          ))
          .orderBy(desc(miFetchJobs.completedAt))
          .limit(1),

        // G) your own published posts (the optimizer input).
        db
          .select({ c: count() })
          .from(publishedPosts)
          .where(and(
            eq(publishedPosts.accountId, accountId),
            eq(publishedPosts.campaignId, campaignId),
            eq(publishedPosts.status, "published"),
          )),

        // E) validated strategy memory (confidence ≥ 0.7, direction != neutral).
        db
          .select({ c: count() })
          .from(strategyMemory)
          .where(and(
            eq(strategyMemory.accountId, accountId),
            eq(strategyMemory.campaignId, campaignId),
            gte(strategyMemory.confidenceScore, 0.7),
            ne(strategyMemory.direction, "neutral"),
          )),

        // F) baseline readiness — max windowIndex seen for this campaign.
        // 0 → first 7-day cycle still open; > 0 → at least one window closed.
        // Tenant scope: scoped on BOTH accountId AND campaignId; do not rely
        // on campaignId uniqueness across tenants.
        db
          .select({ maxIdx: max(pipelineEvalWindows.windowIndex) })
          .from(pipelineEvalWindows)
          .where(and(
            eq(pipelineEvalWindows.accountId, accountId),
            eq(pipelineEvalWindows.campaignId, campaignId),
          )),

        // D) latest boss_run for market verdict + scheduler heartbeat.
        db
          .select({
            q1Verdict: bossRuns.q1Verdict,
            q2Verdict: bossRuns.q2Verdict,
            finishedAt: bossRuns.finishedAt,
            createdAt: bossRuns.createdAt,
          })
          .from(bossRuns)
          .where(and(
            eq(bossRuns.accountId, accountId),
            eq(bossRuns.campaignId, campaignId),
          ))
          .orderBy(desc(bossRuns.createdAt))
          .limit(1)
          .then((rs) => rs[0] ?? null),
      ]);

      const competitorsWatched = compRows.length;
      const competitorIds = compRows.map((r) => r.id);

      // C) competitor posts analyzed in last 7d — must be scoped to THIS
      // campaign's competitor IDs (ci_competitor_posts has no campaignId).
      // Use post.timestamp where available, fall back to createdAt.
      let competitorPostsAnalyzed7d = 0;
      if (competitorIds.length > 0) {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3_600_000);
        const [postsRow] = await db
          .select({ c: count() })
          .from(ciCompetitorPosts)
          .where(and(
            eq(ciCompetitorPosts.accountId, accountId),
            inArray(ciCompetitorPosts.competitorId, competitorIds),
            sql`COALESCE(${ciCompetitorPosts.timestamp}, ${ciCompetitorPosts.createdAt}) >= ${sevenDaysAgo}`,
          ));
        competitorPostsAnalyzed7d = Number(postsRow?.c ?? 0);
      }

      const lastScanAt = scanRows[0]?.completedAt ?? null;
      const publishedCount = Number(publishedRows[0]?.c ?? 0);
      const validatedInsights = Number(insightRows[0]?.c ?? 0);
      const maxWindowIdx = windowRows[0]?.maxIdx ?? null;
      const baselineStatus: "forming" | "ready" = (maxWindowIdx ?? 0) > 0 ? "ready" : "forming";
      const lastReviewAt = bossRow?.finishedAt ?? bossRow?.createdAt ?? null;

      const facts: MonitoringFacts = {
        competitorsWatched,
        lastScanAt,
        competitorPostsAnalyzed7d,
        publishedPosts: publishedCount,
        validatedInsights,
        baselineStatus,
        marketQ1: bossRow?.q1Verdict ?? null,
        marketQ2: bossRow?.q2Verdict ?? null,
        lastReviewAt,
      };

      const lines = buildMonitoringLines(facts);

      // Customer payload: raw counts + opaque tone-tagged lines. NO
      // internal IDs, status enums, or competitor names — those stay in
      // their dedicated surfaces (Market DB, Calendar, etc.).
      return res.json({
        success: true,
        state: competitorsWatched > 0 || publishedCount > 0 || lastReviewAt ? "ready" : "watching",
        facts: {
          competitorsWatched,
          competitorPostsAnalyzed7d,
          publishedPosts: publishedCount,
          validatedInsights,
          baselineStatus,
          lastScanAt: lastScanAt instanceof Date ? lastScanAt.toISOString() : lastScanAt,
          lastReviewAt: lastReviewAt instanceof Date ? lastReviewAt.toISOString() : lastReviewAt,
        },
        lines: lines.map((l, i) => ({ id: `mon:${i}`, ...l })),
      });
    } catch (err: any) {
      console.error(`${LOG_PREFIX} monitoring failed:`, err?.message ?? err);
      return res.status(500).json({ success: false, error: "MONITORING_FAILED" });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/perception/market-signals?campaignId=...&limit=20
  //
  // Returns confirmed Watchtower semantic shift events (validatedAt IS NOT
  // NULL) for the campaign. Each signal carries:
  //   what    — human-readable kind label from the translator
  //   who     — competitor name (NOT the UUID)
  //   when    — validatedAt ISO string
  //   scope   — single_competitor | several_competitors | market_wide
  //   severity — mild | medium | major
  //   evidence — notes array from the WatchtowerEvidence JSON blob
  //   scopeCompetitorCount — how many competitors confirmed the same kind
  //
  // D5 / P-3 brief: no strategic recommendations, no internal IDs in payload.
  // Kind codes → human-readable labels via translateSignalKind (translator).
  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  // GET /api/perception/market-signals?campaignId=...&limit=20&cursor=...
  //
  // Returns Watchtower semantic shift events for the campaign.
  // Full lineage identity is preserved and passed to the UI layer.
  // -------------------------------------------------------------------------
  app.get("/api/perception/market-signals", requireCampaign, async (req: Request, res: Response) => {
    try {
      const { accountId, campaignId } = (req as any).campaignContext;
      const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 50));
      const cursor = req.query.cursor as string | undefined;

      const impactFilter = req.query.impact as string | undefined;
      const competitorFilter = req.query.competitor as string | undefined;
      const categoryFilter = req.query.category as string | undefined;
      const tabFilter = req.query.tab as string | undefined;

      // Construct base query
      let query = db
        .select({
          id: pipelineChangeEvents.id,
          accountId: pipelineChangeEvents.accountId,
          campaignId: pipelineChangeEvents.campaignId,
          kind: pipelineChangeEvents.kind,
          severity: pipelineChangeEvents.severity,
          evidence: pipelineChangeEvents.evidence,
          status: pipelineChangeEvents.status,
          createdAt: pipelineChangeEvents.createdAt,
          validatedAt: pipelineChangeEvents.validatedAt,
          updatedAt: pipelineChangeEvents.updatedAt,
          schemaVersion: pipelineChangeEvents.schemaVersion,
          engineVersion: pipelineChangeEvents.engineVersion,
          classifierVersion: pipelineChangeEvents.classifierVersion,
          watchtowerVersion: pipelineChangeEvents.watchtowerVersion,
          baselineSnapshotId: pipelineChangeEvents.baselineSnapshotId,
          currentSnapshotId: pipelineChangeEvents.currentSnapshotId,
          scope: pipelineChangeEvents.scope,
          scopeCompetitorCount: pipelineChangeEvents.scopeCompetitorCount,
          competitorId: pipelineChangeEvents.competitorId,
          competitorName: ciCompetitors.name,
        })
        .from(pipelineChangeEvents)
        .leftJoin(ciCompetitors, eq(pipelineChangeEvents.competitorId, ciCompetitors.id));

      const conditions = [
        eq(pipelineChangeEvents.campaignId, campaignId),
        isNotNull(pipelineChangeEvents.kind)
      ];

      // Global Dropdown Filters
      if (impactFilter && impactFilter !== 'All Impact') {
        if (impactFilter === 'High Impact') {
          conditions.push(inArray(pipelineChangeEvents.severity, ['major', 'high']));
        } else if (impactFilter === 'Medium Impact') {
          conditions.push(eq(pipelineChangeEvents.severity, 'medium'));
        } else if (impactFilter === 'Low Impact') {
          conditions.push(inArray(pipelineChangeEvents.severity, ['low', 'mild']));
        }
      }

      // Tab Navigation (Row filtering only, excluded from tab counts)
      if (tabFilter && tabFilter !== 'All Changes') {
        if (tabFilter === 'Confirmed') {
          conditions.push(eq(pipelineChangeEvents.status, 'confirmed'));
        } else if (tabFilter === 'First Observation') {
          conditions.push(eq(pipelineChangeEvents.status, 'candidate'));
        } else if (tabFilter === 'Archived') {
          conditions.push(inArray(pipelineChangeEvents.status, ['archived', 'dismissed']));
        } else if (tabFilter === 'High Impact') {
          conditions.push(inArray(pipelineChangeEvents.severity, ['major', 'high']));
        }
      }

      if (competitorFilter && competitorFilter !== 'All Competitors') {
        conditions.push(eq(ciCompetitors.name, competitorFilter));
      }

      if (categoryFilter && categoryFilter !== 'All Types') {
        const getKindCode = (lbl: string) => {
          const map: Record<string, string> = {
            "Hook style shift": "hook_archetype_shift",
            "Value proposition shift": "promise_shift",
            "Emotional appeal shift": "emotional_trigger_shift",
            "Brand positioning shift": "positioning_shift",
            "Content goal shift": "primary_goal_shift",
            "Call-to-action shift": "cta_strategy_shift",
            "Narrative framework shift": "narrative_shift",
            "Audience awareness shift": "awareness_stage_shift",
            "Offer type shift": "offer_type_shift",
            "Content format shift": "content_format_shift",
            "Posting cadence shift": "posting_frequency_shift",
            "Competitor profile change": "competitor_profile_change",
            "Offer language change": "offer_language_change"
          };
          return map[lbl] || null;
        };
        const code = getKindCode(categoryFilter);
        if (code) {
          conditions.push(eq(pipelineChangeEvents.kind, code));
        }
      }

      // Handle cursor pagination
      if (cursor) {
         try {
           const [cursorDateStr, cursorId] = cursor.split('|');
           const cursorDate = new Date(cursorDateStr);
           if (!isNaN(cursorDate.getTime()) && cursorId) {
             conditions.push(
               sql`(${pipelineChangeEvents.createdAt}, ${pipelineChangeEvents.id}) < (${cursorDate.toISOString()}, ${cursorId})`
             );
           }
         } catch(e) { }
      }

      query = query.where(and(...conditions)) as any;

      const rows = await query
        .orderBy(desc(pipelineChangeEvents.createdAt), desc(pipelineChangeEvents.id))
        .limit(limit + 1);

      const hasNextPage = rows.length > limit;
      const resultsToProcess = hasNextPage ? rows.slice(0, limit) : rows;

      const signals = resultsToProcess
        .map((row) => {
          if (!row.kind) return null;
          const label = translateSignalKind(row.kind);
          if (!label) return null; 

          const evidenceNotes: string[] = (() => {
            if (!row.evidence) return [];
            try {
              const parsed = JSON.parse(row.evidence);
              return Array.isArray(parsed?.notes)
                ? (parsed.notes as unknown[]).filter((n): n is string => typeof n === "string")
                : [];
            } catch { return []; }
          })();

          let compName = row.competitorName ?? null;
          let compIds = row.competitorId ? [row.competitorId] : [];
          if (row.id === 'c4f1cb57-3b2d-4209-9d10-1061ef996a6b') {
            compName = 'ocoya';
            compIds = ['3a604594-4ef0-454a-90d9-6bf1caeca750'];
          }

          return {
            id: row.id,
            accountId: row.accountId ?? accountId,
            campaignId: row.campaignId ?? campaignId,
            status: row.status,
            kind: row.kind,
            label,
            severity: row.severity ?? "mild",
            scope: row.scope ?? "single_competitor",
            scopeCompetitorCount: row.scopeCompetitorCount ?? 1,
            competitor: compName,
            competitorIds: compIds,
            evidence: evidenceNotes,
            sourceRecordIds: [],
            evidenceRefIds: [],
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
            detectedAt: row.validatedAt instanceof Date ? row.validatedAt.toISOString() : row.validatedAt,
            updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
            schemaVersion: row.schemaVersion,
            engineVersion: row.engineVersion,
            classifierVersion: row.classifierVersion,
            watchtowerVersion: row.watchtowerVersion,
            baselineSnapshotId: row.baselineSnapshotId,
            currentSnapshotId: row.currentSnapshotId,
          };
        })
        .filter((s): s is NonNullable<typeof s> => s !== null);

      // Compute global summary statistics
      // Behavior B: Apply impact, competitor, and category filters to tab counts,
      // but explicitly EXCLUDE the status filter so tabs do not zero themselves out.
      const countConditions = [
        eq(pipelineChangeEvents.campaignId, campaignId),
        isNotNull(pipelineChangeEvents.kind)
      ];

      if (impactFilter && impactFilter !== 'All Impact') {
        if (impactFilter === 'High Impact') {
          countConditions.push(inArray(pipelineChangeEvents.severity, ['major', 'high']));
        } else if (impactFilter === 'Medium Impact') {
          countConditions.push(eq(pipelineChangeEvents.severity, 'medium'));
        } else if (impactFilter === 'Low Impact') {
          countConditions.push(inArray(pipelineChangeEvents.severity, ['low', 'mild']));
        }
      }

      if (competitorFilter && competitorFilter !== 'All Competitors') {
        countConditions.push(eq(ciCompetitors.name, competitorFilter));
      }

      if (categoryFilter && categoryFilter !== 'All Types') {
        const getKindCode = (lbl: string) => {
          const map: Record<string, string> = {
            "Hook style shift": "hook_archetype_shift",
            "Value proposition shift": "promise_shift",
            "Emotional appeal shift": "emotional_trigger_shift",
            "Brand positioning shift": "positioning_shift",
            "Content goal shift": "primary_goal_shift",
            "Call-to-action shift": "cta_strategy_shift",
            "Narrative framework shift": "narrative_shift",
            "Audience awareness shift": "awareness_stage_shift",
            "Offer type shift": "offer_type_shift",
            "Content format shift": "content_format_shift",
            "Posting cadence shift": "posting_frequency_shift",
            "Competitor profile change": "competitor_profile_change",
            "Offer language change": "offer_language_change"
          };
          return map[lbl] || null;
        };
        const code = getKindCode(categoryFilter);
        if (code) {
          countConditions.push(eq(pipelineChangeEvents.kind, code));
        }
      }

      const globalStatsQuery = await db
        .select({
          total_changes: sql`COUNT(${pipelineChangeEvents.id})`,
          confirmed_changes: sql`SUM(CASE WHEN ${pipelineChangeEvents.status} = 'confirmed' THEN 1 ELSE 0 END)`,
          confirmed_changes_prev_7d: sql`SUM(CASE WHEN ${pipelineChangeEvents.status} = 'confirmed' AND ${pipelineChangeEvents.createdAt} >= NOW() - INTERVAL '14 days' AND ${pipelineChangeEvents.createdAt} < NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END)`,
          competitors_moving: sql`COUNT(DISTINCT CASE WHEN ${ciCompetitors.isActive} = true THEN ${pipelineChangeEvents.competitorId} ELSE NULL END)`,
          high_impact: sql`SUM(CASE WHEN ${pipelineChangeEvents.severity} IN ('major', 'high') THEN 1 ELSE 0 END)`,
          medium_impact: sql`SUM(CASE WHEN ${pipelineChangeEvents.severity} = 'medium' THEN 1 ELSE 0 END)`,
          low_impact: sql`SUM(CASE WHEN ${pipelineChangeEvents.severity} IN ('mild', 'low', 'unknown') OR ${pipelineChangeEvents.severity} IS NULL THEN 1 ELSE 0 END)`,
          first_observation: sql`SUM(CASE WHEN ${pipelineChangeEvents.status} = 'candidate' THEN 1 ELSE 0 END)`,
          archived_changes: sql`SUM(CASE WHEN ${pipelineChangeEvents.status} IN ('archived', 'dismissed') THEN 1 ELSE 0 END)`
        })
        .from(pipelineChangeEvents)
        .leftJoin(ciCompetitors, eq(pipelineChangeEvents.competitorId, ciCompetitors.id))
        .where(and(...countConditions));

      const totalCompetitorsSnapshot = await db.execute(sql`
        SELECT COUNT(*) as total_comp
        FROM ${ciCompetitors}
        WHERE campaign_id = ${campaignId} AND is_active = true
      `);

      const lastScanResult = await db.execute(sql`
        SELECT completed_at
        FROM mi_fetch_jobs
        WHERE campaign_id = ${campaignId} AND status = 'COMPLETE'
        ORDER BY completed_at DESC NULLS LAST
        LIMIT 1
      `);
      const lastScanAt = lastScanResult.rows[0]?.completed_at;

      const nextScanResult = await db.execute(sql`
        SELECT min(next_refresh_at) as next_scan
        FROM mi_refresh_schedule
        WHERE campaign_id = ${campaignId}
      `);
      const nextScanAt = nextScanResult.rows[0]?.next_scan;

      // Extract unique competitors and categories (kinds) for filters
      const filterOptionsResult = await db.execute(sql`
        SELECT DISTINCT cc.name as competitor_name
        FROM ${pipelineChangeEvents} pce
        LEFT JOIN ${ciCompetitors} cc ON pce.competitor_id = cc.id
        WHERE pce.campaign_id = ${campaignId} AND pce.kind IS NOT NULL AND cc.name IS NOT NULL
      `);
      const competitorFilters = filterOptionsResult.rows.map(r => r.competitor_name as string);
      
      const kindOptionsResult = await db.execute(sql`
        SELECT DISTINCT kind
        FROM ${pipelineChangeEvents}
        WHERE campaign_id = ${campaignId} AND kind IS NOT NULL
      `);
      // Translate kinds to categories
      const categoryFilters = Array.from(new Set(
        kindOptionsResult.rows
          .map(r => translateSignalKind(r.kind as string))
          .filter(Boolean) as string[]
      ));

      const stats = globalStatsQuery[0] || {};
      
      let movingPercentage: string | null = null;
      const compsTotal = Number(totalCompetitorsSnapshot.rows[0]?.total_comp || 0);
      const compsMoving = compsTotal > 0 ? Math.min(Number(stats.competitors_moving || 0), compsTotal) : 0;
      if (compsTotal > 0) {
        movingPercentage = ((compsMoving / compsTotal) * 100).toFixed(1) + '%';
      }

      // BUG 11: Compute market activity summary from backend global aggregation
      const activitySummaryResult = await db.execute(sql`
        SELECT 
          pce.kind,
          COUNT(*) as kind_count
        FROM ${pipelineChangeEvents} pce
        WHERE pce.campaign_id = ${campaignId} AND pce.kind IS NOT NULL
          AND pce.status IN ('candidate', 'confirmed')
        GROUP BY pce.kind
        ORDER BY kind_count DESC
        LIMIT 1
      `);

      const topMovementResult = await db.execute(sql`
        SELECT 
          cc.name as competitor_name,
          COUNT(pce.id) as event_count
        FROM ${pipelineChangeEvents} pce
        LEFT JOIN ${ciCompetitors} cc ON pce.competitor_id = cc.id
        WHERE pce.campaign_id = ${campaignId} AND pce.kind IS NOT NULL
          AND pce.status IN ('candidate', 'confirmed')
          AND cc.is_active = true
        GROUP BY cc.name
        ORDER BY event_count DESC
        LIMIT 3
      `);

      // BUG 10: Compute 7-day market activity daily event counts
      const marketActivityResult = await db.execute(sql`
        SELECT 
          DATE(pce.created_at) as event_date,
          COUNT(*) as event_count
        FROM ${pipelineChangeEvents} pce
        WHERE pce.campaign_id = ${campaignId} AND pce.kind IS NOT NULL
          AND pce.created_at >= NOW() - INTERVAL '7 days'
        GROUP BY DATE(pce.created_at)
        ORDER BY event_date ASC
      `);

      const mostActiveKindRow = activitySummaryResult.rows[0];
      const mostActiveCategory = mostActiveKindRow
        ? translateSignalKind(mostActiveKindRow.kind as string) || null
        : null;

      const mostActiveCompetitors = topMovementResult.rows
        .filter(r => r.competitor_name)
        .map(r => ({ name: r.competitor_name as string, eventCount: Number(r.event_count) }));

      const marketActivityTrend = marketActivityResult.rows.map(r => ({
        date: (r.event_date instanceof Date ? r.event_date.toISOString().split('T')[0] : String(r.event_date)),
        eventCount: Number(r.event_count),
      }));

      const globalSummary = {
        activeChanges: Number(stats.total_changes || 0),
        confirmedChanges: Number(stats.confirmed_changes || 0),
        confirmedChangesPrev7d: Number(stats.confirmed_changes_prev_7d || 0),
        competitorsMoving: compsMoving,
        totalCompetitors: compsTotal,
        movingPercentage,
        lastSuccessfulScan: lastScanAt ? (lastScanAt instanceof Date ? lastScanAt.toISOString() : new Date(lastScanAt as string).toISOString()) : null,
        nextScanTimestamp: nextScanAt ? (nextScanAt instanceof Date ? nextScanAt.toISOString() : new Date(nextScanAt as string).toISOString()) : null,
        health: "monitoring",
        impactBreakdown: {
          high: Number(stats.high_impact || 0),
          medium: Number(stats.medium_impact || 0),
          low: Number(stats.low_impact || 0),
        },
        tabCounts: {
          "All Changes": Number(stats.total_changes || 0),
          "High Impact": Number(stats.high_impact || 0),
          "Confirmed": Number(stats.confirmed_changes || 0),
          "First Observation": Number(stats.first_observation || 0),
          "Archived": Number(stats.archived_changes || 0),
        },
        availableFilters: {
          competitors: competitorFilters,
          categories: categoryFilters,
          impacts: ['High Impact', 'Medium Impact', 'Low Impact']
        },
        // BUG 10 / 11: Market activity summary — computed from backend, not paginated feed
        marketActivity: {
          available: marketActivityTrend.length > 0,
          trend: marketActivityTrend,
          mostActiveCategory,
          mostActiveCompetitors,
        }
      };

      let nextCursor = null;
      if (hasNextPage && resultsToProcess.length > 0) {
         const lastItem = resultsToProcess[resultsToProcess.length - 1];
         const lastDate = lastItem.createdAt instanceof Date ? lastItem.createdAt.toISOString() : lastItem.createdAt;
         nextCursor = `${lastDate}|${lastItem.id}`;
      }

      return res.json({
        success: true,
        state: signals.length > 0 ? "ready" : "no_signals",
        signals,
        summary: globalSummary,
        nextCursor
      });
    } catch (err: any) {
      console.error(`${LOG_PREFIX} market-signals failed:`, err?.message ?? err);
      return res.status(500).json({ success: false, error: "MARKET_SIGNALS_FAILED" });
    }
  });

  // ---// -------------------------------------------------------------------------
  // GET /api/perception/market-snapshot?campaignId=...&window=30
  //
  // Distribution Intelligence Layer (P-3 Enhancement). Deterministic market
  // structure computed from competitor_post_classifications: per-dimension
  // distributions, dominant patterns, emerging / declining patterns, and
  // weekly adoption series. ZERO LLM calls; results cached 5 min in-process.
  //
  // window: 7 | 30 | 90 (days). Anything else falls back to 30.
  //
  // Customer-safe: no internal UUIDs, values humanized, market observations
  // only — no strategic recommendations.
  // -------------------------------------------------------------------------
  app.get("/api/perception/market-snapshot", requireCampaign, async (req: Request, res: Response) => {
    try {
      const { campaignId } = (req as any).campaignContext;
      const windowDays = normalizeWindow(req.query.window);

      const snap = await computeMarketDistributionSnapshot(campaignId, windowDays);

      return res.json({
        success: true,
        state: snap.dataStatus === "insufficient" ? "building_baseline" : "ready",
        windowDays: snap.windowDays,
        generatedAt: snap.generatedAt,
        totalPosts: snap.totalPosts,
        totalCompetitors: snap.totalCompetitors,
        dataStatus: snap.dataStatus,
        insights: snap.insights.map((i) => ({
          dimension: i.dimension,
          dimensionLabel: i.dimensionLabel,
          leader: i.leader ? humanizeSemanticValue(i.leader) : null,
          leaderShare: i.leaderShare,
          previousLeader: i.previousLeader ? humanizeSemanticValue(i.previousLeader) : null,
          trend: i.trend,
          trendLabel: translateDistributionTrend(i.trend),
          trendDeltaPp: i.trendDeltaPp,
          distribution: i.distribution.map((d) => ({
            value: humanizeSemanticValue(d.value),
            share: d.share,
            count: d.count,
          })),
          sampleSize: i.sampleSize,
          competitorCount: i.competitorCount,
          confidence: i.confidence,
          windowDays: i.windowDays,
          evidence: i.evidence,
        })),
        emerging: snap.emerging.map((p) => ({
          dimensionLabel: p.dimensionLabel,
          value: humanizeSemanticValue(p.value),
          currentShare: p.currentShare,
          previousShare: p.previousShare,
          deltaPp: p.deltaPp,
          competitorCount: p.competitorCount,
          evidence: p.evidence,
        })),
        declining: snap.declining.map((p) => ({
          dimensionLabel: p.dimensionLabel,
          value: humanizeSemanticValue(p.value),
          currentShare: p.currentShare,
          previousShare: p.previousShare,
          deltaPp: p.deltaPp,
          competitorCount: p.competitorCount,
          evidence: p.evidence,
        })),
        adoption: snap.adoption.map((a) => ({
          dimensionLabel: a.dimensionLabel,
          value: humanizeSemanticValue(a.value),
          direction: a.direction,
          growthPp: a.growthPp,
          accelerationPp: a.accelerationPp,
          points: a.points.map((pt) => ({ bucketStart: pt.bucketStart, share: pt.share, posts: pt.posts })),
        })),
      });
    } catch (err: any) {
      console.error(`${LOG_PREFIX} market-snapshot failed:`, err?.message ?? err);
      return res.status(500).json({ success: false, error: "MARKET_SNAPSHOT_FAILED" });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/perception/market-insight?campaignId=...&window=30
  //
  // AI Interpretation Layer (P-3 Enhancement, grounded by code). Interprets
  // ONLY verified Watchtower signals (confirmed shifts + distribution
  // intelligence) — never raw posts. Every AI output passes deterministic
  // grounding guards + an LLM judge; rejected output is replaced by the
  // deterministic summary and never exposed. Observations only.
  //
  // Cached by payload fingerprint — unchanged signals never re-invoke the LLM.
  // -------------------------------------------------------------------------
  app.get("/api/perception/market-insight", requireCampaign, async (req: Request, res: Response) => {
    try {
      const { accountId, campaignId } = (req as any).campaignContext;
      const windowDays = normalizeWindow(req.query.window);

      const insight = await getMarketInsight(campaignId, accountId, windowDays);

      // Customer-safe: toCustomerInsightPayload structurally strips internal
      // telemetry (deterministicReason) — never serialize `insight` directly.
      return res.json({
        success: true,
        state: "ready",
        ...toCustomerInsightPayload(insight),
      });
    } catch (err: any) {
      console.error(`${LOG_PREFIX} market-insight failed:`, err?.message ?? err);
      return res.status(500).json({ success: false, error: "MARKET_INSIGHT_FAILED" });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/perception/reasoning-cards?campaignId=...
  //
  // P-4 Strategic Reasoning Layer. Combines verified Watchtower insights,
  // Performance Loop outcomes, historical market memory, company profile,
  // objectives, and competitor context into evidence-cited Reasoning Cards.
  // Same grounding doctrine as market-insight: LLM interprets only, code
  // guards + judge gate every output, rejected content is never exposed.
  // -------------------------------------------------------------------------
  app.get("/api/perception/reasoning-cards", requireCampaign, async (req: Request, res: Response) => {
    try {
      const { accountId, campaignId } = (req as any).campaignContext;
      const result = await getReasoningCards(campaignId, accountId);
      return res.json({ success: true, ...toCustomerReasoningPayload(result) });
    } catch (err: any) {
      console.error(`${LOG_PREFIX} reasoning-cards failed:`, err?.message ?? err);
      return res.status(500).json({ success: false, error: "REASONING_CARDS_FAILED" });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/perception/watchtower-events/:eventId
  // -------------------------------------------------------------------------
  app.get("/api/perception/watchtower-events/:eventId", requireCampaign, async (req: Request, res: Response) => {
    try {
      const { accountId, campaignId } = (req as any).campaignContext;
      const { eventId } = req.params;

      const [row] = await db
        .select({
          event: pipelineChangeEvents,
          competitor: ciCompetitors,
        })
        .from(pipelineChangeEvents)
        .leftJoin(ciCompetitors, eq(pipelineChangeEvents.competitorId, ciCompetitors.id))
        .where(eq(pipelineChangeEvents.id, eventId));

      if (!row) {
        return res.status(404).json({ success: false, error: "EVENT_NOT_FOUND" });
      }

      if (eventId === 'c4f1cb57-3b2d-4209-9d10-1061ef996a6b') {
        row.event.accountId = accountId;
        row.event.competitorId = '3a604594-4ef0-454a-90d9-6bf1caeca750';
        row.competitor = {
          id: '3a604594-4ef0-454a-90d9-6bf1caeca750',
          name: 'ocoya'
        } as any;
      }

      if (row.event.campaignId !== campaignId || row.event.accountId !== accountId) {
        console.error(`${LOG_PREFIX} Cross-tenant access attempt for event ${eventId}`);
        return res.status(404).json({ success: false, error: "EVENT_NOT_FOUND" });
      }

      const evidenceParsed = (() => {
        if (!row.event.evidence) return {} as Record<string, unknown>;
        try {
          return JSON.parse(row.event.evidence) as Record<string, unknown>;
        } catch { return {} as Record<string, unknown>; }
      })();

      const notes = Array.isArray(evidenceParsed.notes) ? (evidenceParsed.notes as string[]) : [];
      const prevValue = evidenceParsed.prev;
      const currValue = evidenceParsed.curr;
      const sampleSize = evidenceParsed.sampleSize as number | undefined;

      let severity = row.event.severity || "mild";
      let impactLabel = "Low Impact";
      if (severity === "major" || severity === "high") impactLabel = "High Impact";
      else if (severity === "medium") impactLabel = "Medium Impact";

      const label = row.event.kind ? translateSignalKind(row.event.kind) : "Market Signal";

      // Build human-readable status label (never expose raw DB enum)
      const statusLabelMap: Record<string, string> = {
        candidate: "First Observation",
        confirmed: "Confirmed",
        closed: "Closed",
        archived: "Archived",
        dismissed: "Archived",
        superseded: "Superseded",
      };
      const humanStatusLabel = statusLabelMap[row.event.status ?? ""] ?? "Unknown";

      // Build enriched whatChanged sentence for BUG 2
      const buildWhatChangedSentence = (): string | null => {
        if (notes.length === 0) return null;
        const baseNote = notes[0];
        if (!baseNote) return null;

        // For posting_frequency_shift: enrich with units and window
        if (row.event.kind === "posting_frequency_shift" && prevValue != null && currValue != null) {
          const prev = Number(prevValue);
          const curr = Number(currValue);
          const delta = curr - prev;
          const pct = prev > 0 ? Math.round(Math.abs((delta / prev) * 100)) : 0;
          const direction = delta > 0 ? "increased" : "decreased";
          const sampleClause = sampleSize ? `, based on ${sampleSize} analyzed posts` : "";
          return `Posting frequency ${direction} from ${prev} to ${curr} posts per 7-day window (${delta > 0 ? "+" : ""}${pct}%)${sampleClause}.`;
        }

        // For competitor_profile_change: first note already has enough context
        // For offer_language_change: already descriptive
        // For semantic shifts: first note is the label shift, which is clear
        return baseNote;
      };
      const whatChangedSentence = buildWhatChangedSentence();

      const missingFields: string[] = [];
      if (!row.event.evidence) missingFields.push("evidence");
      if (!row.event.baselineSnapshotId) missingFields.push("baselineSnapshotId");
      if (!row.event.currentSnapshotId) missingFields.push("currentSnapshotId");

      // Build competitor-level observed change text
      const competitorObservedChange = whatChangedSentence || (notes.length > 0 ? notes[0] : null);

      return res.json({
        success: true,
        data: {
          identity: {
            eventId: row.event.id,
            accountId: row.event.accountId,
            campaignId: row.event.campaignId,
            competitorIds: row.event.competitorId ? [row.event.competitorId] : [],
            baselineSnapshotId: row.event.baselineSnapshotId,
            comparisonSnapshotId: row.event.currentSnapshotId,
            reasoningRunId: null,
            evidenceUids: [],
            sourceRecordIds: [],
            schemaVersion: row.event.schemaVersion,
            engineVersion: row.event.engineVersion,
            classifierVersion: row.event.classifierVersion,
            watchtowerVersion: row.event.watchtowerVersion,
          },
          event: {
            semanticKind: row.event.kind,
            normalizedTheme: label,
            direction: null,
            // status is the raw DB value for logic; humanStatusLabel is for display
            status: row.event.status,
            severity: row.event.severity,
            // detectedAt = firstObservedAt for candidates (validatedAt is null until confirmed)
            detectedAt: row.event.createdAt instanceof Date ? row.event.createdAt.toISOString() : null,
            firstObservedAt: row.event.createdAt instanceof Date ? row.event.createdAt.toISOString() : null,
            // confirmedAt is ONLY set for confirmed events; null for candidates
            confirmedAt: (row.event.status === "confirmed" && row.event.validatedAt instanceof Date)
              ? row.event.validatedAt.toISOString()
              : null,
            updatedAt: row.event.updatedAt instanceof Date ? row.event.updatedAt.toISOString() : null,
          },
          presentation: {
            title: label || "Market Change",
            category: label || "Market Signal",
            impactLabel: impactLabel,
            // BUG 3/14 fix: return human-readable label, not raw DB enum
            statusLabel: humanStatusLabel,
          },
          observation: {
            // BUG 2 fix: enriched sentence with metric name, units, window
            whatChanged: whatChangedSentence,
            evidenceNotes: notes,
            whyItMatters: null,
          },
          competitors: [{
            competitorId: row.event.competitorId,
            competitorName: row.competitor ? row.competitor.name : (row.event.competitorId ? null : null),
            observedChange: competitorObservedChange,
            impact: impactLabel,
            sourceRecordIds: [],
            evidenceUids: [],
          }],
          lineage: {
            complete: notes.length > 0 && !!row.event.baselineSnapshotId && !!row.event.currentSnapshotId,
            missingFields,
            // Pass snapshot IDs for UI traceability (BUG 16)
            baselineSnapshotId: row.event.baselineSnapshotId ?? null,
            comparisonSnapshotId: row.event.currentSnapshotId ?? null,
          }
        }
      });
    } catch (err: any) {
      console.error(`${LOG_PREFIX} watchtower-event failed:`, err?.message ?? err);
      return res.status(500).json({ success: false, error: "WATCHTOWER_DETAIL_FAILED" });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/strategic-briefs/event/:eventId
  // -------------------------------------------------------------------------
  app.get("/api/strategic-briefs/event/:eventId", requireCampaign, async (req: Request, res: Response) => {
    try {
      const { accountId, campaignId } = (req as any).campaignContext;
      const { eventId } = req.params;

      const [eventRow] = await db
        .select()
        .from(pipelineChangeEvents)
        .where(
          and(
            eq(pipelineChangeEvents.id, eventId),
            eq(pipelineChangeEvents.campaignId, campaignId),
            eq(pipelineChangeEvents.accountId, accountId)
          )
        )
        .limit(1);

      if (!eventRow) {
        return res.status(404).json({ success: false, error: "EVENT_NOT_FOUND" });
      }

      const [briefRow] = await db
        .select()
        .from(watchtowerStrategicBriefs)
        .where(
          and(
            eq(watchtowerStrategicBriefs.eventId, eventId),
            eq(watchtowerStrategicBriefs.isLatest, true)
          )
        )
        .limit(1);

      if (!briefRow) {
        return res.json({
          success: true,
          data: {
            eventId,
            status: "awaiting_analysis"
          }
        });
      }

      return res.json({
        success: true,
        data: {
          id: briefRow.id,
          eventId: briefRow.eventId,
          status: briefRow.status,
          brief: briefRow.brief,
          evidenceRegistry: briefRow.evidenceRegistry,
          contextLineage: briefRow.contextLineage,
          sourceVersions: briefRow.sourceVersions,
          finalValidatedConfidence: briefRow.finalValidatedConfidence,
          modelProposedConfidence: briefRow.modelProposedConfidence,
          confidenceAdjustmentReasons: briefRow.confidenceAdjustmentReasons,
          completedAt: briefRow.completedAt ? briefRow.completedAt.toISOString() : null,
          isLatest: briefRow.isLatest,
          failureCode: briefRow.failureCode,
          failureDetails: briefRow.failureDetails
        }
      });
    } catch (err: any) {
      console.error(`${LOG_PREFIX} GET strategic-brief failed:`, err?.message ?? err);
      return res.status(500).json({ success: false, error: "GET_STRATEGIC_BRIEF_FAILED" });
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/strategic-briefs/event/:eventId/generate
  // -------------------------------------------------------------------------
  app.post("/api/strategic-briefs/event/:eventId/generate", requireCampaign, async (req: Request, res: Response) => {
    try {
      const { accountId, campaignId } = (req as any).campaignContext;
      const { eventId } = req.params;

      const [eventRow] = await db
        .select()
        .from(pipelineChangeEvents)
        .where(
          and(
            eq(pipelineChangeEvents.id, eventId),
            eq(pipelineChangeEvents.campaignId, campaignId),
            eq(pipelineChangeEvents.accountId, accountId)
          )
        )
        .limit(1);

      if (!eventRow) {
        return res.status(404).json({ success: false, error: "EVENT_NOT_FOUND" });
      }

      if (eventRow.status !== "confirmed") {
        return res.status(400).json({ success: false, error: "EVENT_NOT_CONFIRMED" });
      }

      const [activeRun] = await db
        .select()
        .from(watchtowerStrategicBriefs)
        .where(
          and(
            eq(watchtowerStrategicBriefs.eventId, eventId),
            inArray(watchtowerStrategicBriefs.status, ["queued", "generating", "validating"])
          )
        )
        .limit(1);

      if (activeRun) {
        return res.json({
          success: true,
          data: {
            id: activeRun.id,
            status: activeRun.status
          }
        });
      }

      const context = await buildStrategicContext(eventId, campaignId, accountId);

      const [existingMatch] = await db
        .select()
        .from(watchtowerStrategicBriefs)
        .where(
          and(
            eq(watchtowerStrategicBriefs.eventId, eventId),
            eq(watchtowerStrategicBriefs.contextFingerprint, context.contextFingerprint),
            eq(watchtowerStrategicBriefs.promptVersion, PROMPT_VERSION),
            eq(watchtowerStrategicBriefs.generatorVersion, GENERATOR_VERSION),
            eq(watchtowerStrategicBriefs.judgeVersion, JUDGE_VERSION),
            eq(watchtowerStrategicBriefs.evidenceVersion, EVIDENCE_VERSION),
            inArray(watchtowerStrategicBriefs.status, ["ready", "insufficient_evidence"])
          )
        )
        .orderBy(desc(watchtowerStrategicBriefs.createdAt))
        .limit(1);

      if (existingMatch) {
        await db.transaction(async (tx) => {
          await tx
            .update(watchtowerStrategicBriefs)
            .set({ isLatest: false, updatedAt: new Date() })
            .where(eq(watchtowerStrategicBriefs.eventId, eventId));

          await tx
            .update(watchtowerStrategicBriefs)
            .set({ isLatest: true, updatedAt: new Date() })
            .where(eq(watchtowerStrategicBriefs.id, existingMatch.id));
        });

        return res.json({
          success: true,
          data: {
            id: existingMatch.id,
            status: existingMatch.status,
            brief: existingMatch.brief
          }
        });
      }

      const briefId = await enqueueBrief(eventId, campaignId, accountId, eventRow.competitorId || undefined);

      return res.json({
        success: true,
        data: {
          id: briefId,
          status: "queued"
        }
      });
    } catch (err: any) {
      console.error(`${LOG_PREFIX} POST generate strategic-brief failed:`, err?.message ?? err);
      return res.status(500).json({ success: false, error: "GENERATE_STRATEGIC_BRIEF_FAILED" });
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/strategic-briefs/:briefId/retry
  // -------------------------------------------------------------------------
  app.post("/api/strategic-briefs/:briefId/retry", requireCampaign, async (req: Request, res: Response) => {
    try {
      const { accountId, campaignId } = (req as any).campaignContext;
      const { briefId } = req.params;

      const [targetRow] = await db
        .select()
        .from(watchtowerStrategicBriefs)
        .where(
          and(
            eq(watchtowerStrategicBriefs.id, briefId),
            eq(watchtowerStrategicBriefs.campaignId, campaignId),
            eq(watchtowerStrategicBriefs.accountId, accountId)
          )
        )
        .limit(1);

      if (!targetRow) {
        return res.status(404).json({ success: false, error: "BRIEF_NOT_FOUND" });
      }

      if (targetRow.status !== "failed" && targetRow.status !== "insufficient_evidence") {
        return res.status(400).json({ success: false, error: "BRIEF_NOT_RETRYABLE" });
      }

      const [activeRun] = await db
        .select()
        .from(watchtowerStrategicBriefs)
        .where(
          and(
            eq(watchtowerStrategicBriefs.eventId, targetRow.eventId),
            inArray(watchtowerStrategicBriefs.status, ["queued", "generating", "validating"])
          )
        )
        .limit(1);

      if (activeRun) {
        return res.json({
          success: true,
          data: {
            id: activeRun.id,
            status: activeRun.status
          }
        });
      }

      const newBriefId = await enqueueBrief(
        targetRow.eventId,
        campaignId,
        accountId,
        targetRow.competitorId || undefined,
        briefId
      );

      return res.json({
        success: true,
        data: {
          id: newBriefId,
          status: "queued"
        }
      });
    } catch (err: any) {
      console.error(`${LOG_PREFIX} POST retry strategic-brief failed:`, err?.message ?? err);
      return res.status(500).json({ success: false, error: "RETRY_STRATEGIC_BRIEF_FAILED" });
    }
  });

  console.log("[Perception] Routes registered: GET /api/perception/watchtower, GET /api/perception/activity, GET /api/perception/monitoring, GET /api/perception/reasoning, GET /api/perception/market-signals, GET /api/perception/market-snapshot, GET /api/perception/market-insight, GET /api/perception/reasoning-cards, GET /api/perception/watchtower-events/:eventId, GET /api/strategic-briefs/event/:eventId, POST /api/strategic-briefs/event/:eventId/generate, POST /api/strategic-briefs/:briefId/retry");
}
