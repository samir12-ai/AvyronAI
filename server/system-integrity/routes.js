import { authMiddleware, resolveAccountId } from "../auth";
const integrityReports = new Map();
export function storeIntegrityReport(campaignId, accountId, report) {
    const key = `${accountId}:${campaignId}`;
    integrityReports.set(key, report);
}
export function registerIntegrityRoutes(app) {
    app.get("/api/system-integrity/:campaignId", authMiddleware, (req, res) => {
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
