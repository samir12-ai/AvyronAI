/**
 * What To Do Today — Express API Router
 * 
 * Mounted under /api/what-to-do-today
 */

import { Router, Request, Response } from "express";
import { WhatToDoTodayService } from "./service";
import { TaskBlueprintGenerator } from "./blueprint-generator";
import { logger } from "../logger";

export const whatToDoTodayRouter = Router();

/**
 * GET /api/what-to-do-today/today/:campaignId
 * Returns the canonical execution day for today (idempotent).
 */
whatToDoTodayRouter.get("/today/:campaignId", async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;
    const date = (req.query.date as string) || undefined;
    const force = req.query.force === "true";

    const payload = await WhatToDoTodayService.getOrCreateTodayPlan(campaignId, date, force);
    return res.json(payload);
  } catch (err: any) {
    logger.error("[WhatToDoTodayRoutes] GET /today error:", err);
    return res.status(500).json({ error: err.message || "Failed to load today's execution plan." });
  }
});

/**
 * POST /api/what-to-do-today/generate/:campaignId
 * Triggers or refreshes daily execution plan generation.
 */
whatToDoTodayRouter.post("/generate/:campaignId", async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;
    const { date, force } = req.body || {};

    const payload = await WhatToDoTodayService.getOrCreateTodayPlan(campaignId, date, force === true);
    return res.json(payload);
  } catch (err: any) {
    logger.error("[WhatToDoTodayRoutes] POST /generate error:", err);
    return res.status(500).json({ error: err.message || "Failed to generate daily execution plan." });
  }
});

/**
 * PATCH /api/what-to-do-today/tasks/:taskId/status
 * POST /api/what-to-do-today/tasks/:taskId/status
 * Updates the lifecycle status of an execution task.
 */
const updateTaskStatusHandler = async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { status } = req.body || {};

    if (!status) {
      return res.status(400).json({ error: "Missing required 'status' in request body." });
    }

    const updatedTask = await WhatToDoTodayService.updateTaskStatus(taskId, status);
    return res.json({ task: updatedTask });
  } catch (err: any) {
    logger.error("[WhatToDoTodayRoutes] update task status error:", err);
    return res.status(500).json({ error: err.message || "Failed to update task status." });
  }
};

whatToDoTodayRouter.patch("/tasks/:taskId/status", updateTaskStatusHandler);
whatToDoTodayRouter.post("/tasks/:taskId/status", updateTaskStatusHandler);

/**
 * GET /api/what-to-do-today/days/:campaignId
 * Returns historical execution days list for the campaign.
 */
whatToDoTodayRouter.get("/days/:campaignId", async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;
    const days = await WhatToDoTodayService.getExecutionDaysHistory(campaignId);
    return res.json({ days });
  } catch (err: any) {
    logger.error("[WhatToDoTodayRoutes] GET /days error:", err);
    return res.status(500).json({ error: err.message || "Failed to fetch execution days history." });
  }
});

/**
 * GET /api/what-to-do-today/tasks/:taskId/blueprint
 * Retrieves or auto-generates the production blueprint for a task.
 */
whatToDoTodayRouter.get("/tasks/:taskId/blueprint", async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const force = req.query.force === "true";
    const blueprint = await TaskBlueprintGenerator.getOrGenerateBlueprint(taskId, force);
    return res.json({ blueprint });
  } catch (err: any) {
    logger.error("[WhatToDoTodayRoutes] GET /tasks/:taskId/blueprint error:", err);
    return res.status(500).json({ error: err.message || "Failed to load production blueprint." });
  }
});

/**
 * POST /api/what-to-do-today/tasks/:taskId/blueprint/generate
 * Force-generates or refreshes the production blueprint.
 */
whatToDoTodayRouter.post("/tasks/:taskId/blueprint/generate", async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const blueprint = await TaskBlueprintGenerator.getOrGenerateBlueprint(taskId, true);
    return res.json({ blueprint });
  } catch (err: any) {
    logger.error("[WhatToDoTodayRoutes] POST /tasks/:taskId/blueprint/generate error:", err);
    return res.status(500).json({ error: err.message || "Failed to generate production blueprint." });
  }
});

