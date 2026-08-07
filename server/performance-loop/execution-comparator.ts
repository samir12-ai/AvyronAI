/**
 * Execution Comparator — deterministic strategy-vs-actual execution layer.
 *
 * "What did Avyron prescribe" vs "what did the user actually publish".
 *
 * Doctrine:
 *   - Code decides every execution status. The LLM may later EXPLAIN the
 *     result, but never determines it.
 *   - Statuses: EXECUTED | PARTIALLY_EXECUTED | NOT_EXECUTED | UNVERIFIED |
 *     BLOCKED | NOT_YET_DUE.
 *   - Execution is only claimed on sufficiently strong lineage
 *     (planned_direct / planned_matched / manual_matched) — never inferred
 *     from caption vibes.
 *   - Absence of observation ≠ absence of execution: if the channel is not
 *     connected the status is BLOCKED; if the scrape does not cover the
 *     window the status is UNVERIFIED. NOT_EXECUTED is reserved for windows
 *     we actually observed.
 *   - Append-only persistence (one batch per comparison run).
 */
import { randomUUID } from "crypto";
import { db } from "../db";
import {
  executionComparisons,
  ownedPosts,
  userPublicProfiles,
  userChannelSnapshots,
  strategicPlans,
  pipelineEvalWindows,
  CONTENT_SCORE_DIMENSIONS,
  type ContentScoreDimension,
  type ExecutionStatus,
  type ExecutionComparison,
} from "@shared/schema";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { loadRecommendedDecisions, type RecommendedDecision } from "./plan-decisions";
import { loadOwnedClassifications } from "./owned-post-classifier";

const LOG = "[ExecutionComparator]";
export const COMPARATOR_VERSION = "exec-comparator-v1";

/** Lineage states strong enough to claim execution (mirrors content scorer). */
const EXECUTION_LINEAGE = new Set(["planned_direct", "planned_matched", "manual_matched"]);

export interface ExecutionComparisonRow {
  decision: RecommendedDecision;
  executionStatus: ExecutionStatus;
  deterministicReason: string;
  evidencePostIds: string[];
  lineageEvidence: Array<{ postId: string; lineageState: string; matchConfidence: number | null }>;
  classificationEvidence: Array<{
    postId: string;
    classificationId: string;
    confidence: number | null;
    observed: Record<string, string | null>;
  }>;
  matchedPostCount: number;
  windowPostCount: number;
  expectedSummary: string;
  observedSummary: string;
  freshness: string | null;
}

export interface ExecutionComparisonResult {
  status: "OK" | "NO_APPROVED_PLAN" | "NO_DECISIONS";
  reason: string | null;
  comparisonRunId: string;
  planId: string | null;
  windowId: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  channelState: "connected" | "not_connected";
  lastSuccessfulScrapeAt: string | null;
  rows: ExecutionComparisonRow[];
  persistedCount: number;
}

/**
 * Run the deterministic comparison.
 *
 * - With `windowId`: compares against that evaluation window's bounds
 *   (cycle-runner path; pass `persist: true` to freeze the batch).
 * - Without `windowId`: live mode for the UI tracker — compares the trailing
 *   7 days against the active plan; NOT persisted unless asked.
 */
export async function runExecutionComparison(params: {
  accountId: string;
  campaignId: string;
  planId?: string;
  windowId?: string;
  persist?: boolean;
  comparisonRunId?: string;
}): Promise<ExecutionComparisonResult> {
  const { accountId, campaignId } = params;
  const comparisonRunId = params.comparisonRunId ?? randomUUID();
  const now = new Date();

  // ── Resolve window bounds ────────────────────────────────────────────
  let windowId: string | null = null;
  let windowStart: Date;
  let windowEnd: Date;
  let planId = params.planId ?? null;

  if (params.windowId) {
    const win = await db
      .select()
      .from(pipelineEvalWindows)
      .where(
        and(
          eq(pipelineEvalWindows.id, params.windowId),
          eq(pipelineEvalWindows.accountId, accountId),
          eq(pipelineEvalWindows.campaignId, campaignId),
        ),
      )
      .limit(1);
    if (!win[0]) {
      return emptyResult(comparisonRunId, "NO_APPROVED_PLAN", `window ${params.windowId} not found for this tenant`);
    }
    windowId = win[0].id;
    windowStart = win[0].windowStart;
    windowEnd = win[0].windowEnd;
    planId = planId ?? win[0].planId ?? null;
  } else {
    windowEnd = now;
    windowStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  }

  // ── Resolve plan ─────────────────────────────────────────────────────
  if (!planId) {
    const plan = await db
      .select({ id: strategicPlans.id })
      .from(strategicPlans)
      .where(
        and(
          eq(strategicPlans.accountId, accountId),
          eq(strategicPlans.campaignId, campaignId),
          eq(strategicPlans.status, "APPROVED"),
        ),
      )
      .orderBy(desc(strategicPlans.createdAt))
      .limit(1);
    planId = plan[0]?.id ?? null;
  }
  if (!planId) {
    return emptyResult(comparisonRunId, "NO_APPROVED_PLAN", "campaign has no approved strategy plan — nothing is prescribed yet");
  }

  const decisions = await loadRecommendedDecisions(accountId, campaignId, planId);
  if (decisions.length === 0) {
    return {
      ...emptyResult(comparisonRunId, "NO_DECISIONS", "the approved plan has no trackable planned artifacts (no dimension vocabulary to compare)"),
      planId,
      windowId,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
    };
  }

  // ── Channel + scrape coverage (determines BLOCKED / UNVERIFIED) ─────
  const profiles = await db
    .select()
    .from(userPublicProfiles)
    .where(and(eq(userPublicProfiles.accountId, accountId), eq(userPublicProfiles.campaignId, campaignId)));
  const channelConnected = profiles.some((p) => p.platform !== "website");

  let lastSuccessfulScrapeAt: Date | null = null;
  if (channelConnected) {
    const snap = await db
      .select({ scrapedAt: userChannelSnapshots.scrapedAt })
      .from(userChannelSnapshots)
      .where(
        and(
          eq(userChannelSnapshots.accountId, accountId),
          eq(userChannelSnapshots.campaignId, campaignId),
          // Coverage requires an explicitly SUCCESSFUL, complete scrape.
          // PARTIAL/SKIPPED snapshots must NOT satisfy observation coverage —
          // a partial scan could miss posts and turn real execution into a false
          // NOT_EXECUTED verdict.
          sql`(${userChannelSnapshots.snapshotData}::json->>'scrapeStatus') = 'SUCCESS'`,
        ),
      )
      .orderBy(desc(userChannelSnapshots.scrapedAt))
      .limit(1);
    lastSuccessfulScrapeAt = snap[0]?.scrapedAt ?? null;
  }

  const windowClosed = windowEnd.getTime() <= now.getTime();
  // A closed window is only "observed" if a successful scrape happened after
  // it closed; a live window is observed by any successful scrape inside it.
  const scrapeCoversWindow =
    lastSuccessfulScrapeAt !== null &&
    (windowClosed
      ? lastSuccessfulScrapeAt.getTime() >= windowEnd.getTime()
      : lastSuccessfulScrapeAt.getTime() >= windowStart.getTime());

  // ── Window posts + classification evidence ──────────────────────────
  const windowPosts = await db
    .select()
    .from(ownedPosts)
    .where(
      and(
        eq(ownedPosts.accountId, accountId),
        eq(ownedPosts.campaignId, campaignId),
        gte(ownedPosts.postedAt, windowStart),
        lt(ownedPosts.postedAt, windowEnd),
      ),
    );
  const classifications = windowPosts.length
    ? await loadOwnedClassifications({ accountId, campaignId, ownedPostIds: windowPosts.map((p) => p.id) })
    : [];
  const classByPost = new Map(classifications.map((c) => [c.ownedPostId, c]));

  const dimValue = (post: (typeof windowPosts)[number], dim: ContentScoreDimension): string | null => {
    if (dim === "hook_style") return post.hookStyle;
    if (dim === "content_angle") return post.contentAngle;
    if (dim === "content_type") return post.contentType;
    return null;
  };

  const freshness = lastSuccessfulScrapeAt?.toISOString() ?? null;
  const rows: ExecutionComparisonRow[] = [];

  for (const decision of decisions) {
    const expectedSummary = `Plan ${planId} prescribes ${decision.dimension}=${decision.value} (source: ${decision.source})`;

    let executionStatus: ExecutionStatus;
    let deterministicReason: string;
    let evidence: typeof windowPosts = [];
    let conformCount = 0;
    let divergeCount = 0;

    if (!channelConnected) {
      executionStatus = "BLOCKED";
      deterministicReason = "no social channel is connected for this campaign — published posts cannot be observed or verified";
    } else if (!scrapeCoversWindow) {
      executionStatus = "UNVERIFIED";
      deterministicReason = lastSuccessfulScrapeAt
        ? `last successful channel scrape (${lastSuccessfulScrapeAt.toISOString()}) does not cover this window — posts may exist unobserved`
        : "channel is connected but no successful scrape has completed yet";
    } else {
      // Only lineage-strong posts that CARRY this dimension participate.
      const lineagePosts = windowPosts.filter(
        (p) => EXECUTION_LINEAGE.has(p.lineageState ?? "") && (dimValue(p, decision.dimension) ?? "").trim() !== "",
      );
      const conforming = lineagePosts.filter(
        (p) => dimValue(p, decision.dimension)!.trim().toLowerCase() === decision.value.trim().toLowerCase(),
      );
      conformCount = conforming.length;
      divergeCount = lineagePosts.length - conforming.length;
      evidence = conforming;

      if (conformCount > 0 && divergeCount === 0) {
        executionStatus = "EXECUTED";
        deterministicReason = `${conformCount} plan-linked post(s) in the window carry ${decision.dimension}=${decision.value}; no plan-linked post diverges on this dimension`;
      } else if (conformCount > 0) {
        executionStatus = "PARTIALLY_EXECUTED";
        deterministicReason = `${conformCount} of ${lineagePosts.length} plan-linked post(s) with a ${decision.dimension} value match ${decision.value}; ${divergeCount} diverge`;
      } else if (!windowClosed) {
        executionStatus = "NOT_YET_DUE";
        deterministicReason = `window is still open (ends ${windowEnd.toISOString()}) and no matching post has been observed yet`;
      } else {
        executionStatus = "NOT_EXECUTED";
        deterministicReason = `window was fully observed (scrape after close) and no plan-linked post carries ${decision.dimension}=${decision.value}`;
      }
    }

    const classificationEvidence = evidence
      .map((p) => {
        const c = classByPost.get(p.id);
        return c
          ? {
              postId: p.id,
              classificationId: c.id,
              confidence: c.confidenceScore,
              observed: {
                hookArchetype: c.hookArchetype,
                narrative: c.narrative,
                contentFormatIntent: c.contentFormatIntent,
                primaryGoal: c.primaryGoal,
              },
            }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    rows.push({
      decision,
      executionStatus,
      deterministicReason,
      evidencePostIds: evidence.map((p) => p.id),
      lineageEvidence: evidence.map((p) => ({
        postId: p.id,
        lineageState: p.lineageState ?? "unmatched",
        matchConfidence: p.matchConfidence,
      })),
      classificationEvidence,
      matchedPostCount: conformCount,
      windowPostCount: windowPosts.length,
      expectedSummary,
      observedSummary:
        windowPosts.length === 0
          ? "no owned posts observed in this window"
          : `${windowPosts.length} owned post(s) in window; ${conformCount} match this decision, ${divergeCount} plan-linked post(s) diverge`,
      freshness,
    });
  }

  // ── Persist (append-only, one batch per run) ────────────────────────
  let persistedCount = 0;
  if (params.persist) {
    persistedCount = await persistComparisonRows({
      accountId,
      campaignId,
      comparisonRunId,
      planId: planId!,
      windowId,
      rows,
    });
  }

  return {
    status: "OK",
    reason: null,
    comparisonRunId,
    planId,
    windowId,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    channelState: channelConnected ? "connected" : "not_connected",
    lastSuccessfulScrapeAt: freshness,
    rows,
    persistedCount,
  };
}

/** Shared append-only insert used by both persist paths. */
async function persistComparisonRows(params: {
  accountId: string;
  campaignId: string;
  comparisonRunId: string;
  planId: string;
  windowId: string | null;
  rows: ExecutionComparisonRow[];
}): Promise<number> {
  let persistedCount = 0;
  for (const row of params.rows) {
    await db.insert(executionComparisons).values({
      accountId: params.accountId,
      campaignId: params.campaignId,
      comparisonRunId: params.comparisonRunId,
      planId: params.planId,
      windowId: params.windowId,
      decisionDimension: row.decision.dimension,
      decisionValue: row.decision.value,
      decisionSource: row.decision.source,
      expectedSummary: row.expectedSummary,
      observedSummary: row.observedSummary,
      executionStatus: row.executionStatus,
      deterministicReason: row.deterministicReason,
      evidencePostIds: JSON.stringify(row.evidencePostIds),
      lineageEvidence: JSON.stringify(row.lineageEvidence),
      classificationEvidence: JSON.stringify(row.classificationEvidence),
      matchedPostCount: row.matchedPostCount,
      windowPostCount: row.windowPostCount,
      freshness: row.freshness,
      comparatorVersion: COMPARATOR_VERSION,
    });
    persistedCount += 1;
  }
  console.log(
    `${LOG} persisted ${persistedCount} comparison row(s) run=${params.comparisonRunId} window=${params.windowId ?? "live"}`,
  );
  return persistedCount;
}

/**
 * Freeze an ALREADY-COMPUTED comparison result (append-only).
 *
 * Used by the cycle runner so the frozen execution_comparisons rows are
 * byte-identical to the rows its outcome writer consumed. Recomputing at
 * persist time could diverge: a scrape or post landing between computation
 * and persist would make the frozen history disagree with the outcome rows.
 */
export async function persistComparisonResult(
  tenant: { accountId: string; campaignId: string },
  result: ExecutionComparisonResult,
): Promise<number> {
  if (result.status !== "OK" || !result.planId) return 0;
  return persistComparisonRows({
    accountId: tenant.accountId,
    campaignId: tenant.campaignId,
    comparisonRunId: result.comparisonRunId,
    planId: result.planId,
    windowId: result.windowId,
    rows: result.rows,
  });
}

function emptyResult(
  comparisonRunId: string,
  status: "NO_APPROVED_PLAN" | "NO_DECISIONS",
  reason: string,
): ExecutionComparisonResult {
  return {
    status,
    reason,
    comparisonRunId,
    planId: null,
    windowId: null,
    windowStart: null,
    windowEnd: null,
    channelState: "not_connected",
    lastSuccessfulScrapeAt: null,
    rows: [],
    persistedCount: 0,
  };
}
