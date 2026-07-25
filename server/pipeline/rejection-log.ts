/**
 * Phase 6.5 — Integrity Engineering rejection log.
 *
 * Locked by Samir 2026-04-20:
 *   Append-only sink for every hard-reject the writer/reader/harness boundary
 *   produces. Surfaced on the admin dashboard as proof the system is fail-closed
 *   and provides operators a structured way to track integrity violations.
 *
 *   Doctrine — never throw from this module. A failure to record a rejection
 *   must NOT swallow the original integrity violation that the caller is
 *   already raising. We log to console as a last resort.
 */
import { db } from "../db";
import { pipelineRejections } from "@shared/schema";
import { desc, and, eq, gte, sql } from "drizzle-orm";

export type RejectionBoundary = "reader" | "writer" | "harness";

export interface RecordRejectionInput {
  boundary: RejectionBoundary;
  tableName: string;
  reasonCode: string;
  reasonDetail: string;
  rowId?: string | null;
  runId?: string | null;
  accountId?: string | null;
  campaignId?: string | null;
  lane?: string | null;
  context?: Record<string, unknown> | null;
}

export async function recordRejection(input: RecordRejectionInput): Promise<void> {
  try {
    await db.insert(pipelineRejections).values({
      boundary: input.boundary,
      tableName: input.tableName,
      reasonCode: input.reasonCode,
      reasonDetail: input.reasonDetail,
      rowId: input.rowId ?? null,
      runId: input.runId ?? null,
      accountId: input.accountId ?? null,
      campaignId: input.campaignId ?? null,
      lane: input.lane ?? null,
      context: input.context ? JSON.stringify(input.context) : null,
    });
  } catch (err) {
    // Last-resort surface — never mask the original integrity violation.
    // eslint-disable-next-line no-console
    console.error(
      `[PipelineRejectionLog] failed to record rejection ${input.reasonCode}:`,
      (err as Error)?.message ?? err,
    );
  }
}

export interface ListRejectionsFilter {
  reasonCode?: string;
  boundary?: RejectionBoundary;
  campaignId?: string;
  accountId?: string;
  sinceMs?: number;
  limit?: number;
}

export async function listRejections(filter: ListRejectionsFilter = {}) {
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
  const conds = [];
  if (filter.reasonCode) conds.push(eq(pipelineRejections.reasonCode, filter.reasonCode));
  if (filter.boundary) conds.push(eq(pipelineRejections.boundary, filter.boundary));
  if (filter.campaignId) conds.push(eq(pipelineRejections.campaignId, filter.campaignId));
  if (filter.accountId) conds.push(eq(pipelineRejections.accountId, filter.accountId));
  if (filter.sinceMs) conds.push(gte(pipelineRejections.observedAt, new Date(filter.sinceMs)));
  const where = conds.length ? and(...conds) : undefined;
  const rows = await db
    .select()
    .from(pipelineRejections)
    .where(where as any)
    .orderBy(desc(pipelineRejections.observedAt))
    .limit(limit);
  return rows;
}

export async function rejectionStats(filter: { sinceMs?: number; campaignId?: string } = {}) {
  const conds = [];
  if (filter.sinceMs) conds.push(gte(pipelineRejections.observedAt, new Date(filter.sinceMs)));
  if (filter.campaignId) conds.push(eq(pipelineRejections.campaignId, filter.campaignId));
  const where = conds.length ? and(...conds) : undefined;
  const rows = await db
    .select({
      reasonCode: pipelineRejections.reasonCode,
      boundary: pipelineRejections.boundary,
      n: sql<number>`count(*)::int`,
    })
    .from(pipelineRejections)
    .where(where as any)
    .groupBy(pipelineRejections.reasonCode, pipelineRejections.boundary);
  return rows;
}
