/**
 * GET /api/performance/console — single aggregate read model for the
 * Performance page.
 *
 * Doctrine:
 *  - Every section reports a truthful state from SECTION_STATE_LABELS keys
 *    (ready / not_configured / awaiting_scrape / awaiting_user_truth / ...).
 *    Nothing is fabricated for empty layers.
 *  - Tenant scoping: every query filters accountId + campaignId (via
 *    requireCampaign context).
 *  - Read-only: the live execution tracker runs the deterministic comparator
 *    with persist:false — history is only frozen by the cycle runner.
 */
import type { Express, Request, Response } from "express";
import { db } from "../db";
import {
  userPublicProfiles,
  userChannelSnapshots,
  ownedPosts,
  ownedPostSnapshots,
  ownedPostClassifications,
  ownedContentScores,
  weeklyBusinessScores,
  pipelineEvalWindows,
  pipelineUserTruth,
  performanceCycleReports,
  performanceDecisionVerdicts,
  performanceDecisionOutcomes,
  strategicPlans,
  strategyMemory,
} from "@shared/schema";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { requireCampaign } from "../campaign-routes";
import { runExecutionComparison } from "./execution-comparator";
import { OWNED_CLASSIFIER_VERSION } from "./owned-post-classifier";

const LOG = "[PerformanceConsole]";

/** Mirrors user-channel-scraper's private MIN_SCRAPE_INTERVAL_MS (24h). */
const SCRAPE_INTERVAL_MS = 24 * 60 * 60 * 1000;

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

export function registerPerformanceConsoleRoute(app: Express): void {
  app.get("/api/performance/console", requireCampaign, async (req: Request, res: Response) => {
    try {
      const { accountId, campaignId } = (req as any).campaignContext;
      const now = Date.now();

      // ── Parallel base reads (all tenant-scoped) ─────────────────────
      const [profiles, latestSnapRows, posts, plans, windows, memoryRows] = await Promise.all([
        db.select().from(userPublicProfiles)
          .where(and(eq(userPublicProfiles.accountId, accountId), eq(userPublicProfiles.campaignId, campaignId))),
        db.select().from(userChannelSnapshots)
          .where(and(eq(userChannelSnapshots.accountId, accountId), eq(userChannelSnapshots.campaignId, campaignId)))
          .orderBy(desc(userChannelSnapshots.scrapedAt)).limit(1),
        db.select().from(ownedPosts)
          .where(and(eq(ownedPosts.accountId, accountId), eq(ownedPosts.campaignId, campaignId)))
          .orderBy(desc(ownedPosts.postedAt)).limit(200),
        db.select().from(strategicPlans)
          .where(and(
            eq(strategicPlans.accountId, accountId),
            eq(strategicPlans.campaignId, campaignId),
            eq(strategicPlans.status, "APPROVED"),
          ))
          .orderBy(desc(strategicPlans.createdAt)).limit(1),
        db.select().from(pipelineEvalWindows)
          .where(and(eq(pipelineEvalWindows.accountId, accountId), eq(pipelineEvalWindows.campaignId, campaignId)))
          .orderBy(desc(pipelineEvalWindows.windowIndex)).limit(12),
        db.select().from(strategyMemory)
          .where(and(
            eq(strategyMemory.accountId, accountId),
            eq(strategyMemory.campaignId, campaignId),
            eq(strategyMemory.engineName, "performance_cycle_runner"),
          ))
          .orderBy(desc(strategyMemory.updatedAt)).limit(20),
      ]);

      const socialProfiles = profiles.filter((p) => p.platform !== "website");
      const channelConnected = socialProfiles.length > 0;
      const latestSnap = latestSnapRows[0] ?? null;
      const snapStatus = latestSnap
        ? (parseJson<Record<string, unknown>>(latestSnap.snapshotData, {}) as any).scrapeStatus ?? "UNKNOWN"
        : null;
      const lastScrapeAt = latestSnap?.scrapedAt?.toISOString() ?? null;
      const nextScrapeDueAt = latestSnap?.scrapedAt
        ? new Date(latestSnap.scrapedAt.getTime() + SCRAPE_INTERVAL_MS).toISOString()
        : channelConnected ? new Date(now).toISOString() : null;

      // ── Setup & scrape health ───────────────────────────────────────
      const setup = {
        state: !channelConnected ? "not_configured" : !latestSnap ? "awaiting_scrape" : "ready",
        channels: socialProfiles.map((p) => ({
          platform: p.platform,
          handle: p.handle,
          url: p.url,
          addedAt: p.addedAt?.toISOString() ?? null,
        })),
        lastScrapeAt,
        lastScrapeStatus: snapStatus,
        nextScrapeDueAt,
        approvedPlanId: plans[0]?.id ?? null,
      };

      // ── Posts, lineage, classification ──────────────────────────────
      const postIds = posts.map((p) => p.id);
      const classifications = postIds.length
        ? await db.select().from(ownedPostClassifications)
            .where(and(
              eq(ownedPostClassifications.accountId, accountId),
              eq(ownedPostClassifications.campaignId, campaignId),
              eq(ownedPostClassifications.classifierVersion, OWNED_CLASSIFIER_VERSION),
              inArray(ownedPostClassifications.ownedPostId, postIds),
            ))
        : [];
      const snapshotCounts = postIds.length
        ? await db.select({ ownedPostId: ownedPostSnapshots.ownedPostId, n: sql<number>`count(*)::int` })
            .from(ownedPostSnapshots)
            .where(and(
              eq(ownedPostSnapshots.accountId, accountId),
              eq(ownedPostSnapshots.campaignId, campaignId),
              inArray(ownedPostSnapshots.ownedPostId, postIds),
            ))
            .groupBy(ownedPostSnapshots.ownedPostId)
        : [];
      const snapCountByPost = new Map(snapshotCounts.map((r) => [r.ownedPostId, r.n]));
      const classByPost = new Map(classifications.map((c) => [c.ownedPostId, c]));

      const lineageCounts: Record<string, number> = {};
      for (const p of posts) lineageCounts[p.lineageState ?? "unmatched"] = (lineageCounts[p.lineageState ?? "unmatched"] ?? 0) + 1;

      const postsSection = {
        state: !channelConnected ? "not_configured"
          : !latestSnap ? "awaiting_scrape"
          : posts.length === 0 ? "insufficient_evidence"
          : "ready",
        total: posts.length,
        lineageCounts,
        classification: {
          classified: classifications.filter((c) => c.status === "classified").length,
          failed: classifications.filter((c) => c.status === "failed").length,
          pending: Math.max(0, posts.length - classifications.length),
        },
        recent: posts.slice(0, 12).map((p) => {
          const c = classByPost.get(p.id);
          return {
            id: p.id,
            platform: p.platform,
            permalink: p.permalink,
            caption: p.caption ? p.caption.slice(0, 140) : null,
            postedAt: p.postedAt?.toISOString() ?? null,
            lineageState: p.lineageState,
            matchConfidence: p.matchConfidence,
            hookStyle: p.hookStyle,
            contentAngle: p.contentAngle,
            contentType: p.contentType,
            snapshotCount: snapCountByPost.get(p.id) ?? 0,
            classification: c && c.status === "classified" ? {
              hookArchetype: c.hookArchetype,
              narrative: c.narrative,
              contentFormatIntent: c.contentFormatIntent,
              primaryGoal: c.primaryGoal,
              confidence: c.confidenceScore,
            } : null,
            classificationStatus: c?.status ?? "pending",
          };
        }),
      };

      // ── Live execution tracker (deterministic, never persisted here) ─
      let execution: any = { state: "unavailable", reason: "no approved plan", comparison: null };
      try {
        const cmp = await runExecutionComparison({ accountId, campaignId, persist: false });
        execution = {
          state: cmp.status === "OK"
            ? (cmp.rows.every((r) => r.executionStatus === "BLOCKED") ? "not_configured"
              : cmp.rows.every((r) => r.executionStatus === "UNVERIFIED") ? "awaiting_scrape"
              : "ready")
            : cmp.status === "NO_APPROVED_PLAN" ? "unavailable" : "insufficient_evidence",
          reason: cmp.reason,
          comparison: cmp.status === "OK" ? {
            windowStart: cmp.windowStart,
            windowEnd: cmp.windowEnd,
            lastSuccessfulScrapeAt: cmp.lastSuccessfulScrapeAt,
            rows: cmp.rows.map((r) => ({
              dimension: r.decision.dimension,
              value: r.decision.value,
              executionStatus: r.executionStatus,
              reason: r.deterministicReason,
              matchedPostCount: r.matchedPostCount,
              windowPostCount: r.windowPostCount,
              evidencePostIds: r.evidencePostIds,
            })),
          } : null,
        };
      } catch (err: any) {
        execution = { state: "failed", reason: err?.message ?? String(err), comparison: null };
      }

      // ── Content scores (latest score run per platform) ──────────────
      const scoreRows = await db.select().from(ownedContentScores)
        .where(and(eq(ownedContentScores.accountId, accountId), eq(ownedContentScores.campaignId, campaignId)))
        .orderBy(desc(ownedContentScores.scoredAt)).limit(60);
      const latestRunId = scoreRows[0]?.scoreRunId ?? null;
      const latestScores = scoreRows.filter((r) => r.scoreRunId === latestRunId);
      const contentSection = {
        state: latestScores.length > 0 ? "ready"
          : posts.length === 0 ? (channelConnected ? "awaiting_scrape" : "not_configured")
          : (posts.some((p) => ["planned_direct", "planned_matched", "manual_matched"].includes(p.lineageState ?? ""))
              ? "awaiting_checkpoint_maturity" : "awaiting_lineage"),
        scoredAt: latestScores[0]?.scoredAt?.toISOString() ?? null,
        scores: latestScores.map((r) => ({
          dimension: r.dimension,
          dimensionValue: r.dimensionValue,
          verdict: r.verdict,
          primaryMetric: r.primaryMetric,
          measuredValue: r.measuredValue,
          baselineValue: r.baselineValue,
          relativeDelta: r.relativeDelta,
          sampleSize: r.sampleSize,
          maturity: r.maturity,
          confidence: r.confidence,
          confounders: parseJson<string[]>(r.confounders, []),
        })),
      };

      // ── Business truth & weekly score ───────────────────────────────
      const openWindow = windows.find((w) => w.state === "open") ?? null;
      const truthRows = windows.length
        ? await db.select().from(pipelineUserTruth)
            .where(and(
              eq(pipelineUserTruth.accountId, accountId),
              eq(pipelineUserTruth.campaignId, campaignId),
              inArray(pipelineUserTruth.windowId, windows.map((w) => w.id)),
              isNull(pipelineUserTruth.supersededAt),
            ))
        : [];
      const truthByWindow = new Map(truthRows.map((t) => [t.windowId, t]));
      const bizRows = await db.select().from(weeklyBusinessScores)
        .where(and(eq(weeklyBusinessScores.accountId, accountId), eq(weeklyBusinessScores.campaignId, campaignId)))
        .orderBy(desc(weeklyBusinessScores.scoredAt)).limit(1);
      const businessSection = {
        state: windows.length === 0 ? "unavailable"
          : openWindow && !truthByWindow.get(openWindow.id) && openWindow.windowEnd.getTime() <= now ? "awaiting_user_truth"
          : bizRows[0] ? "ready"
          : truthRows.length > 0 ? "insufficient_evidence"
          : "awaiting_user_truth",
        openWindow: openWindow ? {
          windowIndex: openWindow.windowIndex,
          windowStart: openWindow.windowStart.toISOString(),
          windowEnd: openWindow.windowEnd.toISOString(),
          truthSubmitted: !!truthByWindow.get(openWindow.id),
          windowEnded: openWindow.windowEnd.getTime() <= now,
        } : null,
        windows: windows.map((w) => ({
          windowIndex: w.windowIndex,
          state: w.state,
          windowStart: w.windowStart.toISOString(),
          windowEnd: w.windowEnd.toISOString(),
          truthSubmitted: !!truthByWindow.get(w.id),
        })),
        weeklyScore: bizRows[0] ? {
          windowIndex: bizRows[0].windowIndex,
          businessVerdict: bizRows[0].businessVerdict,
          verdictReason: bizRows[0].verdictReason,
          attributionConfidence: bizRows[0].attributionConfidence,
          leads: bizRows[0].leads,
          qualified: bizRows[0].qualified,
          booked: bizRows[0].booked,
          payingCustomers: bizRows[0].payingCustomers,
          scoredAt: bizRows[0].scoredAt?.toISOString() ?? null,
        } : null,
      };

      // ── Latest cycle report + verdicts + outcomes + trust rail ──────
      const reportRows = await db.select().from(performanceCycleReports)
        .where(and(eq(performanceCycleReports.accountId, accountId), eq(performanceCycleReports.campaignId, campaignId)))
        .orderBy(desc(performanceCycleReports.createdAt)).limit(6);
      const report = reportRows[0] ?? null;
      const [verdicts, outcomes] = report
        ? await Promise.all([
            db.select().from(performanceDecisionVerdicts)
              .where(and(
                eq(performanceDecisionVerdicts.accountId, accountId),
                eq(performanceDecisionVerdicts.campaignId, campaignId),
                eq(performanceDecisionVerdicts.windowId, report.windowId),
              )),
            db.select().from(performanceDecisionOutcomes)
              .where(and(
                eq(performanceDecisionOutcomes.accountId, accountId),
                eq(performanceDecisionOutcomes.campaignId, campaignId),
                eq(performanceDecisionOutcomes.windowId, report.windowId),
              )),
          ])
        : [[], []];

      const cycleSection = {
        state: report ? "ready"
          : windows.length === 0 ? "unavailable"
          : "awaiting_user_truth",
        report: report ? {
          windowIndex: report.windowIndex,
          platform: report.platform,
          status: report.status,
          salesBefore: report.salesBefore,
          salesAfter: report.salesAfter,
          businessVerdict: report.businessVerdict,
          attributionConfidence: report.attributionConfidence,
          verdictCounts: parseJson<Record<string, number>>(report.verdictCounts, {}),
          nextCycleRecommendation: parseJson<Record<string, unknown>>(report.nextCycleRecommendation, {}),
          sevenAnswers: parseJson<Record<string, unknown>>(report.sevenAnswers, {}),
          interpretationStatus: report.interpretationStatus,
          isTestCycle: !!report.testLabel,
          completedAt: (report as any).completedAt?.toISOString?.() ?? null,
          createdAt: report.createdAt?.toISOString() ?? null,
        } : null,
        verdicts: verdicts.map((v) => ({
          dimension: v.decisionDimension,
          value: v.decisionValue,
          executed: v.executed,
          executedPostCount: v.executedPostCount,
          verdict: v.verdict,
          reason: v.verdictReason,
          evidenceStrength: v.evidenceStrength,
          confidence: v.confidence,
          confounders: parseJson<string[]>(v.confounders, []),
          memoryWriteStatus: v.memoryWriteStatus,
        })),
        outcomes: outcomes.map((o) => ({
          dimension: o.decisionDimension,
          value: o.decisionValue,
          executionStatus: o.executionStatus,
          outcome: o.outcome,
          confidence: o.confidence,
          attributionLevel: o.attributionLevel,
          preMetrics: parseJson<Record<string, unknown>>(o.preMetrics, {}),
          postMetrics: parseJson<Record<string, unknown>>(o.postMetrics, {}),
          evaluatedAt: o.evaluatedAt?.toISOString() ?? null,
        })),
        history: reportRows.map((r) => ({
          windowIndex: r.windowIndex,
          businessVerdict: r.businessVerdict,
          salesBefore: r.salesBefore,
          salesAfter: r.salesAfter,
          verdictCounts: parseJson<Record<string, number>>(r.verdictCounts, {}),
          createdAt: r.createdAt?.toISOString() ?? null,
        })),
      };

      const trustSection = {
        state: report ? "ready" : "unavailable",
        evidenceRegistry: parseJson<unknown[]>((report as any)?.evidenceRegistry, []),
        guardResults: parseJson<Record<string, unknown> | null>((report as any)?.guardResults, null),
        judgeClaims: parseJson<unknown[]>((report as any)?.judgeClaims, []),
        versions: parseJson<Record<string, unknown> | null>((report as any)?.versions, null),
        interpretationStatus: report?.interpretationStatus ?? null,
      };

      const memorySection = {
        state: memoryRows.length > 0 ? "ready" : "insufficient_evidence",
        records: memoryRows.map((m) => ({
          label: m.label,
          direction: m.direction,
          details: m.details,
          confidence: m.confidenceScore,
          decayRate: m.decayRate,
          validationCount: m.validationCount,
          lastValidatedAt: m.lastValidatedAt?.toISOString() ?? null,
          updatedAt: m.updatedAt?.toISOString() ?? null,
          provenanceOrigin: m.provenanceOrigin,
        })),
      };

      return res.json({
        success: true,
        generatedAt: new Date().toISOString(),
        setup,
        posts: postsSection,
        execution,
        contentScores: contentSection,
        business: businessSection,
        cycle: cycleSection,
        trust: trustSection,
        memory: memorySection,
      });
    } catch (err: any) {
      console.error(`${LOG} failed:`, err?.message ?? err);
      return res.status(500).json({ success: false, error: "performance console failed" });
    }
  });
}
