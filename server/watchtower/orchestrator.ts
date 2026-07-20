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
 *   - Snapshot reuse (isCacheHit=true) does NOT count as a fresh fetch.
 *   - Two-fetch gate: a candidate (validated_at=null) is promoted ONLY when a
 *     LATER independent fresh fetch re-detects the same kind of change against
 *     the candidate's ORIGINAL BASELINE snapshot. Because every fresh fetch
 *     appends a new snapshot, comparing only the newest consecutive pair would
 *     make promotion unreachable for a persisting change (the persisted state
 *     diffs clean against itself). Confirmation therefore re-classifies
 *     current-state vs candidate-baseline.
 *   - Same-snapshot re-execution NEVER confirms: the confirming snapshot ID
 *     must differ from the candidate's original current_snapshot_id.
 *   - Reversion before confirmation NEVER promotes: if the current state no
 *     longer differs from the candidate's baseline (or a frequency shift
 *     flipped direction), the candidate is closed (deleted with a log line),
 *     mirroring the INVARIANT-RETRY claim-row deletion pattern.
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
import { pipelineSnapshots, pipelineChangeEvents } from "@shared/schema";
import { and, eq, isNull, isNotNull, desc } from "drizzle-orm";

const LOG_PREFIX = "[Watchtower]";

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

  return changes;
}

// ── Phase A: candidate maintenance (promotion / reversion) ───────────────────

const CANDIDATE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

interface OpenCandidateRow {
  id: string;
  kind: string | null;
  baselineSnapshotId: string | null;
  currentSnapshotId: string | null;
  evidence: string | null;
  createdAt: Date | null;
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
  currentSnap: { id: string },
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
      })
      .from(pipelineChangeEvents)
      .where(
        and(
          eq(pipelineChangeEvents.competitorId, competitorId),
          eq(pipelineChangeEvents.campaignId, campaignId),
          isNotNull(pipelineChangeEvents.kind),
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
      await closeCandidate(candidate.id, candidate.kind, competitorId, "expired_unconfirmed_30d");
      continue;
    }

    // Independence: the confirming observation must come from a NEWER snapshot
    // than the one that created the candidate. Re-running over the same
    // snapshot is not a second fetch (W-1 §D).
    if (candidate.currentSnapshotId === currentSnap.id) {
      console.log(
        `${LOG_PREFIX} CANDIDATE_SAME_SNAPSHOT_SKIPPED eventId=${candidate.id} kind=${candidate.kind} snapshotId=${currentSnap.id}`,
      );
      continue;
    }

    // Load the candidate's original baseline snapshot.
    let baselineRow: { id: string; payload: string | null } | undefined;
    try {
      [baselineRow] = await db
        .select({ id: pipelineSnapshots.id, payload: pipelineSnapshots.payload })
        .from(pipelineSnapshots)
        .where(eq(pipelineSnapshots.id, candidate.baselineSnapshotId))
        .limit(1);
    } catch (err) {
      console.error(
        `${LOG_PREFIX} MARKET_EVENT_PERSIST_FAILED eventId=${candidate.id} reason=baseline_load_failed detail=${(err as Error).message}`,
      );
      continue;
    }

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

    let vsBaseline: WatchtowerChange[];
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

    const match = vsBaseline.find((c) => c.kind === candidate.kind);

    if (!match) {
      // State reverted to baseline before confirmation → close, never promote.
      await closeCandidate(candidate.id, candidate.kind, competitorId, "reverted_to_baseline");
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
        await closeCandidate(candidate.id, candidate.kind, competitorId, "direction_flipped");
        continue;
      }
    }

    // Promote: two independent fresh fetches agree the change persists vs the
    // original baseline. Evidence/severity refreshed to the confirmed state.
    try {
      const confirmedEvidence: WatchtowerEvidence = {
        notes: match.evidence,
        prev: match.prevValue,
        curr: match.currValue,
        confirmedBySnapshotId: currentSnap.id,
      };
      await db
        .update(pipelineChangeEvents)
        .set({
          validatedAt: new Date(),
          severity: match.severity,
          evidence: JSON.stringify(confirmedEvidence),
          currentSnapshotId: currentSnap.id,
        })
        .where(and(eq(pipelineChangeEvents.id, candidate.id), isNull(pipelineChangeEvents.validatedAt)));
      console.log(
        `${LOG_PREFIX} MARKET_EVENT_CONFIRMED eventId=${candidate.id} competitorId=${competitorId} kind=${candidate.kind} campaign=${input.campaignId} confirmedBy=${currentSnap.id}`,
      );
    } catch (err) {
      console.error(
        `${LOG_PREFIX} MARKET_EVENT_PERSIST_FAILED eventId=${candidate.id} reason=confirmation_update_failed detail=${(err as Error).message}`,
      );
    }
  }
}

async function closeCandidate(
  eventId: string,
  kind: string,
  competitorId: string,
  reason: string,
): Promise<void> {
  try {
    await db
      .delete(pipelineChangeEvents)
      .where(and(eq(pipelineChangeEvents.id, eventId), isNull(pipelineChangeEvents.validatedAt)));
    console.log(
      `${LOG_PREFIX} MARKET_EVENT_CANDIDATE_CLOSED eventId=${eventId} kind=${kind} competitorId=${competitorId} reason=${reason}`,
    );
  } catch (err) {
    console.error(
      `${LOG_PREFIX} MARKET_EVENT_PERSIST_FAILED eventId=${eventId} reason=candidate_close_failed detail=${(err as Error).message}`,
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

  // Snapshot reuse does not count as an independent observation (W-1 §D).
  if (isCacheHit) {
    console.log(
      `${LOG_PREFIX} SCRAPING_SNAPSHOT_REUSED competitorId=${competitorId} campaign=${campaignId} — skipping diff`,
    );
    return;
  }

  // Load the two most recent pipeline_snapshots for this competitor.
  let snapshots: Array<{ id: string; payload: string | null; createdAt: Date | null }>;
  try {
    snapshots = await db
      .select({
        id: pipelineSnapshots.id,
        payload: pipelineSnapshots.payload,
        createdAt: pipelineSnapshots.createdAt,
      })
      .from(pipelineSnapshots)
      .where(
        and(
          eq(pipelineSnapshots.entityId, competitorId),
          eq(pipelineSnapshots.campaignId, campaignId),
          eq(pipelineSnapshots.lane, "competitor"),
        ),
      )
      .orderBy(desc(pipelineSnapshots.createdAt))
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
  await maintainOpenCandidates(input, currentSnap, currentPayload);

  // Phase B — pairwise detection between the two newest snapshots creates NEW
  // candidates. Requires a previous snapshot.
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

  let changes: WatchtowerChange[];
  try {
    changes = classifyWatchtowerChanges(
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

  if (changes.length === 0) {
    console.log(
      `${LOG_PREFIX} NO_CHANGES_DETECTED competitorId=${competitorId} campaign=${campaignId}`,
    );
    return;
  }

  console.log(
    `${LOG_PREFIX} CHANGES_DETECTED competitorId=${competitorId} campaign=${campaignId} count=${changes.length} kinds=${changes.map((c) => c.kind).join(",")}`,
  );

  for (const change of changes) {
    await createCandidate(input, change);
  }
}
