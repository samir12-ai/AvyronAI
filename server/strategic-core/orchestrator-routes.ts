import type { Express, Request, Response } from "express";
import { aiChat, AICallError } from "../ai-client";
import { db } from "../db";
import { strategicBlueprints, strategicPlans, planApprovals, strategyMemory, strategyInsights, moatCandidates, businessDataLayer, planDocuments, requiredWork, calendarEntries } from "@shared/schema";
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

Respond with ONLY a valid JSON object:
{
  "contentDistributionPlan": {
    "platforms": [
      {
        "platform": "string",
        "frequency": "string",
        "contentTypes": [
          {
            "type": "string",
            "percentage": "string",
            "weeklyCount": "number",
            "rationale": "string"
          }
        ],
        "bestPostingTimes": ["string"],
        "hashtagStrategy": "string"
      }
    ],
    "contentPillars": [
      {
        "pillar": "string",
        "percentage": "string",
        "examples": ["string"]
      }
    ]
  },
  "engagementPlan": {
    "dailyActions": [
      {
        "action": "string",
        "priority": "high|medium|low"
      }
    ],
    "weeklyActions": [
      {
        "action": "string",
        "priority": "high|medium|low"
      }
    ],
    "communityGrowthTactics": ["string"]
  },
  "conversionPlan": {
    "funnelStages": [
      {
        "stage": "string",
        "content": "string",
        "cta": "string",
        "metric": "string"
      }
    ],
    "ctaStrategy": "string",
    "leadCaptureMethod": "string"
  },
  "measurementPlan": {
    "primaryKPIs": [
      {
        "kpi": "string",
        "target": "string",
        "frequency": "string",
        "alertThreshold": "string"
      }
    ],
    "secondaryKPIs": [
      {
        "kpi": "string",
        "target": "string",
        "frequency": "string"
      }
    ],
    "reportingCadence": "string"
  },
  "competitiveWatchTargets": {
    "targets": [
      {
        "competitor": "string",
        "watchMetrics": ["string"],
        "alertTriggers": ["string"],
        "checkFrequency": "string"
      }
    ]
  },
  "riskMonitoringTriggers": {
    "triggers": [
      {
        "trigger": "string",
        "condition": "string",
        "action": "string",
        "severity": "low|medium|high|critical"
      }
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

export function registerOrchestratorRoutes(app: Express) {
  app.post("/api/strategic/blueprint/:id/orchestrate", async (req: Request, res: Response) => {
    const requestId = crypto.randomUUID();
    const startMs = Date.now();
    const { id } = req.params;
    let accountId = "default";
    let campaignId = "";
    let competitorCount = 0;

    const log = (stage: string, extra?: Record<string, any>) => {
      const elapsed = Date.now() - startMs;
      console.log(`[Orchestrator] [${requestId}] ${stage} (+${elapsed}ms)`, extra ? JSON.stringify(extra) : "");
    };

    try {
      log("START", { blueprintId: id });

      const [blueprint] = await db.select().from(strategicBlueprints).where(eq(strategicBlueprints.id, id)).limit(1);
      if (!blueprint) {
        log("ABORT: blueprint not found");
        return res.status(404).json({ success: false, error: "BLUEPRINT_NOT_FOUND", message: "Blueprint not found", requestId });
      }

      accountId = blueprint.accountId;
      campaignId = blueprint.campaignId || "";
      log("DB_READ_BLUEPRINT", { accountId, campaignId, status: blueprint.status });

      if (blueprint.status !== "VALIDATED") {
        log("ABORT: status gate", { currentStatus: blueprint.status });
        return res.status(400).json({
          success: false,
          error: "STATUS_GATE",
          message: "Blueprint must be VALIDATED first. No confirmed + validated → no Orchestrator.",
          currentStatus: blueprint.status,
          requestId,
        });
      }

      const confirmedBlueprint = blueprint.confirmedBlueprint ? JSON.parse(blueprint.confirmedBlueprint) : null;
      if (!confirmedBlueprint) {
        log("ABORT: no confirmed blueprint");
        return res.status(400).json({ success: false, error: "NO_CONFIRMED_BLUEPRINT", message: "No confirmed blueprint. Confirmed blueprint is the only source of truth.", requestId });
      }

      if (confirmedBlueprint.blueprintVersion !== blueprint.blueprintVersion) {
        log("ABORT: version mismatch", { confirmed: confirmedBlueprint.blueprintVersion, current: blueprint.blueprintVersion });
        return res.status(400).json({
          success: false,
          error: "VERSION_MISMATCH",
          message: "Confirmed blueprint version does not match current blueprint version. Re-confirm required.",
          confirmedVersion: confirmedBlueprint.blueprintVersion,
          currentVersion: blueprint.blueprintVersion,
          requestId,
        });
      }

      const { valid, missingFields } = validateBlueprintCompleteness(confirmedBlueprint);
      if (!valid) {
        log("ABORT: incomplete blueprint", { missingFields });
        return res.status(400).json({
          success: false,
          error: "INCOMPLETE_BLUEPRINT",
          missingFields,
          message: `Cannot generate execution plans. Missing critical fields: ${missingFields.join(", ")}. No generic fallback plans allowed.`,
          requestId,
        });
      }

      const campaignContext = blueprint.campaignContext ? JSON.parse(blueprint.campaignContext) : null;
      if (!campaignContext) {
        log("ABORT: no campaign context");
        return res.status(400).json({
          success: false,
          error: "CAMPAIGN_CONTEXT_REQUIRED",
          message: "No campaign context — Orchestrator cannot run without campaign context.",
          requestId,
        });
      }

      const competitorUrls = blueprint.competitorUrls ? JSON.parse(blueprint.competitorUrls) : [];
      competitorCount = competitorUrls.length;
      if (competitorCount < 1) {
        log("ABORT: no competitors", { competitorCount });
        return res.status(400).json({
          success: false,
          error: "COMPETITOR_REQUIRED",
          message: "At least 1 competitor is required. Add competitors in Competitor Intelligence first.",
          competitorCount: 0,
          requestId,
        });
      }

      const invalidCompetitors = competitorUrls.filter((u: string) => !u || u.trim().length === 0);
      if (invalidCompetitors.length > 0 && invalidCompetitors.length === competitorUrls.length) {
        log("ABORT: all competitors incomplete", { invalidCompetitors });
        return res.status(422).json({
          success: false,
          error: "COMPETITOR_INCOMPLETE",
          message: "All competitor entries are empty or invalid. Competitors must have valid profile links.",
          invalidCount: invalidCompetitors.length,
          totalCount: competitorUrls.length,
          requestId,
        });
      }

      log("VALIDATION_PASSED", { competitorCount, competitors: competitorUrls.slice(0, 5) });

      const marketMap = blueprint.marketMap ? JSON.parse(blueprint.marketMap) : null;
      const validationResult = blueprint.validationResult ? JSON.parse(blueprint.validationResult) : null;

      let businessData: any = null;
      try {
        const campaignIdForBiz = campaignContext.campaignId || blueprint.campaignId;
        const accountIdForBiz = campaignContext.accountId || blueprint.accountId || "default";
        if (campaignIdForBiz) {
          const bizRows = await db.select().from(businessDataLayer)
            .where(and(
              eq(businessDataLayer.campaignId, campaignIdForBiz),
              eq(businessDataLayer.accountId, accountIdForBiz)
            ))
            .limit(1);
          if (bizRows.length > 0) {
            businessData = bizRows[0];
          }
        }
      } catch (err) {
        log("BUSINESS_DATA_FETCH_SKIPPED", { error: (err as Error).message });
      }

      log("DB_READS_COMPLETE");

      let performanceIntelligenceBlock = "";
      let performanceSignalsInjected = false;
      try {
        const signalAccountId = campaignContext.accountId || "default";
        const signalCampaignId = campaignContext.campaignId;
        if (!signalCampaignId) {
          throw new Error("No campaignId in blueprint campaignContext — skipping signal injection");
        }
        const [memories, highConfidenceInsights, topMoats] = await Promise.all([
          db.select().from(strategyMemory).where(and(eq(strategyMemory.accountId, signalAccountId), eq(strategyMemory.campaignId, signalCampaignId), sql`${strategyMemory.campaignId} != 'unscoped_legacy'`)).orderBy(desc(strategyMemory.updatedAt)).limit(15),
          db.select().from(strategyInsights)
            .where(and(gte(strategyInsights.confidence, 0.7), eq(strategyInsights.accountId, signalAccountId), eq(strategyInsights.campaignId, signalCampaignId), sql`${strategyInsights.campaignId} != 'unscoped_legacy'`))
            .orderBy(desc(strategyInsights.createdAt)).limit(10),
          db.select().from(moatCandidates)
            .where(and(eq(moatCandidates.status, "candidate"), eq(moatCandidates.accountId, signalAccountId), eq(moatCandidates.campaignId, signalCampaignId), sql`${moatCandidates.campaignId} != 'unscoped_legacy'`))
            .orderBy(desc(moatCandidates.moatScore)).limit(5),
        ]);

        if (memories.length > 0 || highConfidenceInsights.length > 0 || topMoats.length > 0) {
          performanceSignalsInjected = true;
          performanceIntelligenceBlock = `

PERFORMANCE INTELLIGENCE LAYER (optional signal injection — do NOT override confirmed blueprint):
These signals come from the Performance Intelligence system analyzing past performance data. Use them to INFORM execution priorities, NOT to override the confirmed blueprint.

${memories.length > 0 ? `STRATEGIC MEMORY (${memories.length} learnings):
${JSON.stringify(memories.map(m => ({ type: m.memoryType, label: m.label, score: m.score, winner: m.isWinner })))}` : "No strategic memory available."}

${highConfidenceInsights.length > 0 ? `HIGH-CONFIDENCE INSIGHTS (${highConfidenceInsights.length} signals, confidence ≥ 0.7):
${JSON.stringify(highConfidenceInsights.map(i => ({ category: i.category, insight: i.insight, confidence: i.confidence, metric: i.relatedMetric })))}` : "No high-confidence insights available."}

${topMoats.length > 0 ? `MOAT SIGNALS (${topMoats.length} candidates):
${JSON.stringify(topMoats.map(m => ({ label: m.label, moatScore: m.moatScore, sourceType: m.sourceType })))}` : "No moat signals available."}

NOTE: Performance signals were ${performanceSignalsInjected ? "INJECTED" : "NOT AVAILABLE"}. The confirmed blueprint remains the ONLY source of truth.`;
        }
      } catch (err) {
        log("PERF_INTEL_SKIPPED", { error: (err as Error).message });
      }

      const businessDataBlock = businessData ? `
BUSINESS DATA LAYER (source of truth for distribution derivation):
- Business Type: ${businessData.businessType}
- Business Location: ${businessData.businessLocation}
- Core Offer: ${businessData.coreOffer}
- Price Range: ${businessData.priceRange}
- Target Audience Age: ${businessData.targetAudienceAge}
- Target Audience Segment: ${businessData.targetAudienceSegment}
- Monthly Budget: ${businessData.monthlyBudget}
- Funnel Objective: ${businessData.funnelObjective}
- Primary Conversion Channel: ${businessData.primaryConversionChannel}

CRITICAL: Derive ALL content distribution numbers (reels/week, posts/week, stories/day, carousels/week, videos/week) from the above business profile. Do NOT use generic defaults.` : `
WARNING: No Business Data Layer found. Distribution may use generic defaults. This is a degraded state.`;

      const userPrompt = `Generate execution plans from this validated blueprint (v${blueprint.blueprintVersion}). Do NOT reinterpret or override ANY confirmed data. The confirmed blueprint is the ONLY source of truth for positioning. The Business Data Layer is the ONLY source of truth for distribution parameters.

All plans must be geo-scoped to: ${campaignContext.location || "Not specified"}

CAMPAIGN CONTEXT:
- Campaign: ${campaignContext.campaignName}
- Objective: ${campaignContext.objective}
- Location: ${campaignContext.location || "Not specified"}
- Platform: ${campaignContext.platform}
- Mode: PRODUCTION
${businessDataBlock}

CONFIRMED BLUEPRINT (v${blueprint.blueprintVersion} — source of truth — do NOT change any values):
${JSON.stringify(confirmedBlueprint, null, 2)}

AVERAGE SELLING PRICE: $${blueprint.averageSellingPrice}

COMPETITOR URLS: ${competitorUrls.join(", ")}

${marketMap ? `MARKET MAP:\n${JSON.stringify(marketMap, null, 2)}` : ""}

${validationResult ? `VALIDATION RESULT:\n${JSON.stringify(validationResult, null, 2)}` : ""}
${performanceIntelligenceBlock}

Generate all 6 execution plans now. Strictly from the confirmed, validated data. Distribution MUST be derived from the Business Data Layer fields (business type: ${businessData?.businessType || "unknown"}, funnel objective: ${businessData?.funnelObjective || "unknown"}, budget: ${businessData?.monthlyBudget || "unknown"}, conversion channel: ${businessData?.primaryConversionChannel || "unknown"}). No hardcoded defaults. Geo-scoped to ${campaignContext.location || "specified location"}.`;

      log("BEFORE_AI_CALL", { model: "gpt-5.2", maxTokens: 4000 });

      let response;
      try {
        response = await aiChat({
          model: "gpt-5.2",
          messages: [
            { role: "system", content: ORCHESTRATOR_PROMPT },
            { role: "user", content: userPrompt },
          ],
          max_tokens: 4000,
          accountId: "default",
          endpoint: "strategic-orchestrator",
        });
      } catch (aiErr: any) {
        const durationMs = Date.now() - startMs;
        log("AI_CALL_FAILED", { code: aiErr.code, message: aiErr.message, durationMs });

        await logAuditEvent({
          accountId,
          campaignId: campaignId || undefined,
          blueprintId: id,
          blueprintVersion: blueprint.blueprintVersion,
          event: "ORCHESTRATOR_FAILED",
          details: { requestId, error: aiErr.code || "AI_ERROR", message: aiErr.message, durationMs },
        });

        if (aiErr.code === "AI_BUDGET_EXCEEDED") {
          return res.status(402).json({
            success: false,
            error: "AI_BUDGET_EXCEEDED",
            message: aiErr.message,
            requestId,
          });
        }

        if (aiErr.message?.includes("timeout") || aiErr.message?.includes("timed out") || aiErr.code === "ETIMEDOUT") {
          return res.status(504).json({
            success: false,
            error: "ORCHESTRATOR_TIMEOUT",
            message: "AI generation timed out. This is a complex operation — please retry.",
            durationMs,
            requestId,
          });
        }

        return res.status(500).json({
          success: false,
          error: "AI_CALL_FAILED",
          message: `AI call failed: ${aiErr.message}`,
          requestId,
        });
      }

      log("AFTER_AI_CALL", { durationMs: Date.now() - startMs });

      const rawText = response.choices[0]?.message?.content || "";
      let orchestratorPlan: any;

      try {
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          orchestratorPlan = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("No JSON object found in model response");
        }
      } catch (parseErr: any) {
        log("PARSE_FAILED", { error: parseErr.message, finishReason: response.choices[0]?.finish_reason });

        await logAuditEvent({
          accountId,
          campaignId: campaignId || undefined,
          blueprintId: id,
          blueprintVersion: blueprint.blueprintVersion,
          event: "ORCHESTRATOR_FAILED",
          details: { requestId, error: "PARSE_FAILED", message: parseErr.message, durationMs: Date.now() - startMs },
        });

        return res.status(500).json({
          success: false,
          error: "ORCHESTRATOR_PARSE_FAILED",
          message: `Orchestrator returned invalid format: ${parseErr.message}. Please retry.`,
          finishReason: response.choices[0]?.finish_reason || "unknown",
          requestId,
        });
      }

      if (!orchestratorPlan || Object.keys(orchestratorPlan).length === 0) {
        log("EMPTY_PLAN");
        return res.status(500).json({
          success: false,
          error: "ORCHESTRATOR_EMPTY_PLAN",
          message: "Orchestrator generated an empty execution plan. Please retry.",
          requestId,
        });
      }

      orchestratorPlan.blueprintVersion = blueprint.blueprintVersion;

      log("BEFORE_DB_WRITE");

      await db.update(strategicBlueprints)
        .set({
          status: "ORCHESTRATED",
          orchestratorPlan: JSON.stringify(orchestratorPlan),
          orchestratedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(strategicBlueprints.id, id));

      log("AFTER_DB_WRITE");

      const planSections = Object.keys(orchestratorPlan).filter(k => k !== "blueprintVersion");
      const summary = `Execution plan — ${planSections.length} structured sections`;
      const [realPlanRow] = await db.insert(strategicPlans).values({
        accountId,
        blueprintId: id,
        campaignId: campaignId || "default",
        planJson: JSON.stringify(orchestratorPlan),
        planSummary: summary,
        status: "DRAFT",
        executionStatus: "IDLE",
      }).returning();

      await logAuditEvent({
        accountId,
        campaignId: campaignId || undefined,
        blueprintId: id,
        blueprintVersion: blueprint.blueprintVersion,
        event: "ORCHESTRATOR_GENERATED",
        details: {
          requestId,
          mode: "PRODUCTION",
          planId: realPlanRow.id,
          planSections,
          performanceSignalsInjected,
          durationMs: Date.now() - startMs,
        },
      });

      log("COMPLETE", { durationMs: Date.now() - startMs, planId: realPlanRow.id });

      res.json({
        success: true,
        blueprintId: id,
        blueprintVersion: blueprint.blueprintVersion,
        status: "ORCHESTRATED",
        orchestratorPlan,
        planId: realPlanRow.id,
        planStatus: "DRAFT",
        requestId,
      });
    } catch (error: any) {
      const durationMs = Date.now() - startMs;
      log("UNHANDLED_ERROR", { code: error.code, message: error.message, durationMs });

      await logAuditEvent({
        accountId,
        campaignId: campaignId || undefined,
        blueprintId: id,
        blueprintVersion: 0,
        event: "ORCHESTRATOR_FAILED",
        details: { requestId, error: error.code || "INTERNAL_ERROR", message: error.message, durationMs },
      }).catch(() => {});

      res.status(500).json({
        success: false,
        error: "ORCHESTRATOR_INTERNAL_ERROR",
        message: `Failed to generate execution plans: ${error.message}`,
        requestId,
      });
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
