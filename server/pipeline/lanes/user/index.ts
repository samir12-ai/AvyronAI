import { newId } from "../../ids";
import { createRun, startRun, finishRun, failRun } from "../../runs";
import { acceptSnapshot, acceptSignal } from "../../validate-and-accept";
import { PipelineValidationError } from "../../errors";
import type { SnapshotContract, SignalContract } from "@shared/contracts";

export interface UserLaneInput {
  accountId: string;
  campaignId: string;
  /**
   * Phase 6.5 — first-class lineage.
   * Required for every collected lane run. Boss Agent must thread this from
   * the CollectorEnvelope it produced. Manual-input runs that don't go
   * through the Collector must mint a synthetic acquisition first.
   */
  acquisitionId: string;
  entityId: string; // e.g. user channel handle
  source: string; // e.g. "manual_input" | "instagram"
  payload: Record<string, unknown>; // arbitrary collected payload
  collectedAt?: string;
  /** Phase 3 — Boss Agent links lane runs to its boss_runs.id via parentRunId. */
  parentRunId?: string;
  /** Phase 3 — when true, Control Layer enforces acquisition_id fresh+known. */
  requireFreshAcquisition?: boolean;
  /** Phase 5 — when set, snapshot/signals carry the eval window anchor. */
  windowId?: string | null;
}

export interface UserLaneResult {
  runId: string;
  snapshotId: string;
  signalIds: string[];
  /** Phase 3 — surfaced for Boss Agent. Mirrors warnings written into run summary. */
  runSummaryWarnings: string[];
}

interface LineageContext {
  accountId: string;
  campaignId: string;
  acquisitionId: string;
  windowId: string | null;
}

/**
 * Deterministic, intelligence-free signal extractor for v1.
 * Looks at common payload fields and emits structured signals.
 */
function extractUserSignals(
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
    lane: "user" as const,
    schema_version: "v1" as const,
  };

  const pains = Array.isArray(payload.pains) ? (payload.pains as unknown[]) : [];
  for (const p of pains) {
    if (typeof p === "string" && p.trim()) {
      out.push({
        ...base,
        signal_id: newId("sig"),
        type: "pain",
        value: p.trim(),
        confidence: 0.6,
        evidence: ["payload.pains"],
      });
    }
  }

  const desires = Array.isArray(payload.desires) ? (payload.desires as unknown[]) : [];
  for (const d of desires) {
    if (typeof d === "string" && d.trim()) {
      out.push({
        ...base,
        signal_id: newId("sig"),
        type: "desire",
        value: d.trim(),
        confidence: 0.6,
        evidence: ["payload.desires"],
      });
    }
  }

  const metrics = (payload.metrics ?? {}) as Record<string, unknown>;
  for (const [key, val] of Object.entries(metrics)) {
    if (typeof val === "number") {
      out.push({
        ...base,
        signal_id: newId("sig"),
        type: "metric",
        value: `${key}=${val}`,
        confidence: 1,
        evidence: [`payload.metrics.${key}`],
      });
    }
  }

  return out;
}

export async function runUserLane(input: UserLaneInput): Promise<UserLaneResult> {
  if (!input.accountId) throw new PipelineValidationError("MISSING_ACCOUNT_ID", "user lane requires accountId");
  if (!input.campaignId) throw new PipelineValidationError("MISSING_CAMPAIGN_ID", "user lane requires campaignId");
  if (!input.acquisitionId) throw new PipelineValidationError("MISSING_ACQUISITION_ID", "user lane requires acquisitionId (first-class lineage)");

  const run = await createRun({
    accountId: input.accountId,
    campaignId: input.campaignId,
    lane: "user",
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
      entity_type: input.source === "manual_input" ? "manual_input" : "user_channel",
      lane: "user",
      source: input.source,
      collected_at: input.collectedAt ?? new Date().toISOString(),
      payload: input.payload,
      schema_version: "v1",
    };
    const persistedSnap = await acceptSnapshot(snapshot, {
      callerLane: "user",
      requireFreshAcquisition: input.requireFreshAcquisition,
    });

    const signals = extractUserSignals(run.id, persistedSnap.id, input.payload, lineage);
    const signalIds: string[] = [];
    for (const s of signals) {
      const persisted = await acceptSignal(s, { callerLane: "user" });
      signalIds.push(persisted.id);
    }

    // Phase 1.6 — F3: surface a warning when a run validates with zero signals
    // so downstream consumers (and the dashboard) can see "validated but empty"
    // instead of mistaking it for a healthy run.
    const warnings: string[] = [];
    if (signalIds.length === 0) {
      warnings.push("no_signals_extracted");
    }

    await finishRun(
      run.id,
      JSON.stringify({
        snapshotId: persistedSnap.id,
        signalCount: signalIds.length,
        warnings,
      }),
    );

    return { runId: run.id, snapshotId: persistedSnap.id, signalIds, runSummaryWarnings: warnings };
  } catch (err) {
    const reason = err instanceof PipelineValidationError ? err.message : (err as Error).message;
    await failRun(run.id, reason).catch(() => {});
    throw err;
  }
}
