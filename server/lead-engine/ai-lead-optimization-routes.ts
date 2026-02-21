import type { Express } from "express";
import { db } from "../db";
import { leads, conversionEvents, ctaVariants, performanceSnapshots, publishedPosts } from "@shared/schema";
import { eq, desc, sql, gte } from "drizzle-orm";
import { featureFlagService } from "../feature-flags";
import { logAudit } from "../audit";
import { requireCampaign } from "../campaign-routes";
import { getRevenueSummary } from "../campaign-data-layer";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export function registerAiLeadOptimizationRoutes(app: Express) {
  app.post("/api/lead-optimization/analyze", requireCampaign, async (req, res) => {
    try {
      const accountId = req.body.accountId || "default";
      const campaignContext = (req as any).campaignContext;
      const check = await featureFlagService.checkWithDependencies("ai_lead_optimization_enabled", accountId);
      if (!check.enabled) {
        return res.status(403).json({ error: "AI Lead Optimization is not enabled" });
      }
      if (check.safeMode) {
        return res.json({
          analysis: null,
          safeMode: true,
          missingDependencies: check.missingDependencies,
          message: "AI Lead Optimization requires conversion_tracking and funnel_logic modules to be enabled.",
        });
      }

      const allLeads = await db.select().from(leads).where(eq(leads.accountId, accountId));
      const events = await db.select().from(conversionEvents)
        .where(eq(conversionEvents.accountId, accountId))
        .orderBy(desc(conversionEvents.createdAt)).limit(500);
      const ctas = await db.select().from(ctaVariants)
        .where(eq(ctaVariants.accountId, accountId));
      const posts = await db.select().from(publishedPosts)
        .where(eq(publishedPosts.accountId, accountId))
        .orderBy(desc(publishedPosts.createdAt)).limit(50);

      const leadSourceCounts: Record<string, number> = {};
      for (const lead of allLeads) {
        const src = lead.sourceType || "unknown";
        leadSourceCounts[src] = (leadSourceCounts[src] || 0) + 1;
      }

      const postLeadMap: Record<string, number> = {};
      for (const lead of allLeads) {
        if (lead.sourcePostId) {
          postLeadMap[lead.sourcePostId] = (postLeadMap[lead.sourcePostId] || 0) + 1;
        }
      }

      const topConvertingPosts = Object.entries(postLeadMap)
        .sort(([, a], [, b]) => b - a).slice(0, 10);

      const eventTypeCounts: Record<string, number> = {};
      for (const ev of events) {
        eventTypeCounts[ev.eventType] = (eventTypeCounts[ev.eventType] || 0) + 1;
      }

      const topCTAs = [...ctas]
        .sort((a, b) => (b.conversionRate || 0) - (a.conversionRate || 0))
        .slice(0, 5)
        .map(c => ({ text: c.ctaText, rate: c.conversionRate, clicks: c.clicks, conversions: c.conversions }));

      const dataPayload = {
        totalLeads: allLeads.length,
        leadsBySource: leadSourceCounts,
        conversionRate: allLeads.length > 0
          ? (allLeads.filter(l => l.status === "converted").length / allLeads.length * 100).toFixed(1)
          : 0,
        topConvertingPosts,
        eventBreakdown: eventTypeCounts,
        topCTAs,
        recentPostCount: posts.length,
      };

      const revenueSummary = await getRevenueSummary(campaignContext.campaignId, accountId);

      const response = await openai.chat.completions.create({
        model: "gpt-5.2",
        messages: [
          {
            role: "system",
            content: `You are an AI lead generation optimization expert. Analyze the conversion data and provide actionable insights to increase lead generation. Focus on:
1. What content patterns drive the most leads
2. Which CTAs perform best and why
3. Where the funnel is leaking
4. Specific content strategy adjustments to increase conversion
5. Lead quality insights
6. Revenue attribution analysis - which content and CTAs actually generate revenue, not just leads
7. Revenue-per-lead optimization - identify highest revenue-generating lead sources

REVENUE DATA (from Revenue Attribution module):
Total Revenue: $${revenueSummary.totalRevenue}, Month Revenue: $${revenueSummary.monthRevenue}
ROAS: ${revenueSummary.roas}, Top Revenue Content: ${JSON.stringify(revenueSummary.topRevenueContent)}
Cost Per Lead: $${revenueSummary.costPerLead}, Lead-to-Customer Rate: ${revenueSummary.leadToCustomerRate}%
Revenue by Funnel Stage: ${JSON.stringify(revenueSummary.revenueByFunnelStage)}

CRITICAL: Optimize for REVENUE, not just lead volume. A lead source with fewer leads but higher revenue-per-lead is more valuable.

Return JSON with: "insights" (array of {category, finding, recommendation, impact_level}), "contentStrategy" (object with adjustments), "predictedImpact" (estimated improvement percentages).`,
          },
          {
            role: "user",
            content: `Analyze this conversion data and provide lead optimization recommendations:\n${JSON.stringify(dataPayload)}`,
          },
        ],
        response_format: { type: "json_object" },
      });

      const analysis = JSON.parse(response.choices[0]?.message?.content || "{}");

      await logAudit(accountId, "AI_LEAD_OPTIMIZATION_RUN", {
        details: {
          leadsAnalyzed: allLeads.length,
          eventsAnalyzed: events.length,
          insightsGenerated: analysis.insights?.length || 0,
        },
      });

      res.json({ analysis, data: dataPayload });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/lead-optimization/best-content", requireCampaign, async (req, res) => {
    try {
      const accountId = (req.query.accountId as string) || "default";
      if (!(await featureFlagService.isEnabled("ai_lead_optimization_enabled", accountId))) {
        return res.json({ content: [], disabled: true });
      }

      const allLeads = await db.select().from(leads).where(eq(leads.accountId, accountId));
      const postLeadMap: Record<string, { leads: number; converted: number }> = {};
      for (const lead of allLeads) {
        if (lead.sourcePostId) {
          if (!postLeadMap[lead.sourcePostId]) postLeadMap[lead.sourcePostId] = { leads: 0, converted: 0 };
          postLeadMap[lead.sourcePostId].leads++;
          if (lead.status === "converted") postLeadMap[lead.sourcePostId].converted++;
        }
      }

      const posts = await db.select().from(publishedPosts).where(eq(publishedPosts.accountId, accountId));
      const bestContent = posts
        .filter(p => postLeadMap[p.id])
        .map(p => ({
          postId: p.id,
          caption: p.caption?.substring(0, 100),
          platform: p.platform,
          leadsGenerated: postLeadMap[p.id].leads,
          converted: postLeadMap[p.id].converted,
          engagement: p.engagement,
          reach: p.reach,
          leadRate: p.reach && p.reach > 0 ? (postLeadMap[p.id].leads / p.reach * 100).toFixed(2) : "0",
        }))
        .sort((a, b) => b.leadsGenerated - a.leadsGenerated)
        .slice(0, 20);

      res.json({ content: bestContent });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
