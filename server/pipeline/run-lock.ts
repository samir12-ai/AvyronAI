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

/**
 * Phase 7 hardening (May 2026): wall-clock cap on a single lane's work().
 * Without this, a hung downstream call (proxy timeout, deadlocked DB tx)
 * leaves the in-memory lock pinned forever, blocking every subsequent
 * lane run for that (account, campaign, lane) tuple until process restart.
 * 30 minutes mirrors MAX_RUNTIME_MS in market-intelligence-v3/fetch-orchestrator.
 */
export const PIPELINE_LANE_LOCK_TIMEOUT_MS = 30 * 60 * 1000;

export class PipelineLaneLockTimeoutError extends Error {
  code = "PIPELINE_LANE_LOCK_TIMEOUT";
  constructor(
    public accountId: string,
    public campaignId: string,
    public lane: string,
    public timeoutMs: number,
  ) {
    super(
      `Pipeline ${lane} lane work exceeded ${timeoutMs}ms for ${accountId}/${campaignId} — lock auto-released`,
    );
    this.name = "PipelineLaneLockTimeoutError";
  }
}

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
  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new PipelineLaneLockTimeoutError(accountId, campaignId, lane, PIPELINE_LANE_LOCK_TIMEOUT_MS));
    }, PIPELINE_LANE_LOCK_TIMEOUT_MS);
    if (typeof timeoutHandle.unref === "function") timeoutHandle.unref();
  });
  const raced = Promise.race([work(), timeoutPromise]).finally(() => {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    inFlight.delete(k);
  });
  inFlight.set(k, raced as Promise<unknown>);
  return raced as Promise<T>;
}

/** Test-only escape hatch if a previous run leaks. */
export function _resetPipelineLaneLock(
  accountId: string,
  campaignId: string,
  lane: string,
): void {
  inFlight.delete(key(accountId, campaignId, lane));
}
