/**
 * Dual-Analysis Routes (Task #10)
 *
 * ARCHITECTURE INVARIANT:
 * This route READS data (MI snapshots + user channel snapshots) and produces
 * an AI-powered classification + recommendation.
 * It does NOT trigger any engine, orchestrator, or worker directly.
 * Engine execution only occurs when the user explicitly presses "Run Now" in the UI
 * and the frontend calls POST /api/orchestrator/run.
 */

import type { Express, Request, Response } from "express";
import { db } from "../db";
import { miSnapshots, userChannelSnapshots } from "@shared/schema";
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

// ── Classification rules (deterministic guard) ────────────────────────────────

function applyClassificationGuard(
  parsed: { classification: string; recommendedEngines: string[]; summary: string; confidence: number },
  hasCompetitorData: boolean,
  hasUserData: boolean,
  userSnapsHaveDeltas: boolean,
  competitorHasSignals: boolean,
): DualAnalysisClassification {
  const raw = parsed.classification as DualAnalysisClassification;

  // Validate the AI's classification against what data is actually present
  const validClassifications: DualAnalysisClassification[] = [
    "market_shift_only", "execution_gap_only", "both_changed", "no_change", "no_data",
  ];
  if (!validClassifications.includes(raw)) {
    // Fallback: derive deterministically from data presence
    if (hasCompetitorData && hasUserData) return "both_changed";
    if (hasCompetitorData) return "market_shift_only";
    if (hasUserData) return "execution_gap_only";
    return "no_data";
  }

  // Guard: cannot return "no_data" when we have data
  if (raw === "no_data" && (hasCompetitorData || hasUserData)) {
    if (hasCompetitorData && hasUserData) return "both_changed";
    return hasCompetitorData ? "market_shift_only" : "execution_gap_only";
  }

  // Guard: cannot return "market_shift_only" when there's no competitor data
  if (raw === "market_shift_only" && !hasCompetitorData) return "execution_gap_only";

  // Guard: cannot return "execution_gap_only" when there's no user data
  if (raw === "execution_gap_only" && !hasUserData) return "market_shift_only";

  return raw;
}

// ── Build data context strings ────────────────────────────────────────────────

function buildCompetitorContext(mi: any): string {
  const parts: string[] = ["COMPETITOR MARKET INTELLIGENCE:"];
  if (mi.narrativeSynthesis) parts.push(`• Narrative: ${mi.narrativeSynthesis}`);
  if (mi.marketDiagnosis) parts.push(`• Market Diagnosis: ${mi.marketDiagnosis}`);
  if (mi.threatSignals) parts.push(`• Threat Signals: ${mi.threatSignals}`);
  if (mi.opportunitySignals) parts.push(`• Opportunity Signals: ${mi.opportunitySignals}`);
  return parts.join("\n");
}

function buildUserContext(snaps: any[]): string {
  return snaps.map(snap => {
    const delta = snap.deltaFromPrevious ? JSON.parse(snap.deltaFromPrevious) : null;
    const data = snap.snapshotData ? JSON.parse(snap.snapshotData) : null;
    if (!data) return `Platform: ${snap.platform} — data unavailable`;

    const lines = [`USER CHANNEL — ${snap.platform.toUpperCase()} (${data.scrapeMode} scrape):`];
    if (data.handle) lines.push(`• Handle: @${data.handle}`);
    if (data.url) lines.push(`• URL: ${data.url}`);
    lines.push(`• Posts in window: ${data.postCount}`);
    if (data.followers != null) lines.push(`• Followers: ${data.followers.toLocaleString()}`);
    if (data.avgEngagement != null) lines.push(`• Avg engagement per post: ${data.avgEngagement}`);
    lines.push(`• Content types: ${JSON.stringify(data.recentPostTypes)}`);
    lines.push(`• Scrape status: ${data.scrapeStatus}`);

    if (delta) {
      lines.push(`• Is first scrape: ${delta.isFirstScrape}`);
      lines.push(`• New posts since last snapshot: ${delta.newPostsSinceLastSnapshot}`);
      if (delta.avgEngagementDelta != null) lines.push(`• Engagement delta: ${delta.avgEngagementDelta > 0 ? "+" : ""}${delta.avgEngagementDelta}`);
      if (delta.followersDelta != null) lines.push(`• Followers delta: ${delta.followersDelta > 0 ? "+" : ""}${delta.followersDelta}`);
      if (delta.websiteChangeSummary) lines.push(`• Website changes: ${delta.websiteChangeSummary}`);
      lines.push(`• Delta window: ${delta.deltaWindowDays} days`);
    }
    return lines.join("\n");
  }).join("\n\n");
}

// ── Main analysis function ────────────────────────────────────────────────────

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
    .limit(4);

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

  const mi = latestMi[0] ?? null;
  const competitorContext = hasCompetitorData
    ? buildCompetitorContext(mi)
    : "COMPETITOR DATA: Not yet available.";

  const userContext = hasUserData
    ? buildUserContext(latestUserSnaps)
    : "USER CHANNEL DATA: No channels scraped yet.";

  // Check if user snapshots have meaningful delta data
  const userSnapsHaveDeltas = latestUserSnaps.some(s => {
    const delta = s.deltaFromPrevious ? JSON.parse(s.deltaFromPrevious) : null;
    return delta && !delta.isFirstScrape;
  });

  const competitorHasSignals = !!(mi?.threatSignals || mi?.opportunitySignals);

  const prompt = `You are a dual-signal marketing strategy analyst. Your job is to compare competitor market intelligence with the user's own channel performance and produce a precise, data-grounded classification.

AVAILABLE DATA:
${competitorContext}

${userContext}

CLASSIFICATION RULES (apply deterministically):
- both_changed: Competitor signals AND user metrics both show meaningful movement
- market_shift_only: Competitor signals show movement, user metrics are stable
- execution_gap_only: User metrics show gaps/drops, competitor landscape is stable
- no_change: Neither side shows meaningful change (use this only if data is present but flat)

ENGINE SELECTION RULES:
- channel_selection: Use when user's content mix is imbalanced OR competitor platform strategy shifted
- iteration: Use when engagement delta is negative OR post frequency dropped significantly
- retention: Use when follower count is declining OR competitor is capturing retention-focused content
- content_dna: Use when content type mix has changed dramatically OR competitor shifted creative format
- objection_map: Use when competitor threat signals include pricing/value attacks

MANDATORY REQUIREMENTS for the summary field:
1. MUST reference at least one specific metric from the user's channel (e.g., "your engagement dropped from X to Y", "you posted N new pieces this week")
2. MUST reference at least one specific signal from the competitor data (e.g., "competitor threat signals show X")
3. MUST explain WHY each recommended engine is needed (not just name it)
4. 2-3 sentences only — no generic statements like "the market is shifting" without citing the specific data that shows this

Respond ONLY as valid JSON with no markdown:
{
  "classification": "<one of: both_changed | market_shift_only | execution_gap_only | no_change>",
  "recommendedEngines": ["<engine1>", "<engine2>"],
  "summary": "<2-3 sentences, citing actual data points from above>",
  "confidence": <integer 0-100 based on data completeness>
}`;

  try {
    const response = await aiChat([{ role: "user", content: prompt }], {
      temperature: 0.1,
      max_tokens: 600,
    });

    const raw = response.content.trim().replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(raw);

    const classification = applyClassificationGuard(
      parsed, hasCompetitorData, hasUserData, userSnapsHaveDeltas, competitorHasSignals
    );

    const recommendedEngines = Array.isArray(parsed.recommendedEngines)
      ? parsed.recommendedEngines.filter((e: string) =>
          ["channel_selection", "iteration", "retention", "content_dna", "objection_map"].includes(e)
        )
      : [];

    console.log(`[DualAnalysis] account=${accountId} campaign=${campaignId} classification=${classification} engines=${recommendedEngines.join(",")} confidence=${parsed.confidence}`);

    return {
      classification,
      recommendedEngines,
      summary: parsed.summary || "Analysis complete.",
      confidence: typeof parsed.confidence === "number" ? Math.min(100, Math.max(0, parsed.confidence)) : 50,
      competitorSignals: hasCompetitorData ? (mi.threatSignals || mi.narrativeSynthesis || null) : null,
      userSignals: hasUserData ? latestUserSnaps.map(s => `${s.platform}:${s.handle || s.platform}`).join(", ") : null,
      generatedAt: new Date().toISOString(),
    };
  } catch (err: any) {
    console.error("[DualAnalysis] AI call failed:", err.message);

    // Deterministic fallback — never returns ambiguous classification
    const classification: DualAnalysisClassification =
      hasCompetitorData && hasUserData ? "both_changed" :
      hasCompetitorData ? "market_shift_only" :
      hasUserData ? "execution_gap_only" : "no_change";

    return {
      classification,
      recommendedEngines: ["channel_selection"],
      summary: "Dual analysis encountered an issue. Review your channel data and competitor intelligence manually.",
      confidence: 10,
      competitorSignals: hasCompetitorData ? (mi?.threatSignals || null) : null,
      userSignals: hasUserData ? `${latestUserSnaps.length} channel(s) tracked` : null,
      generatedAt: new Date().toISOString(),
    };
  }
}

// ── Route registration ────────────────────────────────────────────────────────

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
