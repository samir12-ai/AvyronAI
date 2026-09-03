/**
 * W-1 Watchtower Orchestrator.
 *
 * Called after every successful competitor lane run (inside boss/run.ts).
 * Loads the most recent pipeline_snapshots for the competitor, classifies
 * deterministic changes, and materializes structured market events in
 * pipeline_change_events with evidence, source snapshot IDs, and two-fetch
 * validation gating.
 *
 * Hard rules:
 *   - Two-fetch gate: a candidate (validated_at=null) is promoted ONLY when a
 *     LATER independent fetch execution re-detects the same kind of change
 *     against the candidate's ORIGINAL BASELINE snapshot.
 *   - Independence is proven by runId, not snapshot identity. A cache-hit
 *     fetch that reuses the same snapshot IS a valid confirming observation
 *     because it represents a separate successful execution that found the
 *     same persisted market state. Snapshot deduplication is a storage
 *     optimisation; fetch independence is an execution property.
 *   - Same-run re-execution NEVER confirms: the confirming runId must differ
 *     from the candidate's original runId.
 *   - Confirmation delay: the candidate must have been created at least
 *     CONFIRMATION_DELAY_HOURS ago before a confirming run can promote it.
 *   - Reversion before confirmation archives the candidate (not deletes):
 *     if the current state no longer differs from the candidate's baseline
 *     (or a frequency shift flipped direction), the candidate is archived
 *     with a deterministic reason code preserving historical lineage.
 *   - Cache-hit fetches participate in Phase A (candidate maintenance) but
 *     are excluded from Phase B (new candidate creation) to prevent
 *     redundant duplicate events from identical payloads.
 *   - Candidate creation is idempotent at the DB level: unique partial index
 *     uq_pce_open_candidate on (competitor_id, campaign_id, kind) WHERE
 *     validated_at IS NULL, insert via onConflictDoNothing (migration 043).
 *   - Q2 / verdicts are fenced: evaluateQ2 excludes kind IS NOT NULL rows, so
 *     no Watchtower row (candidate or confirmed) alters existing verdict
 *     behaviour. W-1 is data plumbing only.
 *   - No AI calls. No silent catches — every failure path logs a structured
 *     tag. Failures are isolated: never propagate to the boss run.
 */

import { db } from "../db";
import { pipelineSnapshots, pipelineChangeEvents, competitorPostClassifications, ciCompetitorPosts, ciCompetitors } from "@shared/schema";
import { and, eq, isNull, isNotNull, desc, sql, count, ne } from "drizzle-orm";
import { scheduleConfirmationFetch, CONFIRMATION_DELAY_HOURS } from "./scheduler";
import { enqueueBrief } from "./strategic-brief-runner";

const LOG_PREFIX = "[Watchtower]";

// ── semantic change kinds ─────────────────────────────────────────────────────
// These are detected via competitor_post_classifications, not snapshot payloads.
// The set is used by maintainOpenCandidates to route semantic candidates to the
// async semantic re-classifier instead of the sync payload classifier.
const SEMANTIC_CHANGE_KINDS = new Set([
  "hook_archetype_shift",
  "promise_shift",
  "emotional_trigger_shift",
  "positioning_shift",
  "primary_goal_shift",
  "cta_strategy_shift",
  // Added P-3: 4 previously-untracked enumerated dimensions
  "narrative_shift",
  "awareness_stage_shift",
  "offer_type_shift",
  "content_format_shift",
]);

/** Rolling window for semantic diffs: 30 days on each side of the snapshot. */
const SEMANTIC_WINDOW_DAYS = 30;
/** Minimum posts in each window before we trust the distribution. */
const SEMANTIC_MIN_POSTS = 3;
/** Percentage-point share change that triggers a "same top value, shifting weight" alert. */
const SEMANTIC_SHIFT_THRESHOLD_PP = 0.20;

interface SemanticClassificationRow {
  hookArchetype: string | null;
  coreMarketingPromise: string | null;
  emotionalTrigger: string | null;
  positioningStyle: string | null;
  primaryGoal: string | null;
  ctaType: string | null;
  // Added P-3
  narrative: string | null;
  awarenessStage: string | null;
  offerType: string | null;
  contentFormatIntent: string | null;
  postTimestamp: Date | null;
}

interface SemanticDimensionDef {
  kind: string;
  label: string;
  getter: (r: SemanticClassificationRow) => string | null;
}

const SEMANTIC_DIMENSIONS: SemanticDimensionDef[] = [
  { kind: "hook_archetype_shift",    label: "Hook archetype",         getter: (r) => r.hookArchetype },
  { kind: "promise_shift",           label: "Core marketing promise", getter: (r) => r.coreMarketingPromise },
  { kind: "emotional_trigger_shift", label: "Emotional trigger",      getter: (r) => r.emotionalTrigger },
  { kind: "positioning_shift",       label: "Positioning style",      getter: (r) => r.positioningStyle },
  { kind: "primary_goal_shift",      label: "Primary goal",           getter: (r) => r.primaryGoal },
  { kind: "cta_strategy_shift",      label: "CTA strategy",           getter: (r) => r.ctaType },
  // Added P-3: previously-untracked enumerated dimensions
  { kind: "narrative_shift",         label: "Narrative framework",    getter: (r) => r.narrative },
  { kind: "awareness_stage_shift",   label: "Awareness stage",        getter: (r) => r.awarenessStage },
  { kind: "offer_type_shift",        label: "Offer type",             getter: (r) => r.offerType },
  { kind: "content_format_shift",    label: "Content format",         getter: (r) => r.contentFormatIntent },
];

function buildSemanticDistribution(
  rows: SemanticClassificationRow[],
  getter: (r: SemanticClassificationRow) => string | null,
): Record<string, number> {
  const dist: Record<string, number> = {};
  for (const row of rows) {
    const val = getter(row);
    if (!val || val === "UNKNOWN" || val === "NONE") continue;
    dist[val] = (dist[val] || 0) + 1;
  }
  return dist;
}

function topSemanticValue(dist: Record<string, number>): string | null {
  const entries = Object.entries(dist).sort((a, b) => b[1] - a[1]);
  return entries.length > 0 ? entries[0][0] : null;
}

function semanticShare(dist: Record<string, number>, value: string): number {
  const total = Object.values(dist).reduce((a, b) => a + b, 0);
  return total > 0 ? (dist[value] ?? 0) / total : 0;
}

/**
 * Async semantic diff: compare competitor_post_classifications distributions
 * across two 30-day rolling windows anchored at the previous and current
 * snapshot timestamps.
 *
 * Fires when:
 *  (a) The top value for a dimension changed (most significant — severity=major).
 *  (b) The top value is the same but its share moved ≥ 20pp (severity=medium/mild).
 *
 * Returns [] (no events) when:
 *  - No classifications exist for this competitor.
 *  - Either window has fewer than SEMANTIC_MIN_POSTS (thin data, can't trust distribution).
 *
 * Isolation guarantee: any DB error returns [] and logs a structured tag so the
 * boss run is never blocked (W-1 isolation contract).
 */
async function classifySemanticChanges(
  competitorId: string,
  previousSnapTime: Date,
  currentSnapTime: Date,
  baselineSnapshotId: string,
  currentSnapshotId: string,
): Promise<WatchtowerChange[]> {
  const changes: WatchtowerChange[] = [];
  const ids = { baselineSnapshotId, currentSnapshotId };

  const windowMs = SEMANTIC_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const prevWindowStart = new Date(previousSnapTime.getTime() - windowMs);
  const currWindowStart = new Date(currentSnapTime.getTime() - windowMs);

  // Single query — load all v2 classifications for this competitor joined with
  // post timestamp. Filter confidence in-memory to avoid a numeric cast issue.
  let rows: SemanticClassificationRow[];
  try {
    const raw = await db
      .select({
        hookArchetype: competitorPostClassifications.hookArchetype,
        coreMarketingPromise: competitorPostClassifications.coreMarketingPromise,
        emotionalTrigger: competitorPostClassifications.emotionalTrigger,
        positioningStyle: competitorPostClassifications.positioningStyle,
        primaryGoal: competitorPostClassifications.primaryGoal,
        ctaType: competitorPostClassifications.ctaType,
        // Added P-3
        narrative: competitorPostClassifications.narrative,
        awarenessStage: competitorPostClassifications.awarenessStage,
        offerType: competitorPostClassifications.offerType,
        contentFormatIntent: competitorPostClassifications.contentFormatIntent,
        confidenceScore: competitorPostClassifications.confidenceScore,
        postTimestamp: ciCompetitorPosts.timestamp,
      })
      .from(competitorPostClassifications)
      .innerJoin(
        ciCompetitorPosts,
        eq(competitorPostClassifications.postId, ciCompetitorPosts.id),
      )
      .where(
        and(
          eq(competitorPostClassifications.competitorId, competitorId),
          eq(competitorPostClassifications.classifierVersion, "competitor-post-v2"),
        ),
      );
    // Confidence filter in-memory (confidenceScore is a numeric column; Drizzle
    // may return it as string or number depending on driver mode).
    rows = raw
      .filter((r) => {
        const conf = typeof r.confidenceScore === "number"
          ? r.confidenceScore
          : Number(r.confidenceScore ?? 0);
        return conf >= 0.50;
      })
      .map((r) => ({
        hookArchetype: r.hookArchetype,
        coreMarketingPromise: r.coreMarketingPromise,
        emotionalTrigger: r.emotionalTrigger,
        positioningStyle: r.positioningStyle,
        primaryGoal: r.primaryGoal,
        ctaType: r.ctaType,
        narrative: r.narrative,
        awarenessStage: r.awarenessStage,
        offerType: r.offerType,
        contentFormatIntent: r.contentFormatIntent,
        postTimestamp: r.postTimestamp,
      }));
  } catch (err) {
    console.error(
      `${LOG_PREFIX} SEMANTIC_DIFF_FAILED competitorId=${competitorId} reason=classification_load_failed detail=${(err as Error).message}`,
    );
    return [];
  }

  if (rows.length === 0) return [];

  // Split into two rolling windows using the post's publication timestamp.
  const beforeRows = rows.filter((r) => {
    if (!r.postTimestamp) return false;
    return r.postTimestamp >= prevWindowStart && r.postTimestamp <= previousSnapTime;
  });
  const afterRows = rows.filter((r) => {
    if (!r.postTimestamp) return false;
    return r.postTimestamp >= currWindowStart && r.postTimestamp <= currentSnapTime;
  });

  if (beforeRows.length < SEMANTIC_MIN_POSTS || afterRows.length < SEMANTIC_MIN_POSTS) {
    console.log(
      `${LOG_PREFIX} SEMANTIC_DIFF_THIN_DATA competitorId=${competitorId} beforePosts=${beforeRows.length} afterPosts=${afterRows.length} minRequired=${SEMANTIC_MIN_POSTS}`,
    );
    return [];
  }

  for (const dim of SEMANTIC_DIMENSIONS) {
    const beforeDist = buildSemanticDistribution(beforeRows, dim.getter);
    const afterDist  = buildSemanticDistribution(afterRows,  dim.getter);

    const beforeTop = topSemanticValue(beforeDist);
    const afterTop  = topSemanticValue(afterDist);
    if (!beforeTop || !afterTop) continue;

    const beforeShare = semanticShare(beforeDist, beforeTop);
    const afterShare  = semanticShare(afterDist,  afterTop);

    console.log(`[DEBUG] dim=${dim.label} prevSnap=${previousSnapTime.toISOString()} currSnap=${currentSnapTime.toISOString()} beforeRows=${beforeRows.length} afterRows=${afterRows.length}`);

    if (beforeTop !== afterTop) {
      // Top value completely changed — highest signal.
      const beforeShareOfNew = semanticShare(beforeDist, afterTop);
      changes.push({
        kind: dim.kind,
        severity: "major",
        evidence: [
          `${dim.label}: ${beforeTop} → ${afterTop}`,
          `"${afterTop}" share: ${Math.round(beforeShareOfNew * 100)}% → ${Math.round(afterShare * 100)}% (+${Math.round((afterShare - beforeShareOfNew) * 100)}pp)`,
          `window: ${beforeRows.length} posts (before) | ${afterRows.length} posts (after)`,
        ],
        prevValue: { top: beforeTop, share: Math.round(beforeShare * 100), distribution: beforeDist },
        currValue: { top: afterTop,  share: Math.round(afterShare  * 100), distribution: afterDist  },
        ...ids,
      });
    } else {
      // Same top value — check for meaningful share drift.
      const shareChange = afterShare - beforeShare;
      if (Math.abs(shareChange) >= SEMANTIC_SHIFT_THRESHOLD_PP) {
        const direction = shareChange > 0 ? "increased" : "decreased";
        changes.push({
          kind: dim.kind,
          severity: Math.abs(shareChange) >= 0.35 ? "medium" : "mild",
          evidence: [
            `${dim.label}: ${beforeTop} ${direction} by ${Math.round(Math.abs(shareChange) * 100)}pp`,
            `share: ${Math.round(beforeShare * 100)}% → ${Math.round(afterShare * 100)}%`,
            `window: ${beforeRows.length} posts (before) | ${afterRows.length} posts (after)`,
          ],
          prevValue: { top: beforeTop, share: Math.round(beforeShare * 100), distribution: beforeDist },
          currValue: { top: afterTop,  share: Math.round(afterShare  * 100), distribution: afterDist  },
          ...ids,
        });
      }
    }
  }

  return changes;
}

export interface WatchtowerOrchestratorInput {
  accountId: string;
  campaignId: string;
  /** ci_competitors.id — also the entity_id used in pipeline_snapshots. */
  competitorId: string;
  acquisitionId: string;
  /** The competitor lane run_id, for lineage on emitted events. */
  runId: string;
  /** True when the acquisition came from a shared-profile cache hit. */
  isCacheHit: boolean;
}

interface WatchtowerChange {
  kind: string;
  severity: "mild" | "medium" | "major";
  evidence: string[];
  prevValue: unknown;
  currValue: unknown;
  baselineSnapshotId: string;
  currentSnapshotId: string;
}

/** Structured evidence persisted on every Watchtower event row (JSON string). */
interface WatchtowerEvidence {
  notes: string[];
  prev: unknown;
  curr: unknown;
  /** Set at promotion time — the snapshot that confirmed the candidate. */
  confirmedBySnapshotId?: string;
  /** Run ID of the original observation that created this candidate. */
  originalRunId?: string;
  /** Run ID of the confirming fetch execution. */
  confirmedByRunId?: string;
  /** Whether the confirming fetch reused a cached snapshot. */
  confirmedByCacheHit?: boolean;
  /** Decision code explaining the confirmation outcome. */
  confirmationDecision?: string;
  /** Human-readable reason for the confirmation decision. */
  confirmationDecisionReason?: string;
  /** ISO timestamp of the original candidate creation. */
  originalObservationTimestamp?: string;
  /** ISO timestamp of the confirming fetch. */
  confirmationTimestamp?: string;
  /** Archive/rejection reason code when a candidate is closed. */
  archiveReason?: string;
  /** Run ID that caused archive/rejection. */
  archivedByRunId?: string;
  /** For reversion events — ID of the prior confirmed event being reverted. */
  revertedFromEventId?: string;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function normalizeStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const cleaned = (input as unknown[])
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.trim().toLowerCase())
    .filter((x) => x.length > 0);
  return Array.from(new Set(cleaned)).sort();
}

function safeParsePayload(raw: string | null | undefined, label: string): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    console.error(`${LOG_PREFIX} COMPETITOR_DIFF_FAILED label=${label} reason=json_parse_error`);
    return null;
  }
}

function parseEvidence(raw: string | null | undefined): WatchtowerEvidence | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Array.isArray(parsed.notes)) {
      return parsed as WatchtowerEvidence;
    }
    return null;
  } catch {
    return null;
  }
}

// ── deterministic classification ─────────────────────────────────────────────

/**
 * Classifies market changes between two snapshots.
 * Uses only verified available payload fields (patterns, frequency, objections).
 *
 * W-1 availability:
 *   posting_frequency_shift  — AVAILABLE (frequency field)
 *   competitor_profile_change — AVAILABLE (patterns field)
 *   offer_language_change     — AVAILABLE (objections = offer_phrases for website competitors)
 *   phrase_saturation_change  — UNAVAILABLE (requires cross-competitor view)
 *   engagement_pattern_shift  — UNAVAILABLE (metrics not in translated competitor payload)
 *   dominance_shift           — UNAVAILABLE (no dominance scores in lane payload)
 *   pricing_page_change       — UNAVAILABLE (pricing anchors not in translated payload)
 */
export function classifyWatchtowerChanges(
  current: Record<string, unknown>,
  previous: Record<string, unknown>,
  currentSnapshotId: string,
  baselineSnapshotId: string,
): WatchtowerChange[] {
  const changes: WatchtowerChange[] = [];
  const ids = { baselineSnapshotId, currentSnapshotId };

  // 1. posting_frequency_shift
  const prevFreq = typeof previous.frequency === "number" ? previous.frequency : null;
  const currFreq = typeof current.frequency === "number" ? current.frequency : null;
  if (prevFreq !== null && currFreq !== null && prevFreq !== currFreq && prevFreq > 0) {
    const delta = currFreq - prevFreq;
    const pctChange = Math.abs(delta / prevFreq);
    if (pctChange >= 0.20) {
      changes.push({
        kind: "posting_frequency_shift",
        // >50% shift = watch, 20–49% = mild (B1: truthful sizing)
        severity: pctChange >= 0.50 ? "medium" : "mild",
        evidence: [
          `frequency: ${prevFreq} → ${currFreq} (${Math.round(pctChange * 100)}% change)`,
        ],
        prevValue: prevFreq,
        currValue: currFreq,
        ...ids,
      });
    }
  }

  // 2. competitor_profile_change (patterns shift — captions, hashtags, CTAs)
  const prevPatterns = normalizeStringArray(previous.patterns);
  const currPatterns = normalizeStringArray(current.patterns);
  if (prevPatterns.length > 0 || currPatterns.length > 0) {
    const prevSet = new Set(prevPatterns);
    const currSet = new Set(currPatterns);
    const added = currPatterns.filter((p) => !prevSet.has(p));
    const removed = prevPatterns.filter((p) => !currSet.has(p));
    const totalUniq = new Set([...prevPatterns, ...currPatterns]).size;
    const changedCount = added.length + removed.length;
    const changePct = totalUniq > 0 ? changedCount / totalUniq : 0;

    if (changePct >= 0.30 && changedCount >= 3) {
      changes.push({
        kind: "competitor_profile_change",
        severity: changePct >= 0.60 ? "medium" : "mild",
        evidence: [
          `patterns: ${changedCount}/${totalUniq} changed (${Math.round(changePct * 100)}%)`,
          ...(added.length > 0 ? [`added: ${added.slice(0, 3).join(" | ")}`] : []),
          ...(removed.length > 0 ? [`removed: ${removed.slice(0, 3).join(" | ")}`] : []),
        ],
        prevValue: prevPatterns.slice(0, 5),
        currValue: currPatterns.slice(0, 5),
        ...ids,
      });
    }
  }

  // 3. offer_language_change (objections = offer_phrases for competitor_website entities)
  const prevOffers = normalizeStringArray(previous.objections);
  const currOffers = normalizeStringArray(current.objections);
  if (prevOffers.length > 0 || currOffers.length > 0) {
    const prevOfferSet = new Set(prevOffers);
    const currOfferSet = new Set(currOffers);
    const addedOffers = currOffers.filter((o) => !prevOfferSet.has(o));
    const removedOffers = prevOffers.filter((o) => !currOfferSet.has(o));
    if (addedOffers.length > 0 || removedOffers.length > 0) {
      const totalChanged = addedOffers.length + removedOffers.length;
      changes.push({
        kind: "offer_language_change",
        // ≥3 offer changes = candidate alarm (major), <3 = watch (medium) — W-1 severity §C
        severity: totalChanged >= 3 ? "major" : "medium",
        evidence: [
          ...(addedOffers.length > 0
            ? [`added offers: ${addedOffers.slice(0, 3).join(" | ")}`]
            : []),
          ...(removedOffers.length > 0
            ? [`removed offers: ${removedOffers.slice(0, 3).join(" | ")}`]
            : []),
        ],
        prevValue: prevOffers.slice(0, 5),
        currValue: currOffers.slice(0, 5),
        ...ids,
      });
    }
  }

  // 4. pricing_change (pricing = pricing_anchors / plans for competitor_website entities)
  const prevPricing = normalizeStringArray(previous.pricing || previous.pricingAnchors);
  const currPricing = normalizeStringArray(current.pricing || current.pricingAnchors);
  if (prevPricing.length > 0 || currPricing.length > 0) {
    const prevPricingSet = new Set(prevPricing);
    const currPricingSet = new Set(currPricing);
    const addedPricing = currPricing.filter((p) => !prevPricingSet.has(p));
    const removedPricing = prevPricing.filter((p) => !currPricingSet.has(p));
    if (addedPricing.length > 0 || removedPricing.length > 0) {
      const totalChanged = addedPricing.length + removedPricing.length;
      changes.push({
        kind: "pricing_change",
        severity: totalChanged >= 2 ? "major" : "medium",
        evidence: [
          ...(addedPricing.length > 0
            ? [`added pricing/plans: ${addedPricing.slice(0, 3).join(" | ")}`]
            : []),
          ...(removedPricing.length > 0
            ? [`removed pricing/plans: ${removedPricing.slice(0, 3).join(" | ")}`]
            : []),
        ],
        prevValue: prevPricing.slice(0, 5),
        currValue: currPricing.slice(0, 5),
        ...ids,
      });
    }
  }

  return changes;
}

// ── Phase A: candidate maintenance (promotion / reversion / archival) ────────

export const CANDIDATE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
/** Minimum elapsed time before a confirming run can promote a candidate.
 *  Derived from the scheduler's CONFIRMATION_DELAY_HOURS configuration. */
const CONFIRMATION_DELAY_MS = CONFIRMATION_DELAY_HOURS * 60 * 60 * 1000;

interface OpenCandidateRow {
  id: string;
  kind: string | null;
  baselineSnapshotId: string | null;
  currentSnapshotId: string | null;
  evidence: string | null;
  createdAt: Date | null;
  /** Run ID of the fetch execution that created this candidate. */
  runId: string;
  /** Current lifecycle status of the candidate. */
  status: string;
}

/**
 * For every open candidate: re-classify the CURRENT state against the
 * candidate's ORIGINAL baseline snapshot.
 *   - same kind still fires (and, for frequency, same direction) → PROMOTE
 *   - kind no longer fires (state reverted to baseline)           → CLOSE (delete)
 *   - frequency direction flipped                                 → CLOSE (delete)
 *   - confirming snapshot === candidate's own snapshot            → SKIP (not independent)
 *   - candidate older than the 30d confirmation window            → CLOSE (delete, expired)
 *
 * Expiry closure is mandatory, not cosmetic: uq_pce_open_candidate allows only
 * ONE open candidate per (competitor, campaign, kind). An expired-but-open row
 * would silently dedupe every future detection of that kind forever (B2:
 * operational silence is a failure category), so stale candidates are closed
 * with a log line to release the slot.
 */
async function maintainOpenCandidates(
  input: WatchtowerOrchestratorInput,
  currentSnap: { id: string; collectedAt: Date | null },
  currentPayload: Record<string, unknown>,
): Promise<void> {
  const { campaignId, competitorId } = input;
  const windowStart = new Date(Date.now() - CANDIDATE_WINDOW_MS);

  let candidates: OpenCandidateRow[];
  try {
    candidates = await db
      .select({
        id: pipelineChangeEvents.id,
        kind: pipelineChangeEvents.kind,
        baselineSnapshotId: pipelineChangeEvents.baselineSnapshotId,
        currentSnapshotId: pipelineChangeEvents.currentSnapshotId,
        evidence: pipelineChangeEvents.evidence,
        createdAt: pipelineChangeEvents.createdAt,
        runId: pipelineChangeEvents.runId,
        status: pipelineChangeEvents.status,
      })
      .from(pipelineChangeEvents)
      .where(
        and(
          eq(pipelineChangeEvents.competitorId, competitorId),
          eq(pipelineChangeEvents.campaignId, campaignId),
          isNotNull(pipelineChangeEvents.kind),
          eq(pipelineChangeEvents.status, "candidate"),
          isNull(pipelineChangeEvents.validatedAt),
        ),
      );
  } catch (err) {
    console.error(
      `${LOG_PREFIX} MARKET_EVENT_PERSIST_FAILED competitorId=${competitorId} reason=candidate_lookup_failed detail=${(err as Error).message}`,
    );
    return;
  }

  for (const candidate of candidates) {
    if (!candidate.kind || !candidate.baselineSnapshotId) {
      console.error(
        `${LOG_PREFIX} MARKET_EVENT_PERSIST_FAILED eventId=${candidate.id} reason=candidate_row_incomplete`,
      );
      continue;
    }

    // Expired: past the 30d confirmation window without a confirming fetch.
    // Close it to release the uq_pce_open_candidate slot — otherwise every
    // future detection of this kind dedupes into silence.
    if (candidate.createdAt && candidate.createdAt < windowStart) {
      await archiveCandidate(candidate.id, candidate.kind, competitorId, "expired_unconfirmed_30d");
      continue;
    }

    // Independence: the confirming observation must come from a SEPARATE FETCH EXECUTION
    // than the one that created the candidate. Re-running the exact same runId is not a second fetch.
    if (candidate.runId === input.runId) {
      console.log(
        `${LOG_PREFIX} CANDIDATE_SAME_RUN_SKIPPED eventId=${candidate.id} kind=${candidate.kind} runId=${input.runId}`,
      );
      continue;
    }

    // Delay constraint: The new fetch must have occurred sufficiently after the candidate was created.
    if (candidate.createdAt && Date.now() - candidate.createdAt.getTime() < CONFIRMATION_DELAY_MS) {
       console.log(
         `${LOG_PREFIX} CANDIDATE_DELAY_NOT_MET eventId=${candidate.id} kind=${candidate.kind}`
       );
       continue;
    }

    if (input.isCacheHit) {
      console.log(
        `${LOG_PREFIX} CANDIDATE_CACHE_HIT_REUSED eventId=${candidate.id} kind=${candidate.kind} runId=${input.runId}`
      );
    }

    // Load the candidate's original baseline snapshot.
    // collectedAt is needed for semantic candidate re-classification (time windows).
    let baselineRow: { id: string; payload: string | null; collectedAt: Date | null } | undefined;
    try {
      [baselineRow] = await db
        .select({ id: pipelineSnapshots.id, payload: pipelineSnapshots.payload, collectedAt: pipelineSnapshots.collectedAt })
        .from(pipelineSnapshots)
        .where(eq(pipelineSnapshots.id, candidate.baselineSnapshotId))
        .limit(1);
    } catch (err) {
      console.error(
        `${LOG_PREFIX} MARKET_EVENT_PERSIST_FAILED eventId=${candidate.id} reason=baseline_load_failed detail=${(err as Error).message}`,
      );
      continue;
    }

    // Semantic candidates are re-checked by comparing classification
    // distributions across the two time windows — they don't use snapshot payloads.
    let vsBaseline: WatchtowerChange[];
    if (SEMANTIC_CHANGE_KINDS.has(candidate.kind)) {
      const baselineCollectedAt = baselineRow?.collectedAt;
      const currentCollectedAt = currentSnap.collectedAt;
      if (!baselineCollectedAt || !currentCollectedAt) {
        console.error(
          `${LOG_PREFIX} SEMANTIC_CANDIDATE_TIMESTAMPS_MISSING eventId=${candidate.id} kind=${candidate.kind} — leaving open to expire`,
        );
        continue;
      }
      try {
        vsBaseline = await classifySemanticChanges(
          competitorId,
          baselineCollectedAt,
          currentCollectedAt,
          candidate.baselineSnapshotId,
          currentSnap.id,
        );
      } catch (err) {
        console.error(
          `${LOG_PREFIX} COMPETITOR_DIFF_FAILED eventId=${candidate.id} reason=semantic_confirmation_threw detail=${(err as Error).message}`,
        );
        continue;
      }
    } else {
      const baselinePayload = baselineRow
        ? safeParsePayload(baselineRow.payload, `baseline:${candidate.baselineSnapshotId}`)
        : null;
      if (!baselinePayload) {
        // Baseline snapshot pruned or unparseable — cannot verify persistence.
        // Leave the candidate open (it expires from the 30d window naturally);
        // never promote on unverifiable evidence (B1/B3).
        console.error(
          `${LOG_PREFIX} CANDIDATE_BASELINE_UNAVAILABLE eventId=${candidate.id} kind=${candidate.kind} baselineSnapshotId=${candidate.baselineSnapshotId}`,
        );
        continue;
      }
      try {
        vsBaseline = classifyWatchtowerChanges(
          currentPayload,
          baselinePayload,
          currentSnap.id,
          candidate.baselineSnapshotId,
        );
      } catch (err) {
        console.error(
          `${LOG_PREFIX} COMPETITOR_DIFF_FAILED eventId=${candidate.id} reason=confirmation_classification_threw detail=${(err as Error).message}`,
        );
        continue;
      }
    }

    const match = vsBaseline.find((c) => c.kind === candidate.kind);

    if (!match) {
      // State reverted to baseline before confirmation → close, never promote.
      await archiveCandidate(candidate.id, candidate.kind, competitorId, "reverted_to_baseline", input.runId);
      continue;
    }

    // Direction check for numeric shifts: a 40→60 candidate must not be
    // confirmed by a 40→28 state (shift flipped direction = not persistent).
    if (candidate.kind === "posting_frequency_shift") {
      const stored = parseEvidence(candidate.evidence);
      const storedPrev = typeof stored?.prev === "number" ? stored.prev : null;
      const storedCurr = typeof stored?.curr === "number" ? stored.curr : null;
      if (storedPrev === null || storedCurr === null) {
        console.error(
          `${LOG_PREFIX} MARKET_EVENT_PERSIST_FAILED eventId=${candidate.id} reason=candidate_evidence_unparseable`,
        );
        continue;
      }
      const candidateSign = Math.sign(storedCurr - storedPrev);
      const confirmingSign = Math.sign((match.currValue as number) - (match.prevValue as number));
      if (candidateSign !== confirmingSign) {
        await archiveCandidate(candidate.id, candidate.kind, competitorId, "direction_flipped", input.runId);
        continue;
      }
    }

    // Promote: two independent fresh fetches agree the change persists vs the
    // original baseline. Evidence/severity refreshed to the confirmed state.
    // Also compute market-level scope: how many distinct competitors for this
    // campaign have confirmed the SAME kind AND the SAME semantic destination
    // within the 60-day look-back window (including this one being promoted).
    // Grouping by kind alone is insufficient — four competitors each doing
    // PROMISE_SHIFT toward unrelated destinations is NOT a market-wide shift.
    try {
      // Extract the semantic destination (e.g. "Trust", "Urgency") from the
      // change detected by classifySemanticChanges(). currValue shape is always
      // { top: string, share: number, distribution: {...} } for semantic kinds.
      const toValueStr: string | null =
        match.currValue != null &&
        typeof match.currValue === "object" &&
        "top" in (match.currValue as object)
          ? String((match.currValue as { top: unknown }).top)
          : null;

      // Count other already-confirmed competitors for the same kind + semantic
      // destination + campaign within the 60-day look-back window.
      const scopeWindowCutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
      let confirmedOthers = 0;
      try {
        const [row] = await db
          .select({ cnt: count() })
          .from(pipelineChangeEvents)
          .where(
            and(
              eq(pipelineChangeEvents.campaignId, input.campaignId),
              eq(pipelineChangeEvents.kind, candidate.kind),
              // Must share the same semantic destination. If toValue is null on
              // this row or the stored rows, null-equality yields 0 matches,
              // which conservatively degrades scope to single_competitor.
              toValueStr != null
                ? eq(pipelineChangeEvents.toValue, toValueStr)
                : isNull(pipelineChangeEvents.toValue),
              isNotNull(pipelineChangeEvents.validatedAt),
              ne(pipelineChangeEvents.competitorId, competitorId),
              sql`${pipelineChangeEvents.validatedAt} >= ${scopeWindowCutoff}`,
            ),
          );
        confirmedOthers = Number(row?.cnt ?? 0);
      } catch {
        // Non-fatal — scope degrades to single_competitor
      }
      const totalConfirmedCount = confirmedOthers + 1; // include the one being promoted now
      // Classify scope:
      //   1 competitor                          → single_competitor
      //   2–3 competitors                       → several_competitors
      //   4+ competitors (≥ market-wide signal) → market_wide
      const scope: string =
        totalConfirmedCount >= 4
          ? "market_wide"
          : totalConfirmedCount >= 2
            ? "several_competitors"
            : "single_competitor";

      const confirmedEvidence: WatchtowerEvidence = {
        notes: match.evidence,
        prev: match.prevValue,
        curr: match.currValue,
        confirmedBySnapshotId: currentSnap.id,
        originalRunId: candidate.runId,
        confirmedByRunId: input.runId,
        confirmedByCacheHit: input.isCacheHit,
        confirmationDecision: "CONFIRMED",
        originalObservationTimestamp: candidate.createdAt?.toISOString(),
        confirmationTimestamp: new Date().toISOString(),
      };
      await db
        .update(pipelineChangeEvents)
        .set({
          status: "confirmed",
          validatedAt: new Date(),
          severity: match.severity,
          evidence: JSON.stringify(confirmedEvidence),
          currentSnapshotId: currentSnap.id,
          scope,
          scopeCompetitorCount: totalConfirmedCount,
          toValue: toValueStr,
        })
        .where(and(eq(pipelineChangeEvents.id, candidate.id), eq(pipelineChangeEvents.status, "candidate")));
      console.log(
        `${LOG_PREFIX} MARKET_EVENT_CONFIRMED eventId=${candidate.id} competitorId=${competitorId} kind=${candidate.kind} campaign=${input.campaignId} confirmedBy=${currentSnap.id} scope=${scope} scopeCount=${totalConfirmedCount} toValue=${toValueStr ?? "null"}`,
      );

      // Auto-generate strategic brief for all confirmed events (severity controls prioritization, not eligibility)
      console.log(`${LOG_PREFIX} Auto-generating strategic brief for confirmed event ${candidate.id}`);
      enqueueBrief(candidate.id, input.campaignId, input.accountId, competitorId).catch((err) => {
        console.error(`${LOG_PREFIX} Auto-generation failed for event ${candidate.id}:`, err);
      });
    } catch (err) {
      console.error(
        `${LOG_PREFIX} MARKET_EVENT_PERSIST_FAILED eventId=${candidate.id} reason=confirmation_update_failed detail=${(err as Error).message}`,
      );
    }
  }
}

async function archiveCandidate(
  eventId: string,
  kind: string,
  competitorId: string,
  reason: string,
  runId?: string
): Promise<void> {
  try {
    // Update the evidence to persist why it was archived and when.
    // Fetch current evidence to preserve it.
    const [row] = await db
      .select({ evidence: pipelineChangeEvents.evidence })
      .from(pipelineChangeEvents)
      .where(eq(pipelineChangeEvents.id, eventId));
      
    let ev: WatchtowerEvidence = parseEvidence(row?.evidence) || { notes: [], prev: null, curr: null };
    ev.archiveReason = reason;
    ev.archivedByRunId = runId;
    ev.confirmationDecision = "REJECTED";
    ev.confirmationDecisionReason = reason;
    ev.confirmationTimestamp = new Date().toISOString();

    await db
      .update(pipelineChangeEvents)
      .set({
        status: "archived",
        evidence: JSON.stringify(ev),
        updatedAt: new Date(),
      })
      .where(and(eq(pipelineChangeEvents.id, eventId), eq(pipelineChangeEvents.status, "candidate")));
    console.log(
      `${LOG_PREFIX} MARKET_EVENT_CANDIDATE_ARCHIVED eventId=${eventId} kind=${kind} competitorId=${competitorId} reason=${reason}`,
    );
  } catch (err) {
    console.error(
      `${LOG_PREFIX} MARKET_EVENT_PERSIST_FAILED eventId=${eventId} reason=candidate_archive_failed detail=${(err as Error).message}`,
    );
  }
}

// ── Phase B: new candidate creation ──────────────────────────────────────────

async function createCandidate(
  input: WatchtowerOrchestratorInput,
  change: WatchtowerChange,
): Promise<void> {
  const { accountId, campaignId, competitorId, acquisitionId, runId } = input;
  try {
    const eventId = `wt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const evidence: WatchtowerEvidence = {
      notes: change.evidence,
      prev: change.prevValue,
      curr: change.currValue,
    };

    // Reversion Memory Audit: Check if this new change reverts to a historically confirmed state.
    try {
      const [lastConfirmed] = await db
        .select({ id: pipelineChangeEvents.id, evidence: pipelineChangeEvents.evidence })
        .from(pipelineChangeEvents)
        .where(
          and(
            eq(pipelineChangeEvents.competitorId, competitorId),
            eq(pipelineChangeEvents.campaignId, campaignId),
            eq(pipelineChangeEvents.kind, change.kind),
            eq(pipelineChangeEvents.status, "confirmed")
          )
        )
        .orderBy(desc(pipelineChangeEvents.createdAt))
        .limit(1);

      if (lastConfirmed) {
        const lastEv = parseEvidence(lastConfirmed.evidence);
        let isReversion = false;
        if (lastEv) {
          if (SEMANTIC_CHANGE_KINDS.has(change.kind)) {
            // Semantic reversion: the new current top value matches the previous top value.
            const prevTop = (lastEv.prev as any)?.top;
            const currTop = (change.currValue as any)?.top;
            if (prevTop && currTop && prevTop === currTop) {
              isReversion = true;
            }
          } else {
            // Payload-based reversion: strict equality of values/arrays.
            if (JSON.stringify(lastEv.prev) === JSON.stringify(change.currValue)) {
              isReversion = true;
            }
          }
        }

        if (isReversion) {
          evidence.revertedFromEventId = lastConfirmed.id;
          // We can prepend a note to explicitly flag it in the UI/payload if needed.
          evidence.notes = [`Reverted to previous state`, ...evidence.notes];
          console.log(
            `${LOG_PREFIX} REVERSION_CANDIDATE_DETECTED competitorId=${competitorId} kind=${change.kind} revertedFrom=${lastConfirmed.id}`,
          );
        }
      }
    } catch (err) {
      console.error(`${LOG_PREFIX} REVERSION_CHECK_FAILED detail=${(err as Error).message}`);
    }

    const inserted = await db
      .insert(pipelineChangeEvents)
      .values({
        id: eventId,
        runId,
        accountId,
        campaignId,
        acquisitionId,
        windowId: null,
        competitorId,
        kind: change.kind,
        baselineSnapshotId: change.baselineSnapshotId,
        currentSnapshotId: change.currentSnapshotId,
        changeDimension: "other",
        severity: change.severity,
        evidence: JSON.stringify(evidence),
        schemaVersion: "v1",
        validatedAt: null,
      })
      // uq_pce_open_candidate (migration 043): at most one open candidate per
      // (competitor, campaign, kind). Duplicate executions / replicas dedupe here.
      .onConflictDoNothing()
      .returning({ id: pipelineChangeEvents.id });

    if (inserted.length === 0) {
      console.log(
        `${LOG_PREFIX} CANDIDATE_ALREADY_OPEN competitorId=${competitorId} kind=${change.kind} campaign=${campaignId} — insert deduped by uq_pce_open_candidate`,
      );
      return;
    }
    console.log(
      `${LOG_PREFIX} MARKET_EVENT_CANDIDATE_CREATED competitorId=${competitorId} kind=${change.kind} severity=${change.severity} campaign=${campaignId}`,
    );

    // Watchtower Phase 2 - Confirmation Loop
    await scheduleConfirmationFetch(accountId, campaignId, competitorId);
  } catch (err) {
    console.error(
      `${LOG_PREFIX} MARKET_EVENT_PERSIST_FAILED competitorId=${competitorId} kind=${change.kind} reason=insert_failed detail=${(err as Error).message}`,
    );
  }
}

// ── main entry point ──────────────────────────────────────────────────────────

export async function runWatchtowerOrchestrator(
  input: WatchtowerOrchestratorInput,
): Promise<void> {
  const { campaignId, competitorId, isCacheHit } = input;

  // 1. Snapshot reuse (isCacheHit=true) does NOT count as an independent 
  // observation for NEW candidate creation (Phase B). However, it IS allowed 
  // to evaluate EXISTING candidates (Phase A) because a cache hit proves the 
  // original state persisted successfully.
  // We shifted this early-return from the top of the function to sit between 
  // Phase A and Phase B.

  // Load the two most recent pipeline_snapshots for this competitor.
  let snapshots: Array<{ id: string; payload: string | null; collectedAt: Date | null }>;
  try {
    snapshots = await db
      .select({
        id: pipelineSnapshots.id,
        payload: pipelineSnapshots.payload,
        collectedAt: pipelineSnapshots.collectedAt,
      })
      .from(pipelineSnapshots)
      .where(
        and(
          eq(pipelineSnapshots.entityId, competitorId),
          eq(pipelineSnapshots.campaignId, campaignId),
          eq(pipelineSnapshots.lane, "competitor"),
        ),
      )
      .orderBy(desc(pipelineSnapshots.collectedAt))
      .limit(2);
  } catch (err) {
    console.error(
      `${LOG_PREFIX} WATCHTOWER_ORCHESTRATOR_FAILED competitorId=${competitorId} reason=snapshot_load_failed detail=${(err as Error).message}`,
    );
    return;
  }

  if (snapshots.length === 0) {
    console.log(
      `${LOG_PREFIX} FIRST_OBSERVATION competitorId=${competitorId} campaign=${campaignId} snapshotCount=0`,
    );
    return;
  }

  const currentSnap = snapshots[0];
  const currentPayload = safeParsePayload(currentSnap.payload, `snapshot:${currentSnap.id}`);
  if (!currentPayload) {
    console.error(
      `${LOG_PREFIX} COMPETITOR_DIFF_FAILED competitorId=${competitorId} reason=current_payload_parse_failed currentId=${currentSnap.id}`,
    );
    return;
  }

  // Phase A — maintain open candidates against the fresh state (promotion,
  // reversion-close, direction-flip-close). Runs before Phase B so a promoted
  // candidate is no longer "open" when new pairwise changes are considered.
  // We pass the new execution metadata to guarantee fetch independence.
  await maintainOpenCandidates(input, currentSnap, currentPayload);

  // Phase B — pairwise detection between the two newest snapshots creates NEW
  // candidates. 
  // Cache hits are excluded from Phase B to prevent redundant events.
  if (isCacheHit) {
    console.log(
      `${LOG_PREFIX} SCRAPING_SNAPSHOT_REUSED competitorId=${competitorId} campaign=${campaignId} — skipping diff for new candidates`,
    );
    return;
  }

  // Requires a previous snapshot for new diffs.
  if (snapshots.length < 2) {
    console.log(
      `${LOG_PREFIX} FIRST_OBSERVATION competitorId=${competitorId} campaign=${campaignId} snapshotCount=1`,
    );
    return;
  }

  const previousSnap = snapshots[1];
  const previousPayload = safeParsePayload(previousSnap.payload, `snapshot:${previousSnap.id}`);
  if (!previousPayload) {
    console.error(
      `${LOG_PREFIX} COMPETITOR_DIFF_FAILED competitorId=${competitorId} reason=previous_payload_parse_failed previousId=${previousSnap.id}`,
    );
    return;
  }

  // Payload-based classification (sync): posting frequency, patterns, offer language.
  let payloadChanges: WatchtowerChange[];
  try {
    payloadChanges = classifyWatchtowerChanges(
      currentPayload,
      previousPayload,
      currentSnap.id,
      previousSnap.id,
    );
  } catch (err) {
    console.error(
      `${LOG_PREFIX} COMPETITOR_DIFF_FAILED competitorId=${competitorId} reason=classification_threw detail=${(err as Error).message}`,
    );
    return;
  }

  // Semantic classification (async): hook archetype, promise, trigger, positioning,
  // goal, CTA strategy — driven by competitor_post_classifications distributions.
  // Non-blocking: a failure produces [] so the payload-based changes still emit.
  let semanticChanges: WatchtowerChange[] = [];
  if (currentSnap.collectedAt && previousSnap.collectedAt) {
    try {
      semanticChanges = await classifySemanticChanges(
        competitorId,
        previousSnap.collectedAt,
        currentSnap.collectedAt,
        previousSnap.id,
        currentSnap.id,
      );
    } catch (err) {
      console.error(
        `${LOG_PREFIX} SEMANTIC_DIFF_FAILED competitorId=${competitorId} reason=top_level_threw detail=${(err as Error).message}`,
      );
    }
  }

  const changes = [...payloadChanges, ...semanticChanges];

  if (changes.length === 0) {
    console.log(
      `${LOG_PREFIX} NO_CHANGES_DETECTED competitorId=${competitorId} campaign=${campaignId}`,
    );
    return;
  }

  const semanticKinds = semanticChanges.map((c) => c.kind);
  const payloadKinds  = payloadChanges.map((c) => c.kind);
  console.log(
    `${LOG_PREFIX} CHANGES_DETECTED competitorId=${competitorId} campaign=${campaignId} count=${changes.length} payloadKinds=${payloadKinds.join(",") || "none"} semanticKinds=${semanticKinds.join(",") || "none"}`,
  );

  for (const change of changes) {
    await createCandidate(input, change);
  }
}
