import type { Express, Request, Response } from "express";
import { db } from "../db";
import { miSnapshots, userChannelSnapshots, userPublicProfiles } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { resolveAccountId } from "../auth";
import { aiChat } from "../ai-client";

export type DualAnalysisClassification =
  | "market_shift_only"
  | "execution_gap_only"
  | "both_changed"
  | "no_change"
  | "no_data";

export interface DualAnalysisResult {
  classification: DualAnalysisClassification;
  recommendedEngines: string[];
  summary: string;
  confidence: number;
  competitorSignals: string | null;
  userSignals: string | null;
  generatedAt: string;
}

async function runDualAnalysis(
  accountId: string,
  campaignId: string,
): Promise<DualAnalysisResult> {
  const latestMi = await db
    .select()
    .from(miSnapshots)
    .where(
      and(
        eq(miSnapshots.accountId, accountId),
        eq(miSnapshots.campaignId, campaignId),
      )
    )
    .orderBy(desc(miSnapshots.createdAt))
    .limit(1);

  const latestUserSnaps = await db
    .select()
    .from(userChannelSnapshots)
    .where(
      and(
        eq(userChannelSnapshots.accountId, accountId),
        eq(userChannelSnapshots.campaignId, campaignId),
      )
    )
    .orderBy(desc(userChannelSnapshots.scrapedAt))
    .limit(3);

  const hasCompetitorData = latestMi.length > 0;
  const hasUserData = latestUserSnaps.length > 0;

  if (!hasCompetitorData && !hasUserData) {
    return {
      classification: "no_data",
      recommendedEngines: [],
      summary: "No competitor or user channel data available yet. Add your channels and run the agent to generate insights.",
      confidence: 0,
      competitorSignals: null,
      userSignals: null,
      generatedAt: new Date().toISOString(),
    };
  }

  const mi = latestMi[0];

  const competitorContext = hasCompetitorData
    ? `
COMPETITOR MARKET INTELLIGENCE (latest snapshot):
- Narrative Synthesis: ${mi.narrativeSynthesis || "N/A"}
- Market Diagnosis: ${mi.marketDiagnosis || "N/A"}
- Threat Signals: ${mi.threatSignals || "N/A"}
- Opportunity Signals: ${mi.opportunitySignals || "N/A"}
`
    : "COMPETITOR DATA: Not yet available.";

  const userContext = hasUserData
    ? latestUserSnaps.map(snap => {
        const delta = snap.deltaFromPrevious ? JSON.parse(snap.deltaFromPrevious) : null;
        const data = snap.snapshotData ? JSON.parse(snap.snapshotData) : null;
        return `
Platform: ${snap.platform} | Handle: ${snap.handle || snap.platform}
- Posts/Pages Tracked: ${data?.postCount || 0}
- Followers: ${data?.followers ?? "N/A"}
- Avg Engagement: ${data?.avgEngagement?.toFixed(1) ?? "N/A"}
- Scrape Status: ${data?.scrapeStatus || "UNKNOWN"}
- New Posts Since Last Week: ${delta?.newPostsSinceLastSnapshot ?? "N/A"}
- Engagement Delta: ${delta?.avgEngagementDelta?.toFixed(1) ?? "N/A"}
- Followers Delta: ${delta?.followersDelta ?? "N/A"}
- Website Change: ${delta?.websiteChangeSummary ?? "N/A"}
- Content Mix: ${delta?.contentTypeMix ? JSON.stringify(delta.contentTypeMix) : "N/A"}`;
      }).join("\n\n")
    : "USER CHANNEL DATA: No channels configured.";

  const prompt = `You are a dual-signal marketing strategy analyst. Analyze competitor market intelligence alongside the user's own channel performance to classify the current state and recommend strategic actions.

${competitorContext}

USER'S OWN CHANNELS (latest week):
${userContext}

Instructions:
1. Classify the situation as ONE of: market_shift_only, execution_gap_only, both_changed, no_change
   - market_shift_only: competitors/market changed, but user's performance is stable
   - execution_gap_only: market is stable, but user's own metrics show gaps (low engagement, stale content, etc.)
   - both_changed: both competitor landscape AND user metrics show significant changes
   - no_change: nothing meaningful has changed — maintain current strategy

2. Recommend 1-3 engines from this list: channel_selection, iteration, retention, content_dna, objection_map
3. Write a 2-3 sentence plain-English summary for a non-technical marketer explaining what to do and why.
4. Rate your confidence 0-100 based on data quality.

Respond ONLY as valid JSON:
{
  "classification": "...",
  "recommendedEngines": ["..."],
  "summary": "...",
  "confidence": 80
}`;

  try {
    const response = await aiChat([{ role: "user", content: prompt }], {
      temperature: 0.2,
      max_tokens: 512,
    });

    const raw = response.content.trim().replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(raw);

    return {
      classification: parsed.classification || "no_change",
      recommendedEngines: Array.isArray(parsed.recommendedEngines) ? parsed.recommendedEngines : [],
      summary: parsed.summary || "Analysis complete.",
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 50,
      competitorSignals: hasCompetitorData ? (mi.threatSignals || mi.narrativeSynthesis || null) : null,
      userSignals: hasUserData ? userContext.slice(0, 500) : null,
      generatedAt: new Date().toISOString(),
    };
  } catch (err: any) {
    console.error("[DualAnalysis] AI call failed:", err.message);
    const classification: DualAnalysisClassification =
      hasCompetitorData && hasUserData ? "both_changed" :
      hasCompetitorData ? "market_shift_only" :
      hasUserData ? "execution_gap_only" : "no_change";

    return {
      classification,
      recommendedEngines: ["channel_selection"],
      summary: "Dual analysis encountered an issue. Review your channel data and competitor intelligence manually.",
      confidence: 20,
      competitorSignals: hasCompetitorData ? (mi.threatSignals || null) : null,
      userSignals: hasUserData ? `${latestUserSnaps.length} channel(s) tracked` : null,
      generatedAt: new Date().toISOString(),
    };
  }
}

export function registerDualAnalysisRoutes(app: Express) {
  app.get("/api/agent/dual-analysis/:campaignId", async (req: Request, res: Response) => {
    try {
      const { campaignId } = req.params;
      const accountId = resolveAccountId(req);

      const result = await runDualAnalysis(accountId, campaignId);
      res.json({ success: true, analysis: result });
    } catch (error: any) {
      console.error("[DualAnalysisRoutes] GET error:", error.message);
      res.status(500).json({ code: "DUAL_ANALYSIS_FAILED", message: "Failed to run dual analysis" });
    }
  });

  app.post("/api/agent/dual-analysis/:campaignId/refresh", async (req: Request, res: Response) => {
    try {
      const { campaignId } = req.params;
      const accountId = resolveAccountId(req);

      const result = await runDualAnalysis(accountId, campaignId);
      res.json({ success: true, analysis: result });
    } catch (error: any) {
      console.error("[DualAnalysisRoutes] POST refresh error:", error.message);
      res.status(500).json({ code: "DUAL_ANALYSIS_FAILED", message: "Failed to refresh dual analysis" });
    }
  });

  console.log("[DualAnalysisRoutes] Routes registered: GET /api/agent/dual-analysis/:campaignId, POST /api/agent/dual-analysis/:campaignId/refresh");
}
