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
    const accountId = resolveAccountId(req);
    // W1-T4 (P0-4): cache key is `${accountId}:${campaignId}` so a foreign
    // campaignId can never reach another tenant's report (the lookup misses).
    // Explicit assert is defense-in-depth — produces a 404 instead of a
    // {hasReport:false} which can be used to probe campaign-id existence.
    try { await assertCampaignBelongsTo(accountId, req.params.campaignId); }
    catch (e) { if (handleOwnershipError(e, res)) return; return; }
    const key = `${accountId}:${req.params.campaignId}`;
    const report = integrityReports.get(key);
    if (!report) {
      return res.json({ hasReport: false });
    }
    res.json({ hasReport: true, report });
  });

  console.log("[SystemIntegrity] Routes registered: GET /api/system-integrity/:campaignId");
}
