/**
 * Task #64 / Phase 1 — engine_operational_state dedicated store.
 *
 * Replaces every strategy_memory write whose memoryType is one of
 * content_rhythm, exploration_budget, agent_rhythm. These rows were never
 * strategic facts — they were operational singletons that the gate had to
 * bypass via OPERATIONAL_MEMORY_TYPES. The bypass is now gone (Task #64
 * step 2): writes to this table do not pass through policyEnforcedMemoryCheck
 * because confidence-thresholding an operational singleton is meaningless
 * (the writer is the authoritative source).
 *
 * Singleton contract: (accountId, campaignId, stateType) is unique. Upsert
 * via the ON CONFLICT clause is the only public write path.
 */
import { db } from "../db";
import { engineOperationalState } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";

/**
 * Task #64 / Phase 1 — operational state classification.
 *
 *   - content_rhythm       (adaptive-rhythm engine; cadence per account/campaign)
 *   - exploration_budget   (exploration-budget engine; budget per account/campaign)
 *   - agent_rhythm         (chat/agent loop; pacing per account/campaign)
 *   - self_improvement     (weekly-report; latest improvement set per account/campaign)
 */
export type OperationalStateType =
  | "content_rhythm"
  | "exploration_budget"
  | "agent_rhythm"
  | "self_improvement";

/** Drizzle's jsonb column types accept any plain JSON value (object/array/primitive). */
export type OperationalStatePayload = Record<string, unknown> | unknown[];

export interface OperationalStateInput {
  accountId: string;
  campaignId: string;
  stateType: OperationalStateType;
  engineName: string;
  label: string;
  payload: OperationalStatePayload;
  rationale?: string | null;
  confidenceScore?: number;
}

export async function upsertOperationalState(input: OperationalStateInput): Promise<void> {
  await db
    .insert(engineOperationalState)
    .values({
      accountId: input.accountId,
      campaignId: input.campaignId,
      stateType: input.stateType,
      engineName: input.engineName,
      label: input.label,
      payload: input.payload,
      rationale: input.rationale ?? null,
      confidenceScore: input.confidenceScore ?? 0.5,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        engineOperationalState.accountId,
        engineOperationalState.campaignId,
        engineOperationalState.stateType,
      ],
      set: {
        engineName: input.engineName,
        label: input.label,
        payload: input.payload,
        rationale: input.rationale ?? null,
        confidenceScore: input.confidenceScore ?? 0.5,
        updatedAt: new Date(),
      },
    });
}

export async function getOperationalState(
  accountId: string,
  campaignId: string,
  stateType: OperationalStateType,
): Promise<typeof engineOperationalState.$inferSelect | null> {
  const rows = await db
    .select()
    .from(engineOperationalState)
    .where(
      and(
        eq(engineOperationalState.accountId, accountId),
        eq(engineOperationalState.campaignId, campaignId),
        eq(engineOperationalState.stateType, stateType),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}
