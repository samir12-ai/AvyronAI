import type { Express } from "express";
import { db } from "./db";
import {
  performanceSnapshots,
  strategyInsights,
  strategyDecisions,
  strategyMemory,
  weeklyReports,
  moatCandidates,
  signatureSeries,
  strategicBlueprints,
} from "@shared/schema";
import { eq, desc, sql, and, gte, lte } from "drizzle-orm";
import { aiChat } from "./ai-client";
import { requireCampaign } from "./campaign-routes";
import { getRevenueSummary, getCampaignMetrics } from "./campaign-data-layer";
import { logAuditEvent } from "./strategic-core/audit-logger";

async function getAccountAverages() {
  const result = await db.select({
    avgReach: sql<number>`coalesce(avg(${performanceSnapshots.reach}), 0)`,
    avgImpressions: sql<number>`coalesce(avg(${performanceSnapshots.impressions}), 0)`,
    avgSaves: sql<number>`coalesce(avg(${performanceSnapshots.saves}), 0)`,
    avgShares: sql<number>`coalesce(avg(${performanceSnapshots.shares}), 0)`,
    avgLikes: sql<number>`coalesce(avg(${performanceSnapshots.likes}), 0)`,
    avgComments: sql<number>`coalesce(avg(${performanceSnapshots.comments}), 0)`,
    avgClicks: sql<number>`coalesce(avg(${performanceSnapshots.clicks}), 0)`,
    avgCtr: sql<number>`coalesce(avg(${performanceSnapshots.ctr}), 0)`,
    avgCpm: sql<number>`coalesce(avg(${performanceSnapshots.cpm}), 0)`,
    avgCpc: sql<number>`coalesce(avg(${performanceSnapshots.cpc}), 0)`,
    avgCpa: sql<number>`coalesce(avg(${performanceSnapshots.cpa}), 0)`,
    avgRoas: sql<number>`coalesce(avg(${performanceSnapshots.roas}), 0)`,
    avgRetention: sql<number>`coalesce(avg(${performanceSnapshots.retentionRate}), 0)`,
    avgWatchTime: sql<number>`coalesce(avg(${performanceSnapshots.watchTime}), 0)`,
    totalPosts: sql<number>`count(*)`,
  }).from(performanceSnapshots);
  return result[0];
}

async function getActiveBlueprintId(): Promise<string | null> {
  const [blueprint] = await db.select({ id: strategicBlueprints.id })
    .from(strategicBlueprints)
    .orderBy(desc(strategicBlueprints.updatedAt))
    .limit(1);
  return blueprint?.id || null;
}

export { getAccountAverages };

export function registerStrategyRoutes(app: Express) {

  app.post("/api/strategy/sync-performance", requireCampaign, async (req, res) => {
    try {
      const { accessToken, pageId } = req.body;

      const campaignContext = (req as any).campaignContext;
      const accountId = (req.query.accountId as string) || "default";

      if (!accessToken || !pageId) {
        const demoData = generateDemoPerformanceData(campaignContext.campaignId, accountId);
        for (const item of demoData) {
          await db.insert(performanceSnapshots).values(item);
        }

        await logAuditEvent({
          accountId,
          campaignId: campaignContext.campaignId,
          event: "PERFORMANCE_SYNC_COMPLETED",
          details: { synced: demoData.length, mode: "demo" },
        });

        return res.json({
          success: true,
          demo: true,
          synced: demoData.length,
          message: "Demo performance data loaded for strategy analysis.",
        });
      }

      try {
        const postsRes = await fetch(
          `https://graph.facebook.com/v18.0/${pageId}/posts?fields=id,message,created_time,type&limit=25&access_token=${accessToken}`
        );
        const postsData = await postsRes.json();
        const posts = postsData.data || [];

        let synced = 0;
        for (const post of posts) {
          const insightsRes = await fetch(
            `https://graph.facebook.com/v18.0/${post.id}/insights?metric=post_impressions,post_engaged_users,post_clicks,post_reactions_like_total&access_token=${accessToken}`
          );
          const insightsData = await insightsRes.json();
          const metrics = insightsData.data || [];

          const getMetricValue = (name: string) => {
            const m = metrics.find((x: any) => x.name === name);
            return m?.values?.[0]?.value || 0;
          };

          await db.insert(performanceSnapshots).values({
            postId: post.id,
            platform: "facebook",
            contentType: post.type || "status",
            reach: getMetricValue("post_impressions"),
            impressions: getMetricValue("post_impressions"),
            likes: getMetricValue("post_reactions_like_total"),
            clicks: getMetricValue("post_clicks"),
            comments: 0,
            shares: 0,
            saves: 0,
            campaignId: campaignContext.campaignId,
            accountId,
            publishedAt: new Date(post.created_time),
          });
          synced++;
        }

        await logAuditEvent({
          accountId,
          campaignId: campaignContext.campaignId,
          event: "PERFORMANCE_SYNC_COMPLETED",
          details: { synced, mode: "meta_api" },
        });

        res.json({ success: true, synced });
      } catch (apiErr: any) {
        console.error("[Strategy] Meta API error:", apiErr.message);
        const demoData = generateDemoPerformanceData(campaignContext.campaignId, accountId);
        for (const item of demoData) {
          await db.insert(performanceSnapshots).values(item);
        }

        await logAuditEvent({
          accountId,
          campaignId: campaignContext.campaignId,
          event: "PERFORMANCE_SYNC_COMPLETED",
          details: { synced: demoData.length, mode: "demo_fallback", reason: apiErr.message },
        });

        res.json({
          success: true,
          demo: true,
          synced: demoData.length,
          message: "Could not reach Meta API. Demo data loaded instead.",
        });
      }
    } catch (error: any) {
      console.error("[Strategy] Sync error:", error.message);
      res.status(500).json({ error: error.message || "Failed to sync performance data" });
    }
  });

  app.get("/api/strategy/performance", requireCampaign, async (req, res) => {
    try {
      const data = await db.select().from(performanceSnapshots).orderBy(desc(performanceSnapshots.fetchedAt)).limit(100);
      const averages = await getAccountAverages();
      res.json({ data, averages });
    } catch (error) {
      console.error("[Strategy] Performance fetch error:", error);
      res.status(500).json({ error: "Failed to fetch performance data" });
    }
  });

  app.post("/api/strategy/analyze", requireCampaign, async (req, res) => {
    try {
      const allData = await db.select().from(performanceSnapshots).orderBy(desc(performanceSnapshots.fetchedAt)).limit(50);
      const averages = await getAccountAverages();
      const memories = await db.select().from(strategyMemory).orderBy(desc(strategyMemory.updatedAt)).limit(20);

      if (allData.length === 0) {
        return res.status(400).json({ error: "No performance data available. Sync your Meta data first." });
      }

      const campaignContext = (req as any).campaignContext;
      const revenueSummary = await getRevenueSummary(campaignContext.campaignId, "default");
      const campaignMetrics = await getCampaignMetrics(campaignContext.campaignId, "default");

      const activePlanId = await getActiveBlueprintId();

      const dataForAI = allData.map(d => ({
        postId: d.postId,
        type: d.contentType,
        angle: d.contentAngle,
        hook: d.hookStyle,
        format: d.format,
        reach: d.reach,
        impressions: d.impressions,
        saves: d.saves,
        shares: d.shares,
        likes: d.likes,
        comments: d.comments,
        clicks: d.clicks,
        ctr: d.ctr,
        cpm: d.cpm,
        cpc: d.cpc,
        cpa: d.cpa,
        roas: d.roas,
        retentionRate: d.retentionRate,
        watchTime: d.watchTime,
        audienceAge: d.audienceAge,
      }));

      const memoryContext = memories.map(m => ({
        type: m.memoryType,
        label: m.label,
        score: m.score,
        winner: m.isWinner,
        details: m.details,
      }));

      const aiResponse = await aiChat({
        model: "gpt-5.2",
        messages: [
          {
            role: "system",
            content: `You are a Chief Marketing Officer, Performance Media Buyer, Creative Director, Growth Hacker, and Brand Strategy Architect combined into one strategic AI engine.

SYSTEM MODE: PERFORMANCE INTELLIGENCE LAYER
ROLE: Signal provider for the active strategic plan. You do NOT create plans. You provide performance-backed recommendations that feed into the single execution track.

You analyze social media performance data and make data-driven strategic decisions. You NEVER generate random ideas. Every insight and decision must be backed by the data provided.

CRITICAL: You are a SUPPORT LAYER, not an execution authority. Your outputs are:
- Insights (observations from data)
- Recommendations (proposed actions for the active plan)
- Memory updates (learned patterns)
- Moat signals (brand defensibility opportunities)

You do NOT:
- Create execution plans
- Generate campaign lifecycles
- Produce calendar entries
- Override the active strategic plan

Your analysis must include:

1. PATTERN RECOGNITION:
- Which content angles generate highest saves
- Which hooks generate highest retention
- Which formats convert best
- Which audience segments respond most
- What objections appear in comments
- Which patterns show STABILITY (consistent performance, not one-hit wonders)

2. STRATEGIC RECOMMENDATIONS (signal-based):
- If retention is high → Recommend scaling this angle in the active plan
- If CTR is low → Recommend hook regeneration
- If CPA increases over time → Recommend pausing and requesting new creative direction
- If saves high but conversions low → Recommend stronger CTA
- Each recommendation needs: reason, suggested action, objective, confidence score

3. COMPETITIVE DEFENSE:
- When competitor overlap is detected → Recommend increasing uniqueness layer
- Strengthen terminology ownership
- Focus on differentiation, not just performance

4. MEMORY UPDATES:
- Identify winning angles, hooks, formats to remember
- Identify losing ones to avoid
- Note audience patterns
- Flag potential MOAT CANDIDATES (high stability + high resonance + hard to copy)

5. SYSTEMS THINKING:
- Stop producing isolated post ideas
- Instead produce: Named frameworks, repeatable branded series ideas
- Every major recommendation must answer: "How does this make the brand harder to replace?"

ACCOUNT AVERAGES:
${JSON.stringify(averages, null, 2)}

PAST MEMORY (what the system already knows):
${JSON.stringify(memoryContext, null, 2)}

CAMPAIGN CONTEXT:
Campaign: ${campaignContext.campaignName} (Goal: ${campaignContext.goalType})
Location: ${campaignContext.location || 'Not specified'}
${activePlanId ? `ACTIVE PLAN ID: ${activePlanId} (all recommendations feed this plan)` : 'NO ACTIVE PLAN — recommendations will be queued for next plan'}

REVENUE DATA (injected from Revenue Attribution):
${JSON.stringify({ totalRevenue: revenueSummary.totalRevenue, monthRevenue: revenueSummary.monthRevenue, roas: revenueSummary.roas, monthRoas: revenueSummary.monthRoas, topRevenueContent: revenueSummary.topRevenueContent, costPerLead: revenueSummary.costPerLead, leadToCustomerRate: revenueSummary.leadToCustomerRate })}

CAMPAIGN METRICS:
${JSON.stringify({ totalSpend: campaignMetrics.totalSpend, avgCpa: campaignMetrics.avgCpa, avgRoas: campaignMetrics.avgRoas, totalConversions: campaignMetrics.totalConversions, totalLeads: campaignMetrics.totalLeads })}

CRITICAL: Your analysis must account for revenue data. Engagement-only optimization is NOT sufficient. Prioritize recommendations that increase revenue, reduce CPA, and improve ROAS.

Return ONLY valid JSON with this structure:
{
  "insights": [
    {
      "category": "pattern|hook|format|audience|objection",
      "insight": "Clear observation statement",
      "confidence": 0.85,
      "relatedMetric": "saves|ctr|retention|cpa|roas",
      "metricValue": 45.2,
      "accountAverage": 30.0
    }
  ],
  "recommendations": [
    {
      "trigger": "What triggered this recommendation",
      "action": "Specific action to take within the active plan",
      "reason": "Data-backed reasoning",
      "objective": "Strategic goal",
      "budgetAdjustment": "+20% to winning angle",
      "priority": "high|medium|low",
      "confidence": 0.85
    }
  ],
  "memoryUpdates": [
    {
      "memoryType": "winning_angle|losing_angle|winning_hook|failed_hook|audience_pattern|objection|format_winner",
      "label": "Short label",
      "details": "Why this matters",
      "score": 0.9,
      "isWinner": true
    }
  ],
  "executiveSummary": "2-3 sentence strategic overview",
  "moatSignals": ["Potential moat opportunity 1", "Potential moat opportunity 2"],
  "systemMode": "PERFORMANCE_INTELLIGENCE"
}`
          },
          {
            role: "user",
            content: `Analyze this performance data and provide strategic insights, recommendations, and memory updates:\n\n${JSON.stringify(dataForAI, null, 2)}`
          }
        ],
        max_tokens: 4000,
        accountId: "default",
        endpoint: "strategy-analysis",
      });

      const aiContent = aiResponse.choices[0]?.message?.content || "";
      let analysis;
      try {
        const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
        analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
      } catch {
        analysis = null;
      }

      if (!analysis) {
        return res.status(500).json({ error: "AI analysis failed to produce valid results" });
      }

      const accountId = (req.query.accountId as string) || "default";
      const cId = campaignContext.campaignId;

      if (analysis.insights?.length) {
        for (const ins of analysis.insights) {
          await db.insert(strategyInsights).values({
            accountId,
            campaignId: cId,
            category: ins.category,
            insight: ins.insight,
            confidence: ins.confidence || 0,
            dataPoints: allData.length,
            relatedMetric: ins.relatedMetric,
            metricValue: ins.metricValue,
            accountAverage: ins.accountAverage,
          });
        }
      }

      const decisions = analysis.recommendations || analysis.decisions || [];
      if (decisions.length) {
        for (const dec of decisions) {
          await db.insert(strategyDecisions).values({
            accountId,
            trigger: dec.trigger,
            action: dec.action,
            reason: dec.reason,
            objective: dec.objective,
            budgetAdjustment: dec.budgetAdjustment,
            priority: dec.priority || "medium",
          });
        }
      }

      if (analysis.memoryUpdates?.length) {
        for (const mem of analysis.memoryUpdates) {
          await db.insert(strategyMemory).values({
            accountId,
            campaignId: cId,
            memoryType: mem.memoryType,
            label: mem.label,
            details: mem.details,
            score: mem.score || 0,
            isWinner: mem.isWinner || false,
          });
        }
      }

      await logAuditEvent({
        accountId: "default",
        campaignId: campaignContext.campaignId,
        blueprintId: activePlanId || undefined,
        event: "PERFORMANCE_SIGNAL_PROPOSED",
        details: {
          insightsCount: analysis.insights?.length || 0,
          recommendationsCount: decisions.length,
          memoryUpdatesCount: analysis.memoryUpdates?.length || 0,
          moatSignalsCount: analysis.moatSignals?.length || 0,
          planId: activePlanId,
          signalSource: "performance_analysis",
          confidenceAvg: analysis.insights?.length
            ? analysis.insights.reduce((s: number, i: any) => s + (i.confidence || 0), 0) / analysis.insights.length
            : 0,
        },
      });

      res.json({
        success: true,
        insights: analysis.insights || [],
        recommendations: decisions,
        memoryUpdates: analysis.memoryUpdates || [],
        executiveSummary: analysis.executiveSummary || "",
        moatSignals: analysis.moatSignals || [],
        systemMode: "PERFORMANCE_INTELLIGENCE",
        dataPointsAnalyzed: allData.length,
        activePlanId,
      });
    } catch (error: any) {
      console.error("[Strategy] Analysis error:", error.message);
      res.status(500).json({ error: error.message || "Strategy analysis failed" });
    }
  });

  app.get("/api/strategy/insights", requireCampaign, async (req, res) => {
    try {
      const insights = await db.select().from(strategyInsights)
        .where(eq(strategyInsights.isActive, true))
        .orderBy(desc(strategyInsights.createdAt))
        .limit(30);
      res.json(insights);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch insights" });
    }
  });

  app.get("/api/strategy/decisions", requireCampaign, async (req, res) => {
    try {
      const decisions = await db.select().from(strategyDecisions)
        .orderBy(desc(strategyDecisions.createdAt))
        .limit(30);
      res.json(decisions);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch decisions" });
    }
  });

  app.patch("/api/strategy/decisions/:id", requireCampaign, async (req, res) => {
    try {
      const { status, outcome } = req.body;
      await db.update(strategyDecisions)
        .set({ status, outcome, executedAt: status === 'executed' ? new Date() : undefined })
        .where(eq(strategyDecisions.id, req.params.id as string));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to update decision" });
    }
  });

  app.get("/api/strategy/memory", requireCampaign, async (req, res) => {
    try {
      const memories = await db.select().from(strategyMemory)
        .orderBy(desc(strategyMemory.updatedAt))
        .limit(50);
      res.json(memories);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch memory" });
    }
  });

  app.post("/api/strategy/weekly-report", requireCampaign, async (req, res) => {
    try {
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const weekData = await db.select().from(performanceSnapshots)
        .where(gte(performanceSnapshots.fetchedAt, weekAgo))
        .orderBy(desc(performanceSnapshots.fetchedAt));

      const insights = await db.select().from(strategyInsights)
        .where(gte(strategyInsights.createdAt, weekAgo))
        .orderBy(desc(strategyInsights.createdAt));

      const decisions = await db.select().from(strategyDecisions)
        .where(gte(strategyDecisions.createdAt, weekAgo));

      const memories = await db.select().from(strategyMemory)
        .orderBy(desc(strategyMemory.updatedAt)).limit(20);

      const averages = await getAccountAverages();

      const campaignContext = (req as any).campaignContext;
      const revenueSummary = await getRevenueSummary(campaignContext.campaignId, "default");
      const activePlanId = await getActiveBlueprintId();

      const aiResponse = await aiChat({
        model: "gpt-5.2",
        messages: [
          {
            role: "system",
            content: `You are a Senior Marketing Strategist writing a weekly performance report. You are part of the PERFORMANCE INTELLIGENCE LAYER — your report feeds the single strategic plan.

The report must include:
1. What worked this week (with data)
2. What failed (with data)
3. Why it happened (root cause analysis)
4. What to scale (with budget recommendations)
5. What to stop immediately
6. Next week's focus areas
7. Budget reallocation logic

Be specific. Reference actual metrics. No fluff. Think like a CMO presenting to a CEO.
${activePlanId ? `\nACTIVE PLAN ID: ${activePlanId} — All recommendations feed this plan.` : ''}

ACCOUNT AVERAGES: ${JSON.stringify(averages)}

RECENT INSIGHTS: ${JSON.stringify(insights.map(i => ({ category: i.category, insight: i.insight, confidence: i.confidence })))}

DECISIONS MADE: ${JSON.stringify(decisions.map(d => ({ trigger: d.trigger, action: d.action, status: d.status })))}

MEMORY (past learnings): ${JSON.stringify(memories.map(m => ({ type: m.memoryType, label: m.label, winner: m.isWinner })))}

REVENUE CONTEXT (from Revenue Attribution module):
Total Revenue: $${revenueSummary.totalRevenue}, Month Revenue: $${revenueSummary.monthRevenue}
ROAS: ${revenueSummary.roas}, Month ROAS: ${revenueSummary.monthRoas}
Top Revenue Content: ${JSON.stringify(revenueSummary.topRevenueContent)}
Cost Per Lead: $${revenueSummary.costPerLead}
Lead-to-Customer Rate: ${revenueSummary.leadToCustomerRate}%

Your report MUST include revenue analysis, not just engagement metrics.

Return JSON:
{
  "summary": "Executive summary paragraph",
  "whatWorked": "Detailed analysis",
  "whatFailed": "Detailed analysis",
  "whyItHappened": "Root cause analysis",
  "whatToScale": "Specific scaling recommendations",
  "whatToStop": "What to immediately stop",
  "nextWeekFocus": "Clear priorities for next week",
  "budgetReallocation": "Specific budget adjustments",
  "baselineMetrics": { "avgReach": 0, "avgCtr": 0, "avgCpa": 0, "avgRoas": 0 },
  "selfImprovements": ["Adjustment 1", "Adjustment 2"]
}`
          },
          {
            role: "user",
            content: `Generate the weekly strategic report. This week's data (${weekData.length} posts):\n${JSON.stringify(weekData.map(d => ({ type: d.contentType, angle: d.contentAngle, reach: d.reach, saves: d.saves, ctr: d.ctr, cpa: d.cpa, roas: d.roas, conversions: d.conversions })))}`
          }
        ],
        max_tokens: 4000,
        accountId: "default",
        endpoint: "strategy-weekly",
      });

      const content = aiResponse.choices[0]?.message?.content || "";
      let report;
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        report = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
      } catch { report = null; }

      if (!report) {
        return res.status(500).json({ error: "Failed to generate report" });
      }

      const [savedReport] = await db.insert(weeklyReports).values({
        weekStart: weekAgo,
        weekEnd: now,
        summary: report.summary,
        whatWorked: report.whatWorked,
        whatFailed: report.whatFailed,
        whyItHappened: report.whyItHappened,
        whatToScale: report.whatToScale,
        whatToStop: report.whatToStop,
        nextWeekFocus: report.nextWeekFocus,
        budgetReallocation: report.budgetReallocation,
        baselineMetrics: JSON.stringify(report.baselineMetrics || {}),
      }).returning();

      if (report.selfImprovements?.length) {
        for (const improvement of report.selfImprovements) {
          await db.insert(strategyMemory).values({
            accountId: "default",
            campaignId: campaignContext.campaignId,
            memoryType: "self_improvement",
            label: improvement,
            details: `Auto-generated improvement from weekly report on ${now.toISOString().split('T')[0]}`,
            score: 0.5,
            isWinner: false,
          });
        }
      }

      await logAuditEvent({
        accountId: "default",
        campaignId: campaignContext.campaignId,
        blueprintId: activePlanId || undefined,
        event: "WEEKLY_REPORT_GENERATED",
        details: {
          reportId: savedReport.id,
          dataPoints: weekData.length,
          planId: activePlanId,
          signalSource: "weekly_report",
        },
      });

      res.json({ success: true, report: { ...savedReport, ...report }, activePlanId });
    } catch (error: any) {
      console.error("[Strategy] Report error:", error.message);
      res.status(500).json({ error: error.message || "Failed to generate weekly report" });
    }
  });

  app.get("/api/strategy/weekly-reports", requireCampaign, async (req, res) => {
    try {
      const reports = await db.select().from(weeklyReports)
        .orderBy(desc(weeklyReports.createdAt)).limit(12);
      res.json(reports);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch reports" });
    }
  });

  app.post("/api/strategy/audience-snipe", requireCampaign, async (req, res) => {
    try {
      const { campaignGoal, product, budget } = req.body;
      const memories = await db.select().from(strategyMemory)
        .orderBy(desc(strategyMemory.updatedAt)).limit(20);
      const insights = await db.select().from(strategyInsights)
        .where(eq(strategyInsights.isActive, true))
        .orderBy(desc(strategyInsights.createdAt)).limit(15);
      const averages = await getAccountAverages();

      const aiResponse = await aiChat({
        model: "gpt-5.2",
        messages: [
          {
            role: "system",
            content: `You are an elite Meta Ads Media Buyer. You think like a human media buyer at a top agency.

Using performance data and historical memory, you must:
1. Detect micro-audience segments
2. Suggest interest stacking strategies
3. Suggest lookalike audiences
4. Identify exclusion groups
5. Analyze comment intent patterns
6. Create objection-handling content suggestions

PAST PERFORMANCE: ${JSON.stringify(averages)}
MEMORY: ${JSON.stringify(memories.map(m => ({ type: m.memoryType, label: m.label, score: m.score, winner: m.isWinner })))}
INSIGHTS: ${JSON.stringify(insights.map(i => ({ category: i.category, insight: i.insight })))}

Return JSON:
{
  "microSegments": [
    { "name": "Segment name", "description": "Why this segment", "estimatedSize": "50K-100K", "matchScore": 85 }
  ],
  "interestStacks": [
    { "primary": "Main interest", "stacked": ["interest2", "interest3"], "rationale": "Why this combo works" }
  ],
  "lookalikes": [
    { "source": "What audience to base on", "percentage": "1-3%", "rationale": "Why" }
  ],
  "exclusions": [
    { "group": "Who to exclude", "reason": "Why exclude them" }
  ],
  "objectionHandling": [
    { "objection": "Common objection", "contentSuggestion": "How to address it", "format": "reel|story|carousel" }
  ],
  "summary": "Strategic targeting overview"
}`
          },
          {
            role: "user",
            content: `Create audience sniping strategy for:\nGoal: ${campaignGoal || 'maximize conversions'}\nProduct: ${product || 'not specified'}\nBudget: $${budget || 'flexible'}`
          }
        ],
        max_tokens: 3000,
        accountId: "default",
        endpoint: "strategy-insight",
      });

      const content = aiResponse.choices[0]?.message?.content || "";
      let result;
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        result = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
      } catch { result = null; }

      if (!result) {
        return res.status(500).json({ error: "Audience analysis failed" });
      }

      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error("[Strategy] Audience snipe error:", error.message);
      res.status(500).json({ error: error.message || "Audience sniping failed" });
    }
  });

  app.post("/api/strategy/moat-scan", requireCampaign, async (req, res) => {
    try {
      const memories = await db.select().from(strategyMemory).orderBy(desc(strategyMemory.updatedAt)).limit(30);
      const insights = await db.select().from(strategyInsights).where(eq(strategyInsights.isActive, true)).orderBy(desc(strategyInsights.createdAt)).limit(20);
      const allPerf = await db.select().from(performanceSnapshots).orderBy(desc(performanceSnapshots.fetchedAt)).limit(50);
      const averages = await getAccountAverages();

      if (memories.length === 0 && insights.length === 0) {
        return res.status(400).json({ error: "Run AI Analysis first to populate memory and patterns before scanning for moat candidates." });
      }

      const activePlanId = await getActiveBlueprintId();

      const aiResponse = await aiChat({
        model: "gpt-5.2",
        messages: [
          {
            role: "system",
            content: `You are a Brand Strategy Architect operating as the MOAT INTELLIGENCE MODULE within the Performance Intelligence Layer.

Your mission is to identify long-term defensible brand advantages ("moats") from performance data and strategic memory. Your output feeds the active strategic plan as moat signals.

Scan the memory bank and pattern insights to identify:
1. HIGH STABILITY ANGLES - Content angles that consistently perform well over time (not one-hit wonders)
2. REPEATED WINNERS - Patterns that win again and again
3. BLUE OCEAN OPPORTUNITIES - Spaces with high resonance but low competition
4. HIGH AUDIENCE RESONANCE - Content that creates deep engagement (saves, shares, comments with intent)

For each candidate, evaluate:
- Stability (0-1): How consistently does this perform? Higher = more stable
- Resonance (0-1): How deeply does the audience engage? Higher = deeper connection
- Uniqueness (0-1): How hard is this to copy? Higher = more defensible
- Moat Score (0-1): Overall defensibility rating = (stability * 0.3 + resonance * 0.3 + uniqueness * 0.4)

Every candidate must answer: "Does this make the brand harder to replace?"

MEMORY BANK: ${JSON.stringify(memories.map(m => ({ type: m.memoryType, label: m.label, score: m.score, winner: m.isWinner, details: m.details })))}

PATTERN INSIGHTS: ${JSON.stringify(insights.map(i => ({ category: i.category, insight: i.insight, confidence: i.confidence, metric: i.relatedMetric, value: i.metricValue })))}

PERFORMANCE AVERAGES: ${JSON.stringify(averages)}

Return ONLY valid JSON:
{
  "candidates": [
    {
      "sourceType": "winning_angle|audience_pattern|content_format|hook_system|brand_positioning",
      "label": "Short descriptive name",
      "description": "Why this is a moat candidate - data-backed reasoning",
      "stability": 0.85,
      "resonance": 0.78,
      "uniqueness": 0.92,
      "moatScore": 0.86,
      "dataEvidence": "Specific metrics and patterns that support this"
    }
  ],
  "scanSummary": "Executive overview of moat landscape",
  "topOpportunity": "The single best moat opportunity and why"
}`
          },
          {
            role: "user",
            content: `Scan for moat candidates. Recent top-performing content:\n${JSON.stringify(allPerf.filter(p => (p.saves || 0) > 20 || (p.roas || 0) > 3).slice(0, 15).map(p => ({ angle: p.contentAngle, hook: p.hookStyle, format: p.format, saves: p.saves, shares: p.shares, roas: p.roas, ctr: p.ctr, retention: p.retentionRate })))}`
          }
        ],
        max_tokens: 3000,
        accountId: "default",
        endpoint: "strategy-moat",
      });

      const content = aiResponse.choices[0]?.message?.content || "";
      let result;
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        result = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
      } catch { result = null; }

      if (!result?.candidates?.length) {
        return res.status(500).json({ error: "Moat scan did not produce valid candidates" });
      }

      const saved = [];
      for (const c of result.candidates) {
        const [record] = await db.insert(moatCandidates).values({
          accountId: "default",
          campaignId: (req as any).campaignContext?.campaignId,
          sourceType: c.sourceType || "winning_angle",
          label: c.label,
          description: c.description,
          stability: c.stability || 0,
          resonance: c.resonance || 0,
          uniqueness: c.uniqueness || 0,
          moatScore: c.moatScore || 0,
          dataEvidence: c.dataEvidence,
          status: "candidate",
        }).returning();
        saved.push(record);
      }

      await logAuditEvent({
        accountId: "default",
        campaignId: (req as any).campaignContext?.campaignId,
        blueprintId: activePlanId || undefined,
        event: "MOAT_SCAN_COMPLETED",
        details: {
          candidatesFound: saved.length,
          planId: activePlanId,
          signalSource: "moat_scan",
          topScore: Math.max(...saved.map(s => s.moatScore || 0)),
        },
      });

      res.json({
        success: true,
        candidates: saved,
        scanSummary: result.scanSummary,
        topOpportunity: result.topOpportunity,
        activePlanId,
      });
    } catch (error: any) {
      console.error("[Moat] Scan error:", error.message);
      res.status(500).json({ error: error.message || "Moat scan failed" });
    }
  });

  app.get("/api/strategy/moat-candidates", async (req, res) => {
    try {
      const candidates = await db.select().from(moatCandidates).orderBy(desc(moatCandidates.moatScore)).limit(20);
      res.json(candidates);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch moat candidates" });
    }
  });

  app.post("/api/strategy/signature-series", async (req, res) => {
    try {
      const { candidateId } = req.body;
      const [candidate] = await db.select().from(moatCandidates).where(eq(moatCandidates.id, candidateId));
      if (!candidate) return res.status(404).json({ error: "Moat candidate not found" });

      const memories = await db.select().from(strategyMemory).orderBy(desc(strategyMemory.updatedAt)).limit(15);
      const averages = await getAccountAverages();

      const aiResponse = await aiChat({
        model: "gpt-5.2",
        messages: [
          {
            role: "system",
            content: `You are a Brand Content Architect. Convert a moat candidate into a full Signature Series - a repeatable, branded content system that builds long-term authority.

The series must be:
- REPEATABLE: Clear episode structure that can run indefinitely
- BRANDED: Unique naming and terminology that becomes associated with the brand
- DEFENSIBLE: Hard to copy because it's built on proprietary insights and style
- SCALABLE: Can expand into sub-series, spin-offs, and cross-platform adaptations

MOAT CANDIDATE:
Label: ${candidate.label}
Description: ${candidate.description}
Stability: ${candidate.stability}
Resonance: ${candidate.resonance}
Uniqueness: ${candidate.uniqueness}
Evidence: ${candidate.dataEvidence}

BRAND MEMORY: ${JSON.stringify(memories.filter(m => m.isWinner).map(m => ({ type: m.memoryType, label: m.label })))}
AVERAGES: ${JSON.stringify(averages)}

Return ONLY valid JSON:
{
  "name": "Branded series name (unique, memorable, ownable)",
  "corePromise": "The value proposition for the audience in one sentence",
  "episodeStructure": "Detailed repeatable episode format: intro hook, body structure, CTA pattern",
  "hookFormula": "The specific hook formula that opens each episode",
  "ctaFramework": "CTA strategy that evolves across episodes (awareness > engagement > conversion)",
  "postingCadence": "Recommended frequency and best days/times",
  "expansionRoadmap": "How this series can expand: sub-series, collaborations, products, cross-platform",
  "authorityScore": 0.75,
  "differentiationScore": 0.85,
  "moatStrength": 0.80,
  "fatigueRisk": 0.20
}`
          },
          {
            role: "user",
            content: `Convert this moat candidate into a Signature Series: "${candidate.label}" - ${candidate.description}`
          }
        ],
        max_tokens: 3000,
        accountId: "default",
        endpoint: "strategy-recommendations",
      });

      const content = aiResponse.choices[0]?.message?.content || "";
      let seriesData;
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        seriesData = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
      } catch { seriesData = null; }

      if (!seriesData) {
        return res.status(500).json({ error: "Failed to generate signature series" });
      }

      const [series] = await db.insert(signatureSeries).values({
        name: seriesData.name,
        corePromise: seriesData.corePromise,
        episodeStructure: seriesData.episodeStructure,
        hookFormula: seriesData.hookFormula,
        ctaFramework: seriesData.ctaFramework,
        postingCadence: seriesData.postingCadence,
        expansionRoadmap: seriesData.expansionRoadmap,
        authorityScore: seriesData.authorityScore || 0,
        differentiationScore: seriesData.differentiationScore || 0,
        moatStrength: seriesData.moatStrength || 0,
        fatigueRisk: seriesData.fatigueRisk || 0,
        moatCandidateId: candidateId,
      }).returning();

      await db.update(moatCandidates).set({
        status: "converted",
        convertedToSeriesId: series.id,
        updatedAt: new Date(),
      }).where(eq(moatCandidates.id, candidateId));

      res.json({ success: true, series });
    } catch (error: any) {
      console.error("[Moat] Signature series error:", error.message);
      res.status(500).json({ error: error.message || "Failed to create signature series" });
    }
  });

  app.get("/api/strategy/signature-series", async (req, res) => {
    try {
      const series = await db.select().from(signatureSeries).where(eq(signatureSeries.isActive, true)).orderBy(desc(signatureSeries.createdAt));
      res.json(series);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch signature series" });
    }
  });

  app.get("/api/strategy/moat-dashboard", requireCampaign, async (req, res) => {
    try {
      const [candidates, series, memories, averages] = await Promise.all([
        db.select().from(moatCandidates).orderBy(desc(moatCandidates.moatScore)).limit(10),
        db.select().from(signatureSeries).where(eq(signatureSeries.isActive, true)).orderBy(desc(signatureSeries.createdAt)),
        db.select().from(strategyMemory).orderBy(desc(strategyMemory.updatedAt)).limit(20),
        getAccountAverages(),
      ]);

      const activeSeries = series.length;
      const avgAuthority = activeSeries > 0 ? series.reduce((sum, s) => sum + (s.authorityScore || 0), 0) / activeSeries : 0;
      const avgDifferentiation = activeSeries > 0 ? series.reduce((sum, s) => sum + (s.differentiationScore || 0), 0) / activeSeries : 0;
      const avgMoatStrength = activeSeries > 0 ? series.reduce((sum, s) => sum + (s.moatStrength || 0), 0) / activeSeries : 0;
      const avgFatigueRisk = activeSeries > 0 ? series.reduce((sum, s) => sum + (s.fatigueRisk || 0), 0) / activeSeries : 0;

      const pendingCandidates = candidates.filter(c => c.status === "candidate");
      const convertedCandidates = candidates.filter(c => c.status === "converted");

      const ipContribution = activeSeries > 0 ? Math.min(100, Math.round(activeSeries * 20 + avgMoatStrength * 30)) : 0;

      res.json({
        mode: "PERFORMANCE_INTELLIGENCE",
        scores: {
          authority: Math.round(avgAuthority * 100),
          differentiation: Math.round(avgDifferentiation * 100),
          moatStrength: Math.round(avgMoatStrength * 100),
          fatigueRisk: Math.round(avgFatigueRisk * 100),
          ipContribution,
        },
        activeSeries,
        pendingCandidates: pendingCandidates.length,
        convertedCandidates: convertedCandidates.length,
        candidates: pendingCandidates,
        series,
      });
    } catch (error) {
      console.error("[Moat] Dashboard error:", error);
      res.status(500).json({ error: "Failed to load moat dashboard" });
    }
  });

  app.get("/api/strategy/dashboard", requireCampaign, async (req, res) => {
    try {
      const activePlanId = await getActiveBlueprintId();

      const [averages, recentInsights, recentDecisions, memoryItems, latestReport] = await Promise.all([
        getAccountAverages(),
        db.select().from(strategyInsights).where(eq(strategyInsights.isActive, true)).orderBy(desc(strategyInsights.createdAt)).limit(5),
        db.select().from(strategyDecisions).orderBy(desc(strategyDecisions.createdAt)).limit(5),
        db.select().from(strategyMemory).orderBy(desc(strategyMemory.updatedAt)).limit(10),
        db.select().from(weeklyReports).orderBy(desc(weeklyReports.createdAt)).limit(1),
      ]);

      const winners = memoryItems.filter(m => m.isWinner);
      const losers = memoryItems.filter(m => !m.isWinner);

      res.json({
        mode: "PERFORMANCE_INTELLIGENCE",
        activePlanId,
        averages,
        recentInsights,
        recentDecisions,
        memory: { winners, losers, total: memoryItems.length },
        latestReport: latestReport[0] || null,
      });
    } catch (error) {
      console.error("[Strategy] Dashboard error:", error);
      res.status(500).json({ error: "Failed to load dashboard" });
    }
  });
}

function generateDemoPerformanceData(campaignId: string = "demo_lead_gen_001", accountId: string = "default") {
  const angles = ['problem-solution', 'storytelling', 'authority', 'behind-the-scenes', 'testimonial', 'educational', 'controversial-take', 'trend-jacking'];
  const hooks = ['direct', 'curiosity', 'statistic', 'question', 'bold-claim', 'story-opener'];
  const formats = ['reel', 'carousel', 'story', 'static-image', 'video-ad', 'live'];
  const types = ['organic', 'paid', 'boosted'];
  const ages = ['18-24', '25-34', '35-44', '45-54'];

  const data = [];
  const now = Date.now();

  for (let i = 0; i < 30; i++) {
    const isHighPerformer = Math.random() > 0.6;
    const base = isHighPerformer ? 2.5 : 1;

    data.push({
      postId: `demo_post_${i}`,
      platform: Math.random() > 0.3 ? 'facebook' : 'instagram',
      contentType: types[Math.floor(Math.random() * types.length)],
      contentAngle: angles[Math.floor(Math.random() * angles.length)],
      hookStyle: hooks[Math.floor(Math.random() * hooks.length)],
      format: formats[Math.floor(Math.random() * formats.length)],
      reach: Math.round((500 + Math.random() * 5000) * base),
      impressions: Math.round((800 + Math.random() * 8000) * base),
      saves: Math.round((5 + Math.random() * 80) * base),
      shares: Math.round((3 + Math.random() * 50) * base),
      likes: Math.round((20 + Math.random() * 300) * base),
      comments: Math.round((2 + Math.random() * 40) * base),
      clicks: Math.round((10 + Math.random() * 200) * base),
      watchTime: Math.round((5 + Math.random() * 45) * 10) / 10,
      retentionRate: Math.round((20 + Math.random() * 60) * 10) / 10,
      ctr: Math.round((0.5 + Math.random() * 5) * 100) / 100,
      cpm: Math.round((3 + Math.random() * 15) * 100) / 100,
      cpc: Math.round((0.1 + Math.random() * 2) * 100) / 100,
      cpa: Math.round((5 + Math.random() * 40) * 100) / 100,
      roas: Math.round((0.5 + Math.random() * 8) * 100) / 100,
      conversions: Math.round(Math.random() * 20 * base),
      audienceAge: ages[Math.floor(Math.random() * ages.length)],
      campaignId,
      accountId,
      publishedAt: new Date(now - i * 24 * 60 * 60 * 1000),
    });
  }

  return data;
}
