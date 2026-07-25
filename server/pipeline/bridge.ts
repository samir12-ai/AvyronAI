import { newId } from "./ids";
import { createRun, startRun, finishRun, failRun, getRun } from "./runs";
import { acceptSnapshot, acceptSignal } from "./validate-and-accept";
import { PipelineValidationError } from "./errors";
import { readSignalsForRunAndLane, readChangeEventsForRunAndCampaign } from "./readers";
import type { SnapshotContract, SignalContract } from "@shared/contracts";

export interface BridgeInput {
  accountId: string;
  campaignId: string;
  competitorRunId: string;
  userRunId: string;
}

export interface BridgeResult {
  runId: string;
  bridgedSnapshotId: string;
  bridgedSignalIds: string[];
  changeIndicatorCount: number;
}

/**
 * Bridge v1 — lightweight pass-through.
 *
 * Rules (Phase 1.6 + Phase 6.5 integrity engineering, Samir-locked):
 *  - Only runs if both parent runs are validated.
 *  - BOTH parent runs MUST belong to the same (accountId, campaignId) as the
 *    bridge input. No cross-campaign bridging — hard-reject BRIDGE_CROSS_CAMPAIGN.
 *  - Reads competitor signals + change events.
 *  - Builds ONE bridged snapshot summarising what crossed.
 *  - Re-emits each competitor signal as a bridge-lane signal, carrying
 *    derived_from_signal_id back to the source for first-class lineage.
 *    NO raw competitor payload data crosses.
 */
export async function bridgeLanes(input: BridgeInput): Promise<BridgeResult> {
  if (!input.accountId) {
    throw new PipelineValidationError("MISSING_ACCOUNT_ID", "bridge requires accountId", {});
  }
  if (!input.campaignId) {
    throw new PipelineValidationError("MISSING_CAMPAIGN_ID", "bridge requires campaignId", {});
  }

  const competitorRun = await getRun(input.competitorRunId);
  const userRun = await getRun(input.userRunId);

  if (competitorRun.status !== "validated") {
    throw new PipelineValidationError("BRIDGE_PARENT_NOT_VALIDATED", `competitor run ${input.competitorRunId} status=${competitorRun.status}`, {});
  }
  if (userRun.status !== "validated") {
    throw new PipelineValidationError("BRIDGE_PARENT_NOT_VALIDATED", `user run ${input.userRunId} status=${userRun.status}`, {});
  }
  if (competitorRun.lane !== "competitor") {
    throw new PipelineValidationError("BRIDGE_WRONG_LANE", `expected competitor lane, got ${competitorRun.lane}`, {});
  }
  if (userRun.lane !== "user") {
    throw new PipelineValidationError("BRIDGE_WRONG_LANE", `expected user lane, got ${userRun.lane}`, {});
  }

  // Phase 6.5 — cross-campaign isolation. All three identities must agree.
  if (
    competitorRun.accountId !== input.accountId ||
    competitorRun.campaignId !== input.campaignId
  ) {
    throw new PipelineValidationError(
      "BRIDGE_CROSS_CAMPAIGN",
      `competitor run lineage (${competitorRun.accountId},${competitorRun.campaignId}) does not match bridge input (${input.accountId},${input.campaignId})`,
      { competitorRunId: input.competitorRunId },
    );
  }
  if (
    userRun.accountId !== input.accountId ||
    userRun.campaignId !== input.campaignId
  ) {
    throw new PipelineValidationError(
      "BRIDGE_CROSS_CAMPAIGN",
      `user run lineage (${userRun.accountId},${userRun.campaignId}) does not match bridge input (${input.accountId},${input.campaignId})`,
      { userRunId: input.userRunId },
    );
  }

  // Phase 6.5 — guarded reads. Each row passes the canonical contract +
  // lineage assertion; any cross-campaign / NULL-lineage row hard-rejects
  // before the bridge can synthesise from it.
  const competitorSignals = await readSignalsForRunAndLane(
    input.competitorRunId,
    "competitor",
    { accountId: input.accountId, campaignId: input.campaignId },
  );
  const competitorChanges = await readChangeEventsForRunAndCampaign(
    input.competitorRunId,
    { accountId: input.accountId, campaignId: input.campaignId },
  );

  const bridgeRun = await createRun({
    accountId: input.accountId,
    campaignId: input.campaignId,
    lane: "bridge",
    trigger: "bridge",
    parentRunId: input.competitorRunId,
  });

  try {
    await startRun(bridgeRun.id);

    // Single bridged snapshot — carries no raw payload, only lineage references.
    const bridgedSnapshot: SnapshotContract = {
      snapshot_id: newId("snap"),
      run_id: bridgeRun.id,
      account_id: input.accountId,
      campaign_id: input.campaignId,
      acquisition_id: null, // bridge synthesises from upstream runs, no single acquisition
      entity_id: `bridge:${input.competitorRunId}->${input.userRunId}`,
      entity_type: "bridged_signal_set",
      lane: "bridge",
      source: "bridge.v1",
      collected_at: new Date().toISOString(),
      payload: {
        competitor_run_id: input.competitorRunId,
        user_run_id: input.userRunId,
        signal_count: competitorSignals.length,
        change_event_count: competitorChanges.length,
      },
      schema_version: "v1",
    };
    const persistedSnap = await acceptSnapshot(bridgedSnapshot, { callerLane: "bridge" });

    const bridgedSignalIds: string[] = [];
    for (const { contract: cs } of competitorSignals) {
      const bridged: SignalContract = {
        signal_id: newId("sig"),
        run_id: bridgeRun.id,
        account_id: input.accountId,
        campaign_id: input.campaignId,
        acquisition_id: null,
        derived_from_signal_id: cs.signal_id,
        source_snapshot_id: persistedSnap.id,
        lane: "bridge",
        type: cs.type,
        value: cs.value,
        confidence: cs.confidence,
        evidence: [
          `bridged_from_signal:${cs.signal_id}`,
          `competitor_run:${input.competitorRunId}`,
          `target_user_run:${input.userRunId}`,
        ],
        schema_version: "v1",
      };
      const persisted = await acceptSignal(bridged, { callerLane: "bridge" });
      bridgedSignalIds.push(persisted.id);
    }

    // Change events surface as change_indicator signals in the bridge.
    for (const { contract: ce } of competitorChanges) {
      const indicator: SignalContract = {
        signal_id: newId("sig"),
        run_id: bridgeRun.id,
        account_id: input.accountId,
        campaign_id: input.campaignId,
        acquisition_id: null,
        derived_from_signal_id: ce.change_event_id, // change-event id stands in as the derived-from anchor
        source_snapshot_id: persistedSnap.id,
        lane: "bridge",
        type: "change_indicator",
        value: `${ce.change_dimension}:${ce.severity}`,
        // Phase 4 — T-4.A.1: vocabulary fix.
        // Canonical severity is mild/medium/major (see shared/contracts/change-event.ts ChangeSeverity).
        // The pre-Phase-1.6 vocabulary was high/medium/low; this branch used to read "high" which the
        // lane never writes, silently demoting MAJOR change events to confidence 0.4. Numbers
        // (0.8/0.6/0.4) intentionally preserved per Samir lock — confidence is not retuned in Phase 4.
        confidence: ce.severity === "major" ? 0.8 : ce.severity === "medium" ? 0.6 : 0.4,
        evidence: [`bridged_from_change_event:${ce.change_event_id}`],
        schema_version: "v1",
      };
      const persisted = await acceptSignal(indicator, { callerLane: "bridge" });
      bridgedSignalIds.push(persisted.id);
    }

    await finishRun(
      bridgeRun.id,
      JSON.stringify({
        bridgedSnapshotId: persistedSnap.id,
        bridgedSignalCount: bridgedSignalIds.length,
        changeIndicatorCount: competitorChanges.length,
      }),
    );

    return {
      runId: bridgeRun.id,
      bridgedSnapshotId: persistedSnap.id,
      bridgedSignalIds,
      changeIndicatorCount: competitorChanges.length,
    };
  } catch (err) {
    const reason = err instanceof PipelineValidationError ? err.message : (err as Error).message;
    await failRun(bridgeRun.id, reason).catch(() => {});
    throw err;
  }
}

