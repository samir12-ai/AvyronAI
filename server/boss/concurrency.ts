/**
 * Phase 3 — Per-campaign in-flight lock.
 * Single-process only (mirrors Collector decision #2). Cross-process
 * coordination is intentionally out of scope.
 */
import type { BossRunResult } from "./types";

export class BossRunInFlightError extends Error {
  code = "BOSS_RUN_IN_FLIGHT";
  constructor(public campaignId: string) {
    super(`A Boss run is already in flight for campaign ${campaignId}`);
    this.name = "BossRunInFlightError";
  }
}

const inFlight = new Map<string, Promise<BossRunResult>>();

function key(accountId: string, campaignId: string): string {
  return `${accountId}::${campaignId}`;
}

export async function withCampaignLock(
  accountId: string,
  campaignId: string,
  work: () => Promise<BossRunResult>,
): Promise<BossRunResult> {
  const k = key(accountId, campaignId);
  if (inFlight.has(k)) {
    throw new BossRunInFlightError(campaignId);
  }
  const p = work().finally(() => {
    inFlight.delete(k);
  });
  inFlight.set(k, p);
  return p;
}

/** Test-only: release a lock if a previous run leaked it. */
export function _resetCampaignLock(accountId: string, campaignId: string): void {
  inFlight.delete(key(accountId, campaignId));
}
