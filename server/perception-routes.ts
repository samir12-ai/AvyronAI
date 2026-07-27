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
} from "@shared/schema";
import { acceptUserTruth } from "./pipeline/lanes/user/user-truth";
import { evaluateWindowState } from "./pipeline/eval-windows";
import { runPerformanceCycle } from "./performance-loop/cycle-runner";
import { PipelineValidationError } from "./pipeline/errors";
import { eq, and, desc, gte, sql, count, ne, max, inArray } from "drizzle-orm";
import {
  translateQ1Verdict,
  translateQ2Verdict,
  translateFreshness,
  translateBossRunStatus,
  translateReanchorReason,
  translateContinuityDecision,
  translateBlockedReasons,
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

  console.log("[Perception] Routes registered: GET /api/perception/watchtower, GET /api/perception/activity, GET /api/perception/monitoring, GET /api/perception/reasoning");
}
