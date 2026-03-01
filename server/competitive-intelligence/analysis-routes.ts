import type { Express } from "express";
import { db } from "../db";
import { ciCompetitors, ciSnapshots, ciMarketAnalyses, ciRecommendations, ciStrategyDecisions } from "@shared/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { featureFlagService } from "../feature-flags";
import { logAudit } from "../audit";
import { requireCampaign } from "../campaign-routes";
import { aiChat } from "../ai-client";

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

const MINIMUM_FIELDS = ["postingFrequency", "contentTypeRatio", "engagementRatio"] as const;
const OPTIONAL_FIELDS = ["profileLink", "ctaPatterns", "hookStyles", "messagingTone", "socialProofPresence", "discountFrequency"] as const;

function meetsMinimumCriteria(c: any): boolean {
  return c.postingFrequency != null && !!c.contentTypeRatio && c.engagementRatio != null;
}

function getCompetitorMetadata(c: any): { isComplete: boolean; missingFields: string[]; evidenceScore: number } {
  const allFields = [...MINIMUM_FIELDS, ...OPTIONAL_FIELDS];
  const missingFields: string[] = [];
  for (const f of allFields) {
    if (c[f] == null || c[f] === "" || c[f] === "unknown") {
      missingFields.push(f);
    }
  }
  const evidenceScore = Math.round(((allFields.length - missingFields.length) / allFields.length) * 100) / 100;
  return { isComplete: missingFields.length === 0, missingFields, evidenceScore };
}

export function registerCiAnalysisRoutes(app: Express) {
  app.post("/api/ci/analyze", requireCampaign, async (req, res) => {
    try {
      const accountId = (req.body.accountId as string) || "default";
      const enabled = await featureFlagService.isEnabled("competitive_intelligence_enabled", accountId);
      if (!enabled) {
        return res.status(403).json({ error: "Competitive intelligence is disabled" });
      }

      const competitors = await db.select().from(ciCompetitors)
        .where(and(eq(ciCompetitors.accountId, accountId), eq(ciCompetitors.isActive, true), eq(ciCompetitors.isDemo, false)));

      const qualifiedCompetitors = competitors.filter(meetsMinimumCriteria);
      if (qualifiedCompetitors.length < 1) {
        return res.status(400).json({
          error: "INSUFFICIENT_DATA",
          message: "At least 1 competitor must have minimum core fields (postingFrequency, contentTypeRatio, engagementRatio)",
          totalCompetitors: competitors.length,
          qualifiedCompetitors: 0,
          allCompetitors: competitors.map(c => ({
            name: c.name,
            ...getCompetitorMetadata(c),
          })),
        });
      }

      const competitorManifest = qualifiedCompetitors.map(c => {
        const meta = getCompetitorMetadata(c);
        return { name: c.name, id: c.id, ...meta };
      });

      console.log(`[CI-Analysis] PRE-AI AUDIT | accountId=${accountId} | competitorsCount=${qualifiedCompetitors.length} | competitors=${JSON.stringify(competitorManifest)}`);

      const currentMonth = getCurrentMonth();

      for (const comp of qualifiedCompetitors) {
        await db.insert(ciSnapshots).values({
          accountId,
          competitorId: comp.id,
          snapshotMonth: currentMonth,
          postingFrequency: comp.postingFrequency,
          contentTypeRatio: comp.contentTypeRatio,
          engagementRatio: comp.engagementRatio,
          ctaPatterns: comp.ctaPatterns,
          discountFrequency: comp.discountFrequency,
          hookStyles: comp.hookStyles,
          messagingTone: comp.messagingTone,
          socialProofPresence: comp.socialProofPresence,
          rawData: JSON.stringify(comp),
        });
      }

      const previousMonth = getPreviousMonth(currentMonth);
      const prevSnapshots = await db.select().from(ciSnapshots)
        .where(and(eq(ciSnapshots.accountId, accountId), eq(ciSnapshots.snapshotMonth, previousMonth)));

      const prevAnalyses = await db.select().from(ciMarketAnalyses)
        .where(and(eq(ciMarketAnalyses.accountId, accountId), eq(ciMarketAnalyses.analysisMonth, previousMonth)))
        .limit(1);

      const competitorData = qualifiedCompetitors.map(c => {
        const meta = getCompetitorMetadata(c);
        return {
          name: c.name,
          platform: c.platform,
          profileLink: c.profileLink || null,
          businessType: c.businessType,
          objective: c.primaryObjective,
          postingFrequency: c.postingFrequency,
          contentTypeRatio: c.contentTypeRatio,
          engagementRatio: c.engagementRatio,
          ctaPatterns: c.ctaPatterns || null,
          discountFrequency: c.discountFrequency || null,
          hookStyles: c.hookStyles || null,
          messagingTone: c.messagingTone || null,
          socialProofPresence: c.socialProofPresence || null,
          _metadata: {
            isComplete: meta.isComplete,
            missingFields: meta.missingFields,
            evidenceScore: meta.evidenceScore,
          },
        };
      });

      const prevData = prevSnapshots.length > 0 ? prevSnapshots.map(s => ({
        competitorId: s.competitorId,
        month: s.snapshotMonth,
        postingFrequency: s.postingFrequency,
        engagementRatio: s.engagementRatio,
        contentTypeRatio: s.contentTypeRatio,
        ctaPatterns: s.ctaPatterns,
      })) : null;

      const prompt = buildAnalysisPrompt(competitorData, prevData, prevAnalyses[0] || null);

      const aiResponse = await aiChat({
        model: "gpt-5.2",
        messages: [
          { role: "system", content: getSystemPrompt() },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        max_tokens: 4096,
        accountId,
        endpoint: "ci-market-analysis",
      });

      const rawContent = aiResponse.choices[0]?.message?.content || "{}";
      let analysis;
      try {
        analysis = JSON.parse(rawContent);
      } catch {
        return res.status(500).json({ error: "Failed to parse AI analysis" });
      }

      const avgEvidenceScore = competitorData.reduce((sum, c) => sum + c._metadata.evidenceScore, 0) / competitorData.length;
      const dataCompleteness = avgEvidenceScore;

      const [savedAnalysis] = await db.insert(ciMarketAnalyses).values({
        accountId,
        analysisMonth: currentMonth,
        marketOverview: JSON.stringify(analysis.marketOverview || {}),
        competitorBreakdown: JSON.stringify(analysis.competitorBreakdown || []),
        strategicGaps: JSON.stringify(analysis.strategicGaps || []),
        saturationPatterns: analysis.saturationPatterns || null,
        differentiationGaps: analysis.differentiationGaps || null,
        offerPositioningGaps: analysis.offerPositioningGaps || null,
        pricingNarrativePatterns: analysis.pricingNarrativePatterns || null,
        funnelWeaknesses: analysis.funnelWeaknesses || null,
        ctaTrends: analysis.ctaTrends || null,
        authorityGaps: analysis.authorityGaps || null,
        monthDiff: JSON.stringify(analysis.monthDiff || null),
        clientPerformanceShift: analysis.clientPerformanceShift || null,
        evidenceSummary: JSON.stringify(analysis.evidenceSummary || {}),
        dataCompleteness,
        status: "completed",
      }).returning();

      await logAudit(accountId, "INTELLIGENCE_RUN", {
        details: {
          analysisId: savedAnalysis.id,
          month: currentMonth,
          competitorsAnalyzed: qualifiedCompetitors.length,
          competitorManifest,
          dataCompleteness,
        },
      });

      const recommendations = analysis.recommendations || [];
      const savedRecs = [];
      for (const rec of recommendations) {
        const [saved] = await db.insert(ciRecommendations).values({
          accountId,
          analysisId: savedAnalysis.id,
          category: rec.category || "general",
          title: rec.title || "Untitled",
          description: rec.description || "",
          actionType: rec.actionType || "content_clusters",
          actionTarget: rec.actionTarget || "general",
          actionDetails: JSON.stringify(rec.actionDetails || {}),
          evidenceCitations: JSON.stringify(rec.evidenceCitations || []),
          whyChanged: rec.whyChanged || null,
          confidenceScore: rec.confidenceScore || 0,
          riskLevel: rec.riskLevel || "low",
          impactRangeLow: rec.impactRangeLow || 0,
          impactRangeHigh: rec.impactRangeHigh || 0,
          timeframe: rec.timeframe || "30_days",
          status: "pending",
        }).returning();
        savedRecs.push(saved);

        await logAudit(accountId, "STRATEGY_RECOMMENDED", {
          details: {
            recommendationId: saved.id,
            analysisId: savedAnalysis.id,
            category: rec.category,
            title: rec.title,
            confidenceScore: rec.confidenceScore,
            riskLevel: rec.riskLevel,
          },
        });
      }

      res.json({
        analysis: savedAnalysis,
        recommendations: savedRecs,
        competitorsAnalyzed: completeCompetitors.length,
        dataCompleteness,
        month: currentMonth,
      });
    } catch (error: any) {
      console.error("[CI] Analysis error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/ci/analyses", requireCampaign, async (req, res) => {
    try {
      const accountId = (req.query.accountId as string) || "default";
      const enabled = await featureFlagService.isEnabled("competitive_intelligence_enabled", accountId);
      if (!enabled) return res.json({ disabled: true, analyses: [] });

      const analyses = await db.select().from(ciMarketAnalyses)
        .where(and(eq(ciMarketAnalyses.accountId, accountId), eq(ciMarketAnalyses.isDemo, false)))
        .orderBy(desc(ciMarketAnalyses.createdAt));
      res.json({ analyses });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/ci/analyses/:id", requireCampaign, async (req, res) => {
    try {
      const { id } = req.params;
      const accountId = (req.query.accountId as string) || "default";
      const [analysis] = await db.select().from(ciMarketAnalyses)
        .where(and(eq(ciMarketAnalyses.id, id), eq(ciMarketAnalyses.accountId, accountId)));
      if (!analysis) return res.status(404).json({ error: "Analysis not found" });

      const recs = await db.select().from(ciRecommendations)
        .where(eq(ciRecommendations.analysisId, id))
        .orderBy(desc(ciRecommendations.confidenceScore));

      const decisions = await db.select().from(ciStrategyDecisions)
        .where(eq(ciStrategyDecisions.analysisId, id));

      res.json({ analysis, recommendations: recs, decisions });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/ci/recommendations", requireCampaign, async (req, res) => {
    try {
      const accountId = (req.query.accountId as string) || "default";
      const status = req.query.status as string;
      const enabled = await featureFlagService.isEnabled("competitive_intelligence_enabled", accountId);
      if (!enabled) return res.json({ disabled: true, recommendations: [] });

      let query = db.select().from(ciRecommendations)
        .where(and(eq(ciRecommendations.accountId, accountId), eq(ciRecommendations.isDemo, false)))
        .orderBy(desc(ciRecommendations.createdAt));

      const recs = await query;
      const filtered = status ? recs.filter(r => r.status === status) : recs;
      res.json({ recommendations: filtered });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/ci/recommendations/:id/apply", async (req, res) => {
    try {
      const { id } = req.params;
      const accountId = (req.body.accountId as string) || "default";
      const { reason } = req.body;
      const enabled = await featureFlagService.isEnabled("competitive_intelligence_enabled", accountId);
      if (!enabled) return res.status(403).json({ error: "Competitive intelligence is disabled" });

      const [rec] = await db.select().from(ciRecommendations)
        .where(and(eq(ciRecommendations.id, id), eq(ciRecommendations.accountId, accountId)));
      if (!rec) return res.status(404).json({ error: "Recommendation not found" });
      if (rec.status !== "pending") return res.status(400).json({ error: `Recommendation already ${rec.status}` });

      await db.update(ciRecommendations)
        .set({ status: "applied", updatedAt: new Date() })
        .where(eq(ciRecommendations.id, id));

      await db.insert(ciStrategyDecisions).values({
        accountId,
        recommendationId: id,
        analysisId: rec.analysisId,
        decision: "applied",
        reason: reason || "User approved",
        appliedChanges: rec.actionDetails,
      });

      await logAudit(accountId, "STRATEGY_APPLIED", {
        details: {
          recommendationId: id,
          analysisId: rec.analysisId,
          category: rec.category,
          title: rec.title,
          actionType: rec.actionType,
          actionTarget: rec.actionTarget,
          reason,
        },
      });

      res.json({ success: true, status: "applied" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/ci/recommendations/:id/reject", async (req, res) => {
    try {
      const { id } = req.params;
      const accountId = (req.body.accountId as string) || "default";
      const { reason } = req.body;
      const enabled = await featureFlagService.isEnabled("competitive_intelligence_enabled", accountId);
      if (!enabled) return res.status(403).json({ error: "Competitive intelligence is disabled" });

      const [rec] = await db.select().from(ciRecommendations)
        .where(and(eq(ciRecommendations.id, id), eq(ciRecommendations.accountId, accountId)));
      if (!rec) return res.status(404).json({ error: "Recommendation not found" });
      if (rec.status !== "pending") return res.status(400).json({ error: `Recommendation already ${rec.status}` });

      await db.update(ciRecommendations)
        .set({ status: "rejected", updatedAt: new Date() })
        .where(eq(ciRecommendations.id, id));

      await db.insert(ciStrategyDecisions).values({
        accountId,
        recommendationId: id,
        analysisId: rec.analysisId,
        decision: "rejected",
        reason: reason || "User rejected",
      });

      await logAudit(accountId, "STRATEGY_REJECTED", {
        details: {
          recommendationId: id,
          analysisId: rec.analysisId,
          category: rec.category,
          title: rec.title,
          reason,
        },
      });

      res.json({ success: true, status: "rejected" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/ci/strategy-timeline", requireCampaign, async (req, res) => {
    try {
      const accountId = (req.query.accountId as string) || "default";
      const enabled = await featureFlagService.isEnabled("competitive_intelligence_enabled", accountId);
      if (!enabled) return res.json({ disabled: true, timeline: [] });

      const decisions = await db.select().from(ciStrategyDecisions)
        .where(eq(ciStrategyDecisions.accountId, accountId))
        .orderBy(desc(ciStrategyDecisions.createdAt));

      const analyses = await db.select().from(ciMarketAnalyses)
        .where(eq(ciMarketAnalyses.accountId, accountId))
        .orderBy(desc(ciMarketAnalyses.createdAt));

      const timeline = analyses.map(a => ({
        month: a.analysisMonth,
        analysisId: a.id,
        status: a.status,
        dataCompleteness: a.dataCompleteness,
        decisions: decisions.filter(d => d.analysisId === a.id),
        monthDiff: a.monthDiff ? JSON.parse(a.monthDiff) : null,
        createdAt: a.createdAt,
      }));

      res.json({ timeline });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/ci/month-diff/:month", requireCampaign, async (req, res) => {
    try {
      const { month } = req.params;
      const accountId = (req.query.accountId as string) || "default";

      const [current] = await db.select().from(ciMarketAnalyses)
        .where(and(eq(ciMarketAnalyses.accountId, accountId), eq(ciMarketAnalyses.analysisMonth, month)));

      const prevMonth = getPreviousMonth(month);
      const [previous] = await db.select().from(ciMarketAnalyses)
        .where(and(eq(ciMarketAnalyses.accountId, accountId), eq(ciMarketAnalyses.analysisMonth, prevMonth)));

      if (!current) return res.status(404).json({ error: "No analysis found for this month" });

      const currentSnapshots = await db.select().from(ciSnapshots)
        .where(and(eq(ciSnapshots.accountId, accountId), eq(ciSnapshots.snapshotMonth, month)));
      const previousSnapshots = previous ? await db.select().from(ciSnapshots)
        .where(and(eq(ciSnapshots.accountId, accountId), eq(ciSnapshots.snapshotMonth, prevMonth))) : [];

      const diff = {
        currentMonth: month,
        previousMonth: prevMonth,
        hasPreviousData: !!previous,
        marketShifts: current.monthDiff ? JSON.parse(current.monthDiff) : null,
        competitorShifts: buildCompetitorDiff(currentSnapshots, previousSnapshots),
        clientPerformanceShift: current.clientPerformanceShift,
        currentAnalysis: {
          strategicGaps: current.strategicGaps ? JSON.parse(current.strategicGaps) : [],
          dataCompleteness: current.dataCompleteness,
        },
        previousAnalysis: previous ? {
          strategicGaps: previous.strategicGaps ? JSON.parse(previous.strategicGaps) : [],
          dataCompleteness: previous.dataCompleteness,
        } : null,
      };

      res.json(diff);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}

function getPreviousMonth(month: string): string {
  const [year, m] = month.split("-").map(Number);
  if (m === 1) return `${year - 1}-12`;
  return `${year}-${String(m - 1).padStart(2, "0")}`;
}

function buildCompetitorDiff(current: any[], previous: any[]): any[] {
  if (previous.length === 0) return [];
  return current.map(curr => {
    const prev = previous.find(p => p.competitorId === curr.competitorId);
    if (!prev) return { competitorId: curr.competitorId, isNew: true };
    return {
      competitorId: curr.competitorId,
      changes: {
        postingFrequency: { from: prev.postingFrequency, to: curr.postingFrequency, delta: (curr.postingFrequency || 0) - (prev.postingFrequency || 0) },
        engagementRatio: { from: prev.engagementRatio, to: curr.engagementRatio, delta: ((curr.engagementRatio || 0) - (prev.engagementRatio || 0)).toFixed(2) },
        contentTypeRatio: { from: prev.contentTypeRatio, to: curr.contentTypeRatio },
        ctaPatterns: { from: prev.ctaPatterns, to: curr.ctaPatterns },
      },
    };
  });
}

function getSystemPrompt(): string {
  return `You are an AI Chief Strategy Officer (CSO) specializing in competitive intelligence for marketing.

CRITICAL RULES:
1. EVIDENCE-ONLY: Every conclusion must reference specific data points from the provided competitor evidence. If data is missing, say "INSUFFICIENT DATA for [area]" instead of guessing.
2. ACTIONABLE: Every recommendation must map to a concrete in-app action (content_clusters, calendar_cadence, cta_library, funnel_mapping, offer_positioning).
3. CITATIONS: Each recommendation must include evidenceCitations - an array of objects with {competitorName, field, value, insight} showing exactly which data drove the conclusion.
4. CONFIDENCE: Assign confidence scores (0-1) based on data quality. Low data = low confidence. Never inflate.
5. RISK: Assess risk as "low", "medium", or "high" based on market volatility and change magnitude.

You must respond with valid JSON.`;
}

function buildAnalysisPrompt(competitors: any[], prevData: any[] | null, prevAnalysis: any | null): string {
  const dataWithoutMeta = competitors.map(c => {
    const { _metadata, ...fields } = c;
    return fields;
  });

  const missingDataWarnings = competitors
    .filter(c => c._metadata.missingFields.length > 0)
    .map(c => `- Competitor "${c.name}" is missing: ${c._metadata.missingFields.join(", ")}. Do NOT assume or fabricate data for these fields. Mark any analysis involving these fields as "INSUFFICIENT DATA" for this competitor.`)
    .join("\n");

  let prompt = `Analyze the following competitive intelligence data and generate strategic recommendations.

TOTAL COMPETITORS PROVIDED: ${competitors.length}
YOU MUST analyze and reference ALL ${competitors.length} competitors listed below. Do not skip any competitor.

COMPETITOR DATA:
${JSON.stringify(dataWithoutMeta, null, 2)}

`;

  if (missingDataWarnings) {
    prompt += `MISSING DATA WARNINGS (CRITICAL — do not ignore):
${missingDataWarnings}

`;
  }

  if (prevData) {
    prompt += `PREVIOUS MONTH DATA:
${JSON.stringify(prevData, null, 2)}

`;
  }

  if (prevAnalysis) {
    prompt += `PREVIOUS ANALYSIS:
Strategic Gaps: ${prevAnalysis.strategicGaps || "none"}
Market Overview: ${prevAnalysis.marketOverview || "none"}

`;
  }

  prompt += `Generate a JSON response with this exact structure:
{
  "marketOverview": {
    "summary": "Brief market overview based on evidence",
    "competitiveIntensity": "low|medium|high",
    "dominantTrends": ["trend1", "trend2"],
    "marketShifts": ["shift1"] 
  },
  "competitorBreakdown": [
    {
      "name": "competitor name",
      "strengths": ["based on evidence"],
      "weaknesses": ["based on evidence"],
      "threatLevel": "low|medium|high",
      "keyInsight": "one line evidence-backed insight"
    }
  ],
  "strategicGaps": [
    {
      "area": "gap area",
      "description": "what the gap is based on evidence",
      "opportunity": "how to exploit it",
      "evidenceSource": "which competitor data revealed this"
    }
  ],
  "saturationPatterns": "analysis of market saturation based on posting/content data",
  "differentiationGaps": "where client can differentiate based on competitor weakness",
  "offerPositioningGaps": "pricing/offer gaps based on competitor discount and CTA patterns",
  "pricingNarrativePatterns": "how competitors frame pricing/value based on messaging tone",
  "funnelWeaknesses": "funnel gaps detected from CTA patterns and engagement data",
  "ctaTrends": "CTA trend analysis from competitor CTA patterns",
  "authorityGaps": "authority/social proof gaps from social proof presence data",
  "monthDiff": ${prevData ? '{"marketShifts": ["what changed"], "competitorShifts": ["who changed what"], "significanceLevel": "low|medium|high"}' : 'null'},
  "clientPerformanceShift": "comparison of client position vs last month if previous data exists",
  "evidenceSummary": {
    "dataPointsUsed": 0,
    "competitorsAnalyzed": 0,
    "dataQuality": "high|medium|low",
    "gaps": ["areas with insufficient data"]
  },
  "recommendations": [
    {
      "category": "content_strategy|cta_optimization|funnel_strategy|offer_positioning|authority_building|calendar_cadence",
      "title": "Clear action title",
      "description": "Detailed description with reasoning",
      "actionType": "content_clusters|calendar_cadence|cta_library|funnel_mapping|offer_positioning",
      "actionTarget": "Where in the app this applies (e.g., Content Calendar, CTA Library, Funnel Builder)",
      "actionDetails": {
        "currentState": "what exists now based on evidence",
        "proposedChange": "specific change to make",
        "implementation": "step by step how to implement"
      },
      "evidenceCitations": [
        {
          "competitorName": "name",
          "field": "data field used",
          "value": "the actual value",
          "insight": "what this data point tells us"
        }
      ],
      "whyChanged": "Why this recommendation differs from previous (if applicable)",
      "confidenceScore": 0.0,
      "riskLevel": "low|medium|high",
      "impactRangeLow": 0,
      "impactRangeHigh": 0,
      "timeframe": "30_days|60_days|90_days"
    }
  ]
}

Generate 3-6 recommendations covering different action types. Each must have evidence citations.`;

  return prompt;
}
