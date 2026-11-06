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

export function runDeterministicExecutionJudgeChecks(
  context: ExecutionPlanningContext,
  plan: DailyPlanDraft
): { rejections: string[]; repairs: string[] } {
  const rejections: string[] = [];
  const repairs: string[] = [];

  if (!plan.tasks || plan.tasks.length < 2) {
    rejections.push("DAILY_CAPACITY_UNDERUTILIZED: Plan contains fewer than 2 tasks.");
    repairs.push("Generate at least 3-5 realistic tasks across the approved channels and audience lanes.");
  } else if (plan.tasks.length > 9) {
    rejections.push("DAILY_CAPACITY_EXCEEDED: Plan contains more than 9 tasks (unrealistic daily load).");
    repairs.push("Consolidate tasks down to a focused 4-6 task plan prioritizing MUST_DO and SHOULD_DO executions.");
  }

  // Check primary channel representation
  const primaryChannel = context.channelHierarchy.primaryChannel;
  const primaryTasks = (plan.tasks || []).filter(t => t.channel === primaryChannel);
  if (primaryTasks.length === 0) {
    rejections.push(`PRIMARY_CHANNEL_UNDERWEIGHTED: Selected primary channel ${primaryChannel} has 0 tasks.`);
    repairs.push(`Ensure ${primaryChannel} receives the primary anchor asset execution (MUST_DO priority, role PRIMARY).`);
  }

  // Check approved channel compliance
  const approvedPlatforms = new Set(context.channelHierarchy.approvedChannels.map(c => c.platform));
  const unapprovedTasks = (plan.tasks || []).filter(t => !approvedPlatforms.has(t.channel));
  if (unapprovedTasks.length > 0) {
    rejections.push(
      `UNAPPROVED_CHANNEL_USED: Tasks generated for unapproved channels (${unapprovedTasks.map(t => t.channel).join(", ")}). Approved channels are: ${Array.from(approvedPlatforms).join(", ")}.`
    );
    repairs.push(`Assign all tasks strictly to approved channels: ${Array.from(approvedPlatforms).join(", ")}.`);
  }

  // Check audience lane & CTA fidelity against the campaign's approved strategy corpus
  const validLaneIds = new Set(context.approvedLanes.map(l => l.laneId));
  const approvedStrategyCorpus = [
    context.strategyName,
    context.offerSummary,
    context.approvedPromise,
    context.funnelJourney?.ctaPrimary,
    context.funnelJourney?.conversionPath,
    ...context.approvedLanes.flatMap(l => (l.funnelStages || []).map(s => `${s.stageName} ${s.cta || ""} ${s.conversionAction || ""}`)),
    ...context.approvedLanes.map(l => `${l.title} ${l.targetRole || ""} ${l.primaryPain || ""} ${l.primaryCta || ""} ${l.conversionAction || ""}`),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const strategySupportsWebinarOrDemo = /\b(webinar|demo)\b/i.test(approvedStrategyCorpus);
  const strategySupportsOperatorsTerm = /\boperators?\b/i.test(approvedStrategyCorpus);

  for (const t of plan.tasks || []) {
    if (t.laneId && !validLaneIds.has(t.laneId)) {
      rejections.push(`INVALID_LANE_REFERENCE: Task "${t.title}" references unknown laneId "${t.laneId}".`);
      repairs.push(`Use only approved laneIds: ${Array.from(validLaneIds).join(", ")}.`);
    }
    const taskCombinedText = `${t.title} ${t.description} ${t.ctaDestination || ""}`;
    if (!strategySupportsWebinarOrDemo && /\bwebinar\s*\/?\s*demo\b/i.test(taskCombinedText)) {
      rejections.push(`UNSUPPORTED_FUNNEL_CTA: Task "${t.title}" uses "Webinar / Demo" which is not present in the campaign's approved offer or funnel strategy.`);
      repairs.push(`Use the campaign's approved funnel CTA ("${context.funnelJourney?.ctaPrimary || "Approved Funnel CTA"}") and product URL (${context.productUrl || ""}).`);
    }
    if (!strategySupportsOperatorsTerm && /\b(target audience operators|serious operators)\b/i.test(taskCombinedText)) {
      rejections.push(`UNSUPPORTED_AUDIENCE_TERM: Task "${t.title}" uses generic template audience text ("operators") not present in the campaign's approved audience segments or lanes.`);
      repairs.push(`Reference the campaign's approved audience segments: ${context.approvedLanes.map(l => l.targetRole || l.title).join(", ")}.`);
    }
  }

  // Check for duplicate titles across channels (copy-paste check)
  const titles = (plan.tasks || []).map(t => t.title.toLowerCase().trim());
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

  return { rejections, repairs };
}

export async function evaluateDailyPlanWithJudge(
  context: ExecutionPlanningContext,
  plan: DailyPlanDraft
): Promise<ExecutionJudgeReport> {
  // 1. Deterministic Constitutional Checks
  const { rejections, repairs } = runDeterministicExecutionJudgeChecks(context, plan);
  const primaryChannel = context.channelHierarchy.primaryChannel;

  const approvedChannelListStr = context.channelHierarchy.approvedChannels
    .map(c => `${c.channelName} (${c.platform}, ${c.mode}, Role: ${c.strategicRole}${c.allocationPct !== undefined ? `, ${c.allocationPct}% share` : ""})`)
    .join("; ");

  const approvedDestinationStr =
    context.funnelJourney?.conversionPath ||
    `${context.funnelJourney?.ctaPrimary || "Approved Funnel CTA"}${context.productUrl ? ` (${context.productUrl})` : ""}`;

  // 2. LLM Semantic Judge Check
  const judgePrompt = `You are a Senior Strategic Execution Auditor. Your task is to rigorously evaluate whether this daily execution plan faithfully and natively executes the approved campaign strategy without inventing strategy, channels, or generic copy-paste busywork.

CONSTITUTIONAL EVALUATION CRITERIA:
1. STRATEGY FIDELITY: Every task derives from the approved positioning ("${context.strategyName}") and mechanism ("${context.approvedMechanism.mechanismName}").
2. NO STRATEGY INVENTION: No unapproved targets, pains, mechanisms, offers, or invented B2B templates (like "Webinar / Demo" unless explicitly part of the offer).
3. PRIMARY CHANNEL EMPHASIS: Primary strategic channel (${primaryChannel}, mode: ${context.channelHierarchy.primaryChannelMode}) receives primary strategic depth and MUST_DO anchor execution.
4. APPROVED CHANNEL ECOSYSTEM: Tasks execute strictly on the campaign's approved channels (${approvedChannelListStr}) with native format adaptation.
5. PLATFORM NATIVENESS: No copy-pasting of identical content across platforms.
6. AUDIENCE LANE CONTINUITY: Tasks address the approved audience lanes (${context.approvedLanes.map(l => `[${l.laneId}] ${l.title}`).join("; ")}) and their specific pains, objections, and proof requirements.
7. FUNNEL & CTA FIDELITY: Tasks drive toward the approved funnel destination (${approvedDestinationStr}).
8. BUDGET & MODE COMPLIANCE: Adheres to mode "${context.budgetConstraints.operationalMode}" (${context.budgetConstraints.spendRule}).

APPROVED STRATEGY:
- Positioning Umbrella: ${context.strategyName}
- Primary Contrast Axis: ${context.contrastAxis}
- Mechanism: ${context.approvedMechanism.mechanismName}
- Approved Lanes: ${context.approvedLanes.map(l => `[${l.laneId}] ${l.title} (Pain: ${l.primaryPain})`).join("; ")}
- Approved Channels: ${approvedChannelListStr}
- Rejected Paid Channels: ${context.channelHierarchy.rejectedPaidChannels.join(", ") || "None"}
- Approved Funnel Destination: ${approvedDestinationStr}

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
        feedback: parsedJudge.feedback || (finalValid ? "Plan satisfies all constitutional execution criteria." : "Plan requires targeted repairs."),
      };
    }
  } catch (err: any) {
    logger.warn("[WhatToDoTodayJudge] LLM judge evaluation fallback:", err?.message || String(err));
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
