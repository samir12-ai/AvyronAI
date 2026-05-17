/**
 * Task #64 / Phase 1 — Canonical Fact Ownership.
 *
 * Single authoritative entry point for every strategy_memory write. Pre-#64
 * there were 14 direct `db.insert(strategyMemory)` / `db.update(strategyMemory)`
 * call sites spread across 6 files, each re-implementing the gate check,
 * provenance stamping, fingerprint normalization, and isWinner/direction sync
 * subtly differently. That fan-out is what made the broader consolidation
 * intractable; this module collapses it to one path.
 *
 * Contract (every caller MUST go through write() or upsertByFingerprint()):
 *   1. The gate decision is `policyEnforcedMemoryCheck` (the type-aware
 *      variant). Callers may not pre-check and bypass — the helper owns it.
 *   2. The fingerprint is deterministic from (engineName, label, details).
 *   3. `direction` is canonical; `isWinner` is NEVER set by callers
 *      (Task #64 step 7 — deprecated column, read-time projection only).
 *   4. `planId` — when present — MUST resolve to a real strategic_plans row
 *      that matches the (accountId, campaignId) of the write. Cross-tenant
 *      or stale plan IDs are rejected at this boundary. A null planId is
 *      allowed (operational writes without active-plan attribution).
 *
 * Operational/log memory types (mutation_log, content_rhythm,
 * exploration_budget, agent_action, agent_rhythm, self_improvement) MUST
 * NOT go through this helper — they have their own dedicated tables /
 * stores (mutationLogStore, operationalStateStore). Phase 1 removes the
 * decision-policy OPERATIONAL bypass that previously made it legal to
 * route them through here.
 */
import { db } from "../db";
import { strategyMemory, strategicPlans } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { policyEnforcedMemoryCheck, NON_STRATEGIC_MEMORY_TYPES } from "../decision-policy";
import { makeStrategyFingerprint } from "./manager";
import { recordMemoryWriteOutcome } from "./cv06-metrics";

export type MemoryDirection = "reinforce" | "avoid" | "neutral";

const NON_STRATEGIC = new Set<string>(NON_STRATEGIC_MEMORY_TYPES);

function assertStrategicType(memoryType: string, engineName: string): void {
  if (NON_STRATEGIC.has(memoryType)) {
    throw new Error(
      `[memoryStore] REFUSED_NON_STRATEGIC_WRITE | memoryType="${memoryType}" engine="${engineName}" — ` +
      `operational/log types must use mutationLogStore or operationalStateStore (Task #64 / Phase 1).`,
    );
  }
}

/**
 * Task #64 / Phase 1 — CFO-1 planId guard.
 *
 * A planId on a memory row claims provenance to a strategic_plans row. We
 * therefore require that row to (a) exist and (b) belong to the same
 * (accountId, campaignId) the write targets. A mismatch indicates either
 * stale state (plan was deleted) or a cross-tenant attribution attempt.
 * Returns null when the planId is valid (or null), or a reason string when
 * the write must be rejected.
 */
async function validatePlanIdOrReason(
  planId: string | null | undefined,
  accountId: string,
  campaignId: string,
): Promise<string | null> {
  if (!planId) return null;
  const [row] = await db
    .select({
      id: strategicPlans.id,
      accountId: strategicPlans.accountId,
      campaignId: strategicPlans.campaignId,
    })
    .from(strategicPlans)
    .where(eq(strategicPlans.id, planId))
    .limit(1);
  if (!row) {
    return `INVALID_PLAN_ID — planId="${planId}" does not resolve to any strategic_plans row`;
  }
  if (row.accountId !== accountId || row.campaignId !== campaignId) {
    return (
      `PLAN_ID_TENANT_MISMATCH — planId="${planId}" belongs to ` +
      `(account=${row.accountId}, campaign=${row.campaignId}), write targets ` +
      `(account=${accountId}, campaign=${campaignId})`
    );
  }
  return null;
}

export interface MemoryWriteInput {
  accountId: string;
  campaignId: string;
  memoryType: string;
  engineName: string;
  label: string;
  details?: string | null;
  performance?: string | null;
  score?: number;
  confidenceScore: number;
  direction: MemoryDirection;
  planId?: string | null;
  sourceOutcomeId?: string | null;
  industry?: string | null;
  platform?: string | null;
  campaignType?: string | null;
  funnelObjective?: string | null;
}

export interface MemoryWriteResult {
  allowed: boolean;
  rowId: string | null;
  reason: string;
  bypassedPolicy: boolean;
}

/**
 * Idempotent fingerprint-keyed upsert. Replaces the existing/insert split
 * pattern that the four blended-confidence writers re-implemented.
 *
 * Returns { allowed: false } when the policy gate blocks. Callers SHOULD
 * log the rejection at their own callsite for traceability — the helper
 * also records it via CV-06 so the metric reflects the system-wide rate.
 */
export async function upsertByFingerprint(input: MemoryWriteInput): Promise<MemoryWriteResult> {
  assertStrategicType(input.memoryType, input.engineName);

  const planReason = await validatePlanIdOrReason(input.planId, input.accountId, input.campaignId);
  if (planReason) {
    recordMemoryWriteOutcome("blocked", input.memoryType, input.engineName);
    return { allowed: false, rowId: null, reason: planReason, bypassedPolicy: false };
  }

  const gate = policyEnforcedMemoryCheck(
    input.confidenceScore,
    input.direction,
    input.engineName,
    input.memoryType,
  );
  if (!gate.allowed) {
    recordMemoryWriteOutcome("blocked", input.memoryType, input.engineName);
    return { allowed: false, rowId: null, reason: gate.reason, bypassedPolicy: gate.policyBypassed };
  }

  const fingerprint = makeStrategyFingerprint(input.engineName, input.label, input.details ?? null);

  const existing = await db
    .select({ id: strategyMemory.id })
    .from(strategyMemory)
    .where(
      and(
        eq(strategyMemory.accountId, input.accountId),
        eq(strategyMemory.campaignId, input.campaignId),
        eq(strategyMemory.strategyFingerprint, fingerprint),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(strategyMemory)
      .set({
        label: input.label,
        details: input.details ?? null,
        performance: input.performance ?? null,
        score: input.score ?? input.confidenceScore,
        confidenceScore: input.confidenceScore,
        direction: input.direction,
        engineName: input.engineName,
        memoryType: input.memoryType,
        planId: input.planId ?? null,
        sourceOutcomeId: input.sourceOutcomeId ?? null,
        lastValidatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(strategyMemory.id, existing[0].id));
    recordMemoryWriteOutcome("updated", input.memoryType, input.engineName);
    return { allowed: true, rowId: existing[0].id, reason: "updated", bypassedPolicy: false };
  }

  const id = Date.now().toString() + Math.random().toString(36).substr(2, 9);
  await db.insert(strategyMemory).values({
    id,
    accountId: input.accountId,
    campaignId: input.campaignId,
    memoryType: input.memoryType,
    engineName: input.engineName,
    label: input.label,
    details: input.details ?? null,
    performance: input.performance ?? null,
    score: input.score ?? input.confidenceScore,
    confidenceScore: input.confidenceScore,
    direction: input.direction,
    planId: input.planId ?? null,
    sourceOutcomeId: input.sourceOutcomeId ?? null,
    industry: input.industry ?? null,
    platform: input.platform ?? null,
    campaignType: input.campaignType ?? null,
    funnelObjective: input.funnelObjective ?? null,
    strategyFingerprint: fingerprint,
    lastValidatedAt: new Date(),
  });
  recordMemoryWriteOutcome("inserted", input.memoryType, input.engineName);
  return { allowed: true, rowId: id, reason: "inserted", bypassedPolicy: false };
}

/**
 * Direct row-ID update — used by outcome-tracker to attach an outcome's
 * verdict to the existing memory row identified by decisionId. This is the
 * only legitimate "update a known strategy_memory row by primary key" path;
 * everything else MUST go through upsertByFingerprint.
 */
export async function updateById(
  rowId: string,
  patch: {
    confidenceScore: number;
    direction: MemoryDirection;
    score: number;
    engineName: string;
    memoryType: string;
    sourceOutcomeId?: string | null;
  },
): Promise<MemoryWriteResult> {
  assertStrategicType(patch.memoryType, patch.engineName);

  // Re-validate the row's planId against its row tenancy. updateById doesn't
  // accept a new planId — but if the existing row has a planId that no longer
  // resolves (plan was deleted) we still allow the update; the row's
  // canonical attribution is established at insert time and the gate above
  // already covers confidence policy. The planId validator is exposed only
  // on the insert/upsert path where the caller chooses the attribution.
  const gate = policyEnforcedMemoryCheck(
    patch.confidenceScore,
    patch.direction,
    patch.engineName,
    patch.memoryType,
  );
  if (!gate.allowed) {
    recordMemoryWriteOutcome("blocked", patch.memoryType, patch.engineName);
    return { allowed: false, rowId: null, reason: gate.reason, bypassedPolicy: gate.policyBypassed };
  }

  await db
    .update(strategyMemory)
    .set({
      score: patch.score,
      confidenceScore: patch.confidenceScore,
      direction: patch.direction,
      sourceOutcomeId: patch.sourceOutcomeId ?? null,
      lastValidatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(strategyMemory.id, rowId));

  recordMemoryWriteOutcome("updated", patch.memoryType, patch.engineName);
  return { allowed: true, rowId, reason: "updated", bypassedPolicy: false };
}

/**
 * Internal: decay-driven score updates. Bypasses the gate intentionally
 * (decay is a recalculation, not a new fact), and is the ONLY other
 * legitimate direct strategy_memory writer alongside this module.
 */
export async function applyDecayUpdate(
  rowId: string,
  newConfidence: number,
  flipToNeutral: boolean,
): Promise<void> {
  if (flipToNeutral) {
    await db
      .update(strategyMemory)
      .set({
        confidenceScore: newConfidence,
        direction: "neutral",
        updatedAt: new Date(),
      })
      .where(eq(strategyMemory.id, rowId));
  } else {
    await db
      .update(strategyMemory)
      .set({ confidenceScore: newConfidence, updatedAt: new Date() })
      .where(eq(strategyMemory.id, rowId));
  }
  recordMemoryWriteOutcome("decay", "(decay)", "memory-mutation");
}

/**
 * Internal: time-based score decay applied by `memory-mutation/engine.ts`
 * `applyConfidenceDecay`. Bypasses the policy gate intentionally — decay is
 * a recalculation, not a new fact — and is restricted to the decay path.
 * Two shapes: a hard floor (neutralize) and a graceful decline.
 */
export async function applyTimeDecayUpdate(
  rowId: string,
  patch:
    | { kind: "neutralize" }
    | { kind: "decline"; score: number; confidenceScore: number },
): Promise<void> {
  if (patch.kind === "neutralize") {
    // Task #64 / Phase 1 step 7 — `isWinner` is a deprecated column. Producers
    // do NOT write it; downstream code derives winner semantics from
    // `direction` (reinforce ⇒ winner) at read time. The column is left in
    // the schema for transitional reads only and will be dropped in Phase 2.
    await db
      .update(strategyMemory)
      .set({
        score: 0,
        confidenceScore: 0.1,
        direction: "neutral",
        updatedAt: new Date(),
      })
      .where(eq(strategyMemory.id, rowId));
  } else {
    await db
      .update(strategyMemory)
      .set({
        score: patch.score,
        confidenceScore: patch.confidenceScore,
        updatedAt: new Date(),
      })
      .where(eq(strategyMemory.id, rowId));
  }
  recordMemoryWriteOutcome("decay", "(time-decay)", "memory-mutation");
}

/**
 * Task #64 / Phase 1 — memory-mutation reinforce/avoid/flip writes.
 *
 * Covers the four operational shapes the mutation engine applies to a row
 * after evaluating periodized performance:
 *
 *   - "confirm": confidence increments + validationCount bump (direction unchanged).
 *   - "flip":    direction flip + isWinner reset + confidence reset to FLIP_RESET.
 *
 * Bypasses the policy gate because the row already passed the gate at insert;
 * mutation is a verdict on already-stored fact, not a new write. The CV-06
 * counter still records the outcome under the "updated" bucket so the
 * dashboard reflects mutation throughput.
 */
export async function applyMutationUpdate(
  rowId: string,
  patch:
    | {
        kind: "confirm";
        confidenceScore: number;
        validationCount: number;
      }
    | {
        kind: "flip";
        direction: MemoryDirection;
        confidenceScore: number;
      },
): Promise<void> {
  // Task #64 / Phase 1 step 7 — `isWinner` is deprecated and is NOT written
  // by this helper. Read paths must project winner semantics from
  // `direction` (reinforce ⇒ winner) so producers can never drift the two
  // representations apart. The schema column survives for transitional
  // reads only and is scheduled for drop in Phase 2.
  const now = new Date();
  if (patch.kind === "confirm") {
    await db
      .update(strategyMemory)
      .set({
        confidenceScore: patch.confidenceScore,
        validationCount: patch.validationCount,
        lastValidatedAt: now,
        updatedAt: now,
      })
      .where(eq(strategyMemory.id, rowId));
  } else {
    await db
      .update(strategyMemory)
      .set({
        direction: patch.direction,
        confidenceScore: patch.confidenceScore,
        lastValidatedAt: now,
        updatedAt: now,
      })
      .where(eq(strategyMemory.id, rowId));
  }
  recordMemoryWriteOutcome("updated", "(mutation)", "memory-mutation");
}
