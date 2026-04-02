import type { Express, Request, Response } from "express";
import type { IntegrityReport } from "./types";
import { authMiddleware, resolveAccountId, type AuthRequest } from "../auth";

const integrityReports = new Map<string, IntegrityReport>();

export function storeIntegrityReport(campaignId: string, accountId: string, report: IntegrityReport) {
  const key = `${accountId}:${campaignId}`;
  integrityReports.set(key, report);
}

export function registerIntegrityRoutes(app: Express) {
  app.get("/api/system-integrity/:campaignId", authMiddleware, (req: AuthRequest, res: Response) => {
    const accountId = resolveAccountId(req);
    const key = `${accountId}:${req.params.campaignId}`;
    const report = integrityReports.get(key);
    if (!report) {
      return res.json({ hasReport: false });
    }
    res.json({ hasReport: true, report });
  });

  console.log("[SystemIntegrity] Routes registered: GET /api/system-integrity/:campaignId");
}
