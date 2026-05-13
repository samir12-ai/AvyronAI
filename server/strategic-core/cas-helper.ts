import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { strategicPlans } from "@shared/schema";

/**
 * Seal #10 / Task #28 / F8.3 — optimistic-locking helper.
 *
 * Read the plan's current version, then UPDATE with
 * `WHERE id = ? AND version = ?` and `SET version = version + 1`.
 * If affected rows = 0 a concurrent writer modified the row first; the
 * helper throws CONCURRENT_MODIFICATION so the caller surfaces a 409
 * rather than silently overwriting a sibling decision.
 *
 * Use ONE of two shapes:
 *   • `casUpdateStrategicPlanByVersion(planId, expectedVersion, set)` —
 *     when the caller already has the version (verifyPlanOwnership has
 *     loaded `plan.version`).
 *   • `casUpdateStrategicPlan(planId, set)` — convenience wrapper that
 *     fetches the version first; suitable for write paths that don't
 *     have the row in scope.
 */
export async function casUpdateStrategicPlanByVersion(
  planId: string,
  expectedVersion: number,
  set: Record<string, unknown>,
): Promise<{ updated: boolean; newVersion: number }> {
  const updated = await db.update(strategicPlans)
    .set({ ...set, version: sql`${strategicPlans.version} + 1` })
    .where(and(
      eq(strategicPlans.id, planId),
      eq(strategicPlans.version, expectedVersion),
    ))
    .returning({ id: strategicPlans.id, version: strategicPlans.version });
  if (updated.length === 0) {
    const err = new Error(
      `CONCURRENT_MODIFICATION: strategic_plans.id=${planId} expectedVersion=${expectedVersion} — another writer changed the row first`,
    );
    (err as Error & { code?: string }).code = "CONCURRENT_MODIFICATION";
    throw err;
  }
  return { updated: true, newVersion: updated[0].version };
}

export async function casUpdateStrategicPlan(
  planId: string,
  set: Record<string, unknown>,
): Promise<{ updated: boolean; newVersion: number }> {
  const [currentRow] = await db.select({ version: strategicPlans.version })
    .from(strategicPlans)
    .where(eq(strategicPlans.id, planId))
    .limit(1);
  const currentVersion = currentRow?.version ?? 1;
  return casUpdateStrategicPlanByVersion(planId, currentVersion, set);
}
