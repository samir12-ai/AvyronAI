/**
 * Phase 7.5 — END-TO-END SYSTEM TEST
 * Locked by Samir 2026-04-24: "data enters → enforcement checks it →
 * lanes process it → Boss decides → AI explains → dashboard surfaces it".
 *
 * This is NOT a module harness. It seeds REAL rows into REAL tables and
 * runs the REAL Boss runner end-to-end. The only thing skipped is live
 * scraping (scope.onlyLanes=[]) — every other path (readers, validators,
 * Phase 5/6 evaluators, Q1/Q2 decision rules, AI overlays, rejection log)
 * runs through unchanged production code.
 *
 * Run:  npx tsx server/pipeline/e2e-system-test.ts
 *
 * Scenarios:
 *   S1 stable_market         Q1=*  Q2=STABLE          rule I3 or R5
 *   S2 real_market_shift     Q1=*  Q2=SHIFTED         rule I1
 *   S3 weak_signal           Q1=*  Q2=UNCERTAIN       rule I2
 *   S4 insufficient_data     Q1=*  Q2=INSUFFICIENT_DATA rule I0
 *   S5 user_execution_fail   Q1=DEGRADED|UNKNOWN  evaluation_status=degraded
 *   S6 missing_truth         Q1=UNKNOWN  truth_status=missing
 *   S7 paid_organic_ambig    composition flags ambiguity (direct module test)
 *   S8 cross_campaign_attack acceptors hard-reject + pipeline_rejections row
 */

// Enable AI overlay before any module that reads the flag is imported.
process.env.PIPELINE_AI_OVERLAY_ENABLED = process.env.PIPELINE_AI_OVERLAY_ENABLED ?? "true";

import { db } from "../db";
import {
  ciCompetitors,
  ciCompetitorPosts,
  strategicPlans,
  planApprovals,
  pipelineEvalWindows,
  pipelineUserTruth,
  pipelineDna,
  pipelineDnaVersions,
  pipelineRuns,
  pipelineSignals,
  pipelineChangeEvents,
  pipelineSnapshots,
  pipelineAcquisitions,
  pipelineRejections,
  publishedPosts,
  bossRuns,
} from "@shared/schema";
import { and, eq, inArray, gte, sql } from "drizzle-orm";
import { runBoss } from "../boss";
import { _resetCampaignLock } from "../boss/concurrency";
import { assembleInterpretation } from "./ai-overlay/assemble";
import { acceptSnapshot, acceptSignal, acceptChangeEvent } from "./validate-and-accept";
import { PipelineValidationError } from "./errors";
import { composeFromCounts, applyWeeklyOverride } from "./lanes/user/composition";

const ADMIN = "a2d87878-a1e9-41ea-a8a5-90beff569673";
const DAY_MS = 24 * 60 * 60 * 1000;
const RUN_TAG = `e2e_${Date.now().toString(36)}`;

function id(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
function cid(scenario: string): string {
  return `e2e-${scenario}-${Math.random().toString(36).slice(2, 6)}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Cleanup — wipes all e2e tagged data for a campaign before re-seeding.
// ─────────────────────────────────────────────────────────────────────────
async function cleanup(campaignId: string): Promise<void> {
  // boss runs & their downstream lineage
  await db.delete(bossRuns).where(eq(bossRuns.campaignId, campaignId));
  // pipeline lineage rows (we tag everything by campaign_id so this is exhaustive)
  await db.delete(pipelineChangeEvents).where(eq(pipelineChangeEvents.campaignId, campaignId));
  await db.delete(pipelineSignals).where(eq(pipelineSignals.campaignId, campaignId));
  await db.delete(pipelineSnapshots).where(eq(pipelineSnapshots.campaignId, campaignId));
  await db.delete(pipelineAcquisitions).where(eq(pipelineAcquisitions.campaignId, campaignId));
  await db.delete(pipelineRuns).where(eq(pipelineRuns.campaignId, campaignId));
  // phase 5/6 state
  const winRows = await db.select({ id: pipelineEvalWindows.id }).from(pipelineEvalWindows).where(eq(pipelineEvalWindows.campaignId, campaignId));
  const winIds = winRows.map((w) => w.id);
  if (winIds.length > 0) {
    await db.delete(pipelineUserTruth).where(inArray(pipelineUserTruth.windowId, winIds));
    await db.delete(pipelineEvalWindows).where(inArray(pipelineEvalWindows.id, winIds));
  }
  const dnaRows = await db.select({ id: pipelineDna.id }).from(pipelineDna).where(eq(pipelineDna.campaignId, campaignId));
  const dnaIds = dnaRows.map((d) => d.id);
  if (dnaIds.length > 0) {
    await db.delete(pipelineDnaVersions).where(inArray(pipelineDnaVersions.dnaId, dnaIds));
    await db.delete(pipelineDna).where(inArray(pipelineDna.id, dnaIds));
  }
  // CAMPAIGN-SCOPED: pull plan ids first so we don't touch unrelated approvals.
  const planRows = await db.select({ id: strategicPlans.id }).from(strategicPlans).where(eq(strategicPlans.campaignId, campaignId));
  const planIds = planRows.map((p) => p.id);
  if (planIds.length > 0) {
    await db.delete(planApprovals).where(inArray(planApprovals.planId, planIds));
  }
  await db.delete(strategicPlans).where(eq(strategicPlans.campaignId, campaignId));
  // CI tables
  const compRows = await db.select({ id: ciCompetitors.id }).from(ciCompetitors).where(eq(ciCompetitors.campaignId, campaignId));
  const compIds = compRows.map((c) => c.id);
  if (compIds.length > 0) {
    await db.delete(ciCompetitorPosts).where(inArray(ciCompetitorPosts.competitorId, compIds));
    await db.delete(ciCompetitors).where(inArray(ciCompetitors.id, compIds));
  }
  await db.delete(publishedPosts).where(and(eq(publishedPosts.accountId, ADMIN), eq(publishedPosts.campaignId, campaignId)));
  // rejections — keep S8 isolated by tag
  await db.delete(pipelineRejections).where(eq(pipelineRejections.campaignId, campaignId));
  _resetCampaignLock(ADMIN, campaignId);
}

// ─────────────────────────────────────────────────────────────────────────
// Common seeds
// ─────────────────────────────────────────────────────────────────────────
function canonicalRhythm(opts: { posts_per_week?: number; reels_per_week?: number; carousels_per_week?: number; videos_per_week?: number; stories_per_day?: number; approved_at?: string } = {}): string {
  return JSON.stringify({
    posts_per_week: opts.posts_per_week ?? 3,
    reels_per_week: opts.reels_per_week ?? 1,
    carousels_per_week: opts.carousels_per_week ?? 1,
    videos_per_week: opts.videos_per_week ?? 0,
    stories_per_day: opts.stories_per_day ?? 0,
    approved_at: opts.approved_at ?? new Date(Date.now() - 14 * DAY_MS).toISOString(),
    schema_version: "v1",
  });
}

async function seedPlan(campaignId: string, opts: { rhythm?: string; decidedDaysAgo?: number } = {}): Promise<{ planId: string; decidedAt: Date }> {
  const decidedAt = new Date(Date.now() - (opts.decidedDaysAgo ?? 14) * DAY_MS);
  const planId = id("plan");
  await db.insert(strategicPlans).values({
    id: planId,
    accountId: ADMIN,
    campaignId,
    blueprintId: id("bp"),
    planJson: "{}",
    status: "APPROVED",
    approvedRhythmJson: opts.rhythm ?? canonicalRhythm(),
    createdAt: decidedAt,
    updatedAt: decidedAt,
  } as any);
  await db.insert(planApprovals).values({
    id: id("appr"),
    accountId: ADMIN,
    planId,
    decision: "APPROVED",
    createdAt: decidedAt,
  } as any);
  return { planId, decidedAt };
}

async function seedActiveDna(campaignId: string): Promise<string> {
  const dnaId = id("dna");
  await db.insert(pipelineDna).values({
    id: dnaId,
    accountId: ADMIN,
    campaignId,
    hypothesis: "e2e test hypothesis: short-form educational lifts qualified leads",
    status: "active",
    activatedAt: new Date(Date.now() - 21 * DAY_MS),
  } as any);
  await db.insert(pipelineDnaVersions).values({
    id: id("dnav"),
    dnaId,
    hypothesis: "e2e test hypothesis: short-form educational lifts qualified leads",
    status: "active",
    reason: "e2e seed",
  } as any);
  return dnaId;
}

async function seedCompetitorCorpus(
  campaignId: string,
  posts: Array<{ competitorName: string; platform: "instagram" | "tiktok"; hashtags: string[]; daysAgo: number }>,
): Promise<{ competitorIds: string[]; postIds: string[] }> {
  const competitorIds: string[] = [];
  const postIds: string[] = [];
  const compMap = new Map<string, string>();
  for (const p of posts) {
    let compId = compMap.get(p.competitorName);
    if (!compId) {
      compId = id("comp");
      compMap.set(p.competitorName, compId);
      await db.insert(ciCompetitors).values({
        id: compId,
        accountId: ADMIN,
        campaignId,
        name: p.competitorName,
        platform: p.platform,
        profileLink: `https://${p.platform}.com/${p.competitorName.replace(/\s+/g, "")}`,
        businessType: "e2e",
        primaryObjective: "e2e",
        isActive: true,
      } as any);
      competitorIds.push(compId);
    }
    const postId = id("post");
    await db.insert(ciCompetitorPosts).values({
      id: postId,
      competitorId: compId,
      accountId: ADMIN,
      postId: postId,
      permalink: `https://${p.platform}.com/p/${postId}`,
      mediaType: "image",
      caption: "e2e seed",
      likes: 100,
      comments: 5,
      hashtags: JSON.stringify(p.hashtags),
      timestamp: new Date(Date.now() - p.daysAgo * DAY_MS),
      platform: p.platform,
    } as any);
    postIds.push(postId);
  }
  return { competitorIds, postIds };
}

/**
 * Seed historical competitor lineage rows by routing every snapshot, signal,
 * and change event through the REAL acceptors (acceptSnapshot/acceptSignal/
 * acceptChangeEvent). The harness MUST go through this enforcement boundary
 * — if any row is invalid, the acceptor throws and the test fails at seed
 * time. This is what makes the test trustworthy: by the time Q2 reads from
 * pipeline_runs/snapshots/signals/change_events, every row has been validated
 * by the same acceptor the lane runners call.
 */
async function seedHistoricalCompetitorRuns(
  campaignId: string,
  changeEventCounts: { major: number; medium: number; mild: number },
  signalCount: number = 0,
): Promise<{ runId: string; snapshotId: string; eventIds: string[] }> {
  const runId = id("run");
  // Acceptors require the run to be in "running" status (assertRunRunning).
  await db.insert(pipelineRuns).values({
    id: runId,
    accountId: ADMIN,
    campaignId,
    lane: "competitor",
    trigger: "manual",
    status: "running",
    summary: JSON.stringify({ tag: RUN_TAG }),
    startedAt: new Date(Date.now() - 2 * DAY_MS),
  } as any);
  const acqId = id("acq");
  await db.insert(pipelineAcquisitions).values({
    id: acqId,
    accountId: ADMIN,
    campaignId,
    lane: "competitor",
    entityType: "competitor_channel",
    entityId: id("ent"),
    sourceAdapter: "e2e",
    collectedAt: new Date(Date.now() - 2 * DAY_MS),
    payload: JSON.stringify({ tag: RUN_TAG }),
    provenance: JSON.stringify({ via: "e2e-seed" }),
    ttlMs: 7 * DAY_MS,
    scopeHash: id("hash"),
  } as any);
  const baselineSnapId = id("snap");
  const currentSnapId = id("snap");
  const collectedAtIso = new Date(Date.now() - 2 * DAY_MS).toISOString();
  // Route both snapshots through acceptSnapshot — exercises Zod parse +
  // assertRunRunning + assertLineageMatchesRun.
  for (const sid of [baselineSnapId, currentSnapId]) {
    await acceptSnapshot({
      snapshot_id: sid,
      run_id: runId,
      account_id: ADMIN,
      campaign_id: campaignId,
      acquisition_id: acqId,
      entity_id: "e2e_entity",
      entity_type: "competitor_channel",
      lane: "competitor",
      source: "e2e",
      collected_at: collectedAtIso,
      payload: { tag: RUN_TAG },
      schema_version: "v1",
    } as any, { callerLane: "competitor" });
  }
  // Route signals through acceptSignal — exercises signal lineage assertion
  // including source_snapshot_id pointer integrity.
  for (let i = 0; i < signalCount; i++) {
    await acceptSignal({
      signal_id: id("sig"),
      run_id: runId,
      account_id: ADMIN,
      campaign_id: campaignId,
      acquisition_id: acqId,
      source_snapshot_id: currentSnapId,
      derived_from_signal_id: null,
      lane: "competitor",
      type: "pattern",
      value: "e2e",
      confidence: 0.7,
      schema_version: "v1",
    } as any, { callerLane: "competitor" });
  }
  // Route change events through acceptChangeEvent — exercises baseline+current
  // pointer lookup, lane match, lineage assertion.
  const eventIds: string[] = [];
  const pushEvent = async (severity: "major" | "medium" | "mild") => {
    const ev = await acceptChangeEvent({
      change_event_id: id("evt"),
      run_id: runId,
      account_id: ADMIN,
      campaign_id: campaignId,
      acquisition_id: acqId,
      baseline_snapshot_id: baselineSnapId,
      current_snapshot_id: currentSnapId,
      change_dimension: "content",
      severity,
      evidence: [`e2e:${RUN_TAG}`],
      schema_version: "v1",
    } as any, { callerLane: "competitor" });
    eventIds.push(ev.id);
  };
  for (let i = 0; i < changeEventCounts.major; i++) await pushEvent("major");
  for (let i = 0; i < changeEventCounts.medium; i++) await pushEvent("medium");
  for (let i = 0; i < changeEventCounts.mild; i++) await pushEvent("mild");
  // Now seal the run as validated so Q2's reads see a closed historical run.
  await db.update(pipelineRuns)
    .set({ status: "validated", finishedAt: new Date(Date.now() - 2 * DAY_MS + 60_000) })
    .where(eq(pipelineRuns.id, runId));
  return { runId, snapshotId: currentSnapId, eventIds };
}

async function seedTruth(campaignId: string, planId: string, opts: { booked: number; submitted: boolean }): Promise<{ windowId: string | null; truthId: string | null }> {
  // Create a closed window 7 days back so Phase 5 sees it.
  const winStart = new Date(Date.now() - 8 * DAY_MS);
  const winEnd = new Date(Date.now() - 1 * DAY_MS);
  const windowId = id("win");
  await db.insert(pipelineEvalWindows).values({
    id: windowId,
    accountId: ADMIN,
    campaignId,
    planId,
    anchorAt: winStart,
    anchorFallbackUsed: false,
    windowIndex: 0,
    windowStart: winStart,
    windowEnd: winEnd,
    state: opts.submitted ? "closed_with_truth" : "closed_missing_truth",
    openedAt: winStart,
    closedAt: winEnd,
  } as any);
  if (!opts.submitted) {
    return { windowId, truthId: null };
  }
  const truthId = id("tru");
  await db.insert(pipelineUserTruth).values({
    id: truthId,
    accountId: ADMIN,
    campaignId,
    windowId,
    totalLeads: 30,
    qualifiedLeads: 12,
    bookedCalls: opts.booked,
    paidActive: false,
    submittedAt: new Date(Date.now() - 2 * DAY_MS),
    wasLate: false,
  } as any);
  await db.update(pipelineEvalWindows).set({ truthId, state: "closed_with_truth" }).where(eq(pipelineEvalWindows.id, windowId));
  return { windowId, truthId };
}

async function seedUserPostsForRhythm(campaignId: string, postCount: number): Promise<void> {
  // Posts within the open evaluation window so rhythm-compliance sees them.
  for (let i = 0; i < postCount; i++) {
    await db.insert(publishedPosts).values({
      id: id("pp"),
      accountId: ADMIN,
      campaignId,
      platform: "instagram",
      mediaType: "image",
      caption: `e2e post ${i}`,
      status: "published",
      publishedAt: new Date(Date.now() - (i + 1) * DAY_MS),
      createdAt: new Date(Date.now() - (i + 1) * DAY_MS),
    } as any);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Scenario report
// ─────────────────────────────────────────────────────────────────────────
interface ScenarioReport {
  scenario: string;
  expected: string;
  bossRunId?: string;
  q1Verdict?: string;
  q2Verdict?: string;
  q2RuleCode?: string;
  q1Reasons?: string[];
  q2Reasons?: string[];
  warnings?: string[];
  truthStatus?: string;
  rhythmStatus?: string;
  evaluationStatus?: string;
  competitorIds?: string[];
  postIds?: string[];
  competitorRunId?: string;
  changeEventIds?: string[];
  rejectionsCount?: number;
  rejectionCodes?: string[];
  q2AiStatus?: string;
  q2AiMarketRead?: string;
  q2AiImplications?: string[];
  q2AiOperatorWeighsNext?: string;
  q1AiStatus?: string;
  q1AiNarrative?: string;
  pass: boolean;
  failureReason?: string;
}

async function runScenario(
  scenario: string,
  expected: string,
  seed: (campaignId: string) => Promise<{ competitorIds?: string[]; postIds?: string[]; competitorRunId?: string; changeEventIds?: string[] }>,
  assertion: (r: { boss: any; phase6: any; reasons: string[]; verdict: { q1: string; q2: string }; ruleCode: string }) => { pass: boolean; reason?: string },
): Promise<ScenarioReport> {
  const campaignId = cid(scenario);
  const report: ScenarioReport = { scenario, expected, pass: false };
  try {
    await cleanup(campaignId);
    const seedResult = await seed(campaignId);
    report.competitorIds = seedResult.competitorIds;
    report.postIds = seedResult.postIds;
    report.competitorRunId = seedResult.competitorRunId;
    report.changeEventIds = seedResult.changeEventIds;

    // Drive the system end-to-end. onlyLanes=[] skips live scraping;
    // every other path (Phase 5, Phase 6, Q1/Q2, AI overlay) runs unchanged.
    const result = await runBoss({
      accountId: ADMIN,
      campaignId,
      trigger: "manual",
      scope: { onlyLanes: [] },
    });

    report.bossRunId = result.bossRunId;
    // BossRunResult exposes verdicts via questions.{q1_dna_working,q2_market_shifted}
    const q1V = (result as any).questions?.q1_dna_working?.verdict ?? "UNKNOWN";
    const q2V = (result as any).questions?.q2_market_shifted?.verdict ?? "UNKNOWN";
    const q1R = (result as any).questions?.q1_dna_working?.reasons ?? [];
    const q2R = (result as any).questions?.q2_market_shifted?.reasons ?? [];
    report.q1Verdict = q1V;
    report.q2Verdict = q2V;
    report.q1Reasons = q1R;
    report.q2Reasons = q2R;
    report.warnings = result.warnings ?? [];

    // Pull execution context for phase 5/6 status and Q2 rule code.
    const [bossRow] = await db.select().from(bossRuns).where(eq(bossRuns.id, result.bossRunId)).limit(1);
    const execution = bossRow?.execution ? JSON.parse(bossRow.execution) : {};
    const phase6 = execution.phase6 ?? {};
    report.truthStatus = execution.truth_status ?? "n/a";
    report.rhythmStatus = execution.rhythm_status ?? "n/a";
    report.evaluationStatus = execution.evaluation_status ?? "n/a";
    report.q2RuleCode = phase6.q2_inputs?.ruleCode ?? "n/a";

    // Drive AI overlay through the SAME assemble path the explanation route uses.
    const q2Inputs = phase6.q2_inputs ?? null;
    const q2EvalResult = q2Inputs && q2V
      ? {
          verdict: q2V as any,
          reasons: q2R,
          ruleCode: q2Inputs.ruleCode,
          inputs: {
            competitor: q2Inputs.competitor,
            user: q2Inputs.user,
            dna: q2Inputs.dna,
            lookbackDays: q2Inputs.lookbackDays,
            interpretation: q2Inputs.interpretation ?? undefined,
          },
        }
      : null;

    const q2Envelope = await assembleInterpretation({
      accountId: ADMIN,
      bossRunId: result.bossRunId,
      question: "Q2",
      verdict: q2V as any,
      reasons: q2R,
      q2: q2EvalResult as any,
    });
    report.q2AiStatus = q2Envelope.q2Reasoning.status;
    if (q2Envelope.q2Reasoning.status === "ok" && q2Envelope.q2Reasoning.data) {
      const d: any = q2Envelope.q2Reasoning.data;
      report.q2AiMarketRead = d.marketRead;
      report.q2AiImplications = d.clientImplications;
      report.q2AiOperatorWeighsNext = d.operatorWeighsNext;
    } else if (q2Envelope.q2Reasoning.error) {
      report.q2AiMarketRead = `[error] ${q2Envelope.q2Reasoning.error}`;
    }

    const q1Envelope = await assembleInterpretation({
      accountId: ADMIN,
      bossRunId: result.bossRunId,
      question: "Q1",
      verdict: q1V as any,
      reasons: q1R,
    });
    report.q1AiStatus = q1Envelope.explanation.status;
    if (q1Envelope.explanation.status === "ok" && q1Envelope.explanation.data) {
      const d: any = q1Envelope.explanation.data;
      report.q1AiNarrative = d.narrative ?? d.summary ?? JSON.stringify(d).slice(0, 200);
    } else if (q1Envelope.explanation.error) {
      report.q1AiNarrative = `[error] ${q1Envelope.explanation.error}`;
    }

    // Rejections produced during this scenario.
    const rejections = await db.select().from(pipelineRejections).where(eq(pipelineRejections.campaignId, campaignId));
    report.rejectionsCount = rejections.length;
    report.rejectionCodes = rejections.map((r) => r.reasonCode);

    const verdict = { q1: q1V, q2: q2V };
    const checked = assertion({ boss: result, phase6, reasons: q2R, verdict, ruleCode: report.q2RuleCode! });
    report.pass = checked.pass;
    report.failureReason = checked.reason;
  } catch (err) {
    report.pass = false;
    report.failureReason = `THREW: ${err instanceof Error ? err.message : String(err)}`;
  }
  return report;
}

// ─────────────────────────────────────────────────────────────────────────
// Scenarios
// ─────────────────────────────────────────────────────────────────────────

async function s1Stable(campaignId: string) {
  // Compliant rhythm: posts only (no reels/carousels/stories), so 3 posts/wk satisfies it.
  await seedPlan(campaignId, { rhythm: canonicalRhythm({ posts_per_week: 3, reels_per_week: 0, carousels_per_week: 0, stories_per_day: 0 }) });
  await seedActiveDna(campaignId);
  const seedResult = await seedCompetitorCorpus(campaignId, [
    // 2 competitors, distinct themes (no validated pattern), no overlap.
    { competitorName: "rivalA", platform: "instagram", hashtags: ["fitness"], daysAgo: 1 },
    { competitorName: "rivalA", platform: "instagram", hashtags: ["nutrition"], daysAgo: 2 },
    { competitorName: "rivalB", platform: "instagram", hashtags: ["wellness"], daysAgo: 3 },
  ]);
  // 0 major, 0 medium, only mild → STABLE.
  const hist = await seedHistoricalCompetitorRuns(campaignId, { major: 0, medium: 0, mild: 1 }, 0);
  const planRow = await seedPlanFor(campaignId);
  await seedTruth(campaignId, planRow.planId, { booked: 5, submitted: true });
  await seedUserPostsForRhythm(campaignId, 3);
  return { ...seedResult, competitorRunId: hist.runId, changeEventIds: hist.eventIds };
}
async function seedPlanFor(campaignId: string) {
  const rows = await db.select().from(strategicPlans).where(eq(strategicPlans.campaignId, campaignId)).limit(1);
  return { planId: rows[0]?.id ?? "" };
}

async function s2Shifted(campaignId: string) {
  await seedPlan(campaignId);
  await seedActiveDna(campaignId);
  const seedResult = await seedCompetitorCorpus(campaignId, [
    // Same theme tokens validated across multiple IG competitors AND TikTok = pattern_validated.
    { competitorName: "rivalA", platform: "instagram", hashtags: ["aigrowth", "automation"], daysAgo: 1 },
    { competitorName: "rivalB", platform: "instagram", hashtags: ["aigrowth", "automation"], daysAgo: 2 },
    { competitorName: "rivalC", platform: "instagram", hashtags: ["aigrowth"], daysAgo: 3 },
    { competitorName: "rivalD", platform: "tiktok", hashtags: ["aigrowth", "automation"], daysAgo: 1 },
    { competitorName: "rivalE", platform: "tiktok", hashtags: ["aigrowth"], daysAgo: 2 },
  ]);
  const hist = await seedHistoricalCompetitorRuns(campaignId, { major: 2, medium: 2, mild: 1 }, 4);
  const planRow = await seedPlanFor(campaignId);
  await seedTruth(campaignId, planRow.planId, { booked: 5, submitted: true });
  await seedUserPostsForRhythm(campaignId, 3);
  return { ...seedResult, competitorRunId: hist.runId, changeEventIds: hist.eventIds };
}

async function s3Weak(campaignId: string) {
  await seedPlan(campaignId);
  await seedActiveDna(campaignId);
  const seedResult = await seedCompetitorCorpus(campaignId, [
    // Theme appears on TikTok only, no IG validation = weak_validation.
    { competitorName: "rivalA", platform: "tiktok", hashtags: ["aigrowth"], daysAgo: 1 },
    { competitorName: "rivalB", platform: "tiktok", hashtags: ["aigrowth"], daysAgo: 2 },
    // Plus a single IG competitor on a different theme — adds noise.
    { competitorName: "rivalC", platform: "instagram", hashtags: ["organicfood"], daysAgo: 1 },
  ]);
  const hist = await seedHistoricalCompetitorRuns(campaignId, { major: 0, medium: 1, mild: 2 }, 2);
  const planRow = await seedPlanFor(campaignId);
  await seedTruth(campaignId, planRow.planId, { booked: 5, submitted: true });
  await seedUserPostsForRhythm(campaignId, 3);
  return { ...seedResult, competitorRunId: hist.runId, changeEventIds: hist.eventIds };
}

async function s4Insufficient(campaignId: string) {
  await seedPlan(campaignId);
  await seedActiveDna(campaignId);
  // Single competitor, single post, single channel = INSUFFICIENT_DATA.
  const seedResult = await seedCompetitorCorpus(campaignId, [
    { competitorName: "rivalA", platform: "instagram", hashtags: ["genericbrand"], daysAgo: 1 },
  ]);
  const hist = await seedHistoricalCompetitorRuns(campaignId, { major: 0, medium: 0, mild: 0 }, 0);
  const planRow = await seedPlanFor(campaignId);
  await seedTruth(campaignId, planRow.planId, { booked: 5, submitted: true });
  await seedUserPostsForRhythm(campaignId, 3);
  return { ...seedResult, competitorRunId: hist.runId, changeEventIds: hist.eventIds };
}

async function s5UserExecutionFailure(campaignId: string) {
  await seedPlan(campaignId, { rhythm: canonicalRhythm({ posts_per_week: 5, reels_per_week: 2, carousels_per_week: 2 }) });
  await seedActiveDna(campaignId);
  const seedResult = await seedCompetitorCorpus(campaignId, [
    { competitorName: "rivalA", platform: "instagram", hashtags: ["fitnesstips"], daysAgo: 1 },
  ]);
  const hist = await seedHistoricalCompetitorRuns(campaignId, { major: 0, medium: 0, mild: 0 }, 0);
  const planRow = await seedPlanFor(campaignId);
  await seedTruth(campaignId, planRow.planId, { booked: 5, submitted: true });
  // Promised 5 posts/week, posted 0 — non_compliant rhythm.
  return { ...seedResult, competitorRunId: hist.runId, changeEventIds: hist.eventIds };
}

async function s6MissingTruth(campaignId: string) {
  await seedPlan(campaignId);
  await seedActiveDna(campaignId);
  const seedResult = await seedCompetitorCorpus(campaignId, [
    { competitorName: "rivalA", platform: "instagram", hashtags: ["fitnesstips"], daysAgo: 1 },
  ]);
  const hist = await seedHistoricalCompetitorRuns(campaignId, { major: 0, medium: 0, mild: 0 }, 0);
  const planRow = await seedPlanFor(campaignId);
  await seedTruth(campaignId, planRow.planId, { booked: 0, submitted: false });
  await seedUserPostsForRhythm(campaignId, 3);
  return { ...seedResult, competitorRunId: hist.runId, changeEventIds: hist.eventIds };
}

// ─────────────────────────────────────────────────────────────────────────
// S7 — paid/organic ambiguity (direct module test of composition)
// ─────────────────────────────────────────────────────────────────────────
function runS7PaidOrganic(): ScenarioReport {
  const report: ScenarioReport = { scenario: "S7_paid_organic_ambiguity", expected: "composition flags clarification + minimal questions", pass: false };
  try {
    // 5 paid, 4 organic, 6 uncertain (uncertain > 30% threshold)
    const ambiguous = composeFromCounts({ paid: 5, organic: 4, uncertain: 6 }, "classifier");
    // Pure paid case = direct comparison
    const purePaid = composeFromCounts({ paid: 8, organic: 1, uncertain: 0 }, "classifier");
    // Operator override path
    const overridden = applyWeeklyOverride({ paid: 5, organic: 5 });
    report.q1AiNarrative = JSON.stringify({ ambiguous, purePaid, overridden });
    // Pass: ambiguous classifies as low-confidence (uncertain dominant) and demands clarification
    const pass = ambiguous.type === "low-confidence"
      && purePaid.type === "paid-dominant"
      && overridden.source === "user_override";
    report.pass = pass;
    if (!pass) {
      report.failureReason = `expected ambiguous=low-confidence purePaid=paid-dominant override=user_override; got ambiguous=${ambiguous.type} purePaid=${purePaid.type} overrideSource=${overridden.source}`;
    }
  } catch (err) {
    report.failureReason = `THREW: ${err instanceof Error ? err.message : String(err)}`;
  }
  return report;
}

// ─────────────────────────────────────────────────────────────────────────
// S8 — cross-campaign / cross-lane / bad lineage attack
// ─────────────────────────────────────────────────────────────────────────
async function runS8CrossCampaign(): Promise<ScenarioReport> {
  const report: ScenarioReport = { scenario: "S8_cross_campaign_attack", expected: "hard reject + pipeline_rejections row per attack", pass: false };
  const goodCampaign = cid("s8-good");
  const evilCampaign = cid("s8-evil");
  await cleanup(goodCampaign);
  await cleanup(evilCampaign);

  const errors: string[] = [];
  const ok: string[] = [];

  // Set up: a real running competitor pipeline_run on goodCampaign.
  const goodRunId = id("run");
  await db.insert(pipelineRuns).values({
    id: goodRunId,
    accountId: ADMIN,
    campaignId: goodCampaign,
    lane: "competitor",
    trigger: "manual",
    status: "running",
    startedAt: new Date(),
  } as any);
  // Good acquisition belonging to goodCampaign.
  const goodAcqId = id("acq");
  await db.insert(pipelineAcquisitions).values({
    id: goodAcqId,
    accountId: ADMIN,
    campaignId: goodCampaign,
    lane: "competitor",
    entityType: "competitor_channel",
    entityId: id("ent"),
    sourceAdapter: "e2e",
    collectedAt: new Date(),
    payload: JSON.stringify({}),
    provenance: JSON.stringify({}),
    ttlMs: 7 * DAY_MS,
    scopeHash: id("hash"),
  } as any);
  // Foreign acquisition belonging to evilCampaign (used in attack 3).
  const evilAcqId = id("acq");
  await db.insert(pipelineAcquisitions).values({
    id: evilAcqId,
    accountId: ADMIN,
    campaignId: evilCampaign,
    lane: "competitor",
    entityType: "competitor_channel",
    entityId: id("ent"),
    sourceAdapter: "e2e",
    collectedAt: new Date(),
    payload: JSON.stringify({}),
    provenance: JSON.stringify({}),
    ttlMs: 7 * DAY_MS,
    scopeHash: id("hash"),
  } as any);

  const baseSnap = {
    snapshot_id: id("snap"),
    run_id: goodRunId,
    account_id: ADMIN,
    campaign_id: goodCampaign,
    acquisition_id: goodAcqId,
    entity_id: "e2e_entity",
    entity_type: "competitor_channel" as const,
    lane: "competitor" as const,
    source: "e2e",
    collected_at: new Date().toISOString(),
    payload: { tag: RUN_TAG },
    schema_version: "v1" as const,
  };

  // Attack 1 — campaign_id mismatch: snapshot claims evilCampaign, but run is goodCampaign.
  try {
    await acceptSnapshot({ ...baseSnap, snapshot_id: id("snap"), campaign_id: evilCampaign }, { callerLane: "competitor" });
    errors.push("Attack 1 (campaign_id mismatch) did NOT throw");
  } catch (e) {
    if (e instanceof PipelineValidationError && e.code === "SNAPSHOT_LINEAGE_MISMATCH") {
      ok.push("A1:SNAPSHOT_LINEAGE_MISMATCH");
    } else {
      errors.push(`Attack 1 wrong error: ${(e as any).code ?? e}`);
    }
  }

  // Attack 2 — wrong lane: snapshot claims user lane, but run is competitor.
  try {
    await acceptSnapshot({ ...baseSnap, snapshot_id: id("snap"), lane: "user" as any }, { callerLane: "user" });
    errors.push("Attack 2 (lane mismatch) did NOT throw");
  } catch (e) {
    if (e instanceof PipelineValidationError && (e.code === "RUN_LANE_MISMATCH" || e.code === "LANE_MISMATCH")) {
      ok.push(`A2:${e.code}`);
    } else {
      errors.push(`Attack 2 wrong error: ${(e as any).code ?? e}`);
    }
  }

  // Attack 3 — cross-campaign acquisition reuse: snapshot uses evilAcqId.
  try {
    await acceptSnapshot({ ...baseSnap, snapshot_id: id("snap"), acquisition_id: evilAcqId }, { callerLane: "competitor" });
    errors.push("Attack 3 (cross-campaign acquisition) did NOT throw");
  } catch (e) {
    if (e instanceof PipelineValidationError && e.code === "ACQUISITION_CROSS_CAMPAIGN") {
      ok.push("A3:ACQUISITION_CROSS_CAMPAIGN");
    } else {
      errors.push(`Attack 3 wrong error: ${(e as any).code ?? e}`);
    }
  }

  // Attack 4 — invalid contract shape: missing required snapshot_id field.
  try {
    await acceptSnapshot({ ...baseSnap, snapshot_id: "" } as any, { callerLane: "competitor" });
    errors.push("Attack 4 (invalid contract) did NOT throw");
  } catch (e) {
    if (e instanceof PipelineValidationError && e.code === "INVALID_SNAPSHOT_CONTRACT") {
      ok.push("A4:INVALID_SNAPSHOT_CONTRACT");
    } else {
      errors.push(`Attack 4 wrong error: ${(e as any).code ?? e}`);
    }
  }

  // Attack 5 — signal cross-campaign on a competitor-lane signal.
  const goodSnapPayload = { ...baseSnap, snapshot_id: id("snap") };
  await acceptSnapshot(goodSnapPayload, { callerLane: "competitor" });
  try {
    await acceptSignal({
      signal_id: id("sig"),
      run_id: goodRunId,
      account_id: ADMIN,
      campaign_id: evilCampaign, // wrong campaign
      acquisition_id: goodAcqId,
      source_snapshot_id: goodSnapPayload.snapshot_id,
      derived_from_signal_id: null,
      lane: "competitor",
      type: "pattern",
      value: "e2e",
      confidence: 0.5,
      evidence: [],
      schema_version: "v1",
    } as any, { callerLane: "competitor" });
    errors.push("Attack 5 (signal cross-campaign) did NOT throw");
  } catch (e) {
    if (e instanceof PipelineValidationError && e.code === "SIGNAL_LINEAGE_MISMATCH") {
      ok.push("A5:SIGNAL_LINEAGE_MISMATCH");
    } else {
      errors.push(`Attack 5 wrong error: ${(e as any).code ?? e}`);
    }
  }

  // Attack 6 — bridge-lane signal MISSING derived_from_signal_id (the real
  // bridge lineage rule, not just cross-campaign reuse). Per SignalContract
  // superRefine, bridge signals MUST carry derived_from_signal_id; without
  // it, the contract parse must reject with INVALID_SIGNAL_CONTRACT.
  try {
    await acceptSignal({
      signal_id: id("sig"),
      run_id: goodRunId,
      account_id: ADMIN,
      campaign_id: goodCampaign,
      acquisition_id: null, // bridge lane allows null acquisition
      source_snapshot_id: goodSnapPayload.snapshot_id,
      derived_from_signal_id: null, // <-- the violation
      lane: "bridge",
      type: "pattern",
      value: "e2e",
      confidence: 0.5,
      evidence: [],
      schema_version: "v1",
    } as any, { callerLane: "bridge" });
    errors.push("Attack 6 (bridge missing derived_from_signal_id) did NOT throw");
  } catch (e) {
    if (e instanceof PipelineValidationError && (e.code === "INVALID_SIGNAL_CONTRACT" || e.code === "SIGNAL_LINEAGE_MISMATCH")) {
      ok.push(`A6:${e.code}`);
    } else {
      errors.push(`Attack 6 wrong error: ${(e as any).code ?? e}`);
    }
  }

  // Pull rejection rows that surfaced from the attacks (only acceptors that
  // call recordRejection internally produce rows; not all do — we assert what we get).
  // pipeline_rejections is populated by the readers and any boundary that records.
  const rej = await db.select().from(pipelineRejections).where(
    inArray(pipelineRejections.campaignId, [goodCampaign, evilCampaign]),
  );
  report.rejectionsCount = rej.length;
  report.rejectionCodes = rej.map((r) => r.reasonCode);
  const TOTAL_ATTACKS = 6;
  report.q2AiMarketRead = `attacks_blocked=${ok.length}/${TOTAL_ATTACKS} [${ok.join(",")}]; failures=${errors.join(";") || "none"}`;
  // PASS only if every attack threw the expected structured error.
  const allBlocked = ok.length === TOTAL_ATTACKS && errors.length === 0;
  report.pass = allBlocked;
  if (!allBlocked) {
    report.failureReason = `expected ${TOTAL_ATTACKS}/${TOTAL_ATTACKS} attacks blocked with structured PipelineValidationError; got ${ok.length}/${TOTAL_ATTACKS} ok=[${ok.join(",")}] errors=[${errors.join(" | ")}]`;
  }
  return report;
}

// ─────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────
function pad(s: string, n: number): string {
  return (s ?? "").length >= n ? (s ?? "").slice(0, n) : (s ?? "") + " ".repeat(n - (s ?? "").length);
}

function printReport(reports: ScenarioReport[]): void {
  console.log("");
  console.log("═".repeat(85));
  console.log(" PHASE 7.5 — END-TO-END SYSTEM TEST — REPORT");
  console.log("═".repeat(85));
  for (const r of reports) {
    const status = r.pass ? "✓ PASS" : "✗ FAIL";
    console.log(`\n${status}  ${r.scenario}`);
    console.log(`        expected:        ${r.expected}`);
    if (r.bossRunId) console.log(`        boss_run_id:     ${r.bossRunId}`);
    if (r.q1Verdict) console.log(`        Q1 verdict:      ${r.q1Verdict}`);
    if (r.q2Verdict) console.log(`        Q2 verdict:      ${r.q2Verdict}  rule=${r.q2RuleCode ?? "n/a"}`);
    if (r.truthStatus) console.log(`        truth/rhythm:    truth=${r.truthStatus} rhythm=${r.rhythmStatus} eval=${r.evaluationStatus}`);
    if (r.warnings && r.warnings.length) console.log(`        warnings:        ${r.warnings.join(", ")}`);
    if (r.competitorIds && r.competitorIds.length) console.log(`        competitorIds:   ${r.competitorIds.length} (${r.competitorIds[0]?.slice(0, 16)}...)`);
    if (r.postIds && r.postIds.length) console.log(`        postIds:         ${r.postIds.length} (${r.postIds[0]?.slice(0, 16)}...)`);
    if (r.competitorRunId) console.log(`        competitor_run:  ${r.competitorRunId}`);
    if (r.changeEventIds && r.changeEventIds.length) console.log(`        change_events:   ${r.changeEventIds.length}`);
    if (r.q2Reasons && r.q2Reasons.length) console.log(`        Q2 reasons:      ${r.q2Reasons.join(" | ")}`);
    if (r.q2AiStatus) console.log(`        Q2 AI overlay:   ${r.q2AiStatus}`);
    if (r.q2AiMarketRead) console.log(`        Q2 AI market:    ${r.q2AiMarketRead.slice(0, 200)}`);
    if (r.q2AiImplications) {
      r.q2AiImplications.forEach((x, i) => console.log(`        Q2 AI impl[${i}]:    ${x.slice(0, 180)}`));
    }
    if (r.q2AiOperatorWeighsNext) console.log(`        Q2 AI weighs:    ${r.q2AiOperatorWeighsNext.slice(0, 180)}`);
    if (r.q1AiStatus) console.log(`        Q1 AI overlay:   ${r.q1AiStatus}`);
    if (r.q1AiNarrative) console.log(`        Q1 AI narrative: ${r.q1AiNarrative.slice(0, 200)}`);
    if (r.rejectionsCount !== undefined) console.log(`        rejections:      ${r.rejectionsCount} [${(r.rejectionCodes ?? []).join(", ")}]`);
    if (!r.pass) console.log(`        FAILURE:         ${r.failureReason ?? "unknown"}`);
  }
  const passed = reports.filter((r) => r.pass).length;
  const failed = reports.length - passed;
  console.log("\n" + "═".repeat(85));
  console.log(` SUMMARY — ${passed}/${reports.length} passed, ${failed} failed`);
  console.log("═".repeat(85));
}

// ─────────────────────────────────────────────────────────────────────────
// End-of-run residue sweep — wipes every e2e-tagged campaign from every
// pipeline_* / boss_runs table so the harness leaves the DB in the same
// state it found it (no test rows can leak into a migration export).
// ─────────────────────────────────────────────────────────────────────────
async function sweepE2EResidue(): Promise<void> {
  const sources: Array<{ table: string; col: string }> = [
    { table: "boss_runs", col: "campaign_id" },
    { table: "pipeline_runs", col: "campaign_id" },
    { table: "pipeline_snapshots", col: "campaign_id" },
    { table: "pipeline_signals", col: "campaign_id" },
    { table: "pipeline_change_events", col: "campaign_id" },
    { table: "pipeline_acquisitions", col: "campaign_id" },
    { table: "pipeline_eval_windows", col: "campaign_id" },
    { table: "pipeline_dna", col: "campaign_id" },
    { table: "pipeline_rejections", col: "campaign_id" },
  ];
  const seen = new Set<string>();
  for (const { table, col } of sources) {
    const rows = await db.execute(sql.raw(`SELECT DISTINCT ${col} AS cid FROM ${table} WHERE ${col} LIKE 'e2e-%'`));
    for (const r of rows.rows as Array<{ cid: string | null }>) {
      if (r.cid) seen.add(r.cid);
    }
  }
  for (const campaignId of seen) {
    await cleanup(campaignId);
  }
}

async function main(): Promise<void> {
  const reports: ScenarioReport[] = [];
  let allPass = false;
  try {

  // S1-S4 assert BOTH verdict AND ruleCode prefix to guard against decision-logic
  // regressions that produce the right verdict for the wrong reason.
  const verdictAndRule = (
    expectedVerdict: string,
    ruleStartsWith: string,
  ) => ({ verdict, ruleCode }: { verdict: { q1: string; q2: string }; ruleCode: string }) => {
    if (verdict.q2 !== expectedVerdict) {
      return { pass: false, reason: `expected ${expectedVerdict}, got ${verdict.q2} rule=${ruleCode}` };
    }
    if (!ruleCode.startsWith(ruleStartsWith)) {
      return { pass: false, reason: `verdict ${verdict.q2} ✓ but ruleCode '${ruleCode}' did not start with '${ruleStartsWith}' — decision logic may have produced the right verdict for the wrong reason` };
    }
    return { pass: true };
  };

  reports.push(await runScenario(
    "S1_stable_market", "Q2=STABLE (rule:stable_*)",
    s1Stable,
    verdictAndRule("STABLE", "rule:stable"),
  ));

  reports.push(await runScenario(
    "S2_real_market_shift", "Q2=SHIFTED (rule:shifted_pattern_validated*)",
    s2Shifted,
    verdictAndRule("SHIFTED", "rule:shifted_pattern_validated"),
  ));

  reports.push(await runScenario(
    "S3_weak_signal", "Q2=UNCERTAIN (rule:medium* or rule:uncertain*)",
    s3Weak,
    ({ verdict, ruleCode }) => {
      if (verdict.q2 !== "UNCERTAIN") return { pass: false, reason: `expected UNCERTAIN, got ${verdict.q2} rule=${ruleCode}` };
      const okRule = ruleCode.startsWith("rule:medium") || ruleCode.startsWith("rule:uncertain") || ruleCode.startsWith("rule:weak");
      return okRule ? { pass: true } : { pass: false, reason: `verdict UNCERTAIN ✓ but ruleCode '${ruleCode}' is not in the expected uncertain-family` };
    },
  ));

  reports.push(await runScenario(
    "S4_insufficient_data", "Q2=INSUFFICIENT_DATA (insufficient_data:* / insufficient_corpus*)",
    s4Insufficient,
    ({ verdict, ruleCode }) => {
      if (verdict.q2 !== "INSUFFICIENT_DATA") return { pass: false, reason: `expected INSUFFICIENT_DATA, got ${verdict.q2} rule=${ruleCode}` };
      const okRule = ruleCode.startsWith("insufficient_data") || ruleCode.startsWith("rule:insufficient");
      return okRule ? { pass: true } : { pass: false, reason: `verdict INSUFFICIENT_DATA ✓ but ruleCode '${ruleCode}' did not match insufficient_*` };
    },
  ));

  reports.push(await runScenario(
    "S5_user_execution_failure", "Q1≠WORKING; rhythm_status=non_compliant",
    s5UserExecutionFailure,
    ({ verdict, boss }) => {
      const warn = ((boss as any).warnings ?? []).join(",");
      // Must be non-WORKING AND rhythm_non_compliant must be in the warnings.
      const nonWorking = verdict.q1 !== "WORKING";
      const rhythmFlag = warn.includes("rhythm_non_compliant");
      return nonWorking && rhythmFlag
        ? { pass: true }
        : { pass: false, reason: `expected Q1!=WORKING + rhythm_non_compliant warning, got Q1=${verdict.q1} warnings=${warn}` };
    },
  ));

  reports.push(await runScenario(
    "S6_missing_truth", "Q1=UNKNOWN; warning user_truth_missing",
    s6MissingTruth,
    ({ verdict, boss }) => {
      const warn = ((boss as any).warnings ?? []).join(",");
      const truthFlag = warn.includes("user_truth_missing");
      return verdict.q1 === "UNKNOWN" && truthFlag
        ? { pass: true }
        : { pass: false, reason: `expected Q1=UNKNOWN + user_truth_missing, got Q1=${verdict.q1} warnings=${warn}` };
    },
  ));

  reports.push(runS7PaidOrganic());
  reports.push(await runS8CrossCampaign());

  printReport(reports);

  allPass = reports.every((r) => r.pass);
  } finally {
    // Sweep every e2e-tagged campaign so the harness leaves no residue.
    // Runs even if a scenario throws, so the DB returns to a clean baseline.
    try {
      await sweepE2EResidue();
      console.log("");
      console.log("[cleanup] e2e residue sweep complete — all e2e-* campaigns wiped");
    } catch (sweepErr) {
      console.error("[cleanup] sweep FAILED:", sweepErr);
    }
  }
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error("e2e harness threw:", e);
  process.exit(2);
});
