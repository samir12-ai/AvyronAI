import type { Express, Request, Response } from "express";
import type { IntegrityReport } from "./types";

const integrityReports = new Map<string, IntegrityReport>();

export function storeIntegrityReport(campaignId: string, report: IntegrityReport) {
  integrityReports.set(campaignId, report);
}

export function registerIntegrityRoutes(app: Express) {
  app.get("/api/system-integrity/:campaignId", (req: Request, res: Response) => {
    const report = integrityReports.get(req.params.campaignId);
    if (!report) {
      return res.json({ hasReport: false });
    }
    res.json({ hasReport: true, report });
  });

  console.log("[SystemIntegrity] Routes registered: GET /api/system-integrity/:campaignId");
}
