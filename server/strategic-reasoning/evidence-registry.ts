/**
 * Evidence Registry + Reasoning Runs (P-5 M1)
 *
 * The registry is a thin citation/lineage INDEX over existing intelligence
 * stores — payloads stay in their source tables; the registry stores only the
 * pointer plus a human-readable label/detail snapshot (so citations survive
 * source cleanup). Registration is LAZY: a fact gets a registry row the first
 * time something cites it. UIDs are deterministic
 * (`EV:<kind>:<source_table>:<source_id>`), and source ids for row-backed
 * evidence are CONTENT-VERSIONED (`<rowId>@<hash12(detail)>`): when a mutable
 * source row (business_data_layer, ci_competitors, strategy_memory, …)
 * changes, the changed content gets a NEW UID instead of overwriting the old
 * one. Registry rows are therefore IMMUTABLE once written — a historical
 * reasoning_runs.ref_map always resolves to the exact evidence text that
 * existed at run time.
 *
 * reasoning_runs persists the outcome of every fresh judge-gated
 * interpretation run — accepted cards OR the rejected AI output with the
 * rejection reasons. Rejected output is stored for accuracy/learning analysis
 * only and is NEVER served to customers. Run persistence must never block
 * serving: recordReasoningRun catches internally and returns null on failure
 * (loudly logged).
 *
 * Tenant scoping is mandatory: every read and write carries accountId AND
 * campaignId.
 */

import { createHash } from "crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  evidenceRegistry,
  reasoningRuns,
  type EvidenceRegistryRow,
} from "../../shared/schema";

const LOG = "[EvidenceRegistry]";

export type EvidenceKind =
  | "market_insight"
  | "performance_report"
  | "performance_verdict"
  | "performance_memory"
  | "business_context"
  | "objective"
  | "competitor"
  | "historical_finding"
  | "causal_claim";

export interface RegistryEntry {
  kind: EvidenceKind;
  sourceTable: string; // real table, or 'derived:<analyzer>' for computed findings
  sourceId: string;
  label: string;
  detail: string;
  observedAt: Date; // coverage time (windowTo-style), not write time
  supersedesUid?: string;
}

export function evidenceUidFor(kind: EvidenceKind, sourceTable: string, sourceId: string): string {
  return `EV:${kind}:${sourceTable}:${sourceId}`;
}

/** Stable source id for derived (non-table-backed) findings: content hash. */
export function derivedSourceId(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/**
 * Content-versioned source id for row-backed evidence: `<rowId>@<hash12>`.
 * Immutable source rows always hash to the same id (idempotent); mutable rows
 * mint a NEW id when their cited content changes, so old citations keep
 * resolving to the text that existed when they were made.
 */
export function versionedSourceId(rowId: string, content: string): string {
  return `${rowId}@${createHash("sha256").update(content).digest("hex").slice(0, 12)}`;
}

/**
 * Deterministic UID for an AEL causal item. Callers hold the item content
 * (the AEL package travels with the run), so the UID is computable without a
 * DB lookup; the content hash keeps re-persisted snapshots (same jobId,
 * regenerated items) from silently rewriting cited evidence.
 */
export function aelEvidenceUid(aelSnapshotId: string, alias: string, detail: string): string {
  return evidenceUidFor("causal_claim", "ael_snapshots", versionedSourceId(`${aelSnapshotId}:${alias}`, detail));
}

/**
 * Idempotently register evidence entries. Returns UIDs in input order.
 * APPEND-ONLY: UIDs embed a content version, so a conflict means the exact
 * same evidence text is already registered — the insert is a no-op and the
 * stored row is never mutated (historical run citations stay truthful).
 */
export async function registerEvidence(
  accountId: string,
  campaignId: string,
  entries: RegistryEntry[],
): Promise<string[]> {
  if (entries.length === 0) return [];
  const uids = entries.map((e) => evidenceUidFor(e.kind, e.sourceTable, e.sourceId));
  await db
    .insert(evidenceRegistry)
    .values(entries.map((e, i) => ({
      accountId,
      campaignId,
      evidenceUid: uids[i],
      kind: e.kind,
      sourceTable: e.sourceTable,
      sourceId: e.sourceId,
      label: e.label,
      detail: e.detail,
      observedAt: e.observedAt,
      supersedesUid: e.supersedesUid ?? null,
    })))
    .onConflictDoNothing({
      target: [evidenceRegistry.accountId, evidenceRegistry.campaignId, evidenceRegistry.evidenceUid],
    });
  return uids;
}

/** Tenant-scoped resolution of citation UIDs back to registry rows. */
export async function getEvidenceByUids(
  accountId: string,
  campaignId: string,
  uids: string[],
): Promise<EvidenceRegistryRow[]> {
  if (uids.length === 0) return [];
  return db
    .select()
    .from(evidenceRegistry)
    .where(
      and(
        eq(evidenceRegistry.accountId, accountId),
        eq(evidenceRegistry.campaignId, campaignId),
        inArray(evidenceRegistry.evidenceUid, uids),
      ),
    );
}

export type ReasoningRunLayer = "strategic_reasoning" | "market_analyst";
export type ReasoningRunStatus =
  | "accepted_ai"
  | "guards_rejected"
  | "judge_rejected"
  | "llm_failed"
  | "no_trigger";

/**
 * Persist a reasoning run. Never throws — persistence failure must never
 * block serving; it logs loudly and returns null.
 */
export async function recordReasoningRun(args: {
  accountId: string;
  campaignId: string;
  layer: ReasoningRunLayer;
  status: ReasoningRunStatus;
  contextFingerprint: string;
  model?: string | null;
  output: unknown; // what was actually served (JSON-serialized here)
  rejectedOutput?: unknown | null;
  rejectionReasons?: string[] | null;
  evidenceUids?: string[];
  refMap?: Record<string, string> | null;
}): Promise<string | null> {
  try {
    const inserted = await db
      .insert(reasoningRuns)
      .values({
        accountId: args.accountId,
        campaignId: args.campaignId,
        layer: args.layer,
        status: args.status,
        contextFingerprint: args.contextFingerprint,
        model: args.model ?? null,
        output: JSON.stringify(args.output),
        rejectedOutput: args.rejectedOutput != null ? JSON.stringify(args.rejectedOutput) : null,
        rejectionReasons: args.rejectionReasons != null ? JSON.stringify(args.rejectionReasons) : null,
        evidenceUids: JSON.stringify(args.evidenceUids ?? []),
        refMap: args.refMap != null ? JSON.stringify(args.refMap) : null,
      })
      .returning({ id: reasoningRuns.id });
    return inserted[0]?.id ?? null;
  } catch (err) {
    console.error(
      `${LOG} RUN_WRITE_FAILED layer=${args.layer} campaign=${args.campaignId} detail=${(err as Error).message}`,
    );
    return null;
  }
}
