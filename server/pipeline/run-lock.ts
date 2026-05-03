/**
 * Pipeline lane in-flight lock — single-process, per (account, campaign, lane).
 *
 * Mirrors server/boss/concurrency.ts. The Boss Agent already holds a
 * per-campaign lock (withCampaignLock), so all Boss-orchestrated lane runs
 * are coordinated. This module covers the gap left by the direct admin
 * routes /api/pipeline/runs/user and /api/pipeline/runs/competitor, which
 * an operator can hit while another lane run for the same campaign is still
 * in flight (e.g. an autopilot tick or a Boss run). Without this lock,
 * concurrent runs against the same acquisition can write conflicting
 * snapshots / signals into pipeline_* tables.
 *
 * Out of scope (intentionally): cross-process coordination. Same decision
 * as Boss concurrency. If we ever shard the API, this becomes a Postgres
 * advisory-lock or a Redis SETNX.
 */

export class PipelineRunInFlightError extends Error {
  code = "PIPELINE_RUN_IN_FLIGHT";
  constructor(
    public accountId: string,
    public campaignId: string,
    public lane: string,
  ) {
    super(
      `A pipeline ${lane} run is already in flight for ${accountId}/${campaignId}`,
    );
    this.name = "PipelineRunInFlightError";
  }
}

const inFlight = new Map<string, Promise<unknown>>();

function key(accountId: string, campaignId: string, lane: string): string {
  return `${accountId}::${campaignId}::${lane}`;
}

export async function withPipelineLaneLock<T>(
  accountId: string,
  campaignId: string,
  lane: string,
  work: () => Promise<T>,
): Promise<T> {
  const k = key(accountId, campaignId, lane);
  if (inFlight.has(k)) {
    throw new PipelineRunInFlightError(accountId, campaignId, lane);
  }
  const p = work().finally(() => {
    inFlight.delete(k);
  });
  inFlight.set(k, p as Promise<unknown>);
  return p as Promise<T>;
}

/** Test-only escape hatch if a previous run leaks. */
export function _resetPipelineLaneLock(
  accountId: string,
  campaignId: string,
  lane: string,
): void {
  inFlight.delete(key(accountId, campaignId, lane));
}
