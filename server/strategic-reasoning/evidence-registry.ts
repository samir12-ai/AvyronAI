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
  ciCompetitorPosts,
  ciCompetitorComments,
  ciCompetitorReviews,
  marketVoiceEvidence,
  competitorWebsiteSnapshots,
  businessUnderstandingSnapshots,
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
  | "causal_claim"
  | "social_post"
  | "social_comment"
  | "customer_review"
  | "market_voice_quote"
  | "website_snapshot"
  | "competitor_understanding"
  | "product_truth";

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
 * Recursively stringifies an object with sorted keys for deterministic hashing.
 */
export function canonicalJsonStringify(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map((item) => canonicalJsonStringify(item)).join(",")}]`;
  }
  const record = obj as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJsonStringify(record[k])}`).join(",")}}`;
}

/**
 * Computes a stable SHA-256 hash for any content payload (string or object).
 */
export function computeStableContentHash(content: unknown): string {
  if (content === null || content === undefined) {
    return createHash("sha256").update("").digest("hex");
  }
  if (typeof content === "string") {
    return createHash("sha256").update(content.trim()).digest("hex");
  }
  return createHash("sha256").update(canonicalJsonStringify(content)).digest("hex");
}

/**
 * Builds a deterministic canonical UID: EV:<kind>:<sourceTable>:<rawId>@<hash12>
 */
export function canonicalEvidenceUid(
  kind: EvidenceKind,
  sourceTable: string,
  rawId: string,
  contentOrHash: unknown
): string {
  let hash12: string;
  if (typeof contentOrHash === "string" && /^[a-f0-9]{12}$/i.test(contentOrHash)) {
    hash12 = contentOrHash.toLowerCase();
  } else {
    hash12 = computeStableContentHash(contentOrHash).slice(0, 12);
  }
  return `EV:${kind}:${sourceTable}:${rawId}@${hash12}`;
}

export interface ParsedEvidenceUid {
  kind: string;
  sourceTable: string;
  sourceId: string;
  rawSourceId: string;
  contentHash12: string | null;
}

/**
 * Decomposes an evidence UID into its constituent parts.
 */
export function parseEvidenceUid(uid: string): ParsedEvidenceUid | null {
  if (!uid || typeof uid !== "string" || !uid.startsWith("EV:")) {
    return null;
  }
  const parts = uid.split(":");
  if (parts.length < 4) {
    return null;
  }
  const kind = parts[1];
  const sourceTable = parts[2];
  const sourceId = parts.slice(3).join(":");
  const [rawSourceId, contentHash12] = sourceId.split("@");

  return {
    kind,
    sourceTable,
    sourceId,
    rawSourceId,
    contentHash12: contentHash12 || null,
  };
}

export interface UnifiedEvidenceItem {
  id: string; // canonical UID (e.g. EV:<kind>:<source_table>:<versionedSourceId>)
  kind: EvidenceKind;
  sourceTable: string;
  sourceId: string; // raw DB row id or external item id
  versionedSourceId: string; // <rowId>@<hash12>
  contentHash: string; // sha256 or hash12
  title?: string | null;
  textSnippet: string; // normalized readable snippet or content preview
  authorIdentifier?: string | null; // hashed/anonymized author where privacy applies (reviews/comments)
  platform?: string | null; // GOOGLE_REVIEWS, TIKTOK, INSTAGRAM, YOUTUBE, REDDIT, etc.
  observedAt: Date;
  publishedAt?: Date | null;
  verificationStatus?: string | null; // e.g. "VERIFIED", "DISCOVERED", "COMPLETE"
  provenance?: {
    platform?: string;
    actorId?: string | null;
    url?: string | null;
    rating?: number | null;
    sentiment?: string | null;
    extra?: Record<string, unknown>;
  };
  supersedesUid?: string | null;
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

/**
 * Resolves a single evidence reference into a unified evidence item.
 */
export async function resolveEvidenceItem(params: {
  accountId: string;
  campaignId: string;
  uid: string;
}): Promise<UnifiedEvidenceItem | null> {
  const batch = await resolveEvidenceItemsBatch({
    accountId: params.accountId,
    campaignId: params.campaignId,
    uids: [params.uid],
  });
  return batch[params.uid] || null;
}

/**
 * Efficiently batch-resolves multiple evidence UIDs across heterogeneous source tables.
 * Employs grouped inArray queries to ensure O(tables) database round-trips.
 */
export async function resolveEvidenceItemsBatch(params: {
  accountId: string;
  campaignId: string;
  uids: string[];
}): Promise<Record<string, UnifiedEvidenceItem>> {
  const { accountId, campaignId, uids } = params;
  const results: Record<string, UnifiedEvidenceItem> = {};
  if (!uids || uids.length === 0) return results;

  const uniqueUids = Array.from(new Set(uids.filter(Boolean)));

  // 1. Check existing rows in evidence_registry first
  try {
    const registryRows = await getEvidenceByUids(accountId, campaignId, uniqueUids);
    for (const row of registryRows) {
      const [rawId, hashPart] = row.sourceId.split("@");
      results[row.evidenceUid] = {
        id: row.evidenceUid,
        kind: row.kind as EvidenceKind,
        sourceTable: row.sourceTable,
        sourceId: rawId,
        versionedSourceId: row.sourceId,
        contentHash: hashPart || computeStableContentHash(row.detail).slice(0, 12),
        title: row.label,
        textSnippet: row.detail,
        observedAt: row.observedAt,
        supersedesUid: row.supersedesUid,
      };
    }
  } catch (err) {
    console.warn(`${LOG} Registry lookup error (continuing with source resolution):`, err);
  }

  // 2. Identify missing UIDs that require source table resolution
  const missingUids = uniqueUids.filter((uid) => !results[uid]);
  if (missingUids.length === 0) return results;

  // Group missing UIDs by sourceTable
  const byTable: Record<string, Array<{ uid: string; parsed: ParsedEvidenceUid }>> = {};
  for (const uid of missingUids) {
    const parsed = parseEvidenceUid(uid);
    if (!parsed) continue;
    if (!byTable[parsed.sourceTable]) byTable[parsed.sourceTable] = [];
    byTable[parsed.sourceTable].push({ uid, parsed });
  }

  // Execute grouped fetches by table
  for (const [table, items] of Object.entries(byTable)) {
    try {
      const rawIds = Array.from(new Set(items.map((it) => it.parsed.rawSourceId)));

      if (table === "ci_competitor_posts") {
        const rows = await db
          .select()
          .from(ciCompetitorPosts)
          .where(and(eq(ciCompetitorPosts.accountId, accountId), inArray(ciCompetitorPosts.id, rawIds)));

        const rowMap = new Map(rows.map((r) => [r.id, r]));
        for (const item of items) {
          const row = rowMap.get(item.parsed.rawSourceId);
          if (row) {
            const snippet = row.caption || row.hookText || row.transcript || "";
            const contentHash = computeStableContentHash(snippet);
            results[item.uid] = {
              id: item.uid,
              kind: (item.parsed.kind as EvidenceKind) || "social_post",
              sourceTable: table,
              sourceId: row.id,
              versionedSourceId: `${row.id}@${contentHash.slice(0, 12)}`,
              contentHash,
              title: row.hookText || null,
              textSnippet: snippet,
              authorIdentifier: row.sourceId || null,
              platform: row.platform,
              observedAt: row.createdAt || new Date(),
              publishedAt: row.timestamp,
              verificationStatus: "VERIFIED",
              provenance: {
                platform: row.platform,
                url: row.permalink,
              },
            };
          }
        }
      } else if (table === "ci_competitor_comments") {
        const rows = await db
          .select()
          .from(ciCompetitorComments)
          .where(and(eq(ciCompetitorComments.accountId, accountId), inArray(ciCompetitorComments.id, rawIds)));

        const rowMap = new Map(rows.map((r) => [r.id, r]));
        for (const item of items) {
          const row = rowMap.get(item.parsed.rawSourceId);
          if (row) {
            const snippet = row.commentText || "";
            const contentHash = computeStableContentHash(snippet);
            results[item.uid] = {
              id: item.uid,
              kind: (item.parsed.kind as EvidenceKind) || "social_comment",
              sourceTable: table,
              sourceId: row.id,
              versionedSourceId: `${row.id}@${contentHash.slice(0, 12)}`,
              contentHash,
              textSnippet: snippet,
              authorIdentifier: row.authorHash || null,
              observedAt: row.createdAt || new Date(),
              publishedAt: row.timestamp,
              verificationStatus: row.filterStatus || "VERIFIED",
            };
          }
        }
      } else if (table === "ci_competitor_reviews") {
        const rows = await db
          .select()
          .from(ciCompetitorReviews)
          .where(and(eq(ciCompetitorReviews.accountId, accountId), inArray(ciCompetitorReviews.id, rawIds)));

        const rowMap = new Map(rows.map((r) => [r.id, r]));
        for (const item of items) {
          const row = rowMap.get(item.parsed.rawSourceId);
          if (row) {
            const snippet = row.reviewText || "";
            const contentHash = computeStableContentHash(snippet);
            results[item.uid] = {
              id: item.uid,
              kind: (item.parsed.kind as EvidenceKind) || "customer_review",
              sourceTable: table,
              sourceId: row.id,
              versionedSourceId: `${row.id}@${contentHash.slice(0, 12)}`,
              contentHash,
              title: row.reviewId || null,
              textSnippet: snippet,
              authorIdentifier: row.authorHash || null,
              platform: row.platform,
              observedAt: row.scrapedAt || row.createdAt || new Date(),
              publishedAt: row.reviewDate,
              verificationStatus: "VERIFIED",
              provenance: {
                platform: row.platform,
                rating: row.rating,
              },
            };
          }
        }
      } else if (table === "market_voice_evidence") {
        const rows = await db
          .select()
          .from(marketVoiceEvidence)
          .where(and(eq(marketVoiceEvidence.accountId, accountId), inArray(marketVoiceEvidence.id, rawIds)));

        const rowMap = new Map(rows.map((r) => [r.id, r]));
        for (const item of items) {
          const row = rowMap.get(item.parsed.rawSourceId);
          if (row) {
            const snippet = row.verbatimText || "";
            const contentHash = computeStableContentHash(snippet);
            results[item.uid] = {
              id: item.uid,
              kind: (item.parsed.kind as EvidenceKind) || "market_voice_quote",
              sourceTable: table,
              sourceId: row.id,
              versionedSourceId: `${row.id}@${contentHash.slice(0, 12)}`,
              contentHash,
              textSnippet: snippet,
              authorIdentifier: row.authorHash || null,
              platform: row.platform,
              observedAt: row.createdAt || new Date(),
              publishedAt: row.publishedAt,
              verificationStatus: row.eligibilityVerdict || "VERIFIED",
              provenance: {
                platform: row.platform,
                url: row.externalUrl,
              },
            };
          }
        }
      } else if (table === "competitor_website_snapshots") {
        const rows = await db
          .select()
          .from(competitorWebsiteSnapshots)
          .where(and(eq(competitorWebsiteSnapshots.accountId, accountId), inArray(competitorWebsiteSnapshots.id, rawIds)));

        const rowMap = new Map(rows.map((r) => [r.id, r]));
        for (const item of items) {
          const row = rowMap.get(item.parsed.rawSourceId);
          if (row) {
            results[item.uid] = {
              id: item.uid,
              kind: (item.parsed.kind as EvidenceKind) || "website_snapshot",
              sourceTable: table,
              sourceId: row.id,
              versionedSourceId: `${row.id}@${(row.contentHash || "").slice(0, 12)}`,
              contentHash: row.contentHash || "",
              title: row.websiteUrl,
              textSnippet: `Competitor website snapshot for ${row.websiteUrl}`,
              observedAt: row.createdAt || new Date(),
              verificationStatus: row.status,
              provenance: {
                url: row.websiteUrl,
              },
            };
          }
        }
      } else if (table === "business_understanding_snapshots") {
        const rows = await db
          .select()
          .from(businessUnderstandingSnapshots)
          .where(and(eq(businessUnderstandingSnapshots.accountId, accountId), inArray(businessUnderstandingSnapshots.id, rawIds)));

        const rowMap = new Map(rows.map((r) => [r.id, r]));
        for (const item of items) {
          const row = rowMap.get(item.parsed.rawSourceId);
          if (row) {
            const bu = (row.businessUnderstanding || {}) as any;
            const summary = bu.coreOfferingSummary || bu.summary || JSON.stringify(bu).slice(0, 200);
            const contentHash = computeStableContentHash(summary);
            results[item.uid] = {
              id: item.uid,
              kind: (item.parsed.kind as EvidenceKind) || "product_truth",
              sourceTable: table,
              sourceId: row.id,
              versionedSourceId: `${row.id}@${contentHash.slice(0, 12)}`,
              contentHash,
              title: bu.businessName || "Business Understanding",
              textSnippet: summary,
              observedAt: row.createdAt || new Date(),
              verificationStatus: row.status,
            };
          }
        }
      }
    } catch (tblErr) {
      console.warn(`${LOG} Error resolving items for table ${table}:`, tblErr);
    }
  }

  return results;
}

