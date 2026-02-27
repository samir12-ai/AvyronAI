import type { Express, Request, Response } from "express";
import { aiChat, AICallError } from "../ai-client";
import { db } from "../db";
import { strategicBlueprints, strategicPlans, planApprovals, strategyMemory, strategyInsights, moatCandidates, businessDataLayer, planDocuments, requiredWork, calendarEntries, orchestratorJobs } from "@shared/schema";
import { eq, desc, gte, and, sql, ne } from "drizzle-orm";
import { logAuditEvent } from "./audit-logger";
import { logAudit } from "../audit";
import * as crypto from "crypto";

const REQUIRED_BLUEPRINT_FIELDS: { key: string; label: string }[] = [
  { key: "detectedOffer", label: "Offer" },
  { key: "detectedCTA", label: "Call to Action" },
  { key: "detectedAudienceGuess", label: "Target Audience" },
  { key: "detectedPositioning", label: "Positioning" },
];

function generateFallbackPlan(params: {
  confirmedBlueprint: any;
  campaignContext: any;
  competitorUrls: string[];
  businessData: any;
}): any {
  const { confirmedBlueprint, campaignContext, competitorUrls, businessData } = params;
  const objective = campaignContext?.objective || "AWARENESS";
  const location = campaignContext?.location || "Not specified";
  const offer = confirmedBlueprint?.detectedOffer || "Core offer";
  const cta = confirmedBlueprint?.detectedCTA || "Contact us";
  const audience = confirmedBlueprint?.detectedAudienceGuess || "Target audience";

  return {
    fallback: true,
    fallbackReason: "AI generation timed out or failed. This is a deterministic skeleton plan. You can approve it and refine later, or retry generation.",
    contentDistributionPlan: {
      platforms: [
        {
          platform: "Instagram",
          frequency: "5x per week",
          priority: "primary",
          contentTypes: [
            { type: "Reels", percentage: "40%", weeklyCount: 2, rationale: `High reach format for ${objective.toLowerCase()} in ${location}` },
            { type: "Posts", percentage: "30%", weeklyCount: 2, rationale: `Educational content about ${offer}` },
            { type: "Stories", percentage: "20%", weeklyCount: 3, rationale: "Daily engagement and behind-the-scenes" },
            { type: "Carousels", percentage: "10%", weeklyCount: 1, rationale: `In-depth value content for ${audience}` },
          ],
          bestPostingTimes: ["9:00 AM", "12:00 PM", "6:00 PM"],
          hashtagStrategy: `Mix of niche and location-based hashtags for ${location}`,
        },
      ],
      contentPillars: [
        { pillar: "Educational", percentage: "40%", examples: [`How-to content about ${offer}`] },
        { pillar: "Social Proof", percentage: "30%", examples: ["Testimonials, case studies"] },
        { pillar: "Behind the Scenes", percentage: "20%", examples: ["Process, team, culture"] },
        { pillar: "Promotional", percentage: "10%", examples: [`Direct CTA: ${cta}`] },
      ],
    },
    creativeTestingMatrix: {
      tests: [
        { testName: "Hook Variations", variable: "Opening 3 seconds", duration: "2 weeks", rationale: `Test different hooks for ${audience}` },
        { testName: "CTA Placement", variable: "CTA position and format", duration: "2 weeks", rationale: `Optimize ${cta} conversion` },
        { testName: "Content Format", variable: "Reels vs Carousels vs Posts", duration: "3 weeks", rationale: `Find best format for ${objective.toLowerCase()} in ${location}` },
      ],
    },
    budgetAllocationStructure: {
      totalRecommended: businessData?.monthlyBudget || "Based on campaign budget",
      breakdown: [
        { category: "Content Creation", percentage: 40, purpose: "High-quality visuals and video production" },
        { category: "Paid Promotion", percentage: 30, purpose: `Boosting top-performing content for ${objective.toLowerCase()}` },
        { category: "Community & Engagement", percentage: 15, purpose: "Community management and influencer partnerships" },
        { category: "Tools & Analytics", percentage: 15, purpose: "Scheduling, analytics, and optimization tools" },
      ],
    },
    kpiMonitoringPriority: {
      primaryKPIs: [
        { kpi: "Reach", target: "+20% month-over-month", frequency: "Weekly", alertThreshold: "-10% week-over-week" },
        { kpi: "Engagement Rate", target: "3-5%", frequency: "Weekly", alertThreshold: "Below 2%" },
        { kpi: "Profile Visits", target: "+15% monthly", frequency: "Weekly", alertThreshold: "Declining 2 weeks" },
      ],
      secondaryKPIs: [
        { kpi: "Story Views", target: "10% of followers", frequency: "Weekly" },
        { kpi: "Saves", target: "2% of reach", frequency: "Weekly" },
      ],
      reportingCadence: "Weekly review, monthly deep-dive",
    },
    competitiveWatchTargets: {
      targets: competitorUrls.slice(0, 3).map((url: string) => ({
        competitor: url,
        watchMetrics: ["Posting frequency", "Engagement rate", "Content types", "Follower growth"],
        alertTriggers: ["New campaign launch", "Viral content (10x avg engagement)", "Strategy shift"],
        checkFrequency: "Weekly",
      })),
    },
    riskMonitoringTriggers: {
      triggers: [
        { trigger: "Engagement Drop", condition: "Engagement rate below 2% for 2 consecutive weeks", action: "Review content mix and posting times", severity: "high" },
        { trigger: "Reach Plateau", condition: "Reach flat for 3 weeks", action: "Test new content formats and hashtags", severity: "medium" },
        { trigger: "Negative Sentiment", condition: "3+ negative comments in a week", action: "Review content tone and respond promptly", severity: "high" },
        { trigger: "Algorithm Change", condition: "Sudden reach drop >30%", action: "Diversify content formats", severity: "critical" },
      ],
      escalationPath: ["Content review", "Strategy adjustment", "Full plan revision"],
    },
  };
}

function capText(text: string | undefined | null, maxLen: number): string {
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "... [trimmed]";
}

function capJson(obj: any, maxLen: number): string {
  if (!obj) return "";
  const str = typeof obj === "string" ? obj : JSON.stringify(obj);
  return capText(str, maxLen);
}

function validateBlueprintCompleteness(confirmedBlueprint: any): { valid: boolean; missingFields: string[] } {
  const missingFields: string[] = [];

  for (const { key, label } of REQUIRED_BLUEPRINT_FIELDS) {
    const value = confirmedBlueprint[key];
    if (!value || value === "INSUFFICIENT_DATA" || value === "null" || value === "") {
      missingFields.push(label);
    }
  }

  return { valid: missingFields.length === 0, missingFields };
}


const ORCHESTRATOR_PROMPT = `You are an execution orchestrator. You do NOT think. You do NOT reinterpret. You do NOT override the confirmed blueprint.

You organize execution STRICTLY from the validated, confirmed blueprint, market map, AND Business Data Layer.

CRITICAL: The confirmed blueprint is the ONLY source of truth for positioning. The Business Data Layer is the ONLY source of truth for distribution parameters (business type, funnel objective, budget, conversion channel).

DISTRIBUTION DERIVATION RULES — Content mix MUST be derived from the Business Data Layer:
- Business type determines content format mix (e.g., visual businesses need more Reels/Videos, service businesses need more educational Posts/Carousels)
- Funnel objective determines content purpose distribution:
  - AWARENESS → heavy on Reels + Stories (high reach formats)
  - LEADS → heavy on Carousels + Posts with lead magnets, plus Stories for engagement
  - SALES → balanced Reels + Posts + Carousels with strong CTAs
  - AUTHORITY → heavy on Carousels + long-form Posts, fewer Stories
- Monthly budget determines total volume (lower budget = fewer pieces, higher budget = more pieces)
- Primary conversion channel determines CTA placement:
  - WHATSAPP → CTAs direct to WhatsApp in bio/DM
  - WEBSITE → CTAs drive to website link
  - DM → CTAs encourage DM engagement
  - FORM → CTAs link to lead forms

DO NOT use hardcoded defaults like "3 Reels/week, 3 Posts/week". Every distribution number must be justified by the business profile.

You must generate exactly 6 structured execution plans. All output must be structured objects.

All plans must be geo-scoped to the specified LOCATION. No global assumptions.

Respond with ONLY a valid JSON object. Keep each section concise (3-5 items max per array):
{
  "contentDistributionPlan": {
    "platforms": [
      {
        "platform": "string",
        "frequency": "string",
        "priority": "primary|secondary",
        "contentTypes": [
          { "type": "string", "percentage": "string", "weeklyCount": "number", "rationale": "string" }
        ],
        "bestPostingTimes": ["string"],
        "hashtagStrategy": "string"
      }
    ],
    "contentPillars": [
      { "pillar": "string", "percentage": "string", "examples": ["string"] }
    ]
  },
  "creativeTestingMatrix": {
    "tests": [
      { "testName": "string", "variable": "string", "duration": "string", "rationale": "string" }
    ]
  },
  "budgetAllocationStructure": {
    "totalRecommended": "string",
    "breakdown": [
      { "category": "string", "percentage": "number", "purpose": "string" }
    ]
  },
  "kpiMonitoringPriority": {
    "primaryKPIs": [
      { "kpi": "string", "target": "string", "frequency": "string", "alertThreshold": "string" }
    ],
    "secondaryKPIs": [
      { "kpi": "string", "target": "string", "frequency": "string" }
    ],
    "reportingCadence": "string"
  },
  "competitiveWatchTargets": {
    "targets": [
      { "competitor": "string", "watchMetrics": ["string"], "alertTriggers": ["string"], "checkFrequency": "string" }
    ]
  },
  "riskMonitoringTriggers": {
    "triggers": [
      { "trigger": "string", "condition": "string", "action": "string", "severity": "low|medium|high|critical" }
    ],
    "escalationPath": ["string"]
  }
}`;

function generatePlanMarkdown(params: {
  blueprint: any;
  confirmedBlueprint: any;
  plan: any;
  planJson: any;
  work: any;
  calendarCount: number;
}): string {
  const { blueprint, confirmedBlueprint, plan, planJson, work, calendarCount } = params;
  const lines: string[] = [];
  const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  lines.push(`# Strategic Execution Plan`);
  lines.push(`**Generated:** ${date}`);
  lines.push(`**Plan ID:** ${plan.id}`);
  lines.push(`**Status:** ${plan.status}`);
  lines.push(`**Blueprint Version:** ${blueprint.blueprintVersion || "N/A"}`);
  lines.push("");

  if (confirmedBlueprint) {
    lines.push(`## Blueprint Summary`);
    if (confirmedBlueprint.detectedOffer) lines.push(`- **Offer:** ${confirmedBlueprint.detectedOffer}`);
    if (confirmedBlueprint.detectedCTA) lines.push(`- **CTA:** ${confirmedBlueprint.detectedCTA}`);
    if (confirmedBlueprint.detectedAudienceGuess) lines.push(`- **Target Audience:** ${confirmedBlueprint.detectedAudienceGuess}`);
    if (confirmedBlueprint.detectedPositioning) lines.push(`- **Positioning:** ${confirmedBlueprint.detectedPositioning}`);
    lines.push("");
  }

  if (work) {
    lines.push(`## Required Work`);
    lines.push(`| Type | Per Week | Total |`);
    lines.push(`|------|----------|-------|`);
    if (work.reelsPerWeek) lines.push(`| Reels | ${work.reelsPerWeek} | ${work.totalReels} |`);
    if (work.postsPerWeek) lines.push(`| Posts | ${work.postsPerWeek} | ${work.totalPosts} |`);
    if (work.storiesPerDay) lines.push(`| Stories | ${work.storiesPerDay}/day | ${work.totalStories} |`);
    if (work.carouselsPerWeek) lines.push(`| Carousels | ${work.carouselsPerWeek} | ${work.totalCarousels} |`);
    if (work.videosPerWeek) lines.push(`| Videos | ${work.videosPerWeek} | ${work.totalVideos} |`);
    lines.push(`| **Total** | | **${work.totalContentPieces}** |`);
    lines.push(`- **Period:** ${work.periodDays} days`);
    lines.push("");
  }

  lines.push(`## Calendar`);
  lines.push(`- **Entries Generated:** ${calendarCount}`);
  lines.push("");

  if (planJson.contentDistributionPlan) {
    const cdp = planJson.contentDistributionPlan;
    lines.push(`## Content Distribution Plan`);
    if (cdp.platforms) {
      for (const p of cdp.platforms) {
        lines.push(`### ${p.platform} (${p.frequency})`);
        if (p.contentTypes) {
          lines.push(`| Type | % | Weekly | Rationale |`);
          lines.push(`|------|---|--------|-----------|`);
          for (const ct of p.contentTypes) {
            lines.push(`| ${ct.type} | ${ct.percentage} | ${ct.weeklyCount} | ${ct.rationale} |`);
          }
        }
        if (p.bestPostingTimes) lines.push(`**Best Posting Times:** ${p.bestPostingTimes.join(", ")}`);
        if (p.hashtagStrategy) lines.push(`**Hashtag Strategy:** ${p.hashtagStrategy}`);
        lines.push("");
      }
    }
    if (cdp.contentPillars) {
      lines.push(`### Content Pillars`);
      for (const cp of cdp.contentPillars) {
        lines.push(`- **${cp.pillar}** (${cp.percentage}): ${(cp.examples || []).join(", ")}`);
      }
      lines.push("");
    }
  }

  if (planJson.engagementPlan) {
    const ep = planJson.engagementPlan;
    lines.push(`## Engagement Plan`);
    if (ep.dailyActions) {
      lines.push(`### Daily Actions`);
      for (const a of ep.dailyActions) lines.push(`- [${a.priority}] ${a.action}`);
    }
    if (ep.weeklyActions) {
      lines.push(`### Weekly Actions`);
      for (const a of ep.weeklyActions) lines.push(`- [${a.priority}] ${a.action}`);
    }
    if (ep.communityGrowthTactics) {
      lines.push(`### Community Growth`);
      for (const t of ep.communityGrowthTactics) lines.push(`- ${t}`);
    }
    lines.push("");
  }

  if (planJson.conversionPlan) {
    const cp = planJson.conversionPlan;
    lines.push(`## Conversion Plan`);
    if (cp.funnelStages) {
      lines.push(`| Stage | Content | CTA | Metric |`);
      lines.push(`|-------|---------|-----|--------|`);
      for (const s of cp.funnelStages) lines.push(`| ${s.stage} | ${s.content} | ${s.cta} | ${s.metric} |`);
    }
    if (cp.ctaStrategy) lines.push(`**CTA Strategy:** ${cp.ctaStrategy}`);
    if (cp.leadCaptureMethod) lines.push(`**Lead Capture:** ${cp.leadCaptureMethod}`);
    lines.push("");
  }

  if (planJson.measurementPlan) {
    const mp = planJson.measurementPlan;
    lines.push(`## Measurement Plan`);
    if (mp.primaryKPIs) {
      lines.push(`### Primary KPIs`);
      lines.push(`| KPI | Target | Frequency | Alert |`);
      lines.push(`|-----|--------|-----------|-------|`);
      for (const k of mp.primaryKPIs) lines.push(`| ${k.kpi} | ${k.target} | ${k.frequency} | ${k.alertThreshold || "-"} |`);
    }
    if (mp.secondaryKPIs) {
      lines.push(`### Secondary KPIs`);
      for (const k of mp.secondaryKPIs) lines.push(`- **${k.kpi}:** target ${k.target} (${k.frequency})`);
    }
    if (mp.reportingCadence) lines.push(`**Reporting:** ${mp.reportingCadence}`);
    lines.push("");
  }

  if (planJson.competitiveWatchTargets?.targets) {
    lines.push(`## Competitive Watch`);
    for (const t of planJson.competitiveWatchTargets.targets) {
      lines.push(`### ${t.competitor}`);
      lines.push(`- **Watch:** ${(t.watchMetrics || []).join(", ")}`);
      lines.push(`- **Alerts:** ${(t.alertTriggers || []).join(", ")}`);
      lines.push(`- **Frequency:** ${t.checkFrequency}`);
    }
    lines.push("");
  }

  if (planJson.riskMonitoringTriggers?.triggers) {
    lines.push(`## Risk Monitoring`);
    lines.push(`| Trigger | Condition | Action | Severity |`);
    lines.push(`|---------|-----------|--------|----------|`);
    for (const t of planJson.riskMonitoringTriggers.triggers) {
      lines.push(`| ${t.trigger} | ${t.condition} | ${t.action} | ${t.severity} |`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push(`*Generated automatically from strategic plan ${plan.id}*`);

  return lines.join("\n");
}

const PLAN_SECTIONS = [
  "contentDistributionPlan",
  "creativeTestingMatrix",
  "budgetAllocationStructure",
  "kpiMonitoringPriority",
  "competitiveWatchTargets",
  "riskMonitoringTriggers",
] as const;

function initSectionStatuses(): Record<string, string> {
  const s: Record<string, string> = {};
  for (const k of PLAN_SECTIONS) s[k] = "PENDING";
  return s;
}

async function executeOrchestratorJob(jobId: string, blueprintId: string) {
  const startMs = Date.now();
  const stageTimes: Record<string, number> = {};
  let accountId = "default";
  let campaignId = "";

  const log = (stage: string, extra?: Record<string, any>) => {
    const elapsed = Date.now() - startMs;
    stageTimes[stage] = elapsed;
    console.log(`[OrchestratorJob] [${jobId}] ${stage} (+${elapsed}ms)`, extra ? JSON.stringify(extra) : "");
  };

  const updateJob = async (fields: Record<string, any>) => {
    await db.update(orchestratorJobs).set(fields).where(eq(orchestratorJobs.id, jobId));
  };

  try {
    log("START", { blueprintId });

    const [blueprint] = await db.select().from(strategicBlueprints).where(eq(strategicBlueprints.id, blueprintId)).limit(1);
    if (!blueprint) { await updateJob({ status: "FAILED", error: "Blueprint not found", errorCode: "BLUEPRINT_NOT_FOUND", completedAt: new Date() }); return; }

    accountId = blueprint.accountId;
    campaignId = blueprint.campaignId || "";
    log("LOAD_CONTEXT", { accountId, campaignId, status: blueprint.status });

    const confirmedBlueprint = blueprint.confirmedBlueprint ? JSON.parse(blueprint.confirmedBlueprint) : null;
    const campaignContext = blueprint.campaignContext ? JSON.parse(blueprint.campaignContext) : null;
    const competitorUrls = blueprint.competitorUrls ? JSON.parse(blueprint.competitorUrls) : [];
    const marketMapRaw = blueprint.marketMap ? JSON.parse(blueprint.marketMap) : null;
    const validationResultRaw = blueprint.validationResult ? JSON.parse(blueprint.validationResult) : null;

    let businessData: any = null;
    try {
      const cId = campaignContext?.campaignId || blueprint.campaignId;
      const aId = campaignContext?.accountId || blueprint.accountId || "default";
      if (cId) {
        const bizRows = await db.select().from(businessDataLayer).where(and(eq(businessDataLayer.campaignId, cId), eq(businessDataLayer.accountId, aId))).limit(1);
        if (bizRows.length > 0) businessData = bizRows[0];
      }
    } catch (err) { log("BUSINESS_DATA_FETCH_SKIPPED", { error: (err as Error).message }); }

    log("DB_READS_COMPLETE");

    let performanceIntelligenceBlock = "";
    let performanceSignalsInjected = false;
    try {
      const sAccountId = campaignContext?.accountId || "default";
      const sCampaignId = campaignContext?.campaignId;
      if (sCampaignId) {
        const [memories, insights, moats] = await Promise.all([
          db.select().from(strategyMemory).where(and(eq(strategyMemory.accountId, sAccountId), eq(strategyMemory.campaignId, sCampaignId), sql`${strategyMemory.campaignId} != 'unscoped_legacy'`)).orderBy(desc(strategyMemory.updatedAt)).limit(5),
          db.select().from(strategyInsights).where(and(gte(strategyInsights.confidence, 0.7), eq(strategyInsights.accountId, sAccountId), eq(strategyInsights.campaignId, sCampaignId), sql`${strategyInsights.campaignId} != 'unscoped_legacy'`)).orderBy(desc(strategyInsights.createdAt)).limit(5),
          db.select().from(moatCandidates).where(and(eq(moatCandidates.status, "candidate"), eq(moatCandidates.accountId, sAccountId), eq(moatCandidates.campaignId, sCampaignId), sql`${moatCandidates.campaignId} != 'unscoped_legacy'`)).orderBy(desc(moatCandidates.moatScore)).limit(3),
        ]);
        if (memories.length > 0 || insights.length > 0 || moats.length > 0) {
          performanceSignalsInjected = true;
          performanceIntelligenceBlock = `\nPERFORMANCE SIGNALS (optional):\n${memories.length > 0 ? `Memory: ${capJson(memories.map(m => ({ type: m.memoryType, label: m.label, score: m.score })), 500)}` : ""}${insights.length > 0 ? `\nInsights: ${capJson(insights.map(i => ({ category: i.category, insight: i.insight, confidence: i.confidence })), 500)}` : ""}${moats.length > 0 ? `\nMoats: ${capJson(moats.map(m => ({ label: m.label, moatScore: m.moatScore })), 300)}` : ""}`;
        }
      }
    } catch (err) { log("PERF_INTEL_SKIPPED", { error: (err as Error).message }); }

    log("BUILD_PROMPT");

    const businessDataBlock = businessData ? `\nBUSINESS DATA:\n- Type: ${businessData.businessType || "N/A"}, Location: ${businessData.businessLocation || "N/A"}\n- Offer: ${capText(businessData.coreOffer, 200)}, Price: ${businessData.priceRange || "N/A"}\n- Audience: ${businessData.targetAudienceAge || "N/A"} / ${capText(businessData.targetAudienceSegment, 150)}\n- Budget: ${businessData.monthlyBudget || "N/A"}, Funnel: ${businessData.funnelObjective || "N/A"}\n- Conversion: ${businessData.primaryConversionChannel || "N/A"}\nDerive distribution from these fields.` : `\nNo Business Data Layer found. Use reasonable defaults based on campaign objective.`;

    const userPrompt = `Generate 6 execution plans from validated blueprint v${blueprint.blueprintVersion}. Do NOT override confirmed data.\n\nGeo-scope: ${campaignContext?.location || "Not specified"}\n\nCAMPAIGN: ${campaignContext?.campaignName || "N/A"} | ${campaignContext?.objective || "N/A"} | ${campaignContext?.location || "N/A"} | ${campaignContext?.platform || "N/A"}${businessDataBlock}\n\nBLUEPRINT (source of truth): ${capJson(confirmedBlueprint, 2000)}\n\nASP: $${blueprint.averageSellingPrice || "N/A"}\nCOMPETITORS: ${competitorUrls.slice(0, 5).join(", ")}${marketMapRaw ? `\nMARKET MAP: ${capJson(marketMapRaw, 1000)}` : ""}${validationResultRaw ? `\nVALIDATION: ${capJson(validationResultRaw, 800)}` : ""}${performanceIntelligenceBlock}\n\nGenerate all 6 sections now. Keep output concise — each section with 3-5 items max. JSON only.`;

    const promptChars = ORCHESTRATOR_PROMPT.length + userPrompt.length;
    log("AI_CALL_START", { model: "gpt-5.2", maxTokens: 3000, promptChars });

    const sectionStatuses = initSectionStatuses();
    await updateJob({ sectionStatuses: JSON.stringify(sectionStatuses) });

    let orchestratorPlan: any = null;
    let usedFallback = false;
    let fallbackReason: string | null = null;
    const MAX_RETRIES = 1;

    const attemptAiGeneration = async (attempt: number): Promise<any> => {
      log(`AI_ATTEMPT_${attempt}_START`, { model: "gpt-5.2", attempt });

      const response = await aiChat({
        model: "gpt-5.2",
        messages: [
          { role: "system", content: ORCHESTRATOR_PROMPT },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 3000,
        accountId: "default",
        endpoint: "strategic-orchestrator",
      });

      log(`AI_ATTEMPT_${attempt}_END`, { durationMs: Date.now() - startMs, finishReason: response.choices[0]?.finish_reason });

      const rawText = response.choices[0]?.message?.content || "";
      log("PARSE", { rawLength: rawText.length, attempt });

      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON object found in model response");

      const parsed = JSON.parse(jsonMatch[0]);
      if (!parsed || Object.keys(parsed).length === 0) throw new Error("AI returned empty plan object");

      return parsed;
    };

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        orchestratorPlan = await attemptAiGeneration(attempt);
        log("AI_SUCCESS", { attempt, durationMs: Date.now() - startMs });
        break;
      } catch (aiErr: any) {
        log(`AI_ATTEMPT_${attempt}_FAIL`, { code: aiErr.code, message: aiErr.message, attempt, willRetry: attempt < MAX_RETRIES });

        if (aiErr.code === "AI_BUDGET_EXCEEDED") {
          await updateJob({ status: "FAILED", error: aiErr.message, errorCode: "AI_BUDGET_EXCEEDED", stageTimes: JSON.stringify(stageTimes), durationMs: Date.now() - startMs, completedAt: new Date() });
          await logAuditEvent({ accountId, campaignId: campaignId || undefined, blueprintId, blueprintVersion: blueprint.blueprintVersion, event: "ORCHESTRATOR_FAILED", details: { jobId, error: "AI_BUDGET_EXCEEDED", message: aiErr.message, stageTimes, attempt } });
          return;
        }

        if (attempt < MAX_RETRIES) {
          log("RETRY_SCHEDULED", { attempt, nextAttempt: attempt + 1, delayMs: 2000 });
          await updateJob({ sectionStatuses: JSON.stringify({ ...sectionStatuses, _retryAttempt: attempt + 1 }) });
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }

        usedFallback = true;
        const isTimeout = aiErr.message?.includes("timeout") || aiErr.message?.includes("timed out") || aiErr.code === "ETIMEDOUT";
        fallbackReason = isTimeout ? `AI timed out after ${attempt + 1} attempt(s)` : `AI failed after ${attempt + 1} attempt(s): ${aiErr.message}`;
        log("FALLBACK_AFTER_RETRIES", { reason: fallbackReason, totalAttempts: attempt + 1 });
        orchestratorPlan = generateFallbackPlan({ confirmedBlueprint, campaignContext, competitorUrls, businessData });
      }
    }

    for (const key of PLAN_SECTIONS) {
      if (orchestratorPlan[key] && typeof orchestratorPlan[key] === "object") {
        sectionStatuses[key] = usedFallback ? "FALLBACK" : "COMPLETE";
      } else {
        const fallbackPlan = generateFallbackPlan({ confirmedBlueprint, campaignContext, competitorUrls, businessData });
        if (fallbackPlan[key]) {
          orchestratorPlan[key] = fallbackPlan[key];
          sectionStatuses[key] = "FALLBACK";
          if (!usedFallback) fallbackReason = `Section ${key} missing from AI response — filled with fallback`;
          usedFallback = true;
        } else {
          sectionStatuses[key] = "FALLBACK";
        }
      }
      await updateJob({ sectionStatuses: JSON.stringify(sectionStatuses) });
    }

    orchestratorPlan.blueprintVersion = blueprint.blueprintVersion;
    if (usedFallback) {
      orchestratorPlan.fallback = true;
      orchestratorPlan.fallbackReason = fallbackReason;
    }

    log("SECTION_VALIDATION_COMPLETE", { sectionStatuses, usedFallback });

    await db.update(strategicBlueprints)
      .set({
        status: "ORCHESTRATED",
        orchestratorPlan: JSON.stringify(orchestratorPlan),
        orchestratedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(strategicBlueprints.id, blueprintId));

    const planSectionKeys = Object.keys(orchestratorPlan).filter(k => !["blueprintVersion", "fallback", "fallbackReason"].includes(k));
    const summary = usedFallback ? `Fallback plan — ${planSectionKeys.length} sections` : `Execution plan — ${planSectionKeys.length} structured sections`;
    const [planRow] = await db.insert(strategicPlans).values({
      accountId,
      blueprintId,
      campaignId: campaignId || "default",
      planJson: JSON.stringify(orchestratorPlan),
      planSummary: summary,
      status: "DRAFT",
      executionStatus: "IDLE",
    }).returning();

    log("DB_WRITE", { planId: planRow.id });

    await logAuditEvent({
      accountId,
      campaignId: campaignId || undefined,
      blueprintId,
      blueprintVersion: blueprint.blueprintVersion,
      event: usedFallback ? "ORCHESTRATOR_FALLBACK" : "ORCHESTRATOR_GENERATED",
      details: { jobId, planId: planRow.id, planSectionKeys, performanceSignalsInjected, durationMs: Date.now() - startMs, stageTimes, promptChars, usedFallback, sectionStatuses },
    });

    await updateJob({
      status: "COMPLETE",
      sectionStatuses: JSON.stringify(sectionStatuses),
      planJson: JSON.stringify(orchestratorPlan),
      planId: planRow.id,
      fallback: usedFallback,
      fallbackReason,
      stageTimes: JSON.stringify(stageTimes),
      durationMs: Date.now() - startMs,
      completedAt: new Date(),
    });

    log("COMPLETE", { durationMs: Date.now() - startMs, planId: planRow.id, usedFallback, stageTimes });
  } catch (error: any) {
    const durationMs = Date.now() - startMs;
    log("UNHANDLED_ERROR", { code: error.code, message: error.message, durationMs, stageTimes });
    await updateJob({ status: "FAILED", error: error.message, errorCode: error.code || "INTERNAL_ERROR", stageTimes: JSON.stringify(stageTimes), durationMs, completedAt: new Date() }).catch(() => {});
    await logAuditEvent({ accountId, campaignId: campaignId || undefined, blueprintId, blueprintVersion: 0, event: "ORCHESTRATOR_FAILED", details: { jobId, error: error.code || "INTERNAL_ERROR", message: error.message, durationMs, stageTimes } }).catch(() => {});
  }
}

export function registerOrchestratorRoutes(app: Express) {
  app.post("/api/strategic/blueprint/:id/orchestrate", async (req: Request, res: Response) => {
    const requestId = crypto.randomUUID();
    const { id } = req.params;

    try {
      const [blueprint] = await db.select().from(strategicBlueprints).where(eq(strategicBlueprints.id, id)).limit(1);
      if (!blueprint) {
        return res.status(404).json({ success: false, error: "BLUEPRINT_NOT_FOUND", message: "Blueprint not found", requestId });
      }

      if (blueprint.status !== "VALIDATED") {
        return res.status(400).json({ success: false, error: "STATUS_GATE", message: "Blueprint must be VALIDATED first.", currentStatus: blueprint.status, requestId });
      }

      const confirmedBlueprint = blueprint.confirmedBlueprint ? JSON.parse(blueprint.confirmedBlueprint) : null;
      if (!confirmedBlueprint) {
        return res.status(400).json({ success: false, error: "NO_CONFIRMED_BLUEPRINT", message: "No confirmed blueprint.", requestId });
      }

      if (confirmedBlueprint.blueprintVersion !== blueprint.blueprintVersion) {
        return res.status(400).json({ success: false, error: "VERSION_MISMATCH", message: "Blueprint version mismatch. Re-confirm required.", requestId });
      }

      const { valid, missingFields } = validateBlueprintCompleteness(confirmedBlueprint);
      if (!valid) {
        return res.status(400).json({ success: false, error: "INCOMPLETE_BLUEPRINT", missingFields, message: `Missing: ${missingFields.join(", ")}`, requestId });
      }

      const campaignContext = blueprint.campaignContext ? JSON.parse(blueprint.campaignContext) : null;
      if (!campaignContext) {
        return res.status(400).json({ success: false, error: "CAMPAIGN_CONTEXT_REQUIRED", message: "No campaign context.", requestId });
      }

      const competitorUrls = blueprint.competitorUrls ? JSON.parse(blueprint.competitorUrls) : [];
      if (competitorUrls.length < 1) {
        return res.status(400).json({ success: false, error: "COMPETITOR_REQUIRED", message: "At least 1 competitor is required.", requestId });
      }

      const allInvalid = competitorUrls.every((u: string) => !u || u.trim().length === 0);
      if (allInvalid) {
        return res.status(422).json({ success: false, error: "COMPETITOR_INCOMPLETE", message: "All competitor entries are empty or invalid.", requestId });
      }

      const existingRunning = await db.select().from(orchestratorJobs)
        .where(and(eq(orchestratorJobs.blueprintId, id), eq(orchestratorJobs.status, "RUNNING")))
        .limit(1);
      if (existingRunning.length > 0) {
        return res.json({ success: true, jobId: existingRunning[0].id, status: "RUNNING", message: "Job already in progress", requestId });
      }

      const [job] = await db.insert(orchestratorJobs).values({
        blueprintId: id,
        accountId: blueprint.accountId,
        campaignId: blueprint.campaignId || "default",
        status: "RUNNING",
        sectionStatuses: JSON.stringify(initSectionStatuses()),
      }).returning();

      console.log(`[Orchestrator] Job created: ${job.id} for blueprint ${id}`);

      executeOrchestratorJob(job.id, id).catch(err => {
        console.error(`[Orchestrator] Background job ${job.id} unhandled error:`, err);
      });

      res.json({
        success: true,
        jobId: job.id,
        status: "RUNNING",
        requestId,
      });
    } catch (error: any) {
      console.error("[Orchestrator] Job creation failed:", error.message);
      res.status(500).json({ success: false, error: "JOB_CREATION_FAILED", message: error.message, requestId });
    }
  });

  app.get("/api/strategic/orchestrate-status/:jobId", async (req: Request, res: Response) => {
    try {
      const { jobId } = req.params;
      const [job] = await db.select().from(orchestratorJobs).where(eq(orchestratorJobs.id, jobId)).limit(1);
      if (!job) {
        return res.status(404).json({ success: false, error: "JOB_NOT_FOUND", message: "Job not found" });
      }

      const sectionStatuses = job.sectionStatuses ? JSON.parse(job.sectionStatuses) : initSectionStatuses();
      const stageTimes = job.stageTimes ? JSON.parse(job.stageTimes) : {};

      if (job.status === "COMPLETE") {
        const plan = job.planJson ? JSON.parse(job.planJson) : null;

        const requiredSections = [
          "contentDistributionPlan",
          "creativeTestingMatrix",
          "budgetAllocationStructure",
          "kpiMonitoringPriority",
          "competitiveWatchTargets",
          "riskMonitoringTriggers",
        ];
        const missingSections = plan ? requiredSections.filter(s => !plan[s] || typeof plan[s] !== "object") : requiredSections;
        const schemaValid = missingSections.length === 0;

        if (!schemaValid) {
          return res.json({
            success: false,
            status: "FAILED",
            jobId: job.id,
            error: "SCHEMA_VALIDATION_FAILED",
            message: `Plan missing required sections: ${missingSections.join(", ")}`,
            missingSections,
            sectionStatuses,
            durationMs: job.durationMs,
            stageTimes,
          });
        }

        return res.json({
          success: true,
          status: "COMPLETE",
          jobId: job.id,
          planId: job.planId,
          planStatus: "DRAFT",
          orchestratorPlan: plan,
          sectionStatuses,
          schemaValid: true,
          fallback: job.fallback || false,
          fallbackReason: job.fallbackReason,
          durationMs: job.durationMs,
          stageTimes,
        });
      }

      if (job.status === "FAILED") {
        return res.json({
          success: false,
          status: "FAILED",
          jobId: job.id,
          error: job.errorCode || "UNKNOWN",
          message: job.error || "Job failed",
          sectionStatuses,
          durationMs: job.durationMs,
          stageTimes,
        });
      }

      res.json({
        success: true,
        status: "RUNNING",
        jobId: job.id,
        sectionStatuses,
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: "STATUS_CHECK_FAILED", message: error.message });
    }
  });

  app.post("/api/strategic/blueprint/:id/approve-plan", async (req: Request, res: Response) => {
    const requestId = crypto.randomUUID();
    try {
      const { id } = req.params;

      const [blueprint] = await db.select().from(strategicBlueprints).where(eq(strategicBlueprints.id, id)).limit(1);
      if (!blueprint) {
        return res.status(404).json({ success: false, error: "BLUEPRINT_NOT_FOUND", requestId });
      }

      if (blueprint.status !== "ORCHESTRATED") {
        return res.status(409).json({
          success: false,
          error: "PLAN_NOT_READY",
          message: `Blueprint must be ORCHESTRATED before approval. Current status: ${blueprint.status}`,
          currentStatus: blueprint.status,
          requestId,
        });
      }

      const accountId = blueprint.accountId;
      const campaignId = blueprint.campaignId || "";

      const plans = await db.select().from(strategicPlans)
        .where(and(
          eq(strategicPlans.blueprintId, id),
          eq(strategicPlans.accountId, accountId),
        ))
        .orderBy(desc(strategicPlans.createdAt))
        .limit(1);

      if (plans.length === 0) {
        return res.status(404).json({
          success: false,
          error: "PLAN_NOT_FOUND",
          message: "No execution plan found for this blueprint. Generate execution plans first.",
          requestId,
        });
      }

      const plan = plans[0];

      if (plan.status === "APPROVED") {
        return res.status(409).json({
          success: false,
          error: "PLAN_ALREADY_APPROVED",
          message: "Plan is already approved.",
          planId: plan.id,
          requestId,
        });
      }

      if (plan.status !== "DRAFT" && plan.status !== "READY_FOR_REVIEW") {
        return res.status(409).json({
          success: false,
          error: "PLAN_NOT_READY",
          message: `Plan must be in DRAFT or READY_FOR_REVIEW status. Current: ${plan.status}`,
          currentStatus: plan.status,
          requestId,
        });
      }

      if (plan.campaignId !== campaignId && campaignId) {
        return res.status(403).json({
          success: false,
          error: "CAMPAIGN_MISMATCH",
          message: "Plan campaign does not match blueprint campaign.",
          requestId,
        });
      }

      await db.update(strategicPlans)
        .set({ status: "APPROVED", updatedAt: new Date() })
        .where(eq(strategicPlans.id, plan.id));

      await db.insert(planApprovals).values({
        planId: plan.id,
        accountId,
        decision: "APPROVED",
        reason: "Approved via Build The Plan Phase 5",
        decidedBy: "client",
      });

      await logAuditEvent({
        accountId,
        campaignId: campaignId || undefined,
        blueprintId: id,
        blueprintVersion: blueprint.blueprintVersion,
        event: "PLAN_APPROVED",
        details: { requestId, planId: plan.id, blueprintId: id, campaignId },
      });

      await logAudit(accountId, "PLAN_APPROVED", {
        details: { planId: plan.id, blueprintId: id, decidedBy: "client" },
      });

      res.json({
        success: true,
        planId: plan.id,
        status: "APPROVED",
        requestId,
      });
    } catch (error: any) {
      console.error("[Orchestrator] Approve error:", error.message);
      res.status(500).json({ success: false, error: "APPROVAL_FAILED", message: error.message, requestId });
    }
  });

  app.post("/api/strategic/blueprint/:id/regenerate-plan", async (req: Request, res: Response) => {
    const requestId = crypto.randomUUID();
    try {
      const { id } = req.params;

      const [blueprint] = await db.select().from(strategicBlueprints).where(eq(strategicBlueprints.id, id)).limit(1);
      if (!blueprint) {
        return res.status(404).json({ success: false, error: "BLUEPRINT_NOT_FOUND", requestId });
      }

      if (blueprint.status !== "ORCHESTRATED") {
        return res.status(409).json({
          success: false,
          error: "NOT_ORCHESTRATED",
          message: "Blueprint must be ORCHESTRATED to regenerate.",
          requestId,
        });
      }

      const accountId = blueprint.accountId;
      const campaignId = blueprint.campaignId || "";

      const existingPlans = await db.select().from(strategicPlans)
        .where(and(
          eq(strategicPlans.blueprintId, id),
          eq(strategicPlans.accountId, accountId),
        ));

      let previousStatus = "NONE";
      for (const p of existingPlans) {
        previousStatus = p.status;
        await db.update(strategicPlans)
          .set({ status: "SUPERSEDED", updatedAt: new Date() })
          .where(eq(strategicPlans.id, p.id));
      }

      await db.update(strategicBlueprints)
        .set({
          status: "VALIDATED",
          orchestratorPlan: null,
          orchestratedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(strategicBlueprints.id, id));

      await logAuditEvent({
        accountId,
        campaignId: campaignId || undefined,
        blueprintId: id,
        blueprintVersion: blueprint.blueprintVersion,
        event: "PLAN_REGENERATED",
        details: { requestId, blueprintId: id, previousStatus, supersededCount: existingPlans.length },
      });

      res.json({
        success: true,
        blueprintId: id,
        status: "VALIDATED",
        message: "Plan cleared. Blueprint reverted to VALIDATED. Ready to regenerate.",
        requestId,
      });
    } catch (error: any) {
      console.error("[Orchestrator] Regenerate error:", error.message);
      res.status(500).json({ success: false, error: "REGENERATE_FAILED", message: error.message, requestId });
    }
  });

  app.post("/api/strategic/blueprint/:blueprintId/plan-pdf", async (req: Request, res: Response) => {
    const requestId = crypto.randomUUID();
    try {
      const { blueprintId } = req.params;

      const [blueprint] = await db.select().from(strategicBlueprints).where(eq(strategicBlueprints.id, blueprintId)).limit(1);
      if (!blueprint) {
        return res.status(404).json({ success: false, error: "BLUEPRINT_NOT_FOUND", requestId });
      }

      const accountId = blueprint.accountId;
      const campaignId = blueprint.campaignId || "default";

      const plans = await db.select().from(strategicPlans)
        .where(and(
          eq(strategicPlans.blueprintId, blueprintId),
          eq(strategicPlans.accountId, accountId),
          ne(strategicPlans.status, "SUPERSEDED"),
        ))
        .orderBy(desc(strategicPlans.createdAt))
        .limit(1);

      if (plans.length === 0) {
        return res.status(404).json({ success: false, error: "PLAN_NOT_FOUND", message: "No plan found for this blueprint.", requestId });
      }

      const plan = plans[0];
      let planJson: any = {};
      try { planJson = JSON.parse(plan.planJson); } catch {}

      const work = await db.select().from(requiredWork)
        .where(and(eq(requiredWork.planId, plan.id), eq(requiredWork.accountId, accountId)))
        .limit(1);

      const calEntries = await db.select().from(calendarEntries)
        .where(and(eq(calendarEntries.planId, plan.id), eq(calendarEntries.accountId, accountId)));

      const confirmedBlueprint = blueprint.confirmedBlueprint ? JSON.parse(blueprint.confirmedBlueprint) : null;

      const markdown = generatePlanMarkdown({
        blueprint,
        confirmedBlueprint,
        plan,
        planJson,
        work: work[0] || null,
        calendarCount: calEntries.length,
      });

      const fileName = `Plan_${plan.id.slice(0, 8)}_${new Date().toISOString().slice(0, 10)}.md`;

      const [doc] = await db.insert(planDocuments).values({
        planId: plan.id,
        campaignId,
        accountId,
        fileName,
        content: markdown,
        format: "markdown",
      }).returning();

      await logAuditEvent({
        accountId,
        campaignId: campaignId || undefined,
        blueprintId,
        blueprintVersion: blueprint.blueprintVersion,
        event: "PLAN_DOCUMENT_GENERATED",
        details: { requestId, planId: plan.id, documentId: doc.id, fileName },
      });

      res.json({
        success: true,
        documentId: doc.id,
        fileName,
        content: markdown,
        format: "markdown",
        planId: plan.id,
        requestId,
      });
    } catch (error: any) {
      console.error("[Orchestrator] Plan PDF generation error:", error.message);
      res.status(500).json({ success: false, error: "PLAN_PDF_FAILED", message: error.message, requestId });
    }
  });

  app.get("/api/strategic/blueprint/:blueprintId/plan-pdf", async (req: Request, res: Response) => {
    try {
      const { blueprintId } = req.params;

      const [blueprint] = await db.select().from(strategicBlueprints).where(eq(strategicBlueprints.id, blueprintId)).limit(1);
      if (!blueprint) {
        return res.status(404).json({ success: false, error: "BLUEPRINT_NOT_FOUND" });
      }

      const plan = await db.select().from(strategicPlans)
        .where(and(
          eq(strategicPlans.blueprintId, blueprintId),
          eq(strategicPlans.accountId, blueprint.accountId),
        ))
        .orderBy(desc(strategicPlans.createdAt))
        .limit(1);

      const docs = await db.select().from(planDocuments)
        .where(and(
          eq(planDocuments.accountId, blueprint.accountId),
          ...(plan.length > 0 ? [eq(planDocuments.planId, plan[0].id)] : []),
        ))
        .orderBy(desc(planDocuments.createdAt))
        .limit(1);

      if (docs.length === 0) {
        return res.status(404).json({ success: false, error: "NO_DOCUMENT", message: "No plan document found. Generate one first." });
      }

      const doc = docs[0];
      res.json({
        success: true,
        documentId: doc.id,
        fileName: doc.fileName,
        content: doc.content,
        format: doc.format,
        planId: doc.planId,
        createdAt: doc.createdAt,
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get("/api/strategic/blueprint/:id/plan-status", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const [blueprint] = await db.select().from(strategicBlueprints).where(eq(strategicBlueprints.id, id)).limit(1);
      if (!blueprint) {
        return res.status(404).json({ success: false, error: "BLUEPRINT_NOT_FOUND" });
      }

      const plans = await db.select().from(strategicPlans)
        .where(and(
          eq(strategicPlans.blueprintId, id),
          eq(strategicPlans.accountId, blueprint.accountId),
          ne(strategicPlans.status, "SUPERSEDED"),
        ))
        .orderBy(desc(strategicPlans.createdAt))
        .limit(1);

      const plan = plans[0] || null;

      res.json({
        success: true,
        blueprintId: id,
        blueprintStatus: blueprint.status,
        plan: plan ? { id: plan.id, status: plan.status, campaignId: plan.campaignId } : null,
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });
}
