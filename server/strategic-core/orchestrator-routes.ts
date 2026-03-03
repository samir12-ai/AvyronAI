import type { Express, Request, Response } from "express";
import { aiChat, AICallError } from "../ai-client";
import { db } from "../db";
import { strategicBlueprints, strategicPlans, planApprovals, strategyMemory, strategyInsights, moatCandidates, businessDataLayer, planDocuments, requiredWork, calendarEntries, orchestratorJobs } from "@shared/schema";
import { eq, desc, gte, and, sql, ne } from "drizzle-orm";
import { logAuditEvent } from "./audit-logger";
import { logAudit } from "../audit";
import * as crypto from "crypto";
import { buildStrategicContext, type StrategicContext } from "../engine-contracts/context-kernel";
import { wrapEngineOutput, type EngineOutput } from "../engine-contracts/engine-contract";
import { validateSectionConsumption, type OutputType } from "../engine-contracts/output-types";
import { evaluateUncertainty, type UncertaintyResult } from "../engine-contracts/uncertainty-guard";
import { validateExecutionRoute } from "../engine-contracts/execution-map";
import { enforceOutputType } from "../engine-contracts/type-enforcement";
import { globalRegistry } from "../engine-contracts/engine-registry";
import { assertSnapshotReadOnly, assertNoComputeFromExternal } from "../market-intelligence-v3/isolation-guard";

function enforceBuildAPlanSnapshotOnly(operation: string): void {
  assertSnapshotReadOnly("BUILD_A_PLAN_ORCHESTRATOR", operation);
}

function enforceBuildAPlanNoCompute(computeFunction: string): void {
  assertNoComputeFromExternal("BUILD_A_PLAN_ORCHESTRATOR", computeFunction);
}

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


interface SectionSpec {
  key: string;
  label: string;
  systemPrompt: string;
  schemaHint: string;
  maxTokens: number;
}

const SECTION_SPECS: SectionSpec[] = [
  {
    key: "contentDistributionPlan",
    label: "Content Distribution",
    maxTokens: 800,
    systemPrompt: `You generate a content distribution plan for Instagram marketing. Use the confirmed blueprint for positioning and the Business Data Layer for distribution parameters. Business type determines format mix. Funnel objective determines purpose distribution (AWARENESS→Reels+Stories, LEADS→Carousels+Posts, SALES→balanced, AUTHORITY→Carousels+Posts). Budget determines volume. Conversion channel determines CTA placement. Geo-scope to the specified location. No hardcoded defaults. Respond with ONLY valid JSON.`,
    schemaHint: `{"contentDistributionPlan":{"platforms":[{"platform":"string","frequency":"string","priority":"primary|secondary","contentTypes":[{"type":"string","percentage":"string","weeklyCount":"number","rationale":"string"}],"bestPostingTimes":["string"],"hashtagStrategy":"string"}],"contentPillars":[{"pillar":"string","percentage":"string","examples":["string"]}]}}`,
  },
  {
    key: "creativeTestingMatrix",
    label: "Creative Testing",
    maxTokens: 500,
    systemPrompt: `You generate a creative testing matrix for Instagram marketing campaigns. Define 3-4 A/B tests with specific variables, durations, and rationale tied to the campaign's audience and objectives. Respond with ONLY valid JSON.`,
    schemaHint: `{"creativeTestingMatrix":{"tests":[{"testName":"string","variable":"string","duration":"string","rationale":"string"}]}}`,
  },
  {
    key: "budgetAllocationStructure",
    label: "Budget Allocation",
    maxTokens: 500,
    systemPrompt: `You generate a budget allocation structure for Instagram marketing. Derive total budget and category breakdown from the Business Data Layer monthly budget. Categories should cover content creation, paid promotion, community management, and tools. Respond with ONLY valid JSON.`,
    schemaHint: `{"budgetAllocationStructure":{"totalRecommended":"string","breakdown":[{"category":"string","percentage":"number","purpose":"string"}]}}`,
  },
  {
    key: "kpiMonitoringPriority",
    label: "KPI Monitoring",
    maxTokens: 600,
    systemPrompt: `You generate a KPI monitoring priority plan for Instagram marketing. Define 3 primary KPIs with targets, frequency, and alert thresholds, plus 2 secondary KPIs. Include a reporting cadence. Tie metrics to the campaign objective. Respond with ONLY valid JSON.`,
    schemaHint: `{"kpiMonitoringPriority":{"primaryKPIs":[{"kpi":"string","target":"string","frequency":"string","alertThreshold":"string"}],"secondaryKPIs":[{"kpi":"string","target":"string","frequency":"string"}],"reportingCadence":"string"}}`,
  },
  {
    key: "competitiveWatchTargets",
    label: "Competitive Watch",
    maxTokens: 500,
    systemPrompt: `You generate competitive watch targets for Instagram marketing. For each competitor URL provided, define watch metrics, alert triggers, and check frequency. Focus on actionable intelligence. Respond with ONLY valid JSON.`,
    schemaHint: `{"competitiveWatchTargets":{"targets":[{"competitor":"string","watchMetrics":["string"],"alertTriggers":["string"],"checkFrequency":"string"}]}}`,
  },
  {
    key: "riskMonitoringTriggers",
    label: "Risk Monitoring",
    maxTokens: 500,
    systemPrompt: `You generate risk monitoring triggers for Instagram marketing campaigns. Define 3-4 triggers with conditions, actions, and severity levels. Include an escalation path. Geo-scope risks to the specified location. Respond with ONLY valid JSON.`,
    schemaHint: `{"riskMonitoringTriggers":{"triggers":[{"trigger":"string","condition":"string","action":"string","severity":"low|medium|high|critical"}],"escalationPath":["string"]}}`,
  },
];

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

function buildSectionContext(params: {
  blueprint: any;
  confirmedBlueprint: any;
  campaignContext: any;
  competitorUrls: string[];
  businessData: any;
  marketMapRaw: any;
  performanceIntelligenceBlock: string;
}): string {
  const { blueprint, confirmedBlueprint, campaignContext, competitorUrls, businessData, marketMapRaw, performanceIntelligenceBlock } = params;
  const businessDataBlock = businessData
    ? `\nBUSINESS DATA:\n- Type: ${businessData.businessType || "N/A"}, Location: ${businessData.businessLocation || "N/A"}\n- Offer: ${capText(businessData.coreOffer, 200)}, Price: ${businessData.priceRange || "N/A"}\n- Audience: ${businessData.targetAudienceAge || "N/A"} / ${capText(businessData.targetAudienceSegment, 150)}\n- Budget: ${businessData.monthlyBudget || "N/A"}, Funnel: ${businessData.funnelObjective || "N/A"}\n- Conversion: ${businessData.primaryConversionChannel || "N/A"}`
    : `\nNo Business Data Layer. Use reasonable defaults based on campaign objective.`;

  return `Blueprint v${blueprint.blueprintVersion}. Do NOT override confirmed data.\nGeo-scope: ${campaignContext?.location || "Not specified"}\nCAMPAIGN: ${campaignContext?.campaignName || "N/A"} | ${campaignContext?.objective || "N/A"} | ${campaignContext?.platform || "N/A"}${businessDataBlock}\nBLUEPRINT: ${capJson(confirmedBlueprint, 1200)}\nASP: $${blueprint.averageSellingPrice || "N/A"}\nCOMPETITORS: ${competitorUrls.slice(0, 5).join(", ")}${marketMapRaw ? `\nMARKET MAP (summary): ${capJson(marketMapRaw, 600)}` : ""}${performanceIntelligenceBlock}`;
}

async function generateSingleSection(
  spec: SectionSpec,
  contextBlock: string,
  accountId: string,
  log: (stage: string, extra?: Record<string, any>) => void,
): Promise<{ result: any; aiGenerated: boolean; error?: string }> {
  const MAX_RETRIES = 1;
  const userPrompt = `${contextBlock}\n\nGenerate the ${spec.label} section. Keep arrays to 3-5 items max.\nRequired JSON schema:\n${spec.schemaHint}\n\nRespond with ONLY valid JSON matching the schema above.`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      log(`SECTION_${spec.key}_ATTEMPT_${attempt}`, { maxTokens: spec.maxTokens });

      const response = await aiChat({
        model: "gpt-4.1-mini",
        messages: [
          { role: "system", content: spec.systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: spec.maxTokens,
        accountId,
        endpoint: `strategic-orchestrator-${spec.key}`,
      });

      const rawText = response.choices[0]?.message?.content || "";
      log(`SECTION_${spec.key}_RESPONSE`, { rawLength: rawText.length, attempt, finishReason: response.choices[0]?.finish_reason });

      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON in response");

      const parsed = JSON.parse(jsonMatch[0]);
      const sectionData = parsed[spec.key] || parsed;
      if (!sectionData || typeof sectionData !== "object" || Object.keys(sectionData).length === 0) {
        throw new Error("Empty section data");
      }

      return { result: sectionData, aiGenerated: true };
    } catch (err: any) {
      log(`SECTION_${spec.key}_FAIL_${attempt}`, { error: err.message, code: err.code, willRetry: attempt < MAX_RETRIES });

      if (err.code === "AI_BUDGET_EXCEEDED") {
        return { result: null, aiGenerated: false, error: "AI_BUDGET_EXCEEDED" };
      }

      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }

      return { result: null, aiGenerated: false, error: err.message };
    }
  }

  return { result: null, aiGenerated: false, error: "Exhausted retries" };
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

    enforceBuildAPlanSnapshotOnly("READ_BLUEPRINT");
    log("ISOLATION_CHECK", { result: "PASS", rule: "BUILD_A_PLAN reads snapshot only, no MIv3 compute calls" });

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
          performanceIntelligenceBlock = `\nPERFORMANCE SIGNALS:\n${memories.length > 0 ? `Memory: ${capJson(memories.map(m => ({ type: m.memoryType, label: m.label, score: m.score })), 400)}` : ""}${insights.length > 0 ? `\nInsights: ${capJson(insights.map(i => ({ category: i.category, insight: i.insight, confidence: i.confidence })), 400)}` : ""}${moats.length > 0 ? `\nMoats: ${capJson(moats.map(m => ({ label: m.label, moatScore: m.moatScore })), 200)}` : ""}`;
        }
      }
    } catch (err) { log("PERF_INTEL_SKIPPED", { error: (err as Error).message }); }

    log("CONTEXT_BUILT");

    let strategicContext: StrategicContext | null = null;
    try {
      strategicContext = await buildStrategicContext(campaignId || "default", accountId);
      log("STRATEGIC_CONTEXT_BUILT", {
        marketMode: strategicContext.marketMode,
        awarenessLevel: strategicContext.awarenessLevel,
        competitionLevel: strategicContext.competitionLevel,
        pricingBand: strategicContext.pricingBand,
        growthDirection: strategicContext.growthDirection,
        dataConfidence: strategicContext.dataConfidence,
      });
    } catch (ctxErr: any) {
      log("STRATEGIC_CONTEXT_SKIPPED", { error: ctxErr.message });
    }

    const contextBlock = buildSectionContext({
      blueprint, confirmedBlueprint, campaignContext, competitorUrls, businessData, marketMapRaw, performanceIntelligenceBlock,
    });

    const fallbackPlan = generateFallbackPlan({ confirmedBlueprint, campaignContext, competitorUrls, businessData });

    const sectionStatuses = initSectionStatuses();
    await updateJob({ sectionStatuses: JSON.stringify(sectionStatuses) });

    const orchestratorPlan: any = {};
    let aiGeneratedCount = 0;
    let fallbackCount = 0;
    const fallbackReasons: string[] = [];
    let budgetExceeded = false;

    for (const spec of SECTION_SPECS) {
      const sectionStartMs = Date.now();
      sectionStatuses[spec.key] = "GENERATING";
      await updateJob({ sectionStatuses: JSON.stringify(sectionStatuses) });

      log(`SECTION_START_${spec.key}`, { label: spec.label });

      const { result, aiGenerated, error } = await generateSingleSection(spec, contextBlock, accountId, log);

      const sectionDurationMs = Date.now() - sectionStartMs;
      stageTimes[`section_${spec.key}`] = sectionDurationMs;

      if (aiGenerated && result) {
        orchestratorPlan[spec.key] = result;
        sectionStatuses[spec.key] = "COMPLETE";
        aiGeneratedCount++;
        log(`SECTION_COMPLETE_${spec.key}`, { aiGenerated: true, durationMs: sectionDurationMs });
      } else {
        if (error === "AI_BUDGET_EXCEEDED") {
          budgetExceeded = true;
          log(`SECTION_BUDGET_EXCEEDED_${spec.key}`, { durationMs: sectionDurationMs });
        }
        orchestratorPlan[spec.key] = fallbackPlan[spec.key] || {};
        sectionStatuses[spec.key] = "FALLBACK";
        fallbackCount++;
        fallbackReasons.push(`${spec.label}: ${error || "unknown"}`);
        log(`SECTION_FALLBACK_${spec.key}`, { reason: error, durationMs: sectionDurationMs });
      }

      await updateJob({
        sectionStatuses: JSON.stringify(sectionStatuses),
        planJson: JSON.stringify(orchestratorPlan),
        stageTimes: JSON.stringify(stageTimes),
      });

      if (budgetExceeded) {
        for (const remaining of SECTION_SPECS) {
          if (!orchestratorPlan[remaining.key]) {
            orchestratorPlan[remaining.key] = fallbackPlan[remaining.key] || {};
            sectionStatuses[remaining.key] = "FALLBACK";
            fallbackCount++;
            fallbackReasons.push(`${remaining.label}: budget exceeded`);
          }
        }
        await updateJob({ sectionStatuses: JSON.stringify(sectionStatuses) });
        break;
      }
    }

    const usedFallback = fallbackCount > 0;
    const fallbackReason = usedFallback ? `${fallbackCount}/${SECTION_SPECS.length} sections used fallback: ${fallbackReasons.join("; ")}` : null;

    orchestratorPlan.blueprintVersion = blueprint.blueprintVersion;
    if (usedFallback) {
      orchestratorPlan.fallback = fallbackCount === SECTION_SPECS.length;
      orchestratorPlan.partialFallback = fallbackCount > 0 && fallbackCount < SECTION_SPECS.length;
      orchestratorPlan.fallbackReason = fallbackReason;
      orchestratorPlan.aiGeneratedSections = aiGeneratedCount;
      orchestratorPlan.fallbackSections = fallbackCount;
    }

    log("ALL_SECTIONS_COMPLETE", { aiGenerated: aiGeneratedCount, fallback: fallbackCount, totalDurationMs: Date.now() - startMs, sectionStatuses });

    const SECTION_TO_OUTPUT_TYPE: Record<string, OutputType> = {
      contentDistributionPlan: "DISTRIBUTION_PLAN",
      creativeTestingMatrix: "STRATEGY_SECTION",
      budgetAllocationStructure: "STRATEGY_SECTION",
      kpiMonitoringPriority: "STRATEGY_SECTION",
      competitiveWatchTargets: "STRATEGY_SECTION",
      riskMonitoringTriggers: "STRATEGY_SECTION",
    };

    let eligibleEngineIds: string[] = [];
    if (strategicContext) {
      const eligible = globalRegistry.getEligible(strategicContext);
      eligibleEngineIds = eligible.map(e => e.id);
      log("ENGINE_ELIGIBILITY", { eligible: eligibleEngineIds, total: globalRegistry.getRegistered().length });

      const orchestratorEngine = globalRegistry.getById("strategic-orchestrator");
      if (orchestratorEngine && !eligibleEngineIds.includes("strategic-orchestrator")) {
        log("ENGINE_ORCHESTRATOR_INELIGIBLE", { reason: "Strategic orchestrator failed eligibility — skipping plan generation" });
        await updateJob({ status: "FAILED", error: "Strategic orchestrator engine is not eligible for current context", errorCode: "ENGINE_INELIGIBLE", completedAt: new Date() });
        await logAuditEvent({ accountId, campaignId: campaignId || undefined, blueprintId, blueprintVersion: blueprint.blueprintVersion, event: "ENGINE_INELIGIBLE", details: { engineId: "strategic-orchestrator", strategicContext } });
        return;
      }
    }

    const engineOutputs: EngineOutput[] = [];
    for (const spec of SECTION_SPECS) {
      const sectionData = orchestratorPlan[spec.key];
      const wasAiGenerated = sectionStatuses[spec.key] === "COMPLETE";
      const outputType = SECTION_TO_OUTPUT_TYPE[spec.key] || "STRATEGY_SECTION";

      try {
        const wrapped = wrapEngineOutput(sectionData, {
          score: wasAiGenerated ? 80 : 40,
          reasoning: wasAiGenerated ? `AI-generated ${spec.label}` : `Fallback ${spec.label}`,
          confidence: wasAiGenerated ? 75 : 30,
          dataCompleteness: wasAiGenerated ? 80 : 50,
          scope: `campaign:${campaignId}`,
          outputType: outputType as OutputType,
          riskFlag: !wasAiGenerated ? `${spec.label} used fallback` : undefined,
        });

        validateSectionConsumption("BUILD_A_PLAN", wrapped.outputType);
        enforceOutputType("BUILD_A_PLAN", wrapped);
        validateExecutionRoute("BUILD_A_PLAN", "BUILD_A_PLAN", wrapped.outputType);

        engineOutputs.push(wrapped);
      } catch (wrapErr: any) {
        log(`SECTION_CONTRACT_VIOLATION_${spec.key}`, { error: wrapErr.message, code: wrapErr.code });
      }
    }

    let uncertaintyResult: UncertaintyResult | null = null;
    if (engineOutputs.length > 0) {
      uncertaintyResult = evaluateUncertainty(engineOutputs);
      log("UNCERTAINTY_GUARD", {
        decision: uncertaintyResult.decision,
        confidence: uncertaintyResult.aggregatedConfidence,
        completeness: uncertaintyResult.aggregatedCompleteness,
        riskFlags: uncertaintyResult.riskFlags.length,
      });

      if (uncertaintyResult.decision === "BLOCK") {
        orchestratorPlan.uncertaintyGuard = {
          decision: "BLOCK",
          confidence: uncertaintyResult.aggregatedConfidence,
          completeness: uncertaintyResult.aggregatedCompleteness,
          reasoning: uncertaintyResult.reasoning,
          riskFlags: uncertaintyResult.riskFlags,
        };
        log("UNCERTAINTY_BLOCK", { reasoning: uncertaintyResult.reasoning });

        await db.update(strategicBlueprints)
          .set({ status: "ORCHESTRATED", orchestratorPlan: JSON.stringify(orchestratorPlan), orchestratedAt: new Date(), updatedAt: new Date() })
          .where(eq(strategicBlueprints.id, blueprintId));

        const [blockedPlan] = await db.insert(strategicPlans).values({
          accountId, blueprintId, campaignId: campaignId || "default",
          planJson: JSON.stringify(orchestratorPlan),
          planSummary: `BLOCKED — ${uncertaintyResult.reasoning.substring(0, 100)}`,
          status: "BLOCKED", executionStatus: "IDLE",
        }).returning();

        await updateJob({ status: "COMPLETE", sectionStatuses: JSON.stringify(sectionStatuses), planJson: JSON.stringify(orchestratorPlan), planId: blockedPlan.id, fallback: true, fallbackReason: `Uncertainty guard BLOCK: ${uncertaintyResult.reasoning}`, stageTimes: JSON.stringify(stageTimes), durationMs: Date.now() - startMs, completedAt: new Date() });
        await logAuditEvent({ accountId, campaignId: campaignId || undefined, blueprintId, blueprintVersion: blueprint.blueprintVersion, event: "UNCERTAINTY_BLOCK", details: { jobId, planId: blockedPlan.id, uncertaintyGuard: uncertaintyResult, strategicContext: strategicContext || undefined } });
        return;
      }

      if (uncertaintyResult.decision === "DOWNGRADE") {
        orchestratorPlan.uncertaintyGuard = {
          decision: "DOWNGRADE",
          confidence: uncertaintyResult.aggregatedConfidence,
          completeness: uncertaintyResult.aggregatedCompleteness,
          reasoning: uncertaintyResult.reasoning,
          riskFlags: uncertaintyResult.riskFlags,
        };
      }
    }

    await db.update(strategicBlueprints)
      .set({
        status: "ORCHESTRATED",
        orchestratorPlan: JSON.stringify(orchestratorPlan),
        orchestratedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(strategicBlueprints.id, blueprintId));

    const planSectionKeys = PLAN_SECTIONS.filter(k => orchestratorPlan[k] && typeof orchestratorPlan[k] === "object");
    const summary = usedFallback
      ? `Execution plan — ${aiGeneratedCount} AI-generated, ${fallbackCount} fallback`
      : `Execution plan — ${planSectionKeys.length} AI-generated sections`;

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

    try {
      const existingDocs = await db.select({ id: planDocuments.id }).from(planDocuments).where(eq(planDocuments.planId, planRow.id));
      const nextVersion = existingDocs.length + 1;

      const sectionsJson: Record<string, any> = {};
      for (const k of PLAN_SECTIONS) {
        sectionsJson[k] = orchestratorPlan[k] || {};
      }
      if (usedFallback) {
        sectionsJson.metadata = { isFallback: fallbackCount === SECTION_SPECS.length, fallbackReason, aiGeneratedCount, fallbackCount, fallbackReasons, sectionStatuses };
      }

      const confirmedBlueprintForDoc = blueprint.confirmedBlueprint ? JSON.parse(blueprint.confirmedBlueprint) : null;
      const workRows = await db.select().from(requiredWork).where(and(eq(requiredWork.planId, planRow.id), eq(requiredWork.accountId, accountId))).limit(1);
      const calEntryCount = await db.select({ count: sql<number>`count(*)` }).from(calendarEntries).where(eq(calendarEntries.planId, planRow.id));

      const markdown = generatePlanMarkdown({
        blueprint,
        confirmedBlueprint: confirmedBlueprintForDoc,
        plan: planRow,
        planJson: orchestratorPlan,
        work: workRows[0] || null,
        calendarCount: Number(calEntryCount[0]?.count || 0),
      });

      const fileName = `Plan_${planRow.id.slice(0, 8)}_v${nextVersion}_${new Date().toISOString().slice(0, 10)}.md`;

      await db.insert(planDocuments).values({
        planId: planRow.id,
        blueprintId,
        campaignId: campaignId || "default",
        accountId,
        version: nextVersion,
        fileName,
        content: markdown,
        contentJson: JSON.stringify(sectionsJson),
        contentMarkdown: markdown,
        isFallback: fallbackCount === SECTION_SPECS.length,
        format: "markdown",
      });

      log("PLAN_DOCUMENT_SAVED", { planId: planRow.id, version: nextVersion, isFallback: fallbackCount === SECTION_SPECS.length });
    } catch (docErr: any) {
      log("PLAN_DOCUMENT_SAVE_ERROR", { error: docErr.message });
    }

    const auditEvent = aiGeneratedCount === 0 ? "ORCHESTRATOR_FALLBACK" : usedFallback ? "ORCHESTRATOR_PARTIAL" : "ORCHESTRATOR_GENERATED";
    await logAuditEvent({
      accountId,
      campaignId: campaignId || undefined,
      blueprintId,
      blueprintVersion: blueprint.blueprintVersion,
      event: auditEvent,
      details: { jobId, planId: planRow.id, aiGeneratedCount, fallbackCount, performanceSignalsInjected, durationMs: Date.now() - startMs, stageTimes, usedFallback, sectionStatuses, fallbackReasons, strategicContext: strategicContext || undefined, uncertaintyGuard: uncertaintyResult || undefined },
    });

    await updateJob({
      status: "COMPLETE",
      sectionStatuses: JSON.stringify(sectionStatuses),
      planJson: JSON.stringify(orchestratorPlan),
      planId: planRow.id,
      fallback: fallbackCount === SECTION_SPECS.length,
      fallbackReason,
      stageTimes: JSON.stringify(stageTimes),
      durationMs: Date.now() - startMs,
      completedAt: new Date(),
    });

    log("COMPLETE", { durationMs: Date.now() - startMs, planId: planRow.id, aiGeneratedCount, fallbackCount, stageTimes });
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

  app.get("/api/plans/:planId/document", async (req: Request, res: Response) => {
    try {
      const { planId } = req.params;
      const accountId = (req.query.accountId as string) || "default";
      const campaignId = req.query.campaignId as string | undefined;

      const [plan] = await db.select().from(strategicPlans).where(eq(strategicPlans.id, planId)).limit(1);
      if (!plan) {
        return res.status(404).json({ success: false, error: "PLAN_NOT_FOUND", message: "Plan not found." });
      }

      if (plan.accountId !== accountId) {
        return res.status(403).json({ success: false, error: "ACCOUNT_MISMATCH", message: "Plan does not belong to this account." });
      }

      const conditions = [eq(planDocuments.planId, planId), eq(planDocuments.accountId, accountId)];
      if (campaignId) conditions.push(eq(planDocuments.campaignId, campaignId));

      const docs = await db.select().from(planDocuments)
        .where(and(...conditions))
        .orderBy(desc(planDocuments.createdAt))
        .limit(1);

      if (docs.length === 0) {
        return res.status(404).json({ success: false, error: "DOCUMENT_NOT_FOUND", message: "No plan document found for this plan." });
      }

      const doc = docs[0];
      let parsedContentJson = null;
      try {
        if (doc.contentJson) parsedContentJson = JSON.parse(doc.contentJson);
      } catch { parsedContentJson = null; }

      res.json({
        success: true,
        document: {
          id: doc.id,
          planId: doc.planId,
          blueprintId: doc.blueprintId,
          campaignId: doc.campaignId,
          version: doc.version,
          fileName: doc.fileName,
          contentJson: parsedContentJson,
          contentMarkdown: doc.contentMarkdown || doc.content,
          isFallback: doc.isFallback,
          createdAt: doc.createdAt,
        },
        plan: { id: plan.id, status: plan.status, campaignId: plan.campaignId },
      });
    } catch (error: any) {
      console.error("[PlanDocument] Error fetching document:", error.message);
      res.status(500).json({ success: false, error: "INTERNAL_ERROR", message: error.message });
    }
  });

  app.get("/api/strategic/blueprint/:id/document", async (req: Request, res: Response) => {
    try {
      const { id: blueprintId } = req.params;

      const [blueprint] = await db.select().from(strategicBlueprints).where(eq(strategicBlueprints.id, blueprintId)).limit(1);
      if (!blueprint) {
        return res.status(404).json({ success: false, error: "BLUEPRINT_NOT_FOUND", message: "Blueprint not found." });
      }

      const plans = await db.select().from(strategicPlans)
        .where(and(
          eq(strategicPlans.blueprintId, blueprintId),
          eq(strategicPlans.accountId, blueprint.accountId),
          ne(strategicPlans.status, "SUPERSEDED"),
        ))
        .orderBy(desc(strategicPlans.createdAt))
        .limit(1);

      if (plans.length === 0) {
        return res.status(404).json({ success: false, error: "PLAN_NOT_FOUND", message: "No plan found for this blueprint." });
      }

      const plan = plans[0];
      const docs = await db.select().from(planDocuments)
        .where(and(
          eq(planDocuments.planId, plan.id),
          eq(planDocuments.accountId, blueprint.accountId),
        ))
        .orderBy(desc(planDocuments.createdAt))
        .limit(1);

      if (docs.length === 0) {
        return res.status(404).json({ success: false, error: "DOCUMENT_NOT_FOUND", message: "No plan document found. The plan may not have been generated yet." });
      }

      const doc = docs[0];
      let parsedContentJson = null;
      try {
        if (doc.contentJson) parsedContentJson = JSON.parse(doc.contentJson);
      } catch { parsedContentJson = null; }

      res.json({
        success: true,
        document: {
          id: doc.id,
          planId: doc.planId,
          blueprintId: doc.blueprintId,
          campaignId: doc.campaignId,
          version: doc.version,
          fileName: doc.fileName,
          contentJson: parsedContentJson,
          contentMarkdown: doc.contentMarkdown || doc.content,
          isFallback: doc.isFallback,
          createdAt: doc.createdAt,
        },
        plan: { id: plan.id, status: plan.status, campaignId: plan.campaignId },
      });
    } catch (error: any) {
      console.error("[PlanDocument] Error fetching blueprint document:", error.message);
      res.status(500).json({ success: false, error: "INTERNAL_ERROR", message: error.message });
    }
  });
}
