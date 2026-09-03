/**
 * What To Do Today — LLM Execution Planner
 * 
 * Translates approved strategic intelligence into a realistic, channel-native,
 * prioritized daily execution plan.
 */

import { aiChat } from "../ai-client";
import { ExecutionPlanningContext, DailyPlanDraft, TaskDraft, ChannelPlanItem } from "./contracts";
import { logger } from "../logger";

export async function generateDailyExecutionPlan(
  context: ExecutionPlanningContext,
  repairDirectives?: string[]
): Promise<DailyPlanDraft> {
  const isRepair = Boolean(repairDirectives && repairDirectives.length > 0);

  const systemPrompt = `You are the Daily Execution Brain ("What To Do Today").
Your purpose is to translate an approved, canonical B2B SaaS marketing strategy into a realistic, channel-native, prioritized daily execution plan for a marketing team.

STRICT CONSTITUTIONAL DOCTRINES:
1. STRICT EXECUTION BOUNDARY — NO STRATEGY INVENTION:
   - You MUST NOT invent new target audiences, pains, positioning territories, offers, mechanisms, CTAs, or channels.
   - Every single task MUST explicitly derive from the provided approved lanes, mechanism, positioning, and persuasion strategy.

2. PRIMARY CHANNEL EMPHASIS:
   - The selected primary channel (${context.channelHierarchy.primaryChannel}) MUST receive the greatest strategic weight, asset depth, and execution priority (e.g. MUST_DO anchor asset).

3. FULL CHANNEL ECOSYSTEM NATIVENESS:
   - Actively execute across the supported ecosystem: YouTube, Instagram, TikTok, Facebook, and X.
   - NEVER copy-paste the same copy or format across platforms.
   - Adapt each execution natively:
     * YouTube: Authoritative proof breakdown, live mechanism demo, or deep strategic contrast.
     * Instagram: Visual proof carousel, save/share-optimized infographics, or strategic takeaways.
     * TikTok: Fast-hook contrast video, surprising competitor intelligence insight, or mechanism curiosity hook.
     * Facebook: Operator community teardown, practitioner workflow case study, or discussion-oriented proof.
     * X: Sharp strategic argument, live intelligence thread, or market insight commentary.

4. CROSS-CHANNEL ASSET DERIVATION & DEPENDENCY:
   - The primary anchor asset provides proof, clips, and data for supporting channels.
   - If a supporting channel task relies on the primary asset being produced today, clearly sequence it or note the dependency.

5. REALISTIC OPERATIONAL CAPACITY:
   - Do NOT output 15–30 overwhelming tasks.
   - Generate a focused, realistic day's work (total 4 to 7 tasks):
     * MUST_DO: 2–3 high-impact core strategic execution tasks.
     * SHOULD_DO: 2–3 high-value supporting distribution or preparation tasks.
     * WAITING_BLOCKED: 0–1 tasks waiting on prerequisite assets (if applicable).
     * OPTIONAL: 0–1 if capacity allows.

6. TODAY'S MISSION:
   - Generate ONE concise, compelling strategic mission sentence for today grounded strictly in the approved strategy, mechanism, and funnel.
   - Do NOT use generic fluff like "Grow your brand" or "Post more content".

7. BUDGET & MODE COMPLIANCE:
   - Operational mode is ${context.budgetConstraints.operationalMode}.
   - ${context.budgetConstraints.spendRule}.

${isRepair ? `\nCRITICAL REPAIR INSTRUCTIONS FROM SEMANTIC JUDGE:\n${repairDirectives?.map(d => `- ${d}`).join("\n")}\nYou must fix all listed violations while preserving valid elements.\n` : ""}

Return a structured JSON object strictly matching this schema:
{
  "dailyMission": "One clear strategic mission sentence for today",
  "executionRationale": "Brief explanation of why this specific sequence of tasks moves the approved strategy forward today",
  "tasks": [
    {
      "title": "Clear, actionable task title",
      "description": "Detailed description of what to produce or execute",
      "priority": "MUST_DO" | "SHOULD_DO" | "OPTIONAL" | "WAITING_BLOCKED",
      "taskType": "CONTENT" | "PROOF_ASSET" | "DISTRIBUTION" | "MARKET_LEARNING" | "SALES_OUTREACH" | "CONVERSION" | "FOLLOW_UP" | "MEASUREMENT" | "OPTIMIZATION",
      "channel": "YOUTUBE" | "INSTAGRAM" | "TIKTOK" | "FACEBOOK" | "X" | "WEBSITE" | "EMAIL",
      "channelRole": "PRIMARY" | "SUPPORTING" | "TESTING",
      "laneId": "id of approved lane this supports (e.g. lane_1 or lane_2)",
      "objective": "Strategic objective achieved by this task",
      "reason": "Why this specific task matters for today's plan",
      "expectedOutcome": "Concrete tangible deliverable or response expected",
      "sourceAuthority": "MECHANISM" | "PERSUASION" | "POSITIONING" | "AWARENESS" | "FUNNEL" | "DIFFERENTIATION" | "OFFER",
      "estimatedEffort": "e.g. 45 mins, 2 hours",
      "dependencies": ["optional title or ID of prerequisite task"],
      "executionApproach": "Step-by-step actionable instructions for the operator",
      "proofRequired": "Specific proof asset or evidence point to embed",
      "ctaDestination": "Specific funnel destination or CTA"
    }
  ],
  "channelPlan": [
    {
      "channel": "YOUTUBE" | "INSTAGRAM" | "TIKTOK" | "FACEBOOK" | "X",
      "role": "PRIMARY" | "SUPPORTING",
      "executionIntent": "Summary of what this platform accomplishes in today's strategy",
      "whyToday": "Why this channel is utilized or waiting in today's sequence",
      "currentTaskTitle": "Title of the task running on this channel today (or null if waiting)",
      "coverageState": "ACTIVE" | "PENDING_PREREQUISITE" | "UNTESTED" | "ROTATION_DUE"
    }
  ]
}`;

  const userPrompt = `Generate the What To Do Today execution plan for campaign ${context.campaignId} on date ${context.businessDate}.

CANONICAL STRATEGY CONTEXT:
- Strategy Name: ${context.strategyName}
- Primary Contrast Axis: ${context.contrastAxis}
- Approved Mechanism: ${context.approvedMechanism.mechanismName} (${context.approvedMechanism.corePrinciple || "Approved Principle"})
- Approved Promise: ${context.approvedPromise}
- Strategic Lanes:
${context.approvedLanes.map(l => `  * [${l.laneId}] ${l.title} (Primary Pain: ${l.primaryPain || "Target Pain"})`).join("\n")}
- Positioning: ${context.positioningSummary}
- Differentiation Pillars: ${context.differentiationPillars?.join("; ") || "Approved Differentiation"}
- Trust Strategy: ${context.persuasionTrust?.transferMechanismName || "Approved Trust Mechanism"} (Risk State: ${context.persuasionTrust?.buyerRiskState || "Target Risk"})
- Funnel Destination: ${context.funnelJourney?.conversionPath || "Approved Funnel"} (Lead Magnet: ${context.funnelJourney?.leadMagnet || "Approved Lead Magnet"}, Primary CTA: ${context.funnelJourney?.ctaPrimary || "Approved CTA"})
- Channel Hierarchy: Primary = ${context.channelHierarchy.primaryChannel}, Supporting = ${context.channelHierarchy.supportingChannels.join(", ")}
- Spend Rule: ${context.budgetConstraints.spendRule}
- Strategic Focus: ${context.strategicGoals.strategicFocus}`;

  try {
    const response = await aiChat({
      model: "gpt-4o-mini",
      temperature: 0.2,
      accountId: context.accountId,
      endpoint: "what-to-do-today-planner",
      response_format: { type: "json_object" },
      max_tokens: 2800,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("EMPTY_LLM_RESPONSE: Planner returned empty message content.");
    }

    const parsed: DailyPlanDraft = JSON.parse(content);

    // Basic structure sanitation
    if (!parsed.dailyMission || !Array.isArray(parsed.tasks)) {
      throw new Error("INVALID_PLAN_SHAPE: Missing dailyMission or tasks array in planner output.");
    }

    // Ensure all 5 core channels are accounted for in channelPlan
    const coreChannels: ChannelName[] = ["YOUTUBE", "INSTAGRAM", "TIKTOK", "FACEBOOK", "X"];
    if (!Array.isArray(parsed.channelPlan)) {
      parsed.channelPlan = [];
    }

    for (const ch of coreChannels) {
      if (!parsed.channelPlan.some(p => p.channel === ch)) {
        const isPrimary = ch === context.channelHierarchy.primaryChannel;
        const matchingTask = parsed.tasks.find(t => t.channel === ch);
        parsed.channelPlan.push({
          channel: ch,
          role: isPrimary ? "PRIMARY" : "SUPPORTING",
          executionIntent: isPrimary ? "Anchor proof demonstration and deep authority" : `Native supporting distribution of core ${context.strategyName} insights`,
          whyToday: matchingTask ? "Active native execution scheduled for today" : "Supporting channel staged for derivative execution",
          currentTaskTitle: matchingTask?.title,
          coverageState: matchingTask ? "ACTIVE" : "PENDING_PREREQUISITE",
        });
      }
    }

    return parsed;
  } catch (err: any) {
    logger.error("[WhatToDoTodayPlanner] Planning failed:", err);
    throw err;
  }
}
