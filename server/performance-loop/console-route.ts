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
import {
  BaselineValidationError,
  evaluateAndPersistBusinessExecutionState,
  submitClarificationAnswer,
} from "./execution-intelligence";
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
      // GET/read endpoints must never trigger scraping, LLM calls, or DB writes.
      // Call POST /evaluate/:campaignId to evaluate and persist execution state.
      return res.json({
        executionState: null,
        performanceContext: null,
        clarificationRequest: null,
        presentation: null,
        status: "PENDING_EVALUATION",
      });
    }

    const [context] = await db
      .select()
      .from(performanceContexts)
      .where(and(eq(performanceContexts.accountId, accountId), eq(performanceContexts.campaignId, campaignId)))
      .orderBy(desc(performanceContexts.createdAt))
      .limit(1);

    const allClarifications = await db
      .select()
      .from(clarificationRequests)
      .where(
        and(
          eq(clarificationRequests.accountId, accountId),
          eq(clarificationRequests.campaignId, campaignId)
        )
      )
      .orderBy(desc(clarificationRequests.createdAt));
    const answeredClarification = allClarifications.find((r) => r.status === "ANSWERED") || null;
    const pendingClarification = !answeredClarification
      ? allClarifications.find((r) => r.status === "PENDING") || null
      : null;

    const presentation = translatePerformanceToBll(state, context || null, pendingClarification || null);

    return res.json({
      executionState: state,
      performanceContext: context || null,
      clarificationRequest: pendingClarification || null,
      answeredClarificationRequest: answeredClarification || null,
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

    const { clarificationRequestId, userAnswer, structuredAnswer, __simulateDownstreamFailure, __nowOverride } = req.body || {};

    if (!clarificationRequestId || (!userAnswer && !structuredAnswer)) {
      return res.status(400).json({
        error: "clarificationRequestId and either userAnswer or structuredAnswer are required.",
        code: "MISSING_REQUIRED_FIELDS",
      });
    }

    const result = await submitClarificationAnswer({
      clarificationRequestId,
      accountId,
      campaignId,
      userAnswer,
      structuredAnswer,
      simulateDownstreamFailure: Boolean(__simulateDownstreamFailure),
      nowOverride: __nowOverride,
    });
    const presentation = result.executionState
      ? translatePerformanceToBll(result.executionState, result.performanceContext, result.clarificationRequest)
      : null;

    return res.json({
      success: true,
      saved: result.saved,
      clarificationRequestId: result.clarificationRequestId,
      answeredAt: result.answeredAt,
      answeredClarification: result.answeredClarification,
      evaluationStatus: result.evaluationStatus,
      evaluationError: result.evaluationError,
      reasoningSync: result.reasoningSync,
      executionState: result.executionState,
      performanceContext: result.performanceContext,
      clarificationRequest: result.clarificationRequest,
      presentation,
    });
  } catch (err: any) {
    const status =
      err instanceof BaselineValidationError
        ? err.status
        : typeof err?.status === "number" && err.status >= 400 && err.status < 500
          ? err.status
          : err?.name === "AccountScopeError"
            ? 403
            : 500;
    return res.status(status).json({
      error: err.message,
      code: err.code || (status === 400 ? "VALIDATION_ERROR" : "SERVER_ERROR"),
    });
  }
});

export function registerPerformanceConsoleRoute(app: any) {
  app.use("/api/performance-intelligence", router);
}

export default router;
