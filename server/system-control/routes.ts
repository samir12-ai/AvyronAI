import type { Express, Response } from "express";
import { db } from "../db";
import { systemControlVerdicts } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { authMiddleware, resolveAccountId, type AuthRequest } from "../auth";
import { assertCampaignBelongsTo, handleOwnershipError } from "../auth-helpers";
import type { SystemControlVerdict } from "./types";

export async function storeControlVerdict(
  accountId: string,
  campaignId: string,
  jobId: string | undefined,
  verdict: SystemControlVerdict,
): Promise<string> {
  const [row] = await db.insert(systemControlVerdicts).values({
    accountId,
    campaignId,
    jobId: jobId || null,
    verdict: verdict.verdict,
    executionMode: verdict.executionMode,
    blockReasons: JSON.stringify(verdict.blockReasons),
    downgrades: JSON.stringify(verdict.downgrades),
    structuralChecks: JSON.stringify(verdict.structuralChecks),
    contradictions: JSON.stringify(verdict.contradictions),
    repairActions: JSON.stringify(verdict.repairActions),
    repairAttempted: verdict.repairAttempted,
    checksTotal: verdict.structuralChecks.length,
    // Phase R T001: only status==="PASS" counts. Legacy `c.passed` may be true
    // for unverified rows (NOT_REACHED/TIMEOUT/STALE/UNKNOWN/SKIPPED) when a
    // caller forgot to update both fields — that would persist an inflated
    // pass-rate to the dashboard. Use the authoritative status field.
    checksPassed: verdict.structuralChecks.filter(c => c.status === "PASS").length,
    durationMs: verdict.durationMs,
    controlVersion: verdict.controlVersion,
    shadowMode: verdict.shadowMode,
    commercialJudgement: verdict.commercialJudgement ? JSON.stringify(verdict.commercialJudgement) : null,
    recoveryPlan: verdict.recoveryPlan ? JSON.stringify(verdict.recoveryPlan) : null,
  }).returning({ id: systemControlVerdicts.id });

  return row.id;
}

function parseJsonField<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

function formatVerdictRow(row: typeof systemControlVerdicts.$inferSelect) {
  return {
    id: row.id,
    accountId: row.accountId,
    campaignId: row.campaignId,
    jobId: row.jobId,
    verdict: row.verdict,
    executionMode: row.executionMode,
    blockReasons: parseJsonField(row.blockReasons, []),
    downgrades: parseJsonField(row.downgrades, []),
    structuralChecks: parseJsonField(row.structuralChecks, []),
    contradictions: parseJsonField(row.contradictions, []),
    repairActions: parseJsonField(row.repairActions, []),
    repairAttempted: row.repairAttempted,
    checksTotal: row.checksTotal,
    checksPassed: row.checksPassed,
    durationMs: row.durationMs,
    controlVersion: row.controlVersion,
    shadowMode: row.shadowMode,
    commercialJudgement: parseJsonField(row.commercialJudgement, null),
    recoveryPlan: parseJsonField(row.recoveryPlan, null),
    createdAt: row.createdAt,
  };
}

export function registerSystemControlRoutes(app: Express) {
  app.get("/api/system-control/verdicts/:campaignId", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const accountId = resolveAccountId(req);
      const { campaignId } = req.params;
      try { await assertCampaignBelongsTo(accountId, campaignId); }
      catch (e) { if (handleOwnershipError(e, res)) return; throw e; }
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

      const rows = await db.select()
        .from(systemControlVerdicts)
        .where(and(
          eq(systemControlVerdicts.accountId, accountId),
          eq(systemControlVerdicts.campaignId, campaignId),
        ))
        .orderBy(desc(systemControlVerdicts.createdAt))
        .limit(limit);

      res.json({
        verdicts: rows.map(formatVerdictRow),
        total: rows.length,
        campaignId,
      });
    } catch (err: any) {
      console.error("[SystemControl] Verdicts fetch error:", err.message);
      res.status(500).json({ error: "Failed to fetch verdicts" });
    }
  });

  app.get("/api/system-control/latest/:campaignId", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const accountId = resolveAccountId(req);
      const { campaignId } = req.params;
      try { await assertCampaignBelongsTo(accountId, campaignId); }
      catch (e) { if (handleOwnershipError(e, res)) return; throw e; }

      const [row] = await db.select()
        .from(systemControlVerdicts)
        .where(and(
          eq(systemControlVerdicts.accountId, accountId),
          eq(systemControlVerdicts.campaignId, campaignId),
        ))
        .orderBy(desc(systemControlVerdicts.createdAt))
        .limit(1);

      if (!row) {
        return res.json({ hasVerdict: false });
      }

      res.json({ hasVerdict: true, verdict: formatVerdictRow(row) });
    } catch (err: any) {
      console.error("[SystemControl] Latest verdict fetch error:", err.message);
      res.status(500).json({ error: "Failed to fetch latest verdict" });
    }
  });

  app.get("/api/system-control/stats/:campaignId", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const accountId = resolveAccountId(req);
      const { campaignId } = req.params;
      try { await assertCampaignBelongsTo(accountId, campaignId); }
      catch (e) { if (handleOwnershipError(e, res)) return; throw e; }

      const rows = await db.select()
        .from(systemControlVerdicts)
        .where(and(
          eq(systemControlVerdicts.accountId, accountId),
          eq(systemControlVerdicts.campaignId, campaignId),
        ))
        .orderBy(desc(systemControlVerdicts.createdAt))
        .limit(100);

      const stats = {
        total: rows.length,
        byVerdict: { PASS: 0, DOWNGRADE: 0, REPAIR: 0, BLOCK: 0 } as Record<string, number>,
        byExecutionMode: {} as Record<string, number>,
        repairAttempts: rows.filter(r => r.repairAttempted).length,
        avgDurationMs: rows.length > 0 ? Math.round(rows.reduce((s, r) => s + (r.durationMs || 0), 0) / rows.length) : 0,
        avgCheckPassRate: rows.length > 0 ? +(rows.reduce((s, r) => s + ((r.checksPassed || 0) / Math.max(r.checksTotal || 1, 1)), 0) / rows.length).toFixed(3) : 0,
        latestVersion: rows[0]?.controlVersion || null,
        blockCodes: {} as Record<string, number>,
        downgradeCodes: {} as Record<string, number>,
        repairCodes: {} as Record<string, number>,
      };

      for (const row of rows) {
        stats.byVerdict[row.verdict] = (stats.byVerdict[row.verdict] || 0) + 1;
        stats.byExecutionMode[row.executionMode] = (stats.byExecutionMode[row.executionMode] || 0) + 1;

        for (const b of parseJsonField<any[]>(row.blockReasons, [])) {
          stats.blockCodes[b.code] = (stats.blockCodes[b.code] || 0) + 1;
        }
        for (const d of parseJsonField<any[]>(row.downgrades, [])) {
          stats.downgradeCodes[d.code] = (stats.downgradeCodes[d.code] || 0) + 1;
        }
        for (const r of parseJsonField<any[]>(row.repairActions, [])) {
          if (r.executed) {
            stats.repairCodes[r.code] = (stats.repairCodes[r.code] || 0) + 1;
          }
        }
      }

      res.json({ stats, campaignId });
    } catch (err: any) {
      console.error("[SystemControl] Stats fetch error:", err.message);
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  });

  app.get("/api/system-control/recovery/:campaignId", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const accountId = resolveAccountId(req);
      const { campaignId } = req.params;
      try { await assertCampaignBelongsTo(accountId, campaignId); }
      catch (e) { if (handleOwnershipError(e, res)) return; throw e; }

      const [row] = await db.select()
        .from(systemControlVerdicts)
        .where(and(
          eq(systemControlVerdicts.accountId, accountId),
          eq(systemControlVerdicts.campaignId, campaignId),
        ))
        .orderBy(desc(systemControlVerdicts.createdAt))
        .limit(1);

      if (!row) {
        return res.json({ hasRecoveryPlan: false, reason: "no_verdict" });
      }

      const recoveryPlan = parseJsonField(row.recoveryPlan, null);
      if (!recoveryPlan) {
        return res.json({
          hasRecoveryPlan: false,
          reason: row.verdict === "BLOCK" ? "verdict_predates_recovery_layer" : "verdict_not_blocked",
          verdict: row.verdict,
          executionMode: row.executionMode,
        });
      }

      res.json({
        hasRecoveryPlan: true,
        verdictId: row.id,
        verdict: row.verdict,
        executionMode: row.executionMode,
        recoveryPlan,
        createdAt: row.createdAt,
      });
    } catch (err: any) {
      console.error("[SystemControl] Recovery plan fetch error:", err.message);
      res.status(500).json({ error: "Failed to fetch recovery plan" });
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Phase R T006 — Run truthfulness endpoint.
  // Single combined response that powers the dashboard banner AND the
  // dedicated audit-control screen. Combines:
  //   - resolveRunId() (latest resolvable run + newerNonResolvableRun)
  //   - latest stored SystemControlVerdict (verdict, blocks, structural checks,
  //     contradictions, snapshot freshness)
  //   - a derived `headline` field so the UI does not have to re-implement
  //     truthfulness logic.
  //
  // Auth: same as the other system-control routes.
  // ──────────────────────────────────────────────────────────────────────────
  app.get("/api/system-control/run-truthfulness/:campaignId", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const accountId = resolveAccountId(req);
      const { campaignId } = req.params;
      try { await assertCampaignBelongsTo(accountId, campaignId); }
      catch (e) { if (handleOwnershipError(e, res)) return; throw e; }

      const { resolveRunId } = await import("../orchestrator/run-resolver");
      // resolveRunId returns { runId: null } for the "no runs yet" case —
      // it does NOT throw. Therefore we deliberately do NOT catch here:
      // a thrown error means a real DB/runtime failure that must surface
      // as 500, not be silently downgraded to a green-ish "no_run" state.
      const resolved: any = await resolveRunId(campaignId, accountId, null);

      // Latest stored verdict for the campaign (may belong to a different run
      // than `resolved.runId` if the most recent run failed before producing
      // a verdict — that case becomes part of the truthfulness signal).
      const [verdictRow] = await db.select()
        .from(systemControlVerdicts)
        .where(and(
          eq(systemControlVerdicts.accountId, accountId),
          eq(systemControlVerdicts.campaignId, campaignId),
        ))
        .orderBy(desc(systemControlVerdicts.createdAt))
        .limit(1);

      // eslint-disable-next-line semantic/no-semantic-fallback -- Seal #9 (F10.3): null-or-formatted-row read — `verdict` is composed from a row-presence boolean via formatVerdictRow(), not aliased from a missing canonical contract field. D1 forbids the latter, not the former.
      const verdict = verdictRow ? formatVerdictRow(verdictRow) : null;

      // Phase R T006 (architect-found): determine whether the latest stored
      // verdict actually belongs to the resolved run. If `resolved.runId`
      // exists but the latest verdict's jobId doesn't match, the verdict is
      // for a stale/older run and must NOT be presented as the current
      // truthfulness picture — otherwise a freshly failed run that hasn't
      // yet persisted a verdict could appear "ok" because we're showing the
      // previous run's PASS verdict.
      const verdictMatchesResolvedRun =
        verdict !== null &&
        resolved.runId !== null &&
        (verdict.jobId === resolved.runId || verdict.jobId === null);
      // ^ jobId === null is tolerated for legacy verdict rows written before
      // the jobId column was populated. New verdicts always carry the jobId.
      const verdictMissingForResolvedRun =
        resolved.runId !== null && verdict !== null && !verdictMatchesResolvedRun;
      const verdictAbsentForResolvedRun =
        resolved.runId !== null && verdict === null;

      // Extract snapshot-freshness info from structural checks if present.
      const checks: any[] = (verdict?.structuralChecks as any[]) || [];
      const freshnessCheck = checks.find(c => c?.check === "snapshot_freshness");
      const staleEngineMatch = freshnessCheck?.details?.match(/stale_engines=\[([^\]]*)\]/);
      const staleEngines = staleEngineMatch && staleEngineMatch[1]
        ? staleEngineMatch[1].split(",").map((s: string) => s.trim()).filter(Boolean)
        : [];

      const freshness = {
        hasStaleSnapshots: freshnessCheck?.status === "STALE",
        staleEngines,
        details: freshnessCheck?.details ?? null,
      };

      // Headline derivation — single source of truth so banner and audit
      // screen agree on what state we are in. Priority: no_run > shadowed >
      // verdict (block/downgrade/review/repair) > ok.
      let headline:
        | "no_run"
        | "shadowed"
        | "system_untrusted"
        | "blocked"
        | "needs_reconciliation"
        | "review_required"
        | "downgrade"
        | "repair"
        | "ok" = "ok";

      if (!resolved.runId && !verdict) {
        headline = "no_run";
      } else if (resolved.newerNonResolvableRun) {
        headline = "shadowed";
      } else if (verdictAbsentForResolvedRun || verdictMissingForResolvedRun) {
        // The resolved run has no matching verdict (either not yet persisted
        // or persistence failed). We refuse to default to "ok" because that
        // would let a failed/incomplete run appear healthy on the dashboard
        // until a verdict row eventually arrives.
        headline = "system_untrusted";
      } else if (verdict?.executionMode === "SYSTEM_UNTRUSTED") {
        headline = "system_untrusted";
      } else if (verdict?.executionMode === "NEEDS_RECONCILIATION") {
        headline = "needs_reconciliation";
      } else if (verdict?.executionMode === "HUMAN_REVIEW_REQUIRED" || verdict?.executionMode === "REVIEW_REQUIRED") {
        headline = "review_required";
      } else if (verdict?.verdict === "BLOCK") {
        headline = "blocked";
      } else if (verdict?.verdict === "REPAIR") {
        headline = "repair";
      } else if (verdict?.verdict === "DOWNGRADE") {
        headline = "downgrade";
      }

      res.json({
        campaignId,
        runId: resolved.runId,
        runStatus: resolved.status,
        isLatest: resolved.isLatest,
        isStale: resolved.isStale,
        completedAt: resolved.completedAt,
        newerNonResolvableRun: resolved.newerNonResolvableRun ?? null,
        verdict,
        freshness,
        headline,
        shouldShowBanner: headline !== "ok",
      });
    } catch (err: any) {
      console.error("[SystemControl] run-truthfulness error:", err.message);
      res.status(500).json({ error: "Failed to fetch run truthfulness" });
    }
  });

  console.log("[SystemControl] Routes registered: GET /api/system-control/verdicts/:campaignId, /latest/:campaignId, /stats/:campaignId, /recovery/:campaignId, /run-truthfulness/:campaignId");
}
