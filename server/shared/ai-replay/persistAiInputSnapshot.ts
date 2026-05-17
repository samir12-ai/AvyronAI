/**
 * Phase 6 / Task #69 step 5 — AI Input Snapshot wrapper.
 *
 * Single canonical write point for the `ai_input_snapshots` table (migration
 * 015). Every LLM call across the 15 engines is meant to call this helper
 * with the exact payload it sent to the model, so that the replay/audit
 * lane can deterministically re-derive any contested output without
 * re-running the entire upstream pipeline.
 *
 * NOTE (per task drift footnote): this PR ships the wrapper + table only.
 * The 15 per-engine call sites are filed as a follow-up so the wiring can
 * happen behind a shadow flag and each engine's payload shape can be
 * validated against its prompt fixture before going live.
 *
 * Doctrine alignment:
 *   - D5: write failures are LOGGED + COUNTED, never silently swallowed.
 *         The caller continues so an AI snapshot write outage does not
 *         block the LLM-driven pipeline; the operator sees the failure
 *         via `_getAiInputSnapshotStats()` and the AI_INPUT_SNAPSHOT_WRITE_FAILED log line.
 */

import { db } from "../../db";
import { aiInputSnapshots, type InsertAiInputSnapshot } from "@shared/schema";
import { createHash } from "crypto";

export interface AiInputSnapshotInput {
  accountId?: string;
  campaignId: string;
  jobId?: string | null;
  engineId: string;
  engineVersion?: number;
  model: string;
  promptFingerprint?: string;
  inputPayload: unknown;
  contextSummary?: string;
  provenance?: Record<string, unknown>;
}

const _stats = { writes: 0, failures: 0, lastFailure: null as string | null };
export function _getAiInputSnapshotStats(): { writes: number; failures: number; lastFailure: string | null } {
  return { ..._stats };
}

function fingerprint(payload: unknown, model: string): string {
  const serialized = typeof payload === "string" ? payload : JSON.stringify(payload);
  return createHash("sha256").update(`${model}\n${serialized}`).digest("hex").slice(0, 32);
}

export async function persistAiInputSnapshot(input: AiInputSnapshotInput): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  try {
    const serialized = typeof input.inputPayload === "string" ? input.inputPayload : JSON.stringify(input.inputPayload);
    const inputBytes = Buffer.byteLength(serialized, "utf8");
    const promptFingerprint = input.promptFingerprint ?? fingerprint(input.inputPayload, input.model);
    const row: InsertAiInputSnapshot = {
      accountId: input.accountId ?? "default",
      campaignId: input.campaignId,
      jobId: input.jobId ?? null,
      engineId: input.engineId,
      engineVersion: input.engineVersion ?? 0,
      model: input.model,
      promptFingerprint,
      inputPayload: serialized,
      inputBytes,
      contextSummary: input.contextSummary ?? null,
      provenance: input.provenance ? JSON.stringify(input.provenance) : null,
    };
    const [inserted] = await db.insert(aiInputSnapshots).values(row).returning({ id: aiInputSnapshots.id });
    _stats.writes++;
    return { ok: true, id: inserted.id };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    _stats.failures++;
    _stats.lastFailure = reason;
    console.error(`[AiReplay] AI_INPUT_SNAPSHOT_WRITE_FAILED | engine=${input.engineId} campaign=${input.campaignId} model=${input.model} reason=${reason.slice(0, 200)}`);
    return { ok: false, reason };
  }
}
