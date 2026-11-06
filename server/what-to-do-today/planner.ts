/**
 * What To Do Today — LLM Execution Planner
 * 
 * Translates approved strategic intelligence into a realistic, channel-native,
 * prioritized daily execution plan.
 */

import { aiChat } from "../ai-client";
import { ExecutionPlanningContext, DailyPlanDraft, TaskDraft, ChannelPlanItem, ChannelName } from "./contracts";
import { logger } from "../logger";

export async function generateDailyExecutionPlan(
  context: ExecutionPlanningContext,
  repairDirectives?: string[]
): Promise<DailyPlanDraft> {
  const isRepair = Boolean(repairDirectives && repairDirectives.length > 0);

  const approvedChannelsList = context.channelHierarchy.approvedChannels;
  const approvedPlatforms = approvedChannelsList.map(c => c.platform);
  const approvedChannelDescriptions = approvedChannelsList
    .map(
      c =>
        `- ${c.channelName} [Platform: ${c.platform}, Mode: ${c.mode}, Role: ${c.strategicRole}${c.allocationPct !== undefined ? `, Effort/Budget Share: ${c.allocationPct}%` : ""}${c.monthlyAmount !== undefined ? ` (${c.monthlyAmount} ${c.currency || "USD"}/mo)` : ""}]: ${c.rationale || c.primaryObjective || "Approved execution channel"}`
    )
    .join("\n");

  const lanesDescriptions = context.approvedLanes
    .map(l => {
      const stagesStr =
        l.funnelStages && l.funnelStages.length > 0
          ? l.funnelStages.map(s => `${s.stageName} (CTA: "${s.cta || "Learn More"}")`).join(" -> ")
          : "entry -> consideration -> decision -> conversion";
      return `  * Lane [${l.laneId}]: "${l.title}"
    - Core Buying Tension / Pain: ${l.primaryPain || l.buyingTension || "Approved segment pain"}
    - Desires: ${(l.desires || []).slice(0, 3).join("; ") || "Approved buyer desires"}
    - Objections to Overcome: ${(l.objections || []).slice(0, 3).join("; ") || "Approved buyer objections"}
    - Proof Requirements: ${(l.proofRequirements || []).slice(0, 3).join("; ") || context.approvedMechanism.proofArtifact || "Verified product proof"}
    - Funnel Stages & CTAs: ${stagesStr}
    - Primary Conversion CTA: "${l.primaryCta || context.funnelJourney?.ctaPrimary || "Start Free Trial"}" -> ${l.destinationUrl || context.productUrl || "Product Website"}`;
    })
    .join("\n");

  const systemPrompt = `You are the Daily Execution Brain ("What To Do Today").
Your purpose is to translate an approved, canonical marketing strategy for ${context.businessName || "the business"} into a realistic, channel-native, prioritized daily execution plan.

STRICT CONSTITUTIONAL DOCTRINES:
1. STRICT EXECUTION BOUNDARY — NO STRATEGY INVENTION:
   - You MUST NOT invent new target audiences, pains, positioning territories, offers, mechanisms, CTAs, or channels.
   - NEVER use generic B2B templates like "Webinar / Demo", "Target audience operators", or "Serious operators" unless explicitly present in the approved strategy.
   - Every single task MUST explicitly derive from the provided positioning umbrella, approved audience lanes, mechanism, funnel stages, and channel decisions.

2. APPROVED CHANNEL & MODE FIDELITY:
   - Execute ONLY on the campaign's approved channels:
${approvedChannelDescriptions}
   - Primary Strategic Channel: ${context.channelHierarchy.primaryChannel} (${context.channelHierarchy.primaryChannelMode}, Role: PRIMARY). It MUST receive the primary anchor execution priority (MUST_DO) and proportional effort.
   - Supporting / Secondary Channels: ${context.channelHierarchy.supportingChannels.join(", ") || "None (single-channel focus)"}.
   - Rejected Paid Channels (DO NOT USE): ${context.channelHierarchy.rejectedPaidChannels.join(", ") || "None"}.
   - Do NOT generate tasks for channels outside [${approvedPlatforms.join(", ")}].

3. AUDIENCE LANE, FUNNEL STAGE & PROOF CONTINUITY:
   - Maintain one positioning umbrella ("${context.strategyName}") while tailoring tasks to the specific approved audience lanes (${context.approvedLanes.map(l => `${l.laneId}: ${l.title}`).join("; ")}).
   - Each task must specify its target \`laneId\`, \`buyingTension\`, \`funnelStage\` (e.g., entry, consideration, decision, conversion), \`intendedMessage\`, \`proofRequired\`, \`conversionAction\`, and \`ctaDestination\` (including the actual destination URL ${context.productUrl || ""}).
   - Allow natural creative variation in hooks and formats (Reels, TikTok short-form stories, carousels, interactive stories, proof breakdowns) appropriate to the approved platforms.

4. REALISTIC OPERATIONAL CAPACITY:
   - Generate a focused, realistic day's work (4 to 6 tasks total):
     * MUST_DO: 2–3 high-impact core strategic execution tasks anchored on ${context.channelHierarchy.primaryChannel} and key lane stages.
     * SHOULD_DO: 1–2 high-value supporting distribution or secondary channel (${context.channelHierarchy.supportingChannels.join(", ") || context.channelHierarchy.primaryChannel}) tasks.
     * OPTIONAL / WAITING_BLOCKED: 0–1 task if applicable.

5. TODAY'S MISSION:
   - Generate ONE concise, compelling strategic mission sentence for today grounded strictly in the approved positioning, mechanism, and funnel conversion path.

6. BUDGET & MODE COMPLIANCE:
   - Operational mode is ${context.budgetConstraints.operationalMode}.
   - Total Budget: ${context.budgetConstraints.totalBudget || "Organic-First"}.
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
      "taskType": "CONTENT" | "PROOF_ASSET" | "DISTRIBUTION" | "MARKET_LEARNING" | "CONVERSION" | "OPTIMIZATION",
      "channel": ${approvedPlatforms.map(p => `"${p}"`).join(" | ")},
      "channelMode": "ORGANIC" | "PAID",
      "channelRole": "PRIMARY" | "SECONDARY" | "SUPPORTING",
      "laneId": ${context.approvedLanes.map(l => `"${l.laneId}"`).join(" | ") || '"lane_1"'},
      "funnelStage": "entry" | "consideration" | "decision" | "conversion",
      "buyingTension": "Specific buyer pain/tension addressed by this task",
      "intendedMessage": "Core strategic message and belief shift delivered",
      "objective": "Strategic objective achieved by this task",
      "reason": "Why this specific task matters for today's plan",
      "expectedOutcome": "Concrete tangible deliverable or response expected",
      "sourceAuthority": "MECHANISM" | "PERSUASION" | "POSITIONING" | "AWARENESS" | "FUNNEL" | "DIFFERENTIATION" | "OFFER" | "CHANNEL_SELECTION",
      "estimatedEffort": "e.g. 45 mins, 90 mins",
      "dependencies": ["optional title of prerequisite task"],
      "executionApproach": "Step-by-step actionable instructions",
      "proofRequired": "Specific approved proof asset or evidence point to embed",
      "conversionAction": "Specific approved stage CTA text",
      "ctaDestination": "Specific approved CTA and destination URL (e.g. Generate Your Free Trial Song -> ${context.productUrl || ""})"
    }
  ],
  "channelPlan": [
    {
      "channel": ${approvedPlatforms.map(p => `"${p}"`).join(" | ")},
      "mode": "ORGANIC" | "PAID",
      "role": "PRIMARY" | "SECONDARY" | "SUPPORTING",
      "executionIntent": "Summary of what this approved channel accomplishes in today's strategy",
      "whyToday": "Why this channel is utilized in today's sequence",
      "currentTaskTitle": "Title of the primary task running on this channel today",
      "coverageState": "ACTIVE" | "PENDING_PREREQUISITE" | "ROTATION_DUE"
    }
  ]
}`;

  const userPrompt = `Generate the What To Do Today execution plan for campaign ${context.campaignId} (${context.businessName || "Campaign"}) on date ${context.businessDate}.

CANONICAL STRATEGY CONTEXT (Plan v${context.strategicPlanVersion}, Root Bundle v${context.rootBundleVersion}):
- Positioning Umbrella: ${context.strategyName}
- Positioning Narrative: ${context.positioningSummary}
- Primary Contrast Axis: ${context.contrastAxis}
- Approved Mechanism: ${context.approvedMechanism.mechanismName} (${context.approvedMechanism.corePrinciple || "Approved Principle"})
- Approved Promise: ${context.approvedPromise}
- Product / Conversion URL: ${context.productUrl || "Product Website"}
- Differentiation Pillars: ${context.differentiationPillars?.join("; ") || "Approved Differentiation"}
- Approved Audience Lanes & Funnel Stages:
${lanesDescriptions}
- Funnel Conversion Path: ${context.funnelJourney?.conversionPath}
- Primary CTA: ${context.funnelJourney?.ctaPrimary}
- Approved Channels:
${approvedChannelDescriptions}
- Budget & Spend Rule: ${context.budgetConstraints.totalBudget} — ${context.budgetConstraints.spendRule}
- Strategic Focus: ${context.strategicGoals.strategicFocus}`;

  try {
    const response = await aiChat({
      model: "gpt-4o-mini",
      temperature: 0.2,
      accountId: context.accountId,
      endpoint: "what-to-do-today-planner",
      response_format: { type: "json_object" },
      max_tokens: 3000,
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

    if (!parsed.dailyMission || !Array.isArray(parsed.tasks)) {
      throw new Error("INVALID_PLAN_SHAPE: Missing dailyMission or tasks array in planner output.");
    }

    // Deterministic normalization against approved strategy contracts
    const validLaneIds = new Set(context.approvedLanes.map(l => l.laneId));
    const distinctValidLanesUsed = new Set(
      parsed.tasks.map(t => t.laneId).filter((id): id is string => Boolean(id && validLaneIds.has(id)))
    );
    const shouldDistributeAcrossApprovedLanes =
      context.approvedLanes.length > 1 &&
      parsed.tasks.length >= context.approvedLanes.length &&
      distinctValidLanesUsed.size < context.approvedLanes.length;

    parsed.tasks = parsed.tasks.map((t, idx) => {
      const normalizedCh = approvedPlatforms.includes(t.channel as ChannelName)
        ? (t.channel as ChannelName)
        : idx === 0
          ? context.channelHierarchy.primaryChannel
          : (context.channelHierarchy.supportingChannels[idx % Math.max(1, context.channelHierarchy.supportingChannels.length)] ||
             context.channelHierarchy.primaryChannel);

      const channelDecision =
        approvedChannelsList.find(c => c.platform === normalizedCh) ||
        context.channelHierarchy.primaryChannelDecision;

      const resolvedLane =
        (!shouldDistributeAcrossApprovedLanes && t.laneId && validLaneIds.has(t.laneId)
          ? context.approvedLanes.find(l => l.laneId === t.laneId)
          : context.approvedLanes[idx % context.approvedLanes.length]) || context.approvedLanes[0];

      const resolvedStage =
        t.funnelStage ||
        resolvedLane?.funnelStages?.[idx % Math.max(1, resolvedLane?.funnelStages?.length || 1)]?.stageName ||
        "consideration";

      const matchingStageObj = resolvedLane?.funnelStages?.find(s => s.stageName === resolvedStage);
      const lanePrimaryCta =
        resolvedLane?.primaryCta ||
        matchingStageObj?.cta ||
        context.funnelJourney?.ctaPrimary ||
        "Start Your Free Song Trial";
      const cleanCtaAction =
        matchingStageObj?.conversionAction ||
        t.conversionAction ||
        lanePrimaryCta;

      const rawDest = String(t.ctaDestination || "").trim();
      const isInvalidDest =
        !rawDest ||
        /webinar|demo/i.test(rawDest) ||
        rawDest === "undefined";
      const isBareUrl = /^https?:\/\/\S+$/i.test(rawDest);

      const finalDestination = isInvalidDest
        ? `${lanePrimaryCta}${context.productUrl ? ` (${context.productUrl})` : ""}`
        : isBareUrl
          ? `${lanePrimaryCta} (${rawDest})`
          : rawDest.includes("http") || !context.productUrl
            ? rawDest
            : `${rawDest} (${context.productUrl})`;

      return {
        ...t,
        channel: normalizedCh,
        channelMode: channelDecision.mode,
        channelRole: normalizedCh === context.channelHierarchy.primaryChannel ? "PRIMARY" : "SUPPORTING",
        laneId: resolvedLane.laneId,
        funnelStage: resolvedStage,
        buyingTension: t.buyingTension || resolvedLane.primaryPain || resolvedLane.buyingTension,
        intendedMessage: t.intendedMessage || t.objective,
        proofRequired: t.proofRequired || resolvedLane.proofRequirements?.[0] || context.approvedMechanism.proofArtifact,
        conversionAction: cleanCtaAction,
        ctaDestination: finalDestination,
        destinationUrl: context.productUrl,
        sourceStrategyVersion: context.strategicPlanVersion,
      };
    });

    // Build channelPlan strictly from the campaign's approved channels
    parsed.channelPlan = approvedChannelsList.map(chDec => {
      const existingPlanItem = Array.isArray(parsed.channelPlan)
        ? parsed.channelPlan.find(p => p.channel === chDec.platform)
        : undefined;
      const matchingTask = parsed.tasks.find(t => t.channel === chDec.platform);
      const isPrimary = chDec.platform === context.channelHierarchy.primaryChannel;
      const isPrerequisiteGated = chDec.readinessStatus === "PREREQUISITE_GATED";

      return {
        channel: chDec.platform,
        mode: chDec.mode,
        role: isPrimary ? "PRIMARY" : chDec.strategicRole || "SUPPORTING",
        allocationPct: chDec.allocationPct,
        monthlyAmount: chDec.monthlyAmount,
        executionIntent: isPrerequisiteGated
          ? `${chDec.channelName} (${chDec.allocationPct ?? 35}% conditional full-budget allocation = $${(chDec.monthlyAmount ?? 1750).toLocaleString("en-US")}/mo): Gated on warm retargeting pool (>= ${chDec.requiredWarmAudiencePool ?? 1000} engaged TikTok users & >= ${chDec.requiredLandingPageVisits ?? 1500} landing page visits) and active conversion measurement.`
          : existingPlanItem?.executionIntent ||
            chDec.rationale ||
            (isPrimary
              ? `Primary ${chDec.mode.toLowerCase()} storytelling and proof anchor (${chDec.allocationPct ?? 60}% effort share)`
              : `Supporting ${chDec.mode.toLowerCase()} discovery and reach engine (${chDec.allocationPct ?? 40}% effort share)`),
        whyToday: isPrerequisiteGated
          ? chDec.prerequisiteSummary ||
            "Prerequisite-gated: awaiting >= 1,000 engaged TikTok retargeting pool members and verified conversion tracking before ad spend deployment."
          : existingPlanItem?.whyToday ||
            (matchingTask
              ? `Active ${chDec.mode.toLowerCase()} execution scheduled for today`
              : "Supporting channel staged in campaign rotation"),
        currentTaskTitle: matchingTask?.title,
        coverageState: isPrerequisiteGated
          ? "PENDING_PREREQUISITE"
          : matchingTask
            ? "ACTIVE"
            : "ROTATION_DUE",
      };
    });

    return parsed;
  } catch (err: any) {
    logger.error("[WhatToDoTodayPlanner] Planning failed:", err);
    throw err;
  }
}
