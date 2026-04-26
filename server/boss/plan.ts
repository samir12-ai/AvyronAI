/**
 * Phase 3 — Boss Agent planner.
 *
 * Pure: given (accountId, campaignId, scope), return a BossPlan describing
 * which entities to acquire and which lanes to run. Makes no DB writes
 * itself (`discoverEntities` reads, but does not write).
 */
import { discoverEntities } from "../collector/discovery";
import type { BossPlan, BossPlanItem, BossScope } from "./types";

export async function planBoss(
  accountId: string,
  campaignId: string,
  scope?: BossScope,
): Promise<BossPlan> {
  const onlyLanes = scope?.onlyLanes;
  const wantUser = !onlyLanes || onlyLanes.includes("user");
  const wantCompetitor = !onlyLanes || onlyLanes.includes("competitor");
  const wantBridge = !onlyLanes || onlyLanes.includes("bridge");

  const { userItems, competitorItems, notes } = await discoverEntities(accountId, campaignId, scope);

  const items: BossPlanItem[] = [];
  if (wantUser) items.push(...userItems);
  if (wantCompetitor) items.push(...competitorItems);

  if (!wantUser && userItems.length > 0) {
    notes.push(`scope_excluded_user_lane (skipped ${userItems.length} user item(s))`);
  }
  if (!wantCompetitor && competitorItems.length > 0) {
    notes.push(`scope_excluded_competitor_lane (skipped ${competitorItems.length} competitor item(s))`);
  }

  // Bridge requires at least one user run AND one competitor run to be in the plan.
  const bridgeRequested =
    wantBridge && items.some((i) => i.lane === "user") && items.some((i) => i.lane === "competitor");
  if (wantBridge && !bridgeRequested) {
    notes.push("bridge_skipped:requires_at_least_one_user_and_one_competitor_item");
  }

  return { bridgeRequested, items, notes };
}
