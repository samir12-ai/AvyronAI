import { Router, Request, Response } from "express";
import { resolveAccountId } from "../auth";
import { db } from "../db";
import {
  businessExecutionStates,
  clarificationRequests,
  performanceContexts,
} from "@shared/schema";
import { and, desc, eq } from "drizzle-orm";
import { resolveAccountIdFromCampaign } from "./account-resolver";
import { evaluateAndPersistBusinessExecutionState, submitClarificationAnswer } from "./execution-intelligence";
import { translatePerformanceToBll } from "./bll";

const router = Router();

// GET active business execution state & presentation payload
router.get("/execution-state/:campaignId", async (req: Request, res: Response) => {
  try {
    const authedAccountId = resolveAccountId(req);
    const { campaignId } = req.params;

    const accountId = await resolveAccountIdFromCampaign(campaignId, authedAccountId);

    let [state] = await db
      .select()
      .from(businessExecutionStates)
      .where(and(eq(businessExecutionStates.accountId, accountId), eq(businessExecutionStates.campaignId, campaignId)))
      .orderBy(desc(businessExecutionStates.createdAt))
      .limit(1);

    if (!state) {
      // Evaluate if none exists
      const evalResult = await evaluateAndPersistBusinessExecutionState({ accountId, campaignId });
      state = evalResult.executionState;
    }

    const [context] = await db
      .select()
      .from(performanceContexts)
      .where(and(eq(performanceContexts.accountId, accountId), eq(performanceContexts.campaignId, campaignId)))
      .orderBy(desc(performanceContexts.createdAt))
      .limit(1);

    const [pendingClarification] = await db
      .select()
      .from(clarificationRequests)
      .where(
        and(
          eq(clarificationRequests.accountId, accountId),
          eq(clarificationRequests.campaignId, campaignId),
          eq(clarificationRequests.status, "PENDING")
        )
      )
      .orderBy(desc(clarificationRequests.createdAt))
      .limit(1);

    const presentation = translatePerformanceToBll(state, context || null, pendingClarification || null);

    return res.json({
      executionState: state,
      performanceContext: context || null,
      clarificationRequest: pendingClarification || null,
      presentation,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST evaluate business execution state
router.post("/evaluate/:campaignId", async (req: Request, res: Response) => {
  try {
    const authedAccountId = resolveAccountId(req);
    const { campaignId } = req.params;
    const accountId = await resolveAccountIdFromCampaign(campaignId, authedAccountId);

    const result = await evaluateAndPersistBusinessExecutionState({ accountId, campaignId });
    const presentation = translatePerformanceToBll(
      result.executionState,
      result.performanceContext,
      result.clarificationRequest
    );

    return res.json({
      executionState: result.executionState,
      performanceContext: result.performanceContext,
      clarificationRequest: result.clarificationRequest,
      presentation,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST submit clarification answer
router.post("/clarify/:campaignId", async (req: Request, res: Response) => {
  try {
    const authedAccountId = resolveAccountId(req);
    const { campaignId } = req.params;
    const accountId = await resolveAccountIdFromCampaign(campaignId, authedAccountId);

    const { clarificationRequestId, userAnswer } = req.body;

    if (!clarificationRequestId || !userAnswer) {
      return res.status(400).json({ error: "clarificationRequestId and userAnswer are required." });
    }

    const result = await submitClarificationAnswer({ clarificationRequestId, accountId, userAnswer });
    const presentation = translatePerformanceToBll(
      result.executionState,
      result.performanceContext,
      result.clarificationRequest
    );

    return res.json({
      executionState: result.executionState,
      performanceContext: result.performanceContext,
      clarificationRequest: result.clarificationRequest,
      presentation,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export function registerPerformanceConsoleRoute(app: any) {
  app.use("/api/performance-intelligence", router);
}

export default router;
