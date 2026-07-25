import { db } from "../db";
import {
  pipelineSnapshots,
  pipelineSignals,
  pipelineChangeEvents,
  pipelineAcquisitions,
  type PipelineSnapshot,
  type PipelineSignal,
  type PipelineChangeEvent,
  type PipelineRun,
} from "@shared/schema";
import { eq } from "drizzle-orm";
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
import { getRun } from "./runs";
import { readSnapshotByIdOrReject } from "./readers";

interface AcceptCtx {
  callerLane: Lane;
  /**
   * Phase 2 — Control Layer extension (T-2.9).
   * When true, acceptSnapshot rejects any snapshot whose acquisition_id
   * is missing OR references a stale pipeline_acquisitions row (age > ttl_ms).
   * Phase 6.5 also asserts that the referenced acquisition belongs to the
   * snapshot's campaign (no cross-campaign acquisition reuse).
   */
  requireFreshAcquisition?: boolean;
}

async function assertRunRunning(runId: string): Promise<PipelineRun> {
  const run = await getRun(runId);
  if (run.status !== "running") {
    throw new PipelineValidationError("RUN_NOT_RUNNING", `run ${runId} is ${run.status}, cannot accept data`, { runId });
  }
  return run;
}

function parseContract<T>(
  schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: { issues: unknown } } },
  payload: unknown,
  code: string,
): T {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new PipelineValidationError(code, "contract validation failed", { issues: result.error?.issues });
  }
  return result.data as T;
}

function assertLane(declared: Lane, caller: Lane) {
  if (declared !== caller) {
    throw new PipelineValidationError("LANE_MISMATCH", `caller lane=${caller} cannot write lane=${declared}`, { declared, caller });
  }
}

/**
 * Phase 6.5 — cross-campaign isolation guard at every accept boundary.
 * The contract's account_id and campaign_id MUST match the run record.
 * Any mismatch is a hard reject — no normalization, no silent rebind.
 */
function assertLineageMatchesRun(
  contract: { account_id: string; campaign_id: string },
  run: PipelineRun,
  code: string,
): void {
  if (run.accountId !== contract.account_id) {
    throw new PipelineValidationError(code, "account_id does not match run", {
      runAccountId: run.accountId,
      contractAccountId: contract.account_id,
    });
  }
  if (run.campaignId !== contract.campaign_id) {
    throw new PipelineValidationError(code, "campaign_id does not match run", {
      runCampaignId: run.campaignId,
      contractCampaignId: contract.campaign_id,
    });
  }
}

export async function acceptSnapshot(input: SnapshotContract, ctx: AcceptCtx): Promise<PipelineSnapshot> {
  const snapshot = parseContract(SnapshotContractSchema, input, "INVALID_SNAPSHOT_CONTRACT");
  assertLane(snapshot.lane, ctx.callerLane);
  const run = await assertRunRunning(snapshot.run_id);
  if (run.lane !== snapshot.lane && run.lane !== "shared") {
    throw new PipelineValidationError("RUN_LANE_MISMATCH", `run lane=${run.lane} does not match snapshot lane=${snapshot.lane}`, { runId: snapshot.run_id });
  }
  assertLineageMatchesRun(snapshot, run, "SNAPSHOT_LINEAGE_MISMATCH");

  if (ctx.requireFreshAcquisition || snapshot.acquisition_id) {
    const acquisitionId = snapshot.acquisition_id;
    if (!acquisitionId) {
      throw new PipelineValidationError(
        "MISSING_ACQUISITION_ID",
        "snapshot.acquisition_id is required when requireFreshAcquisition=true",
        { snapshotId: snapshot.snapshot_id },
      );
    }
    const [acq] = await db.select().from(pipelineAcquisitions).where(eq(pipelineAcquisitions.id, acquisitionId)).limit(1);
    if (!acq) {
      throw new PipelineValidationError("UNKNOWN_ACQUISITION", `acquisition_id=${acquisitionId} not found in pipeline_acquisitions`, { acquisitionId });
    }
    // Phase 6.5 — cross-campaign acquisition reuse is a hard reject.
    if (acq.accountId !== snapshot.account_id || acq.campaignId !== snapshot.campaign_id) {
      throw new PipelineValidationError(
        "ACQUISITION_CROSS_CAMPAIGN",
        `acquisition_id=${acquisitionId} belongs to (${acq.accountId},${acq.campaignId}) but snapshot lineage is (${snapshot.account_id},${snapshot.campaign_id})`,
        { acquisitionId, acqAccountId: acq.accountId, acqCampaignId: acq.campaignId },
      );
    }
    if (ctx.requireFreshAcquisition) {
      const ageMs = Date.now() - (acq.collectedAt instanceof Date ? acq.collectedAt.getTime() : new Date(acq.collectedAt as unknown as string).getTime());
      if (ageMs > acq.ttlMs) {
        throw new PipelineValidationError(
          "STALE_ACQUISITION",
          `acquisition_id=${acquisitionId} is stale (age=${ageMs}ms > ttl=${acq.ttlMs}ms)`,
          { acquisitionId, ageMs, ttlMs: acq.ttlMs },
        );
      }
    }
  }

  const [row] = await db
    .insert(pipelineSnapshots)
    .values({
      id: snapshot.snapshot_id,
      runId: snapshot.run_id,
      accountId: snapshot.account_id,
      campaignId: snapshot.campaign_id,
      acquisitionId: snapshot.acquisition_id ?? null,
      windowId: snapshot.window_id ?? null,
      entityId: snapshot.entity_id,
      entityType: snapshot.entity_type,
      lane: snapshot.lane,
      source: snapshot.source,
      collectedAt: new Date(snapshot.collected_at),
      payload: JSON.stringify(snapshot.payload),
      schemaVersion: snapshot.schema_version,
    })
    .returning();
  return row;
}

export async function acceptSignal(input: SignalContract, ctx: AcceptCtx): Promise<PipelineSignal> {
  const signal = parseContract(SignalContractSchema, input, "INVALID_SIGNAL_CONTRACT");
  assertLane(signal.lane, ctx.callerLane);
  const run = await assertRunRunning(signal.run_id);
  assertLineageMatchesRun(signal, run, "SIGNAL_LINEAGE_MISMATCH");

  // Phase 6.5 — guarded read. The reader hard-rejects on cross-campaign or
  // missing-lineage source snapshots and writes a structured rejection row.
  let snap: PipelineSnapshot;
  try {
    const view = await readSnapshotByIdOrReject(signal.source_snapshot_id, {
      accountId: signal.account_id,
      campaignId: signal.campaign_id,
    });
    snap = view.row;
  } catch (err) {
    if (err instanceof PipelineValidationError && err.code === "ROW_NOT_FOUND") {
      throw new PipelineValidationError("ORPHAN_SIGNAL_SOURCE", `source_snapshot_id=${signal.source_snapshot_id} not found`, { signalId: signal.signal_id });
    }
    throw err;
  }
  // Bridge lane is the only lane allowed to reference a snapshot from a different lane.
  if (signal.lane !== "bridge" && snap.lane !== signal.lane) {
    throw new PipelineValidationError("SIGNAL_CROSS_LANE", `signal lane=${signal.lane} cannot reference snapshot lane=${snap.lane}`, { snapshotLane: snap.lane });
  }

  const [row] = await db
    .insert(pipelineSignals)
    .values({
      id: signal.signal_id,
      runId: signal.run_id,
      accountId: signal.account_id,
      campaignId: signal.campaign_id,
      acquisitionId: signal.acquisition_id ?? null,
      windowId: signal.window_id ?? null,
      derivedFromSignalId: signal.derived_from_signal_id ?? null,
      sourceSnapshotId: signal.source_snapshot_id,
      lane: signal.lane,
      type: signal.type,
      value: signal.value,
      confidence: signal.confidence,
      evidence: JSON.stringify(signal.evidence),
      schemaVersion: signal.schema_version,
    })
    .returning();
  return row;
}

export async function acceptChangeEvent(input: ChangeEventContract, ctx: AcceptCtx): Promise<PipelineChangeEvent> {
  const event = parseContract(ChangeEventContractSchema, input, "INVALID_CHANGE_EVENT_CONTRACT");
  const run = await assertRunRunning(event.run_id);
  assertLineageMatchesRun(event, run, "CHANGE_EVENT_LINEAGE_MISMATCH");

  // Phase 6.5 — guarded reads. Both sides go through the canonical reader,
  // which hard-rejects cross-campaign / missing-lineage snapshots before any
  // change event is recorded.
  let base: PipelineSnapshot;
  try {
    const v = await readSnapshotByIdOrReject(event.baseline_snapshot_id, {
      accountId: event.account_id, campaignId: event.campaign_id,
    });
    base = v.row;
  } catch (err) {
    if (err instanceof PipelineValidationError && err.code === "ROW_NOT_FOUND") {
      throw new PipelineValidationError("ORPHAN_BASELINE", `baseline_snapshot_id=${event.baseline_snapshot_id} not found`, {});
    }
    throw err;
  }
  let curr: PipelineSnapshot;
  try {
    const v = await readSnapshotByIdOrReject(event.current_snapshot_id, {
      accountId: event.account_id, campaignId: event.campaign_id,
    });
    curr = v.row;
  } catch (err) {
    if (err instanceof PipelineValidationError && err.code === "ROW_NOT_FOUND") {
      throw new PipelineValidationError("ORPHAN_CURRENT", `current_snapshot_id=${event.current_snapshot_id} not found`, {});
    }
    throw err;
  }
  if (base.lane !== curr.lane) {
    throw new PipelineValidationError("CHANGE_EVENT_CROSS_LANE", `baseline lane=${base.lane} != current lane=${curr.lane}`, {});
  }
  if (ctx.callerLane !== base.lane && ctx.callerLane !== "shared") {
    throw new PipelineValidationError("LANE_MISMATCH", `caller lane=${ctx.callerLane} cannot write change event for lane=${base.lane}`, {});
  }

  const [row] = await db
    .insert(pipelineChangeEvents)
    .values({
      id: event.change_event_id,
      runId: event.run_id,
      accountId: event.account_id,
      campaignId: event.campaign_id,
      acquisitionId: event.acquisition_id,
      windowId: event.window_id ?? null,
      baselineSnapshotId: event.baseline_snapshot_id,
      currentSnapshotId: event.current_snapshot_id,
      changeDimension: event.change_dimension,
      severity: event.severity,
      evidence: JSON.stringify(event.evidence),
      schemaVersion: event.schema_version,
    })
    .returning();
  return row;
}
