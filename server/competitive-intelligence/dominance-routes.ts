import type { Express } from "express";

const DEPRECATED_MSG = {
  error: "DEPRECATED",
  message: "Standalone dominance analysis has been replaced by MI V3. Use POST /api/ci/mi-v3/analyze instead. Dominance is now an internal module within MI V3.",
  engine: "MI_V3",
};

export function registerDominanceRoutes(app: Express) {
  app.post("/api/dominance/analyze", (_req, res) => res.status(410).json(DEPRECATED_MSG));
  app.post("/api/dominance/:id/retry", (_req, res) => res.status(410).json(DEPRECATED_MSG));
  app.get("/api/dominance/analyses", (_req, res) => res.status(410).json(DEPRECATED_MSG));
  app.get("/api/dominance/analyses/:id", (_req, res) => res.status(410).json(DEPRECATED_MSG));
  app.delete("/api/dominance/analyses/:id", (_req, res) => res.status(410).json(DEPRECATED_MSG));
  app.get("/api/dominance/:analysisId/modifications", (_req, res) => res.status(410).json(DEPRECATED_MSG));
  app.post("/api/dominance/:id/generate-modifications", (_req, res) => res.status(410).json(DEPRECATED_MSG));
  app.post("/api/dominance/modifications/:modId/approve", (_req, res) => res.status(410).json(DEPRECATED_MSG));
  app.post("/api/dominance/modifications/:modId/apply", (_req, res) => res.status(410).json(DEPRECATED_MSG));
  app.post("/api/dominance/modifications/:modId/reject", (_req, res) => res.status(410).json(DEPRECATED_MSG));
  app.post("/api/dominance/modifications/:modId/rollback", (_req, res) => res.status(410).json(DEPRECATED_MSG));
  app.post("/api/dominance/:id/approve-modifications", (_req, res) => res.status(410).json(DEPRECATED_MSG));
  app.post("/api/dominance/:id/reject-modifications", (_req, res) => res.status(410).json(DEPRECATED_MSG));
  app.post("/api/dominance/:id/acknowledge-fallback", (_req, res) => res.status(410).json(DEPRECATED_MSG));
}
