import type { Express, Request, Response } from "express";
import type { IntegrityReport } from "./types";
import { authMiddleware, resolveAccountId, type AuthRequest } from "../auth";
import { assertCampaignBelongsTo, handleOwnershipError } from "../auth-helpers";

const integrityReports = new Map<string, IntegrityReport>();

export function storeIntegrityReport(campaignId: string, accountId: string, report: IntegrityReport) {
  const key = `${accountId}:${campaignId}`;
  integrityReports.set(key, report);
}

export function getStoredIntegrityReport(campaignId: string, accountId: string): IntegrityReport | null {
  const key = `${accountId}:${campaignId}`;
  return integrityReports.get(key) ?? null;
}

export function registerIntegrityRoutes(app: Express) {
  app.get("/api/system-integrity/:campaignId", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const accountId = resolveAccountId(req);
      // W1-T4 (P0-4): cache key is `${accountId}:${campaignId}` so a foreign
      // campaignId can never reach another tenant's report (the lookup misses).
      // Explicit assert is defense-in-depth — produces a 404 instead of a
      // {hasReport:false} which can be used to probe campaign-id existence.
      try { await assertCampaignBelongsTo(accountId, req.params.campaignId as string); }
      catch (e) { if (handleOwnershipError(e, res)) return; throw e; }
      const key = `${accountId}:${req.params.campaignId as string}`;
      const report = integrityReports.get(key);
      if (!report) {
        return res.json({ hasReport: false });
      }
      res.json({ hasReport: true, report });
    } catch (err: any) {
      // Match the pattern used by sibling P0-4 handlers — never let a non-ownership
      // error fall through silently (would hang the request).
      console.error("[SystemIntegrity] Unhandled error:", err?.message || err);
      if (!res.headersSent) {
        res.status(500).json({ error: "INTERNAL_ERROR", message: "Failed to load integrity report" });
      }
    }
  });

  console.log("[SystemIntegrity] Routes registered: GET /api/system-integrity/:campaignId");
}
