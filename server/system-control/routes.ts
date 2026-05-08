import type { Express, Response } from "express";
import { db } from "../db";
import { systemControlVerdicts } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { authMiddleware, resolveAccountId, type AuthRequest } from "../auth";
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
    checksPassed: verdict.structuralChecks.filter(c => c.passed).length,
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

  console.log("[SystemControl] Routes registered: GET /api/system-control/verdicts/:campaignId, /latest/:campaignId, /stats/:campaignId, /recovery/:campaignId");
}
