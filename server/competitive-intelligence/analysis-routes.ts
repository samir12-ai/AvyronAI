import type { Express } from "express";

const DEPRECATED_MSG = {
  error: "DEPRECATED",
  message: "Legacy CI analysis has been replaced by MI V3. Use /api/ci/mi-v3/* endpoints instead.",
  engine: "MI_V3",
};

export function registerCiAnalysisRoutes(app: Express) {
  app.post("/api/ci/analyze", (_req, res) => res.status(410).json(DEPRECATED_MSG));
  app.get("/api/ci/analyses", (_req, res) => res.status(410).json(DEPRECATED_MSG));
  app.get("/api/ci/analyses/:id", (_req, res) => res.status(410).json(DEPRECATED_MSG));
  app.get("/api/ci/recommendations", (_req, res) => res.status(410).json(DEPRECATED_MSG));
  app.post("/api/ci/recommendations/:id/apply", (_req, res) => res.status(410).json(DEPRECATED_MSG));
  app.post("/api/ci/recommendations/:id/reject", (_req, res) => res.status(410).json(DEPRECATED_MSG));
  app.get("/api/ci/strategy-timeline", (_req, res) => res.status(410).json(DEPRECATED_MSG));
  app.get("/api/ci/month-diff/:month", (_req, res) => res.status(410).json(DEPRECATED_MSG));
}
