import type { Express, Request, Response } from "express";
import { activateExecution, getActivationStatus } from "./engine";

function handleError(res: Response, err: any) {
  if (err.message === "PLAN_NOT_FOUND") {
    return res.status(404).json({ success: false, error: "PLAN_NOT_FOUND", message: "Plan not found" });
  }
  res.status(500).json({ success: false, error: err.message });
}

export function registerExecutionActivationRoutes(app: Express) {
  app.get("/api/execution-activation/status/:planId", async (req: Request, res: Response) => {
    try {
      const { planId } = req.params;
      const status = await getActivationStatus(planId);
      res.json({ success: true, ...status });
    } catch (err: any) {
      handleError(res, err);
    }
  });

  app.post("/api/execution-activation/activate/:planId", async (req: Request, res: Response) => {
    try {
      const { planId } = req.params;
      const result = await activateExecution(planId);

      const errorStatusMap: Record<string, number> = {
        PLAN_NOT_APPROVED: 409,
        EMERGENCY_STOPPED: 409,
        INVALID_STATE_TRANSITION: 409,
        CONTENT_QUEUE_VALIDATION_FAILED: 422,
        CONTENT_GENERATION_FAILED: 500,
      };

      if (!result.success) {
        const status = errorStatusMap[result.error || ""] || 500;
        return res.status(status).json({ success: false, ...result });
      }

      res.json({ success: true, ...result });
    } catch (err: any) {
      handleError(res, err);
    }
  });

  app.post("/api/execution-activation/retry/:planId", async (req: Request, res: Response) => {
    try {
      const { planId } = req.params;
      const status = await getActivationStatus(planId);

      if (status.executionStatus !== "ACTIVATION_FAILED" && status.executionStatus !== "FAILED") {
        return res.status(409).json({
          success: false,
          error: "INVALID_STATE_FOR_RETRY",
          message: `Retry only allowed from ACTIVATION_FAILED or FAILED states. Current: ${status.executionStatus}`,
        });
      }

      const result = await activateExecution(planId);
      res.json({ success: result.success, ...result });
    } catch (err: any) {
      handleError(res, err);
    }
  });

  app.get("/api/execution-activation/content-queue/:planId", async (req: Request, res: Response) => {
    try {
      const { planId } = req.params;
      const status = await getActivationStatus(planId);

      if (!status.contentQueue) {
        return res.json({
          success: true,
          empty: true,
          message: "No content queue exists for this plan",
          violations: ["NO_CONTENT_TO_DISTRIBUTE: Content queue is empty"],
        });
      }

      res.json({
        success: true,
        empty: false,
        ...status.contentQueue,
      });
    } catch (err: any) {
      handleError(res, err);
    }
  });

  app.post("/api/execution-activation/validate-funnel/:planId", async (req: Request, res: Response) => {
    try {
      const { planId } = req.params;
      const status = await getActivationStatus(planId);

      if (!status.funnelFeeding) {
        return res.json({
          success: true,
          funnelStatus: "PENDING",
          message: "No content exists to feed the funnel",
          violations: ["FUNNEL_NOT_INITIALIZED: No content pipeline exists"],
        });
      }

      res.json({
        success: true,
        ...status.funnelFeeding,
      });
    } catch (err: any) {
      handleError(res, err);
    }
  });

  console.log("[ExecutionActivation] Routes registered: activate, retry, status, content-queue, validate-funnel");
}
