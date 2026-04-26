/**
 * Phase 6.5 — Integrity Engineering canonical readers.
 *
 * Locked by Samir 2026-04-20:
 *   Every read of pipeline_runs / pipeline_snapshots / pipeline_signals /
 *   pipeline_change_events / pipeline_acquisitions in business logic MUST go
 *   through this module.
 *
 *   Each reader:
 *     1. Loads the row(s).
 *     2. Reconstructs the canonical contract shape from DB columns + payload.
 *     3. Parses through the canonical Zod schema.
 *     4. Asserts lineage presence (account_id, campaign_id, and acquisition_id
 *        on collected lanes; derived_from_signal_id on bridge signals).
 *     5. Asserts lineage matches the caller's expected (account, campaign).
 *
 *   On any failure: hard-reject with a structured PipelineValidationError
 *   AND record a row in pipeline_rejections so the violation is visible.
 *   No silent skip. No fallback. No partial accept. No try/catch → {}.
 */
import { db } from "../db";
import {
  pipelineSnapshots,
  pipelineSignals,
  pipelineChangeEvents,
  pipelineAcquisitions,
  type PipelineSnapshot,
  type PipelineSignal,
  type PipelineChangeEvent,
  type PipelineAcquisition,
} from "@shared/schema";
import { and, eq } from "drizzle-orm";
import {
  SnapshotContractSchema,
  SignalContractSchema,
  ChangeEventContractSchema,
  type SnapshotContract,
  type SignalContract,
  type ChangeEventContract,
  type Lane,
} from "@shared/contracts";
import { PipelineValidationError } from "./errors";
import { recordRejection } from "./rejection-log";

export interface LineageExpectation {
  accountId?: string;
  campaignId?: string;
  /** Optional run binding — when set, every row.runId must match. */
  runId?: string;
  /** Optional lane binding — when set, every row.lane must match. */
  lane?: Lane;
}

/**
 * Strict JSON parse. No fallback. No coercion. Throws structurally so the
 * caller surfaces it as PAYLOAD_INVALID_JSON.
 */
function strictJsonParse(raw: string | null | undefined, label: string): unknown {
  if (raw === null || raw === undefined || raw === "") {
    throw new Error(`${label}: empty`);
  }
  return JSON.parse(raw);
}

async function reject(
  table: string,
  rowId: string | null,
  reasonCode: string,
  reasonDetail: string,
  expected: LineageExpectation | undefined,
  observed: { accountId?: string | null; campaignId?: string | null; runId?: string | null; lane?: string | null },
  extra?: Record<string, unknown>,
): Promise<never> {
  await recordRejection({
    boundary: "reader",
    tableName: table,
    rowId,
    runId: observed.runId ?? expected?.runId ?? null,
    accountId: observed.accountId ?? expected?.accountId ?? null,
    campaignId: observed.campaignId ?? expected?.campaignId ?? null,
    lane: observed.lane ?? expected?.lane ?? null,
    reasonCode,
    reasonDetail,
    context: { expected: expected ?? null, observed, ...(extra ?? {}) },
  });
  throw new PipelineValidationError(reasonCode, reasonDetail, {
    table,
    rowId,
    expected,
    observed,
    ...(extra ?? {}),
  });
}

// ─── Snapshot reader ────────────────────────────────────────────────

export async function snapshotRowToContract(
  row: PipelineSnapshot,
  expected?: LineageExpectation,
): Promise<SnapshotContract> {
  // Lineage presence (post-Batch-3 doctrine: hard-reject any NULL).
  if (!row.accountId) {
    return reject("pipeline_snapshots", row.id, "LINEAGE_MISSING_ACCOUNT",
      `snapshot ${row.id} missing account_id`, expected,
      { runId: row.runId, lane: row.lane });
  }
  if (!row.campaignId) {
    return reject("pipeline_snapshots", row.id, "LINEAGE_MISSING_CAMPAIGN",
      `snapshot ${row.id} missing campaign_id`, expected,
      { runId: row.runId, accountId: row.accountId, lane: row.lane });
  }
  if ((row.lane === "user" || row.lane === "competitor") && !row.acquisitionId) {
    return reject("pipeline_snapshots", row.id, "LINEAGE_MISSING_ACQUISITION",
      `snapshot ${row.id} on lane=${row.lane} missing acquisition_id`, expected,
      { runId: row.runId, accountId: row.accountId, campaignId: row.campaignId, lane: row.lane });
  }
  // Caller-binding checks.
  if (expected?.accountId && expected.accountId !== row.accountId) {
    return reject("pipeline_snapshots", row.id, "LINEAGE_ACCOUNT_MISMATCH",
      `snapshot ${row.id} account_id=${row.accountId} != expected ${expected.accountId}`, expected,
      { runId: row.runId, accountId: row.accountId, campaignId: row.campaignId, lane: row.lane });
  }
  if (expected?.campaignId && expected.campaignId !== row.campaignId) {
    return reject("pipeline_snapshots", row.id, "LINEAGE_CAMPAIGN_MISMATCH",
      `snapshot ${row.id} campaign_id=${row.campaignId} != expected ${expected.campaignId}`, expected,
      { runId: row.runId, accountId: row.accountId, campaignId: row.campaignId, lane: row.lane });
  }
  if (expected?.runId && expected.runId !== row.runId) {
    return reject("pipeline_snapshots", row.id, "LINEAGE_RUN_MISMATCH",
      `snapshot ${row.id} run_id=${row.runId} != expected ${expected.runId}`, expected,
      { runId: row.runId, accountId: row.accountId, campaignId: row.campaignId, lane: row.lane });
  }
  if (expected?.lane && expected.lane !== row.lane) {
    return reject("pipeline_snapshots", row.id, "LINEAGE_LANE_MISMATCH",
      `snapshot ${row.id} lane=${row.lane} != expected ${expected.lane}`, expected,
      { runId: row.runId, accountId: row.accountId, campaignId: row.campaignId, lane: row.lane });
  }

  // Reconstruct contract and parse strictly.
  let payload: unknown;
  try {
    payload = strictJsonParse(row.payload, "snapshot.payload");
  } catch (err) {
    return reject("pipeline_snapshots", row.id, "PAYLOAD_INVALID_JSON",
      `snapshot ${row.id} payload is not valid JSON`, expected,
      { runId: row.runId, accountId: row.accountId, campaignId: row.campaignId, lane: row.lane },
      { jsonError: (err as Error).message });
  }

  const contract = {
    snapshot_id: row.id,
    run_id: row.runId,
    account_id: row.accountId,
    campaign_id: row.campaignId,
    acquisition_id: row.acquisitionId ?? null,
    window_id: row.windowId ?? null,
    entity_id: row.entityId,
    entity_type: row.entityType,
    lane: row.lane,
    source: row.source,
    collected_at: (row.collectedAt instanceof Date ? row.collectedAt : new Date(row.collectedAt as unknown as string)).toISOString(),
    payload: payload as Record<string, unknown>,
    schema_version: row.schemaVersion,
  };
  const parsed = SnapshotContractSchema.safeParse(contract);
  if (!parsed.success) {
    return reject("pipeline_snapshots", row.id, "CONTRACT_SHAPE_INVALID",
      `snapshot ${row.id} fails canonical schema`, expected,
      { runId: row.runId, accountId: row.accountId, campaignId: row.campaignId, lane: row.lane },
      { issues: parsed.error.issues });
  }
  return parsed.data;
}

export async function readSnapshotByIdOrReject(
  id: string,
  expected?: LineageExpectation,
): Promise<{ row: PipelineSnapshot; contract: SnapshotContract }> {
  const [row] = await db.select().from(pipelineSnapshots).where(eq(pipelineSnapshots.id, id)).limit(1);
  if (!row) {
    await recordRejection({
      boundary: "reader", tableName: "pipeline_snapshots", rowId: id,
      runId: expected?.runId ?? null, accountId: expected?.accountId ?? null,
      campaignId: expected?.campaignId ?? null, lane: expected?.lane ?? null,
      reasonCode: "ROW_NOT_FOUND", reasonDetail: `snapshot ${id} not found`,
      context: { expected: expected ?? null },
    });
    throw new PipelineValidationError("ROW_NOT_FOUND", `snapshot ${id} not found`, { id, expected });
  }
  const contract = await snapshotRowToContract(row, expected);
  return { row, contract };
}

export async function readSnapshotsForRun(
  runId: string,
  expected?: LineageExpectation,
): Promise<Array<{ row: PipelineSnapshot; contract: SnapshotContract }>> {
  const rows = await db.select().from(pipelineSnapshots).where(eq(pipelineSnapshots.runId, runId));
  const out = [];
  for (const row of rows) {
    const contract = await snapshotRowToContract(row, { ...expected, runId });
    out.push({ row, contract });
  }
  return out;
}

// ─── Signal reader ──────────────────────────────────────────────────

export async function signalRowToContract(
  row: PipelineSignal,
  expected?: LineageExpectation,
): Promise<SignalContract> {
  if (!row.accountId) {
    return reject("pipeline_signals", row.id, "LINEAGE_MISSING_ACCOUNT",
      `signal ${row.id} missing account_id`, expected,
      { runId: row.runId, lane: row.lane });
  }
  if (!row.campaignId) {
    return reject("pipeline_signals", row.id, "LINEAGE_MISSING_CAMPAIGN",
      `signal ${row.id} missing campaign_id`, expected,
      { runId: row.runId, accountId: row.accountId, lane: row.lane });
  }
  if ((row.lane === "user" || row.lane === "competitor") && !row.acquisitionId) {
    return reject("pipeline_signals", row.id, "LINEAGE_MISSING_ACQUISITION",
      `signal ${row.id} on lane=${row.lane} missing acquisition_id`, expected,
      { runId: row.runId, accountId: row.accountId, campaignId: row.campaignId, lane: row.lane });
  }
  if (row.lane === "bridge" && !row.derivedFromSignalId) {
    return reject("pipeline_signals", row.id, "LINEAGE_MISSING_DERIVED_FROM",
      `bridge signal ${row.id} missing derived_from_signal_id`, expected,
      { runId: row.runId, accountId: row.accountId, campaignId: row.campaignId, lane: row.lane });
  }
  if (expected?.accountId && expected.accountId !== row.accountId) {
    return reject("pipeline_signals", row.id, "LINEAGE_ACCOUNT_MISMATCH",
      `signal ${row.id} account_id=${row.accountId} != expected ${expected.accountId}`, expected,
      { runId: row.runId, accountId: row.accountId, campaignId: row.campaignId, lane: row.lane });
  }
  if (expected?.campaignId && expected.campaignId !== row.campaignId) {
    return reject("pipeline_signals", row.id, "LINEAGE_CAMPAIGN_MISMATCH",
      `signal ${row.id} campaign_id=${row.campaignId} != expected ${expected.campaignId}`, expected,
      { runId: row.runId, accountId: row.accountId, campaignId: row.campaignId, lane: row.lane });
  }
  if (expected?.runId && expected.runId !== row.runId) {
    return reject("pipeline_signals", row.id, "LINEAGE_RUN_MISMATCH",
      `signal ${row.id} run_id=${row.runId} != expected ${expected.runId}`, expected,
      { runId: row.runId, accountId: row.accountId, campaignId: row.campaignId, lane: row.lane });
  }
  if (expected?.lane && expected.lane !== row.lane) {
    return reject("pipeline_signals", row.id, "LINEAGE_LANE_MISMATCH",
      `signal ${row.id} lane=${row.lane} != expected ${expected.lane}`, expected,
      { runId: row.runId, accountId: row.accountId, campaignId: row.campaignId, lane: row.lane });
  }

  let evidence: unknown;
  try {
    evidence = strictJsonParse(row.evidence ?? "[]", "signal.evidence");
  } catch (err) {
    return reject("pipeline_signals", row.id, "PAYLOAD_INVALID_JSON",
      `signal ${row.id} evidence is not valid JSON`, expected,
      { runId: row.runId, accountId: row.accountId, campaignId: row.campaignId, lane: row.lane },
      { jsonError: (err as Error).message });
  }

  const contract = {
    signal_id: row.id,
    run_id: row.runId,
    account_id: row.accountId,
    campaign_id: row.campaignId,
    acquisition_id: row.acquisitionId ?? null,
    window_id: row.windowId ?? null,
    derived_from_signal_id: row.derivedFromSignalId ?? null,
    source_snapshot_id: row.sourceSnapshotId,
    lane: row.lane,
    type: row.type,
    value: row.value,
    confidence: row.confidence,
    evidence: evidence as string[],
    schema_version: row.schemaVersion,
  };
  const parsed = SignalContractSchema.safeParse(contract);
  if (!parsed.success) {
    return reject("pipeline_signals", row.id, "CONTRACT_SHAPE_INVALID",
      `signal ${row.id} fails canonical schema`, expected,
      { runId: row.runId, accountId: row.accountId, campaignId: row.campaignId, lane: row.lane },
      { issues: parsed.error.issues });
  }
  return parsed.data;
}

export async function readSignalsForRun(
  runId: string,
  expected?: LineageExpectation,
): Promise<Array<{ row: PipelineSignal; contract: SignalContract }>> {
  const rows = await db.select().from(pipelineSignals).where(eq(pipelineSignals.runId, runId));
  const out = [];
  for (const row of rows) {
    const contract = await signalRowToContract(row, { ...expected, runId });
    out.push({ row, contract });
  }
  return out;
}

export async function readSignalsForRunAndLane(
  runId: string,
  lane: Lane,
  expected: { accountId: string; campaignId: string },
): Promise<Array<{ row: PipelineSignal; contract: SignalContract }>> {
  const rows = await db
    .select()
    .from(pipelineSignals)
    .where(
      and(
        eq(pipelineSignals.runId, runId),
        eq(pipelineSignals.lane, lane),
        eq(pipelineSignals.accountId, expected.accountId),
        eq(pipelineSignals.campaignId, expected.campaignId),
      ),
    );
  const out = [];
  for (const row of rows) {
    const contract = await signalRowToContract(row, { ...expected, runId, lane });
    out.push({ row, contract });
  }
  return out;
}

// ─── Change-event reader ────────────────────────────────────────────

export async function changeEventRowToContract(
  row: PipelineChangeEvent,
  expected?: LineageExpectation,
): Promise<ChangeEventContract> {
  if (!row.accountId) {
    return reject("pipeline_change_events", row.id, "LINEAGE_MISSING_ACCOUNT",
      `change_event ${row.id} missing account_id`, expected, { runId: row.runId });
  }
  if (!row.campaignId) {
    return reject("pipeline_change_events", row.id, "LINEAGE_MISSING_CAMPAIGN",
      `change_event ${row.id} missing campaign_id`, expected, { runId: row.runId, accountId: row.accountId });
  }
  if (!row.acquisitionId) {
    return reject("pipeline_change_events", row.id, "LINEAGE_MISSING_ACQUISITION",
      `change_event ${row.id} missing acquisition_id (always required for change events)`, expected,
      { runId: row.runId, accountId: row.accountId, campaignId: row.campaignId });
  }
  if (expected?.accountId && expected.accountId !== row.accountId) {
    return reject("pipeline_change_events", row.id, "LINEAGE_ACCOUNT_MISMATCH",
      `change_event ${row.id} account_id=${row.accountId} != expected ${expected.accountId}`, expected,
      { runId: row.runId, accountId: row.accountId, campaignId: row.campaignId });
  }
  if (expected?.campaignId && expected.campaignId !== row.campaignId) {
    return reject("pipeline_change_events", row.id, "LINEAGE_CAMPAIGN_MISMATCH",
      `change_event ${row.id} campaign_id=${row.campaignId} != expected ${expected.campaignId}`, expected,
      { runId: row.runId, accountId: row.accountId, campaignId: row.campaignId });
  }
  if (expected?.runId && expected.runId !== row.runId) {
    return reject("pipeline_change_events", row.id, "LINEAGE_RUN_MISMATCH",
      `change_event ${row.id} run_id=${row.runId} != expected ${expected.runId}`, expected,
      { runId: row.runId, accountId: row.accountId, campaignId: row.campaignId });
  }

  let evidence: unknown;
  try {
    evidence = strictJsonParse(row.evidence ?? "[]", "change_event.evidence");
  } catch (err) {
    return reject("pipeline_change_events", row.id, "PAYLOAD_INVALID_JSON",
      `change_event ${row.id} evidence is not valid JSON`, expected,
      { runId: row.runId, accountId: row.accountId, campaignId: row.campaignId },
      { jsonError: (err as Error).message });
  }

  const contract = {
    change_event_id: row.id,
    run_id: row.runId,
    account_id: row.accountId,
    campaign_id: row.campaignId,
    acquisition_id: row.acquisitionId,
    window_id: row.windowId ?? null,
    baseline_snapshot_id: row.baselineSnapshotId,
    current_snapshot_id: row.currentSnapshotId,
    change_dimension: row.changeDimension,
    severity: row.severity,
    evidence: evidence as string[],
    schema_version: row.schemaVersion,
  };
  const parsed = ChangeEventContractSchema.safeParse(contract);
  if (!parsed.success) {
    return reject("pipeline_change_events", row.id, "CONTRACT_SHAPE_INVALID",
      `change_event ${row.id} fails canonical schema`, expected,
      { runId: row.runId, accountId: row.accountId, campaignId: row.campaignId },
      { issues: parsed.error.issues });
  }
  return parsed.data;
}

export async function readChangeEventsForRun(
  runId: string,
  expected?: LineageExpectation,
): Promise<Array<{ row: PipelineChangeEvent; contract: ChangeEventContract }>> {
  const rows = await db.select().from(pipelineChangeEvents).where(eq(pipelineChangeEvents.runId, runId));
  const out = [];
  for (const row of rows) {
    const contract = await changeEventRowToContract(row, { ...expected, runId });
    out.push({ row, contract });
  }
  return out;
}

export async function readChangeEventsForRunAndCampaign(
  runId: string,
  expected: { accountId: string; campaignId: string },
): Promise<Array<{ row: PipelineChangeEvent; contract: ChangeEventContract }>> {
  const rows = await db
    .select()
    .from(pipelineChangeEvents)
    .where(
      and(
        eq(pipelineChangeEvents.runId, runId),
        eq(pipelineChangeEvents.accountId, expected.accountId),
        eq(pipelineChangeEvents.campaignId, expected.campaignId),
      ),
    );
  const out = [];
  for (const row of rows) {
    const contract = await changeEventRowToContract(row, { ...expected, runId });
    out.push({ row, contract });
  }
  return out;
}

// ─── Acquisition reader (strict JSON, no fallback) ──────────────────

export interface AcquisitionView {
  row: PipelineAcquisition;
  payload: Record<string, unknown>;
  provenance: Record<string, unknown>;
}

export async function readAcquisitionByIdOrReject(
  id: string,
  expected?: { accountId?: string; campaignId?: string },
): Promise<AcquisitionView> {
  const [row] = await db.select().from(pipelineAcquisitions).where(eq(pipelineAcquisitions.id, id)).limit(1);
  if (!row) {
    await recordRejection({
      boundary: "reader", tableName: "pipeline_acquisitions", rowId: id,
      reasonCode: "ROW_NOT_FOUND", reasonDetail: `acquisition ${id} not found`,
      accountId: expected?.accountId ?? null, campaignId: expected?.campaignId ?? null,
      context: { expected: expected ?? null },
    });
    throw new PipelineValidationError("ROW_NOT_FOUND", `acquisition ${id} not found`, { id });
  }
  if (expected?.accountId && expected.accountId !== row.accountId) {
    await recordRejection({
      boundary: "reader", tableName: "pipeline_acquisitions", rowId: id,
      reasonCode: "LINEAGE_ACCOUNT_MISMATCH",
      reasonDetail: `acquisition ${id} account_id=${row.accountId} != expected ${expected.accountId}`,
      accountId: row.accountId, campaignId: row.campaignId, lane: row.lane,
      context: { expected, observed: { accountId: row.accountId, campaignId: row.campaignId } },
    });
    throw new PipelineValidationError("LINEAGE_ACCOUNT_MISMATCH",
      `acquisition ${id} account_id=${row.accountId} != expected ${expected.accountId}`,
      { id, expected });
  }
  if (expected?.campaignId && expected.campaignId !== row.campaignId) {
    await recordRejection({
      boundary: "reader", tableName: "pipeline_acquisitions", rowId: id,
      reasonCode: "LINEAGE_CAMPAIGN_MISMATCH",
      reasonDetail: `acquisition ${id} campaign_id=${row.campaignId} != expected ${expected.campaignId}`,
      accountId: row.accountId, campaignId: row.campaignId, lane: row.lane,
      context: { expected, observed: { accountId: row.accountId, campaignId: row.campaignId } },
    });
    throw new PipelineValidationError("LINEAGE_CAMPAIGN_MISMATCH",
      `acquisition ${id} campaign_id=${row.campaignId} != expected ${expected.campaignId}`,
      { id, expected });
  }
  let payload: unknown, provenance: unknown;
  try {
    payload = strictJsonParse(row.payload, "acquisition.payload");
  } catch (err) {
    await recordRejection({
      boundary: "reader", tableName: "pipeline_acquisitions", rowId: id,
      reasonCode: "PAYLOAD_INVALID_JSON", reasonDetail: `acquisition ${id} payload not JSON`,
      accountId: row.accountId, campaignId: row.campaignId, lane: row.lane,
      context: { jsonError: (err as Error).message },
    });
    throw new PipelineValidationError("PAYLOAD_INVALID_JSON",
      `acquisition ${id} payload is not valid JSON`, { id, jsonError: (err as Error).message });
  }
  try {
    provenance = strictJsonParse(row.provenance, "acquisition.provenance");
  } catch (err) {
    await recordRejection({
      boundary: "reader", tableName: "pipeline_acquisitions", rowId: id,
      reasonCode: "PAYLOAD_INVALID_JSON", reasonDetail: `acquisition ${id} provenance not JSON`,
      accountId: row.accountId, campaignId: row.campaignId, lane: row.lane,
      context: { jsonError: (err as Error).message },
    });
    throw new PipelineValidationError("PAYLOAD_INVALID_JSON",
      `acquisition ${id} provenance is not valid JSON`, { id, jsonError: (err as Error).message });
  }
  return {
    row,
    payload: payload as Record<string, unknown>,
    provenance: provenance as Record<string, unknown>,
  };
}
