import type { Express } from "express";
import { db } from "./db";
import {
  performanceSnapshots,
  strategyInsights,
  strategyDecisions,
  strategyMemory,
  growthCampaigns,
  weeklyReports,
} from "@shared/schema";
import { eq, desc, sql, and, gte, lte } from "drizzle-orm";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

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

export function registerStrategyRoutes(app: Express) {

  app.post("/api/strategy/sync-performance", async (req, res) => {
    try {
      const { accessToken, pageId } = req.body;

      if (!accessToken || !pageId) {
        const demoData = generateDemoPerformanceData();
        for (const item of demoData) {
          await db.insert(performanceSnapshots).values(item);
        }
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
            publishedAt: new Date(post.created_time),
          });
          synced++;
        }

        res.json({ success: true, synced });
      } catch (apiErr: any) {
        console.error("[Strategy] Meta API error:", apiErr.message);
        const demoData = generateDemoPerformanceData();
        for (const item of demoData) {
          await db.insert(performanceSnapshots).values(item);
        }
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

  app.get("/api/strategy/performance", async (req, res) => {
    try {
      const data = await db.select().from(performanceSnapshots).orderBy(desc(performanceSnapshots.fetchedAt)).limit(100);
      const averages = await getAccountAverages();
      res.json({ data, averages });
    } catch (error) {
      console.error("[Strategy] Performance fetch error:", error);
      res.status(500).json({ error: "Failed to fetch performance data" });
    }
  });

  app.post("/api/strategy/analyze", async (req, res) => {
    try {
      const allData = await db.select().from(performanceSnapshots).orderBy(desc(performanceSnapshots.fetchedAt)).limit(50);
      const averages = await getAccountAverages();
      const memories = await db.select().from(strategyMemory).orderBy(desc(strategyMemory.updatedAt)).limit(20);

      if (allData.length === 0) {
        return res.status(400).json({ error: "No performance data available. Sync your Meta data first." });
      }

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

      const aiResponse = await openai.chat.completions.create({
        model: "gpt-5.2",
        messages: [
          {
            role: "system",
            content: `You are a Chief Marketing Officer, Performance Media Buyer, Creative Director, and Growth Hacker combined into one strategic AI engine.

You analyze social media performance data and make data-driven strategic decisions. You NEVER generate random ideas. Every insight and decision must be backed by the data provided.

Your analysis must include:

1. PATTERN RECOGNITION:
- Which content angles generate highest saves
- Which hooks generate highest retention
- Which formats convert best
- Which audience segments respond most
- What objections appear in comments

2. STRATEGIC DECISIONS (rule-based):
- If retention is high → Duplicate angle, generate variations, suggest budget scaling
- If CTR is low → Regenerate hooks only
- If CPA increases over time → Pause campaign, request new creative direction
- If saves high but conversions low → Add stronger call-to-action
- Each decision needs: reason, action, objective, budget adjustment

3. COMPETITIVE AWARENESS:
- Avoid generic content suggestions
- Focus on differentiation
- Strategy must drive measurable growth, not vanity metrics

4. MEMORY UPDATES:
- Identify winning angles, hooks, formats to remember
- Identify losing ones to avoid
- Note audience patterns

ACCOUNT AVERAGES:
${JSON.stringify(averages, null, 2)}

PAST MEMORY (what the system already knows):
${JSON.stringify(memoryContext, null, 2)}

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
  "decisions": [
    {
      "trigger": "What triggered this decision",
      "action": "Specific action to take",
      "reason": "Data-backed reasoning",
      "objective": "Strategic goal",
      "budgetAdjustment": "+20% to winning angle",
      "priority": "high|medium|low"
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
  "executiveSummary": "2-3 sentence strategic overview"
}`
          },
          {
            role: "user",
            content: `Analyze this performance data and provide strategic insights, decisions, and memory updates:\n\n${JSON.stringify(dataForAI, null, 2)}`
          }
        ],
        max_completion_tokens: 4000,
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

      if (analysis.insights?.length) {
        for (const ins of analysis.insights) {
          await db.insert(strategyInsights).values({
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

      if (analysis.decisions?.length) {
        for (const dec of analysis.decisions) {
          await db.insert(strategyDecisions).values({
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
            memoryType: mem.memoryType,
            label: mem.label,
            details: mem.details,
            score: mem.score || 0,
            isWinner: mem.isWinner || false,
          });
        }
      }

      res.json({
        success: true,
        insights: analysis.insights || [],
        decisions: analysis.decisions || [],
        memoryUpdates: analysis.memoryUpdates || [],
        executiveSummary: analysis.executiveSummary || "",
        dataPointsAnalyzed: allData.length,
      });
    } catch (error: any) {
      console.error("[Strategy] Analysis error:", error.message);
      res.status(500).json({ error: error.message || "Strategy analysis failed" });
    }
  });

  app.get("/api/strategy/insights", async (req, res) => {
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

  app.get("/api/strategy/decisions", async (req, res) => {
    try {
      const decisions = await db.select().from(strategyDecisions)
        .orderBy(desc(strategyDecisions.createdAt))
        .limit(30);
      res.json(decisions);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch decisions" });
    }
  });

  app.patch("/api/strategy/decisions/:id", async (req, res) => {
    try {
      const { status, outcome } = req.body;
      await db.update(strategyDecisions)
        .set({ status, outcome, executedAt: status === 'executed' ? new Date() : undefined })
        .where(eq(strategyDecisions.id, req.params.id));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to update decision" });
    }
  });

  app.get("/api/strategy/memory", async (req, res) => {
    try {
      const memories = await db.select().from(strategyMemory)
        .orderBy(desc(strategyMemory.updatedAt))
        .limit(50);
      res.json(memories);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch memory" });
    }
  });

  app.post("/api/strategy/growth-campaign", async (req, res) => {
    try {
      const { name, budget, testingAngles } = req.body;
      const [campaign] = await db.insert(growthCampaigns).values({
        name: name || "30-Day Growth Campaign",
        budget: budget || 0,
        testingAngles: JSON.stringify(testingAngles || []),
        stage: "testing",
        dayNumber: 1,
      }).returning();
      res.json(campaign);
    } catch (error) {
      res.status(500).json({ error: "Failed to create growth campaign" });
    }
  });

  app.get("/api/strategy/growth-campaigns", async (req, res) => {
    try {
      const campaigns = await db.select().from(growthCampaigns)
        .orderBy(desc(growthCampaigns.startedAt));
      res.json(campaigns);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch campaigns" });
    }
  });

  app.post("/api/strategy/growth-campaign/:id/advance", async (req, res) => {
    try {
      const [campaign] = await db.select().from(growthCampaigns)
        .where(eq(growthCampaigns.id, req.params.id));

      if (!campaign) return res.status(404).json({ error: "Campaign not found" });

      const allPerf = await db.select().from(performanceSnapshots)
        .orderBy(desc(performanceSnapshots.fetchedAt)).limit(30);
      const memories = await db.select().from(strategyMemory).limit(20);
      const averages = await getAccountAverages();

      const aiResponse = await openai.chat.completions.create({
        model: "gpt-5.2",
        messages: [
          {
            role: "system",
            content: `You are managing a 30-day Growth Campaign. Current stage: ${campaign.stage}. Day: ${campaign.dayNumber}/${campaign.totalDays}.

STAGES:
1. TESTING (Days 1-10): Test multiple content angles, hook styles, formats. Gather data.
2. OPTIMIZATION (Days 11-20): Kill bottom 40%, scale top 20%, focus on winning audience segment.
3. AUTHORITY (Days 21-30): Retarget engaged users, create authority content, strengthen brand positioning.

Auto-transition between stages based on day number.

CAMPAIGN DATA:
Testing angles: ${campaign.testingAngles}
Winning angles: ${campaign.winningAngles || 'None yet'}
Killed angles: ${campaign.killedAngles || 'None yet'}
Budget: $${campaign.budget}, Spent: $${campaign.spent}

ACCOUNT AVERAGES: ${JSON.stringify(averages)}
MEMORY: ${JSON.stringify(memories.map(m => ({ type: m.memoryType, label: m.label, score: m.score, winner: m.isWinner })))}

Return JSON:
{
  "newStage": "testing|optimization|authority",
  "newDay": number,
  "actions": ["action1", "action2"],
  "anglesUpdate": { "winning": ["angle1"], "killed": ["angle2"], "testing": ["angle3"] },
  "budgetRecommendation": "Specific budget advice",
  "summary": "What happened and what's next"
}`
          },
          {
            role: "user",
            content: `Advance the campaign. Recent performance data: ${JSON.stringify(allPerf.slice(0, 10).map(p => ({ type: p.contentType, angle: p.contentAngle, reach: p.reach, ctr: p.ctr, saves: p.saves, conversions: p.conversions })))}`
          }
        ],
        max_completion_tokens: 2000,
      });

      const content = aiResponse.choices[0]?.message?.content || "";
      let result;
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        result = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
      } catch { result = null; }

      if (result) {
        await db.update(growthCampaigns).set({
          stage: result.newStage || campaign.stage,
          dayNumber: result.newDay || (campaign.dayNumber || 1) + 1,
          winningAngles: JSON.stringify(result.anglesUpdate?.winning || []),
          killedAngles: JSON.stringify(result.anglesUpdate?.killed || []),
          results: result.summary,
          updatedAt: new Date(),
        }).where(eq(growthCampaigns.id, req.params.id));
      }

      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error("[Strategy] Growth advance error:", error.message);
      res.status(500).json({ error: error.message || "Failed to advance campaign" });
    }
  });

  app.post("/api/strategy/weekly-report", async (req, res) => {
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

      const aiResponse = await openai.chat.completions.create({
        model: "gpt-5.2",
        messages: [
          {
            role: "system",
            content: `You are a Senior Marketing Strategist writing a weekly performance report. You must sound authoritative, data-driven, and actionable.

The report must include:
1. What worked this week (with data)
2. What failed (with data)
3. Why it happened (root cause analysis)
4. What to scale (with budget recommendations)
5. What to stop immediately
6. Next week's focus areas
7. Budget reallocation logic

Be specific. Reference actual metrics. No fluff. Think like a CMO presenting to a CEO.

ACCOUNT AVERAGES: ${JSON.stringify(averages)}

RECENT INSIGHTS: ${JSON.stringify(insights.map(i => ({ category: i.category, insight: i.insight, confidence: i.confidence })))}

DECISIONS MADE: ${JSON.stringify(decisions.map(d => ({ trigger: d.trigger, action: d.action, status: d.status })))}

MEMORY (past learnings): ${JSON.stringify(memories.map(m => ({ type: m.memoryType, label: m.label, winner: m.isWinner })))}

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
        max_completion_tokens: 4000,
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
            memoryType: "self_improvement",
            label: improvement,
            details: `Auto-generated improvement from weekly report on ${now.toISOString().split('T')[0]}`,
            score: 0.5,
            isWinner: false,
          });
        }
      }

      res.json({ success: true, report: { ...savedReport, ...report } });
    } catch (error: any) {
      console.error("[Strategy] Report error:", error.message);
      res.status(500).json({ error: error.message || "Failed to generate weekly report" });
    }
  });

  app.get("/api/strategy/weekly-reports", async (req, res) => {
    try {
      const reports = await db.select().from(weeklyReports)
        .orderBy(desc(weeklyReports.createdAt)).limit(12);
      res.json(reports);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch reports" });
    }
  });

  app.post("/api/strategy/audience-snipe", async (req, res) => {
    try {
      const { campaignGoal, product, budget } = req.body;
      const memories = await db.select().from(strategyMemory)
        .orderBy(desc(strategyMemory.updatedAt)).limit(20);
      const insights = await db.select().from(strategyInsights)
        .where(eq(strategyInsights.isActive, true))
        .orderBy(desc(strategyInsights.createdAt)).limit(15);
      const averages = await getAccountAverages();

      const aiResponse = await openai.chat.completions.create({
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
        max_completion_tokens: 3000,
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

  app.get("/api/strategy/dashboard", async (req, res) => {
    try {
      const [averages, recentInsights, recentDecisions, memoryItems, activeCampaigns, latestReport] = await Promise.all([
        getAccountAverages(),
        db.select().from(strategyInsights).where(eq(strategyInsights.isActive, true)).orderBy(desc(strategyInsights.createdAt)).limit(5),
        db.select().from(strategyDecisions).orderBy(desc(strategyDecisions.createdAt)).limit(5),
        db.select().from(strategyMemory).orderBy(desc(strategyMemory.updatedAt)).limit(10),
        db.select().from(growthCampaigns).where(eq(growthCampaigns.isActive, true)),
        db.select().from(weeklyReports).orderBy(desc(weeklyReports.createdAt)).limit(1),
      ]);

      const winners = memoryItems.filter(m => m.isWinner);
      const losers = memoryItems.filter(m => !m.isWinner);

      res.json({
        averages,
        recentInsights,
        recentDecisions,
        memory: { winners, losers, total: memoryItems.length },
        activeCampaigns,
        latestReport: latestReport[0] || null,
      });
    } catch (error) {
      console.error("[Strategy] Dashboard error:", error);
      res.status(500).json({ error: "Failed to load dashboard" });
    }
  });
}

function generateDemoPerformanceData() {
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
      retentionRate: Math.round((20 + Math.random() * 70) * 10) / 10,
      ctr: Math.round((0.5 + Math.random() * 5) * 100) / 100,
      cpm: Math.round((3 + Math.random() * 15) * 100) / 100,
      cpc: Math.round((0.1 + Math.random() * 2) * 100) / 100,
      cpa: Math.round((5 + Math.random() * 40) * 100) / 100,
      roas: Math.round((0.5 + Math.random() * 6) * 100) / 100,
      spend: Math.round((10 + Math.random() * 200) * 100) / 100,
      conversions: Math.round((0 + Math.random() * 15) * base),
      audienceAge: ages[Math.floor(Math.random() * ages.length)],
      audienceGender: Math.random() > 0.5 ? 'female' : 'male',
      audienceLocation: Math.random() > 0.5 ? 'Dubai' : 'Abu Dhabi',
      publishedAt: new Date(now - i * 24 * 60 * 60 * 1000),
    });
  }

  return data;
}
