/**
 * Phase 6 — Cluster production for a closed evaluation window.
 *
 * Locked by Samir 2026-04-20 §6.5–§6.9:
 *   - Source: published_posts only, status='published', within window dates.
 *     Drafts excluded. User truth NOT folded into the cluster signature.
 *   - Tokenization: transcribed from MIv3 (see _tokenize.ts).
 *   - Theme assignment: highest token-overlap wins, alphabetical tiebreak
 *     for determinism. Single-post themes kept (informative for "new theme").
 *   - Idempotency: UNIQUE (window_id, dna_id) on pipeline_clusters.
 *     INSERT … ON CONFLICT DO NOTHING.
 *   - Trigger: ONLY when window is terminal AND evaluation_status ∈
 *     {complete, degraded} AND active DNA exists.
 *
 * Anti-scope: no scoring, no theme labels beyond their token tuple, no
 * inferred meaning. The signature describes WHAT was published; it does not
 * judge WHETHER it worked. Q1 promotion (which DOES judge) lives in the
 * comparator + dna-working policy.
 */
import { db } from "../db";
import {
  pipelineClusters,
  publishedPosts,
  type PipelineCluster,
  type PipelineEvalWindow,
  type PipelineDna,
} from "@shared/schema";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { canonicalTokens } from "./_tokenize";

export interface ClusterTheme {
  theme_token: string;
  post_count: number;
  post_ids: string[];
}

export interface ClusterSignature {
  version: 1;
  post_count: number;
  by_media_type: Record<string, number>;
  by_platform: Record<string, number>;
  themes: ClusterTheme[];
  post_ids: string[];
}

export type ProduceClustersResult =
  | { produced: true; cluster: PipelineCluster; signature: ClusterSignature }
  | { skipped: true; reason: string };

const TERMINAL_STATES = new Set(["closed_with_truth", "closed_missing_truth", "late_filled"]);

/**
 * Build a deterministic theme list from a list of {id, caption} posts.
 * Two-token theme key, joined with "+", sorted alphabetically inside the key
 * for determinism.
 *
 * Algorithm:
 *   1. Take the canonical tokens for each post's caption.
 *   2. Form a candidate theme key: the two most-frequent tokens across the
 *      whole corpus that ALSO appear in this post (alphabetical tiebreak).
 *      If a post has fewer than 2 distinct canonical tokens, use whatever it
 *      has (single-token, or "_untagged" if it has none).
 *   3. Group posts by their theme key. Sort themes by post_count DESC then
 *      theme_token ASC for stable output.
 */
export function buildThemes(posts: Array<{ id: string; caption: string }>): ClusterTheme[] {
  const tokensByPost = new Map<string, string[]>();
  const corpusFreq = new Map<string, number>();

  for (const p of posts) {
    const toks = canonicalTokens(p.caption);
    tokensByPost.set(p.id, toks);
    for (const t of toks) corpusFreq.set(t, (corpusFreq.get(t) ?? 0) + 1);
  }

  function themeKeyFor(postId: string): string {
    const toks = tokensByPost.get(postId) ?? [];
    if (toks.length === 0) return "_untagged";
    // Pick two most-frequent corpus tokens that the post contains; alpha tiebreak.
    const ranked = [...toks].sort((a, b) => {
      const fa = corpusFreq.get(a) ?? 0;
      const fb = corpusFreq.get(b) ?? 0;
      if (fb !== fa) return fb - fa;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    const top = ranked.slice(0, 2);
    top.sort();
    return top.join("+");
  }

  const groups = new Map<string, string[]>();
  for (const p of posts) {
    const key = themeKeyFor(p.id);
    const arr = groups.get(key) ?? [];
    arr.push(p.id);
    groups.set(key, arr);
  }

  const themes: ClusterTheme[] = [...groups.entries()].map(([theme_token, post_ids]) => ({
    theme_token,
    post_count: post_ids.length,
    post_ids: [...post_ids].sort(),
  }));

  themes.sort((a, b) => {
    if (b.post_count !== a.post_count) return b.post_count - a.post_count;
    return a.theme_token < b.theme_token ? -1 : 1;
  });
  return themes;
}

export async function buildSignatureForWindow(window: PipelineEvalWindow): Promise<ClusterSignature> {
  const rows = await db
    .select({
      id: publishedPosts.id,
      caption: publishedPosts.caption,
      mediaType: publishedPosts.mediaType,
      platform: publishedPosts.platform,
    })
    .from(publishedPosts)
    .where(and(
      eq(publishedPosts.campaignId, window.campaignId),
      eq(publishedPosts.status, "published"),
      gte(publishedPosts.publishedAt, window.windowStart),
      lt(publishedPosts.publishedAt, window.windowEnd),
    ));

  const byMedia: Record<string, number> = {};
  const byPlat: Record<string, number> = {};
  for (const r of rows) {
    if (r.mediaType) byMedia[r.mediaType] = (byMedia[r.mediaType] ?? 0) + 1;
    if (r.platform) byPlat[r.platform] = (byPlat[r.platform] ?? 0) + 1;
  }

  // Sort the buckets alphabetically for byte-identical JSON output.
  const sortedMedia: Record<string, number> = {};
  for (const k of Object.keys(byMedia).sort()) sortedMedia[k] = byMedia[k];
  const sortedPlat: Record<string, number> = {};
  for (const k of Object.keys(byPlat).sort()) sortedPlat[k] = byPlat[k];

  const themes = buildThemes(rows.map((r) => ({ id: r.id, caption: r.caption ?? "" })));

  return {
    version: 1,
    post_count: rows.length,
    by_media_type: sortedMedia,
    by_platform: sortedPlat,
    themes,
    post_ids: rows.map((r) => r.id).sort(),
  };
}

/**
 * Produce (idempotently) the cluster row for a window+DNA pair.
 * Skips with explicit reason when preconditions aren't met.
 */
export async function produceClustersForWindow(opts: {
  window: PipelineEvalWindow;
  activeDna: PipelineDna | null;
  evaluationStatus: "complete" | "degraded" | "blocked" | "no_active_plan";
  bossRunId?: string | null;
}): Promise<ProduceClustersResult> {
  const { window, activeDna, evaluationStatus, bossRunId } = opts;

  if (!TERMINAL_STATES.has(window.state)) {
    return { skipped: true, reason: "window_not_terminal" };
  }
  if (evaluationStatus === "blocked" || evaluationStatus === "no_active_plan") {
    return { skipped: true, reason: `evaluation_${evaluationStatus}` };
  }
  if (!activeDna) {
    return { skipped: true, reason: "no_active_dna" };
  }

  const signature = await buildSignatureForWindow(window);

  // Idempotent insert; if the row already exists we read it back.
  await db.insert(pipelineClusters).values({
    accountId: window.accountId,
    campaignId: window.campaignId,
    dnaId: activeDna.id,
    windowId: window.id,
    clusterSignature: signature as any,
    producedByRunId: bossRunId ?? undefined,
  }).onConflictDoNothing({ target: [pipelineClusters.windowId, pipelineClusters.dnaId] });

  const rows = await db.select().from(pipelineClusters).where(
    and(eq(pipelineClusters.windowId, window.id), eq(pipelineClusters.dnaId, activeDna.id)),
  ).limit(1);

  const cluster = rows[0];
  if (!cluster) return { skipped: true, reason: "cluster_lookup_failed_after_insert" };

  // Read back the persisted signature (preserves byte-identical comparisons across runs).
  const persisted = cluster.clusterSignature as unknown as ClusterSignature;
  return { produced: true, cluster, signature: persisted };
}

/**
 * Find the most recent prior cluster row under the same DNA for baseline comparison.
 * Returns null if none exist (caller treats as `no_baseline`).
 *
 * Excludes the current window itself. Only considers cluster rows whose
 * window's windowEnd is strictly less than the current window's windowEnd.
 */
export async function getBaselineCluster(opts: {
  accountId: string;
  campaignId: string;
  dnaId: string;
  currentWindowEnd: Date;
}): Promise<PipelineCluster | null> {
  const result = await db.execute<{
    id: string;
    account_id: string;
    campaign_id: string;
    dna_id: string;
    window_id: string;
    cluster_signature: ClusterSignature;
    produced_at: Date;
    produced_by_run_id: string | null;
  }>(sql`
    SELECT c.id, c.account_id, c.campaign_id, c.dna_id, c.window_id,
           c.cluster_signature, c.produced_at, c.produced_by_run_id
    FROM pipeline_clusters c
    JOIN pipeline_eval_windows w ON w.id = c.window_id
    WHERE c.account_id = ${opts.accountId}
      AND c.campaign_id = ${opts.campaignId}
      AND c.dna_id = ${opts.dnaId}
      AND w.window_end < ${opts.currentWindowEnd}
    ORDER BY w.window_end DESC
    LIMIT 1
  `);
  const r = (result.rows ?? (result as any))[0];
  if (!r) return null;
  return {
    id: r.id,
    accountId: r.account_id,
    campaignId: r.campaign_id,
    dnaId: r.dna_id,
    windowId: r.window_id,
    clusterSignature: r.cluster_signature as any,
    producedAt: r.produced_at,
    producedByRunId: r.produced_by_run_id,
  } as PipelineCluster;
}
