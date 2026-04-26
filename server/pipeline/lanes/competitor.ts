import { newId } from "../ids";
import { createRun, startRun, finishRun, failRun } from "../runs";
import { acceptSnapshot, acceptSignal, acceptChangeEvent } from "../validate-and-accept";
import { PipelineValidationError } from "../errors";
import { readSnapshotByIdOrReject } from "../readers";
import type { SnapshotContract, SignalContract, ChangeEventContract } from "@shared/contracts";

export interface CompetitorLaneInput {
  accountId: string;
  campaignId: string;
  /** Phase 6.5 — first-class lineage. Required. */
  acquisitionId: string;
  entityId: string; // competitor handle / id
  source: string;
  payload: Record<string, unknown>;
  collectedAt?: string;
  baselineSnapshotId?: string; // optional, for change detection
  /** Phase 3 — Boss Agent links lane runs to its boss_runs.id via parentRunId. */
  parentRunId?: string;
  /** Phase 3 — when true, Control Layer enforces acquisition_id fresh+known. */
  requireFreshAcquisition?: boolean;
  /** Phase 5 — when set, snapshot/signals/change-events carry the eval window anchor. */
  windowId?: string | null;
}

export interface CompetitorLaneResult {
  runId: string;
  snapshotId: string;
  signalIds: string[];
  changeEventIds: string[];
  /** Phase 3 — surfaced for Boss Agent. Mirrors warnings written into run summary. */
  runSummaryWarnings: string[];
}

interface LineageContext {
  accountId: string;
  campaignId: string;
  acquisitionId: string;
  windowId: string | null;
}

function extractCompetitorSignals(
  runId: string,
  snapshotId: string,
  payload: Record<string, unknown>,
  lineage: LineageContext,
): SignalContract[] {
  const out: SignalContract[] = [];
  const base = {
    run_id: runId,
    account_id: lineage.accountId,
    campaign_id: lineage.campaignId,
    acquisition_id: lineage.acquisitionId,
    window_id: lineage.windowId,
    source_snapshot_id: snapshotId,
    lane: "competitor" as const,
    schema_version: "v1" as const,
  };

  const patterns = Array.isArray(payload.patterns) ? (payload.patterns as unknown[]) : [];
  for (const p of patterns) {
    if (typeof p === "string" && p.trim()) {
      out.push({
        ...base,
        signal_id: newId("sig"),
        type: "pattern",
        value: p.trim(),
        confidence: 0.55,
        evidence: ["payload.patterns"],
      });
    }
  }
  const objections = Array.isArray(payload.objections) ? (payload.objections as unknown[]) : [];
  for (const o of objections) {
    if (typeof o === "string" && o.trim()) {
      out.push({
        ...base,
        signal_id: newId("sig"),
        type: "objection",
        value: o.trim(),
        confidence: 0.5,
        evidence: ["payload.objections"],
      });
    }
  }
  return out;
}

/**
 * Diff hygiene only (Phase 1.6 — F1).
 * Normalizes string-array fields so cosmetic differences (case, whitespace, ordering)
 * do NOT register as content shifts. This is NOT scoring or interpretation —
 * it is making the equality check stable.
 */
function normalizeStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const cleaned = input
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.trim().toLowerCase())
    .filter((x) => x.length > 0);
  return Array.from(new Set(cleaned)).sort();
}

function detectChange(baselinePayloadJson: string, currentPayload: Record<string, unknown>): { dimension: ChangeEventContract["change_dimension"]; severity: ChangeEventContract["severity"]; evidence: string[] } | null {
  try {
    const base = JSON.parse(baselinePayloadJson) as Record<string, unknown>;
    const evidence: string[] = [];
    let dimension: ChangeEventContract["change_dimension"] = "other";

    const basePatterns = normalizeStringArray(base.patterns);
    const currPatterns = normalizeStringArray(currentPayload.patterns);
    const patternsChanged =
      basePatterns.length !== currPatterns.length ||
      basePatterns.some((v, i) => v !== currPatterns[i]);
    if (patternsChanged) {
      evidence.push(`patterns changed: ${JSON.stringify(basePatterns)} -> ${JSON.stringify(currPatterns)}`);
      dimension = "content";
    }

    const baseFreq = (base.frequency as number) ?? null;
    const currFreq = (currentPayload.frequency as number) ?? null;
    if (baseFreq !== null && currFreq !== null && baseFreq !== currFreq) {
      evidence.push(`frequency: ${baseFreq} -> ${currFreq}`);
      dimension = dimension === "other" ? "frequency" : dimension;
    }

    if (evidence.length === 0) return null;

    // Length-based bucketing only (still no magnitude scoring — that's deferred per blueprint §9).
    const severity: ChangeEventContract["severity"] = evidence.length >= 2 ? "major" : evidence.length === 1 ? "medium" : "mild";
    return { dimension, severity, evidence };
  } catch {
    return null;
  }
}

export async function runCompetitorLane(input: CompetitorLaneInput): Promise<CompetitorLaneResult> {
  if (!input.accountId) throw new PipelineValidationError("MISSING_ACCOUNT_ID", "competitor lane requires accountId");
  if (!input.campaignId) throw new PipelineValidationError("MISSING_CAMPAIGN_ID", "competitor lane requires campaignId");
  if (!input.acquisitionId) throw new PipelineValidationError("MISSING_ACQUISITION_ID", "competitor lane requires acquisitionId (first-class lineage)");

  const run = await createRun({
    accountId: input.accountId,
    campaignId: input.campaignId,
    lane: "competitor",
    trigger: "manual",
    parentRunId: input.parentRunId,
  });

  try {
    await startRun(run.id);

    const lineage: LineageContext = {
      accountId: input.accountId,
      campaignId: input.campaignId,
      acquisitionId: input.acquisitionId,
      windowId: input.windowId ?? null,
    };

    const snapshot: SnapshotContract = {
      snapshot_id: newId("snap"),
      run_id: run.id,
      account_id: lineage.accountId,
      campaign_id: lineage.campaignId,
      acquisition_id: lineage.acquisitionId,
      window_id: lineage.windowId,
      entity_id: input.entityId,
      entity_type: "competitor_channel",
      lane: "competitor",
      source: input.source,
      collected_at: input.collectedAt ?? new Date().toISOString(),
      payload: input.payload,
      schema_version: "v1",
    };
    const persistedSnap = await acceptSnapshot(snapshot, {
      callerLane: "competitor",
      requireFreshAcquisition: input.requireFreshAcquisition,
    });

    const signals = extractCompetitorSignals(run.id, persistedSnap.id, input.payload, lineage);
    const signalIds: string[] = [];
    for (const s of signals) {
      const persisted = await acceptSignal(s, { callerLane: "competitor" });
      signalIds.push(persisted.id);
    }

    const changeEventIds: string[] = [];
    if (input.baselineSnapshotId) {
      // Phase 6.5 — guarded read with explicit campaign binding. The reader
      // hard-rejects + records a rejection row on cross-campaign baselines
      // and on missing lineage; we still classify lane mismatch locally so
      // the existing BASELINE_WRONG_LANE code is preserved.
      let baseline;
      try {
        const v = await readSnapshotByIdOrReject(input.baselineSnapshotId, {
          accountId: lineage.accountId,
          campaignId: lineage.campaignId,
        });
        baseline = v.row;
      } catch (err) {
        if (err instanceof PipelineValidationError && err.code === "ROW_NOT_FOUND") {
          throw new PipelineValidationError("BASELINE_NOT_FOUND", `baseline snapshot ${input.baselineSnapshotId} not found`, {});
        }
        throw err;
      }
      if (baseline.lane !== "competitor") {
        throw new PipelineValidationError("BASELINE_WRONG_LANE", `baseline lane=${baseline.lane}`, {});
      }
      const change = detectChange(baseline.payload, input.payload);
      if (change) {
        const event: ChangeEventContract = {
          change_event_id: newId("chg"),
          run_id: run.id,
          account_id: lineage.accountId,
          campaign_id: lineage.campaignId,
          acquisition_id: lineage.acquisitionId,
          window_id: lineage.windowId,
          baseline_snapshot_id: baseline.id,
          current_snapshot_id: persistedSnap.id,
          change_dimension: change.dimension,
          severity: change.severity,
          evidence: change.evidence,
          schema_version: "v1",
        };
        const persisted = await acceptChangeEvent(event, { callerLane: "competitor" });
        changeEventIds.push(persisted.id);
      }
    }

    // Phase 1.6 — F3 parity for competitor lane.
    const warnings: string[] = [];
    if (signalIds.length === 0) {
      warnings.push("no_signals_extracted");
    }

    await finishRun(
      run.id,
      JSON.stringify({
        snapshotId: persistedSnap.id,
        signalCount: signalIds.length,
        changeEventCount: changeEventIds.length,
        warnings,
      }),
    );

    return { runId: run.id, snapshotId: persistedSnap.id, signalIds, changeEventIds, runSummaryWarnings: warnings };
  } catch (err) {
    const reason = err instanceof PipelineValidationError ? err.message : (err as Error).message;
    await failRun(run.id, reason).catch(() => {});
    throw err;
  }
}
