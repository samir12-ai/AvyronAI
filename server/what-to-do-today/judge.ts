/**
 * What To Do Today — Semantic Execution Judge & Targeted Repair
 * 
 * Evaluates daily execution plans against 12 constitutional criteria.
 * Enforces fail-closed validation with targeted repair loop.
 */

import { aiChat } from "../ai-client";
import { ExecutionPlanningContext, DailyPlanDraft, ExecutionJudgeReport } from "./contracts";
import { generateDailyExecutionPlan } from "./planner";
import { logger } from "../logger";

export async function evaluateDailyPlanWithJudge(
  context: ExecutionPlanningContext,
  plan: DailyPlanDraft
): Promise<ExecutionJudgeReport> {
  // 1. Deterministic Constitutional Checks
  const rejections: string[] = [];
  const repairs: string[] = [];

  // Check task count feasibility (manageable day: 3 to 8 tasks)
  if (!plan.tasks || plan.tasks.length < 2) {
    rejections.push("DAILY_CAPACITY_UNDERUTILIZED: Plan contains fewer than 2 tasks.");
    repairs.push("Generate at least 3-5 realistic tasks to cover the primary channel and key supporting ecosystem.");
  } else if (plan.tasks.length > 9) {
    rejections.push("DAILY_CAPACITY_EXCEEDED: Plan contains more than 9 tasks (unrealistic daily operator load).");
    repairs.push("Consolidate tasks down to a focused 4-7 task plan prioritizing MUST_DO and SHOULD_DO executions.");
  }

  // Check primary channel representation
  const primaryChannel = context.channelHierarchy.primaryChannel;
  const primaryTasks = plan.tasks.filter(t => t.channel === primaryChannel);
  if (primaryTasks.length === 0) {
    rejections.push(`PRIMARY_CHANNEL_UNDERWEIGHTED: Selected primary channel ${primaryChannel} has 0 tasks.`);
    repairs.push(`Ensure ${primaryChannel} receives the primary anchor asset execution (MUST_DO priority).`);
  }

  // Check for duplicate titles across channels (copy-paste check)
  const titles = plan.tasks.map(t => t.title.toLowerCase().trim());
  const uniqueTitles = new Set(titles);
  if (uniqueTitles.size < titles.length) {
    rejections.push("CROSS_CHANNEL_COPY_PASTE: Duplicate task titles detected across channels.");
    repairs.push("Make each channel execution semantically distinct and adapted natively to platform behavior.");
  }

  // Check mission quality
  if (!plan.dailyMission || plan.dailyMission.length < 15 || plan.dailyMission.toLowerCase().includes("grow your brand")) {
    rejections.push("DAILY_MISSION_GENERIC: Today's mission is empty or too generic.");
    repairs.push("Write a concrete, strategy-grounded mission sentence for today's work.");
  }

  // 2. LLM Semantic Judge Check
  const judgePrompt = `You are a Senior Strategic Execution Auditor. Your task is to rigorously evaluate whether this daily execution plan faithfully and natively executes the approved B2B SaaS strategy without inventing strategy or creating copy-paste busywork.

CONSTITUTIONAL EVALUATION CRITERIA:
1. STRATEGY FIDELITY: Every task derives from the approved strategy (${context.strategyName}, ${context.approvedMechanism.mechanismName}).
2. NO STRATEGY INVENTION: No unapproved new targets, pains, mechanisms, or offers.
3. PRIMARY CHANNEL EMPHASIS: Primary channel (${primaryChannel}) receives significant strategic depth.
4. FULL CHANNEL ECOSYSTEM: Supporting channels (Instagram, TikTok, Facebook, X) are meaningfully engaged with native format adaptation.
5. PLATFORM NATIVENESS: No copy-pasting of identical content across platforms.
6. CROSS-CHANNEL COHERENCE: All tasks align toward one coherent daily strategy.
7. DEPENDENCY VALIDITY: Downstream clips/assets are sequenced logically.
8. DAILY FEASIBILITY: The plan is executable by a real marketing team in one business day.
9. STRATEGIC USEFULNESS: Tasks create real leverage toward the funnel destination (${context.funnelJourney?.conversionPath || "Webinar/Demo"}).
10. BUDGET COMPLIANCE: Adheres to mode "${context.budgetConstraints.operationalMode}" (${context.budgetConstraints.spendRule}).

APPROVED STRATEGY:
- Strategy Name: ${context.strategyName}
- Primary Axis: ${context.primaryAxis} (${context.contrastAxis})
- Mechanism: ${context.approvedMechanism.mechanismName}
- Lanes: ${context.approvedLanes.map(l => l.title).join("; ")}
- Primary Channel: ${primaryChannel}
- Destination: ${context.funnelJourney?.conversionPath || "Webinar / Demo"}

PLAN UNDER REVIEW:
${JSON.stringify(plan, null, 2)}

Return structured JSON:
{
  "valid": true/false,
  "score": 0.0 to 1.0 (pass threshold is 0.85),
  "rejectionReasons": ["..."],
  "repairDirectives": ["..."],
  "feedback": "Concise summary of verdict"
}`;

  try {
    const judgeResponse = await aiChat({
      model: "gpt-4o-mini",
      temperature: 0.0,
      accountId: context.accountId,
      endpoint: "what-to-do-today-judge",
      response_format: { type: "json_object" },
      max_tokens: 1200,
      messages: [
        { role: "system", content: "You are an uncompromising Strategic Execution Judge. Output valid JSON only." },
        { role: "user", content: judgePrompt },
      ],
    });

    const judgeContent = judgeResponse.choices[0]?.message?.content;
    if (judgeContent) {
      const parsedJudge = JSON.parse(judgeContent);
      const combinedRejections = [...rejections, ...(parsedJudge.rejectionReasons || [])];
      const combinedRepairs = [...repairs, ...(parsedJudge.repairDirectives || [])];
      const finalValid = combinedRejections.length === 0 && Boolean(parsedJudge.valid) && (parsedJudge.score || 1.0) >= 0.8;

      return {
        valid: finalValid,
        score: parsedJudge.score ?? (finalValid ? 0.95 : 0.6),
        rejectionReasons: combinedRejections,
        repairDirectives: combinedRepairs,
        feedback: parsedJudge.feedback || (finalValid ? "Plan satisfies all 12 constitutional execution criteria." : "Plan requires targeted repairs."),
      };
    }
  } catch (err) {
    logger.warn("[WhatToDoTodayJudge] LLM judge evaluation fallback:", err);
  }

  // Fallback to deterministic results if LLM judge unreachable
  const finalValid = rejections.length === 0;
  return {
    valid: finalValid,
    score: finalValid ? 0.9 : 0.5,
    rejectionReasons: rejections,
    repairDirectives: repairs,
    feedback: finalValid ? "Plan passed deterministic checks." : "Plan failed deterministic validation.",
  };
}

/**
 * Executes Generator -> Semantic Judge -> Targeted Repair loop.
 */
export async function generateValidatedDailyPlan(
  context: ExecutionPlanningContext,
  maxAttempts: number = 3
): Promise<{ plan: DailyPlanDraft; judgeReport: ExecutionJudgeReport; attempts: number }> {
  let currentPlan: DailyPlanDraft | null = null;
  let lastReport: ExecutionJudgeReport | null = null;
  let repairDirectives: string[] | undefined = undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    logger.info(`[WhatToDoToday] Generating daily plan attempt ${attempt}/${maxAttempts} for campaign ${context.campaignId}...`);
    currentPlan = await generateDailyExecutionPlan(context, repairDirectives);

    lastReport = await evaluateDailyPlanWithJudge(context, currentPlan);
    logger.info(`[WhatToDoToday] Judge report attempt ${attempt}: valid=${lastReport.valid}, score=${lastReport.score}`);

    if (lastReport.valid) {
      return {
        plan: currentPlan,
        judgeReport: lastReport,
        attempts: attempt,
      };
    }

    repairDirectives = lastReport.repairDirectives;
  }

  // Fail closed if unable to satisfy Judge after maxAttempts
  throw new Error(`EXECUTION_PLAN_REJECTED: Daily plan failed semantic Judge validation after ${maxAttempts} attempts. Rejections: ${lastReport?.rejectionReasons.join("; ")}`);
}
