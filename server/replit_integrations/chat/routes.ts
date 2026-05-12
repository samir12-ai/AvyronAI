import type { Express, Request, Response } from "express";
import type OpenAI from "openai";
import { chatStorage } from "./storage";
import { loadSystemContext, buildSystemPrompt } from "../../orchestrator/agent-context";
import { resolveAccountId, AuthRequest } from "../../auth";
import { assertCampaignBelongsTo, handleOwnershipError } from "../../auth-helpers";
import { computeAdaptiveRhythm } from "../../adaptive-rhythm/engine";
import { getLatestGoalDecomposition, getLatestSimulation } from "../../goal-math";
import { getOpenAI, PRIMARY_CHAT_MODEL } from "../../ai-client";
import { getStoredIntegrityReport } from "../../system-integrity/routes";
import { db } from "../../db";
import {
  strategyMemory,
  orchestratorJobs,
  publishedPosts,
  calendarEntries,
  strategicPlans,
  accountState,
} from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { policyEnforcedMemoryCheck } from "../../decision-policy";
import { ACTIVE_PLAN_STATUSES_SQL } from "../../plan-constants";

// ─────────────────────────────────────────────────────────────────────────────
// REBUILD ELIGIBILITY — checked before trigger_plan_rerun executes.
// Enforces: rebuild is only allowed when:
//   (a) user executed AND results underperformed, OR
//   (b) market conditions shifted significantly
// ─────────────────────────────────────────────────────────────────────────────

interface RebuildEligibility {
  eligible: boolean;
  mustExecuteFirst: boolean;
  reason: string;
  complianceState: "COMPLIANT" | "LOW_CADENCE" | "NO_EXECUTION" | "UNKNOWN";
  publishedCount7d: number;
}

async function computeRebuildEligibility(
  accountId: string,
): Promise<RebuildEligibility> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [recentPublished, acctStateRows] = await Promise.all([
    db
      .select({ id: publishedPosts.id })
      .from(publishedPosts)
      .where(
        sql`${publishedPosts.accountId} = ${accountId} AND ${publishedPosts.status} = 'published' AND ${publishedPosts.publishedAt} >= ${sevenDaysAgo}`,
      )
      .limit(50),
    db
      .select({
        volatilityIndex: accountState.volatilityIndex,
        driftFlag: accountState.driftFlag,
        confidenceScore: accountState.confidenceScore,
      })
      .from(accountState)
      .where(eq(accountState.accountId, accountId))
      .limit(1),
  ]);

  const publishedCount7d = recentPublished.length;
  const acct = acctStateRows[0];
  const volatilityIndex = acct?.volatilityIndex ?? 0;
  const driftFlag = acct?.driftFlag ?? false;
  const confidenceScore = acct?.confidenceScore ?? 100;

  const hasMarketShift = volatilityIndex > 0.35 || driftFlag;

  if (publishedCount7d === 0 && !hasMarketShift) {
    return {
      eligible: false,
      mustExecuteFirst: true,
      reason:
        "No content has been published in the last 7 days. Execute the plan first — publish content consistently before requesting a strategy rebuild. Rebuilding without execution data produces guesswork, not strategy.",
      complianceState: "NO_EXECUTION",
      publishedCount7d,
    };
  }

  if (publishedCount7d < 3 && !hasMarketShift) {
    return {
      eligible: false,
      mustExecuteFirst: true,
      reason: `Only ${publishedCount7d} post(s) published in 7 days with no market shift detected. The system needs at least 3 posts per week of consistent execution before a strategy rebuild is warranted. Focus on publishing first.`,
      complianceState: "LOW_CADENCE",
      publishedCount7d,
    };
  }

  if (hasMarketShift) {
    return {
      eligible: true,
      mustExecuteFirst: false,
      reason: `Market shift detected (volatility: ${(volatilityIndex * 100).toFixed(0)}%, drift: ${driftFlag}). Rebuild is eligible based on market conditions.`,
      complianceState: publishedCount7d >= 3 ? "COMPLIANT" : "LOW_CADENCE",
      publishedCount7d,
    };
  }

  if (confidenceScore < 60) {
    return {
      eligible: true,
      mustExecuteFirst: false,
      reason: `Execution is compliant (${publishedCount7d} posts/7d) and confidence is below threshold (${confidenceScore}), indicating underperformance after execution. Rebuild is eligible.`,
      complianceState: "COMPLIANT",
      publishedCount7d,
    };
  }

  return {
    eligible: true,
    mustExecuteFirst: false,
    reason: `Execution is compliant (${publishedCount7d} posts/7d). Rebuild allowed — all conditions met.`,
    complianceState: "COMPLIANT",
    publishedCount7d,
  };
}

const AGENT_TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "trigger_plan_rerun",
      description:
        "Triggers a full orchestrator re-run for the current campaign. Use when the user wants to regenerate their strategy, refresh their plan, or when significant business changes require a full plan update. This is an intensive operation that runs all 8+ strategy engines sequentially.",
      parameters: {
        type: "object",
        properties: {
          justification: {
            type: "string",
            description: "Brief explanation of why a plan re-run is being triggered",
          },
        },
        required: ["justification"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_content_rhythm",
      description:
        "Recomputes the adaptive content rhythm (reels/week, carousels/week, stories/day, posts/week) based on current performance data, competitor benchmarks, and business constraints. Use when the user reports a content format is underperforming, wants to adjust their posting cadence, or after significant performance changes.",
      parameters: {
        type: "object",
        properties: {
          justification: {
            type: "string",
            description: "Reason for updating the content rhythm (e.g., 'User reported reel underperformance')",
          },
        },
        required: ["justification"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_system_status",
      description:
        "Returns the current engine health, last orchestrator run timestamps, content rhythm state, memory summary, and overall system status for the active campaign. Use when the user asks about system health, what's running, when things last ran, or wants a status overview.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "explain_forecast_model",
      description:
        "Returns the full forecast model assumptions with explanation of each conversion rate and where it came from — CTR, click-to-conversation rate, close rate, content-to-lead rate, etc. Use when the user asks why their forecast numbers are what they are, how their goal math works, or wants to understand their funnel assumptions.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "activate_execution_plan",
      description:
        "Activates the execution pipeline for the current approved plan — generates 30 days of calendar slots and creates AI-written content (captions, briefs, CTAs) for each slot. Use when the user has an approved plan but no content has been generated yet, or when they want to start publishing. Requires the plan to be in APPROVED status. Do NOT use this to rebuild strategy — use trigger_plan_rerun for that.",
      parameters: {
        type: "object",
        properties: {
          justification: {
            type: "string",
            description: "Reason for activating execution (e.g., 'User wants to start publishing content from approved plan')",
          },
        },
        required: ["justification"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "retry_failed_content",
      description:
        "Resets failed content generation entries back to DRAFT status and re-triggers content generation for them. Use when content generation has failed for some calendar entries and the user wants to retry. Does not change strategy or rebuild the plan.",
      parameters: {
        type: "object",
        properties: {
          justification: {
            type: "string",
            description: "Reason for retrying failed content (e.g., 'Some calendar entries failed to generate')",
          },
        },
        required: ["justification"],
      },
    },
  },
];

interface ToolCallResult {
  success: boolean;
  summary: string;
  data?: any;
}

async function handleToolCall(
  name: string,
  args: any,
  accountId: string,
  campaignId: string,
): Promise<ToolCallResult> {
  try {
    switch (name) {
      case "trigger_plan_rerun": {
        const eligibility = await computeRebuildEligibility(accountId);

        if (!eligibility.eligible) {
          console.log(`[AgentTool] trigger_plan_rerun BLOCKED — compliance: ${eligibility.complianceState}, published7d: ${eligibility.publishedCount7d}`);
          return {
            success: false,
            summary: eligibility.reason,
            data: {
              blocked: true,
              complianceState: eligibility.complianceState,
              publishedCount7d: eligibility.publishedCount7d,
              mustExecuteFirst: eligibility.mustExecuteFirst,
              suggestedAction: eligibility.mustExecuteFirst
                ? "activate_execution_plan"
                : "update_content_rhythm",
            },
          };
        }

        const [latestJob] = await db
          .select()
          .from(orchestratorJobs)
          .where(and(eq(orchestratorJobs.accountId, accountId), eq(orchestratorJobs.campaignId, campaignId)))
          .orderBy(desc(orchestratorJobs.createdAt))
          .limit(1);

        if (latestJob?.status === "RUNNING") {
          return {
            success: false,
            summary: "Orchestrator is already running. Wait for the current run to complete before triggering another.",
            data: { jobId: latestJob.id, status: "RUNNING" },
          };
        }

        console.log(`[AgentTool] trigger_plan_rerun ALLOWED — compliance: ${eligibility.complianceState}, published7d: ${eligibility.publishedCount7d}, reason: ${eligibility.reason}`);
        const { runOrchestrator } = await import("../../orchestrator/index");
        runOrchestrator({ accountId, campaignId, forceRefresh: true }).catch((err: any) => {
          console.error(`[AgentTool] trigger_plan_rerun background error:`, err.message);
        });

        return {
          success: true,
          summary: `Plan re-run triggered. All 8 strategy engines will reprocess the campaign sequentially. Check the Strategy Hub for live progress. (Compliance: ${eligibility.complianceState}, ${eligibility.publishedCount7d} posts/7d)`,
          data: { campaignId, triggered: true, complianceState: eligibility.complianceState },
        };
      }

      case "update_content_rhythm": {
        const rhythm = await computeAdaptiveRhythm(campaignId, accountId);

        const rhythmLabel = `${rhythm.reelsPerWeek}R · ${rhythm.carouselsPerWeek}C · ${rhythm.storiesPerDay}S · ${rhythm.postsPerWeek}P /wk`;
        const rhythmDetails = JSON.stringify({
          reelsPerWeek: rhythm.reelsPerWeek,
          carouselsPerWeek: rhythm.carouselsPerWeek,
          storiesPerDay: rhythm.storiesPerDay,
          postsPerWeek: rhythm.postsPerWeek,
          performanceBasis: rhythm.performanceBasis,
          confidenceScore: rhythm.confidenceScore,
          reasoning: rhythm.reasoning,
          deltaFromPrevious: rhythm.deltaFromPrevious,
          updatedByAgent: true,
          updatedAt: new Date().toISOString(),
        });

        const existing = await db
          .select({ id: strategyMemory.id })
          .from(strategyMemory)
          .where(
            and(
              eq(strategyMemory.accountId, accountId),
              eq(strategyMemory.campaignId, campaignId),
              eq(strategyMemory.memoryType, "content_rhythm"),
            ),
          )
          .limit(1);

        const rhythmCheck = policyEnforcedMemoryCheck(rhythm.confidenceScore, "neutral", "agent-rhythm", "content_rhythm");
        if (rhythmCheck.allowed) {
          if (existing[0]) {
            await db
              .update(strategyMemory)
              .set({
                label: rhythmLabel,
                details: rhythmDetails,
                score: rhythm.confidenceScore,
                confidenceScore: rhythm.confidenceScore,
                updatedAt: new Date(),
              })
              .where(eq(strategyMemory.id, existing[0].id));
          } else {
            await db.insert(strategyMemory).values({
              accountId,
              campaignId,
              memoryType: "content_rhythm",
              label: rhythmLabel,
              details: rhythmDetails,
              score: rhythm.confidenceScore,
              confidenceScore: rhythm.confidenceScore,
              direction: "neutral",
            });
          }
        }

        return {
          success: true,
          summary: `Content rhythm updated and saved: ${rhythm.reelsPerWeek} Reels/wk · ${rhythm.carouselsPerWeek} Carousels/wk · ${rhythm.storiesPerDay} Stories/day · ${rhythm.postsPerWeek} Posts/wk. Basis: ${rhythm.performanceBasis}. Confidence: ${Math.round(rhythm.confidenceScore * 100)}%.`,
          data: {
            reelsPerWeek: rhythm.reelsPerWeek,
            carouselsPerWeek: rhythm.carouselsPerWeek,
            storiesPerDay: rhythm.storiesPerDay,
            postsPerWeek: rhythm.postsPerWeek,
            performanceBasis: rhythm.performanceBasis,
            confidenceScore: rhythm.confidenceScore,
            reasoning: rhythm.reasoning,
            deltaFromPrevious: rhythm.deltaFromPrevious,
          },
        };
      }

      case "get_system_status": {
        const context = await loadSystemContext(accountId, campaignId);
        const integrityReport = getStoredIntegrityReport(campaignId, accountId);

        const engineCount = Object.keys(context.engineSnapshots || {}).length;
        const lastRun = context.engineStatus;
        const lastRunText = lastRun
          ? `Last run: ${lastRun.status} (${lastRun.completedAt ? new Date(lastRun.completedAt).toLocaleDateString() : "in progress"})`
          : "No orchestrator run found";

        const rhythmMemory = await db
          .select()
          .from(strategyMemory)
          .where(
            and(
              eq(strategyMemory.accountId, accountId),
              eq(strategyMemory.campaignId, campaignId),
              eq(strategyMemory.memoryType, "content_rhythm"),
            ),
          )
          .orderBy(desc(strategyMemory.updatedAt))
          .limit(1);

        const memoryCount = await db
          .select()
          .from(strategyMemory)
          .where(and(eq(strategyMemory.accountId, accountId), eq(strategyMemory.campaignId, campaignId)));

        const integrityStatus = integrityReport
          ? `Integrity: ${integrityReport.overallStatus} (${integrityReport.engineChecks?.length || 0} engine checks${integrityReport.failureReasons?.length ? `, ${integrityReport.failureReasons.length} failure(s)` : ""})`
          : "Integrity: no report (run orchestrator first)";

        return {
          success: true,
          summary: `System status: ${engineCount}/14 engines have snapshots. ${lastRunText}. Plan: ${context.activePlan?.status || "none"}. Memory entries: ${memoryCount.length}. ${integrityStatus}. ${context.warnings.length > 0 ? "Warnings: " + context.warnings.join("; ") : "No warnings."}`,
          data: {
            engineSnapshotCount: engineCount,
            planStatus: context.activePlan?.status || null,
            executionStatus: context.activePlan?.executionStatus || null,
            lastOrchestratorRun: lastRun || null,
            contentRhythmLabel: rhythmMemory[0]?.label || null,
            memoryEntryCount: memoryCount.length,
            integrity: integrityReport
              ? {
                  overallStatus: integrityReport.overallStatus,
                  engineCheckCount: integrityReport.engineChecks?.length || 0,
                  failureReasons: integrityReport.failureReasons || [],
                  signalFlowVerified: integrityReport.signalFlowVerified,
                  traceabilityComplete: integrityReport.traceabilityComplete,
                }
              : null,
            warnings: context.warnings,
            rootBundle: context.rootBundle,
          },
        };
      }

      case "explain_forecast_model": {
        const { resolveRunId } = await import("../../orchestrator/run-resolver");
        let resolvedRun;
        try {
          resolvedRun = await resolveRunId(campaignId, accountId, null);
        } catch {
          resolvedRun = null;
        }
        const decomp = resolvedRun?.runId ? await getLatestGoalDecomposition(campaignId, accountId, resolvedRun.runId) : null;
        const sim = resolvedRun?.runId ? await getLatestSimulation(campaignId, accountId, resolvedRun.runId) : null;

        if (!decomp) {
          return {
            success: false,
            summary: "No goal decomposition found for this campaign. Run the orchestrator and set a goal first.",
          };
        }

        let funnelMath: any = null;
        try {
          funnelMath = typeof decomp.funnelMath === "string" ? JSON.parse(decomp.funnelMath) : decomp.funnelMath;
        } catch {}

        const assumptions: string[] = [];
        if (funnelMath) {
          assumptions.push(`Goal: ${decomp.goalLabel} (${decomp.goalType} target: ${decomp.goalTarget}) over ${decomp.timeHorizonDays} days`);
          assumptions.push(`CTR (content-to-click): ${funnelMath.ctr != null ? (funnelMath.ctr * 100).toFixed(1) + "%" : "2.5% (default)"}`);
          assumptions.push(`Click-to-Conversation: ${funnelMath.clickToConversationRate != null ? (funnelMath.clickToConversationRate * 100).toFixed(0) + "%" : "30% (default)"}`);
          assumptions.push(`Conversation-to-Lead: ${funnelMath.conversationToLeadRate != null ? (funnelMath.conversationToLeadRate * 100).toFixed(0) + "%" : "50% (default)"}`);
          assumptions.push(`Lead Qualification Rate: 20% (fixed)`);
          assumptions.push(`Lead-to-Client (Close Rate): ${funnelMath.closeRate != null ? (funnelMath.closeRate * 100).toFixed(0) + "%" : "10% (default)"}`);
          if (funnelMath.requiredReach) assumptions.push(`Required reach: ${funnelMath.requiredReach.toLocaleString()}`);
          if (funnelMath.requiredLeads) assumptions.push(`Required leads: ${funnelMath.requiredLeads.toLocaleString()}`);
        }

        const simText = sim ? `Simulation confidence: ${sim.confidenceScore}/100` : "No simulation available";

        return {
          success: true,
          summary: `Forecast model for "${decomp.goalLabel}": ${assumptions.slice(0, 3).join(", ")}. ${simText}.`,
          data: {
            goal: {
              type: decomp.goalType,
              target: decomp.goalTarget,
              label: decomp.goalLabel,
              timeHorizonDays: decomp.timeHorizonDays,
              feasibility: decomp.feasibility,
              feasibilityScore: decomp.feasibilityScore,
            },
            funnelMath,
            assumptions,
            simulation: sim ? {
              confidenceScore: sim.confidenceScore,
              conservativeCase: typeof sim.conservativeCase === "string" ? JSON.parse(sim.conservativeCase) : sim.conservativeCase,
              baseCase: typeof sim.baseCase === "string" ? JSON.parse(sim.baseCase) : sim.baseCase,
            } : null,
          },
        };
      }

      case "activate_execution_plan": {
        const [plan] = await db
          .select()
          .from(strategicPlans)
          .where(
            and(
              eq(strategicPlans.accountId, accountId),
              eq(strategicPlans.campaignId, campaignId),
              sql`${strategicPlans.status} IN (${sql.raw(ACTIVE_PLAN_STATUSES_SQL)})`,
            ),
          )
          .orderBy(desc(strategicPlans.createdAt))
          .limit(1);

        if (!plan) {
          return {
            success: false,
            summary: "No active approved plan found for this campaign. Run the strategy orchestrator and approve a plan before activating execution.",
            data: { reason: "NO_APPROVED_PLAN" },
          };
        }

        if (plan.status !== "APPROVED") {
          return {
            success: false,
            summary: `The current plan is in '${plan.status}' status and cannot be activated yet. The plan must be APPROVED before content generation can begin. Please review and approve the plan in the Strategy Hub.`,
            data: { planId: plan.id, currentStatus: plan.status },
          };
        }

        if (plan.executionStatus === "ACTIVE" || plan.executionStatus === "ACTIVATING") {
          const entryStats = await db
            .select({ status: calendarEntries.status })
            .from(calendarEntries)
            .where(eq(calendarEntries.planId, plan.id));

          const generated = entryStats.filter(
            (e) => e.status === "AI_GENERATED" || e.status === "GENERATED",
          ).length;
          const failed = entryStats.filter((e) => e.status === "FAILED").length;
          const draft = entryStats.filter((e) => e.status === "DRAFT").length;

          return {
            success: true,
            summary: `Execution is already ${plan.executionStatus.toLowerCase()} for this plan. Content status: ${generated} generated, ${draft} draft, ${failed} failed out of ${entryStats.length} total entries. Use retry_failed_content if you need to fix failed entries.`,
            data: {
              planId: plan.id,
              executionStatus: plan.executionStatus,
              generated,
              draft,
              failed,
              total: entryStats.length,
            },
          };
        }

        const { activateExecution } = await import("../../execution-activation/engine");
        activateExecution(plan.id).catch((err: any) => {
          console.error(`[AgentTool] activate_execution_plan background error:`, err.message);
        });

        console.log(`[AgentTool] activate_execution_plan triggered — planId: ${plan.id}, account: ${accountId}`);
        return {
          success: true,
          summary: `Execution activation started for plan "${plan.planSummary?.slice(0, 80) || plan.id}". The system is now generating 30 days of calendar slots and creating AI-written content for each. This runs in the background — check the Calendar and Studio in a few minutes to see your content.`,
          data: { planId: plan.id, campaignId, triggered: true },
        };
      }

      case "retry_failed_content": {
        const [plan] = await db
          .select()
          .from(strategicPlans)
          .where(
            and(
              eq(strategicPlans.accountId, accountId),
              eq(strategicPlans.campaignId, campaignId),
              sql`${strategicPlans.status} = 'APPROVED'`,
            ),
          )
          .orderBy(desc(strategicPlans.createdAt))
          .limit(1);

        if (!plan) {
          return {
            success: false,
            summary: "No approved plan found. Cannot retry content generation without an approved plan.",
            data: { reason: "NO_APPROVED_PLAN" },
          };
        }

        const failedEntries = await db
          .select({ id: calendarEntries.id })
          .from(calendarEntries)
          .where(
            and(
              eq(calendarEntries.planId, plan.id),
              sql`${calendarEntries.status} = 'FAILED'`,
            ),
          );

        if (failedEntries.length === 0) {
          return {
            success: true,
            summary: "No failed content entries found for this plan. All calendar entries are either generated or still in draft. No retry needed.",
            data: { planId: plan.id, failedCount: 0 },
          };
        }

        await db
          .update(calendarEntries)
          .set({ status: "DRAFT" })
          .where(
            and(
              eq(calendarEntries.planId, plan.id),
              sql`${calendarEntries.status} = 'FAILED'`,
            ),
          );

        const { activateExecution: activateExecutionRetry } = await import("../../execution-activation/engine");
        activateExecutionRetry(plan.id).catch((err: any) => {
          console.error(`[AgentTool] retry_failed_content background error:`, err.message);
        });

        console.log(`[AgentTool] retry_failed_content — reset ${failedEntries.length} FAILED entries to DRAFT and re-triggered activation for planId: ${plan.id}`);
        return {
          success: true,
          summary: `${failedEntries.length} failed content entry(ies) have been reset and re-queued for generation. Content generation is running in the background — check the Studio and Calendar in a few minutes.`,
          data: { planId: plan.id, retriedCount: failedEntries.length },
        };
      }

      default:
        return { success: false, summary: `Unknown tool: ${name}` };
    }
  } catch (err: any) {
    console.error(`[AgentTool] ${name} error:`, err.message);
    return { success: false, summary: `Tool execution failed: ${err.message}` };
  }
}

async function writeAgentActionMemory(
  accountId: string,
  campaignId: string,
  toolName: string,
  justification: string,
  result: ToolCallResult,
): Promise<void> {
  try {
    const direction = result.success ? "reinforce" as const : "avoid" as const;
    const confidenceScore = result.success ? 0.85 : 0.15;
    const check = policyEnforcedMemoryCheck(confidenceScore, direction, "agent", "agent_action");
    if (!check.allowed) {
      console.log(`[AgentTool] MEMORY_WRITE_BLOCKED | tool="${toolName}" success=${result.success} confidence=${confidenceScore}`);
      return;
    }
    const memId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    await db.insert(strategyMemory).values({
      id: memId,
      accountId,
      campaignId,
      memoryType: "agent_action",
      engineName: "agent",
      label: toolName,
      details: `${justification} | Result: ${result.summary}`,
      performance: result.success ? "success" : "failure",
      score: confidenceScore,
      isWinner: result.success,
      confidenceScore,
      direction,
      lastValidatedAt: new Date(),
    });
  } catch (err: any) {
    console.warn(`[AgentTool] Memory write failed (non-blocking):`, err.message);
  }
}

export function registerChatRoutes(app: Express): void {
  app.get("/api/conversations", async (req: Request, res: Response) => {
    try {
      const accountId = resolveAccountId(req as AuthRequest) as string;
      const conversations = await chatStorage.getAllConversations(accountId);
      res.json(conversations);
    } catch (error) {
      console.error("Error fetching conversations:", error);
      res.status(500).json({ error: "Failed to fetch conversations" });
    }
  });

  app.get("/api/conversations/:id", async (req: Request, res: Response) => {
    try {
      const accountId = resolveAccountId(req as AuthRequest) as string;
      const id = parseInt(req.params.id);
      const conversation = await chatStorage.getConversation(id, accountId);
      if (!conversation) {
        return res.status(404).json({ error: "Conversation not found" });
      }
      const messages = await chatStorage.getMessagesByConversation(id, accountId);
      res.json({ ...conversation, messages });
    } catch (error) {
      console.error("Error fetching conversation:", error);
      res.status(500).json({ error: "Failed to fetch conversation" });
    }
  });

  app.post("/api/conversations", async (req: Request, res: Response) => {
    try {
      const accountId = resolveAccountId(req as AuthRequest) as string;
      const { title } = req.body;
      const conversation = await chatStorage.createConversation(title || "New Chat", accountId);
      res.status(201).json(conversation);
    } catch (error) {
      console.error("Error creating conversation:", error);
      res.status(500).json({ error: "Failed to create conversation" });
    }
  });

  app.delete("/api/conversations/:id", async (req: Request, res: Response) => {
    try {
      const accountId = resolveAccountId(req as AuthRequest) as string;
      const id = parseInt(req.params.id);
      await chatStorage.deleteConversation(id, accountId);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting conversation:", error);
      res.status(500).json({ error: "Failed to delete conversation" });
    }
  });

  app.post("/api/conversations/:id/messages", async (req: Request, res: Response) => {
    try {
      const accountId = resolveAccountId(req as AuthRequest) as string;
      const conversationId = parseInt(req.params.id);
      const { content, campaignId } = req.body;
      // Doctrine W5: campaignId is optional but loaded into systemContext if
      // present. Validate ownership before context hydration.
      if (campaignId) {
        try { await assertCampaignBelongsTo(accountId, String(campaignId)); }
        catch (e) { if (handleOwnershipError(e, res)) return; throw e; }
      }

      const conv = await chatStorage.getConversation(conversationId, accountId);
      if (!conv) {
        return res.status(404).json({ error: "Conversation not found" });
      }

      await chatStorage.createMessage(conversationId, "user", content);

      const messages = await chatStorage.getMessagesByConversation(conversationId, accountId);
      const chatMessages: OpenAI.Chat.ChatCompletionMessageParam[] = messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

      let systemPrompt = "You are the Avyron AI Assistant — a strategic marketing operations manager. You can execute actions using the available tools when the user's request calls for it. Use tools autonomously when the situation warrants — don't ask for permission first.";
      try {
        if (campaignId) {
          const context = await loadSystemContext(accountId, String(campaignId));
          systemPrompt = buildSystemPrompt(context);
          systemPrompt += "\n\nYou have access to tools that let you take real actions in the system. Use them autonomously when appropriate — for example, if the user says content is underperforming, call update_content_rhythm without asking. If they want a fresh strategy, call trigger_plan_rerun. Always explain what you did after calling a tool.";
        }
      } catch (err) {
        console.warn("[Chat] Failed to load system context:", err);
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const messageHistory: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: "system", content: systemPrompt },
        ...chatMessages,
      ];

      let fullResponse = "";
      let toolCallsExecuted: Array<{ name: string; result: ToolCallResult }> = [];

      const stream = await getOpenAI().chat.completions.create({
        model: PRIMARY_CHAT_MODEL,
        messages: messageHistory,
        tools: campaignId ? AGENT_TOOLS : undefined,
        tool_choice: campaignId ? "auto" : undefined,
        stream: true,
        max_tokens: 2048,
      } as any);

      let pendingToolCallId = "";
      let pendingToolName = "";
      let pendingToolArgs = "";

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        const finishReason = chunk.choices[0]?.finish_reason;

        if (delta?.content) {
          fullResponse += delta.content;
          res.write(`data: ${JSON.stringify({ content: delta.content })}\n\n`);
        }

        if (delta?.tool_calls?.length) {
          const tc = delta.tool_calls[0];
          if (tc.id) pendingToolCallId = tc.id;
          if (tc.function?.name) pendingToolName = tc.function.name;
          if (tc.function?.arguments) pendingToolArgs += tc.function.arguments;
        }

        if (finishReason === "tool_calls" && pendingToolName) {
          let toolArgs: any = {};
          try { toolArgs = JSON.parse(pendingToolArgs); } catch {}

          console.log(`[AgentTool] Executing tool: ${pendingToolName} | args: ${JSON.stringify(toolArgs)}`);

          const toolResult = await handleToolCall(pendingToolName, toolArgs, accountId, String(campaignId || ""));

          res.write(`data: ${JSON.stringify({
            type: "tool_call",
            name: pendingToolName,
            result: toolResult,
          })}\n\n`);

          toolCallsExecuted.push({ name: pendingToolName, result: toolResult });

          if (campaignId && toolResult.success) {
            const justification = toolArgs.justification || `User-initiated ${pendingToolName}`;
            writeAgentActionMemory(accountId, String(campaignId), pendingToolName, justification, toolResult).catch(() => {});
          }

          messageHistory.push({
            role: "assistant",
            content: null,
            tool_calls: [{
              id: pendingToolCallId,
              type: "function",
              function: { name: pendingToolName, arguments: pendingToolArgs },
            }],
          });
          messageHistory.push({
            role: "tool",
            tool_call_id: pendingToolCallId,
            content: JSON.stringify(toolResult),
          });

          pendingToolCallId = "";
          pendingToolName = "";
          pendingToolArgs = "";

          const continuationStream = await getOpenAI().chat.completions.create({
            model: PRIMARY_CHAT_MODEL,
            messages: messageHistory,
            stream: true,
            max_tokens: 1024,
          } as any);

          for await (const continuationChunk of continuationStream) {
            const contDelta = continuationChunk.choices[0]?.delta;
            if (contDelta?.content) {
              fullResponse += contDelta.content;
              res.write(`data: ${JSON.stringify({ content: contDelta.content })}\n\n`);
            }
          }
        }
      }

      const savedContent = fullResponse || (toolCallsExecuted.length > 0
        ? `[Agent executed ${toolCallsExecuted.map(t => t.name).join(", ")}]`
        : "");
      await chatStorage.createMessage(conversationId, "assistant", savedContent);

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (error) {
      console.error("Error sending message:", error);
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ error: "Failed to send message" })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ error: "Failed to send message" });
      }
    }
  });
}
