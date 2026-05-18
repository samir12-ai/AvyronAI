/**
 * Phase 4-A — Persistence for commercial reasoning snapshots.
 *
 * UPSERT-by-(run_id, engine_id), enforced at DB layer by migration 034's
 * UNIQUE constraint. Uses Drizzle's sql template against the existing pool.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import type {
  CommercialReasoningOutput,
  GateDecisionReason,
  IntegrityVerdict,
  FellBackTo,
} from "./contract";

export interface CommercialReasoningSnapshotInput {
  accountId: string;
  campaignId: string;
  runId: string;
  engineId: string;
  reasoning: CommercialReasoningOutput | null;
  gateDecision: {
    allow: boolean;
    reason: GateDecisionReason;
    detail?: string;
  };
  integrityVerdict: IntegrityVerdict;
  fellBackTo: FellBackTo;
}

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function persistCommercialReasoningSnapshot(
  input: CommercialReasoningSnapshotInput,
): Promise<void> {
  const id = randomId();
  try {
    await db.execute(sql`
      INSERT INTO commercial_reasoning_snapshots (
        id, account_id, campaign_id, run_id, engine_id,
        reasoning, gate_decision, integrity_verdict, fell_back_to
      ) VALUES (
        ${id},
        ${input.accountId},
        ${input.campaignId},
        ${input.runId},
        ${input.engineId},
        ${JSON.stringify(input.reasoning ?? null)}::jsonb,
        ${JSON.stringify(input.gateDecision)}::jsonb,
        ${input.integrityVerdict},
        ${input.fellBackTo}
      )
      ON CONFLICT (run_id, engine_id) DO UPDATE SET
        reasoning = EXCLUDED.reasoning,
        gate_decision = EXCLUDED.gate_decision,
        integrity_verdict = EXCLUDED.integrity_verdict,
        fell_back_to = EXCLUDED.fell_back_to,
        created_at = NOW()
    `);
  } catch (err) {
    // Seal #15 doctrine: no silent catches — persistence failure is logged
    // explicitly and re-thrown so the caller maps it to a status enum.
    console.error("[CommercialReasoning] PERSIST_FAILED", {
      runId: input.runId,
      engineId: input.engineId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
